import assert from 'node:assert/strict';
import test from 'node:test';

import { createDefaultCombatPriority } from '../combat/priority.ts';
import { CombatInputValidationError, getCombatMatchupMultiplier, resolveCombat } from '../combat/resolver.ts';
import type { BattleMissionType } from '../combat/report.ts';
import { normalizeBattleReport } from '../combat/report.ts';
import type { CombatInput, CombatStackInput } from '../combat/simulator.ts';
import { PIRATE_BASE_SHIPS, PIRATE_CATALOG, PIRATE_CATALOG_BY_ID, pirateDoubleAttackChance } from './catalog.ts';
import { createPirateProfile } from './profile.ts';

const priority = createDefaultCombatPriority();
const profile = createPirateProfile({
  ownerId: 'pirate-combat-test',
  contactCycleKey: 'test-cycle',
  score: { totalPoints: 1_000, resourcePoints: 0, battlePoints: 1_000 },
});

function resolvePair(input: {
  attackerRace: 'aegis' | 'synod' | 'veyra' | 'pirates';
  attackerShips: CombatStackInput[];
  defenderRace: 'aegis' | 'synod' | 'veyra' | 'pirates';
  defenderShips: CombatStackInput[];
  attackerPirate?: boolean;
  defenderPirate?: boolean;
  attackerFactionId?: CombatInput['attacker']['factionId'];
  defenderFactionId?: CombatInput['defender']['factionId'];
  attackerParticipantRace?: string | null;
  defenderParticipantRace?: string | null;
  seed?: string;
  pirateProfile?: typeof profile;
  maxRounds?: CombatInput['maxRounds'];
  missionType?: Exclude<BattleMissionType, 'simulation'>;
}) {
  const side = (race: typeof input.attackerRace, ships: CombatStackInput[], pirate: boolean | undefined, name: string, side: 'attacker' | 'defender', factionId?: CombatInput['attacker']['factionId'], participantRace?: string | null) => ({
    participant: { playerId: `${name}-owner`, playerName: name, race: participantRace === null ? undefined : participantRace ?? race, side },
    ...(pirate ? { combatProfile: { kind: 'pirate' as const, snapshot: input.pirateProfile ?? profile } } : { factionId: factionId ?? (race === 'pirates' ? undefined : race) }),
    ships,
    commanders: [],
    activeCommanderId: null,
  });
  const combat: CombatInput = {
    scenarioId: 'pirate-matchup-test',
    timestamp: '2026-01-01T00:00:00.000Z',
    attacker: side(input.attackerRace, input.attackerShips, input.attackerPirate, 'Attacker', 'attacker', input.attackerFactionId, input.attackerParticipantRace),
    defender: side(input.defenderRace, input.defenderShips, input.defenderPirate, 'Defender', 'defender', input.defenderFactionId, input.defenderParticipantRace),
    maxRounds: input.maxRounds ?? 5,
    attackerPriority: [...priority.attack],
    defenderPriority: [...priority.defense],
    seed: input.seed ?? 'pirate-matchup-test-seed',
  };
  return resolveCombat(combat, {
    reportId: `pirate-matchup-${input.seed ?? 'default'}`,
    ...(input.missionType ? { missionType: input.missionType } : {}),
  });
}

test('outgoing pirate elimination and incoming pirate raid both produce typed reports through the shared resolver', () => {
  for (const missionType of ['pirate-elimination', 'pirate-raid'] as const) {
    const incomingRaid = missionType === 'pirate-raid';
    const report = resolvePair({
      attackerRace: incomingRaid ? 'pirates' : 'aegis',
      attackerShips: incomingRaid ? [{ entityId: 'pirate-hound', count: 1 }] : [{ entityId: 'scout', count: 1 }],
      attackerPirate: incomingRaid,
      defenderRace: incomingRaid ? 'aegis' : 'pirates',
      defenderShips: incomingRaid ? [{ entityId: 'scout', count: 1 }] : [{ entityId: 'pirate-hound', count: 1 }],
      defenderPirate: !incomingRaid,
      pirateProfile: profile,
      missionType,
      seed: `typed-${missionType}`,
    });
    const pirateParticipant = incomingRaid ? report.attacker : report.defender;

    assert.equal(report.missionType, missionType);
    assert.equal(pirateParticipant.race, 'pirates');
    assert.equal(normalizeBattleReport(report)?.missionType, missionType);
  }
});

