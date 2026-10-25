import assert from 'node:assert/strict';
import test from 'node:test';

import { NPC_CALENDAR_DAY_MS } from '../domain/npc/calendar.ts';
import { createNpcState } from '../domain/npc/state.ts';
import { createBot01Planets } from '../domain/espionage/fixtures.ts';
import { createEmptyFleetState } from '../domain/fleet/runtime.ts';
import {
  applyNpcReplayEventsAt,
  generateNpcReplayEvents,
  initializeNpcReplaySessionsAt,
  NPC_REPLAY_DECISION_MAX_DELAY_MS,
  NPC_REPLAY_DECISION_MIN_DELAY_MS,
  NPC_REPLAY_MAX_ATTEMPTS_PER_SESSION,
} from './npc-replay.ts';

const DAY = NPC_CALENDAR_DAY_MS;

function seededState(ownerIds: string[]) {
  const state = createNpcState(ownerIds, 'replay-test-salt', 0);
  const profiles = Object.fromEntries(Object.entries(state.profiles).map(([ownerId, profile]) => [ownerId, {
    ...profile,
    activity: { ...profile.activity, propensity: 1 },
  }]));
  return { ...state, profiles };
}

test('replay interval partitions preserve boundary and decision events with opaque IDs', () => {
  const state = seededState(['npc-replay-a']);
  const ownerId = 'npc-replay-a';
  const profile = state.profiles[ownerId]!;
  const fromAt = -2 * DAY;
  const toAt = 8 * DAY;
  const all = generateNpcReplayEvents(state, fromAt, toAt, [ownerId]);
  const split = [
    ...generateNpcReplayEvents(state, fromAt, 3 * DAY, [ownerId]),
    ...generateNpcReplayEvents(state, 3 * DAY, toAt, [ownerId]),
  ].sort((left, right) => left.at - right.at || left.eventId.localeCompare(right.eventId));
  assert.deepEqual(split, all);
  const crossingStart = all.find((event) => event.priority === 'npc-session-boundary' && event.boundary === 'session-start')!;
  const midSession = crossingStart.at + 1;
  const cutInsideSession = [
    ...generateNpcReplayEvents(state, crossingStart.at, midSession, [ownerId]),
    ...generateNpcReplayEvents(state, midSession, toAt, [ownerId]),
  ].sort((left, right) => left.at - right.at || left.eventId.localeCompare(right.eventId));
  assert.deepEqual(cutInsideSession, generateNpcReplayEvents(state, crossingStart.at, toAt, [ownerId]));
  assert.ok(all.length > 0);
  assert.ok(all.every(({ eventId }) => !eventId.includes(profile.privateSeed)));

  const decisions = all.filter((event) => event.priority === 'npc-decision');
  const grouped = new Map<string, typeof decisions>();
  for (const decision of decisions) grouped.set(decision.sessionId, [...(grouped.get(decision.sessionId) ?? []), decision]);
  for (const group of grouped.values()) {
    group.sort((left, right) => left.at - right.at);
    assert.equal(group[0]!.attempt, 0);
    // Looks are bounded by the session itself (owner rule: no per-session action cap).
    assert.ok(group.length <= NPC_REPLAY_MAX_ATTEMPTS_PER_SESSION);
    for (let index = 1; index < group.length; index += 1) {
      const delay = group[index]!.at - group[index - 1]!.at;
      assert.ok(delay >= NPC_REPLAY_DECISION_MIN_DELAY_MS && delay <= NPC_REPLAY_DECISION_MAX_DELAY_MS);
      assert.equal(group[index]!.attempt, index);
    }
  }
});

