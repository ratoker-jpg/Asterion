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

export type ResourceBuildingRole = (typeof RESOURCE_BUILDING_ROLES)[number];
export type BuildingZone = 'resource' | 'industry' | 'military';
export type BuildingFaction = 'aegis';
export type ResourceKey = 'metal' | 'minerals' | 'gas' | 'energy';

export type ResourceCost = Record<ResourceKey, number>;
export type ResourceWallet = Record<ResourceKey, number>;
export type ResourceBuildingLevels = Record<ResourceBuildingRole, number>;

export type BuildingEffect = {
  kind: 'energy';
  amountPerLevel: number;
  label: string;
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
  effect?: BuildingEffect;
};

export type BuildingQueueItem = {
  kind: 'building';
  assetRole: ResourceBuildingRole;
  planetId: string;
  startedAt: number;
  finishAt: number;
};

export type ResourceEconomyState = {
  resources: ResourceWallet;
  buildings: ResourceBuildingLevels;
  queue: BuildingQueueItem | null;
};

export type BuildAvailabilityStatus =
  | 'available'
  | 'insufficient-resource'
  | 'queue-busy'
  | 'already-building'
  | 'max-level';

export type BuildAvailability = {
  status: BuildAvailabilityStatus;
  canBuild: boolean;
  reason: string | null;
  currentLevel: number;
  nextLevel: number | null;
  maxLevel: number;
  cost: ResourceCost;
  timeMs: number;
  missing: Partial<Record<ResourceKey, number>>;
};

const EXISTING_PROTOTYPE_COST: ResourceCost = {
  metal: 1200,
  minerals: 0,
  gas: 0,
  energy: 0,
};

const EXISTING_PROTOTYPE_TIME_MS = 45_000;
const VERTICAL_SLICE_MAX_LEVEL = 1;

export const RESOURCE_BASE_INCOME_PER_HOUR = {
  metal: 774,
  minerals: 510,
  gas: 312,
} as const;

export const RESOURCE_PROTOTYPE_DATA_NOTE =
  'Цена, время и лимит уровня — локальные данные вертикального среза Asterion. Баланс и эффекты добывающих зданий будут определены на следующем этапе.';

const art = (fileName: string) => new URL(
  `../../../assets/source/New assets/buildings/aegis/${fileName}`,
  import.meta.url,
).href;

const baseDefinition = (
  assetRole: ResourceBuildingRole,
  name: string,
  purpose: string,
  fileName: string,
  effect?: BuildingEffect,
): BuildingDefinition => ({
  zone: 'resource',
  assetRole,
  faction: 'aegis',
  name,
  purpose,
  art: art(fileName),
  maxLevel: VERTICAL_SLICE_MAX_LEVEL,
  prototypeCost: { ...EXISTING_PROTOTYPE_COST },
  prototypeTimeMs: EXISTING_PROTOTYPE_TIME_MS,
  ...(effect ? { effect } : {}),
});

