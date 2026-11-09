import { selectOwnerMembership } from '../domain/command/selectors.ts';
import { COMMANDER_IDS } from '../domain/combat/commanders.ts';
import type { BattleReport } from '../domain/combat/report.ts';
import type { CombatFactionId } from '../domain/combat/factions.ts';
import type { ShipId } from '../domain/combat/ids.ts';
import { getFactionShipCatalog } from '../domain/combat/faction-catalog.ts';
import type { SpyReportSnapshot, SpyTargetState } from '../domain/espionage/types.ts';
import { npcGrudgeIntensity } from '../domain/npc/grudges.ts';
import { createNpcStrategyState } from '../domain/npc/strategy.ts';
import type { NpcProfile } from '../domain/npc/types.ts';
import { utilityToWeight } from '../domain/npc/utility.ts';
import type { NpcWar, NpcWarMember, NpcWarRole } from '../domain/npc/war.ts';
import { createSeededRandom } from '../domain/world/random.ts';
import { evaluatePlanetAttackEligibility } from './attack-eligibility.ts';
import type { SaveState } from './contracts.ts';
import { getNpcFleetProductionCandidates, startNpcFleetProduction } from './npc-fleet-production.ts';
import { getNpcJournalSink } from './npc-journal.ts';
import { dispatchNpcLootWaves } from './npc-loot-wave.ts';
import { candidateToNpcMissionCommand, type NpcMissionCandidate } from './npc-mission-policy.ts';
import { dispatchNpcDeployment, dispatchNpcMission, getNpcMissionAvailableFleet, npcDeploymentFreeCapacity } from './npc-missions.ts';
import { npcCombatPriority, npcEnemyShape, npcMainCommander } from './npc-commanders.ts';
import { npcFleetFlightMs } from './npc-pact-state.ts';
import { combatShipsOf, fleetPopulationOf, flownPopulation, freeCombatShips, type NpcPlanChoice } from './npc-plans.ts';
import { activeNpcWarOf, activeNpcWars, npcWarFocus, npcWarMember, withNpcWar, withNpcWarMember } from './npc-war-state.ts';
import { combatEfficiency, estimateRaidWin, npcDefenseValue, npcFleetValue, npcRevengeIntensity, type NpcUtilityContext } from './npc-utility.ts';
import { getOwnerRelation } from './owner-relations.ts';
import { selectOwnerScore } from '../domain/rating/scoring.ts';
import { ownerFlights } from './npc-knowledge-index.ts';

/**
 * Revenge war (owner decision 09.11.2026, variant B; see domain/npc/war.ts).
 * A bot that has been hurt badly by one offender does not weigh a win chance
 * for a single wave: it plans a series, calls the others hurt by the same
 * offender and its own alliance, agrees a rough time, brings its ships to the
 * planets nearest the target, scouts, and sends waves from many planets,
 * round after round, until the offender's planets are gone, its fury has
 * faded or it is broken. A wave is skipped only when it would be pointless
 * (no ships, no news of the target at all, a shield, an ally).
 *
 * Time here is real hours: the owners' visits do not speed up with the campaign.
 * Numbers are the bots' judgement (owner may change them), not game rules.
 */
export const NPC_WAR_BALANCE = Object.freeze({
  /** Real hours between a bot's looks for a new war. */
  checkHours: 1,
  /** Fury (grudge, faded by time) from which a bot declares a war, and from which a hurt bot volunteers for a running one. */
  declareFury: 0.6,
  joinFury: 0.45,
  /** A member whose fury is below this leaves; the war ends when nobody is left. */
  keepFury: 0.2,
  /** Fury halves in this many real hours without a fresh blow. */
  furyHalfLifeHours: 168,
  /** Bots in one war, and wars running in the world. */
  maxMembers: 5,
  maxWorldWars: 4,
  /** An invitation stands this long (real hours); the first round comes this long after the declaration. */
  inviteHours: 6,
  firstRoundHours: 8,
  /** Rest between rounds, and after a round nobody launched in (real hours). */
  roundGapHours: 3,
  stallGapHours: 4,
  /** A wave is still sent this long after the agreed time, and no earlier than this before it. */
  windowHours: 2,
  earlyMinutes: 30,
  /** Fleets are brought to the staging planets from this long before the round; the target is scouted from this long before. */
  prepHours: 2,
  reconHours: 1.5,
  /** A report older than this (game hours) is scouted again, when the bot has a probe to send. */
  reconFreshHours: 3,
  /** Rounds in a row without a single launch end the war. */
  stallLimit: 8,
  /** A bot that ended or left a war does not declare a new one for this long (real hours). */
  restHours: 24,
  /** A wave needs at least this share of a day's income in ships; a stage move this much. */
  minWaveDayShare: 0.02,
  stageDayShare: 0.1,
  /** The offender must have at least this share of the bot's points (no ganging up on the small). */
  pointsShare: 0.5,
  /** Fleet value (days of income) the bot builds up to between rounds, and the share of a planet's stores it spends on it. */
  buildTargetDays: 8,
  buildBudgetShare: 0.5,
  /** The answer to an invitation: the score plus a seeded doubt must clear this. */
  acceptScore: 0.35,
  answerDoubt: 0.1,
  /** Cargo follows the wave only when the bot believes the wave wins. */
  holdsWin: 0.8,
});

