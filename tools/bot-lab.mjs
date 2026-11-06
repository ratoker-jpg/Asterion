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
//   ... tools/bot-lab.mjs --seed=3 [--scenario=seven-planets|familiar-solos|conflict|sun-raids] ...   (another lab galaxy; see bot-lab-batch.mjs)
//   ... tools/bot-lab.mjs --policy=FILE.json ...   (stage H: the whole run under another strategy policy; see tools/league.mjs)
//
// A fresh campaign draws ids from crypto entropy: before/after comparisons run
// both revisions on one fixture written once with --write-fixture.
import fs from 'node:fs';
import path from 'node:path';
import { createInitialSaveState, loadSavedState, serializeSaveForStorage } from '../src/application/persistence.ts';
import { getNpcOwnerIds } from '../src/application/npc-foundation.ts';
import { DEFAULT_ALLIANCE_EMBLEM } from '../src/domain/command/catalog.ts';
import { acceptApplication, applyToAlliance, createAlliance } from '../src/domain/command/membership.ts';
// A revision without the strategy policy (main before stage H) still runs in the lab: it simply has no policy to report or override.
const { getNpcPolicy, setNpcPolicyOverride } = await import('../src/domain/npc/policy.ts').catch((error) => {
  if (error?.code !== 'ERR_MODULE_NOT_FOUND') throw error;
  return { getNpcPolicy: () => ({ version: null, params: null }), setNpcPolicyOverride: () => { throw new Error('this revision has no strategy policy; --policy needs one'); } };
});
// A revision without the planet shield (main before it) still runs in the lab: it simply reports no shield figures.
const shieldModule = await import('../src/application/shield.ts').catch((error) => {
  if (error?.code !== 'ERR_MODULE_NOT_FOUND') throw error;
  return null;
});
import { applyCampaignRuntimeForCatchup } from '../src/application/npc-catchup-runner.ts';
import { advanceLiveWorld, beginLiveWorld } from '../src/application/npc-live-world.ts';
import { formatNpcJournalLines, setNpcJournalSink } from '../src/application/npc-journal.ts';
import { selectOwnerScore } from '../src/domain/rating/scoring.ts';
import { createNpcState } from '../src/domain/npc/state.ts';
import { createDefaultNewGameConfig } from '../src/domain/world/config.ts';
import { getFactionDefenseCatalog, getFactionShipCatalog } from '../src/domain/combat/faction-catalog.ts';
import { SCIENCE_CATALOG } from '../src/domain/science/catalog.ts';
import { calculateDefensePopulation, createDefaultFleetProductionState, createEmptyDefenseState } from '../src/domain/fleet/production.ts';
import { getNpcPlanetIncomePerHour } from '../src/application/npc-economy.ts';

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