export const ASTER_RESOURCE_BUILDINGS: readonly BuildingDefinition[] = [
  baseDefinition('metal-production-1', 'Металлическая шахта I', 'Базовая добыча металла.', 'building.aegis.metal-production-1.png'),
  baseDefinition('metal-production-2', 'Металлическая шахта II', 'Улучшенная добыча металла.', 'building.aegis.metal-production-2.png'),
  baseDefinition('metal-production-3', 'Металлическая шахта III', 'Высшая ступень добычи металла.', 'building.aegis.metal-production-3.png'),
  baseDefinition('mineral-production-1', 'Минеральная шахта I', 'Базовая добыча минералов.', 'building.aegis.mineral-production-1.png'),
  baseDefinition('mineral-production-2', 'Минеральная шахта II', 'Улучшенная добыча минералов.', 'building.aegis.mineral-production-2.png'),
  baseDefinition('gas-production-1', 'Газовая скважина I', 'Базовая добыча газа.', 'building.aegis.gas-production-1.png'),
  baseDefinition('gas-production-2', 'Газовая скважина II', 'Улучшенная добыча газа.', 'building.aegis.gas-production-2.png'),
  baseDefinition(
    'basic-energy',
    'Солнечная электростанция',
    'Базовая генерация энергии.',
    'building.aegis.basic-energy.png',
    { kind: 'energy', amountPerLevel: 25, label: 'Энергия планеты' },
  ),
  baseDefinition('advanced-energy', 'Ядерный реактор', 'Продвинутая генерация энергии.', 'building.aegis.advanced-energy.png'),
  baseDefinition('hangar', 'Ангар', 'Хранение и увеличение доступной вместимости кораблей/юнитов.', 'building.aegis.hangar.png'),
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

export function migrateResourceBuildingQueue(value: unknown, planetId: string): BuildingQueueItem | null {
  if (!value || typeof value !== 'object') return null;
  const source = value as Record<string, unknown>;
  if (!isFiniteTimestamp(source.startedAt) || !isFiniteTimestamp(source.finishAt)) return null;

  const role = isResourceBuildingRole(source.assetRole)
    ? source.assetRole
    : source.id === 'solar-station'
      ? 'basic-energy'
      : null;

  if (!role) return null;

  return {
    kind: 'building',
    assetRole: role,
    planetId,
    startedAt: source.startedAt,
    finishAt: Math.max(source.startedAt, source.finishAt),
  };
}

const resourceLabel: Record<ResourceKey, string> = {
  metal: 'металла',
  minerals: 'минералов',
  gas: 'газа',
  energy: 'энергии',
};

export function evaluateResourceBuildingBuild(
  state: ResourceEconomyState,
  assetRole: ResourceBuildingRole,
): BuildAvailability {
  const definition = getResourceBuildingDefinition(assetRole);
  const currentLevel = state.buildings[assetRole] ?? 0;
  const base = {
    currentLevel,
    nextLevel: currentLevel < definition.maxLevel ? currentLevel + 1 : null,
    maxLevel: definition.maxLevel,
    cost: { ...definition.prototypeCost },
    timeMs: definition.prototypeTimeMs,
  };

  if (currentLevel >= definition.maxLevel) {
    return { ...base, status: 'max-level', canBuild: false, reason: 'Достигнут максимум вертикального среза.', missing: {} };
  }

  if (state.queue?.assetRole === assetRole) {
    return { ...base, status: 'already-building', canBuild: false, reason: 'Это здание уже находится в общей очереди.', missing: {} };
  }

  if (state.queue) {
    return { ...base, status: 'queue-busy', canBuild: false, reason: 'Общая очередь строительства занята.', missing: {} };
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
  startedAt: number,
): ResourceBuildTransition {
  const availability = evaluateResourceBuildingBuild(state, assetRole);
  if (!availability.canBuild) return { ok: false, state, reason: availability.reason };

  const definition = getResourceBuildingDefinition(assetRole);
  const resources: ResourceWallet = { ...state.resources };
  for (const key of Object.keys(definition.prototypeCost) as ResourceKey[]) {
    resources[key] -= definition.prototypeCost[key];
  }

  return {
    ok: true,
    reason: null,
    state: {
      ...state,
      resources,
      queue: {
        kind: 'building',
        assetRole,
        planetId,
        startedAt,
        finishAt: startedAt + definition.prototypeTimeMs,
      },
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
  const queue = state.queue;
  if (!queue || now < queue.finishAt) return { completedRole: null, state };

  const definition = getResourceBuildingDefinition(queue.assetRole);
  const currentLevel = state.buildings[queue.assetRole] ?? 0;
  const nextLevel = Math.min(definition.maxLevel, currentLevel + 1);
  const resources = { ...state.resources };

  if (nextLevel > currentLevel && definition.effect?.kind === 'energy') {
    resources.energy += definition.effect.amountPerLevel;
  }

  return {
    completedRole: queue.assetRole,
    state: {
      resources,
      buildings: {
        ...state.buildings,
        [queue.assetRole]: nextLevel,
      },
      queue: null,
    },
  };
}

export function getBuildingEffectText(definition: BuildingDefinition, currentLevel: number): string {
  if (!definition.effect) return 'Механика следующего этапа';
  const current = definition.effect.amountPerLevel * currentLevel;
  const next = definition.effect.amountPerLevel * Math.min(definition.maxLevel, currentLevel + 1);
  return `${definition.effect.label}: +${current} → +${next}`;
}
