import assert from 'node:assert/strict';
import test from 'node:test';
import { COMBAT_TECHNOLOGY_IDS } from '../combat/technologies.ts';
import { SCIENCE_CATALOG, SCIENCE_SECTIONS } from './catalog.ts';
import {
  SCIENCE_QUEUE_CAPACITY,
  SCIENCE_CANCEL_REFUND_SOURCE_URL,
  SCIENCE_SAVE_SCHEMA_VERSION,
  calculateScienceCost,
  calculateScienceDurationMs,
  cancelScienceResearch,
  createDefaultScienceState,
  getSciencePrototypeMaxLevel,
  migrateScienceState,
  migrateScienceLevels,
  previewScience,
  reconcileScienceState,
  selectScienceCancelRefundPercent,
  startScienceResearch,
  type ScienceRuntimeContext,
  type ScienceState,
} from './runtime.ts';
import { SCIENCE_REBALANCED_BASE_TIME_MS, getScienceRebalancedBaseDurationMs } from './time-rebalanced.ts';
import { sciencesForSection } from './selectors.ts';

const wallet = { metal: 1_000_000, minerals: 1_000_000, gas: 1_000_000, energy: 1_000_000 };

function context(state: ScienceState = createDefaultScienceState(), laboratoryLevel = 20, now = 1_000): ScienceRuntimeContext {
  return { state, wallet: { ...wallet }, laboratoryLevel, now };
}

function start(contextValue: ScienceRuntimeContext, scienceId: Parameters<typeof startScienceResearch>[1], id: string) {
  return startScienceResearch(contextValue, scienceId, id);
}

test('catalog contains the 22 source-backed sciences and does not invent science 16', () => {
  assert.equal(SCIENCE_CATALOG.length, 22);
  assert.equal(new Set(SCIENCE_CATALOG.map((science) => science.id)).size, 22);
  assert.equal(SCIENCE_CATALOG.some((science) => Number(science.id) === 16), false);
});
test('section membership is deterministic', () => {
  assert.deepEqual(SCIENCE_SECTIONS.map((section) => [section.id, sciencesForSection(section.id).map((science) => science.id)]), [
    ['basic', [1, 2, 3, 4]],
    ['advanced', [5, 6, 7, 8, 9, 10, 11, 12, 13]],
    ['expert', [14, 15, 17, 21, 22, 23]],
    ['additional', [18, 19, 20]],
  ]);
});

test('every science maps to an Asterion technology art slug', () => {
  assert.equal(new Set(SCIENCE_CATALOG.map((science) => science.artSlug)).size, 22);
  for (const science of SCIENCE_CATALOG) assert.match(science.artSlug, /^technology\.shared\.[a-z0-9-]+\.png$/);
});

test('all ten combat overlaps map to existing CombatTechnologyId values', () => {
  const mapped = SCIENCE_CATALOG.filter((science) => science.combatTechnologyId);
  assert.equal(mapped.length, 10);
  for (const science of mapped) assert.equal(COMBAT_TECHNOLOGY_IDS.includes(science.combatTechnologyId!), true);
});

test('all prerequisites reference valid source science ids', () => {
  const ids = new Set(SCIENCE_CATALOG.map((science) => science.id));
  for (const science of SCIENCE_CATALOG) {
    for (const prerequisite of science.prerequisites) {
      assert.equal(ids.has(prerequisite.scienceId), true);
      assert.equal(prerequisite.level > 0, true);
    }
  }
});

