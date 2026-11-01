// Stage E (ADR §7.б, §9.2; vision §8.3 T-SOC-01…04): relations from real events, agreements two
// NPC reach or refuse outside any alliance, a transport to a friend, what they do after being robbed.
import assert from 'node:assert/strict';
import test from 'node:test';

import { createDefaultNewGameConfig } from '../domain/world/config.ts';
import { getEspionageTargets } from '../domain/espionage/runtime.ts';
import { createEmptyDefenseState, createDefaultFleetProductionState } from '../domain/fleet/production.ts';
import { createEmptyFleetState } from '../domain/fleet/runtime.ts';
import { getFactionDefenseCatalog, getFactionShipCatalog } from '../domain/combat/faction-catalog.ts';
import { NPC_PROPOSALS_KEPT, type NpcGiftProposal, type NpcJointStrikeProposal, type NpcProposal } from '../domain/npc/pacts.ts';
import { migrateNpcStrategyState, type NpcStrikePlan } from '../domain/npc/strategy.ts';
import { campaignIdFromSalt, createPersonaRegistry, findSeries } from '../domain/npc/persona-registry.ts';
import type { SpyReportSnapshot, SpyTargetState } from '../domain/espionage/types.ts';
import type { BattleReport } from '../domain/combat/report.ts';
import { createNpcState } from '../domain/npc/state.ts';
import { getNpcOwnerIds } from './npc-foundation.ts';
import { createInitialSaveState, createPersistenceFacade } from './persistence.ts';
import type { SaveState } from './contracts.ts';
import { withAttackEligiblePoints } from './attack-eligibility.test-support.ts';
import { getNpcDiplomacyCandidates } from './npc-diplomacy.ts';
import { reconcileFlights } from './flights.ts';
import { resolveNpcTransportArrival, dispatchNpcTransport } from './npc-missions.ts';
import { journalNpcPact, NPC_GIFT_REQUEST_PREFIX, npcReactionStyle, recordNpcPactArrival, settleNpcPact, breakNpcPactByAttack, withNpcPact } from './npc-pact-state.ts';
import { chooseNpcRobberyReaction, npcJointTargetAllowed, npcPactForbidsAttack, refreshNpcPacts, NPC_PACT_BALANCE } from './npc-pacts.ts';
import { refreshNpcPlans } from './npc-plans.ts';
import { npcRelationView, recordNpcBattleRelations, recordNpcHelp, recordNpcRelation } from './npc-relations.ts';
import { bindNewCampaignToSeries, settleCampaign } from './npc-series.ts';
import { readNpcPlayStyle } from './npc-style.ts';
import { createNpcUtilityContext, estimateAttackUtility, npcAttackRegardBias, strategyOf } from './npc-utility.ts';
import { NpcJournalRecorder, setNpcJournalSink } from './npc-journal.ts';
import { freezeNpcCatchupTarget, isNpcCatchupPending } from './npc-catchup.ts';
import { memoryStorage } from './npc-runtime.test-support.ts';
import { reconcileRuntime } from './reconcile.ts';

const START = Date.UTC(2026, 9, 27, 12);
const HOUR = 3_600_000;
const MINUTE = 60_000;
const SCIENCE = Object.fromEntries(Array.from({ length: 40 }, (_, index) => [index + 1, 15]));

type World = { state: SaveState; a: string; b: string; target: string; targetPlanet: string; planetA: string; planetB: string };

function npcPlanets(state: SaveState): SpyTargetState[] {
  return Object.values(getEspionageTargets(state.espionage)).filter((target) => target.kind === 'npc').sort((left, right) => left.id.localeCompare(right.id));
}

function withReport(state: SaveState, ownerId: string, sourcePlanetId: string, target: SpyTargetState, at: number): SaveState {
  const report: SpyReportSnapshot = {
    ownerId, id: `pact-test-${ownerId}-${at}`, missionId: `pact-test-mission-${ownerId}-${at}`, createdAt: at, sourcePlanetId,
    targetPlanetId: target.id, targetPlanetName: target.name, targetOwnerId: target.ownerId, targetOwnerName: target.ownerName,
    targetRaceId: target.raceId, targetRelation: 'neutral', targetCoordinate: { ...target.coordinate },
    spyLevel: 10, targetEspionageLevel: 0, delta: 10, roll: 0.5, quality: 'full',
    resources: { ...target.resources }, defense: { ...target.defense.defenses }, fleet: { ...target.fleet.ships }, firstReport: true,
  };
  return { ...state, espionage: { ...state.espionage!, reports: [...(state.espionage!.reports ?? []), report] } };
}

