import type {
  UniverseAsteroidRuntimeState,
  UniverseAsteroidSimulationState,
  UniverseCoordinate,
} from './types.ts';
import {
  ASTEROID_SCHEDULE_EPOCH_MS,
  ASTEROID_SPAWN_INTERVAL_MS,
  ASTEROID_MAX_DWELL_MS,
  POSITION_COUNT,
  SYSTEM_COUNT,
  advanceUniverseAsteroidCoordinate,
  getUniverseAsteroidDwellMs,
  getUniverseAsteroidState,
  resolveUniverseAsteroidCollisions,
  universeCoordinateKey,
} from './runtime.ts';

export type UniverseAsteroidTransition = {
  spawnIndex: number;
  atMs: number;
  fromCoordinate: UniverseCoordinate;
};

function safeNow(nowMs: number) {
  return Number.isFinite(nowMs) ? Math.trunc(nowMs) : Date.now();
}

function asteroidSpawnAt(spawnIndex: number) {
  return ASTEROID_SCHEDULE_EPOCH_MS + spawnIndex * ASTEROID_SPAWN_INTERVAL_MS;
}

function createSpawnState(spawnIndex: number, atMs: number, galaxyCount: number): UniverseAsteroidRuntimeState | null {
  const state = getUniverseAsteroidState(spawnIndex, atMs, galaxyCount);
  return state?.previousMoveAt === atMs ? state : null;
}

/**
 * Capture the currently rendered deterministic asteroid projection as the
 * starting point for persisted, chronological simulation.
 */
export function createUniverseAsteroidSimulationState(
  nowMs: number,
  galaxyCount = 1,
): UniverseAsteroidSimulationState {
  const cursor = safeNow(nowMs);
  const safeGalaxyCount = Math.max(1, Math.floor(galaxyCount));
  const currentSpawnIndex = Math.floor((cursor - ASTEROID_SCHEDULE_EPOCH_MS) / ASTEROID_SPAWN_INTERVAL_MS);
  const nextSpawnIndex = Math.max(0, currentSpawnIndex + 1);

  if (currentSpawnIndex < 0) {
    return { version: 1, processedThroughAt: cursor, nextSpawnIndex: 0, asteroids: [] };
  }

  // Match the renderer's route-based lower bound so a save initialized long
  // after the schedule epoch does not replay asteroids that must have exited.
  const routeLength = safeGalaxyCount * SYSTEM_COUNT * POSITION_COUNT;
  const maxRouteMs = routeLength * ASTEROID_MAX_DWELL_MS;
  const firstSpawnIndex = Math.max(0, currentSpawnIndex - Math.ceil(maxRouteMs / ASTEROID_SPAWN_INTERVAL_MS) - 1);
  const projected: UniverseAsteroidRuntimeState[] = [];
  for (let spawnIndex = firstSpawnIndex; spawnIndex <= currentSpawnIndex; spawnIndex += 1) {
    const asteroid = getUniverseAsteroidState(spawnIndex, cursor, safeGalaxyCount);
    if (asteroid) projected.push(asteroid);
  }

  const asteroids = resolveUniverseAsteroidCollisions(projected, cursor, safeGalaxyCount)
    .sort((left, right) => left.spawnIndex - right.spawnIndex);
  return { version: 1, processedThroughAt: cursor, nextSpawnIndex, asteroids };
}

/** Return the first unprocessed asteroid spawn or movement checkpoint. */
export function getNextUniverseAsteroidTransitionAt(
  state: UniverseAsteroidSimulationState,
  throughMs: number,
): number | null {
  const through = safeNow(throughMs);
  const cursor = safeNow(state.processedThroughAt);
  let nextAt: number | null = null;
  const spawnAt = asteroidSpawnAt(Math.max(0, Math.floor(state.nextSpawnIndex)));
  if (spawnAt > cursor && spawnAt <= through) nextAt = spawnAt;

  for (const asteroid of state.asteroids) {
    const moveAt = asteroid.nextMoveAt;
    if (Number.isFinite(moveAt) && moveAt > cursor && moveAt <= through && (nextAt === null || moveAt < nextAt)) {
      nextAt = moveAt;
    }
  }
  return nextAt;
}

function movedStateInGalaxyCount(
  state: UniverseAsteroidRuntimeState,
  atMs: number,
  coordinate: UniverseCoordinate,
  galaxyCount: number,
): UniverseAsteroidRuntimeState {
  const movementIndex = state.movementIndex + 1;
  return {
    ...state,
    coordinate,
    movementIndex,
    previousMoveAt: atMs,
    nextMoveAt: atMs + getUniverseAsteroidDwellMs(state.spawnIndex, movementIndex),
    nextCoordinate: advanceUniverseAsteroidCoordinate(coordinate, 1, galaxyCount) ?? undefined,
  };
}

