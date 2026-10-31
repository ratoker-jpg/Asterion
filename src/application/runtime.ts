import type { RatedAllianceDetails, RatedOwnerIdentity } from '../domain/runtime/state-store.ts';
import { selectOwnerPresence } from './owner-presence.ts';
import { holderKey } from '../domain/sun-raid/rules.ts';
import { selectAllianceRelations } from '../domain/command/diplomacy.ts';
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
  const presence = selectOwnerPresence(state);
  const sunRaid = state.sunRaid;
  const crystalsOf = (ownerId: string) => sunRaid?.crystals[holderKey({ kind: 'owner', id: ownerId })]?.length ?? 0;
  const gateOf = (ownerId: string) => sunRaid?.gates.find((gate) => gate.holder.kind === 'owner' && gate.holder.id === ownerId
    && (gate.status === 'building' || gate.status === 'completed'))?.status as RatedOwnerIdentity['gate'];
  const describe = (ownerId: string, name: string, factionId: string): RatedOwnerIdentity => ({
    name, factionId, planets: [],
    ...(presence[ownerId] ? { presence: presence[ownerId]!.online ? { online: true } : { online: false, lastSeenAt: (presence[ownerId] as { lastSeenAt: number }).lastSeenAt } } : {}),
    crystals: crystalsOf(ownerId),
    ...(gateOf(ownerId) ? { gate: gateOf(ownerId) } : {}),
  });
  const playerId = state.profile.playerId;
  const owners: Record<string, RatedOwnerIdentity> = {
    [playerId]: describe(playerId, state.profile.displayName, state.profile.factionId),
  };
  for (const [id, planet] of Object.entries(state.planets)) {
    if (planet.universeGalaxy === undefined || planet.universeSystem === undefined || planet.universePosition === undefined) continue;
    owners[playerId]!.planets!.push({ id, name: planet.name, coordinate: { galaxy: planet.universeGalaxy, system: planet.universeSystem, position: planet.universePosition } });
  }
  for (const target of Object.values(state.espionage?.targets ?? {})) {
    if (target.kind !== 'npc' || target.ownerId === UNIVERSE_NPC_OWNER_ID) continue;
    owners[target.ownerId] ??= describe(target.ownerId, target.ownerName, target.raceId);
    owners[target.ownerId]!.planets!.push({ id: target.id, name: target.name, coordinate: { ...target.coordinate } });
  }
  return owners;
}

/** Public facts the alliance rating opens up: size, wars, crystals and the Gate. */
export function selectRatedAlliances(state: SaveState): Record<string, RatedAllianceDetails> {
  const details: Record<string, RatedAllianceDetails> = {};
  for (const alliance of state.command.alliances) {
    const holder = holderKey({ kind: 'alliance', id: alliance.id });
    const gate = state.sunRaid?.gates.find((item) => item.holder.kind === 'alliance' && item.holder.id === alliance.id
      && (item.status === 'building' || item.status === 'completed'))?.status as RatedAllianceDetails['gate'];
    details[alliance.id] = {
      members: alliance.members.length,
      wars: selectAllianceRelations(state.command, alliance.id).filter((relation) => relation.status === 'war').length,
      crystals: state.sunRaid?.crystals[holder]?.length ?? 0,
      ...(gate ? { gate } : {}),
    };
  }
  return details;
}

/**
 * The world App renders now, set on every App render. Views that live outside
 * App (the fleet and repair portals, battle reports) start from it instead of
 * reading the save from storage: a late save takes hundreds of milliseconds to
 * parse, decode and migrate, and they used to do it on every section switch.
 */
let liveSaveState: SaveState | null = null;

export function setLiveSaveState(state: SaveState | null): void {
  liveSaveState = state;
}

/** The world App renders, or null outside a running campaign (then read the save). */
export function getLiveSaveState(): SaveState | null {
  return liveSaveState;
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
    alliances: selectRatedAlliances(state),
    currentPlayerId: state.profile.playerId,
  });
  target.dispatchEvent(new CustomEvent(RUNTIME_STATE_CHANGED_EVENT, { detail: state }));
}
