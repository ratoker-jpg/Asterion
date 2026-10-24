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
  currentPlayerId: string;
};

export type RatedOwnerIdentity = { name: string; factionId: string };

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