test('pirate PvE requires player race and factionId to identify the same playable faction', () => {
  const missionTypes = ['pirate-raid', 'pirate-elimination'] as const;
  const resolveForPlayerRace = (missionType: typeof missionTypes[number], race: string | null) => {
    const playerAttacks = missionType === 'pirate-elimination';
    return resolvePair({
      attackerRace: playerAttacks ? 'aegis' : 'pirates',
      attackerPirate: !playerAttacks,
      attackerShips: playerAttacks ? [{ entityId: 'scout', count: 1 }] : [{ entityId: 'pirate-hound', count: 1 }],
      ...(playerAttacks ? { attackerFactionId: 'aegis' as const, attackerParticipantRace: race } : {}),
      defenderRace: playerAttacks ? 'pirates' : 'aegis',
      defenderPirate: playerAttacks,
      defenderShips: playerAttacks ? [{ entityId: 'pirate-hound', count: 1 }] : [{ entityId: 'scout', count: 1 }],
      ...(!playerAttacks ? { defenderFactionId: 'aegis' as const, defenderParticipantRace: race } : {}),
      missionType,
      seed: `${missionType}-${race ?? 'missing-race'}`,
    });
  };

  for (const missionType of missionTypes) {
    for (const [race, description] of [[null, 'missing'], ['unknown-faction', 'unknown'], ['synod', 'mismatched']] as const) {
      assert.throws(
        () => resolveForPlayerRace(missionType, race),
        (error) => error instanceof CombatInputValidationError
          && error.errors.some((validationError) => validationError.code === 'invalid-mission-direction'),
        `${missionType} rejects ${description} player race with factionId aegis`,
      );
    }

    const canonical = resolveForPlayerRace(missionType, 'aegis');
    assert.equal(normalizeBattleReport(canonical)?.missionType, missionType);
    const displayedName = resolveForPlayerRace(missionType, 'Астеры');
    const player = missionType === 'pirate-raid' ? displayedName.defender : displayedName.attacker;
    assert.equal(player.race, 'Астеры');
    assert.equal(normalizeBattleReport(displayedName)?.missionType, missionType);
  }
});

test('pirate raid resolves successfully when the player planet has no ships or defenses', () => {
  const input: Parameters<typeof resolvePair>[0] = {
    attackerRace: 'pirates',
    attackerPirate: true,
    attackerShips: [{ entityId: 'pirate-hound', count: 1 }],
    defenderRace: 'aegis',
    defenderShips: [],
    defenderPirate: false,
    missionType: 'pirate-raid',
    seed: 'pirate-raid-empty-planet',
  };
  const report = resolvePair(input);

  assert.deepEqual(resolvePair(input), report);
  assert.equal(report.missionType, 'pirate-raid');
  assert.equal(report.attacker.race, 'pirates');
  assert.equal(report.defender.race, 'aegis');
  assert.equal(report.defenderForce.stacks.length, 0);
  assert.equal((report.defenderForce.defenses ?? []).length, 0);
  assert.equal(report.winner, 'attacker');
  assert.equal(normalizeBattleReport(report)?.missionType, 'pirate-raid');
});

