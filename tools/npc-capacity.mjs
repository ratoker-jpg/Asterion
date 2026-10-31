// What NPCs cost the living world: catch-up speed, the share of NPC decisions
// in it, memory and save size, for 100/150 NPC and an "everyone online"
// upper bound. Measurement only; the game's rules are untouched (see
// npc-capacity-loader.mjs for the three in-process patches it may apply).
//
//   node --expose-gc --max-old-space-size=8192 --experimental-strip-types \
//     --experimental-loader ./tools/npc-capacity-loader.mjs tools/npc-capacity.mjs <command> [options]
//
// Commands:
//   run --npc=N --days=D --out=DIR [--galaxies=2 --per-system=3 --density=dense --speed=fast]
//       New campaign, then the server's own live-world steps (advanceLiveWorld)
//       game hour by game hour. One JSON line per hour to DIR/hours.jsonl and
//       the world at the end of each day to DIR/day-N.json.
//       ASTERION_BENCH_NPC_MAX=150 for more than 100 NPC; ASTERION_BENCH_ALL_ONLINE=1
//       for the everyone-online bound.
//   probe --fixture=F [--minutes=60] [--ticks=60]
//       One sampled CPU profile of F's next game minutes (time by area and the
//       top functions), then live ticks of one second each (the PC worker's step).
//   calendar --fixture=F [--days=1]
//       Online share and simultaneous online owners from the NPC calendars.
//   calibrate --save=F [--hours=1]
//       Catch-up speed on a real save (same steps as the server's runner).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { Session } from 'node:inspector/promises';
import { createInitialSaveState, loadSavedState, serializeSaveForStorage } from '../src/application/persistence.ts';
import { getNpcOwnerIds } from '../src/application/npc-foundation.ts';
import { applyCampaignRuntimeForCatchup } from '../src/application/npc-catchup-runner.ts';
import { advanceLiveWorld, beginLiveWorld } from '../src/application/npc-live-world.ts';
import { reconcileRuntime } from '../src/application/reconcile.ts';
import { getNpcSessionEvents } from '../src/domain/npc/calendar.ts';
import { createNpcState } from '../src/domain/npc/state.ts';
import { createDefaultNewGameConfig } from '../src/domain/world/config.ts';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const START_AT = Date.UTC(2026, 0, 1);
const bench = globalThis.__npcBench = { attention: 0, idle: 0, actions: 0, attentionMs: 0 };
const option = (name, fallback) => process.argv.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const flag = (name) => process.argv.includes(`--${name}`);
const log = (line) => process.stderr.write(`${line}\n`);
const mb = (bytes) => Math.round(bytes / 1048576);

function memory() {
  const usage = process.memoryUsage();
  return { rssMb: mb(usage.rss), heapUsedMb: mb(usage.heapUsed) };
}

function heapAfterGc() {
  globalThis.gc?.();
  return mb(process.memoryUsage().heapUsed);
}

function readSave(file, at) {
  const raw = fs.readFileSync(file, 'utf8');
  const parsed = JSON.parse(raw);
  const now = at ?? parsed.npcReplay?.processedThroughAt ?? Date.now();
  const loaded = loadSavedState({ mode: 'production', storage: { getItem: () => raw, setItem() {}, removeItem() {} }, saveKey: 'k', now: () => now });
  if (loaded.status !== 'loaded') throw new Error(`${file} does not load: ${loaded.status}`);
  return loaded.state;
}

function onlineNow(state) {
  return Object.values(state.npc?.profiles ?? {}).filter((profile) => profile.session.active).length;
}

function saveSize(state) {
  const t0 = performance.now();
  const text = serializeSaveForStorage(state, 'production');
  const serializeMs = performance.now() - t0;
  return { saveMb: +(Buffer.byteLength(text, 'utf8') / 1048576).toFixed(1), gzMb: +(zlib.gzipSync(text, { level: 6 }).length / 1048576).toFixed(1), serializeMs: Math.round(serializeMs), text };
}

function createWorld(npc, { galaxies, perSystem, density, speed }) {
  const config = createDefaultNewGameConfig({ seed: 'NPCCAPACITY2026', campaignName: `NPC capacity ${npc}` });
  config.world = { ...config.world, galaxyCount: galaxies, npcCount: npc, maxNpcPerSystem: perSystem, density, campaignSpeed: speed, randomPlayerStart: false };
  const base = createInitialSaveState('production', START_AT, config);
  const owners = getNpcOwnerIds(base.espionage?.targets, base.profile.playerId);
  if (owners.length !== npc) throw new Error(`Expected ${npc} NPC owners, got ${owners.length} (ASTERION_BENCH_NPC_MAX?)`);
  return { ...base, npc: createNpcState(owners, 'npc-capacity-persona-salt-v1', START_AT) };
}

