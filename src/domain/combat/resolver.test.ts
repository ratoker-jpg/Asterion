import assert from 'node:assert/strict';
import test from 'node:test';

import { DEMO_BATTLE_REPORTS } from './battle-fixtures.ts';
import {
  addBattleReportSaved,
  createDefaultBattleHistory,
  persistBattleHistory,
  readBattleHistory,
} from './battle-repository.ts';
import { COMMANDER_IDS, type CommanderId } from './commanders.ts';
import { resolveCombat, calculateEffectiveDamage, selectCombatTarget } from './resolver.ts';
import { NEMEXIA_COMBAT_ROUND_PARITY_FIXTURE } from './source-fixtures/combat-round-a5449dc74a9b.ts';
import { NEMEXIA_COUNTERFIRE_FIXTURES } from './source-fixtures/nemexia-counterfire.ts';
import { NEMEXIA_REPAIR_TIMING_FIXTURES } from './source-fixtures/nemexia-repair-timing.ts';
import { NEMEXIA_TARGET_TRANSITION_AUDIT } from './source-fixtures/nemexia-target-transitions.ts';
import {
  createDefaultSimulatorState,
  deleteSimulatorPreset,
  migrateSimulatorState,
  persistSimulatorState,
  readSimulatorState,
  upsertSimulatorPreset,
  withLastScenario,
} from './simulator-repository.ts';
import {
  createEmptySimulatorScenario,
  SIMULATOR_POPULATION_LIMIT,
  validateCombatInput,
  type CombatInput,
  type SimulatorScenario,
} from './simulator.ts';
import { ASTERION_SAVE_KEY, createDefaultCombatPriority } from './priority.ts';
import { createDefaultCombatTechnologies } from './technologies.ts';

class MemoryStorage {
  private values = new Map<string, string>();

  getItem(key: string) {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string) {
    this.values.set(key, value);
  }

  removeItem(key: string) {
    this.values.delete(key);
  }

  keys() {
    return [...this.values.keys()];
  }
}

const attackerParticipant = { playerId: 'a', playerName: 'A', side: 'attacker' as const };
const defenderParticipant = { playerId: 'd', playerName: 'D', side: 'defender' as const };

function input(overrides: Partial<CombatInput> = {}): CombatInput {
  const priority = createDefaultCombatPriority();
  return {
    scenarioId: 'scenario-test',
    timestamp: '2026-09-05T09:00:00.000Z',
    attacker: { participant: attackerParticipant, ships: [{ entityId: 'scout', count: 1 }], commanders: [] },
    defender: { participant: defenderParticipant, ships: [{ entityId: 'scout', count: 1 }], commanders: [], defenses: [] },
    maxRounds: 8,
    attackerPriority: [...priority.attack],
    defenderPriority: [...priority.defense],
    ...overrides,
  };
}

function resolve(value: CombatInput, reportId = 'report-test') {
  return resolveCombat(value, { reportId });
}

function stripCommanderSelection(report: ReturnType<typeof resolve>) {
  return {
    ...report,
    attackerForce: { ...report.attackerForce, activeCommanderId: undefined },
    defenderForce: { ...report.defenderForce, activeCommanderId: undefined },
  };
}

test('resolver is deterministic for fixed input and report identity', () => {
  const value = input();
  assert.deepEqual(resolve(value, 'fixed-report'), resolve(value, 'fixed-report'));
});

test('validation rejects unknown id', () => {
  const value = input({
    attacker: { participant: attackerParticipant, ships: [{ entityId: 'unknown' as never, count: 1 }], commanders: [] },
  });
  assert.equal(validateCombatInput(value).errors.some((error) => error.code === 'unknown-entity'), true);
});

test('validation rejects wrong entity kind', () => {
  const value = input({
    attacker: { participant: attackerParticipant, ships: [{ entityId: 'corsair', count: 1 }], commanders: [] },
  });
  assert.equal(validateCombatInput(value).errors.some((error) => error.code === 'wrong-kind'), true);
});

test('validation rejects negative and fractional count', () => {
  const negative = input({ attacker: { participant: attackerParticipant, ships: [{ entityId: 'scout', count: -1 }], commanders: [] } });
  const fractional = input({ attacker: { participant: attackerParticipant, ships: [{ entityId: 'scout', count: 1.5 }], commanders: [] } });
  assert.equal(validateCombatInput(negative).errors.some((error) => error.code === 'invalid-count'), true);
  assert.equal(validateCombatInput(fractional).errors.some((error) => error.code === 'invalid-count'), true);
});

test('validation rejects duplicate stack', () => {
  const value = input({
    attacker: { participant: attackerParticipant, ships: [{ entityId: 'scout', count: 1 }, { entityId: 'scout', count: 2 }], commanders: [] },
  });
  assert.equal(validateCombatInput(value).errors.some((error) => error.code === 'duplicate-stack'), true);
});

