import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { getFactionShipCatalog } from './domain/combat/faction-catalog.ts';
import { getCombatFactionName } from './domain/combat/factions.ts';
import type { ShipId } from './domain/combat/ids.ts';
import { SOLAR_SATELLITE_ID } from './domain/combat/ids.ts';
import { getBuildingPresentation } from './domain/buildings/balance-v1.ts';
import { RUNTIME_STATE_CHANGED_EVENT } from './domain/runtime/mode.ts';
import {
  getFleetSummaryForSnapshot,
  readFleetBuildBudget,
  readFleetSnapshot as readApplicationFleetSnapshot,
  type FleetBuildBudget,
  type FleetSnapshot,
} from './application/fleet.ts';
import { BattleReportsView } from './BattleReportsView';
import { ConstructionCatalogView, type ConstructionCatalogMode } from './ConstructionCatalogView';
import { FleetProductionQueueView } from './FleetProductionQueueView';
import { FleetCombatPriorityView } from './FleetCombatPriorityView';
import { FLEET_ROOT_REQUEST_EVENT } from './FleetRootNavigationController';
import { FLEET_CONSTRUCTION_REQUEST_EVENT } from './building-interior-navigation.ts';
import { ShipyardView } from './ShipyardView';
import { SimulatorView } from './SimulatorView';
import type { FleetProductionQueueKind } from './domain/fleet/production.ts';
import { FLEET_PRODUCTION_DISMANTLE_SATELLITES_REQUEST_EVENT } from './application/fleet-production.ts';
import {
  FLIGHT_COMMAND_RESULT_EVENT,
  FLIGHT_DISPATCH_REQUEST_EVENT,
  FLIGHT_LAUNCH_CONTEXT_EVENT,
  FLIGHT_RECALL_REQUEST_EVENT,
  previewFlight,
  type FlightCommandResult,
  type FlightLaunchContext,
} from './application/flights.ts';
import type { FlightRecord, MissionId } from './domain/flights/types.ts';
import { ACTIVE_RUNTIME_MODE, resolveTestTimeScale } from './domain/runtime/mode.ts';
import { createPersistenceFacade } from './application/persistence.ts';
import {
  FLEET_CONSTRUCTION_NAVIGATION,
  FLEET_MANAGEMENT_NAVIGATION,
  useNavigation,
  type FleetSectionId,
  type FleetSectionItem,
} from './ui/navigation.tsx';
import './building-card.css';
import './fleet-workspace.css';

const FLEET_ROOT_STATUS = 'Выберите корабли и миссию. Для колонизации сначала выберите свободную координату во Вселенной.';

type MissionDefinition = {
  id: MissionId;
  label: string;
  description: string;
  icon: string;
};

type ConstructionView = 'ships' | ConstructionCatalogMode | null;

import missionTransportIcon from '../assets/source/mission-icons-v1/01_transport.png';
import missionEspionageIcon from '../assets/source/mission-icons-v1/02_espionage.png';
import missionAttackIcon from '../assets/source/mission-icons-v1/03_attack.png';
import missionDeploymentIcon from '../assets/source/mission-icons-v1/04_deployment.png';
import missionColonizeIcon from '../assets/source/mission-icons-v1/05_colonize.png';
import missionRecycleIcon from '../assets/source/mission-icons-v1/06_recycle.png';
import missionGasIcon from '../assets/source/mission-icons-v1/07_gas_harvest.png';
import missionSunSupportIcon from '../assets/source/mission-icons-v1/08_sun_support.png';
import missionSpaceFlightIcon from '../assets/source/mission-icons-v1/09_space_flight.png';

function queueKindForConstructionView(view: ConstructionView): FleetProductionQueueKind | null {
  if (view === 'ships') return 'ships';
  if (view === 'defense') return 'defense';
  if (view === 'commander') return 'commanders';
  return null;
}

