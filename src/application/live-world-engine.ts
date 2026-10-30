import type { SaveState } from './contracts.ts';
import { reconcileRuntime, type RuntimeReconcileEvent } from './reconcile.ts';
import { freezeNpcCatchupTarget, isNpcCatchupPending, needsNpcCatchupBefore } from './npc-catchup.ts';
import { applyCampaignRuntimeForCatchup, playerFacingEvents, runNpcCatchup } from './npc-catchup-runner.ts';
import { serializeSaveForStorage } from './persistence.ts';
import { applyWorldPatch, diffWorld, type PatchOp, type WorldPatch } from './world-diff.ts';
import type { LiveWorldPersistPolicy, LiveWorldRequest, LiveWorldResponse, LiveWorldVersion } from './live-world-protocol.ts';

/**
 * The live world worker's logic (see live-world-protocol.ts), free of the
 * worker global so tests drive it directly: it keeps the authoritative world,
 * reconciles it on the UI's ticks, applies the UI's patches, runs long
 * catch-ups in chunks and writes the saves.
 */

export type LiveWorldEngineHost = {
  post: (message: LiveWorldResponse) => void;
  /** Wall clock of the page (a long catch-up keeps closing the gap to it). */
  now: () => number;
  /** Lets queued messages in between catch-up chunks. */
  yieldToMessages: () => Promise<void>;
  /** Runs `task` later on the worker (save scheduling). */
  later: (task: () => void, delayMs: number) => void;
  clock?: () => number;
};

type Posted = { from: LiveWorldVersion; to: LiveWorldVersion; state: SaveState };

/** Commits wait this long for company before the world is saved. */
const COMMIT_SAVE_DELAY_MS = 50;

export class LiveWorldEngine {
  private ui: SaveState | null = null;
  private uiVersion: LiveWorldVersion = -1;
  /**
   * Worlds posted since uiVersion, each made from the one before it (the
   * first from uiVersion), until the UI builds on one (or drops them all).
   */
  private posted: Posted[] = [];
  private nextVersion = 1;
  private persist: LiveWorldPersistPolicy = { tickMaxIntervalMs: 60_000, tickCostFactor: 50, catchupIntervalMs: 15_000 };
  private lastSaveAt = Number.NEGATIVE_INFINITY;
  private lastSaveCostMs = 0;
  private saveScheduled = false;
  private savedVersion: LiveWorldVersion = -1;
  private catchup: { rebase: WorldPatch[]; droppedFreeze: boolean } | null = null;
  private failed = false;

  private readonly host: LiveWorldEngineHost;

  constructor(host: LiveWorldEngineHost) {
    this.host = host;
  }

  private readonly clock = () => (this.host.clock ?? (() => performance.now()))();

  /** Handles one message; a tick may run a long catch-up (other messages are handled between its chunks). */
  async handle(message: LiveWorldRequest): Promise<void> {
    if (this.failed) return;
    try {
      if (message.type === 'init') this.init(message);
      else if (message.type === 'commit') this.commit(message.from, message.to, message.patch);
      else if (message.type === 'save-now') this.save();
      // A tick during a catch-up, or before a world on its way reached the UI, only says where the UI is.
      else if (this.resolve(message.from, false) && !this.catchup) await this.tick(message.now, message.testTimeScale);
    } catch (error) {
      this.failed = true;
      this.host.post({ type: 'error', message: error instanceof Error ? `${error.message}\n${error.stack ?? ''}` : String(error) });
    }
  }

  private version(): LiveWorldVersion {
    const version = this.nextVersion;
    this.nextVersion += 2;
    return version;
  }

  private init(message: Extract<LiveWorldRequest, { type: 'init' }>): void {
    this.ui = message.state;
    this.uiVersion = message.version;
    this.posted = [];
    this.persist = message.persist;
    applyCampaignRuntimeForCatchup(message.state, this.host.now());
  }

  /**
   * Settles which world the UI is at; `from` is the version a UI message was
   * made on. False when worlds posted from there have not reached the UI yet
   * (a tick waits for them; a commit, made without them, drops them).
   */
  private resolve(from: LiveWorldVersion, commit: boolean): boolean {
    const reached = this.posted.findIndex((posted) => posted.to === from);
    if (reached >= 0) {
      this.ui = this.posted[reached]!.state;
      this.uiVersion = from;
      this.posted = this.posted.slice(reached + 1);
    }
    if (from !== this.uiVersion) throw new Error(`Live world out of step: the UI is at ${from}, the worker at ${this.uiVersion}.`);
    if (!this.posted.length) return true;
    if (!commit) return false;
    // The UI changed its world before these reached it: they are dropped.
    this.posted = [];
    if (this.catchup) this.catchup.droppedFreeze = true;
    return true;
  }

