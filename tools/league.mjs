// Strategy league (NPC intelligence, stage H). Offline tuning of the numbers in
// src/domain/npc/npc-policy.v1.json by paired lab runs; nothing here runs in the
// game and nothing learns inside a running campaign.
//
//   node tools/league.mjs candidates --base=src/domain/npc/npc-policy.v1.json --round=1 --out=league/round-1.json
//       coordinate search: the base policy and, for every number, one step down and one step up (the step is a share of
//       the allowed range and halves each round). The manifest is what `bot-lab.yml` takes as `league`.
//   node tools/league.mjs score --dir=lab-runs --manifest=league/round-1.json [--out=league/round-1-result.json]
//       every candidate against `base` on the same seeds (paired), 90% bootstrap per seed set; the best candidate that
//       passes the guards is named. Run on TRAINING seeds only.
//   node tools/league.mjs next --manifest=league/round-1.json --result=league/round-1-result.json --round=2 --out=league/round-2.json
//       the next coordinate round, centred on the chosen candidate (or the same centre with a smaller step).
//   node tools/league.mjs final --base=... --chosen=league/round-3-result.json --out=league/heldout.json
//       a two-sided manifest {base, chosen} to measure on HELD-OUT seeds that the search never saw.
//
// Objective: mean of the relative paired differences of the median points, the points of the bottom third and the income
// per hour. Guards (a candidate that breaks one is not chosen, however high its objective): the bottom third does not lose,
// colonies lost do not rise, the diversity of play does not fall. All of it is checked again on the held-out seeds.
import fs from 'node:fs';
import path from 'node:path';
import { bootstrapMean, labMetrics } from './bot-lab-batch.mjs';

const option = (name, fallback) => process.argv.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
// Same ranges as src/domain/npc/policy.ts (checked by the policy file validator on every lab run).
export const RANGES = { hoardDays: [0.05, 2], bottleneckDrive: [0.4, 2.4], scarcityHigh: [1, 6], styleCapRaise: [0, 1],
  budgetDaysHigh: [0.5, 8], spendShareHigh: [0.3, 0.95], reserveHours: [1, 24], tableWeight: [0, 1] };
export const OBJECTIVE = ['pointsMedian', 'pointsBottomThird', 'incomePerHour'];
/** Guard thresholds, in the metric's own terms (relative where noted). */
export const GUARDS = { bottomThirdRelFloor: -0.01, coloniesLostRise: 0.5, styleEntropyDrop: 0.05, actionMixSpreadDrop: 0.02 };

const round = (value, digits = 4) => +value.toFixed(digits);
const mean = (values) => values.reduce((total, value) => total + value, 0) / Math.max(1, values.length);

export function makeCandidates(base, roundNumber) {
  const candidates = { base: { version: base.version, params: { ...base.params } } };
  const shrink = 0.2 / 2 ** (roundNumber - 1);
  for (const [key, [low, high]] of Object.entries(RANGES)) {
    for (const [tag, direction] of [['down', -1], ['up', 1]]) {
      const value = Math.min(high, Math.max(low, base.params[key] + direction * shrink * (high - low)));
      if (Math.abs(value - base.params[key]) < 1e-9) continue;
      candidates[`${key}-${tag}`] = { version: base.version, params: { ...base.params, [key]: round(value) } };
    }
  }
  return { round: roundNumber, step: shrink, candidates };
}

