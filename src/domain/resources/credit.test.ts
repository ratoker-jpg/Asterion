import assert from 'node:assert/strict';
import test from 'node:test';
import { creditResources } from './credit.ts';

test('accepts only free storage and burns the remainder', () => {
  const result = creditResources(
    { metal: 90, minerals: 10, gas: 0, energy: 5 },
    { metal: 100, minerals: 100, gas: 100 },
    { metal: 25, minerals: 15, gas: 5, energy: 3 },
  );

  assert.deepEqual(result.wallet, { metal: 100, minerals: 25, gas: 5, energy: 8 });
  assert.deepEqual(result.accepted, { metal: 10, minerals: 15, gas: 5, energy: 3 });
  assert.deepEqual(result.burned, { metal: 15, minerals: 0, gas: 0, energy: 0 });
});

test('full storage burns new credit instead of banking it for a later spend', () => {
  const full = creditResources(
    { metal: 100, minerals: 100, gas: 100 },
    { metal: 100, minerals: 100, gas: 100 },
    { metal: 12, minerals: 7, gas: 3 },
  );
  const afterSpend = creditResources(
    { ...full.wallet, metal: 60 },
    { metal: 100, minerals: 100, gas: 100 },
    {},
  );

  assert.deepEqual(full.accepted, { metal: 0, minerals: 0, gas: 0, energy: 0 });
  assert.deepEqual(full.burned, { metal: 12, minerals: 7, gas: 3, energy: 0 });
  assert.equal(afterSpend.wallet.metal, 60);
});

test('normalizes invalid values and treats missing or invalid capacities as zero', () => {
  const result = creditResources(
    { metal: Number.POSITIVE_INFINITY, minerals: -1, gas: Number.NaN, energy: -5 },
    { metal: Number.NaN, minerals: -1 },
    { metal: -2, minerals: Number.POSITIVE_INFINITY, gas: 3, energy: Number.NaN },
  );

  assert.deepEqual(result.wallet, { metal: 0, minerals: 0, gas: 0, energy: 0 });
  assert.deepEqual(result.accepted, { metal: 0, minerals: 0, gas: 0, energy: 0 });
  assert.deepEqual(result.burned, { metal: 0, minerals: 0, gas: 3, energy: 0 });
});

test('energy accepts every positive finite credit without a capacity', () => {
  const result = creditResources(
    { energy: 10 },
    undefined,
    { energy: 250.5 },
  );

  assert.equal(result.wallet.energy, 260.5);
  assert.equal(result.accepted.energy, 250.5);
  assert.equal(result.burned.energy, 0);
});

test('does not mutate wallet, capacities, or credit inputs', () => {
  const wallet = { metal: 90, minerals: 1, gas: 2, energy: 3 };
  const capacities = { metal: 100, minerals: 100, gas: 100 };
  const credit = { metal: 20, minerals: 4, gas: 5, energy: 6 };
  const walletBefore = { ...wallet };
  const capacitiesBefore = { ...capacities };
  const creditBefore = { ...credit };

  creditResources(wallet, capacities, credit);

  assert.deepEqual(wallet, walletBefore);
  assert.deepEqual(capacities, capacitiesBefore);
  assert.deepEqual(credit, creditBefore);
});
