import assert from 'node:assert/strict';
import test from 'node:test';
import { createCanonicalStartingFleet } from '../fleet/runtime.ts';
import { createEmptyDefenseState } from '../fleet/production.ts';
import { calculateBattlePoints } from '../combat/battle-points.ts';
import { DEMO_BATTLE_REPORTS } from '../combat/battle-fixtures.ts';
import { getCombatFactionId } from '../combat/factions.ts';
import type { BattleReport } from '../combat/report.ts';
import { addUnrecoveredResourceCost, calculateResourceScore, recordBattleScoreAward } from './scoring.ts';
import { createDefaultRatingPrototypeState } from './fixtures.ts';

test('empty owner assets produce zero resource points', () => {
  assert.deepEqual(calculateResourceScore({ factionId: 'aegis', planets: [] }), {
    resourcePoints: 0,
    resourceTotal: 0,
  });
});

test('starter checkpoint counts M/M/G only and rounds the aggregate to nearest thousand', () => {
  const score = calculateResourceScore({
    factionId: 'aegis',
    planets: [{
      factionId: 'aegis',
      buildings: {
        'metal-production-1': 1,
        'mineral-production-1': 1,
        'gas-production-1': 1,
        'basic-energy': 3,
        hangar: 1,
      },
      fleet: createCanonicalStartingFleet('aegis'),
      defense: createEmptyDefenseState(),
    }],
  });

  assert.equal(score.resourceTotal, 147_652);
  assert.equal(score.resourcePoints, 148);
});

test('canceled queue ledger retains only the unrecovered M/M/G investment', () => {
  const initial = createDefaultRatingPrototypeState();
  const withSunkCost = addUnrecoveredResourceCost(
    initial,
    'player-current',
    { metal: 1_000, minerals: 200, gas: 200 },
    { metal: 500, minerals: 100, gas: 100 },
  );

  assert.deepEqual(withSunkCost.unrecoveredCostsByOwnerId['player-current'], {
    metal: 500,
    minerals: 100,
    gas: 100,
  });
  assert.deepEqual(calculateResourceScore({
    factionId: 'aegis',
    planets: [],
    unrecoveredCosts: withSunkCost.unrecoveredCostsByOwnerId['player-current'],
  }), { resourcePoints: 1, resourceTotal: 700 });
});

test('real battle awards are owner-specific, apply the winner multiplier, and are idempotent', () => {
  const source = DEMO_BATTLE_REPORTS[0]!;
  const report: BattleReport = {
    ...source,
    id: 'battle-real-rating-regression',
    missionType: 'attack',
    attacker: { ...source.attacker, playerId: 'player-current' },
    defender: { ...source.defender, playerId: 'npc-bot-01' },
    metadata: { ...source.metadata, source: 'imported' },
  };
  const initial = createDefaultRatingPrototypeState();
  const awarded = recordBattleScoreAward(initial, report, 'player-current');
  const byOwner = awarded.battleAwardsByReportId[report.id];
  assert.ok(byOwner);

  const toStacks = (stacks: readonly { entityId: string; countBefore: number; countAfter: number }[] | undefined) => (stacks ?? []).map((stack) => ({
    entityId: stack.entityId,
    countBefore: stack.countBefore,
    countAfter: stack.countAfter,
  }));
  const base = calculateBattlePoints(
    report.winner,
    toStacks(report.attackerForce.stacks),
    toStacks(report.defenderForce.stacks),
    toStacks(report.attackerForce.defenses),
    toStacks(report.defenderForce.defenses),
    getCombatFactionId(report.attacker.race),
    getCombatFactionId(report.defender.race),
  );
  assert.deepEqual(byOwner, {
    'player-current': base.attacker * (report.winner === 'attacker' ? 2 : 1),
    'npc-bot-01': base.defender * (report.winner === 'defender' ? 2 : 1),
  });
  assert.strictEqual(recordBattleScoreAward(awarded, report, 'player-current'), awarded);
});

test('simulator reports do not award persistent battle score', () => {
  const source = DEMO_BATTLE_REPORTS[0]!;
  const report: BattleReport = {
    ...source,
    id: 'battle-simulation-rating-regression',
    missionType: 'simulation',
    metadata: { ...source.metadata, source: 'imported' },
  };
  const initial = createDefaultRatingPrototypeState();

  assert.strictEqual(recordBattleScoreAward(initial, report, 'player-current'), initial);
});
