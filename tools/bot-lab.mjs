// Bot lab (owner request 31.10.2026): instead of 100 NPC × 30 days, a small
// world of ~15 very active bots with different characters runs 1–3 game days
// with the bot journal on for everyone, and an automatic summary names what
// went wrong (Sun raids disbanded, debris left, resources hoarded, no
// fortress, fleets spread thin...). The same tool replays any save with the
// journal on for chosen owners (deterministic: the same save gives the same
// journal), e.g. why the top bot of the owner's world plays as it does.
//
//   node --max-old-space-size=8192 --experimental-strip-types --experimental-loader ./src/domain/combat/test-asset-loader.mjs \
//     tools/bot-lab.mjs [--days=2] [--bots=15] [--fixture=F | --write-fixture=F] [--out=DIR]
//   ... tools/bot-lab.mjs --save=SAVE.json --hours=6 --owners=npc-gen-32[,..] [--out=DIR]
//
// A fresh campaign draws ids from crypto entropy: before/after comparisons run
// both revisions on one fixture written once with --write-fixture.
import fs from 'node:fs';
import path from 'node:path';
import { createInitialSaveState, loadSavedState, serializeSaveForStorage } from '../src/application/persistence.ts';
import { getNpcOwnerIds } from '../src/application/npc-foundation.ts';
import { applyCampaignRuntimeForCatchup } from '../src/application/npc-catchup-runner.ts';
import { advanceLiveWorld, beginLiveWorld } from '../src/application/npc-live-world.ts';
import { formatNpcJournalLines, setNpcJournalSink } from '../src/application/npc-journal.ts';
import { selectOwnerScore } from '../src/domain/rating/scoring.ts';
import { createNpcState } from '../src/domain/npc/state.ts';
import { createDefaultNewGameConfig } from '../src/domain/world/config.ts';

const HOUR = 3_600_000;
const START_AT = Date.UTC(2026, 0, 1);
const option = (name, fallback) => process.argv.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const log = (line) => process.stderr.write(`${line}\n`);

/** Characters the lab gives its bots in turn (traits merged over the seeded ones). */
export const LAB_CHARACTERS = [
  ['fortress', { economyFocus: 0.75, militaryFocus: 0.35, aggression: 0.15, riskTolerance: 0.15, planningHorizon: 0.85, cooperation: 0.6 }],
  ['raider', { aggression: 0.9, militaryFocus: 0.85, riskTolerance: 0.7, economyFocus: 0.35, operationsInterest: 0.6 }],
  ['economist', { economyFocus: 0.95, expansionFocus: 0.8, scienceFocus: 0.7, aggression: 0.1, operationsInterest: 0.7 }],
  ['fleet', { militaryFocus: 0.9, planningHorizon: 0.9, aggression: 0.55, riskTolerance: 0.45, mechanicsKnowledge: 0.85 }],
  ['ally', { cooperation: 0.95, socialStyle: 0.9, militaryFocus: 0.55, economyFocus: 0.55 }],
  ['crystal-hunter', { aggression: 0.75, riskTolerance: 0.9, operationsInterest: 0.9, militaryFocus: 0.7 }],
];

export function createLabWorld(bots = 15) {
  const config = createDefaultNewGameConfig({ seed: 'BOTLAB2026', campaignName: 'Bot lab' });
  config.world = { ...config.world, galaxyCount: 1, npcCount: bots, maxNpcPerSystem: 3, density: 'dense', campaignSpeed: 'fast', randomPlayerStart: false };
  const base = createInitialSaveState('production', START_AT, config);
  const owners = getNpcOwnerIds(base.espionage?.targets, base.profile.playerId);
  const npc = createNpcState(owners, 'bot-lab-persona-salt-v1', START_AT);
  const profiles = {};
  Object.values(npc.profiles).forEach((profile, index) => {
    const [, traits] = LAB_CHARACTERS[index % LAB_CHARACTERS.length];
    profiles[profile.ownerId] = { ...profile, traits: { ...profile.traits, ...traits, attention: Math.max(0.7, profile.traits.attention) },
      activity: { ...profile.activity, propensity: 0.85 + 0.15 * ((index * 7) % 10) / 10 } };
  });
  return { ...base, npc: { ...npc, profiles } };
}

