import { useMemo, useState, type CSSProperties } from 'react';

import planet01 from '../assets/source/universe-navigation/planets/planet.variant-01.png';
import planet02 from '../assets/source/universe-navigation/planets/planet.variant-02.png';
import planet03 from '../assets/source/universe-navigation/planets/planet.variant-03.png';
import planet04 from '../assets/source/universe-navigation/planets/planet.variant-04.png';
import planet05 from '../assets/source/universe-navigation/planets/planet.variant-05.png';
import planet06 from '../assets/source/universe-navigation/planets/planet.variant-06.png';
import planet07 from '../assets/source/universe-navigation/planets/planet.variant-07.png';
import planet08 from '../assets/source/universe-navigation/planets/planet.variant-08.png';
import planet09 from '../assets/source/universe-navigation/planets/planet.variant-09.png';
import planet10 from '../assets/source/universe-navigation/planets/planet.variant-10.png';
import planet11 from '../assets/source/universe-navigation/planets/planet.variant-11.png';
import planet12 from '../assets/source/universe-navigation/planets/planet.variant-12.png';

import star01 from '../assets/source/universe-navigation/system-stars/system-star.variant-01.png';
import star02 from '../assets/source/universe-navigation/system-stars/system-star.variant-02.png';
import star03 from '../assets/source/universe-navigation/system-stars/system-star.variant-03.png';
import star04 from '../assets/source/universe-navigation/system-stars/system-star.variant-04.png';
import star05 from '../assets/source/universe-navigation/system-stars/system-star.variant-05.png';
import star06 from '../assets/source/universe-navigation/system-stars/system-star.variant-06.png';

import asteroid01 from '../assets/source/universe-navigation/asteroids/asteroid.variant-01.png';
import asteroid02 from '../assets/source/universe-navigation/asteroids/asteroid.variant-02.png';
import asteroid03 from '../assets/source/universe-navigation/asteroids/asteroid.variant-03.png';
import asteroid04 from '../assets/source/universe-navigation/asteroids/asteroid.variant-04.png';

const planetArts = [planet01, planet02, planet03, planet04, planet05, planet06, planet07, planet08, planet09, planet10, planet11, planet12];
const starArts = [star01, star02, star03, star04, star05, star06];
const asteroidArts = [asteroid01, asteroid02, asteroid03, asteroid04];
const names = ['Helion', 'Lemiar', 'Varkon', 'Irmen', 'Ostorna', 'Emphria', 'Galaus', 'Lunaris', 'Kealir', 'Rinor', 'Velion', 'Nexar', 'Tekron', 'Astra', 'Orpheon', 'Talos', 'Meridia', 'Cyrene', 'Drakon', 'Erebus', 'Vega', 'Saros', 'Nyx', 'Ceres'];

const GALAXY = 1;
const GALAXY_COUNT = 1;
const SYSTEM_COUNT = 40;
const POSITION_COUNT = 24;

type Point = { x: number; y: number };
type PlanetNode = Point & { slot: number; name: string; art: string; owned: boolean };
type AsteroidNode = Point & { id: number; art: string };
type BeltRock = Point & { id: number; size: number; opacity: number };

type UniverseViewProps = {
  onNotice: (message: string) => void;
};

function mulberry32(seed: number) {
  return () => {
    let value = seed += 0x6D2B79F5;
    value = Math.imul(value ^ value >>> 15, value | 1);
    value ^= value + Math.imul(value ^ value >>> 7, value | 61);
    return ((value ^ value >>> 14) >>> 0) / 4294967296;
  };
}

/**
 * Stable 24-position orbital map: four rings, six addressable slots per ring.
 * A slot always stays in the same visual place in every system, so [G:S:P]
 * remains readable instead of planets appearing in arbitrary screen positions.
 */
function slotPoint(slot: number): Point {
  const ring = Math.floor((slot - 1) / 6);
  const index = (slot - 1) % 6;
  const radiusX = [19, 28, 36, 44][ring];
  const radiusY = [22, 27, 32, 37][ring];
  const offset = [-30, 0, -15, 15][ring];
  const angle = ((index * 60) + offset) * Math.PI / 180;

  return {
    x: 50 + Math.cos(angle) * radiusX,
    y: 52 + Math.sin(angle) * radiusY,
  };
}

