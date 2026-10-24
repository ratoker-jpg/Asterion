import { getFactionDefenseCatalog, getFactionShipCatalog } from '../domain/combat/faction-catalog.ts';
import type { CombatFactionId } from '../domain/combat/factions.ts';
import type { ShipId } from '../domain/combat/ids.ts';
import type { BuildingRole } from '../domain/buildings/resource-zone.ts';
import { getStorageCapacities } from '../domain/buildings/balance-v1.ts';
import type { SpyReportSnapshot, SpyTargetState } from '../domain/espionage/types.ts';
import type { NpcProfile } from '../domain/npc/types.ts';
import { estimateForcePower, estimateWinProbability, planningHorizonHours, type ForceStack } from '../domain/npc/utility.ts';
import { estimateNpcBuildingIncomeGain, getNpcPlanetIncomePerHour } from './npc-economy.ts';
import type { SaveState } from './contracts.ts';
import { ownerBattleReports, ownerFlights, ownerSpyReports } from './npc-knowledge-index.ts';
import { selectOwnerScore } from '../domain/rating/scoring.ts';
import { nextColonyPointThreshold } from '../domain/universe/runtime.ts';

/**
 * Owner-scoped utility estimates for NPC candidate actions. Every input is
 * something this owner could know as a player: its own planets, income and
 * fleet, its own spy reports and the battles it fought. Nothing here reads a
 * foreign planet's live state.
 */

const HOUR = 3_600_000;
type Resources = Readonly<{ metal?: number; minerals?: number; gas?: number; energy?: number }>;
type Catalog = ReadonlyArray<{ id: string; cost?: Resources; combat?: { attack: number; life: number }; category?: string }>;
type StoreKey = 'metal' | 'minerals' | 'gas';
const STORE_KEYS: readonly StoreKey[] = ['metal', 'minerals', 'gas'];

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

/**
 * The owner's strategic reading (concept §5 "цели"): how much each line of
 * play is worth now, from its character and its own observations, 0..1 each.
 * Character sets the baseline; threats, spied weak targets, full stores and
 * room for colonies move it, so one owner plays differently as things change.
 */
export type NpcStrategyDrives = Readonly<{
  economy: number;
  science: number;
  military: number;
  war: number;
  expansion: number;
  operations: number;
  diplomacy: number;
}>;
export type NpcStrategy = keyof NpcStrategyDrives;

/** Action family each strategy pushes; strategic goals are stored as these kinds. */
export const NPC_STRATEGY_FAMILY: Readonly<Record<NpcStrategy, string>> = {
  economy: 'economy', science: 'science', military: 'production', war: 'attack',
  expansion: 'colonize', operations: 'pve', diplomacy: 'diplomacy',
};

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
  /** Orbital debris the owner saw in its own spy reports (target planet id → amount). */
  knownDebris?: ReadonlyMap<string, number>;
  /** The owner's current strategic reading; derived from the rest when absent. */
  strategy?: NpcStrategyDrives;
  /** The owner's points already open its next colony (owner rule thresholds). */
  colonyOpen?: boolean;
}>;

/**
 * What one planet's own state says right now: how full its stores are and
 * whether energy or fleet room holds it back. All of it is the owner's data.
 */
export type NpcPlanetSituation = Readonly<{
  /** 0..1 fill of each store. */
  fill: Readonly<Record<StoreKey, number>>;
  /** 0 when nothing waits for energy, up to 1.5 when building has stalled on it. */
  energyNeed: number;
  /** Fleet orders refused for lack of population room. */
  populationBlocked: boolean;
}>;

