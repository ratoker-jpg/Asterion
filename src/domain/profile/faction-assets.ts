import aegisGeneral from '../../assets/art/generated-factions-v1/factions/aegis_general.webp';
import synodGeneral from '../../assets/art/generated-factions-v1/factions/synod_general.webp';
import veyraGeneral from '../../assets/art/generated-factions-v1/factions/veyra_general.webp';

export type FactionGeneralId = 'aegis' | 'synod' | 'veyra';

export const FACTION_GENERAL_ASSETS: Readonly<Record<FactionGeneralId, string>> = {
  aegis: aegisGeneral,
  synod: synodGeneral,
  veyra: veyraGeneral,
};

export function isFactionGeneralId(value: unknown): value is FactionGeneralId {
  return typeof value === 'string' && value in FACTION_GENERAL_ASSETS;
}

export function getFactionGeneralAsset(value: unknown): string | undefined {
  return isFactionGeneralId(value) ? FACTION_GENERAL_ASSETS[value] : undefined;
}
