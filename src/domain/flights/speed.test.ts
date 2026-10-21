import assert from 'node:assert/strict';
import test from 'node:test';

import { calculateBaseTimeMinutes, calculateEffectiveFleetSpeed, calculateFlightSpeedMultiplier, calculateOneWayDurationMs } from './speed.ts';

const origin = { galaxy: 1, system: 1, position: 1 };

test('adds and caps science speed bonuses, and uses the slowest selected ship', () => {
  assert.ok(Math.abs(calculateFlightSpeedMultiplier({ 4: 1, 8: 1, 9: 1, 14: 1 }) - 1.6) <= Number.EPSILON);
  assert.equal(calculateFlightSpeedMultiplier({ 4: 99, 8: 99, 9: 99, 14: 99 }), 10);
  assert.equal(calculateEffectiveFleetSpeed('aegis', { transporter: 1, colonizer: 1 }), 5_000);
});

test('commander hulls use catalog speed, fleet science, and the slowest hull in mixed fleets', () => {
  assert.equal(calculateEffectiveFleetSpeed('aegis', {}, {}, { corsair: 1 }), 33_000);
  assert.equal(calculateEffectiveFleetSpeed('aegis', {}, { 4: 2 }, { corsair: 1 }), 39_600);
  assert.equal(calculateEffectiveFleetSpeed('aegis', { colonizer: 1 }, {}, { corsair: 1 }), 5_000);
  assert.equal(calculateEffectiveFleetSpeed('aegis', { scout: 1 }, {}, { corsair: 1 }), 28_000);
});

test('applies smoothing, the 1.5 divisor, minimum three minutes, and final-only rounding', () => {
  const adjacent = { galaxy: 1, system: 1, position: 2 };
  assert.equal(calculateBaseTimeMinutes(origin, adjacent), 3.02);
  assert.equal(calculateOneWayDurationMs(origin, adjacent, 19_000), 180_000);
  assert.equal(calculateOneWayDurationMs(origin, adjacent, 200), 382_003);
  assert.equal(calculateOneWayDurationMs(origin, { galaxy: 3, system: 1, position: 1 }, 19_000), 607_744);
  assert.equal(calculateOneWayDurationMs(origin, { galaxy: 4, system: 1, position: 1 }, 200), 2_656_313);
});

test('recon (spy probes only) is floored at 3 seconds, every other fleet at 3 minutes', async () => {
  const { MIN_RECON_ONE_WAY_DURATION_MS, isReconOnlyFleet } = await import('./speed.ts');
  const origin = { galaxy: 1, system: 1, position: 1 };
  const next = { galaxy: 1, system: 1, position: 2 };
  assert.equal(calculateOneWayDurationMs(origin, next, 200_000_000), 3 * 60_000);
  const probe = calculateOneWayDurationMs(origin, next, 200_000_000, MIN_RECON_ONE_WAY_DURATION_MS);
  assert.ok(probe >= 3_000 && probe < 60_000, `probe ${probe}`);
  assert.equal(calculateOneWayDurationMs(origin, origin, 1e30, MIN_RECON_ONE_WAY_DURATION_MS), 3_000);
  assert.equal(isReconOnlyFleet({ 'spy-probe': 3 }), true);
  assert.equal(isReconOnlyFleet({ 'spy-probe': 1, cruiser: 1 }), false);
  assert.equal(isReconOnlyFleet({ 'spy-probe': 1 }, { corsair: 1 }), false);
  assert.equal(isReconOnlyFleet({}), false);
});

test('Typhoon «Форсаж» adds +0.1% speed per level to the whole fleet, additively with sciences', () => {
  const science = { 4: 5 };
  const without = calculateEffectiveFleetSpeed('aegis', { cruiser: 10 }, science);
  const withoutTyphoonAboard = calculateEffectiveFleetSpeed('aegis', { cruiser: 10 }, science, {}, { typhoon: 40 });
  const withTyphoon = calculateEffectiveFleetSpeed('aegis', { cruiser: 10 }, science, { typhoon: 1 }, { typhoon: 40 });
  assert.equal(withoutTyphoonAboard, without, 'a Typhoon that stays home does not help');
  assert.equal(calculateFlightSpeedMultiplier(science, 40), 1 + 0.5 + 0.04);
  // The fleet moves at its slowest hull; Typhoon itself is boosted too.
  assert.ok(withTyphoon > without);
  const typhoonAlone = calculateEffectiveFleetSpeed('aegis', {}, {}, { typhoon: 1 }, { typhoon: 10 });
  const typhoonLevel0 = calculateEffectiveFleetSpeed('aegis', {}, {}, { typhoon: 1 }, { typhoon: 0 });
  assert.equal(typhoonAlone / typhoonLevel0, 1.01);
});
