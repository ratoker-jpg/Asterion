// The wizard's NPC activity setting: a world made at `max` is the same world in
// any slicing and after save/load; a config without the field is the world of main.
import assert from 'node:assert/strict';
import test from 'node:test';

import { reconcileRuntime } from './reconcile.ts';
import { freezeNpcCatchupTarget, isNpcCatchupPending } from './npc-catchup.ts';
import { createInitialSaveState, createPersistenceFacade } from './persistence.ts';
import { memoryStorage } from './npc-runtime.test-support.ts';
import { createNpcState } from '../domain/npc/state.ts';
import { createDefaultNewGameConfig, npcActivityOf } from '../domain/world/config.ts';
import type { SaveState } from './contracts.ts';

const START = Date.UTC(2026, 10, 2, 8);
const HOUR = 3_600_000;
const TARGET = START + 3 * HOUR;

function world(level: 'normal' | 'high' | 'max' | undefined): SaveState {
  const config = createDefaultNewGameConfig({ seed: 'ACTLEVEL2026', campaignName: 'activity' });
  config.world = { ...config.world, galaxyCount: 2, npcCount: 24, randomPlayerStart: false };
  if (level) config.world.npcActivity = level; else delete config.world.npcActivity;
  return createInitialSaveState('production', START, config);
}

function drain(state: SaveState, groups: number, reload = false): SaveState {
  let current = freezeNpcCatchupTarget(state, TARGET);
  while (isNpcCatchupPending(current)) {
    current = reconcileRuntime(current, { planetId: current.currentPlanetId, now: TARGET, mode: 'production', testTimeScale: 1, replayMaxGroups: groups }).state;
    if (reload) {
      const facade = createPersistenceFacade({ mode: 'production', storage: memoryStorage(), saveKey: 'activity-slicing', now: () => TARGET });
      assert.equal(facade.write(current).ok, true);
      const loaded = facade.load();
      assert.equal(loaded.status, 'loaded');
      if (loaded.status === 'loaded') current = loaded.state;
    }
  }
  return current;
}

test('a world made at max keeps its level in the save, and its bots are the active ones', () => {
  const max = world('max');
  assert.equal(max.worldConfig?.world.npcActivity, 'max');
  const sorted = (state: SaveState) => Object.values(state.npc!.profiles).map((profile) => profile.activity.propensity).sort((a, b) => a - b);
  assert.ok(sorted(max)[0]! >= 0.36, 'no short-visit or rare bot at max');
  assert.ok(sorted(world('normal'))[0]! < 0.2, 'normal still has them');
});

test('max gives byte-identical worlds in any chunk size and through reloads', () => {
  const fixture = world('max');
  const small = drain(fixture, 16);
  const large = drain(fixture, 100_000);
  assert.equal(JSON.stringify(large), JSON.stringify(small));
  const reloaded = drain(fixture, 64, true);
  assert.equal(JSON.stringify(reloaded.npc), JSON.stringify(small.npc), 'save/load between chunks keeps the NPC state');
  assert.equal(reloaded.worldConfig?.world.npcActivity, 'max');
});

test('a config without the field is the world of main: NPC exactly as the old creation made them', () => {
  const legacy = world(undefined);
  assert.equal('npcActivity' in legacy.worldConfig!.world, false);
  assert.equal(npcActivityOf(legacy.worldConfig), 'normal');
  const old = createNpcState(Object.keys(legacy.npc!.profiles), legacy.npc!.personaSalt, START);
  assert.equal(JSON.stringify(legacy.npc), JSON.stringify(old));
  const explicit = world('normal');
  const oldExplicit = createNpcState(Object.keys(explicit.npc!.profiles), explicit.npc!.personaSalt, START);
  assert.equal(JSON.stringify(explicit.npc), JSON.stringify(oldExplicit));
  // the same save with the field dropped still loads as normal and keeps its NPC
  const facade = createPersistenceFacade({ mode: 'production', storage: memoryStorage(), saveKey: 'activity-legacy', now: () => START });
  assert.equal(facade.write(legacy).ok, true);
  const loaded = facade.load();
  assert.equal(loaded.status, 'loaded');
  if (loaded.status === 'loaded') {
    assert.equal(npcActivityOf(loaded.state.worldConfig), 'normal');
    assert.equal(JSON.stringify(loaded.state.npc), JSON.stringify(legacy.npc));
  }
});
