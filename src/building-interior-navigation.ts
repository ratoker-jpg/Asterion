import {
  getBuildingDefinition,
  type BuildingRole,
} from './domain/buildings/resource-zone.ts';

export const BUILDING_INTERIOR_ROLES = [
  'construction',
  'advanced-factory',
  'recycling',
  'trade-center',
  'shipyard',
  'research',
  'spaceport',
  'planetary-government',
  'bank',
] as const satisfies readonly BuildingRole[];

export type BuildingInteriorRole = (typeof BUILDING_INTERIOR_ROLES)[number];
export type BuildingInteriorZone = 'industry' | 'military';

export type BuildingInteriorTarget =
  | { kind: 'fleet-construction' }
  | { kind: 'science' }
  | { kind: 'command' }
  | { kind: 'host'; moduleTitle: string };

export type BuildingInteriorContext<PlanetId extends string> = {
  planetId: PlanetId;
  zone: BuildingInteriorZone;
  buildingRole: BuildingInteriorRole;
  returnTo: 'zone';
};

export const FLEET_CONSTRUCTION_REQUEST_EVENT = 'asterion:fleet-construction-request';

const targets: Readonly<Record<BuildingInteriorRole, BuildingInteriorTarget>> = {
  construction: { kind: 'host', moduleTitle: 'ПРОИЗВОДСТВО' },
  'advanced-factory': { kind: 'host', moduleTitle: 'ПРОМЫШЛЕННОЕ ПРОИЗВОДСТВО' },
  recycling: { kind: 'host', moduleTitle: 'ПЕРЕРАБОТКА' },
  'trade-center': { kind: 'host', moduleTitle: 'ТОРГОВЛЯ' },
  shipyard: { kind: 'fleet-construction' },
  research: { kind: 'science' },
  spaceport: { kind: 'host', moduleTitle: 'КОСМОДРОМ' },
  'planetary-government': { kind: 'command' },
  bank: { kind: 'host', moduleTitle: 'ФИНАНСЫ' },
};

export function isBuildingInteriorRole(role: BuildingRole): role is BuildingInteriorRole {
  return (BUILDING_INTERIOR_ROLES as readonly BuildingRole[]).includes(role);
}

export function getBuildingInteriorTarget(role: BuildingRole): BuildingInteriorTarget | null {
  return isBuildingInteriorRole(role) ? targets[role] : null;
}

export function canEnterBuildingInterior(role: BuildingRole, builtLevel: number): boolean {
  return builtLevel > 0 && isBuildingInteriorRole(role);
}

export function createBuildingInteriorContext<PlanetId extends string>(
  planetId: PlanetId,
  role: BuildingRole,
): BuildingInteriorContext<PlanetId> | null {
  if (!isBuildingInteriorRole(role)) return null;
  const zone = getBuildingDefinition(role).zone;
  if (zone !== 'industry' && zone !== 'military') return null;
  return {
    planetId,
    zone,
    buildingRole: role,
    returnTo: 'zone',
  };
}
