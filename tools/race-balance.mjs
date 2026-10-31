// Race balance (owner question 31.10.2026: «is the Swarm weaker?»). Mirror
// runs on the bot lab: one base world per seed (bot-lab characters, positions,
// persona salt), then three rotations in which owner i plays race
// RACES[(i + rotation) % 3] — the same characters on the same planets, only
// the race changes, so every character plays every race. The world summary of
// each run is split by race.
//
//   node --max-old-space-size=8192 --experimental-strip-types --experimental-loader ./src/domain/combat/test-asset-loader.mjs \
//     tools/race-balance.mjs mirror [--seeds=3] [--days=2] [--bots=15] [--parallel=6] --out=DIR
//   ... tools/race-balance.mjs run-one --base=F --rotation=R --days=D --out=FILE   (one run; used by mirror)
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadSavedState, serializeSaveForStorage } from '../src/application/persistence.ts';
import { applyCampaignRuntimeForCatchup } from '../src/application/npc-catchup-runner.ts';
import { advanceLiveWorld, beginLiveWorld } from '../src/application/npc-live-world.ts';
import { createCanonicalStartingFleet, calculateFleetPopulation } from '../src/domain/fleet/runtime.ts';
import { calculateDefensePopulation } from '../src/domain/fleet/production.ts';
import { createLabWorld, describeWorld, LAB_CHARACTERS } from './bot-lab.mjs';

export const RACES = ['aegis', 'synod', 'veyra'];
export const RACE_NAMES = { aegis: 'Астеры', synod: 'Илары', veyra: 'Рой' };
const HOUR = 3_600_000;
const option = (name, fallback) => process.argv.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const log = (line) => process.stderr.write(`${line}\n`);
const here = path.dirname(fileURLToPath(import.meta.url));

function readSave(file) {
  const raw = fs.readFileSync(file, 'utf8');
  const at = JSON.parse(raw).npcReplay.processedThroughAt;
  const loaded = loadSavedState({ mode: 'production', storage: { getItem: () => raw, setItem() {}, removeItem() {} }, saveKey: 'k', now: () => at });
  if (loaded.status !== 'loaded') throw new Error(`${file} does not load: ${loaded.status}`);
  return loaded.state;
}

/** The base world with owner i on race RACES[(i + rotation) % 3]; a fresh world's planets only hold the starting fleet. */
export function rotateRaces(state, rotation) {
  const owners = Object.keys(state.npc.profiles).sort();
  const raceOf = new Map(owners.map((ownerId, index) => [ownerId, RACES[(index + rotation) % RACES.length]]));
  const targets = { ...state.espionage.targets };
  for (const [id, target] of Object.entries(targets)) {
    const raceId = raceOf.get(target.ownerId);
    if (target.kind !== 'npc' || !raceId) continue;
    const fleet = createCanonicalStartingFleet(raceId);
    const fleetPopulation = calculateFleetPopulation(fleet, raceId);
    const defensePopulation = calculateDefensePopulation(target.defense, raceId);
    targets[id] = { ...target, raceId, fleet, population: { total: fleetPopulation + defensePopulation, fleet: fleetPopulation, defense: defensePopulation } };
  }
  return { state: { ...state, espionage: { ...state.espionage, targets } }, raceOf };
}

function runOne() {
  const base = readSave(option('base'));
  const rotation = Number(option('rotation', '0'));
  const days = Number(option('days', '2'));
  let { state, raceOf } = rotateRaces(base, rotation);
  const at0 = state.npcReplay.processedThroughAt;
  applyCampaignRuntimeForCatchup(state, at0);
  state = beginLiveWorld(state);
  const characterOf = new Map(Object.keys(state.npc.profiles).sort().map((ownerId, index) => [ownerId, LAB_CHARACTERS[index % LAB_CHARACTERS.length][0]]));
  const startedAt = performance.now();
  const daily = [];
  let groups;
  for (let hour = 1; hour <= days * 24; hour += 1) {
    const step = advanceLiveWorld(state, at0 + hour * HOUR, { groups });
    state = step.state;
    groups = step.groups;
    if (hour % 24 === 0 || hour === days * 24) {
      const summary = describeWorld(state);
      daily.push({ day: +(hour / 24).toFixed(2), sun: summary.sun, owners: summary.perOwner.map((owner) => ({ ...owner, race: raceOf.get(owner.ownerId), character: characterOf.get(owner.ownerId) })) });
      log(`rotation ${rotation} day ${hour / 24}: ${Math.round((performance.now() - startedAt) / 1000)} s`);
    }
  }
  fs.writeFileSync(option('out'), JSON.stringify({ base: path.basename(option('base')), rotation, days, daily }));
}

