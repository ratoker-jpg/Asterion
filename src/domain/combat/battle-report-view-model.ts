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
import { calculatePopulationLoss, type BattleMissionType, type BattleSide, type BattleWinner } from './report.ts';
import { COMBAT_TECHNOLOGIES, normalizeCombatTechnologies, type CombatTechnologyId } from './technologies.ts';

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
  life: number | null;
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
  tooltip: BattleTooltipViewModel;
};

export type BattleEventViewModel = {
  sequence: number;
  actorSide: BattleSide;
  actor: BattleStackViewModel;
  targetSide: BattleSide;
  target: BattleStackViewModel;
  actionType: 'attack' | 'ability' | 'shield' | 'status' | 'destroyed';
  actorCount: number | null;
  targetCount: number | null;
  attackValue: number | null;
  damage: number | null;
  destroyedCount: number | null;
  commanderAbilityId: CommanderId | null;
  commanderAbility: string | null;
  note: string | null;
  shieldBefore: number | null;
  shieldAfter: number | null;
  armorBefore: number | null;
  armorAfter: number | null;
  lifeBefore: number | null;
  lifeAfter: number | null;
};

export type BattleRoundSnapshotViewModel = {
  stacks: BattleStackViewModel[];
  defenses: BattleStackViewModel[];
};

export type BattleRoundViewModel = {
  index: number;
  events: BattleEventViewModel[];
  analysis: string[];
  attackerSnapshot: BattleRoundSnapshotViewModel | null;
  defenderSnapshot: BattleRoundSnapshotViewModel | null;
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
  bonusPercent: number;
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

export type BattleReportViewModel = {
  id: string;
  timestamp: string;
  missionType: BattleMissionType;
  attacker: BattleSideViewModel;
  defender: BattleSideViewModel;
  winner: BattleWinner;
  roundCount: number;
  rounds: BattleRoundViewModel[];
  experience: number | null;
  debris: number | null;
  resources: BattleResourceViewModel[];
  battlePoints: BattlePointResult;
  timestampAvailable: boolean;
};

type RecordValue = Record<string, unknown>;

const MISSION_TYPES: readonly BattleMissionType[] = ['attack', 'raid', 'defense', 'arena', 'simulation'];
const ACTION_TYPES: readonly BattleEventViewModel['actionType'][] = ['attack', 'ability', 'shield', 'status', 'destroyed'];

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
  return COMBAT_TECHNOLOGIES.map((technology) => ({
    id: technology.id,
    name: technology.name,
    level: levels[technology.id],
    bonusPercent: levels[technology.id] * technology.displayBonusPercentPerLevel,
  }));
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
  const catalog = resolved.entity;
  const tooltip = {
    name: resolved.name,
    type: resolved.category,
    level: readCount(record.level),
    attack: catalog?.combat.attack ?? null,
    life: readNumber(record.life) ?? catalog?.combat.life ?? null,
    armor: readNumber(record.armor) ?? catalog?.combat.armorStrength ?? null,
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
    destroyed: readCount(record.destroyed),
    populationPerUnit: catalog?.population ?? null,
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
    technologies: readTechnologies(record.technologies),
  };
}

function readEvent(value: unknown, index: number, attackerFactionId: CombatFactionId, defenderFactionId: CombatFactionId): BattleEventViewModel {
  const record = asRecord(value);
  const actorSide = readSide(record.actorSide, 'attacker');
  const targetSide = readSide(record.targetSide, actorSide === 'attacker' ? 'defender' : 'attacker');
  const actorEntityId = readString(record.actorEntityId) ?? `unknown-actor-${index}`;
  const targetEntityId = readString(record.targetEntityId) ?? `unknown-target-${index}`;
  const actorFactionId = actorSide === 'attacker' ? attackerFactionId : defenderFactionId;
  const targetFactionId = targetSide === 'attacker' ? attackerFactionId : defenderFactionId;
  const actorKind = entityKindFromCatalog(actorFactionId, actorEntityId, 'unknown');
  const targetKind = entityKindFromCatalog(targetFactionId, targetEntityId, 'unknown');

  const actor = readStack({ entityId: actorEntityId, countAfter: readCount(record.actorCount) }, index, actorFactionId, actorKind);
  const target = readStack({ entityId: targetEntityId, countAfter: readCount(record.targetCount) }, index, targetFactionId, targetKind);
  const commanderAbilityId = readString(record.commanderAbilityId);
  const safeCommanderAbilityId = commanderAbilityId && isCommanderId(commanderAbilityId) ? commanderAbilityId : null;

  return {
    sequence: readCount(record.sequence) ?? index + 1,
    actorSide,
    actor,
    targetSide,
    target,
    actionType: readActionType(record.actionType),
    actorCount: readCount(record.actorCount),
    targetCount: readCount(record.targetCount),
    attackValue: readNumber(record.attackValue),
    damage: readNumber(record.damage),
    destroyedCount: readCount(record.destroyedCount),
    commanderAbilityId: safeCommanderAbilityId,
    commanderAbility: safeCommanderAbilityId ? COMMANDER_ABILITIES[safeCommanderAbilityId].ability : null,
    note: readString(record.note),
    shieldBefore: readNumber(record.shieldBefore),
    shieldAfter: readNumber(record.shieldAfter),
    armorBefore: readNumber(record.armorBefore),
    armorAfter: readNumber(record.armorAfter),
    lifeBefore: readNumber(record.lifeBefore),
    lifeAfter: readNumber(record.lifeAfter),
  };
}

