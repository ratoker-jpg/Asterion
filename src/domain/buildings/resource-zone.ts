import { findScience } from '../science/catalog.ts';
import type { ScienceId } from '../science/types.ts';

export const RESOURCE_BUILDING_ROLES = [
  'metal-production-1',
  'metal-production-2',
  'metal-production-3',
  'mineral-production-1',
  'mineral-production-2',
  'gas-production-1',
  'gas-production-2',
  'basic-energy',
  'advanced-energy',
  'hangar',
] as const;

export const RESOURCE_BUILDING_QUEUE_CAPACITY = 3;

export type ResourceBuildingRole = (typeof RESOURCE_BUILDING_ROLES)[number];
export type BuildingZone = 'resource' | 'industry' | 'military';
export type BuildingFaction = 'aegis';
export type ResourceKey = 'metal' | 'minerals' | 'gas' | 'energy';

export type ResourceCost = Record<ResourceKey, number>;
export type ResourceWallet = Record<ResourceKey, number>;
export type ResourceBuildingLevels = Record<ResourceBuildingRole, number>;
export type ScienceLevels = Partial<Record<ScienceId, number>>;

export type BuildingEffect = {
  kind: 'energy';
  amountPerLevel: number;
  label: string;
};

export type BuildingRequirement =
  | { kind: 'building-level'; assetRole: ResourceBuildingRole; level: number }
  | { kind: 'science-level'; scienceId: ScienceId; level: number };

export type BuildingRequirementState = {
  kind: BuildingRequirement['kind'];
  label: string;
  requiredLevel: number;
  currentLevel: number;
  met: boolean;
  assetRole?: ResourceBuildingRole;
  scienceId?: ScienceId;
};

export type BuildingDefinition = {
  zone: BuildingZone;
  assetRole: ResourceBuildingRole;
  faction: BuildingFaction;
  name: string;
  purpose: string;
  art: string;
  maxLevel: number;
  prototypeCost: ResourceCost;
  prototypeTimeMs: number;
  requirements: readonly BuildingRequirement[];
  effect?: BuildingEffect;
};

export type BuildingQueueItem = {
  kind: 'building';
  assetRole: ResourceBuildingRole;
  planetId: string;
  enqueuedAt: number;
  startedAt: number;
  finishAt: number;
  targetLevel: number;
};

export type ResourceEconomyState = {
  resources: ResourceWallet;
  buildings: ResourceBuildingLevels;
  queue: BuildingQueueItem[];
  scienceLevels: ScienceLevels;
};

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
  cost: ResourceCost;
  timeMs: number;
  missing: Partial<Record<ResourceKey, number>>;
  requirements: readonly BuildingRequirementState[];
};

const EXISTING_PROTOTYPE_COST: ResourceCost = {
  metal: 1200,
  minerals: 0,
  gas: 0,
  energy: 0,
};

const EXISTING_PROTOTYPE_TIME_MS = 45_000;

export const RESOURCE_BASE_INCOME_PER_HOUR = {
  metal: 774,
  minerals: 510,
  gas: 312,
} as const;

export const RESOURCE_PROTOTYPE_DATA_NOTE =
  'Цена и время остаются локальными данными текущего прототипа. Дополнительные требования и баланс добавляются только после подтверждения.';

const RESOURCE_BUILDING_ART: Record<ResourceBuildingRole, string> = {
  'metal-production-1': new URL('../../../assets/source/New assets/buildings/aegis/building.aegis.metal-production-1.png', import.meta.url).href,
  'metal-production-2': new URL('../../../assets/source/New assets/buildings/aegis/building.aegis.metal-production-2.png', import.meta.url).href,
  'metal-production-3': new URL('../../../assets/source/New assets/buildings/aegis/building.aegis.metal-production-3.png', import.meta.url).href,
  'mineral-production-1': new URL('../../../assets/source/New assets/buildings/aegis/building.aegis.mineral-production-1.png', import.meta.url).href,
  'mineral-production-2': new URL('../../../assets/source/New assets/buildings/aegis/building.aegis.mineral-production-2.png', import.meta.url).href,
  'gas-production-1': new URL('../../../assets/source/New assets/buildings/aegis/building.aegis.gas-production-1.png', import.meta.url).href,
  'gas-production-2': new URL('../../../assets/source/New assets/buildings/aegis/building.aegis.gas-production-2.png', import.meta.url).href,
  'basic-energy': new URL('../../../assets/source/New assets/buildings/aegis/building.aegis.basic-energy.png', import.meta.url).href,
  'advanced-energy': new URL('../../../assets/source/New assets/buildings/aegis/building.aegis.advanced-energy.png', import.meta.url).href,
  hangar: new URL('../../../assets/source/New assets/buildings/aegis/building.aegis.hangar.png', import.meta.url).href,
};

