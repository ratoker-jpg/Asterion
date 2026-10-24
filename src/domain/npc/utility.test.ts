import assert from 'node:assert/strict';
import test from 'node:test';
import { createNpcState } from './state.ts';
import { estimateForcePower, estimateWinProbability, estimationError, planningHorizonHours, utilityToWeight } from './utility.ts';

const profile = (traits: Record<string, number>) => {
  const base = createNpcState(['npc-utility-owner'], 'npc-utility-tests', 0).profiles['npc-utility-owner']!;
  return { ...base, traits: { ...base.traits, ...traits } };
};

test('force power and win belief favour the stronger side and are monotone', () => {
  const small = estimateForcePower([{ count: 10, attack: 50, life: 400 }]);
  const big = estimateForcePower([{ count: 40, attack: 50, life: 400 }]);
  assert.ok(big > small);
  assert.ok(estimateWinProbability(big, small) > 0.9);
  assert.ok(estimateWinProbability(small, big) < 0.1);
  assert.equal(estimateWinProbability(small, small), 0.5);
  assert.equal(estimateWinProbability(0, small), 0);
});

test('a novice misjudges more widely than an expert, reproducibly', () => {
  const spread = (knowledge: number) => {
    const owner = profile({ mechanicsKnowledge: knowledge });
    return Math.max(...Array.from({ length: 200 }, (_, index) => Math.abs(estimationError(owner, `event-${index}`, 'candidate'))));
  };
  assert.ok(spread(0) > 0.45 && spread(1) <= 0.08 + 1e-9);
  const owner = profile({ mechanicsKnowledge: 0.3 });
  assert.equal(estimationError(owner, 'e', 'c'), estimationError(owner, 'e', 'c'));
});

test('planning horizon and weights stay bounded', () => {
  assert.equal(planningHorizonHours(profile({ planningHorizon: 0 })), 6);
  assert.equal(planningHorizonHours(profile({ planningHorizon: 1 })), 72);
  assert.ok(utilityToWeight(-100) > 0 && utilityToWeight(-100) < 0.01);
  assert.equal(utilityToWeight(0), 1);
  assert.ok(utilityToWeight(100) <= Math.exp(2.5));
});
