import planetColonized from './assets/art/starter/planets/planet_colonized.webp';
import planetTerran from './assets/art/starter/planets/planet_terran.webp';
import planetOceanic from './assets/art/starter/planets/planet_oceanic.webp';
import planetDesert from './assets/art/starter/planets/planet_desert.webp';
import planetIce from './assets/art/starter/planets/planet_ice.webp';
import planetVolcanic from './assets/art/starter/planets/planet_volcanic.webp';
import planetToxic from './assets/art/starter/planets/planet_toxic.webp';
import planetBarren from './assets/art/starter/planets/planet_barren_rocky.webp';
import planetGas from './assets/art/starter/planets/planet_gas_giant.webp';

import generated002 from './assets/art/planets/skins/planet-002.webp';
import generated003 from './assets/art/planets/skins/planet-003.webp';
import generated005 from './assets/art/planets/skins/planet-005.webp';
import generated011 from './assets/art/planets/skins/planet-011.webp';
import generated012 from './assets/art/planets/skins/planet-012.webp';
import generated015 from './assets/art/planets/skins/planet-015.webp';
import generated016 from './assets/art/planets/skins/planet-016.webp';
import generated026 from './assets/art/planets/skins/planet-026.webp';
import generated027 from './assets/art/planets/skins/planet-027.webp';
import generated028 from './assets/art/planets/skins/planet-028.webp';
import generated030 from './assets/art/planets/skins/planet-030.webp';
import generated032 from './assets/art/planets/skins/planet-032.webp';
import { asterionAssetIntegrationAssets } from './assets/generated/asterionAssetIntegrationManifest.generated.ts';
import { planetSkinPictures, planetSkinThumbs } from './planet-skin-images.generated.ts';
import type { AllianceRole } from './domain/command/types.ts';
import {
  DEFAULT_COLONY_SKIN, LEGACY_PLANET_SKIN_IDS, PLANET_SKIN_CATALOG, displayedPlanetSkinId,
  type PlanetSkinGroup, type PlanetSkinId, type PlanetSkinTier,
} from './domain/universe/planet-skins.ts';

/** A look with its pictures. */
export interface PlanetSkinArt {
  readonly id: PlanetSkinId;
  readonly label: string;
  readonly tier: PlanetSkinTier;
  readonly group: PlanetSkinGroup;
  /** Full picture: the planet screen, the header, Empire. */
  readonly art: string;
  /** Small picture for the map and the fleet board. */
  readonly mapArt: string;
  /** 192 px WebP for the editor's grid (one per look, a few KB each). */
  readonly thumb: string;
}

/** Looks shipped before the 14.11.2026 batch: their own art files. */
const legacyArt: Partial<Record<PlanetSkinId, string>> = {
  colonized: planetColonized,
  terran: planetTerran,
  oceanic: planetOceanic,
  desert: planetDesert,
  ice: planetIce,
  volcanic: planetVolcanic,
  toxic: planetToxic,
  barren: planetBarren,
  gas: planetGas,
  'skin-002': generated002,
  'skin-003': generated003,
  'skin-005': generated005,
  'skin-011': generated011,
  'skin-012': generated012,
  'skin-015': generated015,
  'skin-016': generated016,
  'skin-026': generated026,
  'skin-027': generated027,
  'skin-028': generated028,
  'skin-030': generated030,
  'skin-032': generated032,
};
const legacyMapArt = new Map<string, { art: string; mapArt: string }>(
  asterionAssetIntegrationAssets.regularPlanetSkins.map((entry) => [entry.id, { art: entry.art, mapArt: entry.mapArt }]),
);

function artFor(id: PlanetSkinId): { art: string; mapArt: string; thumb: string } {
  const legacy = legacyArt[id];
  const manifest = legacyMapArt.get(id);
  // A look without its pictures yet (a source still missing) falls back to «Колония».
  const thumb = planetSkinThumbs[id] ?? planetSkinThumbs[DEFAULT_COLONY_SKIN] ?? planetColonized;
  if (legacy) return { art: legacy, mapArt: legacy, thumb };
  if (manifest) return { ...manifest, thumb };
  // Looks from 14.11.2026 on: a 512 px WebP, the thumbnail doubles as map art.
  return { art: planetSkinPictures[id] ?? planetColonized, mapArt: thumb, thumb };
}

/** The planet editor's looks with their art, in the editor's order. */
export const planetSkins: readonly PlanetSkinArt[] = PLANET_SKIN_CATALOG.map((meta) => ({ ...meta, ...artFor(meta.id) }));

const byId = new Map<string, PlanetSkinArt>(planetSkins.map((entry) => [entry.id, entry]));
const defaultSkin = byId.get(DEFAULT_COLONY_SKIN)!;

/** The look by id (unknown ids → «Колония»), no alliance check: for the editor's own list. */
export function planetSkinById(skinId: string | undefined): PlanetSkinArt {
  return (skinId && byId.get(skinId)) || defaultSkin;
}

/**
 * The look a player's planet shows. Alliance looks show only while the owner
 * leads an alliance (see displayedPlanetSkinId).
 */
export function planetSkinFor(skinId: string | undefined, allianceRole: AllianceRole | null | undefined): PlanetSkinArt {
  return planetSkinById(displayedPlanetSkinId(skinId, allianceRole));
}

/** Map art of a look, or undefined for an unknown id (the map then keeps its own art). */
export function planetSkinMapArt(skinId: string | undefined, allianceRole?: AllianceRole | null): string | undefined {
  if (!skinId || !byId.has(skinId)) return undefined;
  return planetSkinFor(skinId, allianceRole === undefined ? 'leader' : allianceRole).mapArt;
}

/** A stable look for a planet nobody has scouted, by coordinate (the old 30, so nothing repaints). */
export function planetSkinArtByCoordinate(coordinate: { galaxy: number; system: number; position: number }): string {
  const id = LEGACY_PLANET_SKIN_IDS[Math.abs(coordinate.galaxy * 31 + coordinate.system * 7 + coordinate.position) % LEGACY_PLANET_SKIN_IDS.length];
  return planetSkinById(id).art;
}
