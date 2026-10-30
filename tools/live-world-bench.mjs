// What the live world costs each thread on a late world: the worker's tick
// (reconcileRuntime), its diff, the copy postMessage makes, and the UI
// thread's patch apply. Checks that the UI mirror equals the world at the end.
//   node --max-old-space-size=8192 --experimental-strip-types --experimental-loader ./src/domain/combat/test-asset-loader.mjs \
//     tools/live-world-bench.mjs --fixture=F [--seconds=120] [--step-ms=1000]
import fs from 'node:fs';
import { reconcileRuntime } from '../src/application/reconcile.ts';
import { applyWorldPatch, describePatch, diffWorld } from '../src/application/world-diff.ts';
import { loadSavedState } from '../src/application/persistence.ts';
import { applyCampaignRuntimeForCatchup } from '../src/application/npc-catchup-runner.ts';

const option = (name, fallback) => process.argv.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const raw = fs.readFileSync(option('fixture'), 'utf8');
const at0 = JSON.parse(raw).npcReplay.processedThroughAt;
const loaded = loadSavedState({ mode: 'production', storage: { getItem: () => raw, setItem() {}, removeItem() {} }, saveKey: 'k', now: () => at0 });
let world = loaded.state;
applyCampaignRuntimeForCatchup(world, at0);
let mirror = structuredClone(world);
const seconds = Number(option('seconds', '120'));
const stepMs = Number(option('step-ms', '1000'));
const rows = [];
for (let tick = 1; tick <= seconds; tick += 1) {
  const t0 = performance.now();
  const next = reconcileRuntime(world, { planetId: world.currentPlanetId, now: at0 + tick * stepMs, mode: 'production', testTimeScale: 1 }).state;
  const t1 = performance.now();
  const patch = diffWorld(world, next);
  const t2 = performance.now();
  const posted = structuredClone(patch);
  const t3 = performance.now();
  mirror = applyWorldPatch(mirror, posted);
  const t4 = performance.now();
  world = next;
  rows.push({ tickMs: t1 - t0, diffMs: t2 - t1, cloneMs: t3 - t2, applyMs: t4 - t3, ...describePatch(patch) });
}
const equal = JSON.stringify(mirror) === JSON.stringify(world);
const pick = (key) => {
  const values = rows.map((row) => row[key]).sort((a, b) => a - b);
  const q = (p) => values[Math.min(values.length - 1, Math.floor(p * values.length))];
  return { median: +q(0.5).toFixed(2), p95: +q(0.95).toFixed(2), max: +values.at(-1).toFixed(2) };
};
console.log(JSON.stringify({ fixture: option('fixture'), seconds, stepMs, equal,
  worker: { tick: pick('tickMs'), diff: pick('diffMs') }, transfer: { clone: pick('cloneMs') }, ui: { apply: pick('applyMs') },
  patch: { ops: pick('ops'), values: pick('values') } }, null, 2));
if (!equal) process.exitCode = 1;
