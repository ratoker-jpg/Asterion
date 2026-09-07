import { ASTERION_SAVE_KEY } from '../combat/priority.ts';
import type { ReportCategory, ReportItem, ReportsState } from './types.ts';

const REPORT_METADATA_LIMIT = 500;

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;
type SaveEnvelope = { reports?: unknown; [key: string]: unknown };

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizeIds(value: unknown, knownIds?: readonly string[]) {
  if (!Array.isArray(value)) return [];
  const known = knownIds ? new Set(knownIds) : null;
  const unique = [...new Set(
    value
      .filter((id): id is string => typeof id === 'string' && Boolean(id.trim()))
      .map((id) => id.trim().slice(0, 160)),
  )].filter((id) => !known || known.has(id));
  return unique.length > REPORT_METADATA_LIMIT ? unique.slice(-REPORT_METADATA_LIMIT) : unique;
}

function appendNewestId(ids: readonly string[], id: string) {
  if (ids.includes(id)) return [...ids];
  const next = [...ids, id];
  return next.length > REPORT_METADATA_LIMIT ? next.slice(-REPORT_METADATA_LIMIT) : next;
}

function resolveStorage(storage?: StorageLike): StorageLike | null {
  if (storage) return storage;
  if (typeof window === 'undefined') return null;
  return window.localStorage;
}

export function createDefaultReportsState(): ReportsState {
  return { readIds: [], hiddenIds: [] };
}

export function migrateReportsState(value: unknown, knownIds?: readonly string[]): ReportsState {
  if (!isRecord(value)) return createDefaultReportsState();
  return {
    readIds: normalizeIds(value.readIds, knownIds),
    hiddenIds: normalizeIds(value.hiddenIds, knownIds),
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

function appendIds(ids: readonly string[], additions: readonly string[]) {
  return additions.reduce((result, id) => appendNewestId(result, id), [...ids]);
}

function visibleFolderIds(items: readonly ReportItem[], state: ReportsState, category: ReportCategory) {
  const hidden = new Set(state.hiddenIds);
  return items
    .filter((item) => item.category === category && !hidden.has(item.id))
    .map((item) => item.id);
}

export function deleteAllReports(state: ReportsState, items: readonly ReportItem[], category: ReportCategory): ReportsState {
  const normalized = migrateReportsState(state);
  return {
    ...normalized,
    hiddenIds: appendIds(normalized.hiddenIds, visibleFolderIds(items, normalized, category)),
  };
}

export function deleteSelectedReports(
  state: ReportsState,
  items: readonly ReportItem[],
  category: ReportCategory,
  selectedIds: readonly string[],
): ReportsState {
  const normalized = migrateReportsState(state);
  const allowed = new Set(visibleFolderIds(items, normalized, category));
  const selected = selectedIds
    .filter((id): id is string => typeof id === 'string')
    .map((id) => id.trim())
    .filter((id) => allowed.has(id));
  return {
    ...normalized,
    hiddenIds: appendIds(normalized.hiddenIds, selected),
  };
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
