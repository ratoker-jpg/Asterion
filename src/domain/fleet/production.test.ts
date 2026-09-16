import assert from 'node:assert/strict';
import test from 'node:test';

import {
  calculateFleetProductionDurationMs,
  createDefaultFleetProductionState,
  createEmptyDefenseState,
  enqueueFleetProduction,
  getDefensePopulationSummary,
  getFleetProductionPopulationSummary,
  migrateDefenseState,
  migrateFleetProductionState,
  reconcileFleetProductionState,
  cancelFleetProduction,
  type FleetProductionContext,
  type FleetProductionTransition,
} from './production.ts';
import { createEmptyFleetState, createCanonicalStartingFleet, migrateFleetState } from './runtime.ts';

const capacities = { metal: 1_000_000_000, minerals: 1_000_000_000, gas: 1_000_000_000 };

function context(overrides: Partial<FleetProductionContext> = {}): FleetProductionContext {
  return {
    factionId: 'aegis',
    state: createDefaultFleetProductionState(),
    fleet: createEmptyFleetState(),
    defense: createEmptyDefenseState(),
    wallet: { metal: 1_000_000_000, minerals: 1_000_000_000, gas: 1_000_000_000 },
    capacities,
    hangarLevel: 1,
    shipyardLevel: 1,
    advancedFactoryLevel: 0,
    now: 0,
    mode: 'production',
    testTimeScale: 15,
    ...overrides,
  };
}

function after<T extends FleetProductionTransition>(base: FleetProductionContext, transition: T, now = base.now): FleetProductionContext {
  return {
    ...base,
    state: transition.state,
    fleet: transition.fleet,
    defense: transition.defense,
    wallet: transition.wallet,
    now,
  };
}

test('three queues run independently, reserve population, and preserve FIFO batch snapshots', () => {
  let current = context();
  const ship = enqueueFleetProduction(current, 'ships', 'scout', 2, 'ship-1');
  assert.equal(ship.ok, true);
  assert.equal(ship.order?.startedAt, 0);
  current = after(current, ship);

  const defense = enqueueFleetProduction(current, 'defense', 'ballistic-turret', 2, 'defense-1');
  assert.equal(defense.ok, true);
  assert.equal(defense.order?.startedAt, 0);
  current = after(current, defense);

  const commander = enqueueFleetProduction(current, 'commanders', 'corsair', 1, 'commander-1');
  assert.equal(commander.ok, true);
  assert.equal(commander.order?.startedAt, 0);
  current = after(current, commander);

  const secondShip = enqueueFleetProduction(current, 'ships', 'scout', 1, 'ship-2');
  assert.equal(secondShip.ok, true);
  assert.equal(secondShip.order?.startedAt, ship.order?.finishAt);
  assert.equal(current.state.shipQueue.length, 1);
  assert.equal(secondShip.state.shipQueue.length, 2);

  const fleetSummary = getFleetProductionPopulationSummary(
    secondShip.fleet,
    secondShip.state,
    1,
    'aegis',
  );
  const defenseSummary = getDefensePopulationSummary(secondShip.defense, secondShip.state, 1, 'aegis');
  assert.deepEqual(
    { population: fleetSummary.population, pending: fleetSummary.pendingPopulation, capacity: fleetSummary.capacity },
    { population: 16, pending: 16, capacity: 120 },
  );
  assert.deepEqual(
    { population: defenseSummary.population, pending: defenseSummary.pendingPopulation, capacity: defenseSummary.capacity },
    { population: 4, pending: 4, capacity: 120 },
  );
});

