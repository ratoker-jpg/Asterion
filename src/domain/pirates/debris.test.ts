import assert from 'node:assert/strict';
import test from 'node:test';

import { calculateAttackDebris } from '../../application/attack.ts';
import { getFactionCombatEntity } from '../combat/faction-catalog.ts';
import type { BattleForceSnapshot, BattleReport } from '../combat/report.ts';
import { battleDebrisRoll } from '../combat/debris.ts';
import { PIRATE_CATALOG_BY_ID } from './catalog.ts';
import { calculatePirateForceDebris, pirateDebrisShare, PIRATE_ORDINARY_DEBRIS_SHARE } from './debris.ts';

function force(stacks: readonly Record<string, unknown>[]): BattleForceSnapshot {
  return { stacks, defenses: [], populationBefore: 0, populationAfter: 0 } as unknown as BattleForceSnapshot;
}

function report(attackerForce: BattleForceSnapshot, defenderForce: BattleForceSnapshot, missionType: BattleReport['missionType'] = 'attack'): BattleReport {
  return { id: 'pirate-debris-fixture', attackerForce, defenderForce, missionType } as unknown as BattleReport;
}

const ROLL = battleDebrisRoll('pirate-debris-fixture');
const HOUND_LIFE = PIRATE_CATALOG_BY_ID['pirate-hound'].combat.life;

function pirateDebris(life: number, share: number) {
  return Math.floor(ROLL * life * (share / PIRATE_ORDINARY_DEBRIS_SHARE));
}

test('Commander Corsair salvage is 60% base and grows by 0.5 points per surviving level to 80%', () => {
  assert.equal(pirateDebrisShare(), 0.6);
  assert.equal(pirateDebrisShare({ participated: false, survived: true, level: 40 }), 0.6);
  assert.equal(pirateDebrisShare({ participated: true, survived: false, level: 40 }), 0.6);
  assert.equal(pirateDebrisShare({ participated: true, survived: true, level: 0 }), 0.6);
  assert.equal(pirateDebrisShare({ participated: true, survived: true, level: 40 }), 0.8);
  assert.equal(pirateDebrisShare({ participated: true, survived: true, level: 99 }), 0.8);
});

test('surviving participating Commander Corsair boosts only pirate losses and need not be the lead commander', () => {
  const corsairFleet = force([{ entityId: 'corsair', countBefore: 1, countAfter: 1, destroyed: 0, level: 40 }]);
  const pirateLosses = force([{ entityId: 'pirate-hound', countBefore: 1, countAfter: 0, destroyed: 1 }]);
  const expected = pirateDebris(HOUND_LIFE, 0.8);
  assert.equal(calculatePirateForceDebris(pirateLosses, corsairFleet, 'pirate-elimination', ROLL), expected);
  assert.equal(calculateAttackDebris(report(corsairFleet, pirateLosses, 'pirate-elimination'), 'aegis', 'aegis'), expected);
  assert.equal(calculateAttackDebris(report(pirateLosses, corsairFleet, 'pirate-raid'), 'aegis', 'aegis'), expected);
});

test('dead or absent Commander Corsair leaves pirate debris at x2 of the base, while player losses use the base', () => {
  const deadCorsair = force([{ entityId: 'corsair', countBefore: 1, countAfter: 0, destroyed: 1, level: 40 }]);
  const pirateLosses = force([{ entityId: 'pirate-hound', countBefore: 1, countAfter: 0, destroyed: 1 }]);
  const corsairLife = getFactionCombatEntity('aegis', 'corsair').combat.life;
  const expected = pirateDebris(HOUND_LIFE, 0.6) + Math.floor(ROLL * corsairLife);
  assert.equal(calculateAttackDebris(report(deadCorsair, pirateLosses, 'pirate-raid'), 'aegis', 'aegis'), expected);
  assert.equal(calculatePirateForceDebris(pirateLosses, force([]), 'pirate-raid', ROLL), pirateDebris(HOUND_LIFE, 0.6));
});

test('pirate losses outside explicit pirate PvE missions use the ordinary base', () => {
  const corsairFleet = force([{ entityId: 'corsair', countBefore: 1, countAfter: 1, destroyed: 0, level: 40 }]);
  const pirateLosses = force([{ entityId: 'pirate-hound', countBefore: 1, countAfter: 0, destroyed: 1 }]);
  const expected = Math.floor(ROLL * HOUND_LIFE);

  assert.equal(calculatePirateForceDebris(pirateLosses, corsairFleet, 'attack', ROLL), expected);
  assert.equal(calculateAttackDebris(report(corsairFleet, pirateLosses, 'attack'), 'aegis', 'aegis'), expected);
});

test('the pirate share ratio keeps PvE wreckage proportional to the ordinary base for any roll', () => {
  const pirateLosses = force([{ entityId: 'pirate-executioner', countBefore: 10, countAfter: 0, destroyed: 10 }]);
  const life = PIRATE_CATALOG_BY_ID['pirate-executioner'].combat.life * 10;
  for (const roll of [0.25, 0.3, 0.3499]) {
    const ordinary = calculatePirateForceDebris(pirateLosses, force([]), 'attack', roll);
    const pve = calculatePirateForceDebris(pirateLosses, force([]), 'pirate-elimination', roll);
    assert.equal(ordinary, Math.floor(roll * life));
    assert.equal(pve, Math.floor(roll * life * (0.6 / PIRATE_ORDINARY_DEBRIS_SHARE)));
  }
});

test('pirate elimination: own debris = total - pirate part stays exact because both use one roll', () => {
  const ownLosses = force([
    { entityId: 'scout', countBefore: 5, countAfter: 2, destroyed: 3 },
    { entityId: 'corsair', countBefore: 1, countAfter: 1, destroyed: 0, level: 10 },
  ]);
  const pirateLosses = force([{ entityId: 'pirate-raider', countBefore: 4, countAfter: 0, destroyed: 4 }]);
  const fixture = report(ownLosses, pirateLosses, 'pirate-elimination');
  const total = calculateAttackDebris(fixture, 'aegis', 'aegis', ROLL);
  const pirate = calculatePirateForceDebris(pirateLosses, ownLosses, 'pirate-elimination', ROLL);
  assert.equal(total - pirate, Math.floor(ROLL * getFactionCombatEntity('aegis', 'scout').combat.life * 3));
});
