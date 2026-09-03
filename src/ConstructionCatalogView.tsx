import { useEffect, useMemo, useState } from 'react';

import ballisticTurretArt from '../assets/source/New assets/defenses/aegis/defense.aegis.ballistic-turret.png';
import laserTurretArt from '../assets/source/New assets/defenses/aegis/defense.aegis.laser-turret.png';
import ionTurretArt from '../assets/source/New assets/defenses/aegis/defense.aegis.ion-turret.png';
import plasmaTurretArt from '../assets/source/New assets/defenses/aegis/defense.aegis.plasma-turret.png';
import laserIonBatteryArt from '../assets/source/New assets/defenses/aegis/defense.aegis.laser-ion-battery.png';
import plasmaLaserBatteryArt from '../assets/source/New assets/defenses/aegis/defense.aegis.plasma-laser-battery.png';
import ionPlasmaBatteryArt from '../assets/source/New assets/defenses/aegis/defense.aegis.ion-plasma-battery.png';
import towerShieldArt from '../assets/source/New assets/defenses/aegis/defense.aegis.tower-shield.png';
import planetaryShieldArt from '../assets/source/New assets/defenses/aegis/defense.aegis.planetary-shield.png';

import corsairArt from '../assets/source/New assets/comander_ship/commander-ship.corsair.png';
import hunterArt from '../assets/source/New assets/comander_ship/commander-ship.hunter.png';
import executionerArt from '../assets/source/New assets/comander_ship/commander-ship.executioner.png';
import juggernautArt from '../assets/source/New assets/comander_ship/commander-ship.juggernaut.png';
import typhoonArt from '../assets/source/New assets/comander_ship/commander-ship.typhoon.png';
import viperArt from '../assets/source/New assets/comander_ship/commander-ship.viper.png';
import phantomArt from '../assets/source/New assets/comander_ship/commander-ship.phantom.png';
import scorpionArt from '../assets/source/New assets/comander_ship/commander-ship.scorpion.png';
import annihilatorArt from '../assets/source/New assets/comander_ship/commander-ship.annihilator.png';
import reanimatorArt from '../assets/source/New assets/comander_ship/commander-ship.reanimator.png';
import argoArt from '../assets/source/New assets/comander_ship/commander-ship.argo.png';
import judgeArt from '../assets/source/New assets/comander_ship/commander-ship.judge.png';
import poliasArt from '../assets/source/New assets/comander_ship/commander-ship.polias.png';

const SAVE_KEY = 'asterion.vertical-slice.v1';
const SHIPYARD_LEVEL = 1;

export type ConstructionCatalogMode = 'defense' | 'commander';

type CatalogItem = {
  id: string;
  name: string;
  role: string;
  art: string;
  owned: number;
  metal: number;
  minerals: number;
  gas: number;
  population: number;
  time: string;
  requiredShipyardLevel: number;
  requirements: string[];
  stats: {
    category: string;
    attack: number;
    life: number;
    weaponType: string;
    armorType: string;
    armorStrength: number;
    specialization: string;
    range: string;
    priority: string;
  };
};

type ShipyardBudget = {
  metal: number;
  minerals: number;
  gas: number;
  population: number;
  populationMax: number;
};

type StoredSave = {
  metal?: number;
  minerals?: number;
  gas?: number;
  planets?: Record<string, { population?: number; populationMax?: number }>;
};

type ResourceKind = 'metal' | 'minerals' | 'gas' | 'population';

