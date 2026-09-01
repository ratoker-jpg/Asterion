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
type Zone = 'resource' | 'industry' | 'military';
type IconKind = 'metal' | 'mineral' | 'gas' | 'energy' | 'population' | Zone;
type QueueItem = { id: 'solar-station'; name: string; startedAt: number; finishAt: number };
type SaveState = {
  metal: number;
  minerals: number;
  gas: number;
  energy: number;
  population: number;
  solarStations: number;
  planetSkin: PlanetSkin;
  queue: QueueItem | null;
};

const SAVE_KEY = 'asterion.vertical-slice.v1';
const BUILD_TIME_MS = 45_000;
const BUILD_COST = 1200;
const initialState: SaveState = {
  metal: 15_880,
  minerals: 12_712,
  gas: 6_421,
  energy: 140,
  population: 4,
  solarStations: 0,
  planetSkin: 'colonized',
  queue: null,
};
const tabs = ['Планета', 'Вселенная', 'Флоты', 'Операции', 'Наука', 'Командование', 'Отчёты', 'Рейтинг', 'Настройки'];
const zoneMeta: Record<Zone, { title: string; subtitle: string; accent: string }> = {
  resource: { title: 'РЕСУРСНАЯ ЗОНА', subtitle: 'Добыча и энергия', accent: '#38c8ff' },
  industry: { title: 'ПРОМЫШЛЕННАЯ ЗОНА', subtitle: 'Производство', accent: '#f0ad38' },
  military: { title: 'ВОЕННАЯ ЗОНА', subtitle: 'Оборона и флот', accent: '#ee665d' },
};

