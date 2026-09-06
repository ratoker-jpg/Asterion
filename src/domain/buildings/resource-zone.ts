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

export const INDUSTRY_BUILDING_ROLES = [
  'construction',
  'advanced-factory',
  'metal-storage',
  'mineral-storage',
  'gas-storage',
  'recycling',
  'trade-center',
] as const;

export const MILITARY_BUILDING_ROLES = [
  'shipyard',
  'research',
  'spaceport',
  'planetary-government',
  'bank',
] as const;

export const BUILDING_ROLES = [
  ...RESOURCE_BUILDING_ROLES,
  ...INDUSTRY_BUILDING_ROLES,
  ...MILITARY_BUILDING_ROLES,
] as const;

export const BUILDING_QUEUE_CAPACITY = 3;
export const RESOURCE_BUILDING_QUEUE_CAPACITY = BUILDING_QUEUE_CAPACITY;
export const ADVANCED_FACTORY_MAX_LEVEL = 5;

export type ResourceBuildingRole = (typeof RESOURCE_BUILDING_ROLES)[number];
export type IndustryBuildingRole = (typeof INDUSTRY_BUILDING_ROLES)[number];
export type MilitaryBuildingRole = (typeof MILITARY_BUILDING_ROLES)[number];
export type BuildingRole = (typeof BUILDING_ROLES)[number];
export type BuildingZone = 'resource' | 'industry' | 'military';
export type BuildingFaction = 'aegis';
export type ResourceKey = 'metal' | 'minerals' | 'gas' | 'energy';

export type ResourceCost = Record<ResourceKey, number>;
export type ResourceWallet = Record<ResourceKey, number>;
export type BuildingLevels = Record<BuildingRole, number>;
export type ResourceBuildingLevels = BuildingLevels;
export type ScienceLevels = Partial<Record<ScienceId, number>>;

export type BuildingEffect = {
  kind: 'energy';
  amountPerLevel: number;
  label: string;
};

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
  prototypeCost: ResourceCost;
  prototypeTimeMs: number;
  prototypeBalance: boolean;
  requirements: readonly BuildingRequirement[];
  effect?: BuildingEffect;
};

export type BuildingQueueItem = {
  kind: 'building';
  assetRole: BuildingRole;
  planetId: string;
  enqueuedAt: number;
  startedAt: number;
  finishAt: number;
  targetLevel: number;
};

export type BuildingEconomyState = {
  resources: ResourceWallet;
  buildings: BuildingLevels;
  queue: BuildingQueueItem[];
  scienceLevels: ScienceLevels;
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
  cost: ResourceCost;
  timeMs: number;
  missing: Partial<Record<ResourceKey, number>>;
  requirements: readonly BuildingRequirementState[];
};

const EXISTING_RESOURCE_PROTOTYPE_COST: ResourceCost = {
  metal: 1200,
  minerals: 0,
  gas: 0,
  energy: 0,
};

const EXISTING_RESOURCE_PROTOTYPE_TIME_MS = 45_000;

const NEW_ZONE_PROTOTYPE_BALANCE = {
  maxLevel: 20,
  cost: EXISTING_RESOURCE_PROTOTYPE_COST,
  timeMs: EXISTING_RESOURCE_PROTOTYPE_TIME_MS,
} as const;

export const RESOURCE_BASE_INCOME_PER_HOUR = {
  metal: 774,
  minerals: 510,
  gas: 312,
} as const;

export const BUILDING_PROTOTYPE_DATA_NOTE =
  'Цена, время и лимиты новых зон остаются локальными prototype-данными до утверждения баланса. Канонические названия, роли, назначения и PNG от них не зависят.';
export const RESOURCE_PROTOTYPE_DATA_NOTE = BUILDING_PROTOTYPE_DATA_NOTE;

