/**
 * Frame meter (perf PR 1). Pure core: a ring buffer of requestAnimationFrame
 * intervals and the numbers read from it. No DOM and no timers here, so it is
 * testable and costs one array write per frame. The overlay that shows it lives
 * in frame-meter-overlay.ts. Nothing in the simulation or the saves touches it.
 */

/** A frame longer than this misses a 120 Hz display (8.33 ms) and counts as a miss. */
export const FRAME_BUDGET_120_MS = 8.4;
export const FRAME_BUDGET_60_MS = 16.7;
export const FRAME_BUDGET_30_MS = 33;
/** Length of the window the numbers are read over. */
export const FRAME_WINDOW_MS = 5_000;
/** Room for 5 s at 165 Hz plus slack. */
export const FRAME_RING_SIZE = 1_024;

export type FrameMeterSnapshot = {
  /** Frames in the window. */
  frames: number;
  fps: number | null;
  /** Median frame interval, to tell a 60 Hz display from a missed 120 Hz one. */
  medianMs: number | null;
  worstMs: number | null;
  over8: number;
  over16: number;
  over33: number;
};

export class FrameMeter {
  private readonly stamps = new Float64Array(FRAME_RING_SIZE);
  private readonly intervals = new Float32Array(FRAME_RING_SIZE);
  private head = 0;
  private size = 0;
  private last = 0;

  /** Called from requestAnimationFrame with its timestamp. */
  record(now: number): void {
    if (this.last > 0) {
      this.stamps[this.head] = now;
      this.intervals[this.head] = now - this.last;
      this.head = (this.head + 1) % FRAME_RING_SIZE;
      if (this.size < FRAME_RING_SIZE) this.size += 1;
    }
    this.last = now;
  }

  /** Forget everything (the loop was paused: the first interval would be the pause). */
  reset(): void {
    this.head = 0;
    this.size = 0;
    this.last = 0;
  }

  snapshot(now: number, windowMs = FRAME_WINDOW_MS): FrameMeterSnapshot {
    const from = now - windowMs;
    const picked: number[] = [];
    let worst = 0;
    let over8 = 0;
    let over16 = 0;
    let over33 = 0;
    for (let step = 1; step <= this.size; step += 1) {
      const index = (this.head - step + FRAME_RING_SIZE) % FRAME_RING_SIZE;
      if (this.stamps[index] < from) break;
      const interval = this.intervals[index];
      picked.push(interval);
      if (interval > worst) worst = interval;
      if (interval > FRAME_BUDGET_120_MS) over8 += 1;
      if (interval > FRAME_BUDGET_60_MS) over16 += 1;
      if (interval > FRAME_BUDGET_30_MS) over33 += 1;
    }
    if (picked.length === 0) return { frames: 0, fps: null, medianMs: null, worstMs: null, over8: 0, over16: 0, over33: 0 };
    const total = picked.reduce((sum, value) => sum + value, 0);
    picked.sort((a, b) => a - b);
    return {
      frames: picked.length,
      fps: total > 0 ? (picked.length / total) * 1_000 : null,
      medianMs: picked[Math.floor(picked.length / 2)],
      worstMs: worst,
      over8,
      over16,
      over33,
    };
  }
}

export type FrameMeterText = { fps: string; worst: string; over8: string; over16: string; longTasks: string; hz60: boolean };

/** The numbers as shown in the overlay. */
export function formatFrameMeter(snapshot: FrameMeterSnapshot, longTasks: number): FrameMeterText {
  const one = (value: number) => value.toFixed(1).replace('.', ',');
  return {
    fps: snapshot.fps === null ? '—' : String(Math.round(snapshot.fps)),
    worst: snapshot.worstMs === null ? '—' : `${one(snapshot.worstMs)} мс`,
    over8: String(snapshot.over8),
    over16: String(snapshot.over16),
    longTasks: String(longTasks),
    // Every frame of a 60 Hz display is over 8.4 ms: say so instead of looking broken.
    hz60: snapshot.medianMs !== null && snapshot.medianMs > 14 && snapshot.medianMs < 19,
  };
}
