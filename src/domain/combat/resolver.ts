import { COMBAT_CATALOG, getCombatEntity } from './catalog.ts';
import type { CommanderId } from './commanders.ts';
import type { CombatEntityId } from './ids.ts';
import { selectActiveCommander } from './priority.ts';
import type {
  BattleForceSnapshot,
  BattleReport,
  BattleSide,
  BattleStackSnapshot,
  BattleWinner,
  CombatEvent,
  CombatRound,
  CombatRoundSnapshot,
} from './report.ts';
import {
  calculateStacksPopulation,
  validateCombatInput,
  type CombatInput,
  type CombatStackInput,
} from './simulator.ts';
import {
  getTechnologyArmorPercent,
  getTechnologyAttackMultiplier,
  getTechnologyLifeMultiplier,
  normalizeCombatTechnologies,
  type CombatTechnologyLevels,
} from './technologies.ts';

/**
 * Asterion Combat Resolver v1 is a deterministic Asterion rule set.
 * It is not a reconstruction of the complete Nemexia server combat formula.
 *
 * v1 applies only documented deterministic science bonuses: weapon sciences,
 * ship defense, armor sciences, Force Attack and Prompt Defense. It still has no
 * RNG/critical damage, shield pool/regeneration, weapon-vs-armor matchup,
 * commander ability mathematics or equipment modifiers.
 */

export type CombatResolverContext = {
  reportId: string;
};

type RuntimeBucket = 'stacks' | 'defenses';

type RuntimeStack = {
  side: BattleSide;
  bucket: RuntimeBucket;
  entityId: CombatEntityId;
  startingCount: number;
  count: number;
  hpPool: number;
  lifePerUnit: number;
  attackPerUnit: number;
  armorPercent: number;
  populationPerUnit: number;
};

export type TargetSelectionCandidate = {
  entityId: CombatEntityId;
  currentCount: number;
};

type PlannedAttack = {
  actorSide: BattleSide;
  actorEntityId: CombatEntityId;
  actorCount: number;
  targetSide: BattleSide;
  targetEntityId: CombatEntityId;
  rawDamage: number;
  effectiveDamage: number;
};

export class CombatInputValidationError extends Error {
  readonly errors: ReturnType<typeof validateCombatInput>['errors'];

  constructor(errors: ReturnType<typeof validateCombatInput>['errors']) {
    super(errors.map((error) => error.message).join(' '));
    this.name = 'CombatInputValidationError';
    this.errors = errors;
  }
}

const CATALOG_ORDER = new Map<CombatEntityId, number>(
  COMBAT_CATALOG.map((entity, index) => [entity.id, index]),
);

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export function calculateEffectiveDamage(rawDamage: number, armorStrength: number) {
  if (rawDamage <= 0) return 0;
  const armorPercent = clamp(armorStrength, 0, 80);
  const reduced = Math.floor(rawDamage * (100 - armorPercent) / 100);
  return Math.max(1, reduced);
}

function catalogOrder(entityId: CombatEntityId) {
  return CATALOG_ORDER.get(entityId) ?? Number.MAX_SAFE_INTEGER;
}

export function selectCombatTarget(candidates: readonly TargetSelectionCandidate[]): TargetSelectionCandidate | null {
  const alive = candidates.filter((candidate) => candidate.currentCount > 0);
  if (!alive.length) return null;

  return [...alive].sort((left, right) => {
    const leftEntity = getCombatEntity(left.entityId);
    const rightEntity = getCombatEntity(right.entityId);
    const leftThreat = left.currentCount * leftEntity.combat.attack;
    const rightThreat = right.currentCount * rightEntity.combat.attack;
    if (leftThreat !== rightThreat) return rightThreat - leftThreat;

    const leftPopulation = left.currentCount * leftEntity.population;
    const rightPopulation = right.currentCount * rightEntity.population;
    if (leftPopulation !== rightPopulation) return rightPopulation - leftPopulation;

    const orderDelta = catalogOrder(left.entityId) - catalogOrder(right.entityId);
    if (orderDelta !== 0) return orderDelta;

    return left.entityId.localeCompare(right.entityId);
  })[0] ?? null;
}

function runtimeFromInput(
  side: BattleSide,
  bucket: RuntimeBucket,
  stacks: readonly CombatStackInput[],
  technologies: CombatTechnologyLevels,
): RuntimeStack[] {
  return stacks.map((stack) => {
    const entity = getCombatEntity(stack.entityId);
    const lifePerUnit = entity.combat.life * getTechnologyLifeMultiplier(entity, technologies);
    const attackPerUnit = entity.combat.attack * getTechnologyAttackMultiplier(entity, technologies);
    const armorPercent = clamp(getTechnologyArmorPercent(entity, technologies), 0, 80);
    return {
      side,
      bucket,
      entityId: stack.entityId,
      startingCount: stack.count,
      count: stack.count,
      hpPool: stack.count * lifePerUnit,
      lifePerUnit,
      attackPerUnit,
      armorPercent,
      populationPerUnit: entity.population,
    };
  });
}