/** Moves the world one step of the server's runner to `until`; numbers of that step. */
function liveStep(state, until, groups) {
  const before = { ...bench };
  const cpu0 = process.cpuUsage();
  const t0 = performance.now();
  const step = advanceLiveWorld(state, until, { groups });
  const wallMs = performance.now() - t0;
  const cpu = process.cpuUsage(cpu0);
  return {
    step,
    numbers: {
      wallMs: Math.round(wallMs), cpuMs: Math.round((cpu.user + cpu.system) / 1000), chunks: step.chunks,
      attention: bench.attention - before.attention, idle: bench.idle - before.idle, actions: bench.actions - before.actions,
      attentionMs: Math.round(bench.attentionMs - before.attentionMs),
    },
  };
}

async function run() {
  const npc = Number(option('npc', '100'));
  const days = Number(option('days', '3'));
  const out = option('out');
  if (!out) throw new Error('--out=DIR');
  fs.mkdirSync(out, { recursive: true });
  const world = { galaxies: Number(option('galaxies', '2')), perSystem: Number(option('per-system', '3')), density: option('density', 'dense'), speed: option('speed', 'fast') };
  let state = option('from') ? readSave(option('from')) : createWorld(npc, world);
  applyCampaignRuntimeForCatchup(state, state.npcReplay.processedThroughAt);
  state = beginLiveWorld(state);
  const hoursFile = path.join(out, 'hours.jsonl');
  const meta = { npc, days, world, allOnline: process.env.ASTERION_BENCH_ALL_ONLINE === '1', startedAt: new Date().toISOString(),
    planets: Object.keys(state.espionage?.targets ?? {}).length, node: process.version, cpu: os.cpus()[0]?.model };
  fs.writeFileSync(path.join(out, 'meta.json'), JSON.stringify(meta, null, 2));
  let groups;
  let peakRssMb = 0;
  for (let at = state.npcReplay.processedThroughAt + HOUR; at <= START_AT + days * DAY; at += HOUR) {
    const { step, numbers } = liveStep(state, at, groups);
    state = step.state;
    groups = step.groups;
    const mem = memory();
    peakRssMb = Math.max(peakRssMb, mem.rssMb);
    const hour = Math.round((at - START_AT) / HOUR);
    const row = { hour, ...numbers, online: onlineNow(state), ...mem, peakRssMb };
    fs.appendFileSync(hoursFile, `${JSON.stringify(row)}\n`);
    log(`${path.basename(out)} h${hour}: ${numbers.wallMs} ms, attention ${numbers.attention} (${numbers.attentionMs} ms), idle ${numbers.idle}, online ${row.online}, rss ${mem.rssMb} MB`);
    if (hour % 24 === 0) {
      const size = saveSize(state);
      const day = { day: hour / 24, saveMb: size.saveMb, gzMb: size.gzMb, serializeMs: size.serializeMs, heapAfterGcMb: heapAfterGc(), ...memory(), peakRssMb,
        flights: state.flights.records.length, combatReports: state.combat.reports.length };
      fs.writeFileSync(path.join(out, `day-${hour / 24}.json`), size.text);
      fs.appendFileSync(path.join(out, 'days.jsonl'), `${JSON.stringify(day)}\n`);
      log(`${path.basename(out)} day ${day.day}: ${JSON.stringify(day)}`);
    }
  }
}

