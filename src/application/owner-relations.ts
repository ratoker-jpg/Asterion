import { selectOwnerAlliance } from '../domain/command/selectors.ts';
import { selectAllianceRelations } from '../domain/command/diplomacy.ts';
import type { TargetRelation } from '../domain/flights/types.ts';
import type { SaveState } from './contracts.ts';

// Relations are pure of the (immutable) command state; one decision asks for
// hundreds of pairs against the same command.
const relationCache = new WeakMap<object, Map<string, TargetRelation>>();

/** Same public ownership/alliance/war rules as the map, from the acting owner. */
export function getOwnerRelation(state: SaveState, ownerId: string, targetOwnerId: string): TargetRelation {
  if (ownerId === targetOwnerId) return 'self';
  let cache = relationCache.get(state.command);
  if (!cache) {
    cache = new Map();
    relationCache.set(state.command, cache);
  }
  const key = `${ownerId}\u0000${targetOwnerId}`;
  const cached = cache.get(key);
  if (cached) return cached;
  const relation = computeOwnerRelation(state, ownerId, targetOwnerId);
  cache.set(key, relation);
  return relation;
}

function computeOwnerRelation(state: SaveState, ownerId: string, targetOwnerId: string): TargetRelation {
  const alliance = selectOwnerAlliance(state.command, ownerId);
  const targetAlliance = selectOwnerAlliance(state.command, targetOwnerId);
  if (!alliance || !targetAlliance) return 'neutral';
  if (alliance.id === targetAlliance.id || alliance.tag.toUpperCase() === targetAlliance.tag.toUpperCase()) return 'ally';
  const relation = selectAllianceRelations(state.command, alliance.id).find((item) => item.id === targetAlliance.id);
  return relation?.status === 'war' || relation?.status === 'hostile' ? 'enemy' : 'neutral';
}
