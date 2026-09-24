import assert from 'node:assert/strict';
import test from 'node:test';
import { getUniverseAsteroidState, ASTEROID_GAS_MIN, ASTEROID_GAS_MAX, ASTEROID_SCHEDULE_EPOCH_MS } from './runtime.ts';
import {
  ASTEROID_GAS_CAP,
  ASTEROID_GAS_HOUR_MS,
  ASTEROID_GAS_RATES_PER_HOUR,
  advanceAsteroidGasAt,
  getAsteroidGasRatePerHour,
  initializeAsteroidGasState,
} from './asteroid-gas.ts';
import type { UniverseAsteroidRuntimeState } from './types.ts';

function legacyAsteroid(spawnIndex: number, gasYield = 1_000): UniverseAsteroidRuntimeState {
  return {
    spawnIndex,
    spawnedAt: 0,
    movementIndex: 0,
    previousMoveAt: 0,
    nextMoveAt: 60_000,
    gasYield,
    coordinate: { galaxy: 1, system: 1, position: 1 },
  };
}

test('gas rate is deterministic by spawn index and approximately one third per rate', () => {
  const counts = new Map(ASTEROID_GAS_RATES_PER_HOUR.map((rate) => [rate, 0]));
  const sampleSize = 12_000;
  for (let spawnIndex = 0; spawnIndex < sampleSize; spawnIndex += 1) {
    const rate = getAsteroidGasRatePerHour(spawnIndex);
    counts.set(rate, (counts.get(rate) ?? 0) + 1);
    assert.equal(getAsteroidGasRatePerHour(spawnIndex), rate);
  }

  const expected = sampleSize / ASTEROID_GAS_RATES_PER_HOUR.length;
  for (const count of counts.values()) assert.ok(Math.abs(count - expected) < expected * 0.05);
});

test('new deterministic asteroid projections initialize reserve, rate, and gas clock', () => {
  const atMs = ASTEROID_SCHEDULE_EPOCH_MS + 1_000 * 60 * 60 * 1_000 + 12_345;
  let activeCount = 0;
  for (let spawnIndex = 520; spawnIndex <= 1_000; spawnIndex += 1) {
    const asteroid = getUniverseAsteroidState(spawnIndex, atMs);
    if (!asteroid) continue;
    activeCount += 1;
    assert.ok(asteroid.gasYield >= ASTEROID_GAS_MIN && asteroid.gasYield <= ASTEROID_GAS_MAX);
    assert.ok(ASTEROID_GAS_RATES_PER_HOUR.some((rate) => rate === asteroid.gasRatePerHour));
    assert.equal(asteroid.gasUpdatedAt, atMs);
    assert.equal(asteroid.gasRemainder, 0);
  }
  assert.ok(activeCount > 0);
});

test('one long gas interval matches many short intervals exactly', () => {
  const start = initializeAsteroidGasState({
    ...legacyAsteroid(91, 10_000),
    gasRatePerHour: 10_000,
    gasUpdatedAt: 100_000,
    gasRemainder: 0,
  }, 100_000);
  const long = advanceAsteroidGasAt(start, 100_000 + ASTEROID_GAS_HOUR_MS);
  let short = start;
  for (let step = 1; step <= 3_600; step += 1) {
    short = advanceAsteroidGasAt(short, 100_000 + step * 1_000);
  }
  assert.deepEqual(short, long);
  assert.equal(long.gasYield, 20_000);
  assert.equal(long.gasRemainder, 0);
});

test('fractional gas is carried between updates and legacy state starts at migration time', () => {
  const migrated = initializeAsteroidGasState(legacyAsteroid(5, 9_000), 2_000_000);
  assert.equal(migrated.gasUpdatedAt, 2_000_000);
  assert.equal(migrated.gasRemainder, 0);
  assert.strictEqual(initializeAsteroidGasState(migrated, 9_000_000), migrated);
  assert.strictEqual(advanceAsteroidGasAt(migrated, migrated.gasUpdatedAt), migrated);
  assert.strictEqual(advanceAsteroidGasAt(migrated, migrated.gasUpdatedAt - 1), migrated);

  const fractional = initializeAsteroidGasState({
    ...legacyAsteroid(5, 9_000),
    gasRatePerHour: 2_500,
    gasUpdatedAt: 2_000_000,
    gasRemainder: 0,
  }, 2_000_000);
  const oneSecond = advanceAsteroidGasAt(fractional, 2_001_000);
  assert.equal(oneSecond.gasYield, 9_000);
  assert.equal(oneSecond.gasRemainder, 2_500_000);
  const fullHour = advanceAsteroidGasAt(oneSecond, 2_000_000 + ASTEROID_GAS_HOUR_MS);
  assert.equal(fullHour.gasYield, 11_500);
  assert.equal(fullHour.gasRemainder, 0);

  const afterLoad = advanceAsteroidGasAt(migrated, 2_000_000 + ASTEROID_GAS_HOUR_MS);
  assert.equal(afterLoad.gasYield, 9_000 + migrated.gasRatePerHour);
});

test('gas cap is enforced and replayed earlier timestamps cannot move the clock backward', () => {
  const nearCap = initializeAsteroidGasState({
    ...legacyAsteroid(8, ASTEROID_GAS_CAP - 1),
    gasRatePerHour: 25_000,
    gasUpdatedAt: 10_000,
    gasRemainder: 0,
  }, 10_000);
  const capped = advanceAsteroidGasAt(nearCap, 10_000 + ASTEROID_GAS_HOUR_MS);
  assert.equal(capped.gasYield, ASTEROID_GAS_CAP);
  assert.equal(capped.gasRemainder, 0);

  const replay = advanceAsteroidGasAt(capped, 20_000);
  assert.equal(replay.gasYield, ASTEROID_GAS_CAP);
  assert.equal(replay.gasUpdatedAt, capped.gasUpdatedAt);
  const later = advanceAsteroidGasAt(capped, capped.gasUpdatedAt + 1_000);
  assert.equal(later.gasYield, ASTEROID_GAS_CAP);
  assert.equal(later.gasUpdatedAt, capped.gasUpdatedAt + 1_000);
});
