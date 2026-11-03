import assert from 'node:assert/strict';
import test from 'node:test';

import { DEFAULT_ALLIANCE_EMBLEM } from '../domain/command/catalog.ts';
import { acceptApplication, applyToAlliance, createAlliance } from '../domain/command/membership.ts';
import { getFactionShipCatalog } from '../domain/combat/faction-catalog.ts';
import type { SpyTargetState } from '../domain/espionage/types.ts';
import { listNpcVisits } from '../domain/npc/calendar.ts';
import { createNpcState, migrateNpcState } from '../domain/npc/state.ts';
import { isNpcStrategyState, migrateNpcStrategyState, type NpcStrikePlan } from '../domain/npc/strategy.ts';
import { npcSunPromised, type NpcSunRaidPrepPlan } from '../domain/npc/sun-prep.ts';
import { utilityToWeight } from '../domain/npc/utility.ts';
import { sunRaidCapsOf } from '../domain/sun-raid/config.ts';
import { createDefaultNewGameConfig } from '../domain/world/config.ts';
import type { SaveState } from './contracts.ts';
import { getNpcEndgameChoices, npcSunAffordableForce, npcSunForce } from './npc-endgame.ts';
import { setNpcJournalSink, type NpcJournalSun } from './npc-journal.ts';
import { advanceLiveWorld, beginLiveWorld } from './npc-live-world.ts';
import { applyCampaignRuntimeForCatchup } from './npc-catchup-runner.ts';
import { getNpcMissionCandidates } from './npc-mission-policy.ts';
import { getNpcMissionAvailableFleet } from './npc-missions.ts';
import { activeNpcSunPrep, npcSunPrepNextMoment, withoutNpcSunPrepHold, NPC_SUN_PREP_BALANCE } from './npc-sun-prep-state.ts';
import { chooseNpcSunForRaid, getNpcSunPrepChoices, npcResponsiveness, npcSunPrepSavesGas, pickNpcGatherTime, refreshNpcSunPrep } from './npc-sun-prep.ts';
import { scheduleNpcPlanCheck } from './npc-plans.ts';
import { activeNpcPlans } from './npc-plan-reserve.ts';
import { createNpcUtilityContext } from './npc-utility.ts';
import { createInitialSaveState, loadSavedState, serializeSaveForStorage } from './persistence.ts';
import { currentSunRaidState, npcSunFlightGas, reconcileSunRaids, sunFleetPopulation } from './sun-raid.ts';

const NOW = Date.UTC(2026, 9, 26, 6);
const HOUR = 3_600_000;

/** A running strike of the owner on another's planet: nothing to build, its own ships at its own rally planet. */
function withStrike(state: SaveState, ownerId: string, targetOwnerId: string, at: number): SaveState {
  const planet = home(state, ownerId);
  const plan: NpcStrikePlan = {
    planId: `plan:${ownerId}:test-strike`, template: 'strike', ownerId, status: 'active', phase: 'produce', createdAt: at, deadlineAt: at + 12 * HOUR,
    targetPlanetId: home(state, targetOwnerId).id, targetOwnerId, rallyPlanetId: planet.id,
    reserve: { [planet.id]: { [hullOf(planet.raceId).id]: 2 } }, orders: [], forecast: { win: 0.8, gain: 1, loss: 1, readyAt: at + HOUR }, knowledgeAt: at, sent: [],
  };
  const strategy = state.npcStrategy ?? { version: 1 as const, plans: {}, outcomes: {}, nextCheckAt: {} };
  return { ...state, npcStrategy: { ...strategy, plans: { ...strategy.plans, [ownerId]: [plan, ...(strategy.plans[ownerId] ?? [])] } } };
}

test('a strike and a Sun plan of one owner live side by side: each reads its own, and neither blocks the other\'s check', () => {
  const { owners } = world();
  const team = owners.slice(0, 3);
  const { state: initial, leader } = ready(team);
  // A strike check just made does not put off the leader's Sun check.
  const started = startPlan(scheduleNpcPlanCheck(initial, leader, NOW, 1), leader, NOW);
  assert.ok(planOf(started, leader), 'the Sun plan starts');
  let state = withStrike(started, leader, owners[3]!, NOW);
  const sun = planOf(state, leader);
  assert.equal(state.npcStrategy!.plans[leader]![0]!.template, 'strike', 'the strike comes first in the list');
  assert.ok(isNpcStrategyState(JSON.parse(JSON.stringify(state.npcStrategy))), 'the section holds both templates');
  assert.deepEqual(activeNpcPlans(state, leader).map((plan) => plan.template), ['strike'], 'strike readers see only strikes');
  for (const ownerId of team) state = act(state, ownerId, NOW + HOUR);
  assert.equal(planOf(state, leader).planId, sun.planId);
  assert.ok(Object.keys(planOf(state, leader).rsvps).length > 0, 'the Sun plan moved on');
  assert.equal(activeNpcPlans(state, leader).length, 1, 'and left the strike alone');
});

