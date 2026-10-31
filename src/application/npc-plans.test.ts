// Strategic plan «strike» (NPC intelligence slice 1): an owner with seven
// planets sees a target no single planet beats, builds the missing ships on
// several planets, gathers every share at one rally planet by deployment,
// checks its news again and sends one attack — or cancels with a reason.
import assert from 'node:assert/strict';
import test from 'node:test';

import { createDefaultNewGameConfig } from '../domain/world/config.ts';
import { getEspionageTargets } from '../domain/espionage/runtime.ts';
import type { SpyReportSnapshot, SpyTargetState } from '../domain/espionage/types.ts';
import { createEmptyDefenseState, createDefaultFleetProductionState } from '../domain/fleet/production.ts';
import { createEmptyFleetState } from '../domain/fleet/runtime.ts';
import { utilityToWeight } from '../domain/npc/utility.ts';
import { isNpcStrategyState, migrateNpcStrategyState, type NpcStrikePlan } from '../domain/npc/strategy.ts';
import { createInitialSaveState, createPersistenceFacade } from './persistence.ts';
import { reconcileFlights } from './flights.ts';
import { settleNpcFleetProduction } from './npc-fleet-production.ts';
import { createNpcUtilityContext } from './npc-utility.ts';
import { getNpcMissionCandidates } from './npc-mission-policy.ts';
import { getNpcMissionAvailableFleet } from './npc-missions.ts';
import { draftNpcStrike, getNpcPlanChoices, refreshNpcPlans } from './npc-plans.ts';
import { npcPlanReservedShips, withoutNpcPlanReserve } from './npc-plan-reserve.ts';
import { NpcJournalRecorder, setNpcJournalSink } from './npc-journal.ts';
import type { SaveState } from './contracts.ts';
import { withAttackEligiblePoints } from './attack-eligibility.test-support.ts';

const START = Date.UTC(2026, 9, 27, 12);
const MINUTE = 60_000;
const SCIENCE = Object.fromEntries(Array.from({ length: 40 }, (_, index) => [index + 1, 15]));

type World = { state: SaveState; owner: string; planets: string[]; target: string };

function planetsOf(state: SaveState): SpyTargetState[] {
  return Object.values(getEspionageTargets(state.espionage)).filter((target) => target.kind === 'npc')
    .sort((left, right) => left.id.localeCompare(right.id));
}

/** One owner holding seven well-built planets with 40 cruisers each, and a neighbour behind ten batteries. */
function sevenPlanetWorld(seed: string, defence = 10): World {
  const base = createDefaultNewGameConfig({ seed, factionId: 'aegis', playerName: 'Plans' });
  let state = createInitialSaveState('production', START, { ...base, world: { ...base.world, npcCount: 9, campaignSpeed: 'standard' as const } });
  const all = planetsOf(state);
  const home = all[0]!;
  const owner = home.ownerId;
  const ownerProfile = { scienceLevels: SCIENCE, shipLevels: {}, commanderLevels: {} };
  const targets = { ...getEspionageTargets(state.espionage) };
  const planets = all.slice(0, 7).map((planet) => planet.id);
  for (const id of planets) {
    const fleet = createEmptyFleetState();
    targets[id] = {
      ...targets[id]!, ownerId: owner, ownerName: home.ownerName, raceId: 'aegis', ownerProfile: ownerProfile as SpyTargetState['ownerProfile'],
      resources: { ...targets[id]!.resources, metal: 30_000_000, minerals: 30_000_000, gas: 30_000_000 },
      buildings: { ...targets[id]!.buildings, shipyard: 20, hangar: 100, 'advanced-factory': 10, 'metal-storage': 30, 'mineral-storage': 30, 'gas-storage': 30 },
      fleet: { ...fleet, ships: { ...fleet.ships, cruiser: 40, 'spy-probe': 5 } },
      fleetProduction: createDefaultFleetProductionState(),
    } as SpyTargetState;
  }
  const victim = all[7]!;
  const defense = createEmptyDefenseState();
  targets[victim.id] = { ...victim, resources: { ...victim.resources, metal: 20_000_000, minerals: 20_000_000, gas: 20_000_000 },
    defense: { ...defense, defenses: { ...defense.defenses, 'ion-plasma-battery': defence } } } as SpyTargetState;
  state = withAttackEligiblePoints({ ...state, espionage: { ...state.espionage!, targets } }, [owner, victim.ownerId], 2_000_000);
  // The owner's own fresh full report of the neighbour: the only thing a plan may know.
  state = withReport(state, owner, planets[0]!, targets[victim.id]!, START);
  const profile = state.npc!.profiles[owner]!;
  state = { ...state, npc: { ...state.npc!, profiles: { ...state.npc!.profiles, [owner]: {
    ...profile, traits: { ...profile.traits, riskTolerance: 0.5, planningHorizon: 0.8, aggression: 0.7, militaryFocus: 0.8 },
  } } } };
  return { state, owner, planets, target: victim.id };
}

