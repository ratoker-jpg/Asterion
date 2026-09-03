import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import aegisScoutArt from '../assets/source/New assets/ship/aegis/ship.aegis.scout.png';
import aegisCruiserArt from '../assets/source/New assets/ship/aegis/ship.aegis.cruiser.png';
import aegisDefenderArt from '../assets/source/New assets/ship/aegis/ship.aegis.defender.png';
import aegisBattleshipArt from '../assets/source/New assets/ship/aegis/ship.aegis.battleship.png';
import aegisDestroyerArt from '../assets/source/New assets/ship/aegis/ship.aegis.destroyer.png';
import aegisBomberArt from '../assets/source/New assets/ship/aegis/ship.aegis.bomber.png';
import aegisDeathStarArt from '../assets/source/New assets/ship/aegis/ship.aegis.death-star.png';
import synodFighterArt from '../assets/source/New assets/ship/synod/ship.synod.fighter.png';
import synodInterceptorArt from '../assets/source/New assets/ship/synod/ship.synod.interceptor.png';
import synodShieldBotArt from '../assets/source/New assets/ship/synod/ship.synod.shield-bot.png';
import synodStarArmadaArt from '../assets/source/New assets/ship/synod/ship.synod.star-armada.png';
import synodGoliathArt from '../assets/source/New assets/ship/synod/ship.synod.goliath.png';
import synodBomberArt from '../assets/source/New assets/ship/synod/ship.synod.bomberbot.png';
import synodTitanArt from '../assets/source/New assets/ship/synod/ship.synod.titan.png';
import veyraNoxDartArt from '../assets/source/New assets/ship/veyra/ship.veyra.nox-dart.png';
import veyraNemesisArt from '../assets/source/New assets/ship/veyra/ship.veyra.nemesis.png';
import veyraAbsorberArt from '../assets/source/New assets/ship/veyra/ship.veyra.absorber.png';
import veyraGhostArt from '../assets/source/New assets/ship/veyra/ship.veyra.ghost.png';
import veyraHornetArt from '../assets/source/New assets/ship/veyra/ship.veyra.hornet.png';
import veyraBomberArt from '../assets/source/New assets/ship/veyra/ship.veyra.bomber.png';
import veyraQueenArt from '../assets/source/New assets/ship/veyra/ship.veyra.nox-queen.png';

import aegisBallisticDefenseArt from '../assets/source/New assets/defenses/aegis/defense.aegis.ballistic-turret.png';
import aegisLaserDefenseArt from '../assets/source/New assets/defenses/aegis/defense.aegis.laser-turret.png';
import aegisIonDefenseArt from '../assets/source/New assets/defenses/aegis/defense.aegis.ion-turret.png';
import aegisPlasmaDefenseArt from '../assets/source/New assets/defenses/aegis/defense.aegis.plasma-turret.png';
import aegisLaserIonDefenseArt from '../assets/source/New assets/defenses/aegis/defense.aegis.laser-ion-battery.png';
import aegisPlasmaLaserDefenseArt from '../assets/source/New assets/defenses/aegis/defense.aegis.plasma-laser-battery.png';
import aegisIonPlasmaDefenseArt from '../assets/source/New assets/defenses/aegis/defense.aegis.ion-plasma-battery.png';
import synodBallisticDefenseArt from '../assets/source/New assets/defenses/synod/defense.synod.defense-matrix.png';
import synodLaserDefenseArt from '../assets/source/New assets/defenses/synod/defense.synod.laser-matrix.png';
import synodIonDefenseArt from '../assets/source/New assets/defenses/synod/defense.synod.ion-matrix.png';
import synodPlasmaDefenseArt from '../assets/source/New assets/defenses/synod/defense.synod.plasma-matrix.png';
import synodLaserIonDefenseArt from '../assets/source/New assets/defenses/synod/defense.synod.laser-ion-matrix.png';
import synodPlasmaLaserDefenseArt from '../assets/source/New assets/defenses/synod/defense.synod.plasma-laser-matrix.png';
import synodIonPlasmaDefenseArt from '../assets/source/New assets/defenses/synod/defense.synod.ion-plasma-matrix.png';
import veyraBallisticDefenseArt from '../assets/source/New assets/defenses/veyra/defense.veyra.nox-archer.png';
import veyraLaserDefenseArt from '../assets/source/New assets/defenses/veyra/defense.veyra.laser-matter.png';
import veyraIonDefenseArt from '../assets/source/New assets/defenses/veyra/defense.veyra.ion-weave.png';
import veyraPlasmaDefenseArt from '../assets/source/New assets/defenses/veyra/defense.veyra.plasma-weave.png';
import veyraLaserIonDefenseArt from '../assets/source/New assets/defenses/veyra/defense.veyra.laser-ion-turret.png';
import veyraPlasmaLaserDefenseArt from '../assets/source/New assets/defenses/veyra/defense.veyra.plasma-laser-turret.png';
import veyraIonPlasmaDefenseArt from '../assets/source/New assets/defenses/veyra/defense.veyra.ion-plasma-turret.png';

