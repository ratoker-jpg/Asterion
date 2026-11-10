import assert from 'node:assert/strict';
import test from 'node:test';
import { FRAME_RING_SIZE, FrameMeter, formatFrameMeter } from './frame-meter.ts';

test('a steady 120 Hz stream shows 120 fps and no missed frames', () => {
  const meter = new FrameMeter();
  let now = 1_000;
  for (let index = 0; index < 600; index += 1) { meter.record(now); now += 1_000 / 120; }
  const snap = meter.snapshot(now);
  assert.equal(Math.round(snap.fps ?? 0), 120);
  assert.equal(snap.over8, 0);
  assert.equal(snap.over16, 0);
  assert.ok((snap.worstMs ?? 99) < 8.4);
});

test('one long frame is the worst frame and counts in every bucket it passes', () => {
  const meter = new FrameMeter();
  let now = 1_000;
  for (let index = 0; index < 100; index += 1) { meter.record(now); now += 8; }
  now += 120;
  meter.record(now);
  const snap = meter.snapshot(now);
  assert.equal(Math.round(snap.worstMs ?? 0), 128);
  assert.equal(snap.over8, 1);
  assert.equal(snap.over16, 1);
  assert.equal(snap.over33, 1);
});

test('frames older than the window leave the numbers; the ring survives wrapping', () => {
  const meter = new FrameMeter();
  let now = 1_000;
  meter.record(now);
  now += 200;
  meter.record(now);
  for (let index = 0; index < FRAME_RING_SIZE + 300; index += 1) { now += 8; meter.record(now); }
  const snap = meter.snapshot(now, 5_000);
  assert.ok(snap.frames <= FRAME_RING_SIZE);
  assert.ok((snap.worstMs ?? 99) < 9, 'the old 200 ms frame fell out of the window');
  assert.equal(meter.snapshot(now + 60_000).frames, 0);
});

test('an empty meter reads as dashes and a 60 Hz display gets its note', () => {
  const meter = new FrameMeter();
  const empty = formatFrameMeter(meter.snapshot(1_000), 0);
  assert.equal(empty.fps, '—');
  assert.equal(empty.hz60, false);
  let now = 1_000;
  for (let index = 0; index < 120; index += 1) { meter.record(now); now += 16.67; }
  assert.equal(formatFrameMeter(meter.snapshot(now), 0).hz60, true);
});