test('pirate PvE mission types reject reversed, duplicated, or missing pirate sides', () => {
  const invalidInputs: Array<{ name: string; input: Parameters<typeof resolvePair>[0] }> = [
    {
      name: 'pirate-raid with pirates defending',
      input: {
        attackerRace: 'aegis', attackerShips: [{ entityId: 'scout', count: 1 }],
        defenderRace: 'pirates', defenderPirate: true, defenderShips: [{ entityId: 'pirate-hound', count: 1 }],
        missionType: 'pirate-raid', seed: 'invalid-raid-direction',
      },
    },
    {
      name: 'pirate-elimination with pirates attacking',
      input: {
        attackerRace: 'pirates', attackerPirate: true, attackerShips: [{ entityId: 'pirate-hound', count: 1 }],
        defenderRace: 'aegis', defenderShips: [{ entityId: 'scout', count: 1 }],
        missionType: 'pirate-elimination', seed: 'invalid-elimination-direction',
      },
    },
    {
      name: 'two pirate sides',
      input: {
        attackerRace: 'pirates', attackerPirate: true, attackerShips: [{ entityId: 'pirate-hound', count: 1 }],
        defenderRace: 'pirates', defenderPirate: true, defenderShips: [{ entityId: 'pirate-raider', count: 1 }],
        missionType: 'pirate-raid', seed: 'invalid-two-pirate-sides',
      },
    },
    {
      name: 'no pirate sides',
      input: {
        attackerRace: 'aegis', attackerShips: [{ entityId: 'scout', count: 1 }],
        defenderRace: 'synod', defenderShips: [{ entityId: 'scout', count: 1 }],
        missionType: 'pirate-elimination', seed: 'invalid-no-pirate-sides',
      },
    },
  ];

  for (const { name, input } of invalidInputs) {
    assert.throws(
      () => resolvePair(input),
      (error) => error instanceof CombatInputValidationError
        && error.errors.some((validationError) => validationError.code === 'invalid-mission-direction'),
      name,
    );
  }
});

test('seven neutral pirate hulls map to the standard combat classes without entering the playable ship list', () => {
  assert.equal(PIRATE_CATALOG.length, 7);
  assert.equal(PIRATE_BASE_SHIPS.length, 6);
  assert.deepEqual(PIRATE_BASE_SHIPS.map((ship) => ship.ordinaryClass), [
    'scout', 'cruiser', 'defender', 'battleship', 'destroyer', 'bomber',
  ]);
  assert.equal(PIRATE_CATALOG_BY_ID['pirate-planet-breaker'].ordinaryClass, 'planet-breaker');
});

test('pirate matchups reuse the existing shared coefficients and preserve neutral Kaper damage against Raider', () => {
  assert.equal(getCombatMatchupMultiplier('defender', 'cruiser'), 1);
  assert.equal(getCombatMatchupMultiplier('cruiser', 'scout'), 1.7);
  assert.equal(getCombatMatchupMultiplier('battleship', 'cruiser'), 1.7);
  assert.equal(getCombatMatchupMultiplier('bomber', 'destroyer'), 1.7);

  const report = resolvePair({
    attackerRace: 'pirates',
    attackerPirate: true,
    attackerShips: [{ entityId: 'pirate-corsair', count: 1 }],
    defenderRace: 'pirates',
    defenderPirate: true,
    defenderShips: [{ entityId: 'pirate-raider', count: 1 }],
  });
  const attack = report.rounds.flatMap((round) => round.events).find((event) => event.actionType === 'attack' && event.actorSide === 'attacker');
  assert.equal(attack?.matchupMultiplier, 1);
});

test('each faction gets the standard class matchup against pirate ships', () => {
  for (const faction of ['aegis', 'synod', 'veyra'] as const) {
    const report = resolvePair({
      attackerRace: faction,
      attackerShips: [{ entityId: 'cruiser', count: 1 }],
      defenderRace: 'pirates',
      defenderPirate: true,
      defenderShips: [{ entityId: 'pirate-hound', count: 1 }],
      seed: `faction-${faction}`,
    });
    const attack = report.rounds.flatMap((round) => round.events).find((event) => event.actionType === 'attack' && event.actorSide === 'attacker');
    assert.equal(attack?.matchupMultiplier, 1.7, faction);
  }
});

test('Planet Breaker uses death-star target selection but receives no death-star damage multiplier', () => {
  const report = resolvePair({
    attackerRace: 'aegis',
    attackerShips: [{ entityId: 'death-star', count: 1 }],
    defenderRace: 'pirates',
    defenderPirate: true,
    defenderShips: [
      { entityId: 'pirate-hound', count: 1 },
      { entityId: 'pirate-planet-breaker', count: 1 },
    ],
    seed: 'planet-breaker-selection',
  });
  const firstAttack = report.rounds[0]?.events.find((event) => event.actionType === 'attack' && event.actorSide === 'attacker');
  assert.equal(firstAttack?.targetEntityId, 'pirate-planet-breaker');
  assert.equal(firstAttack?.matchupMultiplier, 1);
  assert.equal(firstAttack?.matchupStatus, 'not-calibrated');
});

