import assert from 'node:assert/strict';
import test from 'node:test';
import type { FlightRecord } from '../domain/flights/types.ts';
import { isFlightVisibleToPlayer, isHostileFlightIncomingToPlayer } from './flight-visibility.ts';

const PLAYER = 'player-current';
const flight = (fields: Partial<FlightRecord>): FlightRecord => ({ id: 'f', phase: 'outbound', missionId: 'attack', ...fields }) as FlightRecord;

test('the player sees own flights and flights aimed at them, never those between other owners', () => {
  assert.equal(isFlightVisibleToPlayer(flight({ missionId: 'transport' }), PLAYER), true);
  assert.equal(isFlightVisibleToPlayer(flight({ ownerSide: 'player' }), PLAYER), true);
  assert.equal(isFlightVisibleToPlayer(flight({ ownerSide: 'npc', ownerId: 'npc-gen-1', destinationOwnerId: PLAYER }), PLAYER), true);
  assert.equal(isFlightVisibleToPlayer(flight({ ownerSide: 'npc', ownerId: 'npc-gen-1', destinationOwnerId: 'npc-gen-2' }), PLAYER), false);
  assert.equal(isFlightVisibleToPlayer(flight({ ownerSide: 'npc', ownerId: 'npc-gen-1', missionId: 'pirate-elimination' }), PLAYER), false);
  assert.equal(isFlightVisibleToPlayer(flight({ ownerSide: 'pirate', missionId: 'pirate-raid', destinationOwnerId: PLAYER, targetKind: 'player' }), PLAYER), true);
  assert.equal(isFlightVisibleToPlayer(flight({ ownerSide: 'pirate', missionId: 'pirate-raid', destinationOwnerId: 'npc-gen-3', targetKind: 'npc' }), PLAYER), false);
});

test('only hostile fleets still flying at the player count as incoming threats', () => {
  assert.equal(isHostileFlightIncomingToPlayer(flight({ ownerSide: 'pirate', missionId: 'pirate-raid', destinationOwnerId: PLAYER }), PLAYER), true);
  assert.equal(isHostileFlightIncomingToPlayer(flight({ ownerSide: 'pirate', missionId: 'pirate-raid', destinationOwnerId: 'npc-gen-3', targetKind: 'npc' }), PLAYER), false);
  assert.equal(isHostileFlightIncomingToPlayer(flight({ ownerSide: 'npc', destinationOwnerId: 'npc-gen-2' }), PLAYER), false);
  assert.equal(isHostileFlightIncomingToPlayer(flight({ ownerSide: 'npc', destinationOwnerId: PLAYER }), PLAYER), true);
  assert.equal(isHostileFlightIncomingToPlayer(flight({ ownerSide: 'npc', destinationOwnerId: PLAYER, phase: 'returning' }), PLAYER), false);
  assert.equal(isHostileFlightIncomingToPlayer(flight({ ownerSide: 'npc', destinationOwnerId: PLAYER, missionId: 'aid' }), PLAYER), false);
});
