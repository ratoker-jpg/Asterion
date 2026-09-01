import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import './planet-skins.css';
import './universe.css';
import { UniverseView } from './UniverseView';

import systemBackground from '../assets/source/starter/backgrounds/system_background.png';
import planetColonized from '../assets/source/starter/planets/planet_colonized.png';
import planetTerran from '../assets/source/starter/planets/planet_terran.png';
import planetOceanic from '../assets/source/starter/planets/planet_oceanic.png';
import planetDesert from '../assets/source/starter/planets/planet_desert.png';
import planetIce from '../assets/source/starter/planets/planet_ice.png';
import planetVolcanic from '../assets/source/starter/planets/planet_volcanic.png';
import planetToxic from '../assets/source/starter/planets/planet_toxic.png';
import planetBarren from '../assets/source/starter/planets/planet_barren_rocky.png';
import planetGas from '../assets/source/starter/planets/planet_gas_giant.png';

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

const planetSkins = [
  { id: 'colonized', label: 'Колония', art: planetColonized },
  { id: 'terran', label: 'Терран', art: planetTerran },
  { id: 'oceanic', label: 'Океан', art: planetOceanic },
  { id: 'desert', label: 'Пустыня', art: planetDesert },
  { id: 'ice', label: 'Ледяная', art: planetIce },
  { id: 'volcanic', label: 'Вулкан', art: planetVolcanic },
  { id: 'toxic', label: 'Токсичная', art: planetToxic },
  { id: 'barren', label: 'Каменная', art: planetBarren },
  { id: 'gas', label: 'Газовый гигант', art: planetGas },
  { id: 'skin-002', label: 'Облик 002', art: generated002 },
  { id: 'skin-003', label: 'Облик 003', art: generated003 },
  { id: 'skin-005', label: 'Облик 005', art: generated005 },
  { id: 'skin-011', label: 'Облик 011', art: generated011 },
  { id: 'skin-012', label: 'Облик 012', art: generated012 },
  { id: 'skin-015', label: 'Облик 015', art: generated015 },
  { id: 'skin-016', label: 'Облик 016', art: generated016 },
  { id: 'skin-026', label: 'Облик 026', art: generated026 },
  { id: 'skin-027', label: 'Облик 027', art: generated027 },
  { id: 'skin-028', label: 'Облик 028', art: generated028 },
  { id: 'skin-030', label: 'Облик 030', art: generated030 },
  { id: 'skin-032', label: 'Облик 032', art: generated032 },
] as const;

type PlanetSkin = (typeof planetSkins)[number]['id'];
type PlanetId = 'helion-01' | 'lemay-07' | 'ostrogo-19';
type Zone = 'resource' | 'industry' | 'military';
type IconKind = 'metal' | 'mineral' | 'gas' | 'energy' | 'population' | Zone;

type QueueItem = {
  id: 'solar-station';
  name: string;
  planetId: PlanetId;
  startedAt: number;
  finishAt: number;
};

type PlanetRuntime = {
  skin: PlanetSkin;
  population: number;
  populationMax: number;
  energy: number;
  solarStations: number;
  stability: number;
};

type SaveState = {
  metal: number;
  minerals: number;
  gas: number;
  currentPlanetId: PlanetId;
  planets: Record<PlanetId, PlanetRuntime>;
  queues: Record<PlanetId, QueueItem | null>;
};

type PlanetDefinition = {
  id: PlanetId;
  name: string;
  coords: string;
  status: 'Основная планета' | 'Колония';
  faction: 'Aegis';
};

const ownedPlanets: PlanetDefinition[] = [
  { id: 'helion-01', name: 'Helion 01', coords: '[1:1:1]', status: 'Основная планета', faction: 'Aegis' },
  { id: 'lemay-07', name: 'Lemay', coords: '[1:7:12]', status: 'Колония', faction: 'Aegis' },
  { id: 'ostrogo-19', name: 'Ostrogo', coords: '[1:19:4]', status: 'Колония', faction: 'Aegis' },
];

