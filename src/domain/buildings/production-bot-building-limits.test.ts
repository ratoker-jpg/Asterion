import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ADVANCED_FACTORY_MAX_LEVEL,
  createDefaultBuildingLevels,
  evaluateBuildingBuild,
  getBuildingDefinition,
  migrateBuildingLevels,
  migrateBuildingQueue,
  type BuildingEconomyState,
} from './resource-zone.ts';

const createState = (): BuildingEconomyState => ({
  resources: { metal: 10_000_000, minerals: 10_000_000, gas: 10_000_000, energy: 10_000_000 },
  buildings: createDefaultBuildingLevels(),
  queue: [],
  scienceLevels: {},
});

test('advanced factory max level is 5, shipyard 15, and other Balance v1 limits remain explicit', () => {
  assert.equal(ADVANCED_FACTORY_MAX_LEVEL, 5);
  assert.equal(getBuildingDefinition('advanced-factory').maxLevel, 5);
  assert.equal(getBuildingDefinition('construction').maxLevel, 20);
  assert.equal(getBuildingDefinition('metal-storage').maxLevel, 20);
  assert.equal(getBuildingDefinition('shipyard').maxLevel, 15);
});

test('legacy advanced factory levels above 5 normalize down to 5', () => {
  const migrated = migrateBuildingLevels({
    construction: 20,
    'advanced-factory': 18,
    shipyard: 17,
  });
  assert.equal(migrated.construction, 20);
  assert.equal(migrated['advanced-factory'], 5);
  assert.equal(migrated.shipyard, 15);
});

test('advanced factory keeps factory level 10 requirement', () => {
  assert.deepEqual(getBuildingDefinition('advanced-factory').requirements, [
    { kind: 'building-level', assetRole: 'construction', level: 10 },
  ]);

  const state = createState();
  state.buildings.construction = 9;
  assert.equal(evaluateBuildingBuild(state, 'advanced-factory').status, 'requirements-unmet');
  state.buildings.construction = 10;
  assert.equal(evaluateBuildingBuild(state, 'advanced-factory').status, 'available');
});

test('migrated queue cannot retain advanced factory levels above 5', () => {
  const buildings = createDefaultBuildingLevels();
  buildings.construction = 20;
  buildings['advanced-factory'] = 4;

  const migrated = migrateBuildingQueue([
    { assetRole: 'advanced-factory', targetLevel: 5, startedAt: 100, finishAt: 200 },
    { assetRole: 'advanced-factory', targetLevel: 6, startedAt: 200, finishAt: 300 },
    { assetRole: 'shipyard', targetLevel: 1, startedAt: 300, finishAt: 400 },
  ], 'helion-01', buildings);

  assert.deepEqual(migrated.map((item) => [item.assetRole, item.targetLevel]), [
    ['advanced-factory', 5],
    ['shipyard', 1],
  ]);
});

test('build availability refuses advanced factory once projected level reaches 5', () => {
  const state = createState();
  state.buildings.construction = 20;
  state.buildings['advanced-factory'] = 5;
  const availability = evaluateBuildingBuild(state, 'advanced-factory');
  assert.equal(availability.status, 'max-level');
  assert.equal(availability.canBuild, false);
  assert.equal(availability.maxLevel, 5);
});
