import assert from 'node:assert/strict';
import test from 'node:test';
import type { UniverseAsteroidSimulationState } from '../domain/universe/types.ts';
import { ASTEROID_SCHEDULE_EPOCH_MS, POSITION_COUNT, SYSTEM_COUNT } from '../domain/universe/runtime.ts';
import { forecastAsteroidAt } from './asteroid-gas-collection.ts';

test('gas forecast follows an asteroid into a second campaign galaxy and keeps one-galaxy exit behavior', () => {
  const arrivalAt = ASTEROID_SCHEDULE_EPOCH_MS + 10_000;
  const simulation: UniverseAsteroidSimulationState = {
    version: 1,
    processedThroughAt: arrivalAt - 1,
    nextSpawnIndex: 100,
    asteroids: [{
      spawnIndex: 7,
      spawnedAt: ASTEROID_SCHEDULE_EPOCH_MS,
      movementIndex: 0,
      previousMoveAt: ASTEROID_SCHEDULE_EPOCH_MS,
      nextMoveAt: arrivalAt,
      nextCoordinate: { galaxy: 2, system: 1, position: 1 },
      gasYield: 48_000,
      gasRatePerHour: 25_000,
      gasUpdatedAt: arrivalAt - 5_000,
      gasRemainder: 123,
      coordinate: { galaxy: 1, system: SYSTEM_COUNT, position: POSITION_COUNT },
    }],
  };

  assert.deepEqual(forecastAsteroidAt(simulation, { galaxy: 2, system: 1, position: 1 }, arrivalAt, 2), {
    spawnIndex: 7,
    gasYield: 48_034,
  });
  assert.equal(forecastAsteroidAt(simulation, { galaxy: 2, system: 1, position: 1 }, arrivalAt, 1), null);
  assert.deepEqual(simulation.asteroids[0]?.coordinate, { galaxy: 1, system: SYSTEM_COUNT, position: POSITION_COUNT });
});
