import type { NpcAutonomyCandidate } from '../domain/npc/autonomy-policy.ts';
import type { NpcProfile } from '../domain/npc/types.ts';
import type { SpyReportSnapshot, SpyTargetState } from '../domain/espionage/types.ts';
import type { BattleReport } from '../domain/combat/report.ts';
import type { CombatFactionId } from '../domain/combat/factions.ts';
import type { ShipId } from '../domain/combat/ids.ts';
import { COMMANDER_IDS } from '../domain/combat/commanders.ts';
import { getFactionShipCatalog } from '../domain/combat/faction-catalog.ts';
import { calculateFleetPopulation, createEmptyFleetState } from '../domain/fleet/runtime.ts';
import { estimateWinProbability, utilityToWeight } from '../domain/npc/utility.ts';
import {
  createNpcStrategyState, NPC_CLOSED_PLANS_KEPT, type NpcOutcomeStat, type NpcPlanOrder, type NpcShipCounts, type NpcStrategyState, type NpcStrikePlan,
} from '../domain/npc/strategy.ts';
import type { SaveState } from './contracts.ts';
import { getNpcJournalSink } from './npc-journal.ts';
import { flightsToPlanet, ownerFlights } from './npc-knowledge-index.ts';
import { getOwnerRelation } from './owner-relations.ts';
import { evaluatePlanetAttackEligibility } from './attack-eligibility.ts';
import { getNpcFleetProductionCandidates, startNpcFleetProduction } from './npc-fleet-production.ts';
import { dispatchNpcDeployment, dispatchNpcMission, getNpcMissionAvailableFleet, npcDeploymentFreeCapacity } from './npc-missions.ts';
import { candidateToNpcMissionCommand, type NpcMissionCandidate } from './npc-mission-policy.ts';
import { npcCombatPriority, npcEnemyShape, npcMainCommander } from './npc-commanders.ts';
import { activeNpcPlans, npcPlanReservedShips } from './npc-plan-reserve.ts';
import {
  combatEfficiency, estimateRaidEconomics, estimateReportedPower, estimateRevengeEconomics, npcFleetValue, npcForcePower,
  npcRevengeIntensity, NPC_REVENGE_BALANCE, type NpcUtilityContext,
} from './npc-utility.ts';

/**
 * Strategic plan «strike» (NPC intelligence slice 1; owner example «все семь
 * планет производят нужный флот → дислокация → один удар»). An owner whose
 * own fresh report shows a target no single planet of it can beat, but its
 * whole empire can (with ships it can still afford to build), may commit to:
 * build the missing ships on several planets at once, bring every share to one
 * rally planet by deployment, scout the target again, then send one attack —
 * or cancel with a reason when the news gets worse. Every step is a choice in
 * the owner's ordinary look at the game and runs through the player's command.
 *
 * Numbers are the bots' judgement (owner may change them), not game rules.
 */
export const NPC_STRIKE_BALANCE = Object.freeze({
  /** Game hours between an owner's looks for a new plan. */
  checkHours: 2,
  /** A report older than this (game hours) is no ground for a new plan… */
  createReportHours: 12,
  /** …and before the attack the target is scouted again unless the report is this fresh. */
  recheckReportHours: 1.5,
  /** Share of each planet's resources a plan may spend on ships (the rest stays for defence and building; owner rule 31.10.2026). */
  budgetShare: 0.6,
  /** At the recheck the plan goes on only while the belief stays above this share of the wanted margin. */
  recheckMargin: 0.9,
  /**
   * Slack after the expected readiness before the plan is given up, and its
   * bounds (game hours). The owner moves the plan only in its own sessions,
   * hours apart: a deadline shorter than a couple of them dies unplayed.
   */
  deadlineFactor: 3,
  minDeadlineHours: 12,
  maxDeadlineHours: 48,
  /** Production split into this many chunks when it is spread over planets. */
  chunks: 24,
  /** Free hangar room the rally planet needs over the shares still to arrive. */
  hangarSlack: 1.15,
});

const HOUR = 3_600_000;
let plansEnabled = true;

/** Lab switch (ablation): with plans off owners never start one; plans in a save still run out. */
export function setNpcPlansEnabled(enabled: boolean): boolean {
  const previous = plansEnabled;
  plansEnabled = enabled;
  return previous;
}

type Outcome = { state: SaveState; started: boolean; reason: string | null; planetId?: string; economyActionId?: string };
export type NpcPlanChoice = { candidate: NpcAutonomyCandidate; run: (state: SaveState, key: string) => Outcome };

