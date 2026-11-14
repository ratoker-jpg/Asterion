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

/** The planet editor's looks with their art; NPC planets on the map use the same list. */
export const planetSkins = [
  { id: 'colonized', label: 'Колония', art: planetColonized },
  { id: 'terran', label: 'Терран', art: planetTerran },
  { id: 'oceanic', label: 'Океан', art: planetOceanic },
  { id: 'desert', label: 'Пустыня', art: planetDesert },
  { id: 'ice', label: 'Ледяная', art: planetIce },
  { id: 'volcanic', label: 'Вулкан', art: planetVolcanic },
  { id: 'toxic', label: 'Токсичная', art: planetToxic },
  { id: 'barren', label: 'Каменная', art: planetBarren },
  { id: 'gas', label: 'Газовый гигант', art: planetGas },
  { id: 'skin-002', label: 'Облик 002', art: generated002 },
  { id: 'skin-003', label: 'Облик 003', art: generated003 },
  { id: 'skin-005', label: 'Облик 005', art: generated005 },
  { id: 'skin-011', label: 'Облик 011', art: generated011 },
  { id: 'skin-012', label: 'Облик 012', art: generated012 },
  { id: 'skin-015', label: 'Облик 015', art: generated015 },
  { id: 'skin-016', label: 'Облик 016', art: generated016 },
  { id: 'skin-026', label: 'Облик 026', art: generated026 },
  { id: 'skin-027', label: 'Облик 027', art: generated027 },
  { id: 'skin-028', label: 'Облик 028', art: generated028 },
  { id: 'skin-030', label: 'Облик 030', art: generated030 },
  { id: 'skin-032', label: 'Облик 032', art: generated032 },
  ...asterionAssetIntegrationAssets.regularPlanetSkins,
] as const;

/** Map art of a planet-editor look, or undefined for an unknown id (the map then keeps its own art). */
export function planetSkinMapArt(skinId: string | undefined): string | undefined {
  if (!skinId) return undefined;
  const skin = planetSkins.find((candidate) => candidate.id === skinId);
  return skin ? ('mapArt' in skin ? skin.mapArt : skin.art) : undefined;
}
