import assert from 'node:assert/strict';
import test from 'node:test';

import {
  acceptOperation,
  cancelOperation,
  createDefaultOperationsState,
  migrateOperationsState,
  persistOperationsState,
  readOperationsState,
} from './repository.ts';

class MemoryStorage {
  private values = new Map<string, string>();

  getItem(key: string) {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
}

const SAVE_KEY = 'asterion.vertical-slice.v1';
const CYCLE_ID = 'pirate:pirate-cycle-v1:1:1:0:1000';

function pirateOperation(id = CYCLE_ID, state: 'available' | 'active' | 'completed' = 'available') {
  return {
    id,
    archetype: 'pirate_elimination',
    state,
    location: { kind: 'coordinates', coordinates: '[1:1:18]' },
    rewardPreview: {},
  };
}

/** The five demo records that older saves (Test Mode) carried; they had no mechanics. */
const LEGACY_DEMO_ITEMS = [
  { id: 'op-pirate-patrol-01', archetype: 'pirate_elimination', state: 'active', intel: 2, rewardPreview: { metal: 2100, minerals: 900, gas: 300 } },
  { id: 'op-pirate-outpost-01', archetype: 'pirate_outpost', state: 'available', intel: 3, rewardPreview: { metal: 4200 } },
  { id: 'op-signal-derelict-01', archetype: 'unknown_signal', state: 'available', intel: 0, threat: null },
  { id: 'op-signal-derelict-01', archetype: 'derelict_recovery', state: 'available', intel: 3, originSignalId: 'op-signal-derelict-01' },
  { id: 'op-anomaly-01', archetype: 'anomaly_scan', state: 'available', intel: 3, rewardPreview: { minerals: 1800 } },
];

test('default operations state is empty in every mode: no demo operations without mechanics', () => {
  assert.deepEqual(createDefaultOperationsState(), { items: [] });
  assert.deepEqual(createDefaultOperationsState('test'), { items: [] });
  assert.deepEqual(createDefaultOperationsState('production'), { items: [] });
});

test('old saves drop every demo operation record and keep real pirate cycles', () => {
  for (const mode of ['test', 'production'] as const) {
    const migrated = migrateOperationsState({ items: [...LEGACY_DEMO_ITEMS, pirateOperation(CYCLE_ID, 'active')] }, mode);
    assert.deepEqual(migrated.items.map((item) => item.id), [CYCLE_ID]);
    assert.equal(migrated.items[0].state, 'active');
  }
  assert.deepEqual(migrateOperationsState({ items: LEGACY_DEMO_ITEMS }, 'test'), { items: [] });
});

test('missing or malformed operations migrate to the empty state', () => {
  assert.deepEqual(migrateOperationsState(undefined), createDefaultOperationsState());
  assert.deepEqual(migrateOperationsState({}), createDefaultOperationsState());
  assert.deepEqual(migrateOperationsState({ items: 'broken' }), createDefaultOperationsState());
  assert.deepEqual(migrateOperationsState({ items: [{ nope: true }] }), createDefaultOperationsState());
});

test('an accepted pirate operation can be cancelled back to available', () => {
  const available = migrateOperationsState({ items: [pirateOperation()] });
  const active = acceptOperation(available, CYCLE_ID);
  assert.equal(active.items[0].state, 'active');
  assert.equal(available.items[0].state, 'available');
  assert.equal(cancelOperation(active, CYCLE_ID).items[0].state, 'available');
});

test('operations survive storage reload and persisting preserves unrelated save fields', () => {
  const storage = new MemoryStorage();
  storage.setItem(SAVE_KEY, JSON.stringify({
    schemaVersion: 4,
    metal: 777,
    combat: { reports: ['keep-me'] },
    combatSimulator: { selectedFaction: 'aster' },
  }));
  const active = acceptOperation(migrateOperationsState({ items: [pirateOperation()] }), CYCLE_ID);
  const persisted = persistOperationsState(active, storage);
  const saved = JSON.parse(storage.getItem(SAVE_KEY) ?? '{}') as Record<string, unknown>;

  assert.equal(persisted.ok, true);
  assert.deepEqual(readOperationsState(storage), active);
  assert.equal(saved.schemaVersion, 4);
  assert.equal(saved.metal, 777);
  assert.deepEqual(saved.combat, { reports: ['keep-me'] });
  assert.deepEqual(saved.combatSimulator, { selectedFaction: 'aster' });
});

test('invalid state normalizes safely while duplicate ids are dropped', () => {
  const migrated = migrateOperationsState({
    items: [
      { ...pirateOperation(), state: 'expired', threat: 99, intel: 68 },
      { ...pirateOperation(), state: 'active' },
    ],
  });
  assert.equal(migrated.items.length, 1);
  assert.equal(migrated.items[0].state, 'available');
  assert.equal(migrated.items[0].intel, 2);
});

test('persisted real pirate operation retains cycle, accepted state and no demo rewards', () => {
  const accepted = { ...pirateOperation(CYCLE_ID, 'active'), rewardPreview: { metal: 2100 } };
  const migrated = migrateOperationsState({ items: [accepted] }, 'production');
  assert.equal(migrated.items.length, 1);
  const item = migrated.items[0];
  assert.equal(item.id, CYCLE_ID);
  assert.equal(item.state, 'active');
  assert.equal(item.title, 'ПИРАТСКАЯ БАЗА');
  assert.equal(item.threat, null);
  assert.deepEqual(item.rewardPreview, {});
  assert.deepEqual(item.location, { kind: 'coordinates', coordinates: '[1:1:18]' });
  assert.equal(migrateOperationsState({ items: migrated.items }, 'production').items[0].id, CYCLE_ID);
  assert.deepEqual(migrateOperationsState({ items: [{ ...accepted, id: 'pirate:wrong-cycle' }] }, 'production').items, []);
});