import './ship-info-modal.css';

type ShipInfoKind = 'ship' | 'commander';
type ShipInfoFaction = 'Aegis' | 'Synod' | 'Veyra' | 'Общий флот';
type TargetType = 'Корабль' | 'Оборона';

type ShipTarget = {
  name: string;
  faction: Exclude<ShipInfoFaction, 'Общий флот'>;
  art: string;
  type?: TargetType;
};

type ShipAbility = {
  name: string;
  description: string;
  scaling?: string;
  note?: string;
  source?: 'NEMEXIA' | 'ASTERION';
};

type DamageTargets = {
  label: string;
  targets: ShipTarget[];
};

type ShipInfoDefinition = {
  kind: ShipInfoKind;
  ability: ShipAbility;
  priorityTargets?: ShipTarget[];
  bonusDamage?: DamageTargets;
  penaltyDamage?: DamageTargets;
  targetsNote?: string;
};

type StatPair = {
  label: string;
  value: string;
};

type OpenShipInfo = {
  name: string;
  role: string;
  category: string;
  faction: ShipInfoFaction;
  art: string;
  stats: StatPair[];
  definition: ShipInfoDefinition;
};

const shipTarget = (
  name: string,
  faction: Exclude<ShipInfoFaction, 'Общий флот'>,
  art: string,
): ShipTarget => ({ name, faction, art, type: 'Корабль' });

const defenseTarget = (
  name: string,
  faction: Exclude<ShipInfoFaction, 'Общий флот'>,
  art: string,
): ShipTarget => ({ name, faction, art, type: 'Оборона' });

const combineTargets = (...groups: ShipTarget[][]) => groups.flat();

const scoutTargets: ShipTarget[] = [
  shipTarget('Скаут «Вектор»', 'Aegis', aegisScoutArt),
  shipTarget('Истребитель «Ланцет»', 'Synod', synodFighterArt),
  shipTarget('Нокс Дарт «Жало»', 'Veyra', veyraNoxDartArt),
];

const cruiserTargets: ShipTarget[] = [
  shipTarget('Крейсер «Копьё»', 'Aegis', aegisCruiserArt),
  shipTarget('Перехватчик «Фаза»', 'Synod', synodInterceptorArt),
  shipTarget('Немезис «Стрекоза»', 'Veyra', veyraNemesisArt),
];

const defenderTargets: ShipTarget[] = [
  shipTarget('Защитник «Эгида»', 'Aegis', aegisDefenderArt),
  shipTarget('Щитовой бот «Оберег»', 'Synod', synodShieldBotArt),
  shipTarget('Абсорбатор «Завеса»', 'Veyra', veyraAbsorberArt),
];

const battleshipTargets: ShipTarget[] = [
  shipTarget('Линкор «Бастион»', 'Aegis', aegisBattleshipArt),
  shipTarget('Линкор «Армада»', 'Synod', synodStarArmadaArt),
  shipTarget('Призрак «Манта»', 'Veyra', veyraGhostArt),
];

const destroyerTargets: ShipTarget[] = [
  shipTarget('Разрушитель «Цитадель»', 'Aegis', aegisDestroyerArt),
  shipTarget('Голиаф «Резонанс»', 'Synod', synodGoliathArt),
  shipTarget('Шмель «Левиафан»', 'Veyra', veyraHornetArt),
];

const bomberTargets: ShipTarget[] = [
  shipTarget('Бомбардировщик «Молот»', 'Aegis', aegisBomberArt),
  shipTarget('Бомбербот «Дуга»', 'Synod', synodBomberArt),
  shipTarget('Бомбардировщик «Спора»', 'Veyra', veyraBomberArt),
];

