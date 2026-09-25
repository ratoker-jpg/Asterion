import assert from 'node:assert/strict';
import test from 'node:test';

import { createInitialSaveState, createPersistenceFacade } from './persistence.ts';
import {
  createPlanetIdForCoordinate,
  dispatchFlight,
  getAvailableFleetForPlanet,
  getReservedShipsForPlanet,
  getPendingInboundPopulation,
  getTransportCargoSummary,
  previewFlight,
  resolveRecycleTargetKindAtCoordinate,
  reconcileFlights,
  recallFlight,
} from './flights.ts';
import { startBuilding } from './buildings.ts';
import { reconcileRuntime } from './reconcile.ts';
import { getOwnerShipUpgradeLevel, getPlanetResources, replaceAlliedPlanetState, replacePlanetResources, replacePlanetState, type SaveState } from './contracts.ts';
import { reconcilePlanetOverpopulation } from './overpopulation.ts';
import { destroyOwnedPlanet } from './owned-planets.ts';
import { getStorageCapacities } from '../domain/buildings/resource-zone.ts';
import { createEmptyFleetState } from '../domain/fleet/runtime.ts';
import type { CommanderId } from '../domain/combat/commanders.ts';
import { getOrbitalDebrisAtCoordinate } from '../domain/espionage/orbital-debris.ts';
import type { ShipId } from '../domain/combat/ids.ts';
import type {
  UniverseAsteroidRuntimeState,
  UniverseAsteroidSimulationState,
  UniverseCoordinate,
  UniverseObjectKind,
} from '../domain/universe/types.ts';
import {
  ASTEROID_SCHEDULE_EPOCH_MS,
  advanceUniverseAsteroidCoordinate,
  createUniverseSystem,
  getUniverseAsteroidDwellMs,
  getUniverseAsteroidState,
  getUniverseTimedObjectSchedule,
} from '../domain/universe/runtime.ts';
import { advanceUniverseAsteroidSimulationAt, findUniverseAsteroidAtCoordinate } from '../domain/universe/asteroid-simulation.ts';
import { advanceAsteroidGasAt } from '../domain/universe/asteroid-gas.ts';

const origin = { galaxy: 1, system: 1, position: 1 };

function command(requestId: string, destination = { galaxy: 1, system: 2, position: 1 }) {
  return {
    requestId,
    missionId: 'colonize' as const,
    originPlanetId: 'helion-01',
    destination: { kind: 'coordinate' as const, coordinate: destination },
    targetKind: 'empty' as const,
    selectedShips: { colonizer: 1 as const },
    departedAt: 1_000,
  };
}

function recycleCommand(
  requestId: string,
  coordinate: UniverseCoordinate,
  targetKind: UniverseObjectKind,
  selectedShips: Partial<Record<ShipId, number>> = { recycler: 1 },
) {
  return {
    requestId,
    missionId: 'recycle' as const,
    originPlanetId: 'helion-01',
    destination: { kind: 'coordinate' as const, coordinate },
    targetKind,
    selectedShips,
    departedAt: 1_000,
  };
}

function gasCommand(
  requestId: string,
  coordinate: UniverseCoordinate,
  selectedShips: Partial<Record<ShipId, number>> = { recycler: 1 },
) {
  return {
    requestId,
    missionId: 'gas' as const,
    originPlanetId: 'helion-01',
    destination: { kind: 'coordinate' as const, coordinate },
    selectedShips,
    departedAt: 1_000,
  };
}

function withRecyclers(state: SaveState, count: number): SaveState {
  const planet = state.planets['helion-01'];
  return replacePlanetState(state, 'helion-01', {
    ...planet,
    fleet: { ...planet.fleet, ships: { ...planet.fleet.ships, recycler: count } },
  });
}

function withSpaceFlightFleet(
  state: SaveState,
  ships: Partial<Record<ShipId, number>> = {},
  commanders: Partial<Record<CommanderId, number>> = {},
): SaveState {
  const planet = state.planets['helion-01'];
  const emptyFleet = createEmptyFleetState();
  return replacePlanetState(state, 'helion-01', {
    ...planet,
    fleet: {
      ...emptyFleet,
      ships: { ...emptyFleet.ships, ...ships },
      commanders: { ...emptyFleet.commanders, ...commanders },
    },
  });
}

function spaceFlightCommand(
  requestId: string,
  options: {
    ships?: Partial<Record<ShipId, number>>;
    commanders?: Partial<Record<CommanderId, number>>;
    minutes?: number;
    cargo?: { metal: number; minerals: number; gas: number; debris: number };
    departedAt?: number;
  } = {},
) {
  return {
    requestId,
    missionId: 'space-flight' as const,
    originPlanetId: 'helion-01',
    selectedShips: options.ships ?? {},
    selectedCommanders: options.commanders ?? {},
    oneWayDurationMinutes: options.minutes ?? 5,
    cargo: options.cargo ?? { metal: 0, minerals: 0, gas: 0, debris: 0 },
    departedAt: options.departedAt ?? 1_000,
  };
}

function withOrbitalDebris(state: SaveState, coordinate: UniverseCoordinate, debris: number, targetId = 'lost-debris-target'): SaveState {
  const existing = state.espionage!;
  return {
    ...state,
    espionage: {
      ...existing,
      orbitalDebris: {
        ...existing.orbitalDebris,
        [targetId]: {
          id: `orbital-debris-${targetId}`,
          targetPlanetId: targetId,
          targetPlanetName: 'Потерянная планета',
          targetOwnerId: 'lost-owner',
          targetCoordinate: { ...coordinate },
          debris,
          createdAt: 1_000,
        },
      },
    },
  };
}

function withAsteroidOverlay(state: SaveState, coordinate: UniverseCoordinate, spawnIndex = 42): SaveState {
  const priorSimulation = state.asteroidSimulation;
  return {
    ...state,
    asteroidSimulation: {
      version: 1,
      processedThroughAt: priorSimulation?.processedThroughAt ?? 1_000,
      nextSpawnIndex: priorSimulation?.nextSpawnIndex ?? 0,
      ...priorSimulation,
      asteroids: [{
        spawnIndex,
        spawnedAt: 1_000,
        movementIndex: 0,
        previousMoveAt: 1_000,
        nextMoveAt: 2_000,
        gasYield: 0,
        coordinate: { ...coordinate },
      }],
    },
  };
}

function withScheduledAsteroid(
  state: SaveState,
  coordinate: UniverseCoordinate,
  nextMoveAt: number,
  spawnIndex = 42,
): SaveState {
  return {
    ...state,
    asteroidSimulation: {
      version: 1,
      processedThroughAt: 1_000,
      // Keep routine schedule spawns outside each test's reconciliation window.
      nextSpawnIndex: 10_000,
      asteroids: [{
        spawnIndex,
        spawnedAt: 1_000,
        movementIndex: 0,
        previousMoveAt: 1_000,
        nextMoveAt,
        gasYield: 0,
        coordinate: { ...coordinate },
      }],
    },
  };
}

function withGasAsteroid(
  state: SaveState,
  coordinate: UniverseCoordinate,
  options: {
    spawnIndex?: number;
    gasYield?: number;
    gasRatePerHour?: number;
    gasUpdatedAt?: number;
    gasRemainder?: number;
    nextMoveAt?: number;
  } = {},
): SaveState {
  const spawnIndex = options.spawnIndex ?? 42;
  const priorSimulation = state.asteroidSimulation;
  return {
    ...state,
    asteroidSimulation: {
      version: 1,
      processedThroughAt: priorSimulation?.processedThroughAt ?? 1_000,
      nextSpawnIndex: priorSimulation?.nextSpawnIndex ?? 10_000,
      ...priorSimulation,
      asteroids: [{
        spawnIndex,
        spawnedAt: 1_000,
        movementIndex: 0,
        previousMoveAt: 1_000,
        nextMoveAt: options.nextMoveAt ?? 60_000,
        gasYield: options.gasYield ?? 100_000,
        gasRatePerHour: options.gasRatePerHour ?? 2_500,
        gasUpdatedAt: options.gasUpdatedAt ?? 1_000,
        gasRemainder: options.gasRemainder ?? 0,
        coordinate: { ...coordinate },
      }],
    },
  };
}

function withRecyclerArrivalAt(state: SaveState, requestId: string, coordinate: UniverseCoordinate, arrivalAt: number) {
  const sent = dispatchFlight(state, recycleCommand(requestId, coordinate, 'asteroid'), 1_000);
  assert.equal(sent.ok, true);
  if (!sent.ok) return null;
  return {
    ...sent,
    state: {
      ...sent.state,
      flights: {
        ...sent.state.flights,
        records: sent.state.flights.records.map((flight) => flight.id === sent.flight.id
          ? { ...flight, arrivalAt }
          : flight),
      },
    },
    flight: { ...sent.flight, arrivalAt },
  };
}

function withGasArrivalAt(state: SaveState, requestId: string, coordinate: UniverseCoordinate, arrivalAt: number) {
  const sent = dispatchFlight(state, gasCommand(requestId, coordinate), 1_000);
  assert.equal(sent.ok, true);
  if (!sent.ok) return null;
  return {
    ...sent,
    state: {
      ...sent.state,
      flights: {
        ...sent.state.flights,
        records: sent.state.flights.records.map((flight) => flight.id === sent.flight.id
          ? { ...flight, arrivalAt }
          : flight),
      },
    },
    flight: { ...sent.flight, arrivalAt },
  };
}

function emptyUniverseCoordinate(galaxy = 1, systemNumber = 2, nowMs = 1_000) {
  const node = createUniverseSystem({ mode: 'production', galaxy, system: systemNumber, nowMs })
    .positions.find((candidate) => candidate.kind === 'empty')!;
  return { coordinate: node.coordinate, targetKind: node.kind };
}

test('dispatch is atomic and persisted request IDs make retries idempotent', () => {
  const initial = createInitialSaveState('production', 1_000);
  const first = dispatchFlight(initial, command('request-1'), 1_000);
  assert.equal(first.ok, true);
  if (!first.ok) return;
  const gasAfter = getPlanetResources(first.state).gas;
  const retried = dispatchFlight(first.state, { ...command('request-1'), selectedShips: { scout: 99 } }, 5_000);
  assert.equal(retried.ok, true);
  if (!retried.ok) return;
  assert.equal(retried.created, false);
  assert.equal(retried.flight.id, first.flight.id);
  assert.equal(getPlanetResources(retried.state).gas, gasAfter);
  assert.equal(retried.state.flights.records.length, 1);
  assert.equal(getReservedShipsForPlanet(retried.state, 'helion-01').colonizer, 1);
  assert.equal(getAvailableFleetForPlanet(retried.state, 'helion-01').ships.colonizer, 0);

  const second = dispatchFlight(first.state, command('request-2', { galaxy: 1, system: 3, position: 1 }), 5_000);
  assert.equal(second.ok, false);
  if (!second.ok) assert.equal(second.error.code, 'ship-already-reserved');
});

test('insufficient gas leaves the state untouched', () => {
  const initial = createInitialSaveState('production', 1_000);
  const noGas = replacePlanetResources(initial, 'helion-01', { metal: 1, minerals: 1, gas: 0 });
  const result = dispatchFlight(noGas, command('no-gas'), 1_000);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error.code, 'insufficient-gas');
  assert.equal(result.state, noGas);
  assert.equal(result.state.flights.records.length, 0);
});

test('preview is read-only and a persisted request remains idempotent after reload', () => {
  const initial = createInitialSaveState('production', 1_000);
  const preview = previewFlight(initial, command('preview-only'), 1_000);
  assert.equal(preview.ok, true);
  if (!preview.ok) return;
  assert.equal(preview.created, false);
  assert.equal(preview.state, initial);
  assert.equal(preview.state.flights.records.length, 0);

  const storage = new Map<string, string>();
  const storageLike = {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => { storage.set(key, value); },
    removeItem: (key: string) => { storage.delete(key); },
  };
  const persistence = createPersistenceFacade({ mode: 'production', storage: storageLike, now: () => 1_000 });
  const sent = dispatchFlight(persistence.read(), command('reload-safe'), 1_000);
  assert.equal(sent.ok, true);
  if (!sent.ok) return;
  assert.equal(persistence.write(sent.state).ok, true);
  const reloaded = persistence.read();
  const retried = dispatchFlight(reloaded, { ...command('reload-safe'), selectedShips: { scout: 99 } }, 99_000);
  assert.equal(retried.ok, true);
  if (!retried.ok) return;
  assert.equal(retried.created, false);
  assert.equal(retried.flight.id, sent.flight.id);
  assert.equal(retried.state.flights.records.length, 1);
  assert.equal(getPlanetResources(retried.state).gas, getPlanetResources(sent.state).gas);
});

test('recall returns the colonizer with elapsed reverse timer and no gas refund', () => {
  const initial = createInitialSaveState('production', 1_000);
  const sent = dispatchFlight(initial, command('recall-me'), 1_000);
  assert.equal(sent.ok, true);
  if (!sent.ok) return;
  const gasAfterDispatch = getPlanetResources(sent.state).gas;
  const recalled = recallFlight(sent.state, sent.flight.id, sent.flight.departedAt + 37_000);
  assert.equal(recalled.ok, true);
  if (!recalled.ok) return;
  assert.equal(recalled.flight.phase, 'returning');
  assert.equal(recalled.flight.returnAt, sent.flight.departedAt + 74_000);
  assert.equal(getPlanetResources(recalled.state).gas, gasAfterDispatch);
  const completed = reconcileFlights(recalled.state, recalled.flight.returnAt!);
  assert.equal(completed.events.length, 1);
  assert.equal(completed.state.flights.records[0].phase, 'completed');
  assert.equal(completed.state.flights.records[0].completionReason, 'recalled');
  assert.equal(completed.state.planets['helion-01'].fleet.ships.colonizer, 1);
  assert.equal(Object.keys(completed.state.planets).length, 1);
});

test('recall at or after arrival refuses to create a reverse leg and does not refund gas', () => {
  const initial = createInitialSaveState('production', 1_000);
  const sent = dispatchFlight(initial, command('arrival-boundary'), 1_000);
  assert.equal(sent.ok, true);
  if (!sent.ok) return;
  const gasAfterDispatch = getPlanetResources(sent.state).gas;

  for (const now of [sent.flight.arrivalAt, sent.flight.arrivalAt + 1]) {
    const recalled = recallFlight(sent.state, sent.flight.id, now);
    assert.equal(recalled.ok, false);
    if (recalled.ok) continue;
    assert.equal(recalled.error.code, 'flight-already-arrived');
    assert.equal(recalled.error.message, 'Рейс уже прибыл.');
    assert.equal(recalled.state, sent.state);
    assert.equal(getPlanetResources(recalled.state).gas, gasAfterDispatch);
    assert.equal(recalled.state.flights.records[0].phase, 'outbound');
  }

  const processedArrival = reconcileFlights(sent.state, sent.flight.arrivalAt).state;
  const afterProcessedArrival = recallFlight(processedArrival, sent.flight.id, sent.flight.arrivalAt + 1);
  assert.equal(afterProcessedArrival.ok, false);
  if (!afterProcessedArrival.ok) assert.equal(afterProcessedArrival.error.code, 'flight-already-arrived');
});

test('successful arrival creates one deterministic isolated colony and consumes payload only at arrival', () => {
  const initial = createInitialSaveState('production', 1_000);
  const sent = dispatchFlight(initial, command('colonize-me'), 1_000);
  assert.equal(sent.ok, true);
  if (!sent.ok) return;
  assert.equal(sent.state.planets['helion-01'].fleet.ships.colonizer, 1);
  const arrived = reconcileFlights(sent.state, sent.flight.arrivalAt);
  assert.equal(arrived.events[0]?.status, 'colonized');
  const colonyId = 'planet-1-2-1';
  assert.ok(arrived.state.planets[colonyId]);
  assert.deepEqual(arrived.state.planets[colonyId].resources, { metal: 500, minerals: 500, gas: 500 });
  assert.equal(arrived.state.planets[colonyId].fleet.ships.colonizer, 0);
  assert.equal(arrived.state.planets[colonyId].buildings.hangar, 0);
  assert.equal(arrived.state.planets[colonyId].universeGalaxy, 1);
  assert.equal(arrived.state.currentPlanetId, 'helion-01');
  assert.equal(arrived.state.planets['helion-01'].fleet.ships.colonizer, 0);
  assert.equal(arrived.state.flights.records[0].phase, 'completed');
  assert.equal(arrived.state.flights.records[0].completionReason, 'colonized');
  const repeated = reconcileFlights(arrived.state, sent.flight.arrivalAt + 1);
  assert.equal(repeated.changed, false);
  assert.equal(Object.keys(repeated.state.planets).length, 2);
});

test('a reloaded arrived colonization flight resolves once and releases the reserved colonizer', () => {
  const storage = new Map<string, string>();
  const storageLike = {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => { storage.set(key, value); },
    removeItem: (key: string) => { storage.delete(key); },
  };
  const persistence = createPersistenceFacade({ mode: 'production', storage: storageLike, now: () => 1_000 });
  const sent = dispatchFlight(persistence.read(), command('reload-arrived'), 1_000);
  assert.equal(sent.ok, true);
  if (!sent.ok) return;
  const savedArrived = {
    ...sent.state,
    flights: {
      ...sent.state.flights,
      records: sent.state.flights.records.map((flight) => flight.id === sent.flight.id
        ? { ...flight, phase: 'arrived' as const, arrivedAt: flight.arrivalAt, completionReason: 'arrived' as const }
        : flight),
    },
  };
  assert.equal(persistence.write(savedArrived).ok, true);

  const reloaded = persistence.read();
  assert.equal(reloaded.flights.records[0]?.phase, 'arrived');
  const reconciled = reconcileFlights(reloaded, sent.flight.arrivalAt + 1);
  assert.equal(reconciled.events.length, 1);
  assert.equal(reconciled.events[0]?.status, 'colonized');
  assert.equal(reconciled.state.flights.records[0]?.phase, 'completed');
  assert.equal(reconciled.state.flights.records[0]?.completionReason, 'colonized');
  assert.ok(reconciled.state.planets['planet-1-2-1']);
  assert.equal(reconciled.state.planets['helion-01'].fleet.ships.colonizer, 0);

  const repeated = reconcileFlights(reconciled.state, sent.flight.arrivalAt + 2);
  assert.equal(repeated.changed, false);
  assert.equal(repeated.events.length, 0);
  assert.equal(Object.keys(repeated.state.planets).filter((id) => id.startsWith('planet-')).length, 1);
});

