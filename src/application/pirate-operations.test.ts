import assert from 'node:assert/strict';
import test from 'node:test';

import { createInitialSaveState, createPersistenceFacade } from './persistence.ts';
import { dispatchFlight, reconcileFlights } from './flights.ts';
import { reconcileRuntime } from './reconcile.ts';
import { dispatchPirateRaidDue, markPirateContactDefeated } from './pirate-operations.ts';
import { replacePlanetState, type SaveState } from './contracts.ts';
import { createEmptyFleetState } from '../domain/fleet/runtime.ts';
import { selectOwnerScores } from '../domain/rating/scoring.ts';
import { createPirateProfile } from '../domain/pirates/profile.ts';
import { createDefaultPirateOperationsState, PIRATE_MISSING_TARGET_REPORT_TEXT, type PirateContactCycleSnapshot } from '../domain/pirates/state.ts';
import { pirateContactCycleKey, resolvePirateRecon } from '../domain/pirates/contact-rules.ts';
import { PIRATE_CATALOG_BY_ID } from '../domain/pirates/catalog.ts';
import { getUniverseTimedObjectSchedule } from '../domain/universe/runtime.ts';

class MemoryStorage {
  private values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
  removeItem(key: string) { this.values.delete(key); }
}

function withActiveContact(state: SaveState, cycleIndex: number, coordinate = { galaxy: 1, system: 7, position: 12 }, startedAt = 1_000) {
  const ownerId = state.profile.playerId;
  const cycleKey = pirateContactCycleKey(coordinate.galaxy, coordinate.system, cycleIndex);
  const score = selectOwnerScores(state)[ownerId]!;
  const profile = createPirateProfile({ ownerId, contactCycleKey: cycleKey, score });
  const cycle: PirateContactCycleSnapshot = {
    cycleKey,
    cycleIndex,
    coordinate,
    startedAt,
    expiresAt: startedAt + 60 * 60_000,
    respawnAt: startedAt + 75 * 60_000,
    ownersById: { [ownerId]: { profile } },
  };
  const ledger = state.pirateOperations ?? createDefaultPirateOperationsState(startedAt);
  return {
    state: {
      ...state,
      pirateOperations: { ...ledger, cyclesByKey: { ...ledger.cyclesByKey, [cycleKey]: cycle } },
    } as SaveState,
    cycle,
    profile,
  };
}

function withSpyProbes(state: SaveState, count: number): SaveState {
  const planet = state.planets['helion-01'];
  const empty = createEmptyFleetState();
  return replacePlanetState(state, 'helion-01', {
    ...planet,
    fleet: {
      ...planet.fleet,
      ships: { ...planet.fleet.ships, ...empty.ships, 'spy-probe': count },
      commanders: { ...planet.fleet.commanders, ...empty.commanders },
    },
  });
}

function reconCommand(requestId: string, cycle: PirateContactCycleSnapshot, departedAt: number) {
  return {
    requestId,
    missionId: 'pirate-recon' as const,
    originPlanetId: 'helion-01',
    destination: { kind: 'coordinate' as const, coordinate: cycle.coordinate },
    targetKind: 'pirate' as const,
    selectedShips: { 'spy-probe': 1 as const },
    pirateContactCycleKey: cycle.cycleKey,
    departedAt,
  };
}

test('pirate contact owner check rolls once at +15 minutes and replay creates no duplicate raid', () => {
  let contactSchedule: ReturnType<typeof getUniverseTimedObjectSchedule> | undefined;
  let contactCycleIndex = 0;
  for (; contactCycleIndex < 64; contactCycleIndex += 1) {
    const schedule = getUniverseTimedObjectSchedule('pirate', 1, 1, contactCycleIndex);
    if (schedule.present) {
      contactSchedule = schedule;
      break;
    }
  }
  assert.ok(contactSchedule);
  if (!contactSchedule) return;

  const state = createInitialSaveState('production', contactSchedule.startAt);
  const checkAt = contactSchedule.startAt + 15 * 60_000;
  const context = { planetId: 'helion-01', now: checkAt, mode: 'production' as const, testTimeScale: 15 as const };
  const checked = reconcileRuntime(state, context);
  const cycleKey = pirateContactCycleKey(1, 1, contactCycleIndex);
  const owner = checked.state.pirateOperations?.cyclesByKey[cycleKey]?.ownersById[state.profile.playerId];
  assert.ok(owner?.raidRoll);
  assert.equal(owner?.raidRoll?.checkedAt, checkAt);
  assert.equal(owner?.raidRoll?.seed, JSON.stringify(['pirate-raid:v1', state.profile.playerId, cycleKey]));

  const repeated = reconcileRuntime(checked.state, context);
  const raids = repeated.state.flights.records.filter((flight) => flight.missionId === 'pirate-raid'
    && flight.pirateSnapshot?.kind === 'raid'
    && flight.pirateSnapshot.contactCycleKey === cycleKey);
  const firstRaids = checked.state.flights.records.filter((flight) => flight.missionId === 'pirate-raid'
    && flight.pirateSnapshot?.kind === 'raid'
    && flight.pirateSnapshot.contactCycleKey === cycleKey);
  assert.equal(raids.length, firstRaids.length);
  assert.ok(raids.length <= 1);
  assert.deepEqual(repeated.state.pirateOperations?.cyclesByKey[cycleKey]?.ownersById[state.profile.playerId]?.raidRoll, owner?.raidRoll);
});