export function createNpcUtilityContext(state: SaveState, profile: NpcProfile, at: number, timeScale: number): NpcUtilityContext {
  const ownerId = profile.ownerId;
  const ownPlanets = Object.values(state.espionage?.targets ?? {}).filter((target) => target.kind === 'npc' && target.ownerId === ownerId);
  const income = ownPlanets.reduce((sum, target) => sum + getNpcPlanetIncomePerHour(target, timeScale), 0);
  let defended = 0;
  for (const report of ownerBattleReports(state.combat.reports, ownerId)) {
    if (report.defender.playerId !== ownerId) continue;
    const when = Date.parse(report.timestamp);
    if (Number.isFinite(when) && when <= at && at - when <= 48 * HOUR) defended += 1;
  }
  const latestReports = new Map<string, SpyReportSnapshot>();
  for (const report of ownerSpyReports(state.espionage?.reports ?? [], state.espionage?.missions ?? [], ownerId)) {
    if (report.ownerId !== ownerId || report.createdAt > at) continue;
    const previous = latestReports.get(report.targetPlanetId);
    if (!previous || previous.createdAt <= report.createdAt) latestReports.set(report.targetPlanetId, report);
  }
  const knownDebris = new Map<string, number>();
  for (const report of latestReports.values()) {
    const debris = report.resources?.debris ?? 0;
    if (debris > 0) knownDebris.set(report.targetPlanetId, debris);
  }
  const flyingColonizers = ownerFlights(state.flights.records, ownerId).filter((flight) => flight.missionId === 'colonize'
    && (flight.phase === 'outbound' || flight.phase === 'arrived')).length;
  const threshold = nextColonyPointThreshold(ownPlanets.length + flyingColonizers);
  const base = {
    profile, at, timeScale,
    colonyOpen: threshold !== null && (selectOwnerScore(state, ownerId)?.totalPoints ?? 0) >= threshold,
    dayValue: Math.max(2_000, income * 24),
    ownPlanets,
    threat: Math.min(1, defended / 3),
    latestReports,
    knownDebris,
  };
  return { ...base, strategy: assessNpcStrategy(base) };
}

function storeFill(planet: SpyTargetState): Record<StoreKey, number> {
  const capacity = getStorageCapacities(planet.buildings);
  const fill = (key: StoreKey) => {
    const cap = capacity[key] ?? 0;
    return cap > 0 ? unit((planet.resources[key] ?? 0) / cap) : 0;
  };
  return { metal: fill('metal'), minerals: fill('minerals'), gas: fill('gas') };
}

function ownFleetPower(planets: readonly SpyTargetState[]): number {
  return planets.reduce((sum, planet) => sum
    + estimateForcePower(stacks(getFactionShipCatalog(planet.raceId) as Catalog, planet.fleet?.ships as Readonly<Partial<Record<string, number>>> | undefined)), 0);
}

export function assessNpcStrategy(context: Omit<NpcUtilityContext, 'strategy'>): NpcStrategyDrives {
  const t = context.profile.traits;
  // Best war opportunity this owner has actually spied: its belief of winning
  // times the loot, in days of its own income.
  const ownPower = ownFleetPower(context.ownPlanets);
  let opportunity = 0;
  for (const report of context.latestReports.values()) {
    if (report.targetOwnerId === context.profile.ownerId) continue;
    const race = report.targetRaceId as CombatFactionId;
    const enemy = report.fleet === undefined && report.defense === undefined ? ownPower * 1.3 : estimateForcePower([
      ...stacks(getFactionShipCatalog(race) as Catalog, report.fleet),
      ...stacks(getFactionDefenseCatalog(race) as Catalog, report.defense),
    ]);
    opportunity = Math.max(opportunity, unit(estimateWinProbability(ownPower, enemy) * 0.5 * costValue(report.resources) / context.dayValue));
  }
  const fullest = context.ownPlanets.reduce((max, planet) => Math.max(max, ...Object.values(storeFill(planet))), 0);
  const roomForColonies = context.ownPlanets.length < 7;
  return {
    economy: unit(0.3 + 0.45 * unit(t.economyFocus) + 0.15 * (1 - context.threat) - 0.2 * unit((fullest - 0.7) / 0.3)),
    science: unit(0.15 + 0.55 * unit(t.scienceFocus) * (0.5 + 0.5 * unit(t.planningHorizon))),
    military: unit(0.1 + 0.4 * unit(t.militaryFocus) + 0.5 * context.threat + 0.2 * unit(t.aggression) + 0.15 * opportunity),
    war: unit(0.05 + 0.45 * unit(t.aggression) * (0.6 + 0.4 * unit(t.riskTolerance)) + 0.45 * opportunity - 0.3 * context.threat),
    expansion: roomForColonies && context.colonyOpen !== false ? unit(0.1 + 0.6 * unit(t.expansionFocus) + 0.1 * unit(t.planningHorizon)) : 0,
    operations: unit(0.05 + 0.55 * unit(t.operationsInterest) + (context.knownDebris?.size ? 0.15 : 0)),
    diplomacy: unit(0.05 + 0.5 * unit(t.cooperation) * (0.4 + 0.6 * unit(t.socialStyle)) + 0.2 * context.threat * unit(t.cooperation)),
  };
}

