import { selectOwnerMembership } from '../domain/command/selectors.ts';
import { maxRequestAmount } from '../domain/command/aid.ts';
import { getStorageCapacities } from '../domain/buildings/balance-v1.ts';
import type { ShipId } from '../domain/combat/ids.ts';
import { getFactionShipCatalog } from '../domain/combat/faction-catalog.ts';
import type { SpyReportSnapshot, SpyTargetState } from '../domain/espionage/types.ts';
import { listNpcVisits, npcVisitOverlap, planNpcVisitShift, withNpcVisitShift } from '../domain/npc/calendar.ts';
import {
  NPC_GIFTS_KEPT, type NpcGiftProposal, type NpcJointStrikeProposal, type NpcRobberyReactionKind,
} from '../domain/npc/pacts.ts';
import { createNpcStrategyState, type NpcPlanOrder, type NpcStrikePlan } from '../domain/npc/strategy.ts';
import type { NpcProfile } from '../domain/npc/types.ts';
import { estimateWinProbability, utilityToWeight } from '../domain/npc/utility.ts';
import { selectOwnerScore } from '../domain/rating/scoring.ts';
import { createSeededRandom } from '../domain/world/random.ts';
import { evaluatePlanetAttackEligibility } from './attack-eligibility.ts';
import type { SaveState } from './contracts.ts';
import { getNpcJournalSink } from './npc-journal.ts';
import { getNpcFleetProductionCandidates } from './npc-fleet-production.ts';
import { dispatchNpcMission, dispatchNpcTransport, getNpcMissionAvailableFleet, npcDeploymentFreeCapacity } from './npc-missions.ts';
import { candidateToNpcMissionCommand, type NpcMissionCandidate } from './npc-mission-policy.ts';
import {
  isNpcPactOpen, journalNpcPact, npcFleetFlightMs, npcPartnerPowerBelief, npcProposalsOf, npcReactionOf, NPC_GIFT_REQUEST_PREFIX, settleNpcPact, withNpcPact,
} from './npc-pact-state.ts';
import { activeNpcPlans } from './npc-plan-reserve.ts';
import {
  combatShipsOf, fleetPopulationOf, flownPopulation, freeCombatShips, npcBelievedPower, npcWantedWin, ownerUnderAttack, replaceNpcPlan, type NpcPlanChoice,
} from './npc-plans.ts';
import { battleLoot, isGrievanceBattle } from './npc-grudges.ts';
import { battleReportTime } from './history-retention.ts';
import { ownerBattleReports } from './npc-knowledge-index.ts';
import { npcRelationView } from './npc-relations.ts';
import { getOwnerRelation } from './owner-relations.ts';
import { npcResponsiveness } from './npc-sun-prep.ts';
import { combatEfficiency, npcFleetValue, npcForcePower, npcRevengeIntensity, type NpcUtilityContext } from './npc-utility.ts';

/**
 * Two owners outside any alliance agree on something (NPC intelligence ADR §7.б,
 * owner decisions 4, 5, 7, 9, 10). Each decides in its own session from what it
 * knows itself: the proposer never hands over its report, the partner never sees
 * a launch, and either may honestly refuse. An agreement is decided anew every
 * time: old friendship tilts the answer, it does not give it.
 *
 * Time here is real hours: the owners' visits do not speed up with the campaign.
 * Numbers are the bots' judgement (owner may change them), not game rules.
 */
export const NPC_PACT_BALANCE = Object.freeze({
  /** Real hours between an owner's looks for a partner, and for a friend's help. */
  checkHours: 4,
  giftCheckHours: 6,
  /** The proposer sets the strike this far ahead, and waits this long for the answer. */
  minLeadHours: 3,
  maxLeadHours: 30,
  answerHours: 6,
  /** Partners agree on a time only roughly; the second wave comes this much after the first. */
  toleranceMinutes: 60,
  waveGapMinutes: 20,
  /** An owner this short of a reason to cooperate (character + best friend) keeps to itself. */
  minProposeDrive: 0.55,
  /** An unfamiliar neighbour is asked only by a sociable owner. */
  strangerCooperation: 0.6,
  neighbourSystems: 5,
  /** Below this regard a partner is out of the question; above this a target is off limits as a friend. */
  distrustRegard: -0.1,
  friendRegard: 0.3,
  /** The answer: score plus a seeded doubt must clear this. */
  acceptScore: 0.15,
  answerDoubt: 0.15,
  /** A partnership that just ran must be wanted again later, and every repeat asks for more reason (no eternal duets). */
  pairCooldownHours: 36,
  repeatPenalty: 0.08,
  /** A refused asker does not ask the same owner again soon. */
  declineCooldownHours: 12,
  /** Bounds against a pile-on: joint strikes running in the world, on one target and on the player. */
  worldActive: 16,
  targetCooldownHours: 24,
  playerCooldownHours: 48,
  /** The player is a target of a joint strike only at about the proposer's size or more. */
  playerPointsShare: 0.8,
  /** No ganging up on the small. */
  targetPointsShare: 0.5,
  /** Share of a planet's stores a joint plan may spend on its ships. */
  budgetShare: 0.6,
  /** Share of free transports the second wave brings along to carry the haul. */
  holdsShare: 0.5,
  /** A report older than this (game hours) is no ground for a joint strike. */
  reportHours: 12,
  /** With this little time left to answer, an owner without news refuses rather than waits (real hours). */
  reconAnswerHours: 1,
  /** Betrayal needs this appetite: aggression × (1 − cooperation). */
  betrayalAppetite: 0.45,
  /** What a friend gives in a day as a share of its income; a store emptier than this is a need. */
  giftBudgetDayShare: 0.25,
  giftNeedFill: 0.15,
  /** What the sender keeps of a resource it gives from. */
  giftKeepShare: 0.5,
  /** Whoever got a gift sends none for this long, whoever sent one asks for none: no chain can close. */
  giftGuardHours: 48,
  giftAskDayShare: 0.5,
  giftMinDayShare: 0.05,
  giftFriendRegard: 0.25,
  /** Robbed this many times in two days, it thinks about what to do; the decision holds this long before it is thought over. */
  reactionRobberies: 4,
  reactionHours: 24,
  reactionDoubt: 0.25,
});

