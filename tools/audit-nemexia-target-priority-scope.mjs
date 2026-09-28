import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { FACTION_SHIP_MECHANICS } from '../src/domain/combat/faction-ship-data.ts';
import { DEFENSE_COMBAT_CATALOG, COMMANDER_COMBAT_CATALOG, getCombatEntity } from '../src/domain/combat/catalog.ts';
import { getFactionCombatEntity } from '../src/domain/combat/faction-catalog.ts';

const CSV_PATH = 'docs/evidence/nemexia-target-priority-corpus/target-transitions.csv';
const RACE_TO_FACTION = { '1': 'aegis', '2': 'synod', '3': 'veyra' };
const CORE = new Set(['scout', 'cruiser', 'defender', 'battleship', 'destroyer', 'bomber']);

function parseCsvLine(line) {
  const cells = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (quoted && ch === '"' && line[i + 1] === '"') { cell += '"'; i += 1; }
    else if (ch === '"') quoted = !quoted;
    else if (ch === ',' && !quoted) { cells.push(cell); cell = ''; }
    else cell += ch;
  }
  cells.push(cell);
  return cells;
}

function normalizeName(value) {
  return String(value ?? '').trim().toLowerCase().replaceAll('ё', 'е').replace(/\s+/g, ' ');
}

function canonical(id) {
  if (!id) return null;
  const entity = getCombatEntity(id);
  return entity.ordinaryClass ?? entity.id;
}

function buildIndex(faction) {
  const index = new Map();
  for (const item of Object.values(FACTION_SHIP_MECHANICS[faction])) {
    const value = { id: item.id, canonical: canonical(item.id), kind: 'ship' };
    index.set(normalizeName(item.sourceName), value);
    try { index.set(normalizeName(getFactionCombatEntity(faction, item.id).name), value); } catch {}
  }
  for (const item of DEFENSE_COMBAT_CATALOG) {
    const value = { id: item.id, canonical: canonical(item.id), kind: 'defense' };
    index.set(normalizeName(item.name), value);
    try { index.set(normalizeName(getFactionCombatEntity(faction, item.id).name), value); } catch {}
  }
  for (const item of COMMANDER_COMBAT_CATALOG) {
    index.set(normalizeName(item.name), { id: item.id, canonical: canonical(item.id), kind: 'commander' });
  }
  return index;
}

const INDEX = Object.fromEntries(Object.values(RACE_TO_FACTION).map((faction) => [faction, buildIndex(faction)]));

function hashPercent(value) {
  return Number.parseInt(createHash('sha256').update(value).digest('hex').slice(0, 8), 16) % 100;
}

function addCount(object, key, amount = 1) {
  object[key] = (object[key] ?? 0) + amount;
}

function readRows() {
  const lines = readFileSync(CSV_PATH, 'utf8').replace(/^\uFEFF/, '').split(/\r?\n/).filter(Boolean);
  const headers = parseCsvLine(lines[0] ?? '');
  return lines.slice(1).map((line) => {
    const cells = parseCsvLine(line);
    const row = Object.fromEntries(headers.map((header, i) => [header, cells[i] ?? '']));
    const candidatesRaw = JSON.parse(row.alive_targets_at_switch_json || '[]');
    const actorRace = row.action_side === 'attacker' ? row.attacker_race : row.defender_race;
    const targetRace = row.action_side === 'attacker' ? row.defender_race : row.attacker_race;
    const actorFaction = RACE_TO_FACTION[actorRace];
    const targetFaction = RACE_TO_FACTION[targetRace];
    const actor = actorFaction ? INDEX[actorFaction]?.get(normalizeName(row.actor_class)) : undefined;
    const candidates = candidatesRaw.map((candidate) => ({
      ...candidate,
      resolved: targetFaction ? INDEX[targetFaction]?.get(normalizeName(candidate.name)) : undefined,
    }));
    const chosenIndex = candidates.findIndex((candidate) => candidate.name === row.current_target);
    const groupKey = `${row.experiment_block}|${row.comparison_key || `${row.archive_part}:${row.source_line}`}`;
    return { ...row, actor, candidates, chosenIndex, groupKey };
  });
}

function summarize(rows) {
  const actorClassCounts = {};
  const chosenClassCounts = {};
  const actorChosenCounts = {};
  const candidatePresenceCounts = {};
  const candidateSetCounts = {};
  const unresolvedActors = {};
  const unresolvedCandidates = {};
  const examples = [];
  let mapped = 0;
  let coreEligible = 0;

  for (const row of rows) {
    const actorClass = row.actor?.canonical ?? null;
    const candidateClasses = row.candidates.map((candidate) => candidate.resolved?.canonical ?? null);
    const chosenClass = row.candidates[row.chosenIndex]?.resolved?.canonical ?? null;
    if (actorClass && candidateClasses.every(Boolean) && chosenClass) mapped += 1;
    if (actorClass && CORE.has(actorClass) && candidateClasses.length && candidateClasses.every((value) => CORE.has(value))) {
      coreEligible += 1;
      continue;
    }

    if (actorClass) addCount(actorClassCounts, actorClass);
    else addCount(unresolvedActors, row.actor_class || '(blank)');
    if (chosenClass) addCount(chosenClassCounts, chosenClass);
    if (actorClass && chosenClass) addCount(actorChosenCounts, `${actorClass}>${chosenClass}`);
    for (const value of new Set(candidateClasses.filter(Boolean))) addCount(candidatePresenceCounts, value);
    for (const candidate of row.candidates) {
      if (!candidate.resolved) addCount(unresolvedCandidates, candidate.name || '(blank)');
    }
    const setKey = [...new Set(candidateClasses.map((value) => value ?? '?'))].sort().join('|');
    addCount(candidateSetCounts, setKey || '(none)');
    if (examples.length < 30) {
      examples.push({
        transition: Number(row.transition_id),
        source: `${row.archive_part}:${row.source_line}`,
        actor: row.actor_class,
        actorClass,
        chosen: row.current_target,
        chosenClass,
        candidates: row.candidates.map((candidate) => ({ name: candidate.name, class: candidate.resolved?.canonical ?? null, count: Number(candidate.count) })),
      });
    }
  }

  const sorted = (object) => Object.fromEntries(Object.entries(object).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])));
  return {
    total: rows.length,
    fullyMapped: mapped,
    coreEligible,
    outsideCore: rows.length - coreEligible,
    actorClassCounts: sorted(actorClassCounts),
    chosenClassCounts: sorted(chosenClassCounts),
    actorChosenCounts: sorted(actorChosenCounts),
    candidatePresenceCounts: sorted(candidatePresenceCounts),
    candidateSetCounts: sorted(candidateSetCounts),
    unresolvedActors: sorted(unresolvedActors),
    unresolvedCandidates: sorted(unresolvedCandidates),
    examples,
  };
}

const rows = readRows().filter((row) => row.chosenIndex >= 0 && row.candidates.length > 0);
const controlled = rows.filter((row) => row.experiment_block === 'target_priority');
const nonControlled = rows.filter((row) => row.experiment_block !== 'target_priority');
const discovery = nonControlled.filter((row) => hashPercent(row.groupKey) < 70);
const holdout = nonControlled.filter((row) => hashPercent(row.groupKey) >= 70);

console.log(JSON.stringify({
  discovery: summarize(discovery),
  holdout: summarize(holdout),
  controlled: summarize(controlled),
}, null, 2));
