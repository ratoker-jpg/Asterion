import assert from 'node:assert/strict';
import test from 'node:test';

import { getFactionShipCatalog } from '../combat/faction-catalog.ts';
import type { BattleReport } from '../combat/report.ts';
import {
  createDefaultFleetProductionState,
  type FleetProductionOrder,
} from '../fleet/production.ts';
import { createCanonicalStartingFleet } from '../fleet/runtime.ts';
import { createEmptyDefenseState } from '../fleet/production.ts';
import {
  calculateRepairCost,
  claimDefensiveBattleRepair,
  createDefaultRepairWorkshopState,
  recoverableFromDestroyed,
  repairForResources,
  repairForTokens,
  type RepairTransitionContext,
} from './workshop.ts';

function context(overrides: Partial<RepairTransitionContext> = {}): RepairTransitionContext {
  return {
    repair: createDefaultRepairWorkshopState(),
    fleet: createCanonicalStartingFleet(),
    defense: createEmptyDefenseState(),
    fleetProduction: createDefaultFleetProductionState(),
    wallet: { metal: 1_000_000, minerals: 1_000_000, gas: 1_000_000 },
    factionId: 'aegis',
    hangarLevel: 1,
    ...overrides,
  };
}

function report(overrides: Partial<BattleReport> = {}): BattleReport {
  return {
    id: 'repair-workshop-battle-1',
    timestamp: '2026-09-13T00:00:00.000Z',
    missionType: 'defense',
    attacker: { playerId: 'raider', playerName: 'Raider', side: 'attacker' },
    defender: { playerId: 'player-aster', playerName: 'Asterion', side: 'defender' },
    winner: 'defender',
    roundCount: 1,
    attackerForce: { populationBefore: 0, populationAfter: 0, stacks: [] },
    defenderForce: {
      populationBefore: 100,
      populationAfter: 80,
      stacks: [
        { entityId: 'scout', countBefore: 5, countAfter: 0, destroyed: 5 },
        { entityId: 'judge', countBefore: 1, countAfter: 0, destroyed: 1 },
      ],
      defenses: [
        { entityId: 'ballistic-turret', countBefore: 4, countAfter: 0, destroyed: 4 },
      ],
    },
    rounds: [],
    ...overrides,
  };
}

test('recoverable losses round half up and never go below zero', () => {
  assert.equal(recoverableFromDestroyed(4), 2);
  assert.equal(recoverableFromDestroyed(5), 3);
  assert.equal(recoverableFromDestroyed(-3), 0);
});

test('defensive battle awards ordinary defender ships and defenses, excluding commanders', () => {
  const transition = claimDefensiveBattleRepair(createDefaultRepairWorkshopState(), report());

  assert.equal(transition.ok, true);
  assert.equal(transition.changed, true);
  assert.equal(transition.losses.eligible, true);
  assert.equal(transition.state.ships.scout, 3);
  assert.equal(transition.state.defenses['ballistic-turret'], 2);
  assert.equal(transition.state.claimedBattleIds.includes('repair-workshop-battle-1'), true);
  assert.equal('judge' in transition.state.ships, false);
});

test('attacking reports never create repair pool entries or claims', () => {
  const transition = claimDefensiveBattleRepair(
    createDefaultRepairWorkshopState(),
    report({
      id: 'repair-workshop-attack-1',
      missionType: 'attack',
      attacker: { playerId: 'player-aster', playerName: 'Asterion', side: 'attacker' },
      defender: { playerId: 'raider', playerName: 'Raider', side: 'defender' },
    }),
  );

  assert.equal(transition.ok, true);
  assert.equal(transition.changed, false);
  assert.deepEqual(transition.state, createDefaultRepairWorkshopState());
  assert.equal(transition.losses.eligible, false);
});

test('stale combat entity snapshots do not crash repair award application', () => {
  const stale = report({
    id: 'repair-workshop-stale-entity',
    defenderForce: {
      populationBefore: 1,
      populationAfter: 0,
      stacks: [{ entityId: 'retired-ship' as never, countBefore: 1, countAfter: 0, destroyed: 1 }],
      defenses: [],
    },
  });

  assert.doesNotThrow(() => claimDefensiveBattleRepair(createDefaultRepairWorkshopState(), stale));
  const transition = claimDefensiveBattleRepair(createDefaultRepairWorkshopState(), stale);
  assert.equal(transition.ok, true);
  assert.equal(transition.changed, true);
  assert.deepEqual(transition.losses.ships, {});
  assert.deepEqual(transition.losses.defenses, {});
  assert.deepEqual(transition.state.claimedBattleIds, ['repair-workshop-stale-entity']);
});

test('the same defensive report is idempotent', () => {
  const initial = createDefaultRepairWorkshopState();
  const first = claimDefensiveBattleRepair(initial, report());
  const second = claimDefensiveBattleRepair(first.state, report());

  assert.equal(second.ok, true);
  assert.equal(second.changed, false);
  assert.strictEqual(second.state, first.state);
  assert.equal(second.state.ships.scout, 3);
  assert.equal(second.state.defenses['ballistic-turret'], 2);
});

test('repair cost is exactly twice the canonical faction catalog cost', () => {
  const scout = getFactionShipCatalog('aegis').find((entity) => entity.id === 'scout');
  const destroyer = getFactionShipCatalog('aegis').find((entity) => entity.id === 'destroyer');
  assert.ok(scout);
  assert.ok(destroyer);
  assert.deepEqual(calculateRepairCost(scout, 2), {
    metal: scout.cost.metal * 4,
    minerals: scout.cost.minerals * 4,
    gas: scout.cost.gas * 4,
  });
  assert.ok(destroyer.cost.gas > 0);
  assert.equal(calculateRepairCost(destroyer, 1).gas, destroyer.cost.gas * 2);
});

