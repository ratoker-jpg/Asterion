import {
  COMMANDER_COMBAT_CATALOG,
  COMBAT_ENTITY_BY_ID,
  DEFENSE_COMBAT_CATALOG,
  SHIP_COMBAT_CATALOG,
  type CatalogEntity,
} from './catalog.ts';
import { COMMANDER_ABILITIES, isCommanderId, type CommanderId } from './commanders.ts';
import { calculateBattlePoints, type BattlePointResult } from './battle-points.ts';
import { getFactionDefenseCatalog, getFactionShipCatalog } from './faction-catalog.ts';
import { getCombatFactionId, type CombatFactionId } from './factions.ts';
import type { CombatEntityId } from './ids.ts';
import {
  calculatePopulationLoss,
  type BattleMissionType,
  type BattleSide,
  type BattleSiegeBlockedReason,
  type BattleWinner,
  type CombatActionType,
  type CombatProvenance,
  type RngProvenance,
} from './report.ts';
import { COMBAT_TECHNOLOGIES, getCombatTechnologyDefinition, normalizeCombatTechnologies, type CombatTechnologyId } from './technologies.ts';

export const BATTLE_MISSING_DATA = 'Нет данных' as const;

export type BattleEntityKind = 'ship' | 'commander' | 'defense' | 'unknown';
export type BattleAssetSource = 'catalog' | 'fallback';

export type BattleParticipantViewModel = {
  playerId: string | null;
  playerName: string;
  planetName: string | null;
  coordinates: string | null;
  race: string | null;
  side: BattleSide;
};

export type BattleTooltipViewModel = {
  name: string;
  type: string;
  level: number | null;
  attack: number | null;
  attackPerUnit: number | null;
  totalAttack: number | null;
  life: number | null;
  lifePerUnit: number | null;
  hpPool: number | null;
  armor: number | null;
  count: number | null;
};

export type BattleStackViewModel = {
  key: string;
  entityId: string;
  kind: BattleEntityKind;
  name: string;
  role: string;
  category: string;
  art: string;
  assetSource: BattleAssetSource;
  countBefore: number | null;
  countAfter: number | null;
  destroyed: number | null;
  populationPerUnit: number | null;
  attackPerUnit: number | null;
  totalAttack: number | null;
  lifePerUnit: number | null;
  hpPool: number | null;
  tooltip: BattleTooltipViewModel;
};

export type BattleEventViewModel = {
  sequence: number;
  actorSide: BattleSide;
  actor: BattleStackViewModel;
  targetSide: BattleSide;
  targetEntityId: string | null;
  target: BattleStackViewModel;
  actionType: CombatActionType;
  actorCount: number | null;
  targetCount: number | null;
  attackValue: number | null;
  baseAttack: number | null;
  attackPerUnit: number | null;
  totalAttack: number | null;
  lifePerUnit: number | null;
  hpPool: number | null;
  rawDamage: number | null;
  rawDamageBeforeArmor: number | null;
  matchupMultiplier: number | null;
  reportedBonus: number | null;
  matchupStatus: 'inferred' | 'not-calibrated' | null;
  criticalChance: number | null;
  criticalMultiplier: number | null;
  abilityChance: number | null;
  abilityDraw: number | null;
  effectiveDamage: number | null;
  mitigation: number | null;
  weaponType: string | null;
  armorType: string | null;
  damage: number | null;
  destroyedCount: number | null;
  repairedCount: number | null;
  repairLimit: number | null;
  commanderAbilityId: CommanderId | null;
  commanderAbility: string | null;
  specialBonusKind: 'attack' | 'life' | 'armor' | null;
  specialBonusRate: number | null;
  specialBonusCap: number | null;
  specialBonusCapStatus: 'known' | 'unknown' | null;
  specialBonusLivingCount: number | null;
  specialBonusAmount: number | null;
  specialBonusScope: 'fleet' | 'asterion' | null;
  note: string | null;
  shieldBefore: number | null;
  shieldAfter: number | null;
  armorBefore: number | null;
  armorAfter: number | null;
  lifeBefore: number | null;
  lifeAfter: number | null;
  provenance: CombatProvenance | null;
};

export type BattleRoundSnapshotViewModel = {
  stacks: BattleStackViewModel[];
  defenses: BattleStackViewModel[];
  fleetPopulationBefore: number | null;
  fleetPopulationAfter: number | null;
  defensePopulationBefore: number | null;
  defensePopulationAfter: number | null;
  modifiers: BattleModifierViewModel[];
};

export type BattleRoundSummaryViewModel = {
  attackerDamage: number | null;
  defenderDamage: number | null;
  destroyedUnits: number | null;
  destroyedPopulation: number | null;
  procs: number | null;
  criticalHits: number | null;
  paralyzes: number | null;
  cancelledAttacks: number | null;
  repairs: number | null;
  survivingPopulation: { attacker: number | null; defender: number | null };
  survivingDefensePopulation: number | null;
};

