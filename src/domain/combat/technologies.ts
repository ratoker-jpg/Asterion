import type { CombatExecutionMode } from './config.ts';
import type { CombatEntityDefinition } from './types.ts';
import { SCIENCE_CATALOG } from '../science/catalog.ts';
import type { ScienceId } from '../science/types.ts';

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
  sourceScienceId: ScienceId;
  name: string;
  maxLevel: number;
  effect: string;
  effectStatus: 'confirmed' | 'inferred' | 'unknown' | 'not-calibrated';
  /** Presentation-only percentage copied from the implemented Science catalog. */
  displayBonusPercentPerLevel: number;
};

const UNKNOWN_SCIENCE_EFFECT =
  'Поле и ID подтверждены сохранённым симулятором Nemexia. Точный боевой коэффициент не найден; максимум уровня берётся из SCIENCE_CATALOG.';

function sourceScienceMaxLevel(sourceScienceId: ScienceId) {
  return SCIENCE_CATALOG.find((science) => science.id === sourceScienceId)?.maxLevel ?? 0;
}

export const COMBAT_TECHNOLOGIES: readonly CombatTechnologyDefinition[] = [
  { id: 'laserScience', sourceScienceId: 10, name: 'Лазерная наука', maxLevel: sourceScienceMaxLevel(10), effect: 'Повышает урон лазерных атак в calibration-профиле.', effectStatus: 'inferred', displayBonusPercentPerLevel: 15 },
  { id: 'ionScience', sourceScienceId: 11, name: 'Ионная наука', maxLevel: sourceScienceMaxLevel(11), effect: 'Повышает урон ионных атак в calibration-профиле.', effectStatus: 'inferred', displayBonusPercentPerLevel: 15 },
  { id: 'plasmaScience', sourceScienceId: 12, name: 'Плазменная наука', maxLevel: sourceScienceMaxLevel(12), effect: 'Повышает урон плазменных атак в calibration-профиле.', effectStatus: 'inferred', displayBonusPercentPerLevel: 15 },
  { id: 'piercingAttack', sourceScienceId: 18, name: 'Пробивающая атака', maxLevel: sourceScienceMaxLevel(18), effect: 'Повышает атаку в calibration-профиле.', effectStatus: 'inferred', displayBonusPercentPerLevel: 5 },
  { id: 'lightArmor', sourceScienceId: 21, name: 'Лёгкая броня', maxLevel: sourceScienceMaxLevel(21), effect: UNKNOWN_SCIENCE_EFFECT, effectStatus: 'unknown', displayBonusPercentPerLevel: 1 },
  { id: 'mediumArmor', sourceScienceId: 22, name: 'Средняя броня', maxLevel: sourceScienceMaxLevel(22), effect: UNKNOWN_SCIENCE_EFFECT, effectStatus: 'unknown', displayBonusPercentPerLevel: 2 },
  { id: 'heavyArmor', sourceScienceId: 23, name: 'Тяжёлая броня', maxLevel: sourceScienceMaxLevel(23), effect: UNKNOWN_SCIENCE_EFFECT, effectStatus: 'unknown', displayBonusPercentPerLevel: 3 },
  { id: 'shipArmor', sourceScienceId: 7, name: 'Броня кораблей', maxLevel: sourceScienceMaxLevel(7), effect: 'Повышает запас здоровья в calibration-профиле.', effectStatus: 'inferred', displayBonusPercentPerLevel: 10 },
  { id: 'maneuverDefense', sourceScienceId: 19, name: 'Маневренная защита', maxLevel: sourceScienceMaxLevel(19), effect: 'Повышает запас здоровья в calibration-профиле.', effectStatus: 'inferred', displayBonusPercentPerLevel: 5 },
  { id: 'criticalHit', sourceScienceId: 20, name: 'Критический удар', maxLevel: sourceScienceMaxLevel(20), effect: UNKNOWN_SCIENCE_EFFECT, effectStatus: 'unknown', displayBonusPercentPerLevel: 1 },
];