function readSave(): SaveState {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return initialState;
    const parsed = JSON.parse(raw) as Partial<SaveState>;
    const planetSkin = planetSkins.some((skin) => skin.id === parsed.planetSkin) ? parsed.planetSkin as PlanetSkin : 'colonized';
    return { ...initialState, ...parsed, planetSkin };
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

  if (kind === 'metal') {
    return <svg viewBox="0 0 24 24" aria-hidden="true"><path {...common} d="M4 7 12 3l8 4-8 4-8-4Z"/><path {...common} d="m4 7 8 4v10l-8-4V7Zm16 0-8 4v10l8-4V7Z"/></svg>;
  }
  if (kind === 'mineral') {
    return <svg viewBox="0 0 24 24" aria-hidden="true"><path {...common} d="m12 2 7 7-7 13L5 9l7-7Z"/><path {...common} d="M5 9h14M12 2v20"/></svg>;
  }
  if (kind === 'gas') {
    return <svg viewBox="0 0 24 24" aria-hidden="true"><path {...common} d="M12 3c4 4.7 6 7.6 6 11a6 6 0 1 1-12 0c0-3.4 2-6.3 6-11Z"/><circle {...common} cx="10" cy="13" r="1.8"/><circle {...common} cx="14.5" cy="15.5" r="1.2"/></svg>;
  }
  if (kind === 'energy') {
    return <svg viewBox="0 0 24 24" aria-hidden="true"><path {...common} d="m13 2-7 12h6l-1 8 7-12h-6l1-8Z"/></svg>;
  }
  if (kind === 'population') {
    return <svg viewBox="0 0 24 24" aria-hidden="true"><circle {...common} cx="9" cy="8" r="3"/><circle {...common} cx="16.5" cy="9.5" r="2.3"/><path {...common} d="M3.5 20c.5-4.2 2.5-6.3 5.5-6.3s5 2.1 5.5 6.3M14 14.6c3.5-.5 5.6 1.3 6.5 5.4"/></svg>;
  }
  if (kind === 'resource') {
    return <svg viewBox="0 0 24 24" aria-hidden="true"><path {...common} d="m12 2 4 6-4 6-4-6 4-6Zm-6 9 3 4-3 5-3-5 3-4Zm12 0 3 4-3 5-3-5 3-4Z"/></svg>;
  }
  if (kind === 'industry') {
    return <svg viewBox="0 0 24 24" aria-hidden="true"><path {...common} d="M3 21V10l6 3v-3l6 3V6h4v15H3Z"/><path {...common} d="M6 17h2m3 0h2m3 0h2M16 6V3h3v3"/></svg>;
  }
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
  const [skinOpen, setSkinOpen] = useState(false);

  useEffect(() => localStorage.setItem(SAVE_KEY, JSON.stringify(state)), [state]);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    if (!state.queue || now < state.queue.finishAt) return;
    setState((current) => current.queue && Date.now() >= current.queue.finishAt
      ? { ...current, queue: null, solarStations: current.solarStations + 1, energy: current.energy + 25 }
      : current);
    setNotice('Солнечная станция построена. Производство энергии увеличено.');
  }, [now, state.queue]);

  const selectedPlanet = useMemo(
    () => planetSkins.find((skin) => skin.id === state.planetSkin) ?? planetSkins[0],
    [state.planetSkin],
  );

  const progress = useMemo(() => {
    if (!state.queue) return 0;
    return Math.min(100, Math.max(0, ((now - state.queue.startedAt) / (state.queue.finishAt - state.queue.startedAt)) * 100));
  }, [now, state.queue]);

  const build = () => {
    if (state.queue) return setNotice('Очередь уже занята.');
    if (state.metal < BUILD_COST) return setNotice('Недостаточно металла.');
    const startedAt = Date.now();
    setState((current) => ({
      ...current,
      metal: current.metal - BUILD_COST,
      queue: { id: 'solar-station', name: 'Солнечная станция', startedAt, finishAt: startedAt + BUILD_TIME_MS },
    }));
    setNotice(`Солнечная станция добавлена в очередь. −${formatNumber(BUILD_COST)} металла.`);
  };

  const reset = () => {
    localStorage.removeItem(SAVE_KEY);
    setState(initialState);
    setSkinOpen(false);
    setNotice('Сохранение прототипа сброшено.');
  };

  const chooseTab = (tab: string) => {
    setActiveTab(tab);
    setSkinOpen(false);
    if (tab === 'Вселенная') setNotice('Галактика 1 загружена. Доступно 40 солнечных систем.');
    else if (tab !== 'Планета') setNotice(`Экран «${tab}» будет следующим модулем.`);
  };

  const chooseZone = (nextZone: Zone) => {
    setZone(nextZone);
    setActiveTab('Планета');
    setSkinOpen(false);
    setNotice(`${zoneMeta[nextZone].title}: модуль выбран.`);
  };

  const chooseSkin = (skin: (typeof planetSkins)[number]) => {
    setState((current) => ({ ...current, planetSkin: skin.id }));
    setSkinOpen(false);
    setNotice(`Облик Helion 01 изменён: ${skin.label}.`);
  };

  const remaining = state.queue ? state.queue.finishAt - now : 0;
  const zoneInfo = zoneMeta[zone];

  return (
    <div className="viewport">
      <div className="stage" style={{ transform: `scale(${scale})`, '--space-bg': `url(${systemBackground})` } as CSSProperties}>
        <header className="topbar topbar-v2">
          <div className="corner-planet">
            <button className="corner-planet__world" type="button" onClick={() => setSkinOpen((open) => !open)} aria-label="Выбрать облик планеты">
              <span className="corner-planet__halo" />
              <img src={selectedPlanet.art} alt="Helion 01" draggable={false} />
            </button>
            {(['resource', 'industry', 'military'] as Zone[]).map((item) => (
              <button
                key={item}
                type="button"
                className={`corner-zone corner-zone--${item} ${zone === item && activeTab === 'Планета' ? 'active' : ''}`}
                onClick={() => chooseZone(item)}
                aria-label={zoneMeta[item].title}
              >
                <GameIcon kind={item} />
              </button>
            ))}
            <div className="corner-planet__label"><strong>HELION 01</strong><small>[1:1:1] · AEGIS</small></div>
          </div>

          <div className="topbar-main">
            <nav className="main-tabs">
              {tabs.map((tab) => (
                <button key={tab} className={activeTab === tab ? 'active' : ''} onClick={() => chooseTab(tab)}><span>{tab}</span></button>
              ))}
            </nav>
            <div className="resources">
              <Resource kind="metal" label="МЕТАЛЛ" value={`${formatNumber(state.metal)} / 60 000`} gain="+774/ч" />
              <Resource kind="mineral" label="МИНЕРАЛЫ" value={`${formatNumber(state.minerals)} / 60 000`} gain="+510/ч" />
              <Resource kind="gas" label="ГАЗ" value={`${formatNumber(state.gas)} / 60 000`} gain="+312/ч" />
              <Resource kind="energy" label="ЭНЕРГИЯ" value={formatNumber(state.energy)} gain="+22/ч" />
              <Resource kind="population" label="НАСЕЛЕНИЕ" value={`${state.population} / 70`} />
            </div>
          </div>

          <div className="campaign-block campaign-v2">
            <span className="campaign-icon">✦</span>
            <div><strong>КАМПАНИЯ АКТИВНА</strong><small>F11 — полный экран</small></div>
            <time>{new Date(now).toLocaleTimeString('ru-RU', { hour12: false })}</time>
          </div>
        </header>

        <aside className="left-column left-column-v2">
          <section className="passport-panel-v2">
            <div className="panel-title-v2"><span>ПАСПОРТ ПЛАНЕТЫ</span><b>AEGIS</b></div>
            <button className="planet-selector planet-selector-v2" type="button" onClick={() => setSkinOpen((open) => !open)}>
              <span className="mini-planet"><img src={selectedPlanet.art} alt="" /></span>
              <span><strong>Helion 01</strong><small>[1:1:1]</small></span>
              <i>{skinOpen ? '⌃' : '⌄'}</i>
            </button>
            {skinOpen ? (
              <div className="planet-skin-menu">
                <p>ВЫБРАТЬ ОБЛИК ПЛАНЕТЫ</p>
                <div>
                  {planetSkins.map((skin) => (
                    <button key={skin.id} type="button" className={state.planetSkin === skin.id ? 'active' : ''} onClick={() => chooseSkin(skin)}>
                      <img src={skin.art} alt="" />
                      <span>{skin.label}</span>
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
            <dl>
              <div><dt>Статус</dt><dd className="status-home">★ Основная планета</dd></div>
              <div><dt>Фракция</dt><dd>Aegis</dd></div>
              <div><dt>Координаты</dt><dd>[1:1:1]</dd></div>
              <div><dt>Население</dt><dd>{state.population} / 70</dd></div>
              <div><dt>Энергия</dt><dd>{state.energy}</dd></div>
              <div><dt>Солнечные станции</dt><dd>{state.solarStations}</dd></div>
            </dl>
            <div className="stability-v2"><span>СТАБИЛЬНОСТЬ</span><b>100%</b><i><em /></i></div>
            <button className="details-button" type="button" onClick={() => setNotice('Расширенный паспорт планеты появится позже.')}>ПОДРОБНЕЕ</button>
          </section>
        </aside>

        {activeTab === 'Вселенная' ? (
          <UniverseView onNotice={setNotice} ownedPlanetArt={selectedPlanet.art} />
        ) : (
          <main className="planet-view planet-view-v2">
            <div className="scene-title scene-title-v2"><small>{zoneInfo.title}</small><h1>HELION 01</h1><p>[1:1:1] • AEGIS HOMEWORLD</p></div>
            <div className="planet-stage-v2">
              <div className="planet-atmosphere" />
              <img className="planet-image planet-image-v2" src={selectedPlanet.art} alt="Helion 01" draggable={false} />
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
            <div className="notice-panel-v2"><span>{notice}</span><button onClick={reset}>СБРОСИТЬ ПРОТОКОЛ</button></div>
          </main>
        )}

        {activeTab === 'Планета' ? (
          <aside className="right-column right-column-v2">
            <section className="queue-panel-v2">
              <div className="panel-title-v2 queue-heading"><span>ОЧЕРЕДЬ СТРОИТЕЛЬСТВА</span><b>{state.queue ? 1 : 0} / 4</b></div>
              <div className={`queue-card-v2 ${state.queue ? 'busy' : ''}`}>
                <span className="queue-card-v2__icon"><GameIcon kind="energy" /></span>
                <span><strong>{state.queue?.name ?? 'Свободный слот'}</strong><small>{state.queue ? `Осталось ${formatCountdown(remaining)}` : 'Готов к строительству'}</small></span>
                <b>{state.queue ? 'I' : '+'}</b>
                {state.queue ? <div className="queue-progress-v2"><i style={{ width: `${progress}%` }} /></div> : null}
              </div>
              {[2, 3, 4].map((slot) => (
                <div className="queue-card-v2 locked" key={slot}>
                  <span className="queue-card-v2__lock">▣</span><span><strong>Слот 0{slot}</strong><small>Заблокирован</small></span>
                </div>
              ))}
              <div className="build-preview-v2">
                <span className="build-preview-v2__icon"><GameIcon kind="energy" /></span>
                <div><strong>Солнечная станция I</strong><small>+25 энергии после завершения</small></div>
                <b><GameIcon kind="metal" /> {formatNumber(BUILD_COST)}</b>
              </div>
              <AegisButton onClick={build} disabled={Boolean(state.queue)}>ПОСТРОИТЬ</AegisButton>
            </section>
          </aside>
        ) : null}

        <footer className="footer-status"><span>ASTERION // {activeTab === 'Вселенная' ? 'UNIVERSE NAVIGATION V3' : 'PLANET VISUAL V2'}</span><span>1920×1080 BASE CANVAS</span><span>ESC — WINDOWED • F11 — FULLSCREEN</span></footer>
      </div>
    </div>
  );
}
