import assert from 'node:assert/strict';
import test from 'node:test';
import type { FlightRecord } from '../domain/flights/types.ts';
import { createInitialSaveState } from './persistence.ts';
import { diffPlayerActions, snapshotPlayer } from './player-journal.ts';
import type { SaveState } from './contracts.ts';

test('the journal records the player\'s own new building and flight, never another owner\'s flight', () => {
  const before = createInitialSaveState('production', 1_000);
  const queueItem = { kind: 'building', id: 'q-1', assetRole: 'metal-production-1', planetId: 'helion-01', enqueuedAt: 2_000,
    startedAt: 2_000, finishAt: 5_000, targetLevel: 2, durationMs: 3_000, cost: { metal: 36, minerals: 15, gas: 0, energy: 16 } };
  const own = { id: 'own-flight', missionId: 'espionage', originPlanetId: 'helion-01', phase: 'outbound',
    destinationCoordinate: { galaxy: 1, system: 2, position: 3 }, selectedShips: { 'spy-probe': 1, scout: 0 }, arrivalAt: 9_000, gasCost: 12 } as unknown as FlightRecord;
  const foreign = { ...own, id: 'npc-flight', ownerSide: 'npc', ownerId: 'npc-gen-01' } as FlightRecord;
  const after: SaveState = {
    ...before,
    queues: { ...before.queues, 'helion-01': [queueItem as SaveState['queues'][string][number]] },
    flights: { ...before.flights, records: [own, foreign] },
  };
  const entries = diffPlayerActions(before, after, 2_000);
  assert.deepEqual(entries.map((entry) => entry.k), ['build', 'flight']);
  assert.deepEqual(entries[1]!.d.ships, { 'spy-probe': 1 });
  assert.equal(entries[1]!.d.to, '1:2:3');
  assert.deepEqual(diffPlayerActions(after, after, 3_000), [], 'nothing new, nothing recorded');
  const snapshot = snapshotPlayer(after, 3_000);
  assert.equal(snapshot.k, 'snapshot');
  assert.ok((snapshot.d.planets as Record<string, unknown>)['helion-01']);
});
