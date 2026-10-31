import { createSeededRandom, randomInteger } from '../world/random.ts';
import type { NpcActivityState, NpcProfile, NpcSessionEvent } from './types.ts';

export const NPC_CALENDAR_DAY_MS = 24 * 60 * 60 * 1_000;
export const NPC_SESSION_MINUTES = Object.freeze({ min: 5, max: 180 });
export const NPC_SESSIONS_PER_DAY = Object.freeze({ min: 0, max: 8 });
export const NPC_CALENDAR_MAX_NEXT_SEARCH_DAYS = 370;
export const NPC_CALENDAR_WAKE_MINUTES = Object.freeze({ min: 6 * 60, max: 8 * 60 });
export const NPC_CALENDAR_AWAKE_WINDOW_MINUTES = 16 * 60;

/**
 * Explicit sample cadence parameters. These values are technical prototypes,
 * not measured human statistics or gameplay-balance commitments.
 */
export const NPC_CALENDAR_SAMPLE_POLICY = Object.freeze({
  rareAbsenceStartProbability: 1 / 90,
  rareAbsenceDays: Object.freeze({ min: 2, max: 5 }),
  minimumPauseMinutes: 5,
});

/**
 * Owner rule (24.10.2026), a match lasts three to seven days and the world
 * leans active. Online minutes on an ordinary day by activity propensity,
 * interpolated so there are no hard classes: about 30% "unemployed" 12–16 h,
 * 35% regular 5–8 h, 25% working 2–3 h in short visits, 10% rare about an
 * hour. Propensity 0 never plays. Points are [propensity, minutes].
 */
export const NPC_ONLINE_MINUTES_BY_PROPENSITY: readonly (readonly [number, number])[] = Object.freeze([
  [0, 40], [0.1, 75], [0.11, 120], [0.35, 180], [0.36, 300], [0.7, 480], [0.71, 720], [1, 960],
].map((point) => Object.freeze(point as [number, number])));

/** The opening days are played harder: everything is cheap and quick then. */
export const NPC_CAMPAIGN_START_BOOST: readonly number[] = Object.freeze([2, 1.5]);

/**
 * No character makes a bot dead for the whole match (owner 31.10.2026: an
 * owner with activity 0.08 played 11 sessions in three days and stood at
 * ~600 points): activity counts as at least this, about 2.5 h on a usual day.
 */
export const NPC_MIN_ACTIVITY_PROPENSITY = 0.2;

/**
 * A match lasts three to seven days: a several-day absence at its start left
 * a bot at one planet for good (lab 31.10.2026). No rare absence begins its
 * first days.
 */
export const NPC_NO_ABSENCE_OPENING_DAYS = 3;

/** Rare players also skip whole days now and then. */
const RARE_PROPENSITY = 0.1;
const RARE_DAY_SKIP_PROBABILITY = 0.3;

export function npcOnlineMinutesPerDay(propensity: number): number {
  const p = clamp(propensity, 0, 1);
  if (p <= 0) return 0;
  const points = NPC_ONLINE_MINUTES_BY_PROPENSITY;
  for (let index = 1; index < points.length; index += 1) {
    const [toP, toMinutes] = points[index]!;
    if (p <= toP) {
      const [fromP, fromMinutes] = points[index - 1]!;
      return fromMinutes + (toMinutes - fromMinutes) * (p - fromP) / (toP - fromP);
    }
  }
  return points[points.length - 1]![1];
}

