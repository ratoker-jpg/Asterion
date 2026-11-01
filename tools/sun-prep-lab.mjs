// Sun plan lab (NPC intelligence ADR, stage F): one seed's world for N days,
// counting what became of the alliances' Sun raids: prepared → gathered → flew
// → arrived → won, disbanded, moved, cancelled and why. It reads only the save
// and the bot journal, so the same file runs on a revision without the plan
// (the «before» of a paired comparison). Heavy: run it in GitHub Actions
// (owner rule 31.10.2026); locally one seed × one day at most.
//
//   node --max-old-space-size=8192 --experimental-strip-types --experimental-loader ./src/domain/combat/test-asset-loader.mjs \
//     tools/sun-prep-lab.mjs --write-fixture=F --seed=N [--scenario=natural|sun] [--bots=15]
//   ... tools/sun-prep-lab.mjs --fixture=F --days=2 --label=after --out=FILE
//   node tools/sun-prep-lab.mjs --compare=before,after --dir=DIR
//
// Local only: no network, no game profile (ADR 8.4).
import fs from 'node:fs';
import path from 'node:path';

const HOUR = 3_600_000;
const option = (name, fallback) => process.argv.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const log = (line) => process.stderr.write(`${line}\n`);

const ALLIANCE_SIZE = 5;
/** The owner's activity mix (calendar.ts, 24.10.2026): the hard part of a Sun raid is that people are not all there. */
const ACTIVITY_MIX = [0.95, 0.5, 0.85, 0.25, 0.6, 0.9, 0.3, 0.55, 0.8, 0.12, 0.65, 0.35, 0.75, 0.45, 0.2];

async function writeFixture(file, seed, scenario, bots) {
  const { createInitialSaveState, serializeSaveForStorage } = await import('../src/application/persistence.ts');
  const { getNpcOwnerIds } = await import('../src/application/npc-foundation.ts');
  const { createNpcState } = await import('../src/domain/npc/state.ts');
  const { createDefaultNewGameConfig } = await import('../src/domain/world/config.ts');
  const { LAB_CHARACTERS } = await import('./bot-lab.mjs');
  const startAt = Date.UTC(2026, 0, 1);
  const config = createDefaultNewGameConfig({ seed: `SUNPREP${seed}`, campaignName: `Sun lab ${seed}` });
  config.world = { ...config.world, galaxyCount: 1, npcCount: bots, maxNpcPerSystem: 3, density: 'dense', campaignSpeed: 'fast', randomPlayerStart: false };
  const base = createInitialSaveState('production', startAt, config);
  const owners = getNpcOwnerIds(base.espionage?.targets, base.profile.playerId);
  const npc = createNpcState(owners, `sun-lab-salt-${seed}`, startAt);
  const profiles = {};
  Object.values(npc.profiles).forEach((profile, index) => {
    const [, traits] = LAB_CHARACTERS[index % LAB_CHARACTERS.length];
    profiles[profile.ownerId] = { ...profile, traits: { ...profile.traits, ...traits, attention: Math.max(0.5, profile.traits.attention) },
      activity: { ...profile.activity, propensity: scenario === 'sun' ? ACTIVITY_MIX[index % ACTIVITY_MIX.length] : 0.85 + 0.15 * ((index * 7) % 10) / 10 } };
  });
  let state = { ...base, npc: { ...npc, profiles } };
  if (scenario === 'sun') state = await armAlliances(state, Object.keys(profiles).sort(), seed);
  fs.writeFileSync(file, serializeSaveForStorage(state, 'production'));
  log(`fixture ${file}: seed ${seed}, ${scenario}, ${bots} bots, alliances ${state.command.alliances.length}`);
}

/**
 * Scenario «Солнце»: three alliances of five, each member with a real fleet
 * (mid-game hangar and shipyard, 12 000–30 000 population, stores to build
 * more). What is left to play is exactly the raid: when, where, who comes.
 */
