import assert from 'node:assert/strict';
import test from 'node:test';

import { createDefaultBattleHistory, setBattleReportSaved } from '../combat/battle-repository.ts';
import { DEMO_BATTLE_REPORTS } from '../combat/battle-fixtures.ts';
import { ASTERION_SAVE_KEY } from '../combat/priority.ts';
import type { BattleReport } from '../combat/report.ts';
import { createDefaultCommandState, joinJointOperation } from '../command/repository.ts';
import { createDefaultOperationsState, revealOperation } from '../operations/repository.ts';
import {
  battleReportToReportItem,
  buildReportsFeed,
  filterReportItems,
  getReportCategoryCounts,
  operationIntelToReportItem,
} from './adapters.ts';
import { NON_COMBAT_REPORT_FIXTURES } from './catalog.ts';
import {
  createDefaultReportsState,
  markAllReportsRead,
  markReportRead,
  migrateReportsState,
  persistReportsState,
  readReportsState,
} from './repository.ts';

class MemoryStorage {
  private values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
}

function commandWithoutJointOperations() {
  return { ...createDefaultCommandState(), jointOperations: [] };
}

test('Reports does not fabricate non-combat runtime history', () => {
  assert.deepEqual(NON_COMBAT_REPORT_FIXTURES, []);
  const counts = getReportCategoryCounts(buildReportsFeed([], createDefaultOperationsState(), commandWithoutJointOperations()));
  assert.equal(counts.system, 0);
  assert.equal(counts.battle, 0);
  assert.equal(counts.command, 0);
  assert.equal(counts.arena, 0);
  assert.equal(counts.flights, 0);
  assert.equal(counts.alliances, 0);
  assert.equal(counts.achievements, 0);
});

test('Доклады uses BattleReport and excludes simulator and Arena output', () => {
  const base = DEMO_BATTLE_REPORTS[0];
  const simulation: BattleReport = { ...base, id: 'reports-simulation', missionType: 'simulation' };
  const arena: BattleReport = { ...base, id: 'reports-arena', missionType: 'arena' };
  const feed = buildReportsFeed([base, simulation, arena], createDefaultOperationsState(), commandWithoutJointOperations());
  const battleItems = feed.filter((item) => item.category === 'battle');

  assert.equal(battleItems.length, 1);
  assert.equal(battleItems[0].battleReportId, base.id);
  assert.equal(battleItems[0].source, 'combat');
});

test('operation battle remains canonical BattleReport but receives operation context', () => {
  const report = DEMO_BATTLE_REPORTS[0];
  const operations = createDefaultOperationsState();
  const operation = operations.items.find((item) => item.category === 'combat');
  assert.ok(operation);
  operation.battleReportId = report.id;

  const feed = buildReportsFeed([report], operations, commandWithoutJointOperations());
  const item = feed.find((candidate) => candidate.battleReportId === report.id);
  assert.ok(item);
  assert.equal(item.operationId, operation.id);
  assert.equal(item.typeLabel, 'Доклад операции');
  assert.match(item.title, /Операция:/);
});

test('revealed Operations information appears in System without inventing a timestamp', () => {
  const initial = createDefaultOperationsState();
  const signal = initial.items.find((item) => item.archetype === 'unknown_signal');
  assert.ok(signal);
  const revealed = revealOperation(initial, signal.id);
  const revealedOperation = revealed.items.find((item) => item.originSignalId === signal.id);
  assert.ok(revealedOperation);

  const item = operationIntelToReportItem(revealedOperation);
  assert.ok(item);
  assert.equal(item.category, 'system');
  assert.equal(item.source, 'operations');
  assert.equal(item.timestamp, undefined);
});

test('Reports feed follows the OperationsState passed by App without a remount', () => {
  const initial = createDefaultOperationsState();
  const command = commandWithoutJointOperations();
  const signal = initial.items.find((item) => item.archetype === 'unknown_signal');
  assert.ok(signal);

  const before = buildReportsFeed([], initial, command);
  assert.equal(before.some((item) => item.category === 'system'), false);

  const revealed = revealOperation(initial, signal.id);
  const after = buildReportsFeed([], revealed, command);
  assert.equal(after.some((item) => item.category === 'system' && item.source === 'operations'), true);
});

