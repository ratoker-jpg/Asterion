import assert from 'node:assert/strict';
import test from 'node:test';

import { createDefaultNewGameConfig } from '../domain/world/config.ts';
import { createNpcState } from '../domain/npc/state.ts';
import { NPC_CALENDAR_DAY_MS } from '../domain/npc/calendar.ts';
import { UNIVERSE_NPC_OWNER_ID } from '../domain/universe/runtime.ts';
import { createInitialSaveState, createPersistenceFacade, SAVE_SCHEMA_VERSION } from './persistence.ts';
import { isNpcCatchupPending } from './npc-catchup.ts';
import { reconcileRuntime } from './reconcile.ts';
import type { SaveState } from './contracts.ts';
import type { SlotStorage } from './slots.ts';

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

function productionState() {
  const config = createDefaultNewGameConfig({ seed: 'NPCSCIENCE27', factionId: 'aegis', playerName: 'Тестовый командир' });
  return createInitialSaveState('production', NOW, config);
}

function npcResourceBalances(state: SaveState): Record<string, unknown> {
  return Object.fromEntries(Object.entries(state.espionage?.targets ?? {}).map(([targetId, target]) => [
    targetId,
    target.resources,
  ]));
}

test('schema 26 migration merges legacy science by owner and activates after pending replay', () => {
  const initial = productionState();
  const targets = Object.values(initial.espionage?.targets ?? {});
  assert.ok(targets.length >= 2);
  const first = targets[0]!;
  const sameOwnerSecond = targets[1]!;
  const ownerId = first.ownerId;
  const legacyTargets = {
    ...initial.espionage!.targets,
    [first.id]: { ...first, ownerProfile: { scienceLevels: { 5: 2 }, shipLevels: {}, commanderLevels: {} } },
    [sameOwnerSecond.id]: { ...sameOwnerSecond, ownerId, ownerProfile: { scienceLevels: { 5: 7, 10: 3 }, shipLevels: {}, commanderLevels: {} } },
  };
  const legacy = {
    ...initial,
    schemaVersion: 26,
    npcScience: undefined,
    resourceClock: { ...initial.resourceClock, lastReconciledAt: NOW + 1_000 },
    npcReplay: { version: 1 as const, processedThroughAt: NOW + 1_000, targetAt: NOW + 5_000 },
    espionage: { ...initial.espionage!, targets: legacyTargets },
  } as unknown as SaveState;
  const storage = memoryStorage();
  const saveKey = 'legacy-npc-science';
  storage.setItem(saveKey, JSON.stringify(legacy));
  const loaded = createPersistenceFacade({ mode: 'production', storage, saveKey, now: () => NOW + 100_000 }).load();

  assert.equal(loaded.status, 'loaded');
  if (loaded.status !== 'loaded') return;
  assert.equal(loaded.state.schemaVersion, SAVE_SCHEMA_VERSION);
  assert.equal(loaded.state.npcScience?.activatedAt, NOW + 5_000);
  assert.equal(loaded.state.npcScience?.owners[ownerId]?.levels[5], 7);
  assert.equal(loaded.state.npcScience?.owners[ownerId]?.levels[10], 3);
  assert.deepEqual(loaded.state.npcScience?.owners[ownerId]?.queue, []);
  for (const target of Object.values(loaded.state.espionage?.targets ?? {}).filter((item) => item.ownerId === ownerId)) {
    assert.equal(target.ownerProfile?.scienceLevels[5], 7, 'all owner targets are projected from the canonical ledger during load');
    assert.equal(target.ownerProfile?.scienceLevels[10], 3);
  }
  assert.ok(loaded.state.npcScience?.owners[targets[0]!.ownerId]);
});

test('fresh campaigns create an active owner science ledger at the creation timestamp', () => {
  const state = productionState();
  assert.equal(SAVE_SCHEMA_VERSION, 28);
  assert.equal(state.npcScience?.version, 1);
  assert.equal(state.npcScience?.activatedAt, NOW);
  assert.deepEqual(Object.keys(state.npcScience?.owners ?? {}).sort(), Object.keys(state.npc?.profiles ?? {}).sort());
  for (const science of Object.values(state.npcScience?.owners ?? {})) {
    assert.deepEqual(science.queue, []);
  }
  const testMode = createInitialSaveState('test', NOW);
  assert.equal(testMode.npcScience?.owners[UNIVERSE_NPC_OWNER_ID], undefined);
});

