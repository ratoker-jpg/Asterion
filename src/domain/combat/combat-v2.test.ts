import assert from 'node:assert/strict';
import test from 'node:test';

import { COMBAT_GOLDEN_FIXTURES } from './combat-golden-fixtures.ts';
import { createDefaultCombatPriority } from './priority.ts';
import { normalizeBattleReport } from './report.ts';
import { createSeededCombatRng, resolveCombat, selectCombatTarget } from './resolver.ts';
import { PLANET_HANGAR_CAPACITY } from './config.ts';
import {
  SIMULATOR_POPULATION_LIMIT,
  scenarioToCombatInput,
  validateCombatInput,
  type CombatInput,
} from './simulator.ts';
import { normalizeSimulatorScenario } from './simulator-repository.ts';
import {
  COMBAT_TECHNOLOGIES,
  createDefaultCombatTechnologies,
  normalizeCombatTechnologies,
} from './technologies.ts';

const priority = createDefaultCombatPriority();
const attackerParticipant = { playerId: 'a', playerName: 'A', side: 'attacker' as const };
const defenderParticipant = { playerId: 'd', playerName: 'D', side: 'defender' as const };

function input(overrides: Partial<CombatInput> = {}): CombatInput {
  return {
    scenarioId: 'combat-v2-test',
    timestamp: '2026-09-16T00:00:00.000Z',
    attacker: { participant: attackerParticipant, ships: [{ entityId: 'scout', count: 1 }], commanders: [] },
    defender: { participant: defenderParticipant, ships: [{ entityId: 'spy-probe', count: 2 }], commanders: [], defenses: [] },
    maxRounds: 8,
    attackerPriority: [...priority.attack],
    defenderPriority: [...priority.defense],
    ...overrides,
  };
}

test('the three 35,000 population caps are independent', () => {
  const valid = input({
    attacker: { participant: attackerParticipant, ships: [{ entityId: 'scout', count: 17_500 }], commanders: [] },
    defender: {
      participant: defenderParticipant,
      ships: [{ entityId: 'scout', count: 17_500 }],
      commanders: [],
      defenses: [{ entityId: 'ballistic-turret', count: 17_500 }],
    },
  });
  assert.equal(validateCombatInput(valid).ok, true);
  assert.equal(validateCombatInput(input({ attacker: { ...valid.attacker, ships: [{ entityId: 'scout', count: 17_501 }] } })).errors.some((error) => error.path === 'attacker'), true);
  assert.equal(validateCombatInput(input({ defender: { ...valid.defender, ships: [{ entityId: 'scout', count: 17_501 }] } })).errors.some((error) => error.path === 'defender'), true);
  assert.equal(validateCombatInput(input({ defender: { ...valid.defender, defenses: [{ entityId: 'ballistic-turret', count: 17_501 }] } })).errors.some((error) => error.path === 'defender.defenses'), true);
  assert.equal(SIMULATOR_POPULATION_LIMIT, 35_000);
  assert.equal(PLANET_HANGAR_CAPACITY, 25_112);
});

test('planet hangar capacity is evidence only and never becomes a combat cap', () => {
  const result = validateCombatInput(input({
    attacker: { participant: attackerParticipant, ships: [{ entityId: 'scout', count: 12_556 }], commanders: [] },
    defender: { participant: defenderParticipant, ships: [{ entityId: 'scout', count: 1 }], commanders: [], defenses: [] },
  }));
  assert.equal(result.ok, true);
  assert.equal(result.value.attacker.ships[0]?.count, 12_556);
});

test('one side may omit its commander and the commander level is retained', () => {
  const report = resolveCombat(input({
    attacker: {
      participant: attackerParticipant,
      ships: [{ entityId: 'scout', count: 1 }],
      commander: { entityId: 'corsair', count: 1, level: 40 },
      commanders: [],
    },
    defender: { participant: defenderParticipant, ships: [{ entityId: 'death-star', count: 1 }], commanders: [], defenses: [] },
  }), { reportId: 'commander-v2' });
  assert.equal(report.attackerForce.activeCommanderId, 'corsair');
  assert.equal(report.attackerForce.activeCommanderLevel, 40);
  assert.equal(report.defenderForce.activeCommanderId, undefined);
});

test('different commander types can coexist while each type is limited to one', () => {
  const result = validateCombatInput(input({
    attacker: {
      participant: attackerParticipant,
      ships: [{ entityId: 'scout', count: 1 }],
      commanders: [{ entityId: 'corsair', count: 1 }, { entityId: 'hunter', count: 1 }],
    },
  }));
  assert.equal(result.ok, true);
  assert.equal(validateCombatInput(input({
    attacker: {
      participant: attackerParticipant,
      ships: [{ entityId: 'scout', count: 1 }],
      commander: { entityId: 'corsair', count: 2 },
      commanders: [],
    },
  })).errors.some((error) => error.code === 'entity-limit'), true);
});

