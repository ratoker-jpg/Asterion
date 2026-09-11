import type { SaveState } from './contracts.ts';

export type ApplicationStateRef = { current: SaveState };
export type ApplicationStateSetter = (update: (current: SaveState) => SaveState) => void;

export type ApplicationStateTransition<TResult> = {
  state: SaveState;
  result: TResult;
};

/**
 * Keep synchronous handler results while making React resolve every queued
 * application action against the freshest state in the functional updater.
 */
export function enqueueApplicationStateUpdate<TResult>(
  stateRef: ApplicationStateRef,
  setState: ApplicationStateSetter,
  update: (current: SaveState) => ApplicationStateTransition<TResult>,
): TResult {
  const eager = update(stateRef.current);
  stateRef.current = eager.state;
  setState((current) => {
    const resolved = update(current);
    stateRef.current = resolved.state;
    return resolved.state;
  });
  return eager.result;
}