const defenseItems: CatalogItem[] = [
  {
    id: 'ballistic-turret', name: 'Баллистическая турель', role: 'Базовая оборонная установка', art: ballisticTurretArt, owned: 0,
    metal: 2_500, minerals: 1_000, gas: 0, population: 1, time: '00:04:00', requiredShipyardLevel: 1,
    requirements: ['Верфь · уровень 1'],
    stats: { category: 'Оборона Aegis', attack: 900, life: 4_000, weaponType: 'Кинетика', armorType: 'Лёгкая броня', armorStrength: 4, specialization: 'Лёгкие цели', range: 'Орбита', priority: 'Перехват' },
  },
  {
    id: 'laser-turret', name: 'Лазерная турель', role: 'Лазерная оборонная установка', art: laserTurretArt, owned: 0,
    metal: 2_000, minerals: 2_500, gas: 0, population: 1, time: '00:05:00', requiredShipyardLevel: 2,
    requirements: ['Верфь · уровень 2', 'Лазерная наука · уровень 2'],
    stats: { category: 'Оборона Aegis', attack: 1_250, life: 4_800, weaponType: 'Лазер', armorType: 'Лёгкая броня', armorStrength: 4, specialization: 'Универсальная', range: 'Орбита', priority: 'Флот' },
  },
  {
    id: 'ion-turret', name: 'Ионная турель', role: 'Ионная оборонная установка', art: ionTurretArt, owned: 0,
    metal: 3_500, minerals: 4_500, gas: 500, population: 2, time: '00:08:00', requiredShipyardLevel: 3,
    requirements: ['Верфь · уровень 3', 'Ионная наука · уровень 2'],
    stats: { category: 'Оборона Aegis', attack: 2_300, life: 7_000, weaponType: 'Ион', armorType: 'Средняя броня', armorStrength: 6, specialization: 'Щиты и броня', range: 'Орбита', priority: 'Крейсеры' },
  },
  {
    id: 'plasma-turret', name: 'Плазменная турель', role: 'Плазменная оборонная установка', art: plasmaTurretArt, owned: 0,
    metal: 6_000, minerals: 7_500, gas: 2_000, population: 3, time: '00:12:00', requiredShipyardLevel: 4,
    requirements: ['Верфь · уровень 4', 'Плазменная наука · уровень 2'],
    stats: { category: 'Оборона Aegis', attack: 4_500, life: 10_500, weaponType: 'Плазма', armorType: 'Средняя броня', armorStrength: 6, specialization: 'Тяжёлые цели', range: 'Дальняя орбита', priority: 'Линкоры' },
  },
  {
    id: 'laser-ion-battery', name: 'Лазер-ионная батарея', role: 'Комбинированная батарея', art: laserIonBatteryArt, owned: 0,
    metal: 9_500, minerals: 12_000, gas: 2_500, population: 5, time: '00:20:00', requiredShipyardLevel: 6,
    requirements: ['Верфь · уровень 6', 'Лазерная наука · уровень 5', 'Ионная наука · уровень 4'],
    stats: { category: 'Оборона Aegis', attack: 8_200, life: 18_000, weaponType: 'Лазер / Ион', armorType: 'Средняя броня', armorStrength: 7, specialization: 'Универсальная', range: 'Дальняя орбита', priority: 'Флот' },
  },
  {
    id: 'plasma-laser-battery', name: 'Плазма-лазерная батарея', role: 'Тяжёлая комбинированная батарея', art: plasmaLaserBatteryArt, owned: 0,
    metal: 18_000, minerals: 22_000, gas: 6_000, population: 8, time: '00:32:00', requiredShipyardLevel: 8,
    requirements: ['Верфь · уровень 8', 'Плазменная наука · уровень 5', 'Лазерная наука · уровень 7'],
    stats: { category: 'Оборона Aegis', attack: 14_500, life: 29_000, weaponType: 'Плазма / Лазер', armorType: 'Тяжёлая броня', armorStrength: 9, specialization: 'Тяжёлые корабли', range: 'Дальняя орбита', priority: 'Линкоры' },
  },
  {
    id: 'ion-plasma-battery', name: 'Ион-плазменная батарея', role: 'Штурмовая оборонная батарея', art: ionPlasmaBatteryArt, owned: 0,
    metal: 26_000, minerals: 31_000, gas: 10_000, population: 12, time: '00:45:00', requiredShipyardLevel: 9,
    requirements: ['Верфь · уровень 9', 'Ионная наука · уровень 7', 'Плазменная наука · уровень 6'],
    stats: { category: 'Оборона Aegis', attack: 22_000, life: 42_000, weaponType: 'Ион / Плазма', armorType: 'Тяжёлая броня', armorStrength: 10, specialization: 'Капитальные цели', range: 'Дальняя орбита', priority: 'Капитальные' },
  },
  {
    id: 'tower-shield', name: 'Башенный щит', role: 'Локальный генератор защиты', art: towerShieldArt, owned: 0,
    metal: 34_000, minerals: 40_000, gas: 14_000, population: 14, time: '01:00:00', requiredShipyardLevel: 10,
    requirements: ['Верфь · уровень 10', 'Щитовые системы · уровень 7'],
    stats: { category: 'Оборона Aegis', attack: 1_000, life: 85_000, weaponType: 'Импульс', armorType: 'Щитовое поле', armorStrength: 14, specialization: 'Прикрытие обороны', range: 'Локальная', priority: 'Защита' },
  },
  {
    id: 'planetary-shield', name: 'Планетарный щит', role: 'Стратегический планетарный комплекс', art: planetaryShieldArt, owned: 0,
    metal: 90_000, minerals: 110_000, gas: 45_000, population: 30, time: '03:00:00', requiredShipyardLevel: 12,
    requirements: ['Верфь · уровень 12', 'Щитовые системы · уровень 10', 'Энергетика · уровень 10'],
    stats: { category: 'Оборона Aegis', attack: 4_000, life: 250_000, weaponType: 'Импульс', armorType: 'Планетарный щит', armorStrength: 18, specialization: 'Планетарная защита', range: 'Планета', priority: 'Защита' },
  },
];

