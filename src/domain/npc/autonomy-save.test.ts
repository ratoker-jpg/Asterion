import assert from 'node:assert/strict';
import test from 'node:test';

import { COMBAT_TECHNOLOGY_IDS } from '../combat/technologies.ts';
import { validateNpcAutonomyPayload } from './autonomy-save.ts';

const ownerId = 'npc-owner-1';
const originId = 'npc-planet-1';

function productionQueue(): {
  shipQueue: Record<string, unknown>[];
  defenseQueue: Record<string, unknown>[];
  commanderQueue: Record<string, unknown>[];
} {
  return {
    shipQueue: [{
      id: 'order-scout-1',
      queueKind: 'ships',
      itemId: 'scout',
      quantity: 2,
      completedQuantity: 0,
      enqueuedAt: 1_000,
      startedAt: 1_000,
      finishAt: 3_000,
      effectiveDurationMs: 1_000,
      cost: { metal: 100, minerals: 50, gas: 10 },
      refundEligible: true,
    }],
    defenseQueue: [],
    commanderQueue: [],
  };
}

function target(fleetProduction: unknown = productionQueue()) {
  return {
    id: originId,
    ownerId,
    raceId: 'aegis',
    coordinate: { galaxy: 1, system: 1, position: 1 },
    fleetProduction,
  };
}

function attackSnapshot() {
  return {
    version: 1,
    maxRounds: 5,
    attackerFactionId: 'aegis',
    attackerTechnologies: Object.fromEntries(COMBAT_TECHNOLOGY_IDS.map((id) => [id, 0])),
    attackerShipLevels: {},
    attackerCommanderLevels: {},
    attackerPriority: [],
  };
}

function npcFlight(overrides: Record<string, unknown> = {}) {
  return {
    id: 'flight-npc-1',
    requestId: 'npc-action-1',
    ownerSide: 'npc',
    ownerId,
    missionId: 'attack',
    originPlanetId: originId,
    originCoordinate: { galaxy: 1, system: 1, position: 1 },
    destination: { kind: 'planet', planetId: 'player-planet-1', coordinate: { galaxy: 1, system: 1, position: 2 } },
    destinationPlanetId: 'player-planet-1',
    destinationCoordinate: { galaxy: 1, system: 1, position: 2 },
    selectedShips: { scout: 1 },
    selectedCommanders: {},
    populationReserved: 1,
    routeDistance: 1_005,
    effectiveSpeed: 1_000,
    oneWayDurationMs: 10_000,
    departedAt: 1_000,
    arrivalAt: 11_000,
    gasCost: 10,
    attackSnapshot: attackSnapshot(),
    phase: 'outbound',
    ...overrides,
  };
}

function payload(options: { queue?: unknown; flight?: unknown; includeQueue?: boolean } = {}) {
  const npcTarget = target(options.includeQueue === false ? undefined : options.queue ?? productionQueue());
  if (options.includeQueue === false) delete (npcTarget as { fleetProduction?: unknown }).fleetProduction;
  return {
    espionage: { targets: { [originId]: npcTarget } },
    flights: { records: options.flight === undefined ? [] : [options.flight] },
  } as Record<string, unknown>;
}

test('accepts canonical owner fleet queues and a flight bound to its live NPC origin', () => {
  assert.equal(validateNpcAutonomyPayload(payload({ flight: npcFlight() })), true);
  assert.equal(validateNpcAutonomyPayload(payload({ flight: npcFlight({ routeDistance: 1_005.5, effectiveSpeed: 999.9999999999999 }) })), true);
});

test('accepts legacy payloads with absent autonomy queues and unbound NPC flights', () => {
  assert.equal(validateNpcAutonomyPayload(payload({ includeQueue: false })), true);
  assert.equal(validateNpcAutonomyPayload(payload({ includeQueue: false, flight: {
    id: 'legacy-flight',
    ownerSide: 'npc',
    missionId: 'expedition',
  } })), true);
  assert.equal(validateNpcAutonomyPayload({ flights: { records: [null, { missionId: 'old-unknown-mission' }] } }), true);
});

test('rejects malformed queue shape, catalog identity, timing, duplicate IDs, costs, and commander levels', () => {
  const valid = productionQueue();
  const invalidQueues = [
    { ...valid, commanderQueue: undefined },
    { ...valid, shipQueue: [{ ...valid.shipQueue[0], queueKind: 'defense' }] },
    { ...valid, shipQueue: [{ ...valid.shipQueue[0], itemId: 'not-a-ship' }] },
    { ...valid, shipQueue: [{ ...valid.shipQueue[0], finishAt: 3_001 }] },
    { ...valid, shipQueue: [{ ...valid.shipQueue[0], completedQuantity: 3 }] },
    { ...valid, shipQueue: [{ ...valid.shipQueue[0], cost: { metal: -1, minerals: 0, gas: 0 } }] },
    { ...valid, defenseQueue: [{ ...valid.shipQueue[0], queueKind: 'defense', itemId: 'ballistic-turret' }] },
    { ...valid, commanderQueue: [{ ...valid.shipQueue[0], queueKind: 'commanders', itemId: 'corsair', commanderLevelAtEnqueue: 41 }] },
  ];
  for (const queue of invalidQueues) assert.equal(validateNpcAutonomyPayload(payload({ queue })), false);
});

