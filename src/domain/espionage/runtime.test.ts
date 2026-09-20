import test from 'node:test';
import assert from 'node:assert/strict';
import { hunterDetects, resolveSpyReportQuality } from './runtime.ts';
import { createBot01Planets } from './fixtures.ts';

test('spy report quality uses an integer 0..99 with lower-inclusive upper-exclusive intervals', () => {
  assert.equal(resolveSpyReportQuality(0, 0), 'full');
  assert.equal(resolveSpyReportQuality(0, 29), 'full');
  assert.equal(resolveSpyReportQuality(0, 30), 'detailed');
  assert.equal(resolveSpyReportQuality(0, 59), 'detailed');
  assert.equal(resolveSpyReportQuality(0, 60), 'basic');
  assert.equal(resolveSpyReportQuality(0, 99), 'basic');
});

test('spy quality applies every delta probability row with exact boundaries', () => {
  const rows: Array<[number, number, number, string, string]> = [
    [4, 90, 100, 'detailed', 'detailed'],
    [3, 75, 90, 'detailed', 'basic'],
    [2, 65, 85, 'detailed', 'basic'],
    [1, 40, 70, 'detailed', 'basic'],
    [0, 30, 60, 'detailed', 'basic'],
    [-1, 20, 45, 'detailed', 'basic'],
    [-2, 0, 20, 'detailed', 'basic'],
    [-3, 0, 10, 'detailed', 'basic'],
    [-4, 0, 0, 'basic', 'basic'],
  ];
  for (const [delta, fullBoundary, basicBoundary, detailedAt, basicAt] of rows) {
    if (fullBoundary > 0) assert.equal(resolveSpyReportQuality(delta, fullBoundary - 1), 'full');
    assert.equal(resolveSpyReportQuality(delta, fullBoundary), detailedAt);
    if (basicBoundary <= 99) assert.equal(resolveSpyReportQuality(delta, basicBoundary), basicAt);
    else assert.equal(resolveSpyReportQuality(delta, 99), basicAt);
  }
});

test('Hunter level 20 means a 35% detection interval', () => {
  assert.equal(hunterDetects(20, 34), true);
  assert.equal(hunterDetects(20, 35), false);
  assert.equal(hunterDetects(20, 99), false);
});

test('Bot 01 fixture keeps espionage level 10 and one full combat reference planet', () => {
  const planets = Object.values(createBot01Planets());
  assert.equal(planets.length, 7);
  const main = planets[0];
  assert.equal(main.espionageLevel, 10);
  assert.equal(main.hunterLevel, 20);
  assert.equal(main.commanders.hunter?.count, 1);
  assert.equal(main.commanders.judge?.count, 1);
  assert.equal(main.population.fleet >= 5_000 && main.population.fleet <= 5_100, true);
  assert.equal(main.population.defense >= 4_900 && main.population.defense <= 5_100, true);
  assert.equal(planets.slice(1).every((planet) => planet.hunterLevel === 0), true);
});