  private commit(from: LiveWorldVersion, to: LiveWorldVersion, patch: WorldPatch): void {
    this.resolve(from, true);
    const next = applyWorldPatch(this.ui!, patch);
    // A catch-up in progress takes the same records as the UI has them now.
    if (this.catchup) this.catchup.rebase.push(valuesOf(patch, next));
    this.ui = next;
    this.uiVersion = to;
    this.scheduleSave(COMMIT_SAVE_DELAY_MS);
  }

  /** Posts `next` as made from the newest world the UI has or will have. */
  private post(next: SaveState, events: RuntimeReconcileEvent[], computeMs: number): void {
    const last = this.posted.at(-1);
    const from = last ? last.to : this.uiVersion;
    const before = last ? last.state : this.ui!;
    if (next === before) {
      this.host.post({ type: 'ticked', from, to: from, patch: [], events, computeMs });
      return;
    }
    const to = this.version();
    this.posted.push({ from, to, state: next });
    this.host.post({ type: 'ticked', from, to, patch: diffWorld(before, next), events, computeMs });
  }

  private async tick(now: number, testTimeScale: Parameters<typeof reconcileRuntime>[1]['testTimeScale']): Promise<void> {
    const world = this.ui!;
    if (needsNpcCatchupBefore(world, now)) {
      await this.runCatchup(world, now);
      return;
    }
    const startedAt = this.clock();
    const result = reconcileRuntime(world, { planetId: world.currentPlanetId, now, mode: 'production', testTimeScale });
    const computeMs = this.clock() - startedAt;
    this.post(result.state, playerFacingEvents(result.events, world.profile.playerId), computeMs);
    // Clock ticks only advance time, which a reload replays identically: a
    // late world is saved after a pause that grows with what a save costs.
    const interval = Math.min(this.persist.tickMaxIntervalMs, this.lastSaveCostMs * this.persist.tickCostFactor);
    this.scheduleSave(Math.max(0, this.lastSaveAt + interval - this.host.now()));
  }

  private async runCatchup(world: SaveState, now: number): Promise<void> {
    const frozen = freezeNpcCatchupTarget(world, now);
    const catchup = { rebase: [] as WorldPatch[], droppedFreeze: false };
    this.catchup = catchup;
    try {
      // The UI learns at once that commands wait (and shows the progress).
      this.post(frozen, [], 0);
      if (!isNpcCatchupPending(frozen)) return;
      const startedAt = this.clock();
      const result = await runNpcCatchup(frozen, {
        now: this.host.now,
        onProgress: (progress) => this.host.post({ type: 'progress', ...progress }),
        // Progress is no world the UI has: the next save() writes again.
        onPersist: (state) => this.saveText(state, -1),
        persistEveryMs: this.persist.catchupIntervalMs,
        yieldBetweenChunks: this.host.yieldToMessages,
        // A command made on the world before the freeze reached the UI: start over from it.
        cancelled: () => catchup.droppedFreeze,
        rebase: (state) => {
          let next = state;
          for (const patch of catchup.rebase.splice(0)) next = applyWorldPatch(next, patch);
          return next;
        },
      });
      if (catchup.droppedFreeze) return;
      this.post(result.state, result.events, this.clock() - startedAt);
      // The caught-up world is saved at once, as posted (the UI takes it unless it changed meanwhile).
      this.saveText(result.state, this.posted.at(-1)?.to ?? this.uiVersion);
    } finally {
      this.catchup = null;
    }
  }

  private scheduleSave(delayMs: number): void {
    if (this.saveScheduled) return;
    this.saveScheduled = true;
    this.host.later(() => {
      this.saveScheduled = false;
      if (!this.failed && !this.catchup) this.save();
    }, delayMs);
  }

  /** Saves the world the UI has (never a tick it may still drop). */
  private save(): void {
    if (!this.ui || this.savedVersion === this.uiVersion) return;
    this.saveText(this.ui, this.uiVersion);
  }

  private saveText(state: SaveState, version: LiveWorldVersion): void {
    const startedAt = this.clock();
    const text = serializeSaveForStorage(state, 'production');
    const computeMs = this.clock() - startedAt;
    this.lastSaveAt = this.host.now();
    this.lastSaveCostMs = computeMs;
    this.savedVersion = version;
    this.host.post({ type: 'save', version, text, computeMs });
  }
}

/**
 * The patch as plain sets of the records it touched, with their values as
 * `after` has them: applied to a world that has moved on (a catch-up), the
 * UI's records replace those records instead of re-running array edits
 * whose positions belong to another array.
 */
function valuesOf(patch: WorldPatch, after: SaveState): WorldPatch {
  const ops: PatchOp[] = [];
  for (const op of patch) {
    if ('d' in op) { ops.push(op); continue; }
    let value: unknown = after;
    for (const key of op.p) value = (value as Record<string | number, unknown>)[key];
    ops.push({ p: op.p, v: value });
  }
  return ops;
}
