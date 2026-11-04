import { pickLeaderSuccessor } from '../domain/command/membership.ts';
import { selectAllianceRelations } from '../domain/command/diplomacy.ts';
import { isAllianceFull, selectOwnerMembership, selectReapplyBlock } from '../domain/command/selectors.ts';
import type { AllianceRecord, CommandState } from '../domain/command/types.ts';
import type { NpcProfile } from '../domain/npc/types.ts';
import { selectOwnerScore } from '../domain/rating/scoring.ts';
import type { SaveState } from './contracts.ts';
import { npcGroupRegard, npcRegard, recordNpcRelation } from './npc-relations.ts';

/**
 * Which alliance an NPC wants, when it would leave and who is remembered for
 * leaving (owner order 04.11.2026). Only public information is read: the
 * members of an alliance and their points by type, the alliance's wars. The
 * numbers are decision weights of the bots, not game rules. The player gets no
 * special case: he is a member like any other, strong or weak by his points.
 */
export const NPC_ALLIANCE_CHOICE = Object.freeze({
  /** Share of the join score that does not depend on the alliance's strength. */
  baseShare: 0.15,
  /** A fresh member does not look around yet. */
  minTenureMs: 24 * 3_600_000,
  /** One departure per this long, at most. */
  pauseAfterLeavingMs: 72 * 3_600_000,
  /** A better alliance must beat the own one by this much of its fit before it tempts. */
  fitGapToLeave: 0.25,
  /** Regard of the own alliance's members under which the owner stops feeling at home. */
  regardToLeave: -0.15,
  /** A war against an alliance this much stronger in total points counts as being lost. */
  losingWarRatio: 1.5,
  /** Below this the owner stays. */
  restlessnessToLeave: 0.15,
  /** A member refuses a former colleague who attacked the alliance. */
  vetoRegard: -0.25,
});

const clamp01 = (value: number) => (Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0);

export type AllianceStrength = Readonly<{ id: string; size: number; combat: number; resource: number; total: number }>;

/** Public points of the members of every alliance, summed by type. */
export function selectAllianceStrengths(state: SaveState): Map<string, AllianceStrength> {
  const strengths = new Map<string, AllianceStrength>();
  for (const alliance of state.command.alliances) {
    let combat = 0;
    let resource = 0;
    let total = 0;
    for (const member of alliance.members) {
      const score = selectOwnerScore(state, member.ownerId);
      combat += score?.battlePoints ?? 0;
      resource += score?.resourcePoints ?? 0;
      total += score?.totalPoints ?? 0;
    }
    strengths.set(alliance.id, { id: alliance.id, size: alliance.members.length, combat, resource, total });
  }
  return strengths;
}

/** What this owner looks for in an alliance: warriors, a rich economy, or just strength. Sums to 1. */
export function npcAllianceTaste(profile: NpcProfile): Readonly<{ combat: number; resource: number; any: number }> {
  const traits = profile.traits;
  const combat = clamp01(0.65 * traits.militaryFocus + 0.35 * traits.aggression);
  const resource = clamp01(traits.economyFocus);
  const sum = combat + resource + 0.15;
  return { combat: combat / sum, resource: resource / sum, any: 0.15 / sum };
}

/** 0..1: how well an alliance matches the taste, against the best one in the world by type. */
export function allianceFit(
  taste: ReturnType<typeof npcAllianceTaste>,
  strength: AllianceStrength,
  best: Readonly<{ combat: number; resource: number; total: number }>,
): number {
  const share = (value: number, top: number) => (top > 0 ? Math.sqrt(clamp01(value / top)) : 0);
  return clamp01(taste.combat * share(strength.combat, best.combat)
    + taste.resource * share(strength.resource, best.resource)
    + taste.any * share(strength.total, best.total));
}

export function bestStrengths(strengths: ReadonlyMap<string, AllianceStrength>) {
  let combat = 0;
  let resource = 0;
  let total = 0;
  for (const value of strengths.values()) {
    combat = Math.max(combat, value.combat);
    resource = Math.max(resource, value.resource);
    total = Math.max(total, value.total);
  }
  return { combat, resource, total };
}

/** Multiplier of a join score: the strong and the fitting draw applicants, the weak and the odd do not. */
export function joinPull(fit: number): number {
  return NPC_ALLIANCE_CHOICE.baseShare + (1 - NPC_ALLIANCE_CHOICE.baseShare) * fit * fit;
}

/** Last time this owner left any alliance, or null. */
function lastDepartureAt(command: CommandState, ownerId: string): number | null {
  let last: number | null = null;
  for (const entry of command.departures ?? []) if (entry.ownerId === ownerId && entry.cause === 'left') last = Math.max(last ?? 0, entry.at);
  return last;
}

/** Alliances the owner left recently: it does not apply to them again at once. */
export function recentlyLeftAlliances(command: CommandState, ownerId: string, at: number): ReadonlySet<string> {
  return new Set((command.departures ?? [])
    .filter((entry) => entry.ownerId === ownerId && entry.cause === 'left' && at - entry.at < NPC_ALLIANCE_CHOICE.pauseAfterLeavingMs)
    .map((entry) => entry.allianceId));
}

/** Members of the alliance who keep a mind of their own (NPC), by id. */
function npcMembers(state: SaveState, alliance: AllianceRecord): string[] {
  return alliance.members.map((member) => member.ownerId).filter((id) => state.npc?.profiles[id]);
}

/**
 * Would the members of `alliance` refuse this applicant for what they remember
 * of it? The answering owner's own regard decides alone, or the NPC members'
 * mean regard (those who have an opinion at all).
 */
