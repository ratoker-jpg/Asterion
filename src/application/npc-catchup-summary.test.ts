// Audit 26.10 M4: the world summary of a catch-up is persisted with the
// replay cursor, so splitting the catch-up or reloading never loses news.
import assert from 'node:assert/strict';
import test from 'node:test';

import { freezeNpcCatchupTarget, isNpcCatchupPending } from './npc-catchup.ts';
import { reconcileRuntime } from './reconcile.ts';
import { createPersistenceFacade } from './persistence.ts';
import { selectWorldSummaryLeaders } from './world-catchup-summary.ts';
import { WORLD_SUMMARY_COUNTERS } from '../domain/npc/world-catchup-summary.ts';
import { campaign, DAY, memoryStorage, START } from './npc-runtime.test-support.ts';
import type { SaveState } from './contracts.ts';

const TARGET = START + 2 * DAY;

function drain(initial: SaveState, maxGroups: number, options: { reload?: boolean; between?: (state: SaveState) => SaveState } = {}) {
  const facade = createPersistenceFacade({ mode: 'production', storage: memoryStorage(), saveKey: 'asterion.catchup-summary.test', now: () => TARGET });
  let state = initial;
  let slices = 0;
  while (isNpcCatchupPending(state)) {
    state = reconcileRuntime(state, { planetId: state.currentPlanetId, now: TARGET, mode: 'production', testTimeScale: 1, replayMaxGroups: maxGroups }).state;
    slices += 1;
    assert.ok(slices < 2_000, 'catch-up must finish');
    if (options.between) state = options.between(state);
    if (options.reload) {
      assert.equal(facade.write(state).ok, true);
      const loaded = facade.load();
      assert.equal(loaded.status, 'loaded');
      if (loaded.status === 'loaded') state = loaded.state;
    }
  }
  return { state, slices };
}

const counters = (state: SaveState) => Object.fromEntries(WORLD_SUMMARY_COUNTERS.map((key) => [key, state.npcReplay?.summary?.[key]]));

test('a catch-up split into many slices reports exactly the world news of one pass', () => {
  const start = freezeNpcCatchupTarget(campaign(8, 'CATCHUP-SUMMARY-8'), TARGET);
  assert.equal(start.npcReplay?.summary?.complete, true);
  assert.equal(start.npcReplay?.summary?.fromAt, START);

  const whole = drain(start, 1_000_000);
  const split = drain(start, 512);
  assert.ok(split.slices > whole.slices, `the split run must really be split (${split.slices} vs ${whole.slices})`);

  const summary = split.state.npcReplay?.summary;
  assert.ok(summary);
  assert.equal(summary.finishedAt, TARGET);
  // NPC battle reports are archived after every replay group; none may be missed.
  assert.deepEqual(counters(split.state), counters(whole.state));
  const news = WORLD_SUMMARY_COUNTERS.reduce((sum, key) => sum + summary[key], 0);
  assert.ok(summary.battles > split.state.combat.reports.length, 'the summary counts battles whose reports were archived');
  assert.ok(news > 0, `two days of an 8-NPC world should produce some news: ${JSON.stringify(counters(split.state))}`);
  const { leaders, totalGrowth } = selectWorldSummaryLeaders(split.state, summary);
  assert.equal(leaders.length, 3);
  assert.ok(totalGrowth > 0, 'NPC economies grow while the player is away');
  assert.ok(leaders.every((row) => row.name !== 'Неизвестный правитель'));
});

test('the world summary survives a reload after every slice and keeps counting', () => {
  const start = freezeNpcCatchupTarget(campaign(6, 'CATCHUP-SUMMARY-RELOAD'), TARGET);
  let lastBattles = 0;
  const { state } = drain(start, 512, { reload: true, between: (current) => {
    const summary = current.npcReplay?.summary;
    assert.ok(summary, 'every slice keeps the running summary');
    assert.equal(summary.fromAt, START);
    assert.equal(summary.complete, true);
    assert.ok(summary.battles >= lastBattles, 'a slice never resets the count');
    lastBattles = summary.battles;
    return current;
  } });
  assert.equal(state.npcReplay?.summary?.finishedAt, TARGET);
  assert.ok((state.npcReplay?.summary?.battles ?? 0) > 0);
});

test('a catch-up resumed from a save without a summary is marked incomplete, and live ticks start none', () => {
  const start = freezeNpcCatchupTarget(campaign(6, 'CATCHUP-SUMMARY-OLD'), TARGET);
  const firstSlice = reconcileRuntime(start, { planetId: start.currentPlanetId, now: TARGET, mode: 'production', testTimeScale: 1, replayMaxGroups: 64 }).state;
  assert.ok(isNpcCatchupPending(firstSlice));
  // An older version saved this catch-up halfway, with no summary field.
  const { summary: _dropped, ...cursor } = firstSlice.npcReplay!;
  const resumed = drain({ ...firstSlice, npcReplay: cursor }, 4_096).state;
  assert.equal(resumed.npcReplay?.summary?.complete, false);
  assert.equal(resumed.npcReplay?.summary?.finishedAt, TARGET);

  // Dismissed; one second of live play later nothing new is collected.
  const { summary: _closed, ...live } = resumed.npcReplay!;
  const ticked = reconcileRuntime({ ...resumed, npcReplay: live }, { planetId: resumed.currentPlanetId, now: TARGET + 1_000, mode: 'production', testTimeScale: 1 }).state;
  assert.equal(ticked.npcReplay?.summary, undefined);
});

test('a damaged persisted summary is dropped without touching the replay cursor', () => {
  const start = freezeNpcCatchupTarget(campaign(4, 'CATCHUP-SUMMARY-DAMAGED'), TARGET);
  const facade = createPersistenceFacade({ mode: 'production', storage: memoryStorage(), saveKey: 'asterion.catchup-summary.damaged', now: () => TARGET });
  const damaged = { ...start, npcReplay: { ...start.npcReplay!, summary: { ...start.npcReplay!.summary!, battles: -1 } } };
  assert.equal(facade.write(damaged).ok, true);
  const loaded = facade.load();
  assert.equal(loaded.status, 'loaded');
  if (loaded.status !== 'loaded') return;
  assert.equal(loaded.state.npcReplay?.summary, undefined);
  assert.equal(loaded.state.npcReplay?.targetAt, TARGET);
  assert.equal(loaded.state.npcReplay?.processedThroughAt, start.npcReplay?.processedThroughAt);
});
