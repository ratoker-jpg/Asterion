import assert from 'node:assert/strict';
import test from 'node:test';

import { createDefaultNewGameConfig } from '../domain/world/config.ts';
import { getEspionageTargets } from '../domain/espionage/runtime.ts';
import type { SpyReportSnapshot, SpyTargetState } from '../domain/espionage/types.ts';
import type { NpcProfile, NpcTraits } from '../domain/npc/types.ts';
import { OVERPOPULATION_WINDOW_MS } from '../domain/fleet/overpopulation.ts';
import { recordNpcGrievance } from '../domain/npc/grudges.ts';
import { parseCrest } from '../domain/command/crest.ts';
import { createInitialSaveState, createPersistenceFacade } from './persistence.ts';
import { dispatchNpcDeployment, dispatchNpcMission, npcDeploymentFreeCapacity } from './npc-missions.ts';
import { reconcileFlights } from './flights.ts';
import { assessNpcPlanetThreat, npcStayThreshold } from './npc-threat.ts';
import type { BattleReport } from '../domain/combat/report.ts';
import { dispatchNpcLootWaves } from './npc-loot-wave.ts';
import { createNpcUtilityContext, chooseNpcAttackForce, npcForcePower, estimateRaidEconomics, estimateRevengeEconomics, estimateAttackUtility, estimateEspionageUtility, npcAttackIntel, npcRecyclerDeficit } from './npc-utility.ts';
import { getNpcMissionCandidates } from './npc-mission-policy.ts';
import { seedNpcGrudgesFromReports } from './npc-grudges.ts';
import { applyNpcAllianceHeraldry, npcAllianceEmblem, npcColonyName, npcColonySkin, npcNamingStyle } from './npc-identity.ts';
import type { SaveState } from './contracts.ts';
import { withAttackEligiblePoints } from './attack-eligibility.test-support.ts';

const START = Date.UTC(2026, 9, 27, 12);

function makeCampaign(seed: string, npcCount = 3): SaveState {
  const base = createDefaultNewGameConfig({ seed, factionId: 'aegis', playerName: 'NPC behaviour' });
  return createInitialSaveState('production', START, { ...base, world: { ...base.world, npcCount, campaignSpeed: 'standard' as const } });
}

function npcTargets(state: SaveState): SpyTargetState[] {
  return Object.values(getEspionageTargets(state.espionage))
    .filter((target) => target.kind === 'npc' && target.ownerId !== state.profile.playerId)
    .sort((left, right) => left.id.localeCompare(right.id));
}

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
  };
}

function saveReload(state: SaveState, saveKey: string): SaveState {
  const persistence = createPersistenceFacade({ mode: 'production', storage: memoryStorage(), saveKey, now: () => START });
  const written = persistence.write(state);
  assert.equal(written.ok, true, written.ok ? undefined : written.error);
  const loaded = persistence.load();
  if (loaded.status !== 'loaded') assert.fail('problem' in loaded ? JSON.stringify(loaded.problem) : 'save was missing after write');
  return loaded.state;
}

function withTarget(state: SaveState, target: SpyTargetState): SaveState {
  return { ...state, espionage: { ...state.espionage!, targets: { ...getEspionageTargets(state.espionage), [target.id]: target } } };
}

function withShips(state: SaveState, planetId: string, ships: Record<string, number>): SaveState {
  const target = getEspionageTargets(state.espionage)[planetId]!;
  return withTarget(state, { ...target, fleet: { ...target.fleet, ships: { ...target.fleet.ships, ...ships } } });
}

function withEspionage(state: SaveState, ownerId: string, level: number): SaveState {
  const science = state.npcScience?.owners[ownerId];
  let next = state;
  if (science) next = { ...next, npcScience: { ...next.npcScience!, owners: { ...next.npcScience!.owners, [ownerId]: { ...science, levels: { ...science.levels, 5: level } } } } };
  for (const target of npcTargets(next).filter((item) => item.ownerId === ownerId)) {
    next = withTarget(next, { ...target, ownerProfile: { ...(target.ownerProfile ?? { shipLevels: {}, commanderLevels: {} }), scienceLevels: { ...(target.ownerProfile?.scienceLevels ?? {}), 5: level } } as SpyTargetState['ownerProfile'] });
  }
  return next;
}

function withTraits(state: SaveState, ownerId: string, traits: Partial<NpcTraits>): SaveState {
  const profile = state.npc!.profiles[ownerId]!;
  return { ...state, npc: { ...state.npc!, profiles: { ...state.npc!.profiles, [ownerId]: { ...profile, traits: { ...profile.traits, ...traits } } } } };
}

function profileOf(state: SaveState, ownerId: string): NpcProfile {
  return state.npc!.profiles[ownerId]!;
}

