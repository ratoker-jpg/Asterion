import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { FACTION_SHIP_MECHANICS } from '../src/domain/combat/faction-ship-data.ts';
import { FACTION_DEFENSE_CONSTRUCTION_BALANCE } from '../src/domain/combat/defense-construction-data.ts';
import {
  COMBAT_CATALOG,
  DEFENSE_COMBAT_CATALOG,
  COMMANDER_COMBAT_CATALOG,
  getCombatEntity,
} from '../src/domain/combat/catalog.ts';
import { getFactionCombatEntity } from '../src/domain/combat/faction-catalog.ts';

const ROOT = 'docs/evidence/nemexia-target-priority-corpus';
const CSV_PATH = `${ROOT}/target-transitions.csv`;
const RACE_TO_FACTION = { '1': 'aegis', '2': 'synod', '3': 'veyra' };
const PRIMARY = {
  scout: 'defender',
  cruiser: 'scout',
  defender: 'bomber',
  battleship: 'cruiser',
  destroyer: 'battleship',
  bomber: 'destroyer',
  'death-star': 'death-star',
};
const CATALOG_ORDER = new Map(COMBAT_CATALOG.map((entry, index) => [entry.id, index]));

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

function readCsv() {
  const lines = readFileSync(CSV_PATH, 'utf8').replace(/^\uFEFF/, '').split(/\r?\n/).filter(Boolean);
  const headers = parseCsvLine(lines[0] ?? '');
  return lines.slice(1).map((line) => {
    const cells = parseCsvLine(line);
    const row = Object.fromEntries(headers.map((header, index) => [header, cells[index] ?? '']));
    row.candidates = JSON.parse(row.alive_targets_at_switch_json || '[]');
    row.roundSnapshot = JSON.parse(row.round_target_order_snapshot_json || '[]');
    row.priorityPlan = JSON.parse(row.priority_order_plan_json || '[]');
    row.reportKey = `${row.archive_part}:${row.source_line}`;
    row.groupKey = `${row.experiment_block}|${row.comparison_key || row.reportKey}`;
    row.isVerified = String(row.analysis_verified).toLowerCase() === 'true';
    row.chosenIndex = row.candidates.findIndex((candidate) => candidate.name === row.current_target);
    row.actorRace = row.action_side === 'attacker' ? row.attacker_race : row.defender_race;
    row.targetRace = row.action_side === 'attacker' ? row.defender_race : row.attacker_race;
    return row;
  });
}

function normalizeName(value) {
  return String(value ?? '').trim().toLowerCase().replaceAll('ё', 'е').replace(/\s+/g, ' ');
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
    map.set(normalizeName(item.sourceName), {
      id: item.id,
      kind: 'ship',
      population: item.population,
      attack: item.combat.attack,
    });
    try {
      const runtime = getFactionCombatEntity(faction, item.id);
      map.set(normalizeName(runtime.name), {
        id: item.id,
        kind: 'ship',
        population: item.population,
        attack: item.combat.attack,
      });
    } catch {}
  }
  for (const item of DEFENSE_COMBAT_CATALOG) {
    const stats = FACTION_DEFENSE_CONSTRUCTION_BALANCE[faction][item.id];
    map.set(normalizeName(item.name), {
      id: item.id,
      kind: 'defense',
      population: stats.population,
      attack: stats.combat.attack,
    });
    try {
      const runtime = getFactionCombatEntity(faction, item.id);
      map.set(normalizeName(runtime.name), {
        id: item.id,
        kind: 'defense',
        population: stats.population,
        attack: stats.combat.attack,
      });
    } catch {}
  }
  for (const item of COMMANDER_COMBAT_CATALOG) {
    map.set(normalizeName(item.name), {
      id: item.id,
      kind: 'commander',
      population: item.population,
      attack: item.combat.attack,
    });
  }
  return map;
}

const NAME_INDEX = Object.fromEntries(
  Object.values(RACE_TO_FACTION).map((faction) => [faction, buildNameIndex(faction)]),
);

