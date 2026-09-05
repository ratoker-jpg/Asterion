import assert from 'node:assert/strict';
import test from 'node:test';

import { COMBAT_TECHNOLOGIES } from '../combat/technologies.ts';
import { SCIENCE_CATALOG, SCIENCE_CATEGORIES, SCIENCE_VISUAL_LINKS, STELLAR_RESEARCH_SOURCE } from './catalog.ts';
import { getConfirmedPrerequisites, getScienceNodesByCategory, searchScienceCatalog } from './selectors.ts';

const EXPECTED_STELLAR_NAMES = [
  'Физика',
  'Химия',
  'Математика',
  'Астрономия',
  'Шпионаж',
  'Компьютерные системы',
  'Корабельная броня',
  'Топливные элементы',
  'Реактивные двигатели',
  'Лазерная технология',
  'Ионная технология',
  'Плазменная технология',
  'Экология',
  'Гиперпространство',
  'Параллельные вселенные',
  'Улучшенное строительство',
  'Пробивающая атака',
  'Маневренная защита',
  'Критический удар',
  'Лёгкая броня',
  'Средняя броня',
  'Тяжёлая броня',
];

test('science catalog mirrors all 22 current Stellar research templates', () => {
  assert.equal(SCIENCE_CATALOG.length, 22);
  assert.deepEqual(SCIENCE_CATALOG.map((item) => item.name), EXPECTED_STELLAR_NAMES);
  assert.equal(STELLAR_RESEARCH_SOURCE.repository, 'ratoker-jpg/stellar-empires');
  assert.equal(STELLAR_RESEARCH_SOURCE.commit, '466ec55f1751d36fd4a30175f7669f89ebe9a6a6');
});

test('science uses all six canonical Stellar research categories', () => {
  assert.deepEqual(SCIENCE_CATEGORIES.map((category) => category.id), [
    'energy', 'infrastructure', 'navigation', 'intelligence', 'defense', 'weapons',
  ]);
  const represented = new Set(SCIENCE_CATALOG.map((item) => item.categoryId));
  assert.equal(represented.size, SCIENCE_CATEGORIES.length);
  assert.ok(SCIENCE_CATEGORIES.every((category) => getScienceNodesByCategory(category.id).length > 0));
});

test('all source-backed prerequisites resolve to valid science nodes', () => {
  const ids = new Set(SCIENCE_CATALOG.map((item) => item.id));
  for (const item of SCIENCE_CATALOG) {
    assert.ok(item.requirements.every((requirement) => ids.has(requirement.scienceId)));
    assert.deepEqual(getConfirmedPrerequisites(item), item.requirements);
  }
  assert.equal(SCIENCE_VISUAL_LINKS.length, SCIENCE_CATALOG.reduce((sum, item) => sum + item.requirements.length, 0));
  assert.ok(SCIENCE_VISUAL_LINKS.every((link) => link.sourceBacked && ids.has(link.from) && ids.has(link.to)));
});

test('source research metadata stays sane and non-negative', () => {
  for (const item of SCIENCE_CATALOG) {
    assert.ok(item.maxLevel > 0 && Number.isInteger(item.maxLevel));
    assert.ok(item.requiredLaboratoryLevel > 0 && Number.isInteger(item.requiredLaboratoryLevel));
    assert.ok(item.baseSeconds > 0 && Number.isFinite(item.baseSeconds));
    assert.ok(item.baseCost.metal >= 0 && item.baseCost.crystal >= 0 && item.baseCost.gas >= 0);
    assert.equal(item.sourceStatus, 'stellar-current');
  }
});

test('the ten combat-overlap sciences retain current Asterion Combat mappings', () => {
  const mapped = SCIENCE_CATALOG.filter((item) => item.combatTechnologyId);
  assert.equal(mapped.length, COMBAT_TECHNOLOGIES.length);
  for (const technology of COMBAT_TECHNOLOGIES) {
    const science = mapped.find((item) => item.combatTechnologyId === technology.id);
    assert.ok(science);
    assert.equal(science.sourceScienceId, technology.sourceScienceId);
  }
});

test('science search covers names, slugs, descriptions and existing combat aliases', () => {
  assert.equal(searchScienceCatalog('параллельные').length, 1);
  assert.equal(searchScienceCatalog('computer-systems')[0]?.name, 'Компьютерные системы');
  assert.equal(searchScienceCatalog('criticalHit')[0]?.name, 'Критический удар');
  assert.equal(searchScienceCatalog('лазерная')[0]?.name, 'Лазерная технология');
  assert.equal(searchScienceCatalog('фундаментальная')[0]?.name, 'Физика');
});

test('science ids are unique and stable slug-derived ids', () => {
  const ids = SCIENCE_CATALOG.map((item) => item.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(SCIENCE_CATALOG.every((item) => item.id === `science-${item.slug}`));
});