const commanderItems: CatalogItem[] = [
  {
    id: 'corsair', name: 'Корсар', role: 'Командирский рейдер', art: corsairArt, owned: 0,
    metal: 12_000, minerals: 6_000, gas: 1_000, population: 8, time: '00:30:00', requiredShipyardLevel: 1,
    requirements: ['Верфь · уровень 1'],
    stats: { category: 'Командирский корабль', attack: 6_000, life: 18_000, weaponType: 'Лазер', armorType: 'Лёгкая броня', armorStrength: 5, specialization: 'Рейд', range: 'Ближняя', priority: 'Лёгкий флот' },
  },
  {
    id: 'hunter', name: 'Охотник', role: 'Командирский перехватчик', art: hunterArt, owned: 0,
    metal: 16_000, minerals: 9_000, gas: 2_000, population: 10, time: '00:40:00', requiredShipyardLevel: 2,
    requirements: ['Верфь · уровень 2', 'Астрономия · уровень 2'],
    stats: { category: 'Командирский корабль', attack: 8_000, life: 22_000, weaponType: 'Лазер', armorType: 'Лёгкая броня', armorStrength: 5, specialization: 'Перехват', range: 'Ближняя', priority: 'Быстрые цели' },
  },
  {
    id: 'executioner', name: 'Палач', role: 'Командирский штурмовик', art: executionerArt, owned: 0,
    metal: 22_000, minerals: 15_000, gas: 4_000, population: 14, time: '00:55:00', requiredShipyardLevel: 3,
    requirements: ['Верфь · уровень 3', 'Броня кораблей · уровень 3'],
    stats: { category: 'Командирский корабль', attack: 12_500, life: 32_000, weaponType: 'Ион', armorType: 'Средняя броня', armorStrength: 7, specialization: 'Штурм', range: 'Средняя', priority: 'Крейсеры' },
  },
  {
    id: 'juggernaut', name: 'Джаггернаут', role: 'Тяжёлый командирский корабль', art: juggernautArt, owned: 0,
    metal: 34_000, minerals: 25_000, gas: 6_500, population: 20, time: '01:20:00', requiredShipyardLevel: 4,
    requirements: ['Верфь · уровень 4', 'Тяжёлая броня · уровень 3'],
    stats: { category: 'Командирский корабль', attack: 18_000, life: 55_000, weaponType: 'Ион', armorType: 'Тяжёлая броня', armorStrength: 10, specialization: 'Прорыв', range: 'Средняя', priority: 'Тяжёлый флот' },
  },
  {
    id: 'typhoon', name: 'Тайфун', role: 'Командирский ударный крейсер', art: typhoonArt, owned: 0,
    metal: 45_000, minerals: 34_000, gas: 10_000, population: 26, time: '01:45:00', requiredShipyardLevel: 5,
    requirements: ['Верфь · уровень 5', 'Реактивные двигатели · уровень 4'],
    stats: { category: 'Командирский корабль', attack: 25_000, life: 68_000, weaponType: 'Плазма', armorType: 'Средняя броня', armorStrength: 8, specialization: 'Ударный флот', range: 'Средняя', priority: 'Флот' },
  },
  {
    id: 'viper', name: 'Вайпер', role: 'Командирский охотник', art: viperArt, owned: 0,
    metal: 52_000, minerals: 38_000, gas: 12_000, population: 30, time: '02:00:00', requiredShipyardLevel: 6,
    requirements: ['Верфь · уровень 6', 'Ионная наука · уровень 5'],
    stats: { category: 'Командирский корабль', attack: 31_000, life: 74_000, weaponType: 'Ион', armorType: 'Средняя броня', armorStrength: 8, specialization: 'Охота', range: 'Дальняя', priority: 'Командиры' },
  },
  {
    id: 'phantom', name: 'Фантом', role: 'Командирский скрытный корабль', art: phantomArt, owned: 0,
    metal: 66_000, minerals: 52_000, gas: 18_000, population: 35, time: '02:30:00', requiredShipyardLevel: 7,
    requirements: ['Верфь · уровень 7', 'Шпионаж · уровень 6', 'Гиперпространство · уровень 3'],
    stats: { category: 'Командирский корабль', attack: 38_000, life: 82_000, weaponType: 'Лазер', armorType: 'Композитная броня', armorStrength: 9, specialization: 'Скрытная атака', range: 'Дальняя', priority: 'Тыл' },
  },
  {
    id: 'scorpion', name: 'Скорпион', role: 'Командирский осадный корабль', art: scorpionArt, owned: 0,
    metal: 82_000, minerals: 65_000, gas: 24_000, population: 42, time: '03:00:00', requiredShipyardLevel: 8,
    requirements: ['Верфь · уровень 8', 'Плазменная наука · уровень 6'],
    stats: { category: 'Командирский корабль', attack: 48_000, life: 105_000, weaponType: 'Плазма', armorType: 'Тяжёлая броня', armorStrength: 11, specialization: 'Осада', range: 'Дальняя', priority: 'Оборона' },
  },
  {
    id: 'annihilator', name: 'Аннигилятор', role: 'Командирский разрушитель', art: annihilatorArt, owned: 0,
    metal: 105_000, minerals: 82_000, gas: 34_000, population: 55, time: '04:00:00', requiredShipyardLevel: 9,
    requirements: ['Верфь · уровень 9', 'Плазменная наука · уровень 8', 'Тяжёлая броня · уровень 6'],
    stats: { category: 'Командирский корабль', attack: 65_000, life: 135_000, weaponType: 'Плазма', armorType: 'Тяжёлая броня', armorStrength: 12, specialization: 'Уничтожение флота', range: 'Дальняя', priority: 'Капитальные' },
  },
  {
    id: 'reanimator', name: 'Реаниматор', role: 'Командирский корабль поддержки', art: reanimatorArt, owned: 0,
    metal: 118_000, minerals: 96_000, gas: 40_000, population: 60, time: '04:30:00', requiredShipyardLevel: 10,
    requirements: ['Верфь · уровень 10', 'Энергетика · уровень 8', 'Нанотехнологии · уровень 5'],
    stats: { category: 'Командирский корабль', attack: 42_000, life: 170_000, weaponType: 'Ион', armorType: 'Усиленная броня', armorStrength: 13, specialization: 'Поддержка', range: 'Средняя', priority: 'Союзный флот' },
  },
  {
    id: 'argo', name: 'Арго', role: 'Командирский флагман', art: argoArt, owned: 0,
    metal: 145_000, minerals: 120_000, gas: 52_000, population: 75, time: '05:30:00', requiredShipyardLevel: 11,
    requirements: ['Верфь · уровень 11', 'Гиперпространство · уровень 7'],
    stats: { category: 'Командирский корабль', attack: 78_000, life: 210_000, weaponType: 'Ион / Плазма', armorType: 'Флагманская броня', armorStrength: 14, specialization: 'Командование', range: 'Дальняя', priority: 'Флот' },
  },
  {
    id: 'judge', name: 'Судья', role: 'Командирский линкор', art: judgeArt, owned: 0,
    metal: 180_000, minerals: 150_000, gas: 68_000, population: 90, time: '07:00:00', requiredShipyardLevel: 12,
    requirements: ['Верфь · уровень 12', 'Тяжёлая броня · уровень 9', 'Плазменная наука · уровень 9'],
    stats: { category: 'Командирский корабль', attack: 105_000, life: 270_000, weaponType: 'Плазма', armorType: 'Флагманская броня', armorStrength: 15, specialization: 'Тяжёлый бой', range: 'Дальняя', priority: 'Капитальные' },
  },
  {
    id: 'polias', name: 'Полиас', role: 'Верховный командирский корабль', art: poliasArt, owned: 0,
    metal: 260_000, minerals: 220_000, gas: 110_000, population: 130, time: '10:00:00', requiredShipyardLevel: 14,
    requirements: ['Верфь · уровень 14', 'Гиперпространство · уровень 10', 'Параллельные вселенные · уровень 1'],
    stats: { category: 'Командирский корабль', attack: 165_000, life: 420_000, weaponType: 'Гибридное', armorType: 'Флагманская броня', armorStrength: 18, specialization: 'Стратегическое превосходство', range: 'Дальняя', priority: 'Все цели' },
  },
];

