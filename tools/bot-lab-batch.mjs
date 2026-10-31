// Bot lab batch (NPC intelligence slice 1): the same lab on several galaxies
// (seeds) at once, each seed starting from one fixture written on its first
// run, so a later run of other code (or another policy) starts from the very
// same world — paired runs. A comparison of two labelled batches gives, per
// metric, the paired difference with a 90% bootstrap interval over the seeds.
// Local only: it spawns tools/bot-lab.mjs processes and reads their files.
//
//   node tools/bot-lab-batch.mjs --label=before [--seeds=1-10] [--days=2] [--jobs=4] [--dir=lab-runs] [-- extra bot-lab flags]
//   node tools/bot-lab-batch.mjs --compare=before,after [--dir=lab-runs]
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

const option = (name, fallback) => process.argv.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const dir = path.resolve(option('dir', 'lab-runs'));

export function parseSeeds(text) {
  return text.split(',').flatMap((part) => {
    const [from, to] = part.split('-').map(Number);
    return to ? Array.from({ length: to - from + 1 }, (_, index) => from + index) : [from];
  }).filter((seed) => Number.isSafeInteger(seed) && seed > 0);
}

function runSeed(seed, label, days, extra) {
  const fixture = path.join(dir, 'fixtures', `seed-${seed}.json`);
  const out = path.join(dir, label, `seed-${seed}`);
  fs.mkdirSync(path.dirname(fixture), { recursive: true });
  fs.mkdirSync(out, { recursive: true });
  const start = fs.existsSync(fixture) ? [`--fixture=${fixture}`] : [`--seed=${seed}`, `--write-fixture=${fixture}`];
  const args = ['--max-old-space-size=4096', '--experimental-strip-types', '--experimental-loader', './src/domain/combat/test-asset-loader.mjs',
    'tools/bot-lab.mjs', ...start, `--days=${days}`, `--out=${out}`, ...extra];
  return new Promise((resolve) => {
    const child = spawn(process.execPath, args, { stdio: ['ignore', 'ignore', fs.openSync(path.join(out, 'lab.log'), 'w')] });
    child.on('exit', (code) => resolve({ seed, code }));
  });
}

async function batch() {
  const label = option('label');
  if (!label) throw new Error('--label=NAME is required');
  const seeds = parseSeeds(option('seeds', '1-10'));
  const days = Number(option('days', '2'));
  const jobs = Math.max(1, Number(option('jobs', '4')));
  const extra = process.argv.includes('--') ? process.argv.slice(process.argv.indexOf('--') + 1) : [];
  const queue = [...seeds];
  const results = [];
  const started = Date.now();
  await Promise.all(Array.from({ length: Math.min(jobs, queue.length) }, async () => {
    while (queue.length) {
      const seed = queue.shift();
      const result = await runSeed(seed, label, days, extra);
      results.push(result);
      process.stderr.write(`batch ${label}: seed ${seed} exit ${result.code} (${Math.round((Date.now() - started) / 1000)} s)\n`);
    }
  }));
  fs.writeFileSync(path.join(dir, label, 'batch.json'), JSON.stringify({ label, seeds, days, extra, wallSeconds: Math.round((Date.now() - started) / 1000),
    results: results.sort((a, b) => a.seed - b.seed) }, null, 2));
}

/** The numbers compared per seed, from the last day of a lab summary. */
export function labMetrics(summary) {
  const day = summary.days.at(-1);
  return {
    pointsMedian: day.points.median,
    pointsBottomThird: day.bottomThirdPoints ?? 0,
    pointsTop: day.points.top,
    resourcesMedian: day.resources.median,
    attacks: day.battles?.attacks ?? 0,
    attacksWon: day.battles?.attacksWon ?? 0,
    raidNet: (day.battles?.raidGain ?? 0) - (day.battles?.raidLoss ?? 0),
    defenceLoss: day.battles?.defenceLoss ?? 0,
    plansDone: day.plans?.done ?? 0,
    plansWon: day.plans?.won ?? 0,
    plansClosed: day.plans?.closed ?? 0,
    actionsStarted: day.actions.started,
    wallSeconds: summary.wallSeconds,
  };
}

/** Deterministic bootstrap of the mean paired difference (90% interval). */
export function bootstrapMean(diffs, rounds = 2000) {
  if (!diffs.length) return { mean: 0, low: 0, high: 0 };
  let state = 0x9e3779b9;
  const random = () => ((state = (Math.imul(state ^ (state >>> 15), 0x2c1b3c6d) + 0x6d2b79f5) >>> 0) / 2 ** 32);
  const means = [];
  for (let round = 0; round < rounds; round += 1) {
    let total = 0;
    for (let index = 0; index < diffs.length; index += 1) total += diffs[Math.floor(random() * diffs.length)];
    means.push(total / diffs.length);
  }
  means.sort((a, b) => a - b);
  const mean = diffs.reduce((sum, value) => sum + value, 0) / diffs.length;
  return { mean, low: means[Math.floor(0.05 * rounds)], high: means[Math.floor(0.95 * rounds)] };
}

function readSummaries(label) {
  const base = path.join(dir, label);
  const map = new Map();
  for (const entry of fs.readdirSync(base)) {
    const file = path.join(base, entry, 'summary.json');
    const seed = Number(entry.replace('seed-', ''));
    if (fs.existsSync(file)) map.set(seed, JSON.parse(fs.readFileSync(file, 'utf8')));
  }
  return map;
}

function compare() {
  const [a, b] = option('compare').split(',');
  const left = readSummaries(a);
  const right = readSummaries(b);
  const seeds = [...left.keys()].filter((seed) => right.has(seed)).sort((x, y) => x - y);
  const rows = {};
  const perSeed = seeds.map((seed) => ({ seed, [a]: labMetrics(left.get(seed)), [b]: labMetrics(right.get(seed)) }));
  for (const key of Object.keys(perSeed[0]?.[a] ?? {})) {
    const diffs = perSeed.map((row) => row[b][key] - row[a][key]);
    const mean = (label) => perSeed.reduce((sum, row) => sum + row[label][key], 0) / perSeed.length;
    const ci = bootstrapMean(diffs);
    rows[key] = { [a]: +mean(a).toFixed(1), [b]: +mean(b).toFixed(1), diff: +ci.mean.toFixed(1), low: +ci.low.toFixed(1), high: +ci.high.toFixed(1),
      verdict: ci.low > 0 ? 'выше' : ci.high < 0 ? 'ниже' : 'не различимо' };
  }
  const result = { compared: [a, b], seeds, metrics: rows, perSeed };
  fs.writeFileSync(path.join(dir, `compare-${a}-vs-${b}.json`), JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ compared: result.compared, seeds, metrics: rows }, null, 2));
}

if (import.meta.url === `file://${process.argv[1]?.replace(/\\/g, '/').replace(/^(?=[A-Za-z]:)/, '/')}`) {
  if (option('compare')) compare(); else await batch();
}
