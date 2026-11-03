// NPC growth lab (owner playtest 03.11.2026: NPC far behind an active player).
// A fresh world of the owner's playtest config (N NPC, speed ×5, activity «max»)
// runs hour by hour and every sample prints the growth numbers: points,
// income per hour, building levels, share of idle build queues, science, robots.
//
//   node --max-old-space-size=8192 --experimental-strip-types --experimental-loader ./src/domain/combat/test-asset-loader.mjs \
//     tools/npc-growth-lab.mjs [--bots=50] [--hours=24] [--seed=GROWTH1] [--speed=superfast] [--activity=max] [--samples=1,3,6,24] [--out=FILE.json]
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import { createInitialSaveState } from '../src/application/persistence.ts';
import { applyCampaignRuntimeForCatchup } from '../src/application/npc-catchup-runner.ts';
import { advanceLiveWorld, beginLiveWorld } from '../src/application/npc-live-world.ts';
import { selectOwnerScore } from '../src/domain/rating/scoring.ts';
import { createDefaultNewGameConfig } from '../src/domain/world/config.ts';
import { getNpcPlanetIncomePerHour } from '../src/application/npc-economy.ts';
import { getProductionBotAssignmentTotal } from '../src/domain/buildings/production-bots.ts';

const HOUR = 3_600_000;
const START_AT = Date.UTC(2026, 10, 3, 14, 26);
const option = (name, fallback) => process.argv.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const log = (line) => process.stderr.write(`${line}\n`);
const sum = (list) => list.reduce((total, value) => total + value, 0);
const sorted = (list) => [...list].sort((a, b) => a - b);
const quantile = (list, q) => { const s = sorted(list); return s.length ? s[Math.min(s.length - 1, Math.floor(q * s.length))] : 0; };
const median = (list) => quantile(list, 0.5);

export function createGrowthWorld({ bots, seed, speed, activity }) {
  const config = createDefaultNewGameConfig({ seed, campaignName: 'NPC growth' });
  config.world = { ...config.world, galaxyCount: 1, npcCount: bots, campaignSpeed: speed, npcActivity: activity, randomPlayerStart: false };
  return createInitialSaveState('production', START_AT, config);
}

const SCALE = { slow: 0.5, standard: 1, fast: 2, superfast: 5 };

/** What the NPC took from unique objects (the lab has no player flights): extracted stock, hauls brought home, claims taken. */
function uniqueStats(state) {
  const contacts = Object.values(state.exploration?.contacts ?? {});
  const events = contacts.flatMap((contact) => contact.events ?? []);
  const sumCargo = (cargo) => Object.values(cargo ?? {}).reduce((total, value) => total + (Number(value) || 0), 0);
  const released = events.filter((event) => /:release$/.test(event.id));
  return { contacts: contacts.length, extracted: Math.round(sum(contacts.map((contact) => sumCargo(contact.extractedByType)))),
    releases: released.length, broughtHome: Math.round(sum(released.map((event) => sumCargo(event.cargo)))),
    recalled: released.filter((event) => event.kind === 'recalled').length };
}