const catalogConfig: Record<ConstructionCatalogMode, { title: string; kicker: string; description: string; footer: string; items: CatalogItem[]; unitLabel: string }> = {
  defense: {
    title: 'ОБОРОНА',
    kicker: 'ПЛАНЕТАРНАЯ ОБОРОНА AEGIS',
    description: 'оборонные установки и щитовые комплексы Aegis',
    footer: '9 оборонных комплексов Aegis · порядок соответствует технологической линейке.',
    items: defenseItems,
    unitLabel: 'установок',
  },
  commander: {
    title: 'КОМАНДИРСКИЕ КОРАБЛИ',
    kicker: 'КОМАНДНЫЙ ФЛОТ',
    description: '13 уникальных командирских корпусов',
    footer: '13 командирских кораблей · единая линейка для всех рас.',
    items: commanderItems,
    unitLabel: 'кораблей',
  },
};

const formatNumber = (value: number) => new Intl.NumberFormat('ru-RU').format(value);

function readBudget(): ShipyardBudget {
  const fallback: ShipyardBudget = { metal: 15_880, minerals: 12_712, gas: 6_421, population: 20, populationMax: 70 };

  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as StoredSave;
    const homeworld = parsed.planets?.['helion-01'];
    return {
      metal: typeof parsed.metal === 'number' ? parsed.metal : fallback.metal,
      minerals: typeof parsed.minerals === 'number' ? parsed.minerals : fallback.minerals,
      gas: typeof parsed.gas === 'number' ? parsed.gas : fallback.gas,
      population: typeof homeworld?.population === 'number' ? homeworld.population : fallback.population,
      populationMax: typeof homeworld?.populationMax === 'number' ? homeworld.populationMax : fallback.populationMax,
    };
  } catch {
    return fallback;
  }
}

