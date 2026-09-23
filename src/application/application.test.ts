import assert from 'node:assert/strict';
import test from 'node:test';
import { getSpaceportUpgradeCatalog, previewSpaceportUpgrade } from '../domain/buildings/spaceport-upgrades.ts';
import { SCIENCE_CATALOG } from '../domain/science/catalog.ts';
import {
  SCIENCE_CANCEL_REQUEST_EVENT,
  SCIENCE_RUNTIME_CHANGED_EVENT,
  SCIENCE_START_REQUEST_EVENT,
} from '../domain/science/runtime.ts';
import {
  ACTIVE_RUNTIME_MODE,
  RUNTIME_STATE_CHANGED_EVENT,
  scaleRuntimeDuration,
} from '../domain/runtime/mode.ts';
import {
  applyProductionBots,
  cancelBuilding,
  collectRecycling,
  cancelSpaceportUpgrade,
  destroyBuilding,
  executeTradeAction,
  previewBuilding,
  startBuilding,
  startRecycling,
  startSpaceportUpgrade,
} from './buildings.ts';
import {
  getFleetBuildBudget,
  getPlanetPopulationForState,
  getFleetSummaryForState,
  readFleetBuildBudget,
} from './fleet.ts';
import { createEmptyFleetState } from '../domain/fleet/runtime.ts';
import { bindScienceEventBridge, cancelScience, startScience } from './science.ts';
import { repairUnits, removeRepairUnits } from './repair.ts';
import {
  bindFleetProductionEventBridge,
  cancelFleetProduction,
  dismantleSolarSatellites,
  reconcileFleetProduction,
  startFleetProduction,
} from './fleet-production.ts';
import {
  getPlanetEnergyLedger,
  getPlanetEnergySources,
  syncPlanetEnergySources,
  withPlanetEnergyLedger,
} from './energy.ts';
import { createEnergyLedger } from '../domain/energy/runtime.ts';
import { reconcileRuntime } from './reconcile.ts';
import { getEffectiveResourceIncomePerHour } from './resource-clock.ts';
import { dispatchFlight, reconcileFlights } from './flights.ts';
import { publishApplicationRuntimeSnapshot } from './runtime.ts';
import { enqueueApplicationStateUpdate } from './state.ts';
import {
  createInitialSaveState,
  createPersistenceFacade,
  type StorageLike,
} from './persistence.ts';
import { getStorageCapacities } from '../domain/buildings/resource-zone.ts';
import { getBuildingMaxLevel } from '../domain/buildings/balance-v1.ts';
import { getPlanetResources, type SaveState } from './contracts.ts';
import { getPlanetOverpopulationSummary, reconcilePlanetOverpopulation } from './overpopulation.ts';
import { createAllianceRatingEntries, createPlayerRatingEntries } from '../domain/rating/fixtures.ts';
import { createUniverseMap } from '../domain/universe/runtime.ts';
import { getEspionageTargets } from '../domain/espionage/runtime.ts';

class MemoryStorage implements StorageLike {
  readonly values = new Map<string, string>();
  writes = 0;

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.writes += 1;
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }
}

const context = (now: number, mode: 'production' | 'test' = 'test') => ({
  planetId: 'helion-01' as const,
  now,
  mode,
  testTimeScale: 10 as const,
});

test('production and test persistence seeds stay isolated at every fixture boundary', () => {
  const production = createInitialSaveState('production', 1_000);
  const testMode = createInitialSaveState('test', 1_000);

  assert.equal(production.command.alliance.name, '');
  assert.equal(production.command.members.length, 0);
  assert.equal(production.command.jointOperations.length, 0);
  assert.equal(production.operations.items.length, 0);
  assert.equal(production.combat.reports.length, 0);
  assert.equal(createUniverseMap({ mode: 'production' }).systems.flatMap((system) => system.positions).filter((node) => node.kind === 'npc').length, 0);
  assert.equal(createPlayerRatingEntries(production.rating.resourcePoints, 'production').length, 1);
  assert.equal(createAllianceRatingEntries(null, 'production').length, 0);

  assert.equal(testMode.command.alliance.name, 'Содружество Гелион');
  assert.ok(testMode.command.members.length > 0);
  assert.ok(testMode.command.jointOperations.length > 0);
  assert.equal(testMode.operations.items.length, 4);
  assert.ok(testMode.combat.reports.length > 0);
  assert.equal(createUniverseMap({ mode: 'test' }).systems.flatMap((system) => system.positions).filter((node) => node.kind === 'npc').length, 8);
  assert.equal(Object.keys(testMode.alliedPlanets ?? {}).length, 1);
  assert.equal(createPlayerRatingEntries(testMode.rating.resourcePoints, 'test').length, 84);
  assert.equal(createAllianceRatingEntries(null, 'test').length, 42);
});

function withBuildingSetup(state: SaveState): SaveState {
  return {
    ...state,
    planets: {
      ...state.planets,
      'helion-01': {
        ...state.planets['helion-01'],
        buildings: {
          ...state.planets['helion-01'].buildings,
          construction: 20,
          research: 1,
          recycling: 1,
          shipyard: 20,
          spaceport: 1,
          'trade-center': 1,
        },
        recycling: {
          ...state.planets['helion-01'].recycling,
          availableDebris: 10_000,
        },
      },
    },
    science: {
      ...state.science,
      levels: Object.fromEntries(SCIENCE_CATALOG.map((science) => [science.id, science.maxLevel])),
    },
  };
}

function registeredTargetsForUniverse(state: SaveState) {
  return Object.values(getEspionageTargets(state.espionage)).map((target) => ({
    id: target.id,
    coordinate: target.coordinate,
    name: target.name,
    kind: target.kind ?? 'npc' as const,
    ownerId: target.ownerId,
  }));
}

test('Test Mode persistence keeps one deleted Bot 01 target deleted and preserves orbital debris', () => {
  const storage = new MemoryStorage();
  const persistence = createPersistenceFacade({ mode: 'test', storage, now: () => 2_000 });
  const initial = createInitialSaveState('test', 1_000);
  const initialTargets = getEspionageTargets(initial.espionage);
  const deletedTarget = Object.values(initialTargets)[0];
  assert.ok(deletedTarget);
  const remainingTargets = Object.fromEntries(
    Object.entries(initialTargets).filter(([targetId]) => targetId !== deletedTarget.id),
  );
  const debris = {
    id: 'debris-after-target-destruction',
    targetPlanetId: deletedTarget.id,
    targetPlanetName: deletedTarget.name,
    targetOwnerId: deletedTarget.ownerId,
    targetCoordinate: deletedTarget.coordinate,
    debris: 777,
    createdAt: 1_500,
  };
  const changed = {
    ...initial,
    espionage: {
      ...initial.espionage!,
      targets: remainingTargets,
      bot01Planets: remainingTargets,
      orbitalDebris: { [debris.id]: debris },
    },
  } satisfies SaveState;

  assert.equal(persistence.write(changed).ok, true);
  const reloaded = persistence.read();
  const reloadedTargets = getEspionageTargets(reloaded.espionage);
  assert.equal(Object.keys(reloadedTargets).length, 6);
  assert.equal(Object.keys(reloaded.espionage?.bot01Planets ?? {}).length, 6);
  assert.equal(reloaded.espionage?.orbitalDebris?.[debris.id]?.debris, 777);

  const map = createUniverseMap({ mode: 'test', registeredPlanets: registeredTargetsForUniverse(reloaded) });
  const nodes = map.systems.flatMap((system) => system.positions);
  assert.equal(nodes.some((node) => node.id === deletedTarget.id), false);
  const coordinateOccupant = nodes.find((node) => node.coordinate.galaxy === deletedTarget.coordinate.galaxy
    && node.coordinate.system === deletedTarget.coordinate.system
    && node.coordinate.position === deletedTarget.coordinate.position);
  assert.notEqual(coordinateOccupant?.id, deletedTarget.id);
});

test('Test Mode persistence treats an empty canonical Bot 01 registry as authoritative', () => {
  const storage = new MemoryStorage();
  const persistence = createPersistenceFacade({ mode: 'test', storage, now: () => 2_000 });
  const initial = createInitialSaveState('test', 1_000);
  const changed = {
    ...initial,
    espionage: {
      ...initial.espionage!,
      targets: {},
      bot01Planets: {},
    },
  } satisfies SaveState;

  assert.equal(persistence.write(changed).ok, true);
  const reloaded = persistence.read();
  assert.equal(Object.keys(getEspionageTargets(reloaded.espionage)).length, 0);
  assert.equal(Object.keys(reloaded.espionage?.bot01Planets ?? {}).length, 0);
  assert.ok(reloaded.espionage?.bot01Profile, 'owner profile may survive without recreating planets');

  const map = createUniverseMap({ mode: 'test', registeredPlanets: registeredTargetsForUniverse(reloaded) });
  const nodes = map.systems.flatMap((system) => system.positions);
  assert.equal(nodes.some((node) => node.kind === 'npc' && node.ownerId === 'npc-bot-01'), false);
});

test('legacy bot01Planets saves keep their compatibility migration path', () => {
  const storage = new MemoryStorage();
  const persistence = createPersistenceFacade({ mode: 'test', storage, now: () => 2_000 });
  const initial = createInitialSaveState('test', 1_000);
  const legacyEnvelope = {
    ...initial,
    espionage: {
      ...initial.espionage!,
      targets: undefined,
      bot01Planets: initial.espionage!.targets,
    },
  };
  storage.values.set(persistence.saveKey, JSON.stringify(legacyEnvelope));

  const reloaded = persistence.read();
  assert.equal(Object.keys(getEspionageTargets(reloaded.espionage)).length, 7);
  assert.equal(Object.keys(reloaded.espionage?.bot01Planets ?? {}).length, 7);
});

