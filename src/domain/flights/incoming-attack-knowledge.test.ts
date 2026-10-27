import assert from 'node:assert/strict';
import test from 'node:test';
import { PIRATE_CATALOG_BY_ID } from '../pirates/catalog.ts';
import type { FlightRecord } from './types.ts';
import { describeIncomingAttack, INCOMING_ATTACK_COMPOSITION_ESPIONAGE_LEVEL } from './incoming-attack-knowledge.ts';

const target = { galaxy: 1, system: 21, position: 8 };
const origin = { galaxy: 1, system: 14, position: 11 };

function flight(overrides: Partial<FlightRecord>): FlightRecord {
  return {
    id: 'flight-1',
    requestId: 'request-1',
    missionId: 'attack',
    phase: 'outbound',
    ownerSide: 'npc',
    ownerId: 'npc-gen-01',
    originPlanetId: 'npc-gen-01-planet',
    originCoordinate: origin,
    destination: { kind: 'planet', planetId: 'helion-01', coordinate: target },
    destinationPlanetId: 'helion-01',
    destinationOwnerId: 'player-current',
    destinationCoordinate: target,
    selectedShips: { scout: 12, cruiser: 3, battleship: 0 },
    selectedCommanders: { typhoon: 1, corsair: 0 },
    populationReserved: 0,
    routeDistance: 1,
    effectiveSpeed: 1,
    oneWayDurationMs: 60_000,
    departedAt: 1_000,
    arrivalAt: 61_000,
    gasCost: 0,
    ...overrides,
  } as FlightRecord;
}

test('below espionage 10 only the fact, attacker, target and time are known', () => {
  assert.equal(INCOMING_ATTACK_COMPOSITION_ESPIONAGE_LEVEL, 10);
  const known = describeIncomingAttack(flight({}), 9);
  assert.deepEqual(known, {
    flightId: 'flight-1',
    kind: 'attack',
    attackerSide: 'npc',
    attackerOwnerId: 'npc-gen-01',
    originCoordinate: origin,
    targetPlanetId: 'helion-01',
    targetCoordinate: target,
    arrivalAt: 61_000,
    composition: null,
  });
  // Nothing in the result carries ship counts below the threshold.
  assert.doesNotMatch(JSON.stringify(known), /scout|cruiser|typhoon/);
});

test('from espionage 10 the exact ships and commanders of an NPC attack are known', () => {
  assert.deepEqual(describeIncomingAttack(flight({}), 10)?.composition, {
    kind: 'fleet',
    ships: { scout: 12, cruiser: 3 },
    commanders: { typhoon: 1 },
  });
  assert.deepEqual(describeIncomingAttack(flight({ ownerSide: 'bot01', ownerId: undefined }), 15)?.composition?.kind, 'fleet');
});

test('an incoming pirate raid follows the same espionage rule, with its population', () => {
  const raid = flight({
    missionId: 'pirate-raid',
    ownerSide: 'pirate',
    ownerId: undefined,
    selectedShips: {},
    selectedCommanders: undefined,
    pirateRaidSnapshot: {
      version: 1, ownerId: 'player-current', contactCycleKey: 'pirate:1', targetPlanetId: 'helion-01', checkAt: 1_000,
      counterFleet: false, composition: { 'pirate-hound': 4, 'pirate-bandit': 0 }, profile: {} as never,
    } as unknown as FlightRecord['pirateRaidSnapshot'],
  });
  assert.equal(describeIncomingAttack(raid, 9)?.composition, null);
  assert.equal(describeIncomingAttack(raid, 9)?.kind, 'pirate-raid');
  const seen = describeIncomingAttack(raid, 10)?.composition;
  assert.equal(seen?.kind, 'pirate');
  assert.deepEqual(seen?.kind === 'pirate' ? seen.ships : null, { 'pirate-hound': 4 });
  assert.equal(seen?.kind === 'pirate' ? seen.population : null, PIRATE_CATALOG_BY_ID['pirate-hound'].population * 4);
});

test('older saves: missing levels hide the composition, missing fleet fields read as empty', () => {
  assert.equal(describeIncomingAttack(flight({}), undefined)?.composition, null);
  assert.equal(describeIncomingAttack(flight({}), Number.NaN)?.composition, null);
  assert.deepEqual(describeIncomingAttack(flight({ selectedCommanders: undefined }), 10)?.composition,
    { kind: 'fleet', ships: { scout: 12, cruiser: 3 }, commanders: {} });
  const legacyRaid = flight({ missionId: 'pirate-raid', ownerSide: 'pirate', pirateRaidSnapshot: undefined, destinationPlanetId: undefined });
  assert.deepEqual(describeIncomingAttack(legacyRaid, 10)?.composition, { kind: 'pirate', ships: {}, population: 0 });
  assert.equal(describeIncomingAttack(legacyRaid, 10)?.targetPlanetId, 'helion-01');
});

test('anything other than a planet attack or pirate raid is not an incoming attack', () => {
  assert.equal(describeIncomingAttack(flight({ missionId: 'espionage' }), 20), null);
  assert.equal(describeIncomingAttack(flight({ missionId: 'transport' }), 20), null);
  assert.equal(describeIncomingAttack(flight({ explorationAttack: true }), 20), null);
  assert.equal(describeIncomingAttack(flight({ missionId: 'pirate-raid', ownerSide: 'npc' }), 20), null);
});
