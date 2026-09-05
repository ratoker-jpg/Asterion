import assert from 'node:assert/strict';
import test from 'node:test';

import {
  acceptOperation,
  cancelOperation,
  createDefaultOperationsState,
  migrateOperationsState,
  persistOperationsState,
  readOperationsState,
  revealOperation,
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

test('default state is deterministic and contains the four expected operation slots', () => {
  const first = createDefaultOperationsState();
  const second = createDefaultOperationsState();

  assert.deepEqual(first, second);
  assert.deepEqual(first.items.map((item) => [item.id, item.archetype]), [
    ['op-pirate-patrol-01', 'pirate_elimination'],
    ['op-pirate-outpost-01', 'pirate_outpost'],
    ['op-signal-derelict-01', 'unknown_signal'],
    ['op-anomaly-01', 'anomaly_scan'],
  ]);
});

test('default operation ids are unique', () => {
  const ids = createDefaultOperationsState().items.map((item) => item.id);
  assert.equal(new Set(ids).size, ids.length);
});

test('two default factories do not share mutable arrays', () => {
  const first = createDefaultOperationsState();
  const second = createDefaultOperationsState();
  first.items[0].modifiers.push('ion_storm');
  first.items[0].rewardPreview.labels = ['changed'];

  assert.notDeepEqual(first, second);
  assert.deepEqual(second, createDefaultOperationsState());
});

test('missing operations migrates to canonical defaults', () => {
  assert.deepEqual(migrateOperationsState(undefined), createDefaultOperationsState());
  assert.deepEqual(migrateOperationsState({}), createDefaultOperationsState());
});

test('malformed operations do not break migration', () => {
  assert.deepEqual(migrateOperationsState({ items: 'broken' }), createDefaultOperationsState());
  assert.deepEqual(migrateOperationsState({ items: [{ nope: true }] }), createDefaultOperationsState());
});

test('available operation can be accepted and becomes active', () => {
  const initial = createDefaultOperationsState();
  const next = acceptOperation(initial, 'op-pirate-patrol-01');

  assert.equal(next.items.find((item) => item.id === 'op-pirate-patrol-01')?.state, 'active');
  assert.equal(initial.items.find((item) => item.id === 'op-pirate-patrol-01')?.state, 'available');
});

test('active operation can be cancelled back to available without penalty metadata', () => {
  const active = acceptOperation(createDefaultOperationsState(), 'op-pirate-outpost-01');
  const next = cancelOperation(active, 'op-pirate-outpost-01');

  assert.equal(next.items.find((item) => item.id === 'op-pirate-outpost-01')?.state, 'available');
});

test('unknown signal reveal is deterministic, keeps the stable id and records traceability', () => {
  const first = revealOperation(createDefaultOperationsState(), 'op-signal-derelict-01');
  const second = revealOperation(createDefaultOperationsState(), 'op-signal-derelict-01');
  const revealed = first.items.find((item) => item.id === 'op-signal-derelict-01');

  assert.deepEqual(first, second);
  assert.equal(revealed?.archetype, 'derelict_recovery');
  assert.equal(revealed?.intel, 3);
  assert.equal(revealed?.originSignalId, 'op-signal-derelict-01');
});

test('unrevealed intel-zero signal cannot be accepted', () => {
  const initial = createDefaultOperationsState();
  const next = acceptOperation(initial, 'op-signal-derelict-01');
  assert.equal(next.items.find((item) => item.id === 'op-signal-derelict-01')?.state, 'available');
});

test('revealed state survives migration and storage reload', () => {
  const storage = new MemoryStorage();
  const revealed = revealOperation(createDefaultOperationsState(), 'op-signal-derelict-01');
  const persisted = persistOperationsState(revealed, storage);

  assert.equal(persisted.ok, true);
  assert.deepEqual(readOperationsState(storage), revealed);
});

test('persisting operations preserves unrelated save fields', () => {
  const storage = new MemoryStorage();
  storage.setItem(SAVE_KEY, JSON.stringify({
    schemaVersion: 4,
    metal: 777,
    combat: { reports: ['keep-me'] },
    combatSimulator: { selectedFaction: 'aster' },
  }));

  persistOperationsState(acceptOperation(createDefaultOperationsState(), 'op-pirate-patrol-01'), storage);
  const saved = JSON.parse(storage.getItem(SAVE_KEY) ?? '{}') as Record<string, unknown>;

  assert.equal(saved.schemaVersion, 4);
  assert.equal(saved.metal, 777);
  assert.deepEqual(saved.combat, { reports: ['keep-me'] });
  assert.deepEqual(saved.combatSimulator, { selectedFaction: 'aster' });
  assert.ok(saved.operations);
});

test('invalid intel, threat and state normalize safely while duplicate ids are dropped', () => {
  const migrated = migrateOperationsState({
    items: [
      {
        id: 'custom-pirate',
        archetype: 'pirate_elimination',
        state: 'expired',
        threat: 99,
        intel: 68,
        location: { kind: 'system', galaxy: 1, system: 7 },
        rewardPreview: { metal: -10 },
      },
      {
        id: 'custom-pirate',
        archetype: 'pirate_outpost',
        state: 'active',
        threat: 5,
        intel: 3,
      },
    ],
  });
  const operation = migrated.items[0];

  assert.equal(migrated.items.length, 1);
  assert.equal(operation.state, 'available');
  assert.equal(operation.threat, 3);
  assert.equal(operation.intel, 2);
  assert.equal(operation.rewardPreview.metal, 2100);
});
