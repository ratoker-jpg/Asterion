import assert from 'node:assert/strict';
import test from 'node:test';

import { setBuildPlanHelper, buildPriority, moveBuildPriority, putBuildPriorityFirst, removeBuildTarget, swapBuildPriority, setBuildTarget, migrateBuildPlans, type BuildPlan } from '../domain/buildings/build-plan.ts';
import { applyFleetUiUpdate, migrateFleetUiState } from '../domain/flights/fleet-ui.ts';
import { createDefaultNewGameConfig } from '../domain/world/config.ts';
import type { SaveState } from './contracts.ts';
import { getPlanetResources, replacePlanetResources } from './contracts.ts';
import { buildBuildPlanView, plannedRobotAssignment, runBuildPlans } from './build-plan.ts';
import type { BuildingRole } from '../domain/buildings/balance-v1.ts';
import { startBuilding } from './buildings.ts';
import { getPlanetEnergyLedger, spendPlanetEnergy } from './energy.ts';
import { createInitialSaveState } from './persistence.ts';

const NOW = 1_000_000;
const RUNTIME = { now: NOW, mode: 'production' as const, testTimeScale: 1 as const };
const PLANET = 'helion-01';
const ROOMY = { metal: 1e12, minerals: 1e12, gas: 1e12 };

function world(plan?: BuildPlan, resources: { metal: number; minerals: number; gas: number } = ROOMY, drainEnergy = false): SaveState {
  const config = createDefaultNewGameConfig({ seed: 'BUILD-PLAN-01', playerName: 'Owner' });
  const base = createInitialSaveState('production', NOW, config);
  const home = base.planets[PLANET]!;
  const drained = drainEnergy ? spendPlanetEnergy(home, base.science.levels, getPlanetEnergyLedger(home, base.science.levels).availableEnergy).planet : home;
  const next: SaveState = {
    ...base,
    planets: { ...base.planets, [PLANET]: drained },
    ...(plan ? { fleetUi: { favoriteTargets: [], buildPlans: { [PLANET]: plan } } } : {}),
  };
  return replacePlanetResources(next, PLANET, { ...getPlanetResources(next, PLANET), ...resources });
}

const queueRoles = (state: SaveState) => (state.queues[PLANET] ?? []).map((item) => `${item.assetRole}:${item.targetLevel}`);

test('targets are kept between 1 and the last level, and survive a save round trip', () => {
  let plan: BuildPlan = { targets: {} };
  plan = setBuildTarget(plan, 'metal-production-1', 9999);
  plan = setBuildTarget(plan, 'gas-production-1', 0);
  assert.equal(plan.targets['metal-production-1'], 30);
  assert.equal(plan.targets['gas-production-1'], 1);
  const saved = JSON.parse(JSON.stringify(applyFleetUiUpdate(undefined, { kind: 'set-build-plan', planetId: PLANET, plan })));
  assert.deepEqual(migrateFleetUiState(saved)?.buildPlans?.[PLANET], plan);
  assert.equal(migrateBuildPlans({ [PLANET]: { targets: { 'metal-production-1': 'x', nope: 4 } } }), undefined);
  assert.equal(applyFleetUiUpdate(applyFleetUiUpdate(undefined, { kind: 'set-build-plan', planetId: PLANET, plan }), { kind: 'set-build-plan', planetId: PLANET, plan: { targets: {} } }).buildPlans, undefined);
});

test('without a plan nothing is started', () => {
  const state = world();
  assert.deepEqual(runBuildPlans(state, RUNTIME).started, []);
  assert.equal(buildBuildPlanView(state, PLANET, RUNTIME).empty, true);
});

test('a plan starts upgrades in priority order, up to the queue limit, as ordinary build orders', () => {
  const state = world({ targets: { 'metal-production-1': 3, 'mineral-production-1': 3, 'gas-production-1': 3 } });
  const run = runBuildPlans(state, RUNTIME);
  assert.equal(run.started.length, 3);
  assert.equal(queueRoles(run.state).length, 3);
  // No order of his own: the usual building order, one level of each building.
  assert.deepEqual(run.started.map((item) => item.role), ['metal-production-1', 'mineral-production-1', 'gas-production-1']);
  const view = buildBuildPlanView(run.state, PLANET, RUNTIME);
  assert.equal(view.queueUsed, 3);
  assert.equal(view.lines.every((line) => line.status === 'done' || line.status === 'building' || line.wait?.kind === 'queue' || line.wait?.kind === 'order'), true);
});

