import type { SaveState } from './contracts.ts';
import { reconcileRuntime, type RuntimeReconcileEvent } from './reconcile.ts';
import { freezeNpcCatchupTarget, isNpcCatchupPending, needsNpcCatchupBefore } from './npc-catchup.ts';
import { applyCampaignRuntimeForCatchup, playerFacingEvents, runNpcCatchup } from './npc-catchup-runner.ts';
import { serializeSaveForStorage } from './persistence.ts';
import { applyWorldPatch, diffWorld, type PatchOp, type WorldPatch } from './world-diff.ts';
import type { LiveWorldPersistPolicy, LiveWorldRequest, LiveWorldResponse, LiveWorldVersion } from './live-world-protocol.ts';
import { EXTERNAL_SAVE_MIN_CHARS } from './save-storage.ts';
import { QuietRegistry } from './quiet-fields.ts';
import { projectWorld, unprojectPatch } from './ui-projection.ts';
import { formatNpcJournalLines, NpcJournalRecorder, setNpcJournalSink, type NpcJournalEntry } from './npc-journal.ts';

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
  /**
   * Hands a large save to the main process as bytes (cloned on the worker thread,
   * no copy on the UI thread). Absent or false: the text goes to the UI thread as before.
   */
  /** Saves at least this long go through sendSave (default: the size the desktop store takes). */
  portMinChars?: number;
  sendSave?: (version: LiveWorldVersion, bytes: ArrayBuffer, chars: number, computeMs: number) => boolean;
  /** false: no bot journal (tests that run several engines in one thread). */
  journal?: boolean;
};

/** `journal`: bot journal entries made on the way to `state`, kept only if the UI takes it. */
type Posted = { from: LiveWorldVersion; to: LiveWorldVersion; state: SaveState; journal: NpcJournalEntry[] };

/** Commits wait this long for company before the world is saved. */
const COMMIT_SAVE_DELAY_MS = 50;