/** Areas of the world step, by the outermost function of a sample's stack that names one. */
const AREAS = [
  ['npc-decisions', ['applyNpcReplayEventsAt']],
  ['npc-event-generation', ['cachedOwnerStepEvents', 'generateNpcOwnerReplayEvents', 'initializeNpcReplaySessionsAt']],
  ['npc-economy-settle', ['settleNpcEconomies', 'settleNpcOwnersAt', 'completeNpcScience', 'nextNpcTargetCheckpoint']],
  ['flights-and-battles', ['processFlightsAt', 'reconcileFlights', 'nextDueFlightCheckpoint', 'collectFlightTimes']],
  ['pirates', ['resolveDuePirateRoll', 'ensureRaidEvent', 'restartRaidSelection', 'raidSystemFootprint', 'computeRaidSystemFootprint', 'selectDuePirateRaidRolls']],
  ['exploration-npc', ['selectDueExplorationNpcRolls', 'resolveDueExplorationNpcRoll']],
  ['archive-pruning', ['pruneCampaignHistory']],
  ['overpopulation', ['reconcileAllPlanetOverpopulation']],
  ['asteroids-sun', ['applyAsteroidTransitionsAt', 'advanceAsteroidGasForSimulationAt', 'initializeAsteroidGasForSimulationAt', 'reconcileSunRaids', 'nextSunStepAt', 'publishSunBrightness']],
  ['player-planets', ['reconcilePlanetWork']],
  ['rating-summary', ['selectOwnerScore', 'recordHighestExplorationScore', 'accumulateWorldCatchupSummary', 'countWorldBattles', 'countNewWorldBattles']],
  ['aid-command', ['reconcileAidMembership', 'syncAidState', 'settleLeadership', 'nextLeadershipCheckpoint']],
];

function analyseProfile(profile, { top = 25, within } = {}) {
  const nodes = new Map(profile.nodes.map((node) => [node.id, node]));
  const parent = new Map();
  for (const node of profile.nodes) for (const child of node.children ?? []) parent.set(child, node.id);
  const areaMs = {};
  const inclusive = new Map();
  const self = new Map();
  let totalMs = 0;
  const key = (node) => `${node.callFrame.functionName || '(anonymous)'} ${path.basename(node.callFrame.url || '')}:${node.callFrame.lineNumber + 1}`;
  profile.samples.forEach((id, index) => {
    const ms = (profile.timeDeltas[index + 1] ?? profile.timeDeltas[index] ?? 0) / 1000;
    const leaf = nodes.get(id);
    const stack = [];
    for (let cursor = id; cursor !== undefined; cursor = parent.get(cursor)) stack.push(nodes.get(cursor));
    const names = stack.map((node) => node.callFrame.functionName);
    if (leaf.callFrame.functionName === '(idle)' || leaf.callFrame.functionName === '(program)') return;
    totalMs += ms;
    let area = leaf.callFrame.functionName === '(garbage collector)' ? 'gc' : 'other';
    if (area === 'other') {
      for (let depth = names.length - 1; depth >= 0 && area === 'other'; depth -= 1) {
        const found = AREAS.find(([, functions]) => functions.includes(names[depth]));
        if (found) area = found[0];
      }
    }
    areaMs[area] = (areaMs[area] ?? 0) + ms;
    if (within && !names.includes(within)) return;
    self.set(key(leaf), (self.get(key(leaf)) ?? 0) + ms);
    for (const k of new Set(stack.map(key))) inclusive.set(k, (inclusive.get(k) ?? 0) + ms);
  });
  const sorted = (map) => [...map].sort((a, b) => b[1] - a[1]).slice(0, top).map(([name, ms]) => ({ name, ms: Math.round(ms) }));
  return {
    totalMs: Math.round(totalMs),
    areas: Object.fromEntries(Object.entries(areaMs).sort((a, b) => b[1] - a[1]).map(([name, ms]) => [name, { ms: Math.round(ms), share: +(ms / totalMs).toFixed(3) }])),
    inclusive: sorted(inclusive), self: sorted(self),
  };
}

