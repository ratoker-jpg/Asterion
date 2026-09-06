import type { BuildingRole, BuildingZone } from './domain/buildings/resource-zone.ts';

export type ZoneScenePlacement = {
  left: string;
  top: string;
  width: number;
  shadowWidth: number;
};

type ZonePlacementMap = Partial<Record<BuildingRole, ZoneScenePlacement>>;

export const ZONE_SCENE_PLACEMENTS: Readonly<Record<BuildingZone, ZonePlacementMap>> = {
  resource: {
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
  },
  industry: {
    construction: { left: '23%', top: '40%', width: 202, shadowWidth: 138 },
    'advanced-factory': { left: '50%', top: '38%', width: 218, shadowWidth: 146 },
    'metal-storage': { left: '77%', top: '40%', width: 178, shadowWidth: 120 },
    'mineral-storage': { left: '27%', top: '60%', width: 180, shadowWidth: 122 },
    'gas-storage': { left: '51%', top: '59%', width: 186, shadowWidth: 126 },
    recycling: { left: '75%', top: '60%', width: 196, shadowWidth: 132 },
    'trade-center': { left: '51%', top: '76%', width: 204, shadowWidth: 138 },
  },
  military: {
    shipyard: { left: '24%', top: '43%', width: 220, shadowWidth: 150 },
    research: { left: '50%', top: '39%', width: 192, shadowWidth: 130 },
    spaceport: { left: '76%', top: '43%', width: 216, shadowWidth: 146 },
    'planetary-government': { left: '36%', top: '66%', width: 204, shadowWidth: 138 },
    bank: { left: '64%', top: '66%', width: 190, shadowWidth: 128 },
  },
};

export function getZoneScenePlacement(zone: BuildingZone, role: BuildingRole): ZoneScenePlacement {
  const placement = ZONE_SCENE_PLACEMENTS[zone][role];
  if (!placement) throw new Error(`Missing ${zone} scene placement for ${role}`);
  return placement;
}
