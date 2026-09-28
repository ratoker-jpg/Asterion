import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { FACTION_SHIP_MECHANICS } from '../src/domain/combat/faction-ship-data.ts';
import { FACTION_DEFENSE_CONSTRUCTION_BALANCE } from '../src/domain/combat/defense-construction-data.ts';
import { DEFENSE_COMBAT_CATALOG, COMMANDER_COMBAT_CATALOG, getCombatEntity } from '../src/domain/combat/catalog.ts';
import { getFactionCombatEntity } from '../src/domain/combat/faction-catalog.ts';

const ROOT = 'docs/evidence/nemexia-target-priority-corpus';
const CSV_PATH = `${ROOT}/target-transitions.csv`;
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
  if (quoted) throw new Error('Unclosed CSV quote.');
  cells.push(cell);
  return cells;
}

function normalizeName(value) {
  return String(value ?? '').trim().toLowerCase().replaceAll('ё', 'е').replace(/\s+/g, ' ');
}

function readCsv() {
  const lines = readFileSync(CSV_PATH, 'utf8').replace(/^\uFEFF/, '').split(/\r?\n/).filter(Boolean);
  const headers = parseCsvLine(lines[0] ?? '');
  return lines.slice(1).map((line) => {
    const cells = parseCsvLine(line);
    const row = Object.fromEntries(headers.map((header, index) => [header, cells[index] ?? '']));
    row.candidates = JSON.parse(row.alive_targets_at_switch_json || '[]');
    row.priorityPlan = JSON.parse(row.priority_order_plan_json || '[]');
    row.groupKey = `${row.experiment_block}|${row.comparison_key || `${row.archive_part}:${row.source_line}`}`;
    row.chosenIndex = row.candidates.findIndex((candidate) => candidate.name === row.current_target);
    row.actorRace = row.action_side === 'attacker' ? row.attacker_race : row.defender_race;
    row.targetRace = row.action_side === 'attacker' ? row.defender_race : row.attacker_race;
    return row;
  });
}

function canonicalClass(id) {
  if (!id) return null;
  if (id === 'death-star') return 'death-star';
  const entity = getCombatEntity(id);
  return entity.ordinaryClass ?? entity.id;
}

function buildNameIndex(faction) {
  const map = new Map();
  for (const item of Object.values(FACTION_SHIP_MECHANICS[faction])) {
    map.set(normalizeName(item.sourceName), { id: item.id, attack: item.combat.attack, population: item.population });
    try {
      const runtime = getFactionCombatEntity(faction, item.id);
      map.set(normalizeName(runtime.name), { id: item.id, attack: item.combat.attack, population: item.population });
    } catch {}
  }
  for (const item of DEFENSE_COMBAT_CATALOG) {
    const stats = FACTION_DEFENSE_CONSTRUCTION_BALANCE[faction][item.id];
    map.set(normalizeName(item.name), { id: item.id, attack: stats.combat.attack, population: stats.population });
    try {
      const runtime = getFactionCombatEntity(faction, item.id);
      map.set(normalizeName(runtime.name), { id: item.id, attack: stats.combat.attack, population: stats.population });
    } catch {}
  }
  for (const item of COMMANDER_COMBAT_CATALOG) {
    map.set(normalizeName(item.name), { id: item.id, attack: item.combat.attack, population: item.population });
  }
  return map;
}

const NAME_INDEX = Object.fromEntries(Object.values(RACE_TO_FACTION).map((faction) => [faction, buildNameIndex(faction)]));

function enrich(row) {
  const actorFaction = RACE_TO_FACTION[row.actorRace];
  const targetFaction = RACE_TO_FACTION[row.targetRace];
  const actor = actorFaction ? NAME_INDEX[actorFaction]?.get(normalizeName(row.actor_class)) : undefined;
  const previous = targetFaction ? NAME_INDEX[targetFaction]?.get(normalizeName(row.previous_target)) : undefined;
  const candidates = row.candidates.map((candidate, index) => {
    const resolved = targetFaction ? NAME_INDEX[targetFaction]?.get(normalizeName(candidate.name)) : undefined;
    return {
      ...candidate,
      index,
      resolved,
      targetClass: resolved ? canonicalClass(resolved.id) : null,
      threat: resolved ? Number(candidate.count) * resolved.attack : null,
    };
  });
  return {
    ...row,
    actorClass: actor ? canonicalClass(actor.id) : null,
    previousClass: previous ? canonicalClass(previous.id) : null,
    candidates,
  };
}

function hashPercent(value) {
  return Number.parseInt(createHash('sha256').update(value).digest('hex').slice(0, 8), 16) % 100;
}

function isHoldout(row) {
  return hashPercent(row.groupKey) >= 70;
}

