import assert from 'node:assert/strict';
import test from 'node:test';

import { DEMO_BATTLE_REPORTS } from '../combat/battle-fixtures.ts';
import type { BattleReport } from '../combat/report.ts';
import { NON_COMBAT_REPORT_FIXTURES } from './catalog.ts';
import {
  battleReportToReportItem,
  buildReportsFeed,
  filterReportItems,
  getBattleRewardEntries,
} from './adapters.ts';
import {
  archiveReport,
  createDefaultReportsState,
  markAllReportsRead,
  markReportRead,
  migrateReportsState,
  persistReportsState,
  readReportsState,
  toggleReportFavorite,
  unarchiveReport,
} from './repository.ts';

class MemoryStorage {
  private values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
}

const SAVE_KEY = 'asterion.vertical-slice.v1';
const firstBattle = DEMO_BATTLE_REPORTS[0];

function query(overrides: Partial<Parameters<typeof filterReportItems>[2]> = {}) {
  return { category: 'all' as const, filter: 'all' as const, search: '', ...overrides };
}

test('default Reports state is deterministic', () => {
  assert.deepEqual(createDefaultReportsState(), createDefaultReportsState());
});

test('default Reports factories do not share mutable references', () => {
  const first = createDefaultReportsState();
  const second = createDefaultReportsState();
  first.readIds.push('changed');
  assert.notDeepEqual(first, second);
  assert.deepEqual(second, createDefaultReportsState());
});

test('missing reports state migrates to canonical default', () => {
  assert.deepEqual(migrateReportsState(undefined), createDefaultReportsState());
  assert.deepEqual(migrateReportsState({}), createDefaultReportsState());
});

test('malformed reports state migrates safely and deduplicates ids', () => {
  assert.deepEqual(migrateReportsState({ readIds: 'broken', favoriteIds: [1, 'a', 'a'], archivedIds: [null, 'b'] }), {
    readIds: [], favoriteIds: ['a'], archivedIds: ['b'],
  });
});

test('mark read is idempotent', () => {
  const first = markReportRead(createDefaultReportsState(), 'report-a');
  const second = markReportRead(first, 'report-a');
  assert.deepEqual(first, second);
  assert.deepEqual(first.readIds, ['report-a']);
});

test('mark all read adds every supplied report id without duplicates', () => {
  const next = markAllReportsRead({ readIds: ['a'], favoriteIds: [], archivedIds: [] }, ['a', 'b', 'c']);
  assert.deepEqual(new Set(next.readIds), new Set(['a', 'b', 'c']));
});

test('favorite toggle adds and removes the same report cleanly', () => {
  const initial = createDefaultReportsState();
  const favorite = toggleReportFavorite(initial, 'report-a');
  assert.deepEqual(favorite.favoriteIds, ['report-a']);
  assert.deepEqual(toggleReportFavorite(favorite, 'report-a'), initial);
});

test('archive marks read and unarchive restores normal visibility state', () => {
  const archived = archiveReport(createDefaultReportsState(), 'report-a');
  assert.ok(archived.archivedIds.includes('report-a'));
  assert.ok(archived.readIds.includes('report-a'));
  const restored = unarchiveReport(archived, 'report-a');
  assert.ok(!restored.archivedIds.includes('report-a'));
  assert.ok(restored.readIds.includes('report-a'));
});

test('ordinary feed excludes archived while Archive shows it', () => {
  const items = buildReportsFeed(DEMO_BATTLE_REPORTS);
  const target = items[0];
  const state = archiveReport(createDefaultReportsState(), target.id);
  assert.ok(!filterReportItems(items, state, query()).some((item) => item.id === target.id));
  assert.ok(filterReportItems(items, state, query({ category: 'archive' })).some((item) => item.id === target.id));
});

test('category filtering returns only the selected category', () => {
  const items = buildReportsFeed(DEMO_BATTLE_REPORTS);
  const recon = filterReportItems(items, createDefaultReportsState(), query({ category: 'recon' }));
  assert.ok(recon.length > 0);
  assert.ok(recon.every((item) => item.category === 'recon'));
});

test('unread filter excludes ids marked read', () => {
  const items = buildReportsFeed(DEMO_BATTLE_REPORTS);
  const state = markReportRead(createDefaultReportsState(), items[0].id);
  const visible = filterReportItems(items, state, query({ filter: 'unread' }));
  assert.ok(!visible.some((item) => item.id === items[0].id));
});

test('favorite filter returns only favorited ids', () => {
  const items = buildReportsFeed(DEMO_BATTLE_REPORTS);
  const target = items[0];
  const state = toggleReportFavorite(createDefaultReportsState(), target.id);
  const visible = filterReportItems(items, state, query({ filter: 'favorite' }));
  assert.deepEqual(visible.map((item) => item.id), [target.id]);
});

