import type { CombatFactionId } from '../domain/combat/factions.ts';
import { getFactionShipCatalog } from '../domain/combat/faction-catalog.ts';
import { createEmptyDefenseState } from '../domain/fleet/production.ts';
import {
  createEmptyFleetState,
  removeSolarSatellitesFromFleet,
  resolveSavedFleetState,
  type OwnedFleetState,
} from '../domain/fleet/runtime.ts';
import { createDefaultFleetProductionState } from '../domain/fleet/production.ts';
import {
  createDefaultBuildingLevels,
  getStorageCapacities,
} from '../domain/buildings/resource-zone.ts';
import { createEmptyBotAssignment } from '../domain/buildings/production-bots.ts';
import { createDefaultSpaceportUpgradeState } from '../domain/buildings/spaceport-upgrades.ts';
import { createDefaultTradeState } from '../domain/buildings/trade.ts';
import { createDefaultRepairWorkshopState } from '../domain/repair/workshop.ts';
import { initializePlanetEnergy } from './energy.ts';
import {
  getPlanetResources,
  replacePlanetResources,
  replacePlanetState,
  replaceAlliedPlanetState,
  type AlliedPlanetState,
  type PlanetId,
  type PlanetRuntime,
  type SaveState,
} from './contracts.ts';
import {
  beginFlightReturn as beginDomainFlightReturn,
  createFlightState,
  dispatchFlight as dispatchDomainFlight,
  getFlightByRequestId,
  recallFlight as recallDomainFlight,
} from '../domain/flights/runtime.ts';
import { isFlightCoordinate } from '../domain/flights/distance.ts';
import {
  addDebris,
  clampCargoToSourceAndCapacity,
  getCappedDelivery,
  getCargoUsed,
  getFleetCargoCapacity,
  getOverflowWarning,
  normalizeTransportCargo,
  type TransportCargo,
} from '../domain/flights/cargo.ts';
import { SHIP_IDS, type ShipId } from '../domain/combat/ids.ts';
import { scaleRuntimeDuration, type RuntimeMode, type TestTimeScale } from '../domain/runtime/mode.ts';
import type {
  FlightDestination,
  FlightRecord,
  FlightState,
  MissionId,
  TargetRelation,
} from '../domain/flights/types.ts';
import {
  activeSpyMissionForTarget,
  canRequestSpyReport,
  createDefaultEspionageState,
  hunterDetects,
  normalizeRngRoll,
  resolveSpyReportQuality,
  SPY_REPORT_COOLDOWN_MS,
} from '../domain/espionage/runtime.ts';
import type {
  Bot01PlanetState,
  EspionageState,
  SpyHunterNotice,
  SpyMission,
  SpyReportSnapshot,
} from '../domain/espionage/types.ts';
import { createUniverseSystem, getUniverseOwnerRelation } from '../domain/universe/runtime.ts';
import type { UniverseCoordinate, UniverseObjectKind, UniverseOwnerProfile, UniversePersistedPlayerPlanet, UniversePlanetNode } from '../domain/universe/types.ts';
import { initializePlanetResourceClock } from './resource-clock.ts';

export const FLIGHT_LAUNCH_CONTEXT_EVENT = 'asterion:flight-launch-context';
export const FLIGHT_LAUNCH_CONTEXT_CLEAR_EVENT = 'asterion:flight-launch-context-clear';
export const FLIGHT_EDIT_TARGET_REQUEST_EVENT = 'asterion:flight-edit-target-request';
export const FLIGHT_DISPATCH_REQUEST_EVENT = 'asterion:flight-dispatch-request';
export const FLIGHT_RECALL_REQUEST_EVENT = 'asterion:flight-recall-request';
export const FLIGHT_COMMAND_RESULT_EVENT = 'asterion:flight-command-result';
export const SPY_REPORT_REQUEST_EVENT = 'asterion:spy-report-request';
export const SPY_REPORT_ALL_REQUEST_EVENT = 'asterion:spy-report-all-request';
export const SPY_REPORT_RESULT_EVENT = 'asterion:spy-report-result';

export type FlightLaunchContext = {
  missionId: MissionId;
  destination?: FlightDestination;
  targetRelation?: TargetRelation;
  targetKind?: UniverseObjectKind;
  operationId?: string;
  targetPlanetName?: string;
  targetOwnerId?: string;
  targetOwnerName?: string;
  targetRaceId?: 'aegis' | 'synod' | 'veyra';
  targetAlliance?: import('../domain/universe/types.ts').UniverseOwnerAlliance | null;
};

export type FlightErrorCode =
  | 'invalid-coordinate'
  | 'target-occupied'
  | 'target-not-colonizable'
  | 'target-not-available'
  | 'target-is-origin'
  | 'wrong-ship-composition'
  | 'insufficient-ships'
  | 'ship-already-reserved'
  | 'insufficient-gas'
  | 'invalid-cargo'
  | 'insufficient-cargo-capacity'
  | 'mission-not-supported'
  | 'flight-not-recallable'
  | 'flight-already-arrived'
  | 'spy-target-blocked'
  | 'spy-report-cooldown'
  | 'spy-mission-not-found'
  | 'invalid-command';

export type FlightError = {
  code: FlightErrorCode;
  message: string;
};

export type DispatchFlightCommand = {
  requestId?: string;
  commandId?: string;
  missionId: MissionId;
  originPlanetId?: PlanetId;
  destination?: FlightDestination;
  targetRelation?: TargetRelation;
  cargo?: TransportCargo;
  targetKind?: UniverseObjectKind;
  selectedShips: Partial<Record<ShipId, number>>;
  operationId?: string;
  targetPlanetName?: string;
  targetOwnerId?: string;
  targetOwnerName?: string;
  targetRaceId?: 'aegis' | 'synod' | 'veyra';
  targetAlliance?: import('../domain/universe/types.ts').UniverseOwnerAlliance | null;
  departedAt?: number;
};

export type FlightRuntimeOptions = {
  now?: number;
  mode?: RuntimeMode;
  testTimeScale?: TestTimeScale;
};

export type FlightCommandSuccess = {
  ok: true;
  state: SaveState;
  flight: FlightRecord;
  created: boolean;
  notice: string;
};

export type FlightCommandFailure = {
  ok: false;
  state: SaveState;
  error: FlightError;
};

export type FlightCommandResult = FlightCommandSuccess | FlightCommandFailure;

export type SpyReportCommandSuccess = {
  ok: true;
  state: SaveState;
  report?: SpyReportSnapshot;
  notice: string;
};

export type SpyReportCommandFailure = {
  ok: false;
  state: SaveState;
  error: FlightError;
};

export type SpyReportCommandResult = SpyReportCommandSuccess | SpyReportCommandFailure;

export type FlightReconcileEvent = {
  flight: FlightRecord;
  status: 'arrived' | 'returned' | 'target-occupied' | 'target-unavailable' | 'delivered' | 'colonized' | 'spy-report' | 'spy-detected';
  notice: string;
};

export type FlightReconcileResult = {
  changed: boolean;
  state: SaveState;
  events: FlightReconcileEvent[];
};

