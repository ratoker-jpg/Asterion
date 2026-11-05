import assert from 'node:assert/strict';
import test from 'node:test';

import { DEMO_BATTLE_REPORTS } from './battle-fixtures.ts';
import { BATTLE_RECENT_RETENTION_MS, battleRowSummary, isOwnBattleReport, selectBattleList } from './battle-list.ts';
import { createBattleReportViewModel } from './battle-report-view-model.ts';
import { migrateBattleHistory } from './battle-repository.ts';
import type { BattleReport } from './report.ts';

const NOW = Date.parse('2026-11-04T18:00:00.000Z');
const ME = 'player-7';

function battle(id: string, attackerId: string | undefined, defenderId: string | undefined, minutesAgo = 10, extra: Partial<BattleReport> = {}): BattleReport {
  const base = DEMO_BATTLE_REPORTS[0]!;
  return {
    ...base,
    id,
    timestamp: new Date(NOW - minutesAgo * 60_000).toISOString(),
    attacker: { ...base.attacker, playerId: attackerId },
    defender: { ...base.defender, playerId: defenderId },
    ...extra,
  };
}

const ids = (reports: readonly BattleReport[]) => reports.map((report) => report.id);

test('the list holds the player as attacker and as defender, newest first', () => {
  const history = { reports: [battle('mine-attack', ME, 'npc-a', 30), battle('raid-on-me', 'pirates', ME, 5)], savedReportIds: [] };
  assert.deepEqual(ids(selectBattleList(history, ME, NOW).recent), ['raid-on-me', 'mine-attack']);
});

test('support and joint attacks count: the player represents a merged Sun raid side under another name', () => {
  const base = DEMO_BATTLE_REPORTS[0]!;
  const support = battle('sun-support', 'npc-a', ME, 10, {
    attacker: { ...base.attacker, playerId: 'npc-a', playerName: '[ЭРГАШ] Эргаш +3' },
    defender: { ...base.defender, playerId: ME, playerName: 'Скаен62 +1' },
  });
  const joint = battle('sun-joint', ME, 'npc-b', 20, {
    attacker: { ...base.attacker, playerId: ME, playerName: '[ЭРГАШ] Эргаш +1' },
  });
  assert.deepEqual(ids(selectBattleList({ reports: [support, joint], savedReportIds: [] }, ME, NOW).recent), ['sun-support', 'sun-joint']);
});

test('bystanders are excluded: pirates against an NPC, NPC against NPC, NPC against pirates', () => {
  const reports = [
    battle('pirates-vs-tarok', 'pirates', 'npc-tarok', 5, { missionType: 'pirate-raid' }),
    battle('npc-vs-npc', 'npc-a', 'npc-b', 5),
    battle('npc-hunts-pirates', 'npc-a', 'pirates', 5, { missionType: 'pirate-elimination' }),
    battle('nobody-named', undefined, undefined, 5),
    battle('mine', ME, 'npc-a', 5),
  ];
  assert.deepEqual(ids(selectBattleList({ reports, savedReportIds: [] }, ME, NOW).recent), ['mine']);
});

test('counters read the same lists: other owners\' battles add nothing', () => {
  const reports = Array.from({ length: 210 }, (_, index) => battle(`foreign-${index}`, 'pirates', `npc-${index}`, 5));
  reports.push(battle('mine', ME, 'npc-a', 5));
  const { recent, saved } = selectBattleList({ reports, savedReportIds: ['mine'] }, ME, NOW);
  assert.equal(recent.length, 1);
  assert.equal(saved.length, 1);
});

test('a battle leaves «Последние» after the window but a starred one stays in «Сохранённые»', () => {
  const windowMinutes = BATTLE_RECENT_RETENTION_MS / 60_000;
  const reports = [battle('old-starred', ME, 'npc-a', windowMinutes), battle('old', ME, 'npc-a', windowMinutes), battle('fresh', ME, 'npc-a', windowMinutes - 1)];
  const list = selectBattleList({ reports, savedReportIds: ['old-starred'] }, ME, NOW);
  assert.deepEqual(ids(list.recent), ['fresh']);
  assert.deepEqual(ids(list.saved), ['old-starred']);
});

test('an old save: aliases still count as the player, and a starred battle of others stays starred', () => {
  const raw = {
    reports: [
      battle('old-alias', 'player-aster', 'npc-a', 5),
      battle('old-profile-alias', 'npc-a', 'player-current', 6),
      battle('old-foreign-starred', 'pirates', 'npc-tarok', 7),
      battle('old-foreign', 'pirates', 'npc-tarok', 8),
    ],
    savedReportIds: ['old-foreign-starred', 'id-that-left-the-save'],
  };
  const history = migrateBattleHistory(raw, 'production');
  const list = selectBattleList(history, 'player-current', NOW);
  assert.deepEqual(ids(list.recent), ['old-alias', 'old-profile-alias']);
  assert.deepEqual(ids(list.saved), ['old-foreign-starred']);
  assert.equal(history.reports.length, 4, 'the filter removes nothing from the save');
});

test('the filter does not take a stranger for the player when his id is not an alias', () => {
  assert.equal(isOwnBattleReport(battle('alias', 'player-aster', 'npc-a'), ME), false);
  assert.equal(isOwnBattleReport(battle('me', ME, 'npc-a'), ME), true);
});

test('row numbers come from the player\'s side: gain as attacker, taken as defender, none for others', () => {
  const stolen = createBattleReportViewModel(battle('a', 'pirates', ME, 5, { resources: { metal: 100, minerals: 20, gas: 3 } }));
  const summary = battleRowSummary(stolen, ME);
  assert.equal(summary.ownSide, 'defender');
  assert.equal(summary.resources, -123);
  assert.equal(summary.lost, stolen.defender.losses.population);

  const looted = createBattleReportViewModel(battle('b', ME, 'npc-a', 5, { resources: { metal: 100 } }));
  assert.equal(battleRowSummary(looted, ME).resources, 100);

  const nothing = createBattleReportViewModel(battle('c', ME, 'npc-a', 5, { resources: undefined }));
  assert.equal(battleRowSummary(nothing, ME).resources, null);

  assert.deepEqual(battleRowSummary(createBattleReportViewModel(battle('d', 'pirates', 'npc-a')), ME), { ownSide: null, lost: null, resources: null });
});
