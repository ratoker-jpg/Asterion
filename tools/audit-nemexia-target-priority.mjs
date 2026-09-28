import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { FACTION_SHIP_MECHANICS } from '../src/domain/combat/faction-ship-data.ts';
import { FACTION_DEFENSE_CONSTRUCTION_BALANCE } from '../src/domain/combat/defense-construction-data.ts';
import { COMBAT_CATALOG, DEFENSE_COMBAT_CATALOG, COMMANDER_COMBAT_CATALOG, getCombatEntity } from '../src/domain/combat/catalog.ts';
import { getFactionCombatEntity } from '../src/domain/combat/faction-catalog.ts';

const ROOT = 'docs/evidence/nemexia-target-priority-corpus';
const CSV_PATH = `${ROOT}/target-transitions.csv`;
const BATTLE_FILES = ['battles-2026-09-15.jsonl', 'battles-2026-09-16.jsonl'];
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
const MATCHUP = {
  scout: { scout: .7, cruiser: 1, defender: 1.7, battleship: 1.7, destroyer: 1, bomber: 1, 'death-star': .7 },
  cruiser: { scout: 1.7, cruiser: .7, defender: 1.7, battleship: .7, destroyer: 1, bomber: 1, 'death-star': 1 },
  defender: { scout: .7, cruiser: 1, defender: .7, battleship: 1, destroyer: 1, bomber: 1.7, 'death-star': 1.7 },
  battleship: { scout: 1, cruiser: 1.7, defender: 1.7, battleship: .7, destroyer: .7, bomber: 1, 'death-star': 1 },
  destroyer: { scout: 1, cruiser: 1, defender: 1, battleship: 1.7, destroyer: .7, bomber: .7, 'death-star': 1.7 },
  bomber: { scout: 1, cruiser: .7, defender: 1, battleship: 1, destroyer: 1.7, bomber: .7, 'death-star': 1.7 },
  'death-star': { scout: 1, cruiser: 1.7, defender: .7, battleship: 1, destroyer: 1, bomber: 1, 'death-star': 1.7 },
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

function readReports() {
  const byLocator = new Map();
  const counts = { rows: 0, errors: 0, clean: 0, verifiedClean: 0, olderClean: 0, nonEmptyAnalysisText: 0 };
  for (const file of BATTLE_FILES) {
    const lines = readFileSync(`${ROOT}/${file}`, 'utf8').split(/\r?\n/).filter(Boolean);
    lines.forEach((line, index) => {
      const row = JSON.parse(line);
      const hasError = typeof row.error === 'string' && row.error.trim() !== '';
      counts.rows += 1;
      if (hasError) counts.errors += 1;
      else {
        counts.clean += 1;
        if (row.analysis_verified === true) counts.verifiedClean += 1;
        else counts.olderClean += 1;
        if (typeof row.analysis_text === 'string' && row.analysis_text.trim()) counts.nonEmptyAnalysisText += 1;
      }
      byLocator.set(`${file}:${index + 1}`, {
        run_id: row.run_id,
        case_id: row.case_id,
        hasError,
        analysis_verified: row.analysis_verified === true,
        analysis_text: typeof row.analysis_text === 'string' ? row.analysis_text : '',
      });
    });
  }
  return { byLocator, counts };
}

function normalizeName(value) {
  return String(value ?? '').trim().toLowerCase().replaceAll('ё', 'е').replace(/\s+/g, ' ');
}

function matchupClass(id) {
  if (id === 'death-star') return 'death-star';
  return getCombatEntity(id).ordinaryClass;
}

function buildNameIndex(faction) {
  const map = new Map();
  for (const item of Object.values(FACTION_SHIP_MECHANICS[faction])) {
    map.set(normalizeName(item.sourceName), { id: item.id, kind: 'ship', population: item.population, attack: item.combat.attack });
    try {
      const runtime = getFactionCombatEntity(faction, item.id);
      map.set(normalizeName(runtime.name), { id: item.id, kind: 'ship', population: item.population, attack: item.combat.attack });
    } catch {}
  }
  for (const item of DEFENSE_COMBAT_CATALOG) {
    const stats = FACTION_DEFENSE_CONSTRUCTION_BALANCE[faction][item.id];
    map.set(normalizeName(item.name), { id: item.id, kind: 'defense', population: stats.population, attack: stats.combat.attack });
    try {
      const runtime = getFactionCombatEntity(faction, item.id);
      map.set(normalizeName(runtime.name), { id: item.id, kind: 'defense', population: stats.population, attack: stats.combat.attack });
    } catch {}
  }
  for (const item of COMMANDER_COMBAT_CATALOG) {
    map.set(normalizeName(item.name), { id: item.id, kind: 'commander', population: item.population, attack: item.combat.attack });
  }
  return map;
}

const NAME_INDEX = Object.fromEntries(Object.values(RACE_TO_FACTION).map((faction) => [faction, buildNameIndex(faction)]));

function enrichRow(row) {
  const actorFaction = RACE_TO_FACTION[row.actorRace];
  const targetFaction = RACE_TO_FACTION[row.targetRace];
  const actor = actorFaction ? NAME_INDEX[actorFaction]?.get(normalizeName(row.actor_class)) : undefined;
  const candidates = row.candidates.map((candidate, index) => {
    const resolved = targetFaction ? NAME_INDEX[targetFaction]?.get(normalizeName(candidate.name)) : undefined;
    return {
      ...candidate,
      index,
      resolved,
      totalPopulation: resolved ? candidate.count * resolved.population : null,
      threat: resolved ? candidate.count * resolved.attack : null,
      matchup: actor?.id && resolved?.id && matchupClass(actor.id) && matchupClass(resolved.id)
        ? MATCHUP[matchupClass(actor.id)]?.[matchupClass(resolved.id)] ?? 1
        : 1,
      preferred: Boolean(actor?.id && resolved?.id && PRIMARY[matchupClass(actor.id)] === matchupClass(resolved.id)),
    };
  });
  return { ...row, actorResolved: actor, actorFaction, targetFaction, candidates };
}

function hashPercent(value) {
  return Number.parseInt(createHash('sha256').update(value).digest('hex').slice(0, 8), 16) % 100;
}

function isHoldout(row) {
  return hashPercent(row.groupKey) >= 70;
}

function scoreSoftmax(candidates, scoreFn) {
  const scores = candidates.map(scoreFn);
  const max = Math.max(...scores);
  const weights = scores.map((score) => Math.exp(score - max));
  const total = weights.reduce((sum, value) => sum + value, 0);
  return weights.map((value) => value / total);
}

function topIndexFromProbabilities(row, probabilities) {
  let best = 0;
  for (let i = 1; i < probabilities.length; i += 1) {
    if (probabilities[i] > probabilities[best] + 1e-12) best = i;
    else if (Math.abs(probabilities[i] - probabilities[best]) <= 1e-12) {
      if ((row.candidates[i]?.order ?? Infinity) < (row.candidates[best]?.order ?? Infinity)) best = i;
    }
  }
  return best;
}

function deterministicIndex(row, key, direction = 'min') {
  let best = 0;
  for (let i = 1; i < row.candidates.length; i += 1) {
    const left = row.candidates[i]?.[key];
    const right = row.candidates[best]?.[key];
    if (left === null || left === undefined || right === null || right === undefined) return null;
    const better = direction === 'min' ? left < right : left > right;
    if (better || (left === right && (row.candidates[i]?.order ?? Infinity) < (row.candidates[best]?.order ?? Infinity))) best = i;
  }
  return best;
}

function currentAsterionIndex(row) {
  if (!row.actorResolved || row.candidates.some((candidate) => !candidate.resolved)) return null;
  const actorClass = matchupClass(row.actorResolved.id);
  let pool = row.candidates.map((candidate, index) => ({ candidate, index }));
  const preferred = actorClass ? PRIMARY[actorClass] : undefined;
  if (preferred) {
    const preferredPool = pool.filter(({ candidate }) => matchupClass(candidate.resolved.id) === preferred);
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

function meanLoss(rows, probabilityFn) {
  let total = 0;
  for (const row of rows) {
    const probs = probabilityFn(row);
    const p = probs?.[row.chosenIndex] ?? 0;
    if (!(p > 0)) return Infinity;
    total -= Math.log(p);
  }
  return rows.length ? total / rows.length : null;
}

function accuracy(rows, predictor) {
  let hit = 0;
  let eligible = 0;
  for (const row of rows) {
    const predicted = predictor(row);
    if (predicted === null || predicted === undefined) continue;
    eligible += 1;
    if (predicted === row.chosenIndex) hit += 1;
  }
  return { hit, eligible, accuracy: eligible ? hit / eligible : null };
}

function fitOne(rows, feature, min, max, step) {
  let best = { beta: 0, loss: Infinity };
  for (let beta = min; beta <= max + 1e-9; beta += step) {
    const loss = meanLoss(rows, (row) => scoreSoftmax(row.candidates, (candidate) => beta * feature(candidate, row)));
    if (loss < best.loss) best = { beta: Number(beta.toFixed(6)), loss };
  }
  return best;
}

function fitTwo(rows, featureA, featureB) {
  let a = fitOne(rows, featureA, -4, 4, .05).beta;
  let b = 0;
  let bestLoss = Infinity;
  for (let pass = 0; pass < 4; pass += 1) {
    let bestB = b;
    for (let candidateB = -3; candidateB <= 3 + 1e-9; candidateB += .05) {
      const loss = meanLoss(rows, (row) => scoreSoftmax(row.candidates, (candidate) => a * featureA(candidate, row) + candidateB * featureB(candidate, row)));
      if (loss < bestLoss) { bestLoss = loss; bestB = candidateB; }
    }
    b = bestB;
    let bestA = a;
    for (let candidateA = -4; candidateA <= 4 + 1e-9; candidateA += .05) {
      const loss = meanLoss(rows, (row) => scoreSoftmax(row.candidates, (candidate) => candidateA * featureA(candidate, row) + b * featureB(candidate, row)));
      if (loss < bestLoss) { bestLoss = loss; bestA = candidateA; }
    }
    a = bestA;
  }
  return { a: Number(a.toFixed(4)), b: Number(b.toFixed(4)), loss: bestLoss };
}

function modelMetrics(rows, probabilityFn, predictor) {
  const eligibleRows = rows.filter((row) => row.chosenIndex >= 0 && row.candidates.length > 0 && probabilityFn(row) !== null && predictor(row) !== null);
  const acc = accuracy(eligibleRows, predictor);
  return { n: eligibleRows.length, logLoss: meanLoss(eligibleRows, probabilityFn), ...acc };
}

function deterministicMetrics(rows, predictor) {
  const eligible = rows.filter((row) => row.chosenIndex >= 0 && row.candidates.length > 0 && predictor(row) !== null);
  const acc = accuracy(eligible, predictor);
  const misses = acc.eligible - acc.hit;
  return { n: eligible.length, logLoss: misses > 0 ? 'Infinity' : 0, zeroProbabilityMisses: misses, ...acc };
}

function bootstrap(rows, metricFn, repetitions = 300) {
  const groups = [...Map.groupBy(rows, (row) => row.reportKey).values()];
  if (!groups.length) return null;
  let state = 0x6d2b79f5;
  const next = () => {
    state ^= state << 13; state ^= state >>> 17; state ^= state << 5; state >>>= 0;
    return state / 4294967296;
  };
  const values = [];
  for (let rep = 0; rep < repetitions; rep += 1) {
    const sample = [];
    for (let i = 0; i < groups.length; i += 1) sample.push(...groups[Math.floor(next() * groups.length)]);
    const value = metricFn(sample);
    if (Number.isFinite(value)) values.push(value);
  }
  values.sort((a, b) => a - b);
  if (!values.length) return null;
  const pick = (p) => values[Math.min(values.length - 1, Math.max(0, Math.floor((values.length - 1) * p)))];
  return [pick(.025), pick(.975)];
}

function summarizeStrata(rows, predictor) {
  const dimensions = {
    verified: (row) => row.isVerified ? 'verified' : 'older',
    actorFaction: (row) => row.actor_faction || 'unknown',
    candidateMix: (row) => row.candidates.some((candidate) => candidate.kind === 'defense') ? 'contains-defense' : 'ships-only',
  };
  const result = {};
  for (const [dimension, keyFn] of Object.entries(dimensions)) {
    result[dimension] = {};
    for (const [key, group] of Map.groupBy(rows, keyFn)) {
      result[dimension][key] = accuracy(group, predictor);
    }
  }
  const classGroups = [...Map.groupBy(rows, (row) => row.actor_class).entries()]
    .map(([key, group]) => ({ key, n: group.length, metric: accuracy(group, predictor) }))
    .sort((a, b) => b.n - a.n)
    .slice(0, 15);
  result.actorClassTop15 = Object.fromEntries(classGroups.map((entry) => [entry.key, { n: entry.n, ...entry.metric }]));
  return result;
}

function roundNumber(value, digits = 6) {
  return typeof value === 'number' && Number.isFinite(value) ? Number(value.toFixed(digits)) : value;
}

export function runTargetPriorityAudit() {
  const rawRows = readCsv();
  const { byLocator, counts: reportCounts } = readReports();
  const rows = rawRows.map(enrichRow);

  let orphans = 0;
  let joinDisagreements = 0;
  let missingChosenCandidate = 0;
  let previousTargetStillLive = 0;
  const duplicateTransitionIds = rawRows.length - new Set(rawRows.map((row) => row.transition_id)).size;
  for (const row of rows) {
    const report = byLocator.get(row.reportKey);
    if (!report) orphans += 1;
    else if (report.run_id !== row.run_id || report.case_id !== row.case_id || report.hasError) joinDisagreements += 1;
    if (row.chosenIndex < 0) missingChosenCandidate += 1;
    if (Number(row.previous_target_live_at_switch) !== 0) previousTargetStillLive += 1;
  }

  const usable = rows.filter((row) => row.chosenIndex >= 0 && row.candidates.length > 0 && byLocator.has(row.reportKey));
  const nonControlled = usable.filter((row) => row.experiment_block !== 'target_priority');
  const discovery = nonControlled.filter((row) => !isHoldout(row));
  const holdout = nonControlled.filter(isHoldout);
  const controlled = usable.filter((row) => row.experiment_block === 'target_priority');
  const discoveryReportKeys = new Set(discovery.map((row) => row.reportKey));
  const holdoutReportKeys = new Set(holdout.map((row) => row.reportKey));
  const discoveryGroupKeys = new Set(discovery.map((row) => row.groupKey));
  const holdoutGroupKeys = new Set(holdout.map((row) => row.groupKey));
  const reportOverlap = [...discoveryReportKeys].filter((key) => holdoutReportKeys.has(key));
  const groupOverlap = [...discoveryGroupKeys].filter((key) => holdoutGroupKeys.has(key));
  const uniformRandomExpectedTop1 = holdout.reduce((sum, row) => sum + 1 / row.candidates.length, 0) / holdout.length;

  const countFeature = (candidate) => Math.log(Math.max(1, Number(candidate.count)));
  const orderFeature = (candidate) => Number(candidate.order ?? 0);
  const populationFeature = (candidate) => Math.log(Math.max(1, Number(candidate.totalPopulation)));
  const threatFeature = (candidate) => Math.log(Math.max(1, Number(candidate.threat)));
  const primaryFeature = (candidate) => candidate.preferred ? 1 : 0;
  const matchupFeature = (candidate) => Math.log(Math.max(.01, Number(candidate.matchup ?? 1)));

  const mappedDiscovery = discovery.filter((row) => row.actorResolved && row.candidates.every((candidate) => candidate.resolved));
  const mappedHoldout = holdout.filter((row) => row.actorResolved && row.candidates.every((candidate) => candidate.resolved));
  const mappedControlled = controlled.filter((row) => row.actorResolved && row.candidates.every((candidate) => candidate.resolved));

  const countFit = fitOne(discovery, countFeature, -4, 4, .05);
  const orderFit = fitOne(discovery, orderFeature, -4, 4, .05);
  const countOrderFit = fitTwo(discovery, countFeature, orderFeature);
  const populationFit = fitOne(mappedDiscovery, populationFeature, -4, 4, .05);
  const threatFit = fitOne(mappedDiscovery, threatFeature, -4, 4, .05);
  const countPrimaryFit = fitTwo(mappedDiscovery, countFeature, primaryFeature);
  const countMatchupFit = fitTwo(mappedDiscovery, countFeature, matchupFeature);

  const uniformProb = (row) => row.candidates.map(() => 1 / row.candidates.length);
  const uniformTop = (row) => deterministicIndex(row, 'order', 'min');
  const countProb = (row) => scoreSoftmax(row.candidates, (candidate) => countFit.beta * countFeature(candidate));
  const countTop = (row) => topIndexFromProbabilities(row, countProb(row));
  const orderProb = (row) => scoreSoftmax(row.candidates, (candidate) => orderFit.beta * orderFeature(candidate));
  const orderTop = (row) => topIndexFromProbabilities(row, orderProb(row));
  const countOrderProb = (row) => scoreSoftmax(row.candidates, (candidate) => countOrderFit.a * countFeature(candidate) + countOrderFit.b * orderFeature(candidate));
  const countOrderTop = (row) => topIndexFromProbabilities(row, countOrderProb(row));
  const populationProb = (row) => row.candidates.every((candidate) => candidate.totalPopulation !== null)
    ? scoreSoftmax(row.candidates, (candidate) => populationFit.beta * populationFeature(candidate)) : null;
  const populationTop = (row) => populationProb(row) ? topIndexFromProbabilities(row, populationProb(row)) : null;
  const threatProb = (row) => row.candidates.every((candidate) => candidate.threat !== null)
    ? scoreSoftmax(row.candidates, (candidate) => threatFit.beta * threatFeature(candidate)) : null;
  const threatTop = (row) => threatProb(row) ? topIndexFromProbabilities(row, threatProb(row)) : null;
  const countPrimaryProb = (row) => row.actorResolved && row.candidates.every((candidate) => candidate.resolved)
    ? scoreSoftmax(row.candidates, (candidate) => countPrimaryFit.a * countFeature(candidate) + countPrimaryFit.b * primaryFeature(candidate)) : null;
  const countPrimaryTop = (row) => countPrimaryProb(row) ? topIndexFromProbabilities(row, countPrimaryProb(row)) : null;
  const countMatchupProb = (row) => row.actorResolved && row.candidates.every((candidate) => candidate.resolved)
    ? scoreSoftmax(row.candidates, (candidate) => countMatchupFit.a * countFeature(candidate) + countMatchupFit.b * matchupFeature(candidate)) : null;
  const countMatchupTop = (row) => countMatchupProb(row) ? topIndexFromProbabilities(row, countMatchupProb(row)) : null;

  const models = {
    uniform: modelMetrics(holdout, uniformProb, uniformTop),
    orderSoftmax: modelMetrics(holdout, orderProb, orderTop),
    countSoftmax: modelMetrics(holdout, countProb, countTop),
    countPlusOrderSoftmax: modelMetrics(holdout, countOrderProb, countOrderTop),
    populationSoftmax: modelMetrics(mappedHoldout, populationProb, populationTop),
    threatSoftmax: modelMetrics(mappedHoldout, threatProb, threatTop),
    countPlusPrimaryClassSoftmax: modelMetrics(mappedHoldout, countPrimaryProb, countPrimaryTop),
    countPlusMatchupSoftmax: modelMetrics(mappedHoldout, countMatchupProb, countMatchupTop),
    stableFirstOrder: deterministicMetrics(holdout, (row) => deterministicIndex(row, 'order', 'min')),
    stableLastOrder: deterministicMetrics(holdout, (row) => deterministicIndex(row, 'order', 'max')),
    smallestStack: deterministicMetrics(holdout, (row) => deterministicIndex(row, 'count', 'min')),
    largestStack: deterministicMetrics(holdout, (row) => deterministicIndex(row, 'count', 'max')),
    smallestPopulation: deterministicMetrics(mappedHoldout, (row) => deterministicIndex(row, 'totalPopulation', 'min')),
    largestPopulation: deterministicMetrics(mappedHoldout, (row) => deterministicIndex(row, 'totalPopulation', 'max')),
    currentAsterionStatic: deterministicMetrics(mappedHoldout, currentAsterionIndex),
  };

  const ci = {
    uniform: {
      accuracy95: bootstrap(holdout, (sample) => accuracy(sample, uniformTop).accuracy),
      logLoss95: bootstrap(holdout, (sample) => meanLoss(sample, uniformProb)),
    },
    countSoftmax: {
      accuracy95: bootstrap(holdout, (sample) => accuracy(sample, countTop).accuracy),
      logLoss95: bootstrap(holdout, (sample) => meanLoss(sample, countProb)),
    },
    countPlusOrderSoftmax: {
      accuracy95: bootstrap(holdout, (sample) => accuracy(sample, countOrderTop).accuracy),
      logLoss95: bootstrap(holdout, (sample) => meanLoss(sample, countOrderProb)),
    },
    currentAsterionStatic: {
      accuracy95: bootstrap(mappedHoldout, (sample) => accuracy(sample, currentAsterionIndex).accuracy),
    },
  };

  const controlledMetrics = {
    uniform: modelMetrics(controlled, uniformProb, uniformTop),
    countSoftmax: modelMetrics(controlled, countProb, countTop),
    countPlusOrderSoftmax: modelMetrics(controlled, countOrderProb, countOrderTop),
    populationSoftmax: modelMetrics(mappedControlled, populationProb, populationTop),
    currentAsterionStatic: deterministicMetrics(mappedControlled, currentAsterionIndex),
    plannedFirstLegal: deterministicMetrics(controlled, (row) => {
      if (!row.priorityPlan.length) return null;
      const candidateByName = new Map(row.candidates.map((candidate, index) => [normalizeName(candidate.name), index]));
      for (const plannedName of row.priorityPlan) {
        const index = candidateByName.get(normalizeName(plannedName));
        if (index !== undefined) return index;
      }
      return null;
    }),
  };

  const disagreementExamples = holdout
    .filter((row) => currentAsterionIndex(row) !== null && currentAsterionIndex(row) !== countOrderTop(row))
    .filter((row) => row.chosenIndex === currentAsterionIndex(row) || row.chosenIndex === countOrderTop(row))
    .slice(0, 12)
    .map((row) => ({
      transition_id: row.transition_id,
      run_id: row.run_id,
      case_id: row.case_id,
      source: row.reportKey,
      block: row.experiment_block,
      round: Number(row.round),
      actor: row.actor_class,
      chosen: row.current_target,
      candidates: row.candidates.map((candidate) => `${candidate.name}:${candidate.count}@${candidate.order}`),
      countOrderPrediction: row.candidates[countOrderTop(row)]?.name,
      currentAsterionPrediction: row.candidates[currentAsterionIndex(row)]?.name,
    }));

  const spotChecks = disagreementExamples.slice(0, 5).map((example) => {
    const report = byLocator.get(example.source);
    const text = report?.analysis_text ?? '';
    const chosenAt = text.indexOf(example.chosen);
    const start = Math.max(0, chosenAt - 180);
    return {
      ...example,
      sourceJoinMatches: Boolean(report && report.run_id === example.run_id && report.case_id === example.case_id && !report.hasError),
      analysisHasActor: text.includes(example.actor),
      analysisHasChosen: chosenAt >= 0,
      excerpt: chosenAt >= 0 ? text.slice(start, chosenAt + example.chosen.length + 220).replace(/\s+/g, ' ') : '',
    };
  });

  const unmapped = new Map();
  for (const row of rows) {
    for (const candidate of row.candidates) {
      if (candidate.resolved) continue;
      const key = `${row.targetFaction || row.targetRace}|${candidate.kind}|${candidate.name}`;
      unmapped.set(key, (unmapped.get(key) ?? 0) + 1);
    }
    if (!row.actorResolved) {
      const key = `ACTOR:${row.actorFaction || row.actorRace}|${row.actor_class}`;
      unmapped.set(key, (unmapped.get(key) ?? 0) + 1);
    }
  }

  const output = {
    generatedBy: 'tools/audit-nemexia-target-priority.mjs',
    split: {
      rule: 'target_priority is external controlled stratum; other rows grouped by experiment_block + comparison_key (fallback report locator), SHA-256 bucket <70 discovery / >=70 holdout',
      discoveryTransitions: discovery.length,
      holdoutTransitions: holdout.length,
      controlledTransitions: controlled.length,
      discoveryReports: discoveryReportKeys.size,
      holdoutReports: holdoutReportKeys.size,
      discoveryGroups: discoveryGroupKeys.size,
      holdoutGroups: holdoutGroupKeys.size,
      reportOverlap: reportOverlap.length,
      groupOverlap: groupOverlap.length,
    },
    validation: {
      reportCounts,
      transitions: rows.length,
      verifiedTransitions: rows.filter((row) => row.isVerified).length,
      olderTransitions: rows.filter((row) => !row.isVerified).length,
      duplicateTransitionIds,
      orphans,
      joinDisagreements,
      missingChosenCandidate,
      previousTargetStillLive,
      mappedHoldout: mappedHoldout.length,
      mappedControlled: mappedControlled.length,
      uniformRandomExpectedTop1,
      unmappedTop30: [...unmapped.entries()].sort((a, b) => b[1] - a[1]).slice(0, 30),
    },
    fittedOnDiscovery: {
      countFit,
      orderFit,
      countOrderFit,
      populationFit,
      threatFit,
      countPrimaryFit,
      countMatchupFit,
    },
    holdoutModels: models,
    clusteredReportBootstrap95: ci,
    controlledTargetPriority: controlledMetrics,
    holdoutStrataBestCountOrder: summarizeStrata(holdout, countOrderTop),
    holdoutStrataCurrentAsterion: summarizeStrata(mappedHoldout, currentAsterionIndex),
    disagreementExamples,
    spotChecks,
  };

  const cleanNumbers = (value) => {
    if (Array.isArray(value)) return value.map(cleanNumbers);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, cleanNumbers(item)]));
    return roundNumber(value);
  };
  return cleanNumbers(output);
}

if (import.meta.url === `file://${process.argv[1]?.replaceAll('\\', '/')}` || process.argv[1]?.endsWith('audit-nemexia-target-priority.mjs')) {
  console.log(JSON.stringify(runTargetPriorityAudit(), null, 2));
}
