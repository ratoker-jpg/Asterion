import { COMBAT_CATALOG, getCombatEntity } from './catalog.ts';
import type { CommanderId } from './commanders.ts';
import {
  COMBAT_PROFILE_ID,
  COMBAT_RULE_PROVENANCE,
  DEFAULT_COMBAT_TARGET_PRIORITY,
  type CombatExecutionMode,
  type CombatTargetPriority,
  type CombatTechnologyMode,
} from './config.ts';
import type { CombatEntityId } from './ids.ts';
import { selectActiveCommander } from './priority.ts';
import {
  BATTLE_REPORT_SCHEMA_VERSION,
  COMBAT_ENGINE_VERSION,
} from './report.ts';
import type {
  BattleForceSnapshot,
  BattleMissionType,
  BattleReport,
  BattleRoundSummary,
  BattleSide,
  BattleStackSnapshot,
  BattleTechnologySnapshot,
  BattleWinner,
  CombatEvent,
  CombatProvenance,
  CombatRound,
  CombatRoundSnapshot,
  RngProvenance,
} from './report.ts';
import {
  calculateStacksPopulation,
  getSideCommanders,
  validateCombatInput,
  type CombatInput,
  type CombatStackInput,
} from './simulator.ts';
import {
  COMBAT_TECHNOLOGIES,
  getCombatTechnologyDefinition,
  getTechnologyArmorPercent,
  getTechnologyAttackMultiplier,
  getTechnologyLifeMultiplier,
  normalizeCombatTechnologies,
  type CombatTechnologyLevels,
} from './technologies.ts';

export type CombatResolverContext = {
  reportId: string;
  /** Production combat may classify the result; omitted means simulator. */
  missionType?: Exclude<BattleMissionType, 'simulation'>;
};

type RuntimeBucket = 'stacks' | 'defenses';

type RuntimeStack = {
  side: BattleSide;
  bucket: RuntimeBucket;
  entityId: CombatEntityId;
  level: number;
  startingCount: number;
  count: number;
  hpPool: number;
  lifePerUnit: number;
  attackPerUnit: number;
  armorPercent: number;
  populationPerUnit: number;
  weaponType: string;
  armorType: string;
};

export type TargetSelectionCandidate = {
  entityId: CombatEntityId;
  currentCount: number;
  threat?: number;
  population?: number;
};

export class CombatInputValidationError extends Error {
  readonly errors: ReturnType<typeof validateCombatInput>['errors'];

  constructor(errors: ReturnType<typeof validateCombatInput>['errors']) {
    super(errors.map((error) => error.message).join(' '));
    this.name = 'CombatInputValidationError';
    this.errors = errors;
  }
}

export type CombatRng = {
  next: () => number;
  provenance: () => RngProvenance;
};

function hashSeed(seed: string) {
  let hash = 2_166_136_261;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return hash >>> 0 || 1;
}

export function createSeededCombatRng(seed: string): CombatRng {
  let state = hashSeed(seed);
  let drawCount = 0;
  return {
    next: () => {
      state ^= state << 13;
      state ^= state >>> 17;
      state ^= state << 5;
      state >>>= 0;
      drawCount += 1;
      return state / 4_294_967_296;
    },
    provenance: () => ({
      mode: 'seeded',
      algorithmVersion: 'asterion-xorshift32-v1',
      seed,
      drawCount,
    }),
  };
}

export function createNonReplayableCombatRng(): CombatRng {
  let drawCount = 0;
  return {
    next: () => {
      drawCount += 1;
      return Math.random();
    },
    provenance: () => ({
      mode: 'non-replayable',
      drawCount,
      note: 'Seed не задан. В текущем baseline случайные механики не активны.',
    }),
  };
}

const CATALOG_ORDER = new Map<CombatEntityId, number>(COMBAT_CATALOG.map((entity, index) => [entity.id, index]));

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

