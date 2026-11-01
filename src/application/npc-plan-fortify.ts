import type { BuildAvailability, BuildingRole } from '../domain/buildings/resource-zone.ts';
import { migrateBuildingLevels } from '../domain/buildings/resource-zone.ts';
import type { DefenseId } from '../domain/combat/ids.ts';
import type { SpyTargetState } from '../domain/espionage/types.ts';
import { createDefaultFleetProductionState, getDefensePopulationSummary } from '../domain/fleet/production.ts';
import type { NpcAutonomyCandidate } from '../domain/npc/autonomy-policy.ts';
import { createNpcStrategyState, type NpcFortifyPlan, type NpcStrategyState } from '../domain/npc/strategy.ts';
import type { NpcProfile } from '../domain/npc/types.ts';
import type { SaveState } from './contracts.ts';
import { battleReportTime } from './history-retention.ts';
import { getNpcPlanetIncomePerHour, startNpcBuilding } from './npc-economy.ts';
import { startNpcFleetProduction, type NpcFleetProductionCandidate } from './npc-fleet-production.ts';
import { getNpcJournalSink } from './npc-journal.ts';
import { flightsToPlanet, ownerBattleReports } from './npc-knowledge-index.ts';
import { npcCharacterStyle, type NpcPlayStyle } from './npc-style.ts';
import { activeNpcFortifyPlan, hoardPressure, npcBatteryStats, NPC_FORTRESS_BALANCE, type NpcUtilityContext } from './npc-utility.ts';

/**
 * Plan «fortify-empire» (owner decision 8, ADR stage D): few planets, each of
 * them out of reach. Every planet of the owner aims at a defence population by
 * its worth and its danger, up to the owner's ~25 000 (a full hangar holds
 * 25 112 population of turrets, whichever turrets: the population is what the
 * rules cap, so the best battery is judged per population first). The plan is
 * data the owner reviews a few times a day; every step is the player's own
 * order or building, paid at its price, and only the stores above a reserve
 * pay for it, so the economy keeps running. Numbers are the bots' judgement.
 */
export const NPC_FORTIFY_BALANCE = Object.freeze({
  /** Game hours between reviews of the targets. */
  reviewHours: 6,
  /** Defence population each usual style aims at per planet; danger raises it to the full target. */
  styleCap: Object.freeze<Record<NpcPlayStyle, number>>({
    fortress: NPC_FORTRESS_BALANCE.defenseTarget, economist: 18_000, ally: 15_000, fleet: 12_000, 'crystal-hunter': 10_000, raider: 8_000,
  }),
  /** Days of income the targets may take on top of what lies in stores, at ambition 0 and 1. */
  budgetDays: [0.5, 3] as const,
  /** Share of the stores above the reserve one order may spend, at ambition 0 and 1. */
  spendShare: [0.45, 0.9] as const,
  /** Hours of the planet's own income kept per resource (never more than this share of the store). */
  reserveHours: 6,
  reserveShare: 0.25,
  /** Game hours of work a defence queue may hold ahead: news may still change the target. */
  queueHours: 10,
  /** Work left beyond this many game hours makes the shipyard and factory the next thing to build. */
  yardHours: 6,
  /** A cheaper battery only when it is at least this good next to the planet's best. */
  minRelativeScore: 0.45,
  /** A single-copy shield is bought only with this many times its price on the planet. */
  shieldStock: 3,
  /** Battles at a planet within this many game hours count as its danger. */
  dangerHours: 48,
  dangerBattles: 2,
});

const HOUR = 3_600_000;
const SHIELDS = ['tower-shield', 'planetary-shield'] as const;
const KEYS = ['metal', 'minerals', 'gas'] as const;
const reviewKey = (ownerId: string) => `fortify:${ownerId}`;
const lerp = ([low, high]: readonly [number, number], share: number) => low + (high - low) * share;

export type NpcFortifyPlanetInput = Readonly<{
  production: readonly NpcFleetProductionCandidate[];
  buildings: ReadonlyArray<Readonly<{ role: BuildingRole; availability: BuildAvailability }>>;
}>;

