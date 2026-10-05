import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveCombat } from '../combat/resolver.ts';
import type { CombatInput, CombatStackInput } from '../combat/simulator.ts';
import { createDefaultCombatTechnologies } from '../combat/technologies.ts';
import { PIRATE_CATALOG_BY_ID } from './catalog.ts';
import { createPirateProfile } from './profile.ts';

const pirateProfile = createPirateProfile({
  ownerId: 'pirate-ability-integration-test',
  contactCycleKey: 'ability-test-cycle',
  score: { totalPoints: 1_000, resourcePoints: 0, battlePoints: 1_000 },
});

type PirateShipInput = Extract<CombatStackInput, { entityId: string }>;

function makeCombat(seed: string, pirateShips: PirateShipInput[], options: {
  defenderShips?: CombatStackInput[];
  defenderDefenses?: CombatStackInput[];
  defenderTech?: ReturnType<typeof createDefaultCombatTechnologies>;
} = {}): CombatInput {
  return {
    scenarioId: 'pirate-ability-integration',
    timestamp: '2026-01-01T00:00:00.000Z',
    attacker: {
      participant: { playerId: 'pirate-npc', playerName: 'Pirates', race: 'pirates', side: 'attacker' },
      combatProfile: { kind: 'pirate', snapshot: pirateProfile },
      ships: pirateShips,
      commanders: [],
      activeCommanderId: null,
    },
    defender: {
      participant: { playerId: 'test-player', playerName: 'Player', race: 'aegis', side: 'defender' },
      factionId: 'aegis',
      ships: options.defenderShips ?? [{ entityId: 'battleship', count: 100 }],
      defenses: options.defenderDefenses ?? [],
      commanders: [],
      activeCommanderId: null,
    },
    maxRounds: 5,
    attackerPriority: [],
    defenderPriority: [],
    ...(options.defenderTech ? { defenderTechnologies: options.defenderTech } : {}),
    seed,
  };
}

function resolve(seed: string, pirateShips: PirateShipInput[], options?: Parameters<typeof makeCombat>[2]) {
  return resolveCombat(makeCombat(seed, pirateShips, options), { reportId: `pirate-ability-${seed}` });
}

function findSeededReport(
  pirateShips: PirateShipInput[],
  options: Parameters<typeof makeCombat>[2],
  predicate: (report: ReturnType<typeof resolve>) => boolean,
) {
  // The exact RNG sequence is an implementation detail; search a bounded,
  // deterministic seed set for a real proc instead of assuming its cadence.
  for (let index = 0; index < 250; index += 1) {
    const report = resolve(`seed-${index}`, pirateShips, options);
    if (predicate(report)) return report;
  }
  assert.fail('No seeded resolver run produced the required pirate ability effect');
}

function attacks(report: ReturnType<typeof resolve>) {
  return report.rounds.flatMap((round) => round.events)
    .filter((event) => event.actionType === 'attack' && event.actorSide === 'attacker');
}

test('Hound proc selects a friendly ship group and that group ignores the target armor in its real attack', () => {
  const hound = PIRATE_CATALOG_BY_ID['pirate-hound'].ability;
  assert.equal(hound.kind, 'ignore-armor');
  if (hound.kind !== 'ignore-armor') return;
  const report = findSeededReport(
    [
      { entityId: 'pirate-hound', count: Math.ceil(hound.chanceCap / hound.perShipChance) },
      { entityId: 'pirate-raider', count: 25 },
    ],
    {
      defenderShips: [{ entityId: 'defender', count: 800 }],
      defenderTech: { ...createDefaultCombatTechnologies(), lightArmor: 10, mediumArmor: 10, heavyArmor: 10 },
    },
    (candidate) => candidate.rounds.some((round) => {
      const proc = round.events.find((event) => event.shipAbilityId === 'pirate-armor-piercing'
        && event.actionType === 'ability' && event.targetEntityId === 'pirate-raider');
      const effect = round.events.find((event) => event.actionType === 'attack'
        && event.actorEntityId === 'pirate-raider' && event.armorBefore !== undefined && event.armorBefore > 0
        && event.effectiveDamage === event.rawDamage);
      return Boolean(proc && effect);
    }),
  );
  const round = report.rounds.find((candidate) => candidate.events.some((event) =>
    event.shipAbilityId === 'pirate-armor-piercing' && event.targetEntityId === 'pirate-raider'))!;
  const proc = round.events.find((event) => event.shipAbilityId === 'pirate-armor-piercing')!;
  const effect = round.events.find((event) => event.actionType === 'attack' && event.actorEntityId === proc.targetEntityId
    && event.armorBefore !== undefined && event.armorBefore > 0 && event.effectiveDamage === event.rawDamage)!;
  assert.equal(effect.actorEntityId, 'pirate-raider');
  assert.ok((proc.abilityChance ?? 0) > 0);
  assert.equal(effect.mitigation, 0);
});