test('registered owner filtering drops orphans and applies session boundary before the first decision', () => {
  const state = seededState(['npc-replay-a', 'npc-orphan']);
  const events = generateNpcReplayEvents(state, 0, 30 * DAY, ['npc-replay-a']);
  assert.ok(events.length > 0);
  assert.ok(events.every((event) => event.ownerId === 'npc-replay-a'));
  const firstStart = events.find((event) => event.priority === 'npc-session-boundary' && event.boundary === 'session-start')!;
  const firstDecision = events.find((event) => event.priority === 'npc-decision' && event.at === firstStart.at)!;
  assert.ok(firstStart);
  assert.ok(firstDecision);

  const result = applyNpcReplayEventsAt(state, firstStart.at, [firstDecision, firstStart], { targets: {}, timeScale: 1 });
  const profile = result.state.profiles['npc-replay-a']!;
  assert.equal(profile.session.active, true);
  assert.equal(profile.session.sessionStartedAt, firstStart.at);
  assert.equal(profile.cursor?.eventId, firstDecision.eventId);
  assert.equal(result.emitted.length, 0, 'no action is emitted without a registered economy target');
  assert.deepEqual(result.targets, {});
});

test('baseline inside a canonical session seeds it and replays only remaining decisions', () => {
  const ownerId = 'npc-baseline';
  const original = seededState([ownerId]);
  const originalProfile = original.profiles[ownerId]!;
  const sessionStart = generateNpcReplayEvents(original, 0, 30 * DAY, [ownerId])
    .find((event) => event.priority === 'npc-session-boundary' && event.boundary === 'session-start')!;
  const baselineAt = sessionStart.at + 60_000;
  const sessionEnd = generateNpcReplayEvents(original, sessionStart.at, sessionStart.at + 4 * 60 * 60_000, [ownerId])
    .find((event) => event.priority === 'npc-session-boundary' && event.boundary === 'session-end')!;
  assert.ok(baselineAt < sessionEnd.at);

  const initialized = initializeNpcReplaySessionsAt(original, baselineAt, [ownerId]);
  const profile = initialized.profiles[ownerId]!;
  assert.equal(profile.session.active, true);
  assert.equal(profile.session.sessionStartedAt, sessionStart.at);
  assert.equal(profile.session.sessionEndsAt, sessionEnd.at);
  assert.equal(profile.session.lastBoundaryAt, baselineAt);
  assert.equal(profile.cursor, null, 'baseline seeding does not fabricate a historical event cursor');
  assert.equal(originalProfile.session.active, false, 'input state remains immutable');

  const remaining = generateNpcReplayEvents(initialized, baselineAt, sessionEnd.at, [ownerId]);
  assert.ok(remaining.length > 0);
  assert.ok(remaining.every((event) => event.at >= baselineAt));
  assert.equal(remaining.some((event) => event.priority === 'npc-session-boundary' && event.boundary === 'session-start'), false);
  const firstDecision = remaining.find((event) => event.priority === 'npc-decision')!;
  assert.ok(firstDecision.at > baselineAt, 'the attempt at the canonical session start is historical');

  const fixture = Object.values(createBot01Planets(0))[0]!;
  const target = {
    ...fixture,
    id: 'npc-baseline-target',
    kind: 'npc' as const,
    ownerId,
    fleet: createEmptyFleetState(),
    population: { total: 0, fleet: 0, defense: 0 },
    resources: { metal: 10_000_000, minerals: 10_000_000, gas: 10_000_000, debris: 0, developmentEnergy: 10_000_000 },
    buildings: {},
    buildingQueue: [],
    ownerProfile: { scienceLevels: {}, shipLevels: {}, commanderLevels: {} },
    resourceClock: { lastReconciledAt: baselineAt, remainder: { metal: 0, minerals: 0, gas: 0 } },
  };
  const applied = applyNpcReplayEventsAt(initialized, firstDecision.at, [firstDecision], {
    targets: { [target.id]: target }, timeScale: 1,
  });
  assert.equal(applied.emitted.length, 1, 'the in-session attempt reaches the economy policy');
  assert.equal(applied.emitted[0]!.eventId, firstDecision.eventId);
  assert.equal(applied.state.profiles[ownerId]!.cursor?.eventId, firstDecision.eventId);
});
