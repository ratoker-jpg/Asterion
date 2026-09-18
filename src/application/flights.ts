import type { CombatFactionId } from '../domain/combat/factions.ts';
import { createEmptyDefenseState } from '../domain/fleet/production.ts';
import {
  createEmptyFleetState,
  removeSolarSatellitesFromFleet,
  resolveSavedFleetState,
  type OwnedFleetState,
} from '../domain/fleet/runtime.ts';
import { createDefaultFleetProductionState } from '../domain/fleet/production.ts';
import type { ShipId } from '../domain/combat/ids.ts';
import {
  createDefaultBuildingLevels,
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
import { scaleRuntimeDuration, type RuntimeMode, type TestTimeScale } from '../domain/runtime/mode.ts';
import type {
  FlightDestination,
  FlightRecord,
  FlightState,
  MissionId,
} from '../domain/flights/types.ts';
import { createUniverseSystem } from '../domain/universe/runtime.ts';
import type { UniverseCoordinate, UniverseObjectKind, UniversePersistedPlayerPlanet } from '../domain/universe/types.ts';

export const FLIGHT_LAUNCH_CONTEXT_EVENT = 'asterion:flight-launch-context';
export const FLIGHT_EDIT_TARGET_REQUEST_EVENT = 'asterion:flight-edit-target-request';
export const FLIGHT_DISPATCH_REQUEST_EVENT = 'asterion:flight-dispatch-request';
export const FLIGHT_RECALL_REQUEST_EVENT = 'asterion:flight-recall-request';
export const FLIGHT_COMMAND_RESULT_EVENT = 'asterion:flight-command-result';

export type FlightLaunchContext = {
  missionId: MissionId;
  destination: FlightDestination;
  targetKind?: UniverseObjectKind;
  operationId?: string;
};

export type FlightErrorCode =
  | 'invalid-coordinate'
  | 'target-occupied'
  | 'target-not-colonizable'
  | 'wrong-ship-composition'
  | 'insufficient-ships'
  | 'ship-already-reserved'
  | 'insufficient-gas'
  | 'mission-not-supported'
  | 'flight-not-recallable'
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
  destination: FlightDestination;
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
  status: 'arrived' | 'returned' | 'target-occupied' | 'colonized';
  notice: string;
};

export type FlightReconcileResult = {
  changed: boolean;
  state: SaveState;
  events: FlightReconcileEvent[];
};

const ACTIVE_FLIGHT_PHASES = new Set<FlightRecord['phase']>(['outbound', 'returning', 'arrived']);
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