test('Raider Devastate proc selects a friendly group and the real attack deals the catalog 1.25 multiplier', () => {
  const raider = PIRATE_CATALOG_BY_ID['pirate-raider'].ability;
  assert.equal(raider.kind, 'devastate');
  if (raider.kind !== 'devastate') return;
  const report = findSeededReport(
    [
      { entityId: 'pirate-raider', count: Math.ceil(raider.chanceCap / raider.perShipChance) },
      { entityId: 'pirate-hound', count: 100 },
    ],
    { defenderShips: [{ entityId: 'scout', count: 1_000 }] },
    (candidate) => candidate.rounds.some((round) => {
      const proc = round.events.find((event) => event.shipAbilityId === 'pirate-devastate'
        && event.actionType === 'ability' && event.targetEntityId === 'pirate-hound');
      const effect = round.events.find((event) => event.actionType === 'attack'
        && event.actorEntityId === 'pirate-hound' && event.shipAbilityId === 'pirate-devastate');
      return Boolean(proc && effect);
    }),
  );
  const round = report.rounds.find((candidate) => candidate.events.some((event) =>
    event.shipAbilityId === 'pirate-devastate' && event.targetEntityId === 'pirate-hound'))!;
  const proc = round.events.find((event) => event.actionType === 'ability' && event.shipAbilityId === 'pirate-devastate')!;
  const effect = round.events.find((event) => event.actionType === 'attack' && event.actorEntityId === proc.targetEntityId
    && event.shipAbilityId === 'pirate-devastate')!;
  assert.equal(effect.actorEntityId, 'pirate-hound');
  assert.equal(effect.rawDamageBeforeArmor, Math.floor((effect.baseAttack ?? 0) * (effect.matchupMultiplier ?? 1) * raider.attackMultiplier));
  assert.equal(effect.criticalChance, 0, 'Devastate suppresses Critical Strike on the amplified attack');
});

test('Corsair adds its capped life bonus to every allied ship group, including itself', () => {
  const ability = PIRATE_CATALOG_BY_ID['pirate-corsair'].ability;
  assert.equal(ability.kind, 'bonus-life');
  if (ability.kind !== 'bonus-life') return;
  const corsairCount = Math.ceil(ability.cap / ability.perShipRate);
  const base = resolve('corsair-life-baseline', [{ entityId: 'pirate-hound', count: 20 }]);
  const withDonor = resolve('corsair-life-donor', [
    { entityId: 'pirate-hound', count: 20 },
    { entityId: 'pirate-corsair', count: corsairCount },
  ]);
  const baseHound = base.initialSnapshot!.attacker.stacks.find((stack) => stack.entityId === 'pirate-hound')!;
  const boostedHound = withDonor.initialSnapshot!.attacker.stacks.find((stack) => stack.entityId === 'pirate-hound')!;
  const donorCorsair = withDonor.initialSnapshot!.attacker.stacks.find((stack) => stack.entityId === 'pirate-corsair')!;
  assert.equal(boostedHound.lifePerUnit, Math.floor(baseHound.lifePerUnit! * (1 + ability.cap)));
  assert.equal(donorCorsair.lifePerUnit, Math.floor(PIRATE_CATALOG_BY_ID['pirate-corsair'].combat.life * (1 + ability.cap)));
});

test('Executioner adds its capped armor bonus to every allied ship group, including itself', () => {
  const ability = PIRATE_CATALOG_BY_ID['pirate-executioner'].ability;
  assert.equal(ability.kind, 'armor-boost');
  if (ability.kind !== 'armor-boost') return;
  const executionerCount = Math.ceil(ability.cap / ability.perShipRate);
  const baseline = resolve('executioner-armor-baseline', [
    { entityId: 'pirate-hound', count: 20 },
    { entityId: 'pirate-executioner', count: executionerCount },
  ]);
  const withDonorHound = baseline.initialSnapshot!.attacker.stacks.find((stack) => stack.entityId === 'pirate-hound')!;
  const baselineHound = resolve('executioner-hound-baseline', [{ entityId: 'pirate-hound', count: 20 }])
    .initialSnapshot!.attacker.stacks.find((stack) => stack.entityId === 'pirate-hound')!;
  const donor = baseline.initialSnapshot!.attacker.stacks.find((stack) => stack.entityId === 'pirate-executioner')!;
  assert.equal(withDonorHound.armor, Math.min(80, baselineHound.armor! + ability.cap * 100));
  assert.equal(donor.armor, Math.min(80, PIRATE_CATALOG_BY_ID['pirate-executioner'].combat.armorStrength + ability.cap * 100));
});

test('Artillery proc gives a non-donor pirate group 1.5 damage against an actual defense target', () => {
  const artillery = PIRATE_CATALOG_BY_ID['pirate-bruiser'].ability;
  assert.equal(artillery.kind, 'artillery');
  if (artillery.kind !== 'artillery') return;
  const report = findSeededReport(
    [
      { entityId: 'pirate-bruiser', count: Math.ceil(artillery.chanceCap / artillery.perShipChance) },
      { entityId: 'pirate-hound', count: 50 },
    ],
    {
      defenderShips: [{ entityId: 'battleship', count: 1 }],
      defenderDefenses: [{ entityId: 'ballistic-turret', count: 1_000 }],
    },
    (candidate) => attacks(candidate).some((event) => event.targetEntityId === 'ballistic-turret'
      && event.actorEntityId === 'pirate-hound' && event.shipAbilityId === 'pirate-artillery'),
  );
  const houndShot = attacks(report).find((event) => event.targetEntityId === 'ballistic-turret'
    && event.actorEntityId === 'pirate-hound' && event.shipAbilityId === 'pirate-artillery')!;
  assert.equal(houndShot.rawDamageBeforeArmor, Math.floor((houndShot.baseAttack ?? 0) * (houndShot.matchupMultiplier ?? 1)
    * artillery.attackMultiplierVsDefense));
  assert.ok((houndShot.abilityChance ?? 0) > 0);
});
