import { createHash } from 'node:crypto';
import os from 'node:os';
import { createNpcState } from '../src/domain/npc/state.ts';
import { getNpcSessionEvents, NPC_CALENDAR_DAY_MS } from '../src/domain/npc/calendar.ts';

const NPC_COUNT = 100;
const DAYS = [1, 7, 30];
const WARMUP_RUNS = 1;
const MEASURED_RUNS = 3;
const PERSONA_SALT = 'npc-benchmark-v1-fixed-salt';
const START_AT = Date.UTC(2026, 0, 1);
const OWNER_IDS = Array.from({ length: NPC_COUNT }, (_, index) => `benchmark-owner-${String(index + 1).padStart(3, '0')}`);

function digestEvents(events) {
  const hash = createHash('sha256');
  for (const event of events) hash.update(JSON.stringify(event)).update('\n');
  return hash.digest('hex');
}

function runWorkload(days) {
  const heapBefore = process.memoryUsage().heapUsed;
  const started = process.hrtime.bigint();
  const state = createNpcState(OWNER_IDS, PERSONA_SALT, START_AT);
  const events = [];
  const endAt = START_AT + days * NPC_CALENDAR_DAY_MS;
  for (const profile of Object.values(state.profiles)) {
    events.push(...getNpcSessionEvents(profile, START_AT, endAt));
  }
  const saveBytes = Buffer.byteLength(JSON.stringify(state), 'utf8');
  const eventDigest = digestEvents(events);
  const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;
  const heapAfter = process.memoryUsage().heapUsed;
  return {
    elapsedMs,
    heapBeforeBytes: heapBefore,
    heapAfterBytes: heapAfter,
    heapDeltaBytes: heapAfter - heapBefore,
    saveBytes,
    eventCount: events.length,
    eventDigest,
  };
}

function verifyPartitionDigest(days) {
  const state = createNpcState(OWNER_IDS, PERSONA_SALT, START_AT);
  const endAt = START_AT + days * NPC_CALENDAR_DAY_MS;
  const full = [];
  const partitioned = [];
  for (const profile of Object.values(state.profiles)) {
    full.push(...getNpcSessionEvents(profile, START_AT, endAt));
    for (let day = 0; day < days; day += 1) {
      partitioned.push(...getNpcSessionEvents(
        profile,
        START_AT + day * NPC_CALENDAR_DAY_MS,
        START_AT + (day + 1) * NPC_CALENDAR_DAY_MS,
      ));
    }
  }
  return {
    fullDigest: digestEvents(full),
    partitionedDigest: digestEvents(partitioned),
    match: digestEvents(full) === digestEvents(partitioned),
    fullEventCount: full.length,
    partitionedEventCount: partitioned.length,
  };
}

for (let index = 0; index < WARMUP_RUNS; index += 1) {
  for (const days of DAYS) runWorkload(days);
}

const measurements = DAYS.map((days) => {
  const repetitions = Array.from({ length: MEASURED_RUNS }, () => runWorkload(days));
  const digestSet = [...new Set(repetitions.map(({ eventDigest }) => eventDigest))];
  return {
    days,
    npcCount: NPC_COUNT,
    repetitions,
    deterministicAcrossRepetitions: digestSet.length === 1,
    partitionDigestCheck: verifyPartitionDigest(days),
  };
});

const cpus = os.cpus();
console.log(JSON.stringify({
  benchmark: 'npc-state-and-calendar-generation',
  methodology: {
    warmupRunsPerDuration: WARMUP_RUNS,
    measuredRunsPerDuration: MEASURED_RUNS,
    timedWork: 'createNpcState + getNpcSessionEvents for all generated profiles + JSON save serialization + event digest',
    heapMethod: 'process.memoryUsage().heapUsed immediately before and after each timed workload; delta is observational and includes runtime allocation/GC noise',
    partitionCheck: 'compare SHA-256 digest of full-horizon events against concatenated adjacent one-day interval event digests',
    fixedStartUtc: new Date(START_AT).toISOString(),
    timezoneModel: 'profile fixed offsets from UTC−12 through UTC+14; no daylight-saving transitions',
  },
  inputs: { npcCount: NPC_COUNT, ownerIds: OWNER_IDS, personaSalt: PERSONA_SALT, durationsDays: DAYS },
  system: {
    platform: os.platform(),
    release: os.release(),
    arch: os.arch(),
    node: process.version,
    cpuModel: cpus[0]?.model ?? 'unknown',
    logicalCpuCount: cpus.length,
  },
  measurements,
}, null, 2));
