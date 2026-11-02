import type { SaveState } from './contracts.ts';
import { isNpcCatchupPending } from './npc-catchup.ts';

export const NPC_CATCHUP_COMMAND_BLOCKED_MESSAGE = 'Команда отклонена: дождитесь завершения обработки событий NPC.';
export const APPLICATION_COMMAND_REQUEST_EVENTS = [
  'asterion:combat-resolve-request',
  'asterion:combat-result-apply-request',
  'asterion:fleet-production-start-request',
  'asterion:fleet-production-cancel-request',
  'asterion:fleet-production-dismantle-satellites-request',
  'asterion:repair-request',
  'asterion:science-start-request',
  'asterion:science-cancel-request',
  'asterion:flight-dispatch-request',
  'asterion:flight-recall-request',
  'asterion:bot01-incoming-scenario-request',
  'asterion:bot01-exploration-scenario-request',
  'asterion:spy-report-request',
  'asterion:spy-report-all-request',
] as const;
const NON_GAMEPLAY_REQUEST_EVENTS = new Set([
  'asterion:fleet-root-request',
  'asterion:fleet-construction-request',
]);

/** Classifies the existing event bridge requests that can issue gameplay commands. */
export function isGameplayCommandRequestEvent(type: string): boolean {
  return (APPLICATION_COMMAND_REQUEST_EVENTS as readonly string[]).includes(type)
    && !NON_GAMEPLAY_REQUEST_EVENTS.has(type);
}

/** Shared App/bridge guard for player commands while a saved NPC replay is incomplete. */
export function isApplicationCommandBlocked(state: SaveState): boolean {
  return isNpcCatchupPending(state);
}

export type ApplicationStateRef = { current: SaveState };
export type ApplicationStateSetter = (update: (current: SaveState) => SaveState) => void;
export type ApplicationStateFlush = (work: () => void) => void;

export type ApplicationStateTransition<TResult> = {
  state: SaveState;
  result: TResult;
};

/** The state React last rendered (App assigns it during render, unlike `ApplicationStateRef` which commands assign too). */
export type ApplicationRenderedState = { readonly current: SaveState };

/**
 * Resolve the action inside a functional React update and return the
 * transition that was actually applied. The caller supplies the synchronous
 * flush boundary so handler APIs can report the applied result without an
 * eager state calculation.
 *
 * With `rendered`, the result is checked after the flush: a command the game
 * has acknowledged (its result says ok, the notice is shown) whose state React
 * never rendered would be lost silently - the queue entry or the trade the
 * player was just told about is simply not there (seen on CI as «Build queue
 * did not persist» and a trade that never took a slot, with no state commit
 * after the click). The transition's state is then committed explicitly and
 * `onHeal` is told.
 */
export function enqueueApplicationStateUpdate<TResult>(
  stateRef: ApplicationStateRef,
  setState: ApplicationStateSetter,
  update: (current: SaveState) => ApplicationStateTransition<TResult>,
  flush: ApplicationStateFlush,
  rendered?: ApplicationRenderedState,
  onHeal?: (state: SaveState) => void,
): TResult {
  const renderedBefore = rendered?.current;
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
  if (rendered && resolved.state !== renderedBefore && rendered.current !== resolved.state) {
    flush(() => { setState(() => resolved.state); });
    onHeal?.(resolved.state);
  }
  stateRef.current = resolved.state;
  return resolved.result;
}