test('schema 27 requires a valid ledger and preserves malformed original bytes', () => {
  const state = productionState();
  const ownerId = Object.keys(state.npcScience?.owners ?? {})[0]!;
  const planetId = Object.values(state.espionage?.targets ?? {}).find((target) => target.ownerId === ownerId)!.id;
  const baseScience = state.npcScience!.owners[ownerId]!;
  const validTask = {
    id: 'valid-science-task', scienceId: 1, planetId, fromLevel: 0, toLevel: 1,
    startedAt: NOW, finishAt: NOW + 1_000, durationMs: 1_000,
    cost: { metal: 1, minerals: 1, gas: 0, energy: 0 },
  };
  const withQueue = (queue: unknown[]) => ({ ...state.npcScience!, owners: {
    ...state.npcScience!.owners, [ownerId]: { ...baseScience, queue },
  } }) as unknown as SaveState['npcScience'];
  const cases = [
    { ...state, npcScience: undefined },
    { ...state, npcScience: { ...state.npcScience!, version: 2 } },
    { ...state, npcScience: { ...state.npcScience!, activatedAt: -1 } },
    { ...state, npcScience: { ...state.npcScience!, owners: { broken: { levels: {}, queue: 'bad' } } } },
    { ...state, npcScience: withQueue(Array.from({ length: 4 }, (_, index) => ({ ...validTask, id: `task-${index}` }))) },
    { ...state, npcScience: withQueue([{ ...validTask, planetId: '  ' }]) },
    { ...state, npcScience: withQueue([{ ...validTask, scienceId: '1' }]) },
    { ...state, npcScience: withQueue([{ ...validTask, finishAt: NOW + 1_001 }]) },
    { ...state, npcScience: withQueue([{ ...validTask, fromLevel: 1, toLevel: 2 }]) },
    { ...state, npcScience: withQueue([{ ...validTask, id: 'same' }, { ...validTask, id: 'same', startedAt: NOW + 1_000, finishAt: NOW + 2_000 }]) },
    { ...state, npcScience: withQueue([{ ...validTask }, { ...validTask, id: 'out-of-order', startedAt: NOW + 999, finishAt: NOW + 1_999 }]) },
    { ...state, npcScience: { ...state.npcScience!, owners: { [ownerId]: {
      ...baseScience, levels: { ...baseScience.levels, 1: 11 }, queue: [],
    } } } },
    { ...state, npcScience: { ...state.npcScience!, owners: { [ownerId]: {
      ...baseScience, levels: { ...baseScience.levels, 18: 1, 19: 1 }, queue: [],
    } } } },
    { ...state, npcScience: withQueue([{ ...validTask, scienceId: 18 }, { ...validTask, id: 'other-direction', scienceId: 19, startedAt: NOW + 1_000, finishAt: NOW + 2_000 }]) },
  ];

  for (const payload of cases) {
    const storage = memoryStorage();
    const saveKey = 'malformed-npc-science';
    const raw = JSON.stringify(payload);
    storage.setItem(saveKey, raw);
    const facade = createPersistenceFacade({ mode: 'production', storage, saveKey, now: () => NOW + 1_000 });
    assert.equal(facade.load().status, 'malformed');
    assert.equal(facade.write(state).ok, false);
    assert.equal(storage.getItem(saveKey), raw);
  }
});

