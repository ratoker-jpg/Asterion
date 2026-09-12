import type { CombatFactionId } from './factions.ts';
import { type DefenseId } from './ids.ts';
import type { ResourceCost } from './types.ts';

export type FactionDefenseConstructionBalance = Readonly<{
  population: number;
  cost: ResourceCost;
  time: string;
}>;

/**
 * Defense costs/population from
 * ASTERION_BALANCE_V1/оборона/{Астеры,Илары,Рой}/*.md, using the first
 * `Полные характеристики источника` table for each defense.
 *
 * Base construction times come only from
 * ASTERION_BALANCE_V1_TIME_REBALANCED/оборона/{Астеры,Илары,Рой}/00_TIME_REBALANCED.md,
 * column `Базовое время 1,4%`. Combat fields, requirements, and queue rules
 * remain in the existing canonical defense catalog.
 */
export const FACTION_DEFENSE_CONSTRUCTION_BALANCE: Readonly<
  Record<CombatFactionId, Readonly<Record<DefenseId, FactionDefenseConstructionBalance>>>
> = {
  aegis: {
    'ballistic-turret': { population: 2, cost: { metal: 4_600, minerals: 2_500, gas: 0 }, time: '00:00:04' },
    'laser-turret': { population: 3, cost: { metal: 8_800, minerals: 4_700, gas: 0 }, time: '00:00:04' },
    'ion-turret': { population: 14, cost: { metal: 45_500, minerals: 24_500, gas: 0 }, time: '00:00:37' },
    'plasma-turret': { population: 19, cost: { metal: 67_900, minerals: 36_600, gas: 0 }, time: '00:00:51' },
    'laser-ion-battery': { population: 21, cost: { metal: 88_200, minerals: 37_800, gas: 0 }, time: '00:01:11' },
    'plasma-laser-battery': { population: 44, cost: { metal: 66_000, minerals: 154_000, gas: 0 }, time: '00:02:40' },
    'ion-plasma-battery': { population: 65, cost: { metal: 78_000, minerals: 130_000, gas: 52_000 }, time: '00:06:50' },
    'tower-shield': { population: 12, cost: { metal: 96_000, minerals: 96_000, gas: 0 }, time: '00:04:29' },
    'planetary-shield': { population: 44, cost: { metal: 352_000, minerals: 352_000, gas: 0 }, time: '00:22:35' },
  },
  synod: {
    'ballistic-turret': { population: 3, cost: { metal: 6_800, minerals: 3_700, gas: 0 }, time: '00:00:06' },
    'laser-turret': { population: 4, cost: { metal: 11_700, minerals: 6_300, gas: 0 }, time: '00:00:06' },
    'ion-turret': { population: 15, cost: { metal: 48_800, minerals: 26_300, gas: 0 }, time: '00:00:40' },
    'plasma-turret': { population: 20, cost: { metal: 71_500, minerals: 38_500, gas: 0 }, time: '00:00:53' },
    'laser-ion-battery': { population: 26, cost: { metal: 109_200, minerals: 46_800, gas: 0 }, time: '00:01:27' },
    'plasma-laser-battery': { population: 42, cost: { metal: 63_000, minerals: 147_000, gas: 0 }, time: '00:02:33' },
    'ion-plasma-battery': { population: 80, cost: { metal: 96_000, minerals: 160_000, gas: 64_000 }, time: '00:08:24' },
    'tower-shield': { population: 12, cost: { metal: 96_000, minerals: 96_000, gas: 0 }, time: '00:04:29' },
    'planetary-shield': { population: 44, cost: { metal: 352_000, minerals: 352_000, gas: 0 }, time: '00:22:35' },
  },
  veyra: {
    'ballistic-turret': { population: 1, cost: { metal: 2_300, minerals: 1_200, gas: 0 }, time: '00:00:02' },
    'laser-turret': { population: 2, cost: { metal: 5_900, minerals: 3_200, gas: 0 }, time: '00:00:03' },
    'ion-turret': { population: 4, cost: { metal: 13_000, minerals: 7_000, gas: 0 }, time: '00:00:11' },
    'plasma-turret': { population: 7, cost: { metal: 25_000, minerals: 13_500, gas: 0 }, time: '00:00:19' },
    'laser-ion-battery': { population: 11, cost: { metal: 46_200, minerals: 19_800, gas: 0 }, time: '00:00:37' },
    'plasma-laser-battery': { population: 18, cost: { metal: 27_000, minerals: 63_000, gas: 0 }, time: '00:01:06' },
    'ion-plasma-battery': { population: 42, cost: { metal: 50_400, minerals: 84_000, gas: 33_600 }, time: '00:04:25' },
    'tower-shield': { population: 12, cost: { metal: 96_000, minerals: 96_000, gas: 0 }, time: '00:04:29' },
    'planetary-shield': { population: 44, cost: { metal: 352_000, minerals: 352_000, gas: 0 }, time: '00:22:35' },
  },
};
