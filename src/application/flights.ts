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
import { createUniverseSystem } from '../domain/universe/runtime.ts';
import type { UniverseCoordinate, UniverseObjectKind, UniversePersistedPlayerPlanet } from '../domain/universe/types.ts';
import { initializePlanetResourceClock } from './resource-clock.ts';

export const FLIGHT_LAUNCH_CONTEXT_EVENT = 'asterion:flight-launch-context';
export const FLIGHT_LAUNCH_CONTEXT_CLEAR_EVENT = 'asterion:flight-launch-context-clear';
export const FLIGHT_EDIT_TARGET_REQUEST_EVENT = 'asterion:flight-edit-target-request';
export const FLIGHT_DISPATCH_REQUEST_EVENT = 'asterion:flight-dispatch-request';
export const FLIGHT_RECALL_REQUEST_EVENT = 'asterion:flight-recall-request';
export const FLIGHT_COMMAND_RESULT_EVENT = 'asterion:flight-command-result';

export type FlightLaunchContext = {
  missionId: MissionId;
  destination?: FlightDestination;
  targetRelation?: TargetRelation;
  targetKind?: UniverseObjectKind;
  operationId?: string;
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

export type FlightReconcileEvent = {
  flight: FlightRecord;
  status: 'arrived' | 'returned' | 'target-occupied' | 'target-unavailable' | 'delivered' | 'colonized';
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
  const target = resolveTransportTarget(state, destination);
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
  if (command.missionId !== 'colonize' && command.missionId !== 'transport') {
    return failure(state, 'mission-not-supported', 'Эта миссия пока не подключена к flight runtime.');
  }
  const departedAt = Number.isFinite(command.departedAt) ? command.departedAt! : (runtimeOptions.now ?? Date.now());
  const originPlanetId = command.originPlanetId ?? state.currentPlanetId;
  const originPlanet = state.planets[originPlanetId];
  if (!originPlanet) return failure(state, 'invalid-command', 'Исходная планета не найдена.');
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
    ...(transportTarget ? {
      destinationPlanetId: transportTarget.planetId,
      destinationOwnerId: transportTarget.ownerId,
      targetRelation: transportTarget.relation as TargetRelation,
      cargo: transportCargo,
      overflowWarning: transportOverflowWarning,
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
  if (now >= flight.arrivalAt) return failure(state, 'flight-already-arrived', 'Рейс уже прибыл.');
  if (flight.phase !== 'outbound') return failure(state, 'flight-not-recallable', 'Отозвать можно только исходящий рейс.');
  const nextFlights = recallDomainFlight(flights, flightId, now);
  const nextFlight = nextFlights.records.find((item) => item.id === flightId)!;
  return {
    ok: true,
    state: { ...state, flights: nextFlights },
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

export function reconcileFlights(state: SaveState, now: number): FlightReconcileResult {
  let next = { ...state, flights: currentFlightState(state) };
  const events: FlightReconcileEvent[] = [];
  let changed = false;

  for (const original of next.flights.records) {
    const current = next.flights.records.find((flight) => flight.id === original.id) ?? original;
    const arrivalAt = current.arrivedAt ?? current.arrivalAt;
    const arrivalCheckAt = current.arrivedAt ?? current.arrivalAt;
    const arrivalReady = current.phase === 'arrived' || (current.phase === 'outbound' && now >= current.arrivalAt);
    if (arrivalReady) {
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
            notice: current.overflowWarning
              ? 'Груз доставлен с возможным переполнением склада цели. Корабли возвращаются.'
              : 'Груз доставлен. Корабли возвращаются.',
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
      const completed: FlightRecord = {
        ...returnedFlight,
        phase: 'completed',
        completedAt: refreshed.returnAt,
        completionReason: returnedFlight.missionId === 'transport'
          ? returnedFlight.completionReason ?? 'recalled'
          : returnedFlight.completionReason === 'target-occupied' ? 'target-occupied' : 'recalled',
      };
      next = completeFlight(next, returnedFlight, completed);
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
          : completed.completionReason === 'target-occupied' ? 'Колонизатор вернулся: координата уже занята.' : 'Колонизатор вернулся после отзыва рейса.',
      });
    }
  }

  return { changed, state: changed ? next : state, events };
}

export function getFlightById(state: SaveState, flightId: string): FlightRecord | undefined {
  return currentFlightState(state).records.find((flight) => flight.id === flightId);
}

export function getActiveFlightRecords(state: SaveState): FlightRecord[] {
  return activeFlights(state);
}
