/**
 * Single-entry memo keyed on the identity of its inputs. The world is rebuilt
 * once a second but most of its sections keep their references, so a
 * derived value that reads only a few sections can be reused until one of
 * those sections is replaced.
 */
export type RefMemo<T> = (inputs: readonly unknown[], compute: () => T) => T;

export function sameRefs(left: readonly unknown[] | null, right: readonly unknown[]): boolean {
  if (!left || left.length !== right.length) return false;
  for (let index = 0; index < right.length; index += 1) {
    if (!Object.is(left[index], right[index])) return false;
  }
  return true;
}

export function createRefMemo<T>(): RefMemo<T> {
  let lastInputs: readonly unknown[] | null = null;
  let lastValue: T;
  return (inputs, compute) => {
    if (lastInputs && sameRefs(lastInputs, inputs)) return lastValue;
    const value = compute();
    lastInputs = inputs;
    lastValue = value;
    return value;
  };
}

/** The 5 s bucket a slow-changing readout is recomputed on. */
export const SLOW_BUCKET_MS = 5_000;
export function slowBucket(now: number): number {
  return Math.floor(now / SLOW_BUCKET_MS);
}
