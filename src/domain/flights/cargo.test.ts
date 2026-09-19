import assert from 'node:assert/strict';
import test from 'node:test';

import {
  addDebris,
  clampCargoToSourceAndCapacity,
  creditTransportCargo,
  getCargoCapacity,
  getFleetCargoCapacity,
  getOverflowWarning,
  normalizePersistedTransportCargo,
  normalizeTransportCargo,
} from './cargo.ts';

test('normalizes malformed cargo snapshots into the four safe persisted keys', () => {
  assert.deepEqual(normalizeTransportCargo({ metal: 4.9, minerals: -1, gas: Number.NaN, debris: Infinity, energy: 99 }), {
    metal: 4, minerals: 0, gas: 0, debris: 0,
  });
  assert.equal(normalizePersistedTransportCargo(undefined), undefined);
  assert.deepEqual(normalizePersistedTransportCargo('bad'), { metal: 0, minerals: 0, gas: 0, debris: 0 });
});

test('uses caller-supplied canonical ship cargo and includes colonizers', () => {
  const capacity = getFleetCargoCapacity(
    { colonizer: 1, transporter: 2, scout: -1 },
    { colonizer: { cargo: 7_500 }, transporter: { cargo: 5_000 }, scout: { cargo: 250 } },
  );
  assert.equal(capacity, 17_500);
  assert.deepEqual(getCargoCapacity({ metal: 10_000, debris: 1 }, capacity), { used: 10_001, total: 17_500, free: 7_499 });
});

test('clamps every cargo kind to source stock and the shared fleet capacity', () => {
  assert.deepEqual(
    clampCargoToSourceAndCapacity(
      { metal: 10_000, minerals: 500, gas: 500, debris: 500 },
      { metal: 10_000, minerals: 900, gas: 900 },
      900,
      10_900,
    ),
    { metal: 10_000, minerals: 500, gas: 400, debris: 0 },
  );
});

test('credits capped resources once and returns debris without a capacity cap', () => {
  const result = creditTransportCargo(
    { metal: 90, minerals: 1, gas: 100 },
    { metal: 100, minerals: 100, gas: 100 },
    7,
    { metal: 25, minerals: 2, gas: 4, debris: 500 },
  );
  assert.deepEqual(result.resources, { metal: 100, minerals: 3, gas: 100 });
  assert.deepEqual(result.accepted, { metal: 10, minerals: 2, gas: 0 });
  assert.deepEqual(result.burned, { metal: 15, minerals: 0, gas: 4 });
  assert.equal(result.debris, 507);
  assert.equal(result.burnedDebris, 0);
  assert.equal(getOverflowWarning({ metal: 11 }, { metal: 90 }, 0, { metal: 100 }), true);
  assert.equal(getOverflowWarning({ debris: 1_000 }, {}, 0, {}), false);
  assert.equal(addDebris(Number.MAX_SAFE_INTEGER, 1), Number.MAX_SAFE_INTEGER);
});
