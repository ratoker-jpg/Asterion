import type { FlightRecord } from '../domain/flights/types.ts';

/**
 * What the player may see in Fleet and header alerts: their own flights and
 * flights aimed at them. Everything between other owners (NPC missions, pirate
 * raids on NPCs, NPC-vs-NPC battles) stays private to those owners.
 */
export function isFlightVisibleToPlayer(flight: FlightRecord, playerId: string): boolean {
  if (flight.ownerSide === undefined || flight.ownerSide === 'player') return true;
  if (flight.ownerSide === 'pirate') return flight.destinationOwnerId === undefined
    ? flight.targetKind !== 'npc'
    : flight.destinationOwnerId === playerId;
  if (flight.ownerSide === 'npc') return flight.destinationOwnerId === playerId;
  // Test Mode Bot 01 scenarios exist only to target the player.
  return true;
}

/** A hostile fleet still on its way to one of the player's planets. */
export function isHostileFlightIncomingToPlayer(flight: FlightRecord, playerId: string): boolean {
  if (flight.phase !== 'outbound' || !isFlightVisibleToPlayer(flight, playerId)) return false;
  return ((flight.ownerSide === 'bot01' || flight.ownerSide === 'npc') && flight.missionId === 'attack')
    || (flight.ownerSide === 'pirate' && flight.missionId === 'pirate-raid');
}
