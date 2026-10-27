import type { CommanderId } from '../combat/commanders.ts';
import type { ShipId } from '../combat/ids.ts';
import { PIRATE_CATALOG_BY_ID, type PirateBaseShipId } from '../pirates/catalog.ts';
import type { UniverseCoordinate } from '../universe/types.ts';
import type { FlightRecord } from './types.ts';

/** Espionage (science 5) level at which the defender sees an incoming fleet's exact composition. */
export const INCOMING_ATTACK_COMPOSITION_ESPIONAGE_LEVEL = 10;

export type IncomingAttackComposition =
  | {
    kind: 'fleet';
    ships: Partial<Record<ShipId, number>>;
    commanders: Partial<Record<CommanderId, number>>;
  }
  | {
    kind: 'pirate';
    ships: Partial<Record<PirateBaseShipId, number>>;
    population: number;
  };

/**
 * What the owner of the attacked planet knows about one incoming hostile
 * fleet. The fact of the attack, the attacker, the target and the arrival time
 * are public; the composition is known only from espionage level 10 on, read
 * at the moment of viewing. Shared by the player's screens and NPC threat
 * assessment, so neither sees more than the rule allows.
 */
export type IncomingAttackKnowledge = {
  flightId: string;
  kind: 'attack' | 'pirate-raid';
  attackerSide: 'player' | 'npc' | 'bot01' | 'pirate';
  attackerOwnerId: string | null;
  originCoordinate: UniverseCoordinate;
  targetPlanetId: string | null;
  targetCoordinate: UniverseCoordinate;
  arrivalAt: number;
  composition: IncomingAttackComposition | null;
};

function positiveCounts<K extends string>(source: Readonly<Partial<Record<K, number>>> | undefined, accept: (id: string) => boolean): Partial<Record<K, number>> {
  const counts: Partial<Record<K, number>> = {};
  for (const [id, raw] of Object.entries(source ?? {}) as [K, number | undefined][]) {
    const count = typeof raw === 'number' && Number.isFinite(raw) ? Math.floor(raw) : 0;
    if (count > 0 && accept(id)) counts[id] = count;
  }
  return counts;
}

export function isIncomingAttackFlight(flight: FlightRecord): boolean {
  return (flight.missionId === 'attack' && flight.ownerSide !== 'pirate' && !flight.explorationAttack && !flight.sunRaid)
    || (flight.missionId === 'pirate-raid' && flight.ownerSide === 'pirate');
}

export function canSeeIncomingAttackComposition(defenderEspionageLevel: number | undefined): boolean {
  return typeof defenderEspionageLevel === 'number' && Number.isFinite(defenderEspionageLevel)
    && Math.floor(defenderEspionageLevel) >= INCOMING_ATTACK_COMPOSITION_ESPIONAGE_LEVEL;
}

/**
 * Returns null for anything that is not an incoming planet attack or pirate
 * raid. Missing fields from older saves read as an empty composition rather
 * than failing.
 */
export function describeIncomingAttack(
  flight: FlightRecord,
  defenderEspionageLevel: number | undefined,
): IncomingAttackKnowledge | null {
  if (!isIncomingAttackFlight(flight)) return null;
  const isPirate = flight.missionId === 'pirate-raid';
  let composition: IncomingAttackComposition | null = null;
  if (canSeeIncomingAttackComposition(defenderEspionageLevel)) {
    if (isPirate) {
      const ships = positiveCounts<PirateBaseShipId>(flight.pirateRaidSnapshot?.composition, (id) => id in PIRATE_CATALOG_BY_ID);
      const population = (Object.entries(ships) as [PirateBaseShipId, number][])
        .reduce((total, [id, count]) => total + (PIRATE_CATALOG_BY_ID[id]?.population ?? 0) * count, 0);
      composition = { kind: 'pirate', ships, population };
    } else {
      composition = {
        kind: 'fleet',
        ships: positiveCounts<ShipId>(flight.selectedShips, () => true),
        commanders: positiveCounts<CommanderId>(flight.selectedCommanders, () => true),
      };
    }
  }
  return {
    flightId: flight.id,
    kind: isPirate ? 'pirate-raid' : 'attack',
    attackerSide: flight.ownerSide ?? 'player',
    attackerOwnerId: isPirate ? flight.pirateRaidSnapshot?.ownerId ?? null : flight.ownerId ?? null,
    originCoordinate: { ...flight.originCoordinate },
    targetPlanetId: flight.destinationPlanetId ?? (flight.destination.kind === 'planet' ? flight.destination.planetId : null),
    targetCoordinate: { ...flight.destinationCoordinate },
    arrivalAt: flight.arrivalAt,
    composition,
  };
}