async function armAlliances(initial, owners, seed) {
  const { DEFAULT_ALLIANCE_EMBLEM } = await import('../src/domain/command/catalog.ts');
  const { acceptApplication, applyToAlliance, createAlliance } = await import('../src/domain/command/membership.ts');
  const { getFactionShipCatalog } = await import('../src/domain/combat/faction-catalog.ts');
  const { createSeededRandom } = await import('../src/domain/world/random.ts');
  const random = createSeededRandom(`sun-lab-arms:${seed}`);
  const stamp = { now: initial.npcReplay.processedThroughAt, random: () => 0.4 };
  let state = initial;
  const targets = { ...state.espionage.targets };
  for (let group = 0; group + ALLIANCE_SIZE <= owners.length; group += ALLIANCE_SIZE) {
    const team = owners.slice(group, group + ALLIANCE_SIZE);
    const planet = targets[`${team[0]}-planet`];
    const created = createAlliance(state.command, { ownerId: team[0], displayName: planet.ownerName,
      settings: { name: `Sun Lab ${group}`, tag: `SL${group}`, motto: '', description: '', emblem: DEFAULT_ALLIANCE_EMBLEM } }, stamp);
    if (!created.ok) throw new Error('alliance not created');
    let command = created.state;
    const allianceId = command.alliances.find((alliance) => alliance.leaderOwnerId === team[0]).id;
    for (const ownerId of team.slice(1)) {
      const applied = applyToAlliance(command, { ownerId, displayName: targets[`${ownerId}-planet`].ownerName, allianceId }, stamp);
      if (!applied.ok) throw new Error(`no application: ${applied.reason ?? applied.error ?? ''}`);
      const accepted = acceptApplication(applied.state, team[0], applied.applicationId, stamp);
      if (!accepted.ok) throw new Error('not accepted');
      command = accepted.state;
    }
    state = { ...state, command };
  }
  for (const ownerId of owners) {
    const planet = targets[`${ownerId}-planet`];
    if (!planet) continue;
    const hulls = getFactionShipCatalog(planet.raceId).filter((entity) => entity.category === 'Боевой корабль' && entity.combat && entity.population > 0)
      .sort((left, right) => left.population - right.population || (left.id < right.id ? -1 : 1));
    const population = 12_000 + Math.floor(random() * 18_000);
    const ships = { ...planet.fleet.ships };
    for (const hull of hulls.slice(0, 3)) ships[hull.id] = (ships[hull.id] ?? 0) + Math.ceil(population / 3 / hull.population);
    targets[planet.id] = { ...planet, fleet: { ...planet.fleet, ships },
      buildings: { ...planet.buildings, hangar: Math.max(planet.buildings.hangar ?? 0, 40), shipyard: Math.max(planet.buildings.shipyard ?? 0, 12),
        'gas-storage': Math.max(planet.buildings['gas-storage'] ?? 0, 10), 'metal-storage': Math.max(planet.buildings['metal-storage'] ?? 0, 10), 'mineral-storage': Math.max(planet.buildings['mineral-storage'] ?? 0, 10) },
      resources: { ...planet.resources, metal: 3_000_000, minerals: 3_000_000, gas: 3_000_000 } };
  }
  return { ...state, espionage: { ...state.espionage, targets } };
}

