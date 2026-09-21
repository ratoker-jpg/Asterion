import test from 'node:test';
import assert from 'node:assert/strict';
import { createInitialSaveState } from './persistence.ts';
import { dispatchFlight, recallFlight, reconcileFlights } from './flights.ts';
import { getPlanetResources, replacePlanetResources } from './contracts.ts';
import { selectCurrentAlliance } from '../domain/command/selectors.ts';
import type { FlightDestination } from '../domain/flights/types.ts';

function attackCommand(state: ReturnType<typeof createInitialSaveState>, requestId: string, targetId: string) {
  const target = state.espionage!.targets![targetId];
  const destination: FlightDestination = { kind: 'planet', planetId: target.id, coordinate: target.coordinate };
  return {
    requestId,
    missionId: 'attack' as const,
    originPlanetId: state.currentPlanetId,
    destination,
    targetRelation: 'neutral' as const,
    targetOwnerId: target.ownerId,
    selectedShips: { scout: 10 },
    selectedCommanders: {},
    maxRounds: 5 as const,
    departedAt: 1_000,
  };
}

function weakenTarget(state: ReturnType<typeof createInitialSaveState>, targetId: string) {
  const target = state.espionage!.targets![targetId];
  const ships = { ...target.fleet.ships };
  Object.keys(ships).forEach((id) => { ships[id as keyof typeof ships] = 0; });
  const commanders = { ...target.fleet.commanders };
  Object.keys(commanders).forEach((id) => { commanders[id as keyof typeof commanders] = 0; });
  const defenses = { ...target.defense.defenses };
  Object.keys(defenses).forEach((id) => { defenses[id as keyof typeof defenses] = 0; });
  const weakTarget = {
    ...target,
    fleet: { ...target.fleet, ships: { ...ships, scout: 1 }, commanders },
    defense: { ...target.defense, defenses },
    commanders: {},
    population: { total: 2, fleet: 2, defense: 0 },
  };
  return {
    ...state,
    espionage: {
      ...state.espionage!,
      targets: { ...state.espionage!.targets, [targetId]: weakTarget },
      bot01Planets: { ...state.espionage!.bot01Planets, [targetId]: weakTarget },
    },
  };
}

test('attack resolves one live combat, records debris/repair, and credits loot only on return', () => {
  const state = createInitialSaveState('test', 1_000);
  const targetId = Object.keys(state.espionage!.targets!)[0];
  const sent = dispatchFlight(state, attackCommand(state, 'attack-acceptance-1', targetId), {
    now: 1_000,
    mode: 'test',
    testTimeScale: 15,
  });
  assert.equal(sent.ok, true);
  if (!sent.ok) return;

  const arrival = reconcileFlights(sent.state, sent.flight.arrivalAt, undefined, {
    mode: 'test',
    testTimeScale: 15,
  });
  assert.equal(arrival.events[0]?.status, 'arrived');
  assert.equal(arrival.state.combat.reports.length, state.combat.reports.length + 1);
  const report = arrival.state.combat.reports.at(-1)!;
  assert.equal(report.missionType, 'attack');
  assert.equal(report.id, `battle-attack-${sent.flight.id}`);
  assert.equal(arrival.state.flights.records[0]?.phase, 'returning');
  assert.equal(arrival.state.flights.records[0]?.attackResolution?.reportId, report.id);
  assert.ok(arrival.state.espionage!.targets![targetId].repair?.claimedBattleIds.includes(report.id));

  const replay = reconcileFlights(arrival.state, sent.flight.arrivalAt, undefined, { mode: 'test', testTimeScale: 15 });
  assert.equal(replay.changed, false);
  assert.equal(replay.state.combat.reports.length, arrival.state.combat.reports.length);

  const returned = reconcileFlights(arrival.state, arrival.state.flights.records[0].returnAt!, undefined, {
    mode: 'test',
    testTimeScale: 15,
  });
  assert.equal(returned.state.flights.records[0]?.phase, 'completed');
  assert.equal(returned.state.flights.records[0]?.attackResolution?.lootCreditedAt, arrival.state.flights.records[0].returnAt);
  const returnedAgain = reconcileFlights(returned.state, arrival.state.flights.records[0].returnAt! + 1, undefined, { mode: 'test', testTimeScale: 15 });
  assert.equal(returnedAgain.changed, false);
  assert.equal(returnedAgain.state.combat.reports.length, returned.state.combat.reports.length);
});

