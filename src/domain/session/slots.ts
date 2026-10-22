import type { PlayerFactionId } from '../profile/types.ts';
import type { CampaignSpeed, RuntimeMode } from '../runtime/mode.ts';

/** Legacy single-save key; a migrated legacy slot keeps using it as its storage. */
export const LEGACY_PRODUCTION_SAVE_KEY = 'asterion.vertical-slice.v1';
export const SLOT_INDEX_KEY = 'asterion.slots.index.v1';
export const LEGACY_SLOT_ID = 'slot-legacy';
export const MAX_SAVE_SLOTS = 24;
export const SLOT_EXPORT_FORMAT = 'asterion-save-slot';

export type SaveSlotSummary = {
  planets: number;
  npcCount: number;
  galaxyCount: number;
  /** Days since the campaign started. */
  days: number;
  crystals: number;
  victory: boolean;
};

export type SaveSlotMeta = {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  playTimeMs: number;
  factionId: PlayerFactionId;
  playerName: string;
  campaignSpeed: CampaignSpeed;
  schemaVersion: number;
  /** localStorage key holding this slot's SaveState. */
  storageKey: string;
  summary: SaveSlotSummary;
  mode: RuntimeMode;
};

export type SaveSlotIndex = {
  version: 1;
  activeSlotId: string | null;
  slots: SaveSlotMeta[];
};

export function createEmptySlotIndex(): SaveSlotIndex {
  return { version: 1, activeSlotId: null, slots: [] };
}

export function slotStorageKey(slotId: string): string {
  return slotId === LEGACY_SLOT_ID ? LEGACY_PRODUCTION_SAVE_KEY : `asterion.slot.${slotId}.v1`;
}

export function createSlotId(random: () => number = Math.random, now = Date.now()): string {
  return `slot-${now.toString(36)}-${Math.floor(random() * 36 ** 6).toString(36).padStart(6, '0')}`;
}

const FACTIONS: readonly PlayerFactionId[] = ['aegis', 'synod', 'veyra'];
const SPEEDS: readonly CampaignSpeed[] = ['slow', 'standard', 'fast'];

function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function normalizeSummary(value: unknown): SaveSlotSummary {
  const source = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
  return {
    planets: Math.max(0, Math.floor(finite(source.planets, 1))),
    npcCount: Math.max(0, Math.floor(finite(source.npcCount, 0))),
    galaxyCount: Math.max(1, Math.floor(finite(source.galaxyCount, 1))),
    days: Math.max(0, Math.floor(finite(source.days, 0))),
    crystals: Math.min(4, Math.max(0, Math.floor(finite(source.crystals, 0)))),
    victory: source.victory === true,
  };
}

export function normalizeSlotMeta(value: unknown): SaveSlotMeta | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const source = value as Record<string, unknown>;
  if (typeof source.id !== 'string' || !/^slot-[a-z0-9-]{1,40}$/.test(source.id)) return null;
  const name = typeof source.name === 'string' && source.name.trim() ? source.name.trim().slice(0, 40) : 'Кампания';
  const createdAt = finite(source.createdAt, 0);
  return {
    id: source.id,
    name,
    createdAt,
    updatedAt: finite(source.updatedAt, createdAt),
    playTimeMs: Math.max(0, finite(source.playTimeMs, 0)),
    factionId: FACTIONS.includes(source.factionId as PlayerFactionId) ? source.factionId as PlayerFactionId : 'aegis',
    playerName: typeof source.playerName === 'string' && source.playerName.trim() ? source.playerName.trim().slice(0, 24) : 'Командир',
    campaignSpeed: SPEEDS.includes(source.campaignSpeed as CampaignSpeed) ? source.campaignSpeed as CampaignSpeed : 'standard',
    schemaVersion: Math.max(0, Math.floor(finite(source.schemaVersion, 0))),
    storageKey: slotStorageKey(source.id),
    summary: normalizeSummary(source.summary),
    mode: source.mode === 'test' ? 'test' : 'production',
  };
}

export function normalizeSlotIndex(value: unknown): SaveSlotIndex {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return createEmptySlotIndex();
  const source = value as Record<string, unknown>;
  const seen = new Set<string>();
  const slots = (Array.isArray(source.slots) ? source.slots : [])
    .map(normalizeSlotMeta)
    .filter((slot): slot is SaveSlotMeta => {
      if (!slot || seen.has(slot.id)) return false;
      seen.add(slot.id);
      return true;
    });
  // No truncation at MAX_SAVE_SLOTS here: the limit gates creation, and cutting
  // the index would hide campaigns that are still stored.
  const activeSlotId = typeof source.activeSlotId === 'string' && seen.has(source.activeSlotId) ? source.activeSlotId : null;
  return { version: 1, activeSlotId, slots };
}

export function sortSlotsByRecent(slots: readonly SaveSlotMeta[]): SaveSlotMeta[] {
  return [...slots].sort((left, right) => right.updatedAt - left.updatedAt || left.id.localeCompare(right.id));
}

export function upsertSlot(index: SaveSlotIndex, slot: SaveSlotMeta): SaveSlotIndex {
  const exists = index.slots.some((item) => item.id === slot.id);
  return {
    ...index,
    slots: exists ? index.slots.map((item) => item.id === slot.id ? slot : item) : [...index.slots, slot],
  };
}

