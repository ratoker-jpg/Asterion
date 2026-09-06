import type { BuildingLevels } from './resource-zone.ts';

export const RECYCLING_MAX_LEVEL = 10;
export const RECYCLING_INITIAL_DEBRIS = 100_000;
export const RECYCLING_STORAGE_MS = 24 * 60 * 60 * 1000;
export const RECYCLING_DURATION_PER_MILLION_MS = 3 * 60 * 60 * 1000;
export const RECYCLING_RESOURCES = ['metal', 'minerals', 'gas'] as const;

export type RecyclingResource = (typeof RECYCLING_RESOURCES)[number];

export type ResourceAllocationPercent = {
  metal: number;
  minerals: number;
  gas: number;
};

export type RecyclingOutput = {
  metal: number;
  minerals: number;
  gas: number;
};

export type RecyclingJob = {
  id: string;
  debrisAmount: number;
  allocationPercent: ResourceAllocationPercent;
  efficiencyPercent: number;
  output: RecyclingOutput;
  startedAt: number;
  finishAt: number;
  collectExpiresAt: number | null;
  status: 'processing' | 'ready';
};

export type RecyclingState = {
  availableDebris: number;
  jobs: RecyclingJob[];
};

export type RecyclingStartValidation = {
  canStart: boolean;
  reason: string | null;
};

export type RecyclingStartTransition = RecyclingStartValidation & {
  state: RecyclingState;
  job: RecyclingJob | null;
};

export type RecyclingAdvanceTransition = {
  state: RecyclingState;
  changed: boolean;
  autoCollectedJobIds: string[];
  autoCollectedOutput: RecyclingOutput;
};

export type RecyclingCollectTransition = {
  ok: boolean;
  state: RecyclingState;
  output: RecyclingOutput | null;
  reason: string | null;
};

function toNonNegativeInteger(value: unknown, fallback = 0): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.max(0, Math.floor(value));
}

function toSafeTimestamp(value: unknown, fallback = 0): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return fallback;
  return Math.floor(value);
}

function toSafePercent(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, Math.floor(value)));
}

function toSafeEfficiency(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 75;
  return Math.min(120, Math.max(75, Math.floor(value)));
}

function createEmptyRecyclingOutput(): RecyclingOutput {
  return { metal: 0, minerals: 0, gas: 0 };
}

function addRecyclingOutput(target: RecyclingOutput, output: RecyclingOutput) {
  target.metal += output.metal;
  target.minerals += output.minerals;
  target.gas += output.gas;
}

export function createEmptyRecyclingAllocation(): ResourceAllocationPercent {
  return { metal: 0, minerals: 0, gas: 0 };
}

export function createDefaultRecyclingState(): RecyclingState {
  return {
    availableDebris: RECYCLING_INITIAL_DEBRIS,
    jobs: [],
  };
}

export function getRecyclingLevel(buildings: Pick<BuildingLevels, 'recycling'>): number {
  return Math.min(RECYCLING_MAX_LEVEL, Math.max(0, Math.floor(buildings.recycling ?? 0)));
}

export function getRecyclingEfficiencyPercent(level: number): number {
  const safeLevel = Math.min(RECYCLING_MAX_LEVEL, Math.max(1, Math.floor(level || 1)));
  return 75 + (safeLevel - 1) * 5;
}

export function getRecyclingMaxConcurrentJobs(level: number): number {
  return Math.min(RECYCLING_MAX_LEVEL, Math.max(0, Math.floor(level || 0)));
}

export function getRecyclingDurationMs(debrisAmount: number): number {
  const safeAmount = Math.max(0, Number.isFinite(debrisAmount) ? debrisAmount : 0);
  const rawDuration = safeAmount / 1_000_000 * RECYCLING_DURATION_PER_MILLION_MS;
  return Math.max(1000, Math.ceil(rawDuration / 1000) * 1000);
}

export function getRecyclingAllocationTotal(allocation: ResourceAllocationPercent): number {
  return RECYCLING_RESOURCES.reduce((total, resource) => total + allocation[resource], 0);
}

export function isRecyclingAllocationValid(allocation: ResourceAllocationPercent): boolean {
  return RECYCLING_RESOURCES.every((resource) => {
    const value = allocation[resource];
    return Number.isInteger(value) && value >= 0 && value <= 100;
  }) && getRecyclingAllocationTotal(allocation) === 100;
}