export type BattleRoundViewModel = {
  index: number;
  events: BattleEventViewModel[];
  analysis: string[];
  attackerSnapshot: BattleRoundSnapshotViewModel | null;
  defenderSnapshot: BattleRoundSnapshotViewModel | null;
  summary: BattleRoundSummaryViewModel | null;
  fleetRows: number;
};

export type BattleLossesViewModel = {
  population: number | null;
  ships: number | null;
  defenses: number | null;
};

export type BattleModifierViewModel = {
  key: string;
  label: string;
  value: string;
};

export type BattleUnitGroupViewModel = {
  countBefore: number | null;
  countAfter: number | null;
  populationBefore: number | null;
  populationAfter: number | null;
};

export type BattleTechnologyViewModel = {
  id: CombatTechnologyId;
  name: string;
  level: number;
  maxLevel: number;
  bonusPercent: number;
  effect: string;
  status: CombatProvenance['status'];
};

export type BattleSideViewModel = {
  participant: BattleParticipantViewModel;
  factionId: CombatFactionId;
  populationBefore: number | null;
  populationAfter: number | null;
  losses: BattleLossesViewModel;
  stacks: BattleStackViewModel[];
  ships: BattleStackViewModel[];
  commanders: BattleStackViewModel[];
  defenses: BattleStackViewModel[];
  fleet: BattleUnitGroupViewModel;
  defense: BattleUnitGroupViewModel;
  remainingShips: number | null;
  remainingDefenses: number | null;
  activeCommander: BattleStackViewModel | null;
  modifiers: BattleModifierViewModel[];
  technologies: BattleTechnologyViewModel[];
};

export type BattleResourceViewModel = {
  kind: 'metal' | 'minerals' | 'gas';
  label: string;
  value: number;
};

export type BattleSiegeDestroyerViewModel = {
  factionId: string | null;
  survivors: number;
  level: number;
  scaledDemolitionPoints: number;
  scaledDestructionChanceBps: number;
  baseAttack: number;
  baseLife: number;
};

export type BattleSiegeBuildingRollViewModel = {
  buildingId: string;
  buildingName: string;
  beforeLevel: number;
  afterLevel: number;
  chanceBps: number;
  roll: number;
  success: boolean;
  canceledQueueItems: number;
};

export type BattleSiegeViewModel = {
  targetPlanetId: string | null;
  targetCoordinate: string | null;
  attackerDestroyers: BattleSiegeDestroyerViewModel[];
  defenderDestroyers: BattleSiegeDestroyerViewModel[];
  demolition: {
    status: 'resolved' | 'blocked';
    blockedReason: BattleSiegeBlockedReason | null;
    rawPoints: number;
    defenseReductionPoints: number;
    finalPoints: number;
    baseChanceBps: number;
    annihilatorBonusBps: number;
    eligibleBuildingCount: number;
    selectedBuildingCount: number;
    destroyedBuildingLevels: number;
    rolls: BattleSiegeBuildingRollViewModel[];
  };
  destruction: {
    status: 'destroyed' | 'not-destroyed' | 'blocked';
    blockedReason: BattleSiegeBlockedReason | null;
    rawChanceBps: number;
    defenseReductionBps: number;
    defenderDestroyerReductionBps: number;
    poliasReductionBps: number;
    finalChanceBps: number;
    roll: number | null;
    success: boolean;
    ownerPlanetCount: number;
  };
  planetDestroyed: boolean;
};

export type BattleReportViewModel = {
  id: string;
  timestamp: string;
  missionType: BattleMissionType;
  attacker: BattleSideViewModel;
  defender: BattleSideViewModel;
  winner: BattleWinner;
  schemaVersion: number | null;
  engineVersion: string | null;
  profileId: string | null;
  executionMode: 'production' | 'calibration' | null;
  technologyMode: 'independent' | 'shared' | null;
  targetPriority: { attacker: string | null; defender: string | null };
  rngProvenance: RngProvenance;
  unknowns: string[];
  initialSnapshot: { attacker: BattleRoundSnapshotViewModel; defender: BattleRoundSnapshotViewModel } | null;
  roundCount: number;
  rounds: BattleRoundViewModel[];
  experience: number | null;
  debris: number | null;
  /** Debris remains in target orbit; `debris` is retained as a compatibility alias. */
  debrisOnOrbit: number | null;
  resources: BattleResourceViewModel[];
  siege: BattleSiegeViewModel | null;
  battlePoints: BattlePointResult;
  timestampAvailable: boolean;
};

type RecordValue = Record<string, unknown>;

const MISSION_TYPES: readonly BattleMissionType[] = ['attack', 'raid', 'defense', 'arena', 'simulation'];
const ACTION_TYPES: readonly BattleEventViewModel['actionType'][] = ['attack', 'ability', 'shield', 'status', 'destroyed', 'special-bonus'];

