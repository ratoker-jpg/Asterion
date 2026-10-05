import type { CombatFactionId } from './factions.ts';
import { type DefenseId } from './ids.ts';
import type { CombatStats, ResourceCost } from './types.ts';

export type FactionDefenseConstructionBalance = Readonly<{
  population: number;
  cost: ResourceCost;
  time: string;
  combat: CombatStats;
}>;

/**
 * Defense costs/population from
 * ASTERION_BALANCE_V1/оборона/{Астеры,Илары,Рой}/*.md, using the first
 * `Полные характеристики источника` table for each defense.
 *
 * Combat characteristics come from the 27 saved Nemexia Auto v2 defense pages
 * (nine defense types per faction), including weapon type, armor class, and
 * armor strength. Two Ion-Plasma rows use newer in-game values: the current
 * Synod tooltip supplied on 2026-09-28 shows 42,000/524,000 (the saved July
 * page says 52,000/624,000), while the Veyra calibration180 r3-d2-n100 report
 * shows 20,300/247,600 instead of the saved page's 27,300/327,600.
 *
 * Base construction times come only from
 * ASTERION_BALANCE_V1_TIME_REBALANCED/оборона/{Астеры,Илары,Рой}/00_TIME_REBALANCED.md,
 * column `Базовое время 1,4%`. Requirements and queue rules remain in the
 * canonical defense catalog.
 */
export const FACTION_DEFENSE_CONSTRUCTION_BALANCE: Readonly<
  Record<CombatFactionId, Readonly<Record<DefenseId, FactionDefenseConstructionBalance>>>
