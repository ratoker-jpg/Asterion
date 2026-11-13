import assert from 'node:assert/strict';
import test from 'node:test';

import { SAVE_BACKUP_KEEP, backupBeforeMigration, clearSaveBackups, listSaveBackups, restoreSaveBackup } from './save-backup.ts';
import { createInitialSaveState, createPersistenceFacade, loadSavedState, SAVE_SCHEMA_VERSION } from './persistence.ts';
import type { StorageLike } from './persistence.ts';

function memoryStorage(): StorageLike & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: (key) => data.get(key) ?? null, setItem: (key, value) => { data.set(key, value); }, removeItem: (key) => { data.delete(key); } };
}

const KEY = 'asterion.slot.slot-test.v1';
const NOW = 1_800_000_000_000;

test('copies are kept, the newest first, and only the last few survive', () => {
  const storage = memoryStorage();
  for (let version = 1; version <= SAVE_BACKUP_KEEP + 2; version += 1) {
    assert.ok(backupBeforeMigration(storage, KEY, `{"schemaVersion":${version}}`, version, NOW + version));
  }
  const list = listSaveBackups(storage, KEY);
  assert.equal(list.length, SAVE_BACKUP_KEEP);
  assert.deepEqual(list.map((entry) => entry.fromSchema), [5, 4, 3]);
  // the dropped copies are gone from the storage, not only from the index
  assert.equal([...storage.data.keys()].filter((key) => key.includes('.backup-')).length, SAVE_BACKUP_KEEP);
});

test('loading the same original again does not pile up copies', () => {
  const storage = memoryStorage();
  assert.ok(backupBeforeMigration(storage, KEY, '{"schemaVersion":3}', 3, NOW));
  assert.equal(backupBeforeMigration(storage, KEY, '{"schemaVersion":3}', 3, NOW + 5), null);
  assert.equal(listSaveBackups(storage, KEY).length, 1);
});

test('restore puts the copy back and keeps the replaced save as a copy; clear removes everything', () => {
  const storage = memoryStorage();
  storage.setItem(KEY, '{"schemaVersion":99,"marker":"spoiled"}');
  const entry = backupBeforeMigration(storage, KEY, '{"schemaVersion":3,"marker":"original"}', 3, NOW)!;
  const restored = restoreSaveBackup(storage, KEY, entry.key, NOW + 1);
  assert.ok(restored.ok);
  assert.match(storage.getItem(KEY) ?? '', /original/);
  assert.ok(listSaveBackups(storage, KEY).some((item) => item.fromSchema === 99), 'the replaced save is a copy too');
  assert.equal(restoreSaveBackup(storage, KEY, 'asterion.nothing', NOW).ok, false);
  clearSaveBackups(storage, KEY);
  assert.equal([...storage.data.keys()].filter((key) => key !== KEY).length, 0);
});

test('a copy that is not JSON is refused', () => {
  const storage = memoryStorage();
  const entry = backupBeforeMigration(storage, KEY, 'not json', 3, NOW)!;
  assert.equal(restoreSaveBackup(storage, KEY, entry.key, NOW).ok, false);
});

test('loading an older-format save keeps its original text before anything overwrites it', () => {
  const storage = memoryStorage();
  const facade = createPersistenceFacade({ storage, saveKey: KEY, mode: 'production' });
  assert.ok(facade.write(createInitialSaveState('production', NOW)).ok);
  const current = JSON.parse(storage.getItem(KEY)!) as Record<string, unknown>;
  const original = JSON.stringify({ ...current, schemaVersion: SAVE_SCHEMA_VERSION - 3 });
  storage.setItem(KEY, original);
  const loaded = loadSavedState({ storage, saveKey: KEY, mode: 'production', now: () => NOW });
  assert.equal(loaded.status, 'loaded');
  const backups = listSaveBackups(storage, KEY);
  assert.equal(backups.length, 1);
  assert.equal(backups[0]!.fromSchema, SAVE_SCHEMA_VERSION - 3);
  assert.equal(storage.getItem(backups[0]!.key), original, 'byte for byte the original');
  // a current-format save makes no copy
  const fresh = memoryStorage();
  const freshFacade = createPersistenceFacade({ storage: fresh, saveKey: KEY, mode: 'production' });
  freshFacade.write(createInitialSaveState('production', NOW));
  loadSavedState({ storage: fresh, saveKey: KEY, mode: 'production', now: () => NOW });
  assert.equal(listSaveBackups(fresh, KEY).length, 0);
});