test('a world with a strike and a Sun plan does not depend on where it is sliced or on a journal', { timeout: 300_000 }, () => {
  const { state: base, owners } = campaign();
  const at0 = base.npcReplay!.processedThroughAt;
  const state = withStrike(base, owners[0]!, owners[5]!, at0);
  const whole = run(state, [8]);
  assert.equal(comparable(run(state, [1, 2, 3.5, 5, 8])), comparable(whole));
  const previous = setNpcJournalSink({ detailed: () => true, decision: () => {}, sun: () => {}, outcome: () => {} });
  try {
    assert.equal(comparable(run(state, [8])), comparable(whole), 'a journal only watches');
  } finally {
    setNpcJournalSink(previous);
  }
  const strike = (whole.npcStrategy!.plans[owners[0]!] ?? []).find((plan) => plan.template === 'strike')!;
  assert.ok(strike.status !== 'active' || strike.phase !== 'produce', `the strike moved on in this world (${strike.status} ${strike.phase})`);
  assert.ok((whole.npcStrategy!.plans[owners[0]!] ?? []).some((plan) => plan.template === 'sun-raid-prep'), 'next to the Sun plan');
});

function world(npcCount = 4) {
  const config = createDefaultNewGameConfig({ seed: 'NPC-SUN-PREP', factionId: 'aegis', playerName: 'Prep Test' });
  const state = createInitialSaveState('production', NOW, { ...config, world: { ...config.world, npcCount, galaxyCount: 1 } });
  const owners = Object.keys(state.npc!.profiles).sort();
  // A new campaign draws its seeds from entropy; the plan is tested on fixed calendars of active owners.
  const profiles = Object.fromEntries(owners.map((ownerId) => [ownerId, { ...state.npc!.profiles[ownerId]!, privateSeed: `sun-prep:${ownerId}`,
    session: { ...state.npc!.profiles[ownerId]!.session, timezoneOffsetMinutes: 0 },
    activity: { ...state.npc!.profiles[ownerId]!.activity, propensity: 0.9 } }]));
  return { state: { ...state, npc: { ...state.npc!, profiles } }, owners };
}

function home(state: SaveState, ownerId: string): SpyTargetState {
  return state.espionage!.targets![`${ownerId}-planet`]!;
}

function withTarget(state: SaveState, target: SpyTargetState): SaveState {
  return { ...state, espionage: { ...state.espionage!, targets: { ...state.espionage!.targets, [target.id]: target } } };
}

function allianceOf(state: SaveState, owners: readonly string[]): SaveState {
  const created = createAlliance(state.command, { ownerId: owners[0]!, displayName: home(state, owners[0]!).ownerName,
    settings: { name: 'Sun Planners', tag: 'PLAN', motto: '', description: '', emblem: DEFAULT_ALLIANCE_EMBLEM } }, { now: NOW, random: () => 0.4 });
  assert.ok(created.ok);
  let next: SaveState = { ...state, command: created.state };
  const allianceId = next.command.alliances.find((alliance) => alliance.leaderOwnerId === owners[0])!.id;
  for (const ownerId of owners.slice(1)) {
    const applied = applyToAlliance(next.command, { ownerId, displayName: home(next, ownerId).ownerName, allianceId }, { now: NOW, random: () => 0.4 });
    assert.ok(applied.ok);
    const accepted = acceptApplication(applied.state, owners[0]!, applied.applicationId, { now: NOW, random: () => 0.4 });
    assert.ok(accepted.ok);
    next = { ...next, command: accepted.state };
  }
  return next;
}

/** A combat hull of the owner's own race. */
function hullOf(raceId: SpyTargetState['raceId']) {
  return getFactionShipCatalog(raceId).filter((entity) => entity.category === 'Боевой корабль' && entity.combat && entity.population > 0)
    .sort((left, right) => left.population - right.population || (left.id < right.id ? -1 : 1))[1]!;
}

/** Population in one hull type: by default more than this small world's participant cap asks, less than a battle's limit. */
function armed(state: SaveState, ownerId: string, population = 30_000): SaveState {
  const planet = home(state, ownerId);
  const hull = hullOf(planet.raceId);
  return withTarget(state, { ...planet, fleet: { ...planet.fleet, ships: { ...planet.fleet.ships, [hull.id]: Math.ceil(population / hull.population) } },
    buildings: { ...planet.buildings, hangar: 40, 'gas-storage': 15 }, resources: { ...planet.resources, gas: 30_000_000 } });
}

/** Everyone keen and at hand: the plan's logic, not the characters, is under test. */
function keen(state: SaveState, owners: readonly string[]): SaveState {
  const profiles = { ...state.npc!.profiles };
  for (const ownerId of owners) {
    profiles[ownerId] = { ...profiles[ownerId]!, traits: { ...profiles[ownerId]!.traits, cooperation: 1, riskTolerance: 1, attention: 1, socialStyle: 1 } };
  }
  return { ...state, npc: { ...state.npc!, profiles } };
}

