import type { BattleReport } from '../domain/combat/report.ts';
import { calculateEffectiveFleetSpeed, calculateOneWayDurationMs } from '../domain/flights/speed.ts';
import type { ShipId } from '../domain/combat/ids.ts';
import type { SpyTargetState } from '../domain/espionage/types.ts';
import type { FlightRecord, FlightScienceLevels } from '../domain/flights/types.ts';
import {
  NPC_PROPOSALS_KEPT, type NpcGiftProposal, type NpcJointStrikeProposal, type NpcPactStatus, type NpcProposal, type NpcRobberyReaction,
} from '../domain/npc/pacts.ts';
import type { NpcRelationEvent } from '../domain/npc/relations.ts';
import { createNpcStrategyState } from '../domain/npc/strategy.ts';
import { selectOwnerScore } from '../domain/rating/scoring.ts';
import type { SaveState } from './contracts.ts';
import { getNpcJournalSink } from './npc-journal.ts';
import { npcHelpWeight, npcRelationView, recordNpcHelp, recordNpcRelation } from './npc-relations.ts';
import type { NpcPlayStyle } from './npc-style.ts';
import type { NpcStrategyDrives } from './npc-utility.ts';

/**
 * Agreements between NPC seen from the save (domain/npc/pacts.ts): what the
 * rest of the NPC code and the world's events read and write. The choosing
 * lives in npc-pacts.ts.
 */

/** Under the autonomy prefix: the save keeps only NPC flights that carry it. */
export const NPC_GIFT_REQUEST_PREFIX = 'npc-autonomy:gift:';

/** Reasons to pull out that nobody holds against a partner: the world changed under it. */
const EXCUSED_REASONS: ReadonlySet<string> = new Set(['threat-at-home', 'force-lost', 'rally-lost', 'target-gone', 'attack-not-allowed', 'hangar-full']);
/** Plan endings that are no notice at all: the partner just did not come. */
const NO_SHOW_REASONS: ReadonlySet<string> = new Set(['deadline', 'no-battle']);

export const isNpcPactOpen = (status: NpcPactStatus) => status === 'proposed' || status === 'accepted';

export function npcProposalsOf(state: SaveState, ownerId: string): readonly NpcProposal[] {
  const proposals = state.npcStrategy?.proposals;
  if (!proposals?.length) return [];
  return proposals.filter((proposal) => proposal.from === ownerId || proposal.to === ownerId);
}

/** The accepted joint strike between two owners, if any. */
export function npcPactBetween(state: SaveState, left: string, right: string): NpcJointStrikeProposal | undefined {
  return state.npcStrategy?.proposals?.find((proposal): proposal is NpcJointStrikeProposal => proposal.kind === 'joint-strike' && proposal.status === 'accepted'
    && ((proposal.from === left && proposal.to === right) || (proposal.from === right && proposal.to === left)));
}

/** Owners this one stands in an accepted joint strike with. */
export function npcActivePartners(state: SaveState, ownerId: string): ReadonlySet<string> {
  const partners = new Set<string>();
  for (const proposal of npcProposalsOf(state, ownerId)) {
    if (proposal.kind === 'joint-strike' && proposal.status === 'accepted') partners.add(proposal.from === ownerId ? proposal.to : proposal.from);
  }
  return partners;
}

/** Replaces or adds an agreement: open ones stay, the closed ones keep the newest few. */
export function withNpcPact(state: SaveState, proposal: NpcProposal): SaveState {
  const strategy = state.npcStrategy ?? createNpcStrategyState();
  const list = strategy.proposals ?? [];
  const next = list.some((item) => item.proposalId === proposal.proposalId)
    ? list.map((item) => (item.proposalId === proposal.proposalId ? proposal : item)) : [...list, proposal];
  const open = next.filter((item) => isNpcPactOpen(item.status)).length;
  const closed = next.filter((item) => !isNpcPactOpen(item.status));
  const kept = new Set(closed.slice(Math.max(0, closed.length - Math.max(0, NPC_PROPOSALS_KEPT - open))));
  return { ...state, npcStrategy: { ...strategy, proposals: next.filter((item) => isNpcPactOpen(item.status) || kept.has(item)) } };
}