export function renameSlot(index: SaveSlotIndex, slotId: string, name: string, now: number): SaveSlotIndex {
  const clean = name.trim().replace(/\s+/g, ' ').slice(0, 40);
  if (!clean) return index;
  return { ...index, slots: index.slots.map((slot) => slot.id === slotId ? { ...slot, name: clean, updatedAt: Math.max(slot.updatedAt, now) } : slot) };
}

export function removeSlot(index: SaveSlotIndex, slotId: string): SaveSlotIndex {
  return {
    ...index,
    activeSlotId: index.activeSlotId === slotId ? null : index.activeSlotId,
    slots: index.slots.filter((slot) => slot.id !== slotId),
  };
}

export function activateSlot(index: SaveSlotIndex, slotId: string | null): SaveSlotIndex {
  if (slotId !== null && !index.slots.some((slot) => slot.id === slotId)) return index;
  return { ...index, activeSlotId: slotId };
}

/** Most recently played slot: what «Продолжить» opens. */
export function selectContinueSlot(index: SaveSlotIndex): SaveSlotMeta | null {
  const active = index.slots.find((slot) => slot.id === index.activeSlotId);
  return active ?? sortSlotsByRecent(index.slots)[0] ?? null;
}

/**
 * One-time migration of the single legacy save into a slot. The legacy key is
 * reused as that slot's storage, so nothing is copied and nothing can be lost.
 */
export function migrateLegacySave(
  index: SaveSlotIndex,
  legacyRaw: string | null,
  describe: (raw: string) => Omit<SaveSlotMeta, 'id' | 'name' | 'storageKey' | 'mode'> | null,
): SaveSlotIndex {
  if (!legacyRaw || index.slots.some((slot) => slot.id === LEGACY_SLOT_ID)) return index;
  const described = describe(legacyRaw);
  if (!described) return index;
  const slot: SaveSlotMeta = {
    ...described,
    id: LEGACY_SLOT_ID,
    name: 'Прежнее сохранение',
    storageKey: LEGACY_PRODUCTION_SAVE_KEY,
    mode: 'production',
  };
  return { ...upsertSlot(index, slot), activeSlotId: index.activeSlotId ?? LEGACY_SLOT_ID };
}

export type SlotExportPayload = {
  format: typeof SLOT_EXPORT_FORMAT;
  version: 1;
  exportedAt: number;
  meta: Pick<SaveSlotMeta, 'name' | 'factionId' | 'playerName' | 'campaignSpeed' | 'schemaVersion' | 'playTimeMs' | 'summary' | 'createdAt'>;
  save: unknown;
};

export function createSlotExport(meta: SaveSlotMeta, save: unknown, now: number): SlotExportPayload {
  return {
    format: SLOT_EXPORT_FORMAT,
    version: 1,
    exportedAt: now,
    meta: {
      name: meta.name,
      factionId: meta.factionId,
      playerName: meta.playerName,
      campaignSpeed: meta.campaignSpeed,
      schemaVersion: meta.schemaVersion,
      playTimeMs: meta.playTimeMs,
      summary: meta.summary,
      createdAt: meta.createdAt,
    },
    save,
  };
}

export type SlotImportResult =
  | { ok: true; name: string; save: Record<string, unknown> }
  | { ok: false; error: string };

/**
 * Accepts an exported slot file or a bare save object. A save written by a
 * newer build is refused instead of being silently downgraded.
 */
export function parseSlotImport(text: string, currentSchemaVersion: number): SlotImportResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, error: 'Файл не является корректным JSON.' };
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { ok: false, error: 'В файле нет сохранения Asterion.' };
  const envelope = parsed as Record<string, unknown>;
  const save = envelope.format === SLOT_EXPORT_FORMAT ? envelope.save : envelope;
  if (!save || typeof save !== 'object' || Array.isArray(save)) return { ok: false, error: 'В файле нет сохранения Asterion.' };
  const record = save as Record<string, unknown>;
  if (!record.planets || typeof record.planets !== 'object' || !record.profile || typeof record.profile !== 'object') {
    return { ok: false, error: 'Файл не похож на сохранение Asterion: нет планет или профиля.' };
  }
  const schema = finite(record.schemaVersion, 0);
  if (schema > currentSchemaVersion) {
    return { ok: false, error: `Сохранение создано более новой версией игры (схема ${schema}, у вас ${currentSchemaVersion}).` };
  }
  const meta = (envelope.meta && typeof envelope.meta === 'object' ? envelope.meta : {}) as Record<string, unknown>;
  const name = typeof meta.name === 'string' && meta.name.trim() ? meta.name.trim().slice(0, 34) : 'Импорт';
  return { ok: true, name: `${name} (импорт)`, save: record };
}

export function formatPlayTime(ms: number): string {
  const minutes = Math.floor(Math.max(0, ms) / 60_000);
  const hours = Math.floor(minutes / 60);
  if (hours <= 0) return `${minutes} мин`;
  return `${hours} ч ${String(minutes % 60).padStart(2, '0')} мин`;
}