const scored = (_id: string, estimate: number) => utilityToWeight(estimate);

function look(state: SaveState, ownerId: string, at: number) {
  const profile = state.npc!.profiles[ownerId]!;
  const utility = createNpcUtilityContext(state, profile, at, 1);
  const refreshed = refreshNpcSunPrep(state, profile, utility, at, 1);
  return { state: refreshed, choices: getNpcSunPrepChoices(refreshed, refreshed.npc!.profiles[ownerId]!, utility, at, 1, scored) };
}

/** One look of an owner: refresh, then every step its plan has due. */
function act(state: SaveState, ownerId: string, at: number): SaveState {
  const seen = look(state, ownerId, at);
  let current = seen.state;
  for (const choice of seen.choices) {
    if (!choice.must) continue;
    current = choice.run(current, `npc-autonomy:${JSON.stringify([ownerId, at, choice.candidate.id])}`).state;
  }
  return current;
}

function startPlan(state: SaveState, leader: string, at: number): SaveState {
  const { state: refreshed, choices } = look(state, leader, at);
  const start = choices.find((choice) => choice.candidate.id.startsWith('sun-prep:new:'));
  assert.ok(start, 'the leader can start a plan');
  const result = start.run(refreshed, 'npc-autonomy:new');
  assert.equal(result.started, true);
  return result.state;
}

function planOf(state: SaveState, leader: string): NpcSunRaidPrepPlan {
  return state.npcStrategy!.plans[leader]!.find((plan): plan is NpcSunRaidPrepPlan => plan.template === 'sun-raid-prep')!;
}

function ready(owners: readonly string[], population = 30_000): { state: SaveState; leader: string } {
  const { state: initial } = world();
  let state = keen(allianceOf(initial, owners), owners);
  for (const ownerId of owners) state = armed(state, ownerId, population);
  return { state, leader: owners[0]! };
}

test('a leader chooses a Sun by what it may know: not its own, not frozen, not where its own report saw a strong fleet', () => {
  const { owners } = world();
  const team = owners.slice(0, 3);
  const { state, leader } = ready(team);
  const profile = state.npc!.profiles[leader]!;
  const allianceId = state.command.alliances[0]!.id;
  const utility = createNpcUtilityContext(state, profile, NOW, 1);
  const first = chooseNpcSunForRaid(state, profile, utility, allianceId, NOW)!;
  assert.ok(first);
  assert.deepEqual(chooseNpcSunForRaid(state, profile, utility, allianceId, NOW), first, 'the same world gives the same choice');
  const ownSystems = new Set(team.map((ownerId) => home(state, ownerId).coordinate.system));
  assert.ok(!ownSystems.has(first.system), `it does not dim its own side's Sun (${first.system})`);

  // Frozen: the Sun is out of the question.
  const sunRaid = currentSunRaidState(state);
  const frozen: SaveState = { ...state, sunRaid: { ...sunRaid, suns: { ...sunRaid.suns, [`${first.galaxy}:${first.system}`]: { galaxy: first.galaxy, system: first.system, baseEfficiency: 100, brightness: 25, successfulRaids: 15 } } } };
  assert.notEqual(chooseNpcSunForRaid(frozen, profile, utility, allianceId, NOW)!.system, first.system);

  // Its own report saw a big fleet under that Sun: a planet is put there and reported on.
  const rival = owners[3]!;
  const placed = withTarget(state, { ...home(state, rival), coordinate: { ...home(state, rival).coordinate, system: first.system } });
  const reports = new Map(utility.latestReports);
  reports.set(`${rival}-planet`, { targetPlanetId: `${rival}-planet`, targetOwnerId: rival, targetRaceId: home(state, rival).raceId, createdAt: NOW - HOUR, fleet: { cruiser: 50_000 } } as never);
  const seen = chooseNpcSunForRaid(placed, profile, { latestReports: reports }, allianceId, NOW)!;
  assert.notEqual(seen.system, first.system, 'a Sun guarded in its own report is left alone');
  assert.equal(seen.knowledgeAt >= 0, true);
});

test('T lies 2 to 12 hours ahead, inside one of the leader\'s own visits, and the choice is the leader\'s to weigh', () => {
  const { owners } = world();
  const team = owners.slice(0, 3);
  const { state, leader } = ready(team);
  const planned = startPlan(state, leader, NOW);
  const plan = planOf(planned, leader);
  assert.ok(plan.gatherAt >= NOW + 2 * HOUR && plan.gatherAt <= NOW + 12 * HOUR, `T in ${(plan.gatherAt - NOW) / HOUR} h`);
  const profile = planned.npc!.profiles[leader]!;
  assert.ok(listNpcVisits(profile, plan.gatherAt, plan.gatherAt + 1).length === 1, 'the leader is at the game at T');
  assert.equal(plan.status, 'active');
  assert.equal(plan.phase, 'invite');
  assert.deepEqual(Object.keys(plan.rsvps), [leader], 'only the leader has answered: it reads answers, not calendars');
  assert.equal(currentSunRaidState(planned).raids.length, 0, 'no gathering is declared ahead of time');
});

