export type PlanetZoneId = 'resource' | 'industry' | 'military';

const ZONE_TERRAINS: Readonly<Record<PlanetZoneId, string>> = {
  resource: new URL('./art/faction-delivery-v1/territories/resource-terrain.webp', import.meta.url).href,
  industry: new URL('./art/faction-delivery-v1/territories/industry-terrain.webp', import.meta.url).href,
  military: new URL('./art/faction-delivery-v1/territories/military-terrain.webp', import.meta.url).href,
};

export function getPlanetZoneTerrainUrl(zone: PlanetZoneId): string {
  return ZONE_TERRAINS[zone];
}
