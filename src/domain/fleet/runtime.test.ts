import assert from 'node:assert/strict';
import test from 'node:test';
import {
  calculateFleetCapacity,
  calculateFleetPopulation,
  createCanonicalStartingFleet,
  migrateFleetState,
} from './runtime.ts';

test('canonical starting fleet is persisted by mechanical IDs and derives population from catalog values', () => {
  const fleet = createCanonicalStartingFleet();
  assert.deepEqual(
    { scout: fleet.ships.scout, transporter: fleet.ships.transporter, recycler: fleet.ships.recycler, 'spy-probe': fleet.ships['spy-probe'] },
    { scout: 20, transporter: 10, recycler: 1, 'spy-probe': 3 },
  );
  assert.equal(calculateFleetPopulation(fleet), 58);
});
test('Hangar is the single capacity resolver and old roster data is not overwritten', () => {
  assert.equal(calculateFleetCapacity(0), 50);
  assert.equal(calculateFleetCapacity(1), 70);
  assert.equal(calculateFleetCapacity(999), 450);

  const old = migrateFleetState({ ships: { scout: 4 }, commanders: { corsair: 2 } });
  assert.equal(old.ships.scout, 4);
  assert.equal(old.ships.transporter, 0);
  assert.equal(old.commanders.corsair, 2);
});
