import assert from 'node:assert/strict';
import test from 'node:test';

import { createDefaultBuildingLevels } from '../buildings/resource-zone.ts';
import { createEmptyDefenseState } from '../fleet/production.ts';
import { createEmptyFleetState } from '../fleet/runtime.ts';
import type { CombatFactionId } from './factions.ts';
import { getFactionCombatEntity } from './faction-catalog.ts';
import { createDefaultCombatPriority } from './priority.ts';
import { resolveCombat } from './resolver.ts';
import type { BattleReport } from './report.ts';
import type { CombatInput } from './simulator.ts';
import {
  getPlanetSiegeDemolitionThreshold,
  resolvePlanetSiege,
  type PlanetSiegeContext,
} from './planet-siege.ts';
import type { SpyTargetState } from '../espionage/types.ts';

const factions: readonly CombatFactionId[] = ['aegis', 'synod', 'veyra'];

function target(overrides: Partial<SpyTargetState> = {}): SpyTargetState {
  return {
    id: 'target-planet',
    name: 'Цель',
    coordinate: { galaxy: 1, system: 2, position: 3 },
    ownerId: 'owner-1',
    ownerName: 'Владелец',
    raceId: 'aegis',
    alliance: null,
    kind: 'npc',
    espionageLevel: 3,
    resources: { metal: 10_000, minerals: 10_000, gas: 10_000, debris: 0, developmentEnergy: 0 },
    buildings: { ...createDefaultBuildingLevels(), construction: 2, shipyard: 1, research: 3 },
    fleet: createEmptyFleetState(),
    defense: createEmptyDefenseState(),
    commanders: {},
    population: { total: 0, fleet: 0, defense: 0 },
    hunterLevel: 0,
    ...overrides,
  };
}

function report(overrides: Partial<BattleReport> = {}): BattleReport {
  return {
    id: 'battle-planet-siege',
    schemaVersion: 3,
    timestamp: '2026-09-21T00:00:00.000Z',
    missionType: 'attack',
    attacker: { playerId: 'attacker', playerName: 'Атакующий', side: 'attacker', race: 'Астеры' },
    defender: { playerId: 'defender', playerName: 'Защитник', side: 'defender', race: 'Астеры' },
    winner: 'attacker',
    roundCount: 1,
    attackerForce: {
      populationBefore: 700,
      populationAfter: 700,
      stacks: [{ entityId: 'death-star', countBefore: 1, countAfter: 1, destroyed: 0, level: 10 }],
    },
    defenderForce: {
      populationBefore: 0,
      populationAfter: 0,
      stacks: [],
      defensePopulationAfter: 0,
    },
    rounds: [{ index: 1, events: [] }],
    ...overrides,
  };
}

function context(overrides: Partial<PlanetSiegeContext> = {}): PlanetSiegeContext {
  return {
    seed: 'siege-test',
    reportId: 'battle-planet-siege',
    attackerFleetId: 'flight-planet-siege',
    attackerFactionId: 'aegis',
    defenderFactionId: 'aegis',
    targetOwnerPlanetCount: 2,
    eventSequence: 1,
    ...overrides,
  };
}

function findSeed(predicate: (seed: string) => boolean) {
  for (let index = 0; index < 10_000; index += 1) {
    const seed = `siege-seed-${index}`;
    if (predicate(seed)) return seed;
  }
  assert.fail('No deterministic siege seed matched the requested roll');
}

function levelInput(factionId: CombatFactionId, level: number): CombatInput {
  const priority = createDefaultCombatPriority();
  return {
    scenarioId: `death-star-level-${factionId}-${level}`,
    timestamp: '2026-09-21T00:00:00.000Z',
    attacker: {
      participant: { playerId: 'a', playerName: 'A', side: 'attacker', race: factionId },
      factionId,
      ships: [{ entityId: 'death-star', count: 1, level }],
      commanders: [],
    },
    defender: {
      participant: { playerId: 'd', playerName: 'D', side: 'defender', race: 'aegis' },
      factionId: 'aegis',
      ships: [{ entityId: 'scout', count: 1 }],
      commanders: [],
      defenses: [],
    },
    maxRounds: 5,
    attackerPriority: [...priority.attack],
    defenderPriority: [...priority.defense],
    executionMode: 'production',
    seed: `level-${factionId}-${level}`,
  };
}