const planetDestroyerTargets: ShipTarget[] = [
  shipTarget('Планетолом «Немезида»', 'Aegis', aegisDeathStarArt),
  shipTarget('Титан «Оракул»', 'Synod', synodTitanArt),
  shipTarget('Нокс Царица «Матка»', 'Veyra', veyraQueenArt),
];

const ballisticDefenses: ShipTarget[] = [
  defenseTarget('Баллистическая турель', 'Aegis', aegisBallisticDefenseArt),
  defenseTarget('Матрица обороны', 'Synod', synodBallisticDefenseArt),
  defenseTarget('Стрелок Нокса', 'Veyra', veyraBallisticDefenseArt),
];

const laserDefenses: ShipTarget[] = [
  defenseTarget('Лазерная турель', 'Aegis', aegisLaserDefenseArt),
  defenseTarget('Лазерная матрица', 'Synod', synodLaserDefenseArt),
  defenseTarget('Лазерная материя', 'Veyra', veyraLaserDefenseArt),
];

const ionDefenses: ShipTarget[] = [
  defenseTarget('Ионная турель', 'Aegis', aegisIonDefenseArt),
  defenseTarget('Ионная матрица', 'Synod', synodIonDefenseArt),
  defenseTarget('Ионное плетение', 'Veyra', veyraIonDefenseArt),
];

const plasmaDefenses: ShipTarget[] = [
  defenseTarget('Плазменная турель', 'Aegis', aegisPlasmaDefenseArt),
  defenseTarget('Плазменная матрица', 'Synod', synodPlasmaDefenseArt),
  defenseTarget('Плазменное плетение', 'Veyra', veyraPlasmaDefenseArt),
];

const laserIonDefenses: ShipTarget[] = [
  defenseTarget('Лазер-ионная батарея', 'Aegis', aegisLaserIonDefenseArt),
  defenseTarget('Лазерно-ионная матрица', 'Synod', synodLaserIonDefenseArt),
  defenseTarget('Лазерно-ионная турель', 'Veyra', veyraLaserIonDefenseArt),
];

const plasmaLaserDefenses: ShipTarget[] = [
  defenseTarget('Плазма-лазерная батарея', 'Aegis', aegisPlasmaLaserDefenseArt),
  defenseTarget('Плазменно-лазерная матрица', 'Synod', synodPlasmaLaserDefenseArt),
  defenseTarget('Плазменно-лазерная турель', 'Veyra', veyraPlasmaLaserDefenseArt),
];

const ionPlasmaDefenses: ShipTarget[] = [
  defenseTarget('Ион-плазменная батарея', 'Aegis', aegisIonPlasmaDefenseArt),
  defenseTarget('Ионно-плазменная матрица', 'Synod', synodIonPlasmaDefenseArt),
  defenseTarget('Ионно-плазменная турель', 'Veyra', veyraIonPlasmaDefenseArt),
];

const nemexiaCombatNote =
  'Приоритеты, +70% и −30% полностью сверены по сохранённым страницам синей расы Nemexia. Названия и изображения целей сопоставлены с кораблями и обороной Asterion.';

function combatShip(
  ability: ShipAbility,
  priorityTargets: ShipTarget[],
  bonusTargets: ShipTarget[],
  penaltyTargets: ShipTarget[],
): ShipInfoDefinition {
  return {
    kind: 'ship',
    ability: { ...ability, source: 'NEMEXIA' },
    priorityTargets,
    bonusDamage: {
      label: 'Дополнительный урон +70% против',
      targets: bonusTargets,
    },
    penaltyDamage: {
      label: 'Штрафной урон −30% против',
      targets: penaltyTargets,
    },
    targetsNote: nemexiaCombatNote,
  };
}