> = {
  aegis: {
    'ballistic-turret': { population: 2, cost: { metal: 4_600, minerals: 2_500, gas: 0 }, time: '00:00:04', combat: { attack: 140, life: 1_500, weaponType: 'Лазер', armorType: 'Лёгкая Броня', armorStrength: 3 } },
    'laser-turret': { population: 3, cost: { metal: 8_800, minerals: 4_700, gas: 0 }, time: '00:00:04', combat: { attack: 180, life: 2_400, weaponType: 'Лазер', armorType: 'Средняя Броня', armorStrength: 6 } },
    'ion-turret': { population: 14, cost: { metal: 45_500, minerals: 24_500, gas: 0 }, time: '00:00:37', combat: { attack: 840, life: 12_600, weaponType: 'Ион', armorType: 'Тяжёлая Броня', armorStrength: 9 } },
    'plasma-turret': { population: 19, cost: { metal: 67_900, minerals: 36_600, gas: 0 }, time: '00:00:51', combat: { attack: 3_800, life: 62_700, weaponType: 'Плазма', armorType: 'Средняя Броня', armorStrength: 6 } },
    'laser-ion-battery': { population: 21, cost: { metal: 88_200, minerals: 37_800, gas: 0 }, time: '00:01:11', combat: { attack: 8_820, life: 128_800, weaponType: 'Лазер / Ион', armorType: 'Средняя Броня', armorStrength: 6 } },
    'plasma-laser-battery': { population: 44, cost: { metal: 66_000, minerals: 154_000, gas: 0 }, time: '00:02:40', combat: { attack: 24_200, life: 263_000, weaponType: 'Лазер / Плазма', armorType: 'Тяжёлая Броня', armorStrength: 9 } },
    'ion-plasma-battery': { population: 65, cost: { metal: 78_000, minerals: 130_000, gas: 52_000 }, time: '00:06:50', combat: { attack: 34_250, life: 407_000, weaponType: 'Ион / Плазма', armorType: 'Средняя Броня', armorStrength: 6 } },
    'tower-shield': { population: 12, cost: { metal: 96_000, minerals: 96_000, gas: 0 }, time: '00:04:29', combat: { attack: 1, life: 600_000, weaponType: 'Лазер', armorType: 'Лёгкая Броня', armorStrength: 3 } },
    'planetary-shield': { population: 44, cost: { metal: 352_000, minerals: 352_000, gas: 0 }, time: '00:22:35', combat: { attack: 1, life: 2_640_000, weaponType: 'Лазер', armorType: 'Средняя Броня', armorStrength: 6 } },
  },
  synod: {
    'ballistic-turret': { population: 3, cost: { metal: 6_800, minerals: 3_700, gas: 0 }, time: '00:00:06', combat: { attack: 210, life: 2_200, weaponType: 'Лазер', armorType: 'Лёгкая Броня', armorStrength: 3 } },
    'laser-turret': { population: 4, cost: { metal: 11_700, minerals: 6_300, gas: 0 }, time: '00:00:06', combat: { attack: 240, life: 3_200, weaponType: 'Лазер', armorType: 'Лёгкая Броня', armorStrength: 3 } },
    'ion-turret': { population: 15, cost: { metal: 48_800, minerals: 26_300, gas: 0 }, time: '00:00:40', combat: { attack: 900, life: 13_500, weaponType: 'Ион', armorType: 'Тяжёлая Броня', armorStrength: 9 } },
    'plasma-turret': { population: 20, cost: { metal: 71_500, minerals: 38_500, gas: 0 }, time: '00:00:53', combat: { attack: 4_000, life: 66_000, weaponType: 'Плазма', armorType: 'Средняя Броня', armorStrength: 6 } },
    'laser-ion-battery': { population: 26, cost: { metal: 109_200, minerals: 46_800, gas: 0 }, time: '00:01:27', combat: { attack: 10_920, life: 196_600, weaponType: 'Лазер / Ион', armorType: 'Средняя Броня', armorStrength: 6 } },
    'plasma-laser-battery': { population: 42, cost: { metal: 63_000, minerals: 147_000, gas: 0 }, time: '00:02:33', combat: { attack: 23_100, life: 346_500, weaponType: 'Лазер / Плазма', armorType: 'Средняя Броня', armorStrength: 6 } },
    'ion-plasma-battery': { population: 80, cost: { metal: 96_000, minerals: 160_000, gas: 64_000 }, time: '00:08:24', combat: { attack: 42_000, life: 524_000, weaponType: 'Ион / Плазма', armorType: 'Тяжёлая Броня', armorStrength: 9 } },
    'tower-shield': { population: 12, cost: { metal: 96_000, minerals: 96_000, gas: 0 }, time: '00:04:29', combat: { attack: 1, life: 600_000, weaponType: 'Лазер', armorType: 'Лёгкая Броня', armorStrength: 3 } },
    'planetary-shield': { population: 44, cost: { metal: 352_000, minerals: 352_000, gas: 0 }, time: '00:22:35', combat: { attack: 1, life: 2_640_000, weaponType: 'Лазер', armorType: 'Средняя Броня', armorStrength: 6 } },
  },
  veyra: {
    'ballistic-turret': { population: 1, cost: { metal: 2_300, minerals: 1_200, gas: 0 }, time: '00:00:02', combat: { attack: 70, life: 700, weaponType: 'Лазер', armorType: 'Лёгкая Броня', armorStrength: 3 } },
    'laser-turret': { population: 2, cost: { metal: 5_900, minerals: 3_200, gas: 0 }, time: '00:00:03', combat: { attack: 120, life: 1_600, weaponType: 'Лазер', armorType: 'Лёгкая Броня', armorStrength: 3 } },
    'ion-turret': { population: 4, cost: { metal: 13_000, minerals: 7_000, gas: 0 }, time: '00:00:11', combat: { attack: 240, life: 3_600, weaponType: 'Ион', armorType: 'Тяжёлая Броня', armorStrength: 9 } },
    'plasma-turret': { population: 7, cost: { metal: 25_000, minerals: 13_500, gas: 0 }, time: '00:00:19', combat: { attack: 1_400, life: 23_100, weaponType: 'Плазма', armorType: 'Тяжёлая Броня', armorStrength: 9 } },
    'laser-ion-battery': { population: 11, cost: { metal: 46_200, minerals: 19_800, gas: 0 }, time: '00:00:37', combat: { attack: 4_620, life: 83_200, weaponType: 'Лазер / Ион', armorType: 'Лёгкая Броня', armorStrength: 3 } },
    'plasma-laser-battery': { population: 18, cost: { metal: 27_000, minerals: 63_000, gas: 0 }, time: '00:01:06', combat: { attack: 9_900, life: 148_500, weaponType: 'Лазер / Плазма', armorType: 'Средняя Броня', armorStrength: 6 } },
    'ion-plasma-battery': { population: 42, cost: { metal: 50_400, minerals: 84_000, gas: 33_600 }, time: '00:04:25', combat: { attack: 20_300, life: 247_600, weaponType: 'Ион / Плазма', armorType: 'Тяжёлая Броня', armorStrength: 9 } },
    'tower-shield': { population: 12, cost: { metal: 96_000, minerals: 96_000, gas: 0 }, time: '00:04:29', combat: { attack: 1, life: 600_000, weaponType: 'Лазер', armorType: 'Лёгкая Броня', armorStrength: 3 } },
    'planetary-shield': { population: 44, cost: { metal: 352_000, minerals: 352_000, gas: 0 }, time: '00:22:35', combat: { attack: 1, life: 2_640_000, weaponType: 'Лазер', armorType: 'Средняя Броня', armorStrength: 6 } },
  },
};