test('persistence facade keeps the existing save key, envelope migration, and one explicit writer', () => {
  const storage = new MemoryStorage();
  const persistence = createPersistenceFacade({ mode: 'test', storage, now: () => 1_000, testTimeScale: 10 });
  const initial = persistence.read();

  assert.equal(initial.metal, 450_100_000);
  assert.equal(initial.minerals, 300_100_000);
  assert.equal(initial.gas, 189_382_930);
  assert.equal(initial.planets['helion-01'].buildings['metal-storage'], 20);
  assert.equal(initial.planets['helion-01'].buildings['mineral-storage'], 20);
  assert.equal(initial.planets['helion-01'].buildings['gas-storage'], 20);
  assert.equal(Object.keys(initial.planets['helion-01'].repair.ships).length, 13);
  assert.equal(Object.keys(initial.planets['helion-01'].repair.defenses).length, 9);
  assert.deepEqual(new Set(Object.values(initial.planets['helion-01'].repair.ships)), new Set([10]));
  assert.equal(initial.planets['helion-01'].repair.defenses['tower-shield'], 0);
  assert.equal(initial.planets['helion-01'].repair.defenses['planetary-shield'], 0);
  assert.deepEqual(
    Object.entries(initial.planets['helion-01'].repair.defenses)
      .filter(([id]) => !['tower-shield', 'planetary-shield'].includes(id))
      .map(([, value]) => value),
    [10, 10, 10, 10, 10, 10, 10],
  );
  assert.equal(initial.resourceClock.lastReconciledAt, 1_000);
  assert.equal(initial.currentPlanetId, 'helion-01');
  assert.equal(persistence.write(initial).ok, true);
  assert.equal(storage.writes, 1);
  const roundTripped = persistence.read();
  assert.equal(roundTripped.metal, initial.metal);
  assert.equal(roundTripped.planets['helion-01'].name, initial.planets['helion-01'].name);
  assert.deepEqual(roundTripped.queues, initial.queues);

  storage.values.set(persistence.saveKey, JSON.stringify({
    schemaVersion: 1,
    metal: 777,
    planetSkin: 'terran',
    queue: [],
  }));
  const migrated = persistence.read();
  assert.equal(migrated.metal, 777);
  assert.equal(migrated.planets['helion-01'].skin, 'terran');
  assert.equal(migrated.planets['helion-01'].fleet.ships.scout, 16);
  assert.equal(migrated.planets['helion-01'].repair.ships.scout, 10);
  assert.equal(migrated.planets['helion-01'].repair.defenses['ballistic-turret'], 10);

  storage.values.set(persistence.saveKey, JSON.stringify({
    schemaVersion: 1,
    metal: 999_999_999,
    minerals: -5,
    gas: null,
    planets: { 'helion-01': { buildings: initial.planets['helion-01'].buildings, fleet: initial.planets['helion-01'].fleet } },
  }));
  const damaged = persistence.read();
  assert.equal(damaged.metal, 450_100_000);
  assert.equal(damaged.minerals, 0);
  assert.equal(damaged.gas, 0);
  assert.equal(damaged.resourceClock.lastReconciledAt, 1_000);
  assert.equal(getFleetSummaryForState(damaged).population, 58);
  const production = createPersistenceFacade({ mode: 'production', storage: new MemoryStorage(), now: () => 1_000 }).read();
  assert.deepEqual(new Set(Object.values(production.planets['helion-01'].repair.ships)), new Set([0]));
  assert.deepEqual(new Set(Object.values(production.planets['helion-01'].repair.defenses)), new Set([0]));
});

test('persistence drops incomplete flight records and rebuilds only a validated request index', () => {
  const storage = new MemoryStorage();
  const persistence = createPersistenceFacade({ mode: 'production', storage, now: () => 1_000 });
  const sent = dispatchFlight(createInitialSaveState('production', 1_000), {
    requestId: 'persisted-valid-flight',
    missionId: 'colonize',
    originPlanetId: 'helion-01',
    destination: { kind: 'coordinate', coordinate: { galaxy: 1, system: 2, position: 1 } },
    targetKind: 'empty',
    selectedShips: { colonizer: 1 },
    departedAt: 1_000,
  }, 1_000);
  assert.equal(sent.ok, true);
  if (!sent.ok) return;

  const missingArrival = { ...sent.flight, id: 'flight-corrupt-arrival', requestId: 'corrupt-arrival' } as Record<string, unknown>;
  delete missingArrival.arrivalAt;
  const missingCoordinates = { ...sent.flight, id: 'flight-corrupt-coordinate', requestId: 'corrupt-coordinate' } as Record<string, unknown>;
  delete missingCoordinates.destinationCoordinate;
  const missingShips = { ...sent.flight, id: 'flight-corrupt-ships', requestId: 'corrupt-ships' } as Record<string, unknown>;
  delete missingShips.selectedShips;

  storage.values.set(persistence.saveKey, JSON.stringify({
    ...sent.state,
    flights: {
      records: [sent.flight, missingArrival, missingCoordinates, missingShips],
      requestIndex: {
        [sent.flight.requestId]: sent.flight.id,
        'corrupt-arrival': 'flight-corrupt-arrival',
        'corrupt-coordinate': 'flight-corrupt-coordinate',
        'corrupt-ships': 'flight-corrupt-ships',
        forged: 'flight-corrupt-arrival',
      },
    },
  }));

  const reloaded = persistence.read();
  assert.deepEqual(reloaded.flights.records.map((flight) => flight.requestId), ['persisted-valid-flight']);
  assert.equal(reloaded.flights.requestIndex['persisted-valid-flight'], sent.flight.id);
  assert.equal(reloaded.flights.requestIndex['corrupt-arrival'], undefined);
  assert.equal(reloaded.flights.requestIndex['corrupt-coordinate'], undefined);
  assert.equal(reloaded.flights.requestIndex['corrupt-ships'], undefined);
  assert.equal(reloaded.flights.requestIndex.forged, undefined);

  const gasAfterReload = getPlanetResources(reloaded, 'helion-01').gas;
  const retried = dispatchFlight(reloaded, {
    requestId: 'persisted-valid-flight',
    missionId: 'colonize',
    originPlanetId: 'helion-01',
    destination: { kind: 'coordinate', coordinate: { galaxy: 1, system: 9, position: 9 } },
    targetKind: 'empty',
    selectedShips: { scout: 99 },
    departedAt: 50_000,
  }, 50_000);
  assert.equal(retried.ok, true);
  if (!retried.ok) return;
  assert.equal(retried.created, false);
  assert.equal(retried.flight.id, sent.flight.id);
  assert.equal(getPlanetResources(retried.state, 'helion-01').gas, gasAfterReload);
});

test('legacy resource clock migrates to every saved planet without sharing a mutable clock', () => {
  const storage = new MemoryStorage();
  const persistence = createPersistenceFacade({ mode: 'production', storage, now: () => 10_000 });
  const initial = createInitialSaveState('production', 0);
  const colonyId = 'planet-1-2-1';
  const colony = {
    ...initial.planets['helion-01'],
    name: 'Колония 2-1',
    universeSystem: 2,
    universePosition: 1,
    resources: { metal: 25, minerals: 35, gas: 45 },
  };
  storage.values.set(persistence.saveKey, JSON.stringify({
    ...initial,
    currentPlanetId: colonyId,
    planets: { ...initial.planets, [colonyId]: colony },
    queues: { ...initial.queues, [colonyId]: [] },
    resourceClock: {
      lastReconciledAt: 4_000,
      remainder: { metal: 0.25, minerals: 0.5, gas: 0.75, energy: 0 },
    },
  }));

  const migrated = persistence.read();
  assert.deepEqual(migrated.resourceClock.byPlanet?.['helion-01'], {
    lastReconciledAt: 4_000,
    remainder: { metal: 0.25, minerals: 0.5, gas: 0.75, energy: 0 },
  });
  assert.deepEqual(migrated.resourceClock.byPlanet?.[colonyId], migrated.resourceClock.byPlanet?.['helion-01']);
  assert.equal(migrated.currentPlanetId, colonyId);
});

test('persistence keeps one-time energy attribution and migrates legacy satellite fleet counts to orbit', () => {
  const storage = new MemoryStorage();
  const persistence = createPersistenceFacade({ mode: 'production', storage, now: () => 1_000 });
  const initial = createInitialSaveState('production', 0);
  const withSatellites = {
    ...initial,
    planets: {
      ...initial.planets,
      'helion-01': syncPlanetEnergySources({
        ...initial.planets['helion-01'],
        solarSatellites: 2,
      }, initial.science.levels),
    },
  };
  const beforeWrite = getPlanetEnergyLedger(withSatellites.planets['helion-01'], withSatellites.science.levels);
  assert.equal(persistence.write(withSatellites).ok, true);
  const roundTripped = persistence.read();
  const afterRead = getPlanetEnergyLedger(roundTripped.planets['helion-01'], roundTripped.science.levels);
  assert.equal(roundTripped.planets['helion-01'].solarSatellites, 2);
  assert.equal(roundTripped.planets['helion-01'].fleet.ships['solar-satellite'], 0);
  assert.equal(afterRead.availableEnergy, beforeWrite.availableEnergy);
  assert.equal(afterRead.consumedEnergy, beforeWrite.consumedEnergy);

  storage.values.set(persistence.saveKey, JSON.stringify({
    schemaVersion: 13,
    planets: {
      'helion-01': {
        fleet: { ships: { 'solar-satellite': 3 }, commanders: {} },
        energy: 140,
      },
    },
  }));
  const migrated = persistence.read();
  assert.equal(migrated.planets['helion-01'].solarSatellites, 3);
  assert.equal(migrated.planets['helion-01'].fleet.ships['solar-satellite'], 0);

  const partialLedgerBuildings = {
    ...initial.planets['helion-01'].buildings,
    'basic-energy': 23,
    hangar: 1,
  };
  storage.values.set(persistence.saveKey, JSON.stringify({
    schemaVersion: 20,
    science: { levels: { 1: 8 } },
    planets: {
      'helion-01': {
        buildings: partialLedgerBuildings,
        energy: 17_962,
        producedEnergy: 17_962,
        consumedEnergy: 0,
        availableEnergy: 17_962,
        universeSystem: 19,
        universePosition: 14,
      },
    },
  }));
  const partialLedger = persistence.read();
  const partialEnergy = getPlanetEnergyLedger(partialLedger.planets['helion-01'], partialLedger.science.levels);
  assert.equal(partialEnergy.producedEnergy, 17_962);
  assert.equal(partialEnergy.consumedEnergy, 0);
  assert.equal(partialEnergy.availableEnergy, 17_962);

  storage.values.set(persistence.saveKey, JSON.stringify({
    schemaVersion: 20,
    planets: {
      'helion-01': {
        buildings: { ...partialLedgerBuildings, 'basic-energy': 0 },
        energy: -50,
        producedEnergy: 0,
        consumedEnergy: 50,
        availableEnergy: -50,
        universeSystem: 19,
        universePosition: 14,
      },
    },
  }));
  const negativeLedger = persistence.read();
  const negativeEnergy = getPlanetEnergyLedger(negativeLedger.planets['helion-01'], negativeLedger.science.levels);
  assert.equal(negativeEnergy.producedEnergy, 0);
  assert.equal(negativeEnergy.consumedEnergy, 50);
  assert.equal(negativeEnergy.availableEnergy, -50);
});