type Outcome = { state: SaveState; started: boolean; reason: string | null; planetId?: string; economyActionId?: string };
export type NpcFortifyChoice = { candidate: NpcAutonomyCandidate; run: (state: SaveState, key: string) => Outcome };

function strategyOf(state: SaveState): NpcStrategyState {
  return state.npcStrategy ?? createNpcStrategyState();
}

function defenceSummary(planet: SpyTargetState) {
  return getDefensePopulationSummary(planet.defense, planet.fleetProduction ?? createDefaultFleetProductionState(),
    Math.floor(Number(migrateBuildingLevels(planet.buildings).hangar ?? 0)), planet.raceId);
}

/** How much this owner's own eyes say each planet is in danger, 0..1. */
function planetDanger(state: SaveState, ownerId: string, planets: readonly SpyTargetState[], at: number, timeScale: number): Map<string, number> {
  const battles = new Map<string, number>();
  const window = NPC_FORTIFY_BALANCE.dangerHours * HOUR / Math.max(1, timeScale);
  for (const report of ownerBattleReports(state.combat.reports, ownerId)) {
    if (report.defender.playerId !== ownerId || !report.defender.planetName) continue;
    const when = battleReportTime(report);
    if (Number.isFinite(when) && when <= at && at - when <= window) battles.set(report.defender.planetName, (battles.get(report.defender.planetName) ?? 0) + 1);
  }
  return new Map(planets.map((planet) => {
    const incoming = flightsToPlanet(state.flights.records, planet.id).some((flight) => flight.phase === 'outbound' && flight.arrivalAt > at
      && flight.ownerId !== ownerId && (flight.missionId === 'attack' || flight.missionId === 'pirate-raid'));
    return [planet.id, incoming ? 1 : Math.min(1, (battles.get(planet.name) ?? 0) / NPC_FORTIFY_BALANCE.dangerBattles)];
  }));
}

/** 0..1: how much of the full fortress this character wants when nothing presses it. */
export function npcFortifyAmbition(profile: NpcProfile): number {
  const caps = Object.values(NPC_FORTIFY_BALANCE.styleCap);
  const floor = Math.min(...caps);
  return (NPC_FORTIFY_BALANCE.styleCap[npcCharacterStyle(profile)] - floor) / (NPC_FORTRESS_BALANCE.defenseTarget - floor);
}

/**
 * Defence population each planet aims at: worth × danger shares what the owner
 * can afford (stores plus some days of income) up to each planet's cap; a share
 * over a cap flows on to the others. Null while the economy is too small.
 */
export function npcFortifyTargets(state: SaveState, profile: NpcProfile, utility: NpcUtilityContext, at: number, timeScale: number): Record<string, number> | null {
  if (utility.dayValue < NPC_FORTRESS_BALANCE.minDayValue || !utility.ownPlanets.length) return null;
  const planets = [...utility.ownPlanets].sort((left, right) => (left.id < right.id ? -1 : 1));
  const ambition = npcFortifyAmbition(profile);
  const baseCap = NPC_FORTIFY_BALANCE.styleCap[npcCharacterStyle(profile)];
  const danger = planetDanger(state, profile.ownerId, planets, at, timeScale);
  const incomes = planets.map((planet) => getNpcPlanetIncomePerHour(planet, timeScale));
  const meanIncome = Math.max(1, incomes.reduce((sum, value) => sum + value, 0) / planets.length);
  const best = npcBatteryStats(planets[0]!.raceId)[0];
  const pricePerPopulation = best ? best.cost / best.population : 4_000;
  let held = 0;
  let current = 0;
  for (const planet of planets) {
    held += Math.max(0, planet.resources.metal) + Math.max(0, planet.resources.minerals) + Math.max(0, planet.resources.gas);
    current += defenceSummary(planet).population;
  }
  let left = current + (held + utility.dayValue * lerp(NPC_FORTIFY_BALANCE.budgetDays, ambition)) / pricePerPopulation;
  const rows = planets.map((planet, index) => {
    const risk = utility.ownGateHosts?.has(planet.id) ? 1 : danger.get(planet.id) ?? 0;
    return { id: planet.id, cap: baseCap + (NPC_FORTRESS_BALANCE.defenseTarget - baseCap) * risk, worth: (0.5 + incomes[index]! / meanIncome) * (1 + 2 * risk), target: 0 };
  });
  for (let pass = 0; pass < rows.length && left >= 1; pass += 1) {
    const open = rows.filter((row) => row.target < row.cap);
    const worth = open.reduce((sum, row) => sum + row.worth, 0);
    if (!open.length || worth <= 0) break;
    let spent = 0;
    for (const row of open) {
      const take = Math.min(row.cap - row.target, left * row.worth / worth);
      row.target += take;
      spent += take;
    }
    left -= spent;
  }
  return Object.fromEntries(rows.map((row) => [row.id, Math.round(row.target)]));
}

