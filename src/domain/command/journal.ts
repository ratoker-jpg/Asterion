import { selectOwnerMembership } from './selectors.ts';
import { AID_RESOURCES } from './aid.ts';
import type { AidEventKind, AidResource, CommandState } from './types.ts';

/** New members cannot read the journal for this long after joining. */
export const JOURNAL_DELAY_MS = 2 * 60 * 60 * 1000;
/** Largest timestamp a JS Date can represent; anything beyond cannot be shown honestly. */
const MAX_DATE_MS = 8.64e15;

/** Upper bound of rows handed to the UI; the domain keeps at most 300 events anyway. */
export const JOURNAL_MAX_ROWS = 100;

const KNOWN_REASONS = ['completed', 'cancelled', 'author_left', 'alliance_disbanded', 'planet_destroyed'] as const;
export type JournalCloseReason = (typeof KNOWN_REASONS)[number];

/**
 * One readable journal row. Deliberately minimal: no planet, coordinates,
 * fleet composition or any identifier that could lead to another owner's
 * assets. `resource` comes from the alliance request card, which members may see.
 */
export type JournalEntry = {
  id: string;
  kind: AidEventKind;
  at: number;
  /** Current member's public name, or null when the actor has since left. */
  actorName: string | null;
  resource: AidResource | null;
  units: number | null;
  closeReason: JournalCloseReason | null;
};

/**
 * What the UI may know. `locked` carries only the unlock instant, never the
 * number, kinds, authors or times of the hidden events.
 */
export type JournalView =
  | { state: 'no_membership' }
  | { state: 'locked'; unlocksAt: number }
  | { state: 'open'; entries: JournalEntry[] };

/** Opaque stable row key: the raw event id embeds flight/request ids that must not reach the DOM. */
export function journalEntryKey(eventId: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < eventId.length; index += 1) {
    hash ^= eventId.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `j${hash.toString(16).padStart(8, '0')}`;
}

/**
 * Pure, bounded view of the alliance journal for one viewer. Filtering happens
 * here, before any rendering: nothing of a hidden event leaves this function.
 */
export function selectAllianceJournal(command: CommandState, viewerOwnerId: string, now: number): JournalView {
  const membership = selectOwnerMembership(command, viewerOwnerId);
  if (!membership) return { state: 'no_membership' };
  const { alliance, member } = membership;
  const unlocksAt = member.joinedAt + JOURNAL_DELAY_MS;
  if (now < unlocksAt) return { state: 'locked', unlocksAt };

  const names = new Map(alliance.members.map((candidate) => [candidate.ownerId, candidate.displayName]));
  const entries: JournalEntry[] = [];
  const seen = new Set<string>();
  for (const event of command.aidEvents) {
    if (event.allianceId !== alliance.id || event.audience !== 'alliance') continue;
    // Corrupted timestamps (NaN, Infinity, beyond the Date range) are dropped instead of shown with an invented date.
    if (!Number.isFinite(event.at) || event.at > MAX_DATE_MS) continue;
    if (!(event.at > member.joinedAt) || seen.has(event.id)) continue;
    seen.add(event.id);
    const request = command.requests.find((candidate) => candidate.id === event.requestId && candidate.allianceId === alliance.id);
    const resource = request && AID_RESOURCES.includes(request.resource) ? request.resource : null;
    const reason = (KNOWN_REASONS as readonly string[]).includes(event.reason ?? '') ? (event.reason as JournalCloseReason) : null;
    entries.push({
      id: journalEntryKey(event.id),
      kind: event.kind,
      at: event.at,
      actorName: names.get(event.actorOwnerId) ?? null,
      resource,
      units: typeof event.units === 'number' && Number.isFinite(event.units) ? Math.max(0, Math.floor(event.units)) : null,
      closeReason: event.kind === 'request_closed' ? reason : null,
    });
  }
  entries.sort((left, right) => right.at - left.at || (left.id < right.id ? -1 : left.id > right.id ? 1 : 0));
  return { state: 'open', entries: entries.slice(0, JOURNAL_MAX_ROWS) };
}
