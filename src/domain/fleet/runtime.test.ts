import assert from 'node:assert/strict';
import test from 'node:test';
import {
  calculateFleetCapacity,
  calculateFleetPopulation,
  addFleetUnits,
  createCanonicalStartingFleet,
  getFleetSummary,
  migrateFleetState,
  normalizeFleetStateForCapacity,
  resolveSavedFleetState,
} from './runtime.ts';

test('canonical starting fleet is persisted by mechanical IDs and derives population from catalog values', () => {
  const fleet = createCanonicalStartingFleet();
  assert.deepEqual(
    { scout: fleet.ships.scout, transporter: fleet.ships.transporter, recycler: fleet.ships.recycler, 'spy-probe': fleet.ships['spy-probe'] },
    { scout: 20, transporter: 10, recycler: 1, 'spy-probe': 3 },
  );
  assert.equal(calculateFleetPopulation(fleet), 58);
  assert.equal(calculateFleetPopulation(fleet, 'synod'), 60);
  assert.equal(calculateFleetPopulation(fleet, 'veyra'), 48);

  fleet.commanders.corsair = 1;
  assert.equal(calculateFleetPopulation(fleet), 68);
  assert.deepEqual(getFleetSummary(fleet, 1), { population: 68, capacity: 120, available: 52 });
});

test('fleet population resolves the selected faction catalog for each owned ship', () => {
  const fleet = createCanonicalStartingFleet();
  const aegis = getFleetSummary(fleet, 1, 'aegis');
  const synod = getFleetSummary(fleet, 1, 'synod');
  const veyra = getFleetSummary(fleet, 1, 'veyra');

  assert.deepEqual(aegis, { population: 58, capacity: 120, available: 62 });
  assert.deepEqual(synod, { population: 60, capacity: 120, available: 60 });
  assert.deepEqual(veyra, { population: 48, capacity: 120, available: 72 });
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

test('population guard rejects additions over hangar capacity and damaged rosters are normalized deterministically', () => {
  const empty = migrateFleetState({ ships: {}, commanders: {} });
  const accepted = addFleetUnits(empty, 'ship', 'scout', 60, 1);
  assert.equal(accepted.ok, true);
  assert.equal(accepted.population, 120);

  const rejected = addFleetUnits(accepted.fleet, 'ship', 'scout', 1, 1);
  assert.equal(rejected.ok, false);
  assert.equal(rejected.reason, 'Недостаточно населения');
  assert.equal(rejected.fleet.ships.scout, accepted.fleet.ships.scout);

  const damaged = migrateFleetState({ ships: { destroyer: 1_000 }, commanders: {} });
  const normalized = normalizeFleetStateForCapacity(damaged, 20);
  assert.equal(calculateFleetPopulation(normalized), 25_110);
  assert.equal(getFleetSummary(damaged, 20).population, 25_110);
});
