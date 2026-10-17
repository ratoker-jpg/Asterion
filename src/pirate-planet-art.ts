import pirate01 from '../assets/source/planets/pirate/pirate-planet-01-graveyard.png';
import pirate02 from '../assets/source/planets/pirate/pirate-planet-02-corsair-ocean.png';
import pirate03 from '../assets/source/planets/pirate/pirate-planet-03-treasure-vault.png';
import pirateSkull from '../assets/source/planets/pirate/planet-020.png';
import { asterionAssetIntegrationAssets } from './assets/generated/asterionAssetIntegrationManifest.generated.ts';

/** Shared art ordering for the real Universe planet and its Operations card. */
export const PIRATE_PLANET_ARTS = [
  pirateSkull, pirate01, pirate02, pirate03,
  ...asterionAssetIntegrationAssets.piratePlanetArts,
];

const PIRATE_PLANET_OPERATION_DETAIL_ARTS = [
  pirateSkull, pirate01, pirate02, pirate03,
  ...asterionAssetIntegrationAssets.operationsPiratePlanetArts,
];

function piratePlanetArtIndex(system: number, cycleIndex: number): number {
  return Number.isSafeInteger(system) && Number.isSafeInteger(cycleIndex)
    ? Math.abs(system + cycleIndex) % PIRATE_PLANET_ARTS.length
    : 0;
}

export function getPiratePlanetArt(system: number, cycleIndex: number): string {
  return PIRATE_PLANET_ARTS[piratePlanetArtIndex(system, cycleIndex)];
}

export function getPiratePlanetOperationDetailArt(system: number, cycleIndex: number): string {
  return PIRATE_PLANET_OPERATION_DETAIL_ARTS[piratePlanetArtIndex(system, cycleIndex)]
    ?? getPiratePlanetArt(system, cycleIndex);
}
