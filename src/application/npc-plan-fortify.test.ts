// Plan «fortify-empire» (owner decision 8, ADR stage D, T-DEF-01): every planet
// of an owner aims at its own defence population by worth and danger, its best
// batteries first, through the player's own orders and buildings.
import assert from 'node:assert/strict';
import test from 'node:test';

import { createDefaultNewGameConfig } from '../domain/world/config.ts';
import { getEspionageTargets } from '../domain/espionage/runtime.ts';
import type { SpyTargetState } from '../domain/espionage/types.ts';
import { createDefaultFleetProductionState, createEmptyDefenseState, getDefensePopulationSummary } from '../domain/fleet/production.ts';
import { createEmptyFleetState } from '../domain/fleet/runtime.ts';
import { getHangarCapacity } from '../domain/buildings/balance-v1.ts';
import { getFactionDefenseCatalog } from '../domain/combat/faction-catalog.ts';
import { utilityToWeight } from '../domain/npc/utility.ts';
import { isNpcStrategyState, type NpcFortifyPlan } from '../domain/npc/strategy.ts';
import { createInitialSaveState } from './persistence.ts';
import { getNpcBuildingCandidates } from './npc-economy.ts';
import { getNpcFleetProductionCandidates } from './npc-fleet-production.ts';
import { activeNpcFortifyPlan, createNpcUtilityContext, estimateProductionItemUtility, npcBatteryStats } from './npc-utility.ts';
import { getNpcFortifyChoices, NPC_FORTIFY_BALANCE, npcFortifyAmbition, npcFortifyShortfalls, npcFortifyTargets, refreshNpcFortify } from './npc-plan-fortify.ts';
import { estimateStrikeWorth } from './npc-plans.ts';
import type { SaveState } from './contracts.ts';

const START = Date.UTC(2026, 9, 27, 12);
const SCIENCE = Object.fromEntries(Array.from({ length: 40 }, (_, index) => [index + 1, 15]));
const FORTRESS = { economyFocus: 0.9, riskTolerance: 0.05, aggression: 0.05, militaryFocus: 0.1, cooperation: 0.1, socialStyle: 0.1, expansionFocus: 0.1, planningHorizon: 0.9 };
const RAIDER = { aggression: 1, riskTolerance: 0.8, militaryFocus: 0.3, economyFocus: 0.1, cooperation: 0.1, socialStyle: 0.1, planningHorizon: 0.1, operationsInterest: 0.1 };

function planetsOf(state: SaveState): SpyTargetState[] {
  return Object.values(getEspionageTargets(state.espionage)).filter((target) => target.kind === 'npc')
    .sort((left, right) => left.id.localeCompare(right.id));
}

type Empire = { state: SaveState; owner: string; planets: string[] };

/** One owner with `count` built-up planets and stores for any plan. */
function empire(seed: string, traits: Record<string, number>, count = 3, resources = 300_000_000, buildings: Record<string, number> = {}): Empire {
  const base = createDefaultNewGameConfig({ seed, factionId: 'aegis', playerName: 'Fortify' });
  const state = createInitialSaveState('production', START, { ...base, world: { ...base.world, npcCount: 9, campaignSpeed: 'standard' as const } });
  const all = planetsOf(state);
  const owner = all[0]!.ownerId;
  const ownerProfile = { scienceLevels: SCIENCE, shipLevels: {}, commanderLevels: {} };
  const targets = { ...getEspionageTargets(state.espionage) };
  const planets = all.slice(0, count).map((planet) => planet.id);
  for (const id of planets) {
    targets[id] = { ...targets[id]!, ownerId: owner, ownerName: all[0]!.ownerName, raceId: 'aegis', ownerProfile,
      resources: { ...targets[id]!.resources, metal: resources, minerals: resources, gas: resources },
      buildings: { ...targets[id]!.buildings, shipyard: 15, hangar: 20, 'advanced-factory': 5, 'metal-storage': 30, 'mineral-storage': 30, 'gas-storage': 30, 'metal-production-1': 25, 'mineral-production-1': 25, 'gas-production-1': 25, ...buildings },
      fleet: createEmptyFleetState(), defense: createEmptyDefenseState(), fleetProduction: createDefaultFleetProductionState(), buildingQueue: [] } as SpyTargetState;
  }
  const profile = state.npc!.profiles[owner]!;
  return { owner, planets, state: { ...state, espionage: { ...state.espionage!, targets }, npc: { ...state.npc!, profiles: { ...state.npc!.profiles, [owner]: { ...profile, traits: { ...profile.traits, ...traits } } } } } };
}

