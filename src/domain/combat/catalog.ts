import solarSatelliteArt from '../../../assets/source/New assets/ship/aegis/ship.aegis.solar-satellite.png';
import spyProbeArt from '../../../assets/source/New assets/ship/aegis/ship.aegis.spy-probe.png';
import transporterArt from '../../../assets/source/New assets/ship/aegis/ship.aegis.transporter.png';
import megaTransporterArt from '../../../assets/source/New assets/ship/aegis/ship.aegis.mega-transporter.png';
import colonizerArt from '../../../assets/source/New assets/ship/aegis/ship.aegis.colonizer.png';
import recyclerArt from '../../../assets/source/New assets/ship/aegis/ship.aegis.recycler.png';
import scoutArt from '../../../assets/source/New assets/ship/aegis/ship.aegis.scout.png';
import cruiserArt from '../../../assets/source/New assets/ship/aegis/ship.aegis.cruiser.png';
import defenderArt from '../../../assets/source/New assets/ship/aegis/ship.aegis.defender.png';
import battleshipArt from '../../../assets/source/New assets/ship/aegis/ship.aegis.battleship.png';
import destroyerArt from '../../../assets/source/New assets/ship/aegis/ship.aegis.destroyer.png';
import bomberArt from '../../../assets/source/New assets/ship/aegis/ship.aegis.bomber.png';
import deathStarArt from '../../../assets/source/New assets/ship/aegis/ship.aegis.death-star.png';

import ballisticTurretArt from '../../../assets/source/New assets/defenses/aegis/defense.aegis.ballistic-turret.png';
import laserTurretArt from '../../../assets/source/New assets/defenses/aegis/defense.aegis.laser-turret.png';
import ionTurretArt from '../../../assets/source/New assets/defenses/aegis/defense.aegis.ion-turret.png';
import plasmaTurretArt from '../../../assets/source/New assets/defenses/aegis/defense.aegis.plasma-turret.png';
import laserIonBatteryArt from '../../../assets/source/New assets/defenses/aegis/defense.aegis.laser-ion-battery.png';
import plasmaLaserBatteryArt from '../../../assets/source/New assets/defenses/aegis/defense.aegis.plasma-laser-battery.png';
import ionPlasmaBatteryArt from '../../../assets/source/New assets/defenses/aegis/defense.aegis.ion-plasma-battery.png';
import towerShieldArt from '../../../assets/source/New assets/defenses/aegis/defense.aegis.tower-shield.png';
import planetaryShieldArt from '../../../assets/source/New assets/defenses/aegis/defense.aegis.planetary-shield.png';

import corsairArt from '../../../assets/source/New assets/comander_ship/commander-ship.corsair.png';
import hunterArt from '../../../assets/source/New assets/comander_ship/commander-ship.hunter.png';
import executionerArt from '../../../assets/source/New assets/comander_ship/commander-ship.executioner.png';
import juggernautArt from '../../../assets/source/New assets/comander_ship/commander-ship.juggernaut.png';
import typhoonArt from '../../../assets/source/New assets/comander_ship/commander-ship.typhoon.png';
import viperArt from '../../../assets/source/New assets/comander_ship/commander-ship.viper.png';
import phantomArt from '../../../assets/source/New assets/comander_ship/commander-ship.phantom.png';
import scorpionArt from '../../../assets/source/New assets/comander_ship/commander-ship.scorpion.png';
import annihilatorArt from '../../../assets/source/New assets/comander_ship/commander-ship.annihilator.png';
import reanimatorArt from '../../../assets/source/New assets/comander_ship/commander-ship.reanimator.png';
import argoArt from '../../../assets/source/New assets/comander_ship/commander-ship.argo.png';
import judgeArt from '../../../assets/source/New assets/comander_ship/commander-ship.judge.png';
import poliasArt from '../../../assets/source/New assets/comander_ship/commander-ship.polias.png';

import type { CommanderId } from './commanders.ts';
import type { CombatEntityDefinition } from './types.ts';
import type { CombatEntityId, DefenseId, ShipId } from './ids.ts';

export type CatalogEntity<TId extends CombatEntityId = CombatEntityId> = CombatEntityDefinition & { id: TId };

