import assert from 'node:assert/strict';
import test from 'node:test';

import { COMBAT_TECHNOLOGIES } from '../combat/technologies.ts';
import { NEMEXIA_SCIENCE_SOURCE, SCIENCE_CATALOG, SCIENCE_CATEGORIES } from './catalog.ts';
import { getConfirmedPrerequisites, getScienceNodeBySourceId, getScienceNodesByCategory, searchScienceCatalog } from './selectors.ts';

const EXPECTED_NEMEXIA_NAMES = [
  'Физика',
  'Химия',
  'Математика',
  'Астрономия',
  'Шпионаж',
  'Компьютерные системы',
  'Броня кораблей',
  'Топливные элементы',
  'Реактивные двигатели',
  'Лазерная наука',
  'Ионная наука',
  'Плазменная наука',
  'Экология',
  'Гиперпространство',
  'Параллельные вселенные',
  'Улучшенное строительство',
  'Легкая Броня',
  'Средняя Броня',
  'Тяжелая Броня',
  'Пробивающая атака',
  'Маневренная защита',
  'Критический удар',
];

const EXPECTED_SOURCE_IDS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 17, 21, 22, 23, 18, 19, 20];

test('science catalog mirrors the 22 sciences in the saved Nemexia laboratory page', () => {
  assert.equal(SCIENCE_CATALOG.length, 22);
  assert.deepEqual(SCIENCE_CATALOG.map((item) => item.name), EXPECTED_NEMEXIA_NAMES);
  assert.deepEqual(SCIENCE_CATALOG.map((item) => item.sourceScienceId), EXPECTED_SOURCE_IDS);
  assert.equal(NEMEXIA_SCIENCE_SOURCE.repository, 'ratoker-jpg/Nemexia_auto_v2');
  assert.equal(NEMEXIA_SCIENCE_SOURCE.page, 'saved_pages/наука/page_2026-09-05_22-49-20.html');
  assert.ok(SCIENCE_CATALOG.every((item) => item.sourceStatus === 'nemexia-saved-page'));
});

test('science uses the four real Nemexia laboratory sections', () => {
  assert.deepEqual(SCIENCE_CATEGORIES.map((category) => category.id), ['basic', 'advanced', 'master', 'additional']);
  assert.deepEqual(getScienceNodesByCategory('basic').map((item) => item.sourceScienceId), [1, 2, 3, 4]);
  assert.deepEqual(getScienceNodesByCategory('advanced').map((item) => item.sourceScienceId), [5, 6, 7, 8, 9, 10, 11, 12, 13]);
  assert.deepEqual(getScienceNodesByCategory('master').map((item) => item.sourceScienceId), [14, 15, 17, 21, 22, 23]);
  assert.deepEqual(getScienceNodesByCategory('additional').map((item) => item.sourceScienceId), [18, 19, 20]);
  assert.equal(SCIENCE_CATEGORIES.find((category) => category.id === 'additional')?.exclusiveChoice, true);
});

test('source-backed science prerequisites resolve and preserve the saved requirement levels', () => {
  const ids = new Set(SCIENCE_CATALOG.map((item) => item.id));
  for (const item of SCIENCE_CATALOG) {
    assert.deepEqual(getConfirmedPrerequisites(item), item.requirements);
    assert.ok(item.requirements.every((requirement) => ids.has(requirement.scienceId) && requirement.level > 0));
    assert.ok(item.requiredLaboratoryLevel > 0);
  }
  assert.deepEqual(getScienceNodeBySourceId(12)?.requirements, [
    { scienceId: 'science-3', level: 7 },
    { scienceId: 'science-10', level: 10 },
    { scienceId: 'science-11', level: 5 },
  ]);
  assert.deepEqual(getScienceNodeBySourceId(19)?.requirements, [
    { scienceId: 'science-7', level: 10 },
    { scienceId: 'science-23', level: 5 },
  ]);
});

test('snapshot costs, time and levels are explicitly saved-page values', () => {
  for (const item of SCIENCE_CATALOG) {
    assert.equal(item.snapshotNextLevel, item.snapshotLevel + 1);
    assert.ok(item.snapshotLevel >= 0);
    assert.ok(/^\d{2,3}:\d{2}:\d{2}$/.test(item.snapshotTime));
    assert.ok(item.snapshotCost.metal >= 0);
    assert.ok(item.snapshotCost.crystal >= 0);
    assert.ok(item.snapshotCost.gas >= 0);
    assert.ok(item.snapshotCost.energy >= 0);
    assert.match(item.sourceNote, /сохранённого снимка Nemexia/);
  }
  assert.deepEqual(getScienceNodeBySourceId(15)?.snapshotCost, { metal: 0, crystal: 0, gas: 0, energy: 250000 });
  assert.equal(getScienceNodeBySourceId(15)?.snapshotTime, '205:24:00');
});

test('the ten existing Asterion Combat technologies map to the same Nemexia science ids', () => {
  const mapped = SCIENCE_CATALOG.filter((item) => item.combatTechnologyId);
  assert.equal(mapped.length, COMBAT_TECHNOLOGIES.length);
  for (const technology of COMBAT_TECHNOLOGIES) {
    const science = mapped.find((item) => item.combatTechnologyId === technology.id);
    assert.ok(science);
    assert.equal(science.sourceScienceId, technology.sourceScienceId);
  }
});

test('science search covers Nemexia names, effects, ids and combat aliases', () => {
  assert.equal(searchScienceCatalog('параллельные')[0]?.sourceScienceId, 15);
  assert.equal(searchScienceCatalog('доход озона')[0]?.sourceScienceId, 13);
  assert.equal(searchScienceCatalog('23')[0]?.name, 'Тяжелая Броня');
  assert.equal(searchScienceCatalog('criticalHit')[0]?.name, 'Критический удар');
});

test('science ids remain unique and source-id derived', () => {
  const ids = SCIENCE_CATALOG.map((item) => item.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(new Set(SCIENCE_CATALOG.map((item) => item.sourceScienceId)).size, SCIENCE_CATALOG.length);
  assert.ok(SCIENCE_CATALOG.every((item) => item.id === `science-${item.sourceScienceId}`));
});
