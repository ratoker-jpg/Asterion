import { createSeededRandom } from '../world/random.ts';
import type { NpcStateV1 } from './types.ts';

/**
 * Owner rule (25.10.2026): about one NPC in twenty plays the planet-destroyer
 * rush the owner used in Nemexia — shipyard 14, the sciences behind the
 * faction's strongest hull, then those hulls and their Spaceport upgrades.
 * They are the most military-minded owners of the campaign, chosen in a
 * private salted order, so the share holds for any number of NPCs and the
 * public name says nothing. How fast and how well each one gets there is its
 * own skill (`mechanicsKnowledge`), not part of the doctrine.
 */
export const NPC_FLAGSHIP_DOCTRINE_SHARE = 0.05;

const cache = new WeakMap<NpcStateV1['profiles'], ReadonlySet<string>>();

export function npcFlagshipOwners(npc: NpcStateV1 | undefined): ReadonlySet<string> {
  if (!npc) return new Set();
  const known = cache.get(npc.profiles);
  if (known) return known;
  const profiles = Object.values(npc.profiles);
  const count = Math.round(profiles.length * NPC_FLAGSHIP_DOCTRINE_SHARE);
  const score = (ownerId: string, military: number, aggression: number) =>
    military + 0.5 * aggression + 0.3 * createSeededRandom(JSON.stringify(['npc-doctrine:v1', npc.personaSalt, ownerId]))();
  const chosen = new Set(profiles
    .map((profile) => ({ ownerId: profile.ownerId, score: score(profile.ownerId, profile.traits.militaryFocus ?? 0, profile.traits.aggression ?? 0) }))
    .sort((left, right) => right.score - left.score || (left.ownerId < right.ownerId ? -1 : 1))
    .slice(0, count)
    .map((item) => item.ownerId));
  cache.set(npc.profiles, chosen);
  return chosen;
}
