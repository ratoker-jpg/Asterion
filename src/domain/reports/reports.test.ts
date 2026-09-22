import assert from 'node:assert/strict';
import test from 'node:test';

import { createDefaultBattleHistory, setBattleReportSaved } from '../combat/battle-repository.ts';
import { DEMO_BATTLE_REPORTS } from '../combat/battle-fixtures.ts';
import { ASTERION_SAVE_KEY } from '../combat/priority.ts';
import { getBattleResultForPlayer } from '../combat/report.ts';
import type { BattleReport } from '../combat/report.ts';
import { createDefaultCommandState, joinJointOperation } from '../command/repository.ts';
import { createDefaultOperationsState, revealOperation } from '../operations/repository.ts';
import {
  battleReportToReportItem,
  buildReportsFeed,
  createOverpopulationEpisodeReportId,
  filterReportItems,
  getReportCategoryCounts,
  operationIntelToReportItem,
  overpopulationEpisodeReportToReportItem,
  upsertOverpopulationEpisodeReport,
} from './adapters.ts';
import { NON_COMBAT_REPORT_FIXTURES } from './catalog.ts';
import {
  createDefaultReportsState,
  deleteAllReports,
  deleteSelectedReports,
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
  removeItem(key: string) { this.values.delete(key); }
}

function commandWithoutJointOperations() {
  return { ...createDefaultCommandState(), jointOperations: [] };
}

