import type { BuildingRole, IndustryBuildingRole } from './resource-zone.ts';

export const PRODUCTION_BOT_BUILDING_ROLES = [
  'construction',
  'advanced-factory',
] as const satisfies readonly IndustryBuildingRole[];

export type ProductionBotBuildingRole = (typeof PRODUCTION_BOT_BUILDING_ROLES)[number];

export const BOT_RESOURCES = ['metal', 'minerals', 'gas'] as const;
export type BotResource = (typeof BOT_RESOURCES)[number];

export type BotAssignment = Record<BotResource, number>;

export type BotBonusDefinition = {
  resource: BotResource;
  label: string;
  percentPerBot: number;
};

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

export function getProductionBotBonusDefinition(resource: BotResource): BotBonusDefinition {
  const definition = bonusByResource.get(resource);
  if (!definition) throw new Error(`Unknown production bot resource: ${resource}`);
  return definition;
}

export function getProductionBotBonusPercent(assignment: BotAssignment, resource: BotResource): number {
  const assigned = Math.max(0, Math.floor(assignment[resource]));
  return assigned * getProductionBotBonusDefinition(resource).percentPerBot;
}
