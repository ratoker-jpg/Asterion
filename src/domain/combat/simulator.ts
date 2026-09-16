import { COMBAT_ENTITY_BY_ID, getCombatEntity } from './catalog.ts';
import type { CommanderId } from './commanders.ts';
import {
  COMBAT_PROFILE_ID,
  COMBAT_ENTITY_LEVEL_LIMITS,
  DEFAULT_COMBAT_TARGET_PRIORITY,
  MAX_COMMANDERS_PER_SIDE,
  SIMULATOR_MAX_ROUNDS as PROFILE_MAX_ROUNDS,
  SIMULATOR_POPULATION_LIMITS,
  type CombatExecutionMode,
  type CombatTargetPriority,
  type CombatTechnologyMode,
} from './config.ts';
import {
  DEFAULT_COMBAT_FACTION_ID,
  getCombatFactionName,
  type CombatFactionId,
} from './factions.ts';
import type { CombatEntityId } from './ids.ts';
import type { CombatPriorityState } from './priority.ts';
import type { BattleParticipant } from './report.ts';
import {
  createDefaultCombatTechnologies,
  normalizeCombatTechnologies,
  type CombatTechnologyLevels,
} from './technologies.ts';
import type { CombatEntityKind } from './types.ts';

export const SIMULATOR_POPULATION_LIMIT = SIMULATOR_POPULATION_LIMITS.attackerFleet;
export const SIMULATOR_MAX_ROUNDS = PROFILE_MAX_ROUNDS;
export type SimulatorMaxRounds = (typeof SIMULATOR_MAX_ROUNDS)[number];

export type CombatStackInput = {
  entityId: CombatEntityId;
  count: number;
  level?: number;
};

export type CombatSideInput = {
  participant: BattleParticipant;
  ships: CombatStackInput[];
  /** Canonical commander field. It is nullable because a side may have none. */
  commander?: CombatStackInput | null;
  /** @deprecated Kept as a migration adapter for pre-v2 simulator inputs. */
  commanders?: CombatStackInput[];
  defenses?: CombatStackInput[];
};

export type CombatInput = {
  scenarioId: string;
  timestamp: string;
  attacker: CombatSideInput;
  defender: CombatSideInput;
  maxRounds: SimulatorMaxRounds;
  attackerPriority: CommanderId[];
  defenderPriority: CommanderId[];
  attackerTechnologies?: CombatTechnologyLevels;
  defenderTechnologies?: CombatTechnologyLevels;
  technologyMode?: CombatTechnologyMode;
  executionMode?: CombatExecutionMode;
  attackerTargetPriority?: CombatTargetPriority;
  defenderTargetPriority?: CombatTargetPriority;
  seed?: string;
  profileId?: string;
};

export type SimulatorScenario = {
  attackerFactionId?: CombatFactionId;
  defenderFactionId?: CombatFactionId;
  attackerTechnologies?: CombatTechnologyLevels;
  defenderTechnologies?: CombatTechnologyLevels;
  technologyMode?: CombatTechnologyMode;
  executionMode?: CombatExecutionMode;
  attackerTargetPriority?: CombatTargetPriority;
  defenderTargetPriority?: CombatTargetPriority;
  seed?: string;
  profileId?: string;
  attacker: {
    ships: CombatStackInput[];
    commanders: CombatStackInput[];
    commander?: CombatStackInput | null;
  };
  defender: {
    ships: CombatStackInput[];
    commanders: CombatStackInput[];
    commander?: CombatStackInput | null;
    defenses: CombatStackInput[];
  };
  maxRounds: SimulatorMaxRounds;
};

export type CombatValidationCode =
  | 'unknown-entity'
  | 'wrong-kind'
  | 'attacker-defense'
  | 'invalid-count'
  | 'duplicate-stack'
  | 'empty-side'
  | 'invalid-round-limit'
  | 'population-overflow'
  | 'participant-side'
  | 'invalid-level'
  | 'level-overflow'
  | 'commander-limit'
  | 'invalid-technology-mode'
  | 'invalid-target-priority'
  | 'exclusive-technology'
  | 'invalid-seed';