/** Two armed solo owners, each with its own fresh report of a neighbour behind batteries too strong for one. */
function soloWorld(seed: string, options: Readonly<{ reports?: boolean; regardAB?: number; regardBA?: number; cooperation?: number }> = {}): World {
  const base = createDefaultNewGameConfig({ seed, factionId: 'aegis', playerName: 'Pacts' });
  let state = createInitialSaveState('production', START, { ...base, world: { ...base.world, npcCount: 7, campaignSpeed: 'standard' as const } });
  // A fixed salt in place of the crypto one: the owners' calendars, and so these tests, repeat.
  state = { ...state, npc: createNpcState(getNpcOwnerIds(state.espionage!.targets, state.profile.playerId), `salt-${seed}`, START) };
  const all = npcPlanets(state);
  const [pa, pb, pt] = all;
  const targets = { ...getEspionageTargets(state.espionage) };
  const ownerProfile = { scienceLevels: SCIENCE, shipLevels: {}, commanderLevels: {} };
  for (const planet of [pa!, pb!]) {
    const fleet = createEmptyFleetState();
    targets[planet.id] = { ...planet, raceId: 'aegis', ownerProfile: ownerProfile as SpyTargetState['ownerProfile'],
      resources: { ...planet.resources, metal: 150_000, minerals: 150_000, gas: 150_000 },
      buildings: { ...planet.buildings, shipyard: 20, hangar: 100, 'advanced-factory': 10, 'metal-storage': 30, 'mineral-storage': 30, 'gas-storage': 30 },
      fleet: { ...fleet, ships: { ...fleet.ships, cruiser: 60, transporter: 200, 'spy-probe': 5 } },
      fleetProduction: createDefaultFleetProductionState() } as SpyTargetState;
  }
  const cruiser = getFactionShipCatalog('aegis').find((entity) => entity.id === 'cruiser')!.combat!;
  const battery = getFactionDefenseCatalog(pt!.raceId).find((entity) => entity.id === 'ion-plasma-battery')!.combat!;
  const defense = createEmptyDefenseState();
  const count = Math.ceil(1.6 * 60 * Math.sqrt(cruiser.attack * cruiser.life) / Math.sqrt(battery.attack * battery.life));
  targets[pt!.id] = { ...pt!, resources: { ...pt!.resources, metal: 9_000_000, minerals: 9_000_000, gas: 9_000_000 },
    defense: { ...defense, defenses: { ...defense.defenses, 'ion-plasma-battery': count } },
    fleet: { ...pt!.fleet, ships: {} } } as SpyTargetState;
  state = withAttackEligiblePoints({ ...state, espionage: { ...state.espionage!, targets } }, [pa!.ownerId, pb!.ownerId, pt!.ownerId], 2_000_000);
  if (options.reports !== false) {
    state = withReport(state, pa!.ownerId, pa!.id, targets[pt!.id]!, START);
    state = withReport(state, pb!.ownerId, pb!.id, targets[pt!.id]!, START);
  }
  const traits = { riskTolerance: 0.8, cooperation: options.cooperation ?? 0.6, socialStyle: 0.6, attention: 0.9, aggression: 0.4, militaryFocus: 0.7 };
  const profiles = { ...state.npc!.profiles };
  for (const [ownerId, other, regard] of [[pa!.ownerId, pb!.ownerId, options.regardAB ?? 0.6], [pb!.ownerId, pa!.ownerId, options.regardBA ?? 0.6]] as const) {
    const profile = profiles[ownerId]!;
    profiles[ownerId] = { ...profile, traits: { ...profile.traits, ...traits }, activity: { ...profile.activity, propensity: 1 },
      // They share an old enemy: what a strike costs in ships, a grudge can pay for.
      inherited: { round: 2, prefs: {}, lessons: [], relations: { [pt!.ownerId]: { trust: 0, affinity: 0, resentment: 0.5 },
        ...(regard >= 0 ? { [other]: { trust: regard, affinity: 0.4, resentment: 0 } } : { [other]: { trust: 0, affinity: 0, resentment: -regard } }) } } };
  }
  // Awake in the same hours: a time one can keep, the other can too.
  const clock = profiles[pa!.ownerId]!.session.timezoneOffsetMinutes;
  profiles[pb!.ownerId] = { ...profiles[pb!.ownerId]!, session: { ...profiles[pb!.ownerId]!.session, timezoneOffsetMinutes: clock } };
  state = { ...state, npc: { ...state.npc!, profiles } };
  return { state, a: pa!.ownerId, b: pb!.ownerId, target: pt!.ownerId, targetPlanet: pt!.id, planetA: pa!.id, planetB: pb!.id };
}

function look(state: SaveState, ownerId: string, at: number): SaveState {
  const profile = state.npc!.profiles[ownerId]!;
  return refreshNpcPacts(state, profile, createNpcUtilityContext(state, profile, at, 1), at, 1);
}

const proposals = (state: SaveState) => state.npcStrategy?.proposals ?? [];
const jointOf = (state: SaveState) => proposals(state).find((item): item is NpcJointStrikeProposal => item.kind === 'joint-strike');
const planOf = (state: SaveState, ownerId: string) => (state.npcStrategy?.plans[ownerId] ?? []).find((plan): plan is NpcStrikePlan => plan.template === 'strike');

function agreed(world: World): SaveState {
  const asked = look(world.state, world.a, START + MINUTE);
  const pact = jointOf(asked);
  assert.ok(pact, 'the proposer sees a target too strong alone that it dares with a friend');
  const answered = look(asked, world.b, START + 2 * MINUTE);
  assert.equal(jointOf(answered)?.status, 'accepted', jointOf(answered)?.reason);
  return look(answered, world.a, START + 3 * MINUTE);
}

test('T-SOC-01: two solo owners who think well of each other agree on a strike, outside any alliance', () => {
  const world = soloWorld('pact-agree');
  const state = agreed(world);
  const pact = jointOf(state)!;
  assert.equal(pact.from, world.a);
  assert.equal(pact.to, world.b);
  assert.equal(pact.terms.targetOwnerId, world.target);
  assert.deepEqual(state.command.alliances, world.state.command.alliances, 'an agreement makes no alliance');
  const planA = planOf(state, world.a)!;
  const planB = planOf(state, world.b)!;
  assert.equal(planA.partner?.ownerId, world.b);
  assert.equal(planB.partner?.ownerId, world.a);
  assert.notEqual(planA.partner?.wave, planB.partner?.wave, 'they split the waves');
  assert.equal(planA.template, 'strike', 'a joint strike is each side\'s ordinary strike');
});

test('T-SOC-01: the other side may honestly refuse, and a refusal costs the asker nothing', () => {
  // A cold partner: what the proposer feels is not returned.
  const cold = soloWorld('pact-cold', { regardBA: -0.5 });
  const asked = look(cold.state, cold.a, START + MINUTE);
  assert.ok(jointOf(asked));
  const answered = look(asked, cold.b, START + 2 * MINUTE);
  assert.equal(jointOf(answered)?.status, 'declined');
  assert.equal(jointOf(answered)?.reason, 'distrust');
  assert.equal(planOf(answered, cold.b), undefined);
  assert.equal(npcRelationView(answered, answered.npc!.profiles[cold.a]!, cold.b, START)?.promisesBroken, 0, 'a no is no broken promise');
  // Nor does the asker ask again at once.
  const again = look({ ...answered, npcStrategy: { ...answered.npcStrategy!, nextCheckAt: {} } }, cold.a, START + HOUR);
  assert.equal(proposals(again).filter((item) => item.kind === 'joint-strike').length, 1);
});

