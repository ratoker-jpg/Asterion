import assert from 'node:assert/strict';
import test from 'node:test';

import { NPC_ACTIVITY_LEVELS, npcOnlineMinutesPerDay, shapeNpcActivity } from './calendar.ts';
import { createNpcState } from './state.ts';
import { createDefaultNewGameConfig, normalizeNewGameConfig, npcActivityOf } from '../world/config.ts';

const owners = (count: number) => Array.from({ length: count }, (_, index) => 'npc-' + String(index).padStart(3, '0'));

/** Share of owners in each owner-rule class by the minutes they play on an ordinary day. */
function classShares(level: 'normal' | 'high' | 'max', count: number) {
  const state = createNpcState(owners(count), 'activity-level-salt', 0, level);
  const minutes = Object.values(state.profiles).map((profile) => npcOnlineMinutesPerDay(Math.max(0.2, profile.activity.propensity)));
  const share = (test: (value: number) => boolean) => minutes.filter(test).length / minutes.length;
  return { top: share((m) => m >= 700), regular: share((m) => m >= 290 && m < 700), working: share((m) => m < 290), minutes };
}

test('normal is the old mix untouched: no argument and the explicit level give the same bytes', () => {
  assert.equal(JSON.stringify(createNpcState(owners(40), 'salt', 5, 'normal')), JSON.stringify(createNpcState(owners(40), 'salt', 5)));
  for (const u of [0, 0.123, 0.5, 0.999]) assert.equal(shapeNpcActivity(u, 'normal'), u);
});

test('high is about 45/40/15 and max about 70/30 of 12-16 h / 5-8 h / short, on 50 and 100 owners', () => {
  for (const count of [50, 100]) {
    const high = classShares('high', count);
    assert.ok(Math.abs(high.top - 0.45) <= 0.03 && Math.abs(high.regular - 0.4) <= 0.03 && Math.abs(high.working - 0.15) <= 0.03, `high ${count}`);
    const max = classShares('max', count);
    assert.ok(Math.abs(max.top - 0.7) <= 0.03 && Math.abs(max.regular - 0.3) <= 0.03 && max.working === 0, `max ${count}`);
    assert.ok(max.minutes.every((minutes) => minutes >= 300), 'nobody in max plays less than five hours');
  }
});

test('inside a class the owners still differ, and the order of activity does not depend on the level', () => {
  const normal = createNpcState(owners(60), 'order-salt', 0, 'normal');
  const max = createNpcState(owners(60), 'order-salt', 0, 'max');
  const order = (state: typeof normal) => Object.values(state.profiles).sort((a, b) => a.activity.propensity - b.activity.propensity || a.ownerId.localeCompare(b.ownerId)).map((profile) => profile.ownerId);
  assert.deepEqual(order(max), order(normal));
  assert.equal(new Set(Object.values(max.profiles).map((profile) => profile.activity.propensity)).size, 60);
  // skill is a separate axis: the level does not move it
  for (const ownerId of Object.keys(normal.profiles)) assert.equal(max.profiles[ownerId]!.traits.mechanicsKnowledge, normal.profiles[ownerId]!.traits.mechanicsKnowledge);
});

test('the shaping is monotonic and stays in the unit range', () => {
  for (const level of NPC_ACTIVITY_LEVELS) {
    let last = -1;
    for (let step = 0; step < 1000; step += 1) {
      const value = shapeNpcActivity(step / 1000, level);
      assert.ok(value >= last && value >= 0 && value <= 1);
      last = value;
    }
  }
});

test('the config reads a missing field as normal and keeps a valid one', () => {
  const fresh = createDefaultNewGameConfig({ seed: 'ABCD1234' });
  assert.equal(npcActivityOf(fresh), 'normal');
  const legacy = { ...fresh, world: { ...fresh.world } } as Record<string, any>;
  delete legacy.world.npcActivity;
  assert.equal(npcActivityOf(normalizeNewGameConfig(legacy, fresh)), 'normal');
  assert.equal('npcActivity' in normalizeNewGameConfig(legacy, fresh).world, false, 'an old config is not rewritten');
  assert.equal(npcActivityOf(normalizeNewGameConfig({ ...fresh, world: { ...fresh.world, npcActivity: 'max' } }, fresh)), 'max');
  assert.equal(npcActivityOf(normalizeNewGameConfig({ ...fresh, world: { ...fresh.world, npcActivity: 'wild' } }, fresh)), 'normal');
});
