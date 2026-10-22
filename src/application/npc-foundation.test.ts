import assert from 'node:assert/strict';
import test from 'node:test';

import { createDefaultNewGameConfig } from '../domain/world/config.ts';
import { createNpcState, validateNpcState } from '../domain/npc/state.ts';
import { createExplorationState } from '../domain/exploration/ledger.ts';
import { createDefaultPirateState } from '../domain/pirates/mission.ts';
import { reconcileRuntime } from './reconcile.ts';
import { createSpyTargetOwnerProfile } from './espionage-targets.ts';
import { createInitialSaveState, createPersistenceFacade, SAVE_SCHEMA_VERSION } from './persistence.ts';
import { buildPirateBattleAnalysisExport } from './pirate-battle-export.ts';
import { createSlot, describeSave, exportSaveSlot, type SlotStorage } from './slots.ts';
import type { SaveState } from './contracts.ts';
import type { FlightRecord } from '../domain/flights/types.ts';

const NOW = Date.UTC(2026, 9, 20, 12);

function memoryStorage(): SlotStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => { data.set(key, String(value)); },
    removeItem: (key) => { data.delete(key); },
    key: (position) => [...data.keys()][position] ?? null,
    get length() { return data.size; },
  };
}

function config(seed: string, npcCount = 12) {
  const base = createDefaultNewGameConfig({ seed, factionId: 'aegis', playerName: 'Тестовый командир' });
  return { ...base, world: { ...base.world, npcCount } };
}

function npcOwnerTargets(state: SaveState) {
  return Object.values(state.espionage?.targets ?? {})
    .filter((target) => target.ownerId !== state.profile.playerId)
    .sort((left, right) => left.id.localeCompare(right.id));
}

function jsonValue<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

test('NPC foundation creates 100 distinct owner profiles and accepts an empty world', () => {
  const owners = Array.from({ length: 100 }, (_, index) => `npc-owner-${String(index).padStart(3, '0')}`);
  const state = createNpcState(owners, 'stress-salt-100', NOW);
  assert.equal(validateNpcState(state), true);
  assert.equal(Object.keys(state.profiles).length, 100);
  assert.equal(new Set(Object.values(state.profiles).map((profile) => profile.privateSeed)).size, 100);
  assert.equal(new Set(Object.values(state.profiles).map((profile) => JSON.stringify(profile.traits))).size, 100);

  const empty = createNpcState([], 'empty-world-salt', NOW);
  assert.equal(validateNpcState(empty), true);
  assert.deepEqual(Object.keys(empty.profiles), []);
});

test('new campaigns with the same visible seed keep their world but independently salt NPC identity', () => {
  const setup = config('NPCFOUNDATION1', 30);
  const first = createInitialSaveState('production', NOW, setup);
  const second = createInitialSaveState('production', NOW, setup);
  const firstTargets = npcOwnerTargets(first);
  const secondTargets = npcOwnerTargets(second);

  assert.notEqual(first.npc?.personaSalt, second.npc?.personaSalt);
  assert.deepEqual(firstTargets.map(({ id, ownerId, coordinate, raceId, resources }) => ({ id, ownerId, coordinate, raceId, resources })),
    secondTargets.map(({ id, ownerId, coordinate, raceId, resources }) => ({ id, ownerId, coordinate, raceId, resources })));
  assert.notDeepEqual(firstTargets.map(({ ownerId, ownerName }) => [ownerId, ownerName]),
    secondTargets.map(({ ownerId, ownerName }) => [ownerId, ownerName]));
  assert.ok(first.npc && second.npc);
  assert.ok(firstTargets.some(({ ownerId }) => first.npc!.profiles[ownerId]?.privateSeed !== second.npc!.profiles[ownerId]?.privateSeed));
  assert.deepEqual(first.planets['helion-01']?.resources, second.planets['helion-01']?.resources);
  assert.equal(first.profile.factionId, second.profile.factionId);
});

