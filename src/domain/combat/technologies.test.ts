import assert from 'node:assert/strict';
import test from 'node:test';

import { getCombatEntity } from './catalog.ts';
import {
  COMBAT_TECHNOLOGIES,
  createDefaultCombatTechnologies,
  getTechnologyArmorPercent,
  getTechnologyAttackMultiplier,
  getTechnologyLifeMultiplier,
  normalizeCombatTechnologies,
} from './technologies.ts';

test('combat technology catalog matches the saved Nemexia simulator science fields', () => {
  assert.deepEqual(COMBAT_TECHNOLOGIES.map(({ sourceScienceId, name }) => ({ sourceScienceId, name })), [
    { sourceScienceId: 10, name: 'Лазерная наука' },
    { sourceScienceId: 11, name: 'Ионная наука' },
    { sourceScienceId: 12, name: 'Плазменная наука' },
    { sourceScienceId: 18, name: 'Пробивающая атака' },
    { sourceScienceId: 21, name: 'Лёгкая броня' },
    { sourceScienceId: 22, name: 'Средняя броня' },
    { sourceScienceId: 23, name: 'Тяжёлая броня' },
    { sourceScienceId: 7, name: 'Броня кораблей' },
    { sourceScienceId: 19, name: 'Маневренная защита' },
    { sourceScienceId: 20, name: 'Критический удар' },
  ]);
});

test('combat technology levels default to zero and normalize as non-negative integers', () => {
  assert.deepEqual(createDefaultCombatTechnologies(), {
    laserScience: 0,
    ionScience: 0,
    plasmaScience: 0,
    piercingAttack: 0,
    lightArmor: 0,
    mediumArmor: 0,
    heavyArmor: 0,
    shipArmor: 0,
    maneuverDefense: 0,
    criticalHit: 0,
  });

  assert.deepEqual(normalizeCombatTechnologies({
    laserScience: 99,
    ionScience: -2,
    plasmaScience: 4.9,
    piercingAttack: 12,
    lightArmor: 8,
    mediumArmor: 3,
    heavyArmor: 2,
    shipArmor: 17,
    maneuverDefense: 7,
    criticalHit: 6,
  }), {
    laserScience: 99,
    ionScience: 0,
    plasmaScience: 4,
    piercingAttack: 12,
    lightArmor: 8,
    mediumArmor: 3,
    heavyArmor: 2,
    shipArmor: 17,
    maneuverDefense: 7,
    criticalHit: 6,
  });
});

test('legacy provisional science keys migrate without losing saved levels', () => {
  const migrated = normalizeCombatTechnologies({
    shipDefense: 5,
    forceAttack: 4,
    promptDefense: 3,
  });
  assert.equal(migrated.shipArmor, 5);
  assert.equal(migrated.piercingAttack, 4);
  assert.equal(migrated.maneuverDefense, 3);
});

test('unverified science coefficients remain neutral in Combat Resolver v1', () => {
  const levels = normalizeCombatTechnologies({
    laserScience: 9,
    ionScience: 8,
    plasmaScience: 7,
    piercingAttack: 6,
    lightArmor: 5,
    mediumArmor: 4,
    heavyArmor: 3,
    shipArmor: 2,
    maneuverDefense: 1,
    criticalHit: 10,
  });
  const scout = getCombatEntity('scout');
  assert.equal(getTechnologyAttackMultiplier(scout, levels), 1);
  assert.equal(getTechnologyLifeMultiplier(scout, levels), 1);
  assert.equal(getTechnologyArmorPercent(scout, levels), scout.combat.armorStrength);
});
