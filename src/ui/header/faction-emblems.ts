import type { PlayerFactionId } from '../../domain/profile/types.ts';
import aegisEmblem from '../../../assets/source/generated-factions-v1/factions/aegis_emblem.png';
import synodEmblem from '../../../assets/source/generated-factions-v1/factions/synod_emblem.png';
import veyraEmblem from '../../../assets/source/generated-factions-v1/factions/veyra_emblem.png';

/** Faction crest shown under the header planet dial. */
export const FACTION_EMBLEMS: Record<PlayerFactionId, string> = {
  aegis: aegisEmblem,
  synod: synodEmblem,
  veyra: veyraEmblem,
};
