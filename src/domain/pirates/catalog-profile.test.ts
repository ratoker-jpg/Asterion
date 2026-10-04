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

test('profile composition is seeded, one-hot normalized, and samples only unlocked tiers', () => {
  const input = {
    ownerId: 'owner-a', contactCycleKey: 'system-4/cycle-9',
    score: { totalPoints: 1_000_000, resourcePoints: 120_000, battlePoints: 12_000 },
  };
  const first = createPirateProfile(input);
  const second = createPirateProfile(input);
  assert.deepEqual(first, second);
  assert.equal(Object.values(first.shares).reduce((sum, share) => sum + share, 0), 100);
  assert.ok(Object.values(first.shares).every((share) => share === 0 || share === 100));
  const selectedId = Object.entries(first.shares).find(([, share]) => share === 100)?.[0] as keyof typeof first.shares;
  assert.equal(PIRATE_CATALOG_BY_ID[selectedId].tier, first.tier);
  assert.notEqual(createPirateProfile({ ...input, ownerId: 'owner-b' }).seed, first.seed);
  assert.notEqual(createPirateProfile({ ...input, contactCycleKey: 'system-4/cycle-10' }).seed, first.seed);

  for (const totalPoints of [0, 1_000, 9_999]) {
    const early = createPirateProfile({ ...input, score: { ...input.score, totalPoints }, contactCycleKey: `early-${totalPoints}` });
    assert.equal(early.tier, 1);
    assert.ok(early.shares['pirate-hound'] === 100 || early.shares['pirate-raider'] === 100);
  }

  const samples = Array.from({ length: 2_000 }, (_, index) => createPirateProfile({
    ...input, ownerId: `owner-${index}`, contactCycleKey: 'cycle-1',
  }));
  const tierThreeRate = samples.filter((sample) => sample.tier === 3).length / samples.length;
  assert.ok(tierThreeRate > 0.55 && tierThreeRate < 0.65, `tier 3 sample rate was ${tierThreeRate}`);
});

test('elimination budget targets rounded 90% and reports nearest representable population', () => {
  const exact = calculatePirateEliminationPopulationBudget(10_000, { 'pirate-hound': 100, 'pirate-planet-breaker': 0 });
  assert.equal(exact.targetPopulation, 9_000);
  assert.equal(exact.actualPopulation, 9_000);
  assert.equal(exact.absoluteError, 0);
  assert.deepEqual(exact.ships, { 'pirate-hound': 4_500 });

  const inexact = calculatePirateEliminationPopulationBudget(10_000, { 'pirate-executioner': 100, 'pirate-planet-breaker': 0 });
  assert.equal(inexact.targetPopulation, 9_000);
  assert.equal(inexact.actualPopulation, Object.values(inexact.ships).reduce((sum, count) => sum + count! * 13, 0));
  assert.equal(inexact.absoluteError, Math.abs(inexact.actualPopulation - 9_000));
  assert.ok(inexact.absoluteError <= 6);
  assert.throws(() => calculatePirateEliminationPopulationBudget(1_000, { 'pirate-hound': 70, 'pirate-raider': 30 }), /mono-class/);
  assert.throws(() => calculatePirateEliminationPopulationBudget(1_000, { 'pirate-planet-breaker': 100 }), /Planet breaker/);
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
  const profile = createPirateProfile({ ownerId: 'o', contactCycleKey: 'c', score: { totalPoints: 1, resourcePoints: -1, battlePoints: 0 } });
  assert.equal(profile.shipLevel, 0);
  assert.ok(PIRATE_EXCLUSIVE_TECHNOLOGIES.includes(profile.exclusiveTechnologyId));
  assert.deepEqual(profile.technologies, createPirateProfile({ ownerId: 'o', contactCycleKey: 'c', score: { totalPoints: 1, resourcePoints: -1, battlePoints: 0 } }).technologies);
});