export function strategyOf(context: NpcUtilityContext): NpcStrategyDrives {
  return context.strategy ?? assessNpcStrategy(context);
}

/**
 * The strategy an owner commits to when it reconsiders: the strongest drive,
 * misjudged by the same seeded error as every other estimate.
 */
export function chooseNpcStrategy(drives: NpcStrategyDrives, error: (strategy: NpcStrategy) => number): NpcStrategy {
  let best: NpcStrategy = 'economy';
  let bestValue = Number.NEGATIVE_INFINITY;
  for (const strategy of Object.keys(NPC_STRATEGY_FAMILY) as NpcStrategy[]) {
    const value = drives[strategy] + error(strategy);
    if (value > bestValue) { best = strategy; bestValue = value; }
  }
  return best;
}

/** Store fill for one planet; energy and fleet room come from the caller's candidate scan. */
export function describeNpcPlanet(planet: SpyTargetState, energyBlocked: number, typicalEnergyCost: number,
  populationBlocked: boolean): NpcPlanetSituation {
  const available = Math.max(0, planet.resources.developmentEnergy ?? 0);
  const short = typicalEnergyCost > 0 && available < 2 * typicalEnergyCost ? 0.5 : 0;
  return {
    fill: storeFill(planet),
    energyNeed: Math.min(1.5, (energyBlocked > 0 ? Math.min(1, 0.4 + 0.2 * energyBlocked) : 0) + short),
    populationBlocked,
  };
}

/**
 * Opportunity cost of a price: resources piling against a full store are
 * nearly free to spend (they would be lost), the last ones are dear.
 */
export function effectiveSpend(cost: Resources | null | undefined, situation?: NpcPlanetSituation): number {
  if (!cost) return 0;
  const scarcity = (key: StoreKey) => situation ? Math.max(0.05, 1 - situation.fill[key]) : 1;
  return STORE_KEYS.reduce((sum, key) => sum + Math.max(0, cost[key] ?? 0) * scarcity(key), 0);
}

/** 0..1: how hard full stores push this planet to spend on anything. */
export function spendingPressure(situation?: NpcPlanetSituation): number {
  if (!situation) return 0;
  return unit((Math.max(situation.fill.metal, situation.fill.minerals, situation.fill.gas) - 0.6) / 0.4);
}

/** Price penalty on a bounded log scale: an hour of income is cheap, a day of it is not. */
function pricePenalty(context: NpcUtilityContext, cost: Resources | null | undefined, situation?: NpcPlanetSituation): number {
  const hourly = context.dayValue / 24;
  return 0.35 * Math.log1p(effectiveSpend(cost, situation) / (hourly * 6));
}

/** Benefit over spend on a log scale, bounded like every other estimate. */
function returnOnSpend(benefit: number, spend: number): number {
  return Math.max(-3, Math.min(2.5, Math.log((Math.max(0, benefit) + 1) / (Math.max(0, spend) + 1))));
}

/** Share of a planet's development energy one order would use (energy is a one-time stock). */
function energyShare(target: SpyTargetState, cost: Resources | null | undefined): number {
  const energy = Math.max(0, cost?.energy ?? 0);
  if (energy <= 0) return 0;
  return unit(energy / Math.max(1, target.resources.developmentEnergy ?? 0));
}

const INCOME_ROLES = new Set<string>(['metal-production-1', 'metal-production-2', 'metal-production-3',
  'mineral-production-1', 'mineral-production-2', 'gas-production-1', 'gas-production-2']);
const STORAGE_ROLES: Readonly<Record<string, StoreKey>> = {
  'metal-storage': 'metal', 'mineral-storage': 'minerals', 'gas-storage': 'gas',
};
const ENERGY_ROLES = new Set<string>(['basic-energy', 'advanced-energy']);

