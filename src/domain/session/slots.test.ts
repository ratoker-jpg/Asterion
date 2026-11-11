import assert from 'node:assert/strict';
import test from 'node:test';

import {
  LEGACY_PRODUCTION_SAVE_KEY,
  LEGACY_SLOT_ID,
  SLOT_INDEX_KEY,
  activateSlot,
  createEmptySlotIndex,
  migrateLegacySave,
  normalizeSlotIndex,
  parseSlotImport,
  removeSlot,
  renameSlot,
  retireSlot,
  selectContinueSlot,
  type SaveSlotMeta,
} from './slots.ts';
import {
  createSlot,
  deleteSaveSlot,
  duplicateSaveSlot,
  exportSaveSlot,
  importSaveSlot,
  inspectSlot,
  readSlotIndex,
  renameSaveSlot,
  retireSaveSlot,
  type SlotStorage,
} from '../../application/slots.ts';
import { createInitialSaveState, createPersistenceFacade, SAVE_SCHEMA_VERSION } from '../../application/persistence.ts';
import { createDefaultNewGameConfig } from '../world/config.ts';
import { setActiveProductionSaveKey } from '../runtime/mode.ts';

function memoryStorage(seed: Record<string, string> = {}): SlotStorage & { data: Map<string, string> } {
  const data = new Map(Object.entries(seed));
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => { data.set(key, String(value)); },
    removeItem: (key) => { data.delete(key); },
  };
}

function meta(id: string, updatedAt: number): SaveSlotMeta {
  return {
    id, name: id, createdAt: 0, updatedAt, playTimeMs: 0, factionId: 'aegis', playerName: 'P', campaignSpeed: 'standard',
    schemaVersion: 24, storageKey: `asterion.slot.${id}.v1`, mode: 'production',
    summary: { planets: 1, npcCount: 0, galaxyCount: 1, days: 0, crystals: 0, victory: false },
  };
}

test('index helpers: rename, remove, activate, continue picks the active then the newest slot', () => {
  let index = { ...createEmptySlotIndex(), slots: [meta('slot-a', 10), meta('slot-b', 20)] };
  assert.equal(selectContinueSlot(index)?.id, 'slot-b');
  index = activateSlot(index, 'slot-a');
  assert.equal(selectContinueSlot(index)?.id, 'slot-a');
  index = renameSlot(index, 'slot-a', '  Моя   кампания ', 30);
  assert.equal(index.slots[0]!.name, 'Моя кампания');
  index = removeSlot(index, 'slot-a');
  assert.equal(index.activeSlotId, null);
  assert.equal(index.slots.length, 1);
  assert.deepEqual(normalizeSlotIndex({ slots: [{ id: 'bad id' }, meta('slot-c', 1), meta('slot-c', 2)] }).slots.map((slot) => slot.id), ['slot-c']);
});

test('the legacy single save becomes a slot once, keeping its own key', () => {
  const index = migrateLegacySave(createEmptySlotIndex(), '{"planets":{}}', () => ({ ...meta('x', 5), id: undefined } as never));
  assert.equal(index.slots[0]!.id, LEGACY_SLOT_ID);
  assert.equal(index.slots[0]!.storageKey, LEGACY_PRODUCTION_SAVE_KEY);
  assert.equal(index.activeSlotId, LEGACY_SLOT_ID);
  assert.equal(migrateLegacySave(index, '{"planets":{}}', () => null), index, 'idempotent');
  assert.equal(migrateLegacySave(createEmptySlotIndex(), null, () => null).slots.length, 0);
});

test('reading slots migrates an existing legacy save without copying or deleting it', () => {
  const legacy = createInitialSaveState('production', 1_000);
  const raw = JSON.stringify(legacy);
  const storage = memoryStorage({ [LEGACY_PRODUCTION_SAVE_KEY]: raw });
  const index = readSlotIndex(storage, 2_000);
  assert.equal(index.slots.length, 1);
  assert.equal(index.slots[0]!.name, 'Прежнее сохранение');
  assert.equal(storage.getItem(LEGACY_PRODUCTION_SAVE_KEY), raw);
  assert.ok(storage.getItem(SLOT_INDEX_KEY));
  assert.equal(readSlotIndex(storage, 3_000).slots.length, 1);
});

