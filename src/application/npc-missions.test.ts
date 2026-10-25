import assert from 'node:assert/strict';
import test from 'node:test';
import { createInitialSaveState } from './persistence.ts';
import {
  createDefaultEspionageState, createSeededEspionageRng, espionageRollSeed, getEspionageTargets, normalizeRngRoll, SPY_REPORT_COOLDOWN_MS,
} from '../domain/espionage/runtime.ts';
import { createNpcState } from '../domain/npc/state.ts';
import { createEmptyFleetState } from '../domain/fleet/runtime.ts';
import { createBot01Planets } from '../domain/espionage/fixtures.ts';
import { createUniverseSystem } from '../domain/universe/runtime.ts';
import type { SpyTargetState } from '../domain/espionage/types.ts';
import type { SaveState } from './contracts.ts';
import {
  dispatchNpcMission,
  getNpcMissionAvailableFleet,
  resolveNpcMissionArrival,
  settleNpcMissionReturn,
} from './npc-missions.ts';

const OWNER = 'npc-missions-owner';
const ORIGIN_ID = `${OWNER}-origin`;
const ORIGIN_COORDINATE = { galaxy: 1, system: 1, position: 1 } as const;
const TIME_SCALE = 1;

function target(
  id: string,
  ownerId: string,
  coordinate: SpyTargetState['coordinate'],
  kind: SpyTargetState['kind'] = 'npc',
): SpyTargetState {
  const fixture = Object.values(createBot01Planets(0))[0]!;
  const emptyFleet = createEmptyFleetState();
  return {
    ...fixture,
    id,
    ownerId,
    ownerName: ownerId,
    coordinate,
    kind,
    raceId: 'aegis',
    alliance: null,
    resources: { metal: 2_000, minerals: 2_000, gas: 2_000, debris: 0, developmentEnergy: 0 },
    buildings: { ...fixture.buildings, hangar: 20 },
    fleet: {
      ...emptyFleet,
      ships: { ...emptyFleet.ships, colonizer: 1, 'spy-probe': 1, scout: 2 },
    },
    defense: fixture.defense,
    commanders: {},
    population: { total: 0, fleet: 0, defense: 0 },
    hunterLevel: 0,
    ownerProfile: { scienceLevels: {}, shipLevels: {}, commanderLevels: {} },
  } as SpyTargetState;
}

function baseState(...additionalTargets: SpyTargetState[]): SaveState {
  const state = createInitialSaveState('test', 0);
  const origin = target(ORIGIN_ID, OWNER, ORIGIN_COORDINATE);
  const targets = { ...getEspionageTargets(state.espionage), [origin.id]: origin };
  for (const item of additionalTargets) targets[item.id] = item;
  return {
    ...state,
    npc: createNpcState([OWNER], 'npc-mission-tests', 0),
    espionage: { ...createDefaultEspionageState(), ...state.espionage, targets },
  };
}

function freeCoordinate(state: SaveState) {
  const positions = createUniverseSystem({
    mode: 'production',
    galaxy: 1,
    system: 1,
    nowMs: 0,
    galaxyCount: 1,
    playerPlanets: Object.entries(state.planets).flatMap(([id, planet]) => planet.universeGalaxy === undefined
      || planet.universeSystem === undefined || planet.universePosition === undefined ? [] : [{
        id,
        name: planet.name,
        coordinate: { galaxy: planet.universeGalaxy, system: planet.universeSystem, position: planet.universePosition },
        ownerId: state.profile.playerId,
      }]),
    registeredPlanets: Object.values(getEspionageTargets(state.espionage)).map((item) => ({
      id: item.id,
      coordinate: item.coordinate,
      name: item.name,
      ownerId: item.ownerId,
      kind: item.kind === 'player' ? 'player' as const : 'npc' as const,
    })),
  }).positions;
  const node = positions.find((item) => item.kind === 'empty' && item.coordinate.position !== ORIGIN_COORDINATE.position);
  assert.ok(node);
  return node.coordinate;
}