test('conflict of interest: the target is the partner\'s friend, and it says so', () => {
  const world = soloWorld('pact-friend');
  const profile = world.state.npc!.profiles[world.b]!;
  const state: SaveState = { ...world.state, npc: { ...world.state.npc!, profiles: { ...world.state.npc!.profiles, [world.b]: { ...profile,
    inherited: { ...profile.inherited!, relations: { ...profile.inherited!.relations, [world.target]: { trust: 0.7, affinity: 0.6, resentment: 0 } } } } } } };
  const answered = look(look(state, world.a, START + MINUTE), world.b, START + 2 * MINUTE);
  assert.equal(jointOf(answered)?.reason, 'target-is-friend');
});

test('a partner with no news of its own looks for itself first: it is told a name, not the report', () => {
  const world = soloWorld('pact-no-intel');
  // Only the proposer has spied.
  const reports = world.state.espionage!.reports!.filter((report) => report.ownerId === world.a);
  const state: SaveState = { ...world.state, espionage: { ...world.state.espionage!, reports } };
  const asked = look(state, world.a, START + MINUTE);
  const pact = jointOf(asked)!;
  const text = JSON.stringify(pact);
  for (const word of ['fleet', 'defense', 'resources', 'metal', 'power', 'ion-plasma']) assert.ok(!text.includes(word), `the agreement carries ${word}`);
  const waiting = look(asked, world.b, START + 2 * MINUTE);
  assert.equal(jointOf(waiting)?.status, 'proposed', 'no answer yet: it has its own probe to send');
  const late = look(waiting, world.b, pact.expiresAt - 10 * MINUTE);
  assert.equal(jointOf(late)?.status, 'declined');
  assert.equal(jointOf(late)?.reason, 'no-intel');
  const expired = look(asked, world.a, pact.expiresAt + 1);
  assert.equal(jointOf(expired)?.status, 'expired');
});

test('T-SOC-02: a role is a preference inside what the owner can build: a yard that cannot makes something it can', () => {
  const world = soloWorld('pact-roles');
  const planet = getEspionageTargets(world.state.espionage)[world.planetB]!;
  // A shipyard that builds no bomber nor destroyer.
  const weak: SaveState = { ...world.state, espionage: { ...world.state.espionage!, targets: { ...getEspionageTargets(world.state.espionage),
    [world.planetB]: { ...planet, buildings: { ...planet.buildings, shipyard: 3 } } } } };
  const state = agreed({ ...world, state: weak });
  const pact = jointOf(state)!;
  assert.notEqual(pact.terms.fromRole.hull, pact.terms.toRole.hull);
  for (const order of planOf(state, world.b)!.orders) {
    assert.notEqual(order.itemId, 'bomber');
    assert.notEqual(order.itemId, 'destroyer');
  }
  // What it does order costs no more than the budget lets it.
  const costs = getFactionShipCatalog('aegis');
  const metal = planOf(state, world.b)!.orders.reduce((sum, order) => sum + (costs.find((entity) => entity.id === order.itemId)?.cost?.metal ?? 0) * order.quantity, 0);
  assert.ok(metal <= NPC_PACT_BALANCE.budgetShare * planet.resources.metal);
});

test('the plan keeps its time: no launch before the window, each side rechecks with its own news', () => {
  const world = soloWorld('pact-timing');
  const state = agreed(world);
  const plan = planOf(state, world.a)!;
  assert.ok(plan.partner!.arriveAt >= START + NPC_PACT_BALANCE.minLeadHours * HOUR, 'agreed well ahead: both have visits to play it');
  assert.equal(plan.deadlineAt, plan.partner!.arriveAt + plan.partner!.toleranceMs);
  // Gathered and ready long before the time: it stands by at recheck and takes no news yet.
  const ready: NpcStrikePlan = { ...plan, phase: 'recheck', orders: plan.orders.map((order) => ({ ...order, orderId: 'x' })) };
  const standing: SaveState = { ...state, npcStrategy: { ...state.npcStrategy!, plans: { ...state.npcStrategy!.plans, [world.a]: [ready] } } };
  const profile = standing.npc!.profiles[world.a]!;
  const early = START + HOUR;
  const after = refreshNpcPlans(standing, profile, createNpcUtilityContext(standing, profile, early, 1), early, 1);
  // Whatever else the look moved, the phase has not gone on to launch.
  assert.notEqual(planOf(after, world.a)!.phase, 'launch');
});

test('no grudge and nothing the holds could carry: a strike that only costs ships is not proposed', () => {
  const world = soloWorld('pact-worthless');
  const profiles = Object.fromEntries(Object.entries(world.state.npc!.profiles).map(([ownerId, profile]) => {
    if (!profile.inherited) return [ownerId, profile];
    const { [world.target]: _old, ...relations } = profile.inherited.relations;
    return [ownerId, { ...profile, inherited: { ...profile.inherited, relations } }];
  })) as NonNullable<SaveState['npc']>['profiles'];
  const state: SaveState = { ...world.state, npc: { ...world.state.npc!, profiles } };
  assert.equal(jointOf(look(state, world.a, START + MINUTE)), undefined);
});

test('the second wave brings holds to carry the haul; a robbery reaction needs real robberies, not one hold', () => {
  const state = agreed(soloWorld('pact-holds'));
  const pact = jointOf(state)!;
  const second = pact.terms.fromRole.wave === 2 ? pact.from : pact.to;
  const first = second === pact.from ? pact.to : pact.from;
  const holds = (ownerId: string) => Object.values(planOf(state, ownerId)!.reserve).reduce((sum, share) => sum + (share.transporter ?? 0), 0);
  assert.ok(holds(second) > 0);
  assert.equal(holds(first), 0);
  // Three battles held at home: attacked, not robbed, and everyone still reads it as before.
  const world = soloWorld('pact-held');
  const report = (index: number, winner: string, loot: number) => ({ id: `b${index}`, attacker: { playerId: world.target }, defender: { playerId: world.a }, winner, missionType: 'attack',
    timestamp: new Date(START - HOUR).toISOString(), resources: { metal: loot, minerals: 0, gas: 0 }, attackerForce: { stacks: [] }, defenderForce: { stacks: [] } }) as unknown as BattleReport;
  const held: SaveState = { ...world.state, combat: { ...world.state.combat, reports: [0, 1, 2, 3].map((index) => report(index, 'defender', 0)) } };
  assert.equal(look(held, world.a, START).npcStrategy?.reactions?.[world.a], undefined);
  const robbed: SaveState = { ...world.state, combat: { ...world.state.combat, reports: [0, 1, 2, 3].map((index) => report(index, 'attacker', 5_000)) } };
  assert.ok(look(robbed, world.a, START).npcStrategy?.reactions?.[world.a]);
});

