/**
 * Quick «Помочь» on an ally's resource request («Командование → Помощь»).
 *
 * The same idea as the map quick-send panel: pick a source planet, the cargo
 * hulls and the amount, then send at once. Nothing here is a new rule: every
 * launch is an ordinary `aid` command that `previewFlight`/`dispatchFlight`
 * check exactly as the fleet screen does (ships, cargo, request remainder,
 * fuel). This module only chooses the UI defaults (nearest planet, enough
 * hulls for the amount).
 */
import { getFactionShipCatalog } from '../domain/combat/faction-catalog.ts';
import type { CombatFactionId } from '../domain/combat/factions.ts';
import type { ShipId } from '../domain/combat/ids.ts';
import { AID_TRANSPORT_SHIP_IDS } from '../domain/flights/aid-mission.ts';
import { calculateRouteDistance } from '../domain/flights/distance.ts';
import { emptyTransportCargo } from '../domain/flights/cargo.ts';
import type { ResourceRequest } from '../domain/command/types.ts';
import { getPlanetResources, type SaveState } from './contracts.ts';
import { getAvailableFleetForPlanet, previewFlight, type DispatchFlightCommand, type FlightCommandResult } from './flights.ts';
import { planetCoordinate, type QuickRuntime } from './quick-actions.ts';
import { selectRequestProgress } from './alliance-aid.ts';

export type AidShipId = (typeof AID_TRANSPORT_SHIP_IDS)[number];
export type AidShips = Partial<Record<AidShipId, number>>;

/** Cargo hold of one hull of the player's race (0 when the race has no such hull). */
export function aidShipCargo(state: SaveState, shipId: AidShipId): number {
  const factionId = state.profile.factionId as CombatFactionId;
  return getFactionShipCatalog(factionId).find((entity) => entity.id === shipId)?.ship?.cargo ?? 0;
}

/** Hulls this race can use for aid, largest hold first. */
export function aidShipIds(state: SaveState): AidShipId[] {
  return [...AID_TRANSPORT_SHIP_IDS]
    .filter((id) => aidShipCargo(state, id) > 0)
    .sort((left, right) => aidShipCargo(state, right) - aidShipCargo(state, left));
}

export function aidCapacity(state: SaveState, ships: AidShips): number {
  return Object.entries(ships).reduce((total, [id, count]) => total + aidShipCargo(state, id as AidShipId) * Math.max(0, Math.floor(count ?? 0)), 0);
}

/** How much of the requested resource the planet holds right now (debris: the planet's debris store). */
export function aidSourceStock(state: SaveState, planetId: string, resource: ResourceRequest['resource']): number {
  if (resource === 'debris') return Math.max(0, Math.floor(state.planets[planetId]?.recycling.availableDebris ?? 0));
  return Math.max(0, Math.floor(getPlanetResources(state, planetId)[resource] ?? 0));
}

export function freeAidShips(state: SaveState, planetId: string): Record<AidShipId, number> {
  const free = state.planets[planetId] ? getAvailableFleetForPlanet(state, planetId).ships : {} as Partial<Record<ShipId, number>>;
  return Object.fromEntries(AID_TRANSPORT_SHIP_IDS.map((id) => [id, Math.max(0, Math.floor(free[id as ShipId] ?? 0))])) as Record<AidShipId, number>;
}

export type AidQuickSource = {
  planetId: string;
  name: string;
  free: Record<AidShipId, number>;
  /** Hold of every free hull together. */
  capacity: number;
  stock: number;
};

/**
 * The player's planets that could send this request's resource, nearest
 * first (the selected planet wins a tie). The request's own planet is never a
 * source; planets without free hulls stay listed so the panel can say why.
 */
export function aidQuickSources(state: SaveState, request: ResourceRequest): AidQuickSource[] {
  return Object.keys(state.planets)
    .filter((planetId) => planetId !== request.planetId)
    .map((planetId) => ({ planetId, distance: calculateRouteDistance(planetCoordinate(state, planetId), request.coordinate) }))
    .sort((a, b) => a.distance - b.distance || Number(b.planetId === state.currentPlanetId) - Number(a.planetId === state.currentPlanetId))
    .map(({ planetId }) => {
      const free = freeAidShips(state, planetId);
      return {
        planetId,
        name: state.planets[planetId]?.name ?? planetId,
        free,
        capacity: aidCapacity(state, free),
        stock: aidSourceStock(state, planetId, request.resource),
      };
    });
}

