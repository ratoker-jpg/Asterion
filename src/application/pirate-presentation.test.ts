import test from 'node:test';
import assert from 'node:assert/strict';
import { createInitialSaveState } from './persistence.ts';
import { dispatchFlight, reconcileFlights } from './flights.ts';
import { isPirateOperationId, pirateContactOperation, pirateCycleOperation, pirateOperationId, selectOwnedPiratePresentations, selectOwnedPirateSystems, selectOwnedPirateTargets, selectPirateContacts } from './pirate-presentation.ts';
import { getCurrentPirateContact } from './pirates.ts';
import { createColonyPlanetRuntime, selectOwnedPlanet } from './owned-planets.ts';
import { getUniverseTimedObjectSchedule } from '../domain/universe/runtime.ts';
import { buildReportsFeed } from '../domain/reports/adapters.ts';

function activeContactFixture() {
  for (let system = 2; system < 40; system += 1) {
    for (let cycleIndex = 0; cycleIndex < 80; cycleIndex += 1) {
      const schedule = getUniverseTimedObjectSchedule('pirate', 1, system, cycleIndex);
      if (!schedule.present) continue;
      const now = schedule.startAt + 1;
      const state = createInitialSaveState('production', now);
      const contact = getCurrentPirateContact(state, { galaxy: 1, system, position: 1 }, now, 'production');
      if (contact) return { state, contact, now };
    }
  }
  throw new Error('Could not find a deterministic active pirate contact for the test.');
}

function withCurrentOrigin(
  state: ReturnType<typeof createInitialSaveState>,
  planetId: string,
  system: number,
  probeCount: number,
  gas: number,
) {
  const colony = createColonyPlanetRuntime(state, { galaxy: 1, system, position: 1 });
  const withColony = {
    ...state,
    planets: {
      ...state.planets,
      [planetId]: {
        ...colony,
        fleet: { ...colony.fleet, ships: { ...colony.fleet.ships, 'spy-probe': probeCount } },
        resources: { ...(colony.resources ?? { metal: 0, minerals: 0, gas: 0 }), gas },
      },
    },
    queues: { ...state.queues, [planetId]: [] },
  };
  return selectOwnedPlanet(withColony, planetId);
}

function contactPresentation(state: ReturnType<typeof createInitialSaveState>, now: number, system: number) {
  const contact = getCurrentPirateContact(state, { galaxy: 1, system, position: 1 }, now, 'production');
  assert.ok(contact);
  const presentation = selectPirateContacts(state, now, { galaxy: 1, system })
    .find((item) => item.contactCycleKey === contact.contactCycleKey);
  assert.ok(presentation);
  return presentation;
}

test('pirate recon availability previews the selected colony probe and fuel', () => {
  const { state, contact, now } = activeContactFixture();

  // A different colony owns a probe, but the currently selected homeworld does not.
  const homeworldNoProbe = {
    ...state,
    planets: {
      ...state.planets,
      'helion-01': {
        ...state.planets['helion-01']!,
        fleet: { ...state.planets['helion-01']!.fleet, ships: { ...state.planets['helion-01']!.fleet.ships, 'spy-probe': 0 } },
      },
    },
  };
  const withOtherColony = withCurrentOrigin(homeworldNoProbe, 'colony-40-1', 40, 1, 10_000);
  const selectedHomeworld = { ...withOtherColony, currentPlanetId: 'helion-01' };
  const noProbe = contactPresentation(selectedHomeworld, now, contact.coordinate.system);
  assert.equal(noProbe.recon.enabled, false);
  assert.match(noProbe.recon.disabledReason ?? '', /недостаточно выбранных кораблей/i);

  const probeNoFuel = withCurrentOrigin(state, 'colony-40-1', 40, 1, 0);
  const noFuel = contactPresentation(probeNoFuel, now, contact.coordinate.system);
  assert.equal(noFuel.recon.enabled, false);
  assert.match(noFuel.recon.disabledReason ?? '', /газа/i);

  const selectedColonyWithProbe = withCurrentOrigin(state, 'colony-40-1', 40, 1, 100_000);
  const eligible = contactPresentation(selectedColonyWithProbe, now, contact.coordinate.system);
  assert.equal(eligible.recon.enabled, true);
  assert.equal(eligible.recon.disabledReason, null);
});

