import assert from 'node:assert/strict';
import test from 'node:test';

import { PIRATE_CATALOG } from './catalog.ts';
import { runPirateCombatBalanceSimulation } from './balance-simulation.ts';

test('balance harness produces reproducible matchup, profile, and level tables', () => {
  const first = runPirateCombatBalanceSimulation({ runsPerMatchup: 2, doubleAttackRuns: 100 });
  const second = runPirateCombatBalanceSimulation({ runsPerMatchup: 2, doubleAttackRuns: 100 });
  assert.equal(first.matchupCount, 135);
  assert.equal(first.totalBattles, 270);
  assert.equal(first.profileSampling.length, 15);
  assert.equal(first.levelStats.length, PIRATE_CATALOG.length * 3);
  assert.equal(first.catalogMedians.length, PIRATE_CATALOG.length);
  assert.equal(first.classMatchups.length, 36);
  assert.deepEqual(first.matchups, second.matchups);
  assert.deepEqual(first.ripperCalibration, second.ripperCalibration);
});
