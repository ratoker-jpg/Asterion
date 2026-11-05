import { sunRaidCapsOf } from './domain/sun-raid/config.ts';
import { isFlightVisibleToPlayer, isHostileFlightIncomingToPlayer } from './application/flight-visibility.ts';
import type { CSSProperties } from 'react';
import { SUN_RAID_MISSION_ICON } from './ui/sun-raid/sun-raid-assets.ts';
import { isSunCombatHull, selectSunSupportTargets } from './application/sun-raid.ts';
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { getFactionDefenseCatalog, getFactionShipCatalog } from './domain/combat/faction-catalog.ts';
import { PIRATE_CATALOG_BY_ID, type PirateBaseShipId } from './domain/pirates/catalog.ts';
import { describeIncomingAttack, INCOMING_ATTACK_COMPOSITION_ESPIONAGE_LEVEL } from './domain/flights/incoming-attack-knowledge.ts';
import { COMMANDER_COMBAT_CATALOG } from './domain/combat/catalog.ts';
import { getCombatFactionName } from './domain/combat/factions.ts';
import { COMMANDER_IDS, getCommanderPresentedAbility, type CommanderId } from './domain/combat/commanders.ts';
import type { ShipId } from './domain/combat/ids.ts';
import type { SimulatorMaxRounds } from './domain/combat/simulator.ts';
import { SOLAR_SATELLITE_ID } from './domain/combat/ids.ts';
import { getBuildingPresentation } from './domain/buildings/balance-v1.ts';
import { RUNTIME_RESET_EVENT, RUNTIME_STATE_CHANGED_EVENT } from './domain/runtime/mode.ts';
import { getLiveSaveState } from './application/runtime.ts';
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
  estimateFlightRoute,
  getAvailableFleetForPlanet,
  getPlayerFlightSlotUsage,
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
import { EMPTY_ART, MISSION_BANNERS } from './ui/ui-art.ts';
import './building-card.css';
import './fleet-workspace.css';
import './ui/fleet/fleet-root-v2.css';
import { GameSelect } from './ui/GameSelect';
import './ui/fleet/fleet-repeat.css';

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
import missionRepairIcon from '../assets/source/mission-icons-v1/36_salvage.png';
import missionPriorityIcon from '../assets/source/mission-icons-v1/18_escort.png';
import missionBattlesIcon from '../assets/source/mission-icons-v1/20_bombardment.png';
import missionSimulatorIcon from '../assets/source/mission-icons-v1/24_track_target.png';
import { AID_MISSION_DESCRIPTION, AID_MISSION_ENABLED, AID_TRANSPORT_SHIP_IDS } from './domain/flights/aid-mission.ts';
import { AID_RESOURCE_LABELS, selectFulfillableRequests, selectRequestById } from './domain/command/aid.ts';
import { selectRequestProgress } from './application/alliance-aid.ts';
import {
  FOLLOW_UP_MISSIONS,
  buildFlightRepeatPlan,
  canRepeatFlight,
  carryComposition,
  clampComposition,
  listSourcePlanets,
  pickNextSourcePlanet,
  type FlightRepeatPlan,
} from './application/flight-repeat.ts';
import { FLEET_UI_UPDATE_EVENT, isFavoriteTarget, type FleetFavoriteTarget, type FleetUiUpdate } from './domain/flights/fleet-ui.ts';

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
  { id: 'sun-support', label: 'Поддержка солнца', description: 'Защита Солнца под атакой командного рейда. Союз не нужен: летят только боевые и командирские корабли с любых ваших планет.', icon: missionSunSupportIcon },
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
      aria-label="Открыть во Вселенной"
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
  if (result.error.code === 'invalid-coordinate' || result.error.code === 'target-occupied' || result.error.code === 'target-not-colonizable' || result.error.code === 'target-not-available' || result.error.code === 'target-is-origin' || result.error.code === 'spy-target-blocked' || result.error.code === 'spy-mission-not-found' || result.error.code === 'attack-not-allowed') {
    return result.error.message;
  }
  return null;
}

/** Who flies it, as the player can see it: an owner's public name, never an internal id. */
function flightOwnerLabel(flight: FlightRecord, targets: Readonly<Record<string, { ownerName?: string }>> | undefined): string {
  if (flight.ownerSide === 'pirate') return 'Пираты';
  if (flight.ownerSide === 'bot01') return 'Bot 01';
  if (flight.ownerSide === 'npc') return targets?.[flight.originPlanetId]?.ownerName ?? flight.targetOwnerName ?? 'Чужой флот';
  return 'Ваш флот';
}

function flightMissionLabel(missionId: MissionId) {
  if (missionId === 'pirate-recon') return 'Разведка пиратов';
  if (missionId === 'pirate-raid') return 'ПИРАТСКИЙ НАЛЁТ';
  if (missionId === 'exploration-recon') return 'Исследование объекта';
  if (missionId === 'sun-attack') return 'Рейд на Солнце';
  return missions.find((mission) => mission.id === missionId)?.label ?? missionId;
}

