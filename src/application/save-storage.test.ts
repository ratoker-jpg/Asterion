import assert from 'node:assert/strict';
import test from 'node:test';
import { createExternalizingStorage, MISSING_EXTERNAL_SAVE, readSavePointer, type DesktopSaveStore } from './save-storage.ts';
import { createPersistenceFacade, createInitialSaveState } from './persistence.ts';
import { isCurrentBuildSave } from './persistence.ts';

function memoryLocal() {
  const data = new Map<string, string>();
  return { data, getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); },
    removeItem: (key: string) => { data.delete(key); }, key: (index: number) => [...data.keys()][index] ?? null, get length() { return data.size; } };
}

function memoryStore() {
  const files = new Map<string, string>();
  let reads = 0;
  const store: DesktopSaveStore = {
    read: (key, writeId) => { reads += 1; return files.get(`${key}.${writeId}`) ?? null; },
    write: (key, writeId, text) => { files.set(`${key}.${writeId}`, text); },
    remove: (key) => { for (const name of [...files.keys()]) if (name.startsWith(`${key}.`)) files.delete(name); },
  };
  return { files, store, reads: () => reads };
}

test('long values go to the desktop store behind a small pointer; short ones stay in localStorage', () => {
  const local = memoryLocal();
  const { files, store, reads } = memoryStore();
  const storage = createExternalizingStorage(local, store, 1_000);
  storage.setItem('asterion.slot.slot-a.v1', 'x'.repeat(10));
  assert.equal(local.data.get('asterion.slot.slot-a.v1'), 'x'.repeat(10));
  assert.equal(files.size, 0);

  const big = 'y'.repeat(5_000);
  storage.setItem('asterion.slot.slot-a.v1', big);
  const pointer = readSavePointer(local.data.get('asterion.slot.slot-a.v1')!);
  assert.ok(pointer, 'localStorage keeps a pointer');
  assert.ok(local.data.get('asterion.slot.slot-a.v1')!.length < 200);
  assert.equal(pointer!.chars, big.length);
  assert.equal(storage.getItem('asterion.slot.slot-a.v1'), big);
  assert.equal(reads(), 0, 'the newest value is served from memory');

  // Another window (a fresh storage over the same local data) reads the file.
  const other = createExternalizingStorage(local, store, 1_000);
  assert.equal(other.getItem('asterion.slot.slot-a.v1'), big);
  assert.equal(reads(), 1);

  // Shrinking back moves the value home and drops the file.
  storage.setItem('asterion.slot.slot-a.v1', 'z');
  assert.equal(local.data.get('asterion.slot.slot-a.v1'), 'z');
  assert.equal(files.size, 0);
  storage.setItem('asterion.slot.slot-a.v1', big);
  storage.removeItem('asterion.slot.slot-a.v1');
  assert.equal(storage.getItem('asterion.slot.slot-a.v1'), null);
  assert.equal(files.size, 0);
  assert.equal(storage.length, 0);
});

test('a missing or truncated file reads as an unreadable save, never as no save or a different one', () => {
  const local = memoryLocal();
  const { files, store } = memoryStore();
  const writer = createExternalizingStorage(local, store, 10);
  writer.setItem('asterion.k', 'a'.repeat(50));
  const [name] = [...files.keys()];
  files.set(name!, 'a'.repeat(49));
  assert.equal(createExternalizingStorage(local, store, 10).getItem('asterion.k'), MISSING_EXTERNAL_SAVE);
  files.clear();
  assert.equal(createExternalizingStorage(local, store, 10).getItem('asterion.k'), MISSING_EXTERNAL_SAVE);
  // The save guard keeps it: a write over it is refused, not a silent fresh campaign.
  const facade = createPersistenceFacade({ mode: 'production', storage: createExternalizingStorage(local, store, 10), saveKey: 'asterion.k' });
  assert.notEqual(facade.load().status, 'missing');
  assert.equal(facade.write(createInitialSaveState('production', Date.UTC(2026, 0, 1))).ok, false);
});

test('a save written through the desktop store loads back identical and keeps the writer marker check', () => {
  const local = memoryLocal();
  const { store } = memoryStore();
  const storage = createExternalizingStorage(local, store, 1_000);
  const facade = createPersistenceFacade({ mode: 'production', storage, saveKey: 'asterion.slot.slot-b.v1', now: () => Date.UTC(2026, 0, 1) });
  const state = createInitialSaveState('production', Date.UTC(2026, 0, 1));
  assert.equal(facade.write(state).ok, true);
  assert.ok(readSavePointer(local.data.get('asterion.slot.slot-b.v1')!), 'the save went to the store');
  assert.equal(isCurrentBuildSave(local.data.get('asterion.slot.slot-b.v1')!), true, 'storage events still see a current-build write');
  const loaded = facade.load();
  assert.equal(loaded.status, 'loaded');
  // A second write passes the "do not overwrite an unreadable save" check.
  assert.equal(facade.write(loaded.state).ok, true);
});
