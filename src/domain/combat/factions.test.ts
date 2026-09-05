import assert from 'node:assert/strict';
import test from 'node:test';

import { COMBAT_FACTIONS, getCombatFactionName } from './factions.ts';
import { createDefaultCombatPriority } from './priority.ts';
import {
  migrateSimulatorState,
  normalizeSimulatorScenario,
} from './simulator-repository.ts';
import {
  createEmptySimulatorScenario,
  scenarioToCombatInput,
  setScenarioFaction,
} from './simulator.ts';

const populatedScenario = {
  ...createEmptySimulatorScenario(),
  attacker: {
    ships: [{ entityId: 'scout' as const, count: 3 }],
    commanders: [{ entityId: 'corsair' as const, count: 1 }],
  },
  defender: {
    ships: [{ entityId: 'battleship' as const, count: 2 }],
    commanders: [{ entityId: 'judge' as const, count: 1 }],
    defenses: [{ entityId: 'laser-turret' as const, count: 4 }],
  },
};

test('simulator exposes exactly the three Asterion player races', () => {
  assert.deepEqual(COMBAT_FACTIONS, [
    { id: 'aegis', name: 'Астеры' },
    { id: 'synod', name: 'Илары' },
    { id: 'veyra', name: 'Рой' },
  ]);
});

test('legacy simulator scenario migrates to Asters versus Asters', () => {
  const migrated = normalizeSimulatorScenario({
    attacker: { ships: [{ entityId: 'scout', count: 2 }], commanders: [] },
    defender: { ships: [{ entityId: 'cruiser', count: 1 }], commanders: [], defenses: [] },
    maxRounds: 8,
  });

  assert.equal(migrated.attackerFactionId, 'aegis');
  assert.equal(migrated.defenderFactionId, 'aegis');
  assert.equal(migrated.attacker.ships[0]?.count, 2);
  assert.equal(migrated.defender.ships[0]?.count, 1);
});

test('attacker and defender race selections are independent', () => {
  const attackerChanged = setScenarioFaction(populatedScenario, 'attacker', 'synod');
  assert.equal(attackerChanged.attackerFactionId, 'synod');
  assert.equal(attackerChanged.defenderFactionId, 'aegis');
  assert.deepEqual(attackerChanged.attacker, { ships: [], commanders: [] });
  assert.deepEqual(attackerChanged.defender, populatedScenario.defender);

  const defenderChanged = setScenarioFaction(attackerChanged, 'defender', 'veyra');
  assert.equal(defenderChanged.attackerFactionId, 'synod');
  assert.equal(defenderChanged.defenderFactionId, 'veyra');
  assert.deepEqual(defenderChanged.attacker, { ships: [], commanders: [] });
  assert.deepEqual(defenderChanged.defender, { ships: [], commanders: [], defenses: [] });
});

test('changing to the already selected race does not clear the side', () => {
  const unchanged = setScenarioFaction(populatedScenario, 'attacker', 'aegis');
  assert.equal(unchanged, populatedScenario);
});

test('presets and last scenario retain independent race selections', () => {
  const mixed = {
    ...populatedScenario,
    attackerFactionId: 'synod' as const,
    defenderFactionId: 'veyra' as const,
  };
  const migrated = migrateSimulatorState({
    lastScenario: mixed,
    presets: [{ id: 'mixed-1', name: 'Mixed', createdAt: '2026-09-05T00:00:00.000Z', input: mixed }],
  });

  assert.equal(migrated.lastScenario?.attackerFactionId, 'synod');
  assert.equal(migrated.lastScenario?.defenderFactionId, 'veyra');
  assert.equal(migrated.presets[0]?.input.attackerFactionId, 'synod');
  assert.equal(migrated.presets[0]?.input.defenderFactionId, 'veyra');
});

test('combat input and BattleReport participant metadata receive selected race names', () => {
  const mixed = {
    ...populatedScenario,
    attackerFactionId: 'synod' as const,
    defenderFactionId: 'veyra' as const,
  };
  const input = scenarioToCombatInput(mixed, {
    scenarioId: 'race-test',
    timestamp: '2026-09-05T00:00:00.000Z',
    attacker: { playerName: 'A', side: 'attacker' },
    defender: { playerName: 'B', side: 'defender' },
    priority: createDefaultCombatPriority(),
  });

  assert.equal(input.attacker.participant.race, getCombatFactionName('synod'));
  assert.equal(input.defender.participant.race, getCombatFactionName('veyra'));
  assert.equal(input.attacker.participant.race, 'Илары');
  assert.equal(input.defender.participant.race, 'Рой');
});