test('building application owns start, queue cancellation, completion, destroy, and production bot transitions', () => {
  const initial = withBuildingSetup(createInitialSaveState('test'));
  const buildingContext = context(10_000);
  const initialTradeCenterLevel = initial.planets['helion-01'].buildings['trade-center'];
  const preview = previewBuilding(initial, buildingContext, 'trade-center');
  const started = startBuilding(initial, buildingContext, 'trade-center');
  assert.equal(started.ok, true);
  assert.equal(started.state.queues['helion-01'].length, 1);
  assert.equal(
    started.state.queues['helion-01'][0].durationMs,
    scaleRuntimeDuration(preview.availability.timeMs!, buildingContext.mode, buildingContext.testTimeScale),
  );

  const canceled = cancelBuilding(started.state, { ...buildingContext, now: 10_001 }, started.state.queues['helion-01'][0].id);
  assert.equal(canceled.ok, true);
  assert.equal(canceled.state.queues['helion-01'].length, 0);

  const rebuilt = startBuilding(initial, buildingContext, 'trade-center');
  assert.equal(rebuilt.ok, true);
  const completed = reconcileRuntime(rebuilt.state, { ...buildingContext, now: rebuilt.state.queues['helion-01'][0].finishAt });
  assert.equal(completed.changed, true);
  assert.equal(completed.events.some((event) => event.kind === 'building'), true);
  assert.equal(completed.state.planets['helion-01'].buildings['trade-center'], initialTradeCenterLevel + 1);

  const destroyed = destroyBuilding(completed.state, { ...buildingContext, now: 10_002 }, 'trade-center', () => 0);
  assert.equal(destroyed.ok, true);
  assert.equal(destroyed.refundPercent, 50);
  assert.equal(destroyed.state.planets['helion-01'].buildings['trade-center'], initialTradeCenterLevel);

  const assigned = applyProductionBots(destroyed.state, buildingContext, { metal: 1, minerals: 0, gas: 0 });
  assert.equal(assigned.planets['helion-01'].productionBots.metal, 1);
});

test('building destruction preserves ordinary energy refunds and source-removal debt', () => {
  const base = createInitialSaveState('production', 0);
  const buildingContext = context(10_000, 'production');
  const levelThreePlanet = syncPlanetEnergySources({
    ...base.planets['helion-01'],
    buildings: { ...base.planets['helion-01'].buildings, 'metal-production-3': 3 },
  }, base.science.levels);
  const levelThreeState = {
    ...base,
    planets: { ...base.planets, 'helion-01': levelThreePlanet },
  } satisfies SaveState;
  const destroyedOrdinary = destroyBuilding(levelThreeState, buildingContext, 'metal-production-3', () => 0);
  assert.equal(destroyedOrdinary.ok, true);
  const withoutRefund = syncPlanetEnergySources({
    ...levelThreePlanet,
    buildings: { ...levelThreePlanet.buildings, 'metal-production-3': 2 },
  }, base.science.levels);
  const refundedEnergy = getPlanetEnergyLedger(destroyedOrdinary.state.planets['helion-01'], base.science.levels).availableEnergy;
  const noRefundEnergy = getPlanetEnergyLedger(withoutRefund, base.science.levels).availableEnergy;
  assert.equal(refundedEnergy - noRefundEnergy, 8);

  const debtPlanet = withPlanetEnergyLedger({
    ...base.planets['helion-01'],
    buildings: { ...base.planets['helion-01'].buildings, 'basic-energy': 0, 'metal-production-3': 3 },
  }, createEnergyLedger([], -50));
  const debtState = { ...base, planets: { ...base.planets, 'helion-01': debtPlanet } } satisfies SaveState;
  const ordinaryDebtRefund = destroyBuilding(debtState, buildingContext, 'metal-production-3', () => 0);
  assert.equal(getPlanetEnergyLedger(ordinaryDebtRefund.state.planets['helion-01'], base.science.levels).availableEnergy, -42);

  const sourcePlanet = {
    ...base.planets['helion-01'],
    buildings: { ...base.planets['helion-01'].buildings, 'basic-energy': 1 },
  };
  const sourceDebtPlanet = withPlanetEnergyLedger(
    sourcePlanet,
    createEnergyLedger(getPlanetEnergySources(sourcePlanet, base.science.levels), -50),
  );
  const sourceDebtState = { ...base, planets: { ...base.planets, 'helion-01': sourceDebtPlanet } } satisfies SaveState;
  const destroyedEnergy = destroyBuilding(sourceDebtState, buildingContext, 'basic-energy', () => 0);
  const destroyedEnergyLedger = getPlanetEnergyLedger(destroyedEnergy.state.planets['helion-01'], base.science.levels);
  assert.equal(destroyedEnergy.ok, true);
  assert.equal(destroyedEnergyLedger.debtCause, 'source-removal');
  assert.equal(destroyedEnergyLedger.availableEnergy < 0, true);
});

test('one-time energy is added by source completion and never by the hourly resource clock', () => {
  const base = createInitialSaveState('test', 0);
  const sourceReady = syncPlanetEnergySources({
    ...base.planets['helion-01'],
    buildings: { ...base.planets['helion-01'].buildings, 'basic-energy': 22 },
  }, base.science.levels);
  const initial = {
    ...base,
    planets: { ...base.planets, 'helion-01': sourceReady },
  } satisfies SaveState;
  const before = getPlanetEnergyLedger(initial.planets['helion-01'], initial.science.levels);
  const started = startBuilding(initial, context(10_000), 'basic-energy');
  assert.equal(started.ok, true);
  const afterStart = getPlanetEnergyLedger(started.state.planets['helion-01'], started.state.science.levels);
  assert.equal(afterStart.availableEnergy, before.availableEnergy);

  const task = started.state.queues['helion-01'][0];
  assert.ok(task);
  const completed = reconcileRuntime(started.state, { ...context(10_000), now: task.finishAt });
  const afterCompletion = getPlanetEnergyLedger(completed.state.planets['helion-01'], completed.state.science.levels);
  const beforeSource = before.sources.find((source) => source.id === 'solar-station');
  const afterSource = afterCompletion.sources.find((source) => source.id === 'solar-station');
  assert.equal(completed.state.planets['helion-01'].buildings['basic-energy'], 23);
  assert.ok(beforeSource);
  assert.ok(afterSource);
  assert.equal(
    afterCompletion.availableEnergy - afterStart.availableEnergy,
    afterSource.fullContribution - beforeSource.fullContribution,
  );

  const paidBuilding = startBuilding(initial, context(20_000), 'construction');
  assert.equal(paidBuilding.ok, true);
  const afterPaidBuilding = getPlanetEnergyLedger(paidBuilding.state.planets['helion-01'], paidBuilding.state.science.levels);
  assert.equal(afterPaidBuilding.availableEnergy, before.availableEnergy - 3);

  const later = reconcileRuntime(completed.state, { ...context(10_000), now: task.finishAt + 3_600_000 });
  assert.equal(
    getPlanetEnergyLedger(later.state.planets['helion-01'], later.state.science.levels).availableEnergy,
    afterCompletion.availableEnergy,
  );
  assert.equal(later.state.resourceClock.remainder.energy, 0);
});

test('over-capacity fleet rejects hangar downgrade without changing state or refunding', () => {
  const state = createInitialSaveState('test', 0);
  const beforeSummary = getFleetSummaryForState(state);
  const beforeResources = {
    metal: state.metal,
    minerals: state.minerals,
    gas: state.gas,
    energy: state.planets['helion-01'].energy,
  };
  let rngCalled = false;

  const result = destroyBuilding(state, context(10_000), 'hangar', () => {
    rngCalled = true;
    return 0;
  });

  assert.equal(result.ok, false);
  assert.equal(result.refundPercent, null);
  assert.match(result.reason ?? '', /флот занимает 58 мест, новая вместимость — 50/);
  assert.equal(rngCalled, false);
  assert.strictEqual(result.state, state);
  assert.equal(result.state.planets['helion-01'].buildings.hangar, 1);
  assert.deepEqual(result.state.planets['helion-01'].fleet, state.planets['helion-01'].fleet);
  assert.deepEqual(
    {
      metal: result.state.metal,
      minerals: result.state.minerals,
      gas: result.state.gas,
      energy: result.state.planets['helion-01'].energy,
    },
    beforeResources,
  );
  assert.deepEqual(getFleetSummaryForState(result.state), beforeSummary);

  const storage = new MemoryStorage();
  const persistence = createPersistenceFacade({ mode: 'test', storage, now: () => 10_000, testTimeScale: 1 });
  assert.equal(persistence.write(result.state).ok, true);
  const persisted = persistence.read();
  assert.equal(persisted.planets['helion-01'].buildings.hangar, 1);
  assert.deepEqual(persisted.planets['helion-01'].fleet, state.planets['helion-01'].fleet);
  assert.deepEqual(getFleetSummaryForState(persisted), beforeSummary);
});

