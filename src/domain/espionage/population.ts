import type { CombatFactionId } from '../combat/factions.ts';
import { calculateDefensePopulation } from '../fleet/production.ts';
import { calculateFleetPopulation, type OwnedFleetState } from '../fleet/runtime.ts';
import type { FlightRecord } from '../flights/types.ts';
import type { SpyReportPopulation } from './types.ts';

/**
 * Ships still belonging to a planet while away: every flight launched from it
 * that will come back, «Космический рейс» included. Deployment and colonization
 * on their way out leave the planet for good and do not count.
 */
export function awayFleetPopulation(flights: readonly FlightRecord[], planetId: string, factionId: CombatFactionId): number {
  let total = 0;
  for (const flight of flights) {
    if (flight.originPlanetId !== planetId) continue;
    if (flight.phase !== 'outbound' && flight.phase !== 'arrived' && flight.phase !== 'returning') continue;
    if (flight.phase === 'outbound' && (flight.missionId === 'deployment' || flight.missionId === 'colonize')) continue;
    total += calculateFleetPopulation({
      ships: { ...flight.selectedShips },
      commanders: { ...(flight.selectedCommanders ?? {}) },
    } as OwnedFleetState, factionId);
  }
  return total;
}

/**
 * Owner rule (25.10.2026): a full spy report shows the planet's whole
 * population, the fleet away in flight included, while the fleet list shows
 * only ships on orbit. A spy who sees population the fleet does not explain
 * knows the fleet is hidden in flight.
 */
export function spyReportPopulation(
  target: { id: string; raceId: string; fleet: OwnedFleetState; defense: Parameters<typeof calculateDefensePopulation>[0] },
  flights: readonly FlightRecord[],
): SpyReportPopulation {
  const race = target.raceId as CombatFactionId;
  const fleet = calculateFleetPopulation(target.fleet, race) + awayFleetPopulation(flights, target.id, race);
  const defense = calculateDefensePopulation(target.defense, race);
  return { total: fleet + defense, fleet, defense };
}
