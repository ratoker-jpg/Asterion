import type { NpcGrudge, NpcProfile } from './types.ts';

/**
 * Memory of the owners who attacked this NPC (owner rule 26.10.2026, decision
 * 10): who, how often and how much it cost. It lasts until the end of the
 * match; only the list size is bounded, keeping the most hurtful offenders.
 */
export const NPC_GRUDGE_LIMIT = 24;

function safeCount(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}

export function isNpcGrudge(value: unknown): value is NpcGrudge {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  return [item.attacks, item.damage, item.firstAt, item.lastAt].every((field) => Number.isSafeInteger(field) && Number(field) >= 0)
    && Number(item.attacks) > 0 && Number(item.lastAt) >= Number(item.firstAt)
    && (item.lastReportId === undefined || (typeof item.lastReportId === 'string' && item.lastReportId.length > 0));
}

function trim(grudges: Record<string, NpcGrudge>): Readonly<Record<string, NpcGrudge>> {
  const entries = Object.entries(grudges);
  if (entries.length <= NPC_GRUDGE_LIMIT) return Object.freeze(grudges);
  const kept = entries.sort(([leftId, left], [rightId, right]) => right.damage - left.damage || right.lastAt - left.lastAt
    || (leftId < rightId ? -1 : leftId > rightId ? 1 : 0)).slice(0, NPC_GRUDGE_LIMIT);
  return Object.freeze(Object.fromEntries(kept.sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)));
}

/** One attack suffered. The same battle report is never counted twice. */
export function recordNpcGrievance(profile: NpcProfile, offenderOwnerId: string, damage: number, at: number, reportId: string): NpcProfile {
  if (!offenderOwnerId || offenderOwnerId === profile.ownerId || !Number.isSafeInteger(at) || at < 0) return profile;
  const previous = profile.grudges?.[offenderOwnerId];
  if (previous?.lastReportId === reportId) return profile;
  const grudge: NpcGrudge = previous
    ? { attacks: previous.attacks + 1, damage: previous.damage + safeCount(damage), firstAt: previous.firstAt, lastAt: Math.max(previous.lastAt, at), lastReportId: reportId }
    : { attacks: 1, damage: safeCount(damage), firstAt: at, lastAt: at, lastReportId: reportId };
  return Object.freeze({ ...profile, grudges: trim({ ...(profile.grudges ?? {}), [offenderOwnerId]: Object.freeze(grudge) }) });
}

/**
 * 0..1: how badly the owner wants to hurt this offender. Each attack and the
 * loss it caused, measured in days of the owner's own income, add up; the
 * feeling does not fade with time.
 */
export function npcGrudgeIntensity(grudge: NpcGrudge | undefined, dayValue: number): number {
  if (!grudge) return 0;
  const value = 0.25 * grudge.attacks + 0.5 * Math.log1p(grudge.damage / Math.max(1, dayValue));
  return Math.min(1, Math.max(0, value));
}
