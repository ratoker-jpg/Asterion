import type { SaveState } from './contracts.ts';

export type ApplicationStateRef = { current: SaveState };
export type ApplicationStateSetter = (update: (current: SaveState) => SaveState) => void;
export type ApplicationStateFlush = (work: () => void) => void;

export type ApplicationStateTransition<TResult> = {
  state: SaveState;
  result: TResult;
};

/**
 * Resolve the action inside a functional React update and return the
 * transition that was actually applied. The caller supplies the synchronous
 * flush boundary so handler APIs can report the applied result without an
 * eager state calculation.
 */
export function enqueueApplicationStateUpdate<TResult>(
  stateRef: ApplicationStateRef,
  setState: ApplicationStateSetter,
  update: (current: SaveState) => ApplicationStateTransition<TResult>,
  flush: ApplicationStateFlush,
): TResult {
  const applied: { transition?: ApplicationStateTransition<TResult> } = {};
  flush(() => {
    setState((current) => {
      const resolved = update(current);
      applied.transition = resolved;
      return resolved.state;
    });
  });
  const resolved = applied.transition;
  if (!resolved) throw new Error('Application state update was not applied synchronously.');
  stateRef.current = resolved.state;
  return resolved.result;
}