const HOUR = 3_600_000;
const MINUTE = 60_000;
const ROLE_HULLS = ['bomber', 'destroyer'] as const;

const unit = (value: number) => Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));
const points = (state: SaveState, ownerId: string) => selectOwnerScore(state, ownerId)?.totalPoints ?? 0;
const planetsOf = (utility: NpcUtilityContext) => [...utility.ownPlanets].sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0));
const stockOf = (resources: SpyReportSnapshot['resources']) => (resources?.metal ?? 0) + (resources?.minerals ?? 0) + (resources?.gas ?? 0);

/** Same alliance: the alliance's own channels serve them (aid, Sun), under their own limits. */
function sameAlliance(state: SaveState, left: string, right: string): boolean {
  const own = selectOwnerMembership(state.command, left);
  return Boolean(own && selectOwnerMembership(state.command, right)?.alliance.id === own.alliance.id);
}

/* ------------------------------------------------------------ anti pile-on */

/** May this target still be struck jointly? Bounds the world's joint attention on any one owner, above all the player. */
export function npcJointTargetAllowed(state: SaveState, ownerId: string, targetOwnerId: string, at: number): boolean {
  const isPlayer = targetOwnerId === state.profile.playerId;
  const share = isPlayer ? NPC_PACT_BALANCE.playerPointsShare : NPC_PACT_BALANCE.targetPointsShare;
  if (points(state, targetOwnerId) < share * points(state, ownerId)) return false;
  const pause = (isPlayer ? NPC_PACT_BALANCE.playerCooldownHours : NPC_PACT_BALANCE.targetCooldownHours) * HOUR;
  return !(state.npcStrategy?.proposals ?? []).some((proposal) => proposal.kind === 'joint-strike' && proposal.terms.targetOwnerId === targetOwnerId
    && (isNpcPactOpen(proposal.status) || (proposal.status !== 'declined' && proposal.status !== 'expired' && at - proposal.createdAt < pause)));
}

/** Two owners that just ran an operation together, or one that has just said no, need time before asking again. */
function pairResting(state: SaveState, from: string, to: string, at: number): boolean {
  return (state.npcStrategy?.proposals ?? []).some((proposal) => {
    const same = (proposal.from === from && proposal.to === to) || (proposal.from === to && proposal.to === from);
    if (!same || proposal.kind !== 'joint-strike') return false;
    if (isNpcPactOpen(proposal.status)) return true;
    return at - proposal.createdAt < (proposal.status === 'declined' || proposal.status === 'expired' ? NPC_PACT_BALANCE.declineCooldownHours : NPC_PACT_BALANCE.pairCooldownHours) * HOUR;
  });
}

/** An attack on a partner is off the table unless this owner is the kind to betray. */
export function npcPactForbidsAttack(profile: NpcProfile, partners: ReadonlySet<string> | undefined, targetOwnerId: string): boolean {
  if (!partners?.has(targetOwnerId)) return false;
  return unit(profile.traits.aggression) * (1 - unit(profile.traits.cooperation)) < NPC_PACT_BALANCE.betrayalAppetite;
}

/* ----------------------------------------------------------- the force plan */

type ForcePlan = { reserve: Record<string, Record<string, number>>; orders: NpcPlanOrder[]; power: number; readyAt: number };

/**
 * What the owner could bring by `by`: its free combat ships, and new ones within
 * the budget, of the hull its role prefers when it can build that (T-SOC-02: a
 * role never overrides the race, the sciences or the shipyard). Stops at `needed`.
 */
function jointForcePlan(state: SaveState, utility: NpcUtilityContext, at: number, timeScale: number, hullWanted: string, by: number, needed: number, wave: 1 | 2 = 1): ForcePlan | null {
  const ownerId = utility.profile.ownerId;
  const planets = planetsOf(utility);
  if (!planets.length) return null;
  const raceId = planets[0]!.raceId;
  const catalog = getFactionShipCatalog(raceId);
  const combat = combatShipsOf(catalog);
  const reserve: Record<string, Record<string, number>> = {};
  const total: Record<string, number> = {};
  for (const planet of planets) {
    const free = freeCombatShips(state, ownerId, planet, catalog, at);
    if (!Object.keys(free).length) continue;
    reserve[planet.id] = free;
    for (const [id, count] of Object.entries(free)) total[id] = (total[id] ?? 0) + count;
  }
  let power = npcForcePower(raceId, total);
  const orders: NpcPlanOrder[] = [];
  let readyAt = at;
  if (power < needed && by > at) {
    const efficiency = (itemId: string) => combatEfficiency(combat.find((entity) => entity.id === itemId));
    for (const planet of planets) {
      const options = getNpcFleetProductionCandidates(planet, ownerId, at, timeScale, flownPopulation(state, ownerId, planet))
        .filter((preview) => preview.available && preview.queueKind === 'ships' && preview.durationMs > 0 && combat.some((entity) => entity.id === preview.itemId));
      const preview = options.find((item) => item.itemId === hullWanted)
        ?? [...options].sort((left, right) => efficiency(right.itemId) - efficiency(left.itemId) || (left.itemId < right.itemId ? -1 : 1))[0];
      if (!preview) continue;
      const queue = (planet as SpyTargetState & { fleetProduction?: { shipQueue?: { finishAt: number }[] } }).fleetProduction?.shipQueue ?? [];
      const queueFree = Math.max(at, ...queue.map((order) => order.finishAt));
      const affordable = Math.min(...(['metal', 'minerals', 'gas'] as const).map((key) => (preview.cost[key] > 0
        ? Math.floor(NPC_PACT_BALANCE.budgetShare * planet.resources[key] / preview.cost[key]) : Number.MAX_SAFE_INTEGER)));
      let count = Math.max(0, Math.min(affordable, Math.floor((by - queueFree) / preview.durationMs)));
      if (count <= 0) continue;
      // No more than closes the gap, within a factor of two: each batch is judged by the same formula.
      while (count > 1 && npcForcePower(raceId, { ...total, [preview.itemId]: (total[preview.itemId] ?? 0) + Math.ceil(count / 2) }) >= needed) count = Math.ceil(count / 2);
      total[preview.itemId] = (total[preview.itemId] ?? 0) + count;
      const share = reserve[planet.id] ?? (reserve[planet.id] = {});
      share[preview.itemId] = (share[preview.itemId] ?? 0) + count;
      orders.push({ planetId: planet.id, itemId: preview.itemId, quantity: count });
      readyAt = Math.max(readyAt, queueFree + count * preview.durationMs);
      power = npcForcePower(raceId, total);
      if (power >= needed) break;
    }
  }
  if (power <= 0) return null;
  // The second wave comes when the guns are spent: it brings the holds (every dispatched ship flies in an attack, by the player's rule).
  if (wave === 2) {
    for (const planet of planets) {
      const free = getNpcMissionAvailableFleet(state, ownerId, planet.id) ?? {};
      for (const id of ['mega-transporter', 'transporter'] as const) {
        const count = Math.floor((free[id] ?? 0) * NPC_PACT_BALANCE.holdsShare);
        if (count <= 0) continue;
        const share = reserve[planet.id] ?? (reserve[planet.id] = {});
        share[id] = count;
      }
    }
  }
  return { reserve, orders, power, readyAt };
}