async function run(fixture, days, label, out) {
  const { loadSavedState } = await import('../src/application/persistence.ts');
  const { applyCampaignRuntimeForCatchup } = await import('../src/application/npc-catchup-runner.ts');
  const { advanceLiveWorld, beginLiveWorld } = await import('../src/application/npc-live-world.ts');
  const { setNpcJournalSink } = await import('../src/application/npc-journal.ts');
  const { getNpcSessionEvents } = await import('../src/domain/npc/calendar.ts');
  const raw = fs.readFileSync(fixture, 'utf8');
  const at0 = JSON.parse(raw).npcReplay.processedThroughAt;
  const loaded = loadSavedState({ mode: 'production', storage: { getItem: () => raw, setItem() {}, removeItem() {} }, saveKey: 'k', now: () => at0 });
  if (loaded.status !== 'loaded') throw new Error(`${fixture} does not load: ${loaded.status}`);
  let state = loaded.state;
  applyCampaignRuntimeForCatchup(state, at0);
  const { summary: _summary, ...replay } = state.npcReplay;
  state = beginLiveWorld({ ...state, npcReplay: { ...replay, targetAt: at0 } });
  const steps = [];
  let looks = 0;
  setNpcJournalSink({ detailed: () => false, decision: () => { looks += 1; },
    sun: (entry) => steps.push({ h: +((entry.at - at0) / HOUR).toFixed(2), o: entry.ownerId, p: entry.planId, s: entry.step, ...(entry.detail ? { d: entry.detail } : {}) }) });
  const startedAt = performance.now();
  let groups;
  for (let hour = 1; hour <= days * 24; hour += 1) {
    const step = advanceLiveWorld(state, at0 + hour * HOUR, { groups });
    state = step.state;
    groups = step.groups;
    if (hour % 12 === 0) log(`${label} h${hour}: ${Math.round((performance.now() - startedAt) / 1000)} s, raids ${state.sunRaid?.raids?.length ?? 0}`);
  }
  setNpcJournalSink(null);
  const raids = state.sunRaid?.raids ?? [];
  const count = (test) => raids.filter(test).length;
  const stepCount = (name) => steps.filter((step) => step.s === name).length;
  const plansCreated = stepCount('created');
  const planMoves = new Map();
  for (const step of steps) if (step.s === 'postponed') planMoves.set(step.p, (planMoves.get(step.p) ?? 0) + 1);
  const reasons = {};
  for (const step of steps) if (step.s === 'cancelled' || step.s === 'disbanded') reasons[step.d?.reason ?? step.s] = (reasons[step.d?.reason ?? step.s] ?? 0) + 1;
  const answers = {};
  for (const step of steps) if (step.s === 'rsvp') { const key = `${step.d?.answer}${step.d?.reason ? `:${step.d.reason}` : ''}`; answers[key] = (answers[key] ?? 0) + 1; }
  const declaredOfPlans = new Set(steps.filter((step) => step.s === 'declared').map((step) => step.d?.raidId));
  // The owner's time at the game, by its calendar (with any moved visit): equal activity is checked, not assumed.
  const activity = {};
  const until = at0 + days * 24 * HOUR;
  for (const [ownerId, profile] of Object.entries(state.npc.profiles)) {
    const events = getNpcSessionEvents(profile, at0, until);
    let minutes = 0;
    const open = new Map();
    for (const event of events) {
      if (event.boundary === 'session-start') open.set(event.sessionId, event.at);
      else if (open.has(event.sessionId)) { minutes += (event.at - open.get(event.sessionId)) / 60_000; open.delete(event.sessionId); }
    }
    activity[ownerId] = Math.round(minutes);
  }
  const result = {
    tool: 'sun-prep-lab', label, fixture: path.basename(fixture), days, wallSeconds: Math.round((performance.now() - startedAt) / 1000), looks,
    funnel: {
      prepared: plansCreated,
      declared: raids.length,
      gathered: count((raid) => raid.status === 'incoming' || raid.status === 'resolved'),
      flew: count((raid) => raid.status === 'incoming' || raid.status === 'resolved'),
      arrived: count((raid) => raid.status === 'resolved'),
      won: count((raid) => raid.result?.winner === 'attacker'),
      disbanded: count((raid) => raid.status === 'disbanded'),
      crystals: Object.values(state.sunRaid?.crystals ?? {}).reduce((sum, list) => sum + list.length, 0),
    },
    plans: { created: plansCreated, postponed: stepCount('postponed'), maxMovesOfOnePlan: Math.max(0, ...planMoves.values()), retargeted: stepCount('retarget'),
      cancelled: stepCount('cancelled'), rallies: stepCount('rally'), visitShifts: stepCount('shift'), reasons, answers },
    offChance: raids.filter((raid) => !declaredOfPlans.has(raid.id)).length,
    activityMinutes: Object.values(activity).reduce((sum, value) => sum + value, 0),
    activity, steps,
    saveBytes: { strategy: JSON.stringify(state.npcStrategy ?? null).length },
  };
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(result, null, 1));
  const { activity: _activity, steps: _steps, ...brief } = result;
  console.log(JSON.stringify(brief));
}

