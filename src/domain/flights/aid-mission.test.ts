import assert from 'node:assert/strict';
import test from 'node:test';

import { AID_MISSION_ENABLED, isAidTransportComposition } from './aid-mission.ts';

// The ally/free-transporter rule lives in the application (planPlayerAidLaunch; see alliance-aid.test.ts).
test('aid ships must be dedicated cargo hulls', () => {
  assert.equal(isAidTransportComposition({ transporter: 1 }), true);
  assert.equal(isAidTransportComposition({ 'mega-transporter': 2, transporter: 1 }), true);
  assert.equal(isAidTransportComposition({ scout: 50, transporter: 1 }), false);
  assert.equal(isAidTransportComposition({}), false);
});

test('aid mission is enabled in PR 2', () => {
  assert.equal(AID_MISSION_ENABLED, true);
});
