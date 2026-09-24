import type { ShipId } from '../combat/ids.ts';
import type { CommanderId } from '../combat/commanders.ts';
import type { UniverseCoordinate, UniverseObjectKind } from '../universe/types.ts';
import type { TransportCargo } from './cargo.ts';
import type { AttackLaunchSnapshot, AttackResolution } from '../attack/types.ts';

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
  | 'target-unavailable'
  | 'arrived'
  | 'deployed'
  | 'spy-destroyed'
  | 'origin-destroyed'
  | 'mission-failed';

export type TargetRelation = 'self' | 'ally' | 'enemy' | 'neutral';
export type TransportCargoState = 'loaded' | 'delivered' | 'voided' | 'returned';

export type FlightDestination =
  | { kind: 'coordinate'; coordinate: UniverseCoordinate }
  | { kind: 'planet'; planetId: string; coordinate: UniverseCoordinate }
  | { kind: 'operation'; operationId: string; coordinate: UniverseCoordinate }
  /** No destination coordinate; coordinate is only retained internally as an origin anchor. */
  | { kind: 'space'; coordinate: UniverseCoordinate };

/** Serializable snapshot of one dispatched fleet, independent of live science/catalog state. */
export type FlightRecord = {
  id: string;
  requestId: string;
  /** Older records omit this and are treated as player-owned. */
  ownerSide?: 'player' | 'bot01';
  missionId: MissionId;
  operationId?: string;
  /** Links a persisted espionage flight to its higher-level spy mission. */
  spyMissionId?: string;
  originPlanetId: string;
  originCoordinate: UniverseCoordinate;
  destination: FlightDestination;
  /** Target snapshot retained so arrival validation is not based on UI state. */
  targetKind?: UniverseObjectKind;
  destinationPlanetId?: string;
  /** Human-readable target identity for the active-flight table. */
  targetPlanetName?: string;
  targetOwnerName?: string;
  /** Destination identity/relation are dispatch-time snapshots, not live authorization. */
  destinationOwnerId?: string;
  targetRelation?: TargetRelation;
  destinationCoordinate: UniverseCoordinate;
  selectedShips: Partial<Record<ShipId, number>>;
  /** Attack-only commander selection, persisted with the flight reservation. */
  selectedCommanders?: Partial<Record<CommanderId, number>>;
  /** Deployment snapshot keeps commander identity/ability levels stable in flight. */
  selectedCommanderLevels?: Partial<Record<CommanderId, number>>;
  /** Recycle mission capacity is fixed at dispatch and survives catalog changes. */
  recycleCapacity?: number;
  /** Attack-only dispatch snapshot used by the live arrival resolver. */
  attackSnapshot?: AttackLaunchSnapshot;
  /** Attack-only materialized result used to make reconcile replay-safe. */
  attackResolution?: AttackResolution;
  populationReserved: number;
  routeDistance: number;
  effectiveSpeed: number;
  oneWayDurationMs: number;
  departedAt: number;
  arrivalAt: number;
  returnAt?: number;
  gasCost: number;
  /** Cargo snapshot for transport, recycle, and gas extraction flights. */
  cargo?: TransportCargo;
  cargoState?: TransportCargoState;
  /** Gas extraction capacity is fixed at dispatch and survives catalog changes. */
  gasCapacity?: number;
  overflowWarning?: boolean;
  deliveredAt?: number;
  cargoResolvedAt?: number;
  /** Test Mode Bot 01 survivors/loot were restored exactly once. */
  bot01ReturnCreditedAt?: number;
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
