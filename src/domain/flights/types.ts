import type { ShipId } from '../combat/ids.ts';
import type { UniverseCoordinate, UniverseObjectKind } from '../universe/types.ts';

export type MissionId =
  | 'transport'
  | 'espionage'
  | 'attack'
  | 'deployment'
  | 'colonize'
  | 'recycle'
  | 'gas'
  | 'sun-support'
  | 'space-flight';

export type FlightPhase = 'outbound' | 'returning' | 'arrived' | 'completed' | 'failed';

export type FlightCompletionReason =
  | 'normal'
  | 'normal-return'
  | 'recalled'
  | 'colonized'
  | 'target-occupied'
  | 'arrived'
  | 'mission-failed';

export type FlightDestination =
  | { kind: 'coordinate'; coordinate: UniverseCoordinate }
  | { kind: 'planet'; planetId: string; coordinate: UniverseCoordinate }
  | { kind: 'operation'; operationId: string; coordinate: UniverseCoordinate };

/** Serializable snapshot of one dispatched fleet, independent of live science/catalog state. */
export type FlightRecord = {
  id: string;
  requestId: string;
  missionId: MissionId;
  operationId?: string;
  originPlanetId: string;
  originCoordinate: UniverseCoordinate;
  destination: FlightDestination;
  /** Target snapshot retained so arrival validation is not based on UI state. */
  targetKind?: UniverseObjectKind;
  destinationPlanetId?: string;
  destinationCoordinate: UniverseCoordinate;
  selectedShips: Partial<Record<ShipId, number>>;
  populationReserved: number;
  routeDistance: number;
  effectiveSpeed: number;
  oneWayDurationMs: number;
  departedAt: number;
  arrivalAt: number;
  returnAt?: number;
  gasCost: number;
  phase: FlightPhase;
  completionReason?: FlightCompletionReason;
  recalledAt?: number;
  arrivedAt?: number;
  completedAt?: number;
};

export type FlightState = {
  records: FlightRecord[];
  requestIndex: Record<string, string>;
};

export type FlightScienceLevels = Partial<Record<2 | 4 | 8 | 9 | 14, number>>;