const ACTIVE_FLIGHT_PHASES = new Set<FlightRecord['phase']>(['outbound', 'returning', 'arrived']);

export type ResolvedTransportTarget = {
  planetId: PlanetId;
  coordinate: UniverseCoordinate;
  ownerId: string;
  relation: 'self' | 'ally' | 'enemy' | 'neutral' | 'empty';
  runtime: PlanetRuntime | null;
  acceptsTransport: boolean;
};
function currentFlightState(state: SaveState): FlightState {
  return state.flights ?? createFlightState();
}

function requestIdFor(command: DispatchFlightCommand): string {
  return (command.requestId ?? command.commandId ?? '').trim();
}

function coordinateOfPlanet(planet: PlanetRuntime): UniverseCoordinate {
  return {
    galaxy: Number.isInteger(planet.universeGalaxy) && (planet.universeGalaxy ?? 0) >= 1 ? planet.universeGalaxy! : 1,
    system: Number.isInteger(planet.universeSystem) && (planet.universeSystem ?? 0) >= 1 ? planet.universeSystem! : 1,
    position: Number.isInteger(planet.universePosition) && (planet.universePosition ?? 0) >= 1 ? planet.universePosition! : 1,
  };
}

function coordinatesEqual(left: UniverseCoordinate, right: UniverseCoordinate): boolean {
  return left.galaxy === right.galaxy && left.system === right.system && left.position === right.position;
}

function activeFlights(state: SaveState): FlightRecord[] {
  return currentFlightState(state).records.filter((flight) => ACTIVE_FLIGHT_PHASES.has(flight.phase));
}

function persistedPlayerPlanets(state: SaveState): UniversePersistedPlayerPlanet[] {
  return Object.entries(state.planets).map(([id, planet]) => ({
    id,
    coordinate: coordinateOfPlanet(planet),
    name: planet.name,
    isHomeworld: id === 'helion-01',
    ownerId: state.profile.playerId,
  }));
}

function targetCoordinateFromPlanet(planet: PlanetRuntime): UniverseCoordinate {
  return coordinateOfPlanet(planet);
}

function emptyTransportTarget(destination?: FlightDestination): ResolvedTransportTarget {
  const coordinate = destination?.coordinate ?? { galaxy: 1, system: 1, position: 1 };
  return {
    planetId: destination?.kind === 'planet' ? destination.planetId : '',
    coordinate,
    ownerId: '',
    relation: 'empty',
    runtime: null,
    acceptsTransport: false,
  };
}

/** Resolves only authoritative SaveState targets; Universe paint cannot grant access. */
export function resolveTransportTarget(
  state: SaveState,
  destination?: FlightDestination,
): ResolvedTransportTarget {
  if (!destination || !isFlightCoordinate(destination.coordinate)) return emptyTransportTarget(destination);
  const coordinate = destination.coordinate;
  const ownEntry = Object.entries(state.planets).find(([, planet]) => coordinatesEqual(targetCoordinateFromPlanet(planet), coordinate));
  const allyEntry = Object.entries(state.alliedPlanets ?? {}).find(([, planet]) => coordinatesEqual(targetCoordinateFromPlanet(planet), coordinate));
  const byCoordinate = ownEntry ?? allyEntry;
  const byId = destination.kind === 'planet'
    ? state.planets[destination.planetId]
      ? { id: destination.planetId, planet: state.planets[destination.planetId], relation: 'self' as const }
      : state.alliedPlanets?.[destination.planetId]
        ? { id: destination.planetId, planet: state.alliedPlanets[destination.planetId], relation: 'ally' as const }
        : undefined
    : undefined;

  if (destination.kind === 'planet' && (!byId || !coordinatesEqual(targetCoordinateFromPlanet(byId.planet), coordinate))) {
    return emptyTransportTarget(destination);
  }
  if (!byCoordinate && !byId) return emptyTransportTarget(destination);

  const id = byId?.id ?? byCoordinate?.[0] ?? '';
  const planet = byId?.planet ?? byCoordinate?.[1];
  if (!planet) return emptyTransportTarget(destination);
  const relation = byId?.relation ?? (ownEntry ? 'self' : 'ally');
  const ownerId = relation === 'self' ? state.profile.playerId : (planet as AlliedPlanetState).ownerId;
  return {
    planetId: id,
    coordinate,
    ownerId,
    relation,
    runtime: planet,
    acceptsTransport: relation === 'self' || relation === 'ally',
  };
}

function normalizeSelectedShips(selectedShips: Partial<Record<ShipId, number>>): Partial<Record<ShipId, number>> | null {
  const normalized: Partial<Record<ShipId, number>> = {};
  for (const [rawShipId, rawQuantity] of Object.entries(selectedShips)) {
    if (!SHIP_IDS.includes(rawShipId as ShipId)) return null;
    if (!Number.isFinite(rawQuantity) || !Number.isInteger(rawQuantity) || (rawQuantity ?? 0) < 0) return null;
    if ((rawQuantity ?? 0) > 0) normalized[rawShipId as ShipId] = rawQuantity as number;
  }
  return Object.keys(normalized).length > 0 ? normalized : null;
}

export type TransportCargoSummary = {
  cargo: TransportCargo;
  capacity: { used: number; total: number; free: number };
  overflowWarning: boolean;
};

export function getTransportCargoSummary(
  state: SaveState,
  originPlanetId: PlanetId,
  selectedShips: Partial<Record<ShipId, number>>,
  requestedCargo: unknown,
  destination?: FlightDestination,
): TransportCargoSummary {
  const origin = state.planets[originPlanetId];
  const factionId = state.profile.factionId as CombatFactionId;
  const cargoCatalog = Object.fromEntries(
    getFactionShipCatalog(factionId).map((entity) => [entity.id, { cargo: entity.ship?.cargo ?? 0 }]),
  );
  const capacityTotal = getFleetCargoCapacity(selectedShips, cargoCatalog);
  const sourceResources = origin?.resources ?? getPlanetResources(state, originPlanetId);
  const sourceDebris = origin?.recycling.availableDebris ?? 0;
  const cargo = clampCargoToSourceAndCapacity(requestedCargo, sourceResources, sourceDebris, capacityTotal);
  // A coordinate draft may use the persisted own/ally match only to derive
  // the overflow warning. This lookup does not surface ownership or
  // occupancy errors; dispatchFlight remains the authoritative Send check.
  const target = destination
    ? resolveTransportTarget(state, destination)
    : emptyTransportTarget(destination);
  const targetResources = target.runtime?.resources ?? { metal: 0, minerals: 0, gas: 0 };
  const targetCaps = target.runtime ? getStorageCapacities(target.runtime.buildings) : undefined;
  return {
    cargo,
    capacity: { used: getCargoUsed(cargo), total: capacityTotal, free: Math.max(0, capacityTotal - getCargoUsed(cargo)) },
    overflowWarning: target.acceptsTransport && target.runtime
      ? getOverflowWarning(cargo, targetResources, target.runtime.recycling.availableDebris, targetCaps)
      : false,
  };
}