test('the decision does not depend on how many times it is asked, nor on a reload', () => {
  const state = world({ targets: { 'metal-production-1': 6, 'mineral-production-1': 6 } });
  const once = runBuildPlans(state, RUNTIME);
  const twice = runBuildPlans(once.state, RUNTIME);
  assert.deepEqual(twice.started, []);
  assert.equal(twice.state, once.state);
  const reloaded = JSON.parse(JSON.stringify(state)) as SaveState;
  assert.deepEqual(queueRoles(runBuildPlans(reloaded, RUNTIME).state), queueRoles(once.state));
});

test('a paused plan starts nothing but keeps its targets', () => {
  const state = world({ targets: { 'metal-production-1': 5 }, paused: true });
  assert.deepEqual(runBuildPlans(state, RUNTIME).started, []);
  const view = buildBuildPlanView(state, PLANET, RUNTIME);
  assert.equal(view.paused, true);
  assert.match(view.headline, /Автостарт выключен/);
});

test('what a planned building needs first is built first', () => {
  const state = world({ targets: { 'metal-production-2': 1 } });
  const home = state.planets[PLANET]!.buildings['metal-production-1'] ?? 0;
  const view = buildBuildPlanView(state, PLANET, RUNTIME);
  const need = view.lines.find((line) => line.role === 'metal-production-1')!;
  assert.equal(need.implied, true);
  assert.equal(need.target, 10);
  assert.equal(home < 10, true);
  assert.match(view.lines.find((line) => line.role === 'metal-production-2')!.wait!.text, /Сначала/);
  const run = runBuildPlans(state, RUNTIME);
  assert.equal(run.started.every((item) => item.role === 'metal-production-1'), true);
});

test('a science requirement is explained, never worked around', () => {
  const state = world({ targets: { 'advanced-energy': 1 } });
  const view = buildBuildPlanView(state, PLANET, RUNTIME);
  const line = view.lines.find((item) => item.role === 'advanced-energy')!;
  assert.equal(['requirement', 'science'].includes(line.wait!.kind), true);
  assert.equal(runBuildPlans(state, RUNTIME).started.every((item) => item.role === 'basic-energy'), true);
});

test('missing resources are named and nothing is started', () => {
  const state = world({ targets: { 'metal-production-1': 5 } }, { metal: 1, minerals: 1, gas: 0 });
  const run = runBuildPlans(state, RUNTIME);
  assert.equal(run.started.length, 0);
  const view = buildBuildPlanView(state, PLANET, RUNTIME);
  assert.equal(view.lines[0]!.wait!.kind, 'resources');
  assert.match(view.headline, /Не хватает/);
});

test('short of energy, the energy source comes first, and it is the one with the best pay-off', () => {
  const state = world({ targets: { 'metal-production-1': 20 } }, ROOMY, true);
  const view = buildBuildPlanView(state, PLANET, RUNTIME);
  const line = view.lines.find((item) => item.role === 'metal-production-1')!;
  assert.equal(line.wait!.kind, 'energy');
  assert.equal(view.next?.role, 'basic-energy');
  const run = runBuildPlans(state, RUNTIME);
  assert.equal(run.started.length, 1);
  assert.equal(run.started[0]!.role, 'basic-energy');
  assert.equal(run.started[0]!.startedFor, 'metal-production-1');
  // While the source is under construction, the next upgrade waits for the energy instead of piling on.
  assert.equal(buildBuildPlanView(run.state, PLANET, RUNTIME).lines.find((item) => item.role === 'metal-production-1')!.wait!.kind, 'energy');
});

test('the plan is not read or run for a planet that is gone', () => {
  const state = world({ targets: { 'metal-production-1': 5 } });
  const lost: SaveState = { ...state, fleetUi: { favoriteTargets: [], buildPlans: { 'nowhere-01': { targets: { 'metal-production-1': 5 } } } } };
  assert.deepEqual(runBuildPlans(lost, RUNTIME).started, []);
});

