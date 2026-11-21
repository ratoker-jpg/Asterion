import assert from 'node:assert/strict';
import test from 'node:test';

import { createDefaultNewGameConfig } from '../domain/world/config.ts';
import type { UniverseAsteroidRuntimeState, UniverseCoordinate } from '../domain/universe/types.ts';
import { createInitialSaveState } from './persistence.ts';
import { dispatchFlight, getAvailableFleetForPlanet, previewFlight } from './flights.ts';
import { replacePlanetResources, type SaveState } from './contracts.ts';
import {
  planAsteroidGasBatch,
  scanAsteroidGasTargets,
  type AsteroidGasBatchScan,
} from './asteroid-gas-batch.ts';

const NOW = 1_800_000_000_000;
const RUNTIME = { now: NOW, mode: 'production' as const };
const SCAN: AsteroidGasBatchScan = { galaxy: 1, fromSystem: 1, toSystem: 40 };

function stateWithRecyclers(recyclers = 100): SaveState {
  const config = createDefaultNewGameConfig({ seed: 'BATCH-GAS-TEST1', playerName: 'Batch' });
  const initial = createInitialSaveState('production', NOW, {
    ...config,
    world: { ...config.world, galaxyCount: 2 },
  });
  const planetId = initial.currentPlanetId;
  const home = initial.planets[planetId]!;
  let state: SaveState = {
    ...initial,
    planets: {
      ...initial.planets,
      [planetId]: {
        ...home,
        universeGalaxy: 1,
        universeSystem: 1,
        universePosition: 1,
        fleet: { ...home.fleet, ships: { ...home.fleet.ships, recycler: recyclers } },
      },
    },
    asteroidSimulation: { version: 1, processedThroughAt: NOW, nextSpawnIndex: 1_000_000, asteroids: [] },
    asteroidDebrisBySpawnIndex: {},
  };
  state = replacePlanetResources(state, planetId, { metal: 1_000_000, minerals: 1_000_000, gas: 1_000_000 });
  return state;
}

function asteroid(spawnIndex: number, coordinate: UniverseCoordinate): UniverseAsteroidRuntimeState {
  return {
    spawnIndex,
    spawnedAt: NOW - 1_000,
    movementIndex: 0,
    previousMoveAt: NOW - 1_000,
    nextMoveAt: NOW + 60 * 60 * 1_000,
    gasYield: 50_000,
    gasRatePerHour: 0,
    gasUpdatedAt: NOW,
    gasRemainder: 0,
    coordinate: { ...coordinate },
  };
}

function withAsteroids(state: SaveState, asteroids: UniverseAsteroidRuntimeState[]): SaveState {
  return {
    ...state,
    asteroidSimulation: {
      version: 1,
      processedThroughAt: NOW,
      nextSpawnIndex: 1_000_000,
      asteroids,
    },
  };
}

function gasCommand(requestId: string, originPlanetId: string, coordinate: UniverseCoordinate) {
  return {
    requestId,
    missionId: 'gas' as const,
    originPlanetId,
    destination: { kind: 'coordinate' as const, coordinate },
    targetKind: 'asteroid' as const,
    selectedShips: { recycler: 10 },
    departedAt: NOW,
  };
}

test('scan uses inclusive system bounds, keeps the selected galaxy, and prioritizes asteroid debris presence', () => {
  const base = stateWithRecyclers();
  const state = {
    ...withAsteroids(base, [
      asteroid(11, { galaxy: 1, system: 4, position: 1 }),
      asteroid(12, { galaxy: 1, system: 6, position: 1 }),
      asteroid(13, { galaxy: 1, system: 7, position: 1 }),
      asteroid(14, { galaxy: 2, system: 5, position: 1 }),
    ]),
    asteroidDebrisBySpawnIndex: { '12': 321 },
  };

  const targets = scanAsteroidGasTargets(state, { galaxy: 1, fromSystem: 4, toSystem: 6 }, RUNTIME);

  assert.deepEqual(targets.map(({ spawnIndex }) => spawnIndex), [12, 11]);
  assert.equal(targets[0]!.hasDebris, true);
  assert.equal(targets[1]!.hasDebris, false);
  assert.ok(targets.every((target) => !('gasYield' in target) && !('asteroidDebris' in target)));
  assert.deepEqual(scanAsteroidGasTargets(state, { galaxy: 2, fromSystem: 5, toSystem: 5 }, RUNTIME).map(({ spawnIndex }) => spawnIndex), [14]);
});

