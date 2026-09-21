import assert from 'node:assert/strict';
import test from 'node:test';

import { DEMO_BATTLE_REPORTS } from './battle-fixtures.ts';
import { BATTLE_MISSING_DATA, createBattleReportViewModel } from './battle-report-view-model.ts';

test('view model exposes losses, rewards, and every saved round snapshot', () => {
  const viewModel = createBattleReportViewModel(DEMO_BATTLE_REPORTS[0]);

  assert.equal(viewModel.rounds.length, 5);
  assert.equal(viewModel.rounds.every((round) => round.attackerSnapshot && round.defenderSnapshot), true);
  assert.equal(viewModel.attacker.losses.population, 247);
  assert.equal(viewModel.attacker.losses.ships, 71);
  assert.equal(viewModel.defender.losses.ships, 40);
  assert.equal(viewModel.defender.losses.defenses, 51);
  assert.equal(viewModel.experience, 84);
  assert.equal(viewModel.debris, 291_027);
  assert.equal(viewModel.debrisOnOrbit, 291_027);
  assert.deepEqual(viewModel.resources.map((resource) => resource.kind), ['metal', 'minerals', 'gas']);
  assert.deepEqual(viewModel.attacker.modifiers.map((modifier) => modifier.label), ['Построение', 'Командирский snapshot']);
});

test('view model derives stack losses from persisted counts when destroyed is missing', () => {
  const viewModel = createBattleReportViewModel({
    id: 'missing-destroyed',
    attacker: { playerName: 'Attacker', side: 'attacker', race: 'Астеры' },
    defender: { playerName: 'Defender', side: 'defender', race: 'Рой' },
    winner: 'attacker',
    attackerForce: {
      populationBefore: 10,
      populationAfter: 7,
      stacks: [
        { entityId: 'scout', countBefore: 4, countAfter: 1 },
        { entityId: 'cruiser', countBefore: 1, countAfter: 3 },
      ],
    },
    defenderForce: {
      stacks: [{ entityId: 'scout', countBefore: 1, countAfter: 0 }],
    },
    rounds: [],
  });

  assert.equal(viewModel.attacker.stacks[0]?.destroyed, 3);
  assert.equal(viewModel.attacker.stacks[1]?.destroyed, 0);
  assert.equal(viewModel.attacker.losses.ships, 3);
  assert.equal(viewModel.defender.stacks[0]?.destroyed, 1);
  assert.equal(viewModel.battlePoints.defenderResourcePointsLost, 2);
});

test('demo reports identify the current player and render Bot 01 with Veyra presentation', () => {
  const viewModel = createBattleReportViewModel(DEMO_BATTLE_REPORTS[0]);

  assert.equal(viewModel.attacker.participant.playerName, 'Dendrilion');
  assert.equal(viewModel.attacker.participant.coordinates, '[1:1:1]');
  assert.equal(viewModel.defender.participant.playerName, 'Бот 01');
  assert.equal(viewModel.defender.participant.coordinates, '[1:11:10]');
  assert.equal(viewModel.defender.participant.race, 'Рой');
  assert.equal(viewModel.defender.stacks.find((stack) => stack.entityId === 'defender')?.name, 'Панцирник');
  assert.equal(viewModel.defender.stacks.every((stack) => stack.assetSource === 'catalog'), true);
  assert.equal(viewModel.defender.defenses[0]?.name, 'Лазерная железа');
  assert.equal(viewModel.defender.defenses.every((stack) => stack.assetSource === 'catalog'), true);
});

test('demo reports render the same historical supported technology snapshot for both sides', () => {
  const viewModel = createBattleReportViewModel(DEMO_BATTLE_REPORTS[0]);
  const levels = (side: typeof viewModel.attacker) => side.technologies.map((technology) => [technology.id, technology.level, technology.bonusPercent]);

  assert.equal(viewModel.attacker.technologies.length, 10);
  assert.deepEqual(levels(viewModel.attacker), levels(viewModel.defender));
  assert.deepEqual(levels(viewModel.attacker), [
    ['laserScience', 12, 180],
    ['ionScience', 11, 165],
    ['plasmaScience', 10, 150],
    ['piercingAttack', 0, 0],
    ['lightArmor', 10, 10],
    ['mediumArmor', 10, 20],
    ['heavyArmor', 10, 30],
    ['shipArmor', 14, 140],
    ['maneuverDefense', 0, 0],
    ['criticalHit', 0, 0],
  ]);
  assert.equal(viewModel.attacker.technologies.some((technology) => technology.name === 'Усиленная атака'), false);
  assert.equal(viewModel.defender.technologies.some((technology) => technology.name === 'Лазерный удар'), false);
});

