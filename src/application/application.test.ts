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

  assert.equal(initial.metal, 999_999_999);
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
  assert.equal(migrated.planets['helion-01'].fleet.ships.scout, 20);
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
  assert.ok(trade.state.metal > collected.state.metal);

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
  const setState = (update: (current: SaveState) => SaveState) => {
    queuedUpdates.push(update);
  };
  const buildingContext = context(60_000);
  const assignment = { metal: 2, minerals: 1, gas: 0 };

  const buildingResult = enqueueApplicationStateUpdate(stateRef, setState, (current) => {
    const transition = startBuilding(current, buildingContext, 'trade-center');
    return {
      state: transition.ok ? transition.state : current,
      result: transition,
    };
  });
  assert.equal(buildingResult.ok, true);

  enqueueApplicationStateUpdate(stateRef, setState, (current) => ({
    state: applyProductionBots(current, buildingContext, assignment),
    result: undefined,
  }));

  const finalState = queuedUpdates.reduce((current, update) => update(current), initial);
  assert.equal(finalState.queues['helion-01'].length, 1);
  assert.deepEqual(finalState.planets['helion-01'].productionBots, assignment);
  assert.ok(finalState.metal < initial.metal);
});
