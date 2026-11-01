import type { NpcAutonomyCandidate } from '../domain/npc/autonomy-policy.ts';
import type { NpcProfile } from '../domain/npc/types.ts';
import type { SpyTargetState } from '../domain/espionage/types.ts';
import type { ShipId } from '../domain/combat/ids.ts';
import { getFactionShipCatalog } from '../domain/combat/faction-catalog.ts';
import { getStorageCapacities } from '../domain/buildings/balance-v1.ts';
import { migrateBuildingLevels } from '../domain/buildings/resource-zone.ts';
import { selectAllianceRelations } from '../domain/command/diplomacy.ts';
import { selectOwnerMembership } from '../domain/command/selectors.ts';
import { listNpcVisits, npcVisitOverlap, planNpcVisitShift, withNpcVisitShift } from '../domain/npc/calendar.ts';
import { createNpcStrategyState, NPC_CLOSED_PLANS_KEPT, type NpcOutcomeStat, type NpcStrategyState } from '../domain/npc/strategy.ts';
import { npcSunPromised, type NpcSunRaidPrepPlan, type NpcSunRsvp } from '../domain/npc/sun-prep.ts';
import { utilityToWeight } from '../domain/npc/utility.ts';
import { ACTIVE_RUNTIME_MODE } from '../domain/runtime/mode.ts';
import { SUN_RAID_CONFIG, sunRaidCapsOf } from '../domain/sun-raid/config.ts';
import { checkRaidLaunch, getHolderCrystals, missingCrystals, projectSun, readSun } from '../domain/sun-raid/rules.ts';
import { WORLD_LIMITS } from '../domain/world/config.ts';
import { createSeededRandom } from '../domain/world/random.ts';
import type { SaveState } from './contracts.ts';
import { getNpcJournalSink, type NpcJournalSun } from './npc-journal.ts';
import { flightsToPlanet, ownerFlights } from './npc-knowledge-index.ts';
import { getNpcFleetProductionCandidates, startNpcFleetProduction } from './npc-fleet-production.ts';
import { dispatchNpcDeployment, npcDeploymentFreeCapacity } from './npc-missions.ts';
import { combatEfficiency, strategyOf, type NpcUtilityContext } from './npc-utility.ts';
import { npcSunAffordableForce, npcSunForce, npcSunPledgeFromPlanets } from './npc-endgame.ts';
import { activeNpcSunPrep, NPC_SUN_PREP_BALANCE, npcSunPrepOfOwner } from './npc-sun-prep-state.ts';
import { crystalHolderOf, currentSunRaidState, launchNpcSunRaid, npcSunFlightGas, sunFleetPopulation, type SunRuntimeOptions } from './sun-raid.ts';

/**
 * Plan «sun-raid-prep» (ADR stage F, scenario 7.в). The leader picks a Sun and
 * a time some hours ahead; members answer in their own visits (приду / дам не
 * более N / не смогу) from their own calendar and fleet, an invitation may
 * move a visit by up to two hours (owner decision 7), they build what is
 * missing and bring their planets' shares together by deployment. At T the
 * leader checks the promises: enough, it declares the ordinary 30-minute
 * gathering; not enough, it moves T (at most twice) or cancels with the reason.
 * The player is not told anything (owner decision 6); a player in the alliance
 * sees the gathering in «Операции» as always and may join it.
 *
 * The leader reads answers, never another owner's calendar or fleet; the Sun
 * is chosen from the public map, the public history and its own reports.
 * Numbers are the bots' judgement (owner may change them), not game rules.
 */

const HOUR = 3_600_000;
const MINUTE = 60_000;
const SUN_PREP_STAT = 'sun-raid-prep';
/** Own calendar: the leader needs this long in its visit after declaring. */
const DECLARE_AFTER_VISIT_START_MS = 2 * MINUTE;

type Outcome = { state: SaveState; started: boolean; reason: string | null; planetId?: string; economyActionId?: string };
export type NpcSunPrepChoice = { candidate: NpcAutonomyCandidate; run: (state: SaveState, key: string) => Outcome; must?: boolean };

function unit(value: number | undefined): number {
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value!)) : 0.5;
}

function sunOptions(at: number, timeScale: number): SunRuntimeOptions {
  return { now: at, mode: ACTIVE_RUNTIME_MODE, timeScale };
}

/** The gathering's length in this campaign (scaled like every timer). */
function gatherWindowMs(timeScale: number): number {
  return Math.max(1, Math.round(SUN_RAID_CONFIG.raidGatherMs / Math.max(0.01, timeScale)));
}

function journal(entry: NpcJournalSun): void {
  getNpcJournalSink()?.sun?.(entry);
}

function strategyIn(state: SaveState): NpcStrategyState {
  return state.npcStrategy ?? createNpcStrategyState();
}

function ownPlanets(state: SaveState, ownerId: string): SpyTargetState[] {
  return Object.values(state.espionage?.targets ?? {}).filter((target) => target.kind === 'npc' && target.ownerId === ownerId)
    .sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0));
}

function replacePlan(state: SaveState, plan: NpcSunRaidPrepPlan): SaveState {
  const strategy = strategyIn(state);
  const plans = strategy.plans[plan.ownerId] ?? [];
  const next = plans.some((item) => item.planId === plan.planId) ? plans.map((item) => item.planId === plan.planId ? plan : item) : [plan, ...plans];
  const active = next.filter((item) => item.status === 'active');
  const closed = next.filter((item) => item.status !== 'active')
    .sort((left, right) => (right.closedAt ?? 0) - (left.closedAt ?? 0) || (left.planId < right.planId ? -1 : 1)).slice(0, NPC_CLOSED_PLANS_KEPT);
  return { ...state, npcStrategy: { ...strategy, plans: { ...strategy.plans, [plan.ownerId]: [...active, ...closed] } } };
}

