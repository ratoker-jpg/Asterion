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
import { draftNpcStrike, getNpcPlanChoices, journalNpcRevengeFunnel, npcRevengeRefusal, refreshNpcPlans } from './npc-plans.ts';
import { recordNpcGrievance } from '../domain/npc/grudges.ts';
import { chooseNpcRobberyReaction } from './npc-pacts.ts';
import { NPC_REVENGE_BALANCE, npcRevengeWinBar } from './npc-utility.ts';
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

const plansOf = (state: SaveState, owner: string): readonly NpcStrikePlan[] => (state.npcStrategy?.plans[owner] ?? []).filter((plan): plan is NpcStrikePlan => plan.template === 'strike');

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
    // This drive never calls a probe home: a probe that saw nothing is followed by a later one that does.
    const newest = (state.espionage?.reports ?? []).filter((report) => report.ownerId === world.owner && report.targetPlanetId === world.target).at(-1);
    if (newest && newest.fleet === undefined && newest.defense === undefined) state = withReport(state, world.owner, world.planets[0]!, getEspionageTargets(state.espionage)[world.target]!, at);
    const profile = state.npc!.profiles[world.owner]!;
    state = refreshNpcPlans(state, profile, createNpcUtilityContext(state, profile, at, 1), at, 1);
    const utility = createNpcUtilityContext(state, profile, at, 1);
    const choices = getNpcPlanChoices(state, profile, utility, at, 1, getNpcMissionCandidates(state, profile, at), (_id, estimate) => utilityToWeight(estimate));
    choices.forEach((choice, index) => {
      const outcome = choice.run(state, `plan-test:${look}:${index}`);
      if (outcome.started) steps.push(choice.candidate.id.split(':').slice(0, 2).join(':'));
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
  const plan = plansOf(result.state, world.owner).find((item) => item.status !== 'active')!;
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
  const share = plan.reserve[source]!.cruiser ?? 0;
  assert.ok(share > 0 && reserved.cruiser === share, 'the share is reserved');
  const free = withoutNpcPlanReserve(state, world.owner, source, { cruiser: 40, 'spy-probe': 5 });
  assert.equal(free.cruiser, 40 - share, 'other missions see only what the plan left free');
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

test('the outcome ledger only watches: a plan played with it equals the plan played without', () => {
  const world = sevenPlanetWorld('npc-plans-ledger-parity');
  const without = drive(world, 24 * 60);
  const recorder = new NpcJournalRecorder();
  const previous = setNpcJournalSink(recorder);
  let watched: ReturnType<typeof drive>;
  try {
    watched = drive(world, 24 * 60);
  } finally {
    setNpcJournalSink(previous);
  }
  assert.ok(recorder.take().some((entry) => entry.k === 'plan'), 'the ledger saw the plan close');
  assert.deepEqual(watched.steps, without.steps);
  assert.deepEqual(watched.state, without.state);
});

test('a force lost at the rally planet cancels the plan instead of sending what is left', () => {
  const world = sevenPlanetWorld('npc-plans-force-lost');
  let hit = false;
  const { state, steps } = drive(world, 24 * 60, (current) => {
    const plan = plansOf(current, world.owner)[0];
    if (hit || (plan?.phase !== 'recheck' && plan?.phase !== 'launch')) return current;
    hit = true;
    const rally = getEspionageTargets(current.espionage)[plan.rallyPlanetId]!;
    return { ...current, espionage: { ...current.espionage!, targets: { ...getEspionageTargets(current.espionage),
      [rally.id]: { ...rally, fleet: { ...rally.fleet, ships: { ...rally.fleet.ships, cruiser: 10 } } } } } };
  });
  const plan = plansOf(state, world.owner).find((item) => item.status !== 'active')!;
  assert.ok(hit, 'the plan reached its recheck');
  assert.equal(plan.status, 'cancelled');
  assert.equal(plan.reason, 'force-lost');
  assert.equal(steps.filter((step) => step === 'plan:launch').length, 0, 'no attack with the remains');
});

/** The same world with the owner holding a deep grudge against the neighbour, and the neighbour's stores empty so a strike cannot pay. */
function revengeWorld(seed: string, options: { empty?: boolean; defence?: number; grudge?: boolean } = {}): World {
  const world = sevenPlanetWorld(seed, options.defence ?? 10);
  let state = world.state;
  const victim = getEspionageTargets(state.espionage)[world.target]!;
  if (options.empty ?? true) {
    const bare = { ...victim, resources: { ...victim.resources, metal: 0, minerals: 0, gas: 0 } } as SpyTargetState;
    state = { ...state, espionage: { ...state.espionage!, targets: { ...getEspionageTargets(state.espionage), [victim.id]: bare },
      reports: state.espionage!.reports.map((report) => report.targetPlanetId === victim.id ? { ...report, resources: { ...report.resources, metal: 0, minerals: 0, gas: 0 } } : report) } };
  }
  if (options.grudge ?? true) {
    const profile = state.npc!.profiles[world.owner]!;
    const day = createNpcUtilityContext(state, profile, START, 1).dayValue;
    const angry = [1, 2, 3].reduce((acc, index) => recordNpcGrievance(acc, victim.ownerId, 5 * day, START - index * 60 * MINUTE, `revenge-test-${index}`), profile);
    state = { ...state, npc: { ...state.npc!, profiles: { ...state.npc!.profiles, [world.owner]: angry } } };
  }
  return { ...world, state };
}

const draftOf = (world: World, at = START + MINUTE) => {
  const profile = world.state.npc!.profiles[world.owner]!;
  return draftNpcStrike(world.state, profile, createNpcUtilityContext(world.state, profile, at, 1), at, 1);
};

test('revenge: the win belief an attack needs falls with the grudge on the offender only', () => {
  const base = 0.75;
  assert.equal(npcRevengeWinBar(base, 0), base, 'no grudge, no change for a plan margin');
  assert.equal(npcRevengeWinBar(0, 0, 0.5), 0.5, 'no grudge, even odds as ever');
  const full = npcRevengeWinBar(base, 1, 0.5);
  assert.ok(full >= 0.25 && full <= 0.3 + 1e-9, `a full grudge asks about 0.25 to 0.30, got ${full}`);
  assert.ok(npcRevengeWinBar(base, 0.5, 0.5) > full, 'it scales with the grudge');
  assert.ok(NPC_REVENGE_BALANCE.strikeMinGrudge > 0);
});

test('revenge: a strike that loses by its own estimate is allowed only against the offender', () => {
  const calm = revengeWorld('npc-revenge-calm', { grudge: false });
  assert.equal(draftOf(calm), null, 'against a stranger a losing strike is not planned (owner rule 04.11.2026)');
  const angry = revengeWorld('npc-revenge-calm', { grudge: true });
  const draft = draftOf(angry);
  assert.ok(draft, 'against the offender the revenge pays for what the strike costs');
  assert.ok(draft.plan.worth!.econ < 0, 'the strike loses resources by its own estimate');
  assert.equal(draft.plan.conscious, 'revenge');
  // A grudge against someone else does not open the door for this target.
  const other = angry.state.npc!.profiles[angry.owner]!;
  const elsewhere = { ...other, grudges: { 'someone-else': Object.values(other.grudges!)[0]! } };
  const moved = { ...angry, state: { ...angry.state, npc: { ...angry.state.npc!, profiles: { ...angry.state.npc!.profiles, [angry.owner]: elsewhere } } } };
  assert.equal(draftOf(moved), null);
});

test('revenge: the whole empire gathers at the own planet nearest the target and one fleet strikes', () => {
  const world = revengeWorld('npc-revenge-gather');
  const draft = draftOf(world);
  assert.ok(draft);
  const targets = getEspionageTargets(world.state.espionage);
  const target = targets[world.target]!;
  const spread = (planetId: string) => Math.abs(targets[planetId]!.coordinate.galaxy - target.coordinate.galaxy) * 1000 + Math.abs(targets[planetId]!.coordinate.system - target.coordinate.system) * 10
    + Math.abs(targets[planetId]!.coordinate.position - target.coordinate.position);
  const nearest = Math.min(...world.planets.map(spread));
  assert.equal(spread(draft.plan.rallyPlanetId), nearest, 'the staging planet is the closest own planet');
  const result = drive(world, 24 * 60);
  const plan = plansOf(result.state, world.owner).find((item) => item.status !== 'active')!;
  assert.equal(plan.status, 'done', `${plan.reason ?? ''}`);
  assert.equal(result.steps.filter((step) => step === 'plan:launch').length, 1, 'one fleet is launched');
  assert.equal(result.steps.filter((step) => step === 'plan:rally').length, 6, 'ships of all seven planets stand together first');
  const attacks = result.state.flights.records.filter((flight) => flight.ownerId === world.owner && flight.missionId === 'attack');
  assert.equal(attacks.length, 1);
  assert.equal(attacks[0]!.originPlanetId, plan.rallyPlanetId);
});

test('revenge: fear of an offender with a deep grudge looks for a partner instead of doing nothing', () => {
  const world = sevenPlanetWorld('npc-revenge-fear');
  const profile = world.state.npc!.profiles[world.owner]!;
  const timid = { ...profile, traits: { ...profile.traits, aggression: 0.3, riskTolerance: 0.5, planningHorizon: 0.5, economyFocus: 0.3, cooperation: 0.5, socialStyle: 0.5 } };
  // The choice has a seeded doubt (a profile's private seed is random per campaign): judge it over many seeds, not one.
  const seeds = Array.from({ length: 60 }, (_, index) => ({ ...timid, privateSeed: `revenge-fear-${index}` }));
  const kinds = (grudge: number) => seeds.map((seeded, index) => chooseNpcRobberyReaction(seeded, { grudge, fearOfOffender: 1, bestFriend: 0 }, START + index * 7 * 3_600_000));
  assert.ok(kinds(1).every((kind) => kind === 'seek-partner'), 'fear and grudge together always make the owner look for allies');
  assert.ok(kinds(0).filter((kind) => kind === 'seek-partner').length < 60, 'fear without a grudge gets no such push');
});

test('revenge: the journal says why the bot does not strike its offender', () => {
  const reason = (world: World, at = START + MINUTE) => {
    const profile = world.state.npc!.profiles[world.owner]!;
    return npcRevengeRefusal(world.state, profile, createNpcUtilityContext(world.state, profile, at, 1), getEspionageTargets(world.state.espionage)[world.target]!.ownerId, at);
  };
  assert.equal(reason(revengeWorld('npc-revenge-why')), 'ok', 'a strike is possible: nothing refuses it');
  const noReport = revengeWorld('npc-revenge-why');
  assert.equal(reason({ ...noReport, state: { ...noReport.state, espionage: { ...noReport.state.espionage!, reports: [] } } }), 'no-report');
  assert.equal(reason(revengeWorld('npc-revenge-why'), START + 5 * 60 * MINUTE), 'stale', 'old news: spy again');
  assert.equal(reason(revengeWorld('npc-revenge-why', { defence: 4000 })), 'power');
  const poor = revengeWorld('npc-revenge-why');
  const victimOwner = getEspionageTargets(poor.state.espionage)[poor.target]!.ownerId;
  assert.equal(reason({ ...poor, state: withAttackEligiblePoints(poor.state, [victimOwner], 90_000_000) }), 'points');
  const planned = drive(revengeWorld('npc-revenge-why'), 6);
  assert.equal(reason({ ...revengeWorld('npc-revenge-why'), state: planned.state }, START + 7 * 60 * MINUTE), 'gathering');
  // Written to the journal as `r`.
  const world = revengeWorld('npc-revenge-why');
  const recorder = new NpcJournalRecorder();
  const previous = setNpcJournalSink(recorder);
  try {
    const profile = world.state.npc!.profiles[world.owner]!;
    journalNpcRevengeFunnel(world.state, profile, createNpcUtilityContext(world.state, profile, START + MINUTE, 1), START + MINUTE);
  } finally {
    setNpcJournalSink(previous);
  }
  const line = recorder.take().find((entry) => entry.k === 'revenge');
  assert.ok(line, 'a revenge line is written');
  assert.equal(line.r, 'ok');
  assert.equal(line.d!.vs, getEspionageTargets(world.state.espionage)[world.target]!.ownerId);
});
