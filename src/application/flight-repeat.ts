import type { CommanderId } from '../domain/combat/commanders.ts';
import type { ShipId } from '../domain/combat/ids.ts';
import type { TransportCargo } from '../domain/flights/cargo.ts';
import type { FlightRecord, MissionId } from '../domain/flights/types.ts';
import type { UniverseCoordinate } from '../domain/universe/types.ts';
import type { SaveState } from './contracts.ts';
import { getAvailableFleetForPlanet, type FlightLaunchContext } from './flights.ts';

/**
 * Fleet-screen shortcuts built only from existing commands: «Повторить» turns a
 * flight record back into the same launch, «Ещё с другой планеты» picks the
 * next own planet. Every launch still goes through previewFlight/dispatchFlight.
 */
export const REPEATABLE_MISSIONS: ReadonlySet<MissionId> = new Set<MissionId>([
  'attack', 'transport', 'deployment', 'recycle', 'gas', 'space-flight',
]);

/** Missions whose target survives a send, so a second wave from another planet makes sense. */
export const FOLLOW_UP_MISSIONS: ReadonlySet<MissionId> = new Set<MissionId>([
  ...REPEATABLE_MISSIONS, 'espionage', 'sun-support',
]);

type Quantities<T extends string> = Partial<Record<T, number>>;

export type FlightRepeatPlan = {
  context: FlightLaunchContext;
  originPlanetId: string;
  ships: Quantities<ShipId>;
  commanders: Quantities<CommanderId>;
  cargo?: TransportCargo;
};

/** «Повторить полёт» from a report: App sends the plan, the Fleets screen opens it like its own «Повторить». */
export const FLIGHT_REPEAT_PLAN_EVENT = 'asterion:flight-repeat-plan';

export function canRepeatFlight(state: SaveState, flight: FlightRecord): boolean {
  if (flight.ownerSide && flight.ownerSide !== 'player') return false;
  if (!REPEATABLE_MISSIONS.has(flight.missionId)) return false;
  // Exploration fights, Sun raids and Sun debris are one-off operations, not routes.
  if (flight.explorationAttack || flight.sunRaid || flight.destination.kind === 'operation') return false;
  return Boolean(state.planets[flight.originPlanetId]);
}

export function buildFlightRepeatPlan(state: SaveState, flight: FlightRecord): FlightRepeatPlan | null {
  if (!canRepeatFlight(state, flight)) return null;
  const destination = flight.destination.kind === 'planet'
    ? { kind: 'planet' as const, planetId: flight.destination.planetId, coordinate: { ...flight.destination.coordinate } }
    : flight.destination.kind === 'space'
      ? { kind: 'space' as const, coordinate: { ...flight.destination.coordinate } }
      : { kind: 'coordinate' as const, coordinate: { ...flight.destination.coordinate } };
  return {
    context: {
      missionId: flight.missionId,
      ...(flight.missionId === 'space-flight' ? {} : { destination }),
      ...(flight.targetKind ? { targetKind: flight.targetKind } : {}),
      ...(flight.targetRelation ? { targetRelation: flight.targetRelation } : {}),
      ...(flight.targetPlanetName ? { targetPlanetName: flight.targetPlanetName } : {}),
      ...(flight.destinationOwnerId ? { targetOwnerId: flight.destinationOwnerId } : {}),
      ...(flight.targetOwnerName ? { targetOwnerName: flight.targetOwnerName } : {}),
    },
    originPlanetId: flight.originPlanetId,
    ships: positiveOnly(flight.selectedShips),
    commanders: positiveOnly(flight.selectedCommanders ?? {}),
    ...(flight.cargo && (flight.missionId === 'transport' || flight.missionId === 'space-flight') ? { cargo: { ...flight.cargo } } : {}),
  };
}

/** The same composition, never more than the planet has now. */
export function clampComposition<T extends string>(wanted: Quantities<T>, available: Quantities<T>): Quantities<T> {
  const result: Quantities<T> = {};
  for (const [id, quantity] of Object.entries(wanted) as [T, number | undefined][]) {
    const next = Math.min(Math.max(0, Math.floor(quantity ?? 0)), Math.max(0, available[id] ?? 0));
    if (next > 0) result[id] = next;
  }
  return result;
}

/**
 * Moves a composition to another source planet. A type taken in full («МАКС.»)
 * stays «all of it» on the new planet; a typed amount is kept up to what is there.
 * When every type was taken in full, types only the new planet has come in full too.
 */
export function carryComposition<T extends string>(
  selected: Quantities<T>,
  previousAvailable: Quantities<T>,
  nextAvailable: Quantities<T>,
  allowedIds: readonly T[],
): Quantities<T> {
  const picked = allowedIds.filter((id) => (selected[id] ?? 0) > 0);
  const tookEverything = picked.length > 0
    && allowedIds.every((id) => (previousAvailable[id] ?? 0) <= 0 || (selected[id] ?? 0) >= (previousAvailable[id] ?? 0));
  const result: Quantities<T> = {};
  for (const id of allowedIds) {
    const amount = selected[id] ?? 0;
    const before = previousAvailable[id] ?? 0;
    const after = Math.max(0, nextAvailable[id] ?? 0);
    const full = (amount > 0 && amount >= before) || (tookEverything && before <= 0);
    const next = full ? after : Math.min(amount, after);
    if (next > 0) result[id] = next;
  }
  return result;
}

function routeOrder(from: UniverseCoordinate, to: UniverseCoordinate) {
  return Math.abs(from.galaxy - to.galaxy) * 10_000 + Math.abs(from.system - to.system) * 100 + Math.abs(from.position - to.position);
}

export type SourcePlanetOption = {
  id: string;
  name: string;
  coordinate: UniverseCoordinate;
  /** Ships of the mission's types that are on the planet now (not in flight). */
  eligibleShips: number;
};

/** Own planets with the mission's ship count, nearest to the target first. */
export function listSourcePlanets(
  state: SaveState,
  isMissionShip: (shipId: ShipId) => boolean,
  target?: UniverseCoordinate | null,
): SourcePlanetOption[] {
  const options = Object.entries(state.planets).map(([id, planet]) => {
    const ships = getAvailableFleetForPlanet(state, id).ships;
    const eligibleShips = (Object.entries(ships) as [ShipId, number][])
      .reduce((total, [shipId, quantity]) => total + (isMissionShip(shipId) ? Math.max(0, quantity) : 0), 0);
    return {
      id,
      name: planet.name,
      coordinate: { galaxy: planet.universeGalaxy ?? 1, system: planet.universeSystem ?? 1, position: planet.universePosition ?? 1 },
      eligibleShips,
    };
  });
  if (!target) return options;
  return options
    .map((option, index) => ({ option, index }))
    .sort((left, right) => routeOrder(left.option.coordinate, target) - routeOrder(right.option.coordinate, target) || left.index - right.index)
    .map(({ option }) => option);
}

/** «Ещё с другой планеты»: the nearest other planet that has ships for the mission. */
export function pickNextSourcePlanet(options: readonly SourcePlanetOption[], excludeIds: readonly string[]): string | null {
  return options.find((option) => option.eligibleShips > 0 && !excludeIds.includes(option.id))?.id ?? null;
}

function positiveOnly<T extends string>(value: Quantities<T>): Quantities<T> {
  return Object.fromEntries(Object.entries(value).filter(([, quantity]) => typeof quantity === 'number' && quantity > 0)) as Quantities<T>;
}