test('matrix and planetary shields may coexist but each is unique', () => {
  const bothShields = validateCombatInput(input({
    defender: {
      participant: defenderParticipant,
      ships: [{ entityId: 'scout', count: 1 }],
      commanders: [],
      defenses: [{ entityId: 'tower-shield', count: 1 }, { entityId: 'planetary-shield', count: 1 }],
    },
  }));
  assert.equal(bothShields.ok, true);

  const duplicateTower = validateCombatInput(input({
    defender: {
      participant: defenderParticipant,
      ships: [{ entityId: 'scout', count: 1 }],
      commanders: [],
      defenses: [{ entityId: 'tower-shield', count: 2 }],
    },
  }));
  assert.equal(duplicateTower.errors.some((error) => error.code === 'entity-limit' && error.path === 'defender.defenses[0].count'), true);

  const duplicatePlanetary = validateCombatInput(input({
    defender: {
      participant: defenderParticipant,
      ships: [{ entityId: 'scout', count: 1 }],
      commanders: [],
      defenses: [{ entityId: 'planetary-shield', count: 2 }],
    },
  }));
  assert.equal(duplicatePlanetary.errors.some((error) => error.code === 'entity-limit' && error.path === 'defender.defenses[0].count'), true);
});

test('explicit leading commander must be one of the selected commander types', () => {
  const report = resolveCombat(input({
    attacker: {
      participant: attackerParticipant,
      ships: [{ entityId: 'scout', count: 1 }],
      commanders: [{ entityId: 'corsair', count: 1 }, { entityId: 'hunter', count: 1 }],
      activeCommanderId: 'hunter',
    },
  }), { reportId: 'explicit-leading-commander' });
  assert.equal(report.attackerForce.activeCommanderId, 'hunter');
  assert.equal(validateCombatInput(input({
    attacker: {
      participant: attackerParticipant,
      ships: [{ entityId: 'scout', count: 1 }],
      commanders: [{ entityId: 'corsair', count: 1 }],
      activeCommanderId: 'hunter',
    },
  })).errors.some((error) => error.code === 'invalid-commander-selection'), true);
});

test('science maxima are real and additional technologies are mutually exclusive', () => {
  assert.deepEqual(Object.fromEntries(COMBAT_TECHNOLOGIES.map((technology) => [technology.id, technology.maxLevel])), {
    laserScience: 15,
    ionScience: 15,
    plasmaScience: 15,
    piercingAttack: 10,
    lightArmor: 10,
    mediumArmor: 10,
    heavyArmor: 10,
    shipArmor: 20,
    maneuverDefense: 10,
    criticalHit: 10,
  });
  const levels = normalizeCombatTechnologies({ laserScience: 99, piercingAttack: 99, shipArmor: 99 });
  assert.equal(levels.laserScience, 15);
  assert.equal(levels.piercingAttack, 10);
  assert.equal(levels.shipArmor, 20);

  const result = validateCombatInput(input({
    attackerTechnologies: { ...createDefaultCombatTechnologies(), piercingAttack: 1, criticalHit: 1 },
  }));
  assert.equal(result.errors.some((error) => error.code === 'exclusive-technology'), true);
});

test('shared technology mode applies the attacker profile to both force snapshots', () => {
  const report = resolveCombat(input({
    technologyMode: 'shared',
    executionMode: 'calibration',
    attackerTechnologies: normalizeCombatTechnologies({ laserScience: 4 }),
    defenderTechnologies: normalizeCombatTechnologies({ shipArmor: 5 }),
  }), { reportId: 'shared-tech' });
  assert.equal(report.metadata?.technologyMode, 'shared');
  assert.equal(report.defenderForce.technologyLevels?.laserScience, 4);
  assert.equal(report.defenderForce.technologyLevels?.shipArmor, 0);
});

test('independent technology mode retains separate force profiles', () => {
  const report = resolveCombat(input({
    technologyMode: 'independent',
    executionMode: 'calibration',
    attackerTechnologies: normalizeCombatTechnologies({ laserScience: 4 }),
    defenderTechnologies: normalizeCombatTechnologies({ shipArmor: 5 }),
  }), { reportId: 'independent-tech' });
  assert.equal(report.metadata?.technologyMode, 'independent');
  assert.equal(report.attackerForce.technologyLevels?.laserScience, 4);
  assert.equal(report.defenderForce.technologyLevels?.shipArmor, 5);
});