test('save and reload preserve private NPC profiles, active sessions, and event cursors', () => {
  const storage = memoryStorage();
  const facade = createPersistenceFacade({ mode: 'production', storage, now: () => NOW });
  const initial = createInitialSaveState('production', NOW, config('NPCRELOAD1'));
  const ownerId = npcOwnerTargets(initial)[0]!.ownerId;
  const originalProfile = initial.npc!.profiles[ownerId]!;
  const preservedProfile = {
    ...originalProfile,
    activity: { ...originalProfile.activity, propensity: 0.123, completedSessions: 9, updatedAt: NOW + 1_000 },
    session: { timezoneOffsetMinutes: 180, active: true, sessionStartedAt: NOW, sessionEndsAt: NOW + 45 * 60_000, lastBoundaryAt: NOW },
    cursor: { at: NOW + 1_000, priority: 'npc-decision' as const, eventId: `decision:${ownerId}:1` },
  };
  const state: SaveState = {
    ...initial,
    npc: { ...initial.npc!, profiles: { ...initial.npc!.profiles, [ownerId]: preservedProfile } },
  };

  assert.equal(facade.write(state).ok, true);
  const loaded = facade.load();
  assert.equal(loaded.status, 'loaded');
  assert.deepEqual(jsonValue(loaded.state.npc!.profiles[ownerId]), jsonValue(preservedProfile));
  assert.equal(loaded.state.npc?.personaSalt, initial.npc?.personaSalt);
});

function legacyFlight(state: SaveState): FlightRecord {
  const target = npcOwnerTargets(state)[0]!;
  return {
    id: 'flight-legacy-spy-1',
    requestId: 'legacy-spy-request-1',
    ownerSide: 'player',
    missionId: 'espionage',
    spyMissionId: 'spy-legacy-1',
    originPlanetId: state.currentPlanetId,
    originCoordinate: { galaxy: 1, system: 1, position: 1 },
    destination: { kind: 'planet', planetId: target.id, coordinate: target.coordinate },
    destinationPlanetId: target.id,
    destinationOwnerId: target.ownerId,
    targetKind: 'npc',
    targetRelation: 'enemy',
    destinationCoordinate: target.coordinate,
    selectedShips: { 'spy-probe': 1 },
    selectedCommanders: {},
    populationReserved: 1,
    routeDistance: 1,
    effectiveSpeed: 1,
    oneWayDurationMs: 60_000,
    departedAt: NOW,
    arrivalAt: NOW + 60_000,
    gasCost: 0,
    phase: 'outbound',
  };
}

test('schema 24 Production and Test saves migrate deterministically without losing live state', () => {
  for (const mode of ['production', 'test'] as const) {
    const initial = createInitialSaveState(mode, NOW, mode === 'production' ? config(`NPCLEGACY${mode}`, 12) : undefined);
    const target = npcOwnerTargets(initial)[0]!;
    const flight = legacyFlight(initial);
    const queued = {
      kind: 'building' as const,
      id: `legacy-build-${mode}`,
      assetRole: 'basic-energy' as const,
      planetId: 'helion-01',
      enqueuedAt: NOW,
      startedAt: NOW,
      finishAt: NOW + 90_000,
      targetLevel: 1,
      durationMs: 90_000,
    };
    const oldSave = {
      ...initial,
      schemaVersion: 24,
      queues: { ...initial.queues, 'helion-01': [queued] },
      flights: { records: [flight], requestIndex: { [flight.requestId]: flight.id } },
    } as unknown as Record<string, unknown>;
    delete oldSave.npc;
    const raw = JSON.stringify(oldSave);

    const loadAt = (timestamp: number) => {
      const storage = memoryStorage();
      const saveKey = `legacy-${mode}`;
      storage.setItem(saveKey, raw);
      return createPersistenceFacade({ mode, storage, saveKey, now: () => timestamp }).load();
    };
    const first = loadAt(NOW + 1_000);
    const later = loadAt(NOW + 30 * 24 * 60 * 60_000);
    assert.equal(first.status, 'loaded', `${mode} legacy save should load`);
    assert.equal(later.status, 'loaded', `${mode} legacy save should load at a later timestamp`);
    assert.equal(first.state.schemaVersion, SAVE_SCHEMA_VERSION);
    assert.deepEqual(jsonValue(first.state.npc), jsonValue(later.state.npc), 'legacy NPC migration must not depend on load time');
    assert.equal(first.state.npc?.personaSalt, later.state.npc?.personaSalt);
    assert.deepEqual(first.state.planets['helion-01']?.resources, initial.planets['helion-01']?.resources);
    assert.equal(first.state.queues['helion-01']?.[0]?.id, queued.id);
    assert.equal(first.state.queues['helion-01']?.[0]?.assetRole, queued.assetRole);
    assert.equal(first.state.flights.records[0]?.id, flight.id);
    assert.equal(first.state.flights.records[0]?.destinationPlanetId, flight.destinationPlanetId);
    const migratedTarget = first.state.espionage?.targets?.[target.id];
    assert.ok(migratedTarget, `${mode} legacy espionage target survives`);
    assert.deepEqual(migratedTarget.resources, target.resources);
  }
});