const missions: MissionDefinition[] = [
  { id: 'transport', label: 'Транспортировка', description: 'Перевозка ресурсов между доступными планетами.', icon: missionTransportIcon },
  { id: 'espionage', label: 'Шпионаж', description: 'Разведка цели и получение шпионского отчёта.', icon: missionEspionageIcon },
  { id: 'attack', label: 'Атака', description: 'Боевой вылет против выбранной цели.', icon: missionAttackIcon },
  { id: 'deployment', label: 'Дислокация', description: 'Переброска флота на свою планету или к союзнику.', icon: missionDeploymentIcon },
  { id: 'colonize', label: 'Колонизация', description: 'Основание новой колонии на свободной планете.', icon: missionColonizeIcon },
  { id: 'recycle', label: 'Переработка', description: 'Сбор и переработка обломков в космосе.', icon: missionRecycleIcon },
  { id: 'gas', label: 'Добыча газа', description: 'Специализированная экспедиция за газом.', icon: missionGasIcon },
  { id: 'sun-support', label: 'Поддержка солнца', description: 'Отправка флота для специальной солнечной операции.', icon: missionSunSupportIcon },
  { id: 'space-flight', label: 'Космический рейс', description: 'Дальний автономный рейс с заданной продолжительностью.', icon: missionSpaceFlightIcon },
];

function MissionIcon({ mission }: { mission: MissionDefinition }) {
  return <img src={mission.icon} alt="" draggable={false} />;
}

function flightCoordinateLabel(coordinate: { galaxy: number; system: number; position: number }) {
  return `[${coordinate.galaxy}:${coordinate.system}:${coordinate.position}]`;
}

function flightMissionLabel(missionId: MissionId) {
  return missions.find((mission) => mission.id === missionId)?.label ?? missionId;
}

