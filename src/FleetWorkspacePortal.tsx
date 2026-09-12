import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { getFactionShipCatalog } from './domain/combat/faction-catalog.ts';
import type { ShipId } from './domain/combat/ids.ts';
import { getBuildingPresentation } from './domain/buildings/balance-v1.ts';
import { RUNTIME_STATE_CHANGED_EVENT } from './domain/runtime/mode.ts';
import {
  getFleetSummaryForSnapshot,
  readFleetSnapshot as readApplicationFleetSnapshot,
  type FleetSnapshot,
} from './application/fleet.ts';
import { BattleReportsView } from './BattleReportsView';
import { ConstructionCatalogView, type ConstructionCatalogMode } from './ConstructionCatalogView';
import { FleetCombatPriorityView } from './FleetCombatPriorityView';
import { FLEET_ROOT_REQUEST_EVENT } from './FleetRootNavigationController';
import { FLEET_CONSTRUCTION_REQUEST_EVENT } from './building-interior-navigation.ts';
import { ShipyardView } from './ShipyardView';
import { SimulatorView } from './SimulatorView';
import {
  FLEET_CONSTRUCTION_NAVIGATION,
  FLEET_MANAGEMENT_NAVIGATION,
  useNavigation,
  type FleetSectionId,
  type FleetSectionItem,
} from './ui/navigation.tsx';
import './fleet-workspace.css';

const FLEET_ROOT_STATUS = 'Выберите корабли и миссию. Отправка флота будет подключена следующим этапом.';

const shipDefinitions = getFactionShipCatalog('aegis');
const shipyardPresentation = getBuildingPresentation('shipyard', 'aegis');

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

type ConstructionView = 'ships' | ConstructionCatalogMode | null;

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

