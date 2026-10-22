import assert from 'node:assert/strict';
import test from 'node:test';

import { createInitialSaveState, createPersistenceFacade } from './persistence.ts';
import { startBuilding } from './buildings.ts';
import { startScience } from './science.ts';
import { reconcileRuntime } from './reconcile.ts';
import { getPlanetResources, type SaveState } from './contracts.ts';
import { createColonyPlanetRuntime } from './owned-planets.ts';
import { getPlanetEnergyLedger, initializePlanetEnergy } from './energy.ts';
import { SCIENCE_ID_MATHEMATICS, SCIENCE_ID_PHYSICS } from '../domain/buildings/balance-v1.ts';
import type { StorageLike } from './persistence.ts';

const HOME = 'helion-01';
const COLONY = 'planet-1-2-1';
const T0 = 1_000_000;
const HOUR = 3_600_000;

const context = (now: number, planetId = HOME) => ({ planetId, now, mode: 'production' as const, testTimeScale: 1 as const });

function memoryStorage(): StorageLike {
  const data = new Map<string, string>();
  return { getItem: (key) => data.get(key) ?? null, setItem: (key, value) => { data.set(key, value); }, removeItem: (key) => { data.delete(key); } };
}

/** Production start with large storages, so caps never hide an income difference. */
function wideStorage(state: SaveState, planetId: string): SaveState {
  const planet = state.planets[planetId]!;
  return {
    ...state,
    planets: {
      ...state.planets,
      [planetId]: {
        ...planet,
        buildings: { ...planet.buildings, 'metal-storage': 12, 'mineral-storage': 12, 'gas-storage': 12, research: Math.max(5, planet.buildings.research ?? 0) },
      },
    },
  };
}

function withColony(state: SaveState): SaveState {
  const base = createColonyPlanetRuntime(state, { galaxy: 1, system: 2, position: 1 });
  const colony = initializePlanetEnergy(
    { ...base, energy: 1_000_000, buildings: { ...base.buildings, 'basic-energy': 8 }, resources: { metal: 8_000, minerals: 8_000, gas: 8_000 } },
    state.science.levels,
  );
  const next: SaveState = {
    ...state,
    planets: { ...state.planets, [COLONY]: colony },
    queues: { ...state.queues, [COLONY]: [] },
    resourceClock: {
      ...state.resourceClock,
      byPlanet: { ...(state.resourceClock.byPlanet ?? {}), [COLONY]: { lastReconciledAt: T0, remainder: { metal: 0, minerals: 0, gas: 0, energy: 0 } } },
    },
  };
  return wideStorage(next, COLONY);
}

const wallet = (state: SaveState, planetId: string) => getPlanetResources(state, planetId);

test('F-02: a mine finishing offline produces at its new level from finishAt (audit repro: +600 metal)', () => {
  const initial = wideStorage(createInitialSaveState('production', T0), HOME);
  const start = startBuilding(initial, context(T0), 'metal-production-1');
  assert.equal(start.ok, true);
  const finish = start.state.queues[HOME]![0]!.finishAt;
  const end = finish + HOUR;

  const oneShot = reconcileRuntime(start.state, context(end)).state;
  const split = reconcileRuntime(reconcileRuntime(start.state, context(finish)).state, context(end)).state;
  assert.equal(oneShot.planets[HOME]!.buildings['metal-production-1'], 2);
  assert.equal(split.planets[HOME]!.buildings['metal-production-1'], 2);
  assert.deepEqual(wallet(oneShot, HOME), wallet(split, HOME));
  assert.equal(oneShot.queues[HOME]!.length, 0);
});

test('F-02: Mathematics finishing offline raises income on every world from finishAt, also after save/reload', () => {
  const initial = withColony(wideStorage(createInitialSaveState('production', T0), HOME));
  const started = startScience(initial, context(T0), SCIENCE_ID_MATHEMATICS);
  assert.equal(started.transition.ok, true, started.transition.reason ?? '');
  const finish = started.state.science.queue[0]!.finishAt;
  const end = finish + 2 * HOUR;

  const oneShot = reconcileRuntime(started.state, context(end)).state;

  // Split run with a real facade save/read in the middle.
  const storage = memoryStorage();
  const facade = createPersistenceFacade({ mode: 'production', storage, saveKey: 'asterion.slot.slot-offline.v1', now: () => finish });
  const atFinish = reconcileRuntime(started.state, context(finish)).state;
  assert.equal(facade.write(atFinish).ok, true);
  const reloaded = createPersistenceFacade({ mode: 'production', storage, saveKey: 'asterion.slot.slot-offline.v1', now: () => finish }).read();
  const split = reconcileRuntime(reloaded, context(end)).state;

  assert.equal(oneShot.science.levels[SCIENCE_ID_MATHEMATICS], 1);
  assert.equal(split.science.levels[SCIENCE_ID_MATHEMATICS], 1);
  assert.equal(oneShot.science.queue.length, 0);
  for (const planetId of [HOME, COLONY]) assert.deepEqual(wallet(oneShot, planetId), wallet(split, planetId), planetId);
});