test('validation rejects empty attacker and empty defender', () => {
  const emptyAttacker = input({ attacker: { participant: attackerParticipant, ships: [], commanders: [] } });
  const emptyDefender = input({ defender: { participant: defenderParticipant, ships: [], commanders: [], defenses: [] } });
  assert.equal(validateCombatInput(emptyAttacker).errors.some((error) => error.code === 'empty-side'), true);
  assert.equal(validateCombatInput(emptyDefender).errors.some((error) => error.code === 'empty-side'), true);
});

test('validation rejects invalid maxRounds', () => {
  const value = input({ maxRounds: 7 as never });
  assert.equal(validateCombatInput(value).errors.some((error) => error.code === 'invalid-round-limit'), true);
});

test('validation rejects simulator population overflow independently', () => {
  const count = Math.floor(SIMULATOR_POPULATION_LIMIT / 2) + 1;
  const value = input({
    attacker: { participant: attackerParticipant, ships: [{ entityId: 'scout', count }], commanders: [] },
  });
  assert.equal(validateCombatInput(value).errors.some((error) => error.code === 'population-overflow'), true);
});

test('armor reduction uses exact v1 formula', () => {
  assert.equal(calculateEffectiveDamage(1000, 20), 800);
  assert.equal(calculateEffectiveDamage(1000, 150), 200);
  assert.equal(calculateEffectiveDamage(1000, -5), 1000);
});

test('positive raw damage never rounds to zero', () => {
  assert.equal(calculateEffectiveDamage(1, 80), 1);
});

test('partial HP on last unit carries between rounds', () => {
  const report = resolve(input({
    attacker: { participant: attackerParticipant, ships: [{ entityId: 'scout', count: 1 }], commanders: [] },
    defender: { participant: defenderParticipant, ships: [{ entityId: 'scout', count: 1 }], commanders: [], defenses: [] },
    maxRounds: 5,
  }));
  const round1 = report.rounds[0];
  const round2 = report.rounds[1];
  assert.equal(round1.defenderSnapshot?.stacks[0].countAfter, 1);
  const round1Attack = round1.events.find((event) => event.actorSide === 'attacker');
  const round2Attack = round2.events.find((event) => event.actorSide === 'attacker');
  assert.ok(round1Attack?.lifeAfter != null && round2Attack?.lifeBefore != null);
  assert.equal(round2Attack?.lifeBefore, round1Attack?.lifeAfter);
});

test('a partially damaged living stack fires with its round-start count and carries losses forward', () => {
  const evidence = NEMEXIA_COMBAT_ROUND_PARITY_FIXTURE;
  const defenderStartCount = evidence.observed.firstDisplayedVolley.targetCountBefore;
  const value = input({
    attacker: {
      participant: attackerParticipant,
      ships: [{ entityId: 'destroyer', count: 100 }],
      commanders: [],
    },
    defender: {
      participant: defenderParticipant,
      ships: [{ entityId: 'battleship', count: defenderStartCount }],
      commanders: [],
      defenses: [],
    },
    maxRounds: 5,
    seed: 'nemexia-round-start-parity',
  });
  const report = resolve(value, 'nemexia-round-start-parity');
  assert.deepEqual(report, resolve(value, 'nemexia-round-start-parity'));

  const round1 = report.rounds[0];
  const round1AttackerAttack = round1.events.find((event) => event.actorSide === 'attacker' && event.actionType === 'attack');
  const round1DefenderAttack = round1.events.find((event) => event.actorSide === 'defender' && event.actionType === 'attack');
  const defenderRound1Snapshot = round1.defenderSnapshot?.stacks.find((stack) => stack.entityId === 'battleship');

  assert.ok(round1AttackerAttack);
  assert.ok(round1DefenderAttack);
  assert.ok(defenderRound1Snapshot);
  assert.equal(defenderRound1Snapshot.countBefore, defenderStartCount);
  assert.ok(defenderRound1Snapshot.countAfter > 0);
  assert.ok(defenderRound1Snapshot.countAfter < defenderRound1Snapshot.countBefore);
  assert.equal(round1DefenderAttack.actorCount, defenderStartCount);
  assert.equal(
    round1DefenderAttack.baseAttack,
    Math.floor(defenderStartCount * (round1DefenderAttack.attackPerUnit ?? 0)),
  );
  assert.ok(round1AttackerAttack.sequence < round1DefenderAttack.sequence);

  const round2 = report.rounds[1];
  assert.ok(round2);
  const defenderRound2Snapshot = round2.defenderSnapshot?.stacks.find((stack) => stack.entityId === 'battleship');
  const round2DefenderAttack = round2.events.find((event) => event.actorSide === 'defender' && event.actionType === 'attack');
  assert.ok(defenderRound2Snapshot);
  assert.ok(round2DefenderAttack);
  assert.equal(defenderRound2Snapshot.countBefore, defenderRound1Snapshot.countAfter);
  assert.equal(round2DefenderAttack.actorCount, defenderRound2Snapshot.countBefore);

  assert.equal(evidence.observed.firstDisplayedVolley.destroyedCount, 142);
  assert.deepEqual(evidence.observed.defenderActions.map((action) => action.targetClass), ['Cruiser', 'Bomber']);
  assert.equal(evidence.observed.nextRoundAction.actorCount, 135);
  assert.equal(evidence.observed.partialLossResponses.length, 6);
  assert.ok(evidence.observed.partialLossResponses.every((observation) =>
    observation.countOnResponse === observation.countBefore
      && observation.countAfterVolley === observation.countBefore - observation.destroyedByVolley));
});