export type CombatValidationError = {
  code: CombatValidationCode;
  path: string;
  message: string;
};

export type CombatValidationResult = {
  ok: boolean;
  errors: CombatValidationError[];
  value: CombatInput;
};

export function createEmptySimulatorScenario(): SimulatorScenario {
  return {
    attackerFactionId: DEFAULT_COMBAT_FACTION_ID,
    defenderFactionId: DEFAULT_COMBAT_FACTION_ID,
    attackerTechnologies: createDefaultCombatTechnologies(),
    defenderTechnologies: createDefaultCombatTechnologies(),
    technologyMode: 'independent',
    executionMode: 'calibration',
    attackerTargetPriority: DEFAULT_COMBAT_TARGET_PRIORITY,
    defenderTargetPriority: DEFAULT_COMBAT_TARGET_PRIORITY,
    attacker: { ships: [], commanders: [], commander: null },
    defender: { ships: [], commanders: [], commander: null, defenses: [] },
    maxRounds: 8,
  };
}

export function setScenarioFaction(
  scenario: SimulatorScenario,
  side: 'attacker' | 'defender',
  factionId: CombatFactionId,
): SimulatorScenario {
  if (side === 'attacker') {
    if (scenario.attackerFactionId === factionId) return scenario;
    return {
      ...scenario,
      attackerFactionId: factionId,
      attacker: { ships: [], commanders: [], commander: null },
    };
  }

  if (scenario.defenderFactionId === factionId) return scenario;
  return {
    ...scenario,
    defenderFactionId: factionId,
    defender: { ships: [], commanders: [], commander: null, defenses: [] },
  };
}

function isMaxRounds(value: unknown): value is SimulatorMaxRounds {
  return typeof value === 'number' && (SIMULATOR_MAX_ROUNDS as readonly number[]).includes(value);
}

function isTargetPriority(value: unknown): value is CombatTargetPriority {
  return value === 'threat' || value === 'population' || value === 'catalog';
}

function isCombatEntityId(value: unknown): value is CombatEntityId {
  return typeof value === 'string' && COMBAT_ENTITY_BY_ID.has(value as CombatEntityId);
}

function normalizeStacks(stacks: readonly CombatStackInput[] | undefined) {
  return (stacks ?? [])
    .filter((stack) => Number.isFinite(stack.count) && Number.isInteger(stack.count) && stack.count > 0)
    .map((stack) => ({
      entityId: stack.entityId,
      count: stack.count,
      level: normalizeEntityLevel(stack.entityId, stack.level),
    }));
}

function normalizeEntityLevel(entityId: CombatEntityId, value: unknown) {
  if (!COMBAT_ENTITY_BY_ID.has(entityId)) return 0;
  const kind = getCombatEntity(entityId).kind;
  const max = COMBAT_ENTITY_LEVEL_LIMITS[kind];
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  return Math.min(max, Math.max(0, Math.floor(value)));
}

export function getSideCommanders(side: Pick<CombatSideInput, 'commander' | 'commanders'>): CombatStackInput[] {
  if (side.commander !== undefined) return side.commander ? [{ ...side.commander }] : [];
  return [...(side.commanders ?? [])];
}

function normalizeSideCommanders(side: Pick<CombatSideInput, 'commander' | 'commanders'>) {
  const commanders = normalizeStacks(getSideCommanders(side));
  return { commanders, commander: commanders[0] ?? null };
}

