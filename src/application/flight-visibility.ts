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

type FlightNoticeEvent = { flight: FlightRecord; status: string; notice: string };

/**
 * Which reconcile events become the player's toasts. This is narrower than
 * visibility: an NPC fleet flying at the player is shown in Fleet, but its
 * spy report, return home and other bookkeeping belong to the NPC owner. The
 * player hears only about their own flights and about fights on their planets.
 */
export function isFlightEventForPlayer(event: FlightNoticeEvent, playerId: string): boolean {
  const { flight } = event;
  if (flight.ownerSide === undefined || flight.ownerSide === 'player') return true;
  if (!isFlightVisibleToPlayer(flight, playerId)) return false;
  if (event.status === 'incoming-attack') return true;
  // Pirates and Test Mode Bot 01 exist only to target the player; a raid that
  // found no planet is still the player's news. NPC failures are the NPC's.
  return event.status === 'target-unavailable' && (flight.ownerSide === 'pirate' || flight.ownerSide === 'bot01');
}
