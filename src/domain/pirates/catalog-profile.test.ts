import assert from 'node:assert/strict';
import test from 'node:test';

import { PIRATE_BASE_SHIPS, PIRATE_CATALOG, PIRATE_CATALOG_BY_ID, PIRATE_SHIP_IDS } from './catalog.ts';
import {
  createPirateProfile,
  calculatePirateEliminationPopulationBudget,
  expectedPirateTierShares,
  pirateLevelForResourcePoints,
  pirateTechnologyLevelForResourcePoints,
  pirateTechnologyLevels,
  PIRATE_RESOURCE_LEVEL_THRESHOLDS,
  PIRATE_TECH_LEVEL_THRESHOLDS,
  PIRATE_EXCLUSIVE_TECHNOLOGIES,
} from './profile.ts';
import { COMBAT_TECHNOLOGY_IDS } from '../combat/technologies.ts';

test('pirate catalog maps the seven local assets to the approved UI names and roles', () => {
  assert.deepEqual(PIRATE_CATALOG.map(({ imageFile, name, role }) => [imageFile, name, role]), [
    ['red_wraith.png', 'Гончий', 'Scout'],
    ['gutterstar.png', 'Налётчик', 'Cruiser'],
    ['chainjack.png', 'Капер', 'Defender'],
    ['black_harrow.png', 'Палач', 'Battleship'],
    ['void_butcher.png', 'Потрошитель', 'Destroyer'],
    ['ashfang.png', 'Громила', 'Bomber'],
    ['crown_eater.png', 'Погибель', 'Planet breaker'],
  ]);
  assert.equal(PIRATE_CATALOG.length, 7);
  assert.equal(PIRATE_BASE_SHIPS.length, 6);
  assert.equal(PIRATE_CATALOG_BY_ID['pirate-planet-breaker'].tier, 'special');
  assert.ok(Object.isFrozen(PIRATE_CATALOG));
  assert.ok(PIRATE_CATALOG.every((ship) => Object.isFrozen(ship) && Object.isFrozen(ship.cost) && Object.isFrozen(ship.combat) && Object.isFrozen(ship.ability)));
  assert.deepEqual(PIRATE_SHIP_IDS, PIRATE_CATALOG.map((ship) => ship.id));
});

test('catalog uses componentwise three-faction medians for base stats, costs, and population', () => {
  const hound = PIRATE_CATALOG_BY_ID['pirate-hound'];
  assert.equal(hound.population, 2);
  assert.deepEqual(hound.cost, { metal: 2_400, minerals: 1_600, gas: 0 });
  assert.deepEqual(hound.combat, { attack: 800, life: 2_400, weaponType: 'Лазер', armorType: 'Легкая Броня', armorStrength: 3 });

  assert.equal(PIRATE_CATALOG_BY_ID['pirate-corsair'].ability.kind, 'bonus-life');
  assert.equal(PIRATE_CATALOG_BY_ID['pirate-corsair'].ability.kind === 'bonus-life' ? PIRATE_CATALOG_BY_ID['pirate-corsair'].ability.perShipRate : 0, 0.0005);
  assert.equal(PIRATE_CATALOG_BY_ID['pirate-executioner'].ability.kind === 'armor-boost' ? PIRATE_CATALOG_BY_ID['pirate-executioner'].ability.perShipRate : 0, 0.00028);
});

test('score anchors interpolate on log10 and keep lower tiers unavailable before their anchors', () => {
  assert.deepEqual(expectedPirateTierShares(1_000), { 1: 100, 2: 0, 3: 0 });
  assert.deepEqual(expectedPirateTierShares(10_000), { 1: 85, 2: 15, 3: 0 });
  assert.deepEqual(expectedPirateTierShares(100_000), { 1: 70, 2: 25, 3: 5 });
  assert.deepEqual(expectedPirateTierShares(1_000_000), { 1: 15, 2: 25, 3: 60 });
  assert.deepEqual(expectedPirateTierShares(10_000_000), { 1: 5, 2: 15, 3: 80 });
  const interpolated = expectedPirateTierShares(5_000);
  assert.ok(Math.abs(interpolated[1] - 89.51545) < 0.00001);
  assert.ok(Math.abs(interpolated[2] - 10.48455) < 0.00001);
  assert.equal(interpolated[3], 0);
  assert.deepEqual(expectedPirateTierShares(0), { 1: 100, 2: 0, 3: 0 });
});