function closePlan(state: SaveState, plan: NpcSunRaidPrepPlan, status: NpcSunRaidPrepPlan['status'], at: number, reason: string | null,
  result?: NpcSunRaidPrepPlan['result']): SaveState {
  const closed: NpcSunRaidPrepPlan = { ...plan, status, closedAt: at, ...(reason ? { reason } : {}), ...(result ? { result } : {}) };
  const strategy = strategyIn(replacePlan(state, closed));
  const stats = strategy.outcomes[plan.ownerId] ?? {};
  const stat: NpcOutcomeStat = stats[SUN_PREP_STAT] ?? { n: 0, done: 0, wins: 0, cancelled: 0, sumError: 0, sumAbsError: 0, lastAt: 0 };
  const error = result ? (result.won ? 1 : 0) - plan.forecast.win : 0;
  const updated: NpcOutcomeStat = { n: stat.n + 1, done: stat.done + (status === 'done' ? 1 : 0), wins: stat.wins + (result?.won ? 1 : 0),
    cancelled: stat.cancelled + (status === 'cancelled' ? 1 : 0), sumError: stat.sumError + error, sumAbsError: stat.sumAbsError + Math.abs(error), lastAt: at };
  const nextCheckAt = status === 'cancelled' || status === 'failed'
    ? { ...strategy.nextCheckAt, [plan.ownerId]: at + NPC_SUN_PREP_BALANCE.cancelCooldownHours * HOUR } : strategy.nextCheckAt;
  journal({ at, ownerId: plan.ownerId, planId: plan.planId, step: status === 'done' ? 'done' : status === 'failed' ? 'disbanded' : 'cancelled',
    detail: { postponed: plan.postponed, promised: Math.round(npcSunPromised(plan)), ...(reason ? { reason } : {}), ...(result ? { won: result.won ? 1 : 0, crystal: result.gain } : {}) } });
  return { ...state, npcStrategy: { ...strategy, outcomes: { ...strategy.outcomes, [plan.ownerId]: { ...stats, [SUN_PREP_STAT]: updated } }, nextCheckAt } };
}

/* ------------------------------------------------------ what an owner can bring */

/**
 * Population of the owner's combat hulls at home now, on their way home by T
 * and built by T, planet by planet. When the Sun is known each planet counts
 * only what its gas can fly there: all it holds now near T (`truth`), earlier
 * what its store could hold by then (the income is still to come).
 */
function projectedForce(state: SaveState, ownerId: string, planets: readonly SpyTargetState[], gatherAt: number, at: number,
  sun?: { galaxy: number; system: number; timeScale: number; truth: boolean }): number {
  if (!planets.length) return 0;
  const raceId = planets[0]!.raceId;
  const byPlanet = new Map<string, number>();
  const add = (planetId: string, population: number) => byPlanet.set(planetId, (byPlanet.get(planetId) ?? 0) + population);
  for (const planet of planets) {
    add(planet.id, sunFleetPopulation(npcSunForce(state, ownerId, planet.id, planet.raceId, 1, Number.POSITIVE_INFINITY), planet.raceId));
    for (const order of planet.fleetProduction?.shipQueue ?? []) {
      const entity = getFactionShipCatalog(planet.raceId).find((item) => item.id === order.itemId);
      if (entity?.category !== 'Боевой корабль' || order.effectiveDurationMs <= 0) continue;
      const done = Math.floor((gatherAt - Math.max(at, order.startedAt)) / order.effectiveDurationMs);
      add(planet.id, Math.max(0, Math.min(order.quantity - order.completedQuantity, done)) * entity.population);
    }
  }
  for (const flight of ownerFlights(state.flights.records, ownerId)) {
    if (flight.ownerSide !== 'npc' || flight.sunRaid || (flight.phase !== 'outbound' && flight.phase !== 'returning' && flight.phase !== 'arrived')) continue;
    const homeAt = flight.missionId === 'deployment' ? flight.arrivalAt
      : flight.phase === 'returning' ? flight.returnAt : flight.arrivalAt + flight.oneWayDurationMs;
    if (homeAt === undefined || homeAt > gatherAt) continue;
    add(flight.missionId === 'deployment' ? flight.destinationPlanetId ?? flight.originPlanetId : flight.originPlanetId, sunFleetPopulation(flight.selectedShips as Partial<Record<ShipId, number>>, raceId));
  }
  let total = 0;
  for (const planet of planets) {
    const population = byPlanet.get(planet.id) ?? 0;
    if (population <= 0) continue;
    if (!sun) { total += population; continue; }
    // Fuel goes with the hulls: a sample of what stands here prices the rest.
    const sample = npcSunForce(state, ownerId, planet.id, planet.raceId, 1, Number.POSITIVE_INFINITY);
    const sampled = sunFleetPopulation(sample, planet.raceId);
    const options = sunOptions(at, sun.timeScale);
    const fuelPerPopulation = sampled > 0 ? npcSunFlightGas(state, ownerId, planet.id, sample, sun.galaxy, sun.system, options) / sampled : 0;
    const store = sun.truth ? planet.resources.gas : Math.max(planet.resources.gas, NPC_SUN_PREP_BALANCE.gasStoreShare * getStorageCapacities(migrateBuildingLevels(planet.buildings)).gas);
    total += fuelPerPopulation > 0 ? Math.min(population, store / fuelPerPopulation) : population;
  }
  return total;
}

/** Population already flown out of a planet on the owner's missions (counts against its production room). */
function flownPopulation(state: SaveState, ownerId: string, planet: SpyTargetState): number {
  return ownerFlights(state.flights.records, ownerId).filter((flight) => flight.ownerSide === 'npc' && flight.originPlanetId === planet.id
    && ['outbound', 'arrived', 'returning'].includes(flight.phase))
    .reduce((sum, flight) => sum + sunFleetPopulation(flight.selectedShips as Partial<Record<ShipId, number>>, planet.raceId), 0);
}

