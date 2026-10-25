import { getStorageCapacities } from '../domain/buildings/resource-zone.ts';
import { getFactionShipCatalog } from '../domain/combat/faction-catalog.ts';
import type { ShipId } from '../domain/combat/ids.ts';
import type { AidResource, ResourceRequest } from '../domain/command/types.ts';
import {
  appendAidEvent,
  closeRequestPlanetLost,
  creditAidDelivery,
  isAidPairValid,
  isRequestOpen,
  markRequestHelpStarted,
  requestOpenRemainder,
  selectFulfillableRequests,
  selectRequestById,
} from '../domain/command/aid.ts';
import { selectOwnerMembership } from '../domain/command/selectors.ts';
import { calculateRouteDistance, isFlightCoordinate } from '../domain/flights/distance.ts';
import { addDebris, emptyTransportCargo, getCappedDelivery, getFleetCargoCapacity, normalizeTransportCargo, type TransportCargo } from '../domain/flights/cargo.ts';
import { aidInFlightUnits } from '../domain/flights/aid-mission.ts';
import { calculateFlightFuel } from '../domain/flights/fuel.ts';
import { beginFlightReturn, createFlightState, dispatchFlight, getFlightByRequestId } from '../domain/flights/runtime.ts';
import type { AidFlightSnapshot, FlightRecord } from '../domain/flights/types.ts';
import type { NpcProfile } from '../domain/npc/types.ts';
import { UNIVERSE_NPC_OWNER_ID } from '../domain/universe/runtime.ts';
import { getPlanetResources, type SaveState } from './contracts.ts';
import { calculateFleetPopulation } from '../domain/fleet/runtime.ts';
import { calculateDefensePopulation } from '../domain/fleet/production.ts';
import type { SpyTargetState } from '../domain/espionage/types.ts';

export type NpcAidPayload = Readonly<{
  requestId: string;
  originPlanetId: string;
  resource: AidResource;
  units: number;
  transporter: number;
  megaTransporter: number;
}>;

export type NpcAidCandidate = Readonly<{
  id: string;
  kind: 'aid';
  weight: number;
  payload: NpcAidPayload;
}>;

export type NpcAidResult = Readonly<{
  state: SaveState;
  ok: boolean;
  reason: string | null;
  flight?: FlightRecord;
}>;

type AidSource = SpyTargetState;

function npcSources(state: SaveState, ownerId: string): AidSource[] {
  return Object.values(state.espionage?.targets ?? {})
    .filter((target) => target.kind === 'npc' && target.ownerId === ownerId)
    .sort((left, right) => left.id.localeCompare(right.id));
}

function coordinateOfPlayerPlanet(planet: SaveState['planets'][string]) {
  return {
    galaxy: Number.isSafeInteger(planet.universeGalaxy) && (planet.universeGalaxy ?? 0) > 0 ? planet.universeGalaxy! : 1,
    system: Number.isSafeInteger(planet.universeSystem) && (planet.universeSystem ?? 0) > 0 ? planet.universeSystem! : 1,
    position: Number.isSafeInteger(planet.universePosition) && (planet.universePosition ?? 0) > 0 ? planet.universePosition! : 1,
  };
}

function requestPlanet(state: SaveState, request: ResourceRequest): { ownerId: string; coordinate: ResourceRequest['coordinate']; name: string; buildings: Record<string, number>; resources: { metal: number; minerals: number; gas: number }; debris: number } | null {
  if (request.authorOwnerId === state.profile.playerId) {
    const planet = state.planets[request.planetId];
    if (!planet) return null;
    const coordinate = coordinateOfPlayerPlanet(planet);
    if (!sameCoordinate(coordinate, request.coordinate)) return null;
    return {
      ownerId: state.profile.playerId,
      coordinate,
      name: planet.name,
      buildings: planet.buildings,
      resources: getPlanetResources(state, request.planetId),
      debris: planet.recycling.availableDebris,
    };
  }
  const target = state.espionage?.targets?.[request.planetId];
  if (!target || target.kind !== 'npc' || target.ownerId !== request.authorOwnerId || !sameCoordinate(target.coordinate, request.coordinate)) return null;
  return {
    ownerId: target.ownerId,
    coordinate: target.coordinate,
    name: target.name,
    buildings: target.buildings,
    resources: { metal: target.resources.metal, minerals: target.resources.minerals, gas: target.resources.gas },
    debris: target.resources.debris,
  };
}