/**
 * A building is worth what it returns or unlocks. Mines: income over the
 * owner's planning horizon against the price at its opportunity cost.
 * Stores: only when filling. Energy: when building waits for it. Enablers
 * (shipyard, research, government, hangar...): what the owner's strategy
 * wants from the things they open.
 */
export function estimateBuildingUtility(context: NpcUtilityContext, target: SpyTargetState, role: BuildingRole,
  nextLevel: number, cost: Resources | null, capacity?: Readonly<Partial<Record<string, number>>>,
  situation?: NpcPlanetSituation): number {
  const traits = context.profile.traits;
  const drives = strategyOf(context);
  const firstLevel = nextLevel <= 1;
  const energyCost = 1.2 * energyShare(target, cost) * (ENERGY_ROLES.has(role) ? 0 : 1);
  if (INCOME_ROLES.has(role)) {
    const gain = estimateNpcBuildingIncomeGain(target, role, nextLevel, context.timeScale);
    return returnOnSpend(gain * planningHorizonHours(context.profile), effectiveSpend(cost, situation))
      - energyCost + 0.3 * (drives.economy - 0.5);
  }
  const resource = STORAGE_ROLES[role];
  if (resource) {
    const cap = capacity?.[resource] ?? 0;
    const fill = situation?.fill[resource] ?? (cap > 0 ? unit((target.resources[resource] ?? 0) / cap) : 0);
    return (fill >= 0.8 ? 0.8 + 3 * (fill - 0.8) : -0.6 + 0.5 * fill) - pricePenalty(context, cost, situation) * 0.5 - energyCost;
  }
  if (ENERGY_ROLES.has(role)) {
    const need = situation?.energyNeed ?? 0;
    return -0.5 + 1.6 * need - pricePenalty(context, cost, situation);
  }
  const enabler = (() => {
    switch (role) {
      case 'shipyard': return firstLevel ? -0.3 + 1.6 * Math.max(drives.military, drives.war) : -0.6 + 1.1 * drives.military;
      case 'hangar': return situation?.populationBlocked ? 0.3 + 0.6 * drives.military : -1 + 0.4 * drives.military;
      case 'construction': return -0.3 + 0.6 * drives.economy + (firstLevel ? 0.9 * drives.science : 0.2 * drives.science);
      case 'research': return firstLevel ? -0.3 + 1.5 * drives.science : -0.5 + 0.9 * drives.science;
      case 'planetary-government': return firstLevel ? -0.4 + 1.4 * drives.diplomacy : -0.8 + 0.6 * drives.diplomacy;
      case 'spaceport': return -0.5 + 0.5 * Math.max(drives.war, drives.expansion, drives.operations);
      default: return -0.3 + 0.3 * (unit(traits.economyFocus) + unit(traits.militaryFocus)) / 2;
    }
  })();
  return enabler - pricePenalty(context, cost, situation) - energyCost + 0.3 * spendingPressure(situation);
}

export function estimateScienceUtility(context: NpcUtilityContext, cost: Resources | null, situation?: NpcPlanetSituation): number {
  const drives = strategyOf(context);
  return -0.4 + 1.4 * drives.science + 0.2 * unit(context.profile.traits.planningHorizon)
    - pricePenalty(context, cost, situation) + 0.3 * spendingPressure(situation);
}

/** Ships and defence are worth more after being attacked and to military owners. */
export function estimateProductionUtility(context: NpcUtilityContext, queueKind: string, cost: Resources | null,
  situation?: NpcPlanetSituation): number {
  const drives = strategyOf(context);
  const military = unit(context.profile.traits.militaryFocus);
  const need = queueKind === 'defense' ? 0.25 + 1.2 * context.threat : 0.35 + 0.5 * context.threat + 0.6 * drives.war;
  return need + 0.4 * military - 0.35 - pricePenalty(context, cost, situation) * 0.5 + 0.4 * spendingPressure(situation);
}

/** What one catalog entry is for, as a player reads its card. */
export type NpcProductionPurpose = 'combat' | 'defense' | 'energy' | 'spy' | 'colony' | 'recycler' | 'cargo' | 'commander';