function makeSystem(system: number) {
  const random = mulberry32(10_000 + system * 977);
  const slots = Array.from({ length: POSITION_COUNT }, (_, index) => index + 1);
  for (let i = slots.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [slots[i], slots[j]] = [slots[j], slots[i]];
  }

  const planetCount = 8 + (system % 7);
  const occupied = slots.slice(0, planetCount);
  if (system === 1 && !occupied.includes(1)) occupied[0] = 1;
  occupied.sort((a, b) => a - b);

  const planets: PlanetNode[] = occupied.map((slot) => {
    const point = slotPoint(slot);
    const owned = system === 1 && slot === 1;
    return {
      ...point,
      slot,
      owned,
      name: owned ? 'Helion 01' : `${names[(system * 7 + slot) % names.length]} ${String(system).padStart(2, '0')}`,
      art: planetArts[(system * 5 + slot) % planetArts.length],
    };
  });

  const asteroidCount = 2 + system % 3;
  const asteroids: AsteroidNode[] = Array.from({ length: asteroidCount }, (_, index) => {
    const angle = random() * Math.PI * 2;
    const radiusX = 30 + random() * 16;
    const radiusY = 24 + random() * 11;
    return {
      id: index,
      x: 50 + Math.cos(angle) * radiusX,
      y: 52 + Math.sin(angle) * radiusY,
      art: asteroidArts[(system + index) % asteroidArts.length],
    };
  });

  const belt: BeltRock[] = Array.from({ length: 38 }, (_, index) => {
    const angle = (index / 38) * Math.PI * 2 + random() * 0.055;
    const radiusX = 31.5 + (random() - 0.5) * 2.8;
    const radiusY = 27.5 + (random() - 0.5) * 2.2;
    return {
      id: index,
      x: 50 + Math.cos(angle) * radiusX,
      y: 52 + Math.sin(angle) * radiusY,
      size: 2 + Math.round(random() * 4),
      opacity: 0.18 + random() * 0.34,
    };
  });

  return {
    star: starArts[(system - 1) % starArts.length],
    planets,
    asteroids,
    belt,
  };
}