let persistenceModule: typeof import('../../application/persistence.ts') | undefined;
async function loadPersistence() {
  if (persistenceModule) return persistenceModule;
  const { register } = await import('node:module');
  register(new URL('../combat/test-asset-loader.mjs', import.meta.url), import.meta.url);
  persistenceModule = await import('../../application/persistence.ts');
  return persistenceModule;
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

test('overpopulation final report uses one stable episode id and projects summary plus ordinary ship losses', () => {
  const initial = createDefaultReportsState();
  const report = {
    planetId: 'colony-07',
    planetName: 'Новая Аркадия',
    factionId: 'synod' as const,
    populationBefore: 35_000,
    populationAfter: 25_000,
    capacity: 25_000,
    episodeStartedAt: 1_000,
    episodeEndedAt: 601_000,
    removedShips: [{ shipId: 'scout' as const, count: 5 }, { shipId: 'cruiser' as const, count: 2 }],
  };
  const once = upsertOverpopulationEpisodeReport(initial, report);
  const twice = upsertOverpopulationEpisodeReport(once, { ...report, removedShips: [{ shipId: 'scout', count: 6 }] });

  assert.equal(createOverpopulationEpisodeReportId(report.planetId, report.episodeStartedAt), once.overpopulationReports?.[0].id);
  assert.equal(twice.overpopulationReports?.length, 1);
  assert.deepEqual(twice.overpopulationReports?.[0].removedShips, [{ shipId: 'scout', count: 6 }]);

  const item = overpopulationEpisodeReportToReportItem(once.overpopulationReports![0]);
  assert.equal(item.category, 'system');
  assert.equal(item.source, 'overpopulation');
  assert.equal(item.id, once.overpopulationReports![0].id);
  assert.equal(item.statusLabel, 'ПЛАНЕТА РАЗБЛОКИРОВАНА');
  assert.match(item.body, /Планета Новая Аркадия разблокирована/);
  assert.deepEqual(item.details.slice(0, 6).map(({ label }) => label), [
    'Планета', 'Население до эпизода', 'Население после эпизода', 'Вместимость', 'Начало эпизода', 'Разблокировка',
  ]);
  assert.equal(item.details.at(-1)?.value, '7');
  assert.equal(buildReportsFeed([], createDefaultOperationsState(), commandWithoutJointOperations(), undefined, once.overpopulationReports).some((entry) => entry.id === item.id), true);
});

test('overpopulation episode report survives save hydration with read/hidden metadata compatibility', async () => {
  const { createInitialSaveState, createPersistenceFacade } = await loadPersistence();
  const storage = new MemoryStorage();
  const initial = createInitialSaveState('production', 50_000);
  const reports = upsertOverpopulationEpisodeReport(initial.reports, {
    planetId: 'colony-02',
    planetName: 'Станция Тихая',
    factionId: 'veyra',
    populationBefore: 12_000,
    populationAfter: 10_000,
    capacity: 10_000,
    episodeStartedAt: 10_000,
    episodeEndedAt: 610_000,
    removedShips: [{ shipId: 'destroyer', count: 3 }],
  });
  const episodeId = reports.overpopulationReports![0].id;
  const state = { ...initial, reports: { ...reports, readIds: [episodeId], hiddenIds: [] } };
  const persistence = createPersistenceFacade({ mode: 'production', storage, now: () => 700_000 });

  assert.deepEqual(persistence.write(state), { ok: true });
  const persistedEnvelope = JSON.parse(storage.getItem(persistence.saveKey)!) as {
    planets: Record<string, Record<string, unknown>>;
  };
  persistedEnvelope.planets['helion-01'].overpopulation = {
    episodeStartedAt: 10_000,
    initialExcess: 2_000,
    scheduledBurnPool: 500,
    burnedPopulation: 0,
    lastReconciledAt: 50_000,
    blocked: true,
    initialPopulation: 12_000,
    initialCapacity: 10_000,
    removedShips: [
      { shipId: 'scout', count: 3 },
      { shipId: 'destroyer', count: 2 },
      { shipId: 'solar-satellite', count: 4 },
      { shipId: 'corsair', count: 1 },
      { shipId: 'unknown', count: 9 },
    ],
  };
  storage.setItem(persistence.saveKey, JSON.stringify(persistedEnvelope));
  const hydrated = persistence.read();
  assert.deepEqual(hydrated.reports.overpopulationReports, reports.overpopulationReports);
  assert.deepEqual(hydrated.reports.readIds, [episodeId]);
  assert.equal(hydrated.planets['helion-01'].overpopulation?.initialPopulation, 12_000);
  assert.equal(hydrated.planets['helion-01'].overpopulation?.initialCapacity, 10_000);
  assert.deepEqual(hydrated.planets['helion-01'].overpopulation?.removedShips, [
    { shipId: 'scout', count: 3 }, { shipId: 'destroyer', count: 2 },
  ]);
  assert.deepEqual(buildReportsFeed([], createDefaultOperationsState(), commandWithoutJointOperations(), undefined, hydrated.reports.overpopulationReports).map(({ id }) => id), [episodeId]);
  assert.deepEqual(persistence.write(hydrated), { ok: true });
  assert.deepEqual(persistence.read().planets['helion-01'].overpopulation?.removedShips, [
    { shipId: 'scout', count: 3 }, { shipId: 'destroyer', count: 2 },
  ]);
});

test('save hydration accepts empty ordinary fleet only for deployment with a valid commander', async () => {
  const { createInitialSaveState, createPersistenceFacade } = await loadPersistence();
  const storage = new MemoryStorage();
  const initial = createInitialSaveState('production', 1_000);
  const baseFlight = {
    id: 'flight:commander-only',
    requestId: 'request:commander-only',
    missionId: 'deployment',
    originPlanetId: 'helion-01',
    originCoordinate: { galaxy: 1, system: 1, position: 1 },
    destination: { kind: 'planet', planetId: 'helion-01', coordinate: { galaxy: 1, system: 1, position: 2 } },
    destinationPlanetId: 'helion-01',
    targetRelation: 'self',
    destinationCoordinate: { galaxy: 1, system: 1, position: 2 },
    selectedShips: {},
    selectedCommanders: { corsair: 1 },
    selectedCommanderLevels: { corsair: 0 },
    populationReserved: 10,
    routeDistance: 1,
    effectiveSpeed: 33_000,
    oneWayDurationMs: 180_000,
    departedAt: 1_000,
    arrivalAt: 181_000,
    gasCost: 1,
    phase: 'outbound',
  };
  storage.setItem('asterion.vertical-slice.v1', JSON.stringify({
    ...initial,
    flights: { records: [
      baseFlight,
      { ...baseFlight, id: 'flight:invalid-mission', requestId: 'request:invalid-mission', missionId: 'attack', selectedCommanders: undefined, selectedCommanderLevels: undefined },
      { ...baseFlight, id: 'flight:invalid-deployment', requestId: 'request:invalid-deployment', selectedCommanders: undefined, selectedCommanderLevels: undefined },
    ], requestIndex: {} },
  }));
  const hydrated = createPersistenceFacade({ mode: 'production', storage, now: () => 1_100 }).read();

  assert.deepEqual(hydrated.flights.records.map(({ id }) => id), ['flight:commander-only']);
  assert.deepEqual(hydrated.flights.records[0].selectedShips, {});
  assert.deepEqual(hydrated.flights.records[0].selectedCommanders, { corsair: 1 });
});

test('local player aliases produce attack-specific report labels and results', () => {
  const report = {
    ...DEMO_BATTLE_REPORTS[0],
    attacker: { ...DEMO_BATTLE_REPORTS[0].attacker, playerId: 'player-current' },
  };
  const item = battleReportToReportItem(report);
  assert.equal(getBattleResultForPlayer(report, 'player-aster'), 'victory');
  assert.equal(getBattleResultForPlayer(report, 'player-current'), 'victory');
  assert.equal(item.statusLabel, 'ПОБЕДА ПРИ АТАКЕ');
  assert.match(item.title, /^Победа при атаке/);

  const defeat = {
    ...report,
    winner: 'attacker' as const,
    attacker: { ...report.attacker, playerId: 'other-attacker' },
    defender: { ...report.defender, playerId: 'player-aster' },
  };
  assert.equal(battleReportToReportItem(defeat).statusLabel, 'ПОРАЖЕНИЕ ПРИ ОБОРОНЕ');
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

  assert.deepEqual(reportsState, { readIds: [], hiddenIds: [] });
  assert.equal(filterReportItems([item], reportsState, { category: 'battle', filter: 'saved', search: '' }, []).length, 0);
  assert.equal(filterReportItems([item], reportsState, { category: 'battle', filter: 'saved', search: '' }, battleHistory.savedReportIds).length, 1);
  assert.ok(battleHistory.savedReportIds.includes(report.id));
});

test('saved battle projection follows passed combat state and clears immediately on reset', () => {
  const report = DEMO_BATTLE_REPORTS[0];
  const item = battleReportToReportItem(report);
  const reportsState = createDefaultReportsState();

  const savedHistory = setBattleReportSaved(createDefaultBattleHistory(), report.id, true);
  const beforeReset = filterReportItems(
    [item],
    reportsState,
    { category: 'battle', filter: 'saved', search: '' },
    savedHistory.savedReportIds,
  );
  assert.equal(beforeReset.length, 1);

  const resetHistory = createDefaultBattleHistory();
  const afterReset = filterReportItems(
    [item],
    reportsState,
    { category: 'battle', filter: 'saved', search: '' },
    resetHistory.savedReportIds,
  );
  assert.equal(afterReset.length, 0);
});

test('save and unsave stay in canonical BattleHistoryState', () => {
  const report = DEMO_BATTLE_REPORTS[0];
  const initial = createDefaultBattleHistory();
  const saved = setBattleReportSaved(initial, report.id, true);
  assert.deepEqual(saved.savedReportIds, [report.id]);

  const unsaved = setBattleReportSaved(saved, report.id, false);
  assert.deepEqual(unsaved.savedReportIds, []);
});

test('read/unread metadata is explicit and legacy favorites/archive are ignored', () => {
  const migrated = migrateReportsState({ readIds: [' one ', 'one', 'two'], favoriteIds: ['legacy'], archivedIds: ['legacy'] });
  assert.deepEqual(migrated, { readIds: ['one', 'two'], hiddenIds: [] });

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

test('reports persistence preserves unrelated Asterion save envelope fields and writes report metadata', () => {
  const storage = new MemoryStorage();
  storage.setItem(ASTERION_SAVE_KEY, JSON.stringify({ metal: 123, operations: { marker: true } }));
  const result = persistReportsState({ readIds: ['battle:one'], hiddenIds: ['battle:two'] }, storage);
  assert.equal(result.ok, true);

  const raw = storage.getItem(ASTERION_SAVE_KEY);
  assert.ok(raw);
  const saved = JSON.parse(raw) as { metal: number; operations: unknown; reports: unknown };
  assert.equal(saved.metal, 123);
  assert.deepEqual(saved.operations, { marker: true });
  assert.deepEqual(saved.reports, { readIds: ['battle:one'], hiddenIds: ['battle:two'] });
  assert.deepEqual(readReportsState(storage), { readIds: ['battle:one'], hiddenIds: ['battle:two'] });
});

test('reports migration normalizes hidden ids and drops unknown ids when current feed is supplied', () => {
  assert.deepEqual(migrateReportsState({
    readIds: ['battle:one', 'unknown', 'battle:one', 7],
    hiddenIds: [' battle:two ', 'unknown', 'battle:two'],
  }, ['battle:one', 'battle:two']), {
    readIds: ['battle:one'],
    hiddenIds: ['battle:two'],
  });
});

test('delete all and selected are limited to one folder and do not mutate canonical reports', () => {
  const first = battleReportToReportItem(DEMO_BATTLE_REPORTS[0]);
  const second = { ...first, id: 'system:other', category: 'system' as const };
  const items = [first, second];
  const initial = createDefaultReportsState();
  const deletedAll = deleteAllReports(initial, items, 'battle');
  assert.deepEqual(deletedAll.hiddenIds, [first.id]);
  assert.deepEqual(initial, { readIds: [], hiddenIds: [] });
  assert.equal(DEMO_BATTLE_REPORTS.some((report) => report.id === first.battleReportId), true);

  const deletedSelected = deleteSelectedReports(initial, items, 'system', [first.id, second.id, 'unknown']);
  assert.deepEqual(deletedSelected.hiddenIds, [second.id]);
});

test('hidden reports disappear from counts and regenerated feed without hiding future ids', () => {
  const first = battleReportToReportItem(DEMO_BATTLE_REPORTS[0]);
  const second = { ...first, id: 'battle:future', battleReportId: 'future' };
  const state = deleteSelectedReports(createDefaultReportsState(), [first], 'battle', [first.id]);
  const feed = [first, second];
  assert.equal(getReportCategoryCounts(feed, state).battle, 1);
  assert.equal(filterReportItems(feed, state, { category: 'battle', filter: 'all', search: '' }).length, 1);
  assert.equal(filterReportItems(feed, state, { category: 'battle', filter: 'all', search: '' })[0].id, second.id);
});
