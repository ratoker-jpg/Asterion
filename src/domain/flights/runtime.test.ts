import assert from 'node:assert/strict';
import test from 'node:test';

import { beginFlightReturn, createFlightState, dispatchFlight, reconcileFlightState, recallFlight } from './runtime.ts';

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