export function getReservedShipsForPlanet(
  state: SaveState,
  planetId: PlanetId,
): Partial<Record<ShipId, number>> {
  const reserved: Partial<Record<ShipId, number>> = {};
  for (const flight of activeFlights(state)) {
    if (flight.originPlanetId !== planetId) continue;
    for (const [shipId, quantity] of Object.entries(flight.selectedShips) as [ShipId, number][]) {
      if (!Number.isFinite(quantity) || quantity <= 0) continue;
      reserved[shipId] = (reserved[shipId] ?? 0) + Math.floor(quantity);
    }
  }
  return reserved;
}

export function getAvailableFleetForPlanet(state: SaveState, planetId: PlanetId): OwnedFleetState {
  const planet = state.planets[planetId];
  if (!planet) return createEmptyFleetState();
  const migrated = removeSolarSatellitesFromFleet(resolveSavedFleetState(planet.fleet, state.profile.factionId)).fleet;
  const reserved = getReservedShipsForPlanet(state, planetId);
  const ships = { ...migrated.ships };
  for (const [shipId, quantity] of Object.entries(reserved) as [ShipId, number][]) {
    ships[shipId] = Math.max(0, (ships[shipId] ?? 0) - quantity);
  }
  return { ships, commanders: { ...migrated.commanders } };
}

function failure(state: SaveState, code: FlightErrorCode, message: string): FlightCommandFailure {
  return { ok: false, state, error: { code, message } };
}

function targetOccupied(
  state: SaveState,
  coordinate: UniverseCoordinate,
  nowMs: number,
  currentFlightId?: string,
  mode: RuntimeMode = Object.keys(state.alliedPlanets ?? {}).length > 0 ? 'test' : 'production',
): boolean {
  const system = createUniverseSystem({
    mode,
    galaxy: coordinate.galaxy,
    system: coordinate.system,
    nowMs,
    galaxyCount: 1,
    playerPlanets: persistedPlayerPlanets(state),
  });
  const underlyingNode = system.positions.find((node) => coordinatesEqual(node.coordinate, coordinate));
  // Asteroids are a visual overlay. Only the underlying coordinate object can
  // block colonization; a free position with an asteroid remains available.
  if (underlyingNode && underlyingNode.kind !== 'empty') return true;
  return activeFlights(state).some((flight) => flight.id !== currentFlightId
    && flight.missionId === 'colonize'
    && coordinatesEqual(flight.destinationCoordinate, coordinate));
}

function targetHasInvalidKind(targetKind: UniverseObjectKind | undefined): boolean {
  // A caller may pass the visual asteroid layer as the snapshot kind. The
  // coordinate check above decides whether the underlying position is free.
  return targetKind !== undefined && targetKind !== 'empty' && targetKind !== 'asteroid';
}

function selectedColonizerOnly(selectedShips: Partial<Record<ShipId, number>>): boolean {
  const entries = Object.entries(selectedShips).filter(([, quantity]) => Number.isFinite(quantity) && Math.floor(quantity ?? 0) > 0);
  return entries.length === 1 && entries[0][0] === 'colonizer' && Math.floor(entries[0][1] as number) === 1;
}

function scaledRecord(record: FlightRecord, options: FlightRuntimeOptions): FlightRecord {
  const duration = scaleRuntimeDuration(record.oneWayDurationMs, options.mode ?? 'production', options.testTimeScale);
  return {
    ...record,
    oneWayDurationMs: duration,
    arrivalAt: record.departedAt + duration,
    populationReserved: record.populationReserved,
  };
}

function updateFlight(state: FlightState, flight: FlightRecord): FlightState {
  return {
    ...state,
    records: state.records.map((item) => item.id === flight.id ? flight : item),
  };
}

function selectedSpyProbeOnly(selectedShips: Partial<Record<ShipId, number>>): boolean {
  const entries = Object.entries(selectedShips).filter(([, quantity]) => Number.isFinite(quantity) && Math.floor(quantity ?? 0) > 0);
  return entries.length === 1 && entries[0][0] === 'spy-probe' && Math.floor(entries[0][1] as number) === 1;
}

function currentEspionageState(state: SaveState): EspionageState {
  return state.espionage ?? createDefaultEspionageState();
}

function withEspionageState(state: SaveState, espionage: EspionageState): SaveState {
  return { ...state, espionage };
}

function randomRoll(rng: () => number): number {
  const raw = rng();
  if (!Number.isFinite(raw)) return 0;
  // Math.random() is [0, 1); tests may provide the already materialized 0..99
  // integer. Both paths end in the same canonical integer contract.
  return raw >= 0 && raw < 1 ? Math.floor(raw * 100) : normalizeRngRoll(raw);
}

function spyTargetFor(state: SaveState, mission: Pick<SpyMission, 'targetPlanetId'> | FlightRecord): Bot01PlanetState | null {
  const targetPlanetId = 'targetPlanetId' in mission ? mission.targetPlanetId : mission.destinationPlanetId;
  if (!targetPlanetId) return null;
  return state.espionage?.bot01Planets?.[targetPlanetId] ?? null;
}

function updateSpyMission(espionage: EspionageState, mission: SpyMission): EspionageState {
  return {
    ...espionage,
    missions: espionage.missions.map((item) => item.id === mission.id ? mission : item),
  };
}

function removeSpyProbeFromOrigin(state: SaveState, mission: SpyMission): SaveState {
  const origin = state.planets[mission.originPlanetId];
  if (!origin) return state;
  const fleet = removeSolarSatellitesFromFleet(resolveSavedFleetState(origin.fleet, state.profile.factionId)).fleet;
  return replacePlanetState(state, mission.originPlanetId, {
    ...origin,
    fleet: {
      ...fleet,
      ships: { ...fleet.ships, 'spy-probe': Math.max(0, (fleet.ships['spy-probe'] ?? 0) - 1) },
    },
  });
}

function authoritativeSpyTargetRelation(state: SaveState, target: Bot01PlanetState): TargetRelation {
  const targetNode = { ownerId: target.ownerId, isHomeworld: false } as UniversePlanetNode;
  const currentAlliance = state.profile.alliance
    ? { ...state.profile.alliance, glyph: state.profile.alliance.emblem.glyph }
    : null;
  const targetOwner: UniverseOwnerProfile = {
    id: target.ownerId,
    displayName: target.ownerName,
    raceId: target.raceId,
    alliance: target.alliance,
    planetIds: [target.id],
  };
  return getUniverseOwnerRelation(targetNode, state.profile.playerId, currentAlliance, targetOwner);
}

