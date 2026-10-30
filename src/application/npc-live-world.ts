import type { SaveState } from './contracts.ts';
import { reconcileRuntime } from './reconcile.ts';
import { isNpcCatchupPending, NPC_CATCHUP_COMMAND_GRACE_MS } from './npc-catchup.ts';
import { startWorldCatchupSummary } from './world-catchup-summary.ts';

/**
 * The world the cloud server keeps alive while the player is away
 * (server/src/runner.ts). It is the catch-up the game would run on the
 * player's return, done in small steps as time passes: the same
 * reconcileRuntime calls, the replay target moved forward with the clock and
 * one summary of the absence kept open until the player takes the world back.
 * Replay results do not depend on where chunks or targets end
 * (npc-live-world.test.ts), so the world handed back is the one a local
 * catch-up of the same length from the same save produces.
 */

/** Replay groups per call: the runner sizes chunks by time like the worker does. */
const MIN_GROUPS = 32;
const MAX_GROUPS = 16_384;

/**
 * Opens the absence at the save's replay cursor, as the client's first clock
 * tick after a long absence would (freezeNpcCatchupTarget over the command
 * grace): a fresh world summary from the moment the player left.
 */
export function beginLiveWorld(state: SaveState): SaveState {
  const replay = state.npcReplay;
  if (!replay) return state;
  const fromAt = replay.processedThroughAt;
  return {
    ...state,
    npcReplay: { ...replay, targetAt: Math.max(replay.targetAt, fromAt), summary: startWorldCatchupSummary(state, fromAt) },
  };
}

export type LiveWorldStep = {
  state: SaveState;
  /** True when the world reached `now` within the budget. */
  caughtUp: boolean;
  chunks: number;
  computeMs: number;
  /** Groups per call for the next step (carry it over). */
  groups: number;
};

/**
 * Moves the world towards `now` for at most `budgetMs` of compute. The
 * summary of the absence stays open (reconcileRuntime closes it whenever the
 * cursor reaches the target; the absence is not over until the player returns).
 */
export function advanceLiveWorld(
  initial: SaveState,
  now: number,
  options: { budgetMs?: number; groups?: number; chunkTargetMs?: number; clock?: () => number } = {},
): LiveWorldStep {
  const clock = options.clock ?? (() => performance.now());
  const budgetMs = options.budgetMs ?? Number.POSITIVE_INFINITY;
  const chunkTargetMs = options.chunkTargetMs ?? 250;
  let groups = options.groups ?? 256;
  let state = extendTarget(initial, Math.floor(now));
  let chunks = 0;
  let computeMs = 0;
  while (isNpcCatchupPending(state) && computeMs < budgetMs) {
    const before = state.npcReplay!.processedThroughAt;
    const startedAt = clock();
    state = reconcileRuntime(state, {
      planetId: state.currentPlanetId, now: state.npcReplay!.targetAt, mode: 'production', testTimeScale: 1, replayMaxGroups: groups,
    }).state;
    const elapsed = clock() - startedAt;
    computeMs += elapsed;
    chunks += 1;
    groups = Math.max(MIN_GROUPS, Math.min(MAX_GROUPS, Math.round(groups * Math.min(4, Math.max(0.25, chunkTargetMs / Math.max(1, elapsed))))));
    state = keepSummaryOpen(state);
    if (isNpcCatchupPending(state) && state.npcReplay!.processedThroughAt <= before) throw new Error(`Live world made no progress at ${before}`);
  }
  return { state, caughtUp: !isNpcCatchupPending(state), chunks, computeMs, groups };
}

/**
 * Hands the world back: the absence ends where the replay cursor stands.
 * `left` is the save the live world began from (beginLiveWorld's input).
 */
export function finishLiveWorld(state: SaveState, left: Pick<SaveState, 'npcReplay'>): SaveState {
  const replay = state.npcReplay;
  const from = left.npcReplay;
  if (!replay || !from) return state;
  // An absence inside the command grace is live play to the client: no news of its own.
  const short = replay.processedThroughAt - from.processedThroughAt <= NPC_CATCHUP_COMMAND_GRACE_MS;
  const summary = short ? from.summary
    : replay.summary ? { ...replay.summary, finishedAt: replay.summary.finishedAt ?? replay.processedThroughAt } : undefined;
  const { summary: _dropped, ...rest } = replay;
  return { ...state, npcReplay: { ...rest, ...(summary ? { summary } : {}) } };
}

function extendTarget(state: SaveState, now: number): SaveState {
  const replay = state.npcReplay;
  if (!replay || now <= replay.targetAt) return state;
  return { ...state, npcReplay: { ...replay, targetAt: now } };
}

function keepSummaryOpen(state: SaveState): SaveState {
  const replay = state.npcReplay;
  if (!replay?.summary || replay.summary.finishedAt === undefined) return state;
  const { finishedAt: _closed, ...open } = replay.summary;
  return { ...state, npcReplay: { ...replay, summary: open } };
}