test('rejects cross-queue duplicate order IDs and wrong owner faction', () => {
  const queue = productionQueue();
  queue.defenseQueue.push({
    ...queue.shipQueue[0]!,
    queueKind: 'defense',
    itemId: 'ballistic-turret',
  });
  assert.equal(validateNpcAutonomyPayload(payload({ queue })), false);

  const wrongFaction = { ...target(), raceId: 'unknown' };
  assert.equal(validateNpcAutonomyPayload({ espionage: { targets: { [originId]: wrongFaction } } }), false);
});

test('rejects malformed owner-bound flight identity, mission, destination, ships, and attack snapshot', () => {
  const invalidFlights = [
    npcFlight({ ownerId: '  ' }),
    npcFlight({ missionId: 'unknown-mission' }),
    npcFlight({ destination: { kind: 'planet', planetId: 'different-id', coordinate: { galaxy: 1, system: 1, position: 2 } } }),
    npcFlight({ selectedShips: { scout: 0 } }),
    npcFlight({ arrivalAt: 999 }),
    npcFlight({ attackSnapshot: undefined }),
    npcFlight({ attackSnapshot: { ...attackSnapshot(), attackerFactionId: 'unknown' } }),
  ];
  for (const flight of invalidFlights) assert.equal(validateNpcAutonomyPayload(payload({ flight })), false);
});

test('preserves owner-bound flights when the origin is destroyed or captured', () => {
  const destroyedOrigin = payload({ flight: npcFlight({ originPlanetId: 'missing-origin' }) });
  assert.equal(validateNpcAutonomyPayload(destroyedOrigin), true);

  const returningToDestroyedOrigin = payload({ flight: npcFlight({
    originPlanetId: 'missing-origin',
    phase: 'returning',
    returnAt: 21_000,
    completionReason: 'origin-destroyed',
  }) });
  assert.equal(validateNpcAutonomyPayload(returningToDestroyedOrigin), true);

  const capturedOrigin = payload({ flight: npcFlight() });
  const targets = (capturedOrigin.espionage as { targets: Record<string, { ownerId: string }> }).targets;
  targets[originId]!.ownerId = 'captured-by-another-owner';
  assert.equal(validateNpcAutonomyPayload(capturedOrigin), true,
    'the frozen flight owner is not rebound to the new live owner');
});

test('validates NPC return receipts and rejects receipts on other owners or invalid timestamps', () => {
  assert.equal(validateNpcAutonomyPayload(payload({ flight: npcFlight({ npcReturnCreditedAt: 20_000 }) })), true);
  assert.equal(validateNpcAutonomyPayload(payload({ flight: npcFlight({ npcReturnCreditedAt: -1 }) })), false);
  assert.equal(validateNpcAutonomyPayload(payload({ flight: npcFlight({ ownerSide: 'player', npcReturnCreditedAt: 20_000 }) })), false);
  assert.equal(validateNpcAutonomyPayload(payload({ flight: npcFlight({ ownerSide: 'player' }) })), false);
});

test('rejects a new owner-bound flight whose identity collides with a legacy flight record', () => {
  const legacy = { id: 'flight-npc-1', requestId: 'legacy-request', ownerSide: 'player' };
  const withDuplicate = payload({ flight: npcFlight() });
  (withDuplicate.flights as { records: unknown[] }).records.unshift(legacy);
  assert.equal(validateNpcAutonomyPayload(withDuplicate), false);
});

test('enforces mission-specific frozen snapshots and owner binding', () => {
  const pirateFlight = npcFlight({
    missionId: 'pirate-recon',
    operationId: 'pirate-cycle-1',
    destination: { kind: 'operation', operationId: 'pirate-cycle-1', coordinate: { galaxy: 1, system: 1, position: 2 } },
    pirateSnapshot: {
      version: 1,
      missionId: 'pirate-recon',
      ownerId,
      contactCycleKey: 'pirate-cycle-1',
      coordinate: { galaxy: 1, system: 1, position: 2 },
      cycleIndex: 1,
      startAt: 1_000,
      expiresAt: 100_000,
      profile: {},
    },
  });
  assert.equal(validateNpcAutonomyPayload(payload({ flight: pirateFlight })), false);

  const spyFlight = npcFlight({ missionId: 'espionage', spyMissionId: 'spy-action-1' });
  assert.equal(validateNpcAutonomyPayload(payload({ flight: spyFlight })), true);
  assert.equal(validateNpcAutonomyPayload(payload({ flight: { ...spyFlight, spyMissionId: undefined } })), false);
});

test('accepts canonical expeditions without an attack snapshot and rejects a malformed supplied snapshot', () => {
  const expedition = npcFlight({
    missionId: 'expedition',
    operationId: 'unique:1:27:8333:1792538204655',
    targetKind: 'unique',
    explorationFactionId: 'veyra',
    explorationLaunchResourcePoints: 105,
    selectedShips: { scout: 1 },
    attackSnapshot: undefined,
  });
  assert.equal(validateNpcAutonomyPayload(payload({ flight: expedition })), true);
  assert.equal(validateNpcAutonomyPayload(payload({ flight: {
    ...expedition,
    attackSnapshot: { ...attackSnapshot(), attackerFactionId: 'unknown' },
  } })), false);
});