function FleetWorkspace({
  planetName,
  coords,
  openConstruction,
  onConstructionOpened,
}: {
  planetName: string;
  coords: string;
  openConstruction: boolean;
  onConstructionOpened: () => void;
}) {
  const { fleetSection: selectedSection, setFleetSection } = useNavigation();
  const [selectedQuantities, setSelectedQuantities] = useState<Partial<Record<ShipId, number>>>({});
  const [missionId, setMissionId] = useState<MissionId>('transport');
  const [hoveredMissionId, setHoveredMissionId] = useState<MissionId | null>(null);
  const [constructionView, setConstructionView] = useState<ConstructionView>(null);
  const [status, setStatus] = useState(FLEET_ROOT_STATUS);
  const [fleetSnapshot, setFleetSnapshot] = useState<FleetSnapshot>(readApplicationFleetSnapshot);
  const fleetSummary = useMemo(
    () => getFleetSummaryForSnapshot(fleetSnapshot),
    [fleetSnapshot.fleet, fleetSnapshot.hangarLevel],
  );
  const ownedShipDefinitions = useMemo(
    () => shipDefinitions.filter((ship) => (fleetSnapshot.fleet.ships[ship.id] ?? 0) > 0),
    [fleetSnapshot.fleet],
  );
  const availableShipCount = useMemo(
    () => ownedShipDefinitions.reduce((total, ship) => total + (fleetSnapshot.fleet.ships[ship.id] ?? 0), 0),
    [fleetSnapshot.fleet, ownedShipDefinitions],
  );

  const selectedShipCount = useMemo(
    () => ownedShipDefinitions.reduce((total, ship) => total + (selectedQuantities[ship.id] ?? 0), 0),
    [ownedShipDefinitions, selectedQuantities],
  );
  const selectedPopulation = useMemo(
    () => ownedShipDefinitions.reduce((total, ship) => total + (selectedQuantities[ship.id] ?? 0) * ship.population, 0),
    [ownedShipDefinitions, selectedQuantities],
  );
  const selectedMission = missions.find((mission) => mission.id === missionId) ?? missions[0];
  const describedMission = missions.find((mission) => mission.id === hoveredMissionId) ?? selectedMission;

  const openFleetRoot = () => {
    setFleetSection('ships');
    setConstructionView(null);
    setStatus(FLEET_ROOT_STATUS);
  };

  useEffect(() => {
    const onRootRequest = () => openFleetRoot();
    window.addEventListener(FLEET_ROOT_REQUEST_EVENT, onRootRequest);
    return () => window.removeEventListener(FLEET_ROOT_REQUEST_EVENT, onRootRequest);
  }, []);

  useEffect(() => {
    const refresh = () => setFleetSnapshot(readApplicationFleetSnapshot());
    window.addEventListener(RUNTIME_STATE_CHANGED_EVENT, refresh);
    window.addEventListener('storage', refresh);
    return () => {
      window.removeEventListener(RUNTIME_STATE_CHANGED_EVENT, refresh);
      window.removeEventListener('storage', refresh);
    };
  }, []);

  useEffect(() => {
    if (!openConstruction) return;
    setFleetSection('ships');
    setConstructionView('ships');
    onConstructionOpened();
  }, [onConstructionOpened, openConstruction, setFleetSection]);

  const chooseSection = (section: FleetSectionId) => {
    setFleetSection(section);

    if (section === 'ships') {
      setConstructionView('ships');
      return;
    }
    if (section === 'defense') {
      setConstructionView('defense');
      return;
    }
    if (section === 'commander-ships') {
      setConstructionView('commander');
      return;
    }

    setConstructionView(null);
  };

  const setShipQuantity = (shipId: ShipId, raw: number) => {
    const available = fleetSnapshot.fleet.ships[shipId] ?? 0;
    const next = Number.isFinite(raw) ? Math.max(0, Math.min(available, Math.floor(raw))) : 0;
    setSelectedQuantities((current) => ({ ...current, [shipId]: next }));
  };

  const setAllShipQuantities = (maximum: boolean) => {
    setSelectedQuantities(Object.fromEntries(
      ownedShipDefinitions.map((ship) => [ship.id, maximum ? fleetSnapshot.fleet.ships[ship.id] ?? 0 : 0]),
    ) as Partial<Record<ShipId, number>>);
  };

  const closeConstructionView = () => setConstructionView(null);

  const mainClassName = [
    'fleet-main-v1',
    constructionView ? 'fleet-main-v1--shipyard' : '',
    selectedSection === 'battles' ? 'fleet-main-v1--battles' : '',
    selectedSection === 'simulator' ? 'fleet-main-v1--subpage' : '',
  ].filter(Boolean).join(' ');

  return (
    <div className="fleet-workspace-v1">
      <aside className="fleet-sidebar-v1">
        <div className="fleet-sidebar-title-v1">
          <span>ФЛОТЫ</span>
          <small>ФЛОТ АСТЕРОВ</small>
        </div>

        <div className="fleet-yard-card-v1" data-qa-building-role="shipyard" data-qa-building-asset={shipyardPresentation.art}>
          <div className="fleet-yard-emblem-v1">
            <img src={shipyardPresentation.art} alt="" aria-hidden="true" draggable={false} />
          </div>
          <div>
            <small>БАЗА ФЛОТА</small>
            <strong>{shipyardPresentation.name}</strong>
            <span>Ангар {fleetSnapshot.hangarLevel} · {shipyardPresentation.name} {fleetSnapshot.shipyardLevel}</span>
          </div>
        </div>

        <FleetMenuGroup title="СТРОИТЕЛЬСТВО" items={FLEET_CONSTRUCTION_NAVIGATION} selected={selectedSection} onSelect={chooseSection} />
        <FleetMenuGroup title="УПРАВЛЕНИЕ ФЛОТОМ" items={FLEET_MANAGEMENT_NAVIGATION} selected={selectedSection} onSelect={chooseSection} />
      </aside>

      <main className={mainClassName}>
        {constructionView === 'ships' ? (
          <ShipyardView planetName={planetName} coords={coords} onBack={closeConstructionView} />
        ) : constructionView === 'defense' || constructionView === 'commander' ? (
          <ConstructionCatalogView mode={constructionView} planetName={planetName} coords={coords} onBack={closeConstructionView} />
        ) : selectedSection === 'combat-priority' ? (
          <FleetCombatPriorityView planetName={planetName} coords={coords} onBack={openFleetRoot} />
        ) : selectedSection === 'battles' ? (
          <BattleReportsView planetName={planetName} coords={coords} onBack={openFleetRoot} />
        ) : selectedSection === 'simulator' ? (
          <SimulatorView planetName={planetName} coords={coords} onBack={openFleetRoot} />
        ) : (
          <>
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
                <span data-qa-fleet-population>ФЛОТ: {fleetSummary.population} / {fleetSummary.capacity} · В НАЛИЧИИ {availableShipCount} КОРАБЛЯ</span>
              </header>

              <div className="fleet-ship-roster-v1" data-qa-fleet-roster>
                {ownedShipDefinitions.map((ship) => {
                  const available = fleetSnapshot.fleet.ships[ship.id] ?? 0;
                  const selected = selectedQuantities[ship.id] ?? 0;
                  return (
                    <div className="fleet-ship-line-v1" key={ship.id} data-qa-fleet-ship={ship.id}>
                      <div className="fleet-ship-art-v1"><img src={ship.art} alt={ship.name} draggable={false} /></div>
                      <div className="fleet-ship-info-v1">
                        <small>{ship.role.toUpperCase()}</small>
                        <h3>{ship.name}</h3>
                        <div className="fleet-ship-meta-v1">
                          <span>В наличии <b data-qa-fleet-owned>{available}</b></span>
                          <span>Население / ед. <b data-qa-fleet-unit-population>{ship.population}</b></span>
                          <span>Выбрано <b>{selected}</b></span>
                        </div>
                      </div>
                      <div className="fleet-quantity-v1">
                        <span>КОЛИЧЕСТВО</span>
                        <input aria-label={`Количество ${ship.name}`} type="number" min="0" max={available} value={selected} onChange={(event) => setShipQuantity(ship.id, Number(event.target.value))} />
                        <div className="fleet-quantity-shortcuts-v1">
                          <button type="button" onClick={() => setShipQuantity(ship.id, available)}>МАКС.</button>
                          <button type="button" onClick={() => setShipQuantity(ship.id, 0)}>МИН.</button>
                        </div>
                      </div>
                    </div>
                  );
                })}
                {ownedShipDefinitions.length === 0 ? (
                  <div className="fleet-ship-roster-empty-v1">В наличии нет готовых кораблей.</div>
                ) : null}
              </div>

              <div className="fleet-selection-line-v1">
                <span>Выберите</span>
                <button type="button" onClick={() => setAllShipQuantities(true)}>Макс.</button>
                <span>/</span>
                <button type="button" onClick={() => setAllShipQuantities(false)}>Мин.</button>
                <i />
                <span>Выбрано кораблей</span><strong>{selectedShipCount}</strong>
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
                <button type="button" disabled={selectedShipCount === 0} onClick={() => setStatus(`${selectedShipCount} кораблей подготовлены. Выбрано населения: ${selectedPopulation}. Миссия: ${selectedMission.label}.`)}>ПРОДОЛЖИТЬ</button>
              </footer>
            </section>
          </>
        )}
      </main>
    </div>
  );
}