function look(world: Empire, state = world.state, at = START + 60_000) {
  const profile = state.npc!.profiles[world.owner]!;
  const utility = createNpcUtilityContext(state, profile, at, 1);
  const planned = refreshNpcFortify(state, profile, utility, at, 1);
  const fresh = createNpcUtilityContext(planned, profile, at, 1);
  const inputs = new Map(planetsOf(planned).filter((planet) => planet.ownerId === world.owner).map((planet) => [planet.id, {
    production: getNpcFleetProductionCandidates(planet, world.owner, at, 1), buildings: getNpcBuildingCandidates(planet, true),
  }]));
  const choices = getNpcFortifyChoices(planned, profile, fresh, at, 1, inputs, (_id, estimate) => utilityToWeight(estimate));
  return { state: planned, utility: fresh, choices, profile };
}

test('the full hangar holds the owner\'s ~25 000 as population: no real battery reaches it by unit count', () => {
  assert.equal(getHangarCapacity(20), 25_112);
  for (const race of ['aegis', 'synod', 'veyra'] as const) {
    const best = npcBatteryStats(race)[0]!;
    assert.ok(25_112 / best.population < 2_000, `${race}: ${best.id} fits ${Math.floor(25_112 / best.population)} times`);
    assert.ok(getFactionDefenseCatalog(race).some((entity) => entity.id === best.id));
    assert.ok(best.id === 'ion-plasma-battery' || best.id === 'plasma-laser-battery', `${race}: the best is a battery, not a cheap turret (${best.id})`);
  }
});

test('T-DEF-01: every planet of a defence-minded owner aims at the full target; a raider aims lower; danger raises it', () => {
  const fortress = empire('fortify-style', FORTRESS, 7);
  const profile = fortress.state.npc!.profiles[fortress.owner]!;
  const targets = npcFortifyTargets(fortress.state, profile, createNpcUtilityContext(fortress.state, profile, START, 1), START, 1)!;
  assert.deepEqual(Object.keys(targets).sort(), [...fortress.planets].sort(), 'every planet, not only the main one');
  for (const id of fortress.planets) assert.equal(targets[id], 25_000);

  const raider = empire('fortify-style', RAIDER, 7);
  const raiderProfile = raider.state.npc!.profiles[raider.owner]!;
  assert.ok(npcFortifyAmbition(raiderProfile) < npcFortifyAmbition(profile));
  const calm = npcFortifyTargets(raider.state, raiderProfile, createNpcUtilityContext(raider.state, raiderProfile, START, 1), START, 1)!;
  for (const id of raider.planets) assert.equal(calm[id], NPC_FORTIFY_BALANCE.styleCap.raider);

  // The attack on its way is seen on one planet: that planet alone goes up to the full target.
  const attacked = raider.planets[2]!;
  const flight = { id: 'incoming-attack', phase: 'outbound', arrivalAt: START + 3_600_000, ownerId: 'someone-else', missionId: 'attack',
    destinationPlanetId: attacked, ownerSide: 'npc', selectedShips: {}, selectedCommanders: {} };
  const seen = { ...raider.state, flights: { ...raider.state.flights, records: [...raider.state.flights.records, flight as never] } };
  const danger = npcFortifyTargets(seen, raiderProfile, createNpcUtilityContext(seen, raiderProfile, START, 1), START, 1)!;
  assert.equal(danger[attacked], 25_000);
  assert.equal(danger[raider.planets[0]!], NPC_FORTIFY_BALANCE.styleCap.raider);
});

test('a poor owner\'s targets are what it can afford, and a very small economy has no plan', () => {
  const poor = empire('fortify-poor', FORTRESS, 3, 2_000_000);
  const profile = poor.state.npc!.profiles[poor.owner]!;
  const context = createNpcUtilityContext(poor.state, profile, START, 1);
  const targets = npcFortifyTargets(poor.state, profile, context, START, 1)!;
  const price = npcBatteryStats('aegis')[0]!;
  const affordable = (18_000_000 + 3 * context.dayValue) / (price.cost / price.population);
  const total = Object.values(targets).reduce((sum, value) => sum + value, 0);
  assert.ok(total <= Math.ceil(affordable) + 3, `${total} ≤ ${affordable}`);
  assert.equal(npcFortifyTargets(poor.state, profile, { ...context, dayValue: 900_000 }, START, 1), null);
});

