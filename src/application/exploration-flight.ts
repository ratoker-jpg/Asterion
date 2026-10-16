import { getFactionShipCatalog } from '../domain/combat/faction-catalog.ts';
import { getCappedDelivery, getFleetCargoCapacity, addDebris } from '../domain/flights/cargo.ts';
import type { FlightRecord } from '../domain/flights/types.ts';
import { getStorageCapacities } from '../domain/buildings/resource-zone.ts';
import type { RuntimeMode } from '../domain/runtime/mode.ts';
import {
  completeExplorationReturn, getOrMaterializeExplorationContact,
  occupyExplorationContact, createExplorationState, launchExplorationScore,
  reconcileExplorationContact, type ExplorationContact,
} from '../domain/exploration/ledger.ts';
import { getExplorationTarget } from './exploration.ts';
import { getPlanetResources, replacePlanetResources, replacePlanetState, type SaveState } from './contracts.ts';
import { selectOwnerScores } from '../domain/rating/scoring.ts';

/** Shared launch snapshot; no synthetic players added to the median. */
export function explorationResourceScore(state: SaveState): number {
  const ownerId = state.profile.playerId;
  const current = selectOwnerScores(state)[ownerId]?.resourcePoints ?? 0;
  return launchExplorationScore(state.exploration ?? createExplorationState(), ownerId, current);
}

export function explorationContactForFlight(state: SaveState, flight: FlightRecord): ExplorationContact | undefined {
  return flight.operationId ? state.exploration?.contacts[flight.operationId] : undefined;
}

export function materializeExplorationAtDispatch(
  state: SaveState, contactId: string, nowMs: number, mode: RuntimeMode,
): SaveState {
  const node = getExplorationTarget(state, contactId, nowMs, mode);
  if (!node) return state;
  const existing = state.exploration ?? createExplorationState();
  const { state: updated } = getOrMaterializeExplorationContact(existing, node, explorationResourceScore(state));
  return { ...state, exploration: updated };
}

/** Exact snapshot, no live hangar inventory when the fleet actually arrives. */
function expeditionMiningCapacity(state: SaveState, flight: FlightRecord) {
  const fleet = getFactionShipCatalog(state.profile.factionId);
  const catalog = Object.fromEntries(fleet.map(ship => [ship.id, ship]));
  let all = 0, transporters = 0, recyclers = 0;
  for (const [id, count] of Object.entries(flight.selectedShips)) {
    const cargo = (catalog[id]?.ship?.cargo ?? 0) * (count ?? 0);
    all += cargo;
    if (id === 'transporter' || id === 'mega-transporter') transporters += cargo;
    if (id === 'recycler') recyclers += cargo;
  }
  return { all: Math.floor(all), transporters: Math.floor(transporters), recyclers: Math.floor(recyclers) };
}

export type ExpeditionArrivalResult = {
  state: SaveState;
  status: 'occupied' | 'unavailable' | 'arrived';
  notice: string;
};

/** Must run at the canonical flight arrival timestamp, after overdue arrivals in stable order. */
export function resolveExpeditionArrival(
  state: SaveState, flight: FlightRecord, nowMs: number, mode: RuntimeMode,
): ExpeditionArrivalResult {
  const contactId = flight.operationId;
  const node = contactId ? getExplorationTarget(state, contactId, nowMs, mode) : undefined;
  const contact = contactId ? state.exploration?.contacts[contactId] : undefined;
  if (!node || !contact || node.coordinate.galaxy !== flight.destinationCoordinate.galaxy
    || node.coordinate.system !== flight.destinationCoordinate.system
    || node.coordinate.position !== flight.destinationCoordinate.position) {
    return { state, status: 'unavailable', notice: 'Экспедиция прибыла после исчезновения объекта и возвращается без добычи.' };
  }
  if (contact.claim) {
    return { state, status: 'occupied', notice: 'Объект занят другим флотом. Экспедиция возвращается без захвата; используйте «Атака».' };
  }
  const capacity = expeditionMiningCapacity(state, flight);
  const entered = occupyExplorationContact(contact, {
    claimId: flight.id + ':claim',
    flightId: flight.id, ownerId: state.profile.playerId,
    originPlanetId: flight.originPlanetId, arrivedAt: nowMs,
    capacity, resourcePointsLaunch: flight.explorationLaunchResourcePoints ?? 1000,
    catchupMultiplier: 1,
  });
  return {
    state: { ...state, exploration: {
      ...state.exploration!, contacts: { ...state.exploration!.contacts, [contact.id]: entered },
    } },
    status: 'arrived',
    notice: 'Экспедиция заняла объект. Добыча началась; отзовите флот для возврата с ресурсами.',
  };
}

export function updateExpeditionContact(state: SaveState, contact: ExplorationContact): SaveState {
  return { ...state, exploration: {
    ...(state.exploration ?? createExplorationState()),
    contacts: { ...(state.exploration?.contacts ?? {}), [contact.id]: contact },
  } };
}

export function accrueExpedition(state: SaveState, flight: FlightRecord, at: number): SaveState {
  const contact = explorationContactForFlight(state, flight);
  if (!contact?.claim || contact.claim.flightId !== flight.id) return state;
  return updateExpeditionContact(state, reconcileExplorationContact(contact, at));
}

/** Return receipt and wallet transfer are committed in one SaveState transition. */
export function creditExpeditionReturn(state: SaveState, flight: FlightRecord, nowMs: number): SaveState {
  const contact = explorationContactForFlight(state, flight);
  if (!contact) return state;
  const origin = state.planets[flight.originPlanetId];
  const receipt = completeExplorationReturn(contact, flight.id, nowMs, Boolean(origin));
  let next = updateExpeditionContact(state, receipt.contact);
  if (!receipt.payout || !origin) return next;
  const before = getPlanetResources(next, flight.originPlanetId);
  const credited = getCappedDelivery(before, getStorageCapacities(origin.buildings), receipt.payout.cargo);
  next = replacePlanetResources(next, flight.originPlanetId, credited.resources);
  const updatedPlanet = next.planets[flight.originPlanetId];
  if (!updatedPlanet) return next;
  next = replacePlanetState(next, flight.originPlanetId, {
    ...updatedPlanet,
    recycling: {
      ...updatedPlanet.recycling,
      availableDebris: addDebris(updatedPlanet.recycling.availableDebris, receipt.payout.cargo.debris),
    },
    repair: {
      ...updatedPlanet.repair,
      tokens: Math.min(Number.MAX_SAFE_INTEGER, updatedPlanet.repair.tokens + receipt.payout.repairTokens),
    },
  });
  return next;
}
