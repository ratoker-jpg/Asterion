import { createHash } from 'node:crypto';
import os from 'node:os';
import { createInitialSaveState } from '../src/application/persistence.ts';
import { reconcileRuntime } from '../src/application/reconcile.ts';
import { getNpcOwnerIds } from '../src/application/npc-foundation.ts';
import { isNpcCatchupPending } from '../src/application/npc-catchup.ts';
import { createNpcState } from '../src/domain/npc/state.ts';
import { createDefaultNewGameConfig } from '../src/domain/world/config.ts';

const NPC_COUNT = 100;
const DURATIONS_DAYS = [1, 7, 30];
const WARMUP_DAYS = 1;
const WARMUP_NPCS = 7;
const REPEATS = 3;
const FIXED_START_AT = Date.UTC(2026, 0, 1);
const DAY_MS = 86_400_000;
const PERSONA_SALT = 'npc-replay-benchmark-persona-salt-v1';
const WORLD_SEED = 'NPCBENCH2026';

function createReplayFixture(npcCount, endAt) {
  const setup = createDefaultNewGameConfig({ seed: WORLD_SEED, factionId: 'aegis', playerName: 'Benchmark Commander' });
  setup.world.galaxyCount = 2;
  setup.world.npcCount = npcCount;
  setup.world.maxNpcPerSystem = 2;
  setup.world.randomPlayerStart = false;
  const state = createInitialSaveState('production', FIXED_START_AT, setup);
  const ownerIds = getNpcOwnerIds(state.espionage?.targets, state.profile.playerId);
  if (ownerIds.length !== npcCount) throw new Error(`Expected ${npcCount} NPC owners, got ${ownerIds.length}`);
  return {
    ...state,
    npc: createNpcState(ownerIds, PERSONA_SALT, FIXED_START_AT),
    npcReplay: { version: 1, processedThroughAt: FIXED_START_AT, targetAt: endAt },
    exploration: { ...state.exploration, npcProcessedAt: endAt },
    pirate: { ...state.pirate, raidProcessedAt: endAt },
    asteroidSimulation: undefined,
  };
}

function applyCounters(counters, events) {
  for (const event of events) {
    if (event.kind === 'npc-economy') {
      for (const action of event.events) {
        counters.attempts += 1;
        const role = action.selectedRole ?? 'wait';
        counters.attemptsByRole[role] = (counters.attemptsByRole[role] ?? 0) + 1;
        if (action.started) {
          counters.starts += 1;
          counters.startsByRole[role] = (counters.startsByRole[role] ?? 0) + 1;
        }
      }
    } else if (event.kind === 'npc-building') {
      for (const role of event.assetRole ? [event.assetRole] : []) {
        counters.completions += 1;
        counters.completionsByRole[role] = (counters.completionsByRole[role] ?? 0) + 1;
      }
    }
  }
}

function createCounters() {
  return { attempts: 0, starts: 0, completions: 0, attemptsByRole: {}, startsByRole: {}, completionsByRole: {} };
}

function snapshotNpcEconomy(state, ownerIds) {
  const ownerSet = new Set(ownerIds);
  const targets = Object.fromEntries(Object.entries(state.espionage?.targets ?? {})
    .filter(([, target]) => ownerSet.has(target.ownerId))
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([id, target]) => {
      // Display names use fresh campaign entropy and do not affect NPC economy.
      const { ownerName: _ownerName, ...economyTarget } = target;
      return [id, economyTarget];
    }));
  return JSON.stringify({
    npc: {
      version: state.npc.version,
      personaSalt: state.npc.personaSalt,
      profiles: Object.fromEntries(Object.entries(state.npc.profiles).filter(([ownerId]) => ownerSet.has(ownerId))),
    },
    targets,
    npcReplay: state.npcReplay,
  });
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

