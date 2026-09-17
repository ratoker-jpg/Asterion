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

function sourceScienceMaxLevel(sourceScienceId: ScienceId) {
  return SCIENCE_CATALOG.find((science) => science.id === sourceScienceId)?.maxLevel ?? 0;
}

export const COMBAT_TECHNOLOGIES: readonly CombatTechnologyDefinition[] = [
  { id: 'laserScience', sourceScienceId: 10, name: 'Лазерная наука', maxLevel: sourceScienceMaxLevel(10), effect: '+15% базовой атаки за уровень для лазерного оружия.', effectStatus: 'confirmed', displayBonusPercentPerLevel: 15 },
  { id: 'ionScience', sourceScienceId: 11, name: 'Ионная наука', maxLevel: sourceScienceMaxLevel(11), effect: '+15% базовой атаки за уровень для ионного оружия.', effectStatus: 'confirmed', displayBonusPercentPerLevel: 15 },
  { id: 'plasmaScience', sourceScienceId: 12, name: 'Плазменная наука', maxLevel: sourceScienceMaxLevel(12), effect: '+15% базовой атаки за уровень для плазменного оружия.', effectStatus: 'confirmed', displayBonusPercentPerLevel: 15 },
  { id: 'piercingAttack', sourceScienceId: 18, name: 'Пробивающая атака', maxLevel: sourceScienceMaxLevel(18), effect: '+5% базовой атаки за уровень для всех типов оружия.', effectStatus: 'confirmed', displayBonusPercentPerLevel: 5 },
  { id: 'lightArmor', sourceScienceId: 21, name: 'Лёгкая броня', maxLevel: sourceScienceMaxLevel(21), effect: '+1 процентный пункт лёгкой брони за уровень.', effectStatus: 'confirmed', displayBonusPercentPerLevel: 1 },
  { id: 'mediumArmor', sourceScienceId: 22, name: 'Средняя броня', maxLevel: sourceScienceMaxLevel(22), effect: '+2 процентных пункта средней брони за уровень.', effectStatus: 'confirmed', displayBonusPercentPerLevel: 2 },
  { id: 'heavyArmor', sourceScienceId: 23, name: 'Тяжёлая броня', maxLevel: sourceScienceMaxLevel(23), effect: '+3 процентных пункта тяжёлой брони за уровень.', effectStatus: 'confirmed', displayBonusPercentPerLevel: 3 },
  { id: 'shipArmor', sourceScienceId: 7, name: 'Броня кораблей', maxLevel: sourceScienceMaxLevel(7), effect: '+10% базовой жизни за уровень для боевых сущностей.', effectStatus: 'confirmed', displayBonusPercentPerLevel: 10 },
  { id: 'maneuverDefense', sourceScienceId: 19, name: 'Маневренная защита', maxLevel: sourceScienceMaxLevel(19), effect: '+5% базовой жизни за уровень для боевых сущностей.', effectStatus: 'confirmed', displayBonusPercentPerLevel: 5 },
  { id: 'criticalHit', sourceScienceId: 20, name: 'Критический удар', maxLevel: sourceScienceMaxLevel(20), effect: '+1 процентный пункт шанса критического залпа за уровень; крит ×2.', effectStatus: 'inferred', displayBonusPercentPerLevel: 1 },
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

function normalizedLevel(level: number) {
  return Number.isFinite(level) ? Math.max(0, Math.floor(level)) : 0;
}

function matchingWeaponScienceLevel(weaponType: string, levels: CombatTechnologyLevels) {
  const normalizedWeapon = weaponType.toLocaleLowerCase('ru-RU');
  return (normalizedWeapon.includes('лазер') ? levels.laserScience : 0)
    + (normalizedWeapon.includes('ион') ? levels.ionScience : 0)
    + (normalizedWeapon.includes('плазм') ? levels.plasmaScience : 0);
}

export function getTechnologyAttackBonusRatio(
  entity: Pick<CombatEntityDefinition, 'combat'>,
  levels: CombatTechnologyLevels,
) {
  return 0.15 * matchingWeaponScienceLevel(entity.combat.weaponType, levels)
    + 0.05 * normalizedLevel(levels.piercingAttack);
}

export function getTechnologyLifeBonusRatio(
  _entity: Pick<CombatEntityDefinition, 'kind'>,
  levels: CombatTechnologyLevels,
) {
  return 0.10 * normalizedLevel(levels.shipArmor)
    + 0.05 * normalizedLevel(levels.maneuverDefense);
}

function armorSciencePoints(armorType: string, levels: CombatTechnologyLevels) {
  const normalizedArmor = armorType.toLocaleLowerCase('ru-RU').replaceAll('ё', 'е');
  if (normalizedArmor.includes('легк')) return normalizedLevel(levels.lightArmor);
  if (normalizedArmor.includes('сред')) return 2 * normalizedLevel(levels.mediumArmor);
  if (normalizedArmor.includes('тяж')) return 3 * normalizedLevel(levels.heavyArmor);
  return 0;
}

export function getTechnologyCriticalChance(levels: CombatTechnologyLevels) {
  return 0.01 * normalizedLevel(levels.criticalHit);
}

export function getTechnologyAttackMultiplier(
  entity: Pick<CombatEntityDefinition, 'kind' | 'combat'>,
  levels: CombatTechnologyLevels,
  _mode: 'production' | 'calibration' = 'production',
) {
  return 1 + getTechnologyAttackBonusRatio(entity, levels);
}

export function getTechnologyLifeMultiplier(
  entity: Pick<CombatEntityDefinition, 'kind'>,
  levels: CombatTechnologyLevels,
  _mode: 'production' | 'calibration' = 'production',
) {
  return 1 + getTechnologyLifeBonusRatio(entity, levels);
}

export function getTechnologyArmorPercent(
  entity: Pick<CombatEntityDefinition, 'combat'>,
  levels: CombatTechnologyLevels,
  _mode: 'production' | 'calibration' = 'production',
) {
  return entity.combat.armorStrength + armorSciencePoints(entity.combat.armorType, levels);
}