function withPlan(state: SaveState, plan: NpcFortifyPlan, nextReviewAt: number): SaveState {
  const strategy = strategyOf(state);
  const others = (strategy.plans[plan.ownerId] ?? []).filter((item) => item.template !== 'fortify-empire');
  return { ...state, npcStrategy: { ...strategy, plans: { ...strategy.plans, [plan.ownerId]: [plan, ...others] },
    nextCheckAt: { ...strategy.nextCheckAt, [reviewKey(plan.ownerId)]: nextReviewAt } } };
}

/** The owner's review of its targets, a few times a day: no action, only its own reading. */
export function refreshNpcFortify(state: SaveState, profile: NpcProfile, utility: NpcUtilityContext, at: number, timeScale: number): SaveState {
  const ownerId = profile.ownerId;
  if (at < (state.npcStrategy?.nextCheckAt[reviewKey(ownerId)] ?? 0)) return state;
  const targets = npcFortifyTargets(state, profile, utility, at, timeScale);
  const nextReviewAt = at + Math.round(NPC_FORTIFY_BALANCE.reviewHours * HOUR / Math.max(1, timeScale));
  const current = activeNpcFortifyPlan(state, ownerId);
  if (!targets) {
    if (current) return withPlan(state, current, nextReviewAt);
    const strategy = strategyOf(state);
    return { ...state, npcStrategy: { ...strategy, nextCheckAt: { ...strategy.nextCheckAt, [reviewKey(ownerId)]: nextReviewAt } } };
  }
  const plan: NpcFortifyPlan = current ? { ...current, targets, reviewedAt: at }
    : { planId: `fortify:${ownerId}:${at}`, template: 'fortify-empire', ownerId, status: 'active', createdAt: at, reviewedAt: at, targets, ambition: Math.round(npcFortifyAmbition(profile) * 1000) / 1000 };
  const values = Object.values(targets);
  getNpcJournalSink()?.outcome?.({ at, ownerId, kind: 'fortify', data: { planets: values.length, min: Math.min(...values), max: Math.max(...values),
    have: utility.ownPlanets.map((planet) => defenceSummary(planet).ownedPopulation).reduce((sum, value) => sum + value, 0) } });
  return withPlan(state, plan, nextReviewAt);
}

function spendable(planet: SpyTargetState, income: number, share: number): Record<(typeof KEYS)[number], number> {
  const keep = NPC_FORTIFY_BALANCE.reserveHours * income / KEYS.length;
  const left = (key: (typeof KEYS)[number]) => {
    const held = Math.max(0, planet.resources[key]);
    return Math.max(0, held - Math.min(keep, held * NPC_FORTIFY_BALANCE.reserveShare)) * share;
  };
  return { metal: left('metal'), minerals: left('minerals'), gas: left('gas') };
}

type OrderPick = { itemId: string; quantity: number };

