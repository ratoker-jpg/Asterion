import { findScience } from '../science/catalog.ts';
import type { ScienceId } from '../science/types.ts';
import { creditResources, type ResourceCapacitiesInput } from '../resources/credit.ts';
import {
  BUILDING_ROLES,
  INDUSTRY_BUILDING_ROLES,
  MILITARY_BUILDING_ROLES,
  RESOURCE_BUILDING_ROLES,
  getBuildingBalanceRow,
  getBuildingEffect,
  getBuildingEffectWithScience,
  getBuildingConstructionCost,
  getBuildingMaxLevel,
  getBuildingPresentation,
  formatBalanceEffect,
  getConstructionTimeFactor,
  getShipyardTimeFactor,
  getBuildingResourceIncomePerHour,
  getBuildingEnergyIncomePerHour,
  getScienceIncomeBonusPercent,
  getImprovedConstructionCostReductionPercent,
  getStorageCapacities,
  type BalanceEffect,
  type BuildingFaction,
  type BuildingRole,
  type BuildingZone,
  type IndustryBuildingRole,
  type MilitaryBuildingRole,
  type ResourceBuildingRole,
  type ResourceCost,
  type ResourceKey,
} from './balance-v1.ts';

export {
  BUILDING_ROLES,
  INDUSTRY_BUILDING_ROLES,
  MILITARY_BUILDING_ROLES,
  RESOURCE_BUILDING_ROLES,
  getBuildingBalanceRow,
  getBuildingEffect,
  getBuildingEffectWithScience,
  getBuildingConstructionCost,
  getBuildingMaxLevel,
  getBuildingPresentation,
  formatBalanceEffect,
  getConstructionTimeFactor,
  getShipyardTimeFactor,
  getBuildingResourceIncomePerHour,
  getBuildingEnergyIncomePerHour,
  getScienceIncomeBonusPercent,
  getImprovedConstructionCostReductionPercent,
  getStorageCapacities,
};
export type {
  BalanceEffect,
  BuildingFaction,
  BuildingRole,
  BuildingZone,
  IndustryBuildingRole,
  MilitaryBuildingRole,
  ResourceBuildingRole,
  ResourceCost,
  ResourceKey,
};

export const BUILDING_QUEUE_CAPACITY = 3;
export const RESOURCE_BUILDING_QUEUE_CAPACITY = BUILDING_QUEUE_CAPACITY;
export const ADVANCED_FACTORY_MAX_LEVEL = 5;
export const RECYCLING_MAX_LEVEL = 10;
export const TRADE_CENTER_MAX_LEVEL = 10;
export const SPACEPORT_MAX_LEVEL = 10;
export const SHIPYARD_MAX_LEVEL = 15;
export const PLANETARY_GOVERNMENT_MAX_LEVEL = 10;

/** Balance v1 level-1 fixture kept for callers that need a static bot baseline. */
export const RESOURCE_BASE_INCOME_PER_HOUR = {
  metal: 150,
  minerals: 150,
  gas: 100,
} as const;

export function getSpaceportMaxLevel() {
  return SPACEPORT_MAX_LEVEL;
}

export type ResourceWallet = Record<ResourceKey, number>;
export type BuildingLevels = Record<BuildingRole, number>;
export type ResourceBuildingLevels = BuildingLevels;
export type ScienceLevels = Partial<Record<ScienceId, number>>;

export type BuildingEffect = BalanceEffect;

export type BuildingRequirement =
  | { kind: 'building-level'; assetRole: BuildingRole; level: number }
  | { kind: 'science-level'; scienceId: ScienceId; level: number };

export type BuildingRequirementState = {
  kind: BuildingRequirement['kind'];
  label: string;
  requiredLevel: number;
  currentLevel: number;
  met: boolean;
  assetRole?: BuildingRole;
  scienceId?: ScienceId;
};

export type BuildingDefinition = {
  zone: BuildingZone;
  assetRole: BuildingRole;
  faction: BuildingFaction;
  name: string;
  purpose: string;
  art: string;
  maxLevel: number;
  /** @deprecated Compatibility fields for old clients; runtime uses Balance v1 rows. */
  prototypeCost: ResourceCost;
  /** @deprecated Compatibility fields for old clients; runtime uses Balance v1 rows. */
  prototypeTimeMs: number;
  /** @deprecated Compatibility marker retained for save/test compatibility. */
  prototypeBalance: boolean;
  requirements: readonly BuildingRequirement[];
  effect?: BuildingEffect;
};

