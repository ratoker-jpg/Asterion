import assert from 'node:assert/strict';
import test from 'node:test';

import { calculateBattlePoints, calculateResourcePointsLost } from './battle-points.ts';

const stack = (entityId: string, countBefore: number | null, countAfter: number | null) => ({ entityId, countBefore, countAfter });

test('resource points use destroyed catalog cost, solar satellites included (3 points each)', () => {
  assert.equal(calculateResourcePointsLost([
    stack('scout', 10, 0),
    stack('solar-satellite', 10, 0),
  ]), 70);
  assert.equal(calculateResourcePointsLost([], [stack('laser-turret', 1, 0)]), 4.5);
});

test('resource points use faction-specific historical costs when a faction is provided', () => {
  assert.equal(calculateResourcePointsLost([stack('scout', 1, 0)], [], 'veyra'), 2);
  assert.equal(calculateResourcePointsLost([], [stack('laser-turret', 1, 0)], 'synod'), 18);
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

test('destroying 5 000 solar satellites costs the defender 15 000 RP and gives a lossless attacker 15 000 BP', () => {
  const result = calculateBattlePoints(
    'attacker',
    [stack('cruiser', 100, 100)],
    [stack('solar-satellite', 5_000, 0)],
  );
  assert.equal(result.attackerResourcePointsLost, 0);
  assert.equal(result.defenderResourcePointsLost, 15_000);
  assert.equal(result.attacker, 15_000);
  for (const faction of ['aegis', 'synod', 'veyra'] as const) {
    assert.equal(calculateResourcePointsLost([stack('solar-satellite', 5_000, 0)], [], faction), 15_000);
  }
});