const SAVE_KEY = 'asterion.vertical-slice.v1';
const BUILD_TIME_MS = 45_000;
const BUILD_COST = 1200;

const initialState: SaveState = {
  metal: 15_880,
  minerals: 12_712,
  gas: 6_421,
  currentPlanetId: 'helion-01',
  planets: {
    'helion-01': { skin: 'colonized', population: 4, populationMax: 70, energy: 140, solarStations: 0, stability: 100 },
    'lemay-07': { skin: 'skin-026', population: 12, populationMax: 90, energy: 210, solarStations: 2, stability: 96 },
    'ostrogo-19': { skin: 'desert', population: 3, populationMax: 60, energy: 95, solarStations: 0, stability: 91 },
  },
  queues: {
    'helion-01': null,
    'lemay-07': null,
    'ostrogo-19': null,
  },
};

const tabs = ['Планета', 'Вселенная', 'Флоты', 'Операции', 'Наука', 'Командование', 'Отчёты', 'Рейтинг', 'Настройки'];
const zoneMeta: Record<Zone, { title: string; subtitle: string; accent: string }> = {
  resource: { title: 'РЕСУРСНАЯ ЗОНА', subtitle: 'Добыча и энергия', accent: '#38c8ff' },
  industry: { title: 'ПРОМЫШЛЕННАЯ ЗОНА', subtitle: 'Производство', accent: '#f0ad38' },
  military: { title: 'ВОЕННАЯ ЗОНА', subtitle: 'Оборона и флот', accent: '#ee665d' },
};

const planetIds = ownedPlanets.map((planet) => planet.id);
const isPlanetId = (value: unknown): value is PlanetId => typeof value === 'string' && planetIds.includes(value as PlanetId);
const isPlanetSkin = (value: unknown): value is PlanetSkin => planetSkins.some((skin) => skin.id === value);

function readSave(): SaveState {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return initialState;

    const parsed = JSON.parse(raw) as Partial<SaveState> & {
      planetSkin?: PlanetSkin;
      population?: number;
      energy?: number;
      solarStations?: number;
      queue?: Omit<QueueItem, 'planetId'> | QueueItem | null;
    };

    const currentPlanetId = isPlanetId(parsed.currentPlanetId) ? parsed.currentPlanetId : 'helion-01';
    const planets = { ...initialState.planets };

    for (const definition of ownedPlanets) {
      const saved = parsed.planets?.[definition.id];
      if (!saved) continue;
      planets[definition.id] = {
        ...planets[definition.id],
        ...saved,
        skin: isPlanetSkin(saved.skin) ? saved.skin : planets[definition.id].skin,
      };
    }

    if (parsed.planetSkin && isPlanetSkin(parsed.planetSkin)) {
      planets['helion-01'] = {
        ...planets['helion-01'],
        skin: parsed.planetSkin,
        population: parsed.population ?? planets['helion-01'].population,
        energy: parsed.energy ?? planets['helion-01'].energy,
        solarStations: parsed.solarStations ?? planets['helion-01'].solarStations,
      };
    }

    const queues = { ...initialState.queues, ...(parsed.queues ?? {}) };
    if (parsed.queue && !parsed.queues) {
      queues['helion-01'] = { ...parsed.queue, planetId: 'helion-01' };
    }

    return {
      metal: parsed.metal ?? initialState.metal,
      minerals: parsed.minerals ?? initialState.minerals,
      gas: parsed.gas ?? initialState.gas,
      currentPlanetId,
      planets,
      queues,
    };
  } catch {
    return initialState;
  }
}

function formatNumber(value: number) {
  return new Intl.NumberFormat('ru-RU').format(value);
}

function formatCountdown(ms: number) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

