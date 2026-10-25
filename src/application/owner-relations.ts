import { selectOwnerAlliance } from '../domain/command/selectors.ts';
import { selectAllianceRelations } from '../domain/command/diplomacy.ts';
import type { TargetRelation } from '../domain/flights/types.ts';
import type { SaveState } from './contracts.ts';

// Relations are pure of the (immutable) command state; one decision asks for
// hundreds of pairs against the same command. Nested by owner: flight
// reconciliation asks per orbiting probe and step, where joining a string
// key per call dominated the lookup.
const relationCache = new WeakMap<object, Map<string, Map<string, TargetRelation>>>();

/** Same public ownership/alliance/war rules as the map, from the acting owner. */
export function getOwnerRelation(state: SaveState, ownerId: string, targetOwnerId: string): TargetRelation {
  if (ownerId === targetOwnerId) return 'self';
  let cache = relationCache.get(state.command);
  if (!cache) {
    cache = new Map();
    relationCache.set(state.command, cache);
  }
  let byTarget = cache.get(ownerId);
  if (!byTarget) cache.set(ownerId, byTarget = new Map());
  const cached = byTarget.get(targetOwnerId);
  if (cached) return cached;
  const relation = computeOwnerRelation(state, ownerId, targetOwnerId);
  byTarget.set(targetOwnerId, relation);
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