type Catalog = ReturnType<typeof getFactionShipCatalog>;
const combatShips = (catalog: Catalog) => catalog.filter((entity) => entity.category === 'Боевой корабль' && entity.combat);

function strategyOf(state: SaveState): NpcStrategyState {
  return state.npcStrategy ?? createNpcStrategyState();
}

function withStrategy(state: SaveState, strategy: NpcStrategyState): SaveState {
  return { ...state, npcStrategy: strategy };
}

function replacePlan(state: SaveState, plan: NpcStrikePlan): SaveState {
  const strategy = strategyOf(state);
  const plans = strategy.plans[plan.ownerId] ?? [];
  const next = plans.some((item) => item.planId === plan.planId) ? plans.map((item) => item.planId === plan.planId ? plan : item) : [plan, ...plans];
  // Active plans first, then the most recently closed few.
  const active = next.filter((item) => item.status === 'active');
  const closed = next.filter((item) => item.status !== 'active')
    .sort((left, right) => (right.closedAt ?? 0) - (left.closedAt ?? 0) || (left.planId < right.planId ? -1 : 1)).slice(0, NPC_CLOSED_PLANS_KEPT);
  return withStrategy(state, { ...strategy, plans: { ...strategy.plans, [plan.ownerId]: [...active, ...closed] } });
}

function addCounts(into: Record<string, number>, counts: NpcShipCounts | undefined): void {
  for (const [id, count] of Object.entries(counts ?? {})) into[id] = (into[id] ?? 0) + count;
}

function totalForce(plan: NpcStrikePlan): Record<string, number> {
  const total: Record<string, number> = {};
  for (const counts of Object.values(plan.reserve)) addCounts(total, counts);
  return total;
}

function covers(available: Readonly<Partial<Record<string, number>>>, wanted: NpcShipCounts | undefined): boolean {
  return Object.entries(wanted ?? {}).every(([id, count]) => (available[id] ?? 0) >= count);
}

function wantedWin(utility: NpcUtilityContext, targetOwnerId: string): number {
  const grudge = npcRevengeIntensity(utility, targetOwnerId);
  return Math.max(NPC_REVENGE_BALANCE.minWin, 0.6 + 0.3 * (1 - unit(utility.profile.traits.riskTolerance)) - NPC_REVENGE_BALANCE.marginDrop * grudge);
}

function unit(value: number): number {
  return Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));
}

function fleetPopulation(raceId: CombatFactionId, ships: Readonly<Record<string, number>>): number {
  const empty = createEmptyFleetState();
  return calculateFleetPopulation({ ships: { ...empty.ships, ...ships }, commanders: empty.commanders }, raceId);
}

/** Population already flown out of a planet on the owner's missions (counts against its production room). */
function flownPopulation(state: SaveState, ownerId: string, planet: SpyTargetState): number {
  return ownerFlights(state.flights.records, ownerId).filter((flight) => flight.ownerSide === 'npc' && flight.originPlanetId === planet.id
    && ['outbound', 'arrived', 'returning'].includes(flight.phase))
    .reduce((sum, flight) => { const empty = createEmptyFleetState(); return sum + calculateFleetPopulation({ ships: { ...empty.ships, ...flight.selectedShips }, commanders: { ...empty.commanders, ...flight.selectedCommanders } }, planet.raceId); }, 0);
}

/** An enemy attack on its way to any of the owner's planets: gathering waits (the fleet may be needed at home). */
function underAttack(state: SaveState, planets: readonly SpyTargetState[], ownerId: string, at: number): boolean {
  return planets.some((planet) => flightsToPlanet(state.flights.records, planet.id).some((flight) => flight.phase === 'outbound'
    && flight.arrivalAt > at && flight.ownerId !== ownerId && (flight.missionId === 'attack' || flight.missionId === 'pirate-raid')));
}

/** Free hangar room at the rally planet less what the owner's deployments already bring there. */
function rallyRoom(state: SaveState, plan: NpcStrikePlan, rally: SpyTargetState): number {
  const inbound = ownerFlights(state.flights.records, plan.ownerId).filter((flight) => flight.ownerSide === 'npc' && flight.missionId === 'deployment'
    && flight.destinationPlanetId === rally.id && flight.phase === 'outbound')
    .reduce((sum, flight) => sum + fleetPopulation(rally.raceId, flight.selectedShips as Record<string, number>), 0);
  return npcDeploymentFreeCapacity(rally) - inbound;
}

