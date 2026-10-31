import assert from 'node:assert/strict';
import test from 'node:test';

import {
  LEGACY_PRODUCTION_SAVE_KEY,
  LEGACY_SLOT_ID,
  SLOT_INDEX_KEY,
  selectContinueSlot,
  slotStorageKey,
} from '../domain/session/slots.ts';
import { inspectSavePayload } from '../domain/session/save-health.ts';
import {
  SLOT_INDEX_RESCUE_KEY,
  checkSlotEntry,
  createSlot,
  exportSaveSlot,
  importSaveSlot,
  inspectSlot,
  readSlotIndex,
  updateSlotSummary,
  writeSlotIndex,
  type SlotStorage,
} from './slots.ts';
import { createInitialSaveState, createPersistenceFacade, loadSavedState, SAVE_SCHEMA_VERSION } from './persistence.ts';
import { createDefaultNewGameConfig } from '../domain/world/config.ts';

/** localStorage stand-in with key enumeration, like the real one. */
function memoryStorage(seed: Record<string, string> = {}): SlotStorage & { data: Map<string, string> } {
  const data = new Map(Object.entries(seed));
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => { data.set(key, String(value)); },
    removeItem: (key) => { data.delete(key); },
    key: (position) => [...data.keys()][position] ?? null,
    get length() { return data.size; },
  };
}

function campaign(seed: string, now: number) {
  return createInitialSaveState('production', now, createDefaultNewGameConfig({ seed, factionId: 'aegis', playerName: 'Тест' }));
}

const BROKEN = '{broken-save-bytes-runtime}';

function futureSave(): string {
  return JSON.stringify({ ...campaign('FUTURE', 1_000), schemaVersion: SAVE_SCHEMA_VERSION + 10, futureCriticalField: { keep: true } });
}

function nullHomeworldSave(): string {
  const save = campaign('NULLHOME', 1_000) as unknown as Record<string, unknown>;
  return JSON.stringify({ ...save, planets: { ...(save.planets as Record<string, unknown>), 'helion-01': null } });
}

/** Creates a real slot, then replaces its payload with `payload`. */
function slotWithPayload(payload: string) {
  const storage = memoryStorage();
  const created = createSlot(campaign('SLOT', 1_000), 'Кампания', { storage, now: 1_000, random: () => 0.5 });
  assert.equal(created.ok, true);
  const slot = created.slot!;
  storage.setItem(slot.storageKey, payload);
  return { storage, slot };
}

test('save health distinguishes missing, valid, corrupt, newer and malformed payloads', () => {
  assert.equal(inspectSavePayload(null, SAVE_SCHEMA_VERSION).status, 'missing');
  assert.equal(inspectSavePayload(JSON.stringify(campaign('A', 1)), SAVE_SCHEMA_VERSION).status, 'valid');
  // Legacy partial saves are still migrated, not rejected.
  assert.equal(inspectSavePayload('{"metal":777}', SAVE_SCHEMA_VERSION).status, 'valid');
  assert.equal(inspectSavePayload(BROKEN, SAVE_SCHEMA_VERSION).status, 'corrupt');
  assert.equal(inspectSavePayload(futureSave(), SAVE_SCHEMA_VERSION).status, 'newer');
  assert.equal(inspectSavePayload(nullHomeworldSave(), SAVE_SCHEMA_VERSION).status, 'malformed');
  assert.equal(inspectSavePayload('[1,2]', SAVE_SCHEMA_VERSION).status, 'malformed');
  assert.equal(inspectSavePayload('{"planets":[]}', SAVE_SCHEMA_VERSION).status, 'malformed');
  assert.equal(inspectSavePayload('{"schemaVersion":"24"}', SAVE_SCHEMA_VERSION).status, 'malformed');
});

