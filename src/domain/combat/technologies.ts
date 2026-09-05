import type { CombatEntityDefinition } from './types.ts';

export const COMBAT_TECHNOLOGY_IDS = [
  'shipDefense',
  'laserScience',
  'ionScience',
  'plasmaScience',
  'lightArmor',
  'mediumArmor',
  'heavyArmor',
  'forceAttack',
  'promptDefense',
] as const;

export type CombatTechnologyId = (typeof COMBAT_TECHNOLOGY_IDS)[number];

export type CombatTechnologyLevels = Record<CombatTechnologyId, number>;

export type CombatTechnologyDefinition = {
  id: CombatTechnologyId;
  name: string;
  maxLevel: number;
  effect: string;
};

/**
 * Mechanics below are restricted to deterministic combat sciences whose effects
 * are explicitly documented by the Nemexia help section. We intentionally do
 * not apply Critical damage: its documented effect is probabilistic and Resolver
 * v1 has no RNG contract yet.
 */
export const COMBAT_TECHNOLOGIES: readonly CombatTechnologyDefinition[] = [
  { id: 'shipDefense', name: 'Защита кораблей', maxLevel: 20, effect: '+10% жизни кораблей за уровень' },
  { id: 'laserScience', name: 'Лазерная наука', maxLevel: 15, effect: '+15% лазерной атаки за уровень' },
  { id: 'ionScience', name: 'Ионная наука', maxLevel: 15, effect: '+15% ионной атаки за уровень' },
  { id: 'plasmaScience', name: 'Плазменная наука', maxLevel: 15, effect: '+15% плазменной атаки за уровень' },
  { id: 'lightArmor', name: 'Лёгкая броня', maxLevel: 10, effect: '+1 п.п. брони за уровень' },
  { id: 'mediumArmor', name: 'Средняя броня', maxLevel: 10, effect: '+2 п.п. брони за уровень' },
  { id: 'heavyArmor', name: 'Тяжёлая броня', maxLevel: 10, effect: '+3 п.п. брони за уровень' },
  { id: 'forceAttack', name: 'Форсированная атака', maxLevel: 10, effect: '+5% атаки кораблей за уровень' },
  { id: 'promptDefense', name: 'Форсированная защита', maxLevel: 10, effect: '+5% жизни кораблей за уровень' },
];

const TECHNOLOGY_BY_ID = new Map(COMBAT_TECHNOLOGIES.map((technology) => [technology.id, technology]));

export function createDefaultCombatTechnologies(): CombatTechnologyLevels {
  return {
    shipDefense: 0,
    laserScience: 0,
    ionScience: 0,
    plasmaScience: 0,
    lightArmor: 0,
    mediumArmor: 0,
    heavyArmor: 0,
    forceAttack: 0,
    promptDefense: 0,
  };
}

export function normalizeTechnologyLevel(id: CombatTechnologyId, value: unknown) {
  const max = TECHNOLOGY_BY_ID.get(id)?.maxLevel ?? 0;
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  return Math.min(max, Math.max(0, Math.floor(value)));
}

export function normalizeCombatTechnologies(value: unknown): CombatTechnologyLevels {
  const candidate = value && typeof value === 'object' ? value as Partial<Record<CombatTechnologyId, unknown>> : {};
  const result = createDefaultCombatTechnologies();
  COMBAT_TECHNOLOGY_IDS.forEach((id) => {
    result[id] = normalizeTechnologyLevel(id, candidate[id]);
  });
  return result;
}

export function getWeaponScienceBonus(entity: Pick<CombatEntityDefinition, 'combat'>, levels: CombatTechnologyLevels) {
  const weapon = entity.combat.weaponType.toLocaleLowerCase('ru-RU');
  if (weapon.includes('лазер')) return levels.laserScience * 0.15;
  if (weapon.includes('ион')) return levels.ionScience * 0.15;
  if (weapon.includes('плазм')) return levels.plasmaScience * 0.15;
  return 0;
}

export function getArmorScienceBonus(entity: Pick<CombatEntityDefinition, 'combat'>, levels: CombatTechnologyLevels) {
  const armor = entity.combat.armorType.toLocaleLowerCase('ru-RU');
  if (armor.includes('легк')) return levels.lightArmor * 1;
  if (armor.includes('сред')) return levels.mediumArmor * 2;
  if (armor.includes('тяж')) return levels.heavyArmor * 3;
  return 0;
}

export function getTechnologyAttackMultiplier(
  entity: Pick<CombatEntityDefinition, 'kind' | 'combat'>,
  levels: CombatTechnologyLevels,
) {
  const weaponBonus = getWeaponScienceBonus(entity, levels);
  const forceAttackBonus = entity.kind === 'defense' ? 0 : levels.forceAttack * 0.05;
  return 1 + weaponBonus + forceAttackBonus;
}

export function getTechnologyLifeMultiplier(
  entity: Pick<CombatEntityDefinition, 'kind'>,
  levels: CombatTechnologyLevels,
) {
  if (entity.kind === 'defense') return 1;
  return 1 + levels.shipDefense * 0.10 + levels.promptDefense * 0.05;
}

export function getTechnologyArmorPercent(
  entity: Pick<CombatEntityDefinition, 'combat'>,
  levels: CombatTechnologyLevels,
) {
  return entity.combat.armorStrength + getArmorScienceBonus(entity, levels);
}