function withReport(state: SaveState, ownerId: string, sourcePlanetId: string, target: SpyTargetState, at: number): SaveState {
  const report: SpyReportSnapshot = {
    ownerId, id: `plan-test-report-${at}`, missionId: `plan-test-mission-${at}`, createdAt: at, sourcePlanetId,
    targetPlanetId: target.id, targetPlanetName: target.name, targetOwnerId: target.ownerId, targetOwnerName: target.ownerName,
    targetRaceId: target.raceId, targetRelation: 'neutral', targetCoordinate: { ...target.coordinate },
    spyLevel: 10, targetEspionageLevel: 0, delta: 10, roll: 0.5, quality: 'full',
    resources: { ...target.resources }, defense: { ...target.defense.defenses }, fleet: { ...target.fleet.ships }, firstReport: true,
  };
  return { ...state, espionage: { ...state.espionage!, reports: [...(state.espionage!.reports ?? []), report] } };
}

const plansOf = (state: SaveState, owner: string): readonly NpcStrikePlan[] => state.npcStrategy?.plans[owner] ?? [];

/** The owner's looks every five minutes: production and flights settle, plan steps run as they come. */
function drive(world: World, minutes: number, onLook?: (state: SaveState, at: number) => SaveState): { state: SaveState; steps: string[] } {
  let state = world.state;
  const steps: string[] = [];
  for (let at = START + MINUTE, look = 0; at <= START + minutes * MINUTE; at += 5 * MINUTE, look += 1) {
    const targets = { ...getEspionageTargets(state.espionage) };
    for (const id of world.planets) if (targets[id]?.ownerId === world.owner) targets[id] = settleNpcFleetProduction(targets[id]!, world.owner, at).target;
    state = { ...state, espionage: { ...state.espionage!, targets } };
    state = reconcileFlights(state, at, () => 0.5, { mode: 'production', testTimeScale: 1 }).state;
    if (onLook) state = onLook(state, at);
    const profile = state.npc!.profiles[world.owner]!;
    state = refreshNpcPlans(state, profile, createNpcUtilityContext(state, profile, at, 1), at, 1);
    const utility = createNpcUtilityContext(state, profile, at, 1);
    const choices = getNpcPlanChoices(state, profile, utility, at, 1, getNpcMissionCandidates(state, profile, at), (_id, estimate) => utilityToWeight(estimate));
    choices.forEach((choice, index) => {
      const outcome = choice.run(state, `plan-test:${look}:${index}`);
      if (outcome.started) steps.push(choice.candidate.id.split(":").slice(0, 2).join(":"));
      else if (process.env.PLAN_DEBUG) console.log("fail", look, choice.candidate.id, outcome.reason);
      state = outcome.state;
    });
    if (plansOf(state, world.owner).some((plan) => plan.status !== 'active')) break;
  }
  return { state, steps };
}