function createSpyReport(
  mission: SpyMission,
  target: Bot01PlanetState,
  createdAt: number,
  roll: number,
  firstReport: boolean,
  spyLevel: number,
): SpyReportSnapshot {
  const delta = spyLevel - target.espionageLevel;
  const quality = resolveSpyReportQuality(delta, roll);
  return {
    id: `spy-report-${mission.id}-${mission.reportIds.length + 1}`,
    missionId: mission.id,
    createdAt,
    sourcePlanetId: mission.originPlanetId,
    targetPlanetId: target.id,
    targetPlanetName: target.name,
    targetOwnerId: target.ownerId,
    targetOwnerName: target.ownerName,
    targetRaceId: target.raceId,
    targetRelation: mission.targetRelation,
    targetCoordinate: { ...target.coordinate },
    spyLevel,
    targetEspionageLevel: target.espionageLevel,
    delta,
    roll,
    quality,
    resources: { ...target.resources },
    firstReport,
    ...(quality !== 'basic'
      ? { defense: { ...target.defense.defenses } }
      : {}),
    ...(quality === 'full'
      ? {
        fleet: { ...target.fleet.ships },
        commanders: Object.fromEntries(Object.entries(target.commanders).map(([id, commander]) => [id, commander ? { ...commander } : commander])),
        population: {
          total: target.population.civilian + target.population.fleet + target.population.defense,
          fleet: target.population.fleet,
          defense: target.population.defense,
        },
      }
      : {}),
  };
}

type SpyResolution = {
  state: SaveState;
  flight: FlightRecord;
  event: FlightReconcileEvent;
};

function resolveSpyAtTarget(
  state: SaveState,
  flight: FlightRecord,
  mission: SpyMission,
  now: number,
  rng: () => number,
  firstReport: boolean,
): SpyResolution | null {
  const target = spyTargetFor(state, mission);
  if (!target) return null;
  const hunterRoll = randomRoll(rng);
  if (hunterDetects(target.hunterLevel, hunterRoll)) {
    const destroyedMission: SpyMission = {
      ...mission,
      status: 'destroyed',
      destroyedAt: now,
      nextReportAt: undefined,
    };
    const destroyedFlight: FlightRecord = {
      ...flight,
      phase: 'completed',
      arrivedAt: flight.arrivedAt ?? flight.arrivalAt,
      completedAt: now,
      completionReason: 'spy-destroyed',
    };
    const notice: SpyHunterNotice = {
      id: `spy-hunter-${mission.id}-${mission.reportIds.length + 1}`,
      missionId: mission.id,
      createdAt: now,
      targetPlanetId: target.id,
      targetPlanetName: target.name,
      targetOwnerName: target.ownerName,
      targetCoordinate: { ...target.coordinate },
      hunterLevel: target.hunterLevel,
    };
    let next = removeSpyProbeFromOrigin(state, mission);
    const espionage = updateSpyMission(currentEspionageState(next), destroyedMission);
    next = withEspionageState(next, { ...espionage, hunterNotices: [...espionage.hunterNotices, notice] });
    next = { ...next, flights: updateFlight(currentFlightState(next), destroyedFlight) };
    return {
      state: next,
      flight: destroyedFlight,
      event: { flight: destroyedFlight, status: 'spy-detected', notice: `Шпионский зонд уничтожен над планетой ${target.name}: Охотник обнаружил вторжение.` },
    };
  }

  const currentSpyLevel = Math.max(0, Math.floor(state.science.levels[5] ?? 0));
  const report = createSpyReport(mission, target, now, randomRoll(rng), firstReport, currentSpyLevel);
  const nextMission: SpyMission = {
    ...mission,
    spyLevel: currentSpyLevel,
    status: 'orbiting',
    arrivedAt: mission.arrivedAt ?? flight.arrivalAt,
    lastReportAt: now,
    nextReportAt: now + SPY_REPORT_COOLDOWN_MS,
    reportIds: [...mission.reportIds, report.id],
  };
  const arrivedFlight: FlightRecord = {
    ...flight,
    phase: 'arrived',
    arrivedAt: flight.arrivedAt ?? flight.arrivalAt,
    completionReason: 'arrived',
  };
  const espionage = currentEspionageState(state);
  const nextEspionage = updateSpyMission({ ...espionage, reports: [...espionage.reports, report] }, nextMission);
  const next = withEspionageState({ ...state, flights: updateFlight(currentFlightState(state), arrivedFlight) }, nextEspionage);
  return {
    state: next,
    flight: arrivedFlight,
    event: { flight: arrivedFlight, status: 'spy-report', notice: `Шпионский отчёт готов: ${target.name} · ${report.quality === 'full' ? 'полный' : report.quality === 'detailed' ? 'детальный' : 'базовый'} уровень.` },
  };
}

function makePlanetId(coordinate: UniverseCoordinate): PlanetId {
  return `planet-${coordinate.galaxy}-${coordinate.system}-${coordinate.position}`;
}

export function createPlanetIdForCoordinate(coordinate: UniverseCoordinate): PlanetId {
  if (!isFlightCoordinate(coordinate)) throw new Error('Invalid flight coordinate.');
  return makePlanetId(coordinate);
}

function createColonyPlanet(state: SaveState, coordinate: UniverseCoordinate): PlanetRuntime {
  const emptyRecycling = { availableDebris: 0, jobs: [] };
  const base: PlanetRuntime = {
    name: `Колония ${coordinate.system}-${coordinate.position}`,
    skin: 'colonized',
    fleet: createEmptyFleetState(),
    defense: createEmptyDefenseState(),
    fleetProduction: createDefaultFleetProductionState(),
    repair: createDefaultRepairWorkshopState(),
    energy: 0,
    universeGalaxy: coordinate.galaxy,
    universeSystem: coordinate.system,
    universePosition: coordinate.position,
    buildings: createDefaultBuildingLevels(),
    productionBots: createEmptyBotAssignment(),
    recycling: emptyRecycling,
    trade: createDefaultTradeState(),
    spaceportUpgrades: createDefaultSpaceportUpgradeState(),
    stability: 100,
    resources: { metal: 500, minerals: 500, gas: 500 },
  };
  return initializePlanetEnergy(base, state.science.levels);
}

function noticeForDispatch(flight: FlightRecord): string {
  return `Рейс ${flight.missionId} отправлен: прибытие ${new Date(flight.arrivalAt).toLocaleString('ru-RU')} · газ ${flight.gasCost}.`;
}

