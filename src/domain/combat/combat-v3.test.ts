import assert from 'node:assert/strict';
import test from 'node:test';

import { createBattleReportViewModel } from './battle-report-view-model.ts';
import { getFactionCombatEntity } from './faction-catalog.ts';
import { createDefaultCombatPriority } from './priority.ts';
import { resolveCombat, calculateCombatStackPreview } from './resolver.ts';
import { validateCombatInput, type CombatInput } from './simulator.ts';
import { createDefaultCombatTechnologies, normalizeCombatTechnologies } from './technologies.ts';

const priority = createDefaultCombatPriority();
const attacker = { playerId: 'v3-attacker', playerName: 'Attacker', side: 'attacker' as const };
const defender = { playerId: 'v3-defender', playerName: 'Defender', side: 'defender' as const };

function input(overrides: Partial<CombatInput> = {}): CombatInput {
  return {
    scenarioId: 'combat-v3-test',
    timestamp: '2026-09-17T00:00:00.000Z',
    attacker: { participant: attacker, ships: [{ entityId: 'scout', count: 1 }], commanders: [] },
    defender: { participant: defender, ships: [{ entityId: 'death-star', count: 1 }], commanders: [], defenses: [] },
    maxRounds: 5,
    attackerPriority: [...priority.attack],
    defenderPriority: [...priority.defense],
    executionMode: 'production',
    technologyMode: 'independent',
    seed: 'combat-v3-seed',
    ...overrides,
  };
}

function firstAttack(report: ReturnType<typeof resolveCombat>, entityId = 'scout') {
  const event = report.rounds.flatMap((round) => round.events)
    .find((candidate) => candidate.actorEntityId === entityId && candidate.actionType === 'attack');
  assert.ok(event, `expected an attack event for ${entityId}`);
  return event;
}

test('ship level changes one-unit stats and count scales the whole group', () => {
  const levelZero = resolveCombat(input({
    attacker: { participant: attacker, ships: [{ entityId: 'scout', count: 10, level: 0 }], commanders: [] },
  }), { reportId: 'v3-scale-zero' });
  const levelTen = resolveCombat(input({
    attacker: { participant: attacker, ships: [{ entityId: 'scout', count: 10, level: 10 }], commanders: [] },
  }), { reportId: 'v3-scale-ten' });

  const zeroAttack = firstAttack(levelZero);
  const tenAttack = firstAttack(levelTen);
  assert.deepEqual(
    { attackPerUnit: zeroAttack.attackPerUnit, totalAttack: zeroAttack.totalAttack, attackValue: zeroAttack.attackValue },
    { attackPerUnit: 800, totalAttack: 8_000, attackValue: 8_000 },
  );
  assert.deepEqual(
    { attackPerUnit: tenAttack.attackPerUnit, totalAttack: tenAttack.totalAttack, attackValue: tenAttack.attackValue },
    { attackPerUnit: 1_200, totalAttack: 12_000, attackValue: 12_000 },
  );

  const initial = levelTen.initialSnapshot?.attacker.stacks.find((stack) => stack.entityId === 'scout');
  assert.deepEqual(
    { count: initial?.countBefore, level: initial?.level, lifePerUnit: initial?.lifePerUnit, hpPool: initial?.hpPool },
    { count: 10, level: 10, lifePerUnit: 3_600, hpPool: 36_000 },
  );
});

test('service ships remain visible in the catalog but cannot enter combat', () => {
  const result = validateCombatInput(input({
    attacker: { participant: attacker, ships: [{ entityId: 'transporter', count: 1 }], commanders: [] },
  }));
  assert.equal(result.ok, false);
  assert.equal(result.errors.some((error) => error.code === 'combat-ineligible'), true);
});

test('independent technology profiles affect their own attack and life calculations', () => {
  const report = resolveCombat(input({
    attacker: {
      participant: attacker,
      ships: [{ entityId: 'scout', count: 1 }],
      commanders: [],
    },
    defender: {
      participant: defender,
      ships: [{ entityId: 'battleship', count: 1 }],
      commanders: [],
      defenses: [],
    },
    attackerTechnologies: normalizeCombatTechnologies({ laserScience: 4 }),
    defenderTechnologies: normalizeCombatTechnologies({ shipArmor: 5 }),
  }), { reportId: 'v3-independent-tech' });

  const attack = firstAttack(report);
  const target = report.initialSnapshot?.defender.stacks.find((stack) => stack.entityId === 'battleship');
  assert.equal(report.metadata?.technologyMode, 'independent');
  assert.equal(report.attackerForce.technologyLevels?.laserScience, 4);
  assert.equal(report.defenderForce.technologyLevels?.shipArmor, 5);
  assert.equal(attack.attackValue, 1_280);
  assert.equal(target?.lifePerUnit, 40_500);
});

