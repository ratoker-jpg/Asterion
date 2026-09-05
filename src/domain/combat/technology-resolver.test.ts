import assert from 'node:assert/strict';
import test from 'node:test';

import { createDefaultCombatPriority } from './priority.ts';
import { resolveCombat } from './resolver.ts';
import { validateCombatInput, type CombatInput } from './simulator.ts';
import { normalizeCombatTechnologies } from './technologies.ts';

const priority = createDefaultCombatPriority();
const attackerParticipant = { playerName: 'A', side: 'attacker' as const };
const defenderParticipant = { playerName: 'D', side: 'defender' as const };

function makeInput(overrides: Partial<CombatInput> = {}): CombatInput {
  return {
    scenarioId: 'technology-test',
    timestamp: '2026-09-05T00:00:00.000Z',
    attacker: { participant: attackerParticipant, ships: [{ entityId: 'scout', count: 1 }], commanders: [] },
    defender: { participant: defenderParticipant, ships: [{ entityId: 'battleship', count: 1 }], commanders: [], defenses: [] },
    maxRounds: 5,
    attackerPriority: [...priority.attack],
    defenderPriority: [...priority.defense],
    ...overrides,
  };
}

test('resolver applies weapon science and force attack to raw attack value', () => {
  const report = resolveCombat(makeInput({
    attackerTechnologies: normalizeCombatTechnologies({ laserScience: 2, forceAttack: 3 }),
  }), { reportId: 'attack-science' });

  const attack = report.rounds[0]?.events.find((event) => event.actorSide === 'attacker');
  assert.ok(attack);
  assert.ok(Math.abs((attack.attackValue ?? 0) - 1160) < 1e-9);
});

test('resolver applies armor science before damage reduction', () => {
  const withoutArmor = resolveCombat(makeInput(), { reportId: 'without-armor' });
  const withArmor = resolveCombat(makeInput({
    defenderTechnologies: normalizeCombatTechnologies({ mediumArmor: 5 }),
  }), { reportId: 'with-armor' });

  const baseDamage = withoutArmor.rounds[0]?.events.find((event) => event.actorSide === 'attacker')?.damage ?? 0;
  const armoredDamage = withArmor.rounds[0]?.events.find((event) => event.actorSide === 'attacker')?.damage ?? 0;
  assert.ok(armoredDamage < baseDamage);
});

test('resolver applies ship defense and prompt defense to runtime life', () => {
  const withoutLifeScience = resolveCombat(makeInput({
    attacker: { participant: attackerParticipant, ships: [{ entityId: 'spy-probe', count: 1 }], commanders: [] },
    defender: { participant: defenderParticipant, ships: [{ entityId: 'scout', count: 1 }], commanders: [], defenses: [] },
  }), { reportId: 'without-life' });
  const withLifeScience = resolveCombat(makeInput({
    attacker: { participant: attackerParticipant, ships: [{ entityId: 'spy-probe', count: 1 }], commanders: [] },
    defender: { participant: defenderParticipant, ships: [{ entityId: 'scout', count: 1 }], commanders: [], defenses: [] },
    defenderTechnologies: normalizeCombatTechnologies({ shipDefense: 5, promptDefense: 2 }),
  }), { reportId: 'with-life' });

  const baseLifeBefore = withoutLifeScience.rounds[0]?.events.find((event) => event.targetSide === 'defender')?.lifeBefore ?? 0;
  const boostedLifeBefore = withLifeScience.rounds[0]?.events.find((event) => event.targetSide === 'defender')?.lifeBefore ?? 0;
  assert.ok(boostedLifeBefore > baseLifeBefore);
});

test('validator reports malformed attacker defense stacks instead of silently discarding them', () => {
  const value = makeInput({
    attacker: {
      participant: attackerParticipant,
      ships: [{ entityId: 'scout', count: 1 }],
      commanders: [],
      defenses: [{ entityId: 'laser-turret', count: -1 }],
    },
  });
  const checked = validateCombatInput(value);
  assert.equal(checked.errors.some((error) => error.code === 'invalid-count' && error.path.startsWith('attacker.defenses')), true);
  assert.equal(checked.errors.some((error) => error.code === 'attacker-defense'), true);
});
