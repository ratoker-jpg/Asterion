// Why do NPC points go DOWN? Runs the bot lab hour by hour and, every time an
// owner's resource points fall, prints what changed (buildings, ships, defences,
// queues, flights, science) and which battles/flights happened that hour.
//   node --max-old-space-size=8192 --experimental-strip-types --experimental-loader ./src/domain/combat/test-asset-loader.mjs \
//     tools/score-drops.mjs [--days=2] [--bots=15] [--seed=1] [--out=FILE.json]
import fs from 'node:fs';
import { createLabWorld } from './bot-lab.mjs';
import { loadSavedState, serializeSaveForStorage } from '../../src/application/persistence.ts';
import { applyCampaignRuntimeForCatchup } from '../../src/application/npc-catchup-runner.ts';
import { advanceLiveWorld, beginLiveWorld } from '../../src/application/npc-live-world.ts';
import { selectOwnerScore } from '../../src/domain/rating/scoring.ts';
import { getFactionDefenseCatalog, getFactionShipCatalog } from '../../src/domain/combat/faction-catalog.ts';

const HOUR = 3_600_000;
const option = (name, fallback) => process.argv.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const sum = (values) => values.reduce((total, value) => total + value, 0);

function snapshot(state, ownerId) {
  const planets = Object.values(state.espionage.targets).filter((target) => target.kind === 'npc' && target.ownerId === ownerId);
  const ships = {}; const defenses = {}; const buildings = {};
  let queue = 0;
  for (const planet of planets) {
    for (const [id, count] of Object.entries(planet.fleet?.ships ?? {})) ships[id] = (ships[id] ?? 0) + count;
    for (const [id, count] of Object.entries(planet.defense?.defenses ?? {})) defenses[id] = (defenses[id] ?? 0) + count;
    for (const [id, level] of Object.entries(planet.buildings ?? {})) buildings[id] = (buildings[id] ?? 0) + Number(level);
    for (const item of planet.buildingQueue ?? []) queue += (item.cost?.metal ?? 0) + (item.cost?.minerals ?? 0) + (item.cost?.gas ?? 0);
  }
  const flying = {};
  for (const flight of state.flights.records) {
    if (flight.ownerSide !== 'npc' || flight.ownerId !== ownerId) continue;
    if (!['outbound', 'returning', 'arrived'].includes(flight.phase)) continue;
    for (const [id, count] of Object.entries(flight.selectedShips ?? {})) flying[id] = (flying[id] ?? 0) + count;
  }
  return { planets: planets.length, ships, defenses, buildings, queue, flying, science: state.npcScience?.owners?.[ownerId]?.levels ?? {},
    unrecovered: state.rating.unrecoveredCostsByOwnerId[ownerId] ?? null };
}
function diff(before, after) {
  const out = {};
  for (const key of ['ships', 'defenses', 'buildings', 'flying', 'science']) {
    const changes = {};
    for (const id of new Set([...Object.keys(before[key]), ...Object.keys(after[key])])) {
      const delta = (after[key][id] ?? 0) - (before[key][id] ?? 0);
      if (delta) changes[id] = delta;
    }
    if (Object.keys(changes).length) out[key] = changes;
  }
  if (before.planets !== after.planets) out.planets = after.planets - before.planets;
  if (before.queue !== after.queue) out.queueValue = Math.round(after.queue - before.queue);
  if (JSON.stringify(before.unrecovered) !== JSON.stringify(after.unrecovered)) out.unrecovered = [before.unrecovered, after.unrecovered];
  return out;
}

