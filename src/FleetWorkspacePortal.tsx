import type { CSSProperties } from 'react';
import { OPEN_SUN_OPERATIONS_EVENT } from './application/sun-raid.ts';
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { getFactionShipCatalog } from './domain/combat/faction-catalog.ts';
import { PIRATE_CATALOG_BY_ID, type PirateBaseShipId } from './domain/pirates/catalog.ts';
import { COMMANDER_COMBAT_CATALOG } from './domain/combat/catalog.ts';
import { getCombatFactionName } from './domain/combat/factions.ts';
import { COMMANDER_IDS, getCommanderPresentedAbility, type CommanderId } from './domain/combat/commanders.ts';
import type { ShipId } from './domain/combat/ids.ts';
import type { SimulatorMaxRounds } from './domain/combat/simulator.ts';
import { SOLAR_SATELLITE_ID } from './domain/combat/ids.ts';
import { getBuildingPresentation } from './domain/buildings/balance-v1.ts';
import { RUNTIME_RESET_EVENT, RUNTIME_STATE_CHANGED_EVENT } from './domain/runtime/mode.ts';
import {
  getFleetBuildBudget,
  getFleetSnapshot,
  getFleetSummaryForSnapshot,
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
  BOT01_INCOMING_SCENARIO_REQUEST_EVENT,
  BOT01_EXPLORATION_SCENARIO_REQUEST_EVENT,
  FLIGHT_COMMAND_RESULT_EVENT,
  FLIGHT_DISPATCH_REQUEST_EVENT,
  FLIGHT_LAUNCH_CONTEXT_CLEAR_EVENT,
  FLIGHT_LAUNCH_CONTEXT_EVENT,
  FLIGHT_RECALL_REQUEST_EVENT,
  UNIVERSE_COORDINATE_OPEN_EVENT,
  SPY_REPORT_ALL_REQUEST_EVENT,
  SPY_REPORT_REQUEST_EVENT,
  SPY_REPORT_RESULT_EVENT,
  getTransportCargoSummary,
  getAvailableFleetForPlanet,
  resolveTransportTarget,
  resolveRecycleTargetKindAtCoordinate,
  previewFlight,
  type DispatchFlightCommand,
  type FlightCommandResult,
  type FlightLaunchContext,
} from './application/flights.ts';
import { getAttackCommanderSelection, isAttackCombatShip } from './application/attack.ts';
import { selectOwnedPirateTargets } from './application/pirate-presentation.ts';
import { selectExplorationTargets, explorationTargetStatus } from './application/exploration.ts';
import { explorationMiningRates, explorationProfile } from './domain/exploration/model.ts';
import { expeditionMiningCapacity } from './application/exploration-flight.ts';
import { reconcileExplorationContact } from './domain/exploration/ledger.ts';
import type { FlightDestination, FlightRecord, MissionId, TargetRelation } from './domain/flights/types.ts';
import type { UniverseAsteroidSimulationState, UniverseCoordinate, UniverseObjectKind } from './domain/universe/types.ts';
import type { EspionageState, SpyMission } from './domain/espionage/types.ts';
import { emptyTransportCargo, getCargoFieldMaximum, type TransportCargo, type TransportCargoKey } from './domain/flights/cargo.ts';
import { getOverflowWarning } from './domain/flights/cargo.ts';
import { getOwnerShipUpgradeLevels, getPlanetResources, type SaveState } from './application/contracts.ts';
import { getStorageCapacities } from './domain/buildings/resource-zone.ts';
import { FLIGHT_POSITION_COUNT, FLIGHT_SYSTEM_COUNT, isFlightCoordinate } from './domain/flights/distance.ts';
import { ACTIVE_RUNTIME_MODE, resolveTestTimeScale, scaleRuntimeDuration } from './domain/runtime/mode.ts';
import { createPersistenceFacade } from './application/persistence.ts';
import { advanceUniverseAsteroidSimulationAt, findUniverseAsteroidAtCoordinate } from './domain/universe/asteroid-simulation.ts';
import {
  FLEET_CONSTRUCTION_NAVIGATION,
  FLEET_MANAGEMENT_NAVIGATION,
  useNavigation,
  type FleetSectionId,
  type FleetSectionItem,
} from './ui/navigation.tsx';
import { AmountSlider } from './ui/AmountSlider';
import { ResourceIcon } from './ui/resources/ResourceIcon';
import './building-card.css';
import './fleet-workspace.css';
import './ui/fleet/fleet-root-v2.css';

const FLEET_ROOT_STATUS = 'Выберите корабли и миссию. Для колонизации сначала выберите свободную координату во Вселенной.';
const GAS_PREVIEW_FRESHNESS_WINDOW_MS = 10_000;

type GasAsteroidArrivalPreview = {
  asteroidCoordinate: UniverseCoordinate | null;
  targetCoordinate: UniverseCoordinate;
  hit: boolean;
  unavailable: boolean;
};

type MissionDefinition = {
  id: MissionId;
  label: string;
  description: string;
  icon: string;
  /** `false` keeps a registered mission visible but not selectable until its runtime exists. */
  enabled?: boolean;
};

type ConstructionView = 'ships' | ConstructionCatalogMode | null;

type FleetLaunchContext = FlightLaunchContext;

import missionTransportIcon from '../assets/source/mission-icons-v1/01_transport.png';
import missionEspionageIcon from '../assets/source/mission-icons-v1/02_espionage.png';
import missionAttackIcon from '../assets/source/mission-icons-v1/03_attack.png';
import missionDeploymentIcon from '../assets/source/mission-icons-v1/04_deployment.png';
import missionColonizeIcon from '../assets/source/mission-icons-v1/05_colonize.png';
import missionRecycleIcon from '../assets/source/mission-icons-v1/06_recycle.png';
import missionGasIcon from '../assets/source/mission-icons-v1/07_gas_harvest.png';
import missionSunSupportIcon from '../assets/source/mission-icons-v1/08_sun_support.png';
import missionSpaceFlightIcon from '../assets/source/mission-icons-v1/09_space_flight.png';
import missionPirateEliminationIcon from '../assets/source/mission-icons-v1/10_pirate_elimination.png';
import missionExpeditionIcon from '../assets/source/mission-icons-v1/31_expedition.png';
import missionAidIcon from '../assets/source/mission-icons-v1/33_trade_convoy.png';
import { AID_MISSION_DESCRIPTION, AID_MISSION_ENABLED, AID_TRANSPORT_SHIP_IDS } from './domain/flights/aid-mission.ts';
import { AID_RESOURCE_LABELS, selectFulfillableRequests, selectRequestById } from './domain/command/aid.ts';
import { selectRequestProgress } from './application/alliance-aid.ts';

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
  { id: 'pirate-elimination', label: 'Пиратский рейд', description: 'Атака действующей пиратской базы в системе ваших колоний.', icon: missionPirateEliminationIcon },
  { id: 'expedition', label: 'Экспедиция', description: 'Добыча на свободном уникальном объекте или аномалии в пределах пяти систем от колоний.', icon: missionExpeditionIcon },
  { id: 'deployment', label: 'Дислокация', description: 'Переброска флота только между своими планетами.', icon: missionDeploymentIcon },
  { id: 'colonize', label: 'Колонизация', description: 'Основание новой колонии на свободной планете.', icon: missionColonizeIcon },
  { id: 'recycle', label: 'Переработка', description: 'Сбор и переработка обломков в космосе.', icon: missionRecycleIcon },
  { id: 'gas', label: 'Добыча газа', description: 'Специализированная экспедиция за газом.', icon: missionGasIcon },
  { id: 'sun-support', label: 'Поддержка солнца', description: 'Защита Солнца от командного рейда. Флот отправляется из «Командование → Операции».', icon: missionSunSupportIcon },
  { id: 'aid', label: 'Помощь союзу', description: AID_MISSION_DESCRIPTION, icon: missionAidIcon, enabled: AID_MISSION_ENABLED },
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

/** Civil hulls for the «Гражданские» roster filter; everything else counts as combat. */
const CIVIL_SHIP_IDS = new Set<string>(['transporter', 'mega-transporter', 'recycler', 'spy-probe', 'colonizer', 'solar-satellite']);

/** A coordinate that opens the system map at that position. */
function CoordinateLink({ coordinate }: { coordinate: { galaxy: number; system: number; position: number } }) {
  return (
    <button
      type="button"
      className="fleet-coordinate-link-v2"
      title="Открыть во Вселенной"
      onClick={(event) => { event.stopPropagation(); window.dispatchEvent(new CustomEvent(UNIVERSE_COORDINATE_OPEN_EVENT, { detail: { coordinate } })); }}
    >{flightCoordinateLabel(coordinate)}</button>
  );
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
  if (missionId === 'pirate-recon') return 'Разведка пиратов';
  if (missionId === 'pirate-raid') return 'ПИРАТСКИЙ НАЛЁТ';
  if (missionId === 'exploration-recon') return 'Исследование объекта';
  return missions.find((mission) => mission.id === missionId)?.label ?? missionId;
}