/** The owner's free combat ships on a planet, less what its other plans hold. */
function freeCombat(state: SaveState, ownerId: string, planet: SpyTargetState, catalog: Catalog): Record<string, number> {
  const available = getNpcMissionAvailableFleet(state, ownerId, planet.id) ?? {};
  const reserved = npcPlanReservedShips(state, ownerId, planet.id);
  const free: Record<string, number> = {};
  for (const entity of combatShips(catalog)) {
    const count = Math.max(0, Math.floor((available[entity.id as ShipId] ?? 0) - (reserved[entity.id] ?? 0)));
    if (count > 0) free[entity.id] = count;
  }
  return free;
}

type Draft = { plan: NpcStrikePlan; estimate: number };

/**
 * The best strike the owner could commit to now, from its own reports only,
 * or null. Pure: the caller decides whether the owner takes it.
 */
export function draftNpcStrike(state: SaveState, profile: NpcProfile, utility: NpcUtilityContext, at: number, timeScale: number): Draft | null {
  const ownerId = profile.ownerId;
  const planets = [...utility.ownPlanets].sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0));
  if (planets.length < 2) return null;
  const raceId = planets[0]!.raceId;
  const catalog = getFactionShipCatalog(raceId);
  const combat = combatShips(catalog);
  const free = new Map(planets.map((planet) => [planet.id, freeCombat(state, ownerId, planet, catalog)]));
  const allShips: Record<string, number> = {};
  for (const counts of free.values()) addCounts(allShips, counts);
  const singleBest = Math.max(0, ...planets.map((planet) => npcForcePower(raceId, free.get(planet.id))));
  const empirePower = npcForcePower(raceId, allShips);
  // Production the owner could add: the strongest-per-price hull, on each planet that can build it now.
  let previews: Map<string, { durationMs: number; cost: { metal: number; minerals: number; gas: number }; queueFreeAt: number }> | null = null;
  let hull: (typeof combat)[number] | undefined;
  const loadPreviews = () => {
    if (previews) return;
    previews = new Map();
    const options = new Map<string, number>();
    const perPlanet = new Map<string, ReturnType<typeof getNpcFleetProductionCandidates>>();
    for (const planet of planets) {
      const list = getNpcFleetProductionCandidates(planet, ownerId, at, timeScale, flownPopulation(state, ownerId, planet))
        .filter((preview) => preview.available && preview.queueKind === 'ships' && combat.some((entity) => entity.id === preview.itemId));
      perPlanet.set(planet.id, list);
      for (const preview of list) options.set(preview.itemId, (options.get(preview.itemId) ?? 0) + 1);
    }
    hull = combat.filter((entity) => options.has(entity.id))
      .sort((left, right) => combatEfficiency(right) - combatEfficiency(left) || (left.id < right.id ? -1 : 1))[0];
    if (!hull) return;
    for (const planet of planets) {
      const preview = perPlanet.get(planet.id)!.find((item) => item.itemId === hull!.id);
      if (!preview || preview.durationMs <= 0) continue;
      const queue = (planet as SpyTargetState & { fleetProduction?: { shipQueue?: { finishAt: number }[] } }).fleetProduction?.shipQueue ?? [];
      previews.set(planet.id, { durationMs: preview.durationMs, cost: preview.cost, queueFreeAt: Math.max(at, ...queue.map((order) => order.finishAt)) });
    }
  };
  let best: Draft | null = null;
  const reports = [...utility.latestReports.values()].sort((left, right) => (left.targetPlanetId < right.targetPlanetId ? -1 : 1));
  for (const report of reports) {
    const target = state.espionage?.targets?.[report.targetPlanetId];
    if (!target || target.ownerId !== report.targetOwnerId || target.ownerId === ownerId) continue;
    if (at - report.createdAt > NPC_STRIKE_BALANCE.createReportHours * HOUR / Math.max(1, timeScale)) continue;
    const relation = getOwnerRelation(state, ownerId, target.ownerId);
    if (relation !== 'enemy' && relation !== 'neutral') continue;
    // The owner points rule decides at launch; a target outside the band is no plan.
    if (!evaluatePlanetAttackEligibility(state, ownerId, target.ownerId).allowed) continue;
    const enemy = estimateReportedPower(utility, report, empirePower);
    const wanted = wantedWin(utility, target.ownerId);
    if (estimateWinProbability(singleBest, enemy) >= wanted) continue; // one planet can do it: an ordinary attack
    const needed = enemy * (wanted / (1 - wanted)) ** (1 / 2.5);
    const reserve = new Map<string, Record<string, number>>([...free].map(([id, counts]) => [id, { ...counts }]));
    const orders: NpcPlanOrder[] = [];
    let readyAt = at;
    if (empirePower < needed) {
      loadPreviews();
      if (!hull || !previews!.size) continue;
      let attack = 0;
      let life = 0;
      for (const entity of combat) { attack += (allShips[entity.id] ?? 0) * entity.combat!.attack; life += (allShips[entity.id] ?? 0) * entity.combat!.life; }
      const a = hull.combat!.attack;
      const l = hull.combat!.life;
      const b = attack * l + life * a;
      const units = Math.ceil((-b + Math.sqrt(b * b - 4 * a * l * (attack * life - needed * needed))) / (2 * a * l));
      if (!Number.isFinite(units) || units <= 0) continue;
      // Spread the units in chunks, each to the planet that would finish it soonest and can still pay for it.
      const chunk = Math.max(1, Math.ceil(units / NPC_STRIKE_BALANCE.chunks));
      const placed = new Map<string, number>();
      let left = units;
      while (left > 0) {
        const take = Math.min(chunk, left);
        let pick: { id: string; finish: number } | null = null;
        for (const [planetId, preview] of previews!) {
          const planet = planets.find((item) => item.id === planetId)!;
          const count = (placed.get(planetId) ?? 0) + take;
          const affordable = (['metal', 'minerals', 'gas'] as const).every((key) => preview.cost[key] * count <= NPC_STRIKE_BALANCE.budgetShare * planet.resources[key]);
          if (!affordable) continue;
          const finish = preview.queueFreeAt + count * preview.durationMs;
          if (!pick || finish < pick.finish) pick = { id: planetId, finish };
        }
        if (!pick) break;
        placed.set(pick.id, (placed.get(pick.id) ?? 0) + take);
        left -= take;
      }
      if (left > 0) continue; // the empire cannot afford it now
      for (const [planetId, count] of [...placed].sort(([x], [y]) => (x < y ? -1 : 1))) {
        orders.push({ planetId, itemId: hull.id, quantity: count });
        const share = reserve.get(planetId)!;
        share[hull.id] = (share[hull.id] ?? 0) + count;
        const preview = previews!.get(planetId)!;
        readyAt = Math.max(readyAt, preview.queueFreeAt + count * preview.durationMs);
      }
    }
    const force: Record<string, number> = {};
    for (const counts of reserve.values()) addCounts(force, counts);
    if (!Object.keys(force).length) continue;
    // Rally where the force fits the hangar, preferring the planet that already holds most of it, then the one nearest the target.
    // The hangar takes the shares as the player's deployment checks it (free room now), with slack for the owner's other ships.
    const population = fleetPopulation(raceId, force);
    const rally = planets.filter((planet) => npcDeploymentFreeCapacity(planet)
      >= NPC_STRIKE_BALANCE.hangarSlack * (population - fleetPopulation(raceId, free.get(planet.id) ?? {}))).sort((left, right) => npcFleetValue(raceId, reserve.get(right.id) ?? {}) - npcFleetValue(raceId, reserve.get(left.id) ?? {})
      || distance(left, target) - distance(right, target) || (left.id < right.id ? -1 : 1))[0];
    if (!rally) continue;
    const contributing = [...reserve].filter(([, counts]) => Object.keys(counts).length > 0);
    if (contributing.length < 2) continue; // nothing to gather: not this plan
    const economics = estimateRaidEconomics(utility, rally, report, force);
    const revenge = estimateRevengeEconomics(utility, rally, report, force);
    const gate = utility.rivalGateHosts?.has(target.id) ?? false;
    if (!economics.worthFlight && !revenge.worthFlight && !gate) continue;
    const win = estimateWinProbability(npcForcePower(raceId, force), estimateReportedPower(utility, report, npcForcePower(raceId, force)));
    // The recheck judges by this same belief: a plan it would cancel at once is not worth starting.
    if (win < NPC_STRIKE_BALANCE.recheckMargin * wanted) continue;
    // The haul is what the holds carry home, not the whole half of the target's stock.
    const holds = win * catalog.reduce((sum, entity) => sum + (force[entity.id] ?? 0) * (entity.ship?.cargo ?? 0), 0);
    const net = Math.max(Math.min(economics.net, holds), revenge.net);
    const estimate = 0.3 + Math.min(1.5, net / Math.max(1, utility.dayValue)) + (gate ? 1 : 0) + 0.4 * unit(profile.traits.planningHorizon) - 0.2;
    if (best && best.estimate >= estimate) continue;
    const scale = Math.max(1, timeScale);
    const ready = Math.max(readyAt, at) + HOUR / scale;
    const slack = Math.min(NPC_STRIKE_BALANCE.maxDeadlineHours * HOUR / scale,
      Math.max(NPC_STRIKE_BALANCE.minDeadlineHours * HOUR / scale, NPC_STRIKE_BALANCE.deadlineFactor * (ready - at)));
    const gain = Math.max(0, Math.min(economics.net, holds));
    best = { estimate, plan: {
      planId: '', template: 'strike', ownerId, status: 'active', phase: 'produce', createdAt: at, deadlineAt: at + Math.round(slack),
      targetPlanetId: target.id, targetOwnerId: target.ownerId, rallyPlanetId: rally.id,
      reserve: Object.fromEntries(contributing.sort(([x], [y]) => (x < y ? -1 : 1))),
      orders, forecast: { win: round3(win), gain: Math.round(gain), loss: Math.round(npcFleetValue(raceId, force) * ((1 - win) * 0.85 + win * 0.1)), readyAt: Math.round(ready) },
      knowledgeAt: report.createdAt, sent: [],
    } };
  }
  return best;
}

