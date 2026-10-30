import type { SaveState } from './contracts.ts';
import type { RuntimeReconcileEvent } from './reconcile.ts';
import type { WorldPatch } from './world-diff.ts';
import type { TestTimeScale } from '../domain/runtime/mode.ts';

/**
 * Messages between App (the UI thread) and the live world worker
 * (src/live-world.worker.ts, logic in live-world-engine.ts).
 *
 * Both sides hold the world: the worker the authoritative one it simulates,
 * the UI thread a mirror it renders and computes the player's commands on.
 * Every world either side makes gets a version id (the UI's even, the
 * worker's odd, so they never meet), and every change travels as a record
 * patch from one version to the next:
 *
 * - the UI asks for a tick at its version; the worker reconciles to `now` and
 *   posts the patch from that version to its new one;
 * - the UI applies a tick only if it is still at the version the tick was
 *   made from. A player command made meanwhile wins: the UI posts it as a
 *   patch from its version, and the worker, seeing the command was made on
 *   the world before its tick, drops the tick and applies the command there.
 *   The next tick starts from the commanded world, exactly as if the command
 *   came first on one thread (the time of that tick is simulated again);
 * - a long absence is the same tick: the worker freezes the catch-up target,
 *   posts that at once (commands are refused meanwhile), replays in chunks
 *   with progress and periodic saves, and posts the caught-up world.
 */

export type LiveWorldVersion = number;

export type LiveWorldRequest =
  /** The world (re)starts here: a load, a new campaign, a window's adoption of another's save. */
  | { type: 'init'; version: LiveWorldVersion; state: SaveState; clockOffsetMs: number; persist: LiveWorldPersistPolicy }
  /** The UI changed its world from `from` to `to` (a command, a setting, a selection). */
  | { type: 'commit'; from: LiveWorldVersion; to: LiveWorldVersion; patch: WorldPatch; at: number }
  /** Reconcile the world (at `from`) to `now`. */
  | { type: 'tick'; from: LiveWorldVersion; now: number; testTimeScale: TestTimeScale }
  /** Post the save text of the world the UI has, now (an explicit save). */
  | { type: 'save-now' };

export type LiveWorldPersistPolicy = {
  /** Clock ticks are saved at most this often... */
  tickMaxIntervalMs: number;
  /** ...or after this many times the last save's cost, whichever is sooner. */
  tickCostFactor: number;
  /** Progress of a long catch-up is saved this often. */
  catchupIntervalMs: number;
};

export type LiveWorldResponse =
  /** The world at `from` became `to` (a tick; `to === from` when nothing changed). */
  | { type: 'ticked'; from: LiveWorldVersion; to: LiveWorldVersion; patch: WorldPatch; events: RuntimeReconcileEvent[]; computeMs: number }
  /** A long catch-up advances (the world itself arrives with the final `ticked`). */
  | { type: 'progress'; processedThroughAt: number; targetAt: number }
  /** Save text (serializeSaveForStorage) of the world at `version`. */
  | { type: 'save'; version: LiveWorldVersion; text: string; computeMs: number }
  /** The worker cannot go on (a bug, a desync): App takes the world back on its own thread. */
  | { type: 'error'; message: string };

/** Fired on window while a catch-up in the worker advances (the world itself arrives when it ends). */
export const NPC_CATCHUP_PROGRESS_EVENT = 'asterion:npc-catchup-progress';