function addRelativeOrder(row, candidates) {
  const previousOrder = Number(row.previous_target_order_in_report);
  const seenOrders = [
    previousOrder,
    ...candidates.map((candidate) => Number(candidate.order)),
    ...row.roundSnapshot.map((candidate) => Number(candidate.order)),
  ].filter(Number.isFinite);
  const size = seenOrders.length ? Math.max(...seenOrders) + 1 : 0;
  if (!Number.isFinite(previousOrder) || size <= 1) return candidates;

  const forwardSorted = [...candidates]
    .map((candidate, index) => ({
      index,
      distance: ((Number(candidate.order) - previousOrder) % size + size) % size || size,
    }))
    .sort((a, b) => a.distance - b.distance || Number(candidates[a.index].order) - Number(candidates[b.index].order));
  const backwardSorted = [...candidates]
    .map((candidate, index) => ({
      index,
      distance: ((previousOrder - Number(candidate.order)) % size + size) % size || size,
    }))
    .sort((a, b) => a.distance - b.distance || Number(candidates[a.index].order) - Number(candidates[b.index].order));

  const forwardRank = new Map(forwardSorted.map((entry, index) => [entry.index, index + 1]));
  const backwardRank = new Map(backwardSorted.map((entry, index) => [entry.index, index + 1]));
  return candidates.map((candidate, index) => ({
    ...candidate,
    forwardRank: forwardRank.get(index) ?? null,
    backwardRank: backwardRank.get(index) ?? null,
  }));
}

function enrichRow(row) {
  const actorFaction = RACE_TO_FACTION[row.actorRace];
  const targetFaction = RACE_TO_FACTION[row.targetRace];
  const actorResolved = actorFaction ? NAME_INDEX[actorFaction]?.get(normalizeName(row.actor_class)) : undefined;
  const previousResolved = targetFaction ? NAME_INDEX[targetFaction]?.get(normalizeName(row.previous_target)) : undefined;
  let candidates = row.candidates.map((candidate, index) => {
    const resolved = targetFaction ? NAME_INDEX[targetFaction]?.get(normalizeName(candidate.name)) : undefined;
    return {
      ...candidate,
      index,
      resolved,
      targetClass: resolved ? canonicalClass(resolved.id) : null,
      threat: resolved ? Number(candidate.count) * resolved.attack : null,
      totalPopulation: resolved ? Number(candidate.count) * resolved.population : null,
    };
  });
  candidates = addRelativeOrder(row, candidates);
  return {
    ...row,
    actorFaction,
    targetFaction,
    actorResolved,
    previousResolved,
    actorClass: actorResolved ? canonicalClass(actorResolved.id) : null,
    previousClass: previousResolved ? canonicalClass(previousResolved.id) : null,
    candidates,
  };
}

function hashPercent(value) {
  return Number.parseInt(createHash('sha256').update(value).digest('hex').slice(0, 8), 16) % 100;
}

function isHoldout(row) {
  return hashPercent(row.groupKey) >= 70;
}

function isTune(row) {
  return hashPercent(`stage2|${row.groupKey}`) >= 75;
}

function softmax(scores) {
  const max = Math.max(...scores);
  const weights = scores.map((score) => Math.exp(Math.max(-60, Math.min(60, score - max))));
  const total = weights.reduce((sum, value) => sum + value, 0);
  return weights.map((value) => value / total);
}

function topIndex(row, probabilities) {
  let best = 0;
  for (let i = 1; i < probabilities.length; i += 1) {
    if (probabilities[i] > probabilities[best] + 1e-12) best = i;
    else if (Math.abs(probabilities[i] - probabilities[best]) <= 1e-12
      && Number(row.candidates[i]?.order ?? Infinity) < Number(row.candidates[best]?.order ?? Infinity)) best = i;
  }
  return best;
}

function dot(weights, features) {
  let sum = 0;
  for (const [key, value] of features) sum += (weights.get(key) ?? 0) * value;
  return sum;
}

function featureList(row, candidate, spec) {
  const features = [];
  if (spec.count) features.push(['N:count', Math.log(Math.max(1, Number(candidate.count)))]);
  if (spec.threat) features.push(['N:threat', Math.log(Math.max(1, Number(candidate.threat)))]);
  if (spec.targetClass) features.push([`T:${candidate.targetClass}`, 1]);
  if (spec.actorTarget) features.push([`AT:${row.actorClass}>${candidate.targetClass}`, 1]);
  if (spec.previousTarget) features.push([`PT:${row.previousClass}>${candidate.targetClass}`, 1]);
  if (spec.actorPreviousTarget) {
    features.push([`APT:${row.actorClass}|${row.previousClass}>${candidate.targetClass}`, 1]);
  }
  if (spec.forwardRank) features.push([`FR:${Math.min(8, Number(candidate.forwardRank ?? 8))}`, 1]);
  if (spec.backwardRank) features.push([`BR:${Math.min(8, Number(candidate.backwardRank ?? 8))}`, 1]);
  return features;
}

