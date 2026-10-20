import aegisGates from '../../../assets/source/New assets/buildings/aegis/building.aegis.supreme-galactic-gates.png';
import synodGates from '../../../assets/source/New assets/buildings/synod/building.synod.supreme-galactic-gates.png';
import veyraGates from '../../../assets/source/New assets/buildings/veyra/building.veyra.supreme-galactic-gates.png';
import type { PlayerFactionId } from '../../domain/profile/types.ts';

/** «Звёздные Врата» building art per race (existing faction delivery assets). */
export const GATE_BUILDING_ART: Readonly<Record<PlayerFactionId, string>> = { aegis: aegisGates, synod: synodGates, veyra: veyraGates };
