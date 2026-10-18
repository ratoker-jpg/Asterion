import assert from 'node:assert/strict';
import test from 'node:test';

import { AID_MISSION_ENABLED, evaluateAidMissionRequirements } from './aid-mission.ts';

test('aid mission requires an ally target and at least one free transporter', () => {
  assert.deepEqual(evaluateAidMissionRequirements({ targetRelation: 'ally', freeShips: { transporter: 1 } }), { ok: true });
  assert.deepEqual(evaluateAidMissionRequirements({ targetRelation: 'ally', freeShips: { 'mega-transporter': 2 } }), { ok: true });
  assert.deepEqual(evaluateAidMissionRequirements({ targetRelation: 'ally', freeShips: { scout: 50, transporter: 0 } }), { ok: false, reason: 'no-free-transporters' });
  assert.deepEqual(evaluateAidMissionRequirements({ targetRelation: 'ally', freeShips: {} }), { ok: false, reason: 'no-free-transporters' });
  for (const targetRelation of ['self', 'neutral', 'enemy', 'empty', undefined] as const) {
    assert.deepEqual(evaluateAidMissionRequirements({ targetRelation, freeShips: { transporter: 5 } }), { ok: false, reason: 'target-not-ally' });
  }
});

test('aid mission is registered but not connected to the flight runtime in PR 1', () => {
  assert.equal(AID_MISSION_ENABLED, false);
});
