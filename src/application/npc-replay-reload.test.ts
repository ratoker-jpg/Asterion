// A catch-up that is saved and loaded between slices (the player closes the
// game mid catch-up) must end in the same world as an uninterrupted one.
import assert from 'node:assert/strict';
import test from 'node:test';

import { freezeNpcCatchupTarget, isNpcCatchupPending } from './npc-catchup.ts';
import { reconcileRuntime } from './reconcile.ts';
import { createPersistenceFacade } from './persistence.ts';
import { NPC_LONG_HORIZON } from './npc-horizon.test-support.ts';
import { campaign, DAY, memoryStorage, START } from './npc-runtime.test-support.ts';
import type { SaveState } from './contracts.ts';

const SEED = 'NPC-REPLAY-RELOAD-8';

function slice(state: SaveState, targetAt: number) {
  return reconcileRuntime(state, { planetId: state.currentPlanetId, now: targetAt, mode: 'production', testTimeScale: 1, replayMaxGroups: 512 }).state;
}

function saveLoad(state: SaveState, targetAt: number) {
  const facade = createPersistenceFacade({ mode: 'production', storage: memoryStorage(), saveKey: 'asterion.npc-replay-reload.test', now: () => targetAt });
  assert.equal(facade.write(state).ok, true);
  const loaded = facade.load();
  assert.equal(loaded.status, 'loaded');
  return loaded.status === 'loaded' ? loaded.state : state;
}

// The wiped-out NPC pirate hunt (save/load keeps its empty return flight) is covered in npc-pirates.test.ts:
// NPC owners no longer send hunts the pirates are sure to wipe out, so no campaign slice produces one on its own.

function drain(start: SaveState, targetAt: number, reload: boolean) {
  let state = start;
  let guard = 0;
  while (isNpcCatchupPending(state)) {
    state = slice(state, targetAt);
    if (reload) state = saveLoad(state, targetAt);
    assert.ok((guard += 1) < 2_000, 'catch-up must finish');
  }
  return state;
}

// The physical world, not the bookkeeping that load legitimately normalizes.
function world(state: SaveState) {
  return JSON.parse(JSON.stringify({
    targets: Object.fromEntries(Object.entries(state.espionage?.targets ?? {}).map(([id, target]) => [id, { ...target, repair: undefined }])),
    flights: state.flights.records,
    npc: state.npc,
    npcScience: state.npcScience,
    alliances: state.command.alliances,
    diplomacy: state.command.diplomacy,
  }));
}

test('a two-day catch-up reloaded after every slice ends in the uninterrupted world', { skip: NPC_LONG_HORIZON ? false : 'two-day reload equivalence runs on main and nightly (ASTERION_NPC_LONG_HORIZON=1)' }, () => {
  const targetAt = START + 2 * DAY;
  const start = freezeNpcCatchupTarget(campaign(8, SEED), targetAt);
  assert.deepEqual(world(drain(start, targetAt, true)), world(drain(start, targetAt, false)));
});