type BuildOption = { planet: SpyTargetState; itemId: string; population: number; units: number };

/** The combat hull each planet can add most with by T within its budget share, largest batch first. */
function buildOptions(state: SaveState, ownerId: string, planets: readonly SpyTargetState[], gatherAt: number, at: number, timeScale: number): BuildOption[] {
  const options: BuildOption[] = [];
  for (const planet of planets) {
    const catalog = getFactionShipCatalog(planet.raceId);
    const queueFreeAt = Math.max(at, ...(planet.fleetProduction?.shipQueue ?? []).map((order) => order.finishAt));
    let best: { option: BuildOption; score: number } | null = null;
    for (const preview of getNpcFleetProductionCandidates(planet, ownerId, at, timeScale, flownPopulation(state, ownerId, planet))) {
      if (!preview.available || preview.queueKind !== 'ships' || preview.durationMs <= 0) continue;
      const entity = catalog.find((item) => item.id === preview.itemId);
      if (entity?.category !== 'Боевой корабль' || !entity.combat || entity.population <= 0) continue;
      const byTime = Math.floor((gatherAt - queueFreeAt) / preview.durationMs);
      const byBudget = Math.min(...(['metal', 'minerals', 'gas'] as const).map((key) => preview.cost[key] > 0
        ? Math.floor(NPC_SUN_PREP_BALANCE.budgetShare * planet.resources[key] / preview.cost[key]) : Number.POSITIVE_INFINITY));
      const units = Math.min(byTime, byBudget);
      if (units <= 0 || !Number.isFinite(units)) continue;
      // The side's quorum counts population: what it can add by T, weighed lightly by strength.
      const score = units * entity.population * combatEfficiency(entity) ** 0.25;
      if (!best || score > best.score || (score === best.score && preview.itemId < best.option.itemId)) {
        best = { option: { planet, itemId: preview.itemId, population: entity.population, units }, score };
      }
    }
    if (best) options.push(best.option);
  }
  return options.sort((left, right) => right.units * right.population - left.units * left.population || (left.planet.id < right.planet.id ? -1 : 1));
}

function underAttack(state: SaveState, planets: readonly SpyTargetState[], ownerId: string, at: number): boolean {
  return planets.some((planet) => flightsToPlanet(state.flights.records, planet.id).some((flight) => flight.phase === 'outbound'
    && flight.arrivalAt > at && flight.ownerId !== ownerId && (flight.missionId === 'attack' || flight.missionId === 'pirate-raid')));
}

/** The share of its force an owner is willing to send away from home. */
function willingShare(profile: NpcProfile): number {
  return 0.7 + 0.3 * Math.max(unit(profile.traits.cooperation), unit(profile.traits.riskTolerance));
}

/** «Отзывчивость»: the chance an invitation moves a visit (owner decision 7). No trait of its own: the people-minded and attentive answer. */
export function npcResponsiveness(profile: NpcProfile): number {
  return 0.5 * unit(profile.traits.cooperation) + 0.3 * unit(profile.traits.attention) + 0.2 * unit(profile.traits.socialStyle);
}

/* --------------------------------------------------------------- the leader */

/** T within one of the leader's own visits in [fromAt, toAt], with half the gathering still ahead of it. */
export function pickNpcGatherTime(profile: NpcProfile, fromAt: number, toAt: number, windowMs: number): number | null {
  for (const visit of listNpcVisits(profile, fromAt, toAt)) {
    const gatherAt = Math.max(fromAt, visit.startAt + DECLARE_AFTER_VISIT_START_MS);
    if (gatherAt <= toAt && visit.endAt - gatherAt >= windowMs / 2) return gatherAt;
  }
  return null;
}

/**
 * The Sun worth this alliance's raid, from what the leader may know: which
 * Suns are open and bright (public), who lives under each (public map), which
 * raid failed where (public history), what its own reports saw there. It keeps
 * its own side's Suns bright (a won raid dims the Sun of whoever lives there),
 * would rather dim a rival's, fears those who would come to defend their home
 * Sun, and pays gas by distance: the flight's time is the same to any Sun.
 */