test('view model binds scene stacks to saved snapshots across rounds', () => {
  const viewModel = createBattleReportViewModel(DEMO_BATTLE_REPORTS[2]);
  const firstRound = viewModel.rounds.find((round) => round.index === 1);
  const secondRound = viewModel.rounds.find((round) => round.index === 2);

  assert.equal(firstRound?.attackerSnapshot?.stacks.some((stack) => stack.entityId === 'spy-probe' && stack.countAfter === 6), true);
  assert.equal(secondRound?.attackerSnapshot?.stacks.some((stack) => stack.entityId === 'spy-probe'), false);
  assert.equal(viewModel.attacker.stacks.find((stack) => stack.entityId === 'spy-probe')?.countAfter, 0);
});

test('view model derives round population from saved counts for older reports', () => {
  const viewModel = createBattleReportViewModel(DEMO_BATTLE_REPORTS[2]);
  const firstRound = viewModel.rounds.find((round) => round.index === 1);

  assert.deepEqual(
    {
      attackerBefore: firstRound?.attackerSnapshot?.fleetPopulationBefore,
      attackerAfter: firstRound?.attackerSnapshot?.fleetPopulationAfter,
      defenderBefore: firstRound?.defenderSnapshot?.fleetPopulationBefore,
      defenderAfter: firstRound?.defenderSnapshot?.fleetPopulationAfter,
    },
    { attackerBefore: 284, attackerAfter: 284, defenderBefore: 140, defenderAfter: 132 },
  );
});

test('view model resolves faction presentation and falls back safely for unknown data', () => {
  const factionReport = {
    ...DEMO_BATTLE_REPORTS[2],
    attacker: { ...DEMO_BATTLE_REPORTS[2].attacker, race: 'Илары' },
    attackerForce: {
      ...DEMO_BATTLE_REPORTS[2].attackerForce,
      stacks: [{ entityId: 'scout' as const, countBefore: 3, countAfter: 2, destroyed: 1 }],
    },
  };
  const factionViewModel = createBattleReportViewModel(factionReport);
  assert.equal(factionViewModel.attacker.stacks[0]?.name, 'Ланцет');
  assert.equal(factionViewModel.attacker.stacks[0]?.assetSource, 'catalog');

  const malformed = {
    id: 'malformed',
    rounds: [{ events: [{ actorEntityId: 'missing-actor', targetEntityId: 'missing-target', actionType: 'invalid' }] }],
    attackerForce: { stacks: [{ entityId: 'missing-ship', countBefore: 'bad', countAfter: -4, destroyed: 'bad' }] },
    defenderForce: {},
  };
  assert.doesNotThrow(() => createBattleReportViewModel(malformed));
  const malformedViewModel = createBattleReportViewModel(malformed);
  const missingStack = malformedViewModel.attacker.stacks[0];
  assert.equal(missingStack?.name, BATTLE_MISSING_DATA);
  assert.equal(missingStack?.assetSource, 'fallback');
  assert.equal(missingStack?.tooltip.attack, null);
  assert.equal(malformedViewModel.rounds[0]?.analysis.length, 1);
});

test('view model reads siege fields while legacy reports remain siege-free', () => {
  const legacy = createBattleReportViewModel(DEMO_BATTLE_REPORTS[0]);
  assert.equal(legacy.siege, null);
  const viewModel = createBattleReportViewModel({
    ...DEMO_BATTLE_REPORTS[0],
    siege: {
      version: 1,
      targetPlanetId: 'planet-siege',
      targetCoordinate: '1:2:3',
      attackerDestroyers: [{ factionId: 'aegis', entityId: 'death-star', survivors: 1, level: 10, scaledDemolitionPoints: 100, scaledDestructionChanceBps: 300, baseAttack: 700_000, baseLife: 2_100_000 }],
      defenderDestroyers: [],
      demolition: {
        status: 'resolved', rawPoints: 100, defenseReductionPoints: 0, finalPoints: 100, baseChanceBps: 2_000,
        annihilatorBonusBps: 0, eligibleBuildingCount: 1, selectedBuildingCount: 1, destroyedBuildingLevels: 1,
        rolls: [{ buildingId: 'construction', buildingName: 'Сборочный узел', beforeLevel: 2, afterLevel: 1, chanceBps: 2_000, roll: 0.1, success: true, canceledQueueItems: 1 }],
      },
      destruction: {
        status: 'blocked', blockedReason: 'LAST_COLONY_PROTECTED', rawChanceBps: 300, defenseReductionBps: 0,
        defenderDestroyerReductionBps: 0, poliasReductionBps: 0, finalChanceBps: 300, success: false, ownerPlanetCount: 1,
      },
      planetDestroyed: false,
    },
  });
  assert.equal(viewModel.siege?.targetCoordinate, '1:2:3');
  assert.equal(viewModel.siege?.demolition.rolls[0]?.success, true);
  assert.equal(viewModel.siege?.destruction.blockedReason, 'LAST_COLONY_PROTECTED');
});
