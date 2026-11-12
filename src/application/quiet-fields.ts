import type { SaveState } from './contracts.ts';
import type { SpyTargetState } from '../domain/espionage/types.ts';
import type { UniverseAsteroidRuntimeState } from '../domain/universe/types.ts';

/**
 * «Quiet» fields: values that change on (almost) every tick for every bot
 * planet and asteroid but that no screen shows - the bot planets' metal,
 * minerals and gas, their accrual clock and the overpopulation clock, and the
 * asteroids' gas reserve. They were 460 of the 494 KB the worker posted each
 * second, so the worker keeps them out of the per-tick patch and sends them
 * as one batch every few seconds instead (live-world-engine.ts).
 *
 * How it stays exact: the worker remembers, per planet and asteroid, the quiet
 * values it last told the window (`QuietRegistry`). The per-tick patch is the
 * difference of two worlds in which every quiet value is replaced by that
 * remembered one, so quiet-only changes make no operations. A batch carries
 * the values that differ from what was told, and the window writes them into
 * its own records (in place: no screen reads them, so nothing re-renders and
 * the window's own change detection - synced world against current world -
 * sees the same write on both sides).
 *
 * Which fields are quiet is listed here and nowhere else; `UiWorld` in
 * contracts.ts is the same list as a type.
 */

/** [metal, minerals, gas, accrual clock [reconciledAt, remainder metal, minerals, gas] | null, overpopulation.lastReconciledAt | null] */
export type QuietTargetEntry = readonly [number, number, number, readonly [number, number, number, number] | null, number | null];
/** [gasYield, gasRatePerHour | null, gasUpdatedAt | null, gasRemainder | null] */
export type QuietAsteroidEntry = readonly [number, number | null, number | null, number | null];

export type QuietBatch = {
  targets: Record<string, QuietTargetEntry>;
  asteroids: Record<number, QuietAsteroidEntry>;
};

/** Only bot planets are quiet: a player's own target record stays whole. */
function isQuietTarget(target: SpyTargetState): boolean {
  return target.kind === 'npc';
}

function targetEntryOf(target: SpyTargetState): QuietTargetEntry {
  const clock = target.resourceClock;
  return [
    target.resources.metal,
    target.resources.minerals,
    target.resources.gas,
    clock ? [clock.lastReconciledAt, clock.remainder.metal, clock.remainder.minerals, clock.remainder.gas] : null,
    target.overpopulation ? target.overpopulation.lastReconciledAt : null,
  ];
}

function asteroidEntryOf(asteroid: UniverseAsteroidRuntimeState): QuietAsteroidEntry {
  return [asteroid.gasYield, asteroid.gasRatePerHour ?? null, asteroid.gasUpdatedAt ?? null, asteroid.gasRemainder ?? null];
}

function sameEntry(left: readonly unknown[], right: readonly unknown[]): boolean {
  for (let index = 0; index < left.length; index += 1) {
    const a = left[index];
    const b = right[index];
    if (a === b) continue;
    if (Array.isArray(a) && Array.isArray(b) && sameEntry(a, b)) continue;
    return false;
  }
  return true;
}

/** Writes an entry into a record the caller owns (a copy, or the window's own record). */
function writeTargetEntry(target: SpyTargetState, entry: QuietTargetEntry): void {
  const resources = target.resources;
  resources.metal = entry[0];
  resources.minerals = entry[1];
  resources.gas = entry[2];
  const clock = entry[3];
  if (clock) {
    if (target.resourceClock) {
      target.resourceClock.lastReconciledAt = clock[0];
      target.resourceClock.remainder.metal = clock[1];
      target.resourceClock.remainder.minerals = clock[2];
      target.resourceClock.remainder.gas = clock[3];
    } else {
      target.resourceClock = { lastReconciledAt: clock[0], remainder: { metal: clock[1], minerals: clock[2], gas: clock[3] } };
    }
  }
  if (entry[4] !== null && target.overpopulation) target.overpopulation.lastReconciledAt = entry[4];
}