const TECHNOLOGY_BY_ID = new Map(COMBAT_TECHNOLOGIES.map((technology) => [technology.id, technology]));

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

export function normalizeTechnologyLevel(id: CombatTechnologyId, value: unknown) {
  const max = TECHNOLOGY_BY_ID.get(id)?.maxLevel ?? 0;
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  return Math.min(max, Math.max(0, Math.floor(value)));
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

export function getCombatTechnologyDefinition(id: CombatTechnologyId) {
  return TECHNOLOGY_BY_ID.get(id)!;
}

const CALIBRATION_CURVES: Readonly<Record<CombatTechnologyId, readonly [number, number][]>> = {
  laserScience: [[0, 0], [4, 60], [7, 105], [11, 165], [15, 225]],
  ionScience: [[0, 0], [4, 60], [7, 105], [11, 165], [15, 225]],
  plasmaScience: [[0, 0], [4, 60], [7, 105], [11, 165], [15, 225]],
  piercingAttack: [[0, 0], [2, 10], [5, 25], [8, 40], [10, 50]],
  maneuverDefense: [[0, 0], [2, 10], [5, 25], [8, 40], [10, 50]],
  lightArmor: [],
  mediumArmor: [],
  heavyArmor: [],
  shipArmor: [[0, 0], [5, 50], [10, 100], [15, 150], [20, 200]],
  criticalHit: [],
};

function curvePercent(id: CombatTechnologyId, level: number) {
  const curve = CALIBRATION_CURVES[id];
  if (!curve.length || level <= 0) return 0;
  const exact = curve.find(([anchor]) => anchor === level);
  if (exact) return exact[1];
  const upperIndex = curve.findIndex(([anchor]) => anchor > level);
  if (upperIndex < 0) return curve[curve.length - 1]![1];
  const lower = curve[upperIndex - 1] ?? curve[0]!;
  const upper = curve[upperIndex]!;
  const span = upper[0] - lower[0];
  return span > 0 ? lower[1] + ((level - lower[0]) / span) * (upper[1] - lower[1]) : lower[1];
}

function calibrationMultiplier(id: CombatTechnologyId, level: number, mode: CombatExecutionMode) {
  if (mode !== 'calibration') return 1;
  return 1 + curvePercent(id, level) / 100;
}

/**
 * Production keeps inferred and unknown coefficients neutral. Calibration may
 * apply only the explicitly documented inferred curves above.
 */
export function getTechnologyAttackMultiplier(
  entity: Pick<CombatEntityDefinition, 'kind' | 'combat'>,
  levels: CombatTechnologyLevels,
  mode: CombatExecutionMode = 'production',
) {
  let multiplier = calibrationMultiplier('piercingAttack', levels.piercingAttack, mode);
  const weaponType = entity.combat.weaponType;
  if (weaponType.includes('Лазер')) multiplier *= calibrationMultiplier('laserScience', levels.laserScience, mode);
  if (weaponType.includes('Ион')) multiplier *= calibrationMultiplier('ionScience', levels.ionScience, mode);
  if (weaponType.includes('Плазма')) multiplier *= calibrationMultiplier('plasmaScience', levels.plasmaScience, mode);
  return multiplier;
}

export function getTechnologyLifeMultiplier(
  entity: Pick<CombatEntityDefinition, 'kind'>,
  levels: CombatTechnologyLevels,
  mode: CombatExecutionMode = 'production',
) {
  if (entity.kind !== 'defense') {
    return calibrationMultiplier('shipArmor', levels.shipArmor, mode)
      * calibrationMultiplier('maneuverDefense', levels.maneuverDefense, mode);
  }
  return 1;
}

export function getTechnologyArmorPercent(
  entity: Pick<CombatEntityDefinition, 'combat'>,
  _levels: CombatTechnologyLevels,
  _mode: CombatExecutionMode = 'production',
) {
  return entity.combat.armorStrength;
}
