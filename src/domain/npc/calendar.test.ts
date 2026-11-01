import assert from 'node:assert/strict';
import test from 'node:test';

import {
  NPC_CALENDAR_DAY_MS,
  NPC_CALENDAR_MAX_NEXT_SEARCH_DAYS,
  NPC_CALENDAR_SAMPLE_POLICY,
  NPC_CALENDAR_WAKE_MINUTES,
  NPC_SESSION_MINUTES,
  NPC_SESSIONS_PER_DAY,
  findNextNpcSessionEvent,
  getNpcSessionEvents,
  isNpcInRareAbsenceDay,
} from './calendar.ts';
import { listNpcVisits, NPC_VISIT_SHIFT_MAX_MS, npcVisitOverlap, planNpcVisitShift, withNpcVisitShift } from './calendar.ts';
import { createNpcState } from './state.ts';
import type { NpcProfile } from './types.ts';

const day = NPC_CALENDAR_DAY_MS;

function profileFor(ownerId: string, salt = 'calendar-salt'): NpcProfile {
  return createNpcState([ownerId], salt, 0).profiles[ownerId]!;
}

test('absolute day buckets produce identical events across arbitrary interval partitions', () => {
  const profile = profileFor('npc-calendar-1');
  const fromAt = -11 * day + 12_345;
  const toAt = 43 * day + 67_890;
  const whole = getNpcSessionEvents(profile, fromAt, toAt);
  const partitions = [
    ...getNpcSessionEvents(profile, fromAt, 2 * day + 7),
    ...getNpcSessionEvents(profile, 2 * day + 7, 20 * day + 8),
    ...getNpcSessionEvents(profile, 20 * day + 8, toAt),
  ];
  assert.deepEqual(partitions, whole);
  assert.deepEqual(getNpcSessionEvents(profile, fromAt, toAt), whole, 'recalculation is stable');
});

test('sessions stay within the approved day count, duration, timezone, and pause envelope', () => {
  const profile = profileFor('npc-calendar-2');
  const events = getNpcSessionEvents(profile, -40 * day, 400 * day);
  const starts = events.filter((event) => event.boundary === 'session-start');
  assert.ok(starts.length > 0);
  const perDay = new Map<number, number>();
  const bySession = new Map<string, typeof events>();
  for (const event of events) {
    const localDay = Math.floor((event.at + profile.session.timezoneOffsetMinutes * 60_000) / day);
    if (event.boundary === 'session-start') {
      const localMillis = event.at + profile.session.timezoneOffsetMinutes * 60_000;
      const localMinute = Math.floor(((localMillis % day) + day) % day / 60_000);
      assert.ok(localMinute >= NPC_CALENDAR_WAKE_MINUTES.min && localMinute < 24 * 60, 'sessions begin in the local awake window');
      perDay.set(localDay, (perDay.get(localDay) ?? 0) + 1);
    }
    const pair = bySession.get(event.sessionId) ?? [];
    pair.push(event);
    bySession.set(event.sessionId, pair);
  }
  assert.ok([...perDay.values()].every((count) => count >= NPC_SESSIONS_PER_DAY.min && count <= NPC_SESSIONS_PER_DAY.max));
  for (const pair of bySession.values()) {
    assert.equal(pair.length, 2);
    const [start, end] = [...pair].sort((left, right) => left.at - right.at);
    const minutes = (end!.at - start!.at) / 60_000;
    assert.ok(minutes >= NPC_SESSION_MINUTES.min && minutes <= NPC_SESSION_MINUTES.max);
  }
  const startsByDay = [...starts].sort((left, right) => left.at - right.at);
  for (let index = 1; index < startsByDay.length; index += 1) {
    const previous = startsByDay[index - 1]!;
    const previousEnd = events.find((event) => event.sessionId === previous.sessionId && event.boundary === 'session-end')!;
    const sameLocalDay = Math.floor((previous.at + profile.session.timezoneOffsetMinutes * 60_000) / day)
      === Math.floor((startsByDay[index]!.at + profile.session.timezoneOffsetMinutes * 60_000) / day);
    if (sameLocalDay) assert.ok(startsByDay[index]!.at - previousEnd.at >= NPC_CALENDAR_SAMPLE_POLICY.minimumPauseMinutes * 60_000);
  }
});

