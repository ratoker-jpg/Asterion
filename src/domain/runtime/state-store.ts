import type { CommandState } from '../command/types.ts';
import type { RatingPrototypeState } from '../rating/fixtures.ts';

export type RuntimeStateSnapshot = {
  command: CommandState;
  rating: RatingPrototypeState;
};

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