function writeAsteroidEntry(asteroid: UniverseAsteroidRuntimeState, entry: QuietAsteroidEntry): void {
  asteroid.gasYield = entry[0];
  const keys = ['gasRatePerHour', 'gasUpdatedAt', 'gasRemainder'] as const;
  for (let index = 0; index < keys.length; index += 1) {
    const value = entry[index + 1];
    if (value === null) delete asteroid[keys[index]!];
    else asteroid[keys[index]!] = value;
  }
}

/**
 * The same quiet fields as they are in `target`, in a copy that can be
 * written (resources, clock and overpopulation are copied one level; the rest is shared).
 */
function copyForWrite(target: SpyTargetState): SpyTargetState {
  const copy: SpyTargetState = { ...target, resources: { ...target.resources } };
  if (target.resourceClock) copy.resourceClock = { lastReconciledAt: target.resourceClock.lastReconciledAt, remainder: { ...target.resourceClock.remainder } };
  if (target.overpopulation) copy.overpopulation = { ...target.overpopulation };
  return copy;
}

/** True when the two records differ in nothing but quiet values (their structure is the same). */
function sameButQuietTarget(before: SpyTargetState, after: SpyTargetState): boolean {
  const b = before as unknown as Record<string, unknown>;
  const a = after as unknown as Record<string, unknown>;
  let keys = 0;
  for (const key in a) {
    keys += 1;
    if (key === 'resources' || key === 'resourceClock' || key === 'overpopulation') continue;
    if (a[key] !== b[key]) return false;
  }
  for (const _ in b) keys -= 1;
  if (keys !== 0) return false;
  if (Boolean(before.resourceClock) !== Boolean(after.resourceClock) || Boolean(before.overpopulation) !== Boolean(after.overpopulation)) return false;
  const rb = before.resources as unknown as Record<string, unknown>;
  const ra = after.resources as unknown as Record<string, unknown>;
  for (const key in ra) {
    if (key === 'metal' || key === 'minerals' || key === 'gas') continue;
    if (ra[key] !== rb[key]) return false;
  }
  for (const key in rb) if (!(key in ra)) return false;
  if (before.overpopulation && after.overpopulation) {
    const ob = before.overpopulation as unknown as Record<string, unknown>;
    const oa = after.overpopulation as unknown as Record<string, unknown>;
    for (const key in oa) if (key !== 'lastReconciledAt' && oa[key] !== ob[key]) return false;
    for (const key in ob) if (!(key in oa)) return false;
  }
  return true;
}

/** Equal values (asteroid records are rebuilt each tick, their small nested objects with them). */
function sameValue(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (typeof left !== 'object' || typeof right !== 'object' || !left || !right) return false;
  const l = left as Record<string, unknown>;
  const r = right as Record<string, unknown>;
  let count = 0;
  for (const key in l) {
    count += 1;
    if (!sameValue(l[key], r[key])) return false;
  }
  for (const _ in r) count -= 1;
  return count === 0;
}

function sameButQuietAsteroid(before: UniverseAsteroidRuntimeState, after: UniverseAsteroidRuntimeState): boolean {
  const b = before as unknown as Record<string, unknown>;
  const a = after as unknown as Record<string, unknown>;
  const quiet = (key: string) => key === 'gasYield' || key === 'gasRatePerHour' || key === 'gasUpdatedAt' || key === 'gasRemainder';
  for (const key in a) if (!quiet(key) && !sameValue(a[key], b[key])) return false;
  for (const key in b) if (!quiet(key) && !(key in a)) return false;
  // Whether an optional gas field exists is structure the window must see, not a value.
  return ('gasRatePerHour' in a) === ('gasRatePerHour' in b) && ('gasUpdatedAt' in a) === ('gasUpdatedAt' in b) && ('gasRemainder' in a) === ('gasRemainder' in b);
}

type ShadowMemo = {
  /** Real world -> its shadow. */
  worlds: WeakMap<SaveState, SaveState>;
  /** Real record -> its shadow record. */
  targets: WeakMap<SpyTargetState, SpyTargetState>;
  asteroids: WeakMap<UniverseAsteroidRuntimeState, UniverseAsteroidRuntimeState>;
};