export function dispatchFlight(
  state: SaveState,
  command: DispatchFlightCommand,
  options: FlightRuntimeOptions | number = {},
): FlightCommandResult {
  const runtimeOptions: FlightRuntimeOptions = typeof options === 'number' ? { now: options } : options;
  const requestId = requestIdFor(command);
  const flights = currentFlightState(state);
  if (requestId) {
    const existing = getFlightByRequestId(flights, requestId);
    if (existing) return { ok: true, state, flight: existing, created: false, notice: noticeForDispatch(existing) };
  }
  if (!requestId) return failure(state, 'invalid-command', 'Для отправки требуется requestId/commandId.');
  if (command.missionId !== 'colonize' && command.missionId !== 'transport' && command.missionId !== 'espionage') {
    return failure(state, 'mission-not-supported', 'Эта миссия пока не подключена к flight runtime.');
  }
  const departedAt = Number.isFinite(command.departedAt) ? command.departedAt! : (runtimeOptions.now ?? Date.now());
  const originPlanetId = command.originPlanetId ?? state.currentPlanetId;
  const originPlanet = state.planets[originPlanetId];
  if (!originPlanet) return failure(state, 'invalid-command', 'Исходная планета не найдена.');
  if (command.missionId === 'espionage' && command.destination?.kind === 'planet') {
    const existingMission = activeSpyMissionForTarget(
      currentEspionageState(state).missions,
      state.profile.playerId,
      command.destination.planetId,
    );
    if (existingMission) {
      const targetName = state.espionage?.bot01Planets?.[command.destination.planetId]?.name ?? command.targetPlanetName ?? 'этой планете';
      return failure(state, 'spy-target-blocked', `Зонд уже выполняет миссию у ${targetName}. Дождитесь возвращения или уничтожения.`);
    }
  }
  const selectedShips = normalizeSelectedShips(command.selectedShips);
  if (!selectedShips) return failure(state, 'wrong-ship-composition', 'Выберите хотя бы один доступный корабль.');
  const availableFleet = getAvailableFleetForPlanet(state, originPlanetId);
  const reservedShips = getReservedShipsForPlanet(state, originPlanetId);
  for (const [shipId, quantity] of Object.entries(selectedShips) as [ShipId, number][]) {
    if ((availableFleet.ships[shipId] ?? 0) < quantity) {
      const reserved = reservedShips[shipId] ?? 0;
      return failure(
        state,
        reserved > 0 ? 'ship-already-reserved' : 'insufficient-ships',
        reserved > 0 ? 'Выбранный корабль уже зарезервирован другим рейсом.' : 'На исходной планете недостаточно выбранных кораблей.',
      );
    }
  }

  if (command.missionId === 'espionage') {
    if (!command.destination || command.destination.kind !== 'planet' || !isFlightCoordinate(command.destination.coordinate)) {
      return failure(state, 'target-not-available', 'Для шпионажа выберите известную планету владельца.');
    }
    if (!selectedSpyProbeOnly(selectedShips)) {
      return failure(state, 'wrong-ship-composition', 'Для шпионажа нужен ровно один шпионский зонд.');
    }
    if (command.destination.planetId === originPlanetId) {
      return failure(state, 'target-is-origin', 'Нельзя отправить шпионский зонд на планету-источник.');
    }
    const target = state.espionage?.bot01Planets?.[command.destination.planetId];
    if (!target
      || target.ownerId !== command.targetOwnerId
      || !coordinatesEqual(target.coordinate, command.destination.coordinate)) {
      return failure(state, 'target-not-available', 'Цель шпионажа больше не подтверждена авторитетным состоянием игры.');
    }
    const targetRelation = authoritativeSpyTargetRelation(state, target);
    if ((targetRelation !== 'enemy' && targetRelation !== 'neutral') || command.targetRelation !== targetRelation) {
      return failure(state, 'spy-target-blocked', 'Шпионаж запрещён против своей или союзной планеты.');
    }
    const existingMission = activeSpyMissionForTarget(
      currentEspionageState(state).missions,
      state.profile.playerId,
      target.id,
    );
    if (existingMission) {
      return failure(state, 'spy-target-blocked', `Зонд уже выполняет миссию у планеты ${target.name}. Дождитесь возвращения или уничтожения.`);
    }
  }

  if (command.missionId === 'colonize') {
    if (!command.destination || command.destination.kind !== 'coordinate') return failure(state, 'target-not-colonizable', 'Колонизация допускает только свободную координату.');
    if (!isFlightCoordinate(command.destination.coordinate)) return failure(state, 'invalid-coordinate', 'Координата цели некорректна.');
    if (targetHasInvalidKind(command.targetKind)) return failure(state, 'target-not-colonizable', 'Эта позиция не подходит для колонизации.');
    if (targetOccupied(state, command.destination.coordinate, departedAt, undefined, runtimeOptions.mode)) return failure(state, 'target-occupied', 'Координата уже занята.');
    if (!selectedColonizerOnly(selectedShips)) return failure(state, 'wrong-ship-composition', 'Для колонизации нужен ровно один колонизатор и никаких других кораблей.');
  }

  let transportTarget: ResolvedTransportTarget | undefined;
  let transportCargo: TransportCargo | undefined;
  let transportOverflowWarning = false;
  if (command.missionId === 'transport') {
    if (!command.destination || !isFlightCoordinate(command.destination.coordinate)) {
      return failure(state, 'invalid-coordinate', 'Координата цели некорректна.');
    }
    transportTarget = resolveTransportTarget(state, command.destination);
    if (!transportTarget.acceptsTransport || !transportTarget.runtime) {
      return failure(state, 'target-not-available', 'Транспортировка возможна только на вашу или союзную планету.');
    }
    if (transportTarget.planetId === originPlanetId) {
      return failure(state, 'target-is-origin', 'Нельзя перевозить ресурсы на планету-источник.');
    }
    if (command.targetRelation !== undefined && command.targetRelation !== transportTarget.relation) {
      return failure(state, 'target-not-available', 'Транспортировка возможна только на вашу или союзную планету.');
    }
    const summary = getTransportCargoSummary(state, originPlanetId, selectedShips, command.cargo, command.destination);
    transportCargo = summary.cargo;
    transportOverflowWarning = summary.overflowWarning;
  }

  const science = state.science.levels;
  const domainResult = dispatchDomainFlight(flights, {
    requestId,
    missionId: command.missionId,
    originPlanetId,
    originCoordinate: coordinateOfPlanet(originPlanet),
    destination: command.destination!,
    targetKind: command.targetKind,
    selectedShips,
    populationReserved: command.missionId === 'colonize' ? 12 : 0,
    departedAt,
    factionId: state.profile.factionId as CombatFactionId,
    science,
    operationId: command.operationId,
    ...(command.missionId === 'espionage' ? { spyMissionId: `spy-${requestId}` } : {}),
    ...(transportTarget ? {
      destinationPlanetId: transportTarget.planetId,
      destinationOwnerId: transportTarget.ownerId,
      targetRelation: transportTarget.relation as TargetRelation,
      cargo: transportCargo,
      overflowWarning: transportOverflowWarning,
    } : {}),
    ...(command.missionId === 'espionage' ? {
      destinationPlanetId: command.destination!.kind === 'planet' ? command.destination!.planetId : undefined,
      destinationOwnerId: command.targetOwnerId,
      targetRelation: command.targetRelation,
    } : {}),
  });
  const flight = scaledRecord(domainResult.flight, runtimeOptions);
  const gas = getPlanetResources(state, originPlanetId);
  if (gas.gas < flight.gasCost) return failure(state, 'insufficient-gas', 'Недостаточно газа для исходящего участка.');

  const nextFlights = domainResult.created ? updateFlight(domainResult.state, flight) : domainResult.state;
  let nextState = replacePlanetResources({ ...state, flights: nextFlights }, originPlanetId, {
    ...gas,
    gas: gas.gas - flight.gasCost,
  });
  if (command.missionId === 'transport' && transportCargo) {
    const nextOrigin = nextState.planets[originPlanetId];
    if (!nextOrigin) return failure(state, 'invalid-command', 'Исходная планета не найдена.');
    nextState = replacePlanetState(nextState, originPlanetId, {
      ...nextOrigin,
      recycling: {
        ...nextOrigin.recycling,
        availableDebris: Math.max(0, nextOrigin.recycling.availableDebris - transportCargo.debris),
      },
    });
    const debited = getPlanetResources(nextState, originPlanetId);
    const nextResources = {
      metal: Math.max(0, debited.metal - transportCargo.metal),
      minerals: Math.max(0, debited.minerals - transportCargo.minerals),
      gas: Math.max(0, debited.gas - transportCargo.gas),
    };
    nextState = replacePlanetResources(nextState, originPlanetId, nextResources);
  }
  if (command.missionId === 'espionage' && domainResult.created) {
    const target = nextState.espionage?.bot01Planets?.[command.destination!.kind === 'planet' ? command.destination!.planetId : ''];
    if (!target) return failure(state, 'target-not-available', 'Цель шпионажа больше не доступна.');
    const mission: SpyMission = {
      id: `spy-${requestId}`,
      flightId: flight.id,
      ownerId: state.profile.playerId,
      originPlanetId,
      targetPlanetId: target.id,
      targetPlanetName: target.name,
      targetOwnerId: target.ownerId,
      targetOwnerName: target.ownerName,
      targetRaceId: target.raceId,
      targetAlliance: target.alliance,
      targetRelation: command.targetRelation as 'enemy' | 'neutral',
      targetCoordinate: { ...target.coordinate },
      spyLevel: Math.max(0, Math.floor(state.science.levels[5] ?? 0)),
      targetEspionageLevel: target.espionageLevel,
      status: 'transit',
      sentAt: flight.departedAt,
      arrivalAt: flight.arrivalAt,
      reportIds: [],
    };
    nextState = withEspionageState(nextState, {
      ...currentEspionageState(nextState),
      missions: [...currentEspionageState(nextState).missions, mission],
    });
  }
  return { ok: true, state: nextState, flight, created: true, notice: noticeForDispatch(flight) };
}

