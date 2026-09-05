import { COMBAT_ENTITY_BY_ID, getCombatEntity } from './catalog.ts';
import type { CommanderId } from './commanders.ts';
import type { CombatEntityId } from './ids.ts';
import type { CombatPriorityState } from './priority.ts';
import type { BattleParticipant } from './report.ts';
import type { CombatEntityKind } from './types.ts';

export const SIMULATOR_POPULATION_LIMIT = 35_000;
export const SIMULATOR_MAX_ROUNDS = [5, 8, 12] as const;
export type SimulatorMaxRounds = (typeof SIMULATOR_MAX_ROUNDS)[number];

export type CombatStackInput = {
  entityId: CombatEntityId;
  count: number;
};

export type CombatSideInput = {
  participant: BattleParticipant;
  ships: CombatStackInput[];
  commanders: CombatStackInput[];
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
};

export type SimulatorScenario = {
  attacker: {
    ships: CombatStackInput[];
    commanders: CombatStackInput[];
  };
  defender: {
    ships: CombatStackInput[];
    commanders: CombatStackInput[];
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
  | 'participant-side';

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
    attacker: { ships: [], commanders: [] },
    defender: { ships: [], commanders: [], defenses: [] },
    maxRounds: 8,
  };
}

function isMaxRounds(value: unknown): value is SimulatorMaxRounds {
  return typeof value === 'number' && (SIMULATOR_MAX_ROUNDS as readonly number[]).includes(value);
}

function isCombatEntityId(value: unknown): value is CombatEntityId {
  return typeof value === 'string' && COMBAT_ENTITY_BY_ID.has(value as CombatEntityId);
}

function normalizeStacks(stacks: readonly CombatStackInput[] | undefined) {
  return (stacks ?? [])
    .filter((stack) => Number.isFinite(stack.count) && Number.isInteger(stack.count) && stack.count > 0)
    .map((stack) => ({ entityId: stack.entityId, count: stack.count }));
}

export function normalizeCombatInput(input: CombatInput): CombatInput {
  return {
    ...input,
    attacker: {
      ...input.attacker,
      ships: normalizeStacks(input.attacker.ships),
      commanders: normalizeStacks(input.attacker.commanders),
      defenses: normalizeStacks(input.attacker.defenses),
    },
    defender: {
      ...input.defender,
      ships: normalizeStacks(input.defender.ships),
      commanders: normalizeStacks(input.defender.commanders),
      defenses: normalizeStacks(input.defender.defenses),
    },
    attackerPriority: [...input.attackerPriority],
    defenderPriority: [...input.defenderPriority],
  };
}

export function calculateStacksPopulation(stacks: readonly CombatStackInput[]) {
  return stacks.reduce((total, stack) => {
    if (!COMBAT_ENTITY_BY_ID.has(stack.entityId)) return total;
    return total + stack.count * getCombatEntity(stack.entityId).population;
  }, 0);
}

export function calculateScenarioPopulation(scenario: SimulatorScenario) {
  return {
    attackerFleet: calculateStacksPopulation([...scenario.attacker.ships, ...scenario.attacker.commanders]),
    defenderFleet: calculateStacksPopulation([...scenario.defender.ships, ...scenario.defender.commanders]),
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
    }
  });
}

export function validateCombatInput(input: CombatInput): CombatValidationResult {
  const errors: CombatValidationError[] = [];

  validateStackCollection(input.attacker.ships, 'ship', 'attacker.ships', errors);
  validateStackCollection(input.attacker.commanders, 'commander', 'attacker.commanders', errors);
  validateStackCollection(input.defender.ships, 'ship', 'defender.ships', errors);
  validateStackCollection(input.defender.commanders, 'commander', 'defender.commanders', errors);
  validateStackCollection(input.defender.defenses, 'defense', 'defender.defenses', errors);

  if ((input.attacker.defenses ?? []).some((stack) => stack.count > 0)) {
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

  const normalized = normalizeCombatInput(input);
  const attackerUnits = normalized.attacker.ships.length + normalized.attacker.commanders.length;
  const defenderUnits = normalized.defender.ships.length + normalized.defender.commanders.length + (normalized.defender.defenses?.length ?? 0);

  if (attackerUnits === 0) {
    errors.push({ code: 'empty-side', path: 'attacker', message: 'Для запуска у атакующего должна быть хотя бы одна единица.' });
  }
  if (defenderUnits === 0) {
    errors.push({ code: 'empty-side', path: 'defender', message: 'Для запуска у защитника должна быть хотя бы одна единица.' });
  }

  const attackerPopulation = calculateStacksPopulation([...normalized.attacker.ships, ...normalized.attacker.commanders]);
  const defenderFleetPopulation = calculateStacksPopulation([...normalized.defender.ships, ...normalized.defender.commanders]);
  const defenderDefensePopulation = calculateStacksPopulation(normalized.defender.defenses ?? []);

  if (attackerPopulation > SIMULATOR_POPULATION_LIMIT) {
    errors.push({
      code: 'population-overflow',
      path: 'attacker',
      message: `Флот атакующего превышает лимит ${SIMULATOR_POPULATION_LIMIT.toLocaleString('ru-RU')}.`,
    });
  }
  if (defenderFleetPopulation > SIMULATOR_POPULATION_LIMIT) {
    errors.push({
      code: 'population-overflow',
      path: 'defender',
      message: `Флот защитника превышает лимит ${SIMULATOR_POPULATION_LIMIT.toLocaleString('ru-RU')}.`,
    });
  }
  if (defenderDefensePopulation > SIMULATOR_POPULATION_LIMIT) {
    errors.push({
      code: 'population-overflow',
      path: 'defender.defenses',
      message: `Оборона защитника превышает лимит ${SIMULATOR_POPULATION_LIMIT.toLocaleString('ru-RU')}.`,
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
      participant: { ...context.attacker, side: 'attacker' },
      ships: scenario.attacker.ships.map((stack) => ({ ...stack })),
      commanders: scenario.attacker.commanders.map((stack) => ({ ...stack })),
    },
    defender: {
      participant: { ...context.defender, side: 'defender' },
      ships: scenario.defender.ships.map((stack) => ({ ...stack })),
      commanders: scenario.defender.commanders.map((stack) => ({ ...stack })),
      defenses: scenario.defender.defenses.map((stack) => ({ ...stack })),
    },
    maxRounds: scenario.maxRounds,
    attackerPriority: [...context.priority.attack],
    defenderPriority: [...context.priority.defense],
  };
}
