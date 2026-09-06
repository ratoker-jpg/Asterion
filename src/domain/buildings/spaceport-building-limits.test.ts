import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createDefaultBuildingLevels,
  getBuildingDefinition,
  getSpaceportMaxLevel,
  migrateBuildingLevels,
  migrateBuildingQueue,
} from './resource-zone.ts';

test('Spaceport max level is 10 and legacy level 20 migrates to 10', () => {
  assert.equal(getSpaceportMaxLevel(), 10);
  assert.equal(getBuildingDefinition('spaceport').maxLevel, 10);
  assert.equal(migrateBuildingLevels({ spaceport: 20 }).spaceport, 10);
});

test('legacy Spaceport construction target above 10 is clamped and maxed saves drop impossible queue items', () => {
  const levelNine = createDefaultBuildingLevels();
  levelNine.spaceport = 9;
  const migrated = migrateBuildingQueue([{
    assetRole: 'spaceport',
    enqueuedAt: 1_000,
    startedAt: 1_000,
    finishAt: 2_000,
    targetLevel: 20,
  }], 'helion-01', levelNine);
  assert.equal(migrated.length, 1);
  assert.equal(migrated[0].targetLevel, 10);

  const maxed = createDefaultBuildingLevels();
  maxed.spaceport = 10;
  assert.equal(migrateBuildingQueue([{
    assetRole: 'spaceport',
    startedAt: 1_000,
    finishAt: 2_000,
    targetLevel: 20,
  }], 'helion-01', maxed).length, 0);
});
