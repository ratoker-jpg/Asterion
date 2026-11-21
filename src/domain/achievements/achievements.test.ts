import assert from 'node:assert/strict';
import test from 'node:test';
import { createInitialSaveState } from '../../application/persistence.ts';
import { createAchievementChronicle, parseAchievementChronicle } from './chronicle.ts';
import { ACHIEVEMENT_RANKS, DEVELOPMENT_ACHIEVEMENTS } from './catalog.ts';
import {
  earnedDevelopmentAchievementPoints,
  reconcileDevelopmentAchievementChronicle,
  selectAchievementRankProgress,
  selectAchievementScreenData,
  type AchievementProgressSource,
} from './development.ts';

const NOW = Date.UTC(2026, 0, 1);

function advancedDevelopmentState(): AchievementProgressSource {
  const buildings = Object.fromEntries(
    Object.keys(createInitialSaveState('production', NOW).planets['helion-01']!.buildings)
      .map((role) => [role, 25]),
  );
  return {
    planets: {
      'helion-01': { buildings, energy: 10_000 },
      'helion-02': { buildings: { hangar: 1 } },
    },
  };
}

test('active catalogue uses approved growth achievement values and ranks', () => {
  assert.deepEqual(DEVELOPMENT_ACHIEVEMENTS.map(({ id, points, goal }) => [id, points, goal]), [
    ['builder', 10, 15],
    ['architect', 25, 25],
    ['empire-architect', 50, 300],
    ['colonist', 10, 2],
    ['power-grid', 15, 10_000],
  ]);
  assert.deepEqual(ACHIEVEMENT_RANKS.map(({ at }) => at), [0, 100, 250, 500, 800, 1_200, 1_800, 2_600]);
});

test('fresh production save reports real starting progress without minting awards', () => {
  const initial = createInitialSaveState('production', NOW);
  const chronicle = createAchievementChronicle();
  const screen = selectAchievementScreenData(initial, chronicle);

  assert.deepEqual(screen.entries.map(({ id, progress, goal, met }) => [id, progress, goal, met]), [
    ['builder', 1, 15, false],
    ['architect', 1, 25, false],
    ['empire-architect', 5, 300, false],
    ['colonist', 1, 2, false],
    ['power-grid', Math.min(initial.planets['helion-01']!.availableEnergy ?? initial.planets['helion-01']!.energy, 10_000), 10_000, false],
  ]);
  assert.equal(screen.earnedPoints, 0);
  assert.equal(screen.rank.current.name, 'Новобранец');
  assert.equal(screen.rank.pointsToNext, 100);
});

test('loaded state backfills eligible milestones and repeated loads or copies award no more points', () => {
  const source = advancedDevelopmentState();
  const blank = createAchievementChronicle();
  const context = { at: NOW, campaignId: 'campaign-stable-1' };
  const first = reconcileDevelopmentAchievementChronicle(source, blank, context);

  assert.deepEqual(first.newlyEarned.map(({ id }) => id), ['builder', 'architect', 'empire-architect', 'colonist', 'power-grid']);
  assert.deepEqual(first.newlyEarned[0], { id: 'builder', at: NOW, campaignId: 'campaign-stable-1' });
  assert.equal(earnedDevelopmentAchievementPoints(first.chronicle.earned), 110);
  assert.equal(selectAchievementScreenData(source, first.chronicle).rank.current.name, 'Лейтенант');

  const reload = reconcileDevelopmentAchievementChronicle(source, first.chronicle, { at: NOW + 1, campaignId: 'campaign-stable-1' });
  assert.deepEqual(reload.newlyEarned, []);
  assert.equal(reload.chronicle, first.chronicle, 'no write is needed when every eligible achievement is already recorded');

  const copiedLedger = { ...first.chronicle, earned: [...first.chronicle.earned, ...first.chronicle.earned] };
  assert.equal(earnedDevelopmentAchievementPoints(copiedLedger.earned), 110, 'duplicate ledger rows do not duplicate points');
  assert.deepEqual(reconcileDevelopmentAchievementChronicle(source, copiedLedger, context).newlyEarned, []);
});

test('each development achievement uses its documented threshold', () => {
  const buildings = createInitialSaveState('production', NOW).planets['helion-01']!.buildings;
  const source = (level: number): AchievementProgressSource => ({ planets: { home: { buildings: { ...buildings, hangar: level } } } });
  const at14 = selectAchievementScreenData(source(14), createAchievementChronicle()).entries;
  const at15 = selectAchievementScreenData(source(15), createAchievementChronicle()).entries;
  const at24 = selectAchievementScreenData(source(24), createAchievementChronicle()).entries;
  const at25 = selectAchievementScreenData(source(25), createAchievementChronicle()).entries;

  assert.equal(at14.find(({ id }) => id === 'builder')?.met, false);
  assert.equal(at15.find(({ id }) => id === 'builder')?.met, true);
  assert.equal(at24.find(({ id }) => id === 'architect')?.met, false);
  assert.equal(at25.find(({ id }) => id === 'architect')?.met, true);
});

test('power-grid reads the current available energy balance of one owned planet', () => {
  const source: AchievementProgressSource = {
    planets: {
      home: { buildings: {}, energy: 12_000, availableEnergy: 9_999 },
      colony: { buildings: {}, energy: 10_000, availableEnergy: 10_000 },
    },
  };
  const before = selectAchievementScreenData({ planets: { home: source.planets.home } }, createAchievementChronicle());
  const atGoal = selectAchievementScreenData(source, createAchievementChronicle());

  assert.equal(before.entries.find(({ id }) => id === 'power-grid')?.met, false);
  assert.equal(atGoal.entries.find(({ id }) => id === 'power-grid')?.met, true);
});

test('rank progress follows exact thresholds and caps at legend', () => {
  const beforeFirstRank = selectAchievementRankProgress(99);
  assert.deepEqual([beforeFirstRank.current.name, beforeFirstRank.next?.name, beforeFirstRank.pointsToNext, beforeFirstRank.progressToNext], [
    'Новобранец', 'Лейтенант', 1, 0.99,
  ]);

  const firstRank = selectAchievementRankProgress(100);
  assert.deepEqual([firstRank.current.name, firstRank.next?.name, firstRank.pointsIntoRank, firstRank.progressToNext], [
    'Лейтенант', 'Капитан', 0, 0,
  ]);

  const legend = selectAchievementRankProgress(2_600);
  assert.deepEqual([legend.current.name, legend.next, legend.pointsToNext, legend.progressToNext, legend.maxedOut], [
    'Легенда', null, 0, 1, true,
  ]);
});

test('chronicle parser validates its version 1 record and preserves extension fields', () => {
  const blank = createAchievementChronicle();
  const parsed = parseAchievementChronicle(JSON.stringify({ ...blank, extension: { retained: true } }));
  assert.equal(parsed.ok, true);
  if (parsed.ok) assert.deepEqual(parsed.chronicle.extension, { retained: true });
  assert.deepEqual(parseAchievementChronicle('{broken'), { ok: false, reason: 'invalid' });
  assert.deepEqual(parseAchievementChronicle('{"version":2}'), { ok: false, reason: 'newer' });
  assert.deepEqual(parseAchievementChronicle(JSON.stringify({ ...blank, earned: [{ id: 'builder', at: 'later' }] })), { ok: false, reason: 'invalid' });
});
