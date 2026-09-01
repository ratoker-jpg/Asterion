import { useEffect, useMemo, useState, type CSSProperties } from 'react';

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

import generated002 from '../assets/source/planets/skins/planet-002.png';
import generated003 from '../assets/source/planets/skins/planet-003.png';
import generated005 from '../assets/source/planets/skins/planet-005.png';
import generated011 from '../assets/source/planets/skins/planet-011.png';
import generated012 from '../assets/source/planets/skins/planet-012.png';
import generated015 from '../assets/source/planets/skins/planet-015.png';
import generated016 from '../assets/source/planets/skins/planet-016.png';
import generated026 from '../assets/source/planets/skins/planet-026.png';
import generated027 from '../assets/source/planets/skins/planet-027.png';
import generated028 from '../assets/source/planets/skins/planet-028.png';
import generated030 from '../assets/source/planets/skins/planet-030.png';
import generated032 from '../assets/source/planets/skins/planet-032.png';

import star01 from '../assets/source/universe-navigation/system-stars/system-star.variant-01.png';
import star02 from '../assets/source/universe-navigation/system-stars/system-star.variant-02.png';
import star03 from '../assets/source/universe-navigation/system-stars/system-star.variant-03.png';
import star04 from '../assets/source/universe-navigation/system-stars/system-star.variant-04.png';
import star05 from '../assets/source/universe-navigation/system-stars/system-star.variant-05.png';
import star06 from '../assets/source/universe-navigation/system-stars/system-star.variant-06.png';

const planetArts = [
  planet01, planet02, planet03, planet04, planet05, planet06, planet07, planet08, planet09, planet10, planet11, planet12,
  generated002, generated003, generated005, generated011, generated012, generated015, generated016, generated026, generated027, generated028, generated030, generated032,
];
const starArts = [star01, star02, star03, star04, star05, star06];
const names = ['Helion', 'Lemiar', 'Varkon', 'Irmen', 'Ostorna', 'Emphria', 'Galaus', 'Lunaris', 'Kealir', 'Rinor', 'Velion', 'Nexar', 'Tekron', 'Astra', 'Orpheon', 'Talos', 'Meridia', 'Cyrene', 'Drakon', 'Erebus', 'Vega', 'Saros', 'Nyx', 'Ceres'];

const GALAXY = 1;
const SYSTEM_COUNT = 40;
const POSITION_COUNT = 24;

// Intentionally very slow. The motion should be perceived over time rather than
// compete with navigation. All rings rotate in one direction like one system.
const ORBIT_PERIODS = [1_800_000, 2_520_000, 3_360_000, 4_320_000];

type Point = { x: number; y: number };
type PlanetNode = { slot: number; name: string; art: string; owned: boolean };

type UniverseViewProps = {
  onNotice: (message: string) => void;
  ownedPlanetArt: string;
};

function mulberry32(seed: number) {
  return () => {
    let value = seed += 0x6D2B79F5;
    value = Math.imul(value ^ value >>> 15, value | 1);
    value ^= value + Math.imul(value ^ value >>> 7, value | 61);
    return ((value ^ value >>> 14) >>> 0) / 4294967296;
  };
}

/** Stable 24-position address map with a subtle live orbital phase. */
function slotPoint(slot: number, now: number): Point {
  const ring = Math.floor((slot - 1) / 6);
  const index = (slot - 1) % 6;
  const radiusX = [19, 28, 36, 44][ring];
  const radiusY = [22, 27, 32, 37][ring];
  const offset = [-30, 0, -15, 15][ring];
  const phase = ((now % ORBIT_PERIODS[ring]) / ORBIT_PERIODS[ring]) * 360;
  const angle = ((index * 60) + offset + phase) * Math.PI / 180;

  return {
    x: 50 + Math.cos(angle) * radiusX,
    y: 52 + Math.sin(angle) * radiusY,
  };
}

function makeSystem(system: number, ownedPlanetArt: string) {
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
    const owned = system === 1 && slot === 1;
    return {
      slot,
      owned,
      name: owned ? 'Helion 01' : `${names[(system * 7 + slot) % names.length]} ${String(system).padStart(2, '0')}`,
      art: owned ? ownedPlanetArt : planetArts[(system * 5 + slot) % planetArts.length],
    };
  });

  return {
    star: starArts[(system - 1) % starArts.length],
    planets,
  };
}