test('recon dispatch enforces cooldown per cycle and failed reports persist without a pirate profile', () => {
  const now = 10_000;
  const base = withSpyProbes(createInitialSaveState('test', now), 2);
  const ownerId = base.profile.playerId;
  let failedIndex = 0;
  while (resolvePirateRecon(ownerId, 1, 7, failedIndex).fullReport) failedIndex += 1;
  let fullIndex = failedIndex + 1;
  while (!resolvePirateRecon(ownerId, 1, 8, fullIndex).fullReport) fullIndex += 1;
  const failed = withActiveContact(base, failedIndex, { galaxy: 1, system: 7, position: 12 }, now);
  const other = withActiveContact(failed.state, fullIndex, { galaxy: 1, system: 8, position: 12 }, now);
  const first = dispatchFlight(other.state, reconCommand('pirate-recon-failed', failed.cycle, now), { now, mode: 'test', testTimeScale: 15 });
  assert.equal(first.ok, true);
  if (!first.ok) return;
  assert.equal(first.flight.pirateSnapshot?.kind, 'recon');
  if (first.flight.pirateSnapshot?.kind !== 'recon') return;
  assert.equal(first.flight.pirateSnapshot.fullReport, false);
  assert.equal(first.flight.pirateSnapshot.profile, undefined);

  const blocked = dispatchFlight(first.state, reconCommand('pirate-recon-same-cycle', failed.cycle, now + 1), { now: now + 1, mode: 'test', testTimeScale: 15 });
  assert.equal(blocked.ok, false);
  if (!blocked.ok) assert.equal(blocked.error.code, 'spy-target-blocked');
  const separateCycle = dispatchFlight(first.state, reconCommand('pirate-recon-other-cycle', other.cycle, now + 1), { now: now + 1, mode: 'test', testTimeScale: 15 });
  assert.equal(separateCycle.ok, true);

  const storage = new MemoryStorage();
  const persistence = createPersistenceFacade({ mode: 'test', storage, now: () => now + 2, testTimeScale: 15 });
  assert.equal(persistence.write(first.state).ok, true);
  const reloaded = persistence.read();
  const savedFlight = reloaded.flights.records.find((flight) => flight.requestId === first.flight.requestId);
  assert.equal(savedFlight?.pirateSnapshot?.kind, 'recon');
  if (savedFlight?.pirateSnapshot?.kind !== 'recon') return;
  assert.equal(savedFlight.pirateSnapshot.profile, undefined);

  const arrived = reconcileFlights(reloaded, savedFlight.arrivalAt, undefined, { mode: 'test', testTimeScale: 15 });
  const returningFlight = arrived.state.flights.records.find((flight) => flight.id === savedFlight.id);
  assert.equal(returningFlight?.phase, 'returning');
  assert.ok(returningFlight?.returnAt);
  if (!returningFlight?.returnAt) return;
  const returned = reconcileFlights(arrived.state, returningFlight.returnAt, undefined, { mode: 'test', testTimeScale: 15 });
  const report = returned.state.pirateOperations?.reconReports.find((item) => item.id === `pirate-recon:${savedFlight.id}`);
  assert.equal(report?.fullReport, false);
  assert.equal(report?.profile, undefined);
});

test('an elimination flight never retargets a vanished contact and saves the exact missing-target notice', () => {
  const now = 50_000;
  const base = createInitialSaveState('test', now);
  const contact = withActiveContact(base, 19, { galaxy: 1, system: 7, position: 12 }, now);
  const sent = dispatchFlight(contact.state, {
    requestId: 'pirate-elimination-contact-gone',
    missionId: 'pirate-elimination',
    originPlanetId: 'helion-01',
    destination: { kind: 'coordinate', coordinate: contact.cycle.coordinate },
    targetKind: 'pirate',
    selectedShips: { scout: 1 },
    selectedCommanders: {},
    maxRounds: 5,
    pirateContactCycleKey: contact.cycle.cycleKey,
    departedAt: now,
  }, { now, mode: 'test', testTimeScale: 15 });
  assert.equal(sent.ok, true);
  if (!sent.ok) return;

  const vanished = markPirateContactDefeated(sent.state, contact.cycle.cycleKey, now + 1);
  const arrival = reconcileFlights(vanished, sent.flight.arrivalAt, undefined, { mode: 'test', testTimeScale: 15 });
  assert.equal(arrival.state.combat.reports.length, base.combat.reports.length);
  assert.equal(arrival.state.flights.records.find((flight) => flight.id === sent.flight.id)?.phase, 'returning');
  assert.equal(arrival.state.pirateOperations?.flightNotices.at(-1)?.message, PIRATE_MISSING_TARGET_REPORT_TEXT);
  assert.deepEqual(arrival.state.pirateOperations?.flightNotices.at(-1)?.coordinate, contact.cycle.coordinate);
});

