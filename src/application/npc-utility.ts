import { getFactionDefenseCatalog, getFactionShipCatalog } from '../domain/combat/faction-catalog.ts';
import { COMMANDER_COMBAT_CATALOG } from '../domain/combat/catalog.ts';
import type { CombatFactionId } from '../domain/combat/factions.ts';
import type { ShipId } from '../domain/combat/ids.ts';
import type { BuildingRole } from '../domain/buildings/resource-zone.ts';
import { getStorageCapacities } from '../domain/buildings/balance-v1.ts';
import type { SpyReportSnapshot, SpyTargetState } from '../domain/espionage/types.ts';
import type { NpcProfile } from '../domain/npc/types.ts';
import { doctrineDefenceIndex, getNpcPolicy } from '../domain/npc/policy.ts';
import { estimateForcePower, estimateWinProbability, planningHorizonHours, type ForceStack } from '../domain/npc/utility.ts';
import { estimateNpcBuildingIncomeGain, getNpcPlanetIncomePerHour } from './npc-economy.ts';
import type { SaveState } from './contracts.ts';
import { battleReportTime, reportRetentionCutoff } from './history-retention.ts';
import { ownerBattleReports, ownerFlights, ownerSpyReports, publicDebrisEntries } from './npc-knowledge-index.ts';
import { selectOwnerScore } from '../domain/rating/scoring.ts';
import { nextColonyPointThreshold } from '../domain/universe/runtime.ts';
import { findDebrisNearSystem } from '../domain/espionage/orbital-debris.ts';
import { calculateRouteDistance } from '../domain/flights/distance.ts';
import { calculateFlightFuel } from '../domain/flights/fuel.ts';
import { selectOwnerMembership } from '../domain/command/selectors.ts';
import { calculateDefensePopulation, getFleetProductionEntity } from '../domain/fleet/production.ts';
import { evaluateProductionRequirements } from '../domain/fleet/requirements.ts';
import { findScience } from '../domain/science/catalog.ts';
import type { ScienceId } from '../domain/science/types.ts';
import { npcFlagshipOwners } from '../domain/npc/doctrine.ts';
import { npcGrudgeIntensity } from '../domain/npc/grudges.ts';
import { NPC_COMMANDER_BALANCE, npcMainCommander } from './npc-commanders.ts';
import { npcActivePartners, npcReactionOf } from './npc-pact-state.ts';
import { npcRelationViews } from './npc-relations.ts';
import type { NpcRelationView } from '../domain/npc/relations.ts';
import type { CommanderId } from '../domain/combat/commanders.ts';
import type { NpcFortifyPlan } from '../domain/npc/strategy.ts';

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
  /** Planets (by "galaxy:system:position") where this owner lost an attack, and when: what it spied there before is wrong. */
  attackLossAt?: ReadonlyMap<string, number>;
  /** Orbital debris the owner saw in its own spy reports (target planet id → amount). */
  knownDebris?: ReadonlyMap<string, number>;
  /** The owner's current strategic reading; derived from the rest when absent. */
  strategy?: NpcStrategyDrives;
  /** The owner's points already open its next colony (owner rule thresholds). */
  colonyOpen?: boolean;
  /** Debris on the public map around the owner's planets (the player's «Найти обломки»). */
  nearbyDebris?: number;
  /** Debris all of the owner's recyclers carry in one trip, at home and in flight. */
  recyclerCapacity?: number;
  /** A planet short of gas has an asteroid within reach: recyclers can mine it. */
  gasAsteroidNearby?: boolean;
  /** Planets where someone else's Gate is being built: the whole world is told, and breaking it is worth more than any haul. */
  rivalGateHosts?: ReadonlySet<string>;
  /** This owner's planets hosting its own side's Gate: held at all costs. */
  ownGateHosts?: ReadonlySet<string>;
  /** Present for the planet-destroyer rush doctrine: what still stands between the owner and its strongest hull. */
  flagship?: NpcFlagshipPlan;
  /** What the owner thinks of others it has an opinion on (absent: a stranger everywhere). */
  relations?: ReadonlyMap<string, NpcRelationView>;
  /** Owners it stands in a joint strike with. */
  partners?: ReadonlySet<string>;
  /** Decided to hit back after being robbed: the one it blames. */
  counterOffender?: string;
  /** The owner's `fortify-empire` plan, and the sciences still between it and its best battery. */
  fortify?: Readonly<{ targets: Readonly<Record<string, number>>; ambition: number; sciences: ReadonlySet<ScienceId> }>;
}>;

export type NpcBatteryStats = Readonly<{ id: string; population: number; cost: number; strength: number; score: number; seconds: number; requiredShipyard: number }>;

const batteryRanks = new Map<string, readonly NpcBatteryStats[]>();

/**
 * This race's turrets, best first. The hangar caps defence by population, so a
 * turret is first worth what it holds per population, then what it costs:
 * strength per population × √(strength per resource). Single-copy shields apart.
 */
export function npcBatteryStats(raceId: CombatFactionId): readonly NpcBatteryStats[] {
  const weight = getNpcPolicy().params.tableWeight;
  const rankKey = `${raceId}:${weight}`;
  const known = batteryRanks.get(rankKey);
  if (known) return known;
  const rows = getFactionDefenseCatalog(raceId).filter((entity) => entity.id !== 'tower-shield' && entity.id !== 'planetary-shield' && entity.combat && entity.population > 0)
    .map((entity) => {
      const strength = Math.sqrt(entity.combat!.attack * entity.combat!.life);
      const cost = Math.max(1, costValue(entity.cost));
      const [hours = 0, minutes = 0, seconds = 0] = entity.construction.time.split(':').map(Number);
      return { id: entity.id, population: entity.population, cost, strength, score: strength / entity.population * Math.sqrt(strength / cost) * (1 - weight + weight * doctrineDefenceIndex(raceId, entity.id)),
        seconds: hours * 3_600 + minutes * 60 + seconds, requiredShipyard: entity.construction.requiredShipyardLevel };
    }).sort((left, right) => right.score - left.score || (left.id < right.id ? -1 : 1));
  batteryRanks.set(rankKey, rows);
  return rows;
}

/** The owner's active `fortify-empire` plan. */
export function activeNpcFortifyPlan(state: SaveState, ownerId: string): NpcFortifyPlan | undefined {
  for (const plan of state.npcStrategy?.plans[ownerId] ?? []) if (plan.template === 'fortify-empire' && plan.status === 'active') return plan;
  return undefined;
}

