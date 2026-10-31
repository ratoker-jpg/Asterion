import type { SaveState } from './contracts.ts';
import { selectOwnerScore } from '../domain/rating/scoring.ts';

/**
 * Bot journal (owner request 31.10.2026): what the strongest NPCs chose, what
 * else they weighed and why, so their play can be studied against an expert's.
 * It is a study aid kept apart from the save (a JSON-lines file next to it on
 * this computer and next to the live world on the server): decisions never
 * read it, the save and server = client parity do not change, and a world run
 * with a journal attached equals one run without (npc-journal.test.ts).
 *
 * Keys are short, like the player journal's: t time, o owner, k kind, c the
 * chosen candidate (none: a wait), ok started, r refusal reason, w its weight,
 * alt the next best candidates with their weights, s the owner's strategy.
 */

export const NPC_JOURNAL_VERSION = 1;
/** Detailed entries are written for the top owners by total points. */
export const NPC_JOURNAL_DETAILED_TOP = 10;
/** Alternatives kept per decision. */
export const NPC_JOURNAL_ALTERNATIVES = 3;
/** The journal keeps this much game time. */
export const NPC_JOURNAL_KEEP_MS = 3 * 24 * 60 * 60_000;
/** The top is recomputed at most this often (game time). */
export const NPC_JOURNAL_RANK_INTERVAL_MS = 60 * 60_000;

export type NpcJournalEntry = Readonly<{
  t: number;
  o: string;
  /** Kind: an action family (economy, production, attack, recon, ...), wait, style, top. */
  k: string;
  c?: string;
  ok?: 0 | 1;
  r?: string;
  w?: number;
  alt?: readonly (readonly [string, number])[];
  s?: string;
  d?: Readonly<Record<string, unknown>>;
}>;

/** What the decision code reports for one action of a look at the game. */
export type NpcJournalDecision = Readonly<{
  at: number;
  ownerId: string;
  kind: string;
  chosen: { id: string; weight: number } | null;
  alternatives: readonly { id: string; weight: number }[];
  started: boolean;
  reason: string | null;
  strategy: string;
}>;

/** A change of the owner's play style, with its reason (journal only). */
export type NpcJournalStyle = Readonly<{ at: number; ownerId: string; style: string; previous: string | null; reason: string }>;

export type NpcJournalSink = Readonly<{
  /** True when the owner is written in detail; the decision code skips the alternatives otherwise. */
  detailed: (ownerId: string) => boolean;
  decision: (entry: NpcJournalDecision) => void;
  style?: (entry: NpcJournalStyle) => void;
}>;

let activeSink: NpcJournalSink | null = null;

/** Attaches a journal to the decisions computed in this thread (null detaches); returns the previous one. */
export function setNpcJournalSink(sink: NpcJournalSink | null): NpcJournalSink | null {
  const previous = activeSink;
  activeSink = sink;
  return previous;
}

export function getNpcJournalSink(): NpcJournalSink | null {
  return activeSink;
}

const round3 = (value: number) => Math.round(value * 1000) / 1000;

/**
 * Collects entries for one world: the top owners in detail, everyone's style
 * changes. `observe` refreshes the top from a world the host already holds
 * (after a step); `take` hands over what was written since the last call.
 */
export class NpcJournalRecorder implements NpcJournalSink {
  private top = new Set<string>();
  private rankedAt = Number.NEGATIVE_INFINITY;
  private pending: NpcJournalEntry[] = [];

  detailed = (ownerId: string): boolean => this.top.has(ownerId);

  decision = (entry: NpcJournalDecision): void => {
    if (!this.top.has(entry.ownerId)) return;
    this.pending.push({
      t: entry.at, o: entry.ownerId, k: entry.chosen ? entry.kind : 'wait',
      ...(entry.chosen ? { c: entry.chosen.id, ok: entry.started ? 1 : 0, w: round3(entry.chosen.weight) } : {}),
      ...(entry.reason ? { r: entry.reason } : {}),
      ...(entry.alternatives.length ? { alt: entry.alternatives.map((item) => [item.id, round3(item.weight)] as const) } : {}),
      s: entry.strategy,
    });
  };

  style = (entry: NpcJournalStyle): void => {
    this.pending.push({ t: entry.at, o: entry.ownerId, k: 'style', s: entry.style, d: { from: entry.previous, why: entry.reason } });
  };

  /** Refreshes the detailed top from `state` at most once per game hour. */
  observe(state: SaveState, at: number): void {
    if (at - this.rankedAt < NPC_JOURNAL_RANK_INTERVAL_MS && this.top.size) return;
    this.rankedAt = at;
    const owners = Object.keys(state.npc?.profiles ?? {});
    const ranked = owners
      .map((ownerId) => ({ ownerId, points: selectOwnerScore(state, ownerId)?.totalPoints ?? 0 }))
      .sort((left, right) => right.points - left.points || (left.ownerId < right.ownerId ? -1 : 1))
      .slice(0, NPC_JOURNAL_DETAILED_TOP);
    this.top = new Set(ranked.map((item) => item.ownerId));
    this.pending.push({ t: at, o: '*', k: 'top', d: { owners: ranked.map((item) => [item.ownerId, Math.round(item.points)]) } });
  }

  take(): NpcJournalEntry[] {
    const taken = this.pending;
    this.pending = [];
    return taken;
  }
}

/** JSON lines of entries (one per line, newline-terminated). */
export function formatNpcJournalLines(entries: readonly NpcJournalEntry[]): string {
  return entries.map((entry) => `${JSON.stringify(entry)}\n`).join('');
}

/** Parses JSON lines, skipping anything unreadable (a torn last line). */
export function parseNpcJournalLines(text: string): NpcJournalEntry[] {
  const entries: NpcJournalEntry[] = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try {
      const entry = JSON.parse(line) as NpcJournalEntry;
      if (typeof entry?.t === 'number' && typeof entry.o === 'string' && typeof entry.k === 'string') entries.push(entry);
    } catch { /* torn line */ }
  }
  return entries;
}

/**
 * Joins a journal with entries from elsewhere (the server's while the player
 * was away): entries after the journal's last time are appended, then only
 * the last NPC_JOURNAL_KEEP_MS of game time is kept.
 */
export function mergeNpcJournal(existing: readonly NpcJournalEntry[], incoming: readonly NpcJournalEntry[]): NpcJournalEntry[] {
  const last = existing.length ? existing[existing.length - 1]!.t : Number.NEGATIVE_INFINITY;
  const merged = [...existing, ...incoming.filter((entry) => entry.t > last)];
  return pruneNpcJournal(merged);
}

export function pruneNpcJournal(entries: readonly NpcJournalEntry[]): NpcJournalEntry[] {
  if (!entries.length) return [];
  const from = entries[entries.length - 1]!.t - NPC_JOURNAL_KEEP_MS;
  const first = entries.findIndex((entry) => entry.t >= from);
  return entries.slice(first < 0 ? entries.length : first);
}