export function selectCombatTarget(
  candidates: readonly TargetSelectionCandidate[],
  priority: CombatTargetPriority = DEFAULT_COMBAT_TARGET_PRIORITY,
): TargetSelectionCandidate | null {
  const alive = candidates.filter((candidate) => candidate.currentCount > 0);
  if (!alive.length) return null;

  return [...alive].sort((left, right) => {
    const leftEntity = getCombatEntity(left.entityId);
    const rightEntity = getCombatEntity(right.entityId);
    const leftThreat = left.threat ?? left.currentCount * leftEntity.combat.attack;
    const rightThreat = right.threat ?? right.currentCount * rightEntity.combat.attack;
    const leftPopulation = left.population ?? left.currentCount * leftEntity.population;
    const rightPopulation = right.population ?? right.currentCount * rightEntity.population;
    if (priority === 'population' && leftPopulation !== rightPopulation) return rightPopulation - leftPopulation;
    if (priority === 'population' && leftThreat !== rightThreat) return rightThreat - leftThreat;
    if (priority === 'catalog') {
      const catalogDelta = catalogOrder(left.entityId) - catalogOrder(right.entityId);
      if (catalogDelta !== 0) return catalogDelta;
      if (leftThreat !== rightThreat) return rightThreat - leftThreat;
    }
    if (priority === 'threat' && leftThreat !== rightThreat) return rightThreat - leftThreat;
    if (priority !== 'catalog' && leftPopulation !== rightPopulation) return rightPopulation - leftPopulation;

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
  executionMode: CombatExecutionMode,
): RuntimeStack[] {
  return stacks.map((stack) => {
    const entity = getCombatEntity(stack.entityId);
    const lifePerUnit = Math.max(1, entity.combat.life * getTechnologyLifeMultiplier(entity, technologies, executionMode));
    const attackPerUnit = Math.max(0, entity.combat.attack * getTechnologyAttackMultiplier(entity, technologies, executionMode));
    const armorPercent = clamp(getTechnologyArmorPercent(entity, technologies, executionMode), 0, 80);
    return {
      side,
      bucket,
      entityId: stack.entityId,
      level: stack.level ?? 0,
      startingCount: stack.count,
      count: stack.count,
      hpPool: stack.count * lifePerUnit,
      lifePerUnit,
      attackPerUnit,
      armorPercent,
      populationPerUnit: entity.population,
      weaponType: entity.combat.weaponType,
      armorType: entity.combat.armorType,
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

function bucketPopulation(
  stacks: readonly RuntimeStack[],
  bucket: RuntimeBucket,
  counts?: ReadonlyMap<CombatEntityId, number>,
) {
  return stacks
    .filter((stack) => stack.bucket === bucket)
    .reduce((total, stack) => total + (counts?.get(stack.entityId) ?? stack.count) * stack.populationPerUnit, 0);
}

function runtimeCountFromHp(stack: RuntimeStack) {
  return stack.hpPool <= 0 ? 0 : Math.ceil(stack.hpPool / stack.lifePerUnit);
}

function createRoundSnapshot(
  stacks: readonly RuntimeStack[],
  roundStartCounts: ReadonlyMap<CombatEntityId, number>,
  roundStartHp: ReadonlyMap<CombatEntityId, number>,
): CombatRoundSnapshot {
  const build = (bucket: RuntimeBucket): BattleStackSnapshot[] => sortRuntime(stacks)
    .filter((stack) => stack.bucket === bucket)
    .map((stack) => {
      const countBefore = roundStartCounts.get(stack.entityId) ?? 0;
      const lifeBefore = roundStartHp.get(stack.entityId) ?? 0;
      return {
        entityId: stack.entityId,
        countBefore,
        countAfter: stack.count,
        destroyed: Math.max(0, countBefore - stack.count),
        level: stack.level,
        lifeBefore,
        lifeAfter: stack.hpPool,
        life: stack.hpPool,
        armor: stack.armorPercent,
      };
    });

  const regularStacks = build('stacks');
  const defenses = build('defenses');
  return {
    stacks: regularStacks,
    fleetPopulationBefore: bucketPopulation(stacks, 'stacks', roundStartCounts),
    fleetPopulationAfter: bucketPopulation(stacks, 'stacks'),
    ...(defenses.length
      ? {
          defenses,
          defensePopulationBefore: bucketPopulation(stacks, 'defenses', roundStartCounts),
          defensePopulationAfter: bucketPopulation(stacks, 'defenses'),
        }
      : {}),
  };
}

function createForceSnapshot(
  stacks: readonly RuntimeStack[],
  activeCommanderId: CommanderId | null,
  activeCommanderLevel: number | undefined,
  technologyLevels: CombatTechnologyLevels,
  technologySnapshots: BattleTechnologySnapshot[],
): BattleForceSnapshot {
  const build = (bucket: RuntimeBucket): BattleStackSnapshot[] => sortRuntime(stacks)
    .filter((stack) => stack.bucket === bucket)
    .map((stack) => ({
      entityId: stack.entityId,
      countBefore: stack.startingCount,
      countAfter: stack.count,
      destroyed: Math.max(0, stack.startingCount - stack.count),
      level: stack.level,
      life: stack.hpPool,
      lifeAfter: stack.hpPool,
      armor: stack.armorPercent,
    }));

  const regularStacks = build('stacks');
  const defenses = build('defenses');
  const startingCounts = new Map(sortRuntime(stacks).map((stack) => [stack.entityId, stack.startingCount]));
  const populationBefore = stacks.reduce((total, stack) => total + stack.startingCount * stack.populationPerUnit, 0);
  const populationAfter = sidePopulation(stacks);

  return {
    populationBefore,
    populationAfter,
    stacks: regularStacks,
    fleetPopulationBefore: bucketPopulation(stacks, 'stacks', startingCounts),
    fleetPopulationAfter: bucketPopulation(stacks, 'stacks'),
    ...(defenses.length ? { defenses } : {}),
    ...(defenses.length
      ? {
          defensePopulationBefore: bucketPopulation(stacks, 'defenses', startingCounts),
          defensePopulationAfter: bucketPopulation(stacks, 'defenses'),
        }
      : {}),
    ...(activeCommanderId ? { activeCommanderId } : {}),
    ...(activeCommanderLevel !== undefined ? { activeCommanderLevel } : {}),
    technologyLevels,
    technologies: technologyLevels,
    technologySnapshots,
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

function technologySnapshots(levels: CombatTechnologyLevels): BattleTechnologySnapshot[] {
  return COMBAT_TECHNOLOGIES.map((technology) => {
    const definition = getCombatTechnologyDefinition(technology.id);
    return {
      id: technology.id,
      level: levels[technology.id],
      maxLevel: definition.maxLevel,
      status: definition.effectStatus,
      note: definition.effect,
    };
  });
}

const DAMAGE_PROVENANCE: CombatProvenance = {
  status: 'inferred',
  source: 'Existing Asterion Combat Resolver v1',
  confidence: 'medium',
  note: 'Сохранён baseline-расчёт брони; это не заявление о полном совпадении с Nemexia.',
};

function createRoundSummary(
  events: readonly CombatEvent[],
  attacker: readonly RuntimeStack[],
  defender: readonly RuntimeStack[],
): BattleRoundSummary {
  const damageByWeapon: Record<string, number> = {};
  let attackerDamage = 0;
  let defenderDamage = 0;
  let destroyedUnits = 0;
  let destroyedPopulation = 0;

  events.forEach((event) => {
    const damage = event.damage ?? 0;
    if (event.actorSide === 'attacker') attackerDamage += damage;
    else defenderDamage += damage;
    if (event.weaponType) damageByWeapon[event.weaponType] = (damageByWeapon[event.weaponType] ?? 0) + damage;
    const destroyed = event.destroyedCount ?? 0;
    destroyedUnits += destroyed;
    if (event.targetEntityId) destroyedPopulation += destroyed * getCombatEntity(event.targetEntityId).population;
  });

  return {
    attackerDamage,
    defenderDamage,
    damageByWeapon,
    destroyedUnits,
    destroyedPopulation,
    survivingPopulation: { attacker: sidePopulation(attacker), defender: sidePopulation(defender) },
    ...(defender.some((stack) => stack.bucket === 'defenses')
      ? { survivingDefensePopulation: bucketPopulation(defender, 'defenses') }
      : {}),
  };
}

function createAttackEvent(sequence: number, actor: RuntimeStack, target: RuntimeStack): CombatEvent {
  const countBeforeEvent = target.count;
  const hpBefore = target.hpPool;
  const rawDamage = actor.count * actor.attackPerUnit;
  const effectiveDamage = calculateEffectiveDamage(rawDamage, target.armorPercent);
  const actualDamage = target.hpPool <= 0 ? 0 : Math.min(effectiveDamage, target.hpPool);
  target.hpPool = Math.max(0, target.hpPool - actualDamage);
  target.count = runtimeCountFromHp(target);
  const countAfterEvent = target.count;

  return {
    sequence,
    actorSide: actor.side,
    actorEntityId: actor.entityId,
    targetSide: target.side,
    targetEntityId: target.entityId,
    actionType: 'attack',
    actorCount: actor.count,
    targetCount: countBeforeEvent,
    attackValue: rawDamage,
    rawDamage,
    effectiveDamage,
    mitigation: Math.max(0, rawDamage - effectiveDamage),
    weaponType: actor.weaponType,
    armorType: target.armorType,
    damage: actualDamage,
    destroyedCount: Math.max(0, countBeforeEvent - countAfterEvent),
    lifeBefore: hpBefore,
    lifeAfter: target.hpPool,
    armorBefore: target.armorPercent,
    armorAfter: target.armorPercent,
    provenance: DAMAGE_PROVENANCE,
    note: actualDamage === 0
      ? 'Залп не нанёс урон: цель уже уничтожена.'
      : `Урон после брони ${target.armorPercent}%. Следующий живой стек выбирается заново.`,
  };
}

function createNoTargetEvent(sequence: number, actor: RuntimeStack): CombatEvent {
  return {
    sequence,
    actorSide: actor.side,
    actorEntityId: actor.entityId,
    actionType: 'status',
    actorCount: actor.count,
    provenance: { status: 'structural', source: 'Asterion sequential resolver', confidence: 'high' },
    note: 'Действие пропущено: на стороне противника не осталось живых целей.',
  };
}

function createSkippedActionEvent(sequence: number, actor: RuntimeStack): CombatEvent {
  return {
    sequence,
    actorSide: actor.side,
    actorEntityId: actor.entityId,
    actionType: 'status',
    actorCount: actor.count,
    provenance: { status: 'structural', source: 'Asterion sequential resolver', confidence: 'high' },
    note: 'Залп пропущен: стек уничтожен до своей очереди и не совершает действие.',
  };
}

function resolveSideActions(
  actorStacks: readonly RuntimeStack[],
  targetStacks: readonly RuntimeStack[],
  events: CombatEvent[],
  sequence: { value: number },
  targetPriority: CombatTargetPriority,
) {
  for (const actor of sortRuntime(actorStacks)) {
    if (actor.count <= 0) {
      events.push(createSkippedActionEvent(sequence.value++, actor));
      continue;
    }
    if (actor.attackPerUnit <= 0) continue;
    const target = selectCombatTarget(targetStacks.map((stack) => ({
      entityId: stack.entityId,
      currentCount: stack.count,
      threat: stack.count * stack.attackPerUnit,
      population: stack.count * stack.populationPerUnit,
    })), targetPriority);
    if (!target) {
      events.push(createNoTargetEvent(sequence.value++, actor));
      continue;
    }
    const targetRuntime = targetStacks.find((stack) => stack.entityId === target.entityId);
    if (!targetRuntime) {
      events.push(createNoTargetEvent(sequence.value++, actor));
      continue;
    }
    events.push(createAttackEvent(sequence.value++, actor, targetRuntime));
  }
}

function activeCommanderLevel(stacks: readonly CombatStackInput[], id: CommanderId | null) {
  return id ? stacks.find((stack) => stack.entityId === id && stack.count > 0)?.level : undefined;
}

export function resolveCombat(input: CombatInput, context: CombatResolverContext): BattleReport {
  const validation = validateCombatInput(input);
  if (!validation.ok) throw new CombatInputValidationError(validation.errors);
  const normalized = validation.value;
  const requestedAttackerTechnologies = normalizeCombatTechnologies(normalized.attackerTechnologies);
  const requestedDefenderTechnologies = normalizeCombatTechnologies(normalized.defenderTechnologies);
  const technologyMode: CombatTechnologyMode = normalized.technologyMode === 'shared' ? 'shared' : 'independent';
  const attackerTargetPriority = normalized.attackerTargetPriority ?? DEFAULT_COMBAT_TARGET_PRIORITY;
  const defenderTargetPriority = normalized.defenderTargetPriority ?? DEFAULT_COMBAT_TARGET_PRIORITY;
  const attackerTechnologies = requestedAttackerTechnologies;
  const defenderTechnologies = technologyMode === 'shared' ? requestedAttackerTechnologies : requestedDefenderTechnologies;
  const executionMode: CombatExecutionMode = normalized.executionMode === 'production' ? 'production' : 'calibration';
  const rng = normalized.seed ? createSeededCombatRng(normalized.seed) : createNonReplayableCombatRng();

  // Unknown mechanics are deliberately inactive. The RNG interface is still
  // included so future evidence-backed mechanics can consume it reproducibly.
  void rng.next;

  const attacker = [
    ...runtimeFromInput('attacker', 'stacks', normalized.attacker.ships, attackerTechnologies, executionMode),
    ...runtimeFromInput('attacker', 'stacks', getSideCommanders(normalized.attacker), attackerTechnologies, executionMode),
  ];
  const defender = [
    ...runtimeFromInput('defender', 'stacks', normalized.defender.ships, defenderTechnologies, executionMode),
    ...runtimeFromInput('defender', 'stacks', getSideCommanders(normalized.defender), defenderTechnologies, executionMode),
    ...runtimeFromInput('defender', 'defenses', normalized.defender.defenses ?? [], defenderTechnologies, executionMode),
  ];

  const attackerCommanderIds = getSideCommanders(normalized.attacker)
    .filter((stack) => stack.count > 0)
    .map((stack) => stack.entityId as CommanderId);
  const defenderCommanderIds = getSideCommanders(normalized.defender)
    .filter((stack) => stack.count > 0)
    .map((stack) => stack.entityId as CommanderId);
  const activeAttackerCommander = selectActiveCommander(normalized.attackerPriority, attackerCommanderIds);
  const activeDefenderCommander = selectActiveCommander(normalized.defenderPriority, defenderCommanderIds);

  const rounds: CombatRound[] = [];
  let winner: BattleWinner | null = determineWinner(attacker, defender);
  let eventSequence = 1;

  for (let roundIndex = 1; roundIndex <= normalized.maxRounds && !winner; roundIndex += 1) {
    const attackerStartCounts = new Map(sortRuntime(attacker).map((stack) => [stack.entityId, stack.count]));
    const defenderStartCounts = new Map(sortRuntime(defender).map((stack) => [stack.entityId, stack.count]));
    const attackerStartHp = new Map(sortRuntime(attacker).map((stack) => [stack.entityId, stack.hpPool]));
    const defenderStartHp = new Map(sortRuntime(defender).map((stack) => [stack.entityId, stack.hpPool]));
    const events: CombatEvent[] = [];
    const sequence = { value: eventSequence };

    resolveSideActions(attacker, defender, events, sequence, attackerTargetPriority);
    winner = determineWinner(attacker, defender);
    if (!winner) resolveSideActions(defender, attacker, events, sequence, defenderTargetPriority);
    winner = determineWinner(attacker, defender);
    eventSequence = sequence.value;

    rounds.push({
      index: roundIndex,
      events,
      summary: createRoundSummary(events, attacker, defender),
      attackerSnapshot: createRoundSnapshot(attacker, attackerStartCounts, attackerStartHp),
      defenderSnapshot: createRoundSnapshot(defender, defenderStartCounts, defenderStartHp),
    });
  }

  if (!winner) winner = 'draw';
  const attackerTechSnapshots = technologySnapshots(attackerTechnologies);
  const defenderTechSnapshots = technologySnapshots(defenderTechnologies);
  const unknowns = COMBAT_TECHNOLOGIES
    .filter((technology) => technology.effectStatus === 'unknown')
    .map((technology) => `${technology.name}: эффект не калиброван и не активирован.`)
    .concat('Уровни стеков: коэффициенты влияния на бой не подтверждены и не активированы.');

  return {
    id: context.reportId,
    schemaVersion: BATTLE_REPORT_SCHEMA_VERSION,
    engineVersion: COMBAT_ENGINE_VERSION,
    timestamp: normalized.timestamp,
    missionType: context.missionType ?? 'simulation',
    attacker: { ...normalized.attacker.participant, side: 'attacker' },
    defender: { ...normalized.defender.participant, side: 'defender' },
    winner,
    roundCount: rounds.length,
    attackerForce: createForceSnapshot(
      attacker,
      activeAttackerCommander,
      activeCommanderLevel(getSideCommanders(normalized.attacker), activeAttackerCommander),
      attackerTechnologies,
      attackerTechSnapshots,
    ),
    defenderForce: createForceSnapshot(
      defender,
      activeDefenderCommander,
      activeCommanderLevel(getSideCommanders(normalized.defender), activeDefenderCommander),
      defenderTechnologies,
      defenderTechSnapshots,
    ),
    rounds,
    metadata: {
      source: 'combat-resolver',
      note: `${COMBAT_ENGINE_VERSION}; unknown mechanics are fail-safe inactive.`,
      maxRounds: normalized.maxRounds,
      profileId: normalized.profileId ?? COMBAT_PROFILE_ID,
      engineVersion: COMBAT_ENGINE_VERSION,
      executionMode,
      technologyMode,
      targetPriority: { attacker: attackerTargetPriority, defender: defenderTargetPriority },
      rngProvenance: rng.provenance(),
      provenance: {
        ...COMBAT_RULE_PROVENANCE,
        damageFormula: DAMAGE_PROVENANCE,
        criticalHit: { status: 'unknown', source: 'Evidence ledger', confidence: 'low', note: 'Not activated.' },
      },
      unknowns,
    },
  };
}

export function combatInputPopulation(input: CombatInput) {
  return {
    attacker: calculateStacksPopulation([...input.attacker.ships, ...getSideCommanders(input.attacker)]),
    defenderFleet: calculateStacksPopulation([...input.defender.ships, ...getSideCommanders(input.defender)]),
    defenderDefense: calculateStacksPopulation(input.defender.defenses ?? []),
  };
}
