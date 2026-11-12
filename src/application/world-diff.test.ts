import assert from 'node:assert/strict';
import test from 'node:test';
import { applyWorldPatch, diffWorld, describePatch } from './world-diff.ts';
import { createInitialSaveState } from './persistence.ts';
import { reconcileRuntime } from './reconcile.ts';
import { campaign } from './npc-runtime.test-support.ts';
import { applyQuietBatch, QuietInbox, QuietRegistry } from './quiet-fields.ts';
import type { SaveState, UiWorld } from './contracts.ts';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/** What the UI thread does: a structured copy of the mirror, the patch applied to it. */
function viaMirror<T>(before: T, after: T): T {
  const mirror = structuredClone(before);
  return applyWorldPatch(mirror, structuredClone(diffWorld(before, after)));
}

function sameJson(left: unknown, right: unknown, message?: string) {
  assert.equal(JSON.stringify(left), JSON.stringify(right), message);
}

test('immutable updates come back exactly: sets, deletes, key order, appended and filtered arrays', () => {
  const records = Array.from({ length: 40 }, (_, index) => ({ id: `r${index}`, value: index }));
  const before = { a: 1, b: { c: [1, 2, 3], d: 'x' }, records, keep: { deep: { list: records.slice(0, 5) } }, gone: true, n: Number.NaN };
  const cases: unknown[] = [
    { ...before, a: 2 },
    { ...before, b: { ...before.b, c: [1, 2, 3, 4] } },
    { ...before, records: [...records, { id: 'new', value: 99 }] },
    { ...before, records: records.filter((record) => record.value % 3 !== 0) },
    { ...before, records: records.map((record) => (record.value === 17 ? { ...record, value: -1 } : record)) },
    { ...before, records: [{ id: 'front', value: 0 }, ...records.slice(5), records[0]] },
    (() => { const { gone: _gone, ...rest } = before; return { ...rest, added: { x: undefined } }; })(),
    { z: 'first', ...before },
    { ...before, '7': 'integer key', b: { d: 'x', c: before.b.c } },
    { ...before, records: [] },
    [1, 2, 3],
    { ...before, keep: { deep: { list: [...before.keep.deep.list.slice(1), { id: 'tail', value: 5 }] } } },
  ];
  for (const after of cases) {
    sameJson(viaMirror(before, after), after);
    assert.deepEqual(Object.keys(viaMirror(before, after) as object), Object.keys(after as object));
  }
  assert.equal(diffWorld(before, before).length, 0);
  assert.equal(applyWorldPatch(before, []), before);
});

test('a patch never modifies the world it is applied to', () => {
  const before = { list: [{ id: 'a' }, { id: 'b' }], map: { x: { y: 1 } } };
  const frozen = structuredClone(before);
  const after = { ...before, list: [...before.list, { id: 'c' }], map: { x: { y: 2 }, z: { y: 3 } } };
  applyWorldPatch(before, diffWorld(before, after));
  assert.deepEqual(before, frozen);
});

test('real clock ticks of a production world: the mirror stays equal and the patch stays small', () => {
  let world: ReturnType<typeof campaign> = campaign(12);
  let mirror = structuredClone(world);
  const start = world.npcReplay!.processedThroughAt;
  let values = 0;
  // Three hours of 15-second ticks: decisions, flights, spy reports, prunes.
  for (let tick = 1; tick <= 720; tick += 1) {
    const next = reconcileRuntime(world, { planetId: world.currentPlanetId, now: start + tick * 15_000, mode: 'production', testTimeScale: 1 }).state as typeof world;
    const patch = structuredClone(diffWorld(world, next));
    values += describePatch(patch).values;
    mirror = applyWorldPatch(mirror, patch);
    world = next;
    if (tick % 120 === 0) sameJson(mirror, world, `tick ${tick}`);
  }
  sameJson(mirror, world);
  assert.ok(values > 0, 'the world changed');
});

test('a fresh campaign round-trips whole through a single root patch', () => {
  const state = createInitialSaveState('production', Date.UTC(2026, 0, 1));
  const patch = diffWorld({} as typeof state, state);
  sameJson(applyWorldPatch({} as typeof state, structuredClone(patch)), state);
  assert.ok(describePatch(patch).values > 0);
});

