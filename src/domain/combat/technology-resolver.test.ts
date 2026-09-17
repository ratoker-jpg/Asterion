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

test('production resolver applies documented science independently to both sides', () => {
  const baseline = resolveCombat(makeInput(), { reportId: 'baseline' });
  const configured = resolveCombat(makeInput({
    attackerTechnologies: normalizeCombatTechnologies({
      laserScience: 12,
    }),
    defenderTechnologies: normalizeCombatTechnologies({
      mediumArmor: 9,
      shipArmor: 10,
    }),
  }), { reportId: 'configured' });

  const baselineAttack = baseline.rounds[0]?.events.find((event) => event.actorSide === 'attacker');
  const configuredAttack = configured.rounds[0]?.events.find((event) => event.actorSide === 'attacker');
  assert.ok(baselineAttack);
  assert.ok(configuredAttack);
  assert.equal(configuredAttack.attackValue, 2_240);
  assert.notEqual(configuredAttack.damage, baselineAttack.damage);
  assert.equal(configuredAttack.lifeBefore, 54_000);
  assert.equal(configuredAttack.armorBefore, 24);
});

test('calibration resolver applies only the documented inferred curves', () => {
  const baseline = resolveCombat(makeInput({ executionMode: 'calibration' }), { reportId: 'baseline-calibration' });
  const configured = resolveCombat(makeInput({
    executionMode: 'calibration',
    attackerTechnologies: normalizeCombatTechnologies({ laserScience: 4 }),
    defenderTechnologies: normalizeCombatTechnologies({ shipArmor: 5 }),
  }), { reportId: 'configured-calibration' });
  const baselineAttack = baseline.rounds[0]?.events.find((event) => event.actorSide === 'attacker');
  const configuredAttack = configured.rounds[0]?.events.find((event) => event.actorSide === 'attacker');
  assert.ok(baselineAttack);
  assert.ok(configuredAttack);
  assert.equal(configuredAttack.attackValue, baselineAttack.attackValue! * 1.6);
  assert.equal(configured.metadata?.executionMode, 'calibration');
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