test('archive fixtures retain full-destruction responses across ships, commanders, and defense', () => {
  const evidence = NEMEXIA_COUNTERFIRE_FIXTURES;
  assert.equal(evidence.completeShipDestruction[0].destroyedCount, evidence.completeShipDestruction[0].responseCount);
  assert.equal(evidence.completeShipDestruction[1].destroyedCount, evidence.completeShipDestruction[1].responseCount);
  assert.equal(evidence.completeCommanderDestruction.destroyedCount, evidence.completeCommanderDestruction.responseCount);
  assert.ok(evidence.completeDefenseDestruction.every((entry) => entry.destroyedCount === entry.responseCount));
  assert.equal(evidence.partialShipLosses.observations.length, 6);
  assert.equal(evidence.partialShipLosses.multipleBattleshipActions.length, 2);
});

test('commander life-bonus removal cannot create a phantom destroyed stack', () => {
  const report = resolve(input({
    attacker: {
      participant: attackerParticipant,
      ships: [{ entityId: 'scout', count: 100 }],
      commanders: [{ entityId: 'juggernaut', count: 1, level: 40 }],
      activeCommanderId: 'juggernaut',
    },
    defender: {
      participant: defenderParticipant,
      ships: [{ entityId: 'death-star', count: 1 }],
      commanders: [],
      defenses: [],
    },
    maxRounds: 12,
    seed: 'commander-life-invariant',
  }));

  for (const side of ['attacker', 'defender'] as const) {
    let previous = report.initialSnapshot?.[side].stacks ?? [];
    for (const round of report.rounds) {
      const current = round[`${side}Snapshot`]?.stacks ?? [];
      for (const stack of current) {
        const previousStack = previous.find((candidate) => candidate.entityId === stack.entityId);
        if (previousStack && stack.countBefore < previousStack.countAfter) {
          assert.equal(round === report.rounds[0], false, 'round one has no prior life-bonus transition');
          const previousRound = report.rounds[report.rounds.indexOf(round) - 1];
          assert.ok(previousRound.events.some((event) => event.targetSide === side
            && event.targetEntityId === stack.entityId
            && (event.damage ?? 0) > 0), `${side}.${stack.entityId} lost units without incoming damage`);
        }
        if (stack.countAfter < stack.countBefore) {
          assert.ok(round.events.some((event) => event.targetSide === side
            && event.targetEntityId === stack.entityId
            && (event.damage ?? 0) > 0), `${side}.${stack.entityId} lost units without an attack event`);
        }
      }
      previous = current;
    }
  }
});

test('target selection prefers highest threat', () => {
  assert.equal(selectCombatTarget([
    { entityId: 'scout', currentCount: 1 },
    { entityId: 'transporter', currentCount: 2 },
  ])?.entityId, 'scout');
});

test('target selection protects commanders and civilian/service hulls without hardcoding defense order', () => {
  assert.equal(selectCombatTarget([
    { entityId: 'scout', currentCount: 1, threat: 1 },
    { entityId: 'transporter', currentCount: 1, threat: 100_000 },
  ], 'threat')?.entityId, 'scout');
  assert.equal(selectCombatTarget([
    { entityId: 'scout', currentCount: 1, threat: 1 },
    { entityId: 'laser-turret', currentCount: 1, threat: 100_000 },
  ], 'threat')?.entityId, 'laser-turret');
  assert.equal(selectCombatTarget([
    { entityId: 'transporter', currentCount: 1, threat: 1 },
    { entityId: 'hunter', currentCount: 1, threat: 100_000 },
  ], 'threat')?.entityId, 'transporter');
});

test('target selection uses population score after equal threat', () => {
  assert.equal(selectCombatTarget([
    { entityId: 'transporter', currentCount: 1 },
    { entityId: 'solar-satellite', currentCount: 10 },
  ])?.entityId, 'solar-satellite');
});

test('target selection uses stable catalog order when threat and population tie', () => {
  assert.equal(selectCombatTarget([
    { entityId: 'spy-probe', currentCount: 1 },
    { entityId: 'solar-satellite', currentCount: 1 },
  ])?.entityId, 'solar-satellite');
});

test('target selection remains deterministic at lexical fallback boundary', () => {
  const first = selectCombatTarget([
    { entityId: 'solar-satellite', currentCount: 1 },
    { entityId: 'solar-satellite', currentCount: 1 },
  ]);
  const second = selectCombatTarget([
    { entityId: 'solar-satellite', currentCount: 1 },
    { entityId: 'solar-satellite', currentCount: 1 },
  ]);
  assert.deepEqual(first, second);
});

