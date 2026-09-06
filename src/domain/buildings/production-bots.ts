import type { BuildingLevels, BuildingRole, IndustryBuildingRole } from './resource-zone.ts';

export const PRODUCTION_BOT_BUILDING_ROLES = [
  'construction',
  'advanced-factory',
] as const satisfies readonly IndustryBuildingRole[];

export type ProductionBotBuildingRole = (typeof PRODUCTION_BOT_BUILDING_ROLES)[number];

export const BOT_RESOURCES = ['metal', 'minerals', 'gas'] as const;
export type BotResource = (typeof BOT_RESOURCES)[number];

export type BotAssignment = Record<BotResource, number>;
export type ProductionResourceIncome = Record<BotResource, number>;

export type BotBonusDefinition = {
  resource: BotResource;
  label: string;
  percentPerBot: number;
};

export const MAX_PRODUCTION_BOTS_PER_RESOURCE = 10;
export const MAX_PRODUCTION_BOT_POOL = 30;

export const PRODUCTION_BOT_BONUSES: readonly BotBonusDefinition[] = [
  { resource: 'metal', label: 'Металл', percentPerBot: 6 },
  { resource: 'minerals', label: 'Минералы', percentPerBot: 5 },
  { resource: 'gas', label: 'Газ', percentPerBot: 4 },
];

const bonusByResource = new Map<BotResource, BotBonusDefinition>(
  PRODUCTION_BOT_BONUSES.map((definition) => [definition.resource, definition]),
);

export function isProductionBotBuildingRole(role: BuildingRole): role is ProductionBotBuildingRole {
  return (PRODUCTION_BOT_BUILDING_ROLES as readonly BuildingRole[]).includes(role);
}

export function createEmptyBotAssignment(): BotAssignment {
  return {
    metal: 0,
    minerals: 0,
    gas: 0,
  };
}

function toSafeBotCount(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  return Math.min(MAX_PRODUCTION_BOTS_PER_RESOURCE, Math.max(0, Math.floor(value)));
}

export function getAvailableProductionBots(
  buildings: Pick<BuildingLevels, 'construction' | 'advanced-factory'>,
): number {
  const factoryLevel = Math.max(0, Math.floor(buildings.construction ?? 0));
  const advancedFactoryLevel = Math.max(0, Math.floor(buildings['advanced-factory'] ?? 0));
  return Math.min(MAX_PRODUCTION_BOT_POOL, factoryLevel + advancedFactoryLevel * 2);
}

export function getProductionBotAssignmentTotal(assignment: BotAssignment): number {
  return BOT_RESOURCES.reduce((total, resource) => total + toSafeBotCount(assignment[resource]), 0);
}

export function getProductionBotFreeCount(assignment: BotAssignment, availableBots: number): number {
  return Math.max(0, Math.floor(availableBots) - getProductionBotAssignmentTotal(assignment));
}

export function isProductionBotAssignmentValid(assignment: BotAssignment, availableBots: number): boolean {
  const available = Math.max(0, Math.floor(availableBots));
  return BOT_RESOURCES.every((resource) => {
    const value = assignment[resource];
    return Number.isInteger(value) && value >= 0 && value <= MAX_PRODUCTION_BOTS_PER_RESOURCE;
  }) && getProductionBotAssignmentTotal(assignment) <= available;
}

export function productionBotAssignmentsEqual(left: BotAssignment, right: BotAssignment): boolean {
  return BOT_RESOURCES.every((resource) => left[resource] === right[resource]);
}

export function migrateProductionBotAssignment(
  value: unknown,
  buildings: Pick<BuildingLevels, 'construction' | 'advanced-factory'>,
): BotAssignment {
  const availableBots = getAvailableProductionBots(buildings);
  const source = value && typeof value === 'object' ? value as Partial<Record<BotResource, unknown>> : {};
  const migrated = createEmptyBotAssignment();
  let remaining = availableBots;

  for (const resource of BOT_RESOURCES) {
    const desired = toSafeBotCount(source[resource]);
    const assigned = Math.min(desired, remaining);
    migrated[resource] = assigned;
    remaining -= assigned;
  }

  return migrated;
}

export function setProductionBotDraftResource(
  current: BotAssignment,
  resource: BotResource,
  requestedValue: number,
  availableBots: number,
): BotAssignment {
  const next = { ...current };
  const usedByOtherResources = BOT_RESOURCES.reduce(
    (total, candidate) => candidate === resource ? total : total + toSafeBotCount(current[candidate]),
    0,
  );
  const maxAllowed = Math.max(
    0,
    Math.min(MAX_PRODUCTION_BOTS_PER_RESOURCE, Math.floor(availableBots) - usedByOtherResources),
  );
  next[resource] = Math.min(maxAllowed, Math.max(0, Math.floor(requestedValue)));
  return next;
}

export function getProductionBotBonusDefinition(resource: BotResource): BotBonusDefinition {
  const definition = bonusByResource.get(resource);
  if (!definition) throw new Error(`Unknown production bot resource: ${resource}`);
  return definition;
}

export function getProductionBotBonusPercent(assignment: BotAssignment, resource: BotResource): number {
  const assigned = toSafeBotCount(assignment[resource]);
  return assigned * getProductionBotBonusDefinition(resource).percentPerBot;
}

export function getProductionBotIncomePerHour(
  baseIncome: Readonly<Record<BotResource, number>>,
  appliedAssignment: BotAssignment,
): ProductionResourceIncome {
  return Object.fromEntries(BOT_RESOURCES.map((resource) => {
    const bonusPercent = getProductionBotBonusPercent(appliedAssignment, resource);
    return [resource, baseIncome[resource] * (1 + bonusPercent / 100)];
  })) as ProductionResourceIncome;
}