test('F-02: several completions on several worlds in one long gap equal step-by-step reconciles', () => {
  let state = withColony(wideStorage(createInitialSaveState('production', T0), HOME));
  const homeBuild = startBuilding(state, context(T0), 'metal-production-1');
  assert.equal(homeBuild.ok, true);
  state = homeBuild.state;
  const homeSecond = startBuilding(state, context(T0), 'mineral-production-1');
  assert.equal(homeSecond.ok, true, 'second item queues behind the first');
  state = homeSecond.state;
  const colonyBuild = startBuilding(state, context(T0, COLONY), 'gas-production-1');
  assert.equal(colonyBuild.ok, true, String((colonyBuild as { reason?: unknown }).reason));
  state = colonyBuild.state;
  const science = startScience(state, context(T0), SCIENCE_ID_MATHEMATICS);
  assert.equal(science.transition.ok, true);
  state = science.state;

  const boundaries = [
    ...state.queues[HOME]!.map((item) => item.finishAt),
    ...state.queues[COLONY]!.map((item) => item.finishAt),
    ...state.science.queue.map((task) => task.finishAt),
  ].sort((left, right) => left - right);
  const end = boundaries.at(-1)! + 6 * HOUR;

  const oneShot = reconcileRuntime(state, context(end)).state;
  let stepped = state;
  for (const at of [...boundaries, end]) stepped = reconcileRuntime(stepped, context(at)).state;
  // A finer, boundary-agnostic visit pattern must give the same totals too.
  let hourly = state;
  for (let at = T0 + HOUR; at < end; at += HOUR) hourly = reconcileRuntime(hourly, context(at)).state;
  hourly = reconcileRuntime(hourly, context(end)).state;

  assert.equal(oneShot.queues[HOME]!.length, 0, 'both queued buildings completed in one reconcile');
  assert.equal(oneShot.planets[HOME]!.buildings['mineral-production-1'], (state.planets[HOME]!.buildings['mineral-production-1'] ?? 0) + 1);
  assert.equal(oneShot.planets[COLONY]!.buildings['gas-production-1'], (state.planets[COLONY]!.buildings['gas-production-1'] ?? 0) + 1);
  for (const planetId of [HOME, COLONY]) {
    assert.deepEqual(wallet(oneShot, planetId), wallet(stepped, planetId), `${planetId} stepped`);
    assert.deepEqual(wallet(oneShot, planetId), wallet(hourly, planetId), `${planetId} hourly`);
  }
  assert.deepEqual(oneShot.planets[HOME]!.buildings, stepped.planets[HOME]!.buildings);
});

test('F-02: equal finishAt timestamps resolve once and never double-credit', () => {
  let state = withColony(wideStorage(createInitialSaveState('production', T0), HOME));
  state = startBuilding(state, context(T0), 'metal-production-1').state;
  state = startBuilding(state, context(T0, COLONY), 'metal-production-1').state;
  const finish = state.queues[HOME]![0]!.finishAt;
  assert.equal(state.queues[COLONY]![0]!.finishAt, finish, 'same building, same start: same finishAt');
  const end = finish + HOUR;
  const oneShot = reconcileRuntime(state, context(end)).state;
  const twice = reconcileRuntime(reconcileRuntime(state, context(end)).state, context(end)).state;
  assert.deepEqual(wallet(twice, HOME), wallet(oneShot, HOME), 'a repeated reconcile at the same time adds nothing');
  const split = reconcileRuntime(reconcileRuntime(state, context(finish)).state, context(end)).state;
  for (const planetId of [HOME, COLONY]) assert.deepEqual(wallet(oneShot, planetId), wallet(split, planetId));
});

test('guard: Physics finishing raises solar energy on every owned world, not only the selected one', () => {
  let state = withColony(wideStorage(createInitialSaveState('production', T0), HOME));
  for (const planetId of [HOME, COLONY]) {
    const planet = state.planets[planetId]!;
    state = { ...state, planets: { ...state.planets, [planetId]: { ...planet, buildings: { ...planet.buildings, 'basic-energy': 5 } } } };
  }
  state = reconcileRuntime(state, context(T0)).state;
  const reloadedBaseline = (value: SaveState) => {
    const storage = memoryStorage();
    const facade = createPersistenceFacade({ mode: 'production', storage, saveKey: 'asterion.slot.slot-physics.v1', now: () => T0 });
    facade.write(value);
    return facade.read();
  };
  state = reloadedBaseline(state);
  const before = getPlanetEnergyLedger(state.planets[COLONY]!, state.science.levels).producedEnergy;
  const started = startScience(state, context(T0), SCIENCE_ID_PHYSICS);
  assert.equal(started.transition.ok, true, started.transition.reason ?? '');
  const finish = started.state.science.queue[0]!.finishAt;
  const done = reconcileRuntime(started.state, context(finish)).state;
  assert.equal(done.science.levels[SCIENCE_ID_PHYSICS], 1);
  const colonyAfter = getPlanetEnergyLedger(done.planets[COLONY]!, done.science.levels).producedEnergy;
  assert.ok(colonyAfter > before, `colony solar output grows with Physics (${before} -> ${colonyAfter})`);
  // The live ledger now equals what a reload would rebuild.
  const reloaded = reloadedBaseline(done);
  assert.equal(getPlanetEnergyLedger(reloaded.planets[COLONY]!, reloaded.science.levels).producedEnergy, colonyAfter);
});
