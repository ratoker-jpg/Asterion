import { COMBAT_CATALOG, getCombatEntity } from './catalog.ts';
import { getFactionCombatEntity } from './faction-catalog.ts';
import { getCommanderCombatEffect, type CommanderId } from './commanders.ts';
import {
  COMBAT_PROFILE_ID,
  COMBAT_RULE_PROVENANCE,
  COMBAT_SHIP_LEVEL_COEFFICIENTS,
  DEFAULT_COMBAT_TARGET_PRIORITY,
  type CombatExecutionMode,
  type CombatTargetPriority,
  type CombatTechnologyMode,
} from './config.ts';
import type { CombatEntityId } from './ids.ts';
import type { CombatEntityKind, CombatOrdinaryClass, CombatSpecialBonus } from './types.ts';
import {
  BATTLE_REPORT_SCHEMA_VERSION,
  COMBAT_ENGINE_VERSION,
} from './report.ts';
import type {
  BattleForceSnapshot,
  BattleInitialSnapshot,
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
import { getCombatFactionId, type CombatFactionId } from './factions.ts';
import {
  COMBAT_TECHNOLOGIES,
  getCombatTechnologyDefinition,
  getTechnologyArmorPercent,
  getTechnologyAttackMultiplier,
  getTechnologyCriticalChance,
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
  kind: CombatEntityKind;
  entityId: CombatEntityId;
  level: number;
  startingCount: number;
  count: number;
  hpPool: number;
  baseLifePerUnit: number;
  lifePerUnit: number;
  baseAttackPerUnit: number;
  attackPerUnit: number;
  baseArmorPercent: number;
  armorPercent: number;
  criticalChance: number;
  populationPerUnit: number;
  weaponType: string;
  armorType: string;
  ordinaryClass?: CombatOrdinaryClass;
  specialBonus?: CombatSpecialBonus;
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
      algorithmVersion: 'system-random-v1',
      drawCount,
      note: 'Seed не задан. В текущем baseline случайные механики не активны.',
    }),
  };
}

const CATALOG_ORDER = new Map<CombatEntityId, number>(COMBAT_CATALOG.map((entity, index) => [entity.id, index]));

const MATCHUP_MULTIPLIERS: Readonly<Record<CombatOrdinaryClass, Readonly<Record<CombatOrdinaryClass, number>>>> = {
  scout: { scout: 0.70, cruiser: 1.00, defender: 1.70, battleship: 1.70, destroyer: 1.00, bomber: 1.00 },
  cruiser: { scout: 1.70, cruiser: 0.70, defender: 1.70, battleship: 0.70, destroyer: 1.00, bomber: 1.00 },
  defender: { scout: 0.70, cruiser: 1.00, defender: 0.70, battleship: 1.00, destroyer: 1.00, bomber: 1.70 },
  battleship: { scout: 1.00, cruiser: 1.70, defender: 1.70, battleship: 0.70, destroyer: 0.70, bomber: 1.00 },
  destroyer: { scout: 1.00, cruiser: 1.00, defender: 1.00, battleship: 1.70, destroyer: 0.70, bomber: 0.70 },
  bomber: { scout: 1.00, cruiser: 0.70, defender: 1.00, battleship: 1.00, destroyer: 1.70, bomber: 0.70 },
};

function levelCoefficient(entity: ReturnType<typeof getCombatEntity>) {
  return entity.ordinaryClass ? COMBAT_SHIP_LEVEL_COEFFICIENTS[entity.ordinaryClass] : 0;
}