test('a reloaded arrived flight starts one full occupied-target return without duplicating the colony', () => {
  const storage = new Map<string, string>();
  const storageLike = {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => { storage.set(key, value); },
    removeItem: (key: string) => { storage.delete(key); },
  };
  const persistence = createPersistenceFacade({ mode: 'production', storage: storageLike, now: () => 1_000 });
  const sent = dispatchFlight(persistence.read(), command('reload-arrived-occupied', { galaxy: 1, system: 3, position: 1 }), 1_000);
  assert.equal(sent.ok, true);
  if (!sent.ok) return;
  const occupied = {
    ...sent.state.planets['helion-01'],
    name: 'Занятая после отправки цель',
    universeSystem: 3,
    universePosition: 1,
  };
  const savedArrived = {
    ...sent.state,
    planets: { ...sent.state.planets, 'occupied-after-reload': occupied },
    flights: {
      ...sent.state.flights,
      records: sent.state.flights.records.map((flight) => flight.id === sent.flight.id
        ? { ...flight, phase: 'arrived' as const, arrivedAt: flight.arrivalAt, completionReason: 'arrived' as const }
        : flight),
    },
  };
  assert.equal(persistence.write(savedArrived).ok, true);

  const reloaded = persistence.read();
  const arrival = reconcileFlights(reloaded, sent.flight.arrivalAt + 1);
  assert.equal(arrival.events[0]?.status, 'target-occupied');
  assert.equal(arrival.state.flights.records[0]?.phase, 'returning');
  assert.equal(arrival.state.flights.records[0]?.returnAt, sent.flight.arrivalAt + 1 + sent.flight.oneWayDurationMs);
  assert.equal(arrival.state.planets['helion-01'].fleet.ships.colonizer, 1);
  assert.equal(Object.keys(arrival.state.planets).filter((id) => id.startsWith('planet-')).length, 0);

  const returned = reconcileFlights(arrival.state, arrival.state.flights.records[0].returnAt!);
  assert.equal(returned.state.flights.records[0]?.phase, 'completed');
  assert.equal(returned.state.flights.records[0]?.completionReason, 'target-occupied');
  assert.equal(returned.state.planets['helion-01'].fleet.ships.colonizer, 1);
});

test('target occupied at arrival starts a full return once and completes as target-occupied', () => {
  const initial = createInitialSaveState('production', 1_000);
  const sent = dispatchFlight(initial, command('occupied-later', { galaxy: 1, system: 3, position: 1 }), 1_000);
  assert.equal(sent.ok, true);
  if (!sent.ok) return;
  const occupied = {
    ...sent.state.planets['helion-01'],
    name: 'Новая занятая цель',
    universeSystem: 3,
    universePosition: 1,
  };
  const stateAtArrival = { ...sent.state, planets: { ...sent.state.planets, 'occupied-target': occupied } };
  const arrival = reconcileFlights(stateAtArrival, sent.flight.arrivalAt);
  assert.equal(arrival.events.length, 1);
  assert.equal(arrival.events[0]?.status, 'target-occupied');
  assert.equal(arrival.state.flights.records[0].phase, 'returning');
  assert.equal(arrival.state.flights.records[0].returnAt, sent.flight.arrivalAt + sent.flight.oneWayDurationMs);
  const repeated = reconcileFlights(arrival.state, sent.flight.arrivalAt + 1);
  assert.equal(repeated.changed, false);
  assert.equal(repeated.events.length, 0);
  const returned = reconcileFlights(arrival.state, arrival.state.flights.records[0].returnAt!);
  assert.equal(returned.state.flights.records[0].phase, 'completed');
  assert.equal(returned.state.flights.records[0].completionReason, 'target-occupied');
  assert.equal(returned.state.planets['helion-01'].fleet.ships.colonizer, 1);
  assert.equal(Object.keys(returned.state.planets).filter((id) => id.startsWith('planet-')).length, 0);
});

test('late reconcile uses arrivalAt when a target was occupied at arrival but is free later', () => {
  const schedule = getUniverseTimedObjectSchedule('pirate', 1, 2, 0);
  assert.equal(schedule.present, true);
  const pirateAt = schedule.startAt + 1_000;
  const pirate = createUniverseSystem({ system: 2, nowMs: pirateAt }).positions.find((node) => node.kind === 'pirate');
  assert.ok(pirate);
  if (!pirate) return;
  const planetId = createPlanetIdForCoordinate(pirate.coordinate);

  const departedAt = schedule.startAt - 1_000;
  const sent = dispatchFlight(createInitialSaveState('production', departedAt), {
    ...command('late-arrival-occupied', pirate.coordinate),
    departedAt,
  }, departedAt);
  assert.equal(sent.ok, true);
  if (!sent.ok) return;
  assert.ok(sent.flight.arrivalAt > schedule.startAt);
  assert.ok(sent.flight.arrivalAt < schedule.expiresAt);
  const lateNow = schedule.expiresAt + 1_000;
  assert.equal(createUniverseSystem({ system: 2, nowMs: lateNow }).positions.find((node) => node.coordinate.position === pirate.coordinate.position)?.kind, 'empty');

  const reconciled = reconcileFlights(sent.state, lateNow);
  assert.equal(reconciled.events[0]?.status, 'target-occupied');
  assert.equal(reconciled.state.flights.records[0]?.phase, 'returning');
  assert.equal(reconciled.state.flights.records[0]?.returnAt, lateNow + sent.flight.oneWayDurationMs);
  assert.equal(reconciled.state.planets['helion-01'].fleet.ships.colonizer, 1);
  assert.equal(reconciled.state.planets[planetId], undefined);
});

test('late reconcile creates a colony when the target was free at arrival but became occupied later', () => {
  const schedule = getUniverseTimedObjectSchedule('pirate', 1, 2, 0);
  assert.equal(schedule.present, true);
  const pirateAt = schedule.startAt + 1_000;
  const pirate = createUniverseSystem({ system: 2, nowMs: pirateAt }).positions.find((node) => node.kind === 'pirate');
  assert.ok(pirate);
  if (!pirate) return;
  const planetId = createPlanetIdForCoordinate(pirate.coordinate);

  const departedAt = schedule.startAt - 10 * 60 * 1_000;
  const sent = dispatchFlight(createInitialSaveState('production', departedAt), {
    ...command('late-arrival-free', pirate.coordinate),
    departedAt,
  }, departedAt);
  assert.equal(sent.ok, true);
  if (!sent.ok) return;
  assert.ok(sent.flight.arrivalAt < schedule.startAt);
  const lateNow = schedule.startAt + 1_000;
  assert.equal(createUniverseSystem({ system: 2, nowMs: sent.flight.arrivalAt }).positions.find((node) => node.coordinate.position === pirate.coordinate.position)?.kind, 'empty');
  assert.equal(createUniverseSystem({ system: 2, nowMs: lateNow }).positions.find((node) => node.coordinate.position === pirate.coordinate.position)?.kind, 'pirate');

  const reconciled = reconcileFlights(sent.state, lateNow);
  assert.equal(reconciled.events[0]?.status, 'colonized');
  assert.equal(reconciled.state.flights.records[0]?.phase, 'completed');
  assert.equal(reconciled.state.flights.records[0]?.completionReason, 'colonized');
  assert.ok(reconciled.state.planets[planetId]);
  assert.equal(reconciled.state.planets['helion-01'].fleet.ships.colonizer, 0);
});

test('persisted arrived phase keeps the arrival-time occupancy result after a late reload reconcile', () => {
  const schedule = getUniverseTimedObjectSchedule('pirate', 1, 2, 0);
  assert.equal(schedule.present, true);
  const pirateAt = schedule.startAt + 1_000;
  const pirate = createUniverseSystem({ system: 2, nowMs: pirateAt }).positions.find((node) => node.kind === 'pirate');
  assert.ok(pirate);
  if (!pirate) return;
  const planetId = createPlanetIdForCoordinate(pirate.coordinate);

  const departedAt = schedule.startAt - 1_000;
  const storage = new Map<string, string>();
  const storageLike = {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => { storage.set(key, value); },
    removeItem: (key: string) => { storage.delete(key); },
  };
  const persistence = createPersistenceFacade({ mode: 'production', storage: storageLike, now: () => departedAt });
  const sent = dispatchFlight(persistence.read(), {
    ...command('reload-late-arrival-occupied', pirate.coordinate),
    departedAt,
  }, departedAt);
  assert.equal(sent.ok, true);
  if (!sent.ok) return;
  assert.ok(sent.flight.arrivalAt < schedule.expiresAt);
  const savedArrived = {
    ...sent.state,
    flights: {
      ...sent.state.flights,
      records: sent.state.flights.records.map((flight) => flight.id === sent.flight.id
        ? { ...flight, phase: 'arrived' as const, arrivedAt: flight.arrivalAt, completionReason: 'arrived' as const }
        : flight),
    },
  };
  assert.equal(persistence.write(savedArrived).ok, true);

  const lateNow = schedule.expiresAt + 1_000;
  const reloaded = persistence.read();
  assert.equal(reloaded.flights.records[0]?.phase, 'arrived');
  const reconciled = reconcileFlights(reloaded, lateNow);
  assert.equal(reconciled.events[0]?.status, 'target-occupied');
  assert.equal(reconciled.state.flights.records[0]?.phase, 'returning');
  assert.equal(reconciled.state.flights.records[0]?.returnAt, lateNow + sent.flight.oneWayDurationMs);
  assert.equal(reconciled.state.planets['helion-01'].fleet.ships.colonizer, 1);
  assert.equal(reconciled.state.planets[planetId], undefined);
});

test('a damaged save with an existing deterministic planet id returns instead of hanging outbound', () => {
  const initial = createInitialSaveState('production', 1_000);
  const sent = dispatchFlight(initial, command('damaged-planet-id'), 1_000);
  assert.equal(sent.ok, true);
  if (!sent.ok) return;
  const danglingPlanetId = 'planet-1-2-1';
  const damaged = {
    ...sent.state,
    planets: {
      ...sent.state.planets,
      [danglingPlanetId]: {
        ...sent.state.planets['helion-01'],
        name: 'Повреждённая запись',
        universeSystem: 9,
        universePosition: 9,
      },
    },
  };
  const arrived = reconcileFlights(damaged, sent.flight.arrivalAt);
  assert.equal(arrived.events[0]?.status, 'target-occupied');
  assert.match(arrived.events[0]?.notice ?? '', /Координата уже занята/);
  assert.equal(arrived.state.flights.records[0].phase, 'returning');
  assert.equal(arrived.state.planets['helion-01'].fleet.ships.colonizer, 1);

  const returned = reconcileFlights(arrived.state, arrived.state.flights.records[0].returnAt!);
  assert.equal(returned.state.flights.records[0].phase, 'completed');
  assert.equal(returned.state.flights.records[0].completionReason, 'target-occupied');
  assert.equal(returned.state.planets['helion-01'].fleet.ships.colonizer, 1);
});

test('a damaged save without the origin planet completes the flight with a clear failure and no duplicate colony', () => {
  const initial = createInitialSaveState('production', 1_000);
  const sent = dispatchFlight(initial, command('missing-origin'), 1_000);
  assert.equal(sent.ok, true);
  if (!sent.ok) return;
  const damaged = {
    ...sent.state,
    planets: {},
    queues: {},
  } as typeof sent.state;
  const reconciled = reconcileFlights(damaged, sent.flight.arrivalAt);
  assert.equal(reconciled.events[0]?.status, 'arrived');
  assert.match(reconciled.events[0]?.notice ?? '', /исходная планета не найдена/);
  assert.equal(reconciled.state.flights.records[0].phase, 'completed');
  assert.equal(reconciled.state.flights.records[0].completionReason, 'mission-failed');
  assert.equal(Object.keys(reconciled.state.planets).length, 0);
});

test('an asteroid overlay does not block a free underlying coordinate', () => {
  const now = ASTEROID_SCHEDULE_EPOCH_MS + 60 * 60 * 1_000 + 1;
  const asteroid = getUniverseAsteroidState(1, now)!;
  const system = createUniverseSystem({ system: asteroid.coordinate.system, nowMs: now });
  const underlying = system.positions.find((node) => node.coordinate.position === asteroid.coordinate.position);
  assert.equal(underlying?.kind, 'empty');

  const initial = createInitialSaveState('production', now);
  const sent = dispatchFlight(initial, {
    ...command('asteroid-overlay', asteroid.coordinate),
    targetKind: 'asteroid',
    departedAt: now,
  }, now);
  assert.equal(sent.ok, true);
  if (sent.ok) assert.equal(sent.flight.destinationCoordinate.position, asteroid.coordinate.position);
});

test('an asteroid over an occupied coordinate remains blocked', () => {
  const now = ASTEROID_SCHEDULE_EPOCH_MS + 1;
  const asteroid = getUniverseAsteroidState(0, now)!;
  const initial = createInitialSaveState('production', now);
  const occupiedTarget = {
    ...initial.planets['helion-01'],
    name: 'Планета под астероидом',
    universeGalaxy: asteroid.coordinate.galaxy,
    universeSystem: asteroid.coordinate.system,
    universePosition: asteroid.coordinate.position,
  };
  const state = { ...initial, planets: { ...initial.planets, 'occupied-under-asteroid': occupiedTarget } };
  const result = dispatchFlight(state, {
    ...command('occupied-under-asteroid', asteroid.coordinate),
    targetKind: 'asteroid',
    departedAt: now,
  }, now);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error.code, 'target-occupied');
});

test('colonization rejects non-coordinate destinations at the application boundary', () => {
  const initial = createInitialSaveState('production', 1_000);
  const result = dispatchFlight(initial, {
    ...command('planet-destination'),
    destination: { kind: 'planet', planetId: 'helion-01', coordinate: { galaxy: 1, system: 2, position: 1 } },
  }, 1_000);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error.code, 'target-not-colonizable');
  assert.equal(result.state, initial);
});

test('dispatch and arrival re-check dynamic objects while ignoring asteroid-only overlays', () => {
  const pirateSchedule = getUniverseTimedObjectSchedule('pirate', 1, 2, 0);
  assert.equal(pirateSchedule.present, true);
  const pirateNow = pirateSchedule.startAt + 1;
  const pirateSystem = createUniverseSystem({ system: 2, nowMs: pirateNow });
  const pirate = pirateSystem.positions.find((node) => node.kind === 'pirate');
  assert.ok(pirate);

  const blocked = dispatchFlight(createInitialSaveState('production', pirateNow), {
    ...command('pirate-dispatch-blocked', pirate.coordinate),
    departedAt: pirateNow,
  }, pirateNow);
  assert.equal(blocked.ok, false);
  if (!blocked.ok) assert.equal(blocked.error.code, 'target-occupied');

  const departedAt = pirateSchedule.startAt - 1_000;
  const sent = dispatchFlight(createInitialSaveState('production', departedAt), {
    ...command('pirate-arrival-blocked', pirate.coordinate),
    departedAt,
  }, departedAt);
  assert.equal(sent.ok, true);
  if (!sent.ok) return;
  assert.ok(sent.flight.arrivalAt > pirateSchedule.startAt);
  const arrival = reconcileFlights(sent.state, sent.flight.arrivalAt);
  assert.equal(arrival.events[0]?.status, 'target-occupied');
  assert.equal(arrival.state.flights.records[0].phase, 'returning');
  assert.equal(arrival.state.flights.records[0].returnAt, sent.flight.arrivalAt + sent.flight.oneWayDurationMs);
});

test('recycle requires the current explicit target kind and a recycler-only ship manifest', () => {
  const initial = withRecyclers(createInitialSaveState('production', 1_000), 4);
  const empty = emptyUniverseCoordinate();
  const withDebris = withOrbitalDebris(initial, empty.coordinate, 100);
  const invalidCommands = [
    { state: withDebris, command: recycleCommand('recycle-kind-mismatch', empty.coordinate, 'player') },
    { state: initial, command: recycleCommand('recycle-empty-no-debris', empty.coordinate, 'empty') },
    { state: withDebris, command: recycleCommand('recycle-mixed-fleet', empty.coordinate, 'empty', { recycler: 1, scout: 1 }) },
    { state: withDebris, command: recycleCommand('recycle-satellite', empty.coordinate, 'empty', { recycler: 1, 'solar-satellite': 1 }) },
    { state: withDebris, command: { ...recycleCommand('recycle-commander', empty.coordinate, 'empty'), selectedCommanders: { corsair: 1 } } },
    { state: withDebris, command: recycleCommand('recycle-asteroid-overlay-inactive', empty.coordinate, 'asteroid') },
  ];

  for (const invalid of invalidCommands) {
    const result = dispatchFlight(invalid.state, invalid.command, { now: 1_000, mode: 'production' });
    assert.equal(result.ok, false);
    assert.equal(result.state, invalid.state);
    assert.equal(result.state.flights.records.length, 0);
    assert.equal(getPlanetResources(result.state).gas, getPlanetResources(invalid.state).gas);
    assert.equal(result.state.planets['helion-01'].fleet.ships.recycler, 4);
  }
});

