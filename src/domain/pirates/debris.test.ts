import assert from 'node:assert/strict';
import test from 'node:test';

import { calculateAttackDebris } from '../../application/attack.ts';
import { getFactionCombatEntity } from '../combat/faction-catalog.ts';
import type { BattleForceSnapshot, BattleReport } from '../combat/report.ts';
import { PIRATE_CATALOG_BY_ID } from './catalog.ts';
import { calculatePirateForceDebris, pirateDebrisShare } from './debris.ts';

function force(stacks: readonly Record<string, unknown>[]): BattleForceSnapshot {
  return { stacks, defenses: [], populationBefore: 0, populationAfter: 0 } as unknown as BattleForceSnapshot;
}

function report(attackerForce: BattleForceSnapshot, defenderForce: BattleForceSnapshot, missionType: BattleReport['missionType'] = 'attack'): BattleReport {
  return { attackerForce, defenderForce, missionType } as unknown as BattleReport;
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
  const pirateCost = PIRATE_CATALOG_BY_ID['pirate-hound'].cost;
  const expected = Math.floor(pirateCost.metal * 0.8) + Math.floor(pirateCost.minerals * 0.8);
  assert.equal(calculatePirateForceDebris(pirateLosses, corsairFleet, 'pirate-elimination'), expected);
  assert.equal(calculateAttackDebris(report(corsairFleet, pirateLosses, 'pirate-elimination'), 'aegis', 'aegis'), expected);
  assert.equal(calculateAttackDebris(report(pirateLosses, corsairFleet, 'pirate-raid'), 'aegis', 'aegis'), expected);
});

test('dead or absent Commander Corsair leaves pirate debris at 60%, while player losses stay at 30%', () => {
  const deadCorsair = force([{ entityId: 'corsair', countBefore: 1, countAfter: 0, destroyed: 1, level: 40 }]);
  const pirateLosses = force([{ entityId: 'pirate-hound', countBefore: 1, countAfter: 0, destroyed: 1 }]);
  const pirateCost = PIRATE_CATALOG_BY_ID['pirate-hound'].cost;
  const corsairCost = getFactionCombatEntity('aegis', 'corsair').cost;
  const expected = Math.floor(pirateCost.metal * 0.6) + Math.floor(pirateCost.minerals * 0.6)
    + Math.floor(corsairCost.metal * 0.3) + Math.floor(corsairCost.minerals * 0.3);
  assert.equal(calculateAttackDebris(report(deadCorsair, pirateLosses, 'pirate-raid'), 'aegis', 'aegis'), expected);
  assert.equal(calculatePirateForceDebris(pirateLosses, force([]), 'pirate-raid'), Math.floor(pirateCost.metal * 0.6) + Math.floor(pirateCost.minerals * 0.6));
});

test('pirate losses outside explicit pirate PvE missions use the ordinary 30% debris share', () => {
  const corsairFleet = force([{ entityId: 'corsair', countBefore: 1, countAfter: 1, destroyed: 0, level: 40 }]);
  const pirateLosses = force([{ entityId: 'pirate-hound', countBefore: 1, countAfter: 0, destroyed: 1 }]);
  const pirateCost = PIRATE_CATALOG_BY_ID['pirate-hound'].cost;
  const expected = Math.floor(pirateCost.metal * 0.3) + Math.floor(pirateCost.minerals * 0.3);

  assert.equal(calculatePirateForceDebris(pirateLosses, corsairFleet, 'attack'), expected);
  assert.equal(calculateAttackDebris(report(corsairFleet, pirateLosses, 'attack'), 'aegis', 'aegis'), expected);
});