function flightMissionIcon(missionId: MissionId) {
  if (missionId === 'pirate-recon') return missionEspionageIcon;
  if (missionId === 'pirate-raid') return missionAttackIcon;
  if (missionId === 'exploration-recon') return missionEspionageIcon;
  return missions.find((mission) => mission.id === missionId)?.icon;
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

function sameUniverseCoordinate(left: UniverseCoordinate | null | undefined, right: UniverseCoordinate | null | undefined) {
  return left?.galaxy === right?.galaxy
    && left?.system === right?.system
    && left?.position === right?.position;
}

function gasAsteroidPreviewAtArrival(
  simulation: UniverseAsteroidSimulationState | undefined,
  targetCoordinate: UniverseCoordinate,
  arrivalAt: number,
): GasAsteroidArrivalPreview {
  if (!simulation) return { asteroidCoordinate: null, targetCoordinate, hit: false, unavailable: true };

  const arrivalSimulation = advanceUniverseAsteroidSimulationAt(simulation, arrivalAt, 1).state;
  const asteroidAtCoordinate = findUniverseAsteroidAtCoordinate(arrivalSimulation.asteroids, targetCoordinate);
  return {
    asteroidCoordinate: asteroidAtCoordinate?.coordinate ?? null,
    targetCoordinate,
    hit: Boolean(asteroidAtCoordinate),
    unavailable: false,
  };
}

function sameGasAsteroidForecast(
  left: GasAsteroidArrivalPreview | null,
  right: GasAsteroidArrivalPreview | null,
) {
  return Boolean(left && right
    && left.hit === right.hit
    && left.unavailable === right.unavailable
    && sameUniverseCoordinate(left.targetCoordinate, right.targetCoordinate)
    && sameUniverseCoordinate(left.asteroidCoordinate, right.asteroidCoordinate));
}

function sameGasFlightCandidate(
  left: FlightRecord | null,
  right: FlightRecord | null,
  leftForecast: GasAsteroidArrivalPreview | null,
  rightForecast: GasAsteroidArrivalPreview | null,
) {
  if (!left || !right || left.missionId !== 'gas' || right.missionId !== 'gas') return false;
  const leftShips = Object.entries(left.selectedShips).sort(([a], [b]) => a.localeCompare(b));
  const rightShips = Object.entries(right.selectedShips).sort(([a], [b]) => a.localeCompare(b));
  return left.originPlanetId === right.originPlanetId
    && sameUniverseCoordinate(left.originCoordinate, right.originCoordinate)
    && sameUniverseCoordinate(left.destinationCoordinate, right.destinationCoordinate)
    && JSON.stringify(leftShips) === JSON.stringify(rightShips)
    && left.targetKind === right.targetKind
    && left.targetRelation === right.targetRelation
    && left.operationId === right.operationId
    && left.routeDistance === right.routeDistance
    && left.effectiveSpeed === right.effectiveSpeed
    && left.oneWayDurationMs === right.oneWayDurationMs
    && left.gasCost === right.gasCost
    && left.gasCapacity === right.gasCapacity
    && flightArrivalLabel(left.arrivalAt) === flightArrivalLabel(right.arrivalAt)
    && sameGasAsteroidForecast(leftForecast, rightForecast);
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
  saveState,
  launchContext,
}: {
  planetId: string;
  planetName: string;
  coords: string;
  openConstruction: boolean;
  onConstructionOpened: () => void;
  saveState: SaveState;
  launchContext: FleetLaunchContext | null;
}) {
  const { fleetSection: selectedSection, setFleetSection } = useNavigation();
  const [selectedQuantities, setSelectedQuantities] = useState<Partial<Record<ShipId, number>>>({});
  const [selectedCommanders, setSelectedCommanders] = useState<Partial<Record<CommanderId, number>>>({});
  const [attackRounds, setAttackRounds] = useState<SimulatorMaxRounds>(12);
  const [oneWayDurationMinutes, setOneWayDurationMinutes] = useState(5);
  const [missionId, setMissionId] = useState<MissionId>('transport');
  const [hoveredMissionId, setHoveredMissionId] = useState<MissionId | null>(null);
  const [constructionView, setConstructionView] = useState<ConstructionView>(null);
  const [status, setStatus] = useState(FLEET_ROOT_STATUS);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewResult, setPreviewResult] = useState<FlightCommandResult | null>(null);
  const [previewOriginPlanetId, setPreviewOriginPlanetId] = useState<string | null>(null);
  const [previewDestination, setPreviewDestination] = useState<FlightDestination | null>(null);
  const [previewTargetRelation, setPreviewTargetRelation] = useState<TargetRelation | undefined>(undefined);
  const [previewSubmittedTargetKind, setPreviewSubmittedTargetKind] = useState<UniverseObjectKind | null>(null);
  const [gasPreviewNeedsReconfirmation, setGasPreviewNeedsReconfirmation] = useState(false);
  const [editingPreviewTarget, setEditingPreviewTarget] = useState(false);
  const [previewTargetDraft, setPreviewTargetDraft] = useState<FlightCoordinateDraft>({ galaxy: '', system: '', position: '' });
  const [previewTargetError, setPreviewTargetError] = useState<string | null>(null);
  const [selectedPirateTargetKey, setSelectedPirateTargetKey] = useState<string | null>(null);
  const [selectedExplorationTargetKey, setSelectedExplorationTargetKey] = useState<string | null>(null);
  const [selectedExpeditionFlightId, setSelectedExpeditionFlightId] = useState<string | null>(null);
  const [selectedAidRequestId, setSelectedAidRequestId] = useState<string | null>(null);
  const [transportCargoDraft, setTransportCargoDraft] = useState<TransportCargo>(emptyTransportCargo);
  const [pendingRecall, setPendingRecall] = useState<FlightRecord | null>(null);
  const [clockNow, setClockNow] = useState(() => Date.now());
  const fleetSnapshot = useMemo(() => getFleetSnapshot(saveState, planetId as SaveState['currentPlanetId']), [planetId, saveState]);
  const fleetBudget = useMemo(() => getFleetBuildBudget(saveState, planetId as SaveState['currentPlanetId']), [planetId, saveState]);
  const flightRecords = saveState.flights.records;
  const espionageState = saveState.espionage ?? { missions: [], reports: [], hunterNotices: [] };
  const entityLevels = getOwnerShipUpgradeLevels(saveState);
  const saveStateRef = useRef(saveState);
  saveStateRef.current = saveState;
  const [pendingSatelliteDismantle, setPendingSatelliteDismantle] = useState<number | null>(null);
  const [simulatorHandoff, setSimulatorHandoff] = useState<SimulatorScenario | null>(() => consumeSimulatorHandoff());
  const [spyOperationsOpen, setSpyOperationsOpen] = useState(false);
  const [flightsOpen, setFlightsOpen] = useState(false);
  const [shipFilter, setShipFilter] = useState<'all' | 'combat' | 'civil'>('all');
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

  const visibleShipDefinitions = missionId === 'colonize'
    ? ownedShipDefinitions.filter((ship) => ship.id === 'colonizer')
    : missionId === 'espionage'
      ? ownedShipDefinitions.filter((ship) => ship.id === 'spy-probe')
      : missionId === 'pirate-elimination'
        ? ownedShipDefinitions.filter((ship) => getFactionShipCatalog(factionId).find((entity) => entity.id === ship.id)?.category === 'Боевой корабль')
      : missionId === 'attack'
        ? ownedShipDefinitions.filter((ship) => isAttackCombatShip(ship.id, factionId))
        : missionId === 'recycle' || missionId === 'gas'
          ? ownedShipDefinitions.filter((ship) => ship.id === 'recycler')
          : missionId === 'aid'
            ? ownedShipDefinitions.filter((ship) => (AID_TRANSPORT_SHIP_IDS as readonly string[]).includes(ship.id))
      : ownedShipDefinitions;
  const commanderAvailability = useMemo(() => {
    if (missionId !== 'attack' && missionId !== 'pirate-elimination' && missionId !== 'deployment' && missionId !== 'space-flight') return {} as Partial<Record<CommanderId, number>>;
    const runtimeState = saveState;
    return missionId === 'attack' || missionId === 'pirate-elimination'
      ? getAttackCommanderSelection(runtimeState, planetId)
      : getAvailableFleetForPlanet(runtimeState, planetId).commanders;
  }, [flightRecords, fleetSnapshot.fleet, missionId, planetId, saveState]);
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
    || ((missionId === 'deployment' || missionId === 'space-flight') && selectedCommanderCount > 0);
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
  // Hostile flights heading to the player light up the whole Fleet screen.
  const hostileIncomingFlights = useMemo(() => activeFlightRecords
    .filter((flight) => flight.phase === 'outbound' && ((flight.ownerSide === 'bot01' && flight.missionId === 'attack') || (flight.ownerSide === 'pirate' && flight.missionId === 'pirate-raid')))
    .map((flight) => ({ flight, originLabel: flight.ownerSide === 'pirate' ? 'Пираты' : 'Bot 01' })), [activeFlightRecords]);
  const ownFlightGroups = useMemo(() => {
    const counts = new Map<FlightRecord["missionId"], number>();
    for (const flight of activeFlightRecords) {
      if (flight.ownerSide && flight.ownerSide !== 'player') continue;
      counts.set(flight.missionId, (counts.get(flight.missionId) ?? 0) + 1);
    }
    return [...counts].map(([missionId, count]) => ({ missionId, count }));
  }, [activeFlightRecords]);
  const nextFlightEvent = useMemo(() => {
    let next: { at: number; label: string } | null = null;
    for (const flight of activeFlightRecords) {
      const at = flight.phase === 'outbound' ? flight.arrivalAt : flight.phase === 'returning' ? flight.returnAt : null;
      if (!at || at < clockNow) continue;
      const label = `${flightMissionLabel(flight.missionId)} · ${flight.phase === 'outbound' ? 'прибытие' : 'возврат'}`;
      if (!next || at < next.at) next = { at, label };
    }
    return next;
  }, [activeFlightRecords, clockNow]);
  const attackOrderByFlightId = useMemo(() => {
    let order = 0;
    return new Map(activeFlightRecords.filter((flight) => flight.missionId === 'attack').map((flight) => [flight.id, ++order]));
  }, [activeFlightRecords]);
  const spyRows = useMemo(() => espionageState.missions
    .filter((mission) => mission.status === 'transit' || mission.status === 'orbiting' || mission.status === 'returning')
    .map((mission) => ({ mission, flight: flightRecords.find((flight) => flight.id === mission.flightId) }))
    .filter((row): row is { mission: SpyMission; flight: FlightRecord } => Boolean(row.flight)), [espionageState.missions, flightRecords]);

  const getActiveTransportState = (flight: FlightRecord) => {
    if (flight.missionId !== 'transport' && flight.missionId !== 'aid') return { overflowWarning: false, targetUnavailable: false };
    const runtimeState = saveState;
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
    setAttackRounds(12);
    setOneWayDurationMinutes(5);
    setPreviewOpen(false);
    setPreviewResult(null);
    setPreviewOriginPlanetId(null);
    setPreviewDestination(null);
    setPreviewTargetRelation(undefined);
    setPreviewSubmittedTargetKind(null);
    setGasPreviewNeedsReconfirmation(false);
    setEditingPreviewTarget(false);
    setPreviewTargetDraft({ galaxy: '', system: '', position: '' });
    setPreviewTargetError(null);
    setSelectedPirateTargetKey(null);
    setSelectedExplorationTargetKey(null);
    setSelectedAidRequestId(null);
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
    setPreviewSubmittedTargetKind(null);
    setPreviewTargetError(null);
    setGasPreviewNeedsReconfirmation(false);
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
    const runtimeState = saveStateRef.current;
    setSelectedCommanders(launchContext.missionId === 'attack' || launchContext.missionId === 'pirate-elimination'
      ? getAttackCommanderSelection(runtimeState, planetId)
      : {});
    setAttackRounds(12);
    setSelectedQuantities(launchContext.missionId === 'colonize'
      ? { colonizer: 1 }
      : launchContext.missionId === 'espionage' ? { 'spy-probe': 1 } : {});
    setPreviewOriginPlanetId(null);
    setPreviewDestination(null);
    setPreviewTargetRelation(launchContext.targetRelation);
    setPreviewSubmittedTargetKind(null);
    setEditingPreviewTarget(false);
    setPreviewTargetDraft(launchContext.destination ? flightCoordinateDraft(launchContext.destination.coordinate) : { galaxy: '', system: '', position: '' });
    setPreviewTargetError(null);
    setSelectedPirateTargetKey(launchContext.missionId === 'pirate-elimination' ? launchContext.contactCycleKey ?? null : null);
    setSelectedExplorationTargetKey(launchContext.missionId === 'expedition' ? launchContext.contactCycleKey ?? null : null);
    setSelectedAidRequestId(launchContext.missionId === 'aid' ? launchContext.aidRequestId ?? null : null);
    setStatus(launchContext.destination ? `Цель: ${flightCoordinateLabel(launchContext.destination.coordinate)}.` : 'Выберите корабли и координаты цели.');
  }, [launchContext, planetId]);

  useEffect(() => {
    resetFlightWorkspace();
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

  const createFlightCommand = (requestId: string, draft?: { originPlanetId?: string; destination?: FlightDestination; targetRelation?: TargetRelation | null; targetKind?: UniverseObjectKind | null; departedAt?: number; pirateContactCycleKey?: string; aidRequestId?: string }, runtimeState = saveStateRef.current): DispatchFlightCommand | null => {
    const originPlanetId = draft?.originPlanetId ?? previewOriginPlanetId ?? runtimeState.currentPlanetId;
    const origin = runtimeState.planets[originPlanetId];
    const pirateTargets = missionId === 'pirate-elimination'
      ? selectOwnedPirateTargets(runtimeState, draft?.departedAt ?? Date.now()) : [];
    const expeditionTargets = missionId === 'expedition'
      ? selectExplorationTargets(runtimeState, draft?.departedAt ?? Date.now(), ACTIVE_RUNTIME_MODE) : [];
    const requestedExpeditionKey = draft?.pirateContactCycleKey ?? selectedExplorationTargetKey ??
      (launchContext?.missionId === 'expedition' ? launchContext.contactCycleKey : undefined);
    const expeditionTarget = expeditionTargets.find(item => item.id === requestedExpeditionKey)
      ?? (!requestedExpeditionKey && expeditionTargets.length === 1 ? expeditionTargets[0] : undefined);
    if (missionId === 'expedition' && (!expeditionTarget || explorationTargetStatus(runtimeState, expeditionTarget) !== 'free')) return null;
    const aidRequestForCommand = missionId === 'aid'
      ? selectRequestById(runtimeState.command, draft?.aidRequestId ?? selectedAidRequestId ?? launchContext?.aidRequestId ?? '')
      : null;
    if (missionId === 'aid' && (!aidRequestForCommand || aidRequestForCommand.status !== 'open')) return null;
    const requestedPirateKey = draft?.pirateContactCycleKey ?? selectedPirateTargetKey;
    const pirateTarget = pirateTargets.find((item) => item.contactCycleKey === requestedPirateKey)
      ?? (!requestedPirateKey && pirateTargets.length === 1 ? pirateTargets[0] : null);
    if (missionId === 'pirate-elimination' && !pirateTarget) return null;
    const destination = missionId === 'pirate-elimination'
      ? { kind: 'coordinate' as const, coordinate: pirateTarget!.coordinate }
      : missionId === 'expedition'
      ? { kind: 'coordinate' as const, coordinate: expeditionTarget!.coordinate }
      : missionId === 'aid'
      ? { kind: 'planet' as const, planetId: aidRequestForCommand!.planetId, coordinate: { ...aidRequestForCommand!.coordinate } }
      : missionId === 'space-flight'
      ? origin ? {
        kind: 'space' as const,
        coordinate: {
          galaxy: origin.universeGalaxy ?? 1,
          system: origin.universeSystem ?? 1,
          position: origin.universePosition ?? 1,
        },
      } : undefined
      : draft?.destination ?? previewDestination ?? launchContext?.destination;
    const departedAt = draft?.departedAt ?? Date.now();
    const targetKind = missionId === 'pirate-elimination' ? 'pirate'
      : missionId === 'expedition' ? expeditionTarget!.kind
      : draft?.targetKind !== undefined
      ? draft.targetKind ?? undefined
      : missionId === 'recycle' && destination?.kind === 'coordinate'
        ? resolveRecycleTargetKindAtCoordinate(runtimeState, destination.coordinate, departedAt, ACTIVE_RUNTIME_MODE)
        : missionId === 'colonize'
          ? launchContext?.targetKind ?? 'empty'
          : launchContext?.targetKind;
    return {
      requestId,
      missionId,
      contactCycleKey: missionId === 'pirate-elimination' ? pirateTarget!.contactCycleKey : missionId === 'expedition' ? expeditionTarget!.id : missionId === 'attack' ? launchContext?.contactCycleKey : undefined,
      originPlanetId,
      destination,
      targetRelation: missionId === 'pirate-elimination' ? 'neutral' : missionId === 'aid' ? 'ally' : draft?.targetRelation === null ? undefined : draft?.targetRelation ?? previewTargetRelation,
      targetKind,
      targetPlanetName: missionId === 'pirate-elimination' ? 'Пираты' : missionId === 'expedition' ? expeditionTarget!.name : launchContext?.targetPlanetName,
      targetOwnerId: launchContext?.targetOwnerId,
      targetOwnerName: launchContext?.targetOwnerName,
      targetRaceId: launchContext?.targetRaceId,
      targetAlliance: launchContext?.targetAlliance,
      selectedShips: missionId === 'colonize'
        ? { colonizer: 1 }
        : missionId === 'espionage'
          ? { 'spy-probe': 1 }
          : missionId === 'recycle' || missionId === 'gas'
            ? { recycler: selectedQuantities.recycler ?? 0 }
            : selectedQuantities,
      selectedCommanders: missionId === 'attack' || missionId === 'pirate-elimination' || missionId === 'deployment' || missionId === 'space-flight' ? selectedCommanders : undefined,
      maxRounds: missionId === 'attack' || missionId === 'pirate-elimination' ? attackRounds : undefined,
      cargo: missionId === 'transport' || missionId === 'space-flight' || missionId === 'aid' ? transportCargoDraft : undefined,
      ...(missionId === 'aid' ? { aidRequestId: aidRequestForCommand!.id } : {}),
      operationId: missionId === 'expedition' ? expeditionTarget!.id : launchContext?.operationId,
      departedAt: draft?.departedAt ?? departedAt,
      oneWayDurationMinutes: missionId === 'space-flight' ? oneWayDurationMinutes : undefined,
    };
  };

  useEffect(() => {
    if (!previewOpen || (missionId !== 'space-flight' && missionId !== 'aid') || !previewOriginPlanetId) return;
    const runtimeState = saveState;
    const command = createFlightCommand(`preview-${Date.now()}`, { originPlanetId: previewOriginPlanetId }, runtimeState);
    if (!command) return;
    const result = previewFlight(runtimeState, command, {
      mode: ACTIVE_RUNTIME_MODE,
      testTimeScale: resolveTestTimeScale(),
    });
    setPreviewResult(result);
    setPreviewTargetError(targetErrorFromFlightResult(result));
    setPreviewSubmittedTargetKind(null);
  }, [missionId, oneWayDurationMinutes, previewOpen, previewOriginPlanetId, saveState, selectedCommanders, selectedQuantities, transportCargoDraft]);

  const openFlightPreview = () => {
    const runtimeState = saveState;
    const originPlanetId = runtimeState.currentPlanetId;
    const availablePirates = missionId === 'pirate-elimination' ? selectOwnedPirateTargets(runtimeState, Date.now()) : [];
    const expeditionTargets = missionId === 'expedition' ? selectExplorationTargets(runtimeState, Date.now(), ACTIVE_RUNTIME_MODE) : [];
    const requestedExpedition = expeditionTargets.find(item => item.id === selectedExplorationTargetKey)
      ?? (!selectedExplorationTargetKey && expeditionTargets.length === 1 ? expeditionTargets[0] : undefined);
    const requestedPirate = availablePirates.find((item) => item.contactCycleKey === selectedPirateTargetKey)
      ?? (!selectedPirateTargetKey && availablePirates.length === 1 ? availablePirates[0] : null);
    const aidRequestForPreview = missionId === 'aid'
      ? selectRequestById(runtimeState.command, selectedAidRequestId ?? launchContext?.aidRequestId ?? '')
      : null;
    const requestedDestination = missionId === 'aid'
      ? aidRequestForPreview && aidRequestForPreview.status === 'open'
        ? { kind: 'planet' as const, planetId: aidRequestForPreview.planetId, coordinate: { ...aidRequestForPreview.coordinate } }
        : undefined
      : previewDestination ?? launchContext?.destination;
    const destination = missionId === 'pirate-elimination'
      ? requestedPirate ? { kind: 'coordinate' as const, coordinate: requestedPirate.coordinate } : undefined
      : missionId === 'expedition'
      ? requestedExpedition ? { kind: 'coordinate' as const, coordinate: requestedExpedition.coordinate } : undefined
      : missionId === 'space-flight'
      ? createFlightCommand(`preview-${Date.now()}`, { originPlanetId }, runtimeState)?.destination
      : requestedDestination;
    const targetRelation = missionId === 'pirate-elimination' || missionId === 'expedition' ? 'neutral' : missionId === 'space-flight' ? undefined : missionId === 'aid' ? 'ally' : previewTargetRelation ?? launchContext?.targetRelation;
    const command = missionId === 'space-flight'
      ? createFlightCommand(`preview-${Date.now()}`, { originPlanetId }, runtimeState)
      : destination ? createFlightCommand(`preview-${Date.now()}`, { originPlanetId, destination, targetRelation }, runtimeState) : null;
    setPreviewOriginPlanetId(originPlanetId);
    setPreviewDestination(destination ?? null);
    setPreviewTargetRelation(targetRelation);
    setGasPreviewNeedsReconfirmation(false);
    setEditingPreviewTarget(missionId === 'space-flight' || missionId === 'pirate-elimination' || missionId === 'expedition' || missionId === 'aid' ? false : destination ? (previewDestination ? editingPreviewTarget : false) : true);
    setPreviewTargetDraft(missionId === 'pirate-elimination' || missionId === 'expedition' ? destination ? flightCoordinateDraft(destination.coordinate) : { galaxy: '', system: '', position: '' } : destination && !previewDestination ? flightCoordinateDraft(destination.coordinate) : previewTargetDraft);
    if (command) {
      const result = previewFlight(runtimeState, command, { mode: ACTIVE_RUNTIME_MODE, testTimeScale: resolveTestTimeScale() });
      setPreviewTargetError(targetErrorFromFlightResult(result));
      setPreviewResult(result);
      setPreviewSubmittedTargetKind(command.targetKind ?? null);
    } else {
      setPreviewTargetError(missionId === 'pirate-elimination' ? 'Выберите действующую пиратскую базу.' : missionId === 'expedition' ? 'Выберите свободный уникальный объект или аномалию.' : missionId === 'aid' ? 'Выберите открытый запрос союзника.' : null);
      setPreviewResult(null);
      setPreviewSubmittedTargetKind(null);
    }
    setPreviewOpen(true);
  };

  const refreshFlightPreview = (originPlanetId: string, destination: FlightDestination, targetRelation?: TargetRelation | null, pirateContactCycleKey?: string, aidRequestId?: string) => {
    const runtimeState = saveState;
    const command = createFlightCommand(`preview-${Date.now()}`, { originPlanetId, destination, targetRelation, pirateContactCycleKey, aidRequestId }, runtimeState);
    if (!command) return;
    const result = previewFlight(runtimeState, command, {
      mode: ACTIVE_RUNTIME_MODE,
      testTimeScale: resolveTestTimeScale(),
    });
    setPreviewTargetError(targetErrorFromFlightResult(result));
    setPreviewResult(result);
    setPreviewSubmittedTargetKind(command.targetKind ?? null);
    setGasPreviewNeedsReconfirmation(false);
  };

  const selectExpeditionTarget = (contactId: string) => {
    const runtimeState = saveState;
    const target = selectExplorationTargets(runtimeState, Date.now(), ACTIVE_RUNTIME_MODE).find(item => item.id === contactId);
    setSelectedExplorationTargetKey(target?.id ?? null);
    setPreviewResult(null);
    setEditingPreviewTarget(false);
    if (!target || explorationTargetStatus(runtimeState, target) !== 'free') {
      setPreviewTargetError('Экспедиция доступна только на свободный объект. Для занятого используйте «Атака».');
      setPreviewDestination(null);
      return;
    }
    const destination: FlightDestination = { kind: 'coordinate', coordinate: target.coordinate };
    setPreviewDestination(destination);
    setPreviewTargetRelation('neutral');
    setPreviewTargetDraft(flightCoordinateDraft(target.coordinate));
    setPreviewTargetError(null);
    refreshFlightPreview(previewOriginPlanetId ?? runtimeState.currentPlanetId, destination, 'neutral', target.id);
  };

  const selectAidRequest = (requestId: string) => {
    const runtimeState = saveState;
    const request = selectRequestById(runtimeState.command, requestId);
    setSelectedAidRequestId(request && request.status === 'open' ? request.id : null);
    setTransportCargoDraft(emptyTransportCargo());
    setPreviewResult(null);
    setEditingPreviewTarget(false);
    if (!request || request.status !== 'open') {
      setPreviewDestination(null);
      setPreviewTargetRelation(undefined);
      setPreviewTargetDraft({ galaxy: '', system: '', position: '' });
      setPreviewTargetError('Выберите открытый запрос союзника.');
      return;
    }
    const destination: FlightDestination = { kind: 'planet', planetId: request.planetId, coordinate: { ...request.coordinate } };
    setPreviewDestination(destination);
    setPreviewTargetRelation('ally');
    setPreviewTargetDraft(flightCoordinateDraft(destination.coordinate));
    setPreviewTargetError(null);
    refreshFlightPreview(previewOriginPlanetId ?? runtimeState.currentPlanetId, destination, 'ally', undefined, request.id);
  };

  const selectPirateTarget = (cycleKey: string) => {
    const runtimeState = saveState;
    const target = selectOwnedPirateTargets(runtimeState, Date.now()).find((item) => item.contactCycleKey === cycleKey);
    setSelectedPirateTargetKey(target?.contactCycleKey ?? null);
    setPreviewResult(null);
    setPreviewSubmittedTargetKind(null);
    setEditingPreviewTarget(false);
    if (!target) {
      setPreviewDestination(null);
      setPreviewTargetDraft({ galaxy: '', system: '', position: '' });
      setPreviewTargetError('Выберите действующую пиратскую базу.');
      return;
    }
    const destination: FlightDestination = { kind: 'coordinate', coordinate: target.coordinate };
    setPreviewDestination(destination);
    setPreviewTargetRelation('neutral');
    setPreviewTargetDraft(flightCoordinateDraft(target.coordinate));
    setPreviewTargetError(null);
    refreshFlightPreview(previewOriginPlanetId ?? runtimeState.currentPlanetId, destination, 'neutral', target.contactCycleKey);
  };

  const togglePreviewTargetEditing = () => {
    if (missionId === 'pirate-elimination' || missionId === 'expedition') return;
    if (!editingPreviewTarget) {
      setEditingPreviewTarget(true);
      return;
    }
    setEditingPreviewTarget(false);
    if (missionId !== 'recycle' && missionId !== 'gas') return;

    const draftError = coordinateDraftError(previewTargetDraft);
    if (draftError) {
      setPreviewResult(null);
      setPreviewSubmittedTargetKind(null);
      setPreviewTargetError(draftError);
      setGasPreviewNeedsReconfirmation(false);
      return;
    }
    const destination: FlightDestination = { kind: 'coordinate', coordinate: coordinateFromDraft(previewTargetDraft) };
    const runtimeState = saveState;
    const originPlanetId = previewOriginPlanetId ?? runtimeState.currentPlanetId;
    setPreviewOriginPlanetId(originPlanetId);
    setPreviewDestination(destination);
    setPreviewTargetRelation(undefined);
    refreshFlightPreview(originPlanetId, destination);
  };

  const changePreviewTargetField = (field: keyof FlightCoordinateDraft, value: string) => {
    const nextDraft = { ...previewTargetDraft, [field]: value };
    setPreviewTargetDraft(nextDraft);
    setPreviewTargetRelation(undefined);
    const draftError = coordinateDraftError(nextDraft);
    if (draftError) {
      setPreviewDestination(null);
      setPreviewResult(null);
      setPreviewSubmittedTargetKind(null);
      setPreviewTargetError(draftError);
      setGasPreviewNeedsReconfirmation(false);
      return;
    }
    setPreviewDestination({ kind: 'coordinate', coordinate: coordinateFromDraft(nextDraft) });
    setPreviewResult(null);
    setPreviewSubmittedTargetKind(null);
    setPreviewTargetError(null);
    setGasPreviewNeedsReconfirmation(false);
  };

  const selectTransportTarget = (targetId: string) => {
    const runtimeState = saveState;
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

  const cargoMax = (key: TransportCargoKey) => {
    if (!transportSummary) return 0;
    const fieldMax = getCargoFieldMaximum(key, transportSummary.cargo, transportSourceResources, transportSourceDebris, transportSummary.capacity.total);
    return missionId === 'aid' ? Math.min(aidRemainder, fieldMax) : fieldMax;
  };
  const changeTransportCargo = (key: TransportCargoKey, rawValue: string) => {
    const requested = Number(rawValue);
    let amount = Number.isFinite(requested) && requested > 0 ? Math.floor(requested) : 0;
    const runtimeState = saveState;
    const originPlanetId = previewOriginPlanetId ?? runtimeState.currentPlanetId;
    if (missionId === 'aid') {
      // One aid flight carries only the requested resource and never more than is still free on the request.
      if (!aidRequest || key !== aidRequest.resource) return;
      amount = Math.min(amount, aidRemainder);
    }
    setTransportCargoDraft((current) => getTransportCargoSummary(
      runtimeState,
      originPlanetId,
      selectedQuantities,
      { ...current, [key]: amount },
      previewDestination ?? undefined,
      missionId === 'space-flight' ? 100 : 0,
    ).cargo);
  };

  const confirmFlightDispatch = () => {
    const requestId = globalThis.crypto?.randomUUID?.() ?? `flight-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    const gasPreviewFlight = missionId === 'gas' && previewResult?.ok && previewResult.flight.missionId === 'gas'
      ? previewResult.flight
      : null;
    if (missionId === 'recycle'
      && (!previewResult?.ok || previewResult.flight.missionId !== 'recycle' || previewSubmittedTargetKind === null
        || previewResult.flight.selectedShips.recycler !== (selectedQuantities.recycler ?? 0))) return;
    if (missionId === 'gas'
      && (!gasPreviewFlight || gasPreviewFlight.selectedShips.recycler !== (selectedQuantities.recycler ?? 0)
        || (selectedQuantities.recycler ?? 0) <= 0)) return;
    if (missionId === 'deployment' && previewDestination?.kind === 'planet') {
      const runtimeState = saveState;
      if (getPlanetOverpopulationSummary(runtimeState, previewDestination.planetId).blocked) {
        setPreviewTargetError('Планета заблокирована из-за перенаселения.');
        return;
      }
    }
    const localError = coordinateDraftError(previewTargetDraft);
    if ((missionId === 'transport' || missionId === 'colonize' || missionId === 'attack' || missionId === 'recycle' || missionId === 'gas') && localError) {
      setPreviewTargetError(localError);
      setEditingPreviewTarget(true);
      return;
    }
    if (missionId === 'gas') {
      if (!gasPreviewFlight || gasPreviewFlight.selectedShips.recycler !== (selectedQuantities.recycler ?? 0)
        || (selectedQuantities.recycler ?? 0) <= 0) return;

      const departedAt = Date.now();
      const runtimeState = saveState;
      const destination = previewDestination ?? launchContext?.destination;
      if (!destination || destination.kind !== 'coordinate') return;
      const command = createFlightCommand(requestId, {
        originPlanetId: previewOriginPlanetId ?? runtimeState.currentPlanetId,
        destination,
        targetRelation: gasPreviewFlight.targetRelation ?? null,
        targetKind: 'asteroid',
        departedAt,
      }, runtimeState);
      if (!command) return;

      const currentCandidate = previewFlight(runtimeState, command, {
        mode: ACTIVE_RUNTIME_MODE,
        testTimeScale: resolveTestTimeScale(),
      });
      if (!currentCandidate.ok) {
        setPreviewResult(currentCandidate);
        setPreviewTargetError(targetErrorFromFlightResult(currentCandidate));
        setGasPreviewNeedsReconfirmation(false);
        return;
      }

      const currentAsteroidForecast = gasAsteroidPreviewAtArrival(
        runtimeState.asteroidSimulation,
        destination.coordinate,
        currentCandidate.flight.arrivalAt,
      );
      const candidateExpired = gasPreviewFlight.arrivalAt <= departedAt
        || departedAt - gasPreviewFlight.departedAt > GAS_PREVIEW_FRESHNESS_WINDOW_MS;
      if (candidateExpired || !sameGasFlightCandidate(
        gasPreviewFlight,
        currentCandidate.flight,
        arrivalAsteroidPreview,
        currentAsteroidForecast,
      )) {
        setPreviewResult(currentCandidate);
        setPreviewTargetError(null);
        setPreviewSubmittedTargetKind('asteroid');
        setGasPreviewNeedsReconfirmation(true);
        return;
      }

      setGasPreviewNeedsReconfirmation(false);
      window.dispatchEvent(new CustomEvent(FLIGHT_DISPATCH_REQUEST_EVENT, { detail: command }));
      return;
    }
    const command = missionId === 'recycle' && previewResult?.ok
      ? createFlightCommand(requestId, {
        originPlanetId: previewResult.flight.originPlanetId,
        destination: previewResult.flight.destination,
        targetRelation: previewResult.flight.targetRelation ?? null,
        targetKind: previewSubmittedTargetKind,
      })
      : createFlightCommand(requestId, previewDestination || missionId === 'deployment' ? undefined : { destination: { kind: 'coordinate', coordinate: coordinateFromDraft(previewTargetDraft) } });
    if (!command) {
      setPreviewTargetError(missionId === 'pirate-elimination' ? 'Пиратский контакт недоступен. Выберите актуальную базу.'
        : missionId === 'expedition' ? 'Выберите свободный объект экспедиции.' : 'Проверьте параметры рейса.');
      return;
    }
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
    if (missionId === 'recycle' || missionId === 'gas') {
      setPreviewResult(null);
      setPreviewSubmittedTargetKind(null);
      setGasPreviewNeedsReconfirmation(false);
    }
    setSelectedQuantities((current) => ({ ...current, [shipId]: next }));
  };

  const chooseMission = (nextMissionId: MissionId) => {
    setMissionId(nextMissionId);
    if (nextMissionId !== missionId) {
      setSelectedPirateTargetKey(null);
      setSelectedExplorationTargetKey(null);
      setPreviewDestination(null);
      setPreviewTargetRelation(undefined);
      setPreviewTargetDraft({ galaxy: '', system: '', position: '' });
      setPreviewTargetError(null);
    }
    if (missionId === 'gas' || nextMissionId === 'gas' || nextMissionId === 'recycle') {
      setPreviewResult(null);
      setPreviewSubmittedTargetKind(null);
      setPreviewTargetError(null);
      setGasPreviewNeedsReconfirmation(false);
    }
    if (nextMissionId === 'attack' || nextMissionId === 'pirate-elimination') {
      const runtimeState = saveState;
      setSelectedCommanders(getAttackCommanderSelection(runtimeState, runtimeState.currentPlanetId));
      setAttackRounds(12);
    } else {
      setSelectedCommanders({});
    }
  };

  const setAllShipQuantities = (maximum: boolean) => {
    if (missionId === 'recycle' || missionId === 'gas') {
      setPreviewResult(null);
      setPreviewSubmittedTargetKind(null);
      setGasPreviewNeedsReconfirmation(false);
    }
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
    selectedSection === 'repair' ? 'fleet-main-v1--repair' : '',
  ].filter(Boolean).join(' ');
  const productionQueueKind = queueKindForConstructionView(constructionView);
  const previewRuntimeState = previewOpen ? saveState : null;
  const previewSourceId = previewOriginPlanetId ?? previewRuntimeState?.currentPlanetId ?? null;
  const previewSource = previewSourceId ? previewRuntimeState?.planets[previewSourceId] : null;
  const previewCoordinate = previewDestination?.coordinate ?? launchContext?.destination?.coordinate ?? null;
  const previewFlightRecord = previewResult?.ok ? previewResult.flight : null;
  const arrivalAsteroidPreview = useMemo(() => {
    if (missionId !== 'gas' || !previewFlightRecord || !previewCoordinate) return null;
    return gasAsteroidPreviewAtArrival(
      previewRuntimeState?.asteroidSimulation,
      previewCoordinate,
      previewFlightRecord.arrivalAt,
    );
  }, [missionId, previewCoordinate, previewFlightRecord, previewRuntimeState?.asteroidSimulation]);
  const aidOptions = missionId === 'aid' && previewRuntimeState
    ? selectFulfillableRequests(previewRuntimeState.command, previewRuntimeState.profile.playerId)
    : [];
  const aidRequest = missionId === 'aid'
    ? selectRequestById(saveState.command, selectedAidRequestId ?? launchContext?.aidRequestId ?? '')
    : null;
  const aidProgress = aidRequest && aidRequest.status === 'open' ? selectRequestProgress(saveState, aidRequest) : null;
  const aidRemainder = aidProgress?.remainder ?? 0;
  const transportSummary = previewRuntimeState && previewSourceId
    ? getTransportCargoSummary(previewRuntimeState, previewSourceId, selectedQuantities, transportCargoDraft, previewDestination ?? undefined, missionId === 'space-flight' ? 100 : 0)
    : null;
  const sourceResourcesForCargo = previewRuntimeState && previewSourceId
    ? getPlanetResources(previewRuntimeState, previewSourceId)
    : { metal: 0, minerals: 0, gas: 0 };
  const transportSourceResources = missionId === 'space-flight'
    ? { ...sourceResourcesForCargo, gas: Math.max(0, sourceResourcesForCargo.gas - 100) }
    : sourceResourcesForCargo;
  const transportSourceDebris = previewSource?.recycling.availableDebris ?? 0;
  const expeditionTargetOptions = previewRuntimeState
    ? selectExplorationTargets(previewRuntimeState, clockNow, ACTIVE_RUNTIME_MODE) : [];
  const currentExpeditionTarget = expeditionTargetOptions.find(item => item.id === selectedExplorationTargetKey)
    ?? (!selectedExplorationTargetKey && expeditionTargetOptions.length === 1 ? expeditionTargetOptions[0] : undefined);
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
  const pirateTargetOptions = previewRuntimeState && missionId === 'pirate-elimination'
    ? selectOwnedPirateTargets(previewRuntimeState, clockNow) : [];
  const currentPirateTarget = pirateTargetOptions.find((item) => item.contactCycleKey === selectedPirateTargetKey)
    ?? (!selectedPirateTargetKey && pirateTargetOptions.length === 1 ? pirateTargetOptions[0] : null);
  const previewTargetDestination = missionId === 'pirate-elimination'
    ? currentPirateTarget ? { kind: 'coordinate' as const, coordinate: currentPirateTarget.coordinate } : null
    : previewDestination ?? launchContext?.destination;
  const previewTargetPlanet = previewRuntimeState && previewTargetDestination?.kind === 'planet'
    ? previewRuntimeState.planets[previewTargetDestination.planetId] ?? previewRuntimeState.alliedPlanets?.[previewTargetDestination.planetId]
    : null;
  const isReadOnlyAllyTarget = (missionId === 'transport' || missionId === 'aid')
    && previewTargetRelation === 'ally'
    && previewTargetDestination?.kind === 'planet';
  const isReadOnlySpyTarget = missionId === 'espionage' && previewTargetDestination?.kind === 'planet';
  const isReadOnlyDeploymentTarget = missionId === 'deployment' && previewTargetDestination?.kind === 'planet';
  const isReadOnlyTarget = isReadOnlyAllyTarget || isReadOnlySpyTarget || isReadOnlyDeploymentTarget;
  const selectedTransportTargetId = previewDestination?.kind === 'planet' && previewTargetRelation === 'self'
    ? previewDestination.planetId
    : '';
  const targetIsLocallyValid = missionId === 'pirate-elimination' ? Boolean(currentPirateTarget) : coordinateDraftError(previewTargetDraft) === null;
  const previewErrorCode = previewResult && !previewResult.ok ? previewResult.error.code : null;
  const targetCheckIsDeferred = previewErrorCode === 'target-not-available' || previewErrorCode === 'target-is-origin';
  const expectedSpaceFlightShips = Object.fromEntries(Object.entries(selectedQuantities).filter(([, quantity]) => (quantity ?? 0) > 0));
  const expectedSpaceFlightCommanders = Object.fromEntries(Object.entries(selectedCommanders).filter(([, quantity]) => (quantity ?? 0) > 0));
  const expectedSpaceFlightDuration = scaleRuntimeDuration(oneWayDurationMinutes * 60_000, ACTIVE_RUNTIME_MODE, resolveTestTimeScale());
  const spaceFlightPreviewMatchesDraft = Boolean(previewResult?.ok
    && previewResult.flight.missionId === 'space-flight'
    && previewResult.flight.oneWayDurationMs === expectedSpaceFlightDuration
    && JSON.stringify(previewResult.flight.selectedShips) === JSON.stringify(expectedSpaceFlightShips)
    && JSON.stringify(previewResult.flight.selectedCommanders ?? {}) === JSON.stringify(expectedSpaceFlightCommanders)
    && JSON.stringify(previewResult.flight.cargo ?? emptyTransportCargo()) === JSON.stringify(transportSummary?.cargo ?? emptyTransportCargo()));
  const canDispatchPreview = missionId === 'space-flight'
    ? hasLaunchableComposition && spaceFlightPreviewMatchesDraft
    : missionId === 'espionage'
    ? targetIsLocallyValid && Boolean(previewResult?.ok) && selectedQuantities['spy-probe'] === 1
    : missionId === 'recycle'
      ? targetIsLocallyValid && previewResult?.ok === true && previewResult.flight.missionId === 'recycle'
        && previewSubmittedTargetKind !== null
        && previewResult.flight.selectedShips.recycler === (selectedQuantities.recycler ?? 0)
        && (selectedQuantities.recycler ?? 0) > 0
      : missionId === 'gas'
        ? targetIsLocallyValid && previewResult?.ok === true && previewResult.flight.missionId === 'gas'
          && previewResult.flight.selectedShips.recycler === (selectedQuantities.recycler ?? 0)
          && (selectedQuantities.recycler ?? 0) > 0
      : missionId === 'pirate-elimination'
      ? targetIsLocallyValid && previewResult?.ok === true && selectedShipCount > 0
      : missionId === 'attack'
      ? targetIsLocallyValid && (!previewResult || previewResult.ok) && selectedShipCount > 0 && previewTargetRelation !== 'ally' && previewTargetRelation !== 'self'
    : missionId === 'aid'
    ? Boolean(aidRequest && aidProgress) && previewResult?.ok === true && previewResult.flight.missionId === 'aid'
      && (aidRequest ? (transportSummary?.cargo[aidRequest.resource] ?? 0) > 0 : false)
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
        ) : selectedSection === 'repair' ? (
          // The Repair Workshop is portaled into this container by RepairWorkshopPortal;
          // the fleet root must not render underneath it.
          null
        ) : (
          <>
            <div className={`fleet-root-v2${hostileIncomingFlights.length ? ' has-incoming' : ''}`} data-qa-fleet-root>
            {hostileIncomingFlights.length ? <div className="fleet-incoming-alert-v2" role="alert" data-qa-fleet-incoming-alert>
              <b aria-hidden="true">⚠</b>
              <div><strong>{hostileIncomingFlights.length > 1 ? `ВХОДЯЩИЕ АТАКИ · ${hostileIncomingFlights.length}` : 'ВХОДЯЩАЯ АТАКА'}</strong><span>{hostileIncomingFlights[0].originLabel} → {flightCoordinateLabel(hostileIncomingFlights[0].flight.destinationCoordinate)} · прибытие через {flightCountdown(hostileIncomingFlights[0].flight.arrivalAt, clockNow)}</span></div>
              <button type="button" onClick={() => setFlightsOpen(true)}>ПОКАЗАТЬ РЕЙС</button>
            </div> : null}
            <section className="fleet-panel-v1 fleet-flights-v1 fleet-flights-v2">
              <small className="fleet-flights-v2__label">В ПУТИ · {activeFlightRecords.length}</small>
              {activeFlightRecords.length === 0 ? <span className="fleet-flights-v2__empty">Флотов в пути нет</span> : null}
              {ownFlightGroups.map((group) => <span className="fleet-flights-v2__count" key={group.missionId} title={flightMissionLabel(group.missionId)}><img src={flightMissionIcon(group.missionId)} alt="" />{flightMissionLabel(group.missionId)}<b>{group.count}</b></span>)}
              {nextFlightEvent ? <span className="fleet-flights-v2__next"><small>БЛИЖАЙШЕЕ СОБЫТИЕ</small><strong>{nextFlightEvent.label} · {flightCountdown(nextFlightEvent.at, clockNow)}</strong></span> : null}
              <span className="fleet-flights-v2__spacer" />
              <button type="button" onClick={() => setSpyOperationsOpen(true)} aria-haspopup="dialog">ШПИОНСКИЕ ОТЧЁТЫ</button>
              <button type="button" className={flightsOpen ? 'is-on' : ''} aria-expanded={flightsOpen} onClick={() => setFlightsOpen((open) => !open)} data-qa-flights-toggle>{flightsOpen ? 'СВЕРНУТЬ ▴' : `ВСЕ РЕЙСЫ · ${activeFlightRecords.length} ▾`}</button>
            </section>
            <div className={`fleet-flights-drop-v2${flightsOpen ? ' is-open' : ''}`} data-qa-flights-drop>
            <div className="fleet-flights-drop-v2__panel">
              <div className="fleet-flight-table-v1">
                <div className="fleet-flight-row-v1 fleet-flight-head-v1">
                  <span>ОТКУДА</span><span>ЦЕЛЬ</span><span>ПРИБЫТИЕ</span><span>СТАТУС</span><span>ВОЗВРАТ</span><span>МИССИЯ · ПОРЯДОК</span><span>ДЕЙСТВИЯ</span>
                </div>
                {activeFlightRecords.length === 0 ? <div className="fleet-flight-empty-v1" data-qa-flight-empty>
                  <strong>Активных полётов нет</strong>
                  <span>Флоты, находящиеся в пути, будут отображаться здесь.</span>
                </div> : activeFlightRecords.map((flight) => {
                  const isIncomingBotAttack = flight.ownerSide === 'bot01' && flight.missionId === 'attack';
                  const isBot01Explorer = (flight.ownerSide === 'bot01' || flight.ownerSide === 'npc') && (flight.missionId === 'expedition'||flight.explorationAttack);
                  const isIncomingPirateRaid = flight.ownerSide === 'pirate' && flight.missionId === 'pirate-raid';
                  const isHostileIncoming = isIncomingBotAttack || isIncomingPirateRaid || isBot01Explorer;
                  const pirateComposition = isIncomingPirateRaid ? Object.entries(flight.pirateRaidSnapshot?.composition ?? {})
                    .filter(([id, count]) => count > 0 && id in PIRATE_CATALOG_BY_ID)
                    .map(([id,count]) => `${PIRATE_CATALOG_BY_ID[id as PirateBaseShipId].name} ×${flightNumberLabel(count)}`)
                    .join(' · ') : '';
                  const piratePopulation = isIncomingPirateRaid
                    ? Object.entries(flight.pirateRaidSnapshot?.composition ?? {}).reduce((population,[id,count]) =>
                      population + (PIRATE_CATALOG_BY_ID[id as PirateBaseShipId]?.population ?? 0) * count,0)
                    : 0;
                  const liveTransportState = getActiveTransportState(flight);
                  const targetUnavailable = flight.completionReason === 'target-unavailable' || liveTransportState.targetUnavailable;
                  const statusLabel = isBot01Explorer ? (flight.phase === 'outbound' ? 'NPC · К ОБЪЕКТУ' : flight.phase === 'arrived' ? 'ЗАНЯТО NPC' : 'NPC · ВОЗВРАЩАЕТСЯ') : (flight.missionId === 'expedition' || flight.explorationAttack) && flight.phase === 'arrived' ? '⛏ ДОБЫВАЕТ РЕСУРСЫ' : targetUnavailable
                    ? 'ЦЕЛЬ НЕДОСТУПНА'
                    : isHostileIncoming && flight.phase === 'outbound'
                      ? '⚠ ВХОДЯЩАЯ АТАКА'
                    : flight.phase === 'outbound'
                      ? 'В ПУТИ'
                      : flight.phase === 'returning'
                        ? 'ВОЗВРАЩАЕТСЯ'
                        : 'ПРИБЫЛ';
                  const attackOrder = attackOrderByFlightId.get(flight.id);
                  return <div className={`fleet-flight-row-v1${isHostileIncoming ? ' fleet-flight-row-v1--incoming-attack' : ''}`} key={flight.id} data-qa-flight-row={flight.id} data-qa-flight-phase={flight.phase} data-qa-flight-owner-side={flight.ownerSide ?? 'player'} data-qa-flight-incoming-attack={isHostileIncoming || undefined} data-qa-flight-pirate-raid={isIncomingPirateRaid || undefined}>
                  <span data-qa-flight-origin>{flight.ownerSide === 'npc' && flight.missionId === 'aid' ? <><strong>СОЮЗНИК</strong><small>помощь по запросу</small></> : isIncomingBotAttack ? <><strong>Bot 01</strong><CoordinateLink coordinate={flight.originCoordinate} /></> : isIncomingPirateRaid ? <><strong>ПИРАТЫ · ИСТОЧНИК</strong><CoordinateLink coordinate={flight.originCoordinate} /></> : <CoordinateLink coordinate={flight.originCoordinate} />}</span>
                  <span data-qa-flight-target><strong data-qa-space-flight-targetless={flight.missionId === 'space-flight' || undefined}>{flight.missionId === 'space-flight' ? 'Без планетарной цели' : flight.targetPlanetName ?? <CoordinateLink coordinate={flight.destinationCoordinate} />}</strong>{flight.missionId !== 'space-flight' && flight.targetPlanetName && flight.destinationCoordinate ? <CoordinateLink coordinate={flight.destinationCoordinate} /> : null}{flight.targetOwnerName ? <small>{flight.targetOwnerName}</small> : null}{flight.targetRelation === 'ally' ? '· СОЮЗНИК' : flight.targetRelation === 'self' ? '· СВОЯ' : ''}{targetUnavailable ? <b data-qa-flight-target-unavailable> · ЦЕЛЬ НЕДОСТУПНА</b> : null}</span>
                  <span data-qa-flight-arrival data-qa-flight-arrival-at={flight.arrivalAt}>{flight.phase === 'outbound' ? flightCountdown(flight.arrivalAt, clockNow) : '—'}</span>
                  <span data-qa-flight-status>{statusLabel}</span>
                  <span data-qa-flight-return>{flight.phase === 'returning' ? flightCountdown(flight.returnAt, clockNow) : '—'}</span>
                  <span><img className="fleet-flight-mission-icon" src={flightMissionIcon(flight.missionId)} alt="" />{(flight.ownerSide !== 'bot01' && flight.ownerSide !== 'npc' && (flight.missionId === 'expedition' || flight.explorationAttack)) ? <button type="button" className="fleet-expedition-details-trigger" onClick={() => setSelectedExpeditionFlightId(flight.id)} data-qa-expedition-flight-details={flight.id}>ЭКСПЕДИЦИЯ · ПОДРОБНЕЕ ↗</button> : flight.explorationAttack ? 'БОЕВОЙ ЗАХВАТ · ЭКСПЕДИЦИЯ' : flightMissionLabel(flight.missionId)}{isIncomingPirateRaid ? <small data-qa-pirate-raid-force title={pirateComposition || 'Состав неизвестен'}> · УГРОЗА {flightNumberLabel(piratePopulation)} НАС. · {pirateComposition || 'СОСТАВ НЕИЗВЕСТЕН'}</small> : null}{isIncomingBotAttack ? <small data-qa-flight-bot01-label> · BOT 01</small> : isBot01Explorer ? <small> · NPC</small> : null}{attackOrder && !isHostileIncoming ? <small data-qa-flight-attack-order> · АТАКА #{attackOrder}</small> : null}{liveTransportState.overflowWarning ? <b className="fleet-flight-overflow-warning" aria-label="Часть груза может сгореть: склады цели заполнены" data-qa-flight-overflow-warning>!</b> : null}</span>
                  <span>{isHostileIncoming || (flight.ownerSide === 'npc' && flight.missionId === 'aid') ? <span aria-label="Чужой флот нельзя отозвать" data-qa-flight-no-recall>—</span> : <button type="button" data-qa-flight-recall={flight.id} disabled={flight.phase !== 'outbound' && !((flight.missionId === 'expedition' || flight.explorationAttack) && flight.phase === 'arrived')} onClick={() => setPendingRecall(flight)}>ОТОЗВАТЬ</button>}</span>
                </div>;
                })}
              </div>

              <div className="fleet-flight-actions-v1">
                                {ACTIVE_RUNTIME_MODE === 'test' ? <button
                  type="button"
                  data-qa-bot01-scenario
                  disabled={Boolean(espionageState.bot01IncomingScenario)}
                  onClick={() => window.dispatchEvent(new CustomEvent(BOT01_INCOMING_SCENARIO_REQUEST_EVENT, { detail: { now: Date.now() } }))}
                >{espionageState.bot01IncomingScenario ? 'СЦЕНАРИЙ BOT 01 УЖЕ ЗАПУЩЕН' : 'ЗАПУСТИТЬ АТАКУ BOT 01'}</button> : null}
                {ACTIVE_RUNTIME_MODE === 'test' ? <button type="button"
                  data-qa-bot01-exploration-scenario
                  onClick={() => window.dispatchEvent(new CustomEvent(BOT01_EXPLORATION_SCENARIO_REQUEST_EVENT,{detail:{now:Date.now()}}))}
                  title="Выбрать действующий свободный объект и направить туда реальный флот Bot 01"
                >BOT 01 · ЗАХВАТИТЬ ОБЪЕКТ (ТЕСТ)</button> : null}
              </div>
            </div>
            </div>

            <div className="fleet-root-v2__row">
            <section className="fleet-panel-v1 fleet-compose-v1 fleet-compose-v2">
              <header className="fleet-panel-header-v1 compact">
                <div><small>ФОРМИРОВАНИЕ · ФЛОТ {fleetSummary.population} / {fleetSummary.capacity}</small><h2>ВЫБЕРИТЕ КОРАБЛИ</h2></div>
                <div className="fleet-ship-filter-v2" role="group" aria-label="Фильтр кораблей">
                  {(['all', 'combat', 'civil'] as const).map((filter) => <button key={filter} type="button" className={shipFilter === filter ? 'is-on' : ''} aria-pressed={shipFilter === filter} onClick={() => setShipFilter(filter)}>{filter === 'all' ? 'ВСЕ' : filter === 'combat' ? 'БОЕВЫЕ' : 'ГРАЖДАНСКИЕ'}</button>)}
                </div>
              </header>
              <span className="fleet-compose-v2__meta" data-qa-fleet-population>ФЛОТ: {fleetSummary.population} / {fleetSummary.capacity} · В НАЛИЧИИ {availableShipCount} КОРАБЛЯ · СПУТНИКИ {fleetSnapshot.solarSatellites}</span>

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

              <div className="fleet-ship-roster-v1 fleet-ship-grid-v2" data-qa-fleet-roster>
                {visibleShipDefinitions.filter((ship) => shipFilter === 'all' || (shipFilter === 'civil') === CIVIL_SHIP_IDS.has(ship.id)).map((ship) => {
                  const available = fleetSnapshot.fleet.ships[ship.id] ?? 0;
                  const selected = selectedQuantities[ship.id] ?? 0;
                  return (
                    <div className={`fleet-ship-line-v1 fleet-ship-tile-v2${selected > 0 ? ' is-selected' : ''}`} key={ship.id} data-qa-fleet-ship={ship.id}>
                      <div className="fleet-ship-art-v1"><img src={ship.art} alt={ship.name} draggable={false} /></div>
                      <h3>{ship.name}</h3>
                      <small>в наличии <b data-qa-fleet-owned>{available}</b> · нас. <b data-qa-fleet-unit-population>{ship.population}</b></small>
                      <input className="fleet-ship-tile-v2__input" aria-label={`Количество ${ship.name}`} type="number" min="0" max={available} value={selected} onChange={(event) => setShipQuantity(ship.id, Number(event.target.value))} />
                      <AmountSlider compact value={selected} max={available} label={`Количество: ${ship.name}`} onChange={(value) => setShipQuantity(ship.id, value)} qa={ship.id} />
                      <div className="fleet-quantity-shortcuts-v1">
                        <button type="button" onClick={() => setShipQuantity(ship.id, 0)}>МИН.</button>
                        <button type="button" onClick={() => setShipQuantity(ship.id, available)}>МАКС.</button>
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
            </section>

            <section className="fleet-panel-v1 fleet-order-v2">
              <div className="fleet-mission-picker-v1">
                <div className="fleet-mission-select-v1">
                  <label htmlFor="fleet-mission">МИССИЯ</label>
                  <select id="fleet-mission" value={missionId} onChange={(event) => chooseMission(event.target.value as MissionId)}>
                    {missions.map((mission) => <option key={mission.id} value={mission.id} disabled={mission.enabled === false}>{mission.label}</option>)}
                  </select>
                </div>

                <div className="fleet-mission-icons-v1" aria-label="Выбор миссии">
                  {missions.map((mission) => (
                    <button
                      key={mission.id}
                      type="button"
                      className={mission.id === missionId ? 'active' : ''}
                      aria-label={mission.label}
                      title={mission.enabled === false ? `${mission.label} — пока недоступно` : mission.label}
                      disabled={mission.enabled === false}
                      data-qa-mission-id={mission.id}
                      onMouseEnter={() => setHoveredMissionId(mission.id)}
                      onMouseLeave={() => setHoveredMissionId(null)}
                      onFocus={() => setHoveredMissionId(mission.id)}
                      onBlur={() => setHoveredMissionId(null)}
                      onClick={() => {
                        // Sun missions live in «Командование → Операции» (population cap, side, alerts).
                        if (mission.id === 'sun-support') { window.dispatchEvent(new Event(OPEN_SUN_OPERATIONS_EVENT)); return; }
                        chooseMission(mission.id);
                      }}
                    >
                      <MissionIcon mission={mission} />
                      <span>{mission.label}</span>
                    </button>
                  ))}
                </div>
                <p className="fleet-mission-description-v1"><strong>{describedMission.label}.</strong> {describedMission.description}</p>
              </div>

              <div className="fleet-order-v2__summary">
                <div><small>КОРАБЛЕЙ</small><b>{selectedShipCount}</b></div>
                <div><small>НАСЕЛЕНИЕ</small><b>{selectedPopulation}</b></div>
                <div><small>ФЛОТ</small><b>{fleetSummary.population} / {fleetSummary.capacity}</b></div>
              </div>

              {missionId === 'attack' || missionId === 'pirate-elimination' || missionId === 'deployment' || missionId === 'space-flight' ? <section className={`fleet-attack-prep-v1${missionId === 'space-flight' ? ' fleet-space-flight-prep-v1' : ''}`} data-qa-attack-prep={missionId === 'attack' || missionId === 'pirate-elimination' ? true : undefined} data-qa-deployment-commanders={missionId === 'deployment' ? true : undefined} data-qa-space-flight-prep={missionId === 'space-flight' ? true : undefined}>
                {missionId === 'attack' || missionId === 'pirate-elimination' ? <div className="fleet-attack-rounds-v1">
                  <div><small>ЛИМИТ РАУНДОВ</small><span>Разрешены только боевые профили 5 / 8 / 12.</span></div>
                  <select value={attackRounds} onChange={(event) => setAttackRounds(Number(event.target.value) as SimulatorMaxRounds)} data-qa-attack-rounds aria-label="Лимит раундов атаки">
                    {[5, 8, 12].map((rounds) => <option key={rounds} value={rounds}>{rounds} раундов</option>)}
                  </select>
                </div> : null}
                {missionId === 'space-flight' ? <label className="fleet-space-flight-duration-v1" data-qa-space-flight-duration>
                  <span><small>ОДИН УЧАСТОК ПУТИ</small><em>Без координатной цели; обратный путь равен выбранному времени.</em></span>
                  <input type="number" min="5" max="719" step="1" value={oneWayDurationMinutes} aria-label="Длительность космического рейса в одну сторону, минуты" onChange={(event) => {
                    if (event.currentTarget.value === '') return;
                    const value = Number(event.currentTarget.value);
                    if (Number.isFinite(value)) setOneWayDurationMinutes(Math.max(5, Math.min(719, Math.floor(value))));
                  }} />
                  <strong>мин</strong>
                </label> : null}
                <div className="fleet-attack-commanders-v1">
                  <div className="fleet-attack-commanders-head"><div><small>КОМАНДИРЫ</small><span>{missionId === 'deployment' ? 'Командиры сохраняют уровень и способность при переводе.' : missionId === 'space-flight' ? 'Можно отправить только командирские корабли; спутники и оборона остаются на планете.' : 'Свободные командиры резервируются вместе с флотом.'}</span></div><b>{selectedCommanderCount} выбрано</b></div>
                  {Object.keys(commanderAvailability).length ? <div className="fleet-attack-commanders-list">
                    {COMMANDER_IDS.filter((commanderId) => (commanderAvailability[commanderId] ?? 0) > 0).map((commanderId) => {
                      const commander = getCommanderPresentedAbility(commanderId);
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
                <button type="button" data-qa-flight-preview-open disabled={!hasLaunchableComposition} onClick={openFlightPreview}>ПРОДОЛЖИТЬ · ПЛАН ПЕРЕЛЁТА</button>
              </footer>
            </section>
            </div>
            </div>
          </>
        )}
      </main>

      {selectedExpeditionFlightId && (() => {
        const flight = flightRecords.find(item => item.id === selectedExpeditionFlightId);
        if (!flight) return null;
        const runtime = saveState;
        const rawContact = flight.operationId ? runtime.exploration?.contacts[flight.operationId] : undefined;
        const contact = rawContact ? reconcileExplorationContact(rawContact, clockNow) : undefined;
        const claim = contact?.claim?.flightId === flight.id ? contact.claim : undefined;
        const release = contact?.events.find(e => e.id === flight.id + ':release');
        const profile = contact ? explorationProfile(contact.kind, contact.variant) : null;
        const capacity = claim?.cargoCapacity ?? expeditionMiningCapacity(runtime, flight).all;
        const cargo = claim?.cargo ?? release?.cargo ?? { metal: 0, minerals: 0, gas: 0, debris: 0 };
        const rates = claim && profile
          ? explorationMiningRates(claim.resourcePointsLaunch, profile, claim.capacity, claim.catchupMultiplier, Boolean(claim.boostedUntilAt && claim.boostedUntilAt > clockNow))
          : { metal: 0, minerals: 0, gas: 0, debris: 0 };
        const carried = Object.values(cargo).reduce((sum, v) => sum + v, 0);
        const labels = { metal: 'Металл', minerals: 'Минералы', gas: 'Газ', debris: 'Обломки' } as const;
        return createPortal(<div className="resource-building-action-confirm-backdrop" data-qa-expedition-details-backdrop onMouseDown={() => setSelectedExpeditionFlightId(null)}>
          <section className="resource-building-action-confirm fleet-expedition-details" role="dialog" aria-modal="true" aria-label="Подробности экспедиции" data-qa-expedition-details-dialog onMouseDown={e => e.stopPropagation()}>
            <header><div><small>АКТИВНЫЙ РЕЙС · ЭКСПЕДИЦИЯ</small><h3>{flight.targetPlanetName ?? profile?.name ?? 'Космический объект'}</h3><span>{flightCoordinateLabel(flight.destinationCoordinate)}</span></div><button type="button" aria-label="Закрыть подробности экспедиции" onClick={() => setSelectedExpeditionFlightId(null)}>×</button></header>
            <div className="fleet-expedition-status">
              <span>{flight.phase === 'outbound' ? 'В ПУТИ К ОБЪЕКТУ' : flight.phase === 'arrived' ? 'ДОБЫВАЕТ РЕСУРСЫ' : 'ВОЗВРАЩАЕТСЯ'}</span>
              <strong>{flight.phase === 'outbound' ? flightCountdown(flight.arrivalAt, clockNow) : flight.phase === 'returning' ? flightCountdown(flight.returnAt, clockNow) : 'НА ОРБИТЕ'}</strong>
            </div>
            <div className="fleet-expedition-metrics">
              <div><small>ВМЕСТИМОСТЬ ТРЮМА</small><strong>{flightNumberLabel(capacity)}</strong></div>
              <div><small>УЖЕ ДОБЫТО</small><strong>{flightNumberLabel(carried)}</strong></div>
              <div><small>НА ОБЪЕКТЕ ДО</small><strong>{contact ? new Date(contact.expiresAt).toLocaleTimeString('ru-RU') : '—'}</strong></div>
            </div>
            <div className="fleet-expedition-fill"><span style={{width: Math.min(100, carried / Math.max(1, capacity) * 100) + '%'}} /></div>
            <div className="fleet-expedition-resources">{(['metal','minerals','gas','debris'] as const).map(key =>
              <div key={key}><ResourceIcon kind={key} /><span><b>{labels[key]}</b><small>Добыто: {flightNumberLabel(cargo[key])}</small></span><strong>{flightNumberLabel(rates[key])} / мин</strong></div>)}</div>
            <p>{claim?.capacity.recyclers === 0 ? 'В составе нет переработчиков — обломки не добываются. ' : ''}
              {claim?.capacity.transporters === 0 ? 'В составе нет транспортёров — добыча металла, минералов и газа ограничена. ' : ''}
              Итоговая добыча зависит от доступных запасов и свободного трюма. Весь груз поступит на планету отправления после возвращения.
            </p>
            <div className="fleet-expedition-composition"><strong>ФЛОТ</strong><span>{Object.entries(flight.selectedShips).filter(([,n])=>Boolean(n)).map(([id,n])=>(shipDefinitions.find(ship=>ship.id === id)?.name ?? id) + ' ×' + flightNumberLabel(n ?? 0)).join(' · ')}</span></div>
            <button type="button" className="fleet-expedition-close" onClick={() => setSelectedExpeditionFlightId(null)}>ЗАКРЫТЬ</button>
          </section>
        </div>,document.body);
      })()}
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
          <section className="resource-building-action-confirm flight-preview-modal flight-timeline-modal flight-briefing-v2" role="dialog" aria-modal="true" aria-labelledby="flight-preview-title" onMouseDown={(event) => event.stopPropagation()}>
            <header className="flight-timeline-head">
              <div>
                <small>ПЛАН ПЕРЕЛЁТА · {selectedMission.label.toUpperCase()}</small>
                <h3 id="flight-preview-title">ПЛАН ПЕРЕЛЁТА</h3>
                <p>Последовательность подготовки: источник → цель → состав флота → подтверждение.</p>
              </div>
              <button type="button" className="flight-timeline-close" data-asterion-close aria-label="Закрыть план перелёта" onClick={closeFlightPreview}>×</button>
              </header>
            <div className="flight-timeline-body">
              <div className="flight-briefing-v2__left">
              <section className="flight-briefing-v2__hero" aria-label="Миссия">
                <MissionIcon mission={selectedMission} />
                <div>
                  <small>МИССИЯ</small>
                  <strong>{selectedMission.label}</strong>
                  <p>{selectedMission.description}</p>
                </div>
              </section>
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
                    {missionId === 'space-flight' ? <div className="flight-timeline-space-flight-target" data-qa-space-flight-targetless>
                      <span>БЕЗ КООРДИНАТНОЙ ЦЕЛИ</span>
                      <strong>Автоматический возврат на {previewSource?.name ?? planetName}</strong>
                    </div> : <>
                    {missionId === 'expedition' ? <label className="flight-timeline-own-target" data-qa-expedition-target-select>
                      <span>УНИКАЛЬНЫЙ ОБЪЕКТ / АНОМАЛИЯ · ±5 СИСТЕМ</span>
                      <select aria-label="Выберите объект экспедиции" value={currentExpeditionTarget?.id ?? ''} onChange={(event) => selectExpeditionTarget(event.target.value)}>
                        <option value="">Выберите объект экспедиции</option>
                        {expeditionTargetOptions.map(target => {
                          const status = explorationTargetStatus(previewRuntimeState!, target);
                          const c = target.coordinate;
                          return <option key={target.id} value={target.id} disabled={status !== 'free'}>
                            {status === 'free' ? '' : '🔒 '}{target.name} · [{c.galaxy}:{c.system}:{c.position}]
                            {status === 'self' ? ' · ваш флот добывает' : status === 'occupied' ? ' · занято, доступна атака' : ''}
                          </option>;
                        })}
                      </select>
                      {expeditionTargetOptions.length === 0 ? <small>В радиусе пяти систем от колоний сейчас нет активных объектов.</small> : null}
                      <small className="fleet-expedition-mining-warning">
                        Для обломков нужны переработчики. Транспортёры добывают металл, минералы и газ, но не обломки.
                        Узнать состав и остаток запаса можно по успешному исследованию в «Операциях» → «Система».
                        После разведки отправка заведомо неэффективного флота блокируется.
                      </small>
                    </label> : missionId === 'pirate-elimination' ? <label className="flight-timeline-own-target" data-qa-pirate-target-select><span>ВЫБЕРИТЕ ПИРАТОВ</span><select value={currentPirateTarget?.contactCycleKey ?? ''} onChange={(event) => selectPirateTarget(event.target.value)} aria-label="Выберите пиратскую базу"><option value="">Выберите пиратов</option>{pirateTargetOptions.map((target) => <option key={target.contactCycleKey} value={target.contactCycleKey}>{`Пиратская база [${target.coordinate.galaxy}:${target.coordinate.system}:${target.coordinate.position}]`}</option>)}</select>{pirateTargetOptions.length === 0 ? <small>В солнечных системах ваших планет сейчас нет доступных пиратских контактов.</small> : null}</label> : missionId === 'aid' ? <div className="flight-timeline-own-target" data-qa-aid-target>
                      <label>
                        <span>ОТКРЫТЫЙ ЗАПРОС СОЮЗНИКА</span>
                        <select aria-label="Выберите запрос союзника" value={aidRequest?.status === 'open' ? aidRequest.id : ''} onChange={(event) => selectAidRequest(event.target.value)} data-qa-aid-request-select>
                          <option value="">Выберите запрос</option>
                          {aidOptions.map((request) => {
                            const progress = selectRequestProgress(previewRuntimeState!, request);
                            return <option key={request.id} value={request.id} disabled={progress.remainder <= 0}>{`${request.authorName} · ${request.planetName} · ${AID_RESOURCE_LABELS[request.resource]} · осталось ${flightNumberLabel(progress.remainder)}`}</option>;
                          })}
                        </select>
                      </label>
                      {aidOptions.length === 0 ? <small>В вашем союзе сейчас нет открытых запросов, которые вы можете выполнить.</small> : null}
                      {aidRequest && aidProgress ? <small data-qa-aid-request-summary>{`${aidRequest.planetName} ${flightCoordinateLabel(aidRequest.coordinate)} · запрошено ${flightNumberLabel(aidProgress.requested)} · доставлено ${flightNumberLabel(aidProgress.delivered)} · в пути ${flightNumberLabel(aidProgress.inFlight)} · можно отправить до ${flightNumberLabel(aidProgress.remainder)}`}</small> : null}
                    </div> : missionId === 'transport' && isReadOnlyAllyTarget ? <div className="flight-timeline-readonly-target" data-qa-transport-target-readonly>
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
                    {missionId === 'expedition' ? <strong>{currentExpeditionTarget ? flightCoordinateLabel(currentExpeditionTarget.coordinate) : 'Цель не выбрана'}</strong> : missionId === 'pirate-elimination' ? <strong>{currentPirateTarget ? flightCoordinateLabel(currentPirateTarget.coordinate) : 'Цель не выбрана'}</strong> : missionId === 'aid' ? null : missionId !== 'deployment' && !isReadOnlyTarget && editingPreviewTarget ? <div className="flight-timeline-coordinate-inputs" data-qa-flight-target-inputs>
                      <label><span>ГАЛ.</span><input name="flight-preview-target-galaxy" inputMode="numeric" value={previewTargetDraft.galaxy} onInput={(event) => changePreviewTargetField('galaxy', event.currentTarget.value)} onChange={(event) => changePreviewTargetField('galaxy', event.currentTarget.value)} aria-label="Галактика цели" /></label>
                      <label><span>СИСТ.</span><input name="flight-preview-target-system" inputMode="numeric" value={previewTargetDraft.system} onInput={(event) => changePreviewTargetField('system', event.currentTarget.value)} onChange={(event) => changePreviewTargetField('system', event.currentTarget.value)} aria-label="Система цели" /></label>
                      <label><span>ПОЗ.</span><input name="flight-preview-target-position" inputMode="numeric" value={previewTargetDraft.position} onInput={(event) => changePreviewTargetField('position', event.currentTarget.value)} onChange={(event) => changePreviewTargetField('position', event.currentTarget.value)} aria-label="Позиция цели" /></label>
                    </div> : !isReadOnlyTarget && missionId !== 'deployment' ? <strong>{previewTargetLabel}</strong> : isReadOnlySpyTarget ? <strong>{launchContext?.targetPlanetName ?? previewTargetLabel}</strong> : null}
                    <div className={`flight-timeline-target-status ${previewTargetError ? 'is-invalid' : 'is-valid'}`} data-qa-flight-target-status>
                      <span data-qa-target-relation={previewTargetRelation}>{previewTargetError ?? (missionId === 'expedition' && !currentExpeditionTarget ? 'Выберите свободный объект' : missionId === 'pirate-elimination' && !currentPirateTarget ? 'Выберите действующий пиратский контакт' : missionId === 'deployment' && !previewTargetDestination ? 'Выберите свою планету' : missionId === 'recycle' && previewResult && !previewResult.ok ? previewResult.error.message : previewTargetRelation === 'ally' ? 'Союзная планета' : previewTargetRelation === 'self' ? 'Своя планета' : previewResult?.ok ? 'Цель подтверждена' : 'Координаты будут проверены при отправке')}</span>
                      {!isReadOnlyTarget && missionId !== 'deployment' && missionId !== 'aid' && missionId !== 'pirate-elimination' && missionId !== 'expedition' ? <button type="button" className="flight-timeline-edit" onClick={togglePreviewTargetEditing}>{editingPreviewTarget ? missionId === 'recycle' ? 'ПРОВЕРИТЬ' : 'ГОТОВО' : 'ИЗМЕНИТЬ'}</button> : null}
                    </div>
                    </>}
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
              </div>
              <div className="flight-briefing-v2__right">
              <section className="flight-timeline-summary" aria-live="polite">
                <div className="flight-timeline-summary-head">
                  <small>ПАРАМЕТРЫ ПЕРЕЛЁТА</small>
                  <span>{missionId === 'space-flight' ? 'ДЛИТЕЛЬНОСТЬ ЗАДАНА ВРУЧНУЮ' : 'ПРОВЕРКА ЦЕЛИ ПРИ ОТПРАВКЕ'}</span>
                </div>
                {missionId === 'gas' && gasPreviewNeedsReconfirmation ? <div className="flight-timeline-notes"><p role="status" className="flight-timeline-note-warning" data-qa-gas-preview-reconfirmation>Прогноз обновлён. Проверьте ETA и положение астероида, затем подтвердите отправку ещё раз.</p></div> : null}
                {previewResult?.ok ? <>
                  <div className="flight-briefing-v2__axis" aria-hidden="true">
                    <i />
                    <span style={{ left: '8%' }}><b />ВЫЛЕТ · <em>сейчас</em></span>
                    <span style={{ left: '50%' }}><b />{missionId === 'space-flight' ? 'РАЗВОРОТ' : 'ПРИБЫТИЕ'} · <em>через {flightDurationLabel(previewResult.flight.oneWayDurationMs)}</em></span>
                    <span style={{ left: '90%' }}><b />{missionId === 'deployment' || missionId === 'colonize' ? 'БЕЗ ВОЗВРАТА' : <>ВОЗВРАТ · <em>через {flightDurationLabel(previewResult.flight.oneWayDurationMs * 2)}</em></>}</span>
                  </div>
                  <div className="flight-timeline-metrics" data-qa-flight-preview data-qa-flight-preview-departed-at={previewResult.flight.departedAt} data-qa-flight-preview-arrival-at={previewResult.flight.arrivalAt} data-qa-flight-preview-speed={previewResult.flight.effectiveSpeed} data-qa-flight-preview-duration={previewResult.flight.oneWayDurationMs}>
                    <div><small>{missionId === 'space-flight' ? 'ЦЕЛЬ' : 'РАССТОЯНИЕ'}</small><strong>{missionId === 'space-flight' ? 'нет' : `${flightNumberLabel(previewResult.flight.routeDistance)} ед.`}</strong></div>
                    <div><small>{missionId === 'space-flight' ? 'СКОРОСТЬ' : 'ЭФФ. СКОРОСТЬ'}</small><strong>{missionId === 'space-flight' ? 'не применяется' : flightNumberLabel(previewResult.flight.effectiveSpeed)}</strong></div>
                    <div><small>ТУДА</small><strong>{flightDurationLabel(previewResult.flight.oneWayDurationMs)}</strong></div>
                    <div><small>ОБРАТНО</small><strong>{flightDurationLabel(previewResult.flight.oneWayDurationMs)}</strong></div>
                    <div><small>ПОЛНЫЙ ЦИКЛ</small><strong>{flightDurationLabel(previewResult.flight.oneWayDurationMs * 2)}</strong></div>
                    <div><small>ГАЗ</small><strong>{previewResult.flight.gasCost}</strong></div>
                    <div data-qa-flight-metric="population"><small>НАСЕЛЕНИЕ</small><strong>{flightNumberLabel(selectedPopulation)}</strong></div>
                    {(missionId === 'transport' || missionId === 'space-flight' || missionId === 'aid') && transportSummary ? <div data-qa-flight-metric="cargo-capacity"><small>ГРУЗ</small><strong>{flightNumberLabel(transportSummary.capacity.used)} / {flightNumberLabel(transportSummary.capacity.total)}</strong></div> : null}
                  </div>
                  <section className="flight-timeline-eta" data-qa-flight-eta aria-label="Расписание рейса">
                    <div className="flight-timeline-eta-card is-arrival">
                      <small>{missionId === 'space-flight' ? 'ТОЧКА РАЗВОРОТА' : 'ПРИБЫТИЕ'}</small>
                      <strong>через {missionId === 'gas' ? flightDurationLabel(previewResult.flight.oneWayDurationMs) : flightCountdown(previewResult.flight.arrivalAt, clockNow)}</strong>
                      <span>{flightArrivalLabel(previewResult.flight.arrivalAt)} МСК</span>
                      <em>{missionId === 'space-flight' ? 'начало обратного участка' : missionId === 'aid' ? 'зачисление принятого груза на планету запроса' : missionId === 'recycle' ? 'сбор обломков с орбиты' : missionId === 'gas' ? 'проверка позиции астероида' : 'проверка цели и создание планеты'}</em>
                    </div>
                    <div className="flight-timeline-eta-card is-return">
                      <small>{missionId === 'space-flight' ? 'ВОЗВРАТ БЕЗ ОТЗЫВА' : 'ВОЗВРАТ ПРИ ОТЗЫВЕ'}</small>
                      <strong>{missionId === 'space-flight' ? `через ${flightDurationLabel(previewResult.flight.oneWayDurationMs)} после разворота` : `через ${flightDurationLabel(previewResult.flight.oneWayDurationMs)} после отзыва`}</strong>
                      <span>{missionId === 'space-flight' ? flightArrivalLabel(previewResult.flight.arrivalAt + previewResult.flight.oneWayDurationMs) : `${flightArrivalLabel(clockNow + previewResult.flight.oneWayDurationMs)} МСК`}</span>
                      <em>{missionId === 'space-flight' ? 'полный цикл — два равных участка' : 'оценка, если отозвать рейс сейчас'}</em>
                    </div>
                  </section>
                  {arrivalAsteroidPreview ? <section className="flight-timeline-eta" data-qa-gas-asteroid-preview aria-label="Положение астероида при прибытии">
                    <div className="flight-timeline-eta-card is-arrival">
                      <small>АСТЕРОИД ПРИ ПРИБЫТИИ</small>
                      <strong data-qa-gas-asteroid-hit={arrivalAsteroidPreview.unavailable ? 'unavailable' : arrivalAsteroidPreview.hit ? 'hit' : 'miss'}>
                        {arrivalAsteroidPreview.unavailable
                          ? 'Положение недоступно'
                          : arrivalAsteroidPreview.hit ? 'Астероид будет в точке назначения' : 'Астероида в точке назначения не будет'}
                      </strong>
                      <span>Цель рейса: {flightCoordinateLabel(arrivalAsteroidPreview.targetCoordinate)}</span>
                      <em>{arrivalAsteroidPreview.asteroidCoordinate
                        ? `Положение при прибытии: ${flightCoordinateLabel(arrivalAsteroidPreview.asteroidCoordinate)}`
                        : 'Астероид не найден в рассчитанный момент'}</em>
                    </div>
                  </section> : null}
                  <div className="flight-timeline-notes">
                    <p className="flight-timeline-note-info">{missionId === 'space-flight' ? 'При успешном возвращении корабли и ресурсный груз зачисляются один раз. Спутники и оборона не покидают планету.' : 'Газ списывается только за один путь туда. Обратный участок не требует повторной оплаты.'}</p>
                    <p className="flight-timeline-note-warning">{missionId === 'space-flight'
                      ? 'Отправка стоит 100 газа. При отзыве корабли летят обратно столько же времени, сколько уже провели в пути; газ не возвращается.'
                      : missionId === 'aid'
                      ? 'Отправленное количество сразу резервируется за запросом. Если состав союза изменится или запрос закроется, флот развернётся вместе с грузом; газ не возвращается.'
                      : missionId === 'attack'
                      ? 'До прибытия атаку можно отозвать без боя и боевого отчёта.'
                      : missionId === 'recycle'
                        ? 'При отзыве до прибытия переработчик вернётся без обломков.'
                        : missionId === 'gas'
                          ? 'Координата назначения не меняется; астероид может переместиться до прибытия.'
                          : 'При отзыве колонизатор возвращается, но газ не возвращается.'}</p>
                  </div>
                </> : <p className="flight-timeline-error" data-qa-flight-preview-error>{previewResult && !previewResult.ok ? previewResult.error.message : targetIsLocallyValid ? 'Проверка цели будет выполнена при отправке.' : 'Укажите координаты цели. Проверка доступности выполняется при отправке.'}</p>}
              </section>
              {(missionId === 'transport' || missionId === 'space-flight' || missionId === 'aid') && transportSummary ? <section className="flight-timeline-cargo" data-qa-flight-cargo data-qa-cargo-capacity={`${transportSummary.capacity.used}/${transportSummary.capacity.total}`} aria-label="Загрузка ресурсов">
                <div className="flight-timeline-cargo-head">
                  <div>
                    <small>{missionId === 'space-flight' ? 'ГРУЗ КОСМИЧЕСКОГО РЕЙСА' : missionId === 'aid' ? 'ГРУЗ ПОМОЩИ СОЮЗУ' : 'ЗАГРУЗКА КОРАБЛЯ'}</small>
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
                <div className="flight-timeline-cargo-grid flight-cargo-sliders-v2">
                  {flightCargoResources.filter((resource) => missionId !== 'aid' || resource.kind === aidRequest?.resource).map((resource) => (
                    <label key={resource.kind} className="flight-timeline-cargo-field">
                      <span className="flight-timeline-cargo-resource">
                        <ResourceIcon kind={resource.kind} label={resource.label} />
                        <b>{resource.label}</b>
                      </span>
                      <span className="flight-timeline-cargo-input">
                        <input type="number" min="0" step="1" value={transportSummary.cargo[resource.kind]} max={cargoMax(resource.kind)} aria-label={resource.label} data-qa-cargo={resource.kind} onChange={(event) => changeTransportCargo(resource.kind, event.target.value)} />
                        <em>МАКС. {flightNumberLabel(cargoMax(resource.kind))}</em>
                      </span>
                      <AmountSlider value={transportSummary.cargo[resource.kind]} max={cargoMax(resource.kind)} label={`Груз: ${resource.label}`} onChange={(value) => changeTransportCargo(resource.kind, String(value))} qa={`cargo-${resource.kind}`} />
                    </label>
                  ))}
                </div>
                {transportSummary.overflowWarning ? <p role="alert" data-qa-transport-overflow-warning>Часть груза может сгореть: склады цели заполнены.</p> : <p>{missionId === 'space-flight' ? 'Груз ограничен запасами источника и вместимостью кораблей; 100 газа для отправки зарезервированы отдельно.' : missionId === 'aid' ? 'Можно везти только запрошенный ресурс и не больше свободного остатка запроса. Засчитывается только то, что планета реально примет.' : 'Загрузка ограничена запасом источника и свободной грузоподъёмностью.'}</p>}
              </section> : null}
              </div>
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
          <section className="resource-building-action-confirm spy-operations-modal spy-intel-modal-v2" role="dialog" aria-modal="true" aria-labelledby="spy-operations-title" onMouseDown={(event) => event.stopPropagation()}>
            <header className="spy-operations-modal__head">
              <div>
                <small>УПРАВЛЕНИЕ ФЛОТОМ / ШПИОНАЖ</small>
                <h3 id="spy-operations-title">РАЗВЕДДАННЫЕ</h3>
                <p>Зонды на орбитах целей: последний снимок и изменения с прошлого.</p>
              </div>
              <button type="button" className="spy-operations-modal__close" data-asterion-close aria-label="Закрыть шпионские отчёты" onClick={() => setSpyOperationsOpen(false)}>×</button>
            </header>
            <div className="spy-intel-v2" aria-label="Разведданные зондов на орбите">
              {spyRows.filter(({ mission }) => mission.status === 'orbiting').map(({ mission, flight }) => {
                const selected = selectedSpyMissionIds.has(mission.id);
                const reportReady = mission.nextReportAt === undefined || clockNow >= mission.nextReportAt;
                const reports = espionageState.reports.filter((report) => report.missionId === mission.id).sort((left, right) => right.createdAt - left.createdAt);
                const [latest, previous] = reports;
                const cells: { label: string; value: number | undefined; before: number | undefined }[] = latest ? [
                  { label: 'МЕТАЛЛ', value: latest.resources.metal, before: previous?.resources.metal },
                  { label: 'МИНЕРАЛЫ', value: latest.resources.minerals, before: previous?.resources.minerals },
                  { label: 'ГАЗ', value: latest.resources.gas, before: previous?.resources.gas },
                  { label: 'ОБЛОМКИ', value: latest.resources.debris, before: previous?.resources.debris },
                  { label: 'ФЛОТ · НАС.', value: latest.population?.fleet, before: previous?.population?.fleet },
                  { label: 'ОБОРОНА · НАС.', value: latest.population?.defense, before: previous?.population?.defense },
                ] : [];
                return <div className={`spy-intel-v2__row${selected ? ' is-selected' : ''}`} key={mission.id} data-qa-spy-mission={mission.id} data-qa-spy-status={mission.status}>
                  <label className="spy-operations-select"><input type="checkbox" checked={selected} onChange={(event) => { const checked = event.currentTarget.checked; setSelectedSpyMissionIds((current) => { const next = new Set(current); if (checked) next.add(mission.id); else next.delete(mission.id); return next; }); }} aria-label={`Выбрать зонд у ${mission.targetPlanetName}`} /><span aria-hidden="true" /></label>
                  <div className="spy-intel-v2__target">
                    <strong>{mission.targetPlanetName}</strong>
                    <small><CoordinateLink coordinate={mission.targetCoordinate} /> · {mission.targetOwnerName}</small>
                    <em className={`spy-intel-v2__rel is-${mission.targetRelation}`}>{mission.targetRelation === 'enemy' ? 'ВРАГ' : mission.targetRelation === 'ally' ? 'СОЮЗНИК' : 'НЕЙТРАЛ'} · НА ОРБИТЕ</em>
                  </div>
                  {latest ? <div className="spy-intel-v2__snap">
                    <div className="spy-intel-v2__cells">{cells.map((cell) => {
                      const delta = cell.value !== undefined && cell.before !== undefined ? cell.value - cell.before : 0;
                      return <div key={cell.label}><small>{cell.label}</small><b>{cell.value === undefined ? '—' : flightNumberLabel(cell.value)}</b>{delta ? <i className={delta > 0 ? 'is-up' : 'is-down'}>{delta > 0 ? '+' : '−'}{flightNumberLabel(Math.abs(delta))}</i> : null}</div>;
                    })}</div>
                    <span className="spy-intel-v2__times">снимок {flightArrivalLabel(latest.createdAt)} · всего {reports.length}{previous ? ' · изменения к прошлому снимку' : ''}</span>
                  </div> : <div className="spy-intel-v2__snap is-empty">Снимков ещё нет · {spyStatusLabel(mission, flight, clockNow)}</div>}
                  <div className="spy-intel-v2__actions">
                    <button type="button" className="is-primary" disabled={!reportReady} onClick={() => window.dispatchEvent(new CustomEvent(SPY_REPORT_REQUEST_EVENT, { detail: { missionId: mission.id, now: Date.now() } }))}>{reportReady ? 'НОВЫЙ СНИМОК' : spyStatusLabel(mission, flight, clockNow)}</button>
                    <button type="button" className="is-danger" onClick={() => window.dispatchEvent(new CustomEvent(FLIGHT_RECALL_REQUEST_EVENT, { detail: { flightId: flight.id, now: Date.now() } }))}>ОТОЗВАТЬ</button>
                  </div>
                </div>;
              })}
              {spyRows.some(({ mission }) => mission.status === 'orbiting') ? null : <p className="fleet-spy-empty-v1">На орбитах нет зондов. Отправьте один зонд на вражескую или нейтральную планету — он останется на орбите и будет присылать снимки.</p>}
              {spyRows.some(({ mission }) => mission.status !== 'orbiting') ? <div className="spy-intel-v2__transit">
                <small>ЕЩЁ НЕ НА ОРБИТЕ</small>
                {spyRows.filter(({ mission }) => mission.status !== 'orbiting').map(({ mission, flight }) => <span key={mission.id} data-qa-spy-mission={mission.id} data-qa-spy-status={mission.status}>{mission.targetPlanetName} · {mission.status === 'transit' ? `прибытие через ${flightCountdown(flight.arrivalAt, clockNow)}` : `возврат через ${flightCountdown(flight.returnAt, clockNow)}`}{mission.status === 'transit' ? <button type="button" onClick={() => window.dispatchEvent(new CustomEvent(FLIGHT_RECALL_REQUEST_EVENT, { detail: { flightId: flight.id, now: Date.now() } }))}>ОТОЗВАТЬ</button> : null}</span>)}
              </div> : null}
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

export function FleetWorkspacePortal() {
  const { route } = useNavigation();
  const persistence = useMemo(() => createPersistenceFacade({ mode: ACTIVE_RUNTIME_MODE }), []);
  const [target, setTarget] = useState<Element | null>(null);
  const [resetNonce, setResetNonce] = useState(0);
  const [saveState, setSaveState] = useState<SaveState>(() => persistence.read());
  const [constructionRequested, setConstructionRequested] = useState(false);
  const [launchContext, setLaunchContext] = useState<FleetLaunchContext | null>(null);
  const fallbackPlanetId = Object.keys(saveState.planets)[0] ?? 'helion-01';
  const planetId = (saveState.planets[saveState.currentPlanetId]
    ? saveState.currentPlanetId
    : fallbackPlanetId) as SaveState['currentPlanetId'];
  const planet = saveState.planets[planetId];
  const planetName = planet?.name ?? 'Helion 01';
  const coords = `[${planet?.universeGalaxy ?? 1}:${planet?.universeSystem ?? 1}:${planet?.universePosition ?? 1}]`;

  useEffect(() => {
    const onRuntimeStateChanged = (event: Event) => {
      const nextState = (event as CustomEvent<SaveState>).detail;
      if (nextState && nextState.planets && typeof nextState.currentPlanetId === 'string') {
        setSaveState(nextState);
      }
    };
    const onLaunchContext = (event: Event) => setLaunchContext((event as CustomEvent<FleetLaunchContext>).detail);
    const onLaunchContextClear = () => setLaunchContext(null);
    const onRuntimeReset = () => {
      setLaunchContext(null);
      setConstructionRequested(false);
      setResetNonce((current) => current + 1);
    };
    const onCommandResult = (event: Event) => {
      const result = (event as CustomEvent<FlightCommandResult>).detail;
      if (result.ok) {
        setSaveState(result.state);
        setLaunchContext(null);
      }
    };

    window.addEventListener(FLIGHT_LAUNCH_CONTEXT_EVENT, onLaunchContext);
    window.addEventListener(FLIGHT_LAUNCH_CONTEXT_CLEAR_EVENT, onLaunchContextClear);
    window.addEventListener(FLIGHT_COMMAND_RESULT_EVENT, onCommandResult);
    window.addEventListener(RUNTIME_STATE_CHANGED_EVENT, onRuntimeStateChanged);
    window.addEventListener(RUNTIME_RESET_EVENT, onRuntimeReset);
    return () => {
      window.removeEventListener(FLIGHT_LAUNCH_CONTEXT_EVENT, onLaunchContext);
      window.removeEventListener(FLIGHT_LAUNCH_CONTEXT_CLEAR_EVENT, onLaunchContextClear);
      window.removeEventListener(FLIGHT_COMMAND_RESULT_EVENT, onCommandResult);
      window.removeEventListener(RUNTIME_STATE_CHANGED_EVENT, onRuntimeStateChanged);
      window.removeEventListener(RUNTIME_RESET_EVENT, onRuntimeReset);
    };
  }, [persistence]);

  useEffect(() => {
    setTarget(document.querySelector('.workspace'));
    if (route !== 'fleets') setLaunchContext(null);
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
      planetName={planetName}
      coords={coords}
      openConstruction={constructionRequested}
        onConstructionOpened={() => setConstructionRequested(false)}
        saveState={saveState}
        launchContext={launchContext}
      />,
    target,
  );
}