test('both came: the agreement is fulfilled and each remembers it, in reliability and joint operations', () => {
  const world = soloWorld('pact-done');
  let state = agreed(world);
  const id = jointOf(state)!.proposalId;
  state = recordNpcPactArrival(state, id, world.a, { at: START + 8 * HOUR, won: false, gain: 0, loss: 100 });
  assert.equal(jointOf(state)!.status, 'accepted', 'one battle is half the agreement');
  state = recordNpcPactArrival(state, id, world.b, { at: START + 8 * HOUR + MINUTE, won: true, gain: 500, loss: 10 });
  assert.equal(jointOf(state)!.status, 'fulfilled');
  for (const [from, to] of [[world.a, world.b], [world.b, world.a]] as const) {
    const view = npcRelationView(state, state.npc!.profiles[from]!, to, START + 8 * HOUR + MINUTE)!;
    assert.equal(view.jointOps, 1);
    assert.equal(view.jointWins, 1);
    assert.ok(view.reliability > 0.5);
  }
});

test('a no-show breaks the word; pulling out for a reason the world gave costs nothing', () => {
  const world = soloWorld('pact-broken');
  const state = agreed(world);
  const pact = jointOf(state)!;
  const late = pact.terms.strikeAt + 3 * pact.terms.toleranceMs + HOUR;
  const arrived = recordNpcPactArrival(state, pact.proposalId, world.a, { at: pact.terms.strikeAt, won: true, gain: 1, loss: 1 });
  const closed = look(arrived, world.a, late);
  assert.equal(jointOf(closed)!.status, 'broken');
  assert.equal(jointOf(closed)!.by, world.b);
  const view = npcRelationView(closed, closed.npc!.profiles[world.a]!, world.b, late)!;
  assert.equal(view.promisesBroken, 1);
  assert.ok(view.reliability < 0.5);
  // The same pact withdrawn under an attack at home: no grudge.
  const excused = settleNpcPact(state, pact, 'withdrawn', START + HOUR, 'threat-at-home', world.b);
  assert.equal(npcRelationView(excused, excused.npc!.profiles[world.a]!, world.b, START + HOUR)?.promisesBroken, 0);
  assert.equal(excused.npcStrategy?.relations?.[world.a], undefined, 'nothing written against it');
  // A partner's plan does not go on alone.
  const left = refreshNpcPlans(excused, excused.npc!.profiles[world.a]!, createNpcUtilityContext(excused, excused.npc!.profiles[world.a]!, START + HOUR, 1), START + HOUR, 1);
  assert.equal(planOf(left, world.a)!.status, 'cancelled');
  assert.equal(planOf(left, world.a)!.reason, 'partner-out');
});

test('an attack on a partner is betrayal: the agreement ends and the attacked will not forget', () => {
  const world = soloWorld('pact-betray');
  const state = agreed(world);
  const report = { attacker: { playerId: world.a }, defender: { playerId: world.b }, winner: 'attacker', missionType: 'attack' } as unknown as BattleReport;
  const hit = breakNpcPactByAttack(recordNpcBattleRelations(state, report, START + HOUR, 500_000), report, START + HOUR);
  assert.equal(jointOf(hit)!.status, 'broken');
  assert.equal(jointOf(hit)!.reason, 'betrayed');
  assert.equal(jointOf(hit)!.by, world.a);
  const view = npcRelationView(hit, hit.npc!.profiles[world.b]!, world.a, START + HOUR)!;
  assert.ok(view.regard < -0.3, `regard ${view.regard}`);
  assert.ok(view.fear > 0);
  // Who is the kind to betray is a matter of character.
  const partners = new Set([world.b]);
  const profile = state.npc!.profiles[world.a]!;
  assert.equal(npcPactForbidsAttack(profile, partners, world.b), true);
  assert.equal(npcPactForbidsAttack({ ...profile, traits: { ...profile.traits, aggression: 0.95, cooperation: 0.1 } }, partners, world.b), false);
  assert.equal(npcPactForbidsAttack(profile, partners, world.target), false);
});

test('anti pile-on: one joint strike at a time on a target, long pauses for the player, none on someone far smaller', () => {
  const world = soloWorld('pact-pile');
  assert.equal(npcJointTargetAllowed(world.state, world.a, world.target, START), true);
  const state = agreed(world);
  assert.equal(npcJointTargetAllowed(state, world.a, world.target, START + HOUR), false, 'already being struck');
  const small = withAttackEligiblePoints(world.state, [world.a], 9_000_000);
  assert.equal(npcJointTargetAllowed(small, world.a, world.target, START), false, 'less than half of the proposer');
  const player = world.state.profile.playerId;
  const pact = jointOf(state)!;
  const onPlayer = withNpcPact(state, { ...pact, proposalId: 'old', status: 'fulfilled', closedAt: START, terms: { ...pact.terms, targetOwnerId: player } });
  assert.equal(npcJointTargetAllowed(onPlayer, world.a, player, START + 47 * HOUR), false);
});

test('no eternal duets: having just run an operation the pair rests, and each repeat needs more reason', () => {
  const world = soloWorld('pact-duet');
  let state = agreed(world);
  const id = jointOf(state)!.proposalId;
  state = recordNpcPactArrival(state, id, world.a, { at: START + HOUR, won: true, gain: 1, loss: 1 });
  state = recordNpcPactArrival(state, id, world.b, { at: START + HOUR, won: true, gain: 1, loss: 1 });
  const plans = { ...state.npcStrategy!.plans, [world.a]: [], [world.b]: [] };
  const rested: SaveState = { ...state, npcStrategy: { ...state.npcStrategy!, plans, nextCheckAt: {} } };
  const next = look(rested, world.a, START + 2 * HOUR);
  assert.equal(proposals(next).filter((item) => item.kind === 'joint-strike' && item.status === 'proposed').length, 0);
});