export function UniverseView({ onNotice, ownedPlanetArt }: UniverseViewProps) {
  const [system, setSystem] = useState(1);
  const [showCoords, setShowCoords] = useState(true);
  const [focusEmpty, setFocusEmpty] = useState(false);
  const [orbitNow, setOrbitNow] = useState(Date.now());
  const systemData = useMemo(() => makeSystem(system, ownedPlanetArt), [system, ownedPlanetArt]);
  const occupiedSlots = useMemo(() => new Set(systemData.planets.map((planet) => planet.slot)), [systemData]);

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return undefined;
    const timer = window.setInterval(() => setOrbitNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const goSystem = (next: number) => {
    const bounded = Math.min(SYSTEM_COUNT, Math.max(1, next));
    setSystem(bounded);
    onNotice(`Галактика ${GALAXY} · Солнечная система ${bounded}.`);
  };

  return (
    <main className="universe-view universe-view-v3">
      <div className="universe-nav universe-nav-v3">
        <div className="universe-breadcrumb">
          <span>ВСЕЛЕННАЯ</span><b>›</b><strong>Галактика {GALAXY}</strong><b>›</b><strong>Солнечная система {system}</strong>
        </div>

        <div className="universe-jump universe-jump-v3">
          <div className="galaxy-readout"><small>ГАЛАКТИКА</small><strong>01</strong></div>
          <div className="system-stepper">
            <button type="button" onClick={() => goSystem(system - 1)} disabled={system === 1} aria-label="Предыдущая система">‹</button>
            <label><small>СИСТЕМА</small><select value={system} onChange={(event) => goSystem(Number(event.target.value))} aria-label="Солнечная система">{Array.from({ length: SYSTEM_COUNT }, (_, index) => <option key={index + 1} value={index + 1}>{String(index + 1).padStart(2, '0')}</option>)}</select></label>
            <em>/ {SYSTEM_COUNT}</em>
            <button type="button" onClick={() => goSystem(system + 1)} disabled={system === SYSTEM_COUNT} aria-label="Следующая система">›</button>
          </div>
        </div>
      </div>

      <div className="system-scene">
        <div className="system-caption"><span>ГАЛАКТИКА {GALAXY}</span><strong>СИСТЕМА {String(system).padStart(2, '0')}</strong><small>24 ПЛАНЕТАРНЫЕ ПОЗИЦИИ · ЦЕНТРАЛЬНАЯ ЗВЕЗДА</small></div>

        {[0, 1, 2, 3].map((ring) => <div key={ring} className={`system-orbit ring-${ring + 1}`} />)}

        <div className="system-star-wrap" aria-label={`Звезда солнечной системы ${system}`}>
          <img className="system-star" src={systemData.star} alt={`Звезда системы ${system}`} draggable={false} />
        </div>

        {Array.from({ length: POSITION_COUNT }, (_, index) => index + 1).filter((slot) => !occupiedSlots.has(slot)).map((slot) => {
          const point = slotPoint(slot, orbitNow);
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

        {systemData.planets.map((planet) => {
          const point = slotPoint(planet.slot, orbitNow);
          return (
            <button
              type="button"
              key={planet.slot}
              className={`system-planet ${planet.owned ? 'owned' : ''}`}
              style={{ '--x': `${point.x}%`, '--y': `${point.y}%` } as CSSProperties}
              onClick={() => onNotice(`${planet.name} · [1:${system}:${planet.slot}]`)}
            >
              <img src={planet.art} alt="" draggable={false} />
              <span className="planet-slot">{planet.slot}</span>
              <span className="planet-name">{planet.owned ? '★ ' : ''}{planet.name}</span>
              {showCoords ? <small>[1:{system}:{planet.slot}]</small> : null}
            </button>
          );
        })}
      </div>

      <aside className="universe-tools">
        <button type="button" className={focusEmpty ? 'active' : ''} onClick={() => setFocusEmpty((value) => !value)}><b>▽</b><span>Фильтры</span><small>Свободные позиции</small></button>
        <button type="button" className={showCoords ? 'active' : ''} onClick={() => setShowCoords((value) => !value)}><b>⌖</b><span>Метки</span><small>Координаты</small></button>
        <button type="button" onClick={() => onNotice('Астероидные пояса вернутся позже и будут жёстко привязаны к орбитальным линиям.')}><b>◌</b><span>Астероиды</span><small>Позже</small></button>
        <button type="button" onClick={() => onNotice('Маршруты флотов появятся после модуля «Флоты».')}><b>⇄</b><span>Маршруты</span><small>Скоро</small></button>
        <button type="button" onClick={() => onNotice('Глубокий сканер будет связан с технологиями и разведкой.')}><b>◎</b><span>Сканер</span><small>Скоро</small></button>
      </aside>
    </main>
  );
}