const reqBuilding = (assetRole: ResourceBuildingRole, level: number): BuildingRequirement => ({ kind: 'building-level', assetRole, level });
const reqScience = (scienceId: ScienceId, level: number): BuildingRequirement => ({ kind: 'science-level', scienceId, level });

const baseDefinition = (
  assetRole: ResourceBuildingRole,
  name: string,
  purpose: string,
  maxLevel: number,
  requirements: readonly BuildingRequirement[] = [],
  effect?: BuildingEffect,
): BuildingDefinition => ({
  zone: 'resource',
  assetRole,
  faction: 'aegis',
  name,
  purpose,
  art: RESOURCE_BUILDING_ART[assetRole],
  maxLevel,
  prototypeCost: { ...EXISTING_PROTOTYPE_COST },
  prototypeTimeMs: EXISTING_PROTOTYPE_TIME_MS,
  requirements,
  ...(effect ? { effect } : {}),
});

export const ASTER_RESOURCE_BUILDINGS: readonly BuildingDefinition[] = [
  baseDefinition('metal-production-1', 'Металлическая шахта I', 'Базовая добыча металла.', 30),
  baseDefinition('metal-production-2', 'Металлическая шахта II', 'Улучшенная добыча металла.', 30, [reqBuilding('metal-production-1', 10)]),
  baseDefinition('metal-production-3', 'Металлическая шахта III', 'Высшая ступень добычи металла.', 30, [reqBuilding('metal-production-1', 15)]),
  baseDefinition('mineral-production-1', 'Минеральная шахта I', 'Базовая добыча минералов.', 30),
  baseDefinition('mineral-production-2', 'Минеральная шахта II', 'Улучшенная добыча минералов.', 30),
  baseDefinition('gas-production-1', 'Газовая скважина I', 'Базовая добыча газа.', 30),
  baseDefinition('gas-production-2', 'Газовая скважина II', 'Улучшенная добыча газа.', 30),
  baseDefinition(
    'basic-energy',
    'Солнечная электростанция',
    'Базовая генерация энергии.',
    30,
    [],
    { kind: 'energy', amountPerLevel: 25, label: 'Энергия планеты' },
  ),
  baseDefinition(
    'advanced-energy',
    'Ядерный реактор',
    'Продвинутая генерация энергии.',
    20,
    [reqBuilding('basic-energy', 10), reqScience(2, 5), reqScience(1, 5)],
  ),
  baseDefinition('hangar', 'Ангар', 'Хранение и увеличение доступной вместимости кораблей/юнитов.', 20),
] as const;

const definitionByRole = new Map<ResourceBuildingRole, BuildingDefinition>(
  ASTER_RESOURCE_BUILDINGS.map((definition) => [definition.assetRole, definition]),
);

export function isResourceBuildingRole(value: unknown): value is ResourceBuildingRole {
  return typeof value === 'string' && (RESOURCE_BUILDING_ROLES as readonly string[]).includes(value);
}

export function getResourceBuildingDefinition(assetRole: ResourceBuildingRole): BuildingDefinition {
  const definition = definitionByRole.get(assetRole);
  if (!definition) throw new Error(`Unknown resource building role: ${assetRole}`);
  return definition;
}

export function createDefaultResourceBuildingLevels(): ResourceBuildingLevels {
  return Object.fromEntries(RESOURCE_BUILDING_ROLES.map((role) => [role, 0])) as ResourceBuildingLevels;
}

function toSafeLevel(value: unknown, maxLevel: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  return Math.min(maxLevel, Math.max(0, Math.floor(value)));
}

