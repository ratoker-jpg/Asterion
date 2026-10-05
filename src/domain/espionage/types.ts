import type { CommanderId } from '../combat/commanders.ts';
import type { DefenseId, ShipId } from '../combat/ids.ts';
import type { CombatFactionId } from '../combat/factions.ts';
import type { OwnedDefenseState } from '../fleet/production.ts';
import type { OwnedFleetState } from '../fleet/runtime.ts';
import type { TargetRelation } from '../flights/types.ts';
import type { BuildingQueueItem, ScienceLevels } from '../buildings/resource-zone.ts';
import type { UniverseCoordinate, UniverseOwnerAlliance } from '../universe/types.ts';
import type { RepairWorkshopState } from '../repair/workshop.ts';

export type SpyMissionStatus = 'transit' | 'orbiting' | 'returning' | 'returned' | 'destroyed' | 'target-destroyed';
export type SpyReportQuality = 'basic' | 'detailed' | 'full';
export type SpyTargetRelation = Extract<TargetRelation, 'enemy' | 'neutral'>;

export type SpyPlanetPopulation = {
  /** Total population represented by all orbital ships and defense structures. */
  total: number;
  fleet: number;
  defense: number;
  /** Legacy alias retained only while old test saves are migrated. */
  civilian?: number;
};

export type SpyReportPopulation = {
  /** Total population represented by all orbital ships and defense structures. */
  total: number;
  fleet: number;
  defense: number;
  /** Kept only so reports from the previous snapshot schema remain readable. */
  civilian?: number;
};

export type SpyResourcesSnapshot = {
  metal: number;
  minerals: number;
  gas: number;
  debris: number;
  developmentEnergy: number;
};

export type SpyCommanderSnapshot = {
  level: number;
  count: number;
};

/** Owner-wide spy profile. Ship upgrades and science belong to the owner, not a planet. */
export type SpyOwnerProfile = {
  scienceLevels: ScienceLevels;
  shipLevels: Partial<Record<ShipId, number>>;
  commanderLevels: Partial<Record<CommanderId, number>>;
};

/** Backward-compatible name for the Test Mode Bot 01 profile. */
export type Bot01Profile = SpyOwnerProfile;

/** One explicit, persisted Test Mode demonstration; absence means not started. */
export type Bot01IncomingScenario = {
  version: 1;
  status: 'in-flight' | 'resolved' | 'failed';
  flightId: string;
  targetPlanetId: string;
  startedAt: number;
};

export type SpyTargetState = {
  id: string;
  name: string;
  coordinate: UniverseCoordinate;
  ownerId: string;
  ownerName: string;
  raceId: CombatFactionId;
  alliance: UniverseOwnerAlliance | null;
  /** Only player and NPC planets can be espionage targets. */
  kind?: 'player' | 'npc';
  espionageLevel: number;
  resources: SpyResourcesSnapshot;
  buildings: Record<string, number>;
  fleet: OwnedFleetState;
  defense: OwnedDefenseState;
  commanders: Partial<Record<CommanderId, SpyCommanderSnapshot>>;
  population: SpyPlanetPopulation;
  hunterLevel: number;
  /**
   * Legacy mirror accepted only while migrating old saves. The canonical
   * target-orbit debris ledger is resources.debris.
   */
  debris?: number;
  /** Optional owner profile for injected non-Bot targets. */
  ownerProfile?: SpyOwnerProfile;
  /** Legacy per-planet experiment; migrated away in favor of ownerProfile. */
  shipLevels?: Partial<Record<ShipId, number>>;
  /** Test-mode target repair pool; production saves never materialize Bot 01. */
  repair?: RepairWorkshopState;
  /** Optional authoritative queue for injected targets; demolition cancels affected entries without refund. */
  buildingQueue?: BuildingQueueItem[];
  /** Migration-safe escape hatch for future endgame buildings absent from the current catalog. */
  endgameLockedBuildings?: string[];
  /** Independent target economy clock, persisted with the authoritative target. */
  resourceClock?: {
    lastReconciledAt: number;
    remainder: { metal: number; minerals: number; gas: number };
  };
};

/** Backward-compatible name for old Test Mode saves and tests. */
export type Bot01PlanetState = SpyTargetState;

export type SpyMissionRelation = TargetRelation;

export type SpyReportSnapshot = {
  id: string;
  missionId: string;
  createdAt: number;
  sourcePlanetId: string;
  targetPlanetId: string;
  targetPlanetName: string;
  targetOwnerId: string;
  targetOwnerName: string;
  targetRaceId: CombatFactionId;
  targetRelation: SpyTargetRelation;
  targetCoordinate: UniverseCoordinate;
  spyLevel: number;
  targetEspionageLevel: number;
  delta: number;
  roll: number;
  quality: SpyReportQuality;
  resources: SpyResourcesSnapshot;
  defense?: Partial<Record<DefenseId, number>>;
  fleet?: Partial<Record<ShipId, number>>;
  commanders?: Partial<Record<CommanderId, SpyCommanderSnapshot>>;
  population?: SpyReportPopulation;
  /** Captured upgrade level for each ship shown in a full report. */
  fleetLevels?: Partial<Record<ShipId, number>>;
  firstReport: boolean;
};

export type SpyHunterNotice = {
  id: string;
  missionId: string;
  createdAt: number;
  targetPlanetId: string;
  targetPlanetName: string;
  targetOwnerName: string;
  targetCoordinate: UniverseCoordinate;
  hunterLevel: number;
};

/** Debris survives target runtime deletion and remains addressable by orbit. */
export type OrbitalDebrisRecord = {
  id: string;
  targetPlanetId: string;
  targetPlanetName: string;
  targetOwnerId: string;
  targetCoordinate: UniverseCoordinate;
  debris: number;
  createdAt: number;
  reportId?: string;
};

export type SpyMission = {
  id: string;
  flightId: string;
  ownerId: string;
  originPlanetId: string;
  targetPlanetId: string;
  targetPlanetName: string;
  targetOwnerId: string;
  targetOwnerName: string;
  targetRaceId: CombatFactionId;
  targetAlliance: UniverseOwnerAlliance | null;
  targetRelation: SpyMissionRelation;
  targetCoordinate: UniverseCoordinate;
  spyLevel: number;
  targetEspionageLevel: number;
  status: SpyMissionStatus;
  sentAt: number;
  arrivalAt: number;
  arrivedAt?: number;
  lastReportAt?: number;
  nextReportAt?: number;
  returnedAt?: number;
  destroyedAt?: number;
  /** Retained after the physical probe returns so the terminal cause is auditable. */
  targetDestroyedAt?: number;
  reportIds: string[];
};

export type EspionageState = {
  missions: SpyMission[];
  reports: SpyReportSnapshot[];
  hunterNotices: SpyHunterNotice[];
  /** Separate orbital ledger; it is not deleted with a destroyed target runtime. */
  orbitalDebris?: Record<string, OrbitalDebrisRecord>;
  /** Authoritative registry of resolvable planet owners. Test Mode injects Bot 01 here. */
  targets?: Record<string, SpyTargetState>;
  /** Legacy Test Mode alias. New runtime code must resolve through `targets`. */
  bot01Planets?: Record<string, Bot01PlanetState>;
  /** Test-only owner-wide Bot 01 upgrades and technologies. */
  bot01Profile?: Bot01Profile;
  /** The demonstration is only launched by an explicit Test Mode action. */
  bot01IncomingScenario?: Bot01IncomingScenario;
};
