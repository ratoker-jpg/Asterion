import { COMMANDER_IDS, isCommanderId, type CommanderId } from './commanders.ts';
import { getRuntimeSaveKey, type RuntimeMode } from '../runtime/mode.ts';

export const ASTERION_SAVE_KEY = getRuntimeSaveKey();
export const COMBAT_SAVE_SCHEMA_VERSION = 6;
export const COMBAT_PRIORITY_CHANGED_EVENT = 'asterion:combat-priority-changed';

export type CombatPriorityState = {
  attack: CommanderId[];
  defense: CommanderId[];
};

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

type SaveEnvelope = {
  schemaVersion?: number;
  combatPriority?: unknown;
  [key: string]: unknown;
};

export const DEFAULT_COMMANDER_PRIORITY: readonly CommanderId[] = [...COMMANDER_IDS];

export const DEFAULT_COMBAT_PRIORITY: Readonly<CombatPriorityState> = {
  attack: [...DEFAULT_COMMANDER_PRIORITY],
  defense: [...DEFAULT_COMMANDER_PRIORITY],
};

export function createDefaultCombatPriority(): CombatPriorityState {
  return {
    attack: [...DEFAULT_COMMANDER_PRIORITY],
    defense: [...DEFAULT_COMMANDER_PRIORITY],
  };
}

export function normalizePriorityOrder(value: unknown): CommanderId[] {
  const seen = new Set<CommanderId>();
  const normalized: CommanderId[] = [];

  if (Array.isArray(value)) {
    value.forEach((candidate) => {
      if (!isCommanderId(candidate) || seen.has(candidate)) return;
      seen.add(candidate);
      normalized.push(candidate);
    });
  }

  COMMANDER_IDS.forEach((commanderId) => {
    if (seen.has(commanderId)) return;
    seen.add(commanderId);
    normalized.push(commanderId);
  });

  return normalized;
}

export function migrateCombatPriority(value: unknown): CombatPriorityState {
  const candidate = value && typeof value === 'object' ? value as Partial<Record<keyof CombatPriorityState, unknown>> : {};
  return {
    attack: normalizePriorityOrder(candidate.attack),
    defense: normalizePriorityOrder(candidate.defense),
  };
}

export function selectActiveCommander(
  priority: readonly CommanderId[],
  presentCommanderIds: Iterable<CommanderId>,
): CommanderId | null {
  const present = new Set(presentCommanderIds);
  return priority.find((commanderId) => present.has(commanderId)) ?? null;
}

export function moveCommanderByOffset(
  priority: readonly CommanderId[],
  commanderId: CommanderId,
  offset: -1 | 1,
): CommanderId[] {
  const normalized = normalizePriorityOrder(priority);
  const currentIndex = normalized.indexOf(commanderId);
  if (currentIndex < 0) return normalized;

  const targetIndex = Math.max(0, Math.min(normalized.length - 1, currentIndex + offset));
  if (targetIndex === currentIndex) return normalized;

  const next = [...normalized];
  next.splice(currentIndex, 1);
  next.splice(targetIndex, 0, commanderId);
  return next;
}

export function moveCommanderBefore(
  priority: readonly CommanderId[],
  commanderId: CommanderId,
  beforeCommanderId: CommanderId,
): CommanderId[] {
  const normalized = normalizePriorityOrder(priority);
  if (commanderId === beforeCommanderId) return normalized;

  const next = normalized.filter((id) => id !== commanderId);
  const targetIndex = next.indexOf(beforeCommanderId);
  if (targetIndex < 0) return normalized;
  next.splice(targetIndex, 0, commanderId);
  return next;
}

export function moveCommanderToEnd(
  priority: readonly CommanderId[],
  commanderId: CommanderId,
): CommanderId[] {
  const normalized = normalizePriorityOrder(priority);
  if (!normalized.includes(commanderId)) return normalized;
  return [...normalized.filter((id) => id !== commanderId), commanderId];
}

function resolveStorage(storage?: StorageLike): StorageLike | null {
  if (storage) return storage;
  if (typeof window === 'undefined') return null;
  return window.localStorage;
}

export function readCombatPriority(storage?: StorageLike, mode?: RuntimeMode): CombatPriorityState {
  const target = resolveStorage(storage);
  if (!target) return createDefaultCombatPriority();

  try {
    const raw = target.getItem(mode === undefined ? ASTERION_SAVE_KEY : getRuntimeSaveKey(mode));
    if (!raw) return createDefaultCombatPriority();
    const parsed = JSON.parse(raw) as SaveEnvelope;
    return migrateCombatPriority(parsed.combatPriority);
  } catch {
    return createDefaultCombatPriority();
  }
}

export type PersistCombatPriorityResult =
  | { ok: true; value: CombatPriorityState }
  | { ok: false; value: CombatPriorityState; error: string };

export function persistCombatPriority(
  value: CombatPriorityState,
  storage?: StorageLike,
  mode?: RuntimeMode,
): PersistCombatPriorityResult {
  const normalized = migrateCombatPriority(value);
  const target = resolveStorage(storage);
  if (!target) return { ok: false, value: normalized, error: 'Локальное сохранение недоступно.' };

  try {
    const saveKey = mode === undefined ? ASTERION_SAVE_KEY : getRuntimeSaveKey(mode);
    const raw = target.getItem(saveKey);
    let parsed: SaveEnvelope = {};
    if (raw) parsed = JSON.parse(raw) as SaveEnvelope;

    const nextSave: SaveEnvelope = {
      ...parsed,
      schemaVersion: COMBAT_SAVE_SCHEMA_VERSION,
      combatPriority: normalized,
    };
    target.setItem(saveKey, JSON.stringify(nextSave));

    if (typeof window !== 'undefined' && target === window.localStorage) {
      window.dispatchEvent(new CustomEvent<CombatPriorityState>(COMBAT_PRIORITY_CHANGED_EVENT, { detail: normalized }));
    }

    return { ok: true, value: normalized };
  } catch (error) {
    return {
      ok: false,
      value: normalized,
      error: error instanceof Error ? error.message : 'Не удалось сохранить боевой приоритет.',
    };
  }
}