function distance(left: SpyTargetState, right: SpyTargetState): number {
  return Math.abs(left.coordinate.galaxy - right.coordinate.galaxy) * 1000 + Math.abs(left.coordinate.system - right.coordinate.system) * 10
    + Math.abs(left.coordinate.position - right.coordinate.position);
}

const round3 = (value: number) => Math.round(value * 1000) / 1000;

function statOf(strategy: NpcStrategyState, ownerId: string): NpcOutcomeStat {
  return strategy.outcomes[ownerId]?.strike ?? { n: 0, done: 0, wins: 0, cancelled: 0, sumError: 0, sumAbsError: 0, lastAt: 0 };
}

/** Ends a plan: its reservation is released, the owner's tally and the outcome ledger learn how it went. */
function closePlan(state: SaveState, plan: NpcStrikePlan, status: NpcStrikePlan['status'], at: number, reason?: string,
  result?: NpcStrikePlan['result']): SaveState {
  const closed: NpcStrikePlan = { ...plan, status, closedAt: at, ...(reason ? { reason } : {}), ...(result ? { result } : {}) };
  let next = replacePlan(state, closed);
  const strategy = strategyOf(next);
  const stat = statOf(strategy, plan.ownerId);
  const error = result ? (result.won ? 1 : 0) - plan.forecast.win : 0;
  const updated: NpcOutcomeStat = {
    n: stat.n + 1, done: stat.done + (status === 'done' ? 1 : 0), wins: stat.wins + (result?.won ? 1 : 0),
    cancelled: stat.cancelled + (status === 'cancelled' ? 1 : 0),
    sumError: round3(stat.sumError + error), sumAbsError: round3(stat.sumAbsError + Math.abs(error)), lastAt: at,
  };
  next = withStrategy(next, { ...strategy, outcomes: { ...strategy.outcomes, [plan.ownerId]: { ...(strategy.outcomes[plan.ownerId] ?? {}), strike: updated } } });
  getNpcJournalSink()?.outcome?.({ at, ownerId: plan.ownerId, kind: 'plan', data: {
    tp: plan.template, id: plan.planId, st: status, why: reason ?? null, ph: plan.phase,
    f: { p: plan.forecast.win, g: plan.forecast.gain, l: plan.forecast.loss, ready: plan.forecast.readyAt },
    ...(result ? { won: result.won ? 1 : 0, gain: Math.round(result.gain), loss: Math.round(result.loss), err: round3(error) } : {}),
    ka: plan.knowledgeAt, planets: Object.keys(plan.reserve).length, orders: plan.orders.length, target: plan.targetOwnerId,
    hours: round3((at - plan.createdAt) / HOUR),
  } });
  return next;
}