test('official NEMEXIA RAW 0 → 1 base costs are present for all 22 sciences', () => {
  const expected = {
    1: { metal: 1_000, minerals: 500, gas: 0, energy: 0 },
    2: { metal: 400, minerals: 200, gas: 50, energy: 0 },
    3: { metal: 1_000, minerals: 400, gas: 0, energy: 0 },
    4: { metal: 500, minerals: 0, gas: 500, energy: 0 },
    5: { metal: 50, minerals: 100, gas: 50, energy: 0 },
    6: { metal: 0, minerals: 250, gas: 500, energy: 0 },
    7: { metal: 100, minerals: 50, gas: 0, energy: 0 },
    8: { metal: 500, minerals: 1_000, gas: 200, energy: 0 },
    9: { metal: 0, minerals: 1_000, gas: 500, energy: 0 },
    10: { metal: 200, minerals: 100, gas: 0, energy: 0 },
    11: { metal: 500, minerals: 250, gas: 50, energy: 0 },
    12: { metal: 1_000, minerals: 1_000, gas: 1_000, energy: 0 },
    13: { metal: 2_000, minerals: 1_500, gas: 500, energy: 0 },
    14: { metal: 2_500, minerals: 3_750, gas: 1_500, energy: 0 },
    15: { metal: 0, minerals: 0, gas: 0, energy: 250_000 },
    17: { metal: 10_000, minerals: 5_000, gas: 0, energy: 0 },
    18: { metal: 50_000, minerals: 25_000, gas: 5_000, energy: 0 },
    19: { metal: 0, minerals: 50_000, gas: 5_000, energy: 0 },
    20: { metal: 50_000, minerals: 30_000, gas: 0, energy: 0 },
    21: { metal: 1_000, minerals: 500, gas: 250, energy: 0 },
    22: { metal: 1_300, minerals: 650, gas: 325, energy: 0 },
    23: { metal: 1_600, minerals: 800, gas: 400, energy: 0 },
  } as const;
  assert.deepEqual(Object.fromEntries(SCIENCE_CATALOG.map((science) => [science.id, science.baseCost])), expected);
});

test('science cost scales each resource independently with exact integer doubling', () => {
  const laser = SCIENCE_CATALOG.find((science) => science.id === 10)!;
  assert.deepEqual(calculateScienceCost(laser.baseCost, 0), { metal: 200, minerals: 100, gas: 0, energy: 0 });
  assert.deepEqual(calculateScienceCost(laser.baseCost, 1), { metal: 400, minerals: 200, gas: 0, energy: 0 });
  assert.deepEqual(calculateScienceCost(laser.baseCost, 2), { metal: 800, minerals: 400, gas: 0, energy: 0 });

  const parallel = SCIENCE_CATALOG.find((science) => science.id === 15)!;
  assert.deepEqual(calculateScienceCost(parallel.baseCost, 0), { metal: 0, minerals: 0, gas: 0, energy: 250_000 });
});

test('new science state starts at zero and explicit levels survive migration', () => {
  const state = createDefaultScienceState();
  assert.equal(state.queue.length, 0);
  assert.equal(state.levels[1], 0);
  assert.equal(migrateScienceLevels({ 1: 0 })[1], 0);
  assert.equal(migrateScienceLevels({ 1: 6 })[1], 6);
  assert.equal(state.levels[1]! < getSciencePrototypeMaxLevel(SCIENCE_CATALOG[0]), true);
});

test('canonical science maxima are per technology and the laboratory is level 20', () => {
  assert.deepEqual(
    Object.fromEntries(SCIENCE_CATALOG.map((science) => [science.id, science.maxLevel])),
    {
      1: 10, 2: 15, 3: 10, 4: 15, 5: 20, 6: 15, 7: 20, 8: 15, 9: 15,
      10: 15, 11: 15, 12: 15, 13: 15, 14: 15, 15: 1, 17: 10,
      18: 10, 19: 10, 20: 10, 21: 10, 22: 10, 23: 10,
    },
  );
  assert.equal(migrateScienceLevels({ 1: 999, 14: 999, 15: 999 })[1], 10);
  assert.equal(migrateScienceLevels({ 1: 999, 14: 999, 15: 999 })[14], 15);
  assert.equal(migrateScienceLevels({ 1: 999, 14: 999, 15: 999 })[15], 1);
});

test('laboratory reduces current research time by 5 percent per level', () => {
  const base = 15 * 60 * 1_000;
  assert.equal(calculateScienceDurationMs(base, 0), base);
  assert.equal(calculateScienceDurationMs(base, 1), Math.round(base * 0.95));
  assert.equal(calculateScienceDurationMs(base, 2), Math.round(base * 0.95 ** 2));
  assert.equal(calculateScienceDurationMs(base, 20), Math.round(base * 0.95 ** 20));
});