/** The quiet fields (quiet-fields.ts) reach the window at least this often. */
export const QUIET_BATCH_EVERY_MS = 10_000;

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
  /** When the pending save is due, and which timer owns it (an earlier request replaces a later one). */
  private saveDueAt = Number.POSITIVE_INFINITY;
  private saveTimer = 0;
  private savedVersion: LiveWorldVersion = -1;
  private catchup: { rebase: WorldPatch[]; droppedFreeze: boolean } | null = null;
  private failed = false;
  /** The port could not write: saves go to the UI thread as text. */
  private portFailed = false;
  /** The bot journal of this world (it only watches; see npc-journal.ts). */
  private readonly journal = new NpcJournalRecorder();
  /** Entries of worlds the UI took, not yet posted. */
  private journalOut: NpcJournalEntry[] = [];
  /** The quiet values the window has, and when it was last told new ones. */
  private readonly quiet = new QuietRegistry();
  private lastQuietAt = Number.NEGATIVE_INFINITY;
  /** The player whose reports the window holds whole, when the window holds the rest as stubs (ui-projection.ts). */
  private projectFor: string | null = null;

  private readonly host: LiveWorldEngineHost;

  constructor(host: LiveWorldEngineHost) {
    this.host = host;
    // The worker is this world's only thread: the journal stays attached.
    if (host.journal !== false) setNpcJournalSink(this.journal);
  }

  private readonly clock = () => (this.host.clock ?? (() => performance.now()))();

  /** Handles one message; a tick may run a long catch-up (other messages are handled between its chunks). */
  async handle(message: LiveWorldRequest): Promise<void> {
    if (this.failed) return;
    try {
      if (message.type === 'init') this.init(message);
      else if (message.type === 'commit') this.commit(message.from, message.to, message.patch);
      else if (message.type === 'save-now') this.save();
      else if (message.type === 'quiet-now') this.sendQuiet();
      else if (message.type === 'save-port') return;
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
    this.quiet.reset();
    this.lastQuietAt = this.host.now();
    this.persist = message.persist;
    this.projectFor = message.projectReports ? message.state.profile.playerId : null;
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
      for (const posted of this.posted.slice(0, reached + 1)) for (const entry of posted.journal) this.journalOut.push(entry);
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
    // A stub the window sent back (a short list goes whole) is its report again.
    if (this.projectFor !== null) patch = unprojectPatch(patch);
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
      this.journal.take();
      this.host.post({ type: 'ticked', from, to: from, patch: [], events, computeMs });
      return;
    }
    const to = this.version();
    this.posted.push({ from, to, state: next, journal: this.journal.take() });
    // The window gets the world with its quiet values as it has them; the rest of the difference is the patch.
    // ...and the bots' reports as the window holds them (stubs in their places).
    const project = (world: SaveState) => (this.projectFor === null ? world : projectWorld(world, this.projectFor));
    const beforeShadow = project(this.quiet.shadowOf(before));
    const patch = diffWorld(beforeShadow, project(this.quiet.shadowOf(next, before)));
    this.host.post({ type: 'ticked', from, to, patch, events, computeMs });
  }

  /** Tells the window the quiet values that changed since it was last told (a no-op when none did). */
  private sendQuiet(): void {
    if (!this.ui) return;
    this.lastQuietAt = this.host.now();
    const batch = this.quiet.collect(this.posted.at(-1)?.state ?? this.ui);
    if (batch) this.host.post({ type: 'quiet', batch });
  }

  private async tick(now: number, testTimeScale: Parameters<typeof reconcileRuntime>[1]['testTimeScale']): Promise<void> {
    const world = this.ui!;
    this.journal.observe(world, world.npcReplay?.processedThroughAt ?? now);
    if (needsNpcCatchupBefore(world, now)) {
      await this.runCatchup(world, now, testTimeScale);
      return;
    }
    const startedAt = this.clock();
    const result = reconcileRuntime(world, { planetId: world.currentPlanetId, now, mode: 'production', testTimeScale });
    const computeMs = this.clock() - startedAt;
    this.post(result.state, playerFacingEvents(result.events, world.profile.playerId), computeMs);
    if (this.host.now() - this.lastQuietAt >= QUIET_BATCH_EVERY_MS) this.sendQuiet();
    // Clock ticks only advance time, which a reload replays identically: a
    // late world is saved after a pause that grows with what a save costs.
    const interval = Math.min(this.persist.tickMaxIntervalMs, this.lastSaveCostMs * this.persist.tickCostFactor);
    this.scheduleSave(Math.max(0, this.lastSaveAt + interval - this.host.now()));
  }

  private async runCatchup(world: SaveState, now: number, testTimeScale: Parameters<typeof reconcileRuntime>[1]['testTimeScale']): Promise<void> {
    const frozen = freezeNpcCatchupTarget(world, now);
    const catchup = { rebase: [] as WorldPatch[], droppedFreeze: false };
    this.catchup = catchup;
    try {
      // The UI learns at once that commands wait (and shows the progress).
      this.post(frozen, [], 0);
      if (!isNpcCatchupPending(frozen)) return;
      // Saved at once (App may have frozen it itself; saves wait during a catch-up): a reload in the middle resumes this absence.
      this.saveText(frozen, this.posted.at(-1)?.to ?? this.uiVersion);
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
      if (catchup.droppedFreeze) {
        // App never saw the freeze (it changed its world first) and waits for this tick: start over from App's world.
        this.catchup = null;
        this.journal.take();
        await this.tick(this.host.now(), testTimeScale);
        return;
      }
      this.post(result.state, result.events, this.clock() - startedAt);
      // A caught-up world changed every bot planet's economy: the window gets it with the world.
      this.sendQuiet();
      // The caught-up world is saved at once, as posted (the UI takes it unless it changed meanwhile).
      this.saveText(result.state, this.posted.at(-1)?.to ?? this.uiVersion);
    } finally {
      this.catchup = null;
    }
  }

  private scheduleSave(delayMs: number): void {
    // A clock tick asks for a save after a pause that grows with what a save costs
    // (up to a minute on a late world); a player's command asks for one at once.
    // The earlier request wins, or the command would wait out the tick's pause.
    const dueAt = this.host.now() + delayMs;
    if (this.saveScheduled && dueAt >= this.saveDueAt) return;
    const timer = ++this.saveTimer;
    this.saveScheduled = true;
    this.saveDueAt = dueAt;
    this.host.later(() => {
      if (timer !== this.saveTimer) return;
      this.saveScheduled = false;
      this.saveDueAt = Number.POSITIVE_INFINITY;
      if (!this.failed && !this.catchup) this.save();
    }, delayMs);
  }

  /** Saves the world the UI has (never a tick it may still drop). */
  private save(): void {
    if (!this.ui || this.savedVersion === this.uiVersion) return;
    this.saveText(this.ui, this.uiVersion);
  }

  /** The port failed: the next save goes as text, and the world is saved again at once. */
  savePortFailed(): void {
    this.portFailed = true;
    this.savedVersion = -1;
    this.scheduleSave(0);
  }

  private saveText(state: SaveState, version: LiveWorldVersion): void {
    const startedAt = this.clock();
    const text = serializeSaveForStorage(state, 'production');
    let sent = false;
    // A large save goes to the main process as UTF-8 bytes; the UI thread copies nothing.
    // (Smaller ones stay in localStorage, which only the UI thread reaches.)
    if (this.host.sendSave && !this.portFailed && text.length >= (this.host.portMinChars ?? EXTERNAL_SAVE_MIN_CHARS)) {
      const bytes = new TextEncoder().encode(text);
      const computeMs = this.clock() - startedAt;
      sent = this.host.sendSave(version, bytes.buffer as ArrayBuffer, text.length, computeMs);
      this.lastSaveCostMs = computeMs;
    }
    if (!sent) {
      const computeMs = this.clock() - startedAt;
      this.lastSaveCostMs = computeMs;
      this.host.post({ type: 'save', version, text, computeMs });
    }
    this.lastSaveAt = this.host.now();
    this.savedVersion = version;
    if (this.journalOut.length) {
      this.host.post({ type: 'bot-journal', lines: formatNpcJournalLines(this.journalOut) });
      this.journalOut = [];
    }
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
