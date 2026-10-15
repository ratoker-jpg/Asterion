import assert from 'node:assert/strict';
import test from 'node:test';

import { createInitialSaveState, createPersistenceFacade } from './persistence.ts';
import type { StorageLike } from './persistence.ts';
import { replacePlanetState } from './contracts.ts';
import { dispatchPirateFlight, getCurrentPirateContact, resolvePirateFlightAtTarget } from './pirates.ts';
import { isPirateMissionSnapshot, normalizePirateState } from '../domain/pirates/mission.ts';
import type { PirateReconReport } from '../domain/pirates/recon-report.ts';
import { pirateReconCooldownKey } from '../domain/pirates/recon.ts';
import { getUniverseTimedObjectSchedule } from '../domain/universe/runtime.ts';

function fixture() {
  const schedule = Array.from({ length: 100 }, (_, cycleIndex) =>
    getUniverseTimedObjectSchedule('pirate', 1, 2, cycleIndex)).find((item) => item.present);
  assert.ok(schedule);
  const now = schedule.startAt + 1;
  const state = createInitialSaveState('test', now);
  const contact = getCurrentPirateContact(state, { galaxy: 1, system: 2, position: 1 }, now, 'test');
  assert.ok(contact);
  return { state, contact, now };
}

function reconCommand(contact: NonNullable<ReturnType<typeof getCurrentPirateContact>>, now: number, requestId = 'recon-1') {
  return {
    requestId,
    missionId: 'pirate-recon' as const,
    contactCycleKey: contact.contactCycleKey,
    originPlanetId: 'helion-01',
    destination: { kind: 'coordinate' as const, coordinate: { ...contact.coordinate } },
    targetKind: 'pirate' as const,
    targetRelation: 'neutral' as const,
    selectedShips: { 'spy-probe': 1 },
    departedAt: now,
  };
}

test('pirate recon dispatch freezes its contact and enforces one in-flight probe per cycle', () => {
  const { state: initialState, contact, now } = fixture();
  const origin = initialState.planets['helion-01']!;
  const state = replacePlanetState(initialState, 'helion-01', {
    ...origin,
    fleet: {
      ...origin.fleet,
      ships: { ...origin.fleet.ships, 'spy-probe': 2 },
    },
  });
  const launched = dispatchPirateFlight(state, reconCommand(contact, now), { now, mode: 'test' });
  assert.equal(launched.ok, true);
  if (!launched.ok) return;
  assert.equal(launched.flight.missionId, 'pirate-recon');
  assert.equal(launched.flight.pirateSnapshot?.contactCycleKey, contact.contactCycleKey);
  assert.equal(launched.flight.pirateSnapshot?.coordinate.position, contact.coordinate.position);
  assert.equal(isPirateMissionSnapshot(launched.flight.pirateSnapshot, 'pirate-recon'), true);

  const repeatedRequest = dispatchPirateFlight(
    launched.state,
    reconCommand(contact, now, 'recon-1'),
    { now, mode: 'test' },
  );
  assert.equal(repeatedRequest.ok, true);
  if (repeatedRequest.ok) assert.equal(repeatedRequest.created, false);

  const parallelProbe = dispatchPirateFlight(
    launched.state,
    reconCommand(contact, now + 120_001, 'recon-2'),
    { now: now + 120_001, mode: 'test' },
  );
  assert.equal(parallelProbe.ok, false);
  if (!parallelProbe.ok) assert.equal(parallelProbe.error.code, 'spy-report-cooldown');
});

test('expired recon arrival persists the exact no-target report without exposing intel', () => {
  const { state, contact, now } = fixture();
  const launched = dispatchPirateFlight(state, reconCommand(contact, now), { now, mode: 'test' });
  assert.equal(launched.ok, true);
  if (!launched.ok) return;
  const arrivalAt = Math.max(launched.flight.arrivalAt, contact.expiresAt + 1);
  const arrived = resolvePirateFlightAtTarget(launched.state, launched.flight, arrivalAt);
  assert.equal(arrived.status, 'no-target');
  assert.equal(arrived.notice, 'По указанным координатам планеты пиратов не обнаружено');
  const report = arrived.report as PirateReconReport;
  assert.equal(report.outcome, 'no-target');
  assert.equal('intel' in report, false);
  assert.equal(arrived.state.pirate?.reconReports.length, 1);
});

test('future and out-of-cycle cooldown timestamps cannot lock a new contact', () => {
  const { state, contact, now } = fixture();
  const cooldownKey = pirateReconCooldownKey(state.profile.playerId, contact.contactCycleKey);
  const futureDispatchState = {
    ...state,
    pirate: {
      ...state.pirate!,
      reconLastDispatchAt: { [cooldownKey]: now + 120_001 },
    },
  };
  const launched = dispatchPirateFlight(
    futureDispatchState,
    reconCommand(contact, now),
    { now, mode: 'test' },
  );
  assert.equal(launched.ok, true);

  const normalized = normalizePirateState({
    version: 1,
    contact: state.pirate!.contact,
    reconReports: [],
    reconLastDispatchAt: { [cooldownKey]: Number.MAX_SAFE_INTEGER },
  });
  assert.equal(Object.hasOwn(normalized.reconLastDispatchAt, cooldownKey), false);
});

test('invalid pirate snapshots are dropped without resetting the saved colony', () => {
  const { state, contact, now } = fixture();
  const launched = dispatchPirateFlight(state, reconCommand(contact, now), { now, mode: 'test' });
  assert.equal(launched.ok, true);
  if (!launched.ok) return;
  const record = launched.state.flights.records.find((candidate) => candidate.id === launched.flight.id)!;
  const brokenRecord = {
    ...record,
    pirateSnapshot: {
      ...record.pirateSnapshot!,
      coordinate: { ...record.pirateSnapshot!.coordinate, system: 999 },
    },
  };
  assert.equal(isPirateMissionSnapshot(brokenRecord.pirateSnapshot, 'pirate-recon'), false);

  const corruptedState = {
    ...launched.state,
    flights: {
      ...launched.state.flights,
      records: launched.state.flights.records.map((candidate) =>
        candidate.id === record.id ? brokenRecord : candidate),
    },
  };
  const stored = new Map<string, string>();
  const storage: StorageLike = {
    getItem: (key) => stored.get(key) ?? null,
    setItem: (key, value) => { stored.set(key, value); },
    removeItem: (key) => { stored.delete(key); },
  };
  const persistence = createPersistenceFacade({ mode: 'test', storage, now: () => now });
  assert.equal(persistence.write(corruptedState).ok, true);
  const hydrated = persistence.read();
  assert.equal(hydrated.metal, launched.state.metal);
  assert.equal(hydrated.planets['helion-01']?.name, launched.state.planets['helion-01']?.name);
  assert.equal(hydrated.planets['helion-01']?.fleet.ships['spy-probe'], launched.state.planets['helion-01']?.fleet.ships['spy-probe']);
  assert.equal(hydrated.flights.records.some((candidate) => candidate.id === record.id), false);
});
