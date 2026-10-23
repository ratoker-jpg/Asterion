import assert from 'node:assert/strict';
import test from 'node:test';

import {
  compareNpcEvents,
  findNextNpcEvent,
  isNpcEventAfterCursor,
  orderNpcEvents,
  type NpcScheduledEvent,
} from './events.ts';
import { selectNpcNoOpDecision } from './decision.ts';

test('same-time priorities apply timers, arrivals, session boundaries, then decisions', () => {
  const events: NpcScheduledEvent[] = [
    { at: 20, priority: 'npc-decision', eventId: 'd', payload: null },
    { at: 20, priority: 'npc-session-boundary', eventId: 's', payload: null },
    { at: 20, priority: 'fleet-arrival', eventId: 'f', payload: null },
    { at: 20, priority: 'game-timer-completion', eventId: 'g', payload: null },
  ];
  assert.deepEqual(orderNpcEvents(events).map((event) => event.eventId), ['g', 'f', 's', 'd']);
  assert.deepEqual(events.map((event) => event.eventId), ['d', 's', 'f', 'g'], 'input remains untouched');
  assert.ok(compareNpcEvents(events[3]!, events[2]!) < 0);
});

test('event IDs give a stable tie-break within a priority and cursor is exclusive', () => {
  const a = { at: 10, priority: 'fleet-arrival' as const, eventId: 'arrival-a' };
  const b = { at: 10, priority: 'fleet-arrival' as const, eventId: 'arrival-b' };
  const cursor = { ...a };
  assert.ok(compareNpcEvents(a, b) < 0);
  assert.equal(isNpcEventAfterCursor(a, cursor), false);
  assert.equal(isNpcEventAfterCursor(b, cursor), true);
  assert.equal(findNextNpcEvent([{ ...a, payload: 1 }, { ...b, payload: 2 }], cursor, 10)?.eventId, 'arrival-b');
  assert.equal(findNextNpcEvent([{ ...b, payload: 2 }], cursor, 9), null);
});

test('bounded next-event query rejects non-finite horizons', () => {
  assert.throws(() => findNextNpcEvent([], null, Number.POSITIVE_INFINITY), /finite timestamp/);
});

test('decision selector is a deterministic no-op over explicit visible facts and actions', () => {
  const context = {
    ownerId: 'npc-owner-a',
    at: 123,
    observation: {
      ownerId: 'npc-owner-a',
      at: 123,
      eventId: 'decision-123',
      facts: [{ id: 'fact-1', kind: 'scouted-planet', observedAt: 120, value: 'empty' }],
    },
    availableActions: [{ id: 'build-1', kind: 'build', payload: { building: 'mine' } }],
  } as const;
  const first = selectNpcNoOpDecision(context);
  assert.deepEqual(selectNpcNoOpDecision(context), first);
  assert.deepEqual(first, {
    ownerId: 'npc-owner-a',
    at: 123,
    eventId: 'decision-123',
    selectedAction: null,
    wait: true,
    idempotencyKey: 'npc-decision:v1:["npc-owner-a","decision-123"]',
  });
  assert.throws(() => selectNpcNoOpDecision({ ...context, ownerId: 'other' }), /match its observation/);
  assert.throws(() => selectNpcNoOpDecision({
    ...context,
    observation: { ...context.observation, facts: [{ ...context.observation.facts[0]!, observedAt: context.at + 1 }] },
  }), /cannot contain facts from the future/);
  const tupleA = selectNpcNoOpDecision({
    ...context,
    ownerId: 'npc:a',
    observation: { ...context.observation, ownerId: 'npc:a', eventId: 'b:c' },
  });
  const tupleB = selectNpcNoOpDecision({
    ...context,
    ownerId: 'npc:a:b',
    observation: { ...context.observation, ownerId: 'npc:a:b', eventId: 'c' },
  });
  assert.notEqual(tupleA.idempotencyKey, tupleB.idempotencyKey);
});
