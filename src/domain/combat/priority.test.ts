import assert from 'node:assert/strict';
import test from 'node:test';

import { COMMANDER_ABILITIES, COMMANDER_IDS } from './commanders.ts';
import { ALL_COMBAT_ENTITY_IDS } from './ids.ts';
import {
  ASTERION_SAVE_KEY,
  COMBAT_SAVE_SCHEMA_VERSION,
  createDefaultCombatPriority,
  migrateCombatPriority,
  moveCommanderBefore,
  moveCommanderToEnd,
  persistCombatPriority,
  readCombatPriority,
  selectActiveCommander,
} from './priority.ts';

class MemoryStorage {
  private values = new Map<string, string>();

  getItem(key: string) {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
}

test('commander catalog contains all 13 unique commander ids', () => {
  assert.equal(COMMANDER_IDS.length, 13);
  assert.equal(new Set(COMMANDER_IDS).size, 13);
  COMMANDER_IDS.forEach((id) => assert.equal(COMMANDER_ABILITIES[id].commanderId, id));
});

test('all canonical combat entity ids are unique', () => {
  assert.equal(ALL_COMBAT_ENTITY_IDS.length, 35);
  assert.equal(new Set(ALL_COMBAT_ENTITY_IDS).size, ALL_COMBAT_ENTITY_IDS.length);
});

test('attack and defense default orders are independent arrays', () => {
  const priority = createDefaultCombatPriority();
  const originalDefense = [...priority.defense];
  priority.attack = moveCommanderBefore(priority.attack, 'judge', 'corsair');

  assert.equal(priority.attack[0], 'judge');
  assert.deepEqual(priority.defense, originalDefense);
});

test('reordering one list does not change the other list', () => {
  const priority = createDefaultCombatPriority();
  const defenseBefore = [...priority.defense];
  const attackAfter = moveCommanderBefore(priority.attack, 'annihilator', 'hunter');

  assert.notDeepEqual(attackAfter, priority.attack);
  assert.deepEqual(priority.defense, defenseBefore);
});

test('commander can be moved to the final priority slot', () => {
  const priority = moveCommanderToEnd(COMMANDER_IDS, 'corsair');

  assert.equal(priority.at(-1), 'corsair');
  assert.equal(priority.length, COMMANDER_IDS.length);
  assert.equal(new Set(priority).size, COMMANDER_IDS.length);
});

test('selectActiveCommander picks the first present commander in priority order', () => {
  const priority = ['judge', 'executioner', 'annihilator', 'corsair'] as const;
  assert.equal(selectActiveCommander(priority, ['executioner', 'judge', 'corsair']), 'judge');
});

test('selectActiveCommander returns null when no commanders are present', () => {
  assert.equal(selectActiveCommander(COMMANDER_IDS, []), null);
});

test('selectActiveCommander can be evaluated independently for attack and defense', () => {
  const attack = moveCommanderBefore(COMMANDER_IDS, 'corsair', 'hunter');
  const defense = moveCommanderBefore(COMMANDER_IDS, 'judge', 'corsair');
  const present = ['corsair', 'judge'] as const;

  assert.equal(selectActiveCommander(attack, present), 'corsair');
  assert.equal(selectActiveCommander(defense, present), 'judge');
});

test('legacy save without priorities migrates to the explicit default order', () => {
  const storage = new MemoryStorage();
  storage.setItem(ASTERION_SAVE_KEY, JSON.stringify({ metal: 123, planets: { 'helion-01': { population: 20 } } }));

  const migrated = readCombatPriority(storage);
  assert.deepEqual(migrated, createDefaultCombatPriority());
});

test('partial or duplicated saved order is normalized and keeps all commanders', () => {
  const migrated = migrateCombatPriority({
    attack: ['judge', 'judge', 'corsair', 'unknown'],
    defense: ['polias'],
  });

  assert.equal(migrated.attack.length, 13);
  assert.equal(migrated.defense.length, 13);
  assert.equal(migrated.attack[0], 'judge');
  assert.equal(migrated.attack[1], 'corsair');
  assert.equal(migrated.defense[0], 'polias');
  assert.equal(new Set(migrated.attack).size, 13);
  assert.equal(new Set(migrated.defense).size, 13);
});

test('priority persists in the existing save envelope and survives reload', () => {
  const storage = new MemoryStorage();
  storage.setItem(ASTERION_SAVE_KEY, JSON.stringify({ metal: 777, currentPlanetId: 'helion-01' }));

  const priority = createDefaultCombatPriority();
  priority.attack = moveCommanderBefore(priority.attack, 'judge', 'corsair');
  priority.defense = moveCommanderBefore(priority.defense, 'polias', 'corsair');

  const result = persistCombatPriority(priority, storage);
  assert.equal(result.ok, true);
  assert.deepEqual(readCombatPriority(storage), priority);

  const saved = JSON.parse(storage.getItem(ASTERION_SAVE_KEY) ?? '{}') as Record<string, unknown>;
  assert.equal(saved.metal, 777);
  assert.equal(saved.schemaVersion, COMBAT_SAVE_SCHEMA_VERSION);
  assert.deepEqual(saved.combatPriority, priority);
});

// TEMPORARY audit execution hook. Reverted after metrics are collected from CI.
const { runTargetPriorityAudit } = await import('../../../tools/audit-nemexia-target-priority.mjs');
const { createHash } = await import('node:crypto');
const { readFileSync } = await import('node:fs');
console.log('TARGET_PRIORITY_AUDIT_START');
console.log(JSON.stringify(runTargetPriorityAudit(), null, 2));
console.log('TARGET_PRIORITY_AUDIT_END');

function parseAuditCsvLine(line: string) {
  const cells: string[] = [];
  let cell = '';
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const ch = line[index]!;
    if (quoted && ch === '"' && line[index + 1] === '"') { cell += '"'; index += 1; }
    else if (ch === '"') quoted = !quoted;
    else if (ch === ',' && !quoted) { cells.push(cell); cell = ''; }
    else cell += ch;
  }
  cells.push(cell);
  return cells;
}
const auditLines = readFileSync('docs/evidence/nemexia-target-priority-corpus/target-transitions.csv', 'utf8').replace(/^\uFEFF/, '').split(/\r?\n/).filter(Boolean);
const auditHeaders = parseAuditCsvLine(auditLines[0] ?? '');
const auditRows = auditLines.slice(1).map((line) => {
  const cells = parseAuditCsvLine(line);
  const row = Object.fromEntries(auditHeaders.map((header, index) => [header, cells[index] ?? '']));
  const reportKey = `${row.archive_part}:${row.source_line}`;
  const groupKey = `${row.experiment_block}|${row.comparison_key || reportKey}`;
  const bucket = Number.parseInt(createHash('sha256').update(groupKey).digest('hex').slice(0, 8), 16) % 100;
  return { ...row, reportKey, groupKey, holdout: bucket >= 70 };
});
const auditDiscoveryReports = new Set(auditRows.filter((row) => row.experiment_block !== 'target_priority' && !row.holdout).map((row) => row.reportKey));
const auditHoldoutRows = auditRows.filter((row) => row.experiment_block !== 'target_priority' && row.holdout);
const auditHoldoutReports = new Set(auditHoldoutRows.map((row) => row.reportKey));
const reportOverlap = [...auditDiscoveryReports].filter((key) => auditHoldoutReports.has(key));
const uniformExpectedAccuracy = auditHoldoutRows.reduce((sum, row) => sum + 1 / JSON.parse(row.alive_targets_at_switch_json || '[]').length, 0) / auditHoldoutRows.length;
const controlledRows = auditRows.filter((row) => row.experiment_block === 'target_priority');
let firstLegalEligible = 0;
let firstLegalHit = 0;
for (const row of controlledRows) {
  const candidates = JSON.parse(row.alive_targets_at_switch_json || '[]') as Array<{ name: string }>;
  const names = new Set(candidates.map((candidate) => candidate.name));
  const plan = JSON.parse(row.priority_order_plan_json || '[]') as string[];
  const firstLegal = plan.find((name) => names.has(name));
  if (!firstLegal) continue;
  firstLegalEligible += 1;
  if (firstLegal === row.current_target) firstLegalHit += 1;
}
console.log('TARGET_PRIORITY_AUDIT_DIAGNOSTICS');
console.log(JSON.stringify({
  reportOverlapCount: reportOverlap.length,
  reportOverlapExamples: reportOverlap.slice(0, 10),
  uniformExpectedAccuracy,
  controlledPlannedFirstLegal: { hit: firstLegalHit, eligible: firstLegalEligible, accuracy: firstLegalEligible ? firstLegalHit / firstLegalEligible : null },
}, null, 2));
process.exit(1);