function missingSciencePath(entity: NonNullable<ReturnType<typeof getFleetProductionEntity>>, scienceLevels: Readonly<Partial<Record<number, number>>>, shipyardLevel: number) {
  const evaluation = evaluateProductionRequirements(entity, { scienceLevels: scienceLevels as never, shipyardLevel, hangarLevel: 0, advancedFactoryLevel: 0 });
  const sciences = new Map<ScienceId, number>();
  let laboratoryLevel = 0;
  const need = (id: ScienceId, level: number) => {
    if ((scienceLevels[id] ?? 0) >= level || (sciences.get(id) ?? 0) >= level) return;
    sciences.set(id, level);
    const science = findScience(id);
    if (!science) return;
    laboratoryLevel = Math.max(laboratoryLevel, science.laboratoryLevel);
    for (const prerequisite of science.prerequisites) need(prerequisite.scienceId, prerequisite.level);
  };
  for (const requirement of evaluation.requirements) {
    if (requirement.kind === 'science' && requirement.scienceId !== undefined && requirement.requiredLevel !== null) need(requirement.scienceId, requirement.requiredLevel);
  }
  return { sciences, laboratoryLevel, met: evaluation.met };
}

/** Sciences still missing for this race's best battery, each with what it needs in turn. */
function npcBatterySciences(raceId: CombatFactionId, scienceLevels: Readonly<Partial<Record<number, number>>>): ReadonlySet<ScienceId> {
  const best = npcBatteryStats(raceId)[0];
  const entity = best ? getFleetProductionEntity('defense', best.id, raceId) : null;
  return new Set(entity ? missingSciencePath(entity, scienceLevels, 0).sciences.keys() : []);
}

/** The path to the faction's strongest hull: shipyard level, laboratory level and every science level on the way. */
export type NpcFlagshipPlan = Readonly<{
  shipyardLevel: number;
  laboratoryLevel: number;
  sciences: ReadonlyMap<ScienceId, number>;
  /** All requirements met: the hull itself can be ordered. */
  unlocked: boolean;
}>;

export const NPC_FLAGSHIP_ID = 'death-star';

/** Requirements of the strongest hull for this owner, with every prerequisite science closed over. */
export function npcFlagshipPlan(raceId: string, scienceLevels: Readonly<Partial<Record<number, number>>>, shipyardLevel: number): NpcFlagshipPlan | undefined {
  const entity = getFleetProductionEntity('ships', NPC_FLAGSHIP_ID, raceId as CombatFactionId);
  if (!entity) return undefined;
  const path = missingSciencePath(entity, scienceLevels, shipyardLevel);
  return { shipyardLevel: entity.construction.requiredShipyardLevel, laboratoryLevel: path.laboratoryLevel, sciences: path.sciences, unlocked: path.met };
}