function matchupFor(actor: RuntimeStack, target: RuntimeStack) {
  const actorClass = actor.ordinaryClass;
  const targetClass = target.ordinaryClass;
  if (actorClass && targetClass) {
    return { multiplier: MATCHUP_MULTIPLIERS[actorClass][targetClass], status: 'inferred' as const };
  }
  return {
    multiplier: 1,
    status: 'not-calibrated' as const,
  };
}

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
  factionId: CombatFactionId,
): RuntimeStack[] {
  return stacks.map((stack) => {
    const entity = getFactionCombatEntity(factionId, stack.entityId);
    const level = stack.level ?? 0;
    const coefficient = levelCoefficient(entity);
    const levelAndTechnologyAttack = 1 + coefficient * level + (getTechnologyAttackMultiplier(entity, technologies, executionMode) - 1);
    const levelAndTechnologyLife = 1 + coefficient * level + (getTechnologyLifeMultiplier(entity, technologies, executionMode) - 1);
    const baseAttackPerUnit = Math.max(0, Math.floor(entity.combat.attack * levelAndTechnologyAttack));
    const baseLifePerUnit = Math.max(1, Math.floor(entity.combat.life * levelAndTechnologyLife));
    const baseArmorPercent = clamp(getTechnologyArmorPercent(entity, technologies, executionMode), 0, 80);
    return {
      side,
      bucket,
      kind: entity.kind,
      entityId: stack.entityId,
      level,
      startingCount: stack.count,
      count: stack.count,
      hpPool: stack.count * baseLifePerUnit,
      baseLifePerUnit,
      lifePerUnit: baseLifePerUnit,
      baseAttackPerUnit,
      attackPerUnit: baseAttackPerUnit,
      baseArmorPercent,
      armorPercent: baseArmorPercent,
      criticalChance: getTechnologyCriticalChance(technologies),
      populationPerUnit: entity.population,
      weaponType: entity.combat.weaponType,
      armorType: entity.combat.armorType,
      ...(entity.ordinaryClass ? { ordinaryClass: entity.ordinaryClass } : {}),
      ...(entity.specialBonus ? { specialBonus: entity.specialBonus } : {}),
    };
  });
}