const HOUR = 3_600_000;
const MINUTE = 60_000;
const checkKey = (ownerId: string) => `war:${ownerId}`;
const unit = (value: number) => Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));
const round3 = (value: number) => Math.round(value * 1000) / 1000;
const pad = (value: number) => String(value).padStart(2, '0');

function journal(at: number, ownerId: string, ev: string, data: Readonly<Record<string, unknown>>): void {
  getNpcJournalSink()?.outcome?.({ at, ownerId, kind: 'war', data: { ev, ...data } });
}

/** The grudge against an offender as it stands now: the memory lasts, but fury fades without fresh blows. */
export function npcWarFury(utility: NpcUtilityContext, offenderId: string, at: number): number {
  const base = npcRevengeIntensity(utility, offenderId);
  const grudge = utility.profile.grudges?.[offenderId];
  if (!grudge || base <= 0) return base;
  const hours = Math.max(0, at - grudge.lastAt) / HOUR;
  return base * 0.5 ** (hours / NPC_WAR_BALANCE.furyHalfLifeHours);
}

const distance = (left: SpyTargetState, right: SpyTargetState) => Math.abs(left.coordinate.galaxy - right.coordinate.galaxy) * 1000
  + Math.abs(left.coordinate.system - right.coordinate.system) * 10 + Math.abs(left.coordinate.position - right.coordinate.position);

const planetsOf = (utility: NpcUtilityContext) => [...utility.ownPlanets].sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0));
const offenderPlanets = (state: SaveState, offenderId: string) => Object.values(state.espionage?.targets ?? {})
  .filter((target) => target.ownerId === offenderId).sort((left, right) => (left.id < right.id ? -1 : 1));

/** May this owner hit the offender at all (relation, the points rule)? A shield is a wait, not a no. */
function attackable(state: SaveState, ownerId: string, offenderId: string, at: number): 'ok' | 'shield' | 'ally' | 'points' {
  const relation = getOwnerRelation(state, ownerId, offenderId);
  if (relation !== 'enemy' && relation !== 'neutral') return 'ally';
  const eligibility = evaluatePlanetAttackEligibility(state, ownerId, offenderId, undefined, at);
  if (eligibility.allowed) return 'ok';
  return eligibility.reason === 'attacker-shielded' || eligibility.reason === 'defender-shielded' ? 'shield' : 'points';
}

const points = (state: SaveState, ownerId: string) => selectOwnerScore(state, ownerId)?.totalPoints ?? 0;

/**
 * The offender's planets in the order they are to be hit, by what this owner
 * knows: the weakest known defence first, planets it has no news of after them
 * (nearest first). Planned in advance, as a player plans which planet is hit first.
 */
export function npcWarTargetOrder(state: SaveState, utility: NpcUtilityContext, offenderId: string): string[] {
  const own = planetsOf(utility);
  const worth = (target: SpyTargetState) => {
    const report = utility.latestReports.get(target.id);
    if (!report || (report.fleet === undefined && report.defense === undefined)) return null;
    const race = report.targetRaceId as CombatFactionId;
    return npcFleetValue(race, report.fleet ?? {}) + npcDefenseValue(race, report.defense);
  };
  const near = (target: SpyTargetState) => Math.min(Infinity, ...own.map((planet) => distance(planet, target)));
  return offenderPlanets(state, offenderId).map((target) => ({ id: target.id, worth: worth(target), near: near(target) }))
    .sort((left, right) => (left.worth === null ? 1 : 0) - (right.worth === null ? 1 : 0) || (left.worth ?? 0) - (right.worth ?? 0)
      || left.near - right.near || (left.id < right.id ? -1 : 1)).map((item) => item.id);
}

/* ------------------------------------------------------------------ answers */

/** What an invited bot makes of the call: fury, alliance with the leader, regard, character, fear of the offender. */
export function npcWarAnswerScore(state: SaveState, utility: NpcUtilityContext, war: NpcWar, at: number): number {
  const profile = utility.profile;
  const fury = npcWarFury(utility, war.offenderId, at);
  const own = selectOwnerMembership(state.command, profile.ownerId);
  const sameAlliance = Boolean(own && selectOwnerMembership(state.command, war.leaderId)?.alliance.id === own.alliance.id);
  const regard = utility.relations?.get(war.leaderId)?.regard ?? 0;
  const fear = utility.relations?.get(war.offenderId)?.fear ?? 0;
  const doubt = (createSeededRandom(JSON.stringify(['npc-war-answer', profile.privateSeed, war.warId]))() * 2 - 1) * NPC_WAR_BALANCE.answerDoubt;
  return fury + (sameAlliance ? 0.35 : 0) + 0.25 * Math.max(-1, Math.min(1, regard)) + 0.2 * (unit(profile.traits.cooperation) - 0.5)
    + 0.2 * (unit(profile.traits.aggression) - 0.5) - 0.5 * fear * (1 - fury) + doubt;
}