function readSave(file) {
  const raw = fs.readFileSync(file, 'utf8');
  const at = JSON.parse(raw).npcReplay?.processedThroughAt ?? Date.now();
  const loaded = loadSavedState({ mode: 'production', storage: { getItem: () => raw, setItem() {}, removeItem() {} }, saveKey: 'k', now: () => at });
  if (loaded.status !== 'loaded') throw new Error(`${file} does not load: ${loaded.status}`);
  return loaded.state;
}

const sum = (values) => values.reduce((total, value) => total + value, 0);
const median = (values) => { const sorted = [...values].sort((a, b) => a - b); return sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0; };
const positiveSum = (record) => sum(Object.values(record ?? {}).map((value) => Math.max(0, Number(value) || 0)));

/** What the world looks like for the questions the owner asks. */
export function describeWorld(state, journal = []) {
  const playerId = state.profile.playerId;
  const npcPlanets = Object.values(state.espionage?.targets ?? {}).filter((target) => target.kind === 'npc');
  const owners = Object.keys(state.npc?.profiles ?? {});
  const byOwner = new Map(owners.map((ownerId) => [ownerId, npcPlanets.filter((planet) => planet.ownerId === ownerId)]));
  const perOwner = owners.map((ownerId) => {
    const planets = byOwner.get(ownerId);
    const main = planets.find((planet) => planet.id === `${ownerId}-planet`) ?? planets[0];
    const shipsOn = planets.map((planet) => positiveSum(planet.fleet?.ships));
    const score = selectOwnerScore(state, ownerId);
    return {
      ownerId, planets: planets.length,
      points: Math.round(score?.totalPoints ?? 0), battlePoints: Math.round(score?.battlePoints ?? 0),
      resources: Math.round(sum(planets.map((planet) => planet.resources.metal + planet.resources.minerals + planet.resources.gas))),
      mainDefense: positiveSum(main?.defense?.defenses), allDefense: sum(planets.map((planet) => positiveSum(planet.defense?.defenses))),
      ships: sum(shipsOn), fleetOnLargest: sum(shipsOn) ? +(Math.max(...shipsOn) / sum(shipsOn)).toFixed(2) : 0,
      transporters: sum(planets.map((planet) => planet.fleet?.ships?.transporter ?? 0)),
      megaTransporters: sum(planets.map((planet) => planet.fleet?.ships?.['mega-transporter'] ?? 0)),
      recyclers: sum(planets.map((planet) => Object.entries(planet.fleet?.ships ?? {}).filter(([id]) => /recycl/.test(id)).reduce((total, [, count]) => total + count, 0))),
      alliance: state.command.alliances.find((alliance) => alliance.members.some((member) => member.ownerId === ownerId))?.tag ?? null,
    };
  });
  const flights = state.flights.records.filter((flight) => flight.ownerSide === 'npc' && (flight.phase === 'outbound' || flight.phase === 'arrived'));
  const debris = Object.values(state.espionage?.orbitalDebris ?? {});
  const raids = state.sunRaid?.raids ?? [];
  const points = perOwner.map((owner) => owner.points).sort((a, b) => b - a);
  const decisions = journal.filter((entry) => entry.c);
  const started = decisions.filter((entry) => entry.ok === 1);
  const byKind = {};
  for (const entry of started) byKind[entry.k] = (byKind[entry.k] ?? 0) + 1;
  const refusals = {};
  for (const entry of decisions.filter((item) => item.ok === 0)) refusals[entry.r ?? '?'] = (refusals[entry.r ?? '?'] ?? 0) + 1;
  const styles = journal.filter((entry) => entry.k === 'style');
  return {
    worldAt: new Date(state.npcReplay?.processedThroughAt ?? 0).toISOString(), owners: owners.length,
    alliances: state.command.alliances.filter((alliance) => alliance.members.some((member) => member.ownerId !== playerId)).map((alliance) => `${alliance.tag}:${alliance.members.length}`),
    sun: {
      declared: raids.length, disbanded: raids.filter((raid) => raid.status === 'disbanded').length,
      flew: raids.filter((raid) => raid.status === 'incoming' || raid.status === 'resolved').length,
      won: raids.filter((raid) => raid.result?.winner === 'attacker').length,
      alliancesTried: new Set(raids.map((raid) => raid.allianceId)).size,
      crystals: sum(Object.values(state.sunRaid?.crystals ?? {}).map((list) => list.length)), gates: (state.sunRaid?.gates ?? []).length,
    },
    debris: { fields: debris.length, total: Math.round(sum(debris.map((field) => field.debris))), largest: Math.round(Math.max(0, ...debris.map((field) => field.debris))),
      recycleFlightsLive: flights.filter((flight) => flight.missionId === 'recycle').length,
      recycleStarted: started.filter((entry) => /^npc-mission:[^:]+:recycle:/.test(entry.c)).length },
    probesInFlight: flights.filter((flight) => flight.missionId === 'espionage').length,
    resources: { median: median(perOwner.map((owner) => owner.resources)), max: Math.max(0, ...perOwner.map((owner) => owner.resources)) },
    mainDefense: { median: median(perOwner.map((owner) => owner.mainDefense)), max: Math.max(0, ...perOwner.map((owner) => owner.mainDefense)) },
    fleetOnLargestMedian: median(perOwner.map((owner) => owner.fleetOnLargest)),
    transport: { transporters: sum(perOwner.map((owner) => owner.transporters)), mega: sum(perOwner.map((owner) => owner.megaTransporters)) },
    points: { top: points[0] ?? 0, median: median(points), bottom: points.at(-1) ?? 0, topToBottom: points.at(-1) ? +(points[0] / points.at(-1)).toFixed(1) : null },
    actions: { started: started.length, refused: decisions.length - started.length, byKind, topRefusals: Object.entries(refusals).sort((a, b) => b[1] - a[1]).slice(0, 6) },
    styleChanges: styles.length, styles: Object.entries(styles.reduce((counts, entry) => ({ ...counts, [entry.s]: (counts[entry.s] ?? 0) + 1 }), {})),
    perOwner,
  };
}

