import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import scoutArt from '../assets/source/New assets/ship/aegis/ship.aegis.scout.png';
import './fleet-workspace.css';

const SCOUT_POPULATION = 2;
const SCOUT_AVAILABLE = 10;

type FleetSection =
  | 'Корабли'
  | 'Оборона'
  | 'Боевые корабли'
  | 'Командирский корабль'
  | 'Ремонтная мастерская'
  | 'Боевой приоритет'
  | 'Битвы'
  | 'Симулятор';

const constructionSections: FleetSection[] = [
  'Корабли',
  'Оборона',
  'Боевые корабли',
  'Командирский корабль',
  'Ремонтная мастерская',
];

const managementSections: FleetSection[] = ['Боевой приоритет', 'Битвы', 'Симулятор'];

function FleetWorkspace({ planetName, coords }: { planetName: string; coords: string }) {
  const [quantity, setQuantity] = useState(SCOUT_AVAILABLE);
  const [mission, setMission] = useState('Транспортировка');
  const [selectedSection, setSelectedSection] = useState<FleetSection>('Корабли');
  const [status, setStatus] = useState('Прототип: отправка флота будет подключена следующим этапом.');

  const population = useMemo(() => quantity * SCOUT_POPULATION, [quantity]);

  const chooseSection = (section: FleetSection) => {
    setSelectedSection(section);
    if (section !== 'Корабли') {
      setStatus(`Раздел «${section}» пока сохранён как навигационный каркас.`);
    } else {
      setStatus('Раздел формирования флота открыт.');
    }
  };

  const setScoutQuantity = (raw: number) => {
    const next = Number.isFinite(raw) ? Math.max(0, Math.min(SCOUT_AVAILABLE, Math.floor(raw))) : 0;
    setQuantity(next);
  };

  return (
    <div className="fleet-workspace-v1">
      <aside className="fleet-sidebar-v1">
        <div className="fleet-sidebar-title-v1">
          <span>ФЛОТЫ</span>
          <small>AEGIS FLEET CONTROL</small>
        </div>

        <div className="fleet-yard-card-v1">
          <div className="fleet-yard-emblem-v1">A</div>
          <div>
            <small>БАЗА ФЛОТА</small>
            <strong>Орбитальная верфь</strong>
            <span>Уровень 1</span>
          </div>
        </div>

        <FleetMenuGroup title="СТРОИТЕЛЬСТВО" items={constructionSections} selected={selectedSection} onSelect={chooseSection} />
        <FleetMenuGroup title="УПРАВЛЕНИЕ ФЛОТОМ" items={managementSections} selected={selectedSection} onSelect={chooseSection} />
      </aside>

      <main className="fleet-main-v1">
        <section className="fleet-panel-v1 fleet-flights-v1">
          <header className="fleet-panel-header-v1">
            <div><small>ОПЕРАЦИОННЫЙ ЦЕНТР</small><h2>ФЛОТЫ</h2></div>
            <span>{planetName} {coords}</span>
          </header>

          <div className="fleet-flight-table-v1">
            <div className="fleet-flight-row-v1 fleet-flight-head-v1">
              <span>ОТКУДА</span><span>КУДА</span><span>ПРИБЫТИЕ</span><span>ВОЗВРАЩЕНИЕ</span><span>МИССИЯ</span><span>ДЕЙСТВИЯ</span>
            </div>
            <div className="fleet-flight-empty-v1">
              <strong>Активных полётов нет</strong>
              <span>Флоты, находящиеся в пути, будут отображаться здесь.</span>
            </div>
          </div>

          <div className="fleet-flight-actions-v1">
            <button type="button" onClick={() => setStatus('Сейчас активных шпионских флотов нет.')}>ОТОЗВАТЬ ВСЕХ ШПИОНОВ</button>
            <button type="button" onClick={() => setStatus('Выбранных шпионских флотов сейчас нет.')}>ОТОЗВАТЬ ВЫБРАННЫХ</button>
            <button type="button" onClick={() => setStatus('Шпионские отчёты будут подключены вместе с системой отчётов.')}>ШПИОНСКИЕ ОТЧЁТЫ</button>
          </div>
        </section>

        <section className="fleet-panel-v1 fleet-compose-v1">
          <header className="fleet-panel-header-v1 compact">
            <div><small>ФОРМИРОВАНИЕ</small><h2>ВЫБЕРИ КОРАБЛИ</h2></div>
            <span>1 СКАУТ = {SCOUT_POPULATION} НАСЕЛЕНИЯ</span>
          </header>

          <div className="fleet-ship-card-v1">
            <div className="fleet-ship-art-v1"><img src={scoutArt} alt="Скаут Вектор" draggable={false} /></div>
            <div className="fleet-ship-info-v1">
              <small>ЛЁГКИЙ БОЕВОЙ РАЗВЕДЧИК</small>
              <h3>Скаут «Вектор»</h3>
              <p>Быстрый корабль для разведки, перехвата и сопровождения флота.</p>
              <div className="fleet-ship-meta-v1"><span>В наличии <b>{SCOUT_AVAILABLE}</b></span><span>Население / ед. <b>{SCOUT_POPULATION}</b></span></div>
            </div>
            <label className="fleet-quantity-v1">
              <span>КОЛИЧЕСТВО</span>
              <div><button type="button" onClick={() => setScoutQuantity(quantity - 1)}>−</button><input aria-label="Количество скаутов" type="number" min="0" max={SCOUT_AVAILABLE} value={quantity} onChange={(event) => setScoutQuantity(Number(event.target.value))} /><button type="button" onClick={() => setScoutQuantity(quantity + 1)}>+</button></div>
              <button type="button" className="fleet-max-v1" onClick={() => setScoutQuantity(SCOUT_AVAILABLE)}>МАКС. {SCOUT_AVAILABLE}</button>
            </label>
          </div>

          <div className="fleet-selection-summary-v1">
            <div><small>ВЫБРАНО КОРАБЛЕЙ</small><strong>{quantity}</strong></div>
            <div className="accent"><small>ЗАНЯТО НАСЕЛЕНИЯ</small><strong>{population}</strong></div>
            <label><small>МИССИЯ</small><select value={mission} onChange={(event) => setMission(event.target.value)}><option>Транспортировка</option><option>Разведка</option><option>Атака</option><option>Переработка</option><option>Колонизация</option><option>Экспедиция</option></select></label>
          </div>

          <div className="fleet-mission-strip-v1">
            {['Транспорт', 'Разведка', 'Атака', 'Обломки', 'Колония', 'Экспедиция'].map((item) => <span key={item}>{item}</span>)}
          </div>

          <footer className="fleet-compose-footer-v1">
            <span>{status}</span>
            <button type="button" disabled={quantity === 0} onClick={() => setStatus(`${quantity} × Скаут «Вектор» подготовлены. Выбрано населения: ${population}. Отправку подключим следующим этапом.`)}>ПРОДОЛЖИТЬ</button>
          </footer>
        </section>
      </main>
    </div>
  );
}

