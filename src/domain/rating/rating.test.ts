import assert from 'node:assert/strict';
import test from 'node:test';

import { ASTERION_LOCAL_PLAYER_ID } from '../combat/report.ts';
import { createDefaultCommandState, updateAllianceSettings } from '../command/repository.ts';
import {
  buildRatingFoundation,
  getDisplayedRank,
  getLocalAlliance,
  getLocalPlayer,
  getRankDelta,
  getRatingScore,
  searchAllianceRows,
  searchPlayerRows,
  sortAllianceRows,
  sortPlayerRows,
} from './selectors.ts';
import type { RatingScoreKind } from './types.ts';

const SCORE_KINDS: readonly RatingScoreKind[] = ['total', 'resource', 'combat', 'achievement'];

test('rating fixtures are deterministic', () => {
  const command = createDefaultCommandState();
  assert.deepEqual(buildRatingFoundation(command), buildRatingFoundation(command));
});

test('canonical total score is exactly resource plus combat and excludes achievements', () => {
  const model = buildRatingFoundation(createDefaultCommandState());
  for (const row of [...model.players, ...model.alliances]) {
    assert.equal(getRatingScore(row, 'total'), row.scores.resource + row.scores.combat);
    assert.notEqual(getRatingScore(row, 'total'), row.scores.resource + row.scores.combat + row.scores.achievement);
  }
});

test('all four score dimensions sort deterministically', () => {
  const model = buildRatingFoundation(createDefaultCommandState());
  for (const kind of SCORE_KINDS) {
    const players = sortPlayerRows(model.players, 'score', kind);
    const alliances = sortAllianceRows(model.alliances, 'score', kind);
    assert.ok(players.every((row, index) => index === 0 || getRatingScore(players[index - 1], kind) >= getRatingScore(row, kind)));
    assert.ok(alliances.every((row, index) => index === 0 || getRatingScore(alliances[index - 1], kind) >= getRatingScore(row, kind)));
    assert.equal(new Set(players.map((row) => getDisplayedRank(model.players, row.id, kind))).size, model.players.length);
    assert.equal(new Set(alliances.map((row) => getDisplayedRank(model.alliances, row.id, kind))).size, model.alliances.length);
  }
});

test('legacy total ranks remain unique and stable', () => {
  const model = buildRatingFoundation(createDefaultCommandState());
  assert.equal(new Set(model.players.map((row) => row.rank)).size, model.players.length);
  assert.equal(new Set(model.alliances.map((row) => row.rank)).size, model.alliances.length);
  assert.ok(sortPlayerRows(model.players, 'rank', 'total').every((row, index, rows) => index === 0 || rows[index - 1].rank < row.rank));
});

test('rank delta is positive for upward movement, negative for downward movement and zero when unchanged', () => {
  assert.equal(getRankDelta(3, 7), 4);
  assert.equal(getRankDelta(7, 3), -4);
  assert.equal(getRankDelta(5, 5), 0);
});

test('search is case-insensitive for players and alliances', () => {
  const model = buildRatingFoundation(createDefaultCommandState());
  assert.equal(searchPlayerRows(model.players, 'КОМАНДИР гелион').length, 1);
  assert.ok(searchPlayerRows(model.players, 'aur').length > 0);
  assert.equal(searchAllianceRows(model.alliances, 'содружество ГЕЛИОН').length, 1);
});

test('canonical local player id is selected exactly once', () => {
  const model = buildRatingFoundation(createDefaultCommandState());
  const local = getLocalPlayer(model.players);
  assert.ok(local);
  assert.equal(local.id, ASTERION_LOCAL_PLAYER_ID);
  assert.equal(model.players.filter((row) => row.isLocal).length, 1);
});

test('alliance fixture member counts are sane', () => {
  const model = buildRatingFoundation(createDefaultCommandState());
  assert.ok(model.alliances.every((row) => Number.isInteger(row.members) && row.members > 0 && row.members <= 15));
});

test('local alliance identity and member count come from current Command state', () => {
  const initial = createDefaultCommandState();
  const command = updateAllianceSettings(initial, {
    name: 'Контур Тест',
    tag: 'KTR',
    motto: initial.alliance.motto,
    description: initial.alliance.description,
    emblem: initial.alliance.emblem,
  });
  const local = getLocalAlliance(buildRatingFoundation(command).alliances);
  assert.ok(local);
  assert.equal(local.name, 'Контур Тест');
  assert.equal(local.tag, 'KTR');
  assert.equal(local.members, command.members.length);
});

test('scores and ranks never contain NaN or negative values', () => {
  const model = buildRatingFoundation(createDefaultCommandState());
  for (const row of [...model.players, ...model.alliances]) {
    for (const kind of SCORE_KINDS) assert.ok(Number.isFinite(getRatingScore(row, kind)) && getRatingScore(row, kind) >= 0);
    assert.ok(Number.isInteger(row.rank) && row.rank > 0);
    assert.ok(Number.isInteger(row.previousRank) && row.previousRank > 0);
  }
});

test('provider remains explicitly local fixture foundation', () => {
  const model = buildRatingFoundation(createDefaultCommandState());
  assert.equal(model.provider, 'deterministic-local-fixture');
  assert.equal(model.season.dataTruth, 'deterministic-local-fixture');
  assert.ok(model.players.every((row) => row.dataTruth === 'deterministic-local-fixture'));
  assert.ok(model.alliances.every((row) => row.dataTruth === 'deterministic-local-fixture'));
});