test('destroyed defender ships counterfire at round-start strength and stay destroyed in snapshots', () => {
  const report = resolve(input({
    attacker: { participant: attackerParticipant, ships: [{ entityId: 'death-star', count: 1 }], commanders: [] },
    defender: {
      participant: defenderParticipant,
      ships: [{ entityId: 'scout', count: 1 }, { entityId: 'cruiser', count: 1 }],
      commanders: [],
      defenses: [],
    },
    maxRounds: 5,
    attackerTargetPriority: 'catalog',
    seed: 'destroyed-defender-counterfire',
  }));
  const firstRound = report.rounds[0];
  const scoutAttack = firstRound.events.find((event) => event.actorSide === 'defender'
    && event.actorEntityId === 'scout'
    && event.actionType === 'attack');
  const scoutSnapshot = firstRound.defenderSnapshot?.stacks.find((stack) => stack.entityId === 'scout');
  assert.ok(scoutAttack);
  assert.equal(scoutAttack.actorCount, 1);
  assert.equal(scoutAttack.targetEntityId, 'death-star');
  assert.equal(scoutSnapshot?.countBefore, 1);
  assert.equal(scoutSnapshot?.countAfter, 0);
  assert.ok(firstRound.events.find((event) => event.actorSide === 'attacker')!.sequence < scoutAttack.sequence);

  const round2 = report.rounds[1];
  assert.ok(round2);
  assert.equal(round2.defenderSnapshot?.stacks.find((stack) => stack.entityId === 'scout')?.countBefore, 0);
  assert.equal(round2.events.some((event) => event.actorSide === 'defender'
    && event.actorEntityId === 'scout'
    && event.actionType === 'attack'), false);
  assert.equal(report.winner, 'attacker');
});

test('destroyed defender commanders and defense structures also retain their documented response', () => {
  const commanderReport = resolve(input({
    attacker: { participant: attackerParticipant, ships: [{ entityId: 'death-star', count: 1 }], commanders: [] },
    defender: { participant: defenderParticipant, ships: [], commanders: [{ entityId: 'hunter', count: 1 }], defenses: [] },
    maxRounds: 5,
    seed: 'destroyed-defender-commander-counterfire',
  }));
  const commanderAttack = commanderReport.rounds[0].events.find((event) => event.actorSide === 'defender'
    && event.actorEntityId === 'hunter'
    && event.actionType === 'attack');
  assert.equal(commanderAttack?.actorCount, 1);
  assert.equal(commanderReport.rounds[0].defenderSnapshot?.stacks.find((stack) => stack.entityId === 'hunter')?.countAfter, 0);

  const defenseReport = resolve(input({
    attacker: { participant: attackerParticipant, ships: [{ entityId: 'death-star', count: 1 }], commanders: [] },
    defender: { participant: defenderParticipant, ships: [], commanders: [], defenses: [{ entityId: 'ballistic-turret', count: 1 }] },
    maxRounds: 5,
    seed: 'destroyed-defender-defense-counterfire',
  }));
  const defenseAttack = defenseReport.rounds[0].events.find((event) => event.actorSide === 'defender'
    && event.actorEntityId === 'ballistic-turret'
    && event.actionType === 'attack');
  assert.equal(defenseAttack?.actorCount, 1);
  assert.equal(defenseReport.rounds[0].defenderSnapshot?.defenses?.find((stack) => stack.entityId === 'ballistic-turret')?.countAfter, 0);
});

test('sequential resolution retargets after a target is destroyed in same round', () => {
  const report = resolve(input({
    attacker: {
      participant: attackerParticipant,
      ships: [{ entityId: 'destroyer', count: 1 }, { entityId: 'death-star', count: 1 }],
      commanders: [],
    },
    defender: {
      participant: defenderParticipant,
      ships: [{ entityId: 'scout', count: 2 }, { entityId: 'defender', count: 1 }],
      commanders: [],
      defenses: [],
    },
    maxRounds: 5,
    attackerTargetPriority: 'catalog',
  }));
  const attackerEvents = report.rounds[0].events.filter((event) => event.actorSide === 'attacker');
  assert.equal(attackerEvents[0].targetEntityId, 'scout');
  assert.equal(attackerEvents[1].targetEntityId, 'defender');
  assert.ok((attackerEvents[1].damage ?? 0) > 0);
  assert.equal(report.rounds[0].defenderSnapshot?.stacks.find((stack) => stack.entityId === 'defender')?.countAfter, 0);
});