test('Shmel can freeze Planet Breaker as the only living ship target without changing its neutral damage', () => {
  let frozenReport: ReturnType<typeof resolvePair> | undefined;
  for (let seedIndex = 0; seedIndex < 256 && !frozenReport; seedIndex += 1) {
    const report = resolvePair({
      attackerRace: 'veyra',
      attackerShips: [{ entityId: 'destroyer', count: 100 }],
      defenderRace: 'pirates',
      defenderPirate: true,
      defenderShips: [{ entityId: 'pirate-planet-breaker', count: 30 }],
      seed: `shmel-freeze-planet-breaker-only-target-${seedIndex}`,
      maxRounds: 5,
    });
    const proc = report.rounds[0]?.events.find((event) => event.actionType === 'ability'
      && event.shipAbilityId === 'shmel-freezing'
      && event.targetEntityId === 'pirate-planet-breaker');
    if (proc) frozenReport = report;
  }

  assert.ok(frozenReport, 'fixed seed sweep must record freezing against the sole living Planet Breaker');
  const report = frozenReport!;
  const livingDefenderShips = report.initialSnapshot!.defender.stacks
    .filter((stack) => stack.countBefore > 0)
    .map((stack) => stack.entityId);
  assert.deepEqual(livingDefenderShips, ['pirate-planet-breaker']);
  const proc = report.rounds[0]!.events.find((event) => event.actionType === 'ability'
    && event.shipAbilityId === 'shmel-freezing'
    && event.targetEntityId === 'pirate-planet-breaker')!;
  assert.ok((proc.targetCount ?? 0) > 0, 'the selected Planet Breaker must be alive when freezing resolves');
  const planetBreakerAttack = report.rounds.flatMap((round) => round.events).find((event) =>
    event.actionType === 'attack' && event.actorEntityId === 'pirate-planet-breaker');
  assert.ok(planetBreakerAttack, 'Planet Breaker retains its ordinary attack action');
  assert.equal(planetBreakerAttack.matchupMultiplier, 1, 'ability eligibility must not add a matchup multiplier');
});

test('Planet Breaker uses Death Star level scaling for attack and life, while keeping neutral damage', () => {
  const profileAtLevel = (level: number) => createPirateProfile({
    ownerId: `planet-breaker-level-${level}`,
    contactCycleKey: 'level-scaling',
    score: { resourcePoints: level === 10 ? 3_000_000 : 0, battlePoints: 0, totalPoints: level === 10 ? 3_000_000 : 0 },
  });
  const level0Profile = profileAtLevel(0);
  const level10Profile = { ...level0Profile, ownerId: 'planet-breaker-level-10', shipLevel: 10 };
  const resolveAtLevel = (level: number) => resolvePair({
    attackerRace: 'pirates',
    attackerPirate: true,
    attackerShips: [{ entityId: 'pirate-planet-breaker', count: 1 }],
    defenderRace: 'synod',
    defenderShips: [{ entityId: 'scout', count: 100 }],
    pirateProfile: level === 10 ? level10Profile : level0Profile,
    seed: `planet-breaker-level-${level}`,
    maxRounds: 5,
  });

  const level0 = resolveAtLevel(0);
  const level10 = resolveAtLevel(10);
  const snapshotFor = (report: ReturnType<typeof resolveAtLevel>) => report.initialSnapshot!.attacker.stacks
    .find((stack) => stack.entityId === 'pirate-planet-breaker')!;
  const base = snapshotFor(level0);
  const max = snapshotFor(level10);
  assert.equal(max.level, 10);
  assert.equal(max.attackPerUnit, Math.floor((base.attackPerUnit ?? 0) * 2.5));
  assert.equal(max.lifePerUnit, Math.floor((base.lifePerUnit ?? 0) * 2.5));
  assert.equal(level10.rounds[0]?.events.find((event) => event.actorEntityId === 'pirate-planet-breaker'
    && event.actionType === 'attack')?.matchupMultiplier, 1);
});