test('the queue is spread: one level of each building, not three levels of the first one', () => {
  const state = world({ targets: { 'metal-production-1': 20, 'mineral-production-1': 20, 'gas-production-1': 20 } });
  const roles = runBuildPlans(state, RUNTIME).started.map((item) => item.role);
  assert.deepEqual(roles, ['metal-production-1', 'mineral-production-1', 'gas-production-1']);
  // With only two buildings left the third slot is not left empty: the first in priority gets its next level.
  const two = world({ targets: { 'metal-production-1': 20, 'mineral-production-1': 20 } });
  assert.deepEqual(runBuildPlans(two, RUNTIME).started.map((item) => item.role), ['metal-production-1', 'mineral-production-1', 'metal-production-1']);
  const waiting = buildBuildPlanView(runBuildPlans(state, RUNTIME).state, PLANET, RUNTIME);
  assert.equal(waiting.lines.every((line) => line.queued <= 1), true);
});

test('a queued building takes a free slot when no other planned building can start', () => {
  // One solar station level is already queued; the metal storage (not queued) costs more than the wallet holds, the solar station's next level does not.
  const queued = startBuilding(world(), { planetId: PLANET, ...RUNTIME }, 'basic-energy');
  assert.equal(queued.ok, true);
  const plan: BuildPlan = { targets: { 'metal-storage': 15, 'basic-energy': 10 } };
  const planned: SaveState = { ...queued.state, fleetUi: { favoriteTargets: [], buildPlans: { [PLANET]: plan } } };
  const roomy = buildBuildPlanView(planned, PLANET, RUNTIME);
  const solarCost = roomy.lines.find((line) => line.role === 'basic-energy')!.cost!;
  const storageCost = roomy.lines.find((line) => line.role === 'metal-storage')!.cost!;
  const wallet = { metal: solarCost.metal, minerals: solarCost.minerals, gas: solarCost.gas };
  assert.equal(storageCost.metal > wallet.metal || storageCost.minerals > wallet.minerals || storageCost.gas > wallet.gas, true);
  const poor = replacePlanetResources(planned, PLANET, { ...getPlanetResources(planned, PLANET), ...wallet });
  const view = buildBuildPlanView(poor, PLANET, RUNTIME);
  assert.equal(view.next?.role, 'basic-energy');
  assert.equal(view.lines.find((line) => line.role === 'metal-storage')!.wait!.kind, 'resources');
  const run = runBuildPlans(poor, RUNTIME);
  assert.deepEqual(run.started.map((item) => item.role), ['basic-energy']);
  assert.equal(queueRoles(run.state).length, 2);
  // With money for both, the different building still comes first.
  const rich = replacePlanetResources(planned, PLANET, { ...getPlanetResources(planned, PLANET), ...ROOMY });
  assert.equal(buildBuildPlanView(rich, PLANET, RUNTIME).next?.role, 'metal-storage');
});

test('construction speed goes first by default, and the player can move any building up or down', () => {
  const targets = { 'metal-production-1': 10, 'gas-production-1': 10, construction: 5 };
  assert.deepEqual(buildPriority({ targets }), ['construction', 'metal-production-1', 'gas-production-1']);
  assert.equal(runBuildPlans(world({ targets }), RUNTIME).started[0]!.role, 'construction');
  let plan: BuildPlan = { targets };
  plan = moveBuildPriority(plan, 'gas-production-1', -1);
  plan = moveBuildPriority(plan, 'gas-production-1', -1);
  assert.deepEqual(buildPriority(plan), ['gas-production-1', 'construction', 'metal-production-1']);
  assert.equal(moveBuildPriority(plan, 'gas-production-1', -1), plan);
  assert.deepEqual(runBuildPlans(world(plan), RUNTIME).started.map((item) => item.role), ['gas-production-1', 'construction', 'metal-production-1']);
  const view = buildBuildPlanView(world(plan), PLANET, RUNTIME);
  assert.deepEqual(view.lines.map((line) => [line.role, line.priority]), [['gas-production-1', 1], ['construction', 2], ['metal-production-1', 3]]);
  assert.deepEqual(buildPriority(swapBuildPriority(plan, 'gas-production-1', 'metal-production-1')), ['metal-production-1', 'construction', 'gas-production-1']);
  assert.deepEqual(buildPriority(putBuildPriorityFirst(plan, 'metal-production-1')), ['metal-production-1', 'gas-production-1', 'construction']);
  assert.equal(putBuildPriorityFirst(plan, 'gas-production-1'), plan);
  // The order survives a save round trip; removed or unknown buildings drop out of it.
  const saved = migrateBuildPlans(JSON.parse(JSON.stringify({ [PLANET]: { ...removeBuildTarget(plan, 'construction'), order: [...plan.order!, 'nope'] } })));
  assert.deepEqual(saved?.[PLANET]?.order, ['gas-production-1', 'metal-production-1']);
});