function calculateMax(item: CatalogItem, budget: ShipyardBudget) {
  const limits: number[] = [];
  if (item.metal > 0) limits.push(Math.floor(budget.metal / item.metal));
  if (item.minerals > 0) limits.push(Math.floor(budget.minerals / item.minerals));
  if (item.gas > 0) limits.push(Math.floor(budget.gas / item.gas));
  if (item.population > 0) limits.push(Math.floor(Math.max(0, budget.populationMax - budget.population) / item.population));
  return Math.max(0, Math.min(999, ...(limits.length ? limits : [0])));
}

function ResourceIcon({ kind }: { kind: ResourceKind }) {
  if (kind === 'metal') {
    return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6.2 5.2h11.6l3 5.8-4.1 7.8H7.3L3.2 11l3-5.8Z"/><path d="m7.4 8.2 4.6-2 4.6 2-1.2 6.9H8.6L7.4 8.2Z"/></svg>;
  }
  if (kind === 'minerals') {
    return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 2.8 7.7 7.4-3.1 10.9H7.4L4.3 10.2 12 2.8Z"/><path d="m12 6.1 3.7 4.6-3.7 7.1-3.7-7.1L12 6.1Z"/></svg>;
  }
  if (kind === 'gas') {
    return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.8c3.8 4.5 6.3 7.9 6.3 11.6A6.3 6.3 0 1 1 5.7 14.4C5.7 10.7 8.2 7.3 12 2.8Z"/><circle cx="10" cy="14.2" r="1.3"/><circle cx="14.5" cy="11.6" r="1"/></svg>;
  }
  return <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="9" cy="8" r="3"/><circle cx="16.3" cy="9.4" r="2.4"/><path d="M3.8 19c.4-4 2.1-6.1 5.2-6.1s4.8 2.1 5.2 6.1H3.8Z"/><path d="M13 18.7c.3-3 1.5-4.6 3.7-4.6 2.1 0 3.3 1.6 3.6 4.6H13Z"/></svg>;
}

