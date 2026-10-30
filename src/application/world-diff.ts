/**
 * Record-level differences between two worlds. Saves are immutable: an update
 * copies the path it changes and shares everything else, so the difference
 * of two consecutive worlds is found by following only the objects that are
 * not identical, and a clock tick that touched a few flights and one report
 * produces a patch of a few records instead of a copy of tens of megabytes.
 *
 * The live world worker posts these patches to the UI thread (and the UI
 * thread posts the player's changes back). Applying a patch to a world equal
 * to the one it was made from gives a world equal to the target: same
 * values, same key order, same array order (world-diff.test.ts checks this
 * against JSON on real ticks of late worlds).
 */

export type PatchPath = readonly (string | number)[];

/** One change: set a value, delete a key, rebuild an array from runs, or restore a key order. */
export type PatchOp =
  | { readonly p: PatchPath; readonly v: unknown }
  | { readonly p: PatchPath; readonly d: 1 }
  /**
   * The array at `p` becomes the concatenation of `r`: a number pair
   * [start, length] copies a run of the old array, an array of one element
   * array [[...values]] inserts new values.
   */
  | { readonly p: PatchPath; readonly r: readonly (readonly [number, number] | readonly [readonly unknown[]])[] }
  /** The object at `p` takes this key order (set after its other ops). */
  | { readonly p: PatchPath; readonly k: readonly string[] };

export type WorldPatch = readonly PatchOp[];

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isContainer(value: unknown): value is object {
  return value !== null && typeof value === 'object';
}

/** Arrays shorter than this are sent whole when they change: runs would not save anything. */
const SMALL_ARRAY = 8;

function diffArray(before: readonly unknown[], after: readonly unknown[], path: (string | number)[], ops: PatchOp[]): void {
  if (after.length < SMALL_ARRAY && before.length < SMALL_ARRAY) {
    // Same length: element changes go deeper (one record of a short list).
    if (before.length === after.length) {
      for (let index = 0; index < after.length; index += 1) diffValue(before[index], after[index], [...path, index], ops);
      return;
    }
    ops.push({ p: [...path], v: after });
    return;
  }
  // Same length and mostly the same elements in place: positional changes.
  if (before.length === after.length) {
    let changed = 0;
    for (let index = 0; index < after.length && changed <= 16; index += 1) if (before[index] !== after[index]) changed += 1;
    if (changed <= 16) {
      for (let index = 0; index < after.length; index += 1) {
        if (before[index] !== after[index]) diffValue(before[index], after[index], [...path, index], ops);
      }
      return;
    }
  }
  // Otherwise runs of the old array (appended, filtered, replaced records keep
  // their place relative to the others) plus the new elements.
  const firstIndex = new Map<unknown, number>();
  for (let index = before.length - 1; index >= 0; index -= 1) firstIndex.set(before[index], index);
  const runs: ([number, number] | [unknown[]])[] = [];
  let inserted: unknown[] | null = null;
  let runStart = -1;
  let runLength = 0;
  const closeRun = () => {
    if (runLength > 0) runs.push([runStart, runLength]);
    runLength = 0;
  };
  for (let index = 0; index < after.length; index += 1) {
    const item = after[index];
    if (runLength > 0 && runStart + runLength < before.length && before[runStart + runLength] === item) {
      runLength += 1;
      continue;
    }
    const found = firstIndex.get(item);
    if (found !== undefined && (isContainer(item) || before[found] === item)) {
      closeRun();
      inserted = null;
      runStart = found;
      runLength = 1;
      continue;
    }
    closeRun();
    if (!inserted) {
      inserted = [];
      runs.push([inserted]);
    }
    inserted.push(item);
  }
  closeRun();
  ops.push({ p: [...path], r: runs });
}

