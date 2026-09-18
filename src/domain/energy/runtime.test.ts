import assert from 'node:assert/strict';
import test from 'node:test';

import {
  POSITION_COEFFICIENT_BY_POSITION,
  SUN_EFFICIENCY_BY_SYSTEM,
  calculateEnergySources,
  calculateNuclearReactorContribution,
  calculateSolarSatelliteContribution,
  calculateSolarStationContribution,
  consumeEnergy,
  createEnergyLedger,
  getPhysicsMultiplier,
  getPositionCoefficientPercent,
  getSunEfficiencyPercent,
  hydrateEnergyLedger,
  refundEnergy,
  rebuildEnergyLedger,
  removeEnergySource,
  type EnergySourceId,
  type EnergySourceSnapshot,
} from './runtime.ts';

function fixtureSource(id: EnergySourceId, fullContribution: number, count = 1): EnergySourceSnapshot {
  return {
    id,
    kind: id,
    level: id === 'solar-satellite' ? 0 : 1,
    count,
    baseValue: fullContribution,
    baseContribution: fullContribution,
    physicsMultiplier: 1,
    sunMultiplier: 1,
    positionMultiplier: 1,
    fullContribution,
    consumedContribution: 0,
    unusedContribution: fullContribution,
  };
}

test('solar station uses the Balance v1 base rows and Physics 8 control values', () => {
  const base = calculateEnergySources({ buildings: { 'basic-energy': 23 } });
  const controlled = calculateEnergySources({
    buildings: { 'basic-energy': 23 },
    scienceLevels: { 1: 8 },
    system: 19,
    position: 14,
  });
  const nextControlled = calculateEnergySources({
    buildings: { 'basic-energy': 24 },
    scienceLevels: { 1: 8 },
    system: 19,
    position: 14,
  });

  assert.equal(base[0]?.baseValue, 12_830);
  assert.equal(calculateSolarStationContribution(24, 0, 19, 14), 14_270);
  assert.equal(controlled[0]?.fullContribution, 17_962);
  assert.equal(nextControlled[0]?.fullContribution, 19_978);
  assert.equal(nextControlled[0]!.fullContribution - controlled[0]!.fullContribution, 2_016);
});

test('physics applies to every source, while sun and position apply only to solar sources', () => {
  assert.equal(getPhysicsMultiplier(8), 1.4);
  assert.equal(calculateNuclearReactorContribution(1, 0), 100);
  assert.equal(calculateNuclearReactorContribution(20, 8), 14_770);
  assert.equal(calculateNuclearReactorContribution(20, 0), 10_550);
  assert.equal(calculateSolarSatelliteContribution(1, 0, 19, 14), 55);
  assert.equal(calculateSolarSatelliteContribution(1, 8, 19, 14), 77);
  assert.equal(calculateSolarSatelliteContribution(1, 0, 1, 1), 46);
});

test('sun and position balance tables are explicit and stable', () => {
  assert.equal(Object.keys(SUN_EFFICIENCY_BY_SYSTEM).length, 40);
  assert.equal(Object.keys(POSITION_COEFFICIENT_BY_POSITION).length, 24);
  assert.equal(getSunEfficiencyPercent(1), 70);
  assert.equal(getSunEfficiencyPercent(15), 85);
  assert.equal(getSunEfficiencyPercent(19), 100);
  assert.equal(getSunEfficiencyPercent(22), 85);
  assert.equal(getSunEfficiencyPercent(40), 70);
  assert.equal(getPositionCoefficientPercent(1), 120);
  assert.equal(getPositionCoefficientPercent(6), 130);
  assert.equal(getPositionCoefficientPercent(19), 80);
  assert.equal(getPositionCoefficientPercent(24), 85);
});

test('expense attribution removes only unused satellite energy', () => {
  const initial = createEnergyLedger([
    fixtureSource('solar-station', 100),
    fixtureSource('solar-satellite', 260, 4),
  ]);
  const spent = consumeEnergy(initial, 250);
  assert.equal(spent.ok, true);
  assert.equal(spent.ledger.availableEnergy, 110);
  assert.equal(spent.ledger.consumedBySource['solar-satellite'], 250);

  const dismantled = removeEnergySource(spent.ledger, 'solar-satellite', 'satellite');
  assert.equal(dismantled.ok, true);
  assert.equal(dismantled.amount, 10);
  assert.equal(dismantled.ledger.availableEnergy, 100);
  assert.equal(dismantled.ledger.consumedEnergy, 250);
  assert.equal(dismantled.ledger.sources.some((source) => source.id === 'solar-satellite'), false);
});

