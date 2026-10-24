import { getFactionDefenseCatalog, getFactionShipCatalog } from '../domain/combat/faction-catalog.ts';
import type { CombatFactionId } from '../domain/combat/factions.ts';
import type { ShipId } from '../domain/combat/ids.ts';
import type { BuildingRole } from '../domain/buildings/resource-zone.ts';
import type { SpyReportSnapshot, SpyTargetState } from '../domain/espionage/types.ts';
import type { NpcProfile } from '../domain/npc/types.ts';
import { estimateForcePower, estimateWinProbability, planningHorizonHours, type ForceStack } from '../domain/npc/utility.ts';
import { estimateNpcBuildingIncomeGain, getNpcPlanetIncomePerHour } from './npc-economy.ts';
import type { SaveState } from './contracts.ts';

/**
 * Owner-scoped utility estimates for NPC candidate actions. Every input is
 * something this owner could know as a player: its own planets, income and
 * fleet, its own spy reports and the battles it fought. Nothing here reads a
 * foreign planet's live state.
 */

const HOUR = 3_600_000;
type Resources = Readonly<{ metal?: number; minerals?: number; gas?: number }>;
type Catalog = ReadonlyArray<{ id: string; cost?: Resources; combat?: { attack: number; life: number } }>;

function unit(value: number): number {
  return Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));
}

function costValue(cost: Resources | null | undefined): number {
  return Math.max(0, cost?.metal ?? 0) + Math.max(0, cost?.minerals ?? 0) + Math.max(0, cost?.gas ?? 0);
}

function stacks(catalog: Catalog, counts: Readonly<Partial<Record<string, number>>> | undefined): ForceStack[] {
  if (!counts) return [];
  return catalog.flatMap((entity) => {
    const count = counts[entity.id] ?? 0;
    return count > 0 && entity.combat ? [{ count, attack: entity.combat.attack, life: entity.combat.life }] : [];
  });
}

function fleetCost(catalog: Catalog, counts: Readonly<Partial<Record<string, number>>>): number {
  return catalog.reduce((sum, entity) => sum + costValue(entity.cost) * Math.max(0, counts[entity.id] ?? 0), 0);
}

export type NpcUtilityContext = Readonly<{
  profile: NpcProfile;
  at: number;
  timeScale: number;
  /** One day of the owner's whole income: the unit every utility is expressed in. */
  dayValue: number;
  ownPlanets: readonly SpyTargetState[];
  /** Hostile battles this owner defended in the last two game days (0..1). */
  threat: number;
  latestReports: ReadonlyMap<string, SpyReportSnapshot>;
}>;

export function createNpcUtilityContext(state: SaveState, profile: NpcProfile, at: number, timeScale: number): NpcUtilityContext {
  const ownerId = profile.ownerId;
  const ownPlanets = Object.values(state.espionage?.targets ?? {}).filter((target) => target.kind === 'npc' && target.ownerId === ownerId);
  const income = ownPlanets.reduce((sum, target) => sum + getNpcPlanetIncomePerHour(target, timeScale), 0);
  let defended = 0;
  for (const report of state.combat.reports) {
    if (report.defender.playerId !== ownerId) continue;
    const when = Date.parse(report.timestamp);
    if (Number.isFinite(when) && when <= at && at - when <= 48 * HOUR) defended += 1;
  }
  const latestReports = new Map<string, SpyReportSnapshot>();
  for (const report of state.espionage?.reports ?? []) {
    if (report.ownerId !== ownerId || report.createdAt > at) continue;
    const previous = latestReports.get(report.targetPlanetId);
    if (!previous || previous.createdAt <= report.createdAt) latestReports.set(report.targetPlanetId, report);
  }
  return {
    profile, at, timeScale,
    dayValue: Math.max(2_000, income * 24),
    ownPlanets,
    threat: Math.min(1, defended / 3),
    latestReports,
  };
}

const INCOME_ROLES = new Set<string>(['metal-production-1', 'metal-production-2', 'metal-production-3',
  'mineral-production-1', 'mineral-production-2', 'gas-production-1', 'gas-production-2']);
const STORAGE_ROLES: Readonly<Record<string, 'metal' | 'minerals' | 'gas'>> = {
  'metal-storage': 'metal', 'mineral-storage': 'minerals', 'gas-storage': 'gas',
};