test('recycle snapshots catalog capacity, collects debris at arrival, and credits the origin exactly once after reload', () => {
  const empty = emptyUniverseCoordinate();
  const initial = withOrbitalDebris(withRecyclers(createInitialSaveState('production', 1_000), 1), empty.coordinate, 275);
  const expectedCapacity = getTransportCargoSummary(initial, 'helion-01', { recycler: 1 }, {}, { kind: 'coordinate', coordinate: empty.coordinate }).capacity.total;
  const storage = new Map<string, string>();
  const persistence = createPersistenceFacade({
    mode: 'production',
    storage: {
      getItem: (key) => storage.get(key) ?? null,
      setItem: (key, value) => { storage.set(key, value); },
      removeItem: (key) => { storage.delete(key); },
    },
    now: () => 1_000,
  });
  const commandWithoutCallerKind: Parameters<typeof dispatchFlight>[1] = recycleCommand('recycle-round-trip', empty.coordinate, empty.targetKind);
  delete commandWithoutCallerKind.targetKind;
  const sent = dispatchFlight(initial, commandWithoutCallerKind, 1_000);
  assert.equal(sent.ok, true);
  if (!sent.ok) return;
  assert.equal(sent.flight.recycleCapacity, expectedCapacity);
  assert.equal(sent.flight.cargo?.debris, 0);
  assert.equal(sent.flight.cargoState, 'loaded');
  assert.equal(sent.state.espionage?.orbitalDebris?.['lost-debris-target']?.debris, 275);
  assert.equal(persistence.write(sent.state).ok, true);

  const reloadedOutbound = persistence.read();
  const restoredFlight = reloadedOutbound.flights.records.find((flight) => flight.id === sent.flight.id)!;
  assert.equal(restoredFlight.recycleCapacity, expectedCapacity);
  const arrived = reconcileFlights(reloadedOutbound, restoredFlight.arrivalAt);
  const returning = arrived.state.flights.records.find((flight) => flight.id === restoredFlight.id)!;
  assert.equal(returning.phase, 'returning');
  assert.equal(returning.cargo?.debris, 275);
  assert.equal(returning.cargoState, 'delivered');
  assert.deepEqual(arrived.state.reports.recyclerArrivalReports, [{
    id: `recycler-arrival:${returning.id}`,
    flightId: returning.id,
    coordinate: empty.coordinate,
    arrivedAtMs: returning.arrivalAt,
    collectedDebris: 275,
    remainingOrbitalDebris: 0,
  }]);
  assert.match(arrived.events[0]?.notice ?? '', /275/);
  assert.equal(arrived.state.espionage?.orbitalDebris?.['lost-debris-target'], undefined);
  assert.equal(persistence.write(arrived.state).ok, true);

  const reloadedReturning = persistence.read();
  const replayedArrival = reconcileFlights(reloadedReturning, returning.arrivedAt! + 1);
  assert.equal(replayedArrival.changed, false);
  assert.equal(replayedArrival.state.flights.records.find((flight) => flight.id === returning.id)?.cargo?.debris, 275);
  assert.equal(replayedArrival.state.reports.recyclerArrivalReports?.length, 1);
  const returned = reconcileFlights(reloadedReturning, returning.returnAt!);
  assert.equal(returned.state.planets['helion-01'].recycling.availableDebris, 275);
  assert.equal(persistence.write(returned.state).ok, true);
  const replayedReturn = reconcileFlights(persistence.read(), returning.returnAt! + 1);
  assert.equal(replayedReturn.changed, false);
  assert.equal(replayedReturn.state.planets['helion-01'].recycling.availableDebris, 275);
});

test('ordered recycle arrivals contend deterministically and successive flights collect only remaining debris', () => {
  const empty = emptyUniverseCoordinate();
  const fleetState = withRecyclers(createInitialSaveState('production', 1_000), 2);
  const capacity = getTransportCargoSummary(fleetState, 'helion-01', { recycler: 1 }, {}, { kind: 'coordinate', coordinate: empty.coordinate }).capacity.total;
  const initial = withOrbitalDebris(fleetState, empty.coordinate, capacity + 333);
  const laterIdFirst = dispatchFlight(initial, recycleCommand('recycle-z', empty.coordinate, empty.targetKind), 1_000);
  assert.equal(laterIdFirst.ok, true);
  if (!laterIdFirst.ok) return;
  const earlierIdSecond = dispatchFlight(laterIdFirst.state, recycleCommand('recycle-a', empty.coordinate, empty.targetKind), 1_000);
  assert.equal(earlierIdSecond.ok, true);
  if (!earlierIdSecond.ok) return;
  assert.equal(earlierIdSecond.state.espionage?.orbitalDebris?.['lost-debris-target']?.debris, capacity + 333);

  const reordered = {
    ...earlierIdSecond.state,
    flights: { ...earlierIdSecond.state.flights, records: [...earlierIdSecond.state.flights.records].reverse() },
  };
  const arrival = reconcileFlights(reordered, Math.max(laterIdFirst.flight.arrivalAt, earlierIdSecond.flight.arrivalAt));
  const byRequest = Object.fromEntries(arrival.state.flights.records.map((flight) => [flight.requestId, flight]));
  assert.equal(byRequest['recycle-a']?.cargo?.debris, capacity);
  assert.equal(byRequest['recycle-z']?.cargo?.debris, 333);
  assert.deepEqual(
    arrival.state.reports.recyclerArrivalReports?.map((report) => [report.flightId, report.collectedDebris, report.remainingOrbitalDebris]),
    [
      [byRequest['recycle-a']?.id, capacity, 333],
      [byRequest['recycle-z']?.id, 333, 0],
    ],
  );
  assert.equal(byRequest['recycle-a']?.phase, 'returning');
  assert.equal(byRequest['recycle-z']?.phase, 'returning');
  const returned = reconcileFlights(arrival.state, byRequest['recycle-a']!.returnAt!);
  assert.equal(returned.state.planets['helion-01'].recycling.availableDebris, capacity + 333);
  assert.equal(reconcileFlights(returned.state, byRequest['recycle-a']!.returnAt! + 1).changed, false);
});

test('recycle returns an empty cargo snapshot when an earlier arrival collected all debris', () => {
  const empty = emptyUniverseCoordinate();
  const fleetState = withRecyclers(createInitialSaveState('production', 1_000), 2);
  const capacity = getTransportCargoSummary(fleetState, 'helion-01', { recycler: 1 }, {}, { kind: 'coordinate', coordinate: empty.coordinate }).capacity.total;
  const initial = withOrbitalDebris(fleetState, empty.coordinate, capacity);
  const first = dispatchFlight(initial, recycleCommand('empty-return-a', empty.coordinate, empty.targetKind), 1_000);
  assert.equal(first.ok, true);
  if (!first.ok) return;
  const second = dispatchFlight(first.state, recycleCommand('empty-return-b', empty.coordinate, empty.targetKind), 1_000);
  assert.equal(second.ok, true);
  if (!second.ok) return;

  const arrival = reconcileFlights(second.state, first.flight.arrivalAt);
  const emptyFlight = arrival.state.flights.records.find((flight) => flight.requestId === 'empty-return-b')!;
  assert.equal(emptyFlight.phase, 'returning');
  assert.equal(emptyFlight.cargo?.debris, 0);
  assert.equal(emptyFlight.cargoState, 'delivered');
  assert.equal(emptyFlight.returnAt, first.flight.arrivalAt + emptyFlight.oneWayDurationMs);
  assert.equal(arrival.state.reports.recyclerArrivalReports?.find((report) => report.flightId === emptyFlight.id)?.collectedDebris, 0);
  assert.equal(arrival.state.reports.recyclerArrivalReports?.find((report) => report.flightId === emptyFlight.id)?.remainingOrbitalDebris, 0);
});

test('recycle accepts only an active persisted asteroid overlay and snapshots the underlying coordinate kind', () => {
  const empty = emptyUniverseCoordinate();
  const initial = withOrbitalDebris(withRecyclers(createInitialSaveState('production', 1_000), 1), empty.coordinate, 100);
  const active = withAsteroidOverlay(initial, empty.coordinate);
  const sent = dispatchFlight(active, recycleCommand('recycle-active-asteroid-overlay', empty.coordinate, 'asteroid'), 1_000);
  assert.equal(sent.ok, true);
  if (sent.ok) assert.equal(sent.flight.targetKind, empty.targetKind);

  const wrongCoordinate = withAsteroidOverlay(initial, { ...empty.coordinate, position: empty.coordinate.position + 1 });
  const invalid = dispatchFlight(wrongCoordinate, recycleCommand('recycle-asteroid-wrong-coordinate', empty.coordinate, 'asteroid'), 1_000);
  assert.equal(invalid.ok, false);
  if (!invalid.ok) assert.equal(invalid.error.code, 'target-not-available');
});

test('recycler target edits resolve the current map kind, preview and dispatch the same allowed target, and reject unavailable coordinates', () => {
  const initial = withRecyclers(createInitialSaveState('production', 1_000), 1);
  const emptyTargets = createUniverseSystem({ mode: 'production', galaxy: 1, system: 1, nowMs: 1_000 })
    .positions.filter((node) => node.kind === 'empty');
  assert.ok(emptyTargets.length >= 3);
  const asteroidCoordinate = emptyTargets[0]!.coordinate;
  const editedTarget = emptyTargets[1]!;
  const unavailableTarget = emptyTargets[2]!;
  const state = withAsteroidOverlay(
    withOrbitalDebris(initial, editedTarget.coordinate, 100, 'edited-recycler-target'),
    asteroidCoordinate,
  );

  assert.equal(resolveRecycleTargetKindAtCoordinate(state, asteroidCoordinate, 1_000, 'production'), 'asteroid');
  const editedTargetKind = resolveRecycleTargetKindAtCoordinate(state, editedTarget.coordinate, 1_000, 'production');
  assert.equal(editedTargetKind, 'empty');
  const command = recycleCommand('recycle-edited-target-preview', editedTarget.coordinate, editedTargetKind!);
  const preview = previewFlight(state, command, { now: 1_000, mode: 'production' });
  assert.equal(preview.ok, true);
  if (!preview.ok) return;
  assert.deepEqual(preview.flight.destination.coordinate, editedTarget.coordinate);
  assert.equal(preview.flight.targetKind, 'empty');

  const sent = dispatchFlight(state, {
    ...command,
    requestId: 'recycle-edited-target-send',
    destination: preview.flight.destination,
    targetKind: command.targetKind,
    selectedShips: preview.flight.selectedShips,
  }, { now: 1_000, mode: 'production' });
  assert.equal(sent.ok, true);
  if (sent.ok) {
    assert.deepEqual(sent.flight.destination.coordinate, preview.flight.destination.coordinate);
    assert.equal(sent.flight.targetKind, preview.flight.targetKind);
  }

  const unavailableKind = resolveRecycleTargetKindAtCoordinate(state, unavailableTarget.coordinate, 1_000, 'production');
  const rejected = previewFlight(state, recycleCommand('recycle-edited-target-unavailable', unavailableTarget.coordinate, unavailableKind!), {
    now: 1_000,
    mode: 'production',
  });
  assert.equal(rejected.ok, false);
  if (!rejected.ok) assert.equal(rejected.error.code, 'target-not-available');
});

test('recycle arrival collects only free orbital debris and reports zero without touching hidden asteroid cargo', () => {
  const empty = emptyUniverseCoordinate();
  const twoRecyclers = withRecyclers(createInitialSaveState('production', 1_000), 2);
  const capacity = getTransportCargoSummary(twoRecyclers, 'helion-01', { recycler: 1 }, {}, { kind: 'coordinate', coordinate: empty.coordinate }).capacity.total;
  const freeDebris = capacity;
  const spawnIndex = 77;
  const initial = withGasAsteroid(
    withOrbitalDebris(twoRecyclers, empty.coordinate, freeDebris),
    empty.coordinate,
    { spawnIndex, gasYield: 9_999, gasUpdatedAt: 1_000 },
  );
  const state = { ...initial, asteroidDebrisBySpawnIndex: { [spawnIndex]: 9_999 } };
  const first = dispatchFlight(state, recycleCommand('recycle-free-debris-only', empty.coordinate, 'asteroid'), 1_000);
  assert.equal(first.ok, true);
  if (!first.ok) return;

  const firstArrival = reconcileFlights(first.state, first.flight.arrivalAt);
  const collected = firstArrival.state.flights.records.find((flight) => flight.id === first.flight.id)!;
  const firstReport = firstArrival.state.reports.recyclerArrivalReports?.find((report) => report.flightId === first.flight.id);
  assert.equal(collected.cargo?.debris, capacity);
  assert.equal(firstReport?.arrivedAtMs, first.flight.arrivalAt);
  assert.equal(firstReport?.collectedDebris, capacity);
  assert.equal(firstReport?.remainingOrbitalDebris, 0);
  assert.equal(firstArrival.state.espionage?.orbitalDebris?.['lost-debris-target'], undefined);
  assert.equal(firstArrival.state.asteroidDebrisBySpawnIndex?.[spawnIndex], 9_999);
  assert.equal(firstArrival.state.asteroidSimulation?.asteroids.find((asteroid) => asteroid.spawnIndex === spawnIndex)?.gasYield, 9_999);

  const second = dispatchFlight(firstArrival.state, recycleCommand('recycle-zero-arrival', empty.coordinate, 'asteroid'), first.flight.arrivalAt);
  assert.equal(second.ok, true);
  if (!second.ok) return;
  const secondArrival = reconcileFlights(second.state, second.flight.arrivalAt);
  const zeroReport = secondArrival.state.reports.recyclerArrivalReports?.find((report) => report.flightId === second.flight.id);
  assert.equal(zeroReport?.collectedDebris, 0);
  assert.equal(zeroReport?.remainingOrbitalDebris, 0);

  const repeated = reconcileFlights(secondArrival.state, second.flight.arrivalAt + 1);
  assert.equal(repeated.changed, false);
  assert.equal(repeated.state.reports.recyclerArrivalReports?.filter((report) => report.flightId === second.flight.id).length, 1);
  assert.equal(repeated.state.asteroidDebrisBySpawnIndex?.[spawnIndex], 9_999);
  assert.equal(repeated.state.asteroidSimulation?.asteroids.find((asteroid) => asteroid.spawnIndex === spawnIndex)?.gasYield, 9_999);
});

test('gas dispatch accepts recycler-only fleets and snapshots its target coordinates and cargo capacity', () => {
  const empty = emptyUniverseCoordinate();
  const initial = withGasAsteroid(withRecyclers(createInitialSaveState('production', 1_000), 4), empty.coordinate);
  const expectedCapacity = getTransportCargoSummary(
    initial,
    'helion-01',
    { recycler: 1 },
    {},
    { kind: 'coordinate', coordinate: empty.coordinate },
  ).capacity.total;
  assert.equal(expectedCapacity, 40_000);

  const invalidCommands = [
    gasCommand('gas-no-recycler', empty.coordinate, { scout: 1 }),
    gasCommand('gas-mixed-fleet', empty.coordinate, { recycler: 1, scout: 1 }),
    gasCommand('gas-satellite', empty.coordinate, { recycler: 1, 'solar-satellite': 1 }),
    { ...gasCommand('gas-commander', empty.coordinate), selectedCommanders: { corsair: 1 } },
  ];
  for (const command of invalidCommands) {
    const rejected = dispatchFlight(initial, command, 1_000);
    assert.equal(rejected.ok, false);
    assert.equal(rejected.state, initial);
    assert.equal(rejected.state.flights.records.length, 0);
    assert.equal(getPlanetResources(rejected.state).gas, getPlanetResources(initial).gas);
    assert.equal(rejected.state.planets['helion-01'].fleet.ships.recycler, 4);
  }

  const sent = dispatchFlight(initial, gasCommand('gas-coordinate-snapshot', empty.coordinate), 1_000);
  assert.equal(sent.ok, true);
  if (!sent.ok) return;
  assert.equal(sent.flight.missionId, 'gas');
  assert.deepEqual(sent.flight.destination, { kind: 'coordinate', coordinate: empty.coordinate });
  assert.deepEqual(sent.flight.destinationCoordinate, empty.coordinate);
  assert.equal(sent.flight.gasCapacity, expectedCapacity);
  assert.deepEqual(sent.flight.cargo, { metal: 0, minerals: 0, gas: 0, debris: 0 });

  const storage = new Map<string, string>();
  const persistence = createPersistenceFacade({
    mode: 'production',
    storage: {
      getItem: (key) => storage.get(key) ?? null,
      setItem: (key, value) => { storage.set(key, value); },
      removeItem: (key) => { storage.delete(key); },
    },
    now: () => 1_000,
  });
  assert.equal(persistence.write(sent.state).ok, true);
  const restored = persistence.read().flights.records.find((flight) => flight.id === sent.flight.id)!;
  assert.equal(restored.missionId, 'gas');
  assert.deepEqual(restored.destinationCoordinate, empty.coordinate);
  assert.equal(restored.gasCapacity, expectedCapacity);
});

test('gas miss preview remains valid when its exact flight candidate is dispatched after an asteroid moves', () => {
  const target = emptyUniverseCoordinate().coordinate;
  const departedAt = 1_000;
  const movementAt = departedAt + 1;
  const initial = withGasAsteroid(
    withRecyclers(createInitialSaveState('production', departedAt), 1),
    target,
    { spawnIndex: 87, gasYield: 100_000, gasUpdatedAt: departedAt, nextMoveAt: movementAt },
  );
  const candidate = gasCommand('gas-preview-candidate-after-movement', target);
  const preview = previewFlight(initial, candidate, { now: departedAt, mode: 'production' });
  assert.equal(preview.ok, true);
  if (!preview.ok) return;

  assert.ok(preview.flight.arrivalAt > movementAt);
  const forecastSimulation = advanceUniverseAsteroidSimulationAt(
    initial.asteroidSimulation!,
    preview.flight.arrivalAt,
    1,
  ).state;
  const forecastHit = forecastSimulation.asteroids.some((asteroid) =>
    asteroid.coordinate.galaxy === target.galaxy
      && asteroid.coordinate.system === target.system
      && asteroid.coordinate.position === target.position);
  assert.equal(forecastHit, false);

  const afterMovement = reconcileRuntime(initial, {
    planetId: 'helion-01', now: movementAt + 1, mode: 'production', testTimeScale: 10,
  });
  assert.notDeepEqual(afterMovement.state.asteroidSimulation?.asteroids[0]?.coordinate, target);

  const sent = dispatchFlight(afterMovement.state, candidate, { now: movementAt + 1, mode: 'production' });
  assert.equal(sent.ok, true);
  if (!sent.ok) return;
  assert.equal(sent.flight.departedAt, preview.flight.departedAt);
  assert.equal(sent.flight.arrivalAt, preview.flight.arrivalAt);
  assert.deepEqual(sent.flight.destinationCoordinate, preview.flight.destinationCoordinate);

  const arrival = reconcileRuntime(sent.state, {
    planetId: 'helion-01', now: preview.flight.arrivalAt, mode: 'production', testTimeScale: 10,
  });
  const report = arrival.state.reports.gasExtractionArrivalReports?.find((entry) => entry.flightId === sent.flight.id);
  const arrivedFlight = arrival.state.flights.records.find((entry) => entry.id === sent.flight.id)!;
  assert.equal(report?.outcome, forecastHit ? 'found' : 'missed');
  assert.equal(report?.gasCollected, 0);
  assert.equal(report?.scrapCollected, 0);
  assert.equal(arrivedFlight.cargo?.gas, 0);
  assert.equal(arrivedFlight.cargo?.debris, 0);
});

