import assert from 'node:assert/strict';
import test from 'node:test';

import { createDefaultCombatPriority } from './priority.ts';
import { resolveCombat } from './resolver.ts';
import { validateCombatInput, type CombatInput } from './simulator.ts';
import { getCombatEntityForStack } from './side-entity.ts';
import { createPirateProfile, PIRATE_EXCLUSIVE_TECHNOLOGIES } from '../pirates/profile.ts';
import { PIRATE_CATALOG_BY_ID } from '../pirates/catalog.ts';
import { SHIP_IDS } from './ids.ts';
import { createBattleReportViewModel } from './battle-report-view-model.ts';
import { DEMO_BATTLE_REPORTS } from './battle-fixtures.ts';
import { recordBattleScoreAward } from '../rating/scoring.ts';
import { createDefaultRatingPrototypeState } from '../rating/fixtures.ts';

const priority = createDefaultCombatPriority();
const attacker = { playerId: 'pirate-npc', playerName: 'Пираты', race: 'pirates', side: 'attacker' as const };
const defender = { playerId: 'owner-a', playerName: 'Владелец', race: 'aegis', side: 'defender' as const };
const snapshot = createPirateProfile({ ownerId: 'owner-a', contactCycleKey: '1:4/cycle-7', score: { resourcePoints: 6_000_000, battlePoints: 0, totalPoints: 6_000_000 } });

function input(overrides: Partial<CombatInput> = {}): CombatInput {
  return {
    scenarioId: 'pirate-adapter', timestamp: '2026-10-04T00:00:00.000Z',
    attacker: { participant: attacker, combatProfile: { kind: 'pirate', snapshot }, ships: [{ entityId: 'pirate-hound', count: 2_000 }], commanders: [] },
    defender: { participant: defender, factionId: 'aegis', ships: [{ entityId: 'scout', count: 2_000 }], commanders: [], defenses: [] },
    maxRounds: 5, attackerPriority: [...priority.attack], defenderPriority: [...priority.defense], seed: 'pirate-replay',
    ...overrides,
  };
}

test('pirate entities are explicit side-only combat stacks outside player ship IDs', () => {
  assert.equal((SHIP_IDS as readonly string[]).includes('pirate-hound'), false);
  assert.deepEqual(getCombatEntityForStack('pirate-hound').combat, PIRATE_CATALOG_BY_ID['pirate-hound'].combat);
  const invalid = validateCombatInput(input({ attacker: { participant: attacker, ships: [{ entityId: 'pirate-hound', count: 1 }], commanders: [] } }));
  assert.equal(invalid.ok, false);
  assert.ok(invalid.errors.some((error) => error.path === 'attacker.ships' || error.path === 'attacker.ships[0].entityId'));
});

test('resolver preserves pirate catalog stats, profile levels, technology branch, and replay', () => {
  const first = resolveCombat(input(), { reportId: 'pirate-replay', missionType: 'pirate-raid' });
  const second = resolveCombat(input(), { reportId: 'pirate-replay', missionType: 'pirate-raid' });
  assert.deepEqual(first, second);
  assert.equal(first.missionType, 'pirate-raid');
  const view = createBattleReportViewModel(first);
  assert.equal(view.attacker.stacks.find((stack) => stack.entityId === 'pirate-hound')?.name, 'Гончий');
  assert.equal(view.battlePoints.attacker, 0);
  assert.equal(view.battlePoints.defender, 0);
  assert.equal(view.awardedBattlePoints?.attacker, 0);
  assert.equal(view.awardedBattlePoints?.defender, 0);
  const initial = first.initialSnapshot!.attacker.stacks.find((stack) => stack.entityId === 'pirate-hound')!;
  assert.equal(initial.level, snapshot.shipLevel);
  assert.equal(initial.lifePerUnit, first.attackerForce.stacks.find((stack) => stack.entityId === 'pirate-hound')!.lifePerUnit);
  const attack = first.rounds.flatMap((round) => round.events).find((event) => event.actorEntityId === 'pirate-hound' && event.actionType === 'attack')!;
  assert.equal(attack.abilityChance, Math.min(PIRATE_CATALOG_BY_ID['pirate-hound'].ability.kind === 'ignore-armor' ? PIRATE_CATALOG_BY_ID['pirate-hound'].ability.chanceCap : 0, 2_000 * (PIRATE_CATALOG_BY_ID['pirate-hound'].ability.kind === 'ignore-armor' ? PIRATE_CATALOG_BY_ID['pirate-hound'].ability.perShipChance : 0)));
  assert.ok(attack.shipAbilityId === undefined || attack.shipAbilityId === 'pirate-armor-piercing');
  assert.equal(first.attackerForce.technologies?.[snapshot.exclusiveTechnologyId], 10);
  for (const tech of PIRATE_EXCLUSIVE_TECHNOLOGIES.filter((id) => id !== snapshot.exclusiveTechnologyId)) assert.equal(first.attackerForce.technologies?.[tech], 0);

  const elimination = resolveCombat(input({
    attacker: { participant: { ...defender, side: 'attacker' }, factionId: 'aegis', ships: [{ entityId: 'scout', count: 1_000 }], commanders: [] },
    defender: { participant: { ...attacker, side: 'defender' }, combatProfile: { kind: 'pirate', snapshot }, ships: [{ entityId: 'pirate-hound', count: 500 }], commanders: [] },
  }), { reportId: 'pirate-elimination', missionType: 'pirate-elimination' });
  assert.equal(elimination.missionType, 'pirate-elimination');
  assert.equal(elimination.defenderForce.stacks.some((stack) => stack.entityId === 'pirate-hound'), true);
});