/**
 * What the strike is worth to this owner by its own report, in days of its
 * income: the haul its own holds can carry against what it expects to lose.
 * Bounded below: a loss is what a grudge may still pay for, not the whole story.
 */
function jointWorth(utility: NpcUtilityContext, force: ForcePlan, report: SpyReportSnapshot, win: number): number {
  const raceId = planetsOf(utility)[0]!.raceId;
  const catalog = getFactionShipCatalog(raceId);
  const counts: Record<string, number> = {};
  for (const share of Object.values(force.reserve)) for (const [id, count] of Object.entries(share)) counts[id] = (counts[id] ?? 0) + count;
  const holds = catalog.reduce((sum, entity) => sum + (counts[entity.id] ?? 0) * (entity.ship?.cargo ?? 0), 0);
  const haul = win * Math.min(holds, 0.5 * stockOf(report.resources));
  const loss = npcFleetValue(raceId, counts) * ((1 - win) * 0.85 + win * 0.1);
  return Math.max(-0.1, (haul - loss) / Math.max(1, utility.dayValue));
}

/** A sample of the force for judging a flight's speed. */
function sampleShips(force: ForcePlan): Record<string, number> {
  return Object.values(force.reserve).find((counts) => Object.keys(counts).length > 0) ?? {};
}

/** The owner's own side of an accepted joint strike, as an ordinary strike plan that aims for a time. */
function draftJointPlan(state: SaveState, utility: NpcUtilityContext, pact: NpcJointStrikeProposal, report: SpyReportSnapshot, at: number, timeScale: number): NpcStrikePlan | null {
  const ownerId = utility.profile.ownerId;
  const terms = pact.terms;
  const target = state.espionage?.targets?.[terms.targetPlanetId];
  const planets = planetsOf(utility);
  if (!target || !planets.length) return null;
  const raceId = planets[0]!.raceId;
  const role = pact.from === ownerId ? terms.fromRole : terms.toRole;
  const partnerId = pact.from === ownerId ? pact.to : pact.from;
  const arriveAt = terms.strikeAt + (role.wave === 2 ? NPC_PACT_BALANCE.waveGapMinutes * MINUTE : 0);
  // The ships must still reach the rally planet and fly: an hour's margin on the time they have.
  const potential = jointForcePlan(state, utility, at, timeScale, role.hull, at + 12 * HOUR, Number.POSITIVE_INFINITY);
  if (!potential) return null;
  const by = arriveAt - npcFleetFlightMs(planets[0]!, target, sampleShips(potential), timeScale) - HOUR;
  const enemy = npcBelievedPower(utility, report, potential.power);
  const wanted = npcWantedWin(utility, terms.targetOwnerId);
  const partner = npcPartnerPowerBelief(state, ownerId, partnerId, potential.power, at);
  const plan = jointForcePlan(state, utility, at, timeScale, role.hull, by, Math.max(1, enemy * (wanted / (1 - wanted)) ** (1 / 2.5) - partner), role.wave);
  if (!plan) return null;
  const contributing = Object.entries(plan.reserve).sort(([left], [right]) => (left < right ? -1 : 1));
  if (!contributing.length) return null;
  const force: Record<string, number> = {};
  for (const [, counts] of contributing) for (const [id, count] of Object.entries(counts)) force[id] = (force[id] ?? 0) + count;
  const population = fleetPopulationOf(raceId, force);
  const rally = [...planets].sort((left, right) => npcFleetValue(raceId, plan.reserve[right.id] ?? {}) - npcFleetValue(raceId, plan.reserve[left.id] ?? {}) || (left.id < right.id ? -1 : 1))
    .find((planet) => npcDeploymentFreeCapacity(planet) >= population - fleetPopulationOf(raceId, plan.reserve[planet.id] ?? {}));
  if (!rally) return null;
  const win = estimateWinProbability(plan.power + partner, enemy);
  return {
    planId: `plan:${ownerId}:pact:${pact.proposalId}`, template: 'strike', ownerId, status: 'active', phase: 'produce', createdAt: at,
    deadlineAt: arriveAt + terms.toleranceMs, targetPlanetId: terms.targetPlanetId, targetOwnerId: terms.targetOwnerId, rallyPlanetId: rally.id,
    reserve: Object.fromEntries(contributing), orders: plan.orders,
    forecast: { win: Math.round(win * 1000) / 1000, gain: Math.round(Math.max(0, jointWorth(utility, plan, report, win)) * utility.dayValue),
      loss: Math.round(npcFleetValue(raceId, force) * ((1 - win) * 0.85 + win * 0.1)), readyAt: Math.round(Math.max(plan.readyAt, at)) },
    knowledgeAt: report.createdAt, sent: [],
    partner: { ownerId: partnerId, proposalId: pact.proposalId, wave: role.wave, arriveAt, toleranceMs: terms.toleranceMs },
  };
}

/* -------------------------------------------------------------- the answer */

function freshReport(utility: NpcUtilityContext, planetId: string, at: number, timeScale: number): SpyReportSnapshot | undefined {
  const report = utility.latestReports.get(planetId);
  return report && at - report.createdAt <= NPC_PACT_BALANCE.reportHours * HOUR / Math.max(1, timeScale) ? report : undefined;
}

type Answer = { accept: true; shift: ReturnType<typeof planNpcVisitShift>; score: number } | { accept: false; reason: string } | { wait: true };