test('recycling, trade, and spaceport actions remain thin domain-backed transitions', () => {
  const initial = withBuildingSetup(createInitialSaveState('test'));
  const startAt = 20_000;
  const recycling = startRecycling(initial, context(startAt), 100, { metal: 40, minerals: 40, gas: 20 }, 'recycle-1');
  assert.equal(recycling.ok, true);
  const job = recycling.state.planets['helion-01'].recycling.jobs[0];
  assert.ok(job);
  const collected = collectRecycling(recycling.state, context(job.finishAt), job.id);
  assert.equal(collected.ok, true);
  assert.ok(collected.output);

  const trade = executeTradeAction({
    ...collected.state,
    planets: {
      ...collected.state.planets,
      'helion-01': {
        ...collected.state.planets['helion-01'],
        recycling: { ...collected.state.planets['helion-01'].recycling, availableDebris: 1000 },
      },
    },
  }, context(job.finishAt + 1), 855_880, { source: 'debris', target: 'metal', amount: 100 });
  assert.equal(trade.execution.ok, true);
  assert.equal(trade.state.metal, collected.state.metal);
  assert.equal(trade.execution.credit?.accepted.metal, 0);
  assert.equal(trade.execution.credit?.burned.metal, 60);

  const spaceportContext = context(job.finishAt + 2);
  const spaceportState = trade.state;
  const candidate = getSpaceportUpgradeCatalog('ships').find((entity) => previewSpaceportUpgrade({
    state: spaceportState.planets['helion-01'].spaceportUpgrades,
    wallet: { metal: spaceportState.metal, minerals: spaceportState.minerals, gas: spaceportState.gas },
    buildings: spaceportState.planets['helion-01'].buildings,
    scienceLevels: spaceportState.science.levels,
    spaceportLevel: spaceportState.planets['helion-01'].buildings.spaceport,
    mode: spaceportContext.mode,
    testTimeScale: spaceportContext.testTimeScale,
  }, 'ships', entity.id).canStart);
  assert.ok(candidate);
  const upgrade = startSpaceportUpgrade(spaceportState, spaceportContext, 'ships', candidate.id, 'spaceport-1');
  assert.equal(upgrade.ok, true);
  assert.equal(upgrade.state.planets['helion-01'].spaceportUpgrades.shipQueue.length, 1);
});

test('spaceport application action names and resolves the selected faction ship', () => {
  const state = {
    ...withBuildingSetup(createInitialSaveState('test')),
    profile: { ...createInitialSaveState('test').profile, factionId: 'synod' as const },
  };
  const result = startSpaceportUpgrade(state, context(25_000), 'ships', 'transporter', 'synod-transporter-1');

  assert.equal(result.ok, true);
  assert.equal(result.entityName, 'Транспортный дрон');
  assert.equal(result.state.planets['helion-01'].spaceportUpgrades.shipQueue[0]?.shipId, 'transporter');
});

test('fleet production application persists, reconciles, and bridges all three queues', () => {
  const initial = withBuildingSetup(createInitialSaveState('test', 1_000));
  initial.science.levels[4] = 1;
  const startContext = context(2_000);
  const ship = startFleetProduction(initial, startContext, 'ships', 'scout', 2, 'app-ship');
  assert.equal(ship.transition.ok, true);
  assert.equal(ship.state.planets['helion-01'].fleetProduction.shipQueue.length, 1);
  assert.equal(getFleetSummaryForState(ship.state).pendingPopulation, 4);

  const defense = startFleetProduction(ship.state, { ...startContext, now: 2_001 }, 'defense', 'ballistic-turret', 2, 'app-defense');
  assert.equal(defense.transition.ok, true);
  const commander = startFleetProduction(defense.state, { ...startContext, now: 2_002 }, 'commanders', 'corsair', 1, 'app-commander');
  assert.equal(commander.transition.ok, true);
  assert.equal(commander.state.planets['helion-01'].fleetProduction.commanderQueue.length, 1);

  const task = ship.state.planets['helion-01'].fleetProduction.shipQueue[0];
  assert.ok(task);
  const completed = reconcileRuntime(commander.state, { ...startContext, now: task.finishAt });
  assert.equal(completed.events.some((event) => event.kind === 'fleet-production'), true);
  assert.equal(completed.state.planets['helion-01'].fleet.ships.scout, 22);

  const storage = new MemoryStorage();
  const persistence = createPersistenceFacade({ mode: 'test', storage, now: () => task.finishAt, testTimeScale: 10 });
  assert.equal(persistence.write(commander.state).ok, true);
  const offline = persistence.read();
  assert.equal(offline.planets['helion-01'].fleet.ships.scout, 22);
  assert.equal(offline.planets['helion-01'].fleetProduction.shipQueue.length, 0);

  const target = new EventTarget();
  let current = initial;
  const commits: SaveState[] = [];
  const unbind = bindFleetProductionEventBridge({
    target,
    getState: () => current,
    getContext: (now) => ({ ...context(now), rng: () => 0 }),
    commit: (next) => {
      current = next;
      commits.push(next);
    },
    onNotice: () => undefined,
  });
  target.dispatchEvent(new CustomEvent('asterion:fleet-production-start-request', {
    detail: { queueKind: 'ships', itemId: 'scout', quantity: 1, orderId: 'bridge-ship', now: 3_000 },
  }));
  assert.equal(commits.length, 1);
  assert.equal(current.planets['helion-01'].fleetProduction.shipQueue[0]?.id, 'bridge-ship');
  target.dispatchEvent(new CustomEvent('asterion:fleet-production-cancel-request', {
    detail: { orderId: 'bridge-ship', now: 3_001 },
  }));
  assert.equal(commits.length, 2);
  assert.equal(current.planets['helion-01'].fleetProduction.shipQueue.length, 0);
  target.dispatchEvent(new CustomEvent('asterion:fleet-production-start-request', {
    detail: { queueKind: 'ships', itemId: 'scout', quantity: 1, orderId: 'bridge-complete', now: 4_000 },
  }));
  const bridgeCompletedTask = current.planets['helion-01'].fleetProduction.shipQueue[0];
  assert.ok(bridgeCompletedTask);
  const reconciledBridge = reconcileFleetProduction(current, {
    planetId: 'helion-01',
    now: bridgeCompletedTask.finishAt,
  });
  assert.equal(reconciledBridge.changed, true);
  current = reconciledBridge.state;
  commits.push(current);
  assert.equal(commits.length, 4);
  assert.equal(current.planets['helion-01'].fleet.ships.scout, 21);
  assert.equal(current.planets['helion-01'].fleetProduction.shipQueue.length, 0);
  unbind();
  const canceled = cancelFleetProduction(current, { ...context(3_002), rng: () => 0 }, 'missing');
  assert.equal(canceled.transition.ok, false);
});

test('satellite production creates orbital presence and dismantling removes only its unused contribution', () => {
  const initial = withBuildingSetup(createInitialSaveState('test', 0));
  const before = getPlanetEnergyLedger(initial.planets['helion-01'], initial.science.levels);
  const started = startFleetProduction(
    initial,
    context(2_000),
    'ships',
    'solar-satellite',
    2,
    'app-satellites',
  );
  assert.equal(started.transition.ok, true);
  assert.equal(getFleetSummaryForState(started.state).population, getFleetSummaryForState(initial).population + 2);
  const task = started.state.planets['helion-01'].fleetProduction.shipQueue[0];
  assert.ok(task);

  const completed = reconcileRuntime(started.state, { ...context(2_000), now: task.finishAt });
  const completedPlanet = completed.state.planets['helion-01'];
  const afterCompletion = getPlanetEnergyLedger(completedPlanet, completed.state.science.levels);
  assert.equal(completedPlanet.solarSatellites, 2);
  assert.equal(completedPlanet.fleet.ships['solar-satellite'], 0);
  assert.equal(afterCompletion.availableEnergy > before.availableEnergy, true);

  const dismantled = dismantleSolarSatellites(completed.state, { planetId: 'helion-01' }, 1);
  assert.equal(dismantled.ok, true);
  const dismantledPlanet = dismantled.state.planets['helion-01'];
  const afterDismantle = getPlanetEnergyLedger(dismantledPlanet, dismantled.state.science.levels);
  const completedSatellites = afterCompletion.sources.find((source) => source.id === 'solar-satellite');
  const remainingSatellites = afterDismantle.sources.find((source) => source.id === 'solar-satellite');
  assert.equal(dismantledPlanet.solarSatellites, 1);
  assert.equal(dismantledPlanet.fleet.ships['solar-satellite'], 0);
  assert.ok(completedSatellites);
  assert.ok(remainingSatellites);
  assert.equal(
    afterCompletion.availableEnergy - afterDismantle.availableEnergy,
    completedSatellites.fullContribution - remainingSatellites.fullContribution,
  );
});