const BUILDING_ART: Record<BuildingRole, string> = {
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
  construction: new URL('../../../assets/source/New assets/buildings/aegis/building.aegis.construction.png', import.meta.url).href,
  'advanced-factory': new URL('../../../assets/source/New assets/buildings/aegis/building.aegis.advanced-factory.png', import.meta.url).href,
  'metal-storage': new URL('../../../assets/source/New assets/buildings/aegis/building.aegis.metal-storage.png', import.meta.url).href,
  'mineral-storage': new URL('../../../assets/source/New assets/buildings/aegis/building.aegis.mineral-storage.png', import.meta.url).href,
  'gas-storage': new URL('../../../assets/source/New assets/buildings/aegis/building.aegis.gas-storage.png', import.meta.url).href,
  recycling: new URL('../../../assets/source/New assets/buildings/aegis/building.aegis.recycling.png', import.meta.url).href,
  'trade-center': new URL('../../../assets/source/New assets/buildings/aegis/building.aegis.trade-center.png', import.meta.url).href,
  shipyard: new URL('../../../assets/source/New assets/buildings/aegis/building.aegis.shipyard.png', import.meta.url).href,
  research: new URL('../../../assets/source/New assets/buildings/aegis/building.aegis.research.png', import.meta.url).href,
  spaceport: new URL('../../../assets/source/New assets/buildings/aegis/building.aegis.spaceport.png', import.meta.url).href,
  'planetary-government': new URL('../../../assets/source/New assets/buildings/aegis/building.aegis.planetary-government.png', import.meta.url).href,
  bank: new URL('../../../assets/source/New assets/buildings/aegis/building.aegis.bank.png', import.meta.url).href,
};

const reqBuilding = (assetRole: BuildingRole, level: number): BuildingRequirement => ({ kind: 'building-level', assetRole, level });
const reqScience = (scienceId: ScienceId, level: number): BuildingRequirement => ({ kind: 'science-level', scienceId, level });

const definition = (
  zone: BuildingZone,
  assetRole: BuildingRole,
  name: string,
  purpose: string,
  maxLevel: number,
  requirements: readonly BuildingRequirement[] = [],
  effect?: BuildingEffect,
  prototypeBalance = zone !== 'resource',
): BuildingDefinition => ({
  zone,
  assetRole,
  faction: 'aegis',
  name,
  purpose,
  art: BUILDING_ART[assetRole],
  maxLevel,
  prototypeCost: { ...(zone === 'resource' ? EXISTING_RESOURCE_PROTOTYPE_COST : NEW_ZONE_PROTOTYPE_BALANCE.cost) },
  prototypeTimeMs: zone === 'resource' ? EXISTING_RESOURCE_PROTOTYPE_TIME_MS : NEW_ZONE_PROTOTYPE_BALANCE.timeMs,
  prototypeBalance,
  requirements,
  ...(effect ? { effect } : {}),
});

export const ASTER_RESOURCE_BUILDINGS: readonly BuildingDefinition[] = [
  definition('resource', 'metal-production-1', 'Металлическая шахта I', 'Базовая добыча металла.', 30, [], undefined, false),
  definition('resource', 'metal-production-2', 'Металлическая шахта II', 'Улучшенная добыча металла.', 30, [reqBuilding('metal-production-1', 10)], undefined, false),
  definition('resource', 'metal-production-3', 'Металлическая шахта III', 'Высшая ступень добычи металла.', 30, [reqBuilding('metal-production-1', 15)], undefined, false),
  definition('resource', 'mineral-production-1', 'Минеральная шахта I', 'Базовая добыча минералов.', 30, [], undefined, false),
  definition('resource', 'mineral-production-2', 'Минеральная шахта II', 'Улучшенная добыча минералов.', 30, [], undefined, false),
  definition('resource', 'gas-production-1', 'Газовая скважина I', 'Базовая добыча газа.', 30, [], undefined, false),
  definition('resource', 'gas-production-2', 'Газовая скважина II', 'Улучшенная добыча газа.', 30, [], undefined, false),
  definition('resource', 'basic-energy', 'Солнечная электростанция', 'Базовая генерация энергии.', 30, [], { kind: 'energy', amountPerLevel: 25, label: 'Энергия планеты' }, false),
  definition('resource', 'advanced-energy', 'Ядерный реактор', 'Продвинутая генерация энергии.', 20, [reqBuilding('basic-energy', 10), reqScience(2, 5), reqScience(1, 5)], undefined, false),
  definition('resource', 'hangar', 'Ангар', 'Хранение и увеличение доступной вместимости кораблей/юнитов.', 20, [], undefined, false),
];