function formatAnalysisNumber(value: number) {
  return new Intl.NumberFormat('ru-RU').format(value);
}

function analysisForEvent(event: BattleEventViewModel) {
  const details = [`${event.actor.name} → ${event.target.name}`];
  if (event.actionType !== 'attack') details.push(event.actionType.toUpperCase());
  if (event.attackValue != null) details.push(`атака ${formatAnalysisNumber(event.attackValue)}`);
  if (event.damage != null) details.push(`урон ${formatAnalysisNumber(event.damage)}`);
  if (event.destroyedCount != null) details.push(`уничтожено ${formatAnalysisNumber(event.destroyedCount)}`);
  if (event.shieldBefore != null || event.shieldAfter != null) details.push(`щит ${event.shieldBefore == null ? BATTLE_MISSING_DATA : formatAnalysisNumber(event.shieldBefore)} → ${event.shieldAfter == null ? BATTLE_MISSING_DATA : formatAnalysisNumber(event.shieldAfter)}`);
  if (event.armorBefore != null || event.armorAfter != null) details.push(`броня ${event.armorBefore == null ? BATTLE_MISSING_DATA : formatAnalysisNumber(event.armorBefore)} → ${event.armorAfter == null ? BATTLE_MISSING_DATA : formatAnalysisNumber(event.armorAfter)}`);
  if (event.lifeBefore != null || event.lifeAfter != null) details.push(`жизнь ${event.lifeBefore == null ? BATTLE_MISSING_DATA : formatAnalysisNumber(event.lifeBefore)} → ${event.lifeAfter == null ? BATTLE_MISSING_DATA : formatAnalysisNumber(event.lifeAfter)}`);
  if (event.commanderAbility) details.push(`способность: ${event.commanderAbility}`);
  if (event.note) details.push(event.note);
  return details.join(' · ');
}

function readSnapshot(value: unknown, factionId: CombatFactionId): BattleRoundSnapshotViewModel | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = asRecord(value);
  return {
    stacks: readStacks(record.stacks, factionId, 'ship'),
    defenses: readStacks(record.defenses, factionId, 'defense').map((stack) => ({ ...stack, kind: 'defense' as const })),
  };
}

function visibleRows(snapshot: BattleRoundSnapshotViewModel | null) {
  if (!snapshot) return 0;
  const regular = snapshot.stacks.filter((stack) => stack.kind !== 'commander' && (stack.countAfter ?? 0) > 0).length;
  const commanders = snapshot.stacks.filter((stack) => stack.kind === 'commander' && (stack.countAfter ?? 0) > 0).length;
  return Math.ceil(regular / 4) + (commanders ? 1 : 0);
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

export function createBattleReportViewModel(input: unknown): BattleReportViewModel {
  const record = asRecord(input);
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

  return {
    id: readString(record.id) ?? 'invalid-battle-report',
    timestamp: readString(record.timestamp) ?? '',
    missionType: readMissionType(record.missionType),
    attacker: attackerViewModel,
    defender: defenderViewModel,
    winner,
    roundCount: readCount(record.roundCount) ?? rounds.length,
    rounds,
    experience: readNumber(record.experience),
    debris: readNumber(record.debris),
    resources: readResources(record.resources),
    battlePoints: calculateBattlePoints(
      winner,
      attackerViewModel.stacks,
      defenderViewModel.stacks,
      attackerViewModel.defenses,
      defenderViewModel.defenses,
    ),
    timestampAvailable: readString(record.timestamp) != null,
  };
}
