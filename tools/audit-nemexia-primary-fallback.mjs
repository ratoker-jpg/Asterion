import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { FACTION_SHIP_MECHANICS } from '../src/domain/combat/faction-ship-data.ts';
import { getCombatEntity } from '../src/domain/combat/catalog.ts';
import { getFactionCombatEntity } from '../src/domain/combat/faction-catalog.ts';

const CSV_PATH = 'docs/evidence/nemexia-target-priority-corpus/target-transitions.csv';
const RACE_TO_FACTION = { '1': 'aegis', '2': 'synod', '3': 'veyra' };
const CORE = ['scout', 'cruiser', 'defender', 'battleship', 'destroyer', 'bomber'];
const CORE_SET = new Set(CORE);
const PRIMARY = {
  scout: 'defender',
  cruiser: 'scout',
  defender: 'bomber',
  battleship: 'cruiser',
  destroyer: 'battleship',
  bomber: 'destroyer',
};
const GLOBAL_FALLBACK = ['bomber', 'destroyer', 'battleship', 'defender', 'cruiser', 'scout'];

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

function canonicalClass(id) {
  const entity = getCombatEntity(id);
  return entity.ordinaryClass ?? entity.id;
}

function buildShipIndex(faction) {
  const index = new Map();
  for (const item of Object.values(FACTION_SHIP_MECHANICS[faction])) {
    const value = {
      id: item.id,
      targetClass: canonicalClass(item.id),
      attack: item.combat.attack,
      population: item.population,
    };
    index.set(normalizeName(item.sourceName), value);
    try {
      index.set(normalizeName(getFactionCombatEntity(faction, item.id).name), value);
    } catch {}
  }
  return index;
}

const SHIP_INDEX = Object.fromEntries(
  Object.values(RACE_TO_FACTION).map((faction) => [faction, buildShipIndex(faction)]),
);

function readRows() {
  const lines = readFileSync(CSV_PATH, 'utf8').replace(/^\uFEFF/, '').split(/\r?\n/).filter(Boolean);
  const headers = parseCsvLine(lines[0] ?? '');
  return lines.slice(1).map((line) => {
    const cells = parseCsvLine(line);
    const raw = Object.fromEntries(headers.map((header, i) => [header, cells[i] ?? '']));
    const candidatesRaw = JSON.parse(raw.alive_targets_at_switch_json || '[]');
    const priorityPlan = JSON.parse(raw.priority_order_plan_json || '[]');
    const actorRace = raw.action_side === 'attacker' ? raw.attacker_race : raw.defender_race;
    const targetRace = raw.action_side === 'attacker' ? raw.defender_race : raw.attacker_race;
    const actorFaction = RACE_TO_FACTION[actorRace];
    const targetFaction = RACE_TO_FACTION[targetRace];
    const actor = actorFaction ? SHIP_INDEX[actorFaction]?.get(normalizeName(raw.actor_class)) : undefined;
    const candidates = candidatesRaw.map((candidate, index) => {
      const resolved = targetFaction ? SHIP_INDEX[targetFaction]?.get(normalizeName(candidate.name)) : undefined;
      return {
        ...candidate,
        index,
        resolved,
        targetClass: resolved?.targetClass ?? null,
        threat: resolved ? Number(candidate.count) * resolved.attack : null,
        totalPopulation: resolved ? Number(candidate.count) * resolved.population : null,
      };
    });
    return {
      ...raw,
      candidates,
      priorityPlan,
      actorClass: actor?.targetClass ?? null,
      chosenIndex: candidates.findIndex((candidate) => candidate.name === raw.current_target),
      groupKey: `${raw.experiment_block}|${raw.comparison_key || `${raw.archive_part}:${raw.source_line}`}`,
    };
  });
}

function hashPercent(value) {
  return Number.parseInt(createHash('sha256').update(value).digest('hex').slice(0, 8), 16) % 100;
}

function isHoldout(row) {
  return hashPercent(row.groupKey) >= 70;
}

function eligible(row) {
  return row.chosenIndex >= 0
    && CORE_SET.has(row.actorClass)
    && row.candidates.length > 0
    && row.candidates.every((candidate) => CORE_SET.has(candidate.targetClass));
}

function primaryPlusFallbackOrder(actorClass) {
  const primary = PRIMARY[actorClass];
  return [primary, ...GLOBAL_FALLBACK.filter((targetClass) => targetClass !== primary)];
}

function choose(row, tieBreak) {
  if (!eligible(row)) return null;
  const order = primaryPlusFallbackOrder(row.actorClass);
  for (const targetClass of order) {
    const matches = row.candidates
      .map((candidate, index) => ({ candidate, index }))
      .filter(({ candidate }) => candidate.targetClass === targetClass);
    if (!matches.length) continue;
    matches.sort((a, b) => {
      if (tieBreak === 'minCount') {
        return Number(a.candidate.count) - Number(b.candidate.count)
          || Number(a.candidate.order) - Number(b.candidate.order);
      }
      if (tieBreak === 'maxThreat') {
        return Number(b.candidate.threat) - Number(a.candidate.threat)
          || Number(a.candidate.order) - Number(b.candidate.order);
      }
      if (tieBreak === 'maxPopulation') {
        return Number(b.candidate.totalPopulation) - Number(a.candidate.totalPopulation)
          || Number(a.candidate.order) - Number(b.candidate.order);
      }
      return Number(a.candidate.order) - Number(b.candidate.order);
    });
    return matches[0].index;
  }
  return null;
}

