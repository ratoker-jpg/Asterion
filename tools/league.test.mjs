import assert from 'node:assert/strict';
import test from 'node:test';
import { compareCandidate, makeCandidates, RANGES } from './league.mjs';

const base = { version: 1, params: { hoardDays: 0.25, bottleneckDrive: 1.4, scarcityHigh: 3, styleCapRaise: 0, budgetDaysHigh: 3, spendShareHigh: 0.85, reserveHours: 6, tableWeight: 0 } };

test('a coordinate round moves one number at a time, inside its range, and keeps the base', () => {
  const { candidates } = makeCandidates(base, 1);
  assert.deepEqual(candidates.base, base);
  for (const [name, policy] of Object.entries(candidates)) {
    if (name === 'base') continue;
    const changed = Object.keys(base.params).filter((key) => policy.params[key] !== base.params[key]);
    assert.equal(changed.length, 1, name);
    const [low, high] = RANGES[changed[0]];
    assert.equal(policy.params[changed[0]] >= low && policy.params[changed[0]] <= high, true, name);
  }
  // styleCapRaise and tableWeight sit on their lower edge: only the step up exists.
  assert.equal('styleCapRaise-down' in candidates, false);
  assert.equal('styleCapRaise-up' in candidates, true);
  assert.equal(makeCandidates(base, 3).step, makeCandidates(base, 1).step / 4);
});

const day = (median, bottom, income, lost = 0, entropy = 2, spread = 0.2) => ({ wallSeconds: 1, days: [{ points: { median, top: median * 2, topToBottom: 2 }, bottomThirdPoints: bottom, resources: { median: 1 },
  empire: { incomePerHour: income, losses: { coloniesLost: lost }, defensePopulation: {}, defenseUnits: {}, batteries: {}, idle: {} }, diversity: { styleEntropy: entropy, actionMixSpread: spread }, actions: { started: 1 } }] });
const runs = (candidate) => new Map([['base', new Map([1, 2, 3, 4].map((seed) => [seed, day(100, 50, 1000)]))], ['c', new Map([1, 2, 3, 4].map((seed) => [seed, candidate]))]]);

test('a candidate that lifts points and income without breaking a guard passes', () => {
  const result = compareCandidate(runs(day(110, 55, 1100)), 'c');
  assert.equal(result.passes, true);
  assert.equal(result.objective.mean > 0.09, true);
});

test('a candidate that raises the objective but starves the bottom third, loses colonies or flattens play is held back', () => {
  assert.equal(compareCandidate(runs(day(130, 45, 1300)), 'c').guards.bottomThird, false);
  assert.equal(compareCandidate(runs(day(110, 55, 1100, 3)), 'c').guards.coloniesLost, false);
  assert.equal(compareCandidate(runs(day(110, 55, 1100, 0, 1.5)), 'c').guards.styleEntropy, false);
  assert.equal(compareCandidate(runs(day(110, 55, 1100, 0, 2, 0.1)), 'c').guards.actionMixSpread, false);
});
