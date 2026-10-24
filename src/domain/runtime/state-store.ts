import type { CommandState } from '../command/types.ts';
import type { RatingPrototypeState } from '../rating/fixtures.ts';
import type { OwnerScore } from '../rating/types.ts';
import type { RuntimeMode } from './mode.ts';

export type RuntimeStateSnapshot = {
  mode: RuntimeMode;
  command: CommandState;
  rating: RatingPrototypeState;
  ownerScores: Record<string, OwnerScore>;
  /** Public identity of every rated owner (map name and race), never private persona data. */
  owners: Record<string, RatedOwnerIdentity>;
  alliances?: Record<string, RatedAllianceDetails>;
  currentPlayerId: string;
};

export type RatedOwnerPlanet = { id: string; name: string; coordinate: { galaxy: number; system: number; position: number } };

/**
 * Public identity of a rated owner: what any player can see about them —
 * their planets on the map, whether they are around (exact only to allies),
 * and the Sun crystals they or their alliance hold.
 */
export type RatedOwnerIdentity = {
  name: string;
  factionId: string;
  planets?: RatedOwnerPlanet[];
  presence?: { online: boolean; lastSeenAt?: number };
  crystals?: number;
  gate?: 'building' | 'completed';
};

/** What the alliance rating shows when an alliance row is opened. */
export type RatedAllianceDetails = { members: number; wars: number; crystals: number; gate?: 'building' | 'completed' };

let currentSnapshot: RuntimeStateSnapshot | null = null;
const listeners = new Set<() => void>();

export function getRuntimeStateSnapshot() {
  return currentSnapshot;
}

export function publishRuntimeStateSnapshot(snapshot: RuntimeStateSnapshot) {
  currentSnapshot = snapshot;
  listeners.forEach((listener) => listener());
}

export function subscribeRuntimeStateSnapshot(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
