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
  assert.deepEqual(viewModel.resources.map((resource) => resource.kind), ['metal', 'minerals', 'gas']);
  assert.deepEqual(viewModel.attacker.modifiers.map((modifier) => modifier.label), ['Построение', 'Командирский snapshot']);
});

test('view model binds scene stacks to saved snapshots across rounds', () => {
  const viewModel = createBattleReportViewModel(DEMO_BATTLE_REPORTS[2]);
  const firstRound = viewModel.rounds.find((round) => round.index === 1);
  const secondRound = viewModel.rounds.find((round) => round.index === 2);

  assert.equal(firstRound?.attackerSnapshot?.stacks.some((stack) => stack.entityId === 'spy-probe' && stack.countAfter === 6), true);
  assert.equal(secondRound?.attackerSnapshot?.stacks.some((stack) => stack.entityId === 'spy-probe'), false);
  assert.equal(viewModel.attacker.stacks.find((stack) => stack.entityId === 'spy-probe')?.countAfter, 0);
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
