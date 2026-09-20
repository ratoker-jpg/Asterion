import test from 'node:test';
import assert from 'node:assert/strict';
import { createInitialSaveState } from './persistence.ts';
import {
  dispatchFlight,
  reconcileFlights,
  recallFlight,
  requestSpyReport,
} from './flights.ts';
import { activeSpyMissionForTarget } from '../domain/espionage/runtime.ts';

function spyCommand(state: ReturnType<typeof createInitialSaveState>, requestId: string, targetId: string) {
  const target = state.espionage!.bot01Planets![targetId];
  return {
    requestId,
    missionId: 'espionage' as const,
    originPlanetId: state.currentPlanetId,
    destination: { kind: 'planet' as const, planetId: target.id, coordinate: target.coordinate },
    targetRelation: 'neutral' as const,
    targetKind: 'npc' as const,
    targetOwnerId: target.ownerId,
    targetOwnerName: target.ownerName,
    targetPlanetName: target.name,
    targetRaceId: target.raceId,
    targetAlliance: target.alliance,
    selectedShips: { 'spy-probe': 1 },
    departedAt: 1_000,
  };
}

test('same target stays blocked through transit and returning, then unlocks after actual return', () => {
  let state = createInitialSaveState('test', 1_000);
  const targetId = Object.keys(state.espionage!.bot01Planets!)[1];
  const first = dispatchFlight(state, spyCommand(state, 'spy-a', targetId), { now: 1_000, mode: 'test', testTimeScale: 15 });
  assert.equal(first.ok, true);
  if (!first.ok) return;
  state = first.state;
  const blocked = dispatchFlight(state, spyCommand(state, 'spy-b', targetId), { now: 1_001, mode: 'test', testTimeScale: 15 });
  assert.equal(blocked.ok, false);
  assert.equal(activeSpyMissionForTarget(state.espionage!.missions, state.profile.playerId, targetId)?.status, 'transit');

  const arrived = reconcileFlights(state, first.flight.arrivalAt, () => 99);
  assert.equal(arrived.changed, true);
  state = arrived.state;
  const mission = state.espionage!.missions[0];
  assert.equal(mission.status, 'orbiting');
  const immediate = requestSpyReport(state, mission.id, { now: first.flight.arrivalAt + 4_999, rng: () => 99 });
  assert.equal(immediate.ok, false);
  const atBoundary = requestSpyReport(state, mission.id, { now: first.flight.arrivalAt + 5_000, rng: () => 99 });
  assert.equal(atBoundary.ok, true);
  if (!atBoundary.ok) return;
  state = atBoundary.state;
  const recall = recallFlight(state, first.flight.id, { now: first.flight.arrivalAt + 5_000 });
  assert.equal(recall.ok, true);
  if (!recall.ok) return;
  state = recall.state;
  const blockedReturning = dispatchFlight(state, spyCommand(state, 'spy-c', targetId), { now: recall.flight.returnAt! - 1, mode: 'test', testTimeScale: 15 });
  assert.equal(blockedReturning.ok, false);
  state = reconcileFlights(state, recall.flight.returnAt!, () => 99).state;
  assert.equal(state.espionage!.missions[0].status, 'returned');
  assert.equal(state.planets['helion-01'].fleet.ships['spy-probe'], 1);
  const second = dispatchFlight(state, spyCommand(state, 'spy-d', targetId), { now: recall.flight.returnAt! + 1, mode: 'test', testTimeScale: 15 });
  assert.equal(second.ok, true);
});

test('automatic arrival report can be intercepted by Hunter and destroys the probe', () => {
  const initial = createInitialSaveState('test', 1_000);
  const targetId = Object.keys(initial.espionage!.bot01Planets!)[0];
  const dispatched = dispatchFlight(initial, spyCommand(initial, 'spy-hunter', targetId), { now: 1_000, mode: 'test', testTimeScale: 15 });
  assert.equal(dispatched.ok, true);
  if (!dispatched.ok) return;
  const reconciled = reconcileFlights(dispatched.state, dispatched.flight.arrivalAt, () => 0);
  assert.equal(reconciled.state.espionage!.missions[0].status, 'destroyed');
  assert.equal(reconciled.state.espionage!.hunterNotices.length, 1);
  assert.equal(reconciled.state.flights.records[0].completionReason, 'spy-destroyed');
  assert.equal(reconciled.state.planets['helion-01']?.fleet.ships['spy-probe'], 0);
});

test('full report is an immutable permitted snapshot and later reconcile keeps the probe orbiting', () => {
  let state = createInitialSaveState('test', 1_000);
  state = {
    ...state,
    science: { ...state.science, levels: { ...state.science.levels, 5: 10 } },
  };
  const targetId = Object.keys(state.espionage!.bot01Planets!)[1];
  const dispatched = dispatchFlight(state, spyCommand(state, 'spy-full', targetId), { now: 1_000, mode: 'test', testTimeScale: 15 });
  assert.equal(dispatched.ok, true);
  if (!dispatched.ok) return;
  const rolls = [99, 0];
  const arrived = reconcileFlights(dispatched.state, dispatched.flight.arrivalAt, () => rolls.shift() ?? 99);
  assert.equal(arrived.events[0]?.status, 'spy-report');
  const report = arrived.state.espionage!.reports[0];
  assert.equal(report.quality, 'full');
  assert.equal(report.sourcePlanetId, state.currentPlanetId);
  assert.equal(report.resources.developmentEnergy > 0, true);
  assert.equal('buildings' in report, false);
  assert.equal(Boolean(report.fleet), true);
  assert.equal(Boolean(report.defense), true);
  assert.equal(Boolean(report.population), true);
  assert.equal(arrived.state.espionage!.missions[0].status, 'orbiting');

  const later = reconcileFlights(arrived.state, dispatched.flight.arrivalAt + 1, () => 99);
  assert.equal(later.changed, false);
  assert.equal(later.state.flights.records[0].phase, 'arrived');
  assert.equal(later.state.espionage!.missions[0].status, 'orbiting');
});

test('one owner cannot send a second active probe from another origin to the same target', () => {
  let state = createInitialSaveState('test', 1_000);
  const targetId = Object.keys(state.espionage!.bot01Planets!)[1];
  const secondOriginId = 'test-origin-02';
  const homeworld = state.planets[state.currentPlanetId];
  state = {
    ...state,
    planets: {
      ...state.planets,
      [secondOriginId]: {
        ...homeworld,
        name: 'Helion 02',
        fleet: { ...homeworld.fleet, ships: { ...homeworld.fleet.ships, 'spy-probe': (homeworld.fleet.ships['spy-probe'] ?? 0) + 1 } },
      },
    },
  };
  const first = dispatchFlight(state, spyCommand(state, 'spy-owner-a', targetId), { now: 1_000, mode: 'test', testTimeScale: 15 });
  assert.equal(first.ok, true);
  if (!first.ok) return;
  const second = dispatchFlight(first.state, { ...spyCommand(first.state, 'spy-owner-b', targetId), originPlanetId: secondOriginId }, { now: 1_001, mode: 'test', testTimeScale: 15 });
  assert.equal(second.ok, false);
  if (second.ok) return;
  assert.equal(second.error.code, 'spy-target-blocked');
});