const shipInfoByName: Readonly<Record<string, ShipInfoDefinition>> = {
  'Спутник «Гелиос»': {
    kind: 'ship',
    ability: {
      name: 'Солнечный массив',
      description: 'Орбитальная энергетическая платформа. Её ключевая роль — поддержка энергетической инфраструктуры планеты.',
      note: 'Стационарный обслуживающий аппарат.',
      source: 'ASTERION',
    },
  },
  'Зонд «Призма»': {
    kind: 'ship',
    ability: {
      name: 'Глубокое сканирование',
      description: 'Открывает разведывательные миссии и повышает качество наблюдения за целью.',
      note: 'Разведывательная способность.',
      source: 'ASTERION',
    },
  },
  'Транспорт «Тракт»': {
    kind: 'ship',
    ability: {
      name: 'Грузовая сеть',
      description: 'Оптимизирован для перевозки ресурсов и быстрого снабжения флотов и колоний.',
      note: 'Логистическая способность.',
      source: 'ASTERION',
    },
  },
  'Мегатранспорт «Артерия»': {
    kind: 'ship',
    ability: {
      name: 'Грузовая сеть',
      description: 'Перевозит крупные партии ресурсов и используется как тяжёлая логистическая платформа.',
      note: 'Логистическая способность.',
      source: 'ASTERION',
    },
  },
  'Колонизатор «Форпост»': {
    kind: 'ship',
    ability: {
      name: 'Колониальное ядро',
      description: 'Разворачивает базовую инфраструктуру новой колонии и расходуется при успешной колонизации.',
      note: 'Специальная миссионная способность.',
      source: 'ASTERION',
    },
  },
  'Переработчик «Сборщик»': {
    kind: 'ship',
    ability: {
      name: 'Сборочный массив',
      description: 'Позволяет извлекать ресурсы из полей обломков после сражений.',
      note: 'Специальная миссионная способность.',
      source: 'ASTERION',
    },
  },

  'Скаут «Вектор»': combatShip(
    {
      name: 'Игнорирование брони',
      description: 'Применяется к дружественной группе кораблей и даёт возможность нанести врагу урон сквозь броню.',
      scaling: 'Шанс за корабль: 0,035%. Максимальный шанс: 70%.',
    },
    combineTargets(defenderTargets, ionDefenses),
    combineTargets(defenderTargets, battleshipTargets),
    combineTargets(scoutTargets, planetDestroyerTargets),
  ),
  'Крейсер «Копьё»': combatShip(
    {
      name: 'Сокрушение',
      description: 'Применяется к дружественной группе кораблей и увеличивает её атаку с ×2 до ×2,5. Не работает одновременно с критическим ударом.',
      scaling: 'Шанс за корабль: 0,05%. Максимальный шанс: 50%.',
    },
    combineTargets(scoutTargets, ballisticDefenses),
    combineTargets(scoutTargets, defenderTargets),
    combineTargets(cruiserTargets, battleshipTargets),
  ),
  'Защитник «Эгида»': combatShip(
    {
      name: 'Бонусные жизни',
      description: 'Применяется ко всем дружественным группам кораблей и увеличивает запас их жизней.',
      scaling: 'Бонус за корабль: 0,05%. Максимальный бонус: 30%.',
    },
    combineTargets(bomberTargets, plasmaLaserDefenses),
    combineTargets(bomberTargets, planetDestroyerTargets),
    combineTargets(scoutTargets, defenderTargets),
  ),
  'Линкор «Бастион»': combatShip(
    {
      name: 'Улучшенная броня',
      description: 'Применяется ко всем дружественным группам кораблей и предоставляет бонус к броне.',
      scaling: 'Бонус за корабль: 0,038%. Максимальный бонус: 30%.',
    },
    combineTargets(cruiserTargets, laserDefenses),
    combineTargets(cruiserTargets, defenderTargets),
    combineTargets(battleshipTargets, destroyerTargets),
  ),
  'Разрушитель «Цитадель»': combatShip(
    {
      name: 'Возрождение',
      description: 'Даёт шанс возродить часть потерянных дружественных кораблей во время раунда сражения.',
      scaling: 'Бонус за корабль: 0,08% (макс. 40%). Шанс за корабль: 0,14% (макс. 70%).',
    },
    combineTargets(battleshipTargets, plasmaDefenses),
    combineTargets(battleshipTargets, planetDestroyerTargets),
    combineTargets(destroyerTargets, bomberTargets),
  ),
  'Бомбардировщик «Молот»': combatShip(
    {
      name: 'Артиллерия',
      description: 'Применяется ко всем дружественным группам кораблей и предоставляет +50% к атаке против обороны.',
      scaling: 'Шанс за корабль: 0,1%. Максимальный шанс: 70%.',
    },
    combineTargets(destroyerTargets, laserIonDefenses),
    combineTargets(destroyerTargets, planetDestroyerTargets),
    combineTargets(cruiserTargets, bomberTargets),
  ),
  'Планетолом «Немезида»': combatShip(
    {
      name: 'Уничтожение планеты',
      description: 'Даёт шанс уничтожить вражескую планету. Результат зависит от уровня модернизации юнитов.',
      scaling: 'Шанс за корабль: 3%. Максимальный шанс: 30%.',
      note: 'Nemexia также задаёт отдельную способность «Детонация» для уничтожения уровней зданий.',
    },
    combineTargets(planetDestroyerTargets, ionPlasmaDefenses),
    combineTargets(planetDestroyerTargets, cruiserTargets),
    defenderTargets,
  ),

  Корсар: {
    kind: 'commander',
    ability: {
      name: 'Пиратский рейд',
      description: 'Позволяет проводить пиратские вылеты и увеличивает долю ресурсов, которую флот может захватить после победы.',
      scaling: '+1,25% украденных ресурсов за каждый уровень.',
      note: 'Данные способности сверены с сохранённой страницей Nemexia.',
      source: 'NEMEXIA',
    },
  },
  Охотник: {
    kind: 'commander',
    ability: {
      name: 'Контрразведка',
      description: 'Обнаруживает вражеские шпионские зонды при входе в атмосферу и мешает им получить разведданные.',
      scaling: '+1,75% к шансу обнаружения за каждый уровень.',
      note: 'Данные способности сверены с сохранённой страницей Nemexia.',
      source: 'NEMEXIA',
    },
  },
  Палач: {
    kind: 'commander',
    ability: {
      name: 'Приказ на уничтожение',
      description: 'Усиливает атакующий потенциал всего флота, когда командирский корабль ведёт соединение в бой.',
      scaling: '+0,15% к атаке флота за каждый уровень.',
      note: 'Данные способности сверены с сохранённой страницей Nemexia.',
      source: 'NEMEXIA',
    },
  },
  Джаггернаут: {
    kind: 'commander',
    ability: {
      name: 'Несокрушимый строй',
      description: 'Повышает запас жизненных очков каждого корабля во флоте.',
      scaling: '+0,15% к жизненным очкам кораблей за каждый уровень.',
      note: 'Данные способности сверены с сохранённой страницей Nemexia.',
      source: 'NEMEXIA',
    },
  },
  Тайфун: {
    kind: 'commander',
    ability: {
      name: 'Форсаж флота',
      description: 'Синхронизирует двигатели соединения и увеличивает скорость кораблей флота.',
      scaling: '+0,1% к скорости кораблей за каждый уровень.',
      note: 'Данные способности сверены с сохранённой страницей Nemexia.',
      source: 'NEMEXIA',
    },
  },
  Вайпер: {
    kind: 'commander',
    ability: {
      name: 'Критическое наведение',
      description: 'Ищет уязвимые точки в кораблях противника и направляет туда концентрированный огонь флота.',
      scaling: '+0,075% к шансу критического урона за каждый уровень.',
      note: 'Данные способности сверены с сохранённой страницей Nemexia.',
      source: 'NEMEXIA',
    },
  },
  Фантом: {
    kind: 'commander',
    ability: {
      name: 'Системный взлом',
      description: 'Пытается взломать систему управления вражеского флота и отправить противника назад, не допустив сражения.',
      scaling: '+0,75% к шансу успешного взлома за каждый уровень.',
      note: 'Данные способности сверены с сохранённой страницей Nemexia.',
      source: 'NEMEXIA',
    },
  },
  Скорпион: {
    kind: 'commander',
    ability: {
      name: 'Парализующий вирус',
      description: 'Инфицирует системы противника и при успешном срабатывании парализует его орудия на текущий ход.',
      scaling: '+0,1% к шансу парализации за каждый уровень.',
      note: 'Данные способности сверены с сохранённой страницей Nemexia.',
      source: 'NEMEXIA',
    },
  },
  Аннигилятор: {
    kind: 'commander',
    ability: {
      name: 'Детонация',
      description: 'Усиливает осадный показатель детонации, используемый в разрушительных операциях.',
      scaling: '+0,5% к показателю детонации за каждый уровень.',
      note: 'Данные способности сверены с сохранённой страницей Nemexia.',
      source: 'NEMEXIA',
    },
  },
  Реаниматор: {
    kind: 'commander',
    ability: {
      name: 'Полевое восстановление',
      description: 'Ищет среди уничтоженных кораблей те, которые ещё можно вернуть в строй прямо во время боя. За один ход может восстановить до 15 кораблей.',
      scaling: '+0,4% к шансу восстановления за каждый уровень.',
      note: 'Данные способности сверены с сохранённой страницей Nemexia.',
      source: 'NEMEXIA',
    },
  },
  Арго: {
    kind: 'commander',
    ability: {
      name: 'Экспедиционный анализ',
      description: 'Повышает награду очками усовершенствования в боях с Отступниками и одновременно расширяет грузовые возможности флота.',
      scaling: '+1% очков усовершенствования и +1% грузоподъёмности кораблей за каждый уровень.',
      note: 'Данные способности сверены с сохранённой страницей Nemexia.',
      source: 'NEMEXIA',
    },
  },
  Судья: {
    kind: 'commander',
    ability: {
      name: 'Приговор броне',
      description: 'Вмешивается в защитные системы противника и снижает броню всех вражеских единиц.',
      scaling: '−0,15% брони всех вражеских единиц за каждый уровень.',
      note: 'Данные способности сверены с сохранённой страницей Nemexia.',
      source: 'NEMEXIA',
    },
  },
  Полиас: {
    kind: 'commander',
    ability: {
      name: 'Планетарный хранитель',
      description: 'Пассивно снижает вероятность уничтожения защищаемой планеты. Эффект действует весь бой, даже если командирский корабль будет уничтожен раньше его окончания.',
      scaling: '−0,25% к вероятности уничтожения планеты за каждый уровень.',
      note: 'В архиве Nemexia корабль подписан как Polias; в Asterion используется «Полиас».',
      source: 'NEMEXIA',
    },
  },
};