test('dispatch debits only the NPC owner, uses canonical flight timing, and is request-idempotent', () => {
  const state = baseState();
  const before = getEspionageTargets(state.espionage)[ORIGIN_ID]!;
  const command = {
    ownerId: OWNER,
    originPlanetId: ORIGIN_ID,
    requestId: 'npc-mission-dispatch-1',
    missionId: 'colonize' as const,
    selectedShips: { colonizer: 1 as const },
    destination: { kind: 'coordinate' as const, coordinate: freeCoordinate(state) },
  };
  const sent = dispatchNpcMission(state, command, 1_000, TIME_SCALE);
  assert.equal(sent.ok, true, sent.reason ?? undefined);
  assert.equal(sent.flight?.ownerSide, 'npc');
  assert.equal(sent.flight?.ownerId, OWNER);
  assert.equal(sent.flight?.gasCost, 126);
  const after = getEspionageTargets(sent.state.espionage)[ORIGIN_ID]!;
  assert.equal(after.fleet.ships.colonizer, 0);
  assert.equal(after.resources.gas, before.resources.gas - sent.flight!.gasCost);
  assert.equal(sent.state.planets, state.planets, 'NPC launch does not mutate player planets');
  assert.equal(getNpcMissionAvailableFleet(sent.state, OWNER, ORIGIN_ID).colonizer, 0);

  const repeated = dispatchNpcMission(sent.state, command, 2_000, TIME_SCALE);
  assert.equal(repeated.ok, true);
  assert.equal(repeated.created, false);
  assert.equal(repeated.flight?.id, sent.flight?.id);
  assert.equal(getEspionageTargets(repeated.state.espionage)[ORIGIN_ID]?.resources.gas, after.resources.gas);
});

test('attack dispatch accepts a neutral owner through the current relation rules', () => {
  const state = createInitialSaveState('test', 0);
  const origin = target(ORIGIN_ID, OWNER, ORIGIN_COORDINATE);
  const playerCoordinate = { galaxy: 1, system: 1, position: 2 };
  const espionage = { ...createDefaultEspionageState(), targets: { [origin.id]: origin } };
  const home = { ...state.planets['helion-01']!, universeGalaxy: 1, universeSystem: 1, universePosition: 2 };
  const withNpc = {
    ...state,
    planets: { ...state.planets, 'helion-01': home },
    npc: createNpcState([OWNER], 'npc-attack-tests', 0),
    espionage,
  };
  const sent = dispatchNpcMission(withNpc, {
    ownerId: OWNER,
    originPlanetId: ORIGIN_ID,
    requestId: 'npc-neutral-attack-1',
    missionId: 'attack',
    selectedShips: { scout: 1 },
    destination: { kind: 'planet', planetId: 'helion-01', coordinate: playerCoordinate },
    targetPlanetId: 'helion-01',
    targetRelation: 'neutral',
  }, 1_000, TIME_SCALE);
  assert.equal(sent.ok, true, sent.reason ?? undefined);
  assert.equal(sent.flight?.targetRelation, 'neutral');
  assert.equal(sent.flight?.attackSnapshot?.attackerFactionId, origin.raceId);
});

test('spy probe arrival records an owner-scoped canonical report and is idempotent', () => {
  const player = createInitialSaveState('test', 0);
  const origin = target(ORIGIN_ID, OWNER, ORIGIN_COORDINATE);
  const targetCoordinate = { galaxy: 1, system: 1, position: 2 };
  const home = { ...player.planets['helion-01']!, universeGalaxy: 1, universeSystem: 1, universePosition: 2 };
  const state = {
    ...player,
    planets: { ...player.planets, 'helion-01': home },
    npc: createNpcState([OWNER], 'npc-spy-tests', 0),
    espionage: { ...createDefaultEspionageState(), targets: { [origin.id]: origin } },
  };
  const sent = dispatchNpcMission(state, {
    ownerId: OWNER,
    originPlanetId: ORIGIN_ID,
    requestId: 'npc-spy-1',
    missionId: 'espionage',
    selectedShips: { 'spy-probe': 1 },
    destination: { kind: 'planet', planetId: 'helion-01', coordinate: targetCoordinate },
    targetPlanetId: 'helion-01',
    targetRelation: 'neutral',
  }, 1_000, TIME_SCALE);
  assert.equal(sent.ok, true, sent.reason ?? undefined);
  const beforePlayerPlanets = sent.state.planets;
  const arrived = resolveNpcMissionArrival(sent.state, sent.flight!, sent.flight!.arrivalAt, TIME_SCALE);
  assert.equal(arrived.ok, true, arrived.reason ?? undefined);
  assert.equal(arrived.flight?.phase, 'arrived');
  const report = arrived.state.espionage?.reports.find((item) => item.missionId === sent.flight?.spyMissionId);
  assert.equal((report as (typeof report & { ownerId?: string }) | undefined)?.ownerId, OWNER);
  assert.ok(arrived.state.npc?.profiles[OWNER]?.knowledge['target:helion-01']);
  assert.equal(arrived.state.planets, beforePlayerPlanets, 'spy arrival reads the real target without mutating player state');
  const duplicate = resolveNpcMissionArrival(arrived.state, arrived.flight!, arrived.flight!.arrivalAt, TIME_SCALE);
  assert.equal(duplicate.state.espionage?.reports.length, arrived.state.espionage?.reports.length);
});

