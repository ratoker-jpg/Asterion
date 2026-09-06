export type PlanetZoneId = 'resource' | 'industry' | 'military';

const ZONE_TERRAINS: Readonly<Record<PlanetZoneId, string>> = {
  resource: new URL('../../assets/source/faction-delivery-v1/territories/resource-terrain.png', import.meta.url).href,
  industry: new URL('../../assets/source/faction-delivery-v1/territories/industry-terrain.png', import.meta.url).href,
  military: new URL('../../assets/source/faction-delivery-v1/territories/military-terrain.png', import.meta.url).href,
};

export function getPlanetZoneTerrainUrl(zone: PlanetZoneId): string {
  return ZONE_TERRAINS[zone];
}
