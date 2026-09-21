import type { CommanderId } from '../combat/commanders.ts';
import type { DefenseId, ShipId } from '../combat/ids.ts';
import type { CombatFactionId } from '../combat/factions.ts';
import type { OwnedDefenseState } from '../fleet/production.ts';
import type { OwnedFleetState } from '../fleet/runtime.ts';
import type { TargetRelation } from '../flights/types.ts';
import type { ScienceLevels } from '../buildings/resource-zone.ts';
import type { UniverseCoordinate, UniverseOwnerAlliance } from '../universe/types.ts';

export type SpyMissionStatus = 'transit' | 'orbiting' | 'returning' | 'returned' | 'destroyed';
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

/** Bot 01's shared profile. Ship upgrades and science belong to the owner, not a planet. */
export type Bot01Profile = {
  scienceLevels: ScienceLevels;
  shipLevels: Partial<Record<ShipId, number>>;
  commanderLevels: Partial<Record<CommanderId, number>>;
};

export type Bot01PlanetState = {
  id: string;
  name: string;
  coordinate: UniverseCoordinate;
  ownerId: string;
  ownerName: string;
  raceId: CombatFactionId;
  alliance: UniverseOwnerAlliance | null;
  espionageLevel: 10;
  resources: SpyResourcesSnapshot;
  buildings: Record<string, number>;
  fleet: OwnedFleetState;
  defense: OwnedDefenseState;
  commanders: Partial<Record<CommanderId, SpyCommanderSnapshot>>;
  population: SpyPlanetPopulation;
  hunterLevel: number;
  debris: number;
  /** Seeded spaceport-style hull levels (upgradable ships only, 0..10). */
  shipLevels?: Partial<Record<ShipId, number>>;
};

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
  targetRelation: SpyTargetRelation;
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
  reportIds: string[];
};

export type EspionageState = {
  missions: SpyMission[];
  reports: SpyReportSnapshot[];
  hunterNotices: SpyHunterNotice[];
  /** Test-only Bot 01 state. Production saves intentionally keep this empty. */
  bot01Planets?: Record<string, Bot01PlanetState>;
  /** Test-only owner-wide Bot 01 upgrades and technologies. */
  bot01Profile?: Bot01Profile;
};