test('batch completion is sequential and idempotent while total population stays reserved', () => {
  const started = enqueueFleetProduction(context(), 'ships', 'scout', 2, 'ship-batch');
  assert.equal(started.ok, true);
  const task = started.order!;
  const halfway = reconcileFleetProductionState(
    started.state,
    started.fleet,
    started.defense,
    'aegis',
    task.startedAt + task.effectiveDurationMs + 1,
  );
  assert.equal(halfway.changed, true);
  assert.equal(halfway.completed.length, 0);
  assert.equal(halfway.fleet.ships.scout, 1);
  assert.equal(halfway.state.shipQueue[0]?.completedQuantity, 1);
  assert.equal(getFleetProductionPopulationSummary(halfway.fleet, halfway.state, 1, 'aegis').population, 4);

  const repeated = reconcileFleetProductionState(
    halfway.state,
    halfway.fleet,
    halfway.defense,
    'aegis',
    task.startedAt + task.effectiveDurationMs + 1,
  );
  assert.equal(repeated.changed, false);
  assert.strictEqual(repeated.state, halfway.state);
  assert.strictEqual(repeated.fleet, halfway.fleet);

  const finished = reconcileFleetProductionState(
    halfway.state,
    halfway.fleet,
    halfway.defense,
    'aegis',
    task.finishAt,
  );
  assert.equal(finished.completed.length, 1);
  assert.equal(finished.fleet.ships.scout, 2);
  assert.equal(finished.state.shipQueue.length, 0);
});

test('cancel removes only the selected batch, releases pending population, and applies 60 percent refund at rng zero', () => {
  let current = context();
  const first = enqueueFleetProduction(current, 'ships', 'scout', 2, 'cancel-first');
  assert.equal(first.ok, true);
  current = after(current, first);
  const second = enqueueFleetProduction(current, 'ships', 'scout', 1, 'cancel-second');
  assert.equal(second.ok, true);
  current = after(current, second);

  const beforeMetal = current.wallet.metal;
  const result = cancelFleetProduction(current, 'cancel-first', () => 0);
  assert.equal(result.ok, true);
  assert.equal(result.refundPercent, 60);
  assert.equal(result.state.shipQueue.length, 1);
  assert.equal(result.state.shipQueue[0]?.id, 'cancel-second');
  assert.equal(result.state.shipQueue[0]?.startedAt, 0);
  assert.equal(result.wallet.metal, beforeMetal + Math.floor(2_400 * 2 * 0.6));
  assert.equal(getFleetProductionPopulationSummary(result.fleet, result.state, 1, 'aegis').pendingPopulation, 2);
});

test('canceling a partially completed batch refunds only unfinished units', () => {
  const started = enqueueFleetProduction(context(), 'ships', 'scout', 10, 'partial-cancel');
  assert.equal(started.ok, true);
  const task = started.order!;
  const partiallyCompleted = reconcileFleetProductionState(
    started.state,
    started.fleet,
    started.defense,
    'aegis',
    task.startedAt + task.effectiveDurationMs * 9 + 1,
  );
  assert.equal(partiallyCompleted.fleet.ships.scout, 9);
  assert.equal(partiallyCompleted.state.shipQueue[0]?.completedQuantity, 9);

  const result = cancelFleetProduction({
    ...context(),
    state: partiallyCompleted.state,
    fleet: partiallyCompleted.fleet,
    defense: partiallyCompleted.defense,
    wallet: started.wallet,
    now: task.startedAt + task.effectiveDurationMs * 9 + 1,
  }, 'partial-cancel', () => 0);
  assert.equal(result.ok, true);
  assert.equal(result.refundPercent, 60);
  assert.deepEqual(result.refund, { metal: 1_440, minerals: 960, gas: 0 });
  assert.equal(result.fleet.ships.scout, 9);
  assert.equal(getFleetProductionPopulationSummary(result.fleet, result.state, 1, 'aegis').pendingPopulation, 0);
});

