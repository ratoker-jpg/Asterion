import { DEMO_BATTLE_REPORTS } from './battle-fixtures.ts';
import { ASTERION_SAVE_KEY, COMBAT_SAVE_SCHEMA_VERSION } from './priority.ts';
import type { BattleReport } from './report.ts';

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

function isBattleReport(value: unknown): value is BattleReport {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<BattleReport>;
  return typeof candidate.id === 'string'
    && typeof candidate.timestamp === 'string'
    && typeof candidate.roundCount === 'number'
    && Array.isArray(candidate.rounds)
    && Boolean(candidate.attacker)
    && Boolean(candidate.defender)
    && Boolean(candidate.attackerForce)
    && Boolean(candidate.defenderForce);
}

function resolveStorage(storage?: StorageLike): StorageLike | null {
  if (storage) return storage;
  if (typeof window === 'undefined') return null;
  return window.localStorage;
}

export function createDefaultBattleHistory(): BattleHistoryState {
  return {
    reports: [...DEMO_BATTLE_REPORTS],
    savedReportIds: [],
  };
}

export function migrateBattleHistory(value: unknown): BattleHistoryState {
  const candidate = value && typeof value === 'object'
    ? value as { reports?: unknown; savedReportIds?: unknown }
    : {};

  const reportById = new Map<string, BattleReport>();
  DEMO_BATTLE_REPORTS.forEach((report) => reportById.set(report.id, report));

  if (Array.isArray(candidate.reports)) {
    candidate.reports.forEach((report) => {
      if (!isBattleReport(report)) return;
      reportById.set(report.id, report);
    });
  }

  const reports = [...reportById.values()];
  const knownIds = new Set(reports.map((report) => report.id));
  const savedReportIds = Array.isArray(candidate.savedReportIds)
    ? [...new Set(candidate.savedReportIds.filter((id): id is string => typeof id === 'string' && knownIds.has(id)))]
    : [];

  return { reports, savedReportIds };
}

export function readBattleHistory(storage?: StorageLike): BattleHistoryState {
  const target = resolveStorage(storage);
  if (!target) return createDefaultBattleHistory();

  try {
    const raw = target.getItem(ASTERION_SAVE_KEY);
    if (!raw) return createDefaultBattleHistory();
    const parsed = JSON.parse(raw) as SaveEnvelope;
    return migrateBattleHistory(parsed.combat);
  } catch {
    return createDefaultBattleHistory();
  }
}

export type PersistBattleHistoryResult =
  | { ok: true; value: BattleHistoryState }
  | { ok: false; value: BattleHistoryState; error: string };

export function persistBattleHistory(
  value: BattleHistoryState,
  storage?: StorageLike,
): PersistBattleHistoryResult {
  const normalized = migrateBattleHistory(value);
  const target = resolveStorage(storage);
  if (!target) return { ok: false, value: normalized, error: 'Локальное сохранение недоступно.' };

  try {
    const raw = target.getItem(ASTERION_SAVE_KEY);
    let parsed: SaveEnvelope = {};
    if (raw) parsed = JSON.parse(raw) as SaveEnvelope;

    const nextSave: SaveEnvelope = {
      ...parsed,
      schemaVersion: COMBAT_SAVE_SCHEMA_VERSION,
      combat: normalized,
    };
    target.setItem(ASTERION_SAVE_KEY, JSON.stringify(nextSave));

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
): BattleHistoryState {
  if (!history.reports.some((report) => report.id === reportId)) return migrateBattleHistory(history);

  const savedIds = new Set(history.savedReportIds);
  if (saved) savedIds.add(reportId);
  else savedIds.delete(reportId);

  return {
    reports: history.reports,
    savedReportIds: [...savedIds],
  };
}

export function isBattleReportSaved(history: BattleHistoryState, reportId: string) {
  return history.savedReportIds.includes(reportId);
}