test('Asterion Balance v1 supplies every science transition duration and preview uses its next level', () => {
  for (const science of SCIENCE_CATALOG) {
    const durations = SCIENCE_REBALANCED_BASE_TIME_MS[science.id];
    assert.equal(durations.length >= science.maxLevel, true, `${science.name} is missing a duration row`);
    for (let targetLevel = 1; targetLevel <= science.maxLevel; targetLevel += 1) {
      assert.equal(getScienceRebalancedBaseDurationMs(science.id, targetLevel), durations[targetLevel - 1]);
    }
    const preview = previewScience(context(createDefaultScienceState(), 1), science.id);
    assert.equal(preview.durationMs, calculateScienceDurationMs(durations[0], 1));
  }
  assert.equal(getScienceRebalancedBaseDurationMs(1, 1), 45_000);
});

test('legacy science queue replaces stale captured durations with source-backed lab-adjusted snapshots', () => {
  const migrated = migrateScienceState({
    levels: { 1: 0 },
    queue: [
      { id: 'old-first', scienceId: 1, fromLevel: 0, toLevel: 1, startedAt: 10_000, finishAt: 5_410_000, durationMs: 5_400_000 },
      { id: 'old-second', scienceId: 1, fromLevel: 1, toLevel: 2, startedAt: 5_410_000, finishAt: 10_810_000, durationMs: 5_400_000 },
    ],
  }, { laboratoryLevel: 1 });
  assert.deepEqual(migrated.queue.map((task) => task.durationMs), [42_750, 76_000]);
  assert.equal(migrated.queue[0].finishAt, migrated.queue[0].startedAt + 42_750);
  assert.equal(migrated.queue[1].startedAt, migrated.queue[0].finishAt);
});

test('one canonical duration calculation is used by preview and queued snapshots across all Test Mode scales', () => {
  const base = 45 * 1_000;
  for (const laboratoryLevel of [0, 1, 2, 20]) {
    for (const scale of [1, 10, 15, 100, 200, 300, 500]) {
      const state = createDefaultScienceState();
      const current = { ...context(state, laboratoryLevel), mode: 'test' as const, testTimeScale: scale };
      const preview = previewScience(current, 1);
      assert.equal(preview.durationMs, calculateScienceDurationMs(base, laboratoryLevel, 'test', scale));
      if (laboratoryLevel > 0) {
        const transition = startScienceResearch(current, 1, `duration-${laboratoryLevel}-${scale}`);
        assert.equal(transition.ok, true);
        assert.equal(transition.task?.durationMs, preview.durationMs);
        assert.equal(transition.task?.finishAt, transition.task!.startedAt + transition.task!.durationMs);
      }
    }
  }
});

test('queued duration is a snapshot and remaining time equals duration at startedAt', () => {
  const first = start(context(createDefaultScienceState(), 1, 10_000), 1, 'snapshot-first');
  assert.equal(first.ok, true);
  const second = start({ ...context(first.state, 20, first.task!.finishAt), wallet: first.wallet }, 1, 'snapshot-second');
  assert.equal(second.ok, true);
  assert.equal(first.task!.finishAt - first.task!.startedAt, first.task!.durationMs);
  assert.equal(second.task!.startedAt, first.task!.finishAt);
  assert.notEqual(second.task!.durationMs, first.task!.durationMs);
});

