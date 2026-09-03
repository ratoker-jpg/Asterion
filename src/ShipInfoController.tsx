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

import { COMMANDER_ABILITIES, COMMANDER_IDS } from './domain/combat/commanders.ts';
import './ship-info-modal.css';

type ShipInfoKind = 'ship' | 'commander';
type ShipInfoFaction = 'Астеры' | 'Илары' | 'Рой' | 'Общий флот';
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
  shipTarget('Скаут', 'Астеры', aegisScoutArt),
  shipTarget('Ланцет', 'Илары', synodFighterArt),
  shipTarget('Жало', 'Рой', veyraNoxDartArt),
];

const cruiserTargets: ShipTarget[] = [
  shipTarget('Крейсер', 'Астеры', aegisCruiserArt),
  shipTarget('Импульс', 'Илары', synodInterceptorArt),
  shipTarget('Стрекоза', 'Рой', veyraNemesisArt),
];

const defenderTargets: ShipTarget[] = [
  shipTarget('Защитник', 'Астеры', aegisDefenderArt),
  shipTarget('Барьер', 'Илары', synodShieldBotArt),
  shipTarget('Панцирник', 'Рой', veyraAbsorberArt),
];

const battleshipTargets: ShipTarget[] = [
  shipTarget('Линкор', 'Астеры', aegisBattleshipArt),
  shipTarget('Монолит', 'Илары', synodStarArmadaArt),
  shipTarget('Скарабей', 'Рой', veyraGhostArt),
];

const destroyerTargets: ShipTarget[] = [
  shipTarget('Разрушитель', 'Астеры', aegisDestroyerArt),
  shipTarget('Голиаф', 'Илары', synodGoliathArt),
  shipTarget('Шмель', 'Рой', veyraHornetArt),
];

const bomberTargets: ShipTarget[] = [
  shipTarget('Бомбардировщик', 'Астеры', aegisBomberArt),
  shipTarget('Пульсар', 'Илары', synodBomberArt),
  shipTarget('Спороносец', 'Рой', veyraBomberArt),
];

const planetDestroyerTargets: ShipTarget[] = [
  shipTarget('Планетолом', 'Астеры', aegisDeathStarArt),
  shipTarget('Разлом', 'Илары', synodTitanArt),
  shipTarget('Пожиратель', 'Рой', veyraQueenArt),
];

const ballisticDefenses: ShipTarget[] = [
  defenseTarget('Защитная матрица', 'Астеры', aegisBallisticDefenseArt),
  defenseTarget('Ударная матрица', 'Илары', synodBallisticDefenseArt),
  defenseTarget('Шипомёт', 'Рой', veyraBallisticDefenseArt),
];

const laserDefenses: ShipTarget[] = [
  defenseTarget('Лазерная матрица', 'Астеры', aegisLaserDefenseArt),
  defenseTarget('Лазерная матрица', 'Илары', synodLaserDefenseArt),
  defenseTarget('Лазерная железа', 'Рой', veyraLaserDefenseArt),
];

const ionDefenses: ShipTarget[] = [
  defenseTarget('Ионная матрица', 'Астеры', aegisIonDefenseArt),
  defenseTarget('Ионная матрица', 'Илары', synodIonDefenseArt),
  defenseTarget('Ионное плетение', 'Рой', veyraIonDefenseArt),
];

const plasmaDefenses: ShipTarget[] = [
  defenseTarget('Плазменная матрица', 'Астеры', aegisPlasmaDefenseArt),
  defenseTarget('Плазменная матрица', 'Илары', synodPlasmaDefenseArt),
  defenseTarget('Плазменное плетение', 'Рой', veyraPlasmaDefenseArt),
];

const laserIonDefenses: ShipTarget[] = [
  defenseTarget('Лазер-ионная матрица', 'Астеры', aegisLaserIonDefenseArt),
  defenseTarget('Лазерно-ионная матрица', 'Илары', synodLaserIonDefenseArt),
  defenseTarget('Лазерно-ионный орган', 'Рой', veyraLaserIonDefenseArt),
];

const plasmaLaserDefenses: ShipTarget[] = [
  defenseTarget('Плазма-лазерная матрица', 'Астеры', aegisPlasmaLaserDefenseArt),
  defenseTarget('Плазменно-лазерная матрица', 'Илары', synodPlasmaLaserDefenseArt),
  defenseTarget('Плазменно-лазерный орган', 'Рой', veyraPlasmaLaserDefenseArt),
];