test('profile composition is a deterministic 5% population mix and samples only unlocked tiers', () => {
  const input = {
    ownerId: 'owner-a', contactCycleKey: 'system-4/cycle-9',
    score: { totalPoints: 132_000, resourcePoints: 120_000, battlePoints: 12_000 },
  };
  const first = createPirateProfile(input);
  const second = createPirateProfile(input);
  assert.deepEqual(first, second);
  assert.equal(Object.values(first.shares).reduce((sum, share) => sum + share, 0), 100);
  assert.ok(Object.values(first.shares).every((share) => share! >= 0 && share! % 5 === 0));
  assert.equal('pirate-planet-breaker' in first.shares, false);
  assert.equal(Object.keys(first.shares).length, 6);
  const actualTierShares = { 1: 0, 2: 0, 3: 0 };
  for (const ship of PIRATE_BASE_SHIPS) actualTierShares[ship.tier as 1 | 2 | 3] += first.shares[ship.id] ?? 0;
  assert.deepEqual(first.sampledTierShares, actualTierShares);
  assert.equal(first.tier, ([1, 2, 3] as const).reduce((selected, candidate) =>
    actualTierShares[candidate] > actualTierShares[selected] ? candidate : selected, 1));
  assert.notEqual(createPirateProfile({ ...input, ownerId: 'owner-b' }).seed, first.seed);
  assert.notEqual(createPirateProfile({ ...input, contactCycleKey: 'system-4/cycle-10' }).seed, first.seed);

  for (const totalPoints of [0, 1_000, 9_999]) {
    const early = createPirateProfile({ ...input, score: { totalPoints, resourcePoints: totalPoints, battlePoints: 0 }, contactCycleKey: `early-${totalPoints}` });
    assert.equal(early.tier, 1);
    assert.equal(early.sampledTierShares[2] + early.sampledTierShares[3], 0);
    assert.equal(early.shares['pirate-hound']! + early.shares['pirate-raider']!, 100);
  }

  const samples = Array.from({ length: 2_000 }, (_, index) => createPirateProfile({
    ...input, score: { totalPoints: 1_000_000, resourcePoints: 1_000_000, battlePoints: 0 }, ownerId: `owner-${index}`, contactCycleKey: 'cycle-1',
  }));
  const tierThreeRate = samples.reduce((sum, sample) => sum + sample.sampledTierShares[3], 0) / (samples.length * 100);
  assert.ok(tierThreeRate > 0.55 && tierThreeRate < 0.65, `tier 3 sample rate was ${tierThreeRate}`);
  assert.ok(samples.some((sample) => Object.values(sample.shares).filter((share) => share! > 0).length > 1), 'mixed profiles should be possible');
});

test('mono-composition profile remains possible but rare after sampling twenty slices', () => {
  const mono = createPirateProfile({
    ownerId: 'mono-search-8497', contactCycleKey: 'fixed',
    score: { totalPoints: 1_000, resourcePoints: 1_000, battlePoints: 0 },
  });
  assert.equal(Object.values(mono.shares).filter((share) => share! > 0).length, 1);
  // With two equally likely tier-one ship classes, one class filling all 20
  // independent slices has a probability of 2 / 2^20 (about one in 524,288).
});

test('profile rejects a total score that contradicts resources plus battle points', () => {
  assert.throws(() => createPirateProfile({ ownerId: 'score-mismatch', contactCycleKey: 'cycle',
    score: { resourcePoints: 40_000, battlePoints: 60_000, totalPoints: 5 } }), /totalPoints must equal resourcePoints \+ battlePoints/i);
  const profile = createPirateProfile({ ownerId: 'score-valid', contactCycleKey: 'cycle',
    score: { resourcePoints: 40_000, battlePoints: 60_000, totalPoints: 100_000 } });
  assert.deepEqual(profile.score, { resourcePoints: 40_000, battlePoints: 60_000, totalPoints: 100_000 });
  assert.deepEqual(profile.expectedTierShares, expectedPirateTierShares(100_000));
});