test('planet breaker is restricted to one incoming pirate raid stack', () => {
  const profile = { kind: 'pirate' as const, snapshot };
  const breakerInput = input({
    attacker: { participant: attacker, combatProfile: profile, ships: [{ entityId: 'pirate-planet-breaker', count: 1 }], commanders: [] },
  });
  assert.equal(validateCombatInput(breakerInput, { missionType: 'pirate-elimination' }).ok, false);
  assert.equal(validateCombatInput(breakerInput, { missionType: 'pirate-raid' }).ok, true);
  const duplicate = input({
    attacker: { participant: attacker, combatProfile: profile, ships: [{ entityId: 'pirate-planet-breaker', count: 2 }], commanders: [] },
  });
  assert.equal(validateCombatInput(duplicate, { missionType: 'pirate-raid' }).ok, false);
});

test('pirate passive and proc abilities stay on pirate stacks and use defense/critical restrictions', () => {
  const lowTechProfile = createPirateProfile({ ownerId: 'owner-a', contactCycleKey: 'ability-cycle', score: { resourcePoints: 0, battlePoints: 0, totalPoints: 1_000 } });
  const passiveReport = resolveCombat(input({
    attacker: {
      participant: attacker,
      combatProfile: { kind: 'pirate', snapshot: lowTechProfile },
      ships: [
        { entityId: 'pirate-hound', count: 10 },
        { entityId: 'pirate-corsair', count: 100 },
        { entityId: 'pirate-executioner', count: 100 },
        { entityId: 'pirate-butcher', count: 1 },
      ], commanders: [],
    },
  }), { reportId: 'pirate-passives', missionType: 'pirate-raid' });
  const hound = passiveReport.initialSnapshot!.attacker.stacks.find((stack) => stack.entityId === 'pirate-hound')!;
  assert.equal(hound.attackPerUnit, 840);
  assert.equal(hound.lifePerUnit, 2_520);
  assert.equal(hound.armor, 5.8);

  const criticalProfile = { ...snapshot, exclusiveTechnologyId: 'criticalHit' as const };
  const raiderReport = resolveCombat(input({
    attacker: { participant: attacker, combatProfile: { kind: 'pirate', snapshot: criticalProfile }, ships: [{ entityId: 'pirate-raider', count: 2_000 }], commanders: [] },
  }), { reportId: 'pirate-devastate', missionType: 'pirate-raid' });
  const devastateAttacks = raiderReport.rounds.flatMap((round) => round.events).filter((event) => event.actorEntityId === 'pirate-raider' && event.actionType === 'attack');
  assert.ok(devastateAttacks.every((event) => event.abilityChance === 0.5));
  assert.ok(devastateAttacks.filter((event) => event.shipAbilityId === 'pirate-devastate').every((event) => event.criticalChance === 0));

  const artilleryReport = resolveCombat(input({
    attacker: { participant: attacker, combatProfile: { kind: 'pirate', snapshot }, ships: [{ entityId: 'pirate-bruiser', count: 1_000 }], commanders: [] },
    defender: { participant: defender, factionId: 'aegis', ships: [], commanders: [], defenses: [{ entityId: 'laser-turret', count: 1 }] },
  }), { reportId: 'pirate-artillery', missionType: 'pirate-raid' });
  const artillery = artilleryReport.rounds.flatMap((round) => round.events).find((event) => event.actorEntityId === 'pirate-bruiser' && event.actionType === 'attack')!;
  assert.equal(artillery.abilityChance, 0.7);
  assert.ok(artillery.shipAbilityId === undefined || artillery.shipAbilityId === 'pirate-artillery');
});

test('both pirate PvE mission markers suppress Battle Points for both participants', () => {
  const initial = createDefaultRatingPrototypeState();
  for (const missionType of ['pirate-elimination', 'pirate-raid'] as const) {
    const report = { ...DEMO_BATTLE_REPORTS[0]!, id: `score-${missionType}`, missionType };
    assert.strictEqual(recordBattleScoreAward(initial, report, 'owner-a'), initial);
  }
});
