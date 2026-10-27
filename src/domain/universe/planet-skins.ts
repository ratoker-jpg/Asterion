/**
 * Planet looks a player can pick in the planet editor, by id (the art lives
 * in the UI layer). NPCs choose their colonies' looks from this same list.
 */
export const DEFAULT_COLONY_SKIN = 'colonized';

export const PLANET_SKIN_IDS = [
  'colonized', 'terran', 'oceanic', 'desert', 'ice', 'volcanic', 'toxic', 'barren', 'gas',
  'skin-002', 'skin-003', 'skin-005', 'skin-011', 'skin-012', 'skin-015', 'skin-016',
  'skin-026', 'skin-027', 'skin-028', 'skin-030', 'skin-032',
  'skin-asterion-01', 'skin-asterion-02', 'skin-asterion-03', 'skin-asterion-04', 'skin-asterion-05',
  'skin-asterion-06', 'skin-asterion-07', 'skin-asterion-08', 'skin-asterion-09',
] as const;

export type PlanetSkinId = (typeof PLANET_SKIN_IDS)[number];

const KNOWN = new Set<string>(PLANET_SKIN_IDS);

export function isPlanetSkinId(value: unknown): value is PlanetSkinId {
  return typeof value === 'string' && KNOWN.has(value);
}