test('full Nemexia transition audit supports changing target only after destruction', () => {
  const audit = NEMEXIA_TARGET_TRANSITION_AUDIT;
  assert.equal(audit.totalTransitions, audit.analysisVerifiedTransitions + audit.validOlderTransitions);
  assert.equal(audit.totalTransitions, 6052);
  assert.equal(audit.previousTargetAliveAtSwitch, 0);
  assert.equal(audit.example.previousTarget.aliveAtSwitch, 0);
  assert.equal(audit.example.previousTarget.destroyedAtReportLine, audit.example.nextTarget.actionReportLine - 2);
  const boundary = audit.crossRoundCounterexample;
  assert.equal(boundary.round4DestroyerAction.targetCountBefore - boundary.round4DestroyerAction.destroyed, boundary.round4DestroyerAction.targetCountAfter);
  assert.equal(boundary.round5Start.previousTargetCount, boundary.round5AttacksBeforeRetarget[0].targetCountBefore);
  assert.equal(boundary.round5AttacksBeforeRetarget[0].targetCountAfter, boundary.round5AttacksBeforeRetarget[1].targetCountBefore);
  assert.equal(boundary.round5AttacksBeforeRetarget[1].targetCountAfter, 0);
  assert.ok(boundary.round5AttacksBeforeRetarget[1].line < boundary.round5DestroyerAction.line);
  assert.equal(audit.selectorObservations.plannedFirstTarget.selected, 6);
  assert.ok(audit.selectorObservations.minimumCountTarget.selected > audit.selectorObservations.minimumCountTarget.uniformBaseline);
});

test('a stack stays on its selected target across rounds until that target is destroyed', () => {
  const report = resolve(input({
    attacker: { participant: attackerParticipant, ships: [{ entityId: 'bomber', count: 1 }], commanders: [] },
    defender: {
      participant: defenderParticipant,
      ships: [{ entityId: 'scout', count: 8 }, { entityId: 'cruiser', count: 1 }],
      commanders: [],
      defenses: [],
    },
    maxRounds: 5,
    attackerTargetPriority: 'threat',
    seed: 'target-lock-until-destroyed',
  }));

  const scoutAfterRound1 = report.rounds[0].defenderSnapshot?.stacks.find((stack) => stack.entityId === 'scout');
  assert.ok(scoutAfterRound1);
  assert.ok(scoutAfterRound1.countAfter > 0);
  const round1BomberAttack = report.rounds[0]?.events.find((event) => event.actorSide === 'attacker'
    && event.actorEntityId === 'bomber'
    && event.actionType === 'attack');
  assert.equal(round1BomberAttack?.targetEntityId, 'scout');
  const freshTarget = selectCombatTarget([
    { entityId: 'scout', currentCount: scoutAfterRound1.countAfter },
    { entityId: 'cruiser', currentCount: 1 },
  ], 'threat');
  assert.equal(freshTarget?.entityId, 'cruiser');

  const round2BomberAttack = report.rounds[1]?.events.find((event) => event.actorSide === 'attacker'
    && event.actorEntityId === 'bomber'
    && event.actionType === 'attack');
  assert.equal(round2BomberAttack?.targetEntityId, 'scout');
});

test('Reanimator repairs after both action phases and the saved archive places repairs at round end', () => {
  const fixture = NEMEXIA_REPAIR_TIMING_FIXTURES;
  for (const archived of [fixture.attackerReanimator, fixture.repairWithBothSidesSelectingReanimator]) {
    assert.ok(archived.observations.repairActions.every((repair) => repair.reportLine > archived.observations.finalDefenderActionReportLine));
    assert.ok(archived.observations.repairActions.every((repair) => repair.reportLine < archived.observations.nextRoundHeadingReportLine));
  }
  assert.ok(fixture.repairWithBothSidesSelectingReanimator.observations.nextRoundRestoredStackActionReportLine
    > fixture.repairWithBothSidesSelectingReanimator.observations.nextRoundHeadingReportLine);
  assert.equal(fixture.repairWithoutReanimator.observations.plannedReanimatorCount, 0);

  const priority = createDefaultCombatPriority();
  let report: ReturnType<typeof resolve> | undefined;
  for (let seedIndex = 0; seedIndex < 128 && !report; seedIndex += 1) {
    const candidate = resolve(input({
      attacker: {
        participant: attackerParticipant,
        ships: [{ entityId: 'scout', count: 250 }],
        commander: { entityId: 'reanimator', count: 1, level: 40 },
        activeCommanderId: 'reanimator',
      },
      defender: { participant: defenderParticipant, ships: [{ entityId: 'scout', count: 250 }], commanders: [], defenses: [] },
      attackerPriority: ['reanimator', ...priority.attack.filter((id) => id !== 'reanimator')],
      maxRounds: 5,
      seed: `reanimator-round-end-${seedIndex}`,
    }), `reanimator-round-end-${seedIndex}`);
    const found = candidate.rounds.some((round) => {
      const repairIndex = round.events.findIndex((event) => event.commanderAbilityId === 'reanimator');
      if (repairIndex < 0) return false;
      const lastDefenderActionIndex = round.events.reduce((last, event, index) => (
        event.actorSide === 'defender'
          && (event.actionType === 'attack' || (event.actionType === 'ability' && event.commanderAbilityId !== 'reanimator'))
          ? index
          : last
      ), -1);
      return lastDefenderActionIndex >= 0 && repairIndex > lastDefenderActionIndex;
    });
    if (found) report = candidate;
  }

  assert.ok(report, 'expected a deterministic seed in the bounded sweep to produce a Reanimator repair after defender actions');
  for (const round of report.rounds) {
    const repairIndex = round.events.findIndex((event) => event.commanderAbilityId === 'reanimator');
    if (repairIndex < 0) continue;
    const lastActionIndex = round.events.reduce((last, event, index) => (
      event.actionType === 'attack' || (event.actionType === 'ability' && event.commanderAbilityId !== 'reanimator')
        ? index
        : last
      ), -1);
    assert.ok(repairIndex > lastActionIndex, 'repair event should follow both sides’ round actions');
  }
});