test('current-save migration preserves queued duration snapshots across laboratory and Test Mode changes', () => {
  const productionStart = start({ ...context(createDefaultScienceState(), 1, 10_000), mode: 'production' }, 1, 'modern-production-snapshot');
  assert.equal(productionStart.ok, true);
  const productionReload = migrateScienceState(productionStart.state, {
    schemaVersion: SCIENCE_SAVE_SCHEMA_VERSION,
    laboratoryLevel: 20,
    mode: 'production',
  });
  assert.equal(productionReload.queue[0]?.durationMs, productionStart.task?.durationMs);
  assert.equal(productionReload.queue[0]?.startedAt, productionStart.task?.startedAt);
  assert.equal(productionReload.queue[0]?.finishAt, productionStart.task?.finishAt);

  const testStart = start({ ...context(createDefaultScienceState(), 1, 10_000), mode: 'test', testTimeScale: 1 }, 1, 'modern-test-snapshot');
  assert.equal(testStart.ok, true);
  const testReload = migrateScienceState(testStart.state, {
    schemaVersion: SCIENCE_SAVE_SCHEMA_VERSION,
    laboratoryLevel: 20,
    mode: 'test',
    testTimeScale: 500,
  });
  assert.equal(testReload.queue[0]?.durationMs, testStart.task?.durationMs);
  assert.equal(testReload.queue[0]?.startedAt, testStart.task?.startedAt);
  assert.equal(testReload.queue[0]?.finishAt, testStart.task?.finishAt);
});

test('preview, start and sequential queue tasks use fromLevel costs and charge once', () => {
  const initial = context(createDefaultScienceState(), 1, 10_000);
  const firstPreview = previewScience(initial, 1);
  assert.deepEqual(firstPreview.cost, { metal: 1_000, minerals: 500, gas: 0, energy: 0 });
  const first = start(initial, 1, 'cost-snapshot-first');
  assert.equal(first.ok, true);
  assert.deepEqual(first.task?.cost, firstPreview.cost);
  assert.deepEqual(first.wallet, { metal: 999_000, minerals: 999_500, gas: 1_000_000, energy: 1_000_000 });

  const secondContext = { ...initial, state: first.state, wallet: first.wallet, now: first.task!.finishAt };
  const secondPreview = previewScience(secondContext, 1);
  assert.equal(secondPreview.projectedLevel, 1);
  assert.deepEqual(secondPreview.cost, { metal: 2_000, minerals: 1_000, gas: 0, energy: 0 });
  const second = start(secondContext, 1, 'cost-snapshot-second');
  assert.equal(second.ok, true);
  assert.deepEqual(second.task?.cost, secondPreview.cost);
  assert.equal(second.wallet.metal, 997_000);
  assert.equal(second.wallet.minerals, 998_500);
});

test('migration preserves a saved task cost for refunds instead of recalculating it', () => {
  const migrated = migrateScienceState({
    levels: { 1: 0 },
    queue: [{
      id: 'saved-cost', scienceId: 1, fromLevel: 0, toLevel: 1,
      startedAt: 100, finishAt: 200, durationMs: 100,
      cost: { metal: 777, minerals: 333, gas: 222, energy: 111 },
    }],
  });
  assert.deepEqual(migrated.queue[0]?.cost, { metal: 777, minerals: 333, gas: 222, energy: 111 });
  const canceled = cancelScienceResearch({ ...context(migrated, 1, 150), rng: () => 0 }, 'saved-cost');
  assert.equal(canceled.ok, true);
  assert.deepEqual(canceled.refund, { metal: 466, minerals: 199, gas: 133, energy: 66 });
});

test('science cancellation cascades dependent successors and refunds each saved cost with its own 60–80% roll', () => {
  let current = context(createDefaultScienceState(), 1, 10_000);
  for (const id of ['cancel-1', 'cancel-2', 'cancel-3']) {
    const transition = start(current, 1, id);
    assert.equal(transition.ok, true);
    current = { ...current, state: transition.state, wallet: transition.wallet };
  }
  const canceledTask = current.state.queue[1];
  const rolls = [0, 0.999999];
  const canceled = cancelScienceResearch({ ...current, rng: () => rolls.shift() ?? 0 }, canceledTask.id);
  assert.equal(canceled.ok, true);
  assert.equal(canceled.refundPercent, 60);
  assert.deepEqual(canceled.refundPercents, [60, 80]);
  assert.deepEqual(canceled.canceledTasks.map((task) => task.id), ['cancel-2', 'cancel-3']);
  assert.deepEqual(canceled.refund, {
    metal: Math.floor(canceledTask.cost.metal * 0.6) + Math.floor(current.state.queue[2].cost.metal * 0.8),
    minerals: Math.floor(canceledTask.cost.minerals * 0.6) + Math.floor(current.state.queue[2].cost.minerals * 0.8),
    gas: Math.floor(canceledTask.cost.gas * 0.6) + Math.floor(current.state.queue[2].cost.gas * 0.8),
    energy: Math.floor(canceledTask.cost.energy * 0.6) + Math.floor(current.state.queue[2].cost.energy * 0.8),
  });
  assert.deepEqual(canceled.state.queue.map((task) => task.id), ['cancel-1']);
  const repeated = cancelScienceResearch({ ...current, state: canceled.state, wallet: canceled.wallet, rng: () => 0 }, canceledTask.id);
  assert.equal(repeated.ok, false);
  assert.deepEqual(repeated.wallet, canceled.wallet);
});