test('an NPC repeated report from orbit loses the probe on the same seeded 30% roll as the player (25.10.2026)', () => {
  const player = createInitialSaveState('test', 0);
  const origin = target(ORIGIN_ID, OWNER, ORIGIN_COORDINATE);
  const home = { ...player.planets['helion-01']!, universeGalaxy: 1, universeSystem: 1, universePosition: 2 };
  const state = {
    ...player,
    planets: { ...player.planets, 'helion-01': home },
    npc: createNpcState([OWNER], 'npc-spy-repeat', 0),
    espionage: { ...createDefaultEspionageState(), targets: { [origin.id]: origin } },
  };
  const sent = dispatchNpcMission(state, {
    ownerId: OWNER, originPlanetId: ORIGIN_ID, requestId: 'npc-spy-repeat-1', missionId: 'espionage',
    selectedShips: { 'spy-probe': 1 }, destination: { kind: 'planet', planetId: 'helion-01', coordinate: { galaxy: 1, system: 1, position: 2 } },
    targetPlanetId: 'helion-01', targetRelation: 'neutral',
  }, 1_000, TIME_SCALE);
  assert.equal(sent.ok, true, sent.reason ?? undefined);
  let current = resolveNpcMissionArrival(sent.state, sent.flight!, sent.flight!.arrivalAt, TIME_SCALE);
  assert.equal(current.flight?.phase, 'arrived');
  let at = sent.flight!.arrivalAt;
  let lost = false;
  for (let request = 0; request < 40 && !lost; request += 1) {
    at += SPY_REPORT_COOLDOWN_MS;
    const mission = current.state.espionage!.missions.find((item) => item.id === sent.flight!.spyMissionId)!;
    const attempt = mission.reportIds.length + 1;
    const roll = normalizeRngRoll(Math.floor(createSeededEspionageRng(espionageRollSeed(mission.id, 'repeat-loss', attempt))() * 100));
    const reports = current.state.espionage!.reports.length;
    current = resolveNpcMissionArrival(current.state, current.flight!, at, TIME_SCALE, true);
    const after = current.state.espionage!.missions.find((item) => item.id === mission.id)!;
    if (roll < 30) {
      assert.equal(after.status, 'destroyed');
      assert.equal(current.flight?.completionReason, 'spy-destroyed');
      assert.equal(current.state.espionage!.reports.length, reports);
      lost = true;
    } else {
      assert.equal(after.status, 'orbiting');
      assert.equal(current.state.espionage!.reports.length, reports + 1);
    }
  }
  assert.equal(lost, true, 'forty repeated reports never risked the probe');
});

test('colonization creates an owner target with canonical start resources and consumes its colonizer', () => {
  const state = baseState();
  const origin = getEspionageTargets(state.espionage)[ORIGIN_ID]!;
  const coordinate = freeCoordinate(state);
  const sent = dispatchNpcMission(state, {
    ownerId: OWNER,
    originPlanetId: ORIGIN_ID,
    requestId: 'npc-colony-1',
    missionId: 'colonize',
    selectedShips: { colonizer: 1 },
    destination: { kind: 'coordinate', coordinate },
    targetKind: 'empty',
  }, 1_000, TIME_SCALE);
  assert.equal(sent.ok, true, sent.reason ?? undefined);
  const arrived = resolveNpcMissionArrival(sent.state, sent.flight!, sent.flight!.arrivalAt, TIME_SCALE);
  assert.equal(arrived.ok, true, arrived.reason ?? undefined);
  const colonyId = `planet-${coordinate.galaxy}-${coordinate.system}-${coordinate.position}`;
  const colony = getEspionageTargets(arrived.state.espionage)[colonyId];
  assert.ok(colony);
  assert.equal(colony.ownerId, OWNER);
  assert.deepEqual([colony.resources.metal, colony.resources.minerals, colony.resources.gas], [500, 500, 500]);
  assert.equal(colony.kind, 'npc');
  assert.equal(arrived.state.planets, state.planets);
  assert.equal(getEspionageTargets(arrived.state.espionage)[origin.id]?.fleet.ships.colonizer, 0);
});

