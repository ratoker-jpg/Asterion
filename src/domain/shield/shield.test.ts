import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createShieldRecord, formatShieldRemaining, lootableAbove, migrateShieldRecord, protectedStoreAmount, shieldStatus, SHIELD_TIMING,
} from './shield.ts';

const HOUR = 3_600_000;

test('protected share: 10 % of the first 1M, 5 % of the next 9M, 1 % of the next 90M, 0.2 % above 100M', () => {
  assert.equal(protectedStoreAmount(0), 0);
  assert.equal(protectedStoreAmount(50_000), 5_000);
  assert.equal(protectedStoreAmount(1_000_000), 100_000);
  assert.equal(protectedStoreAmount(10_000_000), 100_000 + 450_000);
  assert.equal(protectedStoreAmount(100_000_000), 100_000 + 450_000 + 900_000);
  assert.equal(protectedStoreAmount(450_000_000), 2_150_000);
  assert.equal(protectedStoreAmount(Number.NaN), 0);
  assert.equal(protectedStoreAmount(-5), 0);
});

test('a raid takes only what lies above min(stock, protected)', () => {
  assert.equal(lootableAbove(0, 1_000_000), 0);
  assert.equal(lootableAbove(50_000, 1_000_000), 0, 'a stock below the protected share is untouchable');
  assert.equal(lootableAbove(100_000, 1_000_000), 0);
  assert.equal(lootableAbove(400_000, 1_000_000), 300_000);
  assert.equal(lootableAbove(450_000_000, 450_000_000), 450_000_000 - 2_150_000);
});

test('durations and cooldowns follow the world speed', () => {
  assert.deepEqual(SHIELD_TIMING.standard, { durationMs: 3 * HOUR, cooldownMs: 12 * HOUR });
  assert.deepEqual(SHIELD_TIMING.fast, { durationMs: 1.5 * HOUR, cooldownMs: 6 * HOUR });
  assert.deepEqual(SHIELD_TIMING.superfast, { durationMs: 0.5 * HOUR, cooldownMs: 3 * HOUR });
  for (const speed of ['slow', 'standard', 'fast', 'superfast'] as const) {
    assert.ok(SHIELD_TIMING[speed].cooldownMs > SHIELD_TIMING[speed].durationMs);
  }
});

test('status: ready, active, cooldown counted from the end of the activation, ready again', () => {
  assert.deepEqual(shieldStatus(undefined, 5), { phase: 'ready' });
  const record = createShieldRecord('standard', 1_000);
  assert.equal(record.activeUntil, 1_000 + 3 * HOUR);
  assert.equal(record.readyAt, 1_000 + 15 * HOUR);
  assert.equal(shieldStatus(record, 1_000).phase, 'active');
  assert.notEqual(shieldStatus(record, 999).phase, 'active', 'before the activation the shield did not protect');
  const mid = shieldStatus(record, 1_000 + HOUR);
  assert.equal(mid.phase === 'active' ? mid.remainingMs : -1, 2 * HOUR);
  assert.equal(shieldStatus(record, record.activeUntil).phase, 'cooldown');
  assert.equal(shieldStatus(record, record.readyAt - 1).phase, 'cooldown');
  assert.equal(shieldStatus(record, record.readyAt).phase, 'ready');
});

test('saved records are validated; garbage becomes no shield', () => {
  assert.equal(migrateShieldRecord(null), undefined);
  assert.equal(migrateShieldRecord({ activatedAt: 5, activeUntil: 1, readyAt: 9 }), undefined);
  assert.deepEqual(migrateShieldRecord({ activatedAt: 1, activeUntil: 2, readyAt: 3 }), { activatedAt: 1, activeUntil: 2, readyAt: 3 });
});

test('remaining time reads as mm:ss or h:mm:ss', () => {
  assert.equal(formatShieldRemaining(42_000), '00:42');
  assert.equal(formatShieldRemaining(2 * HOUR + 5 * 60_000 + 9_000), '2:05:09');
});