/** The order that adds most strength now on this planet, among batteries worth its population. */
function pickOrder(planet: SpyTargetState, production: readonly NpcFleetProductionCandidate[], missing: number, room: number, at: number, timeScale: number,
  share: number, income: number): OrderPick | null {
  const money = spendable(planet, income, share);
  const queue = planet.fleetProduction?.defenseQueue ?? [];
  const freeAt = Math.max(at, ...queue.map((order) => order.finishAt));
  const horizon = at + NPC_FORTIFY_BALANCE.queueHours * HOUR / Math.max(1, timeScale) - freeAt;
  if (horizon <= 0) return null;
  const stats = npcBatteryStats(planet.raceId);
  // Requirements met: buildable now, or short only of stores or of room (a preview says so in its reason).
  const buildable = production.filter((preview) => preview.queueKind === 'defense' && (preview.available || /^Недостаточно (металла|минералов|газа|ресурсов|населения)/.test(preview.reason ?? '')));
  const rows = stats.filter((row) => buildable.some((preview) => preview.itemId === row.id));
  const top = rows[0]?.score ?? 0;
  let pick: OrderPick | null = null;
  let bestStrength = 0;
  for (const row of rows) {
    if (row.score < NPC_FORTIFY_BALANCE.minRelativeScore * top) break;
    const preview = buildable.find((item) => item.itemId === row.id)!;
    const byMoney = Math.min(...KEYS.map((key) => (preview.cost[key] > 0 ? Math.floor(money[key] / preview.cost[key]) : Number.MAX_SAFE_INTEGER)));
    const byTime = preview.durationMs > 0 ? Math.floor(horizon / preview.durationMs)
      : Math.floor(horizon / Math.max(1, row.seconds * 1000 / Math.max(1, timeScale)));
    const quantity = Math.min(Math.floor(Math.min(missing, room) / row.population), byMoney, byTime);
    if (quantity < 1) continue;
    const strength = quantity * row.strength;
    if (strength > bestStrength) { bestStrength = strength; pick = { itemId: row.id, quantity }; }
  }
  return pick;
}

/** Work a planet's missing defence would take with its best battery at the current yard, in game hours. */
function workHours(planet: SpyTargetState, production: readonly NpcFleetProductionCandidate[], missing: number, timeScale: number): number {
  const stats = npcBatteryStats(planet.raceId);
  const row = stats.find((item) => production.some((preview) => preview.queueKind === 'defense' && preview.itemId === item.id && preview.durationMs > 0));
  const duration = row ? production.find((preview) => preview.queueKind === 'defense' && preview.itemId === row.id)!.durationMs : 0;
  return row ? missing / row.population * duration * Math.max(1, timeScale) / HOUR : 0;
}