/** The problems the summary names, in the owner's words. */
export function listProblems(summary) {
  const problems = [];
  if (summary.sun.disbanded && !summary.sun.flew) problems.push(`рейды Солнца распущены: ${summary.sun.disbanded} из ${summary.sun.declared}, ни один не полетел`);
  if (!summary.sun.declared && summary.alliances.length) problems.push('союзы не пробовали Солнце');
  if (summary.debris.total > 0 && summary.debris.recycleFlightsLive + summary.debris.recycleStarted < summary.debris.fields / 2) {
    problems.push(`обломки не собираются: ${summary.debris.fields} полей, ${summary.debris.total} всего, рейсов переработки ${summary.debris.recycleStarted}`);
  }
  if (summary.probesInFlight > 6 * summary.owners) problems.push(`зондов в полёте ${summary.probesInFlight} (${(summary.probesInFlight / summary.owners).toFixed(0)} на бота)`);
  if (summary.mainDefense.max < 2_000) problems.push(`крепости нет: оборона главной планеты максимум ${summary.mainDefense.max}`);
  if (summary.fleetOnLargestMedian < 0.5 && summary.perOwner.some((owner) => owner.planets > 1)) problems.push(`флот размазан: на крупнейшей планете медиана ${Math.round(summary.fleetOnLargestMedian * 100)}% кораблей`);
  if (summary.transport.transporters > 2 * summary.transport.mega && summary.transport.transporters > 50) problems.push(`транспорт ${summary.transport.transporters} против мегатранспорта ${summary.transport.mega}`);
  if (summary.points.topToBottom && summary.points.topToBottom > 20) problems.push(`дно рейтинга отстало: топ/дно ×${summary.points.topToBottom}`);
  return problems;
}