for (const [label, payload, expected] of [
  ['broken JSON', BROKEN, 'broken'],
  ['a newer schema', futureSave(), 'newer'],
  ['a null homeworld', nullHomeworldSave(), 'broken'],
] as const) {
  test(`F-01: Continue/Load/autostart refuse ${label} and the bytes stay untouched`, () => {
    const { storage, slot } = slotWithPayload(payload);
    const index = readSlotIndex(storage, 2_000);
    // «Продолжить» picks this slot by index metadata alone…
    assert.equal(selectContinueSlot(index)?.id, slot.id);
    // …but the shared entry gate refuses it.
    const entry = checkSlotEntry(slot, storage);
    assert.equal(entry.ok, false);
    assert.equal(entry.ok ? null : entry.health.status, expected);
    assert.equal(inspectSlot(slot, SAVE_SCHEMA_VERSION, storage).status, expected);

    // Even if a game screen mounted anyway, its autosave must not replace the payload.
    const facade = createPersistenceFacade({ mode: 'production', storage, saveKey: slot.storageKey, now: () => 3_000 });
    const loaded = facade.load();
    assert.notEqual(loaded.status, 'loaded');
    const write = facade.write(loaded.state);
    assert.equal(write.ok, false);
    assert.ok(!write.ok && write.unreadableSave);
    assert.equal(storage.getItem(slot.storageKey), payload, 'raw payload is byte-for-byte unchanged');

    // The raw bytes stay exportable for rescue.
    const exported = exportSaveSlot(slot.id, storage, 4_000);
    assert.equal(exported.ok, true);
    const envelope = JSON.parse(exported.ok ? exported.text : '{}') as { save: unknown };
    assert.equal(typeof envelope.save === 'string' ? envelope.save : JSON.stringify(envelope.save), typeof envelope.save === 'string' ? payload : JSON.stringify(JSON.parse(payload)));
  });
}

test('F-01: only an explicit replace overwrites an unreadable save', () => {
  const { storage, slot } = slotWithPayload(BROKEN);
  const facade = createPersistenceFacade({ mode: 'production', storage, saveKey: slot.storageKey });
  assert.equal(facade.write(campaign('NEW', 5_000)).ok, false);
  assert.equal(storage.getItem(slot.storageKey), BROKEN);
  assert.equal(facade.write(campaign('NEW', 5_000), { replaceUnreadable: true }).ok, true);
  assert.equal(loadSavedState({ mode: 'production', storage, saveKey: slot.storageKey }).status, 'loaded');
});

test('F-01: a valid slot, a legacy partial save and a fresh campaign still load and autosave', () => {
  const storage = memoryStorage();
  const created = createSlot(campaign('OK', 1_000), 'Кампания', { storage, now: 1_000, random: () => 0.1 });
  const slot = created.slot!;
  assert.deepEqual(checkSlotEntry(slot, storage), { ok: true });
  const facade = createPersistenceFacade({ mode: 'production', storage, saveKey: slot.storageKey, now: () => 2_000 });
  const loaded = facade.load();
  assert.equal(loaded.status, 'loaded');
  assert.equal(facade.write({ ...loaded.state, playTimeMs: 5 }).ok, true);
  assert.equal(facade.write({ ...loaded.state, playTimeMs: 6 }).ok, true, 'repeated autosave of its own bytes');

  const legacy = memoryStorage({ [LEGACY_PRODUCTION_SAVE_KEY]: '{"metal":777,"currentPlanetId":"helion-01"}' });
  const legacyFacade = createPersistenceFacade({ mode: 'production', storage: legacy, saveKey: LEGACY_PRODUCTION_SAVE_KEY });
  assert.equal(legacyFacade.load().status, 'loaded');
  assert.equal(legacyFacade.write(legacyFacade.read()).ok, true, 'migrated legacy save is rewritten in the current schema');

  const empty = memoryStorage();
  const emptyFacade = createPersistenceFacade({ mode: 'production', storage: empty, saveKey: slotStorageKey('slot-fresh') });
  assert.equal(emptyFacade.load().status, 'missing');
  assert.equal(emptyFacade.write(emptyFacade.read()).ok, true);
});

test('F-01: unreadable storage is a load problem, not a fresh campaign', () => {
  const storage: SlotStorage = {
    getItem: () => { throw new DOMException('denied', 'SecurityError'); },
    setItem: () => { throw new Error('should not write'); },
    removeItem: () => undefined,
  };
  const loaded = loadSavedState({ mode: 'production', storage, saveKey: 'asterion.slot.slot-x.v1' });
  assert.equal(loaded.status, 'corrupt');
  assert.equal(createPersistenceFacade({ mode: 'production', storage, saveKey: 'asterion.slot.slot-x.v1' }).write(loaded.state).ok, false);
});

test('F-01: import refuses a structurally malformed save instead of resetting it', () => {
  const storage = memoryStorage();
  const imported = importSaveSlot(nullHomeworldSave(), SAVE_SCHEMA_VERSION, { storage, now: 1_000 });
  assert.equal(imported.ok, false);
  assert.match(imported.ok ? '' : imported.error, /планеты/);
  assert.equal(readSlotIndex(storage).slots.length, 0);
});

