import assert from 'node:assert/strict';
import test from 'node:test';

import { createDefaultNewGameConfig } from '../domain/world/config.ts';
import { getEspionageTargets } from '../domain/espionage/runtime.ts';
import type { SpyReportSnapshot, SpyTargetState } from '../domain/espionage/types.ts';
import { recordNpcGrievance } from '../domain/npc/grudges.ts';
import { createShieldRecord } from '../domain/shield/shield.ts';
import { createInitialSaveState } from './persistence.ts';
import { dispatchNpcMission } from './npc-missions.ts';
import { applyNpcAutonomyAttention } from './npc-autonomy.ts';
import { createNpcUtilityContext, estimateRaidEconomics, npcAttackIntel, npcLootableResources } from './npc-utility.ts';
import { getNpcMissionCandidates } from './npc-mission-policy.ts';
import type { SaveState } from './contracts.ts';
import type { NpcTraits } from '../domain/npc/types.ts';
import { withAttackEligiblePoints } from './attack-eligibility.test-support.ts';

const START = Date.UTC(2026, 9, 27, 12);
const RICH = { metal: 4_000_000, minerals: 4_000_000, gas: 4_000_000, debris: 0, developmentEnergy: 0 };

function makeCampaign(seed: string): SaveState {
  const base = createDefaultNewGameConfig({ seed, factionId: 'aegis', playerName: 'Strong attacks' });
  return createInitialSaveState('production', START, { ...base, world: { ...base.world, npcCount: 3, campaignSpeed: 'standard' as const } });
}

const npcTargets = (state: SaveState): SpyTargetState[] => Object.values(getEspionageTargets(state.espionage))
  .filter((target) => target.kind === 'npc' && target.ownerId !== state.profile.playerId).sort((a, b) => a.id.localeCompare(b.id));

function withTarget(state: SaveState, target: SpyTargetState): SaveState {
  return { ...state, espionage: { ...state.espionage!, targets: { ...getEspionageTargets(state.espionage), [target.id]: target } } };
}

function withShips(state: SaveState, planetId: string, ships: Record<string, number>): SaveState {
  const target = getEspionageTargets(state.espionage)[planetId]!;
  return withTarget(state, { ...target, fleet: { ...target.fleet, ships: { ...target.fleet.ships, ...ships } } });
}

function spyReport(owner: SpyTargetState, target: SpyTargetState, fleet: Record<string, number>, at: number): SpyReportSnapshot {
  return {
    id: `spy-report-test-${owner.ownerId}-${target.id}-${at}`, missionId: `spy-test-${target.id}`, ownerId: owner.ownerId, createdAt: at,
    sourcePlanetId: owner.id, targetPlanetId: target.id, targetPlanetName: target.name, targetOwnerId: target.ownerId,
    targetOwnerName: target.ownerName, targetRaceId: target.raceId, targetRelation: 'neutral', targetCoordinate: { ...target.coordinate },
    spyLevel: 10, targetEspionageLevel: 0, delta: 10, roll: 50, quality: 'full', firstReport: true,
    resources: { ...RICH }, defense: {}, fleet, fleetLevels: {}, commanders: {}, population: { total: 0, fleet: 0, defense: 0 },
  } as unknown as SpyReportSnapshot;
}

/** A second planet of the victim, next to its first one, with its own fleet. */
function withSecondPlanet(state: SaveState, victim: SpyTargetState, fleet: Record<string, number>): { state: SaveState; second: SpyTargetState } {
  const taken = new Set(Object.values(getEspionageTargets(state.espionage))
    .filter((t) => t.coordinate.galaxy === victim.coordinate.galaxy && t.coordinate.system === victim.coordinate.system).map((t) => t.coordinate.position));
  const position = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15].find((value) => !taken.has(value))!;
  const second: SpyTargetState = { ...victim, id: `${victim.id}-b`, name: `${victim.name} II`, coordinate: { ...victim.coordinate, position },
    fleet: { ...victim.fleet, ships: { ...victim.fleet.ships, ...fleet } } };
  return { state: withTarget(state, second), second };
}

const BOLD: Partial<NpcTraits> = { aggression: 1, riskTolerance: 1, attention: 1 };