function useStageScale() {
  const calc = () => Math.min(window.innerWidth / 1920, window.innerHeight / 1080);
  const [scale, setScale] = useState(calc);
  useEffect(() => {
    const onResize = () => setScale(calc());
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  return scale;
}

function GameIcon({ kind }: { kind: IconKind }) {
  const common = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.65, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };

  if (kind === 'metal') return <svg viewBox="0 0 24 24" aria-hidden="true"><path {...common} d="M4 7 12 3l8 4-8 4-8-4Z"/><path {...common} d="m4 7 8 4v10l-8-4V7Zm16 0-8 4v10l8-4V7Z"/></svg>;
  if (kind === 'mineral') return <svg viewBox="0 0 24 24" aria-hidden="true"><path {...common} d="m12 2 7 7-7 13L5 9l7-7Z"/><path {...common} d="M5 9h14M12 2v20"/></svg>;
  if (kind === 'gas') return <svg viewBox="0 0 24 24" aria-hidden="true"><path {...common} d="M12 3c4 4.7 6 7.6 6 11a6 6 0 1 1-12 0c0-3.4 2-6.3 6-11Z"/><circle {...common} cx="10" cy="13" r="1.8"/><circle {...common} cx="14.5" cy="15.5" r="1.2"/></svg>;
  if (kind === 'energy') return <svg viewBox="0 0 24 24" aria-hidden="true"><path {...common} d="m13 2-7 12h6l-1 8 7-12h-6l1-8Z"/></svg>;
  if (kind === 'population') return <svg viewBox="0 0 24 24" aria-hidden="true"><circle {...common} cx="9" cy="8" r="3"/><circle {...common} cx="16.5" cy="9.5" r="2.3"/><path {...common} d="M3.5 20c.5-4.2 2.5-6.3 5.5-6.3s5 2.1 5.5 6.3M14 14.6c3.5-.5 5.6 1.3 6.5 5.4"/></svg>;
  if (kind === 'resource') return <svg viewBox="0 0 24 24" aria-hidden="true"><path {...common} d="m12 2 4 6-4 6-4-6 4-6Zm-6 9 3 4-3 5-3-5 3-4Zm12 0 3 4-3 5-3-5 3-4Z"/></svg>;
  if (kind === 'industry') return <svg viewBox="0 0 24 24" aria-hidden="true"><path {...common} d="M3 21V10l6 3v-3l6 3V6h4v15H3Z"/><path {...common} d="M6 17h2m3 0h2m3 0h2M16 6V3h3v3"/></svg>;
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path {...common} d="M4 19h16M7 19v-4l4-2V8l2-2 2 2v5l3 2v4M11 10h4M9 19v-3m6 3v-4"/><path {...common} d="m12 6 1-4 1 4"/></svg>;
}

function Resource({ kind, label, value, gain }: { kind: Exclude<IconKind, Zone>; label: string; value: string; gain?: string }) {
  return (
    <div className={`resource-chip resource-chip--${kind}`}>
      <span className="resource-chip__icon"><GameIcon kind={kind} /></span>
      <span className="resource-chip__text">
        <small>{label}</small>
        <strong>{value}</strong>
        {gain ? <em>{gain}</em> : null}
      </span>
    </div>
  );
}

function AegisButton({ children, onClick, disabled = false }: { children: ReactNode; onClick: () => void; disabled?: boolean }) {
  return <button className="aegis-button" disabled={disabled} onClick={onClick}><span>{children}</span></button>;
}

export function App() {
  const scale = useStageScale();
  const [zone, setZone] = useState<Zone>('resource');
  const [activeTab, setActiveTab] = useState('Планета');
  const [state, setState] = useState<SaveState>(readSave);
  const [now, setNow] = useState(Date.now());
  const [notice, setNotice] = useState('Система готова. Локальное сохранение активно.');
  const [planetMenuOpen, setPlanetMenuOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(true);
  const [editingPlanetId, setEditingPlanetId] = useState<PlanetId | null>(null);

  useEffect(() => localStorage.setItem(SAVE_KEY, JSON.stringify(state)), [state]);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    const completed = ownedPlanets.find((planet) => {
      const queue = state.queues[planet.id];
      return queue && now >= queue.finishAt;
    });
    if (!completed) return;

    setState((current) => {
      const queue = current.queues[completed.id];
      if (!queue || Date.now() < queue.finishAt) return current;
      return {
        ...current,
        planets: {
          ...current.planets,
          [completed.id]: {
            ...current.planets[completed.id],
            solarStations: current.planets[completed.id].solarStations + 1,
            energy: current.planets[completed.id].energy + 25,
          },
        },
        queues: { ...current.queues, [completed.id]: null },
      };
    });
    setNotice(`${completed.name}: солнечная станция построена. Производство энергии увеличено.`);
  }, [now, state.queues]);

  const currentPlanet = useMemo(
    () => ownedPlanets.find((planet) => planet.id === state.currentPlanetId) ?? ownedPlanets[0],
    [state.currentPlanetId],
  );
  const currentPlanetState = state.planets[currentPlanet.id];
  const currentSkin = useMemo(
    () => planetSkins.find((skin) => skin.id === currentPlanetState.skin) ?? planetSkins[0],
    [currentPlanetState.skin],
  );
  const helionSkin = planetSkins.find((skin) => skin.id === state.planets['helion-01'].skin) ?? planetSkins[0];
  const currentQueue = state.queues[currentPlanet.id];

  const editingPlanet = editingPlanetId ? ownedPlanets.find((planet) => planet.id === editingPlanetId) ?? null : null;
  const editingPlanetState = editingPlanet ? state.planets[editingPlanet.id] : null;

  const progress = useMemo(() => {
    if (!currentQueue) return 0;
    return Math.min(100, Math.max(0, ((now - currentQueue.startedAt) / (currentQueue.finishAt - currentQueue.startedAt)) * 100));
  }, [now, currentQueue]);

  const selectPlanet = (planetId: PlanetId) => {
    const planet = ownedPlanets.find((item) => item.id === planetId) ?? ownedPlanets[0];
    setState((current) => ({ ...current, currentPlanetId: planet.id }));
    setPlanetMenuOpen(false);
    setNotice(`${planet.name} ${planet.coords} выбрана как текущая планета.`);
  };

  const openPlanetEditor = (planetId: PlanetId) => {
    setState((current) => ({ ...current, currentPlanetId: planetId }));
    setActiveTab('Планета');
    setPlanetMenuOpen(false);
    setEditingPlanetId(planetId);
  };

  const chooseSkin = (skin: (typeof planetSkins)[number]) => {
    if (!editingPlanetId) return;
    const planet = ownedPlanets.find((item) => item.id === editingPlanetId) ?? ownedPlanets[0];
    setState((current) => ({
      ...current,
      planets: {
        ...current.planets,
        [editingPlanetId]: { ...current.planets[editingPlanetId], skin: skin.id },
      },
    }));
    setEditingPlanetId(null);
    setNotice(`Облик ${planet.name} изменён: ${skin.label}.`);
  };

  const build = () => {
    if (currentQueue) return setNotice('Очередь этой планеты уже занята.');
    if (state.metal < BUILD_COST) return setNotice('Недостаточно металла.');
    const startedAt = Date.now();
    setState((current) => ({
      ...current,
      metal: current.metal - BUILD_COST,
      queues: {
        ...current.queues,
        [currentPlanet.id]: {
          id: 'solar-station',
          name: 'Солнечная станция',
          planetId: currentPlanet.id,
          startedAt,
          finishAt: startedAt + BUILD_TIME_MS,
        },
      },
    }));
    setNotice(`${currentPlanet.name}: солнечная станция добавлена в очередь. −${formatNumber(BUILD_COST)} металла.`);
  };

  const reset = () => {
    localStorage.removeItem(SAVE_KEY);
    setState(initialState);
    setPlanetMenuOpen(false);
    setEditingPlanetId(null);
    setDetailsOpen(true);
    setNotice('Сохранение прототипа сброшено.');
  };

  const chooseTab = (tab: string) => {
    setActiveTab(tab);
    setPlanetMenuOpen(false);
    setEditingPlanetId(null);
    if (tab === 'Вселенная') setNotice('Галактика 1 загружена. Доступно 40 солнечных систем.');
    else if (tab !== 'Планета') setNotice(`Экран «${tab}» пока в разработке.`);
  };

  const chooseZone = (nextZone: Zone) => {
    setZone(nextZone);
    setActiveTab('Планета');
    setPlanetMenuOpen(false);
    setEditingPlanetId(null);
    setNotice(`${zoneMeta[nextZone].title}: модуль выбран для ${currentPlanet.name}.`);
  };

  const remaining = currentQueue ? currentQueue.finishAt - now : 0;
  const zoneInfo = zoneMeta[zone];

  return (
    <div className="viewport">
      <div className="stage stage-shell-v3 stage-shell-v4" style={{ transform: `scale(${scale})`, '--space-bg': `url(${systemBackground})` } as CSSProperties}>
        <header className="persistent-header persistent-header-v4">
          <section className="persistent-header__planet persistent-header__planet-v4">
            <div className="header-planet-orbit-v4">
              <button className="header-planet-world-v4" type="button" onClick={() => chooseTab('Планета')} aria-label={`Открыть ${currentPlanet.name}`}>
                <img src={currentSkin.art} alt={currentPlanet.name} draggable={false} />
              </button>
              {(['resource', 'industry', 'military'] as Zone[]).map((item) => (
                <button
                  key={item}
                  type="button"
                  className={`header-zone-v4 header-zone-v4--${item} ${zone === item && activeTab === 'Планета' ? 'active' : ''}`}
                  title={zoneMeta[item].title}
                  onClick={() => chooseZone(item)}
                >
                  <GameIcon kind={item} />
                </button>
              ))}
            </div>

            <div className="current-planet-control current-planet-control-v4">
              <button className="current-planet-select current-planet-select-v4" type="button" onClick={() => setPlanetMenuOpen((open) => !open)}>
                <img src={currentSkin.art} alt={currentPlanet.name} draggable={false} />
                <span>
                  <small>ТЕКУЩАЯ ПЛАНЕТА</small>
                  <strong>{currentPlanet.name} <em>{currentPlanet.coords}</em></strong>
                </span>
                <i>{planetMenuOpen ? '⌃' : '⌄'}</i>
              </button>
            </div>

            {planetMenuOpen ? (
              <div className="planet-list-popover planet-list-popover-v4">
                {ownedPlanets.map((planet) => {
                  const planetState = state.planets[planet.id];
                  const skin = planetSkins.find((item) => item.id === planetState.skin) ?? planetSkins[0];
                  return (
                    <button key={planet.id} type="button" className={planet.id === currentPlanet.id ? 'active' : ''} onClick={() => selectPlanet(planet.id)}>
                      <img src={skin.art} alt="" />
                      <span><strong>{planet.name}</strong><small>{planet.coords} · {planet.status}</small></span>
                      <b>{planet.id === currentPlanet.id ? '✓' : ''}</b>
                    </button>
                  );
                })}
              </div>
            ) : null}
          </section>

          <section className="persistent-header__center persistent-header__center-v4">
            <nav className="main-tabs shell-tabs">
              {tabs.map((tab) => (
                <button key={tab} className={activeTab === tab ? 'active' : ''} onClick={() => chooseTab(tab)}><span>{tab}</span></button>
              ))}
            </nav>
            <div className="resources shell-resources">
              <Resource kind="metal" label="МЕТАЛЛ" value={`${formatNumber(state.metal)} / 60 000`} gain="+774/ч" />
              <Resource kind="mineral" label="МИНЕРАЛЫ" value={`${formatNumber(state.minerals)} / 60 000`} gain="+510/ч" />
              <Resource kind="gas" label="ГАЗ" value={`${formatNumber(state.gas)} / 60 000`} gain="+312/ч" />
              <Resource kind="energy" label="ЭНЕРГИЯ" value={formatNumber(currentPlanetState.energy)} gain="+22/ч" />
              <Resource kind="population" label="НАСЕЛЕНИЕ" value={`${currentPlanetState.population} / ${currentPlanetState.populationMax}`} />
            </div>
          </section>

          <section className="campaign-block shell-campaign shell-campaign-v4">
            <span className="campaign-icon">✦</span>
            <div><strong>КАМПАНИЯ АКТИВНА</strong><small>F11 — полный экран</small></div>
            <time>{new Date(now).toLocaleTimeString('ru-RU', { hour12: false })}</time>
          </section>
        </header>

        <section className={`workspace workspace-v4 workspace--${activeTab === 'Вселенная' ? 'universe' : activeTab === 'Планета' ? 'planet' : 'module'}`}>
          {activeTab === 'Вселенная' ? (
            <UniverseView onNotice={setNotice} ownedPlanetArt={helionSkin.art} />
          ) : activeTab === 'Планета' ? (
            <div className="planet-page-v3 planet-page-v4">
              <aside className="planet-summary-v3 planet-list-panel-v4">
                <div className="page-panel-title"><strong>ПЛАНЕТЫ</strong><small>{ownedPlanets.length} КОЛОНИИ</small></div>

                <div className="owned-planets-v4">
                  {ownedPlanets.map((planet) => {
                    const planetState = state.planets[planet.id];
                    const skin = planetSkins.find((item) => item.id === planetState.skin) ?? planetSkins[0];
                    return (
                      <div key={planet.id} className={`owned-planet-row-v4 ${planet.id === currentPlanet.id ? 'active' : ''}`}>
                        <button className="owned-planet-main-v4" type="button" onClick={() => selectPlanet(planet.id)}>
                          <img src={skin.art} alt="" />
                          <span><strong>{planet.name}</strong><small>{planet.coords} · {planet.status}</small></span>
                        </button>
                        <button className="owned-planet-edit-v4" type="button" title={`Изменить облик ${planet.name}`} onClick={() => openPlanetEditor(planet.id)}>✎</button>
                      </div>
                    );
                  })}
                </div>

                <button className={`planet-details-toggle-v4 ${detailsOpen ? 'open' : ''}`} type="button" onClick={() => setDetailsOpen((open) => !open)}>
                  <span>ПОДРОБНЕЕ О {currentPlanet.name.toUpperCase()}</span><b>{detailsOpen ? '⌃' : '⌄'}</b>
                </button>

                {detailsOpen ? (
                  <div className="planet-details-v4">
                    <dl>
                      <div><dt>Статус</dt><dd>{currentPlanet.status === 'Основная планета' ? '★ ' : ''}{currentPlanet.status}</dd></div>
                      <div><dt>Фракция</dt><dd>{currentPlanet.faction}</dd></div>
                      <div><dt>Координаты</dt><dd>{currentPlanet.coords}</dd></div>
                      <div><dt>Население</dt><dd>{currentPlanetState.population} / {currentPlanetState.populationMax}</dd></div>
                      <div><dt>Энергия</dt><dd>{currentPlanetState.energy}</dd></div>
                      <div><dt>Солнечные станции</dt><dd>{currentPlanetState.solarStations}</dd></div>
                      <div><dt>Стабильность</dt><dd className="summary-stable">{currentPlanetState.stability}%</dd></div>
                    </dl>
                  </div>
                ) : null}
              </aside>

              <main className="planet-canvas-v3">
                <div className="scene-title scene-title-v3">
                  <small>{zoneInfo.title}</small>
                  <h1>{currentPlanet.name.toUpperCase()}</h1>
                  <p>{currentPlanet.coords} • {currentPlanet.status === 'Основная планета' ? 'AEGIS HOMEWORLD' : 'AEGIS COLONY'}</p>
                </div>
                <div className="planet-stage-v3">
                  <div className="planet-atmosphere" />
                  <img className="planet-image-v3" src={currentSkin.art} alt={currentPlanet.name} draggable={false} />
                  {(['resource', 'industry', 'military'] as Zone[]).map((item) => (
                    <button
                      key={item}
                      type="button"
                      className={`zone-hotspot zone-hotspot--${item} ${zone === item ? 'active' : ''}`}
                      style={{ '--zone-accent': zoneMeta[item].accent } as CSSProperties}
                      onClick={() => chooseZone(item)}
                    >
                      <span className="zone-hotspot__icon"><GameIcon kind={item} /></span>
                      <span className="zone-hotspot__label"><strong>{zoneMeta[item].title.replace(' ЗОНА', '')}</strong><small>ЗОНА</small></span>
                    </button>
                  ))}
                </div>
                <div className="planet-status planet-status-v2"><span>●</span> СТАБИЛЬНО <i /> ONLINE</div>
              </main>

              <aside className="queue-panel-v3">
                <div className="page-panel-title"><strong>ОЧЕРЕДЬ СТРОИТЕЛЬСТВА</strong><small>{currentQueue ? 1 : 0} / 4</small></div>
                <div className={`queue-card-v2 ${currentQueue ? 'busy' : ''}`}>
                  <span className="queue-card-v2__icon"><GameIcon kind="energy" /></span>
                  <span><strong>{currentQueue?.name ?? 'Свободный слот'}</strong><small>{currentQueue ? `Осталось ${formatCountdown(remaining)}` : 'Готов к строительству'}</small></span>
                  <b>{currentQueue ? 'I' : '+'}</b>
                  {currentQueue ? <div className="queue-progress-v2"><i style={{ width: `${progress}%` }} /></div> : null}
                </div>
                {[2, 3, 4].map((slot) => (
                  <div className="queue-card-v2 locked" key={slot}><span className="queue-card-v2__lock">▣</span><span><strong>Слот 0{slot}</strong><small>Заблокирован</small></span></div>
                ))}
                <div className="build-preview-v2">
                  <span className="build-preview-v2__icon"><GameIcon kind="energy" /></span>
                  <div><strong>Солнечная станция I</strong><small>+25 энергии после завершения</small></div>
                  <b><GameIcon kind="metal" /> {formatNumber(BUILD_COST)}</b>
                </div>
                <AegisButton onClick={build} disabled={Boolean(currentQueue)}>ПОСТРОИТЬ</AegisButton>
              </aside>
            </div>
          ) : (
            <main className="module-placeholder-v3">
              <span>ASTERION COMMAND MODULE</span>
              <h1>{activeTab.toUpperCase()}</h1>
              <p>Верхняя командная панель остаётся неизменной. Этот рабочий экран будет реализован отдельным модулем.</p>
            </main>
          )}
        </section>

        <div className="shell-notice shell-notice-v4"><span>{notice}</span><button type="button" onClick={reset}>СБРОСИТЬ ПРОТОТИП</button></div>

        {editingPlanet && editingPlanetState ? (
          <div className="skin-picker-backdrop" onMouseDown={() => setEditingPlanetId(null)}>
            <section className="skin-picker-modal" onMouseDown={(event) => event.stopPropagation()}>
              <header>
                <div><small>РЕДАКТИРОВАТЬ ПЛАНЕТУ</small><h2>{editingPlanet.name}</h2><p>{editingPlanet.coords} · {editingPlanet.status}</p></div>
                <button type="button" onClick={() => setEditingPlanetId(null)}>×</button>
              </header>
              <div className="skin-picker-grid">
                {planetSkins.map((skin) => (
                  <button key={skin.id} type="button" className={editingPlanetState.skin === skin.id ? 'active' : ''} onClick={() => chooseSkin(skin)}>
                    <img src={skin.art} alt="" /><span>{skin.label}</span><small>{editingPlanetState.skin === skin.id ? 'АКТИВИРОВАНА' : 'ИСПОЛЬЗОВАТЬ'}</small>
                  </button>
                ))}
              </div>
            </section>
          </div>
        ) : null}

        <footer className="footer-status"><span>ASTERION // COMMAND SHELL V4</span><span>1920×1080 BASE CANVAS</span><span>ESC — WINDOWED • F11 — FULLSCREEN</span></footer>
      </div>
    </div>
  );
}