function flightCountdown(targetAt: number | undefined, now: number) {
  if (targetAt === undefined) return '—';
  const seconds = Math.max(0, Math.ceil((targetAt - now) / 1000));
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

function FleetWorkspace({
  planetName,
  coords,
  openConstruction,
  onConstructionOpened,
  fleetBudget: initialFleetBudget,
  launchContext,
  flightRecords,
}: {
  planetName: string;
  coords: string;
  openConstruction: boolean;
  onConstructionOpened: () => void;
  fleetBudget: FleetBuildBudget;
  launchContext: FlightLaunchContext | null;
  flightRecords: FlightRecord[];
}) {
  const { fleetSection: selectedSection, setFleetSection } = useNavigation();
  const [selectedQuantities, setSelectedQuantities] = useState<Partial<Record<ShipId, number>>>({});
  const [missionId, setMissionId] = useState<MissionId>('transport');
  const [hoveredMissionId, setHoveredMissionId] = useState<MissionId | null>(null);
  const [constructionView, setConstructionView] = useState<ConstructionView>(null);
  const [status, setStatus] = useState(FLEET_ROOT_STATUS);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewResult, setPreviewResult] = useState<FlightCommandResult | null>(null);
  const [pendingRecall, setPendingRecall] = useState<FlightRecord | null>(null);
  const [clockNow, setClockNow] = useState(() => Date.now());
  const [fleetSnapshot, setFleetSnapshot] = useState<FleetSnapshot>(readApplicationFleetSnapshot);
  const [fleetBudget, setFleetBudget] = useState<FleetBuildBudget>(initialFleetBudget);
  const [pendingSatelliteDismantle, setPendingSatelliteDismantle] = useState<number | null>(null);
  const satelliteConfirmYesRef = useRef<HTMLButtonElement>(null);
  const satelliteConfirmNoRef = useRef<HTMLButtonElement>(null);
  const factionId = fleetSnapshot.factionId;
  const factionName = getCombatFactionName(factionId);
  const shipDefinitions = useMemo(() => getFactionShipCatalog(factionId), [factionId]);
  const satelliteDefinition = useMemo(
    () => shipDefinitions.find((ship) => ship.id === SOLAR_SATELLITE_ID) ?? null,
    [shipDefinitions],
  );
  const shipyardPresentation = useMemo(
    () => getBuildingPresentation('shipyard', factionId),
    [factionId],
  );
  const fleetSummary = useMemo(
    () => getFleetSummaryForSnapshot(fleetSnapshot),
    [fleetSnapshot.factionId, fleetSnapshot.fleet, fleetSnapshot.fleetProduction, fleetSnapshot.hangarLevel],
  );
  const ownedShipDefinitions = useMemo(
    () => shipDefinitions.filter((ship) => ship.id !== SOLAR_SATELLITE_ID && (fleetSnapshot.fleet.ships[ship.id] ?? 0) > 0),
    [fleetSnapshot.fleet, shipDefinitions],
  );
  const availableShipCount = useMemo(
    () => ownedShipDefinitions.reduce((total, ship) => total + (fleetSnapshot.fleet.ships[ship.id] ?? 0), 0),
    [fleetSnapshot.fleet, ownedShipDefinitions],
  );

  useEffect(() => {
    setFleetBudget(initialFleetBudget);
  }, [initialFleetBudget]);

  const visibleShipDefinitions = missionId === 'colonize'
    ? ownedShipDefinitions.filter((ship) => ship.id === 'colonizer')
    : ownedShipDefinitions;
  const selectedShipCount = useMemo(
    () => visibleShipDefinitions.reduce((total, ship) => total + (selectedQuantities[ship.id] ?? 0), 0),
    [selectedQuantities, visibleShipDefinitions],
  );
  const selectedPopulation = useMemo(
    () => visibleShipDefinitions.reduce((total, ship) => total + (selectedQuantities[ship.id] ?? 0) * ship.population, 0),
    [selectedQuantities, visibleShipDefinitions],
  );
  const selectedMission = missions.find((mission) => mission.id === missionId) ?? missions[0];
  const describedMission = missions.find((mission) => mission.id === hoveredMissionId) ?? selectedMission;
  const activeFlightRecords = useMemo(
    () => flightRecords.filter((flight) => flight.phase === 'outbound' || flight.phase === 'returning' || flight.phase === 'arrived'),
    [flightRecords],
  );

  useEffect(() => {
    const timer = window.setInterval(() => setClockNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!launchContext) return;
    setMissionId(launchContext.missionId);
    setSelectedQuantities(launchContext.missionId === 'colonize' ? { colonizer: 1 } : {});
    setStatus(`Цель: ${launchContext.destination.coordinate ? `[${launchContext.destination.coordinate.galaxy}:${launchContext.destination.coordinate.system}:${launchContext.destination.coordinate.position}]` : 'выбрана'}.`);
  }, [launchContext]);

  useEffect(() => {
    const onCommandResult = (event: Event) => {
      const result = (event as CustomEvent<FlightCommandResult>).detail;
      if (result.ok) {
        setStatus(result.notice);
        setPreviewOpen(false);
        setPreviewResult(null);
      } else {
        setStatus(result.error.message);
      }
    };
    window.addEventListener(FLIGHT_COMMAND_RESULT_EVENT, onCommandResult);
    return () => window.removeEventListener(FLIGHT_COMMAND_RESULT_EVENT, onCommandResult);
  }, []);

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
    const refresh = () => {
      setFleetSnapshot(readApplicationFleetSnapshot());
      setFleetBudget(readFleetBuildBudget());
    };
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

  useEffect(() => {
    if (pendingSatelliteDismantle == null) return;
    const previousActiveElement = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusFrame = window.requestAnimationFrame(() => satelliteConfirmYesRef.current?.focus());
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setPendingSatelliteDismantle(null);
        return;
      }
      if (event.key !== 'Tab') return;
      const controls = [satelliteConfirmYesRef.current, satelliteConfirmNoRef.current]
        .filter((control): control is HTMLButtonElement => Boolean(control));
      if (controls.length === 0) return;
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      window.removeEventListener('keydown', onKeyDown);
      if (previousActiveElement?.isConnected) previousActiveElement.focus();
    };
  }, [pendingSatelliteDismantle]);

  const confirmSatelliteDismantle = () => {
    if (pendingSatelliteDismantle == null) return;
    const count = pendingSatelliteDismantle;
    setPendingSatelliteDismantle(null);
    window.dispatchEvent(new CustomEvent(FLEET_PRODUCTION_DISMANTLE_SATELLITES_REQUEST_EVENT, {
      detail: { count },
    }));
  };

  const createColonizationCommand = (requestId: string) => {
    if (!launchContext || missionId !== 'colonize') return null;
    const runtimeState = createPersistenceFacade({ mode: ACTIVE_RUNTIME_MODE }).read();
    return {
      requestId,
      missionId: 'colonize' as const,
      originPlanetId: runtimeState.currentPlanetId,
      destination: launchContext.destination,
      targetKind: launchContext.targetKind ?? 'empty',
      selectedShips: { colonizer: 1 as const },
      operationId: launchContext.operationId,
      departedAt: Date.now(),
    };
  };

  const openFlightPreview = () => {
    if (missionId !== 'colonize') {
      setStatus('Эта миссия пока не подключена к flight runtime.');
      return;
    }
    const command = createColonizationCommand(`preview-${Date.now()}`);
    if (!command) {
      setStatus('Сначала выберите свободную координату во Вселенной.');
      return;
    }
    setPreviewResult(previewFlight(createPersistenceFacade({ mode: ACTIVE_RUNTIME_MODE }).read(), command, { mode: ACTIVE_RUNTIME_MODE, testTimeScale: resolveTestTimeScale() }));
    setPreviewOpen(true);
  };

  const confirmFlightDispatch = () => {
    const requestId = globalThis.crypto?.randomUUID?.() ?? `flight-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    const command = createColonizationCommand(requestId);
    if (!command) return;
    window.dispatchEvent(new CustomEvent(FLIGHT_DISPATCH_REQUEST_EVENT, { detail: command }));
  };

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
    if (missionId === 'colonize' && shipId !== 'colonizer') return;
    const available = fleetSnapshot.fleet.ships[shipId] ?? 0;
    const next = missionId === 'colonize'
      ? Math.min(1, available)
      : Number.isFinite(raw) ? Math.max(0, Math.min(available, Math.floor(raw))) : 0;
    setSelectedQuantities((current) => ({ ...current, [shipId]: next }));
  };

  const setAllShipQuantities = (maximum: boolean) => {
    setSelectedQuantities(Object.fromEntries(
      visibleShipDefinitions.map((ship) => [ship.id, maximum ? (missionId === 'colonize' ? 1 : fleetSnapshot.fleet.ships[ship.id] ?? 0) : 0]),
    ) as Partial<Record<ShipId, number>>);
  };

  const mainClassName = [
    'fleet-main-v1',
    constructionView ? 'fleet-main-v1--shipyard' : '',
    selectedSection === 'battles' ? 'fleet-main-v1--battles' : '',
    selectedSection === 'simulator' ? 'fleet-main-v1--subpage' : '',
  ].filter(Boolean).join(' ');
  const productionQueueKind = queueKindForConstructionView(constructionView);

  return (
    <div className="fleet-workspace-v1" data-qa-flight-launch-context={launchContext ? flightCoordinateLabel(launchContext.destination.coordinate) : undefined}>
      <aside className="fleet-sidebar-v1">
        <div className="fleet-sidebar-title-v1">
          <small>ASTERION // ВОЕННАЯ ЗОНА</small>
          <span>ФЛОТЫ</span>
          <em>ФЛОТ {factionName.toUpperCase()}</em>
        </div>

        <div
          className="building-card-v2 fleet-yard-card-v1"
          data-qa-building-role="shipyard"
          data-qa-building-faction={factionId}
          data-qa-building-asset={shipyardPresentation.art}
        >
          <img src={shipyardPresentation.art} alt="Верфь" draggable={false} />
          <div>
            <small>{planetName}</small>
            <strong>Верфь</strong>
            <span className="fleet-yard-level-v1">УРОВЕНЬ {fleetSnapshot.shipyardLevel}</span>
            <p>Ангар {fleetSnapshot.hangarLevel} · производство флота и обороны.</p>
          </div>
        </div>

        <FleetMenuGroup title="СТРОИТЕЛЬСТВО" items={FLEET_CONSTRUCTION_NAVIGATION} selected={selectedSection} onSelect={chooseSection} />
        <FleetMenuGroup title="УПРАВЛЕНИЕ ФЛОТОМ" items={FLEET_MANAGEMENT_NAVIGATION} selected={selectedSection} onSelect={chooseSection} />

        {productionQueueKind ? (
          <FleetProductionQueueView
            queueKind={productionQueueKind}
            state={fleetSnapshot.fleetProduction}
            factionId={factionId}
            onBack={openFleetRoot}
          />
        ) : null}
      </aside>

      <main className={mainClassName}>
        {constructionView === 'ships' ? (
          <ShipyardView planetName={planetName} coords={coords} budget={fleetBudget} />
        ) : constructionView === 'defense' || constructionView === 'commander' ? (
          <ConstructionCatalogView mode={constructionView} planetName={planetName} coords={coords} budget={fleetBudget} />
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
                {activeFlightRecords.length === 0 ? <div className="fleet-flight-empty-v1" data-qa-flight-empty>
                  <strong>Активных полётов нет</strong>
                  <span>Флоты, находящиеся в пути, будут отображаться здесь.</span>
                </div> : activeFlightRecords.map((flight) => <div className="fleet-flight-row-v1" key={flight.id} data-qa-flight-row={flight.id} data-qa-flight-phase={flight.phase}>
                  <span data-qa-flight-origin>{flightCoordinateLabel(flight.originCoordinate)}</span>
                  <span data-qa-flight-target>{flightCoordinateLabel(flight.destinationCoordinate)}</span>
                  <span data-qa-flight-arrival>{flight.phase === 'outbound' ? flightCountdown(flight.arrivalAt, clockNow) : '—'}</span>
                  <span data-qa-flight-return>{flight.phase === 'returning' ? flightCountdown(flight.returnAt, clockNow) : '—'}</span>
                  <span><img className="fleet-flight-mission-icon" src={missions.find((mission) => mission.id === flight.missionId)?.icon} alt="" />{flightMissionLabel(flight.missionId)}</span>
                  <span><button type="button" data-qa-flight-recall={flight.id} disabled={flight.phase !== 'outbound'} onClick={() => setPendingRecall(flight)}>ОТОЗВАТЬ</button></span>
                </div>)}
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
                <span data-qa-fleet-population>ФЛОТ: {fleetSummary.population} / {fleetSummary.capacity} · В НАЛИЧИИ {availableShipCount} КОРАБЛЯ · СПУТНИКИ {fleetSnapshot.solarSatellites}</span>
              </header>

              <div className="fleet-satellite-presence-v1" data-qa-fleet-satellites>
                <div className="fleet-satellite-art-v1">
                  {satelliteDefinition ? <img src={satelliteDefinition.art} alt="" draggable={false} /> : null}
                </div>
                <div className="fleet-satellite-copy-v1">
                  <small>ОРБИТАЛЬНОЕ ПРИСУТСТВИЕ</small>
                  <strong>{satelliteDefinition?.name ?? 'Солнечные спутники'}</strong>
                  <span>{fleetSnapshot.solarSatellites > 0 ? `На орбите: ${fleetSnapshot.solarSatellites}` : 'На орбите нет спутников'} · население/ед.: 1</span>
                </div>
                <button
                  type="button"
                  className="fleet-satellite-dismantle-v1"
                  aria-label="Уничтожить солнечные спутники"
                  title="Уничтожить солнечные спутники"
                  disabled={fleetSnapshot.solarSatellites <= 0}
                  onClick={() => {
                    if (fleetSnapshot.solarSatellites <= 0) return;
                    setPendingSatelliteDismantle(fleetSnapshot.solarSatellites);
                  }}
                >X</button>
              </div>

              <div className="fleet-ship-roster-v1" data-qa-fleet-roster>
                {visibleShipDefinitions.map((ship) => {
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
                {visibleShipDefinitions.length === 0 ? (
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
                      <MissionIcon mission={mission} />
                      <span>{mission.label}</span>
                    </button>
                  ))}
                </div>
                <p className="fleet-mission-description-v1"><strong>{describedMission.label}.</strong> {describedMission.description}</p>
              </div>

              <footer className="fleet-compose-footer-v1">
                <span>{status}</span>
                <button type="button" data-qa-flight-preview-open disabled={selectedShipCount === 0} onClick={openFlightPreview}>ПРОДОЛЖИТЬ</button>
              </footer>
            </section>
          </>
        )}
      </main>

      {pendingSatelliteDismantle != null ? createPortal(
        <div
          className="resource-building-action-confirm-backdrop"
          data-qa-satellite-dismantle-backdrop
          onMouseDown={() => setPendingSatelliteDismantle(null)}
        >
          <section
            className="resource-building-action-confirm"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="satellite-dismantle-confirm-title"
            aria-describedby="satellite-dismantle-confirm-description"
            data-qa-satellite-dismantle-confirm
            onMouseDown={(event) => event.stopPropagation()}
          >
            <small>ПОДТВЕРЖДЕНИЕ ДЕЙСТВИЯ</small>
            <h3 id="satellite-dismantle-confirm-title">Уничтожить спутники?</h3>
            <p id="satellite-dismantle-confirm-description">
              Вы уверены, что хотите уничтожить солнечные спутники ({pendingSatelliteDismantle} шт.)? Ресурсы за них не возвращаются.
            </p>
            <div className="resource-building-action-confirm-actions">
              <button ref={satelliteConfirmYesRef} type="button" data-qa-satellite-dismantle-confirm-yes onClick={confirmSatelliteDismantle}>ДА</button>
              <button ref={satelliteConfirmNoRef} type="button" data-qa-satellite-dismantle-confirm-no onClick={() => setPendingSatelliteDismantle(null)}>НЕТ</button>
            </div>
          </section>
        </div>,
        document.body,
      ) : null}
      {previewOpen && previewResult ? createPortal(
        <div className="resource-building-action-confirm-backdrop" data-qa-flight-preview-backdrop onMouseDown={() => setPreviewOpen(false)}>
          <section className="resource-building-action-confirm flight-preview-modal" role="dialog" aria-modal="true" aria-labelledby="flight-preview-title" onMouseDown={(event) => event.stopPropagation()}>
            <small>ПРЕДПРОСМОТР РЕЙСА</small>
            <h3 id="flight-preview-title">{previewResult.ok ? 'Подтвердить колонизацию?' : 'Рейс недоступен'}</h3>
            {previewResult.ok ? <>
              <p data-qa-flight-preview>Цель: {flightCoordinateLabel(previewResult.flight.destinationCoordinate)} · маршрут {previewResult.flight.routeDistance} ед.</p>
              <p>В один конец: {Math.ceil(previewResult.flight.oneWayDurationMs / 60_000)} мин · газ: {previewResult.flight.gasCost} · прибытие: {new Date(previewResult.flight.arrivalAt).toLocaleString('ru-RU')}</p>
              <p>Будет отправлен ровно один колонизатор. Газ списывается только за исходящий участок.</p>
              <div className="resource-building-action-confirm-actions">
                <button type="button" data-qa-flight-dispatch-confirm onClick={confirmFlightDispatch}>ОТПРАВИТЬ</button>
                <button type="button" data-qa-flight-preview-cancel onClick={() => setPreviewOpen(false)}>ОТМЕНА</button>
              </div>
            </> : <>
              <p data-qa-flight-preview-error>{previewResult.error.message}</p>
              <div className="resource-building-action-confirm-actions"><button type="button" onClick={() => setPreviewOpen(false)}>ЗАКРЫТЬ</button></div>
            </>}
          </section>
        </div>,
        document.body,
      ) : null}
      {pendingRecall ? createPortal(
        <div className="resource-building-action-confirm-backdrop" data-qa-flight-recall-backdrop onMouseDown={() => setPendingRecall(null)}>
          <section className="resource-building-action-confirm" role="alertdialog" aria-modal="true" aria-labelledby="flight-recall-title" onMouseDown={(event) => event.stopPropagation()}>
            <small>ПОДТВЕРЖДЕНИЕ ОТЗЫВА</small>
            <h3 id="flight-recall-title">Отозвать рейс?</h3>
            <p>Колонизатор вернётся с обратным таймером. Газ за исходящий участок не возвращается.</p>
            <div className="resource-building-action-confirm-actions">
              <button type="button" data-qa-flight-recall-confirm onClick={() => { window.dispatchEvent(new CustomEvent(FLIGHT_RECALL_REQUEST_EVENT, { detail: { flightId: pendingRecall.id, now: Date.now() } })); setPendingRecall(null); }}>ОТОЗВАТЬ</button>
              <button type="button" data-qa-flight-recall-cancel onClick={() => setPendingRecall(null)}>ОТМЕНА</button>
            </div>
          </section>
        </div>,
        document.body,
      ) : null}
    </div>
  );
}

function FleetMenuGroup({ title, items, selected, onSelect }: { title: string; items: readonly FleetSectionItem[]; selected: FleetSectionId; onSelect: (section: FleetSectionId) => void }) {
  return (
    <section className="fleet-menu-group-v1">
      <h3>{title}</h3>
      {items.map((item) => (
        <button key={item.id} type="button" className={selected === item.id ? 'active' : ''} data-qa-fleet-section={item.id} onClick={() => onSelect(item.id)}>
          <strong>{item.label}</strong>
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
  const [fleetBudget, setFleetBudget] = useState<FleetBuildBudget>(readFleetBuildBudget);
  const [launchContext, setLaunchContext] = useState<FlightLaunchContext | null>(null);
  const [flightRecords, setFlightRecords] = useState<FlightRecord[]>(() => createPersistenceFacade({ mode: ACTIVE_RUNTIME_MODE }).read().flights.records);

  useEffect(() => {
    const syncPlanet = () => {
      const runtimeState = createPersistenceFacade({ mode: ACTIVE_RUNTIME_MODE }).read();
      setTarget(document.querySelector('.workspace'));
      setPlanet(readCurrentPlanet());
      setFleetBudget(readFleetBuildBudget());
      setFlightRecords(runtimeState.flights.records);
    };

    const onLaunchContext = (event: Event) => setLaunchContext((event as CustomEvent<FlightLaunchContext>).detail);
    const onCommandResult = (event: Event) => {
      const result = (event as CustomEvent<FlightCommandResult>).detail;
      if (result.ok) setFlightRecords(result.state.flights.records);
    };

    syncPlanet();
    window.addEventListener(FLIGHT_LAUNCH_CONTEXT_EVENT, onLaunchContext);
    window.addEventListener(FLIGHT_COMMAND_RESULT_EVENT, onCommandResult);
    window.addEventListener(RUNTIME_STATE_CHANGED_EVENT, syncPlanet);
    window.addEventListener('storage', syncPlanet);
    return () => {
      window.removeEventListener(FLIGHT_LAUNCH_CONTEXT_EVENT, onLaunchContext);
      window.removeEventListener(FLIGHT_COMMAND_RESULT_EVENT, onCommandResult);
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
        fleetBudget={fleetBudget}
        launchContext={launchContext}
        flightRecords={flightRecords}
      />,
    target,
  );
}
