import assert from 'node:assert/strict';
import test from 'node:test';

import { beginFlightReturn, createFlightState, dispatchFlight, reconcileFlightState, recallFlight } from './runtime.ts';
import { calculateFlightFuel } from './fuel.ts';

const dispatch = (requestId = 'request-1') => dispatchFlight(createFlightState(), {
  requestId,
  missionId: 'colonize',
  originPlanetId: 'helion-01',
  originCoordinate: { galaxy: 1, system: 1, position: 1 },
  destination: { kind: 'coordinate', coordinate: { galaxy: 1, system: 2, position: 1 } },
  selectedShips: { colonizer: 1 },
  populationReserved: 12,
  departedAt: 1_000,
  factionId: 'aegis',
  science: { 2: 7 },
});

test('dispatch snapshots calculations and is idempotent by persisted request ID', () => {
  const first = dispatch();
  const second = dispatchFlight(first.state, {
    requestId: 'request-1', missionId: 'attack', originPlanetId: 'other', originCoordinate: { galaxy: 1, system: 1, position: 1 },
    destination: { kind: 'coordinate', coordinate: { galaxy: 1, system: 2, position: 1 } }, selectedShips: { scout: 99 }, departedAt: 9_999, factionId: 'aegis',
  });
  assert.equal(first.created, true);
  assert.equal(second.created, false);
  assert.equal(second.flight, first.flight);
  assert.equal(second.state.records.length, 1);
  assert.equal(first.flight.destinationCoordinate.system, 2);
  assert.ok(first.flight.gasCost > 0);
});

test('deployment can dispatch a commander-only fleet using catalog speed, science, duration and fuel', () => {
  const { flight } = dispatchFlight(createFlightState(), {
    requestId: 'commander-only-deployment',
    missionId: 'deployment',
    originPlanetId: 'helion-01',
    originCoordinate: { galaxy: 1, system: 1, position: 1 },
    destination: { kind: 'coordinate', coordinate: { galaxy: 2, system: 1, position: 1 } },
    selectedShips: {},
    selectedCommanders: { corsair: 1 },
    departedAt: 1_000,
    factionId: 'aegis',
    science: { 4: 1, 2: 7 },
  });

  const expectedSpeed = 33_000 * 1.1;
  assert.equal(flight.effectiveSpeed, expectedSpeed);
  assert.equal(flight.oneWayDurationMs, 310_158);
  assert.equal(flight.gasCost, calculateFlightFuel('aegis', {}, flight.routeDistance, { 2: 7 }, { corsair: 1 }));
  assert.deepEqual(flight.selectedCommanders, { corsair: 1 });
});

test('commander speed and fuel only affect flights when commanders are selected', () => {
  const baseline = dispatchFlight(createFlightState(), {
    requestId: 'commander-baseline',
    missionId: 'deployment',
    originPlanetId: 'helion-01',
    originCoordinate: { galaxy: 1, system: 1, position: 1 },
    destination: { kind: 'coordinate', coordinate: { galaxy: 2, system: 1, position: 1 } },
    selectedShips: { scout: 1 },
    departedAt: 1_000,
    factionId: 'aegis',
  }).flight;
  const withCommander = dispatchFlight(createFlightState(), {
    requestId: 'commander-mixed',
    missionId: 'deployment',
    originPlanetId: 'helion-01',
    originCoordinate: { galaxy: 1, system: 1, position: 1 },
    destination: { kind: 'coordinate', coordinate: { galaxy: 2, system: 1, position: 1 } },
    selectedShips: { scout: 1 },
    selectedCommanders: { corsair: 1 },
    departedAt: 1_000,
    factionId: 'aegis',
  }).flight;

  assert.equal(baseline.effectiveSpeed, 28_000);
  assert.equal(withCommander.effectiveSpeed, 28_000);
  assert.equal(withCommander.oneWayDurationMs, baseline.oneWayDurationMs);
  assert.equal(baseline.gasCost, calculateFlightFuel('aegis', { scout: 1 }, baseline.routeDistance));
  assert.equal(withCommander.gasCost, calculateFlightFuel('aegis', { scout: 1 }, withCommander.routeDistance, {}, { corsair: 1 }));
});