const mean = (values) => values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
const sd = (values) => { const m = mean(values); return Math.sqrt(mean(values.map((value) => (value - m) ** 2))); };

/** Per race (and per character × race) means over every owner-run of the last day. */
export function summarizeMirror(runs) {
  const rows = runs.flatMap((run) => run.daily.at(-1).owners.map((owner) => ({ ...owner, seed: run.base })));
  const byRace = Object.fromEntries(RACES.map((race) => {
    const own = rows.filter((row) => row.race === race);
    // Each seed's race mean, for the spread between worlds.
    const seeds = [...new Set(own.map((row) => row.seed))].map((seed) => mean(own.filter((row) => row.seed === seed).map((row) => row.points)));
    return [race, {
      name: RACE_NAMES[race], samples: own.length,
      points: Math.round(mean(own.map((row) => row.points))), pointsSd: Math.round(sd(own.map((row) => row.points))),
      seedMeans: seeds.map(Math.round),
      battlePoints: Math.round(mean(own.map((row) => row.battlePoints))), planets: +mean(own.map((row) => row.planets)).toFixed(2),
      ships: Math.round(mean(own.map((row) => row.ships))), allDefense: Math.round(mean(own.map((row) => row.allDefense))),
      resources: Math.round(mean(own.map((row) => row.resources))),
    }];
  }));
  const best = Math.max(...RACES.map((race) => byRace[race].points));
  for (const race of RACES) byRace[race].vsBest = +((byRace[race].points / best - 1) * 100).toFixed(1);
  const characters = [...new Set(rows.map((row) => row.character))];
  const byCharacter = Object.fromEntries(characters.map((character) => [character,
    Object.fromEntries(RACES.map((race) => [race, Math.round(mean(rows.filter((row) => row.character === character && row.race === race).map((row) => row.points)))]))]));
  return { byRace, byCharacter, spreadPercent: +((1 - Math.min(...RACES.map((race) => byRace[race].points)) / best) * 100).toFixed(1) };
}

async function mirror() {
  const out = option('out');
  if (!out) throw new Error('--out=DIR');
  fs.mkdirSync(out, { recursive: true });
  const seeds = Number(option('seeds', '3'));
  const days = option('days', '2');
  const parallel = Number(option('parallel', '6'));
  const jobs = [];
  for (let seed = 1; seed <= seeds; seed += 1) {
    const base = path.join(out, `base-${seed}.json`);
    if (!fs.existsSync(base)) fs.writeFileSync(base, serializeSaveForStorage(createLabWorld(Number(option('bots', '15')), `RACEMIRROR${seed}`), 'production'));
    for (let rotation = 0; rotation < RACES.length; rotation += 1) jobs.push({ base, rotation, file: path.join(out, `run-${seed}-${rotation}.json`) });
  }
  const node = process.execPath;
  const args = (job) => [...process.execArgv, path.join(here, 'race-balance.mjs'), 'run-one', `--base=${job.base}`, `--rotation=${job.rotation}`, `--days=${days}`, `--out=${job.file}`];
  const queue = jobs.filter((job) => !fs.existsSync(job.file));
  await Promise.all(Array.from({ length: Math.min(parallel, queue.length) }, async () => {
    for (let job = queue.shift(); job; job = queue.shift()) {
      await new Promise((resolve, reject) => {
        const child = spawn(node, args(job), { stdio: ['ignore', 'ignore', 'inherit'] });
        child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`${job.file}: exit ${code}`))));
      });
    }
  }));
  const runs = jobs.map((job) => JSON.parse(fs.readFileSync(job.file, 'utf8')));
  const summary = summarizeMirror(runs);
  fs.writeFileSync(path.join(out, 'summary.json'), JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary, null, 2));
}

const command = process.argv[2];
if (command === 'run-one') runOne();
else if (command === 'mirror') await mirror();
else if (command) throw new Error('command: mirror | run-one');
