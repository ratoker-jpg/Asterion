import assert from 'node:assert/strict';
import test from 'node:test';
import { createInitialSaveState, createPersistenceFacade } from './persistence.ts';
import { dispatchFlight, getAvailableFleetForPlanet, getReservedShipsForPlanet, reconcileFlights } from './flights.ts';
import { getCurrentPirateContact } from './pirates.ts';
import { pirateReconCooldownKey } from '../domain/pirates/recon.ts';
import { createUniverseSystem, getUniverseTimedObjectSchedule } from '../domain/universe/runtime.ts';
import { createDefaultPirateState } from '../domain/pirates/mission.ts';

class MemoryStorage {
  private values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
  removeItem(key: string) { this.values.delete(key); }
}

type ActiveContact = {
  now: number;
  coordinate: { galaxy: number; system: number; position: number };
  contactCycleKey: string;
  expiresAt: number;
};

function activeContact(system = 2): ActiveContact {
  for (let cycleIndex = 0; cycleIndex < 50; cycleIndex += 1) {
    const schedule = getUniverseTimedObjectSchedule('pirate', 1, system, cycleIndex);
    if (!schedule.present) continue;
    const now = schedule.startAt + 1;
    const universe = createUniverseSystem({ galaxy: 1, system, nowMs: now });
    const pirate = universe.positions.find((position) => position.kind === 'pirate')?.pirate;
    if (pirate) {
      const coordinate = universe.positions.find((position) => position.kind === 'pirate')!.coordinate;
      return { now, coordinate, contactCycleKey: pirate.contactCycleKey, expiresAt: pirate.expiresAt };
    }
  }
  throw new Error(`Unable to find an active contact in system ${system}.`);
}

