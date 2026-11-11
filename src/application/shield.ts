import type { SaveState } from './contracts.ts';
import type { FlightRecord } from '../domain/flights/types.ts';
import {
  createShieldRecord, formatShieldRemaining, isShieldActive, shieldStatus, type ShieldRecord, type ShieldStatus,
} from '../domain/shield/shield.ts';

/**
 * Passive counters for the bot lab (never read by a game rule): how often the
 * shield turned something away. Reset by the tool that measures.
 */
export const SHIELD_TELEMETRY = { activations: 0, attacksBlocked: 0, bounces: 0, lootWithheld: 0, reasons: {} as Record<string, number> };
export function resetShieldTelemetry(): void {
  SHIELD_TELEMETRY.activations = 0; SHIELD_TELEMETRY.attacksBlocked = 0; SHIELD_TELEMETRY.bounces = 0; SHIELD_TELEMETRY.lootWithheld = 0; SHIELD_TELEMETRY.reasons = {};
}

/** Missions that hurt someone: forbidden for a shielded owner. Spying, transport, deployment stay open. */
const HOSTILE_MISSIONS: ReadonlySet<string> = new Set(['attack', 'sun-support', 'sun-attack', 'pirate-elimination']);

export function isHostileMission(missionId: string): boolean {
  return HOSTILE_MISSIONS.has(missionId);
}

export function ownerShieldRecord(state: SaveState, ownerId: string | undefined): ShieldRecord | undefined {
  return ownerId ? state.shields?.[ownerId] : undefined;
}

export function ownerShieldStatus(state: SaveState, ownerId: string | undefined, at: number): ShieldStatus {
  return shieldStatus(ownerShieldRecord(state, ownerId), at);
}

export function isOwnerShielded(state: SaveState, ownerId: string | undefined, at: number): boolean {
  return isShieldActive(ownerShieldRecord(state, ownerId), at);
}

/** Owner id a flight belongs to (the player's flights carry no ownerId). */
export function flightOwnerId(state: SaveState, flight: FlightRecord): string | undefined {
  return flight.ownerSide === 'npc' ? flight.ownerId : flight.ownerSide === 'player' || flight.ownerSide === undefined ? state.profile.playerId : undefined;
}

/** Hostile flights of the owner still heading out; they must be recalled before the shield goes up. */
const hostileCandidates = new WeakMap<readonly FlightRecord[], Map<string, FlightRecord[]>>();

/** The owner's flights on a hostile mission: all that survive the (time-independent) owner and mission test. */
function ownerHostileCandidates(state: SaveState, ownerId: string): FlightRecord[] {
  const records = state.flights?.records ?? [];
  let byOwner = hostileCandidates.get(records);
  if (!byOwner) {
    byOwner = new Map();
    hostileCandidates.set(records, byOwner);
  }
  // A player flight carries no owner id, so the answer also depends on who the player is.
  const key = `${ownerId}|${state.profile.playerId}`;
  let candidates = byOwner.get(key);
  if (!candidates) {
    candidates = records.filter((flight) => isHostileMission(flight.missionId) && flightOwnerId(state, flight) === ownerId);
    byOwner.set(key, candidates);
  }
  return candidates;
}

export function ownerOutboundHostileFlights(state: SaveState, ownerId: string, at: number): FlightRecord[] {
  return ownerHostileCandidates(state, ownerId).filter((flight) => {
    // A Sun fleet (support or raid) stays committed to the battle after it arrives early, until it turns home.
    if (flight.missionId === 'sun-support' || flight.missionId === 'sun-attack') return flight.phase === 'outbound' || flight.phase === 'arrived';
    // Other fleets: a flight whose arrival time has passed is no longer en route, reconciled or not (chunk-size independent).
    return flight.phase === 'outbound' && flight.arrivalAt > at;
  });
}

/** Text for an attack button / launch refusal when the target owner's planets sit under a shield. */
export function targetShieldMessage(state: SaveState, targetOwnerId: string | undefined, at: number): string | null {
  const status = ownerShieldStatus(state, targetOwnerId, at);
  return status.phase === 'active' ? `Планета под щитом, ещё ${formatShieldRemaining(status.remainingMs)}` : null;
}

/** Text when the launching owner is under their own shield. */
export function ownShieldMessage(state: SaveState, ownerId: string | undefined, at: number): string | null {
  const status = ownerShieldStatus(state, ownerId, at);
  return status.phase === 'active' ? `Ваш щит активен, ещё ${formatShieldRemaining(status.remainingMs)}: нападать нельзя` : null;
}

export type ShieldActivationBlock = 'active' | 'cooldown' | 'hostile-flights' | 'unknown-owner';

export type ShieldActivationCheck =
  | { ok: true }
  | { ok: false; code: ShieldActivationBlock; message: string };

export function checkShieldActivation(state: SaveState, ownerId: string, at: number): ShieldActivationCheck {
  const status = ownerShieldStatus(state, ownerId, at);
  if (status.phase === 'active') return { ok: false, code: 'active', message: `Щит уже включён, ещё ${formatShieldRemaining(status.remainingMs)}` };
  if (status.phase === 'cooldown') return { ok: false, code: 'cooldown', message: `Щит перезаряжается, ещё ${formatShieldRemaining(status.remainingMs)}` };
  const hostile = ownerOutboundHostileFlights(state, ownerId, at);
  if (hostile.length > 0) {
    return { ok: false, code: 'hostile-flights', message: `Сначала отзовите боевые полёты: ${hostile.length}` };
  }
  return { ok: true };
}

export function activateShield(state: SaveState, ownerId: string, at: number, reason?: string): { ok: true; state: SaveState } | { ok: false; code: ShieldActivationBlock; message: string } {
  const check = checkShieldActivation(state, ownerId, at);
  if (!check.ok) return check;
  SHIELD_TELEMETRY.activations += 1;
  if (reason) SHIELD_TELEMETRY.reasons[reason] = (SHIELD_TELEMETRY.reasons[reason] ?? 0) + 1;
  const record = createShieldRecord(state.worldConfig?.world.campaignSpeed, at, reason);
  return { ok: true, state: { ...state, shields: { ...(state.shields ?? {}), [ownerId]: record } } };
}

/** Owner whose planet a hostile flight is heading for (undefined for exploration objects and Suns). */
export function hostileFlightTargetOwnerId(state: SaveState, flight: FlightRecord): string | undefined {
  const isRaid = flight.ownerSide === 'pirate' && flight.missionId === 'pirate-raid';
  if (!isRaid && (flight.missionId !== 'attack' || flight.explorationAttack)) return undefined;
  if (flight.destinationOwnerId) return flight.destinationOwnerId;
  if (!flight.destinationPlanetId) return undefined;
  if (state.planets[flight.destinationPlanetId]) return state.profile.playerId;
  return state.espionage?.targets?.[flight.destinationPlanetId]?.ownerId;
}

/** A hostile flight reaching a shielded owner's planet turns back without a battle. */
export function isShieldBounce(state: SaveState, flight: FlightRecord, arrivalAt: number): boolean {
  const owner = hostileFlightTargetOwnerId(state, flight);
  const bounce = owner !== undefined && isOwnerShielded(state, owner, arrivalAt);
  if (bounce) SHIELD_TELEMETRY.bounces += 1;
  return bounce;
}
