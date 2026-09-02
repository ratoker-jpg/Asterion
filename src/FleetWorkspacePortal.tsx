import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import scoutArt from '../assets/source/New assets/ship/aegis/ship.aegis.scout.png';
import './fleet-workspace.css';

const SCOUT_POPULATION = 2;
const SCOUT_AVAILABLE = 10;
const FLEET_POPULATION = SCOUT_AVAILABLE * SCOUT_POPULATION;

type FleetSection =
  | 'Корабли'
  | 'Оборона'
  | 'Боевые корабли'
  | 'Командирский корабль'
  | 'Ремонтная мастерская'
  | 'Боевой приоритет'
  | 'Битвы'
  | 'Симулятор';

type MissionId =
  | 'transport'
  | 'espionage'
  | 'attack'
  | 'deployment'
  | 'colonize'
  | 'recycle'
  | 'gas'
  | 'sun-support'
  | 'space-flight';

type MissionDefinition = {
  id: MissionId;
  label: string;
  description: string;
};

const constructionSections: FleetSection[] = [
  'Корабли',
  'Оборона',
  'Боевые корабли',
  'Командирский корабль',
  'Ремонтная мастерская',
];

const managementSections: FleetSection[] = ['Боевой приоритет', 'Битвы', 'Симулятор'];

const missions: MissionDefinition[] = [
  { id: 'transport', label: 'Транспортировка', description: 'Перевозка ресурсов между доступными планетами.' },
  { id: 'espionage', label: 'Шпионаж', description: 'Разведка цели и получение шпионского отчёта.' },
  { id: 'attack', label: 'Атака', description: 'Боевой вылет против выбранной цели.' },
  { id: 'deployment', label: 'Дислокация', description: 'Переброска флота на свою планету или к союзнику.' },
  { id: 'colonize', label: 'Колонизация', description: 'Основание новой колонии на свободной планете.' },
  { id: 'recycle', label: 'Переработка', description: 'Сбор и переработка обломков в космосе.' },
  { id: 'gas', label: 'Добыча газа', description: 'Специализированная экспедиция за газом.' },
  { id: 'sun-support', label: 'Поддержка солнца', description: 'Отправка флота для специальной солнечной операции.' },
  { id: 'space-flight', label: 'Космический рейс', description: 'Дальний автономный рейс с заданной продолжительностью.' },
];

function MissionIcon({ id }: { id: MissionId }) {
  const common = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.65, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };

  if (id === 'transport') return <svg viewBox="0 0 32 32" aria-hidden="true"><path {...common} d="M5 12h16v11H5zM21 16h4l3 4v3h-7zM9 9h8M8 26h2m12 0h2"/><circle {...common} cx="9" cy="24" r="2"/><circle {...common} cx="23" cy="24" r="2"/></svg>;
  if (id === 'espionage') return <svg viewBox="0 0 32 32" aria-hidden="true"><circle {...common} cx="14" cy="14" r="7"/><path {...common} d="m19 19 7 7M8 14h12M14 8c2.5 2 2.5 10 0 12"/></svg>;
  if (id === 'attack') return <svg viewBox="0 0 32 32" aria-hidden="true"><path {...common} d="M7 25 24 8M18 7l7 1-1 7M6 18l8 8M9 15l8 8"/></svg>;
  if (id === 'deployment') return <svg viewBox="0 0 32 32" aria-hidden="true"><path {...common} d="M5 16h18M18 10l6 6-6 6M10 7 5 12l5 5"/><circle {...common} cx="7" cy="25" r="2"/><circle {...common} cx="25" cy="7" r="2"/></svg>;
  if (id === 'colonize') return <svg viewBox="0 0 32 32" aria-hidden="true"><circle {...common} cx="16" cy="16" r="10"/><path {...common} d="M6 16h20M16 6c4 4 4 16 0 20M12 21l4-5 4 5"/></svg>;
  if (id === 'recycle') return <svg viewBox="0 0 32 32" aria-hidden="true"><path {...common} d="m16 5 4 6h-4l-3-4 3-2ZM8 13l4-1-2 4-2 4-3-2 3-5Zm12 10-4 4v-4h-5v-4h9v4Z"/><path {...common} d="M20 11c3 1 5 3 6 6M10 25c-3-2-4-5-4-8"/></svg>;
  if (id === 'gas') return <svg viewBox="0 0 32 32" aria-hidden="true"><path {...common} d="M16 5c5 6 8 10 8 15a8 8 0 1 1-16 0c0-5 3-9 8-15Z"/><circle {...common} cx="13" cy="20" r="2"/><circle {...common} cx="19" cy="17" r="1.5"/></svg>;
  if (id === 'sun-support') return <svg viewBox="0 0 32 32" aria-hidden="true"><circle {...common} cx="16" cy="16" r="6"/><path {...common} d="M16 3v5M16 24v5M3 16h5M24 16h5M7 7l4 4M21 21l4 4M25 7l-4 4M11 21l-4 4"/></svg>;
  return <svg viewBox="0 0 32 32" aria-hidden="true"><path {...common} d="m16 4 5 10-5 14-5-14 5-10Z"/><path {...common} d="M11 14 5 19l6 2M21 14l6 5-6 2M16 9v12"/></svg>;
}

