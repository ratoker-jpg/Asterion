import type { CombatFactionId } from '../combat/factions.ts';
import type { ShipId } from '../combat/ids.ts';
import { calculateRouteDistance, assertFlightCoordinate } from './distance.ts';
import { calculateFlightFuel } from './fuel.ts';
import { calculateEffectiveFleetSpeed, calculateOneWayDurationMs } from './speed.ts';
import { normalizeTransportCargo } from './cargo.ts';
import type { TransportCargo } from './cargo.ts';
import type { TargetRelation } from './types.ts';
import type { CommanderId } from '../combat/commanders.ts';
import type { AttackLaunchSnapshot, AttackResolution } from '../attack/types.ts';
import type { FlightCompletionReason, FlightDestination, FlightRecord, FlightScienceLevels, FlightState, MissionId } from './types.ts';

export type DispatchFlightInput = {
  requestId: string;
  missionId: MissionId;
  ownerSide?: FlightRecord['ownerSide'];
  originPlanetId: string;
  originCoordinate: FlightRecord['originCoordinate'];
  destination: FlightDestination;
  selectedShips: Partial<Record<ShipId, number>>;
  selectedCommanders?: Partial<Record<CommanderId, number>>;
  selectedCommanderLevels?: Partial<Record<CommanderId, number>>;
  recycleCapacity?: number;
  gasCapacity?: number;
  attackSnapshot?: AttackLaunchSnapshot;
  attackResolution?: AttackResolution;
  populationReserved?: number;
  departedAt: number;
  factionId: CombatFactionId;
  science?: FlightScienceLevels;
  operationId?: string;
  spyMissionId?: string;
  targetKind?: FlightRecord['targetKind'];
  /** Resolved target snapshot for a coordinate-addressed transport. */
  destinationPlanetId?: string;
  targetPlanetName?: string;
  targetOwnerName?: string;
  destinationOwnerId?: string;
  targetRelation?: TargetRelation;
  cargo?: TransportCargo;
  overflowWarning?: boolean;
  /** Explicit one-way duration for destinationless Space Flight. */
  durationMs?: number;
};

export const MIN_SPACE_FLIGHT_DURATION_MS = 5 * 60_000;
export const MAX_SPACE_FLIGHT_DURATION_MS = 11 * 60 * 60_000 + 59 * 60_000;
export const SPACE_FLIGHT_DURATION_STEP_MS = 60_000;

export function createFlightState(): FlightState {
  return { records: [], requestIndex: {} };
}

export function getFlightByRequestId(state: FlightState, requestId: string): FlightRecord | undefined {
  const id = state.requestIndex[requestId];
  const indexed = id ? state.records.find((flight) => flight.id === id && flight.requestId === requestId) : undefined;
  return indexed ?? state.records.find((flight) => flight.requestId === requestId);
}