/** Calendar timestamps are Unix epoch milliseconds and use a fixed pseudo-UTC offset (no DST). */
export function getNpcSessionEvents(
  profile: Pick<NpcProfile, 'ownerId' | 'privateSeed' | 'activity' | 'session' | 'campaignStartedAt'>,
  fromAt: number,
  toAt: number,
  activity: NpcActivityState = profile.activity,
): NpcSessionEvent[] {
  assertInterval(fromAt, toAt);
  if (toAt === fromAt) return [];
  const offsetMs = profile.session.timezoneOffsetMinutes * 60_000;
  // The one-day halo captures sessions whose local day differs from either UTC edge.
  const firstLocalDay = Math.floor((fromAt + offsetMs) / NPC_CALENDAR_DAY_MS) - 1;
  const lastLocalDay = Math.floor((toAt + offsetMs) / NPC_CALENDAR_DAY_MS) + 1;
  const startLocalDay = typeof profile.campaignStartedAt === 'number'
    ? Math.floor((profile.campaignStartedAt + offsetMs) / NPC_CALENDAR_DAY_MS)
    : null;
  const events: NpcSessionEvent[] = [];
  for (let localDay = firstLocalDay; localDay <= lastLocalDay; localDay += 1) {
    const openingDay = startLocalDay !== null && localDay >= startLocalDay && localDay - startLocalDay < NPC_NO_ABSENCE_OPENING_DAYS;
    if (!openingDay && isNpcInRareAbsenceDay(profile.privateSeed, profile.ownerId, localDay)) continue;
    const dayRandom = createSeededRandom(JSON.stringify([profile.privateSeed, profile.ownerId, 'day', localDay]));
    const wakeRandom = createSeededRandom(JSON.stringify([profile.privateSeed, profile.ownerId, 'wake', localDay]));
    // Propensity 0 still never plays (a switched-off owner); any other plays at least the floor.
    const raw = clamp(activity.propensity, 0, 1);
    const propensity = raw > 0 ? Math.max(NPC_MIN_ACTIVITY_PROPENSITY, raw) : 0;
    if (propensity < RARE_PROPENSITY && dayRandom() < RARE_DAY_SKIP_PROBABILITY) continue;
    const weekWeight = getWeekdayWeight(profile.privateSeed, profile.ownerId, localDay);
    const dayIndex = startLocalDay === null ? null : localDay - startLocalDay;
    const boost = dayIndex !== null && dayIndex >= 0 ? NPC_CAMPAIGN_START_BOOST[dayIndex] ?? 1 : 1;
    const awakeMinutes = NPC_CALENDAR_AWAKE_WINDOW_MINUTES;
    const minutes = Math.min(awakeMinutes * 0.95,
      npcOnlineMinutesPerDay(propensity) * (0.7 + 0.6 * dayRandom()) * (0.75 + 0.25 * weekWeight) * boost);
    if (minutes < NPC_SESSION_MINUTES.min) continue;
    // Short visits for little time, long sittings for a lot of it.
    const meanLength = 10 + 0.12 * minutes;
    const sessionCount = Math.max(1, Math.min(NPC_SESSIONS_PER_DAY.max, Math.round(minutes / meanLength)));
    const wakeMinute = randomInteger(wakeRandom, NPC_CALENDAR_WAKE_MINUTES.min, NPC_CALENDAR_WAKE_MINUTES.max);
    const slotMinutes = Math.floor(awakeMinutes / sessionCount);
    // Later visits run a little longer (evenings), each share is noisy.
    const shares = Array.from({ length: sessionCount }, (_, index) =>
      (0.6 + 0.8 * dayRandom()) * (1 + (sessionCount > 1 ? 0.5 * index / (sessionCount - 1) : 0)));
    const shareTotal = shares.reduce((sum, value) => sum + value, 0);
    for (let index = 0; index < sessionCount; index += 1) {
      const slotStart = wakeMinute + index * slotMinutes;
      const slotEnd = wakeMinute + (index + 1) * slotMinutes;
      const maxDuration = Math.min(NPC_SESSION_MINUTES.max, slotMinutes - 2 * NPC_CALENDAR_SAMPLE_POLICY.minimumPauseMinutes);
      const durationMinutes = Math.max(NPC_SESSION_MINUTES.min, Math.min(maxDuration, Math.round(minutes * shares[index]! / shareTotal)));
      const latestStart = slotEnd - durationMinutes - NPC_CALENDAR_SAMPLE_POLICY.minimumPauseMinutes;
      // Wake time and a sixteen-hour awake window keep sessions out of the night block.
      const startMinute = randomInteger(dayRandom, slotStart, Math.max(slotStart, latestStart));
      const startAt = localDay * NPC_CALENDAR_DAY_MS - offsetMs + startMinute * 60_000;
      const endAt = startAt + durationMinutes * 60_000;
      const sessionId = 'npc-session:v1:' + JSON.stringify([profile.privateSeed, profile.ownerId, localDay, index]);
      const pair: NpcSessionEvent[] = [
        { at: startAt, priority: 'npc-session-boundary', eventId: 'npc-session-event:v1:' + JSON.stringify([profile.privateSeed, profile.ownerId, localDay, index, 'start']), ownerId: profile.ownerId, sessionId, boundary: 'session-start' },
        { at: endAt, priority: 'npc-session-boundary', eventId: 'npc-session-event:v1:' + JSON.stringify([profile.privateSeed, profile.ownerId, localDay, index, 'end']), ownerId: profile.ownerId, sessionId, boundary: 'session-end' },
      ];
      for (const event of pair) if (event.at >= fromAt && event.at < toAt) events.push(Object.freeze(event));
    }
  }
  return events.sort((left, right) => left.at - right.at || compareStableIds(left.eventId, right.eventId));
}

