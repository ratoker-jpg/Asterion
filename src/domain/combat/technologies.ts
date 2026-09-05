import type { CombatEntityDefinition } from './types.ts';

export const COMBAT_TECHNOLOGY_IDS = [
  'laserScience',
  'ionScience',
  'plasmaScience',
  'piercingAttack',
  'lightArmor',
  'mediumArmor',
  'heavyArmor',
  'shipArmor',
  'maneuverDefense',
  'criticalHit',
] as const;

export type CombatTechnologyId = (typeof COMBAT_TECHNOLOGY_IDS)[number];

export type CombatTechnologyLevels = Record<CombatTechnologyId, number>;

export type CombatTechnologyDefinition = {
  id: CombatTechnologyId;
  sourceScienceId: number;
  name: string;
  effect: string;
};

const UNKNOWN_SCIENCE_EFFECT =
  'Поле и ID подтверждены сохранённым симулятором Nemexia. Точный боевой коэффициент и максимальный уровень в доступном клиентском исходнике не найдены.';

/**
 * Exact science inputs present in the saved Nemexia fleet simulator.
 * The page exposes science names and ids for both attacker and defender, but does
 * not expose their battle coefficients or maximum levels. Do not infer either.
 */
export const COMBAT_TECHNOLOGIES: readonly CombatTechnologyDefinition[] = [
  { id: 'laserScience', sourceScienceId: 10, name: 'Лазерная наука', effect: UNKNOWN_SCIENCE_EFFECT },
  { id: 'ionScience', sourceScienceId: 11, name: 'Ионная наука', effect: UNKNOWN_SCIENCE_EFFECT },
  { id: 'plasmaScience', sourceScienceId: 12, name: 'Плазменная наука', effect: UNKNOWN_SCIENCE_EFFECT },
  { id: 'piercingAttack', sourceScienceId: 18, name: 'Пробивающая атака', effect: UNKNOWN_SCIENCE_EFFECT },
  { id: 'lightArmor', sourceScienceId: 21, name: 'Лёгкая броня', effect: UNKNOWN_SCIENCE_EFFECT },
  { id: 'mediumArmor', sourceScienceId: 22, name: 'Средняя броня', effect: UNKNOWN_SCIENCE_EFFECT },
  { id: 'heavyArmor', sourceScienceId: 23, name: 'Тяжёлая броня', effect: UNKNOWN_SCIENCE_EFFECT },
  { id: 'shipArmor', sourceScienceId: 7, name: 'Броня кораблей', effect: UNKNOWN_SCIENCE_EFFECT },
  { id: 'maneuverDefense', sourceScienceId: 19, name: 'Маневренная защита', effect: UNKNOWN_SCIENCE_EFFECT },
  { id: 'criticalHit', sourceScienceId: 20, name: 'Критический удар', effect: UNKNOWN_SCIENCE_EFFECT },
];

export function createDefaultCombatTechnologies(): CombatTechnologyLevels {
  return {
    laserScience: 0,
    ionScience: 0,
    plasmaScience: 0,
    piercingAttack: 0,
    lightArmor: 0,
    mediumArmor: 0,
    heavyArmor: 0,
    shipArmor: 0,
    maneuverDefense: 0,
    criticalHit: 0,
  };
}

export function normalizeTechnologyLevel(_id: CombatTechnologyId, value: unknown) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  return Math.min(Number.MAX_SAFE_INTEGER, Math.max(0, Math.floor(value)));
}

export function normalizeCombatTechnologies(value: unknown): CombatTechnologyLevels {
  const candidate = value && typeof value === 'object'
    ? value as Partial<Record<CombatTechnologyId, unknown>> & {
      shipDefense?: unknown;
      forceAttack?: unknown;
      promptDefense?: unknown;
    }
    : {};
  const result = createDefaultCombatTechnologies();
  COMBAT_TECHNOLOGY_IDS.forEach((id) => {
    const legacyValue = id === 'shipArmor'
      ? candidate.shipDefense
      : id === 'piercingAttack'
        ? candidate.forceAttack
        : id === 'maneuverDefense'
          ? candidate.promptDefense
          : undefined;
    result[id] = normalizeTechnologyLevel(id, candidate[id] ?? legacyValue);
  });
  return result;
}

/**
 * The exact battle coefficients for these sciences were not found in the saved
 * Nemexia simulator source. Resolver v1 therefore keeps them neutral rather than
 * inventing balance values. The editor still stores their levels for future use.
 */
export function getTechnologyAttackMultiplier(
  _entity: Pick<CombatEntityDefinition, 'kind' | 'combat'>,
  _levels: CombatTechnologyLevels,
) {
  return 1;
}

export function getTechnologyLifeMultiplier(
  _entity: Pick<CombatEntityDefinition, 'kind'>,
  _levels: CombatTechnologyLevels,
) {
  return 1;
}

export function getTechnologyArmorPercent(
  entity: Pick<CombatEntityDefinition, 'combat'>,
  _levels: CombatTechnologyLevels,
) {
  return entity.combat.armorStrength;
}
