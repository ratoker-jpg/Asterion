import assert from 'node:assert/strict';
import test from 'node:test';
import {
  aggregatePirateRaidChance,
  calculatePirateActivityRatio,
  canUsePiratePlanetBreaker,
  pirateContactCycleKey,
  pirateDebrisShare,
  pirateRaidChance,
  pirateRaidPopulationMultiplier,
  resolvePirateRaidCycle,
  resolvePirateRecon,
} from './contact-rules.ts';

test('activity ratio safely normalizes point inputs and handles a zero denominator', () => {
  assert.equal(calculatePirateActivityRatio(0, 0), 0);
  assert.equal(calculatePirateActivityRatio(1_000_000, 1_000_000), 0.5);
  assert.equal(calculatePirateActivityRatio(1_000_000, 0), 1);
  assert.equal(calculatePirateActivityRatio(0, 1_000_000), 0);
  assert.equal(calculatePirateActivityRatio(-10, 10), 0);
  assert.equal(calculatePirateActivityRatio(Number.NaN, Number.POSITIVE_INFINITY), 0);
  assert.equal(calculatePirateActivityRatio(Number.MAX_VALUE, Number.MAX_VALUE), 0.5);
});

test('raid chance and population budget use the requested q curves', () => {
  assert.equal(pirateRaidChance(0), 0.02);
  assert.equal(pirateRaidChance(0.5), 0.07);
  assert.ok(Math.abs(pirateRaidChance(1) - 0.12) < 1e-12);
  assert.equal(pirateRaidChance(Number.POSITIVE_INFINITY), 0.02);
  assert.equal(pirateRaidPopulationMultiplier(0), 0.35);
  assert.equal(pirateRaidPopulationMultiplier(0.5), 0.625);
  assert.equal(pirateRaidPopulationMultiplier(1), 0.9);
});

test('aggregate chance handles zero, fractional, and boundary inputs', () => {
  assert.equal(aggregatePirateRaidChance(0.07, 0), 0);
  assert.equal(aggregatePirateRaidChance(0.07, 3), 1 - (1 - 0.07) ** 3);
  assert.equal(aggregatePirateRaidChance(0.5, 2.9), 0.75);
  assert.equal(aggregatePirateRaidChance(1, 1), 1);
  assert.equal(aggregatePirateRaidChance(Number.NaN, 10), 0);
});

test('contact cycle keys include galaxy, system, and cycle index', () => {
  assert.equal(pirateContactCycleKey(1, 2, 3), 'pirate-contact:v1:1:2:3');
  assert.notEqual(pirateContactCycleKey(1, 2, 3), pirateContactCycleKey(1, 2, 4));
  assert.notEqual(pirateContactCycleKey(1, 2, 3), pirateContactCycleKey(1, 3, 3));
  assert.throws(() => pirateContactCycleKey(0, 2, 3), RangeError);
  assert.throws(() => pirateContactCycleKey(1, 2, -1), RangeError);
});

test('raid resolution is replayable per owner and cycle and targets sorted colonies only on success', () => {
  const base = {
    ownerId: 'owner-1',
    galaxy: 1,
    system: 2,
    resourcePoints: 1_000_000,
    battlePoints: 500_000,
    colonyIds: ['planet-c', 'planet-a', 'planet-b', 'planet-a'],
  };
  const first = resolvePirateRaidCycle({ ...base, cycleIndex: 0 });
  const replay = resolvePirateRaidCycle({ ...base, cycleIndex: 0, colonyIds: ['planet-a', 'planet-b', 'planet-c'] });
  assert.deepEqual(first, replay);
  assert.equal(first.contactCycleKey, pirateContactCycleKey(1, 2, 0));
  assert.equal(first.chance, pirateRaidChance(calculatePirateActivityRatio(base.resourcePoints, base.battlePoints)));
  if (first.rollSucceeded) assert.ok(['planet-a', 'planet-b', 'planet-c'].includes(first.targetPlanetId ?? ''));
  else assert.equal(first.targetPlanetId, undefined);

  const anotherOwner = resolvePirateRaidCycle({ ...base, ownerId: 'owner-2', cycleIndex: 0 });
  const anotherCycle = resolvePirateRaidCycle({ ...base, cycleIndex: 1 });
  assert.notEqual(anotherOwner.roll, first.roll);
  assert.notEqual(anotherCycle.contactCycleKey, first.contactCycleKey);

  const successful = Array.from({ length: 100 }, (_, cycleIndex) => resolvePirateRaidCycle({ ...base, cycleIndex }))
    .find((outcome) => outcome.rollSucceeded);
  assert.ok(successful?.targetPlanetId);

  const targetCounts = new Map([['planet-a', 0], ['planet-b', 0], ['planet-c', 0]]);
  for (let cycleIndex = 0; cycleIndex < 30_000; cycleIndex += 1) {
    const outcome = resolvePirateRaidCycle({ ...base, resourcePoints: 1, battlePoints: 0, cycleIndex });
    if (outcome.targetPlanetId) targetCounts.set(outcome.targetPlanetId, targetCounts.get(outcome.targetPlanetId)! + 1);
  }
  const totalTargets = [...targetCounts.values()].reduce((total, count) => total + count, 0);
  assert.ok(totalTargets > 3_000);
  for (const count of targetCounts.values()) {
    assert.ok(Math.abs(count / totalTargets - 1 / 3) < 0.04, `${count}/${totalTargets}`);
  }
});

test('recon roll is a deterministic exact 70-of-100 threshold independent of spy level', () => {
  const first = resolvePirateRecon('owner-1', 1, 2, 3);
  const replay = resolvePirateRecon('owner-1', 1, 2, 3);
  assert.deepEqual(first, replay);
  assert.ok(first.roll >= 0 && first.roll < 100);
  assert.equal(first.fullReport, first.roll < 70);

  let successes = 0;
  const sampleSize = 10_000;
  for (let cycleIndex = 0; cycleIndex < sampleSize; cycleIndex += 1) {
    if (resolvePirateRecon('frequency-owner', 1, 1, cycleIndex).fullReport) successes += 1;
  }
  assert.ok(successes > sampleSize * 0.68 && successes < sampleSize * 0.72, `${successes}/${sampleSize}`);
});

test('planet-breaker eligibility uses strict owner-score and target-population bounds', () => {
  assert.equal(canUsePiratePlanetBreaker(3_000_000, 1_999), false);
  assert.equal(canUsePiratePlanetBreaker(3_000_001, 2_000), false);
  assert.equal(canUsePiratePlanetBreaker(3_000_001, 1_999), true);
  assert.equal(canUsePiratePlanetBreaker(Number.NaN, 1_999), false);
});

test('pirate debris share uses surviving Corsair levels and caps at 80 percent', () => {
  assert.equal(pirateDebrisShare([]), 0.60);
  assert.equal(pirateDebrisShare([0]), 0.60);
  assert.equal(pirateDebrisShare([1]), 0.605);
  assert.equal(pirateDebrisShare([40]), 0.80);
  assert.equal(pirateDebrisShare([80]), 0.80);
  assert.equal(pirateDebrisShare([-1, Number.NaN, Number.POSITIVE_INFINITY]), 0.60);
});