function eligibleForSpec(row, spec) {
  if (row.chosenIndex < 0 || !row.candidates.length) return false;
  if ((spec.actorTarget || spec.actorPreviousTarget) && !row.actorClass) return false;
  if ((spec.previousTarget || spec.actorPreviousTarget) && !row.previousClass) return false;
  if ((spec.targetClass || spec.actorTarget || spec.previousTarget || spec.actorPreviousTarget)
    && row.candidates.some((candidate) => !candidate.targetClass)) return false;
  if (spec.threat && row.candidates.some((candidate) => !Number.isFinite(candidate.threat))) return false;
  if ((spec.forwardRank || spec.backwardRank)
    && row.candidates.some((candidate) => !Number.isFinite(candidate.forwardRank) || !Number.isFinite(candidate.backwardRank))) return false;
  return true;
}

function trainConditionalLogit(rows, spec, lambda, epochs = 110, learningRate = 0.035) {
  const usable = rows.filter((row) => eligibleForSpec(row, spec));
  const weights = new Map();
  const firstMoment = new Map();
  const secondMoment = new Map();
  let step = 0;

  for (let epoch = 0; epoch < epochs; epoch += 1) {
    const gradient = new Map();
    for (const row of usable) {
      const allFeatures = row.candidates.map((candidate) => featureList(row, candidate, spec));
      const probs = softmax(allFeatures.map((features) => dot(weights, features)));
      for (let index = 0; index < row.candidates.length; index += 1) {
        const coefficient = (index === row.chosenIndex ? 1 : 0) - probs[index];
        for (const [key, value] of allFeatures[index]) {
          gradient.set(key, (gradient.get(key) ?? 0) + coefficient * value);
        }
      }
    }

    const keys = new Set([...weights.keys(), ...gradient.keys()]);
    step += 1;
    for (const key of keys) {
      const current = weights.get(key) ?? 0;
      const grad = (gradient.get(key) ?? 0) / Math.max(1, usable.length) - lambda * current;
      const m = 0.9 * (firstMoment.get(key) ?? 0) + 0.1 * grad;
      const v = 0.999 * (secondMoment.get(key) ?? 0) + 0.001 * grad * grad;
      firstMoment.set(key, m);
      secondMoment.set(key, v);
      const mHat = m / (1 - Math.pow(0.9, step));
      const vHat = v / (1 - Math.pow(0.999, step));
      weights.set(key, current + learningRate * mHat / (Math.sqrt(vHat) + 1e-8));
    }
  }
  return { weights, n: usable.length };
}

function probabilityFunction(model, spec) {
  return (row) => {
    if (!eligibleForSpec(row, spec)) return null;
    return softmax(row.candidates.map((candidate) => dot(model.weights, featureList(row, candidate, spec))));
  };
}

function metrics(rows, probabilityFn) {
  let n = 0;
  let hits = 0;
  let loss = 0;
  for (const row of rows) {
    const probabilities = probabilityFn(row);
    if (!probabilities) continue;
    const p = probabilities[row.chosenIndex];
    if (!(p > 0)) continue;
    n += 1;
    loss -= Math.log(p);
    if (topIndex(row, probabilities) === row.chosenIndex) hits += 1;
  }
  return {
    n,
    hit: hits,
    accuracy: n ? hits / n : null,
    logLoss: n ? loss / n : null,
  };
}

function deterministicMetrics(rows, predictor) {
  let n = 0;
  let hit = 0;
  for (const row of rows) {
    const predicted = predictor(row);
    if (predicted === null || predicted === undefined) continue;
    n += 1;
    if (predicted === row.chosenIndex) hit += 1;
  }
  return { n, hit, accuracy: n ? hit / n : null };
}

function currentAsterionIndex(row) {
  if (!row.actorResolved || row.candidates.some((candidate) => !candidate.resolved)) return null;
  const actorClass = canonicalClass(row.actorResolved.id);
  let pool = row.candidates.map((candidate, index) => ({ candidate, index }));
  const preferred = actorClass ? PRIMARY[actorClass] : undefined;
  if (preferred) {
    const preferredPool = pool.filter(({ candidate }) => candidate.targetClass === preferred);
    if (preferredPool.length) pool = preferredPool;
  }
  const tier = (candidate) => {
    const entity = getCombatEntity(candidate.resolved.id);
    if (entity.kind === 'commander') return 2;
    if (entity.kind === 'ship' && entity.category !== 'Боевой корабль') return 1;
    return 0;
  };
  pool.sort((a, b) => {
    const td = tier(a.candidate) - tier(b.candidate);
    if (td) return td;
    const threatDelta = b.candidate.threat - a.candidate.threat;
    if (threatDelta) return threatDelta;
    const populationDelta = b.candidate.totalPopulation - a.candidate.totalPopulation;
    if (populationDelta) return populationDelta;
    const catalogDelta = (CATALOG_ORDER.get(a.candidate.resolved.id) ?? Number.MAX_SAFE_INTEGER)
      - (CATALOG_ORDER.get(b.candidate.resolved.id) ?? Number.MAX_SAFE_INTEGER);
    if (catalogDelta) return catalogDelta;
    return String(a.candidate.resolved.id).localeCompare(String(b.candidate.resolved.id));
  });
  return pool[0]?.index ?? null;
}

