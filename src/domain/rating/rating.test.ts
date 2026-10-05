import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CURRENT_PLAYER_ID,
  CURRENT_PLAYER_DISPLAY_NAME,
  createAllianceRatingEntries,
  createDefaultRatingPrototypeState,
  createPlayerRatingEntries,
  migrateRatingPrototypeState,
} from './fixtures.ts';
import { clampPage, filterAlliances, filterPlayers, pageForEntry, paginate, sortPlayers } from './selectors.ts';
import { createDefaultCommandState, updateAllianceSettings } from '../command/repository.ts';
import { selectCurrentAlliance } from '../command/selectors.ts';

test('player display provider is deterministic with unique ids and ranks', () => {
  const a = createPlayerRatingEntries();
  const b = createPlayerRatingEntries();
  assert.deepEqual(a, b);
  assert.equal(new Set(a.map((entry) => entry.id)).size, a.length);
  assert.equal(new Set(a.map((entry) => entry.rank)).size, a.length);
});

test('current rating row uses the profile fixture display name', () => {
  const current = createPlayerRatingEntries().find((entry) => entry.id === CURRENT_PLAYER_ID);
  assert.equal(current?.name, CURRENT_PLAYER_DISPLAY_NAME);
});

test('player scores are finite non-negative and source relation total = resource + battle holds', () => {
  for (const entry of createPlayerRatingEntries()) {
    for (const value of [entry.achievementPoints, entry.totalPoints, entry.resourcePoints, entry.battlePoints]) {
      assert.equal(Number.isFinite(value), true);
      assert.equal(value >= 0, true);
    }
    assert.equal(entry.totalPoints, entry.resourcePoints + entry.battlePoints);
  }
});

test('legacy resource placeholders migrate to empty score ledgers without losing new ledgers', () => {
  const empty = { battleAwardsByReportId: {}, unrecoveredCostsByOwnerId: {} };
  assert.deepEqual(createDefaultRatingPrototypeState(), empty);
  assert.deepEqual(migrateRatingPrototypeState(undefined), empty);
  assert.deepEqual(migrateRatingPrototypeState({ resourcePoints: 900_001.9 }), empty);
  assert.deepEqual(migrateRatingPrototypeState({ resourcePoints: -1 }), empty);
  assert.deepEqual(migrateRatingPrototypeState({
    resourcePoints: 855_880,
    battleAwardsByReportId: { battle: { owner: 12.9, invalid: -1 } },
    unrecoveredCostsByOwnerId: { owner: { metal: 12.9, minerals: -1, gas: 4, energy: 900 } },
  }), {
    battleAwardsByReportId: { battle: { owner: 12 } },
    unrecoveredCostsByOwnerId: { owner: { metal: 12, minerals: 0, gas: 4 } },
  });

  const current = createPlayerRatingEntries(900_001).find((entry) => entry.id === CURRENT_PLAYER_ID);
  assert.equal(current?.resourcePoints, 900_001);
  assert.equal(current?.totalPoints, (current?.battlePoints ?? 0) + 900_001);
});

test('achievement points remain zero and a new current player score defaults to zero', () => {
  const rows = createPlayerRatingEntries();
  assert.equal(rows.find((entry) => entry.id === CURRENT_PLAYER_ID)?.resourcePoints, 0);
  assert.equal(rows.every((entry) => entry.achievementPoints === 0), true);
});

test('search is case-insensitive and score sorting works', () => {
  const entries = createPlayerRatingEntries();
  const match = filterPlayers(entries, 'vEgA-01');
  assert.equal(match.length, 1);
  const sorted = sortPlayers(entries, 'battlePoints', 'asc');
  assert.equal(sorted[0].battlePoints <= sorted[1].battlePoints, true);
});

test('pagination clamps and show-current resolves the correct page', () => {
  const entries = createPlayerRatingEntries();
  assert.equal(clampPage(999, entries.length, 12), 7);
  assert.equal(paginate(entries, 999, 12).page, 7);
  const page = pageForEntry(entries, 12, (entry) => entry.id === CURRENT_PLAYER_ID);
  assert.equal(page, 4);
});

test('alliance mode is deterministic and can reuse current Command alliance identity', () => {
  const command = updateAllianceSettings(createDefaultCommandState(), {
    name: '  Asterion Guard  ',
    tag: ' ast ',
    motto: 'Маяк.',
    description: 'Контур.',
    emblem: { glyph: 'orbit', accent: 'violet' },
  });
  const currentAlliance = selectCurrentAlliance(command);
  const first = createAllianceRatingEntries(currentAlliance);
  const second = createAllianceRatingEntries(currentAlliance);
  assert.deepEqual(first, second);
  const current = first.find((entry) => entry.isCurrentAlliance);
  assert.equal(current?.name, 'Asterion Guard');
  assert.equal(current?.tag, 'AST');
  assert.equal(filterAlliances(first, 'ast').some((entry) => entry.isCurrentAlliance), true);
});

test('production rating exposes only the current player and no alliance rows', () => {
  const players = createPlayerRatingEntries(900_001, 'production');
  const alliances = createAllianceRatingEntries(null, 'production');

  assert.equal(players.length, 1);
  assert.equal(players[0].isCurrentPlayer, true);
  assert.equal(players[0].rank, 1);
  assert.equal(players[0].totalPoints, 900_001);
  assert.deepEqual(alliances, []);
});
