import assert from 'node:assert/strict';
import test from 'node:test';
import {
  calculateFleetCapacity,
  calculateFleetPopulation,
  createCanonicalStartingFleet,
  getFleetSummary,
  migrateFleetState,
  resolveSavedFleetState,
} from './runtime.ts';

test('canonical starting fleet is persisted by mechanical IDs and derives population from catalog values', () => {
  const fleet = createCanonicalStartingFleet();
  assert.deepEqual(
    { scout: fleet.ships.scout, transporter: fleet.ships.transporter, recycler: fleet.ships.recycler, 'spy-probe': fleet.ships['spy-probe'] },
    { scout: 20, transporter: 10, recycler: 1, 'spy-probe': 3 },
  );
  assert.equal(calculateFleetPopulation(fleet), 58);

  fleet.commanders.corsair = 1;
  assert.equal(calculateFleetPopulation(fleet), 66);
  assert.deepEqual(getFleetSummary(fleet, 1), { population: 66, capacity: 120, available: 54 });
});
test('Hangar is the single capacity resolver and old roster data is not overwritten', () => {
  assert.equal(calculateFleetCapacity(0), 50);
  assert.equal(calculateFleetCapacity(1), 120);
  assert.equal(calculateFleetCapacity(999), 25_112);

  const old = migrateFleetState({ ships: { scout: 4 }, commanders: { corsair: 2 } });
  assert.equal(old.ships.scout, 4);
  assert.equal(old.ships.transporter, 0);
  assert.equal(old.commanders.corsair, 2);
});

test('legacy save without fleet gets the canonical roster while an explicit empty fleet stays empty', () => {
  const legacy = resolveSavedFleetState(undefined);
  assert.equal(calculateFleetPopulation(legacy), 58);
  assert.equal(legacy.ships.scout, 20);

  const explicitEmpty = resolveSavedFleetState({ ships: {}, commanders: {} });
  assert.equal(calculateFleetPopulation(explicitEmpty), 0);
  assert.equal(explicitEmpty.ships.scout, 0);
  assert.equal(explicitEmpty.commanders.corsair, 0);
});