/** Read-only preview using the same application validation and calculator path as dispatch. */
export function previewFlight(
  state: SaveState,
  command: DispatchFlightCommand,
  options: FlightRuntimeOptions | number = {},
): FlightCommandResult {
  const requestId = command.requestId ?? command.commandId ?? `preview-${Date.now()}`;
  const result = dispatchFlight(state, { ...command, requestId }, options);
  return result.ok ? { ...result, state, created: false } : result;
}

export function recallFlight(
  state: SaveState,
  flightId: string,
  options: FlightRuntimeOptions | number = {},
): FlightCommandResult {
  const now = typeof options === 'number' ? options : (options.now ?? Date.now());
  const flights = currentFlightState(state);
  const flight = flights.records.find((item) => item.id === flightId);
  if (!flight) return failure(state, 'flight-not-recallable', 'Отозвать можно только исходящий рейс.');
  const spyMission = flight.missionId === 'espionage' ? spyMissionForFlight(state, flight) : undefined;
  if (flight.missionId === 'espionage' && flight.phase === 'arrived' && spyMission?.status === 'orbiting') {
    const returnedState = beginDomainFlightReturn(flights, flightId, now, 'recalled');
    const nextFlight = returnedState.records.find((item) => item.id === flightId)!;
    const nextMission: SpyMission = { ...spyMission, status: 'returning', nextReportAt: undefined };
    return {
      ok: true,
      state: withEspionageState({ ...state, flights: returnedState }, updateSpyMission(currentEspionageState(state), nextMission)),
      flight: nextFlight,
      created: false,
      notice: `Шпионский зонд отозван. Возврат через ${Math.ceil((nextFlight.returnAt! - now) / 1_000)} с.`,
    };
  }
  if (flight.missionId !== 'espionage' && now >= flight.arrivalAt) {
    return failure(state, 'flight-already-arrived', 'Рейс уже прибыл.');
  }
  if (now >= flight.arrivalAt && flight.phase === 'outbound') return failure(state, 'flight-already-arrived', 'Рейс уже прибыл.');
  if (flight.phase !== 'outbound') return failure(state, 'flight-not-recallable', 'Отозвать можно только исходящий рейс или зонд на орбите.');
  const nextFlights = recallDomainFlight(flights, flightId, now);
  const nextFlight = nextFlights.records.find((item) => item.id === flightId)!;
  const nextState = spyMission
    ? withEspionageState({ ...state, flights: nextFlights }, updateSpyMission(currentEspionageState(state), { ...spyMission, status: 'returning', nextReportAt: undefined }))
    : { ...state, flights: nextFlights };
  return {
    ok: true,
    state: nextState,
    flight: nextFlight,
    created: false,
    notice: `Рейс отозван. Возврат через ${Math.ceil((nextFlight.returnAt! - now) / 1000)} с; газ не возвращается.`,
  };
}

function transportArrivalTarget(state: SaveState, flight: FlightRecord): ResolvedTransportTarget {
  if (!flight.destinationPlanetId || !flight.targetRelation) return emptyTransportTarget(flight.destination);
  const destination: FlightDestination = {
    kind: 'planet',
    planetId: flight.destinationPlanetId,
    coordinate: flight.destinationCoordinate,
  };
  const target = resolveTransportTarget(state, destination);
  if (target.relation !== flight.targetRelation || target.ownerId !== flight.destinationOwnerId) {
    return { ...target, acceptsTransport: false };
  }
  return target;
}

function updatePlanetCargoState(
  state: SaveState,
  target: ResolvedTransportTarget,
  resources: { metal: number; minerals: number; gas: number },
  debris: number,
): SaveState {
  if (!target.runtime) return state;
  if (target.relation === 'self') {
    const withResources = replacePlanetResources(state, target.planetId, resources);
    const planet = withResources.planets[target.planetId];
    if (!planet) return withResources;
    return replacePlanetState(withResources, target.planetId, {
      ...planet,
      recycling: { ...planet.recycling, availableDebris: addDebris(planet.recycling.availableDebris, debris) },
    });
  }
  const ally = state.alliedPlanets?.[target.planetId];
  if (!ally) return state;
  return replaceAlliedPlanetState(state, target.planetId, {
    ...ally,
    resources,
    recycling: { ...ally.recycling, availableDebris: addDebris(ally.recycling.availableDebris, debris) },
  });
}

function returnTransportCargo(
  state: SaveState,
  flight: FlightRecord,
  now: number,
): { state: SaveState; flight: FlightRecord } {
  if (flight.cargoState === 'delivered' || flight.cargoState === 'returned' || flight.cargoState === 'voided') return { state, flight };
  const cargo = normalizeTransportCargo(flight.cargo);
  const origin = state.planets[flight.originPlanetId];
  if (!origin) {
    return {
      state,
      flight: { ...flight, cargoState: 'returned', cargoResolvedAt: now },
    };
  }
  const currentResources = getPlanetResources(state, flight.originPlanetId);
  const credit = getCappedDelivery(currentResources, getStorageCapacities(origin.buildings), cargo);
  let next = replacePlanetResources(state, flight.originPlanetId, credit.resources);
  const nextOrigin = next.planets[flight.originPlanetId];
  if (nextOrigin) {
    next = replacePlanetState(next, flight.originPlanetId, {
      ...nextOrigin,
      recycling: {
        ...nextOrigin.recycling,
        availableDebris: addDebris(nextOrigin.recycling.availableDebris, cargo.debris),
      },
    });
  }
  return {
    state: next,
    flight: { ...flight, cargoState: 'returned', cargoResolvedAt: now },
  };
}

