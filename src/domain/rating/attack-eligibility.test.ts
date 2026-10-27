import assert from 'node:assert/strict';
import test from 'node:test';
import { attackPointRange, ATTACK_PROTECTION_TOTAL_POINTS, evaluateAttackEligibility } from './attack-eligibility.ts';

const pts = (totalPoints: number, resourcePoints = totalPoints) => ({ totalPoints, resourcePoints });

test('300 total points end the protection on both sides; 299 is still protected', () => {
  assert.equal(ATTACK_PROTECTION_TOTAL_POINTS, 300);
  const attackerLow = evaluateAttackEligibility(pts(299), pts(300));
  assert.equal(attackerLow.allowed, false);
  assert.equal(attackerLow.reason, 'attacker-protected');
  assert.equal(attackerLow.message, 'У вас 299 общих очков: атаковать можно с 300.');

  const defenderLow = evaluateAttackEligibility(pts(300), pts(299));
  assert.equal(defenderLow.allowed, false);
  assert.equal(defenderLow.reason, 'defender-protected');
  assert.equal(defenderLow.message, 'У цели 299 общих очков: атаковать можно с 300.');

  assert.equal(evaluateAttackEligibility(pts(300), pts(300)).allowed, true);
  assert.equal(evaluateAttackEligibility(pts(180), pts(5_000)).message, 'У вас 180 общих очков: атаковать можно с 300.');
  assert.equal(evaluateAttackEligibility(pts(5_000), pts(180)).message, 'У цели 180 общих очков: атаковать можно с 300.');
  assert.equal(evaluateAttackEligibility(pts(5_000), pts(1)).message, 'У цели 1 общее очко: атаковать можно с 300.');
  assert.equal(evaluateAttackEligibility(pts(5_000), pts(22)).message, 'У цели 22 общих очка: атаковать можно с 300.');
});

test('the total band is inclusive at exactly ×0.5 and ×2 and closed one point beyond', () => {
  // Resource branch disabled (zero) so only the total branch decides.
  const attacker = { totalPoints: 10_000, resourcePoints: 0 };
  assert.equal(evaluateAttackEligibility(attacker, { totalPoints: 5_000, resourcePoints: 0 }).allowed, true);
  assert.equal(evaluateAttackEligibility(attacker, { totalPoints: 20_000, resourcePoints: 0 }).allowed, true);
  assert.equal(evaluateAttackEligibility(attacker, { totalPoints: 4_999, resourcePoints: 0 }).allowed, false);
  assert.equal(evaluateAttackEligibility(attacker, { totalPoints: 20_001, resourcePoints: 0 }).allowed, false);
  // Odd totals: half of 10 001 is 5 000.5, so 5 000 is out and 5 001 is in.
  const odd = { totalPoints: 10_001, resourcePoints: 0 };
  assert.equal(evaluateAttackEligibility(odd, { totalPoints: 5_000, resourcePoints: 0 }).allowed, false);
  assert.equal(evaluateAttackEligibility(odd, { totalPoints: 5_001, resourcePoints: 0 }).allowed, true);
  assert.deepEqual(attackPointRange(10_001), { min: 5_001, max: 20_002 });
});

test('the resource band admits a target outside the total band, inclusive at both edges', () => {
  const attacker = { totalPoints: 10_000, resourcePoints: 2_400 };
  // 1 200 and 4 800 resource points are the exact edges.
  const atLow = evaluateAttackEligibility(attacker, { totalPoints: 40_000, resourcePoints: 1_200 });
  assert.deepEqual(atLow, { allowed: true, reason: null, message: null, byTotal: false, byResource: true });
  assert.equal(evaluateAttackEligibility(attacker, { totalPoints: 40_000, resourcePoints: 4_800 }).allowed, true);
  assert.equal(evaluateAttackEligibility(attacker, { totalPoints: 40_000, resourcePoints: 1_199 }).allowed, false);
  assert.equal(evaluateAttackEligibility(attacker, { totalPoints: 40_000, resourcePoints: 4_801 }).allowed, false);
});

test('total only, resource only and both branches', () => {
  const attacker = { totalPoints: 10_000, resourcePoints: 2_400 };
  const totalOnly = evaluateAttackEligibility(attacker, { totalPoints: 12_000, resourcePoints: 100 });
  assert.equal(totalOnly.allowed && totalOnly.byTotal && !totalOnly.byResource, true);
  const resourceOnly = evaluateAttackEligibility(attacker, { totalPoints: 30_000, resourcePoints: 3_000 });
  assert.equal(resourceOnly.allowed && !resourceOnly.byTotal && resourceOnly.byResource, true);
  const both = evaluateAttackEligibility(attacker, { totalPoints: 9_000, resourcePoints: 2_000 });
  assert.equal(both.allowed && both.byTotal && both.byResource, true);
});

test('zero resource points never admit through the resource branch', () => {
  // 0 is within [0/2; 0×2], yet a zero on either side does not admit.
  assert.equal(evaluateAttackEligibility({ totalPoints: 1_000, resourcePoints: 0 }, { totalPoints: 5_000, resourcePoints: 0 }).allowed, false);
  assert.equal(evaluateAttackEligibility({ totalPoints: 1_000, resourcePoints: 0 }, { totalPoints: 5_000, resourcePoints: 1 }).allowed, false);
  assert.equal(evaluateAttackEligibility({ totalPoints: 1_000, resourcePoints: 1 }, { totalPoints: 5_000, resourcePoints: 0 }).allowed, false);
  // Missing or broken values read as zero points (protected).
  assert.equal(evaluateAttackEligibility(undefined, pts(1_000)).reason, 'attacker-protected');
  assert.equal(evaluateAttackEligibility(pts(1_000), { totalPoints: Number.NaN, resourcePoints: 5 }).reason, 'defender-protected');
});

test('an out-of-range refusal names both allowed bands with figures', () => {
  const refused = evaluateAttackEligibility({ totalPoints: 10_000, resourcePoints: 2_400 }, { totalPoints: 30_000, resourcePoints: 900 });
  assert.equal(refused.allowed, false);
  assert.equal(refused.reason, 'out-of-range');
  assert.equal(refused.message, 'Цель вне диапазона: у цели 30 000 общих и 900 ресурсных, допустимо 5 000–20 000 общих или 1 200–4 800 ресурсных.');
  const noResource = evaluateAttackEligibility({ totalPoints: 1_000, resourcePoints: 0 }, { totalPoints: 3_000, resourcePoints: 0 });
  assert.equal(noResource.message, 'Цель вне диапазона: у цели 3 000 общих и 0 ресурсных, допустимо 500–2 000 общих.');
});