function prepare(seed: string, victimFleets: { main: Record<string, number>; second?: Record<string, number> }) {
  let state = makeCampaign(seed);
  const [raider, victimOrig] = npcTargets(state);
  const profile = state.npc!.profiles[raider!.ownerId]!;
  state = { ...state, npc: { ...state.npc!, profiles: { ...state.npc!.profiles, [raider!.ownerId]: { ...profile, traits: { ...profile.traits, ...BOLD } } } } };
  state = withShips(state, raider!.id, { cruiser: 120, 'mega-transporter': 300 });
  state = withShips(state, victimOrig!.id, victimFleets.main);
  const victim = getEspionageTargets(state.espionage)[victimOrig!.id]!;
  let second: SpyTargetState | undefined;
  if (victimFleets.second) {
    const added = withSecondPlanet(state, victim, victimFleets.second);
    state = added.state;
    second = added.second;
  }
  // A war drive: the raider holds a grudge against the victim, so its look turns to attacks.
  const angry = recordNpcGrievance(recordNpcGrievance(state.npc!.profiles[raider!.ownerId]!, victim.ownerId, 288_000, START - 3_600_000, 'strong-1'), victim.ownerId, 288_000, START - 1_800_000, 'strong-2');
  state = { ...state, npc: { ...state.npc!, profiles: { ...state.npc!.profiles, [raider!.ownerId]: angry } } };
  state = withAttackEligiblePoints(state, [raider!.ownerId, victim.ownerId], 20_000);
  const home = getEspionageTargets(state.espionage)[raider!.id]!;
  state = withTarget(state, { ...home, resources: { ...home.resources, gas: 50_000_000 } });
  const reports = [spyReport(home, victim, victimFleets.main, START), ...(second ? [spyReport(home, second, victimFleets.second!, START)] : [])];
  state = { ...state, espionage: { ...state.espionage!, reports: [...state.espionage!.reports, ...reports] } };
  return { state, raider: home, victim, second };
}

/** The look at the game repeats for a few minutes; returns the fleets that left to hit `planetIds`, cargo included. */
function lookRepeatedly(initial: SaveState, ownerId: string, planetIds: readonly string[], looks: number) {
  let state = initial;
  for (let index = 0; index < looks; index += 1) {
    const at = START + 1 + index * 20_000;
    const profile = state.npc!.profiles[ownerId]!;
    for (const decision of applyNpcAutonomyAttention(state, profile, `strong:${index}`, at, 1, 6)) state = decision.state;
  }
  const targets = getEspionageTargets(state.espionage);
  return state.flights.records.filter((flight) => flight.missionId === 'attack' && flight.ownerId === ownerId
    && planetIds.some((id) => targets[id]?.coordinate.system === flight.destinationCoordinate.system && targets[id]?.coordinate.position === flight.destinationCoordinate.position));
}

test('owner rule 06.11.2026: a bot hits a planet with one strong attack, not a trickle of small ones', () => {
  const { state, raider, victim } = prepare('strong-one-attack', { main: { cruiser: 20 } });
  const flights = lookRepeatedly(state, raider.ownerId, [victim.id], 12);
  const combat = flights.filter((flight) => (flight.selectedShips.cruiser ?? 0) > 0);
  assert.ok(combat.length >= 1, 'the bot attacks a rich, weakly held planet');
  assert.equal(combat.length, 1, `exactly one battle fleet in a short window, got ${combat.length}`);
  assert.ok(combat[0]!.selectedShips.cruiser! >= 40, `and it is a decisive force (${combat[0]!.selectedShips.cruiser})`);
});

test('a fresh look is needed before the same planet is hit again', () => {
  const { state, raider, victim } = prepare('strong-intel-spent', { main: { cruiser: 20 } });
  const sent = dispatchNpcMission(state, { ownerId: raider.ownerId, originPlanetId: raider.id, requestId: 'strong:spent', missionId: 'attack',
    selectedShips: { cruiser: 60 }, destination: { kind: 'planet', planetId: victim.id, coordinate: victim.coordinate }, targetPlanetId: victim.id, targetRelation: 'neutral' }, START + 1, 1);
  assert.equal(sent.ok, true, sent.reason ?? '');
  const profile = state.npc!.profiles[raider.ownerId]!;
  const report = state.espionage!.reports.find((item) => item.targetPlanetId === victim.id)!;
  assert.equal(npcAttackIntel(createNpcUtilityContext(state, profile, START + 2, 1), report), 'fresh');
  assert.equal(npcAttackIntel(createNpcUtilityContext(sent.state, profile, START + 2, 1), report), 'spent', 'a fleet on its way spends the old report');
  const newer = { ...report, id: 'spy-newer', createdAt: sent.flight!.arrivalAt + 1 };
  assert.equal(npcAttackIntel(createNpcUtilityContext({ ...sent.state, espionage: { ...sent.state.espionage!, reports: [...sent.state.espionage!.reports, newer] } },
    profile, newer.createdAt, 1), newer), 'fresh', 'a report made after the battle opens the next attack');
});