/** The newest own report on the plan's target. */
function latestReport(utility: NpcUtilityContext, plan: NpcStrikePlan): SpyReportSnapshot | undefined {
  return utility.latestReports.get(plan.targetPlanetId);
}

/**
 * Moves the owner's plans on by what the world shows now (ships built,
 * shares arrived, news of the target, deadlines): no action, only the plan's
 * own reading. Called at the start of each look.
 */
export function refreshNpcPlans(state: SaveState, profile: NpcProfile, utility: NpcUtilityContext, at: number, timeScale: number): SaveState {
  const ownerId = profile.ownerId;
  let next = state;
  for (let plan of activeNpcPlans(state, ownerId)) {
    const target = next.espionage?.targets?.[plan.targetPlanetId];
    if (!target || target.ownerId !== plan.targetOwnerId) { next = closePlan(next, plan, 'cancelled', at, 'target-gone'); continue; }
    if (!next.espionage?.targets?.[plan.rallyPlanetId] || next.espionage.targets[plan.rallyPlanetId]!.ownerId !== ownerId) {
      next = closePlan(next, plan, 'cancelled', at, 'rally-lost'); continue;
    }
    if (plan.phase === 'flying') {
      const flight = next.flights.records.find((record) => record.id === plan.launchFlightId);
      // The fleet came back (or never fought) without a battle on the plan's target.
      if (!flight || flight.phase === 'returning' || flight.phase === 'completed') next = closePlan(next, plan, 'failed', at, 'no-battle');
      continue;
    }
    if (at > plan.deadlineAt) {
      // A deadline missed while an attack on the owner held the gathering back is the threat's doing.
      next = closePlan(next, plan, 'cancelled', at, underAttack(next, utility.ownPlanets, ownerId, at) ? 'threat-at-home' : 'deadline');
      continue;
    }
    if (plan.phase === 'produce' || plan.phase === 'rally') {
      // A share ready to leave that the rally hangar cannot take (with what is already coming): the force never stands together.
      const rally = next.espionage!.targets![plan.rallyPlanetId]!;
      const room = rallyRoom(next, plan, rally);
      const blocked = Object.entries(plan.reserve).some(([planetId, counts]) => planetId !== plan.rallyPlanetId && !plan.sent.includes(planetId)
        && plan.orders.filter((order) => order.planetId === planetId).every((order) => order.orderId)
        && covers(getNpcMissionAvailableFleet(next, ownerId, planetId) ?? {}, counts) && fleetPopulation(rally.raceId, counts) > room);
      if (blocked) { next = closePlan(next, plan, 'cancelled', at, 'hangar-full'); continue; }
    }
    if (plan.phase === 'produce') {
      const placed = plan.orders.every((order) => order.orderId);
      // Shares already on their way count as built; the rally planet's own share is counted with the arrivals.
      const built = Object.entries(plan.reserve).every(([planetId, counts]) => plan.sent.includes(planetId)
        || covers(getNpcMissionAvailableFleet(next, ownerId, planetId) ?? {}, counts));
      if (!placed || !built) continue;
      next = replacePlan(next, { ...plan, phase: 'rally' });
      plan = activeNpcPlans(next, ownerId).find((item) => item.planId === plan.planId) ?? plan;
    }
    if (plan.phase === 'rally') {
      const sources = Object.keys(plan.reserve).filter((planetId) => planetId !== plan.rallyPlanetId);
      const arrived = sources.every((planetId) => plan.sent.includes(planetId))
        && covers(getNpcMissionAvailableFleet(next, ownerId, plan.rallyPlanetId) ?? {}, totalForce(plan));
      if (arrived) next = replacePlan(next, { ...plan, phase: 'recheck' });
      continue;
    }
    if (plan.phase === 'recheck') {
      const report = latestReport(utility, plan);
      if (!report || at - report.createdAt > NPC_STRIKE_BALANCE.recheckReportHours * HOUR / Math.max(1, timeScale)) continue; // a probe is due
      const rally = next.espionage!.targets![plan.rallyPlanetId]!;
      const force = totalForce(plan);
      const own = npcForcePower(rally.raceId, force);
      const win = estimateWinProbability(own, estimateReportedPower(utility, report, own));
      const checked = { ...plan, knowledgeAt: report.createdAt };
      next = win < NPC_STRIKE_BALANCE.recheckMargin * wantedWin(utility, plan.targetOwnerId)
        ? closePlan(next, checked, 'cancelled', at, 'target-stronger')
        : replacePlan(next, { ...checked, phase: 'launch' });
      continue;
    }
    if (plan.phase === 'launch') {
      // Points or relations changed while the force gathered: the attack is no longer allowed.
      const relation = getOwnerRelation(next, ownerId, plan.targetOwnerId);
      if ((relation !== 'enemy' && relation !== 'neutral') || !evaluatePlanetAttackEligibility(next, ownerId, plan.targetOwnerId).allowed) {
        next = closePlan(next, plan, 'cancelled', at, 'attack-not-allowed');
      }
    }
  }
  return next;
}