function normalizeText(value: string | null | undefined) {
  return value?.replace(/\s+/g, ' ').trim() ?? '';
}

function readStats(card: Element): { category: string; stats: StatPair[] } {
  const tooltip = card.querySelector('.shipyard-stats-tooltip-v1');
  if (!tooltip) return { category: '', stats: [] };

  const category = normalizeText(tooltip.querySelector('.shipyard-tooltip-head-v1 small')?.textContent);
  const stats: StatPair[] = [];

  const addPairs = (selector: string) => {
    tooltip.querySelectorAll(selector).forEach((entry) => {
      const label = normalizeText(entry.querySelector('small')?.textContent);
      const value = normalizeText(entry.querySelector('strong')?.textContent);
      if (!label || !value) return;
      if (stats.some((stat) => stat.label === label && stat.value === value)) return;
      stats.push({ label, value });
    });
  };

  addPairs('.shipyard-tooltip-primary-v1 > div');
  addPairs('.shipyard-tooltip-grid-v1 > div');

  return { category, stats };
}

function resolveFaction(definition: ShipInfoDefinition): ShipInfoFaction {
  return definition.kind === 'commander' ? 'Общий флот' : 'Aegis';
}

function ShipTargetCard({ target }: { target: ShipTarget }) {
  const type = target.type ?? 'Корабль';
  return (
    <div className="ship-info-target-v1" title={`${target.name} · ${target.faction} · ${type}`}>
      <div className="ship-info-target-art-v1">
        <img src={target.art} alt="" draggable={false} />
      </div>
      <div>
        <strong>{target.name}</strong>
        <span>{target.faction} · {type}</span>
      </div>
    </div>
  );
}

