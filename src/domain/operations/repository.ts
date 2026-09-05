import { createDefaultOperationInstances, createDerelictReveal, getOperationDefinition } from './catalog.ts';
import {
  OPERATION_ARCHETYPES,
  type OperationArchetype,
  type OperationId,
  type OperationInstance,
  type OperationIntelLevel,
  type OperationLocation,
  type OperationModifier,
  type OperationRewardPreview,
  type OperationsState,
  type OperationSource,
  type OperationState,
  type OperationThreatTier,
} from './types.ts';

const ASTERION_SAVE_KEY = 'asterion.vertical-slice.v1';
const OPERATION_STATES: readonly OperationState[] = ['available', 'active', 'completed'];
const OPERATION_INTEL_LEVELS: readonly OperationIntelLevel[] = [0, 1, 2, 3];
const OPERATION_THREAT_TIERS: readonly OperationThreatTier[] = [1, 2, 3, 4, 5, 6];
const OPERATION_SOURCES: readonly OperationSource[] = ['patrol_scan', 'deep_scan', 'sensor_network', 'science_scan'];
const OPERATION_MODIFIERS: readonly OperationModifier[] = [
  'sensor_interference',
  'fortified_position',
  'unstable_signal',
  'ion_storm',
  'unknown_contact',
];

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;
type SaveEnvelope = { operations?: unknown; [key: string]: unknown };

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isArchetype(value: unknown): value is OperationArchetype {
  return typeof value === 'string' && (OPERATION_ARCHETYPES as readonly string[]).includes(value);
}

function isState(value: unknown): value is OperationState {
  return typeof value === 'string' && (OPERATION_STATES as readonly string[]).includes(value);
}

function isIntel(value: unknown): value is OperationIntelLevel {
  return typeof value === 'number' && (OPERATION_INTEL_LEVELS as readonly number[]).includes(value);
}

function isThreat(value: unknown): value is OperationThreatTier {
  return typeof value === 'number' && (OPERATION_THREAT_TIERS as readonly number[]).includes(value);
}

function isSource(value: unknown): value is OperationSource {
  return typeof value === 'string' && (OPERATION_SOURCES as readonly string[]).includes(value);
}

function isModifier(value: unknown): value is OperationModifier {
  return typeof value === 'string' && (OPERATION_MODIFIERS as readonly string[]).includes(value);
}

function normalizeLocation(value: unknown, fallback: OperationLocation): OperationLocation {
  if (!isRecord(value) || typeof value.kind !== 'string') return { ...fallback } as OperationLocation;

  if (value.kind === 'system' && Number.isInteger(value.galaxy) && Number.isInteger(value.system)) {
    const galaxy = value.galaxy as number;
    const system = value.system as number;
    if (galaxy > 0 && system > 0) return { kind: 'system', galaxy, system };
  }

  if (value.kind === 'coordinates' && typeof value.coordinates === 'string' && value.coordinates.trim()) {
    return { kind: 'coordinates', coordinates: value.coordinates.trim().slice(0, 32) };
  }

  if (value.kind === 'abstract' && typeof value.label === 'string' && value.label.trim()) {
    return { kind: 'abstract', label: value.label.trim().slice(0, 64) };
  }

  return { ...fallback } as OperationLocation;
}

function normalizeReward(value: unknown, fallback: OperationRewardPreview): OperationRewardPreview {
  if (!isRecord(value)) {
    return { ...fallback, labels: fallback.labels ? [...fallback.labels] : undefined };
  }

  const readResource = (key: 'metal' | 'minerals' | 'gas') => {
    const candidate = value[key];
    return typeof candidate === 'number' && Number.isFinite(candidate) && candidate >= 0
      ? Math.floor(candidate)
      : fallback[key];
  };

  const labels = Array.isArray(value.labels)
    ? value.labels.filter((label): label is string => typeof label === 'string' && Boolean(label.trim())).map((label) => label.trim().slice(0, 64)).slice(0, 4)
    : fallback.labels ? [...fallback.labels] : undefined;

  return {
    metal: readResource('metal'),
    minerals: readResource('minerals'),
    gas: readResource('gas'),
    labels,
  };
}

function normalizeThreatRange(value: unknown, fallback?: [OperationThreatTier, OperationThreatTier]) {
  if (Array.isArray(value) && value.length === 2 && isThreat(value[0]) && isThreat(value[1]) && value[0] <= value[1]) {
    return [value[0], value[1]] as [OperationThreatTier, OperationThreatTier];
  }
  return fallback ? [...fallback] as [OperationThreatTier, OperationThreatTier] : undefined;
}

