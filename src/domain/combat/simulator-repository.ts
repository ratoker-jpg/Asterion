import { COMBAT_ENTITY_BY_ID, getCombatEntity } from './catalog.ts';
import { isCommanderId, type CommanderId } from './commanders.ts';
import { normalizeCombatFactionId } from './factions.ts';
import type { CombatEntityId } from './ids.ts';
import { ASTERION_SAVE_KEY, COMBAT_SAVE_SCHEMA_VERSION } from './priority.ts';
import {
  createEmptySimulatorScenario,
  SIMULATOR_MAX_ROUNDS,
  type CombatStackInput,
  type SimulatorMaxRounds,
  type SimulatorScenario,
} from './simulator.ts';
import {
  COMBAT_ENTITY_LEVEL_LIMITS,
  COMBAT_PROFILE_ID,
  DEFAULT_COMBAT_TARGET_PRIORITY,
} from './config.ts';
import {
  COMBAT_TECHNOLOGIES,
  createDefaultCombatTechnologies,
  normalizeCombatTechnologies,
  type CombatTechnologyLevels,
} from './technologies.ts';
import { migrateScienceState } from '../science/runtime.ts';
import type { CombatEntityKind } from './types.ts';

export const SIMULATOR_STATE_CHANGED_EVENT = 'asterion:combat-simulator-changed';

export type SimulatorPreset = {
  id: string;
  name: string;
  createdAt: string;
  input: SimulatorScenario;
};

export type SimulatorState = {
  presets: SimulatorPreset[];
  lastScenario?: SimulatorScenario;
};

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

type SaveEnvelope = {
  schemaVersion?: number;
  combatSimulator?: unknown;
  [key: string]: unknown;
};

function resolveStorage(storage?: StorageLike): StorageLike | null {
  if (storage) return storage;
  if (typeof window === 'undefined') return null;
  return window.localStorage;
}

function isMaxRounds(value: unknown): value is SimulatorMaxRounds {
  return typeof value === 'number' && (SIMULATOR_MAX_ROUNDS as readonly number[]).includes(value);
}

function normalizeStacks(value: unknown, kind: CombatEntityKind): CombatStackInput[] {
  if (!Array.isArray(value)) return [];
  const counts = new Map<CombatEntityId, { count: number; level: number }>();

  value.forEach((candidate) => {
    if (!candidate || typeof candidate !== 'object') return;
    const entityId = (candidate as { entityId?: unknown }).entityId;
    const count = (candidate as { count?: unknown }).count;
    if (typeof entityId !== 'string' || !COMBAT_ENTITY_BY_ID.has(entityId as CombatEntityId)) return;
    const id = entityId as CombatEntityId;
    if (getCombatEntity(id).kind !== kind) return;
    if (!Number.isFinite(count) || !Number.isInteger(count) || (count as number) <= 0) return;
    const level = (candidate as { level?: unknown }).level;
    const normalizedLevel = typeof level === 'number' && Number.isFinite(level) && level >= 0
      ? Math.min(COMBAT_ENTITY_LEVEL_LIMITS[kind], Math.floor(level))
      : 0;
    const existing = counts.get(id);
    if (existing) {
      existing.count += count as number;
      existing.level = Math.max(existing.level, normalizedLevel);
    } else {
      counts.set(id, { count: count as number, level: normalizedLevel });
    }
  });

  return [...counts.entries()].map(([entityId, value]) => ({ entityId, count: value.count, level: value.level }));
}

function readCommander(value: unknown) {
  return normalizeStacks(value == null ? [] : [value], 'commander')[0] ?? null;
}

function readCommanderSelection(value: unknown, commanders: readonly CombatStackInput[], fallback?: CombatStackInput | null): CommanderId | null {
  const selected = commanders.filter((stack) => stack.count > 0 && isCommanderId(stack.entityId));
  if (typeof value === 'string' && isCommanderId(value) && selected.some((stack) => stack.entityId === value)) return value;
  if (selected.length === 1) return selected[0]!.entityId as CommanderId;
  if (fallback && selected.some((stack) => stack.entityId === fallback.entityId)) return fallback.entityId as CommanderId;
  return null;
}

function readCommanderStacks(side: { commanders?: unknown; commander?: unknown } | undefined) {
  const commanders = normalizeStacks(side?.commanders, 'commander');
  if (commanders.length) return commanders;
  const legacyCommander = readCommander(side?.commander);
  return legacyCommander ? [legacyCommander] : [];
}

function isObsoleteCommanderLimitError(message: string) {
  return /несколько командирских кораблей|не больше\s+\d+\s+командирск/i.test(message);
}