function processTimestamp(
  state: UniverseAsteroidSimulationState,
  atMs: number,
  galaxyCount: number,
  transitions: UniverseAsteroidTransition[],
): UniverseAsteroidSimulationState {
  const asteroids = new Map(state.asteroids.map((asteroid) => [asteroid.spawnIndex, { ...asteroid }]));
  const spawnedIndices = new Set<number>();

  while (asteroidSpawnAt(state.nextSpawnIndex) === atMs) {
    const spawned = createSpawnState(state.nextSpawnIndex, atMs, galaxyCount);
    if (spawned) {
      asteroids.set(spawned.spawnIndex, spawned);
      spawnedIndices.add(spawned.spawnIndex);
    }
    state = { ...state, nextSpawnIndex: state.nextSpawnIndex + 1 };
  }

  const dueMoves = [...asteroids.values()]
    .filter((asteroid) => asteroid.nextMoveAt === atMs)
    .sort((left, right) => left.spawnIndex - right.spawnIndex);
  const movingIndices = new Set(dueMoves.map((asteroid) => asteroid.spawnIndex));
  const occupied = new Map<string, number>();
  for (const asteroid of asteroids.values()) {
    // Same-time spawns and movement origins are incoming/vacating, so only
    // stationary asteroids occupy coordinates during arrival resolution.
    if (movingIndices.has(asteroid.spawnIndex) || spawnedIndices.has(asteroid.spawnIndex)) continue;
    occupied.set(universeCoordinateKey(asteroid.coordinate), asteroid.spawnIndex);
  }
  const arrivals = new Map<number, UniverseAsteroidRuntimeState>();

  // Treat every due movement as simultaneous: first vacate all origins, then
  // place arrivals in stable spawn order. This prevents a lower-index arrival
  // from rescheduling a higher-index asteroid before its same-time move runs.
  for (const asteroid of dueMoves) {
    const current = asteroids.get(asteroid.spawnIndex);
    if (!current || current.nextMoveAt !== atMs) continue;
    transitions.push({ spawnIndex: current.spawnIndex, atMs, fromCoordinate: { ...current.coordinate } });
    const destination = current.nextCoordinate
      ?? advanceUniverseAsteroidCoordinate(current.coordinate, 1, galaxyCount);
    if (!destination) {
      asteroids.delete(current.spawnIndex);
      continue;
    }
    const moved = movedStateInGalaxyCount(current, atMs, destination, galaxyCount);
    asteroids.set(current.spawnIndex, moved);
    arrivals.set(current.spawnIndex, moved);
  }

  const vacateAndAdvance = (spawnIndex: number, fromCoordinate: UniverseCoordinate): UniverseAsteroidRuntimeState | null => {
    const asteroid = asteroids.get(spawnIndex);
    if (!asteroid) return null;
    const oldKey = universeCoordinateKey(fromCoordinate);
    if (occupied.get(oldKey) === spawnIndex) occupied.delete(oldKey);
    transitions.push({ spawnIndex, atMs, fromCoordinate: { ...fromCoordinate } });
    const coordinate = advanceUniverseAsteroidCoordinate(asteroid.coordinate, 1, galaxyCount);
    if (!coordinate) {
      asteroids.delete(spawnIndex);
      return null;
    }
    return movedStateInGalaxyCount(asteroid, atMs, coordinate, galaxyCount);
  };

  const place = (incoming: UniverseAsteroidRuntimeState): void => {
    const key = universeCoordinateKey(incoming.coordinate);
    const occupantIndex = occupied.get(key);
    if (occupantIndex !== undefined && occupantIndex !== incoming.spawnIndex) {
      const occupant = asteroids.get(occupantIndex);
      if (occupant) {
        // The arriving asteroid keeps the destination. The occupant advances
        // from the collision timestamp and may displace a further occupant.
        const displaced = vacateAndAdvance(occupantIndex, occupant.coordinate);
        if (displaced) {
          asteroids.set(occupantIndex, displaced);
          place(displaced);
        }
      }
    }
    asteroids.set(incoming.spawnIndex, incoming);
    occupied.set(key, incoming.spawnIndex);
  };

  for (const spawnIndex of spawnedIndices) {
    const spawned = asteroids.get(spawnIndex);
    if (spawned) arrivals.set(spawnIndex, spawned);
  }

  for (const spawnIndex of [...arrivals.keys()].sort((left, right) => left - right)) {
    const incoming = arrivals.get(spawnIndex);
    // A collision may replace an arrival with a rescheduled state. Never put
    // the stale destination back after that displacement.
    if (incoming && asteroids.get(spawnIndex) === incoming) place(incoming);
  }

  return {
    ...state,
    processedThroughAt: atMs,
    asteroids: [...asteroids.values()].sort((left, right) => left.spawnIndex - right.spawnIndex),
  };
}

/**
 * Advance chronologically through every spawn/move event up to `atMs`.
 * Same-millisecond arrivals are processed in ascending spawn index, so the
 * later arrival wins a shared coordinate and pushes the earlier occupant.
 */
export function advanceUniverseAsteroidSimulationAt(
  initialState: UniverseAsteroidSimulationState,
  atMs: number,
  galaxyCount = 1,
): { state: UniverseAsteroidSimulationState; transitions: UniverseAsteroidTransition[] } {
  const through = safeNow(atMs);
  const safeGalaxyCount = Math.max(1, Math.floor(galaxyCount));
  if (through <= initialState.processedThroughAt) return { state: initialState, transitions: [] };

  let state = initialState;
  const transitions: UniverseAsteroidTransition[] = [];
  while (true) {
    const nextAt = getNextUniverseAsteroidTransitionAt(state, through);
    if (nextAt === null) break;
    state = processTimestamp(state, nextAt, safeGalaxyCount, transitions);
  }
  return {
    state: { ...state, processedThroughAt: through },
    transitions,
  };
}