/** The bot journal sees every step (owner decision 5); the game shows none of it. */
export function journalNpcPact(at: number, actor: string, event: string, proposal: NpcProposal, detail: Readonly<Record<string, string | number>> = {}): void {
  getNpcJournalSink()?.outcome?.({ at, ownerId: actor, kind: 'pact', data: {
    ev: event, id: proposal.proposalId, tp: proposal.kind, from: proposal.from, to: proposal.to,
    ...(proposal.kind === 'joint-strike' ? { target: proposal.terms.targetOwnerId, strikeAt: proposal.terms.strikeAt } : { res: proposal.terms.resource, amount: proposal.terms.amount }),
    ...detail,
  } });
}

const otherSide = (proposal: NpcProposal, ownerId: string) => (proposal.from === ownerId ? proposal.to : proposal.from);

/** Closes an agreement and lets its consequences land on what each side thinks of the other. */
export function settleNpcPact(state: SaveState, proposal: NpcProposal, status: NpcPactStatus, at: number, reason?: string, by?: string): SaveState {
  const closed: NpcProposal = { ...proposal, status, closedAt: at, ...(reason ? { reason } : {}), ...(by ? { by } : {}) };
  let next = withNpcPact(state, closed);
  const hit = (from: string, to: string, event: NpcRelationEvent) => { next = recordNpcRelation(next, from, to, event, at); };
  if (closed.kind === 'joint-strike') {
    if (status === 'fulfilled') {
      const won = Object.values(closed.arrivals ?? {}).some((arrival) => arrival.won);
      for (const [from, to] of [[closed.from, closed.to], [closed.to, closed.from]] as const) {
        hit(from, to, { kind: 'promise-kept' });
        hit(from, to, { kind: 'joint-op', won });
      }
    } else if (status === 'broken' && by) {
      hit(otherSide(closed, by), by, reason === 'betrayed' ? { kind: 'betrayed' } : { kind: 'promise-broken' });
    } else if (status === 'withdrawn' && by && !EXCUSED_REASONS.has(reason ?? '')) {
      hit(otherSide(closed, by), by, { kind: 'withdrew' });
    }
  }
  journalNpcPact(at, by ?? closed.to, status, closed, reason ? { why: reason } : {});
  return next;
}

/** A side's plan ended without its attack: a fair notice or a no-show, by why it ended. */
export function withdrawFromNpcPact(state: SaveState, proposalId: string, ownerId: string, reason: string, at: number): SaveState {
  const proposal = state.npcStrategy?.proposals?.find((item) => item.proposalId === proposalId);
  if (!proposal || proposal.status !== 'accepted' || proposal.kind !== 'joint-strike') return state;
  return settleNpcPact(state, proposal, NO_SHOW_REASONS.has(reason) ? 'broken' : 'withdrawn', at, reason, ownerId);
}

/** A side's fleet fought at the target. When both have, the agreement stands fulfilled. */
export function recordNpcPactArrival(state: SaveState, proposalId: string, ownerId: string, arrival: Readonly<{ at: number; won: boolean; gain: number; loss: number }>): SaveState {
  const proposal = state.npcStrategy?.proposals?.find((item) => item.proposalId === proposalId);
  if (!proposal || proposal.kind !== 'joint-strike') return state;
  const arrivals = { ...(proposal.arrivals ?? {}), [ownerId]: arrival };
  const updated: NpcJointStrikeProposal = { ...proposal, arrivals };
  journalNpcPact(arrival.at, ownerId, 'arrived', updated, { won: arrival.won ? 1 : 0, gain: Math.round(arrival.gain), loss: Math.round(arrival.loss) });
  if (proposal.status !== 'accepted') return withNpcPact(state, updated);
  return arrivals[proposal.from] && arrivals[proposal.to]
    ? settleNpcPact(state, updated, 'fulfilled', arrival.at)
    : withNpcPact(state, updated);
}

/** An attack on a partner while the agreement stands: it is over, and the attacked will remember. */
export function breakNpcPactByAttack(state: SaveState, report: BattleReport, at: number): SaveState {
  const attacker = report.attacker.playerId;
  const defender = report.defender.playerId;
  if (!attacker || !defender || !state.npcStrategy?.proposals?.length) return state;
  const pact = npcPactBetween(state, attacker, defender);
  return pact ? settleNpcPact(state, pact, 'broken', at, 'betrayed', attacker) : state;
}

