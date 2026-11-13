import assert from 'node:assert/strict';
import test from 'node:test';

import {
  LiveWorldSupervisor, guardWorkerStep, WORKER_COOLDOWN_MS, WORKER_FAILURE_WINDOW_MS, WORKER_HANG_AFTER_MS, WORKER_MAX_RESTARTS,
} from './live-world-supervisor.ts';
import { applyWorldPatch, type WorldPatch } from './world-diff.ts';
import { LiveWorldEngine } from './live-world-engine.ts';
import { createInitialSaveState } from './persistence.ts';
import type { LiveWorldResponse } from './live-world-protocol.ts';

const MIN = 60_000;

test('a failure restarts the worker; a worker that keeps failing is given up, then tried again', () => {
  const supervisor = new LiveWorldSupervisor();
  for (let i = 1; i <= WORKER_MAX_RESTARTS; i += 1) {
    assert.deepEqual(supervisor.onFailure(i * 1000), { action: 'restart', restartsInWindow: i });
  }
  const decision = supervisor.onFailure(10_000);
  assert.equal(decision.action, 'fallback');
  assert.ok(supervisor.inCooldown(10_000 + WORKER_COOLDOWN_MS - 1));
  assert.ok(!supervisor.inCooldown(10_000 + WORKER_COOLDOWN_MS));
  // after the cool-down the budget is fresh
  assert.equal(supervisor.onFailure(10_000 + WORKER_COOLDOWN_MS + 1).action, 'restart');
});

test('old failures fall out of the window', () => {
  const supervisor = new LiveWorldSupervisor();
  for (let i = 0; i < WORKER_MAX_RESTARTS; i += 1) supervisor.onFailure(i);
  assert.equal(supervisor.onFailure(WORKER_FAILURE_WINDOW_MS + 100).action, 'restart');
});

test('watchdog: a tick with no sign of life for 30 s is a hang; progress resets it; no tick in flight is never a hang', () => {
  const sent = 1_000_000;
  assert.ok(!LiveWorldSupervisor.isHung(sent + WORKER_HANG_AFTER_MS, true, sent, sent));
  assert.ok(LiveWorldSupervisor.isHung(sent + WORKER_HANG_AFTER_MS + 1, true, sent, sent));
  assert.ok(!LiveWorldSupervisor.isHung(sent + WORKER_HANG_AFTER_MS + 1, true, sent, sent + 20_000), 'catch-up progress counts as alive');
  assert.ok(!LiveWorldSupervisor.isHung(sent + 10 * MIN, false, sent, sent));
});

test('a world patch that throws leads to a restart, not to a dead worker', () => {
  const base = createInitialSaveState('production', 1_000_000);
  // a patch addressed to a record the window does not have (the window and the worker drifted apart)
  const broken: WorldPatch = [{ p: ['planets', 'no-such-planet', 'buildings', 'x'], v: 1 }];
  assert.throws(() => applyWorldPatch(base, broken));
  const reasons: string[] = [];
  const result = guardWorkerStep(() => applyWorldPatch(base, broken), (reason) => { reasons.push(reason); });
  assert.equal(result, undefined);
  assert.equal(reasons.length, 1, 'the failure reaches the restart path');
  assert.match(reasons[0]!, /no container/i);
  // and the window's decision for that failure is a restart
  assert.equal(new LiveWorldSupervisor().onFailure(1000).action, 'restart');
});

test('engine: an error inside the worker is reported so the window can restart it', async () => {
  const posted: LiveWorldResponse[] = [];
  const engine = new LiveWorldEngine({
    post: (message) => posted.push(message),
    now: () => 1_000_000,
    yieldToMessages: async () => undefined,
    later: () => undefined,
    journal: false,
  });
  const state = createInitialSaveState('production', 1_000_000);
  await engine.handle({ type: 'init', version: 0, state, clockOffsetMs: 0, persist: { tickMaxIntervalMs: 60_000, tickCostFactor: 50, catchupIntervalMs: 15_000 } });
  // a tick from a version the worker never had: the "out of step" error
  await engine.handle({ type: 'tick', from: 44, now: 1_001_000, testTimeScale: 1 });
  assert.equal(posted.at(-1)?.type, 'error');
});