export type BuildingQueueItem = {
  kind: 'building';
  id: string;
  assetRole: BuildingRole;
  planetId: string;
  enqueuedAt: number;
  startedAt: number;
  finishAt: number;
  targetLevel: number;
  /** Actual duration snapshot used by this queued transition. */
  durationMs: number;
  /** Effective cost charged when this transition entered the queue. */
  cost?: ResourceCost;
};

export type BuildingEconomyState = {
  resources: ResourceWallet;
  buildings: BuildingLevels;
  queue: BuildingQueueItem[];
  scienceLevels: ScienceLevels;
  /** Runtime callers provide dynamic storage limits; omitted for legacy domain callers. */
  capacities?: ResourceCapacitiesInput;
};

export type ResourceEconomyState = BuildingEconomyState;

export type BuildAvailabilityStatus =
  | 'available'
  | 'insufficient-resource'
  | 'requirements-unmet'
  | 'queue-full'
  | 'max-level';

export type BuildAvailability = {
  status: BuildAvailabilityStatus;
  canBuild: boolean;
  reason: string | null;
  currentLevel: number;
  projectedLevel: number;
  nextLevel: number | null;
  maxLevel: number;
  cost: ResourceCost | null;
  rawTimeMs: number | null;
  timeMs: number | null;
  missing: Partial<Record<ResourceKey, number>>;
  requirements: readonly BuildingRequirementState[];
};


const reqBuilding = (assetRole: BuildingRole, level: number): BuildingRequirement => ({ kind: 'building-level', assetRole, level });
const reqScience = (scienceId: ScienceId, level: number): BuildingRequirement => ({ kind: 'science-level', scienceId, level });

const definition = (
  zone: BuildingZone,
  assetRole: BuildingRole,
  requirements: readonly BuildingRequirement[] = [],
  faction: BuildingFaction = 'aegis',
): BuildingDefinition => {
  const presentation = getBuildingPresentation(assetRole, faction);
  const firstTransition = getBuildingBalanceRow(assetRole, 1);
  return {
    ...presentation,
    zone,
    prototypeCost: firstTransition?.cost ?? { metal: 0, minerals: 0, gas: 0, energy: 0 },
    prototypeTimeMs: firstTransition?.rawTimeMs ?? 0,
    prototypeBalance: true,
    requirements,
    effect: getBuildingEffect(assetRole, 1),
  };
};

export const ASTER_RESOURCE_BUILDINGS: readonly BuildingDefinition[] = [
  definition('resource', 'metal-production-1'),
  definition('resource', 'metal-production-2', [reqBuilding('metal-production-1', 10)]),
  definition('resource', 'metal-production-3', [reqBuilding('metal-production-1', 15)]),
  definition('resource', 'mineral-production-1'),
  definition('resource', 'mineral-production-2'),
  definition('resource', 'gas-production-1'),
  definition('resource', 'gas-production-2'),
  definition('resource', 'basic-energy'),
  definition('resource', 'advanced-energy', [reqBuilding('basic-energy', 10), reqScience(2, 5), reqScience(1, 5)]),
  definition('resource', 'hangar'),
];

export const ASTER_INDUSTRY_BUILDINGS: readonly BuildingDefinition[] = [
  definition('industry', 'construction'),
  definition('industry', 'advanced-factory', [reqBuilding('construction', 10)]),
  definition('industry', 'metal-storage', [reqBuilding('metal-production-1', 1)]),
  definition('industry', 'mineral-storage', [reqBuilding('mineral-production-1', 1)]),
  definition('industry', 'gas-storage', [reqBuilding('gas-production-1', 1)]),
  definition('industry', 'recycling', [reqBuilding('shipyard', 5), reqScience(2, 6)]),
  definition('industry', 'trade-center'),
];

export const ASTER_MILITARY_BUILDINGS: readonly BuildingDefinition[] = [
  definition('military', 'shipyard'),
  definition('military', 'research', [reqBuilding('construction', 1)]),
  definition('military', 'spaceport'),
  definition('military', 'planetary-government'),
];

export const ASTER_BUILDINGS: readonly BuildingDefinition[] = [
  ...ASTER_RESOURCE_BUILDINGS,
  ...ASTER_INDUSTRY_BUILDINGS,
  ...ASTER_MILITARY_BUILDINGS,
];

