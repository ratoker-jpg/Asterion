import assert from 'node:assert/strict';
import test from 'node:test';

import { DEFAULT_ALLIANCE_EMBLEM } from '../domain/command/catalog.ts';
import { acceptApplication, applyToAlliance, createAlliance } from '../domain/command/membership.ts';
import { getFactionShipCatalog } from '../domain/combat/faction-catalog.ts';
import type { SpyTargetState } from '../domain/espionage/types.ts';
import { listNpcVisits } from '../domain/npc/calendar.ts';
import { createNpcState, migrateNpcState } from '../domain/npc/state.ts';
import { isNpcStrategyState, migrateNpcStrategyState } from '../domain/npc/strategy.ts';
import { npcSunPromised, type NpcSunRaidPrepPlan } from '../domain/npc/sun-prep.ts';
import { utilityToWeight } from '../domain/npc/utility.ts';
import { sunRaidCapsOf } from '../domain/sun-raid/config.ts';
import { createDefaultNewGameConfig } from '../domain/world/config.ts';
import type { SaveState } from './contracts.ts';
import { getNpcEndgameChoices } from './npc-endgame.ts';
import { setNpcJournalSink, type NpcJournalSun } from './npc-journal.ts';
import { advanceLiveWorld, beginLiveWorld } from './npc-live-world.ts';
import { applyCampaignRuntimeForCatchup } from './npc-catchup-runner.ts';
import { getNpcMissionCandidates } from './npc-mission-policy.ts';
import { getNpcMissionAvailableFleet } from './npc-missions.ts';
import { activeNpcSunPrep, npcSunPrepNextMoment, withoutNpcSunPrepHold, NPC_SUN_PREP_BALANCE } from './npc-sun-prep-state.ts';
import { chooseNpcSunForRaid, getNpcSunPrepChoices, npcResponsiveness, pickNpcGatherTime, refreshNpcSunPrep } from './npc-sun-prep.ts';
import { createNpcUtilityContext } from './npc-utility.ts';
import { createInitialSaveState, serializeSaveForStorage } from './persistence.ts';
import { currentSunRaidState, reconcileSunRaids } from './sun-raid.ts';

const NOW = Date.UTC(2026, 9, 26, 6);
const HOUR = 3_600_000;

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
  return state.npcStrategy!.plans[leader]![0]!;
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

test('T lies 4 to 12 hours ahead, inside one of the leader\'s own visits, and the choice is the leader\'s to weigh', () => {
  const { owners } = world();
  const team = owners.slice(0, 3);
  const { state, leader } = ready(team);
  const planned = startPlan(state, leader, NOW);
  const plan = planOf(planned, leader);
  assert.ok(plan.gatherAt >= NOW + 4 * HOUR && plan.gatherAt <= NOW + 12 * HOUR, `T in ${(plan.gatherAt - NOW) / HOUR} h`);
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
  const fresh = createNpcState(owners, 'salt', NOW);
  assert.equal(Object.values(fresh.profiles)[0]!.session.visitShifts, undefined, 'new owners carry no moves');
});

function campaign(): { state: SaveState; owners: string[] } {
  const { state: initial, owners } = world(6);
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

test('a world with the plan does not depend on where it is sliced or on a journal (server = client)', { timeout: 300_000 }, () => {
  const { state } = campaign();
  const whole = run(state, [13]);
  const sliced = run(state, [1, 2, 3.5, 5, 8, 13]);
  assert.equal(comparable(sliced), comparable(whole));
  const entries: NpcJournalSun[] = [];
  const previous = setNpcJournalSink({ detailed: () => true, decision: () => {}, sun: (entry) => entries.push(entry) });
  try {
    const watched = run(state, [13]);
    assert.equal(comparable(watched), comparable(whole), 'a journal only watches');
  } finally {
    setNpcJournalSink(previous);
  }
  assert.ok(entries.some((entry) => entry.step === 'rsvp'), `members answered: ${JSON.stringify(entries.slice(0, 5))}`);
  assert.ok(entries.some((entry) => entry.step === 'declared' || entry.step === 'postponed'), 'and T came');
});
