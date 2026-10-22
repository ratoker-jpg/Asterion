// Full-campaign production catch-up benchmark: 10 galaxies, 100 NPC owners,
// real asteroid, exploration-NPC and pirate timelines. Nothing is isolated or
// fast-forwarded; each run drives reconcileRuntime exactly like App does (one
// chunk per call, cursor persisted in the returned state) until npcReplay
// reaches its frozen target.
//
//   npm run benchmark:npc-full-world -- [days...] [--repeats=N] [--serialize]
//                                       [--write-fixture=F | --fixture=F]
//
// A fresh campaign draws ids and display names from crypto entropy, so two
// processes never build byte-identical fixtures. Before/after digests are
// compared on one fixture written once with --write-fixture and loaded by both
// revisions with --fixture.
//
// --serialize additionally measures JSON.stringify of each chunk result, the
// cost App pays to autosave a published replay prefix.
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import { createInitialSaveState } from '../src/application/persistence.ts';
import { reconcileRuntime } from '../src/application/reconcile.ts';
import { getNpcOwnerIds } from '../src/application/npc-foundation.ts';
import { isNpcCatchupPending } from '../src/application/npc-catchup.ts';
import { createNpcState } from '../src/domain/npc/state.ts';
import { createDefaultNewGameConfig } from '../src/domain/world/config.ts';

const DAY_MS = 86_400_000;
export const FULL_WORLD_SEED = 'NPCREPLAYQA2026';
export const FULL_WORLD_PERSONA_SALT = 'npc-replay-benchmark-persona-salt-v1';
export const FULL_WORLD_START_AT = Date.UTC(2026, 0, 1);