function member(ownerId: string, role: NpcWarRole, answer: NpcWarMember['answer'], at: number): NpcWarMember {
  return { ownerId, role, answer, invitedAt: at, ...(answer === 'accepted' ? { answeredAt: at } : {}), lastRound: 0, waves: 0, lastSkip: 0 };
}

const acceptedMembers = (war: NpcWar) => war.members.filter((item) => item.answer === 'accepted');

function closeWar(state: SaveState, war: NpcWar, at: number, reason: string, actor: string): SaveState {
  if (war.status !== 'active') return state;
  journal(at, actor, 'ended', { id: war.warId, off: war.offenderId, why: reason, rounds: war.round, waves: war.waves, wins: war.wins, razed: war.razed,
    members: acceptedMembers(war).length, hours: round3((at - war.createdAt) / HOUR) });
  // Whoever fought rests before it declares another war.
  const strategy = state.npcStrategy ?? createNpcStrategyState();
  const resting = Object.fromEntries(war.members.filter((item) => item.answer === 'accepted' || item.ownerId === actor)
    .map((item) => [checkKey(item.ownerId), at + NPC_WAR_BALANCE.restHours * HOUR]));
  return withNpcWar({ ...state, npcStrategy: { ...strategy, nextCheckAt: { ...strategy.nextCheckAt, ...resting } } }, { ...war, status: 'ended', closedAt: at, reason });
}

/** One bot in the war leaves it: its reason goes to the journal. The last one out ends the war. */
function leave(state: SaveState, war: NpcWar, ownerId: string, answer: 'declined' | 'left' | 'expired', reason: string, at: number): SaveState {
  const current = npcWarMember(war, ownerId);
  if (!current) return state;
  journal(at, ownerId, answer === 'left' ? 'left' : 'answer', { id: war.warId, off: war.offenderId, a: answer, why: reason });
  const updated = withNpcWarMember(war, { ...current, answer, answeredAt: at, reason });
  if (!updated.members.some((item) => item.answer === 'accepted' || item.answer === 'invited')) {
    return closeWar(state, updated, at, reason === 'faded' || reason === 'peace' ? reason : 'abandoned', ownerId);
  }
  return withNpcWar(state, updated);
}

const inOtherWar = (state: SaveState, ownerId: string, exceptId: string) => activeNpcWars(state).some((war) => war.warId !== exceptId
  && npcWarMember(war, ownerId)?.answer === 'accepted');

/**
 * Moves the owner's side of every war on by what it sees now: its answer to an
 * invitation, a volunteer joining, leaving when the fury is gone, and — in any
 * member's look — the war's own clock (rounds, the order of targets, the end).
 * No action, only the reading; called at the start of each look.
 */
export function refreshNpcWars(state: SaveState, profile: NpcProfile, utility: NpcUtilityContext, at: number): SaveState {
  const ownerId = profile.ownerId;
  let next = state;
  for (const listed of activeNpcWars(state)) {
    let war = activeNpcWars(next).find((item) => item.warId === listed.warId);
    if (!war) continue;
    const own = npcWarMember(war, ownerId);
    const fury = npcWarFury(utility, war.offenderId, at);
    if (own?.answer === 'invited') {
      if (at - own.invitedAt > NPC_WAR_BALANCE.inviteHours * HOUR) next = leave(next, war, ownerId, 'expired', 'no-answer', at);
      else if (inOtherWar(next, ownerId, war.warId)) next = leave(next, war, ownerId, 'declined', 'other-war', at);
      else if (attackable(next, ownerId, war.offenderId, at) === 'ally') next = leave(next, war, ownerId, 'declined', 'ally', at);
      else if (attackable(next, ownerId, war.offenderId, at) === 'points') next = leave(next, war, ownerId, 'declined', 'points', at);
      else {
        const score = npcWarAnswerScore(next, utility, war, at);
        if (score >= NPC_WAR_BALANCE.acceptScore) {
          journal(at, ownerId, 'answer', { id: war.warId, off: war.offenderId, a: 'accepted', score: round3(score), g: round3(fury) });
          next = withNpcWar(next, withNpcWarMember(war, { ...own, answer: 'accepted', answeredAt: at }));
        } else next = leave(next, war, ownerId, 'declined', 'not-moved', at);
      }
    } else if (!own && fury >= NPC_WAR_BALANCE.joinFury && acceptedMembers(war).length < NPC_WAR_BALANCE.maxMembers
      && !inOtherWar(next, ownerId, war.warId) && ['ok', 'shield'].includes(attackable(next, ownerId, war.offenderId, at))) {
      // Hurt by the same offender, it does not wait to be asked.
      journal(at, ownerId, 'answer', { id: war.warId, off: war.offenderId, a: 'volunteered', g: round3(fury) });
      next = withNpcWar(next, withNpcWarMember(war, member(ownerId, 'hurt', 'accepted', at)));
    } else if (own?.answer === 'accepted') {
      const relation = attackable(next, ownerId, war.offenderId, at);
      if (relation === 'ally') next = leave(next, war, ownerId, 'left', 'peace', at);
      else if (fury < NPC_WAR_BALANCE.keepFury && own.role === 'hurt') next = leave(next, war, ownerId, 'left', 'faded', at);
    }
    war = activeNpcWars(next).find((item) => item.warId === listed.warId);
    if (war && npcWarMember(war, ownerId)?.answer === 'accepted') next = advanceWar(next, war, utility, ownerId, at);
  }
  return next;
}

