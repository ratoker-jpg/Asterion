import assert from 'node:assert/strict';
import test from 'node:test';

import {
  OVERPOPULATION_WINDOW_MS,
  calculatePlanetPopulation,
  getOverpopulationEligibleUnits,
  reconcileOverpopulation,
} from './overpopulation.ts';
import { createEmptyFleetState } from './runtime.ts';

test('linear overpopulation burn removes satellites and the smallest ships first and never commanders', () => {
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
  // Satellites (population 1) burn before scouts (population 2).
  assert.equal(halfway.solarSatellites, 0);
  assert.equal(halfway.fleet.ships.scout, 55);
  assert.equal(calculatePlanetPopulation(halfway.fleet, halfway.solarSatellites), 120);
  assert.deepEqual(halfway.state?.removedShips, [{ shipId: 'solar-satellite', count: 20 }, { shipId: 'scout', count: 25 }]);

  const repeatedAtSameTime = reconcileOverpopulation(
    halfway.fleet,
    halfway.solarSatellites,
    0,
    'aegis',
    OVERPOPULATION_WINDOW_MS / 2,
    halfway.state,
  );
  assert.equal(repeatedAtSameTime.changed, false);
  assert.deepEqual(repeatedAtSameTime.fleet, halfway.fleet);
  assert.deepEqual(repeatedAtSameTime.state, halfway.state);

  const completed = reconcileOverpopulation(halfway.fleet, halfway.solarSatellites, 0, 'aegis', OVERPOPULATION_WINDOW_MS, halfway.state);
  assert.equal(completed.blocked, false);
  assert.equal(completed.state, undefined);
  assert.equal(completed.fleet.commanders.corsair, 1);
  assert.equal(completed.fleet.ships.scout, 20);
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

test('a planet whose excess is only commanders remains blocked with an explicit no-eligible reason', () => {
  const fleet = createEmptyFleetState();
  fleet.commanders.corsair = 20;
  const result = reconcileOverpopulation(fleet, 0, 0, 'aegis', 1_000);
  assert.equal(result.blocked, true);
  assert.equal(result.state?.lastResolutionReason, 'no-eligible-units');
  assert.equal(result.fleet.commanders.corsair, 20);
  const later = reconcileOverpopulation(result.fleet, 0, 0, 'aegis', 1_000 + OVERPOPULATION_WINDOW_MS, result.state);
  assert.equal(later.blocked, true);
  assert.equal(later.fleet.commanders.corsair, 20, 'commanders are never burned');
});

test('an excess made only of solar satellites burns satellites and unblocks the planet', () => {
  const fleet = createEmptyFleetState();
  const started = reconcileOverpopulation(fleet, 200, 0, 'aegis', 0);
  assert.equal(started.blocked, true);
  assert.equal(started.state?.lastResolutionReason, undefined);
  const completed = reconcileOverpopulation(started.fleet, started.solarSatellites, 0, 'aegis', OVERPOPULATION_WINDOW_MS, started.state);
  assert.equal(completed.blocked, false);
  assert.equal(completed.solarSatellites, 50);
  assert.equal(completed.actualPopulation, 50);
  assert.deepEqual(completed.removedShipCounts, [{ shipId: 'solar-satellite', count: 150 }]);
});

test('a mixed excess burns satellites first, then ships, and keeps commanders', () => {
  const fleet = createEmptyFleetState();
  fleet.ships.cruiser = 10;
  fleet.commanders.corsair = 2;
  // 10 satellites + 70 cruiser population + 20 commanders = 100, capacity 50.
  const started = reconcileOverpopulation(fleet, 10, 0, 'aegis', 0);
  assert.equal(started.excess, 50);
  assert.deepEqual(getOverpopulationEligibleUnits(fleet, 'aegis', undefined, 10).slice(0, 1).map((unit) => unit.id), ['solar-satellite']);
  const completed = reconcileOverpopulation(started.fleet, started.solarSatellites, 0, 'aegis', OVERPOPULATION_WINDOW_MS, started.state);
  assert.equal(completed.blocked, false);
  assert.equal(completed.solarSatellites, 0);
  assert.equal(completed.fleet.ships.cruiser, 4);
  assert.equal(completed.fleet.commanders.corsair, 2);
  assert.deepEqual(completed.removedShipCounts, [{ shipId: 'solar-satellite', count: 10 }, { shipId: 'cruiser', count: 6 }]);
});

test('protected ordinary ships count toward full population while unprotected ships burn in population order', () => {
  const fleet = createEmptyFleetState();
  fleet.ships['spy-probe'] = 60;
  fleet.ships.transporter = 100;
  fleet.ships.scout = 5;
  fleet.commanders.corsair = 2;
  const protectedShipCounts = { 'spy-probe': 50 };

  assert.equal(
    getOverpopulationEligibleUnits(fleet, 'aegis', protectedShipCounts).filter((unit) => unit.id === 'spy-probe').length,
    10,
  );

  // The final argument is the requested optional protectedShipCounts domain contract.
  const started = reconcileOverpopulation(fleet, 3, 1, 'aegis', 0, undefined, protectedShipCounts);
  assert.equal(started.actualPopulation, 193);
  assert.equal(started.excess, 73);
  assert.equal(started.state?.initialPopulation, 193);
  assert.equal(started.state?.initialExcess, 73);
  assert.equal(started.fleet.ships['spy-probe'], 60);

  const burned = reconcileOverpopulation(
    started.fleet,
    3,
    1,
    'aegis',
    OVERPOPULATION_WINDOW_MS,
    started.state,
    protectedShipCounts,
  );

  assert.deepEqual(burned.removedShipCounts, [
    { shipId: 'solar-satellite', count: 3 },
    { shipId: 'spy-probe', count: 10 },
    { shipId: 'transporter', count: 60 },
  ]);
  assert.equal(burned.solarSatellites, 0);
  assert.equal(burned.fleet.ships['spy-probe'], 50);
  assert.equal(burned.fleet.ships.transporter, 40);
  assert.equal(burned.fleet.ships.scout, 5);
  assert.equal(burned.fleet.commanders.corsair, 2);
  assert.equal(burned.actualPopulation, 120);
  assert.equal(burned.blocked, false);
});

test('overpopulation leaves only protected ordinary ships intact and keeps the episode blocked', () => {
  const fleet = createEmptyFleetState();
  fleet.ships.scout = 30;
  fleet.commanders.corsair = 2;
  const protectedShipCounts = { scout: 30 };

  const result = reconcileOverpopulation(
    fleet,
    0,
    0,
    'aegis',
    OVERPOPULATION_WINDOW_MS,
    undefined,
    protectedShipCounts,
  );

  assert.equal(result.actualPopulation, 80);
  assert.equal(result.excess, 30);
  assert.equal(result.blocked, true);
  assert.equal(result.state?.blocked, true);
  assert.equal(result.state?.lastResolutionReason, 'no-eligible-units');
  assert.deepEqual(result.removed, []);
  assert.deepEqual(result.removedShipCounts, []);
  assert.equal(result.fleet.ships.scout, 30);
  assert.equal(result.fleet.ships['solar-satellite'], 0);
  assert.equal(result.fleet.commanders.corsair, 2);
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
