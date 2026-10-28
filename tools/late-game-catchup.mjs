// Late-game catch-up fixtures and measurements: the full world of
// benchmark-npc-full-world (10 galaxies, 100 NPC owners, asteroid, exploration
// and pirate timelines) played by its NPCs for N days, then an absence of H
// hours caught up exactly as App does (frozen target, chunks until done).
//
//   npm run benchmark:late-game -- generate --days=3,7 --out=DIR [--max-groups=N]
//       writes DIR/late-game-day-<N>.json (plain SaveState JSON, tens of MB:
//       generated, never committed; day 7 takes tens of minutes)
//   npm run benchmark:late-game -- measure --fixture=F --hours=1,12,24 [--serialize] [--max-groups=N] [--state-out=F]
//       prints JSON: wall/compute/serialize time, game hours per real second,
//       final digests (compare two revisions on one fixture)
//
// --max-groups is the per-call replay batch (reconcileRuntime's
// replayMaxGroups); the default is the interactive 64 App used to take.
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { reconcileRuntime } from '../src/application/reconcile.ts';
import { freezeNpcCatchupTarget, isNpcCatchupPending } from '../src/application/npc-catchup.ts';
import { createFullWorldFixture, digestState, digestGameState, FULL_WORLD_START_AT } from './benchmark-npc-full-world.mjs';

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

function option(args, name, fallback) {
  const raw = args.find((arg) => arg.startsWith(`--${name}=`));
  return raw ? raw.slice(name.length + 3) : fallback;
}

/** Drives reconcileRuntime to the frozen target like App's catch-up loop. */
export function catchUp(state, targetAt, { maxGroups, serialize = false, progressEveryMs = 0 } = {}) {
  let current = freezeNpcCatchupTarget(state, targetAt);
  let chunks = 0;
  let computeMs = 0;
  let serializeMs = 0;
  let longestChunkMs = 0;
  let maxSaveChars = 0;
  const started = process.hrtime.bigint();
  let lastReport = started;
  while (isNpcCatchupPending(current)) {
    const before = current.npcReplay.processedThroughAt;
    const t0 = process.hrtime.bigint();
    current = reconcileRuntime(current, {
      planetId: current.currentPlanetId, now: targetAt, mode: 'production', testTimeScale: 1,
      ...(maxGroups ? { replayMaxGroups: maxGroups } : {}),
    }).state;
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    computeMs += ms;
    longestChunkMs = Math.max(longestChunkMs, ms);
    chunks += 1;
    if (serialize) {
      const s0 = process.hrtime.bigint();
      maxSaveChars = Math.max(maxSaveChars, JSON.stringify(current).length);
      serializeMs += Number(process.hrtime.bigint() - s0) / 1e6;
    }
    if (isNpcCatchupPending(current) && current.npcReplay.processedThroughAt <= before) throw new Error(`No replay progress at ${before}`);
    if (progressEveryMs && Number(process.hrtime.bigint() - lastReport) / 1e6 >= progressEveryMs) {
      lastReport = process.hrtime.bigint();
      process.stderr.write(`  at ${new Date(current.npcReplay.processedThroughAt).toISOString()} after ${(Number(process.hrtime.bigint() - started) / 1e9).toFixed(0)} s
`);
    }
  }
  return { state: current, chunks, computeMs, serializeMs, longestChunkMs, maxSaveChars, wallMs: Number(process.hrtime.bigint() - started) / 1e6 };
}

function generate(args) {
  const days = option(args, 'days', '3,7').split(',').map(Number).sort((a, b) => a - b);
  const out = option(args, 'out', 'late-game-fixtures');
  const maxGroups = Number(option(args, 'max-groups', '4096'));
  fs.mkdirSync(out, { recursive: true });
  let state = createFullWorldFixture();
  for (const day of days) {
    const run = catchUp(state, FULL_WORLD_START_AT + day * DAY_MS, { maxGroups, progressEveryMs: 60_000 });
    state = run.state;
    const file = path.join(out, `late-game-day-${day}.json`);
    const raw = JSON.stringify(state);
    fs.writeFileSync(file, raw);
    process.stderr.write(`day ${day}: ${(run.wallMs / 1000).toFixed(0)} s, ${run.chunks} chunks, ${(raw.length / 1e6).toFixed(1)} MB -> ${file}\n`);
  }
}

function measure(args) {
  const fixture = option(args, 'fixture');
  if (!fixture) throw new Error('measure needs --fixture=F');
  const hours = option(args, 'hours', '1,12,24').split(',').map(Number);
  const maxGroups = option(args, 'max-groups') ? Number(option(args, 'max-groups')) : undefined;
  const serialize = args.includes('--serialize');
  const stateOut = option(args, 'state-out');
  const raw = fs.readFileSync(fixture, 'utf8');
  const base = JSON.parse(raw);
  const from = base.npcReplay.processedThroughAt;
  const measurements = [];
  for (const hour of hours) {
    const run = catchUp(base, from + hour * HOUR_MS, { maxGroups, serialize });
    if (stateOut) fs.writeFileSync(`${stateOut}.${hour}h.json`, JSON.stringify(run.state));
    const { state, ...numbers } = run;
    measurements.push({
      hours: hour, ...numbers,
      gameHoursPerSecond: hour / (run.wallMs / 1000),
      saveChars: JSON.stringify(state).length,
      digest: digestState(state), gameStateDigest: digestGameState(state),
    });
    process.stderr.write(`${path.basename(fixture)} +${hour}h: ${(run.wallMs / 1000).toFixed(1)} s (${(hour / (run.wallMs / 1000)).toFixed(3)} game h/s), ${run.chunks} chunks\n`);
  }
  const cpus = os.cpus();
  console.log(JSON.stringify({
    benchmark: 'late-game-catchup',
    fixture: { file: fixture, chars: raw.length, sha256: createHash('sha256').update(raw).digest('hex'),
      day: (from - FULL_WORLD_START_AT) / DAY_MS },
    maxGroups: maxGroups ?? 'default', serialize,
    system: { platform: os.platform(), node: process.version, cpuModel: cpus[0]?.model, logicalCpuCount: cpus.length },
    measurements,
  }, null, 2));
}

const [command, ...rest] = process.argv.slice(2);
if (command === 'generate') generate(rest);
else if (command === 'measure') measure(rest);
else throw new Error('usage: late-game-catchup.mjs generate|measure ...');