test('quiet fields: the per-tick patch leaves them out, and after a batch the window copy equals the worker world', () => {
  let world: ReturnType<typeof campaign> = campaign(12);
  const registry = new QuietRegistry();
  // The window as App has it: a copy, patches applied, batches written in place.
  let window = structuredClone(world);
  const start = world.npcReplay!.processedThroughAt;
  let plainBytes = 0;
  let hotBytes = 0;
  let batchBytes = 0;
  let batches = 0;
  for (let tick = 1; tick <= 480; tick += 1) {
    const next = reconcileRuntime(world, { planetId: world.currentPlanetId, now: start + tick * 15_000, mode: 'production', testTimeScale: 1 }).state as typeof world;
    const hot = structuredClone(diffWorld(registry.shadowOf(world), registry.shadowOf(next, world)));
    for (const op of hot) {
      const path = op.p.join('.');
      assert.ok(!/^espionage\.targets\.[^.]+\.(resourceClock(\.|$)|resources\.(metal|minerals|gas)$|overpopulation\.lastReconciledAt$)/.test(path), `quiet leaf in the hot patch: ${path}`);
    }
    plainBytes += JSON.stringify(diffWorld(world, next)).length;
    hotBytes += JSON.stringify(hot).length;
    window = applyWorldPatch(window, hot);
    world = next;
    if (tick % 40 === 0) {
      const batch = registry.collect(world);
      if (batch) {
        const sent = structuredClone(batch);
        batchBytes += JSON.stringify(sent).length;
        batches += 1;
        applyQuietBatch([window], sent);
      }
      sameJson(window, world, `after the batch at tick ${tick}`);
    }
  }
  assert.ok(batches > 0, 'bot economies changed');
  assert.ok(hotBytes * 2 < plainBytes, `the per-tick patches are far smaller (${hotBytes} against ${plainBytes} bytes)`);
  // One batch per forty ticks, with a value per planet instead of one per planet per tick.
  assert.ok(batchBytes < plainBytes, `the batches are smaller than the patches they replace (${batchBytes} against ${plainBytes})`);
  console.log(`quiet fields, 480 ticks, 12 bots: plain patches ${plainBytes} B, hot patches ${hotBytes} B, ${batches} batches ${batchBytes} B`);
});

test('quiet fields: a window that is not told keeps only quiet values stale, and a planet new to it arrives whole', () => {
  const world = campaign(12);
  const registry = new QuietRegistry();
  const target = Object.values(world.espionage!.targets!).find((item) => item.kind === 'npc')!;
  const moved: SaveState = { ...world, espionage: { ...world.espionage!, targets: { ...world.espionage!.targets!, [target.id]: { ...target, resources: { ...target.resources, metal: target.resources.metal + 1_000, debris: 55 } } } } };
  registry.shadowOf(world);
  const patch = diffWorld(registry.shadowOf(world), registry.shadowOf(moved, world));
  // Debris is not quiet (the Universe shows it); the metal is.
  assert.deepEqual(patch.map((op) => op.p.join('.')), [`espionage.targets.${target.id}.resources.debris`]);
  const batch = registry.collect(moved)!;
  assert.deepEqual(Object.keys(batch.targets), [target.id]);
  assert.equal(batch.targets[target.id]![0], target.resources.metal + 1_000);
  assert.equal(registry.collect(moved), null, 'nothing more to tell');
});