/** The un-isolated new campaign the Electron full-world QA also loads. */
export function createFullWorldFixture(startAt = FULL_WORLD_START_AT) {
  const config = createDefaultNewGameConfig({ seed: FULL_WORLD_SEED, campaignName: 'NPC full-world QA' });
  config.world = { ...config.world, galaxyCount: 10, npcCount: 100, randomPlayerStart: false };
  const base = createInitialSaveState('production', startAt, config);
  const ownerIds = getNpcOwnerIds(base.espionage?.targets, base.profile.playerId);
  if (ownerIds.length !== 100) throw new Error(`Expected 100 NPC owners, got ${ownerIds.length}`);
  if (!base.asteroidSimulation) throw new Error('Full-world fixture must keep the asteroid simulation.');
  // Only the hidden persona salt is fixed (fresh campaigns draw it from crypto);
  // every other timeline keeps the cursor createInitialSaveState gave it.
  return { ...base, npc: createNpcState(ownerIds, FULL_WORLD_PERSONA_SALT, startAt) };
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

/**
 * Digest of everything the catch-up may change. Only campaign identity that is
 * drawn from fresh entropy at creation (ids/names) would differ between two
 * fixtures; both runs share one fixture object, so nothing is excluded here.
 */
export function digestState(state) {
  return sha256(JSON.stringify(state));
}

export function replayToTarget(state, now, { serialize = false, onChunk } = {}) {
  let chunks = 0;
  let computeMs = 0;
  let serializeMs = 0;
  let maxSaveBytes = 0;
  let longestChunkMs = 0;
  let events = 0;
  const started = process.hrtime.bigint();
  do {
    const before = state.npcReplay?.processedThroughAt;
    const t0 = process.hrtime.bigint();
    const result = reconcileRuntime(state, { planetId: state.currentPlanetId, now, mode: 'production', testTimeScale: 1 });
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    computeMs += ms;
    longestChunkMs = Math.max(longestChunkMs, ms);
    chunks += 1;
    events += result.events.length;
    state = result.state;
    if (serialize) {
      const s0 = process.hrtime.bigint();
      const raw = JSON.stringify(state);
      serializeMs += Number(process.hrtime.bigint() - s0) / 1e6;
      maxSaveBytes = Math.max(maxSaveBytes, raw.length);
    }
    onChunk?.(state, ms);
    if (isNpcCatchupPending(state) && state.npcReplay.processedThroughAt <= before) {
      throw new Error(`No replay progress at ${before}`);
    }
  } while (isNpcCatchupPending(state));
  return {
    state, chunks, computeMs, serializeMs, maxSaveBytes, longestChunkMs, events,
    wallMs: Number(process.hrtime.bigint() - started) / 1e6,
  };
}

function summarize(state) {
  const npcTargets = Object.values(state.espionage?.targets ?? {}).filter((target) => target.kind === 'npc');
  return {
    processedThroughAt: state.npcReplay?.processedThroughAt,
    targetAt: state.npcReplay?.targetAt,
    explorationNpcProcessedAt: state.exploration?.npcProcessedAt ?? null,
    pirateRaidProcessedAt: state.pirate?.raidProcessedAt ?? null,
    asteroids: state.asteroidSimulation?.asteroids.length ?? null,
    flights: state.flights.records.length,
    pirateRaidRolls: Object.keys(state.pirate?.raidRolls ?? {}).length,
    npcActionIds: npcTargets.reduce((sum, target) => sum + (target.economyAppliedActionIds?.length ?? 0), 0),
    npcQueuedBuildings: npcTargets.reduce((sum, target) => sum + (target.buildingQueue?.length ?? 0), 0),
  };
}

async function main() {
  const args = process.argv.slice(2);
  const days = args.filter((arg) => /^\d+(\.\d+)?$/.test(arg)).map(Number);
  const repeats = Number(args.find((arg) => arg.startsWith('--repeats='))?.split('=')[1] ?? 1);
  const serialize = args.includes('--serialize');
  const horizons = days.length ? days : [1, 7, 30];
  const fixtureArg = args.find((arg) => arg.startsWith('--fixture='))?.slice('--fixture='.length);
  const writeArg = args.find((arg) => arg.startsWith('--write-fixture='))?.slice('--write-fixture='.length);
  const fixture = fixtureArg ? JSON.parse(fs.readFileSync(fixtureArg, 'utf8')) : createFullWorldFixture();
  if (writeArg) fs.writeFileSync(writeArg, JSON.stringify(fixture));
  const fixtureBytes = JSON.stringify(fixture).length;
  const measurements = [];
  for (const day of horizons) {
    const now = FULL_WORLD_START_AT + day * DAY_MS;
    const repetitions = [];
    for (let repeat = 0; repeat < repeats; repeat += 1) {
      const run = replayToTarget(fixture, now, { serialize });
      const { state, ...numbers } = run;
      repetitions.push({ ...numbers, digest: digestState(state), result: summarize(state) });
      process.stderr.write(`full-world ${day}d #${repeat + 1}: compute ${run.computeMs.toFixed(0)} ms, ${run.chunks} chunks, serialize ${run.serializeMs.toFixed(0)} ms\n`);
    }
    measurements.push({ days: day, repetitions });
  }
  const cpus = os.cpus();
  console.log(JSON.stringify({
    benchmark: 'npc-full-world-production-catchup',
    fixture: {
      seed: FULL_WORLD_SEED, personaSalt: FULL_WORLD_PERSONA_SALT, startUtc: new Date(FULL_WORLD_START_AT).toISOString(),
      galaxies: 10, npcOwners: 100, isolation: 'none: asteroid simulation, exploration NPC and pirate timelines run from campaign start',
      bytes: fixtureBytes, file: fixtureArg ?? null, sha256: sha256(JSON.stringify(fixture)),
    },
    system: { platform: os.platform(), release: os.release(), arch: os.arch(), node: process.version, cpuModel: cpus[0]?.model, logicalCpuCount: cpus.length },
    measurements,
  }, null, 2));
}

if (import.meta.url === `file://${process.argv[1]?.replace(/\\/g, '/').replace(/^(?=[A-Za-z]:)/, '/')}`) await main();