test('agreements stay bounded in the save', () => {
  const world = soloWorld('pact-bounded');
  let state = world.state;
  const base = jointOf(look(state, world.a, START + MINUTE))!;
  for (let index = 0; index < NPC_PROPOSALS_KEPT + 20; index += 1) {
    state = withNpcPact(state, { ...base, proposalId: `p${index}`, status: index === 3 ? 'proposed' : 'declined' } as NpcProposal);
  }
  assert.equal(proposals(state).length, NPC_PROPOSALS_KEPT);
  assert.ok(proposals(state).some((item) => item.proposalId === 'p3'), 'an open one is not dropped');
});

/* ---------------------------------------------------------- transport */

function needyWorld(seed: string, regard = 0.6): World {
  const world = soloWorld(seed, { regardAB: regard, regardBA: regard });
  const planet = getEspionageTargets(world.state.espionage)[world.planetA]!;
  // The first owner's stores are nearly dry of gas; it says so to a friend.
  const targets = { ...getEspionageTargets(world.state.espionage), [world.planetA]: { ...planet, resources: { ...planet.resources, gas: 100 } } };
  return { ...world, state: { ...world.state, espionage: { ...world.state.espionage!, targets } } };
}

const giftOf = (state: SaveState) => proposals(state).find((item): item is NpcGiftProposal => item.kind === 'resource-gift');

function asked(world: World): SaveState {
  const state: SaveState = { ...world.state, npcStrategy: { version: 1, plans: {}, outcomes: {}, nextCheckAt: { [`pact:${world.a}`]: START + 99 * HOUR } } };
  const next = look(state, world.a, START + MINUTE);
  assert.ok(giftOf(next), 'it asks its friend');
  return next;
}

test('T-SOC-03: a gift is an ordinary transport: paid in fuel, credited on arrival, what does not fit burns', () => {
  const world = needyWorld('gift-ok');
  const ask = asked(world);
  const stock = getEspionageTargets(ask.espionage)[world.planetB]!.resources;
  const answered = look(ask, world.b, START + 2 * MINUTE);
  const gift = giftOf(answered)!;
  assert.equal(gift.status, 'accepted', gift.reason);
  const flight = answered.flights.records.find((record) => record.requestId.startsWith(NPC_GIFT_REQUEST_PREFIX))!;
  assert.equal(flight.missionId, 'transport');
  assert.equal(flight.ownerId, world.b);
  assert.equal(flight.destinationOwnerId, world.a);
  assert.ok(gift.terms.amount >= (flight.cargo?.gas ?? 0));
  const sender = getEspionageTargets(answered.espionage)[world.planetB]!;
  assert.equal(sender.resources.gas, stock.gas - flight.cargo!.gas - flight.gasCost, 'the sender pays the cargo and the flight');
  assert.ok(flight.gasCost > 0);
  const before = getEspionageTargets(answered.espionage)[world.planetA]!.resources.gas;
  // Promised: nothing has moved in anyone's opinion yet.
  assert.equal(npcRelationView(answered, answered.npc!.profiles[world.a]!, world.b, flight.arrivalAt)?.helpReceived, 0);
  const landed = resolveNpcTransportArrival(answered, flight, flight.arrivalAt);
  assert.equal(landed.ok, true);
  assert.equal(getEspionageTargets(landed.state.espionage)[world.planetA]!.resources.gas, before + flight.cargo!.gas);
  assert.equal(giftOf(landed.state)!.status, 'fulfilled');
  assert.equal(giftOf(landed.state)!.delivered, flight.cargo!.gas);
  const view = npcRelationView(landed.state, landed.state.npc!.profiles[world.a]!, world.b, flight.arrivalAt)!;
  assert.equal(view.helpReceived, flight.cargo!.gas, 'delivered, not promised');
  // A full store takes nothing more: by the player's rule the rest burns, it does not ride home.
  const planet = getEspionageTargets(answered.espionage)[world.planetA]!;
  const full: SaveState = { ...answered, espionage: { ...answered.espionage!, targets: { ...getEspionageTargets(answered.espionage), [world.planetA]: { ...planet, buildings: { ...planet.buildings, 'gas-storage': 0 }, resources: { ...planet.resources, gas: 1e12 } } } } };
  const burned = resolveNpcTransportArrival(full, flight, flight.arrivalAt);
  assert.equal(burned.flight!.cargoState, 'delivered');
  assert.equal(giftOf(burned.state)!.delivered, 0);
  assert.equal(getCargoSum(burned.flight!.cargo), 0);
});

const getCargoSum = (cargo: { metal: number; minerals: number; gas: number; debris: number } | undefined) => (cargo ? cargo.metal + cargo.minerals + cargo.gas + cargo.debris : -1);

test('T-SOC-03: only a friend or a partner is asked, and the answer can be no', () => {
  // A stranger is asked for nothing.
  const stranger = soloWorld('gift-stranger', { regardAB: 0.01, regardBA: 0.01 });
  const planet = getEspionageTargets(stranger.state.espionage)[stranger.planetA]!;
  const dry: SaveState = { ...stranger.state, espionage: { ...stranger.state.espionage!, targets: { ...getEspionageTargets(stranger.state.espionage), [stranger.planetA]: { ...planet, resources: { ...planet.resources, gas: 100 } } } } };
  assert.equal(giftOf(look(dry, stranger.a, START + MINUTE)), undefined);
  // A friend it thinks well of, who does not return it.
  const world = needyWorld('gift-cold');
  const profile = world.state.npc!.profiles[world.b]!;
  const cold: SaveState = { ...world.state, npc: { ...world.state.npc!, profiles: { ...world.state.npc!.profiles, [world.b]: { ...profile, inherited: { ...profile.inherited!, relations: {} } } } } };
  const answered = look(asked({ ...world, state: cold }), world.b, START + 2 * MINUTE);
  assert.equal(giftOf(answered)!.status, 'declined');
  assert.equal(giftOf(answered)!.reason, 'distrust');
  assert.equal(answered.flights.records.filter((record) => record.requestId.startsWith(NPC_GIFT_REQUEST_PREFIX)).length, 0);
});

