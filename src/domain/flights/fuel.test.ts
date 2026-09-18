import assert from 'node:assert/strict';
import test from 'node:test';

import { calculateBaseFlightFuel, calculateFlightFuel } from './fuel.ts';

test('reads faction catalog fuel coefficients instead of duplicating them', () => {
  assert.equal(calculateBaseFlightFuel('aegis', { colonizer: 1 }), 1_500);
  assert.equal(calculateBaseFlightFuel('synod', { 'mega-transporter': 2 }), 100);
  assert.equal(calculateBaseFlightFuel('veyra', { scout: 1, destroyer: 1 }), 612);
});

test('applies capped chemistry and rounds gas upward with a floor of one', () => {
  assert.equal(calculateFlightFuel('synod', { 'mega-transporter': 2 }, 1_035, { 2: 7 }), 6);
  assert.equal(calculateFlightFuel('synod', { 'mega-transporter': 2 }, 1_425, { 2: 7 }), 8);
  assert.equal(calculateFlightFuel('aegis', { colonizer: 1 }, 1_035, { 2: 7 }), 85);
  assert.equal(calculateFlightFuel('aegis', { colonizer: 1 }, 1_425, { 2: 7 }), 116);
  assert.equal(calculateFlightFuel('aegis', { 'spy-probe': 1 }, 1, { 2: 99 }), 1);
});
