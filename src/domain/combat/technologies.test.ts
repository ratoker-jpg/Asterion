import assert from 'node:assert/strict';
import test from 'node:test';

import { getCombatEntity } from './catalog.ts';
import {
  createDefaultCombatTechnologies,
  getTechnologyArmorPercent,
  getTechnologyAttackMultiplier,
  getTechnologyLifeMultiplier,
  normalizeCombatTechnologies,
} from './technologies.ts';

function approximately(actual: number, expected: number) {
  assert.ok(Math.abs(actual - expected) < 1e-9, `expected ${actual} to be approximately ${expected}`);
}

test('combat technology levels default to zero and clamp to documented maxima', () => {
  assert.deepEqual(createDefaultCombatTechnologies(), {
    shipDefense: 0,
    laserScience: 0,
    ionScience: 0,
    plasmaScience: 0,
    lightArmor: 0,
    mediumArmor: 0,
    heavyArmor: 0,
    forceAttack: 0,
    promptDefense: 0,
  });

  assert.deepEqual(normalizeCombatTechnologies({
    shipDefense: 99,
    laserScience: 99,
    ionScience: -2,
    plasmaScience: 4.9,
    lightArmor: 99,
    mediumArmor: 3,
    heavyArmor: 2,
    forceAttack: 99,
    promptDefense: 7,
  }), {
    shipDefense: 20,
    laserScience: 15,
    ionScience: 0,
    plasmaScience: 4,
    lightArmor: 10,
    mediumArmor: 3,
    heavyArmor: 2,
    forceAttack: 10,
    promptDefense: 7,
  });
});

test('weapon science and force attack add their documented deterministic attack bonuses', () => {
  const scout = getCombatEntity('scout');
  const levels = normalizeCombatTechnologies({ laserScience: 2, forceAttack: 3 });
  approximately(getTechnologyAttackMultiplier(scout, levels), 1.45);

  const laserDefense = getCombatEntity('laser-turret');
  approximately(getTechnologyAttackMultiplier(laserDefense, levels), 1.30);
});

test('ship defense and prompt defense increase ship life but not planetary defense life', () => {
  const levels = normalizeCombatTechnologies({ shipDefense: 5, promptDefense: 2 });
  approximately(getTechnologyLifeMultiplier(getCombatEntity('scout'), levels), 1.6);
  assert.equal(getTechnologyLifeMultiplier(getCombatEntity('laser-turret'), levels), 1);
});

test('armor sciences add documented percentage points by armor class', () => {
  const levels = normalizeCombatTechnologies({ lightArmor: 5, mediumArmor: 5, heavyArmor: 5 });
  assert.equal(getTechnologyArmorPercent(getCombatEntity('scout'), levels), 8);
  assert.equal(getTechnologyArmorPercent(getCombatEntity('battleship'), levels), 16);
  assert.equal(getTechnologyArmorPercent(getCombatEntity('destroyer'), levels), 24);
});