export const SHIP_COMBAT_CATALOG: readonly CatalogEntity<ShipId>[] = [
  {
    id: 'solar-satellite', kind: 'ship', name: 'Спутник', role: 'Солнечный спутник', art: solarSatelliteArt, population: 1,
    cost: { metal: 500, minerals: 2_000, gas: 500 },
    combat: { attack: 1, life: 2_200, weaponType: 'Лазер', armorType: 'Средняя Броня', armorStrength: 6 },
    category: 'Обслуживающий корабль', ship: { cargo: 0, speed: 200, fuel: 10 },
    construction: { time: '00:02:30', requiredShipyardLevel: 1, requirements: ['Верфь · уровень 1'] },
  },
  {
    id: 'spy-probe', kind: 'ship', name: 'Зонд', role: 'Шпионский зонд', art: spyProbeArt, population: 1,
    cost: { metal: 0, minerals: 1_000, gas: 0 },
    combat: { attack: 1, life: 1, weaponType: 'Лазер', armorType: 'Легкая Броня', armorStrength: 3 },
    category: 'Гражданский корабль', ship: { cargo: 1, speed: 200_000_000, fuel: 1 },
    construction: { time: '00:01:00', requiredShipyardLevel: 3, requirements: ['Верфь · уровень 3', 'Топливные элементы · уровень 3', 'Шпионаж · уровень 2'] },
  },
  {
    id: 'transporter', kind: 'ship', name: 'Транспорт', role: 'Транспортировщик', art: transporterArt, population: 1,
    cost: { metal: 2_400, minerals: 1_400, gas: 0 },
    combat: { attack: 10, life: 2_000, weaponType: 'Лазер', armorType: 'Легкая Броня', armorStrength: 3 },
    category: 'Гражданский корабль', ship: { cargo: 5_000, speed: 24_000, fuel: 12 },
    construction: { time: '00:10:00', requiredShipyardLevel: 2, requirements: ['Верфь · уровень 2', 'Математика · уровень 2'] },
  },
  {
    id: 'mega-transporter', kind: 'ship', name: 'Мегатранспорт', role: 'Мегатранспортировщик', art: megaTransporterArt, population: 3,
    cost: { metal: 6_400, minerals: 5_000, gas: 0 },
    combat: { attack: 10, life: 7_800, weaponType: 'Лазер', armorType: 'Средняя Броня', armorStrength: 6 },
    category: 'Гражданский корабль', ship: { cargo: 20_000, speed: 19_000, fuel: 45 },
    construction: { time: '00:20:00', requiredShipyardLevel: 4, requirements: ['Верфь · уровень 4', 'Астрономия · уровень 6'] },
  },
  {
    id: 'colonizer', kind: 'ship', name: 'Колонизатор', role: 'Колониальный корабль', art: colonizerArt, population: 12,
    cost: { metal: 12_500, minerals: 25_000, gas: 10_600 },
    combat: { attack: 600, life: 2_400, weaponType: 'Лазер', armorType: 'Тяжелая Броня', armorStrength: 9 },
    category: 'Гражданский корабль', ship: { cargo: 7_500, speed: 5_000, fuel: 1_500 },
    construction: { time: '00:58:00', requiredShipyardLevel: 4, requirements: ['Верфь · уровень 4', 'Топливные элементы · уровень 3'] },
  },
  {
    id: 'recycler', kind: 'ship', name: 'Переработчик', role: 'Переработчик обломков', art: recyclerArt, population: 5,
    cost: { metal: 10_500, minerals: 5_300, gas: 1_800 },
    combat: { attack: 50, life: 2_200, weaponType: 'Лазер', armorType: 'Средняя Броня', armorStrength: 6 },
    category: 'Гражданский корабль', ship: { cargo: 40_000, speed: 7_000, fuel: 120 },
    construction: { time: '00:41:40', requiredShipyardLevel: 4, requirements: ['Верфь · уровень 4', 'Топливные элементы · уровень 6', 'Броня кораблей · уровень 2'] },
  },
  {
    id: 'scout', kind: 'ship', name: 'Скаут', role: 'Лёгкий боевой разведчик', art: scoutArt, population: 2,
    cost: { metal: 2_400, minerals: 1_600, gas: 0 },
    combat: { attack: 800, life: 2_400, weaponType: 'Лазер', armorType: 'Легкая Броня', armorStrength: 3 },
    category: 'Боевой корабль', ship: { cargo: 250, speed: 28_000, fuel: 25 },
    construction: { time: '00:20:00', requiredShipyardLevel: 1, requirements: ['Верфь · уровень 1', 'Астрономия · уровень 1'] },
  },
  {
    id: 'cruiser', kind: 'ship', name: 'Крейсер', role: 'Крейсер', art: cruiserArt, population: 7,
    cost: { metal: 10_200, minerals: 8_400, gas: 0 },
    combat: { attack: 3_080, life: 9_200, weaponType: 'Ион', armorType: 'Легкая Броня', armorStrength: 3 },
    category: 'Боевой корабль', ship: { cargo: 800, speed: 32_000, fuel: 315 },
    construction: { time: '00:25:40', requiredShipyardLevel: 3, requirements: ['Верфь · уровень 3', 'Броня кораблей · уровень 2', 'Топливные элементы · уровень 2'] },
  },
  {
    id: 'defender', kind: 'ship', name: 'Защитник', role: 'Защитный корабль', art: defenderArt, population: 6,
    cost: { metal: 5_300, minerals: 15_900, gas: 0 },
    combat: { attack: 2_760, life: 8_300, weaponType: 'Лазер', armorType: 'Легкая Броня', armorStrength: 3 },
    category: 'Боевой корабль', ship: { cargo: 1_500, speed: 20_000, fuel: 280 },
    construction: { time: '00:35:00', requiredShipyardLevel: 5, requirements: ['Верфь · уровень 5', 'Ионная наука · уровень 2', 'Топливные элементы · уровень 4'] },
  },
  {
    id: 'battleship', kind: 'ship', name: 'Линкор', role: 'Линкор', art: battleshipArt, population: 15,
    cost: { metal: 49_400, minerals: 21_200, gas: 0 },
    combat: { attack: 9_000, life: 27_000, weaponType: 'Ион', armorType: 'Средняя Броня', armorStrength: 6 },
    category: 'Боевой корабль', ship: { cargo: 1_500, speed: 20_000, fuel: 480 },
    construction: { time: '00:55:00', requiredShipyardLevel: 7, requirements: ['Верфь · уровень 7', 'Реактивные двигатели · уровень 4'] },
  },
  {
    id: 'destroyer', kind: 'ship', name: 'Разрушитель', role: 'Тяжёлый эсминец', art: destroyerArt, population: 30,
    cost: { metal: 93_900, minerals: 84_500, gas: 9_400 },
    combat: { attack: 19_500, life: 58_500, weaponType: 'Плазма', armorType: 'Тяжелая Броня', armorStrength: 9 },
    category: 'Боевой корабль', ship: { cargo: 2_000, speed: 13_000, fuel: 900 },
    construction: { time: '01:20:00', requiredShipyardLevel: 9, requirements: ['Верфь · уровень 9', 'Реактивные двигатели · уровень 6', 'Гиперпространство · уровень 5'] },
  },
  {
    id: 'bomber', kind: 'ship', name: 'Бомбардировщик', role: 'Бомбардировщик', art: bomberArt, population: 22,
    cost: { metal: 44_000, minerals: 55_000, gas: 11_000 },
    combat: { attack: 13_200, life: 39_600, weaponType: 'Лазер', armorType: 'Средняя Броня', armorStrength: 6 },
    category: 'Боевой корабль', ship: { cargo: 500, speed: 20_000, fuel: 800 },
    construction: { time: '00:55:00', requiredShipyardLevel: 8, requirements: ['Верфь · уровень 8', 'Лазерная наука · уровень 8', 'Плазменная наука · уровень 5'] },
  },
  {
    id: 'death-star', kind: 'ship', name: 'Планетолом', role: 'Сверхтяжёлый корабль', art: deathStarArt, population: 700,
    cost: { metal: 2_327_500, minerals: 1_862_000, gas: 465_500 },
    combat: { attack: 700_000, life: 2_100_000, weaponType: 'Ион', armorType: 'Тяжелая Броня', armorStrength: 9 },
    category: 'Боевой корабль', ship: { cargo: 1_000_000, speed: 200, fuel: 60_000 },
    construction: { time: '175:00:00', requiredShipyardLevel: 14, requirements: ['Верфь · уровень 14', 'Гиперпространство · уровень 13', 'Параллельные вселенные · уровень 1', 'Тяжёлая броня · уровень 10'] },
  },
];