/** One attacker planet sends `ships` at the defender planet; both owners are mutually admissible. */
function incomingAttack(state: SaveState, attacker: SpyTargetState, defender: SpyTargetState, ships: Record<string, number>, requestId: string) {
  const armed = withAttackEligiblePoints(withShips(state, attacker.id, ships), [attacker.ownerId, defender.ownerId], 1_000);
  const sent = dispatchNpcMission(armed, {
    ownerId: attacker.ownerId, originPlanetId: attacker.id, requestId, missionId: 'attack', selectedShips: ships,
    destination: { kind: 'planet', planetId: defender.id, coordinate: defender.coordinate }, targetPlanetId: defender.id,
  }, START, 1);
  assert.equal(sent.ok, true, sent.reason ?? undefined);
  return { state: sent.state, flight: sent.flight! };
}

function assess(state: SaveState, defender: SpyTargetState, at = START + 1) {
  const profile = profileOf(state, defender.ownerId);
  const context = createNpcUtilityContext(state, profile, at, 1);
  return assessNpcPlanetThreat(state, context, getEspionageTargets(state.espionage)[defender.id]!, 1);
}

const CAUTIOUS: Partial<NpcTraits> = { aggression: 0, riskTolerance: 0 };
const AGGRESSIVE: Partial<NpcTraits> = { aggression: 1, riskTolerance: 1 };

test('a weak attack is no reason to leave: the defender keeps its fleet and fights', () => {
  const campaign = makeCampaign('npc-behaviour-weak');
  const [attacker, defender] = npcTargets(campaign);
  let state = withShips(campaign, defender.id, { cruiser: 40 });
  state = withEspionage(withTraits(state, defender.ownerId, CAUTIOUS), defender.ownerId, 10);
  const launched = incomingAttack(state, attacker, defender, { scout: 2 }, 'npc-autonomy:behaviour:weak');
  const threat = assess(launched.state, defender);
  assert.ok(threat);
  assert.equal(threat.incoming[0]?.basis, 'composition');
  assert.equal(threat.decision, 'fight', 'even the most cautious owner stays against two scouts');
});

test('character decides against a slightly stronger attack: cautious leaves, aggressive fights', () => {
  const campaign = makeCampaign('npc-behaviour-character');
  const [attacker, defender] = npcTargets(campaign);
  const bare = getEspionageTargets(campaign.espionage)[defender.id]!;
  const base = withTarget(campaign, { ...bare, fleet: { ...bare.fleet, ships: { cruiser: 20 } as SpyTargetState['fleet']['ships'] },
    defense: { ...bare.defense, defenses: {} as SpyTargetState['defense']['defenses'] } });
  // About 1.15× the defender's strength (races differ), composition seen from espionage 10.
  const own = npcForcePower(defender.raceId, { cruiser: 20 });
  const perCruiser = npcForcePower(attacker.raceId, { cruiser: 1 });
  const launched = incomingAttack(base, attacker, defender, { cruiser: Math.round(1.15 * own / perCruiser) }, 'npc-autonomy:behaviour:character');
  const cautious = assess(withEspionage(withTraits(launched.state, defender.ownerId, CAUTIOUS), defender.ownerId, 10), defender)!;
  const aggressive = assess(withEspionage(withTraits(launched.state, defender.ownerId, AGGRESSIVE), defender.ownerId, 10), defender)!;
  assert.ok(npcStayThreshold({ ...profileOf(launched.state, defender.ownerId).traits, ...CAUTIOUS } as NpcTraits)
    > npcStayThreshold({ ...profileOf(launched.state, defender.ownerId).traits, ...AGGRESSIVE } as NpcTraits));
  assert.equal(cautious.decision, 'evacuate', JSON.stringify({ win: cautious.winProbability, stay: cautious.stayThreshold }));
  assert.equal(aggressive.decision, 'fight', JSON.stringify({ win: aggressive.winProbability, stay: aggressive.stayThreshold, d: aggressive.defence, f: aggressive.feared }));
  assert.ok(aggressive.winProbability < 0.5, 'the aggressive owner fights although the enemy is stronger');
});

test('below espionage 10 the composition never leaks into the defender\'s judgement', () => {
  const campaign = makeCampaign('npc-behaviour-espionage');
  const [attacker, defender] = npcTargets(campaign);
  const small = incomingAttack(campaign, attacker, defender, { scout: 1 }, 'npc-autonomy:behaviour:small');
  const large = incomingAttack(campaign, attacker, defender, { scout: 1, cruiser: 60 }, 'npc-autonomy:behaviour:large');
  // Same public facts in both worlds: the attacker's rating is pinned to the same points.
  const atNine = (state: SaveState) => assess(withEspionage(state, defender.ownerId, 9), defender)!;
  const nineSmall = atNine(small.state);
  const nineLarge = atNine(large.state);
  assert.equal(nineSmall.incoming[0]?.basis, 'rating');
  assert.equal(nineSmall.feared, nineLarge.feared, 'at level 9 a scout and a fleet look the same');
  assert.equal(nineSmall.decision, nineLarge.decision);
  const atTen = (state: SaveState) => assess(withEspionage(state, defender.ownerId, 10), defender)!;
  assert.equal(atTen(small.state).incoming[0]?.basis, 'composition');
  assert.ok(atTen(large.state).feared > atTen(small.state).feared * 10, 'from level 10 the real composition is read');
});

