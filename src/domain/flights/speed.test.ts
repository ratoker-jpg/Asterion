import assert from 'node:assert/strict';
import test from 'node:test';

import { calculateBaseTimeMinutes, calculateEffectiveFleetSpeed, calculateFlightSpeedMultiplier, calculateOneWayDurationMs } from './speed.ts';

const origin = { galaxy: 1, system: 1, position: 1 };

test('adds and caps science speed bonuses, and uses the slowest selected ship', () => {
  assert.ok(Math.abs(calculateFlightSpeedMultiplier({ 4: 1, 8: 1, 9: 1, 14: 1 }) - 1.6) <= Number.EPSILON);
  assert.equal(calculateFlightSpeedMultiplier({ 4: 99, 8: 99, 9: 99, 14: 99 }), 10);
  assert.equal(calculateEffectiveFleetSpeed('aegis', { transporter: 1, colonizer: 1 }), 5_000);
});

test('applies smoothing, the 1.5 divisor, minimum three minutes, and final-only rounding', () => {
  const adjacent = { galaxy: 1, system: 1, position: 2 };
  assert.equal(calculateBaseTimeMinutes(origin, adjacent), 3.02);
  assert.equal(calculateOneWayDurationMs(origin, adjacent, 19_000), 180_000);
  assert.equal(calculateOneWayDurationMs(origin, adjacent, 200), 382_003);
  assert.equal(calculateOneWayDurationMs(origin, { galaxy: 3, system: 1, position: 1 }, 19_000), 607_744);
  assert.equal(calculateOneWayDurationMs(origin, { galaxy: 4, system: 1, position: 1 }, 200), 2_656_313);
});
