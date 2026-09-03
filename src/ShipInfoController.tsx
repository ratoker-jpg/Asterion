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
import './ship-info-modal.css';

type ShipInfoKind = 'ship' | 'commander';
type ShipInfoFaction = 'Aegis' | 'Synod' | 'Veyra' | 'Общий флот';

type ShipTarget = {
  name: string;
  faction: Exclude<ShipInfoFaction, 'Общий флот'>;
  art: string;
};

type ShipAbility = {
  name: string;
  description: string;
  scaling?: string;
  note?: string;
};

type ShipInfoDefinition = {
  kind: ShipInfoKind;
  ability: ShipAbility;
  priorityTargets?: ShipTarget[];
  bonusDamage?: {
    label: string;
    targets: ShipTarget[];
  };
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

const scoutTargets: ShipTarget[] = [
  { name: 'Скаут «Вектор»', faction: 'Aegis', art: aegisScoutArt },
  { name: 'Истребитель «Ланцет»', faction: 'Synod', art: synodFighterArt },
  { name: 'Нокс Дарт «Жало»', faction: 'Veyra', art: veyraNoxDartArt },
];

const cruiserTargets: ShipTarget[] = [
  { name: 'Крейсер «Копьё»', faction: 'Aegis', art: aegisCruiserArt },
  { name: 'Перехватчик «Фаза»', faction: 'Synod', art: synodInterceptorArt },
  { name: 'Немезис «Стрекоза»', faction: 'Veyra', art: veyraNemesisArt },
];

const defenderTargets: ShipTarget[] = [
  { name: 'Защитник «Эгида»', faction: 'Aegis', art: aegisDefenderArt },
  { name: 'Щитовой бот «Оберег»', faction: 'Synod', art: synodShieldBotArt },
  { name: 'Абсорбатор «Завеса»', faction: 'Veyra', art: veyraAbsorberArt },
];

const battleshipTargets: ShipTarget[] = [
  { name: 'Линкор «Бастион»', faction: 'Aegis', art: aegisBattleshipArt },
  { name: 'Звёздная армада', faction: 'Synod', art: synodStarArmadaArt },
  { name: 'Призрак', faction: 'Veyra', art: veyraGhostArt },
];

const destroyerTargets: ShipTarget[] = [
  { name: 'Разрушитель «Цитадель»', faction: 'Aegis', art: aegisDestroyerArt },
  { name: 'Голиаф', faction: 'Synod', art: synodGoliathArt },
  { name: 'Шмель', faction: 'Veyra', art: veyraHornetArt },
];

const bomberTargets: ShipTarget[] = [
  { name: 'Бомбардировщик «Молот»', faction: 'Aegis', art: aegisBomberArt },
  { name: 'Бомбербот', faction: 'Synod', art: synodBomberArt },
  { name: 'Бомбардировщик', faction: 'Veyra', art: veyraBomberArt },
];

const planetDestroyerTargets: ShipTarget[] = [
  { name: 'Планетолом «Немезида»', faction: 'Aegis', art: aegisDeathStarArt },
  { name: 'Титан', faction: 'Synod', art: synodTitanArt },
  { name: 'Нокс Царица', faction: 'Veyra', art: veyraQueenArt },
];

const nemexiaCombatNote =
  'Корабельные приоритеты и +70% урона сверены по сохранённым страницам синей расы Nemexia. У отдельных классов в оригинале также есть приоритетные оборонные установки; их вынесем в оборонный справочник.';

function combatShip(
  ability: ShipAbility,
  priorityTargets: ShipTarget[],
): ShipInfoDefinition {
  return {
    kind: 'ship',
    ability,
    priorityTargets,
    bonusDamage: {
      label: 'Дополнительный урон +70% против',
      targets: priorityTargets,
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
    },
  },
  'Зонд «Призма»': {
    kind: 'ship',
    ability: {
      name: 'Глубокое сканирование',
      description: 'Открывает разведывательные миссии и повышает качество наблюдения за целью.',
      note: 'Разведывательная способность.',
    },
  },
  'Транспорт «Тракт»': {
    kind: 'ship',
    ability: {
      name: 'Грузовая сеть',
      description: 'Оптимизирован для перевозки ресурсов и быстрого снабжения флотов и колоний.',
      note: 'Логистическая способность.',
    },
  },
  'Мегатранспорт «Артерия»': {
    kind: 'ship',
    ability: {
      name: 'Грузовая сеть',
      description: 'Перевозит крупные партии ресурсов и используется как тяжёлая логистическая платформа.',
      note: 'Логистическая способность.',
    },
  },
  'Колонизатор «Форпост»': {
    kind: 'ship',
    ability: {
      name: 'Колониальное ядро',
      description: 'Разворачивает базовую инфраструктуру новой колонии и расходуется при успешной колонизации.',
      note: 'Специальная миссионная способность.',
    },
  },
  'Переработчик «Сборщик»': {
    kind: 'ship',
    ability: {
      name: 'Сборочный массив',
      description: 'Позволяет извлекать ресурсы из полей обломков после сражений.',
      note: 'Специальная миссионная способность.',
    },
  },
  'Скаут «Вектор»': combatShip(
    {
      name: 'Пробитие брони',
      description: 'Группа лёгких боевых кораблей концентрирует огонь по уязвимым участкам защиты цели.',
      scaling: 'Эффект способности Asterion усиливается с количеством кораблей в соединении.',
      note: 'Приоритеты целей ниже взяты из оригинальной таблицы Nemexia для Скаута.',
    },
    defenderTargets,
  ),
  'Крейсер «Копьё»': combatShip(
    {
      name: 'Сокрушение',
      description: 'Согласованный залп повышает атакующий потенциал ударной группы.',
      scaling: 'Эффект способности Asterion усиливается с количеством кораблей в соединении.',
    },
    scoutTargets,
  ),
  'Защитник «Эгида»': combatShip(
    {
      name: 'Резерв живучести',
      description: 'Поддерживает соседние корабли и повышает общую устойчивость дружественного соединения.',
      scaling: 'Эффект способности Asterion усиливается с количеством кораблей поддержки.',
    },
    bomberTargets,
  ),
  'Линкор «Бастион»': combatShip(
    {
      name: 'Связка брони',
      description: 'Тяжёлые корабли формируют устойчивую защитную связку и повышают живучесть строя.',
      scaling: 'Эффект способности Asterion усиливается с количеством линкоров в соединении.',
    },
    cruiserTargets,
  ),
  'Разрушитель «Цитадель»': combatShip(
    {
      name: 'Боевая рекуперация',
      description: 'Резервные системы снижают необратимые потери тяжёлой ударной группы.',
      scaling: 'Эффект способности Asterion зависит от количества кораблей этого класса.',
    },
    battleshipTargets,
  ),
  'Бомбардировщик «Молот»': combatShip(
    {
      name: 'Артиллерия',
      description: 'Специализирован для нанесения усиленного урона стационарным и планетарным целям.',
      scaling: 'Эффект способности Asterion зависит от количества бомбардировщиков.',
    },
    destroyerTargets,
  ),
  'Планетолом «Немезида»': combatShip(
    {
      name: 'Разрушитель мира',
      description: 'Сверхтяжёлая осадная платформа для операций против планетарной инфраструктуры и самой планеты.',
      scaling: 'Nemexia: шанс уничтожения планеты — 3% за корабль, максимальный шанс — 30%.',
      note: 'Сохранённая страница Nemexia отдельно указывает, что итог зависит от уровня модернизации юнита.',
    },
    planetDestroyerTargets,
  ),

  Корсар: {
    kind: 'commander',
    ability: {
      name: 'Пиратский рейд',
      description: 'Позволяет проводить пиратские вылеты и увеличивает долю ресурсов, которую флот может захватить после победы.',
      scaling: '+1,25% украденных ресурсов за каждый уровень.',
      note: 'Данные способности сверены с сохранённой страницей Nemexia.',
    },
  },
  Охотник: {
    kind: 'commander',
    ability: {
      name: 'Контрразведка',
      description: 'Обнаруживает вражеские шпионские зонды при входе в атмосферу и мешает им получить разведданные.',
      scaling: '+1,75% к шансу обнаружения за каждый уровень.',
      note: 'Данные способности сверены с сохранённой страницей Nemexia.',
    },
  },
  Палач: {
    kind: 'commander',
    ability: {
      name: 'Приказ на уничтожение',
      description: 'Усиливает атакующий потенциал всего флота, когда командирский корабль ведёт соединение в бой.',
      scaling: '+0,15% к атаке флота за каждый уровень.',
      note: 'Данные способности сверены с сохранённой страницей Nemexia.',
    },
  },
  Джаггернаут: {
    kind: 'commander',
    ability: {
      name: 'Несокрушимый строй',
      description: 'Повышает запас жизненных очков каждого корабля во флоте.',
      scaling: '+0,15% к жизненным очкам кораблей за каждый уровень.',
      note: 'Данные способности сверены с сохранённой страницей Nemexia.',
    },
  },
  Тайфун: {
    kind: 'commander',
    ability: {
      name: 'Форсаж флота',
      description: 'Синхронизирует двигатели соединения и увеличивает скорость кораблей флота.',
      scaling: '+0,1% к скорости кораблей за каждый уровень.',
      note: 'Данные способности сверены с сохранённой страницей Nemexia.',
    },
  },
  Вайпер: {
    kind: 'commander',
    ability: {
      name: 'Критическое наведение',
      description: 'Ищет уязвимые точки в кораблях противника и направляет туда концентрированный огонь флота.',
      scaling: '+0,075% к шансу критического урона за каждый уровень.',
      note: 'Данные способности сверены с сохранённой страницей Nemexia.',
    },
  },
  Фантом: {
    kind: 'commander',
    ability: {
      name: 'Системный взлом',
      description: 'Пытается взломать систему управления вражеского флота и отправить противника назад, не допустив сражения.',
      scaling: '+0,75% к шансу успешного взлома за каждый уровень.',
      note: 'Данные способности сверены с сохранённой страницей Nemexia.',
    },
  },
  Скорпион: {
    kind: 'commander',
    ability: {
      name: 'Парализующий вирус',
      description: 'Инфицирует системы противника и при успешном срабатывании парализует его орудия на текущий ход.',
      scaling: '+0,1% к шансу парализации за каждый уровень.',
      note: 'Данные способности сверены с сохранённой страницей Nemexia.',
    },
  },
  Аннигилятор: {
    kind: 'commander',
    ability: {
      name: 'Детонация',
      description: 'Усиливает осадный показатель детонации, используемый в разрушительных операциях.',
      scaling: '+0,5% к показателю детонации за каждый уровень.',
      note: 'Данные способности сверены с сохранённой страницей Nemexia.',
    },
  },
  Реаниматор: {
    kind: 'commander',
    ability: {
      name: 'Полевое восстановление',
      description: 'Ищет среди уничтоженных кораблей те, которые ещё можно вернуть в строй прямо во время боя. За один ход может восстановить до 15 кораблей.',
      scaling: '+0,4% к шансу восстановления за каждый уровень.',
      note: 'Данные способности сверены с сохранённой страницей Nemexia.',
    },
  },
  Арго: {
    kind: 'commander',
    ability: {
      name: 'Экспедиционный анализ',
      description: 'Повышает награду очками усовершенствования в боях с Отступниками и одновременно расширяет грузовые возможности флота.',
      scaling: '+1% очков усовершенствования и +1% грузоподъёмности кораблей за каждый уровень.',
      note: 'Данные способности сверены с сохранённой страницей Nemexia.',
    },
  },
  Судья: {
    kind: 'commander',
    ability: {
      name: 'Приговор броне',
      description: 'Вмешивается в защитные системы противника и снижает броню всех вражеских единиц.',
      scaling: '−0,15% брони всех вражеских единиц за каждый уровень.',
      note: 'Данные способности сверены с сохранённой страницей Nemexia.',
    },
  },
  Полиас: {
    kind: 'commander',
    ability: {
      name: 'Планетарный хранитель',
      description: 'Пассивно снижает вероятность уничтожения защищаемой планеты. Эффект действует весь бой, даже если командирский корабль будет уничтожен раньше его окончания.',
      scaling: '−0,25% к вероятности уничтожения планеты за каждый уровень.',
      note: 'В архиве Nemexia корабль подписан как Polias; в Asterion используется «Полиас».',
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
  return (
    <div className="ship-info-target-v1" title={`${target.name} · ${target.faction}`}>
      <div className="ship-info-target-art-v1">
        <img src={target.art} alt="" draggable={false} />
      </div>
      <div>
        <strong>{target.name}</strong>
        <span>{target.faction}</span>
      </div>
    </div>
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
                  <span>{data.definition.kind === 'commander' ? 'NEMEXIA' : 'ASTERION'}</span>
                </div>
                <p>{data.definition.ability.description}</p>
                {data.definition.ability.scaling ? <div className="ship-info-scaling-v1">{data.definition.ability.scaling}</div> : null}
                {data.definition.ability.note ? <small className="ship-info-note-v1">{data.definition.ability.note}</small> : null}
              </div>
            </section>

            {data.definition.priorityTargets?.length ? (
              <section className="ship-info-section-v1">
                <div className="ship-info-section-title-v1"><span>03</span><h3>ПРИОРИТЕТНЫЕ ЦЕЛИ</h3></div>
                <div className="ship-info-target-grid-v1">
                  {data.definition.priorityTargets.map((target) => <ShipTargetCard key={`${target.faction}:${target.name}`} target={target} />)}
                </div>
              </section>
            ) : null}

            {data.definition.bonusDamage ? (
              <section className="ship-info-section-v1">
                <div className="ship-info-section-title-v1"><span>04</span><h3>{data.definition.bonusDamage.label}</h3></div>
                <div className="ship-info-target-grid-v1">
                  {data.definition.bonusDamage.targets.map((target) => <ShipTargetCard key={`bonus:${target.faction}:${target.name}`} target={target} />)}
                </div>
                {data.definition.targetsNote ? <small className="ship-info-note-v1">{data.definition.targetsNote}</small> : null}
              </section>
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
