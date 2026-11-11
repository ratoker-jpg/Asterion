/**
 * Bot letters to the player («Сообщения» → «Личные», owner request 11.11.2026).
 * A joint-strike invitation is an ordinary `NpcProposal` addressed to the
 * player (domain/npc/pacts.ts); everything else a bot writes is a record here.
 * Both live in the save, so a reload, the catch-up and the server world keep
 * them, and the bot acts on the player's answer in its own next look.
 *
 * Numbers are the bots' manners (owner may change them), not game rules.
 */

export type NpcLetterKind = 'help-request' | 'ally-offer' | 'reply';

/**
 * `new`: waiting for the player. `accepted`: said yes, the promise is open.
 * `kept`/`failed`: the promise came true or did not. `declined`/`expired`: no.
 * `info`: a reply, nothing to answer.
 */
export type NpcLetterStatus = 'new' | 'accepted' | 'declined' | 'expired' | 'kept' | 'failed' | 'info';

/** Why a bot writes back unasked. */
export type NpcReplyCause = 'declined' | 'no-show' | 'betrayed';
export type NpcReplyTone = 'warm' | 'cold' | 'angry';

export type NpcLetterRecord = Readonly<{
  letterId: string;
  kind: NpcLetterKind;
  /** The bot that wrote. */
  from: string;
  createdAt: number;
  /** After this the letter has no live buttons. */
  expiresAt: number;
  status: NpcLetterStatus;
  decidedAt?: number;
  closedAt?: number;
  /** Why it failed or was refused, for the bot journal and the card. */
  reason?: string;
  /** help-request: the bot's planet under attack, who attacks it, when the first fleet lands. */
  planetId?: string;
  attackerId?: string;
  arrivalAt?: number;
  /** ally-offer: the alliance the bot leads. */
  allianceId?: string;
  /** reply: what it answers and in which tone. */
  cause?: NpcReplyCause;
  tone?: NpcReplyTone;
}>;

export const NPC_LETTER_BALANCE = Object.freeze({
  /** Any one bot writes the player an invitation or request at most this often. */
  perBotHours: 48,
  /** After a «Отказаться» the same bot stays quiet this long. */
  afterDeclineHours: 96,
  /** All bots together: new invitations and requests within any rolling day. */
  perDay: 4,
  /** Letters waiting for an answer at once; a fifth never piles on. */
  openMax: 3,
  /** A bot's unasked reply (declined, no-show, betrayal): once per bot in this window. */
  replyPerBotHours: 24,
  /** Joint-strike invitation to the player: time to answer and to prepare. */
  inviteAnswerHours: 12,
  inviteMinLeadHours: 6,
  /** Help request: needs at least this much before the first enemy fleet lands, and closes when it lands. */
  helpMinLeadMinutes: 20,
  /** Ally offer stands this long; the same alliance asks again no sooner than allyAgainHours. */
  allyAnswerHours: 24,
  allyAgainHours: 72,
  /** An alliance writes only to a player worth about its own average member. */
  allyWant: 0.6,
  /** Records kept in the save: open ones and the newest closed. */
  kept: 40,
  /** Player-wave tolerance of a joint strike: ±10 minutes of scatter (owner rule 09.11). */
  scatterMinutes: 10,
});

const isId = (value: unknown): value is string => typeof value === 'string' && value.length > 0;
const isTime = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) >= 0;

export function isNpcLetterRecord(value: unknown): value is NpcLetterRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  return isId(item.letterId) && ['help-request', 'ally-offer', 'reply'].includes(String(item.kind)) && isId(item.from)
    && isTime(item.createdAt) && isTime(item.expiresAt)
    && ['new', 'accepted', 'declined', 'expired', 'kept', 'failed', 'info'].includes(String(item.status))
    && (item.decidedAt === undefined || isTime(item.decidedAt)) && (item.closedAt === undefined || isTime(item.closedAt))
    && (item.reason === undefined || typeof item.reason === 'string')
    && (item.planetId === undefined || isId(item.planetId)) && (item.attackerId === undefined || isId(item.attackerId))
    && (item.arrivalAt === undefined || isTime(item.arrivalAt)) && (item.allianceId === undefined || isId(item.allianceId))
    && (item.cause === undefined || ['declined', 'no-show', 'betrayed'].includes(String(item.cause)))
    && (item.tone === undefined || ['warm', 'cold', 'angry'].includes(String(item.tone)));
}

/** Waiting for the player, or accepted and not yet settled. */
export const isNpcLetterOpen = (letter: Pick<NpcLetterRecord, 'status' | 'closedAt'>) => (letter.status === 'new' || letter.status === 'accepted') && letter.closedAt === undefined;