function CostRow({ kind, label, value }: { kind: ResourceKind; label: string; value: number }) {
  return (
    <div className={`shipyard-cost-row-v1 ${kind}`}>
      <span className="shipyard-cost-icon-v1"><ResourceIcon kind={kind} /></span>
      <span className="shipyard-cost-copy-v1"><small>{label}</small><strong>{formatNumber(value)}</strong></span>
    </div>
  );
}

function CatalogStatsTooltip({ item }: { item: CatalogItem }) {
  const { stats } = item;
  return (
    <div className="shipyard-stats-tooltip-v1" role="tooltip">
      <header className="shipyard-tooltip-head-v1">
        <div><small>{stats.category}</small><strong>{item.name}</strong></div>
        <span>ТТХ</span>
      </header>

      <div className="shipyard-tooltip-primary-v1">
        <div><small>АТАКА</small><strong>{formatNumber(stats.attack)}</strong></div>
        <div><small>ЖИЗНЬ</small><strong>{formatNumber(stats.life)}</strong></div>
      </div>

      <div className="shipyard-tooltip-grid-v1">
        <div><small>Тип оружия</small><strong>{stats.weaponType}</strong></div>
        <div><small>Тип брони</small><strong>{stats.armorType}</strong></div>
        <div><small>Сила брони</small><strong>{stats.armorStrength}%</strong></div>
        <div><small>Специализация</small><strong>{stats.specialization}</strong></div>
        <div><small>Дистанция</small><strong>{stats.range}</strong></div>
        <div><small>Приоритет</small><strong>{stats.priority}</strong></div>
      </div>
    </div>
  );
}

function CatalogCard({
  item,
  quantity,
  budget,
  mode,
  onQuantity,
  onBuild,
}: {
  item: CatalogItem;
  quantity: number;
  budget: ShipyardBudget;
  mode: ConstructionCatalogMode;
  onQuantity: (item: CatalogItem, quantity: number) => void;
  onBuild: (item: CatalogItem, quantity: number) => void;
}) {
  const unlocked = item.requiredShipyardLevel <= SHIPYARD_LEVEL;
  const max = unlocked ? calculateMax(item, budget) : 0;
  const unavailableLabel = mode === 'defense' ? 'КОМПЛЕКС НЕДОСТУПЕН' : 'КОРПУС НЕДОСТУПЕН';

  return (
    <article className={`shipyard-card-v1 ${unlocked ? '' : 'locked'}`}>
      <header className="shipyard-card-title-v1">
        <div className={`shipyard-owned-v1 ${item.owned > 0 ? 'has-ships' : ''}`}>
          <small>{mode === 'defense' ? 'ПОСТРОЕНО' : 'В СТРОЮ'}</small>
          <strong>{formatNumber(item.owned)}</strong>
        </div>
        <div className="shipyard-title-copy-v1"><strong>{item.name}</strong><small>{item.role}</small></div>
        <button type="button" title={item.role} aria-label={`Информация: ${item.name}`}>i</button>
      </header>

      <div className="shipyard-card-body-v1">
        <div className="shipyard-art-v1">
          <div className="shipyard-art-hover-v1" aria-label={`Характеристики: ${item.name}`}>
            <img src={item.art} alt={item.name} draggable={false} />
            <CatalogStatsTooltip item={item} />
          </div>
          <div className="shipyard-time-v1"><small>ВРЕМЯ ЗА ЕДИНИЦУ</small><b>{item.time}</b></div>
        </div>

        <div className="shipyard-card-data-v1">
          <div className="shipyard-costs-v1">
            <div className="shipyard-costs-title-v1"><span>СТОИМОСТЬ ЕДИНИЦЫ</span><i /></div>
            <div className="shipyard-cost-grid-v1">
              <CostRow kind="metal" label="Металл" value={item.metal} />
              <CostRow kind="minerals" label="Минералы" value={item.minerals} />
              <CostRow kind="gas" label="Газ" value={item.gas} />
              <CostRow kind="population" label="Население" value={item.population} />
            </div>
          </div>

          {unlocked ? (
            <div className="shipyard-build-v1">
              <div className="shipyard-count-v1">
                <input
                  type="number"
                  min="0"
                  max={max}
                  value={quantity}
                  aria-label={`Количество: ${item.name}`}
                  onChange={(event) => onQuantity(item, Number(event.target.value))}
                />
                <button type="button" onClick={() => onQuantity(item, max)}>Макс. {max}</button>
                <button type="button" onClick={() => onQuantity(item, 0)}>Мин.</button>
              </div>
              <button className="shipyard-build-button-v1" type="button" disabled={quantity <= 0 || max <= 0} onClick={() => onBuild(item, quantity)}>
                В ПРОИЗВОДСТВО
              </button>
            </div>
          ) : (
            <div className="shipyard-requirements-v1">
              <div className="shipyard-requirements-head-v1">
                <span className="shipyard-lock-v1" aria-hidden="true">◆</span>
                <div><small>{unavailableLabel}</small><strong>Требования для постройки</strong></div>
              </div>
              <div className="shipyard-requirements-list-v1">
                {item.requirements.map((requirement) => <span key={requirement}>{requirement}</span>)}
              </div>
            </div>
          )}
        </div>
      </div>
    </article>
  );
}

