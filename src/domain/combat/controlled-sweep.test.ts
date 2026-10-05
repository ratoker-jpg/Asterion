import assert from 'node:assert/strict';
import test from 'node:test';

import { calculateAttackDebris, calculateAttackLoot } from '../../application/attack.ts';
import { claimDefensiveBattleRepair, createDefaultRepairWorkshopState } from '../repair/workshop.ts';
import type { BattleReport } from './report.ts';
import { resolveCombat } from './resolver.ts';
import {
  createDefaultCombatTechnologies,
  type CombatTechnologyLevels,
} from './technologies.ts';
import type { CombatInput, CombatStackInput, SimulatorMaxRounds } from './simulator.ts';

const COUNTS = [1, 10, 100, 1_000, 3_000, 25_080] as const;
const ROUND_LIMITS = [5, 8, 12] as const satisfies readonly SimulatorMaxRounds[];
const COMMANDERS = [null, 'hunter', 'juggernaut', 'reanimator'] as const;
const DEFENSES = ['none', 'defense', 'shields'] as const;
const COMPOSITIONS = ['combat-only', 'combat+transports', 'combat+utility'] as const;

type SweepCommander = (typeof COMMANDERS)[number];
type SweepDefense = (typeof DEFENSES)[number];
type SweepComposition = (typeof COMPOSITIONS)[number];

const attackerParticipant = { playerId: 'sweep-attacker', playerName: 'Sweep attacker', side: 'attacker' as const };
const defenderParticipant = { playerId: 'sweep-defender', playerName: 'Sweep defender', side: 'defender' as const };

function technologies(upgraded: boolean): CombatTechnologyLevels {
  const result = createDefaultCombatTechnologies();
  if (upgraded) {
    result.laserScience = 3;
    result.shipArmor = 3;
    result.lightArmor = 2;
  }
  return result;
}

function attackerShips(count: number, composition: SweepComposition, level: number): CombatStackInput[] {
  const ships: CombatStackInput[] = [{ entityId: 'scout', count, level }];
  if (composition === 'combat+transports') ships.push({ entityId: 'transporter', count: 1, level });
  if (composition === 'combat+utility') {
    ships.push(
      { entityId: 'mega-transporter', count: 1, level },
      { entityId: 'recycler', count: 1, level },
      { entityId: 'colonizer', count: 1, level },
    );
  }
  return ships;
}

function attackerCommander(commander: SweepCommander): CombatStackInput[] {
  if (!commander) return [];
  return [{ entityId: commander, count: 1, level: commander === 'hunter' ? 20 : 40 }];
}

function defenderDefenses(defense: SweepDefense): CombatStackInput[] {
  if (defense === 'defense') return [{ entityId: 'laser-turret', count: 2 }];
  if (defense === 'shields') return [{ entityId: 'tower-shield', count: 1 }, { entityId: 'planetary-shield', count: 1 }];
  return [];
}

function sweepInput(
  count: number,
  maxRounds: SimulatorMaxRounds,
  commander: SweepCommander,
  defense: SweepDefense,
  composition: SweepComposition,
  upgraded: boolean,
  seed: string,
): CombatInput {
  const profile = technologies(upgraded);
  return {
    scenarioId: `controlled-${seed}`,
    timestamp: '2026-09-21T00:00:00.000Z',
    attacker: {
      participant: attackerParticipant,
      factionId: 'aegis',
      ships: attackerShips(count, composition, upgraded ? 10 : 0),
      commanders: attackerCommander(commander),
      activeCommanderId: commander,
    },
    defender: {
      participant: defenderParticipant,
      factionId: 'aegis',
      ships: [{ entityId: 'cruiser', count: 10, level: upgraded ? 10 : 0 }],
      commanders: [],
      defenses: defenderDefenses(defense),
    },
    maxRounds,
    attackerPriority: commander ? [commander] : [],
    defenderPriority: [],
    attackerTechnologies: profile,
    defenderTechnologies: profile,
    technologyMode: 'independent',
    executionMode: 'production',
    seed,
  };
}