test('seven planets: orders on several planets, deployments to one rally planet, one attack', () => {
  const world = sevenPlanetWorld('npc-plans-seven');
  const profile = world.state.npc!.profiles[world.owner]!;
  const draft = draftNpcStrike(world.state, profile, createNpcUtilityContext(world.state, profile, START + MINUTE, 1), START + MINUTE, 1);
  assert.ok(draft, 'a strike is worth planning: no single planet wins, the empire with new ships does');
  assert.equal(Object.keys(draft.plan.reserve).length, 7, 'every planet contributes its share');
  assert.ok(new Set(draft.plan.orders.map((order) => order.planetId)).size >= 3, 'the missing ships are built on several planets at once');
  assert.ok(draft.plan.forecast.win > 0.5);

  const recorder = new NpcJournalRecorder();
  const previous = setNpcJournalSink(recorder);
  let result: ReturnType<typeof drive>;
  try {
    result = drive(world, 24 * 60);
  } finally {
    setNpcJournalSink(previous);
  }
  const plan = plansOf(result.state, world.owner)[0]!;
  if (process.env.PLAN_DEBUG) {
    console.log(JSON.stringify(plansOf(result.state, world.owner).map((item) => [item.status, item.reason, item.phase, item.forecast, item.result])));
    console.log(JSON.stringify({ orders: plan.orders, reserve: plan.reserve, steps: result.steps.slice(0, 30), deadline: plan.deadlineAt - START, ready: plan.forecast.readyAt - START }));
    for (const [id, counts] of Object.entries(plan.reserve)) {
      const planet = getEspionageTargets(result.state.espionage)[id]!;
      console.log(id, JSON.stringify(counts), JSON.stringify(Object.fromEntries(Object.entries(planet.fleet.ships).filter(([, c]) => c > 0))), JSON.stringify(planet.fleetProduction?.shipQueue.map((o) => [o.itemId, o.quantity, o.completedQuantity, o.finishAt - START])));
    }
  }
  assert.equal(plan.status, 'done', `the plan ends by its attack (${plan.status} ${plan.reason ?? ''}, phase ${plan.phase})`);
  assert.ok(result.steps.filter((step) => step === 'plan:produce').length >= 3, 'orders placed on several planets');
  assert.equal(result.steps.filter((step) => step === 'plan:rally').length, 6, 'six deployments gather the shares');
  assert.equal(result.steps.filter((step) => step === 'plan:launch').length, 1, 'one attack, with the whole force');
  const attack = result.state.flights.records.find((flight) => flight.id === plan.launchFlightId)!;
  assert.equal(attack.originPlanetId, plan.rallyPlanetId);
  assert.equal(attack.missionId, 'attack');
  assert.ok(plan.result, 'the battle closed the plan');
  const ledger = recorder.take().filter((entry) => entry.k === 'plan');
  assert.equal(ledger.length, 1, 'the closed plan is in the outcome ledger');
  assert.equal(ledger[0]!.d!.st, 'done');
  assert.equal(typeof ledger[0]!.d!.err, 'number', 'forecast against result');
  assert.equal(result.state.npcStrategy!.outcomes[world.owner]!.strike!.done, 1);
  assert.ok(isNpcStrategyState(result.state.npcStrategy));
});

test('the plan holds its ships: other missions do not take them, defence still sees them', () => {
  const world = sevenPlanetWorld('npc-plans-reserve');
  const { state } = drive(world, 6, undefined);
  const plan = plansOf(state, world.owner).find((item) => item.status === 'active');
  assert.ok(plan, 'a plan was taken in the first looks');
  const source = Object.keys(plan.reserve).find((id) => id !== plan.rallyPlanetId && !plan.sent.includes(id))!;
  const reserved = npcPlanReservedShips(state, world.owner, source);
  assert.ok((reserved.cruiser ?? 0) >= 40, 'the share is reserved');
  const free = withoutNpcPlanReserve(state, world.owner, source, { cruiser: 40, 'spy-probe': 5 });
  assert.equal(free.cruiser, 0, 'other missions see no free cruisers there');
  assert.equal(free['spy-probe'], 5, 'probes are not part of the force');
  // Defence and fleetsave read the real fleet: the reservation never hides ships from them.
  assert.equal(getNpcMissionAvailableFleet(state, world.owner, source)?.cruiser, 40);
});

