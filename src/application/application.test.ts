import assert from 'node:assert/strict';
import test from 'node:test';
import { getSpaceportUpgradeCatalog, previewSpaceportUpgrade } from '../domain/buildings/spaceport-upgrades.ts';
import { SCIENCE_CATALOG } from '../domain/science/catalog.ts';
import {
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
import { bindScienceEventBridge, cancelScience, startScience } from './science.ts';
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
import type { SaveState } from './contracts.ts';

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
  target.dispatchEvent(new CustomEvent('asterion:fleet-production-start-request', {
    detail: { queueKind: 'ships', itemId: 'scout', quantity: 0, now: bridgeCompletedTask.finishAt },
  }));
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
  assert.equal(firstPlanet.state.planets[colonyId].resources?.metal, 0);

  const secondPlanet = reconcileRuntime(firstPlanet.state, planetContext(colonyId, secondTick));
  assert.equal(secondPlanet.state.planets[colonyId].resources?.metal, 300);
  assert.equal(secondPlanet.state.planets['helion-01'].resources?.metal, 150);

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