export function createLabWorld(bots = 15, seed = 'BOTLAB2026') {
  const config = createDefaultNewGameConfig({ seed, campaignName: 'Bot lab' });
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

/**
 * Scenario «seven planets» (ADR 7.а): one rich owner (the lab's `fleet`
 * character) holds seven planets with a combat squadron on each and its own
 * fresh full report of a neighbour behind batteries no single planet beats but
 * the whole empire does. The planets come from six other bots, which leave the
 * world; the neighbour is lifted into the owner's points band. Written into
 * the fixture, so before and after runs start from the same world.
 */
export function applySevenPlanetsScenario(state) {
  const targets = { ...state.espionage.targets };
  const owners = Object.keys(state.npc.profiles).sort();
  const owner = owners[3];
  const home = Object.values(targets).find((planet) => planet.kind === 'npc' && planet.ownerId === owner);
  const others = owners.filter((id) => id !== owner);
  const victimOwner = others[0];
  const absorbed = others.slice(1, 7);
  const combat = getFactionShipCatalog(home.raceId).filter((entity) => entity.category === 'Боевой корабль' && entity.combat)
    .sort((left, right) => sum(Object.values(left.cost ?? {})) - sum(Object.values(right.cost ?? {})) || (left.id < right.id ? -1 : 1));
  const hull = combat[Math.min(2, combat.length - 1)];
  const planets = Object.values(targets).filter((planet) => planet.kind === 'npc' && (planet.ownerId === owner || absorbed.includes(planet.ownerId)));

  for (const planet of planets) {
    targets[planet.id] = {
      ...planet, ownerId: owner, ownerName: home.ownerName, raceId: home.raceId, ownerProfile: home.ownerProfile,
      resources: { ...planet.resources, metal: 10_000_000, minerals: 10_000_000, gas: 10_000_000 },
      buildings: { ...planet.buildings, shipyard: 20, hangar: 100, 'advanced-factory': 10, 'metal-storage': 30, 'mineral-storage': 30, 'gas-storage': 30 },
      fleet: { ...planet.fleet, ships: { ...planet.fleet.ships, [hull.id]: 40, 'spy-probe': 5 } },
      fleetProduction: createDefaultFleetProductionState(),
    };
  }
  const victim = Object.values(targets).find((planet) => planet.kind === 'npc' && planet.ownerId === victimOwner);
  const defense = createEmptyDefenseState();
  targets[victim.id] = { ...victim, resources: { ...victim.resources, metal: 5_000_000, minerals: 5_000_000, gas: 5_000_000 },
    defense: { ...defense, defenses: { ...defense.defenses, 'ion-plasma-battery': 10 } } };
  const at = state.npcReplay.processedThroughAt;
  const seen = targets[victim.id];
  const report = {
    ownerId: owner, id: `lab-seven-report-${at}`, missionId: `lab-seven-mission-${at}`, createdAt: at, sourcePlanetId: home.id,
    targetPlanetId: seen.id, targetPlanetName: seen.name, targetOwnerId: seen.ownerId, targetOwnerName: seen.ownerName,
    targetRaceId: seen.raceId, targetRelation: 'neutral', targetCoordinate: { ...seen.coordinate },
    spyLevel: 10, targetEspionageLevel: 0, delta: 10, roll: 0.5, quality: 'full',
    resources: { ...seen.resources }, defense: { ...seen.defense.defenses }, fleet: { ...seen.fleet.ships }, firstReport: true,
  };
  const profiles = Object.fromEntries(Object.entries(state.npc.profiles).filter(([id]) => !absorbed.includes(id)));
  let next = { ...state, espionage: { ...state.espionage, targets, reports: [...(state.espionage.reports ?? []), report] }, npc: { ...state.npc, profiles } };
  // A late-game owner: its sciences (the owner ledger the game reads) let every planet build combat hulls.
  if (next.npcScience?.owners?.[owner]) {
    const science = next.npcScience.owners[owner];
    const max = new Map(SCIENCE_CATALOG.map((entry) => [String(entry.id), entry.maxLevel]));
    const levels = Object.fromEntries(Object.entries(science.levels).map(([id, level]) => [id,
      ['18', '19', '20'].includes(id) ? level : Math.max(level, Math.min(15, max.get(id) ?? level))])); // one additional direction at most: left as drawn
    next = { ...next, npcScience: { ...next.npcScience, owners: { ...next.npcScience.owners, [owner]: { ...science, levels } } } };
  }
  // The neighbour in the owner's points band (the same ledger the attack-rule tests use).
  const ownerPoints = selectOwnerScore(next, owner)?.resourcePoints ?? 0;
  const victimPoints = selectOwnerScore(next, victimOwner)?.resourcePoints ?? 0;
  if (victimPoints < ownerPoints) {
    const unrecovered = { ...next.rating.unrecoveredCostsByOwnerId };
    const previous = unrecovered[victimOwner] ?? { metal: 0, minerals: 0, gas: 0 };
    unrecovered[victimOwner] = { ...previous, metal: previous.metal + (ownerPoints - victimPoints) * 1_000 };
    next = { ...next, rating: { ...next.rating, unrecoveredCostsByOwnerId: unrecovered } };
  }
  log(`scenario seven-planets: ${owner} holds ${planets.length} planets (${hull.id} ×40 each), target ${victim.id} of ${victimOwner}`);
  return next;
}

/**
 * Scenario `sun-raids`: alliances of five, each member with a real mixed fleet (every combat hull of its race
 * in equal population, 60 000–110 000: more than one participant may bring, so the choice of hulls matters),
 * stores and a hangar for it, and calendars that keep most of them online. What is left is the Sun raid itself:
 * who comes and with which hulls. It is meant to measure how raids are composed (tools/bot-lab-batch.mjs sun*).
 */
export function applySunRaidsScenario(initial) {
  const owners = Object.keys(initial.npc.profiles).sort();
  const stamp = { now: initial.npcReplay.processedThroughAt, random: () => 0.4 };
  let state = initial;
  const targets = { ...state.espionage.targets };
  const profiles = { ...state.npc.profiles };
  const SIZE = 5;
  for (let group = 0; group + SIZE <= owners.length; group += SIZE) {
    const team = owners.slice(group, group + SIZE);
    const created = createAlliance(state.command, { ownerId: team[0], displayName: targets[`${team[0]}-planet`].ownerName,
      settings: { name: `Sun Raids ${group}`, tag: `SR${group}`, motto: '', description: '', emblem: DEFAULT_ALLIANCE_EMBLEM } }, stamp);
    if (!created.ok) throw new Error('alliance not created');
    let command = created.state;
    const allianceId = command.alliances.find((alliance) => alliance.leaderOwnerId === team[0]).id;
    for (const ownerId of team.slice(1)) {
      const applied = applyToAlliance(command, { ownerId, displayName: targets[`${ownerId}-planet`].ownerName, allianceId }, stamp);
      if (!applied.ok) throw new Error('no application');
      const accepted = acceptApplication(applied.state, team[0], applied.applicationId, stamp);
      if (!accepted.ok) throw new Error('not accepted');
      command = accepted.state;
    }
    state = { ...state, command };
  }
  owners.forEach((ownerId, index) => {
    const planet = targets[`${ownerId}-planet`];
    if (!planet) return;
    const hulls = getFactionShipCatalog(planet.raceId).filter((entity) => entity.category === 'Боевой корабль' && entity.combat && entity.population > 0);
    const population = 60_000 + ((index * 7919) % 50_000);
    const ships = { ...planet.fleet.ships };
    for (const hull of hulls) ships[hull.id] = (ships[hull.id] ?? 0) + Math.ceil(population / hulls.length / hull.population);
    targets[planet.id] = { ...planet, fleet: { ...planet.fleet, ships },
      buildings: { ...planet.buildings, hangar: Math.max(planet.buildings.hangar ?? 0, 40), shipyard: Math.max(planet.buildings.shipyard ?? 0, 12),
        'gas-storage': Math.max(planet.buildings['gas-storage'] ?? 0, 12), 'metal-storage': Math.max(planet.buildings['metal-storage'] ?? 0, 10), 'mineral-storage': Math.max(planet.buildings['mineral-storage'] ?? 0, 10) },
      resources: { ...planet.resources, metal: 3_000_000, minerals: 3_000_000, gas: 4_000_000 } };
    const profile = profiles[ownerId];
    profiles[ownerId] = { ...profile, activity: { ...profile.activity, propensity: 0.85 + 0.15 * ((index * 7) % 10) / 10 } };
  });
  log(`scenario sun-raids: ${Math.floor(owners.length / SIZE)} alliances of ${SIZE}`);
  return { ...state, espionage: { ...state.espionage, targets }, npc: { ...state.npc, profiles } };
}

/**
 * Scenarios of stage E (ADR §7.б, §9.2). Solo owners by character who remember
 * each other from an earlier round, each strong, rich and with its own fresh
 * report of a neighbour behind batteries: too much for one (by the owner's own
 * judgement), not for two. They are told nothing else; what they do is theirs.
 *
 * `familiar-solos`: two pairs that think well of each other, both ways.
 * `conflict`: three pairs. One regards the other well but is not regarded back;
 * one's partner counts the target as a friend; the third is a control pair.
 */
export function applySocialScenario(state, scenario) {
  const targets = { ...state.espionage.targets };
  const owners = Object.keys(state.npc.profiles).sort();
  const at = state.npcReplay.processedThroughAt;
  const profiles = { ...state.npc.profiles };
  const reports = [];
  const unrecovered = { ...state.rating.unrecoveredCostsByOwnerId };
  const groups = [[0, 1, 2], [3, 4, 5], ...(scenario === 'conflict' ? [[6, 7, 8]] : [])];
  const relation = (trust, affinity, resentment) => ({ trust, affinity, resentment });
  groups.forEach(([a, b, c], index) => {
    const [left, right, victim] = [owners[a], owners[b], owners[c]];
    const planetOf = (ownerId) => Object.values(targets).find((planet) => planet.kind === 'npc' && planet.ownerId === ownerId);
    const hull = 'cruiser';
    for (const ownerId of [left, right]) {
      const planet = planetOf(ownerId);
      // Some batteries: the first pirates of a lab world otherwise wipe a fleet standing by with nothing to do with this.
      const guard = createEmptyDefenseState();
      targets[planet.id] = { ...planet, resources: { ...planet.resources, metal: 300_000, minerals: 300_000, gas: 300_000 },
        defense: { ...guard, defenses: { ...guard.defenses, 'ion-plasma-battery': 15 } },
        buildings: { ...planet.buildings, shipyard: 12, hangar: 60, 'metal-storage': 25, 'mineral-storage': 25, 'gas-storage': 25, 'planetary-government': 1 },
        fleet: { ...planet.fleet, ships: { ...planet.fleet.ships, [hull]: 60, transporter: 20, 'spy-probe': 5 } },
        fleetProduction: createDefaultFleetProductionState() };
      const profile = profiles[ownerId];
      // Solo by temperament: an alliance would hide what this scenario asks.
      profiles[ownerId] = { ...profile, traits: { ...profile.traits, cooperation: 0.28, socialStyle: 0.25, riskTolerance: 0.7, militaryFocus: 0.8, attention: 0.9 },
        activity: { ...profile.activity, propensity: 0.95 } };
    }
    const leftPlanet = targets[planetOf(left).id];
    const force = getFactionShipCatalog(leftPlanet.raceId).find((entity) => entity.id === hull).combat;
    const ownPower = 60 * Math.sqrt(force.attack * force.life);
    const battery = getFactionDefenseCatalog(planetOf(victim).raceId).find((entity) => entity.id === 'ion-plasma-battery').combat;
    const defense = createEmptyDefenseState();
    const seen = { ...planetOf(victim), resources: { ...planetOf(victim).resources, metal: 3_000_000, minerals: 3_000_000, gas: 3_000_000 },
      defense: { ...defense, defenses: { ...defense.defenses, 'ion-plasma-battery': Math.ceil(1.5 * ownPower / Math.sqrt(battery.attack * battery.life)) } },
      fleet: { ...planetOf(victim).fleet, ships: {} } };
    targets[seen.id] = seen;
    for (const ownerId of [left, right]) {
      const home = targets[planetOf(ownerId).id];
      reports.push({ ownerId, id: `lab-social-report-${index}-${ownerId}`, missionId: `lab-social-mission-${index}-${ownerId}`, createdAt: at, sourcePlanetId: home.id,
        targetPlanetId: seen.id, targetPlanetName: seen.name, targetOwnerId: seen.ownerId, targetOwnerName: seen.ownerName, targetRaceId: seen.raceId, targetRelation: 'neutral',
        targetCoordinate: { ...seen.coordinate }, spyLevel: 10, targetEspionageLevel: 0, delta: 10, roll: 0.5, quality: 'full',
        resources: { ...seen.resources }, defense: { ...seen.defense.defenses }, fleet: { ...seen.fleet.ships }, firstReport: true });
    }
    const memoryOf = (relations) => ({ round: 2, prefs: {}, lessons: [], relations });
    const warm = relation(0.6, 0.5, 0);
    // They share an old enemy: what a strike costs, a grudge can pay for.
    const enemy = relation(0, 0, 0.5);
    profiles[left] = { ...profiles[left], inherited: memoryOf({ [right]: warm, [victim]: enemy }) };
    if (scenario === 'conflict' && index === 0) profiles[right] = { ...profiles[right], inherited: memoryOf({ [left]: relation(0, 0, 0.6) }) };
    else if (scenario === 'conflict' && index === 1) profiles[right] = { ...profiles[right], inherited: memoryOf({ [left]: warm, [victim]: relation(0.7, 0.6, 0) }) };
    else profiles[right] = { ...profiles[right], inherited: memoryOf({ [left]: warm, [victim]: enemy }) };
    // All three in one points band (the ledger the attack-rule tests use).
    for (const ownerId of [left, right, victim]) unrecovered[ownerId] = { metal: 400_000_000, minerals: 0, gas: 0 };
  });
  log(`scenario ${scenario}: ${groups.length} groups`);
  return { ...state, npc: { ...state.npc, profiles }, rating: { ...state.rating, unrecoveredCostsByOwnerId: unrecovered },
    espionage: { ...state.espionage, targets, reports: [...(state.espionage.reports ?? []), ...reports] } };
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

const shareAtLeast = (values, floor) => (values.length ? +(values.filter((value) => value >= floor).length / values.length).toFixed(3) : 0);
const spread = (values) => ({ median: median(values), max: Math.max(0, ...values), ge10k: shareAtLeast(values, 10_000), ge25k: shareAtLeast(values, 25_000) });

/** What a planet's turrets cost and how strong they are (attack × life, the square-law strength). */
function defenceWorth(planet) {
  let attack = 0;
  let life = 0;
  let value = 0;
  for (const entity of getFactionDefenseCatalog(planet.raceId)) {
    const count = planet.defense?.defenses?.[entity.id] ?? 0;
    attack += count * (entity.combat?.attack ?? 0);
    life += count * (entity.combat?.life ?? 0);
    value += count * ((entity.cost?.metal ?? 0) + (entity.cost?.minerals ?? 0) + (entity.cost?.gas ?? 0));
  }
  return { value, strength: Math.round(Math.sqrt(attack * life)) };
}

/** Queues and losses read once a game hour: what the end of the run cannot show. Only reads the world. */
/**
 * Sun battles, from the world's own flights (no hook into the game, so any revision can be measured the same
 * way): every sampled hour records the ships of each Sun fleet when first seen and the survivors that fly home.
 * "Weak" hulls are those whose Lanchester strength per population (sqrt(attack x life) / population) is under
 * 80% of their race's strongest ordinary hull; "scouts" the race's lowest-tier hull. `stacksOwnerRule` is what one engine
 * stack per owner group would be (the old rule), `stacksMerged` what identical race/science/level groups give.
 */
export function createSunTally() { return { seen: new Map(), home: new Map() }; }

const hullTiers = new Map();
function hullTier(factionId) {
  if (!hullTiers.has(factionId)) {
    const hulls = getFactionShipCatalog(factionId).filter((entity) => entity.category === 'Боевой корабль' && entity.combat);
    const power = (entity) => Math.sqrt(entity.combat.attack * entity.combat.life) / Math.max(1, entity.population);
    // The race's flagship (planet-destroyer) is far above the rest: "best" is the strongest ordinary hull.
    const sorted = hulls.map(power).sort((x, y) => y - x);
    const best = sorted[1] ?? sorted[0];
    const lowest = hulls.reduce((low, entity) => (power(entity) < power(low) ? entity : low), hulls[0]);
    hullTiers.set(factionId, { best, lowest: lowest.id, byId: new Map(hulls.map((entity) => [entity.id, { population: entity.population, power: power(entity), cost: entity.cost, id: entity.id }])) });
  }
  return hullTiers.get(factionId);
}

export function sampleSun(tally, state) {
  for (const flight of state.flights.records) {
    const snap = flight.sunRaid;
    if (!snap || (flight.ownerSide ?? 'player') === 'player') continue;
    if (!tally.seen.has(flight.id)) tally.seen.set(flight.id, { raidId: snap.raidId, side: snap.side, ownerId: snap.ownerId, factionId: snap.factionId,
      group: JSON.stringify([snap.factionId, snap.technologies, snap.shipLevels]), ownerGroup: JSON.stringify([snap.ownerId, snap.factionId, snap.technologies, snap.shipLevels]), ships: { ...flight.selectedShips } });
    if (flight.phase === 'returning') tally.home.set(flight.id, { ...flight.selectedShips });
  }
}

function describeSunBattles(tally, state) {
  const resolved = new Map((state.sunRaid?.raids ?? []).filter((raid) => raid.status === 'resolved').map((raid) => [raid.id, raid]));
  const sides = { attacker: { pop: 0, weak: 0, scouts: 0, lost: 0, lostValue: 0, stacksOwnerRule: 0, stacksMerged: 0, fleets: 0 }, defender: { pop: 0, weak: 0, scouts: 0, lost: 0, lostValue: 0, stacksOwnerRule: 0, stacksMerged: 0, fleets: 0 } };
  const perSide = new Map();
  for (const [flightId, flight] of tally.seen) {
    if (!resolved.has(flight.raidId)) continue;
    const tier = hullTier(flight.factionId);
    const side = sides[flight.side];
    const entry = perSide.get(`${flight.raidId}:${flight.side}`) ?? { side: flight.side, owner: new Set(), merged: new Set() };
    perSide.set(`${flight.raidId}:${flight.side}`, entry);
    side.fleets += 1;
    const home = tally.home.get(flightId) ?? {};
    for (const [id, count] of Object.entries(flight.ships)) {
      const hull = tier.byId.get(id);
      if (!hull || !(count > 0)) continue;
      const pop = hull.population * count;
      side.pop += pop;
      if (hull.power < 0.8 * tier.best) side.weak += pop;
      if (id === tier.lowest) side.scouts += pop;
      const lost = Math.max(0, count - (home[id] ?? 0));
      side.lost += lost * hull.population;
      side.lostValue += lost * (hull.cost.metal + hull.cost.minerals + hull.cost.gas);
      entry.owner.add(`${flight.ownerGroup}|${id}`);
      entry.merged.add(`${flight.group}|${id}`);
    }
  }
  for (const entry of perSide.values()) { sides[entry.side].stacksOwnerRule += entry.owner.size; sides[entry.side].stacksMerged += entry.merged.size; }
  const raids = [...resolved.values()];
  const count = raids.length || 1;
  const share = (part, whole) => (whole > 0 ? +(part / whole).toFixed(4) : 0);
  const out = { raids: raids.length, attackersWon: raids.filter((raid) => raid.result?.winner === 'attacker').length };
  for (const side of ['attacker', 'defender']) {
    const item = sides[side];
    Object.assign(out, {
      [`${side}Pop`]: Math.round(item.pop / count), [`${side}WeakShare`]: share(item.weak, item.pop), [`${side}ScoutShare`]: share(item.scouts, item.pop),
      [`${side}LossPop`]: Math.round(item.lost / count), [`${side}LossValue`]: Math.round(item.lostValue / count),
      [`${side}StacksOwnerRule`]: +(item.stacksOwnerRule / count).toFixed(1), [`${side}StacksMerged`]: +(item.stacksMerged / count).toFixed(1), [`${side}Fleets`]: +(item.fleets / count).toFixed(1),
    });
  }
  return out;
}

export function createEmpireTally() {
  return { samples: 0, defenseIdle: 0, shipIdle: 0, buildIdle: 0, allIdle: 0, richIdle: 0, lost: {}, known: {}, seenReports: new Set(), colonyDefenceLoss: 0, mainDefenceLoss: 0 };
}

function destroyedValue(force, catalog) {
  const cost = new Map(catalog.map((entity) => [entity.id, (entity.cost?.metal ?? 0) + (entity.cost?.minerals ?? 0) + (entity.cost?.gas ?? 0)]));
  return sum([...(force?.stacks ?? []), ...(force?.defenses ?? [])].map((stack) => Math.max(0, (stack.countBefore ?? 0) - (stack.countAfter ?? 0)) * (cost.get(stack.entityId) ?? 0)));
}

export function sampleEmpire(tally, state, at) {
  const planets = Object.values(state.espionage?.targets ?? {}).filter((target) => target.kind === 'npc');
  const income = new Map();
  for (const planet of planets) income.set(planet.ownerId, (income.get(planet.ownerId) ?? 0) + getNpcPlanetIncomePerHour(planet, 1));
  for (const planet of planets) {
    const busy = (queue) => (queue ?? []).some((order) => order.finishAt > at);
    const defense = busy(planet.fleetProduction?.defenseQueue);
    const ships = busy(planet.fleetProduction?.shipQueue);
    const building = busy(planet.buildingQueue);
    tally.samples += 1;
    if (!defense) tally.defenseIdle += 1;
    if (!ships) tally.shipIdle += 1;
    if (!building) tally.buildIdle += 1;
    if (!defense && !ships && !building) {
      tally.allIdle += 1;
      // Nothing being made while a day of the owner's income lies on this planet.
      if (planet.resources.metal + planet.resources.minerals + planet.resources.gas > 24 * (income.get(planet.ownerId) ?? 0)) tally.richIdle += 1;
    }
  }
  const now = new Map(planets.map((planet) => [planet.id, planet]));
  for (const [id, was] of Object.entries(tally.known)) {
    if (now.get(id)?.ownerId !== was.ownerId) { tally.lost[id] = was; delete tally.known[id]; }
  }
  for (const planet of planets) {
    tally.known[planet.id] = { ownerId: planet.ownerId, main: planet.id === `${planet.ownerId}-planet`, buildings: sum(Object.values(planet.buildings ?? {}).map(Number)),
      income: Math.round(getNpcPlanetIncomePerHour(planet, 1)) };
  }
  // Alliances once an hour (owner order 04.11.2026): how many NPC sit in one, and how many alliances there are.
  const npcIds = Object.keys(state.npc?.profiles ?? {});
  const allied = new Set(state.command.alliances.flatMap((alliance) => alliance.members.map((member) => member.ownerId)));
  tally.allianceSamples = (tally.allianceSamples ?? 0) + 1;
  tally.alliedShareSum = (tally.alliedShareSum ?? 0) + (npcIds.length ? npcIds.filter((id) => allied.has(id)).length / npcIds.length : 0);
  tally.allianceCountSum = (tally.allianceCountSum ?? 0) + state.command.alliances.filter((alliance) => alliance.members.some((member) => npcIds.includes(member.ownerId))).length;
  const npcAlliances = state.command.alliances.filter((alliance) => alliance.members.some((member) => npcIds.includes(member.ownerId)));
  tally.smallShareSum = (tally.smallShareSum ?? 0) + (npcAlliances.length ? npcAlliances.filter((alliance) => alliance.members.length <= 2).length / npcAlliances.length : 0);
  for (const report of state.combat?.reports ?? []) {
    if (tally.seenReports.has(report.id)) continue;
    tally.seenReports.add(report.id);
    const ownerId = report.defender?.playerId;
    const owned = planets.find((planet) => planet.ownerId === ownerId);
    if (!owned) continue;
    const loss = destroyedValue(report.defenderForce, [...getFactionShipCatalog(owned.raceId), ...getFactionDefenseCatalog(owned.raceId)]);
    const planetName = report.defender?.planetName ?? report.defender?.planet;
    const main = planets.find((planet) => planet.id === `${ownerId}-planet`);
    if (main && (planetName === undefined || planetName === main.name)) tally.mainDefenceLoss += loss; else tally.colonyDefenceLoss += loss;
  }
}

function empireSummary(tally) {
  const part = (count) => (tally?.samples ? +(count / tally.samples).toFixed(3) : 0);
  const lost = Object.values(tally?.lost ?? {});
  return { idle: { samples: tally?.samples ?? 0, defense: part(tally?.defenseIdle ?? 0), ships: part(tally?.shipIdle ?? 0), building: part(tally?.buildIdle ?? 0),
    all: part(tally?.allIdle ?? 0), rich: part(tally?.richIdle ?? 0) },
    losses: { planetsLost: lost.length, coloniesLost: lost.filter((planet) => !planet.main).length, valuableLost: lost.filter((planet) => !planet.main && planet.buildings >= 60).length,
      colonyDefenceLoss: Math.round(tally?.colonyDefenceLoss ?? 0), mainDefenceLoss: Math.round(tally?.mainDefenceLoss ?? 0) } };
}

/** Shannon entropy in bits of a table of counts. */
const entropyOf = (counts) => {
  const total = sum(counts);
  return total ? -sum(counts.filter((count) => count > 0).map((count) => (count / total) * Math.log2(count / total))) : 0;
};

/**
 * Diversity of play (stage H): how many different ways the owners play. The
 * entropy of the styles they settled on, and how far each owner's mix of started
 * action kinds lies from the average mix (mean L1 distance, 0..2).
 */
export function describeDiversity(journal, owners) {
  const finalStyle = new Map();
  for (const entry of journal.filter((item) => item.k === 'style')) finalStyle.set(entry.o, entry.s);
  const styleCounts = {};
  for (const style of finalStyle.values()) styleCounts[style] = (styleCounts[style] ?? 0) + 1;
  const kinds = new Set();
  const mix = new Map(owners.map((ownerId) => [ownerId, {}]));
  for (const entry of journal) {
    if (!entry.c || entry.ok !== 1 || !mix.has(entry.o)) continue;
    kinds.add(entry.k);
    mix.get(entry.o)[entry.k] = (mix.get(entry.o)[entry.k] ?? 0) + 1;
  }
  const shares = owners.map((ownerId) => { const own = mix.get(ownerId); const total = sum(Object.values(own)); return Object.fromEntries([...kinds].map((kind) => [kind, total ? (own[kind] ?? 0) / total : 0])); });
  const mean = Object.fromEntries([...kinds].map((kind) => [kind, sum(shares.map((row) => row[kind])) / Math.max(1, shares.length)]));
  const distances = shares.map((row) => sum([...kinds].map((kind) => Math.abs(row[kind] - mean[kind]))));
  return { styleEntropy: +entropyOf(Object.values(styleCounts)).toFixed(3), styleKinds: Object.keys(styleCounts).length,
    actionMixSpread: +(sum(distances) / Math.max(1, distances.length)).toFixed(3) };
}

/**
 * Alliance life (owner order 04.11.2026): sizes, share of NPC in alliances, applications, answers, joins and
 * leaves per game day, wars, and how often the strongest alliances are chosen. Read from the state and the
 * journal only, so it works on any revision.
 */
export function describeAlliances(state, journal, tally, hours) {
  const npcIds = new Set(Object.keys(state.npc?.profiles ?? {}));
  const days = Math.max(1, hours / 24);
  const alliances = state.command.alliances.filter((alliance) => alliance.members.some((member) => npcIds.has(member.ownerId)));
  const strength = (alliance) => sum(alliance.members.map((member) => selectOwnerScore(state, member.ownerId)?.totalPoints ?? 0));
  const ranked = [...state.command.alliances].sort((a, b) => strength(b) - strength(a) || (a.id < b.id ? -1 : 1)).map((alliance) => alliance.id);
  const started = (prefix) => journal.filter((entry) => entry.ok === 1 && typeof entry.c === 'string' && entry.c.startsWith(prefix));
  const applies = started('apply-to-alliance:');
  const chosenRank = applies.map((entry) => ranked.indexOf(entry.c.split(':').slice(2).join(':')));
  const sizes = alliances.map((alliance) => alliance.members.length).sort((a, b) => b - a);
  const joins = started('accept-application:').length;
  const leaves = started('leave-alliance:').length;
  const wars = state.command.diplomacy.filter((relation) => relation.status === 'war').length;
  return {
    alliances: alliances.length, sizes, largest: sizes[0] ?? 0,
    alliedShareNow: npcIds.size ? +(sum(alliances.map((alliance) => alliance.members.filter((member) => npcIds.has(member.ownerId)).length)) / npcIds.size).toFixed(3) : 0,
    alliedShareMean: tally?.allianceSamples ? +(tally.alliedShareSum / tally.allianceSamples).toFixed(3) : 0,
    smallNow: alliances.length ? +(sizes.filter((size) => size <= 2).length / alliances.length).toFixed(3) : 0,
    smallShareMean: tally?.allianceSamples ? +(tally.smallShareSum / tally.allianceSamples).toFixed(3) : 0,
    alliancesMean: tally?.allianceSamples ? +(tally.allianceCountSum / tally.allianceSamples).toFixed(2) : 0,
    applications: applies.length, accepted: joins, rejected: started('reject-application:').length,
    joinsPerDay: +(joins / days).toFixed(2), leavesPerDay: +(leaves / days).toFixed(2), leaves, created: started('create-alliance:').length,
    wars,
    topChosen: applies.length ? +(chosenRank.filter((rank) => rank === 0).length / applies.length).toFixed(3) : 0,
    top3Chosen: applies.length ? +(chosenRank.filter((rank) => rank >= 0 && rank < 3).length / applies.length).toFixed(3) : 0,
  };
}

/** What the world looks like for the questions the owner asks. */
/** Pirate raids resolved so far (owner rule 04.11.2026: raid size follows combat population only). */
function pirateRaidTally(state) {
  const reports = (state.combat?.reports ?? []).filter((report) => report.missionType === 'pirate-raid');
  const piratePop = reports.map((report) => report.attackerForce?.populationBefore ?? 0);
  const defenderPop = reports.map((report) => report.defenderForce?.populationBefore ?? 0);
  const defenderLost = reports.map((report) => Math.max(0, (report.defenderForce?.populationBefore ?? 0) - (report.defenderForce?.populationAfter ?? 0)));
  return { raids: reports.length, piratePopulation: sum(piratePop), defenderPopulation: sum(defenderPop), defenderLost: sum(defenderLost),
    pirateWins: reports.filter((report) => report.winner === 'attacker').length };
}

export function describeWorld(state, journal = [], tally = null, sunTally = null) {
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
  const defencePlanets = npcPlanets.map((planet) => ({ population: calculateDefensePopulation({ defenses: planet.defense?.defenses ?? {} }, planet.raceId), units: positiveSum(planet.defense?.defenses),
    hangar: Number(planet.buildings?.hangar ?? 0), shipyard: Number(planet.buildings?.shipyard ?? 0), factory: Number(planet.buildings?.['advanced-factory'] ?? 0),
    batteries: (planet.defense?.defenses?.['ion-plasma-battery'] ?? 0) + (planet.defense?.defenses?.['plasma-laser-battery'] ?? 0),
    ...defenceWorth(planet) }));
  const closedPlans = journal.filter((entry) => entry.k === 'plan' && entry.d?.tp === 'strike' && entry.d?.st === 'done');
  const conscious = closedPlans.filter((entry) => entry.d?.cl);
  const ordinary = closedPlans.filter((entry) => !entry.d?.cl);
  const planNet = (entries) => Math.round(sum(entries.map((entry) => (entry.d?.gain ?? 0) - (entry.d?.loss ?? 0))));
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
  // The outcome ledger (every owner): strategic plans and battles.
  const plans = journal.filter((entry) => entry.k === 'plan' && entry.d?.tp === 'strike');
  const attacks = journal.filter((entry) => entry.k === 'battle' && entry.d?.side === 'attacker');
  const defences = journal.filter((entry) => entry.k === 'battle' && entry.d?.side === 'defender');
  const reasons = {};
  for (const entry of plans.filter((item) => item.d?.st !== 'done')) reasons[entry.d?.why ?? '?'] = (reasons[entry.d?.why ?? '?'] ?? 0) + 1;
  const ascending = [...points].reverse();
  const third = Math.max(1, Math.floor(ascending.length / 3));
  // Agreements between NPC (stage E): the bot journal is where they are visible.
  const pacts = journal.filter((entry) => entry.k === 'pact');
  const pactEvents = (kind, event) => pacts.filter((entry) => entry.d?.tp === kind && entry.d?.ev === event);
  const arrivals = pactEvents('joint-strike', 'arrived');
  const whyNot = {};
  for (const entry of pacts.filter((item) => item.d?.ev === 'declined')) { const key = `${entry.d.tp}:${entry.d.why}`; whyNot[key] = (whyNot[key] ?? 0) + 1; }
  const gifts = pactEvents('resource-gift', 'accepted').map((entry) => ({ from: entry.d.to, to: entry.d.from, at: entry.t, amount: entry.d.sent ?? 0 })).sort((a, b) => a.at - b.at);
  // A chain of gifts that brings wealth back to its sender within two days.
  const giftCycles = gifts.filter((gift, index) => {
    const reached = new Set([gift.to]);
    for (const later of gifts.slice(index + 1)) {
      if (later.at - gift.at > 48 * HOUR) break;
      if (!reached.has(later.from)) continue;
      if (later.to === gift.from) return true;
      reached.add(later.to);
    }
    return false;
  }).length;
  const pairCounts = {};
  for (const entry of pactEvents('joint-strike', 'fulfilled')) { const key = [entry.d.from, entry.d.to].sort().join('+'); pairCounts[key] = (pairCounts[key] ?? 0) + 1; }
  const social = {
    proposed: pactEvents('joint-strike', 'proposed').length, accepted: pactEvents('joint-strike', 'accepted').length, declined: pactEvents('joint-strike', 'declined').length,
    expired: pactEvents('joint-strike', 'expired').length, fulfilled: pactEvents('joint-strike', 'fulfilled').length, broken: pactEvents('joint-strike', 'broken').length,
    betrayed: pactEvents('joint-strike', 'broken').filter((entry) => entry.d?.why === 'betrayed').length,
    withdrawn: pactEvents('joint-strike', 'withdrawn').length, cancelled: pactEvents('joint-strike', 'cancelled').length,
    jointBattles: arrivals.length, jointWon: arrivals.filter((entry) => entry.d?.won === 1).length,
    jointHit: Math.round(sum(arrivals.map((entry) => attacks.find((battle) => battle.o === entry.o && battle.t === entry.t)?.d?.hit ?? 0))),
    jointGain: Math.round(sum(arrivals.map((entry) => entry.d?.gain ?? 0))), jointLoss: Math.round(sum(arrivals.map((entry) => entry.d?.loss ?? 0))),
    againstPlayer: pactEvents('joint-strike', 'proposed').filter((entry) => entry.d?.target === playerId).length,
    giftAsked: pactEvents('resource-gift', 'proposed').length, giftSent: gifts.length, giftDeclined: pactEvents('resource-gift', 'declined').length,
    giftDelivered: pactEvents('resource-gift', 'fulfilled').length, giftVolume: sum(gifts.map((gift) => gift.amount)), giftCycles,
    bestPairRepeats: Math.max(0, ...Object.values(pairCounts)), whyNot: Object.entries(whyNot).sort((a, b) => b[1] - a[1]),
    reactions: journal.filter((entry) => entry.k === 'reaction').reduce((counts, entry) => ({ ...counts, [entry.d?.react]: (counts[entry.d?.react] ?? 0) + 1 }), {}),
    relationEdges: Object.values(state.npcStrategy?.relations ?? {}).reduce((total, edges) => total + edges.length, 0),
    strategyBytes: JSON.stringify(state.npcStrategy ?? null).length,
  };
  const activePlans = Object.values(state.npcStrategy?.plans ?? {}).flat().filter((plan) => plan.template === 'strike' && plan.status === 'active');
  return {
    worldAt: new Date(state.npcReplay?.processedThroughAt ?? 0).toISOString(), owners: owners.length,
    alliances: state.command.alliances.filter((alliance) => alliance.members.some((member) => member.ownerId !== playerId)).map((alliance) => `${alliance.tag}:${alliance.members.length}`),
    allianceLife: describeAlliances(state, journal, tally, tally?.allianceSamples ?? 24),
    pirateRaids: pirateRaidTally(state),
    sun: {
      declared: raids.length, disbanded: raids.filter((raid) => raid.status === 'disbanded').length,
      flew: raids.filter((raid) => raid.status === 'incoming' || raid.status === 'resolved').length,
      won: raids.filter((raid) => raid.result?.winner === 'attacker').length,
      alliancesTried: new Set(raids.map((raid) => raid.allianceId)).size,
      crystals: sum(Object.values(state.sunRaid?.crystals ?? {}).map((list) => list.length)), gates: (state.sunRaid?.gates ?? []).length,
      battles: sunTally ? describeSunBattles(sunTally, state) : null,
    },
    debris: { fields: debris.length, total: Math.round(sum(debris.map((field) => field.debris))), largest: Math.round(Math.max(0, ...debris.map((field) => field.debris))),
      recycleFlightsLive: flights.filter((flight) => flight.missionId === 'recycle').length,
      recycleStarted: started.filter((entry) => /^npc-mission:[^:]+:recycle:/.test(entry.c)).length },
    probesInFlight: flights.filter((flight) => flight.missionId === 'espionage').length,
    resources: { median: median(perOwner.map((owner) => owner.resources)), max: Math.max(0, ...perOwner.map((owner) => owner.resources)) },
    mainDefense: { median: median(perOwner.map((owner) => owner.mainDefense)), max: Math.max(0, ...perOwner.map((owner) => owner.mainDefense)) },
    empire: { planets: npcPlanets.length, defensePopulation: spread(defencePlanets.map((planet) => planet.population)), defenseUnits: spread(defencePlanets.map((planet) => planet.units)),
      batteries: { median: median(defencePlanets.map((planet) => planet.batteries)), max: Math.max(0, ...defencePlanets.map((planet) => planet.batteries)) },
      strength: { median: median(defencePlanets.map((planet) => planet.strength)), max: Math.max(0, ...defencePlanets.map((planet) => planet.strength)) },
      defenseValue: { median: median(defencePlanets.map((planet) => planet.value)), total: sum(defencePlanets.map((planet) => planet.value)) },
      stores: { metal: Math.round(sum(npcPlanets.map((planet) => planet.resources.metal))), minerals: Math.round(sum(npcPlanets.map((planet) => planet.resources.minerals))), gas: Math.round(sum(npcPlanets.map((planet) => planet.resources.gas))) },
      hangarMedian: median(defencePlanets.map((planet) => planet.hangar)), shipyardMedian: median(defencePlanets.map((planet) => planet.shipyard)), factoryMedian: median(defencePlanets.map((planet) => planet.factory)),
      incomePerHour: Math.round(sum(npcPlanets.map((planet) => getNpcPlanetIncomePerHour(planet, 1)))),
      resourcesTotal: sum(perOwner.map((owner) => owner.resources)), ...empireSummary(tally) },
    planProfit: { done: closedPlans.length, net: planNet(closedPlans), profitable: closedPlans.filter((entry) => (entry.d?.gain ?? 0) > (entry.d?.loss ?? 0)).length,
      forecastNet: Math.round(sum(closedPlans.map((entry) => (entry.d?.f?.g ?? 0) - (entry.d?.f?.l ?? 0)))),
      ordinary: { done: ordinary.length, net: planNet(ordinary), profitable: ordinary.filter((entry) => (entry.d?.gain ?? 0) > (entry.d?.loss ?? 0)).length },
      conscious: { done: conscious.length, net: planNet(conscious) } },
    fleetOnLargestMedian: median(perOwner.map((owner) => owner.fleetOnLargest)),
    transport: { transporters: sum(perOwner.map((owner) => owner.transporters)), mega: sum(perOwner.map((owner) => owner.megaTransporters)) },
    points: { top: points[0] ?? 0, median: median(points), bottom: points.at(-1) ?? 0, topToBottom: points.at(-1) ? +(points[0] / points.at(-1)).toFixed(1) : null },
    actions: { started: started.length, refused: decisions.length - started.length, byKind, topRefusals: Object.entries(refusals).sort((a, b) => b[1] - a[1]).slice(0, 6) },
    plans: { closed: plans.length, done: plans.filter((entry) => entry.d?.st === 'done').length,
      won: plans.filter((entry) => entry.d?.st === 'done' && entry.d?.won === 1).length,
      active: activePlans.length, multiPlanet: plans.filter((entry) => (entry.d?.planets ?? 0) >= 3).length,
      notDone: Object.entries(reasons).sort((a, b) => b[1] - a[1]),
      meanAbsError: plans.filter((entry) => typeof entry.d?.err === 'number').length
        ? +(sum(plans.filter((entry) => typeof entry.d?.err === 'number').map((entry) => Math.abs(entry.d.err))) / plans.filter((entry) => typeof entry.d?.err === 'number').length).toFixed(3) : null },
    raidSizing: raidSizing(journal),
    battles: { attacks: attacks.length, attacksWon: attacks.filter((entry) => entry.d?.won === 1).length,
      raidGain: Math.round(sum(attacks.map((entry) => entry.d?.gain ?? 0))), raidLoss: Math.round(sum(attacks.map((entry) => entry.d?.loss ?? 0))),
      defences: defences.length, defenceLoss: Math.round(sum(defences.map((entry) => entry.d?.loss ?? 0))) },
    social,
    bottomThirdPoints: Math.round(sum(ascending.slice(0, third)) / third),
    diversity: describeDiversity(journal, owners),
    styleChanges: styles.length, styles: Object.entries(styles.reduce((counts, entry) => ({ ...counts, [entry.s]: (counts[entry.s] ?? 0) + 1 }), {})),
    perOwner,
  };
}

/** How big the raids were (owner report 05.11): the share of the planet's combat fleet sent, and the share of the target's stores carried off. */
export function raidSizing(journal) {
  const sum = (list, pick) => list.reduce((total, entry) => total + (Number(pick(entry)) || 0), 0);
  const sends = journal.filter((entry) => entry.k === 'send' && entry.d?.fl !== undefined);
  const waves = journal.filter((entry) => entry.k === 'send' && entry.d?.wave);
  const raids = journal.filter((entry) => entry.k === 'battle' && entry.d?.side === 'attacker' && entry.d?.m === 'attack');
  const fleetAvailable = sum(sends, (entry) => entry.d.av);
  const held = sum(raids, (entry) => entry.d.held);
  const ratio = (a, b) => (b > 0 ? +(a / b).toFixed(3) : 0);
  const lone = raids.filter((entry) => (entry.d.held ?? 0) > 0);
  return { sends: sends.length, waves: sum(waves, (entry) => entry.d.wave), waveCargo: Math.round(sum(waves, (entry) => entry.d.cargo)), fleetSent: Math.round(sum(sends, (entry) => entry.d.fl)), fleetAvailable: Math.round(fleetAvailable),
    fleetShare: ratio(sum(sends, (entry) => entry.d.fl), fleetAvailable),
    raids: raids.length, raidsWon: raids.filter((entry) => entry.d.won === 1).length, loot: Math.round(sum(raids, (entry) => entry.d.gain)), held: Math.round(held),
    lootShare: ratio(sum(raids, (entry) => entry.d.gain), held),
    lootShareWon: ratio(sum(raids.filter((entry) => entry.d.won === 1), (entry) => entry.d.gain), sum(raids.filter((entry) => entry.d.won === 1), (entry) => entry.d.held)),
    lootShareMedian: lone.length ? +[...lone].map((entry) => entry.d.gain / entry.d.held).sort((a, b) => a - b)[Math.floor(lone.length / 2)].toFixed(3) : 0,
    broughtValue: Math.round(sum(raids, (entry) => entry.d.sent)), lostValue: Math.round(sum(raids, (entry) => entry.d.loss)) };
}

/** Planet shield figures of one run (owner request 06.11.2026): who used it, what it turned away. */
export function describeShield(state, telemetry) {
  const npcOwners = getNpcOwnerIds(state.espionage?.targets, state.profile.playerId);
  const used = npcOwners.filter((ownerId) => state.shields?.[ownerId]);
  return { npcOwners: npcOwners.length, npcUsedShield: used.length, npcShare: npcOwners.length ? Math.round((used.length / npcOwners.length) * 1000) / 1000 : 0, ...telemetry };
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
  if (option('policy')) setNpcPolicyOverride(JSON.parse(fs.readFileSync(option('policy'), 'utf8')));
  if (out) fs.mkdirSync(out, { recursive: true });
  const save = option('save');
  const owners = option('owners')?.split(',').filter(Boolean);
  let state = save ? readSave(save) : option('fixture') ? readSave(option('fixture'))
    : createLabWorld(Number(option('bots', '15')), option('seed') ? `BOTLAB-${option('seed')}` : 'BOTLAB2026');
  if (option('scenario') === 'seven-planets' && !save && !option('fixture')) state = applySevenPlanetsScenario(state);
  if (['familiar-solos', 'conflict'].includes(option('scenario')) && !save && !option('fixture')) state = applySocialScenario(state, option('scenario'));
  if (option('scenario') === 'sun-raids' && !save && !option('fixture')) state = applySunRaidsScenario(state);
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
    // Outcomes of every owner, whoever is watched in detail.
    outcome: (entry) => journal.push({ t: entry.at, o: entry.ownerId, k: entry.kind, d: entry.data }),
    style: (entry) => {
      if ((watched && !watched.has(entry.ownerId)) || styles.get(entry.ownerId) === entry.style) return;
      journal.push({ t: entry.at, o: entry.ownerId, k: 'style', s: entry.style, d: { from: styles.get(entry.ownerId) ?? null, why: entry.reason } });
      styles.set(entry.ownerId, entry.style);
    },
  });
  const hours = save ? Number(option('hours', '6')) : option('hours') ? Number(option('hours')) : Number(option('days', '2')) * 24;
  const days = [];
  const startedAt = performance.now();
  shieldModule?.resetShieldTelemetry();
  let groups;
  const tally = createEmpireTally();
  const sunTally = createSunTally();
  for (let hour = 1; hour <= hours; hour += 1) {
    const step = advanceLiveWorld(state, at0 + hour * HOUR, { groups });
    state = step.state;
    groups = step.groups;
    sampleEmpire(tally, state, at0 + hour * HOUR);
    sampleSun(sunTally, state);
    if (hour % 24 === 0 || hour === hours) {
      const summary = describeWorld(state, journal, tally, sunTally);
      days.push({ hour, problems: listProblems(summary), ...summary });
      log(`lab h${hour} (${Math.round((performance.now() - startedAt) / 1000)} s): ${JSON.stringify({ sun: summary.sun, debris: summary.debris, points: summary.points, problems: listProblems(summary) })}`);
    }
  }
  setNpcJournalSink(null);
  const result = { tool: 'bot-lab', policy: { file: option('policy') ? path.basename(option('policy')) : null, version: getNpcPolicy().version, params: getNpcPolicy().params }, source: save ? path.basename(save) : option('fixture') ? path.basename(option('fixture')) : 'fresh lab world',
    hours, wallSeconds: Math.round((performance.now() - startedAt) / 1000), journalEntries: journal.length, days,
    shield: shieldModule ? describeShield(state, shieldModule.SHIELD_TELEMETRY) : null };
  if (out) {
    fs.writeFileSync(path.join(out, 'summary.json'), JSON.stringify(result, null, 2));
    fs.writeFileSync(path.join(out, 'bots-journal.jsonl'), formatNpcJournalLines(journal));
    fs.writeFileSync(path.join(out, 'world.json'), serializeSaveForStorage(state, 'production'));
  }
  console.log(JSON.stringify({ ...result, days: days.map(({ perOwner: _perOwner, ...day }) => day) }, null, 2));
}

if (import.meta.url === `file://${process.argv[1]?.replace(/\\/g, '/').replace(/^(?=[A-Za-z]:)/, '/')}`) main();