function sortRuntime(stacks: readonly RuntimeStack[]) {
  return [...stacks].sort((left, right) => {
    const orderDelta = catalogOrder(left.entityId) - catalogOrder(right.entityId);
    if (orderDelta !== 0) return orderDelta;
    return left.entityId.localeCompare(right.entityId);
  });
}

function sideAliveCount(stacks: readonly RuntimeStack[]) {
  return stacks.reduce((total, stack) => total + stack.count, 0);
}

function sidePopulation(stacks: readonly RuntimeStack[]) {
  return stacks.reduce((total, stack) => total + stack.count * stack.populationPerUnit, 0);
}

function runtimeCountFromHp(stack: RuntimeStack) {
  return stack.hpPool <= 0 ? 0 : Math.ceil(stack.hpPool / stack.lifePerUnit);
}

function planSideAttacks(
  actorStacks: readonly RuntimeStack[],
  targetStacks: readonly RuntimeStack[],
): PlannedAttack[] {
  const targetSnapshot: TargetSelectionCandidate[] = targetStacks
    .filter((stack) => stack.count > 0)
    .map((stack) => ({ entityId: stack.entityId, currentCount: stack.count }));
  const targetById = new Map(targetStacks.map((stack) => [stack.entityId, stack]));

  return sortRuntime(actorStacks)
    .filter((actor) => actor.count > 0 && actor.attackPerUnit > 0)
    .flatMap((actor) => {
      const target = selectCombatTarget(targetSnapshot);
      if (!target) return [];
      const targetRuntime = targetById.get(target.entityId);
      if (!targetRuntime) return [];
      const rawDamage = actor.count * actor.attackPerUnit;
      return [{
        actorSide: actor.side,
        actorEntityId: actor.entityId,
        actorCount: actor.count,
        targetSide: actor.side === 'attacker' ? 'defender' : 'attacker',
        targetEntityId: target.entityId,
        rawDamage,
        effectiveDamage: calculateEffectiveDamage(rawDamage, targetRuntime.armorPercent),
      } satisfies PlannedAttack];
    });
}

function createRoundSnapshot(
  stacks: readonly RuntimeStack[],
  roundStartCounts: ReadonlyMap<CombatEntityId, number>,
): CombatRoundSnapshot {
  const build = (bucket: RuntimeBucket): BattleStackSnapshot[] => sortRuntime(stacks)
    .filter((stack) => stack.bucket === bucket)
    .map((stack) => {
      const countBefore = roundStartCounts.get(stack.entityId) ?? 0;
      return {
        entityId: stack.entityId,
        countBefore,
        countAfter: stack.count,
        destroyed: Math.max(0, countBefore - stack.count),
      };
    });

  const regularStacks = build('stacks');
  const defenses = build('defenses');
  return defenses.length ? { stacks: regularStacks, defenses } : { stacks: regularStacks };
}

function createForceSnapshot(
  stacks: readonly RuntimeStack[],
  activeCommanderId: CommanderId | null,
): BattleForceSnapshot {
  const build = (bucket: RuntimeBucket): BattleStackSnapshot[] => sortRuntime(stacks)
    .filter((stack) => stack.bucket === bucket)
    .map((stack) => ({
      entityId: stack.entityId,
      countBefore: stack.startingCount,
      countAfter: stack.count,
      destroyed: Math.max(0, stack.startingCount - stack.count),
    }));

  const regularStacks = build('stacks');
  const defenses = build('defenses');
  const populationBefore = stacks.reduce((total, stack) => total + stack.startingCount * stack.populationPerUnit, 0);
  const populationAfter = sidePopulation(stacks);

  return {
    populationBefore,
    populationAfter,
    stacks: regularStacks,
    ...(defenses.length ? { defenses } : {}),
    ...(activeCommanderId ? { activeCommanderId } : {}),
  };
}

function determineWinner(attacker: readonly RuntimeStack[], defender: readonly RuntimeStack[]): BattleWinner | null {
  const attackerAlive = sideAliveCount(attacker);
  const defenderAlive = sideAliveCount(defender);
  if (attackerAlive === 0 && defenderAlive === 0) return 'draw';
  if (attackerAlive === 0) return 'defender';
  if (defenderAlive === 0) return 'attacker';
  return null;
}