function FleetMenuGroup({ title, items, selected, onSelect }: { title: string; items: FleetSection[]; selected: FleetSection; onSelect: (section: FleetSection) => void }) {
  return (
    <section className="fleet-menu-group-v1">
      <h3>{title}</h3>
      {items.map((item) => (
        <button key={item} type="button" className={selected === item ? 'active' : ''} onClick={() => onSelect(item)}>
          <span className="fleet-menu-icon-v1">◇</span><strong>{item}</strong><i>›</i>
        </button>
      ))}
    </section>
  );
}

function readCurrentPlanet() {
  const strong = document.querySelector('.current-planet-select strong');
  if (!strong) return { name: 'Helion 01', coords: '[1:1:1]' };
  const coords = strong.querySelector('em')?.textContent?.trim() || '[1:1:1]';
  const name = Array.from(strong.childNodes)
    .filter((node) => node.nodeType === Node.TEXT_NODE)
    .map((node) => node.textContent ?? '')
    .join(' ')
    .trim() || 'Helion 01';
  return { name, coords };
}

export function FleetWorkspacePortal() {
  const [target, setTarget] = useState<HTMLElement | null>(null);
  const [active, setActive] = useState(false);
  const [planet, setPlanet] = useState({ name: 'Helion 01', coords: '[1:1:1]' });

  useEffect(() => {
    const sync = () => {
      const activeLabel = document.querySelector('.primary-navigation button.active span')?.textContent?.trim();
      setActive(activeLabel === 'Флоты');
      setTarget(document.querySelector<HTMLElement>('.workspace'));
      setPlanet(readCurrentPlanet());
    };

    sync();
    const navigation = document.querySelector('.primary-navigation');
    if (!navigation) return;
    const observer = new MutationObserver(sync);
    observer.observe(navigation, { subtree: true, attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);

  if (!active || !target) return null;
  return createPortal(<FleetWorkspace planetName={planet.name} coords={planet.coords} />, target);
}