function freshMemo(): ShadowMemo {
  return { worlds: new WeakMap(), targets: new WeakMap(), asteroids: new WeakMap() };
}

/**
 * The worker's memory of the quiet values the window has, and the two things
 * built from it: the shadow of a world (what the per-tick patch is made of) and
 * the batch of what changed since.
 */
export class QuietRegistry {
  private told = new Map<string, QuietTargetEntry>();
  private toldAsteroids = new Map<number, QuietAsteroidEntry>();
  private memo = freshMemo();

  /** The window starts over from this world (a load, a new campaign): it has all of it. */
  reset(): void {
    this.told = new Map();
    this.toldAsteroids = new Map();
    this.memo = freshMemo();
  }

  /**
   * `state` with every quiet value replaced by the one the window has. Where the
   * window has nothing yet (a planet or asteroid new to it) the real values are
   * taken - they travel with the record - and remembered as told. `prev` is the
   * world the patch is made from: records equal to its in all but quiet values
   * reuse its shadow records, so the diff skips them by identity.
   */
  shadowOf(state: SaveState, prev?: SaveState): SaveState {
    const cached = this.memo.worlds.get(state);
    if (cached) return cached;
    let result = state;
    const targets = state.espionage?.targets;
    if (targets) {
      const next = this.shadowTargets(targets, prev?.espionage?.targets);
      if (next !== targets) {
        const espionage = { ...state.espionage!, targets: next };
        if (state.espionage!.bot01Planets === targets) espionage.bot01Planets = next;
        result = { ...result, espionage };
      }
    }
    const simulation = state.asteroidSimulation;
    if (simulation) {
      const asteroids = this.shadowAsteroids(simulation.asteroids, prev?.asteroidSimulation?.asteroids, prev ? this.memo.worlds.get(prev)?.asteroidSimulation?.asteroids : undefined);
      if (asteroids !== simulation.asteroids) result = { ...result, asteroidSimulation: { ...simulation, asteroids } };
    }
    this.memo.worlds.set(state, result);
    return result;
  }

  private shadowTargets(targets: Record<string, SpyTargetState>, prev: Record<string, SpyTargetState> | undefined): Record<string, SpyTargetState> {
    const out: Record<string, SpyTargetState> = {};
    let any = false;
    for (const id in targets) {
      const target = targets[id]!;
      if (!isQuietTarget(target)) { out[id] = target; continue; }
      any = true;
      const known = this.memo.targets.get(target);
      if (known) { out[id] = known; continue; }
      const before = prev?.[id];
      const beforeShadow = before ? this.memo.targets.get(before) : undefined;
      if (before && beforeShadow && this.told.has(id) && sameButQuietTarget(before, target)) {
        this.memo.targets.set(target, beforeShadow);
        out[id] = beforeShadow;
        continue;
      }
      const shadow = this.shadowTarget(id, target);
      this.memo.targets.set(target, shadow);
      out[id] = shadow;
    }
    return any ? out : targets;
  }

  private shadowTarget(id: string, target: SpyTargetState): SpyTargetState {
    const actual = targetEntryOf(target);
    const had = this.told.get(id);
    // Whether there is a clock or an overpopulation episode is the world's (it travels with the record); the numbers are the window's.
    const told: QuietTargetEntry = had
      ? [had[0], had[1], had[2], actual[3] === null ? null : had[3] ?? actual[3], actual[4] === null ? null : had[4] ?? actual[4]]
      : actual;
    this.told.set(id, told);
    const copy = copyForWrite(target);
    writeTargetEntry(copy, told);
    return copy;
  }