export function npcProductionPurpose(queueKind: string, itemId: string, category?: string): NpcProductionPurpose {
  if (queueKind === 'defense') return 'defense';
  if (queueKind === 'commanders') return 'commander';
  if (itemId === 'solar-satellite') return 'energy';
  if (itemId === 'spy-probe') return 'spy';
  if (itemId === 'colonizer') return 'colony';
  if (itemId === 'recycler') return 'recycler';
  if (category === 'Боевой корабль') return 'combat';
  return 'cargo';
}

/** Combat value per resource spent: Lanchester strength of one unit over its price. */
export function combatEfficiency(entity: { cost?: Resources; combat?: { attack: number; life: number } } | undefined): number {
  if (!entity?.combat) return 0;
  return Math.sqrt(Math.max(0, entity.combat.attack) * Math.max(0, entity.combat.life)) / Math.max(1, costValue(entity.cost));
}

/**
 * One production order judged by purpose. Combat ships and turrets are
 * compared by strength per price against the best option this planet has;
 * single-purpose hulls are wanted only while their job exists and none is
 * at hand (a probe to spy, a colonizer for a free slot, a recycler for known
 * debris, satellites while energy holds building back).
 */
export function estimateProductionItemUtility(context: NpcUtilityContext, target: SpyTargetState, queueKind: string,
  itemId: string, cost: Resources | null, situation: NpcPlanetSituation | undefined,
  relativeEfficiency: number): number {
  const drives = strategyOf(context);
  const fleet = (target.fleet?.ships ?? {}) as Readonly<Partial<Record<string, number>>>;
  const owned = (id: string) => context.ownPlanets.reduce((sum, planet) =>
    sum + Math.max(0, ((planet.fleet?.ships ?? {}) as Readonly<Partial<Record<string, number>>>)[id] ?? 0), 0);
  const entity = queueKind === 'ships' ? (getFactionShipCatalog(target.raceId) as Catalog).find((item) => item.id === itemId) : undefined;
  const purpose = npcProductionPurpose(queueKind, itemId, entity?.category);
  const price = pricePenalty(context, cost, situation) * 0.5;
  const push = 0.4 * spendingPressure(situation);
  const efficiency = 0.5 * Math.log(Math.max(0.05, Math.min(1, relativeEfficiency)));
  switch (purpose) {
    case 'combat': return -0.5 + 1.5 * Math.max(drives.military, drives.war) + 0.5 * context.threat + efficiency - price + push;
    case 'defense': return -0.8 + 1.4 * context.threat + 0.5 * drives.military + efficiency - price + push * 0.75;
    case 'energy': return -0.6 + 1.5 * (situation?.energyNeed ?? 0) - price;
    case 'spy': return (fleet[itemId] ?? 0) >= 2 ? -2 : -0.3 + 0.9 * Math.max(drives.war, drives.operations, drives.military * 0.6) - price;
    case 'colony': return owned(itemId) > 0 || drives.expansion <= 0 || context.colonyOpen === false ? -2.5 : -0.4 + 1.6 * drives.expansion - price;
    case 'recycler': return owned(itemId) > 0 || !context.knownDebris?.size ? -2 : -0.2 + 1.2 * drives.operations - price;
    case 'commander': return -0.9 + 0.8 * drives.military - price;
    default: return -1.2 + 0.4 * unit(context.profile.traits.cooperation) - price;
  }
}

/**
 * How many units one order asks for: a share of what the planet can pay,
 * larger for owners whose strategy is military. Single-purpose hulls are
 * ordered one at a time; satellites cover the energy shortfall.
 */
export function npcProductionBatch(context: NpcUtilityContext, target: SpyTargetState, purpose: NpcProductionPurpose,
  cost: Resources | null, situation?: NpcPlanetSituation): number {
  if (!cost) return 1;
  if (purpose === 'spy' || purpose === 'colony' || purpose === 'recycler' || purpose === 'commander') return 1;
  const drives = strategyOf(context);
  const share = purpose === 'energy' ? 0.35 : 0.25 + 0.45 * Math.max(drives.military, drives.war) + 0.25 * spendingPressure(situation);
  let affordable = Number.POSITIVE_INFINITY;
  for (const key of STORE_KEYS) {
    const price = Math.max(0, cost[key] ?? 0);
    if (price > 0) affordable = Math.min(affordable, Math.floor((target.resources[key] ?? 0) * Math.min(0.9, share) / price));
  }
  if (!Number.isFinite(affordable)) return 1;
  const cap = purpose === 'energy' ? 20 : 500;
  return Math.max(1, Math.min(cap, affordable));
}