async function replayToHorizon(state, horizonAt, counters = createCounters()) {
  let chunks = 0;
  let computeMs = 0;
  let timerProbeMs = 0;
  const chunkTimesMs = [];
  const waitProbeMs = [];
  let diagnosticCalls = 0;
  const wallStarted = process.hrtime.bigint();
  const heapStart = process.memoryUsage().heapUsed;
  const rssStart = process.memoryUsage().rss;
  let heapPeakSampled = heapStart;
  let rssPeakSampled = rssStart;

  while (state.npcReplay.processedThroughAt < horizonAt || isNpcCatchupPending(state)) {
    const beforeCursor = state.npcReplay.processedThroughAt;
    const chunkStarted = process.hrtime.bigint();
    const result = reconcileRuntime(state, {
      planetId: state.currentPlanetId,
      now: horizonAt,
      mode: 'production',
      testTimeScale: 1,
    });
    const chunkMs = Number(process.hrtime.bigint() - chunkStarted) / 1e6;
    diagnosticCalls += 1;
    if ((process.env.NPC_BENCH_DIAGNOSTIC === '1' || process.env.NPC_BENCH_TRACE === '1') && diagnosticCalls <= 10) {
      const replayEvents = result.events.filter((event) => event.kind === 'npc-economy');
      const emissions = replayEvents.reduce((sum, event) => sum + event.events.length, 0);
      const npcTargets = Object.values(result.state.espionage?.targets ?? {}).filter((target) => target.kind === 'npc').slice(0, 3);
      process.stderr.write(JSON.stringify({
        call: diagnosticCalls,
        beforeCursor,
        afterCursor: result.state.npcReplay?.processedThroughAt,
        targetAt: result.state.npcReplay?.targetAt,
        pending: isNpcCatchupPending(result.state),
        elapsedMs: chunkMs,
        reconcileEventCount: result.events.length,
        npcEconomyGroups: replayEvents.length,
        npcActionEmissions: emissions,
        sampleTargetClocks: npcTargets.map((target) => ({ ownerId: target.ownerId, lastReconciledAt: target.resourceClock?.lastReconciledAt })),
      }) + '\n');
    }
    computeMs += chunkMs;
    chunkTimesMs.push(chunkMs);
    chunks += 1;
    applyCounters(counters, result.events);
    state = result.state;

    const memory = process.memoryUsage();
    heapPeakSampled = Math.max(heapPeakSampled, memory.heapUsed);
    rssPeakSampled = Math.max(rssPeakSampled, memory.rss);
    if (state.npcReplay.processedThroughAt <= beforeCursor && isNpcCatchupPending(state)) {
      throw new Error(`NPC replay made no cursor progress at ${beforeCursor}`);
    }
    if (isNpcCatchupPending(state)) {
      const probeStarted = process.hrtime.bigint();
      await new Promise((resolve) => setTimeout(resolve, 0));
      const probeMs = Number(process.hrtime.bigint() - probeStarted) / 1e6;
      timerProbeMs += probeMs;
      waitProbeMs.push(probeMs);
    }
  }

  const heapEnd = process.memoryUsage().heapUsed;
  const finalRss = process.memoryUsage().rss;
  heapPeakSampled = Math.max(heapPeakSampled, heapEnd);
  rssPeakSampled = Math.max(rssPeakSampled, finalRss);
  return {
    state,
    counters,
    chunks,
    computeMs,
    timerProbeMs,
    wallMs: Number(process.hrtime.bigint() - wallStarted) / 1e6,
    orchestrationMs: Math.max(0, Number(process.hrtime.bigint() - wallStarted) / 1e6 - computeMs - timerProbeMs),
    longestChunkMs: Math.max(0, ...chunkTimesMs),
    heapStartBytes: heapStart,
    heapEndBytes: heapEnd,
    heapDeltaBytes: heapEnd - heapStart,
    heapPeakSampledBytes: heapPeakSampled,
    rssStartBytes: rssStart,
    rssEndBytes: finalRss,
    rssPeakSampledBytes: rssPeakSampled,
    eventLoopProbe: {
      label: 'Node setTimeout(0) turnaround proxy; not renderer/UI latency',
      samples: waitProbeMs.length,
      meanMs: waitProbeMs.length ? waitProbeMs.reduce((sum, value) => sum + value, 0) / waitProbeMs.length : 0,
      maxMs: Math.max(0, ...waitProbeMs),
      p95Ms: percentile(waitProbeMs, 0.95),
    },
  };
}

function percentile(values, fraction) {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)];
}

async function measure(days, npcCount = NPC_COUNT) {
  const horizonAt = FIXED_START_AT + days * DAY_MS;
  const initial = createReplayFixture(npcCount, horizonAt);
  const ownerIds = getNpcOwnerIds(initial.espionage?.targets, initial.profile.playerId);
  const saveBytes = Buffer.byteLength(JSON.stringify(initial), 'utf8');
  const measurement = await replayToHorizon(initial, horizonAt);
  const stateDigest = sha256(snapshotNpcEconomy(measurement.state, ownerIds));
  return {
    days,
    npcCount: ownerIds.length,
    saveBytes,
    ...measurement,
    stateDigest,
  };
}