test('an implied building stands just ahead of the building that needs it', () => {
  let plan: BuildPlan = { targets: { 'gas-production-1': 5, 'metal-production-2': 1 } };
  plan = moveBuildPriority(plan, 'metal-production-2', -1);
  const view = buildBuildPlanView(world(plan), PLANET, RUNTIME);
  assert.deepEqual(view.lines.map((line) => line.role).slice(0, 3), ['metal-production-1', 'metal-production-2', 'gas-production-1']);
  assert.equal(view.lines[0]!.priority, 1);
});

// ---- Smart planner: storages, saving up, robots, exchanges ----

function withBuildings(state: SaveState, levels: Partial<Record<BuildingRole, number>>): SaveState {
  const home = state.planets[PLANET]!;
  return { ...state, planets: { ...state.planets, [PLANET]: { ...home, buildings: { ...home.buildings, ...levels } } } };
}

test('a level that does not fit in the storage plans the storage upgrade first', () => {
  // From level 14 the next factory level costs 116 772 metal, the empty storage holds 100 000.
  const state = withBuildings(world({ targets: { construction: 20 } }, { metal: 100_000, minerals: 40_000, gas: 70_000 }), { construction: 14 });
  const run = runBuildPlans(state, RUNTIME);
  assert.deepEqual(run.started.map((item) => [item.role, item.startedFor]), [['metal-storage', 'construction']]);
  assert.deepEqual(queueRoles(run.state), ['metal-storage:1']);
  assert.match(buildBuildPlanView(state, PLANET, RUNTIME).headline, /поместилось в склад/);
  // While the storage is on the way nothing else starts and the line says why.
  const again = runBuildPlans(run.state, RUNTIME);
  assert.deepEqual(again.started, []);
  const line = buildBuildPlanView(run.state, PLANET, RUNTIME).lines.find((item) => item.role === 'construction')!;
  assert.equal(line.wait?.kind, 'saving');
  assert.match(line.wait!.text, /уже строится/);
});

test('a factory that only lacks resources makes the planner save instead of spending on what does not pay back first', () => {
  const plan: BuildPlan = { targets: { construction: 20, 'metal-storage': 3 } };
  const state = withBuildings(world(plan, { metal: 50_000, minerals: 50_000, gas: 50_000 }), { construction: 13 });
  const view = buildBuildPlanView(state, PLANET, RUNTIME);
  assert.equal(view.saving?.name, 'Фабрика');
  assert.equal(view.saving?.level, 14);
  assert.match(view.saving!.text, /накопится/);
  const storage = view.lines.find((item) => item.role === 'metal-storage')!;
  assert.equal(storage.wait?.kind, 'saving');
  assert.equal(storage.wait?.title, 'Копит на Фабрика');
  assert.deepEqual(runBuildPlans(state, RUNTIME).started, []);
  // The same storage plan without a factory goal starts at once: the wait comes from saving only.
  assert.equal(runBuildPlans(withBuildings(world({ targets: { 'metal-storage': 3 } }, { metal: 50_000, minerals: 50_000, gas: 50_000 }), { construction: 13 }), RUNTIME).started.length > 0, true);
});

test('while saving, a producing building that pays itself back before the factory is affordable still starts', () => {
  const state = withBuildings(world({ targets: { construction: 20, 'metal-production-1': 3 } }, { metal: 50_000, minerals: 50_000, gas: 50_000 }), { construction: 13 });
  const run = runBuildPlans(state, RUNTIME);
  assert.ok(run.started.some((item) => item.role === 'metal-production-1'));
});

test('saving does not apply when there is no income to save with', () => {
  const state = withBuildings(world({ targets: { construction: 20, 'metal-storage': 3 } }, { metal: 50_000, minerals: 50_000, gas: 50_000 }), { construction: 13, 'metal-production-1': 0, 'mineral-production-1': 0, 'gas-production-1': 0 });
  assert.equal(buildBuildPlanView(state, PLANET, RUNTIME).saving, null);
});