test('owner rule 06.11.2026: the weak planet of a target owner is hit, not only its main one', () => {
  const { state, raider, victim, second } = prepare('strong-weak-planet', { main: { cruiser: 90 }, second: { cruiser: 4 } });
  const flights = lookRepeatedly(state, raider.ownerId, [victim.id, second!.id], 12);
  const combat = flights.filter((flight) => (flight.selectedShips.cruiser ?? 0) > 0);
  assert.ok(combat.length >= 1, 'the bot attacks');
  const first = [...combat].sort((left, right) => left.departedAt - right.departedAt || (left.id < right.id ? -1 : 1))[0]!;
  assert.equal(first.destinationCoordinate.position, second!.coordinate.position,
    'the first strike goes to the weakly held planet II, not the strong main one');
  assert.ok(first.selectedShips.cruiser! >= 8, 'with a force that wins there');
  for (const planet of [victim, second!]) {
    assert.ok(combat.filter((flight) => flight.destinationCoordinate.position === planet.coordinate.position).length <= 1, 'and one battle fleet per planet');
  }
});

test('owner rule 06.11.2026: a shielded planet is not attacked, and the protected share of the stores is no loot', () => {
  const { state, raider, victim } = prepare('strong-shield', { main: { cruiser: 20 } });
  const profile = state.npc!.profiles[raider.ownerId]!;
  const open = getNpcMissionCandidates(state, profile, START + 1).filter((candidate) => candidate.kind === 'attack' && candidate.payload.destinationPlanetId === victim.id);
  assert.ok(open.length > 0, 'without a shield the planet is a candidate');
  const shielded = { ...state, shields: { ...(state.shields ?? {}), [victim.ownerId]: createShieldRecord('standard', START) } };
  assert.equal(getNpcMissionCandidates(shielded, profile, START + 1).filter((candidate) => candidate.kind === 'attack' && candidate.payload.destinationPlanetId === victim.id).length, 0,
    'no attack candidate on a shielded owner');
  assert.equal(lookRepeatedly(shielded, raider.ownerId, [victim.id], 8).length, 0, 'and none is sent');

  const lootable = npcLootableResources({ metal: 1_000_000, minerals: 1_000, gas: 0 });
  assert.equal(lootable.metal, 900_000, 'a tenth of the first million is protected');
  assert.equal(lootable.minerals, 900);
  assert.equal(lootable.gas, 0);
  const context = createNpcUtilityContext(state, profile, START + 1, 1);
  const report = state.espionage!.reports.find((item) => item.targetPlanetId === victim.id)!;
  const ships = { cruiser: 60 };
  const full = estimateRaidEconomics(context, raider, report, ships).net;
  const poor = estimateRaidEconomics(context, raider, { ...report, resources: { ...report.resources, metal: 0, minerals: 0, gas: 0 } }, ships).net;
  assert.ok(full > poor, 'the lootable stores still pay');
});

test('owner rule 06.11.2026: planets that cannot send a decisive force alone strike together', () => {
  const { state: base, raider, victim } = prepare('strong-pooled', { main: { cruiser: 45 } });
  // The raider's home holds 60 cruisers (not enough for a decisive strike on 45), its colony next door adds 60 more.
  let state = withShips(base, raider.id, { cruiser: 60 });
  const taken = new Set(Object.values(getEspionageTargets(state.espionage)).filter((t) => t.coordinate.system === raider.coordinate.system && t.coordinate.galaxy === raider.coordinate.galaxy).map((t) => t.coordinate.position));
  const position = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15].find((value) => !taken.has(value))!;
  const colony: SpyTargetState = { ...raider, id: `${raider.id}-colony`, name: `${raider.name} II`, coordinate: { ...raider.coordinate, position },
    fleet: { ...raider.fleet, ships: { ...raider.fleet.ships, cruiser: 60 } } };
  state = withTarget(state, colony);
  const flights = lookRepeatedly(state, raider.ownerId, [victim.id], 3);
  const combat = flights.filter((flight) => (flight.selectedShips.cruiser ?? 0) > 0).sort((left, right) => left.arrivalAt - right.arrivalAt);
  assert.ok(combat.length >= 1, 'the bot attacks');
  if (combat.length > 1) {
    assert.ok(combat[combat.length - 1]!.arrivalAt - combat[0]!.arrivalAt <= 45_000, 'the fleets of one strike land within moments of each other');
  }
  assert.ok(combat.length <= 3, 'a strike is at most three fleets');
});
