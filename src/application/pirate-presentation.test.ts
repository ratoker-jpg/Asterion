import test from 'node:test';
import assert from 'node:assert/strict';
import { createInitialSaveState } from './persistence.ts';
import { dispatchFlight, reconcileFlights } from './flights.ts';
import { selectPirateContacts } from './pirate-presentation.ts';
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
  const dispatched = dispatchFlight(state, {
    requestId: 'pirate-no-target-history',
    missionId: 'pirate-elimination',
    contactCycleKey: contact.contactCycleKey,
    originPlanetId: 'helion-01',
    destination: { kind: 'coordinate', coordinate: contact.coordinate },
    targetKind: 'pirate',
    targetRelation: 'neutral',
    selectedShips: { scout: 1 },
  }, { now, mode: 'production' });
  assert.equal(dispatched.ok, true);
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