test('the steps are the best battery on each planet, paid from above a reserve, and the plan survives the save', () => {
  const world = empire('fortify-steps', FORTRESS);
  const { state, choices } = look(world);
  const plan = activeNpcFortifyPlan(state, world.owner)!;
  assert.ok(isNpcStrategyState(JSON.parse(JSON.stringify(state.npcStrategy))));
  assert.equal(plan.template, 'fortify-empire');
  const orders = choices.filter((choice) => choice.candidate.id.startsWith('fortify:order:'));
  assert.equal(orders.length, 3, 'one order per planet');
  let next = state;
  for (const [index, order] of orders.entries()) {
    assert.match(order.candidate.id, /ion-plasma-battery$/, 'its best battery, not the cheapest');
    const planetId = String(order.candidate.payload!.planetId);
    const before = getEspionageTargets(next.espionage)[planetId]!;
    const outcome = order.run(next, `fortify-test:${index}`);
    assert.equal(outcome.started, true, String(outcome.reason));
    next = outcome.state;
    const after = getEspionageTargets(next.espionage)[planetId]!;
    assert.ok(after.resources.metal < before.resources.metal, 'it pays the same price');
    assert.ok(after.resources.metal > 0 && after.resources.gas > 0, 'part of the stores stays');
    const queue = after.fleetProduction!.defenseQueue;
    assert.equal(queue.length, 1);
    const summary = getDefensePopulationSummary(after.defense, after.fleetProduction!, 20, 'aegis');
    assert.ok(summary.population <= summary.capacity, 'the hangar rule holds');
    assert.ok(summary.pendingPopulation <= plan.targets[planetId]!);
  }
  assert.equal(activeNpcFortifyPlan(next, world.owner)?.planId, plan.planId, 'the plan stays until reviewed');
  // While the plan runs, nothing else orders turrets here (a cheap one would hold the population for good).
  const utility = createNpcUtilityContext(next, next.npc!.profiles[world.owner]!, START + 60_000, 1);
  const planet = getEspionageTargets(next.espionage)[world.planets[0]!]!;
  assert.equal(estimateProductionItemUtility(utility, planet, 'defense', 'ballistic-turret', { metal: 1, minerals: 1, gas: 0, energy: 0 } as never, undefined, 0.2), -2.5);
});

test('what holds the batteries back is built first: the hangar when it is too small, the yard when it is too slow or too low', () => {
  const small = empire('fortify-bottleneck', FORTRESS, 2, 300_000_000, { hangar: 12, shipyard: 10, 'advanced-factory': 0 });
  const { choices } = look(small);
  const ids = choices.map((choice) => choice.candidate.id);
  assert.ok(ids.some((id) => id.startsWith('fortify:hangar:')), `hangar in ${ids}`);
  assert.ok(ids.some((id) => id.startsWith('fortify:shipyard:')), `shipyard in ${ids}`);
  // Below the best battery's yard level a cheaper real battery fills in, never the junk.
  const orders = ids.filter((id) => id.startsWith('fortify:order:'));
  assert.ok(orders.length > 0);
  for (const id of orders) assert.doesNotMatch(id, /ballistic|laser-turret|ion-turret/);
});

test('stop-gap turrets only up to a small share of the target, unless an attack is on its way', () => {
  const world = empire('fortify-gap', FORTRESS, 1, 300_000_000, { shipyard: 5 });
  const planetId = world.planets[0]!;
  const targets = { ...getEspionageTargets(world.state.espionage) };
  targets[planetId] = { ...targets[planetId]!, ownerProfile: { scienceLevels: { 1: 5 }, shipLevels: {}, commanderLevels: {} },
    defense: { defenses: { ...targets[planetId]!.defense.defenses, 'ion-turret': 600 } } } as SpyTargetState;
  const filled = { ...world, state: { ...world.state, espionage: { ...world.state.espionage!, targets } } };
  const quiet = look(filled);
  assert.equal(quiet.choices.filter((choice) => choice.candidate.id.startsWith('fortify:order:')).length, 0, 'it waits for real batteries');
  const flight = { id: 'incoming-attack', phase: 'outbound', arrivalAt: START + 3_600_000, ownerId: 'someone-else', missionId: 'attack',
    destinationPlanetId: planetId, ownerSide: 'npc', selectedShips: {}, selectedCommanders: {} };
  const attacked = look(filled, { ...filled.state, flights: { ...filled.state.flights, records: [...filled.state.flights.records, flight as never] } });
  assert.ok(attacked.choices.some((choice) => choice.candidate.id.startsWith('fortify:order:')), 'under attack anything that fights will do');
});

