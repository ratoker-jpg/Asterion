import assert from 'node:assert/strict';
import test from 'node:test';
import { getFactionShipCatalog } from '../domain/combat/faction-catalog.ts';
import { createBot01Planets } from '../domain/espionage/fixtures.ts';
import { createEmptyDefenseState } from '../domain/fleet/production.ts';
import { createEmptyFleetState } from '../domain/fleet/runtime.ts';
import type { SpyTargetState } from '../domain/espionage/types.ts';
import {
  getNextNpcFleetProductionCheckpoint,
  getNpcFleetProductionCandidates,
  settleNpcFleetProduction,
  startNpcFleetProduction,
} from './npc-fleet-production.ts';

const OWNER_A = 'npc-fleet-owner-a';
const OWNER_B = 'npc-fleet-owner-b';
const TIME_SCALE = 2;

function target(ownerId = OWNER_A): SpyTargetState {
  const base = Object.values(createBot01Planets(0))[0]!;
  return {
    ...base,
    id: `${ownerId}-planet-1`,
    ownerId,
    ownerName: ownerId,
    kind: 'npc',
    raceId: 'aegis',
    resources: { metal: 5_000_000, minerals: 5_000_000, gas: 5_000_000, debris: 0, developmentEnergy: 10_000 },
    buildings: { shipyard: 10, hangar: 100, 'advanced-factory': 10 },
    fleet: createEmptyFleetState(),
    defense: createEmptyDefenseState(),
    solarSatellites: 0,
    population: { total: 0, fleet: 0, defense: 0 },
    // This fixture begins with researched astronomy because the scout's catalog requirement is real.
    ownerProfile: { scienceLevels: { 4: 1 }, shipLevels: {}, commanderLevels: {} },
    fleetProduction: { shipQueue: [], defenseQueue: [], commanderQueue: [] },
  } as SpyTargetState;
}

function candidateFor(targetState: SpyTargetState, itemId: string) {
  return getNpcFleetProductionCandidates(targetState, targetState.ownerId, 0, TIME_SCALE)
    .find((candidate) => candidate.queueKind === 'ships' && candidate.itemId === itemId);
}

test('fleet candidates and paid starts are faction legal and replay idempotently', () => {
  const initial = target();
  const legalShip = getFactionShipCatalog(initial.raceId).find(({ id }) => id === 'scout');
  assert.ok(legalShip);
  const candidate = candidateFor(initial, legalShip.id);
  assert.ok(candidate?.available, candidate?.reason ?? 'expected scout to be available');

  const started = startNpcFleetProduction(initial, OWNER_A, 'ships', legalShip.id, 100, TIME_SCALE, 'decision-1');
  assert.equal(started.ok, true);
  assert.equal(started.target.resources.metal, initial.resources.metal - legalShip.cost.metal);
  assert.equal(started.target.resources.minerals, initial.resources.minerals - legalShip.cost.minerals);
  assert.equal(started.target.resources.gas, initial.resources.gas - legalShip.cost.gas);
  assert.equal(started.target.fleetProduction?.shipQueue.length, 1);
  assert.equal(started.target.fleet.ships[legalShip.id], 0, 'pending production does not grant a free ship');

  const repeated = startNpcFleetProduction(started.target, OWNER_A, 'ships', legalShip.id, 100, TIME_SCALE, 'decision-1');
  assert.equal(repeated.ok, true);
  assert.equal(repeated.target, started.target);
  assert.equal(repeated.target.fleetProduction?.shipQueue.length, 1);
});

test('settlement completes exactly at the saved due time once and exposes the next timer', () => {
  const initial = target();
  const ship = getFactionShipCatalog(initial.raceId).find(({ id }) => id === 'scout')!;
  const started = startNpcFleetProduction(initial, OWNER_A, 'ships', ship.id, 0, TIME_SCALE, 'exact-time');
  assert.equal(started.ok, true);
  const order = started.target.fleetProduction!.shipQueue[0]!;
  assert.equal(getNextNpcFleetProductionCheckpoint(started.target, OWNER_A, 0, order.finishAt), order.finishAt);

  const beforeDue = settleNpcFleetProduction(started.target, OWNER_A, order.finishAt - 1);
  assert.equal(beforeDue.changed, false);
  assert.equal(beforeDue.target.fleet.ships[ship.id], 0);
  assert.equal(beforeDue.nextDueAt, order.finishAt);

  const due = settleNpcFleetProduction(started.target, OWNER_A, order.finishAt);
  assert.equal(due.changed, true);
  assert.equal(due.target.fleet.ships[ship.id], 1);
  assert.equal(due.target.fleetProduction?.shipQueue.length, 0);
  assert.equal(due.target.population.fleet, ship.population);
  assert.equal(due.nextDueAt, null);

  const replay = settleNpcFleetProduction(due.target, OWNER_A, order.finishAt);
  assert.equal(replay.changed, false);
  assert.equal(replay.target, due.target);
  assert.equal(replay.target.fleet.ships[ship.id], 1);
});

test('an owner mismatch and a denied catalog action cannot debit the target wallet', () => {
  const initial = target();
  const wrongOwner = startNpcFleetProduction(initial, OWNER_B, 'ships', 'scout', 0, TIME_SCALE, 'cross-owner');
  assert.equal(wrongOwner.ok, false);
  assert.equal(wrongOwner.target, initial);
  assert.deepEqual(wrongOwner.target.resources, initial.resources);

  const denied = startNpcFleetProduction(initial, OWNER_A, 'ships', 'not-a-real-ship' as never, 0, TIME_SCALE, 'denied');
  assert.equal(denied.ok, false);
  assert.deepEqual(denied.target.resources, initial.resources);
  assert.equal(denied.target.fleetProduction?.shipQueue.length, 0);
});

test('candidate catalog is limited to the target faction catalog', () => {
  const initial = target();
  const shipIds = new Set(getNpcFleetProductionCandidates(initial, OWNER_A, 0, TIME_SCALE)
    .filter(({ queueKind }) => queueKind === 'ships').map(({ itemId }) => itemId));
  assert.deepEqual(shipIds, new Set(getFactionShipCatalog(initial.raceId).map(({ id }) => id)));
  assert.deepEqual(getNpcFleetProductionCandidates(initial, OWNER_B, 0, TIME_SCALE), []);
});

test('campaign duration scale is explicit and independent of the global player runtime scale', () => {
  const initial = target();
  const ship = getFactionShipCatalog(initial.raceId).find(({ id }) => id === 'scout')!;
  const standard = getNpcFleetProductionCandidates(initial, OWNER_A, 0, 1)
    .find(({ queueKind, itemId }) => queueKind === 'ships' && itemId === ship.id)!;
  const fast = getNpcFleetProductionCandidates(initial, OWNER_A, 0, 2)
    .find(({ queueKind, itemId }) => queueKind === 'ships' && itemId === ship.id)!;
  assert.equal(standard.available, true);
  assert.equal(fast.available, true);
  assert.ok(fast.durationMs < standard.durationMs);
  assert.ok(Math.abs(fast.durationMs * 2 - standard.durationMs) <= 1);
});