test('gas forecast and arrival resolve the asteroid occupying the destination coordinate, not the originally selected asteroid', () => {
  const target = emptyUniverseCoordinate().coordinate;
  const departedAt = 1_000;
  const command = gasCommand('gas-coordinate-occupant-at-arrival', target);
  const base = withRecyclers(createInitialSaveState('production', departedAt), 1);
  const initialPreview = previewFlight(base, command, { now: departedAt, mode: 'production' });
  assert.equal(initialPreview.ok, true);
  if (!initialPreview.ok) return;

  const alternateSystemCoordinate = { ...target, system: target.system === 1 ? 2 : 1 };
  const selectedNextCoordinate = {
    ...target,
    position: target.position === 1 ? 2 : target.position - 1,
  };
  const selectedAsteroid: UniverseAsteroidRuntimeState = {
    spawnIndex: 87,
    spawnedAt: departedAt,
    movementIndex: 0,
    previousMoveAt: departedAt,
    nextMoveAt: initialPreview.flight.arrivalAt,
    nextCoordinate: selectedNextCoordinate,
    gasYield: 1_000,
    gasRatePerHour: 2_500,
    gasUpdatedAt: departedAt,
    gasRemainder: 0,
    coordinate: target,
  };
  const replacementAsteroid: UniverseAsteroidRuntimeState = {
    ...selectedAsteroid,
    spawnIndex: 88,
    nextCoordinate: target,
    gasYield: 150_000,
    coordinate: alternateSystemCoordinate,
  };
  const simulation: UniverseAsteroidSimulationState = {
    version: 1,
    processedThroughAt: departedAt,
    nextSpawnIndex: 10_000,
    asteroids: [selectedAsteroid, replacementAsteroid],
  };
  const initial: SaveState = { ...base, asteroidSimulation: simulation };
  const preview = previewFlight(initial, command, { now: departedAt, mode: 'production' });
  assert.equal(preview.ok, true);
  if (!preview.ok) return;

  const forecastSimulation = advanceUniverseAsteroidSimulationAt(simulation, preview.flight.arrivalAt, 1).state;
  const forecastAsteroid = findUniverseAsteroidAtCoordinate(forecastSimulation.asteroids, target);
  assert.equal(forecastSimulation.asteroids.find((asteroid) => asteroid.spawnIndex === selectedAsteroid.spawnIndex)?.coordinate.position,
    selectedNextCoordinate.position);
  assert.equal(forecastAsteroid?.spawnIndex, replacementAsteroid.spawnIndex);

  const sent = dispatchFlight(initial, command, { now: departedAt, mode: 'production' });
  assert.equal(sent.ok, true);
  if (!sent.ok) return;
  assert.equal(sent.flight.arrivalAt, preview.flight.arrivalAt);

  const arrived = reconcileRuntime(sent.state, {
    planetId: 'helion-01',
    now: sent.flight.arrivalAt,
    mode: 'production',
    testTimeScale: 10,
  });
  const report = arrived.state.reports.gasExtractionArrivalReports?.find((entry) => entry.flightId === sent.flight.id);
  const arrivedFlight = arrived.state.flights.records.find((flight) => flight.id === sent.flight.id)!;
  const expectedGas = Math.min(
    Math.floor(advanceAsteroidGasAt(forecastAsteroid!, sent.flight.arrivalAt).gasYield / 2),
    sent.flight.gasCapacity ?? 0,
  );
  assert.equal(report?.outcome, 'found');
  assert.equal(report?.gasCollected, expectedGas);
  assert.equal(arrivedFlight.cargo?.gas, expectedGas);
  assert.notEqual(
    expectedGas,
    Math.min(
      Math.floor(advanceAsteroidGasAt(forecastSimulation.asteroids.find((asteroid) => asteroid.spawnIndex === selectedAsteroid.spawnIndex)!, sent.flight.arrivalAt).gasYield / 2),
      sent.flight.gasCapacity ?? 0,
    ),
  );
});

test('gas arrival gives gas priority and shares recycler capacity only with asteroid-carried scrap', () => {
  const empty = emptyUniverseCoordinate();
  const capacity = 40_000;
  const cases = [
    { requestId: 'gas-priority-capacity', spawnIndex: 78, gasYield: 100_000, carriedScrap: 20_000, gas: 40_000, scrap: 0 },
    { requestId: 'gas-priority-shared', spawnIndex: 79, gasYield: 50_000, carriedScrap: 30_000, gas: 25_000, scrap: 15_000 },
  ];

  for (const scenario of cases) {
    const initial = {
      ...withGasAsteroid(
        withOrbitalDebris(withRecyclers(createInitialSaveState('production', 1_000), 1), empty.coordinate, 777),
        empty.coordinate,
        { spawnIndex: scenario.spawnIndex, gasYield: scenario.gasYield, gasUpdatedAt: 3_000 },
      ),
      asteroidDebrisBySpawnIndex: { [String(scenario.spawnIndex)]: scenario.carriedScrap },
    };
    const sent = withGasArrivalAt(initial, scenario.requestId, empty.coordinate, 3_000);
    assert.ok(sent);
    if (!sent) return;

    const arrived = reconcileRuntime(sent.state, {
      planetId: 'helion-01', now: 3_000, mode: 'production', testTimeScale: 10,
    });
    const flight = arrived.state.flights.records.find((record) => record.id === sent.flight.id)!;
    const report = arrived.state.reports.gasExtractionArrivalReports?.find((entry) => entry.flightId === sent.flight.id);
    assert.equal(flight.cargo?.gas, scenario.gas);
    assert.equal(flight.cargo?.debris, scenario.scrap);
    assert.equal(flight.cargo!.gas + flight.cargo!.debris, capacity);
    assert.equal(arrived.state.asteroidSimulation?.asteroids.find((asteroid) => asteroid.spawnIndex === scenario.spawnIndex)?.gasYield, scenario.gasYield - scenario.gas);
    assert.equal(arrived.state.asteroidDebrisBySpawnIndex?.[String(scenario.spawnIndex)], scenario.carriedScrap - scenario.scrap);
    assert.equal(getOrbitalDebrisAtCoordinate(arrived.state.espionage!, empty.coordinate), 777);
    assert.equal(report?.outcome, 'found');
    assert.equal(report?.gasCollected, scenario.gas);
    assert.equal(report?.scrapCollected, scenario.scrap);
  }
});

test('gas arrival resolves a hit, a moved-away miss with explicit zero cargo, and an asteroid moved into its target', () => {
  const target = emptyUniverseCoordinate().coordinate;
  const arrivalAt = 3_000;

  const stationary = withGasArrivalAt(
    withGasAsteroid(withRecyclers(createInitialSaveState('production', 1_000), 1), target, {
      spawnIndex: 80, gasYield: 20_000, gasUpdatedAt: arrivalAt, nextMoveAt: arrivalAt + 1,
    }),
    'gas-exact-hit', target, arrivalAt,
  );
  assert.ok(stationary);
  if (!stationary) return;
  const hit = reconcileRuntime(stationary.state, {
    planetId: 'helion-01', now: arrivalAt, mode: 'production', testTimeScale: 10,
  });
  const hitFlight = hit.state.flights.records.find((flight) => flight.id === stationary.flight.id)!;
  assert.equal(hitFlight.cargo?.gas, 10_000);
  assert.equal(hit.state.reports.gasExtractionArrivalReports?.find((report) => report.flightId === hitFlight.id)?.outcome, 'found');

  const movedAway = withGasArrivalAt(
    withGasAsteroid(withRecyclers(createInitialSaveState('production', 1_000), 1), target, {
      spawnIndex: 81, gasYield: 20_000, gasUpdatedAt: arrivalAt, nextMoveAt: arrivalAt - 1,
    }),
    'gas-exact-miss', target, arrivalAt,
  );
  assert.ok(movedAway);
  if (!movedAway) return;
  const miss = reconcileRuntime(movedAway.state, {
    planetId: 'helion-01', now: arrivalAt, mode: 'production', testTimeScale: 10,
  });
  const missFlight = miss.state.flights.records.find((flight) => flight.id === movedAway.flight.id)!;
  const missReport = miss.state.reports.gasExtractionArrivalReports?.find((report) => report.flightId === missFlight.id);
  assert.equal(missFlight.cargo?.gas, 0);
  assert.equal(missFlight.cargo?.debris, 0);
  assert.equal(missReport?.outcome, 'missed');
  assert.equal(missReport?.gasCollected, 0);
  assert.equal(missReport?.scrapCollected, 0);
  assert.equal(missFlight.phase, 'returning');

  const startingCoordinate = emptyUniverseCoordinate(1, 2).coordinate;
  const arrivedCoordinate = advanceUniverseAsteroidCoordinate(startingCoordinate, 1, 1)!;
  const movedIntoTarget = withGasArrivalAt(
    withGasAsteroid(withRecyclers(createInitialSaveState('production', 1_000), 1), startingCoordinate, {
      spawnIndex: 82, gasYield: 20_000, gasUpdatedAt: arrivalAt, nextMoveAt: arrivalAt - 1,
    }),
    'gas-moved-into-target', arrivedCoordinate, arrivalAt,
  );
  assert.ok(movedIntoTarget);
  if (!movedIntoTarget) return;
  const movedHit = reconcileRuntime(movedIntoTarget.state, {
    planetId: 'helion-01', now: arrivalAt, mode: 'production', testTimeScale: 10,
  });
  const movedHitFlight = movedHit.state.flights.records.find((flight) => flight.id === movedIntoTarget.flight.id)!;
  assert.equal(movedHit.state.asteroidSimulation?.asteroids.find((asteroid) => asteroid.spawnIndex === 82)?.coordinate.position, arrivedCoordinate.position);
  assert.equal(movedHitFlight.cargo?.gas, 10_000);
  assert.equal(movedHit.state.reports.gasExtractionArrivalReports?.find((report) => report.flightId === movedHitFlight.id)?.outcome, 'found');
});

test('asteroid movement wins an exact-millisecond tie with gas arrival', () => {
  const empty = emptyUniverseCoordinate();
  const arrivalAt = 3_000;
  const sent = withGasArrivalAt(
    withGasAsteroid(withRecyclers(createInitialSaveState('production', 1_000), 1), empty.coordinate, {
      spawnIndex: 83, gasYield: 50_000, gasUpdatedAt: arrivalAt, nextMoveAt: arrivalAt,
    }),
    'gas-movement-tie', empty.coordinate, arrivalAt,
  );
  assert.ok(sent);
  if (!sent) return;

  const reconciled = reconcileRuntime(sent.state, {
    planetId: 'helion-01', now: arrivalAt, mode: 'production', testTimeScale: 10,
  });
  const flight = reconciled.state.flights.records.find((record) => record.id === sent.flight.id)!;
  const report = reconciled.state.reports.gasExtractionArrivalReports?.find((entry) => entry.flightId === flight.id);
  assert.equal(reconciled.state.asteroidSimulation?.asteroids.find((asteroid) => asteroid.spawnIndex === 83)?.coordinate.position,
    advanceUniverseAsteroidCoordinate(empty.coordinate, 1, 1)?.position);
  assert.equal(flight.cargo?.gas, 0);
  assert.equal(flight.cargo?.debris, 0);
  assert.equal(report?.outcome, 'missed');
  assert.equal(report?.gasCollected, 0);
  assert.equal(report?.scrapCollected, 0);
});

test('gas depletion keeps exactly 1,000 reserve and removes an asteroid with 999 plus its carried scrap', () => {
  const empty = emptyUniverseCoordinate();
  const cases = [
    { requestId: 'gas-keeps-one-thousand', spawnIndex: 84, gasYield: 2_000, remainingGas: 1_000, remains: true },
    { requestId: 'gas-removes-nine-ninety-nine', spawnIndex: 85, gasYield: 1_998, remainingGas: 999, remains: false },
  ];

  for (const scenario of cases) {
    const initial = {
      ...withGasAsteroid(withRecyclers(createInitialSaveState('production', 1_000), 1), empty.coordinate, {
        spawnIndex: scenario.spawnIndex, gasYield: scenario.gasYield, gasUpdatedAt: 3_000,
      }),
      asteroidDebrisBySpawnIndex: { [String(scenario.spawnIndex)]: 50_000 },
    };
    const sent = withGasArrivalAt(initial, scenario.requestId, empty.coordinate, 3_000);
    assert.ok(sent);
    if (!sent) return;
    const arrived = reconcileRuntime(sent.state, {
      planetId: 'helion-01', now: 3_000, mode: 'production', testTimeScale: 10,
    });
    const flight = arrived.state.flights.records.find((record) => record.id === sent.flight.id)!;
    const asteroid = arrived.state.asteroidSimulation?.asteroids.find((item) => item.spawnIndex === scenario.spawnIndex);
    assert.equal(flight.cargo?.gas, Math.floor(scenario.gasYield / 2));
    assert.equal(flight.cargo?.debris, 40_000 - Math.floor(scenario.gasYield / 2));
    assert.equal(asteroid?.gasYield, scenario.remains ? scenario.remainingGas : undefined);
    assert.equal(Boolean(asteroid), scenario.remains);
    if (scenario.remains) {
      assert.equal(arrived.state.asteroidDebrisBySpawnIndex?.[String(scenario.spawnIndex)], 11_000);
    } else {
      assert.equal(arrived.state.asteroidDebrisBySpawnIndex?.[String(scenario.spawnIndex)], undefined);
    }
  }
});

test('simultaneous gas arrivals use stable flight order and replay without harvesting twice', () => {
  const empty = emptyUniverseCoordinate();
  const initial = withGasAsteroid(withRecyclers(createInitialSaveState('production', 1_000), 2), empty.coordinate, {
    spawnIndex: 86, gasYield: 100_000, gasUpdatedAt: 3_000,
  });
  const firstDispatch = withGasArrivalAt(initial, 'gas-z', empty.coordinate, 3_000);
  assert.ok(firstDispatch);
  if (!firstDispatch) return;
  const secondDispatch = withGasArrivalAt(firstDispatch.state, 'gas-a', empty.coordinate, 3_000);
  assert.ok(secondDispatch);
  if (!secondDispatch) return;
  const reordered = {
    ...secondDispatch.state,
    flights: { ...secondDispatch.state.flights, records: [...secondDispatch.state.flights.records].reverse() },
  };

  const arrived = reconcileRuntime(reordered, {
    planetId: 'helion-01', now: 3_000, mode: 'production', testTimeScale: 10,
  });
  const byRequest = Object.fromEntries(arrived.state.flights.records.map((flight) => [flight.requestId, flight]));
  assert.equal(byRequest['gas-a']?.cargo?.gas, 40_000);
  assert.equal(byRequest['gas-z']?.cargo?.gas, 30_000);
  assert.equal(arrived.state.asteroidSimulation?.asteroids.find((asteroid) => asteroid.spawnIndex === 86)?.gasYield, 30_000);
  assert.deepEqual(
    arrived.state.reports.gasExtractionArrivalReports?.map((report) => [report.flightId, report.gasCollected]),
    [[byRequest['gas-a']?.id, 40_000], [byRequest['gas-z']?.id, 30_000]],
  );

  const replay = reconcileRuntime(arrived.state, {
    planetId: 'helion-01', now: 3_000, mode: 'production', testTimeScale: 10,
  });
  assert.equal(replay.changed, false);
  assert.equal(replay.state.asteroidSimulation?.asteroids.find((asteroid) => asteroid.spawnIndex === 86)?.gasYield, 30_000);
  assert.equal(replay.state.reports.gasExtractionArrivalReports?.length, 2);
});

test('gas cargo is credited to the origin exactly once after a reload', () => {
  const empty = emptyUniverseCoordinate();
  const initial = {
    ...withGasAsteroid(withRecyclers(createInitialSaveState('production', 1_000), 1), empty.coordinate, {
      spawnIndex: 87, gasYield: 20_000, gasUpdatedAt: 3_000,
    }),
    asteroidDebrisBySpawnIndex: { '87': 2_000 },
  };
  const sent = withGasArrivalAt(initial, 'gas-cargo-return', empty.coordinate, 3_000);
  assert.ok(sent);
  if (!sent) return;
  const arrival = reconcileRuntime(sent.state, {
    planetId: 'helion-01', now: 3_000, mode: 'production', testTimeScale: 10,
  });
  const returning = arrival.state.flights.records.find((flight) => flight.id === sent.flight.id)!;
  assert.equal(returning.cargo?.gas, 10_000);
  assert.equal(returning.cargo?.debris, 2_000);
  assert.equal(returning.cargoState, 'delivered');

  const gasBeforeReturn = getPlanetResources(arrival.state).gas;
  const storage = new Map<string, string>();
  const persistence = createPersistenceFacade({
    mode: 'production',
    storage: {
      getItem: (key) => storage.get(key) ?? null,
      setItem: (key, value) => { storage.set(key, value); },
      removeItem: (key) => { storage.delete(key); },
    },
    now: () => returning.returnAt!,
  });
  assert.equal(persistence.write(arrival.state).ok, true);
  const returned = reconcileFlights(persistence.read(), returning.returnAt!);
  assert.equal(getPlanetResources(returned.state).gas, gasBeforeReturn + 10_000);
  assert.equal(returned.state.planets['helion-01'].recycling.availableDebris, 2_000);
  assert.equal(persistence.write(returned.state).ok, true);

  const replay = reconcileFlights(persistence.read(), returning.returnAt! + 1);
  assert.equal(replay.changed, false);
  assert.equal(getPlanetResources(replay.state).gas, gasBeforeReturn + 10_000);
  assert.equal(replay.state.planets['helion-01'].recycling.availableDebris, 2_000);
});

test('recycle follows return policy if the origin disappears after collection', () => {
  const empty = emptyUniverseCoordinate();
  const initial = withOrbitalDebris(withRecyclers(createInitialSaveState('production', 1_000), 1), empty.coordinate, 50);
  const sent = dispatchFlight(initial, recycleCommand('recycle-origin-lost', empty.coordinate, empty.targetKind), 1_000);
  assert.equal(sent.ok, true);
  if (!sent.ok) return;
  const arrival = reconcileFlights(sent.state, sent.flight.arrivalAt);
  const returning = arrival.state.flights.records[0]!;
  const planets: Partial<SaveState['planets']> = { ...arrival.state.planets };
  delete planets['helion-01'];
  const withoutOrigin = { ...arrival.state, planets: planets as SaveState['planets'] };
  const returned = reconcileFlights(withoutOrigin, returning.returnAt!);
  const completed = returned.state.flights.records[0]!;
  assert.equal(completed.phase, 'completed');
  assert.equal(completed.cargoState, 'returned');
  assert.equal(returned.state.planets['helion-01'], undefined);
});

