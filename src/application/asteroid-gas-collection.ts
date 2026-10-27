import { advanceAsteroidGasAt } from '../domain/universe/asteroid-gas.ts';
import { advanceUniverseAsteroidSimulationAt, findUniverseAsteroidAtCoordinate } from '../domain/universe/asteroid-simulation.ts';
import type { UniverseAsteroidSimulationState, UniverseCoordinate } from '../domain/universe/types.ts';
import type { SaveState } from './contracts.ts';

/**
 * «Добыча газа» at arrival, shared by the player's and NPC flights: recyclers
 * that find an asteroid at their coordinate take half of its gas (up to their
 * holds) and the scrap it carries with the room left; an asteroid left with
 * less than 1 000 gas is spent and leaves the map.
 */
export function collectAsteroidGas(state: SaveState, coordinate: UniverseCoordinate, arrivalAt: number, capacity: number): {
  state: SaveState; found: boolean; gasCollected: number; scrapCollected: number;
} {
  const simulation = state.asteroidSimulation;
  const asteroidAtCoordinate = simulation ? findUniverseAsteroidAtCoordinate(simulation.asteroids, coordinate) : undefined;
  const asteroidIndex = simulation && asteroidAtCoordinate ? simulation.asteroids.indexOf(asteroidAtCoordinate) : -1;
  if (asteroidIndex < 0 || !simulation) return { state, found: false, gasCollected: 0, scrapCollected: 0 };
  let next = state;
  const asteroid = advanceAsteroidGasAt(simulation.asteroids[asteroidIndex]!, arrivalAt);
  const holds = Number.isSafeInteger(capacity) && capacity > 0 ? capacity : 0;
  const availableGas = Math.max(0, Math.floor(asteroid.gasYield));
  const gasCollected = Math.min(Math.floor(availableGas / 2), holds);
  const spawnKey = String(asteroid.spawnIndex);
  const storedScrap = next.asteroidDebrisBySpawnIndex?.[spawnKey] ?? 0;
  const carriedScrap = Number.isFinite(storedScrap) && storedScrap > 0 ? Math.floor(storedScrap) : 0;
  const scrapCollected = Math.min(carriedScrap, Math.max(0, holds - gasCollected));
  const remainingGas = availableGas - gasCollected;
  const remainingScrap = carriedScrap - scrapCollected;
  const depleted = remainingGas < 1_000;
  const asteroids = depleted
    ? simulation.asteroids.filter((_, index) => index !== asteroidIndex)
    : simulation.asteroids.map((item, index) => index === asteroidIndex ? { ...asteroid, gasYield: remainingGas } : item);
  next = { ...next, asteroidSimulation: { ...simulation, asteroids } };
  const asteroidDebrisBySpawnIndex = { ...(next.asteroidDebrisBySpawnIndex ?? {}) };
  if (depleted || remainingScrap <= 0) delete asteroidDebrisBySpawnIndex[spawnKey];
  else asteroidDebrisBySpawnIndex[spawnKey] = remainingScrap;
  return { state: { ...next, asteroidDebrisBySpawnIndex }, found: true, gasCollected, scrapCollected };
}

/**
 * Where an asteroid will be at `arrivalAt`, by the same chronological model
 * the game advances (and the player's flight form previews): the asteroid at
 * `coordinate` at that moment and the gas it will hold, or null when the
 * coordinate will be empty. Asteroids live in galaxy 1 of the simulation.
 */
export function forecastAsteroidAt(simulation: UniverseAsteroidSimulationState | undefined, coordinate: UniverseCoordinate,
  arrivalAt: number): { spawnIndex: number; gasYield: number } | null {
  if (!simulation) return null;
  const advanced = advanceUniverseAsteroidSimulationAt(simulation, arrivalAt, 1).state;
  const asteroid = findUniverseAsteroidAtCoordinate(advanced.asteroids, coordinate);
  if (!asteroid) return null;
  return { spawnIndex: asteroid.spawnIndex, gasYield: Math.max(0, Math.floor(advanceAsteroidGasAt(asteroid, arrivalAt).gasYield)) };
}
