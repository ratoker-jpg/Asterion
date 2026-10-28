import type { SaveState } from './contracts.ts';
import { reconcileRuntime, type RuntimeReconcileEvent } from './reconcile.ts';
import { isNpcCatchupPending } from './npc-catchup.ts';
import { isFlightEventForPlayer } from './flight-visibility.ts';
import { CAMPAIGN_SPEED_SCALE, setCampaignTimeScale } from '../domain/runtime/mode.ts';
import { setActiveGalaxyCount } from '../domain/universe/runtime.ts';
import { publishSunBrightness } from './sun-raid.ts';

/**
 * A long NPC catch-up run away from the screen (a Web Worker in the game):
 * the same reconcileRuntime calls App made, in larger chunks. Replay results
 * do not depend on where chunks end, so the world that comes out is the one
 * App's own loop would have produced.
 */

/** Replay groups per call: chunks of roughly CHUNK_TARGET_MS keep progress fluid. */
const CHUNK_TARGET_MS = 250;
const MIN_GROUPS = 32;
const MAX_GROUPS = 16_384;
/** A catch-up that ends further behind the clock than this extends to `now`. */
export const NPC_CATCHUP_RUNNER_SETTLE_MS = 1_500;

export type NpcCatchupProgress = Readonly<{ processedThroughAt: number; targetAt: number }>;

export type NpcCatchupRunnerHooks = {
  now: () => number;
  /** After every chunk; the runner never waits on it. */
  onProgress?: (progress: NpcCatchupProgress) => void;
  /** Every `persistEveryMs` of wall time with the consistent prefix reached so far. */
  onPersist?: (state: SaveState) => void;
  persistEveryMs?: number;
  /** Lets a worker yield to its message queue between chunks (cancellation). */
  yieldBetweenChunks?: () => Promise<void>;
  cancelled?: () => boolean;
};

export type NpcCatchupRunResult = {
  state: SaveState;
  /** Player-facing events only (App turns them into notices). */
  events: RuntimeReconcileEvent[];
  chunks: number;
  computeMs: number;
};

/** Mirrors App's applyCampaignRuntime for the module-level campaign settings the rules read. */
export function applyCampaignRuntimeForCatchup(state: SaveState, now: number): void {
  setCampaignTimeScale(CAMPAIGN_SPEED_SCALE[state.worldConfig?.world.campaignSpeed ?? 'standard'] ?? 1);
  setActiveGalaxyCount(state.worldConfig?.world.galaxyCount ?? 1);
  publishSunBrightness(state, now);
}

/** Keeps the events App shows to the player; NPC bookkeeping never reaches the UI. */
export function playerFacingEvents(events: readonly RuntimeReconcileEvent[], playerId: string): RuntimeReconcileEvent[] {
  const kept: RuntimeReconcileEvent[] = [];
  for (const event of events) {
    if (event.kind === 'flight') {
      const flights = event.events.filter((flightEvent) => isFlightEventForPlayer(flightEvent, playerId));
      if (flights.length) kept.push({ kind: 'flight', events: flights });
    } else if (event.kind === 'science' || event.kind === 'building' || event.kind === 'recycling' || event.kind === 'spaceport'
      || event.kind === 'fleet-production' || event.kind === 'sun-raid') kept.push(event);
  }
  return kept;
}

/**
 * Replays to the frozen target, then keeps closing the gap the replay itself
 * took (the clock moved on meanwhile) until the world is within
 * NPC_CATCHUP_RUNNER_SETTLE_MS of now. The world summary of the absence stays
 * the one being shown: extending the target keeps it.
 */
export async function runNpcCatchup(initial: SaveState, hooks: NpcCatchupRunnerHooks): Promise<NpcCatchupRunResult> {
  let state = initial;
  let groups = 256;
  let chunks = 0;
  let computeMs = 0;
  let lastPersistAt = hooks.now();
  const events: RuntimeReconcileEvent[] = [];
  const playerId = initial.profile.playerId;
  while (true) {
    while (isNpcCatchupPending(state)) {
      if (hooks.cancelled?.()) return { state, events, chunks, computeMs };
      const before = state.npcReplay!.processedThroughAt;
      const startedAt = performance.now();
      const result = reconcileRuntime(state, {
        planetId: state.currentPlanetId, now: hooks.now(), mode: 'production', testTimeScale: 1, replayMaxGroups: groups,
      });
      const elapsed = performance.now() - startedAt;
      computeMs += elapsed;
      chunks += 1;
      state = result.state;
      for (const event of playerFacingEvents(result.events, playerId)) events.push(event);
      // Aim each chunk at about CHUNK_TARGET_MS whatever the world's density.
      groups = Math.max(MIN_GROUPS, Math.min(MAX_GROUPS, Math.round(groups * Math.min(4, Math.max(0.25, CHUNK_TARGET_MS / Math.max(1, elapsed))))));
      if (state.npcReplay && state.npcReplay.processedThroughAt <= before && isNpcCatchupPending(state)) {
        throw new Error(`NPC catch-up made no progress at ${before}`);
      }
      if (state.npcReplay) hooks.onProgress?.({ processedThroughAt: state.npcReplay.processedThroughAt, targetAt: state.npcReplay.targetAt });
      if (hooks.onPersist && hooks.now() - lastPersistAt >= (hooks.persistEveryMs ?? 15_000)) {
        lastPersistAt = hooks.now();
        hooks.onPersist(state);
      }
      if (hooks.yieldBetweenChunks) await hooks.yieldBetweenChunks();
    }
    const replay = state.npcReplay;
    const now = Math.floor(hooks.now());
    if (!replay || now - replay.processedThroughAt <= NPC_CATCHUP_RUNNER_SETTLE_MS) break;
    if (replay.summary) {
      // The time the replay itself took: same summary, a target at now.
      state = { ...state, npcReplay: { ...replay, targetAt: now } };
      continue;
    }
    // No news window: the call App's clock tick would make freezes the target itself.
    const result = reconcileRuntime(state, { planetId: state.currentPlanetId, now, mode: 'production', testTimeScale: 1, replayMaxGroups: groups });
    state = result.state;
    for (const event of playerFacingEvents(result.events, playerId)) events.push(event);
  }
  return { state, events, chunks, computeMs };
}
