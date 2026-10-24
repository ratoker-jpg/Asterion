import assert from 'node:assert/strict';
import test from 'node:test';
import {
  PIRATE_PROTECTION_TOTAL_POINTS,
  isOwnerProtectedFromPirates,
  pirateRaidChance, pirateCounterFleetChance, pirateThreatHoursToMaximum,
  pirateHangarFraction, pirateDebrisRewardMultiplier, pirateSeededDraw,
  advancePirateThreat, reducePirateThreatAfterVictory,
} from './threat.ts';

test('approved pirate threat anchors and no divide by zero', () => {
  const cases = [
    [1_000, 0, 141, 0.054, 0.104],
    [100_000, 0, 114, 0.062, 0.126],
    [1_000_000, 1_000_000, 96, 0.071, 0.147],
    [1_000_000, 500_000, 80, 0.082, 0.176],
    [1_000_000, 100_000, 56.7272727, 0.112, 0.25],
    [1_000_000, 0, 48, 0.132, 0.30],
  ] as const;
  for (const [r, b, maxAt, at24, at48] of cases) {
    assert.ok(Math.abs(pirateThreatHoursToMaximum(r,b)-maxAt) < 0.1);
    assert.equal(pirateRaidChance(r,b,8), 0.02);
    assert.ok(Math.abs(pirateRaidChance(r,b,24) - at24) < 0.005);
    assert.ok(Math.abs(pirateRaidChance(r,b,48) - at48) < 0.005);
    assert.ok(Math.abs(pirateRaidChance(r,b,pirateThreatHoursToMaximum(r,b)) - 0.30) < 1e-12);
  }
  assert.equal(pirateRaidChance(0,0,0),0.02);
  assert.ok(pirateRaidChance(0,0,1000) <= 0.30);
  assert.equal(pirateCounterFleetChance(1_000_000,0,0.02),0.10);
  assert.equal(pirateCounterFleetChance(1_000_000,0,0.30),0.70);
  assert.equal(pirateCounterFleetChance(0,0,0.30),0.10);
});
test('historical hangar fractions use exact integer manifest, not rounded percent', () => {
  assert.equal(pirateDebrisRewardMultiplier(25_112,25_112),1.5);
  assert.equal(pirateDebrisRewardMultiplier(25_111,25_112),1.3);
  assert.equal(pirateDebrisRewardMultiplier(23_857,25_112),1.3);
  assert.equal(pirateDebrisRewardMultiplier(18_834,25_112),0.9);
  assert.equal(pirateDebrisRewardMultiplier(12_556,25_112),0.9);
  assert.equal(pirateDebrisRewardMultiplier(100,25_112),0.7);
  assert.equal(pirateDebrisRewardMultiplier(25_113,25_112),1);
  assert.equal(pirateHangarFraction(25_113,25_112),0);
});
test('seeded rolls and virtual time survive repeated calls and full/partial reset', () => {
  assert.equal(pirateSeededDraw('owner:cycle:v1'), pirateSeededDraw('owner:cycle:v1'));
  const initial = { version: 1 as const, ageHours: 10, integratedAt: 1_000_000 };
  const current = advancePirateThreat(initial, 1_000_000 + 3_600_000);
  assert.equal(current.ageHours,11);
  assert.deepEqual(advancePirateThreat(current,1_000_000+3_600_000),current);
  assert.ok(Math.abs(reducePirateThreatAfterVictory(current,current.integratedAt,0.95).ageHours-0.55)<1e-10);
  assert.equal(reducePirateThreatAfterVictory(current,current.integratedAt,1).ageHours,0);
});

test('owners below 100 000 total points are protected from pirate aggression', () => {
  assert.equal(PIRATE_PROTECTION_TOTAL_POINTS, 100_000);
  assert.equal(isOwnerProtectedFromPirates(0, 0), true);
  assert.equal(isOwnerProtectedFromPirates(60_000, 39_999), true);
  assert.equal(isOwnerProtectedFromPirates(60_000, 40_000), false);
  assert.equal(isOwnerProtectedFromPirates(100_000, 0), false);
  assert.equal(isOwnerProtectedFromPirates(Number.NaN, -5), true, 'invalid scores never lift the protection');
});