function TargetSection({
  number,
  title,
  targets,
  note,
}: {
  number: string;
  title: string;
  targets: ShipTarget[];
  note?: string;
}) {
  return (
    <section className="ship-info-section-v1">
      <div className="ship-info-section-title-v1"><span>{number}</span><h3>{title}</h3></div>
      <div className="ship-info-target-grid-v1">
        {targets.map((target) => (
          <ShipTargetCard key={`${number}:${target.faction}:${target.type}:${target.name}`} target={target} />
        ))}
      </div>
      {note ? <small className="ship-info-note-v1">{note}</small> : null}
    </section>
  );
}

function ShipInfoModal({ data, onClose }: { data: OpenShipInfo; onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const previousActiveElement = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeRef.current?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);

    return () => {
      window.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
      previousActiveElement?.focus();
    };
  }, [onClose]);

  return createPortal(
    <div
      className="ship-info-overlay-v1"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section className="ship-info-modal-v1" role="dialog" aria-modal="true" aria-label={`Информация о корабле ${data.name}`}>
        <header className="ship-info-head-v1">
          <div>
            <span>{data.definition.kind === 'commander' ? 'КОМАНДИРСКИЙ КОРАБЛЬ' : 'ДОСЬЕ КОРАБЛЯ'}</span>
            <h2>{data.name}</h2>
            <p>{data.role}</p>
          </div>
          <button ref={closeRef} type="button" className="ship-info-close-v1" onClick={onClose} aria-label="Закрыть информацию">×</button>
        </header>

        <div className="ship-info-body-v1">
          <aside className="ship-info-hero-v1">
            <div className="ship-info-art-v1">
              <img src={data.art} alt={data.name} draggable={false} />
            </div>
            <div className="ship-info-ident-v1">
              <div><small>РАСА / ДОСТУПНОСТЬ</small><strong>{data.faction}</strong></div>
              <div><small>КЛАСС</small><strong>{data.category || data.role}</strong></div>
            </div>
          </aside>

          <div className="ship-info-content-v1">
            {data.stats.length > 0 ? (
              <section className="ship-info-section-v1">
                <div className="ship-info-section-title-v1"><span>01</span><h3>ТАКТИКО-ТЕХНИЧЕСКИЕ ХАРАКТЕРИСТИКИ</h3></div>
                <div className="ship-info-stats-v1">
                  {data.stats.map((stat) => (
                    <div className="ship-info-stat-v1" key={`${stat.label}:${stat.value}`}>
                      <small>{stat.label}</small>
                      <strong>{stat.value}</strong>
                    </div>
                  ))}
                </div>
              </section>
            ) : null}

            <section className="ship-info-section-v1">
              <div className="ship-info-section-title-v1"><span>02</span><h3>СПОСОБНОСТЬ</h3></div>
              <div className="ship-info-ability-v1">
                <div className="ship-info-ability-head-v1">
                  <div><small>СПЕЦИАЛЬНЫЙ ЭФФЕКТ</small><strong>{data.definition.ability.name}</strong></div>
                  <span>{data.definition.ability.source ?? (data.definition.kind === 'commander' ? 'NEMEXIA' : 'ASTERION')}</span>
                </div>
                <p>{data.definition.ability.description}</p>
                {data.definition.ability.scaling ? <div className="ship-info-scaling-v1">{data.definition.ability.scaling}</div> : null}
                {data.definition.ability.note ? <small className="ship-info-note-v1">{data.definition.ability.note}</small> : null}
              </div>
            </section>

            {data.definition.priorityTargets?.length ? (
              <TargetSection number="03" title="ПРИОРИТЕТНЫЕ ЦЕЛИ" targets={data.definition.priorityTargets} />
            ) : null}

            {data.definition.bonusDamage ? (
              <TargetSection
                number="04"
                title={data.definition.bonusDamage.label}
                targets={data.definition.bonusDamage.targets}
              />
            ) : null}

            {data.definition.penaltyDamage ? (
              <TargetSection
                number="05"
                title={data.definition.penaltyDamage.label}
                targets={data.definition.penaltyDamage.targets}
                note={data.definition.targetsNote}
              />
            ) : null}
          </div>
        </div>
      </section>
    </div>,
    document.body,
  );
}

