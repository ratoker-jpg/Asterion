import test from 'node:test';
import assert from 'node:assert/strict';
import { createInitialSaveState, createPersistenceFacade } from './persistence.ts';
import { dispatchFlight, reconcileFlights } from './flights.ts';
import { createPirateReconMissionSnapshot, pirateReconOutcomeForMission } from '../domain/pirates/recon.ts';
import { createUniverseSystem, getUniverseTimedObjectSchedule } from '../domain/universe/runtime.ts';
import { getCurrentPirateContact } from './pirates.ts';

class MemoryStorage {
  private values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
  removeItem(key: string) { this.values.delete(key); }
}

type ActivePirateFixture = {
  now: number;
  contactCycleKey: string;
  coordinate: { galaxy: number; system: number; position: number };
  expiresAt: number;
};

function activePirateFixture(system: number): ActivePirateFixture {
  for (let cycleIndex = 0; cycleIndex < 50; cycleIndex += 1) {
    const schedule = getUniverseTimedObjectSchedule('pirate', 1, system, cycleIndex);
    if (!schedule.present) continue;
    const now = schedule.startAt + 1;
    const projection = createUniverseSystem({ galaxy: 1, system, nowMs: now });
    const pirate = projection.positions.find((position) => position.kind === 'pirate');
    if (!pirate?.pirate) continue;
    return {
      now,
      contactCycleKey: pirate.pirate.contactCycleKey,
      coordinate: pirate.coordinate,
      expiresAt: pirate.pirate.expiresAt,
    };
  }
  throw new Error(`Unable to find a present deterministic pirate schedule for system ${system}.`);
}

function requestIdForOutcome(
  ownerId: string,
  contactCycleKey: string,
  dispatchedAt: number,
  outcome: 'success' | 'failure',
): string {
  for (let index = 0; index < 10_000; index += 1) {
    const requestId = `pirate-recon-${outcome}-${index}`;
    const mission = createPirateReconMissionSnapshot({
      missionId: `flight-${requestId}`,
      ownerId,
      contactCycleKey,
      dispatchedAt,
    });
    if (pirateReconOutcomeForMission(mission) === outcome) return requestId;
  }
  throw new Error(`Unable to find a deterministic ${outcome} request id.`);
}

function reconCommand(contact: ActivePirateFixture, requestId: string) {
  return {
    requestId,
    missionId: 'pirate-recon' as const,
    contactCycleKey: contact.contactCycleKey,
    originPlanetId: 'helion-01',
    destination: { kind: 'coordinate' as const, coordinate: contact.coordinate },
    targetKind: 'pirate' as const,
    targetRelation: 'neutral' as const,
    selectedShips: { 'spy-probe': 1 },
    departedAt: contact.now,
  };
}

function dispatchRecon(contact: ActivePirateFixture, requestId: string) {
  const state = createInitialSaveState('production', contact.now);
  const current = getCurrentPirateContact(state, contact.coordinate, contact.now, 'production');
  assert.equal(current?.contactCycleKey, contact.contactCycleKey);
  const command = reconCommand(contact, requestId);
  const sent = dispatchFlight(state, command, { now: contact.now, mode: 'production' });
  if (!sent.ok) throw new Error(sent.error.message);
  return { state, command, sent };
}

function expectedReconRequest(contact: ActivePirateFixture, outcome: 'success' | 'failure') {
  const state = createInitialSaveState('production', contact.now);
  return requestIdForOutcome(state.profile.playerId, contact.contactCycleKey, contact.now, outcome);
}

for (const outcome of ['success', 'failure'] as const) {
  test(`pirate recon ${outcome} is frozen at dispatch and survives save reload and repeated reconciliation`, () => {
    const contact = activePirateFixture(2);
    const requestId = expectedReconRequest(contact, outcome);
    const { state, command, sent } = dispatchRecon(contact, requestId);

    assert.equal(sent.created, true);
    assert.equal(sent.flight.missionId, 'pirate-recon');
    assert.equal(sent.flight.pirateSnapshot?.contactCycleKey, contact.contactCycleKey);
    assert.equal(sent.flight.destinationCoordinate.system, contact.coordinate.system);
    assert.ok(sent.flight.arrivalAt < contact.expiresAt, 'nearby recon should arrive while this contact is active');

    const duplicate = dispatchFlight(sent.state, {
      ...command,
      selectedShips: { 'spy-probe': 0 },
    }, { now: contact.now + 1, mode: 'production' });
    assert.equal(duplicate.ok, true);
    if (!duplicate.ok) return;
    assert.equal(duplicate.created, false);
    assert.equal(duplicate.flight.id, sent.flight.id);

    const storage = new MemoryStorage();
    const persistence = createPersistenceFacade({
      mode: 'production',
      storage,
      now: () => sent.flight.arrivalAt,
    });
    assert.equal(persistence.write(duplicate.state).ok, true);
    const reloaded = persistence.read();
    const reloadedFlight = reloaded.flights.records.find((flight) => flight.id === sent.flight.id);
    assert.deepEqual(reloadedFlight?.pirateSnapshot, sent.flight.pirateSnapshot);

    const arrival = reconcileFlights(reloaded, sent.flight.arrivalAt, undefined, { mode: 'production' });
    assert.equal(arrival.state.pirate?.reconReports.length, 1);
    const report = arrival.state.pirate?.reconReports[0];
    assert.equal(report?.missionId, sent.flight.id);
    assert.equal(report?.contactCycleKey, contact.contactCycleKey);
    assert.equal(report?.outcome, outcome);
    if (outcome === 'success') {
      assert.ok(report?.intel);
      assert.equal(report?.intel?.ships.reduce((sum, ship) => sum + ship.populationPercent, 0), 100);
      assert.ok(report?.intel?.ships.every((ship) => typeof ship.name === 'string' && !('count' in ship)));
    } else {
      assert.equal(report?.intel, undefined, 'failed recon must not reveal a partial profile');
    }

    const replay = reconcileFlights(arrival.state, sent.flight.arrivalAt, undefined, { mode: 'production' });
    assert.equal(replay.changed, false);
    assert.equal(replay.state.pirate?.reconReports.length, 1);
    assert.equal(replay.state.combat.reports.length, state.combat.reports.length);
  });
}
