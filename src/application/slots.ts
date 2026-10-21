import {
  LEGACY_PRODUCTION_SAVE_KEY,
  LEGACY_SLOT_ID,
  MAX_SAVE_SLOTS,
  SLOT_INDEX_KEY,
  activateSlot,
  createEmptySlotIndex,
  createSlotExport,
  createSlotId,
  migrateLegacySave,
  normalizeSlotIndex,
  parseSlotImport,
  removeSlot,
  renameSlot,
  slotStorageKey,
  upsertSlot,
  type SaveSlotIndex,
  type SaveSlotMeta,
  type SaveSlotSummary,
} from '../domain/session/slots.ts';
import { isGeneratedNpcOwnerId } from '../domain/world/generator.ts';
import type { PlayerFactionId } from '../domain/profile/types.ts';
import type { CampaignSpeed } from '../domain/runtime/mode.ts';
import type { SaveState } from './contracts.ts';

export type SlotStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export type SlotWriteResult = { ok: true; index: SaveSlotIndex } | { ok: false; error: string; index: SaveSlotIndex };

function resolveStorage(storage?: SlotStorage | null): SlotStorage | null {
  if (storage !== undefined) return storage;
  return typeof window === 'undefined' ? null : window.localStorage;
}

function errorText(error: unknown): string {
  if (error instanceof Error && /quota/i.test(error.name + error.message)) return 'Недостаточно места в локальном хранилище.';
  return error instanceof Error ? error.message : String(error);
}

const FACTIONS: readonly PlayerFactionId[] = ['aegis', 'synod', 'veyra'];
const SPEEDS: readonly CampaignSpeed[] = ['slow', 'standard', 'fast'];
const DAY_MS = 24 * 60 * 60 * 1000;

type LooseSave = Partial<Record<keyof SaveState, unknown>> & Record<string, unknown>;

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

/** Slot card data read from a raw save; never throws, `null` for unreadable payloads. */
export function describeSave(save: LooseSave, now: number): Omit<SaveSlotMeta, 'id' | 'name' | 'storageKey' | 'mode'> | null {
  const profile = record(save.profile);
  const planets = record(save.planets);
  if (!Object.keys(planets).length) return null;
  const world = record(record(save.worldConfig).world);
  const espionage = record(save.espionage);
  const targets = Object.values(record(espionage.targets)).map(record);
  const sunRaid = record(save.sunRaid);
  const playerId = typeof profile.playerId === 'string' ? profile.playerId : '';
  const allianceId = typeof profile.allianceId === 'string' ? profile.allianceId : '';
  const ownCrystalLists = Object.entries(record(sunRaid.crystals))
    .filter(([key]) => key === `owner:${playerId}` || (allianceId && key === `alliance:${allianceId}`))
    .map(([, list]) => (Array.isArray(list) ? list.length : 0));
  const createdAt = typeof save.createdAt === 'number' ? save.createdAt : now;
  const summary: SaveSlotSummary = {
    planets: Object.keys(planets).length,
    npcCount: targets.filter((target) => typeof target.ownerId === 'string' && isGeneratedNpcOwnerId(target.ownerId)).length,
    galaxyCount: typeof world.galaxyCount === 'number' ? world.galaxyCount : 1,
    days: Math.max(0, Math.floor((typeof save.playTimeMs === 'number' ? save.playTimeMs : 0) / DAY_MS)),
    crystals: Math.max(0, ...ownCrystalLists),
    victory: Boolean(record(sunRaid.campaignResult).playerWon),
  };
  return {
    createdAt,
    updatedAt: now,
    playTimeMs: typeof save.playTimeMs === 'number' ? Math.max(0, save.playTimeMs) : 0,
    factionId: FACTIONS.includes(profile.factionId as PlayerFactionId) ? profile.factionId as PlayerFactionId : 'aegis',
    playerName: typeof profile.displayName === 'string' && profile.displayName.trim() ? profile.displayName.trim().slice(0, 24) : 'Командир',
    campaignSpeed: SPEEDS.includes(world.campaignSpeed as CampaignSpeed) ? world.campaignSpeed as CampaignSpeed : 'standard',
    schemaVersion: typeof save.schemaVersion === 'number' ? save.schemaVersion : 0,
    summary,
  };
}

function describeRaw(raw: string, now: number) {
  try {
    return describeSave(JSON.parse(raw) as LooseSave, now);
  } catch {
    return null;
  }
}

