import { COMBAT_ENTITY_BY_ID, getCombatEntity } from './catalog.ts';
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
  const counts = new Map<CombatEntityId, number>();

  value.forEach((candidate) => {
    if (!candidate || typeof candidate !== 'object') return;
    const entityId = (candidate as { entityId?: unknown }).entityId;
    const count = (candidate as { count?: unknown }).count;
    if (typeof entityId !== 'string' || !COMBAT_ENTITY_BY_ID.has(entityId as CombatEntityId)) return;
    const id = entityId as CombatEntityId;
    if (getCombatEntity(id).kind !== kind) return;
    if (!Number.isFinite(count) || !Number.isInteger(count) || (count as number) <= 0) return;
    counts.set(id, (counts.get(id) ?? 0) + (count as number));
  });

  return [...counts.entries()].map(([entityId, count]) => ({ entityId, count }));
}

export function normalizeSimulatorScenario(value: unknown): SimulatorScenario {
  if (!value || typeof value !== 'object') return createEmptySimulatorScenario();
  const candidate = value as {
    attackerFactionId?: unknown;
    defenderFactionId?: unknown;
    attacker?: { ships?: unknown; commanders?: unknown };
    defender?: { ships?: unknown; commanders?: unknown; defenses?: unknown };
    maxRounds?: unknown;
  };

  return {
    attackerFactionId: normalizeCombatFactionId(candidate.attackerFactionId),
    defenderFactionId: normalizeCombatFactionId(candidate.defenderFactionId),
    attacker: {
      ships: normalizeStacks(candidate.attacker?.ships, 'ship'),
      commanders: normalizeStacks(candidate.attacker?.commanders, 'commander'),
    },
    defender: {
      ships: normalizeStacks(candidate.defender?.ships, 'ship'),
      commanders: normalizeStacks(candidate.defender?.commanders, 'commander'),
      defenses: normalizeStacks(candidate.defender?.defenses, 'defense'),
    },
    maxRounds: isMaxRounds(candidate.maxRounds) ? candidate.maxRounds : 8,
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
