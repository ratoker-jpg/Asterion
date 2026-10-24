import assert from 'node:assert/strict';
import test from 'node:test';
import { createBot01Planets } from '../domain/espionage/fixtures.ts';
import type { SpyTargetState } from '../domain/espionage/types.ts';
import { RECYCLING_STORAGE_MS, startRecyclingJob } from '../domain/buildings/recycling.ts';
import { getNextNpcEconomyCheckpoint, settleNpcRecycling } from './npc-economy.ts';

test('an NPC recycling job left uncollected is credited a day after it is ready, exactly once', () => {
  const base = Object.values(createBot01Planets(0))[0]! as SpyTargetState;
  const planet: SpyTargetState = { ...base, buildings: { ...base.buildings, recycling: 1 }, resources: { ...base.resources, metal: 0, minerals: 0, gas: 0 } };
  const started = startRecyclingJob({ availableDebris: 10_000, jobs: [] }, 1, 10_000, { metal: 100, minerals: 0, gas: 0 }, 0, 'job-1');
  assert.equal(started.canStart, true);
  const withJob: SpyTargetState = { ...planet, recycling: started.state };
  const due = started.job!.finishAt + RECYCLING_STORAGE_MS;
  assert.equal(getNextNpcEconomyCheckpoint({ ...withJob, buildingQueue: [] }, due - 1), due, 'replay steps on the collection moment');
  assert.equal(settleNpcRecycling(withJob, due - 1), withJob, 'nothing before the day is over');
  const collected = settleNpcRecycling(withJob, due);
  assert.ok(collected.resources.metal > 0);
  assert.equal(collected.recycling!.jobs.length, 0);
  assert.equal(settleNpcRecycling(collected, due + 1), collected, 'credited once');
});
