import assert from 'node:assert/strict';
import test from 'node:test';

import { createDefaultNewGameConfig } from '../domain/world/config.ts';
import { getEspionageTargets } from '../domain/espionage/runtime.ts';
import { stageOwnerRelation } from '../domain/command/test-helpers.ts';
import { selectOwnerScore } from '../domain/rating/scoring.ts';
import { UNIVERSE_NPC_OWNER_ID } from '../domain/universe/runtime.ts';
import type { SpyTargetState } from '../domain/espionage/types.ts';
import { createInitialSaveState } from './persistence.ts';
import { dispatchFlight, reconcileFlights } from './flights.ts';
import { dispatchNpcMission } from './npc-missions.ts';
import { currentSunRaidState, launchSunRaid, testBot01RaidSun } from './sun-raid.ts';
import { replacePlanetState, type SaveState } from './contracts.ts';
import { evaluatePlanetAttackEligibility } from './attack-eligibility.ts';
import { withAttackEligiblePoints } from './attack-eligibility.test-support.ts';

const START = Date.UTC(2026, 9, 23, 12);
const PRODUCTION = { now: START, mode: 'production' as const, testTimeScale: 1 as const };

/** Production campaign: the player and three NPCs all start below 300 total points. */
function campaign(): SaveState {
  const base = createDefaultNewGameConfig({ seed: 'attack-points-rule', factionId: 'aegis', playerName: 'Attack rule QA' });
  return createInitialSaveState('production', START, { ...base, world: { ...base.world, npcCount: 3, campaignSpeed: 'standard' as const } });
}

function npcTargets(state: SaveState): SpyTargetState[] {
  return Object.values(getEspionageTargets(state.espionage))
    .filter((target) => target.kind === 'npc')
    .sort((left, right) => left.id.localeCompare(right.id));
}

/** Exact public points: resource points through the cost ledger, the rest as battle points. */
function withPoints(state: SaveState, ownerId: string, totalPoints: number, resourcePoints = totalPoints): SaveState {
  assert.ok(totalPoints >= resourcePoints);
  const next = withAttackEligiblePoints(state, [ownerId], resourcePoints);
  const battle = totalPoints - resourcePoints;
  const result = battle === 0 ? next : {
    ...next,
    rating: { ...next.rating, battleAwardsByReportId: { ...next.rating.battleAwardsByReportId, [`qa-attack-rule-${ownerId}`]: { [ownerId]: battle } } },
  };
  const score = selectOwnerScore(result, ownerId)!;
  assert.deepEqual([score.totalPoints, score.resourcePoints], [totalPoints, resourcePoints], `fixture points for ${ownerId}`);
  return result;
}

function playerAttack(state: SaveState, target: SpyTargetState, requestId: string, relation: 'neutral' | 'enemy' = 'neutral') {
  return dispatchFlight(state, {
    requestId,
    missionId: 'attack',
    originPlanetId: state.currentPlanetId,
    destination: { kind: 'planet', planetId: target.id, coordinate: target.coordinate },
    targetRelation: relation,
    targetOwnerId: target.ownerId,
    selectedShips: { scout: 5 },
    selectedCommanders: {},
    maxRounds: 5,
    departedAt: START,
  }, PRODUCTION);
}

function playerHome(state: SaveState) {
  const home = state.planets['helion-01']!;
  return { id: 'helion-01', coordinate: { galaxy: home.universeGalaxy!, system: home.universeSystem!, position: home.universePosition! } };
}

function npcAttack(state: SaveState, origin: SpyTargetState, target: { id: string; coordinate: SpyTargetState['coordinate'] }, requestId: string) {
  return dispatchNpcMission(state, {
    ownerId: origin.ownerId,
    originPlanetId: origin.id,
    requestId,
    missionId: 'attack',
    selectedShips: { scout: 5 },
    destination: { kind: 'planet', planetId: target.id, coordinate: target.coordinate },
    targetPlanetId: target.id,
  }, START, 1);
}

