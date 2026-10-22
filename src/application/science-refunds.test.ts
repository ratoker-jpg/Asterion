import assert from 'node:assert/strict';
import test from 'node:test';

import { createInitialSaveState, createPersistenceFacade, type StorageLike } from './persistence.ts';
import { cancelScience, startScience } from './science.ts';
import { getPlanetResources, type SaveState } from './contracts.ts';
import { createColonyPlanetRuntime, destroyOwnedPlanet } from './owned-planets.ts';
import { initializePlanetEnergy } from './energy.ts';
import { getStorageCapacities } from '../domain/buildings/resource-zone.ts';
import { SCIENCE_ID_MATHEMATICS, SCIENCE_ID_PHYSICS } from '../domain/buildings/balance-v1.ts';

const HOME = 'helion-01';
const COLONY = 'planet-1-2-1';
const T0 = 1_000_000;
const ctx = (planetId: string, now = T0) => ({ planetId, now, mode: 'production' as const, testTimeScale: 1 as const, rng: () => 0 });

function twoWorlds(): SaveState {
  const initial = createInitialSaveState('production', T0);
  const home = initial.planets[HOME]!;
  const base = createColonyPlanetRuntime(initial, { galaxy: 1, system: 2, position: 1 });
  const colony = initializePlanetEnergy({
    ...base,
    energy: 1_000_000,
    buildings: { ...base.buildings, research: 5, 'basic-energy': 8, 'metal-storage': 10, 'mineral-storage': 10, 'gas-storage': 10 },
    resources: { metal: 8_000, minerals: 8_000, gas: 8_000 },
  }, initial.science.levels);
  return {
    ...initial,
    planets: {
      [HOME]: { ...home, buildings: { ...home.buildings, research: Math.max(5, home.buildings.research ?? 0) } },
      [COLONY]: colony,
    },
    queues: { ...initial.queues, [COLONY]: [] },
  };
}

const wallet = (state: SaveState, planetId: string) => getPlanetResources(state, planetId);

function start(state: SaveState, planetId: string, scienceId: number, id: string): SaveState {
  const result = startScience(state, ctx(planetId), scienceId as never, id);
  assert.equal(result.transition.ok, true, result.transition.reason ?? '');
  return result.state;
}

test('F-09: canceling research paid by A while B is selected refunds A only', () => {
  let state = start(twoWorlds(), HOME, SCIENCE_ID_PHYSICS, 'physics-a');
  const task = state.science.queue[0]!;
  assert.equal(task.planetId, HOME);
  state = { ...state, currentPlanetId: COLONY, ...wallet(state, COLONY) };
  const homeBefore = wallet(state, HOME);
  const colonyBefore = wallet(state, COLONY);

  const canceled = cancelScience(state, ctx(COLONY), 'physics-a');
  assert.equal(canceled.transition.ok, true);
  const percent = canceled.transition.ok && 'refundPercent' in canceled.transition ? canceled.transition.refundPercent! : 0;
  assert.equal(percent, 60, 'rng 0 keeps the lowest established refund percent');
  assert.deepEqual(wallet(canceled.state, COLONY), colonyBefore, 'the selected planet gets nothing');
  assert.deepEqual(wallet(canceled.state, HOME), {
    metal: homeBefore.metal + Math.floor(task.cost.metal * 0.6),
    minerals: homeBefore.minerals + Math.floor(task.cost.minerals * 0.6),
    gas: homeBefore.gas + Math.floor(task.cost.gas * 0.6),
  });
  assert.equal(canceled.payerCredits?.[0]?.planetId, HOME);

  // A repeated cancel of the same task pays nothing again.
  const again = cancelScience(canceled.state, ctx(COLONY), 'physics-a');
  assert.equal(again.transition.ok, false);
  assert.deepEqual(wallet(again.state, HOME), wallet(canceled.state, HOME));
});

test('F-09: a cascade with different payers refunds each payer separately, against its own storage', () => {
  let state = start(twoWorlds(), HOME, SCIENCE_ID_PHYSICS, 'physics-l1-home');
  state = start(state, COLONY, SCIENCE_ID_PHYSICS, 'physics-l2-colony');
  state = start(state, COLONY, SCIENCE_ID_MATHEMATICS, 'math-colony');
  const [l1, l2] = state.science.queue;
  // Fill the home storage: its refund must burn on home, not move to the colony.
  const caps = getStorageCapacities(state.planets[HOME]!.buildings);
  state = { ...state, metal: caps.metal, minerals: caps.minerals, gas: caps.gas, planets: { ...state.planets, [HOME]: { ...state.planets[HOME]!, resources: { metal: caps.metal, minerals: caps.minerals, gas: caps.gas } } } };
  const colonyBefore = wallet(state, COLONY);

  const canceled = cancelScience(state, ctx(HOME), 'physics-l1-home');
  assert.equal(canceled.transition.ok, true);
  assert.deepEqual(canceled.state.science.queue.map((task) => task.id), ['math-colony'], 'the dependent L2 is canceled, the independent task stays');
  const credits = canceled.payerCredits ?? [];
  const home = credits.find((credit) => credit.planetId === HOME)!;
  const colony = credits.find((credit) => credit.planetId === COLONY)!;
  assert.deepEqual(home.nominal, { metal: Math.floor(l1!.cost.metal * 0.6), minerals: Math.floor(l1!.cost.minerals * 0.6), gas: Math.floor(l1!.cost.gas * 0.6) });
  assert.deepEqual(home.accepted, { metal: 0, minerals: 0, gas: 0 }, 'a full payer storage burns its own refund');
  assert.deepEqual(home.burned, home.nominal);
  assert.deepEqual(colony.nominal, { metal: Math.floor(l2!.cost.metal * 0.6), minerals: Math.floor(l2!.cost.minerals * 0.6), gas: Math.floor(l2!.cost.gas * 0.6) });
  for (const key of ['metal', 'minerals', 'gas'] as const) assert.equal(colony.accepted[key] + colony.burned[key], colony.nominal[key]);
  assert.deepEqual(wallet(canceled.state, COLONY), {
    metal: colonyBefore.metal + colony.accepted.metal,
    minerals: colonyBefore.minerals + colony.accepted.minerals,
    gas: colonyBefore.gas + colony.accepted.gas,
  });
  assert.deepEqual(wallet(canceled.state, HOME), { metal: caps.metal, minerals: caps.minerals, gas: caps.gas });
});