function main() {
  const out = option('out');
  if (out) fs.mkdirSync(out, { recursive: true });
  const save = option('save');
  const owners = option('owners')?.split(',').filter(Boolean);
  let state = save ? readSave(save) : option('fixture') ? readSave(option('fixture')) : createLabWorld(Number(option('bots', '15')));
  if (option('write-fixture')) fs.writeFileSync(option('write-fixture'), serializeSaveForStorage(state, 'production'));
  const at0 = state.npcReplay.processedThroughAt;
  applyCampaignRuntimeForCatchup(state, at0);
  const { summary: _summary, ...replay } = state.npcReplay;
  state = beginLiveWorld({ ...state, npcReplay: { ...replay, targetAt: at0 } });
  const journal = [];
  const styles = new Map();
  const watched = owners ? new Set(owners) : null;
  setNpcJournalSink({
    detailed: (ownerId) => !watched || watched.has(ownerId),
    decision: (entry) => {
      if (watched && !watched.has(entry.ownerId)) return;
      journal.push({ t: entry.at, o: entry.ownerId, k: entry.chosen ? entry.kind : 'wait',
        ...(entry.chosen ? { c: entry.chosen.id, ok: entry.started ? 1 : 0, w: +entry.chosen.weight.toFixed(3) } : {}),
        ...(entry.reason ? { r: entry.reason } : {}),
        ...(entry.alternatives.length ? { alt: entry.alternatives.map((item) => [item.id, +item.weight.toFixed(3)]) } : {}), s: entry.strategy });
    },
    style: (entry) => {
      if ((watched && !watched.has(entry.ownerId)) || styles.get(entry.ownerId) === entry.style) return;
      journal.push({ t: entry.at, o: entry.ownerId, k: 'style', s: entry.style, d: { from: styles.get(entry.ownerId) ?? null, why: entry.reason } });
      styles.set(entry.ownerId, entry.style);
    },
  });
  const hours = save ? Number(option('hours', '6')) : Number(option('days', '2')) * 24;
  const days = [];
  const startedAt = performance.now();
  let groups;
  for (let hour = 1; hour <= hours; hour += 1) {
    const step = advanceLiveWorld(state, at0 + hour * HOUR, { groups });
    state = step.state;
    groups = step.groups;
    if (hour % 24 === 0 || hour === hours) {
      const summary = describeWorld(state, journal);
      days.push({ hour, problems: listProblems(summary), ...summary });
      log(`lab h${hour} (${Math.round((performance.now() - startedAt) / 1000)} s): ${JSON.stringify({ sun: summary.sun, debris: summary.debris, points: summary.points, problems: listProblems(summary) })}`);
    }
  }
  setNpcJournalSink(null);
  const result = { tool: 'bot-lab', source: save ? path.basename(save) : option('fixture') ? path.basename(option('fixture')) : 'fresh lab world',
    hours, wallSeconds: Math.round((performance.now() - startedAt) / 1000), journalEntries: journal.length, days };
  if (out) {
    fs.writeFileSync(path.join(out, 'summary.json'), JSON.stringify(result, null, 2));
    fs.writeFileSync(path.join(out, 'bots-journal.jsonl'), formatNpcJournalLines(journal));
    fs.writeFileSync(path.join(out, 'world.json'), serializeSaveForStorage(state, 'production'));
  }
  console.log(JSON.stringify({ ...result, days: days.map(({ perOwner: _perOwner, ...day }) => day) }, null, 2));
}

if (import.meta.url === `file://${process.argv[1]?.replace(/\\/g, '/').replace(/^(?=[A-Za-z]:)/, '/')}`) main();