/**
 * The fewest hulls whose hold fits `units`: large hulls first, small ones for
 * the rest; one more large hull when the small ones run out. When even every
 * free hull is not enough, all of them.
 */
export function aidShipsFor(state: SaveState, free: Readonly<Record<AidShipId, number>>, units: number): AidShips {
  const ids = aidShipIds(state);
  const ships: AidShips = {};
  let left = Math.max(0, Math.floor(units));
  if (left <= 0) return ships;
  for (const [index, id] of ids.entries()) {
    const cargo = aidShipCargo(state, id);
    const have = free[id] ?? 0;
    if (have <= 0 || left <= 0) continue;
    const smaller = ids.slice(index + 1).reduce((total, other) => total + aidShipCargo(state, other) * (free[other] ?? 0), 0);
    // Whole hulls first; the remainder goes to smaller hulls if they can carry it, otherwise one more of this one.
    let count = Math.min(have, Math.floor(left / cargo));
    const rest = left - count * cargo;
    if (rest > 0 && rest > smaller && count < have) count += 1;
    if (count > 0) {
      ships[id] = count;
      left -= count * cargo;
    }
  }
  return ships;
}

export type AidQuickLoad = { ships: AidShips; amount: number };

/** Still open on the request: neither delivered nor already in the air. */
export function aidRemainder(state: SaveState, request: ResourceRequest): number {
  return selectRequestProgress(state, request).remainder;
}

/**
 * «Под запрос»: as much of the remainder as the planet holds and its hulls
 * carry, with just enough hulls for it.
 */
export function suggestAidLoad(state: SaveState, request: ResourceRequest, source: AidQuickSource, runtime?: QuickRuntime): AidQuickLoad {
  const amount = Math.max(0, Math.min(aidRemainder(state, request), source.stock, source.capacity));
  const ships = aidShipsFor(state, source.free, amount);
  if (request.resource !== 'gas' || !runtime || amount <= 0) return { ships, amount };
  // Gas aid pays its own fuel from the same stock: leave the fuel of this fleet on the planet.
  const probe = previewAidQuick(state, buildAidQuickCommand(request, source.planetId, ships, 1, runtime), runtime);
  const fuel = probe.ok ? probe.flight.gasCost : 0;
  const fitted = Math.max(0, Math.min(amount, source.stock - fuel));
  return fitted === amount ? { ships, amount } : { ships: aidShipsFor(state, source.free, fitted), amount: fitted };
}

/** The exact dispatch command the fleet screen would build for this aid launch. */
export function buildAidQuickCommand(
  request: ResourceRequest,
  originPlanetId: string,
  ships: AidShips,
  amount: number,
  runtime: QuickRuntime,
): DispatchFlightCommand {
  const cargo = emptyTransportCargo();
  cargo[request.resource] = Math.max(0, Math.floor(amount));
  return {
    requestId: `quick-aid-${request.id}-${originPlanetId}-${runtime.now}`,
    missionId: 'aid',
    aidRequestId: request.id,
    originPlanetId,
    selectedShips: Object.fromEntries(Object.entries(ships).filter(([, count]) => (count ?? 0) > 0)) as Partial<Record<ShipId, number>>,
    selectedCommanders: {},
    cargo,
    targetRelation: 'ally',
    targetPlanetName: request.planetName,
    targetOwnerName: request.authorName,
    destination: { kind: 'planet', planetId: request.planetId, coordinate: { ...request.coordinate } },
    departedAt: runtime.now,
  };
}

export function previewAidQuick(state: SaveState, command: DispatchFlightCommand, runtime: QuickRuntime): FlightCommandResult {
  return previewFlight(state, command, { now: runtime.now, mode: runtime.mode, testTimeScale: runtime.testTimeScale });
}
