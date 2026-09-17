import { createDefaultCombatPriority } from './priority.ts';
import { resolveCombat } from './resolver.ts';
import type { BattleReport } from './report.ts';
import type { CombatInput } from './simulator.ts';

const priority = createDefaultCombatPriority();
const attacker = { playerId: 'golden-attacker', playerName: 'Golden attacker', side: 'attacker' as const };
const defender = { playerId: 'golden-defender', playerName: 'Golden defender', side: 'defender' as const };

function fixtureInput(
  attackerShips: CombatInput['attacker']['ships'],
  defenderShips: CombatInput['defender']['ships'],
  seed: string,
  maxRounds: CombatInput['maxRounds'] = 5,
  commanders: {
    attacker?: CombatInput['attacker']['commanders'];
    defender?: CombatInput['defender']['commanders'];
  } = {},
): CombatInput {
  return {
    scenarioId: `golden-${seed}`,
    timestamp: '2026-09-16T00:00:00.000Z',
    attacker: { participant: attacker, ships: attackerShips, commanders: commanders.attacker ?? [] },
    defender: { participant: defender, ships: defenderShips, commanders: commanders.defender ?? [], defenses: [] },
    maxRounds,
    attackerPriority: [...priority.attack],
    defenderPriority: [...priority.defense],
    executionMode: 'production',
    technologyMode: 'independent',
    seed,
  };
}

export const COMBAT_GOLDEN_FIXTURES: Readonly<Record<'victory' | 'defeat' | 'draw', BattleReport>> = {
  victory: resolveCombat(
    fixtureInput([{ entityId: 'death-star', count: 1 }], [{ entityId: 'scout', count: 1 }], 'golden-victory'),
    { reportId: 'golden-victory' },
  ),
  defeat: resolveCombat(
    fixtureInput([{ entityId: 'scout', count: 1 }], [{ entityId: 'death-star', count: 1 }], 'golden-defeat'),
    { reportId: 'golden-defeat' },
  ),
  draw: resolveCombat(
    fixtureInput([], [], 'golden-draw', 5, { attacker: [{ entityId: 'corsair', count: 1 }], defender: [{ entityId: 'corsair', count: 1 }] }),
    { reportId: 'golden-draw' },
  ),
};
