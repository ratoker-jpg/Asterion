import assert from 'node:assert/strict';
import test from 'node:test';
import { COMMANDER_COMBAT_CATALOG } from '../combat/catalog.ts';
import { createDefaultCombatTechnologies } from '../combat/technologies.ts';
import type { AttackLaunchSnapshot } from '../attack/types.ts';
import { PIRATE_BASE_SHIPS, type PirateBaseShipId } from './catalog.ts';
import {
  PIRATE_ELIMINATION_NO_TARGET_MESSAGE,
  resolvePirateEliminationEncounter,
  type PirateEliminationEncounterInput,
} from './encounter.ts';
import { createPirateProfile } from './profile.ts';

function snapshot(overrides: Partial<AttackLaunchSnapshot> = {}): AttackLaunchSnapshot {
  return {
    version: 1,
    maxRounds: 12,
    attackerFactionId: 'aegis',
    attackerTechnologies: {
      ...createDefaultCombatTechnologies(),
      laserScience: 3,
      shipArmor: 2,
      piercingAttack: 1,
    },
    attackerShipLevels: { scout: 4, cruiser: 2, 'death-star': 1 },
    attackerCommanderLevels: { corsair: 2, hunter: 1 },
    attackerPriority: ['corsair', 'hunter'],
    ...overrides,
  };
}

function profile(ownerId: string, cycle = 'system-4/cycle-8', resourcePoints = 1_000) {
  return createPirateProfile({
    ownerId,
    contactCycleKey: cycle,
    score: { resourcePoints, battlePoints: 0, totalPoints: resourcePoints },
  });
}

type EncounterOverrides = Partial<Omit<PirateEliminationEncounterInput, 'attacker'>> & {
  attacker?: Partial<PirateEliminationEncounterInput['attacker']>;
};

function encounter(overrides: EncounterOverrides = {}): PirateEliminationEncounterInput {
  const ownerId = overrides.attacker?.playerId ?? 'player-a';
  const cycle = overrides.contactCycleKey ?? 'system-4/cycle-8';
  return {
    reportId: 'pirate-elimination-test-report',
    timestamp: '2026-10-15T12:00:00.000Z',
    seed: 'pirate-elimination-test-seed',
    contactCycleKey: cycle,
    pirateProfile: profile(ownerId, cycle),
    piratePlanetName: 'Пиратский узел',
    pirateCoordinates: '4:12:8',
    ...overrides,
    attacker: {
      playerId: ownerId,
      playerName: 'Астер',
      planetName: 'Рубеж',
      coordinates: '4:11:8',
      selectedShips: { scout: 2_000, transporter: 700, recycler: 400, 'spy-probe': 500, 'solar-satellite': 900 },
      selectedCommanders: { corsair: 1, hunter: 1 },
      snapshot: snapshot(),
      ...overrides.attacker,
    },
  };
}

test('elimination freezes only combat ships and selected commanders, and builds all six pirate garrison entries', () => {
  const input = encounter();
  const result = resolvePirateEliminationEncounter(input);
  assert.equal(result.kind, 'resolved');
  if (result.kind !== 'resolved') return;

  const commanderPopulation = COMMANDER_COMBAT_CATALOG
    .filter((entity) => entity.id === 'corsair' || entity.id === 'hunter')
    .reduce((total, entity) => total + entity.population, 0);
  assert.equal(result.sentCombatPopulation, 2_000 * 2 + commanderPopulation);
  assert.equal(result.populationBudget.targetPopulation, Math.round(result.sentCombatPopulation * 0.9));
  assert.equal(result.populationBudget.actualPopulation, PIRATE_BASE_SHIPS.reduce(
    (total, ship) => total + result.pirateGarrison[ship.id as PirateBaseShipId] * ship.population,
    0,
  ));
  assert.deepEqual(Object.keys(result.pirateGarrison), PIRATE_BASE_SHIPS.map((ship) => ship.id));
  assert.deepEqual(result.combatInput.defender.ships.map((stack) => stack.entityId), PIRATE_BASE_SHIPS.map((ship) => ship.id));
  assert.equal(result.combatInput.defender.defenses, undefined);
  assert.equal(result.combatInput.defender.ships.some((stack) => stack.entityId === 'pirate-planet-breaker'), false);
  assert.equal(result.combatInput.defender.participant.race, 'pirates');
  assert.equal(result.combatInput.attacker.participant.race, 'Астеры');
  assert.equal(result.combatInput.attacker.factionId, 'aegis');
  assert.equal(result.report.missionType, 'pirate-elimination');
  assert.equal(result.report.attacker.race, 'Астеры');
  assert.equal(result.report.defender.race, 'pirates');
  assert.equal(result.combatInput.attacker.ships.some((stack) => stack.entityId === 'transporter' || stack.entityId === 'recycler' || stack.entityId === 'spy-probe' || stack.entityId === 'solar-satellite'), false);
  assert.equal(result.report.initialSnapshot?.attacker.stacks.find((stack) => stack.entityId === 'scout')?.level, 4);
  assert.equal(result.report.initialSnapshot?.attacker.stacks.find((stack) => stack.entityId === 'corsair')?.level, 2);
  assert.equal(result.report.initialSnapshot?.attacker.stacks.find((stack) => stack.entityId === 'hunter')?.countBefore, 1);
  assert.equal(result.report.defenderForce.stacks.every((stack) => stack.level === result.pirateProfile.shipLevel), true);
  assert.deepEqual(result.report.attackerForce.technologyLevels, input.attacker.snapshot.attackerTechnologies);
  assert.deepEqual(result.report.defenderForce.technologyLevels, result.pirateProfile.technologies);
  assert.equal(Object.isFrozen(result.combatInput), true);
  assert.equal(Object.isFrozen(result.combatInput.attacker.ships), true);
});