test('a 13:41 attack makes debris available to the 13:42 recycle arrival in the same reconcile pass', () => {
  const base = withRecyclers(createInitialSaveState('test', 1_000), 1);
  const target = Object.values(base.espionage!.targets!)[0]!;
  assert.ok(target.kind);
  if (!target.kind) return;
  const attack = dispatchFlight(base, {
    requestId: 'ordered-attack-1341',
    missionId: 'attack',
    originPlanetId: base.currentPlanetId,
    destination: { kind: 'planet', planetId: target.id, coordinate: target.coordinate },
    targetKind: target.kind,
    targetRelation: 'neutral',
    targetOwnerId: target.ownerId,
    selectedShips: { scout: 10 },
    selectedCommanders: {},
    maxRounds: 5,
    departedAt: 1_000,
  }, { now: 1_000, mode: 'test', testTimeScale: 15 });
  assert.equal(attack.ok, true);
  if (!attack.ok) return;
  const recycler = dispatchFlight(attack.state, {
    ...recycleCommand('ordered-recycle-1342', target.coordinate, target.kind),
    departedAt: 1_000,
  }, { now: 1_000, mode: 'test', testTimeScale: 15 });
  assert.equal(recycler.ok, true);
  if (!recycler.ok) return;

  const at1341 = 13 * 60 * 60 * 1_000 + 41 * 60 * 1_000;
  const at1342 = at1341 + 60_000;
  const staged = {
    ...recycler.state,
    flights: {
      ...recycler.state.flights,
      records: recycler.state.flights.records.map((flight) => ({
        ...flight,
        arrivalAt: flight.missionId === 'attack' ? at1341 : at1342,
      })),
    },
  };
  const arrival = reconcileFlights(staged, at1342, undefined, { mode: 'test', testTimeScale: 15 });
  const attackFlight = arrival.state.flights.records.find((flight) => flight.requestId === 'ordered-attack-1341')!;
  const recycleFlight = arrival.state.flights.records.find((flight) => flight.requestId === 'ordered-recycle-1342')!;
  assert.ok((attackFlight.attackResolution?.debris ?? 0) > 0);
  assert.equal(recycleFlight.cargo?.debris, attackFlight.attackResolution?.debris);
  assert.deepEqual(arrival.events.map((event) => event.status), ['arrived', 'delivered']);
});

test('colony actions spend the colony wallet without changing the homeworld alias', () => {
  const initial = createInitialSaveState('production', 1_000);
  const sent = dispatchFlight(initial, command('colony-wallet'), 1_000);
  assert.equal(sent.ok, true);
  if (!sent.ok) return;
  const colonized = reconcileFlights(sent.state, sent.flight.arrivalAt).state;
  const colonyId = 'planet-1-2-1';
  const beforeHomeworld = { metal: colonized.metal, minerals: colonized.minerals, gas: colonized.gas };
  const started = startBuilding(colonized, {
    planetId: colonyId,
    now: sent.flight.arrivalAt,
    mode: 'production',
    testTimeScale: 1,
  }, 'basic-energy');
  assert.equal(started.ok, true);
  assert.deepEqual(
    { metal: started.state.metal, minerals: started.state.minerals, gas: started.state.gas },
    beforeHomeworld,
  );
  assert.deepEqual(started.state.planets[colonyId].resources, { metal: 425, minerals: 470, gas: 500 });
});

test('Test Mode seeds one persisted ally and Production keeps the fixture boundary empty', () => {
  const testState = createInitialSaveState('test', 1_000);
  const productionState = createInitialSaveState('production', 1_000);
  assert.equal(testState.planets['helion-01'].recycling.availableDebris, 100_000);
  assert.equal(Object.keys(testState.alliedPlanets ?? {}).length, 1);
  assert.equal(testState.alliedPlanets?.['test-mode-ally-ira-vel-v1'].ownerId, 'member-ira-vel');
  assert.equal(productionState.planets['helion-01'].recycling.availableDebris, 0);
  assert.deepEqual(productionState.alliedPlanets, {});
});

test('a destroyed authoritative Test Mode target leaves its coordinate colonizable', () => {
  const base = createInitialSaveState('test', 1_000);
  const target = Object.values(base.espionage!.targets!)[0]!;
  const remainingTargets = Object.fromEntries(
    Object.entries(base.espionage!.targets!).filter(([targetId]) => targetId !== target.id),
  );
  const destroyedTargetState = {
    ...base,
    espionage: {
      ...base.espionage!,
      targets: remainingTargets,
      bot01Planets: remainingTargets,
    },
  };
  const result = dispatchFlight(destroyedTargetState, {
    requestId: 'colonize-destroyed-target-coordinate',
    missionId: 'colonize',
    originPlanetId: 'helion-01',
    destination: { kind: 'coordinate', coordinate: target.coordinate },
    targetKind: 'empty',
    selectedShips: { colonizer: 1 },
    departedAt: 1_000,
  }, { now: 1_000, mode: 'test', testTimeScale: 15 });

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.flight.destinationCoordinate, target.coordinate);

  const arrival = reconcileFlights(result.state, result.flight.arrivalAt, undefined, {
    mode: 'test',
    testTimeScale: 15,
  });
  assert.equal(arrival.events[0]?.status, 'colonized');
  assert.ok(arrival.state.planets[createPlanetIdForCoordinate(target.coordinate)]);
});

test('transport dispatches an atomic cargo snapshot to the Test Mode ally and returns empty', () => {
  const initial = createInitialSaveState('test', 1_000);
  const destination = {
    kind: 'planet' as const,
    planetId: 'test-mode-ally-ira-vel-v1',
    coordinate: { galaxy: 1, system: 1, position: 2 },
  };
  const sent = dispatchFlight(initial, {
    requestId: 'transport-ally-1',
    missionId: 'transport',
    originPlanetId: 'helion-01',
    destination,
    targetRelation: 'ally',
    selectedShips: { scout: 1 },
    cargo: { metal: 100, minerals: 50, gas: 25, debris: 75 },
    departedAt: 1_000,
  }, { now: 1_000, mode: 'test' });
  assert.equal(sent.ok, true);
  if (!sent.ok) return;
  assert.deepEqual(sent.flight.cargo, { metal: 100, minerals: 50, gas: 25, debris: 75 });
  assert.equal(sent.flight.cargoState, 'loaded');
  assert.equal(sent.state.planets['helion-01'].recycling.availableDebris, 99_925);
  assert.equal(sent.state.planets['helion-01'].resources!.metal, initial.planets['helion-01'].resources!.metal - 100);
  const retried = dispatchFlight(sent.state, {
    requestId: 'transport-ally-1',
    missionId: 'transport',
    originPlanetId: 'helion-01',
    destination,
    targetRelation: 'ally',
    selectedShips: { scout: 20 },
    cargo: { metal: 999_999, minerals: 999_999, gas: 999_999, debris: 999_999 },
    departedAt: 9_000,
  }, { now: 9_000, mode: 'test' });
  assert.equal(retried.ok, true);
  if (!retried.ok) return;
  assert.equal(retried.created, false);
  assert.equal(retried.flight.id, sent.flight.id);
  assert.equal(retried.state.planets['helion-01'].resources!.metal, sent.state.planets['helion-01'].resources!.metal);

  const arrival = reconcileFlights(sent.state, sent.flight.arrivalAt);
  assert.equal(arrival.events[0]?.status, 'delivered');
  assert.equal(arrival.events[0]?.notice, 'Груз доставлен. Корабли возвращаются.');
  assert.equal(arrival.state.alliedPlanets?.[destination.planetId].resources?.metal, 600);
  assert.equal(arrival.state.alliedPlanets?.[destination.planetId].recycling.availableDebris, 100_075);
  assert.equal(arrival.state.flights.records[0].phase, 'returning');
  assert.equal(arrival.state.flights.records[0].cargoState, 'delivered');

  const returned = reconcileFlights(arrival.state, arrival.state.flights.records[0].returnAt!);
  assert.equal(returned.events[0]?.status, 'returned');
  assert.equal(returned.state.flights.records[0].phase, 'completed');
  assert.equal(returned.state.flights.records[0].cargoState, 'delivered');
  assert.equal(returned.state.planets['helion-01'].resources!.metal, sent.state.planets['helion-01'].resources!.metal);
  assert.equal(reconcileFlights(returned.state, arrival.state.flights.records[0].returnAt! + 1).changed, false);
});

test('transport overflow keeps the pre-send warning but uses the normal delivery notice', () => {
  const initial = createInitialSaveState('test', 1_000);
  const destination = {
    kind: 'planet' as const,
    planetId: 'test-mode-ally-ira-vel-v1',
    coordinate: { galaxy: 1, system: 1, position: 2 },
  };
  const ally = initial.alliedPlanets?.[destination.planetId];
  assert.ok(ally);
  if (!ally) return;
  const capacities = getStorageCapacities(ally.buildings);
  const fullTarget = replaceAlliedPlanetState(initial, destination.planetId, {
    ...ally,
    resources: {
      metal: capacities.metal,
      minerals: capacities.minerals,
      gas: capacities.gas,
    },
  });
  const sent = dispatchFlight(fullTarget, {
    requestId: 'transport-overflow-notice',
    missionId: 'transport',
    originPlanetId: 'helion-01',
    destination,
    targetRelation: 'ally',
    selectedShips: { scout: 1 },
    cargo: { metal: 100, minerals: 0, gas: 0, debris: 0 },
    departedAt: 1_000,
  }, { now: 1_000, mode: 'test' });
  assert.equal(sent.ok, true);
  if (!sent.ok) return;
  assert.equal(sent.flight.overflowWarning, true);

  const arrival = reconcileFlights(sent.state, sent.flight.arrivalAt);
  assert.equal(arrival.events[0]?.status, 'delivered');
  assert.equal(arrival.events[0]?.notice, 'Груз доставлен. Корабли возвращаются.');
  assert.doesNotMatch(arrival.events[0]?.notice ?? '', /переполн|потерян/i);
});

test('manual coordinate cargo summary warns when the matched allied storage is full', () => {
  const initial = createInitialSaveState('test', 1_000);
  const destination = {
    kind: 'coordinate' as const,
    coordinate: { galaxy: 1, system: 1, position: 2 },
  };
  const ally = initial.alliedPlanets?.['test-mode-ally-ira-vel-v1'];
  assert.ok(ally);
  if (!ally) return;
  const capacities = getStorageCapacities(ally.buildings);
  const fullTarget = replaceAlliedPlanetState(initial, ally.id, {
    ...ally,
    resources: {
      metal: capacities.metal,
      minerals: capacities.minerals,
      gas: capacities.gas,
    },
  });
  const summary = getTransportCargoSummary(
    fullTarget,
    'helion-01',
    { scout: 1 },
    { metal: 100, minerals: 0, gas: 0, debris: 0 },
    destination,
  );
  assert.equal(summary.cargo.metal, 100);
  assert.equal(summary.overflowWarning, true);
});

test('transport recall returns loaded cargo using the current source caps and never refunds gas', () => {
  const initial = createInitialSaveState('test', 1_000);
  const sent = dispatchFlight(initial, {
    requestId: 'transport-recall-1',
    missionId: 'transport',
    destination: {
      kind: 'planet',
      planetId: 'test-mode-ally-ira-vel-v1',
      coordinate: { galaxy: 1, system: 1, position: 2 },
    },
    targetRelation: 'ally',
    selectedShips: { scout: 1 },
    cargo: { metal: 100, minerals: 0, gas: 0, debris: 25 },
    departedAt: 1_000,
  }, { now: 1_000, mode: 'test' });
  assert.equal(sent.ok, true);
  if (!sent.ok) return;
  const gasAfterSend = sent.state.planets['helion-01'].resources!.gas;
  const recalled = recallFlight(sent.state, sent.flight.id, sent.flight.departedAt + 1_000);
  assert.equal(recalled.ok, true);
  if (!recalled.ok) return;
  assert.equal(recalled.flight.cargoState, 'loaded');
  assert.equal(recalled.state.planets['helion-01'].resources!.gas, gasAfterSend);
  const returned = reconcileFlights(recalled.state, recalled.flight.returnAt!);
  assert.equal(returned.state.flights.records[0].cargoState, 'returned');
  assert.equal(returned.state.planets['helion-01'].resources!.metal, initial.planets['helion-01'].resources!.metal);
  assert.equal(returned.state.planets['helion-01'].recycling.availableDebris, 100_000);
});

test('transport voids cargo when the allied target disappears and keeps the flight until empty return', () => {
  const initial = createInitialSaveState('test', 1_000);
  const sent = dispatchFlight(initial, {
    requestId: 'transport-void-1',
    missionId: 'transport',
    destination: {
      kind: 'planet',
      planetId: 'test-mode-ally-ira-vel-v1',
      coordinate: { galaxy: 1, system: 1, position: 2 },
    },
    targetRelation: 'ally',
    selectedShips: { scout: 1 },
    cargo: { metal: 100, minerals: 0, gas: 0, debris: 50 },
    departedAt: 1_000,
  }, { now: 1_000, mode: 'test' });
  assert.equal(sent.ok, true);
  if (!sent.ok) return;
  const destroyed = { ...sent.state, alliedPlanets: {} };
  const arrival = reconcileFlights(destroyed, sent.flight.arrivalAt);
  assert.equal(arrival.events[0]?.status, 'target-unavailable');
  assert.equal(arrival.state.flights.records[0].cargoState, 'voided');
  assert.equal(arrival.state.flights.records[0].phase, 'returning');
  const returned = reconcileFlights(arrival.state, arrival.state.flights.records[0].returnAt!);
  assert.equal(returned.state.flights.records[0].phase, 'completed');
  assert.equal(returned.state.flights.records[0].cargoState, 'voided');
  assert.equal(returned.state.planets['helion-01'].resources!.metal, sent.state.planets['helion-01'].resources!.metal);
});

test('transport cargo and ally state survive the existing persistence facade without duplication', () => {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
  };
  const persistence = createPersistenceFacade({ mode: 'test', storage, now: () => 1_000 });
  const initial = persistence.read();
  const sent = dispatchFlight(initial, {
    requestId: 'transport-persist-1',
    missionId: 'transport',
    destination: {
      kind: 'planet',
      planetId: 'test-mode-ally-ira-vel-v1',
      coordinate: { galaxy: 1, system: 1, position: 2 },
    },
    targetRelation: 'ally',
    selectedShips: { scout: 1 },
    cargo: { metal: 100, minerals: 0, gas: 0, debris: 10 },
    departedAt: 1_000,
  }, { now: 1_000, mode: 'test' });
  assert.equal(sent.ok, true);
  if (!sent.ok) return;
  assert.equal(persistence.write(sent.state).ok, true);
  const reloaded = persistence.read();
  assert.equal(Object.keys(reloaded.alliedPlanets ?? {}).length, 1);
  assert.equal(reloaded.flights.records[0].cargoState, 'loaded');
  const arrived = reconcileFlights(reloaded, sent.flight.arrivalAt);
  assert.equal(persistence.write(arrived.state).ok, true);
  const reloadedArrived = persistence.read();
  assert.equal(reloadedArrived.flights.records[0].cargoState, 'delivered');
  assert.equal(reloadedArrived.alliedPlanets?.['test-mode-ally-ira-vel-v1'].recycling.availableDebris, 100_010);
  const repeated = reconcileFlights(reloadedArrived, sent.flight.arrivalAt + 1);
  assert.equal(repeated.changed, false);
  assert.equal(Object.keys(repeated.state.alliedPlanets ?? {}).length, 1);
});

function stateWithDeploymentTarget(now = 1_000): { state: SaveState; targetId: string; targetCoordinate: { galaxy: number; system: number; position: number } } {
  const initial = createInitialSaveState('production', now);
  const targetCoordinate = { galaxy: 1, system: 2, position: 1 };
  const colonizer = dispatchFlight(initial, {
    requestId: 'deployment-fixture-colonizer',
    missionId: 'colonize',
    originPlanetId: 'helion-01',
    destination: { kind: 'coordinate', coordinate: targetCoordinate },
    targetKind: 'empty',
    selectedShips: { colonizer: 1 },
    departedAt: now,
  }, now);
  assert.equal(colonizer.ok, true);
  if (!colonizer.ok) throw new Error('fixture colonizer dispatch failed');
  const colonized = reconcileFlights(colonizer.state, colonizer.flight.arrivalAt).state;
  const targetId = createPlanetIdForCoordinate(targetCoordinate);
  const source = colonized.planets['helion-01'];
  return {
    state: {
      ...colonized,
      shipUpgradeLevels: { ...(colonized.shipUpgradeLevels ?? {}), corsair: 7 },
      planets: {
        ...colonized.planets,
        'helion-01': {
          ...source,
          fleet: {
            ...source.fleet,
            ships: { ...source.fleet.ships, scout: 42 },
            commanders: { ...source.fleet.commanders, corsair: 1 },
          },
          spaceportUpgrades: { ...source.spaceportUpgrades, shipLevels: {} },
        },
      },
    },
    targetId,
    targetCoordinate,
  };
}

test('Space Flight accepts commander-only fleets, enforces duration and gas rules, and excludes satellites', () => {
  const initial = createInitialSaveState('test', 1_000);
  const commanderOnly = withSpaceFlightFleet(initial, {}, { corsair: 1 });
  const minimum = dispatchFlight(commanderOnly, spaceFlightCommand('space-minimum', {
    commanders: { corsair: 1 },
    minutes: 5,
  }), { now: 1_000, mode: 'test', testTimeScale: 1 });
  assert.equal(minimum.ok, true);
  if (!minimum.ok) return;
  assert.equal(minimum.flight.oneWayDurationMs, 5 * 60_000);
  assert.equal(minimum.flight.routeDistance, 0);
  assert.equal(minimum.flight.effectiveSpeed, 0);
  assert.equal(minimum.flight.gasCost, 100);
  assert.equal(minimum.state.planets['helion-01'].resources!.gas, commanderOnly.planets['helion-01'].resources!.gas - 100);
  assert.equal(getAvailableFleetForPlanet(minimum.state, 'helion-01').commanders.corsair, 0);
  const duplicateCommander = dispatchFlight(minimum.state, spaceFlightCommand('space-minimum-duplicate', {
    commanders: { corsair: 1 },
  }), { now: 1_001, mode: 'test', testTimeScale: 1 });
  assert.equal(duplicateCommander.ok, false);

  const maximum = dispatchFlight(withSpaceFlightFleet(initial, { scout: 1 }), spaceFlightCommand('space-maximum', {
    ships: { scout: 1 },
    minutes: 11 * 60 + 59,
  }), { now: 1_000, mode: 'test', testTimeScale: 1 });
  assert.equal(maximum.ok, true);
  if (maximum.ok) assert.equal(maximum.flight.oneWayDurationMs, (11 * 60 + 59) * 60_000);

  for (const [requestId, options] of [
    ['space-too-short', { ships: { scout: 1 }, minutes: 4 }],
    ['space-wrong-step', { ships: { scout: 1 }, minutes: 5.5 }],
    ['space-too-long', { ships: { scout: 1 }, minutes: 12 * 60 }],
    ['space-empty', { minutes: 5 }],
  ] as const) {
    const invalid = dispatchFlight(withSpaceFlightFleet(initial, { scout: 1 }), spaceFlightCommand(requestId, options), {
      now: 1_000,
      mode: 'test',
      testTimeScale: 1,
    });
    assert.equal(invalid.ok, false, requestId);
  }

  const satellite = dispatchFlight(withSpaceFlightFleet(initial, { 'solar-satellite': 1 }), spaceFlightCommand('space-satellite', {
    ships: { 'solar-satellite': 1 },
  }), { now: 1_000, mode: 'test', testTimeScale: 1 });
  assert.equal(satellite.ok, false);

  const lowGas = replacePlanetResources(withSpaceFlightFleet(initial, { scout: 1 }), 'helion-01', {
    ...getPlanetResources(initial, 'helion-01'),
    gas: 99,
  });
  const noGas = dispatchFlight(lowGas, spaceFlightCommand('space-no-gas', { ships: { scout: 1 } }), {
    now: 1_000,
    mode: 'test',
    testTimeScale: 1,
  });
  assert.equal(noGas.ok, false);
  if (!noGas.ok) assert.equal(noGas.error.code, 'insufficient-gas');
});

