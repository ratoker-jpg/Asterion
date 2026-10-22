// Full-world catch-up parity on one fixed fixture (see benchmark-npc-full-world):
//  A. one continuous catch-up to the horizon;
//  B. the same with a save written and loaded through the real persistence
//     facade every N chunks (an interrupted catch-up resumed after a restart);
//  C. day-by-day partitions (the game opened once per day, each time
//     freezing a new target).
// Prints the full-state and archive-normalized digests of each. Loading a save
// normalizes representation (e.g. legacy report provenance, ledger fields)
// exactly as the game does on every load, so B is compared with A after both
// pass through the same write+load ("loadNormalized" digests). Loading may also
// rebuild maps in another key order, so B is judged on a canonical digest
// (keys sorted at every level): same values, independent of insertion order.
//
//   node ... tools/check-npc-full-world-parity.mjs --fixture=F [days] [--reload-every=N]
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { createPersistenceFacade } from '../src/application/persistence.ts';
import { reconcileRuntime } from '../src/application/reconcile.ts';
import { isNpcCatchupPending } from '../src/application/npc-catchup.ts';
import { createFullWorldFixture, digestGameState, digestState } from './benchmark-npc-full-world.mjs';

const DAY_MS = 86_400_000;
const args = process.argv.slice(2);
const fixtureArg = args.find((arg) => arg.startsWith('--fixture='))?.slice('--fixture='.length);
const days = Number(args.find((arg) => /^\d+$/.test(arg)) ?? 3);
const reloadEvery = Number(args.find((arg) => arg.startsWith('--reload-every='))?.split('=')[1] ?? 50);
const fixture = fixtureArg ? JSON.parse(fs.readFileSync(fixtureArg, 'utf8')) : createFullWorldFixture();
const start = fixture.npcReplay.processedThroughAt;

class MemoryStorage {
  values = new Map();
  getItem(key) { return this.values.has(key) ? this.values.get(key) : null; }
  setItem(key, value) { this.values.set(key, String(value)); }
  removeItem(key) { this.values.delete(key); }
}

function step(state, now) {
  return reconcileRuntime(state, { planetId: state.currentPlanetId, now, mode: 'production', testTimeScale: 1 }).state;
}

function catchUp(state, now, onChunk) {
  let chunks = 0;
  do {
    state = step(state, now);
    chunks += 1;
    state = onChunk?.(state, chunks) ?? state;
  } while (isNpcCatchupPending(state));
  return state;
}

const horizon = start + days * DAY_MS;
const continuous = catchUp(fixture, horizon);

const storage = new MemoryStorage();
const facade = createPersistenceFacade({ mode: 'production', storage });
let reloads = 0;
const reloaded = catchUp(fixture, horizon, (state, chunks) => {
  if (chunks % reloadEvery !== 0 || !isNpcCatchupPending(state)) return state;
  const written = facade.write(state);
  if (!written.ok) throw new Error(`save failed: ${written.error}`);
  const loaded = facade.load();
  if (loaded.status !== 'loaded') throw new Error(`load failed: ${loaded.status}`);
  reloads += 1;
  return loaded.state;
});

let daily = fixture;
for (let day = 1; day <= days; day += 1) daily = catchUp(daily, start + day * DAY_MS);

const viaLoad = (state) => {
  const written = facade.write(state);
  if (!written.ok) throw new Error(`save failed: ${written.error}`);
  const loaded = facade.load();
  if (loaded.status !== 'loaded') throw new Error(`load failed: ${loaded.status}`);
  return loaded.state;
};
const canonical = (value) => Array.isArray(value)
  ? value.map(canonical)
  : value && typeof value === 'object'
    ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]))
    : value;
const canonicalDigest = (state) => createHash('sha256').update(JSON.stringify(canonical(state))).digest('hex');
const report = (state) => ({
  digest: digestState(state), gameStateDigest: digestGameState(state),
  loadNormalizedDigest: digestState(viaLoad(state)), loadNormalizedCanonicalDigest: canonicalDigest(viaLoad(state)),
  processedThroughAt: state.npcReplay.processedThroughAt,
});
const result = { days, reloadEvery, reloads, continuous: report(continuous), reloaded: report(reloaded), daily: report(daily) };
result.dailyMatchesContinuous = result.daily.digest === result.continuous.digest;
result.reloadedMatchesContinuousAfterLoad = result.reloaded.loadNormalizedCanonicalDigest === result.continuous.loadNormalizedCanonicalDigest;
result.reloadedMatchesContinuousRaw = result.reloaded.digest === result.continuous.digest;
console.log(JSON.stringify(result, null, 2));