  private shadowAsteroids(
    asteroids: UniverseAsteroidRuntimeState[],
    prev: UniverseAsteroidRuntimeState[] | undefined,
    prevShadow: UniverseAsteroidRuntimeState[] | undefined,
  ): UniverseAsteroidRuntimeState[] {
    const before = new Map<number, UniverseAsteroidRuntimeState>();
    if (prev) for (const asteroid of prev) before.set(asteroid.spawnIndex, asteroid);
    const out: UniverseAsteroidRuntimeState[] = [];
    for (const asteroid of asteroids) {
      const known = this.memo.asteroids.get(asteroid);
      if (known) { out.push(known); continue; }
      const old = before.get(asteroid.spawnIndex);
      const oldShadow = old ? this.memo.asteroids.get(old) : undefined;
      if (old && oldShadow && this.toldAsteroids.has(asteroid.spawnIndex) && sameButQuietAsteroid(old, asteroid)) {
        this.memo.asteroids.set(asteroid, oldShadow);
        out.push(oldShadow);
        continue;
      }
      const actual = asteroidEntryOf(asteroid);
      let told = this.toldAsteroids.get(asteroid.spawnIndex);
      if (!told) told = actual;
      else {
        // Presence of the optional gas fields is structure (the record's), the numbers are the window's.
        told = [told[0], actual[1] === null ? null : told[1] ?? actual[1], actual[2] === null ? null : told[2] ?? actual[2], actual[3] === null ? null : told[3] ?? actual[3]];
      }
      this.toldAsteroids.set(asteroid.spawnIndex, told);
      const copy = { ...asteroid };
      writeAsteroidEntry(copy, told);
      this.memo.asteroids.set(asteroid, copy);
      out.push(copy);
    }
    // The same elements in the same places as the previous shadow array: the same array (the diff skips it).
    if (prevShadow && prevShadow.length === out.length && out.every((item, index) => item === prevShadow[index])) return prevShadow;
    return out;
  }

  /**
   * What differs between `world` and what the window was told, as a batch; null
   * when nothing does. Afterwards the window counts as told (it applies the batch
   * after every tick posted before it).
   */
  collect(world: SaveState): QuietBatch | null {
    const batch: QuietBatch = { targets: {}, asteroids: {} };
    let count = 0;
    const targets = world.espionage?.targets;
    const liveIds = new Set<string>();
    if (targets) {
      for (const id in targets) {
        const target = targets[id]!;
        if (!isQuietTarget(target)) continue;
        liveIds.add(id);
        const actual = targetEntryOf(target);
        const told = this.told.get(id);
        if (told && sameEntry(told, actual)) continue;
        // A planet the window does not know yet gets its values with the record, not here.
        this.told.set(id, actual);
        if (told) { batch.targets[id] = actual; count += 1; }
      }
    }
    for (const id of this.told.keys()) if (!liveIds.has(id)) this.told.delete(id);
    const liveSpawns = new Set<number>();
    for (const asteroid of world.asteroidSimulation?.asteroids ?? []) {
      liveSpawns.add(asteroid.spawnIndex);
      const actual = asteroidEntryOf(asteroid);
      const told = this.toldAsteroids.get(asteroid.spawnIndex);
      if (told && sameEntry(told, actual)) continue;
      this.toldAsteroids.set(asteroid.spawnIndex, actual);
      if (told) { batch.asteroids[asteroid.spawnIndex] = actual; count += 1; }
    }
    for (const spawn of this.toldAsteroids.keys()) if (!liveSpawns.has(spawn)) this.toldAsteroids.delete(spawn);
    if (count === 0) return null;
    // Shadows were made from the old told values: made again from the new ones when next needed.
    this.memo = freshMemo();
    return batch;
  }
}

/**
 * The window's side: writes a batch into `world`'s records in place (the records
 * are the window's own; no screen reads these fields). Unknown ids are ignored.
 * Works through `keys` of the batch from `from`, for at most `budgetMs`;
 * returns where it stopped (the batch's key count when done).
 */
export type QuietApplyCursor = { targetIds: string[]; asteroidIds: string[]; at: number };

export function startQuietApply(batch: QuietBatch): QuietApplyCursor {
  return { targetIds: Object.keys(batch.targets), asteroidIds: Object.keys(batch.asteroids), at: 0 };
}

