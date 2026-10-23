import { selectOwnerAlliance } from '../domain/command/selectors.ts';
import { selectAllianceRelations } from '../domain/command/diplomacy.ts';
import type { TargetRelation } from '../domain/flights/types.ts';
import type { SaveState } from './contracts.ts';

/** Same public ownership/alliance/war rules as the map, from the acting owner. */
export function getOwnerRelation(state: SaveState, ownerId: string, targetOwnerId: string): TargetRelation {
  if (ownerId === targetOwnerId) return 'self';
  const alliance = selectOwnerAlliance(state.command, ownerId);
  const targetAlliance = selectOwnerAlliance(state.command, targetOwnerId);
  if (!alliance || !targetAlliance) return 'neutral';
  if (alliance.id === targetAlliance.id || alliance.tag.toUpperCase() === targetAlliance.tag.toUpperCase()) return 'ally';
  const relation = selectAllianceRelations(state.command, alliance.id).find((item) => item.id === targetAlliance.id);
  return relation?.status === 'war' || relation?.status === 'hostile' ? 'enemy' : 'neutral';
}