test('surplus goes where batteries are missing: a planet\'s shortfall is what its target still costs', () => {
  const world = empire('fortify-shortfall', FORTRESS);
  const { state } = look(world);
  const planets = planetsOf(state).filter((planet) => planet.ownerId === world.owner);
  const lacking = npcFortifyShortfalls(state, world.owner, planets);
  const best = npcBatteryStats('aegis')[0]!;
  assert.equal(lacking.size, 3);
  assert.equal(Math.round(lacking.get(world.planets[0]!)!), Math.round(25_000 * best.cost / best.population));
});

test('the plan is valid save data, and an unreadable one drops the section', () => {
  const world = empire('fortify-save', FORTRESS);
  const { state } = look(world);
  const plan = activeNpcFortifyPlan(state, world.owner) as NpcFortifyPlan;
  assert.ok(plan.ambition > 0.9);
  const broken = { ...state.npcStrategy!, plans: { [world.owner]: [{ ...plan, targets: { x: -1 } }] } };
  assert.equal(isNpcStrategyState(broken), false);
});

test('a strike is judged on the game\'s formulas: a usual owner refuses a resource loss, a risky one takes it knowingly, a rich target pays', () => {
  const world = empire('fortify-worth', { riskTolerance: 0.3, aggression: 0.3 });
  const planets = planetsOf(world.state);
  const rally = planets[0]!;
  const victim = planets.find((planet) => planet.ownerId !== world.owner)!;
  const report = { ownerId: world.owner, id: 'worth-report', missionId: 'worth-mission', createdAt: START, sourcePlanetId: rally.id, targetPlanetId: victim.id,
    targetPlanetName: victim.name, targetOwnerId: victim.ownerId, targetOwnerName: victim.ownerName, targetRaceId: victim.raceId, targetRelation: 'neutral',
    targetCoordinate: { ...victim.coordinate }, spyLevel: 10, targetEspionageLevel: 0, delta: 10, roll: 0.5, quality: 'full',
    resources: { metal: 100_000, minerals: 100_000, gas: 0, developmentEnergy: 0 }, defense: { 'ion-plasma-battery': 40 }, fleet: {}, firstReport: true } as never;
  const force = { battleship: 2_000 };
  const profile = world.state.npc!.profiles[world.owner]!;
  const usual = estimateStrikeWorth(world.state, createNpcUtilityContext(world.state, profile, START, 1), rally, report, force, 0.75, 500_000, 2, false);
  assert.ok(usual.econ < 0, 'little to loot behind forty batteries');
  assert.equal(usual.allowed, false, 'a usual owner does not go into a loss');
  assert.equal(usual.conscious, null);
  // The loot rule: at most 75% of each resource, what the surviving holds lift.
  assert.ok(usual.haul <= 0.75 * 200_000);

  const risky = { ...world.state, npc: { ...world.state.npc!, profiles: { ...world.state.npc!.profiles, [world.owner]: { ...profile, traits: { ...profile.traits, riskTolerance: 0.9, aggression: 0.9 } } } } };
  const riskyProfile = risky.npc!.profiles[world.owner]!;
  const hot = estimateStrikeWorth(risky, createNpcUtilityContext(risky, riskyProfile, START, 1), rally, report, { battleship: 150 }, 0.75, 400_000, 2, false);
  assert.ok(hot.strategic > 0, 'battle points count');
  if (hot.econ < 0 && hot.econ + hot.strategic >= 0) {
    assert.equal(hot.allowed, true);
    assert.equal(hot.conscious, 'risk');
  }

  const rich = { ...(report as object), resources: { metal: 80_000_000, minerals: 80_000_000, gas: 80_000_000, developmentEnergy: 0 } } as never;
  const paying = estimateStrikeWorth(world.state, createNpcUtilityContext(world.state, profile, START, 1), rally, rich, { battleship: 2_000, 'mega-transporter': 9_000 }, 0.9, 500_000, 2, false);
  assert.ok(paying.econ > 0, `holds on a rich target pay (${paying.econ})`);
  assert.equal(paying.allowed, true);
});
