import assert from 'node:assert/strict';
import test from 'node:test';

import type { BattleReport } from '../domain/combat/report.ts';
import { createDefaultCombatPriority } from '../domain/combat/priority.ts';
import type { CombatInput } from '../domain/combat/simulator.ts';
import {
  bindCombatResolutionEventBridge,
  COMBAT_RESOLVE_REQUEST_EVENT,
  resolveAndApplyCombat,
} from './combat.ts';
import {
  applyBattleResult,
  repairUnits,
} from './repair.ts';
import {
  createInitialSaveState,
  createPersistenceFacade,
  type StorageLike,
} from './persistence.ts';

class MemoryStorage implements StorageLike {
  readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }
}

function report(overrides: Partial<BattleReport> = {}): BattleReport {
  return {
    id: 'repair-application-battle-1',
    timestamp: '2026-09-13T00:00:00.000Z',
    missionType: 'defense',
    attacker: { playerId: 'raider', playerName: 'Raider', side: 'attacker' },
    defender: { playerId: 'player-aster', playerName: 'Asterion', side: 'defender' },
    winner: 'defender',
    roundCount: 1,
    attackerForce: { populationBefore: 0, populationAfter: 0, stacks: [] },
    defenderForce: {
      populationBefore: 10,
      populationAfter: 0,
      stacks: [{ entityId: 'scout', countBefore: 5, countAfter: 0, destroyed: 5 }],
      defenses: [{ entityId: 'ballistic-turret', countBefore: 4, countAfter: 0, destroyed: 4 }],
    },
    rounds: [],
    ...overrides,
  };
}

test('legacy saves migrate to an empty repair pool with 31 tokens and persist new state', () => {
  const storage = new MemoryStorage();
  const persistence = createPersistenceFacade({ mode: 'production', storage, now: () => 1_000 });
  storage.values.set(persistence.saveKey, JSON.stringify({
    schemaVersion: 13,
    planets: { 'helion-01': {} },
  }));

  const migrated = persistence.read();
  assert.equal(migrated.planets['helion-01'].repair.tokens, 31);
  assert.equal(migrated.planets['helion-01'].repair.ships.scout, 0);
  assert.equal(migrated.planets['helion-01'].repair.defenses['ballistic-turret'], 0);
  assert.deepEqual(migrated.planets['helion-01'].repair.claimedBattleIds, []);

  const saved = {
    ...migrated,
    planets: {
      ...migrated.planets,
      'helion-01': {
        ...migrated.planets['helion-01'],
        repair: {
          ...migrated.planets['helion-01'].repair,
          ships: { ...migrated.planets['helion-01'].repair.ships, scout: 2 },
          tokens: 17,
        },
      },
    },
  };
  assert.equal(persistence.write(saved).ok, true);
  const roundTripped = persistence.read();
  assert.equal(roundTripped.planets['helion-01'].repair.ships.scout, 2);
  assert.equal(roundTripped.planets['helion-01'].repair.tokens, 17);
});

test('real combat application awards defensive repair once and stores an annotated report', () => {
  const initial = createInitialSaveState('production', 0);
  const first = applyBattleResult(initial, 'helion-01', report());
  const planet = first.state.planets['helion-01'];

  assert.equal(first.changed, true);
  assert.equal(first.report.repairEligibility?.status, 'available');
  assert.equal(planet.repair.ships.scout, 3);
  assert.equal(planet.repair.defenses['ballistic-turret'], 2);
  assert.deepEqual(planet.repair.claimedBattleIds, ['repair-application-battle-1']);
  assert.equal(first.state.combat.reports.some((candidate) => candidate.id === report().id), true);

  const second = applyBattleResult(first.state, 'helion-01', report());
  assert.equal(second.changed, false);
  assert.strictEqual(second.state, first.state);
  assert.strictEqual(second.state.planets['helion-01'].repair, planet.repair);
  assert.equal(second.state.planets['helion-01'].repair.ships.scout, 3);
  assert.equal(second.state.planets['helion-01'].repair.defenses['ballistic-turret'], 2);
});

test('production combat boundary classifies a defensive resolver result and awards repair once', () => {
  const initial = createInitialSaveState('production', 0);
  const priority = createDefaultCombatPriority();
  const input: CombatInput = {
    scenarioId: 'production-defense-scenario',
    timestamp: '2026-09-13T00:00:00.000Z',
    attacker: {
      participant: { playerId: 'raider', playerName: 'Raider', side: 'attacker' },
      ships: [{ entityId: 'death-star', count: 1 }],
      commanders: [],
    },
    defender: {
      participant: { playerId: 'player-aster', playerName: 'Asterion', side: 'defender' },
      ships: [{ entityId: 'scout', count: 5 }],
      commanders: [],
      defenses: [{ entityId: 'ballistic-turret', count: 4 }],
    },
    maxRounds: 8,
    attackerPriority: [...priority.attack],
    defenderPriority: [...priority.defense],
  };
  const resolutionContext = { reportId: 'production-defense-report-1', missionType: 'defense' as const };

  const first = resolveAndApplyCombat(initial, 'helion-01', input, resolutionContext);
  assert.equal(first.report.missionType, 'defense');
  assert.equal(first.report.repairEligibility?.status, 'available');
  assert.equal(first.state.planets['helion-01'].repair.ships.scout, 3);
  assert.equal(first.state.planets['helion-01'].repair.defenses['ballistic-turret'], 2);

  const second = resolveAndApplyCombat(first.state, 'helion-01', input, resolutionContext);
  assert.equal(second.changed, false);
  assert.strictEqual(second.state, first.state);
});