export function normalizeCombatInput(input: CombatInput): CombatInput {
  return {
    ...input,
    attacker: {
      ...input.attacker,
      ships: normalizeStacks(input.attacker.ships),
      ...normalizeSideCommanders(input.attacker),
      defenses: normalizeStacks(input.attacker.defenses),
    },
    defender: {
      ...input.defender,
      ships: normalizeStacks(input.defender.ships),
      ...normalizeSideCommanders(input.defender),
      defenses: normalizeStacks(input.defender.defenses),
    },
    attackerPriority: [...input.attackerPriority],
    defenderPriority: [...input.defenderPriority],
    attackerTechnologies: normalizeCombatTechnologies(input.attackerTechnologies),
    defenderTechnologies: normalizeCombatTechnologies(input.defenderTechnologies),
    technologyMode: input.technologyMode === 'shared' ? 'shared' : 'independent',
    // Legacy direct CombatInput callers retain the v1 production-neutral
    // behavior; SimulatorScenario always persists its explicit mode.
    executionMode: input.executionMode === 'calibration' ? 'calibration' : 'production',
    attackerTargetPriority: isTargetPriority(input.attackerTargetPriority)
      ? input.attackerTargetPriority
      : DEFAULT_COMBAT_TARGET_PRIORITY,
    defenderTargetPriority: isTargetPriority(input.defenderTargetPriority)
      ? input.defenderTargetPriority
      : DEFAULT_COMBAT_TARGET_PRIORITY,
    ...(typeof input.seed === 'string' && input.seed.trim() ? { seed: input.seed.trim() } : {}),
    profileId: input.profileId ?? COMBAT_PROFILE_ID,
  };
}

export function calculateStacksPopulation(stacks: readonly CombatStackInput[]) {
  return stacks.reduce((total, stack) => {
    if (!COMBAT_ENTITY_BY_ID.has(stack.entityId)) return total;
    return total + stack.count * getCombatEntity(stack.entityId).population;
  }, 0);
}

export function calculateScenarioPopulation(scenario: SimulatorScenario) {
  const attackerCommanders = scenario.attacker.commander !== undefined
    ? (scenario.attacker.commander ? [scenario.attacker.commander] : [])
    : scenario.attacker.commanders;
  const defenderCommanders = scenario.defender.commander !== undefined
    ? (scenario.defender.commander ? [scenario.defender.commander] : [])
    : scenario.defender.commanders;
  return {
    attackerFleet: calculateStacksPopulation([...scenario.attacker.ships, ...attackerCommanders]),
    defenderFleet: calculateStacksPopulation([...scenario.defender.ships, ...defenderCommanders]),
    defenderDefense: calculateStacksPopulation(scenario.defender.defenses),
  };
}

function validateStackCollection(
  stacks: readonly CombatStackInput[] | undefined,
  expectedKind: CombatEntityKind,
  path: string,
  errors: CombatValidationError[],
) {
  const seen = new Set<string>();
  (stacks ?? []).forEach((stack, index) => {
    const stackPath = `${path}[${index}]`;
    if (!Number.isFinite(stack.count) || !Number.isInteger(stack.count) || stack.count < 0) {
      errors.push({
        code: 'invalid-count',
        path: `${stackPath}.count`,
        message: 'Количество должно быть конечным целым числом >= 0.',
      });
    }

    if (stack.level !== undefined && (!Number.isFinite(stack.level) || !Number.isInteger(stack.level) || stack.level < 0)) {
      errors.push({
        code: 'invalid-level',
        path: `${stackPath}.level`,
        message: 'Уровень должен быть конечным целым числом >= 0.',
      });
    }

    if (seen.has(stack.entityId)) {
      errors.push({
        code: 'duplicate-stack',
        path: stackPath,
        message: `Дубликат ${stack.entityId} внутри одной категории не допускается.`,
      });
    }
    seen.add(stack.entityId);

    if (!isCombatEntityId(stack.entityId)) {
      errors.push({
        code: 'unknown-entity',
        path: `${stackPath}.entityId`,
        message: `Неизвестный combat entity ID: ${String(stack.entityId)}.`,
      });
      return;
    }

    const entity = getCombatEntity(stack.entityId);
    if (entity.kind !== expectedKind) {
      errors.push({
        code: 'wrong-kind',
        path: `${stackPath}.entityId`,
        message: `${entity.name} имеет kind=${entity.kind}, ожидается kind=${expectedKind}.`,
      });
      return;
    }

    const maxLevel = COMBAT_ENTITY_LEVEL_LIMITS[entity.kind];
    if ((stack.level ?? 0) > maxLevel) {
      errors.push({
        code: 'level-overflow',
        path: `${stackPath}.level`,
        message: `${entity.name}: максимальный уровень для ${entity.kind} — ${maxLevel}.`,
      });
    }
  });
}