function sameCoordinate(left: { galaxy: number; system: number; position: number }, right: { galaxy: number; system: number; position: number }): boolean {
  return left.galaxy === right.galaxy && left.system === right.system && left.position === right.position;
}

function activeNpcShips(state: SaveState, ownerId: string, planetId: string): Partial<Record<ShipId, number>> {
  const reserved: Partial<Record<ShipId, number>> = {};
  for (const flight of (state.flights ?? createFlightState()).records) {
    if (flight.ownerSide !== 'npc' || flight.ownerId !== ownerId || flight.originPlanetId !== planetId
      || (flight.phase !== 'outbound' && flight.phase !== 'returning' && flight.phase !== 'arrived')) continue;
    for (const [id, count] of Object.entries(flight.selectedShips) as [ShipId, number][]) {
      if (Number.isSafeInteger(count) && count > 0) reserved[id] = (reserved[id] ?? 0) + count;
    }
  }
  return reserved;
}

function aidPlan(state: SaveState, ownerId: string, request: ResourceRequest, source: AidSource): NpcAidPayload | null {
  if (!isRequestOpen(request) || request.authorOwnerId === ownerId || !source.fleet?.ships) return null;
  if (!isAidPairValid(state.command, { allianceId: request.allianceId, senderOwnerId: ownerId, recipientOwnerId: request.authorOwnerId })) return null;
  const destination = requestPlanet(state, request);
  if (!destination || destination.ownerId !== request.authorOwnerId || destination.ownerId === ownerId) return null;
  if (!isFlightCoordinate(source.coordinate) || !isFlightCoordinate(destination.coordinate)) return null;

  const records = state.flights?.records ?? [];
  const remainder = requestOpenRemainder(request, aidInFlightUnits(records, request.id));
  const stock = request.resource === 'debris' ? source.resources.debris : source.resources[request.resource];
  let wanted = Math.min(remainder, Math.max(0, Math.floor(stock)));
  if (!Number.isSafeInteger(wanted) || wanted <= 0) return null;

  const reserved = activeNpcShips(state, ownerId, source.id);
  const fleet = source.fleet.ships;
  const ships: Partial<Record<ShipId, number>> = {};
  const catalog = getFactionShipCatalog(source.raceId);
  const shipCatalog = Object.fromEntries(catalog.map((entity) => [entity.id, { cargo: entity.ship?.cargo ?? 0 }]));
  let capacity = 0;
  for (const id of ['mega-transporter', 'transporter'] as const) {
    const free = Math.max(0, (fleet[id] ?? 0) - (reserved[id] ?? 0));
    const cargo = catalog.find((entity) => entity.id === id)?.ship?.cargo ?? 0;
    if (!free || cargo <= 0) continue;
    const count = Math.min(free, Math.ceil(Math.max(0, wanted - capacity) / cargo));
    if (!count) continue;
    ships[id] = count;
    capacity += count * cargo;
  }
  wanted = Math.min(wanted, capacity);
  if (wanted <= 0) return null;

  const distance = calculateRouteDistance(source.coordinate, destination.coordinate);
  const fuel = calculateFlightFuel(source.raceId, ships, distance, source.ownerProfile?.scienceLevels ?? {});
  const gasStock = source.resources.gas;
  if (gasStock < fuel + (request.resource === 'gas' ? wanted : 0)) return null;
  if (getFleetCargoCapacity(ships, shipCatalog) < wanted) return null;
  const selected: Record<string, number> = { transporter: ships.transporter ?? 0, 'mega-transporter': ships['mega-transporter'] ?? 0 };
  return {
    requestId: request.id,
    originPlanetId: source.id,
    resource: request.resource,
    units: wanted,
    transporter: selected.transporter,
    megaTransporter: selected['mega-transporter'],
  };
}