function flightMissionIcon(missionId: MissionId) {
  if (missionId === 'pirate-recon') return missionEspionageIcon;
  if (missionId === 'pirate-raid') return missionAttackIcon;
  if (missionId === 'exploration-recon') return missionEspionageIcon;
  if (missionId === 'sun-attack') return SUN_RAID_MISSION_ICON;
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
  // Once the player types a target, the planet the flight was launched at is
  // no longer a fallback: an unfinished entry is an error, never the own planet.
  const [previewTargetTyped, setPreviewTargetTyped] = useState(false);
  const launchDestination = previewTargetTyped ? undefined : launchContext?.destination;
  const launchTargetRelation = previewTargetTyped ? undefined : launchContext?.targetRelation;
  const [previewTargetError, setPreviewTargetError] = useState<string | null>(null);
  const [selectedPirateTargetKey, setSelectedPirateTargetKey] = useState<string | null>(null);
  /** «Поддержка солнца»: the `sun:G:S` operation of the Sun under attack. */
  const [selectedSunOperationId, setSelectedSunOperationId] = useState<string | null>(null);
  const [selectedExplorationTargetKey, setSelectedExplorationTargetKey] = useState<string | null>(null);
  const [selectedExpeditionFlightId, setSelectedExpeditionFlightId] = useState<string | null>(null);
  const [selectedFlightDetailsId, setSelectedFlightDetailsId] = useState<string | null>(null);
  const [selectedAidRequestId, setSelectedAidRequestId] = useState<string | null>(null);
  const [transportCargoDraft, setTransportCargoDraft] = useState<TransportCargo>(emptyTransportCargo);
  const [pendingRecall, setPendingRecall] = useState<FlightRecord | null>(null);
  /** The flight just sent: mission and target stay, «Ещё с другой планеты» sends the next wave. */
  const [sentFlight, setSentFlight] = useState<FlightRecord | null>(null);
  /** Opens the plan after the composition for another source has been committed. */
  const [planOpenRequest, setPlanOpenRequest] = useState<{ originPlanetId: string; nonce: number } | null>(null);
  const dispatchRequestIdRef = useRef<string | null>(null);
  const pendingRepeatRef = useRef<FlightRepeatPlan | null>(null);
  const [clockNow, setClockNow] = useState(() => Date.now());
  const fleetSnapshot = useMemo(() => getFleetSnapshot(saveState, planetId as SaveState['currentPlanetId']), [planetId, saveState]);
  const fleetBudget = useMemo(() => getFleetBuildBudget(saveState, planetId as SaveState['currentPlanetId']), [planetId, saveState]);
  /** The plan may launch from another own planet; the root screen always shows the current one. */
  const launchPlanetId = previewOriginPlanetId && saveState.planets[previewOriginPlanetId] ? previewOriginPlanetId : planetId;
  const sourceFleet = useMemo(
    () => launchPlanetId === planetId ? fleetSnapshot.fleet : getAvailableFleetForPlanet(saveState, launchPlanetId),
    [fleetSnapshot.fleet, launchPlanetId, planetId, saveState],
  );
  const flightRecords = saveState.flights.records;
  const flightSlots = useMemo(() => getPlayerFlightSlotUsage(saveState), [saveState]);
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
    () => shipDefinitions.filter((ship) => ship.id !== SOLAR_SATELLITE_ID && (sourceFleet.ships[ship.id] ?? 0) > 0),
    [sourceFleet, shipDefinitions],
  );
  const availableShipCount = useMemo(
    () => ownedShipDefinitions.reduce((total, ship) => total + (sourceFleet.ships[ship.id] ?? 0), 0),
    [sourceFleet, ownedShipDefinitions],
  );

  /** Ship types the selected mission can take; the same filter on every source planet. */
  const isMissionShip = (shipId: ShipId) => shipId !== SOLAR_SATELLITE_ID && (missionId === 'colonize'
    ? shipId === 'colonizer'
    : missionId === 'espionage'
      ? shipId === 'spy-probe'
      : missionId === 'pirate-elimination'
        ? shipDefinitions.find((entity) => entity.id === shipId)?.category === 'Боевой корабль'
      : missionId === 'sun-support'
        ? isSunCombatHull(shipId)
      : missionId === 'attack'
        ? isAttackCombatShip(shipId, factionId)
        : missionId === 'recycle' || missionId === 'gas'
          ? shipId === 'recycler'
          : missionId === 'aid'
            ? (AID_TRANSPORT_SHIP_IDS as readonly string[]).includes(shipId)
      : true);
  const missionShipIds = shipDefinitions.map((ship) => ship.id as ShipId).filter(isMissionShip);
  const visibleShipDefinitions = ownedShipDefinitions.filter((ship) => isMissionShip(ship.id as ShipId));
  const commanderAvailability = useMemo(() => {
    if (missionId !== 'attack' && missionId !== 'pirate-elimination' && missionId !== 'deployment' && missionId !== 'space-flight' && missionId !== 'sun-support') return {} as Partial<Record<CommanderId, number>>;
    const runtimeState = saveState;
    return missionId === 'attack' || missionId === 'pirate-elimination'
      ? getAttackCommanderSelection(runtimeState, launchPlanetId)
      : getAvailableFleetForPlanet(runtimeState, launchPlanetId).commanders;
  }, [flightRecords, fleetSnapshot.fleet, missionId, launchPlanetId, saveState]);
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
    || ((missionId === 'deployment' || missionId === 'space-flight' || missionId === 'sun-support') && selectedCommanderCount > 0);
  const selectedMission = missions.find((mission) => mission.id === missionId) ?? missions[0];
  const describedMission = missions.find((mission) => mission.id === hoveredMissionId) ?? selectedMission;
  const activeFlightRecords = useMemo(
    () => flightRecords
      .filter((flight) => isFlightVisibleToPlayer(flight, saveState.profile.playerId))
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
    [flightRecords, saveState.profile.playerId],
  );
  // Hostile flights heading to the player light up the whole Fleet screen.
  // Read at the moment of viewing: researching espionage 10 reveals fleets already on the way.
  const playerEspionageLevel = saveState.science.levels[5] ?? 0;
  const hostileIncomingFlights = useMemo(() => activeFlightRecords
    .filter((flight) => isHostileFlightIncomingToPlayer(flight, saveState.profile.playerId))
    .map((flight) => ({ flight, originLabel: flightOwnerLabel(flight, saveState.espionage?.targets) })), [activeFlightRecords, saveState.espionage?.targets, saveState.profile.playerId]);
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
    .filter((mission) => mission.ownerId === saveState.profile.playerId)
    .filter((mission) => mission.status === 'transit' || mission.status === 'orbiting' || mission.status === 'returning')
    .map((mission) => ({ mission, flight: flightRecords.find((flight) => flight.id === mission.flightId) }))
    .filter((row): row is { mission: SpyMission; flight: FlightRecord } => Boolean(row.flight)), [espionageState.missions, flightRecords, saveState.profile.playerId]);

  const getActiveTransportState = (flight: FlightRecord) => {
    if (flight.missionId !== 'transport' && flight.missionId !== 'aid') return { overflowWarning: false, targetUnavailable: false };
    const runtimeState = saveState;
    const target = resolveTransportTarget(runtimeState, flight.destination);
    if (!target.acceptsTransport || !target.runtime) return { overflowWarning: false, targetUnavailable: true };
    const resources = target.runtime.resources ?? getPlanetResources(runtimeState, target.planetId);
    return {
      targetUnavailable: false,
      overflowWarning: getOverflowWarning(flight.cargo, resources, getStorageCapacities(target.runtime.buildings))
        || (target.storage === 'foreign' && (flight.cargo?.debris ?? 0) > 0),
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
    setPreviewTargetTyped(false);
    setPreviewTargetError(null);
    setSelectedPirateTargetKey(null);
    setSelectedSunOperationId(null);
    setSelectedExplorationTargetKey(null);
    setSelectedAidRequestId(null);
    setTransportCargoDraft(emptyTransportCargo());
    setPendingRecall(null);
    setPendingSatelliteDismantle(null);
    setSimulatorHandoff(null);
    setSpyOperationsOpen(false);
    setSelectedSpyMissionIds(new Set());
    setSentFlight(null);
    setPlanOpenRequest(null);
    pendingRepeatRef.current = null;
  };

  /** Commanders for a source: attack takes all free ones, as when the mission is picked. */
  const commandersFor = (sourceId: string, wanted: Partial<Record<CommanderId, number>>, runtimeState = saveStateRef.current) =>
    missionId === 'attack' || missionId === 'pirate-elimination'
      ? getAttackCommanderSelection(runtimeState, sourceId)
      : clampComposition(wanted, getAvailableFleetForPlanet(runtimeState, sourceId).commanders);

  /** Moves the chosen ships to another source planet without touching mission or target. */
  const carryCompositionTo = (fromId: string, toId: string, runtimeState = saveStateRef.current) => {
    if (fromId === toId) return;
    const before = getAvailableFleetForPlanet(runtimeState, fromId).ships;
    const after = getAvailableFleetForPlanet(runtimeState, toId).ships;
    setSelectedQuantities((current) => missionId === 'colonize' || missionId === 'espionage'
      ? clampComposition(current, after)
      : carryComposition(current, before, after, missionShipIds));
    setSelectedCommanders((current) => commandersFor(toId, current, runtimeState));
  };

  /** Opens (or re-checks) the plan from the given source once its composition is in state. */
  const requestPlan = (originPlanetId: string) => {
    setPreviewOriginPlanetId(originPlanetId);
    setPlanOpenRequest({ originPlanetId, nonce: Date.now() + Math.random() });
  };

  const changePlanSource = (nextId: string) => {
    if (!saveState.planets[nextId] || nextId === launchPlanetId) return;
    carryCompositionTo(launchPlanetId, nextId, saveState);
    setTransportCargoDraft(emptyTransportCargo());
    requestPlan(nextId);
  };

  const updateFleetUi = (update: FleetUiUpdate) => {
    window.dispatchEvent(new CustomEvent<FleetUiUpdate>(FLEET_UI_UPDATE_EVENT, { detail: update }));
  };

  const clearLaunchContext = () => {
    resetFlightWorkspace();
    window.dispatchEvent(new Event(FLIGHT_LAUNCH_CONTEXT_CLEAR_EVENT));
  };

  const closeFlightPreview = () => {
    // The root screen shows the current planet again; the chosen ships follow it.
    if (launchPlanetId !== planetId) carryCompositionTo(launchPlanetId, planetId);
    setPreviewOriginPlanetId(null);
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
    setPreviewTargetTyped(false);
    setPreviewTargetError(null);
    setSelectedPirateTargetKey(launchContext.missionId === 'pirate-elimination' ? launchContext.contactCycleKey ?? null : null);
    setSelectedSunOperationId(launchContext.missionId === 'sun-support' ? launchContext.operationId ?? null : null);
    setSelectedExplorationTargetKey(launchContext.missionId === 'expedition' ? launchContext.contactCycleKey ?? null : null);
    setSelectedAidRequestId(launchContext.missionId === 'aid' ? launchContext.aidRequestId ?? null : null);
    setStatus(launchContext.destination?.kind === 'operation' && launchContext.operationId?.startsWith('sun:')
      ? `Цель: ${launchContext.targetPlanetName ?? 'Солнце'} [${launchContext.destination.coordinate.galaxy}:${launchContext.destination.coordinate.system}:0].`
      : launchContext.destination ? `Цель: ${flightCoordinateLabel(launchContext.destination.coordinate)}.` : 'Выберите корабли и координаты цели.');
    setSentFlight(null);
    const repeat = pendingRepeatRef.current;
    pendingRepeatRef.current = null;
    if (repeat && repeat.context === launchContext && runtimeState.planets[repeat.originPlanetId]) {
      // «Повторить»: the same source, target and composition, capped by what is on the planet now.
      const available = getAvailableFleetForPlanet(runtimeState, repeat.originPlanetId);
      setSelectedQuantities(clampComposition(repeat.ships, available.ships));
      setSelectedCommanders(clampComposition(repeat.commanders, available.commanders));
      if (repeat.cargo) setTransportCargoDraft(repeat.cargo);
      setStatus(`Повтор рейса: ${flightMissionLabel(launchContext.missionId)} с планеты ${runtimeState.planets[repeat.originPlanetId]!.name}.`);
      requestPlan(repeat.originPlanetId);
    }
  }, [launchContext]);

  // Picking another planet in the header keeps mission and target; the ships follow the new planet.
  const previousPlanetIdRef = useRef(planetId);
  useEffect(() => {
    const previous = previousPlanetIdRef.current;
    previousPlanetIdRef.current = planetId;
    if (previous === planetId) return;
    // An open plan belonged to the other planet: close it, the ships move with the screen.
    if (previewOpen) closeFlightPreview();
    else carryCompositionTo(previous, planetId);
  }, [planetId]);

  useEffect(() => {
    if (!planOpenRequest) return;
    openFlightPreview(planOpenRequest.originPlanetId);
  }, [planOpenRequest]);

  useEffect(() => {
    const onCommandResult = (event: Event) => {
      const result = (event as CustomEvent<FlightCommandResult>).detail;
      if (result.ok) {
        const ownDispatch = dispatchRequestIdRef.current !== null && result.flight?.requestId === dispatchRequestIdRef.current;
        if (ownDispatch) dispatchRequestIdRef.current = null;
        if (ownDispatch && FOLLOW_UP_MISSIONS.has(result.flight.missionId)) {
          // Mission and target stay for the next wave; only the ships left on the current planet remain chosen.
          const flight = result.flight;
          const left = getAvailableFleetForPlanet(result.state, result.state.currentPlanetId);
          setSelectedQuantities((current) => clampComposition(current, left.ships));
          setSelectedCommanders((current) => clampComposition(current, left.commanders));
          setTransportCargoDraft(emptyTransportCargo());
          setPreviewOpen(false);
          setPreviewResult(null);
          setPreviewOriginPlanetId(null);
          setPreviewSubmittedTargetKind(null);
          setPreviewTargetError(null);
          setGasPreviewNeedsReconfirmation(false);
          setSentFlight(flight);
          setStatus(result.notice);
          if ((flight.missionId === 'transport' || flight.missionId === 'deployment') && flight.destination.kind === 'planet' && flight.targetRelation === 'self') {
            window.dispatchEvent(new CustomEvent<FleetUiUpdate>(FLEET_UI_UPDATE_EVENT, {
              detail: { kind: 'remember-own-target', missionId: flight.missionId, planetId: flight.destination.planetId },
            }));
          }
        } else if (ownDispatch) {
          resetFlightWorkspace();
          window.dispatchEvent(new Event(FLIGHT_LAUNCH_CONTEXT_CLEAR_EVENT));
          setStatus(result.notice);
        } else {
          setStatus(result.notice);
        }
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
    const sunTargets = missionId === 'sun-support' ? selectSunSupportTargets(runtimeState, draft?.departedAt ?? Date.now()) : [];
    const sunTarget = sunTargets.find((item) => item.operationId === selectedSunOperationId)
      ?? (!selectedSunOperationId && sunTargets.length === 1 ? sunTargets[0] : null);
    if (missionId === 'sun-support' && !sunTarget) return null;
    const destination = missionId === 'pirate-elimination'
      ? { kind: 'coordinate' as const, coordinate: pirateTarget!.coordinate }
      : missionId === 'sun-support'
      ? { kind: 'operation' as const, operationId: sunTarget!.operationId, coordinate: { ...sunTarget!.coordinate } }
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
      : draft?.destination ?? previewDestination ?? launchDestination;
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
      targetRelation: missionId === 'pirate-elimination' || missionId === 'sun-support' ? 'neutral' : missionId === 'aid' ? 'ally' : draft?.targetRelation === null ? undefined : draft?.targetRelation ?? previewTargetRelation,
      targetKind,
      targetPlanetName: missionId === 'pirate-elimination' ? 'Пираты' : missionId === 'sun-support' ? `Солнце ${sunTarget!.raid.galaxy}:${sunTarget!.raid.system}` : missionId === 'expedition' ? expeditionTarget!.name : launchContext?.targetPlanetName,
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
      selectedCommanders: missionId === 'attack' || missionId === 'pirate-elimination' || missionId === 'deployment' || missionId === 'space-flight' || missionId === 'sun-support' ? selectedCommanders : undefined,
      maxRounds: missionId === 'attack' || missionId === 'pirate-elimination' ? attackRounds : undefined,
      cargo: missionId === 'transport' || missionId === 'space-flight' || missionId === 'aid' || missionId === 'deployment' ? transportCargoDraft : undefined,
      ...(missionId === 'aid' ? { aidRequestId: aidRequestForCommand!.id } : {}),
      // Sun missions and Sun-debris recycling carry the `sun:G:S` operation of their destination.
      operationId: missionId === 'expedition' ? expeditionTarget!.id
        : destination?.kind === 'operation' ? destination.operationId
        : launchContext?.operationId?.startsWith('sun:') ? undefined : launchContext?.operationId,
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

  const openFlightPreview = (originOverride?: string) => {
    const runtimeState = saveState;
    const originPlanetId = originOverride && runtimeState.planets[originOverride] ? originOverride : planetId;
    setSentFlight(null);
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
      : previewDestination ?? launchDestination ?? lastOwnTargetFor(originPlanetId);
    const sunTargets = missionId === 'sun-support' ? selectSunSupportTargets(runtimeState, Date.now()) : [];
    const requestedSun = sunTargets.find((item) => item.operationId === selectedSunOperationId)
      ?? (!selectedSunOperationId && sunTargets.length === 1 ? sunTargets[0] : null);
    const destination = missionId === 'pirate-elimination'
      ? requestedPirate ? { kind: 'coordinate' as const, coordinate: requestedPirate.coordinate } : undefined
      : missionId === 'sun-support'
      ? requestedSun ? { kind: 'operation' as const, operationId: requestedSun.operationId, coordinate: { ...requestedSun.coordinate } } : undefined
      : missionId === 'expedition'
      ? requestedExpedition ? { kind: 'coordinate' as const, coordinate: requestedExpedition.coordinate } : undefined
      : missionId === 'space-flight'
      ? createFlightCommand(`preview-${Date.now()}`, { originPlanetId }, runtimeState)?.destination
      : requestedDestination;
    const targetRelation = missionId === 'pirate-elimination' || missionId === 'expedition' || missionId === 'sun-support' ? 'neutral' : missionId === 'space-flight' ? undefined : missionId === 'aid' ? 'ally'
      : !previewDestination && !launchDestination && destination ? 'self' : previewTargetRelation ?? launchTargetRelation;
    if (requestedSun) setSelectedSunOperationId(requestedSun.operationId);
    const command = missionId === 'space-flight'
      ? createFlightCommand(`preview-${Date.now()}`, { originPlanetId }, runtimeState)
      : destination ? createFlightCommand(`preview-${Date.now()}`, { originPlanetId, destination, targetRelation }, runtimeState) : null;
    setPreviewOriginPlanetId(originPlanetId);
    setPreviewDestination(destination ?? null);
    setPreviewTargetRelation(targetRelation);
    setGasPreviewNeedsReconfirmation(false);
    setEditingPreviewTarget(missionId === 'space-flight' || missionId === 'pirate-elimination' || missionId === 'expedition' || missionId === 'aid' || missionId === 'sun-support' || destination?.kind === 'operation' ? false : destination ? (previewDestination ? editingPreviewTarget : false) : true);
    setPreviewTargetDraft(missionId === 'pirate-elimination' || missionId === 'expedition' ? destination ? flightCoordinateDraft(destination.coordinate) : { galaxy: '', system: '', position: '' } : destination && !previewDestination ? flightCoordinateDraft(destination.coordinate) : previewTargetDraft);
    if (command) {
      const result = previewFlight(runtimeState, command, { mode: ACTIVE_RUNTIME_MODE, testTimeScale: resolveTestTimeScale() });
      setPreviewTargetError(targetErrorFromFlightResult(result));
      setPreviewResult(result);
      setPreviewSubmittedTargetKind(command.targetKind ?? null);
    } else {
      setPreviewTargetError(missionId === 'pirate-elimination' ? 'Выберите действующую пиратскую базу.' : missionId === 'sun-support' ? 'Выберите Солнце под атакой.' : missionId === 'expedition' ? 'Выберите свободный уникальный объект или аномалию.' : missionId === 'aid' ? 'Выберите открытый запрос союзника.' : null);
      setPreviewResult(null);
      setPreviewSubmittedTargetKind(null);
    }
    setPreviewOpen(true);
  };

  /** Transport / deployment open on the own planet used last time (not the source, not locked). */
  function lastOwnTargetFor(originPlanetId: string): FlightDestination | undefined {
    if (missionId !== 'transport' && missionId !== 'deployment') return undefined;
    const lastId = saveState.fleetUi?.lastOwnTargets?.[missionId];
    const planet = lastId ? saveState.planets[lastId] : undefined;
    if (!lastId || !planet || lastId === originPlanetId) return undefined;
    if (missionId === 'deployment' && getPlanetOverpopulationSummary(saveState, lastId).blocked) return undefined;
    return { kind: 'planet', planetId: lastId, coordinate: { galaxy: planet.universeGalaxy ?? 1, system: planet.universeSystem ?? 1, position: planet.universePosition ?? 1 } };
  }

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

  const selectSunTarget = (operationId: string) => {
    const runtimeState = saveState;
    const target = selectSunSupportTargets(runtimeState, Date.now()).find((item) => item.operationId === operationId);
    setSelectedSunOperationId(target?.operationId ?? null);
    setPreviewResult(null);
    setPreviewSubmittedTargetKind(null);
    setEditingPreviewTarget(false);
    if (!target) {
      setPreviewDestination(null);
      setPreviewTargetError('Выберите Солнце под атакой.');
      return;
    }
    const destination: FlightDestination = { kind: 'operation', operationId: target.operationId, coordinate: { ...target.coordinate } };
    setPreviewDestination(destination);
    setPreviewTargetRelation('neutral');
    setPreviewTargetDraft(flightCoordinateDraft(target.coordinate));
    setPreviewTargetError(null);
    const command = createFlightCommand(`preview-${Date.now()}`, { originPlanetId: previewOriginPlanetId ?? runtimeState.currentPlanetId, destination, targetRelation: 'neutral' }, runtimeState);
    if (!command) return;
    const result = previewFlight(runtimeState, { ...command, operationId: target.operationId, destination }, { mode: ACTIVE_RUNTIME_MODE, testTimeScale: resolveTestTimeScale() });
    setPreviewResult(result);
    setPreviewTargetError(targetErrorFromFlightResult(result));
  };

  const togglePreviewTargetEditing = () => {
    if (missionId === 'pirate-elimination' || missionId === 'expedition' || missionId === 'sun-support') return;
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
    setPreviewTargetDraft((current) => ({ ...current, [field]: value }));
    setPreviewTargetTyped(true);
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
    dispatchRequestIdRef.current = requestId;
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
      const destination = previewDestination ?? launchDestination;
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
    const available = sourceFleet.ships[shipId] ?? 0;
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
    setSelectedSunOperationId(null);
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
      setSelectedCommanders(getAttackCommanderSelection(runtimeState, launchPlanetId));
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
      visibleShipDefinitions.map((ship) => [ship.id, maximum ? (missionId === 'colonize' || missionId === 'espionage' ? 1 : sourceFleet.ships[ship.id] ?? 0) : 0]),
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
  const previewCoordinate = previewDestination?.coordinate ?? launchDestination?.coordinate ?? null;
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
  const sunTargetOptions = previewRuntimeState && missionId === 'sun-support'
    ? selectSunSupportTargets(previewRuntimeState, clockNow) : [];
  const currentSunTarget = sunTargetOptions.find((item) => item.operationId === selectedSunOperationId)
    ?? (!selectedSunOperationId && sunTargetOptions.length === 1 ? sunTargetOptions[0] : null);
  const previewTargetDestination = missionId === 'pirate-elimination'
    ? currentPirateTarget ? { kind: 'coordinate' as const, coordinate: currentPirateTarget.coordinate } : null
    : missionId === 'sun-support'
    ? currentSunTarget ? { kind: 'operation' as const, operationId: currentSunTarget.operationId, coordinate: currentSunTarget.coordinate } : null
    : previewDestination ?? launchDestination;
  /** Sun-debris recycling: the route ends at the Sun, position 0 of the system. */
  const sunDebrisTarget = missionId === 'recycle' && previewTargetDestination?.kind === 'operation' && previewTargetDestination.operationId?.startsWith('sun:')
    ? previewTargetDestination.coordinate : null;
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
  const targetIsLocallyValid = missionId === 'pirate-elimination' ? Boolean(currentPirateTarget)
    : missionId === 'sun-support' ? Boolean(currentSunTarget)
    : coordinateDraftError(previewTargetDraft) === null;
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
      : missionId === 'sun-support'
      ? targetIsLocallyValid && previewResult?.ok === true && previewResult.flight.missionId === 'sun-support' && hasLaunchableComposition
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
  /** Fleet figures that do not depend on the target: shown before the route is known. */
  const draftFleetStats = (() => {
    let speed = Infinity;
    let cargo = 0;
    let count = 0;
    for (const ship of shipDefinitions) {
      const quantity = selectedQuantities[ship.id as ShipId] ?? 0;
      if (quantity <= 0) continue;
      count += quantity;
      cargo += (ship.ship?.cargo ?? 0) * quantity;
      if ((ship.ship?.speed ?? 0) > 0) speed = Math.min(speed, ship.ship!.speed!);
    }
    return { speed: Number.isFinite(speed) ? speed : 0, cargo, count };
  })();
  const previewHoldCapacity = previewResult?.ok
    ? previewResult.flight.recycleCapacity ?? previewResult.flight.gasCapacity ?? draftFleetStats.cargo
    : draftFleetStats.cargo;
  /** Distance, speed, time and gas for typed coordinates; the target itself is checked on Send. */
  const estimateCoordinate = previewTargetDestination?.coordinate
    ?? (coordinateDraftError(previewTargetDraft) === null ? coordinateFromDraft(previewTargetDraft) : null);
  const routeEstimate = !previewResult?.ok && missionId !== 'space-flight' && previewSourceId && estimateCoordinate
    ? estimateFlightRoute(saveState, previewSourceId, selectedQuantities, selectedCommanders, estimateCoordinate, { mode: ACTIVE_RUNTIME_MODE, testTimeScale: resolveTestTimeScale() })
    : null;
  /** Missions with the cargo editor keep the summary to one line: the editor must stay on screen. */
  const compactSummary = missionId === 'transport' || missionId === 'aid' || missionId === 'space-flight';
  const holdLabel = missionId === 'recycle' ? 'ТРЮМ ОБЛОМКОВ' : missionId === 'gas' ? 'ТРЮМ ГАЗА' : 'ГРУЗОПОДЪЁМНОСТЬ';
  const sourceTargetCoordinate = previewOpen ? previewTargetDestination?.coordinate ?? null : (sentFlight?.destinationCoordinate ?? previewDestination?.coordinate ?? launchDestination?.coordinate ?? null);
  const sourceOptions = listSourcePlanets(saveState, isMissionShip, sourceTargetCoordinate);
  const nextWaveSourceId = sentFlight
    ? pickNextSourcePlanet(sourceOptions, [sentFlight.originPlanetId, ...(sentFlight.destination.kind === 'planet' ? [sentFlight.destination.planetId] : [])])
    : null;
  const lastOwnTargetId = missionId === 'transport' || missionId === 'deployment' ? saveState.fleetUi?.lastOwnTargets?.[missionId] : undefined;
  const favoriteTargets = saveState.fleetUi?.favoriteTargets ?? [];
  const favoriteMission = missionId === 'attack' || missionId === 'transport' || missionId === 'colonize' || missionId === 'recycle' || missionId === 'gas';
  const favoriteCoordinate = previewTargetDestination?.kind === 'coordinate' || previewTargetDestination?.kind === 'planet'
    ? previewTargetDestination.coordinate
    : !previewTargetError && coordinateDraftError(previewTargetDraft) === null ? coordinateFromDraft(previewTargetDraft) : null;
  const favoriteName = previewTargetPlanet?.name ?? (previewTargetTyped ? undefined : launchContext?.targetPlanetName);
  const targetIsFavorite = favoriteCoordinate ? isFavoriteTarget(saveState.fleetUi, favoriteCoordinate) : false;
  /** Finished own routes the player can send again; the newest of each route only. */
  const recentFlights = (() => {
    const seen = new Set<string>();
    return flightRecords
      .filter((flight) => flight.phase === 'completed' && canRepeatFlight(saveState, flight))
      .sort((left, right) => (right.completedAt ?? right.returnAt ?? 0) - (left.completedAt ?? left.returnAt ?? 0))
      .filter((flight) => {
        const key = `${flight.missionId}|${flight.originPlanetId}|${flightCoordinateLabel(flight.destinationCoordinate)}|${JSON.stringify(flight.selectedShips)}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .slice(0, 5);
  })();

  const repeatFlight = (flight: FlightRecord) => {
    const plan = buildFlightRepeatPlan(saveState, flight);
    if (!plan) {
      setStatus('Этот рейс нельзя повторить.');
      return;
    }
    pendingRepeatRef.current = plan;
    window.dispatchEvent(new CustomEvent<FlightLaunchContext>(FLIGHT_LAUNCH_CONTEXT_EVENT, { detail: plan.context }));
  };

  const sendNextWave = () => {
    if (!sentFlight || !nextWaveSourceId) return;
    const origin = sentFlight.originPlanetId;
    const remaining = getAvailableFleetForPlanet(saveState, origin).ships;
    const before = { ...remaining };
    for (const [shipId, quantity] of Object.entries(sentFlight.selectedShips) as [ShipId, number][]) before[shipId] = (before[shipId] ?? 0) + quantity;
    const next = getAvailableFleetForPlanet(saveState, nextWaveSourceId);
    setSelectedQuantities(missionId === 'espionage' ? { 'spy-probe': 1 } : carryComposition(sentFlight.selectedShips, before, next.ships, missionShipIds));
    setSelectedCommanders(commandersFor(nextWaveSourceId, {}, saveState));
    setSentFlight(null);
    requestPlan(nextWaveSourceId);
  };

  const chooseFavoriteTarget = (index: string) => {
    const favorite = favoriteTargets[Number(index)];
    if (!favorite) return;
    const destination: FlightDestination = { kind: 'coordinate', coordinate: { ...favorite.coordinate } };
    setPreviewTargetDraft(flightCoordinateDraft(favorite.coordinate));
    setPreviewTargetTyped(true);
    setPreviewDestination(destination);
    setPreviewTargetRelation(undefined);
    setPreviewTargetError(null);
    setEditingPreviewTarget(false);
    refreshFlightPreview(previewSourceId ?? planetId, destination, null);
  };

  const toggleFavorite = () => {
    if (!favoriteCoordinate) return;
    const target: FleetFavoriteTarget = { coordinate: favoriteCoordinate, ...(favoriteName ? { name: favoriteName } : {}) };
    updateFleetUi({ kind: 'toggle-favorite', target });
  };

  const previewTargetLabel = previewTargetError
    ? `[${previewTargetDraft.galaxy || '—'}:${previewTargetDraft.system || '—'}:${previewTargetDraft.position || '—'}]`
    : previewCoordinate
      ? flightCoordinateLabel(previewCoordinate)
      : `[${previewTargetDraft.galaxy || '—'}:${previewTargetDraft.system || '—'}:${previewTargetDraft.position || '—'}]`;

  return (
    <div className="fleet-workspace-v1" data-qa-fleet-planet={planetName} data-qa-fleet-yard-level={fleetSnapshot.shipyardLevel} data-qa-flight-launch-context={launchContext?.destination ? flightCoordinateLabel(launchContext.destination.coordinate) : undefined} data-qa-target-relation={previewTargetRelation ?? (!previewOpen ? launchContext?.targetRelation : undefined)}>
      <nav className="fc-wings" aria-label="Разделы флота" data-qa-fleet-nav>
        <FleetWing
          tone="build"
          title="Строительство"
          items={FLEET_CONSTRUCTION_NAVIGATION}
          icons={{
            ships: shipDefinitions.find((ship) => ship.id === 'battleship')?.art ?? shipDefinitions[0]?.art ?? '',
            defense: getFactionDefenseCatalog(factionId)[0]?.art ?? '',
            'commander-ships': COMMANDER_COMBAT_CATALOG[0]?.art ?? '',
            repair: missionRepairIcon,
          }}
          isActive={(id) => selectedSection === id && (id !== 'ships' || constructionView === 'ships')}
          onSelect={chooseSection}
        />
        <span className="fc-wings__gap" aria-hidden="true" />
        <section className="fc-wing fc-wing--command">
          <h3>Управление флотом</h3>
          <div className="fc-wing__tabs">
            <button
              type="button"
              className={selectedSection === 'ships' && constructionView === null ? 'is-on' : ''}
              aria-current={selectedSection === 'ships' && constructionView === null ? 'page' : undefined}
              data-qa-fleet-section="root"
              onClick={openFleetRoot}
            >
              <img src={missionSpaceFlightIcon} alt="" draggable={false} />
              <span>Отправка флота</span>
            </button>
            <FleetWingTabs
              items={FLEET_MANAGEMENT_NAVIGATION}
              icons={{ 'combat-priority': missionPriorityIcon, battles: missionBattlesIcon, simulator: missionSimulatorIcon }}
              isActive={(id) => selectedSection === id}
              onSelect={chooseSection}
            />
          </div>
        </section>
      </nav>

      <main className={mainClassName}>
        {constructionView === 'ships' || constructionView === 'defense' || constructionView === 'commander' ? (
          <div className="fc-build">
            {constructionView === 'ships'
              ? <ShipyardView planetId={planetId} planetName={planetName} coords={coords} budget={fleetBudget} />
              : <ConstructionCatalogView planetId={planetId} mode={constructionView} planetName={planetName} coords={coords} budget={fleetBudget} />}
            {productionQueueKind ? (
              <FleetProductionQueueView
                queueKind={productionQueueKind}
                state={fleetSnapshot.fleetProduction}
                factionId={factionId}
              />
            ) : null}
          </div>
        ) : selectedSection === 'combat-priority' ? (
          <FleetCombatPriorityView planetName={planetName} coords={coords} entityLevels={entityLevels} />
        ) : selectedSection === 'battles' ? (
          <BattleReportsView planetName={planetName} coords={coords} onBack={openFleetRoot} />
        ) : selectedSection === 'simulator' ? (
          <SimulatorView planetId={planetId} planetName={planetName} coords={coords} saveState={saveState} onBack={openFleetRoot} initialScenario={simulatorHandoff} />
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
            <section className={`fleet-flights-v2${sentFlight ? ' is-sent' : ''}`}>
              {sentFlight ? <div className="fleet-sent-strip-v1" role="status" data-qa-fleet-sent-strip>
                <div>
                  <strong>{`Рейс «${flightMissionLabel(sentFlight.missionId)}» отправлен · ${saveState.planets[sentFlight.originPlanetId]?.name ?? 'ваша планета'}`}</strong>
                  <span>{nextWaveSourceId ? `Цель ${flightCoordinateLabel(sentFlight.destinationCoordinate)} сохранена · следующая волна: ${saveState.planets[nextWaveSourceId]?.name}` : `Цель ${flightCoordinateLabel(sentFlight.destinationCoordinate)} сохранена · на других планетах нет подходящих кораблей`}</span>
                </div>
                <button type="button" className="is-primary" data-qa-fleet-next-wave disabled={!nextWaveSourceId} onClick={sendNextWave}>ЕЩЁ С ДРУГОЙ ПЛАНЕТЫ</button>
                <button type="button" data-qa-fleet-sent-done onClick={() => { clearLaunchContext(); setStatus(FLEET_ROOT_STATUS); }}>ГОТОВО</button>
              </div> : <>
              <small className="fleet-flights-v2__label">В пути <b>{activeFlightRecords.length}</b></small>
              <span
                className={`fleet-flights-v2__slots fc-tip-host${flightSlots.free <= 0 ? ' is-full' : ''}`}
                data-qa-flight-slots-bar
                data-qa-flight-slots
                tabIndex={0}
              ><small>Полёты</small><b>{flightSlots.used} / {flightSlots.limit}</b><em>{flightSlots.free > 0 ? `свободно ${flightSlots.free}` : 'все заняты'}</em>
                <span className="fc-tip" role="tooltip">Одновременных полётов: занято {flightSlots.used} из {flightSlots.limit}. Лимит: 3 + 1,5 за каждый уровень науки «Компьютерные системы»; шпионские зонды лимит не занимают.</span>
              </span>
              {activeFlightRecords.length === 0 ? <span className="fleet-flights-v2__empty">Флотов в пути нет</span> : null}
              {ownFlightGroups.map((group) => <span className="fleet-flights-v2__count" key={group.missionId}><img src={flightMissionIcon(group.missionId)} alt="" />{flightMissionLabel(group.missionId)}<b>{group.count}</b></span>)}
              {nextFlightEvent ? <span className="fleet-flights-v2__next"><small>Ближайшее</small><strong>{nextFlightEvent.label} · {flightCountdown(nextFlightEvent.at, clockNow)}</strong></span> : null}
              <span className="fleet-flights-v2__spacer" />
              </>}
              <div className="fc-orbit" data-qa-fleet-satellites>
                {satelliteDefinition ? <img src={satelliteDefinition.art} alt="" draggable={false} /> : null}
                <span>{fleetSnapshot.solarSatellites > 0 ? `На орбите: ${flightNumberLabel(fleetSnapshot.solarSatellites)}` : 'На орбите нет спутников'}</span>
                <button
                  type="button"
                  className="fc-orbit__remove"
                  data-qa-satellite-dismantle
                  aria-label="Уничтожить солнечные спутники"
                  disabled={fleetSnapshot.solarSatellites <= 0}
                  onClick={() => {
                    if (fleetSnapshot.solarSatellites <= 0) return;
                    setPendingSatelliteDismantle(fleetSnapshot.solarSatellites);
                  }}
                >×</button>
              </div>
              <button type="button" onClick={() => setSpyOperationsOpen(true)} aria-haspopup="dialog">Шпионские отчёты</button>
              <button type="button" className={flightsOpen ? 'is-on' : ''} aria-expanded={flightsOpen} onClick={() => setFlightsOpen((open) => !open)} data-qa-flights-toggle>{flightsOpen ? 'Свернуть ▴' : `Все рейсы · ${activeFlightRecords.length} ▾`}</button>
            </section>
            <div className={`fleet-flights-drop-v2${flightsOpen ? ' is-open' : ''}`} data-qa-flights-drop>
            <div className="fleet-flights-drop-v2__panel">
              <div className="fleet-flight-table-v1">
                <div className="fleet-flight-row-v1 fleet-flight-head-v1">
                  <span>МИССИЯ</span><span>МАРШРУТ</span><span>СТАТУС</span><span>ОСТАЛОСЬ</span><span>ДЕЙСТВИЕ</span>
                </div>
                {activeFlightRecords.length === 0 && recentFlights.length === 0 ? <div className="fleet-flight-empty-v1" data-qa-flight-empty>
                  <img className="ui-empty-art" src={EMPTY_ART.flights} alt="" draggable={false} />
                  <strong>Активных полётов нет</strong>
                  <span>Флоты, находящиеся в пути, будут отображаться здесь.</span>
                </div> : activeFlightRecords.map((flight) => {
                  const isIncomingBotAttack = (flight.ownerSide === 'bot01' || flight.ownerSide === 'npc') && flight.missionId === 'attack';
                  const isBot01Explorer = (flight.ownerSide === 'bot01' || flight.ownerSide === 'npc') && (flight.missionId === 'expedition'||flight.explorationAttack);
                  const isIncomingPirateRaid = flight.ownerSide === 'pirate' && flight.missionId === 'pirate-raid';
                  const isHostileIncoming = isIncomingBotAttack || isIncomingPirateRaid || isBot01Explorer;
                  // Composition only from espionage 10 at the moment of viewing (owner rule); below it only the fact of the attack.
                  const incomingKnowledge = isIncomingBotAttack || isIncomingPirateRaid ? describeIncomingAttack(flight, playerEspionageLevel) : null;
                  const incomingComposition = incomingKnowledge?.composition ?? null;
                  const incomingCompositionLabel = incomingComposition?.kind === 'pirate'
                    ? `УГРОЗА ${flightNumberLabel(incomingComposition.population)} НАСЕЛЕНИЯ · ${(Object.entries(incomingComposition.ships) as [PirateBaseShipId, number][])
                      .map(([id, count]) => `${PIRATE_CATALOG_BY_ID[id].name} ×${flightNumberLabel(count)}`).join(' · ') || 'КОРАБЛЕЙ НЕТ'}`
                    : incomingComposition?.kind === 'fleet'
                      ? [
                        ...(Object.entries(incomingComposition.ships) as [ShipId, number][]).map(([id, count]) =>
                          `${getFactionShipCatalog(flight.attackSnapshot?.attackerFactionId ?? factionId).find((ship) => ship.id === id)?.name ?? id} ×${flightNumberLabel(count)}`),
                        ...(Object.keys(incomingComposition.commanders) as CommanderId[]).map((id) => `Командир ${getCommanderPresentedAbility(id).commanderName}`),
                      ].join(' · ') || 'КОРАБЛЕЙ НЕТ'
                      : '';
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
                  <span className="fleet-flight-mission-cell"><img className="fleet-flight-mission-icon" src={flightMissionIcon(flight.missionId)} alt="" /><span>{(flight.ownerSide !== 'bot01' && flight.ownerSide !== 'npc' && (flight.missionId === 'expedition' || flight.explorationAttack)) ? <button type="button" className="fleet-expedition-details-trigger" onClick={() => setSelectedExpeditionFlightId(flight.id)} data-qa-expedition-flight-details={flight.id}>ЭКСПЕДИЦИЯ · ПОДРОБНЕЕ ↗</button> : flight.explorationAttack ? 'БОЕВОЙ ЗАХВАТ · ЭКСПЕДИЦИЯ' : !isHostileIncoming && flight.ownerSide !== 'npc' ? <button type="button" className="fleet-expedition-details-trigger" onClick={() => setSelectedFlightDetailsId(flight.id)} data-qa-flight-details={flight.id}>{flightMissionLabel(flight.missionId)} · ПОДРОБНЕЕ ↗</button> : flightMissionLabel(flight.missionId)}{incomingKnowledge ? incomingComposition
                    ? <small data-qa-incoming-composition data-qa-pirate-raid-force={isIncomingPirateRaid || undefined}>{incomingCompositionLabel}</small>
                    : <small data-qa-incoming-composition-hidden>СОСТАВ СКРЫТ · ШПИОНАЖ {INCOMING_ATTACK_COMPOSITION_ESPIONAGE_LEVEL}</small> : null}{isIncomingBotAttack && flight.ownerSide === 'bot01' ? <small data-qa-flight-bot01-label>BOT 01</small> : null}{attackOrder && !isHostileIncoming ? <small data-qa-flight-attack-order>АТАКА #{attackOrder}</small> : null}</span>{liveTransportState.overflowWarning ? <b className="fleet-flight-overflow-warning" aria-label="Часть груза может сгореть: склады цели заполнены" data-qa-flight-overflow-warning>!</b> : null}</span>
                  <span className="fleet-flight-route-cell">
                    <span data-qa-flight-origin>{flight.ownerSide === 'npc' && flight.missionId === 'aid' ? <><strong>СОЮЗНИК</strong><small>помощь по запросу</small></> : isIncomingBotAttack || isBot01Explorer || isIncomingPirateRaid ? <><strong>{flightOwnerLabel(flight, saveState.espionage?.targets)}</strong><CoordinateLink coordinate={flight.originCoordinate} /></> : <><strong>{saveState.planets[flight.originPlanetId]?.name ?? 'Ваша планета'}</strong><CoordinateLink coordinate={flight.originCoordinate} /></>}</span>
                    <b className="fleet-flight-route-arrow" aria-hidden="true">→</b>
                    <span data-qa-flight-target><strong data-qa-space-flight-targetless={flight.missionId === 'space-flight' || undefined}>{flight.missionId === 'space-flight' ? 'Без планетарной цели' : flight.targetPlanetName ?? <CoordinateLink coordinate={flight.destinationCoordinate} />}</strong>{flight.missionId !== 'space-flight' && flight.targetPlanetName && flight.destinationCoordinate ? <CoordinateLink coordinate={flight.destinationCoordinate} /> : null}{flight.targetOwnerName || flight.targetRelation === 'ally' || flight.targetRelation === 'self' || targetUnavailable ? <small>{flight.targetOwnerName ?? ''}{flight.targetRelation === 'ally' ? ' · СОЮЗНИК' : flight.targetRelation === 'self' ? ' · СВОЯ' : ''}{targetUnavailable ? <b data-qa-flight-target-unavailable> · ЦЕЛЬ НЕДОСТУПНА</b> : null}</small> : null}</span>
                  </span>
                  <span data-qa-flight-status>{statusLabel}</span>
                  <span className="fleet-flight-time-cell">
                    {flight.phase === 'outbound' ? <small>до прибытия</small> : flight.phase === 'returning' ? <small>до возврата</small> : null}
                    <strong data-qa-flight-arrival data-qa-flight-arrival-at={flight.arrivalAt} hidden={flight.phase !== 'outbound'}>{flight.phase === 'outbound' ? flightCountdown(flight.arrivalAt, clockNow) : '—'}</strong>
                    <strong data-qa-flight-return hidden={flight.phase !== 'returning'}>{flight.phase === 'returning' ? flightCountdown(flight.returnAt, clockNow) : '—'}</strong>
                    {flight.phase !== 'outbound' && flight.phase !== 'returning' ? <strong>—</strong> : null}
                  </span>
                  <span className="fleet-flight-actions-cell">{!isHostileIncoming && canRepeatFlight(saveState, flight) ? <button type="button" data-qa-flight-repeat={flight.id} onClick={() => repeatFlight(flight)}>ПОВТОРИТЬ</button> : null}{isHostileIncoming || (flight.ownerSide === 'npc' && flight.missionId === 'aid') ? <span aria-label="Чужой флот нельзя отозвать" data-qa-flight-no-recall>—</span> : <button type="button" data-qa-flight-recall={flight.id} disabled={flight.phase !== 'outbound' && !((flight.missionId === 'expedition' || flight.explorationAttack) && flight.phase === 'arrived')} onClick={() => setPendingRecall(flight)}>ОТОЗВАТЬ</button>}</span>
                </div>;
                })}
                {recentFlights.length ? <div className="fleet-flight-recent-head-v1">НЕДАВНО ЗАВЕРШЁННЫЕ</div> : null}
                {recentFlights.map((flight) => <div className="fleet-flight-row-v1 is-recent" key={flight.id} data-qa-flight-recent={flight.id}>
                  <span className="fleet-flight-mission-cell"><img className="fleet-flight-mission-icon" src={flightMissionIcon(flight.missionId)} alt="" /><span>{flightMissionLabel(flight.missionId).toUpperCase()}<small>{Object.entries(flight.selectedShips).filter(([, quantity]) => (quantity ?? 0) > 0).map(([id, quantity]) => `${shipDefinitions.find((ship) => ship.id === id)?.name ?? id} ×${flightNumberLabel(quantity ?? 0)}`).join(' · ')}</small></span></span>
                  <span className="fleet-flight-route-cell">
                    <span><strong>{saveState.planets[flight.originPlanetId]?.name ?? 'Ваша планета'}</strong><CoordinateLink coordinate={flight.originCoordinate} /></span>
                    <b className="fleet-flight-route-arrow" aria-hidden="true">→</b>
                    <span><strong>{flight.targetPlanetName ?? <CoordinateLink coordinate={flight.destinationCoordinate} />}</strong>{flight.targetPlanetName ? <CoordinateLink coordinate={flight.destinationCoordinate} /> : null}</span>
                  </span>
                  <span>ВЕРНУЛСЯ</span>
                  <span className="fleet-flight-time-cell"><strong>—</strong></span>
                  <span className="fleet-flight-actions-cell"><button type="button" data-qa-flight-repeat={flight.id} onClick={() => repeatFlight(flight)}>ПОВТОРИТЬ</button></span>
                </div>)}
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

            <div className="fc-deck">
            <section className="fc-hangar" aria-label="Корабли на планете">
              <header className="fc-hangar__head">
                <h2>Корабли на планете</h2>
                <small className="fc-hangar__yard">{shipyardPresentation.name} {fleetSnapshot.shipyardLevel} · {getBuildingPresentation('hangar', factionId).name} {fleetSnapshot.hangarLevel}</small>
                <div className="fc-chips" role="group" aria-label="Фильтр кораблей">
                  {(['all', 'combat', 'civil'] as const).map((filter) => <button key={filter} type="button" className={shipFilter === filter ? 'is-on' : ''} aria-pressed={shipFilter === filter} onClick={() => setShipFilter(filter)}>{filter === 'all' ? 'Все' : filter === 'combat' ? 'Боевые' : 'Гражданские'}</button>)}
                </div>
                <div className="fc-hangar__all">
                  <button type="button" data-qa-fleet-select-all onClick={() => setAllShipQuantities(true)}>ВЫБРАТЬ ВСЕ</button>
                  <button type="button" data-qa-fleet-select-none disabled={selectedShipCount <= 0} onClick={() => setAllShipQuantities(false)}>СБРОСИТЬ</button>
                </div>
              </header>

              <div className="fc-roster" data-qa-fleet-roster>
                {visibleShipDefinitions.filter((ship) => shipFilter === 'all' || (shipFilter === 'civil') === CIVIL_SHIP_IDS.has(ship.id)).map((ship) => {
                  const available = sourceFleet.ships[ship.id] ?? 0;
                  const selected = selectedQuantities[ship.id] ?? 0;
                  return (
                    <div className={`fc-ship${selected > 0 ? ' is-picked' : ''}`} key={ship.id} data-qa-fleet-ship={ship.id}>
                      <div className="fc-ship__art"><img src={ship.art} alt={ship.name} draggable={false} /></div>
                      <h3>{ship.name}</h3>
                      <p className="fc-ship__have">
                        на планете <b data-qa-fleet-owned={available}>{flightNumberLabel(available)}</b>
                        <span className="fc-ship__pop"><ResourceIcon kind="population" label="Население за штуку" /><span data-qa-fleet-unit-population>{ship.population}</span></span>
                      </p>
                      <div className="fc-ship__amount">
                        <input aria-label={`Количество ${ship.name}`} type="number" min="0" max={available} value={selected} onChange={(event) => setShipQuantity(ship.id, Number(event.target.value))} />
                        <button type="button" onClick={() => setShipQuantity(ship.id, 0)} disabled={selected <= 0}>МИН.</button>
                        <button type="button" onClick={() => setShipQuantity(ship.id, available)} disabled={selected >= available}>МАКС.</button>
                      </div>
                      <AmountSlider compact value={selected} max={available} label={`Количество: ${ship.name}`} onChange={(value) => setShipQuantity(ship.id, value)} qa={ship.id} />
                    </div>
                  );
                })}
                {ownedShipDefinitions.length === 0 ? (
                  <div className="fc-empty" data-qa-fleet-roster-empty>
                    <img className="ui-empty-art" src={EMPTY_ART.flights} alt="" draggable={false} />
                    <strong>На этой планете нет кораблей</strong>
                    <span>Постройте их на верфи или перебросьте с другой планеты.</span>
                    <button type="button" className="asterion-button asterion-button--primary" onClick={() => chooseSection('ships')}>К строительству кораблей</button>
                  </div>
                ) : visibleShipDefinitions.length === 0 ? (
                  <div className="fc-empty" data-qa-fleet-roster-empty>
                    <strong>Для миссии «{selectedMission.label}» здесь нет подходящих кораблей</strong>
                    <span>Выберите другую миссию или постройте нужные корабли.</span>
                  </div>
                ) : null}
              </div>

            </section>

            <section className="fc-orders" aria-label="Миссия" data-qa-mission-current={missionId}>
              <h2>Миссия</h2>
              <div className="fc-missions" aria-label="Выбор миссии">
                {missions.map((mission) => (
                  <button
                    key={mission.id}
                    type="button"
                    className={mission.id === missionId ? 'is-on' : ''}
                    aria-label={mission.label}
                    aria-pressed={mission.id === missionId}
                    disabled={mission.enabled === false}
                    data-qa-mission-id={mission.id}
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
              <p className="fc-mission-text"><strong>{describedMission.label}.</strong> {describedMission.enabled === false ? 'Пока недоступно. ' : ''}{describedMission.description}</p>

              {missionId === 'attack' || missionId === 'pirate-elimination' || missionId === 'deployment' || missionId === 'space-flight' || missionId === 'sun-support' ? <div className="fc-prep" data-qa-attack-prep={missionId === 'attack' || missionId === 'pirate-elimination' ? true : undefined} data-qa-deployment-commanders={missionId === 'deployment' ? true : undefined} data-qa-space-flight-prep={missionId === 'space-flight' ? true : undefined}>
                {missionId === 'attack' || missionId === 'pirate-elimination' ? <div className="fc-prep__line" role="radiogroup" aria-label="Лимит раундов атаки" data-qa-attack-rounds>
                  <h3>Раундов боя</h3>
                  {([5, 8, 12] as const).map((rounds) => <button key={rounds} type="button" role="radio" aria-checked={attackRounds === rounds} className={attackRounds === rounds ? 'is-on' : ''} data-qa-attack-round={rounds} onClick={() => setAttackRounds(rounds)}>{rounds}</button>)}
                </div> : null}
                {missionId === 'space-flight' ? <label className="fc-prep__line" data-qa-space-flight-duration>
                  <h3>В одну сторону</h3>
                  <input type="number" min="5" max="719" step="1" value={oneWayDurationMinutes} aria-label="Длительность космического рейса в одну сторону, минуты" onChange={(event) => {
                    if (event.currentTarget.value === '') return;
                    const value = Number(event.currentTarget.value);
                    if (Number.isFinite(value)) setOneWayDurationMinutes(Math.max(5, Math.min(719, Math.floor(value))));
                  }} />
                  <span>минут, обратно столько же</span>
                </label> : null}
                <div className="fc-prep__commanders">
                  <h3>Командиры <b>{selectedCommanderCount}</b></h3>
                  <p>{missionId === 'sun-support' ? 'В бою у Солнца сторону ведёт командир наивысшего уровня среди всех отправленных.' : missionId === 'deployment' ? 'Командиры сохраняют уровень и способность при переводе.' : missionId === 'space-flight' ? 'Можно отправить только командирские корабли; спутники и оборона остаются на планете.' : 'Свободные командиры резервируются вместе с флотом.'}</p>
                  {Object.keys(commanderAvailability).length ? <div className="fc-prep__list">
                    {COMMANDER_IDS.filter((commanderId) => (commanderAvailability[commanderId] ?? 0) > 0).map((commanderId) => {
                      const commander = getCommanderPresentedAbility(commanderId);
                      const checked = (selectedCommanders[commanderId] ?? 0) > 0;
                      return <label key={commanderId} className={checked ? 'is-on' : ''}>
                        <input type="checkbox" checked={checked} onChange={(event) => setSelectedCommanders((current) => {
                          const next = { ...current };
                          if (event.target.checked) next[commanderId] = 1;
                          else delete next[commanderId];
                          return next;
                        })} />
                        <span>{commander.commanderName}</span>
                      </label>;
                    })}
                  </div> : <p className="fleet-attack-commanders-empty">Свободных командиров нет.</p>}
                </div>
              </div> : null}
            </section>
            </div>

            <footer className="fc-dock" data-toast-guard>
              <div><b data-qa-fleet-selected>{flightNumberLabel(selectedShipCount)}</b><small>кораблей выбрано</small></div>
              <div><b>{flightNumberLabel(selectedPopulation)}</b><small>население рейса</small></div>
              <div data-qa-fleet-population={fleetSummary.population} data-qa-fleet-capacity={fleetSummary.capacity} data-qa-fleet-available-ships={availableShipCount} data-qa-fleet-satellite-count={fleetSnapshot.solarSatellites}><b>{flightNumberLabel(fleetSummary.population)} / {flightNumberLabel(fleetSummary.capacity)}</b><small>население флота</small></div>
              <span className="fc-dock__status" data-qa-fleet-status>{status}</span>
              <button type="button" className="fc-dock__go asterion-button asterion-button--primary" data-qa-flight-preview-open disabled={!hasLaunchableComposition} onClick={() => openFlightPreview()}>Дальше: план перелёта</button>
            </footer>
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
      {selectedFlightDetailsId && (() => {
        const flight = flightRecords.find((item) => item.id === selectedFlightDetailsId);
        if (!flight) return null;
        const close = () => setSelectedFlightDetailsId(null);
        const ships = Object.entries(flight.selectedShips).filter(([, count]) => (count ?? 0) > 0).map(([id, count]) => {
          const entity = shipDefinitions.find((ship) => ship.id === id);
          return { id, count: count ?? 0, name: entity?.name ?? id, art: entity?.art, cargo: (entity?.ship?.cargo ?? 0) * (count ?? 0) };
        });
        const commanders = Object.values(flight.selectedCommanders ?? {}).reduce((sum, count) => sum + (count ?? 0), 0);
        const hold = flight.recycleCapacity ?? flight.gasCapacity ?? ships.reduce((sum, ship) => sum + ship.cargo, 0);
        const cargo = flight.cargo ? (['metal', 'minerals', 'gas', 'debris'] as const).filter((kind) => (flight.cargo?.[kind as keyof typeof flight.cargo] ?? 0) > 0) : [];
        const cargoLabels = { metal: 'Металл', minerals: 'Минералы', gas: 'Газ', debris: 'Обломки' } as const;
        const recallable = flight.phase === 'outbound';
        const phaseLabel = flight.phase === 'outbound' ? 'В ПУТИ К ЦЕЛИ' : flight.phase === 'returning' ? 'ВОЗВРАЩАЕТСЯ' : flight.phase === 'arrived' ? 'НА МЕСТЕ' : 'ЗАВЕРШЁН';
        const phaseAt = flight.phase === 'outbound' ? flight.arrivalAt : flight.phase === 'returning' ? flight.returnAt : undefined;
        const steps = [
          { label: 'ВЫЛЕТ', at: flight.departedAt, done: true },
          { label: flight.missionId === 'space-flight' ? 'РАЗВОРОТ' : 'ПРИБЫТИЕ', at: flight.arrivalAt, done: flight.phase !== 'outbound' },
          ...(flight.returnAt ? [{ label: 'ВОЗВРАТ', at: flight.returnAt, done: flight.phase === 'completed' }] : []),
        ];
        return createPortal(<div className="resource-building-action-confirm-backdrop" data-qa-flight-details-backdrop onMouseDown={close}>
          <section className={`resource-building-action-confirm fleet-expedition-details flight-details-v3${MISSION_BANNERS[flight.missionId] ? ' has-banner' : ''}`} style={MISSION_BANNERS[flight.missionId] ? { '--mission-banner': `url("${MISSION_BANNERS[flight.missionId]}")` } as CSSProperties : undefined} role="dialog" aria-modal="true" aria-label="Подробности рейса" data-qa-flight-details-dialog onMouseDown={(event) => event.stopPropagation()}>
            <header>
              <div>
                <small>АКТИВНЫЙ РЕЙС · {flightMissionLabel(flight.missionId).toUpperCase()}</small>
                <h3>{flight.missionId === 'space-flight' ? 'Космический рейс' : flight.targetPlanetName ?? flightCoordinateLabel(flight.destinationCoordinate)}</h3>
                <span>{saveState.planets[flight.originPlanetId]?.name ?? 'Ваша планета'} {flightCoordinateLabel(flight.originCoordinate)} → {flight.missionId === 'space-flight' ? 'без цели' : flightCoordinateLabel(flight.destinationCoordinate)}{flight.targetOwnerName ? ` · ${flight.targetOwnerName}` : ''}</span>
              </div>
              <button type="button" data-asterion-close aria-label="Закрыть подробности рейса" onClick={close}>×</button>
            </header>
            <div className="fleet-expedition-status"><span>{phaseLabel}</span><strong>{phaseAt ? flightCountdown(phaseAt, clockNow) : '—'}</strong></div>
            <ol className="flight-details-v3__timeline">
              {steps.map((step) => <li key={step.label} className={step.done ? 'is-done' : ''}><b /><small>{step.label}</small><strong>{flightArrivalLabel(step.at)}</strong><em>{step.at > clockNow ? `через ${flightCountdown(step.at, clockNow)}` : 'пройдено'}</em></li>)}
            </ol>
            <div className="fleet-expedition-metrics flight-details-v3__metrics">
              <div><small>РАССТОЯНИЕ</small><strong>{flight.routeDistance ? `${flightNumberLabel(flight.routeDistance)} ед.` : '—'}</strong></div>
              <div><small>СКОРОСТЬ</small><strong>{flight.effectiveSpeed ? flightNumberLabel(flight.effectiveSpeed) : '—'}</strong></div>
              <div><small>НАСЕЛЕНИЕ</small><strong>{flightNumberLabel(flight.populationReserved)}</strong></div>
              <div><small>ГАЗ</small><strong>{flightNumberLabel(flight.gasCost)}</strong></div>
              <div><small>{flight.recycleCapacity !== undefined ? 'ТРЮМ ОБЛОМКОВ' : flight.gasCapacity !== undefined ? 'ТРЮМ ГАЗА' : 'ТРЮМ'}</small><strong>{flightNumberLabel(hold)}</strong></div>
            </div>
            {cargo.length ? <div className="fleet-expedition-resources">{cargo.map((kind) => <div key={kind}><ResourceIcon kind={kind} /><span><b>{cargoLabels[kind]}</b><small>в трюме</small></span><strong>{flightNumberLabel(flight.cargo?.[kind as keyof typeof flight.cargo] ?? 0)}</strong></div>)}</div> : null}
            <div className="flight-composition-v3 flight-details-v3__ships" data-qa-flight-details-ships>
              {ships.map((ship) => <article className="flight-timeline-ship-card flight-composition-v3__row" key={ship.id}>{ship.art ? <img src={ship.art} alt="" /> : <span />}<div><strong>{ship.name}</strong><small>трюм {flightNumberLabel(ship.cargo)}</small></div><b>×{flightNumberLabel(ship.count)}</b></article>)}
              {commanders ? <footer className="flight-composition-v3__total"><span>КОМАНДИРСКИЕ КОРАБЛИ</span><b>{commanders}</b></footer> : null}
            </div>
            <div className="flight-details-v3__actions">
              {recallable ? <button type="button" className="is-danger" data-qa-flight-details-recall onClick={() => { close(); setPendingRecall(flight); }}>ОТОЗВАТЬ</button> : null}
              <button type="button" className="fleet-expedition-close" onClick={close}>ЗАКРЫТЬ</button>
            </div>
          </section>
        </div>, document.body);
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
          <section className={`resource-building-action-confirm flight-preview-modal flight-timeline-modal flight-briefing-v2`} role="dialog" aria-modal="true" aria-labelledby="flight-preview-title" onMouseDown={(event) => event.stopPropagation()}>
            <header className="flight-timeline-head">
              <MissionIcon mission={selectedMission} />
              <div>
                <small>ФЛОТЫ · {selectedMission.label.toUpperCase()}</small>
                <h3 id="flight-preview-title">ПЛАН ПЕРЕЛЁТА</h3>
                <p>{selectedMission.description}</p>
              </div>
              <button type="button" className="flight-timeline-close" data-asterion-close aria-label="Закрыть план перелёта" onClick={closeFlightPreview}>×</button>
              </header>
            <div className="flight-timeline-body">
              <div className="flight-briefing-v2__left">
              <ol className="flight-timeline-steps" aria-label="Шаги подготовки рейса">
                <li className="flight-timeline-step is-complete" data-qa-flight-source-step>
                  <span aria-hidden="true">01</span>
                  <div>
                    <small>ИСТОЧНИК</small>
                    {sourceOptions.length > 1 ? <label className="flight-timeline-own-target flight-source-select-v1">
                      <GameSelect
                        label="Планета, с которой летит флот"
                        value={previewSourceId ?? planetId}
                        onChange={changePlanSource}
                        selectProps={{ 'data-qa-flight-source-select': true }}
                        options={sourceOptions.map((option) => ({
                          value: option.id,
                          label: `${option.name} [${option.coordinate.galaxy}:${option.coordinate.system}:${option.coordinate.position}]`,
                          hint: `${flightNumberLabel(option.eligibleShips)} ${shipCountLabel(option.eligibleShips).toLowerCase()}`,
                          data: { 'data-qa-flight-source-option': option.id },
                        }))}
                      />
                    </label> : <strong>{previewSource?.name ?? planetName}</strong>}
                    <em>{previewSourceId && previewSourceId !== planetId ? 'выбрано флотом · текущая планета не меняется' : `${previewSource ? `[${previewSource.universeGalaxy}:${previewSource.universeSystem}:${previewSource.universePosition}]` : coords} · выбрано флотом`}</em>
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
                    {favoriteMission && favoriteTargets.length && (editingPreviewTarget || !favoriteCoordinate) ? <label className="flight-timeline-own-target" data-qa-flight-favorite-select>
                      <span>ИЗБРАННОЕ</span>
                      <GameSelect
                        label="Избранные цели"
                        value=""
                        onChange={chooseFavoriteTarget}
                        options={[
                          { value: '', label: `Выбрать из избранного · ${favoriteTargets.length}` },
                          ...favoriteTargets.map((favorite, index) => ({ value: String(index), label: `${favorite.name ? `${favorite.name} ` : ''}${flightCoordinateLabel(favorite.coordinate)}` })),
                        ]}
                      />
                    </label> : null}
                    {missionId === 'expedition' ? <label className="flight-timeline-own-target" data-qa-expedition-target-select>
                      <span>УНИКАЛЬНЫЙ ОБЪЕКТ / АНОМАЛИЯ · ±5 СИСТЕМ</span>
                      <GameSelect
                        label="Выберите объект экспедиции"
                        value={currentExpeditionTarget?.id ?? ''}
                        onChange={selectExpeditionTarget}
                        options={[
                          { value: '', label: 'Выберите объект экспедиции' },
                          ...expeditionTargetOptions.map((target) => {
                            const status = explorationTargetStatus(previewRuntimeState!, target);
                            const c = target.coordinate;
                            return {
                              value: target.id,
                              disabled: status !== 'free',
                              label: `${target.name} · [${c.galaxy}:${c.system}:${c.position}]`,
                              hint: status === 'self' ? 'ваш флот добывает' : status === 'occupied' ? 'занято, доступна атака' : undefined,
                            };
                          }),
                        ]}
                      />
                      {expeditionTargetOptions.length === 0 ? <small>В радиусе пяти систем от колоний сейчас нет активных объектов.</small> : null}
                      <small className="fleet-expedition-mining-warning">
                        Для обломков нужны переработчики. Транспортёры добывают металл, минералы и газ, но не обломки.
                        Узнать состав и остаток запаса можно по успешному исследованию в «Операциях» → «Система».
                        После разведки отправка заведомо неэффективного флота блокируется.
                      </small>
                    </label> : missionId === 'pirate-elimination' ? <label className="flight-timeline-own-target" data-qa-pirate-target-select><span>ВЫБЕРИТЕ ПИРАТОВ</span><GameSelect label="Выберите пиратскую базу" value={currentPirateTarget?.contactCycleKey ?? ''} onChange={selectPirateTarget} options={[{ value: '', label: 'Выберите пиратов' }, ...pirateTargetOptions.map((target) => ({ value: target.contactCycleKey, label: `Пиратская база [${target.coordinate.galaxy}:${target.coordinate.system}:${target.coordinate.position}]` }))]} />{pirateTargetOptions.length === 0 ? <small>В солнечных системах ваших планет сейчас нет доступных пиратских контактов.</small> : null}</label> : missionId === 'sun-support' ? <label className="flight-timeline-own-target" data-qa-sun-target-select><span>ВЫБЕРИТЕ СОЛНЦЕ</span><GameSelect label="Выберите Солнце под атакой" value={currentSunTarget?.operationId ?? ''} onChange={selectSunTarget} options={[{ value: '', label: 'Солнце под атакой' }, ...sunTargetOptions.map((target) => ({ value: target.operationId, label: target.label }))]} />{sunTargetOptions.length === 0 ? <small>Сейчас ни одно Солнце в галактиках ваших планет не атаковано.</small> : <small>Лимит защиты — {sunRaidCapsOf(previewRuntimeState ?? {}).perSide.toLocaleString('ru-RU')} населения на сторону; флот должен прибыть раньше атакующих.</small>}</label> : missionId === 'aid' ? <div className="flight-timeline-own-target" data-qa-aid-target>
                      <label>
                        <span>ОТКРЫТЫЙ ЗАПРОС СОЮЗНИКА</span>
                        <GameSelect
                          label="Выберите запрос союзника"
                          value={aidRequest?.status === 'open' ? aidRequest.id : ''}
                          onChange={selectAidRequest}
                          selectProps={{ 'data-qa-aid-request-select': true }}
                          options={[
                            { value: '', label: 'Выберите запрос' },
                            ...aidOptions.map((request) => {
                              const progress = selectRequestProgress(previewRuntimeState!, request);
                              return { value: request.id, disabled: progress.remainder <= 0, label: `${request.authorName} · ${request.planetName} · ${AID_RESOURCE_LABELS[request.resource]} · осталось ${flightNumberLabel(progress.remainder)}` };
                            }),
                          ]}
                        />
                      </label>
                      {aidOptions.length === 0 ? <small>В вашем союзе сейчас нет открытых запросов, которые вы можете выполнить.</small> : null}
                      {aidRequest && aidProgress ? <small data-qa-aid-request-summary>{`${aidRequest.planetName} ${flightCoordinateLabel(aidRequest.coordinate)} · запрошено ${flightNumberLabel(aidProgress.requested)} · доставлено ${flightNumberLabel(aidProgress.delivered)} · в пути ${flightNumberLabel(aidProgress.inFlight)} · можно отправить до ${flightNumberLabel(aidProgress.remainder)}`}</small> : null}
                    </div> : missionId === 'transport' && isReadOnlyAllyTarget ? <div className="flight-timeline-readonly-target" data-qa-transport-target-readonly>
                      <span>СОЮЗНАЯ ПЛАНЕТА</span>
                      <strong>{previewTargetPlanet?.name ?? 'Союзная планета'} {previewTargetDestination?.kind === 'planet' ? flightCoordinateLabel(previewTargetDestination.coordinate) : ''}</strong>
                    </div> : missionId === 'transport' || missionId === 'deployment' ? <label className="flight-timeline-own-target" data-qa-transport-target-select={missionId === 'transport' ? true : undefined} data-qa-deployment-target-select={missionId === 'deployment' ? true : undefined}><span>СВОЯ ПЛАНЕТА</span><GameSelect label="Своя планета" value={selectedTransportTargetId} onChange={selectTransportTarget} options={[{ value: '', label: 'Выберите планету' }, ...transportTargetOptions.map((target) => {
                      const locked = missionId === 'deployment' && target.blocked;
                      const countdown = target.noEligibleBurnUnits
                        ? 'нет обычных кораблей для сгорания'
                        : target.unlockAt === undefined
                          ? 'ожидание начала таймера'
                          : `до разблокировки ${flightCountdown(target.unlockAt, clockNow)}`;
                      return {
                        value: target.id,
                        disabled: locked,
                        ariaLabel: locked ? `${target.name}, заблокирована: население ${flightNumberLabel(target.actualPopulation ?? 0)}, вместимость ${flightNumberLabel(target.capacity ?? 0)}, ${countdown}` : undefined,
                        data: { 'data-qa-deployment-target-locked': locked || undefined },
                        label: locked ? target.name : `Своя · ${target.name} [${target.coordinate.galaxy}:${target.coordinate.system}:${target.coordinate.position}]${target.id === lastOwnTargetId ? ' · последняя цель' : ''}`,
                        hint: locked ? `население ${flightNumberLabel(target.actualPopulation ?? 0)} / вместимость ${flightNumberLabel(target.capacity ?? 0)} · ${countdown}` : undefined,
                      };
                    })]} /></label> : null}
                    {missionId === 'expedition' ? <strong>{currentExpeditionTarget ? flightCoordinateLabel(currentExpeditionTarget.coordinate) : 'Цель не выбрана'}</strong> : missionId === 'pirate-elimination' ? <strong>{currentPirateTarget ? flightCoordinateLabel(currentPirateTarget.coordinate) : 'Цель не выбрана'}</strong> : missionId === 'sun-support' ? <strong>{currentSunTarget ? `Солнце [${currentSunTarget.raid.galaxy}:${currentSunTarget.raid.system}:0]` : 'Цель не выбрана'}</strong> : sunDebrisTarget ? <strong data-qa-sun-debris-target>{`Обломки Солнца [${sunDebrisTarget.galaxy}:${sunDebrisTarget.system}:0]`}</strong> : missionId === 'aid' ? null : missionId !== 'deployment' && !isReadOnlyTarget && editingPreviewTarget ? <div className="flight-timeline-coordinate-inputs" data-qa-flight-target-inputs>
                      <label><span>Галактика</span><input name="flight-preview-target-galaxy" inputMode="numeric" value={previewTargetDraft.galaxy} onInput={(event) => changePreviewTargetField('galaxy', event.currentTarget.value)} onChange={(event) => changePreviewTargetField('galaxy', event.currentTarget.value)} aria-label="Галактика цели" /></label>
                      <label><span>Система</span><input name="flight-preview-target-system" inputMode="numeric" value={previewTargetDraft.system} onInput={(event) => changePreviewTargetField('system', event.currentTarget.value)} onChange={(event) => changePreviewTargetField('system', event.currentTarget.value)} aria-label="Система цели" /></label>
                      <label><span>Позиция</span><input name="flight-preview-target-position" inputMode="numeric" value={previewTargetDraft.position} onInput={(event) => changePreviewTargetField('position', event.currentTarget.value)} onChange={(event) => changePreviewTargetField('position', event.currentTarget.value)} aria-label="Позиция цели" /></label>
                    </div> : !isReadOnlyTarget && missionId !== 'deployment' ? <strong>{previewTargetLabel}</strong> : isReadOnlySpyTarget ? <strong>{launchContext?.targetPlanetName ?? previewTargetLabel}</strong> : null}
                    <div className={`flight-timeline-target-status ${previewTargetError ? 'is-invalid' : 'is-valid'}`} data-qa-flight-target-status>
                      <span data-qa-target-relation={previewTargetRelation}>{previewTargetError ?? (missionId === 'expedition' && !currentExpeditionTarget ? 'Выберите свободный объект' : missionId === 'pirate-elimination' && !currentPirateTarget ? 'Выберите действующий пиратский контакт' : missionId === 'sun-support' && !currentSunTarget ? 'Выберите Солнце под атакой' : missionId === 'sun-support' && previewResult && !previewResult.ok ? previewResult.error.message : missionId === 'deployment' && !previewTargetDestination ? 'Выберите свою планету' : missionId === 'recycle' && previewResult && !previewResult.ok ? previewResult.error.message : previewTargetRelation === 'ally' ? 'Союзная планета' : previewTargetRelation === 'self' ? 'Своя планета' : previewTargetRelation === 'neutral' && previewResult?.ok ? 'Нейтральная планета' : previewTargetRelation === 'enemy' && previewResult?.ok ? 'Вражеская планета' : previewResult?.ok ? 'Цель подтверждена' : 'Координаты будут проверены при отправке')}</span>
                      {!isReadOnlyTarget && !sunDebrisTarget && missionId !== 'deployment' && missionId !== 'aid' && missionId !== 'pirate-elimination' && missionId !== 'expedition' && missionId !== 'sun-support' ? <button type="button" className="flight-timeline-edit" onClick={togglePreviewTargetEditing}>{editingPreviewTarget ? missionId === 'recycle' ? 'ПРОВЕРИТЬ' : 'ГОТОВО' : 'ИЗМЕНИТЬ'}</button> : null}
                      {favoriteMission && favoriteCoordinate && !sunDebrisTarget ? <button type="button" className={`flight-timeline-edit flight-favorite-toggle-v1${targetIsFavorite ? ' is-on' : ''}`} aria-pressed={targetIsFavorite} onClick={toggleFavorite} data-qa-flight-favorite-toggle>{targetIsFavorite ? '★ В ИЗБРАННОМ' : '☆ В ИЗБРАННОЕ'}</button> : null}
                    </div>
                    </>}
                  </div>
                </li>
              </ol>
              </div>
              <div className="flight-briefing-v2__right">
              <section className="flight-plan-fleet" aria-label="Состав флота">
                <small>СОСТАВ ФЛОТА</small>
                    <div className="flight-timeline-ship-list flight-composition-v3" data-qa-flight-ships>{visibleShipDefinitions.filter((ship) => (selectedQuantities[ship.id] ?? 0) > 0).map((ship) => {
                      const quantity = selectedQuantities[ship.id] ?? 0;
                      const entity = shipDefinitions.find((item) => item.id === ship.id);
                      return <article className="flight-timeline-ship-card flight-composition-v3__row" key={ship.id}>
                        <img src={ship.art} alt="" />
                        <div><strong>{ship.name}</strong><small>Население: {quantity * ship.population} · трюм {flightNumberLabel((entity?.ship?.cargo ?? 0) * quantity)} · скорость {flightNumberLabel(entity?.ship?.speed ?? 0)}</small></div>
                        <b>×{flightNumberLabel(quantity)}<small>{shipCountLabel(quantity)}</small></b>
                      </article>;
                    })}
                    <footer className="flight-composition-v3__total" data-qa-flight-composition-total><span>ИТОГО</span><b>{flightNumberLabel(draftFleetStats.count)} {shipCountLabel(draftFleetStats.count)}</b><span>население {flightNumberLabel(selectedPopulation)}</span><span>{holdLabel.toLowerCase()} {flightNumberLabel(previewHoldCapacity)}</span></footer>
                    </div>
              </section>
              <section className="flight-timeline-summary" aria-live="polite">
                <div className="flight-timeline-summary-head">
                  <small>ПАРАМЕТРЫ ПЕРЕЛЁТА</small>
                  <span>{missionId === 'space-flight' ? 'ДЛИТЕЛЬНОСТЬ ЗАДАНА ВРУЧНУЮ' : 'ПРОВЕРКА ЦЕЛИ ПРИ ОТПРАВКЕ'}</span>
                </div>
                {missionId === 'gas' && gasPreviewNeedsReconfirmation ? <div className="flight-timeline-notes"><p role="status" className="flight-timeline-note-warning" data-qa-gas-preview-reconfirmation>Прогноз обновлён. Проверьте ETA и положение астероида, затем подтвердите отправку ещё раз.</p></div> : null}
                {previewResult?.ok ? <>
                  <div className="flight-briefing-v2__axis" aria-hidden="true">
                    <i />
                    <span style={{ left: '8%' }}><b /><small>ВЫЛЕТ · <em>сейчас</em></small></span>
                    <span style={{ left: '50%' }}><b /><small>{missionId === 'space-flight' ? 'РАЗВОРОТ' : 'ПРИБЫТИЕ'} · <em>через {flightDurationLabel(previewResult.flight.oneWayDurationMs)}</em></small></span>
                    <span style={{ left: '90%' }}><b /><small>{missionId === 'deployment' || missionId === 'colonize' ? 'БЕЗ ВОЗВРАТА' : <>ВОЗВРАТ · <em>через {flightDurationLabel(previewResult.flight.oneWayDurationMs * 2)}</em></>}</small></span>
                  </div>
                  <div className="flight-timeline-metrics" data-qa-flight-preview data-qa-flight-preview-departed-at={previewResult.flight.departedAt} data-qa-flight-preview-arrival-at={previewResult.flight.arrivalAt} data-qa-flight-preview-speed={previewResult.flight.effectiveSpeed} data-qa-flight-preview-duration={previewResult.flight.oneWayDurationMs}>
                    <div><small>{missionId === 'space-flight' ? 'ЦЕЛЬ' : 'РАССТОЯНИЕ'}</small><strong>{missionId === 'space-flight' ? 'нет' : `${flightNumberLabel(previewResult.flight.routeDistance)} ед.`}</strong></div>
                    <div><small>{missionId === 'space-flight' ? 'СКОРОСТЬ' : 'СКОРОСТЬ ФЛОТА'}</small><strong>{missionId === 'space-flight' ? 'не применяется' : flightNumberLabel(previewResult.flight.effectiveSpeed)}</strong></div>
                    <div><small>ТУДА</small><strong>{flightDurationLabel(previewResult.flight.oneWayDurationMs)}</strong></div>
                    <div><small>ОБРАТНО</small><strong>{flightDurationLabel(previewResult.flight.oneWayDurationMs)}</strong></div>
                    <div><small>ПОЛНЫЙ ЦИКЛ</small><strong>{flightDurationLabel(previewResult.flight.oneWayDurationMs * 2)}</strong></div>
                    <div><small>ГАЗ</small><strong>{previewResult.flight.gasCost}</strong></div>
                    <div data-qa-flight-metric="population"><small>НАСЕЛЕНИЕ</small><strong>{flightNumberLabel(selectedPopulation)}</strong></div>
                    {!((missionId === 'transport' || missionId === 'space-flight' || missionId === 'aid' || missionId === 'deployment') && transportSummary) ? <div data-qa-flight-metric="hold"><small>{holdLabel}</small><strong>{flightNumberLabel(previewHoldCapacity)}</strong></div> : null}
                    {(missionId === 'transport' || missionId === 'space-flight' || missionId === 'aid' || missionId === 'deployment') && transportSummary ? <div data-qa-flight-metric="cargo-capacity"><small>ГРУЗ</small><strong>{flightNumberLabel(transportSummary.capacity.used)} / {flightNumberLabel(transportSummary.capacity.total)}</strong></div> : null}
                  </div>
                  <section className="flight-timeline-eta" data-qa-flight-eta aria-label="Расписание рейса">
                    <div className="flight-timeline-eta-card is-arrival">
                      <small>{missionId === 'space-flight' ? 'ТОЧКА РАЗВОРОТА' : missionId === 'gas' ? 'ПРИБЫТИЕ' : 'ПРИБЫТИЕ · ЕСЛИ ОТПРАВИТЬ СЕЙЧАС'}</small>
                      <strong>через {flightDurationLabel(previewResult.flight.oneWayDurationMs)}</strong>
                      <span>{flightArrivalLabel(missionId === 'gas' || missionId === 'space-flight' ? previewResult.flight.arrivalAt : clockNow + previewResult.flight.oneWayDurationMs)} МСК</span>
                      <em>{missionId === 'space-flight' ? 'начало обратного участка' : missionId === 'aid' ? 'зачисление принятого груза на планету запроса' : missionId === 'recycle' ? 'сбор обломков с орбиты' : missionId === 'gas' ? 'проверка позиции астероида' : missionId === 'colonize' ? 'проверка цели и создание планеты' : missionId === 'transport' ? 'доставка груза на планету-цель' : missionId === 'deployment' ? 'перевод флота и груза на планету-цель' : missionId === 'attack' ? 'бой с целью' : missionId === 'espionage' ? 'разведка цели' : 'прибытие к цели'}</em>
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
                          : missionId === 'colonize'
                            ? 'При отзыве колонизатор возвращается, но газ не возвращается.'
                            : missionId === 'transport'
                              ? 'При отзыве до прибытия флот вернётся вместе с грузом; газ не возвращается.'
                              : missionId === 'deployment'
                                ? 'При отзыве до прибытия флот вернётся на исходную планету вместе с грузом; газ не возвращается.'
                                : missionId === 'espionage'
                                  ? 'При отзыве до прибытия зонд вернётся; газ не возвращается.'
                                  : 'При отзыве до прибытия флот вернётся; газ не возвращается.'}</p>
                  </div>
                </> : <>
                  {previewResult && !previewResult.ok ? <p className="flight-timeline-error" data-qa-flight-preview-error>{previewResult.error.message}</p> : null}
                  {compactSummary ? <p className="flight-draft-v3__line" data-qa-flight-estimate={routeEstimate ? true : undefined} data-qa-flight-draft-hint>
                    {routeEstimate
                      ? <>{flightNumberLabel(routeEstimate.routeDistance)} ед. · туда <b>{flightDurationLabel(routeEstimate.oneWayDurationMs)}</b> · газ <b>{flightNumberLabel(routeEstimate.gasCost)}</b> · прибытие <b>{flightArrivalLabel(clockNow + routeEstimate.oneWayDurationMs)} МСК</b>, если отправить сейчас</>
                      : <>Флот: {flightNumberLabel(draftFleetStats.count)} {shipCountLabel(draftFleetStats.count)} · население {flightNumberLabel(selectedPopulation)} · трюм {flightNumberLabel(previewHoldCapacity)} · время и газ появятся после выбора цели</>}
                  </p> : routeEstimate ? <>
                  <div className="flight-timeline-metrics" data-qa-flight-estimate>
                    <div><small>РАССТОЯНИЕ</small><strong>{flightNumberLabel(routeEstimate.routeDistance)} ед.</strong></div>
                    <div><small>СКОРОСТЬ ФЛОТА</small><strong>{flightNumberLabel(routeEstimate.effectiveSpeed)}</strong></div>
                    <div><small>ТУДА</small><strong>{flightDurationLabel(routeEstimate.oneWayDurationMs)}</strong></div>
                    <div><small>ОБРАТНО</small><strong>{flightDurationLabel(routeEstimate.oneWayDurationMs)}</strong></div>
                    <div><small>ПОЛНЫЙ ЦИКЛ</small><strong>{flightDurationLabel(routeEstimate.oneWayDurationMs * 2)}</strong></div>
                    <div><small>ГАЗ</small><strong>{flightNumberLabel(routeEstimate.gasCost)}</strong></div>
                    <div><small>НАСЕЛЕНИЕ</small><strong>{flightNumberLabel(selectedPopulation)}</strong></div>
                    <div><small>{holdLabel}</small><strong>{flightNumberLabel(previewHoldCapacity)}</strong></div>
                  </div>
                  <p className="flight-draft-v3__line" data-qa-flight-draft-hint>Прибытие <b>{flightArrivalLabel(clockNow + routeEstimate.oneWayDurationMs)} МСК</b>, если отправить сейчас · цель проверяется при отправке</p>
                  </> : <>
                  <div className="flight-timeline-metrics flight-draft-v3" data-qa-flight-draft>
                    <div><small>КОРАБЛЕЙ</small><strong>{flightNumberLabel(draftFleetStats.count)}</strong></div>
                    <div><small>БАЗОВАЯ СКОРОСТЬ</small><strong>{draftFleetStats.speed ? flightNumberLabel(draftFleetStats.speed) : '—'}</strong></div>
                    <div data-qa-flight-metric="population"><small>НАСЕЛЕНИЕ</small><strong>{flightNumberLabel(selectedPopulation)}</strong></div>
                    <div data-qa-flight-metric="hold"><small>{holdLabel}</small><strong>{flightNumberLabel(previewHoldCapacity)}</strong></div>
                  </div>
                  <div className="flight-draft-v3__hint" data-qa-flight-draft-hint>
                    <strong>{targetIsLocallyValid ? 'Цель задана' : 'Выберите цель'}</strong>
                    <span>{targetIsLocallyValid ? 'Время в пути и газ появятся, как только координаты будут заполнены. Доступность цели проверяется при отправке.' : missionId === 'deployment' ? 'Выберите планету в списке «Своя планета» — время в пути, газ и прибытие появятся здесь сразу.' : 'Введите галактику, систему и позицию — время в пути, газ и прибытие появятся здесь сразу.'}</span>
                  </div>
                  </>}
                </>}
              </section>
              {(missionId === 'transport' || missionId === 'space-flight' || missionId === 'aid' || missionId === 'deployment') && transportSummary ? <section className="flight-timeline-cargo" data-qa-flight-cargo data-qa-cargo-capacity={`${transportSummary.capacity.used}/${transportSummary.capacity.total}`} aria-label="Загрузка ресурсов">
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
            <div className="resource-building-action-confirm-actions flight-timeline-actions">
            <div className="flight-timeline-meta">{previewResult?.ok && previewFlightRecord ? <>РАСЧЁТ РЕЙСА · ПРИБЫТИЕ: {flightArrivalLabel(missionId === 'gas' || missionId === 'space-flight' ? previewFlightRecord.arrivalAt : clockNow + previewFlightRecord.oneWayDurationMs)} · МОСКОВСКОЕ ВРЕМЯ · {flightMissionLabel(missionId).toUpperCase()}</> : routeEstimate ? <>ОЦЕНКА ПО КООРДИНАТАМ · ПРИБЫТИЕ: {flightArrivalLabel(clockNow + routeEstimate.oneWayDurationMs)} · МОСКОВСКОЕ ВРЕМЯ · ЦЕЛЬ ПРОВЕРЯЕТСЯ ПРИ ОТПРАВКЕ</> : 'РАСЧЁТ ПОЯВИТСЯ ПОСЛЕ ВЫБОРА ЦЕЛИ'}</div>
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

function FleetWingTabs({ items, icons, isActive, onSelect }: {
  items: readonly FleetSectionItem[];
  icons: Partial<Record<FleetSectionId, string>>;
  isActive: (id: FleetSectionId) => boolean;
  onSelect: (section: FleetSectionId) => void;
}) {
  return (
    <>
      {items.map((item) => (
        <button key={item.id} type="button" className={isActive(item.id) ? 'is-on' : ''} aria-current={isActive(item.id) ? 'page' : undefined} data-qa-fleet-section={item.id} onClick={() => onSelect(item.id)}>
          {icons[item.id] ? <img src={icons[item.id]} alt="" draggable={false} /> : null}
          <span>{item.label}</span>
        </button>
      ))}
    </>
  );
}

function FleetWing({ tone, title, items, icons, isActive, onSelect }: {
  tone: 'build' | 'command';
  title: string;
  items: readonly FleetSectionItem[];
  icons: Partial<Record<FleetSectionId, string>>;
  isActive: (id: FleetSectionId) => boolean;
  onSelect: (section: FleetSectionId) => void;
}) {
  return (
    <section className={`fc-wing fc-wing--${tone}`}>
      <h3>{title}</h3>
      <div className="fc-wing__tabs">
        <FleetWingTabs items={items} icons={icons} isActive={isActive} onSelect={onSelect} />
      </div>
    </section>
  );
}

export function FleetWorkspacePortal() {
  const { route } = useNavigation();
  const persistence = useMemo(() => createPersistenceFacade({ mode: ACTIVE_RUNTIME_MODE }), []);
  const [target, setTarget] = useState<Element | null>(null);
  const [resetNonce, setResetNonce] = useState(0);
  const [saveState, setSaveState] = useState<SaveState>(() => getLiveSaveState() ?? persistence.read());
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
      // The workspace decides whether the target stays for the next wave.
      if (result.ok) setSaveState(result.state);
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
      key={resetNonce}
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