/** Public Gate announcements as seen by one owner: rival Gates to break and its own side's to hold. */
export function npcGateHosts(state: SaveState, ownerId: string): { rival: Set<string>; own: Set<string> } {
  const rival = new Set<string>();
  const own = new Set<string>();
  const membership = selectOwnerMembership(state.command, ownerId);
  for (const gate of state.sunRaid?.gates ?? []) {
    if (gate.status !== 'building') continue;
    const mine = gate.holder.kind === 'alliance' ? membership?.alliance.id === gate.holder.id : gate.holder.id === ownerId;
    (mine ? own : rival).add(gate.hostPlanetId);
  }
  return { rival, own };
}

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
  const attackLossAt = new Map<string, number>();
  // Reports past the retention window are skipped, whether or not a prune has removed them yet.
  const cutoff = reportRetentionCutoff(at);
  for (const report of ownerBattleReports(state.combat.reports, ownerId)) {
    if (report.attacker.playerId === ownerId && report.winner === 'defender' && report.missionType === 'attack') {
      // A lost attack: what the owner knew of that planet was wrong (what it spied is out of date).
      const lostWhen = battleReportTime(report);
      const key = coordinateLabelKey(report.defender.coordinates);
      if (key && Number.isFinite(lostWhen) && lostWhen <= at && lostWhen >= cutoff && lostWhen > (attackLossAt.get(key) ?? 0)) attackLossAt.set(key, lostWhen);
    }
    if (report.defender.playerId !== ownerId) continue;
    const when = battleReportTime(report);
    if (Number.isFinite(when) && when <= at && when >= cutoff && at - when <= 48 * HOUR) defended += 1;
  }
  const latestReports = new Map<string, SpyReportSnapshot>();
  for (const report of ownerSpyReports(state.espionage?.reports ?? [], state.espionage?.missions ?? [], ownerId)) {
    if (report.ownerId !== ownerId || report.createdAt > at || report.createdAt < cutoff) continue;
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
  const debrisMap = publicDebrisEntries(state.espionage);
  const nearby = new Map<string, number>();
  for (const planet of ownPlanets) {
    for (const entry of findDebrisNearSystem(debrisMap, planet.coordinate)) nearby.set(`${entry.coordinate.galaxy}:${entry.coordinate.system}:${entry.coordinate.position}`, entry.debris);
  }
  let recyclerCapacity = 0;
  for (const planet of ownPlanets) {
    const catalog = getFactionShipCatalog(planet.raceId);
    for (const entity of catalog) {
      if (entity.role.toLocaleLowerCase().includes('переработчик')) recyclerCapacity += (planet.fleet?.ships?.[entity.id as ShipId] ?? 0) * (entity.ship?.cargo ?? 0);
    }
  }
  for (const flight of ownerFlights(state.flights.records, ownerId)) {
    if (flight.missionId === 'recycle' && (flight.phase === 'outbound' || flight.phase === 'returning')) recyclerCapacity += flight.recycleCapacity ?? 0;
  }
  const gates = npcGateHosts(state, ownerId);
  const reaction = npcReactionOf(state, ownerId, at);
  const counterOffender = reaction?.kind === 'counter' ? reaction.offender : undefined;
  const partners = npcActivePartners(state, ownerId);
  const home = ownPlanets.find((planet) => planet.id === `${ownerId}-planet`) ?? ownPlanets[0];
  const flagship = home && npcFlagshipOwners(state.npc).has(ownerId)
    ? npcFlagshipPlan(home.raceId, state.npcScience?.owners[ownerId]?.levels ?? home.ownerProfile?.scienceLevels ?? {},
      Math.max(0, ...ownPlanets.map((planet) => Math.floor(Number(planet.buildings.shipyard ?? 0)))))
    : undefined;
  const fortifyPlan = activeNpcFortifyPlan(state, ownerId);
  const fortify = fortifyPlan && home ? { targets: fortifyPlan.targets, ambition: fortifyPlan.ambition,
    sciences: npcBatterySciences(home.raceId, state.npcScience?.owners[ownerId]?.levels ?? home.ownerProfile?.scienceLevels ?? {}) } : undefined;
  const base = {
    ...(flagship ? { flagship } : {}),
    ...(fortify ? { fortify } : {}),
    profile, at, timeScale,
    relations: npcRelationViews(state, profile, at),
    ...(partners.size ? { partners } : {}),
    ...(counterOffender ? { counterOffender } : {}),
    rivalGateHosts: gates.rival,
    ownGateHosts: gates.own,
    nearbyDebris: [...nearby.values()].reduce((sum, value) => sum + value, 0),
    recyclerCapacity,
    gasAsteroidNearby: (state.asteroidSimulation?.processedThroughAt ?? Number.POSITIVE_INFINITY) <= at
      && ownPlanets.some((planet) => storeFill(planet).gas < 0.45 && (state.asteroidSimulation?.asteroids ?? [])
      .some((asteroid) => asteroid.coordinate.galaxy === planet.coordinate.galaxy && Math.abs(asteroid.coordinate.system - planet.coordinate.system) <= 3)),
    colonyOpen: threshold !== null && (selectOwnerScore(state, ownerId)?.totalPoints ?? 0) >= threshold,
    dayValue: Math.max(2_000, income * 24),
    ownPlanets,
    threat: Math.min(1, defended / 3),
    latestReports,
    ...(attackLossAt.size ? { attackLossAt } : {}),
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
/**
 * The owner's strategy (Nemexia expert, 31.10.2026), as bot balance (the owner
 * may change these): every planet a fortress (plan `fortify-empire`), resources
 * not left lying (spent, or shipped to where they are needed), colonies that fight.
 */
export const NPC_FORTRESS_BALANCE = Object.freeze({
  /**
   * A planet's defence aims at this much population of its best batteries: a
   * full hangar (level 20) holds 25 112, so no planet can hold 25 000 real
   * batteries by unit count, and this is the owner's «~25 000»...
   */
  defenseTarget: 25_000,
  /** ...once the owner earns at least this much a day (an early economy builds mines first). */
  minDayValue: 1_000_000,
  /** Resources on a planet beyond this many days of its share of the owner's income are idle: spend or ship them. */
  get hoardDays() { return getNpcPolicy().params.hoardDays; },
  /** A colony holding more than this many days of its share of the income ships its surplus. */
  colonySendDays: 0.25,
  /** Largest order while resources pile up (otherwise 500). */
  hoardBatchCap: 5_000,
  /** How hard idle stores push the shipyard, factories and construction (utility at full pressure). */
  get bottleneckDrive() { return getNpcPolicy().params.bottleneckDrive; },
  /** How much less a full fortress-minded owner wants a fleet order while its planet has no batteries yet (utility). */
  fleetDelay: 1.2,
  /** Share of a fleet order a full fortress-minded owner gives up while its planets are below target. */
  fleetYield: 0.6,
  /** How far scarcity moves the worth of a mine's output. */
  get scarcityRange(): readonly [number, number] { return [0.2, getNpcPolicy().params.scarcityHigh]; },
});

/** The owner's main planet (its first, home planet), where the fortress stands. */
export function isNpcFortress(context: Pick<NpcUtilityContext, 'profile' | 'ownPlanets'>, target: Pick<SpyTargetState, 'id'>): boolean {
  const home = `${context.profile.ownerId}-planet`;
  return target.id === home || (!context.ownPlanets.some((planet) => planet.id === home) && context.ownPlanets[0]?.id === target.id);
}

/** Days of the owner's income (its share per planet) that lie on this planet. */
export function npcHeldDays(context: Pick<NpcUtilityContext, 'dayValue' | 'ownPlanets'>, target: Pick<SpyTargetState, 'resources'>): number {
  const held = Math.max(0, target.resources.metal) + Math.max(0, target.resources.minerals) + Math.max(0, target.resources.gas);
  return held / Math.max(1, context.dayValue / Math.max(1, context.ownPlanets.length));
}

/**
 * 0..1: how far a planet's stores exceed what the owner should keep idle. Only
 * what can still be spent counts: gas no battery can use without metal and
 * minerals beside it (measured 01.11.2026: 5,2 of 7,9 bn on hand was gas) is no
 * reason to order more of anything.
 */
export function hoardPressure(context: Pick<NpcUtilityContext, 'dayValue' | 'ownPlanets'>, target: Pick<SpyTargetState, 'resources'>): number {
  const { metal, minerals, gas } = target.resources;
  const usable = Math.max(0, metal) + Math.max(0, minerals) + Math.min(Math.max(0, gas), Math.max(0, metal) + Math.max(0, minerals));
  const b = NPC_FORTRESS_BALANCE;
  return unit((npcHeldDays(context, { resources: { ...target.resources, metal: usable, minerals: 0, gas: 0 } }) - b.hoardDays) / (2 * b.hoardDays));
}

const MINE_RESOURCE: Readonly<Record<string, StoreKey>> = {
  'metal-production-1': 'metal', 'metal-production-2': 'metal', 'metal-production-3': 'metal',
  'mineral-production-1': 'minerals', 'mineral-production-2': 'minerals', 'gas-production-1': 'gas', 'gas-production-2': 'gas',
};

/**
 * What one more unit of this resource is worth here: a store far above the
 * others is worth little, the one that holds every order back a lot. The same
 * call a player makes looking at three numbers: no more gas mines while gas lies idle.
 */
export function npcResourceScarcity(target: Pick<SpyTargetState, 'resources'>, key: StoreKey): number {
  const held = (id: StoreKey) => Math.max(0, target.resources[id] ?? 0);
  const mean = (held('metal') + held('minerals') + held('gas')) / 3;
  if (mean < 1) return 1;
  return Math.max(NPC_FORTRESS_BALANCE.scarcityRange[0], Math.min(NPC_FORTRESS_BALANCE.scarcityRange[1], mean / Math.max(1, held(key))));
}

/** 0..1: how much a planet below its fortify target holds a fleet order back: full for a fortress-minded owner, little for a raider. */
function fortifyLack(context: NpcUtilityContext, target: SpyTargetState): number {
  const wanted = context.fortify?.targets[target.id] ?? 0;
  if (wanted <= 0) return 0;
  const have = calculateDefensePopulation(target.defense, target.raceId);
  return context.fortify!.ambition * unit(1 - have / wanted);
}

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
  // Stores lying idle go first into what speeds every queue up (owner strategy 31.10.2026, PR 10 finding).
  const bottleneck = role === 'shipyard' || role === 'advanced-factory' || role === 'construction' ? NPC_FORTRESS_BALANCE.bottleneckDrive * hoardPressure(context, target) : 0;
  const energyCost = 1.2 * energyShare(target, cost) * (ENERGY_ROLES.has(role) ? 0 : 1);
  if (INCOME_ROLES.has(role)) {
    const gain = estimateNpcBuildingIncomeGain(target, role, nextLevel, context.timeScale);
    return returnOnSpend(gain * npcResourceScarcity(target, MINE_RESOURCE[role]!) * planningHorizonHours(context.profile), effectiveSpend(cost, situation))
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
      case 'shipyard': return (firstLevel ? -0.3 + 1.6 * Math.max(drives.military, drives.war) : -0.6 + 1.1 * drives.military)
        + (context.flagship && nextLevel <= context.flagship.shipyardLevel ? flagshipDrive(context) : 0);
      case 'hangar': return situation?.populationBlocked ? 0.3 + 0.6 * drives.military : -1 + 0.4 * drives.military;
      case 'construction': return -0.3 + 0.6 * drives.economy + (firstLevel ? 0.9 * drives.science : 0.2 * drives.science);
      case 'research': return (firstLevel ? -0.3 + 1.5 * drives.science : -0.5 + 0.9 * drives.science)
        + (context.flagship && nextLevel <= context.flagship.laboratoryLevel ? 0.8 * flagshipDrive(context) : 0);
      case 'planetary-government': return firstLevel ? -0.4 + 1.4 * drives.diplomacy : -0.8 + 0.6 * drives.diplomacy;
      case 'spaceport': return -0.5 + 0.5 * Math.max(drives.war, drives.expansion, drives.operations);
      // The recycling centre turns collected debris into the resource the owner lacks.
      case 'recycling': return (target.recycling?.availableDebris ?? 0) > 0
        ? (firstLevel ? 1.2 : -0.2 + 0.6 * drives.operations)
        : (firstLevel ? -0.6 + 0.9 * drives.operations + 0.3 * Math.min(1, (context.nearbyDebris ?? 0) / Math.max(1, context.dayValue)) : -1);
      default: return -0.3 + 0.3 * (unit(traits.economyFocus) + unit(traits.militaryFocus)) / 2;
    }
  })();
  return enabler + bottleneck - pricePenalty(context, cost, situation) - energyCost + 0.3 * spendingPressure(situation);
}