function metrics(rows, tieBreak) {
  let n = 0;
  let hits = 0;
  const misses = [];
  const byActor = {};
  for (const row of rows) {
    const prediction = choose(row, tieBreak);
    if (prediction === null) continue;
    n += 1;
    byActor[row.actorClass] ??= { n: 0, hits: 0 };
    byActor[row.actorClass].n += 1;
    if (prediction === row.chosenIndex) {
      hits += 1;
      byActor[row.actorClass].hits += 1;
    } else if (misses.length < 30) {
      misses.push({
        transition: Number(row.transition_id),
        source: `${row.archive_part}:${row.source_line}`,
        case: row.case_id,
        round: Number(row.round),
        actor: row.actor_class,
        actorClass: row.actorClass,
        chosen: row.current_target,
        chosenClass: row.candidates[row.chosenIndex]?.targetClass,
        predicted: row.candidates[prediction]?.name,
        predictedClass: row.candidates[prediction]?.targetClass,
        candidates: row.candidates.map((candidate) => ({
          name: candidate.name,
          class: candidate.targetClass,
          count: Number(candidate.count),
          order: Number(candidate.order),
        })),
      });
    }
  }
  for (const value of Object.values(byActor)) {
    value.accuracy = value.n ? value.hits / value.n : null;
  }
  return { n, hits, misses: n - hits, accuracy: n ? hits / n : null, byActor, examples: misses };
}

function planLastLegalMetrics(rows) {
  let n = 0;
  let hits = 0;
  for (const row of rows) {
    if (!row.priorityPlan.length || row.chosenIndex < 0) continue;
    const legal = new Map(row.candidates.map((candidate, index) => [normalizeName(candidate.name), index]));
    let prediction = null;
    for (const name of [...row.priorityPlan].reverse()) {
      const index = legal.get(normalizeName(name));
      if (index !== undefined) { prediction = index; break; }
    }
    if (prediction === null) continue;
    n += 1;
    if (prediction === row.chosenIndex) hits += 1;
  }
  return { n, hits, misses: n - hits, accuracy: n ? hits / n : null };
}

function sameClassChoiceCount(rows) {
  let rowsWithDuplicateTargetClass = 0;
  for (const row of rows.filter(eligible)) {
    const counts = new Map();
    for (const candidate of row.candidates) {
      counts.set(candidate.targetClass, (counts.get(candidate.targetClass) ?? 0) + 1);
    }
    if ([...counts.values()].some((value) => value > 1)) rowsWithDuplicateTargetClass += 1;
  }
  return rowsWithDuplicateTargetClass;
}

function clean(value) {
  if (Array.isArray(value)) return value.map(clean);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clean(item)]));
  }
  if (typeof value === 'number' && Number.isFinite(value)) return Number(value.toFixed(6));
  return value;
}

const rows = readRows();
const controlled = rows.filter((row) => row.experiment_block === 'target_priority');
const nonControlled = rows.filter((row) => row.experiment_block !== 'target_priority');
const discovery = nonControlled.filter((row) => !isHoldout(row));
const holdout = nonControlled.filter(isHoldout);

const result = clean({
  hypothesis: {
    primary: PRIMARY,
    globalFallback: GLOBAL_FALLBACK,
    perActorOrder: Object.fromEntries(CORE.map((actor) => [actor, primaryPlusFallbackOrder(actor)])),
  },
  coverage: {
    discoveryAll: discovery.length,
    discoveryEligible: discovery.filter(eligible).length,
    holdoutAll: holdout.length,
    holdoutEligible: holdout.filter(eligible).length,
    controlledAll: controlled.length,
    controlledEligible: controlled.filter(eligible).length,
    holdoutRowsWithDuplicateTargetClass: sameClassChoiceCount(holdout),
  },
  discovery: {
    reportOrderTieBreak: metrics(discovery, 'reportOrder'),
    minCountTieBreak: metrics(discovery, 'minCount'),
    maxThreatTieBreak: metrics(discovery, 'maxThreat'),
  },
  holdout: {
    reportOrderTieBreak: metrics(holdout, 'reportOrder'),
    minCountTieBreak: metrics(holdout, 'minCount'),
    maxThreatTieBreak: metrics(holdout, 'maxThreat'),
    maxPopulationTieBreak: metrics(holdout, 'maxPopulation'),
  },
  controlled: {
    reportOrderTieBreak: metrics(controlled, 'reportOrder'),
    minCountTieBreak: metrics(controlled, 'minCount'),
    maxThreatTieBreak: metrics(controlled, 'maxThreat'),
    plannedLastLegal: planLastLegalMetrics(controlled),
  },
});

console.log(JSON.stringify(result, null, 2));
