import assert from 'node:assert/strict';
import test from 'node:test';
import { createAllianceRatingEntries, createPlayerRatingEntries, CURRENT_PLAYER_ID } from './fixtures.ts';
import { clampPage, filterAlliances, filterPlayers, pageForEntry, paginate, sortPlayers } from './selectors.ts';

test('player display provider is deterministic with unique ids and ranks', () => {
  const a = createPlayerRatingEntries();
  const b = createPlayerRatingEntries();
  assert.deepEqual(a, b);
  assert.equal(new Set(a.map((entry) => entry.id)).size, a.length);
  assert.equal(new Set(a.map((entry) => entry.rank)).size, a.length);
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
  const first = createAllianceRatingEntries({ name: 'Asterion Guard', tag: 'AST' });
  const second = createAllianceRatingEntries({ name: 'Asterion Guard', tag: 'AST' });
  assert.deepEqual(first, second);
  const current = first.find((entry) => entry.isCurrentAlliance);
  assert.equal(current?.name, 'Asterion Guard');
  assert.equal(current?.tag, 'AST');
  assert.equal(filterAlliances(first, 'ast').some((entry) => entry.isCurrentAlliance), true);
});
