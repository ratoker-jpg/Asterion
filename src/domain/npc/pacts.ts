/**
 * Agreements between two NPC outside any alliance (NPC intelligence ADR §6.2,
 * §7.б; owner decisions 4, 5, 9). An agreement is data in the save, hidden in
 * the game and written to the bot journal. It grants nothing: no shared
 * knowledge, no safe passage, no joint arrival rule. Each side acts through the
 * player's commands on what it knows itself, and either may say no.
 *
 * `joint-strike`: both hit one target at about the same time, each its own
 * fleet, its own flight and its own battle in the ordinary order of arrival.
 * `resource-gift`: one asks a friend for a resource it says it lacks; the
 * answer is an ordinary transport, or a refusal.
 */

export type NpcPactKind = 'joint-strike' | 'resource-gift';

export type NpcPactStatus = 'proposed' | 'accepted' | 'declined' | 'expired' | 'fulfilled' | 'withdrawn' | 'broken' | 'cancelled';

/** A side's part of a joint strike: a preference inside what its own race and sciences can build. */
export type NpcPactRole = Readonly<{
  /** First wave arrives about the agreed time, second a little later. */
  wave: 1 | 2;
  /** The hull it means to bring more of; it builds something else when it cannot. */
  hull: string;
}>;

export type NpcJointStrikeTerms = Readonly<{
  /** Public: anyone can see who holds a planet. Never what the proposer's report said of it. */
  targetPlanetId: string;
  targetOwnerId: string;
  /** About when the first wave arrives: partners agree on it only roughly (owner decision 9). */
  strikeAt: number;
  toleranceMs: number;
  fromRole: NpcPactRole;
  toRole: NpcPactRole;
}>;

export type NpcGiftTerms = Readonly<{
  resource: 'metal' | 'minerals' | 'gas';
  amount: number;
  planetId: string;
  /** The joint strike this would speed up, when there is one. */
  forProposalId?: string;
}>;

export type NpcPactArrival = Readonly<{ at: number; won: boolean; gain: number; loss: number }>;

export type NpcProposal = Readonly<{
  proposalId: string;
  from: string;
  to: string;
  createdAt: number;
  expiresAt: number;
  status: NpcPactStatus;
  decidedAt?: number;
  closedAt?: number;
  /** Why it was refused, withdrawn or broken. */
  reason?: string;
  /** Who pulled out or broke it. */
  by?: string;
  /** Battles each side really fought at the target (joint strike). */
  arrivals?: Readonly<Record<string, NpcPactArrival>>;
  /** Resources that really reached the planet (gift). */
  delivered?: number;
} & ({ kind: 'joint-strike'; terms: NpcJointStrikeTerms } | { kind: 'resource-gift'; terms: NpcGiftTerms })>;

export type NpcJointStrikeProposal = Extract<NpcProposal, { kind: 'joint-strike' }>;
export type NpcGiftProposal = Extract<NpcProposal, { kind: 'resource-gift' }>;

/** One transport to a friend, from its dispatch on: the budget and the guard against gift cycles read this. */
export type NpcGiftRecord = Readonly<{ from: string; to: string; amount: number; at: number }>;

/**
 * What an owner made of being robbed again and again (ADR §7.г, U42–U44): the
 * same blows, different people. Held for a while, then thought over again.
 */
export type NpcRobberyReactionKind = 'fortify' | 'economy' | 'counter' | 'seek-partner';

export type NpcRobberyReaction = Readonly<{
  kind: NpcRobberyReactionKind;
  /** Who it blames most. */
  offender?: string;
  since: number;
  until: number;
}>;

export const NPC_PROPOSALS_KEPT = 64;
export const NPC_GIFTS_KEPT = 64;

const isId = (value: unknown): value is string => typeof value === 'string' && value.length > 0;
const isTime = (value: unknown) => Number.isSafeInteger(value) && Number(value) >= 0;
const isFinite = (value: unknown) => typeof value === 'number' && Number.isFinite(value);

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function isRole(value: unknown): boolean {
  return isRecord(value) && (value.wave === 1 || value.wave === 2) && isId(value.hull);
}

const STATUSES: readonly string[] = ['proposed', 'accepted', 'declined', 'expired', 'fulfilled', 'withdrawn', 'broken', 'cancelled'];

export function isNpcProposal(value: unknown): value is NpcProposal {
  if (!isRecord(value) || !isId(value.proposalId) || !isId(value.from) || !isId(value.to) || value.from === value.to
    || !isTime(value.createdAt) || !isTime(value.expiresAt) || !STATUSES.includes(String(value.status))
    || (value.decidedAt !== undefined && !isTime(value.decidedAt)) || (value.closedAt !== undefined && !isTime(value.closedAt))
    || (value.reason !== undefined && typeof value.reason !== 'string') || (value.by !== undefined && !isId(value.by))
    || (value.delivered !== undefined && !isTime(value.delivered))
    || (value.arrivals !== undefined && !(isRecord(value.arrivals) && Object.values(value.arrivals).every((item) => isRecord(item)
      && isTime(item.at) && typeof item.won === 'boolean' && isFinite(item.gain) && isFinite(item.loss)))) || !isRecord(value.terms)) return false;
  const terms = value.terms;
  if (value.kind === 'joint-strike') {
    return isId(terms.targetPlanetId) && isId(terms.targetOwnerId) && isTime(terms.strikeAt) && isTime(terms.toleranceMs)
      && isRole(terms.fromRole) && isRole(terms.toRole);
  }
  return value.kind === 'resource-gift' && ['metal', 'minerals', 'gas'].includes(String(terms.resource))
    && isTime(terms.amount) && isId(terms.planetId) && (terms.forProposalId === undefined || isId(terms.forProposalId));
}

export function isNpcGiftRecord(value: unknown): value is NpcGiftRecord {
  return isRecord(value) && isId(value.from) && isId(value.to) && isTime(value.amount) && isTime(value.at);
}

export function isNpcRobberyReaction(value: unknown): value is NpcRobberyReaction {
  return isRecord(value) && ['fortify', 'economy', 'counter', 'seek-partner'].includes(String(value.kind))
    && (value.offender === undefined || isId(value.offender)) && isTime(value.since) && isTime(value.until);
}

/** Is there a chain of gifts from `from` back to itself? The guard's own check and the lab's. */
export function npcGiftCycles(gifts: readonly NpcGiftRecord[], windowMs: number): number {
  const sorted = [...gifts].sort((left, right) => left.at - right.at);
  let cycles = 0;
  sorted.forEach((gift, index) => {
    // Walk forward in time from the gift's recipient: does the wealth come back to the sender within the window?
    const reached = new Set([gift.to]);
    for (const later of sorted.slice(index + 1)) {
      if (later.at - gift.at > windowMs) break;
      if (!reached.has(later.from)) continue;
      if (later.to === gift.from) { cycles += 1; return; }
      reached.add(later.to);
    }
  });
  return cycles;
}