export function migrateResourceBuildingLevels(
  value: unknown,
  legacySolarStations = 0,
): ResourceBuildingLevels {
  const migrated = createDefaultResourceBuildingLevels();
  const source = value && typeof value === 'object' ? value as Record<string, unknown> : null;

  for (const definition of ASTER_RESOURCE_BUILDINGS) {
    migrated[definition.assetRole] = toSafeLevel(source?.[definition.assetRole], definition.maxLevel);
  }

  if (legacySolarStations > 0) {
    const basicEnergy = getResourceBuildingDefinition('basic-energy');
    migrated['basic-energy'] = Math.max(
      migrated['basic-energy'],
      Math.min(basicEnergy.maxLevel, Math.floor(legacySolarStations)),
    );
  }

  return migrated;
}

function isFiniteTimestamp(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function migrateQueueItem(
  value: unknown,
  planetId: string,
  index: number,
  previousFinishAt: number | null,
  buildings: ResourceBuildingLevels,
  queuedRoleCounts: Partial<Record<ResourceBuildingRole, number>>,
): BuildingQueueItem | null {
  if (!value || typeof value !== 'object') return null;
  const source = value as Record<string, unknown>;
  const role = isResourceBuildingRole(source.assetRole)
    ? source.assetRole
    : source.id === 'solar-station'
      ? 'basic-energy'
      : null;
  if (!role) return null;

  const definition = getResourceBuildingDefinition(role);
  const rawStartedAt = isFiniteTimestamp(source.startedAt) ? source.startedAt : null;
  const rawFinishAt = isFiniteTimestamp(source.finishAt) ? source.finishAt : null;
  const duration = rawStartedAt != null && rawFinishAt != null
    ? Math.max(1, rawFinishAt - rawStartedAt)
    : definition.prototypeTimeMs;
  const startedAt = index === 0
    ? (rawStartedAt ?? 0)
    : (previousFinishAt ?? rawStartedAt ?? 0);
  const finishAt = index === 0 && rawFinishAt != null
    ? Math.max(startedAt, rawFinishAt)
    : startedAt + duration;
  const queuedBefore = queuedRoleCounts[role] ?? 0;
  const fallbackTarget = Math.min(definition.maxLevel, (buildings[role] ?? 0) + queuedBefore + 1);
  const targetLevel = toSafeLevel(source.targetLevel, definition.maxLevel) || fallbackTarget;
  queuedRoleCounts[role] = queuedBefore + 1;

  return {
    kind: 'building',
    assetRole: role,
    planetId,
    enqueuedAt: isFiniteTimestamp(source.enqueuedAt) ? source.enqueuedAt : startedAt,
    startedAt,
    finishAt,
    targetLevel,
  };
}

export function migrateResourceBuildingQueue(
  value: unknown,
  planetId: string,
  buildings: ResourceBuildingLevels = createDefaultResourceBuildingLevels(),
): BuildingQueueItem[] {
  const sourceItems = Array.isArray(value) ? value : value ? [value] : [];
  const migrated: BuildingQueueItem[] = [];
  const queuedRoleCounts: Partial<Record<ResourceBuildingRole, number>> = {};
  let previousFinishAt: number | null = null;

  for (const source of sourceItems.slice(0, RESOURCE_BUILDING_QUEUE_CAPACITY)) {
    const item = migrateQueueItem(source, planetId, migrated.length, previousFinishAt, buildings, queuedRoleCounts);
    if (!item) continue;
    migrated.push(item);
    previousFinishAt = item.finishAt;
  }

  return migrated;
}

const resourceLabel: Record<ResourceKey, string> = {
  metal: 'металла',
  minerals: 'минералов',
  gas: 'газа',
  energy: 'энергии',
};

export function evaluateBuildingRequirements(
  state: Pick<ResourceEconomyState, 'buildings' | 'scienceLevels'>,
  assetRole: ResourceBuildingRole,
): BuildingRequirementState[] {
  const definition = getResourceBuildingDefinition(assetRole);
  return definition.requirements.map((requirement) => {
    if (requirement.kind === 'building-level') {
      const requiredDefinition = getResourceBuildingDefinition(requirement.assetRole);
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

export function evaluateResourceBuildingBuild(
  state: ResourceEconomyState,
  assetRole: ResourceBuildingRole,
): BuildAvailability {
  const definition = getResourceBuildingDefinition(assetRole);
  const currentLevel = state.buildings[assetRole] ?? 0;
  const queuedLevels = state.queue.filter((item) => item.assetRole === assetRole).length;
  const projectedLevel = Math.min(definition.maxLevel, currentLevel + queuedLevels);
  const requirements = evaluateBuildingRequirements(state, assetRole);
  const base = {
    currentLevel,
    projectedLevel,
    nextLevel: projectedLevel < definition.maxLevel ? projectedLevel + 1 : null,
    maxLevel: definition.maxLevel,
    cost: { ...definition.prototypeCost },
    timeMs: definition.prototypeTimeMs,
    requirements,
  };

  if (projectedLevel >= definition.maxLevel) {
    return { ...base, status: 'max-level', canBuild: false, reason: 'Достигнут максимальный уровень.', missing: {} };
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

  if (state.queue.length >= RESOURCE_BUILDING_QUEUE_CAPACITY) {
    return { ...base, status: 'queue-full', canBuild: false, reason: 'Очередь заполнена.', missing: {} };
  }

  const missing: Partial<Record<ResourceKey, number>> = {};
  for (const key of Object.keys(definition.prototypeCost) as ResourceKey[]) {
    const deficit = definition.prototypeCost[key] - state.resources[key];
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

export type ResourceBuildTransition = {
  ok: boolean;
  state: ResourceEconomyState;
  reason: string | null;
};

export function startResourceBuildingProject(
  state: ResourceEconomyState,
  assetRole: ResourceBuildingRole,
  planetId: string,
  enqueuedAt: number,
): ResourceBuildTransition {
  const availability = evaluateResourceBuildingBuild(state, assetRole);
  if (!availability.canBuild || availability.nextLevel == null) return { ok: false, state, reason: availability.reason };

  const definition = getResourceBuildingDefinition(assetRole);
  const resources: ResourceWallet = { ...state.resources };
  for (const key of Object.keys(definition.prototypeCost) as ResourceKey[]) {
    resources[key] -= definition.prototypeCost[key];
  }

  const previous = state.queue[state.queue.length - 1] ?? null;
  const startedAt = previous ? previous.finishAt : enqueuedAt;
  const item: BuildingQueueItem = {
    kind: 'building',
    assetRole,
    planetId,
    enqueuedAt,
    startedAt,
    finishAt: startedAt + definition.prototypeTimeMs,
    targetLevel: availability.nextLevel,
  };

  return {
    ok: true,
    reason: null,
    state: {
      ...state,
      resources,
      queue: [...state.queue, item],
    },
  };
}

export type ResourceCompletionTransition = {
  completedRole: ResourceBuildingRole | null;
  state: ResourceEconomyState;
};

export function completeResourceBuildingProject(
  state: ResourceEconomyState,
  now: number,
): ResourceCompletionTransition {
  const active = state.queue[0];
  if (!active || now < active.finishAt) return { completedRole: null, state };

  const definition = getResourceBuildingDefinition(active.assetRole);
  const currentLevel = state.buildings[active.assetRole] ?? 0;
  const nextLevel = Math.min(definition.maxLevel, Math.max(currentLevel + 1, active.targetLevel));
  const resources = { ...state.resources };

  if (nextLevel > currentLevel && definition.effect?.kind === 'energy') {
    resources.energy += definition.effect.amountPerLevel * (nextLevel - currentLevel);
  }

  return {
    completedRole: active.assetRole,
    state: {
      ...state,
      resources,
      buildings: {
        ...state.buildings,
        [active.assetRole]: nextLevel,
      },
      queue: state.queue.slice(1),
    },
  };
}

export function getBuildingEffectText(definition: BuildingDefinition, currentLevel: number): string {
  if (!definition.effect) return 'Эффект будет определён после утверждения баланса.';
  const current = definition.effect.amountPerLevel * currentLevel;
  const next = definition.effect.amountPerLevel * Math.min(definition.maxLevel, currentLevel + 1);
  return `${definition.effect.label}: +${current} → +${next}`;
}