export function UniverseView({ onNotice }: UniverseViewProps) {
  const [system, setSystem] = useState(1);
  const [showCoords, setShowCoords] = useState(true);
  const [focusEmpty, setFocusEmpty] = useState(false);
  const [showAsteroids, setShowAsteroids] = useState(true);
  const systemData = useMemo(() => makeSystem(system), [system]);
  const occupiedSlots = useMemo(() => new Set(systemData.planets.map((planet) => planet.slot)), [systemData]);

  const goSystem = (next: number) => {
    const bounded = Math.min(SYSTEM_COUNT, Math.max(1, next));
    setSystem(bounded);
    onNotice(`Галактика ${GALAXY} · Солнечная система ${bounded}.`);
  };

  return (
    <main className="universe-view">
      <div className="universe-nav">
        <div className="universe-breadcrumb">
          <strong>Галактика {GALAXY}</strong><b>›</b><strong>Солнечная система {system}</strong>
        </div>

        <div className="universe-jump">
          <div className="nav-coordinate nav-coordinate--disabled">
            <span>ГАЛАКТИКА</span>
            <button className="step" type="button" disabled aria-label="Предыдущая галактика">◀</button>
            <strong>{GALAXY}<small>/ {GALAXY_COUNT}</small></strong>
            <button className="step" type="button" disabled aria-label="Следующая галактика">▶</button>
          </div>
          <div className="nav-coordinate nav-coordinate--system">
            <span>СИСТЕМА</span>
            <button className="step" type="button" onClick={() => goSystem(system - 1)} disabled={system === 1} aria-label="Предыдущая система">◀</button>
            <select value={system} onChange={(event) => goSystem(Number(event.target.value))} aria-label="Солнечная система">
              {Array.from({ length: SYSTEM_COUNT }, (_, index) => <option key={index + 1} value={index + 1}>{String(index + 1).padStart(2, '0')}</option>)}
            </select>
            <small>/ {SYSTEM_COUNT}</small>
            <button className="step" type="button" onClick={() => goSystem(system + 1)} disabled={system === SYSTEM_COUNT} aria-label="Следующая система">▶</button>
          </div>
        </div>
      </div>

      <div className="system-scene">
        <div className="system-caption"><span>ГАЛАКТИКА {GALAXY}</span><strong>СИСТЕМА {String(system).padStart(2, '0')}</strong><small>24 ПЛАНЕТАРНЫЕ ПОЗИЦИИ · ЦЕНТРАЛЬНАЯ ЗВЕЗДА</small></div>

        {[0, 1, 2, 3].map((ring) => <div key={ring} className={`system-orbit ring-${ring + 1}`} />)}

        {showAsteroids ? (
          <div className="procedural-asteroid-belt" aria-hidden="true">
            {systemData.belt.map((rock) => (
              <i
                key={rock.id}
                className="belt-rock"
                style={{ '--x': `${rock.x}%`, '--y': `${rock.y}%`, '--size': `${rock.size}px`, '--opacity': rock.opacity, '--delay': `${-(rock.id % 11) * 0.31}s` } as CSSProperties}
              />
            ))}
          </div>
        ) : null}

        <div className="system-star-wrap" aria-label={`Звезда солнечной системы ${system}`}>
          <span className="star-aura star-aura--outer" />
          <span className="star-aura star-aura--inner" />
          <img className="system-star" src={systemData.star} alt={`Звезда системы ${system}`} draggable={false} />
        </div>

        {Array.from({ length: POSITION_COUNT }, (_, index) => index + 1).filter((slot) => !occupiedSlots.has(slot)).map((slot) => {
          const point = slotPoint(slot);
          return (
            <button
              key={slot}
              type="button"
              className={`empty-slot ${focusEmpty ? 'emphasized' : ''}`}
              style={{ '--x': `${point.x}%`, '--y': `${point.y}%` } as CSSProperties}
              title={`Свободная позиция [1:${system}:${slot}]`}
              onClick={() => onNotice(`Свободная позиция [1:${system}:${slot}].`)}
            >
              <span>{slot}</span>
              <small>[1:{system}:{slot}]</small>
            </button>
          );
        })}

        {systemData.planets.map((planet) => (
          <button
            type="button"
            key={planet.slot}
            className={`system-planet ${planet.owned ? 'owned' : ''}`}
            style={{ '--x': `${planet.x}%`, '--y': `${planet.y}%`, '--delay': `${-(planet.slot % 7) * 0.47}s`, '--spin': `${150 + planet.slot * 3}s` } as CSSProperties}
            onClick={() => onNotice(`${planet.name} · [1:${system}:${planet.slot}]`)}
          >
            <img src={planet.art} alt="" draggable={false} />
            <span className="planet-slot">{planet.slot}</span>
            <span className="planet-name">{planet.owned ? '★ ' : ''}{planet.name}</span>
            {showCoords ? <small>[1:{system}:{planet.slot}]</small> : null}
          </button>
        ))}

        {showAsteroids ? systemData.asteroids.map((asteroid) => (
          <button type="button" key={asteroid.id} className="system-asteroid" style={{ '--x': `${asteroid.x}%`, '--y': `${asteroid.y}%` } as CSSProperties} onClick={() => onNotice(`Астероидное поле · Галактика 1 / Система ${system}.`)}>
            <img src={asteroid.art} alt="Астероид" draggable={false} />
            <span>Астероид</span>
          </button>
        )) : null}
      </div>

      <aside className="universe-tools">
        <button type="button" className={focusEmpty ? 'active' : ''} onClick={() => setFocusEmpty((value) => !value)}><b>▽</b><span>Фильтры</span><small>Свободные позиции</small></button>
        <button type="button" className={showCoords ? 'active' : ''} onClick={() => setShowCoords((value) => !value)}><b>⌖</b><span>Метки</span><small>Координаты</small></button>
        <button type="button" className={showAsteroids ? 'active' : ''} onClick={() => setShowAsteroids((value) => !value)}><b>◌</b><span>Астероиды</span><small>Пояс и поля</small></button>
        <button type="button" onClick={() => onNotice('Маршруты флотов появятся после модуля «Флоты».')}><b>⇄</b><span>Маршруты</span><small>Скоро</small></button>
        <button type="button" onClick={() => onNotice('Глубокий сканер будет связан с технологиями и разведкой.')}><b>◎</b><span>Сканер</span><small>Скоро</small></button>
      </aside>
    </main>
  );
}