function asRecord(value: unknown): RecordValue {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as RecordValue : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function readNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function readCount(value: unknown): number | null {
  const number = readNumber(value);
  return number == null ? null : Math.max(0, Math.floor(number));
}

function readMissionType(value: unknown): BattleMissionType {
  return typeof value === 'string' && MISSION_TYPES.includes(value as BattleMissionType)
    ? value as BattleMissionType
    : 'simulation';
}

function readSide(value: unknown, fallback: BattleSide): BattleSide {
  return value === 'attacker' || value === 'defender' ? value : fallback;
}

function readWinner(value: unknown): BattleWinner {
  return value === 'attacker' || value === 'defender' || value === 'draw' ? value : 'draw';
}

function readActionType(value: unknown): BattleEventViewModel['actionType'] {
  return typeof value === 'string' && ACTION_TYPES.includes(value as BattleEventViewModel['actionType'])
    ? value as BattleEventViewModel['actionType']
    : 'status';
}

function kindLabel(kind: BattleEntityKind) {
  if (kind === 'ship') return 'Корабль';
  if (kind === 'commander') return 'Командирский корабль';
  if (kind === 'defense') return 'Оборонное сооружение';
  return BATTLE_MISSING_DATA;
}

function fallbackEntity(kind: BattleEntityKind): CatalogEntity {
  if (kind === 'defense') return DEFENSE_COMBAT_CATALOG[0];
  if (kind === 'commander') return COMMANDER_COMBAT_CATALOG[0];
  return SHIP_COMBAT_CATALOG[6] ?? SHIP_COMBAT_CATALOG[0];
}

function entityKindFromCatalog(factionId: CombatFactionId, entityId: string, fallback: BattleEntityKind = 'unknown') {
  const factionEntity = [
    ...SHIP_COMBAT_CATALOG,
    ...COMMANDER_COMBAT_CATALOG,
    ...DEFENSE_COMBAT_CATALOG,
  ].find((entity) => entity.id === entityId);
  if (factionEntity) return factionEntity.kind;

  const generic = COMBAT_ENTITY_BY_ID.get(entityId as CombatEntityId);
  if (generic) return generic.kind;

  // Keep the faction argument in this resolver so future faction-specific catalogs
  // can be added without changing the adapter contract.
  void factionId;
  return fallback;
}

function findEntity(factionId: CombatFactionId, entityId: string, kind: BattleEntityKind) {
  const factionEntities = kind === 'ship'
    ? getFactionEntities(factionId, 'ship')
    : kind === 'defense'
      ? getFactionEntities(factionId, 'defense')
      : COMMANDER_COMBAT_CATALOG;
  const factionEntity = factionEntities.find((entity) => entity.id === entityId);
  if (factionEntity) return factionEntity;

  const generic = COMBAT_ENTITY_BY_ID.get(entityId as CombatEntityId);
  return generic?.kind === kind ? generic : null;
}

function getFactionEntities(factionId: CombatFactionId, kind: 'ship' | 'defense') {
  return kind === 'ship' ? getFactionShipCatalog(factionId) : getFactionDefenseCatalog(factionId);
}

function resolveEntity(factionId: CombatFactionId, entityId: string, kindHint: BattleEntityKind) {
  const kind = kindHint === 'unknown' ? entityKindFromCatalog(factionId, entityId) : kindHint;
  const entity = findEntity(factionId, entityId, kind);
  if (entity) {
    return {
      kind,
      name: entity.name,
      role: entity.role,
      category: entity.category,
      art: entity.art,
      assetSource: 'catalog' as const,
      entity,
    };
  }

  const fallback = fallbackEntity(kind);
  return {
    kind,
    name: BATTLE_MISSING_DATA,
    role: BATTLE_MISSING_DATA,
    category: kindLabel(kind),
    art: fallback.art,
    assetSource: 'fallback' as const,
    entity: null,
  };
}

function readParticipant(value: unknown, side: BattleSide): BattleParticipantViewModel {
  const record = asRecord(value);
  return {
    playerId: readString(record.playerId),
    playerName: readString(record.playerName) ?? BATTLE_MISSING_DATA,
    planetName: readString(record.planetName),
    coordinates: readString(record.coordinates),
    race: readString(record.race),
    side,
  };
}

function modifierLabel(key: string) {
  return {
    formation: 'Построение',
    commanderSnapshot: 'Командирский snapshot',
  }[key] ?? key.replace(/([A-Z])/g, ' $1').replace(/^./, (letter) => letter.toUpperCase());
}

function readModifiers(value: unknown): BattleModifierViewModel[] {
  return Object.entries(asRecord(value)).flatMap(([key, rawValue]) => {
    if (typeof rawValue === 'string' && rawValue.trim()) return [{ key, label: modifierLabel(key), value: rawValue.trim() }];
    const number = readNumber(rawValue);
    return number == null ? [] : [{ key, label: modifierLabel(key), value: new Intl.NumberFormat('ru-RU').format(number) }];
  });
}

function readTechnologies(value: unknown): BattleTechnologyViewModel[] {
  const record = asRecord(value);
  const hasSnapshot = COMBAT_TECHNOLOGIES.some(({ id }) => Object.prototype.hasOwnProperty.call(record, id))
    || ['shipDefense', 'forceAttack', 'promptDefense'].some((id) => Object.prototype.hasOwnProperty.call(record, id));
  if (!hasSnapshot) return [];
  const levels = normalizeCombatTechnologies(record);
  return COMBAT_TECHNOLOGIES.map((technology) => {
    const definition = getCombatTechnologyDefinition(technology.id);
    return {
      id: technology.id,
      name: technology.name,
      level: levels[technology.id],
      maxLevel: definition.maxLevel,
      bonusPercent: levels[technology.id] * technology.displayBonusPercentPerLevel,
      effect: definition.effect,
      status: definition.effectStatus,
    };
  });
}

function readStack(
  value: unknown,
  index: number,
  factionId: CombatFactionId,
  kindHint: BattleEntityKind,
): BattleStackViewModel {
  const record = asRecord(value);
  const entityId = readString(record.entityId) ?? `unknown-${kindHint}-${index}`;
  const resolved = resolveEntity(factionId, entityId, kindHint);
  const countBefore = readCount(record.countBefore);
  const countAfter = readCount(record.countAfter);
  const destroyed = readCount(record.destroyed) ?? (
    countBefore != null && countAfter != null
      ? Math.max(0, countBefore - countAfter)
      : null
  );
  const catalog = resolved.entity;
  const attackPerUnit = readNumber(record.attackPerUnit);
  const totalAttack = readNumber(record.totalAttack);
  const lifePerUnit = readNumber(record.lifePerUnit);
  const hpPool = readNumber(record.hpPool) ?? readNumber(record.lifeAfter) ?? readNumber(record.life);
  const tooltip = {
    name: resolved.name,
    type: resolved.category,
    level: readCount(record.level),
    attack: totalAttack,
    attackPerUnit,
    totalAttack,
    life: hpPool,
    lifePerUnit,
    hpPool,
    armor: readNumber(record.armor),
    count: countAfter,
  } satisfies BattleTooltipViewModel;

  return {
    key: `${kindHint}:${entityId}:${index}`,
    entityId,
    kind: resolved.kind,
    name: resolved.name,
    role: resolved.role,
    category: resolved.category,
    art: resolved.art,
    assetSource: resolved.assetSource,
    countBefore,
    countAfter,
    destroyed,
    populationPerUnit: catalog?.population ?? null,
    attackPerUnit,
    totalAttack,
    lifePerUnit,
    hpPool,
    tooltip,
  };
}

function readStacks(value: unknown, factionId: CombatFactionId, fallbackKind: BattleEntityKind) {
  return asArray(value).map((item, index) => {
    const entityId = readString(asRecord(item).entityId) ?? '';
    const kind = entityKindFromCatalog(factionId, entityId, fallbackKind);
    return readStack(item, index, factionId, kind);
  });
}

function splitStacks(stacks: BattleStackViewModel[]) {
  return {
    ships: stacks.filter((stack) => stack.kind === 'ship' || stack.kind === 'unknown'),
    commanders: stacks.filter((stack) => stack.kind === 'commander'),
  };
}

function sumDestroyed(stacks: readonly BattleStackViewModel[]) {
  if (!stacks.length) return null;
  const values = stacks.map((stack) => stack.destroyed).filter((value): value is number => value != null);
  return values.length === stacks.length ? values.reduce((total, value) => total + value, 0) : null;
}

function sumMetric(
  stacks: readonly BattleStackViewModel[],
  readValue: (stack: BattleStackViewModel) => number | null,
) {
  if (!stacks.length) return null;
  const values = stacks.map(readValue);
  return values.every((value): value is number => value != null)
    ? values.reduce((total, value) => total + value, 0)
    : null;
}

function summarizeStacks(stacks: readonly BattleStackViewModel[]): BattleUnitGroupViewModel {
  return {
    countBefore: sumMetric(stacks, (stack) => stack.countBefore),
    countAfter: sumMetric(stacks, (stack) => stack.countAfter),
    populationBefore: sumMetric(stacks, (stack) => stack.countBefore == null || stack.populationPerUnit == null ? null : stack.countBefore * stack.populationPerUnit),
    populationAfter: sumMetric(stacks, (stack) => stack.countAfter == null || stack.populationPerUnit == null ? null : stack.countAfter * stack.populationPerUnit),
  };
}

function readForce(value: unknown, participant: BattleParticipantViewModel, factionId: CombatFactionId): BattleSideViewModel {
  const record = asRecord(value);
  const stacks = readStacks(record.stacks, factionId, 'ship');
  const defenses = readStacks(record.defenses, factionId, 'defense').map((stack) => ({ ...stack, kind: 'defense' as const }));
  const split = splitStacks(stacks);
  const activeCommanderId = readString(record.activeCommanderId);
  const activeCommander = activeCommanderId && isCommanderId(activeCommanderId)
    ? split.commanders.find((stack) => stack.entityId === activeCommanderId) ?? readStack({ entityId: activeCommanderId, countAfter: 1 }, 0, factionId, 'commander')
    : null;
  const populationBefore = readCount(record.populationBefore);
  const populationAfter = readCount(record.populationAfter);
  const fleet = summarizeStacks([...split.ships, ...split.commanders]);
  const defense = summarizeStacks(defenses);

  return {
    participant,
    factionId,
    populationBefore,
    populationAfter,
    losses: {
      population: populationBefore != null && populationAfter != null
        ? calculatePopulationLoss(populationBefore, populationAfter)
        : null,
      ships: sumDestroyed(split.ships) == null && sumDestroyed(split.commanders) == null
        ? null
        : (sumDestroyed(split.ships) ?? 0) + (sumDestroyed(split.commanders) ?? 0),
      defenses: sumDestroyed(defenses),
    },
    stacks,
    ships: split.ships,
    commanders: split.commanders,
    defenses,
    fleet,
    defense,
    remainingShips: fleet.countAfter,
    remainingDefenses: defense.countAfter,
    activeCommander,
    modifiers: readModifiers(record.modifiers),
    technologies: readTechnologies(record.technologies ?? record.technologyLevels),
  };
}

function readEvent(value: unknown, index: number, attackerFactionId: CombatFactionId, defenderFactionId: CombatFactionId): BattleEventViewModel {
  const record = asRecord(value);
  const actorSide = readSide(record.actorSide, 'attacker');
  const targetSide = readSide(record.targetSide, actorSide === 'attacker' ? 'defender' : 'attacker');
  const actorEntityId = readString(record.actorEntityId) ?? `unknown-actor-${index}`;
  const targetEntityId = readString(record.targetEntityId);
  const actorFactionId = actorSide === 'attacker' ? attackerFactionId : defenderFactionId;
  const targetFactionId = targetSide === 'attacker' ? attackerFactionId : defenderFactionId;
  const actorKind = entityKindFromCatalog(actorFactionId, actorEntityId, 'unknown');
  const targetKind = entityKindFromCatalog(targetFactionId, targetEntityId ?? `unknown-target-${index}`, 'unknown');

  const actor = readStack({ entityId: actorEntityId, countAfter: readCount(record.actorCount) }, index, actorFactionId, actorKind);
  const target = readStack({ entityId: targetEntityId ?? `unknown-target-${index}`, countAfter: readCount(record.targetCount) }, index, targetFactionId, targetKind);
  const commanderAbilityId = readString(record.commanderAbilityId);
  const safeCommanderAbilityId = commanderAbilityId && isCommanderId(commanderAbilityId) ? commanderAbilityId : null;

  return {
    sequence: readCount(record.sequence) ?? index + 1,
    actorSide,
    actor,
    targetSide,
    targetEntityId,
    target,
    actionType: readActionType(record.actionType),
    actorCount: readCount(record.actorCount),
    targetCount: readCount(record.targetCount),
    attackValue: readNumber(record.attackValue),
    baseAttack: readNumber(record.baseAttack),
    attackPerUnit: readNumber(record.attackPerUnit),
    totalAttack: readNumber(record.totalAttack),
    lifePerUnit: readNumber(record.lifePerUnit),
    hpPool: readNumber(record.hpPool),
    rawDamage: readNumber(record.rawDamage),
    rawDamageBeforeArmor: readNumber(record.rawDamageBeforeArmor),
    matchupMultiplier: readNumber(record.matchupMultiplier),
    reportedBonus: readNumber(record.reportedBonus),
    matchupStatus: record.matchupStatus === 'inferred' || record.matchupStatus === 'not-calibrated' ? record.matchupStatus : null,
    criticalChance: readNumber(record.criticalChance),
    criticalMultiplier: readNumber(record.criticalMultiplier),
    abilityChance: readNumber(record.abilityChance),
    abilityDraw: readNumber(record.abilityDraw),
    effectiveDamage: readNumber(record.effectiveDamage),
    mitigation: readNumber(record.mitigation),
    weaponType: readString(record.weaponType),
    armorType: readString(record.armorType),
    damage: readNumber(record.damage),
    destroyedCount: readCount(record.destroyedCount),
    repairedCount: readCount(record.repairedCount),
    repairLimit: readCount(record.repairLimit),
    commanderAbilityId: safeCommanderAbilityId,
    commanderAbility: safeCommanderAbilityId ? COMMANDER_ABILITIES[safeCommanderAbilityId].ability : null,
    specialBonusKind: record.specialBonusKind === 'attack' || record.specialBonusKind === 'life' || record.specialBonusKind === 'armor'
      ? record.specialBonusKind
      : null,
    specialBonusRate: readNumber(record.specialBonusRate),
    specialBonusCap: readNumber(record.specialBonusCap),
    specialBonusCapStatus: record.specialBonusCapStatus === 'known' || record.specialBonusCapStatus === 'unknown'
      ? record.specialBonusCapStatus
      : null,
    specialBonusLivingCount: readCount(record.specialBonusLivingCount),
    specialBonusAmount: readNumber(record.specialBonusAmount),
    specialBonusScope: record.specialBonusScope === 'fleet' || record.specialBonusScope === 'asterion'
      ? record.specialBonusScope
      : null,
    note: readString(record.note),
    shieldBefore: readNumber(record.shieldBefore),
    shieldAfter: readNumber(record.shieldAfter),
    armorBefore: readNumber(record.armorBefore),
    armorAfter: readNumber(record.armorAfter),
    lifeBefore: readNumber(record.lifeBefore),
    lifeAfter: readNumber(record.lifeAfter),
    provenance: record.provenance && typeof record.provenance === 'object' && !Array.isArray(record.provenance)
      ? record.provenance as CombatProvenance
      : null,
  };
}

function formatAnalysisNumber(value: number) {
  return new Intl.NumberFormat('ru-RU').format(value);
}

function analysisForEvent(event: BattleEventViewModel) {
  const details = [event.actionType === 'special-bonus'
    ? `${event.actor.name} → союзные стеки`
    : `${event.actor.name} → ${event.target.name}`];
  if (event.actionType !== 'attack') details.push(event.actionType.toUpperCase());
  if (event.attackValue != null) details.push(`атака ${formatAnalysisNumber(event.attackValue)}`);
  if (event.damage != null) details.push(`урон ${formatAnalysisNumber(event.damage)}`);
  if (event.destroyedCount != null) details.push(`уничтожено ${formatAnalysisNumber(event.destroyedCount)}`);
  if (event.shieldBefore != null || event.shieldAfter != null) details.push(`щит ${event.shieldBefore == null ? BATTLE_MISSING_DATA : formatAnalysisNumber(event.shieldBefore)} → ${event.shieldAfter == null ? BATTLE_MISSING_DATA : formatAnalysisNumber(event.shieldAfter)}`);
  if (event.armorBefore != null || event.armorAfter != null) details.push(`броня ${event.armorBefore == null ? BATTLE_MISSING_DATA : formatAnalysisNumber(event.armorBefore)} → ${event.armorAfter == null ? BATTLE_MISSING_DATA : formatAnalysisNumber(event.armorAfter)}`);
  if (event.lifeBefore != null || event.lifeAfter != null) details.push(`жизнь ${event.lifeBefore == null ? BATTLE_MISSING_DATA : formatAnalysisNumber(event.lifeBefore)} → ${event.lifeAfter == null ? BATTLE_MISSING_DATA : formatAnalysisNumber(event.lifeAfter)}`);
  if (event.specialBonusAmount != null) {
    const amount = event.specialBonusKind === 'armor'
      ? `${formatAnalysisNumber(event.specialBonusAmount)} п.п.`
      : `${formatAnalysisNumber(event.specialBonusAmount * 100)}%`;
    details.push(`бонус ${amount}`);
  }
  if (event.commanderAbility) details.push(`способность: ${event.commanderAbility}`);
  if (event.note) details.push(event.note);
  return details.join(' · ');
}

function readSnapshot(value: unknown, factionId: CombatFactionId): BattleRoundSnapshotViewModel | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = asRecord(value);
  const stacks = readStacks(record.stacks, factionId, 'ship');
  const defenses = readStacks(record.defenses, factionId, 'defense').map((stack) => ({ ...stack, kind: 'defense' as const }));
  const sumPopulation = (items: readonly BattleStackViewModel[], field: 'countBefore' | 'countAfter') => {
    if (!items.length) return null;
    const populations = items.map((stack) => {
      const count = stack[field];
      return count != null && stack.populationPerUnit != null ? count * stack.populationPerUnit : null;
    });
    return populations.every((population): population is number => population != null)
      ? populations.reduce((total, population) => total + population, 0)
      : null;
  };
  const fleetStacks = stacks.filter((stack) => stack.kind !== 'defense');
  return {
    stacks,
    defenses,
    fleetPopulationBefore: readNumber(record.fleetPopulationBefore) ?? sumPopulation(fleetStacks, 'countBefore'),
    fleetPopulationAfter: readNumber(record.fleetPopulationAfter) ?? sumPopulation(fleetStacks, 'countAfter'),
    defensePopulationBefore: readNumber(record.defensePopulationBefore) ?? sumPopulation(defenses, 'countBefore'),
    defensePopulationAfter: readNumber(record.defensePopulationAfter) ?? sumPopulation(defenses, 'countAfter'),
    modifiers: readModifiers(record.modifiers),
  };
}