export const DEFENSE_COMBAT_CATALOG: readonly CatalogEntity<DefenseId>[] = [
  {
    id: 'ballistic-turret', kind: 'defense', name: 'Защитная матрица', role: 'Базовая оборонная установка', art: ballisticTurretArt, population: 1,
    cost: { metal: 2_500, minerals: 1_000, gas: 0 }, combat: { attack: 900, life: 4_000, weaponType: 'Кинетика', armorType: 'Лёгкая броня', armorStrength: 4 }, category: 'Оборона Астеров',
    tactical: { specialization: 'Лёгкие цели', range: 'Орбита', priority: 'Перехват' }, construction: { time: '00:04:00', requiredShipyardLevel: 1, requirements: ['Верфь · уровень 1'] },
  },
  {
    id: 'laser-turret', kind: 'defense', name: 'Лазерная матрица', role: 'Лазерная оборонная установка', art: laserTurretArt, population: 1,
    cost: { metal: 2_000, minerals: 2_500, gas: 0 }, combat: { attack: 1_250, life: 4_800, weaponType: 'Лазер', armorType: 'Лёгкая броня', armorStrength: 4 }, category: 'Оборона Астеров',
    tactical: { specialization: 'Универсальная', range: 'Орбита', priority: 'Флот' }, construction: { time: '00:05:00', requiredShipyardLevel: 2, requirements: ['Верфь · уровень 2', 'Лазерная наука · уровень 2'] },
  },
  {
    id: 'ion-turret', kind: 'defense', name: 'Ионная матрица', role: 'Ионная оборонная установка', art: ionTurretArt, population: 2,
    cost: { metal: 3_500, minerals: 4_500, gas: 500 }, combat: { attack: 2_300, life: 7_000, weaponType: 'Ион', armorType: 'Средняя броня', armorStrength: 6 }, category: 'Оборона Астеров',
    tactical: { specialization: 'Щиты и броня', range: 'Орбита', priority: 'Крейсеры' }, construction: { time: '00:08:00', requiredShipyardLevel: 3, requirements: ['Верфь · уровень 3', 'Ионная наука · уровень 2'] },
  },
  {
    id: 'plasma-turret', kind: 'defense', name: 'Плазменная матрица', role: 'Плазменная оборонная установка', art: plasmaTurretArt, population: 3,
    cost: { metal: 6_000, minerals: 7_500, gas: 2_000 }, combat: { attack: 4_500, life: 10_500, weaponType: 'Плазма', armorType: 'Средняя броня', armorStrength: 6 }, category: 'Оборона Астеров',
    tactical: { specialization: 'Тяжёлые цели', range: 'Дальняя орбита', priority: 'Линкоры' }, construction: { time: '00:12:00', requiredShipyardLevel: 4, requirements: ['Верфь · уровень 4', 'Плазменная наука · уровень 2'] },
  },
  {
    id: 'laser-ion-battery', kind: 'defense', name: 'Лазер-ионная матрица', role: 'Комбинированная батарея', art: laserIonBatteryArt, population: 5,
    cost: { metal: 9_500, minerals: 12_000, gas: 2_500 }, combat: { attack: 8_200, life: 18_000, weaponType: 'Лазер / Ион', armorType: 'Средняя броня', armorStrength: 7 }, category: 'Оборона Астеров',
    tactical: { specialization: 'Универсальная', range: 'Дальняя орбита', priority: 'Флот' }, construction: { time: '00:20:00', requiredShipyardLevel: 6, requirements: ['Верфь · уровень 6', 'Лазерная наука · уровень 5', 'Ионная наука · уровень 4'] },
  },
  {
    id: 'plasma-laser-battery', kind: 'defense', name: 'Плазма-лазерная матрица', role: 'Тяжёлая комбинированная батарея', art: plasmaLaserBatteryArt, population: 8,
    cost: { metal: 18_000, minerals: 22_000, gas: 6_000 }, combat: { attack: 14_500, life: 29_000, weaponType: 'Плазма / Лазер', armorType: 'Тяжёлая броня', armorStrength: 9 }, category: 'Оборона Астеров',
    tactical: { specialization: 'Тяжёлые корабли', range: 'Дальняя орбита', priority: 'Линкоры' }, construction: { time: '00:32:00', requiredShipyardLevel: 8, requirements: ['Верфь · уровень 8', 'Плазменная наука · уровень 5', 'Лазерная наука · уровень 7'] },
  },
  {
    id: 'ion-plasma-battery', kind: 'defense', name: 'Ион-плазменная матрица', role: 'Штурмовая оборонная батарея', art: ionPlasmaBatteryArt, population: 12,
    cost: { metal: 26_000, minerals: 31_000, gas: 10_000 }, combat: { attack: 22_000, life: 42_000, weaponType: 'Ион / Плазма', armorType: 'Тяжёлая броня', armorStrength: 10 }, category: 'Оборона Астеров',
    tactical: { specialization: 'Капитальные цели', range: 'Дальняя орбита', priority: 'Капитальные' }, construction: { time: '00:45:00', requiredShipyardLevel: 9, requirements: ['Верфь · уровень 9', 'Ионная наука · уровень 7', 'Плазменная наука · уровень 6'] },
  },
  {
    id: 'tower-shield', kind: 'defense', name: 'Матричный щит', role: 'Локальный генератор защиты', art: towerShieldArt, population: 14,
    cost: { metal: 34_000, minerals: 40_000, gas: 14_000 }, combat: { attack: 1_000, life: 85_000, weaponType: 'Импульс', armorType: 'Щитовое поле', armorStrength: 14 }, category: 'Оборона Астеров',
    tactical: { specialization: 'Прикрытие обороны', range: 'Локальная', priority: 'Защита' }, construction: { time: '01:00:00', requiredShipyardLevel: 10, requirements: ['Верфь · уровень 10', 'Щитовые системы · уровень 7'] },
  },
  {
    id: 'planetary-shield', kind: 'defense', name: 'Планетарная матрица', role: 'Стратегический планетарный комплекс', art: planetaryShieldArt, population: 30,
    cost: { metal: 90_000, minerals: 110_000, gas: 45_000 }, combat: { attack: 4_000, life: 250_000, weaponType: 'Импульс', armorType: 'Планетарный щит', armorStrength: 18 }, category: 'Оборона Астеров',
    tactical: { specialization: 'Планетарная защита', range: 'Планета', priority: 'Защита' }, construction: { time: '03:00:00', requiredShipyardLevel: 12, requirements: ['Верфь · уровень 12', 'Щитовые системы · уровень 10', 'Энергетика · уровень 10'] },
  },
];

