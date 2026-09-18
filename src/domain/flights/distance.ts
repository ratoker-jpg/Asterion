import type { UniverseCoordinate } from '../universe/types.ts';

export const FLIGHT_SYSTEM_COUNT = 40;
export const FLIGHT_POSITION_COUNT = 24;

export function isFlightCoordinate(value: unknown): value is UniverseCoordinate {
  if (!value || typeof value !== 'object') return false;
  const coordinate = value as UniverseCoordinate;
  return Number.isInteger(coordinate.galaxy) && coordinate.galaxy >= 1
    && Number.isInteger(coordinate.system) && coordinate.system >= 1 && coordinate.system <= FLIGHT_SYSTEM_COUNT
    && Number.isInteger(coordinate.position) && coordinate.position >= 1 && coordinate.position <= FLIGHT_POSITION_COUNT;
}

export function assertFlightCoordinate(coordinate: UniverseCoordinate): UniverseCoordinate {
  if (!isFlightCoordinate(coordinate)) throw new Error('Invalid flight coordinate.');
  return coordinate;
}

export function positionRing(position: number): number {
  if (!Number.isInteger(position) || position < 1 || position > FLIGHT_POSITION_COUNT) throw new Error('Invalid flight position.');
  return Math.floor((position - 1) / 6);
}

export function positionSector(position: number): number {
  if (!Number.isInteger(position) || position < 1 || position > FLIGHT_POSITION_COUNT) throw new Error('Invalid flight position.');
  return (position - 1) % 6;
}

export function positionDistance(originPosition: number, destinationPosition: number): number {
  const ringDelta = Math.abs(positionRing(originPosition) - positionRing(destinationPosition));
  const sectorDelta = Math.abs(positionSector(originPosition) - positionSector(destinationPosition));
  return 6 * ringDelta + Math.min(sectorDelta, 6 - sectorDelta);
}

export function getFlightRouteDeltas(origin: UniverseCoordinate, destination: UniverseCoordinate): { galaxy: number; system: number; position: number } {
  assertFlightCoordinate(origin);
  assertFlightCoordinate(destination);
  return {
    galaxy: Math.abs(origin.galaxy - destination.galaxy),
    system: Math.abs(origin.system - destination.system),
    position: positionDistance(origin.position, destination.position),
  };
}

export function calculateRouteDistance(origin: UniverseCoordinate, destination: UniverseCoordinate): number {
  const delta = getFlightRouteDeltas(origin, destination);
  return 1_000 + 16_505 * delta.galaxy + 385 * delta.system + 5 * delta.position;
}
