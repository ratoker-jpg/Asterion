import assert from 'node:assert/strict';
import test from 'node:test';
import { RESOURCE_BASE_INCOME_PER_HOUR } from './resource-zone.ts';
import {
  PRODUCTION_BOT_BONUSES,
  PRODUCTION_BOT_BUILDING_ROLES,
  createEmptyBotAssignment,
  getProductionBotBonusPercent,
  isProductionBotBuildingRole,
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

test('factory and advanced factory reuse the same production bot model without merging their data', () => {
  assert.deepEqual(PRODUCTION_BOT_BUILDING_ROLES, ['construction', 'advanced-factory']);
  assert.equal(isProductionBotBuildingRole('construction'), true);
  assert.equal(isProductionBotBuildingRole('advanced-factory'), true);
  assert.equal(isProductionBotBuildingRole('recycling'), false);
});

test('empty production bot state has no assigned bots and no current bonus', () => {
  const assignment = createEmptyBotAssignment();
  assert.deepEqual(assignment, { metal: 0, minerals: 0, gas: 0 });
  assert.equal(getProductionBotBonusPercent(assignment, 'metal'), 0);
  assert.equal(getProductionBotBonusPercent(assignment, 'minerals'), 0);
  assert.equal(getProductionBotBonusPercent(assignment, 'gas'), 0);
});

test('production bot preview calculations do not modify actual resource income', () => {
  const before = { ...RESOURCE_BASE_INCOME_PER_HOUR };
  const preview: BotAssignment = { metal: 4, minerals: 3, gas: 2 };

  assert.equal(getProductionBotBonusPercent(preview, 'metal'), 24);
  assert.equal(getProductionBotBonusPercent(preview, 'minerals'), 15);
  assert.equal(getProductionBotBonusPercent(preview, 'gas'), 8);

  assert.deepEqual(RESOURCE_BASE_INCOME_PER_HOUR, before);
  assert.deepEqual(RESOURCE_BASE_INCOME_PER_HOUR, {
    metal: 774,
    minerals: 510,
    gas: 312,
  });
});
