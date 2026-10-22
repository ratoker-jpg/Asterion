import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveCombat } from './resolver.ts';
import { createDefaultCombatPriority } from './priority.ts';
import { createDefaultCombatTechnologies } from './technologies.ts';
import type { CombatInput } from './simulator.ts';

const priorities = createDefaultCombatPriority();

/** The audit's seeded scenario: a Death Star kills the Phantom in the first phase. */
function input(seed: string, phantomLevel = 40): CombatInput {
  return {
    scenarioId: seed,
    timestamp: '2026-10-22T00:00:00Z',
    attacker: {
      participant: { playerId: 'a', playerName: 'A', side: 'attacker' },
      factionId: 'aegis',
      ships: [{ entityId: 'death-star', count: 1 }, { entityId: 'battleship', count: 100 }],
      commanders: [],
    },
    defender: {
      participant: { playerId: 'd', playerName: 'D', side: 'defender' },
      factionId: 'veyra',
      ships: [],
      commanders: (['corsair', 'hunter', 'executioner', 'juggernaut', 'phantom', 'scorpion', 'annihilator'] as const)
        .map((entityId) => ({ entityId, count: 1, level: entityId === 'phantom' ? phantomLevel : 1 })),
      activeCommanderId: 'phantom',
      defenses: [],
    },
    maxRounds: 5,
    attackerPriority: [...priorities.attack],
    defenderPriority: [...priorities.defense],
    attackerTechnologies: createDefaultCombatTechnologies(),
    defenderTechnologies: createDefaultCombatTechnologies(),
    technologyMode: 'independent',
    executionMode: 'calibration',
    seed,
  } as CombatInput;
}

const phantomCancels = <T extends { commanderAbilityId?: string; actionType?: string }>(events: readonly T[]) =>
  events.filter((event) => event.commanderAbilityId === 'phantom' && event.actionType === 'ability');

test('PH-01: the audit seed still cancels after the Phantom dies in the same phase, replayably', () => {
  const report = resolveCombat(input('phantom-dead-control-5'), { reportId: 'phantom-dead-control-5' });
  assert.deepEqual(resolveCombat(input('phantom-dead-control-5'), { reportId: 'phantom-dead-control-5' }), report);
  const events = report.rounds[0]!.events;
  const death = events.findIndex((event) => event.actionType === 'attack' && event.targetEntityId === 'phantom');
  const cancel = events.findIndex((event, index) => index > death && event.actionType === 'ability' && event.commanderAbilityId === 'phantom');
  assert.ok(death >= 0 && cancel > death);
  assert.equal(events[cancel]!.actorCount, 0);
});

test('PH-01 owner rule: a Phantom destroyed in round 1 keeps cancelling attacks in later rounds', () => {
  let battlesWithDeadPhantom = 0;
  let laterRoundCancels = 0;
  for (let n = 0; n < 60; n++) {
    const report = resolveCombat(input(`ph01-${n}`), { reportId: `ph01-${n}` });
    const deadAt = report.rounds.findIndex((round) => round.events.some((event) => event.actorEntityId === 'phantom' && event.actorCount === 0));
    if (deadAt < 0) continue;
    battlesWithDeadPhantom++;
    for (const round of report.rounds.slice(deadAt + 1)) {
      for (const event of phantomCancels(round.events)) {
        assert.equal(event.actorCount, 0, 'the cancelling Phantom is the destroyed one');
        laterRoundCancels++;
      }
    }
  }
  assert.ok(battlesWithDeadPhantom > 10, 'the scenario destroys the Phantom in most seeds');
  assert.ok(laterRoundCancels > 0, 'its aura still works after the round it died in');
});

test('PH-01: a level-0 Phantom never cancels, so the aura change touches nothing else', () => {
  for (let n = 0; n < 20; n++) {
    const report = resolveCombat(input(`ph01-${n}`, 0), { reportId: `ph01-l0-${n}` });
    assert.equal(report.rounds.flatMap((round) => phantomCancels(round.events)).length, 0);
  }
});
