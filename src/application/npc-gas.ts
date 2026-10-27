import { getUniverseAsteroidDwellMs } from '../domain/universe/runtime.ts';
import type { UniverseCoordinate } from '../domain/universe/types.ts';
import type { ShipId } from '../domain/combat/ids.ts';
import type { SaveState } from './contracts.ts';
import { forecastAsteroidAt } from './asteroid-gas-collection.ts';
import { dispatchNpcGas, getNpcMissionAvailableFleet, isNpcRecyclerShip } from './npc-missions.ts';
import { describeNpcPlanet, strategyOf, type NpcUtilityContext } from './npc-utility.ts';

/**
 * «Добыча газа» for NPCs (owner request 27.10.2026). Asteroids move, so the
 * owner aims where an asteroid will be when its recyclers arrive: the
 * asteroid's own schedule picks the coordinate (it stays put for a seeded
 * dwell, then steps on), and the same chronological model the game and the
 * player's flight form use confirms the hit before launch. The owner flies
 * only when its gas runs low and the haul is worth the trip.
 *
 * Balance parameters (the owner may change these):
 */
export const NPC_GAS_BALANCE = {
  /** Gas store fill under which a planet looks for an asteroid. */
  needBelowFill: 0.45,
  /** Asteroids within this many systems of the planet are considered. */
  systemReach: 3,
  /** At most this many nearest asteroids are aimed at in one look. */
  asteroidsPerLook: 2,
  /** The haul must pay at least this multiple of the flight's gas. */
  minHaulOverFuel: 2,
  /** ...and at least this share of the owner's daily income. */
  minHaulDayShare: 0.02,
  /** Arrival must fall this far inside the asteroid's stay. */
  dwellMarginMs: 30_000,
} as const;

export type NpcGasPlan = Readonly<{
  originPlanetId: string;
  coordinate: UniverseCoordinate;
  ships: Partial<Record<ShipId, number>>;
  arrivalAt: number;
  haul: number;
  estimate: number;
}>;

function systemsApart(left: UniverseCoordinate, right: UniverseCoordinate): number {
  return left.galaxy === right.galaxy ? Math.abs(left.system - right.system) : Number.POSITIVE_INFINITY;
}

/** The best gas trip this owner can plan now, or null. One forecast per look at most. */
export function planNpcGasMission(state: SaveState, context: NpcUtilityContext, timeScale: number): NpcGasPlan | null {
  const simulation = state.asteroidSimulation;
  // Positions computed past the decision moment would be knowledge of the future.
  if (!simulation?.asteroids.length || simulation.processedThroughAt > context.at) return null;
  const b = NPC_GAS_BALANCE;
  const ownerId = context.profile.ownerId;
  const thirsty = context.ownPlanets
    .map((planet) => ({ planet, fill: describeNpcPlanet(planet, 0, 0, false).fill.gas }))
    .filter((item) => item.fill < b.needBelowFill)
    .sort((left, right) => left.fill - right.fill || (left.planet.id < right.planet.id ? -1 : 1));
  for (const { planet, fill } of thirsty) {
    const free = getNpcMissionAvailableFleet(state, ownerId, planet.id);
    const ships = Object.fromEntries(Object.entries(free).filter(([id, count]) => count > 0 && isNpcRecyclerShip(id as ShipId, planet.raceId))) as Partial<Record<ShipId, number>>;
    if (!Object.keys(ships).length) continue;
    const near = simulation.asteroids
      .filter((asteroid) => systemsApart(asteroid.coordinate, planet.coordinate) <= b.systemReach)
      .sort((left, right) => systemsApart(left.coordinate, planet.coordinate) - systemsApart(right.coordinate, planet.coordinate) || left.spawnIndex - right.spawnIndex)
      .slice(0, b.asteroidsPerLook);
    let best: { coordinate: UniverseCoordinate; arrivalAt: number; gasCost: number } | null = null;
    for (const asteroid of near) {
      // Where this asteroid stays while the recyclers could arrive: here until
      // its next move, then on the next coordinate for its next dwell.
      const stays: { coordinate: UniverseCoordinate; from: number; to: number }[] = [
        { coordinate: asteroid.coordinate, from: Number.NEGATIVE_INFINITY, to: asteroid.nextMoveAt },
      ];
      if (asteroid.nextCoordinate && Number.isFinite(asteroid.nextMoveAt)) {
        stays.push({ coordinate: asteroid.nextCoordinate, from: asteroid.nextMoveAt,
          to: asteroid.nextMoveAt + getUniverseAsteroidDwellMs(asteroid.spawnIndex, asteroid.movementIndex + 1) });
      }
      for (const stay of stays) {
        const trial = dispatchNpcGas(state, { requestId: `npc-gas-trial:${planet.id}`, ownerId, originPlanetId: planet.id,
          coordinate: stay.coordinate, selectedShips: ships }, context.at, timeScale);
        if (!trial.ok || !trial.flight) continue;
        const arrival = trial.flight.arrivalAt;
        if (arrival < stay.from + b.dwellMarginMs || arrival > stay.to - b.dwellMarginMs) continue;
        best = { coordinate: stay.coordinate, arrivalAt: arrival, gasCost: trial.flight.gasCost };
        break;
      }
      if (best) break;
    }
    if (!best) continue;
    // The game's own model confirms the asteroid will be there and how much gas it will hold.
    const forecast = forecastAsteroidAt(simulation, best.coordinate, best.arrivalAt);
    if (!forecast) continue;
    const trialCapacity = dispatchNpcGas(state, { requestId: `npc-gas-trial:${planet.id}`, ownerId, originPlanetId: planet.id,
      coordinate: best.coordinate, selectedShips: ships }, context.at, timeScale).flight?.gasCapacity ?? 0;
    const haul = Math.min(Math.floor(forecast.gasYield / 2), trialCapacity);
    if (haul < b.minHaulOverFuel * best.gasCost || haul < b.minHaulDayShare * context.dayValue) continue;
    const estimate = -0.3 + 1.4 * (b.needBelowFill - fill) + 0.5 * Math.log1p(haul / Math.max(1, 0.05 * context.dayValue))
      + 0.3 * strategyOf(context).economy;
    return { originPlanetId: planet.id, coordinate: best.coordinate, ships, arrivalAt: best.arrivalAt, haul, estimate };
  }
  return null;
}