/** Whether this owner goes along, and why not: its own interest, its own news, what it thinks of the other. */
function judgeJointStrike(state: SaveState, profile: NpcProfile, utility: NpcUtilityContext, pact: NpcJointStrikeProposal, at: number, timeScale: number): Answer {
  const ownerId = profile.ownerId;
  const terms = pact.terms;
  const view = npcRelationView(state, profile, pact.from, at);
  const regard = view?.regard ?? 0;
  if (regard <= NPC_PACT_BALANCE.distrustRegard) return { accept: false, reason: 'distrust' };
  if (view && view.promisesBroken > 0 && view.reliability < 0.35) return { accept: false, reason: 'unreliable' };
  const toward = npcRelationView(state, profile, terms.targetOwnerId, at)?.regard ?? 0;
  if (toward >= NPC_PACT_BALANCE.friendRegard || sameAlliance(state, ownerId, terms.targetOwnerId)) return { accept: false, reason: 'target-is-friend' };
  const target = state.espionage?.targets?.[terms.targetPlanetId];
  if (!target || target.ownerId !== terms.targetOwnerId) return { accept: false, reason: 'target-gone' };
  const relation = getOwnerRelation(state, ownerId, target.ownerId);
  if ((relation !== 'enemy' && relation !== 'neutral') || !evaluatePlanetAttackEligibility(state, ownerId, target.ownerId, undefined, at).allowed) return { accept: false, reason: 'attack-not-allowed' };
  if (activeNpcPlans(state, ownerId).length || npcProposalsOf(state, ownerId).some((item) => item.proposalId !== pact.proposalId && item.kind === 'joint-strike' && item.status === 'accepted')) return { accept: false, reason: 'busy' };
  if (ownerUnderAttack(state, utility.ownPlanets, ownerId, at)) return { accept: false, reason: 'threat-at-home' };
  const report = freshReport(utility, terms.targetPlanetId, at, timeScale);
  if (!report) return at < pact.expiresAt - NPC_PACT_BALANCE.reconAnswerHours * HOUR ? { wait: true } : { accept: false, reason: 'no-intel' };
  const force = jointForcePlan(state, utility, at, timeScale, terms.toRole.hull, terms.strikeAt - HOUR, Number.POSITIVE_INFINITY, terms.toRole.wave);
  if (!force) return { accept: false, reason: 'no-force' };
  const enemy = npcBelievedPower(utility, report, force.power);
  const wanted = npcWantedWin(utility, terms.targetOwnerId);
  const win = estimateWinProbability(force.power + npcPartnerPowerBelief(state, ownerId, pact.from, force.power, at), enemy);
  if (win < 0.9 * wanted) return { accept: false, reason: 'target-too-strong' };
  // It must be worth this owner's while by its own count, not the proposer's.
  const grudge = npcRevengeIntensity(utility, terms.targetOwnerId);
  const score = 0.6 * regard + 0.5 * (unit(profile.traits.cooperation) - 0.4) + 0.3 * Math.min(1, jointWorth(utility, force, report, win)) + 0.3 * grudge
    + 0.4 * ((view?.reliability ?? 0.5) - 0.5) - NPC_PACT_BALANCE.repeatPenalty * Math.min(3, view?.jointOps ?? 0)
    - (points(state, ownerId) > 1.5 * points(state, pact.from) ? 0.15 : 0);
  const doubt = (createSeededRandom(JSON.stringify(['npc-pact-answer', profile.privateSeed, pact.proposalId]))() * 2 - 1) * NPC_PACT_BALANCE.answerDoubt;
  if (score + doubt < NPC_PACT_BALANCE.acceptScore) return { accept: false, reason: 'no-interest' };
  // It must be able to send its fleet then: a visit in the window, or one it is willing to move (owner decision 7).
  const flight = npcFleetFlightMs(planetsOf(utility)[0]!, target, sampleShips(force), timeScale);
  const arrive = terms.strikeAt + (terms.toRole.wave === 2 ? NPC_PACT_BALANCE.waveGapMinutes * MINUTE : 0);
  const from = arrive - flight - terms.toleranceMs;
  const to = arrive - flight + terms.toleranceMs;
  const overlap = 5 * MINUTE;
  if (listNpcVisits(profile, from, to).some((visit) => npcVisitOverlap(visit, from, to) >= overlap)) return { accept: true, shift: null, score };
  const shift = planNpcVisitShift(profile, from, to, overlap, at);
  const willing = createSeededRandom(JSON.stringify(['npc-pact-visit', profile.privateSeed, pact.proposalId]))() < npcResponsiveness(profile);
  return shift && willing ? { accept: true, shift, score } : { accept: false, reason: 'away' };
}

function answerJointStrike(state: SaveState, profile: NpcProfile, utility: NpcUtilityContext, pact: NpcJointStrikeProposal, at: number, timeScale: number): SaveState {
  const answer = judgeJointStrike(state, profile, utility, pact, at, timeScale);
  if ('wait' in answer) return state;
  const decline = (reason: string) => {
    journalNpcPact(at, profile.ownerId, 'declined', pact, { why: reason });
    return withNpcPact(state, { ...pact, status: 'declined', decidedAt: at, closedAt: at, reason });
  };
  if (!answer.accept) return decline(answer.reason);
  const accepted: NpcJointStrikeProposal = { ...pact, status: 'accepted', decidedAt: at };
  const plan = draftJointPlan(state, utility, accepted, freshReport(utility, pact.terms.targetPlanetId, at, timeScale)!, at, timeScale);
  if (!plan) return decline('no-force');
  let next = replaceNpcPlan(withNpcPact(state, accepted), plan);
  if (answer.shift) {
    const current = next.npc!.profiles[profile.ownerId]!;
    next = { ...next, npc: { ...next.npc!, profiles: { ...next.npc!.profiles, [profile.ownerId]: { ...current, session: withNpcVisitShift(current.session, answer.shift, at) } } } };
  }
  journalNpcPact(at, profile.ownerId, 'accepted', accepted, { score: Math.round(answer.score * 1000) / 1000, ...(answer.shift ? { shiftMin: Math.round(answer.shift.deltaMs / MINUTE) } : {}) });
  return next;
}

/* ----------------------------------------------------------------- the ask */

type Partner = { ownerId: string; regard: number };

