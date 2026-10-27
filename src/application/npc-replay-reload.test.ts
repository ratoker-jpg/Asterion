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

const isWreckedNpcPirateHunt = (flight: SaveState['flights']['records'][number]) => flight.ownerSide === 'npc'
  && flight.missionId === 'pirate-elimination' && flight.attackResolution !== undefined
  && Object.keys(flight.selectedShips).length === 0;

// The pirates can destroy an NPC hunt to the last hull. Its resolved flight
// still flies home empty and completes; the load validator used to drop it.
test('an NPC pirate hunt wiped out by the pirates survives save and load', () => {
  const targetAt = START + 2 * DAY;
  const first = slice(freezeNpcCatchupTarget(campaign(8, SEED), targetAt), targetAt);
  const wrecked = first.flights.records.filter(isWreckedNpcPirateHunt);
  assert.ok(wrecked.length > 0, 'the fixture slice must contain a wiped-out NPC pirate hunt');
  const loaded = saveLoad(first, targetAt);
  assert.deepEqual(loaded.flights.records.map((flight) => flight.id), first.flights.records.map((flight) => flight.id));
  for (const flight of wrecked) {
    assert.deepEqual(loaded.flights.records.find((item) => item.id === flight.id), JSON.parse(JSON.stringify(flight)));
  }
});

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
