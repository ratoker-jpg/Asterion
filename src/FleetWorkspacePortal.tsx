import type { CSSProperties } from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { getFactionShipCatalog } from './domain/combat/faction-catalog.ts';
import { COMMANDER_COMBAT_CATALOG } from './domain/combat/catalog.ts';
import { getCombatFactionName } from './domain/combat/factions.ts';
import { COMMANDER_ABILITIES, COMMANDER_IDS, type CommanderId } from './domain/combat/commanders.ts';
import type { ShipId } from './domain/combat/ids.ts';
import type { SimulatorMaxRounds } from './domain/combat/simulator.ts';
import { SOLAR_SATELLITE_ID } from './domain/combat/ids.ts';
import { getBuildingPresentation } from './domain/buildings/balance-v1.ts';
import { RUNTIME_RESET_EVENT, RUNTIME_STATE_CHANGED_EVENT } from './domain/runtime/mode.ts';
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
import type { SimulatorScenario } from './domain/combat/simulator.ts';
import { consumeSimulatorHandoff, SIMULATOR_HANDOFF_REQUEST_EVENT } from './application/simulator-handoff.ts';
import type { FleetProductionQueueKind } from './domain/fleet/production.ts';
import { OVERPOPULATION_WINDOW_MS } from './domain/fleet/overpopulation.ts';
import { FLEET_PRODUCTION_DISMANTLE_SATELLITES_REQUEST_EVENT } from './application/fleet-production.ts';
import { getPlanetOverpopulationSummary } from './application/overpopulation.ts';
import {
  FLIGHT_COMMAND_RESULT_EVENT,
  FLIGHT_DISPATCH_REQUEST_EVENT,
  FLIGHT_LAUNCH_CONTEXT_CLEAR_EVENT,
  FLIGHT_LAUNCH_CONTEXT_EVENT,
  FLIGHT_RECALL_REQUEST_EVENT,
  SPY_REPORT_ALL_REQUEST_EVENT,
  SPY_REPORT_REQUEST_EVENT,
  SPY_REPORT_RESULT_EVENT,
  getTransportCargoSummary,
  getAvailableFleetForPlanet,
  resolveTransportTarget,
  previewFlight,
  type DispatchFlightCommand,
  type FlightCommandResult,
  type FlightLaunchContext,
} from './application/flights.ts';
import { getAttackCommanderSelection, isAttackCombatShip } from './application/attack.ts';
import type { FlightDestination, FlightRecord, MissionId, TargetRelation } from './domain/flights/types.ts';
import type { EspionageState, SpyMission } from './domain/espionage/types.ts';
import { emptyTransportCargo, getCargoFieldMaximum, type TransportCargo, type TransportCargoKey } from './domain/flights/cargo.ts';
import { getOverflowWarning } from './domain/flights/cargo.ts';
import { getPlanetResources } from './application/contracts.ts';
import { getStorageCapacities } from './domain/buildings/resource-zone.ts';
import { FLIGHT_POSITION_COUNT, FLIGHT_SYSTEM_COUNT, isFlightCoordinate } from './domain/flights/distance.ts';
import { ACTIVE_RUNTIME_MODE, resolveTestTimeScale } from './domain/runtime/mode.ts';
import { createPersistenceFacade } from './application/persistence.ts';
import {
  FLEET_CONSTRUCTION_NAVIGATION,
  FLEET_MANAGEMENT_NAVIGATION,
  useNavigation,
  type FleetSectionId,
  type FleetSectionItem,
} from './ui/navigation.tsx';
import { ResourceIcon } from './ui/resources/ResourceIcon';
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
  { id: 'deployment', label: 'Дислокация', description: 'Переброска флота только между своими планетами.', icon: missionDeploymentIcon },
  { id: 'colonize', label: 'Колонизация', description: 'Основание новой колонии на свободной планете.', icon: missionColonizeIcon },
  { id: 'recycle', label: 'Переработка', description: 'Сбор и переработка обломков в космосе.', icon: missionRecycleIcon },
  { id: 'gas', label: 'Добыча газа', description: 'Специализированная экспедиция за газом.', icon: missionGasIcon },
  { id: 'sun-support', label: 'Поддержка солнца', description: 'Отправка флота для специальной солнечной операции.', icon: missionSunSupportIcon },
  { id: 'space-flight', label: 'Космический рейс', description: 'Дальний автономный рейс с заданной продолжительностью.', icon: missionSpaceFlightIcon },
];

const flightCargoResources = [
  { kind: 'metal', label: 'МЕТАЛЛ' },
  { kind: 'minerals', label: 'МИНЕРАЛЫ' },
  { kind: 'gas', label: 'ГАЗ' },
  { kind: 'debris', label: 'ОБЛОМКИ' },
] as const;

function MissionIcon({ mission }: { mission: MissionDefinition }) {
  return <img src={mission.icon} alt="" draggable={false} />;
}

function flightCoordinateLabel(coordinate: { galaxy: number; system: number; position: number }) {
  return `[${coordinate.galaxy}:${coordinate.system}:${coordinate.position}]`;
}

type FlightCoordinateDraft = {
  galaxy: string;
  system: string;
  position: string;
};

type TransportTargetOption = {
  id: string;
  name: string;
  relation: 'self';
  coordinate: FlightDestination['coordinate'];
  blocked?: boolean;
  actualPopulation?: number;
  capacity?: number;
  unlockAt?: number;
  noEligibleBurnUnits?: boolean;
};

function flightCoordinateDraft(coordinate: FlightDestination['coordinate']): FlightCoordinateDraft {
  return {
    galaxy: String(coordinate.galaxy),
    system: String(coordinate.system),
    position: String(coordinate.position),
  };
}

function coordinateFromDraft(draft: FlightCoordinateDraft): FlightDestination['coordinate'] {
  return {
    galaxy: Number(draft.galaxy),
    system: Number(draft.system),
    position: Number(draft.position),
  };
}

function coordinateDraftError(draft: FlightCoordinateDraft): string | null {
  const coordinate = coordinateFromDraft(draft);
  if (!draft.galaxy.trim() || !draft.system.trim() || !draft.position.trim()) return 'Заполните галактику, систему и позицию.';
  if (!isFlightCoordinate(coordinate)) return `Допустимо: галактика ≥ 1, система 1–${FLIGHT_SYSTEM_COUNT}, позиция 1–${FLIGHT_POSITION_COUNT}.`;
  return null;
}

function shipCountLabel(count: number) {
  const remainder = count % 100;
  if (remainder >= 11 && remainder <= 14) return 'КОРАБЛЕЙ';
  switch (count % 10) {
    case 1: return 'КОРАБЛЬ';
    case 2:
    case 3:
    case 4: return 'КОРАБЛЯ';
    default: return 'КОРАБЛЕЙ';
  }
}

function targetErrorFromFlightResult(result: FlightCommandResult): string | null {
  if (result.ok) return null;
  if (result.error.code === 'invalid-coordinate' || result.error.code === 'target-occupied' || result.error.code === 'target-not-colonizable' || result.error.code === 'target-not-available' || result.error.code === 'target-is-origin' || result.error.code === 'spy-target-blocked' || result.error.code === 'spy-mission-not-found') {
    return result.error.message;
  }
  return null;
}

function flightMissionLabel(missionId: MissionId) {
  return missions.find((mission) => mission.id === missionId)?.label ?? missionId;
}

function flightCountdown(targetAt: number | undefined, now: number) {
  if (targetAt === undefined) return '—';
  const seconds = Math.max(0, Math.ceil((targetAt - now) / 1000));
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

function flightDurationLabel(durationMs: number) {
  const seconds = Math.max(0, Math.ceil(durationMs / 1000));
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

function flightNumberLabel(value: number) {
  return new Intl.NumberFormat('ru-RU').format(value);
}

function capacityFillPct(used: number, total: number) {
  return total > 0 ? Math.min(100, Math.max(0, (used / total) * 100)) : 0;
}

function capacityFillTone(used: number, total: number) {
  const pct = capacityFillPct(used, total);
  return pct <= 20 ? 'normal' : pct <= 40 ? 'positive' : pct <= 55 ? 'watch' : pct <= 70 ? 'warning' : pct <= 85 ? 'danger' : 'critical';
}

function flightArrivalLabel(timestamp: number) {
  return new Date(timestamp).toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'Europe/Moscow',
  });
}