export function writeSlotIndex(index: SaveSlotIndex, storage?: SlotStorage | null): SlotWriteResult {
  const target = resolveStorage(storage);
  if (!target) return { ok: false, error: 'Хранилище недоступно.', index };
  try {
    target.setItem(SLOT_INDEX_KEY, JSON.stringify(index));
    return { ok: true, index };
  } catch (error) {
    return { ok: false, error: errorText(error), index };
  }
}

/**
 * Reads the production slot index and migrates the single legacy save into a
 * slot exactly once. The legacy key itself stays in place as that slot's storage.
 */
export function readSlotIndex(storage?: SlotStorage | null, now = Date.now()): SaveSlotIndex {
  const target = resolveStorage(storage);
  if (!target) return createEmptySlotIndex();
  let index = createEmptySlotIndex();
  try {
    const raw = target.getItem(SLOT_INDEX_KEY);
    index = raw ? normalizeSlotIndex(JSON.parse(raw)) : createEmptySlotIndex();
  } catch {
    index = createEmptySlotIndex();
  }
  let legacyRaw: string | null = null;
  try { legacyRaw = target.getItem(LEGACY_PRODUCTION_SAVE_KEY); } catch { legacyRaw = null; }
  const migrated = migrateLegacySave(index, legacyRaw, (raw) => {
    const described = describeRaw(raw, now);
    return described ? { ...described, createdAt: Math.min(described.createdAt, now) } : null;
  });
  if (migrated !== index) writeSlotIndex(migrated, target);
  return migrated;
}

/** Raw slot payload state for the load screen: readable, broken or written by a newer build. */
export type SlotHealth = { status: 'ok' } | { status: 'missing' } | { status: 'broken'; reason: string } | { status: 'newer'; schemaVersion: number };

export function inspectSlot(meta: SaveSlotMeta, currentSchemaVersion: number, storage?: SlotStorage | null): SlotHealth {
  const target = resolveStorage(storage);
  if (!target) return { status: 'missing' };
  let raw: string | null = null;
  try { raw = target.getItem(meta.storageKey); } catch { return { status: 'missing' }; }
  if (!raw) return { status: 'missing' };
  try {
    const parsed = JSON.parse(raw) as LooseSave;
    if (!describeSave(parsed, Date.now())) return { status: 'broken', reason: 'Нет планет в сохранении.' };
    const schema = typeof parsed.schemaVersion === 'number' ? parsed.schemaVersion : 0;
    if (schema > currentSchemaVersion) return { status: 'newer', schemaVersion: schema };
    return { status: 'ok' };
  } catch {
    return { status: 'broken', reason: 'Повреждённый JSON.' };
  }
}

export function createSlot(
  state: SaveState,
  name: string,
  options: { storage?: SlotStorage | null; now?: number; random?: () => number; slotId?: string } = {},
): SlotWriteResult & { slot?: SaveSlotMeta } {
  const target = resolveStorage(options.storage);
  const now = options.now ?? Date.now();
  const index = readSlotIndex(target, now);
  if (!target) return { ok: false, error: 'Хранилище недоступно.', index };
  if (index.slots.length >= MAX_SAVE_SLOTS) return { ok: false, error: `Достигнут предел слотов (${MAX_SAVE_SLOTS}). Удалите старую кампанию.`, index };
  const id = options.slotId ?? createSlotId(options.random, now);
  const described = describeSave(state as unknown as LooseSave, now);
  if (!described) return { ok: false, error: 'Не удалось описать новое сохранение.', index };
  const slot: SaveSlotMeta = {
    ...described,
    createdAt: now,
    updatedAt: now,
    id,
    name: name.trim().slice(0, 40) || 'Кампания',
    storageKey: slotStorageKey(id),
    mode: 'production',
  };
  try {
    target.setItem(slot.storageKey, JSON.stringify({ ...state, createdAt: now }));
  } catch (error) {
    return { ok: false, error: errorText(error), index };
  }
  const written = writeSlotIndex(activateSlot(upsertSlot(index, slot), slot.id), target);
  return written.ok ? { ...written, slot } : written;
}

/** Refreshes a slot card from the live state (throttled by the caller). */
export function refreshSlotMeta(slotId: string, state: SaveState, options: { storage?: SlotStorage | null; now?: number } = {}): SlotWriteResult {
  const target = resolveStorage(options.storage);
  const now = options.now ?? Date.now();
  const index = readSlotIndex(target, now);
  const slot = index.slots.find((item) => item.id === slotId);
  const described = describeSave(state as unknown as LooseSave, now);
  if (!slot || !described) return { ok: false, error: 'Слот не найден.', index };
  return writeSlotIndex(upsertSlot(index, { ...slot, ...described, createdAt: slot.createdAt, updatedAt: now }), target);
}