export function estimateScienceUtility(context: NpcUtilityContext, cost: Resources | null, situation?: NpcPlanetSituation,
  scienceId?: ScienceId): number {
  const drives = strategyOf(context);
  const onFlagshipPath = scienceId !== undefined && context.flagship?.sciences.has(scienceId) === true;
  const onBatteryPath = scienceId !== undefined && context.fortify?.sciences.has(scienceId) === true;
  return -0.4 + 1.4 * drives.science + 0.2 * unit(context.profile.traits.planningHorizon)
    - pricePenalty(context, cost, situation) + 0.3 * spendingPressure(situation)
    + (onFlagshipPath ? 1.2 * flagshipDrive(context) : 0)
    + (onBatteryPath ? 0.5 + 0.8 * context.fortify!.ambition : 0);
}

/**
 * How hard a rush owner pushes its path: a skilled one goes straight there,
 * a weak one drifts (owner rule: the smart do it fast, the weak slowly).
 */
function flagshipDrive(context: NpcUtilityContext): number {
  return 0.4 + 0.9 * unit(context.profile.traits.mechanicsKnowledge);
}

/** A Spaceport upgrade: worth it for ships the owner flies in numbers; the rush owner upgrades its flagship first. */
export function estimateSpaceportUpgradeUtility(context: NpcUtilityContext, shipId: string, ownedCount: number,
  cost: Resources | null, situation?: NpcPlanetSituation): number {
  const drives = strategyOf(context);
  const flagship = context.flagship && shipId === NPC_FLAGSHIP_ID ? 2 * flagshipDrive(context) : 0;
  return -1 + 0.9 * Math.max(drives.military, drives.war) + 0.25 * Math.log1p(ownedCount) + flagship
    - pricePenalty(context, cost, situation);
}

/**
 * A commander upgrade in the Spaceport: the main commander's levels are the
 * owner's first investment; the others only from spare money and only up to a
 * share of the main commander's level.
 */