/** Payback over the owner's planning horizon; storage only when it is filling up. */
export function estimateBuildingUtility(context: NpcUtilityContext, target: SpyTargetState, role: BuildingRole,
  nextLevel: number, cost: Resources | null, capacity?: Readonly<Partial<Record<string, number>>>): number {
  const price = costValue(cost);
  const traits = context.profile.traits;
  if (INCOME_ROLES.has(role)) {
    const gain = estimateNpcBuildingIncomeGain(target, role, nextLevel, context.timeScale);
    return (gain * planningHorizonHours(context.profile) - price) / context.dayValue + 0.2 * (unit(traits.economyFocus) - 0.5);
  }
  const resource = STORAGE_ROLES[role];
  if (resource) {
    const cap = capacity?.[resource] ?? 0;
    const fill = cap > 0 ? (target.resources[resource] ?? 0) / cap : 0;
    return (fill >= 0.8 ? 0.6 : -0.3) - price / context.dayValue * 0.5;
  }
  // Energy, shipyard, research and other enablers: worth roughly what they
  // cost to an owner who leans that way; their payoff is indirect.
  return -0.15 - price / context.dayValue * 0.25 + 0.3 * (unit(traits.economyFocus) + unit(traits.militaryFocus)) / 2;
}

export function estimateScienceUtility(context: NpcUtilityContext, cost: Resources | null): number {
  const focus = unit(context.profile.traits.scienceFocus);
  return 0.4 * focus + 0.2 * unit(context.profile.traits.planningHorizon) - 0.2 - costValue(cost) / context.dayValue * 0.3;
}

/** Ships and defence are worth more after being attacked and to military owners. */
export function estimateProductionUtility(context: NpcUtilityContext, queueKind: string, cost: Resources | null): number {
  const military = unit(context.profile.traits.militaryFocus);
  const price = costValue(cost) / context.dayValue;
  const need = queueKind === 'defense' ? 0.25 + 1.2 * context.threat : 0.35 + 0.5 * context.threat;
  return need + 0.4 * military - 0.35 - price * 0.4;
}

/**
 * War: own force against what the owner's latest spy report showed, inflated
 * by its age; unknown forces are feared rather than ignored.
 */
export function estimateAttackUtility(context: NpcUtilityContext, origin: SpyTargetState, targetPlanetId: string,
  selectedShips: Readonly<Partial<Record<ShipId, number>>>): number {
  const traits = context.profile.traits;
  const ownCatalog = getFactionShipCatalog(origin.raceId) as Catalog;
  const ownPower = estimateForcePower(stacks(ownCatalog, selectedShips));
  const risked = fleetCost(ownCatalog, selectedShips);
  const report = context.latestReports.get(targetPlanetId);
  if (!report) return -1.2 + 0.6 * (unit(traits.aggression) - 0.5);
  const race = report.targetRaceId as CombatFactionId;
  const known = report.fleet !== undefined || report.defense !== undefined;
  const ageHours = Math.max(0, (context.at - report.createdAt) / HOUR);
  const reportedPower = estimateForcePower([
    ...stacks(getFactionShipCatalog(race) as Catalog, report.fleet),
    ...stacks(getFactionDefenseCatalog(race) as Catalog, report.defense),
  ]);
  const enemyPower = (known ? reportedPower : ownPower * 1.3) * (1 + Math.min(1, ageHours / 72));
  const win = estimateWinProbability(ownPower, enemyPower);
  const loot = 0.5 * costValue(report.resources);
  const expectedLoss = (1 - win) * risked * 0.85 + win * risked * 0.1;
  const risk = (1 - unit(traits.riskTolerance)) * win * (1 - win) * risked;
  return (win * loot - expectedLoss - risk) / context.dayValue + 0.5 * (unit(traits.aggression) - 0.5);
}

/** Intelligence is worth more when the owner has none or it has gone stale. */
export function estimateEspionageUtility(context: NpcUtilityContext, targetPlanetId: string): number {
  const traits = context.profile.traits;
  const report = context.latestReports.get(targetPlanetId);
  const staleness = report ? Math.min(1, (context.at - report.createdAt) / (48 * HOUR)) : 1;
  return -0.25 + 0.6 * staleness * (unit(traits.aggression) + unit(traits.militaryFocus)) / 2;
}

/** Closer free slots are cheaper to reach and defend. */
export function estimateColonizeUtility(context: NpcUtilityContext, origin: SpyTargetState,
  coordinate: Readonly<{ galaxy: number; system: number }>): number {
  const traits = context.profile.traits;
  const systems = coordinate.galaxy === origin.coordinate.galaxy ? Math.abs(coordinate.system - origin.coordinate.system) : 40;
  return -0.1 + 0.8 * unit(traits.expansionFocus) - 0.12 * systems;
}

export function estimateOperationUtility(context: NpcUtilityContext, kind: 'expedition' | 'recon' | 'pve', hasOwnRecon = false): number {
  const traits = context.profile.traits;
  const interest = unit(traits.operationsInterest);
  if (kind === 'pve') return -0.3 + 0.6 * interest + 0.3 * (unit(traits.riskTolerance) - 0.5) + (hasOwnRecon ? 0.2 : -0.2);
  if (kind === 'recon') return -0.2 + 0.5 * interest;
  return -0.15 + 0.6 * interest;
}