test('parallel deployments reinforce a planet before a visible attack; each is checked against the hangar as the player\'s is', () => {
  const campaign = makeCampaign('npc-behaviour-deploy', 2);
  const [attacker, defender] = npcTargets(campaign);
  // Two more planets of the defender's owner next door, each with a fleet.
  const colonies = [1, 2].map((offset): SpyTargetState => ({
    ...defender, id: `${defender.id}-test-colony-${offset}`, name: `Test ${offset}`,
    coordinate: { ...defender.coordinate, position: defender.coordinate.position === 1 ? 1 + offset : Math.max(1, defender.coordinate.position - offset) },
    fleet: { ...defender.fleet, ships: { ...defender.fleet.ships, cruiser: 6 } },
  }));
  let state = colonies.reduce(withTarget, withShips(campaign, defender.id, { cruiser: 2 }));
  state = withEspionage(withTraits(state, defender.ownerId, { aggression: 0.5, riskTolerance: 0.5 }), defender.ownerId, 10);
  const free = npcDeploymentFreeCapacity(getEspionageTargets(state.espionage)[defender.id]!);
  assert.ok(free >= 42 && free < 84, `hangar room ${free} should hold one colony fleet but not both`);

  // The attack comes from far away, so help from next door can land first.
  const far = { ...attacker, coordinate: { ...attacker.coordinate, galaxy: defender.coordinate.galaxy === 1 ? 2 : 1 } };
  const launched = incomingAttack(withTarget(state, far), far, defender, { cruiser: 9 }, 'npc-autonomy:behaviour:deploy-attack');
  const threat = assess(launched.state, defender)!;
  assert.equal(threat.decision, 'reinforce', `win ${threat.winProbability} → ${threat.reinforcedWinProbability}`);
  assert.equal(threat.reinforcements.length, 2);
  for (const source of threat.reinforcements) assert.ok(source.arrivalAt <= threat.arrivalAt - 60_000, 'the help lands before the attack');

  let next = launched.state;
  for (const source of threat.reinforcements) {
    const sent = dispatchNpcDeployment(next, { requestId: `npc-autonomy:behaviour:deploy:${source.originPlanetId}`, ownerId: defender.ownerId,
      originPlanetId: source.originPlanetId, destinationPlanetId: defender.id, selectedShips: source.ships }, START + 1, 1);
    assert.equal(sent.ok, true, sent.reason ?? undefined);
    next = sent.state;
  }
  // A third deployment bigger than the room left now is refused: no building past the limit.
  const tooBig = dispatchNpcDeployment(withShips(next, colonies[0]!.id, { cruiser: 30 }), { requestId: 'npc-autonomy:behaviour:deploy:too-big',
    ownerId: defender.ownerId, originPlanetId: colonies[0]!.id, destinationPlanetId: defender.id, selectedShips: { cruiser: 30 } }, START + 1, 1);
  assert.equal(tooBig.ok, false);
  assert.equal(tooBig.reason, 'capacity-exceeded');

  next = saveReload(next, 'npc-behaviour-deploy');
  const firstLanding = Math.min(...threat.reinforcements.map((source) => source.arrivalAt));
  const lastLanding = Math.max(...threat.reinforcements.map((source) => source.arrivalAt));
  next = reconcileFlights(next, lastLanding, () => 0.5, { mode: 'production', testTimeScale: 1 }).state;
  const landed = getEspionageTargets(next.espionage)[defender.id]!;
  assert.equal(landed.fleet.ships.cruiser, 2 + threat.reinforcements.reduce((sum, source) => sum + (source.ships.cruiser ?? 0), 0));
  assert.ok(landed.overpopulation?.blocked, 'the overfilled hangar opens the overpopulation window');
  assert.equal(landed.overpopulation?.episodeStartedAt, firstLanding, 'the window starts at the landing, not at a later settlement');
  assert.ok(threat.arrivalAt - firstLanding < OVERPOPULATION_WINDOW_MS);
});

