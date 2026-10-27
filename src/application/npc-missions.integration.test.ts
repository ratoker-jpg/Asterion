import assert from 'node:assert/strict';
import test from 'node:test';

import { createDefaultNewGameConfig } from '../domain/world/config.ts';
import { getEspionageTargets } from '../domain/espionage/runtime.ts';
import type { SpyTargetState } from '../domain/espionage/types.ts';
import { getStorageCapacities } from '../domain/buildings/resource-zone.ts';
import { getCappedDelivery } from '../domain/flights/cargo.ts';
import { createUniverseSystem } from '../domain/universe/runtime.ts';
import { selectExplorationTargets } from './exploration.ts';
import { createInitialSaveState, createPersistenceFacade } from './persistence.ts';
import { dispatchNpcMission } from './npc-missions.ts';
import { reconcileFlights } from './flights.ts';
import { isFlightEventForPlayer, isFlightVisibleToPlayer } from './flight-visibility.ts';
import type { SaveState } from './contracts.ts';

const START = Date.UTC(2026, 9, 23, 12);
const FLIGHT_SCALE = 1;

function makeCampaign(seed: string, npcCount = 2): SaveState {
  const base = createDefaultNewGameConfig({ seed, factionId: 'aegis', playerName: 'Mission integration' });
  const setup = { ...base, world: { ...base.world, npcCount, campaignSpeed: 'standard' as const } };
  return createInitialSaveState('production', START, setup);
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

function advance(state: SaveState, at: number) {
  return reconcileFlights(state, at, () => 0.5, { mode: 'production', testTimeScale: 1 });
}

function emptyCoordinate(state: SaveState) {
  const positions = createUniverseSystem({
    mode: 'production', galaxy: 1, system: 1, nowMs: START, galaxyCount: 1,
    playerPlanets: Object.entries(state.planets).flatMap(([id, planet]) => planet.universeGalaxy === undefined
      || planet.universeSystem === undefined || planet.universePosition === undefined ? [] : [{
        id, name: planet.name,
        coordinate: { galaxy: planet.universeGalaxy, system: planet.universeSystem, position: planet.universePosition },
        ownerId: state.profile.playerId,
      }]),
    registeredPlanets: Object.values(getEspionageTargets(state.espionage)).map((target) => ({
      id: target.id, name: target.name, coordinate: target.coordinate, ownerId: target.ownerId,
      kind: target.kind === 'player' ? 'player' as const : 'npc' as const,
    })),
  });
  const empty = positions.positions.find((node) => node.kind === 'empty' && node.coordinate.position !== 1);
  assert.ok(empty, 'fixture system should contain an unoccupied coordinate');
  return empty.coordinate;
}

function launchAttack(state: SaveState, origin: SpyTargetState, target: SpyTargetState | { id: string; coordinate: SpyTargetState['coordinate'] }, requestId: string) {
  const sent = dispatchNpcMission(state, {
    ownerId: origin.ownerId,
    originPlanetId: origin.id,
    requestId,
    missionId: 'attack',
    selectedShips: { scout: origin.fleet.ships.scout },
    destination: { kind: 'planet', planetId: target.id, coordinate: target.coordinate },
    targetPlanetId: target.id,
  }, START, FLIGHT_SCALE);
  assert.equal(sent.ok, true, sent.reason ?? undefined);
  assert.equal(sent.flight?.ownerSide, 'npc');
  assert.equal(sent.flight?.ownerId, origin.ownerId);
  return { state: sent.state, flight: sent.flight! };
}

function attackReport(state: SaveState, flightId: string) {
  const report = state.combat.reports.find((candidate) => candidate.id === `battle-attack-${flightId}`);
  assert.ok(report, `expected one canonical combat report for ${flightId}`);
  return report!;
}

test('neutral NPC-to-player attack survives production reload and settles once at exact arrival and return times', () => {
  const state = makeCampaign('npc-mission-player-attack');
  const origin = npcTargets(state)[0]!;
  const playerHome = state.planets['helion-01']!;
  assert.ok(origin.fleet.ships.scout > 0);
  const initialOriginShips = origin.fleet.ships.scout;
  const initialTargetShips = playerHome.fleet.ships.scout;
  const launched = launchAttack(state, origin, {
    id: 'helion-01',
    coordinate: {
      galaxy: playerHome.universeGalaxy!,
      system: playerHome.universeSystem!,
      position: playerHome.universePosition!,
    },
  }, 'npc-autonomy:integration:neutral-player-attack');
  const flight = launched.flight;
  assert.equal(getEspionageTargets(launched.state.espionage)[origin.id]?.fleet.ships.scout, 0,
    'launch physically removes the dispatched fleet from its NPC garrison');
  assert.ok(launched.state.flights.records.some((item) => item.id === flight.id), 'the real flight is persisted in the shared flight list');
  assert.equal(flight.targetRelation, 'neutral');
  assert.equal(flight.destinationOwnerId, state.profile.playerId);

  const beforeArrival = advance(launched.state, flight.arrivalAt - 1);
  assert.equal(beforeArrival.state.flights.records.find((item) => item.id === flight.id)?.phase, 'outbound');
  const outboundReload = saveReload(beforeArrival.state, 'npc-mission-player-attack');
  const arrived = advance(outboundReload, flight.arrivalAt);
  const returningFlight = arrived.state.flights.records.find((item) => item.id === flight.id);
  assert.ok(returningFlight, JSON.stringify({
    loadedFlights: outboundReload.flights.records.map((item) => ({ id: item.id, ownerSide: item.ownerSide, ownerId: item.ownerId, phase: item.phase })),
    events: arrived.events,
  }));
  assert.equal(returningFlight.phase, 'returning');
  assert.equal(returningFlight.arrivedAt, flight.arrivalAt);
  assert.equal(returningFlight.returnAt, flight.arrivalAt + flight.oneWayDurationMs);
  assert.ok(returningFlight.attackResolution);
  const report = attackReport(arrived.state, flight.id);
  assert.equal(arrived.state.combat.reports.filter((item) => item.id === report.id).length, 1);
  const attackerSurvivors = report.attackerForce.stacks.find((stack) => stack.entityId === 'scout')?.countAfter ?? 0;
  const defenderAfter = report.defenderForce.stacks.find((stack) => stack.entityId === 'scout')?.countAfter ?? 0;
  assert.equal(arrived.state.planets['helion-01']!.fleet.ships.scout, defenderAfter,
    'the real player garrison must match the canonical defender report');

  const returningReload = saveReload(arrived.state, 'npc-mission-player-attack');
  const sourceBeforeReturn = getEspionageTargets(returningReload.espionage)[origin.id]!;
  const targetBeforeReturn = returningReload.planets['helion-01']!;
  const returned = advance(returningReload, returningFlight.returnAt!);
  const completed = returned.state.flights.records.find((item) => item.id === flight.id)!;
  assert.equal(completed.phase, 'completed');
  assert.equal(completed.npcReturnCreditedAt, returningFlight.returnAt);
  const sourceAfterReturn = getEspionageTargets(returned.state.espionage)[origin.id]!;
  assert.equal(sourceAfterReturn.fleet.ships.scout, initialOriginShips - flight.selectedShips.scout! + attackerSurvivors,
    'garrison after return must equal dispatched hulls removed plus combat survivors');
  const delivery = getCappedDelivery(
    { metal: sourceBeforeReturn.resources.metal, minerals: sourceBeforeReturn.resources.minerals, gas: sourceBeforeReturn.resources.gas },
    getStorageCapacities(sourceBeforeReturn.buildings),
    completed.attackResolution!.loot,
  );
  assert.deepEqual(
    [sourceAfterReturn.resources.metal, sourceAfterReturn.resources.minerals, sourceAfterReturn.resources.gas],
    [delivery.resources.metal, delivery.resources.minerals, delivery.resources.gas],
    'real loot should be credited once with canonical storage caps',
  );
  assert.equal(returned.state.planets['helion-01']!.fleet.ships.scout, targetBeforeReturn.fleet.ships.scout,
    'settling the return must not mutate the defender a second time');

  const repeated = advance(returned.state, returningFlight.returnAt!);
  assert.equal(repeated.state.combat.reports.filter((item) => item.id === report.id).length, 1);
  assert.deepEqual(getEspionageTargets(repeated.state.espionage)[origin.id], sourceAfterReturn,
    'repeated reconcile must not duplicate survivor or loot credit');
});

test('NPC-to-NPC attack uses the real defender planet and conserves both garrisons through return', () => {
  const state = makeCampaign('npc-mission-npc-attack');
  const [origin, target] = npcTargets(state);
  assert.ok(origin && target);
  assert.notEqual(origin.ownerId, target.ownerId);
  const sourceShipsBefore = origin.fleet.ships.scout;
  const defenderShipsBefore = target.fleet.ships.scout;
  const launched = launchAttack(state, origin, target, 'npc-autonomy:integration:npc-attack');
  const arrived = advance(launched.state, launched.flight.arrivalAt);
  const returning = arrived.state.flights.records.find((item) => item.id === launched.flight.id)!;
  assert.equal(returning.phase, 'returning');
  const report = attackReport(arrived.state, launched.flight.id);
  const attackerAfter = report.attackerForce.stacks.find((stack) => stack.entityId === 'scout')?.countAfter ?? 0;
  const defenderAfter = report.defenderForce.stacks.find((stack) => stack.entityId === 'scout')?.countAfter ?? 0;
  assert.equal(getEspionageTargets(arrived.state.espionage)[target.id]?.fleet.ships.scout, defenderAfter);
  const afterReturn = advance(arrived.state, returning.returnAt!).state;
  assert.equal(getEspionageTargets(afterReturn.espionage)[origin.id]?.fleet.ships.scout,
    sourceShipsBefore - launched.flight.selectedShips.scout! + attackerAfter);
  assert.equal(getEspionageTargets(afterReturn.espionage)[target.id]?.fleet.ships.scout, defenderAfter);
  assert.ok(defenderShipsBefore >= defenderAfter);
});

test('arrival revalidates live relations and target ownership before any combat', () => {
  const state = makeCampaign('npc-mission-relation-change');
  const [origin, target] = npcTargets(state);
  assert.ok(origin && target);
  const launched = launchAttack(state, origin, target, 'npc-autonomy:integration:relation-change');
  const targets = getEspionageTargets(launched.state.espionage);
  const changedOwner = { ...targets[target.id]!, ownerId: origin.ownerId };
  const selfAtArrival = {
    ...launched.state,
    espionage: { ...launched.state.espionage!, targets: { ...targets, [target.id]: changedOwner } },
  };
  const selfResult = advance(selfAtArrival, launched.flight.arrivalAt);
  assert.equal(selfResult.state.combat.reports.some((report) => report.id === `battle-attack-${launched.flight.id}`), false,
    'a target that becomes the attacker’s own world must not be attacked');
  assert.equal(selfResult.state.flights.records.find((item) => item.id === launched.flight.id)?.phase, 'returning');
  assert.equal(getEspionageTargets(selfResult.state.espionage)[target.id]?.fleet.ships.scout, target.fleet.ships.scout);

  const allyCampaign = makeCampaign('npc-mission-ally-change');
  const allyOrigin = npcTargets(allyCampaign)[0]!;
  const home = allyCampaign.planets['helion-01']!;
  const allyLaunch = launchAttack(allyCampaign, allyOrigin, {
    id: 'helion-01',
    coordinate: { galaxy: home.universeGalaxy!, system: home.universeSystem!, position: home.universePosition! },
  }, 'npc-autonomy:integration:ally-change');
  const member = (ownerId: string, displayName: string) => ({
    ownerId, displayName, joinedAt: START, lastActiveAt: START,
    deliveredUnits: 0, jointOperationCount: 0, tieBreaker: 0,
  });
  const alliance = {
    id: 'integration-shared-alliance', name: 'Integration shared alliance', tag: 'ISA', motto: '', description: '',
    emblem: { glyph: 'starforge', accent: 'cyan' }, createdAt: START,
    leaderOwnerId: allyOrigin.ownerId, deputyOwnerId: null, leaderSince: START,
    members: [member(allyOrigin.ownerId, allyOrigin.ownerName), member(allyCampaign.profile.playerId, allyCampaign.profile.displayName)],
  } as unknown as SaveState['command']['alliances'][number];
  const nowAllies = {
    ...allyLaunch.state,
    command: { ...allyLaunch.state.command, alliances: [alliance] },
  };
  const allyResult = advance(nowAllies, allyLaunch.flight.arrivalAt);
  assert.equal(allyResult.state.combat.reports.some((report) => report.id === `battle-attack-${allyLaunch.flight.id}`), false,
    'a neutral target that becomes an ally before arrival must not be attacked');
  assert.equal(allyResult.state.flights.records.find((item) => item.id === allyLaunch.flight.id)?.phase, 'returning');
  assert.equal(allyResult.state.planets['helion-01']!.fleet.ships.scout, home.fleet.ships.scout);
});

test('competing NPC colonizers resolve by arrival order across save reload without double-claiming a coordinate', () => {
  const campaign = makeCampaign('npc-mission-colony-race');
  const [first, second] = npcTargets(campaign);
  assert.ok(first && second);
  // Both racers have the 500 total points the first colony needs (owner rule).
  const state = { ...campaign, rating: { ...campaign.rating, battleAwardsByReportId: { ...campaign.rating.battleAwardsByReportId,
    'qa-first-colony-points': { [first.ownerId]: 500, [second.ownerId]: 500 } } } };
  const coordinate = emptyCoordinate(state);
  const firstLaunch = dispatchNpcMission(state, {
    ownerId: first.ownerId,
    originPlanetId: first.id,
    requestId: 'npc-autonomy:integration:colony-race-1',
    missionId: 'colonize',
    selectedShips: { colonizer: 1 },
    destination: { kind: 'coordinate', coordinate },
    targetKind: 'empty',
  }, START, FLIGHT_SCALE);
  assert.equal(firstLaunch.ok, true, JSON.stringify({ reason: firstLaunch.reason, coordinate }));
  const firstOriginAfterLaunch = getEspionageTargets(firstLaunch.state.espionage)[first.id]!;
  const secondOriginBefore = getEspionageTargets(firstLaunch.state.espionage)[second.id]!;
  const competingLaunch = dispatchNpcMission(firstLaunch.state, {
    ownerId: second.ownerId,
    originPlanetId: second.id,
    requestId: 'npc-autonomy:integration:colony-race-2',
    missionId: 'colonize',
    selectedShips: { colonizer: 1 },
    destination: { kind: 'coordinate', coordinate },
    targetKind: 'empty',
  }, START, FLIGHT_SCALE);
  assert.equal(competingLaunch.ok, true, competingLaunch.reason ?? undefined);
  assert.equal(getEspionageTargets(competingLaunch.state.espionage)[second.id]?.fleet.ships.colonizer, 0,
    'both legally launched colonizers are reserved from their real garrisons');

  const flights = [firstLaunch.flight!, competingLaunch.flight!];
  const ordered = [...flights].sort((left, right) => left.arrivalAt - right.arrivalAt || left.id.localeCompare(right.id));
  const winner = ordered[0]!;
  const loser = ordered[1]!;
  assert.notEqual(winner.arrivalAt, loser.arrivalAt, 'fixture owners should approach from different routes');
  const beforeArrival = advance(competingLaunch.state, winner.arrivalAt - 1);
  const reloaded = saveReload(beforeArrival.state, 'npc-mission-colony-race');
  const arrived = advance(reloaded, winner.arrivalAt);
  const colony = getEspionageTargets(arrived.state.espionage)[`planet-${coordinate.galaxy}-${coordinate.system}-${coordinate.position}`];
  assert.ok(colony);
  assert.equal(colony.ownerId, winner.ownerId);
  const collided = advance(arrived.state, loser.arrivalAt);
  const loserReturning = collided.state.flights.records.find((item) => item.id === loser.id)!;
  assert.equal(loserReturning.phase, 'returning');
  assert.equal(loserReturning.completionReason, 'target-occupied');
  assert.equal(getEspionageTargets(collided.state.espionage)[`planet-${coordinate.galaxy}-${coordinate.system}-${coordinate.position}`]?.ownerId,
    winner.ownerId, 'the later arrival cannot replace the first colony owner');
  const loserReturned = advance(collided.state, loserReturning.returnAt!).state;
  assert.equal(getEspionageTargets(loserReturned.espionage)[loser.originPlanetId]?.fleet.ships.colonizer, 1,
    'the losing colonizer returns to its actual origin');
  assert.equal(getEspionageTargets(loserReturned.espionage)[first.id]?.fleet.ships.colonizer,
    firstOriginAfterLaunch.fleet.ships.colonizer + (loser.originPlanetId === first.id ? 1 : 0));
  assert.equal(getEspionageTargets(loserReturned.espionage)[second.id]?.fleet.ships.colonizer,
    secondOriginBefore.fleet.ships.colonizer - 1 + (loser.originPlanetId === second.id ? 1 : 0));
});

test('NPC exploration recon dispatch uses a canonical live contact and shared arrival settlement', () => {
  const state = makeCampaign('npc-mission-recon');
  const origin = npcTargets(state)[0]!;
  let now = START;
  let target = selectExplorationTargets(state, now, 'production')[0];
  for (let step = 0; !target && step < 480; step += 1) {
    now += 60_000;
    target = selectExplorationTargets(state, now, 'production')[0];
  }
  assert.ok(target, 'production map should expose a canonical timed exploration contact in the bounded fixture window');
  const sent = dispatchNpcMission(state, {
    ownerId: origin.ownerId,
    originPlanetId: origin.id,
    requestId: 'npc-autonomy:integration:exploration-recon',
    missionId: 'exploration-recon',
    selectedShips: { 'spy-probe': 1 },
    destination: { kind: 'coordinate', coordinate: target.coordinate },
    operationId: target.id,
    targetKind: target.kind,
  }, now, FLIGHT_SCALE);
  assert.equal(sent.ok, true, sent.reason ?? undefined);
  const arrived = advance(sent.state, sent.flight!.arrivalAt);
  const returning = arrived.state.flights.records.find((item) => item.id === sent.flight!.id)!;
  assert.equal(returning.phase, 'returning');
  assert.ok(arrived.state.exploration?.reconReports?.some((report) => report.flightId === sent.flight!.id && report.ownerId === origin.ownerId));
  const returned = advance(arrived.state, returning.returnAt!).state;
  assert.equal(returned.flights.records.find((item) => item.id === sent.flight!.id)?.phase, 'completed');
  assert.equal(getEspionageTargets(returned.espionage)[origin.id]?.fleet.ships['spy-probe'], origin.fleet.ships['spy-probe']);
});

test('NPC recyclers collect public debris and bring it home to the recycling store, surviving a reload', () => {
  const state = makeCampaign('npc-mission-recycle');
  const [owner, neighbour] = npcTargets(state);
  assert.ok(owner && neighbour);
  // Debris lies in the neighbour's orbit (public: the map shows it to everyone).
  const seeded: SaveState = { ...state, espionage: { ...state.espionage!, targets: { ...state.espionage!.targets,
    [neighbour.id]: { ...neighbour, resources: { ...neighbour.resources, debris: 5_000 } } } } };
  const recyclers = Object.fromEntries(Object.entries(owner.fleet.ships).filter(([id, count]) => id === 'recycler' && (count ?? 0) > 0));
  assert.ok(Object.keys(recyclers).length, 'the canonical start includes a recycler');
  const launch = dispatchNpcMission(seeded, {
    ownerId: owner.ownerId, originPlanetId: owner.id, requestId: 'npc-autonomy:integration:recycle',
    missionId: 'recycle', selectedShips: recyclers, destination: { kind: 'coordinate', coordinate: neighbour.coordinate },
  }, START, FLIGHT_SCALE);
  assert.equal(launch.ok, true, launch.reason ?? '');
  const flight = launch.flight!;
  const arrived = advance(saveReload(launch.state, 'npc-recycle-reload'), flight.arrivalAt).state;
  assert.ok((getEspionageTargets(arrived.espionage)[neighbour.id]!.resources.debris ?? 0) < 5_000, 'debris was collected at arrival');
  const flown = arrived.flights.records.find((record) => record.id === flight.id)!;
  const home = advance(arrived, flown.returnAt!).state;
  const store = getEspionageTargets(home.espionage)[owner.id]!.recycling;
  assert.ok((store?.availableDebris ?? 0) > 0, 'the debris reached the owner\'s recycling store');
  assert.equal(getEspionageTargets(home.espionage)[owner.id]!.resources.debris ?? 0, getEspionageTargets(seeded.espionage)[owner.id]!.resources.debris ?? 0,
    'nothing was dumped into the owner\'s own orbit');
});

function withGarrison(state: SaveState, targetId: string, ships: Partial<SpyTargetState['fleet']['ships']>): SaveState {
  const targets = getEspionageTargets(state.espionage);
  const current = targets[targetId]!;
  return { ...state, espionage: { ...state.espionage!, targets: { ...targets,
    [targetId]: { ...current, fleet: { ...current.fleet, ships: { ...current.fleet.ships, ...ships } } } } } };
}

function playerHomeTarget(state: SaveState) {
  const home = state.planets['helion-01']!;
  return { id: 'helion-01', coordinate: { galaxy: home.universeGalaxy!, system: home.universeSystem!, position: home.universePosition! } };
}

// Audit 26.10 M1: the NPC's return home and saved intelligence surfaced as the player's toasts.
test('NPC flights reach the player only as fights on the player\'s own planets', () => {
  const state = makeCampaign('npc-mission-player-notices');
  const [origin, other] = npcTargets(state);
  assert.ok(origin && other);
  const playerId = state.profile.playerId;
  const forPlayer = (events: ReturnType<typeof advance>['events']) => events.filter((event) => isFlightEventForPlayer(event, playerId));

  // NPC attack on the player: the fight is the player's news, the trip home is not.
  const attack = launchAttack(state, origin, playerHomeTarget(state), 'npc-autonomy:integration:notice-attack');
  const arrived = advance(attack.state, attack.flight.arrivalAt);
  const attackNews = forPlayer(arrived.events);
  assert.deepEqual(attackNews.map((event) => event.status), ['incoming-attack']);
  assert.match(attackNews[0]!.notice, /атакована/);
  assert.doesNotMatch(attackNews[0]!.notice, /Bot 01/);
  const returnAt = arrived.state.flights.records.find((item) => item.id === attack.flight.id)!.returnAt!;
  const returned = advance(arrived.state, returnAt);
  assert.ok(returned.events.some((event) => event.notice === 'Флот NPC вернулся к владельцу.' && isFlightVisibleToPlayer(event.flight, playerId)),
    'reproduction: the NPC return passes the Fleet visibility filter that used to drive toasts');
  assert.deepEqual(forPlayer(returned.events), []);

  // NPC espionage on the player: the report is the NPC's intelligence.
  const spying = withGarrison(state, origin.id, { 'spy-probe': 1 });
  const spy = dispatchNpcMission(spying, {
    ownerId: origin.ownerId, originPlanetId: origin.id, requestId: 'npc-autonomy:integration:notice-spy', missionId: 'espionage',
    selectedShips: { 'spy-probe': 1 }, destination: { kind: 'planet', planetId: 'helion-01', coordinate: playerHomeTarget(state).coordinate },
    targetPlanetId: 'helion-01',
  }, START, FLIGHT_SCALE);
  assert.equal(spy.ok, true, spy.reason ?? undefined);
  const observed = advance(spy.state, spy.flight!.arrivalAt);
  assert.ok(observed.events.some((event) => event.notice === 'Наблюдение NPC сохранено у владельца.' && isFlightVisibleToPlayer(event.flight, playerId)),
    'reproduction: the NPC spy report passes the Fleet visibility filter that used to drive toasts');
  assert.deepEqual(forPlayer(observed.events), []);

  // NPC colonization and NPC-vs-NPC fights are never the player's toasts.
  const coordinate = emptyCoordinate(state);
  const colonizing = { ...state, rating: { ...state.rating, battleAwardsByReportId: { ...state.rating.battleAwardsByReportId,
    'qa-notice-colony-points': { [origin.ownerId]: 500 } } } };
  const colony = dispatchNpcMission(colonizing, {
    ownerId: origin.ownerId, originPlanetId: origin.id, requestId: 'npc-autonomy:integration:notice-colony', missionId: 'colonize',
    selectedShips: { colonizer: 1 }, destination: { kind: 'coordinate', coordinate }, targetKind: 'empty',
  }, START, FLIGHT_SCALE);
  assert.equal(colony.ok, true, colony.reason ?? undefined);
  const colonized = advance(colony.state, colony.flight!.arrivalAt);
  assert.ok(colonized.events.some((event) => event.status === 'colonized'));
  assert.deepEqual(forPlayer(colonized.events), []);

  const npcWar = launchAttack(state, origin, other, 'npc-autonomy:integration:notice-npc-war');
  const fought = advance(npcWar.state, npcWar.flight.arrivalAt);
  assert.ok(fought.events.length > 0);
  assert.deepEqual(forPlayer(fought.events), []);
  const foughtReturn = fought.state.flights.records.find((item) => item.id === npcWar.flight.id)!.returnAt!;
  assert.deepEqual(forPlayer(advance(fought.state, foughtReturn).events), []);
});