test('target priority is separate from commander priority and affects fallback selection', () => {
  const candidates = [
    { entityId: 'scout' as const, currentCount: 1, threat: 20, population: 1 },
    { entityId: 'battleship' as const, currentCount: 1, threat: 10, population: 10 },
  ];
  assert.equal(selectCombatTarget(candidates, 'threat')?.entityId, 'scout');
  assert.equal(selectCombatTarget(candidates, 'population')?.entityId, 'battleship');
  assert.equal(selectCombatTarget(candidates, 'catalog')?.entityId, 'scout');
  const report = resolveCombat(input({ attackerTargetPriority: 'catalog', defenderTargetPriority: 'population' }), { reportId: 'target-priority' });
  assert.deepEqual(report.metadata?.targetPriority, { attacker: 'catalog', defender: 'population' });
  assert.equal(report.metadata?.provenance?.targetSelection?.status, 'not-calibrated');
});

test('seeded RNG is deterministic and its provenance is serializable', () => {
  const first = createSeededCombatRng('battle-seed');
  const second = createSeededCombatRng('battle-seed');
  assert.deepEqual([first.next(), first.next(), first.next()], [second.next(), second.next(), second.next()]);
  assert.deepEqual(first.provenance(), { mode: 'seeded', algorithmVersion: 'asterion-xorshift32-v1', seed: 'battle-seed', drawCount: 3 });

  const report = resolveCombat(input({ seed: 'battle-seed' }), { reportId: 'seeded-report' });
  assert.equal(report.metadata?.rngProvenance?.mode, 'seeded');
  assert.equal(report.metadata?.rngProvenance?.seed, 'battle-seed');
});

test('runs without a seed are explicitly non-replayable', () => {
  const report = resolveCombat(input(), { reportId: 'unseeded-report' });
  assert.equal(report.metadata?.rngProvenance?.mode, 'non-replayable');
  assert.equal(report.metadata?.rngProvenance?.seed, undefined);
});

test('report event sequences are unique and monotonic across rounds', () => {
  const report = resolveCombat(input({
    attacker: { participant: attackerParticipant, ships: [{ entityId: 'solar-satellite', count: 1 }], commanders: [] },
    defender: { participant: defenderParticipant, ships: [{ entityId: 'solar-satellite', count: 1 }], commanders: [], defenses: [] },
    maxRounds: 5,
  }), { reportId: 'sequence-report' });
  const sequences = report.rounds.flatMap((round) => round.events.map((event) => event.sequence));
  assert.deepEqual(sequences, [...sequences].sort((left, right) => left - right));
  assert.equal(new Set(sequences).size, sequences.length);
  assert.equal(typeof report.rounds[0]?.summary?.attackerDamage, 'number');
  assert.equal(typeof report.rounds[0]?.summary?.survivingPopulation?.attacker, 'number');
});

test('defense remains a separate force and round snapshot bucket', () => {
  const report = resolveCombat(input({
    attacker: { participant: attackerParticipant, ships: [{ entityId: 'scout', count: 1 }], commanders: [] },
    defender: { participant: defenderParticipant, ships: [{ entityId: 'scout', count: 1 }], commanders: [], defenses: [{ entityId: 'ballistic-turret', count: 1 }] },
  }), { reportId: 'defense-snapshot' });
  assert.equal(report.attackerForce.defenses, undefined);
  assert.equal(report.defenderForce.defenses?.[0]?.entityId, 'ballistic-turret');
  assert.equal(report.defenderForce.fleetPopulationBefore, 2);
  assert.equal(report.defenderForce.defensePopulationBefore, 2);
  assert.equal(report.rounds[0]?.defenderSnapshot?.defenses?.[0]?.entityId, 'ballistic-turret');
  assert.equal(report.rounds[0]?.defenderSnapshot?.defensePopulationBefore, 2);
  assert.equal(report.rounds[0]?.summary?.survivingDefensePopulation, 2);
});

test('faction-specific combat population and stats reach the resolver', () => {
  const report = resolveCombat(input({
    attacker: {
      participant: attackerParticipant,
      factionId: 'synod',
      ships: [{ entityId: 'destroyer', count: 1 }],
      commanders: [],
    },
    defender: { participant: defenderParticipant, ships: [{ entityId: 'solar-satellite', count: 1 }], commanders: [], defenses: [] },
  }), { reportId: 'faction-runtime' });
  assert.equal(report.attackerForce.populationBefore, 28);
  assert.equal(report.rounds[0]?.events.find((event) => event.actorEntityId === 'destroyer')?.attackValue, 18_200);
});