/** Those the owner could ask: people it knows and thinks well of, and, if sociable, the neighbours. */
function partnerCandidates(state: SaveState, profile: NpcProfile, utility: NpcUtilityContext, at: number): Partner[] {
  const ownerId = profile.ownerId;
  const views = utility.relations;
  const partners = new Map<string, number>();
  for (const [other, view] of views ?? []) if (view.regard > NPC_PACT_BALANCE.distrustRegard + 0.2) partners.set(other, view.regard);
  if (unit(profile.traits.cooperation) >= NPC_PACT_BALANCE.strangerCooperation) {
    for (const planet of Object.values(state.espionage?.targets ?? {})) {
      if (planet.kind !== 'npc' || planet.ownerId === ownerId || views?.has(planet.ownerId)) continue;
      if (utility.ownPlanets.some((own) => own.coordinate.galaxy === planet.coordinate.galaxy
        && Math.abs(own.coordinate.system - planet.coordinate.system) <= NPC_PACT_BALANCE.neighbourSystems)) partners.set(planet.ownerId, 0);
    }
  }
  return [...partners].map(([other, regard]) => ({ ownerId: other, regard }))
    .filter((partner) => partner.ownerId !== state.profile.playerId && state.npc?.profiles[partner.ownerId]
      && !sameAlliance(state, ownerId, partner.ownerId) && getOwnerRelation(state, ownerId, partner.ownerId) !== 'enemy'
      && !pairResting(state, ownerId, partner.ownerId, at))
    .sort((left, right) => right.regard - left.regard || (left.ownerId < right.ownerId ? -1 : 1)).slice(0, 8);
}

/**
 * Looks for a target too strong for this owner alone (by its own fresh report)
 * that it dares with a partner, and proposes one strike. The partner gets the
 * target's name and a rough time: nothing of the report.
 */
function considerJointStrike(state: SaveState, profile: NpcProfile, utility: NpcUtilityContext, at: number, timeScale: number): SaveState {
  const ownerId = profile.ownerId;
  const strategy = state.npcStrategy ?? createNpcStrategyState();
  const key = `pact:${ownerId}`;
  if ((strategy.nextCheckAt[key] ?? 0) > at) return state;
  const scheduled: SaveState = { ...state, npcStrategy: { ...strategy, nextCheckAt: { ...strategy.nextCheckAt, [key]: at + NPC_PACT_BALANCE.checkHours * HOUR } } };
  const reports = [...utility.latestReports.values()].filter((report) => at - report.createdAt <= NPC_PACT_BALANCE.reportHours * HOUR / Math.max(1, timeScale))
    .sort((left, right) => (left.targetPlanetId < right.targetPlanetId ? -1 : 1));
  if (!reports.length || !utility.ownPlanets.length || activeNpcPlans(state, ownerId).length || ownerUnderAttack(state, utility.ownPlanets, ownerId, at)) return scheduled;
  if (npcProposalsOf(state, ownerId).some((item) => item.kind === 'joint-strike' && isNpcPactOpen(item.status))) return scheduled;
  if ((strategy.proposals ?? []).filter((item) => item.kind === 'joint-strike' && isNpcPactOpen(item.status)).length >= NPC_PACT_BALANCE.worldActive) return scheduled;
  const reaction = npcReactionOf(state, ownerId, at);
  const candidates = partnerCandidates(state, profile, utility, at);
  if (!candidates.length) return scheduled;
  const drive = 0.6 * unit(profile.traits.cooperation) + 0.4 * unit(profile.traits.socialStyle) + candidates[0]!.regard + (reaction?.kind === 'seek-partner' ? 0.3 : 0);
  if (drive < NPC_PACT_BALANCE.minProposeDrive) return scheduled;

  const planets = planetsOf(utility);
  const canBuild = (hull: string) => planets.some((planet) => getNpcFleetProductionCandidates(planet, ownerId, at, timeScale, flownPopulation(state, ownerId, planet))
    .some((preview) => preview.available && preview.itemId === hull));
  const myHull = canBuild(ROLE_HULLS[0]) ? ROLE_HULLS[0] : ROLE_HULLS[1];
  const force = jointForcePlan(state, utility, at, timeScale, myHull, at + NPC_PACT_BALANCE.minLeadHours * HOUR, Number.POSITIVE_INFINITY);
  if (!force) return scheduled;
  let best: { report: SpyReportSnapshot; partner: Partner; value: number } | null = null;
  for (const report of reports) {
    const target = state.espionage?.targets?.[report.targetPlanetId];
    if (!target || target.ownerId !== report.targetOwnerId || target.ownerId === ownerId) continue;
    if ((utility.relations?.get(target.ownerId)?.regard ?? 0) >= NPC_PACT_BALANCE.friendRegard) continue;
    const relation = getOwnerRelation(state, ownerId, target.ownerId);
    if ((relation !== 'enemy' && relation !== 'neutral') || !evaluatePlanetAttackEligibility(state, ownerId, target.ownerId, undefined, at).allowed) continue;
    if (!npcJointTargetAllowed(state, ownerId, target.ownerId, at)) continue;
    const enemy = npcBelievedPower(utility, report, force.power);
    const wanted = npcWantedWin(utility, target.ownerId);
    // A target it can take alone is an ordinary strike.
    if (estimateWinProbability(force.power, enemy) >= wanted) continue;
    for (const partner of candidates) {
      if (partner.ownerId === target.ownerId) continue;
      // The points are public: no use asking someone the attack rule would stop.
      if (!evaluatePlanetAttackEligibility(state, partner.ownerId, target.ownerId, undefined, at).allowed) continue;
      const win = estimateWinProbability(force.power + npcPartnerPowerBelief(state, ownerId, partner.ownerId, force.power, at), enemy);
      if (win < 0.9 * wanted) continue;
      const value = Math.min(1.5, jointWorth(utility, force, report, win)) + 0.5 * npcRevengeIntensity(utility, target.ownerId) + (reaction?.offender === target.ownerId ? 0.5 : 0);
      if (value < 0.1) continue;
      const score = value + 0.5 * partner.regard;
      if (!best || score > best.value) best = { report, partner, value: score };
    }
  }
  if (!best) return scheduled;
  // The time it is online itself, a little after a visit opens: the partner sees only the time.
  const target = state.espionage!.targets![best.report.targetPlanetId]!;
  const flight = npcFleetFlightMs(planets[0]!, target, sampleShips(force), timeScale);
  const earliest = at + NPC_PACT_BALANCE.minLeadHours * HOUR;
  const visit = listNpcVisits(profile, earliest, at + NPC_PACT_BALANCE.maxLeadHours * HOUR).find((item) => item.startAt >= earliest && item.endAt - item.startAt >= 10 * MINUTE);
  if (!visit) return scheduled;
  const strikeAt = visit.startAt + flight + Math.min(15 * MINUTE, Math.round((visit.endAt - visit.startAt) / 2));
  const proposal: NpcJointStrikeProposal = {
    proposalId: `pact:${ownerId}:${at}`, kind: 'joint-strike', from: ownerId, to: best.partner.ownerId, createdAt: at,
    expiresAt: Math.min(at + NPC_PACT_BALANCE.answerHours * HOUR, strikeAt - HOUR), status: 'proposed',
    terms: { targetPlanetId: target.id, targetOwnerId: target.ownerId, strikeAt, toleranceMs: NPC_PACT_BALANCE.toleranceMinutes * MINUTE,
      fromRole: { wave: 1, hull: myHull }, toRole: { wave: 2, hull: myHull === ROLE_HULLS[0] ? ROLE_HULLS[1] : ROLE_HULLS[0] } },
  };
  journalNpcPact(at, ownerId, 'proposed', proposal, { regard: Math.round(best.partner.regard * 100) / 100 });
  return withNpcPact(scheduled, proposal);
}

