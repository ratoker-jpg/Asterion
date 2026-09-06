import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ASTER_INDUSTRY_BUILDINGS,
  RECYCLING_MAX_LEVEL,
  createDefaultBuildingLevels,
  getBuildingDefinition,
  migrateBuildingLevels,
  migrateBuildingQueue,
} from './resource-zone.ts';

test('only recycling is capped at level 10 while other industry limits stay unchanged', () => {
  assert.equal(RECYCLING_MAX_LEVEL, 10);
  assert.equal(getBuildingDefinition('recycling').maxLevel, 10);
  assert.equal(getBuildingDefinition('advanced-factory').maxLevel, 5);

  for (const building of ASTER_INDUSTRY_BUILDINGS) {
    if (building.assetRole === 'recycling' || building.assetRole === 'advanced-factory') continue;
    assert.equal(building.maxLevel, 20, `${building.assetRole} must keep max level 20`);
  }
});

test('recycling keeps Shipyard level 5 and Chemistry level 6 requirements', () => {
  assert.deepEqual(getBuildingDefinition('recycling').requirements, [
    { kind: 'building-level', assetRole: 'shipyard', level: 5 },
    { kind: 'science-level', scienceId: 2, level: 6 },
  ]);
});

test('legacy recycling level above 10 is normalized to 10 without changing other building levels', () => {
  const migrated = migrateBuildingLevels({
    recycling: 19,
    construction: 17,
    shipyard: 14,
    'advanced-factory': 9,
  });

  assert.equal(migrated.recycling, 10);
  assert.equal(migrated.construction, 17);
  assert.equal(migrated.shipyard, 14);
  assert.equal(migrated['advanced-factory'], 5);
});

test('legacy queued recycling target above 10 is normalized to 10', () => {
  const buildings = createDefaultBuildingLevels();
  buildings.recycling = 9;
  const queue = migrateBuildingQueue([
    {
      kind: 'building',
      assetRole: 'recycling',
      planetId: 'helion-01',
      enqueuedAt: 100,
      startedAt: 100,
      finishAt: 200,
      targetLevel: 20,
    },
  ], 'helion-01', buildings);

  assert.equal(queue.length, 1);
  assert.equal(queue[0].assetRole, 'recycling');
  assert.equal(queue[0].targetLevel, 10);
});

test('queue migration drops recycling projects when migrated building is already level 10', () => {
  const buildings = migrateBuildingLevels({ recycling: 20 });
  const queue = migrateBuildingQueue([
    {
      kind: 'building',
      assetRole: 'recycling',
      planetId: 'helion-01',
      enqueuedAt: 100,
      startedAt: 100,
      finishAt: 200,
      targetLevel: 20,
    },
    {
      kind: 'building',
      assetRole: 'construction',
      planetId: 'helion-01',
      enqueuedAt: 200,
      startedAt: 200,
      finishAt: 300,
      targetLevel: 1,
    },
  ], 'helion-01', buildings);

  assert.deepEqual(queue.map((item) => item.assetRole), ['construction']);
  assert.equal(queue[0].targetLevel, 1);
});
