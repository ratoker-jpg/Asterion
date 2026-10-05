import assert from 'node:assert/strict';
import test from 'node:test';

import { createEmptyFleetState } from '../domain/fleet/runtime.ts';
import { createInitialSaveState } from './persistence.ts';
import { dispatchFlight, reconcileFlights } from './flights.ts';
import type { SaveState } from './contracts.ts';

const targetId = 'commander-deployment-target';
const targetCoordinate = { galaxy: 1, system: 2, position: 1 };

function fixture(blockedTarget = false): SaveState {
  const initial = createInitialSaveState('production', 1_000);
  const home = initial.planets['helion-01'];
  const emptyFleet = createEmptyFleetState();
  const target = {
    ...home,
    id: targetId,
    name: 'Ira Vel',
    universeGalaxy: targetCoordinate.galaxy,
    universeSystem: targetCoordinate.system,
    universePosition: targetCoordinate.position,
    fleet: emptyFleet,
    solarSatellites: 0,
    buildings: { ...home.buildings, hangar: 0 },
    ...(blockedTarget ? {
      overpopulation: {
        episodeStartedAt: 1_000,
        initialExcess: 1,
        scheduledBurnPool: 1,
        burnedPopulation: 0,
        lastReconciledAt: 1_000,
        blocked: true,
      },
    } : {}),
  };
  return {
    ...initial,
    planets: {
      ...initial.planets,
      'helion-01': {
        ...home,
        fleet: {
          ...home.fleet,
          ships: { ...home.fleet.ships, scout: 42 },
          commanders: { ...home.fleet.commanders, corsair: 1 },
        },
      },
      [targetId]: target,
    },
  };
}

function deploymentCommand(requestId: string, selectedShips: Record<string, number>, selectedCommanders: Record<string, number>) {
  return {
    requestId,
    missionId: 'deployment' as const,
    originPlanetId: 'helion-01',
    destination: { kind: 'planet' as const, planetId: targetId, coordinate: targetCoordinate },
    targetRelation: 'self' as const,
    selectedShips,
    selectedCommanders,
    departedAt: 2_000,
  };
}

test('commander-only deployment dispatches through the domain flight runtime', () => {
  const state = fixture();
  const result = dispatchFlight(state, deploymentCommand('commander-only-1', {}, { corsair: 1 }), 2_000);

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.flight.selectedShips, {});
  assert.deepEqual(result.flight.selectedCommanders, { corsair: 1 });
  assert.equal(result.flight.effectiveSpeed, 33_000);
  assert.ok(result.flight.gasCost > 0);
});

test('deployment still rejects a fleet with neither ordinary ships nor commanders', () => {
  const result = dispatchFlight(fixture(), deploymentCommand('commander-deployment-empty', {}, {}), 2_000);

  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error.code, 'wrong-ship-composition');
});

test('deployment rejects a blocked own-planet destination', () => {
  const result = dispatchFlight(fixture(true), deploymentCommand('blocked-target-1', { scout: 1 }, {}), 2_000);

  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error.code, 'target-overpopulated');
});

test('a different mission still rejects an empty ordinary-hull selection', () => {
  const state = fixture();
  const result = dispatchFlight(state, {
    requestId: 'commander-colonize-empty-hulls',
    missionId: 'colonize',
    originPlanetId: 'helion-01',
    destination: { kind: 'coordinate', coordinate: { galaxy: 1, system: 2, position: 2 } },
    targetKind: 'empty',
    selectedShips: {},
    selectedCommanders: { corsair: 1 },
    departedAt: 2_000,
  }, 2_000);

  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error.code, 'wrong-ship-composition');
});

test('transport dispatch to a blocked own planet remains available', () => {
  const state = fixture(true);
  const result = dispatchFlight(state, {
    requestId: 'transport-to-blocked-planet',
    missionId: 'transport',
    originPlanetId: 'helion-01',
    destination: { kind: 'planet', planetId: targetId, coordinate: targetCoordinate },
    targetRelation: 'self',
    selectedShips: { scout: 1 },
    cargo: { metal: 10, minerals: 5, gas: 5, debris: 0 },
    departedAt: 2_000,
  }, 2_000);

  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.flight.missionId, 'transport');
});

test('deployment already in flight still arrives if its target becomes blocked en route', () => {
  const sent = dispatchFlight(
    fixture(),
    deploymentCommand('deployment-blocked-mid-flight', { scout: 1 }, {}),
    2_000,
  );
  assert.equal(sent.ok, true);
  if (!sent.ok) return;
  const target = sent.state.planets[targetId];
  const blockedInFlight = {
    ...sent.state,
    planets: {
      ...sent.state.planets,
      [targetId]: {
        ...target,
        overpopulation: {
          episodeStartedAt: sent.flight.departedAt,
          initialExcess: 1,
          scheduledBurnPool: 1,
          burnedPopulation: 0,
          lastReconciledAt: sent.flight.departedAt,
          blocked: true,
        },
      },
    },
  };

  const arrived = reconcileFlights(blockedInFlight, sent.flight.arrivalAt);
  assert.equal(arrived.events.some((event) => event.status === 'deployed'), true);
  assert.equal(arrived.state.planets[targetId].fleet.ships.scout, 1);
  assert.equal(arrived.state.flights.records.find((flight) => flight.id === sent.flight.id)?.completionReason, 'deployed');
});

test('attack dispatch from a blocked origin remains available', () => {
  const initial = createInitialSaveState('test', 1_000);
  const home = initial.planets['helion-01'];
  const state = {
    ...initial,
    planets: {
      ...initial.planets,
      'helion-01': {
        ...home,
        overpopulation: {
          episodeStartedAt: 1_000,
          initialExcess: 1,
          scheduledBurnPool: 1,
          burnedPopulation: 0,
          lastReconciledAt: 1_000,
          blocked: true,
        },
      },
    },
  };
  const target = Object.values(state.espionage!.targets!)[0];
  assert.ok(target);
  if (!target) return;
  const result = dispatchFlight(state, {
    requestId: 'attack-from-blocked-origin',
    missionId: 'attack',
    originPlanetId: 'helion-01',
    destination: { kind: 'planet', planetId: target.id, coordinate: target.coordinate },
    targetOwnerId: target.ownerId,
    targetRelation: 'neutral',
    selectedShips: { scout: 1 },
    selectedCommanders: {},
    departedAt: 2_000,
  }, { now: 2_000, mode: 'test' });

  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.flight.missionId, 'attack');
});