export const ASTER_BUILDINGS_BY_ZONE: Readonly<Record<BuildingZone, readonly BuildingDefinition[]>> = {
  resource: ASTER_RESOURCE_BUILDINGS,
  industry: ASTER_INDUSTRY_BUILDINGS,
  military: ASTER_MILITARY_BUILDINGS,
};

const definitionByRole = new Map<BuildingRole, BuildingDefinition>(
  ASTER_BUILDINGS.map((item) => [item.assetRole, item]),
);

export function isBuildingRole(value: unknown): value is BuildingRole {
  return typeof value === 'string' && (BUILDING_ROLES as readonly string[]).includes(value);
}

export function isResourceBuildingRole(value: unknown): value is ResourceBuildingRole {
  return typeof value === 'string' && (RESOURCE_BUILDING_ROLES as readonly string[]).includes(value);
}

export function getBuildingDefinition(assetRole: BuildingRole, faction: BuildingFaction = 'aegis'): BuildingDefinition {
  const item = definitionByRole.get(assetRole);
  if (!item) throw new Error(`Unknown building role: ${assetRole}`);
  if (faction === 'aegis') return item;
  return definition(item.zone, assetRole, item.requirements, faction);
}

export const getResourceBuildingDefinition = getBuildingDefinition;

export function getBuildingsForZone(zone: BuildingZone, faction: BuildingFaction = 'aegis'): readonly BuildingDefinition[] {
  if (faction === 'aegis') return ASTER_BUILDINGS_BY_ZONE[zone];
  return ASTER_BUILDINGS_BY_ZONE[zone].map((item) => getBuildingDefinition(item.assetRole, faction));
}

export function createDefaultBuildingLevels(): BuildingLevels {
  return Object.fromEntries(BUILDING_ROLES.map((role) => [role, 0])) as BuildingLevels;
}

export function createCanonicalStartingBuildingLevels(): BuildingLevels {
  const levels = createDefaultBuildingLevels();
  levels['metal-production-1'] = 1;
  levels['mineral-production-1'] = 1;
  levels['gas-production-1'] = 1;
  levels['basic-energy'] = 1;
  levels.hangar = 1;
  return levels;
}

export const createDefaultResourceBuildingLevels = createDefaultBuildingLevels;

function toSafeLevel(value: unknown, maxLevel: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  return Math.min(maxLevel, Math.max(0, Math.floor(value)));
}

export function migrateBuildingLevels(value: unknown, legacySolarStations = 0): BuildingLevels {
  const migrated = createDefaultBuildingLevels();
  const source = value && typeof value === 'object' ? value as Record<string, unknown> : null;

  for (const item of ASTER_BUILDINGS) {
    migrated[item.assetRole] = toSafeLevel(source?.[item.assetRole], item.maxLevel);
  }

  if (legacySolarStations > 0) {
    const basicEnergy = getBuildingDefinition('basic-energy');
    migrated['basic-energy'] = Math.max(
      migrated['basic-energy'],
      Math.min(basicEnergy.maxLevel, Math.floor(legacySolarStations)),
    );
  }

  return migrated;
}

export const migrateResourceBuildingLevels = migrateBuildingLevels;