export function ShipInfoController() {
  const [openInfo, setOpenInfo] = useState<OpenShipInfo | null>(null);

  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      const origin = event.target instanceof Element ? event.target : null;
      const button = origin?.closest('button[aria-label^="Информация:"]') as HTMLButtonElement | null;
      if (!button) return;

      const label = button.getAttribute('aria-label') ?? '';
      const name = normalizeText(label.replace(/^Информация:\s*/, ''));
      const definition = shipInfoByName[name];
      if (!definition) return;

      const card = button.closest('.shipyard-card-v1');
      if (!card) return;

      const art = (card.querySelector('.shipyard-art-v1 img') ?? card.querySelector('img')) as HTMLImageElement | null;
      const role = normalizeText(button.getAttribute('title'));
      const { category, stats } = readStats(card);
      const visibleStats = definition.kind === 'commander'
        ? stats.filter((stat) => stat.label !== 'Приоритет')
        : stats;

      setOpenInfo({
        name,
        role,
        category,
        faction: resolveFaction(definition),
        art: art?.src ?? '',
        stats: visibleStats,
        definition,
      });
    };

    document.addEventListener('click', onClick);
    return () => document.removeEventListener('click', onClick);
  }, []);

  if (!openInfo) return null;
  return <ShipInfoModal data={openInfo} onClose={() => setOpenInfo(null)} />;
}