function sortRuntime(stacks: readonly RuntimeStack[]) {
  return [...stacks].sort((left, right) => {
    const kindOrder = { ship: 0, commander: 1, defense: 2 } as const;
    const kindDelta = kindOrder[left.kind] - kindOrder[right.kind];
    if (kindDelta !== 0) return kindDelta;
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

type RoundSideModifiers = {
  commanderAttackMultiplier: number;
  commanderLifeMultiplier: number;
  commanderArmorPenalty: number;
  criticalBonus: number;
  specialBonuses: ReadonlyMap<CombatEntityId, { attack: number; life: number; armor: number }>;
  specialBonusDetails: readonly SpecialBonusDetail[];
  snapshot: Readonly<Record<string, number | string>>;
};

type SpecialBonusDetail = {
  entityId: CombatEntityId;
  actorSide: BattleSide;
  livingCount: number;
  kind: CombatSpecialBonus['kind'];
  rate: number;
  cap?: number;
  capStatus: 'known' | 'unknown';
  amount: number;
  scope: 'fleet' | 'asterion';
  status: CombatSpecialBonus['status'];
  source?: string;
  note?: string;
};

function commanderFor(stacks: readonly RuntimeStack[], commanderId: CommanderId | null) {
  return commanderId
    ? stacks.find((stack) => stack.entityId === commanderId && stack.kind === 'commander' && stack.count > 0)
    : undefined;
}

function calculateRoundSideModifiers(stacks: readonly RuntimeStack[], commanderId: CommanderId | null): RoundSideModifiers {
  const commander = commanderFor(stacks, commanderId);
  const commanderEffect = getCommanderCombatEffect(commanderId);
  const commanderLevel = commander?.level ?? 0;
  const commanderRate = commanderEffect ? commanderEffect.ratePerLevel * commanderLevel : 0;
  const specialBonuses = new Map<CombatEntityId, { attack: number; life: number; armor: number }>();
  const specialBonusDetails: SpecialBonusDetail[] = [];
  const snapshot: Record<string, number | string> = {};

  if (commanderId) {
    snapshot.commanderId = commanderId;
    snapshot.commanderLevel = commanderLevel;
    snapshot.commanderAbility = commanderEffect?.kind ?? 'not-calibrated';
    snapshot.commanderRate = commanderRate;
  }

  for (const donor of stacks) {
    if (!donor.specialBonus || donor.count <= 0) continue;
    const amount = Math.min(donor.specialBonus.cap ?? Number.POSITIVE_INFINITY, donor.specialBonus.rate * donor.count);
    if (!Number.isFinite(amount) || amount <= 0) continue;
    specialBonusDetails.push({
      entityId: donor.entityId,
      actorSide: donor.side,
      livingCount: donor.count,
      kind: donor.specialBonus.kind,
      rate: donor.specialBonus.rate,
      ...(donor.specialBonus.cap !== undefined ? { cap: donor.specialBonus.cap } : {}),
      capStatus: donor.specialBonus.capStatus ?? (donor.specialBonus.cap === undefined ? 'unknown' : 'known'),
      amount,
      scope: donor.specialBonus.scope ?? 'fleet',
      status: donor.specialBonus.status,
      ...(donor.specialBonus.source ? { source: donor.specialBonus.source } : {}),
      ...(donor.specialBonus.note ? { note: donor.specialBonus.note } : {}),
    });
    snapshot[`specialBonus:${donor.entityId}`] = amount;
    for (const recipient of stacks) {
      // The source stack is a donor, not a recipient. This matters for the
      // extracted special-unit rules: a Goliath/Defender/Star Armada does not
      // amplify itself, while every other living allied stack receives the
      // frozen round-start contribution.
      if (recipient.entityId === donor.entityId || recipient.count <= 0) continue;
      const current = specialBonuses.get(recipient.entityId) ?? { attack: 0, life: 0, armor: 0 };
      if (donor.specialBonus.kind === 'attack') current.attack += amount;
      if (donor.specialBonus.kind === 'life') current.life += amount;
      if (donor.specialBonus.kind === 'armor') current.armor += amount * 100;
      specialBonuses.set(recipient.entityId, current);
    }
  }

  return {
    commanderAttackMultiplier: commanderEffect?.kind === 'attack-bonus' ? 1 + commanderRate : 1,
    commanderLifeMultiplier: commanderEffect?.kind === 'life-bonus' ? 1 + commanderRate : 1,
    commanderArmorPenalty: commanderEffect?.kind === 'armor-debuff' ? commanderRate * 100 : 0,
    criticalBonus: commanderEffect?.kind === 'critical' ? commanderRate : 0,
    specialBonuses,
    specialBonusDetails,
    snapshot,
  };
}

function applyRoundModifiers(
  attacker: readonly RuntimeStack[],
  defender: readonly RuntimeStack[],
  attackerCommanderId: CommanderId | null,
  defenderCommanderId: CommanderId | null,
) {
  const attackerModifiers = calculateRoundSideModifiers(attacker, attackerCommanderId);
  const defenderModifiers = calculateRoundSideModifiers(defender, defenderCommanderId);

  const apply = (own: readonly RuntimeStack[], ownModifiers: RoundSideModifiers, enemyModifiers: RoundSideModifiers) => {
    for (const stack of own) {
      const special = ownModifiers.specialBonuses.get(stack.entityId) ?? { attack: 0, life: 0, armor: 0 };
      const previousLife = stack.lifePerUnit;
      const previousCount = stack.count;
      const previousLostHp = Math.max(0, previousCount * previousLife - stack.hpPool);
      stack.attackPerUnit = Math.max(0, Math.floor(stack.baseAttackPerUnit * (1 + special.attack) * ownModifiers.commanderAttackMultiplier));
      stack.lifePerUnit = Math.max(1, Math.floor(stack.baseLifePerUnit * (1 + special.life) * ownModifiers.commanderLifeMultiplier));
      stack.armorPercent = clamp(stack.baseArmorPercent + special.armor - enemyModifiers.commanderArmorPenalty, 0, 80);
      if (previousLife !== stack.lifePerUnit && previousCount > 0) {
        stack.hpPool = Math.max(0, previousCount * stack.lifePerUnit - previousLostHp);
        stack.count = runtimeCountFromHp(stack);
      }
    }
  };

  apply(attacker, attackerModifiers, defenderModifiers);
  apply(defender, defenderModifiers, attackerModifiers);
  return { attacker: attackerModifiers, defender: defenderModifiers };
}

export type CombatStackPreview = {
  attackPerUnit: number;
  totalAttack: number;
  lifePerUnit: number;
  hpPool: number;
  armorPercent: number;
};

/**
 * Shared preview for the simulator. It intentionally uses the same runtime
 * construction and round-start modifiers as resolveCombat, so the UI never
 * has to maintain a second approximation of level/science/commander math.
 */
export function calculateCombatStackPreview(
  stack: CombatStackInput,
  factionId: CombatFactionId,
  technologies: CombatTechnologyLevels,
  executionMode: CombatExecutionMode = 'production',
  alliedStacks: readonly CombatStackInput[] = [stack],
  activeCommanderId: CommanderId | null = null,
): CombatStackPreview | null {
  if (getFactionCombatEntity(factionId, stack.entityId).combatEligible === false) return null;
  const own = runtimeFromInput('attacker', 'stacks', alliedStacks, technologies, executionMode, factionId);
  if (!own.some((candidate) => candidate.entityId === stack.entityId)) return null;
  const modifiers = applyRoundModifiers(own, [], activeCommanderId, null);
  const runtime = own.find((candidate) => candidate.entityId === stack.entityId);
  if (!runtime) return null;
  void modifiers;
  return {
    attackPerUnit: runtime.attackPerUnit,
    totalAttack: runtime.count * runtime.attackPerUnit,
    lifePerUnit: runtime.lifePerUnit,
    hpPool: runtime.hpPool,
    armorPercent: runtime.armorPercent,
  };
}

function createRoundSnapshot(
  stacks: readonly RuntimeStack[],
  roundStartCounts: ReadonlyMap<CombatEntityId, number>,
  roundStartHp: ReadonlyMap<CombatEntityId, number>,
  modifiers?: Readonly<Record<string, number | string>>,
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
        // Round snapshots describe the state before actions. The explicit
        // lifeAfter/countAfter fields carry the result of this round, while
        // the legacy aliases stay aligned with the visible before-state.
        life: lifeBefore,
        lifePerUnit: stack.lifePerUnit,
        hpPool: lifeBefore,
        attackPerUnit: stack.attackPerUnit,
        totalAttack: countBefore * stack.attackPerUnit,
        armor: stack.armorPercent,
      };
    });

  const regularStacks = build('stacks');
  const defenses = build('defenses');
  return {
    stacks: regularStacks,
    fleetPopulationBefore: bucketPopulation(stacks, 'stacks', roundStartCounts),
    fleetPopulationAfter: bucketPopulation(stacks, 'stacks'),
    ...(modifiers ? { modifiers } : {}),
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
  modifiers?: Readonly<Record<string, number | string>>,
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
      lifePerUnit: stack.lifePerUnit,
      hpPool: stack.hpPool,
      attackPerUnit: stack.attackPerUnit,
      totalAttack: stack.count * stack.attackPerUnit,
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
    ...(modifiers ? { modifiers } : {}),
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
  let procs = 0;
  let repairs = 0;
  let criticalHits = 0;
  let paralyzes = 0;
  let cancelledAttacks = 0;

  events.forEach((event) => {
    const damage = event.damage ?? 0;
    if (event.actorSide === 'attacker') attackerDamage += damage;
    else defenderDamage += damage;
    if (event.weaponType) damageByWeapon[event.weaponType] = (damageByWeapon[event.weaponType] ?? 0) + damage;
    const destroyed = event.destroyedCount ?? 0;
    destroyedUnits += destroyed;
    if (event.targetEntityId) {
      const targetStacks = event.targetSide === 'attacker' ? attacker : defender;
      destroyedPopulation += destroyed * (targetStacks.find((stack) => stack.entityId === event.targetEntityId)?.populationPerUnit ?? 0);
    }
    if (event.actionType === 'ability') procs += 1;
    repairs += event.repairedCount ?? 0;
    if (event.criticalMultiplier && event.criticalMultiplier > 1) criticalHits += 1;
    if (event.commanderAbilityId === 'scorpion') paralyzes += event.actionType === 'ability' ? 1 : 0;
    if (event.commanderAbilityId === 'phantom') cancelledAttacks += event.actionType === 'ability' ? 1 : 0;
  });

  return {
    attackerDamage,
    defenderDamage,
    damageByWeapon,
    destroyedUnits,
    destroyedPopulation,
    procs,
    repairs,
    criticalHits,
    paralyzes,
    cancelledAttacks,
    survivingPopulation: { attacker: sidePopulation(attacker), defender: sidePopulation(defender) },
    ...(defender.some((stack) => stack.bucket === 'defenses')
      ? { survivingDefensePopulation: bucketPopulation(defender, 'defenses') }
      : {}),
  };
}

function createAbilityEvent(
  sequence: number,
  actor: RuntimeStack,
  commanderId: CommanderId,
  chance: number,
  draw: number,
  target?: RuntimeStack,
  note?: string,
): CombatEvent {
  return {
    sequence,
    actorSide: actor.side,
    actorEntityId: actor.entityId,
    ...(target ? {
      targetSide: target.side,
      targetEntityId: target.entityId,
      targetCount: target.count,
    } : {}),
    actionType: 'ability',
    actorCount: actor.count,
    commanderAbilityId: commanderId,
    abilityChance: chance,
    abilityDraw: draw,
    provenance: {
      status: commanderId === 'phantom' || commanderId === 'reanimator' ? 'inferred' : 'confirmed',
      source: 'ASTERION_FULL_BATTLE_IMPLEMENTATION_PROMPT.md §4.5',
      confidence: 'high',
    },
    note,
  };
}

function createSpecialBonusEvent(sequence: number, detail: SpecialBonusDetail): CombatEvent {
  const amount = detail.kind === 'armor' ? `${(detail.amount * 100).toFixed(3)} п.п.` : `${(detail.amount * 100).toFixed(3)}%`;
  const cap = detail.cap === undefined ? 'cap unknown' : `${(detail.cap * 100).toFixed(3)}%`;
  return {
    sequence,
    actorSide: detail.actorSide,
    actorEntityId: detail.entityId,
    actionType: 'special-bonus',
    actorCount: detail.livingCount,
    specialBonusKind: detail.kind,
    specialBonusRate: detail.rate,
    ...(detail.cap !== undefined ? { specialBonusCap: detail.cap } : {}),
    specialBonusCapStatus: detail.capStatus,
    specialBonusLivingCount: detail.livingCount,
    specialBonusAmount: detail.amount,
    specialBonusScope: detail.scope,
    provenance: {
      status: detail.status,
      ...(detail.source ? { source: detail.source } : {}),
      confidence: detail.status === 'confirmed' ? 'high' : detail.status === 'inferred' ? 'medium' : 'low',
      note: detail.note,
    },
    note: `Бонус начала раунда: ${detail.kind} = rate ${(detail.rate * 100).toFixed(3)}% × ${detail.livingCount} живых юнитов, cap ${cap}, итог ${amount}. Источник не получает собственный бонус; получатели — другие живые combat-eligible стеки (${detail.scope}).`,
  };
}

function appendSpecialBonusEvents(
  events: CombatEvent[],
  sequence: { value: number },
  modifiers: RoundSideModifiers,
) {
  modifiers.specialBonusDetails.forEach((detail) => {
    events.push(createSpecialBonusEvent(sequence.value++, detail));
  });
}

function createAttackEvent(
  sequence: number,
  actor: RuntimeStack,
  target: RuntimeStack,
  rng: CombatRng,
  criticalBonus: number,
): CombatEvent {
  const countBeforeEvent = target.count;
  const hpBefore = target.hpPool;
  const baseAttack = Math.max(0, Math.floor(actor.count * actor.attackPerUnit));
  const matchup = matchupFor(actor, target);
  const reportedBonus = matchup.multiplier === 1
    ? 0
    : Math.sign(matchup.multiplier - 1) * Math.floor(baseAttack * Math.abs(matchup.multiplier - 1));
  const rawDamageBeforeArmor = Math.max(0, Math.floor(baseAttack * matchup.multiplier));
  const criticalChance = clamp(actor.criticalChance + criticalBonus, 0, 1);
  const criticalDraw = criticalChance > 0 ? rng.next() : undefined;
  const criticalMultiplier = criticalDraw !== undefined && criticalDraw < criticalChance ? 2 : 1;
  const rawDamage = Math.floor(rawDamageBeforeArmor * criticalMultiplier);
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
    attackValue: baseAttack,
    baseAttack,
    attackPerUnit: actor.attackPerUnit,
    totalAttack: actor.count * actor.attackPerUnit,
    lifePerUnit: target.lifePerUnit,
    hpPool: hpBefore,
    rawDamage,
    rawDamageBeforeArmor,
    matchupMultiplier: matchup.multiplier,
    reportedBonus,
    matchupStatus: matchup.status,
    criticalChance,
    ...(criticalDraw !== undefined ? { abilityDraw: criticalDraw } : {}),
    criticalMultiplier,
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
      : `${matchup.multiplier === 1 ? 'Нейтральный модификатор пары' : `Модификатор пары ×${matchup.multiplier.toFixed(2)}`}; урон после брони ${target.armorPercent}%.${criticalMultiplier > 1 ? ' Критический залп ×2.' : ''} Следующая живая цель выбирается заново.`,
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

function createSkippedActionEvent(sequence: number, actor: RuntimeStack, note = 'Залп пропущен: стек уничтожен до своей очереди и не совершает действие.', commanderId?: CommanderId): CombatEvent {
  return {
    sequence,
    actorSide: actor.side,
    actorEntityId: actor.entityId,
    actionType: 'status',
    actorCount: actor.count,
    ...(commanderId ? { commanderAbilityId: commanderId } : {}),
    provenance: { status: 'structural', source: 'Asterion sequential resolver', confidence: 'high' },
    note,
  };
}

function createNoAttackEvent(sequence: number, actor: RuntimeStack): CombatEvent {
  return {
    sequence,
    actorSide: actor.side,
    actorEntityId: actor.entityId,
    actionType: 'status',
    actorCount: actor.count,
    provenance: { status: 'not-calibrated', source: 'Asterion combat catalog', confidence: 'medium' },
    note: 'Действие не выполнено: у сущности нет подтверждённой атаки в этом профиле.',
  };
}

function commanderAtSide(stacks: readonly RuntimeStack[], id: CommanderId | null, expectedId: CommanderId) {
  return id === expectedId ? commanderFor(stacks, id) : undefined;
}

function resolveReanimator(
  stacks: readonly RuntimeStack[],
  activeCommanderId: CommanderId | null,
  events: CombatEvent[],
  sequence: { value: number },
  rng: CombatRng,
) {
  const reanimator = commanderAtSide(stacks, activeCommanderId, 'reanimator');
  if (!reanimator) return;
  const effect = getCommanderCombatEffect('reanimator');
  const chance = effect ? effect.ratePerLevel * reanimator.level : 0;
  const draw = rng.next();
  if (draw >= chance) return;
  const target = sortRuntime(stacks).find((stack) => stack.count > 0 && stack.startingCount > stack.count);
  if (!target) return;
  const repairedCount = Math.min(effect?.cap ?? 15, target.startingCount - target.count);
  if (repairedCount <= 0) return;
  target.count += repairedCount;
  target.hpPool += repairedCount * target.lifePerUnit;
  events.push({
    ...createAbilityEvent(sequence.value++, reanimator, 'reanimator', chance, draw, target, `Восстановлено ${repairedCount} кораблей; лимит за фазу ${effect?.cap ?? 15}.`),
    repairedCount,
    repairLimit: effect?.cap ?? 15,
    lifeBefore: target.hpPool - repairedCount * target.lifePerUnit,
    lifeAfter: target.hpPool,
  });
}

function resolveSideActions(
  actorStacks: readonly RuntimeStack[],
  targetStacks: readonly RuntimeStack[],
  events: CombatEvent[],
  sequence: { value: number },
  targetPriority: CombatTargetPriority,
  activeCommanderId: CommanderId | null,
  opposingCommanderId: CommanderId | null,
  rng: CombatRng,
  paralyzedActorsNext: Set<CombatEntityId>,
  paralyzedTargetsNext: Set<CombatEntityId>,
) {
  const criticalEffect = getCommanderCombatEffect(activeCommanderId);
  const criticalBonus = criticalEffect?.kind === 'critical'
    ? criticalEffect.ratePerLevel * (commanderFor(actorStacks, activeCommanderId)?.level ?? 0)
    : 0;
  const opposingPhantom = commanderAtSide(targetStacks, opposingCommanderId, 'phantom');
  const phantomEffect = opposingPhantom ? getCommanderCombatEffect('phantom') : null;

  for (const actor of sortRuntime(actorStacks)) {
    if (actor.count <= 0) {
      events.push(createSkippedActionEvent(sequence.value++, actor));
      continue;
    }
    if (paralyzedActorsNext.has(actor.entityId)) {
      paralyzedActorsNext.delete(actor.entityId);
      events.push(createSkippedActionEvent(sequence.value++, actor, 'Атака пропущена: командир Скорпион парализовал ближайшее действие.', 'scorpion'));
      continue;
    }
    if (phantomEffect && opposingPhantom) {
      const chance = phantomEffect.ratePerLevel * opposingPhantom.level;
      const draw = rng.next();
      if (draw < chance) {
        events.push(createAbilityEvent(sequence.value++, opposingPhantom, 'phantom', chance, draw, actor, 'Атака цели отменена способностью Фантом.'));
        events.push(createSkippedActionEvent(sequence.value++, actor, 'Атака отменена способностью Фантом.', 'phantom'));
        continue;
      }
    }
    if (actor.attackPerUnit <= 0) {
      events.push(createNoAttackEvent(sequence.value++, actor));
      continue;
    }
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
    events.push(createAttackEvent(sequence.value++, actor, targetRuntime, rng, criticalBonus));
    const scorpion = commanderAtSide(actorStacks, activeCommanderId, 'scorpion');
    if (scorpion) {
      const effect = getCommanderCombatEffect('scorpion');
      const chance = effect ? effect.ratePerLevel * scorpion.level : 0;
      const draw = rng.next();
      if (targetRuntime.count > 0 && draw < chance) {
        paralyzedTargetsNext.add(targetRuntime.entityId);
        events.push(createAbilityEvent(sequence.value++, scorpion, 'scorpion', chance, draw, targetRuntime, 'Цель пропустит ближайшую атаку в своей фазе.'));
      }
    }
  }
}

function activeCommanderLevel(stacks: readonly CombatStackInput[], id: CommanderId | null) {
  return id ? stacks.find((stack) => stack.entityId === id && stack.count > 0)?.level : undefined;
}

function chooseActiveCommander(
  requested: CommanderId | null | undefined,
  _priority: CommanderId[],
  available: readonly CommanderId[],
) {
  if (requested && available.includes(requested)) return requested;
  return available[0] ?? null;
}

function createInitialSnapshot(
  stacks: readonly RuntimeStack[],
  modifiers: Readonly<Record<string, number | string>>,
): CombatRoundSnapshot {
  const counts = new Map(sortRuntime(stacks).map((stack) => [stack.entityId, stack.count]));
  const hitPoints = new Map(sortRuntime(stacks).map((stack) => [stack.entityId, stack.hpPool]));
  return createRoundSnapshot(stacks, counts, hitPoints, modifiers);
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
  const attackerFactionId = normalized.attacker.factionId ?? getCombatFactionId(normalized.attacker.participant.race);
  const defenderFactionId = normalized.defender.factionId ?? getCombatFactionId(normalized.defender.participant.race);

  const attacker = [
    ...runtimeFromInput('attacker', 'stacks', normalized.attacker.ships, attackerTechnologies, executionMode, attackerFactionId),
    ...runtimeFromInput('attacker', 'stacks', getSideCommanders(normalized.attacker), attackerTechnologies, executionMode, attackerFactionId),
  ];
  const defender = [
    ...runtimeFromInput('defender', 'stacks', normalized.defender.ships, defenderTechnologies, executionMode, defenderFactionId),
    ...runtimeFromInput('defender', 'stacks', getSideCommanders(normalized.defender), defenderTechnologies, executionMode, defenderFactionId),
    ...runtimeFromInput('defender', 'defenses', normalized.defender.defenses ?? [], defenderTechnologies, executionMode, defenderFactionId),
  ];

  const attackerCommanderIds = getSideCommanders(normalized.attacker)
    .filter((stack) => stack.count > 0)
    .map((stack) => stack.entityId as CommanderId);
  const defenderCommanderIds = getSideCommanders(normalized.defender)
    .filter((stack) => stack.count > 0)
    .map((stack) => stack.entityId as CommanderId);
  const activeAttackerCommander = chooseActiveCommander(normalized.attacker.activeCommanderId, normalized.attackerPriority, attackerCommanderIds);
  const activeDefenderCommander = chooseActiveCommander(normalized.defender.activeCommanderId, normalized.defenderPriority, defenderCommanderIds);

  const initialModifiers = applyRoundModifiers(attacker, defender, activeAttackerCommander, activeDefenderCommander);
  const initialSnapshot: BattleInitialSnapshot = {
    attacker: createInitialSnapshot(attacker, initialModifiers.attacker.snapshot),
    defender: createInitialSnapshot(defender, initialModifiers.defender.snapshot),
  };

  const rounds: CombatRound[] = [];
  let winner: BattleWinner | null = determineWinner(attacker, defender);
  let eventSequence = 1;
  const paralyzedAttackerNext = new Set<CombatEntityId>();
  const paralyzedDefenderNext = new Set<CombatEntityId>();
  let lastModifiers = initialModifiers;

  for (let roundIndex = 1; roundIndex <= normalized.maxRounds && !winner; roundIndex += 1) {
    lastModifiers = applyRoundModifiers(attacker, defender, activeAttackerCommander, activeDefenderCommander);
    const attackerStartCounts = new Map(sortRuntime(attacker).map((stack) => [stack.entityId, stack.count]));
    const defenderStartCounts = new Map(sortRuntime(defender).map((stack) => [stack.entityId, stack.count]));
    const attackerStartHp = new Map(sortRuntime(attacker).map((stack) => [stack.entityId, stack.hpPool]));
    const defenderStartHp = new Map(sortRuntime(defender).map((stack) => [stack.entityId, stack.hpPool]));
    const events: CombatEvent[] = [];
    const sequence = { value: eventSequence };

    appendSpecialBonusEvents(events, sequence, lastModifiers.attacker);
    appendSpecialBonusEvents(events, sequence, lastModifiers.defender);

    resolveSideActions(
      attacker,
      defender,
      events,
      sequence,
      attackerTargetPriority,
      activeAttackerCommander,
      activeDefenderCommander,
      rng,
      paralyzedAttackerNext,
      paralyzedDefenderNext,
    );
    resolveReanimator(attacker, activeAttackerCommander, events, sequence, rng);
    winner = determineWinner(attacker, defender);
    if (!winner) {
      resolveSideActions(
        defender,
        attacker,
        events,
        sequence,
        defenderTargetPriority,
        activeDefenderCommander,
        activeAttackerCommander,
        rng,
        paralyzedDefenderNext,
        paralyzedAttackerNext,
      );
      resolveReanimator(defender, activeDefenderCommander, events, sequence, rng);
    }
    winner = determineWinner(attacker, defender);
    eventSequence = sequence.value;

    rounds.push({
      index: roundIndex,
      events,
      summary: createRoundSummary(events, attacker, defender),
      attackerSnapshot: createRoundSnapshot(attacker, attackerStartCounts, attackerStartHp, lastModifiers.attacker.snapshot),
      defenderSnapshot: createRoundSnapshot(defender, defenderStartCounts, defenderStartHp, lastModifiers.defender.snapshot),
    });
  }

  if (!winner) winner = 'draw';
  const attackerTechSnapshots = technologySnapshots(attackerTechnologies);
  const defenderTechSnapshots = technologySnapshots(defenderTechnologies);
  const unknowns = COMBAT_TECHNOLOGIES
    .filter((technology) => technology.effectStatus === 'unknown')
    .map((technology) => `${technology.name}: эффект не калиброван и не активирован.`)
    .concat([
      'Дополнительные спецэффекты обычных корпусов не калиброваны и не активированы.',
      'Игнорирование брони у оборонных установок не калибровано и не активировано.',
    ]);

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
    initialSnapshot,
    attackerForce: createForceSnapshot(
      attacker,
      activeAttackerCommander,
      activeCommanderLevel(getSideCommanders(normalized.attacker), activeAttackerCommander),
      attackerTechnologies,
      attackerTechSnapshots,
      lastModifiers.attacker.snapshot,
    ),
    defenderForce: createForceSnapshot(
      defender,
      activeDefenderCommander,
      activeCommanderLevel(getSideCommanders(normalized.defender), activeDefenderCommander),
      defenderTechnologies,
      defenderTechSnapshots,
      lastModifiers.defender.snapshot,
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
        criticalHit: { status: 'inferred', source: 'ASTERION_FULL_BATTLE_IMPLEMENTATION_PROMPT.md §4.3/§4.5', confidence: 'high', note: 'Asterion decision: 1% per science level and +0.075% per Viper level; successful crit doubles the pre-armour volley.' },
      },
      unknowns,
    },
  };
}

export function combatInputPopulation(input: CombatInput) {
  const attackerFactionId = input.attacker.factionId ?? getCombatFactionId(input.attacker.participant.race);
  const defenderFactionId = input.defender.factionId ?? getCombatFactionId(input.defender.participant.race);
  return {
    attacker: calculateStacksPopulation([...input.attacker.ships, ...getSideCommanders(input.attacker)], attackerFactionId),
    defenderFleet: calculateStacksPopulation([...input.defender.ships, ...getSideCommanders(input.defender)], defenderFactionId),
    defenderDefense: calculateStacksPopulation(input.defender.defenses ?? [], defenderFactionId),
  };
}