test('science cancellation reconciles completed work before refusing a refund', () => {
  const started = start(context(createDefaultScienceState(), 1, 10_000), 1, 'complete-before-cancel');
  const canceled = cancelScienceResearch({ ...context(started.state, 1, started.task!.finishAt), wallet: started.wallet, rng: () => 0 }, 'complete-before-cancel');
  assert.equal(canceled.ok, false);
  assert.equal(canceled.state.levels[1], 1);
  assert.deepEqual(canceled.wallet, started.wallet);
});

test('canceling the active science task removes dependent successors instead of leaving impossible levels', () => {
  const first = start(context(createDefaultScienceState(), 1, 10_000), 1, 'active-cancel-first');
  const second = start({ ...context(first.state, 1, first.task!.finishAt), wallet: first.wallet }, 1, 'active-cancel-second');
  const canceledAt = first.task!.startedAt + 1_000;
  const canceled = cancelScienceResearch({ ...context(second.state, 1, canceledAt), wallet: second.wallet, rng: () => 0 }, 'active-cancel-first');
  assert.equal(canceled.ok, true);
  assert.deepEqual(canceled.state.queue, []);
  assert.deepEqual(canceled.canceledTasks.map((task) => task.id), ['active-cancel-first', 'active-cancel-second']);
  assert.deepEqual(canceled.refundPercents, [60, 60]);
});

test('science cancellation keeps independent queued sciences while dropping only invalid successors', () => {
  let current = context(createDefaultScienceState(), 1, 10_000);
  const first = start(current, 1, 'science-chain-first');
  current = { ...current, state: first.state, wallet: first.wallet };
  const independent = start({ ...context(current.state, 20, first.task!.finishAt), wallet: current.wallet }, 2, 'science-independent');
  current = { ...current, state: independent.state, wallet: independent.wallet };
  const dependent = start({ ...context(current.state, 20, independent.task!.finishAt), wallet: current.wallet }, 1, 'science-chain-dependent');
  current = { ...current, state: dependent.state, wallet: dependent.wallet };

  const canceled = cancelScienceResearch({ ...current, rng: () => 0 }, first.task!.id);
  assert.equal(canceled.ok, true);
  assert.deepEqual(canceled.state.queue.map((task) => task.id), ['science-independent']);
  assert.deepEqual(canceled.canceledTasks.map((task) => task.id), ['science-chain-first', 'science-chain-dependent']);
  assert.deepEqual(canceled.refundPercents, [60, 60]);
});

test('mixed cascade keeps independent work and does not claim a refund for damaged dependent saves', () => {
  let current = context(createDefaultScienceState(), 1, 10_000);
  for (const id of ['mixed-first', 'mixed-second', 'mixed-third']) {
    const transition = start(current, 1, id);
    assert.equal(transition.ok, true);
    current = { ...current, state: transition.state, wallet: transition.wallet };
  }
  const damagedQueue = current.state.queue.map((task, index) => index === 2
    ? { ...task, cost: { ...task.cost, energy: Number.NaN }, refundEligible: false }
    : task);
  const canceled = cancelScienceResearch({
    ...current,
    state: { ...current.state, queue: damagedQueue },
    rng: () => 0,
  }, 'mixed-second');

  assert.equal(canceled.ok, true);
  assert.deepEqual(canceled.state.queue.map((task) => task.id), ['mixed-first']);
  assert.deepEqual(canceled.canceledTasks.map((task) => task.id), ['mixed-second', 'mixed-third']);
  assert.deepEqual(canceled.refundPercents, [60]);
  assert.deepEqual(canceled.refund, {
    metal: Math.floor(damagedQueue[1].cost.metal * 0.6),
    minerals: Math.floor(damagedQueue[1].cost.minerals * 0.6),
    gas: Math.floor(damagedQueue[1].cost.gas * 0.6),
    energy: Math.floor(damagedQueue[1].cost.energy * 0.6),
  });
});