function diffValue(before: unknown, after: unknown, path: (string | number)[], ops: PatchOp[]): void {
  if (before === after) return;
  if (Array.isArray(before) && Array.isArray(after)) {
    diffArray(before, after, path, ops);
    return;
  }
  if (!isRecord(before) || !isRecord(after)) {
    // A primitive changed, or the kind of value did: a NaN stays NaN either way.
    if (typeof before === 'number' && typeof after === 'number' && Number.isNaN(before) && Number.isNaN(after)) return;
    ops.push({ p: [...path], v: after });
    return;
  }
  const beforeKeys = Object.keys(before);
  const afterKeys = Object.keys(after);
  for (const key of afterKeys) {
    if (!Object.prototype.hasOwnProperty.call(before, key)) ops.push({ p: [...path, key], v: after[key] });
    else if (before[key] !== after[key]) diffValue(before[key], after[key], [...path, key], ops);
  }
  for (const key of beforeKeys) {
    if (!Object.prototype.hasOwnProperty.call(after, key)) ops.push({ p: [...path, key], d: 1 });
  }
  // Kept keys keep their place and new ones are appended: anything else needs the order itself.
  let index = 0;
  let ordered = true;
  for (const key of beforeKeys) {
    if (!Object.prototype.hasOwnProperty.call(after, key)) continue;
    if (afterKeys[index] !== key) { ordered = false; break; }
    index += 1;
  }
  if (ordered) {
    for (const key of afterKeys) {
      if (Object.prototype.hasOwnProperty.call(before, key)) continue;
      if (afterKeys[index] !== key) { ordered = false; break; }
      index += 1;
    }
  }
  if (!ordered) ops.push({ p: [...path], k: afterKeys });
}

/** The changes that turn `before` into `after` (both worlds, `after` usually derived from `before`). */
export function diffWorld<T>(before: T, after: T): WorldPatch {
  const ops: PatchOp[] = [];
  diffValue(before, after, [], ops);
  return ops;
}

function copyOf(value: unknown): unknown {
  if (Array.isArray(value)) return value.slice();
  return { ...(value as Record<string, unknown>) };
}

function setOwn(target: Record<string, unknown> | unknown[], key: string | number, value: unknown): void {
  if (key === '__proto__' && !Array.isArray(target)) {
    Object.defineProperty(target, key, { value, enumerable: true, writable: true, configurable: true });
    return;
  }
  (target as Record<string | number, unknown>)[key] = value;
}

/**
 * `base` with the patch applied. Containers on changed paths are copied once
 * (base is never modified), everything else is shared with `base`.
 */
export function applyWorldPatch<T>(base: T, patch: WorldPatch): T {
  if (!patch.length) return base;
  const copies = new WeakSet<object>();
  const root: { value: unknown } = { value: base };
  // The (copied) container at `path`, copying containers on the way.
  const containerAt = (path: PatchPath, upTo: number): Record<string | number, unknown> => {
    if (!copies.has(root.value as object)) {
      root.value = copyOf(root.value);
      copies.add(root.value as object);
    }
    let node = root.value as Record<string | number, unknown>;
    for (let index = 0; index < upTo; index += 1) {
      const key = path[index]!;
      let child = node[key];
      if (!isContainer(child)) throw new Error(`World patch: no container at ${path.slice(0, index + 1).join('.')}`);
      if (!copies.has(child)) {
        child = copyOf(child);
        copies.add(child as object);
        setOwn(node, key, child);
      }
      node = child as Record<string | number, unknown>;
    }
    return node;
  };
  for (const op of patch) {
    if ('v' in op) {
      // Inserted values are not marked as copies: they may be shared with the
      // world the patch was made from (in-process), so a later op copies them.
      if (!op.p.length) {
        root.value = op.v;
        continue;
      }
      setOwn(containerAt(op.p, op.p.length - 1), op.p[op.p.length - 1]!, op.v);
    } else if ('d' in op) {
      delete containerAt(op.p, op.p.length - 1)[op.p[op.p.length - 1]!];
    } else if ('r' in op) {
      const parent = op.p.length ? containerAt(op.p, op.p.length - 1) : null;
      const old = (parent ? parent[op.p[op.p.length - 1]!] : root.value) as unknown[];
      const next: unknown[] = [];
      for (const run of op.r) {
        if (run.length === 1) for (const item of run[0]) next.push(item);
        else for (let index = run[0]; index < run[0] + run[1]; index += 1) next.push(old[index]);
      }
      copies.add(next);
      if (parent) setOwn(parent, op.p[op.p.length - 1]!, next);
      else root.value = next;
    } else {
      const parent = op.p.length ? containerAt(op.p, op.p.length - 1) : null;
      const current = containerAt(op.p, op.p.length) as Record<string, unknown>;
      const ordered: Record<string, unknown> = {};
      for (const key of op.k) setOwn(ordered, key, current[key]);
      copies.add(ordered);
      if (parent) setOwn(parent, op.p[op.p.length - 1]!, ordered);
      else root.value = ordered;
    }
  }
  return root.value as T;
}

/** Patch size in operations and inserted values (for diagnostics and tests). */
export function describePatch(patch: WorldPatch): { ops: number; values: number } {
  let values = 0;
  for (const op of patch) {
    if ('v' in op) values += 1;
    else if ('r' in op) for (const run of op.r) if (run.length === 1) values += run[0].length;
  }
  return { ops: patch.length, values };
}