test('Test Mode keeps a scaled Space Flight across reload, even after the speed setting changes', () => {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
  };
  const fastPersistence = createPersistenceFacade({ mode: 'test', storage, now: () => 1_000, testTimeScale: 15 });
  const initial = withSpaceFlightFleet(fastPersistence.read(), {}, { hunter: 1 });
  const sent = dispatchFlight(initial, spaceFlightCommand('space-accelerated-reload', {
    commanders: { hunter: 1 },
    minutes: 5,
  }), { now: 1_000, mode: 'test', testTimeScale: 15 });
  assert.equal(sent.ok, true);
  if (!sent.ok) return;
  assert.equal(sent.flight.oneWayDurationMs, 20_000);
  assert.equal(fastPersistence.write(sent.state).ok, true);

  const slowerPersistence = createPersistenceFacade({ mode: 'test', storage, now: () => 1_001, testTimeScale: 1 });
  const reloaded = slowerPersistence.read();
  const persisted = reloaded.flights.records.filter((flight) => flight.missionId === 'space-flight');
  assert.equal(persisted.length, 1);
  assert.ok(persisted[0]);
  if (!persisted[0]) return;
  assert.equal(persisted[0].oneWayDurationMs, 20_000);
  assert.equal(persisted[0].selectedCommanders?.hunter, 1);
  assert.equal(getAvailableFleetForPlanet(reloaded, 'helion-01').commanders.hunter, 0);
});

test('Space Flight returns cargo after its full round trip and catches up once after reload', () => {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
  };
  const persistence = createPersistenceFacade({ mode: 'test', storage, now: () => 1_000 });
  const initial = withSpaceFlightFleet(persistence.read(), { transporter: 1 }, { corsair: 1 });
  const startingResources = getPlanetResources(initial, 'helion-01');
  const startingDebris = initial.planets['helion-01'].recycling.availableDebris;
  const cargo = { metal: 70, minerals: 40, gas: 25, debris: 90 };
  const sent = dispatchFlight(initial, spaceFlightCommand('space-cargo-round-trip', {
    ships: { transporter: 1 },
    commanders: { corsair: 1 },
    minutes: 5,
    cargo,
  }), { now: 1_000, mode: 'test', testTimeScale: 1 });
  assert.equal(sent.ok, true);
  if (!sent.ok) return;
  assert.equal(sent.flight.gasCost, 100);
  assert.equal(sent.flight.cargoState, 'loaded');
  assert.deepEqual(getPlanetResources(sent.state, 'helion-01'), {
    metal: startingResources.metal - cargo.metal,
    minerals: startingResources.minerals - cargo.minerals,
    gas: startingResources.gas - cargo.gas - 100,
  });
  assert.equal(sent.state.planets['helion-01'].recycling.availableDebris, startingDebris - cargo.debris);
  assert.equal(getAvailableFleetForPlanet(sent.state, 'helion-01').ships.transporter, 0);
  assert.equal(getAvailableFleetForPlanet(sent.state, 'helion-01').commanders.corsair, 0);
  const duplicateHull = dispatchFlight(sent.state, spaceFlightCommand('space-transporter-already-reserved', {
    ships: { transporter: 1 },
  }), { now: 1_001, mode: 'test', testTimeScale: 1 });
  assert.equal(duplicateHull.ok, false);
  assert.equal(persistence.write(sent.state).ok, true);

  const reloaded = persistence.read();
  const restored = reloaded.flights.records.find((flight) => flight.requestId === sent.flight.requestId);
  assert.ok(restored);
  if (!restored) return;
  const returnAt = restored.arrivalAt + restored.oneWayDurationMs;
  const caughtUp = reconcileFlights(reloaded, returnAt);
  const completed = caughtUp.state.flights.records.find((flight) => flight.id === restored.id);
  assert.equal(completed?.phase, 'completed');
  assert.equal(completed?.completionReason, 'normal-return');
  assert.equal(completed?.cargoState, 'returned');
  assert.equal(completed?.returnAt, returnAt);
  assert.deepEqual(getPlanetResources(caughtUp.state, 'helion-01'), {
    metal: startingResources.metal,
    minerals: startingResources.minerals,
    gas: startingResources.gas - 100,
  });
  assert.equal(caughtUp.state.planets['helion-01'].recycling.availableDebris, startingDebris);
  assert.deepEqual(caughtUp.events.map((event) => event.status), ['arrived', 'returned']);
  assert.equal(persistence.write(caughtUp.state).ok, true);
  const replay = reconcileFlights(persistence.read(), returnAt + 1);
  assert.equal(replay.changed, false);
  assert.deepEqual(getPlanetResources(replay.state, 'helion-01'), getPlanetResources(caughtUp.state, 'helion-01'));
});

test('Space Flight recalled after three minutes returns in three minutes and keeps the launch fee', () => {
  const initial = withSpaceFlightFleet(createInitialSaveState('test', 1_000), {}, { corsair: 1 });
  const startingGas = getPlanetResources(initial, 'helion-01').gas;
  const sent = dispatchFlight(initial, spaceFlightCommand('space-recall-three-minutes', {
    commanders: { corsair: 1 },
    minutes: 10,
  }), { now: 1_000, mode: 'test', testTimeScale: 1 });
  assert.equal(sent.ok, true);
  if (!sent.ok) return;
  const recalledAt = sent.flight.departedAt + 3 * 60_000;
  const recalled = recallFlight(sent.state, sent.flight.id, recalledAt);
  assert.equal(recalled.ok, true);
  if (!recalled.ok) return;
  assert.equal(recalled.flight.returnAt, recalledAt + 3 * 60_000);
  assert.equal(getPlanetResources(recalled.state, 'helion-01').gas, startingGas - 100);
  const completed = reconcileFlights(recalled.state, recalled.flight.returnAt!);
  assert.equal(completed.state.flights.records[0].phase, 'completed');
  assert.equal(getAvailableFleetForPlanet(completed.state, 'helion-01').commanders.corsair, 1);
  assert.equal(getPlanetResources(completed.state, 'helion-01').gas, startingGas - 100);
});

test('deployment uses an owned planet target, preserves source until arrival, and transfers commander levels once', () => {
  const fixture = stateWithDeploymentTarget();
  const before = fixture.state.planets['helion-01'];
  const sent = dispatchFlight(fixture.state, {
    requestId: 'deployment-1',
    missionId: 'deployment',
    originPlanetId: 'helion-01',
    destination: { kind: 'planet', planetId: fixture.targetId, coordinate: fixture.targetCoordinate },
    targetRelation: 'self',
    selectedShips: { scout: 2 },
    selectedCommanders: { corsair: 1 },
    departedAt: 20_000,
  }, 20_000);
  assert.equal(sent.ok, true);
  if (!sent.ok) return;
  assert.equal(sent.flight.populationReserved, 14);
  assert.equal(fixture.state.planets['helion-01'].fleet.ships.scout, before.fleet.ships.scout);
  assert.equal(fixture.state.planets[fixture.targetId].fleet.ships.scout, 0);
  assert.equal(getPendingInboundPopulation(sent.state, fixture.targetId), 14);

  const arrived = reconcileFlights(sent.state, sent.flight.arrivalAt);
  assert.equal(arrived.events[0]?.status, 'deployed');
  assert.equal(arrived.state.flights.records[1]?.completionReason, 'deployed');
  assert.equal(arrived.state.planets['helion-01'].fleet.ships.scout, before.fleet.ships.scout - 2);
  assert.equal(arrived.state.planets[fixture.targetId].fleet.ships.scout, 2);
  assert.equal(arrived.state.planets[fixture.targetId].fleet.commanders.corsair, 1);
  assert.equal(getOwnerShipUpgradeLevel(arrived.state, 'corsair'), 7);
  assert.deepEqual(arrived.state.planets[fixture.targetId].spaceportUpgrades.shipLevels, {});
  const repeated = reconcileFlights(arrived.state, sent.flight.arrivalAt + 100_000);
  assert.equal(repeated.changed, false);
  assert.equal(repeated.state.planets[fixture.targetId].fleet.ships.scout, 2);
});

test('deployment flight and pending population survive reload and resolve once', () => {
  const fixture = stateWithDeploymentTarget();
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
  };
  const persistence = createPersistenceFacade({ mode: 'production', storage, now: () => 1_000 });
  assert.equal(persistence.write(fixture.state).ok, true);
  const sent = dispatchFlight(persistence.read(), {
    requestId: 'deployment-reload',
    missionId: 'deployment',
    originPlanetId: 'helion-01',
    destination: { kind: 'planet', planetId: fixture.targetId, coordinate: fixture.targetCoordinate },
    targetRelation: 'self',
    selectedShips: { scout: 2 },
    selectedCommanders: { corsair: 1 },
    departedAt: 20_000,
  }, 20_000);
  assert.equal(sent.ok, true);
  if (!sent.ok) return;
  assert.equal(persistence.write(sent.state).ok, true);

  const reloaded = persistence.read();
  const restoredFlight = reloaded.flights.records.find((flight) => flight.id === sent.flight.id);
  assert.equal(restoredFlight?.selectedCommanderLevels?.corsair, sent.flight.selectedCommanderLevels?.corsair);
  assert.equal(getPendingInboundPopulation(reloaded, fixture.targetId), sent.flight.populationReserved);
  const arrived = reconcileFlights(reloaded, sent.flight.arrivalAt);
  assert.equal(arrived.events[0]?.status, 'deployed');
  assert.equal(persistence.write(arrived.state).ok, true);

  const reloadedArrival = persistence.read();
  assert.equal(getPendingInboundPopulation(reloadedArrival, fixture.targetId), 0);
  assert.equal(reloadedArrival.planets[fixture.targetId].fleet.ships.scout, 2);
  assert.equal(reloadedArrival.planets[fixture.targetId].fleet.commanders.corsair, 1);
  assert.equal(reconcileFlights(reloadedArrival, sent.flight.arrivalAt + 1).changed, false);
});

test('overpopulation burns unreserved deployment ships first and the reserved manifest arrives once', () => {
  const fixture = stateWithDeploymentTarget();
  const source = fixture.state.planets['helion-01'];
  const sourceFleet = createEmptyFleetState();
  sourceFleet.ships.scout = 3;
  sourceFleet.ships.battleship = 4;
  sourceFleet.commanders.corsair = 1;
  const state = {
    ...fixture.state,
    planets: {
      ...fixture.state.planets,
      'helion-01': {
        ...source,
        buildings: { ...source.buildings, hangar: 0 },
        fleet: sourceFleet,
      },
    },
  };
  const departedAt = 20_000;
  const sent = dispatchFlight(state, {
    requestId: 'deployment-overpopulation-reserved',
    missionId: 'deployment',
    originPlanetId: 'helion-01',
    destination: { kind: 'planet', planetId: fixture.targetId, coordinate: fixture.targetCoordinate },
    targetRelation: 'self',
    selectedShips: { scout: 2 },
    selectedCommanders: { corsair: 1 },
    departedAt,
  }, departedAt);
  assert.equal(sent.ok, true);
  if (!sent.ok) return;

  const episodeStarted = reconcilePlanetOverpopulation(sent.state, 'helion-01', departedAt);
  assert.equal(episodeStarted.summary.blocked, true);
  const burned = reconcilePlanetOverpopulation(
    episodeStarted.state,
    'helion-01',
    sent.flight.arrivalAt - 1,
  );
  assert.equal(burned.summary.blocked, true);
  assert.equal(burned.state.planets['helion-01'].fleet.ships.scout, 2);
  assert.equal(burned.state.planets['helion-01'].fleet.ships.battleship, 3);
  assert.equal(burned.state.planets['helion-01'].fleet.commanders.corsair, 1);
  assert.deepEqual(burned.state.planets['helion-01'].overpopulation?.removedShips, [
    { shipId: 'scout', count: 1 },
    { shipId: 'battleship', count: 1 },
  ]);

  const arrived = reconcileFlights(burned.state, sent.flight.arrivalAt);
  assert.equal(arrived.events.length, 1);
  assert.equal(arrived.events[0]?.status, 'deployed');
  assert.equal(arrived.state.flights.records.find((flight) => flight.id === sent.flight.id)?.completionReason, 'deployed');
  assert.equal(arrived.state.planets['helion-01'].fleet.ships.scout, 0);
  assert.equal(arrived.state.planets['helion-01'].fleet.ships.battleship, 3);
  assert.equal(arrived.state.planets['helion-01'].fleet.commanders.corsair, 0);
  assert.equal(arrived.state.planets[fixture.targetId].fleet.ships.scout, 2);
  assert.equal(arrived.state.planets[fixture.targetId].fleet.commanders.corsair, 1);

  const replayed = reconcileFlights(arrived.state, sent.flight.arrivalAt + 1);
  assert.equal(replayed.changed, false);
  assert.equal(replayed.events.length, 0);
  assert.equal(replayed.state.planets[fixture.targetId].fleet.ships.scout, 2);
  assert.equal(replayed.state.planets[fixture.targetId].fleet.commanders.corsair, 1);
});

test('Space Flight ships survive origin overpopulation and are lost permanently if the origin is destroyed', () => {
  const fixture = stateWithDeploymentTarget();
  const source = fixture.state.planets['helion-01'];
  const sourceFleet = createEmptyFleetState();
  sourceFleet.ships.scout = 3;
  sourceFleet.ships.battleship = 4;
  sourceFleet.commanders.corsair = 1;
  const state: SaveState = {
    ...fixture.state,
    planets: {
      ...fixture.state.planets,
      'helion-01': {
        ...source,
        buildings: { ...source.buildings, hangar: 0 },
        fleet: sourceFleet,
      },
    },
  };
  const departedAt = 45_000;
  const sent = dispatchFlight(state, spaceFlightCommand('space-flight-overpopulation-reserved', {
    ships: { scout: 2 },
    minutes: 5,
    departedAt,
  }), { now: departedAt, mode: 'test', testTimeScale: 1 });
  assert.equal(sent.ok, true);
  if (!sent.ok) return;
  assert.equal(getReservedShipsForPlanet(sent.state, 'helion-01').scout, 2);

  const episodeStarted = reconcilePlanetOverpopulation(sent.state, 'helion-01', departedAt);
  const attrition = reconcilePlanetOverpopulation(episodeStarted.state, 'helion-01', sent.flight.arrivalAt - 1);
  assert.equal(attrition.state.planets['helion-01'].fleet.ships.scout, 2);
  assert.ok(attrition.state.planets['helion-01'].fleet.ships.battleship < sourceFleet.ships.battleship);
  assert.equal(getReservedShipsForPlanet(attrition.state, 'helion-01').scout, 2);

  const destroyed = destroyOwnedPlanet(attrition.state, 'helion-01', sent.flight.arrivalAt - 1);
  assert.equal(destroyed.destroyed, true);
  assert.equal(destroyed.state.planets['helion-01'], undefined);
  const burnedFlight = destroyed.state.flights.records.find((flight) => flight.id === sent.flight.id);
  assert.equal(burnedFlight?.phase, 'failed');
  assert.equal(burnedFlight?.completionReason, 'origin-destroyed');
  const afterReturnTime = reconcileFlights(destroyed.state, sent.flight.arrivalAt + sent.flight.oneWayDurationMs);
  assert.equal(afterReturnTime.state.flights.records.find((flight) => flight.id === sent.flight.id)?.phase, 'failed');
  assert.equal(afterReturnTime.events.some((event) => event.flight.id === sent.flight.id && event.status === 'returned'), false);
  assert.equal(afterReturnTime.state.planets[fixture.targetId].fleet.ships.scout, 0);
});

test('overpopulation leaves an episode blocked when every eligible ship is reserved by a deployment', () => {
  const fixture = stateWithDeploymentTarget();
  const source = fixture.state.planets['helion-01'];
  const sourceFleet = createEmptyFleetState();
  sourceFleet.ships.scout = 2;
  sourceFleet.commanders.corsair = 1;
  const state = {
    ...fixture.state,
    planets: {
      ...fixture.state.planets,
      'helion-01': {
        ...source,
        buildings: { ...source.buildings, hangar: 0 },
        solarSatellites: 100,
        fleet: sourceFleet,
      },
    },
  };
  const departedAt = 30_000;
  const sent = dispatchFlight(state, {
    requestId: 'deployment-overpopulation-all-reserved',
    missionId: 'deployment',
    originPlanetId: 'helion-01',
    destination: { kind: 'planet', planetId: fixture.targetId, coordinate: fixture.targetCoordinate },
    targetRelation: 'self',
    selectedShips: { scout: 2 },
    departedAt,
  }, departedAt);
  assert.equal(sent.ok, true);
  if (!sent.ok) return;

  const episodeStarted = reconcilePlanetOverpopulation(sent.state, 'helion-01', departedAt);
  const stillBlocked = reconcilePlanetOverpopulation(
    episodeStarted.state,
    'helion-01',
    sent.flight.arrivalAt - 1,
  );
  assert.equal(stillBlocked.summary.blocked, true);
  assert.equal(stillBlocked.state.planets['helion-01'].fleet.ships.scout, 2);
  assert.equal(stillBlocked.state.planets['helion-01'].fleet.commanders.corsair, 1);
  assert.equal(stillBlocked.state.planets['helion-01'].overpopulation?.blocked, true);

  const arrived = reconcileFlights(stillBlocked.state, sent.flight.arrivalAt);
  assert.equal(arrived.events[0]?.status, 'deployed');
  assert.equal(arrived.state.planets[fixture.targetId].fleet.ships.scout, 2);
  assert.equal(arrived.state.planets['helion-01'].fleet.ships.scout, 0);
});