function refusal(result: ReturnType<typeof playerAttack>) {
  assert.equal(result.ok, false);
  return result.ok ? null : result.error;
}

test('player → NPC: 299 total points on either side is protected, 300 is not', () => {
  const base = campaign();
  const player = base.profile.playerId;
  const target = npcTargets(base)[0]!;
  assert.ok(selectOwnerScore(base, player)!.totalPoints < 300, 'a new player starts protected');

  const attacker299 = refusal(playerAttack(withPoints(withPoints(base, player, 299), target.ownerId, 300), target, 'rule-299-attacker'));
  assert.deepEqual(attacker299, { code: 'attack-not-allowed', message: 'У вас 299 общих очков: атаковать можно с 300.' });

  const defender299 = refusal(playerAttack(withPoints(withPoints(base, player, 300), target.ownerId, 299), target, 'rule-299-defender'));
  assert.deepEqual(defender299, { code: 'attack-not-allowed', message: 'У цели 299 общих очков: атаковать можно с 300.' });

  const both300 = playerAttack(withPoints(withPoints(base, player, 300), target.ownerId, 300), target, 'rule-300');
  assert.equal(both300.ok, true, both300.ok ? '' : both300.error.message);
});

test('player → NPC: the total band is inclusive at ×0.5 and ×2 and closed one point beyond', () => {
  const base = withPoints(campaign(), 'player-current', 10_000, 2_400);
  const target = npcTargets(base)[0]!;
  // 1 000 resource points keep the resource branch closed (band 1 200–4 800).
  const at = (total: number) => playerAttack(withPoints(base, target.ownerId, total, 1_000), target, `rule-total-${total}`);
  assert.equal(at(5_000).ok, true);
  assert.equal(at(20_000).ok, true);
  assert.equal(at(4_999).ok, false);
  const beyond = refusal(at(20_001));
  assert.equal(beyond?.code, 'attack-not-allowed');
  assert.equal(beyond?.message, 'Цель вне диапазона: у цели 20 001 общих и 1 000 ресурсных, допустимо 5 000–20 000 общих или 1 200–4 800 ресурсных.');
});

test('player → NPC: the resource band admits outside the total band; total only, resource only and both', () => {
  const base = withPoints(campaign(), 'player-current', 10_000, 2_400);
  const target = npcTargets(base)[0]!;
  const at = (total: number, resource: number) => playerAttack(withPoints(base, target.ownerId, total, resource), target, `rule-res-${total}-${resource}`).ok;
  assert.equal(at(40_000, 1_200), true, 'resource only, lower edge');
  assert.equal(at(40_000, 4_800), true, 'resource only, upper edge');
  assert.equal(at(40_000, 1_199), false);
  assert.equal(at(40_000, 4_801), false);
  assert.equal(at(12_000, 300), true, 'total only');
  assert.equal(at(9_000, 2_000), true, 'both branches');
});

test('NPC → player and NPC → NPC use the same gate at dispatch', () => {
  const base = campaign();
  const player = base.profile.playerId;
  const [origin, other] = npcTargets(base);
  assert.ok(origin && other && origin.ownerId !== other.ownerId);

  const protectedPlayer = npcAttack(withPoints(base, origin.ownerId, 1_000), origin, playerHome(base), 'npc-rule-player-protected');
  assert.deepEqual([protectedPlayer.ok, protectedPlayer.reason], [false, 'attack-not-allowed']);
  const playerInRange = npcAttack(withPoints(withPoints(base, origin.ownerId, 1_000), player, 1_500), origin, playerHome(base), 'npc-rule-player-ok');
  assert.equal(playerInRange.ok, true, playerInRange.reason ?? '');
  const playerOutOfRange = npcAttack(withPoints(withPoints(base, origin.ownerId, 1_000), player, 2_001), origin, playerHome(base), 'npc-rule-player-far');
  assert.deepEqual([playerOutOfRange.ok, playerOutOfRange.reason], [false, 'attack-not-allowed']);

  const npcProtected = npcAttack(withPoints(base, origin.ownerId, 1_000), origin, other, 'npc-rule-npc-protected');
  assert.deepEqual([npcProtected.ok, npcProtected.reason], [false, 'attack-not-allowed']);
  const npcInRange = npcAttack(withPoints(withPoints(base, origin.ownerId, 1_000), other.ownerId, 500), origin, other, 'npc-rule-npc-ok');
  assert.equal(npcInRange.ok, true, npcInRange.reason ?? '');
  const npcOutOfRange = npcAttack(withPoints(withPoints(base, origin.ownerId, 1_000), other.ownerId, 499), origin, other, 'npc-rule-npc-far');
  assert.deepEqual([npcOutOfRange.ok, npcOutOfRange.reason], [false, 'attack-not-allowed']);
});

