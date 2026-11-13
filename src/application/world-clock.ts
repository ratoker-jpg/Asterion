/**
 * The world clock: the one «now» every game timer uses (builds, flights, bots,
 * resources).
 *
 * The PC clock can be wrong or can jump. The world must not follow it blindly:
 *  - Clock BEHIND the save (set back, or the save was made on a computer whose
 *    clock ran ahead, or a cloud world the server lived ahead of this PC): the
 *    world carries on from where it stopped at normal speed. The missing gap is
 *    never replayed, so nothing is granted twice and bots do not stand still
 *    waiting for the real time to catch up.
 *  - Clock jumps BACK while playing: same rule, time never runs backwards.
 *  - Clock jumps FORWARD: indistinguishable from a real absence, so the usual
 *    catch-up runs, once. Moving it back afterwards does not grant it again.
 *
 * Implementation: world time = real time + offset, never below the last value
 * handed out. The offset only grows: it takes up every backward jump and every
 * save whose world cursor is ahead of the real clock.
 */

/** A cursor this far ahead of the real clock counts as «the clock is behind» (ticks round a little). */
export const WORLD_CLOCK_TOLERANCE_MS = 2_000;

/** A cursor further ahead than this is a damaged save, not a clock to follow. */
export const WORLD_CLOCK_MAX_FOLLOW_MS = 366 * 24 * 3_600_000;

export type WorldClockSource = () => number;

export type WorldClockEvent =
  | { kind: 'behind-save'; gapMs: number }
  | { kind: 'jumped-back'; gapMs: number };

export class WorldClock {
  private offset = 0;
  private lastReal: number | null = null;
  private lastWorld = 0;
  private readonly source: WorldClockSource;
  /** What the clock noticed (for the log and the player note). */
  readonly events: WorldClockEvent[] = [];

  constructor(source: WorldClockSource = () => Date.now()) {
    this.source = source;
  }

  /** The world time now; never lower than any earlier answer. */
  now(): number {
    const real = this.source();
    if (this.lastReal !== null && real < this.lastReal - WORLD_CLOCK_TOLERANCE_MS) {
      // The PC clock jumped back: keep the world where it was.
      const gap = this.lastReal - real;
      this.offset += gap;
      this.note({ kind: 'jumped-back', gapMs: gap });
    }
    this.lastReal = real;
    const world = Math.max(real + this.offset, this.lastWorld);
    this.lastWorld = world;
    return world;
  }

  /**
   * Tells the clock where the world stands (the replay cursor or the last
   * resource settlement of a loaded or adopted save). A cursor ahead of the
   * real clock moves the offset so that the world continues from it.
   */
  anchor(cursor: number): void {
    if (!Number.isFinite(cursor) || cursor <= 0) return;
    const world = this.now();
    if (cursor > world + WORLD_CLOCK_TOLERANCE_MS && cursor <= world + WORLD_CLOCK_MAX_FOLLOW_MS) {
      this.note({ kind: 'behind-save', gapMs: cursor - world });
      this.offset += cursor - world;
      this.lastWorld = Math.max(this.lastWorld, cursor);
    }
  }

  /** World time minus the real clock right now. */
  offsetMs(): number {
    return this.now() - this.source();
  }

  private note(event: WorldClockEvent): void {
    this.events.push(event);
    if (this.events.length > 20) this.events.shift();
  }
}

const shared = new WorldClock();

/** The world time for every timer in the game (use instead of Date.now()). */
export function worldNow(): number {
  return shared.now();
}

/** World time minus the real clock: the worker adds it to its own Date.now(). */
export function worldClockOffsetMs(): number {
  return shared.offsetMs();
}

/** Anchors the shared clock to a loaded or ticking save. */
export function anchorWorldClockToState(state: {
  npcReplay?: { processedThroughAt?: number } | undefined;
  resourceClock?: { lastReconciledAt?: number; byPlanet?: Record<string, { lastReconciledAt?: number }> | undefined } | undefined;
}): void {
  shared.anchor(stateWorldCursor(state));
}

export function stateWorldCursor(state: {
  npcReplay?: { processedThroughAt?: number } | undefined;
  resourceClock?: { lastReconciledAt?: number; byPlanet?: Record<string, { lastReconciledAt?: number }> | undefined } | undefined;
}): number {
  const valid = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) ? value : 0);
  let cursor = Math.max(valid(state.npcReplay?.processedThroughAt), valid(state.resourceClock?.lastReconciledAt));
  for (const entry of Object.values(state.resourceClock?.byPlanet ?? {})) cursor = Math.max(cursor, valid(entry?.lastReconciledAt));
  return cursor;
}

export function worldClockEvents(): readonly WorldClockEvent[] {
  return shared.events;
}