test('satellite batches complete one unit at a time, keep the first unit through cancellation, and survive reload', () => {
  for (const factionId of ['aegis', 'synod', 'veyra'] as const) {
    const base = withBuildingSetup(createInitialSaveState('test', 0));
    const initial = {
      ...base,
      profile: { ...base.profile, factionId },
    } satisfies SaveState;
    const started = startFleetProduction(initial, context(2_000), 'ships', 'solar-satellite', 2, `partial-${factionId}`);
    assert.equal(started.transition.ok, true, factionId);
    const task = started.state.planets['helion-01'].fleetProduction.shipQueue[0];
    assert.ok(task, factionId);
    const firstFinish = task.startedAt + task.effectiveDurationMs + 1;

    const first = reconcileFleetProduction(started.state, { planetId: 'helion-01', now: firstFinish });
    const firstPlanet = first.state.planets['helion-01'];
    assert.equal(first.changed, true, factionId);
    assert.equal(firstPlanet.solarSatellites, 1, factionId);
    assert.equal(firstPlanet.fleet.ships['solar-satellite'], 0, factionId);
    assert.equal(firstPlanet.fleetProduction.shipQueue[0]?.completedQuantity, 1, factionId);
    assert.equal(getFleetSummaryForState(first.state).population, getFleetSummaryForState(initial).population + 2, factionId);
    assert.equal(getPlanetEnergyLedger(firstPlanet, first.state.science.levels).sources.find((source) => source.id === 'solar-satellite')?.count, 1, factionId);

    const repeated = reconcileFleetProduction(first.state, { planetId: 'helion-01', now: firstFinish });
    assert.equal(repeated.changed, false, factionId);
    assert.equal(repeated.state.planets['helion-01'].solarSatellites, 1, factionId);

    const storage = new MemoryStorage();
    const persistence = createPersistenceFacade({ mode: 'test', storage, now: () => firstFinish, testTimeScale: 10 });
    assert.equal(persistence.write(first.state).ok, true, factionId);
    const reloaded = persistence.read();
    const reloadedPlanet = reloaded.planets['helion-01'];
    assert.equal(reloadedPlanet.solarSatellites, 1, factionId);
    assert.equal(reloadedPlanet.fleetProduction.shipQueue[0]?.completedQuantity, 1, factionId);
    assert.equal(getPlanetEnergyLedger(reloadedPlanet, reloaded.science.levels).sources.find((source) => source.id === 'solar-satellite')?.count, 1, factionId);
    const reloadedAgain = persistence.read().planets['helion-01'];
    assert.equal(reloadedAgain.solarSatellites, 1, factionId);
    assert.equal(reloadedAgain.fleetProduction.shipQueue[0]?.completedQuantity, 1, factionId);

    const canceled = cancelFleetProduction(
      first.state,
      { ...context(firstFinish), rng: () => 0 },
      task.id,
    );
    assert.equal(canceled.transition.ok, true, factionId);
    assert.equal(canceled.state.planets['helion-01'].solarSatellites, 1, factionId);
    assert.equal(canceled.state.planets['helion-01'].fleetProduction.shipQueue.length, 0, factionId);
    assert.equal(canceled.state.planets['helion-01'].fleet.ships['solar-satellite'], 0, factionId);
    assert.equal(canceled.state.metal, first.state.metal + Math.floor(task.cost.metal / 2 * 0.6), factionId);
  }
});

test('science application uses one clock, reconciles idempotently, and event bridge reads latest state', () => {
  const base = createInitialSaveState('test');
  const initial = {
    ...base,
    planets: {
      ...base.planets,
      'helion-01': {
        ...base.planets['helion-01'],
        buildings: { ...base.planets['helion-01'].buildings, construction: 1, research: 1 },
      },
    },
  } satisfies SaveState;
  const started = startScience(initial, context(30_000), 1, 'science-1');
  assert.equal(started.transition.ok, true);
  const startedTask = started.transition.ok && 'task' in started.transition ? started.transition.task : null;
  assert.ok(startedTask);
  const completed = reconcileRuntime(started.state, { ...context(30_000), now: startedTask.finishAt });
  assert.equal(completed.changed, true);
  assert.equal(completed.events.some((event) => event.kind === 'science'), true);
  assert.equal(completed.state.science.levels[1], 1);
  const repeated = reconcileRuntime(completed.state, { ...context(30_000), now: startedTask.finishAt });
  assert.equal(repeated.changed, false);
  assert.deepEqual(repeated.events, []);

  const target = new EventTarget();
  let current = initial;
  const commits: SaveState[] = [];
  const unbind = bindScienceEventBridge({
    target,
    getState: () => current,
    getContext: (now) => ({ ...context(now), rng: () => 0 }),
    commit: (next) => {
      current = next;
      commits.push(next);
    },
    onNotice: () => undefined,
  });
  target.dispatchEvent(new CustomEvent(SCIENCE_START_REQUEST_EVENT, { detail: { scienceId: 1, now: 40_000 } }));
  target.dispatchEvent(new CustomEvent(SCIENCE_START_REQUEST_EVENT, { detail: { scienceId: 3, now: 40_001 } }));
  assert.equal(commits.length, 2);
  assert.equal(current.science.queue.length, 2);
  const energyBeforeScienceCancel = getPlanetEnergyLedger(current.planets['helion-01'], current.science.levels).availableEnergy;
  const canceled = cancelScience(current, { ...context(40_002), rng: () => 0 }, current.science.queue[0].id);
  assert.equal(canceled.transition.ok, true);
  assert.equal(getPlanetEnergyLedger(canceled.state.planets['helion-01'], canceled.state.science.levels).availableEnergy, energyBeforeScienceCancel);
  unbind();
});

test('fleet adapter is the only UI-facing source for fleet budget and summary', () => {
  const state = createInitialSaveState(ACTIVE_RUNTIME_MODE);
  const summary = getFleetSummaryForState(state);
  assert.equal(summary.population, 58);
  assert.equal(summary.capacity, 120);
  const budget = getFleetBuildBudget(state);
  assert.deepEqual(budget.summary, summary);

  const synodState = {
    ...state,
    profile: { ...state.profile, factionId: 'synod' as const },
  };
  const synodSummary = getFleetSummaryForState(synodState);
  assert.equal(synodSummary.population, 60);
  assert.equal(getFleetBuildBudget(synodState).factionId, 'synod');

  const storage = new MemoryStorage();
  const persistence = createPersistenceFacade({ mode: 'production', storage });
  assert.equal(persistence.write(state).ok, true);
  const readBudget = readFleetBuildBudget({ mode: 'production', storage });
  assert.deepEqual(readBudget.summary, summary);
});

test('planet population and hangar capacity add one per orbital satellite for every faction', () => {
  const initial = createInitialSaveState(ACTIVE_RUNTIME_MODE);
  for (const factionId of ['aegis', 'synod', 'veyra'] as const) {
    const state = {
      ...initial,
      profile: { ...initial.profile, factionId },
      planets: {
        ...initial.planets,
        'helion-01': { ...initial.planets['helion-01'], solarSatellites: 7 },
      },
    } satisfies SaveState;
    const fleetSummary = getFleetSummaryForState(state);
    assert.equal(getPlanetPopulationForState(state), fleetSummary.population, factionId);
    assert.equal(fleetSummary.population, getFleetBuildBudget(state).summary.population, factionId);
    assert.equal(fleetSummary.population, getFleetSummaryForState({
      ...state,
      planets: {
        ...state.planets,
        'helion-01': { ...state.planets['helion-01'], solarSatellites: 0 },
      },
    }).population + 7, factionId);
  }
});

test('runtime snapshot adapter emits one science event and one runtime event per publication', () => {
  const state = createInitialSaveState(ACTIVE_RUNTIME_MODE);
  const target = new EventTarget();
  let scienceEvents = 0;
  let runtimeEvents = 0;

  target.addEventListener(SCIENCE_RUNTIME_CHANGED_EVENT, () => {
    scienceEvents += 1;
  });
  target.addEventListener(RUNTIME_STATE_CHANGED_EVENT, () => {
    runtimeEvents += 1;
  });

  publishApplicationRuntimeSnapshot(state, context(50_000, ACTIVE_RUNTIME_MODE), target);

  assert.equal(scienceEvents, 1);
  assert.equal(runtimeEvents, 1);
});

test('functional application commits preserve simultaneous building and bot updates', () => {
  const initial = withBuildingSetup(createInitialSaveState('test'));
  const stateRef = { current: initial };
  const queuedUpdates: Array<(current: SaveState) => SaveState> = [];
  let committed = initial;
  const setState = (update: (current: SaveState) => SaveState) => {
    queuedUpdates.push(update);
  };
  const flush = (work: () => void) => {
    work();
    committed = queuedUpdates.reduce((current, update) => update(current), committed);
    queuedUpdates.length = 0;
  };
  const buildingContext = context(60_000);
  const assignment = { metal: 2, minerals: 1, gas: 0 };

  const buildingResult = enqueueApplicationStateUpdate(stateRef, setState, (current) => {
    const transition = startBuilding(current, buildingContext, 'trade-center');
    return {
      state: transition.ok ? transition.state : current,
      result: transition,
    };
  }, flush);
  assert.equal(buildingResult.ok, true);

  enqueueApplicationStateUpdate(stateRef, setState, (current) => ({
    state: applyProductionBots(current, buildingContext, assignment),
    result: undefined,
  }), flush);

  assert.equal(committed.queues['helion-01'].length, 1);
  assert.deepEqual(committed.planets['helion-01'].productionBots, assignment);
  assert.ok(committed.metal < initial.metal);
});

