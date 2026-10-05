import { getFactionShipCatalog } from '../combat/faction-catalog.ts';
import { COMMANDER_COMBAT_CATALOG } from '../combat/catalog.ts';
import type { CombatFactionId } from '../combat/factions.ts';
import type { CommanderId } from '../combat/commanders.ts';
import type { ShipId } from '../combat/ids.ts';
import type { UniverseCoordinate } from '../universe/types.ts';
import { getFlightRouteDeltas } from './distance.ts';
import type { FlightScienceLevels } from './types.ts';

const MAX_FLIGHT_SCIENCE_LEVEL = 15;

function cappedLevel(value: number | undefined): number {
  return Number.isFinite(value) ? Math.min(MAX_FLIGHT_SCIENCE_LEVEL, Math.max(0, Math.floor(value ?? 0))) : 0;
}

export function calculateFlightSpeedMultiplier(science: FlightScienceLevels = {}): number {
  return 1 + 0.10 * cappedLevel(science[4]) + 0.15 * cappedLevel(science[8])
    + 0.15 * cappedLevel(science[9]) + 0.20 * cappedLevel(science[14]);
}

export function calculateEffectiveShipSpeed(baseSpeed: number, science: FlightScienceLevels = {}): number {
  if (!Number.isFinite(baseSpeed) || baseSpeed <= 0) throw new Error('Ship speed must be positive.');
  return baseSpeed * calculateFlightSpeedMultiplier(science);
}

export function calculateEffectiveFleetSpeed(
  factionId: CombatFactionId,
  selectedShips: Partial<Record<ShipId, number>>,
  science: FlightScienceLevels = {},
  selectedCommanders: Partial<Record<CommanderId, number>> = {},
): number {
  const catalog = new Map(getFactionShipCatalog(factionId).map((ship) => [ship.id, ship]));
  const speeds: number[] = [];
  for (const [id, quantity] of Object.entries(selectedShips) as [ShipId, number][]) {
    if (!Number.isInteger(quantity) || quantity <= 0) continue;
    const ship = catalog.get(id);
    if (!ship?.ship) throw new Error(`Unknown ship: ${id}`);
    speeds.push(calculateEffectiveShipSpeed(ship.ship.speed, science));
  }
  const commanders = new Map(COMMANDER_COMBAT_CATALOG.map((commander) => [commander.id, commander]));
  for (const [id, quantity] of Object.entries(selectedCommanders) as [CommanderId, number][]) {
    if (!Number.isInteger(quantity) || quantity <= 0) continue;
    const commander = commanders.get(id);
    if (!commander?.ship) throw new Error(`Unknown commander: ${id}`);
    speeds.push(calculateEffectiveShipSpeed(commander.ship.speed, science));
  }
  if (speeds.length === 0) throw new Error('A flight needs at least one ship.');
  return Math.min(...speeds);
}

export function calculateBaseTimeMinutes(origin: UniverseCoordinate, destination: UniverseCoordinate): number {
  const delta = getFlightRouteDeltas(origin, destination);
  return 3 + 6 * delta.galaxy + 0.08 * delta.system + 0.02 * delta.position;
}

export function calculateOneWayDurationMs(
  origin: UniverseCoordinate,
  destination: UniverseCoordinate,
  effectiveSpeed: number,
): number {
  if (!Number.isFinite(effectiveSpeed) || effectiveSpeed <= 0) throw new Error('Effective speed must be positive.');
  const speedFactor = (20_000 / effectiveSpeed) ** 0.25;
  const oneWayMinutes = Math.max(3, calculateBaseTimeMinutes(origin, destination) * speedFactor / 1.5);
  return Math.round(oneWayMinutes * 60_000);
}
