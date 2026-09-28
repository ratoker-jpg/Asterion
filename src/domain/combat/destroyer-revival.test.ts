import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveCombat } from './resolver.ts';
import { createDefaultCombatPriority } from './priority.ts';
import { createBattleReportViewModel } from './battle-report-view-model.ts';
import type { CombatInput } from './simulator.ts';
import { NEMEXIA_DESTROYER_REVIVAL_FIXTURES } from './source-fixtures/nemexia-destroyer-revival.ts';

const attacker = { playerId: 'revival-attacker', playerName: 'Attacker', side: 'attacker' as const };
const defender = { playerId: 'revival-defender', playerName: 'Defender', side: 'defender' as const };

function revivalInput(factionId: 'aegis' | 'synod' | 'veyra', seed: string, destroyers = 100): CombatInput {
  const bombers = destroyers >= 500 ? 800 : 1_000;
  const priority = createDefaultCombatPriority();
  return {
    scenarioId: `revival-${factionId}-${seed}`,
    timestamp: '2026-09-28T12:00:00.000Z',
    seed,
    maxRounds: 5,
    attackerPriority: [...priority.attack],
    defenderPriority: [...priority.defense],
    attacker: {
      participant: attacker,
      factionId: 'aegis',
      ships: [{ entityId: 'scout', count: 1_000 }],
      commanders: [],
    },
    defender: {
      participant: defender,
      factionId,
      ships: [
        ...(destroyers > 0 ? [{ entityId: 'destroyer' as const, count: destroyers }] : []),
        { entityId: 'bomber', count: bombers },
      ],
      commanders: [],
      defenses: [],
    },
  };
}

function findRevivalReport(
  factionId: 'aegis' | 'synod' | 'veyra',
  destroyers: number,
  maximumSeeds = 256,
) {
  for (let index = 0; index < maximumSeeds; index += 1) {
    const seed = `destroyer-revival-${factionId}-${destroyers}-${index}`;
    const report = resolveCombat(revivalInput(factionId, seed, destroyers), { reportId: seed });
    const revival = report.rounds.flatMap((round) => round.events).find((event) => event.shipAbilityId === 'destroyer-revival');
    if (revival) return { report, revival };
  }
  assert.fail(`No Destroyer Revival event appeared for ${factionId} with ${destroyers} Destroyers in ${maximumSeeds} seeded attempts`);
}

test('Aegis Destroyer Revival matches archived current-round loss amount and runs after both combat phases', () => {
  const fixture = NEMEXIA_DESTROYER_REVIVAL_FIXTURES;
  assert.equal(fixture.corpus.nonReanimatorRepairEntries, 641);
  assert.equal(fixture.corpus.nonReanimatorEntriesMatchingRoundedAmountFormula, 641);
  assert.equal(fixture.corpus.unparsedRepairEntries, 0);

  const { report, revival } = findRevivalReport('aegis', 100);
  const revivalRound = report.rounds.find((round) => round.events.some((event) => event.sequence === revival.sequence));
  assert.ok(revivalRound, 'the Revival event belongs to a resolved combat round');
  const targetLosses = revivalRound.events
    .filter((event) => event.actionType === 'attack'
      && event.targetSide === revival.actorSide
      && event.targetEntityId === revival.targetEntityId)
    .reduce((total, event) => total + (event.destroyedCount ?? 0), 0);
  const postRoundDestroyers = revivalRound.defenderSnapshot?.stacks
    .find((stack) => stack.entityId === 'destroyer')?.countAfter;

  assert.ok(postRoundDestroyers && postRoundDestroyers > 0);
  assert.equal(revival.abilityChance, Math.min(0.7, postRoundDestroyers * 0.0014));
  assert.equal(revival.abilityBonus, Math.min(0.4, postRoundDestroyers * 0.0008));
  assert.equal(revival.repairedCount, Math.min(targetLosses, Math.floor(targetLosses * (revival.abilityBonus ?? 0) + 0.5)));
  assert.equal(revival.provenance?.status, 'inferred', 'the exact Nemexia RNG roll granularity remains undocumented');
  assert.equal(revival.commanderAbilityId, undefined, 'ship Revival remains separate from commander Reanimator');
  const viewModelEvent = createBattleReportViewModel(report).rounds.find((round) => round.roundNumber === revivalRound.roundNumber)?.events
    .find((event) => event.sequence === revival.sequence);
  assert.equal(viewModelEvent?.shipAbilityId, 'destroyer-revival');
  assert.equal(viewModelEvent?.shipAbility, 'Восстановление разрушителей (Destroyer Revival)');

  const roundEvents = revivalRound.events;
  const revivalIndex = roundEvents.findIndex((event) => event.shipAbilityId === 'destroyer-revival');
  assert.ok(revivalIndex > Math.max(...roundEvents.map((event, index) => event.actionType === 'attack' ? index : -1)));
});

test('only Aegis with functioning Destroyers receives Revival, and source caps are applied', () => {
  const { revival: capped } = findRevivalReport('aegis', 500);
  assert.equal(capped.abilityChance, 0.7);
  assert.equal(capped.abilityBonus, 0.4);

  for (const factionId of ['synod', 'veyra'] as const) {
    const report = resolveCombat(revivalInput(factionId, `no-revival-${factionId}`, 100), { reportId: `no-revival-${factionId}` });
    assert.equal(report.rounds.flatMap((round) => round.events).some((event) => event.shipAbilityId === 'destroyer-revival'), false);
  }

  const noDestroyers = resolveCombat(revivalInput('aegis', 'no-destroyers', 0), { reportId: 'no-destroyers' });
  assert.equal(noDestroyers.rounds.flatMap((round) => round.events).some((event) => event.shipAbilityId === 'destroyer-revival'), false);
});
