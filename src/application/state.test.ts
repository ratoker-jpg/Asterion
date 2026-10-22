import assert from 'node:assert/strict';
import test from 'node:test';
import { createInitialSaveState } from './persistence.ts';
import { APPLICATION_COMMAND_REQUEST_EVENTS, isApplicationCommandBlocked, isGameplayCommandRequestEvent } from './state.ts';

test('application command guard follows persisted NPC replay progress', () => {
  const state = createInitialSaveState('test');
  assert.equal(isApplicationCommandBlocked(state), false);
  assert.equal(isApplicationCommandBlocked({ ...state, npcReplay: { version: 1, processedThroughAt: 500, targetAt: 500 } }), false);
  assert.equal(isApplicationCommandBlocked({ ...state, npcReplay: { version: 1, processedThroughAt: 499, targetAt: 500 } }), true);
});

test('gameplay request gate covers command bridges and leaves navigation requests alone', () => {
  for (const type of APPLICATION_COMMAND_REQUEST_EVENTS) {
    assert.equal(isGameplayCommandRequestEvent(type), true, type);
  }

  for (const type of [
    'asterion:flight-dispatch-request',
    'asterion:fleet-production-start-request',
    'asterion:science-start-request',
    'asterion:repair-request',
    'asterion:combat-resolve-request',
  ]) assert.equal(isGameplayCommandRequestEvent(type), true, type);

  for (const type of [
    'asterion:fleet-root-request',
    'asterion:fleet-construction-request',
    'asterion:simulator-handoff-request',
    'asterion:flight-command-result',
  ]) assert.equal(isGameplayCommandRequestEvent(type), false, type);
});