test('robots follow the owner pattern: 10 metal, 10 minerals, the rest to gas, and never take away his own', () => {
  const none = { metal: 0, minerals: 0, gas: 0 };
  assert.deepEqual(plannedRobotAssignment(none, 20), { metal: 10, minerals: 10, gas: 0 });
  assert.deepEqual(plannedRobotAssignment(none, 6), { metal: 6, minerals: 0, gas: 0 });
  assert.deepEqual(plannedRobotAssignment(none, 26), { metal: 10, minerals: 10, gas: 6 });
  assert.deepEqual(plannedRobotAssignment({ metal: 0, minerals: 0, gas: 5 }, 12), { metal: 7, minerals: 0, gas: 5 });
  assert.deepEqual(plannedRobotAssignment({ metal: 10, minerals: 10, gas: 0 }, 5), { metal: 10, minerals: 10, gas: 0 });
});

test('the planner places free robots with the ordinary command, only with autostart and the helper on', () => {
  const plan: BuildPlan = { targets: { construction: 12 } };
  const base = withBuildings(world(plan), { construction: 12 });
  const run = runBuildPlans(base, RUNTIME);
  assert.deepEqual(run.robots, [{ planetId: PLANET, assignment: { metal: 10, minerals: 2, gas: 0 } }]);
  assert.deepEqual(run.state.planets[PLANET]!.productionBots, { metal: 10, minerals: 2, gas: 0 });
  // Nothing left to place the second time.
  assert.deepEqual(runBuildPlans(run.state, RUNTIME).robots, []);
  assert.deepEqual(runBuildPlans(withBuildings(world(setBuildPlanHelper(plan, 'robots', false)), { construction: 12 }), RUNTIME).robots, []);
  assert.deepEqual(runBuildPlans(withBuildings(world({ ...plan, paused: true }), { construction: 12 }), RUNTIME).robots, []);
});

test('a missing resource is exchanged from a surplus, without going below what the plan still needs', () => {
  const plan: BuildPlan = { targets: { construction: 14 } };
  // The next factory level needs 77 848 metal, 23 354 minerals, 38 924 gas. Metal is 848 short.
  const rich = withBuildings(world(plan, { metal: 77_000, minerals: 60_000, gas: 50_000 }), { construction: 13, 'trade-center': 2 });
  const run = runBuildPlans(rich, RUNTIME);
  assert.deepEqual(run.exchanges, [{ planetId: PLANET, from: 'minerals', to: 'metal', amount: 848, received: 848 }]);
  assert.deepEqual(run.started.map((item) => item.role), ['construction']);
  assert.equal(run.state.planets[PLANET]!.trade.refillAtQueue.length, 1);
  // Minerals and gas are only just enough for the plan itself: nothing may be taken from them.
  const tight = withBuildings(world(plan, { metal: 77_000, minerals: 23_500, gas: 39_000 }), { construction: 13, 'trade-center': 2 });
  assert.deepEqual(runBuildPlans(tight, RUNTIME).exchanges, []);
  assert.deepEqual(runBuildPlans(tight, RUNTIME).started, []);
});

test('no exchange without a trade centre, a free charge, or with the helper off', () => {
  const plan: BuildPlan = { targets: { construction: 14 } };
  const resources = { metal: 77_000, minerals: 60_000, gas: 50_000 };
  assert.deepEqual(runBuildPlans(withBuildings(world(plan, resources), { construction: 13 }), RUNTIME).exchanges, []);
  assert.deepEqual(runBuildPlans(withBuildings(world(setBuildPlanHelper(plan, 'exchange', false), resources), { construction: 13, 'trade-center': 2 }), RUNTIME).exchanges, []);
  const spent = withBuildings(world(plan, resources), { construction: 13, 'trade-center': 1 });
  const home = spent.planets[PLANET]!;
  const busy = { ...spent, planets: { ...spent.planets, [PLANET]: { ...home, trade: { refillAtQueue: [NOW + 1000, NOW + 2000, NOW + 3000] } } } };
  assert.deepEqual(runBuildPlans(busy, RUNTIME).exchanges, []);
});

test('the smart planner decides the same way every time', () => {
  const state = withBuildings(world({ targets: { construction: 14, 'metal-storage': 2 } }, { metal: 77_000, minerals: 60_000, gas: 50_000 }), { construction: 13, 'trade-center': 2 });
  assert.deepEqual(runBuildPlans(state, RUNTIME), runBuildPlans(state, RUNTIME));
});
