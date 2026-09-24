import assert from 'node:assert/strict';
import test from 'node:test';
import type {
  UniverseAsteroidRuntimeState,
  UniverseAsteroidSimulationState,
  UniverseCoordinate,
} from './types.ts';
import {
  ASTEROID_SCHEDULE_EPOCH_MS,
  ASTEROID_SPAWN_INTERVAL_MS,
  getUniverseAsteroidDwellMs,
  getUniverseAsteroidState,
  resolveUniverseAsteroidCollisions,
} from './runtime.ts';
import {
  advanceUniverseAsteroidSimulationAt,
  createUniverseAsteroidSimulationState,
  getNextUniverseAsteroidTransitionAt,
} from './asteroid-simulation.ts';
import { ASTEROID_GAS_RATES_PER_HOUR } from './asteroid-gas.ts';

const coordinate = (position: number): UniverseCoordinate => ({ galaxy: 1, system: 1, position });

function asteroid(
  spawnIndex: number,
  fromPosition: number,
  toPosition: number,
  nextMoveAt: number,
): UniverseAsteroidRuntimeState {
  return {
    spawnIndex,
    spawnedAt: ASTEROID_SCHEDULE_EPOCH_MS,
    movementIndex: 0,
    previousMoveAt: ASTEROID_SCHEDULE_EPOCH_MS,
    nextMoveAt,
    nextCoordinate: coordinate(toPosition),
    gasYield: 1_000 + spawnIndex,
    coordinate: coordinate(fromPosition),
  };
}

function customState(atMs: number, asteroids: UniverseAsteroidRuntimeState[]): UniverseAsteroidSimulationState {
  return {
    version: 1,
    processedThroughAt: atMs - 1,
    nextSpawnIndex: 100,
    asteroids,
  };
}

test('baseline snapshots the deterministic projection and advances the spawn cursor', () => {
  const nowMs = ASTEROID_SCHEDULE_EPOCH_MS + 2 * ASTEROID_SPAWN_INTERVAL_MS;
  const baseline = createUniverseAsteroidSimulationState(nowMs, 1);
  const projected = [0, 1, 2]
    .map((spawnIndex) => getUniverseAsteroidState(spawnIndex, nowMs, 1))
    .filter((state): state is NonNullable<typeof state> => Boolean(state));

  assert.equal(baseline.processedThroughAt, nowMs);
  assert.equal(baseline.nextSpawnIndex, 3);
  assert.deepEqual(baseline.asteroids, resolveUniverseAsteroidCollisions(projected, nowMs, 1));
  assert.equal(getNextUniverseAsteroidTransitionAt(baseline, nowMs), null);
});

test('a chronological asteroid spawn initializes its gas clock at the spawn timestamp', () => {
  const startAt = ASTEROID_SCHEDULE_EPOCH_MS - 1;
  const start = createUniverseAsteroidSimulationState(startAt, 1);
  const spawned = advanceUniverseAsteroidSimulationAt(start, ASTEROID_SCHEDULE_EPOCH_MS, 1).state;
  const asteroid = spawned.asteroids.find((item) => item.spawnIndex === 0);

  assert.ok(asteroid);
  assert.ok(ASTEROID_GAS_RATES_PER_HOUR.some((rate) => rate === asteroid.gasRatePerHour));
  assert.equal(asteroid.gasUpdatedAt, ASTEROID_SCHEDULE_EPOCH_MS);
  assert.equal(asteroid.gasRemainder, 0);
});