test('when both Asterion Reanimators proc, both repairs follow both sides’ combat actions', () => {
  const priority = createDefaultCombatPriority();
  const reanimatorPriority = (ids: CommanderId[]): CommanderId[] => ['reanimator', ...ids.filter((id) => id !== 'reanimator')];
  let simultaneousRepairs: ReturnType<typeof resolve>['rounds'][number] | undefined;
  for (let seedIndex = 0; seedIndex < 512 && !simultaneousRepairs; seedIndex += 1) {
    const candidate = resolve(input({
      attacker: {
        participant: attackerParticipant,
        ships: [{ entityId: 'scout', count: 2_500 }],
        commander: { entityId: 'reanimator', count: 1, level: 40 },
        activeCommanderId: 'reanimator',
      },
      defender: {
        participant: defenderParticipant,
        ships: [{ entityId: 'scout', count: 2_500 }],
        commander: { entityId: 'reanimator', count: 1, level: 40 },
        activeCommanderId: 'reanimator',
        defenses: [],
      },
      attackerPriority: reanimatorPriority(priority.attack),
      defenderPriority: reanimatorPriority(priority.defense),
      maxRounds: 8,
      seed: `both-reanimators-round-end-${seedIndex}`,
    }), `both-reanimators-round-end-${seedIndex}`);
    simultaneousRepairs = candidate.rounds.find((round) => {
      const repairEvents = round.events.filter((event) => event.commanderAbilityId === 'reanimator');
      return repairEvents.some((event) => event.actorSide === 'attacker')
        && repairEvents.some((event) => event.actorSide === 'defender');
    });
  }

  assert.ok(simultaneousRepairs, 'expected a bounded seeded sweep to find a round where both repair rolls succeed');
  const lastCombatActionIndex = simultaneousRepairs.events.reduce((last, event, index) => (
    event.actionType === 'attack' || (event.actionType === 'ability' && event.commanderAbilityId !== 'reanimator')
      ? index
      : last
  ), -1);
  const repairEvents = simultaneousRepairs.events.filter((event) => event.commanderAbilityId === 'reanimator');
  const repairIndexes = repairEvents.map((_, index) => simultaneousRepairs.events.findIndex((event) => event === repairEvents[index]));
  assert.equal(repairIndexes.length, 2);
  assert.deepEqual(repairEvents.map((event) => event.actorSide), ['attacker', 'defender']);
  assert.ok(repairIndexes.every((index) => index > lastCombatActionIndex));
  assert.ok(repairIndexes[0] < repairIndexes[1], 'Asterion retains its attacker-then-defender repair RNG order');
});

test('attacker victory is detected', () => {
  assert.equal(resolve(input({
    attacker: { participant: attackerParticipant, ships: [{ entityId: 'cruiser', count: 1 }], commanders: [] },
    defender: { participant: defenderParticipant, ships: [{ entityId: 'spy-probe', count: 2 }], commanders: [], defenses: [] },
  })).winner, 'attacker');
});

test('defender victory is detected', () => {
  const report = resolve(input({
    attacker: { participant: attackerParticipant, ships: [{ entityId: 'scout', count: 1 }], commanders: [] },
    defender: { participant: defenderParticipant, ships: [{ entityId: 'death-star', count: 1 }], commanders: [], defenses: [] },
  }));
  assert.equal(report.winner, 'defender');
});

test('attacker priority resolves before defender in a baseline exchange', () => {
  const report = resolve(input({
    attacker: { participant: attackerParticipant, ships: [{ entityId: 'death-star', count: 1 }], commanders: [] },
    defender: { participant: defenderParticipant, ships: [{ entityId: 'scout', count: 1 }], commanders: [], defenses: [] },
  }));
  assert.equal(report.winner, 'attacker');
});

test('living sides at max round limit produce draw and never exceed limit', () => {
  const report = resolve(input({
    attacker: { participant: attackerParticipant, ships: [], commanders: [{ entityId: 'corsair', count: 1 }] },
    defender: { participant: defenderParticipant, ships: [], commanders: [{ entityId: 'corsair', count: 1 }], defenses: [] },
    maxRounds: 5,
  }));
  assert.equal(report.winner, 'draw');
  assert.equal(report.roundCount, 5);
  assert.ok(report.rounds.length <= 5);
});

test('population before and after uses canonical catalog population and survivors', () => {
  const report = resolve(input({
    attacker: { participant: attackerParticipant, ships: [{ entityId: 'scout', count: 1 }], commanders: [] },
    defender: { participant: defenderParticipant, ships: [{ entityId: 'spy-probe', count: 2 }], commanders: [], defenses: [] },
  }));
  assert.equal(report.attackerForce.populationBefore, 2);
  assert.equal(report.attackerForce.populationAfter, 2);
  assert.equal(report.defenderForce.populationBefore, 2);
  assert.equal(report.defenderForce.populationAfter, 0);
});