function targetOccupied(state: SaveState, coordinate: UniverseCoordinate, nowMs: number, currentFlightId?: string): boolean {
  const system = createUniverseSystem({
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
    populationReserved: 12,
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
  if (command.missionId !== 'colonize') return failure(state, 'mission-not-supported', 'Эта миссия пока не подключена к flight runtime.');
  if (command.destination.kind !== 'coordinate') return failure(state, 'target-not-colonizable', 'Колонизация допускает только свободную координату.');
  if (!isFlightCoordinate(command.destination.coordinate)) return failure(state, 'invalid-coordinate', 'Координата цели некорректна.');
  if (targetHasInvalidKind(command.targetKind)) return failure(state, 'target-not-colonizable', 'Эта позиция не подходит для колонизации.');

  const departedAt = Number.isFinite(command.departedAt) ? command.departedAt! : (runtimeOptions.now ?? Date.now());

  const originPlanetId = command.originPlanetId ?? state.currentPlanetId;
  const originPlanet = state.planets[originPlanetId];
  if (!originPlanet) return failure(state, 'invalid-command', 'Исходная планета не найдена.');
  if (targetOccupied(state, command.destination.coordinate, departedAt)) return failure(state, 'target-occupied', 'Координата уже занята.');
  if (!selectedColonizerOnly(command.selectedShips)) return failure(state, 'wrong-ship-composition', 'Для колонизации нужен ровно один колонизатор и никаких других кораблей.');

  const availableFleet = getAvailableFleetForPlanet(state, originPlanetId);
  if ((availableFleet.ships.colonizer ?? 0) < 1) {
    const reserved = getReservedShipsForPlanet(state, originPlanetId).colonizer ?? 0;
    return failure(state, reserved > 0 ? 'ship-already-reserved' : 'insufficient-ships', reserved > 0 ? 'Колонизатор уже зарезервирован другим рейсом.' : 'На исходной планете нет доступного колонизатора.');
  }

  const science = state.science.levels;
  const domainResult = dispatchDomainFlight(flights, {
    requestId,
    missionId: command.missionId,
    originPlanetId,
    originCoordinate: coordinateOfPlanet(originPlanet),
    destination: command.destination,
    targetKind: command.targetKind,
    selectedShips: { colonizer: 1 },
    populationReserved: 12,
    departedAt,
    factionId: state.profile.factionId as CombatFactionId,
    science,
    operationId: command.operationId,
  });
  const flight = scaledRecord(domainResult.flight, runtimeOptions);
  const gas = getPlanetResources(state, originPlanetId);
  if (gas.gas < flight.gasCost) return failure(state, 'insufficient-gas', 'Недостаточно газа для исходящего участка.');

  const nextFlights = domainResult.created ? updateFlight(domainResult.state, flight) : domainResult.state;
  const nextState = replacePlanetResources({ ...state, flights: nextFlights }, originPlanetId, {
    ...gas,
    gas: gas.gas - flight.gasCost,
  });
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
  if (!flight || flight.phase !== 'outbound') return failure(state, 'flight-not-recallable', 'Отозвать можно только исходящий рейс.');
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

function completeFlight(state: SaveState, flight: FlightRecord, completed: FlightRecord): SaveState {
  return { ...state, flights: updateFlight(currentFlightState(state), completed) };
}

export function reconcileFlights(state: SaveState, now: number): FlightReconcileResult {
  let next = { ...state, flights: currentFlightState(state) };
  const events: FlightReconcileEvent[] = [];
  let changed = false;

  for (const original of next.flights.records) {
    const current = next.flights.records.find((flight) => flight.id === original.id) ?? original;
    if (current.phase === 'outbound' && now >= current.arrivalAt) {
      if (current.missionId !== 'colonize') {
        const failed: FlightRecord = { ...current, phase: 'completed', arrivedAt: current.arrivalAt, completedAt: now, completionReason: 'mission-failed' };
        next = completeFlight(next, current, failed);
        changed = true;
        events.push({ flight: failed, status: 'arrived', notice: 'Миссия пока не поддерживается и завершена без результата.' });
        continue;
      }
      if (targetOccupied(next, current.destinationCoordinate, now, current.id) || targetHasInvalidKind(current.targetKind)) {
        const returningState = beginDomainFlightReturn(next.flights, current.id, now, 'target-occupied');
        const returning = returningState.records.find((flight) => flight.id === current.id)!;
        const withArrival: FlightRecord = { ...returning, arrivedAt: now, completionReason: 'target-occupied' };
        next = { ...next, flights: updateFlight(returningState, withArrival) };
        changed = true;
        events.push({ flight: withArrival, status: 'target-occupied', notice: 'Координата уже занята. Колонизатор возвращается.' });
        continue;
      }

      const planetId = makePlanetId(current.destinationCoordinate);
      if (next.planets[planetId]) continue;
      const colony = createColonyPlanet(next, current.destinationCoordinate);
      const origin = next.planets[current.originPlanetId];
      if (!origin) continue;
      const originFleet = removeSolarSatellitesFromFleet(resolveSavedFleetState(origin.fleet, next.profile.factionId)).fleet;
      const consumedFleet: OwnedFleetState = {
        ...originFleet,
        ships: { ...originFleet.ships, colonizer: Math.max(0, (originFleet.ships.colonizer ?? 0) - 1) },
      };
      const nextOrigin = { ...origin, fleet: consumedFleet };
      const completed: FlightRecord = {
        ...current,
        phase: 'completed',
        arrivedAt: current.arrivalAt,
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
      changed = true;
      events.push({ flight: completed, status: 'colonized', notice: `Колония основана в [${current.destinationCoordinate.galaxy}:${current.destinationCoordinate.system}:${current.destinationCoordinate.position}] · ресурсы 500/500/500.` });
      continue;
    }

    const refreshed = next.flights.records.find((flight) => flight.id === original.id) ?? original;
    if (refreshed.phase === 'returning' && refreshed.returnAt !== undefined && now >= refreshed.returnAt) {
      const completed: FlightRecord = {
        ...refreshed,
        phase: 'completed',
        completedAt: refreshed.returnAt,
        completionReason: refreshed.completionReason === 'target-occupied' ? 'target-occupied' : 'recalled',
      };
      next = completeFlight(next, refreshed, completed);
      changed = true;
      events.push({
        flight: completed,
        status: 'returned',
        notice: completed.completionReason === 'target-occupied' ? 'Колонизатор вернулся: координата уже занята.' : 'Колонизатор вернулся после отзыва рейса.',
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