function readRoundSummary(value: unknown): BattleRoundSummaryViewModel | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = asRecord(value);
  const surviving = asRecord(record.survivingPopulation);
  return {
    attackerDamage: readNumber(record.attackerDamage),
    defenderDamage: readNumber(record.defenderDamage),
    destroyedUnits: readCount(record.destroyedUnits),
    destroyedPopulation: readNumber(record.destroyedPopulation),
    procs: readCount(record.procs),
    criticalHits: readCount(record.criticalHits),
    paralyzes: readCount(record.paralyzes),
    cancelledAttacks: readCount(record.cancelledAttacks),
    repairs: readCount(record.repairs),
    survivingPopulation: {
      attacker: readNumber(surviving.attacker),
      defender: readNumber(surviving.defender),
    },
    survivingDefensePopulation: readNumber(record.survivingDefensePopulation),
  };
}

function visibleRows(snapshot: BattleRoundSnapshotViewModel | null) {
  if (!snapshot) return 0;
  const regular = snapshot.stacks.filter((stack) => stack.kind !== 'commander' && (stack.countBefore ?? stack.countAfter ?? 0) > 0).length;
  const commanders = snapshot.stacks.filter((stack) => stack.kind === 'commander' && (stack.countBefore ?? stack.countAfter ?? 0) > 0).length;
  return Math.ceil(regular / 5) + (commanders ? 1 : 0);
}