test('quiet fields: asteroid gas travels in batches, the asteroids themselves in patches', () => {
  const asteroid = (spawnIndex: number, gasYield: number, at: number) => ({
    spawnIndex, spawnedAt: 0, movementIndex: 1, previousMoveAt: 0, nextMoveAt: 9e9, coordinate: { galaxy: 1, system: spawnIndex, position: 3 },
    gasYield, gasRatePerHour: 100, gasUpdatedAt: at, gasRemainder: at % 7,
  });
  const make = (at: number, extra = 0): SaveState => ({
    asteroidSimulation: { version: 1, processedThroughAt: at, nextSpawnIndex: 50, asteroids: [...Array.from({ length: 30 }, (_, index) => asteroid(index, 1_000 + at / 1_000 + index, at)), ...(extra ? [asteroid(99, 5_000, at)] : [])] },
  } as unknown as SaveState);
  const registry = new QuietRegistry();
  let truth = make(1_000);
  let window = structuredClone(truth);
  registry.shadowOf(truth);
  for (let tick = 2; tick <= 12; tick += 1) {
    const next = make(tick * 1_000, tick === 8 ? 1 : 0);
    const hot = structuredClone(diffWorld(registry.shadowOf(truth), registry.shadowOf(next, truth)));
    window = applyWorldPatch(window, hot);
    // Only the processed-through time and a spawned asteroid are hot: no gas value travels but the new asteroid's own.
    assert.ok(JSON.stringify(hot).length < (tick === 8 ? 2_000 : 400), `tick ${tick}: ${JSON.stringify(hot).length} bytes`);
    truth = next;
  }
  const batch = registry.collect(truth)!;
  assert.equal(Object.keys(batch.asteroids).length, 30);
  applyQuietBatch([window], structuredClone(batch));
  sameJson(window, truth);
});

test('quiet inbox: batches are written at idle in slices of at most 2 ms, in order, and flush writes the rest', () => {
  const world = campaign(12);
  const registry = new QuietRegistry();
  registry.shadowOf(world);
  const ids = Object.values(world.espionage!.targets!).filter((item) => item.kind === 'npc').map((item) => item.id);
  const bump = (by: number): SaveState => ({ ...world, espionage: { ...world.espionage!, targets: Object.fromEntries(Object.entries(world.espionage!.targets!).map(([id, item]) => [id, item.kind === 'npc' ? { ...item, resources: { ...item.resources, metal: item.resources.metal + by } } : item])) } });
  const first = registry.collect(bump(5))!;
  const second = registry.collect(bump(9))!;
  const window = structuredClone(world);
  let clock = 0;
  const queue: (() => void)[] = [];
  // Every clock read costs 1 ms: a slice stops after a few entries.
  const inbox = new QuietInbox(() => [window], (task) => { queue.push(task); }, () => (clock += 1));
  inbox.push(first);
  inbox.push(second);
  assert.equal(queue.length, 1);
  let guard = 0;
  while (queue.length && guard++ < 1_000) queue.shift()!();
  assert.ok(inbox.slices > 2, 'the work was cut into slices');
  assert.equal(inbox.pending, false);
  for (const id of ids) assert.equal(window.espionage!.targets![id]!.resources.metal, world.espionage!.targets![id]!.resources.metal + 9);
  // Flush: the rest at once.
  const third = registry.collect(bump(20))!;
  inbox.push(third);
  inbox.flush();
  for (const id of ids) assert.equal(window.espionage!.targets![id]!.resources.metal, world.espionage!.targets![id]!.resources.metal + 20);
});

test('UiWorld has none of the quiet fields, and no screen file reads them', () => {
  const world: UiWorld = campaign(12);
  const target = Object.values(world.espionage!.targets!)[0]!;
  // Compile-time: each of these lines fails to build without its @ts-expect-error.
  // @ts-expect-error a bot planet's metal is quiet
  void target.resources.metal;
  // @ts-expect-error the accrual clock is quiet
  void target.resourceClock;
  // @ts-expect-error the overpopulation clock is quiet
  void target.overpopulation?.lastReconciledAt;
  // @ts-expect-error an asteroid's gas reserve is quiet
  void world.asteroidSimulation?.asteroids[0]?.gasYield;
  void target.resources.debris;
  // Runtime: the screens' sources (.tsx and src/ui) never mention them.
  const quiet = /resourceClock|gasUpdatedAt|gasRemainder|gasRatePerHour|gasYield|lastReconciledAt/;
  const walk = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return walk(path);
    return /\.tsx$/.test(entry.name) || (/\.ts$/.test(entry.name) && !/\.test\.ts$/.test(entry.name) && path.includes(`${join('src', 'ui')}`)) ? [path] : [];
  });
  const offenders = walk('src').filter((file) => quiet.test(readFileSync(file, 'utf8')));
  assert.deepEqual(offenders, []);
});