test('the check is made only at launch: a flight in the air arrives after the points change', () => {
  const base = campaign();
  const player = base.profile.playerId;
  const target = npcTargets(base)[0]!;
  const sent = playerAttack(withPoints(withPoints(base, player, 1_000), target.ownerId, 1_000), target, 'rule-in-flight');
  assert.equal(sent.ok, true);
  if (!sent.ok) return;
  // The attacker grows far out of range while flying.
  const grown = withPoints(sent.state, player, 100_000);
  assert.equal(evaluatePlanetAttackEligibility(grown, player, target.ownerId).allowed, false);
  const arrived = reconcileFlights(grown, sent.flight.arrivalAt, () => 0.5, PRODUCTION);
  assert.ok(arrived.state.combat.reports.some((report) => report.id === `battle-attack-${sent.flight.id}`), 'the attack still resolves on arrival');
  assert.equal(arrived.state.flights.records.find((flight) => flight.id === sent.flight.id)?.phase, 'returning');
});

test('an alliance war does not lift the rule', () => {
  // Test Mode: the player leads an alliance; one Bot 01 planet becomes an ordinary NPC owner of an alliance at war with it.
  const fixture = createInitialSaveState('test', START);
  const player = fixture.profile.playerId;
  const bot = Object.values(getEspionageTargets(fixture.espionage)).find((target) => target.ownerId === UNIVERSE_NPC_OWNER_ID)!;
  const target: SpyTargetState = { ...bot, ownerId: 'qa-war-owner', ownerName: 'QA War' };
  const atWar: SaveState = {
    ...fixture,
    espionage: { ...fixture.espionage!, targets: { ...fixture.espionage!.targets, [target.id]: target } },
    command: stageOwnerRelation(fixture.command, player, target.ownerId, 'war'),
  };
  const test = (total: number) => dispatchFlight(withPoints(withPoints(atWar, player, 100_000), target.ownerId, total), {
    requestId: `rule-war-${total}`, missionId: 'attack', originPlanetId: atWar.currentPlanetId,
    destination: { kind: 'planet', planetId: target.id, coordinate: target.coordinate }, targetRelation: 'enemy', targetOwnerId: target.ownerId,
    selectedShips: { scout: 10 }, selectedCommanders: {}, maxRounds: 5, departedAt: START,
  }, { now: START, mode: 'test', testTimeScale: 15 });
  const far = test(200_001);
  assert.equal(far.ok ? '' : far.error.code, 'attack-not-allowed', 'an enemy at war outside the band is refused');
  const near = test(200_000);
  assert.equal(near.ok, true, near.ok ? '' : near.error.message);
  assert.equal(near.ok && near.flight.targetRelation, 'enemy');
});