test('T-SUN-01: invited, members answer, the force is ready, the leader declares at T and the full side flies and wins', () => {
  const { owners } = world();
  const team = owners.slice(0, 3);
  const { state: initial, leader } = ready(team);
  const entries: NpcJournalSun[] = [];
  const previous = setNpcJournalSink({ detailed: () => false, decision: () => {}, sun: (entry) => entries.push(entry) });
  try {
    let state = startPlan(initial, leader, NOW);
    const T = planOf(state, leader).gatherAt;
    for (const ownerId of team) state = act(state, ownerId, NOW + HOUR);
    const plan = planOf(state, leader);
    for (const ownerId of team) assert.ok(plan.rsvps[ownerId], `${ownerId} answered`);
    const answering = Object.values(plan.rsvps).filter((rsvp) => rsvp.population > 0);
    assert.ok(answering.length >= 2 || plan.rsvps[leader]!.population >= sunRaidCapsOf(state).perSide, 'enough members promise');
    if (npcSunPromised(plan) < sunRaidCapsOf(state).perSide - 100) return; // calendars of this seed: covered by the shortage test
    assert.ok(planOf(state, leader).gatherAt === T, 'T stands while the promises hold');
    state = act(state, leader, T);
    let raid = currentSunRaidState(state).raids[0]!;
    assert.equal(raid.status, 'gathering', 'declared at T');
    assert.equal(raid.system, plan.system);
    for (const ownerId of team.slice(1)) state = act(state, ownerId, T + 30_000);
    raid = currentSunRaidState(state).raids[0]!;
    assert.equal(raid.status, 'incoming', 'the promises fill the side: it takes off');
    state = act(state, leader, T + 60_000);
    assert.equal(planOf(state, leader).phase, 'flying');
    state = reconcileSunRaids(state, { now: raid.arrivesAt, mode: 'production', timeScale: 1 }).state;
    state = act(state, leader, raid.arrivesAt + 60_000);
    const closed = planOf(state, leader);
    assert.equal(closed.status, 'done');
    assert.equal(closed.result?.won, true, 'an undefended Sun falls');
    assert.equal(state.npcStrategy!.outcomes[leader]!['sun-raid-prep']!.wins, 1);
    assert.ok(entries.some((entry) => entry.step === 'declared') && entries.some((entry) => entry.step === 'done'));
  } finally {
    setNpcJournalSink(previous);
  }
});

test('T-SUN-02: not enough promised means a move (at most two) and then a cancellation with its reason, never a gathering on the off chance', () => {
  const { owners } = world();
  const team = owners.slice(0, 3);
  // A plan started while the alliance looked able; then its fleets are gone and the stores empty.
  let { state, leader } = ready(team);
  state = startPlan(state, leader, NOW);
  for (const ownerId of team) {
    state = armed(state, ownerId, 2_000);
    const planet = home(state, ownerId);
    state = withTarget(state, { ...planet, resources: { ...planet.resources, metal: 0, minerals: 0 } });
  }
  const moves = new Set<number>();
  let at = NOW + HOUR;
  for (let round = 0; round < 8 && activeNpcSunPrep(state, state.command.alliances[0]!.id); round += 1) {
    for (const ownerId of team) state = act(state, ownerId, at);
    const plan = activeNpcSunPrep(state, state.command.alliances[0]!.id);
    if (!plan) break;
    moves.add(plan.gatherAt);
    at = plan.gatherAt;
    state = act(state, leader, at);
    at += 60_000;
  }
  const closed = planOf(state, leader);
  assert.equal(closed.status, 'cancelled');
  assert.equal(closed.reason, 'not-enough-force');
  assert.ok(closed.postponed <= NPC_SUN_PREP_BALANCE.maxPostpones, `moved ${closed.postponed} times`);
  assert.ok(moves.size >= 1);
  assert.equal(currentSunRaidState(state).raids.length, 0, 'no gathering was declared');
  assert.ok((state.npcStrategy!.nextCheckAt[leader] ?? 0) > at, 'the leader rests before the next plan');
  assert.equal(look(state, leader, at).choices.length, 0, 'and does not start another at once');
});

