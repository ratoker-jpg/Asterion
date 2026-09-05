import assert from 'node:assert/strict';
import test from 'node:test';

import { COMBAT_TECHNOLOGIES, COMBAT_TECHNOLOGY_IDS } from '../combat/technologies.ts';
import { SCIENCE_CATALOG, SCIENCE_CATEGORIES, SCIENCE_VISUAL_LINKS } from './catalog.ts';
import { getConfirmedPrerequisites, getScienceNodesByCategory, searchScienceCatalog } from './selectors.ts';

test('confirmed source science ids are unique', () => {
  const ids = SCIENCE_CATALOG.map((item) => item.sourceScienceId);
  assert.equal(new Set(ids).size, ids.length);
});

test('science catalog maps one-to-one to existing CombatTechnologyId values', () => {
  assert.deepEqual(
    [...SCIENCE_CATALOG.map((item) => item.combatTechnologyId)].sort(),
    [...COMBAT_TECHNOLOGY_IDS].sort(),
  );
});

test('every referenced CombatTechnologyId exists in the combat contract', () => {
  const ids = new Set<string>(COMBAT_TECHNOLOGY_IDS);
  assert.ok(SCIENCE_CATALOG.every((item) => ids.has(item.combatTechnologyId)));
});

test('science domain does not introduce combat multipliers or invented effect values', () => {
  for (const item of SCIENCE_CATALOG) {
    const keys = Object.keys(item);
    assert.equal(keys.some((key) => /multiplier|bonus|effect|maxLevel|cost|time/i.test(key)), false);
  }
});

test('visual node ids are unique and stable source-derived ids', () => {
  const ids = SCIENCE_CATALOG.map((item) => item.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(SCIENCE_CATALOG.every((item) => item.id === `science-${item.sourceScienceId}`));
});

test('confirmed prerequisites reference valid nodes', () => {
  const ids = new Set(SCIENCE_CATALOG.map((item) => item.id));
  for (const item of SCIENCE_CATALOG) {
    assert.ok(item.confirmedPrerequisites.every((id) => ids.has(id)));
  }
});

test('visual-only links never participate in gameplay prerequisite selectors', () => {
  assert.deepEqual(SCIENCE_VISUAL_LINKS, []);
  assert.ok(SCIENCE_CATALOG.every((item) => getConfirmedPrerequisites(item).length === 0));
});

test('science catalog and category selectors are deterministic', () => {
  const first = SCIENCE_CATEGORIES.flatMap((category) => getScienceNodesByCategory(category.id).map((item) => item.id));
  const second = SCIENCE_CATEGORIES.flatMap((category) => getScienceNodesByCategory(category.id).map((item) => item.id));
  assert.deepEqual(first, second);
  assert.equal(new Set(first).size, SCIENCE_CATALOG.length);
});

test('source metadata from current combat technology contract is preserved', () => {
  assert.deepEqual(
    SCIENCE_CATALOG.map((item) => ({ id: item.combatTechnologyId, sourceScienceId: item.sourceScienceId, name: item.name })),
    COMBAT_TECHNOLOGIES.map((technology) => ({ id: technology.id, sourceScienceId: technology.sourceScienceId, name: technology.name })),
  );
  assert.ok(SCIENCE_CATALOG.every((item) => item.sourceStatus === 'confirmed'));
});

test('all ten current Asterion combat technologies are represented and searchable', () => {
  assert.equal(SCIENCE_CATALOG.length, 10);
  const expectedNames = [
    'Лазерная наука',
    'Ионная наука',
    'Плазменная наука',
    'Пробивающая атака',
    'Лёгкая броня',
    'Средняя броня',
    'Тяжёлая броня',
    'Броня кораблей',
    'Маневренная защита',
    'Критический удар',
  ];
  assert.deepEqual(SCIENCE_CATALOG.map((item) => item.name), expectedNames);
  assert.equal(searchScienceCatalog('лазерная').length, 1);
  assert.equal(searchScienceCatalog('20')[0]?.name, 'Критический удар');
});