test('espionage and other missions are allowed at any points', () => {
  const base = campaign();
  const target = npcTargets(base)[0]!;
  assert.ok(selectOwnerScore(base, base.profile.playerId)!.totalPoints < 300);
  const spy = dispatchFlight(base, {
    requestId: 'rule-spy-protected',
    missionId: 'espionage',
    originPlanetId: base.currentPlanetId,
    destination: { kind: 'planet', planetId: target.id, coordinate: target.coordinate },
    targetRelation: 'neutral',
    targetOwnerId: target.ownerId,
    selectedShips: { 'spy-probe': 1 },
    departedAt: START,
  }, PRODUCTION);
  assert.equal(spy.ok, true, spy.ok ? '' : spy.error.message);
});

test('Test Mode Bot 01 scenarios stay outside the rule', () => {
  const state = createInitialSaveState('test', START);
  const bot = Object.values(getEspionageTargets(state.espionage)).find((target) => target.ownerId === UNIVERSE_NPC_OWNER_ID)!;
  const player = selectOwnerScore(state, state.profile.playerId)!.totalPoints;
  const botPoints = selectOwnerScore(state, UNIVERSE_NPC_OWNER_ID)!.totalPoints;
  assert.ok(botPoints > player * 2, 'Bot 01 is far out of the player band');
  const sent = dispatchFlight(state, {
    requestId: 'rule-bot01', missionId: 'attack', originPlanetId: state.currentPlanetId,
    destination: { kind: 'planet', planetId: bot.id, coordinate: bot.coordinate }, targetRelation: 'neutral', targetOwnerId: bot.ownerId,
    selectedShips: { scout: 10 }, selectedCommanders: {}, maxRounds: 5, departedAt: START,
  }, { now: START, mode: 'test', testTimeScale: 15 });
  assert.equal(sent.ok, true, sent.ok ? '' : sent.error.message);
});

test('Sun attack and Sun defence are outside the rule (a protected player may join both)', () => {
  const sunOptions = (now: number) => ({ now, mode: 'test' as const, testTimeScale: 1 as const });
  const fixture = createInitialSaveState('test', START);
  const fresh = createInitialSaveState('production', START);
  // The Test Mode player stripped down to a new player's development plus three cruisers.
  const home = fixture.planets['helion-01']!;
  let state: SaveState = replacePlanetState({ ...fixture, science: fresh.science, shipUpgradeLevels: {} }, 'helion-01', {
    ...home,
    buildings: fresh.planets['helion-01']!.buildings,
    defense: fresh.planets['helion-01']!.defense,
    fleet: { ...home.fleet, ships: { ...fresh.planets['helion-01']!.fleet.ships, scout: 0, cruiser: 3 }, commanders: Object.fromEntries(Object.keys(home.fleet.commanders).map((id) => [id, 0])) as typeof home.fleet.commanders },
  });
  assert.ok(selectOwnerScore(state, state.profile.playerId)!.totalPoints < 300, 'the player is under the 300-point protection');

  const raid = launchSunRaid(state, { galaxy: 1, system: 20, originPlanetId: 'helion-01', ships: { cruiser: 1 }, requestId: 'rule-sun-raid' }, sunOptions(START));
  assert.equal(raid.ok, true, raid.ok ? '' : JSON.stringify(raid));
  assert.equal(currentSunRaidState(raid.state).raids.length, 1);

  state = { ...state, command: { ...state.command, alliances: state.command.alliances.filter((alliance) => !alliance.members.some((member) => member.ownerId === state.profile.playerId)) } };
  const attacked = testBot01RaidSun(state, 1, 1, sunOptions(START));
  assert.equal(attacked.ok, true);
  if (!attacked.ok) return;
  const support = dispatchFlight(attacked.state, {
    requestId: 'rule-sun-support', missionId: 'sun-support', originPlanetId: 'helion-01', operationId: 'sun:1:1',
    destination: { kind: 'operation', operationId: 'sun:1:1', coordinate: { galaxy: 1, system: 1, position: 1 } }, selectedShips: { cruiser: 2 },
  }, sunOptions(START + 1_000));
  assert.equal(support.ok, true, support.ok ? '' : support.error.message);
});