function readRound(value: unknown, index: number, attackerFactionId: CombatFactionId, defenderFactionId: CombatFactionId): BattleRoundViewModel {
  const record = asRecord(value);
  const attackerSnapshot = readSnapshot(record.attackerSnapshot, attackerFactionId);
  const defenderSnapshot = readSnapshot(record.defenderSnapshot, defenderFactionId);
  const events = asArray(record.events).map((event, eventIndex) => readEvent(event, eventIndex, attackerFactionId, defenderFactionId));
  return {
    index: readCount(record.index) ?? index + 1,
    events,
    analysis: events.map(analysisForEvent),
    attackerSnapshot,
    defenderSnapshot,
    summary: readRoundSummary(record.summary),
    fleetRows: Math.max(1, visibleRows(attackerSnapshot), visibleRows(defenderSnapshot)),
  };
}

function readResources(value: unknown) {
  const record = asRecord(value);
  return ([
    ['metal', 'Металл'],
    ['minerals', 'Минералы'],
    ['gas', 'Газ'],
  ] as const)
    .reduce<BattleResourceViewModel[]>((resources, [kind, label]) => {
      const resourceValue = readNumber(record[kind]);
      if (resourceValue != null) resources.push({ kind, label, value: resourceValue });
      return resources;
    }, []);
}