/**
 * War: own force against what the owner's latest spy report showed, inflated
 * by its age; unknown forces are feared rather than ignored.
 */
export function estimateAttackUtility(context: NpcUtilityContext, origin: SpyTargetState, targetPlanetId: string,
  selectedShips: Readonly<Partial<Record<ShipId, number>>>, remoteness = 0): number {
  const traits = context.profile.traits;
  const ownCatalog = getFactionShipCatalog(origin.raceId) as Catalog;
  const ownPower = estimateForcePower(stacks(ownCatalog, selectedShips));
  const risked = fleetCost(ownCatalog, selectedShips);
  const report = context.latestReports.get(targetPlanetId);
  if (!report) return -1.2 + 0.6 * (unit(traits.aggression) - 0.5);
  const enemyPower = estimateReportedPower(context, report, ownPower);
  const win = estimateWinProbability(ownPower, enemyPower);
  const loot = 0.5 * costValue(report.resources);
  const expectedLoss = (1 - win) * risked * 0.85 + win * risked * 0.1;
  const risk = (1 - unit(traits.riskTolerance)) * win * (1 - win) * risked;
  return (win * loot - expectedLoss - risk) / context.dayValue + 0.5 * (unit(traits.aggression) - 0.5)
    + 0.4 * (strategyOf(context).war - 0.3) - 0.5 * remoteness;
}

/** Defender strength the owner believes in: the report, inflated by its age; unknown is feared. */
export function estimateReportedPower(context: NpcUtilityContext, report: SpyReportSnapshot, ownPower: number): number {
  const race = report.targetRaceId as CombatFactionId;
  const known = report.fleet !== undefined || report.defense !== undefined;
  const ageHours = Math.max(0, (context.at - report.createdAt) / HOUR);
  const reportedPower = estimateForcePower([
    ...stacks(getFactionShipCatalog(race) as Catalog, report.fleet),
    ...stacks(getFactionDefenseCatalog(race) as Catalog, report.defense),
  ]);
  return (known ? reportedPower : ownPower * 1.3) * (1 + Math.min(1, ageHours / 72));
}

/**
 * The attack force a player would send: the cheapest prefix of its combat
 * ships (strongest per price first) that the owner believes wins with its
 * required margin; risk-averse owners want a larger margin. Returns null
 * when even everything available is not expected to win.
 */
export function chooseNpcAttackForce(context: NpcUtilityContext, origin: SpyTargetState, targetPlanetId: string,
  available: Readonly<Partial<Record<string, number>>>): Record<string, number> | null {
  const report = context.latestReports.get(targetPlanetId);
  if (!report) return null;
  const catalog = (getFactionShipCatalog(origin.raceId) as Catalog)
    .filter((entity) => entity.category === 'Боевой корабль' && (available[entity.id] ?? 0) > 0)
    .sort((left, right) => combatEfficiency(right) - combatEfficiency(left) || (left.id < right.id ? -1 : 1));
  if (!catalog.length) return null;
  const all: Record<string, number> = Object.fromEntries(catalog.map((entity) => [entity.id, Math.max(0, Math.floor(available[entity.id] ?? 0))]));
  const enemy = estimateReportedPower(context, report, estimateForcePower(stacks(catalog, all)));
  const wanted = 0.6 + 0.3 * (1 - unit(context.profile.traits.riskTolerance));
  if (estimateWinProbability(estimateForcePower(stacks(catalog, all)), enemy) < wanted) return null;
  // Smallest share of the available force (in tenths) that still meets the margin.
  for (let tenths = 1; tenths <= 10; tenths += 1) {
    const force: Record<string, number> = {};
    for (const entity of catalog) {
      const count = Math.ceil(all[entity.id]! * tenths / 10);
      if (count > 0) force[entity.id] = count;
    }
    if (estimateWinProbability(estimateForcePower(stacks(catalog, force)), enemy) >= wanted) return force;
  }
  return all;
}