export function npcAllianceVeto(state: SaveState, alliance: AllianceRecord, answerer: NpcProfile, applicantId: string, at: number): boolean {
  if (npcRegard(state, answerer, applicantId, at) <= NPC_ALLIANCE_CHOICE.vetoRegard) return true;
  let sum = 0;
  let known = 0;
  for (const id of npcMembers(state, alliance)) {
    if (id === answerer.ownerId) continue;
    const profile = state.npc!.profiles[id]!;
    const regard = npcRegard(state, profile, applicantId, at);
    if (regard === 0) continue;
    sum += regard;
    known += 1;
  }
  return known > 0 && sum / known <= NPC_ALLIANCE_CHOICE.vetoRegard;
}

export type NpcDefection = Readonly<{ score: number; successorOwnerId: string | null }>;

/** True while the alliance has something at stake that a defector would forfeit or break. */
function allianceHoldsStakes(state: SaveState, allianceId: string): boolean {
  const sun = state.sunRaid;
  if (!sun) return false;
  if (sun.campaignResult) return true;
  if ((sun.crystals[`alliance:${allianceId}`]?.length ?? 0) > 0) return true;
  if (sun.gates.some((gate) => gate.status === 'building' && gate.holder.kind === 'alliance' && gate.holder.id === allianceId)) return true;
  return sun.raids.some((raid) => raid.allianceId === allianceId && (raid.status === 'gathering' || raid.status === 'incoming'));
}

/**
 * Whether and how badly this owner wants out of its alliance, or null to
 * stay. It leaves for a clearly better matching alliance, when it no longer
 * feels at home among the members, or when its alliance loses a war. Loyal
 * characters rarely do; nobody deserts a winning war, a leader needs a
 * successor and never hands the alliance to the player unasked.
 */
export function selectNpcDefection(state: SaveState, profile: NpcProfile, at: number): NpcDefection | null {
  const ownerId = profile.ownerId;
  const command = state.command;
  const membership = selectOwnerMembership(command, ownerId);
  if (!membership) return null;
  const { alliance, member, role } = membership;
  const rules = NPC_ALLIANCE_CHOICE;
  if (at - member.joinedAt < rules.minTenureMs) return null;
  const left = lastDepartureAt(command, ownerId);
  if (left !== null && at - left < rules.pauseAfterLeavingMs) return null;
  if (allianceHoldsStakes(state, alliance.id)) return null;

  let successorOwnerId: string | null = null;
  if (role === 'leader' && alliance.members.length > 1) {
    const playerId = state.profile.playerId;
    const successor = alliance.deputyOwnerId && alliance.deputyOwnerId !== playerId
      ? alliance.members.find((candidate) => candidate.ownerId === alliance.deputyOwnerId) ?? null
      : pickLeaderSuccessor({ ...alliance, members: alliance.members.filter((candidate) => candidate.ownerId !== playerId), deputyOwnerId: null });
    if (!successor) return null;
    successorOwnerId = successor.ownerId;
  }

  const strengths = selectAllianceStrengths(state);
  const own = strengths.get(alliance.id);
  if (!own) return null;
  const best = bestStrengths(strengths);
  const taste = npcAllianceTaste(profile);
  const ownFit = allianceFit(taste, own, best);

  let bestOther = 0;
  const left72 = recentlyLeftAlliances(command, ownerId, at);
  for (const other of command.alliances) {
    if (other.id === alliance.id || isAllianceFull(other) || left72.has(other.id) || selectReapplyBlock(command, ownerId, other.id, at)) continue;
    if (npcGroupRegard(state, profile, other.members.map((entry) => entry.ownerId), at) <= rules.vetoRegard) continue;
    const strength = strengths.get(other.id);
    if (strength) bestOther = Math.max(bestOther, allianceFit(taste, strength, best));
  }
  const gapTerm = clamp01((bestOther - ownFit - rules.fitGapToLeave) / 0.5);

  const colleagues = alliance.members.map((entry) => entry.ownerId).filter((id) => id !== ownerId);
  const regard = npcGroupRegard(state, profile, colleagues, at);
  const unhappyTerm = clamp01((rules.regardToLeave - regard) / 0.5);

  let warTerm = 0;
  let winning = false;
  for (const relation of selectAllianceRelations(command, alliance.id)) {
    if (relation.status !== 'war') continue;
    const enemy = strengths.get(relation.id);
    if (!enemy) continue;
    if (own.total >= enemy.total) winning = true;
    else if (enemy.total >= rules.losingWarRatio * Math.max(1, own.total)) warTerm = Math.max(warTerm, 0.6);
  }
  if (winning) return null;

  const discontent = Math.max(gapTerm, unhappyTerm, warTerm);
  const loyalty = clamp01(0.55 * profile.traits.cooperation + 0.25 * profile.traits.persistence + 0.2 * (1 - profile.traits.adaptability));
  const restlessness = discontent * (1 - 0.9 * loyalty) * (role === 'leader' && alliance.members.length > 1 ? 0.5 : 1);
  if (restlessness < rules.restlessnessToLeave) return null;
  return { score: 0.04 + 0.3 * restlessness, successorOwnerId };
}

/** Members of the alliance the leaver walked out of who remember it: a little cooler, nothing more. */
export function recordNpcDeparture(state: SaveState, leaverId: string, alliance: AllianceRecord, at: number): SaveState {
  let next = state;
  for (const id of npcMembers(state, alliance)) if (id !== leaverId) next = recordNpcRelation(next, id, leaverId, { kind: 'withdrew' }, at);
  return next;
}