function cyclicSuccessor(row, direction) {
  if (!row.candidates.length) return null;
  const key = direction === 'forward' ? 'forwardRank' : 'backwardRank';
  let best = null;
  for (let i = 0; i < row.candidates.length; i += 1) {
    const value = Number(row.candidates[i]?.[key]);
    if (!Number.isFinite(value)) return null;
    if (best === null || value < Number(row.candidates[best]?.[key])) best = i;
  }
  return best;
}

function planLegalIndex(row, direction = 'first') {
  if (!row.priorityPlan.length) return null;
  const legal = new Map(row.candidates.map((candidate, index) => [normalizeName(candidate.name), index]));
  const plan = direction === 'first' ? row.priorityPlan : [...row.priorityPlan].reverse();
  for (const name of plan) {
    const index = legal.get(normalizeName(name));
    if (index !== undefined) return index;
  }
  return null;
}

function bootstrapByReport(rows, metricFn, repetitions = 250) {
  const groups = [...Map.groupBy(rows, (row) => row.reportKey).values()];
  if (!groups.length) return null;
  let state = 0x9e3779b9;
  const random = () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state / 4294967296;
  };
  const values = [];
  for (let rep = 0; rep < repetitions; rep += 1) {
    const sample = [];
    for (let i = 0; i < groups.length; i += 1) sample.push(...groups[Math.floor(random() * groups.length)]);
    const value = metricFn(sample);
    if (Number.isFinite(value)) values.push(value);
  }
  values.sort((a, b) => a - b);
  const pick = (p) => values[Math.max(0, Math.min(values.length - 1, Math.floor((values.length - 1) * p)))];
  return values.length ? [pick(0.025), pick(0.975)] : null;
}

function summarizeActorClasses(rows, probabilityFn) {
  return Object.fromEntries(
    [...Map.groupBy(rows, (row) => row.actorClass ?? row.actor_class).entries()]
      .map(([key, group]) => [key, metrics(group, probabilityFn)])
      .filter(([, metric]) => metric.n >= 20)
      .sort((a, b) => b[1].n - a[1].n)
      .slice(0, 20),
  );
}

function cleanNumber(value) {
  if (Array.isArray(value)) return value.map(cleanNumber);
  if (value && typeof value === 'object') return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, cleanNumber(item)]),
  );
  if (typeof value === 'number' && Number.isFinite(value)) return Number(value.toFixed(6));
  return value;
}