export function normalizeSimulatorScenario(value: unknown): SimulatorScenario {
  if (!value || typeof value !== 'object') return createEmptySimulatorScenario();
  const candidate = value as {
    attackerFactionId?: unknown;
    defenderFactionId?: unknown;
    attackerTechnologies?: unknown;
    defenderTechnologies?: unknown;
    technologyMode?: unknown;
    executionMode?: unknown;
    attackerTargetPriority?: unknown;
    defenderTargetPriority?: unknown;
    seed?: unknown;
    migrationErrors?: unknown;
    attacker?: { factionId?: unknown; ships?: unknown; commanders?: unknown; commander?: unknown; activeCommanderId?: unknown };
    defender?: { factionId?: unknown; ships?: unknown; commanders?: unknown; commander?: unknown; activeCommanderId?: unknown; defenses?: unknown };
    maxRounds?: unknown;
  };

  const attackerCommanders = readCommanderStacks(candidate.attacker);
  const defenderCommanders = readCommanderStacks(candidate.defender);
  const attackerLegacyCommander = readCommander(candidate.attacker?.commander);
  const defenderLegacyCommander = readCommander(candidate.defender?.commander);
  const attackerActiveCommanderId = readCommanderSelection(candidate.attacker?.activeCommanderId, attackerCommanders, attackerLegacyCommander);
  const defenderActiveCommanderId = readCommanderSelection(candidate.defender?.activeCommanderId, defenderCommanders, defenderLegacyCommander);
  const migrationErrors = [
    ...(Array.isArray(candidate.migrationErrors)
      ? candidate.migrationErrors.filter((item): item is string => typeof item === 'string' && Boolean(item.trim()) && !isObsoleteCommanderLimitError(item))
      : []),
  ];

  return {
    attackerFactionId: normalizeCombatFactionId(candidate.attackerFactionId),
    defenderFactionId: normalizeCombatFactionId(candidate.defenderFactionId),
    attackerTechnologies: normalizeCombatTechnologies(candidate.attackerTechnologies),
    defenderTechnologies: normalizeCombatTechnologies(candidate.defenderTechnologies),
    technologyMode: candidate.technologyMode === 'shared' ? 'shared' : 'independent',
    executionMode: candidate.executionMode === 'calibration' ? 'calibration' : 'production',
    attackerTargetPriority: candidate.attackerTargetPriority === 'population' || candidate.attackerTargetPriority === 'catalog'
      ? candidate.attackerTargetPriority
      : DEFAULT_COMBAT_TARGET_PRIORITY,
    defenderTargetPriority: candidate.defenderTargetPriority === 'population' || candidate.defenderTargetPriority === 'catalog'
      ? candidate.defenderTargetPriority
      : DEFAULT_COMBAT_TARGET_PRIORITY,
    ...(typeof candidate.seed === 'string' && candidate.seed.trim() ? { seed: candidate.seed.trim() } : {}),
    ...(migrationErrors.length ? { migrationErrors: [...new Set(migrationErrors)] } : {}),
    attacker: {
      factionId: normalizeCombatFactionId(candidate.attacker?.factionId ?? candidate.attackerFactionId),
      ships: normalizeStacks(candidate.attacker?.ships, 'ship'),
      commanders: attackerCommanders,
      commander: attackerActiveCommanderId
        ? attackerCommanders.find((stack) => stack.entityId === attackerActiveCommanderId) ?? null
        : null,
      activeCommanderId: attackerActiveCommanderId,
    },
    defender: {
      factionId: normalizeCombatFactionId(candidate.defender?.factionId ?? candidate.defenderFactionId),
      ships: normalizeStacks(candidate.defender?.ships, 'ship'),
      commanders: defenderCommanders,
      commander: defenderActiveCommanderId
        ? defenderCommanders.find((stack) => stack.entityId === defenderActiveCommanderId) ?? null
        : null,
      activeCommanderId: defenderActiveCommanderId,
      defenses: normalizeStacks(candidate.defender?.defenses, 'defense'),
    },
    maxRounds: isMaxRounds(candidate.maxRounds) ? candidate.maxRounds : 8,
    profileId: COMBAT_PROFILE_ID,
  };
}

export function createDefaultSimulatorState(): SimulatorState {
  return { presets: [] };
}

export function migrateSimulatorState(value: unknown): SimulatorState {
  if (!value || typeof value !== 'object') return createDefaultSimulatorState();
  const candidate = value as { presets?: unknown; lastScenario?: unknown };
  const seen = new Set<string>();
  const presets = Array.isArray(candidate.presets)
    ? candidate.presets.flatMap((preset): SimulatorPreset[] => {
        if (!preset || typeof preset !== 'object') return [];
        const raw = preset as { id?: unknown; name?: unknown; createdAt?: unknown; input?: unknown };
        if (typeof raw.id !== 'string' || !raw.id.trim() || seen.has(raw.id)) return [];
        if (typeof raw.name !== 'string' || !raw.name.trim()) return [];
        if (typeof raw.createdAt !== 'string' || Number.isNaN(Date.parse(raw.createdAt))) return [];
        seen.add(raw.id);
        return [{
          id: raw.id,
          name: raw.name.trim().slice(0, 48),
          createdAt: raw.createdAt,
          input: normalizeSimulatorScenario(raw.input),
        }];
      })
    : [];

  return {
    presets,
    ...(candidate.lastScenario ? { lastScenario: normalizeSimulatorScenario(candidate.lastScenario) } : {}),
  };
}