/* ---------------------------------------------------------------- the gift */

/** The owner's own transports and deliveries of late: its own books. */
function giftLedger(state: SaveState, ownerId: string, at: number) {
  const gifts = state.npcStrategy?.gifts ?? [];
  const guard = NPC_PACT_BALANCE.giftGuardHours * HOUR;
  return {
    received: gifts.some((gift) => gift.to === ownerId && at - gift.at < guard),
    sent: gifts.some((gift) => gift.from === ownerId && at - gift.at < guard),
    sentToday: gifts.filter((gift) => gift.from === ownerId && at - gift.at < 24 * HOUR).reduce((sum, gift) => sum + gift.amount, 0),
  };
}

const hasOpenAsk = (state: SaveState, ownerId: string) => npcProposalsOf(state, ownerId)
  .some((item) => item.kind === 'resource-gift' && item.from === ownerId && item.status === 'proposed');

/** The owner tells a friend or partner what it lacks: its own business, its own words. Never the player. */
function considerGiftAsk(state: SaveState, profile: NpcProfile, utility: NpcUtilityContext, at: number): SaveState {
  const ownerId = profile.ownerId;
  const strategy = state.npcStrategy ?? createNpcStrategyState();
  const key = `gift:${ownerId}`;
  if ((strategy.nextCheckAt[key] ?? 0) > at) return state;
  const scheduled: SaveState = { ...state, npcStrategy: { ...strategy, nextCheckAt: { ...strategy.nextCheckAt, [key]: at + NPC_PACT_BALANCE.giftCheckHours * HOUR } } };
  const ledger = giftLedger(state, ownerId, at);
  if (ledger.received || ledger.sent || npcProposalsOf(state, ownerId).some((item) => item.kind === 'resource-gift' && isNpcPactOpen(item.status))) return scheduled;
  const main = utility.ownPlanets.find((planet) => planet.id === `${ownerId}-planet`) ?? planetsOf(utility)[0];
  if (!main) return scheduled;
  const capacity = getStorageCapacities(main.buildings);
  const need = (['metal', 'minerals', 'gas'] as const)
    .map((resource) => ({ resource, fill: capacity[resource] > 0 ? main.resources[resource] / capacity[resource] : 1 }))
    .sort((left, right) => left.fill - right.fill || (left.resource < right.resource ? -1 : 1))[0]!;
  if (need.fill >= NPC_PACT_BALANCE.giftNeedFill) return scheduled;
  // The aid request's own ceiling: friendship opens no wider a pipe than an alliance does.
  const amount = Math.floor(Math.min(maxRequestAmount(selectOwnerScore(state, ownerId)?.resourcePoints ?? 0), NPC_PACT_BALANCE.giftAskDayShare * utility.dayValue, capacity[need.resource] * 0.5));
  if (amount < NPC_PACT_BALANCE.giftMinDayShare * utility.dayValue) return scheduled;
  const partnerPact = npcProposalsOf(state, ownerId).find((item): item is NpcJointStrikeProposal => item.kind === 'joint-strike' && item.status === 'accepted');
  const friends = [...(utility.relations ?? [])].filter(([, view]) => view.regard >= NPC_PACT_BALANCE.giftFriendRegard)
    .map(([other, view]) => ({ ownerId: other, regard: view.regard })).sort((left, right) => right.regard - left.regard || (left.ownerId < right.ownerId ? -1 : 1));
  const friend = [...(partnerPact ? [{ ownerId: partnerPact.from === ownerId ? partnerPact.to : partnerPact.from, regard: 1 }] : []), ...friends]
    .find((item) => item.ownerId !== state.profile.playerId && state.npc?.profiles[item.ownerId] && !sameAlliance(state, ownerId, item.ownerId));
  if (!friend) return scheduled;
  const proposal: NpcGiftProposal = {
    proposalId: `gift:${ownerId}:${at}`, kind: 'resource-gift', from: ownerId, to: friend.ownerId, createdAt: at,
    expiresAt: at + NPC_PACT_BALANCE.answerHours * HOUR, status: 'proposed',
    terms: { resource: need.resource, amount, planetId: main.id, ...(partnerPact ? { forProposalId: partnerPact.proposalId } : {}) },
  };
  journalNpcPact(at, ownerId, 'proposed', proposal);
  return withNpcPact(scheduled, proposal);
}

