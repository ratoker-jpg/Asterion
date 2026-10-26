import assert from 'node:assert/strict';
import test from 'node:test';

import { NPC_APPLIED_ID_LIMIT } from './npc-economy.ts';
import { isNpcCatchupPending } from './npc-catchup.ts';
import { reconcileRuntime } from './reconcile.ts';
import { createPersistenceFacade } from './persistence.ts';
import { NPC_LONG_HORIZON } from './npc-horizon.test-support.ts';
import { advanceTo, campaign, clone, DAY, economySnapshot, keepNpcEvents, memoryStorage, npcTargets, START } from './npc-runtime.test-support.ts';

// Pull requests reload a 7-day frozen target; main and nightly the 30-day one.
const RELOAD_DAYS = NPC_LONG_HORIZON ? 30 : 7;

test(`a frozen ${RELOAD_DAYS}-day replay target survives intermediate save/reload and does not duplicate actions`, () => {
  const initial = campaign(1, 'NPC-REPLAY-RELOAD');
  const targetAt = START + RELOAD_DAYS * DAY;
  const firstSlice = reconcileRuntime(clone(initial), {
    planetId: initial.currentPlanetId,
    now: targetAt,
    mode: 'production',
    testTimeScale: 1,
  });
  assert.equal(firstSlice.state.npcReplay?.targetAt, targetAt);
  assert.ok(isNpcCatchupPending(firstSlice.state));

  const storage = memoryStorage();
  const facade = createPersistenceFacade({ mode: 'production', storage, saveKey: 'npc-replay-frozen-target', now: () => targetAt });
  assert.equal(facade.write(firstSlice.state).ok, true);
  const loaded = facade.load();
  assert.equal(loaded.status, 'loaded');
  assert.equal(loaded.state.npcReplay?.targetAt, targetAt);
  assert.equal(isNpcCatchupPending(loaded.state), true);

  const remaining = advanceTo(loaded.state, targetAt, [targetAt]);
  const complete = advanceTo(clone(initial), targetAt, [targetAt]);
  const allEmissions = keepNpcEvents(firstSlice.events).concat(remaining.emissions);
  assert.deepEqual(economySnapshot(remaining.state), economySnapshot(complete.state));
  assert.deepEqual(allEmissions, complete.emissions);
  const actionIds = npcTargets(remaining.state).flatMap((target) => target.economyAppliedActionIds ?? []);
  const startedIds = allEmissions.flatMap((entry) => entry.kind === 'npc-economy' && entry.event.started && entry.event.economyActionId
    ? [entry.event.economyActionId] : []);
  assert.equal(new Set(startedIds).size, startedIds.length, 'reloading never emits a started action twice');
  const expectedActionIds = npcTargets(remaining.state).flatMap((target) => allEmissions.flatMap((entry) =>
    entry.kind === 'npc-economy' && entry.event.started && entry.event.planetId === target.id && entry.event.economyActionId
      ? [entry.event.economyActionId] : []).slice(-NPC_APPLIED_ID_LIMIT));
  assert.deepEqual(actionIds, expectedActionIds,
    'each planet retains the bounded canonical receipts of its most recent paid decisions after reload');
});

// Owner decision (25.10.2026): a long absence is replayed in full behind a
// progress bar, however long it takes. Today 100 very active owners replay
// one game day in tens of minutes of CPU, so a CI run covers the first six
// hours of the full world; long-horizon correctness is covered by the
// single-NPC 30-day equivalence tests, and the long 100-owner duration is