export function chooseNpcSunForRaid(state: SaveState, profile: NpcProfile, utility: Pick<NpcUtilityContext, 'latestReports'>, allianceId: string, at: number):
  { galaxy: number; system: number; score: number; win: number; knowledgeAt: number } | null {
  const sunRaid = currentSunRaidState(state);
  const caps = sunRaidCapsOf(state);
  const membership = selectOwnerMembership(state.command, profile.ownerId);
  if (!membership) return null;
  const allies = new Set((state.command.alliances.find((item) => item.id === allianceId)?.members ?? []).map((member) => member.ownerId));
  const enemies = new Set(selectAllianceRelations(state.command, allianceId).filter((relation) => relation.status === 'war').map((relation) => relation.id));
  const planets = Object.values(state.espionage?.targets ?? {});
  const leaderPlanets = planets.filter((planet) => planet.ownerId === profile.ownerId);
  if (!leaderPlanets.length) return null;
  const galaxy = leaderPlanets[0]!.coordinate.galaxy;
  const local = planets.filter((planet) => planet.coordinate.galaxy === galaxy);
  const ownSide = local.filter((planet) => allies.has(planet.ownerId));
  const caution = 1 - unit(profile.traits.riskTolerance);
  let best: { galaxy: number; system: number; score: number; win: number; knowledgeAt: number } | null = null;
  for (let system = 1; system <= WORLD_LIMITS.systemsPerGalaxy; system += 1) {
    const open = checkRaidLaunch({ state: sunRaid, allianceId, role: membership.role, galaxy, system, population: 1, now: at, participantCap: caps.participant });
    if (!open.ok) continue;
    const projection = projectSun(readSun(sunRaid, galaxy, system), at);
    const here = local.filter((planet) => planet.coordinate.system === system && !allies.has(planet.ownerId));
    const alliesHere = ownSide.filter((planet) => planet.coordinate.system === system).length;
    // Those at home under this Sun are the likeliest to answer its raid (npc-endgame «Поддержка солнца»).
    let defenders = 0;
    let knowledgeAt = 0;
    for (const planet of here) {
      const report = utility.latestReports.get(planet.id);
      if (report) {
        knowledgeAt = Math.max(knowledgeAt, report.createdAt);
        defenders += report.fleet ? sunFleetPopulation(report.fleet as Partial<Record<ShipId, number>>, report.targetRaceId as never) : 0.25 * caps.perSide;
      } else {
        defenders += 0.25 * caps.perSide; // not scouted: a guess, kept honest as a guess
      }
    }
    const threat = Math.min(2, defenders / caps.perSide);
    const rivalValue = here.filter((planet) => enemies.has(state.command.alliances.find((item) => item.members.some((member) => member.ownerId === planet.ownerId))?.id ?? '')).length;
    const failedHere = sunRaid.raids.filter((raid) => raid.galaxy === galaxy && raid.system === system && raid.result?.winner === 'defender').length;
    // Mean distance in systems: fuel grows with it, ten systems cost about 300–450 thousand gas for a 25 000 share.
    const gasDistance = ownSide.reduce((sum, planet) => sum + Math.abs(planet.coordinate.system - system), 0) / Math.max(1, ownSide.length) / 10;
    const score = 0.5 * (projection.brightness - SUN_RAID_CONFIG.frozenThreshold) / 75 + 0.3 * Math.min(2, rivalValue) + 0.1 * Math.min(2, here.length - rivalValue > 0 ? 1 : 0)
      - 0.8 * alliesHere - (0.8 + caution) * threat - 0.5 * failedHere - 0.5 * gasDistance;
    if (!best || score > best.score) best = { galaxy, system, score, win: 1 / (1 + threat ** 2.5), knowledgeAt };
  }
  return best;
}

function createPlan(state: SaveState, profile: NpcProfile, utility: NpcUtilityContext, allianceId: string, at: number, timeScale: number): NpcSunRaidPrepPlan | null {
  const gatherAt = pickNpcGatherTime(profile, at + NPC_SUN_PREP_BALANCE.minLeadHours * HOUR, at + NPC_SUN_PREP_BALANCE.maxLeadHours * HOUR, gatherWindowMs(timeScale));
  if (gatherAt === null) return null;
  const sun = chooseNpcSunForRaid(state, profile, utility, allianceId, at);
  if (!sun) return null;
  return {
    planId: `plan:${profile.ownerId}:sun:${at}`, template: 'sun-raid-prep', ownerId: profile.ownerId, allianceId, status: 'active', phase: 'invite',
    createdAt: at, deadlineAt: gatherAt, galaxy: sun.galaxy, system: sun.system, gatherAt, postponed: 0, rsvps: {},
    forecast: { win: Math.round(sun.win * 1000) / 1000, gain: 0, loss: 0, readyAt: gatherAt }, knowledgeAt: sun.knowledgeAt,
  };
}

function postpone(state: SaveState, plan: NpcSunRaidPrepPlan, profile: NpcProfile, at: number, timeScale: number, why: string): SaveState {
  if (plan.postponed >= NPC_SUN_PREP_BALANCE.maxPostpones) return closePlan(state, plan, 'cancelled', at, why);
  const gatherAt = pickNpcGatherTime(profile, Math.max(at + NPC_SUN_PREP_BALANCE.postponeLeadHours * HOUR, plan.gatherAt + HOUR),
    at + NPC_SUN_PREP_BALANCE.maxLeadHours * HOUR, gatherWindowMs(timeScale));
  if (gatherAt === null) return closePlan(state, plan, 'cancelled', at, why);
  journal({ at, ownerId: plan.ownerId, planId: plan.planId, step: 'postponed', detail: { reason: why, gatherAt, promised: Math.round(npcSunPromised(plan)) } });
  return replacePlan(state, { ...plan, phase: 'invite', gatherAt, deadlineAt: gatherAt, postponed: plan.postponed + 1, rsvps: {},
    forecast: { ...plan.forecast, readyAt: gatherAt } });
}