test('shared mode is optional and rejects silently divergent profiles', () => {
  const mismatched = validateCombatInput(input({
    technologyMode: 'shared',
    attackerTechnologies: normalizeCombatTechnologies({ laserScience: 4 }),
    defenderTechnologies: normalizeCombatTechnologies({ shipArmor: 5 }),
  }));
  assert.equal(mismatched.ok, false);
  assert.equal(mismatched.errors.some((error) => error.code === 'technology-profile-mismatch'), true);

  const shared = resolveCombat(input({
    technologyMode: 'shared',
    attackerTechnologies: normalizeCombatTechnologies({ laserScience: 4 }),
    defenderTechnologies: normalizeCombatTechnologies({ laserScience: 4 }),
  }), { reportId: 'v3-shared-tech' });
  assert.equal(shared.defenderForce.technologyLevels?.laserScience, 4);
  assert.equal(firstAttack(shared).attackValue, 1_280);
});

test('commander type and level modify combat while the other side may have none', () => {
  const baseline = resolveCombat(input({
    attacker: { participant: attacker, ships: [{ entityId: 'scout', count: 10 }], commanders: [] },
  }), { reportId: 'v3-no-commander' });
  const executioner = resolveCombat(input({
    attacker: {
      participant: attacker,
      ships: [{ entityId: 'scout', count: 10 }],
      commanders: [{ entityId: 'executioner', count: 1, level: 40 }],
      activeCommanderId: 'executioner',
    },
  }), { reportId: 'v3-executioner' });

  assert.equal(executioner.attackerForce.activeCommanderId, 'executioner');
  assert.equal(executioner.attackerForce.activeCommanderLevel, 40);
  assert.equal(executioner.defenderForce.activeCommanderId, undefined);
  assert.equal(executioner.attackerForce.modifiers?.commanderRate, 0.06);
  assert.equal(firstAttack(baseline).attackValue, 8_000);
  assert.equal(firstAttack(executioner).attackValue, 8_480);

  const judge = resolveCombat(input({
    attacker: {
      participant: attacker,
      ships: [{ entityId: 'scout', count: 1 }],
      commanders: [{ entityId: 'judge', count: 1, level: 40 }],
      activeCommanderId: 'judge',
    },
    defender: { participant: defender, ships: [{ entityId: 'battleship', count: 1 }], commanders: [], defenses: [] },
  }), { reportId: 'v3-judge' });
  assert.equal(firstAttack(judge).armorBefore, 0);
});

test('initial snapshot is separate from round one and rounds carry state forward', () => {
  const report = resolveCombat(input({
    attacker: { participant: attacker, ships: [], commanders: [{ entityId: 'corsair', count: 1 }] },
    defender: { participant: defender, ships: [], commanders: [{ entityId: 'corsair', count: 1 }], defenses: [] },
    maxRounds: 5,
  }), { reportId: 'v3-rounds' });

  assert.ok(report.initialSnapshot);
  assert.deepEqual(report.rounds.map((round) => round.index), [1, 2, 3, 4, 5]);
  assert.equal(report.rounds.some((round) => round.index === 0), false);
  const initialStack = report.initialSnapshot?.attacker.stacks.find((stack) => stack.entityId === 'corsair');
  const firstRoundStack = report.rounds[0]?.attackerSnapshot?.stacks.find((stack) => stack.entityId === 'corsair');
  assert.equal(initialStack?.countBefore, 1);
  assert.equal(initialStack?.countAfter, 1);
  assert.equal(firstRoundStack?.countBefore, 1);
  report.rounds.slice(0, -1).forEach((round, index) => {
    const current = round.attackerSnapshot?.stacks.find((stack) => stack.entityId === 'corsair');
    const next = report.rounds[index + 1]?.attackerSnapshot?.stacks.find((stack) => stack.entityId === 'corsair');
    assert.equal(current?.countAfter, next?.countBefore);
  });
});

test('round snapshot metrics stay on the before side while losses stay in after fields', () => {
  const report = resolveCombat(input({
    attacker: { participant: attacker, ships: [{ entityId: 'destroyer', count: 1 }], commanders: [] },
    defender: { participant: defender, ships: [{ entityId: 'scout', count: 2 }], commanders: [], defenses: [] },
    maxRounds: 5,
  }), { reportId: 'v3-round-before-after' });
  const snapshot = report.rounds[0]?.defenderSnapshot?.stacks.find((stack) => stack.entityId === 'scout');

  assert.deepEqual(
    {
      countBefore: snapshot?.countBefore,
      countAfter: snapshot?.countAfter,
      totalAttack: snapshot?.totalAttack,
      hpPool: snapshot?.hpPool,
      lifeBefore: snapshot?.lifeBefore,
      lifeAfter: snapshot?.lifeAfter,
    },
    {
      countBefore: 2,
      countAfter: 0,
      totalAttack: 1_600,
      hpPool: 4_800,
      lifeBefore: 4_800,
      lifeAfter: 0,
    },
  );
});

