import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createOwnerRatingEntries,
  CURRENT_PLAYER_ID,
  CURRENT_PLAYER_DISPLAY_NAME,
  createDefaultRatingPrototypeState,
  createPlayerRatingEntries,
  migrateRatingPrototypeState,
} from './fixtures.ts';
import { clampPage, filterAlliances, filterPlayers, pageForEntry, paginate, sortAlliances, sortPlayers } from './selectors.ts';
import { createAllianceRatingEntries, selectAllianceRoster } from './alliances.ts';
import { createDefaultCommandState } from '../command/repository.ts';
import { createAlliance } from '../command/membership.ts';

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

test('alliance rating lists only real alliances, ranked by member average, without invented rows', () => {
  let command = createDefaultCommandState('production');
  assert.deepEqual(createAllianceRatingEntries(command, {}, CURRENT_PLAYER_ID), []);

  const created = (ownerId: string, name: string, tag: string) => {
    const result = createAlliance(command, { ownerId, displayName: ownerId, settings: { name, tag, motto: '', description: '', emblem: { glyph: 'orbit', accent: 'violet' } } }, { now: 1, random: () => 0.5 });
    assert.equal(result.ok, true);
    command = result.state;
  };
  created(CURRENT_PLAYER_ID, '  Asterion Guard  ', ' ast ');
  created('rival-owner', 'Ржавый Орден', 'RUS');

  const scores = {
    [CURRENT_PLAYER_ID]: { ownerId: CURRENT_PLAYER_ID, resourcePoints: 40, battlePoints: 10, totalPoints: 50, achievementPoints: 0 as const },
    'rival-owner': { ownerId: 'rival-owner', resourcePoints: 90, battlePoints: 10, totalPoints: 100, achievementPoints: 0 as const },
  };
  const first = createAllianceRatingEntries(command, scores, CURRENT_PLAYER_ID);
  assert.deepEqual(first, createAllianceRatingEntries(command, scores, CURRENT_PLAYER_ID));
  assert.deepEqual(first.map((entry) => [entry.name, entry.rank, entry.totalPoints, entry.memberCount]), [['Ржавый Орден', 1, 100, 1], ['Asterion Guard', 2, 50, 1]]);

  const current = first.find((entry) => entry.isCurrentAlliance);
  assert.equal(current?.name, 'Asterion Guard');
  assert.equal(current?.tag, 'AST');
  assert.equal(current?.resourcePoints, 40);
  assert.equal(current?.battlePoints, 10);
  assert.equal(filterAlliances(first, 'ast').some((entry) => entry.isCurrentAlliance), true);
  assert.deepEqual(sortAlliances(first, 'totalPoints', 'asc').map((entry) => entry.name), ['Asterion Guard', 'Ржавый Орден']);
  assert.deepEqual(sortAlliances(first, 'resourcePoints', 'desc').map((entry) => entry.name), ['Ржавый Орден', 'Asterion Guard']);
});

test('production rating exposes only the current player and no alliance rows', () => {
  const players = createPlayerRatingEntries(900_001, 'production');
  const alliances = createAllianceRatingEntries(createDefaultCommandState('production'), {}, CURRENT_PLAYER_ID);

  assert.equal(players.length, 1);
  assert.equal(players[0].isCurrentPlayer, true);
  assert.equal(players[0].rank, 1);
  assert.equal(players[0].totalPoints, 900_001);
  assert.deepEqual(alliances, []);
});

test('production standings list every real owner by canonical total points, the player included', () => {
  const entries = createOwnerRatingEntries(
    { 'player-current': { resourcePoints: 107, battlePoints: 0 }, 'npc-gen-01': { resourcePoints: 147, battlePoints: 20 }, 'npc-gen-02': { resourcePoints: 1, battlePoints: 0 } },
    { 'player-current': { name: 'QA', factionId: 'aegis' }, 'npc-gen-01': { name: 'Лана Мирск', factionId: 'synod' }, 'npc-gen-02': { name: 'Ада Стрейн', factionId: 'veyra' } },
    'player-current',
  );
  assert.deepEqual(entries.map((entry) => [entry.rank, entry.id, entry.totalPoints, entry.race, entry.isCurrentPlayer]), [
    [1, 'npc-gen-01', 167, 'cyber', false],
    [2, 'player-current', 107, 'aster', true],
    [3, 'npc-gen-02', 1, 'xeno', false],
  ]);
});

test('splitBattlePoints shares a side total by weight, exactly, with no one over it', async () => {
  const { splitBattlePoints } = await import('./scoring.ts');
  const split = splitBattlePoints(166_347, { a: 1, b: 1, c: 1, d: 0.0001 });
  assert.equal(Object.values(split).reduce((sum, value) => sum + value, 0), 166_347);
  assert.ok(split.d! < 10, 'one scout among a fleet gets almost nothing');
  assert.deepEqual(splitBattlePoints(10, { x: 1 }), { x: 10 });
  assert.deepEqual(splitBattlePoints(10, {}), {});
  assert.deepEqual(splitBattlePoints(7, { b: 1, a: 1 }), { a: 4, b: 3 }, 'ties go to the smaller owner id');
});

test('alliance roster lists the leader first, then deputies, then members by points', () => {
  const base = createAlliance(createDefaultCommandState(), { ownerId: 'lead', displayName: 'Lead', settings: { name: 'Орден', tag: 'ORD', motto: '', description: '', emblem: { glyph: 'orbit', accent: 'violet' } } }, { now: 1, random: () => 0.5 });
  assert.equal(base.ok, true);
  const record = base.state.alliances[0]!;
  const member = (ownerId: string) => ({ ...record.members[0]!, ownerId, displayName: ownerId });
  const alliance = { ...record, leaderOwnerId: 'lead', deputyOwnerId: 'dep', members: [member('weak'), member('dep'), member('strong'), member('lead')] };
  const scores = { lead: { totalPoints: 1 }, dep: { totalPoints: 2 }, strong: { totalPoints: 900 }, weak: { totalPoints: 10 } };
  const roster = selectAllianceRoster(alliance, scores, 'weak', (id) => (id === 'strong' ? 'Сильный' : undefined));
  assert.deepEqual(roster.map((entry) => [entry.ownerId, entry.role]), [['lead', 'leader'], ['dep', 'deputy'], ['strong', 'member'], ['weak', 'member']]);
  assert.equal(roster[2]!.name, 'Сильный');
  assert.equal(roster[3]!.isCurrentPlayer, true);
  const noDeputy = selectAllianceRoster({ ...alliance, deputyOwnerId: null }, scores, 'weak');
  assert.equal(noDeputy.filter((entry) => entry.role === 'deputy').length, 0);
  assert.equal(noDeputy[0]!.role, 'leader');
});