export const ASTER_INDUSTRY_BUILDINGS: readonly BuildingDefinition[] = [
  definition('industry', 'construction', 'Фабрика', 'Базовое производство и строительство.', NEW_ZONE_PROTOTYPE_BALANCE.maxLevel),
  definition('industry', 'advanced-factory', 'Промышленный комплекс', 'Продвинутое производство.', ADVANCED_FACTORY_MAX_LEVEL, [reqBuilding('construction', 10)]),
  definition('industry', 'metal-storage', 'Склад металла', 'Хранение металла.', NEW_ZONE_PROTOTYPE_BALANCE.maxLevel, [reqBuilding('metal-production-1', 1)]),
  definition('industry', 'mineral-storage', 'Склад минералов', 'Хранение минералов.', NEW_ZONE_PROTOTYPE_BALANCE.maxLevel, [reqBuilding('mineral-production-1', 1)]),
  definition('industry', 'gas-storage', 'Газовое хранилище', 'Хранение газа.', NEW_ZONE_PROTOTYPE_BALANCE.maxLevel, [reqBuilding('gas-production-1', 1)]),
  definition('industry', 'recycling', 'Перерабатывающий центр', 'Переработка и утилизация ресурсов/обломков.', NEW_ZONE_PROTOTYPE_BALANCE.maxLevel, [reqBuilding('shipyard', 5), reqScience(2, 6)]),
  definition('industry', 'trade-center', 'Торговый центр', 'Торговля и обмен ресурсами.', NEW_ZONE_PROTOTYPE_BALANCE.maxLevel),
];