test('two owners use their own persisted profile for one shared contact cycle', () => {
  const cycle = 'system-4/cycle-shared';
  const ownerA = resolvePirateEliminationEncounter(encounter({
    contactCycleKey: cycle,
    pirateProfile: profile('player-a', cycle, 1_000),
  }));
  const ownerB = resolvePirateEliminationEncounter(encounter({
    contactCycleKey: cycle,
    pirateProfile: profile('player-b', cycle, 10_000_000),
    attacker: { playerId: 'player-b' },
  }));
  assert.equal(ownerA.kind, 'resolved');
  assert.equal(ownerB.kind, 'resolved');
  if (ownerA.kind !== 'resolved' || ownerB.kind !== 'resolved') return;

  assert.equal(ownerA.pirateProfile.ownerId, 'player-a');
  assert.equal(ownerB.pirateProfile.ownerId, 'player-b');
  assert.equal(ownerA.pirateProfile.contactCycleKey, ownerB.pirateProfile.contactCycleKey);
  assert.notEqual(ownerA.pirateProfile.shipLevel, ownerB.pirateProfile.shipLevel);
  assert.notDeepEqual(ownerA.pirateProfile.technologies, ownerB.pirateProfile.technologies);
  assert.equal(ownerA.report.defenderForce.stacks[0]?.level, ownerA.pirateProfile.shipLevel);
  assert.equal(ownerB.report.defenderForce.stacks[0]?.level, ownerB.pirateProfile.shipLevel);
});

test('a missing or stale pirate profile returns no-target without resolving a battle', () => {
  const missing = resolvePirateEliminationEncounter(encounter({ pirateProfile: null }));
  assert.deepEqual(missing, {
    kind: 'no-target',
    reason: 'missing-profile',
    message: PIRATE_ELIMINATION_NO_TARGET_MESSAGE,
  });

  const stale = resolvePirateEliminationEncounter(encounter({
    contactCycleKey: 'system-4/cycle-new',
    pirateProfile: profile('player-a', 'system-4/cycle-old'),
  }));
  assert.deepEqual(stale, {
    kind: 'no-target',
    reason: 'stale-contact-cycle',
    message: PIRATE_ELIMINATION_NO_TARGET_MESSAGE,
  });
});

test('a support-only flight is safely rejected instead of winning against an empty garrison', () => {
  const result = resolvePirateEliminationEncounter(encounter({
    attacker: {
      playerId: 'player-a',
      playerName: 'Астер',
      selectedShips: { transporter: 20, recycler: 20, 'spy-probe': 20, 'solar-satellite': 20 },
      selectedCommanders: {},
      snapshot: snapshot(),
    },
  }));
  assert.equal(result.kind, 'rejected');
  if (result.kind !== 'rejected') return;
  assert.equal(result.reason, 'zero-garrison-budget');
  assert.equal(result.sentCombatPopulation, 0);
  assert.equal(result.populationBudget?.targetPopulation, 0);
  assert.equal(result.populationBudget?.actualPopulation, 0);
});

test('victory requires the shared resolver to wipe the complete pirate garrison', () => {
  const winningResult = resolvePirateEliminationEncounter(encounter({
    attacker: {
      playerId: 'player-a',
      playerName: 'Астер',
      selectedShips: { 'death-star': 50 },
      selectedCommanders: {},
      snapshot: snapshot({ maxRounds: 12 }),
    },
    pirateProfile: profile('player-a', 'system-4/cycle-8', 1_000),
  }));
  assert.equal(winningResult.kind, 'resolved');
  if (winningResult.kind !== 'resolved') return;
  assert.equal(winningResult.report.winner, 'attacker');
  assert.equal(winningResult.report.defenderForce.populationAfter, 0);
  assert.equal(winningResult.victory, true);

  const partialResult = resolvePirateEliminationEncounter(encounter({
    attacker: {
      playerId: 'player-a',
      playerName: 'Астер',
      selectedShips: { scout: 200 },
      selectedCommanders: {},
      snapshot: snapshot({ maxRounds: 5 }),
    },
    pirateProfile: profile('player-a', 'system-4/cycle-8', 10_000_000),
  }));
  assert.equal(partialResult.kind, 'resolved');
  if (partialResult.kind !== 'resolved') return;
  assert.equal(partialResult.victory, partialResult.report.winner === 'attacker'
    && partialResult.report.defenderForce.populationAfter === 0);
  if (!partialResult.victory) assert.equal(partialResult.report.defenderForce.populationAfter > 0, true);
});
