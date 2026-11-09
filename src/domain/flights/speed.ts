import { getFactionShipCatalog } from '../combat/faction-catalog.ts';
import { COMMANDER_COMBAT_CATALOG } from '../combat/catalog.ts';
import type { CombatFactionId } from '../combat/factions.ts';
import type { CommanderId } from '../combat/commanders.ts';
import type { ShipId } from '../combat/ids.ts';
import type { UniverseCoordinate } from '../universe/types.ts';
import { getFlightRouteDeltas } from './distance.ts';
import type { FlightScienceLevels } from './types.ts';

const MAX_FLIGHT_SCIENCE_LEVEL = 15;
/** Commander Typhoon «Форсаж»: +0.1% fleet speed per level while aboard. */
export const TYPHOON_SPEED_BONUS_PER_LEVEL = 0.001;

function cappedLevel(value: number | undefined): number {
  return Number.isFinite(value) ? Math.min(MAX_FLIGHT_SCIENCE_LEVEL, Math.max(0, Math.floor(value ?? 0))) : 0;
}

function commanderLevel(value: number | undefined): number {
  return Number.isFinite(value) ? Math.max(0, Math.floor(value ?? 0)) : 0;
}

/** Additive bonuses, like the sciences: 1 + science bonuses + Typhoon bonus. */
export function calculateFlightSpeedMultiplier(science: FlightScienceLevels = {}, typhoonLevel = 0): number {
  return 1 + 0.10 * cappedLevel(science[4]) + 0.15 * cappedLevel(science[8])
    + 0.15 * cappedLevel(science[9]) + 0.20 * cappedLevel(science[14])
    + TYPHOON_SPEED_BONUS_PER_LEVEL * commanderLevel(typhoonLevel);
}

export function calculateEffectiveShipSpeed(baseSpeed: number, science: FlightScienceLevels = {}, typhoonLevel = 0): number {
  if (!Number.isFinite(baseSpeed) || baseSpeed <= 0) throw new Error('Ship speed must be positive.');
  return baseSpeed * calculateFlightSpeedMultiplier(science, typhoonLevel);
}

export function calculateEffectiveFleetSpeed(
  factionId: CombatFactionId,
  selectedShips: Partial<Record<ShipId, number>>,
  science: FlightScienceLevels = {},
  selectedCommanders: Partial<Record<CommanderId, number>> = {},
  commanderLevels: Partial<Record<CommanderId, number>> = {},
): number {
  // Typhoon speeds up the whole fleet it flies with.
  const typhoonLevel = Number.isInteger(selectedCommanders.typhoon) && (selectedCommanders.typhoon ?? 0) > 0
    ? commanderLevel(commanderLevels.typhoon)
    : 0;
  const catalog = new Map(getFactionShipCatalog(factionId).map((ship) => [ship.id, ship]));
  const speeds: number[] = [];
  for (const [id, quantity] of Object.entries(selectedShips) as [ShipId, number][]) {
    if (!Number.isInteger(quantity) || quantity <= 0) continue;
    const ship = catalog.get(id);
    if (!ship?.ship) throw new Error(`Unknown ship: ${id}`);
    speeds.push(calculateEffectiveShipSpeed(ship.ship.speed, science, typhoonLevel));
  }
  const commanders = new Map(COMMANDER_COMBAT_CATALOG.map((commander) => [commander.id, commander]));
  for (const [id, quantity] of Object.entries(selectedCommanders) as [CommanderId, number][]) {
    if (!Number.isInteger(quantity) || quantity <= 0) continue;
    const commander = commanders.get(id);
    if (!commander?.ship) throw new Error(`Unknown commander: ${id}`);
    speeds.push(calculateEffectiveShipSpeed(commander.ship.speed, science, typhoonLevel));
  }
  if (speeds.length === 0) throw new Error('A flight needs at least one ship.');
  return Math.min(...speeds);
}

export function calculateBaseTimeMinutes(origin: UniverseCoordinate, destination: UniverseCoordinate): number {
  const delta = getFlightRouteDeltas(origin, destination);
  return 3 + 6 * delta.galaxy + 0.08 * delta.system + 0.02 * delta.position;
}

/** Any fleet with a real hull needs at least 3 minutes one way. */
export const MIN_ONE_WAY_DURATION_MS = 3 * 60_000;
/** Recon (a fleet of spy probes only) is bounded by the probe's speed alone: at least 3 seconds. */
export const MIN_RECON_ONE_WAY_DURATION_MS = 3_000;

/**
 * Real-time floor for a one-way flight, after the world speed is applied: no
 * mission, player or bot arrives sooner than this. Gas and speeds are untouched.
 */
