import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react';

import systemBackground from '../assets/source/starter/backgrounds/system_background.png';
import planetColonized from '../assets/source/starter/planets/planet_colonized.png';
import panelLarge from '../assets/source/ui-generated-v1/aegis/panel_frame_large.png';
import panelMedium from '../assets/source/ui-generated-v1/aegis/panel_frame_medium.png';
import panelSmall from '../assets/source/ui-generated-v1/aegis/panel_frame_small.png';
import tabIdle from '../assets/source/ui-generated-v1/aegis/tab_idle.png';
import tabActive from '../assets/source/ui-generated-v1/aegis/tab_active.png';
import buttonIdle from '../assets/source/ui-generated-v1/aegis/button_primary_idle.png';
import buttonHover from '../assets/source/ui-generated-v1/aegis/button_primary_hover.png';
import buttonPressed from '../assets/source/ui-generated-v1/aegis/button_primary_pressed.png';
import queueEmpty from '../assets/source/ui-generated-v1/aegis/queue_slot_empty.png';
import queueBusy from '../assets/source/ui-generated-v1/aegis/queue_slot_busy.png';
import queueLocked from '../assets/source/ui-generated-v1/aegis/queue_slot_locked.png';
import resourceChip from '../assets/source/ui-generated-v1/aegis/resource_chip.png';
import selectionRing from '../assets/source/ui-generated-v1/aegis/selection_ring.png';

type Zone = 'resource' | 'industry' | 'military';
type QueueItem = { id: 'solar-station'; name: string; startedAt: number; finishAt: number };
type SaveState = {
  metal: number;
  minerals: number;
  gas: number;
  energy: number;
  population: number;
  solarStations: number;
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
  queue: null,
};
const tabs = ['Планета', 'Вселенная', 'Флоты', 'Операции', 'Наука', 'Командование', 'Отчёты'];