/**
 * 0 next door, about 1 across a galaxy, more for other galaxies: a far target
 * is legal, only slower and dearer to reach, and news of it ages on the way.
 */
export function flightRemoteness(from: Readonly<{ galaxy: number; system: number }>, to: Readonly<{ galaxy: number; system: number }>): number {
  return from.galaxy === to.galaxy ? Math.abs(from.system - to.system) / 40 : 1 + Math.abs(from.galaxy - to.galaxy) / 10;
}

/** Intelligence is worth more when the owner has none or it has gone stale. */
export function estimateEspionageUtility(context: NpcUtilityContext, targetPlanetId: string, remoteness = 0): number {
  const traits = context.profile.traits;
  const report = context.latestReports.get(targetPlanetId);
  const staleness = report ? Math.min(1, (context.at - report.createdAt) / (48 * HOUR)) : 1;
  return -0.25 + 0.6 * staleness * (unit(traits.aggression) + unit(traits.militaryFocus)) / 2
    + 0.4 * staleness * (strategyOf(context).war - 0.3) - 0.6 * remoteness;
}

/** Closer free slots are cheaper to reach and defend. */
export function estimateColonizeUtility(context: NpcUtilityContext, origin: SpyTargetState,
  coordinate: Readonly<{ galaxy: number; system: number }>): number {
  const traits = context.profile.traits;
  const systems = coordinate.galaxy === origin.coordinate.galaxy ? Math.abs(coordinate.system - origin.coordinate.system) : 40;
  return -0.1 + 0.8 * unit(traits.expansionFocus) - 0.12 * systems + 0.5 * (strategyOf(context).expansion - 0.3);
}

export function estimateOperationUtility(context: NpcUtilityContext, kind: 'expedition' | 'recon' | 'pve' | 'recycle', hasOwnRecon = false): number {
  const traits = context.profile.traits;
  const interest = unit(traits.operationsInterest);
  const drive = 0.4 * (strategyOf(context).operations - 0.3);
  if (kind === 'pve') return -0.3 + 0.6 * interest + 0.3 * (unit(traits.riskTolerance) - 0.5) + (hasOwnRecon ? 0.2 : -0.2) + drive;
  if (kind === 'recon') return -0.2 + 0.5 * interest + drive;
  if (kind === 'recycle') return 0.2 + 0.4 * interest + drive;
  return -0.15 + 0.6 * interest + drive;
}

/**
 * Fleet saving with «Космический рейс» (owner tip, 24.10.2026): ships away on
 * a space flight cannot be caught on the planet. Two habits of experienced
 * players: send the fleet off when leaving the game, timed to come back at
 * the next visit, and dodge an attack seen on its way. Owners who know the
 * mechanics and fear losses do it more; worth it only for a real fleet.
 */
export function estimateFleetSaveUtility(context: NpcUtilityContext, fleetValue: number, reason: 'leaving' | 'dodge'): number {
  const traits = context.profile.traits;
  const worth = Math.log1p(fleetValue / Math.max(1, context.dayValue));
  const knows = unit(traits.mechanicsKnowledge);
  const careful = 1 - unit(traits.riskTolerance);
  return reason === 'dodge'
    ? -0.4 + 1.0 * careful + 0.9 * knows + 0.4 * worth
    : -0.9 + 1.3 * knows * (0.5 + 0.5 * careful) + 0.3 * worth + 0.5 * context.threat;
}

/** Fleet value that a fleet save protects: resources spent on the ships. */
export function npcFleetValue(raceId: CombatFactionId, ships: Readonly<Partial<Record<string, number>>>): number {
  return fleetCost(getFactionShipCatalog(raceId) as Catalog, ships);
}

/** One leg of a space flight that keeps the fleet away until `returnAfter`, in whole minutes, or null if out of range. */
export function spaceFlightLegFor(at: number, returnAfter: number, minLeg: number, maxLeg: number): number | null {
  const minute = 60_000;
  const leg = Math.ceil(Math.max(minLeg, (returnAfter - at) / 2) / minute) * minute;
  return leg <= maxLeg ? leg : null;
}