export function validateCombatInput(input: CombatInput): CombatValidationResult {
  const errors: CombatValidationError[] = [];

  validateStackCollection(input.attacker.ships, 'ship', 'attacker.ships', errors);
  const attackerCommanders = getSideCommanders(input.attacker);
  const defenderCommanders = getSideCommanders(input.defender);
  validateStackCollection(attackerCommanders, 'commander', 'attacker.commander', errors);
  validateStackCollection(input.attacker.defenses, 'defense', 'attacker.defenses', errors);
  validateStackCollection(input.defender.ships, 'ship', 'defender.ships', errors);
  validateStackCollection(defenderCommanders, 'commander', 'defender.commander', errors);
  validateStackCollection(input.defender.defenses, 'defense', 'defender.defenses', errors);

  if (attackerCommanders.reduce((total, stack) => total + Math.max(0, stack.count), 0) > MAX_COMMANDERS_PER_SIDE) {
    errors.push({
      code: 'commander-limit',
      path: 'attacker.commander',
      message: `У атакующего допускается не более ${MAX_COMMANDERS_PER_SIDE} командирского корабля.`,
    });
  }
  if (defenderCommanders.reduce((total, stack) => total + Math.max(0, stack.count), 0) > MAX_COMMANDERS_PER_SIDE) {
    errors.push({
      code: 'commander-limit',
      path: 'defender.commander',
      message: `У защитника допускается не более ${MAX_COMMANDERS_PER_SIDE} командирского корабля.`,
    });
  }

  if ((input.attacker.defenses ?? []).length > 0) {
    errors.push({
      code: 'attacker-defense',
      path: 'attacker.defenses',
      message: 'Атакующая сторона не может содержать планетарную оборону.',
    });
  }

  if (input.attacker.participant.side !== 'attacker') {
    errors.push({ code: 'participant-side', path: 'attacker.participant.side', message: 'Атакующий participant должен иметь side=attacker.' });
  }
  if (input.defender.participant.side !== 'defender') {
    errors.push({ code: 'participant-side', path: 'defender.participant.side', message: 'Защитник participant должен иметь side=defender.' });
  }

  if (!isMaxRounds(input.maxRounds)) {
    errors.push({ code: 'invalid-round-limit', path: 'maxRounds', message: 'maxRounds должен быть 5, 8 или 12.' });
  }

  if (input.technologyMode !== undefined && input.technologyMode !== 'independent' && input.technologyMode !== 'shared') {
    errors.push({ code: 'invalid-technology-mode', path: 'technologyMode', message: 'Режим технологий должен быть independent или shared.' });
  }

  for (const [path, value] of [
    ['attackerTargetPriority', input.attackerTargetPriority],
    ['defenderTargetPriority', input.defenderTargetPriority],
  ] as const) {
    if (value !== undefined && !isTargetPriority(value)) {
      errors.push({
        code: 'invalid-target-priority',
        path,
        message: 'Приоритет цели должен быть threat, population или catalog.',
      });
    }
  }

  const attackerTechnologies = normalizeCombatTechnologies(input.attackerTechnologies);
  const defenderTechnologies = normalizeCombatTechnologies(input.defenderTechnologies);
  for (const [path, levels] of [['attackerTechnologies', attackerTechnologies], ['defenderTechnologies', defenderTechnologies]] as const) {
    const additional = ['piercingAttack', 'maneuverDefense', 'criticalHit']
      .filter((id) => levels[id as keyof CombatTechnologyLevels] > 0);
    if (additional.filter((id) => id === 'piercingAttack' || id === 'maneuverDefense' || id === 'criticalHit').length > 1) {
      errors.push({
        code: 'exclusive-technology',
        path,
        message: 'Можно выбрать только одну дополнительную технологию: пробивающая атака, маневренная защита или критический удар.',
      });
    }
  }

  if (input.seed !== undefined && (typeof input.seed !== 'string' || input.seed.trim().length === 0)) {
    errors.push({ code: 'invalid-seed', path: 'seed', message: 'Seed должен быть непустой строкой.' });
  }

  const normalized = normalizeCombatInput(input);
  const attackerUnits = normalized.attacker.ships.length + getSideCommanders(normalized.attacker).length;
  const defenderUnits = normalized.defender.ships.length + getSideCommanders(normalized.defender).length + (normalized.defender.defenses?.length ?? 0);

  if (attackerUnits === 0) {
    errors.push({ code: 'empty-side', path: 'attacker', message: 'Для запуска у атакующего должна быть хотя бы одна единица.' });
  }
  if (defenderUnits === 0) {
    errors.push({ code: 'empty-side', path: 'defender', message: 'Для запуска у защитника должна быть хотя бы одна единица.' });
  }

  const attackerPopulation = calculateStacksPopulation([...normalized.attacker.ships, ...getSideCommanders(normalized.attacker)]);
  const defenderFleetPopulation = calculateStacksPopulation([...normalized.defender.ships, ...getSideCommanders(normalized.defender)]);
  const defenderDefensePopulation = calculateStacksPopulation(normalized.defender.defenses ?? []);

  if (attackerPopulation > SIMULATOR_POPULATION_LIMITS.attackerFleet) {
    errors.push({
      code: 'population-overflow',
      path: 'attacker',
      message: `Флот атакующего превышает лимит ${SIMULATOR_POPULATION_LIMITS.attackerFleet.toLocaleString('ru-RU')}.`,
    });
  }
  if (defenderFleetPopulation > SIMULATOR_POPULATION_LIMITS.defenderFleet) {
    errors.push({
      code: 'population-overflow',
      path: 'defender',
      message: `Флот защитника превышает лимит ${SIMULATOR_POPULATION_LIMITS.defenderFleet.toLocaleString('ru-RU')}.`,
    });
  }
  if (defenderDefensePopulation > SIMULATOR_POPULATION_LIMITS.defenderDefense) {
    errors.push({
      code: 'population-overflow',
      path: 'defender.defenses',
      message: `Оборона защитника превышает лимит ${SIMULATOR_POPULATION_LIMITS.defenderDefense.toLocaleString('ru-RU')}.`,
    });
  }

  return { ok: errors.length === 0, errors, value: normalized };
}