function coreEligible(row) {
  return row.chosenIndex >= 0
    && CORE_SET.has(row.actorClass)
    && row.candidates.length > 0
    && row.candidates.every((candidate) => CORE_SET.has(candidate.targetClass));
}

function permutations(values) {
  if (values.length <= 1) return [values];
  const output = [];
  for (let i = 0; i < values.length; i += 1) {
    const head = values[i];
    const tail = [...values.slice(0, i), ...values.slice(i + 1)];
    for (const rest of permutations(tail)) output.push([head, ...rest]);
  }
  return output;
}

const CORE_PERMUTATIONS = permutations(CORE);

function pairKey(a, b) {
  return `${a}>${b}`;
}

function buildPairwise(rows) {
  const byActor = new Map();
  for (const row of rows.filter(coreEligible)) {
    const chosenClass = row.candidates[row.chosenIndex]?.targetClass;
    if (!chosenClass) continue;
    if (!byActor.has(row.actorClass)) byActor.set(row.actorClass, new Map());
    const wins = byActor.get(row.actorClass);
    for (const candidate of row.candidates) {
      if (!candidate.targetClass || candidate.targetClass === chosenClass) continue;
      const key = pairKey(chosenClass, candidate.targetClass);
      wins.set(key, (wins.get(key) ?? 0) + 1);
    }
  }
  return byActor;
}

function scoreOrder(order, wins) {
  const position = new Map(order.map((value, index) => [value, index]));
  let satisfied = 0;
  let violated = 0;
  for (const [key, count] of wins.entries()) {
    const [winner, loser] = key.split('>');
    if (position.get(winner) < position.get(loser)) satisfied += count;
    else violated += count;
  }
  return { satisfied, violated, net: satisfied - violated };
}

function inferOrders(discovery) {
  const pairwise = buildPairwise(discovery);
  const orders = {};
  const diagnostics = {};
  for (const actor of CORE) {
    const wins = pairwise.get(actor) ?? new Map();
    let best = null;
    for (const order of CORE_PERMUTATIONS) {
      const score = scoreOrder(order, wins);
      if (!best || score.violated < best.score.violated
        || (score.violated === best.score.violated && score.satisfied > best.score.satisfied)) {
        best = { order, score };
      }
    }
    orders[actor] = best?.order ?? CORE;
    const matrix = {};
    for (const left of CORE) {
      matrix[left] = {};
      for (const right of CORE) {
        if (left === right) continue;
        const forward = wins.get(pairKey(left, right)) ?? 0;
        const backward = wins.get(pairKey(right, left)) ?? 0;
        matrix[left][right] = { wins: forward, losses: backward, total: forward + backward };
      }
    }
    diagnostics[actor] = { order: orders[actor], score: best?.score ?? null, pairwise: matrix };
  }
  return { orders, diagnostics };
}

function selectByOrder(row, orderByActor, fallback = 'threat') {
  if (!coreEligible(row)) return null;
  const order = orderByActor[row.actorClass];
  if (!order) return null;
  for (const targetClass of order) {
    const matches = row.candidates
      .map((candidate, index) => ({ candidate, index }))
      .filter(({ candidate }) => candidate.targetClass === targetClass);
    if (!matches.length) continue;
    matches.sort((a, b) => {
      if (fallback === 'count') return Number(a.candidate.count) - Number(b.candidate.count);
      return Number(b.candidate.threat ?? -Infinity) - Number(a.candidate.threat ?? -Infinity);
    });
    return matches[0].index;
  }
  return null;
}

function metrics(rows, predictor) {
  let n = 0;
  let hit = 0;
  const misses = [];
  for (const row of rows) {
    const prediction = predictor(row);
    if (prediction === null || prediction === undefined) continue;
    n += 1;
    if (prediction === row.chosenIndex) hit += 1;
    else if (misses.length < 20) {
      misses.push({
        transition: row.transition_id,
        source: `${row.archive_part}:${row.source_line}`,
        case: row.case_id,
        round: Number(row.round),
        actor: row.actor_class,
        actorClass: row.actorClass,
        previous: row.previous_target,
        previousClass: row.previousClass,
        chosen: row.current_target,
        chosenClass: row.candidates[row.chosenIndex]?.targetClass,
        predicted: row.candidates[prediction]?.name,
        predictedClass: row.candidates[prediction]?.targetClass,
        candidates: row.candidates.map((candidate) => `${candidate.name}/${candidate.targetClass}:${candidate.count}`),
      });
    }
  }
  return { n, hit, misses: n - hit, accuracy: n ? hit / n : null, examples: misses };
}

function forwardCycleOrders() {
  const orders = {};
  for (const actor of CORE) {
    const order = [];
    let current = PRIMARY[actor];
    for (let i = 0; i < CORE.length; i += 1) {
      if (!current || order.includes(current)) break;
      order.push(current);
      current = PRIMARY[current];
    }
    orders[actor] = order;
  }
  return orders;
}