test('incoming raid snapshots an empty target as one legal pirate unit and resolves without PvE score', () => {
  const now = 100_000;
  const base = createInitialSaveState('test', now);
  const empty = createEmptyFleetState();
  const planet = base.planets['helion-01']!;
  const targetState = replacePlanetState(base, 'helion-01', {
    ...planet,
    fleet: empty,
    defense: { defenses: Object.fromEntries(Object.keys(planet.defense.defenses).map((id) => [id, 0])) as typeof planet.defense.defenses },
  });
  const ownerId = targetState.profile.playerId;
  const cycleKey = pirateContactCycleKey(1, 1, 42);
  const score = selectOwnerScores(targetState)[ownerId]!;
  const profile = createPirateProfile({ ownerId, contactCycleKey: cycleKey, score });
  const requestId = 'pirate-empty-target-raid';
  const cycle: PirateContactCycleSnapshot = {
    cycleKey,
    cycleIndex: 42,
    coordinate: { galaxy: 1, system: 1, position: 12 },
    startedAt: now,
    expiresAt: now + 60 * 60_000,
    respawnAt: now + 75 * 60_000,
    ownersById: {
      [ownerId]: {
        profile,
        raidRoll: {
          checkedAt: now,
          seed: JSON.stringify(['pirate-raid:v1', ownerId, cycleKey]),
          success: true,
          targetPlanetId: 'helion-01',
          flightRequestId: requestId,
        },
      },
    },
  };
  const ledger = targetState.pirateOperations ?? createDefaultPirateOperationsState(now);
  const withCycle: SaveState = {
    ...targetState,
    pirateOperations: { ...ledger, cyclesByKey: { ...ledger.cyclesByKey, [cycleKey]: cycle } },
  };
  const due = {
    ownerId,
    contactCycleKey: cycleKey,
    checkedAt: now,
    profile,
    outcome: { ownerId, contactCycleKey: cycleKey, chance: 0.12, roll: 0.01, rollSucceeded: true, targetPlanetId: 'helion-01' },
  };
  const dispatched = dispatchPirateRaidDue(withCycle, due);
  assert.ok(dispatched.flight);
  const flight = dispatched.flight!;
  assert.equal(flight.targetKind, 'player');
  assert.equal(flight.selectedShips && Object.keys(flight.selectedShips).length, 0);
  assert.equal(flight.pirateSnapshot?.kind, 'raid');
  if (flight.pirateSnapshot?.kind !== 'raid') return;
  assert.equal(flight.pirateSnapshot.targetPopulationAtDispatch, 0);
  const baseComposition = Object.entries(flight.pirateSnapshot.shipComposition).filter(([id]) => id !== 'pirate-planet-breaker');
  assert.equal(baseComposition.length, 1);
  assert.equal(baseComposition[0]?.[1], 1);
  assert.equal(flight.pirateSnapshot.actualPopulation, PIRATE_CATALOG_BY_ID[baseComposition[0]![0] as keyof typeof PIRATE_CATALOG_BY_ID].population
    + (flight.pirateSnapshot.planetBreakerLevel === undefined ? 0 : PIRATE_CATALOG_BY_ID['pirate-planet-breaker'].population));

  const storage = new MemoryStorage();
  const persistence = createPersistenceFacade({ mode: 'test', storage, now: () => now, testTimeScale: 15 });
  assert.equal(persistence.write(dispatched.state).ok, true);
  const reloaded = persistence.read();
  assert.ok(reloaded.flights.records.some((saved) => saved.id === flight.id));
  const battlePointsBefore = selectOwnerScores(reloaded)[ownerId]?.battlePoints;
  const arrival = reconcileFlights(reloaded, flight.arrivalAt, undefined, { mode: 'test', testTimeScale: 15 });
  const report = arrival.state.combat.reports.find((item) => item.id === `battle-pirate-raid-${flight.id}`);
  assert.ok(report);
  assert.equal(report?.missionType, 'pirate-raid');
  assert.equal(report?.defenderForce.populationBefore, 0);
  assert.equal(selectOwnerScores(arrival.state)[ownerId]?.battlePoints, battlePointsBefore);
  assert.equal(arrival.state.flights.records.find((saved) => saved.id === flight.id)?.completionReason, 'pirate-raid-resolved');
});
