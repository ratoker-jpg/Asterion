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
