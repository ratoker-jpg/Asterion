import assert from 'node:assert/strict';
import test from 'node:test';
import { createBot01Planets } from '../domain/espionage/fixtures.ts';
import { createEmptyFleetState, calculateFleetPopulation } from '../domain/fleet/runtime.ts';
import { getBuildingResourceIncomePerHour, getStorageCapacities } from '../domain/buildings/resource-zone.ts';
import { migrateEspionageState } from '../domain/espionage/repository.ts';
import { NPC_ECONOMY_ROLES } from '../domain/npc/economy-policy.ts';
import { accrueResourceCredits } from './resource-clock.ts';
import {
  getNpcBuildingCandidates,
  previewNpcBuilding,
  settleNpcPlanet,
  startNpcBuilding,
} from './npc-economy.ts';
import type { SpyTargetState } from '../domain/espionage/types.ts';

const context = { timeScale: 1 };

function target(): SpyTargetState {
  const base = Object.values(createBot01Planets(0))[0]!;
  const fleet = createEmptyFleetState();
  return {
    ...base,
    id: 'economy-test',
    ownerId: 'npc-economy-test',
    kind: 'npc',
    fleet,
    population: { total: 0, fleet: 0, defense: 0 },
    resources: { metal: 0, minerals: 0, gas: 0, debris: 0, developmentEnergy: 0 },
    buildings: {},
    buildingQueue: [],
    resourceClock: { lastReconciledAt: 0, remainder: { metal: 0, minerals: 0, gas: 0 } },
    ownerProfile: { scienceLevels: {}, shipLevels: {}, commanderLevels: {} },
  };
}

test('NPC construction uses the shared price and charges each resource once', () => {
  const initial = target();
  initial.resources = { ...initial.resources, metal: 1_000_000, minerals: 1_000_000, gas: 1_000_000, developmentEnergy: 1_000 };
  const availability = previewNpcBuilding(initial, 'metal-production-1');
  assert.equal(availability.canBuild, true);
  const result = startNpcBuilding(initial, 'metal-production-1', 0, context, 'npc-test:build-1');
  assert.equal(result.ok, true);
  assert.ok(availability.cost);
  assert.equal(result.target.resources.metal, initial.resources.metal - availability.cost!.metal);
  assert.equal(result.target.resources.minerals, initial.resources.minerals - availability.cost!.minerals);
  assert.equal(result.target.resources.gas, initial.resources.gas - availability.cost!.gas);
  assert.equal(result.target.resources.developmentEnergy, initial.resources.developmentEnergy - availability.cost!.energy);
  const repeated = startNpcBuilding(result.target, 'metal-production-1', 0, context, 'npc-test:build-1');
  assert.equal(repeated.target, result.target);
  assert.equal(repeated.target.buildingQueue?.length, 1);
  assert.ok(result.target.energyLedger?.appliedTransactionIds.includes('npc-test:build-1'));
});

test('legacy development energy remains the opening balance when energy sources exist', () => {
  const initial = target();
  initial.buildings = { 'basic-energy': 1 };
  initial.resources = { ...initial.resources, metal: 1_000_000, minerals: 1_000_000, gas: 1_000_000 };
  const availability = previewNpcBuilding(initial, 'metal-production-1');
  assert.ok(availability.cost);
  initial.resources.developmentEnergy = availability.cost!.energy + 50;
  const result = startNpcBuilding(initial, 'metal-production-1', 0, context, 'npc-test:legacy-energy');
  assert.equal(result.ok, true);
  assert.equal(result.target.resources.developmentEnergy, 50);
});

test('legacy fleet satellites feed energy and overpopulation once, then use the canonical field', () => {
  const initial = target();
  initial.fleet.ships['solar-satellite'] = 1;
  const settled = settleNpcPlanet(initial, 0, context).target;
  assert.equal(settled.energyLedger?.sources.find((source) => source.id === 'solar-satellite')?.count, 1);

  initial.fleet.ships.scout = 100;
  const overpopulated = settleNpcPlanet(initial, 0, context).target;
  assert.equal(overpopulated.overpopulation?.blocked, true);
  assert.equal(overpopulated.solarSatellites, 1);
  assert.equal(overpopulated.fleet.ships['solar-satellite'], 0);
});

test('building candidates and direct starts enforce the exact economy role policy', () => {
  const initial = target();
  assert.deepEqual(getNpcBuildingCandidates(initial).map(({ role }) => role), NPC_ECONOMY_ROLES);
  const unsupported = startNpcBuilding(initial, 'research' as never, 0, context, 'npc-test:research');
  assert.equal(unsupported.ok, false);
  assert.equal(unsupported.target, initial);
});

test('NPC income obeys warehouse caps', () => {
  const initial = target();
  initial.buildings = { 'metal-production-1': 1 };
  const capacities = getStorageCapacities(initial.buildings as never);
  initial.resources.metal = capacities.metal - 1;
  const result = settleNpcPlanet(initial, 60 * 60 * 1000, context).target;
  assert.equal(result.resources.metal, capacities.metal);
  assert.equal(result.resourceClock?.remainder.metal, 0);
});

