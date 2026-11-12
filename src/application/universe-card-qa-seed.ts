import type { UniverseAsteroidState, UniverseCoordinate } from '../domain/universe/types.ts';

/**
 * Test Mode seed of a moving asteroid for the Universe card screenshots
 * (`#universe-card-<scenario>`). It lives outside `src/ui` because a full
 * asteroid state carries the gas reserve, a quiet field no screen reads.
 */
export function seedQaAsteroidState(nowMs: number, nextCoordinate: UniverseCoordinate): UniverseAsteroidState {
  const minute = 60_000;
  return {
    spawnIndex: 7,
    spawnedAt: nowMs - 90 * minute,
    movementIndex: 4,
    previousMoveAt: nowMs - 6 * minute,
    nextMoveAt: nowMs + 13 * minute + 25_000,
    nextCoordinate,
    gasYield: 0,
  };
}