test('schema 26 partial month catch-up activates NPC science only at its frozen target', () => {
  const day = NPC_CALENDAR_DAY_MS;
  const day1 = NOW + day;
  const day30 = NOW + 30 * day;
  const config = createDefaultNewGameConfig({ seed: 'NPCSCIENCE30D', factionId: 'aegis', playerName: 'Тестовый командир' });
  const initial = createInitialSaveState('production', NOW, { ...config, world: { ...config.world, npcCount: 1 } });
  const ownerId = Object.keys(initial.npc!.profiles)[0]!;
  const foundation = createNpcState([ownerId], 'npc-science-migration-v26-v1', NOW);
  const deterministicNpc = {
    ...foundation,
    profiles: {
      ...foundation.profiles,
      [ownerId]: { ...foundation.profiles[ownerId]!, activity: { ...foundation.profiles[ownerId]!.activity, propensity: 1 } },
    },
  };
  const { npcScience: _legacyMissingScience, ...initialWithoutScience } = initial;
  let prefix = {
    ...initialWithoutScience,
    schemaVersion: 26,
    npc: deterministicNpc,
    asteroidSimulation: undefined,
    exploration: { ...initial.exploration!, npcProcessedAt: day30 },
    pirate: { ...initial.pirate!, raidProcessedAt: day30 },
    npcReplay: { version: 1 as const, processedThroughAt: NOW, targetAt: NOW },
  } as SaveState;

  let prefixGuard = 0;
  while (prefix.npcReplay!.processedThroughAt < day1 || isNpcCatchupPending(prefix)) {
    const result = reconcileRuntime(prefix, {
      planetId: prefix.currentPlanetId,
      now: day1,
      mode: 'production',
      testTimeScale: 1,
    });
    assert.ok(result.state.npcReplay!.processedThroughAt > prefix.npcReplay!.processedThroughAt,
      'legacy NPC replay advances its committed prefix');
    prefix = result.state;
    assert.ok(++prefixGuard < 1_000, 'one day prefix catch-up stays bounded');
  }
  assert.ok(prefix.npc!.profiles[ownerId]!.cursor, 'the v26 prefix committed a real NPC replay cursor');
  assert.equal(prefix.npcScience, undefined, 'the simulated v26 prefix has no owner science ledger');

  const pendingV26: SaveState = {
    ...prefix,
    schemaVersion: 26,
    npcScience: undefined,
    npcReplay: { version: 1, processedThroughAt: day1, targetAt: day30 },
  };
  const storage = memoryStorage();
  const saveKey = 'legacy-npc-science-month-catchup';
  storage.setItem(saveKey, JSON.stringify(pendingV26));
  const facade = createPersistenceFacade({ mode: 'production', storage, saveKey, now: () => day30 });
  const loaded = facade.load();
  assert.equal(loaded.status, 'loaded');
  if (loaded.status !== 'loaded') return;

  const migrated = loaded.state;
  assert.equal(migrated.npcScience?.activatedAt, day30, 'the frozen replay target wins over the old resource clock');
  assert.deepEqual(migrated.npc?.profiles[ownerId]?.cursor, prefix.npc?.profiles[ownerId]?.cursor,
    'migration retains the already committed day-one event cursor');
  assert.deepEqual(migrated.npcScience?.owners[ownerId]?.queue, []);
  assert.ok(Object.values(migrated.npcScience?.owners[ownerId]?.levels ?? {}).every((level) => level === 0));

  let state = migrated;
  let drainGuard = 0;
  while (isNpcCatchupPending(state) || state.npcReplay!.processedThroughAt < day30) {
    const result = reconcileRuntime(state, {
      planetId: state.currentPlanetId,
      now: day30,
      mode: 'production',
      testTimeScale: 1,
    });
    for (const event of result.events) {
      if (event.kind !== 'npc-economy') continue;
      for (const emission of event.events) {
        if (emission.at < day30) {
          assert.equal(emission.selectedScienceId ?? null, null, 'pre-activation decisions cannot select science');
          assert.notEqual(emission.selectedRole, 'research', 'pre-activation decisions cannot buy a research lab');
        }
      }
    }
    assert.ok(result.state.npcReplay!.processedThroughAt > state.npcReplay!.processedThroughAt,
      'month catch-up commits another bounded replay prefix');
    state = result.state;
    assert.ok(++drainGuard < 1_000, `thirty day catch-up stays bounded (${state.npcReplay!.processedThroughAt} / ${day30})`);
  }
  assert.equal(state.npcReplay?.processedThroughAt, day30);
  assert.equal(state.npcReplay?.targetAt, day30);
  assert.ok((state.npc?.profiles[ownerId]?.cursor?.at ?? 0) >= day1,
    'catch-up advances from the cursor committed before migration');
  assert.deepEqual(state.npcScience?.owners[ownerId]?.queue, []);
  assert.ok(Object.values(state.npcScience?.owners[ownerId]?.levels ?? {}).every((level) => level === 0));

  const balancesAfterCatchup = npcResourceBalances(state);
  assert.equal(facade.write(state).ok, true);
  const reloaded = facade.load();
  assert.equal(reloaded.status, 'loaded');
  if (reloaded.status !== 'loaded') return;
  assert.equal(reloaded.state.npcScience?.activatedAt, day30, 'reload keeps the first activation timestamp');
  assert.deepEqual(npcResourceBalances(reloaded.state), balancesAfterCatchup,
    'loading and writing the same drained prefix does not credit NPC resources twice');
  assert.deepEqual(reloaded.state.npcScience?.owners[ownerId]?.queue, []);
  assert.ok(Object.values(reloaded.state.npcScience?.owners[ownerId]?.levels ?? {}).every((level) => level === 0));
  assert.equal(facade.write(reloaded.state).ok, true);
  const repeatedReload = facade.load();
  assert.equal(repeatedReload.status, 'loaded');
  if (repeatedReload.status !== 'loaded') return;
  assert.equal(repeatedReload.state.npcScience?.activatedAt, day30);
  assert.deepEqual(npcResourceBalances(repeatedReload.state), balancesAfterCatchup);
});