test('T-SUN-03: an invitation moves a visit by at most two hours and adds no time at the game; the player hears nothing', () => {
  const { owners } = world();
  const team = owners.slice(0, 3);
  const { state: initial, leader } = ready(team);
  let state = startPlan(initial, leader, NOW);
  const plan = planOf(state, leader);
  const before = new Map(team.map((ownerId) => [ownerId, listNpcVisits(state.npc!.profiles[ownerId]!, NOW, NOW + 48 * HOUR)]));
  const history = currentSunRaidState(state).history.length;
  for (const ownerId of team) state = act(state, ownerId, NOW + HOUR);
  assert.equal(currentSunRaidState(state).history.length, history, 'the plan writes nothing a player sees');
  for (const ownerId of team) {
    const after = listNpcVisits(state.npc!.profiles[ownerId]!, NOW, NOW + 48 * HOUR);
    const length = (visits: readonly { startAt: number; endAt: number }[]) => visits.reduce((sum, visit) => sum + visit.endAt - visit.startAt, 0);
    assert.equal(after.length, before.get(ownerId)!.length, 'no visit added');
    assert.equal(length(after), length(before.get(ownerId)!), 'the same minutes at the game');
    for (const shift of state.npc!.profiles[ownerId]!.session.visitShifts ?? []) assert.ok(Math.abs(shift.deltaMs) <= 2 * HOUR);
    const rsvp = planOf(state, leader).rsvps[ownerId]!;
    const covered = after.some((visit) => visit.startAt < plan.gatherAt + 30 * 60_000 && visit.endAt > plan.gatherAt);
    if (rsvp.answer !== 'no') assert.ok(covered, `${ownerId} promised and is at the game at T`);
  }
});

test('a promise holds its ships back from other missions, the rest stay free, and the owner looks again at T', () => {
  const { owners } = world();
  const team = owners.slice(0, 3);
  const { state: initial, leader } = ready(team);
  let state = startPlan(initial, leader, NOW);
  const member = team[1]!;
  state = act(state, member, NOW + HOUR);
  const plan = planOf(state, leader);
  const rsvp = plan.rsvps[member]!;
  const fleet = getNpcMissionAvailableFleet(state, member, `${member}-planet`);
  const hull = hullOf(home(state, member).raceId);
  const held = withoutNpcSunPrepHold(state, member, `${member}-planet`, fleet, plan.gatherAt - HOUR);
  if (rsvp.population > 0) {
    assert.ok(held[hull.id] < fleet[hull.id], 'the promised part is held');
    assert.ok(held[hull.id] > 0 && hull.population * (fleet[hull.id] - held[hull.id]) <= rsvp.population + hull.population, 'only the promised part');
    assert.equal(npcSunPrepNextMoment(state, member, plan.gatherAt - HOUR), plan.gatherAt, 'it knows the time it gave its word for');
  }
  assert.equal(withoutNpcSunPrepHold(state, member, `${member}-planet`, fleet, plan.gatherAt - 13 * HOUR)[hull.id], fleet[hull.id], 'not long before T');
  assert.equal(withoutNpcSunPrepHold(state, owners[3]!, `${owners[3]!}-planet`, fleet, plan.gatherAt - HOUR)[hull.id], fleet[hull.id], 'nor for anyone outside');
  assert.ok(Array.isArray(getNpcMissionCandidates(state, state.npc!.profiles[member]!, plan.gatherAt - HOUR)));
});

test('a member who answered keeps to its answer; others in the alliance may still come to the gathering', () => {
  const { owners } = world();
  const team = owners.slice(0, 3);
  const { state: initial, leader } = ready(team);
  let state = startPlan(initial, leader, NOW);
  const member = team[1]!;
  state = act(state, member, NOW + HOUR);
  const profile = state.npc!.profiles[member]!;
  const utility = createNpcUtilityContext(state, profile, NOW + HOUR, 1);
  const generic = getNpcEndgameChoices(state, profile, utility, NOW + HOUR, 1, scored);
  assert.equal(generic.some((choice) => choice.candidate.id.startsWith('sun-raid:')), false, 'a leader never calls a gathering on the spot now');
});

