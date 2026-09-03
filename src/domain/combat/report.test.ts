import assert from 'node:assert/strict';
import test from 'node:test';

import { DEMO_BATTLE_REPORTS } from './battle-fixtures.ts';
import {
  createDefaultBattleHistory,
  isBattleReportSaved,
  migrateBattleHistory,
  persistBattleHistory,
  readBattleHistory,
  setBattleReportSaved,
} from './battle-repository.ts';
import { ALL_COMBAT_ENTITY_IDS } from './ids.ts';
import { ASTERION_SAVE_KEY, COMBAT_SAVE_SCHEMA_VERSION } from './priority.ts';
import {
  assertBattleStackConsistency,
  calculateDestroyed,
  calculatePopulationLoss,
  createBattleSummary,
  filterBattleReports,
} from './report.ts';

class MemoryStorage {
  private values = new Map<string, string>();

  getItem(key: string) {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
}

function allFixtureEntityIds() {
  const ids: string[] = [];
  DEMO_BATTLE_REPORTS.forEach((report) => {
    const collectStacks = (stacks: readonly { entityId: string }[] | undefined) => stacks?.forEach((stack) => ids.push(stack.entityId));
    collectStacks(report.attackerForce.stacks);
    collectStacks(report.defenderForce.stacks);
    collectStacks(report.attackerForce.defenses);
    collectStacks(report.defenderForce.defenses);
    report.rounds.forEach((round) => {
      round.events.forEach((event) => {
        ids.push(event.actorEntityId, event.targetEntityId);
      });
      collectStacks(round.attackerSnapshot?.stacks);
      collectStacks(round.attackerSnapshot?.defenses);
      collectStacks(round.defenderSnapshot?.stacks);
      collectStacks(round.defenderSnapshot?.defenses);
    });
  });
  return ids;
}

test('demo battle report ids are unique', () => {
  const ids = DEMO_BATTLE_REPORTS.map((report) => report.id);
  assert.equal(new Set(ids).size, ids.length);
});

test('every fixture combat entity id exists in the canonical combat ids', () => {
  const canonical = new Set<string>(ALL_COMBAT_ENTITY_IDS);
  allFixtureEntityIds().forEach((entityId) => assert.equal(canonical.has(entityId), true, entityId));
});

test('destroyed count is before minus after for every fixture stack', () => {
  assert.equal(calculateDestroyed(100, 42), 58);
  DEMO_BATTLE_REPORTS.forEach((report) => {
    const stacks = [
      ...report.attackerForce.stacks,
      ...report.defenderForce.stacks,
      ...(report.attackerForce.defenses ?? []),
      ...(report.defenderForce.defenses ?? []),
    ];
    stacks.forEach((stack) => assert.equal(assertBattleStackConsistency(stack), true, `${report.id}:${stack.entityId}`));
  });
});

test('population loss is derived only from before and after values', () => {
  const report = DEMO_BATTLE_REPORTS[0];
  assert.equal(calculatePopulationLoss(report.attackerForce.populationBefore, report.attackerForce.populationAfter), 247);
  assert.equal(calculatePopulationLoss(report.defenderForce.populationBefore, report.defenderForce.populationAfter), 510);
});

test('saving and unsaving never mutates immutable report fixture data', () => {
  const history = createDefaultBattleHistory();
  const fixtureBefore = JSON.stringify(DEMO_BATTLE_REPORTS[0]);
  const reportsReference = history.reports;

  const saved = setBattleReportSaved(history, DEMO_BATTLE_REPORTS[0].id, true);
  const unsaved = setBattleReportSaved(saved, DEMO_BATTLE_REPORTS[0].id, false);

  assert.equal(JSON.stringify(DEMO_BATTLE_REPORTS[0]), fixtureBefore);
  assert.equal(saved.reports, reportsReference);
  assert.equal(unsaved.reports, reportsReference);
});

test('saved report ids are independent user state', () => {
  const history = createDefaultBattleHistory();
  const reportId = DEMO_BATTLE_REPORTS[0].id;
  const saved = setBattleReportSaved(history, reportId, true);

  assert.equal(history.savedReportIds.includes(reportId), false);
  assert.equal(saved.savedReportIds.includes(reportId), true);
  assert.equal('saved' in (DEMO_BATTLE_REPORTS[0] as unknown as Record<string, unknown>), false);
});

test('saved report survives persistence and reload', () => {
  const storage = new MemoryStorage();
  const reportId = DEMO_BATTLE_REPORTS[0].id;
  const saved = setBattleReportSaved(createDefaultBattleHistory(), reportId, true);

  const result = persistBattleHistory(saved, storage);
  assert.equal(result.ok, true);
  assert.equal(isBattleReportSaved(readBattleHistory(storage), reportId), true);
});

test('unsaved report stays unsaved after reload', () => {
  const storage = new MemoryStorage();
  const reportId = DEMO_BATTLE_REPORTS[0].id;
  const saved = setBattleReportSaved(createDefaultBattleHistory(), reportId, true);
  persistBattleHistory(saved, storage);

  const unsaved = setBattleReportSaved(readBattleHistory(storage), reportId, false);
  persistBattleHistory(unsaved, storage);

  assert.equal(isBattleReportSaved(readBattleHistory(storage), reportId), false);
});

test('PR29 save without combat history migrates and keeps battle reports', () => {
  const storage = new MemoryStorage();
  storage.setItem(ASTERION_SAVE_KEY, JSON.stringify({
    schemaVersion: 2,
    metal: 777,
    combatPriority: { attack: ['judge'], defense: ['polias'] },
  }));

  const history = readBattleHistory(storage);
  assert.equal(history.reports.length, DEMO_BATTLE_REPORTS.length);
  assert.deepEqual(history.savedReportIds, []);

  const persisted = persistBattleHistory(history, storage);
  assert.equal(persisted.ok, true);
  const envelope = JSON.parse(storage.getItem(ASTERION_SAVE_KEY) ?? '{}') as Record<string, unknown>;
  assert.equal(envelope.metal, 777);
  assert.equal(envelope.schemaVersion, COMBAT_SAVE_SCHEMA_VERSION);
  assert.ok(envelope.combat);
});

test('stored reports survive migration while missing demo fixtures are restored', () => {
  const customReport = {
    ...DEMO_BATTLE_REPORTS[0],
    id: 'battle-imported-stable',
    metadata: { source: 'imported' as const },
  };
  const migrated = migrateBattleHistory({ reports: [customReport], savedReportIds: [customReport.id] });

  assert.equal(migrated.reports.some((report) => report.id === customReport.id), true);
  DEMO_BATTLE_REPORTS.forEach((report) => assert.equal(migrated.reports.some((item) => item.id === report.id), true));
  assert.deepEqual(migrated.savedReportIds, [customReport.id]);
});

test('recent and saved list selectors stay independent', () => {
  const history = createDefaultBattleHistory();
  const reportId = DEMO_BATTLE_REPORTS[1].id;
  const saved = setBattleReportSaved(history, reportId, true);

  assert.equal(filterBattleReports(saved.reports, saved.savedReportIds, 'recent').length, DEMO_BATTLE_REPORTS.length);
  assert.deepEqual(filterBattleReports(saved.reports, saved.savedReportIds, 'saved').map((report) => report.id), [reportId]);
  assert.equal(createBattleSummary(saved.reports[1], saved.savedReportIds).saved, true);
});

test('optional combat event values remain absent instead of becoming fake zeroes', () => {
  const event = DEMO_BATTLE_REPORTS[2].rounds[0].events[0];
  assert.equal(event.attackValue, undefined);
  assert.equal(event.shieldBefore, undefined);
  assert.equal(event.lifeAfter, undefined);
});

test('fixtures cover defence entities and commander snapshots using canonical ids', () => {
  const defenseReport = DEMO_BATTLE_REPORTS.find((report) => (report.defenderForce.defenses?.length ?? 0) > 0);
  const commanderReport = DEMO_BATTLE_REPORTS.find((report) => report.attackerForce.activeCommanderId || report.defenderForce.activeCommanderId);

  assert.ok(defenseReport);
  assert.ok(commanderReport);
  defenseReport?.defenderForce.defenses?.forEach((stack) => assert.ok((ALL_COMBAT_ENTITY_IDS as readonly string[]).includes(stack.entityId)));
  const commanderId = commanderReport?.attackerForce.activeCommanderId ?? commanderReport?.defenderForce.activeCommanderId;
  assert.ok(commanderId && (ALL_COMBAT_ENTITY_IDS as readonly string[]).includes(commanderId));
});
