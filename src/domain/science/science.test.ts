import assert from 'node:assert/strict';
import test from 'node:test';
import { COMBAT_TECHNOLOGY_IDS } from '../combat/technologies.ts';
import { SCIENCE_CATALOG, SCIENCE_SECTIONS } from './catalog.ts';
import {
  SCIENCE_QUEUE_CAPACITY,
  calculateScienceDurationMs,
  createDefaultScienceState,
  getSciencePrototypeMaxLevel,
  migrateScienceState,
  migrateScienceLevels,
  previewScience,
  reconcileScienceState,
  startScienceResearch,
  type ScienceRuntimeContext,
  type ScienceState,
} from './runtime.ts';
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
      1: 10, 2: 15, 3: 10, 4: 15, 5: 20, 6: 20, 7: 15, 8: 15, 9: 15,
      10: 15, 11: 15, 12: 15, 13: 15, 14: 2, 15: 1, 17: 20,
      18: 10, 19: 10, 20: 10, 21: 10, 22: 10, 23: 10,
    },
  );
  assert.equal(migrateScienceLevels({ 1: 999, 14: 999, 15: 999 })[1], 10);
  assert.equal(migrateScienceLevels({ 1: 999, 14: 999, 15: 999 })[14], 2);
  assert.equal(migrateScienceLevels({ 1: 999, 14: 999, 15: 999 })[15], 1);
});

test('laboratory reduces current research time by 5 percent per level', () => {
  const base = 15 * 60 * 1_000;
  assert.equal(calculateScienceDurationMs(base, 0), base);
  assert.equal(calculateScienceDurationMs(base, 1), Math.round(base * 0.95));
  assert.equal(calculateScienceDurationMs(base, 2), Math.round(base * 0.95 ** 2));
  assert.equal(calculateScienceDurationMs(base, 20), Math.round(base * 0.95 ** 20));
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
  assert.equal(transition.wallet.metal, before.wallet.metal - SCIENCE_CATALOG.find((science) => science.id === 5)!.capturedCost.metal);
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
  const reconciled = reconcileScienceState(migrated, 3_000);
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