export function scenarioToCombatInput(
  scenario: SimulatorScenario,
  context: {
    scenarioId: string;
    timestamp: string;
    attacker: BattleParticipant;
    defender: BattleParticipant;
    priority: CombatPriorityState;
  },
): CombatInput {
  return {
    scenarioId: context.scenarioId,
    timestamp: context.timestamp,
    attacker: {
      participant: {
        ...context.attacker,
        side: 'attacker',
        race: getCombatFactionName(scenario.attackerFactionId),
      },
      ships: scenario.attacker.ships.map((stack) => ({ ...stack })),
      commanders: scenario.attacker.commanders.map((stack) => ({ ...stack })),
      ...(scenario.attacker.commander !== undefined
        ? { commander: scenario.attacker.commander ? { ...scenario.attacker.commander } : null }
        : {}),
    },
    defender: {
      participant: {
        ...context.defender,
        side: 'defender',
        race: getCombatFactionName(scenario.defenderFactionId),
      },
      ships: scenario.defender.ships.map((stack) => ({ ...stack })),
      commanders: scenario.defender.commanders.map((stack) => ({ ...stack })),
      ...(scenario.defender.commander !== undefined
        ? { commander: scenario.defender.commander ? { ...scenario.defender.commander } : null }
        : {}),
      defenses: scenario.defender.defenses.map((stack) => ({ ...stack })),
    },
    maxRounds: scenario.maxRounds,
    attackerPriority: [...context.priority.attack],
    defenderPriority: [...context.priority.defense],
    attackerTechnologies: normalizeCombatTechnologies(scenario.attackerTechnologies),
    defenderTechnologies: normalizeCombatTechnologies(scenario.defenderTechnologies),
    technologyMode: scenario.technologyMode,
    executionMode: scenario.executionMode,
    attackerTargetPriority: scenario.attackerTargetPriority,
    defenderTargetPriority: scenario.defenderTargetPriority,
    ...(scenario.seed ? { seed: scenario.seed } : {}),
    profileId: COMBAT_PROFILE_ID,
  };
}