/** A gift's flight reached its planet: only what the stores took counts. */
export function recordNpcGiftDelivery(state: SaveState, flight: FlightRecord, recipient: SpyTargetState | undefined, accepted: number, at: number): SaveState {
  const proposalId = flight.requestId.startsWith(NPC_GIFT_REQUEST_PREFIX) ? flight.requestId.slice(NPC_GIFT_REQUEST_PREFIX.length) : null;
  const proposal = proposalId ? state.npcStrategy?.proposals?.find((item): item is NpcGiftProposal => item.proposalId === proposalId && item.kind === 'resource-gift') : undefined;
  let next = state;
  if (recipient && flight.ownerId) next = recordNpcHelp(next, flight.ownerId, recipient.ownerId, accepted, npcHelpWeight(recipient.buildings, accepted), at);
  if (!proposal || proposal.status !== 'accepted') return next;
  return settleNpcPact(next, { ...proposal, delivered: accepted }, recipient ? 'fulfilled' : 'cancelled', at, recipient ? undefined : 'target-gone');
}

/** How long a fleet flies from `origin` to `target`, by the player's formula at this campaign's speed. */
export function npcFleetFlightMs(origin: SpyTargetState, target: Pick<SpyTargetState, 'coordinate'>, ships: Readonly<Record<string, number>>, timeScale: number): number {
  const speed = calculateEffectiveFleetSpeed(origin.raceId, ships as Partial<Record<ShipId, number>>, (origin.ownerProfile?.scienceLevels ?? {}) as FlightScienceLevels);
  return Math.max(1, Math.round(calculateOneWayDurationMs(origin.coordinate, target.coordinate, speed) / Math.max(1, timeScale)));
}

/**
 * What the owner dares count on from a partner: it never sees the partner's
 * fleet. Only public points against its own, cut for a partner it has reason
 * to doubt. The promise is a belief, and each side checks again before it flies.
 */
export function npcPartnerPowerBelief(state: SaveState, ownerId: string, partnerId: string, ownPower: number, at: number): number {
  const own = selectOwnerScore(state, ownerId)?.totalPoints ?? 0;
  const partner = selectOwnerScore(state, partnerId)?.totalPoints ?? 0;
  const ratio = own > 0 ? Math.min(1.5, Math.max(0.2, partner / own)) : 0.2;
  const profile = state.npc?.profiles[ownerId];
  const reliability = profile ? npcRelationView(state, profile, partnerId, at)?.reliability ?? 0.5 : 0.5;
  return ownPower * ratio * (0.4 + 0.6 * reliability);
}

/** The owner's current reaction to being robbed, if it still holds. */
export function npcReactionOf(state: SaveState, ownerId: string, at: number): NpcRobberyReaction | null {
  const reaction = state.npcStrategy?.reactions?.[ownerId];
  return reaction && reaction.until > at ? reaction : null;
}

const clampUnit = (value: number) => Math.min(1, Math.max(0, value));

/** How a reaction pushes the owner's drives while it holds. */
export function npcReactionDrives(state: SaveState, ownerId: string, at: number, drives: NpcStrategyDrives): NpcStrategyDrives {
  const reaction = npcReactionOf(state, ownerId, at);
  if (!reaction) return drives;
  switch (reaction.kind) {
    case 'fortify': return { ...drives, military: clampUnit(drives.military + 0.2), war: clampUnit(drives.war - 0.2) };
    case 'economy': return { ...drives, economy: clampUnit(drives.economy + 0.25), war: clampUnit(drives.war - 0.15) };
    case 'counter': return { ...drives, war: clampUnit(drives.war + 0.35), military: clampUnit(drives.military + 0.1) };
    case 'seek-partner': return { ...drives, diplomacy: clampUnit(drives.diplomacy + 0.3) };
  }
}

/** The play style a reaction asks for; null when none holds. */
export function npcReactionStyle(state: SaveState, ownerId: string, at: number): { style: NpcPlayStyle; reason: string } | null {
  const reaction = npcReactionOf(state, ownerId, at);
  if (!reaction) return null;
  const style: NpcPlayStyle = reaction.kind === 'fortify' ? 'fortress' : reaction.kind === 'economy' ? 'economist' : reaction.kind === 'counter' ? 'raider' : 'ally';
  return { style, reason: `robbed-${reaction.kind}` };
}