test('F-04: a broken slot index is rebuilt from the stored payloads and kept for rescue', () => {
  const storage = memoryStorage();
  const first = createSlot(campaign('FIRST', 1_000), 'Первая', { storage, now: 1_000, random: () => 0.1 }).slot!;
  const second = createSlot(campaign('SECOND', 2_000), 'Вторая', { storage, now: 2_000, random: () => 0.2 }).slot!;
  storage.setItem(first.storageKey, BROKEN); // one of them is damaged too
  storage.setItem(SLOT_INDEX_KEY, '{broken-index');

  const index = readSlotIndex(storage, 3_000);
  assert.deepEqual(index.slots.map((slot) => slot.id).sort(), [first.id, second.id].sort());
  assert.equal(storage.getItem(SLOT_INDEX_RESCUE_KEY), '{broken-index');
  assert.equal(inspectSlot(index.slots.find((slot) => slot.id === second.id)!, SAVE_SCHEMA_VERSION, storage).status, 'ok');
  assert.equal(inspectSlot(index.slots.find((slot) => slot.id === first.id)!, SAVE_SCHEMA_VERSION, storage).status, 'broken');
  assert.equal(storage.getItem(first.storageKey), BROKEN, 'recovery never deletes payloads');

  // A new campaign afterwards keeps the old ones listed.
  const third = createSlot(campaign('THIRD', 4_000), 'Третья', { storage, now: 4_000, random: () => 0.3 });
  assert.equal(third.ok, true);
  assert.equal(readSlotIndex(storage, 5_000).slots.length, 3);
  assert.equal(storage.getItem(SLOT_INDEX_RESCUE_KEY), '{broken-index', 'the first rescue copy is not replaced');
});

test('F-04: wrong-shape index entries and orphaned payloads are listed again; duplicates are not', () => {
  const storage = memoryStorage();
  const slot = createSlot(campaign('ORPHAN', 1_000), 'Сирота', { storage, now: 1_000, random: () => 0.4 }).slot!;
  storage.setItem(SLOT_INDEX_KEY, JSON.stringify({ version: 1, activeSlotId: null, slots: [{ id: 'not a slot' }, { id: slot.id, name: 'Сирота' }, { id: slot.id, name: 'Дубль' }] }));
  const index = readSlotIndex(storage, 2_000);
  assert.deepEqual(index.slots.map((item) => item.id), [slot.id]);
  assert.ok(storage.getItem(SLOT_INDEX_RESCUE_KEY));
  assert.equal(readSlotIndex(storage, 3_000).slots.length, 1, 'stable across reads');
});

test('F-04: an unreadable legacy save is listed as broken, never re-seeded or hidden', () => {
  const storage = memoryStorage({ [LEGACY_PRODUCTION_SAVE_KEY]: BROKEN });
  const index = readSlotIndex(storage, 1_000);
  const legacy = index.slots.find((slot) => slot.id === LEGACY_SLOT_ID);
  assert.ok(legacy);
  assert.equal(inspectSlot(legacy, SAVE_SCHEMA_VERSION, storage).status, 'broken');
  assert.equal(checkSlotEntry(legacy, storage).ok, false);
  assert.equal(storage.getItem(LEGACY_PRODUCTION_SAVE_KEY), BROKEN);
});

test('the slot card counts NPC owners, not their planets; a summary cached by an older build is corrected', () => {
  const state = campaign('NPC-OWNERS', 1_000) as unknown as { espionage: { targets: Record<string, { ownerId?: string }> } };
  const owners = new Set(Object.values(state.espionage.targets).map((target) => target.ownerId).filter((id) => id?.startsWith('npc-gen-')));
  assert.ok(owners.size > 1, 'the generated world has NPC owners');
  // Grown NPCs: every owner takes two more colonies.
  const targets = { ...state.espionage.targets };
  for (const [id, target] of Object.entries(state.espionage.targets)) {
    if (!target.ownerId?.startsWith('npc-gen-')) continue;
    targets[`${id}-colony-a`] = { ...target };
    targets[`${id}-colony-b`] = { ...target };
  }
  const { storage, slot } = slotWithPayload(JSON.stringify({ ...state, espionage: { ...state.espionage, targets } }));
  const health = inspectSlot(slot, SAVE_SCHEMA_VERSION, storage);
  assert.equal(health.status, 'ok');
  assert.equal(health.status === 'ok' && health.summary?.npcCount, owners.size, 'owners, not planets');
  // The index of an older build counted planets.
  const index = readSlotIndex(storage);
  writeSlotIndex({ ...index, slots: index.slots.map((item) => ({ ...item, summary: { ...item.summary, npcCount: owners.size * 3 } })) }, storage);
  assert.equal(updateSlotSummary(slot.id, health.status === 'ok' ? health.summary! : slot.summary, storage).ok, true);
  const fixed = readSlotIndex(storage).slots.find((item) => item.id === slot.id)!;
  assert.equal(fixed.summary.npcCount, owners.size);
  assert.equal(fixed.updatedAt, slot.updatedAt, 'the correction does not touch the slot dates');
});
