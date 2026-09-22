import assert from 'node:assert/strict';
import test from 'node:test';

import {
  OVERPOPULATION_WINDOW_MS,
  calculatePlanetPopulation,
  reconcileOverpopulation,
} from './overpopulation.ts';
import { createEmptyFleetState } from './runtime.ts';

test('linear overpopulation burn removes the smallest ordinary ships and never commanders or satellites', () => {
  const fleet = createEmptyFleetState();
  fleet.ships.scout = 80;
  fleet.commanders.corsair = 1;
  const atStart = reconcileOverpopulation(fleet, 20, 0, 'aegis', 0);
  assert.equal(atStart.blocked, true);
  assert.equal(atStart.state?.episodeStartedAt, 0);
  assert.equal(atStart.state?.initialPopulation, atStart.actualPopulation);
  assert.equal(atStart.state?.initialCapacity, atStart.capacity);
  assert.equal(atStart.fleet.ships.scout, 80);
  assert.equal(atStart.removed.length, 0);
  assert.equal(atStart.state?.lastResolutionReason, undefined);
  assert.equal(atStart.fleet.commanders.corsair, 1);

  const repeatedStart = reconcileOverpopulation(atStart.fleet, 20, 0, 'aegis', 0, atStart.state);
  assert.equal(repeatedStart.changed, false);

  const halfway = reconcileOverpopulation(atStart.fleet, 20, 0, 'aegis', OVERPOPULATION_WINDOW_MS / 2, atStart.state);
  assert.equal(halfway.blocked, true);
  assert.equal(halfway.fleet.commanders.corsair, 1);
  assert.equal(halfway.fleet.ships.scout, 45);
  assert.equal(calculatePlanetPopulation(halfway.fleet, 20), 120);
  assert.deepEqual(halfway.state?.removedShips, [{ shipId: 'scout', count: 35 }]);

  const repeatedAtSameTime = reconcileOverpopulation(
    halfway.fleet,
    20,
    0,
    'aegis',
    OVERPOPULATION_WINDOW_MS / 2,
    halfway.state,
  );
  assert.equal(repeatedAtSameTime.changed, false);
  assert.deepEqual(repeatedAtSameTime.fleet, halfway.fleet);
  assert.deepEqual(repeatedAtSameTime.state, halfway.state);

  const completed = reconcileOverpopulation(halfway.fleet, 20, 0, 'aegis', OVERPOPULATION_WINDOW_MS, halfway.state);
  assert.equal(completed.blocked, false);
  assert.equal(completed.state, undefined);
  assert.equal(completed.fleet.commanders.corsair, 1);
  assert.equal(completed.fleet.ships.scout, 10);
  assert.equal(completed.actualPopulation, 50);
  assert.deepEqual(completed.removedShipCounts, [{ shipId: 'scout', count: 35 }]);
});

test('new excess joins the existing burn pool without resetting the original deadline', () => {
  const fleet = createEmptyFleetState();
  fleet.ships.scout = 100;
  const started = reconcileOverpopulation(fleet, 0, 0, 'aegis', 0);
  const firstHalf = reconcileOverpopulation(started.fleet, 0, 0, 'aegis', 5 * 60 * 1000, started.state);
  const withArrival = { ...firstHalf.fleet, ships: { ...firstHalf.fleet.ships, scout: firstHalf.fleet.ships.scout + 10 } };
  const extended = reconcileOverpopulation(withArrival, 0, 0, 'aegis', 5 * 60 * 1000, firstHalf.state);
  assert.equal(extended.state?.episodeStartedAt, 0);
  assert.equal(extended.state?.scheduledBurnPool, (firstHalf.state?.scheduledBurnPool ?? 0) + 20);
  const finished = reconcileOverpopulation(extended.fleet, 0, 0, 'aegis', OVERPOPULATION_WINDOW_MS, extended.state);
  assert.equal(finished.blocked, false);
  assert.equal(finished.state, undefined);
});

test('a planet with only satellites or commanders remains blocked with an explicit no-eligible reason', () => {
  const fleet = createEmptyFleetState();
  fleet.commanders.corsair = 20;
  const result = reconcileOverpopulation(fleet, 200, 0, 'aegis', 1_000);
  assert.equal(result.blocked, true);
  assert.equal(result.state?.lastResolutionReason, 'no-eligible-units');
  assert.equal(result.fleet.commanders.corsair, 20);
  assert.equal(result.fleet.ships['solar-satellite'], 0);
});

test('priority attrition sorts by unit population, then ship id and instance slot', () => {
  const fleet = createEmptyFleetState();
  fleet.ships['spy-probe'] = 2;
  fleet.ships.transporter = 1;
  fleet.ships.scout = 1;
  fleet.ships['death-star'] = 1;

  const started = reconcileOverpopulation(fleet, 0, 0, 'aegis', 0);
  const result = reconcileOverpopulation(started.fleet, 0, 0, 'aegis', OVERPOPULATION_WINDOW_MS, started.state);

  assert.equal(result.blocked, false);
  assert.deepEqual(result.removed.map((unit) => [unit.id, unit.slot]), [
    ['spy-probe', 0],
    ['spy-probe', 1],
    ['transporter', 0],
    ['scout', 0],
    ['death-star', 0],
  ]);
});

test('exact attrition counts are not limited by the diagnostic removed-unit sample', () => {
  const fleet = createEmptyFleetState();
  fleet.ships['spy-probe'] = 5_000;

  const started = reconcileOverpopulation(fleet, 0, 0, 'aegis', 0);
  const completed = reconcileOverpopulation(
    started.fleet,
    0,
    0,
    'aegis',
    OVERPOPULATION_WINDOW_MS,
    started.state,
  );

  const expectedLoss = 5_000 - completed.fleet.ships['spy-probe'];
  assert.ok(expectedLoss > 1_024);
  assert.ok(completed.removed.length < expectedLoss);
  assert.deepEqual(completed.removedShipCounts, [{ shipId: 'spy-probe', count: expectedLoss }]);
});