test('application result reflects a failed transition after a queued functional update fills the queue', () => {
  const testState = withBuildingSetup(createInitialSaveState('test'));
  const initial = {
    ...testState,
    planets: {
      ...testState.planets,
      'helion-01': {
        ...testState.planets['helion-01'],
        buildings: {
          ...testState.planets['helion-01'].buildings,
          'metal-storage': 0,
          'mineral-storage': 0,
          'gas-storage': 0,
        },
      },
    },
  };
  const stateRef = { current: initial };
  const queuedUpdates: Array<(current: SaveState) => SaveState> = [];
  let committed = initial;
  const setState = (update: (current: SaveState) => SaveState) => {
    queuedUpdates.push(update);
  };
  const flush = (work: () => void) => {
    work();
    committed = queuedUpdates.reduce((current, update) => update(current), committed);
    queuedUpdates.length = 0;
  };
  const buildingContext = context(70_000);

  setState((current) => {
    let next = current;
    for (const [offset, assetRole] of (['trade-center', 'metal-storage', 'mineral-storage'] as const).entries()) {
      const transition = startBuilding(next, { ...buildingContext, now: buildingContext.now + offset }, assetRole);
      assert.equal(transition.ok, true);
      next = transition.state;
    }
    return next;
  });

  const result = enqueueApplicationStateUpdate(stateRef, setState, (current) => {
    const transition = startBuilding(current, buildingContext, 'gas-storage');
    return {
      state: transition.ok ? transition.state : current,
      result: transition,
    };
  }, flush);

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'Очередь заполнена.');
  assert.equal(committed.queues['helion-01'].length, 3);
  assert.equal(committed.planets['helion-01'].buildings['gas-storage'], 0);
  assert.equal(stateRef.current, committed);
});

test('resource clock accrues canonical income once, scales only Test Mode, and preserves fractional time', () => {
  const base = createInitialSaveState('production', 0);
  const state = {
    ...base,
    metal: 0,
    minerals: 0,
    gas: 0,
    planets: {
      ...base.planets,
      'helion-01': {
        ...base.planets['helion-01'],
        energy: 0,
        buildings: {
          ...base.planets['helion-01'].buildings,
          'metal-production-1': 1,
          'mineral-production-1': 1,
          'gas-production-1': 1,
          'metal-storage': 1,
          'mineral-storage': 1,
          'gas-storage': 1,
        },
      },
    },
    resourceClock: {
      lastReconciledAt: 0,
      remainder: { metal: 0, minerals: 0, gas: 0, energy: 0 },
    },
  } satisfies SaveState;

  const production = reconcileRuntime(state, context(3_600_000, 'production'));
  assert.equal(production.state.metal, 150);
  assert.equal(production.state.minerals, 150);
  assert.equal(production.state.gas, 100);
  assert.equal(production.state.planets['helion-01'].energy, 0);
  assert.equal(production.state.resourceClock.lastReconciledAt, 3_600_000);
  assert.equal(reconcileRuntime(production.state, context(3_600_000, 'production')).changed, false);

  const canonicalIncome = {
    metal: production.state.metal,
    minerals: production.state.minerals,
    gas: production.state.gas,
  };
  for (const testTimeScale of [1, 15] as const) {
    const testScaled = reconcileRuntime(
      { ...state, resourceClock: { ...state.resourceClock, remainder: { ...state.resourceClock.remainder } } },
      { ...context(3_600_000, 'test'), testTimeScale },
    );
    const effectiveIncome = getEffectiveResourceIncomePerHour(canonicalIncome, 'test', testTimeScale);
    assert.deepEqual(
      {
        metal: testScaled.state.metal,
        minerals: testScaled.state.minerals,
        gas: testScaled.state.gas,
      },
      effectiveIncome,
    );
    assert.equal(testScaled.state.planets['helion-01'].energy, 0);
  }

  const half = reconcileRuntime(state, context(1_800_000, 'production'));
  const twoTicks = reconcileRuntime(half.state, context(3_600_000, 'production'));
  assert.equal(twoTicks.state.metal, production.state.metal);
  assert.equal(twoTicks.state.minerals, production.state.minerals);
  assert.equal(twoTicks.state.gas, production.state.gas);
});

test('resource income uses an independent persisted clock per planet and reconciles repeatedly without duplication', () => {
  const base = createInitialSaveState('production', 0);
  const sent = dispatchFlight(base, {
    requestId: 'resource-clock-colony',
    missionId: 'colonize',
    originPlanetId: 'helion-01',
    destination: { kind: 'coordinate', coordinate: { galaxy: 1, system: 2, position: 1 } },
    targetKind: 'empty',
    selectedShips: { colonizer: 1 },
    departedAt: 0,
  }, 0);
  assert.equal(sent.ok, true);
  if (!sent.ok) return;
  const created = reconcileFlights(sent.state, sent.flight.arrivalAt);
  assert.equal(created.events[0]?.status, 'colonized');
  const colonyId = 'planet-1-2-1';
  assert.ok(created.state.planets[colonyId]);
  const productionBuildings = {
    ...base.planets['helion-01'].buildings,
    'metal-production-1': 1,
    'mineral-production-1': 1,
    'gas-production-1': 1,
    'metal-storage': 1,
    'mineral-storage': 1,
    'gas-storage': 1,
  };
  const state = {
    ...created.state,
    metal: 0,
    minerals: 0,
    gas: 0,
    planets: {
      ...created.state.planets,
      'helion-01': {
        ...created.state.planets['helion-01'],
        buildings: productionBuildings,
        resources: { metal: 0, minerals: 0, gas: 0 },
      },
      [colonyId]: {
        ...created.state.planets[colonyId],
        buildings: productionBuildings,
        resources: { metal: 0, minerals: 0, gas: 0 },
      },
    },
    queues: { ...created.state.queues, [colonyId]: [] },
    resourceClock: {
      ...created.state.resourceClock,
      lastReconciledAt: sent.flight.arrivalAt,
      byPlanet: {
        ...created.state.resourceClock.byPlanet,
        'helion-01': {
          lastReconciledAt: sent.flight.arrivalAt,
          remainder: { metal: 0, minerals: 0, gas: 0, energy: 0 },
        },
      },
    },
  } satisfies SaveState;
  const planetContext = (planetId: string, now: number) => ({
    planetId,
    now,
    mode: 'production' as const,
    testTimeScale: 10 as const,
  });

  const firstTick = sent.flight.arrivalAt + 3_600_000;
  const secondTick = sent.flight.arrivalAt + 7_200_000;
  const firstPlanet = reconcileRuntime(state, planetContext('helion-01', firstTick));
  assert.equal(firstPlanet.state.planets['helion-01'].resources?.metal, 150);
  assert.equal(firstPlanet.state.planets[colonyId].resources?.metal, 150);

  const secondPlanet = reconcileRuntime(firstPlanet.state, planetContext(colonyId, secondTick));
  assert.equal(secondPlanet.state.planets[colonyId].resources?.metal, 300);
  assert.equal(secondPlanet.state.planets['helion-01'].resources?.metal, 300);

  const switchedBack = reconcileRuntime(secondPlanet.state, planetContext('helion-01', secondTick));
  assert.equal(switchedBack.state.planets['helion-01'].resources?.metal, 300);
  assert.equal(switchedBack.state.planets[colonyId].resources?.metal, 300);

  const repeated = reconcileRuntime(switchedBack.state, planetContext(colonyId, secondTick));
  assert.equal(repeated.changed, false);
  assert.deepEqual(repeated.state.planets[colonyId].resources, switchedBack.state.planets[colonyId].resources);
});

test('resource credit stops at dynamic capacity and does not bank time spent full', () => {
  const base = createInitialSaveState('production', 0);
  const capacities = getStorageCapacities(base.planets['helion-01'].buildings);
  const state = {
    ...base,
    metal: capacities.metal - 5,
    minerals: 0,
    gas: 0,
    resourceClock: {
      lastReconciledAt: 0,
      remainder: { metal: 0, minerals: 0, gas: 0, energy: 0 },
    },
  };
  const full = reconcileRuntime(state, context(3_600_000, 'production'));
  assert.equal(full.state.metal, capacities.metal);
  assert.equal(full.state.resourceClock.remainder.metal, 0);
  assert.equal(full.credit.burned.metal, 145);

  const spent = { ...full.state, metal: capacities.metal - 100 };
  const sameTimestamp = reconcileRuntime(spent, context(3_600_000, 'production'));
  assert.equal(sameTimestamp.state.metal, spent.metal);
  const nextInterval = reconcileRuntime(sameTimestamp.state, context(7_200_000, 'production'));
  assert.equal(nextInterval.state.metal, capacities.metal);
});

test('active overpopulation survives persistence without legacy roster normalization', () => {
  const storage = new MemoryStorage();
  const initial = withBuildingSetup(createInitialSaveState('test', 1_000));
  const queued = startFleetProduction(initial, context(1_000), 'ships', 'scout', 1, 'overpop-paused-queue');
  assert.equal(queued.transition.ok, true);
  const homeworld = queued.state.planets['helion-01'];
  const damaged = {
    ...queued.state,
    planets: {
      ...queued.state.planets,
      'helion-01': {
        ...homeworld,
        buildings: { ...homeworld.buildings, hangar: 0 },
        fleet: {
          ...homeworld.fleet,
          ships: { ...homeworld.fleet.ships, destroyer: 1_000 },
        },
      },
    },
  };
  const active = reconcilePlanetOverpopulation(damaged, 'helion-01', 1_000).state;
  assert.equal(active.planets['helion-01'].overpopulation?.blocked, true);
  assert.equal(active.planets['helion-01'].fleet.ships.destroyer, 1_000);
  const persistence = createPersistenceFacade({ mode: 'test', storage, now: () => 1_000 });
  assert.equal(persistence.write(active).ok, true);
  const reloaded = persistence.read();
  assert.equal(reloaded.planets['helion-01'].overpopulation?.blocked, true);
  assert.equal(reloaded.planets['helion-01'].fleet.ships.destroyer, 1_000);
  assert.equal(reloaded.planets['helion-01'].fleetProduction.shipQueue[0]?.itemId, 'scout');
  assert.equal(getFleetSummaryForState(reloaded).population > getFleetSummaryForState(reloaded).capacity, true);
});