const ionPlasmaDefenses: ShipTarget[] = [
  defenseTarget('Ион-плазменная матрица', 'Астеры', aegisIonPlasmaDefenseArt),
  defenseTarget('Ионно-плазменная матрица', 'Илары', synodIonPlasmaDefenseArt),
  defenseTarget('Ионно-плазменный орган', 'Рой', veyraIonPlasmaDefenseArt),
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

const commanderInfoByName: Readonly<Record<string, ShipInfoDefinition>> = Object.fromEntries(
  COMMANDER_IDS.map((commanderId) => {
    const ability = COMMANDER_ABILITIES[commanderId];
    return [ability.commanderName, {
      kind: 'commander',
      ability: {
        name: ability.ability,
        description: ability.description,
        scaling: ability.ratePerLevel,
        note: ability.note ?? 'Способность хранится в едином typed commander catalog. Математическое применение в бою пока не реализовано.',
        source: 'NEMEXIA',
      },
    } satisfies ShipInfoDefinition] as const;
  }),
);

const shipInfoByName: Readonly<Record<string, ShipInfoDefinition>> = {
  Спутник: {
    kind: 'ship',
    ability: {
      name: 'Солнечный массив',
      description: 'Орбитальная энергетическая платформа. Её ключевая роль — поддержка энергетической инфраструктуры планеты.',
      note: 'Стационарный обслуживающий аппарат.',
      source: 'ASTERION',
    },
  },
  Зонд: {
    kind: 'ship',
    ability: {
      name: 'Глубокое сканирование',
      description: 'Открывает разведывательные миссии и повышает качество наблюдения за целью.',
      note: 'Разведывательная способность.',
      source: 'ASTERION',
    },
  },
  Транспорт: {
    kind: 'ship',
    ability: {
      name: 'Грузовая сеть',
      description: 'Оптимизирован для перевозки ресурсов и быстрого снабжения флотов и колоний.',
      note: 'Логистическая способность.',
      source: 'ASTERION',
    },
  },
  Мегатранспорт: {
    kind: 'ship',
    ability: {
      name: 'Грузовая сеть',
      description: 'Перевозит крупные партии ресурсов и используется как тяжёлая логистическая платформа.',
      note: 'Логистическая способность.',
      source: 'ASTERION',
    },
  },
  Колонизатор: {
    kind: 'ship',
    ability: {
      name: 'Колониальное ядро',
      description: 'Разворачивает базовую инфраструктуру новой колонии и расходуется при успешной колонизации.',
      note: 'Специальная миссионная способность.',
      source: 'ASTERION',
    },
  },
  Переработчик: {
    kind: 'ship',
    ability: {
      name: 'Сборочный массив',
      description: 'Позволяет извлекать ресурсы из полей обломков после сражений.',
      note: 'Специальная миссионная способность.',
      source: 'ASTERION',
    },
  },
  Скаут: combatShip(
    {
      name: 'Игнорирование брони',
      description: 'Применяется к дружественной группе кораблей и даёт возможность нанести врагу урон сквозь броню.',
      scaling: 'Шанс за корабль: 0,035%. Максимальный шанс: 70%.',
    },
    combineTargets(defenderTargets, ionDefenses),
    combineTargets(defenderTargets, battleshipTargets),
    combineTargets(scoutTargets, planetDestroyerTargets),
  ),
  Крейсер: combatShip(
    {
      name: 'Сокрушение',
      description: 'Применяется к дружественной группе кораблей и увеличивает её атаку с ×2 до ×2,5. Не работает одновременно с критическим ударом.',
      scaling: 'Шанс за корабль: 0,05%. Максимальный шанс: 50%.',
    },
    combineTargets(scoutTargets, ballisticDefenses),
    combineTargets(scoutTargets, defenderTargets),
    combineTargets(cruiserTargets, battleshipTargets),
  ),
  Защитник: combatShip(
    {
      name: 'Бонусные жизни',
      description: 'Применяется ко всем дружественным группам кораблей и увеличивает запас их жизней.',
      scaling: 'Бонус за корабль: 0,05%. Максимальный бонус: 30%.',
    },
    combineTargets(bomberTargets, plasmaLaserDefenses),
    combineTargets(bomberTargets, planetDestroyerTargets),
    combineTargets(scoutTargets, defenderTargets),
  ),
  Линкор: combatShip(
    {
      name: 'Улучшенная броня',
      description: 'Применяется ко всем дружественным группам кораблей и предоставляет бонус к броне.',
      scaling: 'Бонус за корабль: 0,038%. Максимальный бонус: 30%.',
    },
    combineTargets(cruiserTargets, laserDefenses),
    combineTargets(cruiserTargets, defenderTargets),
    combineTargets(battleshipTargets, destroyerTargets),
  ),
  Разрушитель: combatShip(
    {
      name: 'Возрождение',
      description: 'Даёт шанс возродить часть потерянных дружественных кораблей во время раунда сражения.',
      scaling: 'Бонус за корабль: 0,08% (макс. 40%). Шанс за корабль: 0,14% (макс. 70%).',
    },
    combineTargets(battleshipTargets, plasmaDefenses),
    combineTargets(battleshipTargets, planetDestroyerTargets),
    combineTargets(destroyerTargets, bomberTargets),
  ),
  Бомбардировщик: combatShip(
    {
      name: 'Артиллерия',
      description: 'Применяется ко всем дружественным группам кораблей и предоставляет +50% к атаке против обороны.',
      scaling: 'Шанс за корабль: 0,1%. Максимальный шанс: 70%.',
    },
    combineTargets(destroyerTargets, laserIonDefenses),
    combineTargets(destroyerTargets, planetDestroyerTargets),
    combineTargets(cruiserTargets, bomberTargets),
  ),
  Планетолом: combatShip(
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
  ...commanderInfoByName,
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
  return definition.kind === 'commander' ? 'Общий флот' : 'Астеры';
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