test('stale pirate elimination appears as a persisted no-target flight message without a battle report', () => {
  const { state, contact, now } = activeContactFixture();
  const targetColony = createColonyPlanetRuntime(state, { galaxy: contact.coordinate.galaxy,
    system: contact.coordinate.system, position: contact.coordinate.position === 1 ? 2 : 1 });
  const eligibleState = { ...state, planets: { ...state.planets, 'stale-flight-colony': targetColony } };
  const ownedContact = getCurrentPirateContact(eligibleState, contact.coordinate, now, 'production');
  assert.ok(ownedContact);
  assert.equal(ownedContact.contactCycleKey, contact.contactCycleKey);
  const dispatched = dispatchFlight(eligibleState, {
    requestId: 'pirate-no-target-history',
    missionId: 'pirate-elimination',
    contactCycleKey: ownedContact.contactCycleKey,
    originPlanetId: 'helion-01',
    destination: { kind: 'coordinate', coordinate: ownedContact.coordinate },
    targetKind: 'pirate',
    targetRelation: 'neutral',
    selectedShips: { scout: 1 },
  }, { now, mode: 'production' });
  assert.equal(dispatched.ok, true, dispatched.ok ? '' : dispatched.error.message);
  if (!dispatched.ok) return;

  // Model a saved outbound flight whose arrival is after the pinned contact expired.
  const arrivalAt = Math.max(dispatched.flight.arrivalAt, contact.expiresAt + 1);
  const outbound = {
    ...dispatched.flight,
    oneWayDurationMs: arrivalAt - dispatched.flight.departedAt,
    arrivalAt,
  };
  const delayedState = {
    ...dispatched.state,
    flights: {
      ...dispatched.state.flights,
      records: dispatched.state.flights.records.map((flight) => flight.id === outbound.id ? outbound : flight),
    },
  };
  const atArrival = reconcileFlights(delayedState, arrivalAt, undefined, { mode: 'production' });
  assert.equal(atArrival.state.combat.reports.length, state.combat.reports.length);
  const returning = atArrival.state.flights.records.find((flight) => flight.id === outbound.id);
  assert.equal(returning?.completionReason, 'target-unavailable');
  assert.equal(returning?.phase, 'returning');

  const atReturn = reconcileFlights(atArrival.state, returning!.returnAt!, undefined, { mode: 'production' });
  const items = buildReportsFeed(
    atReturn.state.combat.reports,
    atReturn.state.operations,
    atReturn.state.command,
    atReturn.state.espionage,
    [], [], [], [], atReturn.state.flights.records,
  );
  const noTarget = items.find((item) => item.id === `pirate-no-target:${outbound.id}`);
  assert.ok(noTarget);
  assert.equal(noTarget.body, 'По указанным координатам планеты пиратов не обнаружено');
  assert.equal(atReturn.state.combat.reports.length, state.combat.reports.length);
  assert.equal(items.some((item) => item.category === 'battle'), false);
});

test('eligible pirate systems derive solely from owned planets, with per-system deduplication', () => {
  const { state, contact, now } = activeContactFixture();
  const pirateSystem = contact.coordinate.system;
  const withoutColony = selectOwnedPirateTargets(state, now);
  assert.ok(withoutColony.every((item) => item.coordinate.system === 1));
  assert.equal(withoutColony.some((item) => item.contactCycleKey === contact.contactCycleKey), false);

  const colony = createColonyPlanetRuntime(state, { galaxy: 1, system: pirateSystem, position: 1 });
  const withColony = {
    ...state,
    planets: { ...state.planets, 'pirate-colony-a': colony, 'pirate-colony-b': { ...colony, universePosition: 2 } },
  };
  assert.equal(selectOwnedPirateSystems(withColony).filter(({ system }) => system === pirateSystem).length, 1);
  assert.equal(selectOwnedPirateTargets(withColony, now).filter((item) => item.contactCycleKey === contact.contactCycleKey).length, 1);
  assert.equal(selectOwnedPiratePresentations(withColony, now).filter((item) => item.contactCycleKey === contact.contactCycleKey).length, 1);
  assert.equal(selectOwnedPirateTargets({ ...withColony, planets: {} }, now).length, 0);
  assert.equal(selectOwnedPirateSystems({ ...withColony, planets: {} }).length, 0);
});

test('a combat raid cannot be dispatched to a foreign system even with a valid cycle key', () => {
  const { state, contact, now } = activeContactFixture();
  const sent = dispatchFlight(state, {
    requestId: 'pirate-foreign-raid-blocked',
    missionId: 'pirate-elimination',
    contactCycleKey: contact.contactCycleKey,
    originPlanetId: state.currentPlanetId,
    destination: { kind: 'coordinate', coordinate: contact.coordinate },
    targetKind: 'pirate',
    targetRelation: 'neutral',
    selectedShips: { scout: 1 },
  }, { now, mode: 'production' });
  assert.equal(sent.ok, false);
  if (!sent.ok) {
    assert.equal(sent.error.code, 'target-not-available');
    assert.match(sent.error.message, /системах ваших колоний/);
  }
});

test('real pirate contact projects to the existing operation without a fabricated payout', () => {
  const { state, contact, now } = activeContactFixture();
  const shown = contactPresentation(state, now, contact.coordinate.system);
  const available = pirateContactOperation(shown);
  const accepted = pirateContactOperation(shown, 'active');
  assert.equal(available.id, pirateOperationId(contact.contactCycleKey));
  assert.equal(isPirateOperationId(available.id), true);
  assert.equal(available.state, 'available');
  assert.equal(accepted.state, 'active');
  assert.equal(accepted.location.kind, 'coordinates');
  assert.equal(accepted.threat, null);
  assert.deepEqual(accepted.rewardPreview, {});
  const defeated = pirateCycleOperation(contact.contactCycleKey, contact.coordinate, 'completed');
  assert.equal(defeated.id, accepted.id);
  assert.equal(defeated.state, 'completed');
  assert.notEqual(pirateOperationId('pirate-cycle-v1:1:2:1:1001'), available.id);
});