/** What the leader sees of its own plan at a look: the raid's news, the Sun's state, the promises. */
function advanceOwnPlan(state: SaveState, plan: NpcSunRaidPrepPlan, profile: NpcProfile, utility: NpcUtilityContext, at: number, timeScale: number): SaveState {
  const sunRaid = currentSunRaidState(state);
  const membership = selectOwnerMembership(state.command, plan.ownerId);
  if (plan.raidId) {
    const raid = sunRaid.raids.find((item) => item.id === plan.raidId);
    if (!raid) return closePlan(state, plan, 'done', at, null);
    if (raid.status === 'disbanded') return closePlan(state, plan, 'failed', raid.closedAt ?? at, 'gather-failed');
    if (raid.status === 'resolved') {
      const won = raid.result?.winner === 'attacker';
      return closePlan(state, plan, 'done', at, null, { won, gain: raid.result?.crystalRoll?.success ? 1 : 0, loss: 0 });
    }
    if (raid.status === 'incoming' && plan.phase !== 'flying') {
      journal({ at, ownerId: plan.ownerId, planId: plan.planId, step: 'flying', detail: { raidId: raid.id } });
      return replacePlan(state, { ...plan, phase: 'flying' });
    }
    return state;
  }
  if (sunRaid.campaignResult) return closePlan(state, plan, 'cancelled', at, 'campaign-over');
  if (!membership || membership.alliance.id !== plan.allianceId || (membership.role !== 'leader' && membership.role !== 'deputy')) {
    return closePlan(state, plan, 'cancelled', at, 'leader-lost');
  }
  const { holder } = crystalHolderOf(state, plan.ownerId);
  if (!missingCrystals(getHolderCrystals(sunRaid, holder)).length) return closePlan(state, plan, 'cancelled', at, 'have-all-crystals');
  const caps = sunRaidCapsOf(state);
  const open = checkRaidLaunch({ state: sunRaid, allianceId: plan.allianceId, role: membership.role, galaxy: plan.galaxy, system: plan.system, population: 1, now: at, participantCap: caps.participant });
  let current = plan;
  if (!open.ok) {
    if (open.code === 'raid-active') return closePlan(state, plan, 'cancelled', at, 'raid-active');
    // Someone else took the Sun, or it froze: the leader names another; T stays.
    const sun = chooseNpcSunForRaid(state, profile, utility, plan.allianceId, at);
    if (!sun) return closePlan(state, plan, 'cancelled', at, open.code);
    journal({ at, ownerId: plan.ownerId, planId: plan.planId, step: 'retarget', detail: { from: plan.system, to: sun.system, reason: open.code } });
    current = { ...plan, galaxy: sun.galaxy, system: sun.system, forecast: { ...plan.forecast, win: Math.round(sun.win * 1000) / 1000 }, knowledgeAt: sun.knowledgeAt };
  }
  if (at > current.gatherAt + gatherWindowMs(timeScale)) return postpone(state, current, profile, at, timeScale, 'leader-late');
  if (at < current.gatherAt - NPC_SUN_PREP_BALANCE.recheckLeadMinutes * MINUTE) return current === plan ? state : replacePlan(state, current);
  const members = new Set((state.command.alliances.find((item) => item.id === current.allianceId)?.members ?? []).map((member) => member.ownerId));
  const promised = Object.entries(current.rsvps).reduce((sum, [ownerId, rsvp]) => sum + (members.has(ownerId) ? rsvp.population : 0), 0);
  const enough = promised >= caps.perSide - SUN_RAID_CONFIG.raidLaunchTolerance && (current.rsvps[current.ownerId]?.population ?? 0) > 0;
  if (at < current.gatherAt) {
    // The recheck ahead of T: more answers may still come, so a shortage only decides at T.
    if (enough && current.phase === 'invite') {
      journal({ at, ownerId: current.ownerId, planId: current.planId, step: 'ready', detail: { promised: Math.round(promised) } });
      return replacePlan(state, { ...current, phase: 'ready' });
    }
    return current === plan ? state : replacePlan(state, current);
  }
  if (!enough) return postpone(state, current, profile, at, timeScale, 'not-enough-force');
  if (current.phase === 'invite') {
    journal({ at, ownerId: current.ownerId, planId: current.planId, step: 'ready', detail: { promised: Math.round(promised) } });
    current = { ...current, phase: 'ready' };
  }
  return current === plan ? state : replacePlan(state, current);
}

/* --------------------------------------------------------------- the members */

function answerInvitation(state: SaveState, profile: NpcProfile, plan: NpcSunRaidPrepPlan, at: number, timeScale: number): SaveState {
  const ownerId = profile.ownerId;
  const windowMs = gatherWindowMs(timeScale);
  const overlap = windowMs / 2;
  const planets = ownPlanets(state, ownerId);
  const caps = sunRaidCapsOf(state);
  const answer = (rsvp: Omit<NpcSunRsvp, 'at'>, next: SaveState = state): SaveState => {
    journal({ at, ownerId, planId: plan.planId, step: 'rsvp', detail: { answer: rsvp.answer, population: Math.round(rsvp.population), ...(rsvp.reason ? { reason: rsvp.reason } : {}) } });
    return replacePlan(next, { ...plan, rsvps: { ...plan.rsvps, [ownerId]: { ...rsvp, at } } });
  };
  if (underAttack(state, planets, ownerId, at) && unit(profile.traits.riskTolerance) < 0.5) return answer({ answer: 'no', population: 0, reason: 'threat' });
  const force = projectedForce(state, ownerId, planets, plan.gatherAt, at, { galaxy: plan.galaxy, system: plan.system, timeScale, truth: false });
  const buildable = force >= caps.participant ? 0 : buildOptions(state, ownerId, planets, plan.gatherAt, at, timeScale)
    .reduce((sum, option) => sum + option.units * option.population, 0);
  const promise = Math.floor(Math.min(caps.participant, (force + buildable) * willingShare(profile)));
  if (promise < NPC_SUN_PREP_BALANCE.minPromiseShare * caps.participant) return answer({ answer: 'no', population: 0, reason: 'no-fleet' });
  // Its own calendar: is it at the game then? If not, it may move the nearest visit (owner decision 7).
  let next = state;
  const online = listNpcVisits(profile, plan.gatherAt, plan.gatherAt + windowMs).some((visit) => npcVisitOverlap(visit, plan.gatherAt, plan.gatherAt + windowMs) >= overlap);
  if (!online) {
    const shift = planNpcVisitShift(profile, plan.gatherAt, plan.gatherAt + windowMs, overlap, at);
    const willing = createSeededRandom(JSON.stringify(['npc-sun-visit', profile.privateSeed, plan.planId, plan.gatherAt]))() < npcResponsiveness(profile);
    if (!shift || !willing) return answer({ answer: 'no', population: 0, reason: 'away' });
    const current = state.npc!.profiles[ownerId]!;
    next = { ...state, npc: { ...state.npc!, profiles: { ...state.npc!.profiles, [ownerId]: { ...current, session: withNpcVisitShift(current.session, shift, at) } } } };
    journal({ at, ownerId, planId: plan.planId, step: 'shift', detail: { deltaMinutes: Math.round(shift.deltaMs / MINUTE) } });
  }
  return answer(promise >= caps.participant ? { answer: 'yes', population: promise } : { answer: 'limit', population: promise, reason: 'caution' }, next);
}