test('death-star combat level uses 15 percent attack and life coefficient for every faction without armor scaling', () => {
  for (const factionId of factions) {
    const base = getFactionCombatEntity(factionId, 'death-star');
    const levelZero = resolveCombat(levelInput(factionId, 0), { reportId: `level-zero-${factionId}` }).attackerForce.stacks.find((stack) => stack.entityId === 'death-star');
    assert.ok(levelZero);
    for (const level of [1, 5, 10]) {
      const stack = resolveCombat(levelInput(factionId, level), { reportId: `level-${factionId}-${level}` }).attackerForce.stacks.find((candidate) => candidate.entityId === 'death-star');
      assert.ok(stack);
      assert.equal(stack.attackPerUnit, Math.floor(base.combat.attack * (1 + 0.15 * level)));
      assert.equal(stack.lifePerUnit, Math.floor(base.combat.life * (1 + 0.15 * level)));
      assert.equal(stack.armor, levelZero.armor);
    }
    assert.equal(levelZero.attackPerUnit, base.combat.attack);
    assert.equal(levelZero.lifePerUnit, base.combat.life);
  }
});

test('demolition table keeps every contract boundary', () => {
  const expected = [
    [0, 0, 0], [19, 0, 0], [20, 2_000, 1], [100, 2_000, 1],
    [101, 4_000, 1], [200, 4_000, 1], [201, 6_000, 1], [400, 6_000, 1],
    [401, 5_000, 2], [550, 5_000, 2], [551, 7_000, 2], [700, 7_000, 2],
    [701, 5_000, 3], [850, 5_000, 3], [851, 6_000, 5], [1_000, 6_000, 5], [1_001, 3_300, 'all'],
  ] as const;
  for (const [points, chance, selected] of expected) {
    const threshold = getPlanetSiegeDemolitionThreshold(points);
    assert.deepEqual([threshold.chanceBps, threshold.selectedBuildings], [chance, selected]);
  }
});

test('demolition scales faction profile, subtracts defense population, and allows draw only for demolition', () => {
  const draw = resolvePlanetSiege(
    report({
      winner: 'draw',
      attackerForce: { ...report().attackerForce, stacks: [{ entityId: 'death-star', countBefore: 1, countAfter: 1, destroyed: 0, level: 5 }] },
      defenderForce: { ...report().defenderForce, defensePopulationAfter: 5_000 },
    }),
    target({ buildings: { ...createDefaultBuildingLevels(), construction: 3 } }),
    context({ attackerFactionId: 'synod' }),
  );
  assert.equal(draw.report.attackerDestroyers[0]?.scaledDemolitionPoints, 45);
  assert.equal(draw.report.demolition.rawPoints, 45);
  assert.equal(draw.report.demolition.defenseReductionPoints, 200);
  assert.equal(draw.report.demolition.finalPoints, 0);
  assert.equal(draw.report.demolition.blockedReason, undefined);
  assert.equal(draw.report.destruction.blockedReason, 'BATTLE_RESULT_INELIGIBLE');

  const defeat = resolvePlanetSiege(report({ winner: 'defender' }), target(), context());
  assert.equal(defeat.report.demolition.blockedReason, 'BATTLE_RESULT_INELIGIBLE');
  assert.equal(defeat.report.destruction.blockedReason, 'BATTLE_RESULT_INELIGIBLE');
});