export const MIN_REAL_ONE_WAY_DURATION_MS = 60_000;
/** Real-time floor for recon (probe-only spy flights): the probes are extremely fast by design. */
export const MIN_REAL_RECON_ONE_WAY_DURATION_MS = 3_000;
/**
 * Applies the real-time floor to an already world-speed-scaled one-way duration.
 * `reconOnly` (spy probes only, no other hull) lowers it to 3 s; everything else keeps 60 s.
 */
export function applyRealFlightFloor(scaledMs: number, reconOnly = false): number {
  return Math.max(reconOnly ? MIN_REAL_RECON_ONE_WAY_DURATION_MS : MIN_REAL_ONE_WAY_DURATION_MS, scaledMs);
}

/** True for a recon fleet: spy probes only, no commanders. */
export function isReconOnlyFleet(
  selectedShips: Partial<Record<ShipId, number>>,
  selectedCommanders: Partial<Record<CommanderId, number>> = {},
): boolean {
  const ships = (Object.entries(selectedShips) as [ShipId, number][]).filter(([, quantity]) => Number.isInteger(quantity) && quantity > 0);
  return ships.length > 0 && ships.every(([id]) => id === 'spy-probe')
    && !Object.values(selectedCommanders).some((quantity) => Number.isInteger(quantity) && (quantity ?? 0) > 0);
}

export function calculateOneWayDurationMs(
  origin: UniverseCoordinate,
  destination: UniverseCoordinate,
  effectiveSpeed: number,
  minimumMs: number = MIN_ONE_WAY_DURATION_MS,
): number {
  if (!Number.isFinite(effectiveSpeed) || effectiveSpeed <= 0) throw new Error('Effective speed must be positive.');
  const speedFactor = (20_000 / effectiveSpeed) ** 0.25;
  const oneWayMs = calculateBaseTimeMinutes(origin, destination) * speedFactor / 1.5 * 60_000;
  return Math.round(Math.max(minimumMs, oneWayMs));
}

/** Flight speed chosen at launch: 100% by default, down to 10% in 1% steps. */
export const MAX_FLIGHT_SPEED_PERCENT = 100;
export const MIN_FLIGHT_SPEED_PERCENT = 10;

/** True for a valid chosen speed: an integer from 10 to 100. */
export function isFlightSpeedPercent(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= MIN_FLIGHT_SPEED_PERCENT && (value as number) <= MAX_FLIGHT_SPEED_PERCENT;
}

/** Any input becomes a valid speed: missing or broken values are full speed. */
export function normalizeFlightSpeedPercent(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return MAX_FLIGHT_SPEED_PERCENT;
  return Math.min(MAX_FLIGHT_SPEED_PERCENT, Math.max(MIN_FLIGHT_SPEED_PERCENT, Math.round(value)));
}

/**
 * Lower speed, longer flight: the one-way time grows as 100 / percent (50% is
 * twice as long). Applied last, after the world speed and the real-time
 * floor, so a slowed fleet is always slower than a full-speed one. Fuel is not
 * touched (no rule for it in the game data).
 */
export function applyFlightSpeedPercent(fullSpeedDurationMs: number, speedPercent: number | undefined): number {
  const percent = normalizeFlightSpeedPercent(speedPercent);
  return percent >= MAX_FLIGHT_SPEED_PERCENT ? fullSpeedDurationMs : Math.round(fullSpeedDurationMs * MAX_FLIGHT_SPEED_PERCENT / percent);
}

/**
 * The fastest speed (largest percent, at most `maxPercent`) at which a flight
 * of `fullSpeedDurationMs` lasts at least `minDurationMs`. Null when even 10%
 * is too fast.
 */
export function slowestNeededSpeedPercent(fullSpeedDurationMs: number, minDurationMs: number, maxPercent = MAX_FLIGHT_SPEED_PERCENT): number | null {
  const cap = normalizeFlightSpeedPercent(maxPercent);
  if (applyFlightSpeedPercent(fullSpeedDurationMs, cap) >= minDurationMs) return cap;
  if (minDurationMs <= 0 || fullSpeedDurationMs <= 0) return cap;
  let percent = Math.min(cap, Math.floor(fullSpeedDurationMs * MAX_FLIGHT_SPEED_PERCENT / minDurationMs));
  while (percent >= MIN_FLIGHT_SPEED_PERCENT && applyFlightSpeedPercent(fullSpeedDurationMs, percent) < minDurationMs) percent -= 1;
  return percent >= MIN_FLIGHT_SPEED_PERCENT ? percent : null;
}
