import assert from 'node:assert/strict';
import test from 'node:test';
import { gateFailures, markdown, screenRows } from './perf-audit-summary.mjs';

const screen = (max, over8, over50 = 0) => ({
  reactCommitsPerSecond: 1,
  page: { heap: { usedMb: 300 } },
  trace: { tasks: { max, over8ms: over8, over16ms: over8, over50ms: over50 }, framesPerSecond: { DroppedFrame: 0.2 }, byEvent: { MajorGC: { count: 1 } } },
});
const result = {
  fixture: 'x/late-game-day-3.json', speed: 'fast', frameRate: 120, motion: true, secondsPerScreen: 5, rendering: 'software', cpu: 'cpu', loadMs: 4000, world: {},
  screens: { planet: screen(12, 4, 1), broken: { error: 'boom\nstack' } },
  autosaveWindow: { seconds: 90, trace: { tasks: { max: 140, over8ms: 3, over50ms: 1 } } },
};

test('rows carry per-second numbers and mark a screen that failed to measure', () => {
  const rows = screenRows(result);
  assert.equal(rows[0].longTasksPerSecond, 0.2);
  assert.equal(rows[0].framesOver8msPerSecond, 0.8);
  assert.equal(rows[1].error, 'boom\nstack');
});

test('the gate reports a worst task over the limit, an unmeasured screen and the autosave window', () => {
  const failures = gateFailures(result, { maxTaskMs: 8, tasksOver8ms: 0, autosaveMaxTaskMs: 8 });
  assert.equal(failures.length, 4);
  assert.deepEqual(gateFailures(result), ['broken: no measurement (boom)']);
});

test('markdown has one row per screen and says the gate is report-only', () => {
  const text = markdown(result);
  assert.match(text, /\| planet \| 0,2 \|/);
  assert.match(text, /только отчёт/);
  assert.match(text, /Окно автосейва \(90 с/);
});