function beginTransportReturn(
  state: SaveState,
  flight: FlightRecord,
  now: number,
  reason: 'normal-return' | 'recalled' | 'target-unavailable',
): FlightRecord {
  const returnStartedAt = flight.phase === 'arrived' ? Math.max(now, flight.arrivedAt ?? flight.arrivalAt) : now;
  const withSnapshot = updateFlight(state.flights, flight);
  const returningState = beginDomainFlightReturn(withSnapshot, flight.id, returnStartedAt, reason);
  const returning = returningState.records.find((item) => item.id === flight.id) ?? flight;
  return { ...returning, arrivedAt: flight.arrivedAt ?? flight.arrivalAt };
}

function completeFlight(state: SaveState, flight: FlightRecord, completed: FlightRecord): SaveState {
  return { ...state, flights: updateFlight(currentFlightState(state), completed) };
}

function spyMissionForFlight(state: SaveState, flight: FlightRecord): SpyMission | undefined {
  return currentEspionageState(state).missions.find((mission) => mission.flightId === flight.id);
}

export function reconcileFlights(state: SaveState, now: number, rng: () => number = Math.random): FlightReconcileResult {
  let next = { ...state, flights: currentFlightState(state) };
  const events: FlightReconcileEvent[] = [];
  let changed = false;

  for (const original of next.flights.records) {
    const current = next.flights.records.find((flight) => flight.id === original.id) ?? original;
    const arrivalAt = current.arrivedAt ?? current.arrivalAt;
    const arrivalCheckAt = current.arrivedAt ?? current.arrivalAt;
    const arrivalReady = current.phase === 'arrived' || (current.phase === 'outbound' && now >= current.arrivalAt);
    if (arrivalReady) {
      if (current.missionId === 'espionage') {
        const mission = spyMissionForFlight(next, current);
        if (!mission) {
          const failed: FlightRecord = { ...current, phase: 'completed', arrivedAt: arrivalAt, completedAt: now, completionReason: 'mission-failed' };
          next = completeFlight(next, current, failed);
          changed = true;
          events.push({ flight: failed, status: 'arrived', notice: 'Шпионская миссия завершена: снимок миссии не найден.' });
          continue;
        }
        if (mission.status === 'transit') {
          const resolved = resolveSpyAtTarget(next, current, mission, now, rng, true);
          if (!resolved) {
            const failedMission: SpyMission = { ...mission, status: 'destroyed', destroyedAt: now };
            const failedFlight: FlightRecord = { ...current, phase: 'completed', arrivedAt: arrivalAt, completedAt: now, completionReason: 'mission-failed' };
            next = removeSpyProbeFromOrigin(next, mission);
            next = withEspionageState(completeFlight(next, current, failedFlight), updateSpyMission(currentEspionageState(next), failedMission));
            changed = true;
            events.push({ flight: failedFlight, status: 'target-unavailable', notice: 'Шпионская миссия завершена: цель больше недоступна.' });
            continue;
          }
          next = resolved.state;
          changed = true;
          events.push(resolved.event);
          continue;
        }
        if (mission.status === 'orbiting') continue;
      }
      if (current.missionId === 'transport') {
        const target = transportArrivalTarget(next, current);
        const cargo = normalizeTransportCargo(current.cargo);
        if (!target.acceptsTransport || !target.runtime) {
          const voided: FlightRecord = {
            ...current,
            arrivedAt: arrivalAt,
            cargoState: current.cargoState === 'returned' ? 'returned' : 'voided',
            cargoResolvedAt: current.cargoState === 'returned' ? current.cargoResolvedAt : now,
          };
          const returning = beginTransportReturn(next, voided, now, 'target-unavailable');
          next = { ...next, flights: updateFlight(next.flights, returning) };
          changed = true;
          events.push({
            flight: returning,
            status: 'target-unavailable',
            notice: 'Цель недоступна; груз будет потерян, корабли возвращаются.',
          });
          continue;
        }

        if (current.cargoState !== 'delivered' && current.cargoState !== 'returned') {
          const targetResources = target.runtime.resources ?? { metal: 0, minerals: 0, gas: 0 };
          const delivery = getCappedDelivery(
            targetResources,
            getStorageCapacities(target.runtime.buildings),
            cargo,
          );
          next = updatePlanetCargoState(next, target, delivery.resources, cargo.debris);
          const delivered: FlightRecord = {
            ...current,
            arrivedAt: arrivalAt,
            cargoState: 'delivered',
            deliveredAt: now,
            cargoResolvedAt: now,
          };
          const returning = beginTransportReturn(next, delivered, now, 'normal-return');
          next = { ...next, flights: updateFlight(next.flights, returning) };
          changed = true;
          events.push({
            flight: returning,
            status: 'delivered',
            notice: 'Груз доставлен. Корабли возвращаются.',
          });
          continue;
        }

        const returning = beginTransportReturn(next, current, now, current.cargoState === 'returned' ? 'recalled' : 'normal-return');
        next = { ...next, flights: updateFlight(next.flights, returning) };
        changed = true;
        continue;
      }
      if (current.missionId !== 'colonize') {
        const failed: FlightRecord = { ...current, phase: 'completed', arrivedAt: arrivalAt, completedAt: now, completionReason: 'mission-failed' };
        next = completeFlight(next, current, failed);
        changed = true;
        events.push({ flight: failed, status: 'arrived', notice: 'Миссия пока не поддерживается и завершена без результата.' });
        continue;
      }
      if (targetOccupied(next, current.destinationCoordinate, arrivalCheckAt, current.id) || targetHasInvalidKind(current.targetKind)) {
        const returnStartedAt = current.phase === 'arrived' ? Math.max(now, arrivalAt) : now;
        const returningState = beginDomainFlightReturn(next.flights, current.id, returnStartedAt, 'target-occupied');
        const returning = returningState.records.find((flight) => flight.id === current.id)!;
        const withArrival: FlightRecord = { ...returning, arrivedAt: arrivalAt, completionReason: 'target-occupied' };
        next = { ...next, flights: updateFlight(returningState, withArrival) };
        changed = true;
        events.push({ flight: withArrival, status: 'target-occupied', notice: 'Координата уже занята. Колонизатор возвращается.' });
        continue;
      }

      const planetId = makePlanetId(current.destinationCoordinate);
      if (next.planets[planetId]) {
        const returnStartedAt = current.phase === 'arrived' ? Math.max(now, arrivalAt) : now;
        const returningState = beginDomainFlightReturn(next.flights, current.id, returnStartedAt, 'target-occupied');
        const returning = returningState.records.find((flight) => flight.id === current.id)!;
        const withArrival: FlightRecord = { ...returning, arrivedAt: arrivalAt, completionReason: 'target-occupied' };
        next = { ...next, flights: updateFlight(returningState, withArrival) };
        changed = true;
        events.push({ flight: withArrival, status: 'target-occupied', notice: 'Координата уже занята. Колонизатор возвращается.' });
        continue;
      }
      const colony = createColonyPlanet(next, current.destinationCoordinate);
      const origin = next.planets[current.originPlanetId];
      if (!origin) {
        const failed: FlightRecord = {
          ...current,
          phase: 'completed',
          arrivedAt: arrivalAt,
          completedAt: now,
          completionReason: 'mission-failed',
        };
        next = completeFlight(next, current, failed);
        changed = true;
        events.push({ flight: failed, status: 'arrived', notice: 'Рейс завершён: исходная планета не найдена, корабль не был продублирован.' });
        continue;
      }
      const originFleet = removeSolarSatellitesFromFleet(resolveSavedFleetState(origin.fleet, next.profile.factionId)).fleet;
      const consumedFleet: OwnedFleetState = {
        ...originFleet,
        ships: { ...originFleet.ships, colonizer: Math.max(0, (originFleet.ships.colonizer ?? 0) - 1) },
      };
      const nextOrigin = { ...origin, fleet: consumedFleet };
      const completed: FlightRecord = {
        ...current,
        phase: 'completed',
        arrivedAt: arrivalAt,
        completedAt: now,
        completionReason: 'colonized',
      };
      const withOrigin = replacePlanetState(next, current.originPlanetId, nextOrigin);
      next = {
        ...withOrigin,
        planets: { ...withOrigin.planets, [planetId]: colony },
        queues: { ...next.queues, [planetId]: [] },
        flights: updateFlight(next.flights, completed),
      };
      next = initializePlanetResourceClock(next, planetId, now);
      changed = true;
      events.push({ flight: completed, status: 'colonized', notice: `Колония основана в [${current.destinationCoordinate.galaxy}:${current.destinationCoordinate.system}:${current.destinationCoordinate.position}] · ресурсы 500/500/500.` });
      continue;
    }

    const refreshed = next.flights.records.find((flight) => flight.id === original.id) ?? original;
    if (refreshed.phase === 'returning' && refreshed.returnAt !== undefined && now >= refreshed.returnAt) {
      let returnedFlight = refreshed;
      if (refreshed.missionId === 'transport') {
        const returned = returnTransportCargo(next, refreshed, refreshed.returnAt);
        next = returned.state;
        returnedFlight = returned.flight;
      }
      const spyMission = refreshed.missionId === 'espionage' ? spyMissionForFlight(next, refreshed) : undefined;
      const completed: FlightRecord = {
        ...returnedFlight,
        phase: 'completed',
        completedAt: refreshed.returnAt,
        completionReason: returnedFlight.missionId === 'transport'
          ? returnedFlight.completionReason ?? 'recalled'
          : returnedFlight.completionReason === 'target-occupied' ? 'target-occupied' : 'recalled',
      };
      next = completeFlight(next, returnedFlight, completed);
      if (spyMission && spyMission.status === 'returning') {
        next = withEspionageState(next, updateSpyMission(currentEspionageState(next), {
          ...spyMission,
          status: 'returned',
          returnedAt: refreshed.returnAt,
          nextReportAt: undefined,
        }));
      }
      changed = true;
      events.push({
        flight: completed,
        status: 'returned',
        notice: completed.missionId === 'transport'
          ? completed.completionReason === 'target-unavailable'
            ? 'Транспорт вернулся: цель недоступна, груз потерян.'
            : completed.completionReason === 'normal-return'
              ? 'Транспорт вернулся после доставки.'
              : 'Транспорт вернулся после отзыва рейса.'
          : completed.missionId === 'espionage'
            ? 'Шпионский зонд вернулся на исходную планету.'
            : completed.completionReason === 'target-occupied' ? 'Колонизатор вернулся: координата уже занята.' : 'Колонизатор вернулся после отзыва рейса.',
      });
    }
  }

  return { changed, state: changed ? next : state, events };
}