function pirateReconCommand(contact: ActiveContact, requestId: string) {
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

function persistence(storage = new MemoryStorage(), now = 0) {
  return {
    storage,
    facade: createPersistenceFacade({ mode: 'production', storage, now: () => now }),
  };
}

function withMainSaveSentinels(now: number) {
  const state = createInitialSaveState('production', now);
  const homeworld = state.planets['helion-01']!;
  const fleet = structuredClone(homeworld.fleet);
  fleet.ships['spy-probe'] = Math.max(2, fleet.ships['spy-probe'] ?? 0);
  const colony = {
    ...structuredClone(homeworld),
    name: 'Persistence Colony',
    universeGalaxy: 1,
    universeSystem: 3,
    universePosition: 7,
    fleet: { ...structuredClone(homeworld.fleet), ships: { ...homeworld.fleet.ships, 'spy-probe': 4 } },
    resources: { metal: 1_234, minerals: 2_345, gas: 3_456 },
  };
  const planets = {
    ...state.planets,
    'helion-01': { ...homeworld, fleet, resources: { metal: 1_111, minerals: 2_222, gas: 3_333 } },
    'colony-persistence': colony,
  };
  return {
    ...state,
    metal: 1_111,
    minerals: 2_222,
    gas: 3_333,
    planets,
    rating: {
      battleAwardsByReportId: { 'sentinel-battle': { 'player-current': 73 } },
      unrecoveredCostsByOwnerId: { 'player-current': { metal: 17, minerals: 29, gas: 41 } },
    },
  };
}

function assertMainSentinels(state: ReturnType<typeof withMainSaveSentinels>, expected = withMainSaveSentinels(0)) {
  assert.equal(state.metal, expected.metal);
  assert.equal(state.minerals, expected.minerals);
  assert.equal(state.gas, expected.gas);
  assert.deepEqual(state.planets['helion-01']?.resources, expected.planets['helion-01']?.resources);
  assert.deepEqual(state.planets['helion-01']?.fleet, expected.planets['helion-01']?.fleet);
  assert.deepEqual(state.planets['colony-persistence']?.resources, expected.planets['colony-persistence']?.resources);
  assert.equal(state.planets['colony-persistence']?.name, 'Persistence Colony');
  assert.equal(state.planets['colony-persistence']?.fleet.ships['spy-probe'], 4);
  assert.deepEqual(state.rating.battleAwardsByReportId['sentinel-battle'], { 'player-current': 73 });
  assert.deepEqual(state.rating.unrecoveredCostsByOwnerId['player-current'], { metal: 17, minerals: 29, gas: 41 });
}

test('legacy save without pirate state migrates defaults and preserves resources, colony, rating, and fleet', () => {
  const { facade } = persistence(undefined, 10_000);
  const saved = withMainSaveSentinels(10_000);
  const { pirate: _legacyPirate, ...legacy } = saved;
  assert.equal(facade.write(legacy).ok, true);

  const reloaded = facade.read();
  assertMainSentinels(reloaded as ReturnType<typeof withMainSaveSentinels>, legacy as ReturnType<typeof withMainSaveSentinels>);
  assert.deepEqual(reloaded.pirate?.contact,createDefaultPirateState().contact);
  assert.deepEqual(reloaded.pirate?.raidRolls,{});
  assert.equal(reloaded.pirate?.raidProcessedAt,10_000);
  assert.equal(reloaded.pirate?.ownerThreats?.[reloaded.profile.playerId]?.ageHours,0);
  const expectedMax=Math.max(...Object.values(reloaded.planets).map(x=>x.buildings.hangar??0));
  assert.equal(reloaded.pirate?.ownerMaxHangarLevel?.[reloaded.profile.playerId],expectedMax);
});

test('malformed pirate ledger and nested system-999 flight snapshot are isolated; dropping flight releases its reservation', () => {
  const contact = activeContact();
  const { facade } = persistence(undefined, contact.now);
  const saved = withMainSaveSentinels(contact.now);
  const currentContact = getCurrentPirateContact(saved, contact.coordinate, contact.now, 'production');
  assert.equal(currentContact?.contactCycleKey, contact.contactCycleKey);
  const dispatched = dispatchFlight(saved, pirateReconCommand(contact, 'bad-snapshot-isolated'), {
    mode: 'production', now: contact.now,
  });
  assert.equal(dispatched.ok, true);
  if (!dispatched.ok) return;
  const rawState = {
    ...dispatched.state,
    pirate: {
      ...dispatched.state.pirate!,
      contact: {
        version: 1 as const,
        defeatedCycles: {
          'pirate-cycle-v1:1:2:0:0': {
            contactCycleKey: 'pirate-cycle-v1:1:2:0:0', galaxy: 1, system: 2,
            cycleIndex: 0, startAt: 0, coordinate: { galaxy: 1, system: 999, position: 3 },
            defeatedAt: 1, nextEligibleAt: 900_001,
          },
        },
        ownerProfiles: { invalid: { bad: { ownerId: '', contactCycleKey: 'bad' } } },
      },
    },
    flights: {
      ...dispatched.state.flights,
      records: dispatched.state.flights.records.map((flight) => flight.id === dispatched.flight.id
        ? { ...flight, pirateSnapshot: { ...flight.pirateSnapshot!, coordinate: { ...flight.pirateSnapshot!.coordinate, system: 999 } } }
        : flight),
      requestIndex: { ...dispatched.state.flights.requestIndex, forged: dispatched.flight.id },
    },
  } as unknown as typeof dispatched.state;
  assert.deepEqual(getReservedShipsForPlanet(rawState, 'helion-01')['spy-probe'], 1);
  assert.equal(facade.write(rawState).ok, true);

  const reloaded = facade.read();
  assertMainSentinels(reloaded as ReturnType<typeof withMainSaveSentinels>, dispatched.state as ReturnType<typeof withMainSaveSentinels>);
  assert.deepEqual(reloaded.pirate?.contact.defeatedCycles, {});
  assert.deepEqual(reloaded.pirate?.contact.ownerProfiles, {});
  assert.equal(reloaded.flights.records.some((flight) => flight.id === dispatched.flight.id), false);
  assert.equal(reloaded.flights.requestIndex['bad-snapshot-isolated'], undefined);
  assert.equal(reloaded.flights.requestIndex.forged, undefined);
  assert.equal(getReservedShipsForPlanet(reloaded, 'helion-01')['spy-probe'] ?? 0, 0);
  assert.equal(getAvailableFleetForPlanet(reloaded, 'helion-01').ships['spy-probe'],
    reloaded.planets['helion-01']!.fleet.ships['spy-probe']);
});

test('future MAX_SAFE_INTEGER recon cooldown is discarded and does not lock the active cycle', () => {
  const contact = activeContact(4);
  const { facade } = persistence(undefined, contact.now);
  const state = createInitialSaveState('production', contact.now);
  const ownerId = state.profile.playerId;
  const cooldownKey = pirateReconCooldownKey(ownerId, contact.contactCycleKey);
  const malformedFutureCooldown = {
    ...state,
    pirate: {
      ...state.pirate!,
      reconLastDispatchAt: { [cooldownKey]: Number.MAX_SAFE_INTEGER },
    },
  };
  assert.equal(facade.write(malformedFutureCooldown).ok, true);

  const reloaded = facade.read();
  assert.equal(reloaded.pirate?.reconLastDispatchAt[cooldownKey], undefined);
  const result = dispatchFlight(reloaded, pirateReconCommand(contact, 'future-cooldown-is-not-lock'), {
    mode: 'production', now: contact.now,
  });
  assert.equal(result.ok, true);
});

test('recon arrival and return replay after multiple persistence reloads creates one report and no duplicate reward', () => {
  const contact = activeContact(5);
  const { facade } = persistence(undefined, contact.now);
  const state = createInitialSaveState('production', contact.now);
  const sent = dispatchFlight(state, pirateReconCommand(contact, 'replay-persisted-recon'), {
    mode: 'production', now: contact.now,
  });
  assert.equal(sent.ok, true);
  if (!sent.ok) return;
  assert.ok(sent.flight.arrivalAt < contact.expiresAt);

  assert.equal(facade.write(sent.state).ok, true);
  const firstLoad = facade.read();
  const firstArrival = reconcileFlights(firstLoad, sent.flight.arrivalAt, undefined, { mode: 'production' });
  assert.equal(firstArrival.state.pirate?.reconReports.length, 1);
  assert.equal(facade.write(firstArrival.state).ok, true);
  const secondLoad = facade.read();
  const returning = secondLoad.flights.records.find((flight) => flight.id === sent.flight.id)!;
  assert.equal(returning.phase, 'returning');
  const completed = reconcileFlights(secondLoad, returning.returnAt!, undefined, { mode: 'production' });
  assert.equal(completed.state.flights.records.find((flight) => flight.id === sent.flight.id)?.phase, 'completed');
  assert.equal(facade.write(completed.state).ok, true);
  const thirdLoad = facade.read();
  const replay = reconcileFlights(thirdLoad, returning.returnAt!, undefined, { mode: 'production' });
  assert.equal(replay.changed, false);
  assert.equal(replay.state.pirate?.reconReports.length, 1);
  assert.equal(new Set(replay.state.pirate?.reconReports.map((report) => report.missionId)).size, 1);
  assert.equal(replay.state.flights.records.find((flight) => flight.id === sent.flight.id)?.phase, 'completed');
  assert.equal(replay.state.planets['helion-01']?.resources?.gas, completed.state.planets['helion-01']?.resources?.gas);
  assert.equal(replay.state.combat.reports.length, completed.state.combat.reports.length);
  assert.deepEqual(replay.state.rating, completed.state.rating);
});