function judgeGift(state: SaveState, profile: NpcProfile, utility: NpcUtilityContext, ask: NpcGiftProposal, at: number):
  { reason: string } | { source: SpyTargetState; amount: number; ships: Record<string, number> } {
  const ownerId = profile.ownerId;
  const view = npcRelationView(state, profile, ask.from, at);
  const regard = view?.regard ?? 0;
  const forPartner = ask.terms.forProposalId !== undefined && npcProposalsOf(state, ownerId)
    .some((item) => item.proposalId === ask.terms.forProposalId && item.status === 'accepted');
  if (sameAlliance(state, ownerId, ask.from)) return { reason: 'same-alliance' };
  if (!forPartner && regard < NPC_PACT_BALANCE.giftFriendRegard) return { reason: 'distrust' };
  const ledger = giftLedger(state, ownerId, at);
  // Who got a gift of late or still asks for one sends none, who sent one asks for none: no chain of gifts can close.
  if (ledger.received || hasOpenAsk(state, ownerId)) return { reason: 'cycle-guard' };
  if (view && view.helpGiven > 0 && view.reciprocity < -0.5 && !forPartner) return { reason: 'one-sided' };
  const doubt = (createSeededRandom(JSON.stringify(['npc-gift-answer', profile.privateSeed, ask.proposalId]))() * 2 - 1) * NPC_PACT_BALANCE.answerDoubt;
  if (0.7 * regard + 0.4 * unit(profile.traits.cooperation) + (forPartner ? 0.3 : 0) + doubt < 0.35) return { reason: 'no-interest' };
  const budget = NPC_PACT_BALANCE.giftBudgetDayShare * utility.dayValue - ledger.sentToday;
  const least = NPC_PACT_BALANCE.giftMinDayShare * utility.dayValue;
  if (budget < least) return { reason: 'budget' };
  const resource = ask.terms.resource;
  let lacking = 'no-surplus';
  for (const source of planetsOf(utility)) {
    const surplus = Math.floor(source.resources[resource] * (1 - NPC_PACT_BALANCE.giftKeepShare));
    if (surplus < least) continue;
    const free = getNpcMissionAvailableFleet(state, ownerId, source.id) ?? {};
    const catalog = getFactionShipCatalog(source.raceId);
    const wanted = Math.floor(Math.min(ask.terms.amount, surplus, budget));
    // Just enough holds, the big ones first.
    const ships: Record<string, number> = {};
    let room = 0;
    for (const id of ['mega-transporter', 'transporter'] as const) {
      const hold = catalog.find((entity) => entity.id === id)?.ship?.cargo ?? 0;
      if (hold <= 0 || room >= wanted) continue;
      const count = Math.min(free[id] ?? 0, Math.ceil((wanted - room) / hold));
      if (count > 0) { ships[id] = count; room += count * hold; }
    }
    if (room < least) { lacking = 'no-transport'; continue; }
    return { source, amount: Math.min(wanted, room), ships };
  }
  return { reason: lacking };
}

function answerGift(state: SaveState, profile: NpcProfile, utility: NpcUtilityContext, ask: NpcGiftProposal, at: number, timeScale: number): SaveState {
  const ownerId = profile.ownerId;
  const verdict = judgeGift(state, profile, utility, ask, at);
  const decline = (reason: string) => {
    journalNpcPact(at, ownerId, 'declined', ask, { why: reason });
    return withNpcPact(state, { ...ask, status: 'declined', decidedAt: at, closedAt: at, reason });
  };
  if ('reason' in verdict) return decline(verdict.reason);
  const planet = state.espionage?.targets?.[ask.terms.planetId];
  if (!planet || planet.ownerId !== ask.from) return decline('target-gone');
  const cargo = { metal: 0, minerals: 0, gas: 0, debris: 0, [ask.terms.resource]: verdict.amount };
  const result = dispatchNpcTransport(state, { requestId: `${NPC_GIFT_REQUEST_PREFIX}${ask.proposalId}`, ownerId, originPlanetId: verdict.source.id,
    destinationPlanetId: planet.id, selectedShips: verdict.ships as Partial<Record<ShipId, number>>, cargo, toFriend: true }, at, timeScale);
  if (!result.ok) return decline(result.reason ?? 'no-transport');
  const strategy = result.state.npcStrategy ?? createNpcStrategyState();
  const gifts = [...(strategy.gifts ?? []).filter((gift) => at - gift.at < 72 * HOUR), { from: ownerId, to: ask.from, amount: verdict.amount, at }].slice(-NPC_GIFTS_KEPT);
  journalNpcPact(at, ownerId, 'accepted', ask, { sent: verdict.amount });
  return withNpcPact({ ...result.state, npcStrategy: { ...strategy, gifts } }, { ...ask, status: 'accepted', decidedAt: at });
}

/* --------------------------------------------------------- robbed, and then */

/**
 * The same blows, different people (ADR §7.г, U42–U44): someone robbed again and
 * again digs in, turns to the economy, hits back, or looks for a partner. Its
 * character and what it thinks of the others weigh the choice; the seed makes
 * two alike still differ.
 */
export function chooseNpcRobberyReaction(profile: NpcProfile, inputs: Readonly<{ grudge: number; fearOfOffender: number; bestFriend: number }>, at: number): NpcRobberyReactionKind {
  const t = profile.traits;
  const random = createSeededRandom(JSON.stringify(['npc-robbery-reaction', profile.privateSeed, Math.floor(at / (6 * HOUR))]));
  const doubt = () => (random() * 2 - 1) * NPC_PACT_BALANCE.reactionDoubt;
  const options: [NpcRobberyReactionKind, number][] = [
    // The usual answer: it takes a character to do anything else.
    ['fortify', 0.25 + 0.6 * (1 - unit(t.riskTolerance)) + 0.4 * unit(t.planningHorizon) + doubt()],
    ['economy', 0.7 * unit(t.economyFocus) + 0.3 * (1 - unit(t.aggression)) + doubt()],
    ['counter', 0.7 * unit(t.aggression) + 0.5 * unit(t.riskTolerance) + 0.4 * unit(inputs.grudge) - 0.5 * unit(inputs.fearOfOffender) + doubt()],
    ['seek-partner', 0.8 * unit(t.cooperation) + 0.3 * unit(t.socialStyle) + 0.5 * Math.max(0, inputs.bestFriend) + doubt()],
  ];
  return options.reduce((best, item) => (item[1] > best[1] ? item : best))[0];
}