test('T-SOC-03: the gift never reaches a planet it may not: the player, one\'s own by this path, a planet with a new holder', () => {
  const world = needyWorld('gift-legal');
  const state = world.state;
  const command = { requestId: 'r1', ownerId: world.b, originPlanetId: world.planetB, selectedShips: { transporter: 10 }, cargo: { metal: 1000, minerals: 0, gas: 0, debris: 0 }, toFriend: true };
  const playerPlanet = Object.keys(state.planets)[0]!;
  assert.equal(dispatchNpcTransport(state, { ...command, destinationPlanetId: playerPlanet }, START, 1).reason, 'target-not-available');
  assert.equal(dispatchNpcTransport(state, { ...command, destinationPlanetId: world.planetB }, START, 1).reason, 'target-not-available');
  const sent = dispatchNpcTransport(state, { ...command, destinationPlanetId: world.planetA }, START, 1);
  assert.equal(sent.ok, true);
  // Held by someone else on arrival: the cargo is lost, the ships fly home, nobody's opinion moves.
  const planet = getEspionageTargets(sent.state.espionage)[world.planetA]!;
  const taken: SaveState = { ...sent.state, espionage: { ...sent.state.espionage!, targets: { ...getEspionageTargets(sent.state.espionage), [world.planetA]: { ...planet, ownerId: world.target } } } };
  const landed = resolveNpcTransportArrival(taken, sent.flight!, sent.flight!.arrivalAt);
  assert.equal(landed.ok, false);
  assert.equal(landed.state.npcStrategy?.relations, undefined);
});

test('no cycles: whoever got a gift sends none, whoever gave asks for none, and the day\'s budget holds', () => {
  const world = needyWorld('gift-cycle');
  const answered = look(asked(world), world.b, START + 2 * MINUTE);
  assert.equal(giftOf(answered)!.status, 'accepted');
  // The giver, now short itself, does not ask anyone.
  const planetB = getEspionageTargets(answered.espionage)[world.planetB]!;
  const dryB: SaveState = { ...answered, espionage: { ...answered.espionage!, targets: { ...getEspionageTargets(answered.espionage), [world.planetB]: { ...planetB, resources: { ...planetB.resources, gas: 100 } } } } };
  const later = START + 7 * HOUR;
  const giverLook = look(dryB, world.b, later);
  assert.equal(proposals(giverLook).filter((item) => item.kind === 'resource-gift' && item.from === world.b).length, 0, 'giver asked');
  // The receiver, asked by someone in the same days, sends nothing.
  const onward: NpcGiftProposal = { ...giftOf(answered)!, proposalId: 'onward', from: world.b, to: world.a, status: 'proposed', createdAt: later, expiresAt: later + HOUR, terms: { resource: 'metal', amount: 5_000, planetId: world.planetB } };
  const refused = look(withNpcPact(answered, onward), world.a, later);
  const answer = proposals(refused).find((item) => item.proposalId === 'onward')!;
  assert.equal(answer.status, 'declined');
  assert.equal(answer.reason, 'cycle-guard');
  assert.ok(refused.npcStrategy!.gifts!.length === 1);
});

/* ---------------------------------------------------------- what it changes */

test('T-SOC-04: help from the player raises trust, and the owner still decides for itself; it offers the player nothing', () => {
  const world = soloWorld('player-help');
  const player = world.state.profile.playerId;
  const helped = recordNpcHelp(world.state, player, world.a, 400_000, 0.5, START);
  const view = npcRelationView(helped, helped.npc!.profiles[world.a]!, player, START)!;
  assert.ok(view.trust > 0);
  assert.equal(view.helpReceived, 400_000);
  assert.equal(helped.npcStrategy!.relations![player], undefined, 'the player keeps no opinion here: only NPC do');
  // Even with a warm memory of the player, no agreement names it.
  const friend = recordNpcRelation(helped, world.a, player, { kind: 'joint-op', won: true }, START);
  const after = look(friend, world.a, START + MINUTE);
  assert.ok(!proposals(after).some((item) => item.to === player), 'an offer to the player');
  // Attacks on it are remembered too.
  const report = { attacker: { playerId: player }, defender: { playerId: world.a }, winner: 'attacker', missionType: 'attack' } as unknown as BattleReport;
  const hit = recordNpcBattleRelations(helped, report, START + HOUR, 2_000_000);
  assert.ok(npcRelationView(hit, hit.npc!.profiles[world.a]!, player, START + HOUR)!.regard < view.regard);
});

test('relations weigh real choices: a friend is a poor target, an enemy of old a better one, a stranger as before', () => {
  const world = soloWorld('weights');
  const profile = world.state.npc!.profiles[world.a]!;
  const context = createNpcUtilityContext(world.state, profile, START, 1);
  assert.equal(npcAttackRegardBias(context, 'nobody-known'), 0, 'a stranger: numbers as before');
  assert.ok(npcAttackRegardBias(context, world.target) > 0, 'an enemy of old');
  assert.ok(npcAttackRegardBias(context, world.b) < -0.3);
  const origin = getEspionageTargets(world.state.espionage)[world.planetA]!;
  const report = world.state.espionage!.reports!.find((item) => item.ownerId === world.a)!;
  const friendly = { ...world.state, espionage: { ...world.state.espionage!, reports: [...world.state.espionage!.reports!, { ...report, id: 'x', targetPlanetId: world.planetB, targetOwnerId: world.b, resources: report.resources }] } };
  const before = estimateAttackUtility(createNpcUtilityContext(friendly, profile, START, 1), origin, world.planetB, { cruiser: 60 });
  const stranger = { ...profile, inherited: { ...profile.inherited!, relations: {} } };
  const without = estimateAttackUtility(createNpcUtilityContext(friendly, stranger, START, 1), origin, world.planetB, { cruiser: 60 });
  assert.ok(before < without, `friend ${before}, stranger ${without}`);
  // A betrayal raises what it thinks of the target's standing in a later war decision.
  const views = (state: SaveState) => getNpcDiplomacyCandidates(state, state.npc!.profiles[world.a]!, START);
  assert.deepEqual(views(world.state), views(world.state));
});