/** Paired comparison of one candidate with `base` over the seeds both have. */
export function compareCandidate(runs, name) {
  const seeds = [...runs.get('base').keys()].filter((seed) => runs.get(name)?.has(seed)).sort((a, b) => a - b);
  const rows = seeds.map((seed) => ({ seed, base: labMetrics(runs.get('base').get(seed)), cand: labMetrics(runs.get(name).get(seed)) }));
  const relative = (key) => rows.map((row) => (row.base[key] > 0 ? (row.cand[key] - row.base[key]) / row.base[key] : 0));
  const absolute = (key) => rows.map((row) => row.cand[key] - row.base[key]);
  const objectiveParts = Object.fromEntries(OBJECTIVE.map((key) => [key, bootstrapMean(relative(key))]));
  const objectiveSeed = rows.map((_, index) => mean(OBJECTIVE.map((key) => relative(key)[index])));
  const objective = bootstrapMean(objectiveSeed);
  const guards = {
    bottomThird: objectiveParts.pointsBottomThird.mean >= GUARDS.bottomThirdRelFloor,
    coloniesLost: bootstrapMean(absolute('coloniesLost')).mean <= GUARDS.coloniesLostRise,
    styleEntropy: bootstrapMean(absolute('styleEntropy')).mean >= -GUARDS.styleEntropyDrop,
    actionMixSpread: bootstrapMean(absolute('actionMixSpread')).mean >= -GUARDS.actionMixSpreadDrop,
  };
  return { name, seeds, objective: { mean: round(objective.mean), low: round(objective.low), high: round(objective.high) },
    parts: Object.fromEntries(Object.entries(objectiveParts).map(([key, value]) => [key, { mean: round(value.mean), low: round(value.low), high: round(value.high) }])),
    diffs: { coloniesLost: round(bootstrapMean(absolute('coloniesLost')).mean), styleEntropy: round(bootstrapMean(absolute('styleEntropy')).mean),
      actionMixSpread: round(bootstrapMean(absolute('actionMixSpread')).mean), attacks: round(bootstrapMean(absolute('attacks')).mean) },
    guards, passes: Object.values(guards).every(Boolean) };
}

function readRuns(dir, names) {
  const runs = new Map();
  for (const name of names) {
    const seeds = new Map();
    const base = path.join(dir, name);
    if (fs.existsSync(base)) {
      for (const entry of fs.readdirSync(base)) {
        const file = path.join(base, entry, 'summary.json');
        if (fs.existsSync(file)) seeds.set(Number(entry.replace('seed-', '')), JSON.parse(fs.readFileSync(file, 'utf8')));
      }
    }
    runs.set(name, seeds);
  }
  return runs;
}

export function scoreLeague(dir, manifest) {
  const names = Object.keys(manifest.candidates);
  const runs = readRuns(dir, names);
  const results = names.filter((name) => name !== 'base' && runs.get(name).size).map((name) => compareCandidate(runs, name));
  // A candidate wins only if the objective's interval is above zero in its point estimate AND every guard holds.
  const eligible = results.filter((result) => result.passes && result.objective.mean > 0).sort((a, b) => b.objective.mean - a.objective.mean);
  const best = eligible[0] ?? null;
  return { round: manifest.round, base: manifest.candidates.base, seedsPerCandidate: results.map((result) => [result.name, result.seeds.length]),
    results: results.sort((a, b) => b.objective.mean - a.objective.mean),
    chosen: best ? { name: best.name, objective: best.objective, policy: manifest.candidates[best.name] } : null };
}

function main() {
  const command = process.argv[2];
  const write = (value) => {
    const text = `${JSON.stringify(value, null, 2)}\n`;
    if (option('out')) { fs.mkdirSync(path.dirname(option('out')), { recursive: true }); fs.writeFileSync(option('out'), text); }
    console.log(text);
  };
  if (command === 'candidates') {
    write(makeCandidates(JSON.parse(fs.readFileSync(option('base'), 'utf8')), Number(option('round', '1'))));
  } else if (command === 'score') {
    write(scoreLeague(option('dir', 'lab-runs'), JSON.parse(fs.readFileSync(option('manifest'), 'utf8'))));
  } else if (command === 'next') {
    const result = JSON.parse(fs.readFileSync(option('result'), 'utf8'));
    write(makeCandidates(result.chosen ? result.chosen.policy : result.base, Number(option('round'))));
  } else if (command === 'final') {
    const result = JSON.parse(fs.readFileSync(option('chosen'), 'utf8'));
    write({ round: 'heldout', candidates: { base: JSON.parse(fs.readFileSync(option('base'), 'utf8')), chosen: result.chosen ? result.chosen.policy : result.base } });
  } else {
    console.error('usage: league.mjs candidates|score|next|final (see the header of the file)');
    process.exit(2);
  }
}

if (import.meta.url === `file://${process.argv[1]?.replace(/\\/g, '/').replace(/^(?=[A-Za-z]:)/, '/')}`) main();