test('plan defaults to twenty recyclers per target and limits aggregate flights without mutating live state', () => {
  const coordinates = [2, 3, 4, 5, 6].map((system, index) => ({
    spawnIndex: 20 + index,
    coordinate: { galaxy: 1, system, position: 1 },
  }));
  const state = withAsteroids(stateWithRecyclers(100), coordinates.map(({ spawnIndex, coordinate }) => asteroid(spawnIndex, coordinate)));

  const plan = planAsteroidGasBatch(state, SCAN, {}, RUNTIME);

  assert.equal(plan.targets.length, 5);
  assert.equal(plan.commands.length, 3);
  assert.deepEqual(plan.targets.slice(0, 3).map((row) => [row.status, row.requestedQuantity, row.acceptedQuantity]), [
    ['ready', 20, 20], ['ready', 20, 20], ['ready', 20, 20],
  ]);
  assert.ok(plan.targets.slice(3).every((row) => row.status === 'blocked' && row.preview === null && row.error?.code === 'flight-limit-reached'));
  assert.equal(plan.sources[0]!.availableRecyclers, 100);
  assert.equal(plan.sources[0]!.assignedRecyclers, 60);
  assert.equal(plan.sources[0]!.remainingRecyclers, 40);
  assert.equal(getAvailableFleetForPlanet(state, state.currentPlanetId).ships.recycler, 100);
  assert.equal(state.flights.records.length, 0);
  assert.ok(plan.targets[0]!.preview?.ok);
  assert.equal('state' in plan.targets[0]!.preview!, false);
  assert.ok(!('gasYield' in plan.targets[0]!));
});

test('selected-row quantities are honored and the nearest source needs enough free recyclers', () => {
  let state = stateWithRecyclers(9);
  const homeId = state.currentPlanetId;
  const home = state.planets[homeId]!;
  const colonyId = 'batch-colony';
  state = {
    ...state,
    planets: {
      ...state.planets,
      [colonyId]: {
        ...home,
        name: 'Batch colony',
        universeGalaxy: 1,
        universeSystem: 10,
        universePosition: 1,
        fleet: { ...home.fleet, ships: { ...home.fleet.ships, recycler: 12 } },
        resources: { metal: 1_000_000, minerals: 1_000_000, gas: 1_000_000 },
      },
    },
  };
  const targetA = asteroid(31, { galaxy: 1, system: 2, position: 1 });
  const targetB = asteroid(32, { galaxy: 1, system: 3, position: 1 });
  state = withAsteroids(state, [targetA, targetB]);

  const plan = planAsteroidGasBatch(state, SCAN, { quantitiesById: { 'asteroid:31': 10 } }, RUNTIME);

  assert.equal(plan.targets.length, 2);
  const selected = plan.targets.find((row) => row.targetId === 'asteroid:31')!;
  const unselected = plan.targets.find((row) => row.targetId === 'asteroid:32')!;
  assert.equal(selected.status, 'ready');
  assert.equal(selected.originPlanetId, colonyId);
  assert.equal(selected.acceptedQuantity, 10);
  assert.equal(unselected.status, 'unselected');
  assert.equal(unselected.acceptedQuantity, 0);
  assert.equal(plan.sources.find((source) => source.planetId === homeId)?.remainingRecyclers, 9);
  assert.equal(plan.sources.find((source) => source.planetId === colonyId)?.remainingRecyclers, 2);
});

test('batch refuses a scanned asteroid if another spawn occupies its coordinate by arrival', () => {
  const coordinate = { galaxy: 1, system: 3, position: 1 };
  const source = stateWithRecyclers(10);
  const stationary = withAsteroids(source, [asteroid(61, coordinate)]);
  const flight = previewFlight(stationary, gasCommand('arrival-forecast', source.currentPlanetId, coordinate), RUNTIME);
  assert.equal(flight.ok, true);
  if (!flight.ok) return;

  const moveAt = flight.flight.arrivalAt - 1;
  const state = withAsteroids(source, [
    { ...asteroid(61, coordinate), nextMoveAt: moveAt, nextCoordinate: { galaxy: 1, system: 3, position: 2 } },
    { ...asteroid(62, { galaxy: 1, system: 3, position: 4 }), nextMoveAt: moveAt, nextCoordinate: coordinate },
  ]);

  const plan = planAsteroidGasBatch(state, SCAN, { quantitiesById: { 'asteroid:61': 10 } }, RUNTIME);

  assert.equal(plan.commands.length, 0);
  assert.equal(plan.targets[0]!.status, 'blocked');
  assert.equal(plan.targets[0]!.blockReason, 'target-moves-before-arrival');
  assert.equal(plan.targets[0]!.error?.code, 'target-not-available');
  assert.match(plan.targets[0]!.error?.message ?? '', /покинет выбранные координаты до прибытия/);
});

