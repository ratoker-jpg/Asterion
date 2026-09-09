import assert from 'node:assert/strict';
import test from 'node:test';
import {
  RECYCLING_INITIAL_DEBRIS,
  RECYCLING_STORAGE_MS,
  advanceRecyclingState,
  collectRecyclingJob,
  createDefaultRecyclingState,
  getRecyclingDurationMs,
  getRecyclingEfficiencyPercent,
  getRecyclingMaxConcurrentJobs,
  getRecyclingOutput,
  getRecyclingStartValidation,
  migrateRecyclingState,
  startRecyclingJob,
  type RecyclingJob,
  type RecyclingState,
  type ResourceAllocationPercent,
} from './recycling.ts';

const allocation: ResourceAllocationPercent = { metal: 60, minerals: 40, gas: 0 };

function start(
  state: RecyclingState,
  level: number,
  debrisAmount: number,
  startedAt: number,
  id: string,
  split: ResourceAllocationPercent = allocation,
) {
  return startRecyclingJob(state, level, debrisAmount, split, startedAt, id);
}

test('levels 1, 6 and 10 expose canonical efficiency and concurrent slots', () => {
  assert.equal(getRecyclingEfficiencyPercent(1), 75);
  assert.equal(getRecyclingEfficiencyPercent(6), 100);
  assert.equal(getRecyclingEfficiencyPercent(10), 120);
  assert.equal(getRecyclingMaxConcurrentJobs(1), 1);
  assert.equal(getRecyclingMaxConcurrentJobs(6), 6);
  assert.equal(getRecyclingMaxConcurrentJobs(10), 10);
});

test('duration follows Balance v1 debris-per-second throughput and is never zero', () => {
  assert.equal(getRecyclingDurationMs(1_000_000, 1), 142_858_000);
  assert.equal(getRecyclingDurationMs(100_000, 1), 14_286_000);
  assert.equal(getRecyclingDurationMs(10_000, 1), 1_429_000);
  assert.equal(getRecyclingDurationMs(1_000, 1), 143_000);
  assert.equal(getRecyclingDurationMs(0), 1000);
  assert.equal(getRecyclingDurationMs(1), 1000);
});

test('new planet recycling state starts with the temporary 100,000 debris stock', () => {
  assert.deepEqual(createDefaultRecyclingState(), {
    availableDebris: RECYCLING_INITIAL_DEBRIS,
    jobs: [],
  });
  assert.equal(RECYCLING_INITIAL_DEBRIS, 100_000);
});

test('start reserves debris immediately and cannot exceed free stock or slot limit', () => {
  const initial = createDefaultRecyclingState();
  const first = start(initial, 1, 10_000, 10_000, 'job-1');
  assert.equal(first.canStart, true);
  assert.equal(first.state.availableDebris, 90_000);
  assert.equal(first.state.jobs.length, 1);

  const overStock = start(first.state, 1, 90_001, 10_001, 'job-2');
  assert.equal(overStock.canStart, false);
  assert.equal(overStock.reason, 'Недостаточно свободных обломков');
  assert.equal(overStock.state.availableDebris, 90_000);

  const fullSlots = start(first.state, 1, 1_000, 10_001, 'job-2');
  assert.equal(fullSlots.canStart, false);
  assert.equal(fullSlots.reason, 'Все процессы заняты');
  assert.equal(fullSlots.state.jobs.length, 1);
});

test('60/30/0 is rejected while 60/40/0 starts', () => {
  const state = createDefaultRecyclingState();
  const invalid = getRecyclingStartValidation(state, 1, 10_000, { metal: 60, minerals: 30, gas: 0 });
  assert.equal(invalid.canStart, false);
  assert.equal(invalid.reason, 'Распределите оставшиеся 10%');

  const valid = start(state, 1, 10_000, 1_000, 'valid');
  assert.equal(valid.canStart, true);
  assert.deepEqual(valid.job?.allocationPercent, { metal: 60, minerals: 40, gas: 0 });
});

test('level 1, 10,000 debris and 100% metal produces exactly 7,500 metal', () => {
  const output = getRecyclingOutput(10_000, 75, { metal: 100, minerals: 0, gas: 0 });
  assert.deepEqual(output, { metal: 7_500, minerals: 0, gas: 0 });
});

test('integer allocation never loses output remainder', () => {
  const output = getRecyclingOutput(10_001, 75, { metal: 33, minerals: 33, gas: 34 });
  const totalOutput = Math.floor(10_001 * 0.75);
  assert.equal(output.metal + output.minerals + output.gas, totalOutput);
  assert.equal(output.metal, Math.floor(totalOutput * 0.33));
  assert.equal(output.minerals, Math.floor(totalOutput * 0.33));
  assert.equal(output.gas, totalOutput - output.metal - output.minerals);
});

test('collect is disabled before finish, succeeds once after finish and never pays twice', () => {
  const startedAt = 50_000;
  const started = start(createDefaultRecyclingState(), 1, 10_000, startedAt, 'collect-once', { metal: 100, minerals: 0, gas: 0 });
  assert.equal(started.canStart, true);
  const job = started.job!;

  const early = collectRecyclingJob(started.state, job.id, job.finishAt - 1);
  assert.equal(early.ok, false);
  assert.equal(early.output, null);
  assert.equal(early.reason, 'Переработка ещё не завершена');

  const collected = collectRecyclingJob(started.state, job.id, job.finishAt);
  assert.equal(collected.ok, true);
  assert.deepEqual(collected.output, { metal: 7_500, minerals: 0, gas: 0 });
  assert.equal(collected.state.jobs.length, 0);

  const duplicate = collectRecyclingJob(collected.state, job.id, job.finishAt + 1);
  assert.equal(duplicate.ok, false);
  assert.equal(duplicate.output, null);
  assert.equal(duplicate.state.jobs.length, 0);
});