export type SpyReportRuntimeOptions = {
  now?: number;
  rng?: () => number;
};

function spyReportFailure(state: SaveState, code: FlightErrorCode, message: string): SpyReportCommandFailure {
  return { ok: false, state, error: { code, message } };
}

export function requestSpyReport(
  state: SaveState,
  missionId: string,
  options: SpyReportRuntimeOptions = {},
): SpyReportCommandResult {
  const now = options.now ?? Date.now();
  const rng = options.rng ?? Math.random;
  const mission = currentEspionageState(state).missions.find((item) => item.id === missionId);
  if (!mission) return spyReportFailure(state, 'spy-mission-not-found', 'Шпионская миссия не найдена.');
  if (mission.status !== 'orbiting') return spyReportFailure(state, 'spy-mission-not-found', 'Запрос доступен только для зонда на орбите.');
  if (!canRequestSpyReport(mission, now)) {
    return spyReportFailure(state, 'spy-report-cooldown', `Следующий отчёт будет доступен через ${Math.max(0, Math.ceil((mission.nextReportAt! - now) / 1_000))} с.`);
  }
  const flight = getFlightById(state, mission.flightId);
  if (!flight || flight.phase !== 'arrived') return spyReportFailure(state, 'spy-mission-not-found', 'Полёт шпионского зонда больше не активен.');
  const reportId = `spy-report-${mission.id}-${mission.reportIds.length + 1}`;
  const resolved = resolveSpyAtTarget(state, flight, mission, now, rng, false);
  if (!resolved) return spyReportFailure(state, 'target-not-available', 'Цель шпионажа больше недоступна.');
  const report = resolved.state.espionage?.reports.find((item) => item.id === reportId);
  return { ok: true, state: resolved.state, report, notice: resolved.event.notice };
}

export function requestAllSpyReports(
  state: SaveState,
  missionIds: readonly string[] = [],
  options: SpyReportRuntimeOptions = {},
): SpyReportCommandResult {
  let next = state;
  const selected = new Set(missionIds);
  let count = 0;
  let processed = 0;
  let skippedCooldown = 0;
  let destroyed = 0;
  for (const mission of currentEspionageState(next).missions) {
    if (mission.status !== 'orbiting' || (selected.size > 0 && !selected.has(mission.id))) continue;
    const result = requestSpyReport(next, mission.id, options);
    if (result.ok) {
      next = result.state;
      processed += 1;
      count += result.report ? 1 : 0;
      if (!result.report) destroyed += 1;
    } else if (result.error.code === 'spy-report-cooldown') {
      skippedCooldown += 1;
    }
  }
  if (processed === 0) {
    return spyReportFailure(next, 'spy-report-cooldown', skippedCooldown > 0
      ? `Нет зондов с готовым отчётом. На cooldown: ${skippedCooldown}.`
      : 'Нет активных зондов с готовым отчётом.');
  }
  return {
    ok: true,
    state: next,
    notice: `Получено новых шпионских отчётов: ${count}.${skippedCooldown ? ` Пропущено на cooldown: ${skippedCooldown}.` : ''}${destroyed ? ` Уничтожено зондов: ${destroyed}.` : ''}`,
  };
}

export function getFlightById(state: SaveState, flightId: string): FlightRecord | undefined {
  return currentFlightState(state).records.find((flight) => flight.id === flightId);
}

export function getActiveFlightRecords(state: SaveState): FlightRecord[] {
  return activeFlights(state);
}