/** Legal aid options for the NPC's current alliance. Player requests remain requests; this only creates outgoing NPC aid. */
export function getNpcAidCandidates(state: SaveState, profile: NpcProfile, at: number): NpcAidCandidate[] {
  const ownerId = profile.ownerId;
  if (!ownerId || ownerId === state.profile.playerId || ownerId === UNIVERSE_NPC_OWNER_ID || !Number.isFinite(at)) return [];
  const membership = selectOwnerMembership(state.command, ownerId);
  if (!membership) return [];
  const sources = npcSources(state, ownerId);
  if (!sources.length) return [];
  const candidates: NpcAidCandidate[] = [];
  for (const request of selectFulfillableRequests(state.command, ownerId)) {
    if (request.allianceId !== membership.alliance.id || !requestPlanet(state, request)) continue;
    for (const source of sources) {
      const payload = aidPlan(state, ownerId, request, source);
      if (!payload) continue;
      candidates.push({
        id: `aid:${ownerId}:${request.id}:${source.id}`,
        kind: 'aid',
        weight: Number.isFinite(profile.traits.cooperation) ? Math.max(0.05, Math.min(1, profile.traits.cooperation)) : 0.05,
        payload,
      });
    }
  }
  return candidates;
}

function currentFlight(state: SaveState, flightId: string): FlightRecord | undefined {
  return (state.flights ?? createFlightState()).records.find((flight) => flight.id === flightId);
}

function updateFlight(state: SaveState, flight: FlightRecord): SaveState {
  const flights = state.flights ?? createFlightState();
  return { ...state, flights: { ...flights, records: flights.records.map((item) => item.id === flight.id ? flight : item) } };
}

function failure(state: SaveState, reason: string): NpcAidResult {
  return { state, ok: false, reason };
}