test('attack arrival re-checks diplomacy and returns without combat after a target becomes allied', () => {
  const state = createInitialSaveState('test', 1_000);
  const targetId = Object.keys(state.espionage!.targets!)[1];
  const sent = dispatchFlight(state, attackCommand(state, 'attack-diplomacy-1', targetId), { now: 1_000, mode: 'test', testTimeScale: 15 });
  assert.equal(sent.ok, true);
  if (!sent.ok) return;
  const alliance = selectCurrentAlliance(state.command);
  const target = sent.state.espionage!.targets![targetId];
  const alliedTarget = { ...target, alliance };
  const changedDiplomacy = {
    ...sent.state,
    espionage: {
      ...sent.state.espionage!,
      targets: { ...sent.state.espionage!.targets, [targetId]: alliedTarget },
      bot01Planets: { ...sent.state.espionage!.bot01Planets, [targetId]: alliedTarget },
    },
  };
  const arrival = reconcileFlights(changedDiplomacy, sent.flight.arrivalAt, undefined, { mode: 'test', testTimeScale: 15 });
  assert.equal(arrival.events[0]?.status, 'target-unavailable');
  assert.equal(arrival.state.combat.reports.length, state.combat.reports.length);
  assert.equal(arrival.state.flights.records[0]?.phase, 'returning');
  assert.equal(arrival.state.flights.records[0]?.attackResolution, undefined);
});

test('attack coordinates resolve only to an authoritative planet target', () => {
  const state = createInitialSaveState('test', 1_000);
  const target = Object.values(state.espionage!.targets!)[0];
  const command = {
    ...attackCommand(state, 'attack-coordinate-1', target.id),
    destination: { kind: 'coordinate' as const, coordinate: target.coordinate },
    targetOwnerId: 'stale-owner-metadata',
    targetRelation: undefined,
  };
  const sent = dispatchFlight(state, command, { now: 1_000, mode: 'test', testTimeScale: 15 });
  assert.equal(sent.ok, true);
  if (!sent.ok) return;
  assert.deepEqual(sent.flight.destination, { kind: 'planet', planetId: target.id, coordinate: target.coordinate });
  assert.equal(sent.flight.destinationPlanetId, target.id);
});

test('attacker victory reserves ordered loot until the surviving fleet returns', () => {
  const base = createInitialSaveState('test', 1_000);
  const targetId = Object.keys(base.espionage!.targets!)[0];
  const weakened = weakenTarget(base, targetId);
  const originId = weakened.currentPlanetId;
  const initial = replacePlanetResources(weakened, originId, { ...getPlanetResources(weakened, originId), metal: 1_000 });
  const sent = dispatchFlight(initial, attackCommand(initial, 'attack-loot-1', targetId), { now: 1_000, mode: 'test', testTimeScale: 15 });
  assert.equal(sent.ok, true);
  if (!sent.ok) return;

  const arrival = reconcileFlights(sent.state, sent.flight.arrivalAt, undefined, { mode: 'test', testTimeScale: 15 });
  const report = arrival.state.combat.reports.at(-1)!;
  const resolution = arrival.state.flights.records[0]?.attackResolution!;
  const lootTotal = resolution.loot.metal + resolution.loot.minerals + resolution.loot.gas;
  assert.equal(report.winner, 'attacker');
  assert.ok(lootTotal > 0);
  assert.ok(resolution.loot.metal <= Math.floor(10_000_000 * 0.75));
  assert.ok(arrival.state.espionage!.targets![targetId].resources.metal < 10_000_000);

  const originBeforeReturn = getPlanetResources(arrival.state, initial.currentPlanetId).metal;
  const returnAt = arrival.state.flights.records[0]?.returnAt;
  if (returnAt === undefined) return;
  const returned = reconcileFlights(arrival.state, returnAt, undefined, { mode: 'test', testTimeScale: 15 });
  assert.equal(getPlanetResources(returned.state, initial.currentPlanetId).metal, originBeforeReturn + resolution.loot.metal);
});

test('recall before attack arrival returns without combat or report', () => {
  const state = createInitialSaveState('test', 1_000);
  const targetId = Object.keys(state.espionage!.targets!)[0];
  const sent = dispatchFlight(state, attackCommand(state, 'attack-recall-1', targetId), { now: 1_000, mode: 'test', testTimeScale: 15 });
  assert.equal(sent.ok, true);
  if (!sent.ok) return;
  const recalled = recallFlight(sent.state, sent.flight.id, { now: sent.flight.departedAt + 100, mode: 'test', testTimeScale: 15 });
  assert.equal(recalled.ok, true);
  if (!recalled.ok) return;
  const afterArrivalTime = reconcileFlights(recalled.state, sent.flight.arrivalAt, undefined, { mode: 'test', testTimeScale: 15 });
  assert.equal(afterArrivalTime.state.combat.reports.length, state.combat.reports.length);
  assert.equal(afterArrivalTime.state.flights.records[0]?.phase, 'completed');
  assert.equal(afterArrivalTime.state.flights.records[0]?.completionReason, 'recalled');
});

test('Test Mode Bot 01 starts at the requested resource scale and ticks normally', () => {
  const state = createInitialSaveState('test', 1_000);
  const target = Object.values(state.espionage!.targets!)[0];
  assert.ok(target.resources.metal >= 10_000_000);
  const later = reconcileFlights(state, 1_000 + 60 * 60 * 1000, undefined, {
    mode: 'test',
    testTimeScale: 1,
    reconcileTargetResources: true,
  });
  const updated = later.state.espionage!.targets![target.id];
  assert.ok(updated.resources.metal > target.resources.metal);
  assert.equal(updated.resourceClock?.lastReconciledAt, 1_000 + 60 * 60 * 1000);
});