test('search is case-insensitive across title, body, participant, planet and coordinates', () => {
  const items = buildReportsFeed(DEMO_BATTLE_REPORTS);
  const state = createDefaultReportsState();
  assert.ok(filterReportItems(items, state, query({ search: 'VARCON' })).some((item) => item.id === 'report-recon-varcon'));
  assert.ok(filterReportItems(items, state, query({ search: 'командование ФЛОТА' })).some((item) => item.id === 'report-inbox-command'));
  assert.ok(filterReportItems(items, state, query({ search: '[1:1:1]' })).length > 0);
  assert.ok(filterReportItems(items, state, query({ search: 'aster command' })).some((item) => item.id === firstBattle.id));
});

test('BattleReport adapter preserves canonical id and timestamp', () => {
  const item = battleReportToReportItem(firstBattle);
  assert.equal(item.id, firstBattle.id);
  assert.equal(item.battleReportId, firstBattle.id);
  assert.equal(item.timestamp, firstBattle.timestamp);
});

test('BattleReport adapter preserves attacker and defender names and coordinates', () => {
  const item = battleReportToReportItem(firstBattle);
  assert.deepEqual(item.participantNames, [firstBattle.attacker.playerName, firstBattle.defender.playerName]);
  assert.ok(item.coordinates.includes(firstBattle.attacker.coordinates ?? ''));
  assert.ok(item.coordinates.includes(firstBattle.defender.coordinates ?? ''));
});

test('BattleReport adapter determines local-player victory without inventing a power metric', () => {
  const item = battleReportToReportItem(firstBattle);
  assert.equal(item.statusLabel, 'ПОБЕДА');
  assert.match(item.title, /^Победа при атаке/);
  assert.equal(Object.hasOwn(item, 'power'), false);
});

test('missing BattleReport rewards are not invented', () => {
  const report: BattleReport = { ...firstBattle, id: 'battle-no-rewards', resources: undefined, experience: undefined, debris: undefined };
  assert.deepEqual(getBattleRewardEntries(report), []);
});

test('BattleReport rewards expose only fields present in canonical data', () => {
  const entries = getBattleRewardEntries(firstBattle);
  const keys = entries.map((entry) => entry.key);
  assert.ok(keys.includes('metal'));
  assert.ok(keys.includes('minerals'));
  assert.ok(keys.includes('gas'));
  assert.ok(keys.includes('experience'));
  assert.ok(keys.includes('debris'));
  assert.equal(keys.includes('energy' as never), false);
});

test('a newly added BattleReport automatically appears in the reports feed', () => {
  const newReport: BattleReport = { ...firstBattle, id: 'battle-new-runtime-report', timestamp: '2026-09-05T14:59:00.000Z' };
  const before = buildReportsFeed(DEMO_BATTLE_REPORTS);
  const after = buildReportsFeed([...DEMO_BATTLE_REPORTS, newReport]);
  assert.equal(before.some((item) => item.id === newReport.id), false);
  assert.equal(after[0].id, newReport.id);
});

test('fixture catalog is deterministic and contains no combat duplicates', () => {
  assert.deepEqual(NON_COMBAT_REPORT_FIXTURES, NON_COMBAT_REPORT_FIXTURES.map((item) => item));
  assert.ok(NON_COMBAT_REPORT_FIXTURES.every((item) => item.source === 'fixture' && item.category !== 'battle'));
  assert.equal(new Set(NON_COMBAT_REPORT_FIXTURES.map((item) => item.id)).size, NON_COMBAT_REPORT_FIXTURES.length);
});

test('Reports persistence uses existing save envelope and preserves unrelated fields', () => {
  const storage = new MemoryStorage();
  storage.setItem(SAVE_KEY, JSON.stringify({
    schemaVersion: 4,
    metal: 777,
    combat: { reports: ['keep-combat'] },
    operations: { items: ['keep-operations'] },
    command: { alliance: { name: 'keep-command' } },
  }));
  const reports = archiveReport(toggleReportFavorite(createDefaultReportsState(), 'report-a'), 'report-b');
  assert.equal(persistReportsState(reports, storage).ok, true);
  const saved = JSON.parse(storage.getItem(SAVE_KEY) ?? '{}') as Record<string, unknown>;
  assert.equal(saved.metal, 777);
  assert.deepEqual(saved.combat, { reports: ['keep-combat'] });
  assert.deepEqual(saved.operations, { items: ['keep-operations'] });
  assert.deepEqual(saved.command, { alliance: { name: 'keep-command' } });
  assert.deepEqual(readReportsState(storage), reports);
});

test('reset is the canonical Reports metadata state', () => {
  const changed = archiveReport(toggleReportFavorite(markReportRead(createDefaultReportsState(), 'a'), 'b'), 'c');
  assert.notDeepEqual(changed, createDefaultReportsState());
  assert.deepEqual(createDefaultReportsState(), { readIds: [], favoriteIds: [], archivedIds: [] });
});