/** Applies the next entries of `batch` to every world in `worlds` until `budgetMs` has passed; true when finished. */
export function stepQuietApply(worlds: readonly SaveState[], batch: QuietBatch, cursor: QuietApplyCursor, budgetMs: number, now: () => number = () => performance.now()): boolean {
  const deadline = now() + budgetMs;
  const total = cursor.targetIds.length + cursor.asteroidIds.length;
  let sinceCheck = 0;
  while (cursor.at < total) {
    const inTargets = cursor.at < cursor.targetIds.length;
    const key = inTargets ? cursor.targetIds[cursor.at]! : cursor.asteroidIds[cursor.at - cursor.targetIds.length]!;
    const done = new Set<object>();
    for (const world of worlds) {
      if (inTargets) {
        const target = world.espionage?.targets?.[key];
        if (target && !done.has(target)) { done.add(target); writeTargetEntry(target, batch.targets[key]!); }
      } else {
        const spawn = Number(key);
        const asteroid = world.asteroidSimulation?.asteroids.find((item) => item.spawnIndex === spawn);
        if (asteroid && !done.has(asteroid)) { done.add(asteroid); writeAsteroidEntry(asteroid, batch.asteroids[spawn]!); }
      }
    }
    cursor.at += 1;
    sinceCheck += 1;
    if (sinceCheck >= 4) {
      sinceCheck = 0;
      if (now() >= deadline) break;
    }
  }
  return cursor.at >= total;
}

/** Applies a whole batch at once (tests, and the flush before a save from the window). */
export function applyQuietBatch(worlds: readonly SaveState[], batch: QuietBatch): void {
  const cursor = startQuietApply(batch);
  stepQuietApply(worlds, batch, cursor, Number.POSITIVE_INFINITY);
}

/** Longest time one idle slice of a batch may take on the window's thread. */
export const QUIET_APPLY_SLICE_MS = 2;

type IdleScheduler = (task: () => void) => void;

const defaultIdle: IdleScheduler = (task) => {
  if (typeof requestIdleCallback === 'function') requestIdleCallback(() => task(), { timeout: 2_000 });
  else setTimeout(task, 0);
};

/**
 * The window's inbox for batches: they are written into the world at idle, in
 * slices of at most QUIET_APPLY_SLICE_MS, in the order they arrived; `flush`
 * writes what is left at once (before a save made from the window).
 */
export class QuietInbox {
  private readonly queue: { batch: QuietBatch; cursor: QuietApplyCursor }[] = [];
  private scheduled = false;
  /** Slices run so far and the longest one (QA and tests read these). */
  slices = 0;
  maxSliceMs = 0;

  private readonly worlds: () => readonly SaveState[];
  private readonly idle: IdleScheduler;
  private readonly now: () => number;
  private readonly onSlice: ((ms: number) => void) | undefined;

  constructor(worlds: () => readonly SaveState[], idle: IdleScheduler = defaultIdle, now: () => number = () => performance.now(), onSlice?: (ms: number) => void) {
    this.onSlice = onSlice;
    this.worlds = worlds;
    this.idle = idle;
    this.now = now;
  }

  get pending(): boolean { return this.queue.length > 0; }

  push(batch: QuietBatch): void {
    this.queue.push({ batch, cursor: startQuietApply(batch) });
    this.schedule();
  }

  flush(): void {
    for (const item of this.queue.splice(0)) stepQuietApply(this.worlds(), item.batch, item.cursor, Number.POSITIVE_INFINITY, this.now);
  }

  /** Drops what is waiting (the window left this world). */
  clear(): void {
    this.queue.length = 0;
  }

  private schedule(): void {
    if (this.scheduled || !this.queue.length) return;
    this.scheduled = true;
    this.idle(() => {
      this.scheduled = false;
      const startedAt = this.now();
      const head = this.queue[0];
      if (head && stepQuietApply(this.worlds(), head.batch, head.cursor, QUIET_APPLY_SLICE_MS, this.now)) this.queue.shift();
      this.slices += 1;
      const took = this.now() - startedAt;
      this.maxSliceMs = Math.max(this.maxSliceMs, took);
      this.onSlice?.(took);
      this.schedule();
    });
  }
}
