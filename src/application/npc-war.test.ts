// Revenge war (owner decision 09.11.2026, variant B): a hurt bot declares a war on its offender, calls the others hurt by him,
// scouts, stages its fleet and sends waves from many planets whatever the win chance, round after round.
import assert from 'node:assert/strict';
import test from 'node:test';

import { createDefaultNewGameConfig } from '../domain/world/config.ts';
import { getEspionageTargets } from '../domain/espionage/runtime.ts';
import type { SpyReportSnapshot, SpyTargetState } from '../domain/espionage/types.ts';
import { createEmptyDefenseState, createDefaultFleetProductionState } from '../domain/fleet/production.ts';
import { createEmptyFleetState } from '../domain/fleet/runtime.ts';
import { recordNpcGrievance } from '../domain/npc/grudges.ts';
import { createNpcStrategyState, isNpcStrategyState } from '../domain/npc/strategy.ts';
import { utilityToWeight } from '../domain/npc/utility.ts';
import { createInitialSaveState } from './persistence.ts';
import { reconcileFlights } from './flights.ts';
import { settleNpcFleetProduction } from './npc-fleet-production.ts';
import { createNpcUtilityContext } from './npc-utility.ts';
import { getNpcMissionCandidates } from './npc-mission-policy.ts';
import { draftNpcWar, getNpcWarChoices, NPC_WAR_BALANCE, npcWarFury, npcWarStagingPlanets, npcWarTargetOrder, recordNpcWarBattle, refreshNpcWars } from './npc-war.ts';
import { activeNpcWars, npcWarMember, withNpcWar } from './npc-war-state.ts';
import { NpcJournalRecorder, setNpcJournalSink } from './npc-journal.ts';
import type { SaveState } from './contracts.ts';
import { withAttackEligiblePoints } from './attack-eligibility.test-support.ts';

const START = Date.UTC(2026, 9, 27, 12);
const MINUTE = 60_000;
const HOUR = 3_600_000;
const SCIENCE = Object.fromEntries(Array.from({ length: 40 }, (_, index) => [index + 1, 15]));

type World = { state: SaveState; owner: string; second: string; offender: string; planets: string[]; target: string };

function npcPlanets(state: SaveState): SpyTargetState[] {
  return Object.values(getEspionageTargets(state.espionage)).filter((target) => target.kind === 'npc').sort((left, right) => left.id.localeCompare(right.id));
}

/** Seven built planets with 40 cruisers each, a victim behind a defence no fleet of that size breaks, and a second bot. */
function warWorld(seed: string, options: { grudge?: boolean; secondGrudge?: boolean; defence?: number } = {}): World {
  const base = createDefaultNewGameConfig({ seed, factionId: 'aegis', playerName: 'War' });
  let state = createInitialSaveState('production', START, { ...base, world: { ...base.world, npcCount: 9, campaignSpeed: 'standard' as const } });
  const all = npcPlanets(state);
  const home = all[0]!;
  const owner = home.ownerId;
  const targets = { ...getEspionageTargets(state.espionage) };
  const planets = all.slice(0, 7).map((planet) => planet.id);
  for (const id of planets) {
    const fleet = createEmptyFleetState();
    targets[id] = {
      ...targets[id]!, ownerId: owner, ownerName: home.ownerName, raceId: 'aegis',
      ownerProfile: { scienceLevels: SCIENCE, shipLevels: {}, commanderLevels: {} } as SpyTargetState['ownerProfile'],
      resources: { ...targets[id]!.resources, metal: 30_000_000, minerals: 30_000_000, gas: 30_000_000 },
      buildings: { ...targets[id]!.buildings, shipyard: 20, hangar: 100, 'advanced-factory': 10, 'metal-storage': 30, 'mineral-storage': 30, 'gas-storage': 30 },
      fleet: { ...fleet, ships: { ...fleet.ships, cruiser: 40, 'spy-probe': 5 } },
      fleetProduction: createDefaultFleetProductionState(),
    } as SpyTargetState;
  }
  const victim = all[7]!;
  const defense = createEmptyDefenseState();
  targets[victim.id] = { ...victim, resources: { ...victim.resources, metal: 20_000_000, minerals: 20_000_000, gas: 20_000_000 },
    defense: { ...defense, defenses: { ...defense.defenses, 'ion-plasma-battery': options.defence ?? 5_000 } } } as SpyTargetState;
  const second = all[8]!.ownerId;
  state = withAttackEligiblePoints({ ...state, espionage: { ...state.espionage!, targets } }, [owner, victim.ownerId, second], 2_000_000);
  const report: SpyReportSnapshot = {
    ownerId: owner, id: 'war-test-report', missionId: 'war-test-mission', createdAt: START, sourcePlanetId: planets[0]!,
    targetPlanetId: victim.id, targetPlanetName: victim.name, targetOwnerId: victim.ownerId, targetOwnerName: victim.ownerName,
    targetRaceId: victim.raceId, targetRelation: 'neutral', targetCoordinate: { ...victim.coordinate },
    spyLevel: 10, targetEspionageLevel: 0, delta: 10, roll: 0.5, quality: 'full',
    resources: { ...targets[victim.id]!.resources }, defense: { ...targets[victim.id]!.defense.defenses }, fleet: { ...targets[victim.id]!.fleet.ships }, firstReport: true,
  };
  state = { ...state, espionage: { ...state.espionage!, reports: [...(state.espionage!.reports ?? []), report] } };
  const angry = (ownerId: string, times: number) => {
    const profile = state.npc!.profiles[ownerId]!;
    const day = createNpcUtilityContext(state, profile, START, 1).dayValue;
    const hurt = Array.from({ length: times }, (_, index) => index + 1)
      .reduce((acc, index) => recordNpcGrievance(acc, victim.ownerId, 5 * day, START - index * 60 * MINUTE, `war-test-${ownerId}-${index}`), profile);
    state = { ...state, npc: { ...state.npc!, profiles: { ...state.npc!.profiles, [ownerId]: hurt } } };
  };
  if (options.grudge ?? true) angry(owner, 3);
  if (options.secondGrudge ?? false) angry(second, 3);
  return { state, owner, second, offender: victim.ownerId, planets, target: victim.id };
}