export function ConstructionCatalogView({
  mode,
  planetName,
  coords,
  onBack,
}: {
  mode: ConstructionCatalogMode;
  planetName: string;
  coords: string;
  onBack: () => void;
}) {
  const budget = useMemo(readBudget, []);
  const config = catalogConfig[mode];
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [process, setProcess] = useState<string | null>(null);

  useEffect(() => {
    document.documentElement.classList.add('asterion-long-page');
    window.scrollTo(0, 0);
    return () => {
      document.documentElement.classList.remove('asterion-long-page');
      window.scrollTo(0, 0);
    };
  }, []);

  useEffect(() => {
    setQuantities({});
    setProcess(null);
    window.scrollTo(0, 0);
  }, [mode]);

  const setQuantity = (item: CatalogItem, raw: number) => {
    const max = calculateMax(item, budget);
    const next = Number.isFinite(raw) ? Math.max(0, Math.min(max, Math.floor(raw))) : 0;
    setQuantities((current) => ({ ...current, [item.id]: next }));
  };

  const prepareBuild = (item: CatalogItem, quantity: number) => {
    setProcess(`${quantity} × ${item.name} подготовлено к постановке в очередь. Реальное списание ресурсов подключим вместе с системой производства.`);
  };

  return (
    <section className="shipyard-view-v1">
      <header className="shipyard-page-head-v1">
        <div>
          <small>{config.kicker} · ВЕРФЬ УРОВНЯ {SHIPYARD_LEVEL}</small>
          <h2>{config.title}</h2>
          <p>{planetName} {coords} · {config.description}</p>
        </div>
        <button type="button" onClick={onBack}>← К ФЛОТАМ</button>
      </header>

      <section className="shipyard-processes-v1">
        <strong>ТЕКУЩИЕ ПРОЦЕССЫ</strong>
        <span>{process ?? 'Очередь производства пуста.'}</span>
      </section>

      <div className="shipyard-grid-v1">
        {config.items.map((item) => (
          <CatalogCard
            key={item.id}
            item={item}
            quantity={quantities[item.id] ?? 0}
            budget={budget}
            mode={mode}
            onQuantity={setQuantity}
            onBuild={prepareBuild}
          />
        ))}
      </div>

      <footer className="shipyard-page-foot-v1">
        <span>{config.footer}</span>
        <span>Свободно населения: {Math.max(0, budget.populationMax - budget.population)} / {budget.populationMax}</span>
      </footer>
    </section>
  );
}
