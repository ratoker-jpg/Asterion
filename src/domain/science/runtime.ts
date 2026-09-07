import { SCIENCE_CATALOG, findScience } from './catalog.ts';
import type {
  ScienceCatalogDefinition,
  ScienceId,
  ScienceResourceCost,
} from './types.ts';

export type { ScienceId } from './types.ts';

export const SCIENCE_SAVE_KEY = 'asterion.vertical-slice.v1';
export const SCIENCE_SAVE_SCHEMA_VERSION = 9;
export const SCIENCE_QUEUE_CAPACITY = 3;

/**
 * The source capture exposes the currently visible level and its next level,
 * but does not establish a final campaign maximum. This cap is intentionally
 * temporary and must be source-validated before balance is considered final.
 */
export const SCIENCE_CAPTURED_VALUES_NOTE =
  'PROTOTYPE: captured next-level values are used as a temporary research cap until source validation.';

export type ScienceLevels = Partial<Record<ScienceId, number>>;

export type ScienceQueueTask = {
  id: string;
  scienceId: ScienceId;
  fromLevel: number;
  toLevel: number;
  startedAt: number;
  finishAt: number;
  durationMs: number;
  cost: ScienceResourceCost;
};

export type ScienceState = {
  levels: ScienceLevels;
  queue: ScienceQueueTask[];
};

export type ScienceWallet = ScienceResourceCost;

export type ScienceRequirementState = {
  kind: 'laboratory-level' | 'science-level';
  label: string;
  requiredLevel: number;
  currentLevel: number;
  met: boolean;
  scienceId?: ScienceId;
};

export type ScienceAvailabilityStatus =
  | 'available'
  | 'requirements-unmet'
  | 'insufficient-resource'
  | 'queue-full'
  | 'max-level';

export type SciencePreview = {
  status: ScienceAvailabilityStatus;
  canStart: boolean;
  reason: string | null;
  scienceId: ScienceId;
  currentLevel: number;
  projectedLevel: number;
  nextLevel: number | null;
  maxLevel: number;
  queuedCount: number;
  requirements: readonly ScienceRequirementState[];
  cost: ScienceResourceCost;
  durationMs: number;
};

export type ScienceRuntimeContext = {
  state: ScienceState;
  wallet: ScienceWallet;
  laboratoryLevel: number;
  now: number;
};

export type ScienceStartTransition = {
  ok: boolean;
  state: ScienceState;
  wallet: ScienceWallet;
  task: ScienceQueueTask | null;
  reason: string | null;
};

export type ScienceReconciliation = {
  changed: boolean;
  state: ScienceState;
  completed: ScienceQueueTask[];
  discarded: ScienceQueueTask[];
};

export type ScienceRuntimeSnapshot = {
  science: ScienceState;
  wallet: ScienceWallet;
  laboratoryLevel: number;
  now: number;
};

export type ScienceStartRequest = {
  scienceId: ScienceId;
  now: number;
};

export const SCIENCE_RUNTIME_CHANGED_EVENT = 'asterion:science-runtime-changed';
export const SCIENCE_START_REQUEST_EVENT = 'asterion:science-start-request';

const RESOURCE_KEYS: readonly (keyof ScienceResourceCost)[] = ['metal', 'minerals', 'gas', 'energy'];
const RESOURCE_LABELS: Record<keyof ScienceResourceCost, string> = {
  metal: 'металла',
  minerals: 'минералов',
  gas: 'газа',
  energy: 'энергии',
};
const SCIENCE_IDS = new Set<number>(SCIENCE_CATALOG.map((science) => science.id));

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function safeNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function safeNonNegativeNumber(value: unknown, fallback: number): number {
  return Math.max(0, safeNumber(value, fallback));
}

function safeLevel(value: unknown, maxLevel: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  return Math.min(maxLevel, Math.max(0, Math.floor(value)));
}