test('Reports feed follows CommandState changes without a remount', () => {
  const operations = createDefaultOperationsState();
  const initialCommand = createDefaultCommandState();
  const before = buildReportsFeed([], operations, initialCommand);
  assert.ok(before.some((item) => item.commandOperationId === 'joint-sun-raid'));

  const joinedCommand = joinJointOperation(initialCommand, 'joint-sun-raid');
  const after = buildReportsFeed([], operations, joinedCommand);
  assert.equal(after.some((item) => item.commandOperationId === 'joint-sun-raid'), false);
});

test('default/reset cross-domain state does not preserve stale Reports data', () => {
  const initialOperations = createDefaultOperationsState();
  const signal = initialOperations.items.find((item) => item.archetype === 'unknown_signal');
  assert.ok(signal);
  const revealedOperations = revealOperation(initialOperations, signal.id);
  const joinedCommand = joinJointOperation(createDefaultCommandState(), 'joint-sun-raid');

  const mutatedFeed = buildReportsFeed([], revealedOperations, joinedCommand);
  assert.equal(mutatedFeed.some((item) => item.source === 'operations'), true);
  assert.equal(mutatedFeed.some((item) => item.commandOperationId === 'joint-sun-raid'), false);

  const resetFeed = buildReportsFeed([], createDefaultOperationsState(), createDefaultCommandState());
  assert.equal(resetFeed.some((item) => item.source === 'operations'), false);
  assert.equal(resetFeed.some((item) => item.commandOperationId === 'joint-sun-raid'), true);
});

test('current Command joint operation produces an Alliances invitation with Fleets action', () => {
  const command = createDefaultCommandState();
  const feed = buildReportsFeed([], createDefaultOperationsState(), command);
  const sunInvite = feed.find((item) => item.commandOperationId === 'joint-sun-raid');

  assert.ok(sunInvite);
  assert.equal(sunInvite.category, 'alliances');
  assert.equal(sunInvite.action?.kind, 'open_fleets');
  assert.match(sunInvite.title, /Рейд на Солнце/);
  assert.equal(sunInvite.timestamp, undefined);
});

test('saved filter uses canonical BattleHistory saved ids, not Reports metadata', () => {
  const report = DEMO_BATTLE_REPORTS[0];
  const item = battleReportToReportItem(report);
  const reportsState = createDefaultReportsState();
  const battleHistory = setBattleReportSaved(createDefaultBattleHistory(), report.id, true);

  assert.deepEqual(reportsState, { readIds: [] });
  assert.equal(filterReportItems([item], reportsState, { category: 'battle', filter: 'saved', search: '' }, []).length, 0);
  assert.equal(filterReportItems([item], reportsState, { category: 'battle', filter: 'saved', search: '' }, battleHistory.savedReportIds).length, 1);
  assert.ok(battleHistory.savedReportIds.includes(report.id));
});

test('read/unread metadata is explicit and legacy favorites/archive are ignored', () => {
  const migrated = migrateReportsState({ readIds: [' one ', 'one', 'two'], favoriteIds: ['legacy'], archivedIds: ['legacy'] });
  assert.deepEqual(migrated, { readIds: ['one', 'two'] });

  const once = markReportRead(createDefaultReportsState(), 'battle:one');
  assert.deepEqual(once.readIds, ['battle:one']);
  const all = markAllReportsRead(once, ['battle:two', 'battle:three']);
  assert.deepEqual(all.readIds, ['battle:one', 'battle:two', 'battle:three']);
});

test('read metadata keeps the newest 500 ids', () => {
  const input = Array.from({ length: 505 }, (_, index) => `report-${index}`);
  const state = migrateReportsState({ readIds: input });
  assert.equal(state.readIds.length, 500);
  assert.equal(state.readIds[0], 'report-5');
  assert.equal(state.readIds.at(-1), 'report-504');
});

test('reports persistence preserves unrelated Asterion save envelope fields and writes only readIds', () => {
  const storage = new MemoryStorage();
  storage.setItem(ASTERION_SAVE_KEY, JSON.stringify({ metal: 123, operations: { marker: true } }));
  const result = persistReportsState({ readIds: ['battle:one'] }, storage);
  assert.equal(result.ok, true);

  const raw = storage.getItem(ASTERION_SAVE_KEY);
  assert.ok(raw);
  const saved = JSON.parse(raw) as { metal: number; operations: unknown; reports: unknown };
  assert.equal(saved.metal, 123);
  assert.deepEqual(saved.operations, { marker: true });
  assert.deepEqual(saved.reports, { readIds: ['battle:one'] });
  assert.deepEqual(readReportsState(storage), { readIds: ['battle:one'] });
});