test('diplomacy remembers: an application from a known wrongdoer meets a colder answer', () => {
  const world = soloWorld('diplomacy-memory', { cooperation: 0.45 });
  const hall = (state: SaveState) => {
    const targets = { ...getEspionageTargets(state.espionage) };
    targets[world.planetA] = { ...targets[world.planetA]!, buildings: { ...targets[world.planetA]!.buildings, 'planetary-government': 1 } };
    return { ...state, espionage: { ...state.espionage!, targets } };
  };
  const state = hall(world.state);
  const memberCommand: SaveState['command'] = { ...state.command,
    alliances: [{ id: 'all', name: 'A', tag: 'AA', motto: '', description: '', emblem: state.command.alliances[0]?.emblem, leaderOwnerId: world.a, createdAt: START,
      members: [{ ownerId: world.a, displayName: 'x', role: 'leader', joinedAt: START }] } as never],
    applications: [{ id: 'app', allianceId: 'all', ownerId: world.b, displayName: 'b', status: 'pending', createdAt: START } as never] };
  const open: SaveState = { ...state, command: memberCommand };
  const kind = (candidateState: SaveState) => getNpcDiplomacyCandidates(candidateState, candidateState.npc!.profiles[world.a]!, START)
    .find((candidate) => candidate.id.includes('application'))?.kind;
  assert.equal(kind(open), 'accept-application');
  const report = { attacker: { playerId: world.b }, defender: { playerId: world.a }, winner: 'attacker', missionType: 'attack' } as unknown as BattleReport;
  let hurt = open;
  for (let index = 0; index < 5; index += 1) hurt = recordNpcBattleRelations(hurt, report, START, 5_000_000);
  assert.equal(kind(hurt), 'reject-application');
});

test('T-STYLE-02: robbed alike, different people draw different conclusions, and it shows in their style', () => {
  const world = soloWorld('reactions');
  const profile = world.state.npc!.profiles[world.a]!;
  const kinds = new Set<string>();
  const shapes = [
    { aggression: 0.1, riskTolerance: 0.1, planningHorizon: 0.9, economyFocus: 0.2, cooperation: 0.1, socialStyle: 0.1 },
    { aggression: 0.05, riskTolerance: 0.4, planningHorizon: 0.1, economyFocus: 1, cooperation: 0.1, socialStyle: 0.1 },
    { aggression: 1, riskTolerance: 1, planningHorizon: 0.1, economyFocus: 0.1, cooperation: 0.1, socialStyle: 0.1 },
    { aggression: 0.1, riskTolerance: 0.5, planningHorizon: 0.1, economyFocus: 0.1, cooperation: 1, socialStyle: 1 },
  ];
  for (const traits of shapes) kinds.add(chooseNpcRobberyReaction({ ...profile, traits: { ...profile.traits, ...traits } }, { grudge: 0.8, fearOfOffender: 0, bestFriend: 0.6 }, START));
  assert.equal(kinds.size, 4, [...kinds].join());
  // Same character, same blows, different owner seed: still not a copy across many.
  const owners = Object.values(world.state.npc!.profiles).map((item) => chooseNpcRobberyReaction({ ...item, traits: { ...item.traits, aggression: 0.5, riskTolerance: 0.5, economyFocus: 0.5, cooperation: 0.5, socialStyle: 0.5, planningHorizon: 0.5 } }, { grudge: 0.3, fearOfOffender: 0, bestFriend: 0 }, START));
  assert.ok(new Set(owners).size >= 2, owners.join());
  // Being attacked no longer means the fortress for everyone.
  const report = { attacker: { playerId: world.target }, defender: { playerId: world.a }, winner: 'attacker', missionType: 'attack' } as unknown as BattleReport;
  const state: SaveState = { ...recordNpcBattleRelations(world.state, report, START, 1_000), npcStrategy: { version: 1, plans: {}, outcomes: {}, nextCheckAt: {}, reactions: { [world.a]: { kind: 'counter', offender: world.target, since: START, until: START + HOUR } } } };
  assert.deepEqual(npcReactionStyle(state, world.a, START + 1), { style: 'fleet', reason: 'robbed-counter' });
  const context = { ...createNpcUtilityContext(state, profile, START + 1, 1), threat: 1 };
  assert.equal(readNpcPlayStyle(state, profile, context, strategyOf(context)).style, 'fleet');
  assert.equal(readNpcPlayStyle(state, profile, { ...context, at: START + 2 * HOUR }, strategyOf(context)).style, 'fortress', 'once it has passed, the old reflex');
  assert.equal(createNpcUtilityContext(state, profile, START + 1, 1).counterOffender, world.target, 'it holds it against the one it blames');
});

/* ---------------------------------------------------------- save, journal, series */

test('everything survives a save and reload; a bad section is dropped whole, not half-trusted', () => {
  const world = soloWorld('pact-save');
  const state = agreed(world);
  const storage = new Map<string, string>();
  const persistence = createPersistenceFacade({ mode: 'production', saveKey: 'pacts',
    storage: { getItem: (key) => storage.get(key) ?? null, setItem: (key, value) => { storage.set(key, value); }, removeItem: (key) => { storage.delete(key); } },
    now: () => START });
  assert.equal(persistence.write(state).ok, true);
  const loaded = persistence.load();
  assert.equal(loaded.status, 'loaded');
  if (loaded.status === 'loaded') assert.deepEqual(loaded.state.npcStrategy, state.npcStrategy);
  assert.ok(migrateNpcStrategyState(state.npcStrategy));
  assert.equal(migrateNpcStrategyState({ ...state.npcStrategy, relations: { x: [{ to: '' }] } }), undefined);
  assert.equal(migrateNpcStrategyState({ ...state.npcStrategy, proposals: [{ nonsense: true }] }), undefined);
  // A save from before stage E passes as it was.
  assert.ok(migrateNpcStrategyState({ version: 1, plans: {}, outcomes: {}, nextCheckAt: {} }));
});

