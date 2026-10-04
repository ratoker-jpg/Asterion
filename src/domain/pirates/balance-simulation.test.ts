import assert from 'node:assert/strict';
import test from 'node:test';

import { PIRATE_BASE_SHIPS, PIRATE_CATALOG } from './catalog.ts';
import { pirateCombatBalanceMarkdown, PIRATE_BALANCE_SCORE_BANDS, PIRATE_PROFILE_SLICES, runPirateCombatBalanceSimulation } from './balance-simulation.ts';
import { createPirateProfile, expectedPirateTierShares, pirateLevelForResourcePoints, pirateTechnologyLevelForResourcePoints } from './profile.ts';

test('balance harness produces reproducible matchup, profile, and level tables', () => {
  const first = runPirateCombatBalanceSimulation({ runsPerMatchup: 2, doubleAttackRuns: 100 });
  const second = runPirateCombatBalanceSimulation({ runsPerMatchup: 2, doubleAttackRuns: 100 });
  assert.equal(first.matchupCount, 162);
  assert.equal(first.totalBattles, 324);
  assert.equal(first.profileSampling.length, 18);
  assert.equal(first.levelStats.length, PIRATE_CATALOG.length * 3);
  assert.equal(first.catalogMedians.length, PIRATE_CATALOG.length);
  assert.equal(first.catalogMedians.length * 3, 21);
  assert.equal(first.classMatchups.length, 36);
  assert.deepEqual(first.matchups, second.matchups);
  assert.deepEqual(first.ripperCalibration, second.ripperCalibration);
  assert.equal(first.ripperCalibration.runs, 100);
  assert.equal(first.totalBattles, first.matchupCount * first.runsPerMatchup);
  assert.equal(first.matchups[0]?.pirateStartingPopulationRange[0]! >= 0, true);
  assert.ok(first.matchups.every((row) => row.attackerStartingPopulationRange[0] <= row.attackerStartingPopulationRange[1]));
  const markdown = pirateCombatBalanceMarkdown(first);
  assert.match(markdown, /Primary-matchup seed fields only: faction, score band, attacker tech, formation, and run index\./);
  assert.ok(markdown.includes('Ripper calibration uses a separate seed schema: `pirate-combat-v2:double-attack:<base-10 zero-padded 4-digit run index>`'));
  assert.match(markdown, /actual opening player-fleet population across primary matchups ranged from/);
  assert.match(markdown, /Player start population \(actual range\)/);
});

test('profile population shares are 20 seeded five-percent slices across pirate classes', () => {
  const profile = createPirateProfile({
    ownerId: 'balance-test',
    contactCycleKey: 'slice-check',
    score: { totalPoints: 1_000_000, resourcePoints: 100_000, battlePoints: 900_000 },
  });
  const classShares = PIRATE_BASE_SHIPS.map((ship) => profile.shares[ship.id] ?? 0);
  assert.equal(classShares.reduce((sum, share) => sum + share, 0), 100);
  assert.ok(classShares.every((share) => share % (100 / PIRATE_PROFILE_SLICES) === 0));
  assert.equal(profile.sampledTierShares[1] + profile.sampledTierShares[2] + profile.sampledTierShares[3], 100);
  assert.deepEqual(profile, createPirateProfile({
    ownerId: 'balance-test',
    contactCycleKey: 'slice-check',
    score: { totalPoints: 1_000_000, resourcePoints: 100_000, battlePoints: 900_000 },
  }));
});

test('battle points change tier mix while resource-derived level and technology remain fixed', () => {
  const resourceOnly = PIRATE_BALANCE_SCORE_BANDS.find((band) => band.id === 'mid')!;
  const battleHeavy = PIRATE_BALANCE_SCORE_BANDS.find((band) => band.id === 'mid-battle-heavy')!;
  assert.equal(resourceOnly.resourcePoints, battleHeavy.resourcePoints);
  assert.notEqual(resourceOnly.totalPoints, battleHeavy.totalPoints);
  assert.notDeepEqual(resourceOnly, battleHeavy);
  assert.equal(pirateLevelForResourcePoints(resourceOnly.resourcePoints), pirateLevelForResourcePoints(battleHeavy.resourcePoints));
  assert.equal(pirateTechnologyLevelForResourcePoints(resourceOnly.resourcePoints), pirateTechnologyLevelForResourcePoints(battleHeavy.resourcePoints));
  const profileA = createPirateProfile({ ownerId: 'score-case', contactCycleKey: 'resource-only', score: resourceOnly });
  const profileB = createPirateProfile({ ownerId: 'score-case', contactCycleKey: 'battle-heavy', score: battleHeavy });
  assert.notDeepEqual(expectedPirateTierShares(resourceOnly.totalPoints), expectedPirateTierShares(battleHeavy.totalPoints));
  assert.equal(profileA.shipLevel, profileB.shipLevel);
  assert.equal(profileA.technologyLevel, profileB.technologyLevel);
});