export const ASTER_MILITARY_BUILDINGS: readonly BuildingDefinition[] = [
  definition('military', 'shipyard', 'Верфь', 'Производство и обслуживание кораблей.', NEW_ZONE_PROTOTYPE_BALANCE.maxLevel),
  definition('military', 'research', 'Лаборатория', 'Исследования и развитие технологий.', NEW_ZONE_PROTOTYPE_BALANCE.maxLevel, [reqBuilding('construction', 1)]),
  definition('military', 'spaceport', 'Космодром', 'Космическая инфраструктура и операции с флотом.', NEW_ZONE_PROTOTYPE_BALANCE.maxLevel),
  definition('military', 'planetary-government', 'Палата управления', 'Управленческое и союзное здание планеты.', NEW_ZONE_PROTOTYPE_BALANCE.maxLevel),
  definition('military', 'bank', 'Банк', 'Финансовая инфраструктура и экономические операции.', NEW_ZONE_PROTOTYPE_BALANCE.maxLevel),
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

export function getBuildingDefinition(assetRole: BuildingRole): BuildingDefinition {
  const item = definitionByRole.get(assetRole);
  if (!item) throw new Error(`Unknown building role: ${assetRole}`);
  return item;
}

export const getResourceBuildingDefinition = getBuildingDefinition;

export function getBuildingsForZone(zone: BuildingZone): readonly BuildingDefinition[] {
  return ASTER_BUILDINGS_BY_ZONE[zone];
}

export function createDefaultBuildingLevels(): BuildingLevels {
  return Object.fromEntries(BUILDING_ROLES.map((role) => [role, 0])) as BuildingLevels;
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

  const rawStartedAt = isFiniteTimestamp(source.startedAt) ? source.startedAt : null;
  const rawFinishAt = isFiniteTimestamp(source.finishAt) ? source.finishAt : null;
  const duration = rawStartedAt != null && rawFinishAt != null
    ? Math.max(1, rawFinishAt - rawStartedAt)
    : item.prototypeTimeMs;
  const startedAt = index === 0
    ? (rawStartedAt ?? 0)
    : (previousFinishAt ?? rawStartedAt ?? 0);
  const finishAt = index === 0 && rawFinishAt != null
    ? Math.max(startedAt, rawFinishAt)
    : startedAt + duration;
  const fallbackTarget = Math.min(item.maxLevel, (buildings[role] ?? 0) + queuedBefore + 1);
  const targetLevel = toSafeLevel(source.targetLevel, item.maxLevel) || fallbackTarget;
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

export function migrateBuildingQueue(
  value: unknown,
  planetId: string,
  buildings: BuildingLevels = createDefaultBuildingLevels(),
): BuildingQueueItem[] {
  const sourceItems = Array.isArray(value) ? value : value ? [value] : [];
  const migrated: BuildingQueueItem[] = [];
  const queuedRoleCounts: Partial<Record<BuildingRole, number>> = {};
  let previousFinishAt: number | null = null;

  for (const source of sourceItems) {
    if (migrated.length >= BUILDING_QUEUE_CAPACITY) break;
    const item = migrateQueueItem(source, planetId, migrated.length, previousFinishAt, buildings, queuedRoleCounts);
    if (!item) continue;
    migrated.push(item);
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
  const base = {
    currentLevel,
    projectedLevel,
    nextLevel: projectedLevel < item.maxLevel ? projectedLevel + 1 : null,
    maxLevel: item.maxLevel,
    cost: { ...item.prototypeCost },
    timeMs: item.prototypeTimeMs,
    requirements,
  };

  if (projectedLevel >= item.maxLevel) {
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

  if (state.queue.length >= BUILDING_QUEUE_CAPACITY) {
    return { ...base, status: 'queue-full', canBuild: false, reason: 'Очередь заполнена.', missing: {} };
  }

  const missing: Partial<Record<ResourceKey, number>> = {};
  for (const key of Object.keys(item.prototypeCost) as ResourceKey[]) {
    const deficit = item.prototypeCost[key] - state.resources[key];
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
): BuildTransition {
  const availability = evaluateBuildingBuild(state, assetRole);
  if (!availability.canBuild || availability.nextLevel == null) return { ok: false, state, reason: availability.reason };

  const item = getBuildingDefinition(assetRole);
  const resources: ResourceWallet = { ...state.resources };
  for (const key of Object.keys(item.prototypeCost) as ResourceKey[]) {
    resources[key] -= item.prototypeCost[key];
  }

  const previous = state.queue[state.queue.length - 1] ?? null;
  const startedAt = previous ? previous.finishAt : enqueuedAt;
  const queueItem: BuildingQueueItem = {
    kind: 'building',
    assetRole,
    planetId,
    enqueuedAt,
    startedAt,
    finishAt: startedAt + item.prototypeTimeMs,
    targetLevel: availability.nextLevel,
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
  const nextLevel = Math.min(item.maxLevel, Math.max(currentLevel + 1, active.targetLevel));
  const resources = { ...state.resources };

  if (nextLevel > currentLevel && item.effect?.kind === 'energy') {
    resources.energy += item.effect.amountPerLevel * (nextLevel - currentLevel);
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

export const completeResourceBuildingProject = completeBuildingProject;

export function getBuildingEffectText(item: BuildingDefinition, currentLevel: number): string {
  if (!item.effect) return 'Эффект будет определён после утверждения баланса.';
  const current = item.effect.amountPerLevel * currentLevel;
  const next = item.effect.amountPerLevel * Math.min(item.maxLevel, currentLevel + 1);
  return `${item.effect.label}: +${current} → +${next}`;
}