test('rare absences are multi-day and next-event search is bounded', () => {
  const state = createNpcState(Array.from({ length: 100 }, (_, index) => 'npc-absence-' + index), 'absence-salt', 0);
  const anyProfile = Object.values(state.profiles).find((candidate) => candidate.activity.propensity > 0.9)!;
  const events = getNpcSessionEvents(anyProfile, 0, 3 * 365 * day);
  const sessionDays = new Set(events.filter((event) => event.boundary === 'session-start')
    .map((event) => Math.floor((event.at + anyProfile.session.timezoneOffsetMinutes * 60_000) / day)));
  const hasMultiDayAbsence = Array.from({ length: 3 * 365 - 1 }, (_, index) => index)
    .some((localDay) => isNpcInRareAbsenceDay(anyProfile.privateSeed, anyProfile.ownerId, localDay)
      && isNpcInRareAbsenceDay(anyProfile.privateSeed, anyProfile.ownerId, localDay + 1)
      && !sessionDays.has(localDay) && !sessionDays.has(localDay + 1));
  assert.ok(hasMultiDayAbsence);

  const quiet = { ...anyProfile, activity: { ...anyProfile.activity, propensity: 0 } };
  assert.equal(findNextNpcSessionEvent(quiet, 0, 10_000 * day), null);
  const next = findNextNpcSessionEvent(anyProfile, 0, 10_000 * day);
  assert.ok(next === null || next.at < NPC_CALENDAR_MAX_NEXT_SEARCH_DAYS * day);
  const firstEvent = getNpcSessionEvents(anyProfile, 0, day)[0]!;
  assert.equal(findNextNpcSessionEvent(anyProfile, firstEvent.at, firstEvent.at), null);
  assert.notEqual(findNextNpcSessionEvent(anyProfile, firstEvent.at, firstEvent.at + 1)?.eventId, firstEvent.eventId);
  assert.equal(findNextNpcSessionEvent(anyProfile, 0, 10_000 * day)?.eventId,
    getNpcSessionEvents(anyProfile, 0, NPC_CALENDAR_MAX_NEXT_SEARCH_DAYS * day)[0]?.eventId);
  assert.equal(findNextNpcSessionEvent(anyProfile, Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER), null);
  assert.throws(() => findNextNpcSessionEvent(anyProfile, 0, day, undefined, 0), /positive safe integer/);
  assert.throws(() => findNextNpcSessionEvent(anyProfile, 0, day, undefined, NPC_CALENDAR_MAX_NEXT_SEARCH_DAYS + 1), /no greater than/);
});

test('invalid interval boundaries are rejected', () => {
  const profile = profileFor('npc-calendar-3');
  assert.deepEqual(getNpcSessionEvents(profile, 50, 50), []);
  assert.throws(() => getNpcSessionEvents(profile, 51, 50), /safe integer timestamps/);
  assert.throws(() => getNpcSessionEvents(profile, Number.NaN, 50), /safe integer timestamps/);
  assert.throws(() => getNpcSessionEvents(profile, Number.MAX_SAFE_INTEGER + 1, 50), /safe integer timestamps/);
});

test('a moved visit keeps its length, stays within two hours and keeps its neighbours apart; only the moved one changes', () => {
  const profile = { ownerId: 'npc-shift', privateSeed: 'shift-seed', campaignStartedAt: undefined as number | undefined,
    activity: { propensity: 0.5, completedSessions: 0, missedSessions: 0, updatedAt: 0 },
    session: { timezoneOffsetMinutes: 0, active: false, sessionStartedAt: null, sessionEndsAt: null, lastBoundaryAt: null } };
  const day = 24 * 3_600_000;
  const from = Date.UTC(2026, 9, 26);
  const visits = listNpcVisits(profile, from, from + 2 * day);
  assert.ok(visits.length >= 2);
  const length = (list: readonly { startAt: number; endAt: number }[]) => list.reduce((sum, visit) => sum + visit.endAt - visit.startAt, 0);
  // Just past the end of the first visit tomorrow: a small move later reaches it.
  const target = visits.find((visit) => visit.startAt >= from + day)!;
  const windowStart = target.endAt + 20 * 60_000;
  const shift = planNpcVisitShift(profile, windowStart, windowStart + 30 * 60_000, 15 * 60_000, from);
  assert.ok(shift, 'a visit can reach the window');
  assert.ok(Math.abs(shift!.deltaMs) <= NPC_VISIT_SHIFT_MAX_MS);
  const moved = { ...profile, session: withNpcVisitShift(profile.session, shift!, from) };
  const after = listNpcVisits(moved, from, from + 2 * day);
  assert.equal(after.length, visits.length);
  assert.equal(length(after), length(visits), 'the same minutes at the game');
  assert.ok(after.some((visit) => npcVisitOverlap(visit, windowStart, windowStart + 30 * 60_000) >= 15 * 60_000));
  assert.equal(after.filter((visit) => !visits.some((old) => old.startAt === visit.startAt)).length, 1, 'one visit moved');
  for (let index = 1; index < after.length; index += 1) assert.ok(after[index]!.startAt >= after[index - 1]!.endAt, 'visits do not overlap');
  // Nothing within reach: too far from any visit.
  const night = visits[0]!.startAt - 6 * 3_600_000;
  assert.equal(planNpcVisitShift(profile, night, night + 60_000, 30_000, night - day), null);
  // A visit already begun does not move.
  assert.equal(planNpcVisitShift(profile, windowStart, windowStart + 30 * 60_000, 15 * 60_000, target.startAt), null);
});