/** The plan steps the owner can take in this look, and a new plan when one is worth it. */
export function getNpcPlanChoices(state: SaveState, profile: NpcProfile, utility: NpcUtilityContext, at: number, timeScale: number,
  missions: readonly NpcMissionCandidate[], scored: (candidateId: string, estimate: number) => number): NpcPlanChoice[] {
  const ownerId = profile.ownerId;
  const choices: NpcPlanChoice[] = [];
  const active = activeNpcPlans(state, ownerId);
  const planets = utility.ownPlanets;
  const paused = underAttack(state, planets, ownerId, at);
  for (const plan of active) {
    if (plan.phase === 'produce' || plan.phase === 'rally') {
      for (const order of plan.orders) {
        if (order.orderId) continue;
        const id = `plan:produce:${plan.planId}:${order.planetId}:${order.itemId}`;
        choices.push({ candidate: { id, kind: 'plan-step', weight: utilityToWeight(2), payload: { planetId: order.planetId } }, run: (current, key) => {
          const planet = current.espionage?.targets?.[order.planetId];
          if (!planet || planet.ownerId !== ownerId) return { state: current, started: false, reason: 'plan-planet-lost' };
          const reserved = flownPopulation(current, ownerId, planet);
          let quantity = order.quantity;
          let result = startNpcFleetProduction(planet, ownerId, 'ships', order.itemId, at, timeScale, key, reserved, quantity);
          while (!result.ok && quantity > 1) {
            quantity = Math.floor(quantity / 2);
            result = startNpcFleetProduction(planet, ownerId, 'ships', order.itemId, at, timeScale, key, reserved, quantity);
          }
          if (!result.ok) return { state: current, started: false, reason: result.reason, planetId: order.planetId };
          const latest = activeNpcPlans(current, ownerId).find((item) => item.planId === plan.planId) ?? plan;
          // A smaller batch than planned shrinks this planet's share: the rest is not coming.
          const share = { ...(latest.reserve[order.planetId] ?? {}) };
          share[order.itemId] = Math.max(0, (share[order.itemId] ?? 0) - (order.quantity - quantity));
          if (!share[order.itemId]) delete share[order.itemId];
          const updated: NpcStrikePlan = { ...latest,
            orders: latest.orders.map((item) => item === order || (item.planetId === order.planetId && item.itemId === order.itemId && !item.orderId)
              ? { ...item, quantity, orderId: result.orderId ?? key } : item),
            reserve: { ...latest.reserve, [order.planetId]: share } };
          const withTarget = { ...current, espionage: { ...current.espionage!, targets: { ...current.espionage!.targets, [planet.id]: result.target } } };
          return { state: replacePlan(withTarget, updated), started: true, reason: null, planetId: order.planetId,
            ...(result.orderId ? { economyActionId: result.orderId } : {}) };
        } });
      }
    }
    if ((plan.phase === 'produce' || plan.phase === 'rally') && !paused) {
      // Each share leaves for the rally planet once it stands complete; waves follow the free flight slots.
      for (const [planetId, counts] of Object.entries(plan.reserve)) {
        if (planetId === plan.rallyPlanetId || plan.sent.includes(planetId)) continue;
        if (!plan.orders.filter((order) => order.planetId === planetId).every((order) => order.orderId)) continue;
        if (!covers(getNpcMissionAvailableFleet(state, ownerId, planetId) ?? {}, counts)) continue;
        const id = `plan:rally:${plan.planId}:${planetId}`;
        choices.push({ candidate: { id, kind: 'plan-step', weight: utilityToWeight(2.2), payload: { planetId } }, run: (current, key) => {
          const result = dispatchNpcDeployment(current, { requestId: key, ownerId, originPlanetId: planetId, destinationPlanetId: plan.rallyPlanetId,
            selectedShips: counts as Partial<Record<ShipId, number>> }, at, timeScale);
          if (!result.ok) return { state: result.state, started: false, reason: result.reason, planetId };
          const latest = activeNpcPlans(result.state, ownerId).find((item) => item.planId === plan.planId) ?? plan;
          // The phase moves on in refreshNpcPlans (orders still to place stay offered meanwhile).
          return { state: replacePlan(result.state, { ...latest, sent: [...latest.sent, planetId].sort() }), started: true, reason: null, planetId };
        } });
      }
    }
    if (plan.phase === 'recheck') {
      const probe = missions.find((mission) => mission.kind === 'espionage' && mission.payload.destinationPlanetId === plan.targetPlanetId);
      if (probe) {
        const id = `plan:recon:${plan.planId}`;
        choices.push({ candidate: { id, kind: 'plan-step', weight: utilityToWeight(2), payload: { planetId: String(probe.payload.originPlanetId) } }, run: (current, key) => {
          const command = candidateToNpcMissionCommand(probe, ownerId, key);
          if (!command) return { state: current, started: false, reason: 'invalid-mission-candidate' };
          const result = dispatchNpcMission(current, command, at, timeScale);
          return { state: result.state, started: result.ok, reason: result.reason, planetId: command.originPlanetId };
        } });
      }
    }
    if (plan.phase === 'launch' && !paused) {
      const id = `plan:launch:${plan.planId}`;
      choices.push({ candidate: { id, kind: 'plan-step', weight: utilityToWeight(2.4), payload: { planetId: plan.rallyPlanetId } }, run: (current, key) => {
        const rally = current.espionage?.targets?.[plan.rallyPlanetId];
        const target = current.espionage?.targets?.[plan.targetPlanetId];
        if (!rally || !target) return { state: current, started: false, reason: 'plan-target-lost' };
        const available = getNpcMissionAvailableFleet(current, ownerId, rally.id) ?? {};
        const ships = Object.fromEntries(Object.entries(totalForce(plan)).map(([shipId, count]) => [shipId, Math.min(count, Math.floor(available[shipId as ShipId] ?? 0))])
          .filter(([, count]) => (count as number) > 0)) as Partial<Record<ShipId, number>>;
        const relation = getOwnerRelation(current, ownerId, target.ownerId);
        if (relation !== 'enemy' && relation !== 'neutral') return { state: current, started: false, reason: 'target-relation-blocked' };
        const report = latestReport(utility, plan);
        const shape = report?.fleet ? npcEnemyShape(report.targetRaceId as CombatFactionId, report.fleet) : null;
        const main = npcMainCommander(profile.traits);
        const result = dispatchNpcMission(current, {
          ownerId, originPlanetId: rally.id, requestId: key, missionId: 'attack', selectedShips: ships,
          destination: { kind: 'planet', planetId: target.id, coordinate: { ...target.coordinate } },
          targetPlanetId: target.id, targetRelation: relation,
          ...((rally.fleet.commanders?.[main] ?? 0) > 0 ? { selectedCommanders: { [main]: 1 } } : {}),
          attackPriority: npcCombatPriority(profile.traits, rally.ownerProfile?.commanderLevels ?? {}, shape, COMMANDER_IDS),
        }, at, timeScale);
        if (!result.ok || !result.flight) return { state: result.state, started: false, reason: result.reason, planetId: rally.id };
        const latest = activeNpcPlans(result.state, ownerId).find((item) => item.planId === plan.planId) ?? plan;
        return { state: replacePlan(result.state, { ...latest, phase: 'flying', launchFlightId: result.flight.id }), started: true, reason: null, planetId: rally.id };
      } });
    }
  }
  // A new plan: looked for every few game hours, never two strikes at once.
  if (plansEnabled && !active.length && !paused && at >= (state.npcStrategy?.nextCheckAt[ownerId] ?? 0)) {
    const draft = draftNpcStrike(state, profile, utility, at, timeScale);
    if (draft) {
      const id = `plan:strike:${draft.plan.targetPlanetId}`;
      choices.push({ candidate: { id, kind: 'plan-step', weight: scored(id, draft.estimate), payload: { planetId: draft.plan.rallyPlanetId } }, run: (current, key) => {
        const plan: NpcStrikePlan = { ...draft.plan, planId: `plan:${ownerId}:${key}` };
        const strategy = strategyOf(current);
        return { state: replacePlan(withStrategy(current, { ...strategy, nextCheckAt: { ...strategy.nextCheckAt,
          [ownerId]: at + Math.round(NPC_STRIKE_BALANCE.checkHours * HOUR / Math.max(1, timeScale)) } }), plan), started: true, reason: null };
      } });
    }
  }
  return choices;
}

/** Marks the owner's next plan check after a look that found or took nothing (keeps the search rare). */
export function scheduleNpcPlanCheck(state: SaveState, ownerId: string, at: number, timeScale: number): SaveState {
  if (!plansEnabled || activeNpcPlans(state, ownerId).length) return state;
  const strategy = strategyOf(state);
  if ((strategy.nextCheckAt[ownerId] ?? 0) > at) return state;
  return withStrategy(state, { ...strategy, nextCheckAt: { ...strategy.nextCheckAt, [ownerId]: at + Math.round(NPC_STRIKE_BALANCE.checkHours * HOUR / Math.max(1, timeScale)) } });
}

/** A battle of a plan's attack closes the plan with what it brought (called by the battle hook). */
export function resolveNpcPlanBattle(state: SaveState, report: BattleReport, flightId: string | undefined, at: number,
  loss: number, gain: number): SaveState {
  const ownerId = report.attacker.playerId;
  if (!flightId || !ownerId || !state.npcStrategy) return state;
  const plan = activeNpcPlans(state, ownerId).find((item) => item.phase === 'flying' && item.launchFlightId === flightId);
  if (!plan) return state;
  return closePlan(state, plan, 'done', at, undefined, { won: report.winner === 'attacker', gain, loss });
}
