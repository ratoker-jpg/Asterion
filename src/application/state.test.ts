import assert from 'node:assert/strict';
import test from 'node:test';
import { createInitialSaveState } from './persistence.ts';
import { APPLICATION_COMMAND_REQUEST_EVENTS, enqueueApplicationStateUpdate, isApplicationCommandBlocked, isGameplayCommandRequestEvent, runOutsideApplicationCommand } from './state.ts';

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

test('a world written by an effect inside a command flush waits for the command', async () => {
  const before = createInitialSaveState('test');
  const after = { ...before };
  const ref = { current: before };
  let world = before;
  const seen: unknown[] = [];
  enqueueApplicationStateUpdate(ref, (update) => { world = update(world); }, () => ({ state: after, result: undefined }), (work) => {
    work();
    // React runs the effects of the previous commit here, before the ref knows the command.
    runOutsideApplicationCommand(() => { seen.push(ref.current); });
    assert.deepEqual(seen, []);
  });
  assert.equal(ref.current, after);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(seen, [after]);
  // Outside a command it runs at once.
  runOutsideApplicationCommand(() => { seen.push('now'); });
  assert.equal(seen.at(-1), 'now');
});