test('NPCs without online sessions issue no new commands across elapsed time', () => {
  const initial = createInitialSaveState('production', NOW, config('NPCNOAUTO1', 12));
  const state: SaveState = {
    ...initial,
    npc: { ...initial.npc!, profiles: Object.fromEntries(Object.entries(initial.npc!.profiles).map(([id, profile]) =>
      [id, { ...profile, activity: { ...profile.activity, propensity: 0 } }])) },
    exploration: { ...createExplorationState(), ...initial.exploration, npcProcessedAt: NOW },
    pirate: { ...createDefaultPirateState(), ...initial.pirate, raidProcessedAt: NOW },
  };
  const beforeNpcFlights = state.flights.records.filter((flight) => flight.ownerSide === 'npc');
  const reconciled = reconcileRuntime(state, {
    planetId: state.currentPlanetId,
    now: NOW + 6 * 60 * 60_000,
    mode: 'production',
    testTimeScale: 1,
  }).state;

  assert.deepEqual(jsonValue(reconciled.npc), jsonValue(state.npc));
  assert.deepEqual(reconciled.flights.records.filter((flight) => flight.ownerSide === 'npc'), beforeNpcFlights);
});

test('public owner/save summaries and pirate analysis do not expose or depend on private NPC state', () => {
  const state = createInitialSaveState('production', NOW, config('NPCPRIVATE1', 12));
  const target = npcOwnerTargets(state)[0]!;
  const changedNpc = {
    ...state.npc!,
    personaSalt: 'different-private-salt',
    profiles: Object.fromEntries(Object.entries(state.npc!.profiles).map(([ownerId, profile]) => [ownerId, {
      ...profile,
      privateSeed: `other:${ownerId}`,
      traits: Object.fromEntries(Object.keys(profile.traits).map((trait) => [trait, 0.5])),
    }])),
  };
  const privateVariant = { ...state, npc: changedNpc } as SaveState;

  assert.deepEqual(createSpyTargetOwnerProfile(target), createSpyTargetOwnerProfile({ ...target }));
  assert.deepEqual(describeSave(state, NOW), describeSave(privateVariant, NOW));
  assert.deepEqual(buildPirateBattleAnalysisExport(state, NOW), buildPirateBattleAnalysisExport(privateVariant, NOW));
  const ordinaryOutput = JSON.stringify({
    owner: createSpyTargetOwnerProfile(target),
    slot: describeSave(state, NOW),
    pirateAnalysis: buildPirateBattleAnalysisExport(state, NOW),
  });
  assert.equal(ordinaryOutput.includes(state.npc!.personaSalt), false);
  assert.equal(ordinaryOutput.includes(state.npc!.profiles[target.ownerId]!.privateSeed), false);
});

test('full save backup exports retain the NPC foundation', () => {
  const storage = memoryStorage();
  const state = createInitialSaveState('production', NOW, config('NPCBACKUP1', 12));
  const created = createSlot(state, 'NPC backup', { storage, now: NOW, random: () => 0.4 });
  assert.equal(created.ok, true);
  const exported = exportSaveSlot(created.slot!.id, storage, NOW + 1_000);
  assert.equal(exported.ok, true);
  const envelope = JSON.parse(exported.ok ? exported.text : '{}') as { save: Record<string, unknown> };
  assert.deepEqual(jsonValue(envelope.save.npc), jsonValue(state.npc));
});

test('future or malformed nested NPC state is rejected and its original bytes remain untouched', () => {
  const state = createInitialSaveState('production', NOW, config('NPCBADSTATE1', 12));
  const ownerId = npcOwnerTargets(state)[0]!.ownerId;
  const profile = state.npc!.profiles[ownerId]!;
  const invalidVariants = [
    { ...state.npc!, version: 2 },
    { ...state.npc!, profiles: { ...state.npc!.profiles, [ownerId]: { ...profile, session: { ...profile.session, timezoneOffsetMinutes: 999 } } } },
  ];

  for (const npc of invalidVariants) {
    const storage = memoryStorage();
    const saveKey = 'malformed-npc-save';
    const raw = JSON.stringify({ ...state, npc });
    storage.setItem(saveKey, raw);
    const facade = createPersistenceFacade({ mode: 'production', storage, saveKey, now: () => NOW + 1_000 });
    assert.equal(facade.load().status, 'malformed');
    assert.equal(facade.write(state).ok, false);
    assert.equal(storage.getItem(saveKey), raw, 'a failed load or autosave must not alter the original payload bytes');
  }
});