export function setActiveSlot(slotId: string | null, storage?: SlotStorage | null): SlotWriteResult {
  const target = resolveStorage(storage);
  return writeSlotIndex(activateSlot(readSlotIndex(target), slotId), target);
}

export function renameSaveSlot(slotId: string, name: string, storage?: SlotStorage | null, now = Date.now()): SlotWriteResult {
  const target = resolveStorage(storage);
  return writeSlotIndex(renameSlot(readSlotIndex(target, now), slotId, name, now), target);
}

export function deleteSaveSlot(slotId: string, storage?: SlotStorage | null): SlotWriteResult {
  const target = resolveStorage(storage);
  const index = readSlotIndex(target);
  const slot = index.slots.find((item) => item.id === slotId);
  if (!target || !slot) return { ok: false, error: 'Слот не найден.', index };
  try { target.removeItem(slot.storageKey); } catch { /* the index entry is removed regardless */ }
  return writeSlotIndex(removeSlot(index, slotId), target);
}

export function duplicateSaveSlot(slotId: string, options: { storage?: SlotStorage | null; now?: number; random?: () => number } = {}): SlotWriteResult {
  const target = resolveStorage(options.storage);
  const now = options.now ?? Date.now();
  const index = readSlotIndex(target, now);
  const slot = index.slots.find((item) => item.id === slotId);
  if (!target || !slot) return { ok: false, error: 'Слот не найден.', index };
  if (index.slots.length >= MAX_SAVE_SLOTS) return { ok: false, error: `Достигнут предел слотов (${MAX_SAVE_SLOTS}).`, index };
  const raw = target.getItem(slot.storageKey);
  if (!raw) return { ok: false, error: 'Данные слота отсутствуют.', index };
  const id = createSlotId(options.random, now);
  const copy: SaveSlotMeta = { ...slot, id, name: `${slot.name} (копия)`.slice(0, 40), storageKey: slotStorageKey(id), createdAt: now, updatedAt: now };
  try {
    target.setItem(copy.storageKey, raw);
  } catch (error) {
    return { ok: false, error: errorText(error), index };
  }
  return writeSlotIndex(upsertSlot(index, copy), target);
}

/** JSON text of an export file; a broken slot is exported as-is for support. */
export function exportSaveSlot(slotId: string, storage?: SlotStorage | null, now = Date.now()): { ok: true; fileName: string; text: string } | { ok: false; error: string } {
  const target = resolveStorage(storage);
  const index = readSlotIndex(target, now);
  const slot = index.slots.find((item) => item.id === slotId);
  if (!target || !slot) return { ok: false, error: 'Слот не найден.' };
  const raw = target.getItem(slot.storageKey);
  if (!raw) return { ok: false, error: 'Данные слота отсутствуют.' };
  let save: unknown = raw;
  try { save = JSON.parse(raw); } catch { save = raw; }
  const safeName = slot.name.replace(/[^\p{L}\p{N}_-]+/gu, '-').replace(/^-+|-+$/g, '') || 'campaign';
  return {
    ok: true,
    fileName: `asterion-${safeName}-${new Date(now).toISOString().slice(0, 10)}.json`,
    text: JSON.stringify(createSlotExport(slot, save, now), null, 2),
  };
}

export function importSaveSlot(text: string, currentSchemaVersion: number, options: { storage?: SlotStorage | null; now?: number; random?: () => number } = {}): SlotWriteResult & { slot?: SaveSlotMeta } {
  const target = resolveStorage(options.storage);
  const now = options.now ?? Date.now();
  const index = readSlotIndex(target, now);
  const parsed = parseSlotImport(text, currentSchemaVersion);
  if (!parsed.ok) return { ok: false, error: parsed.error, index };
  if (!target) return { ok: false, error: 'Хранилище недоступно.', index };
  if (index.slots.length >= MAX_SAVE_SLOTS) return { ok: false, error: `Достигнут предел слотов (${MAX_SAVE_SLOTS}).`, index };
  const described = describeSave(parsed.save as LooseSave, now);
  if (!described) return { ok: false, error: 'Сохранение не читается.', index };
  const id = createSlotId(options.random, now);
  const slot: SaveSlotMeta = { ...described, id, name: parsed.name.slice(0, 40), storageKey: slotStorageKey(id), mode: 'production', updatedAt: now };
  try {
    target.setItem(slot.storageKey, JSON.stringify(parsed.save));
  } catch (error) {
    return { ok: false, error: errorText(error), index };
  }
  const written = writeSlotIndex(upsertSlot(index, slot), target);
  return written.ok ? { ...written, slot } : written;
}

export { LEGACY_SLOT_ID };