test('deployment reservation survives reload during attrition and the complete manifest transfers once', () => {
  const fixture = stateWithDeploymentTarget();
  const source = fixture.state.planets['helion-01'];
  const sourceFleet = createEmptyFleetState();
  sourceFleet.ships.scout = 3;
  sourceFleet.ships.battleship = 4;
  sourceFleet.commanders.corsair = 1;
  const state: SaveState = {
    ...fixture.state,
    planets: {
      ...fixture.state.planets,
      'helion-01': {
        ...source,
        buildings: { ...source.buildings, hangar: 0 },
        solarSatellites: 100,
        fleet: sourceFleet,
      },
    },
  };
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
  };
  const persistence = createPersistenceFacade({ mode: 'production', storage, now: () => 1_000 });
  const departedAt = 50_000;
  const sent = dispatchFlight(state, {
    requestId: 'deployment-overpopulation-reload',
    missionId: 'deployment',
    originPlanetId: 'helion-01',
    destination: { kind: 'planet', planetId: fixture.targetId, coordinate: fixture.targetCoordinate },
    targetRelation: 'self',
    selectedShips: { scout: 2 },
    departedAt,
  }, departedAt);
  assert.equal(sent.ok, true);
  if (!sent.ok) return;
  assert.equal(persistence.write(sent.state).ok, true);

  const reloadedOutbound = persistence.read();
  assert.equal(reloadedOutbound.flights.records.find((flight) => flight.id === sent.flight.id)?.phase, 'outbound');
  assert.equal(getReservedShipsForPlanet(reloadedOutbound, 'helion-01').scout, 2);

  const episodeStarted = reconcilePlanetOverpopulation(reloadedOutbound, 'helion-01', departedAt);
  const attrition = reconcilePlanetOverpopulation(
    episodeStarted.state,
    'helion-01',
    sent.flight.arrivalAt - 1,
  );
  assert.equal(attrition.summary.blocked, true);
  assert.ok(attrition.state.planets['helion-01'].fleet.ships.scout >= 2);
  assert.ok(
    attrition.state.planets['helion-01'].fleet.ships.battleship
      < reloadedOutbound.planets['helion-01'].fleet.ships.battleship,
    'unreserved ordinary ships should burn during the persisted flight',
  );
  assert.ok((attrition.state.planets['helion-01'].overpopulation?.removedShips?.length ?? 0) > 0);
  assert.equal(getReservedShipsForPlanet(attrition.state, 'helion-01').scout, 2);
  const sourceScoutsBeforeArrival = attrition.state.planets['helion-01'].fleet.ships.scout;
  assert.equal(persistence.write(attrition.state).ok, true);

  const reloadedAfterAttrition = persistence.read();
  assert.equal(getReservedShipsForPlanet(reloadedAfterAttrition, 'helion-01').scout, 2);
  const arrived = reconcileFlights(reloadedAfterAttrition, sent.flight.arrivalAt);
  assert.equal(arrived.events.length, 1);
  assert.equal(arrived.events[0]?.status, 'deployed');
  assert.equal(arrived.state.flights.records.find((flight) => flight.id === sent.flight.id)?.completionReason, 'deployed');
  assert.equal(arrived.state.planets['helion-01'].fleet.ships.scout, sourceScoutsBeforeArrival - 2);
  assert.equal(arrived.state.planets[fixture.targetId].fleet.ships.scout, 2);
  assert.equal(getReservedShipsForPlanet(arrived.state, 'helion-01').scout ?? 0, 0);
  assert.equal(persistence.write(arrived.state).ok, true);

  const reloadedArrival = persistence.read();
  const replayed = reconcileFlights(reloadedArrival, sent.flight.arrivalAt + 1);
  assert.equal(replayed.changed, false);
  assert.equal(replayed.events.length, 0);
  assert.equal(replayed.state.planets[fixture.targetId].fleet.ships.scout, 2);
});

test('returning deployment remains reserved during attrition and releases the reservation on completion', () => {
  const fixture = stateWithDeploymentTarget();
  const source = fixture.state.planets['helion-01'];
  const sourceFleet = createEmptyFleetState();
  sourceFleet.ships.scout = 3;
  sourceFleet.ships.battleship = 4;
  sourceFleet.commanders.corsair = 1;
  const state: SaveState = {
    ...fixture.state,
    planets: {
      ...fixture.state.planets,
      'helion-01': {
        ...source,
        buildings: { ...source.buildings, hangar: 0 },
        fleet: sourceFleet,
      },
    },
  };
  const departedAt = 60_000;
  const sent = dispatchFlight(state, {
    requestId: 'deployment-overpopulation-returning',
    missionId: 'deployment',
    originPlanetId: 'helion-01',
    destination: { kind: 'planet', planetId: fixture.targetId, coordinate: fixture.targetCoordinate },
    targetRelation: 'self',
    selectedShips: { scout: 2 },
    selectedCommanders: { corsair: 1 },
    departedAt,
  }, departedAt);
  assert.equal(sent.ok, true);
  if (!sent.ok) return;
  const episodeStarted = reconcilePlanetOverpopulation(sent.state, 'helion-01', departedAt);
  const recalled = recallFlight(
    episodeStarted.state,
    sent.flight.id,
    departedAt + Math.floor(sent.flight.oneWayDurationMs / 2),
  );
  assert.equal(recalled.ok, true);
  if (!recalled.ok) return;
  assert.equal(recalled.flight.phase, 'returning');
  assert.equal(getReservedShipsForPlanet(recalled.state, 'helion-01').scout, 2);

  const attrition = reconcilePlanetOverpopulation(
    recalled.state,
    'helion-01',
    recalled.flight.returnAt! - 1,
  );
  assert.equal(attrition.summary.blocked, true);
  assert.equal(
    attrition.state.planets['helion-01'].fleet.ships.scout,
    2,
    JSON.stringify({ ships: attrition.state.planets['helion-01'].fleet.ships, removed: attrition.state.planets['helion-01'].overpopulation?.removedShips }),
  );
  assert.equal(attrition.state.planets['helion-01'].fleet.ships.battleship, 3);
  assert.equal(attrition.state.planets['helion-01'].fleet.commanders.corsair, 1);
  assert.equal(getReservedShipsForPlanet(attrition.state, 'helion-01').scout, 2);
  assert.deepEqual(attrition.state.planets['helion-01'].overpopulation?.removedShips, [
    { shipId: 'scout', count: 1 },
    { shipId: 'battleship', count: 1 },
  ]);

  const completed = reconcileFlights(attrition.state, recalled.flight.returnAt!);
  assert.equal(completed.events.length, 1);
  assert.equal(completed.state.flights.records.find((flight) => flight.id === sent.flight.id)?.phase, 'completed');
  assert.equal(completed.state.flights.records.find((flight) => flight.id === sent.flight.id)?.completionReason, 'recalled');
  assert.equal(completed.state.planets['helion-01'].fleet.ships.scout, 2);
  assert.equal(completed.state.planets['helion-01'].fleet.commanders.corsair, 1);
  assert.equal(completed.state.planets[fixture.targetId].fleet.ships.scout, 0);
  assert.equal(getReservedShipsForPlanet(completed.state, 'helion-01').scout ?? 0, 0);
});

test('parallel deployment reservations are aggregated for attrition and released as flights complete or fail', () => {
  const fixture = stateWithDeploymentTarget();
  const source = fixture.state.planets['helion-01'];
  const sourceFleet = createEmptyFleetState();
  sourceFleet.ships.scout = 5;
  sourceFleet.ships.battleship = 4;
  sourceFleet.commanders.corsair = 1;
  const state: SaveState = {
    ...fixture.state,
    planets: {
      ...fixture.state.planets,
      'helion-01': {
        ...source,
        buildings: { ...source.buildings, hangar: 0 },
        fleet: sourceFleet,
      },
    },
  };
  const departedAt = 70_000;
  const first = dispatchFlight(state, {
    requestId: 'deployment-parallel-reserve-first',
    missionId: 'deployment',
    originPlanetId: 'helion-01',
    destination: { kind: 'planet', planetId: fixture.targetId, coordinate: fixture.targetCoordinate },
    targetRelation: 'self',
    selectedShips: { scout: 2 },
    selectedCommanders: { corsair: 1 },
    departedAt,
  }, departedAt);
  assert.equal(first.ok, true);
  if (!first.ok) return;
  const second = dispatchFlight(first.state, {
    requestId: 'deployment-parallel-reserve-second',
    missionId: 'deployment',
    originPlanetId: 'helion-01',
    destination: { kind: 'planet', planetId: fixture.targetId, coordinate: fixture.targetCoordinate },
    targetRelation: 'self',
    selectedShips: { scout: 2 },
    departedAt: departedAt + 1,
  }, departedAt + 1);
  assert.equal(second.ok, true);
  if (!second.ok) return;
  assert.equal(getReservedShipsForPlanet(second.state, 'helion-01').scout, 4);
  assert.equal(second.state.planets['helion-01'].fleet.commanders.corsair, 1);

  const episodeStarted = reconcilePlanetOverpopulation(second.state, 'helion-01', departedAt + 1);
  const attrition = reconcilePlanetOverpopulation(
    episodeStarted.state,
    'helion-01',
    first.flight.arrivalAt - 1,
  );
  assert.equal(attrition.summary.blocked, true);
  assert.equal(attrition.state.planets['helion-01'].fleet.ships.scout, 4);
  assert.equal(attrition.state.planets['helion-01'].fleet.commanders.corsair, 1);
  assert.equal(getReservedShipsForPlanet(attrition.state, 'helion-01').scout, 4);
  assert.deepEqual(attrition.state.planets['helion-01'].overpopulation?.removedShips, [
    { shipId: 'scout', count: 1 },
    { shipId: 'battleship', count: 1 },
  ]);

  const firstArrival = reconcileFlights(attrition.state, first.flight.arrivalAt);
  assert.equal(firstArrival.state.flights.records.find((flight) => flight.id === first.flight.id)?.phase, 'completed');
  assert.equal(firstArrival.state.flights.records.find((flight) => flight.id === second.flight.id)?.phase, 'outbound');
  assert.equal(firstArrival.state.planets['helion-01'].fleet.ships.scout, 2);
  assert.equal(firstArrival.state.planets['helion-01'].fleet.commanders.corsair, 0);
  assert.equal(firstArrival.state.planets[fixture.targetId].fleet.ships.scout, 2);
  assert.equal(firstArrival.state.planets[fixture.targetId].fleet.commanders.corsair, 1);
  assert.equal(getReservedShipsForPlanet(firstArrival.state, 'helion-01').scout, 2);

  const remainingPlanets = Object.fromEntries(
    Object.entries(firstArrival.state.planets).filter(([planetId]) => planetId !== 'helion-01'),
  ) as SaveState['planets'];
  const lost = reconcileFlights(
    { ...firstArrival.state, planets: remainingPlanets },
    second.flight.arrivalAt - 1,
  );
  assert.equal(lost.events.length, 1);
  assert.equal(lost.events[0]?.status, 'destroyed');
  assert.equal(lost.state.flights.records.find((flight) => flight.id === second.flight.id)?.phase, 'failed');
  assert.equal(lost.state.flights.records.find((flight) => flight.id === second.flight.id)?.completionReason, 'origin-destroyed');
  assert.equal(getReservedShipsForPlanet(lost.state, 'helion-01').scout ?? 0, 0);
  assert.equal(lost.state.planets[fixture.targetId].fleet.ships.scout, 2);
  assert.equal(lost.state.planets[fixture.targetId].fleet.commanders.corsair, 1);
});

test('destroying a deployment origin destroys ships and commander once and remains terminal after reload', () => {
  const fixture = stateWithDeploymentTarget();
  const sourcePlanetId = fixture.targetId;
  const source = fixture.state.planets[sourcePlanetId];
  const stateWithDeploymentFleet: SaveState = {
    ...fixture.state,
    currentPlanetId: sourcePlanetId,
    planets: {
      ...fixture.state.planets,
      [sourcePlanetId]: {
        ...source,
        fleet: {
          ...source.fleet,
          ships: { ...source.fleet.ships, scout: 2 },
          commanders: { ...source.fleet.commanders, corsair: 1 },
        },
      },
    },
  };
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
  };
  const persistence = createPersistenceFacade({ mode: 'production', storage, now: () => 1_000 });
  assert.equal(persistence.write(stateWithDeploymentFleet).ok, true);
  const sent = dispatchFlight(persistence.read(), {
    requestId: 'deployment-origin-destroyed',
    missionId: 'deployment',
    originPlanetId: sourcePlanetId,
    destination: { kind: 'planet', planetId: 'helion-01', coordinate: origin },
    targetRelation: 'self',
    selectedShips: { scout: 2 },
    selectedCommanders: { corsair: 1 },
    departedAt: 40_000,
  }, 40_000);
  assert.equal(sent.ok, true);
  if (!sent.ok) return;
  assert.equal(persistence.write(sent.state).ok, true);

  const outbound = persistence.read();
  const remainingPlanets = Object.fromEntries(
    Object.entries(outbound.planets).filter(([planetId]) => planetId !== sourcePlanetId),
  ) as SaveState['planets'];
  const withoutOrigin = { ...outbound, planets: remainingPlanets };
  const destroyed = reconcileFlights(withoutOrigin, sent.flight.departedAt + 1);
  assert.equal(destroyed.events.length, 1);
  assert.equal(destroyed.events[0]?.status, 'destroyed');
  const terminalFlight = destroyed.state.flights.records.find((flight) => flight.id === sent.flight.id);
  assert.equal(terminalFlight?.phase, 'failed');
  assert.equal(terminalFlight?.completionReason, 'origin-destroyed');
  assert.equal(terminalFlight?.selectedShips.scout, 2);
  assert.equal(terminalFlight?.selectedCommanders?.corsair, 1);
  assert.equal(destroyed.state.planets['helion-01'].fleet.ships.scout, 42);
  assert.equal(destroyed.state.planets['helion-01'].fleet.commanders.corsair, 1);
  assert.equal(getReservedShipsForPlanet(destroyed.state, sourcePlanetId).scout ?? 0, 0);

  assert.equal(persistence.write(destroyed.state).ok, true);
  const reloaded = persistence.read();
  const restoredFlight = reloaded.flights.records.find((flight) => flight.id === sent.flight.id);
  assert.equal(reloaded.planets[sourcePlanetId], undefined);
  assert.equal(restoredFlight?.phase, 'failed');
  assert.equal(restoredFlight?.completionReason, 'origin-destroyed');
  assert.equal(getReservedShipsForPlanet(reloaded, sourcePlanetId).scout ?? 0, 0);
  const replayed = reconcileFlights(reloaded, sent.flight.arrivalAt + sent.flight.oneWayDurationMs);
  assert.equal(replayed.changed, false);
  assert.equal(replayed.events.length, 0);
  assert.equal(replayed.state.planets['helion-01'].fleet.ships.scout, 42);
  assert.equal(replayed.state.planets['helion-01'].fleet.commanders.corsair, 1);
});

test('a deployment whose origin is destroyed while returning is terminally destroyed', () => {
  const fixture = stateWithDeploymentTarget();
  const sourcePlanetId = fixture.targetId;
  const source = fixture.state.planets[sourcePlanetId];
  const withFleet: SaveState = {
    ...fixture.state,
    currentPlanetId: sourcePlanetId,
    planets: {
      ...fixture.state.planets,
      [sourcePlanetId]: {
        ...source,
        fleet: { ...source.fleet, ships: { ...source.fleet.ships, scout: 2 } },
      },
    },
  };
  const sent = dispatchFlight(withFleet, {
    requestId: 'deployment-origin-destroyed-returning',
    missionId: 'deployment',
    originPlanetId: sourcePlanetId,
    destination: { kind: 'planet', planetId: 'helion-01', coordinate: origin },
    targetRelation: 'self',
    selectedShips: { scout: 1 },
    departedAt: 40_000,
  }, 40_000);
  assert.equal(sent.ok, true);
  if (!sent.ok) return;
  const recalled = recallFlight(sent.state, sent.flight.id, sent.flight.departedAt + 1_000);
  assert.equal(recalled.ok, true);
  if (!recalled.ok) return;
  const returningFlight = recalled.state.flights.records.find((flight) => flight.id === sent.flight.id);
  assert.equal(returningFlight?.phase, 'returning');
  const planets = Object.fromEntries(
    Object.entries(recalled.state.planets).filter(([planetId]) => planetId !== sourcePlanetId),
  ) as SaveState['planets'];

  const result = reconcileFlights({ ...recalled.state, planets }, returningFlight?.returnAt ?? sent.flight.arrivalAt);
  assert.equal(result.events.length, 1);
  assert.equal(result.events[0]?.status, 'destroyed');
  assert.equal(result.state.flights.records.find((flight) => flight.id === sent.flight.id)?.completionReason, 'origin-destroyed');
  assert.equal(result.state.planets['helion-01'].fleet.ships.scout, 42);
  assert.equal(getReservedShipsForPlanet(result.state, sourcePlanetId).scout ?? 0, 0);
});

test('deployment recall before arrival returns without transferring source units', () => {
  const fixture = stateWithDeploymentTarget();
  const sent = dispatchFlight(fixture.state, {
    requestId: 'deployment-recall',
    missionId: 'deployment',
    originPlanetId: 'helion-01',
    destination: { kind: 'planet', planetId: fixture.targetId, coordinate: fixture.targetCoordinate },
    targetRelation: 'self',
    selectedShips: { scout: 1 },
    departedAt: 20_000,
  }, 20_000);
  assert.equal(sent.ok, true);
  if (!sent.ok) return;
  const recalled = recallFlight(sent.state, sent.flight.id, sent.flight.departedAt + 1_000);
  assert.equal(recalled.ok, true);
  if (!recalled.ok) return;
  const completed = reconcileFlights(recalled.state, recalled.flight.returnAt!);
  assert.equal(completed.state.planets['helion-01'].fleet.ships.scout, fixture.state.planets['helion-01'].fleet.ships.scout);
  assert.equal(completed.state.planets[fixture.targetId].fleet.ships.scout, 0);
  assert.equal(completed.state.flights.records[1]?.completionReason, 'recalled');
});