function readRngProvenance(value: unknown): RngProvenance {
  const record = asRecord(value);
  const mode = record.mode === 'seeded' || record.mode === 'recorded-sequence' || record.mode === 'non-replayable'
    ? record.mode
    : 'non-replayable';
  return {
    mode,
    ...(readString(record.algorithmVersion) ? { algorithmVersion: readString(record.algorithmVersion)! } : {}),
    ...(readString(record.seed) ? { seed: readString(record.seed)! } : {}),
    ...(readCount(record.drawCount) != null ? { drawCount: readCount(record.drawCount)! } : {}),
    note: readString(record.note) ?? 'Для этого отчёта нет полной информации о воспроизведении RNG.',
  };
}

function readUnknowns(value: unknown) {
  return asArray(value).filter((item): item is string => typeof item === 'string' && Boolean(item.trim())).map((item) => item.trim());
}

function readSiegeBlockedReason(value: unknown): BattleSiegeBlockedReason | null {
  return value === 'NO_SURVIVING_PLANET_DESTROYER'
    || value === 'BATTLE_RESULT_INELIGIBLE'
    || value === 'LAST_COLONY_PROTECTED'
    || value === 'ZERO_FINAL_CHANCE'
    ? value
    : null;
}

function readSiegeDestroyers(value: unknown): BattleSiegeDestroyerViewModel[] {
  return asArray(value).map((item) => {
    const record = asRecord(item);
    return {
      factionId: readString(record.factionId),
      survivors: readCount(record.survivors) ?? 0,
      level: readCount(record.level) ?? 0,
      scaledDemolitionPoints: readCount(record.scaledDemolitionPoints) ?? 0,
      scaledDestructionChanceBps: readCount(record.scaledDestructionChanceBps) ?? 0,
      baseAttack: readCount(record.baseAttack) ?? 0,
      baseLife: readCount(record.baseLife) ?? 0,
    };
  });
}

