/**
 * JSON.stringify for saves, reusing the text of unchanged parts. A late
 * campaign is ~58 million characters, and a clock tick replaces only a few of
 * its objects (saves are immutable: an update copies the path it changes and
 * shares the rest), so the autosave stringified tens of megabytes it had
 * already written. Objects at MEMO_DEPTH (one espionage report, one flight,
 * one target...) keep their text by identity; the levels above are joined by
 * hand. The output is byte-identical to JSON.stringify(value).
 */

/** state → section → collection → entry: the entries are cached. */
const MEMO_DEPTH = 3;
/** Entries between two chances to pause a sliced serialization. */
const ENTRIES_PER_STEP = 128;
const entryJson = new WeakMap<object, string>();

function isPlain(value: unknown): value is object {
  return value !== null && typeof value === 'object' && typeof (value as { toJSON?: unknown }).toJSON !== 'function';
}

function entry(value: unknown): string | undefined {
  if (!isPlain(value)) return JSON.stringify(value);
  let text = entryJson.get(value);
  if (text === undefined) entryJson.set(value, text = JSON.stringify(value));
  return text;
}

/** Yields every ENTRIES_PER_STEP entries; returns the text. */
function* part(value: object, depth: number, step: { entries: number }): Generator<void, string> {
  const child = function* (item: unknown): Generator<void, string | undefined> {
    if (depth + 1 >= MEMO_DEPTH || !isPlain(item)) {
      if ((step.entries += 1) % ENTRIES_PER_STEP === 0) yield;
      return entry(item);
    }
    return yield* part(item, depth + 1, step);
  };
  if (Array.isArray(value)) {
    const items: string[] = [];
    for (const item of value) items.push((yield* child(item)) ?? 'null');
    return `[${items.join(',')}]`;
  }
  const fields: string[] = [];
  for (const key of Object.keys(value)) {
    const text = yield* child((value as Record<string, unknown>)[key]);
    if (text !== undefined) fields.push(`${JSON.stringify(key)}:${text}`);
  }
  return `{${fields.join(',')}}`;
}

export function stringifySave(value: object): string {
  const run = part(value, 0, { entries: 0 });
  for (;;) {
    const next = run.next();
    if (next.done) return next.value;
  }
}

/**
 * The same text, computed in steps of about `budgetMs` with `pause()` between
 * them, so a late-game autosave does not hold the UI thread for one long task.
 * Safe because saves are immutable. `computeMs` is the time spent computing.
 */
export async function stringifySaveInSlices(value: object, budgetMs: number, pause: () => Promise<void>): Promise<{ text: string; computeMs: number }> {
  const run = part(value, 0, { entries: 0 });
  let computeMs = 0;
  for (;;) {
    const startedAt = performance.now();
    for (;;) {
      const next = run.next();
      if (next.done) return { text: next.value, computeMs: computeMs + performance.now() - startedAt };
      if (performance.now() - startedAt >= budgetMs) break;
    }
    computeMs += performance.now() - startedAt;
    await pause();
  }
}