function normalizeOperation(value: unknown): OperationInstance | null {
  if (!isRecord(value) || typeof value.id !== 'string' || !value.id.trim() || !isArchetype(value.archetype)) return null;

  const id = value.id.trim().slice(0, 80);
  const definition = getOperationDefinition(value.archetype);
  const threat = value.archetype === 'unknown_signal'
    ? value.threat === null ? null : definition.threat
    : isThreat(value.threat) ? value.threat : definition.threat;
  const modifiers = Array.isArray(value.modifiers)
    ? value.modifiers.filter(isModifier).filter((modifier, index, all) => all.indexOf(modifier) === index)
    : [...definition.modifiers];

  return {
    id,
    archetype: value.archetype,
    category: definition.category,
    title: definition.title,
    briefing: definition.briefing,
    state: isState(value.state) ? value.state : 'available',
    threat,
    threatRange: normalizeThreatRange(value.threatRange, definition.threatRange),
    intel: isIntel(value.intel) ? value.intel : definition.intel,
    source: isSource(value.source) ? value.source : definition.source,
    location: normalizeLocation(value.location, definition.location),
    objective: { ...definition.objective },
    modifiers,
    rewardPreview: normalizeReward(value.rewardPreview, definition.rewardPreview),
    originSignalId: typeof value.originSignalId === 'string' && value.originSignalId.trim()
      ? value.originSignalId.trim().slice(0, 80)
      : undefined,
    battleReportId: typeof value.battleReportId === 'string' && value.battleReportId.trim()
      ? value.battleReportId.trim().slice(0, 120)
      : undefined,
  };
}

function resolveStorage(storage?: StorageLike): StorageLike | null {
  if (storage) return storage;
  if (typeof window === 'undefined') return null;
  return window.localStorage;
}

export function createDefaultOperationsState(): OperationsState {
  return { items: createDefaultOperationInstances() };
}

export function migrateOperationsState(value: unknown): OperationsState {
  if (!isRecord(value) || !Array.isArray(value.items)) return createDefaultOperationsState();

  const seen = new Set<string>();
  const items = value.items.flatMap((candidate) => {
    const normalized = normalizeOperation(candidate);
    if (!normalized || seen.has(normalized.id)) return [];
    seen.add(normalized.id);
    return [normalized];
  });

  return items.length ? { items } : createDefaultOperationsState();
}

export function acceptOperation(state: OperationsState, operationId: OperationId): OperationsState {
  const normalized = migrateOperationsState(state);
  return {
    items: normalized.items.map((operation) => {
      if (operation.id !== operationId || operation.state !== 'available' || operation.intel === 0) return operation;
      return { ...operation, state: 'active' };
    }),
  };
}

export function cancelOperation(state: OperationsState, operationId: OperationId): OperationsState {
  const normalized = migrateOperationsState(state);
  return {
    items: normalized.items.map((operation) => operation.id === operationId && operation.state === 'active'
      ? { ...operation, state: 'available' }
      : operation),
  };
}

export function revealOperation(state: OperationsState, operationId: OperationId): OperationsState {
  const normalized = migrateOperationsState(state);
  return {
    items: normalized.items.map((operation) => {
      if (operation.id !== operationId || operation.archetype !== 'unknown_signal' || operation.intel !== 0) return operation;
      return {
        ...createDerelictReveal(operation.id),
        state: operation.state,
      };
    }),
  };
}

export function readOperationsState(storage?: StorageLike): OperationsState {
  const target = resolveStorage(storage);
  if (!target) return createDefaultOperationsState();

  try {
    const raw = target.getItem(ASTERION_SAVE_KEY);
    if (!raw) return createDefaultOperationsState();
    const envelope = JSON.parse(raw) as SaveEnvelope;
    return migrateOperationsState(envelope.operations);
  } catch {
    return createDefaultOperationsState();
  }
}

export type PersistOperationsResult =
  | { ok: true; value: OperationsState }
  | { ok: false; value: OperationsState; error: string };

export function persistOperationsState(value: OperationsState, storage?: StorageLike): PersistOperationsResult {
  const normalized = migrateOperationsState(value);
  const target = resolveStorage(storage);
  if (!target) return { ok: false, value: normalized, error: 'Локальное сохранение недоступно.' };

  try {
    const raw = target.getItem(ASTERION_SAVE_KEY);
    const envelope = raw ? JSON.parse(raw) as SaveEnvelope : {};
    target.setItem(ASTERION_SAVE_KEY, JSON.stringify({ ...envelope, operations: normalized }));
    return { ok: true, value: normalized };
  } catch (error) {
    return {
      ok: false,
      value: normalized,
      error: error instanceof Error ? error.message : 'Не удалось сохранить операции.',
    };
  }
}