test('rejected enqueue has no side effects and ordinary units remain unlimited by queue length', () => {
  let current = context({ wallet: { metal: 0, minerals: 0, gas: 0 } });
  const before = current.state;
  const rejected = enqueueFleetProduction(current, 'ships', 'scout', 1, 'rejected');
  assert.equal(rejected.ok, false);
  assert.strictEqual(rejected.state, before);
  assert.deepEqual(rejected.wallet, current.wallet);

  current = context({ hangarLevel: 20 });
  for (let index = 0; index < 4; index += 1) {
    const result = enqueueFleetProduction(current, 'ships', 'scout', 1, `unlimited-${index}`);
    assert.equal(result.ok, true);
    current = after(current, result);
  }
  assert.equal(current.state.shipQueue.length, 4);
});

test('fleet and defense capacity are separate pools and limited commanders/shields cannot duplicate', () => {
  let current = context();
  const fleet = enqueueFleetProduction(current, 'ships', 'scout', 60, 'fleet-cap');
  assert.equal(fleet.ok, true);
  current = after(current, fleet);
  const defense = enqueueFleetProduction(current, 'defense', 'ballistic-turret', 60, 'defense-cap');
  assert.equal(defense.ok, true);
  current = after(current, defense);
  assert.equal(getFleetProductionPopulationSummary(current.fleet, current.state, 1, 'aegis').population, 120);
  assert.equal(getDefensePopulationSummary(current.defense, current.state, 1, 'aegis').population, 120);

  const commander = enqueueFleetProduction(current, 'commanders', 'corsair', 1, 'commander-limit-1');
  assert.equal(commander.ok, false, 'fleet population is already full');

  const empty = context({ shipyardLevel: 20 });
  const shield = enqueueFleetProduction(empty, 'defense', 'tower-shield', 1, 'shield-1');
  assert.equal(shield.ok, true);
  const duplicateShield = enqueueFleetProduction(after(empty, shield), 'defense', 'tower-shield', 1, 'shield-2');
  assert.equal(duplicateShield.ok, false);
});

test('commander duration uses exact level multiplier and applies Test Mode scale once', () => {
  const base = calculateFleetProductionDurationMs('commanders', 'corsair', {
    factionId: 'aegis',
    shipyardLevel: 1,
    advancedFactoryLevel: 0,
    commanderLevel: 0,
    mode: 'production',
  });
  const levelForty = calculateFleetProductionDurationMs('commanders', 'corsair', {
    factionId: 'aegis',
    shipyardLevel: 1,
    advancedFactoryLevel: 0,
    commanderLevel: 40,
    mode: 'production',
  });
  const testScaled = calculateFleetProductionDurationMs('commanders', 'corsair', {
    factionId: 'aegis',
    shipyardLevel: 1,
    advancedFactoryLevel: 0,
    commanderLevel: 40,
    mode: 'test',
    testTimeScale: 15,
  });
  assert.equal(levelForty, base * 40);
  assert.equal(testScaled, Math.max(1, Math.round(levelForty / 15)));
});

