import aegisGeneral from '../../../assets/source/generated-factions-v1/factions/aegis_general.png';
import synodGeneral from '../../../assets/source/generated-factions-v1/factions/synod_general.png';
import veyraGeneral from '../../../assets/source/generated-factions-v1/factions/veyra_general.png';

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