test('transport snapshots normalized cargo and the resolved destination identity without changing flight formulas', () => {
  const { flight } = dispatchFlight(createFlightState(), {
    requestId: 'transport-1',
    missionId: 'transport',
    originPlanetId: 'helion-01',
    originCoordinate: { galaxy: 1, system: 1, position: 1 },
    destination: { kind: 'coordinate', coordinate: { galaxy: 1, system: 2, position: 1 } },
    destinationPlanetId: 'ally-01',
    destinationOwnerId: 'ally-owner',
    targetRelation: 'ally',
    selectedShips: { colonizer: 1 },
    cargo: { metal: 10.8, minerals: -1, gas: 2, debris: Number.NaN },
    departedAt: 1_000,
    factionId: 'aegis',
    science: { 2: 7 },
  });

  assert.deepEqual(flight.cargo, { metal: 10, minerals: 0, gas: 2, debris: 0 });
  assert.equal(flight.cargoState, 'loaded');
  assert.equal(flight.destinationPlanetId, 'ally-01');
  assert.equal(flight.destinationOwnerId, 'ally-owner');
  assert.equal(flight.targetRelation, 'ally');
  assert.equal(flight.oneWayDurationMs, dispatch('formula-control').flight.oneWayDurationMs);
});

test('transport cannot create an ambiguous persisted flight without cargo', () => {
  assert.throws(() => dispatchFlight(createFlightState(), {
    requestId: 'missing-cargo', missionId: 'transport', originPlanetId: 'helion-01',
    originCoordinate: { galaxy: 1, system: 1, position: 1 },
    destination: { kind: 'coordinate', coordinate: { galaxy: 1, system: 2, position: 1 } },
    selectedShips: { colonizer: 1 }, departedAt: 1_000, factionId: 'aegis',
  }), /require a cargo snapshot/);
});

test('recall uses elapsed outbound time, does not change gas, and completes once', () => {
  const { state, flight } = dispatch();
  const recalled = recallFlight(state, flight.id, flight.departedAt + 37_000);
  const returning = recalled.records.find((record) => record.id === flight.id)!;
  assert.equal(returning.phase, 'returning');
  assert.equal(returning.returnAt, flight.departedAt + 74_000);
  assert.equal(returning.gasCost, flight.gasCost);
  const completed = reconcileFlightState(recalled, returning.returnAt!);
  assert.equal(completed.records.find((record) => record.id === flight.id)?.phase, 'completed');
  assert.equal(completed.records.find((record) => record.id === flight.id)?.completionReason, 'recalled');
  assert.equal(reconcileFlightState(completed, returning.returnAt! + 1), completed);
});

test('recall at and after arrival is phase-safe and leaves the outbound record unchanged', () => {
  const { state, flight } = dispatch('arrival-boundary');
  assert.equal(recallFlight(state, flight.id, flight.arrivalAt), state);
  assert.equal(recallFlight(state, flight.id, flight.arrivalAt + 1), state);
});

test('arrival and normal return transitions are phase-guarded and idempotent', () => {
  const { state, flight } = dispatch();
  const arrived = reconcileFlightState(state, flight.arrivalAt);
  assert.equal(arrived.records.find((record) => record.id === flight.id)?.phase, 'arrived');
  assert.equal(arrived.records.find((record) => record.id === flight.id)?.completionReason, 'arrived');
  assert.equal(reconcileFlightState(arrived, flight.arrivalAt + 1), arrived);

  const returning = beginFlightReturn(state, flight.id, flight.arrivalAt, 'target-occupied');
  const returnAt = returning.records.find((record) => record.id === flight.id)?.returnAt!;
  const completed = reconcileFlightState(returning, returnAt);
  assert.equal(completed.records.find((record) => record.id === flight.id)?.completionReason, 'target-occupied');
});