function compare(labels, dir) {
  const [before, after] = labels;
  const files = (label) => fs.readdirSync(dir, { recursive: true }).map(String).filter((name) => name.endsWith(`${label}.json`)).sort();
  const read = (name) => JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'));
  const rows = [];
  for (const name of files(before)) {
    const pair = name.slice(0, -`${before}.json`.length) + `${after}.json`;
    if (!fs.existsSync(path.join(dir, pair))) { log(`no pair for ${name}`); continue; }
    rows.push({ name, a: read(name), b: read(pair) });
  }
  const keys = ['prepared', 'declared', 'gathered', 'flew', 'arrived', 'won', 'disbanded', 'crystals'];
  const totals = Object.fromEntries(keys.map((key) => [key, { before: 0, after: 0 }]));
  for (const { a, b } of rows) for (const key of keys) { totals[key].before += a.funnel[key]; totals[key].after += b.funnel[key]; }
  // Bootstrap of the paired mean difference, seeded: the spread, not the best seed (ADR 8.2).
  let seed = 12345;
  const next = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32;
  const interval = {};
  for (const key of keys) {
    const differences = rows.map(({ a, b }) => b.funnel[key] - a.funnel[key]);
    const means = Array.from({ length: 2000 }, () => differences.reduce((sum) => sum + differences[Math.floor(next() * differences.length)], 0) / Math.max(1, differences.length)).sort((x, y) => x - y);
    interval[key] = { mean: +(differences.reduce((sum, value) => sum + value, 0) / Math.max(1, differences.length)).toFixed(2), low: +(means[100] ?? 0).toFixed(2), high: +(means[1899] ?? 0).toFixed(2) };
  }
  const summary = { pairs: rows.length, totals, interval,
    activity: { before: rows.reduce((sum, { a }) => sum + a.activityMinutes, 0), after: rows.reduce((sum, { b }) => sum + b.activityMinutes, 0),
      looksBefore: rows.reduce((sum, { a }) => sum + a.looks, 0), looksAfter: rows.reduce((sum, { b }) => sum + b.looks, 0) },
    maxMovesOfOnePlan: Math.max(0, ...rows.map(({ b }) => b.plans.maxMovesOfOnePlan)),
    offChanceAfter: rows.reduce((sum, { b }) => sum + b.offChance, 0),
    reasons: rows.reduce((all, { b }) => { for (const [key, value] of Object.entries(b.plans.reasons)) all[key] = (all[key] ?? 0) + value; return all; }, {}),
    answers: rows.reduce((all, { b }) => { for (const [key, value] of Object.entries(b.plans.answers)) all[key] = (all[key] ?? 0) + value; return all; }, {}),
    rallies: rows.reduce((sum, { b }) => sum + b.plans.rallies, 0), visitShifts: rows.reduce((sum, { b }) => sum + b.plans.visitShifts, 0),
    perSeed: rows.map(({ name, a, b }) => ({ name, before: a.funnel, after: b.funnel, moves: b.plans.maxMovesOfOnePlan, wallBefore: a.wallSeconds, wallAfter: b.wallSeconds })),
  };
  console.log(JSON.stringify(summary, null, 2));
}

async function main() {
  if (option('compare')) return compare(option('compare').split(','), option('dir'));
  if (option('write-fixture')) return writeFixture(option('write-fixture'), Number(option('seed', '1')), option('scenario', 'natural'), Number(option('bots', '15')));
  const fixture = option('fixture');
  if (!fixture) throw new Error('--fixture=F, --write-fixture=F or --compare=A,B');
  return run(fixture, Number(option('days', '2')), option('label', 'run'), option('out', `${fixture}.${option('label', 'run')}.json`));
}

await main();
