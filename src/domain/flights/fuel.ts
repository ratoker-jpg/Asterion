import { getFactionShipCatalog } from '../combat/faction-catalog.ts';
import type { CombatFactionId } from '../combat/factions.ts';
import type { ShipId } from '../combat/ids.ts';
import type { FlightScienceLevels } from './types.ts';

function chemistryLevel(science: FlightScienceLevels): number {
  const value = science[2];
  return Number.isFinite(value) ? Math.min(15, Math.max(0, Math.floor(value ?? 0))) : 0;
}

export function calculateBaseFlightFuel(factionId: CombatFactionId, selectedShips: Partial<Record<ShipId, number>>): number {
  const catalog = new Map(getFactionShipCatalog(factionId).map((ship) => [ship.id, ship]));
  let fuel = 0;
  for (const [id, quantity] of Object.entries(selectedShips) as [ShipId, number][]) {
    if (!Number.isInteger(quantity) || quantity <= 0) continue;
    const ship = catalog.get(id);
    if (!ship?.ship) throw new Error(`Unknown ship: ${id}`);
    fuel += quantity * ship.ship.fuel;
  }
  return fuel;
}

export function calculateFlightFuel(
  factionId: CombatFactionId,
  selectedShips: Partial<Record<ShipId, number>>,
  routeDistance: number,
  science: FlightScienceLevels = {},
): number {
  if (!Number.isFinite(routeDistance) || routeDistance < 0) throw new Error('Route distance must be non-negative.');
  const factor = Math.max(0.25, 1 - 0.05 * chemistryLevel(science));
  return Math.max(1, Math.ceil(calculateBaseFlightFuel(factionId, selectedShips) * routeDistance / 12_000 * factor));
}