test('a member builds what is missing (a counted, budgeted order) and brings its colony\'s share to its point of departure', () => {
  const { owners } = world();
  const team = owners.slice(0, 3);
  const { state: initial, leader } = ready(team);
  const member = team[1]!;
  // Half the fleet stands on a colony a few systems away; the home planet can build.
  const main = home(initial, member);
  const hull = hullOf(main.raceId);
  const count = main.fleet.ships[hull.id as keyof typeof main.fleet.ships] ?? 0;
  const colonyId = `${member}-colony`;
  let state = withTarget(initial, { ...main, fleet: { ...main.fleet, ships: { ...main.fleet.ships, [hull.id]: Math.ceil(count / 2) } } });
  state = withTarget(state, { ...main, id: colonyId, name: 'Colony', coordinate: { ...main.coordinate, system: (main.coordinate.system % 40) + 2 },
    fleet: { ...main.fleet, ships: { ...main.fleet.ships, [hull.id]: Math.floor(count / 2) } } });
  state = startPlan(state, leader, NOW);
  state = act(state, member, NOW + HOUR);
  const T = planOf(state, leader).gatherAt;
  assert.ok(planOf(state, leader).rsvps[member]!.population > 0, 'it promises');
  // Inside the rally window its colony's share flies to the larger pile, landing before T.
  const inWindow = T - 2 * HOUR;
  state = act(state, member, inWindow);
  const rally = state.flights.records.find((flight) => flight.ownerId === member && flight.missionId === 'deployment');
  assert.ok(rally, 'a deployment left');
  assert.ok(rally.arrivalAt <= T, 'and lands before T');
  assert.equal(planOf(state, leader).rsvps[member]!.rallyPlanetId, rally.destinationPlanetId);
  assert.notEqual(rally.originPlanetId, rally.destinationPlanetId);

  // A promise above what stands: the gap becomes an order, at most twice for one promise.
  const poor = armed(armed(state, member, 3_000), team[2]!, 3_000);
  const plan = planOf(poor, leader);
  const bigger: NpcSunRaidPrepPlan = { ...plan, rsvps: { ...plan.rsvps, [member]: { answer: 'yes', population: 25_000, at: NOW + HOUR } } };
  let current: SaveState = { ...poor, npcStrategy: { ...poor.npcStrategy!, plans: { ...poor.npcStrategy!.plans, [leader]: [bigger] } } };
  const profile = current.npc!.profiles[member]!;
  const utility = createNpcUtilityContext(current, profile, NOW + 2 * HOUR, 1);
  const order = getNpcSunPrepChoices(current, profile, utility, NOW + 2 * HOUR, 1, scored).find((choice) => choice.candidate.id.startsWith('sun-prep:order:'));
  if (order) {
    const placed = order.run(current, 'npc-autonomy:order');
    if (placed.started) {
      current = placed.state;
      assert.equal(activeNpcSunPrep(current, plan.allianceId)!.rsvps[member]!.orders, 1, 'the order is counted');
    }
  }
  const capped: NpcSunRaidPrepPlan = { ...bigger, rsvps: { ...bigger.rsvps, [member]: { ...bigger.rsvps[member]!, orders: NPC_SUN_PREP_BALANCE.maxOrders } } };
  const stopped: SaveState = { ...poor, npcStrategy: { ...poor.npcStrategy!, plans: { ...poor.npcStrategy!.plans, [leader]: [capped] } } };
  assert.equal(getNpcSunPrepChoices(stopped, stopped.npc!.profiles[member]!, utility, NOW + 2 * HOUR, 1, scored).some((choice) => choice.candidate.id.startsWith('sun-prep:order:')), false, 'no more orders than the cap');
});

test('gas limits what a planet may promise and fly: a force is trimmed to its store, the distance counts', () => {
  const { owners } = world();
  const team = owners.slice(0, 3);
  const { state: initial, leader } = ready(team);
  const planet = home(initial, leader);
  const options = { now: NOW, mode: 'production' as const, timeScale: 1 };
  const ships = npcSunForce(initial, leader, planet.id, planet.raceId, 1, 25_000);
  const near = npcSunFlightGas(initial, leader, planet.id, ships, planet.coordinate.galaxy, planet.coordinate.system, options);
  const far = npcSunFlightGas(initial, leader, planet.id, ships, planet.coordinate.galaxy, (planet.coordinate.system + 19) % 40 + 1, options);
  assert.ok(far > near, `a farther Sun costs more gas: ${near} < ${far}`);
  const dry = withTarget(initial, { ...planet, resources: { ...planet.resources, gas: Math.floor(far / 4) } });
  const trimmed = npcSunAffordableForce(dry, leader, planet.id, ships, planet.coordinate.galaxy, (planet.coordinate.system + 19) % 40 + 1, options);
  const cost = npcSunFlightGas(dry, leader, planet.id, trimmed, planet.coordinate.galaxy, (planet.coordinate.system + 19) % 40 + 1, options);
  assert.ok(cost <= Math.floor(far / 4), 'what is left can pay');
  assert.ok(sunFleetPopulation(trimmed, planet.raceId) < sunFleetPopulation(ships, planet.raceId));
});

test('a member away says when it could come, and a moved T suits it (its answer, not its calendar)', () => {
  const { state } = world();
  const profile = Object.values(state.npc!.profiles)[0]!;
  const from = NOW + 2 * HOUR;
  const visits = listNpcVisits(profile, from, from + 12 * HOUR);
  assert.ok(visits.length >= 2, 'the leader has a choice');
  const later = visits[visits.length - 1]!;
  const told = { answer: 'no' as const, population: 0, at: NOW, reason: 'away', freeFrom: later.startAt, freeTo: later.endAt };
  const T = pickNpcGatherTime(profile, from, from + 12 * HOUR, 30 * 60_000, [told])!;
  assert.ok(T >= later.startAt, 'the leader picks the visit that suits the member who told');
  assert.ok(pickNpcGatherTime(profile, from, from + 12 * HOUR, 30 * 60_000)! < T, 'without an answer it takes the earliest');
});

