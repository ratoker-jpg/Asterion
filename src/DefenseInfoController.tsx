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

type Faction = 'Астеры' | 'Илары' | 'Рой';

type DefenseTarget = {
  name: string;
  faction: Faction;
  art: string;
};

type DefenseDefinition = {
  priorityTargets: DefenseTarget[];
  sourceNote: string;
};

type StatPair = {
  label: string;
  value: string;
};

type OpenDefenseInfo = {
  name: string;
  role: string;
  category: string;
  art: string;
  stats: StatPair[];
  definition: DefenseDefinition;
};

const target = (name: string, faction: Faction, art: string): DefenseTarget => ({ name, faction, art });

const scoutTargets: DefenseTarget[] = [
  target('Скаут', 'Астеры', aegisScoutArt),
  target('Ланцет', 'Илары', synodFighterArt),
  target('Жало', 'Рой', veyraNoxDartArt),
];

const cruiserTargets: DefenseTarget[] = [
  target('Крейсер', 'Астеры', aegisCruiserArt),
  target('Импульс', 'Илары', synodInterceptorArt),
  target('Стрекоза', 'Рой', veyraNemesisArt),
];

const defenderTargets: DefenseTarget[] = [
  target('Защитник', 'Астеры', aegisDefenderArt),
  target('Барьер', 'Илары', synodShieldBotArt),
  target('Панцирник', 'Рой', veyraAbsorberArt),
];

const battleshipTargets: DefenseTarget[] = [
  target('Линкор', 'Астеры', aegisBattleshipArt),
  target('Монолит', 'Илары', synodStarArmadaArt),
  target('Скарабей', 'Рой', veyraGhostArt),
];

const destroyerTargets: DefenseTarget[] = [
  target('Разрушитель', 'Астеры', aegisDestroyerArt),
  target('Голиаф', 'Илары', synodGoliathArt),
  target('Шмель', 'Рой', veyraHornetArt),
];

const bomberTargets: DefenseTarget[] = [
  target('Бомбардировщик', 'Астеры', aegisBomberArt),
  target('Пульсар', 'Илары', synodBomberArt),
  target('Спороносец', 'Рой', veyraBomberArt),
];

const planetDestroyerTargets: DefenseTarget[] = [
  target('Планетолом', 'Астеры', aegisDeathStarArt),
  target('Разлом', 'Илары', synodTitanArt),
  target('Пожиратель', 'Рой', veyraQueenArt),
];

const nemexiaPriorityNote =
  'Приоритетные цели сверены по сохранённым страницам обороны синей расы Nemexia. Бонусного и штрафного урона у оборонных установок в этих страницах нет.';

const noPriorityNote =
  'В сохранённой странице Nemexia для этой щитовой системы блок «Приоритетные цели» отсутствует.';

const defenseInfoByName: Readonly<Record<string, DefenseDefinition>> = {
  'Защитная матрица': { priorityTargets: defenderTargets, sourceNote: nemexiaPriorityNote },
  'Лазерная матрица': { priorityTargets: scoutTargets, sourceNote: nemexiaPriorityNote },
  'Ионная матрица': { priorityTargets: cruiserTargets, sourceNote: nemexiaPriorityNote },
  'Плазменная матрица': { priorityTargets: bomberTargets, sourceNote: nemexiaPriorityNote },
  'Лазер-ионная матрица': { priorityTargets: battleshipTargets, sourceNote: nemexiaPriorityNote },
  'Плазма-лазерная матрица': { priorityTargets: destroyerTargets, sourceNote: nemexiaPriorityNote },
  'Ион-плазменная матрица': { priorityTargets: planetDestroyerTargets, sourceNote: nemexiaPriorityNote },
  'Матричный щит': { priorityTargets: [], sourceNote: noPriorityNote },
  'Планетарная матрица': { priorityTargets: [], sourceNote: noPriorityNote },
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
      if (!label || !value || label === 'Приоритет') return;
      if (stats.some((stat) => stat.label === label && stat.value === value)) return;
      stats.push({ label, value });
    });
  };

  addPairs('.shipyard-tooltip-primary-v1 > div');
  addPairs('.shipyard-tooltip-grid-v1 > div');
  return { category, stats };
}

function TargetCard({ target: item }: { target: DefenseTarget }) {
  return (
    <div className="ship-info-target-v1" title={`${item.name} · ${item.faction} · Корабль`}>
      <div className="ship-info-target-art-v1">
        <img src={item.art} alt="" draggable={false} />
      </div>
      <div>
        <strong>{item.name}</strong>
        <span>{item.faction} · Корабль</span>
      </div>
    </div>
  );
}

function DefenseInfoModal({ data, onClose }: { data: OpenDefenseInfo; onClose: () => void }) {
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
      <section className="ship-info-modal-v1" role="dialog" aria-modal="true" aria-label={`Информация об обороне ${data.name}`}>
        <header className="ship-info-head-v1">
          <div>
            <span>ДОСЬЕ ОБОРОНЫ</span>
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
              <div><small>РАСА / ДОСТУПНОСТЬ</small><strong>Астеры</strong></div>
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
              <div className="ship-info-section-title-v1"><span>02</span><h3>ПРИОРИТЕТНЫЕ ЦЕЛИ</h3></div>
              {data.definition.priorityTargets.length > 0 ? (
                <div className="ship-info-target-grid-v1">
                  {data.definition.priorityTargets.map((item) => (
                    <TargetCard key={`${item.faction}:${item.name}`} target={item} />
                  ))}
                </div>
              ) : null}
              <small className="ship-info-note-v1">{data.definition.sourceNote}</small>
            </section>
          </div>
        </div>
      </section>
    </div>,
    document.body,
  );
}

export function DefenseInfoController() {
  const [openInfo, setOpenInfo] = useState<OpenDefenseInfo | null>(null);

  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      const origin = event.target instanceof Element ? event.target : null;
      const button = origin?.closest('button[aria-label^="Информация:"]') as HTMLButtonElement | null;
      if (!button) return;

      const label = button.getAttribute('aria-label') ?? '';
      const name = normalizeText(label.replace(/^Информация:\s*/, ''));
      const definition = defenseInfoByName[name];
      if (!definition) return;

      const card = button.closest('.shipyard-card-v1');
      if (!card) return;

      const art = (card.querySelector('.shipyard-art-v1 img') ?? card.querySelector('img')) as HTMLImageElement | null;
      const role = normalizeText(button.getAttribute('title'));
      const { category, stats } = readStats(card);

      setOpenInfo({
        name,
        role,
        category,
        art: art?.src ?? '',
        stats,
        definition,
      });
    };

    document.addEventListener('click', onClick);
    return () => document.removeEventListener('click', onClick);
  }, []);

  if (!openInfo) return null;
  return <DefenseInfoModal data={openInfo} onClose={() => setOpenInfo(null)} />;
}