function spyReport(owner: SpyTargetState, target: SpyTargetState, fleet: Record<string, number>, at: number): SpyReportSnapshot {
  return {
    id: `spy-report-test-${owner.ownerId}-${target.id}`, missionId: `spy-test-${target.id}`, ownerId: owner.ownerId, createdAt: at,
    sourcePlanetId: owner.id, targetPlanetId: target.id, targetPlanetName: target.name, targetOwnerId: target.ownerId,
    targetOwnerName: target.ownerName, targetRaceId: target.raceId, targetRelation: 'neutral', targetCoordinate: { ...target.coordinate },
    spyLevel: 10, targetEspionageLevel: 0, delta: 10, roll: 50, quality: 'full', firstReport: true,
    resources: { metal: 1_000, minerals: 1_000, gas: 1_000, debris: 0, developmentEnergy: 0 },
    defense: {}, fleet, fleetLevels: {}, commanders: {}, population: { total: 0, fleet: 0, defense: 0 },
  } as unknown as SpyReportSnapshot;
}

test('an attack is remembered until the end of the match and survives save and load; old saves rebuild it from reports', () => {
  const campaign = makeCampaign('npc-behaviour-grudge');
  const [attacker, defender] = npcTargets(campaign);
  const state = withShips(campaign, defender.id, { scout: 5 });
  const launched = incomingAttack(state, attacker, defender, { cruiser: 10 }, 'npc-autonomy:behaviour:grudge');
  const fought = reconcileFlights(launched.state, launched.flight.arrivalAt, () => 0.5, { mode: 'production', testTimeScale: 1 }).state;
  const grudge = profileOf(fought, defender.ownerId).grudges?.[attacker.ownerId];
  assert.ok(grudge, 'the defender remembers its attacker');
  assert.equal(grudge.attacks, 1);
  assert.ok(grudge.damage > 0, 'the lost scouts are counted');
  assert.equal(profileOf(fought, attacker.ownerId).grudges?.[defender.ownerId], undefined, 'the attacker has nothing to avenge');

  // A second visit of the same reconcile does not count the battle twice.
  const again = reconcileFlights(fought, launched.flight.arrivalAt, () => 0.5, { mode: 'production', testTimeScale: 1 }).state;
  assert.equal(profileOf(again, defender.ownerId).grudges?.[attacker.ownerId]?.attacks, 1);

  const reloaded = saveReload(fought, 'npc-behaviour-grudge');
  assert.deepEqual(profileOf(reloaded, defender.ownerId).grudges, profileOf(fought, defender.ownerId).grudges);

  // An older save had no memory: it is rebuilt from the battle report the save still holds.
  const { grudges: _dropped, ...legacyProfile } = profileOf(fought, defender.ownerId);
  const legacy = { ...fought, npc: { ...fought.npc!, profiles: { ...fought.npc!.profiles, [defender.ownerId]: legacyProfile as NpcProfile } } };
  const seeded = seedNpcGrudgesFromReports(legacy);
  assert.equal(profileOf(seeded, defender.ownerId).grudges?.[attacker.ownerId]?.attacks, 1);
  assert.equal(profileOf(seeded, defender.ownerId).grudges?.[attacker.ownerId]?.damage, grudge.damage);
  assert.equal(profileOf(saveReload(legacy, 'npc-behaviour-grudge-legacy'), defender.ownerId).grudges?.[attacker.ownerId]?.attacks, 1);
});