export function normalizeRecyclingAllocation(value: unknown): ResourceAllocationPercent {
  const source = value && typeof value === 'object'
    ? value as Partial<Record<RecyclingResource, unknown>>
    : {};
  const metal = toSafePercent(source.metal);
  const minerals = toSafePercent(source.minerals);
  const gas = toSafePercent(source.gas);
  const total = metal + minerals + gas;
  if (total === 100) return { metal, minerals, gas };

  if (metal + minerals <= 100) {
    return { metal, minerals, gas: 100 - metal - minerals };
  }

  return { metal: 100, minerals: 0, gas: 0 };
}

export function getRecyclingOutput(
  debrisAmount: number,
  efficiencyPercent: number,
  allocationPercent: ResourceAllocationPercent,
): RecyclingOutput {
  const safeDebris = toNonNegativeInteger(debrisAmount);
  const safeEfficiency = toSafeEfficiency(efficiencyPercent);
  const allocation = normalizeRecyclingAllocation(allocationPercent);
  const totalOutput = Math.floor(safeDebris * safeEfficiency / 100);
  const metal = Math.floor(totalOutput * allocation.metal / 100);
  const minerals = Math.floor(totalOutput * allocation.minerals / 100);
  const gas = totalOutput - metal - minerals;
  return { metal, minerals, gas };
}

export function getRecyclingTotalOutput(debrisAmount: number, efficiencyPercent: number): number {
  return Math.floor(toNonNegativeInteger(debrisAmount) * toSafeEfficiency(efficiencyPercent) / 100);
}

export function getRecyclingPreviewResourceOutput(
  debrisAmount: number,
  efficiencyPercent: number,
  percent: number,
): number {
  return Math.floor(getRecyclingTotalOutput(debrisAmount, efficiencyPercent) * toSafePercent(percent) / 100);
}

function migrateRecyclingJob(value: unknown, index: number, now: number): RecyclingJob | null {
  if (!value || typeof value !== 'object') return null;
  const source = value as Record<string, unknown>;
  const debrisAmount = toNonNegativeInteger(source.debrisAmount);
  if (debrisAmount <= 0) return null;

  const allocationPercent = normalizeRecyclingAllocation(source.allocationPercent);
  const efficiencyPercent = toSafeEfficiency(source.efficiencyPercent);
  const startedAt = toSafeTimestamp(source.startedAt);
  const finishAt = startedAt + getRecyclingDurationMs(debrisAmount);
  const canonicalExpiresAt = finishAt + RECYCLING_STORAGE_MS;
  const status: RecyclingJob['status'] = now >= finishAt ? 'ready' : 'processing';
  const id = typeof source.id === 'string' && source.id.trim()
    ? source.id.trim().slice(0, 120)
    : `recycling-migrated-${startedAt}-${index}`;

  return {
    id,
    debrisAmount,
    allocationPercent,
    efficiencyPercent,
    output: getRecyclingOutput(debrisAmount, efficiencyPercent, allocationPercent),
    startedAt,
    finishAt,
    collectExpiresAt: status === 'ready' ? canonicalExpiresAt : null,
    status,
  };
}

export function migrateRecyclingState(
  value: unknown,
  recyclingLevel: number,
  now = Date.now(),
): RecyclingState {
  const source = value && typeof value === 'object' ? value as Record<string, unknown> : null;
  const availableDebris = source
    ? toNonNegativeInteger(source.availableDebris)
    : RECYCLING_INITIAL_DEBRIS;
  const maxJobs = getRecyclingMaxConcurrentJobs(recyclingLevel);
  const sourceJobs = source && Array.isArray(source.jobs) ? source.jobs : [];
  const jobs: RecyclingJob[] = [];

  for (const sourceJob of sourceJobs) {
    if (jobs.length >= maxJobs) break;
    const migrated = migrateRecyclingJob(sourceJob, jobs.length, now);
    if (migrated) jobs.push(migrated);
  }

  return { availableDebris, jobs };
}

