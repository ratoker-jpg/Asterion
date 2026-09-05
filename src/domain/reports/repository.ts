import { ASTERION_SAVE_KEY } from '../combat/priority.ts';
import type { ReportsState } from './types.ts';

const REPORT_METADATA_LIMIT = 500;

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;
type SaveEnvelope = { reports?: unknown; [key: string]: unknown };

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function capNewestIds(ids: readonly string[]) {
  return ids.length > REPORT_METADATA_LIMIT ? ids.slice(-REPORT_METADATA_LIMIT) : [...ids];
}

function normalizeIds(value: unknown) {
  if (!Array.isArray(value)) return [];
  const unique = [...new Set(
    value
      .filter((id): id is string => typeof id === 'string' && Boolean(id.trim()))
      .map((id) => id.trim().slice(0, 160)),
  )];
  return capNewestIds(unique);
}

function appendNewestId(ids: readonly string[], id: string) {
  if (ids.includes(id)) return [...ids];
  return capNewestIds([...ids, id]);
}

function resolveStorage(storage?: StorageLike): StorageLike | null {
  if (storage) return storage;
  if (typeof window === 'undefined') return null;
  return window.localStorage;
}

export function createDefaultReportsState(): ReportsState {
  return { readIds: [], favoriteIds: [], archivedIds: [] };
}

export function migrateReportsState(value: unknown): ReportsState {
  if (!isRecord(value)) return createDefaultReportsState();
  return {
    readIds: normalizeIds(value.readIds),
    favoriteIds: normalizeIds(value.favoriteIds),
    archivedIds: normalizeIds(value.archivedIds),
  };
}

export function markReportRead(state: ReportsState, reportId: string): ReportsState {
  const normalized = migrateReportsState(state);
  const id = reportId.trim();
  if (!id || normalized.readIds.includes(id)) return normalized;
  return { ...normalized, readIds: appendNewestId(normalized.readIds, id) };
}

export function markAllReportsRead(state: ReportsState, reportIds: readonly string[]): ReportsState {
  const normalized = migrateReportsState(state);
  let readIds = normalized.readIds;
  reportIds.forEach((id) => {
    const clean = id.trim();
    if (clean) readIds = appendNewestId(readIds, clean);
  });
  return { ...normalized, readIds };
}

export function toggleReportFavorite(state: ReportsState, reportId: string): ReportsState {
  const normalized = migrateReportsState(state);
  const id = reportId.trim();
  if (!id) return normalized;
  if (normalized.favoriteIds.includes(id)) {
    return { ...normalized, favoriteIds: normalized.favoriteIds.filter((candidate) => candidate !== id) };
  }
  return { ...normalized, favoriteIds: appendNewestId(normalized.favoriteIds, id) };
}

export function archiveReport(state: ReportsState, reportId: string): ReportsState {
  const normalized = markReportRead(state, reportId);
  const id = reportId.trim();
  if (!id || normalized.archivedIds.includes(id)) return normalized;
  return { ...normalized, archivedIds: appendNewestId(normalized.archivedIds, id) };
}

export function unarchiveReport(state: ReportsState, reportId: string): ReportsState {
  const normalized = migrateReportsState(state);
  const id = reportId.trim();
  if (!id || !normalized.archivedIds.includes(id)) return normalized;
  return { ...normalized, archivedIds: normalized.archivedIds.filter((candidate) => candidate !== id) };
}

export function readReportsState(storage?: StorageLike): ReportsState {
  const target = resolveStorage(storage);
  if (!target) return createDefaultReportsState();
  try {
    const raw = target.getItem(ASTERION_SAVE_KEY);
    if (!raw) return createDefaultReportsState();
    const parsed = JSON.parse(raw) as SaveEnvelope;
    return migrateReportsState(parsed.reports);
  } catch {
    return createDefaultReportsState();
  }
}

export type PersistReportsResult =
  | { ok: true; value: ReportsState }
  | { ok: false; value: ReportsState; error: string };

export function persistReportsState(value: ReportsState, storage?: StorageLike): PersistReportsResult {
  const normalized = migrateReportsState(value);
  const target = resolveStorage(storage);
  if (!target) return { ok: false, value: normalized, error: 'Локальное сохранение недоступно.' };
  try {
    const raw = target.getItem(ASTERION_SAVE_KEY);
    const envelope = raw ? JSON.parse(raw) as SaveEnvelope : {};
    target.setItem(ASTERION_SAVE_KEY, JSON.stringify({ ...envelope, reports: normalized }));
    return { ok: true, value: normalized };
  } catch (error) {
    return {
      ok: false,
      value: normalized,
      error: error instanceof Error ? error.message : 'Не удалось сохранить метаданные отчётов.',
    };
  }
}