test('science cancellation source and integer boundary rolls are explicit', () => {
  assert.equal(SCIENCE_CANCEL_REFUND_SOURCE_URL, 'https://github.com/ratoker-jpg/Nemexia_auto_v2/blob/main/saved_pages/%D0%BD%D0%B0%D1%83%D0%BA%D0%B0/page_2026-09-05_22-49-40.html');
  assert.equal(selectScienceCancelRefundPercent(() => 0), 60);
  assert.equal(selectScienceCancelRefundPercent(() => 0.999999), 80);
});

test('science migration makes task ids unique and blocks refunds without a complete saved cost', () => {
  const migrated = migrateScienceState({
    levels: { 1: 0 },
    queue: [
      {
        id: 'duplicate-task', scienceId: 1, fromLevel: 0, toLevel: 1,
        startedAt: 100, finishAt: 200, durationMs: 100,
        cost: { metal: 100, minerals: 50, gas: 20, energy: 10 },
      },
      {
        id: 'duplicate-task', scienceId: 1, fromLevel: 1, toLevel: 2,
        startedAt: 200, finishAt: 300, durationMs: 100,
        cost: { metal: 100, minerals: 50, gas: 20 },
      },
    ],
  });
  assert.equal(migrated.queue.length, 2);
  assert.notEqual(migrated.queue[0].id, migrated.queue[1].id);
  assert.equal(migrated.queue[1].refundEligible, false);

  const current = context(migrated, 1, 150);
  const blocked = cancelScienceResearch(current, migrated.queue[1].id);
  assert.equal(blocked.ok, false);
  assert.deepEqual(blocked.wallet, current.wallet);
  assert.deepEqual(blocked.state.queue.map((task) => task.id), migrated.queue.map((task) => task.id));
});

test('science start validates runtime laboratory/prerequisites and atomically deducts resources', () => {
  const state = createDefaultScienceState();
  state.levels[5] = 4;
  state.levels[4] = 2;
  const blockedByLab = previewScience(context(state, 3), 5);
  assert.equal(blockedByLab.status, 'requirements-unmet');
  assert.match(blockedByLab.reason ?? '', /Лаборатория/);

  const before = context(state, 4);
  const transition = start(before, 5, 'science-5-1');
  assert.equal(transition.ok, true);
  assert.equal(transition.task?.fromLevel, 4);
  assert.equal(transition.task?.toLevel, 5);
  assert.equal(transition.task?.startedAt, before.now);
  assert.equal(transition.wallet.metal, before.wallet.metal - SCIENCE_CATALOG.find((science) => science.id === 5)!.baseCost.metal * (2 ** 4));
  assert.equal(transition.wallet.minerals, before.wallet.minerals - 1_600);
  assert.equal(transition.state.queue.length, 1);

  const insufficient = previewScience({ ...before, wallet: { metal: 0, minerals: 0, gas: 0, energy: 0 } }, 5);
  assert.equal(insufficient.status, 'insufficient-resource');
});

test('science queue accepts three sequential tasks and rejects the fourth', () => {
  const state = createDefaultScienceState();
  state.levels[1] = 0;
  let current = context(state, 1);
  for (let index = 0; index < SCIENCE_QUEUE_CAPACITY; index += 1) {
    const transition = start(current, 1, `science-1-${index}`);
    assert.equal(transition.ok, true, transition.reason ?? 'queue start failed');
    current = { ...current, state: transition.state, wallet: transition.wallet };
  }

  assert.deepEqual(current.state.queue.map((task) => [task.fromLevel, task.toLevel]), [[0, 1], [1, 2], [2, 3]]);
  assert.equal(current.state.queue[1].startedAt, current.state.queue[0].finishAt);
  assert.equal(current.state.queue[2].startedAt, current.state.queue[1].finishAt);
  const fourth = previewScience(current, 1);
  assert.equal(fourth.status, 'queue-full');
  assert.equal(fourth.canStart, false);
});