test('legacy reports migrate with unknown provenance and without fabricated numeric values', () => {
  const legacy = {
    id: 'legacy-report',
    timestamp: '2026-09-16T00:00:00.000Z',
    missionType: 'simulation',
    attacker: attackerParticipant,
    defender: defenderParticipant,
    winner: 'draw',
    roundCount: 0,
    attackerForce: { populationBefore: 0, populationAfter: 0, stacks: [] },
    defenderForce: { populationBefore: 0, populationAfter: 0, stacks: [] },
    rounds: [
      { index: 1, events: [{ sequence: 1 }] },
      { index: 1, events: [{ sequence: 1 }] },
    ],
  };
  const migrated = normalizeBattleReport(legacy);
  assert.equal(migrated?.schemaVersion, 1);
  assert.equal(migrated?.metadata?.rngProvenance?.mode, 'non-replayable');
  assert.equal(migrated?.experience, undefined);
  assert.equal(migrated?.metadata?.unknowns?.length, 1);
  assert.deepEqual(migrated?.rounds.map((round) => round.index), [1, 2]);
  assert.deepEqual(migrated?.rounds.flatMap((round) => round.events.map((event) => event.sequence)), [1, 2]);
});

test('legacy scenarios retain multiple commanders and the new per-type rule permits them', () => {
  const legacy = normalizeSimulatorScenario({
    attacker: {
      ships: [{ entityId: 'scout', count: 1 }],
      commanders: [{ entityId: 'corsair', count: 1 }, { entityId: 'hunter', count: 1 }],
    },
    defender: { ships: [{ entityId: 'scout', count: 1 }], commanders: [], defenses: [] },
    maxRounds: 5,
  });
  assert.equal(legacy.attacker.commanders.length, 2);
  const combatInput = scenarioToCombatInput(legacy, {
    scenarioId: 'legacy-multiple-commanders',
    timestamp: '2026-09-16T00:00:00.000Z',
    attacker: attackerParticipant,
    defender: defenderParticipant,
    priority,
  });
  assert.equal(combatInput.attacker.commanders?.length, 2);
  const checked = validateCombatInput(combatInput);
  assert.equal(checked.ok, true);
});

test('destroyed stacks emit a skipped-volley status and never attack', () => {
  const report = resolveCombat(input({
    attacker: { participant: attackerParticipant, ships: [{ entityId: 'death-star', count: 1 }], commanders: [] },
    defender: {
      participant: defenderParticipant,
      ships: [{ entityId: 'solar-satellite', count: 1 }, { entityId: 'spy-probe', count: 1 }],
      commanders: [],
      defenses: [],
    },
    attackerTargetPriority: 'catalog',
  }), { reportId: 'skipped-volley' });
  const skipped = report.rounds[0]?.events.find((event) => event.actorSide === 'defender' && event.actorEntityId === 'solar-satellite');
  assert.equal(skipped?.actionType, 'status');
  assert.match(skipped?.note ?? '', /пропущен/);
  assert.equal(report.rounds.flatMap((round) => round.events).some((event) => event.actorSide === 'defender' && event.actorEntityId === 'solar-satellite' && event.actionType === 'attack'), false);
});

test('golden victory, defeat, and draw fixtures preserve provenance and structural invariants', () => {
  const expectedWinners = {
    victory: 'attacker',
    defeat: 'defender',
    draw: 'draw',
  } as const;

  Object.entries(COMBAT_GOLDEN_FIXTURES).forEach(([fixtureName, report]) => {
    assert.equal(report.winner, expectedWinners[fixtureName as keyof typeof expectedWinners]);
    assert.equal(report.schemaVersion, 2);
    assert.equal(report.engineVersion, 'asterion-combat-engine-v2');
    assert.equal(report.metadata?.rngProvenance?.mode, 'seeded');
    assert.equal(report.metadata?.provenance?.damageFormula?.status, 'inferred');

    const events = report.rounds.flatMap((round) => round.events);
    const sequences = events.map((event) => event.sequence);
    assert.deepEqual(sequences, [...sequences].sort((left, right) => left - right));
    assert.equal(new Set(sequences).size, sequences.length);
    events.forEach((event) => {
      if (event.rawDamage !== undefined) assert.ok(event.rawDamage >= 0);
      if (event.effectiveDamage !== undefined) assert.ok(event.effectiveDamage >= 0);
      if (event.destroyedCount !== undefined) assert.ok(event.destroyedCount >= 0);
    });
    report.rounds.forEach((round) => {
      [...(round.attackerSnapshot?.stacks ?? []), ...(round.defenderSnapshot?.stacks ?? []), ...(round.defenderSnapshot?.defenses ?? [])]
        .forEach((stack) => assert.equal(stack.countAfter + stack.destroyed, stack.countBefore));
    });
  });
});