/**
 * A member keeps its word honest: a bigger fleet raises the promise; near T it
 * promises only what really stands by then, so the leader's recheck sees the
 * truth of the losses and of the orders that will not finish in time.
 */
function refreshPromise(state: SaveState, profile: NpcProfile, plan: NpcSunRaidPrepPlan, rsvp: NpcSunRsvp, at: number, timeScale: number): SaveState {
  if (rsvp.reason === 'away' || rsvp.pledged !== undefined || at >= plan.gatherAt) return state;
  const caps = sunRaidCapsOf(state);
  const planets = ownPlanets(state, profile.ownerId);
  const truth = at >= plan.gatherAt - NPC_SUN_PREP_BALANCE.recheckLeadMinutes * MINUTE;
  const willing = Math.floor(Math.min(caps.participant, projectedForce(state, profile.ownerId, planets, plan.gatherAt, at, { galaxy: plan.galaxy, system: plan.system, timeScale, truth }) * willingShare(profile)));
  const population = truth ? willing : Math.max(rsvp.population, willing);
  if (Math.abs(population - rsvp.population) < 0.01 * caps.participant) return state;
  const minimum = NPC_SUN_PREP_BALANCE.minPromiseShare * caps.participant;
  const updated: NpcSunRsvp = population < minimum ? { ...rsvp, answer: 'no', population: 0, reason: 'no-fleet', at }
    : population >= caps.participant ? { ...rsvp, answer: 'yes', population, reason: undefined, at } : { ...rsvp, answer: 'limit', population, reason: 'caution', at };
  const { reason, ...rest } = updated;
  return replacePlan(state, { ...plan, rsvps: { ...plan.rsvps, [profile.ownerId]: reason ? { ...rest, reason } : rest } });
}

/** The owner's plan moves on by what it sees now: called at the start of each look. */
export function refreshNpcSunPrep(state: SaveState, profile: NpcProfile, utility: NpcUtilityContext, at: number, timeScale: number): SaveState {
  if (!state.npcStrategy) return state;
  const entry = npcSunPrepOfOwner(state, profile.ownerId);
  let next = state;
  if (entry?.rsvp) next = refreshPromise(next, profile, entry.plan, entry.rsvp, at, timeScale);
  // The alliance's call is read first: the answer holds its ships before this look plans anything else.
  else if (entry && (entry.plan.phase === 'invite' || entry.plan.phase === 'ready') && at < entry.plan.gatherAt) {
    next = answerInvitation(next, profile, entry.plan, at, timeScale);
  }
  // A plan of its own may outlive its alliance or its role: it is the owner's to close.
  const own = next.npcStrategy!.plans[profile.ownerId]?.find((plan) => plan.status === 'active');
  return own ? advanceOwnPlan(next, own, profile, utility, at, timeScale) : next;
}

/** Whether the leader thinks about a new plan at this look; it writes the next time (once a look at most). */
export function scheduleNpcSunPrepCheck(state: SaveState, ownerId: string, at: number): SaveState {
  const role = selectOwnerMembership(state.command, ownerId)?.role;
  if (role !== 'leader' && role !== 'deputy') return state;
  const strategy = strategyIn(state);
  if ((strategy.nextCheckAt[ownerId] ?? 0) > at) return state;
  return { ...state, npcStrategy: { ...strategy, nextCheckAt: { ...strategy.nextCheckAt, [ownerId]: at + NPC_SUN_PREP_BALANCE.checkHours * HOUR } } };
}

/* ------------------------------------------------------------------- choices */

function declareChoice(profile: NpcProfile, plan: NpcSunRaidPrepPlan, at: number, timeScale: number): NpcSunPrepChoice {
  const ownerId = profile.ownerId;
  const id = `sun-prep:declare:${plan.planId}`;
  return { must: true, candidate: { id, kind: 'plan-step', weight: utilityToWeight(3), payload: { planId: plan.planId } }, run: (current, key) => {
    const planets = ownPlanets(current, ownerId);
    const caps = sunRaidCapsOf(current);
    const own = current.npcStrategy!.plans[ownerId]!.find((item) => item.planId === plan.planId)!;
    const limit = own.rsvps[ownerId]?.answer === 'limit' ? own.rsvps[ownerId]!.population : caps.participant;
    const options = sunOptions(at, timeScale);
    const forces = planets.map((planet) => ({ planet, ships: npcSunAffordableForce(current, ownerId, planet.id, npcSunForce(current, ownerId, planet.id, planet.raceId, 1, Math.min(limit, caps.participant)), own.galaxy, own.system, options) }))
      .map((item) => ({ ...item, population: sunFleetPopulation(item.ships, item.planet.raceId) }))
      .sort((left, right) => right.population - left.population || (left.planet.id < right.planet.id ? -1 : 1));
    const origin = forces[0];
    if (!origin || origin.population <= 0) return { state: postpone(current, own, profile, at, timeScale, 'leader-no-fleet'), started: false, reason: 'no-ships' };
    const launched = launchNpcSunRaid(current, ownerId, { galaxy: own.galaxy, system: own.system, originPlanetId: origin.planet.id, ships: origin.ships, requestId: key }, options);
    if (!launched.ok || !launched.raidId) return { state: current, started: false, reason: launched.ok ? 'no-raid' : launched.error, planetId: origin.planet.id };
    const topped = npcSunPledgeFromPlanets(launched.state, ownerId, launched.raidId, 1, key, options, limit - origin.population);
    const pledged = origin.population + topped.pledged;
    journal({ at, ownerId, planId: own.planId, step: 'declared', detail: { raidId: launched.raidId, system: own.system, pledged: Math.round(pledged), promised: Math.round(npcSunPromised(own)) } });
    const rsvp: NpcSunRsvp = { ...(own.rsvps[ownerId] ?? { answer: 'yes', population: pledged, at }), pledged };
    return { state: replacePlan(topped.state, { ...own, phase: 'gathering', raidId: launched.raidId, rsvps: { ...own.rsvps, [ownerId]: rsvp } }),
      started: true, reason: null, planetId: origin.planet.id };
  } };
}