function isFiniteTimestamp(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function migrateQueueItem(
  value: unknown,
  planetId: string,
  index: number,
  previousFinishAt: number | null,
  buildings: BuildingLevels,
  queuedRoleCounts: Partial<Record<BuildingRole, number>>,
  scienceLevels: ScienceLevels,
): BuildingQueueItem | null {
  if (!value || typeof value !== 'object') return null;
  const source = value as Record<string, unknown>;
  const role = isBuildingRole(source.assetRole)
    ? source.assetRole
    : source.id === 'solar-station'
      ? 'basic-energy'
      : null;
  if (!role) return null;

  const item = getBuildingDefinition(role);
  const queuedBefore = queuedRoleCounts[role] ?? 0;
  if ((buildings[role] ?? 0) + queuedBefore >= item.maxLevel) return null;

  const targetLevel = Math.min(item.maxLevel, (buildings[role] ?? 0) + queuedBefore + 1);
  const balanceRow = getBuildingBalanceRow(role, targetLevel);
  if (!balanceRow) return null;
  const cost = balanceRow.cost ? getBuildingConstructionCost(balanceRow.cost, scienceLevels) : null;

  const rawStartedAt = isFiniteTimestamp(source.startedAt) ? source.startedAt : null;
  const rawFinishAt = isFiniteTimestamp(source.finishAt) ? source.finishAt : null;
  const duration = rawStartedAt != null && rawFinishAt != null
    ? Math.max(1, rawFinishAt - rawStartedAt)
    : Math.max(1, Math.round((balanceRow.rawTimeMs ?? 1) * getConstructionTimeFactor(buildings.construction ?? 0)));
  const startedAt = index === 0
    ? (rawStartedAt ?? 0)
    : (previousFinishAt ?? rawStartedAt ?? 0);
  const finishAt = index === 0 && rawFinishAt != null
    ? Math.max(startedAt, rawFinishAt)
    : startedAt + duration;
  const enqueuedAt = isFiniteTimestamp(source.enqueuedAt) ? source.enqueuedAt : startedAt;
  queuedRoleCounts[role] = queuedBefore + 1;

  return {
    kind: 'building',
    id: typeof source.id === 'string' && source.id.trim()
      ? source.id
      : `building-${planetId}-${role}-${enqueuedAt}-${index}`,
    assetRole: role,
    planetId,
    enqueuedAt,
    startedAt,
    finishAt,
    targetLevel,
    durationMs: duration,
    ...(cost ? { cost } : {}),
  };
}

export function migrateBuildingQueue(
  value: unknown,
  planetId: string,
  buildings: BuildingLevels = createDefaultBuildingLevels(),
  scienceLevels: ScienceLevels = {},
): BuildingQueueItem[] {
  const sourceItems = Array.isArray(value) ? value : value ? [value] : [];
  const migrated: BuildingQueueItem[] = [];
  const queuedRoleCounts: Partial<Record<BuildingRole, number>> = {};
  let previousFinishAt: number | null = null;

  for (const source of sourceItems) {
    if (migrated.length >= BUILDING_QUEUE_CAPACITY) break;
    const item = migrateQueueItem(source, planetId, migrated.length, previousFinishAt, buildings, queuedRoleCounts, scienceLevels);
    if (!item) continue;
    const id = migrated.some((queuedItem) => queuedItem.id === item.id)
      ? `${item.id}-${migrated.length}`
      : item.id;
    migrated.push({ ...item, id });
    previousFinishAt = item.finishAt;
  }

  return migrated;
}

export const migrateResourceBuildingQueue = migrateBuildingQueue;

const resourceLabel: Record<ResourceKey, string> = {
  metal: 'металла',
  minerals: 'минералов',
  gas: 'газа',
  energy: 'энергии',
};

export function evaluateBuildingRequirements(
  state: Pick<BuildingEconomyState, 'buildings' | 'scienceLevels'>,
  assetRole: BuildingRole,
): BuildingRequirementState[] {
  const item = getBuildingDefinition(assetRole);
  return item.requirements.map((requirement) => {
    if (requirement.kind === 'building-level') {
      const requiredDefinition = getBuildingDefinition(requirement.assetRole);
      const currentLevel = state.buildings[requirement.assetRole] ?? 0;
      return {
        kind: requirement.kind,
        assetRole: requirement.assetRole,
        label: requiredDefinition.name,
        requiredLevel: requirement.level,
        currentLevel,
        met: currentLevel >= requirement.level,
      };
    }

    const currentLevel = state.scienceLevels[requirement.scienceId] ?? 0;
    return {
      kind: requirement.kind,
      scienceId: requirement.scienceId,
      label: findScience(requirement.scienceId)?.name ?? `Наука ${requirement.scienceId}`,
      requiredLevel: requirement.level,
      currentLevel,
      met: currentLevel >= requirement.level,
    };
  });
}

export function formatBuildingRequirement(requirement: BuildingRequirementState): string {
  return `${requirement.label} — ур. ${requirement.requiredLevel}; сейчас ${requirement.currentLevel}`;
}

export function evaluateBuildingBuild(state: BuildingEconomyState, assetRole: BuildingRole): BuildAvailability {
  const item = getBuildingDefinition(assetRole);
  const currentLevel = state.buildings[assetRole] ?? 0;
  const queuedLevels = state.queue.filter((queueItem) => queueItem.assetRole === assetRole).length;
  const projectedLevel = Math.min(item.maxLevel, currentLevel + queuedLevels);
  const requirements = evaluateBuildingRequirements(state, assetRole);
  const nextLevel = projectedLevel < item.maxLevel ? projectedLevel + 1 : null;
  const balanceRow = nextLevel == null ? null : getBuildingBalanceRow(assetRole, nextLevel);
  const rawTimeMs = balanceRow?.rawTimeMs ?? null;
  const timeMs = rawTimeMs == null
    ? null
    : Math.max(1, Math.round(rawTimeMs * getConstructionTimeFactor(state.buildings.construction ?? 0)));
  const cost = balanceRow?.cost ? getBuildingConstructionCost(balanceRow.cost, state.scienceLevels) : null;
  const base = {
    currentLevel,
    projectedLevel,
    nextLevel,
    maxLevel: item.maxLevel,
    cost,
    rawTimeMs,
    timeMs,
    requirements,
  };

  if (projectedLevel >= item.maxLevel) {
    return { ...base, status: 'max-level', canBuild: false, reason: 'Достигнут максимальный уровень.', missing: {} };
  }

  if (!cost || rawTimeMs == null) {
    return { ...base, status: 'max-level', canBuild: false, reason: 'Строка перехода Balance v1 недоступна.', missing: {} };
  }

  const missingRequirements = requirements.filter((requirement) => !requirement.met);
  if (missingRequirements.length > 0) {
    return {
      ...base,
      status: 'requirements-unmet',
      canBuild: false,
      reason: `Требуется: ${missingRequirements.map(formatBuildingRequirement).join('; ')}.`,
      missing: {},
    };
  }

  if (state.queue.length >= BUILDING_QUEUE_CAPACITY) {
    return { ...base, status: 'queue-full', canBuild: false, reason: 'Очередь заполнена.', missing: {} };
  }

  const missing: Partial<Record<ResourceKey, number>> = {};
  for (const key of Object.keys(cost) as ResourceKey[]) {
    const deficit = cost[key] - state.resources[key];
    if (deficit > 0) missing[key] = deficit;
  }

  const firstMissing = (Object.keys(missing) as ResourceKey[])[0];
  if (firstMissing) {
    return {
      ...base,
      status: 'insufficient-resource',
      canBuild: false,
      reason: `Недостаточно ${resourceLabel[firstMissing]}.`,
      missing,
    };
  }

  return { ...base, status: 'available', canBuild: true, reason: null, missing: {} };
}

export const evaluateResourceBuildingBuild = evaluateBuildingBuild;

export type BuildTransition = {
  ok: boolean;
  state: BuildingEconomyState;
  reason: string | null;
};
export type ResourceBuildTransition = BuildTransition;

export function startBuildingProject(
  state: BuildingEconomyState,
  assetRole: BuildingRole,
  planetId: string,
  enqueuedAt: number,
  durationMs?: number,
): BuildTransition {
  const availability = evaluateBuildingBuild(state, assetRole);
  if (!availability.canBuild || availability.nextLevel == null || !availability.cost || availability.timeMs == null) {
    return { ok: false, state, reason: availability.reason };
  }

  const effectiveDurationMs = durationMs == null
    ? availability.timeMs
    : Math.max(1, Math.round(durationMs));
  const resources: ResourceWallet = { ...state.resources };
  for (const key of Object.keys(availability.cost) as ResourceKey[]) {
    resources[key] -= availability.cost[key];
  }

  const previous = state.queue[state.queue.length - 1] ?? null;
  const startedAt = previous ? previous.finishAt : enqueuedAt;
  const queueItem: BuildingQueueItem = {
    kind: 'building',
    id: `building-${planetId}-${assetRole}-${enqueuedAt}-${state.queue.length}`,
    assetRole,
    planetId,
    enqueuedAt,
    startedAt,
    finishAt: startedAt + effectiveDurationMs,
    targetLevel: availability.nextLevel,
    durationMs: effectiveDurationMs,
    cost: { ...availability.cost },
  };

  return {
    ok: true,
    reason: null,
    state: {
      ...state,
      resources,
      queue: [...state.queue, queueItem],
    },
  };
}

export const startResourceBuildingProject = startBuildingProject;

export const BUILDING_CANCEL_REFUND_PERCENT = 90;
export const BUILDING_DESTROY_REFUND_MIN_PERCENT = 50;
export const BUILDING_DESTROY_REFUND_MAX_PERCENT = 80;

function refundCost(cost: ResourceCost, refundPercent: number): ResourceCost {
  return Object.fromEntries(
    (Object.keys(cost) as ResourceKey[]).map((key) => [key, Math.floor(cost[key] * refundPercent / 100)]),
  ) as ResourceCost;
}

function addResourceCost(
  resources: ResourceWallet,
  cost: ResourceCost,
  capacities?: ResourceCapacitiesInput,
): ResourceWallet {
  const unlimitedCapacities = { metal: Number.MAX_SAFE_INTEGER, minerals: Number.MAX_SAFE_INTEGER, gas: Number.MAX_SAFE_INTEGER };
  return creditResources(resources, capacities ?? unlimitedCapacities, cost).wallet;
}

function getQueuedBuildingCost(item: BuildingQueueItem, scienceLevels: ScienceLevels): ResourceCost | null {
  if (item.cost) return { ...item.cost };
  const balanceRow = getBuildingBalanceRow(item.assetRole, item.targetLevel);
  return balanceRow?.cost ? getBuildingConstructionCost(balanceRow.cost, scienceLevels) : null;
}

function rescheduleQueueAfterCancellation(
  queue: readonly BuildingQueueItem[],
  canceledWasActive: boolean,
  now: number,
): BuildingQueueItem[] {
  if (queue.length === 0) return [];

  const remaining = [...queue];
  if (remaining.length === 0) return remaining;

  let cursor = canceledWasActive ? now : remaining[0].finishAt;
  return remaining.map((item, index) => {
    if (!canceledWasActive && index === 0) return item;
    const startedAt = cursor;
    const finishAt = startedAt + Math.max(1, item.durationMs);
    cursor = finishAt;
    return { ...item, startedAt, finishAt };
  });
}

function removeDependentBuildingProjects(
  queue: readonly BuildingQueueItem[],
  canceledIndex: number,
  buildings: BuildingLevels,
): { remaining: BuildingQueueItem[]; cascaded: BuildingQueueItem[] } {
  const projectedLevels = { ...buildings };
  const remaining: BuildingQueueItem[] = [];
  const cascaded: BuildingQueueItem[] = [];

  queue.forEach((item, index) => {
    if (index < canceledIndex) {
      remaining.push(item);
      projectedLevels[item.assetRole] = item.targetLevel;
      return;
    }
    if (index === canceledIndex) {
      cascaded.push(item);
      return;
    }

    const projectedLevel = projectedLevels[item.assetRole] ?? 0;
    if (item.targetLevel !== projectedLevel + 1) {
      cascaded.push(item);
      return;
    }

    remaining.push(item);
    projectedLevels[item.assetRole] = item.targetLevel;
  });

  return { remaining, cascaded };
}

export type BuildingCancellationTransition = {
  ok: boolean;
  state: BuildingEconomyState;
  reason: string | null;
  canceled: BuildingQueueItem | null;
  canceledItems: BuildingQueueItem[];
  refund: ResourceCost | null;
};

export function cancelBuildingProject(
  state: BuildingEconomyState,
  queueId: string,
  now: number,
): BuildingCancellationTransition {
  const queueIndex = state.queue.findIndex((item) => item.id === queueId);
  const canceled = queueIndex >= 0 ? state.queue[queueIndex] ?? null : null;
  if (!canceled) {
    return {
      ok: false,
      state,
      reason: 'Проект в этом слоте уже недоступен.',
      canceled: null,
      canceledItems: [],
      refund: null,
    };
  }

  const cost = getQueuedBuildingCost(canceled, state.scienceLevels);
  if (!cost) {
    return {
      ok: false,
      state,
      reason: 'Стоимость отменяемого проекта недоступна.',
      canceled: null,
      canceledItems: [],
      refund: null,
    };
  }

  const { remaining, cascaded } = removeDependentBuildingProjects(state.queue, queueIndex, state.buildings);
  const canceledItems = [canceled, ...cascaded.filter((item) => item.id !== canceled.id)];
  const refund = canceledItems.reduce((total, item) => {
    const itemCost = getQueuedBuildingCost(item, state.scienceLevels);
    if (!itemCost) return total;
    const itemRefund = refundCost(itemCost, BUILDING_CANCEL_REFUND_PERCENT);
    return Object.fromEntries(
      (Object.keys(total) as ResourceKey[]).map((key) => [key, total[key] + itemRefund[key]]),
    ) as ResourceCost;
  }, { metal: 0, minerals: 0, gas: 0, energy: 0 } as ResourceCost);
  return {
    ok: true,
    state: {
      ...state,
      resources: addResourceCost(state.resources, refund, state.capacities),
      queue: rescheduleQueueAfterCancellation(remaining, queueIndex === 0, now),
    },
    reason: null,
    canceled,
    canceledItems,
    refund,
  };
}

export const cancelResourceBuildingProject = cancelBuildingProject;

export type BuildingDestructionTransition = {
  ok: boolean;
  state: BuildingEconomyState;
  reason: string | null;
  destroyedRole: BuildingRole | null;
  destroyedLevel: number | null;
  refundPercent: number | null;
  refund: ResourceCost | null;
};

export function destroyBuildingLevel(
  state: BuildingEconomyState,
  assetRole: BuildingRole,
  refundPercent: number,
): BuildingDestructionTransition {
  const currentLevel = state.buildings[assetRole] ?? 0;
  if (currentLevel <= 0) {
    return {
      ok: false,
      state,
      reason: 'У здания нет построенных уровней.',
      destroyedRole: null,
      destroyedLevel: null,
      refundPercent: null,
      refund: null,
    };
  }

  if (state.queue.some((item) => item.assetRole === assetRole)) {
    return {
      ok: false,
      state,
      reason: 'Нельзя разрушить здание во время строительства.',
      destroyedRole: null,
      destroyedLevel: null,
      refundPercent: null,
      refund: null,
    };
  }

  const balanceRow = getBuildingBalanceRow(assetRole, currentLevel);
  const cost = balanceRow?.cost ? getBuildingConstructionCost(balanceRow.cost, state.scienceLevels) : null;
  if (!cost) {
    return {
      ok: false,
      state,
      reason: 'Стоимость разрушенного уровня недоступна.',
      destroyedRole: null,
      destroyedLevel: null,
      refundPercent: null,
      refund: null,
    };
  }

  const normalizedRefundPercent = Number.isFinite(refundPercent)
    ? Math.floor(refundPercent)
    : BUILDING_DESTROY_REFUND_MIN_PERCENT;
  const safeRefundPercent = Math.min(
    BUILDING_DESTROY_REFUND_MAX_PERCENT,
    Math.max(BUILDING_DESTROY_REFUND_MIN_PERCENT, normalizedRefundPercent),
  );
  const refund = refundCost(cost, safeRefundPercent);
  const nextBuildings = {
    ...state.buildings,
    [assetRole]: currentLevel - 1,
  };
  return {
    ok: true,
    state: {
      ...state,
      resources: addResourceCost(
        state.resources,
        refund,
        state.capacities ? getStorageCapacities(nextBuildings) : undefined,
      ),
      buildings: nextBuildings,
    },
    reason: null,
    destroyedRole: assetRole,
    destroyedLevel: currentLevel,
    refundPercent: safeRefundPercent,
    refund,
  };
}

export const destroyResourceBuildingLevel = destroyBuildingLevel;

export type CompletionTransition = {
  completedRole: BuildingRole | null;
  state: BuildingEconomyState;
};
export type ResourceCompletionTransition = CompletionTransition;

export function completeBuildingProject(state: BuildingEconomyState, now: number): CompletionTransition {
  const active = state.queue[0];
  if (!active || now < active.finishAt) return { completedRole: null, state };

  const item = getBuildingDefinition(active.assetRole);
  const currentLevel = state.buildings[active.assetRole] ?? 0;
  const nextLevel = Math.min(item.maxLevel, currentLevel + 1);

  return {
    completedRole: active.assetRole,
    state: {
      ...state,
      buildings: {
        ...state.buildings,
        [active.assetRole]: nextLevel,
      },
      queue: state.queue.slice(1),
    },
  };
}

export const completeResourceBuildingProject = completeBuildingProject;

export function getBuildingEffectText(
  item: BuildingDefinition,
  currentLevel: number,
  scienceLevels: ScienceLevels = {},
): string {
  const current = formatBalanceEffect(getBuildingEffectWithScience(item.assetRole, currentLevel, scienceLevels));
  const nextLevel = Math.min(item.maxLevel, Math.max(0, currentLevel + 1));
  if (nextLevel === currentLevel) return `Текущий эффект: ${current}`;
  const next = formatBalanceEffect(getBuildingEffectWithScience(item.assetRole, nextLevel, scienceLevels));
  return `Текущий: ${current} · следующий: ${next}`;
}