export function sampleGrowth(state, at, speed) {
  const scale = SCALE[speed] ?? 1;
  const owners = Object.keys(state.npc.profiles);
  const planets = Object.values(state.espionage.targets).filter((target) => target.kind === 'npc');
  const busy = (queue) => (queue ?? []).some((order) => order.finishAt > at);
  const rows = owners.map((ownerId) => {
    const own = planets.filter((planet) => planet.ownerId === ownerId);
    const main = own.find((planet) => planet.id === `${ownerId}-planet`) ?? own[0];
    const science = main?.ownerProfile?.scienceLevels ?? {};
    const queue = state.npc.profiles[ownerId];
    return {
      ownerId, planets: own.length, points: Math.round(selectOwnerScore(state, ownerId)?.totalPoints ?? 0),
      income: sum(own.map((planet) => getNpcPlanetIncomePerHour(planet, scale))),
      buildIdle: own.filter((planet) => !busy(planet.buildingQueue)).length,
      bots: sum(own.map((planet) => getProductionBotAssignmentTotal(planet.productionBots ?? { metal: 0, minerals: 0, gas: 0 }))),
      scienceTotal: sum(Object.values(science)), mathematics: science[3] ?? 0,
      stores: sum(own.map((planet) => planet.resources.metal + planet.resources.minerals + planet.resources.gas)),
      metalMine: main?.buildings?.['metal-production-1'] ?? 0, mineralMine: main?.buildings?.['mineral-production-1'] ?? 0,
      gasMine: main?.buildings?.['gas-production-1'] ?? 0, energy: (main?.buildings?.['basic-energy'] ?? 0),
      factory: main?.buildings?.['advanced-factory'] ?? 0, lab: main?.buildings?.research ?? 0,
      propensity: +(state.npc.profiles[ownerId].activity.propensity ?? 0).toFixed(2), sessions: state.npc.profiles[ownerId].activity.completedSessions,
      cursorAt: state.npc.profiles[ownerId].cursor?.at ?? null, idleUntil: state.npc.profiles[ownerId].session.idleUntil ?? null,
      main,
    };
  });
  const pts = rows.map((row) => row.points);
  return {
    hour: Math.round((at - START_AT) / HOUR),
    points: { top: Math.max(...pts), p90: quantile(pts, 0.9), median: median(pts), bottom: Math.min(...pts) },
    incomePerHour: { median: Math.round(median(rows.map((row) => row.income))), top: Math.round(Math.max(...rows.map((row) => row.income))) },
    planetsMedian: median(rows.map((row) => row.planets)),
    buildQueueIdleShare: +(sum(rows.map((row) => row.buildIdle)) / Math.max(1, sum(rows.map((row) => row.planets)))).toFixed(3),
    mainBuildIdleShare: +(rows.filter((row) => !busy(row.main?.buildingQueue)).length / rows.length).toFixed(3),
    levels: { metalMine: median(rows.map((row) => row.metalMine)), mineralMine: median(rows.map((row) => row.mineralMine)),
      gasMine: median(rows.map((row) => row.gasMine)), energy: median(rows.map((row) => row.energy)), factory: median(rows.map((row) => row.factory)), lab: median(rows.map((row) => row.lab)) },
    science: { totalMedian: median(rows.map((row) => row.scienceTotal)), mathematicsMedian: median(rows.map((row) => row.mathematics)) },
    botsAssignedMedian: median(rows.map((row) => row.bots)),
    storesMedian: Math.round(median(rows.map((row) => row.stores))),
    unique: uniqueStats(state),
    rows,
  };
}

function main() {
  const bots = Number(option('bots', '50'));
  const hours = Number(option('hours', '24'));
  const speed = option('speed', 'superfast');
  const wanted = new Set(option('samples', '1,3,6,12,24').split(',').map(Number));
  let state = createGrowthWorld({ bots, seed: option('seed', 'GROWTH1'), speed, activity: option('activity', 'max') });
  const at0 = state.npcReplay.processedThroughAt;
  applyCampaignRuntimeForCatchup(state, at0);
  const { summary: _summary, ...replay } = state.npcReplay;
  state = beginLiveWorld({ ...state, npcReplay: { ...replay, targetAt: at0 } });
  const samples = [];
  let groups;
  const startedAt = performance.now();
  for (let hour = 1; hour <= hours; hour += 1) {
    const step = advanceLiveWorld(state, at0 + hour * HOUR, { groups });
    state = step.state; groups = step.groups;
    if (wanted.has(hour) || hour === hours) {
      const { rows, ...sample } = sampleGrowth(state, at0 + hour * HOUR, speed);
      samples.push({ ...sample, wallSeconds: Math.round((performance.now() - startedAt) / 1000) });
      log(`h${hour} (${samples.at(-1).wallSeconds}s): ${JSON.stringify(sample)}`);
      if (option('out') && hour === hours) fs.writeFileSync(option('out').replace(/\.json$/, '.rows.json'), JSON.stringify(rows.map(({ main, ...row }) => row)));
    }
  }
  const result = { tool: 'npc-growth-lab', bots, speed, activity: option('activity', 'max'), seed: option('seed', 'GROWTH1'), hours, wallSeconds: Math.round((performance.now() - startedAt) / 1000), samples };
  if (option('out')) fs.writeFileSync(option('out'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main();
