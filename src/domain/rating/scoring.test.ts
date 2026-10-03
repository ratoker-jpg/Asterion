import assert from 'node:assert/strict';
import test from 'node:test';
import { createCanonicalStartingFleet, createEmptyFleetState } from '../fleet/runtime.ts';
import { createDefaultFleetProductionState, createEmptyDefenseState, reconcileFleetProductionState, type FleetProductionState } from '../fleet/production.ts';
import { COMMANDER_COMBAT_CATALOG } from '../combat/catalog.ts';
import type { OwnedFleetState } from '../fleet/runtime.ts';
import { calculateBattlePoints } from '../combat/battle-points.ts';
import { DEMO_BATTLE_REPORTS } from '../combat/battle-fixtures.ts';
import { getCombatFactionId } from '../combat/factions.ts';
import type { BattleReport } from '../combat/report.ts';
import { addUnrecoveredResourceCost, calculateAwardedBattlePoints, calculateResourceScore, recordBattleScoreAward, selectRecordedBattlePointAwards } from './scoring.ts';
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

test('owned commanders and their saved production order retain the same value through completion', () => {
  const commander = COMMANDER_COMBAT_CATALOG.find((entity) => entity.id === 'corsair')!;
  const batchQuantity = 2;
  const order = {
    id: 'commander-score-queue',
    queueKind: 'commanders' as const,
    itemId: commander.id,
    quantity: batchQuantity,
    completedQuantity: 0,
    enqueuedAt: 100,
    startedAt: 100,
    finishAt: 2_100,
    effectiveDurationMs: 1_000,
    cost: {
      metal: commander.cost.metal * batchQuantity,
      minerals: commander.cost.minerals * batchQuantity,
      gas: commander.cost.gas * batchQuantity,
    },
    refundEligible: false,
  };
  const production = {
    ...createDefaultFleetProductionState(),
    commanderQueue: [order],
  };
  const emptyFleet = createEmptyFleetState();
  const emptyDefense = createEmptyDefenseState();
  const score = (fleet: OwnedFleetState, fleetProduction: FleetProductionState) => calculateResourceScore({
    factionId: 'aegis',
    planets: [{ factionId: 'aegis', buildings: {}, fleet, defense: emptyDefense, fleetProduction }],
  }).resourceTotal;

  const queuedScore = score(emptyFleet, production);
  const halfway = reconcileFleetProductionState(production, emptyFleet, emptyDefense, 'aegis', 1_100);
  const halfwayScore = score(halfway.fleet, halfway.state);
  const completed = reconcileFleetProductionState(halfway.state, halfway.fleet, halfway.defense, 'aegis', 2_100);
  const completedScore = score(completed.fleet, completed.state);

  assert.equal(queuedScore, resourceValueForCommander(commander) * batchQuantity);
  assert.equal(halfway.fleet.commanders.corsair, 1);
  assert.equal(halfwayScore, queuedScore);
  assert.equal(completed.fleet.commanders.corsair, 2);
  assert.equal(completed.state.commanderQueue.length, 0);
  assert.equal(completedScore, queuedScore);
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
    'player-current': calculateAwardedBattlePoints(report.winner, base).attacker,
    'npc-bot-01': calculateAwardedBattlePoints(report.winner, base).defender,
  });
  if (report.winner === 'attacker') {
    assert.equal(byOwner['player-current'], base.attacker * 2, 'the winning attacker receives the established ×2 award');
    assert.equal(byOwner['npc-bot-01'], base.defender, 'the losing defender keeps the base award');
  }
  assert.deepEqual(selectRecordedBattlePointAwards(awarded, report, 'player-current'), {
    attacker: byOwner['player-current'],
    defender: byOwner['npc-bot-01'],
  });
  assert.strictEqual(recordBattleScoreAward(awarded, report, 'player-current'), awarded);
});

test('partial award records leave the unrecorded participant neutral', () => {
  const source = DEMO_BATTLE_REPORTS[0]!;
  const report: BattleReport = {
    ...source,
    id: 'battle-partial-award-regression',
    attacker: { ...source.attacker, playerId: 'player-current' },
    defender: { ...source.defender, playerId: 'npc-bot-01' },
  };
  const rating = {
    ...createDefaultRatingPrototypeState(),
    battleAwardsByReportId: {
      [report.id]: { 'player-current': 0 },
    },
  };

  assert.deepEqual(selectRecordedBattlePointAwards(rating, report, 'player-current'), {
    attacker: 0,
    defender: null,
  });
});

test('defender victory doubles only the defender award; defeat remains base and repeat processing adds nothing', () => {
  const source = DEMO_BATTLE_REPORTS.find((candidate) => candidate.winner === 'defender')!;
  const report: BattleReport = {
    ...source,
    id: 'battle-defender-win-rating-regression',
    missionType: 'defense',
    attacker: { ...source.attacker, playerId: 'npc-bot-01' },
    defender: { ...source.defender, playerId: 'player-current' },
    metadata: { ...source.metadata, source: 'imported' },
  };
  const initial = createDefaultRatingPrototypeState();
  const awarded = recordBattleScoreAward(initial, report, 'player-current');
  const base = calculateBattlePoints(
    report.winner,
    report.attackerForce.stacks ?? [],
    report.defenderForce.stacks ?? [],
    report.attackerForce.defenses ?? [],
    report.defenderForce.defenses ?? [],
    getCombatFactionId(report.attacker.race),
    getCombatFactionId(report.defender.race),
  );
  const expected = calculateAwardedBattlePoints(report.winner, base);

  assert.deepEqual(awarded.battleAwardsByReportId[report.id], {
    'npc-bot-01': expected.attacker,
    'player-current': expected.defender,
  });
  assert.equal(expected.attacker, base.attacker, 'the losing attacker keeps the base award');
  assert.equal(expected.defender, base.defender * 2, 'the winning defender receives the established ×2 award');
  assert.strictEqual(recordBattleScoreAward(awarded, report, 'player-current'), awarded);
});

function resourceValueForCommander(commander: (typeof COMMANDER_COMBAT_CATALOG)[number]) {
  return commander.cost.metal + commander.cost.minerals + commander.cost.gas;
}

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
