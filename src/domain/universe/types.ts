import type { AllianceEmblem } from '../command/types.ts';

export type UniverseObjectKind =
  | 'empty'
  | 'player'
  | 'npc'
  | 'pirate'
  | 'anomaly'
  | 'asteroid';

export type UniverseCoordinate = {
  galaxy: number;
  system: number;
  position: number;
};

export type UniversePoint = {
  x: number;
  y: number;
};

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
};

export type UniverseSystem = {
  galaxy: number;
  system: number;
  starArt: string;
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

export type UniverseAssetCatalog = {
  planetArts: readonly string[];
  asteroidArts: readonly string[];
  pirateArts: readonly string[];
  anomalyArts: readonly string[];
  starArts: readonly string[];
};

export type UniverseAction = 'spy' | 'fleet';

export type UniverseActionState = {
  action: UniverseAction;
  enabled: boolean;
  status: 'supported' | 'prototype' | 'disabled';
  label: string;
  reason: string;
};