test('defense remains a separate population and report-view group metrics are preserved', () => {
  const report = resolveCombat(input({
    attacker: { participant: attacker, ships: [{ entityId: 'scout', count: 2, level: 10 }], commanders: [] },
    defender: { participant: defender, ships: [{ entityId: 'scout', count: 1 }], commanders: [], defenses: [{ entityId: 'ballistic-turret', count: 1 }] },
  }), { reportId: 'v3-defense-and-view-model' });
  const viewModel = createBattleReportViewModel(report);
  const stack = viewModel.attacker.ships.find((candidate) => candidate.entityId === 'scout');

  assert.equal(report.defenderForce.defenses?.length, 1);
  assert.equal(report.initialSnapshot?.defender.defenses?.length, 1);
  assert.equal(report.initialSnapshot?.defender.fleetPopulationBefore, 2);
  assert.equal(report.initialSnapshot?.defender.defensePopulationBefore, 2);
  assert.equal(stack?.attackPerUnit, 1_200);
  assert.equal(stack?.totalAttack, (stack?.countAfter ?? 0) * (stack?.attackPerUnit ?? 0));
  assert.equal(stack?.lifePerUnit, 3_600);
  assert.equal(stack?.hpPool != null && stack.hpPool > 0, true);
  const initialViewStack = viewModel.initialSnapshot?.attacker.stacks.find((candidate) => candidate.entityId === 'scout');
  assert.equal(initialViewStack?.totalAttack, 2_400);
  assert.equal(initialViewStack?.hpPool, 7_200);

  const preview = calculateCombatStackPreview(
    { entityId: 'scout', count: 2, level: 10 },
    'aegis',
    createDefaultCombatTechnologies(),
    'production',
    [{ entityId: 'scout', count: 2, level: 10 }],
  );
  assert.deepEqual(preview, { attackPerUnit: 1_200, totalAttack: 2_400, lifePerUnit: 3_600, hpPool: 7_200, armorPercent: 3 });
});

test('documented special bonuses are faction data, capped, donor-excluded, and visible as events', () => {
  assert.deepEqual(
    {
      aegisDefender: getFactionCombatEntity('aegis', 'defender').specialBonus,
      synodDefender: getFactionCombatEntity('synod', 'defender').specialBonus,
      veyraAbsorber: getFactionCombatEntity('veyra', 'cruiser').specialBonus,
      synodGoliath: getFactionCombatEntity('synod', 'destroyer').specialBonus,
    },
    {
      aegisDefender: {
        kind: 'life', rate: 0.0005, cap: 0.3, capStatus: 'known', scope: 'asterion', status: 'confirmed',
        source: 'ASTERION_FULL_BATTLE_IMPLEMENTATION_PROMPT.md §4.3.2',
        note: 'Защитник усиливает жизнь других живых боевых стеков; собственный донор бонус не получает.',
      },
      synodDefender: {
        kind: 'life', rate: 0.00075, cap: 0.3, capStatus: 'known', scope: 'asterion', status: 'confirmed',
        source: 'ASTERION_FULL_BATTLE_IMPLEMENTATION_PROMPT.md §4.3.2',
        note: 'Бот Щит усиливает жизнь других живых боевых стеков; собственный донор бонус не получает.',
      },
      veyraAbsorber: {
        kind: 'life', rate: 0.0005, cap: 0.3, capStatus: 'known', scope: 'asterion', status: 'inferred',
        source: 'ASTERION_FULL_BATTLE_IMPLEMENTATION_PROMPT.md §4.3.2',
        note: 'Абсорбатор усиливает жизнь других живых боевых стеков; коэффициент inferred по capped baseline.',
      },
      synodGoliath: {
        kind: 'attack', rate: 0.0009, cap: 0.8, capStatus: 'known', scope: 'asterion', status: 'confirmed',
        source: 'ASTERION_FULL_BATTLE_IMPLEMENTATION_PROMPT.md §4.3.2',
        note: 'Голиаф усиливает атаку других живых боевых стеков; собственный донор бонус не получает.',
      },
    },
  );

  const report = resolveCombat(input({
    attacker: {
      participant: attacker,
      factionId: 'aegis',
      ships: [{ entityId: 'defender', count: 2 }, { entityId: 'scout', count: 1 }],
      commanders: [],
    },
    defender: { participant: defender, ships: [{ entityId: 'death-star', count: 1 }], commanders: [], defenses: [] },
  }), { reportId: 'v3-special-bonus' });
  const initialDefender = report.initialSnapshot?.attacker.stacks.find((stack) => stack.entityId === 'defender');
  const initialScout = report.initialSnapshot?.attacker.stacks.find((stack) => stack.entityId === 'scout');
  const bonusEvent = report.rounds[0]?.events.find((event) => event.actionType === 'special-bonus');

  assert.equal(initialDefender?.lifePerUnit, 8_300);
  assert.equal(initialScout?.lifePerUnit, 2_402);
  assert.equal(bonusEvent?.actorEntityId, 'defender');
  assert.equal(bonusEvent?.specialBonusLivingCount, 2);
  assert.equal(bonusEvent?.specialBonusAmount, 0.001);
  assert.equal(bonusEvent?.provenance?.status, 'confirmed');
});