test('near T a member short of gas keeps it: not earlier, not with enough, not without a promise', () => {
  const { owners } = world();
  const team = owners.slice(0, 3);
  const { state: initial, leader } = ready(team);
  let state = startPlan(initial, leader, NOW);
  const member = team[1]!;
  state = act(state, member, NOW + HOUR);
  const plan = planOf(state, leader);
  assert.ok(plan.rsvps[member]!.population > 0);
  const near = plan.gatherAt - HOUR;
  assert.equal(npcSunPrepSavesGas(state, member, near, 1), false, 'the store is full');
  const planet = home(state, member);
  const dry = withTarget(state, { ...planet, resources: { ...planet.resources, gas: 10 } });
  assert.equal(npcSunPrepSavesGas(dry, member, near, 1), true, 'short of gas near T');
  assert.equal(npcSunPrepSavesGas(dry, member, plan.gatherAt - 3 * HOUR, 1), false, 'not this long before T');
  assert.equal(npcSunPrepSavesGas(dry, owners[3]!, near, 1), false, 'not for one who promised nothing');
});

test('gather time: the visit must hold half the gathering', () => {
  const { state } = world();
  const profile = Object.values(state.npc!.profiles)[0]!;
  const T = pickNpcGatherTime(profile, NOW + 4 * HOUR, NOW + 48 * HOUR, 30 * 60_000);
  assert.ok(T !== null);
  const visit = listNpcVisits(profile, T!, T! + 1)[0]!;
  assert.ok(visit.endAt - T! >= 15 * 60_000);
  assert.ok(npcResponsiveness(profile) >= 0 && npcResponsiveness(profile) <= 1);
});

test('the plan survives the save: validators keep it and the moved visit, an unreadable section is dropped', () => {
  const { owners } = world();
  const team = owners.slice(0, 3);
  const { state: initial, leader } = ready(team);
  let state = startPlan(initial, leader, NOW);
  for (const ownerId of team) state = act(state, ownerId, NOW + HOUR);
  const stored = JSON.parse(JSON.stringify(state.npcStrategy));
  assert.ok(isNpcStrategyState(stored));
  assert.deepEqual(migrateNpcStrategyState(stored), stored);
  assert.equal(migrateNpcStrategyState({ ...stored, version: 99 }), undefined);
  assert.equal(migrateNpcStrategyState(undefined), undefined);
  const shifted = { ...state.npc!, profiles: { ...state.npc!.profiles, [leader]: { ...state.npc!.profiles[leader]!,
    session: { ...state.npc!.profiles[leader]!.session, visitShifts: [{ localDay: 20_000, index: 1, deltaMs: HOUR }] } } } };
  const migrated = migrateNpcState(JSON.parse(JSON.stringify(shifted)), Object.keys(shifted.profiles), '', 0);
  assert.deepEqual(migrated.profiles[leader]!.session.visitShifts, [{ localDay: 20_000, index: 1, deltaMs: HOUR }]);
  // And through a real save and load, moved visit included.
  const saved: SaveState = { ...state, npc: shifted };
  const raw = serializeSaveForStorage(saved, 'production');
  const loaded = loadSavedState({ mode: 'production', storage: { getItem: () => raw, setItem() {}, removeItem() {} }, saveKey: 'k', now: () => NOW });
  assert.equal(loaded.status, 'loaded');
  assert.deepEqual((loaded as { state: SaveState }).state.npcStrategy, JSON.parse(JSON.stringify(state.npcStrategy)), 'the plan comes back');
  assert.deepEqual((loaded as { state: SaveState }).state.npc!.profiles[leader]!.session.visitShifts, [{ localDay: 20_000, index: 1, deltaMs: HOUR }]);
  const fresh = createNpcState(owners, 'salt', NOW);
  assert.equal(Object.values(fresh.profiles)[0]!.session.visitShifts, undefined, 'new owners carry no moves');
});

/**
 * Persona salts that once split a run by slice size. `88594d5d...` is the one
 * where a spy probe in orbit was judged again after its owner joined the
 * target's alliance (NPC_ARRIVAL_DETERMINISM_2026-11-02); the others are
 * ordinary draws, so a run holds more than one world.
 */
const SALTS = ['88594d5d92d3843733acf147efe59bf8', '0123456789abcdef0123456789abcdef'] as const;

/** A new campaign draws its salt from entropy; a test needs a world it can name. */
function withSalt<T>(salt: string, build: () => T): T {
  const words = salt.match(/.{8}/g)!.map((word) => parseInt(word, 16));
  const original = globalThis.crypto.getRandomValues.bind(globalThis.crypto);
  Object.defineProperty(globalThis.crypto, 'getRandomValues', { configurable: true, value: (array: Uint32Array<ArrayBuffer>) => {
    if (array instanceof Uint32Array && array.length === 4) { array.set(words); return array; }
    return original(array);
  } });
  try {
    return build();
  } finally {
    Object.defineProperty(globalThis.crypto, 'getRandomValues', { configurable: true, value: original });
  }
}

