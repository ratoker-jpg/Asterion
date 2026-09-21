import type { AllianceEmblem } from '../command/types.ts';

export type UniverseObjectKind =
  | 'empty'
  | 'player'
  | 'npc'
  | 'uninhabited'
  | 'unique'
  | 'pirate'
  | 'anomaly'
  | 'asteroid';

export type UniverseCoordinate = {
  galaxy: number;
  system: number;
  position: number;
};

export type UniverseFixtureId = 'test-mode-ally-ira-vel-v1';

export type UniverseFixtureMarker = {
  id: UniverseFixtureId;
  version: 1;
};

export type UniversePoint = {
  x: number;
  y: number;
  /** Optional fixed-pixel offset used by attached visual companions. */
  offsetX?: number;
  offsetY?: number;
};

export type UniverseAsteroidState = {
  spawnIndex: number;
  spawnedAt: number;
  movementIndex: number;
  previousMoveAt: number;
  nextMoveAt: number;
  nextCoordinate?: UniverseCoordinate;
  gasYield: number;
};

export type UniverseTimedObjectState = {
  cycleIndex: number;
  expiresAt: number;
  respawnAt: number;
  lifetimeMs: number;
  spawnChance: number;
};

export type UniversePirateState = UniverseTimedObjectState;

export type UniversePlanetNode = {
  id: string;
  coordinate: UniverseCoordinate;
  kind: UniverseObjectKind;
  name: string;
  art: string;
  ownerId?: string;
  isHomeworld?: boolean;
  statusLabel: string;
  description: string;
  known?: boolean;
  /** Versioned test-only seed identity, retained for later persistence wiring. */
  fixture?: UniverseFixtureMarker;
  asteroid?: UniverseAsteroidState;
  pirate?: UniversePirateState;
  special?: UniverseTimedObjectState;
  /** Position coefficient used by one-time solar energy sources. */
  positionCoefficientPercent?: number;
};

/** Persisted player-owned planet projected onto the procedural atlas. */
export type UniversePersistedPlayerPlanet = {
  id: string;
  coordinate: UniverseCoordinate;
  name: string;
  art?: string;
  isHomeworld?: boolean;
  ownerId?: string;
};

/** A planet supplied by an authoritative runtime registry, such as espionage targets. */
export type UniverseRegisteredPlanet = {
  id: string;
  coordinate: UniverseCoordinate;
  name: string;
  kind: Extract<UniverseObjectKind, 'player' | 'npc'>;
  ownerId: string;
  art?: string;
  isHomeworld?: boolean;
  known?: boolean;
};

export type UniverseSystem = {
  galaxy: number;
  system: number;
  starArt: string;
  /** Stable solar efficiency for this numbered system. */
  sunEfficiencyPercent: number;
  positions: UniversePlanetNode[];
  asteroids: UniversePlanetNode[];
};

export type UniverseMap = {
  galaxy: number;
  systems: UniverseSystem[];
};

export type UniverseOwnerPoints = {
  resource: number;
  battle: number;
  total: number;
  achievements: number;
};

export type UniverseOwnerAlliance = {
  id: string;
  name: string;
  tag: string;
  emblem: AllianceEmblem;
  glyph: AllianceEmblem['glyph'];
};

export type UniverseOwnerProfile = {
  id: string;
  displayName: string;
  avatarArt?: string;
  raceId?: string;
  alliance?: UniverseOwnerAlliance | null;
  points?: UniverseOwnerPoints;
  planetIds: string[];
};

/** A fixture is explicit metadata, not an owner-relation classification. */
export type UniverseFixtureDescriptor = {
  marker: UniverseFixtureMarker;
  coordinate: UniverseCoordinate;
  planet: Pick<UniversePlanetNode, 'id' | 'name' | 'art'>;
  owner: UniverseOwnerProfile;
};

export type UniverseAssetCatalog = {
  planetArts: readonly string[];
  asteroidArts: readonly string[];
  pirateArts: readonly string[];
  anomalyArts: readonly string[];
  uniqueArts: readonly string[];
  starArts: readonly string[];
};

export type UniverseAction = 'spy' | 'fleet' | 'attack';

export type UniverseActionState = {
  action: UniverseAction;
  enabled: boolean;
  status: 'supported' | 'prototype' | 'disabled';
  label: string;
  reason: string;
};
