import type { SaveState } from './contracts.ts';
import { getNpcOwnerIds } from './npc-foundation.ts';
import { UNIVERSE_NPC_OWNER_ID } from '../domain/universe/runtime.ts';
import { startWorldCatchupSummary } from './world-catchup-summary.ts';
export { isNpcReplayMetadata } from '../domain/npc/replay-state.ts';

export const NPC_REPLAY_MAX_GROUPS = 64;
export const NPC_REPLAY_WINDOW_MS = 24 * 60 * 60 * 1_000;
/** NPC calendar events are generated lazily in steps of this size inside a window. */
export const NPC_REPLAY_GENERATION_STEP_MS = 60 * 60 * 1_000;
/**
 * Unreconciled NPC time a player command may run over. The clock reconciles
 * every second while the window is open; a larger gap means the game was
 * closed or throttled in the background and a catch-up must run first.
 */
export const NPC_CATCHUP_COMMAND_GRACE_MS = 2 * 60 * 1_000;

export function isNpcCatchupPending(state: Pick<SaveState, 'npcReplay'>): boolean {
  return Boolean(state.npcReplay && state.npcReplay.targetAt > state.npcReplay.processedThroughAt);
}

/** Registered production NPC owners whose economies the replay advances (reconcileRuntime's set). */
export function getReplayNpcOwnerIds(state: Pick<SaveState, 'espionage' | 'profile' | 'npc'>): string[] {
  if (!state.npc) return [];
  return getNpcOwnerIds(state.espionage?.targets, state.profile.playerId)
    .filter((id) => id !== UNIVERSE_NPC_OWNER_ID && Boolean(state.npc?.profiles[id]));
}

/**
 * True when NPC time up to `now` still has to be replayed before a command:
 * a frozen catch-up is pending, or the replay cursor trails `now` by more than
 * the grace (a save just loaded, before the first clock tick froze its target).
 * Pure metadata reads; it never runs the replay.
 */
export function needsNpcCatchupBefore(state: SaveState, now: number): boolean {
  if (isNpcCatchupPending(state)) return true;
  const replay = state.npcReplay;
  if (!replay || now - replay.processedThroughAt <= NPC_CATCHUP_COMMAND_GRACE_MS) return false;
  return getReplayNpcOwnerIds(state).length > 0;
}

/**
 * Freezes the catch-up target at `now` exactly as reconcileRuntime would on
 * its next call (target = floor(now) when nothing is pending), so commands
 * are refused from this moment without computing any replay here.
 */
export function freezeNpcCatchupTarget(state: SaveState, now: number): SaveState {
  const replay = state.npcReplay;
  if (!replay || isNpcCatchupPending(state)) return state;
  const targetAt = Math.max(replay.processedThroughAt, Math.floor(now));
  if (targetAt === replay.targetAt) return state;
  // The catch-up starts here, so its world news starts here too (complete) — unless the
  // news of the same absence end exactly here (the cloud server lived its first part and
  // the player chose to replay the rest on this computer): then they go on.
  const continued = replay.summary?.finishedAt === replay.processedThroughAt
    ? (({ finishedAt: _closed, ...open }) => open)(replay.summary) : null;
  const summary = targetAt - replay.processedThroughAt > NPC_CATCHUP_COMMAND_GRACE_MS
    ? continued ?? startWorldCatchupSummary(state, replay.processedThroughAt) : replay.summary;
  return { ...state, npcReplay: { ...replay, targetAt, ...(summary ? { summary } : {}) } };
}
