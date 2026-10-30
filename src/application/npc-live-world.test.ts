// The cloud server keeps a world alive in small steps while the player is
// away (npc-live-world.ts); the player then takes that world instead of
// running the catch-up locally. Both must be the same world: the live steps,
// a checkpoint save/load between them and a local catch-up of the same length
// from the same save give the same result on the un-isolated full world.
import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { freezeNpcCatchupTarget } from './npc-catchup.ts';
import { runNpcCatchup } from './npc-catchup-runner.ts';
import { advanceLiveWorld, beginLiveWorld, finishLiveWorld } from './npc-live-world.ts';
import { createInitialSaveState, createPersistenceFacade, serializeSaveForStorage } from './persistence.ts';
import { memoryStorage } from './npc-runtime.test-support.ts';
import { getNpcOwnerIds } from './npc-foundation.ts';
import { createNpcState } from '../domain/npc/state.ts';
import { createDefaultNewGameConfig } from '../domain/world/config.ts';
import type { SaveState } from './contracts.ts';

const MINUTE = 60_000;
const START_AT = Date.UTC(2026, 0, 1);
const HORIZON_MS = 90 * MINUTE;

function fullWorld(): SaveState {
  const config = createDefaultNewGameConfig({ seed: 'NPCREPLAYQA2026', campaignName: 'NPC full-world QA' });
  config.world = { ...config.world, galaxyCount: 10, npcCount: 100, randomPlayerStart: false };
  const base = createInitialSaveState('production', START_AT, config);
  const ownerIds = getNpcOwnerIds(base.espionage?.targets, base.profile.playerId);
  return { ...base, npc: createNpcState(ownerIds, 'npc-replay-benchmark-persona-salt-v1', START_AT) };
}

/** What the server stores and the client applies: the save text. */
const digest = (state: SaveState) => createHash('sha256').update(serializeSaveForStorage(state, 'production')).digest('hex');

function reload(state: SaveState, at: number): SaveState {
  const facade = createPersistenceFacade({ mode: 'production', storage: memoryStorage(), saveKey: 'npc-live-world', now: () => at });
  assert.equal(facade.write(state).ok, true);
  const loaded = facade.load();
  assert.equal(loaded.status, 'loaded');
  return loaded.status === 'loaded' ? loaded.state : state;
}

/** The save as the client uploads it and the server loads it. */
const left = reload(fullWorld(), START_AT);
const targetAt = left.npcReplay!.processedThroughAt + HORIZON_MS;

test('a world kept alive in small steps is the local catch-up of the same length, byte for byte', async () => {
  const local = await runNpcCatchup(freezeNpcCatchupTarget(left, targetAt), { now: () => targetAt });

  let live = beginLiveWorld(left);
  let groups: number | undefined;
  // Uneven steps: the server ticks every few seconds, sometimes late.
  const steps = [5_000, 15_000, 15_000, 47_000, 15_000, 3 * MINUTE, 15_000, 11 * MINUTE];
  let at = left.npcReplay!.processedThroughAt;
  for (let index = 0; at < targetAt; index += 1) {
    at = Math.min(targetAt, at + steps[index % steps.length]!);
    const step = advanceLiveWorld(live, at, { groups });
    assert.equal(step.caughtUp, true);
    live = step.state;
    groups = step.groups;
    assert.equal(live.npcReplay?.summary?.finishedAt, undefined, 'the absence stays open while the server holds the world');
  }
  const handed = finishLiveWorld(live, left);
  assert.equal(handed.npcReplay?.processedThroughAt, targetAt);
  assert.equal(handed.npcReplay?.summary?.fromAt, left.npcReplay!.processedThroughAt);
  assert.equal(handed.npcReplay?.summary?.finishedAt, targetAt);
  assert.equal(digest(handed), digest(local.state), 'server steps and a local catch-up give the same save');
});

test('a server checkpoint (save, restart, load) in the middle of the absence changes nothing', async () => {
  const middle = left.npcReplay!.processedThroughAt + 40 * MINUTE;
  const first = advanceLiveWorld(beginLiveWorld(left), middle, { budgetMs: 2_000 });
  // A step that ran out of budget is simply continued on the next tick.
  let live = first.state;
  while (!advanceLiveWorld(live, middle).caughtUp) live = advanceLiveWorld(live, middle).state;
  live = advanceLiveWorld(live, middle).state;
  const resumed = reload(live, middle);
  const finished = finishLiveWorld(advanceLiveWorld(resumed, targetAt).state, left);
  const uninterrupted = finishLiveWorld(advanceLiveWorld(advanceLiveWorld(beginLiveWorld(left), middle).state, targetAt).state, left);
  const reference = reload(uninterrupted, targetAt);
  assert.equal(digest(reload(finished, targetAt)), digest(reference), 'a restart of the server between ticks is invisible after load');
});

test('a return inside the command grace keeps the save as live play left it', () => {
  const soon = left.npcReplay!.processedThroughAt + 30_000;
  const handed = finishLiveWorld(advanceLiveWorld(beginLiveWorld(left), soon).state, left);
  assert.equal(handed.npcReplay?.processedThroughAt, soon);
  assert.deepEqual(handed.npcReplay?.summary, left.npcReplay?.summary);
});
