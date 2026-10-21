import type { AidResource } from '../command/types.ts';
import { TRANSPORT_CARGO_KEYS, normalizeTransportCargo, type TransportCargo } from './cargo.ts';
import type { FlightRecord } from './types.ts';

/**
 * Alliance aid ("Помощь союзу") mission. It is an ordinary transport flight
 * (same ships, cargo capacity, fuel, travel, arrival, return and persistence)
 * bound to one open resource request. The request layer reserves the shipped
 * amount at launch and credits only what the planet actually accepted.
 */
export const AID_MISSION_ENABLED = true;

export const AID_MISSION_DESCRIPTION = 'Отправка запрошенного ресурса союзнику по его открытому запросу: только свободные транспортёры и только тот ресурс, который указан в запросе.';

/** Only dedicated cargo hulls can carry aid; this is not a combat or espionage mission. */
export const AID_TRANSPORT_SHIP_IDS = ['transporter', 'mega-transporter'] as const;

/** Phases in which an aid flight still holds its cargo and therefore reserves part of the request. */
const RESERVING_PHASES = new Set<FlightRecord['phase']>(['outbound', 'arrived']);

/**
 * Units of a request currently on their way. A flight stops reserving the
 * moment its cargo is settled (delivered, voided, or turned back), so a recalled
 * or failed flight frees its share without any separate bookkeeping.
 */
export function aidInFlightUnits(records: readonly FlightRecord[], requestId: string): number {
  let total = 0;
  for (const flight of records) {
    if (flight.missionId !== 'aid' || flight.aid?.requestId !== requestId) continue;
    if (!RESERVING_PHASES.has(flight.phase) || flight.cargoState !== 'loaded') continue;
    total += normalizeTransportCargo(flight.cargo)[flight.aid.resource];
  }
  return total;
}

export type AidCargoFailure = 'wrong-resource' | 'empty-cargo';

/** One aid flight carries exactly one resource: the one named in the request. */
export function validateAidCargo(
  cargo: unknown,
  resource: AidResource,
): { ok: true; cargo: TransportCargo; units: number } | { ok: false; reason: AidCargoFailure } {
  const normalized = normalizeTransportCargo(cargo);
  for (const key of TRANSPORT_CARGO_KEYS) {
    if (key !== resource && normalized[key] > 0) return { ok: false, reason: 'wrong-resource' };
  }
  const units = normalized[resource];
  return units > 0 ? { ok: true, cargo: normalized, units } : { ok: false, reason: 'empty-cargo' };
}

/** Aid ships must be dedicated cargo hulls only. */
export function isAidTransportComposition(selectedShips: Readonly<Partial<Record<string, number>>>): boolean {
  const entries = Object.entries(selectedShips).filter(([, quantity]) => typeof quantity === 'number' && quantity > 0);
  return entries.length > 0 && entries.every(([shipId]) => (AID_TRANSPORT_SHIP_IDS as readonly string[]).includes(shipId));
}