test('a multi-event advance matches chronological single-event advances', () => {
  const start = createUniverseAsteroidSimulationState(ASTEROID_SCHEDULE_EPOCH_MS, 1);
  const throughMs = ASTEROID_SCHEDULE_EPOCH_MS + 2 * ASTEROID_SPAWN_INTERVAL_MS + 5 * 60_000;
  const caughtUp = advanceUniverseAsteroidSimulationAt(start, throughMs, 1);

  let steppedState = start;
  const steppedTransitions = [] as typeof caughtUp.transitions;
  while (true) {
    const nextAt = getNextUniverseAsteroidTransitionAt(steppedState, throughMs);
    if (nextAt === null) break;
    const step = advanceUniverseAsteroidSimulationAt(steppedState, nextAt, 1);
    steppedState = step.state;
    steppedTransitions.push(...step.transitions);
  }
  steppedState = advanceUniverseAsteroidSimulationAt(steppedState, throughMs, 1).state;

  assert.ok(caughtUp.transitions.length > 0);
  assert.ok(caughtUp.transitions.every((transition) => transition.atMs <= throughMs));
  assert.deepEqual(caughtUp.transitions, steppedTransitions);
  assert.deepEqual(caughtUp.state, steppedState);
  assert.equal(caughtUp.state.processedThroughAt, throughMs);
  assert.equal(caughtUp.state.nextSpawnIndex, 3);
});

test('two same-millisecond movers leave the lower index displaced after the higher index keeps their shared destination', () => {
  const atMs = ASTEROID_SCHEDULE_EPOCH_MS + 10_000;
  const state = customState(atMs, [
    asteroid(0, 1, 2, atMs),
    asteroid(1, 3, 2, atMs),
  ]);

  const result = advanceUniverseAsteroidSimulationAt(state, atMs, 1);
  const first = result.state.asteroids.find((item) => item.spawnIndex === 0)!;
  const second = result.state.asteroids.find((item) => item.spawnIndex === 1)!;

  assert.deepEqual(second.coordinate, coordinate(2));
  assert.deepEqual(first.coordinate, coordinate(3));
  assert.deepEqual(result.transitions, [
    { spawnIndex: 0, atMs, fromCoordinate: coordinate(1) },
    { spawnIndex: 1, atMs, fromCoordinate: coordinate(3) },
    { spawnIndex: 0, atMs, fromCoordinate: coordinate(2) },
  ]);
  assert.equal(first.movementIndex, 2);
  assert.equal(first.previousMoveAt, atMs);
  assert.equal(first.nextMoveAt, atMs + getUniverseAsteroidDwellMs(0, 2));
});

test('a collision displacement emits the vacated coordinate and restarts dwell from that timestamp', () => {
  const atMs = ASTEROID_SCHEDULE_EPOCH_MS + 20_000;
  const stationary = { ...asteroid(0, 2, 3, atMs + 50_000), nextMoveAt: atMs + 50_000 };
  const incoming = asteroid(1, 1, 2, atMs);
  const state = customState(atMs, [stationary, incoming]);

  const result = advanceUniverseAsteroidSimulationAt(state, atMs, 1);
  const displaced = result.state.asteroids.find((item) => item.spawnIndex === 0)!;

  assert.deepEqual(displaced.coordinate, coordinate(3));
  assert.deepEqual(result.transitions, [
    { spawnIndex: 1, atMs, fromCoordinate: coordinate(1) },
    { spawnIndex: 0, atMs, fromCoordinate: coordinate(2) },
  ]);
  assert.equal(displaced.previousMoveAt, atMs);
  assert.equal(displaced.movementIndex, 1);
  assert.equal(displaced.nextMoveAt, atMs + getUniverseAsteroidDwellMs(0, 1));
});

test('advancing through a processed event does not replay it', () => {
  const initial = createUniverseAsteroidSimulationState(ASTEROID_SCHEDULE_EPOCH_MS, 1);
  const firstAt = getNextUniverseAsteroidTransitionAt(initial, ASTEROID_SCHEDULE_EPOCH_MS + 3 * ASTEROID_SPAWN_INTERVAL_MS);
  assert.ok(firstAt !== null);
  const first = advanceUniverseAsteroidSimulationAt(initial, firstAt!, 1);

  assert.equal(getNextUniverseAsteroidTransitionAt(first.state, firstAt!), null);
  assert.deepEqual(advanceUniverseAsteroidSimulationAt(first.state, firstAt!, 1), {
    state: first.state,
    transitions: [],
  });
});