export function estimateCommanderUpgradeUtility(context: NpcUtilityContext, commanderId: CommanderId, level: number,
  mainLevel: number, cost: Resources | null, situation?: NpcPlanetSituation): number {
  const drives = strategyOf(context);
  const price = pricePenalty(context, cost, situation);
  if (commanderId === npcMainCommander(context.profile.traits)) {
    return -0.6 + NPC_COMMANDER_BALANCE.upgradeMain + 0.4 * Math.max(drives.military, drives.war) - price;
  }
  const pressure = spendingPressure(situation);
  if (pressure < NPC_COMMANDER_BALANCE.sparePressure || level >= Math.max(1, NPC_COMMANDER_BALANCE.othersShareOfMain * mainLevel)) return -2.5;
  return -0.6 + 0.8 * pressure + 0.3 * drives.military - price;
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
  // Full stores, or stores far beyond what the owner should keep idle, push spending.
  const hoard = hoardPressure(context, target);
  const push = 0.4 * Math.max(spendingPressure(situation), hoard);
  const efficiency = 0.5 * Math.log(Math.max(0.05, Math.min(1, relativeEfficiency)));
  // The planet hosting this owner's own Gate expects the whole world at its door.
  const threat = context.ownGateHosts?.has(target.id) ? 1 : context.threat;
  // The rush owner wants its strongest hull, not the best price ratio, and
  // saves for it instead of spreading resources over lesser hulls.
  const rush = context.flagship && purpose === 'combat'
    ? itemId === NPC_FLAGSHIP_ID ? 2.5 * flagshipDrive(context) - efficiency : -0.4 * flagshipDrive(context)
    : 0;
  switch (purpose) {
    case 'combat': return -0.5 + 1.5 * Math.max(drives.military, drives.war) + 0.5 * threat + efficiency - price + push + rush - NPC_FORTRESS_BALANCE.fleetDelay * fortifyLack(context, target);
    // A planet under the fortify plan orders only by its plan (its best batteries, not whatever comes up).
    case 'defense': return context.fortify?.targets[target.id] ? -2.5 : -0.8 + 1.4 * threat + 0.5 * drives.military + efficiency - price + push * 0.75;
    case 'energy': return -0.6 + 1.5 * (situation?.energyNeed ?? 0) - price;
    case 'spy': return (fleet[itemId] ?? 0) >= 2 ? -2 : -0.3 + 0.9 * Math.max(drives.war, drives.operations, drives.military * 0.6) - price;
    case 'colony': return owned(itemId) > 0 || drives.expansion <= 0 || context.colonyOpen === false ? -2.5 : -0.4 + 1.6 * drives.expansion - price;
    // Recyclers are wanted while the debris around outgrows what they carry
    // (measured 26.10.2026: one hull at a time left ~2% of the map's debris
    // collectable per trip and fields piled up).
    case 'recycler': {
      const deficit = npcRecyclerDeficit(context);
      return deficit <= 0 || (!(context.nearbyDebris ?? 0) && !context.knownDebris?.size && !context.gasAsteroidNearby) ? -2
        : -0.2 + 1.2 * drives.operations + 0.4 * Math.log1p((context.nearbyDebris ?? 0) / Math.max(1, context.dayValue))
          + 0.5 * Math.min(1, deficit / Math.max(1, npcRecyclerWanted(context))) + 0.8 * hoard - price;
    }
    // The main commander first (owner request 27.10.2026): one of it, then upgrades; others rarely.
    case 'commander': {
      const main = npcMainCommander(context.profile.traits);
      const ownedCommander = (id: string) => context.ownPlanets.reduce((sum, planet) => sum + Math.max(0, planet.fleet?.commanders?.[id as CommanderId] ?? 0), 0);
      if (itemId === main) return ownedCommander(main) > 0 ? -2.5 : -0.4 + NPC_COMMANDER_BALANCE.buildMain + 0.4 * Math.max(drives.military, drives.war) - price;
      return ownedCommander(itemId) > 0 || ownedCommander(main) === 0 ? -2.5 : -1.2 + 0.6 * drives.military + 0.4 * spendingPressure(situation) - price;
    }
    // Holds for logistics: a colony away from the main planet needs a few
    // transporters to ship its surplus home; beyond a couple they are idle.
    // The mega-transporter carries 1 000 cargo for 570 against the transporter's
    // 760 and four times the cargo per population (owner 31.10.2026): it is the
    // hold of choice; a transporter is wanted only as what a mega is built from.
    case 'cargo': {
      const mega = itemId === 'mega-transporter';
      const preference = mega ? 0.4 : itemId === 'transporter' && (fleet[itemId] ?? 0) >= 1 ? -0.5 : 0;
      return (context.ownPlanets.length > 1 || hoard > 0) && (fleet[itemId] ?? 0) < (mega ? 4 : 2)
        ? -0.3 + 0.8 * drives.economy + 0.3 * unit(context.profile.traits.cooperation) + preference - price
        : -1.2 + 0.4 * unit(context.profile.traits.cooperation) + preference - price;
    }
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
  if (purpose === 'spy' || purpose === 'colony' || purpose === 'commander') return 1;
  if (purpose === 'recycler') {
    const cargo = (getFactionShipCatalog(target.raceId) as ReadonlyArray<{ id: string; role: string; ship?: { cargo: number } }>)
      .find((entity) => entity.role.toLocaleLowerCase().includes('переработчик'))?.ship?.cargo ?? 0;
    const wanted = cargo > 0 ? Math.ceil(npcRecyclerDeficit(context) / cargo) : 1;
    // Idle stores buy the whole shortfall at once rather than a few hulls a look.
    const batchCap = hoardPressure(context, target) > 0 ? NPC_RECYCLE_BALANCE.richBatch : NPC_RECYCLE_BALANCE.maxBatch;
    let affordable = Number.POSITIVE_INFINITY;
    for (const key of STORE_KEYS) {
      const price = Math.max(0, cost[key] ?? 0);
      if (price > 0) affordable = Math.min(affordable, Math.floor((target.resources[key] ?? 0) * 0.5 / price));
    }
    return Math.max(1, Math.min(batchCap, wanted, Number.isFinite(affordable) ? affordable : wanted));
  }
  const drives = strategyOf(context);
  const hoard = hoardPressure(context, target);
  // The planet still short of its fortify target leaves part of the metal and minerals to its batteries, as much as its owner wants them.
  const planned = purpose === 'combat' && (context.fortify?.targets[target.id] ?? 0) > 0 ? 1 - NPC_FORTRESS_BALANCE.fleetYield * context.fortify!.ambition : 1;
  const share = purpose === 'energy' ? 0.35 : planned * (0.25 + 0.45 * Math.max(drives.military, drives.war) + 0.25 * Math.max(spendingPressure(situation), hoard));
  let affordable = Number.POSITIVE_INFINITY;
  for (const key of STORE_KEYS) {
    const price = Math.max(0, cost[key] ?? 0);
    if (price > 0) affordable = Math.min(affordable, Math.floor((target.resources[key] ?? 0) * Math.min(0.9, share) / price));
  }
  if (!Number.isFinite(affordable)) return 1;
  // Piled-up stores order big: what lies idle is worth nothing (owner strategy 31.10.2026).
  const cap = purpose === 'energy' ? 20 : hoard > 0 ? NPC_FORTRESS_BALANCE.hoardBatchCap : 500;
  return Math.max(1, Math.min(cap, affordable));
}

/**
 * Recycling balance (measured 26.10.2026; the owner may change these): the
 * owner keeps recyclers able to clear the debris around its planets in this
 * many trips, ordering the shortfall in batches up to `maxBatch`.
 */
export const NPC_RECYCLE_BALANCE = {
  tripsToClear: 4,
  maxBatch: 40,
  richBatch: 400,
  /** Holds kept for asteroid gas while a planet is short of gas and an asteroid is near. */
  gasHolds: 200_000,
} as const;

/** Recycler capacity the owner wants for the debris it sees around its planets. */
export function npcRecyclerWanted(context: NpcUtilityContext): number {
  const known = [...(context.knownDebris?.values() ?? [])].reduce((sum, value) => sum + value, 0);
  return Math.max(Math.max(context.nearbyDebris ?? 0, known) / NPC_RECYCLE_BALANCE.tripsToClear,
    context.gasAsteroidNearby ? NPC_RECYCLE_BALANCE.gasHolds : 0);
}

/** How much recycler capacity is missing; zero or less means enough. */
export function npcRecyclerDeficit(context: NpcUtilityContext): number {
  return npcRecyclerWanted(context) - (context.recyclerCapacity ?? 0);
}

/**
 * War: own force against what the owner's latest spy report showed, inflated
 * by its age; unknown forces are feared rather than ignored.
 */
export function estimateAttackUtility(context: NpcUtilityContext, origin: SpyTargetState, targetPlanetId: string,
  selectedShips: Readonly<Partial<Record<ShipId, number>>>, remoteness = 0): number {
  const traits = context.profile.traits;
  const report = context.latestReports.get(targetPlanetId);
  if (!report) return -1.2 + 0.6 * (unit(traits.aggression) - 0.5);
  const raid = estimateRaidEconomics(context, origin, report, selectedShips);
  // A rival Gate under construction ends the campaign if it stands: breaking
  // it is worth more than any haul, and distance does not matter.
  if (context.rivalGateHosts?.has(targetPlanetId)) return 2.5 + 0.5 * unit(traits.aggression) + Math.min(1, Math.max(0, raid.net) / context.dayValue);
  const revenge = estimateRevengeEconomics(context, origin, report, selectedShips);
  const social = npcAttackRegardBias(context, report.targetOwnerId);
  // Revenge (owner rule 26.10.2026): hurting an offender is worth a loss, and it comes first.
  const revengeValue = revenge.worthFlight && raid.worthFlight
    ? revenge.net / context.dayValue + NPC_REVENGE_BALANCE.priority * revenge.intensity + 0.5 * (unit(traits.aggression) - 0.5) - 0.3 * remoteness + social
    : Number.NEGATIVE_INFINITY;
  // Taste for war never turns a pointless raid (63 resources) into a good one.
  if (!raid.worthFlight) return Number.isFinite(revengeValue) ? revengeValue : -2;
  return Math.max(revengeValue, raid.net / context.dayValue + 0.5 * (unit(traits.aggression) - 0.5)
    + 0.4 * (strategyOf(context).war - 0.3) - 0.5 * remoteness + social);
}

/**
 * What the owner thinks of a target, as utility: a friend is a poor target, a
 * partner a worse one, an enemy of old a better one, and one who has shown it
 * bites weighs on the cautious. Zero for a stranger.
 */
export function npcAttackRegardBias(context: NpcUtilityContext, targetOwnerId: string | undefined): number {
  if (!targetOwnerId) return 0;
  const view = context.relations?.get(targetOwnerId);
  const partner = context.partners?.has(targetOwnerId) ? 1.5 : 0;
  if (!view) return partner ? -partner : 0;
  return -0.9 * Math.max(0, view.regard) + 0.25 * Math.max(0, -view.regard) - 0.4 * view.fear * (1 - unit(context.profile.traits.riskTolerance)) - partner;
}

/**
 * Revenge balance (owner rule 26.10.2026, decision 10; the owner may change these):
 * the memory lasts the whole match and the NPC accepts a noticeable loss to
 * hurt an offender, but only a target the PR 2 attack rule allows.
 */
export const NPC_REVENGE_BALANCE = {
  /** At full grudge one resource of damage dealt is worth this much of the owner's own expected loss. */
  weight: 1.5,
  /** The win belief an attack needs drops by this times the grudge intensity. */
  marginDrop: 0.45,
  /** Below this win belief even revenge does not attack. */
  minWin: 0.1,
  /** Damage worth a revenge flight, as a share of the owner's daily income. */
  minDamageDayShare: 0.05,
  /** Utility bonus of a revenge attack at full grudge: offenders come first. */
  priority: 0.8,
  /** Extra wish to spy on an offender at full grudge. */
  spyBonus: 0.9,
} as const;

/** 0..1 grudge against the owner of a target, from this owner's lasting memory. */
export function npcRevengeIntensity(context: NpcUtilityContext, targetOwnerId: string | undefined): number {
  if (!targetOwnerId) return 0;
  const present = npcGrudgeIntensity(context.profile.grudges?.[targetOwnerId], context.dayValue);
  // An old score from an earlier round weighs on a target the owner is looking at anyway; it reveals nothing.
  const old = context.profile.inherited?.relations[targetOwnerId]?.resentment ?? 0;
  // One who decided to hit back holds it against the one it blames all the more.
  const counter = context.counterOffender === targetOwnerId ? 0.25 : 0;
  return Math.min(1, (old > present ? old : present) + counter);
}

/**
 * A revenge attack judged by the damage it does, from the owner's own report:
 * enemy fleet and turrets destroyed (all on a win, the Lanchester share on a
 * loss) times the grudge, against the raid's own net. Worth a flight while
 * that sum is not negative, i.e. a loss up to `weight` per resource of damage.
 */
export function estimateRevengeEconomics(context: NpcUtilityContext, origin: SpyTargetState, report: SpyReportSnapshot,
  selectedShips: Readonly<Partial<Record<ShipId, number>>>): { intensity: number; damage: number; net: number; worthFlight: boolean } {
  const intensity = npcRevengeIntensity(context, report.targetOwnerId);
  if (intensity <= 0) return { intensity: 0, damage: 0, net: 0, worthFlight: false };
  const ownPower = estimateForcePower(stacks(getFactionShipCatalog(origin.raceId) as Catalog, selectedShips));
  const enemyPower = estimateReportedPower(context, report, ownPower);
  const win = estimateWinProbability(ownPower, enemyPower);
  const race = report.targetRaceId as CombatFactionId;
  const enemyValue = (report.fleet ? fleetCost(getFactionShipCatalog(race) as Catalog, report.fleet) : 0)
    + (report.defense ? fleetCost(getFactionDefenseCatalog(race) as Catalog, report.defense) : 0);
  const destroyedShare = win + (1 - win) * Math.min(1, (ownPower / Math.max(1, enemyPower)) ** 2);
  const damage = enemyValue * destroyedShare;
  const net = estimateRaidEconomics(context, origin, report, selectedShips).net + NPC_REVENGE_BALANCE.weight * intensity * damage;
  return { intensity, damage, net,
    worthFlight: win >= NPC_REVENGE_BALANCE.minWin && damage >= NPC_REVENGE_BALANCE.minDamageDayShare * context.dayValue && net >= 0 };
}

/** "[1:17:6]" of a battle report as "1:17:6". */
function coordinateLabelKey(label: string | undefined): string | null {
  const match = /^\[(\d+):(\d+):(\d+)\]$/.exec((label ?? '').trim());
  return match ? `${Number(match[1])}:${Number(match[2])}:${Number(match[3])}` : null;
}

const coordinateKeyOf = (coordinate: Readonly<{ galaxy: number; system: number; position: number }>) => `${coordinate.galaxy}:${coordinate.system}:${coordinate.position}`;

/**
 * A player attacks on what a spy report showed, and the report is only as good
 * as it is young: a defender builds in the meantime. An attack is sent only on
 * a report younger than this many game hours, and never on one older than a
 * lost attack on the same planet (that fight proved it wrong).
 */
export const NPC_ATTACK_INTEL_MAX_HOURS = 3;

/** 'fresh' the report may carry an attack; 'stale' too old; 'refuted' a lost attack came after it. Spy again first. */
export function npcAttackIntel(context: NpcUtilityContext, report: SpyReportSnapshot): 'fresh' | 'stale' | 'refuted' {
  const lostAt = context.attackLossAt?.get(coordinateKeyOf(report.targetCoordinate));
  if (lostAt !== undefined && lostAt >= report.createdAt) return 'refuted';
  return context.at - report.createdAt > NPC_ATTACK_INTEL_MAX_HOURS * HOUR ? 'stale' : 'fresh';
}

/** An attack needs at least even odds by the owner's own estimate, whatever the grudge. */
export const NPC_ATTACK_MIN_BELIEF = 0.5;

/** Smallest net haul, as a share of the owner's daily income, that justifies a raid. */
export const MIN_RAID_DAY_SHARE = 0.01;

/**
 * What one raid is expected to bring against what it costs, from the owner's
 * own latest report. A raid is worth a flight only when the haul at least
 * doubles the gas and, after the gas and the expected losses, still brings a
 * noticeable share of the owner's day (owner rule 25.10.2026).
 */
export function estimateRaidEconomics(context: NpcUtilityContext, origin: SpyTargetState, report: SpyReportSnapshot,
  selectedShips: Readonly<Partial<Record<ShipId, number>>>): { net: number; worthFlight: boolean } {
  const traits = context.profile.traits;
  const ownCatalog = getFactionShipCatalog(origin.raceId) as Catalog;
  const ownPower = estimateForcePower(stacks(ownCatalog, selectedShips));
  const risked = fleetCost(ownCatalog, selectedShips);
  const win = estimateWinProbability(ownPower, estimateReportedPower(context, report, ownPower));
  const gain = win * 0.5 * costValue(report.resources);
  // A decisive force loses little when it wins: the square law, never worse than the flat tenth a bare win cost.
  const advantage = ownPower / Math.max(1, estimateReportedPower(context, report, ownPower));
  const winLossShare = Math.min(0.1, Math.max(0.02, 0.5 / (advantage * advantage)));
  const expectedLoss = (1 - win) * risked * 0.85 + win * risked * winLossShare;
  const risk = (1 - unit(traits.riskTolerance)) * win * (1 - win) * risked;
  const fuel = calculateFlightFuel(origin.raceId as CombatFactionId, selectedShips,
    calculateRouteDistance(origin.coordinate, report.targetCoordinate));
  // A full report showing more fleet population than ships on orbit means a
  // fleet hidden in flight: a planet-destroyer siege that breaks the planet
  // burns that fleet with it, so it is worth something to the attacker.
  const hiddenPopulation = Math.max(0, (report.population?.fleet ?? 0) - visibleFleetPopulation(report));
  const sendsFlagship = ((selectedShips as Readonly<Partial<Record<string, number>>>)[NPC_FLAGSHIP_ID] ?? 0) > 0;
  const gainWithSiege = sendsFlagship ? win * 0.05 * hiddenPopulation * HIDDEN_FLEET_VALUE_PER_POPULATION : 0;
  const net = gain + gainWithSiege - fuel - expectedLoss - risk;
  // A fat store makes even a likely defeat pay on paper (a long shot at millions): the odds must be real too.
  return { net, worthFlight: win >= NPC_ATTACK_MIN_BELIEF && gain + gainWithSiege >= 2 * fuel && net >= MIN_RAID_DAY_SHARE * context.dayValue };
}

/** Rough price of one population unit of fleet, for judging a fleet nobody can see. */
const HIDDEN_FLEET_VALUE_PER_POPULATION = 1_500;

function visibleFleetPopulation(report: SpyReportSnapshot): number {
  if (!report.fleet) return 0;
  const catalog = getFactionShipCatalog(report.targetRaceId as CombatFactionId) as ReadonlyArray<{ id: string; population?: number }>;
  return catalog.reduce((sum, entity) => sum + (report.fleet?.[entity.id as ShipId] ?? 0) * (entity.population ?? 0), 0);
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

/** How bold an owner is in a raid, 0 (careful) to 1 (all in): the owner's aggression and appetite for risk. */
export function npcRaidBoldness(traits: Readonly<Record<string, number>>): number {
  return (unit(traits.aggression) + unit(traits.riskTolerance)) / 2;
}

/** How many times the expected defence the owner wants its force to be (2 for the careful, 4 for the bold): enough to win decisively. */
export function npcDecisiveMargin(traits: Readonly<Record<string, number>>, targetOnline = false): number {
  // A planet whose owner is looking can call its fleet home or add to it: no half measures there.
  return 2 + 2 * npcRaidBoldness(traits) + (targetOnline ? 0.5 : 0);
}

/** The owner's belief that this force beats the planet in the report (the same estimate the raid is judged by). */
export function estimateRaidWin(context: NpcUtilityContext, origin: SpyTargetState, report: SpyReportSnapshot,
  selectedShips: Readonly<Partial<Record<ShipId, number>>>): number {
  const ownPower = estimateForcePower(stacks(getFactionShipCatalog(origin.raceId) as Catalog, selectedShips));
  return estimateWinProbability(ownPower, estimateReportedPower(context, report, ownPower));
}

/**
 * The attack force a player would send: the cheapest prefix of its combat
 * ships (strongest per price first) that the owner believes wins with its
 * required margin; risk-averse owners want a larger margin. Returns null
 * when even everything available is not expected to win. The force sent is
 * then raised to a decisive one (owner report 05.11.2026: a player does not
 * send the bare minimum a planet can be beaten with, he sends what ends it).
 */
export function chooseNpcAttackForce(context: NpcUtilityContext, origin: SpyTargetState, targetPlanetId: string,
  available: Readonly<Partial<Record<string, number>>>, targetOnline = false): Record<string, number> | null {
  const report = context.latestReports.get(targetPlanetId);
  if (!report) return null;
  const catalog = (getFactionShipCatalog(origin.raceId) as Catalog)
    .filter((entity) => entity.category === 'Боевой корабль' && (available[entity.id] ?? 0) > 0)
    .sort((left, right) => combatEfficiency(right) - combatEfficiency(left) || (left.id < right.id ? -1 : 1));
  if (!catalog.length) return null;
  const all: Record<string, number> = Object.fromEntries(catalog.map((entity) => [entity.id, Math.max(0, Math.floor(available[entity.id] ?? 0))]));
  const enemy = estimateReportedPower(context, report, estimateForcePower(stacks(catalog, all)));
  // Revenge lowers the margin the owner asks for: it will trade ships to hurt an offender.
  const grudge = npcRevengeIntensity(context, report.targetOwnerId);
  // A lesson from an earlier round about this race moves the margin a little; the report still decides.
  const lesson = context.profile.inherited?.lessons.find((item) => item.family === 'attack' && item.enemyRace === report.targetRaceId)?.effect ?? 0;
  const wanted = Math.max(NPC_REVENGE_BALANCE.minWin, NPC_ATTACK_MIN_BELIEF, 0.6 + 0.3 * (1 - unit(context.profile.traits.riskTolerance))
    - NPC_REVENGE_BALANCE.marginDrop * grudge - 0.05 * lesson + 0.1 * (context.relations?.get(report.targetOwnerId)?.fear ?? 0));
  const winWithAll = estimateWinProbability(estimateForcePower(stacks(catalog, all)), enemy);
  // A grudge never sends a force that does not break the known defence: revenge only orders the profitable options.
  if (winWithAll < wanted) return null;
  // Against a Gate the owner throws everything it has: the campaign is at stake.
  if (context.rivalGateHosts?.has(targetPlanetId)) return all;
  // Smallest share of the available force (in tenths) that meets the margin, then the share that is decisive:
  // a multiple of the expected defence that grows with the owner's boldness (a careful owner still sends twice).
  const decisive = npcDecisiveMargin(context.profile.traits, targetOnline) * enemy;
  let minimal = 0;
  let enough = 0;
  const share = (tenths: number): Record<string, number> => {
    const force: Record<string, number> = {};
    for (const entity of catalog) {
      const count = Math.ceil(all[entity.id]! * tenths / 10);
      if (count > 0) force[entity.id] = count;
    }
    return force;
  };
  for (let tenths = 1; tenths <= 10 && !(minimal && enough); tenths += 1) {
    const power = estimateForcePower(stacks(catalog, share(tenths)));
    if (!minimal && estimateWinProbability(power, enemy) >= wanted) minimal = tenths;
    if (!enough && power >= decisive) enough = tenths;
  }
  if (!minimal) return all;
  // Decisive is out of reach: more than the bare minimum all the same, short of everything.
  return share(Math.max(minimal, enough || Math.ceil((minimal + 10) / 2)));
}

/**
 * 0 next door, about 1 across a galaxy, more for other galaxies: a far target
 * is legal, only slower and dearer to reach, and news of it ages on the way.
 */
export function flightRemoteness(from: Readonly<{ galaxy: number; system: number }>, to: Readonly<{ galaxy: number; system: number }>): number {
  return from.galaxy === to.galaxy ? Math.abs(from.system - to.system) / 40 : 1 + Math.abs(from.galaxy - to.galaxy) / 10;
}

/** Intelligence is worth more when the owner has none or it has gone stale. */
export function estimateEspionageUtility(context: NpcUtilityContext, targetPlanetId: string, remoteness = 0, targetOwnerId?: string, attackIntelNeeded = false): number {
  const traits = context.profile.traits;
  const report = context.latestReports.get(targetPlanetId);
  // Everyone hears of a Gate; whoever wants to break it must see its defence first.
  if (context.rivalGateHosts?.has(targetPlanetId)) {
    const age = report ? (context.at - report.createdAt) / HOUR : Infinity;
    return age > 1 ? 2 : -1;
  }
  // An attack worth sending but held back for old intel (or intel a lost fight refuted): look again first.
  const staleness = report && !attackIntelNeeded ? Math.min(1, (context.at - report.createdAt) / (48 * HOUR)) : 1;
  return (attackIntelNeeded ? 0.5 : 0) - 0.25 + 0.6 * staleness * (unit(traits.aggression) + unit(traits.militaryFocus)) / 2
    + 0.4 * staleness * (strategyOf(context).war - 0.3) - 0.6 * remoteness
    + NPC_REVENGE_BALANCE.spyBonus * staleness * npcRevengeIntensity(context, targetOwnerId);
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

/** Lanchester strength of ships (and turrets, and commanders) of one race, by the catalog's combat stats. */
export function npcForcePower(raceId: CombatFactionId, ships: Readonly<Partial<Record<string, number>>> | undefined,
  defenses?: Readonly<Partial<Record<string, number>>>, commanders?: Readonly<Partial<Record<string, number>>>): number {
  return estimateForcePower([
    ...stacks(getFactionShipCatalog(raceId) as Catalog, ships),
    ...stacks(getFactionDefenseCatalog(raceId) as Catalog, defenses),
    ...stacks(COMMANDER_COMBAT_CATALOG as Catalog, commanders),
  ]);
}

/** Resources spent on these turrets, at catalog prices. */
export function npcDefenseValue(raceId: CombatFactionId, defenses: Readonly<Partial<Record<string, number>>> | undefined): number {
  return defenses ? fleetCost(getFactionDefenseCatalog(raceId) as Catalog, defenses) : 0;
}

/** Strength one resource buys in this race's best-value warship: turns a public score into a force estimate. */
export function npcPowerPerResource(raceId: CombatFactionId): number {
  const catalog = (getFactionShipCatalog(raceId) as Catalog).filter((entity) => entity.category === 'Боевой корабль');
  return catalog.reduce((best, entity) => Math.max(best, combatEfficiency(entity)), 0);
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