/** Dispatches one real NPC aid flight, validating the current request and recomputing its cargo/ships before any debit. */
export function dispatchNpcAid(
  state: SaveState,
  ownerId: string,
  candidate: NpcAidCandidate,
  at: number,
  requestId: string,
  timeScale: number,
): NpcAidResult {
  const flights = state.flights ?? createFlightState();
  const duplicate = requestId ? getFlightByRequestId(flights, requestId) : undefined;
  if (duplicate) {
    if (duplicate.ownerSide === 'npc' && duplicate.ownerId === ownerId && duplicate.missionId === 'aid') {
      return { state, ok: true, reason: null, flight: duplicate };
    }
    return failure(state, 'Flight request ID is already in use.');
  }
  if (!requestId.trim() || !Number.isSafeInteger(at) || !Number.isFinite(timeScale) || timeScale <= 0
    || !ownerId || ownerId === state.profile.playerId || ownerId === UNIVERSE_NPC_OWNER_ID) return failure(state, 'Invalid NPC aid dispatch.');
  const profile = state.npc?.profiles[ownerId];
  if (!profile) return failure(state, 'NPC owner is not registered.');
  const legal = getNpcAidCandidates(state, profile, at).find((item) => item.id === candidate?.id);
  if (!legal) return failure(state, 'Aid request or source is no longer available.');
  const payload = legal.payload;
  const request = selectRequestById(state.command, payload.requestId);
  const source = state.espionage?.targets?.[payload.originPlanetId];
  if (!request || !source || source.kind !== 'npc' || source.ownerId !== ownerId) return failure(state, 'Aid request or source is no longer available.');
  const destination = requestPlanet(state, request);
  if (!destination || !isRequestOpen(request) || !isAidPairValid(state.command, {
    allianceId: request.allianceId, senderOwnerId: ownerId, recipientOwnerId: request.authorOwnerId,
  })) return failure(state, 'Aid request or alliance changed.');

  // Recompute the candidate using the explicit campaign scale supplied by the owner-wide runtime.
  const fresh = aidPlan(state, ownerId, request, source);
  if (!fresh || fresh.originPlanetId !== payload.originPlanetId || fresh.units !== payload.units
    || fresh.transporter !== payload.transporter || fresh.megaTransporter !== payload.megaTransporter) return failure(state, 'Aid cargo or transporter capacity changed.');
  const selectedShips: Partial<Record<ShipId, number>> = {
    ...(fresh.transporter ? { transporter: fresh.transporter } : {}),
    ...(fresh.megaTransporter ? { 'mega-transporter': fresh.megaTransporter } : {}),
  };
  const cargo: TransportCargo = { ...emptyTransportCargo(), [fresh.resource]: fresh.units };
  const dispatched = dispatchFlight(flights, {
    requestId,
    missionId: 'aid',
    ownerSide: 'npc',
    ownerId,
    originPlanetId: source.id,
    originCoordinate: source.coordinate,
    destination: { kind: 'planet', planetId: request.planetId, coordinate: { ...request.coordinate } },
    selectedShips,
    departedAt: at,
    factionId: source.raceId,
    science: source.ownerProfile?.scienceLevels ?? {},
    destinationPlanetId: request.planetId,
    targetPlanetName: destination.name,
    destinationOwnerId: request.authorOwnerId,
    targetRelation: 'ally',
    cargo,
    aid: {
      requestId: request.id,
      allianceId: request.allianceId,
      senderOwnerId: ownerId,
      recipientOwnerId: request.authorOwnerId,
      resource: request.resource,
    },
  });
  const duration = Math.max(1, Math.round(dispatched.flight.oneWayDurationMs / timeScale));
  const flight: FlightRecord = { ...dispatched.flight, oneWayDurationMs: duration, arrivalAt: at + duration };
  const fuel = flight.gasCost;
  if (source.resources.gas < fuel + (request.resource === 'gas' ? fresh.units : 0)) return failure(state, 'Source lacks gas for cargo and outbound fuel.');
  const nextShips = { ...source.fleet.ships };
  for (const [shipId, count] of Object.entries(selectedShips) as [ShipId, number][]) nextShips[shipId] = Math.max(0, (nextShips[shipId] ?? 0) - count);
  const fleet = { ...source.fleet, ships: nextShips };
  const fleetPopulation = calculateFleetPopulation(fleet, source.raceId);
  const defensePopulation = calculateDefensePopulation(source.defense, source.raceId);
  const nextSource: AidSource = {
    ...source,
    fleet,
    population: { ...source.population, fleet: fleetPopulation, defense: defensePopulation, total: fleetPopulation + defensePopulation },
    resources: {
      ...source.resources,
      metal: source.resources.metal - cargo.metal,
      minerals: source.resources.minerals - cargo.minerals,
      gas: source.resources.gas - cargo.gas - fuel,
      debris: Math.max(0, source.resources.debris - cargo.debris),
    },
  };
  const next: SaveState = {
    ...state,
    flights: { ...dispatched.state, records: [...dispatched.state.records.slice(0, -1), flight], requestIndex: dispatched.state.requestIndex },
    espionage: { ...state.espionage!, targets: { ...state.espionage!.targets, [source.id]: nextSource } },
    command: markRequestHelpStarted(state.command, request.id, flight.id, ownerId, fresh.units, at),
  };
  return { state: next, ok: true, reason: null, flight };
}