/** The next steps of the owner's plan this look: batteries, room for them, a faster yard, its shields. */
export function getNpcFortifyChoices(state: SaveState, profile: NpcProfile, utility: NpcUtilityContext, at: number, timeScale: number,
  inputs: ReadonlyMap<string, NpcFortifyPlanetInput>, scored: (candidateId: string, estimate: number) => number): NpcFortifyChoice[] {
  const plan = activeNpcFortifyPlan(state, profile.ownerId);
  if (!plan) return [];
  const ownerId = profile.ownerId;
  const choices: NpcFortifyChoice[] = [];
  const share = lerp(NPC_FORTIFY_BALANCE.spendShare, plan.ambition);
  const withTarget = (current: SaveState, target: SpyTargetState): SaveState => ({
    ...current, espionage: { ...current.espionage!, targets: { ...current.espionage!.targets, [target.id]: target } },
  });
  for (const planet of [...utility.ownPlanets].sort((left, right) => (left.id < right.id ? -1 : 1))) {
    const wanted = plan.targets[planet.id] ?? 0;
    const input = inputs.get(planet.id);
    if (!wanted || !input) continue;
    const summary = defenceSummary(planet);
    const missing = wanted - summary.population;
    if (missing <= 0) continue;
    const need = Math.min(1, missing / Math.max(1, wanted));
    const hoard = hoardPressure(utility, planet);
    const income = getNpcPlanetIncomePerHour(planet, timeScale);
    const stepEstimate = 0.3 + 1.2 * plan.ambition + 0.6 * need + 0.8 * hoard + 0.6 * utility.threat;
    const order = pickOrder(planet, input.production, missing, summary.available, at, timeScale, share, income);
    if (order) {
      const id = `fortify:order:${planet.id}:${order.itemId}`;
      choices.push({ candidate: { id, kind: 'plan-step', weight: scored(id, stepEstimate), payload: { planetId: planet.id, itemId: order.itemId } }, run: (current, key) => {
        const live = current.espionage?.targets?.[planet.id];
        if (!live || live.ownerId !== ownerId) return { state: current, started: false, reason: 'plan-planet-lost' };
        let quantity = order.quantity;
        let result = startNpcFleetProduction(live, ownerId, 'defense', order.itemId, at, timeScale, key, 0, quantity);
        while (!result.ok && quantity > 1) {
          quantity = Math.floor(quantity / 2);
          result = startNpcFleetProduction(live, ownerId, 'defense', order.itemId, at, timeScale, key, 0, quantity);
        }
        return { state: withTarget(current, result.target), started: result.ok, reason: result.reason, planetId: planet.id, ...(result.ok && result.orderId ? { economyActionId: result.orderId } : {}) };
      } });
    }
    // What holds the battery back: room in the hangar, then the yard's speed.
    const building = (role: BuildingRole) => input.buildings.find((item) => item.role === role && item.availability.canBuild);
    const offerBuilding = (role: BuildingRole, estimate: number) => {
      if (!building(role)) return;
      const id = `fortify:${role}:${planet.id}`;
      choices.push({ candidate: { id, kind: 'plan-step', weight: scored(id, estimate), payload: { planetId: planet.id, role } }, run: (current, key) => {
        const live = current.espionage?.targets?.[planet.id];
        if (!live || live.ownerId !== ownerId) return { state: current, started: false, reason: 'plan-planet-lost' };
        const result = startNpcBuilding(live, role, at, { timeScale }, key);
        return { state: withTarget(current, result.target), started: result.ok, reason: result.reason, planetId: planet.id, ...(result.ok ? { economyActionId: key } : {}) };
      } });
    };
    if (summary.capacity < wanted) offerBuilding('hangar', stepEstimate + 0.2);
    const levels = migrateBuildingLevels(planet.buildings);
    const bestRow = npcBatteryStats(planet.raceId)[0];
    const yardShort = bestRow !== undefined && Math.floor(Number(levels.shipyard ?? 0)) < bestRow.requiredShipyard;
    const slow = workHours(planet, input.production, missing, timeScale) > NPC_FORTIFY_BALANCE.yardHours;
    if (yardShort || slow) {
      offerBuilding('shipyard', stepEstimate + (yardShort ? 0.3 : 0));
      if (slow) offerBuilding('advanced-factory', stepEstimate - 0.2);
    }
    // The shields are single copies: strong life for their population, once there is money for them.
    for (const shield of SHIELDS) {
      const preview = input.production.find((item) => item.queueKind === 'defense' && item.itemId === shield && item.available);
      if (!preview || (planet.defense.defenses[shield as DefenseId] ?? 0) > 0) continue;
      const price = preview.cost.metal + preview.cost.minerals + preview.cost.gas;
      const held = planet.resources.metal + planet.resources.minerals + planet.resources.gas;
      if (held < NPC_FORTIFY_BALANCE.shieldStock * price) continue;
      const id = `fortify:shield:${planet.id}:${shield}`;
      choices.push({ candidate: { id, kind: 'plan-step', weight: scored(id, stepEstimate - 0.3), payload: { planetId: planet.id, itemId: shield } }, run: (current, key) => {
        const live = current.espionage?.targets?.[planet.id];
        if (!live || live.ownerId !== ownerId) return { state: current, started: false, reason: 'plan-planet-lost' };
        const result = startNpcFleetProduction(live, ownerId, 'defense', shield, at, timeScale, key, 0, 1);
        return { state: withTarget(current, result.target), started: result.ok, reason: result.reason, planetId: planet.id, ...(result.ok && result.orderId ? { economyActionId: result.orderId } : {}) };
      } });
    }
  }
  return choices;
}

/** What each of the owner's planets still lacks for its target, in resources at its best battery's price. */
export function npcFortifyShortfalls(state: SaveState, ownerId: string, planets: readonly SpyTargetState[]): Map<string, number> {
  const plan = activeNpcFortifyPlan(state, ownerId);
  const missing = new Map<string, number>();
  if (!plan) return missing;
  for (const planet of planets) {
    const lacking = (plan.targets[planet.id] ?? 0) - defenceSummary(planet).population;
    const best = npcBatteryStats(planet.raceId)[0];
    if (lacking > 0 && best) missing.set(planet.id, lacking * best.cost / best.population);
  }
  return missing;
}
