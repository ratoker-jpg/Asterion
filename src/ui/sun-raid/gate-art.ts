import type { PlayerFactionId } from '../../domain/profile/types.ts';
import { gateArt } from './sun-raid-assets.ts';

/** «Звёздные Врата» building art per race (finished Gates). Stages: see `gateArt`. */
export const GATE_BUILDING_ART: Readonly<Record<PlayerFactionId, string>> = { aegis: gateArt('aegis'), synod: gateArt('synod'), veyra: gateArt('veyra') };
export { gateArt };