async function compareFullToPartitions(days) {
  const horizonAt = FIXED_START_AT + days * DAY_MS;
  const fullInitial = createReplayFixture(NPC_COUNT, horizonAt);
  const ownerIds = getNpcOwnerIds(fullInitial.espionage?.targets, fullInitial.profile.playerId);
  const fullResult = await replayToHorizon(fullInitial, horizonAt);

  let partitionState = createReplayFixture(NPC_COUNT, horizonAt);
  partitionState = { ...partitionState, npcReplay: { ...partitionState.npcReplay, targetAt: FIXED_START_AT + DAY_MS } };
  for (let day = 1; day <= days; day += 1) {
    const partitionHorizon = FIXED_START_AT + day * DAY_MS;
    partitionState = { ...partitionState, npcReplay: { ...partitionState.npcReplay, targetAt: partitionHorizon } };
    partitionState = (await replayToHorizon(partitionState, partitionHorizon)).state;
  }
  const fullDigest = sha256(snapshotNpcEconomy(fullResult.state, ownerIds));
  const partitionedDigest = sha256(snapshotNpcEconomy(partitionState, ownerIds));
  return { fullDigest, partitionedDigest, match: fullDigest === partitionedDigest };
}

await measure(WARMUP_DAYS, WARMUP_NPCS); // Warm the production path with a smaller real NPC world.
process.stderr.write(`Warmup complete: ${WARMUP_NPCS} NPCs, ${WARMUP_DAYS} day.\n`);
if (process.env.NPC_BENCH_DIAGNOSTIC === '1') process.exit(0);
const measurements = [];
for (const days of DURATIONS_DAYS) {
  const repetitions = [];
  for (let repeat = 0; repeat < REPEATS; repeat += 1) {
    const result = await measure(days);
    const { state, ...publicResult } = result;
    repetitions.push(publicResult);
    process.stderr.write(`Measured ${days} day horizon, repetition ${repeat + 1}/${REPEATS}: ${publicResult.computeMs.toFixed(2)}ms compute, ${publicResult.chunks} chunks.\n`);
  }
  measurements.push({ days, repetitions });
}

const parity = [];
for (const days of DURATIONS_DAYS) parity.push({ days, ...(await compareFullToPartitions(days)) });
const cpus = os.cpus();
console.log(JSON.stringify({
  benchmark: 'npc-production-replay-and-economy',
  methodology: {
    warmup: { npcCount: WARMUP_NPCS, days: WARMUP_DAYS },
    measuredRepetitions: REPEATS,
    timedWork: 'reconcileRuntime production catch-up chunks through requested horizon; fixture creation and save serialization reported separately',
    memoryMethod: 'heapUsed and RSS sampled at start, end, and after each synchronous reconcile chunk; sampled peak may miss short-lived intra-chunk peaks and heap deltas include GC noise',
    wallClockMethod: 'compute time is the sum of synchronous reconcileRuntime calls; timer probe time is separately summed setTimeout(0) turnaround between pending chunks; wallMs is total loop duration and orchestrationMs is wall minus compute and probes',
    eventLoopProbe: 'Node scheduling proxy only; this does not measure Electron renderer or UI latency',
    fixture: 'createInitialSaveState production world with 100 seeded NPC owner planets, then deterministic fixed persona salt; non-NPC exploration/pirate cursors advanced to horizon and asteroidSimulation removed to isolate NPC replay',
    fixtureSeed: WORLD_SEED,
    personaSalt: PERSONA_SALT,
    fixedStartUtc: new Date(FIXED_START_AT).toISOString(),
    isolation: 'This measures actual NPC sessions, economic decisions, mining/build starts and completions in production reconcileRuntime. It is not a full-campaign benchmark; exploration, pirate rolls, and asteroid simulation are isolated.',
    partitionParity: 'NPC profile state, NPC-owned planet targets, and npcReplay metadata SHA-256 after one full catch-up request vs daily horizon partitions',
  },
  system: {
    platform: os.platform(), release: os.release(), arch: os.arch(), node: process.version,
    cpuModel: cpus[0]?.model ?? 'unknown', logicalCpuCount: cpus.length,
  },
  measurements,
  fullVsDailyPartitionParity: parity,
}, null, 2));
