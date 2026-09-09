import assert from 'node:assert/strict';
import test from 'node:test';
import {
  BUILDING_ROLES,
  PLANET_BASE_STORAGE_CAPACITY,
  getBuildingBalanceRow,
  getBuildingEffect,
  getBuildingEnergyIncomePerHour,
  getBuildingMaxLevel,
  getBuildingPresentation,
  getBuildingResourceIncomePerHour,
  getBuildingStorageCapacity,
  getConstructionTimeFactor,
  getProductionTimeFactor,
  getUnitProductionTimeFactor,
  calculateUnitProductionDurationMs,
  formatClockDurationMs,
  parseClockDurationMs,
  getHangarCapacity,
  getRecyclingBalance,
  getShipyardTimeFactor,
  getStorageCapacities,
} from './balance-v1.ts';

test('Balance v1 exposes a complete sequential table for every role', () => {
  assert.equal(BUILDING_ROLES.length, 21);
  for (const role of BUILDING_ROLES) {
    const maxLevel = getBuildingMaxLevel(role);
    assert.ok(maxLevel > 0, `${role} must have a positive max level`);
    for (let level = 1; level <= maxLevel; level += 1) {
      const row = getBuildingBalanceRow(role, level);
      assert.ok(row, `${role} level ${level} is missing`);
      assert.equal(row.targetLevel, level);
    }
    const maxRow = getBuildingBalanceRow(role, maxLevel);
    assert.ok(maxRow);
    assert.equal(maxRow.cost, null);
    assert.equal(maxRow.rawTimeMs, null);
  }
});

test('resource and energy income selectors use the current building level', () => {
  assert.deepEqual(getBuildingResourceIncomePerHour({
    'metal-production-1': 1,
    'mineral-production-1': 1,
    'gas-production-1': 1,
  }), { metal: 10_150, minerals: 8_735, gas: 375 });
  assert.equal(getBuildingEnergyIncomePerHour({ 'basic-energy': 1, 'advanced-energy': 1 }), 160);
  assert.deepEqual(getBuildingResourceIncomePerHour({ 'metal-production-1': 999 }), { metal: 161_037, minerals: 0, gas: 0 });
});

test('Balance v1 keeps the clarified planetary storage base separate from building bonuses', () => {
  assert.equal(PLANET_BASE_STORAGE_CAPACITY, 100_000);
  assert.equal(getBuildingStorageCapacity('metal-storage', 0), 100_000);
  assert.equal(getBuildingStorageCapacity('metal-storage', 1), 150_000);
  assert.equal(getBuildingStorageCapacity('metal-storage', 20), 450_100_000);
  assert.deepEqual(getStorageCapacities({
    'metal-storage': 1,
    'mineral-storage': 1,
    'gas-storage': 1,
  }), { metal: 150_000, minerals: 150_000, gas: 150_000 });
});

test('Hangar and recycling selectors use their Balance v1 rows', () => {
  assert.equal(getHangarCapacity(0), 50);
  assert.equal(getHangarCapacity(1), 120);
  assert.equal(getHangarCapacity(20), 25_112);
  assert.deepEqual(getRecyclingBalance(1), { efficiencyPercent: 75, debrisPerSecond: 7 });
  assert.deepEqual(getRecyclingBalance(10), { efficiencyPercent: 120, debrisPerSecond: 98 });
});

test('factory construction speed follows the official level table', () => {
  assert.equal(getConstructionTimeFactor(0), 1);
  assert.equal(getConstructionTimeFactor(1), 0.98);
  assert.equal(getConstructionTimeFactor(2), 0.96);
  assert.equal(getConstructionTimeFactor(3), 0.93);
  assert.equal(getConstructionTimeFactor(20), 0.48);
  const effect = getBuildingEffect('construction', 2);
  assert.equal(effect.kind, 'construction-time-factor');
  if (effect.kind === 'construction-time-factor') assert.equal(effect.factorPercent, 96);
});

test('shipyard construction speed follows the official five-percent-per-level bonus', () => {
  assert.equal(getShipyardTimeFactor(0), 1);
  assert.equal(getShipyardTimeFactor(1), 0.95);
  assert.equal(getShipyardTimeFactor(10), 0.5);
  assert.equal(getShipyardTimeFactor(15), 0.25);
  const effect = getBuildingEffect('shipyard', 3);
  assert.equal(effect.kind, 'unit-production-time-factor');
  if (effect.kind === 'unit-production-time-factor') assert.equal(effect.factorPercent, 85);
});

test('advanced factory and shipyard coefficients compose on the current unit timer', () => {
  assert.equal(getProductionTimeFactor(0), 1);
  assert.equal(getProductionTimeFactor(1), 0.95);
  assert.equal(getProductionTimeFactor(4), 0.8);
  assert.equal(getProductionTimeFactor(5), 0.77);
  assert.equal(getUnitProductionTimeFactor(1, 1), 0.95 * 0.95);
  assert.equal(calculateUnitProductionDurationMs(60_000, 1, 1), 54_150);
  assert.equal(parseClockDurationMs('01:02:03'), 3_723_000);
  assert.equal(formatClockDurationMs(3_723_000), '01:02:03');
});

test('all race presentations resolve canonical names and an asset URL', () => {
  for (const faction of ['aegis', 'synod', 'veyra'] as const) {
    for (const role of BUILDING_ROLES) {
      const presentation = getBuildingPresentation(role, faction);
      assert.ok(presentation.name.length > 0);
      assert.ok(!presentation.name.includes('?'));
      assert.match(presentation.art, /building\.(aegis|synod|veyra)\./);
    }
  }
  assert.equal(getBuildingEffect('shipyard', 15).kind, 'unit-production-time-factor');
});
