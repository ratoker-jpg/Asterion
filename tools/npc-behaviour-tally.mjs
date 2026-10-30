// What NPCs did, day by day, on the full world of benchmark-npc-full-world:
// spy flights, probes lost, attacks, spy reports, and the save size at the end
// of each day. Compares two revisions on one day-0 fixture (rule changes).
//
//   node --experimental-strip-types --experimental-loader ./src/domain/combat/test-asset-loader.mjs \
//     tools/npc-behaviour-tally.mjs --days=3 [--fixture=day0.json | --write-fixture=day0.json] [--out=DIR]
//
// Records are seen by id after every chunk (chunks of --max-groups, default
// 1024, so a flight is seen before the archive drops it).
import fs from 'node:fs';
import path from 'node:path';
import { createFullWorldFixture, FULL_WORLD_START_AT } from './benchmark-npc-full-world.mjs';
import { reconcileRuntime } from '../src/application/reconcile.ts';
import { freezeNpcCatchupTarget, isNpcCatchupPending } from '../src/application/npc-catchup.ts';
import { serializeSaveForStorage } from '../src/application/persistence.ts';

const DAY_MS = 86_400_000;

/** late-game-catchup's catchUp (that module runs its CLI on import). */
function catchUp(initial, targetAt, { maxGroups }) {
  let current = freezeNpcCatchupTarget(initial, targetAt);
  while (isNpcCatchupPending(current)) {
    current = reconcileRuntime(current, {
      planetId: current.currentPlanetId, now: targetAt, mode: 'production', testTimeScale: 1, replayMaxGroups: maxGroups,
    }).state;
  }
  return { state: current };
}
const option = (name, fallback) => process.argv.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;

const days = Number(option('days', '3'));
const maxGroups = Number(option('max-groups', '1024'));
const out = option('out');
const fixture = option('fixture');
let state = fixture ? JSON.parse(fs.readFileSync(fixture, 'utf8')) : createFullWorldFixture();
if (option('write-fixture')) fs.writeFileSync(option('write-fixture'), JSON.stringify(state));
if (out) fs.mkdirSync(out, { recursive: true });

const seenFlights = new Set();
const seenMissions = new Map();
const seenSpyReports = new Set();
const seenBattles = new Set();
const blank = () => ({ flights: {}, spyMissions: 0, probesLost: 0, spyReports: 0, attackBattles: 0, attackFlights: 0, pirateBattles: 0 });
const tallies = [];
let day = blank();

function observe(current) {
  for (const flight of current.flights.records) {
    if (seenFlights.has(flight.id) || flight.ownerSide !== 'npc') continue;
    seenFlights.add(flight.id);
    day.flights[flight.missionId] = (day.flights[flight.missionId] ?? 0) + 1;
    if (flight.missionId === 'attack') day.attackFlights += 1;
  }
  for (const mission of current.espionage?.missions ?? []) {
    const status = seenMissions.get(mission.id);
    if (status === undefined) day.spyMissions += 1;
    if (mission.status === 'destroyed' && status !== 'destroyed') day.probesLost += 1;
    seenMissions.set(mission.id, mission.status);
  }
  for (const report of current.espionage?.reports ?? []) {
    if (seenSpyReports.has(report.id)) continue;
    seenSpyReports.add(report.id);
    if (report.ownerId && report.ownerId !== current.profile.playerId) day.spyReports += 1;
  }
  for (const report of current.combat.reports) {
    if (seenBattles.has(report.id)) continue;
    seenBattles.add(report.id);
    if (report.missionType === 'attack') day.attackBattles += 1;
    else if (report.missionType === 'pirate-raid' || report.missionType === 'pirate-elimination') day.pirateBattles += 1;
  }
}

observe(state);
const startDay = Math.round((state.npcReplay.processedThroughAt - FULL_WORLD_START_AT) / DAY_MS);
for (let d = startDay + 1; d <= days; d += 1) {
  const target = FULL_WORLD_START_AT + d * DAY_MS;
  let current = state;
  // catchUp in slices of one game hour, observing between them.
  for (let at = current.npcReplay.processedThroughAt + 3_600_000; ; at = Math.min(target, at + 3_600_000)) {
    current = catchUp(current, at, { maxGroups }).state;
    observe(current);
    if (at >= target) break;
  }
  state = current;
  const t0 = performance.now();
  const text = serializeSaveForStorage(state, 'production');
  const serializeMs = performance.now() - t0;
  tallies.push({ day: d, ...day, saveChars: text.length, serializeMs: Math.round(serializeMs),
    spyReportsKept: state.espionage?.reports.length ?? 0, flightRecordsKept: state.flights.records.length });
  process.stderr.write(`day ${d}: ${JSON.stringify(tallies.at(-1))}\n`);
  if (out) fs.writeFileSync(path.join(out, `late-game-day-${d}.json`), JSON.stringify(state));
  day = blank();
}
console.log(JSON.stringify({ tally: 'npc-behaviour', maxGroups, days: tallies }, null, 2));