function spyStatusLabel(mission: SpyMission, flight: FlightRecord, now: number) {
  if (mission.status === 'transit') return `В ПУТИ · ${flightCountdown(flight.arrivalAt, now)}`;
  if (mission.status === 'returning') return `ВОЗВРАЩЕНИЕ · ${flightCountdown(flight.returnAt, now)}`;
  if (mission.nextReportAt !== undefined && now < mission.nextReportAt) return `ОТЧЁТ ЧЕРЕЗ ${flightCountdown(mission.nextReportAt, now)}`;
  return 'ОТЧЁТ ГОТОВ';
}

function FleetWorkspace({
  planetId,
  planetName,
  coords,
  openConstruction,
  onConstructionOpened,
  fleetBudget: initialFleetBudget,
  launchContext,
  flightRecords,
  espionageState,
  entityLevels,
}: {
  planetId: string;
  planetName: string;
  coords: string;
  openConstruction: boolean;
  onConstructionOpened: () => void;
  fleetBudget: FleetBuildBudget;
  launchContext: FlightLaunchContext | null;
  flightRecords: FlightRecord[];
  espionageState: EspionageState;
  entityLevels: Record<string, number>;
}) {
  const { fleetSection: selectedSection, setFleetSection } = useNavigation();
  const [selectedQuantities, setSelectedQuantities] = useState<Partial<Record<ShipId, number>>>({});
  const [selectedCommanders, setSelectedCommanders] = useState<Partial<Record<CommanderId, number>>>({});
  const [attackRounds, setAttackRounds] = useState<SimulatorMaxRounds>(8);
  const [missionId, setMissionId] = useState<MissionId>('transport');
  const [hoveredMissionId, setHoveredMissionId] = useState<MissionId | null>(null);
  const [constructionView, setConstructionView] = useState<ConstructionView>(null);
  const [status, setStatus] = useState(FLEET_ROOT_STATUS);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewResult, setPreviewResult] = useState<FlightCommandResult | null>(null);
  const [previewOriginPlanetId, setPreviewOriginPlanetId] = useState<string | null>(null);
  const [previewDestination, setPreviewDestination] = useState<FlightDestination | null>(null);
  const [previewTargetRelation, setPreviewTargetRelation] = useState<TargetRelation | undefined>(undefined);
  const [editingPreviewTarget, setEditingPreviewTarget] = useState(false);
  const [previewTargetDraft, setPreviewTargetDraft] = useState<FlightCoordinateDraft>({ galaxy: '', system: '', position: '' });
  const [previewTargetError, setPreviewTargetError] = useState<string | null>(null);
  const [transportCargoDraft, setTransportCargoDraft] = useState<TransportCargo>(emptyTransportCargo);
  const [pendingRecall, setPendingRecall] = useState<FlightRecord | null>(null);
  const [clockNow, setClockNow] = useState(() => Date.now());
  const [fleetSnapshot, setFleetSnapshot] = useState<FleetSnapshot>(() => readApplicationFleetSnapshot({}, planetId));
  const [fleetBudget, setFleetBudget] = useState<FleetBuildBudget>(initialFleetBudget);
  const [pendingSatelliteDismantle, setPendingSatelliteDismantle] = useState<number | null>(null);
  const [simulatorHandoff, setSimulatorHandoff] = useState<SimulatorScenario | null>(() => consumeSimulatorHandoff());
  const [spyOperationsOpen, setSpyOperationsOpen] = useState(false);
  const [selectedSpyMissionIds, setSelectedSpyMissionIds] = useState<Set<string>>(() => new Set());
  const satelliteConfirmYesRef = useRef<HTMLButtonElement>(null);
  const satelliteConfirmNoRef = useRef<HTMLButtonElement>(null);
  const factionId = fleetSnapshot.factionId;
  const factionName = getCombatFactionName(factionId);
  const shipDefinitions = useMemo(() => getFactionShipCatalog(factionId), [factionId]);
  const satelliteDefinition = useMemo(
    () => shipDefinitions.find((ship) => ship.id === SOLAR_SATELLITE_ID) ?? null,
    [shipDefinitions],
  );
  const colonizerDefinition = useMemo(
    () => shipDefinitions.find((ship) => ship.id === 'colonizer') ?? null,
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
    : missionId === 'espionage'
      ? ownedShipDefinitions.filter((ship) => ship.id === 'spy-probe')
      : missionId === 'attack'
        ? ownedShipDefinitions.filter((ship) => isAttackCombatShip(ship.id, factionId))
        : missionId === 'recycle'
          ? ownedShipDefinitions.filter((ship) => ship.id === 'recycler')
      : ownedShipDefinitions;
  const commanderAvailability = useMemo(() => {
    if (missionId !== 'attack' && missionId !== 'deployment') return {} as Partial<Record<CommanderId, number>>;
    const runtimeState = createPersistenceFacade({ mode: ACTIVE_RUNTIME_MODE }).read();
    return missionId === 'attack'
      ? getAttackCommanderSelection(runtimeState, planetId)
      : getAvailableFleetForPlanet(runtimeState, planetId).commanders;
  }, [flightRecords, fleetSnapshot.fleet, missionId, planetId]);
  const selectedShipCount = useMemo(
    () => visibleShipDefinitions.reduce((total, ship) => total + (selectedQuantities[ship.id] ?? 0), 0),
    [selectedQuantities, visibleShipDefinitions],
  );
  const selectedPopulation = useMemo(
    () => visibleShipDefinitions.reduce((total, ship) => total + (selectedQuantities[ship.id] ?? 0) * ship.population, 0)
      + COMMANDER_COMBAT_CATALOG.reduce((total, commander) => total + (selectedCommanders[commander.id] ?? 0) * commander.population, 0),
    [selectedCommanders, selectedQuantities, visibleShipDefinitions],
  );
  const selectedCommanderCount = useMemo(
    () => Object.values(selectedCommanders).reduce((total, quantity) => total + (quantity ?? 0), 0),
    [selectedCommanders],
  );
  const hasLaunchableComposition = selectedShipCount > 0
    || (missionId === 'deployment' && selectedCommanderCount > 0);
  const selectedMission = missions.find((mission) => mission.id === missionId) ?? missions[0];
  const describedMission = missions.find((mission) => mission.id === hoveredMissionId) ?? selectedMission;
  const activeFlightRecords = useMemo(
    () => flightRecords
      .filter((flight) => flight.missionId !== 'espionage' && (flight.phase === 'outbound' || flight.phase === 'returning' || flight.phase === 'arrived'))
      .sort((left, right) => {
        if (left.missionId === 'attack' && right.missionId === 'attack') {
          const arrivalDelta = left.arrivalAt - right.arrivalAt;
          if (arrivalDelta !== 0) return arrivalDelta;
          return left.id.localeCompare(right.id);
        }
        if (left.missionId === 'attack') return -1;
        if (right.missionId === 'attack') return 1;
        return left.arrivalAt - right.arrivalAt || left.id.localeCompare(right.id);
      }),
    [flightRecords],
  );
  const attackOrderByFlightId = useMemo(() => {
    let order = 0;
    return new Map(activeFlightRecords.filter((flight) => flight.missionId === 'attack').map((flight) => [flight.id, ++order]));
  }, [activeFlightRecords]);
  const spyRows = useMemo(() => espionageState.missions
    .filter((mission) => mission.status === 'transit' || mission.status === 'orbiting' || mission.status === 'returning')
    .map((mission) => ({ mission, flight: flightRecords.find((flight) => flight.id === mission.flightId) }))
    .filter((row): row is { mission: SpyMission; flight: FlightRecord } => Boolean(row.flight)), [espionageState.missions, flightRecords]);

  const getActiveTransportState = (flight: FlightRecord) => {
    if (flight.missionId !== 'transport') return { overflowWarning: false, targetUnavailable: false };
    const runtimeState = createPersistenceFacade({ mode: ACTIVE_RUNTIME_MODE }).read();
    const target = resolveTransportTarget(runtimeState, flight.destination);
    if (!target.acceptsTransport || !target.runtime) return { overflowWarning: false, targetUnavailable: true };
    const resources = target.runtime.resources ?? getPlanetResources(runtimeState, target.planetId);
    return {
      targetUnavailable: false,
      overflowWarning: getOverflowWarning(flight.cargo, resources, target.runtime.recycling.availableDebris, getStorageCapacities(target.runtime.buildings)),
    };
  };

  const resetFlightWorkspace = () => {
    setMissionId('transport');
    setHoveredMissionId(null);
    setSelectedQuantities({});
    setSelectedCommanders({});
    setAttackRounds(8);
    setPreviewOpen(false);
    setPreviewResult(null);
    setPreviewOriginPlanetId(null);
    setPreviewDestination(null);
    setPreviewTargetRelation(undefined);
    setEditingPreviewTarget(false);
    setPreviewTargetDraft({ galaxy: '', system: '', position: '' });
    setPreviewTargetError(null);
    setTransportCargoDraft(emptyTransportCargo());
    setPendingRecall(null);
    setPendingSatelliteDismantle(null);
    setSimulatorHandoff(null);
    setSpyOperationsOpen(false);
    setSelectedSpyMissionIds(new Set());
  };

  const clearLaunchContext = () => {
    resetFlightWorkspace();
    window.dispatchEvent(new Event(FLIGHT_LAUNCH_CONTEXT_CLEAR_EVENT));
  };

  const closeFlightPreview = () => {
    setPreviewOpen(false);
    setPreviewResult(null);
    setPreviewTargetError(null);
  };

  useEffect(() => {
    const timer = window.setInterval(() => setClockNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const onSimulatorHandoff = () => {
      const scenario = consumeSimulatorHandoff();
      if (!scenario) return;
      setSimulatorHandoff(scenario);
      setFleetSection('simulator');
      setConstructionView(null);
    };
    window.addEventListener(SIMULATOR_HANDOFF_REQUEST_EVENT, onSimulatorHandoff);
    return () => window.removeEventListener(SIMULATOR_HANDOFF_REQUEST_EVENT, onSimulatorHandoff);
  }, [setFleetSection]);

  useEffect(() => {
    if (!launchContext) {
      resetFlightWorkspace();
      return;
    }
    setMissionId(launchContext.missionId);
    const runtimeState = createPersistenceFacade({ mode: ACTIVE_RUNTIME_MODE }).read();
    setSelectedCommanders(launchContext.missionId === 'attack'
      ? getAttackCommanderSelection(runtimeState, planetId)
      : {});
    setAttackRounds(8);
    setSelectedQuantities(launchContext.missionId === 'colonize'
      ? { colonizer: 1 }
      : launchContext.missionId === 'espionage' ? { 'spy-probe': 1 } : {});
    setPreviewOriginPlanetId(null);
    setPreviewDestination(null);
    setPreviewTargetRelation(launchContext.targetRelation);
    setEditingPreviewTarget(false);
    setPreviewTargetDraft(launchContext.destination ? flightCoordinateDraft(launchContext.destination.coordinate) : { galaxy: '', system: '', position: '' });
    setPreviewTargetError(null);
    setStatus(launchContext.destination ? `Цель: ${flightCoordinateLabel(launchContext.destination.coordinate)}.` : 'Выберите корабли и координаты цели.');
  }, [launchContext, planetId]);

  useEffect(() => {
    resetFlightWorkspace();
    setFleetSnapshot(readApplicationFleetSnapshot({}, planetId));
    setFleetBudget(readFleetBuildBudget({}, planetId));
  }, [planetId]);

  useEffect(() => {
    const onCommandResult = (event: Event) => {
      const result = (event as CustomEvent<FlightCommandResult>).detail;
      if (result.ok) {
        resetFlightWorkspace();
        setStatus(result.notice);
      } else {
        setStatus(result.error.message);
        setPreviewResult(result);
        setPreviewTargetError(targetErrorFromFlightResult(result) ?? result.error.message);
      }
    };
    window.addEventListener(FLIGHT_COMMAND_RESULT_EVENT, onCommandResult);
    const onSpyReportResult = (event: Event) => {
      const result = (event as CustomEvent<{ ok: boolean; notice?: string; error?: { message: string } }>).detail;
      setStatus(result.ok ? (result.notice ?? 'Шпионский отчёт получен.') : (result.error?.message ?? 'Запрос отчёта отклонён.'));
    };
    window.addEventListener(SPY_REPORT_RESULT_EVENT, onSpyReportResult);
    return () => {
      window.removeEventListener(FLIGHT_COMMAND_RESULT_EVENT, onCommandResult);
      window.removeEventListener(SPY_REPORT_RESULT_EVENT, onSpyReportResult);
    };
  }, []);

  const openFleetRoot = () => {
    clearLaunchContext();
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
      setFleetSnapshot(readApplicationFleetSnapshot({}, planetId));
      setFleetBudget(readFleetBuildBudget({}, planetId));
    };
    window.addEventListener(RUNTIME_STATE_CHANGED_EVENT, refresh);
    window.addEventListener('storage', refresh);
    return () => {
      window.removeEventListener(RUNTIME_STATE_CHANGED_EVENT, refresh);
      window.removeEventListener('storage', refresh);
    };
  }, [planetId]);

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

  const createFlightCommand = (requestId: string, draft?: { originPlanetId?: string; destination?: FlightDestination; targetRelation?: TargetRelation | null }): DispatchFlightCommand | null => {
    const runtimeState = createPersistenceFacade({ mode: ACTIVE_RUNTIME_MODE }).read();
    const destination = draft?.destination ?? previewDestination ?? launchContext?.destination;
    return {
      requestId,
      missionId,
      originPlanetId: draft?.originPlanetId ?? previewOriginPlanetId ?? runtimeState.currentPlanetId,
      destination,
      targetRelation: draft?.targetRelation === null ? undefined : draft?.targetRelation ?? previewTargetRelation,
      targetKind: missionId === 'colonize'
        ? launchContext?.targetKind ?? 'empty'
        : missionId === 'recycle' ? undefined : launchContext?.targetKind,
      targetPlanetName: launchContext?.targetPlanetName,
      targetOwnerId: launchContext?.targetOwnerId,
      targetOwnerName: launchContext?.targetOwnerName,
      targetRaceId: launchContext?.targetRaceId,
      targetAlliance: launchContext?.targetAlliance,
      selectedShips: missionId === 'colonize'
        ? { colonizer: 1 }
        : missionId === 'espionage'
          ? { 'spy-probe': 1 }
          : missionId === 'recycle'
            ? { recycler: selectedQuantities.recycler ?? 0 }
            : selectedQuantities,
      selectedCommanders: missionId === 'attack' || missionId === 'deployment' ? selectedCommanders : undefined,
      maxRounds: missionId === 'attack' ? attackRounds : undefined,
      cargo: missionId === 'transport' ? transportCargoDraft : undefined,
      operationId: launchContext?.operationId,
      departedAt: Date.now(),
    };
  };

  const openFlightPreview = () => {
    const runtimeState = createPersistenceFacade({ mode: ACTIVE_RUNTIME_MODE }).read();
    const originPlanetId = runtimeState.currentPlanetId;
    const destination = previewDestination ?? launchContext?.destination;
    const targetRelation = previewTargetRelation ?? launchContext?.targetRelation;
    const command = destination ? createFlightCommand(`preview-${Date.now()}`, { originPlanetId, destination, targetRelation }) : null;
    setPreviewOriginPlanetId(originPlanetId);
    setPreviewDestination(destination ?? null);
    setPreviewTargetRelation(targetRelation);
    setEditingPreviewTarget(destination ? (previewDestination ? editingPreviewTarget : false) : true);
    setPreviewTargetDraft(destination && !previewDestination ? flightCoordinateDraft(destination.coordinate) : previewTargetDraft);
    if (command) {
      const result = previewFlight(runtimeState, command, { mode: ACTIVE_RUNTIME_MODE, testTimeScale: resolveTestTimeScale() });
      setPreviewTargetError(targetErrorFromFlightResult(result));
      setPreviewResult(result);
    } else {
      setPreviewTargetError(null);
      setPreviewResult(null);
    }
    setPreviewOpen(true);
  };

  const refreshFlightPreview = (originPlanetId: string, destination: FlightDestination, targetRelation?: TargetRelation | null) => {
    const command = createFlightCommand(`preview-${Date.now()}`, { originPlanetId, destination, targetRelation });
    if (!command) return;
    const result = previewFlight(createPersistenceFacade({ mode: ACTIVE_RUNTIME_MODE }).read(), command, {
      mode: ACTIVE_RUNTIME_MODE,
      testTimeScale: resolveTestTimeScale(),
    });
    setPreviewTargetError(targetErrorFromFlightResult(result));
    setPreviewResult(result);
  };

  const changePreviewTargetField = (field: keyof FlightCoordinateDraft, value: string) => {
    const nextDraft = { ...previewTargetDraft, [field]: value };
    setPreviewTargetDraft(nextDraft);
    setPreviewTargetRelation(undefined);
    const draftError = coordinateDraftError(nextDraft);
    if (draftError) {
      setPreviewDestination(null);
      setPreviewResult(null);
      setPreviewTargetError(draftError);
      return;
    }
    setPreviewDestination({ kind: 'coordinate', coordinate: coordinateFromDraft(nextDraft) });
    setPreviewResult(null);
    setPreviewTargetError(null);
  };

  const selectTransportTarget = (targetId: string) => {
    const runtimeState = createPersistenceFacade({ mode: ACTIVE_RUNTIME_MODE }).read();
    const target = transportTargetOptions.find((option) => option.id === targetId);
    if (!target) {
      setPreviewDestination(null);
      setPreviewTargetRelation(undefined);
      setPreviewTargetDraft({ galaxy: '', system: '', position: '' });
      setPreviewTargetError(null);
      setPreviewResult(null);
      setEditingPreviewTarget(true);
      return;
    }
    if (missionId === 'deployment' && getPlanetOverpopulationSummary(runtimeState, target.id).blocked) {
      setPreviewTargetError('Планета заблокирована из-за перенаселения.');
      return;
    }
    const destination: FlightDestination = { kind: 'planet', planetId: target.id, coordinate: target.coordinate };
    setPreviewDestination(destination);
    setPreviewTargetRelation(target.relation);
    setPreviewTargetDraft(flightCoordinateDraft(destination.coordinate));
    setPreviewTargetError(null);
    setEditingPreviewTarget(false);
    refreshFlightPreview(previewOriginPlanetId ?? runtimeState.currentPlanetId, destination, target.relation);
  };

  const changeTransportCargo = (key: TransportCargoKey, rawValue: string) => {
    const requested = Number(rawValue);
    const amount = Number.isFinite(requested) && requested > 0 ? Math.floor(requested) : 0;
    const runtimeState = createPersistenceFacade({ mode: ACTIVE_RUNTIME_MODE }).read();
    const originPlanetId = previewOriginPlanetId ?? runtimeState.currentPlanetId;
    setTransportCargoDraft((current) => getTransportCargoSummary(runtimeState, originPlanetId, selectedQuantities, { ...current, [key]: amount }, previewDestination ?? undefined).cargo);
  };

  const confirmFlightDispatch = () => {
    const requestId = globalThis.crypto?.randomUUID?.() ?? `flight-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    if (missionId === 'deployment' && previewDestination?.kind === 'planet') {
      const runtimeState = createPersistenceFacade({ mode: ACTIVE_RUNTIME_MODE }).read();
      if (getPlanetOverpopulationSummary(runtimeState, previewDestination.planetId).blocked) {
        setPreviewTargetError('Планета заблокирована из-за перенаселения.');
        return;
      }
    }
    const localError = coordinateDraftError(previewTargetDraft);
    if ((missionId === 'transport' || missionId === 'colonize' || missionId === 'attack') && localError) {
      setPreviewTargetError(localError);
      setEditingPreviewTarget(true);
      return;
    }
    const command = createFlightCommand(requestId, previewDestination || missionId === 'deployment' ? undefined : { destination: { kind: 'coordinate', coordinate: coordinateFromDraft(previewTargetDraft) } });
    if (!command) return;
    window.dispatchEvent(new CustomEvent(FLIGHT_DISPATCH_REQUEST_EVENT, { detail: command }));
  };

  const chooseSection = (section: FleetSectionId) => {
    clearLaunchContext();
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
    if (shipId === SOLAR_SATELLITE_ID) return;
    if (missionId === 'colonize' && shipId !== 'colonizer') return;
    const available = fleetSnapshot.fleet.ships[shipId] ?? 0;
    const next = missionId === 'colonize' || missionId === 'espionage'
      ? Math.min(1, available)
      : Number.isFinite(raw) ? Math.max(0, Math.min(available, Math.floor(raw))) : 0;
    setSelectedQuantities((current) => ({ ...current, [shipId]: next }));
  };

  const chooseMission = (nextMissionId: MissionId) => {
    setMissionId(nextMissionId);
    if (nextMissionId === 'recycle') {
      setPreviewResult(null);
      setPreviewTargetError(null);
    }
    if (nextMissionId === 'attack') {
      const runtimeState = createPersistenceFacade({ mode: ACTIVE_RUNTIME_MODE }).read();
      setSelectedCommanders(getAttackCommanderSelection(runtimeState, runtimeState.currentPlanetId));
      setAttackRounds(8);
    } else {
      setSelectedCommanders({});
    }
  };

  const setAllShipQuantities = (maximum: boolean) => {
    setSelectedQuantities(Object.fromEntries(
      visibleShipDefinitions.map((ship) => [ship.id, maximum ? (missionId === 'colonize' || missionId === 'espionage' ? 1 : fleetSnapshot.fleet.ships[ship.id] ?? 0) : 0]),
    ) as Partial<Record<ShipId, number>>);
  };

  const recallAllSpies = () => {
    const recallable = spyRows.filter(({ mission }) => mission.status === 'transit' || mission.status === 'orbiting');
    if (!recallable.length) {
      setStatus('Сейчас активных шпионских флотов нет.');
      return;
    }
    const now = Date.now();
    recallable.forEach(({ flight }) => window.dispatchEvent(new CustomEvent(FLIGHT_RECALL_REQUEST_EVENT, { detail: { flightId: flight.id, now } })));
  };

  const recallSelectedSpies = () => {
    const recallable = spyRows.filter(({ mission }) => selectedSpyMissionIds.has(mission.id) && (mission.status === 'transit' || mission.status === 'orbiting'));
    if (!recallable.length) {
      setStatus('Выберите возвращаемые зонды.');
      return;
    }
    const now = Date.now();
    recallable.forEach(({ flight }) => window.dispatchEvent(new CustomEvent(FLIGHT_RECALL_REQUEST_EVENT, { detail: { flightId: flight.id, now } })));
  };

  const requestReadySpyReports = () => {
    const activeMissionIds = spyRows
      .filter(({ mission }) => mission.status === 'orbiting')
      .map(({ mission }) => mission.id);
    if (!activeMissionIds.length) {
      setStatus('Активных зондов на орбите нет.');
      return;
    }
    window.dispatchEvent(new CustomEvent(SPY_REPORT_ALL_REQUEST_EVENT, { detail: { missionIds: activeMissionIds, now: Date.now() } }));
  };

  const mainClassName = [
    'fleet-main-v1',
    constructionView ? 'fleet-main-v1--shipyard' : '',
    selectedSection === 'battles' ? 'fleet-main-v1--battles' : '',
    selectedSection === 'simulator' ? 'fleet-main-v1--subpage' : '',
  ].filter(Boolean).join(' ');
  const productionQueueKind = queueKindForConstructionView(constructionView);
  const previewRuntimeState = previewOpen ? createPersistenceFacade({ mode: ACTIVE_RUNTIME_MODE }).read() : null;
  const previewSourceId = previewOriginPlanetId ?? previewRuntimeState?.currentPlanetId ?? null;
  const previewSource = previewSourceId ? previewRuntimeState?.planets[previewSourceId] : null;
  const previewCoordinate = previewDestination?.coordinate ?? launchContext?.destination?.coordinate ?? null;
  const previewFlightRecord = previewResult?.ok ? previewResult.flight : null;
  const transportSummary = previewRuntimeState && previewSourceId
    ? getTransportCargoSummary(previewRuntimeState, previewSourceId, selectedQuantities, transportCargoDraft, previewDestination ?? undefined)
    : null;
  const transportSourceResources = previewRuntimeState && previewSourceId
    ? getPlanetResources(previewRuntimeState, previewSourceId)
    : { metal: 0, minerals: 0, gas: 0 };
  const transportSourceDebris = previewSource?.recycling.availableDebris ?? 0;
  const transportTargetOptions: TransportTargetOption[] = previewRuntimeState
    ? Object.entries(previewRuntimeState.planets)
      .filter(([id]) => id !== previewSourceId)
      .map(([id, planet]) => ({
        id,
        name: planet.name,
        relation: 'self' as const,
        ...(missionId === 'deployment' ? (() => {
          const summary = getPlanetOverpopulationSummary(previewRuntimeState, id);
          return {
            blocked: summary.blocked,
            actualPopulation: summary.actualPopulation,
            capacity: summary.capacity,
            unlockAt: summary.episode
              ? summary.episode.episodeStartedAt + OVERPOPULATION_WINDOW_MS
              : undefined,
            noEligibleBurnUnits: summary.episode?.lastResolutionReason === 'no-eligible-units',
          };
        })() : {}),
        coordinate: {
          galaxy: planet.universeGalaxy ?? 1,
          system: planet.universeSystem ?? 1,
          position: planet.universePosition ?? 1,
        },
      }))
    : [];
  const previewTargetDestination = previewDestination ?? launchContext?.destination;
  const previewTargetPlanet = previewRuntimeState && previewTargetDestination?.kind === 'planet'
    ? previewRuntimeState.planets[previewTargetDestination.planetId] ?? previewRuntimeState.alliedPlanets?.[previewTargetDestination.planetId]
    : null;
  const isReadOnlyAllyTarget = missionId === 'transport'
    && previewTargetRelation === 'ally'
    && previewTargetDestination?.kind === 'planet';
  const isReadOnlySpyTarget = missionId === 'espionage' && previewTargetDestination?.kind === 'planet';
  const isReadOnlyDeploymentTarget = missionId === 'deployment' && previewTargetDestination?.kind === 'planet';
  const isReadOnlyTarget = isReadOnlyAllyTarget || isReadOnlySpyTarget || isReadOnlyDeploymentTarget;
  const selectedTransportTargetId = previewDestination?.kind === 'planet' && previewTargetRelation === 'self'
    ? previewDestination.planetId
    : '';
  const targetIsLocallyValid = coordinateDraftError(previewTargetDraft) === null;
  const previewErrorCode = previewResult && !previewResult.ok ? previewResult.error.code : null;
  const targetCheckIsDeferred = previewErrorCode === 'target-not-available' || previewErrorCode === 'target-is-origin';
  const canDispatchPreview = missionId === 'espionage'
    ? targetIsLocallyValid && Boolean(previewResult?.ok) && selectedQuantities['spy-probe'] === 1
    : missionId === 'recycle'
      ? targetIsLocallyValid && previewResult?.ok === true && previewResult.flight.missionId === 'recycle' && (selectedQuantities.recycler ?? 0) > 0
    : missionId === 'attack'
      ? targetIsLocallyValid && (!previewResult || previewResult.ok) && selectedShipCount > 0 && previewTargetRelation !== 'ally' && previewTargetRelation !== 'self'
    : missionId === 'transport'
    ? targetIsLocallyValid && (!previewResult || previewResult.ok || targetCheckIsDeferred)
    : missionId === 'deployment'
      ? targetIsLocallyValid && Boolean(previewResult?.ok) && hasLaunchableComposition && previewTargetDestination?.kind === 'planet' && previewTargetRelation === 'self' && !transportTargetOptions.find((target) => target.id === previewTargetDestination.planetId)?.blocked
    : missionId !== 'colonize'
      || (targetIsLocallyValid && (!previewResult || previewResult.ok));
  const previewTargetLabel = previewTargetError
    ? `[${previewTargetDraft.galaxy || '—'}:${previewTargetDraft.system || '—'}:${previewTargetDraft.position || '—'}]`
    : previewCoordinate
      ? flightCoordinateLabel(previewCoordinate)
      : `[${previewTargetDraft.galaxy || '—'}:${previewTargetDraft.system || '—'}:${previewTargetDraft.position || '—'}]`;

  return (
    <div className="fleet-workspace-v1" data-qa-flight-launch-context={launchContext?.destination ? flightCoordinateLabel(launchContext.destination.coordinate) : undefined} data-qa-target-relation={previewTargetRelation ?? (!previewOpen ? launchContext?.targetRelation : undefined)}>
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
          <ShipyardView planetId={planetId} planetName={planetName} coords={coords} budget={fleetBudget} />
        ) : constructionView === 'defense' || constructionView === 'commander' ? (
          <ConstructionCatalogView planetId={planetId} mode={constructionView} planetName={planetName} coords={coords} budget={fleetBudget} />
        ) : selectedSection === 'combat-priority' ? (
          <FleetCombatPriorityView planetName={planetName} coords={coords} entityLevels={entityLevels} onBack={openFleetRoot} />
        ) : selectedSection === 'battles' ? (
          <BattleReportsView planetName={planetName} coords={coords} onBack={openFleetRoot} />
        ) : selectedSection === 'simulator' ? (
          <SimulatorView planetName={planetName} coords={coords} onBack={openFleetRoot} initialScenario={simulatorHandoff} />
        ) : (
          <>
            <section className="fleet-panel-v1 fleet-flights-v1">
              <header className="fleet-panel-header-v1">
                <div><small>ОПЕРАЦИОННЫЙ ЦЕНТР</small><h2>ФЛОТЫ</h2></div>
                <span>{planetName} {coords}</span>
              </header>

              <div className="fleet-flight-table-v1">
                <div className="fleet-flight-row-v1 fleet-flight-head-v1">
                  <span>ОТКУДА</span><span>ЦЕЛЬ</span><span>ПРИБЫТИЕ</span><span>СТАТУС</span><span>ВОЗВРАТ</span><span>МИССИЯ · ПОРЯДОК</span><span>ДЕЙСТВИЯ</span>
                </div>
                {activeFlightRecords.length === 0 ? <div className="fleet-flight-empty-v1" data-qa-flight-empty>
                  <strong>Активных полётов нет</strong>
                  <span>Флоты, находящиеся в пути, будут отображаться здесь.</span>
                </div> : activeFlightRecords.map((flight) => {
                  const liveTransportState = getActiveTransportState(flight);
                  const targetUnavailable = flight.completionReason === 'target-unavailable' || liveTransportState.targetUnavailable;
                  const statusLabel = targetUnavailable
                    ? 'ЦЕЛЬ НЕДОСТУПНА'
                    : flight.phase === 'outbound'
                      ? 'В ПУТИ'
                      : flight.phase === 'returning'
                        ? 'ВОЗВРАЩАЕТСЯ'
                        : 'ПРИБЫЛ';
                  const attackOrder = attackOrderByFlightId.get(flight.id);
                  return <div className="fleet-flight-row-v1" key={flight.id} data-qa-flight-row={flight.id} data-qa-flight-phase={flight.phase}>
                  <span data-qa-flight-origin>{flightCoordinateLabel(flight.originCoordinate)}</span>
                  <span data-qa-flight-target><strong>{flight.targetPlanetName ?? flightCoordinateLabel(flight.destinationCoordinate)}</strong>{flight.targetOwnerName ? <small>{flight.targetOwnerName}</small> : null}{flight.targetRelation === 'ally' ? '· СОЮЗНИК' : flight.targetRelation === 'self' ? '· СВОЯ' : ''}{targetUnavailable ? <b data-qa-flight-target-unavailable> · ЦЕЛЬ НЕДОСТУПНА</b> : null}</span>
                  <span data-qa-flight-arrival>{flight.phase === 'outbound' ? flightCountdown(flight.arrivalAt, clockNow) : '—'}</span>
                  <span data-qa-flight-status>{statusLabel}</span>
                  <span data-qa-flight-return>{flight.phase === 'returning' ? flightCountdown(flight.returnAt, clockNow) : '—'}</span>
                  <span><img className="fleet-flight-mission-icon" src={missions.find((mission) => mission.id === flight.missionId)?.icon} alt="" />{flightMissionLabel(flight.missionId)}{attackOrder ? <small data-qa-flight-attack-order> · АТАКА #{attackOrder}</small> : null}{liveTransportState.overflowWarning ? <b className="fleet-flight-overflow-warning" aria-label="Часть груза может сгореть: склады цели заполнены" data-qa-flight-overflow-warning>!</b> : null}</span>
                  <span><button type="button" data-qa-flight-recall={flight.id} disabled={flight.phase !== 'outbound'} onClick={() => setPendingRecall(flight)}>ОТОЗВАТЬ</button></span>
                </div>;
                })}
              </div>

              <div className="fleet-flight-actions-v1">
                <button type="button" onClick={() => setSpyOperationsOpen(true)} aria-haspopup="dialog">ШПИОНСКИЕ ОТЧЁТЫ</button>
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
                  <select id="fleet-mission" value={missionId} onChange={(event) => chooseMission(event.target.value as MissionId)}>
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
                      onClick={() => chooseMission(mission.id)}
                    >
                      <MissionIcon mission={mission} />
                      <span>{mission.label}</span>
                    </button>
                  ))}
                </div>
                <p className="fleet-mission-description-v1"><strong>{describedMission.label}.</strong> {describedMission.description}</p>
              </div>

              {missionId === 'attack' || missionId === 'deployment' ? <section className="fleet-attack-prep-v1" data-qa-attack-prep={missionId === 'attack' ? true : undefined} data-qa-deployment-commanders={missionId === 'deployment' ? true : undefined}>
                {missionId === 'attack' ? <div className="fleet-attack-rounds-v1">
                  <div><small>ЛИМИТ РАУНДОВ</small><span>Разрешены только боевые профили 5 / 8 / 12.</span></div>
                  <select value={attackRounds} onChange={(event) => setAttackRounds(Number(event.target.value) as SimulatorMaxRounds)} data-qa-attack-rounds aria-label="Лимит раундов атаки">
                    {[5, 8, 12].map((rounds) => <option key={rounds} value={rounds}>{rounds} раундов</option>)}
                  </select>
                </div> : null}
                <div className="fleet-attack-commanders-v1">
                  <div className="fleet-attack-commanders-head"><div><small>КОМАНДИРЫ</small><span>{missionId === 'deployment' ? 'Командиры сохраняют уровень и способность при переводе.' : 'Свободные командиры резервируются вместе с флотом.'}</span></div><b>{selectedCommanderCount} выбрано</b></div>
                  {Object.keys(commanderAvailability).length ? <div className="fleet-attack-commanders-list">
                    {COMMANDER_IDS.filter((commanderId) => (commanderAvailability[commanderId] ?? 0) > 0).map((commanderId) => {
                      const commander = COMMANDER_ABILITIES[commanderId];
                      const checked = (selectedCommanders[commanderId] ?? 0) > 0;
                      return <label key={commanderId} className={checked ? 'is-selected' : ''}>
                        <input type="checkbox" checked={checked} onChange={(event) => setSelectedCommanders((current) => {
                          const next = { ...current };
                          if (event.target.checked) next[commanderId] = 1;
                          else delete next[commanderId];
                          return next;
                        })} />
                        <span><strong>{commander.commanderName}</strong><small>в наличии: {commanderAvailability[commanderId] ?? 0}</small></span>
                      </label>;
                    })}
                  </div> : <p className="fleet-attack-commanders-empty">Свободных командиров нет.</p>}
                </div>
              </section> : null}

              <footer className="fleet-compose-footer-v1">
                <span>{status}</span>
                <button type="button" data-qa-flight-preview-open disabled={!hasLaunchableComposition} onClick={openFlightPreview}>ПРОДОЛЖИТЬ</button>
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
      {previewOpen ? createPortal(
        <div className="resource-building-action-confirm-backdrop" data-qa-flight-preview-backdrop onMouseDown={closeFlightPreview}>
          <section className="resource-building-action-confirm flight-preview-modal flight-timeline-modal" role="dialog" aria-modal="true" aria-labelledby="flight-preview-title" onMouseDown={(event) => event.stopPropagation()}>
            <header className="flight-timeline-head">
              <div>
                <small>FLIGHT PLAN / ОПЕРАТИВНЫЙ МАРШРУТ</small>
                <h3 id="flight-preview-title">ПЛАН ПЕРЕЛЁТА</h3>
                <p>Последовательность подготовки: источник → цель → состав флота → подтверждение.</p>
              </div>
              <button type="button" className="flight-timeline-close" data-asterion-close aria-label="Закрыть план перелёта" onClick={closeFlightPreview}>×</button>
              </header>
            <div className="flight-timeline-body">
              <ol className="flight-timeline-steps" aria-label="Шаги подготовки рейса">
                <li className="flight-timeline-step is-complete" data-qa-flight-source-step>
                  <span aria-hidden="true">01</span>
                  <div>
                    <small>ИСТОЧНИК</small>
                    <strong>{previewSource?.name ?? planetName}</strong>
                    <em>{previewSource ? `[${previewSource.universeGalaxy}:${previewSource.universeSystem}:${previewSource.universePosition}]` : coords} · выбрано флотом</em>
                  </div>
                </li>
                <li className="flight-timeline-step-connector" aria-hidden="true"><span>↓</span></li>
                <li className="flight-timeline-step is-complete" data-qa-flight-target-step>
                  <span aria-hidden="true">02</span>
                  <div>
                    <small>ЦЕЛЬ</small>
                    {missionId === 'transport' && isReadOnlyAllyTarget ? <div className="flight-timeline-readonly-target" data-qa-transport-target-readonly>
                      <span>СОЮЗНАЯ ПЛАНЕТА</span>
                      <strong>{previewTargetPlanet?.name ?? 'Союзная планета'} {previewTargetDestination?.kind === 'planet' ? flightCoordinateLabel(previewTargetDestination.coordinate) : ''}</strong>
                    </div> : missionId === 'transport' || missionId === 'deployment' ? <label className="flight-timeline-own-target" data-qa-transport-target-select={missionId === 'transport' ? true : undefined} data-qa-deployment-target-select={missionId === 'deployment' ? true : undefined}><span>СВОЯ ПЛАНЕТА</span><select value={selectedTransportTargetId} onChange={(event) => selectTransportTarget(event.target.value)}><option value="">Выберите планету</option>{transportTargetOptions.map((target) => {
                      const locked = missionId === 'deployment' && target.blocked;
                      const countdown = target.noEligibleBurnUnits
                        ? 'нет обычных кораблей для сгорания'
                        : target.unlockAt === undefined
                          ? 'ожидание начала таймера'
                          : `до разблокировки ${flightCountdown(target.unlockAt, clockNow)}`;
                      return <option key={target.id} value={target.id} disabled={locked} aria-label={locked ? `${target.name}, заблокирована: население ${flightNumberLabel(target.actualPopulation ?? 0)}, вместимость ${flightNumberLabel(target.capacity ?? 0)}, ${countdown}` : undefined} data-qa-deployment-target-locked={locked || undefined}>{locked
                        ? `🔒 ${target.name} · население ${flightNumberLabel(target.actualPopulation ?? 0)} / вместимость ${flightNumberLabel(target.capacity ?? 0)} · ${countdown}`
                        : `Своя · ${target.name} [${target.coordinate.galaxy}:${target.coordinate.system}:${target.coordinate.position}]`}</option>;
                    })}</select></label> : null}
                    {missionId !== 'deployment' && !isReadOnlyTarget && editingPreviewTarget ? <div className="flight-timeline-coordinate-inputs" data-qa-flight-target-inputs>
                      <label><span>ГАЛ.</span><input name="flight-preview-target-galaxy" inputMode="numeric" value={previewTargetDraft.galaxy} onInput={(event) => changePreviewTargetField('galaxy', event.currentTarget.value)} onChange={(event) => changePreviewTargetField('galaxy', event.currentTarget.value)} aria-label="Галактика цели" /></label>
                      <label><span>СИСТ.</span><input name="flight-preview-target-system" inputMode="numeric" value={previewTargetDraft.system} onInput={(event) => changePreviewTargetField('system', event.currentTarget.value)} onChange={(event) => changePreviewTargetField('system', event.currentTarget.value)} aria-label="Система цели" /></label>
                      <label><span>ПОЗ.</span><input name="flight-preview-target-position" inputMode="numeric" value={previewTargetDraft.position} onInput={(event) => changePreviewTargetField('position', event.currentTarget.value)} onChange={(event) => changePreviewTargetField('position', event.currentTarget.value)} aria-label="Позиция цели" /></label>
                    </div> : !isReadOnlyTarget && missionId !== 'deployment' ? <strong>{previewTargetLabel}</strong> : isReadOnlySpyTarget ? <strong>{launchContext?.targetPlanetName ?? previewTargetLabel}</strong> : null}
                    <div className={`flight-timeline-target-status ${previewTargetError ? 'is-invalid' : 'is-valid'}`} data-qa-flight-target-status>
                      <span data-qa-target-relation={previewTargetRelation}>{previewTargetError ?? (missionId === 'deployment' && !previewTargetDestination ? 'Выберите свою планету' : missionId === 'recycle' && previewResult && !previewResult.ok ? previewResult.error.message : previewTargetRelation === 'ally' ? 'Союзная планета' : previewTargetRelation === 'self' ? 'Своя планета' : previewResult?.ok ? 'Цель подтверждена' : 'Координаты будут проверены при отправке')}</span>
                      {!isReadOnlyTarget && missionId !== 'deployment' ? <button type="button" className="flight-timeline-edit" onClick={() => setEditingPreviewTarget((value) => !value)}>{editingPreviewTarget ? 'ГОТОВО' : 'ИЗМЕНИТЬ'}</button> : null}
                    </div>
                  </div>
                </li>
                <li className="flight-timeline-step-connector" aria-hidden="true"><span>↓</span></li>
                <li className="flight-timeline-step is-ship-step">
                  <span aria-hidden="true">03</span>
                  <div>
                    <small>СОСТАВ ФЛОТА</small>
                    <div className="flight-timeline-ship-list" data-qa-flight-ships>{visibleShipDefinitions.filter((ship) => (selectedQuantities[ship.id] ?? 0) > 0).map((ship) => {
                      const quantity = selectedQuantities[ship.id] ?? 0;
                      return <article className="flight-timeline-ship-card" key={ship.id}><img src={ship.art} alt="" /><div><strong>{ship.name}</strong><small>Население: {quantity * ship.population}</small></div><b>{quantity}<small>{shipCountLabel(quantity)}</small></b></article>;
                    })}</div>
                  </div>
                </li>
              </ol>
              <section className="flight-timeline-summary" aria-live="polite">
                <div className="flight-timeline-summary-head">
                  <small>ПАРАМЕТРЫ ПЕРЕЛЁТА</small>
                  <span>{missionId === 'transport' ? 'ПРОВЕРКА ЦЕЛИ ПРИ ОТПРАВКЕ' : 'ПРОВЕРКА ЦЕЛИ ПРИ ОТПРАВКЕ'}</span>
                </div>
                {previewResult?.ok ? <>
                  <div className="flight-timeline-metrics" data-qa-flight-preview>
                    <div><small>РАССТОЯНИЕ</small><strong>{flightNumberLabel(previewResult.flight.routeDistance)} ед.</strong></div>
                    <div><small>ЭФФ. СКОРОСТЬ</small><strong>{flightNumberLabel(previewResult.flight.effectiveSpeed)}</strong></div>
                    <div><small>ТУДА</small><strong>{flightDurationLabel(previewResult.flight.oneWayDurationMs)}</strong></div>
                    <div><small>ОБРАТНО</small><strong>{flightDurationLabel(previewResult.flight.oneWayDurationMs)}</strong></div>
                    <div><small>ПОЛНЫЙ ЦИКЛ</small><strong>{flightDurationLabel(previewResult.flight.oneWayDurationMs * 2)}</strong></div>
                    <div><small>ГАЗ</small><strong>{previewResult.flight.gasCost}</strong></div>
                    <div data-qa-flight-metric="population"><small>НАСЕЛЕНИЕ</small><strong>{flightNumberLabel(selectedPopulation)}</strong></div>
                    {missionId === 'transport' && transportSummary ? <div data-qa-flight-metric="cargo-capacity"><small>ГРУЗ</small><strong>{flightNumberLabel(transportSummary.capacity.used)} / {flightNumberLabel(transportSummary.capacity.total)}</strong></div> : null}
                  </div>
                  <section className="flight-timeline-eta" data-qa-flight-eta aria-label="Расписание рейса">
                    <div className="flight-timeline-eta-card is-arrival">
                      <small>ПРИБЫТИЕ</small>
                      <strong>через {flightCountdown(previewResult.flight.arrivalAt, clockNow)}</strong>
                      <span>{flightArrivalLabel(previewResult.flight.arrivalAt)} МСК</span>
                      <em>{missionId === 'recycle' ? 'сбор обломков с орбиты' : 'проверка цели и создание планеты'}</em>
                    </div>
                    <div className="flight-timeline-eta-card is-return">
                      <small>ВОЗВРАТ ПРИ ОТЗЫВЕ</small>
                      <strong>через {flightDurationLabel(previewResult.flight.oneWayDurationMs)} после отзыва</strong>
                      <span>{flightArrivalLabel(clockNow + previewResult.flight.oneWayDurationMs)} МСК</span>
                      <em>оценка, если отозвать рейс сейчас</em>
                    </div>
                  </section>
                  <div className="flight-timeline-notes">
                    <p className="flight-timeline-note-info">Газ списывается только за один путь туда. Обратный участок не требует повторной оплаты.</p>
                    <p className="flight-timeline-note-warning">{missionId === 'attack'
                      ? 'До прибытия атаку можно отозвать без боя и боевого отчёта.'
                      : missionId === 'recycle'
                        ? 'При отзыве до прибытия переработчик вернётся без обломков.'
                        : 'При отзыве колонизатор возвращается, но газ не возвращается.'}</p>
                  </div>
                </> : <p className="flight-timeline-error" data-qa-flight-preview-error>{previewResult && !previewResult.ok ? previewResult.error.message : targetIsLocallyValid ? 'Проверка цели будет выполнена при отправке.' : 'Укажите координаты цели. Проверка доступности выполняется при отправке.'}</p>}
              </section>
              {missionId === 'transport' && transportSummary ? <section className="flight-timeline-cargo" data-qa-flight-cargo data-qa-cargo-capacity={`${transportSummary.capacity.used}/${transportSummary.capacity.total}`} aria-label="Загрузка ресурсов">
                <div className="flight-timeline-cargo-head">
                  <div>
                    <small>ЗАГРУЗКА КОРАБЛЯ</small>
                    <strong>РЕСУРСНЫЙ ГРУЗ</strong>
                  </div>
                  <span>
                    <small>ГРУЗОПОДЪЁМНОСТЬ</small>
                    <span className={`flight-timeline-cargo-capacity-fill is-${capacityFillTone(transportSummary.capacity.used, transportSummary.capacity.total)}`} aria-hidden="true" data-qa-cargo-capacity-fill>
                      <i style={{ '--fill': `${capacityFillPct(transportSummary.capacity.used, transportSummary.capacity.total)}%` } as CSSProperties} />
                    </span>
                    <em>СВОБОДНО: {flightNumberLabel(transportSummary.capacity.free)}</em>
                  </span>
                </div>
                <div className="flight-timeline-cargo-grid">
                  {flightCargoResources.map((resource) => (
                    <label key={resource.kind} className="flight-timeline-cargo-field">
                      <span className="flight-timeline-cargo-resource">
                        <ResourceIcon kind={resource.kind} label={resource.label} />
                        <b>{resource.label}</b>
                      </span>
                      <span className="flight-timeline-cargo-input">
                        <input type="number" min="0" step="1" value={transportSummary.cargo[resource.kind]} max={getCargoFieldMaximum(resource.kind, transportSummary.cargo, transportSourceResources, transportSourceDebris, transportSummary.capacity.total)} aria-label={resource.label} data-qa-cargo={resource.kind} onChange={(event) => changeTransportCargo(resource.kind, event.target.value)} />
                        <em>МАКС. {flightNumberLabel(getCargoFieldMaximum(resource.kind, transportSummary.cargo, transportSourceResources, transportSourceDebris, transportSummary.capacity.total))}</em>
                      </span>
                    </label>
                  ))}
                </div>
                {transportSummary.overflowWarning ? <p role="alert" data-qa-transport-overflow-warning>Часть груза может сгореть: склады цели заполнены.</p> : <p>Загрузка ограничена запасом источника и свободной грузоподъёмностью.</p>}
              </section> : null}
            </div>
            <div className="flight-timeline-meta">{previewResult?.ok && previewFlightRecord ? <>РАСЧЁТ · PERSISTED FLIGHT RUNTIME · ПРИБЫТИЕ: {flightArrivalLabel(previewFlightRecord.arrivalAt)} · МОСКОВСКОЕ ВРЕМЯ · {flightMissionLabel(missionId).toUpperCase()}</> : 'РАСЧЁТ БУДЕТ ВЫПОЛНЕН ПРИ ОТПРАВКЕ'}</div>
            <div className="resource-building-action-confirm-actions flight-timeline-actions">
              <button type="button" data-qa-flight-preview-cancel onClick={closeFlightPreview}>ОТМЕНА</button>
              <button type="button" data-qa-flight-dispatch-confirm disabled={!canDispatchPreview} onClick={confirmFlightDispatch}>ОТПРАВИТЬ</button>
            </div>
          </section>
        </div>,
        document.body,
      ) : null}
      {spyOperationsOpen ? createPortal(
        <div className="resource-building-action-confirm-backdrop spy-operations-backdrop" data-qa-spy-operations-backdrop onMouseDown={() => setSpyOperationsOpen(false)}>
          <section className="resource-building-action-confirm spy-operations-modal" role="dialog" aria-modal="true" aria-labelledby="spy-operations-title" onMouseDown={(event) => event.stopPropagation()}>
            <header className="spy-operations-modal__head">
              <div>
                <small>УПРАВЛЕНИЕ ФЛОТОМ / ШПИОНАЖ</small>
                <h3 id="spy-operations-title">ШПИОНСКИЕ ОТЧЁТЫ</h3>
                <p>Активные зонды и управление готовыми снимками цели.</p>
              </div>
              <button type="button" className="spy-operations-modal__close" data-asterion-close aria-label="Закрыть шпионские отчёты" onClick={() => setSpyOperationsOpen(false)}>×</button>
            </header>
            <div className="spy-operations-table-shell" role="table" aria-label="Активные шпионские зонды">
              <div className="spy-operations-row spy-operations-row--head" role="row">
                <span role="columnheader">ВЫБОР</span><span role="columnheader">ОТКУДА</span><span role="columnheader">КУДА</span><span role="columnheader">ПРИБЫТИЕ</span><span role="columnheader">ВОЗВРАЩЕНИЕ</span><span role="columnheader">МИССИЯ</span><span role="columnheader">ДЕЙСТВИЯ</span>
              </div>
              {spyRows.length ? spyRows.map(({ mission, flight }) => {
                const selected = selectedSpyMissionIds.has(mission.id);
                const reportReady = mission.status === 'orbiting' && (mission.nextReportAt === undefined || clockNow >= mission.nextReportAt);
                return <div className="spy-operations-row" key={mission.id} data-qa-spy-mission={mission.id} data-qa-spy-status={mission.status} role="row">
                  <label className="spy-operations-select" role="cell"><input type="checkbox" checked={selected} onChange={(event) => { const checked = event.currentTarget.checked; setSelectedSpyMissionIds((current) => { const next = new Set(current); if (checked) next.add(mission.id); else next.delete(mission.id); return next; }); }} aria-label={`Выбрать зонд у ${mission.targetPlanetName}`} /><span aria-hidden="true" /></label>
                  <span role="cell"><strong>{planetName}</strong><small>{flightCoordinateLabel(flight.originCoordinate)}</small></span>
                  <span role="cell"><strong>{mission.targetPlanetName}</strong><small>{flightCoordinateLabel(mission.targetCoordinate)} · {mission.targetOwnerName}</small></span>
                  <span className="fleet-spy-status-v1" role="cell">{mission.status === 'transit' ? flightCountdown(flight.arrivalAt, clockNow) : mission.status === 'orbiting' ? 'НА ОРБИТЕ' : '—'}</span>
                  <span className="fleet-spy-status-v1" role="cell">{mission.status === 'returning' ? flightCountdown(flight.returnAt, clockNow) : '—'}</span>
                  <span role="cell"><strong>ШПИОНАЖ</strong><small>{spyStatusLabel(mission, flight, clockNow)} · {espionageState.reports.filter((report) => report.missionId === mission.id).length} отч.</small></span>
                  <span className="fleet-spy-row-actions-v1" role="cell">
                    <button type="button" disabled={!reportReady} onClick={() => window.dispatchEvent(new CustomEvent(SPY_REPORT_REQUEST_EVENT, { detail: { missionId: mission.id, now: Date.now() } }))}>ПОЛУЧИТЬ ОТЧЁТ</button>
                    <button type="button" disabled={mission.status === 'returning'} onClick={() => { if (mission.status === 'transit' || mission.status === 'orbiting') window.dispatchEvent(new CustomEvent(FLIGHT_RECALL_REQUEST_EVENT, { detail: { flightId: flight.id, now: Date.now() } })); }}>ВЕРНУТЬ</button>
                  </span>
                </div>;
              }) : <p className="fleet-spy-empty-v1">Активных зондов нет. Отправьте один зонд на вражескую или нейтральную планету.</p>}
            </div>
            <footer className="spy-operations-modal__footer">
              <span>{spyRows.length} активных зондов</span>
              <div className="spy-operations-modal__actions">
                <button type="button" onClick={recallAllSpies}>ОТОЗВАТЬ ВСЕХ ШПИОНОВ</button>
                <button type="button" onClick={recallSelectedSpies}>ОТОЗВАТЬ ВЫБРАННЫХ</button>
                <button type="button" onClick={requestReadySpyReports}>ПОЛУЧИТЬ ГОТОВЫЕ ОТЧЁТЫ</button>
              </div>
            </footer>
          </section>
        </div>,
        document.body,
      ) : null}
      {pendingRecall ? createPortal(
        <div className="resource-building-action-confirm-backdrop" data-qa-flight-recall-backdrop onMouseDown={() => setPendingRecall(null)}>
          <section className="resource-building-action-confirm" role="alertdialog" aria-modal="true" aria-labelledby="flight-recall-title" onMouseDown={(event) => event.stopPropagation()}>
            <small>ПОДТВЕРЖДЕНИЕ ОТЗЫВА</small>
            <h3 id="flight-recall-title">{pendingRecall.missionId === 'espionage' ? 'Вернуть шпионский зонд?' : 'Отозвать рейс?'}</h3>
            <p>{pendingRecall.missionId === 'espionage' ? 'Зонд начнёт обратный путь с текущей позиции. Газ за исходящий участок не возвращается.' : 'Колонизатор вернётся с обратным таймером. Газ за исходящий участок не возвращается.'}</p>
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
  const [planetId, setPlanetId] = useState('helion-01');
  const [resetNonce, setResetNonce] = useState(0);
  const [planet, setPlanet] = useState({ name: 'Helion 01', coords: '[1:1:1]' });
  const [constructionRequested, setConstructionRequested] = useState(false);
  const [fleetBudget, setFleetBudget] = useState<FleetBuildBudget>(readFleetBuildBudget);
  const [launchContext, setLaunchContext] = useState<FlightLaunchContext | null>(null);
  const [flightRecords, setFlightRecords] = useState<FlightRecord[]>(() => createPersistenceFacade({ mode: ACTIVE_RUNTIME_MODE }).read().flights.records);
  const [espionageState, setEspionageState] = useState<EspionageState>(() => createPersistenceFacade({ mode: ACTIVE_RUNTIME_MODE }).read().espionage ?? { missions: [], reports: [], hunterNotices: [] });
  const [entityLevels, setEntityLevels] = useState<Record<string, number>>(() => {
    const runtimeState = createPersistenceFacade({ mode: ACTIVE_RUNTIME_MODE }).read();
    return runtimeState.planets[runtimeState.currentPlanetId]?.spaceportUpgrades?.shipLevels ?? {};
  });

  useEffect(() => {
    const syncPlanet = () => {
      const runtimeState = createPersistenceFacade({ mode: ACTIVE_RUNTIME_MODE }).read();
      setTarget(document.querySelector('.workspace'));
      setPlanetId(runtimeState.currentPlanetId);
      setPlanet(readCurrentPlanet());
      setFleetBudget(readFleetBuildBudget({}, runtimeState.currentPlanetId));
      setFlightRecords(runtimeState.flights.records);
      setEspionageState(runtimeState.espionage ?? { missions: [], reports: [], hunterNotices: [] });
      setEntityLevels(runtimeState.planets[runtimeState.currentPlanetId]?.spaceportUpgrades?.shipLevels ?? {});
    };

    const onLaunchContext = (event: Event) => setLaunchContext((event as CustomEvent<FlightLaunchContext>).detail);
    const onLaunchContextClear = () => setLaunchContext(null);
    const onRuntimeReset = () => {
      setLaunchContext(null);
      setConstructionRequested(false);
      setResetNonce((current) => current + 1);
      // App invalidates mounted consumers before replacing the save. Read the
      // canonical replacement on the next task, after persistence.write().
      window.setTimeout(syncPlanet, 0);
    };
    const onCommandResult = (event: Event) => {
      const result = (event as CustomEvent<FlightCommandResult>).detail;
      if (result.ok) {
        setFlightRecords(result.state.flights.records);
        setEspionageState(result.state.espionage ?? { missions: [], reports: [], hunterNotices: [] });
        setLaunchContext(null);
      }
    };

    syncPlanet();
    if (route !== 'fleets') setLaunchContext(null);
    window.addEventListener(FLIGHT_LAUNCH_CONTEXT_EVENT, onLaunchContext);
    window.addEventListener(FLIGHT_LAUNCH_CONTEXT_CLEAR_EVENT, onLaunchContextClear);
    window.addEventListener(FLIGHT_COMMAND_RESULT_EVENT, onCommandResult);
    window.addEventListener(RUNTIME_STATE_CHANGED_EVENT, syncPlanet);
    window.addEventListener(RUNTIME_RESET_EVENT, onRuntimeReset);
    window.addEventListener('storage', syncPlanet);
    return () => {
      window.removeEventListener(FLIGHT_LAUNCH_CONTEXT_EVENT, onLaunchContext);
      window.removeEventListener(FLIGHT_LAUNCH_CONTEXT_CLEAR_EVENT, onLaunchContextClear);
      window.removeEventListener(FLIGHT_COMMAND_RESULT_EVENT, onCommandResult);
      window.removeEventListener(RUNTIME_STATE_CHANGED_EVENT, syncPlanet);
      window.removeEventListener(RUNTIME_RESET_EVENT, onRuntimeReset);
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
      key={`${planetId}:${resetNonce}`}
      planetId={planetId}
      planetName={planet.name}
      coords={planet.coords}
      openConstruction={constructionRequested}
        onConstructionOpened={() => setConstructionRequested(false)}
        fleetBudget={fleetBudget}
        launchContext={launchContext}
      flightRecords={flightRecords}
      espionageState={espionageState}
      entityLevels={entityLevels}
      />,
    target,
  );
}