test('Planet Breaker receives at most five ordinary volleys in a round', () => {
  const report = resolvePair({
    attackerRace: 'pirates',
    attackerPirate: true,
    attackerShips: [{ entityId: 'pirate-planet-breaker', count: 1 }],
    defenderRace: 'pirates',
    defenderPirate: true,
    defenderShips: [
      { entityId: 'pirate-hound', count: 1 },
      { entityId: 'pirate-raider', count: 1 },
      { entityId: 'pirate-corsair', count: 1 },
      { entityId: 'pirate-executioner', count: 1 },
      { entityId: 'pirate-butcher', count: 1 },
      { entityId: 'pirate-bruiser', count: 1 },
    ],
    seed: 'planet-breaker-five-volleys',
    maxRounds: 5,
  });
  const volleys = report.rounds[0]?.events.filter((event) => event.actorEntityId === 'pirate-planet-breaker'
    && event.actionType === 'attack') ?? [];
  assert.equal(volleys.length, 5);
  [615_000, 492_000, 369_000, 246_000, 123_000].forEach((expected, index) => {
    assert.ok(Math.abs((volleys[index]?.baseAttack ?? 0) - expected) <= 1, `volley ${index + 1} uses the normal descending strength`);
  });
  assert.ok(volleys.every((event) => event.matchupMultiplier === 1));
});

test('a frozen pirate ship skips its ordinary attack but can still receive the Ripper bonus attack that round', () => {
  const attackerShips: CombatStackInput[] = [
    { entityId: 'pirate-hound', count: 1_000 },
    { entityId: 'pirate-butcher', count: 1_000 },
  ];
  const defenderShips: CombatStackInput[] = [
    { entityId: 'destroyer', count: 500 },
    { entityId: 'defender', count: 1_000 },
    { entityId: 'battleship', count: 1_000 },
  ];
  let matchingRound: ReturnType<typeof resolvePair>['rounds'][number] | undefined;
  for (let seedIndex = 0; seedIndex < 200 && !matchingRound; seedIndex += 1) {
    const report = resolvePair({
      attackerRace: 'pirates',
      attackerPirate: true,
      attackerShips,
      defenderRace: 'veyra',
      defenderShips,
      seed: `freeze-ripper-combined-${seedIndex}`,
    });
    matchingRound = report.rounds.find((round) => {
      const frozenEntityIds = new Set(round.events.filter((event) => event.actionType === 'status'
        && event.shipAbilityId === 'shmel-freezing').map((event) => event.actorEntityId));
      const bonusTargetIds = new Set(round.events.filter((event) => event.actionType === 'ability'
        && event.shipAbilityId === 'pirate-double-attack').map((event) => event.targetEntityId));
      return [...frozenEntityIds].some((entityId) => bonusTargetIds.has(entityId));
    });
  }
  assert.ok(matchingRound, 'fixed seeded search should find a round where a frozen group is selected for the separate bonus attack');
  const frozen = matchingRound.events.find((event) => event.actionType === 'status' && event.shipAbilityId === 'shmel-freezing')!;
  const bonus = matchingRound.events.find((event) => event.actionType === 'ability'
    && event.shipAbilityId === 'pirate-double-attack' && event.targetEntityId === frozen.actorEntityId)!;
  assert.equal(frozen.actionType, 'status');
  const ordinaryAttack = matchingRound.events.find((event) => event.actionType === 'attack'
    && event.actorEntityId === frozen.actorEntityId && event.sequence < bonus.sequence);
  assert.equal(ordinaryAttack, undefined, 'frozen group must not make its ordinary attack');
  const bonusAttack = matchingRound.events.find((event) => event.actionType === 'attack'
    && event.actorEntityId === frozen.actorEntityId
    && event.sequence > bonus.sequence);
  assert.ok(bonusAttack, 'the same group can make its separate Potroshitel bonus attack after the freeze skip');
});

test('Potroshitel grants a single fleet roll per round, scaled by living count and capped at 5%', () => {
  assert.equal(pirateDoubleAttackChance(0), 0);
  assert.equal(pirateDoubleAttackChance(1), 0.005);
  assert.equal(pirateDoubleAttackChance(10), 0.05);
  assert.equal(pirateDoubleAttackChance(100), 0.05);
});