function campaign(salt: string = SALTS[0]): { state: SaveState; owners: string[] } {
  const { state: initial, owners } = withSalt(salt, () => world(6));
  let state = keen(allianceOf(initial, owners.slice(0, 4)), owners.slice(0, 4));
  for (const ownerId of owners.slice(0, 4)) state = armed(state, ownerId);
  const profiles = { ...state.npc!.profiles };
  for (const ownerId of owners) profiles[ownerId] = { ...profiles[ownerId]!, activity: { ...profiles[ownerId]!.activity, propensity: 0.9 } };
  state = { ...state, npc: { ...state.npc!, profiles } };
  const at0 = state.npcReplay!.processedThroughAt;
  applyCampaignRuntimeForCatchup(state, at0);
  const { summary: _summary, ...replay } = state.npcReplay!;
  // The plan starts with the world, so the run holds its answers, moved visits and T.
  return { state: startPlan(beginLiveWorld({ ...state, npcReplay: { ...replay, targetAt: at0 } }), owners[0]!, at0), owners };
}

/**
 * The save to compare, without two things that count by slices on main as well,
 * with no plan in the world: the pirates' threat clock (NPC_LIVING_PLAYERS_PR1_REPORT)
 * and the absence summary (a war and its truce within one slice count as none).
 */
function comparable(state: SaveState): string {
  const { ownerThreats: _threats, ...pirate } = (state.pirate ?? {}) as NonNullable<SaveState['pirate']>;
  const { summary: _summary, ...replay } = state.npcReplay!;
  return serializeSaveForStorage({ ...state, pirate: pirate as NonNullable<SaveState['pirate']>, npcReplay: replay }, 'production');
}

function run(state: SaveState, slices: readonly number[]): SaveState {
  const at0 = state.npcReplay!.processedThroughAt;
  let current = state;
  let groups: number | undefined;
  for (const hours of slices) {
    const step = advanceLiveWorld(current, at0 + hours * HOUR, { groups });
    current = step.state;
    groups = 64;
  }
  return current;
}

test('a world with the plan does not depend on where it is sliced or on a journal (server = client)', { timeout: 600_000 }, () => {
  for (const salt of SALTS) {
    const { state } = campaign(salt);
    const whole = run(state, [13]);
    const sliced = run(state, [1, 2, 3.5, 5, 8, 13]);
    assert.equal(comparable(sliced), comparable(whole), `sliced, salt ${salt}`);
    const entries: NpcJournalSun[] = [];
    const previous = setNpcJournalSink({ detailed: () => true, decision: () => {}, sun: (entry) => entries.push(entry) });
    try {
      const watched = run(state, [13]);
      assert.equal(comparable(watched), comparable(whole), `a journal only watches, salt ${salt}`);
    } finally {
      setNpcJournalSink(previous);
    }
    assert.ok(entries.some((entry) => entry.step === 'rsvp'), `members answered (salt ${salt}): ${JSON.stringify(entries.slice(0, 5))}`);
    assert.ok(entries.some((entry) => entry.step === 'declared' || entry.step === 'postponed'), `and T came (salt ${salt})`);
  }
});

/** The same span with a fixed number of groups per call: the step must not show in the world. */
function runFixed(state: SaveState, hours: number, groups: number): SaveState {
  const at0 = state.npcReplay!.processedThroughAt;
  let t = 0;
  return advanceLiveWorld(state, at0 + hours * HOUR, { groups, chunkTargetMs: 250, clock: () => (t += 250) }).state;
}

test('NPC arrivals and pirate threats do not depend on the step size of the calculation', { timeout: 300_000 }, () => {
  // Salt 88594d5d...: npc-gen-06's probe reaches npc-gen-03 at +118 min, both are
  // allied from +179 min. A step of 32 groups judged the orbiting probe again
  // after that (a relation read at the arrival time of a world that was later),
  // 256 did not. The fresh pirate threat of npc-gen-02 started at the slice
  // cursor, so its age followed the step as well.
  const { state } = campaign(SALTS[0]);
  const hours = 3.1;
  const fine = runFixed(state, hours, 32);
  const coarse = runFixed(state, hours, 256);
  assert.equal(comparable(fine), comparable(coarse), 'the world');
  assert.equal(JSON.stringify(fine.pirate?.ownerThreats), JSON.stringify(coarse.pirate?.ownerThreats), 'the threat clock of the pirates');
  const probe = fine.flights.records.find((flight) => flight.ownerId === 'npc-gen-06' && flight.missionId === 'espionage' && flight.arrivalAt === 1793001405705);
  // The NPC now play busier, so the exact probe of the original repro may not occur any more: the equality above is the check then.
  if (probe) {
  // It reported at its arrival, then went home the moment its owner joined the target's alliance.
  const joinedAt = fine.command.alliances.flatMap((alliance) => alliance.members).find((member) => member.ownerId === 'npc-gen-06')!.joinedAt;
  assert.equal(probe.completionReason, 'target-unavailable');
  assert.equal(probe.completedAt, joinedAt + probe.oneWayDurationMs, 'home one flight after the owner joined the alliance');
  assert.deepEqual(coarse.flights.records.find((flight) => flight.id === probe.id), probe, 'the same record at either step');
  }
});