test('revenge never sends a losing attack (owner rule 04.11.2026); it only ranks profitable ones, and never past the attack rule', () => {
  const campaign = makeCampaign('npc-behaviour-revenge');
  const [avenger, offender] = npcTargets(campaign);
  let state = withShips(campaign, avenger.id, { cruiser: 30 });
  state = withShips(state, offender.id, { cruiser: 36 });
  state = withTraits(state, avenger.ownerId, { riskTolerance: 0.5, aggression: 0.5 });
  state = { ...state, espionage: { ...state.espionage!, reports: [...state.espionage!.reports,
    spyReport(avenger, getEspionageTargets(state.espionage)[offender.id]!, { cruiser: 36 }, START)] } };
  state = withAttackEligiblePoints(state, [avenger.ownerId, offender.ownerId], 1_000);
  const origin = getEspionageTargets(state.espionage)[avenger.id]!;
  const report = state.espionage!.reports.at(-1)!;

  const calm = createNpcUtilityContext(state, profileOf(state, avenger.ownerId), START + 1, 1);
  assert.equal(chooseNpcAttackForce(calm, origin, offender.id, origin.fleet.ships), null, 'without a grudge the owner does not attack a stronger planet');

  const hurt = recordNpcGrievance(profileOf(state, avenger.ownerId), offender.ownerId, 3 * calm.dayValue, START - 3_600_000, 'battle-test-1');
  const angry = recordNpcGrievance(hurt, offender.ownerId, 3 * calm.dayValue, START - 1_800_000, 'battle-test-2');
  state = { ...state, npc: { ...state.npc!, profiles: { ...state.npc!.profiles, [avenger.ownerId]: angry } } };
  const context = createNpcUtilityContext(state, angry, START + 1, 1);
  const force = chooseNpcAttackForce(context, origin, offender.id, origin.fleet.ships);
  assert.ok(force, 'a grudge lowers the margin the owner asks for, down to even odds and no further');
  assert.equal(estimateRaidEconomics(context, origin, report, force).worthFlight, false, 'as a raid it does not pay');
  const revenge = estimateRevengeEconomics(context, origin, report, force);
  assert.ok(revenge.damage > 0);
  assert.equal(estimateAttackUtility(context, origin, offender.id, force), -2, 'a grudge does not turn a losing raid into an option');
  // A force that cannot break the known defence is never sent, grudge or not.
  const outgunned = chooseNpcAttackForce(context, origin, offender.id, { cruiser: 10 });
  assert.equal(outgunned, null, 'revenge no longer throws the whole fleet at a stronger defence');
  assert.ok(getNpcMissionCandidates(state, angry, START + 1).some((candidate) => candidate.kind === 'attack'
    && candidate.payload.destinationPlanetId === offender.id), 'the offender is a candidate target');

  // The offender falls outside ×0.5–×2 of the avenger's points: the attack rule wins over revenge.
  const outOfBand = withAttackEligiblePoints(state, [offender.ownerId], 5_000);
  assert.equal(getNpcMissionCandidates(outOfBand, angry, START + 1).some((candidate) => candidate.kind === 'attack'
    && candidate.payload.destinationPlanetId === offender.id), false);
  const refused = dispatchNpcMission(outOfBand, { ownerId: avenger.ownerId, originPlanetId: avenger.id, requestId: 'npc-autonomy:behaviour:revenge-refused',
    missionId: 'attack', selectedShips: force, destination: { kind: 'planet', planetId: offender.id, coordinate: offender.coordinate },
    targetPlanetId: offender.id }, START + 1, 1);
  assert.equal(refused.ok, false);
  assert.equal(refused.reason, 'attack-not-allowed');
});

test('owner 04.11.2026: a defended planet is not attacked, a lost fight refutes the report, old intel is spied again, a clearly weaker planet is raided', () => {
  const campaign = makeCampaign('npc-behaviour-suicide');
  const [raider, victim] = npcTargets(campaign);
  const rich = { metal: 2_000_000, minerals: 2_000_000, gas: 2_000_000, debris: 0, developmentEnergy: 0 };
  const seen = (fleet: Record<string, number>, at: number) => ({ ...spyReport(raider, getEspionageTargets(campaign.espionage)[victim.id]!, fleet, at), resources: rich });
  const base = (fleet: Record<string, number>, mine: Record<string, number>, at: number) => {
    let state = withShips(campaign, raider.id, mine);
    state = withTraits(state, raider.ownerId, { riskTolerance: 0.9, aggression: 0.95 });
    state = withAttackEligiblePoints(state, [raider.ownerId, victim.ownerId], 20_000);
    const report = seen(fleet, at);
    return { state: { ...state, espionage: { ...state.espionage!, reports: [...state.espionage!.reports, report] } }, report };
  };
  const origin = (state: SaveState) => getEspionageTargets(state.espionage)[raider.id]!;
  const hurt = (state: SaveState) => {
    const profile = profileOf(state, raider.ownerId);
    const angry = recordNpcGrievance(recordNpcGrievance(profile, victim.ownerId, 3 * 96_000, START - 3_600_000, 'battle-sd-1'), victim.ownerId, 3 * 96_000, START - 1_800_000, 'battle-sd-2');
    return { state: { ...state, npc: { ...state.npc!, profiles: { ...state.npc!.profiles, [raider.ownerId]: angry } } }, angry };
  };

  // The defence is far stronger than the raider's fleet, and the raider is vengeful and bold: it never goes.
  const strong = base({ cruiser: 200 }, { cruiser: 30 }, START);
  const { state: angryState, angry } = hurt(strong.state);
  const strongContext = createNpcUtilityContext(angryState, angry, START + 1, 1);
  assert.equal(chooseNpcAttackForce(strongContext, origin(angryState), victim.id, origin(angryState).fleet.ships), null, 'no force breaks the known defence');
  assert.equal(estimateAttackUtility(strongContext, origin(angryState), victim.id, { cruiser: 30 }), -2);

  // Clearly stronger than a weak planet with fat stores: a fresh report carries the raid.
  const weak = base({ cruiser: 2 }, { cruiser: 60 }, START);
  const weakContext = createNpcUtilityContext(weak.state, profileOf(weak.state, raider.ownerId), START + 1, 1);
  const force = chooseNpcAttackForce(weakContext, origin(weak.state), victim.id, origin(weak.state).fleet.ships);
  assert.ok(force, 'the raider sees a win');
  assert.equal(estimateRaidEconomics(weakContext, origin(weak.state), weak.report, force).worthFlight, true);
  assert.equal(npcAttackIntel(weakContext, weak.report), 'fresh');

  // Old intel is stale: spy again, then decide. The urge to spy rises when an attack waits on it.
  const lateAt = START + 4 * 3_600_000;
  const late = createNpcUtilityContext(weak.state, profileOf(weak.state, raider.ownerId), lateAt, 1);
  assert.equal(npcAttackIntel(late, weak.report), 'stale');
  assert.ok(estimateEspionageUtility(late, victim.id, 0, victim.ownerId, true) > estimateEspionageUtility(late, victim.id, 0, victim.ownerId, false));

  // A lost attack on the planet after the report refutes it, however young the report is.
  const lost = { id: 'battle-sd-lost', timestamp: new Date(START + 1_000).toISOString(), missionType: 'attack', winner: 'defender',
    attacker: { playerId: raider.ownerId, playerName: 'a', side: 'attacker' }, defender: { playerId: victim.ownerId, playerName: 'd', side: 'defender',
      coordinates: `[${victim.coordinate.galaxy}:${victim.coordinate.system}:${victim.coordinate.position}]` } } as unknown as BattleReport;
  const beaten = { ...weak.state, combat: { ...weak.state.combat, reports: [...weak.state.combat.reports, lost] } };
  const refuted = createNpcUtilityContext(beaten, profileOf(beaten, raider.ownerId), START + 2_000, 1);
  assert.equal(npcAttackIntel(refuted, weak.report), 'refuted');
  const respied = { ...weak.report, createdAt: START + 3_000 };
  assert.equal(npcAttackIntel(createNpcUtilityContext(beaten, profileOf(beaten, raider.ownerId), START + 4_000, 1), respied), 'fresh', 'a report newer than the loss stands');
});

