import type { RatedOwnerIdentity } from '../domain/runtime/state-store.ts';
import { UNIVERSE_NPC_OWNER_ID } from '../domain/universe/runtime.ts';
import {
  RUNTIME_STATE_CHANGED_EVENT,
  type RuntimeMode,
  type TestTimeScale,
} from '../domain/runtime/mode.ts';
import { publishRuntimeStateSnapshot } from '../domain/runtime/state-store.ts';
import { SCIENCE_RUNTIME_CHANGED_EVENT } from '../domain/science/runtime.ts';
import { createScienceSnapshot } from './science.ts';
import type { PlanetId, SaveState } from './contracts.ts';
import { selectOwnerScores } from '../domain/rating/scoring.ts';

export type RuntimeApplicationContext = {
  planetId: PlanetId;
  now: number;
  mode: RuntimeMode;
  testTimeScale: TestTimeScale;
};

/** Owners the rating lists: the player and every real NPC owner on the map. */
export function selectRatedOwners(state: SaveState): Record<string, RatedOwnerIdentity> {
  const owners: Record<string, RatedOwnerIdentity> = {
    [state.profile.playerId]: { name: state.profile.displayName, factionId: state.profile.factionId },
  };
  for (const target of Object.values(state.espionage?.targets ?? {})) {
    if (target.kind !== 'npc' || target.ownerId === UNIVERSE_NPC_OWNER_ID || owners[target.ownerId]) continue;
    owners[target.ownerId] = { name: target.ownerName, factionId: target.raceId };
  }
  return owners;
}

export function publishApplicationRuntimeSnapshot(
  state: SaveState,
  context: RuntimeApplicationContext,
  target: EventTarget,
): void {
  const scienceSnapshot = createScienceSnapshot(state, context);
  target.dispatchEvent(new CustomEvent(SCIENCE_RUNTIME_CHANGED_EVENT, { detail: scienceSnapshot }));
  publishRuntimeStateSnapshot({
    mode: context.mode,
    command: state.command,
    rating: state.rating,
    ownerScores: selectOwnerScores(state),
    owners: selectRatedOwners(state),
    currentPlayerId: state.profile.playerId,
  });
  target.dispatchEvent(new CustomEvent(RUNTIME_STATE_CHANGED_EVENT, { detail: state }));
}