test('deployment must dispatch from the currently selected planet', () => {
  const fixture = stateWithDeploymentTarget();
  const rejected = dispatchFlight(fixture.state, {
    requestId: 'deployment-wrong-source',
    missionId: 'deployment',
    originPlanetId: fixture.targetId,
    destination: {
      kind: 'planet',
      planetId: 'helion-01',
      coordinate: { galaxy: 1, system: 1, position: 1 },
    },
    targetRelation: 'self',
    selectedShips: { scout: 1 },
    departedAt: 20_000,
  }, 20_000);
  assert.equal(rejected.ok, false);
  if (!rejected.ok) assert.equal(rejected.error.code, 'invalid-command');
});

test('parallel deployment dispatches ignore pending inbound and valid arrivals may create overpopulation', () => {
  const fixture = stateWithDeploymentTarget();
  const target = fixture.state.planets[fixture.targetId];
  const limited = {
    ...fixture.state,
    planets: {
      ...fixture.state.planets,
      [fixture.targetId]: { ...target, buildings: { ...target.buildings, hangar: 0 } },
    },
  };
  const first = dispatchFlight(limited, {
    requestId: 'deployment-capacity-1',
    missionId: 'deployment',
    originPlanetId: 'helion-01',
    destination: { kind: 'planet', planetId: fixture.targetId, coordinate: fixture.targetCoordinate },
    targetRelation: 'self',
    selectedShips: { scout: 20 },
    departedAt: 20_000,
  }, 20_000);
  assert.equal(first.ok, true);
  if (!first.ok) return;
  const second = dispatchFlight(first.state, {
    requestId: 'deployment-capacity-2',
    missionId: 'deployment',
    originPlanetId: 'helion-01',
    destination: { kind: 'planet', planetId: fixture.targetId, coordinate: fixture.targetCoordinate },
    targetRelation: 'self',
    selectedShips: { scout: 20 },
    departedAt: 20_000,
  }, 20_000);
  assert.equal(second.ok, true);
  if (!second.ok) return;
  const firstArrival = reconcileFlights(second.state, first.flight.arrivalAt);
  assert.equal(firstArrival.state.planets[fixture.targetId].fleet.ships.scout, 40);
  assert.equal(firstArrival.state.flights.records.find((flight) => flight.id === second.flight.id)?.phase, 'completed');
  assert.equal(firstArrival.state.flights.records.find((flight) => flight.id === second.flight.id)?.completionReason, 'deployed');
  const overpopulated = reconcilePlanetOverpopulation(firstArrival.state, fixture.targetId, first.flight.arrivalAt);
  assert.equal(overpopulated.state.planets[fixture.targetId].overpopulation?.blocked, true);
  const secondArrival = reconcileFlights(firstArrival.state, second.flight.arrivalAt + 1);
  assert.equal(secondArrival.state.planets[fixture.targetId].fleet.ships.scout, 40);
  assert.equal(secondArrival.changed, false);
});

test('a deployment arrival checkpoint blocks the target for the rest of the reconcile interval', () => {
  const fixture = stateWithDeploymentTarget();
  const target = fixture.state.planets[fixture.targetId];
  const limited = {
    ...fixture.state,
    planets: {
      ...fixture.state.planets,
      [fixture.targetId]: { ...target, buildings: { ...target.buildings, hangar: 0 } },
    },
  };
  const departedAt = 2_000_000;
  const first = dispatchFlight(limited, {
    requestId: 'deployment-checkpoint-1',
    missionId: 'deployment',
    originPlanetId: 'helion-01',
    destination: { kind: 'planet', planetId: fixture.targetId, coordinate: fixture.targetCoordinate },
    targetRelation: 'self',
    selectedShips: { scout: 20 },
    departedAt,
  }, departedAt);
  assert.equal(first.ok, true);
  if (!first.ok) return;
  const second = dispatchFlight(first.state, {
    requestId: 'deployment-checkpoint-2',
    missionId: 'deployment',
    originPlanetId: 'helion-01',
    destination: { kind: 'planet', planetId: fixture.targetId, coordinate: fixture.targetCoordinate },
    targetRelation: 'self',
    selectedShips: { scout: 20 },
    departedAt,
  }, departedAt);
  assert.equal(second.ok, true);
  if (!second.ok) return;

  const arrivalAt = first.flight.arrivalAt;
  const productionStartAt = arrivalAt - 5 * 60_000;
  const targetClock = second.state.resourceClock.byPlanet?.[fixture.targetId]
    ?? { lastReconciledAt: second.state.resourceClock.lastReconciledAt, remainder: second.state.resourceClock.remainder };
  const startState = {
    ...second.state,
    resourceClock: {
      ...second.state.resourceClock,
      byPlanet: {
        ...second.state.resourceClock.byPlanet,
        [fixture.targetId]: { ...targetClock, lastReconciledAt: productionStartAt },
      },
    },
  };
  const atArrival = reconcileRuntime(startState, {
    planetId: 'helion-01',
    now: arrivalAt,
    mode: 'production',
    testTimeScale: 10,
  });
  assert.equal(atArrival.state.planets[fixture.targetId].overpopulation?.blocked, true);
  assert.equal(atArrival.events.some((event) => event.kind === 'flight'
    && event.events.some((flightEvent) => flightEvent.flight.id === first.flight.id && flightEvent.status === 'deployed')), true);
  assert.equal(atArrival.state.flights.records.find((flight) => flight.id === first.flight.id)?.arrivedAt, arrivalAt);
  const endAt = arrivalAt + 5 * 60_000;
  const afterArrival = reconcileRuntime(atArrival.state, {
    planetId: 'helion-01',
    now: endAt,
    mode: 'production',
    testTimeScale: 10,
  });
  const combined = reconcileRuntime(startState, {
    planetId: 'helion-01',
    now: endAt,
    mode: 'production',
    testTimeScale: 10,
  });
  assert.equal(afterArrival.state.planets[fixture.targetId].overpopulation?.blocked, true);
  assert.deepEqual(
    getPlanetResources(afterArrival.state, fixture.targetId),
    getPlanetResources(atArrival.state, fixture.targetId),
  );
  assert.deepEqual(
    getPlanetResources(combined.state, fixture.targetId),
    getPlanetResources(afterArrival.state, fixture.targetId),
  );
});

test('a deployment return created during reconciliation precedes later planet work', () => {
  const fixture = stateWithDeploymentTarget();
  const departedAt = 2_000_000;
  const sent = dispatchFlight(fixture.state, {
    requestId: 'deployment-due-return-checkpoint',
    missionId: 'deployment',
    originPlanetId: 'helion-01',
    destination: { kind: 'planet', planetId: fixture.targetId, coordinate: fixture.targetCoordinate },
    targetRelation: 'self',
    selectedShips: { scout: 1 },
    departedAt,
  }, departedAt);
  assert.equal(sent.ok, true);
  if (!sent.ok) return;

  const planets = { ...sent.state.planets };
  delete planets[fixture.targetId];
  const returnAt = sent.flight.arrivalAt + sent.flight.oneWayDurationMs;
  const buildingFinishAt = returnAt + 60_000;
  const queuedBuilding = {
    kind: 'building' as const,
    id: 'deployment-return-checkpoint-building',
    assetRole: 'shipyard' as const,
    planetId: 'helion-01',
    enqueuedAt: sent.flight.arrivalAt,
    startedAt: sent.flight.arrivalAt,
    finishAt: buildingFinishAt,
    targetLevel: 1,
    durationMs: buildingFinishAt - sent.flight.arrivalAt,
  };
  const startState: SaveState = {
    ...sent.state,
    planets,
    queues: { ...sent.state.queues, 'helion-01': [queuedBuilding] },
  };
  const context = {
    planetId: 'helion-01',
    now: buildingFinishAt + 1,
    mode: 'production' as const,
    testTimeScale: 10 as const,
  };

  const reconciled = reconcileRuntime(startState, context);
  const returnedEventIndex = reconciled.events.findIndex((event) => event.kind === 'flight'
    && event.events.some((flightEvent) => flightEvent.flight.id === sent.flight.id && flightEvent.status === 'returned'));
  const buildingEventIndex = reconciled.events.findIndex((event) => event.kind === 'building'
    && event.planetId === 'helion-01' && event.assetRole === 'shipyard');

  assert.notEqual(returnedEventIndex, -1);
  assert.notEqual(buildingEventIndex, -1);
  assert.ok(returnedEventIndex < buildingEventIndex);
  assert.equal(reconciled.state.flights.records.find((flight) => flight.id === sent.flight.id)?.completedAt, returnAt);
  assert.equal(reconciled.state.planets['helion-01'].buildings.shipyard, startState.planets['helion-01'].buildings.shipyard + 1);

  const repeated = reconcileRuntime(reconciled.state, context);
  assert.equal(repeated.changed, false);
  assert.deepEqual(repeated.events, []);
});

test('reconcileRuntime collects before an asteroid move, then captures only the remaining free debris', () => {
  const empty = emptyUniverseCoordinate();
  const spawnIndex = 42;
  const fleet = withRecyclers(createInitialSaveState('production', 1_000), 1);
  const capacity = getTransportCargoSummary(fleet, 'helion-01', { recycler: 1 }, {}, {
    kind: 'coordinate', coordinate: empty.coordinate,
  }).capacity.total;
  const scheduled = withScheduledAsteroid(
    withOrbitalDebris(fleet, empty.coordinate, capacity + 333),
    empty.coordinate,
    5_000,
    spawnIndex,
  );
  const sent = withRecyclerArrivalAt(scheduled, 'runtime-recycle-before-move', empty.coordinate, 3_000);
  assert.ok(sent);
  if (!sent) return;

  const reconciled = reconcileRuntime(sent.state, {
    planetId: 'helion-01', now: 6_000, mode: 'production', testTimeScale: 10,
  });

  const arrived = reconciled.state.flights.records.find((flight) => flight.id === sent.flight.id)!;
  const report = reconciled.state.reports.recyclerArrivalReports?.find((entry) => entry.flightId === sent.flight.id);
  assert.equal(arrived.arrivedAt, 3_000);
  assert.equal(arrived.cargo?.debris, capacity);
  assert.equal(report?.collectedDebris, capacity);
  assert.equal(report?.remainingOrbitalDebris, 333);
  assert.equal(getOrbitalDebrisAtCoordinate(reconciled.state.espionage!, empty.coordinate), 0);
  assert.equal(reconciled.state.asteroidDebrisBySpawnIndex?.[String(spawnIndex)], 333);
});

test('reconcileRuntime lets an earlier asteroid move capture all free debris before recycler arrival', () => {
  const empty = emptyUniverseCoordinate();
  const spawnIndex = 43;
  const fleet = withRecyclers(createInitialSaveState('production', 1_000), 1);
  const capacity = getTransportCargoSummary(fleet, 'helion-01', { recycler: 1 }, {}, {
    kind: 'coordinate', coordinate: empty.coordinate,
  }).capacity.total;
  const freeDebris = capacity + 333;
  const scheduled = withScheduledAsteroid(
    withOrbitalDebris(fleet, empty.coordinate, freeDebris),
    empty.coordinate,
    3_000,
    spawnIndex,
  );
  const sent = withRecyclerArrivalAt(scheduled, 'runtime-recycle-after-move', empty.coordinate, 5_000);
  assert.ok(sent);
  if (!sent) return;

  const reconciled = reconcileRuntime(sent.state, {
    planetId: 'helion-01', now: 6_000, mode: 'production', testTimeScale: 10,
  });

  const arrived = reconciled.state.flights.records.find((flight) => flight.id === sent.flight.id)!;
  const report = reconciled.state.reports.recyclerArrivalReports?.find((entry) => entry.flightId === sent.flight.id);
  assert.equal(arrived.cargo?.debris, 0);
  assert.equal(report?.collectedDebris, 0);
  assert.equal(report?.remainingOrbitalDebris, 0);
  assert.equal(getOrbitalDebrisAtCoordinate(reconciled.state.espionage!, empty.coordinate), 0);
  assert.equal(reconciled.state.asteroidDebrisBySpawnIndex?.[String(spawnIndex)], freeDebris);
});

test('reconcileRuntime processes asteroid capture before a recycler arrival at the exact same millisecond', () => {
  const empty = emptyUniverseCoordinate();
  const spawnIndex = 44;
  const fleet = withRecyclers(createInitialSaveState('production', 1_000), 1);
  const freeDebris = 1_000;
  const scheduled = withScheduledAsteroid(
    withOrbitalDebris(fleet, empty.coordinate, freeDebris),
    empty.coordinate,
    4_000,
    spawnIndex,
  );
  const sent = withRecyclerArrivalAt(scheduled, 'runtime-recycle-tie', empty.coordinate, 4_000);
  assert.ok(sent);
  if (!sent) return;

  const reconciled = reconcileRuntime(sent.state, {
    planetId: 'helion-01', now: 4_000, mode: 'production', testTimeScale: 10,
  });

  const arrived = reconciled.state.flights.records.find((flight) => flight.id === sent.flight.id)!;
  const report = reconciled.state.reports.recyclerArrivalReports?.find((entry) => entry.flightId === sent.flight.id);
  assert.equal(arrived.cargo?.debris, 0);
  assert.equal(report?.arrivedAtMs, 4_000);
  assert.equal(report?.collectedDebris, 0);
  assert.equal(reconciled.state.asteroidDebrisBySpawnIndex?.[String(spawnIndex)], freeDebris);
});

test('reconcileRuntime removes an exiting asteroid and its accumulated and final-coordinate debris', () => {
  const boundary = { galaxy: 1, system: 40, position: 24 };
  const spawnIndex = 46;
  const scheduled = withScheduledAsteroid(
    withOrbitalDebris(createInitialSaveState('test', 1_000), boundary, 250, 'debris-at-exit-boundary'),
    boundary,
    3_000,
    spawnIndex,
  );
  const initial = {
    ...scheduled,
    asteroidSimulation: {
      ...scheduled.asteroidSimulation!,
      asteroids: scheduled.asteroidSimulation!.asteroids.map((asteroid) => asteroid.spawnIndex === spawnIndex
        ? { ...asteroid, gasYield: 5_000, gasRatePerHour: 2_500, gasUpdatedAt: 1_000, gasRemainder: 0 }
        : asteroid),
    },
    asteroidDebrisBySpawnIndex: { [String(spawnIndex)]: 700 },
  };

  const reconciled = reconcileRuntime(initial, {
    planetId: 'helion-01', now: 3_000, mode: 'test', testTimeScale: 10,
  });
  assert.equal(reconciled.state.asteroidSimulation?.asteroids.some((asteroid) => asteroid.spawnIndex === spawnIndex), false);
  assert.equal(reconciled.state.asteroidDebrisBySpawnIndex?.[String(spawnIndex)], undefined);
  assert.equal(getOrbitalDebrisAtCoordinate(reconciled.state.espionage!, boundary), 0);

  const stored = new Map<string, string>();
  const persistence = createPersistenceFacade({
    mode: 'test',
    storage: {
      getItem: (key) => stored.get(key) ?? null,
      setItem: (key, value) => { stored.set(key, value); },
      removeItem: (key) => { stored.delete(key); },
    },
    now: () => 3_000,
  });
  assert.equal(persistence.write(reconciled.state).ok, true);
  const reloaded = persistence.read();
  assert.equal(reloaded.asteroidSimulation?.asteroids.some((asteroid) => asteroid.spawnIndex === spawnIndex), false);
  assert.equal(reloaded.asteroidDebrisBySpawnIndex?.[String(spawnIndex)], undefined);
  assert.equal(getOrbitalDebrisAtCoordinate(reloaded.espionage!, boundary), 0);

  const replay = reconcileRuntime(reloaded, {
    planetId: 'helion-01', now: 3_000, mode: 'test', testTimeScale: 10,
  });
  assert.equal(replay.changed, false);
  assert.equal(replay.state.asteroidDebrisBySpawnIndex?.[String(spawnIndex)], undefined);
  assert.equal(getOrbitalDebrisAtCoordinate(replay.state.espionage!, boundary), 0);
});

test('reconcileRuntime catches up multiple asteroid moves equivalently and does not replay them', () => {
  const start = emptyUniverseCoordinate().coordinate;
  const spawnIndex = 45;
  const firstMoveAt = 3_000;
  const secondMoveAt = firstMoveAt + getUniverseAsteroidDwellMs(spawnIndex, 1);
  const thirdMoveAt = secondMoveAt + getUniverseAsteroidDwellMs(spawnIndex, 2);
  const secondCoordinate = advanceUniverseAsteroidCoordinate(start, 1, 1)!;
  const thirdCoordinate = advanceUniverseAsteroidCoordinate(secondCoordinate, 1, 1)!;
  const fleet = createInitialSaveState('production', 1_000);
  let seeded = withOrbitalDebris(fleet, start, 100, 'catch-up-debris-1');
  seeded = withOrbitalDebris(seeded, secondCoordinate, 200, 'catch-up-debris-2');
  seeded = withOrbitalDebris(seeded, thirdCoordinate, 300, 'catch-up-debris-3');
  const initial = withScheduledAsteroid(seeded, start, firstMoveAt, spawnIndex);

  const catchUp = reconcileRuntime(initial, {
    planetId: 'helion-01', now: thirdMoveAt, mode: 'production', testTimeScale: 10,
  });
  let stepped = reconcileRuntime(initial, {
    planetId: 'helion-01', now: firstMoveAt, mode: 'production', testTimeScale: 10,
  }).state;
  stepped = reconcileRuntime(stepped, {
    planetId: 'helion-01', now: secondMoveAt, mode: 'production', testTimeScale: 10,
  }).state;
  stepped = reconcileRuntime(stepped, {
    planetId: 'helion-01', now: thirdMoveAt, mode: 'production', testTimeScale: 10,
  }).state;

  assert.deepEqual(catchUp.state.asteroidSimulation, stepped.asteroidSimulation);
  assert.deepEqual(catchUp.state.asteroidDebrisBySpawnIndex, stepped.asteroidDebrisBySpawnIndex);
  assert.deepEqual(catchUp.state.espionage?.orbitalDebris, stepped.espionage?.orbitalDebris);
  assert.equal(catchUp.state.asteroidDebrisBySpawnIndex?.[String(spawnIndex)], 600);
  const replay = reconcileRuntime(catchUp.state, {
    planetId: 'helion-01', now: thirdMoveAt, mode: 'production', testTimeScale: 10,
  });
  assert.equal(replay.changed, false);
  assert.deepEqual(replay.state.asteroidSimulation, catchUp.state.asteroidSimulation);
  assert.deepEqual(replay.state.asteroidDebrisBySpawnIndex, catchUp.state.asteroidDebrisBySpawnIndex);
});