test('a world with agreements plays the same in slices and across reloads', () => {
  const world = soloWorld('pact-replay');
  const targetAt = START + 7 * HOUR;
  const start = freezeNpcCatchupTarget(world.state, targetAt);
  const drain = (reload: boolean) => {
    let state = start;
    for (let guard = 0; isNpcCatchupPending(state); guard += 1) {
      assert.ok(guard < 2_000, 'catch-up must finish');
      state = reconcileRuntime(state, { planetId: state.currentPlanetId, now: targetAt, mode: 'production', testTimeScale: 1, replayMaxGroups: 64 }).state;
      if (reload) {
        const facade = createPersistenceFacade({ mode: 'production', storage: memoryStorage(), saveKey: 'asterion.npc-pacts.test', now: () => targetAt });
        assert.equal(facade.write(state).ok, true);
        const loaded = facade.load();
        assert.equal(loaded.status, 'loaded');
        if (loaded.status === 'loaded') state = loaded.state;
      }
    }
    return state;
  };
  const straight = drain(false);
  const reloaded = drain(true);
  assert.ok(proposals(straight).length > 0, 'nothing was agreed: this world tests nothing');
  assert.deepEqual(JSON.parse(JSON.stringify(reloaded.npcStrategy)), JSON.parse(JSON.stringify(straight.npcStrategy)));
  assert.deepEqual(JSON.parse(JSON.stringify(reloaded.npc)), JSON.parse(JSON.stringify(straight.npc)));
  assert.deepEqual(JSON.parse(JSON.stringify(reloaded.flights.records)), JSON.parse(JSON.stringify(straight.flights.records)));
});

test('the journal only watches: agreements appear there and the world is the same without it', () => {
  const world = soloWorld('pact-journal');
  const plain = agreed(world);
  const recorder = new NpcJournalRecorder();
  const previous = setNpcJournalSink(recorder);
  let watched: SaveState;
  try { watched = agreed(world); } finally { setNpcJournalSink(previous); }
  assert.deepEqual(watched!.npcStrategy, plain.npcStrategy);
  const lines = recorder.take().filter((entry) => entry.k === 'pact');
  assert.ok(lines.some((entry) => entry.d?.ev === 'proposed'));
  assert.ok(lines.some((entry) => entry.d?.ev === 'accepted'));
  journalNpcPact(0, 'x', 'noop', jointOf(plain)!);
});

test('old scores and old trust go on: a campaign folds its relations into the series, the next round starts from them', () => {
  const world = soloWorld('pact-series');
  let state = agreed(world);
  const id = jointOf(state)!.proposalId;
  state = recordNpcPactArrival(state, id, world.a, { at: START + HOUR, won: true, gain: 1, loss: 1 });
  state = recordNpcPactArrival(state, id, world.b, { at: START + HOUR, won: true, gain: 1, loss: 1 });
  // And a third owner betrayed the first.
  const third = Object.keys(state.npc!.profiles).find((ownerId) => ![world.a, world.b, world.target].includes(ownerId))!;
  state = recordNpcRelation(state, world.a, third, { kind: 'betrayed' }, START + HOUR);
  const noInherited = (next: SaveState) => ({ ...next, npc: { ...next.npc!, profiles: Object.fromEntries(Object.entries(next.npc!.profiles).map(([ownerId, profile]) => { const { inherited: _gone, ...rest } = profile; return [ownerId, rest]; })) as SaveState['npc'] extends infer N ? N extends { profiles: infer P } ? P : never : never } });
  const fold = settleCampaign(createPersonaRegistry(), noInherited(state), 'gate', START + 2 * HOUR)!;
  assert.equal(fold.changed, true);
  const series = findSeries(fold.registry, fold.seriesId)!;
  const relationOf = (ownerA: string) => series.personas.flatMap((persona) => persona.relations).filter((relation) => relation.jointOps > 0 && ownerA);
  assert.ok(relationOf(world.a).length >= 2, 'both remember the operation');
  assert.ok(relationOf(world.a).every((relation) => relation.trust > 0 && (relation.reliability ?? 0) > 0.5));
  const bitter = series.personas.flatMap((persona) => persona.relations).find((relation) => relation.resentment > 0.3);
  assert.ok(bitter, 'the betrayal stayed');
  // The new world starts from these, less sure; no agreement or plan comes with them.
  const base = createDefaultNewGameConfig({ seed: 'pact-series-2', factionId: 'aegis', playerName: 'Pacts' });
  const fresh = createInitialSaveState('production', START, { ...base, world: { ...base.world, npcCount: 7, campaignSpeed: 'standard' as const } });
  const bound = bindNewCampaignToSeries(fold.registry, fold.seriesId, fresh, START)!;
  assert.equal(bound.state.npcStrategy, undefined, 'plans, agreements and gifts do not carry over');
  const seeds = Object.values(bound.state.npc!.profiles).flatMap((profile) => Object.values(profile.inherited?.relations ?? {}));
  assert.ok(seeds.some((relation) => relation.trust > 0 && (relation.reliability ?? 0) > 0.5));
  assert.ok(seeds.some((relation) => relation.resentment > 0));
  // The series knows this campaign once.
  assert.equal(settleCampaign(fold.registry, noInherited(state), 'gate', START + 3 * HOUR)!.changed, false);
  assert.equal(campaignIdFromSalt(state.npc!.personaSalt).startsWith('c-'), true);
});

test('a player\'s transport to an NPC is remembered by what it took, through the ordinary arrival', () => {
  const world = soloWorld('player-transport');
  const player = world.state.profile.playerId;
  const planetId = Object.keys(world.state.planets)[0]!;
  const planet = getEspionageTargets(world.state.espionage)[world.planetA]!;
  const flight = { id: 'player-gift', requestId: 'player-gift', ownerSide: 'player', ownerId: player, missionId: 'transport', phase: 'outbound', originPlanetId: planetId,
    originCoordinate: { galaxy: 1, system: 1, position: 1 }, destinationCoordinate: { ...planet.coordinate }, destinationPlanetId: planet.id, destination: { kind: 'planet', planetId: planet.id, coordinate: { ...planet.coordinate } },
    selectedShips: { transporter: 10 }, selectedCommanders: {}, departedAt: START, arrivalAt: START + MINUTE, oneWayDurationMs: MINUTE, gasCost: 1, cargo: { metal: 100_000, minerals: 0, gas: 0, debris: 0 }, cargoState: 'loaded',
    targetRelation: 'neutral', destinationOwnerId: world.a };
  const state: SaveState = { ...world.state, flights: { ...world.state.flights, records: [...world.state.flights.records, flight as never] } };
  const next = reconcileFlights(state, START + 2 * MINUTE, () => 0.5, { mode: 'production', testTimeScale: 1 }).state;
  const view = npcRelationView(next, next.npc!.profiles[world.a]!, player, START + 2 * MINUTE);
  assert.ok(view && view.helpReceived > 0 && view.helpReceived <= 100_000, JSON.stringify(view));
});
