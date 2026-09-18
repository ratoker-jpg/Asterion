import assert from 'node:assert/strict';
import test from 'node:test';

import { createInitialSaveState, createPersistenceFacade } from './persistence.ts';
import {
  dispatchFlight,
  getAvailableFleetForPlanet,
  getReservedShipsForPlanet,
  previewFlight,
  reconcileFlights,
  recallFlight,
} from './flights.ts';
import { startBuilding } from './buildings.ts';
import { getPlanetResources, replacePlanetResources } from './contracts.ts';
import {
  ASTEROID_SCHEDULE_EPOCH_MS,
  createUniverseSystem,
  getUniverseAsteroidState,
  getUniverseTimedObjectSchedule,
} from '../domain/universe/runtime.ts';

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