const utilityOf = (state: SaveState, ownerId: string, at: number) => createNpcUtilityContext(state, state.npc!.profiles[ownerId]!, at, 1);

test('a hurt bot declares a war on its offender and calls the others hurt by him', () => {
  const world = warWorld('npc-war-declare', { secondGrudge: true });
  const at = START + MINUTE;
  const war = draftNpcWar(world.state, world.state.npc!.profiles[world.owner]!, utilityOf(world.state, world.owner, at), at);
  assert.ok(war, 'a bot with a deep grudge plans a war, no win chance asked');
  assert.equal(war.leaderId, world.owner);
  assert.equal(war.offenderId, world.offender);
  assert.deepEqual(war.targets, [world.target]);
  const second = npcWarMember(war, world.second);
  assert.equal(second?.answer, 'invited', 'the other hurt bot is invited');
  assert.equal(second?.role, 'hurt');
  assert.ok(war.roundAt >= at + NPC_WAR_BALANCE.firstRoundHours * HOUR - 1);
  assert.equal(isNpcStrategyState({ ...createNpcStrategyState(), wars: [war] }), true, 'a war is a valid part of the save');
});

test('no grudge, a war already running or a faded fury: no war', () => {
  const calm = warWorld('npc-war-calm', { grudge: false });
  const at = START + MINUTE;
  assert.equal(draftNpcWar(calm.state, calm.state.npc!.profiles[calm.owner]!, utilityOf(calm.state, calm.owner, at), at), null);
  const world = warWorld('npc-war-faded');
  const profile = world.state.npc!.profiles[world.owner]!;
  const late = START + 90 * 24 * HOUR;
  assert.equal(draftNpcWar(world.state, profile, utilityOf(world.state, world.owner, late), late), null, 'fury fades without fresh blows');
  assert.ok(npcWarFury(utilityOf(world.state, world.owner, at), world.offender, at) > npcWarFury(utilityOf(world.state, world.owner, late), world.offender, late));
  const war = draftNpcWar(world.state, profile, utilityOf(world.state, world.owner, at), at)!;
  const running = withNpcWar(world.state, war);
  assert.equal(draftNpcWar(running, profile, utilityOf(running, world.owner, at), at), null, 'one war per bot, and one per offender');
});

test('an invited bot answers by its own fury; a late answer is no answer; a hurt bot volunteers', () => {
  const world = warWorld('npc-war-answer', { secondGrudge: true });
  const at = START + MINUTE;
  const war = draftNpcWar(world.state, world.state.npc!.profiles[world.owner]!, utilityOf(world.state, world.owner, at), at)!;
  const called = withNpcWar(world.state, war);
  const answered = refreshNpcWars(called, called.npc!.profiles[world.second]!, utilityOf(called, world.second, at + HOUR), at + HOUR);
  assert.equal(npcWarMember(activeNpcWars(answered)[0]!, world.second)?.answer, 'accepted', 'a bot hurt by the same offender joins');
  const late = at + 7 * HOUR;
  const missed = refreshNpcWars(called, called.npc!.profiles[world.second]!, utilityOf(called, world.second, late), late);
  assert.equal(npcWarMember(activeNpcWars(missed)[0]!, world.second)?.answer, 'expired');
  const lone = withNpcWar(world.state, { ...war, members: war.members.filter((item) => item.ownerId !== world.second) });
  const volunteered = refreshNpcWars(lone, lone.npc!.profiles[world.second]!, utilityOf(lone, world.second, at + HOUR), at + HOUR);
  assert.equal(npcWarMember(activeNpcWars(volunteered)[0]!, world.second)?.answer, 'accepted');
});

