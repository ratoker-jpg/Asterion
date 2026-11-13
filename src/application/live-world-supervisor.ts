/**
 * Who keeps the live world worker alive (see live-world-engine.ts, App.tsx).
 *
 * A failed world patch, a worker error or a hung worker used to switch the
 * worker off until the game was restarted, and the late world then ran in the
 * window. Now the window restarts the worker from the last good world it has
 * (the mirror it renders), a few times; only a worker that keeps failing is
 * given up for a cool-down, after which it is tried again.
 */

/** Failures inside this window count together. */
export const WORKER_FAILURE_WINDOW_MS = 10 * 60_000;
/** More restarts than this inside the window: the world runs in the window for a while. */
export const WORKER_MAX_RESTARTS = 3;
/** How long a worker that keeps failing is left alone before the next try. */
export const WORKER_COOLDOWN_MS = 5 * 60_000;
/** A tick unanswered, with no sign of life from the worker (replies, progress), for this long means it hangs. */
export const WORKER_HANG_AFTER_MS = 30_000;

export type WorkerFailureDecision =
  | { action: 'restart'; restartsInWindow: number }
  | { action: 'fallback'; retryAt: number };

export class LiveWorldSupervisor {
  private failures: number[] = [];
  private retryAt = 0;

  /** A failure at `at` (any monotonic clock, ms): restart now, or give the worker up for a while. */
  onFailure(at: number): WorkerFailureDecision {
    this.failures = this.failures.filter((time) => at - time < WORKER_FAILURE_WINDOW_MS);
    this.failures.push(at);
    if (this.failures.length > WORKER_MAX_RESTARTS) {
      this.retryAt = at + WORKER_COOLDOWN_MS;
      this.failures = [];
      return { action: 'fallback', retryAt: this.retryAt };
    }
    return { action: 'restart', restartsInWindow: this.failures.length };
  }

  /** True while the worker is given up; false once the cool-down is over (the next tick may start it again). */
  inCooldown(at: number): boolean {
    return at < this.retryAt;
  }

  /** Whether a tick sent at `tickSentAt`, last heard from at `lastHeardAt`, has hung. */
  static isHung(at: number, tickInFlight: boolean, tickSentAt: number, lastHeardAt: number): boolean {
    return tickInFlight && at - Math.max(tickSentAt, lastHeardAt) > WORKER_HANG_AFTER_MS;
  }
}

/**
 * Runs `step` (e.g. applying a world patch the worker sent). A throw is not
 * allowed to leave the window and the worker on different worlds: it goes to
 * `onFailure` (which restarts the worker) and the result is undefined.
 */
export function guardWorkerStep<T>(step: () => T, onFailure: (reason: string) => void): T | undefined {
  try {
    return step();
  } catch (error) {
    onFailure(error instanceof Error ? error.message : String(error));
    return undefined;
  }
}
