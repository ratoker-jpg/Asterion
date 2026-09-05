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
    defender: { participant: defenderParticipant, ships: [{ entityId: 'spy-probe', count: 1 }], commanders: [], defenses: [] },
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
    defender: { participant: defenderParticipant, ships: [{ entityId: 'transporter', count: 1 }], commanders: [], defenses: [] },
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

test('target selection prefers highest threat', () => {
  assert.equal(selectCombatTarget([
    { entityId: 'scout', currentCount: 1 },
    { entityId: 'transporter', currentCount: 2 },
  ])?.entityId, 'scout');
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

test('simultaneous planning lets a stack fire after it was destroyed earlier in the event log', () => {
  const report = resolve(input({
    attacker: { participant: attackerParticipant, ships: [{ entityId: 'spy-probe', count: 1 }], commanders: [] },
    defender: { participant: defenderParticipant, ships: [{ entityId: 'spy-probe', count: 1 }], commanders: [], defenses: [] },
    maxRounds: 5,
  }));
  assert.equal(report.rounds[0].events.length, 2);
  assert.equal(report.rounds[0].events[1].actorSide, 'defender');
  assert.equal(report.rounds[0].events[1].damage, 1);
  assert.equal(report.winner, 'draw');
});

test('planned attack does not retarget when its target is already destroyed in same round', () => {
  const report = resolve(input({
    attacker: {
      participant: attackerParticipant,
      ships: [{ entityId: 'transporter', count: 1 }, { entityId: 'scout', count: 1 }],
      commanders: [],
    },
    defender: {
      participant: defenderParticipant,
      ships: [{ entityId: 'spy-probe', count: 2 }, { entityId: 'solar-satellite', count: 1 }],
      commanders: [],
      defenses: [],
    },
    maxRounds: 5,
  }));
  const attackerEvents = report.rounds[0].events.filter((event) => event.actorSide === 'attacker');
  assert.equal(attackerEvents[0].targetEntityId, 'spy-probe');
  assert.equal(attackerEvents[1].targetEntityId, 'spy-probe');
  assert.equal(attackerEvents[1].damage, 0);
  assert.equal(report.rounds[0].defenderSnapshot?.stacks.find((stack) => stack.entityId === 'solar-satellite')?.countAfter, 1);
});

test('attacker victory is detected', () => {
  assert.equal(resolve(input()).winner, 'attacker');
});

test('defender victory is detected', () => {
  const report = resolve(input({
    attacker: { participant: attackerParticipant, ships: [{ entityId: 'spy-probe', count: 1 }], commanders: [] },
    defender: { participant: defenderParticipant, ships: [{ entityId: 'scout', count: 1 }], commanders: [], defenses: [] },
  }));
  assert.equal(report.winner, 'defender');
});

test('mutual destruction is draw', () => {
  const report = resolve(input({
    attacker: { participant: attackerParticipant, ships: [{ entityId: 'spy-probe', count: 1 }], commanders: [] },
    defender: { participant: defenderParticipant, ships: [{ entityId: 'spy-probe', count: 1 }], commanders: [], defenses: [] },
  }));
  assert.equal(report.winner, 'draw');
});

test('living sides at max round limit produce draw and never exceed limit', () => {
  const report = resolve(input({
    attacker: { participant: attackerParticipant, ships: [{ entityId: 'solar-satellite', count: 1 }], commanders: [] },
    defender: { participant: defenderParticipant, ships: [{ entityId: 'solar-satellite', count: 1 }], commanders: [], defenses: [] },
    maxRounds: 5,
  }));
  assert.equal(report.winner, 'draw');
  assert.equal(report.roundCount, 5);
  assert.ok(report.rounds.length <= 5);
});

test('population before and after uses canonical catalog population and survivors', () => {
  const report = resolve(input());
  assert.equal(report.attackerForce.populationBefore, 2);
  assert.equal(report.attackerForce.populationAfter, 2);
  assert.equal(report.defenderForce.populationBefore, 1);
  assert.equal(report.defenderForce.populationAfter, 0);
});

test('attacker and defender select active commander from independent priority', () => {
  const priority = createDefaultCombatPriority();
  const report = resolve(input({
    attacker: { participant: attackerParticipant, ships: [{ entityId: 'scout', count: 1 }], commanders: [{ entityId: 'corsair', count: 1 }, { entityId: 'hunter', count: 1 }] },
    defender: { participant: defenderParticipant, ships: [{ entityId: 'cruiser', count: 1 }], commanders: [{ entityId: 'judge', count: 1 }, { entityId: 'polias', count: 1 }], defenses: [] },
    attackerPriority: ['hunter', 'corsair', ...priority.attack.filter((id) => id !== 'hunter' && id !== 'corsair')],
    defenderPriority: ['polias', 'judge', ...priority.defense.filter((id) => id !== 'polias' && id !== 'judge')],
  }));
  assert.equal(report.attackerForce.activeCommanderId, 'hunter');
  assert.equal(report.defenderForce.activeCommanderId, 'polias');
});

test('no commander means no activeCommanderId', () => {
  const report = resolve(input());
  assert.equal(report.attackerForce.activeCommanderId, undefined);
  assert.equal(report.defenderForce.activeCommanderId, undefined);
});

test('priority changes selected commander but v1 combat numbers stay identical', () => {
  const base = input({
    attacker: {
      participant: attackerParticipant,
      ships: [{ entityId: 'scout', count: 1 }],
      commanders: [{ entityId: 'corsair', count: 1 }, { entityId: 'hunter', count: 1 }],
    },
    defender: { participant: defenderParticipant, ships: [{ entityId: 'battleship', count: 1 }], commanders: [], defenses: [] },
  });
  const rest = COMMANDER_IDS.filter((id) => id !== 'corsair' && id !== 'hunter');
  const corsairFirst = resolve({ ...base, attackerPriority: ['corsair', 'hunter', ...rest] }, 'same');
  const hunterFirst = resolve({ ...base, attackerPriority: ['hunter', 'corsair', ...rest] }, 'same');
  assert.equal(corsairFirst.attackerForce.activeCommanderId, 'corsair');
  assert.equal(hunterFirst.attackerForce.activeCommanderId, 'hunter');
  assert.deepEqual(stripCommanderSelection(corsairFirst), stripCommanderSelection(hunterFirst));
});

test('all commander abilities are selection-only in resolver v1', () => {
  const priority = createDefaultCombatPriority();
  COMMANDER_IDS.forEach((commanderId: CommanderId) => {
    const report = resolve(input({
      attacker: { participant: attackerParticipant, ships: [], commanders: [{ entityId: commanderId, count: 1 }] },
      defender: { participant: defenderParticipant, ships: [{ entityId: 'death-star', count: 1 }], commanders: [], defenses: [] },
      attackerPriority: [commanderId, ...priority.attack.filter((id) => id !== commanderId)],
    }), `report-${commanderId}`);
    assert.equal(report.attackerForce.activeCommanderId, commanderId);
    assert.equal(report.attackerForce.modifiers, undefined);
  });
});

test('generated report uses existing BattleReport contract without fake optional outcomes', () => {
  const report = resolve(input());
  assert.equal(report.missionType, 'simulation');
  assert.equal(report.metadata?.source, 'combat-resolver');
  assert.equal(report.metadata?.note, 'Asterion Combat Resolver v1');
  assert.equal(report.experience, undefined);
  assert.equal(report.debris, undefined);
  assert.equal(report.resources, undefined);
  assert.equal(report.repairEligibility, undefined);
  report.rounds.flatMap((round) => round.events).forEach((event) => {
    assert.equal(event.shieldBefore, undefined);
    assert.equal(event.shieldAfter, undefined);
    assert.equal(event.armorBefore, undefined);
    assert.equal(event.armorAfter, undefined);
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
  assert.deepEqual(state.presets[0].input.attacker.ships, [{ entityId: 'scout', count: 5 }]);
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

test('explicit save adds simulation to Battles and savedReportIds and survives reload', () => {
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

test('saving the same simulation report twice does not duplicate report id', () => {
  const report = resolve(input(), 'simulation-no-duplicate');
  const once = addBattleReportSaved(createDefaultBattleHistory(), report);
  const twice = addBattleReportSaved(once, report);
  assert.equal(twice.reports.filter((item) => item.id === report.id).length, 1);
});

test('saving simulation does not mutate demo reports', () => {
  const before = JSON.stringify(DEMO_BATTLE_REPORTS);
  const report = resolve(input(), 'simulation-demo-safe');
  addBattleReportSaved(createDefaultBattleHistory(), report);
  assert.equal(JSON.stringify(DEMO_BATTLE_REPORTS), before);
});