test('science preview exposes the catalog maximum state', () => {
  const state = createDefaultScienceState();
  state.levels[1] = getSciencePrototypeMaxLevel(SCIENCE_CATALOG.find((science) => science.id === 1)!);
  const preview = previewScience(context(state, 1), 1);
  assert.equal(preview.status, 'max-level');
  assert.equal(preview.nextLevel, null);
  assert.match(preview.reason ?? '', /максимальный/i);
});

test('completion is timestamp-based, offline-safe and exact-once after repeated reconciliation', () => {
  const state = createDefaultScienceState();
  state.levels[1] = 0;
  let current = context(state, 1, 10_000);
  for (let index = 0; index < 3; index += 1) {
    const transition = start(current, 1, `offline-${index}`);
    assert.equal(transition.ok, true);
    current = { ...current, state: transition.state, wallet: transition.wallet };
  }

  const finishAt = current.state.queue.at(-1)!.finishAt;
  const offline = reconcileScienceState(current.state, finishAt);
  assert.equal(offline.changed, true);
  assert.equal(offline.completed.length, 3);
  assert.equal(offline.state.levels[1], 3);
  assert.equal(offline.state.queue.length, 0);

  const secondReload = reconcileScienceState(offline.state, finishAt + 50_000);
  assert.equal(secondReload.changed, false);
  assert.equal(secondReload.completed.length, 0);
  assert.equal(secondReload.state.levels[1], 3);
});

test('malformed and legacy science saves migrate safely, including stale tasks', () => {
  const migrated = migrateScienceState({
    levels: { 1: 1, 7: 999, 2: 'broken' },
    queue: [
      { id: 'stale', scienceId: 1, fromLevel: 0, toLevel: 1, startedAt: 1_000, finishAt: 2_000 },
      { id: 'legacy', scienceId: 1, startedAt: 2_000, finishAt: 3_000 },
      null,
      { id: 'later-valid', scienceId: 2, fromLevel: 0, toLevel: 1, startedAt: 3_000, finishAt: 4_000 },
    ],
  });

  assert.equal(migrated.levels[1], 1);
  assert.equal(migrated.levels[7], getSciencePrototypeMaxLevel(SCIENCE_CATALOG.find((science) => science.id === 7)!));
  assert.equal(migrated.levels[2], 0);
  assert.equal(migrated.queue.length, 2);
  assert.deepEqual([migrated.queue[0].fromLevel, migrated.queue[0].toLevel], [1, 2]);
  const reconciled = reconcileScienceState(migrated, migrated.queue[0].finishAt);
  assert.equal(reconciled.state.levels[1], 2);
  assert.equal(reconciled.completed.length, 1);
  assert.equal(migrateScienceState({ queue: 'not-an-array' }).queue.length, 0);
  assert.equal(migrateScienceState(null).queue.length, 0);
  assert.equal(migrateScienceState({ queue: [null, { scienceId: 1, startedAt: 1, finishAt: 2 }] }).queue.length, 1);
});

test('additional science directions are mutually exclusive at runtime', () => {
  const state = createDefaultScienceState();
  state.levels[18] = 1;
  state.levels[7] = 10;
  state.levels[23] = 5;
  const blocked = previewScience(context(state, 20), 19);
  assert.equal(blocked.status, 'additional-direction-blocked');
  assert.equal(blocked.canStart, false);
});

test('science definitions contain no combat coefficient or reducer contract', () => {
  for (const science of SCIENCE_CATALOG) {
    const keys = Object.keys(science);
    assert.equal(keys.some((key) => /multiplier|coefficient|reducer|spend/i.test(key)), false);
  }
});
