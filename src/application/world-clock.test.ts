import assert from 'node:assert/strict';
import test from 'node:test';

import { reconcileRuntime } from './reconcile.ts';
import { createInitialSaveState } from './persistence.ts';
import { startBuilding } from './buildings.ts';
import { getNpcOwnerIds } from './npc-foundation.ts';
import { freezeNpcCatchupTarget, isNpcCatchupPending } from './npc-catchup.ts';
import { createNpcState } from '../domain/npc/state.ts';
import { createDefaultNewGameConfig } from '../domain/world/config.ts';
import { getPlanetResources, type SaveState } from './contracts.ts';
import { WorldClock, WORLD_CLOCK_TOLERANCE_MS, stateWorldCursor } from './world-clock.ts';

const MIN = 60_000;
const DAY = 24 * 60 * MIN;
const T0 = Date.UTC(2026, 10, 1);

function makeClock(start: number) {
  let real = start;
  const clock = new WorldClock(() => real);
  return { clock, set: (value: number) => { real = value; } };
}

test('clock jumping back never moves world time back', () => {
  const { clock, set } = makeClock(T0);
  assert.equal(clock.now(), T0);
  set(T0 + 10 * MIN);
  assert.equal(clock.now(), T0 + 10 * MIN);
  set(T0 - 7 * DAY); // PC clock set back a week
  const afterJump = clock.now();
  assert.equal(afterJump, T0 + 10 * MIN, 'world stays where it was');
  set(T0 - 7 * DAY + 5 * MIN);
  assert.equal(clock.now(), T0 + 15 * MIN, 'and goes on at normal speed from there');
  assert.equal(clock.events.at(-1)?.kind, 'jumped-back');
});

test('forward jump then back grants the time once, not twice', () => {
  const { clock, set } = makeClock(T0);
  clock.now();
  set(T0 + 7 * DAY);
  assert.equal(clock.now(), T0 + 7 * DAY, 'looks like a real absence: caught up once');
  set(T0 + MIN); // back to the true time
  assert.equal(clock.now(), T0 + 7 * DAY, 'not moved back');
  set(T0 + 2 * MIN);
  assert.equal(clock.now(), T0 + 7 * DAY + MIN, 'continues from the high point; the week is not paid again');
});

test('anchor to a save whose cursor is ahead of the clock', () => {
  const { clock } = makeClock(T0);
  clock.anchor(T0 + 7 * DAY);
  assert.equal(clock.now(), T0 + 7 * DAY);
  assert.equal(clock.events[0]?.kind, 'behind-save');
  assert.ok(clock.offsetMs() >= 7 * DAY);
});

test('small drift and damaged far-future cursors are ignored', () => {
  const { clock } = makeClock(T0);
  clock.anchor(T0 + WORLD_CLOCK_TOLERANCE_MS - 1);
  assert.equal(clock.now(), T0);
  clock.anchor(T0 + 4000 * DAY);
  assert.equal(clock.now(), T0);
  clock.anchor(Number.NaN);
  clock.anchor(0);
  assert.equal(clock.now(), T0);
});

function makeWorld(npcCount = 4) {
  const config = createDefaultNewGameConfig({ seed: 'CLOCKTEST', campaignName: 'clock test' });
  config.world = { ...config.world, galaxyCount: 1, npcCount, randomPlayerStart: false };
  const base = createInitialSaveState('production', T0, config);
  const ownerIds = npcCount ? getNpcOwnerIds(base.espionage?.targets, base.profile.playerId) : [];
  let state: SaveState = { ...base, npc: createNpcState(ownerIds, 'clock-test', T0) };
  const ctx = (now: number) => ({ planetId: state.currentPlanetId, now, mode: 'production' as const, testTimeScale: 1 as const });
  state = reconcileRuntime(state, ctx(T0 + MIN)).state;
  const catchUpTo = (target: number) => {
    state = freezeNpcCatchupTarget(state, target);
    while (isNpcCatchupPending(state)) state = reconcileRuntime(state, { ...ctx(target), replayMaxGroups: 100_000 }).state;
    state = reconcileRuntime(state, ctx(target)).state;
  };
  return { get state() { return state; }, set state(value: SaveState) { state = value; }, ctx, catchUpTo };
}

test('save 7 days ahead of the PC clock: world goes on from its cursor, short builds are not instant', () => {
  const world = makeWorld(0);
  world.state = reconcileRuntime(world.state, world.ctx(T0 + 7 * DAY)).state; // played on a clock a week ahead
  const cursor = stateWorldCursor(world.state);
  assert.equal(cursor, T0 + 7 * DAY);
  const { clock, set } = makeClock(T0 + 2 * MIN); // the PC clock is right again (a week behind)
  clock.anchor(cursor);
  const now = clock.now();
  assert.ok(now >= cursor);
  const planet = world.state.currentPlanetId;
  const levelBefore = world.state.planets[planet]!.buildings['metal-production-1'] ?? 0;
  const started = startBuilding(world.state, world.ctx(now), 'metal-production-1');
  assert.ok(started.ok);
  const item = (started.state.queues[planet] ?? [])[0]!;
  assert.ok(item.finishAt > now, 'build finishes in the future of the world clock');
  set(T0 + 2 * MIN + 1000);
  const ticked = reconcileRuntime(started.state, world.ctx(clock.now()));
  assert.equal(ticked.state.planets[planet]!.buildings['metal-production-1'] ?? 0, levelBefore, 'not finished a second later');
});

test('bots: save 6 hours ahead of the PC clock, the world goes on from the cursor', () => {
  const world = makeWorld();
  world.catchUpTo(T0 + 6 * 60 * MIN);
  const cursor = stateWorldCursor(world.state);
  const { clock, set } = makeClock(T0 + 2 * MIN);
  clock.anchor(cursor);
  set(T0 + 2 * MIN + 30_000);
  const after = reconcileRuntime(world.state, world.ctx(clock.now())).state;
  assert.ok((after.npcReplay?.processedThroughAt ?? 0) > cursor, 'bots moved on instead of standing still');
  assert.ok(!isNpcCatchupPending(after));
});

test('save 7 days behind the PC clock: caught up once; going back and forth grants nothing more', () => {
  const world = makeWorld(0);
  const { clock, set } = makeClock(T0 + 2 * MIN);
  clock.anchor(stateWorldCursor(world.state));
  const planet = world.state.currentPlanetId;
  set(T0 + 7 * DAY);
  const target = clock.now();
  world.state = reconcileRuntime(world.state, world.ctx(target)).state;
  const afterCatchup = getPlanetResources(world.state, planet);
  // clock moved back to the true time and forward again, many times
  for (let i = 0; i < 3; i += 1) {
    set(T0 + 2 * MIN);
    world.state = reconcileRuntime(world.state, world.ctx(clock.now())).state;
    set(T0 + 7 * DAY);
    world.state = reconcileRuntime(world.state, world.ctx(clock.now())).state;
  }
  const afterWiggle = getPlanetResources(world.state, planet);
  const gained = Number(afterWiggle.metal) - Number(afterCatchup.metal);
  // at most a few seconds of income, never another 7 days
  assert.ok(gained < Number(afterCatchup.metal) * 0.01 + 100, `unexpected extra metal ${gained}`);
});