test('NPC colony names and looks: in the owner\'s style, without repeats, the same on every run', () => {
  const campaign = makeCampaign('npc-behaviour-names');
  const owner = npcTargets(campaign)[0]!;
  const profile = profileOf(campaign, owner.ownerId);
  const taken = new Set<string>();
  const worn = new Set<string>();
  const names: string[] = [];
  for (let position = 2; position <= 7; position += 1) {
    const coordinate = { galaxy: 1, system: 5, position };
    const name = npcColonyName(profile, coordinate, taken);
    const skin = npcColonySkin(profile, coordinate, worn);
    assert.equal(npcColonyName(profile, coordinate, taken), name, 'deterministic');
    assert.ok(!/^Колония/.test(name));
    assert.ok(!worn.has(skin), 'no look twice for one owner');
    assert.notEqual(skin, 'colonized');
    taken.add(name.toLocaleLowerCase('ru-RU'));
    worn.add(skin);
    names.push(name);
  }
  assert.equal(new Set(names).size, names.length, 'no name twice');
  assert.ok(['military', 'trade', 'science', 'frontier', 'mythic'].includes(npcNamingStyle(profile.traits)));

  // An older save: a legacy-named NPC colony gets a name and a look once, and keeps them.
  const legacyColony: SpyTargetState = { ...owner, id: 'planet-1-5-9', name: 'Колония 5-9', coordinate: { galaxy: 1, system: 5, position: 9 } };
  const legacy = withTarget(campaign, legacyColony);
  const first = getEspionageTargets(saveReload(legacy, 'npc-behaviour-names-1').espionage)['planet-1-5-9']!;
  assert.ok(!/^Колония/.test(first.name));
  assert.ok(first.skin && first.skin !== 'colonized');
  const second = getEspionageTargets(saveReload(saveReload(legacy, 'npc-behaviour-names-2'), 'npc-behaviour-names-3').espionage)['planet-1-5-9']!;
  assert.equal(second.name, first.name, 'stable between runs and loads');
  assert.equal(second.skin, first.skin);
  assert.equal(getEspionageTargets(saveReload(legacy, 'npc-behaviour-names-4').espionage)[owner.id]!.name, owner.name, 'homeworlds keep their names');
});