function readSiegeBuildingRolls(value: unknown): BattleSiegeBuildingRollViewModel[] {
  return asArray(value).map((item) => {
    const record = asRecord(item);
    return {
      buildingId: readString(record.buildingId) ?? BATTLE_MISSING_DATA,
      buildingName: readString(record.buildingName) ?? readString(record.buildingId) ?? BATTLE_MISSING_DATA,
      beforeLevel: readCount(record.beforeLevel) ?? 0,
      afterLevel: readCount(record.afterLevel) ?? 0,
      chanceBps: readCount(record.chanceBps) ?? 0,
      roll: readNumber(record.roll) ?? 0,
      success: record.success === true,
      canceledQueueItems: readCount(record.canceledQueueItems) ?? 0,
    };
  });
}

function readSiege(value: unknown): BattleSiegeViewModel | null {
  const record = asRecord(value);
  if (!Object.keys(record).length || (!record.demolition && !record.destruction)) return null;
  const demolition = asRecord(record.demolition);
  const destruction = asRecord(record.destruction);
  const planetDestroyed = record.planetDestroyed === true;
  const demolitionStatus = demolition.status === 'blocked' ? 'blocked' : 'resolved';
  const destructionStatus = destruction.status === 'destroyed' || destruction.status === 'blocked' || destruction.status === 'not-destroyed'
    ? destruction.status
    : (planetDestroyed ? 'destroyed' : 'not-destroyed');
  return {
    targetPlanetId: readString(record.targetPlanetId),
    targetCoordinate: readString(record.targetCoordinate),
    attackerDestroyers: readSiegeDestroyers(record.attackerDestroyers),
    defenderDestroyers: readSiegeDestroyers(record.defenderDestroyers),
    demolition: {
      status: demolitionStatus,
      blockedReason: readSiegeBlockedReason(demolition.blockedReason),
      rawPoints: readCount(demolition.rawPoints) ?? 0,
      defenseReductionPoints: readCount(demolition.defenseReductionPoints) ?? 0,
      finalPoints: readCount(demolition.finalPoints) ?? 0,
      baseChanceBps: readCount(demolition.baseChanceBps) ?? 0,
      annihilatorBonusBps: readCount(demolition.annihilatorBonusBps) ?? 0,
      eligibleBuildingCount: readCount(demolition.eligibleBuildingCount) ?? 0,
      selectedBuildingCount: readCount(demolition.selectedBuildingCount) ?? 0,
      destroyedBuildingLevels: readCount(demolition.destroyedBuildingLevels) ?? 0,
      rolls: readSiegeBuildingRolls(demolition.rolls),
    },
    destruction: {
      status: destructionStatus,
      blockedReason: readSiegeBlockedReason(destruction.blockedReason),
      rawChanceBps: readCount(destruction.rawChanceBps) ?? 0,
      defenseReductionBps: readCount(destruction.defenseReductionBps) ?? 0,
      defenderDestroyerReductionBps: readCount(destruction.defenderDestroyerReductionBps) ?? 0,
      poliasReductionBps: readCount(destruction.poliasReductionBps) ?? 0,
      finalChanceBps: readCount(destruction.finalChanceBps) ?? 0,
      roll: readNumber(destruction.roll),
      success: destruction.success === true,
      ownerPlanetCount: readCount(destruction.ownerPlanetCount) ?? 0,
    },
    planetDestroyed,
  };
}