test('migration filters invalid duplicate limited orders and enforces aggregate fleet capacity', () => {
  const migrated = migrateFleetProductionState({
    shipQueue: [
      { id: 'ship-cap', itemId: 'scout', quantity: 60, completedQuantity: 0, startedAt: 0, finishAt: 1, effectiveDurationMs: 1, cost: { metal: 1, minerals: 1, gas: 0 } },
    ],
    commanderQueue: [
      { id: 'commander-over-cap', itemId: 'corsair', quantity: 2, completedQuantity: 0, startedAt: 0, finishAt: 1, effectiveDurationMs: 1, cost: { metal: 1, minerals: 1, gas: 0 } },
    ],
    defenseQueue: [
      { id: 'shield-one', itemId: 'tower-shield', quantity: 2, completedQuantity: 0, startedAt: 0, finishAt: 1, effectiveDurationMs: 1, cost: { metal: 1, minerals: 1, gas: 0 } },
      { id: 'shield-two', itemId: 'tower-shield', quantity: 1, completedQuantity: 0, startedAt: 0, finishAt: 1, effectiveDurationMs: 1, cost: { metal: 1, minerals: 1, gas: 0 } },
    ],
  }, { factionId: 'aegis', fleet: createEmptyFleetState(), defense: createEmptyDefenseState(), hangarLevel: 1 });

  assert.equal(migrated.shipQueue.length, 1);
  assert.equal(migrated.commanderQueue.length, 0);
  assert.equal(migrated.defenseQueue.length, 1);
  assert.equal(migrated.defenseQueue[0]?.quantity, 1);

  const limited = migrateFleetProductionState({
    commanderQueue: [{ id: 'commander-limited', itemId: 'corsair', quantity: 2, completedQuantity: 0, startedAt: 0, finishAt: 1, effectiveDurationMs: 1, cost: { metal: 1, minerals: 1, gas: 0 } }],
    defenseQueue: [{ id: 'shield-limited', itemId: 'tower-shield', quantity: 2, completedQuantity: 0, startedAt: 0, finishAt: 1, effectiveDurationMs: 1, cost: { metal: 1, minerals: 1, gas: 0 } }],
  });
  assert.equal(limited.commanderQueue[0]?.quantity, 1);
  assert.equal(limited.defenseQueue[0]?.quantity, 1);

  const normalizedFleet = migrateFleetState({ commanders: { corsair: 2 } });
  assert.equal(normalizedFleet.commanders.corsair, 1);
  assert.equal(migrateDefenseState({ defenses: { 'tower-shield': 2 } }).defenses['tower-shield'], 1);
});

test('migration rebuilds sequential finish timestamps from saved duration snapshots', () => {
  const migrated = migrateFleetProductionState({
    shipQueue: [
      { id: 'timestamp-first', itemId: 'scout', quantity: 1, completedQuantity: 0, startedAt: 0, finishAt: 1, effectiveDurationMs: 100, cost: { metal: 1, minerals: 1, gas: 0 } },
      { id: 'timestamp-second', itemId: 'scout', quantity: 1, completedQuantity: 0, startedAt: 0, finishAt: 2, effectiveDurationMs: 100, cost: { metal: 1, minerals: 1, gas: 0 } },
    ],
  });
  assert.equal(migrated.shipQueue[0]?.finishAt, 100);
  assert.equal(migrated.shipQueue[1]?.startedAt, 100);
  assert.equal(migrated.shipQueue[1]?.finishAt, 200);
});

test('legacy orders without saved cost can be canceled without an invented refund', () => {
  const result = cancelFleetProduction({
    ...context({
      state: {
        shipQueue: [{
          id: 'legacy-no-cost',
          queueKind: 'ships',
          itemId: 'scout',
          quantity: 1,
          completedQuantity: 0,
          enqueuedAt: 0,
          startedAt: 0,
          finishAt: 10,
          effectiveDurationMs: 10,
          cost: { metal: 0, minerals: 0, gas: 0 },
          refundEligible: false,
        }],
        defenseQueue: [],
        commanderQueue: [],
      },
    }),
  },
    'legacy-no-cost',
  );
  assert.equal(result.ok, true);
  assert.equal(result.refund, null);
  assert.equal(result.refundPercent, null);
  assert.equal(result.state.shipQueue.length, 0);
});

test('fresh starting roster and defense pool use the Phase 7 composition', () => {
  const aegis = createCanonicalStartingFleet('aegis');
  const veyra = createCanonicalStartingFleet('veyra');
  assert.deepEqual(
    { scout: aegis.ships.scout, recycler: aegis.ships.recycler, colonizer: aegis.ships.colonizer, spy: aegis.ships['spy-probe'], transporter: aegis.ships.transporter },
    { scout: 20, recycler: 1, colonizer: 1, spy: 1, transporter: 0 },
  );
  assert.equal(veyra.ships.scout, 40);
  const defense = getDefensePopulationSummary(createEmptyDefenseState(), createDefaultFleetProductionState(), 1, 'aegis');
  assert.deepEqual(defense, { ownedPopulation: 0, pendingPopulation: 0, population: 0, capacity: 120, available: 120 });
});