test('overpopulation emits one persisted final system report with attrition-only ship counts', () => {
  const storage = new MemoryStorage();
  const initial = createInitialSaveState('production', 0);
  const homeworld = initial.planets['helion-01'];
  const fleet = createEmptyFleetState();
  fleet.ships.scout = 1_000;
  const overpopulated = {
    ...initial,
    planets: {
      ...initial.planets,
      'helion-01': {
        ...homeworld,
        buildings: { ...homeworld.buildings, hangar: 0 },
        fleet,
        solarSatellites: 0,
      },
    },
  } satisfies SaveState;
  const before = getPlanetOverpopulationSummary(overpopulated, 'helion-01');
  const start = reconcilePlanetOverpopulation(overpopulated, 'helion-01', 0);
  assert.equal(start.summary.blocked, true);
  assert.equal(start.state.reports.overpopulationReports?.length ?? 0, 0);
  assert.equal(start.state.planets['helion-01'].overpopulation?.initialPopulation, before.actualPopulation);
  assert.equal(start.state.planets['helion-01'].overpopulation?.initialCapacity, before.capacity);

  const halfwayAt = 5 * 60 * 1_000;
  const halfway = reconcilePlanetOverpopulation(start.state, 'helion-01', halfwayAt);
  assert.equal(halfway.summary.blocked, true);
  assert.ok((halfway.state.planets['helion-01'].overpopulation?.removedShips?.[0]?.count ?? 0) > 0);
  const persistence = createPersistenceFacade({ mode: 'production', storage, now: () => halfwayAt });
  assert.equal(persistence.write(halfway.state).ok, true);
  const reloaded = persistence.read();
  const reloadedEpisode = reloaded.planets['helion-01'].overpopulation;
  assert.deepEqual(reloadedEpisode?.removedShips, halfway.state.planets['helion-01'].overpopulation?.removedShips);
  assert.equal(reloadedEpisode?.initialPopulation, before.actualPopulation);
  assert.equal(reloadedEpisode?.initialCapacity, before.capacity);

  const delivered = reloaded.planets['helion-01'];
  const withDelivery = {
    ...reloaded,
    planets: {
      ...reloaded.planets,
      'helion-01': {
        ...delivered,
        fleet: {
          ...delivered.fleet,
          ships: { ...delivered.fleet.ships, scout: delivered.fleet.ships.scout + 100 },
        },
      },
    },
  } satisfies SaveState;
  const afterDelivery = reconcilePlanetOverpopulation(withDelivery, 'helion-01', halfwayAt);
  const afterCombat = afterDelivery.state.planets['helion-01'];
  const combatLoss = 25;
  const afterCombatState = {
    ...afterDelivery.state,
    planets: {
      ...afterDelivery.state.planets,
      'helion-01': {
        ...afterCombat,
        fleet: {
          ...afterCombat.fleet,
          ships: { ...afterCombat.fleet.ships, scout: afterCombat.fleet.ships.scout - combatLoss },
        },
      },
    },
  } satisfies SaveState;
  const afterCombatReconcile = reconcilePlanetOverpopulation(afterCombatState, 'helion-01', 6 * 60 * 1_000);
  assert.equal(afterCombatReconcile.summary.blocked, true);

  const unlocked = reconcilePlanetOverpopulation(afterCombatReconcile.state, 'helion-01', 10 * 60 * 1_000);
  assert.equal(unlocked.resolved, true);
  assert.equal(unlocked.summary.blocked, false);
  const reports = unlocked.state.reports.overpopulationReports ?? [];
  assert.equal(reports.length, 1);
  const report = reports[0];
  assert.ok(report);
  assert.equal(report.populationBefore, before.actualPopulation);
  assert.equal(report.populationAfter, unlocked.summary.actualPopulation);
  assert.equal(report.capacity, before.capacity);
  assert.equal(report.planetName, homeworld.name);
  assert.deepEqual(report.removedShips, [{
    shipId: 'scout',
    count: 1_000 + 100 - combatLoss - unlocked.state.planets['helion-01'].fleet.ships.scout,
  }]);

  const repeatedUnlock = reconcilePlanetOverpopulation(unlocked.state, 'helion-01', 10 * 60 * 1_000);
  assert.equal(repeatedUnlock.state.reports.overpopulationReports?.length, 1);
  assert.equal(repeatedUnlock.state.reports.overpopulationReports?.[0]?.id, report.id);
  assert.equal(persistence.write(unlocked.state).ok, true);
  assert.deepEqual(persistence.read().reports.overpopulationReports, reports);
});

function createScienceOverpopulationQueueFixture(
  firstEpisodeStartedAt: number,
  secondEpisodeStartedAt: number,
): SaveState {
  const initial = createInitialSaveState('test', 0);
  const homeworld = initial.planets['helion-01'];
  const blockedEpisode = (episodeStartedAt: number) => ({
    episodeStartedAt,
    initialExcess: 1,
    scheduledBurnPool: 1,
    burnedPopulation: 0,
    lastReconciledAt: episodeStartedAt,
    blocked: true,
  });

  return {
    ...initial,
    science: {
      ...initial.science,
      queue: [
        {
          id: 'blocked-planet-science',
          scienceId: SCIENCE_CATALOG[0].id,
          planetId: 'helion-01',
          fromLevel: 0,
          toLevel: 1,
          startedAt: 0,
          finishAt: 5_000,
          durationMs: 5_000,
          cost: { metal: 0, minerals: 0, gas: 0, energy: 0 },
        },
        {
          id: 'other-planet-science',
          scienceId: SCIENCE_CATALOG[1].id,
          planetId: 'another-colony',
          fromLevel: 0,
          toLevel: 1,
          startedAt: 5_000,
          finishAt: 10_000,
          durationMs: 5_000,
          cost: { metal: 0, minerals: 0, gas: 0, energy: 0 },
        },
      ],
    },
    planets: {
      ...initial.planets,
      'helion-01': {
        ...homeworld,
        overpopulation: blockedEpisode(firstEpisodeStartedAt),
      },
      'another-colony': {
        ...homeworld,
        overpopulation: blockedEpisode(secondEpisodeStartedAt),
      },
    },
  };
}

test('resolving a blocked planet shifts the queued science task and its global queue tail', () => {
  const initial = createInitialSaveState('test', 0);
  const blocked = {
    ...initial,
    science: {
      ...initial.science,
      queue: [
        {
          id: 'blocked-planet-science',
          scienceId: SCIENCE_CATALOG[0].id,
          planetId: 'helion-01',
          fromLevel: 0,
          toLevel: 1,
          startedAt: 0,
          finishAt: 60_000,
          durationMs: 60_000,
          cost: { metal: 0, minerals: 0, gas: 0, energy: 0 },
        },
        {
          id: 'other-planet-science',
          scienceId: SCIENCE_CATALOG[1].id,
          planetId: 'another-colony',
          fromLevel: 0,
          toLevel: 1,
          startedAt: 60_000,
          finishAt: 120_000,
          durationMs: 60_000,
          cost: { metal: 0, minerals: 0, gas: 0, energy: 0 },
        },
      ],
    },
    planets: {
      ...initial.planets,
      'helion-01': {
        ...initial.planets['helion-01'],
        overpopulation: {
          episodeStartedAt: 30_000,
          initialExcess: 1,
          scheduledBurnPool: 1,
          burnedPopulation: 0,
          lastReconciledAt: 30_000,
          blocked: true,
        },
      },
    },
  };

  const resolved = reconcilePlanetOverpopulation(blocked, 'helion-01', 90_000);
  assert.equal(resolved.resolved, true);
  assert.equal(resolved.state.science.queue[0]?.finishAt, 120_000);
  assert.equal(resolved.state.science.queue[1]?.finishAt, 180_000);
});

test('overlapping overpopulation locks shift a global science queue only once', () => {
  const fixture = createScienceOverpopulationQueueFixture(0, 8_000);
  const secondUnlocked = reconcilePlanetOverpopulation(fixture, 'another-colony', 9_000);
  assert.equal(secondUnlocked.resolved, true);
  const firstUnlocked = reconcilePlanetOverpopulation(secondUnlocked.state, 'helion-01', 10_000);
  assert.equal(firstUnlocked.resolved, true);

  const [first, second] = firstUnlocked.state.science.queue;
  assert.ok(first && second);
  assert.equal(first?.startedAt, 10_000);
  assert.equal(first?.finishAt, 15_000);
  assert.equal(second?.startedAt, 15_000);
  assert.equal(second?.finishAt, 20_000);
  assert.equal(first.finishAt - first.startedAt, first.durationMs);
  assert.equal(second.finishAt - second.startedAt, second.durationMs);
  assert.ok(first.finishAt <= second.startedAt, 'science queue must remain FIFO');
});

test('non-overlapping overpopulation locks add a later science pause exactly once', () => {
  const fixture = createScienceOverpopulationQueueFixture(0, 16_000);
  const firstUnlocked = reconcilePlanetOverpopulation(fixture, 'helion-01', 10_000);
  assert.equal(firstUnlocked.resolved, true);
  const secondUnlocked = reconcilePlanetOverpopulation(firstUnlocked.state, 'another-colony', 18_000);
  assert.equal(secondUnlocked.resolved, true);

  const [first, second] = secondUnlocked.state.science.queue;
  assert.ok(first && second);
  assert.equal(first?.startedAt, 10_000);
  assert.equal(first?.finishAt, 15_000);
  assert.equal(second?.startedAt, 17_000);
  assert.equal(second?.finishAt, 22_000);
  assert.equal(first.finishAt - first.startedAt, first.durationMs);
  assert.equal(second.finishAt - second.startedAt, second.durationMs);
  assert.ok(first.finishAt <= second.startedAt, 'science queue must remain FIFO');
});