function joinChoice(ownerId: string, plan: NpcSunRaidPrepPlan, rsvp: NpcSunRsvp, at: number, timeScale: number): NpcSunPrepChoice {
  const id = `sun-prep:join:${plan.planId}:${ownerId}`;
  return { must: true, candidate: { id, kind: 'plan-step', weight: utilityToWeight(3), payload: { planId: plan.planId } }, run: (current, key) => {
    const limit = rsvp.answer === 'limit' ? rsvp.population : sunRaidCapsOf(current).participant;
    const result = npcSunPledgeFromPlanets(current, ownerId, plan.raidId!, 1, key, sunOptions(at, timeScale), limit);
    if (result.pledged <= 0) return { state: current, started: false, reason: 'nothing-to-pledge' };
    journal({ at, ownerId, planId: plan.planId, step: 'pledged', detail: { promised: Math.round(rsvp.population), pledged: Math.round(result.pledged) } });
    const fresh = activeNpcSunPrep(result.state, plan.allianceId) ?? plan;
    return { state: replacePlan(result.state, { ...fresh, rsvps: { ...fresh.rsvps, [ownerId]: { ...(fresh.rsvps[ownerId] ?? rsvp), pledged: result.pledged } } }), started: true, reason: null };
  } };
}

/** Orders that close the gap to the promise, one planet per look. */
function orderChoice(state: SaveState, ownerId: string, plan: NpcSunRaidPrepPlan, rsvp: NpcSunRsvp, planets: readonly SpyTargetState[], at: number, timeScale: number): NpcSunPrepChoice | null {
  if ((rsvp.orders ?? 0) >= NPC_SUN_PREP_BALANCE.maxOrders) return null;
  const gap = rsvp.population - projectedForce(state, ownerId, planets, plan.gatherAt, at);
  if (gap <= 0) return null;
  const option = buildOptions(state, ownerId, planets, plan.gatherAt, at, timeScale)[0];
  if (!option) return null;
  const id = `sun-prep:order:${plan.planId}:${option.planet.id}`;
  const quantity = Math.min(option.units, Math.ceil(gap / option.population));
  return { must: true, candidate: { id, kind: 'plan-step', weight: utilityToWeight(2.5), payload: { planId: plan.planId, planetId: option.planet.id, itemId: option.itemId } }, run: (current, key) => {
    const planet = current.espionage!.targets![option.planet.id]!;
    const flown = flownPopulation(current, ownerId, planet);
    let batch = quantity;
    let result = startNpcFleetProduction(planet, ownerId, 'ships', option.itemId, at, timeScale, key, flown, batch);
    while (!result.ok && batch > 1) {
      batch = Math.floor(batch / 2);
      result = startNpcFleetProduction(planet, ownerId, 'ships', option.itemId, at, timeScale, key, flown, batch);
    }
    const placed: SaveState = { ...current, espionage: { ...current.espionage!, targets: { ...current.espionage!.targets, [planet.id]: result.target } } };
    const fresh = activeNpcSunPrep(placed, plan.allianceId) ?? plan;
    const own = fresh.rsvps[ownerId] ?? rsvp;
    return { state: replacePlan(placed, { ...fresh, rsvps: { ...fresh.rsvps, [ownerId]: { ...own, orders: (own.orders ?? 0) + 1 } } }),
      started: result.ok, reason: result.reason, planetId: planet.id, ...(result.ok && result.orderId ? { economyActionId: result.orderId } : {}) };
  } };
}

/** The planet's share flies to the member's point of departure, when it lands before T and fits its hangar. */
function rallyChoices(state: SaveState, ownerId: string, plan: NpcSunRaidPrepPlan, rsvp: NpcSunRsvp, planets: readonly SpyTargetState[], at: number, timeScale: number): NpcSunPrepChoice[] {
  if (planets.length < 2 || at >= plan.gatherAt || at < plan.gatherAt - NPC_SUN_PREP_BALANCE.rallyLeadHours * HOUR) return [];
  if (underAttack(state, planets, ownerId, at)) return [];
  const forces = planets.map((planet) => ({ planet, ships: npcSunForce(state, ownerId, planet.id, planet.raceId, 1, Number.POSITIVE_INFINITY) }))
    .map((item) => ({ ...item, population: sunFleetPopulation(item.ships, item.planet.raceId) }));
  const rally = (rsvp.rallyPlanetId ? forces.find((item) => item.planet.id === rsvp.rallyPlanetId) : undefined)
    ?? [...forces].sort((left, right) => right.population - left.population || (left.planet.id < right.planet.id ? -1 : 1))[0];
  if (!rally || rally.population >= rsvp.population) return [];
  const inbound = ownerFlights(state.flights.records, ownerId).filter((flight) => flight.ownerSide === 'npc' && flight.missionId === 'deployment'
    && flight.destinationPlanetId === rally.planet.id && flight.phase === 'outbound')
    .reduce((sum, flight) => sum + sunFleetPopulation(flight.selectedShips as Partial<Record<ShipId, number>>, rally.planet.raceId), 0);
  const room = npcDeploymentFreeCapacity(rally.planet) - inbound;
  const choices: NpcSunPrepChoice[] = [];
  for (const source of forces) {
    if (source.planet.id === rally.planet.id) continue;
    // What fits the hangar there; the rest pledges from where it stands.
    const ships = npcSunForce(state, ownerId, source.planet.id, source.planet.raceId, 1, Math.max(0, room));
    const population = sunFleetPopulation(ships, source.planet.raceId);
    if (population < NPC_SUN_PREP_BALANCE.rallyMinShare * rsvp.population) continue;
    // A dry run of the real command gives the arrival time and every launch check.
    const trial = dispatchNpcDeployment(state, { requestId: `npc-sun-prep-trial:${source.planet.id}`, ownerId, originPlanetId: source.planet.id,
      destinationPlanetId: rally.planet.id, selectedShips: ships }, at, timeScale);
    if (!trial.ok || !trial.flight || trial.flight.arrivalAt > plan.gatherAt) continue;
    const id = `sun-prep:rally:${plan.planId}:${source.planet.id}`;
    choices.push({ must: true, candidate: { id, kind: 'plan-step', weight: utilityToWeight(2.5), payload: { planetId: source.planet.id } }, run: (current, key) => {
      const sent = dispatchNpcDeployment(current, { requestId: key, ownerId, originPlanetId: source.planet.id, destinationPlanetId: rally.planet.id, selectedShips: ships }, at, timeScale);
      if (!sent.ok) return { state: sent.state, started: false, reason: sent.reason, planetId: source.planet.id };
      const fresh = activeNpcSunPrep(sent.state, plan.allianceId) ?? plan;
      journal({ at, ownerId, planId: plan.planId, step: 'rally', detail: { population: Math.round(population), from: source.planet.id, to: rally.planet.id } });
      return { state: replacePlan(sent.state, { ...fresh, rsvps: { ...fresh.rsvps, [ownerId]: { ...(fresh.rsvps[ownerId] ?? rsvp), rallyPlanetId: rally.planet.id } } }),
        started: true, reason: null, planetId: source.planet.id };
    } });
    break; // one wave per look: the next look sees the new room
  }
  return choices;
}

