// Opus audit probe (13.11.2026), not part of any test suite: what the game does
// when the PC clock is behind the save's world cursor (the clock ran ahead while
// playing and was then fixed, or was set back). Prints facts; asserts nothing.
// Run: node --experimental-strip-types --experimental-loader ./src/domain/combat/test-asset-loader.mjs docs/audit/probes/clock-shift.probe.ts
import { reconcileRuntime } from '../../../src/application/reconcile.ts';
import { createInitialSaveState } from '../../../src/application/persistence.ts';
import { startBuilding } from '../../../src/application/buildings.ts';
import { getNpcOwnerIds } from '../../../src/application/npc-foundation.ts';
import { getReplayNpcOwnerIds, freezeNpcCatchupTarget, isNpcCatchupPending } from '../../../src/application/npc-catchup.ts';
import { createNpcState } from '../../../src/domain/npc/state.ts';
import { createDefaultNewGameConfig } from '../../../src/domain/world/config.ts';
import { getPlanetResources, type SaveState } from '../../../src/application/contracts.ts';

const MIN = 60_000;
const DAY = 24 * 60 * MIN;
const T0 = Date.UTC(2026, 10, 1);

const config = createDefaultNewGameConfig({ seed: 'OPUSCLOCKPROBE', campaignName: 'clock probe' });
config.world = { ...config.world, galaxyCount: 1, npcCount: 4, randomPlayerStart: false };
const base = createInitialSaveState('production', T0, config);
const ownerIds = getNpcOwnerIds(base.espionage?.targets, base.profile.playerId);
let state: SaveState = { ...base, npc: createNpcState(ownerIds, 'opus-clock-probe', T0) };
const ctx = (now: number) => ({ planetId: state.currentPlanetId, now, mode: 'production' as const, testTimeScale: 1 as const });

// One normal minute of play so the replay cursor exists.
state = reconcileRuntime(state, ctx(T0 + MIN)).state;
console.log('replay owners', getReplayNpcOwnerIds(state).length, 'cursor', state.npcReplay?.processedThroughAt);

// The world was played while the PC clock was 1 day ahead; now the clock is right again.
const future = T0 + DAY;
state = freezeNpcCatchupTarget(state, future);
while (isNpcCatchupPending(state)) state = reconcileRuntime(state, { ...ctx(future), replayMaxGroups: 100_000 }).state;
state = reconcileRuntime(state, ctx(future)).state;
console.log('after playing on a clock +1 d: cursor = T0 +', ((state.npcReplay?.processedThroughAt ?? 0) - T0) / DAY, 'd');

const now = T0 + 2 * MIN; // the true time
const planet = state.currentPlanetId;
const before = getPlanetResources(state, planet);
const levelBefore = state.planets[planet].buildings['metal-production-1'] ?? 0;
const started = startBuilding(state, ctx(now), 'metal-production-1');
console.log('start metal-production-1 at true time:', started.ok, started.reason ?? '');
state = started.state;
const queued = (state.queues[planet] ?? [])[0];
console.log('queue item finishAt - now (min):', queued ? (queued.finishAt - now) / MIN : 'none');

const ticked = reconcileRuntime(state, ctx(now + 1_000));
state = ticked.state;
const levelAfter = state.planets[planet].buildings['metal-production-1'] ?? 0;
console.log('one second later: building level', levelBefore, '->', levelAfter, '| queue length', (state.queues[planet] ?? []).length);
console.log('cursor still T0 +', ((state.npcReplay?.processedThroughAt ?? 0) - T0) / DAY, 'd (NPC world frozen until the clock catches up)');
const after = getPlanetResources(state, planet);
console.log('metal before start / after tick:', String(before.metal), String(after.metal));
console.log('VERDICT', levelAfter > levelBefore && queued && queued.finishAt > now + 1_000 ? 'BUILD-FINISHES-BEFORE-ITS-TIME' : 'BUILD-WAITS');