export function advanceRecyclingState(state: RecyclingState, now: number): RecyclingAdvanceTransition {
  const jobs: RecyclingJob[] = [];
  const autoCollectedJobIds: string[] = [];
  const autoCollectedOutput = createEmptyRecyclingOutput();
  let changed = false;

  for (const job of state.jobs) {
    const autoCollectAt = job.finishAt + RECYCLING_STORAGE_MS;
    if (now >= autoCollectAt) {
      autoCollectedJobIds.push(job.id);
      addRecyclingOutput(autoCollectedOutput, job.output);
      changed = true;
      continue;
    }

    if (now >= job.finishAt) {
      const alreadyCanonical = job.status === 'ready' && job.collectExpiresAt === autoCollectAt;
      jobs.push(alreadyCanonical ? job : { ...job, status: 'ready', collectExpiresAt: autoCollectAt });
      if (!alreadyCanonical) changed = true;
      continue;
    }

    const alreadyCanonical = job.status === 'processing' && job.collectExpiresAt === null;
    jobs.push(alreadyCanonical ? job : { ...job, status: 'processing', collectExpiresAt: null });
    if (!alreadyCanonical) changed = true;
  }

  return {
    state: changed ? { ...state, jobs } : state,
    changed,
    autoCollectedJobIds,
    autoCollectedOutput,
  };
}

export function getRecyclingStartValidation(
  state: RecyclingState,
  recyclingLevel: number,
  debrisAmount: number,
  allocationPercent: ResourceAllocationPercent,
): RecyclingStartValidation {
  const amount = toNonNegativeInteger(debrisAmount);
  if (amount <= 0) return { canStart: false, reason: 'Выберите объём обломков' };
  if (amount > state.availableDebris) return { canStart: false, reason: 'Недостаточно свободных обломков' };

  const allocationTotal = getRecyclingAllocationTotal(allocationPercent);
  if (!RECYCLING_RESOURCES.every((resource) => Number.isInteger(allocationPercent[resource]) && allocationPercent[resource] >= 0 && allocationPercent[resource] <= 100)) {
    return { canStart: false, reason: 'Проценты должны быть от 0 до 100' };
  }
  if (allocationTotal < 100) return { canStart: false, reason: `Распределите оставшиеся ${100 - allocationTotal}%` };
  if (allocationTotal > 100) return { canStart: false, reason: `Уменьшите распределение на ${allocationTotal - 100}%` };

  const maxJobs = getRecyclingMaxConcurrentJobs(recyclingLevel);
  if (maxJobs <= 0) return { canStart: false, reason: 'Перерабатывающий центр не построен' };
  if (state.jobs.length >= maxJobs) return { canStart: false, reason: 'Все процессы заняты' };

  return { canStart: true, reason: null };
}

export function startRecyclingJob(
  state: RecyclingState,
  recyclingLevel: number,
  debrisAmount: number,
  allocationPercent: ResourceAllocationPercent,
  startedAt: number,
  jobId: string,
): RecyclingStartTransition {
  const validation = getRecyclingStartValidation(state, recyclingLevel, debrisAmount, allocationPercent);
  if (!validation.canStart) return { ...validation, state, job: null };

  const amount = toNonNegativeInteger(debrisAmount);
  const allocation = { ...allocationPercent };
  const efficiencyPercent = getRecyclingEfficiencyPercent(recyclingLevel);
  const finishAt = startedAt + getRecyclingDurationMs(amount);
  const job: RecyclingJob = {
    id: jobId,
    debrisAmount: amount,
    allocationPercent: allocation,
    efficiencyPercent,
    output: getRecyclingOutput(amount, efficiencyPercent, allocation),
    startedAt,
    finishAt,
    collectExpiresAt: null,
    status: 'processing',
  };

  return {
    canStart: true,
    reason: null,
    job,
    state: {
      availableDebris: state.availableDebris - amount,
      jobs: [...state.jobs, job],
    },
  };
}

export function collectRecyclingJob(
  state: RecyclingState,
  jobId: string,
  now: number,
): RecyclingCollectTransition {
  const job = state.jobs.find((candidate) => candidate.id === jobId);
  if (!job) {
    return {
      ok: false,
      state,
      output: null,
      reason: 'Процесс не найден',
    };
  }
  if (now < job.finishAt) {
    return { ok: false, state, output: null, reason: 'Переработка ещё не завершена' };
  }

  return {
    ok: true,
    state: { ...state, jobs: state.jobs.filter((candidate) => candidate.id !== job.id) },
    output: { ...job.output },
    reason: null,
  };
}

export function addRecyclingDebris(state: RecyclingState, debrisAmount: number): RecyclingState {
  const amount = toNonNegativeInteger(debrisAmount);
  if (amount <= 0) return state;
  return { ...state, availableDebris: state.availableDebris + amount };
}