function readSave(): SaveState {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    return raw ? ({ ...initialState, ...JSON.parse(raw) } as SaveState) : initialState;
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

function Frame({ art, className = '', children }: { art: string; className?: string; children: ReactNode }) {
  return (
    <section className={`ui-frame ${className}`}>
      <img className="ui-frame__art" src={art} alt="" draggable={false} />
      <div className="ui-frame__content">{children}</div>
    </section>
  );
}

function Resource({ icon, label, value, gain }: { icon: string; label: string; value: string; gain?: string }) {
  return (
    <div className="resource-chip">
      <img src={resourceChip} alt="" draggable={false} />
      <span className="resource-chip__icon">{icon}</span>
      <span className="resource-chip__text">
        <small>{label}</small>
        <strong>{value}</strong>
        {gain ? <em>{gain}</em> : null}
      </span>
    </div>
  );
}

function AegisButton({ children, onClick, disabled = false }: { children: ReactNode; onClick: () => void; disabled?: boolean }) {
  const [state, setState] = useState<'idle' | 'hover' | 'pressed'>('idle');
  const art = state === 'pressed' ? buttonPressed : state === 'hover' ? buttonHover : buttonIdle;
  return (
    <button
      className="aegis-button"
      disabled={disabled}
      onClick={onClick}
      onPointerEnter={() => !disabled && setState('hover')}
      onPointerLeave={() => setState('idle')}
      onPointerDown={() => !disabled && setState('pressed')}
      onPointerUp={() => !disabled && setState('hover')}
    >
      <img src={art} alt="" draggable={false} />
      <span>{children}</span>
    </button>
  );
}

export function App() {
  const scale = useStageScale();
  const [zone, setZone] = useState<Zone>('resource');
  const [activeTab, setActiveTab] = useState('Планета');
  const [state, setState] = useState<SaveState>(readSave);
  const [now, setNow] = useState(Date.now());
  const [notice, setNotice] = useState('Система готова. Локальное сохранение активно.');

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
    setNotice('Сохранение прототипа сброшено.');
  };

  const chooseTab = (tab: string) => {
    setActiveTab(tab);
    if (tab !== 'Планета') setNotice(`Экран «${tab}» будет следующим модулем.`);
  };

  const zoneLabel = zone === 'resource' ? 'РЕСУРСНАЯ ЗОНА' : zone === 'industry' ? 'ПРОМЫШЛЕННАЯ ЗОНА' : 'ВОЕННАЯ ЗОНА';
  const remaining = state.queue ? state.queue.finishAt - now : 0;

  return (
    <div className="viewport">
      <div className="stage" style={{ transform: `scale(${scale})`, '--space-bg': `url(${systemBackground})` } as CSSProperties}>
        <header className="topbar">
          <div className="brand-block">
            <div className="brand-mark">A</div>
            <div><strong>ASTERION</strong><small>AEGIS COMMAND</small></div>
          </div>

          <div className="topbar-main">
            <nav className="main-tabs">
              {tabs.map((tab) => (
                <button key={tab} className={activeTab === tab ? 'active' : ''} onClick={() => chooseTab(tab)}>
                  <img src={activeTab === tab ? tabActive : tabIdle} alt="" draggable={false} />
                  <span>{tab}</span>
                </button>
              ))}
            </nav>
            <div className="resources">
              <Resource icon="◆" label="МЕТАЛЛ" value={`${formatNumber(state.metal)} / 60 000`} gain="+774/ч" />
              <Resource icon="⬢" label="МИНЕРАЛЫ" value={`${formatNumber(state.minerals)} / 60 000`} gain="+510/ч" />
              <Resource icon="◈" label="ГАЗ" value={`${formatNumber(state.gas)} / 60 000`} gain="+312/ч" />
              <Resource icon="ϟ" label="ЭНЕРГИЯ" value={formatNumber(state.energy)} />
              <Resource icon="♟" label="НАСЕЛЕНИЕ" value={`${state.population} / 70`} />
            </div>
          </div>

          <div className="campaign-block">
            <span className="campaign-icon">✦</span>
            <div><strong>КАМПАНИЯ АКТИВНА</strong><small>F11 — полный экран</small></div>
            <time>{new Date(now).toLocaleTimeString('ru-RU', { hour12: false })}</time>
          </div>
        </header>

        <aside className="left-column">
          <Frame art={panelSmall} className="zone-panel">
            <p className="eyebrow">ПОВЕРХНОСТЬ</p>
            <div className="zone-list">
              <button className={zone === 'resource' ? 'active' : ''} onClick={() => setZone('resource')}><b>01</b><span>Ресурсная зона<small>Добыча и энергия</small></span></button>
              <button className={zone === 'industry' ? 'active' : ''} onClick={() => setZone('industry')}><b>02</b><span>Промышленная зона<small>Производство</small></span></button>
              <button className={zone === 'military' ? 'active' : ''} onClick={() => setZone('military')}><b>03</b><span>Военная зона<small>Оборона и флот</small></span></button>
            </div>
          </Frame>

          <Frame art={panelMedium} className="passport-panel">
            <p className="eyebrow">ПАСПОРТ ПЛАНЕТЫ</p>
            <div className="planet-selector"><span className="mini-planet"><img src={planetColonized} alt="" /></span><span><strong>Helion 01</strong><small>SYSTEM-1-1</small></span><i>⌄</i></div>
            <dl>
              <div><dt>Тип</dt><dd>Колонизированная</dd></div>
              <div><dt>Фракция</dt><dd>Aegis</dd></div>
              <div><dt>Координаты</dt><dd>01:01:01</dd></div>
              <div><dt>Население</dt><dd>{state.population} / 70</dd></div>
              <div><dt>Энергия</dt><dd>{state.energy}</dd></div>
              <div><dt>Солнечные станции</dt><dd>{state.solarStations}</dd></div>
            </dl>
            <div className="stability"><span>СТАБИЛЬНОСТЬ</span><b>100%</b><i /></div>
          </Frame>
        </aside>

        <main className="planet-view">
          <div className="scene-title"><small>{zoneLabel}</small><h1>HELION 01</h1><p>SYSTEM-1-1 • AEGIS COLONY</p></div>
          <div className="orbit orbit--outer" /><div className="orbit orbit--inner" />
          <img className="selection-ring" src={selectionRing} alt="" draggable={false} />
          <img className="planet-image" src={planetColonized} alt="Helion 01" draggable={false} />
          <div className="planet-status"><span>◆</span> СТАБИЛЬНО <i /> ONLINE</div>
          <Frame art={panelLarge} className="notice-panel"><span>{notice}</span><button onClick={reset}>СБРОСИТЬ ПРОТОТИП</button></Frame>
        </main>

        <aside className="right-column">
          <Frame art={panelMedium} className="queue-panel">
            <div className="panel-heading"><span><small>ПРОИЗВОДСТВО</small><strong>ОЧЕРЕДЬ СТРОИТЕЛЬСТВА</strong></span><b>{state.queue ? 1 : 0} / 4</b></div>

            <div className={`queue-card ${state.queue ? 'busy' : ''}`}>
              <img src={state.queue ? queueBusy : queueEmpty} alt="" draggable={false} />
              <div className="queue-card__body">
                <span className="queue-icon">☼</span>
                <span><strong>{state.queue?.name ?? 'Свободный слот'}</strong><small>{state.queue ? `Осталось ${formatCountdown(remaining)}` : 'Готов к строительству'}</small></span>
                <b>{state.queue ? 'I' : '+'}</b>
              </div>
              {state.queue ? <div className="queue-progress"><i style={{ width: `${progress}%` }} /></div> : null}
            </div>

            {[2, 3, 4].map((slot) => (
              <div className="queue-card locked" key={slot}>
                <img src={queueLocked} alt="" draggable={false} />
                <div className="queue-card__body"><span className="queue-icon">◇</span><span><strong>Слот 0{slot}</strong><small>Заблокирован</small></span><b>⌑</b></div>
              </div>
            ))}

            <div className="build-preview">
              <span className="build-icon">☀</span>
              <div><strong>Солнечная станция I</strong><small>+25 энергии после завершения</small></div>
              <b>◆ {formatNumber(BUILD_COST)}</b>
            </div>
            <AegisButton onClick={build} disabled={Boolean(state.queue)}>ПОСТРОИТЬ</AegisButton>
          </Frame>
        </aside>

        <footer className="footer-status"><span>ASTERION // PLANET VERTICAL SLICE</span><span>1920×1080 BASE CANVAS</span><span>ESC — WINDOWED • F11 — FULLSCREEN</span></footer>
      </div>
    </div>
  );
}