test('an overdue blocked science head still pauses the shared queue only once', () => {
  const fixture = createScienceOverpopulationQueueFixture(8_000, 8_000);
  const secondUnlocked = reconcilePlanetOverpopulation(fixture, 'another-colony', 9_000);
  assert.equal(secondUnlocked.resolved, true);
  const firstUnlocked = reconcilePlanetOverpopulation(secondUnlocked.state, 'helion-01', 10_000);
  assert.equal(firstUnlocked.resolved, true);

  const [first, second] = firstUnlocked.state.science.queue;
  assert.ok(first && second);
  assert.equal(first?.startedAt, 2_000);
  assert.equal(first?.finishAt, 7_000);
  assert.equal(second?.startedAt, 7_000);
  assert.equal(second?.finishAt, 12_000);
  assert.equal(first.finishAt - first.startedAt, first.durationMs);
  assert.equal(second.finishAt - second.startedAt, second.durationMs);
  assert.ok(first.finishAt <= second.startedAt, 'science queue must remain FIFO');
});

test('a blocked planet pauses resource settlement and leaves a no-eligible episode persisted', () => {
  const initial = createInitialSaveState('production', 0);
  const homeworld = initial.planets['helion-01'];
  const noEligibleFleet = {
    ...homeworld.fleet,
    ships: { ...homeworld.fleet.ships, scout: 0, transporter: 0, recycler: 0, colonizer: 0, 'spy-probe': 0 },
    commanders: { ...homeworld.fleet.commanders, corsair: 20 },
  };
  const blocked = reconcilePlanetOverpopulation({
    ...initial,
    planets: {
      ...initial.planets,
      'helion-01': { ...homeworld, fleet: noEligibleFleet, solarSatellites: 200 },
    },
  }, 'helion-01', 0).state;
  const beforeClock = blocked.resourceClock.byPlanet?.['helion-01']?.lastReconciledAt ?? blocked.resourceClock.lastReconciledAt;
  const reconciled = reconcileRuntime(blocked, context(60 * 60 * 1_000, 'production'));
  assert.equal(reconciled.state.planets['helion-01'].overpopulation?.blocked, true);
  assert.equal(reconciled.state.planets['helion-01'].overpopulation?.lastResolutionReason, 'no-eligible-units');
  assert.equal(reconciled.state.resourceClock.byPlanet?.['helion-01']?.lastReconciledAt ?? reconciled.state.resourceClock.lastReconciledAt, beforeClock);
});

test('blocked planet rejects local commands before overdue queues can reconcile', () => {
  const setup = withBuildingSetup(createInitialSaveState('test', 0));
  const setupPlanet = setup.planets['helion-01'];
  const initial = {
    ...setup,
    planets: {
      ...setup.planets,
      'helion-01': {
        ...setupPlanet,
        buildings: { ...setupPlanet.buildings, hangar: getBuildingMaxLevel('hangar') },
      },
    },
  } satisfies SaveState;
  assert.equal(getPlanetOverpopulationSummary(initial, 'helion-01').blocked, false);
  const building = startBuilding(initial, context(0), 'trade-center');
  assert.equal(building.ok, true);
  const fleet = startFleetProduction(building.state, context(0), 'ships', 'scout', 1, 'blocked-fleet-queue');
  assert.equal(fleet.transition.ok, true);
  const spaceport = startSpaceportUpgrade(fleet.state, context(0), 'ships', 'scout', 'blocked-spaceport-queue');
  assert.equal(spaceport.ok, true);
  const researchReady = {
    ...spaceport.state,
    science: {
      ...spaceport.state.science,
      levels: { ...spaceport.state.science.levels, 1: 0 },
    },
  };
  const science = startScience(researchReady, context(0), 1, 'blocked-science-queue');
  assert.equal(science.transition.ok, true);

  const queuedPlanet = science.state.planets['helion-01'];
  const overdue = {
    ...science.state,
    queues: {
      ...science.state.queues,
      'helion-01': (science.state.queues['helion-01'] ?? []).map((task) => ({ ...task, finishAt: 1 })),
    },
    science: {
      ...science.state.science,
      queue: science.state.science.queue.map((task) => ({ ...task, finishAt: 1 })),
    },
    planets: {
      ...science.state.planets,
      'helion-01': {
        ...queuedPlanet,
        buildings: { ...queuedPlanet.buildings, hangar: 0 },
        fleet: { ...queuedPlanet.fleet, ships: { ...queuedPlanet.fleet.ships, destroyer: 1_000 } },
        solarSatellites: 3,
        fleetProduction: {
          ...queuedPlanet.fleetProduction,
          shipQueue: queuedPlanet.fleetProduction.shipQueue.map((task) => ({ ...task, finishAt: 1 })),
        },
        spaceportUpgrades: {
          ...queuedPlanet.spaceportUpgrades,
          shipQueue: queuedPlanet.spaceportUpgrades.shipQueue.map((task) => ({ ...task, finishAt: 1 })),
          commanderQueue: queuedPlanet.spaceportUpgrades.commanderQueue.map((task) => ({ ...task, finishAt: 1 })),
        },
      },
    },
  } satisfies SaveState;
  const blocked = reconcilePlanetOverpopulation(overdue, 'helion-01', 0).state;
  const now = 1_000_000;
  const blockedContext = { ...context(now), rng: () => 0 };

  const canceledBuilding = cancelBuilding(blocked, blockedContext, blocked.queues['helion-01'][0].id);
  assert.equal(canceledBuilding.ok, false);
  assert.equal(canceledBuilding.state, blocked);
  const destroyRolls: number[] = [];
  const destroyed = destroyBuilding(blocked, blockedContext, 'trade-center', () => {
    destroyRolls.push(1);
    return 0;
  });
  assert.equal(destroyed.ok, false);
  assert.equal(destroyed.state, blocked);
  assert.deepEqual(destroyRolls, []);
  assert.equal(applyProductionBots(blocked, blockedContext, { metal: 0, minerals: 0, gas: 0 }), blocked);

  const fleetTask = blocked.planets['helion-01'].fleetProduction.shipQueue[0];
  assert.ok(fleetTask);
  const canceledFleet = cancelFleetProduction(blocked, blockedContext, fleetTask.id);
  assert.equal(canceledFleet.transition.ok, false);
  assert.equal(canceledFleet.state, blocked);
  const dismantled = dismantleSolarSatellites(blocked, { planetId: 'helion-01' }, 1);
  assert.equal(dismantled.ok, false);
  assert.equal(dismantled.state, blocked);

  const spaceportTask = blocked.planets['helion-01'].spaceportUpgrades.shipQueue[0];
  assert.ok(spaceportTask);
  const canceledSpaceport = cancelSpaceportUpgrade(blocked, blockedContext, spaceportTask.id);
  assert.equal(canceledSpaceport.ok, false);
  assert.equal(canceledSpaceport.state, blocked);
  const scienceTask = blocked.science.queue[0];
  assert.ok(scienceTask);
  const canceledScience = cancelScience(blocked, { ...blockedContext, blockedPlanetIds: new Set() }, scienceTask.id);
  assert.equal(canceledScience.transition.ok, false);
  assert.equal(canceledScience.state, blocked);
  const unblockedPlanet = {
    ...blocked.planets['helion-01'],
    fleet: createEmptyFleetState(),
    buildings: { ...blocked.planets['helion-01'].buildings, hangar: getBuildingMaxLevel('hangar') },
    overpopulation: undefined,
  };
  const stateWithUnblockedPlanet = {
    ...blocked,
    planets: { ...blocked.planets, 'unblocked-colony': unblockedPlanet },
  } satisfies SaveState;
  const canceledFromOtherPlanet = cancelScience(stateWithUnblockedPlanet, {
    ...blockedContext,
    planetId: 'unblocked-colony',
    blockedPlanetIds: new Set(),
  }, scienceTask.id);
  assert.equal(canceledFromOtherPlanet.transition.ok, false);
  assert.equal(canceledFromOtherPlanet.state, stateWithUnblockedPlanet);

  const repaired = repairUnits(blocked, 'helion-01', 'ship', 'scout', 1, 'resources');
  assert.equal(repaired.transition.ok, false);
  assert.equal(repaired.state, blocked);
  const removedFromRepair = removeRepairUnits(blocked, 'helion-01', 'ship', 'scout', 1);
  assert.equal(removedFromRepair.transition.ok, false);
  assert.equal(removedFromRepair.state, blocked);

  assert.equal(blocked.queues['helion-01'][0]?.finishAt, 1);
  assert.equal(blocked.science.queue[0]?.finishAt, 1);
  assert.equal(blocked.planets['helion-01'].fleetProduction.shipQueue[0]?.finishAt, 1);
  assert.equal(blocked.planets['helion-01'].spaceportUpgrades.shipQueue[0]?.finishAt, 1);

  let current = blocked;
  const fleetCommits: SaveState[] = [];
  const fleetTarget = new EventTarget();
  const unbindFleet = bindFleetProductionEventBridge({
    target: fleetTarget,
    getState: () => current,
    getContext: (eventNow) => ({ ...context(eventNow), rng: () => 0 }),
    commit: (next) => { current = next; fleetCommits.push(next); },
    onNotice: () => undefined,
  });
  fleetTarget.dispatchEvent(new CustomEvent('asterion:fleet-production-cancel-request', {
    detail: { orderId: fleetTask.id, now },
  }));
  assert.deepEqual(fleetCommits, []);
  assert.equal(current, blocked);
  unbindFleet();

  const scienceCommits: SaveState[] = [];
  const scienceTarget = new EventTarget();
  const unbindScience = bindScienceEventBridge({
    target: scienceTarget,
    getState: () => current,
    getContext: (eventNow) => ({ ...context(eventNow), blockedPlanetIds: new Set() }),
    commit: (next) => { current = next; scienceCommits.push(next); },
    onNotice: () => undefined,
  });
  scienceTarget.dispatchEvent(new CustomEvent(SCIENCE_CANCEL_REQUEST_EVENT, {
    detail: { taskId: scienceTask.id, now },
  }));
  assert.deepEqual(scienceCommits, []);
  assert.equal(current, blocked);
  unbindScience();
});
