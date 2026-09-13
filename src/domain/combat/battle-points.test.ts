import assert from 'node:assert/strict';
import test from 'node:test';

import { calculateBattlePoints, calculateResourcePointsLost } from './battle-points.ts';

const stack = (entityId: string, countBefore: number | null, countAfter: number | null) => ({ entityId, countBefore, countAfter });

test('resource points use destroyed catalog cost and exclude solar satellites', () => {
  assert.equal(calculateResourcePointsLost([
    stack('scout', 10, 0),
    stack('solar-satellite', 10, 0),
  ]), 40);
  assert.equal(calculateResourcePointsLost([], [stack('laser-turret', 1, 0)]), 4.5);
});

test('winner and loser Battle Points follow the Nemexia formula', () => {
  const result = calculateBattlePoints(
    'attacker',
    [stack('scout', 1, 1)],
    [stack('scout', 25, 0)],
  );

  assert.equal(result.attackerResourcePointsLost, 0);
  assert.equal(result.defenderResourcePointsLost, 100);
  assert.equal(result.attacker, 100);
  assert.equal(result.defender, 0);
});

test('draw treats the side with fewer resource losses as the formula winner', () => {
  const result = calculateBattlePoints(
    'draw',
    [stack('scout', 1, 0)],
    [stack('scout', 2, 0)],
  );

  assert.equal(result.attackerResourcePointsLost, 4);
  assert.equal(result.defenderResourcePointsLost, 8);
  assert.equal(result.attacker, 10);
  assert.equal(result.defender, 3);
});

test('malformed or zero-loss inputs are safe and produce no points', () => {
  const result = calculateBattlePoints(
    'attacker',
    [stack('unknown', 5, 0), stack('scout', null, 0)],
    [],
    [],
    [],
  );

  assert.deepEqual(result, {
    attackerResourcePointsLost: 0,
    defenderResourcePointsLost: 0,
    attacker: 0,
    defender: 0,
  });
});
