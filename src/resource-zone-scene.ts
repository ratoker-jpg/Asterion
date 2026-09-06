import type { ResourceBuildingRole } from './domain/buildings/resource-zone.ts';

export type ResourceZoneScenePlacement = {
  left: string;
  top: string;
  width: number;
  shadowWidth: number;
};

export const RESOURCE_ZONE_SCENE_PLACEMENTS: Readonly<Record<ResourceBuildingRole, ResourceZoneScenePlacement>> = {
  'metal-production-1': { left: '18%', top: '36%', width: 190, shadowWidth: 122 },
  'metal-production-2': { left: '38%', top: '34%', width: 176, shadowWidth: 116 },
  'metal-production-3': { left: '58%', top: '36%', width: 198, shadowWidth: 128 },
  'mineral-production-1': { left: '78%', top: '34%', width: 180, shadowWidth: 118 },
  'mineral-production-2': { left: '20%', top: '56%', width: 186, shadowWidth: 122 },
  'gas-production-1': { left: '40%', top: '54%', width: 184, shadowWidth: 120 },
  'gas-production-2': { left: '60%', top: '56%', width: 194, shadowWidth: 126 },
  'basic-energy': { left: '79%', top: '55%', width: 188, shadowWidth: 132 },
  'advanced-energy': { left: '39%', top: '73%', width: 198, shadowWidth: 132 },
  hangar: { left: '62%', top: '73%', width: 214, shadowWidth: 146 },
};