test('the order of targets: known planets by weakest defence; the staging planets are the nearest half', () => {
  const world = warWorld('npc-war-order');
  const at = START + MINUTE;
  const utility = utilityOf(world.state, world.owner, at);
  assert.deepEqual(npcWarTargetOrder(world.state, utility, world.offender), [world.target]);
  const target = getEspionageTargets(world.state.espionage)[world.target]!;
  assert.equal(npcWarStagingPlanets(utility.ownPlanets, target).length, Math.ceil(utility.ownPlanets.length / 2));
});

test('the war: scouting, then waves from many planets against a defence they cannot break, round after round', () => {
  const world = warWorld('npc-war-drive');
  const recorder = new NpcJournalRecorder();
  const previous = setNpcJournalSink(recorder);
  let state = world.state;
  const kinds = new Map<string, number>();
  try {
    for (let at = START + MINUTE, look = 0; at <= START + 20 * HOUR; at += 5 * MINUTE, look += 1) {
      const targets = { ...getEspionageTargets(state.espionage) };
      for (const id of world.planets) if (targets[id]?.ownerId === world.owner) targets[id] = settleNpcFleetProduction(targets[id]!, world.owner, at).target;
      state = { ...state, espionage: { ...state.espionage!, targets } };
      state = reconcileFlights(state, at, () => 0.5, { mode: 'production', testTimeScale: 1 }).state;
      const profile = state.npc!.profiles[world.owner]!;
      state = refreshNpcWars(state, profile, createNpcUtilityContext(state, profile, at, 1), at);
      const utility = createNpcUtilityContext(state, profile, at, 1);
      const choices = getNpcWarChoices(state, profile, utility, at, 1, getNpcMissionCandidates(state, profile, at), (_id, estimate) => utilityToWeight(estimate));
      choices.sort((left, right) => (left.candidate.id < right.candidate.id ? -1 : 1)).forEach((choice, index) => {
        const outcome = choice.run(state, `war-test:${look}:${index}`);
        const kind = choice.candidate.id.split(':').slice(0, 2).join(':');
        if (outcome.started) kinds.set(kind, (kinds.get(kind) ?? 0) + 1);
        state = outcome.state;
      });
    }
  } finally {
    setNpcJournalSink(previous);
  }
  const entries = recorder.take().filter((entry) => entry.k === 'war');
  if (process.env.WAR_DEBUG) console.log(JSON.stringify({ war: state.npcStrategy?.wars, counts: entries.reduce((acc: Record<string, number>, entry) => { const ev = String((entry.d as { ev: string }).ev); acc[ev] = (acc[ev] ?? 0) + 1; return acc; }, {}), kinds: [...kinds] }, null, 1));
  const war = (state.npcStrategy?.wars ?? [])[0]!;
  assert.ok(war, 'a war was declared');
  assert.ok(war.round >= 2, `the war goes on to a second round (round ${war.round}, ${war.status} ${war.reason ?? ''})`);
  const attacks = state.flights.records.filter((flight) => flight.ownerId === world.owner && flight.missionId === 'attack');
  assert.ok(attacks.length >= 4, `waves leave from several planets even though none of them can win (${attacks.length})`);
  assert.ok(new Set(attacks.map((flight) => flight.originPlanetId)).size >= 4, 'from different planets');
  const events = new Set(entries.map((entry) => String((entry.d as { ev: string }).ev)));
  for (const wanted of ['declared', 'wave', 'round']) assert.ok(events.has(wanted), `the journal has ${wanted} (${[...events].join(', ')})`);
  assert.ok((kinds.get('war:recon') ?? 0) > 0, 'the target was scouted first');
});

test('a battle of a member on the offender counts for the war', () => {
  const world = warWorld('npc-war-battle', { secondGrudge: true });
  const at = START + MINUTE;
  const war = draftNpcWar(world.state, world.state.npc!.profiles[world.owner]!, utilityOf(world.state, world.owner, at), at)!;
  const running = withNpcWar(world.state, war);
  const report = { attacker: { playerId: world.owner }, defender: { playerId: world.offender }, winner: 'attacker', missionType: 'attack' } as never;
  const counted = recordNpcWarBattle(running, report, at, 10, 20);
  assert.equal(activeNpcWars(counted)[0]!.waves, 1);
  assert.equal(activeNpcWars(counted)[0]!.wins, 1);
  const other = { attacker: { playerId: 'stranger' }, defender: { playerId: world.offender }, winner: 'attacker', missionType: 'attack' } as never;
  assert.equal(recordNpcWarBattle(running, other, at, 0, 0), running, 'a non-member battle is none of the war');
});