function safeTimestamp(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

function safeDuration(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return fallback;
  return Math.max(1, Math.round(value));
}

function parseCapturedTime(value: string): number {
  const parts = value.split(':').map((part) => Number(part));
  if (parts.length !== 3 || parts.some((part) => !Number.isFinite(part) || part < 0)) return 1_000;
  const [hours, minutes, seconds] = parts;
  return Math.max(1_000, Math.round((hours * 60 * 60 + minutes * 60 + seconds) * 1_000));
}

function isScienceId(value: unknown): value is ScienceId {
  return typeof value === 'number' && Number.isInteger(value) && SCIENCE_IDS.has(value);
}

function scienceIdFromUnknown(value: unknown): ScienceId | null {
  const numeric = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : NaN;
  return isScienceId(numeric) ? numeric : null;
}

function cloneCost(cost: ScienceResourceCost): ScienceResourceCost {
  return { metal: cost.metal, minerals: cost.minerals, gas: cost.gas, energy: cost.energy };
}

export function getSciencePrototypeMaxLevel(science: ScienceCatalogDefinition): number {
  return Math.max(science.capturedLevel, science.capturedNextLevel);
}

export function createDefaultScienceLevels(): ScienceLevels {
  return Object.fromEntries(
    SCIENCE_CATALOG.map((science) => [science.id, safeLevel(science.capturedLevel, getSciencePrototypeMaxLevel(science))]),
  ) as ScienceLevels;
}

export function createDefaultScienceState(): ScienceState {
  return { levels: createDefaultScienceLevels(), queue: [] };
}

export function migrateScienceLevels(value: unknown): ScienceLevels {
  const source = isRecord(value) ? value : {};
  return Object.fromEntries(
    SCIENCE_CATALOG.map((science) => [
      science.id,
      safeLevel(
        source[String(science.id)] === undefined ? science.capturedLevel : source[String(science.id)],
        getSciencePrototypeMaxLevel(science),
      ),
    ]),
  ) as ScienceLevels;
}

function requirementsFor(
  science: ScienceCatalogDefinition,
  levels: ScienceLevels,
  laboratoryLevel: number,
): ScienceRequirementState[] {
  const requirements: ScienceRequirementState[] = [{
    kind: 'laboratory-level',
    label: 'Лаборатория',
    requiredLevel: science.laboratoryLevel,
    currentLevel: laboratoryLevel,
    met: laboratoryLevel >= science.laboratoryLevel,
  }];

  for (const prerequisite of science.prerequisites) {
    const definition = findScience(prerequisite.scienceId);
    const currentLevel = levels[prerequisite.scienceId] ?? 0;
    requirements.push({
      kind: 'science-level',
      scienceId: prerequisite.scienceId,
      label: definition?.name ?? `Наука ${prerequisite.scienceId}`,
      requiredLevel: prerequisite.level,
      currentLevel,
      met: currentLevel >= prerequisite.level,
    });
  }

  return requirements;
}

function formatRequirement(requirement: ScienceRequirementState): string {
  return `${requirement.label} — уровень ${requirement.requiredLevel}; сейчас ${requirement.currentLevel}`;
}

function missingResource(wallet: ScienceWallet, cost: ScienceResourceCost): keyof ScienceResourceCost | null {
  return RESOURCE_KEYS.find((key) => wallet[key] < cost[key]) ?? null;
}

export function previewScience(context: ScienceRuntimeContext, scienceId: ScienceId): SciencePreview {
  const science = findScience(scienceId);
  if (!science) throw new Error(`Unknown science id: ${scienceId}`);

  const maxLevel = getSciencePrototypeMaxLevel(science);
  const currentLevel = safeLevel(context.state.levels[scienceId], maxLevel);
  const queuedCount = context.state.queue.filter((task) => task.scienceId === scienceId).length;
  const projectedLevel = Math.min(maxLevel, currentLevel + queuedCount);
  const requirements = requirementsFor(science, context.state.levels, Math.max(0, Math.floor(context.laboratoryLevel)));
  const cost = cloneCost(science.capturedCost);
  const durationMs = parseCapturedTime(science.capturedTime);
  const base = {
    scienceId,
    currentLevel,
    projectedLevel,
    nextLevel: projectedLevel < maxLevel ? projectedLevel + 1 : null,
    maxLevel,
    queuedCount,
    requirements,
    cost,
    durationMs,
  };

  if (projectedLevel >= maxLevel) {
    return { ...base, status: 'max-level', canStart: false, reason: 'Достигнут максимальный уровень.' };
  }

  const missingRequirements = requirements.filter((requirement) => !requirement.met);
  if (missingRequirements.length > 0) {
    return {
      ...base,
      status: 'requirements-unmet',
      canStart: false,
      reason: `Требуется: ${missingRequirements.map(formatRequirement).join('; ')}.`,
    };
  }

  if (context.state.queue.length >= SCIENCE_QUEUE_CAPACITY) {
    return { ...base, status: 'queue-full', canStart: false, reason: 'Очередь исследований заполнена.' };
  }

  const missing = missingResource(context.wallet, cost);
  if (missing) {
    return {
      ...base,
      status: 'insufficient-resource',
      canStart: false,
      reason: `Недостаточно ${RESOURCE_LABELS[missing]}.`,
    };
  }

  return { ...base, status: 'available', canStart: true, reason: null };
}

export function startScienceResearch(
  context: ScienceRuntimeContext,
  scienceId: ScienceId,
  taskId: string,
): ScienceStartTransition {
  const preview = previewScience(context, scienceId);
  if (!preview.canStart || preview.nextLevel == null) {
    return { ok: false, state: context.state, wallet: context.wallet, task: null, reason: preview.reason };
  }

  const lastTask = context.state.queue.at(-1) ?? null;
  const startedAt = Math.max(context.now, lastTask?.finishAt ?? context.now);
  const task: ScienceQueueTask = {
    id: taskId,
    scienceId,
    fromLevel: preview.projectedLevel,
    toLevel: preview.nextLevel,
    startedAt,
    finishAt: startedAt + preview.durationMs,
    durationMs: preview.durationMs,
    cost: cloneCost(preview.cost),
  };
  const wallet = { ...context.wallet };
  for (const key of RESOURCE_KEYS) wallet[key] -= preview.cost[key];

  return {
    ok: true,
    state: { ...context.state, queue: [...context.state.queue, task] },
    wallet,
    task,
    reason: null,
  };
}

export function reconcileScienceState(state: ScienceState, now: number): ScienceReconciliation {
  let queue = [...state.queue];
  const levels = { ...state.levels };
  const completed: ScienceQueueTask[] = [];
  const discarded: ScienceQueueTask[] = [];
  let changed = false;

  while (queue.length > 0 && queue[0].finishAt <= now) {
    const task = queue[0];
    queue = queue.slice(1);
    changed = true;
    const science = findScience(task.scienceId);
    if (!science) {
      discarded.push(task);
      continue;
    }

    const maxLevel = getSciencePrototypeMaxLevel(science);
    const currentLevel = safeLevel(levels[task.scienceId], maxLevel);
    if (currentLevel >= task.toLevel) {
      discarded.push(task);
      continue;
    }

    levels[task.scienceId] = Math.min(maxLevel, Math.max(currentLevel, task.toLevel));
    completed.push(task);
  }

  return { changed, state: { levels, queue }, completed, discarded };
}

function migrateQueue(value: unknown, levels: ScienceLevels): ScienceQueueTask[] {
  const source = Array.isArray(value) ? value : [];
  const result: ScienceQueueTask[] = [];
  const queuedPerScience: Partial<Record<ScienceId, number>> = {};
  let previousFinishAt: number | null = null;

  for (const raw of source) {
    if (result.length >= SCIENCE_QUEUE_CAPACITY || !isRecord(raw)) break;
    const scienceId = scienceIdFromUnknown(raw.scienceId);
    if (scienceId == null) continue;
    const science = findScience(scienceId);
    if (!science) continue;

    const maxLevel = getSciencePrototypeMaxLevel(science);
    const currentLevel = safeLevel(levels[scienceId], maxLevel);
    const queuedBefore = queuedPerScience[scienceId] ?? 0;
    const expectedFromLevel = Math.min(maxLevel, currentLevel + queuedBefore);
    const persistedFromLevel = typeof raw.fromLevel === 'number' && Number.isFinite(raw.fromLevel)
      ? Math.floor(raw.fromLevel)
      : null;
    const persistedToLevel = typeof raw.toLevel === 'number' && Number.isFinite(raw.toLevel)
      ? Math.floor(raw.toLevel)
      : null;

    // A migration must not turn an already-applied 0 → 1 task into 1 → 2.
    if (persistedToLevel != null && safeLevel(persistedToLevel, maxLevel) <= currentLevel) continue;
    if (expectedFromLevel >= maxLevel) continue;

    const transitionIsValid = persistedFromLevel != null
      && persistedToLevel != null
      && persistedToLevel === persistedFromLevel + 1
      && persistedFromLevel === expectedFromLevel
      && safeLevel(persistedToLevel, maxLevel) === expectedFromLevel + 1;
    const fromLevel = transitionIsValid ? safeLevel(persistedFromLevel, maxLevel) : expectedFromLevel;
    if (fromLevel >= maxLevel) continue;

    const durationMs = safeDuration(raw.durationMs, parseCapturedTime(science.capturedTime));
    const rawStartedAt = safeTimestamp(raw.startedAt);
    const startedAt: number = previousFinishAt == null ? (rawStartedAt ?? 0) : previousFinishAt;
    const rawFinishAt = safeTimestamp(raw.finishAt);
    const finishAt: number = rawFinishAt != null && rawFinishAt >= startedAt
      ? rawFinishAt
      : startedAt + durationMs;
    const costSource = isRecord(raw.cost) ? raw.cost : science.capturedCost;
    const cost = Object.fromEntries(
      RESOURCE_KEYS.map((key) => [key, safeNonNegativeNumber(costSource[key], science.capturedCost[key])]),
    ) as ScienceResourceCost;
    const id = typeof raw.id === 'string' && raw.id.trim()
      ? raw.id
      : `migrated-science-${scienceId}-${result.length}-${startedAt}`;

    result.push({
      id,
      scienceId,
      fromLevel,
      toLevel: fromLevel + 1,
      startedAt,
      finishAt,
      durationMs,
      cost,
    });
    queuedPerScience[scienceId] = queuedBefore + 1;
    previousFinishAt = finishAt;
  }

  return result;
}

export function migrateScienceState(value: unknown): ScienceState {
  if (!isRecord(value)) return createDefaultScienceState();
  const levels = migrateScienceLevels(value.levels ?? value.scienceLevels);
  return { levels, queue: migrateQueue(value.queue, levels) };
}

export function createScienceRuntimeSnapshot(
  science: ScienceState,
  wallet: ScienceWallet,
  laboratoryLevel: number,
  now: number,
): ScienceRuntimeSnapshot {
  return {
    science,
    wallet: cloneCost(wallet),
    laboratoryLevel: Math.max(0, Math.floor(laboratoryLevel)),
    now,
  };
}

export function readScienceRuntimeSnapshot(): ScienceRuntimeSnapshot {
  const fallback = createScienceRuntimeSnapshot(createDefaultScienceState(), { metal: 0, minerals: 0, gas: 0, energy: 0 }, 0, Date.now());
  if (typeof localStorage === 'undefined') return fallback;

  try {
    const raw = localStorage.getItem(SCIENCE_SAVE_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const planets = isRecord(parsed.planets) ? parsed.planets : {};
    const homeworld = isRecord(planets['helion-01']) ? planets['helion-01'] : {};
    const buildings = isRecord(homeworld.buildings) ? homeworld.buildings : {};
    return createScienceRuntimeSnapshot(
      migrateScienceState(parsed.science),
      {
        metal: safeNonNegativeNumber(parsed.metal, 0),
        minerals: safeNonNegativeNumber(parsed.minerals, 0),
        gas: safeNonNegativeNumber(parsed.gas, 0),
        energy: safeNonNegativeNumber(homeworld.energy, 0),
      },
      safeNonNegativeNumber(buildings.research, 0),
      Date.now(),
    );
  } catch {
    return fallback;
  }
}