test('attacker and defender select active commander from independent priority', () => {
  const priority = createDefaultCombatPriority();
  const report = resolve(input({
    attacker: { participant: attackerParticipant, ships: [{ entityId: 'scout', count: 1 }], commanders: [{ entityId: 'hunter', count: 1 }] },
    defender: { participant: defenderParticipant, ships: [{ entityId: 'cruiser', count: 1 }], commanders: [{ entityId: 'polias', count: 1 }], defenses: [] },
    attackerPriority: ['hunter', ...priority.attack.filter((id) => id !== 'hunter')],
    defenderPriority: ['polias', ...priority.defense.filter((id) => id !== 'polias')],
  }));
  assert.equal(report.attackerForce.activeCommanderId, 'hunter');
  assert.equal(report.defenderForce.activeCommanderId, 'polias');
});

test('no commander means no activeCommanderId', () => {
  const report = resolve(input());
  assert.equal(report.attackerForce.activeCommanderId, undefined);
  assert.equal(report.defenderForce.activeCommanderId, undefined);
});

test('commander selection is asymmetric and commander stats are reported', () => {
  const corsairInput = input({
    attacker: {
      participant: attackerParticipant,
      ships: [{ entityId: 'scout', count: 1 }],
      commanders: [{ entityId: 'corsair', count: 1 }],
    },
    defender: { participant: defenderParticipant, ships: [{ entityId: 'battleship', count: 1 }], commanders: [], defenses: [] },
  });
  const hunterInput: CombatInput = { ...corsairInput, attacker: { ...corsairInput.attacker, commanders: [{ entityId: 'hunter', count: 1 }] } };
  const corsairFirst = resolve(corsairInput, 'same');
  const hunterFirst = resolve(hunterInput, 'same');
  assert.equal(corsairFirst.attackerForce.activeCommanderId, 'corsair');
  assert.equal(hunterFirst.attackerForce.activeCommanderId, 'hunter');
  assert.notDeepEqual(stripCommanderSelection(corsairFirst), stripCommanderSelection(hunterFirst));
});

test('all commander selections are reported and active combat effects are not hidden', () => {
  const priority = createDefaultCombatPriority();
  COMMANDER_IDS.forEach((commanderId: CommanderId) => {
    const report = resolve(input({
      attacker: { participant: attackerParticipant, ships: [], commanders: [{ entityId: commanderId, count: 1 }] },
      defender: { participant: defenderParticipant, ships: [{ entityId: 'death-star', count: 1 }], commanders: [], defenses: [] },
      attackerPriority: [commanderId, ...priority.attack.filter((id) => id !== commanderId)],
    }), `report-${commanderId}`);
    assert.equal(report.attackerForce.activeCommanderId, commanderId);
    assert.equal(report.attackerForce.modifiers?.commanderId, commanderId);
  });
});

test('generated report uses existing BattleReport contract without fake optional outcomes', () => {
  const report = resolve(input());
  assert.equal(report.missionType, 'simulation');
  assert.equal(report.schemaVersion, 3);
  assert.equal(report.engineVersion, 'asterion-combat-engine-v4');
  assert.ok(report.initialSnapshot);
  assert.equal(report.metadata?.source, 'combat-resolver');
  assert.match(report.metadata?.note ?? '', /asterion-combat-engine-v4/);
  assert.equal(report.experience, undefined);
  assert.equal(report.debris, undefined);
  assert.equal(report.resources, undefined);
  assert.equal(report.repairEligibility, undefined);
  report.rounds.flatMap((round) => round.events).forEach((event) => {
    assert.equal(event.shieldBefore, undefined);
    assert.equal(event.shieldAfter, undefined);
    assert.equal(event.armorBefore != null, true);
    assert.equal(event.armorAfter != null, true);
    assert.equal(event.commanderAbilityId, undefined);
  });
});

test('simulator presets save and reload under the existing Asterion save key', () => {
  const storage = new MemoryStorage();
  const scenario: SimulatorScenario = {
    attacker: { ships: [{ entityId: 'scout', count: 3 }], commanders: [] },
    defender: { ships: [{ entityId: 'cruiser', count: 2 }], commanders: [], defenses: [{ entityId: 'laser-turret', count: 4 }] },
    maxRounds: 8,
  };
  const state = upsertSimulatorPreset(createDefaultSimulatorState(), {
    id: 'preset-1', name: 'Тест', createdAt: '2026-09-05T09:00:00.000Z', input: scenario,
  });
  assert.equal(persistSimulatorState(state, storage).ok, true);
  assert.deepEqual(readSimulatorState(storage).presets, state.presets);
  assert.deepEqual(storage.keys(), [ASTERION_SAVE_KEY]);
});