/** The war's clock: stale invitations, its end conditions, and the next round when the window of this one has passed. */
function advanceWar(state: SaveState, war: NpcWar, utility: NpcUtilityContext, actor: string, at: number): SaveState {
  const standing = offenderPlanets(state, war.offenderId).map((target) => target.id);
  const lost = war.targets.filter((id) => !standing.includes(id)).length;
  // Invitations nobody answered in time are dropped in anyone's look.
  const members = war.members.map((item) => (item.answer === 'invited' && at - item.invitedAt > NPC_WAR_BALANCE.inviteHours * HOUR
    ? { ...item, answer: 'expired' as const, answeredAt: at, reason: 'no-answer' } : item));
  let current: NpcWar = { ...war, members, razed: war.razed + lost, targets: lost ? war.targets.filter((id) => standing.includes(id)) : war.targets };
  if (!standing.length) return closeWar(state, current, at, 'razed', actor);
  if (current.stalls >= NPC_WAR_BALANCE.stallLimit) return closeWar(state, current, at, 'broken', actor);
  if (at <= current.roundAt + current.windowMs) return members !== war.members || lost ? withNpcWar(state, current) : state;
  const launched = acceptedMembers(current).filter((item) => item.lastRound === current.round).length;
  const stalls = launched > 0 ? 0 : current.stalls + 1;
  const targets = npcWarTargetOrder(state, utility, current.offenderId);
  const gap = (launched > 0 ? NPC_WAR_BALANCE.roundGapHours : NPC_WAR_BALANCE.stallGapHours) * HOUR;
  current = { ...current, round: current.round + 1, roundAt: at + gap, stalls, targets };
  journal(at, actor, 'round', { id: war.warId, off: war.offenderId, n: current.round, at: current.roundAt, launched, stalls, standing: standing.length,
    order: targets.slice(0, 7), members: acceptedMembers(current).length });
  return withNpcWar(state, current);
}

/* ---------------------------------------------------------------- declaring */

/** Bots this one would call: those hurt by the same offender, then its own alliance (which can legally hit him). */
function inviteesFor(state: SaveState, utility: NpcUtilityContext, offenderId: string, at: number): { ownerId: string; role: NpcWarRole; rank: number }[] {
  const ownerId = utility.profile.ownerId;
  const mine = selectOwnerMembership(state.command, ownerId);
  const found: { ownerId: string; role: NpcWarRole; rank: number }[] = [];
  for (const [otherId, other] of Object.entries(state.npc?.profiles ?? {})) {
    if (otherId === ownerId || otherId === offenderId) continue;
    if (inOtherWarOrInvited(state, otherId)) continue;
    if (attackable(state, otherId, offenderId, at) !== 'ok') continue;
    const hurt = npcGrudgeIntensity(other.grudges?.[offenderId], utility.dayValue);
    const friend = Boolean(mine && selectOwnerMembership(state.command, otherId)?.alliance.id === mine.alliance.id);
    if (hurt >= 0.25) found.push({ ownerId: otherId, role: 'hurt', rank: 2 + hurt });
    else if (friend) found.push({ ownerId: otherId, role: 'friend', rank: unit(points(state, otherId) / Math.max(1, points(state, ownerId))) });
  }
  return found.sort((left, right) => right.rank - left.rank || (left.ownerId < right.ownerId ? -1 : 1));
}

const inOtherWarOrInvited = (state: SaveState, ownerId: string) => activeNpcWars(state).some((war) => {
  const own = npcWarMember(war, ownerId);
  return own?.answer === 'accepted' || own?.answer === 'invited';
});

/**
 * The war this bot would declare now, or null: a bot hurt hard enough, an
 * offender it may legally hit that is not too small, no war of its own already.
 */