function liveRecipient(state: SaveState, aid: AidFlightSnapshot, flight: FlightRecord) {
  const planetId = flight.destinationPlanetId;
  if (!planetId || flight.destination.kind !== 'planet' || flight.destination.planetId !== planetId
    || flight.destinationOwnerId !== aid.recipientOwnerId) return null;
  if (aid.recipientOwnerId === state.profile.playerId) {
    const planet = state.planets[planetId];
    if (!planet) return null;
    const coordinate = coordinateOfPlayerPlanet(planet);
    return sameCoordinate(coordinate, flight.destinationCoordinate) ? { kind: 'player' as const, planet, coordinate } : null;
  }
  const target = state.espionage?.targets?.[planetId];
  if (!target || target.kind !== 'npc' || target.ownerId !== aid.recipientOwnerId
    || !sameCoordinate(target.coordinate, flight.destinationCoordinate)) return null;
  return { kind: 'npc' as const, planet: target, coordinate: target.coordinate };
}

function returnWithCargo(state: SaveState, flight: FlightRecord, at: number, reason: string, voidCargo = false): NpcAidResult {
  const current = currentFlight(state, flight.id) ?? flight;
  let next = state;
  if (voidCargo) {
    const request = current.aid ? selectRequestById(state.command, current.aid.requestId) : null;
    if (request) next = { ...next, command: closeRequestPlanetLost(next.command, request.id, at) };
  }
  const returned = beginFlightReturn(next.flights ?? createFlightState(), current.id, at, 'target-unavailable');
  let record = returned.records.find((item) => item.id === current.id) ?? current;
  record = {
    ...record,
    ...(voidCargo ? { cargoState: 'voided' as const, cargoResolvedAt: at } : {}),
    arrivedAt: record.arrivedAt ?? at,
    completionReason: reason as FlightRecord['completionReason'],
  };
  next = updateFlight({ ...next, flights: returned }, record);
  return { state: next, ok: false, reason, flight: record };
}

/** Credits a returning NPC aid cargo to its own planet, with the same warehouse caps as other transport returns. */
export function settleNpcAidReturn(state: SaveState, flight: FlightRecord, at: number): NpcAidResult {
  const current = currentFlight(state, flight.id) ?? flight;
  if (current.ownerSide !== 'npc' || current.missionId !== 'aid' || current.cargoState !== 'loaded') return { state, ok: false, reason: 'Flight has no unsettled NPC aid cargo.', flight: current };
  if ((current.phase !== 'returning' && current.phase !== 'completed') || (current.returnAt !== undefined && at < current.returnAt)) {
    return { state, ok: false, reason: 'NPC aid cargo has not reached its origin.', flight: current };
  }
  const source = state.espionage?.targets?.[current.originPlanetId];
  const cargo = normalizeTransportCargo(current.cargo);
  let next = state;
  if (source?.kind === 'npc' && source.ownerId === current.ownerId) {
    const credit = getCappedDelivery(source.resources, getStorageCapacities(source.buildings), cargo);
    next = { ...next, espionage: { ...next.espionage!, targets: { ...next.espionage!.targets,
      [source.id]: { ...source, resources: { ...source.resources, ...credit.resources, debris: addDebris(source.resources.debris, cargo.debris) } },
    } } };
  }
  const returned: FlightRecord = { ...current, cargoState: 'returned', cargoResolvedAt: at };
  next = updateFlight(next, returned);
  if (current.aid) next = { ...next, command: { ...next.command, aidEvents: appendReturnedEvent(next.command, current.aid, current.id, cargo[current.aid.resource], at) } };
  return { state: next, ok: true, reason: null, flight: returned };
}

function appendReturnedEvent(command: SaveState['command'], aid: AidFlightSnapshot, flightId: string, units: number, at: number) {
  // appendAidEvent preserves the canonical per-flight event identity.
  return appendAidEvent(command, 'aid_returned', flightId, {
    at, allianceId: aid.allianceId, requestId: aid.requestId, actorOwnerId: aid.senderOwnerId, flightId, units,
  }).aidEvents;
}