/**
 * The plan's steps for this look. The plan is a promise: what is due goes
 * first (`must`), ahead of the look's ordinary draw. A new plan is an ordinary
 * choice of the leader, weighed like the raid it replaces.
 */
export function getNpcSunPrepChoices(state: SaveState, profile: NpcProfile, utility: NpcUtilityContext, at: number, timeScale: number,
  scored: (candidateId: string, estimate: number) => number): NpcSunPrepChoice[] {
  const ownerId = profile.ownerId;
  const membership = selectOwnerMembership(state.command, ownerId);
  if (!membership) return [];
  const plan = activeNpcSunPrep(state, membership.alliance.id);
  const planets = ownPlanets(state, ownerId);
  if (!plan) {
    if ((membership.role !== 'leader' && membership.role !== 'deputy') || (state.npcStrategy?.nextCheckAt[ownerId] ?? 0) > at) return [];
    const sunRaid = currentSunRaidState(state);
    if (sunRaid.campaignResult) return [];
    const missing = missingCrystals(getHolderCrystals(sunRaid, crystalHolderOf(state, ownerId).holder)).length;
    if (!missing || sunRaid.raids.some((raid) => raid.allianceId === membership.alliance.id && raid.closedAt === undefined)) return [];
    const caps = sunRaidCapsOf(state);
    const alliance = state.command.alliances.find((item) => item.id === membership.alliance.id);
    const members = (alliance?.members ?? []).map((member) => member.ownerId).filter((id) => state.npc?.profiles[id]);
    if (members.length < Math.ceil(caps.perSide / caps.participant)) return [];
    const ownForce = Math.min(caps.participant, projectedForce(state, ownerId, planets, at, at));
    if (ownForce < NPC_SUN_PREP_BALANCE.minPromiseShare * caps.participant) return [];
    // It judges the alliance by itself: other owners' fleets are not its to read, and answers will tell.
    if (ownForce * members.length < NPC_SUN_PREP_BALANCE.selfJudgeShare * caps.perSide) return [];
    const draft = createPlan(state, profile, utility, membership.alliance.id, at, timeScale);
    if (!draft) return [];
    const drives = strategyOf(utility);
    const id = `sun-prep:new:${ownerId}`;
    const estimate = 0.4 + 0.9 * drives.operations + 0.7 * drives.war + 0.3 * (4 - missing) / 4 + 0.3 * (unit(profile.traits.riskTolerance) - 0.5) + 0.3 * unit(profile.traits.planningHorizon);
    return [{ candidate: { id, kind: 'endgame', weight: scored(id, estimate), payload: { planId: draft.planId } }, run: (current) => {
      if (activeNpcSunPrep(current, draft.allianceId)) return { state: current, started: false, reason: 'plan-active' };
      journal({ at, ownerId, planId: draft.planId, step: 'created', detail: { system: draft.system, gatherAt: draft.gatherAt, win: draft.forecast.win } });
      // The leader answers its own call at once: its ships are held from here on.
      return { state: answerInvitation(replacePlan(current, draft), current.npc?.profiles[ownerId] ?? profile, draft, at, timeScale), started: true, reason: null };
    } }];
  }
  const choices: NpcSunPrepChoice[] = [];
  const rsvp = plan.rsvps[ownerId];
  if (plan.ownerId === ownerId && plan.phase === 'ready' && at >= plan.gatherAt) choices.push(declareChoice(profile, plan, at, timeScale));
  if (plan.phase === 'gathering' && plan.raidId && rsvp && rsvp.population > 0 && rsvp.pledged === undefined && plan.ownerId !== ownerId) {
    const raid = currentSunRaidState(state).raids.find((item) => item.id === plan.raidId);
    if (raid?.status === 'gathering' && (raid.gatherEndsAt ?? 0) > at) choices.push(joinChoice(ownerId, plan, rsvp, at, timeScale));
  }
  if (rsvp && rsvp.population > 0 && rsvp.pledged === undefined && (plan.phase === 'invite' || plan.phase === 'ready') && at < plan.gatherAt) {
    const order = orderChoice(state, ownerId, plan, rsvp, planets, at, timeScale);
    if (order) choices.push(order);
    choices.push(...rallyChoices(state, ownerId, plan, rsvp, planets, at, timeScale));
  }
  return choices;
}