test('resource and token repair are all-or-nothing and immediately restore units', () => {
  const resourceContext = context({
    repair: { ...createDefaultRepairWorkshopState(), ships: { ...createDefaultRepairWorkshopState().ships, scout: 2 } },
  });
  const resourceRepair = repairForResources(resourceContext, 'ship', 'scout', 2);
  assert.equal(resourceRepair.ok, true);
  assert.equal(resourceRepair.fleet.ships.scout, resourceContext.fleet.ships.scout + 2);
  assert.equal(resourceRepair.repair.ships.scout, 0);
  assert.deepEqual(resourceRepair.cost, { metal: 9_600, minerals: 6_400, gas: 0 });
  assert.deepEqual(resourceRepair.wallet, { metal: 990_400, minerals: 993_600, gas: 1_000_000 });

  const tokenContext = context({
    repair: { ...createDefaultRepairWorkshopState(), ships: { ...createDefaultRepairWorkshopState().ships, scout: 2 }, tokens: 31 },
  });
  const tokenRepair = repairForTokens(tokenContext, 'ship', 'scout', 2);
  assert.equal(tokenRepair.ok, true);
  assert.equal(tokenRepair.repair.tokens, 29);
  assert.equal(tokenRepair.repair.ships.scout, 0);
  assert.deepEqual(tokenRepair.wallet, tokenContext.wallet);

  const poorResources = context({
    repair: { ...createDefaultRepairWorkshopState(), ships: { ...createDefaultRepairWorkshopState().ships, scout: 2 } },
    wallet: { metal: 1, minerals: 1_000_000, gas: 1_000_000 },
  });
  const rejectedResources = repairForResources(poorResources, 'ship', 'scout', 2);
  assert.equal(rejectedResources.ok, false);
  assert.strictEqual(rejectedResources.repair, poorResources.repair);
  assert.strictEqual(rejectedResources.fleet, poorResources.fleet);
  assert.strictEqual(rejectedResources.wallet, poorResources.wallet);

  const poorTokens = context({
    repair: { ...createDefaultRepairWorkshopState(), ships: { ...createDefaultRepairWorkshopState().ships, scout: 2 }, tokens: 1 },
  });
  const rejectedTokens = repairForTokens(poorTokens, 'ship', 'scout', 2);
  assert.equal(rejectedTokens.ok, false);
  assert.strictEqual(rejectedTokens.repair, poorTokens.repair);
  assert.strictEqual(rejectedTokens.fleet, poorTokens.fleet);
  assert.strictEqual(rejectedTokens.wallet, poorTokens.wallet);
});

test('fleet capacity includes owned and pending population', () => {
  const pendingShip: FleetProductionOrder = {
    id: 'pending-scout',
    queueKind: 'ships',
    itemId: 'scout',
    quantity: 1,
    completedQuantity: 0,
    enqueuedAt: 0,
    startedAt: 0,
    finishAt: 100_000,
    effectiveDurationMs: 100_000,
    cost: { metal: 1, minerals: 1, gas: 0 },
    refundEligible: true,
  };
  const baseRepair = createDefaultRepairWorkshopState();
  const result = repairForTokens(context({
    repair: { ...baseRepair, ships: { ...baseRepair.ships, scout: 2 } },
    fleet: { ...createCanonicalStartingFleet(), ships: { ...createCanonicalStartingFleet().ships, scout: 49 } },
    fleetProduction: { ...createDefaultFleetProductionState(), shipQueue: [pendingShip] },
  }), 'ship', 'scout', 2);

  assert.equal(result.ok, false);
  assert.equal(result.code, 'capacity');
  assert.match(result.reason ?? '', /флота/);
  assert.equal(result.capacity.population, 118);
  assert.equal(result.capacity.addedPopulation, 4);
});

test('defense capacity is separate and includes pending defenses', () => {
  const pendingDefense: FleetProductionOrder = {
    id: 'pending-defense',
    queueKind: 'defense',
    itemId: 'ballistic-turret',
    quantity: 10,
    completedQuantity: 0,
    enqueuedAt: 0,
    startedAt: 0,
    finishAt: 100_000,
    effectiveDurationMs: 100_000,
    cost: { metal: 1, minerals: 1, gas: 0 },
    refundEligible: true,
  };
  const baseRepair = createDefaultRepairWorkshopState();
  const result = repairForTokens(context({
    repair: { ...baseRepair, defenses: { ...baseRepair.defenses, 'ballistic-turret': 1 } },
    defense: { defenses: { ...createEmptyDefenseState().defenses, 'ballistic-turret': 50 } },
    fleetProduction: { ...createDefaultFleetProductionState(), defenseQueue: [pendingDefense] },
  }), 'defense', 'ballistic-turret', 1);

  assert.equal(result.ok, false);
  assert.equal(result.code, 'capacity');
  assert.match(result.reason ?? '', /обороны/);
  assert.equal(result.capacity.population, 120);
  assert.equal(result.capacity.addedPopulation, 2);
});

test('commanders are not accepted by the repair workshop', () => {
  const result = repairForResources(context(), 'ship', 'judge', 1);
  assert.equal(result.ok, false);
  assert.equal(result.code, 'invalid-entity');
  assert.match(result.reason ?? '', /поддерживается/);
});