test('active player gas flights block their destination and stale selected IDs are reported on replan', () => {
  const coordinate = { galaxy: 1, system: 3, position: 1 };
  const initial = withAsteroids(stateWithRecyclers(20), [asteroid(41, coordinate)]);
  let state = initial;
  const sent = dispatchFlight(state, gasCommand('existing-gas-flight', state.currentPlanetId, coordinate), RUNTIME);
  assert.equal(sent.ok, true);
  if (!sent.ok) return;
  state = sent.state;

  const activePlan = planAsteroidGasBatch(state, SCAN, { quantitiesById: { 'asteroid:41': 5 } }, RUNTIME);
  assert.equal(activePlan.targets[0]!.status, 'active');
  assert.equal(activePlan.targets[0]!.activeFlightId, sent.flight.id);
  assert.equal(activePlan.commands.length, 0);
  assert.equal(planAsteroidGasBatch(state, SCAN, {}, RUNTIME).targets[0]!.status, 'active');

  const movedWithinRange = withAsteroids(initial, [asteroid(41, { galaxy: 1, system: 4, position: 1 })]);
  const updatedPlan = planAsteroidGasBatch(movedWithinRange, SCAN, { quantitiesById: { 'asteroid:41': 5 } }, RUNTIME);
  assert.equal(updatedPlan.targets[0]!.coordinate.system, 4);
  assert.equal(updatedPlan.commands[0]?.destination?.kind, 'coordinate');
  if (updatedPlan.commands[0]?.destination?.kind === 'coordinate') {
    assert.deepEqual(updatedPlan.commands[0].destination.coordinate, { galaxy: 1, system: 4, position: 1 });
  }

  const batchPlan = planAsteroidGasBatch(initial, SCAN, { quantitiesById: { 'asteroid:41': 5 } }, RUNTIME);
  const batchSent = dispatchFlight(initial, batchPlan.commands[0]!, RUNTIME);
  assert.equal(batchSent.ok, true);
  if (!batchSent.ok) return;
  const movedBatchTarget = withAsteroids(batchSent.state, [asteroid(41, { galaxy: 1, system: 4, position: 1 })]);
  const movedBatchPlan = planAsteroidGasBatch(movedBatchTarget, SCAN, { quantitiesById: { 'asteroid:41': 5 } }, RUNTIME);
  assert.equal(movedBatchPlan.targets[0]!.status, 'active');
  assert.equal(movedBatchPlan.targets[0]!.activeFlightId, batchSent.flight.id);

  const moved = withAsteroids(initial, [asteroid(41, { galaxy: 1, system: 9, position: 1 })]);
  const livePlan = planAsteroidGasBatch(moved, { galaxy: 1, fromSystem: 1, toSystem: 5 }, { quantitiesById: { 'asteroid:41': 5 } }, RUNTIME);
  assert.deepEqual(livePlan.missingTargetIds, ['asteroid:41']);
  assert.equal(livePlan.commands.length, 0);
});

test('aggregate fuel is previewed against earlier accepted legs', () => {
  const asteroids = [
    asteroid(51, { galaxy: 1, system: 2, position: 1 }),
    asteroid(52, { galaxy: 1, system: 3, position: 1 }),
  ];
  let state = withAsteroids(stateWithRecyclers(20), asteroids);
  const firstFuel = previewFlight(state, gasCommand('fuel-check-1', state.currentPlanetId, asteroids[0]!.coordinate), RUNTIME);
  const secondFuel = previewFlight(state, gasCommand('fuel-check-2', state.currentPlanetId, asteroids[1]!.coordinate), RUNTIME);
  assert.equal(firstFuel.ok, true);
  assert.equal(secondFuel.ok, true);
  if (!firstFuel.ok || !secondFuel.ok) return;
  state = replacePlanetResources(state, state.currentPlanetId, {
    metal: 1_000_000,
    minerals: 1_000_000,
    gas: firstFuel.flight.gasCost + secondFuel.flight.gasCost - 1,
  });

  const plan = planAsteroidGasBatch(state, SCAN, { quantityPerTarget: 10 }, RUNTIME);

  assert.equal(plan.commands.length, 1);
  assert.equal(plan.targets[0]!.status, 'ready');
  assert.equal(plan.targets[1]!.status, 'blocked');
  assert.equal(plan.targets[1]!.blockReason, 'flight-refused');
  assert.equal(plan.targets[1]!.error?.code, 'insufficient-gas');
  assert.equal(state.flights.records.length, 0);
});