test('ready result auto-collects after 24 hours and emits its payout exactly once', () => {
  const started = start(createDefaultRecyclingState(), 1, 1_000, 100_000, 'auto-collect', { metal: 100, minerals: 0, gas: 0 });
  const job = started.job!;
  const ready = advanceRecyclingState(started.state, job.finishAt);
  assert.equal(ready.state.jobs[0].status, 'ready');
  assert.equal(ready.state.jobs[0].collectExpiresAt, job.finishAt + RECYCLING_STORAGE_MS);
  assert.deepEqual(ready.autoCollectedJobIds, []);
  assert.deepEqual(ready.autoCollectedOutput, { metal: 0, minerals: 0, gas: 0 });

  const autoCollectAt = job.finishAt + RECYCLING_STORAGE_MS;
  const autoCollected = advanceRecyclingState(ready.state, autoCollectAt);
  assert.equal(autoCollected.changed, true);
  assert.deepEqual(autoCollected.autoCollectedJobIds, [job.id]);
  assert.deepEqual(autoCollected.autoCollectedOutput, { metal: 750, minerals: 0, gas: 0 });
  assert.equal(autoCollected.state.jobs.length, 0);

  const repeated = advanceRecyclingState(autoCollected.state, autoCollectAt + 1);
  assert.equal(repeated.changed, false);
  assert.deepEqual(repeated.autoCollectedJobIds, []);
  assert.deepEqual(repeated.autoCollectedOutput, { metal: 0, minerals: 0, gas: 0 });
  assert.equal(repeated.state.jobs.length, 0);
});

test('processing, ready and auto-collect boundary are derived from absolute timestamps after migration', () => {
  const processingStartedAt = 1_000_000;
  const readyStartedAt = 500_000;
  const processingDuration = getRecyclingDurationMs(100_000, 2);
  const readyDuration = getRecyclingDurationMs(10_000, 2);
  const now = processingStartedAt + Math.floor(processingDuration / 2);

  const source = {
    availableDebris: 77_777,
    jobs: [
      {
        id: 'processing', debrisAmount: 100_000, allocationPercent: { metal: 60, minerals: 40, gas: 0 },
        efficiencyPercent: 75, output: { metal: -999, minerals: 2, gas: 3 },
        startedAt: processingStartedAt, finishAt: 999, collectExpiresAt: 2, status: 'ready',
      },
      {
        id: 'ready', debrisAmount: 10_000, allocationPercent: { metal: 100, minerals: 0, gas: 0 },
        efficiencyPercent: 75, output: { metal: 1, minerals: 1, gas: 1 },
        startedAt: readyStartedAt, finishAt: 1, collectExpiresAt: null, status: 'processing',
      },
    ],
  };

  const migrated = migrateRecyclingState(source, 2, now);
  assert.equal(migrated.availableDebris, 77_777);
  assert.equal(migrated.jobs.length, 2);
  assert.equal(migrated.jobs[0].status, 'processing');
  assert.equal(migrated.jobs[0].finishAt, processingStartedAt + processingDuration);
  assert.equal(migrated.jobs[0].collectExpiresAt, null);
  assert.deepEqual(migrated.jobs[0].output, getRecyclingOutput(100_000, 75, allocation));
  assert.equal(migrated.jobs[1].status, 'ready');
  assert.equal(migrated.jobs[1].finishAt, readyStartedAt + readyDuration);
  assert.equal(migrated.jobs[1].collectExpiresAt, readyStartedAt + readyDuration + RECYCLING_STORAGE_MS);

  const autoCollectAt = readyStartedAt + readyDuration + RECYCLING_STORAGE_MS;
  const afterOfflineReload = migrateRecyclingState(source, 2, autoCollectAt);
  assert.equal(afterOfflineReload.jobs.some((job) => job.id === 'ready'), true);
  const advanced = advanceRecyclingState(afterOfflineReload, autoCollectAt);
  assert.deepEqual(advanced.autoCollectedJobIds, ['ready']);
  assert.deepEqual(advanced.autoCollectedOutput, getRecyclingOutput(10_000, 75, { metal: 100, minerals: 0, gas: 0 }));
  assert.equal(advanced.state.jobs.some((job) => job.id === 'ready'), false);
});

test('damaged recycling save is sanitized and jobs above the level slot limit are dropped', () => {
  const now = 10_000;
  const job = (id: string): RecyclingJob => ({
    id,
    debrisAmount: 10_000,
    allocationPercent: { metal: 60, minerals: 40, gas: 0 },
    efficiencyPercent: 75,
    output: { metal: 4_500, minerals: 3_000, gas: 0 },
    startedAt: now,
    finishAt: now + getRecyclingDurationMs(10_000),
    collectExpiresAt: null,
    status: 'processing',
  });

  const migrated = migrateRecyclingState({
    availableDebris: -500,
    jobs: [
      { ...job('one'), allocationPercent: { metal: 60, minerals: 30, gas: -20 }, output: { metal: -1 } },
      job('two'),
      job('three'),
    ],
  }, 1, now + 1);

  assert.equal(migrated.availableDebris, 0);
  assert.equal(migrated.jobs.length, 1);
  assert.deepEqual(migrated.jobs[0].allocationPercent, { metal: 60, minerals: 30, gas: 10 });
  assert.equal(migrated.jobs[0].output.metal >= 0, true);
  assert.equal(migrated.jobs[0].output.minerals >= 0, true);
  assert.equal(migrated.jobs[0].output.gas >= 0, true);
});