test('stale news: the target is scouted again and a stronger target cancels the plan without a flight', () => {
  const world = sevenPlanetWorld('npc-plans-stronger');
  let reinforced = false;
  const { state, steps } = drive(world, 24 * 60, (current, at) => {
    const plan = plansOf(current, world.owner)[0];
    // The neighbour builds up while the owner gathers; the probe sent at the recheck sees it.
    if (!reinforced && plan?.phase === 'recheck') {
      reinforced = true;
      const victim = getEspionageTargets(current.espionage)[world.target]!;
      const stronger = { ...victim, defense: { ...victim.defense, defenses: { ...victim.defense.defenses, 'ion-plasma-battery': 60 } } };
      return withReport({ ...current, espionage: { ...current.espionage!, targets: { ...getEspionageTargets(current.espionage), [world.target]: stronger } } },
        world.owner, world.planets[0]!, stronger, at);
    }
    return current;
  });
  const plan = plansOf(state, world.owner)[0]!;
  assert.ok(reinforced, 'the plan reached its recheck');
  assert.equal(plan.status, 'cancelled');
  assert.equal(plan.reason, 'target-stronger');
  assert.equal(steps.filter((step) => step === 'plan:launch').length, 0, 'no attack against the stronger target');
  assert.equal(plan.launchFlightId, undefined);
});

test('an attack on the way home pauses gathering; the deadline then cancels the plan as threat-at-home', () => {
  const world = sevenPlanetWorld('npc-plans-paused');
  const first = drive(world, 6);
  const plan = plansOf(first.state, world.owner).find((item) => item.status === 'active')!;
  assert.ok(plan);
  // An enemy fleet on its way to one of the owner's planets for the rest of the day.
  const enemy = {
    ...first.state.flights.records[0], id: 'enemy-attack', ownerId: 'enemy-owner', ownerSide: 'npc' as const, missionId: 'attack' as const,
    phase: 'outbound' as const, destinationPlanetId: world.planets[1]!, arrivalAt: START + 48 * 60 * MINUTE, departedAt: START,
  };
  const waiting = drive({ ...world, state: { ...first.state, flights: { ...first.state.flights, records: [...first.state.flights.records, enemy as never] } } }, 47 * 60);
  const after = plansOf(waiting.state, world.owner).find((item) => item.planId === plan.planId)!;
  assert.equal(waiting.steps.filter((step) => step === 'plan:rally' || step === 'plan:launch').length, 0, 'no gathering while an attack comes');
  assert.equal(waiting.steps.filter((step) => step === 'plan:strike').length, 0, 'no new plan while under attack');
  assert.equal(after.status, 'cancelled');
  assert.equal(after.reason, 'threat-at-home');
  assert.ok(plansOf(waiting.state, world.owner).every((item) => !item.launchFlightId), 'nothing flew: no losses in a cancelled plan');
});

test('the strategy section survives a save and reload; older saves have none', () => {
  const world = sevenPlanetWorld('npc-plans-save');
  assert.equal(world.state.npcStrategy, undefined, 'a fresh campaign has no plans yet');
  const { state } = drive(world, 6);
  assert.ok(state.npcStrategy);
  const storage = new Map<string, string>();
  const persistence = createPersistenceFacade({ mode: 'production', saveKey: 'plans',
    storage: { getItem: (key) => storage.get(key) ?? null, setItem: (key, value) => { storage.set(key, value); }, removeItem: (key) => { storage.delete(key); } },
    now: () => START });
  assert.equal(persistence.write(state).ok, true);
  const loaded = persistence.load();
  assert.equal(loaded.status, 'loaded');
  if (loaded.status === 'loaded') assert.deepEqual(loaded.state.npcStrategy, state.npcStrategy);
  assert.equal(migrateNpcStrategyState({ version: 2 }), undefined, 'an unknown section is dropped, not half-trusted');
});