function forceStacks(report: BattleReport, side: 'attacker' | 'defender') {
  const force = side === 'attacker' ? report.attackerForce : report.defenderForce;
  return [...force.stacks, ...(force.defenses ?? [])];
}

function assertReportInvariants(report: BattleReport, maxRounds: SimulatorMaxRounds) {
  assert.ok(report.roundCount >= 0 && report.roundCount <= maxRounds);
  assert.ok(report.rounds.length <= maxRounds);
  assert.ok(report.winner === 'attacker' || report.winner === 'defender' || report.winner === 'draw');
  assert.equal(report.resources, undefined, 'resolver must not materialize attack loot');
  assert.equal(report.debris, undefined, 'resolver must not materialize orbit debris');
  assert.equal(report.repairEligibility, undefined, 'resolver must not claim defender repair');

  for (const side of ['attacker', 'defender'] as const) {
    const force = side === 'attacker' ? report.attackerForce : report.defenderForce;
    assert.ok(force.populationBefore >= 0 && force.populationAfter >= 0);
    for (const stack of forceStacks(report, side)) {
      assert.ok(stack.countBefore >= 0 && stack.countAfter >= 0 && stack.destroyed >= 0);
      assert.equal(stack.destroyed, stack.countBefore - stack.countAfter);
      assert.ok(stack.countAfter <= stack.countBefore);
    }
  }

  const loot = calculateAttackLoot(report, { metal: 1_000_000, minerals: 1_000_000, gas: 1_000_000 }, 'aegis');
  assert.ok(loot.metal >= 0 && loot.minerals >= 0 && loot.gas >= 0 && loot.debris >= 0);
  if (report.winner !== 'attacker') assert.deepEqual(loot, { metal: 0, minerals: 0, gas: 0, debris: 0 });
  assert.ok(calculateAttackDebris(report, 'aegis', 'aegis') >= 0);

  const repair = claimDefensiveBattleRepair(createDefaultRepairWorkshopState(), report, { allowAttackDefender: true });
  assert.ok(Object.values(repair.state.ships).every((count) => count >= 0));
  assert.ok(Object.values(repair.state.defenses).every((count) => count >= 0));
}

function attackerDamage(report: BattleReport) {
  return report.rounds
    .flatMap((round) => round.events)
    .filter((event) => event.actorSide === 'attacker' && event.targetSide === 'defender')
    .reduce((total, event) => total + Math.max(0, event.damage ?? 0), 0);
}

test('controlled combat sweep preserves scaling, target tiers, outcomes, loot/debris/repair boundaries, and replay identity', () => {
  const baselineDamage: number[] = [];

  for (const count of COUNTS) {
    const baseline = sweepInput(count, 12, null, 'none', 'combat-only', false, 'controlled-baseline');
    const baselineReport = resolveCombat(baseline, {
      reportId: `controlled-baseline-${count}`,
      allowPopulationOverflow: true,
    });
    baselineDamage.push(attackerDamage(baselineReport));
  }
  for (let index = 1; index < baselineDamage.length; index += 1) {
    assert.ok(baselineDamage[index] >= baselineDamage[index - 1], `damage decreased at count ${COUNTS[index]}`);
  }

  let cases = 0;
  for (const count of COUNTS) {
    for (const maxRounds of ROUND_LIMITS) {
      for (const commander of COMMANDERS) {
        for (const defense of DEFENSES) {
          for (const composition of COMPOSITIONS) {
            for (const upgraded of [false, true]) {
              const seed = `${count}-${maxRounds}-${commander ?? 'none'}-${defense}-${composition}-${upgraded ? 'upgraded' : 'base'}`;
              const value = sweepInput(count, maxRounds, commander, defense, composition, upgraded, seed);
              const context = { reportId: `controlled-${seed}`, allowPopulationOverflow: true } as const;
              const report = resolveCombat(value, context);
              const replay = resolveCombat(value, context);
              assert.deepEqual(replay, report, seed);
              assertReportInvariants(report, maxRounds);
              cases += 1;
            }
          }
        }
      }
    }
  }
  assert.equal(cases, COUNTS.length * ROUND_LIMITS.length * COMMANDERS.length * DEFENSES.length * COMPOSITIONS.length * 2);
});