async function probe() {
  const fixture = option('fixture');
  const minutes = Number(option('minutes', '60'));
  const ticks = Number(option('ticks', '60'));
  let state = readSave(fixture);
  const at0 = state.npcReplay.processedThroughAt;
  applyCampaignRuntimeForCatchup(state, at0);
  state = beginLiveWorld(state);
  const session = new Session();
  session.connect();
  await session.post('Profiler.enable');
  await session.post('Profiler.setSamplingInterval', { interval: 500 });
  await session.post('Profiler.start');
  const { step, numbers } = liveStep(state, at0 + minutes * 60_000, undefined);
  const { profile } = await session.post('Profiler.stop');
  session.disconnect();
  const whole = analyseProfile(profile);
  const decisions = analyseProfile(profile, { within: 'applyNpcReplayEventsAt', top: 30 });
  // The PC worker: one reconcileRuntime per second of the clock, from the probe's end.
  let live = step.state;
  const at1 = live.npcReplay.processedThroughAt;
  const tickMs = [];
  for (let tick = 1; tick <= ticks; tick += 1) {
    const t0 = performance.now();
    live = reconcileRuntime(live, { planetId: live.currentPlanetId, now: at1 + tick * 1000, mode: 'production', testTimeScale: 1 }).state;
    tickMs.push(performance.now() - t0);
  }
  const sorted = [...tickMs].sort((a, b) => a - b);
  const q = (p) => +sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))].toFixed(1);
  console.log(JSON.stringify({
    fixture: path.basename(fixture), minutes, profiledStep: numbers, online: onlineNow(state), ...memory(),
    areas: whole.areas, profiledMs: whole.totalMs, topInclusive: whole.inclusive, topSelf: whole.self,
    decisionsInclusive: decisions.inclusive, decisionsSelf: decisions.self,
    liveTicks: { count: ticks, medianMs: q(0.5), p95Ms: q(0.95), maxMs: q(1), meanMs: +(tickMs.reduce((a, b) => a + b, 0) / ticks).toFixed(1) },
  }, null, 2));
}

function calendar() {
  const state = readSave(option('fixture'));
  const days = Number(option('days', '1'));
  const from = state.npcReplay.processedThroughAt;
  const to = from + days * DAY;
  const profiles = Object.values(state.npc.profiles);
  const minuteOnline = new Uint16Array(Math.ceil((to - from) / 60_000));
  const share = [];
  for (const profile of profiles) {
    const events = getNpcSessionEvents(profile, from - 3 * HOUR, to);
    let online = 0;
    let startedAt = profile.session.active ? from : null;
    const close = (end) => {
      const a = Math.max(from, startedAt);
      if (end > a) { online += end - a; for (let m = Math.floor((a - from) / 60_000); m < Math.floor((end - from) / 60_000); m += 1) minuteOnline[m] += 1; }
      startedAt = null;
    };
    for (const event of events) {
      if (event.boundary === 'session-start') startedAt = event.at;
      else if (startedAt !== null) close(event.at);
    }
    if (startedAt !== null) close(to);
    share.push(online / (to - from));
  }
  const counts = [...minuteOnline].sort((a, b) => a - b);
  const q = (p) => counts[Math.min(counts.length - 1, Math.floor(p * counts.length))];
  share.sort((a, b) => a - b);
  console.log(JSON.stringify({
    fixture: path.basename(option('fixture')), owners: profiles.length, days,
    onlineShare: { mean: +(share.reduce((a, b) => a + b, 0) / share.length).toFixed(3), min: +share[0].toFixed(3), median: +share[Math.floor(share.length / 2)].toFixed(3), max: +share.at(-1).toFixed(3) },
    simultaneous: { mean: +(counts.reduce((a, b) => a + b, 0) / counts.length).toFixed(1), median: q(0.5), p95: q(0.95), max: counts.at(-1), min: counts[0] },
  }, null, 2));
}

function calibrate() {
  const hours = Number(option('hours', '1'));
  let state = readSave(option('save'));
  const at0 = state.npcReplay.processedThroughAt;
  applyCampaignRuntimeForCatchup(state, at0);
  state = beginLiveWorld(state);
  const rows = [];
  let groups;
  for (let h = 1; h <= hours * 4; h += 1) {
    const { step, numbers } = liveStep(state, at0 + h * HOUR / 4, groups);
    state = step.state;
    groups = step.groups;
    rows.push({ quarter: h, ...numbers, online: onlineNow(state), ...memory() });
    log(`calibrate q${h}: ${JSON.stringify(rows.at(-1))}`);
  }
  const cpuMs = rows.reduce((sum, row) => sum + row.cpuMs, 0);
  const wallMs = rows.reduce((sum, row) => sum + row.wallMs, 0);
  console.log(JSON.stringify({ save: 'owner save (copy, read only)', fromUtc: new Date(at0).toISOString(), hours,
    planets: Object.keys(state.espionage.targets).length, owners: Object.keys(state.npc.profiles).length,
    wallMs, cpuMs, speedX: +(hours * HOUR / wallMs).toFixed(2), rows }, null, 2));
}

const command = process.argv[2];
if (command === 'run') await run();
else if (command === 'probe') await probe();
else if (command === 'calendar') calendar();
else if (command === 'calibrate') calibrate();
else throw new Error('command: run | probe | calendar | calibrate');
