import { DEMO_BATTLE_REPORTS } from './battle-fixtures.ts';
import { COMBAT_SAVE_SCHEMA_VERSION } from './priority.ts';
import { normalizeBattleReport, type BattleReport } from './report.ts';
import { getRuntimeSaveKey, type RuntimeMode } from '../runtime/mode.ts';

const LEGACY_SAVE_KEY = getRuntimeSaveKey();
export const BATTLE_HISTORY_CHANGED_EVENT = 'asterion:battle-history-changed';

export type BattleHistoryState = {
  reports: BattleReport[];
  savedReportIds: string[];
};

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

type SaveEnvelope = {
  schemaVersion?: number;
  combat?: unknown;
  [key: string]: unknown;
};

const DEMO_REPORT_ID_SET = new Set(DEMO_BATTLE_REPORTS.map((report) => report.id));

function isBattleReport(value: unknown): value is BattleReport {
  return normalizeBattleReport(value) !== null;
}

function resolveStorage(storage?: StorageLike): StorageLike | null {
  if (storage) return storage;
  if (typeof window === 'undefined') return null;
  return window.localStorage;
}

export function createDefaultBattleHistory(mode: RuntimeMode = 'test'): BattleHistoryState {
  return {
    reports: mode === 'test' ? [...DEMO_BATTLE_REPORTS] : [],
    savedReportIds: [],
  };
}

export function migrateBattleHistory(value: unknown, mode: RuntimeMode = 'test'): BattleHistoryState {
  const candidate = value && typeof value === 'object'
    ? value as { reports?: unknown; savedReportIds?: unknown }
    : {};

  const reportById = new Map<string, BattleReport>();
  if (mode === 'test') DEMO_BATTLE_REPORTS.forEach((report) => reportById.set(report.id, report));

  if (Array.isArray(candidate.reports)) {
    candidate.reports.forEach((report) => {
      const normalized = normalizeBattleReport(report);
      if (!normalized || DEMO_REPORT_ID_SET.has(normalized.id)) return;
      reportById.set(normalized.id, normalized);
    });
  }

  const reports = [...reportById.values()];
  const knownIds = new Set(reports.map((report) => report.id));
  const savedReportIds = Array.isArray(candidate.savedReportIds)
    ? [...new Set(candidate.savedReportIds.filter((id): id is string => typeof id === 'string' && knownIds.has(id)))]
    : [];

  return { reports, savedReportIds };
}

export function readBattleHistory(storage?: StorageLike, mode?: RuntimeMode): BattleHistoryState {
  const runtimeMode = mode ?? 'test';
  const saveKey = mode === undefined ? LEGACY_SAVE_KEY : getRuntimeSaveKey(runtimeMode);
  const target = resolveStorage(storage);
  if (!target) return createDefaultBattleHistory(runtimeMode);

  try {
    const raw = target.getItem(saveKey);
    if (!raw) return createDefaultBattleHistory(runtimeMode);
    const parsed = JSON.parse(raw) as SaveEnvelope;
    return migrateBattleHistory(parsed.combat, runtimeMode);
  } catch {
    return createDefaultBattleHistory(runtimeMode);
  }
}

export type PersistBattleHistoryResult =
  | { ok: true; value: BattleHistoryState }
  | { ok: false; value: BattleHistoryState; error: string };

export function persistBattleHistory(
  value: BattleHistoryState,
  storage?: StorageLike,
  mode?: RuntimeMode,
): PersistBattleHistoryResult {
  const runtimeMode = mode ?? 'test';
  const saveKey = mode === undefined ? LEGACY_SAVE_KEY : getRuntimeSaveKey(runtimeMode);
  const normalized = migrateBattleHistory(value, runtimeMode);
  const target = resolveStorage(storage);
  if (!target) return { ok: false, value: normalized, error: 'Локальное сохранение недоступно.' };

  try {
    const raw = target.getItem(saveKey);
    let parsed: SaveEnvelope = {};
    if (raw) parsed = JSON.parse(raw) as SaveEnvelope;

    const nextSave: SaveEnvelope = {
      ...parsed,
      schemaVersion: COMBAT_SAVE_SCHEMA_VERSION,
      combat: normalized,
    };
    target.setItem(saveKey, JSON.stringify(nextSave));

    if (typeof window !== 'undefined' && target === window.localStorage) {
      window.dispatchEvent(new CustomEvent<BattleHistoryState>(BATTLE_HISTORY_CHANGED_EVENT, { detail: normalized }));
    }

    return { ok: true, value: normalized };
  } catch (error) {
    return {
      ok: false,
      value: normalized,
      error: error instanceof Error ? error.message : 'Не удалось сохранить боевые отчёты.',
    };
  }
}

export function setBattleReportSaved(
  history: BattleHistoryState,
  reportId: string,
  saved: boolean,
  mode: RuntimeMode = 'test',
): BattleHistoryState {
  if (!history.reports.some((report) => report.id === reportId)) return migrateBattleHistory(history, mode);

  const savedIds = new Set(history.savedReportIds);
  if (saved) savedIds.add(reportId);
  else savedIds.delete(reportId);

  return {
    reports: history.reports,
    savedReportIds: [...savedIds],
  };
}

export function addBattleReportSaved(history: BattleHistoryState, report: BattleReport): BattleHistoryState {
  const exists = history.reports.some((item) => item.id === report.id);
  const savedIds = new Set(history.savedReportIds);
  savedIds.add(report.id);
  return {
    reports: exists ? history.reports : [...history.reports, report],
    savedReportIds: [...savedIds],
  };
}

export function isBattleReportSaved(history: BattleHistoryState, reportId: string) {
  return history.savedReportIds.includes(reportId);
}
