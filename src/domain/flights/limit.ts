import type { MissionId, FlightRecord } from './types.ts';

/** «Компьютерные системы»: +1.5 simultaneous flights per level. */
export const COMPUTER_SYSTEMS_SCIENCE_ID = 6;
export const BASE_CONCURRENT_FLIGHTS = 3;
export const CONCURRENT_FLIGHTS_PER_LEVEL = 1.5;

/** Spy-probe-only missions (and their returns) never take a flight slot. */
export const FLIGHT_LIMIT_EXEMPT_MISSIONS: ReadonlySet<MissionId> = new Set<MissionId>([
  'espionage',
  'pirate-recon',
  'exploration-recon',
]);

const OCCUPYING_PHASES = new Set<FlightRecord['phase']>(['outbound', 'arrived', 'returning']);

function safeLevel(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}

/** limit = 3 + floor(1.5 x level). */
export function concurrentFlightLimit(computerSystemsLevel: unknown): number {
  return BASE_CONCURRENT_FLIGHTS + Math.floor(CONCURRENT_FLIGHTS_PER_LEVEL * safeLevel(computerSystemsLevel));
}

export function isFlightLimitExempt(missionId: MissionId): boolean {
  return FLIGHT_LIMIT_EXEMPT_MISSIONS.has(missionId);
}

/** Player flights that hold a slot: outbound, at the target or on the way back. */
export function countsTowardFlightLimit(flight: FlightRecord): boolean {
  if (flight.ownerSide && flight.ownerSide !== 'player') return false;
  return OCCUPYING_PHASES.has(flight.phase) && !isFlightLimitExempt(flight.missionId);
}

export type FlightSlotUsage = { used: number; limit: number; free: number };

export function getFlightSlotUsage(
  records: readonly FlightRecord[],
  computerSystemsLevel: unknown,
): FlightSlotUsage {
  const used = records.filter(countsTowardFlightLimit).length;
  const limit = concurrentFlightLimit(computerSystemsLevel);
  return { used, limit, free: Math.max(0, limit - used) };
}

/**
 * Free slots of one autonomous NPC owner, by the player's rule, counted over
 * that owner's own flights without copying them.
 */
export function npcFreeFlightSlots(ownerFlights: readonly FlightRecord[], computerSystemsLevel: unknown): number {
  let used = 0;
  for (const flight of ownerFlights) {
    if (flight.ownerSide === 'npc' && OCCUPYING_PHASES.has(flight.phase) && !isFlightLimitExempt(flight.missionId)) used += 1;
  }
  return Math.max(0, concurrentFlightLimit(computerSystemsLevel) - used);
}