export const COMMANDER_COMBAT_CATALOG: readonly CatalogEntity<CommanderId>[] = [
  {
    id: 'corsair', kind: 'commander', name: 'Корсар', role: 'Командирский рейдер', art: corsairArt, population: 8,
    cost: { metal: 12_000, minerals: 6_000, gas: 1_000 }, combat: { attack: 6_000, life: 18_000, weaponType: 'Лазер', armorType: 'Лёгкая броня', armorStrength: 5 }, category: 'Командирский корабль',
    tactical: { specialization: 'Рейд', range: 'Ближняя', priority: 'Лёгкий флот' }, construction: { time: '00:30:00', requiredShipyardLevel: 1, requirements: ['Верфь · уровень 1'] },
  },
  {
    id: 'hunter', kind: 'commander', name: 'Охотник', role: 'Командирский перехватчик', art: hunterArt, population: 10,
    cost: { metal: 16_000, minerals: 9_000, gas: 2_000 }, combat: { attack: 8_000, life: 22_000, weaponType: 'Лазер', armorType: 'Лёгкая броня', armorStrength: 5 }, category: 'Командирский корабль',
    tactical: { specialization: 'Перехват', range: 'Ближняя', priority: 'Быстрые цели' }, construction: { time: '00:40:00', requiredShipyardLevel: 2, requirements: ['Верфь · уровень 2', 'Астрономия · уровень 2'] },
  },
  {
    id: 'executioner', kind: 'commander', name: 'Палач', role: 'Командирский штурмовик', art: executionerArt, population: 14,
    cost: { metal: 22_000, minerals: 15_000, gas: 4_000 }, combat: { attack: 12_500, life: 32_000, weaponType: 'Ион', armorType: 'Средняя броня', armorStrength: 7 }, category: 'Командирский корабль',
    tactical: { specialization: 'Штурм', range: 'Средняя', priority: 'Крейсеры' }, construction: { time: '00:55:00', requiredShipyardLevel: 3, requirements: ['Верфь · уровень 3', 'Броня кораблей · уровень 3'] },
  },
  {
    id: 'juggernaut', kind: 'commander', name: 'Джаггернаут', role: 'Тяжёлый командирский корабль', art: juggernautArt, population: 20,
    cost: { metal: 34_000, minerals: 25_000, gas: 6_500 }, combat: { attack: 18_000, life: 55_000, weaponType: 'Ион', armorType: 'Тяжёлая броня', armorStrength: 10 }, category: 'Командирский корабль',
    tactical: { specialization: 'Прорыв', range: 'Средняя', priority: 'Тяжёлый флот' }, construction: { time: '01:20:00', requiredShipyardLevel: 4, requirements: ['Верфь · уровень 4', 'Тяжёлая броня · уровень 3'] },
  },
  {
    id: 'typhoon', kind: 'commander', name: 'Тайфун', role: 'Командирский ударный крейсер', art: typhoonArt, population: 26,
    cost: { metal: 45_000, minerals: 34_000, gas: 10_000 }, combat: { attack: 25_000, life: 68_000, weaponType: 'Плазма', armorType: 'Средняя броня', armorStrength: 8 }, category: 'Командирский корабль',
    tactical: { specialization: 'Ударный флот', range: 'Средняя', priority: 'Флот' }, construction: { time: '01:45:00', requiredShipyardLevel: 5, requirements: ['Верфь · уровень 5', 'Реактивные двигатели · уровень 4'] },
  },
  {
    id: 'viper', kind: 'commander', name: 'Вайпер', role: 'Командирский охотник', art: viperArt, population: 30,
    cost: { metal: 52_000, minerals: 38_000, gas: 12_000 }, combat: { attack: 31_000, life: 74_000, weaponType: 'Ион', armorType: 'Средняя броня', armorStrength: 8 }, category: 'Командирский корабль',
    tactical: { specialization: 'Охота', range: 'Дальняя', priority: 'Командиры' }, construction: { time: '02:00:00', requiredShipyardLevel: 6, requirements: ['Верфь · уровень 6', 'Ионная наука · уровень 5'] },
  },
  {
    id: 'phantom', kind: 'commander', name: 'Фантом', role: 'Командирский скрытный корабль', art: phantomArt, population: 35,
    cost: { metal: 66_000, minerals: 52_000, gas: 18_000 }, combat: { attack: 38_000, life: 82_000, weaponType: 'Лазер', armorType: 'Композитная броня', armorStrength: 9 }, category: 'Командирский корабль',
    tactical: { specialization: 'Скрытная атака', range: 'Дальняя', priority: 'Тыл' }, construction: { time: '02:30:00', requiredShipyardLevel: 7, requirements: ['Верфь · уровень 7', 'Шпионаж · уровень 6', 'Гиперпространство · уровень 3'] },
  },
  {
    id: 'scorpion', kind: 'commander', name: 'Скорпион', role: 'Командирский осадный корабль', art: scorpionArt, population: 42,
    cost: { metal: 82_000, minerals: 65_000, gas: 24_000 }, combat: { attack: 48_000, life: 105_000, weaponType: 'Плазма', armorType: 'Тяжёлая броня', armorStrength: 11 }, category: 'Командирский корабль',
    tactical: { specialization: 'Осада', range: 'Дальняя', priority: 'Оборона' }, construction: { time: '03:00:00', requiredShipyardLevel: 8, requirements: ['Верфь · уровень 8', 'Плазменная наука · уровень 6'] },
  },
  {
    id: 'annihilator', kind: 'commander', name: 'Аннигилятор', role: 'Командирский разрушитель', art: annihilatorArt, population: 55,
    cost: { metal: 105_000, minerals: 82_000, gas: 34_000 }, combat: { attack: 65_000, life: 135_000, weaponType: 'Плазма', armorType: 'Тяжёлая броня', armorStrength: 12 }, category: 'Командирский корабль',
    tactical: { specialization: 'Уничтожение флота', range: 'Дальняя', priority: 'Капитальные' }, construction: { time: '04:00:00', requiredShipyardLevel: 9, requirements: ['Верфь · уровень 9', 'Плазменная наука · уровень 8', 'Тяжёлая броня · уровень 6'] },
  },
  {
    id: 'reanimator', kind: 'commander', name: 'Реаниматор', role: 'Командирский корабль поддержки', art: reanimatorArt, population: 60,
    cost: { metal: 118_000, minerals: 96_000, gas: 40_000 }, combat: { attack: 42_000, life: 170_000, weaponType: 'Ион', armorType: 'Усиленная броня', armorStrength: 13 }, category: 'Командирский корабль',
    tactical: { specialization: 'Поддержка', range: 'Средняя', priority: 'Союзный флот' }, construction: { time: '04:30:00', requiredShipyardLevel: 10, requirements: ['Верфь · уровень 10', 'Энергетика · уровень 8', 'Нанотехнологии · уровень 5'] },
  },
  {
    id: 'argo', kind: 'commander', name: 'Арго', role: 'Командирский флагман', art: argoArt, population: 75,
    cost: { metal: 145_000, minerals: 120_000, gas: 52_000 }, combat: { attack: 78_000, life: 210_000, weaponType: 'Ион / Плазма', armorType: 'Флагманская броня', armorStrength: 14 }, category: 'Командирский корабль',
    tactical: { specialization: 'Командование', range: 'Дальняя', priority: 'Флот' }, construction: { time: '05:30:00', requiredShipyardLevel: 11, requirements: ['Верфь · уровень 11', 'Гиперпространство · уровень 7'] },
  },
  {
    id: 'judge', kind: 'commander', name: 'Судья', role: 'Командирский линкор', art: judgeArt, population: 90,
    cost: { metal: 180_000, minerals: 150_000, gas: 68_000 }, combat: { attack: 105_000, life: 270_000, weaponType: 'Плазма', armorType: 'Флагманская броня', armorStrength: 15 }, category: 'Командирский корабль',
    tactical: { specialization: 'Тяжёлый бой', range: 'Дальняя', priority: 'Капитальные' }, construction: { time: '07:00:00', requiredShipyardLevel: 12, requirements: ['Верфь · уровень 12', 'Тяжёлая броня · уровень 9', 'Плазменная наука · уровень 9'] },
  },
  {
    id: 'polias', kind: 'commander', name: 'Полиас', role: 'Верховный командирский корабль', art: poliasArt, population: 130,
    cost: { metal: 260_000, minerals: 220_000, gas: 110_000 }, combat: { attack: 165_000, life: 420_000, weaponType: 'Гибридное', armorType: 'Флагманская броня', armorStrength: 18 }, category: 'Командирский корабль',
    tactical: { specialization: 'Стратегическое превосходство', range: 'Дальняя', priority: 'Все цели' }, construction: { time: '10:00:00', requiredShipyardLevel: 14, requirements: ['Верфь · уровень 14', 'Гиперпространство · уровень 10', 'Параллельные вселенные · уровень 1'] },
  },
];

export const COMBAT_CATALOG: readonly CatalogEntity[] = [
  ...SHIP_COMBAT_CATALOG,
  ...DEFENSE_COMBAT_CATALOG,
  ...COMMANDER_COMBAT_CATALOG,
];

export const COMBAT_ENTITY_BY_ID = new Map<CombatEntityId, CatalogEntity>(
  COMBAT_CATALOG.map((entity) => [entity.id, entity]),
);

export function getCombatEntity<TId extends CombatEntityId>(id: TId): CatalogEntity<TId> {
  const entity = COMBAT_ENTITY_BY_ID.get(id);
  if (!entity) throw new Error(`Unknown combat entity: ${id}`);
  return entity as CatalogEntity<TId>;
}