export function runStage2TargetPriorityAudit() {
  const rows = readCsv().map(enrichRow);
  const usable = rows.filter((row) => row.chosenIndex >= 0 && row.candidates.length > 0);
  const controlled = usable.filter((row) => row.experiment_block === 'target_priority');
  const nonControlled = usable.filter((row) => row.experiment_block !== 'target_priority');
  const discovery = nonControlled.filter((row) => !isHoldout(row));
  const holdout = nonControlled.filter(isHoldout);
  const fitRows = discovery.filter((row) => !isTune(row));
  const tuneRows = discovery.filter(isTune);

  const fitGroups = new Set(fitRows.map((row) => row.groupKey));
  const tuneGroups = new Set(tuneRows.map((row) => row.groupKey));
  const holdoutGroups = new Set(holdout.map((row) => row.groupKey));

  const specs = {
    countOnly: { count: true },
    threatOnly: { threat: true },
    countActorTarget: { count: true, targetClass: true, actorTarget: true },
    countPreviousTarget: { count: true, targetClass: true, previousTarget: true },
    countActorAndPrevious: {
      count: true, targetClass: true, actorTarget: true, previousTarget: true,
    },
    countActorPreviousInteraction: {
      count: true,
      targetClass: true,
      actorTarget: true,
      previousTarget: true,
      actorPreviousTarget: true,
    },
    countActorPreviousForwardRank: {
      count: true,
      targetClass: true,
      actorTarget: true,
      previousTarget: true,
      forwardRank: true,
    },
    threatActorPreviousForwardRank: {
      threat: true,
      targetClass: true,
      actorTarget: true,
      previousTarget: true,
      forwardRank: true,
    },
  };

  const lambdas = [0.01, 0.05, 0.15, 0.5];
  const tuned = {};
  const finalModels = {};
  const holdoutModels = {};
  const controlledModels = {};

  for (const [name, spec] of Object.entries(specs)) {
    let best = null;
    for (const lambda of lambdas) {
      const model = trainConditionalLogit(fitRows, spec, lambda, 90, 0.035);
      const probabilityFn = probabilityFunction(model, spec);
      const tune = metrics(tuneRows, probabilityFn);
      const candidate = { lambda, trainN: model.n, tune };
      if (!best || (tune.logLoss ?? Infinity) < (best.tune.logLoss ?? Infinity)) best = candidate;
    }
    tuned[name] = best;
    const finalModel = trainConditionalLogit(discovery, spec, best.lambda, 120, 0.03);
    finalModels[name] = { model: finalModel, spec };
    const probabilityFn = probabilityFunction(finalModel, spec);
    holdoutModels[name] = metrics(holdout, probabilityFn);
    controlledModels[name] = metrics(controlled, probabilityFn);
  }

  const ranked = Object.entries(holdoutModels)
    .filter(([, metric]) => metric.n > 0)
    .sort((a, b) => (a[1].logLoss ?? Infinity) - (b[1].logLoss ?? Infinity));
  const bestName = ranked[0]?.[0] ?? null;
  const bestEntry = bestName ? finalModels[bestName] : null;
  const bestProb = bestEntry ? probabilityFunction(bestEntry.model, bestEntry.spec) : null;

  const currentStatic = deterministicMetrics(holdout, currentAsterionIndex);
  const currentControlled = deterministicMetrics(controlled, currentAsterionIndex);
  const cyclicForward = deterministicMetrics(holdout, (row) => cyclicSuccessor(row, 'forward'));
  const cyclicBackward = deterministicMetrics(holdout, (row) => cyclicSuccessor(row, 'backward'));
  const controlledPlanFirst = deterministicMetrics(controlled, (row) => planLegalIndex(row, 'first'));
  const controlledPlanLast = deterministicMetrics(controlled, (row) => planLegalIndex(row, 'last'));

  const bestCi = bestProb ? {
    accuracy95: bootstrapByReport(
      holdout,
      (sample) => metrics(sample, bestProb).accuracy,
    ),
    logLoss95: bootstrapByReport(
      holdout,
      (sample) => metrics(sample, bestProb).logLoss,
    ),
  } : null;

  const staticCi = {
    accuracy95: bootstrapByReport(
      holdout,
      (sample) => deterministicMetrics(sample, currentAsterionIndex).accuracy,
    ),
  };

  const chosenForwardRankHistogram = {};
  for (const row of holdout) {
    const rank = row.candidates[row.chosenIndex]?.forwardRank;
    if (Number.isFinite(rank)) chosenForwardRankHistogram[rank] = (chosenForwardRankHistogram[rank] ?? 0) + 1;
  }

  return cleanNumber({
    generatedBy: 'tools/audit-nemexia-target-priority-stage2.mjs',
    design: {
      discoveryTransitions: discovery.length,
      fitTransitions: fitRows.length,
      tuneTransitions: tuneRows.length,
      holdoutTransitions: holdout.length,
      controlledTransitions: controlled.length,
      fitTuneGroupOverlap: [...fitGroups].filter((key) => tuneGroups.has(key)).length,
      discoveryHoldoutGroupOverlap: [...new Set(discovery.map((row) => row.groupKey))]
        .filter((key) => holdoutGroups.has(key)).length,
      note: 'feature families and lambda are selected only on discovery fit/tune; holdout is evaluated after tuning',
    },
    tunedOnDiscovery: tuned,
    holdoutModels,
    holdoutBenchmarks: {
      currentAsterionStatic: currentStatic,
      cyclicForwardSuccessor: cyclicForward,
      cyclicBackwardSuccessor: cyclicBackward,
    },
    bestHoldoutModel: bestName,
    bestHoldoutBootstrap95: bestCi,
    currentAsterionBootstrap95: staticCi,
    bestHoldoutActorClassStrata: bestProb ? summarizeActorClasses(holdout, bestProb) : {},
    controlledModels,
    controlledBenchmarks: {
      currentAsterionStatic: currentControlled,
      plannedFirstLegal: controlledPlanFirst,
      plannedLastLegal: controlledPlanLast,
    },
    chosenForwardRankHistogram,
  });
}

if (
  import.meta.url === `file://${process.argv[1]?.replaceAll('\\', '/')}`
  || process.argv[1]?.endsWith('audit-nemexia-target-priority-stage2.mjs')
) {
  console.log(JSON.stringify(runStage2TargetPriorityAudit(), null, 2));
}
