/**
 * Revenge war (owner decision 09.11.2026, variant B). A bot (or several bots
 * hurt by the same offender) wages a planned series of attacks on one offender
 * the way a furious player does: an agreed rough time, fleets brought to the
 * planets nearest the target, the target scouted, then waves from many planets
 * and many bots, round after round, whatever the win chance of one wave.
 *
 * A war is data in the save (so the server and the client play it the same and
 * a reload loses nothing). It grants nothing: every step runs through the
 * canonical command a player would use, which still checks what is legal.
 */

export type NpcWarStatus = 'active' | 'ended';

export type NpcWarRole = 'leader' | 'hurt' | 'friend';

/** `invited`: waiting for the answer; `accepted`: in the war; `declined`/`left`/`expired`: out of it. */
export type NpcWarAnswer = 'invited' | 'accepted' | 'declined' | 'left' | 'expired';

export type NpcWarMember = Readonly<{
  ownerId: string;
  role: NpcWarRole;
  answer: NpcWarAnswer;
  invitedAt: number;
  answeredAt?: number;
  /** Why it said no, left or was dropped. */
  reason?: string;
  /** Round of this member's last launch (0: none yet), and the waves it has sent in all. */
  lastRound: number;
  waves: number;
  /** Round in which a skipped wave was last written to the journal (once per round). */
  lastSkip: number;
}>;

export type NpcWar = Readonly<{
  warId: string;
  offenderId: string;
  leaderId: string;
  status: NpcWarStatus;
  createdAt: number;
  closedAt?: number;
  /** Why it ended: razed, faded, broken, peace, abandoned. */
  reason?: string;
  members: readonly NpcWarMember[];
  /** Current round (1-based), about when its waves should arrive, and how long after that a late wave is still sent. */
  round: number;
  roundAt: number;
  windowMs: number;
  /** The offender's planets in the order they are to be hit: the first one standing is the focus. */
  targets: readonly string[];
  /** Rounds in a row in which nobody launched. */
  stalls: number;
  /** Battles of members' waves on the offender: all, won, and the planets of the offender lost since the war began. */
  waves: number;
  wins: number;
  razed: number;
}>;

export const NPC_WARS_KEPT = 8;

const isId = (value: unknown): value is string => typeof value === 'string' && value.length > 0;
const isTime = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) >= 0;

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function isMember(value: unknown): value is NpcWarMember {
  return isRecord(value) && isId(value.ownerId) && ['leader', 'hurt', 'friend'].includes(String(value.role))
    && ['invited', 'accepted', 'declined', 'left', 'expired'].includes(String(value.answer))
    && isTime(value.invitedAt) && (value.answeredAt === undefined || isTime(value.answeredAt))
    && (value.reason === undefined || typeof value.reason === 'string')
    && isTime(value.lastRound) && isTime(value.waves) && isTime(value.lastSkip);
}

export function isNpcWar(value: unknown): value is NpcWar {
  return isRecord(value) && isId(value.warId) && isId(value.offenderId) && isId(value.leaderId)
    && ['active', 'ended'].includes(String(value.status)) && isTime(value.createdAt)
    && (value.closedAt === undefined || isTime(value.closedAt)) && (value.reason === undefined || typeof value.reason === 'string')
    && Array.isArray(value.members) && value.members.every(isMember)
    && isTime(value.round) && isTime(value.roundAt) && isTime(value.windowMs)
    && Array.isArray(value.targets) && value.targets.every(isId)
    && isTime(value.stalls) && isTime(value.waves) && isTime(value.wins) && isTime(value.razed);
}
