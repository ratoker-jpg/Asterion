import {
  isNpcLetterOpen, NPC_LETTER_BALANCE, type NpcLetterRecord, type NpcReplyCause, type NpcReplyTone,
} from '../domain/npc/letters.ts';
import type { NpcJointStrikeProposal } from '../domain/npc/pacts.ts';
import { createNpcStrategyState } from '../domain/npc/strategy.ts';
import type { NpcProfile } from '../domain/npc/types.ts';
import type { SaveState } from './contracts.ts';
import { getNpcJournalSink } from './npc-journal.ts';

/**
 * What the save holds of the bots' letters to the player: the records, the
 * budget that keeps them rare, and the replies. The writing and the answers
 * live in npc-letters.ts; this part has no dependency on the pacts so the pact
 * code can use it.
 */

const HOUR = 3_600_000;
const unit = (value: number) => Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));

export const npcLettersOf = (state: SaveState): readonly NpcLetterRecord[] => state.npcStrategy?.letters ?? [];

/** Joint-strike invitations addressed to the player. */
export function playerInvitations(state: SaveState): NpcJointStrikeProposal[] {
  const playerId = state.profile.playerId;
  return (state.npcStrategy?.proposals ?? []).filter((item): item is NpcJointStrikeProposal => item.kind === 'joint-strike' && item.to === playerId);
}

/** Replaces or adds a letter: open ones stay, the closed ones keep the newest few. */
export function withNpcLetter(state: SaveState, letter: NpcLetterRecord): SaveState {
  const strategy = state.npcStrategy ?? createNpcStrategyState();
  const list = strategy.letters ?? [];
  const next = list.some((item) => item.letterId === letter.letterId)
    ? list.map((item) => (item.letterId === letter.letterId ? letter : item)) : [...list, letter];
  const open = next.filter((item) => isNpcLetterOpen(item)).length;
  const closed = next.filter((item) => !isNpcLetterOpen(item));
  const kept = new Set(closed.slice(Math.max(0, closed.length - Math.max(0, NPC_LETTER_BALANCE.kept - open))));
  return { ...state, npcStrategy: { ...strategy, letters: next.filter((item) => isNpcLetterOpen(item) || kept.has(item)) } };
}

export function journalNpcLetter(at: number, ownerId: string, event: string, letter: Pick<NpcLetterRecord, 'letterId' | 'kind'>, detail: Readonly<Record<string, string | number>> = {}): void {
  getNpcJournalSink()?.outcome?.({ at, ownerId, kind: 'pact', data: { ev: `letter-${event}`, id: letter.letterId, tp: letter.kind, ...detail } });
}

type Ask = Readonly<{ from: string; at: number; open: boolean; declinedAt?: number }>;

/** Every invitation and request the player has had (replies are answers, not asks). */
function asksOf(state: SaveState, now: number): Ask[] {
  const asks: Ask[] = [];
  for (const letter of npcLettersOf(state)) {
    if (letter.kind === 'reply') continue;
    asks.push({ from: letter.from, at: letter.createdAt, open: letter.status === 'new' && now < letter.expiresAt, declinedAt: letter.status === 'declined' ? letter.decidedAt : undefined });
  }
  for (const proposal of playerInvitations(state)) {
    asks.push({ from: proposal.from, at: proposal.createdAt, open: proposal.status === 'proposed' && now < proposal.expiresAt,
      declinedAt: proposal.status === 'declined' && proposal.by === state.profile.playerId ? proposal.decidedAt : undefined });
  }
  return asks;
}

/**
 * May this bot write the player an invitation or request now? Numbers are in
 * NPC_LETTER_BALANCE: one per bot per 48 h (96 h after a refusal), four a day
 * from all bots, three waiting at once.
 */
export function mayWritePlayer(state: SaveState, botId: string, now: number): boolean {
  const asks = asksOf(state, now);
  if (asks.filter((ask) => ask.open).length >= NPC_LETTER_BALANCE.openMax) return false;
  if (asks.filter((ask) => now - ask.at < 24 * HOUR).length >= NPC_LETTER_BALANCE.perDay) return false;
  return !asks.some((ask) => ask.from === botId && (now - ask.at < NPC_LETTER_BALANCE.perBotHours * HOUR
    || (ask.declinedAt !== undefined && now - ask.declinedAt < NPC_LETTER_BALANCE.afterDeclineHours * HOUR)));
}

function replyTone(profile: NpcProfile, cause: NpcReplyCause): NpcReplyTone {
  const aggression = unit(profile.traits.aggression);
  const cooperation = unit(profile.traits.cooperation);
  if (cause === 'betrayed') return 'angry';
  if (cause === 'no-show') return aggression * (1 - cooperation) >= 0.3 ? 'angry' : 'cold';
  return cooperation >= 0.5 && aggression < 0.6 ? 'warm' : 'cold';
}

/** A bot answers the player's «Отказаться», no-show or betrayal in a line; once per bot per day. */
export function queueNpcReply(state: SaveState, botId: string, cause: NpcReplyCause, now: number): SaveState {
  const profile = state.npc?.profiles[botId];
  if (!profile) return state;
  if (npcLettersOf(state).some((item) => item.kind === 'reply' && item.from === botId && now - item.createdAt < NPC_LETTER_BALANCE.replyPerBotHours * HOUR)) return state;
  const letter: NpcLetterRecord = { letterId: `reply:${botId}:${now}`, kind: 'reply', from: botId, createdAt: now, expiresAt: now, status: 'info', cause, tone: replyTone(profile, cause) };
  journalNpcLetter(now, botId, 'reply', letter, { cause, tone: letter.tone! });
  return withNpcLetter(state, letter);
}