/**
 * Finds at most one next boundary and examines no more than maxDays of local
 * calendar days. A null result means no boundary was found in that bounded span.
 */
export function findNextNpcSessionEvent(
  profile: Pick<NpcProfile, 'ownerId' | 'privateSeed' | 'activity' | 'session' | 'campaignStartedAt'>,
  afterAt: number,
  throughAt: number,
  activity: NpcActivityState = profile.activity,
  maxDays = NPC_CALENDAR_MAX_NEXT_SEARCH_DAYS,
): NpcSessionEvent | null {
  assertInterval(afterAt, throughAt);
  if (!Number.isSafeInteger(maxDays) || maxDays < 1 || maxDays > NPC_CALENDAR_MAX_NEXT_SEARCH_DAYS) {
    throw new RangeError('maxDays must be a positive safe integer no greater than ' + NPC_CALENDAR_MAX_NEXT_SEARCH_DAYS);
  }
  if (afterAt >= throughAt || afterAt === Number.MAX_SAFE_INTEGER) return null;
  const searchSpan = maxDays * NPC_CALENDAR_DAY_MS;
  const maximumThrough = afterAt > Number.MAX_SAFE_INTEGER - searchSpan
    ? Number.MAX_SAFE_INTEGER
    : afterAt + searchSpan;
  const boundedThroughAt = Math.min(throughAt, maximumThrough);
  const firstSearchAt = afterAt + 1;
  if (firstSearchAt >= boundedThroughAt) return null;
  for (let windowStart = firstSearchAt; windowStart < boundedThroughAt;) {
    const windowEnd = Math.min(boundedThroughAt, windowStart + NPC_CALENDAR_DAY_MS);
    const next = getNpcSessionEvents(profile, windowStart, windowEnd, activity)[0];
    if (next) return next;
    windowStart = windowEnd;
  }
  return null;
}

export function isNpcInRareAbsenceDay(seed: string, ownerId: string, localDay: number): boolean {
  const lookback = NPC_CALENDAR_SAMPLE_POLICY.rareAbsenceDays.max;
  for (let startDay = localDay - lookback + 1; startDay <= localDay; startDay += 1) {
    const random = createSeededRandom(JSON.stringify([seed, ownerId, 'absence', startDay]));
    if (random() < NPC_CALENDAR_SAMPLE_POLICY.rareAbsenceStartProbability) {
      const length = randomInteger(random, NPC_CALENDAR_SAMPLE_POLICY.rareAbsenceDays.min, NPC_CALENDAR_SAMPLE_POLICY.rareAbsenceDays.max);
      if (localDay < startDay + length) return true;
    }
  }
  return false;
}

/** Stable per-week pattern. Weekdays use Monday=0 through Sunday=6. */
function getWeekdayWeight(seed: string, ownerId: string, localDay: number): number {
  const week = Math.floor((localDay + 3) / 7); // 1970-01-01 was Thursday.
  const random = createSeededRandom(JSON.stringify([seed, ownerId, 'week', week]));
  const raw = Array.from({ length: 7 }, () => 0.5 + random());
  const average = raw.reduce((sum, value) => sum + value, 0) / raw.length;
  const weekday = ((localDay + 3) % 7 + 7) % 7;
  return raw[weekday]! / average;
}

function assertInterval(fromAt: number, toAt: number): void {
  if (!Number.isSafeInteger(fromAt) || !Number.isSafeInteger(toAt) || toAt < fromAt) {
    throw new RangeError('NPC calendar interval must use safe integer timestamps ordered [fromAt, toAt)');
  }
}
function clamp(value: number, min: number, max: number): number { return Math.max(min, Math.min(max, value)); }
function compareStableIds(left: string, right: string): number { return left < right ? -1 : left > right ? 1 : 0; }