test('return credits only surviving ships and owner loot once, and rejects an origin now owned by someone else', () => {
  const state = baseState();
  const sent = dispatchNpcMission(state, {
    ownerId: OWNER,
    originPlanetId: ORIGIN_ID,
    requestId: 'npc-return-1',
    missionId: 'attack',
    selectedShips: { scout: 2 },
    destination: { kind: 'planet', planetId: 'player-home', coordinate: { galaxy: 1, system: 1, position: 2 } },
  }, 1_000, TIME_SCALE);
  assert.equal(sent.ok, false, 'unknown owners cannot be targeted');

  const neutral = target('player-home', 'player-owner', { galaxy: 1, system: 1, position: 2 }, 'player');
  const withTarget = baseState(neutral);
  const launched = dispatchNpcMission(withTarget, {
    ownerId: OWNER,
    originPlanetId: ORIGIN_ID,
    requestId: 'npc-return-2',
    missionId: 'attack',
    selectedShips: { scout: 2 },
    destination: { kind: 'planet', planetId: neutral.id, coordinate: neutral.coordinate },
  }, 1_000, TIME_SCALE);
  assert.equal(launched.ok, true, launched.reason ?? undefined);
  const battleReport = {
    id: 'battle-1',
    attackerForce: { stacks: [{ entityId: 'scout', countBefore: 2, countAfter: 1, destroyed: 1 }] },
  } as unknown as SaveState['combat']['reports'][number];
  const returning = { ...launched.flight!, phase: 'returning' as const, returnAt: launched.flight!.arrivalAt + launched.flight!.oneWayDurationMs,
    selectedShips: { scout: 2 }, attackResolution: { reportId: 'battle-1', resolvedAt: 1, debris: 0, loot: { metal: 100, minerals: 50, gas: 25, debris: 10 } } };
  const settled = settleNpcMissionReturn({ ...launched.state, flights: {
    ...launched.state.flights,
    records: launched.state.flights.records.map((item) => item.id === returning.id ? returning : item),
  }, combat: { ...launched.state.combat, reports: [battleReport] } }, returning, returning.returnAt!);
  const origin = getEspionageTargets(settled.state.espionage)[ORIGIN_ID]!;
  assert.equal(origin.fleet.ships.scout, 1);
  assert.equal(origin.resources.metal, getEspionageTargets(launched.state.espionage)[ORIGIN_ID]!.resources.metal + 100);
  const repeated = settleNpcMissionReturn(settled.state, settled.flight, returning.returnAt!);
  assert.equal(getEspionageTargets(repeated.state.espionage)[ORIGIN_ID]?.fleet.ships.scout, 1);

  const changedOwner = { ...origin, ownerId: 'another-owner' };
  const orphanState = {
    ...settled.state,
    espionage: { ...settled.state.espionage!, targets: { ...getEspionageTargets(settled.state.espionage), [ORIGIN_ID]: changedOwner } },
    flights: { ...settled.state.flights, records: settled.state.flights.records.map((item) => item.id === settled.flight.id ? returning : item) },
  };
  const orphan = settleNpcMissionReturn(orphanState, returning, returning.returnAt!);
  assert.equal(getEspionageTargets(orphan.state.espionage)[ORIGIN_ID]?.fleet.ships.scout, changedOwner.fleet.ships.scout);

  const lostOrigin = {
    ...settled.state,
    espionage: { ...settled.state.espionage!, targets: Object.fromEntries(Object.entries(getEspionageTargets(settled.state.espionage)).filter(([id]) => id !== ORIGIN_ID)) },
    flights: { ...settled.state.flights, records: settled.state.flights.records.map((item) => item.id === settled.flight.id ? returning : item) },
  };
  const lost = settleNpcMissionReturn(lostOrigin, returning, returning.returnAt!);
  assert.equal(getEspionageTargets(lost.state.espionage)[ORIGIN_ID], undefined, 'lost origins receive no ship or cargo credit');
});