export function resolveCombat(input: CombatInput, context: CombatResolverContext): BattleReport {
  const validation = validateCombatInput(input);
  if (!validation.ok) throw new CombatInputValidationError(validation.errors);
  const normalized = validation.value;
  const attackerTechnologies = normalizeCombatTechnologies(normalized.attackerTechnologies);
  const defenderTechnologies = normalizeCombatTechnologies(normalized.defenderTechnologies);

  const attacker = [
    ...runtimeFromInput('attacker', 'stacks', normalized.attacker.ships, attackerTechnologies),
    ...runtimeFromInput('attacker', 'stacks', normalized.attacker.commanders, attackerTechnologies),
  ];
  const defender = [
    ...runtimeFromInput('defender', 'stacks', normalized.defender.ships, defenderTechnologies),
    ...runtimeFromInput('defender', 'stacks', normalized.defender.commanders, defenderTechnologies),
    ...runtimeFromInput('defender', 'defenses', normalized.defender.defenses ?? [], defenderTechnologies),
  ];

  const attackerCommanderIds = normalized.attacker.commanders
    .filter((stack) => stack.count > 0)
    .map((stack) => stack.entityId as CommanderId);
  const defenderCommanderIds = normalized.defender.commanders
    .filter((stack) => stack.count > 0)
    .map((stack) => stack.entityId as CommanderId);

  const activeAttackerCommander = selectActiveCommander(normalized.attackerPriority, attackerCommanderIds);
  const activeDefenderCommander = selectActiveCommander(normalized.defenderPriority, defenderCommanderIds);

  const rounds: CombatRound[] = [];
  let winner: BattleWinner | null = determineWinner(attacker, defender);

  for (let roundIndex = 1; roundIndex <= normalized.maxRounds && !winner; roundIndex += 1) {
    const attackerStartCounts = new Map(sortRuntime(attacker).map((stack) => [stack.entityId, stack.count]));
    const defenderStartCounts = new Map(sortRuntime(defender).map((stack) => [stack.entityId, stack.count]));

    const planned = [
      ...planSideAttacks(attacker, defender),
      ...planSideAttacks(defender, attacker),
    ];

    const runtimeBySide = {
      attacker: new Map(attacker.map((stack) => [stack.entityId, stack])),
      defender: new Map(defender.map((stack) => [stack.entityId, stack])),
    } as const;

    const events: CombatEvent[] = [];
    planned.forEach((attack, plannedIndex) => {
      const target = runtimeBySide[attack.targetSide].get(attack.targetEntityId);
      if (!target) return;

      const countBeforeEvent = target.count;
      const hpBefore = target.hpPool;
      const actualDamage = target.hpPool <= 0 ? 0 : Math.min(attack.effectiveDamage, target.hpPool);
      target.hpPool = Math.max(0, target.hpPool - actualDamage);
      target.count = runtimeCountFromHp(target);
      const countAfterEvent = target.count;

      events.push({
        sequence: plannedIndex + 1,
        actorSide: attack.actorSide,
        actorEntityId: attack.actorEntityId,
        targetSide: attack.targetSide,
        targetEntityId: attack.targetEntityId,
        actionType: 'attack',
        actorCount: attack.actorCount,
        targetCount: countBeforeEvent,
        attackValue: attack.rawDamage,
        damage: actualDamage,
        destroyedCount: Math.max(0, countBeforeEvent - countAfterEvent),
        lifeBefore: hpBefore,
        lifeAfter: target.hpPool,
        note: actualDamage === 0
          ? 'Запланированный залп потерян: цель уже уничтожена ранее в этом раунде. Ретаргет не выполняется.'
          : `Урон после брони ${target.armorPercent}%.`,
      });
    });

    rounds.push({
      index: roundIndex,
      events,
      attackerSnapshot: createRoundSnapshot(attacker, attackerStartCounts),
      defenderSnapshot: createRoundSnapshot(defender, defenderStartCounts),
    });

    winner = determineWinner(attacker, defender);
  }

  if (!winner) winner = 'draw';

  return {
    id: context.reportId,
    timestamp: normalized.timestamp,
    missionType: 'simulation',
    attacker: { ...normalized.attacker.participant, side: 'attacker' },
    defender: { ...normalized.defender.participant, side: 'defender' },
    winner,
    roundCount: rounds.length,
    attackerForce: createForceSnapshot(attacker, activeAttackerCommander),
    defenderForce: createForceSnapshot(defender, activeDefenderCommander),
    rounds,
    metadata: {
      source: 'combat-resolver',
      note: 'Asterion Combat Resolver v1',
      maxRounds: normalized.maxRounds,
    },
  };
}

export function combatInputPopulation(input: CombatInput) {
  return {
    attacker: calculateStacksPopulation([...input.attacker.ships, ...input.attacker.commanders]),
    defenderFleet: calculateStacksPopulation([...input.defender.ships, ...input.defender.commanders]),
    defenderDefense: calculateStacksPopulation(input.defender.defenses ?? []),
  };
}
