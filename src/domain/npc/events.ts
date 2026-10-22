import type { NpcEventCursor, NpcEventPriority } from './types.ts';

/** Explicit same-timestamp contract shared by future game and NPC replay. */
export const NPC_EVENT_PRIORITY_ORDER: Readonly<Record<NpcEventPriority, number>> = Object.freeze({
  'game-timer-completion': 0,
  'fleet-arrival': 1,
  'npc-session-boundary': 2,
  'npc-decision': 3,
});

export type NpcScheduledEvent<TPayload = unknown> = Readonly<{
  at: number;
  priority: NpcEventPriority;
  eventId: string;
  payload: TPayload;
}>;

/** Total ordering: timestamp, approved priority, then stable eventId. */
export function compareNpcEvents(
  left: Pick<NpcScheduledEvent, 'at' | 'priority' | 'eventId'>,
  right: Pick<NpcScheduledEvent, 'at' | 'priority' | 'eventId'>,
): number {
  return left.at - right.at
    || NPC_EVENT_PRIORITY_ORDER[left.priority] - NPC_EVENT_PRIORITY_ORDER[right.priority]
    || compareStableIds(left.eventId, right.eventId);
}

/** Returns a sorted copy; callers' event collections are never mutated. */
export function orderNpcEvents<T>(events: readonly NpcScheduledEvent<T>[]): NpcScheduledEvent<T>[] {
  return [...events].sort(compareNpcEvents);
}

/** True only for an event strictly after the exclusive replay cursor. */
export function isNpcEventAfterCursor(
  event: Pick<NpcScheduledEvent, 'at' | 'priority' | 'eventId'>,
  cursor: NpcEventCursor | null,
): boolean {
  return cursor === null || compareNpcEvents(event, cursor) > 0;
}

/** Selects the next event in a finite generated horizon, enforcing an exclusive cursor. */
export function findNextNpcEvent<T>(
  events: readonly NpcScheduledEvent<T>[],
  cursor: NpcEventCursor | null,
  throughAt: number,
): NpcScheduledEvent<T> | null {
  if (!Number.isFinite(throughAt)) throw new RangeError('throughAt must be a finite timestamp');
  let next: NpcScheduledEvent<T> | null = null;
  for (const event of events) {
    if (!Number.isFinite(event.at) || !event.eventId) continue;
    if (event.at > throughAt || !isNpcEventAfterCursor(event, cursor)) continue;
    if (next === null || compareNpcEvents(event, next) < 0) next = event;
  }
  return next;
}

function compareStableIds(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