export function createBattleReportViewModel(input: unknown): BattleReportViewModel {
  const record = asRecord(input);
  const metadata = asRecord(record.metadata);
  const attacker = readParticipant(record.attacker, 'attacker');
  const defender = readParticipant(record.defender, 'defender');
  const attackerFactionId = getCombatFactionId(attacker.race);
  const defenderFactionId = getCombatFactionId(defender.race);
  const rounds = asArray(record.rounds)
    .map((round, index) => readRound(round, index, attackerFactionId, defenderFactionId))
    .sort((left, right) => left.index - right.index);
  const attackerViewModel = readForce(record.attackerForce, attacker, attackerFactionId);
  const defenderViewModel = readForce(record.defenderForce, defender, defenderFactionId);
  const winner = readWinner(record.winner);
  const initialRecord = asRecord(record.initialSnapshot);
  const initialAttacker = readSnapshot(initialRecord.attacker, attackerFactionId);
  const initialDefender = readSnapshot(initialRecord.defender, defenderFactionId);
  const initialSnapshot = initialAttacker && initialDefender
    ? { attacker: initialAttacker, defender: initialDefender }
    : null;
  const executionMode = metadata.executionMode === 'production' || metadata.executionMode === 'calibration'
    ? metadata.executionMode
    : null;
  const technologyMode = metadata.technologyMode === 'independent' || metadata.technologyMode === 'shared'
    ? metadata.technologyMode
    : null;
  const targetPriorityRecord = asRecord(metadata.targetPriority);
  const debrisOnOrbit = readNumber(record.debris);
  const siege = readSiege(record.siege);

  return {
    id: readString(record.id) ?? 'invalid-battle-report',
    timestamp: readString(record.timestamp) ?? '',
    missionType: readMissionType(record.missionType),
    attacker: attackerViewModel,
    defender: defenderViewModel,
    winner,
    schemaVersion: readNumber(record.schemaVersion),
    engineVersion: readString(record.engineVersion) ?? readString(metadata.engineVersion),
    profileId: readString(metadata.profileId),
    executionMode,
    technologyMode,
    targetPriority: {
      attacker: readString(targetPriorityRecord.attacker),
      defender: readString(targetPriorityRecord.defender),
    },
    rngProvenance: readRngProvenance(metadata.rngProvenance),
    unknowns: readUnknowns(metadata.unknowns).length
      ? readUnknowns(metadata.unknowns)
      : ['Полная provenance этого отчёта не зафиксирована; новые значения не восстанавливаются выдуманными числами.'],
    initialSnapshot,
    roundCount: readCount(record.roundCount) ?? rounds.length,
    rounds,
    experience: readNumber(record.experience),
    debris: debrisOnOrbit,
    debrisOnOrbit,
    resources: readResources(record.resources),
    siege,
    battlePoints: calculateBattlePoints(
      winner,
      attackerViewModel.stacks,
      defenderViewModel.stacks,
      attackerViewModel.defenses,
      defenderViewModel.defenses,
      attackerFactionId,
      defenderFactionId,
    ),
    timestampAvailable: readString(record.timestamp) != null,
  };
}
