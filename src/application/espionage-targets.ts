import { selectCurrentAlliance } from '../domain/command/selectors.ts';
import type { DiplomaticRelation } from '../domain/command/types.ts';
import { getEspionageTargets } from '../domain/espionage/runtime.ts';
import type { SpyTargetState } from '../domain/espionage/types.ts';
import type { SaveState } from './contracts.ts';
import {
  getUniverseOwnerRelation,
  type UniverseOwnerRelation,
} from '../domain/universe/runtime.ts';
import type {
  UniverseOwnerProfile,
  UniversePlanetNode,
} from '../domain/universe/types.ts';

export type ResolvedSpyTarget = {
  target: SpyTargetState;
  owner: UniverseOwnerProfile;
  relation: UniverseOwnerRelation;
};

export function createSpyTargetOwnerProfile(target: SpyTargetState): UniverseOwnerProfile {
  return {
    id: target.ownerId,
    displayName: target.ownerName,
    raceId: target.raceId,
    alliance: target.alliance,
    planetIds: [target.id],
  };
}

function targetNode(target: SpyTargetState, currentOwnerId: string): UniversePlanetNode {
  return {
    id: target.id,
    coordinate: { ...target.coordinate },
    kind: target.kind ?? 'npc',
    name: target.name,
    art: 'planet-default',
    ownerId: target.ownerId,
    isHomeworld: target.ownerId === currentOwnerId,
    statusLabel: 'Планета владельца',
    description: 'Планета владельца, доступная для авторитетной проверки шпионажа.',
  };
}

export function resolveSpyTarget(
  state: SaveState,
  targetPlanetId: string,
  expected?: { ownerId?: string; coordinate?: SpyTargetState['coordinate'] },
): ResolvedSpyTarget | null {
  const target = getEspionageTargets(state.espionage)[targetPlanetId];
  if (!target || (target.kind !== undefined && target.kind !== 'player' && target.kind !== 'npc')) return null;
  if (expected?.ownerId !== undefined && target.ownerId !== expected.ownerId) return null;
  if (expected?.coordinate
    && (target.coordinate.galaxy !== expected.coordinate.galaxy
      || target.coordinate.system !== expected.coordinate.system
      || target.coordinate.position !== expected.coordinate.position)) return null;

  const owner = createSpyTargetOwnerProfile(target);
  const currentAlliance = selectCurrentAlliance(state.command);
  const relation = getUniverseOwnerRelation(
    targetNode(target, state.profile.playerId),
    state.profile.playerId,
    currentAlliance,
    owner,
    state.command.diplomacy as readonly Pick<DiplomaticRelation, 'id' | 'tag' | 'status'>[],
  );
  return { target, owner, relation };
}