test('elimination budget allocates rounded 90% by mixed population shares and reports rounding error', () => {
  const exact = calculatePirateEliminationPopulationBudget(10_000, { 'pirate-hound': 100 });
  assert.equal(exact.targetPopulation, 9_000);
  assert.equal(exact.actualPopulation, 9_000);
  assert.equal(exact.absoluteError, 0);
  assert.deepEqual(exact.ships, { 'pirate-hound': 4_500 });

  const inexact = calculatePirateEliminationPopulationBudget(10_001, { 'pirate-executioner': 100 });
  assert.equal(inexact.targetPopulation, 9_001);
  assert.equal(inexact.actualPopulation, Object.values(inexact.ships).reduce((sum, count) => sum + count! * 13, 0));
  assert.equal(inexact.absoluteError, Math.abs(inexact.actualPopulation - 9_001));
  assert.ok(inexact.absoluteError <= 6);

  const mixedShares = { 'pirate-hound': 20, 'pirate-raider': 20, 'pirate-corsair': 20,
    'pirate-executioner': 20, 'pirate-butcher': 10, 'pirate-bruiser': 10 } as const;
  const roundingErrorBound = Object.keys(mixedShares).reduce((sum, id) =>
    sum + PIRATE_CATALOG_BY_ID[id as keyof typeof PIRATE_CATALOG_BY_ID].population / 2, 0);
  let measuredMaximumError = 0;
  for (const sent of [1, 17, 100, 999, 10_001, 100_003, 1_000_007]) {
    const budget = calculatePirateEliminationPopulationBudget(sent, mixedShares);
    measuredMaximumError = Math.max(measuredMaximumError, budget.absoluteError);
    assert.equal(budget.targetPopulation, Math.round(sent * 0.9));
    assert.ok(Object.keys(budget.ships).every((id) => Object.hasOwn(mixedShares, id)));
    const actual = Object.entries(budget.ships).reduce((sum, [id, count]) => sum + count! * PIRATE_CATALOG_BY_ID[id as keyof typeof PIRATE_CATALOG_BY_ID].population, 0);
    assert.equal(actual, budget.actualPopulation);
    assert.ok(budget.absoluteError <= roundingErrorBound,
      `error ${budget.absoluteError} exceeded half active population total (${roundingErrorBound})`);
  }
  assert.ok(measuredMaximumError > 0 && measuredMaximumError <= roundingErrorBound);
  assert.throws(() => calculatePirateEliminationPopulationBudget(1_000, { 'pirate-hound': 70, 'pirate-raider': 20 }), /normalized/);
  assert.throws(() => calculatePirateEliminationPopulationBudget(1_000, { 'pirate-planet-breaker': 100 }), /normalized ordinary-ship/);
});

test('resource-point and combat-tech thresholds map exactly and emit only resolver-supported ids', () => {
  PIRATE_RESOURCE_LEVEL_THRESHOLDS.forEach((threshold, level) => {
    assert.equal(pirateLevelForResourcePoints(threshold), level);
    if (level > 0) assert.equal(pirateLevelForResourcePoints(threshold - 1), level - 1);
  });
  PIRATE_TECH_LEVEL_THRESHOLDS.forEach((threshold, level) => {
    assert.equal(pirateTechnologyLevelForResourcePoints(threshold), level);
    if (level > 0) assert.equal(pirateTechnologyLevelForResourcePoints(threshold - 1), level - 1);
  });
  for (const selected of PIRATE_EXCLUSIVE_TECHNOLOGIES) {
    const techs = pirateTechnologyLevels(6_000_000, selected);
    assert.deepEqual(Object.keys(techs).sort(), [...COMBAT_TECHNOLOGY_IDS].sort());
    assert.ok(Object.values(techs).every((level) => level === 0 || level === 10));
    assert.equal(techs[selected], 10);
    for (const other of PIRATE_EXCLUSIVE_TECHNOLOGIES.filter((id) => id !== selected)) assert.equal(techs[other], 0);
    for (const compatible of COMBAT_TECHNOLOGY_IDS.filter((id) => !PIRATE_EXCLUSIVE_TECHNOLOGIES.includes(id as typeof selected))) assert.equal(techs[compatible], 10);
  }
  const profile = createPirateProfile({ ownerId: 'o', contactCycleKey: 'c', score: { totalPoints: 0, resourcePoints: -1, battlePoints: 0 } });
  assert.equal(profile.shipLevel, 0);
  assert.ok(PIRATE_EXCLUSIVE_TECHNOLOGIES.includes(profile.exclusiveTechnologyId));
  assert.deepEqual(profile.technologies, createPirateProfile({ ownerId: 'o', contactCycleKey: 'c', score: { totalPoints: 0, resourcePoints: -1, battlePoints: 0 } }).technologies);
});
