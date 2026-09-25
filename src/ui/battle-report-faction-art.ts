import type { CombatFactionId } from '../domain/combat/factions.ts';

export type BattleFactionArtId = CombatFactionId | 'pirates';

/** Presentation-only lookup; the raw pirate ID never enters combat faction resolution. */
export function battleFactionArtIdFor(race: string | null, combatFactionId: CombatFactionId): BattleFactionArtId {
  return race === 'pirates' ? 'pirates' : combatFactionId;
}
