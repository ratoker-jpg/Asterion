import { SCIENCE_CATALOG, findScience } from './catalog.ts';
import type {
  ScienceCatalogDefinition,
  ScienceId,
  ScienceResourceCost,
} from './types.ts';
import { ACTIVE_RUNTIME_MODE, getRuntimeSaveKey, scaleRuntimeDuration, type RuntimeMode } from '../runtime/mode.ts';

export type { ScienceId } from './types.ts';

export const SCIENCE_SAVE_KEY = getRuntimeSaveKey('production');
export const SCIENCE_SAVE_SCHEMA_VERSION = 10;
export const SCIENCE_QUEUE_CAPACITY = 3;

export const SCIENCE_PROTOTYPE_CONFIG = Object.freeze({
  laboratoryMaxLevel: 20,
  laboratoryTimeReductionPerLevel: 0.05,
  note: 'Канонические максимумы науки заданы в каталоге; стоимость и время исследования пока остаются captured/prototype-значениями.',
});

export const SCIENCE_CAPTURED_VALUES_NOTE = SCIENCE_PROTOTYPE_CONFIG.note;
export const SCIENCE_LABORATORY_MAX_LEVEL = SCIENCE_PROTOTYPE_CONFIG.laboratoryMaxLevel;
export const SCIENCE_LABORATORY_TIME_REDUCTION_PER_LEVEL = SCIENCE_PROTOTYPE_CONFIG.laboratoryTimeReductionPerLevel;

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
  | 'additional-direction-blocked'
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
  mode?: RuntimeMode;
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
  mode: RuntimeMode;
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

export function getScienceMaxLevel(science: ScienceCatalogDefinition): number {
  return science.maxLevel;
}

/** @deprecated Use getScienceMaxLevel; retained for save/test compatibility. */
export const getSciencePrototypeMaxLevel = getScienceMaxLevel;

export function calculateScienceDurationMs(
  baseDurationMs: number,
  laboratoryLevel: number,
  mode: RuntimeMode = 'production',
): number {
  const safeBaseDuration = Math.max(1, Math.round(baseDurationMs));
  const safeLaboratoryLevel = Math.min(
    SCIENCE_LABORATORY_MAX_LEVEL,
    Math.max(0, Math.floor(laboratoryLevel)),
  );
  const laboratoryFactor = (1 - SCIENCE_LABORATORY_TIME_REDUCTION_PER_LEVEL) ** safeLaboratoryLevel;
  return scaleRuntimeDuration(Math.max(1, Math.round(safeBaseDuration * laboratoryFactor)), mode);
}

export function createDefaultScienceLevels(): ScienceLevels {
  return Object.fromEntries(
    SCIENCE_CATALOG.map((science) => [science.id, 0]),
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
        source[String(science.id)],
        getScienceMaxLevel(science),
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

  const maxLevel = getScienceMaxLevel(science);
  const currentLevel = safeLevel(context.state.levels[scienceId], maxLevel);
  const queuedCount = context.state.queue.filter((task) => task.scienceId === scienceId).length;
  const projectedLevel = Math.min(maxLevel, currentLevel + queuedCount);
  const requirements = requirementsFor(science, context.state.levels, Math.max(0, Math.floor(context.laboratoryLevel)));
  const cost = cloneCost(science.capturedCost);
  const durationMs = calculateScienceDurationMs(
    parseCapturedTime(science.capturedTime),
    context.laboratoryLevel,
    context.mode ?? 'production',
  );
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

  const additionalDirectionIds = new Set<ScienceId>([18, 19, 20]);
  if (additionalDirectionIds.has(scienceId)) {
    const competingDirection = [...additionalDirectionIds].find((id) => id !== scienceId && (
      (context.state.levels[id] ?? 0) > 0
      || context.state.queue.some((task) => task.scienceId === id)
    ));
    if (competingDirection != null) {
      return {
        ...base,
        status: 'additional-direction-blocked',
        canStart: false,
        reason: 'Дополнительная наука доступна только в одном направлении за кампанию.',
      };
    }
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

    const maxLevel = getScienceMaxLevel(science);
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
    if (result.length >= SCIENCE_QUEUE_CAPACITY) break;
    if (!isRecord(raw)) continue;
    const scienceId = scienceIdFromUnknown(raw.scienceId);
    if (scienceId == null) continue;
    const science = findScience(scienceId);
    if (!science) continue;

    const maxLevel = getScienceMaxLevel(science);
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
  mode: RuntimeMode = 'production',
): ScienceRuntimeSnapshot {
  return {
    science,
    wallet: cloneCost(wallet),
    laboratoryLevel: Math.min(SCIENCE_LABORATORY_MAX_LEVEL, Math.max(0, Math.floor(laboratoryLevel))),
    now,
    mode,
  };
}

export function readScienceRuntimeSnapshot(): ScienceRuntimeSnapshot {
  const fallback = createScienceRuntimeSnapshot(createDefaultScienceState(), { metal: 0, minerals: 0, gas: 0, energy: 0 }, 0, Date.now(), ACTIVE_RUNTIME_MODE);
  if (typeof localStorage === 'undefined') return fallback;

  try {
    const raw = localStorage.getItem(getRuntimeSaveKey());
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
      ACTIVE_RUNTIME_MODE,
    );
  } catch {
    return fallback;
  }
}