/** Battles at home in the last two days that this owner lost and paid for: being attacked and holding is no robbery. */
function robberiesOf(state: SaveState, ownerId: string, at: number): number {
  let robbed = 0;
  for (const report of ownerBattleReports(state.combat.reports, ownerId)) {
    if (report.defender.playerId !== ownerId || report.winner !== 'attacker' || !isGrievanceBattle(report) || battleLoot(report) <= 0) continue;
    const when = battleReportTime(report);
    if (Number.isFinite(when) && when <= at && at - when <= 48 * HOUR) robbed += 1;
  }
  return robbed;
}

function refreshReaction(state: SaveState, profile: NpcProfile, utility: NpcUtilityContext, at: number): SaveState {
  if (utility.threat < 1 || npcReactionOf(state, profile.ownerId, at) || robberiesOf(state, profile.ownerId, at) < NPC_PACT_BALANCE.reactionRobberies) return state;
  const offender = Object.entries(profile.grudges ?? {}).sort(([leftId, left], [rightId, right]) => right.damage - left.damage || (leftId < rightId ? -1 : 1))[0]?.[0];
  const views = utility.relations;
  const kind = chooseNpcRobberyReaction(profile, {
    grudge: npcRevengeIntensity(utility, offender), fearOfOffender: offender ? views?.get(offender)?.fear ?? 0 : 0,
    bestFriend: Math.max(0, ...[...(views?.values() ?? [])].map((view) => view.regard)),
  }, at);
  const strategy = state.npcStrategy ?? createNpcStrategyState();
  const reaction = { kind, ...(offender ? { offender } : {}), since: at, until: at + NPC_PACT_BALANCE.reactionHours * HOUR };
  getNpcJournalSink()?.outcome?.({ at, ownerId: profile.ownerId, kind: 'reaction', data: { react: kind, ...(offender ? { vs: offender } : {}) } });
  return { ...state, npcStrategy: { ...strategy, reactions: { ...(strategy.reactions ?? {}), [profile.ownerId]: reaction } } };
}

/* ------------------------------------------------------------- each look */

/** A joint strike's plan the proposer makes once the other has said yes. */
function ensureProposerPlan(state: SaveState, profile: NpcProfile, utility: NpcUtilityContext, pact: NpcJointStrikeProposal, at: number, timeScale: number): SaveState {
  if ((state.npcStrategy?.plans[profile.ownerId] ?? []).some((plan) => plan.template === 'strike' && plan.partner?.proposalId === pact.proposalId)) return state;
  const report = utility.latestReports.get(pact.terms.targetPlanetId);
  const plan = report && !activeNpcPlans(state, profile.ownerId).length ? draftJointPlan(state, utility, pact, report, at, timeScale) : null;
  return plan ? replaceNpcPlan(state, plan) : settleNpcPact(state, pact, 'withdrawn', at, report ? 'no-force' : 'no-intel', profile.ownerId);
}

/** A window long past: whoever did not come and did not say so has broken its word. */
function closeLateJointStrike(state: SaveState, pact: NpcJointStrikeProposal, at: number): SaveState {
  if (at < pact.terms.strikeAt + 3 * pact.terms.toleranceMs + 2 * NPC_PACT_BALANCE.waveGapMinutes * MINUTE) return state;
  const came = (ownerId: string) => Boolean(pact.arrivals?.[ownerId]);
  if (came(pact.from) && !came(pact.to)) return settleNpcPact(state, pact, 'broken', at, 'no-show', pact.to);
  if (came(pact.to) && !came(pact.from)) return settleNpcPact(state, pact, 'broken', at, 'no-show', pact.from);
  return settleNpcPact(state, pact, 'cancelled', at, 'neither-came');
}

/**
 * Agreements move on when an owner looks at the game: answers, its own plan of
 * an agreed strike, closing what ran out, and (rarely) a new ask. Nothing here
 * spends an action: thinking and talking take no fleet.
 */
export function refreshNpcPacts(state: SaveState, profile: NpcProfile, utility: NpcUtilityContext, at: number, timeScale: number): SaveState {
  const ownerId = profile.ownerId;
  let next = refreshReaction(state, profile, utility, at);
  for (const proposal of npcProposalsOf(next, ownerId)) {
    if (proposal.status === 'proposed') {
      if (at >= proposal.expiresAt) {
        journalNpcPact(at, ownerId, 'expired', proposal);
        next = withNpcPact(next, { ...proposal, status: 'expired', closedAt: at });
      } else if (proposal.to === ownerId) {
        next = proposal.kind === 'joint-strike' ? answerJointStrike(next, profile, utility, proposal, at, timeScale)
          : answerGift(next, profile, utility, proposal, at, timeScale);
      }
    } else if (proposal.status === 'accepted' && proposal.kind === 'joint-strike') {
      const closed = closeLateJointStrike(next, proposal, at);
      if (closed !== next) next = closed;
      else if (proposal.from === ownerId) next = ensureProposerPlan(next, profile, utility, proposal, at, timeScale);
    }
  }
  next = considerJointStrike(next, profile, utility, at, timeScale);
  return considerGiftAsk(next, profile, utility, at);
}

/** A probe for the news the owner still needs before it answers. */
export function getNpcPactChoices(state: SaveState, profile: NpcProfile, at: number, timeScale: number, utility: NpcUtilityContext, missions: readonly NpcMissionCandidate[]): NpcPlanChoice[] {
  const ownerId = profile.ownerId;
  const choices: NpcPlanChoice[] = [];
  for (const proposal of npcProposalsOf(state, ownerId)) {
    if (proposal.kind !== 'joint-strike' || proposal.status !== 'proposed' || proposal.to !== ownerId) continue;
    const planetId = proposal.terms.targetPlanetId;
    if (freshReport(utility, planetId, at, timeScale)) continue;
    const probe = missions.find((mission) => mission.kind === 'espionage' && mission.payload.destinationPlanetId === planetId);
    if (!probe) continue;
    choices.push({ candidate: { id: `pact:recon:${proposal.proposalId}`, kind: 'plan-step', weight: utilityToWeight(2), payload: { planetId: String(probe.payload.originPlanetId) } }, run: (current, key) => {
      const command = candidateToNpcMissionCommand(probe, ownerId, key);
      if (!command) return { state: current, started: false, reason: 'invalid-mission-candidate' };
      const result = dispatchNpcMission(current, command, at, timeScale);
      return { state: result.state, started: result.ok, reason: result.reason, planetId: command.originPlanetId };
    } });
  }
  return choices;
}