function syncPopulationHud() {
  const populationChip = document.querySelector('.resource-chip--population');
  if (!populationChip) return;

  const currentValue = populationChip.querySelector('.resource-chip__text strong');
  if (currentValue && currentValue.textContent !== String(FLEET_POPULATION)) currentValue.textContent = String(FLEET_POPULATION);

  const tooltipSpans = populationChip.querySelectorAll('.resource-tooltip span');
  if (tooltipSpans[0] && tooltipSpans[0].textContent !== `${FLEET_POPULATION} / 70`) tooltipSpans[0].textContent = `${FLEET_POPULATION} / 70`;
  if (tooltipSpans[1] && tooltipSpans[1].textContent !== 'Заполнено: 28,6%') tooltipSpans[1].textContent = 'Заполнено: 28,6%';
}

function FleetWorkspace({ planetName, coords }: { planetName: string; coords: string }) {
  const [quantity, setQuantity] = useState(0);
  const [missionId, setMissionId] = useState<MissionId>('transport');
  const [hoveredMissionId, setHoveredMissionId] = useState<MissionId | null>(null);
  const [selectedSection, setSelectedSection] = useState<FleetSection>('Корабли');
  const [status, setStatus] = useState('Выберите корабли и миссию. Отправка флота будет подключена следующим этапом.');

  const selectedPopulation = useMemo(() => quantity * SCOUT_POPULATION, [quantity]);
  const selectedMission = missions.find((mission) => mission.id === missionId) ?? missions[0];
  const describedMission = missions.find((mission) => mission.id === hoveredMissionId) ?? selectedMission;

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

          <div className="fleet-ship-line-v1">
            <div className="fleet-ship-art-v1"><img src={scoutArt} alt="Скаут Вектор" draggable={false} /></div>
            <div className="fleet-ship-info-v1">
              <small>ЛЁГКИЙ БОЕВОЙ РАЗВЕДЧИК</small>
              <h3>Скаут «Вектор»</h3>
              <div className="fleet-ship-meta-v1"><span>В наличии <b>{SCOUT_AVAILABLE}</b></span><span>Население / ед. <b>{SCOUT_POPULATION}</b></span></div>
            </div>
            <div className="fleet-quantity-v1">
              <span>КОЛИЧЕСТВО</span>
              <input aria-label="Количество скаутов" type="number" min="0" max={SCOUT_AVAILABLE} value={quantity} onChange={(event) => setScoutQuantity(Number(event.target.value))} />
              <div className="fleet-quantity-shortcuts-v1">
                <button type="button" onClick={() => setScoutQuantity(SCOUT_AVAILABLE)}>МАКС.</button>
                <button type="button" onClick={() => setScoutQuantity(0)}>МИН.</button>
              </div>
            </div>
          </div>

          <div className="fleet-selection-line-v1">
            <span>Выберите</span>
            <button type="button" onClick={() => setScoutQuantity(SCOUT_AVAILABLE)}>Макс.</button>
            <span>/</span>
            <button type="button" onClick={() => setScoutQuantity(0)}>Мин.</button>
            <i />
            <span>Выбрано кораблей</span><strong>{quantity}</strong>
            <i />
            <span>Выбрано населения</span><strong className="accent">{selectedPopulation}</strong>
          </div>

          <div className="fleet-mission-picker-v1">
            <div className="fleet-mission-select-v1">
              <label htmlFor="fleet-mission">МИССИЯ</label>
              <select id="fleet-mission" value={missionId} onChange={(event) => setMissionId(event.target.value as MissionId)}>
                {missions.map((mission) => <option key={mission.id} value={mission.id}>{mission.label}</option>)}
              </select>
            </div>

            <div className="fleet-mission-icons-v1" aria-label="Выбор миссии">
              {missions.map((mission) => (
                <button
                  key={mission.id}
                  type="button"
                  className={mission.id === missionId ? 'active' : ''}
                  aria-label={mission.label}
                  title={mission.label}
                  onMouseEnter={() => setHoveredMissionId(mission.id)}
                  onMouseLeave={() => setHoveredMissionId(null)}
                  onFocus={() => setHoveredMissionId(mission.id)}
                  onBlur={() => setHoveredMissionId(null)}
                  onClick={() => setMissionId(mission.id)}
                >
                  <MissionIcon id={mission.id} />
                  <span>{mission.label}</span>
                </button>
              ))}
            </div>
            <p className="fleet-mission-description-v1"><strong>{describedMission.label}.</strong> {describedMission.description}</p>
          </div>

          <footer className="fleet-compose-footer-v1">
            <span>{status}</span>
            <button type="button" disabled={quantity === 0} onClick={() => setStatus(`${quantity} × Скаут «Вектор» подготовлены. Выбрано населения: ${selectedPopulation}. Миссия: ${selectedMission.label}.`)}>ПРОДОЛЖИТЬ</button>
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
  const [target, setTarget] = useState<Element | null>(null);
  const [active, setActive] = useState(false);
  const [planet, setPlanet] = useState({ name: 'Helion 01', coords: '[1:1:1]' });

  useEffect(() => {
    const sync = () => {
      const activeLabel = document.querySelector('.primary-navigation button.active span')?.textContent?.trim();
      setActive(activeLabel === 'Флоты');
      setTarget(document.querySelector('.workspace'));
      setPlanet(readCurrentPlanet());
      syncPopulationHud();
    };

    sync();
    const observer = new MutationObserver(sync);
    observer.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);

  if (!active || !target) return null;
  return createPortal(<FleetWorkspace planetName={planet.name} coords={planet.coords} />, target);
}
