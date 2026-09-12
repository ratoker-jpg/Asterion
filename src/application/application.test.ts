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
  getFleetSummaryForState,
  readFleetBuildBudget,
} from './fleet.ts';
import { bindScienceEventBridge, cancelScience, startScience } from './science.ts';
import { reconcileRuntime } from './reconcile.ts';
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
  const canceled = cancelScience(current, { ...context(40_002), rng: () => 0 }, current.science.queue[0].id);
  assert.equal(canceled.transition.ok, true);
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
  assert.equal(production.state.resourceClock.lastReconciledAt, 3_600_000);
  assert.equal(reconcileRuntime(production.state, context(3_600_000, 'production')).changed, false);

  const testScaled = reconcileRuntime({ ...state, resourceClock: { ...state.resourceClock } }, context(3_600_000, 'test'));
  assert.equal(testScaled.state.metal, 1_500);

  const half = reconcileRuntime(state, context(1_800_000, 'production'));
  const twoTicks = reconcileRuntime(half.state, context(3_600_000, 'production'));
  assert.equal(twoTicks.state.metal, production.state.metal);
  assert.equal(twoTicks.state.minerals, production.state.minerals);
  assert.equal(twoTicks.state.gas, production.state.gas);
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
