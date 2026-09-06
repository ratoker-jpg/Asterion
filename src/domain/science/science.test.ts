import assert from 'node:assert/strict';
import test from 'node:test';
import { COMBAT_TECHNOLOGY_IDS } from '../combat/technologies.ts';
import { SCIENCE_CATALOG, SCIENCE_SECTIONS } from './catalog.ts';
import { SCIENCE_PROTOTYPE_DISPLAY_STATE } from './prototype-state.ts';
import { sciencesForSection } from './selectors.ts';

test('catalog contains the 22 source-backed sciences and does not invent science 16', () => {
  assert.equal(SCIENCE_CATALOG.length, 22);
  assert.equal(new Set(SCIENCE_CATALOG.map((science) => science.id)).size, 22);
  assert.equal(SCIENCE_CATALOG.some((science) => Number(science.id) === 16), false);
});

test('section membership is deterministic', () => {
  assert.deepEqual(SCIENCE_SECTIONS.map((section) => [section.id, sciencesForSection(section.id).map((science) => science.id)]), [
    ['basic', [1, 2, 3, 4]],
    ['advanced', [5, 6, 7, 8, 9, 10, 11, 12, 13]],
    ['expert', [14, 15, 17, 21, 22, 23]],
    ['additional', [18, 19, 20]],
  ]);
});

test('every science maps to an Asterion technology art slug', () => {
  assert.equal(new Set(SCIENCE_CATALOG.map((science) => science.artSlug)).size, 22);
  for (const science of SCIENCE_CATALOG) {
    assert.match(science.artSlug, /^technology\.shared\.[a-z0-9-]+\.png$/);
  }
});

test('all ten combat overlaps map to existing CombatTechnologyId values', () => {
  const mapped = SCIENCE_CATALOG.filter((science) => science.combatTechnologyId);
  assert.equal(mapped.length, 10);
  for (const science of mapped) {
    assert.equal(COMBAT_TECHNOLOGY_IDS.includes(science.combatTechnologyId!), true);
  }
});

test('all prerequisites reference valid source science ids', () => {
  const ids = new Set(SCIENCE_CATALOG.map((science) => science.id));
  for (const science of SCIENCE_CATALOG) {
    for (const prerequisite of science.prerequisites) {
      assert.equal(ids.has(prerequisite.scienceId), true);
      assert.equal(prerequisite.level > 0, true);
    }
  }
});

test('prototype display state is separated from campaign/gameplay resources', () => {
  assert.equal(SCIENCE_PROTOTYPE_DISPLAY_STATE.laboratoryLevel, 7);
  assert.equal('resources' in SCIENCE_PROTOTYPE_DISPLAY_STATE, false);
  assert.equal('campaign' in SCIENCE_PROTOTYPE_DISPLAY_STATE, false);
});

test('science definitions contain no combat coefficient or research reducer contract', () => {
  for (const science of SCIENCE_CATALOG) {
    const keys = Object.keys(science);
    assert.equal(keys.some((key) => /multiplier|coefficient|maxLevel|reducer|spend/i.test(key)), false);
  }
});
