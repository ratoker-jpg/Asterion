import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getUniverseAsteroidState,
  ASTEROID_GAS_MIN,
  ASTEROID_GAS_MAX,
  ASTEROID_SCHEDULE_EPOCH_MS,
  ASTEROID_SPAWN_INTERVAL_MS,
} from './runtime.ts';
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
  assert.deepEqual(ASTEROID_GAS_RATES_PER_HOUR, [25_000, 100_000, 250_000]);
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

test('seeded asteroid reserve generation includes both configured endpoints', () => {
  // These spawn indices exercise the inclusive lower and upper buckets of the
  // stable reserve RNG stream without scanning a large range during tests.
  const minimumSpawnIndex = 1_085_731;
  const maximumSpawnIndex = 1_380_291;
  const minimumSpawnAt = ASTEROID_SCHEDULE_EPOCH_MS + minimumSpawnIndex * ASTEROID_SPAWN_INTERVAL_MS;
  const maximumSpawnAt = ASTEROID_SCHEDULE_EPOCH_MS + maximumSpawnIndex * ASTEROID_SPAWN_INTERVAL_MS;

  assert.equal(getUniverseAsteroidState(minimumSpawnIndex, minimumSpawnAt)?.gasYield, ASTEROID_GAS_MIN);
  assert.equal(getUniverseAsteroidState(maximumSpawnIndex, maximumSpawnAt)?.gasYield, ASTEROID_GAS_MAX);
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
    gasRatePerHour: 100_000,
    gasUpdatedAt: 100_000,
    gasRemainder: 0,
  }, 100_000);
  const long = advanceAsteroidGasAt(start, 100_000 + ASTEROID_GAS_HOUR_MS);
  let short = start;
  for (let step = 1; step <= 3_600; step += 1) {
    short = advanceAsteroidGasAt(short, 100_000 + step * 1_000);
  }
  assert.deepEqual(short, long);
  assert.equal(long.gasYield, 110_000);
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
    gasRatePerHour: 25_000,
    gasUpdatedAt: 2_000_000,
    gasRemainder: 0,
  }, 2_000_000);
  const oneSecond = advanceAsteroidGasAt(fractional, 2_001_000);
  assert.equal(oneSecond.gasYield, 9_006);
  assert.equal(oneSecond.gasRemainder, 3_400_000);
  const fullHour = advanceAsteroidGasAt(oneSecond, 2_000_000 + ASTEROID_GAS_HOUR_MS);
  assert.equal(fullHour.gasYield, 34_000);
  assert.equal(fullHour.gasRemainder, 0);

  const afterLoad = advanceAsteroidGasAt(migrated, 2_000_000 + ASTEROID_GAS_HOUR_MS);
  assert.equal(afterLoad.gasYield, 9_000 + migrated.gasRatePerHour);
});

test('gas cap is enforced and replayed earlier timestamps cannot move the clock backward', () => {
  const nearCap = initializeAsteroidGasState({
    ...legacyAsteroid(8, ASTEROID_GAS_CAP - 1),
    gasRatePerHour: 250_000,
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

test('long and repeated intervals stay exact before the cap', () => {
  const startAt = 100_000;
  const start = initializeAsteroidGasState({
    ...legacyAsteroid(91, 10_000),
    gasRatePerHour: 25_000,
    gasUpdatedAt: startAt,
    gasRemainder: 0,
  }, startAt);
  const long = advanceAsteroidGasAt(start, startAt + 48 * ASTEROID_GAS_HOUR_MS);
  let repeated = start;
  for (const elapsedHours of [13, 31, 48]) {
    repeated = advanceAsteroidGasAt(repeated, startAt + elapsedHours * ASTEROID_GAS_HOUR_MS);
  }

  assert.deepEqual(repeated, long);
  assert.equal(long.gasYield, 1_210_000);
  assert.equal(advanceAsteroidGasAt(long, long.gasUpdatedAt), long);
});

test('cap crossing discards the remainder and remains enforced across long intervals', () => {
  const startAt = 5_000;
  const start = initializeAsteroidGasState({
    ...legacyAsteroid(92, ASTEROID_GAS_CAP - 10_000),
    gasRatePerHour: 100_000,
    gasUpdatedAt: startAt,
    gasRemainder: 0,
  }, startAt);
  const justBeforeCap = advanceAsteroidGasAt(start, startAt + 360_000 - 1);
  const crossedByOneMillisecond = advanceAsteroidGasAt(justBeforeCap, startAt + 360_000);
  const crossedDirectly = advanceAsteroidGasAt(start, startAt + 360_000);

  assert.equal(justBeforeCap.gasYield, ASTEROID_GAS_CAP - 1);
  assert.equal(justBeforeCap.gasRemainder, ASTEROID_GAS_HOUR_MS - 100_000);
  assert.equal(crossedByOneMillisecond.gasYield, ASTEROID_GAS_CAP);
  assert.equal(crossedByOneMillisecond.gasRemainder, 0);
  assert.deepEqual(crossedByOneMillisecond, crossedDirectly);

  const oneYearLater = advanceAsteroidGasAt(start, startAt + 365 * 24 * ASTEROID_GAS_HOUR_MS);
  let repeated = start;
  for (const elapsedHours of [24, 24 * 30, 24 * 180, 24 * 365]) {
    repeated = advanceAsteroidGasAt(repeated, startAt + elapsedHours * ASTEROID_GAS_HOUR_MS);
  }
  assert.deepEqual(repeated, oneYearLater);
  assert.equal(oneYearLater.gasYield, ASTEROID_GAS_CAP);
  assert.equal(oneYearLater.gasRemainder, 0);
});
