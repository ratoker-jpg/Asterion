import assert from 'node:assert/strict';
import test from 'node:test';

import { createDefaultBattleHistory, setBattleReportSaved } from '../combat/battle-repository.ts';
import { DEMO_BATTLE_REPORTS } from '../combat/battle-fixtures.ts';
import { ASTERION_SAVE_KEY } from '../combat/priority.ts';
import { getBattleResultForPlayer } from '../combat/report.ts';
import type { BattleReport } from '../combat/report.ts';
import { noCombatVerdict } from '../combat/battle-report-view-model.ts';
import { explorationMailboxReports } from '../exploration/report-items.ts';
import type { FlightRecord } from '../flights/types.ts';
import { createDefaultCommandState } from '../command/repository.ts';
import { createDefaultOperationsState, migrateOperationsState } from '../operations/repository.ts';
import {
  battleReportToReportItem,
  buildReportsFeed,
  createGasExtractionArrivalReportId,
  createRecyclerArrivalReportId,
  createOverpopulationEpisodeReportId,
  filterReportItems,
  gasExtractionArrivalReportToReportItem,
  getReportCategoryCounts,
  getReportUnreadCounts,
  overpopulationEpisodeReportToReportItem,
  preservePersistentReportCollections,
  recyclerArrivalReportToReportItem,
  reportReadCheck,
  spyReportToReportItem,
  upsertGasExtractionArrivalReport,
  upsertRecyclerArrivalReport,
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
import type { GasExtractionArrivalReport, ReportItem } from './types.ts';
import { personalLetters } from './letters.ts';
import { buildReportSheet, titleWithoutPlace } from './sheet.ts';
import { createBattleReportViewModel } from '../combat/battle-report-view-model.ts';
import type { AllianceApplication, AllianceRecord } from '../command/types.ts';
import type { SpyReportSnapshot } from '../espionage/types.ts';

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

test('recycler arrival report projects coordinates and debris totals into System with a stable id', () => {
  const report = {
    flightId: 'flight:qa-recycler-1',
    coordinate: { galaxy: 2, system: 14, position: 7 },
    arrivedAtMs: 123_000,
    collectedDebris: 800,
    remainingOrbitalDebris: 200,
  };
  const first = upsertRecyclerArrivalReport(createDefaultReportsState(), report);
  const repeated = upsertRecyclerArrivalReport(first, report);
  const stored = repeated.recyclerArrivalReports![0];
  const item = recyclerArrivalReportToReportItem(stored);

  assert.equal(createRecyclerArrivalReportId(report.flightId), 'recycler-arrival:flight:qa-recycler-1');
  assert.equal(repeated.recyclerArrivalReports?.length, 1);
  assert.equal(stored.id, 'recycler-arrival:flight:qa-recycler-1');
  assert.equal(item.id, stored.id);
  assert.equal(item.source, 'recycling');
  // Owner 11.11.2026: every fleet arrival lives in «Полёты».
  assert.equal(item.category, 'flights');
  assert.equal(item.timestamp, new Date(report.arrivedAtMs).toISOString());
  assert.deepEqual(item.coordinates, ['[2:14:7]']);
  assert.deepEqual(item.details, [
    { label: 'Координаты прибытия', value: '[2:14:7]' },
    { label: 'Собрано обломков', value: '800' },
    { label: 'Осталось свободных обломков на орбите', value: '200' },
  ]);
  assert.equal(buildReportsFeed([], createDefaultOperationsState(), commandWithoutJointOperations(), undefined, [], repeated.recyclerArrivalReports).some((entry) => entry.id === stored.id), true);
  assert.doesNotMatch(`${item.title} ${item.preview} ${item.body} ${item.details.map(({ label, value }) => `${label} ${value}`).join(' ')}`, /газа|газ|груз|астероид/i);
});

test('recycler arrival upserts retain the full arrival history and replace a repeated flight', () => {
  const reports = Array.from({ length: 501 }, (_, index) => ({
    flightId: `flight:${index}`,
    coordinate: { galaxy: 1, system: 1, position: 1 },
    arrivedAtMs: index,
    collectedDebris: index,
    remainingOrbitalDebris: 0,
  }));
  const history = reports.reduce((state, report) => upsertRecyclerArrivalReport(state, report), createDefaultReportsState());
  const repeated = upsertRecyclerArrivalReport(history, { ...reports[0], collectedDebris: 99 });

  assert.equal(repeated.recyclerArrivalReports?.length, 501);
  assert.equal(repeated.recyclerArrivalReports?.filter(({ flightId }) => flightId === reports[0].flightId).length, 1);
  assert.equal(repeated.recyclerArrivalReports?.find(({ flightId }) => flightId === reports[0].flightId)?.collectedDebris, 99);
});

test('zero-debris recycler arrival still produces a System report with explicit empty-result copy', () => {
  const report = {
    id: 'recycler-arrival:flight:qa-zero',
    flightId: 'flight:qa-zero',
    coordinate: { galaxy: 1, system: 1, position: 3 },
    arrivedAtMs: 456_000,
    collectedDebris: 0,
    remainingOrbitalDebris: 0,
  } as const;
  const item = recyclerArrivalReportToReportItem(report);
  const feed = buildReportsFeed([], createDefaultOperationsState(), commandWithoutJointOperations(), undefined, [], [report]);

  assert.equal(item.category, 'flights');
  assert.equal(item.brief, true);
  assert.match(item.body, /На орбите обломков не найдено/);
  assert.equal(feed.filter((entry) => entry.id === report.id).length, 1);
});

test('gas extraction arrivals have a distinct stable report schema and show complete found/missed results', () => {
  const found = {
    flightId: 'flight:qa-gas-found',
    coordinate: { galaxy: 3, system: 22, position: 6 },
    arrivalAt: 321_000,
    outcome: 'found' as const,
    gasCollected: 450,
    scrapCollected: 0,
  };
  const missed: GasExtractionArrivalReport = {
    id: createGasExtractionArrivalReportId('flight:qa-gas-missed'),
    flightId: 'flight:qa-gas-missed',
    coordinate: { galaxy: 3, system: 22, position: 7 },
    arrivalAt: 654_000,
    outcome: 'missed' as const,
    gasCollected: 0,
    scrapCollected: 0,
  };
  const first = upsertGasExtractionArrivalReport(createDefaultReportsState(), found);
  const repeated = upsertGasExtractionArrivalReport(first, found);
  const foundStored = repeated.gasExtractionArrivalReports![0];
  const foundItem = gasExtractionArrivalReportToReportItem(foundStored);
  const missedItem = gasExtractionArrivalReportToReportItem({ ...missed, id: createGasExtractionArrivalReportId(missed.flightId) });
  const foundText = `${foundItem.title} ${foundItem.preview} ${foundItem.body} ${foundItem.details.map(({ label, value }) => `${label} ${value}`).join(' ')}`;
  const missedText = `${missedItem.title} ${missedItem.preview} ${missedItem.body} ${missedItem.details.map(({ label, value }) => `${label} ${value}`).join(' ')}`;

  assert.equal(createGasExtractionArrivalReportId(found.flightId), 'gas-extraction-arrival:flight:qa-gas-found');
  assert.equal(repeated.gasExtractionArrivalReports?.length, 1);
  assert.equal(foundStored.id, 'gas-extraction-arrival:flight:qa-gas-found');
  assert.equal(foundItem.source, 'gas-extraction');
  assert.equal(foundItem.category, 'flights');
  assert.equal(foundItem.timestamp, new Date(found.arrivalAt).toISOString());
  assert.equal(foundItem.title, 'Астероид найден');
  assert.deepEqual(foundItem.coordinates, ['[3:22:6]']);
  assert.match(foundText, /\[3:22:6\]/);
  assert.match(foundText, /Собрано газа: 450/);
  assert.match(foundText, /Собрано обломков: 0/);
  assert.equal(missedItem.title, 'Астероид не найден по координатам [3:22:7]');
  assert.match(missedText, /\[3:22:7\]/);
  assert.match(missedText, /Собрано газа: 0/);
  assert.match(missedText, /Собрано обломков: 0/);
  assert.doesNotMatch(`${foundText} ${missedText}`, /запас|резерв|rate|rating|рейтин/i);
  assert.equal(buildReportsFeed([], createDefaultOperationsState(), commandWithoutJointOperations(), undefined, [], [], repeated.gasExtractionArrivalReports).some((entry) => entry.id === foundStored.id), true);
  assert.equal(buildReportsFeed([], createDefaultOperationsState(), commandWithoutJointOperations(), undefined, [], [], [missed]).some((entry) => entry.id === missedItem.id), true);
});

test('gas extraction reports flow through unread counts and keep persistent records across read/hide metadata changes', () => {
  const report: GasExtractionArrivalReport = {
    id: 'gas-extraction-arrival:flight:qa-gas-metadata',
    flightId: 'flight:qa-gas-metadata',
    coordinate: { galaxy: 1, system: 9, position: 4 },
    arrivalAt: 987_000,
    outcome: 'missed' as const,
    gasCollected: 0,
    scrapCollected: 0,
  };
  const previous = { ...createDefaultReportsState(), gasExtractionArrivalReports: [report] };
  const item = gasExtractionArrivalReportToReportItem(report);
  const feed = buildReportsFeed([], createDefaultOperationsState(), commandWithoutJointOperations(), undefined, [], [], [report]);
  const read = preservePersistentReportCollections(markReportRead(previous, report.id), previous);
  const hidden = preservePersistentReportCollections(deleteSelectedReports(previous, [item], 'flights', [report.id]), previous);
  const countUnread = (state: ReturnType<typeof createDefaultReportsState>) =>
    Object.values(getReportUnreadCounts(feed, state)).reduce((total, count) => total + count, 0);

  assert.deepEqual(read.gasExtractionArrivalReports, [report]);
  assert.deepEqual(hidden.gasExtractionArrivalReports, [report]);
  assert.equal(hidden.hiddenIds.includes(report.id), true);
  assert.equal(countUnread(createDefaultReportsState()), 1);
  assert.equal(countUnread(markReportRead(createDefaultReportsState(), report.id)), 0);
});

test('report metadata read/hide transitions preserve recycler arrival records', () => {
  const report = {
    id: 'recycler-arrival:flight:qa-retention',
    flightId: 'flight:qa-retention',
    coordinate: { galaxy: 1, system: 8, position: 9 },
    arrivedAtMs: 789_000,
    collectedDebris: 12,
    remainingOrbitalDebris: 0,
  } as const;
  const previous = { ...createDefaultReportsState(), recyclerArrivalReports: [report] };
  const item = recyclerArrivalReportToReportItem(report);
  const read = preservePersistentReportCollections(markReportRead(previous, report.id), previous);
  const hidden = preservePersistentReportCollections(deleteSelectedReports(previous, [item], 'flights', [report.id]), previous);

  assert.deepEqual(read.recyclerArrivalReports, [report]);
  assert.deepEqual(hidden.recyclerArrivalReports, [report]);
  assert.equal(hidden.hiddenIds.includes(report.id), true);
});

test('unread recycler arrival reports contribute to the aggregate unread count and decrement when read', () => {
  const report = {
    id: 'recycler-arrival:flight:qa-unread-count',
    flightId: 'flight:qa-unread-count',
    coordinate: { galaxy: 1, system: 4, position: 6 },
    arrivedAtMs: 900_000,
    collectedDebris: 25,
    remainingOrbitalDebris: 5,
  } as const;
  const feed = buildReportsFeed([], createDefaultOperationsState(), commandWithoutJointOperations(), undefined, [], [report]);
  const countUnread = (state: ReturnType<typeof createDefaultReportsState>) =>
    Object.values(getReportUnreadCounts(feed, state)).reduce((total, count) => total + count, 0);

  assert.equal(countUnread(createDefaultReportsState()), 1);
  assert.equal(countUnread(markReportRead(createDefaultReportsState(), report.id)), 0);
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
  // Satellites burn in overpopulation now (audit 1.3); commanders and unknown ids are dropped.
  assert.deepEqual(hydrated.planets['helion-01'].overpopulation?.removedShips, [
    { shipId: 'scout', count: 3 }, { shipId: 'destroyer', count: 2 }, { shipId: 'solar-satellite', count: 4 },
  ]);
  assert.deepEqual(buildReportsFeed([], createDefaultOperationsState(), commandWithoutJointOperations(), undefined, hydrated.reports.overpopulationReports).map(({ id }) => id), [episodeId]);
  assert.deepEqual(persistence.write(hydrated), { ok: true });
  assert.deepEqual(persistence.read().planets['helion-01'].overpopulation?.removedShips, [
    { shipId: 'scout', count: 3 }, { shipId: 'destroyer', count: 2 }, { shipId: 'solar-satellite', count: 4 },
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
  const operations = migrateOperationsState({ items: [{
    id: 'pirate:pirate-cycle-v1:1:1:0:1000', archetype: 'pirate_elimination', state: 'completed',
    location: { kind: 'coordinates', coordinates: '[1:1:18]' }, battleReportId: report.id,
  }] });
  const operation = operations.items[0];
  assert.ok(operation);

  const feed = buildReportsFeed([report], operations, commandWithoutJointOperations());
  const item = feed.find((candidate) => candidate.battleReportId === report.id);
  assert.ok(item);
  assert.equal(item.operationId, operation.id);
  assert.equal(item.typeLabel, 'Доклад операции');
  assert.match(item.title, /Операция:/);
});

test('Reports feed has no Operations system items: demo signal reveals were removed', () => {
  const feed = buildReportsFeed([], createDefaultOperationsState(), commandWithoutJointOperations());
  assert.equal(feed.some((item) => item.source === 'operations'), false);
});

test('Reports feed never fabricates alliance invitations or joint operations from Command state', () => {
  const operations = createDefaultOperationsState();
  for (const command of [createDefaultCommandState('production'), createDefaultCommandState('test')]) {
    const feed = buildReportsFeed([], operations, command);
    assert.equal(feed.some((item) => item.category === 'alliances'), false);
    assert.equal(feed.some((item) => item.commandOperationId !== undefined), false);
  }
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

test('live player Moves canonical gas and recycler arrivals to Flights without doubling unread messages', () => {
  const recycler = {
    id: 'recycler-arrival:flight:pr92-unique',
    flightId: 'flight:pr92-unique',
    coordinate: { galaxy: 1, system: 3, position: 2 },
    arrivedAtMs: 987_000,
    collectedDebris: 42,
    remainingOrbitalDebris: 8,
  } as const;
  const gas: GasExtractionArrivalReport = {
    id: 'gas-extraction-arrival:flight:pr92-unique',
    flightId: 'flight:pr92-unique',
    coordinate: { galaxy: 1, system: 4, position: 3 },
    arrivalAt: 999_000,
    outcome: 'found',
    gasCollected: 60,
    scrapCollected: 12,
  };
  const feed = buildReportsFeed([],createDefaultOperationsState(),commandWithoutJointOperations(),
    undefined, [], [recycler], [gas], [], [], undefined, 'player:test');
  assert.deepEqual(feed.filter(item=>item.id === recycler.id).map(item=>item.category),['flights']);
  assert.deepEqual(feed.filter(item=>item.id === gas.id).map(item=>item.category),['flights']);
  assert.equal(getReportCategoryCounts(feed).flights,2);
  assert.equal(getReportCategoryCounts(feed).system,0);
  const unread = getReportUnreadCounts(feed,createDefaultReportsState());
  assert.equal(unread.flights,2);
  const bothRead = markAllReportsRead(createDefaultReportsState(),[recycler.id,gas.id]);
  assert.equal(getReportUnreadCounts(feed,bothRead).flights,0);
});

test('the mailbox keeps only the player\'s own pirate recon and pirate-hunt results', () => {
  const recon = (id: string, ownerId: string) => ({
    id: `pirate-recon:${id}`, missionId: id, ownerId, contactCycleKey: 'pirate-cycle-v1:1:2:1', coordinate: { galaxy: 1, system: 2, position: 24 },
    dispatchedAt: 1, arrivedAt: 2, outcome: 'success',
  }) as unknown as NonNullable<Parameters<typeof buildReportsFeed>[7]>[number];
  const feed = buildReportsFeed([], createDefaultOperationsState(), commandWithoutJointOperations(), undefined, [], [], [],
    [recon('mine', 'player-current'), recon('npc', 'npc-gen-01')], [], undefined, 'player-current');
  assert.deepEqual(feed.filter((item) => item.id.startsWith('pirate-recon')).map((item) => item.id), ['pirate-recon:mine']);
});

function finishedFlight(fields: Partial<FlightRecord>): FlightRecord {
  return {
    id: 'summary-flight', requestId: 'summary-request', ownerSide: 'player', missionId: 'transport',
    originPlanetId: 'helion-01', originCoordinate: { galaxy: 1, system: 3, position: 2 },
    destination: { kind: 'coordinate', coordinate: { galaxy: 1, system: 11, position: 4 } },
    destinationCoordinate: { galaxy: 1, system: 11, position: 4 }, selectedShips: { scout: 3 },
    populationReserved: 3, routeDistance: 10, effectiveSpeed: 10, oneWayDurationMs: 1_000,
    departedAt: 1_000, arrivalAt: 2_000, returnAt: 3_000, gasCost: 1,
    phase: 'completed', completedAt: 3_000, completionReason: 'normal-return', ...fields,
  };
}

function summaryDetails(flight: FlightRecord, context = {}) {
  const [item] = explorationMailboxReports(undefined, [flight], undefined, context);
  assert.ok(item);
  return { item, details: Object.fromEntries(item.details.map((row) => [row.label, row.value])) };
}

// Audit 26.10 M2.
test('flight summary names every completion reason in Russian and never calls a failure «completed»', () => {
  const expected: Array<[FlightRecord['completionReason'], FlightRecord['phase'], string, string]> = [
    ['normal-return', 'completed', 'Штатный возврат', 'ЗАВЕРШЕНО'],
    ['recalled', 'completed', 'Отозван', 'ОТОЗВАН'],
    ['target-unavailable', 'completed', 'Цель недоступна', 'ЦЕЛЬ НЕДОСТУПНА'],
    ['colonized', 'completed', 'Колонизировано', 'КОЛОНИЗИРОВАНО'],
    ['deployed', 'completed', 'Дислоцировано', 'ДИСЛОЦИРОВАНО'],
    ['spy-destroyed', 'completed', 'Зонд уничтожен', 'ЗОНД УНИЧТОЖЕН'],
    ['origin-destroyed', 'failed', 'Исходная планета потеряна', 'ФЛОТ ПОТЕРЯН'],
    ['mission-failed', 'completed', 'Миссия провалена', 'ПРОВАЛ'],
  ];
  for (const [reason, phase, label, status] of expected) {
    const { item, details } = summaryDetails(finishedFlight({ completionReason: reason, phase, missionId: 'deployment' }));
    assert.equal(details['Исход'], label, reason);
    assert.equal(item.statusLabel, status, reason);
    if (reason !== 'normal-return' && reason !== 'colonized' && reason !== 'deployed') {
      assert.notEqual(item.title, 'Рейс завершён', reason);
      assert.notEqual(item.statusTone, 'success', reason);
    }
    // Ids are references (repeat the flight), never shown.
    assert.doesNotMatch(JSON.stringify({ ...item, id: '', flightId: '' }), new RegExp(`${reason}|helion-01|summary-flight`));
  }
});

test('flight summary of an attack shows real loot, what storage took, what burned and the battle survivors', () => {
  const battle: BattleReport = {
    ...DEMO_BATTLE_REPORTS[0]!, id: 'battle-attack-summary-flight',
    attackerForce: { ...DEMO_BATTLE_REPORTS[0]!.attackerForce, stacks: [
      { entityId: 'scout', countBefore: 3, countAfter: 2, destroyed: 1 },
    ] },
  };
  const flight = finishedFlight({
    missionId: 'attack', targetPlanetName: 'Колония 11-4',
    attackResolution: { reportId: battle.id, resolvedAt: 2_000, debris: 300, loot: { metal: 5_000, minerals: 0, gas: 20, debris: 0 }, lootCreditedAt: 3_000 },
    cargoSettlement: { stage: 'returned', at: 3_000, credited: { metal: 4_000, minerals: 0, gas: 20, debris: 0 }, burned: { metal: 1_000, minerals: 0, gas: 0, debris: 0 } },
  });
  const { item, details } = summaryDetails(flight, { planetNames: { 'helion-01': 'Гелион' }, battleReports: [battle] });
  assert.equal(details['Планета отправления'], 'Гелион [1:3:2]');
  assert.equal(details['Цель'], 'Колония 11-4 [1:11:4]');
  assert.equal(details['Бой'], 'Победа');
  assert.equal(details['Вернувшийся флот'], 'Скаут × 2');
  assert.equal(details['Добыча · Металл'], '5\u00a0000');
  assert.equal(details['Зачислено · Металл'], '4\u00a0000');
  assert.equal(details['Сгорело при переполнении склада · Металл'], '1\u00a0000');
  assert.equal(details['Обломки на орбите цели'], '300');
  assert.doesNotMatch(JSON.stringify(item), /normal-return|helion-01|при отправлении/);
});

test('flight summary of an old save says the data is unavailable instead of inventing it', () => {
  const oldAttack = finishedFlight({ missionId: 'attack',
    attackResolution: { reportId: 'battle-attack-gone', resolvedAt: 2_000, debris: 0, loot: { metal: 10, minerals: 0, gas: 0, debris: 0 }, lootCreditedAt: 3_000 } });
  const attack = summaryDetails(oldAttack).details;
  assert.equal(attack['Вернувшийся флот'], 'данные недоступны');
  assert.equal(attack['Зачислено на склад'], 'данные недоступны');
  assert.equal(attack['Планета отправления'], 'Планета [1:3:2]');
  const oldTransport = summaryDetails(finishedFlight({ cargo: { metal: 99, minerals: 0, gas: 0, debris: 0 }, cargoState: 'delivered' })).details;
  assert.equal(oldTransport['Зачислено на склад'], 'данные недоступны');
  assert.equal(Object.keys(oldTransport).some((label) => /при отправлении|На борту/.test(label)), false);
});

// Audit 26.10 M3 (screenshot 25).
test('a battle with no rounds reads as one capture-without-a-fight sentence with its loot', () => {
  const report: BattleReport = { ...DEMO_BATTLE_REPORTS[0]!, id: 'battle-no-rounds', roundCount: 0, rounds: [], winner: 'attacker',
    resources: { metal: 5_000, minerals: 0, gas: 0 } };
  const item = battleReportToReportItem(report);
  assert.equal(item.statusLabel, 'ЗАХВАТ БЕЗ БОЯ');
  assert.match(item.title, /^Захват без боя: /);
  assert.equal(item.preview, 'Планета захвачена без боя: обороны не было. Добыча: Металл 5\u00a0000.');
  assert.doesNotMatch(JSON.stringify(item), /ПОБЕДА ПРИ АТАКЕ|0 раундов|Бой не состоялся/);
  assert.equal(noCombatVerdict(3, 'attacker', 'attack'), null);
  assert.equal(noCombatVerdict(0, 'defender', 'attack')?.summary, 'Бой не состоялся: у атакующего не было сил.');
});

test('«Отметить все прочитанными» clears every section, however long the archive', () => {
  const categories = ['system', 'battle', 'flights', 'command', 'alliances'] as const;
  const base = Date.parse('2026-11-01T00:00:00.000Z');
  // 1 400 messages: far more than the 500 ids the read list keeps.
  const items = Array.from({ length: 1400 }, (_, index) => ({
    id: `mail-${index}`,
    category: categories[index % categories.length],
    timestamp: new Date(base + index * 60_000).toISOString(),
  })) as unknown as ReportItem[];
  const before = getReportUnreadCounts(items, createDefaultReportsState());
  assert.equal(Object.values(before).reduce((sum, count) => sum + count, 0), 1400);

  const marked = markAllReportsRead(createDefaultReportsState(), items);
  assert.ok(Object.values(getReportUnreadCounts(items, marked)).every((count) => count === 0));
  // It survives the save round trip, and the id list stays small.
  const reloaded = migrateReportsState(JSON.parse(JSON.stringify(marked)));
  assert.ok(Object.values(getReportUnreadCounts(items, reloaded)).every((count) => count === 0));
  assert.ok(reloaded.readIds.length <= 500);

  // A message that arrives later is new again.
  const later = [...items, { id: 'mail-new', category: 'system', timestamp: new Date(base + 1400 * 60_000).toISOString() } as unknown as ReportItem];
  assert.equal(getReportUnreadCounts(later, reloaded).system, 1);
});

test('the message open in the reading pane stays listed under «Непрочитанные» once read', () => {
  const items = [
    { id: 'a', category: 'system', timestamp: '2026-11-06T10:00:00.000Z', title: 'A', summary: '' },
    { id: 'b', category: 'system', timestamp: '2026-11-06T11:00:00.000Z', title: 'B', summary: '' },
  ] as unknown as ReportItem[];
  const read = markReportRead(createDefaultReportsState(), 'a');
  const query = { category: 'system' as const, filter: 'unread' as const, search: '' };
  assert.deepEqual(filterReportItems(items, read, query).map((item) => item.id), ['b']);
  assert.deepEqual(filterReportItems(items, read, { ...query, keepId: 'a' }).map((item) => item.id), ['a', 'b']);
  assert.equal(reportReadCheck(read)(items[0]!), true);
});

// ---------------------------------------------------------------- one report format (11.11.2026)

function allianceRecord(id: string, name: string, tag: string, leaderOwnerId: string): AllianceRecord {
  return {
    id, name, tag, motto: '', description: '', emblem: createDefaultCommandState('test').alliances[0]!.emblem,
    createdAt: 0, leaderOwnerId, deputyOwnerId: null, leaderSince: 0,
    members: [{ ownerId: leaderOwnerId, displayName: leaderOwnerId, joinedAt: 0, lastActiveAt: 0, deliveredUnits: 0, jointOperationCount: 0, tieBreaker: 0.5 }],
  };
}

function application(fields: Partial<AllianceApplication> & Pick<AllianceApplication, 'id' | 'allianceId' | 'ownerId' | 'status'>): AllianceApplication {
  return { allianceName: 'Союз', displayName: fields.ownerId, reason: null, createdAt: 1_000, resolvedAt: null, resolvedByOwnerId: null, ...fields };
}

test('«Личные» gets the answers to the player applications and applications to the alliance the player runs', () => {
  const command = {
    ...createDefaultCommandState('production'),
    alliances: [allianceRecord('alliance-mine-1', 'Северный Рубеж', 'NORTH', 'player-me'), allianceRecord('alliance-other-2', 'Южный Флот', 'SOUTH', 'npc-boss')],
    applications: [
      application({ id: 'application-1', allianceId: 'alliance-other-2', allianceName: 'Южный Флот', ownerId: 'player-me', status: 'rejected', reason: 'declined', resolvedAt: 5_000 }),
      application({ id: 'application-2', allianceId: 'alliance-mine-1', ownerId: 'npc-wanderer', displayName: 'Странник', status: 'pending', createdAt: 6_000 }),
      application({ id: 'application-3', allianceId: 'alliance-other-2', ownerId: 'player-me', status: 'withdrawn', resolvedAt: 7_000 }),
      application({ id: 'application-4', allianceId: 'alliance-other-2', ownerId: 'npc-someone', status: 'pending' }),
    ],
  };
  const letters = personalLetters(command, 'player-me');
  assert.deepEqual(letters.map((letter) => letter.id), ['letter:application-answer:application-1', 'letter:application-incoming:application-2']);
  assert.deepEqual(letters[0]!.result, { label: 'Отклонена', tone: 'danger' });
  assert.equal(letters[0]!.sender.kind, 'alliance');
  assert.ok(letters.every((letter) => letter.answers.length >= 1 && letter.answers.length <= 2));
  // An outsider sees no incoming applications of somebody else's alliance.
  assert.deepEqual(personalLetters(command, 'npc-outsider'), []);
  const feed = buildReportsFeed([], createDefaultOperationsState(), command, undefined, [], [], [], [], [], undefined, 'player-me');
  assert.equal(getReportCategoryCounts(feed).personal, 2);
  assert.ok(feed.filter((item) => item.category === 'personal').every((item) => item.letter && item.timestamp));
  const sheet = buildReportSheet(feed.find((item) => item.id === 'letter:application-incoming:application-2')!);
  assert.equal(sheet.kind, 'letter');
  assert.equal(sheet.sides[0]!.name, 'Странник');
  assert.deepEqual(sheet.actions.map((action) => [action.kind, action.primary]), [['open_command', true]]);
  // Without the player's id the feed has no letters (old callers stay unchanged).
  assert.equal(buildReportsFeed([], createDefaultOperationsState(), command).some((item) => item.category === 'personal'), false);
});

test('every report kind becomes the same sheet: header with title, time and one result word, at most one primary action', () => {
  const spy = (quality: SpyReportSnapshot['quality']): SpyReportSnapshot => ({
    id: `spy-${quality}`, missionId: 'mission-1', createdAt: 10_000, sourcePlanetId: 'helion-01', targetPlanetId: 'target-1', targetPlanetName: 'Тавр',
    targetOwnerId: 'npc-bot-01', targetOwnerName: 'Адмирал', targetRaceId: 'synod', targetRelation: 'enemy', targetCoordinate: { galaxy: 1, system: 4, position: 7 },
    spyLevel: 5, targetEspionageLevel: 1, delta: 4, roll: 0, quality,
    resources: { metal: 100, minerals: 50, gas: 25, debris: 0, developmentEnergy: 10 },
    ...(quality === 'full' ? { fleet: { cruiser: 4, 'spy-probe': 1 }, defense: { 'laser-turret': 3 }, commanders: { hunter: { level: 2, count: 1 } } } : {}),
    firstReport: false,
  });
  const battle = DEMO_BATTLE_REPORTS[0]!;
  const items: Array<[ReportItem, ReturnType<typeof createBattleReportViewModel> | null]> = [
    [battleReportToReportItem(battle), createBattleReportViewModel(battle)],
    [spyReportToReportItem(spy('full')), null],
    [spyReportToReportItem(spy('basic')), null],
    [recyclerArrivalReportToReportItem({ id: createRecyclerArrivalReportId('r-0'), flightId: 'r-0', coordinate: { galaxy: 1, system: 2, position: 3 }, arrivedAtMs: 1_000, collectedDebris: 0, remainingOrbitalDebris: 0 }), null],
    [gasExtractionArrivalReportToReportItem({ id: createGasExtractionArrivalReportId('g-1'), flightId: 'g-1', coordinate: { galaxy: 2, system: 3, position: 16 }, arrivalAt: 2_000, outcome: 'found', gasCollected: 900, scrapCollected: 10 }), null],
    [overpopulationEpisodeReportToReportItem({ id: 'overpopulation:c:1', planetId: 'c', planetName: 'Колония', factionId: 'aegis', populationBefore: 35_000, populationAfter: 25_000, capacity: 25_000, episodeStartedAt: 1, episodeEndedAt: 3_000, removedShips: [{ shipId: 'cruiser', count: 9 }] }), null],
    [summaryDetails(finishedFlight({})).item, null],
  ];
  for (const [item, viewModel] of items) {
    const sheet = buildReportSheet(item, viewModel);
    assert.ok(sheet.title, item.id);
    assert.ok(sheet.time, item.id);
    assert.match(sheet.result.label, /^[А-ЯЁ][а-яё]+( [а-яё]+)?$/, `${item.id}: ${sheet.result.label}`);
    assert.ok(sheet.actions.filter((action) => action.primary).length <= 1, item.id);
  }
  const [battleSheet, fullSpy, basicSpy, recycler, gas, overpopulation, flight] = items.map(([item, viewModel]) => buildReportSheet(item, viewModel));
  // War report: sides, units per side, rounds, result; the full log is the primary action.
  assert.deepEqual(battleSheet!.sides.map((side) => side.role), ['Атакующий', 'Защитник']);
  assert.deepEqual(battleSheet!.ships.map((group) => group.title), ['Атакующий', 'Защитник']);
  assert.equal(battleSheet!.rounds.length, battle.rounds.length);
  // Debris on orbit: recyclers first (owner journal), the full log next to it.
  assert.deepEqual(battleSheet!.actions.map((action) => [action.kind, action.primary]), DEMO_BATTLE_REPORTS[0]!.debris ? [['collect_debris', true], ['open_battle', false]] : [['open_battle', true]]);
  assert.ok(!battleSheet!.sides.some((side) => side.facts?.some((fact) => /наука|броня/i.test(fact.label))), 'bonuses live in «Подробности»');
  assert.doesNotMatch(battleSheet!.title, new RegExp(`${battleSheet!.place?.name ?? '-'}$`));
  // Spy: everything revealed vs almost empty.
  assert.deepEqual(fullSpy!.ships[0]!.units.map((unit) => unit.key), ['cruiser']);
  assert.ok(fullSpy!.ships.some((group) => group.key === 'commanders' && group.units[0]!.ability));
  assert.equal(fullSpy!.assets[0]!.units.length, 1);
  assert.equal(fullSpy!.actions.find((action) => action.primary)?.kind, 'attack_target');
  assert.ok(fullSpy!.actions.some((action) => action.kind === 'simulate_battle' && !action.primary));
  assert.equal(fullSpy!.summary, '');
  assert.equal(basicSpy!.ships[0]!.hidden, true);
  assert.equal(basicSpy!.assets[0]!.hidden, true);
  assert.deepEqual(basicSpy!.place?.coordinate, { galaxy: 1, system: 4, position: 7 });
  // Recycling with nothing: «Пусто», debris only.
  assert.deepEqual(recycler!.result, { label: 'Пусто', tone: 'warning' });
  assert.deepEqual(recycler!.resources.flatMap((group) => group.items.map((resource) => resource.kind)), ['debris', 'debris']);
  assert.deepEqual(gas!.result, { label: 'Найден', tone: 'success' });
  assert.deepEqual(gas!.resources[0]!.items.map((resource) => [resource.kind, resource.value]), [['gas', 900], ['debris', 10]]);
  assert.deepEqual(overpopulation!.sides[0]!.population, { before: 35_000, after: 25_000 });
  assert.equal(overpopulation!.ships[0]!.total, '9 ед.');
  assert.deepEqual(overpopulation!.result, { label: 'Потери', tone: 'danger' });
  assert.deepEqual(flight!.result, { label: 'Доставлено', tone: 'success' });
  assert.deepEqual(flight!.sides.map((side) => side.role), ['Отправление', 'Цель']);
});

test('old saves still load: reports metadata has no new field and «Личные» read marks survive a reload', async () => {
  // The stored ReportsState shape did not change; an old envelope migrates as before.
  const old = migrateReportsState({ readIds: ['battle:1', 'espionage:2'], hiddenIds: ['battle:3'], readUpTo: '2026-11-01T00:00:00.000Z' });
  assert.deepEqual(old, { readIds: ['battle:1', 'espionage:2'], hiddenIds: ['battle:3'], readUpTo: '2026-11-01T00:00:00.000Z' });

  const { createInitialSaveState, createPersistenceFacade } = await loadPersistence();
  const storage = new MemoryStorage();
  const initial = createInitialSaveState('production', 50_000);
  const me = initial.profile.playerId;
  const command = {
    ...initial.command,
    applications: [application({ id: 'application-7', allianceId: 'alliance-gone-9', allianceName: 'Ушедшие', ownerId: me, status: 'rejected', reason: 'disbanded', resolvedAt: 40_000 })],
  };
  const letterId = 'letter:application-answer:application-7';
  const persistence = createPersistenceFacade({ mode: 'production', storage, now: () => 60_000 });
  assert.deepEqual(persistence.write({ ...initial, command, reports: { ...initial.reports, readIds: [letterId] } }), { ok: true });
  const hydrated = persistence.read();
  assert.deepEqual(hydrated.reports.readIds, [letterId]);
  assert.equal(personalLetters(hydrated.command, me)[0]?.id, letterId);
});

test('one mission is one report: a recycler arrival takes the return of the same flight, and an empty one is a short row', () => {
  const flight = finishedFlight({ id: 'mission-7', missionId: 'recycle', selectedShips: { recycler: 4 } });
  const arrival = { id: createRecyclerArrivalReportId('mission-7'), flightId: 'mission-7', coordinate: { galaxy: 1, system: 11, position: 4 }, arrivedAtMs: 2_000, collectedDebris: 0, remainingOrbitalDebris: 0 } as const;
  const feed = buildReportsFeed([], createDefaultOperationsState(), commandWithoutJointOperations(), undefined, [], [arrival], [], [], [flight], undefined, 'player-me');
  const flights = feed.filter((item) => item.category === 'flights');
  assert.deepEqual(flights.map((item) => item.id), [arrival.id]);
  const item = flights[0]!;
  assert.equal(item.brief, true);
  assert.equal(item.flightId, 'mission-7');
  // The return's fleet came along; the arrival's time and id stay.
  assert.equal(item.blocks?.ships?.[0]?.title, 'Вернувшийся флот');
  assert.equal(item.timestamp, new Date(2_000).toISOString());
  const sheet = buildReportSheet(item, null, { canRepeatFlight: (id) => id === 'mission-7' });
  assert.deepEqual(sheet.actions.map((action) => [action.kind, action.primary, action.flightId]), [['repeat_flight', true, 'mission-7']]);
  assert.equal(sheet.title, 'Переработчик прибыл');
  assert.match(sheet.summary, /На орбите обломков не найдено/);
  // Without the possibility the button is not offered.
  assert.deepEqual(buildReportSheet(item).actions, []);
});

test('an application decided in Command turns its «Личные» letter from «Новая» into the outcome', () => {
  const alliance = allianceRecord('alliance-mine-1', 'Северный Рубеж', 'NORTH', 'player-me');
  const letter = (status: AllianceApplication['status']) => personalLetters({
    alliances: [alliance],
    applications: [application({ id: 'application-5', allianceId: alliance.id, ownerId: 'npc-wanderer', displayName: 'Странник', status, resolvedAt: status === 'pending' ? null : 9_000 })],
  }, 'player-me')[0]!;
  const pending = letter('pending');
  assert.deepEqual(pending.result, { label: 'Новая', tone: 'info' });
  assert.equal(pending.answers.length, 1);
  assert.doesNotMatch(pending.text, /Командовани/);
  for (const [status, label] of [['accepted', 'Принята'], ['rejected', 'Отклонена'], ['withdrawn', 'Отозвана']] as const) {
    const decided = letter(status);
    assert.equal(decided.id, pending.id, 'the same letter, read marks stay');
    assert.equal(decided.result.label, label);
    assert.deepEqual(decided.answers, []);
  }
});

test('the title does not repeat the place shown under it', () => {
  assert.equal(titleWithoutPlace('Победа при атаке Кассиопея', { name: 'Кассиопея' }), 'Победа при атаке');
  assert.equal(titleWithoutPlace('Ничья: бой за Тавр', { name: 'Тавр' }), 'Ничья: бой');
  assert.equal(titleWithoutPlace('Полный шпионский отчёт: Тавр', { name: 'Тавр' }), 'Полный шпионский отчёт');
  assert.equal(titleWithoutPlace('Астероид не найден по координатам [2:3:4]', { coordinate: { galaxy: 2, system: 3, position: 4 } }), 'Астероид не найден');
  assert.equal(titleWithoutPlace('Экспедиция вернулась', { name: 'Рудные пустоши' }), 'Экспедиция вернулась');
});