function FleetMenuGroup({ title, items, selected, onSelect }: { title: string; items: readonly FleetSectionItem[]; selected: FleetSectionId; onSelect: (section: FleetSectionId) => void }) {
  return (
    <section className="fleet-menu-group-v1">
      <h3>{title}</h3>
      {items.map((item) => (
        <button key={item.id} type="button" className={selected === item.id ? 'active' : ''} data-qa-fleet-section={item.id} onClick={() => onSelect(item.id)}>
          <span className="fleet-menu-icon-v1">◇</span><strong>{item.label}</strong><i>›</i>
        </button>
      ))}
    </section>
  );
}

function readCurrentPlanet() {
  const selector = document.querySelector<HTMLElement>('[data-qa-current-planet]');
  return {
    name: selector?.dataset.planetName || 'Helion 01',
    coords: selector?.dataset.planetCoords || '[1:1:1]',
  };
}

export function FleetWorkspacePortal() {
  const { route } = useNavigation();
  const [target, setTarget] = useState<Element | null>(null);
  const [planet, setPlanet] = useState({ name: 'Helion 01', coords: '[1:1:1]' });
  const [constructionRequested, setConstructionRequested] = useState(false);

  useEffect(() => {
    const syncPlanet = () => {
      setTarget(document.querySelector('.workspace'));
      setPlanet(readCurrentPlanet());
    };

    syncPlanet();
    window.addEventListener(RUNTIME_STATE_CHANGED_EVENT, syncPlanet);
    window.addEventListener('storage', syncPlanet);
    return () => {
      window.removeEventListener(RUNTIME_STATE_CHANGED_EVENT, syncPlanet);
      window.removeEventListener('storage', syncPlanet);
    };
  }, [route]);

  useEffect(() => {
    const onConstructionRequest = () => setConstructionRequested(true);
    window.addEventListener(FLEET_CONSTRUCTION_REQUEST_EVENT, onConstructionRequest);
    return () => window.removeEventListener(FLEET_CONSTRUCTION_REQUEST_EVENT, onConstructionRequest);
  }, []);

  if (route !== 'fleets' || !target) return null;
  return createPortal(
    <FleetWorkspace
      planetName={planet.name}
      coords={planet.coords}
      openConstruction={constructionRequested}
      onConstructionOpened={() => setConstructionRequested(false)}
    />,
    target,
  );
}