const days = Number(option('days', '2'));
// --dump-at=H writes the world after hour H (--dump=FILE); --load=FILE continues from such a dump (hours then count from it).
function readDump(file) {
  const raw = fs.readFileSync(file, 'utf8');
  const at = JSON.parse(raw).npcReplay?.processedThroughAt ?? Date.now();
  const loaded = loadSavedState({ mode: 'production', storage: { getItem: () => raw, setItem() {}, removeItem() {} }, saveKey: 'k', now: () => at });
  if (loaded.status !== 'loaded') throw new Error(`${file} does not load: ${loaded.status}`);
  return loaded.state;
}
let state = option('load') ? readDump(option('load')) : createLabWorld(Number(option('bots', '15')), option('seed') ? `BOTLAB-${option('seed')}` : 'BOTLAB2026');
const at0 = state.npcReplay.processedThroughAt;
applyCampaignRuntimeForCatchup(state, at0);
const { summary: _s, ...replay } = state.npcReplay;
state = beginLiveWorld({ ...state, npcReplay: { ...replay, targetAt: at0 } });
const owners = Object.keys(state.npc.profiles);
let groups;
const drops = [];
let prev = new Map(owners.map((id) => [id, { score: selectOwnerScore(state, id)?.resourcePoints ?? 0, snap: snapshot(state, id) }]));
const reportsSeen = new Set((state.combat?.reports ?? []).map((report) => report.id));
const hoursToRun = option('hours') ? Number(option('hours')) : days * 24;
let flightsBefore = new Map();
for (let hour = 1; hour <= hoursToRun; hour += 1) {
  flightsBefore = new Map(state.flights.records.map((flight) => [flight.id, flight.phase]));
  const step = advanceLiveWorld(state, at0 + hour * HOUR, { groups });
  state = step.state; groups = step.groups;
  if (option('dump-at') && hour === Number(option('dump-at'))) { fs.writeFileSync(option('dump'), serializeSaveForStorage(state, 'production')); console.log('dumped'); process.exit(0); }
  const newReports = (state.combat?.reports ?? []).filter((report) => !reportsSeen.has(report.id));
  newReports.forEach((report) => reportsSeen.add(report.id));
  for (const id of owners) {
    const score = selectOwnerScore(state, id)?.resourcePoints ?? 0;
    const was = prev.get(id);
    const snap = snapshot(state, id);
    if (score < was.score) {
      const flights = state.flights.records.filter((flight) => (flight.ownerId === id || flight.ownerSide === 'npc' && flight.ownerId === id) && flightsBefore.get(flight.id) !== flight.phase)
        .map((flight) => ({ id: flight.id, mission: flight.missionId, side: flight.ownerSide, was: flightsBefore.get(flight.id) ?? 'new', phase: flight.phase, reason: flight.completionReason, ships: flight.selectedShips }));
      const context = option('explain') ? {
        lastReports: (state.combat?.reports ?? []).slice(-6).map((r) => ({ id: r.id, mission: r.missionType, att: r.attacker?.playerId, def: r.defender?.playerId, winner: r.winner, at: r.createdAt ?? r.at })),
        claims: Object.values(state.exploration?.contacts ?? {}).filter((c) => c.claim?.ownerId === id || c.events?.some((e) => e.ownerId === id && e.at > at0 + (hour - 1) * HOUR)).map((c) => ({ id: c.id, claim: c.claim?.ownerId, events: c.events.filter((e) => e.at > at0 + (hour - 1) * HOUR).map((e) => [e.kind, e.ownerId, e.at]) })),
        flightsOfOwner: state.flights.records.filter((f) => f.ownerId === id).map((f) => ({ id: f.id, m: f.missionId, p: f.phase, r: f.completionReason, exp: f.explorationAttack, dep: f.departedAt, ships: f.selectedShips })).slice(-12),
        scoutLossReports: newReports.filter((r) => [...(r.defenderForce?.stacks ?? []), ...(r.attackerForce?.stacks ?? [])].some((st) => st.entityId === 'scout' && st.countBefore - st.countAfter === 288)).map((r) => ({ id: r.id, mission: r.missionType, att: r.attacker, def: r.defender, winner: r.winner })),
        reportCount: [(state.combat?.reports ?? []).length],
      } : undefined;
      drops.push({ hour, owner: id, from: was.score, to: score, delta: score - was.score, change: diff(was.snap, snap), flights, context,
        battles: newReports.filter((r) => r.attacker?.playerId === id || r.defender?.playerId === id)
          .map((r) => ({ mission: r.missionType, att: r.attacker?.playerId, def: r.defender?.playerId, winner: r.winner })) });
    }
    prev.set(id, { score, snap });
  }
}
const byCause = {};
for (const drop of drops) {
  const keys = Object.keys(drop.change);
  const cause = (drop.battles.length ? 'battle:' + [...new Set(drop.battles.map((b) => b.mission))].join('+') + ' ' : '') + keys.join(',');
  byCause[cause] = byCause[cause] ?? { count: 0, points: 0 };
  byCause[cause].count += 1; byCause[cause].points += drop.delta;
}
const result = { days, owners: owners.length, drops: drops.length, byCause: Object.entries(byCause).sort((a, b) => a[1].points - b[1].points), sample: [...drops].sort((a, b) => a.delta - b.delta).slice(0, 25),
  withoutBattle: drops.filter((drop) => !drop.battles.length) };
if (option('out')) fs.writeFileSync(option('out'), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
