import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

import {
  PIRATE_ELIMINATION_DEFEAT_MULTIPLIER,
  PIRATE_ELIMINATION_DRAW_MULTIPLIER,
  selectPirateEliminationMultiplier,
  settlePirateEliminationDebris,
} from './debris.ts';

const frozen = { rewardMultiplier: 1.3, drawMultiplier: PIRATE_ELIMINATION_DRAW_MULTIPLIER, defeatMultiplier: PIRATE_ELIMINATION_DEFEAT_MULTIPLIER };

test('F-07: one outcome rule — full win reward, draw x0.75, partial win and defeat x0.5, legacy x1', () => {
  assert.equal(selectPirateEliminationMultiplier({ victory: true, winner: 'attacker' }, frozen), 1.3);
  assert.equal(selectPirateEliminationMultiplier({ victory: false, winner: 'attacker' }, frozen), 0.5, 'an attacker win that leaves pirates alive is not a victory');
  assert.equal(selectPirateEliminationMultiplier({ victory: false, winner: 'draw' }, frozen), 0.75);
  assert.equal(selectPirateEliminationMultiplier({ victory: false, winner: 'defender' }, frozen), 0.5);
  assert.equal(selectPirateEliminationMultiplier({ victory: false, winner: 'defender' }, {}), 1, 'legacy flights keep x1');
  assert.equal(selectPirateEliminationMultiplier({ victory: true, winner: 'attacker' }, {}), 1);
});

test('F-07: only pirate wreckage is scaled; own hull salvage is never penalized', () => {
  // Audit defeat example: the old tools added pirate debris at x1.
  const defeat = settlePirateEliminationDebris(1_000_000, 600_000, 0.5);
  assert.deepEqual(defeat, { ownDebris: 400_000, adjustedPirateDebris: 300_000, bonusPirateDebris: -300_000, debris: 700_000 });
  const draw = settlePirateEliminationDebris(1_000_000, 600_000, 0.75);
  assert.equal(draw.debris, 400_000 + 450_000);
  const win = settlePirateEliminationDebris(1_000_000, 600_000, 1.5);
  assert.equal(win.debris, 400_000 + 900_000);
  assert.equal(settlePirateEliminationDebris(100, 0, 0.5).debris, 100, 'no pirate wreckage: own salvage untouched');
});

test('F-07: both PR91 comparison tools use the production accounting helpers', () => {
  for (const file of ['tools/generate-pirate-pr91-approved-compare.mjs', 'tools/generate-pirate-pr91-garrison-compare.mjs']) {
    const source = readFileSync(file, 'utf8');
    assert.match(source, /selectPirateEliminationMultiplier\(/, file);
    assert.match(source, /settlePirateEliminationDebris\(/, file);
    assert.doesNotMatch(source, /fullWin\?pirateDebrisRewardMultiplier\([^)]*\):1;/, `${file} still uses x1 for non-wins`);
  }
});