test('production combat event bridge commits the resolver result without simulator coupling', () => {
  const initial = createInitialSaveState('production', 0);
  const priority = createDefaultCombatPriority();
  const input: CombatInput = {
    scenarioId: 'production-event-scenario',
    timestamp: '2026-09-13T00:00:00.000Z',
    attacker: {
      participant: { playerId: 'raider', playerName: 'Raider', side: 'attacker' },
      ships: [{ entityId: 'death-star', count: 1 }],
      commanders: [],
    },
    defender: {
      participant: { playerId: 'player-aster', playerName: 'Asterion', side: 'defender' },
      ships: [{ entityId: 'scout', count: 5 }],
      commanders: [],
      defenses: [{ entityId: 'ballistic-turret', count: 4 }],
    },
    maxRounds: 8,
    attackerPriority: [...priority.attack],
    defenderPriority: [...priority.defense],
  };
  const target = new EventTarget();
  let state = initial;
  const notices: string[] = [];
  const unbind = bindCombatResolutionEventBridge({
    target,
    getState: () => state,
    commit: (nextState) => { state = nextState; },
    onNotice: (notice) => notices.push(notice),
  });

  target.dispatchEvent(new CustomEvent(COMBAT_RESOLVE_REQUEST_EVENT, {
    detail: {
      planetId: 'helion-01',
      input,
      context: { reportId: 'production-event-report-1', missionType: 'defense' },
    },
  }));
  unbind();

  assert.equal(state.planets['helion-01'].repair.ships.scout, 3);
  assert.equal(state.planets['helion-01'].repair.defenses['ballistic-turret'], 2);
  assert.equal(notices.some((notice) => notice.includes('добавлены')), true);
});

test('attacker losses are not eligible while the report remains auditable', () => {
  const initial = createInitialSaveState('production', 0);
  const attackingReport = report({
    id: 'repair-application-attack-1',
    missionType: 'attack',
    attacker: { playerId: 'player-aster', playerName: 'Asterion', side: 'attacker' },
    defender: { playerId: 'raider', playerName: 'Raider', side: 'defender' },
  });

  const result = applyBattleResult(initial, 'helion-01', attackingReport);
  assert.equal(result.changed, true, 'the report is still recorded');
  assert.deepEqual(result.state.planets['helion-01'].repair, initial.planets['helion-01'].repair);
  assert.equal(result.report.repairEligibility?.status, 'unavailable');
  assert.equal(result.report.repairEligibility?.claimState, 'not-eligible');
  assert.deepEqual(result.state.planets['helion-01'].repair.claimedBattleIds, []);
});

test('repair application immediately changes owned fleet or spends tokens and survives persistence', () => {
  const initial = createInitialSaveState('test', 0);
  const withPool = {
    ...initial,
    planets: {
      ...initial.planets,
      'helion-01': {
        ...initial.planets['helion-01'],
        repair: {
          ...initial.planets['helion-01'].repair,
          ships: { ...initial.planets['helion-01'].repair.ships, scout: 2 },
        },
      },
    },
  };
  const repaired = repairUnits(withPool, 'helion-01', 'ship', 'scout', 2, 'resources');
  assert.equal(repaired.transition.ok, true);
  assert.equal(repaired.state.planets['helion-01'].fleet.ships.scout, 22);
  assert.equal(repaired.state.planets['helion-01'].repair.ships.scout, 0);
  assert.equal(repaired.state.metal, initial.metal - 9_600);
  assert.equal(repaired.state.minerals, initial.minerals - 6_400);

  const tokenPool = {
    ...repaired.state,
    planets: {
      ...repaired.state.planets,
      'helion-01': {
        ...repaired.state.planets['helion-01'],
        repair: {
          ...repaired.state.planets['helion-01'].repair,
          ships: { ...repaired.state.planets['helion-01'].repair.ships, scout: 1 },
          tokens: 31,
        },
      },
    },
  };
  const tokenRepair = repairUnits(tokenPool, 'helion-01', 'ship', 'scout', 1, 'tokens');
  assert.equal(tokenRepair.transition.ok, true);
  assert.equal(tokenRepair.state.planets['helion-01'].fleet.ships.scout, 23);
  assert.equal(tokenRepair.state.planets['helion-01'].repair.tokens, 30);
  assert.equal(tokenRepair.state.metal, repaired.state.metal);

  const storage = new MemoryStorage();
  const persistence = createPersistenceFacade({ mode: 'production', storage, now: () => 2_000 });
  assert.equal(persistence.write(tokenRepair.state).ok, true);
  const roundTripped = persistence.read();
  assert.equal(roundTripped.planets['helion-01'].fleet.ships.scout, 23);
  assert.equal(roundTripped.planets['helion-01'].repair.tokens, 30);
});
