import assert from 'node:assert/strict';
import test from 'node:test';
import { applyWorldPatch, diffWorld, describePatch } from './world-diff.ts';
import { createInitialSaveState } from './persistence.ts';
import { reconcileRuntime } from './reconcile.ts';
import { campaign } from './npc-runtime.test-support.ts';

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