export function draftNpcWar(state: SaveState, profile: NpcProfile, utility: NpcUtilityContext, at: number, ignoreCheck = false): NpcWar | null {
  const ownerId = profile.ownerId;
  if (inOtherWarOrInvited(state, ownerId)) return null;
  if (activeNpcWars(state).length >= NPC_WAR_BALANCE.maxWorldWars) return null;
  if (!ignoreCheck && at < (state.npcStrategy?.nextCheckAt[checkKey(ownerId)] ?? 0)) return null;
  const own = planetsOf(utility);
  if (!own.length) return null;
  const raceId = own[0]!.raceId;
  const catalog = getFactionShipCatalog(raceId);
  let fleet = 0;
  for (const planet of own) fleet += npcFleetValue(raceId, freeCombatShips(state, ownerId, planet, catalog, at));
  // Nothing to fight with and little to build it from: no war yet.
  if (fleet < NPC_WAR_BALANCE.minWaveDayShare * utility.dayValue && own.every((planet) => planet.resources.metal + planet.resources.minerals < 0.3 * utility.dayValue)) return null;
  const offenders = Object.keys(profile.grudges ?? {}).filter((id) => id !== ownerId)
    .map((id) => ({ id, fury: npcWarFury(utility, id, at) }))
    .filter((item) => item.fury >= NPC_WAR_BALANCE.declareFury)
    .sort((left, right) => right.fury - left.fury || (left.id < right.id ? -1 : 1));
  for (const { id: offenderId } of offenders) {
    if (activeNpcWars(state).some((war) => war.offenderId === offenderId)) continue; // the others' war is joined, not doubled
    if (attackable(state, ownerId, offenderId, at) !== 'ok') continue;
    if (points(state, offenderId) < NPC_WAR_BALANCE.pointsShare * points(state, ownerId)) continue;
    const targets = npcWarTargetOrder(state, utility, offenderId);
    if (!targets.length) continue;
    const invited = inviteesFor(state, utility, offenderId, at).slice(0, NPC_WAR_BALANCE.maxMembers - 1);
    return {
      warId: `war:${ownerId}:${at}`, offenderId, leaderId: ownerId, status: 'active', createdAt: at,
      members: [member(ownerId, 'leader', 'accepted', at), ...invited.map((item) => member(item.ownerId, item.role, 'invited', at))],
      round: 1, roundAt: at + NPC_WAR_BALANCE.firstRoundHours * HOUR, windowMs: NPC_WAR_BALANCE.windowHours * HOUR,
      targets, stalls: 0, waves: 0, wins: 0, razed: 0,
    };
  }
  return null;
}

/** Marks the owner's next look for a war after a look that found none (keeps the search rare). */
export function scheduleNpcWarCheck(state: SaveState, ownerId: string, at: number): SaveState {
  const strategy = state.npcStrategy ?? createNpcStrategyState();
  if ((strategy.nextCheckAt[checkKey(ownerId)] ?? 0) > at) return state;
  return { ...state, npcStrategy: { ...strategy, nextCheckAt: { ...strategy.nextCheckAt, [checkKey(ownerId)]: at + NPC_WAR_BALANCE.checkHours * HOUR } } };
}

/* -------------------------------------------------------------- the choices */

function reportOf(utility: NpcUtilityContext, planetId: string): SpyReportSnapshot | undefined {
  return utility.latestReports.get(planetId);
}

const hasNews = (report: SpyReportSnapshot | undefined): report is SpyReportSnapshot => Boolean(report && (report.fleet !== undefined || report.defense !== undefined));

const MOVABLE_RECYCLERS = ['recycler'] as const;

/** The planets the combat fleet is kept on: the owner's planets nearest the target, about half of them. */
export function npcWarStagingPlanets(own: readonly SpyTargetState[], target: SpyTargetState): SpyTargetState[] {
  return [...own].sort((left, right) => distance(left, target) - distance(right, target) || (left.id < right.id ? -1 : 1))
    .slice(0, Math.max(1, Math.ceil(own.length / 2)));
}

