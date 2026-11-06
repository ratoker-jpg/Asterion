import assert from 'node:assert/strict';
import test from 'node:test';

import { buildPriority, moveBuildPriority, removeBuildTarget, setBuildTarget, migrateBuildPlans, type BuildPlan } from '../domain/buildings/build-plan.ts';
import { applyFleetUiUpdate, migrateFleetUiState } from '../domain/flights/fleet-ui.ts';
import { createDefaultNewGameConfig } from '../domain/world/config.ts';
import type { SaveState } from './contracts.ts';
import { getPlanetResources, replacePlanetResources } from './contracts.ts';
import { buildBuildPlanView, runBuildPlans } from './build-plan.ts';
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
