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

export function explorationArtForCycle(kind: ExplorationKind, system: number, cycleIndex: number): string {
  const arts = EXPLORATION_ARTS[kind];
  const index = (system + cycleIndex) % (kind === 'unique' ? 19 : 10);
  return arts[index] ?? arts[0] ?? '';
}