test('new slot, autosave into the active slot only, duplicate, rename, export/import, delete', () => {
  const storage = memoryStorage();
  const config = createDefaultNewGameConfig({ seed: 'SLOTTEST', factionId: 'veyra', playerName: 'Рой-Командир' });
  const state = createInitialSaveState('production', 5_000, config);
  const created = createSlot(state, 'Кампания Роя', { storage, now: 5_000, random: () => 0.5 });
  assert.equal(created.ok, true);
  const slot = created.ok ? created.slot! : null!;
  assert.equal(slot.factionId, 'veyra');
  assert.equal(created.index.activeSlotId, slot.id);

  // The persistence facade writes the active slot's key.
  setActiveProductionSaveKey(slot.storageKey);
  try {
    const facade = createPersistenceFacade({ mode: 'production', storage, now: () => 6_000 });
    assert.equal(facade.saveKey, slot.storageKey);
    const loaded = facade.read();
    assert.equal(loaded.profile.factionId, 'veyra');
    assert.equal(loaded.profile.displayName, 'Рой-Командир');
    assert.equal(facade.write({ ...loaded, playTimeMs: 99 }).ok, true);
    assert.equal(storage.getItem(LEGACY_PRODUCTION_SAVE_KEY), null, 'nothing leaks into the legacy key');
  } finally {
    setActiveProductionSaveKey(null);
  }

  assert.equal(duplicateSaveSlot(slot.id, { storage, now: 7_000, random: () => 0.25 }).index.slots.length, 2);
  assert.equal(renameSaveSlot(slot.id, 'Переименовано', storage).index.slots.find((item) => item.id === slot.id)!.name, 'Переименовано');
  const exported = exportSaveSlot(slot.id, storage, 8_000);
  assert.equal(exported.ok, true);
  const imported = importSaveSlot(exported.ok ? exported.text : '', SAVE_SCHEMA_VERSION, { storage, now: 9_000, random: () => 0.75 });
  assert.equal(imported.ok, true);
  assert.equal(imported.index.slots.length, 3);
  assert.equal(inspectSlot(imported.slot!, SAVE_SCHEMA_VERSION, storage).status, 'ok');
  const deleted = deleteSaveSlot(slot.id, storage);
  assert.equal(deleted.index.slots.length, 2);
  assert.equal(storage.getItem(slot.storageKey), null);
});

test('imports refuse broken files and saves of a newer build', () => {
  assert.equal(parseSlotImport('{oops', 24).ok, false);
  assert.equal(parseSlotImport('{"hello":1}', 24).ok, false);
  const newer = parseSlotImport(JSON.stringify({ planets: { a: {} }, profile: {}, schemaVersion: 99 }), 24);
  assert.equal(newer.ok, false);
  assert.match(newer.ok ? '' : newer.error, /более новой версией/);
  assert.equal(parseSlotImport(JSON.stringify({ planets: { a: {} }, profile: {}, schemaVersion: 20 }), 24).ok, true);
});

test('a broken slot is reported, not thrown', () => {
  const storage = memoryStorage({ 'asterion.slot.slot-x.v1': '{not json' });
  assert.equal(inspectSlot(meta('slot-x', 1), 24, storage).status, 'broken');
  assert.equal(inspectSlot(meta('slot-y', 1), 24, storage).status, 'missing');
});

test('a new round retires the old campaign: Continue never opens it, entering it brings it back, the flag survives a reload', () => {
  let index = { ...createEmptySlotIndex(), slots: [meta('slot-a', 10), meta('slot-b', 20)] };
  index = activateSlot(index, 'slot-b');
  index = retireSlot(index, 'slot-b', 99);
  assert.equal(index.activeSlotId, null, 'a retired campaign is no longer the active one');
  assert.equal(selectContinueSlot(index)?.id, 'slot-a');
  assert.equal(retireSlot(index, 'slot-b', 100), index, 'retiring twice changes nothing');
  assert.equal(normalizeSlotIndex(JSON.parse(JSON.stringify(index))).slots.find((slot) => slot.id === 'slot-b')?.retiredAt, 99);
  assert.equal(selectContinueSlot({ ...index, slots: [index.slots[1]!] }), null, 'only past rounds left: nothing to continue');
  const back = activateSlot(index, 'slot-b');
  assert.equal(back.slots.find((slot) => slot.id === 'slot-b')?.retiredAt, undefined);
  assert.equal(selectContinueSlot(back)?.id, 'slot-b');
});

test('retiring through storage keeps the payload and leaves one live campaign', () => {
  const storage = memoryStorage();
  const first = createSlot(createInitialSaveState('production', 1_000), 'Раунд 1', { storage, now: 1_000 });
  const second = createSlot(createInitialSaveState('production', 2_000), 'Раунд 2', { storage, now: 2_000 });
  assert.ok(first.ok && second.ok && first.slot && second.slot);
  assert.ok(retireSaveSlot(first.slot.id, storage, 3_000).ok);
  const index = readSlotIndex(storage, 3_000);
  assert.equal(index.slots.filter((slot) => slot.retiredAt === undefined).length, 1);
  assert.equal(selectContinueSlot(index)?.id, second.slot.id);
  assert.notEqual(storage.getItem(first.slot.storageKey), null, 'nothing is deleted');
});
