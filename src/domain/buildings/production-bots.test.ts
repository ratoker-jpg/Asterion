import assert from 'node:assert/strict';
import test from 'node:test';
import { RESOURCE_BASE_INCOME_PER_HOUR, createDefaultBuildingLevels } from './resource-zone.ts';
import {
  MAX_PRODUCTION_BOTS_PER_RESOURCE,
  PRODUCTION_BOT_BONUSES,
  PRODUCTION_BOT_BUILDING_ROLES,
  createEmptyBotAssignment,
  getAvailableProductionBots,
  getProductionBotAssignmentTotal,
  getProductionBotBonusPercent,
  getProductionBotFreeCount,
  getProductionBotIncomePerHour,
  isProductionBotAssignmentValid,
  isProductionBotBuildingRole,
  migrateProductionBotAssignment,
  productionBotAssignmentsEqual,
  setProductionBotDraftResource,
  type BotAssignment,
} from './production-bots.ts';

test('production bot percentages are exactly the approved 6/5/4 contract', () => {
  assert.deepEqual(
    PRODUCTION_BOT_BONUSES.map(({ resource, percentPerBot }) => [resource, percentPerBot]),
    [
      ['metal', 6],
      ['minerals', 5],
      ['gas', 4],
    ],
  );
});

test('factory and advanced factory reuse one shared production bot model', () => {
  assert.deepEqual(PRODUCTION_BOT_BUILDING_ROLES, ['construction', 'advanced-factory']);
  assert.equal(isProductionBotBuildingRole('construction'), true);
  assert.equal(isProductionBotBuildingRole('advanced-factory'), true);
  assert.equal(isProductionBotBuildingRole('recycling'), false);
});

test('available bot pool is factory level + advanced factory level x2', () => {
  const levels = createDefaultBuildingLevels();
  levels.construction = 4;
  levels['advanced-factory'] = 0;
  assert.equal(getAvailableProductionBots(levels), 4);

  levels['advanced-factory'] = 5;
  assert.equal(getAvailableProductionBots(levels), 14);

  levels.construction = 20;
  assert.equal(getAvailableProductionBots(levels), 30);
});

test('each resource is capped at 10 bots and total draft never exceeds available pool', () => {
  let draft = createEmptyBotAssignment();
  draft = setProductionBotDraftResource(draft, 'metal', 99, 14);
  assert.equal(draft.metal, MAX_PRODUCTION_BOTS_PER_RESOURCE);

  draft = setProductionBotDraftResource(draft, 'minerals', 10, 14);
  assert.deepEqual(draft, { metal: 10, minerals: 4, gas: 0 });
  assert.equal(getProductionBotAssignmentTotal(draft), 14);
  assert.equal(getProductionBotFreeCount(draft, 14), 0);
  assert.equal(isProductionBotAssignmentValid(draft, 14), true);

  draft = setProductionBotDraftResource(draft, 'gas', 7, 14);
  assert.deepEqual(draft, { metal: 10, minerals: 4, gas: 0 });
});

test('migration clamps malformed assignments to per-resource and available-pool limits', () => {
  const levels = createDefaultBuildingLevels();
  levels.construction = 4;
  levels['advanced-factory'] = 5;
  assert.deepEqual(
    migrateProductionBotAssignment({ metal: 12, minerals: 8.9, gas: 9 }, levels),
    { metal: 10, minerals: 4, gas: 0 },
  );
});

test('draft calculations do not mutate applied assignment or applied income before distribute', () => {
  const applied: BotAssignment = { metal: 0, minerals: 0, gas: 0 };
  const incomeBefore = getProductionBotIncomePerHour(RESOURCE_BASE_INCOME_PER_HOUR, applied);
  const draft = setProductionBotDraftResource(applied, 'metal', 6, 10);

  assert.deepEqual(applied, { metal: 0, minerals: 0, gas: 0 });
  assert.deepEqual(draft, { metal: 6, minerals: 0, gas: 0 });
  assert.equal(productionBotAssignmentsEqual(applied, draft), false);
  assert.deepEqual(getProductionBotIncomePerHour(RESOURCE_BASE_INCOME_PER_HOUR, applied), incomeBefore);
  assert.equal(getProductionBotBonusPercent(applied, 'metal'), 0);
  assert.equal(getProductionBotBonusPercent(draft, 'metal'), 36);
});

test('10 applied bots give exactly +60% metal, +50% minerals and +40% gas', () => {
  const applied: BotAssignment = { metal: 10, minerals: 10, gas: 10 };
  assert.equal(getProductionBotBonusPercent(applied, 'metal'), 60);
  assert.equal(getProductionBotBonusPercent(applied, 'minerals'), 50);
  assert.equal(getProductionBotBonusPercent(applied, 'gas'), 40);

  assert.deepEqual(getProductionBotIncomePerHour(RESOURCE_BASE_INCOME_PER_HOUR, applied), {
    metal: 1238.4,
    minerals: 765,
    gas: 436.79999999999995,
  });
});