test('preset deletion survives reload', () => {
  const storage = new MemoryStorage();
  const state = upsertSimulatorPreset(createDefaultSimulatorState(), {
    id: 'preset-1', name: 'Тест', createdAt: '2026-09-05T09:00:00.000Z', input: createEmptySimulatorScenario(),
  });
  persistSimulatorState(state, storage);
  persistSimulatorState(deleteSimulatorPreset(readSimulatorState(storage), 'preset-1'), storage);
  assert.equal(readSimulatorState(storage).presets.length, 0);
});

test('PR30 save migrates without damaging battle history or combat priority', () => {
  const storage = new MemoryStorage();
  const priority = createDefaultCombatPriority();
  const history = createDefaultBattleHistory();
  storage.setItem(ASTERION_SAVE_KEY, JSON.stringify({ schemaVersion: 3, combatPriority: priority, combat: history, metal: 123 }));
  const next = withLastScenario(readSimulatorState(storage), createEmptySimulatorScenario());
  persistSimulatorState(next, storage);
  const envelope = JSON.parse(storage.getItem(ASTERION_SAVE_KEY) ?? '{}') as Record<string, unknown>;
  assert.equal((envelope as { metal?: number }).metal, 123);
  assert.deepEqual(envelope.combatPriority, priority);
  assert.deepEqual(envelope.combat, history);
});

test('malformed presets are safely dropped or normalized', () => {
  const state = migrateSimulatorState({
    presets: [
      null,
      { id: '', name: 'bad', createdAt: 'bad', input: {} },
      {
        id: 'ok',
        name: ' Safe ',
        createdAt: '2026-09-05T09:00:00.000Z',
        input: {
          attacker: { ships: [{ entityId: 'scout', count: 2 }, { entityId: 'scout', count: 3 }, { entityId: 'corsair', count: 1 }] },
          defender: {},
          maxRounds: 77,
        },
      },
    ],
  });
  assert.equal(state.presets.length, 1);
  assert.equal(state.presets[0].name, 'Safe');
  assert.deepEqual(state.presets[0].input.attacker.ships, [{ entityId: 'scout', count: 5, level: 0 }]);
  assert.equal(state.presets[0].input.maxRounds, 8);
});

test('prototype-style reset clears simulator state when the shared save key is removed', () => {
  const storage = new MemoryStorage();
  persistSimulatorState(withLastScenario(createDefaultSimulatorState(), {
    attacker: { ships: [{ entityId: 'scout', count: 1 }], commanders: [] },
    defender: { ships: [{ entityId: 'scout', count: 1 }], commanders: [], defenses: [] },
    maxRounds: 8,
  }), storage);
  storage.removeItem(ASTERION_SAVE_KEY);
  assert.deepEqual(readSimulatorState(storage), createDefaultSimulatorState());
});

test('simulation result is not added to Battles automatically', () => {
  const history = createDefaultBattleHistory();
  const report = resolve(input(), 'simulation-explicit-save');
  assert.equal(history.reports.some((item) => item.id === report.id), false);
});

test('simulation reports can be explicitly saved to Battles and survive reload', () => {
  const storage = new MemoryStorage();
  const report = resolve(input(), 'simulation-explicit-save');
  const saved = addBattleReportSaved(createDefaultBattleHistory(), report);
  assert.equal(saved.reports.some((item) => item.id === report.id), true);
  assert.equal(saved.savedReportIds.includes(report.id), true);
  persistBattleHistory(saved, storage);
  const reloaded = readBattleHistory(storage);
  assert.equal(reloaded.reports.some((item) => item.id === report.id), true);
  assert.equal(reloaded.savedReportIds.includes(report.id), true);
});

test('generated report stores the technologies used for each side as historical snapshots', () => {
  const attackerTechnologies = { ...createDefaultCombatTechnologies(), laserScience: 12 };
  const defenderTechnologies = { ...createDefaultCombatTechnologies(), ionScience: 11 };
  const report = resolve(input({ attackerTechnologies, defenderTechnologies }));

  assert.equal(report.attackerForce.technologies?.laserScience, 12);
  assert.equal(report.attackerForce.technologies?.ionScience, 0);
  assert.equal(report.defenderForce.technologies?.ionScience, 11);
  assert.equal(report.defenderForce.technologies?.laserScience, 0);
  assert.notEqual(report.attackerForce.technologies, report.defenderForce.technologies);
});

test('saving the same simulation report twice keeps one saved copy', () => {
  const report = resolve(input(), 'simulation-no-duplicate');
  const once = addBattleReportSaved(createDefaultBattleHistory(), report);
  const twice = addBattleReportSaved(once, report);
  assert.equal(twice.reports.filter((item) => item.id === report.id).length, 1);
  assert.equal(twice.savedReportIds.includes(report.id), true);
});

test('saving simulation does not mutate demo reports', () => {
  const before = JSON.stringify(DEMO_BATTLE_REPORTS);
  const report = resolve(input(), 'simulation-demo-safe');
  addBattleReportSaved(createDefaultBattleHistory(), report);
  assert.equal(JSON.stringify(DEMO_BATTLE_REPORTS), before);
});