/** Resolves only a due, loaded outbound aid flight and records accepted units once before returning its ships. */
export function resolveNpcAidArrival(state: SaveState, flight: FlightRecord, at: number): NpcAidResult {
  const current = currentFlight(state, flight.id) ?? flight;
  if (current.ownerSide !== 'npc' || current.missionId !== 'aid' || !current.aid) return failure(state, 'Flight is not a bound NPC aid mission.');
  if (current.cargoState === 'delivered' || current.cargoState === 'returned' || current.cargoState === 'voided' || current.aid.creditedUnits !== undefined) {
    return { state, ok: true, reason: null, flight: current };
  }
  if (current.cargoState !== 'loaded' || (current.phase !== 'outbound' && current.phase !== 'arrived') || at < current.arrivalAt) return failure(state, 'NPC aid flight is not due for arrival.');
  const aid = current.aid;
  if (current.ownerId !== aid.senderOwnerId) return returnWithCargo(state, current, at, 'Aid sender identity is invalid.');
  const request = selectRequestById(state.command, aid.requestId);
  const target = liveRecipient(state, aid, current);
  if (!target) return returnWithCargo(state, current, at, 'Aid destination planet is unavailable.', true);
  if (!request || !isRequestOpen(request) || request.allianceId !== aid.allianceId || request.authorOwnerId !== aid.recipientOwnerId
    || request.planetId !== current.destinationPlanetId
    || request.resource !== aid.resource || !sameCoordinate(request.coordinate, current.destinationCoordinate)
    || !isAidPairValid(state.command, { allianceId: aid.allianceId, senderOwnerId: aid.senderOwnerId, recipientOwnerId: aid.recipientOwnerId })) {
    return returnWithCargo(state, current, at, 'Aid request or alliance is no longer valid.');
  }

  const cargo = normalizeTransportCargo(current.cargo);
  const resources = target.kind === 'player'
    ? getPlanetResources(state, current.destinationPlanetId!)
    : { metal: target.planet.resources.metal, minerals: target.planet.resources.minerals, gas: target.planet.resources.gas };
  const delivery = getCappedDelivery(resources, getStorageCapacities(target.planet.buildings), cargo);
  const accepted = aid.resource === 'debris' ? cargo.debris : delivery.accepted[aid.resource];
  let next = state;
  if (target.kind === 'player') {
    const planet = target.planet;
    const stored = { ...planet, resources: delivery.resources,
      recycling: { ...planet.recycling, availableDebris: addDebris(planet.recycling.availableDebris, cargo.debris) },
    };
    const planets = { ...next.planets, [current.destinationPlanetId!]: stored };
    next = { ...next, planets,
      ...(next.currentPlanetId === current.destinationPlanetId ? { metal: delivery.resources.metal, minerals: delivery.resources.minerals, gas: delivery.resources.gas } : {}),
    };
  } else {
    const planet = target.planet;
    next = { ...next, espionage: { ...next.espionage!, targets: { ...next.espionage!.targets,
      [planet.id]: { ...planet, resources: { ...planet.resources, ...delivery.resources, debris: addDebris(planet.resources.debris, cargo.debris) } },
    } } };
  }
  next = { ...next, command: creditAidDelivery(next.command, {
    requestId: aid.requestId, flightId: current.id, senderOwnerId: aid.senderOwnerId, units: accepted,
  }, at) };
  const delivered: FlightRecord = { ...current, aid: { ...aid, creditedUnits: accepted }, arrivedAt: current.arrivedAt ?? current.arrivalAt,
    cargoState: 'delivered', deliveredAt: current.arrivedAt ?? current.arrivalAt, cargoResolvedAt: at };
  const deliveredState = updateFlight(next, delivered);
  const flights = beginFlightReturn(deliveredState.flights ?? createFlightState(), delivered.id, at, 'normal-return');
  const returning = flights.records.find((item) => item.id === delivered.id) ?? delivered;
  next = updateFlight({ ...deliveredState, flights }, returning);
  return { state: next, ok: true, reason: null, flight: returning };
}