export function readSimulatorState(storage?: StorageLike): SimulatorState {
  const target = resolveStorage(storage);
  if (!target) return createDefaultSimulatorState();
  try {
    const raw = target.getItem(ASTERION_SAVE_KEY);
    if (!raw) return createDefaultSimulatorState();
    const envelope = JSON.parse(raw) as SaveEnvelope;
    return migrateSimulatorState(envelope.combatSimulator);
  } catch {
    return createDefaultSimulatorState();
  }
}

export function readSavedCombatTechnologies(storage?: StorageLike): CombatTechnologyLevels {
  const target = resolveStorage(storage);
  if (!target) return createDefaultCombatTechnologies();
  try {
    const raw = target.getItem(ASTERION_SAVE_KEY);
    if (!raw) return createDefaultCombatTechnologies();
    const envelope = JSON.parse(raw) as SaveEnvelope & { science?: unknown };
    const science = migrateScienceState(envelope.science);
    return normalizeCombatTechnologies(Object.fromEntries(
      COMBAT_TECHNOLOGIES.map((technology) => [technology.id, science.levels[technology.sourceScienceId] ?? 0]),
    ));
  } catch {
    return createDefaultCombatTechnologies();
  }
}

export function readSavedCombatTechnologyProfiles(storage?: StorageLike): {
  attacker: CombatTechnologyLevels;
  defender: CombatTechnologyLevels;
} {
  const fallback = readSavedCombatTechnologies(storage);
  const target = resolveStorage(storage);
  if (!target) return { attacker: fallback, defender: { ...fallback } };

  try {
    const raw = target.getItem(ASTERION_SAVE_KEY);
    if (!raw) return { attacker: fallback, defender: { ...fallback } };
    const envelope = JSON.parse(raw) as SaveEnvelope;
    const simulator = migrateSimulatorState(envelope.combatSimulator);
    const scenario = simulator.lastScenario;
    return {
      attacker: normalizeCombatTechnologies(scenario?.attackerTechnologies ?? fallback),
      defender: normalizeCombatTechnologies(scenario?.defenderTechnologies ?? fallback),
    };
  } catch {
    return { attacker: fallback, defender: { ...fallback } };
  }
}

export type PersistSimulatorStateResult =
  | { ok: true; value: SimulatorState }
  | { ok: false; value: SimulatorState; error: string };

export function persistSimulatorState(value: SimulatorState, storage?: StorageLike): PersistSimulatorStateResult {
  const normalized = migrateSimulatorState(value);
  const target = resolveStorage(storage);
  if (!target) return { ok: false, value: normalized, error: 'Локальное сохранение недоступно.' };

  try {
    const raw = target.getItem(ASTERION_SAVE_KEY);
    const envelope = raw ? JSON.parse(raw) as SaveEnvelope : {};
    const nextEnvelope: SaveEnvelope = {
      ...envelope,
      schemaVersion: COMBAT_SAVE_SCHEMA_VERSION,
      combatSimulator: normalized,
    };
    target.setItem(ASTERION_SAVE_KEY, JSON.stringify(nextEnvelope));

    if (typeof window !== 'undefined' && target === window.localStorage) {
      window.dispatchEvent(new CustomEvent<SimulatorState>(SIMULATOR_STATE_CHANGED_EVENT, { detail: normalized }));
    }

    return { ok: true, value: normalized };
  } catch (error) {
    return {
      ok: false,
      value: normalized,
      error: error instanceof Error ? error.message : 'Не удалось сохранить состояние симулятора.',
    };
  }
}

export function upsertSimulatorPreset(state: SimulatorState, preset: SimulatorPreset): SimulatorState {
  const normalizedPreset: SimulatorPreset = {
    id: preset.id,
    name: preset.name.trim().slice(0, 48),
    createdAt: preset.createdAt,
    input: normalizeSimulatorScenario(preset.input),
  };
  const without = state.presets.filter((item) => item.id !== normalizedPreset.id);
  return migrateSimulatorState({ ...state, presets: [...without, normalizedPreset] });
}

export function deleteSimulatorPreset(state: SimulatorState, presetId: string): SimulatorState {
  return migrateSimulatorState({ ...state, presets: state.presets.filter((preset) => preset.id !== presetId) });
}

export function withLastScenario(state: SimulatorState, scenario: SimulatorScenario): SimulatorState {
  return migrateSimulatorState({ ...state, lastScenario: normalizeSimulatorScenario(scenario) });
}