export function getNpcWarChoices(state: SaveState, profile: NpcProfile, utility: NpcUtilityContext, at: number, timeScale: number,
  missions: readonly NpcMissionCandidate[], scored: (candidateId: string, estimate: number) => number): NpcPlanChoice[] {
  const ownerId = profile.ownerId;
  const choices: NpcPlanChoice[] = [];
  const war = activeNpcWarOf(state, ownerId);
  if (!war) {
    const draft = draftNpcWar(state, profile, utility, at);
    if (draft) {
      const id = `war:declare:${draft.offenderId}`;
      choices.push({ must: true, candidate: { id, kind: 'plan-step', weight: scored(id, 1.5), payload: { planetId: planetsOf(utility)[0]?.id ?? '' } }, run: (current) => {
        // Taken again at the look's own time: another bot may have declared on the same offender since this was weighed.
        const fresh = draftNpcWar(current, profile, utility, at, true);
        if (!fresh || fresh.offenderId !== draft.offenderId) return { state: current, started: false, reason: 'war-not-needed' };
        journal(at, ownerId, 'declared', { id: fresh.warId, off: fresh.offenderId, g: round3(npcWarFury(utility, fresh.offenderId, at)),
          first: fresh.roundAt, order: fresh.targets.slice(0, 7),
          invited: fresh.members.filter((item) => item.answer === 'invited').map((item) => [item.ownerId, item.role]) });
        return { state: withNpcWar(current, fresh), started: true, reason: null };
      } });
    }
    return choices;
  }
  const focusId = npcWarFocus(state, war);
  const target = focusId ? state.espionage?.targets?.[focusId] : undefined;
  const mine = npcWarMember(war, ownerId)!;
  const own = planetsOf(utility);
  if (!focusId || !target || !own.length) return choices;
  const raceId = own[0]!.raceId;
  const catalog = getFactionShipCatalog(raceId);
  const dayValue = Math.max(1, utility.dayValue);
  const fury = npcWarFury(utility, war.offenderId, at);
  const free = new Map(own.map((planet) => [planet.id, freeCombatShips(state, ownerId, planet, catalog, at)]));
  const value = (planet: SpyTargetState) => npcFleetValue(raceId, free.get(planet.id) ?? {});
  const flightMs = (planet: SpyTargetState, ships: Readonly<Record<string, number>>) => npcFleetFlightMs(planet, target, ships, timeScale);
  const staging = npcWarStagingPlanets(own, target);
  const stagingIds = new Set(staging.map((planet) => planet.id));
  const report = reportOf(utility, target.id);
  const preparing = at >= war.roundAt - NPC_WAR_BALANCE.prepHours * HOUR && at <= war.roundAt + war.windowMs;

  // Brought to the staging planets before the round: combat ships to the planets nearest the target, recyclers to one of them.
  if (preparing) {
    const room = new Map(staging.map((planet) => [planet.id, npcDeploymentFreeCapacity(planet)]));
    for (const planet of own) {
      if (stagingIds.has(planet.id)) continue;
      const ships = free.get(planet.id) ?? {};
      if (value(planet) < NPC_WAR_BALANCE.stageDayShare * dayValue) continue;
      const population = fleetPopulationOf(raceId, ships);
      const destination = [...staging].filter((item) => (room.get(item.id) ?? 0) >= population)
        .sort((left, right) => (room.get(right.id) ?? 0) - (room.get(left.id) ?? 0) || (left.id < right.id ? -1 : 1))[0];
      // It must arrive before the round, or it flies from where it stands.
      if (!destination || at + npcFleetFlightMs(planet, destination, ships, timeScale) >= war.roundAt - NPC_WAR_BALANCE.earlyMinutes * MINUTE) continue;
      room.set(destination.id, (room.get(destination.id) ?? 0) - population);
      const id = `war:stage:${war.warId}:${planet.id}`;
      choices.push({ candidate: { id, kind: 'plan-step', weight: utilityToWeight(2), payload: { planetId: planet.id } }, run: (current, key) => {
        const result = dispatchNpcDeployment(current, { requestId: key, ownerId, originPlanetId: planet.id, destinationPlanetId: destination.id,
          selectedShips: ships as Partial<Record<ShipId, number>> }, at, timeScale);
        if (result.ok && npcFleetValue(raceId, ships) >= 0.25 * dayValue) journal(at, ownerId, 'stage', { id: war.warId, from: planet.id, to: destination.id, v: Math.round(npcFleetValue(raceId, ships)) });
        return { state: result.state, started: result.ok, reason: result.reason, planetId: planet.id };
      } });
    }
    const base = staging[0]!;
    for (const planet of own) {
      if (planet.id === base.id) continue;
      const available = getNpcMissionAvailableFleet(state, ownerId, planet.id) ?? {};
      const recyclers: Record<string, number> = {};
      for (const shipId of MOVABLE_RECYCLERS) if ((available[shipId as ShipId] ?? 0) > 0) recyclers[shipId] = Math.floor(available[shipId as ShipId] ?? 0);
      if (!Object.keys(recyclers).length) continue;
      if (at + npcFleetFlightMs(planet, base, recyclers, timeScale) >= war.roundAt - NPC_WAR_BALANCE.earlyMinutes * MINUTE) continue;
      if ((room.get(base.id) ?? npcDeploymentFreeCapacity(base)) < fleetPopulationOf(raceId, recyclers)) continue;
      const id = `war:recyclers:${war.warId}:${planet.id}`;
      choices.push({ candidate: { id, kind: 'plan-step', weight: utilityToWeight(1.6), payload: { planetId: planet.id } }, run: (current, key) => {
        const result = dispatchNpcDeployment(current, { requestId: key, ownerId, originPlanetId: planet.id, destinationPlanetId: base.id,
          selectedShips: recyclers as Partial<Record<ShipId, number>> }, at, timeScale);
        return { state: result.state, started: result.ok, reason: result.reason, planetId: planet.id };
      } });
    }
  }

  // Scouting of the focus planet: before the round, unless the news is young enough.
  const reconDue = at >= war.roundAt - NPC_WAR_BALANCE.reconHours * HOUR && at <= war.roundAt + war.windowMs;
  const stale = !hasNews(report) || at - report.createdAt > NPC_WAR_BALANCE.reconFreshHours * HOUR / Math.max(1, timeScale);
  const probing = ownerFlights(state.flights.records, ownerId).some((flight) => flight.ownerSide === 'npc' && flight.missionId === 'espionage'
    && flight.destinationPlanetId === target.id && (flight.phase === 'outbound' || flight.phase === 'arrived'));
  if (reconDue && stale && !probing) {
    const probe = missions.find((mission) => mission.kind === 'espionage' && mission.payload.destinationPlanetId === target.id);
    if (probe) {
      const id = `war:recon:${war.warId}`;
      choices.push({ must: true, candidate: { id, kind: 'plan-step', weight: utilityToWeight(2), payload: { planetId: String(probe.payload.originPlanetId) } }, run: (current, key) => {
        const command = candidateToNpcMissionCommand(probe, ownerId, key);
        if (!command) return { state: current, started: false, reason: 'invalid-mission-candidate' };
        const result = dispatchNpcMission(current, command, at, timeScale);
        return { state: result.state, started: result.ok, reason: result.reason, planetId: command.originPlanetId };
      } });
    }
  }

  // The round's waves: every planet with a fleet strikes, the cheap fleets first (they strip the defence), the main ones after.
  // No win chance is weighed: a furious bot spends ships to break through. Cargo follows only a wave it believes wins.
  const early = NPC_WAR_BALANCE.earlyMinutes * MINUTE;
  const late = war.roundAt + war.windowMs;
  // One wave from a planet per round: what comes home or is built meanwhile waits for the next one, never a trickle.
  const launched = new Set(ownerFlights(state.flights.records, ownerId).filter((flight) => flight.ownerSide === 'npc' && flight.missionId === 'attack'
    && flight.destinationPlanetId === target.id && flight.departedAt > war.roundAt - NPC_WAR_BALANCE.prepHours * HOUR).map((flight) => flight.originPlanetId));
  const wanted = own.filter((planet) => !launched.has(planet.id) && value(planet) >= NPC_WAR_BALANCE.minWaveDayShare * dayValue)
    .sort((left, right) => value(left) - value(right) || (left.id < right.id ? -1 : 1));
  let rank = 0;
  const relation = getOwnerRelation(state, ownerId, war.offenderId);
  for (const planet of wanted) {
    const ships = free.get(planet.id) ?? {};
    const arrives = at + flightMs(planet, ships);
    if (arrives < war.roundAt - early || arrives > late) continue;
    // Pointless waves are skipped, once per round in the journal.
    let skip: string | null = null;
    if (relation !== 'enemy' && relation !== 'neutral') skip = 'ally';
    else if (!report) skip = 'no-intel';
    else {
      const gate = attackable(state, ownerId, war.offenderId, at);
      if (gate === 'shield') skip = 'shield';
      else if (gate !== 'ok') skip = gate;
    }
    if (skip) {
      if (mine.lastSkip < war.round) choices.push({ candidate: { id: `war:skip:${war.warId}:${war.round}`, kind: 'plan-step', weight: 0.0001, payload: { planetId: planet.id } }, must: true, run: (current) => {
        journal(at, ownerId, 'skip', { id: war.warId, round: war.round, why: skip, to: target.id });
        const latest = activeNpcWarOf(current, ownerId);
        const own2 = latest && npcWarMember(latest, ownerId);
        return { state: latest && own2 ? withNpcWar(current, withNpcWarMember(latest, { ...own2, lastSkip: war.round })) : current, started: false, reason: skip };
      } });
      break;
    }
    const myRank = rank++;
    const id = `war:wave:${war.warId}:${pad(myRank)}:${planet.id}`;
    choices.push({ must: true, candidate: { id, kind: 'plan-step', weight: utilityToWeight(2.4), payload: { planetId: planet.id } }, run: (current, key) => {
      const origin = current.espionage?.targets?.[planet.id];
      const goal = current.espionage?.targets?.[target.id];
      if (!origin || !goal || goal.ownerId !== war.offenderId) return { state: current, started: false, reason: 'war-target-lost' };
      const sendable = freeCombatShips(current, ownerId, origin, catalog, at);
      if (npcFleetValue(raceId, sendable) < NPC_WAR_BALANCE.minWaveDayShare * dayValue) return { state: current, started: false, reason: 'war-no-fleet', planetId: planet.id };
      const main = npcMainCommander(profile.traits);
      const shape = report?.fleet ? npcEnemyShape(report.targetRaceId as CombatFactionId, report.fleet) : null;
      const command = { ownerId, originPlanetId: planet.id, requestId: key, missionId: 'attack' as const, selectedShips: sendable as Partial<Record<ShipId, number>>,
        destination: { kind: 'planet' as const, planetId: goal.id, coordinate: { ...goal.coordinate } },
        targetPlanetId: goal.id, targetRelation: relation as 'enemy' | 'neutral',
        ...((origin.fleet.commanders?.[main] ?? 0) > 0 ? { selectedCommanders: { [main]: 1 } } : {}),
        attackPriority: npcCombatPriority(profile.traits, origin.ownerProfile?.commanderLevels ?? {}, shape, COMMANDER_IDS) };
      const result = dispatchNpcMission(current, command, at, timeScale);
      if (!result.ok || !result.flight) return { state: result.state, started: false, reason: result.reason, planetId: planet.id };
      const bearing = activeNpcWarOf(result.state, ownerId);
      const mineNow = bearing && npcWarMember(bearing, ownerId);
      let after = result.state;
      if (bearing && mineNow) after = withNpcWar(after, withNpcWarMember(bearing, { ...mineNow, lastRound: war.round, waves: mineNow.waves + 1 }));
      journal(at, ownerId, 'wave', { id: war.warId, round: war.round, rank: myRank, from: planet.id, to: goal.id, v: Math.round(npcFleetValue(raceId, sendable)),
        arr: result.flight.arrivalAt, g: round3(fury) });
      if (hasNews(report) && estimateRaidWin(utility, origin, report, sendable as Partial<Record<ShipId, number>>) >= NPC_WAR_BALANCE.holdsWin) {
        const loot = dispatchNpcLootWaves(after, command, result.flight, report, false, at, timeScale);
        if (loot.waves > 0) after = loot.state;
      }
      return { state: after, started: true, reason: null, planetId: planet.id };
    } });
  }

  // Between and before rounds: the bot builds the fleet it lost, with what its planets can spend on it.
  const total = own.reduce((sum, planet) => sum + value(planet), 0)
    + ownerFlights(state.flights.records, ownerId).filter((flight) => flight.ownerSide === 'npc' && ['outbound', 'arrived', 'returning'].includes(flight.phase)
      && (flight.missionId === 'attack' || flight.missionId === 'deployment'))
      .reduce((sum, flight) => sum + npcFleetValue(raceId, flight.selectedShips as Record<string, number>), 0);
  if (total < NPC_WAR_BALANCE.buildTargetDays * dayValue) {
    // On the staging planets only: the new ships stand where the round is fought from, nothing is carried around.
    for (const planet of staging) {
      const queue = (planet as SpyTargetState & { fleetProduction?: { shipQueue?: { finishAt: number }[] } }).fleetProduction?.shipQueue ?? [];
      if (queue.length > 0) continue;
      const hulls = combatShipsOf(catalog);
      const options = getNpcFleetProductionCandidates(planet, ownerId, at, timeScale, flownPopulation(state, ownerId, planet))
        .filter((preview) => preview.available && preview.queueKind === 'ships' && hulls.some((entity) => entity.id === preview.itemId))
        .sort((left, right) => combatEfficiency(hulls.find((entity) => entity.id === right.itemId)) - combatEfficiency(hulls.find((entity) => entity.id === left.itemId))
          || (left.itemId < right.itemId ? -1 : 1));
      const best = options[0];
      if (!best) continue;
      const id = `war:build:${war.warId}:${planet.id}:${best.itemId}`;
      choices.push({ candidate: { id, kind: 'plan-step', weight: scored(id, 0.8 + 0.8 * fury), payload: { planetId: planet.id } }, run: (current, key) => {
        const planetNow = current.espionage?.targets?.[planet.id];
        if (!planetNow || planetNow.ownerId !== ownerId) return { state: current, started: false, reason: 'plan-planet-lost' };
        const reserved = flownPopulation(current, ownerId, planetNow);
        let quantity = Math.max(1, Math.min(...(['metal', 'minerals', 'gas'] as const).map((resource) => (best.cost[resource] > 0
          ? Math.floor(NPC_WAR_BALANCE.buildBudgetShare * planetNow.resources[resource] / best.cost[resource]) : Number.MAX_SAFE_INTEGER))));
        let built = startNpcFleetProduction(planetNow, ownerId, 'ships', best.itemId, at, timeScale, key, reserved, quantity);
        while (!built.ok && quantity > 1) {
          quantity = Math.floor(quantity / 2);
          built = startNpcFleetProduction(planetNow, ownerId, 'ships', best.itemId, at, timeScale, key, reserved, quantity);
        }
        if (!built.ok) return { state: current, started: false, reason: built.reason, planetId: planet.id };
        const moved = { ...current, espionage: { ...current.espionage!, targets: { ...current.espionage!.targets, [planet.id]: built.target } } };
        return { state: moved, started: true, reason: null, planetId: planet.id, ...(built.orderId ? { economyActionId: built.orderId } : {}) };
      } });
      break; // one yard at a time: the bot's own economy keeps the rest
    }
  }
  return choices;
}

/* ------------------------------------------------------------------ battles */

/** A member's battle on the offender counts for the war (called by the battle hook); the journal sees how the wave went. */
export function recordNpcWarBattle(state: SaveState, report: BattleReport, at: number, loss: number, gain: number): SaveState {
  const attackerId = report.attacker.playerId;
  const defenderId = report.defender.playerId;
  if (!attackerId || !defenderId || report.missionType !== 'attack') return state;
  const war = activeNpcWars(state).find((item) => item.offenderId === defenderId && npcWarMember(item, attackerId)?.answer === 'accepted');
  if (!war) return state;
  const won = report.winner === 'attacker';
  journal(at, attackerId, 'wave-result', { id: war.warId, round: war.round, off: defenderId, won: won ? 1 : 0, loss: Math.round(loss), gain: Math.round(gain) });
  return withNpcWar(state, { ...war, waves: war.waves + 1, wins: war.wins + (won ? 1 : 0) });
}