test('production changes exactly at the building completion timestamp', () => {
  const initial = target();
  initial.buildings = { 'metal-production-1': 1 };
  initial.resources = { ...initial.resources, metal: 1_000_000, minerals: 1_000_000, gas: 1_000_000, developmentEnergy: 1_000 };
  const availability = previewNpcBuilding(initial, 'metal-production-1');
  const started = startNpcBuilding(initial, 'metal-production-1', 0, context, 'npc-test:build-boundary');
  assert.equal(started.ok, true);
  const finishAt = started.target.buildingQueue![0]!.finishAt;
  const completed = settleNpcPlanet(started.target, finishAt, context);
  assert.deepEqual(completed.completedRoles, ['metal-production-1']);
  const oldRate = getBuildingResourceIncomePerHour(initial.buildings, {});
  const expectedBefore = accrueResourceCredits(oldRate.metal, finishAt, 0).wholeCredits;
  const cap = getStorageCapacities(initial.buildings as never).metal;
  assert.equal(completed.target.resources.metal, Math.min(cap, started.target.resources.metal + expectedBefore));

  const later = settleNpcPlanet(completed.target, finishAt + 60 * 60 * 1000, context).target;
  const newRate = getBuildingResourceIncomePerHour(completed.target.buildings, {});
  const expectedAfter = accrueResourceCredits(newRate.metal, 60 * 60 * 1000, 0).wholeCredits;
  assert.equal(later.resources.metal, Math.min(cap, completed.target.resources.metal + expectedAfter));
  assert.equal(availability.canBuild, true);
});

test('energy-source completion credits once across repeated settlement', () => {
  const initial = target();
  initial.resources = { ...initial.resources, metal: 1_000_000, minerals: 1_000_000, gas: 1_000_000, developmentEnergy: 10_000 };
  const started = startNpcBuilding(initial, 'basic-energy', 0, context, 'npc-test:energy-source');
  assert.equal(started.ok, true);
  const finishAt = started.target.buildingQueue![0]!.finishAt;
  const first = settleNpcPlanet(started.target, finishAt, context).target;
  assert.equal(first.buildings['basic-energy'], 1);
  assert.ok(first.energyLedger!.producedEnergy > started.target.energyLedger!.producedEnergy);
  const repeated = settleNpcPlanet(first, finishAt, context).target;
  assert.equal(repeated.resources.developmentEnergy, first.resources.developmentEnergy);
  assert.equal(repeated.energyLedger!.producedEnergy, first.energyLedger!.producedEnergy);
});

test('an overpopulated legacy NPC burns fleet units and pauses income and construction timers', () => {
  const initial = target();
  initial.fleet.ships.scout = 100;
  initial.population = { total: 100, fleet: calculateFleetPopulation(initial.fleet, initial.raceId), defense: 0 };
  initial.buildings = { 'metal-production-1': 1 };
  const first = settleNpcPlanet(initial, 0, context).target;
  assert.equal(first.overpopulation?.blocked, true);
  const beforeFleet = first.fleet.ships.scout;
  const queued = {
    ...first,
    buildingQueue: [{
      kind: 'building' as const,
      id: 'legacy-build',
      assetRole: 'metal-production-1' as const,
      planetId: first.id,
      enqueuedAt: 0,
      startedAt: 0,
      finishAt: 120_000,
      targetLevel: 2,
      durationMs: 120_000,
    }],
  };
  const paused = settleNpcPlanet(queued, 60_000, context).target;
  assert.equal(paused.resources.metal, queued.resources.metal);
  assert.equal(paused.buildingQueue?.[0]?.finishAt, 180_000);
  const burned = settleNpcPlanet(paused, 600_000, context).target;
  assert.ok(burned.fleet.ships.scout < beforeFleet);
  assert.ok(getNpcBuildingCandidates(burned).every(({ availability }) => availability.canBuild === false));
});

test('economy metadata survives espionage target persistence normalization', () => {
  const initial = target();
  initial.resources = { ...initial.resources, metal: 1_000_000, minerals: 1_000_000, gas: 1_000_000, developmentEnergy: 1_000 };
  const started = startNpcBuilding(initial, 'metal-production-1', 0, context, 'npc-test:persisted');
  const persisted = migrateEspionageState({
    missions: [],
    reports: [],
    hunterNotices: [],
    targets: { [started.target.id]: started.target },
  }, 0).targets?.[started.target.id];
  assert.equal(persisted?.buildingQueue?.length, 1);
  assert.equal(persisted?.economyAppliedActionIds?.[0], 'npc-test:persisted');
  assert.ok(persisted?.energyLedger);
  assert.ok(persisted?.resourceClock);
});
