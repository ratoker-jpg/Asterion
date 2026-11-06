/**
 * Notices for finished buildings. A new colony finishes many short builds in a
 * row; each used to raise its own toast and sound. Now:
 * - builds shorter than five minutes (as the player sees the time) finish quietly;
 * - completions that arrive within a few seconds of each other become one notice;
 * - long builds still get their notice.
 * Pure: the screen keeps the batch and the timer, this module decides the text.
 */
export const QUIET_BUILD_MS = 5 * 60_000;
/** Completions closer than this to the previous one join its notice. */
export const BUILD_NOTICE_WINDOW_MS = 4_000;
/** However busy the stream, a notice is never held back longer than this. */
export const BUILD_NOTICE_MAX_WAIT_MS = 12_000;

export type BuildCompletion = {
  planetId: string;
  planetName: string;
  name: string;
  /** Build time as the player saw it; unknown (an old save) counts as long. */
  durationMs?: number;
  at: number;
};

export type BuildNoticeBatch = { items: BuildCompletion[]; firstAt: number; lastAt: number };

export function isBuildWorthNotice(item: Pick<BuildCompletion, 'durationMs'>): boolean {
  return item.durationMs == null || item.durationMs >= QUIET_BUILD_MS;
}

/** Adds a completion to the waiting batch; a short build is dropped. */
export function addBuildCompletion(batch: BuildNoticeBatch | null, item: BuildCompletion): BuildNoticeBatch | null {
  if (!isBuildWorthNotice(item)) return batch;
  if (!batch) return { items: [item], firstAt: item.at, lastAt: item.at };
  return { items: [...batch.items, item], firstAt: batch.firstAt, lastAt: Math.max(batch.lastAt, item.at) };
}

/** When the batch should be shown: a quiet moment after the last completion, or the longest wait. */
export function buildNoticeDueAt(batch: BuildNoticeBatch): number {
  return Math.min(batch.lastAt + BUILD_NOTICE_WINDOW_MS, batch.firstAt + BUILD_NOTICE_MAX_WAIT_MS);
}

function countWord(count: number): string {
  const tens = count % 100;
  const units = count % 10;
  if (tens >= 11 && tens <= 14) return 'построек';
  if (units === 1) return 'постройка';
  if (units >= 2 && units <= 4) return 'постройки';
  return 'построек';
}

/** One notice for the whole batch, or null when nothing is left to say. */
export function buildNoticeText(batch: BuildNoticeBatch | null): string | null {
  if (!batch?.items.length) return null;
  const { items } = batch;
  if (items.length === 1) return `${items[0]!.planetName}: постройка завершена — ${items[0]!.name}.`;
  const planets = [...new Set(items.map((item) => item.planetId))];
  const names = [...new Set(items.map((item) => item.name))];
  const shown = names.length > 4 ? `${names.slice(0, 3).join(', ')} и ещё ${names.length - 3}` : names.join(', ');
  if (planets.length === 1) return `${items[0]!.planetName}: готово ${items.length} ${countWord(items.length)} — ${shown}.`;
  return `Готово ${items.length} ${countWord(items.length)} на ${planets.length} планетах — ${shown}.`;
}
