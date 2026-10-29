// The catch-up may run in any chunk size (App's worker sizes chunks by time),
// so the world after an absence must not depend on where chunks end, on a
// save/load between them, or on who runs them. Checked on the un-isolated
// full world (10 galaxies, 100 NPC, asteroids, exploration and pirates).
import assert from 'node:assert/strict';
import test from 'node:test';
import { reconcileRuntime } from './reconcile.ts';
import { freezeNpcCatchupTarget, isNpcCatchupPending } from './npc-catchup.ts';
import { runNpcCatchup } from './npc-catchup-runner.ts';
import { createPersistenceFacade } from './persistence.ts';
import { memoryStorage } from './npc-runtime.test-support.ts';
import { createInitialSaveState } from './persistence.ts';
import { getNpcOwnerIds } from './npc-foundation.ts';
import { createNpcState } from '../domain/npc/state.ts';
import { createDefaultNewGameConfig } from '../domain/world/config.ts';
import type { SaveState } from './contracts.ts';

const HOUR = 3_600_000;
const HORIZON_HOURS = 3;
/**
 * Regression budget for one chunked run of the horizon. About 8 s on a
 * Ryzen 5 5600 after the late-game work (28.10.2026; ~11 s before it); the
 * margin covers shared CI runners. A slower catch-up means a hot path came back.
 */
const CATCHUP_BUDGET_MS = 90_000;

const FULL_WORLD_START_AT = Date.UTC(2026, 0, 1);

/** The campaign of tools/benchmark-npc-full-world.mjs: nothing isolated, only the persona salt fixed. */
function fullWorld(): SaveState {
  const config = createDefaultNewGameConfig({ seed: 'NPCREPLAYQA2026', campaignName: 'NPC full-world QA' });
  config.world = { ...config.world, galaxyCount: 10, npcCount: 100, randomPlayerStart: false };
  const base = createInitialSaveState('production', FULL_WORLD_START_AT, config);
  const ownerIds = getNpcOwnerIds(base.espionage?.targets, base.profile.playerId);
  assert.equal(ownerIds.length, 100);
  return { ...base, npc: createNpcState(ownerIds, 'npc-replay-benchmark-persona-salt-v1', FULL_WORLD_START_AT) };
}

const fixture = fullWorld();
const targetAt = FULL_WORLD_START_AT + HORIZON_HOURS * HOUR;

function drain(state: SaveState, groups: number, reload = false): SaveState {
  let current = freezeNpcCatchupTarget(state, targetAt);
  while (isNpcCatchupPending(current)) {
    current = reconcileRuntime(current, { planetId: current.currentPlanetId, now: targetAt, mode: 'production', testTimeScale: 1, replayMaxGroups: groups }).state;
    if (reload) {
      const facade = createPersistenceFacade({ mode: 'production', storage: memoryStorage(), saveKey: 'npc-catchup-slicing', now: () => targetAt });
      assert.equal(facade.write(current).ok, true);
      const loaded = facade.load();
      assert.equal(loaded.status, 'loaded');
      if (loaded.status === 'loaded') current = loaded.state;
    }
  }
  return current;
}

/** The physical world: what load normalizes on purpose (report metadata, repair defaults) is left out. */
function world(state: SaveState): string {
  return JSON.stringify({
    npc: state.npc, npcScience: state.npcScience,
    targets: Object.fromEntries(Object.entries(state.espionage?.targets ?? {}).map(([id, target]) => [id, { ...target, repair: undefined }])),
    flights: state.flights.records, missions: state.espionage?.missions, spyReports: state.espionage?.reports,
    command: state.command, pirate: state.pirate, exploration: state.exploration, asteroids: state.asteroidSimulation,
    battles: state.combat.reports.map((report) => report.id), rating: state.rating,
  });
}

test(`a ${HORIZON_HOURS}-hour full-world catch-up is the same world in any chunk size, through the worker runner and after reloads`, async () => {
  const startedAt = performance.now();
  const small = drain(fixture, 64);
  const elapsed = performance.now() - startedAt;
  const large = drain(fixture, 100_000);
  assert.equal(JSON.stringify(large), JSON.stringify(small), 'one call and 64-group chunks give byte-identical saves');

  const runner = await runNpcCatchup(freezeNpcCatchupTarget(fixture, targetAt), { now: () => targetAt });
  assert.equal(JSON.stringify(runner.state), JSON.stringify(small), 'the worker runner (time-sized chunks) gives the same save');

  assert.deepEqual(JSON.parse(world(drain(fixture, 512, true))), JSON.parse(world(small)), 'saving and loading between chunks changes nothing physical');
  assert.ok(elapsed < CATCHUP_BUDGET_MS, `full-world ${HORIZON_HOURS}-hour catch-up took ${Math.round(elapsed)} ms (budget ${CATCHUP_BUDGET_MS} ms)`);
});

test('the worker runner closes the gap its own replay took and keeps the summary of the absence', async () => {
  const frozen = freezeNpcCatchupTarget(fixture, FULL_WORLD_START_AT + HOUR);
  const summary = frozen.npcReplay?.summary;
  assert.ok(summary, 'an absence over the command grace opens a world summary');
  // The clock has moved on by 20 minutes when the frozen target is reached.
  let clock = FULL_WORLD_START_AT + HOUR;
  const result = await runNpcCatchup(frozen, { now: () => clock, onProgress: () => { clock = FULL_WORLD_START_AT + HOUR + 20 * 60_000; } });
  assert.equal(result.state.npcReplay?.processedThroughAt, clock);
  assert.equal(isNpcCatchupPending(result.state), false);
  assert.equal(result.state.npcReplay?.summary?.fromAt, summary.fromAt);
  assert.equal(result.state.npcReplay?.summary?.finishedAt, FULL_WORLD_START_AT + HOUR, 'the summary closed when the absence was caught up');
  assert.equal(result.state.npcReplay?.summary?.complete, true);
  assert.ok(result.events.every((event) => !event.kind.startsWith('npc-') && event.kind !== 'pirate-raid-check'), 'only player-facing events reach App');
});