test('explicit source destruction can expose the retained energy debt', () => {
  const spent = consumeEnergy(createEnergyLedger([fixtureSource('solar-station', 100)]), 80);
  const destroyed = removeEnergySource(spent.ledger, 'solar-station', 'building');

  assert.equal(destroyed.ledger.availableEnergy, -80);
  assert.equal(destroyed.ledger.debtCause, 'source-removal');
  assert.equal(destroyed.ledger.consumedEnergy, 80);
});

test('environment and coefficient decreases never create a new debt from spent energy', () => {
  const spent = consumeEnergy(createEnergyLedger([fixtureSource('solar-station', 100)]), 100);
  const reduced = rebuildEnergyLedger(
    spent.ledger,
    [fixtureSource('solar-station', 80)],
    { sourceChanges: { 'solar-station': 'environment' } },
  );

  assert.equal(reduced.availableEnergy, 0);
  assert.equal(reduced.debtCause, null);
});

test('sun efficiency changes preserve consumed energy across a decrease and recovery', () => {
  const initial = createEnergyLedger([fixtureSource('solar-station', 100)]);
  const spent = consumeEnergy(initial, 80);
  assert.equal(spent.ok, true);
  assert.equal(spent.ledger.availableEnergy, 20);

  const reduced = rebuildEnergyLedger(
    spent.ledger,
    [fixtureSource('solar-station', 70)],
    { sourceChanges: { 'solar-station': 'environment' } },
  );
  assert.equal(reduced.producedEnergy, 70);
  assert.equal(reduced.consumedEnergy, 80);
  assert.equal(reduced.availableEnergy, 0);
  assert.equal(reduced.debtCause, null);

  const restored = rebuildEnergyLedger(
    reduced,
    [fixtureSource('solar-station', 100)],
    { sourceChanges: { 'solar-station': 'environment' } },
  );
  assert.equal(restored.producedEnergy, 100);
  assert.equal(restored.consumedEnergy, 80);
  assert.equal(restored.availableEnergy, 20);
});

test('energy refunds add stock without losing debt or exceeding the consumed balance', () => {
  const noExpenseRefund = refundEnergy(createEnergyLedger([fixtureSource('solar-station', 140)]), 8);
  assert.equal(noExpenseRefund.amount, 8);
  assert.equal(noExpenseRefund.ledger.producedEnergy, 148);
  assert.equal(noExpenseRefund.ledger.consumedEnergy, 0);
  assert.equal(noExpenseRefund.ledger.availableEnergy, 148);

  const debt = createEnergyLedger([fixtureSource('solar-station', 100)], -50);
  assert.equal(debt.availableEnergy, -50);
  const recovered = refundEnergy(debt, 8);
  assert.equal(recovered.ledger.availableEnergy, -42);
  assert.equal(recovered.ledger.consumedEnergy, 142);
});

test('partial ledgers without sources keep scalar energy authoritative during migration', () => {
  const migrated = hydrateEnergyLedger(
    { producedEnergy: 17_962, availableEnergy: 17_962, consumedEnergy: 0 },
    [fixtureSource('solar-station', 17_962)],
    140,
  );
  assert.equal(migrated.producedEnergy, 17_962);
  assert.equal(migrated.consumedEnergy, 0);
  assert.equal(migrated.availableEnergy, 17_962);
  assert.equal(migrated.sources.length, 1);

  const negative = hydrateEnergyLedger(
    { producedEnergy: 100, availableEnergy: -50, consumedEnergy: 150 },
    [fixtureSource('solar-station', 100)],
    140,
  );
  assert.equal(negative.producedEnergy, 100);
  assert.equal(negative.consumedEnergy, 150);
  assert.equal(negative.availableEnergy, -50);
  assert.equal(negative.debtCause, 'source-removal');
});

test('positive source changes are retroactive and transaction ids are idempotent', () => {
  const oldSources = calculateEnergySources({ buildings: { 'basic-energy': 23 }, system: 19, position: 14 });
  const newSources = calculateEnergySources({ buildings: { 'basic-energy': 23 }, scienceLevels: { 1: 8 }, system: 19, position: 14 });
  const upgraded = rebuildEnergyLedger(createEnergyLedger(oldSources), newSources);
  assert.equal(upgraded.availableEnergy, 17_962);

  const first = consumeEnergy(upgraded, 500, 'energy-transaction-1');
  const repeated = consumeEnergy(first.ledger, 500, 'energy-transaction-1');
  assert.equal(first.ledger.availableEnergy, 17_462);
  assert.equal(repeated.amount, 0);
  assert.equal(repeated.ledger.availableEnergy, first.ledger.availableEnergy);
});