test('NPC alliance crests show the course, change only with a reason and are built in the player\'s constructor', () => {
  const campaign = makeCampaign('npc-behaviour-crest', 4);
  const [leader, member, rival] = npcTargets(campaign).filter((target, index, all) => all.findIndex((item) => item.ownerId === target.ownerId) === index);
  assert.ok(leader && member && rival);
  const aggressive = npcAllianceEmblem('alliance-a', { course: 'aggressive', leaderOwnerId: leader.ownerId, atWar: false });
  const trade = npcAllianceEmblem('alliance-a', { course: 'trade', leaderOwnerId: leader.ownerId, atWar: false });
  assert.ok(aggressive.crest && parseCrest(aggressive.crest), 'a valid constructor crest');
  assert.ok(['blades', 'trident', 'phoenix', 'leviathan'].includes(aggressive.crest.glyph));
  assert.ok(['compass', 'nexus', 'comet', 'crown'].includes(trade.crest!.glyph));
  assert.deepEqual(npcAllianceEmblem('alliance-a', { course: 'trade', leaderOwnerId: leader.ownerId, atWar: false }), trade, 'no change without a reason');
  const atWar = npcAllianceEmblem('alliance-a', { course: 'trade', leaderOwnerId: leader.ownerId, atWar: true });
  assert.equal(atWar.crest!.pattern, 'saltire');
  assert.equal(atWar.crest!.color, 'crimson');

  // Through the settings command: the leader sets it, then nothing changes until a reason comes.
  const memberRecord = (target: SpyTargetState) => ({ ownerId: target.ownerId, displayName: target.ownerName, joinedAt: START, lastActiveAt: START,
    deliveredUnits: 0, jointOperationCount: 0, tieBreaker: 0 });
  const alliance = {
    id: 'alliance-test-npc', name: 'Тестовый союз', tag: 'TST', motto: '', description: '',
    emblem: { glyph: 'starforge', accent: 'cyan' }, createdAt: START,
    leaderOwnerId: leader.ownerId, deputyOwnerId: null, leaderSince: START,
    members: [memberRecord(leader), memberRecord(member)],
  } as unknown as SaveState['command']['alliances'][number];
  const state = { ...campaign, command: { ...campaign.command, alliances: [alliance] } };
  const profiles = state.npc!.profiles;
  const crested = applyNpcAllianceHeraldry(state.command, leader.ownerId, profiles);
  const emblem = crested.alliances[0]!.emblem;
  assert.ok(emblem.crest, 'the leader builds a crest');
  assert.equal(applyNpcAllianceHeraldry(crested, leader.ownerId, profiles), crested, 'no reason, no change');
  assert.equal(applyNpcAllianceHeraldry(crested, member.ownerId, profiles), crested, 'an ordinary member cannot change it');
  // A new leader redraws it.
  const newLeader = { ...crested, alliances: [{ ...crested.alliances[0]!, leaderOwnerId: member.ownerId }] };
  const redrawn = applyNpcAllianceHeraldry(newLeader, member.ownerId, profiles);
  assert.notDeepEqual(redrawn.alliances[0]!.emblem, emblem);

  // An older save: the NPC-led alliance with the default emblem gets its crest at load, once.
  const loaded = saveReload(state, 'npc-behaviour-crest');
  assert.ok(loaded.command.alliances[0]!.emblem.crest);
  assert.deepEqual(saveReload(loaded, 'npc-behaviour-crest-2').command.alliances[0]!.emblem, loaded.command.alliances[0]!.emblem);
});

test('recyclers are ordered for the debris around and split over the richest fields', () => {
  const campaign = makeCampaign('npc-behaviour-recycle', 2);
  const owner = npcTargets(campaign)[0]!;
  const profile = profileOf(campaign, owner.ownerId);
  const field = (position: number, debris: number) => ({ coordinate: { ...owner.coordinate, position }, debris });
  const fields = [field(13, 400_000), field(14, 150_000)];
  const debrisState = { ...campaign, espionage: { ...campaign.espionage!, orbitalDebris: Object.fromEntries(fields.map((item, index) => [
    `test-field-${index}`, { id: `test-field-${index}`, targetPlanetId: `gone-${index}`, targetPlanetName: 'Ушедшая', targetOwnerId: 'gone',
      targetCoordinate: item.coordinate, debris: item.debris, createdAt: START }])) } } as SaveState;
  const withRecyclers = withShips(debrisState, owner.id, { recycler: 20 });
  const context = createNpcUtilityContext(withRecyclers, profile, START + 1, 1);
  assert.ok((context.nearbyDebris ?? 0) >= 550_000, `nearby debris ${context.nearbyDebris}`);
  // 20 recyclers × 40 000 carry more than a quarter of the debris: no more are wanted.
  assert.ok(npcRecyclerDeficit(context) <= 0);
  const short = createNpcUtilityContext(withShips(debrisState, owner.id, { recycler: 1 }), profile, START + 1, 1);
  assert.ok(npcRecyclerDeficit(short) > 0, 'one hull is not enough for this much debris');
  const candidates = getNpcMissionCandidates(withRecyclers, profile, START + 1).filter((candidate) => candidate.kind === 'recycle');
  const sent = candidates.map((candidate) => JSON.parse(String(candidate.payload.selectedShips)).recycler as number);
  assert.ok(candidates.length >= 2, 'both fields get recyclers');
  assert.equal(sent.reduce((sum, count) => sum + count, 0), 10 + 4, 'just enough hulls for each field (40 000 each)');
});