function reversePrimary() {
  return Object.fromEntries(Object.entries(PRIMARY).map(([source, target]) => [target, source]));
}

function reverseCycleOrders() {
  const reverse = reversePrimary();
  const orders = {};
  for (const actor of CORE) {
    const order = [];
    let current = PRIMARY[actor];
    for (let i = 0; i < CORE.length; i += 1) {
      if (!current || order.includes(current)) break;
      order.push(current);
      current = reverse[current];
    }
    orders[actor] = order;
  }
  return orders;
}

function planLastLegal(row) {
  if (!row.priorityPlan.length) return null;
  const legal = new Map(row.candidates.map((candidate, index) => [normalizeName(candidate.name), index]));
  for (const name of [...row.priorityPlan].reverse()) {
    const index = legal.get(normalizeName(name));
    if (index !== undefined) return index;
  }
  return null;
}

function summarizeControlledPlans(rows) {
  const groups = new Map();
  for (const row of rows) {
    const key = `${row.actor_class}|${JSON.stringify(row.priorityPlan)}`;
    if (!groups.has(key)) groups.set(key, { actor: row.actor_class, actorClass: row.actorClass, plan: row.priorityPlan, n: 0, lastLegalHits: 0 });
    const item = groups.get(key);
    item.n += 1;
    if (planLastLegal(row) === row.chosenIndex) item.lastLegalHits += 1;
  }
  return [...groups.values()].sort((a, b) => b.n - a.n);
}

function topTargetClassCounts(rows) {
  const result = {};
  for (const row of rows.filter(coreEligible)) {
    const actor = row.actorClass;
    const chosen = row.candidates[row.chosenIndex]?.targetClass;
    result[actor] ??= {};
    result[actor][chosen] = (result[actor][chosen] ?? 0) + 1;
  }
  return result;
}

function clean(value) {
  if (Array.isArray(value)) return value.map(clean);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clean(item)]));
  if (typeof value === 'number' && Number.isFinite(value)) return Number(value.toFixed(6));
  return value;
}

export function runTargetPriorityRankingAudit() {
  const rows = readCsv().map(enrich);
  const usable = rows.filter((row) => row.chosenIndex >= 0 && row.candidates.length > 0);
  const controlled = usable.filter((row) => row.experiment_block === 'target_priority');
  const nonControlled = usable.filter((row) => row.experiment_block !== 'target_priority');
  const discovery = nonControlled.filter((row) => !isHoldout(row));
  const holdout = nonControlled.filter(isHoldout);

  const inferred = inferOrders(discovery);
  const forward = forwardCycleOrders();
  const reverse = reverseCycleOrders();

  return clean({
    generatedBy: 'tools/audit-nemexia-target-priority-ranking.mjs',
    coreClasses: CORE,
    coverage: {
      discoveryAll: discovery.length,
      discoveryCoreOnly: discovery.filter(coreEligible).length,
      holdoutAll: holdout.length,
      holdoutCoreOnly: holdout.filter(coreEligible).length,
      controlledAll: controlled.length,
      controlledCoreOnly: controlled.filter(coreEligible).length,
    },
    inferredOrdersFromDiscovery: inferred.orders,
    inferredPairwiseDiagnostics: inferred.diagnostics,
    primaryForwardCycleOrders: forward,
    primaryReverseCycleOrders: reverse,
    holdout: {
      inferredThreatFallback: metrics(holdout, (row) => selectByOrder(row, inferred.orders, 'threat')),
      inferredCountFallback: metrics(holdout, (row) => selectByOrder(row, inferred.orders, 'count')),
      primaryForwardCycle: metrics(holdout, (row) => selectByOrder(row, forward, 'threat')),
      primaryReverseCycle: metrics(holdout, (row) => selectByOrder(row, reverse, 'threat')),
    },
    discoverySanity: {
      inferredThreatFallback: metrics(discovery, (row) => selectByOrder(row, inferred.orders, 'threat')),
      primaryForwardCycle: metrics(discovery, (row) => selectByOrder(row, forward, 'threat')),
    },
    controlled: {
      inferredThreatFallback: metrics(controlled, (row) => selectByOrder(row, inferred.orders, 'threat')),
      primaryForwardCycle: metrics(controlled, (row) => selectByOrder(row, forward, 'threat')),
      plannedLastLegal: metrics(controlled, planLastLegal),
      planGroups: summarizeControlledPlans(controlled),
    },
    holdoutChosenTargetClassCounts: topTargetClassCounts(holdout),
  });
}

if (import.meta.url === `file://${process.argv[1]?.replaceAll('\\', '/')}` || process.argv[1]?.endsWith('audit-nemexia-target-priority-ranking.mjs')) {
  console.log(JSON.stringify(runTargetPriorityRankingAudit(), null, 2));
}
