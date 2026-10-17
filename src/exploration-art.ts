import { asterionAssetIntegrationAssets } from './assets/generated/asterionAssetIntegrationManifest.generated.ts';
import uniqueIslands from '../assets/source/planets/skins/planet-010.png';
import uniqueVortex from '../assets/source/planets/skins/planet-013.png';
import uniqueCrystal from '../assets/source/planets/skins/planet-021.png';
import type { ExplorationKind } from './domain/exploration/model.ts';

/** One authoritative visual mapping for the Universe, Operations and Fleet contact cards. */
export const EXPLORATION_ARTS = {
  unique: [uniqueIslands, uniqueVortex, uniqueCrystal, ...asterionAssetIntegrationAssets.uniquePlanetArts],
  anomaly: [...asterionAssetIntegrationAssets.anomalyArts],
} satisfies Record<ExplorationKind, string[]>;

/** Higher-resolution art for Operations cards and dossiers; Universe views keep compact textures. */
export const EXPLORATION_OPERATION_DETAIL_ARTS = {
  unique: [uniqueIslands, uniqueVortex, uniqueCrystal, ...asterionAssetIntegrationAssets.operationsUniquePlanetArts],
  anomaly: [...asterionAssetIntegrationAssets.operationsAnomalyArts],
} satisfies Record<ExplorationKind, string[]>;

export function explorationArtForCycle(kind: ExplorationKind, system: number, cycleIndex: number): string {
  const arts = EXPLORATION_ARTS[kind];
  const index = (system + cycleIndex) % (kind === 'unique' ? 19 : 10);
  return arts[index] ?? arts[0] ?? '';
}

export function explorationOperationDetailArt(kind: string, thumbnailArt: string): string {
  if (kind !== 'unique' && kind !== 'anomaly') return thumbnailArt;
  const index = (EXPLORATION_ARTS[kind] as readonly string[]).indexOf(thumbnailArt);
  return index >= 0 ? EXPLORATION_OPERATION_DETAIL_ARTS[kind][index] ?? thumbnailArt : thumbnailArt;
}