test('owner 05.11.2026: a raid sends a decisive force, and the cargo follows the battle fleet', () => {
  const campaign = makeCampaign('npc-behaviour-raid-force');
  const [raider, victim] = npcTargets(campaign);
  const rich = { metal: 4_000_000, minerals: 4_000_000, gas: 4_000_000, debris: 0, developmentEnergy: 0 };
  const prepare = (traits: Record<string, number>) => {
    let state = withShips(campaign, raider.id, { cruiser: 60, 'mega-transporter': 300 });
    state = withTraits(state, raider.ownerId, traits);
    state = withAttackEligiblePoints(state, [raider.ownerId, victim.ownerId], 20_000);
    const home = getEspionageTargets(state.espionage)[raider.id]!;
    state = { ...state, espionage: { ...state.espionage!, targets: { ...getEspionageTargets(state.espionage), [raider.id]: { ...home, resources: { ...home.resources, gas: 50_000_000 } } } } };
    const report = { ...spyReport(raider, getEspionageTargets(state.espionage)[victim.id]!, { cruiser: 20 }, START), resources: rich };
    state = { ...state, espionage: { ...state.espionage!, reports: [...state.espionage!.reports, report] } };
    return { state, report, origin: getEspionageTargets(state.espionage)[raider.id]! };
  };
  const careful = prepare({ riskTolerance: 0.1, aggression: 0.1 });
  const bold = prepare({ riskTolerance: 0.95, aggression: 0.95 });
  const sizeOf = (setup: ReturnType<typeof prepare>, online = false) => {
    const context = createNpcUtilityContext(setup.state, profileOf(setup.state, raider.ownerId), START + 1, 1);
    return chooseNpcAttackForce(context, setup.origin, victim.id, { cruiser: 60 }, online);
  };
  const small = sizeOf(careful)?.cruiser ?? 0;
  const large = sizeOf(bold)?.cruiser ?? 0;
  assert.ok(small >= 30, `a careful owner still sends a decisive force, not the bare minimum (${small})`);
  assert.ok(large >= 30 && large <= 60, `a bold owner sends a decisive force too, ${large} of 60`);
  assert.ok((sizeOf(careful, true)?.cruiser ?? 0) >= small, 'a planet whose owner is online gets no less');

  // The cargo follows the battle fleet: a second attack of holds only, landing after it.
  const context = createNpcUtilityContext(bold.state, profileOf(bold.state, raider.ownerId), START + 1, 1);
  const force = chooseNpcAttackForce(context, bold.origin, victim.id, { cruiser: 60 })!;
  const command = { ownerId: raider.ownerId, originPlanetId: raider.id, requestId: 'npc-autonomy:behaviour:raid-force', missionId: 'attack' as const,
    selectedShips: force, destination: { kind: 'planet' as const, planetId: victim.id, coordinate: victim.coordinate }, targetPlanetId: victim.id, targetRelation: 'neutral' as const };
  const sent = dispatchNpcMission(bold.state, command, START + 1, 1);
  assert.equal(sent.ok, true, sent.reason ?? '');
  const waves = dispatchNpcLootWaves(sent.state, command, sent.flight!, bold.report, false, START + 1, 1);
  const flights = waves.state.flights.records.filter((flight) => flight.missionId === 'attack');
  assert.ok(waves.waves > 0, 'the cargo is sent behind the battle fleet');
  {
    const follow = flights.find((flight) => flight.id !== sent.flight!.id)!;
    assert.equal(follow.selectedShips.cruiser, undefined, 'only holds follow');
    assert.ok((follow.selectedShips['mega-transporter'] ?? 0) > 100, 'mostly mega-transports');
    assert.ok(follow.arrivalAt >= sent.flight!.arrivalAt + 1_000, 'they land at least a second behind the battle fleet');
  }
  {
    // Owner 09.11.2026: holds that would land before (or with) the battle fleet are slowed to land a second behind it.
    const lateCombat = { ...sent.flight!, arrivalAt: sent.flight!.arrivalAt + 60_000 };
    const slowed = dispatchNpcLootWaves(sent.state, command, lateCombat, bold.report, false, START + 1, 1);
    assert.ok(slowed.waves > 0, 'the cargo still goes');
    const follow = slowed.state.flights.records.find((flight) => flight.missionId === 'attack' && flight.id !== sent.flight!.id)!;
    assert.ok((follow.speedPercent ?? 100) < 100, 'the holds fly slower');
    assert.ok(follow.arrivalAt >= lateCombat.arrivalAt + 1_000, 'and land at least a second behind the battle fleet');
    assert.ok(follow.arrivalAt <= lateCombat.arrivalAt + 10_000, 'but only just behind it (one percent of speed is a few seconds here)');
  }
});