test('demolition rolls independently, applies Annihilator, drops one level, and cancels queue without refund', () => {
  const queued = {
    kind: 'building' as const,
    id: 'queue-construction',
    assetRole: 'construction' as const,
    planetId: 'target-planet',
    enqueuedAt: 1,
    startedAt: 1,
    finishAt: 2,
    targetLevel: 3,
    durationMs: 1,
  };
  const baseTarget = target({
    buildings: { ...createDefaultBuildingLevels(), construction: 2, shipyard: 1, research: 3 },
    buildingQueue: [queued],
    endgameLockedBuildings: ['research'],
  });
  const baseReport = report({
    attackerForce: {
      ...report().attackerForce,
      activeCommanderId: 'annihilator',
      activeCommanderLevel: 10,
      stacks: [{ entityId: 'death-star', countBefore: 11, countAfter: 11, destroyed: 0, level: 10 }],
    },
  });
  const seed = findSeed((candidate) => resolvePlanetSiege(baseReport, baseTarget, context({ seed: candidate })).report.demolition.rolls.some((roll) => roll.buildingId === 'construction' && roll.success));
  const first = resolvePlanetSiege(baseReport, baseTarget, context({ seed }));
  const second = resolvePlanetSiege(baseReport, baseTarget, context({ seed }));
  assert.deepEqual(first, second);
  assert.equal(first.report.demolition.baseChanceBps, 3_300);
  assert.equal(first.report.demolition.annihilatorBonusBps, 500);
  assert.equal(first.report.demolition.rolls.some((roll) => roll.buildingId === 'research'), false);
  const successful = first.report.demolition.rolls.find((roll) => roll.success);
  assert.ok(successful);
  assert.equal(successful.buildingId, 'construction');
  assert.equal(first.target.buildings.construction, 1);
  assert.deepEqual(first.target.buildingQueue, []);
  assert.equal(first.target.buildings.research, 3);
});

test('planet destruction calculates all reductions before last-colony protection and removes only on a successful eligible roll', () => {
  const reduced = resolvePlanetSiege(
    report({
      attackerForce: { ...report().attackerForce, stacks: [{ entityId: 'death-star', countBefore: 2, countAfter: 2, destroyed: 0, level: 10 }] },
      defenderForce: {
        ...report().defenderForce,
        activeCommanderId: 'polias',
        activeCommanderLevel: 10,
        defensePopulationAfter: 1_000,
        stacks: [{ entityId: 'death-star', countBefore: 1, countAfter: 1, destroyed: 0, level: 10 }],
      },
    }),
    target(),
    context({ targetOwnerPlanetCount: 2 }),
  );
  assert.equal(reduced.report.destruction.rawChanceBps, 600);
  assert.equal(reduced.report.destruction.defenseReductionBps, 100);
  assert.equal(reduced.report.destruction.defenderDestroyerReductionBps, 300);
  assert.equal(reduced.report.destruction.poliasReductionBps, 250);
  assert.equal(reduced.report.destruction.finalChanceBps, 0);
  assert.equal(reduced.report.destruction.blockedReason, 'ZERO_FINAL_CHANCE');

  const lastColony = resolvePlanetSiege(report(), target(), context({ targetOwnerPlanetCount: 1 }));
  assert.equal(lastColony.report.destruction.rawChanceBps, 300);
  assert.equal(lastColony.report.destruction.finalChanceBps, 300);
  assert.equal(lastColony.report.destruction.blockedReason, 'LAST_COLONY_PROTECTED');
  assert.equal(lastColony.planetDestroyed, false);

  const destroyerReport = report({
    attackerForce: { ...report().attackerForce, stacks: [{ entityId: 'death-star', countBefore: 10, countAfter: 10, destroyed: 0, level: 10 }] },
  });
  const seed = findSeed((candidate) => resolvePlanetSiege(destroyerReport, target(), context({ seed: candidate })).planetDestroyed);
  const destroyed = resolvePlanetSiege(destroyerReport, target(), context({ seed }));
  assert.equal(destroyed.report.destruction.finalChanceBps, 3_000);
  assert.equal(destroyed.report.destruction.status, 'destroyed');
  assert.equal(destroyed.planetDestroyed, true);
});