test('F-09: the payer survives save/load and still receives the refund', () => {
  const data = new Map<string, string>();
  const storage: StorageLike = { getItem: (key) => data.get(key) ?? null, setItem: (key, value) => { data.set(key, value); }, removeItem: (key) => { data.delete(key); } };
  const facade = createPersistenceFacade({ mode: 'production', storage, saveKey: 'asterion.slot.slot-science.v1', now: () => T0 });
  const started = start(twoWorlds(), COLONY, SCIENCE_ID_PHYSICS, 'physics-colony');
  assert.equal(facade.write({ ...started, currentPlanetId: HOME, ...wallet(started, HOME) }).ok, true);
  const loaded = facade.read();
  assert.equal(loaded.science.queue[0]?.planetId, COLONY);
  const homeBefore = wallet(loaded, HOME);
  const colonyBefore = wallet(loaded, COLONY);
  const canceled = cancelScience(loaded, ctx(HOME), 'physics-colony');
  assert.equal(canceled.transition.ok, true);
  assert.deepEqual(wallet(canceled.state, HOME), homeBefore);
  assert.ok(wallet(canceled.state, COLONY).metal > colonyBefore.metal);
});

test('F-09 / owner rule: destroying the payer cancels its research with no refund anywhere; survivors keep theirs', () => {
  let state = start(twoWorlds(), COLONY, SCIENCE_ID_PHYSICS, 'physics-l1-colony');
  state = start(state, HOME, SCIENCE_ID_PHYSICS, 'physics-l2-home'); // depends on the colony's L1
  state = start(state, HOME, SCIENCE_ID_MATHEMATICS, 'math-home'); // independent
  const l2 = state.science.queue.find((task) => task.id === 'physics-l2-home')!;
  const homeBefore = wallet(state, HOME);
  const levelsBefore = { ...state.science.levels };

  const destroyed = destroyOwnedPlanet(state, COLONY, T0 + 1, () => 0);
  assert.equal(destroyed.destroyed, true);
  const after = destroyed.state;
  assert.equal(after.planets[COLONY], undefined);
  assert.deepEqual(after.science.queue.map((task) => task.id), ['math-home'], 'colony tasks gone, the dependent home task canceled');
  assert.deepEqual(after.science.levels, levelsBefore, 'completed levels are never rolled back');
  // Only the surviving payer's canceled task is refunded, to that payer.
  assert.deepEqual(wallet(after, HOME), {
    metal: homeBefore.metal + Math.floor(l2.cost.metal * 0.6),
    minerals: homeBefore.minerals + Math.floor(l2.cost.minerals * 0.6),
    gas: homeBefore.gas + Math.floor(l2.cost.gas * 0.6),
  });
  // Canceling afterwards cannot pay out the destroyed planet's tasks.
  assert.equal(cancelScience(after, ctx(HOME), 'physics-l1-colony').transition.ok, false);
});

test('F-09 / owner rule: destroying the selected payer moves the selection without crediting the new planet', () => {
  let state = start(twoWorlds(), COLONY, SCIENCE_ID_PHYSICS, 'physics-colony');
  state = { ...state, currentPlanetId: COLONY, ...wallet(state, COLONY) };
  const homeBefore = wallet(state, HOME);
  const after = destroyOwnedPlanet(state, COLONY, T0 + 1, () => 0).state;
  assert.equal(after.currentPlanetId, HOME);
  assert.deepEqual(wallet(after, HOME), homeBefore);
  assert.deepEqual({ metal: after.metal, minerals: after.minerals, gas: after.gas }, homeBefore, 'root wallet alias follows the new selection');
  assert.equal(after.science.queue.length, 0);
});

test('F-09 / owner rule: a survivor task canceled by a destruction refunds its own payer, not the selected world', () => {
  const THIRD = 'planet-1-3-1';
  const base = twoWorlds();
  const third = { ...createColonyPlanetRuntime(base, { galaxy: 1, system: 3, position: 1 }), resources: { metal: 100, minerals: 100, gas: 100 } };
  let state: SaveState = { ...base, planets: { ...base.planets, [THIRD]: third }, queues: { ...base.queues, [THIRD]: [] } };
  state = start(state, COLONY, SCIENCE_ID_PHYSICS, 'physics-l1-colony');
  state = start(state, HOME, SCIENCE_ID_PHYSICS, 'physics-l2-home');
  state = { ...state, currentPlanetId: THIRD, ...wallet(state, THIRD) };
  const l2 = state.science.queue.find((task) => task.id === 'physics-l2-home')!;
  const homeBefore = wallet(state, HOME);
  const thirdBefore = wallet(state, THIRD);
  const after = destroyOwnedPlanet(state, COLONY, T0 + 1, () => 0).state;
  assert.equal(after.science.queue.length, 0);
  assert.deepEqual(wallet(after, THIRD), thirdBefore, 'the selected world receives nothing');
  assert.equal(wallet(after, HOME).metal, homeBefore.metal + Math.floor(l2.cost.metal * 0.6));
});