export function createFlightRecord(input: DispatchFlightInput): FlightRecord {
  if (!input.requestId) throw new Error('A dispatch request ID is required.');
  assertFlightCoordinate(input.originCoordinate);
  assertFlightCoordinate(input.destination.coordinate);
  if (!Number.isFinite(input.departedAt)) throw new Error('Departure time must be finite.');
  const selectedCommanders = input.selectedCommanders ?? {};
  const isSpaceFlight = input.missionId === 'space-flight';
  const requestedDuration = input.durationMs;
  if (isSpaceFlight && (input.destination.kind !== 'space'
    || !Number.isSafeInteger(requestedDuration)
    || requestedDuration! < MIN_SPACE_FLIGHT_DURATION_MS
    || requestedDuration! > MAX_SPACE_FLIGHT_DURATION_MS
    || requestedDuration! % SPACE_FLIGHT_DURATION_STEP_MS !== 0)) {
    throw new Error('Space Flight duration must be between 5 minutes and 11 hours 59 minutes in one-minute steps.');
  }
  if (!isSpaceFlight && input.destination.kind === 'space') {
    throw new Error('Only Space Flight may use a destinationless route.');
  }
  const routeDistance = isSpaceFlight ? 0 : calculateRouteDistance(input.originCoordinate, input.destination.coordinate);
  const effectiveSpeed = isSpaceFlight ? 0 : calculateEffectiveFleetSpeed(input.factionId, input.selectedShips, input.science, selectedCommanders);
  const oneWayDurationMs = isSpaceFlight
    ? requestedDuration!
    : calculateOneWayDurationMs(input.originCoordinate, input.destination.coordinate, effectiveSpeed);
  const destinationPlanetId = input.destination.kind === 'planet' ? input.destination.planetId : input.destinationPlanetId;
  if (input.missionId === 'transport' && input.cargo === undefined) {
    throw new Error('Transport flights require a cargo snapshot.');
  }
  if (isSpaceFlight && input.cargo === undefined) {
    throw new Error('Space Flights require a cargo snapshot.');
  }
  if (input.missionId === 'recycle' && input.cargo === undefined) {
    throw new Error('Recycle flights require an empty cargo snapshot.');
  }
  if (input.missionId === 'recycle' && (!Number.isSafeInteger(input.recycleCapacity) || (input.recycleCapacity ?? 0) <= 0)) {
    throw new Error('Recycle flights require a positive capacity snapshot.');
  }
  if (input.missionId === 'gas' && input.cargo === undefined) {
    throw new Error('Gas extraction flights require an empty cargo snapshot.');
  }
  if (input.missionId === 'gas' && (!Number.isSafeInteger(input.gasCapacity) || (input.gasCapacity ?? 0) <= 0)) {
    throw new Error('Gas extraction flights require a positive capacity snapshot.');
  }
  const cargo = input.missionId === 'transport' || input.missionId === 'space-flight' || input.missionId === 'recycle' || input.missionId === 'gas'
    ? normalizeTransportCargo(input.cargo)
    : undefined;
  return {
    id: `flight-${input.requestId}`,
    requestId: input.requestId,
    ...(input.ownerSide ? { ownerSide: input.ownerSide } : {}),
    missionId: input.missionId,
    operationId: input.operationId ?? (input.destination.kind === 'operation' ? input.destination.operationId : undefined),
    spyMissionId: input.spyMissionId,
    originPlanetId: input.originPlanetId,
    originCoordinate: { ...input.originCoordinate },
    destination: input.destination.kind === 'coordinate'
      ? { kind: 'coordinate', coordinate: { ...input.destination.coordinate } }
      : input.destination.kind === 'planet'
        ? { kind: 'planet', planetId: input.destination.planetId, coordinate: { ...input.destination.coordinate } }
        : input.destination.kind === 'operation'
          ? { kind: 'operation', operationId: input.destination.operationId, coordinate: { ...input.destination.coordinate } }
          : { kind: 'space', coordinate: { ...input.originCoordinate } },
    destinationPlanetId,
    targetKind: input.targetKind,
    ...(input.targetPlanetName ? { targetPlanetName: input.targetPlanetName } : {}),
    ...(input.targetOwnerName ? { targetOwnerName: input.targetOwnerName } : {}),
    destinationOwnerId: input.destinationOwnerId,
    targetRelation: input.targetRelation,
    destinationCoordinate: { ...input.destination.coordinate },
    selectedShips: { ...input.selectedShips },
    ...(input.selectedCommanders ? { selectedCommanders: { ...input.selectedCommanders } } : {}),
    ...(input.selectedCommanderLevels ? { selectedCommanderLevels: { ...input.selectedCommanderLevels } } : {}),
    ...(input.missionId === 'recycle' ? { recycleCapacity: input.recycleCapacity } : {}),
    ...(input.missionId === 'gas' ? { gasCapacity: input.gasCapacity } : {}),
    ...(input.attackSnapshot ? { attackSnapshot: input.attackSnapshot } : {}),
    ...(input.attackResolution ? { attackResolution: input.attackResolution } : {}),
    populationReserved: Math.max(0, Math.floor(input.populationReserved ?? 0)),
    routeDistance,
    effectiveSpeed,
    oneWayDurationMs,
    departedAt: input.departedAt,
    arrivalAt: input.departedAt + oneWayDurationMs,
    gasCost: isSpaceFlight ? 100 : calculateFlightFuel(input.factionId, input.selectedShips, routeDistance, input.science, selectedCommanders),
    cargo,
    cargoState: cargo ? 'loaded' : undefined,
    overflowWarning: cargo ? Boolean(input.overflowWarning) : undefined,
    phase: 'outbound',
  };
}

/** Idempotent dispatch keyed by persisted requestId. */
export function dispatchFlight(state: FlightState, input: DispatchFlightInput): { state: FlightState; flight: FlightRecord; created: boolean } {
  const existing = getFlightByRequestId(state, input.requestId);
  if (existing) return { state, flight: existing, created: false };
  const flight = createFlightRecord(input);
  return {
    state: { records: [...state.records, flight], requestIndex: { ...state.requestIndex, [input.requestId]: flight.id } },
    flight,
    created: true,
  };
}

export function recallFlight(state: FlightState, flightId: string, nowMs: number): FlightState {
  const flight = state.records.find((record) => record.id === flightId);
  if (!flight || flight.phase !== 'outbound' || nowMs >= flight.arrivalAt) return state;
  const elapsed = Math.min(flight.oneWayDurationMs, Math.max(0, nowMs - flight.departedAt));
  const next: FlightRecord = { ...flight, phase: 'returning', recalledAt: nowMs, returnAt: nowMs + elapsed, completionReason: 'recalled' };
  return { ...state, records: state.records.map((record) => record.id === flightId ? next : record) };
}

export function beginFlightReturn(state: FlightState, flightId: string, nowMs: number, reason: FlightCompletionReason = 'normal'): FlightState {
  const flight = state.records.find((record) => record.id === flightId);
  if (!flight || (flight.phase !== 'outbound' && flight.phase !== 'arrived')) return state;
  const next: FlightRecord = { ...flight, phase: 'returning', returnAt: nowMs + flight.oneWayDurationMs, completionReason: reason };
  return { ...state, records: state.records.map((record) => record.id === flightId ? next : record) };
}

/** Applies time-only transitions once; mission effects belong to a higher-level resolver. */
export function reconcileFlightState(state: FlightState, nowMs: number): FlightState {
  let records = state.records;
  let changed = false;
  for (const flight of Object.values(state.records)) {
    let next = flight;
    if (flight.phase === 'outbound' && nowMs >= flight.arrivalAt) {
      next = { ...flight, phase: 'arrived', arrivedAt: flight.arrivalAt, completionReason: 'arrived' };
    } else if (flight.phase === 'returning' && flight.returnAt !== undefined && nowMs >= flight.returnAt) {
      next = { ...flight, phase: 'completed', completedAt: flight.returnAt, completionReason: flight.completionReason ?? 'normal' };
    }
    if (next !== flight) {
      if (!changed) records = [...state.records];
      records = records.map((record) => record.id === flight.id ? next : record);
      changed = true;
    }
  }
  return changed ? { ...state, records } : state;
}
