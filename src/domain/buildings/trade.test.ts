import assert from 'node:assert/strict';
import test from 'node:test';
import {
  TRADE_CENTER_MAX_LEVEL,
  createDefaultBuildingLevels,
  getBuildingDefinition,
  migrateBuildingLevels,
  migrateBuildingQueue,
} from './resource-zone.ts';
import {
  TRADE_REFILL_INTERVAL_MS,
  createDefaultTradeState,
  executeTrade,
  getTradeAmountLimit,
  getTradeMaxSlots,
  getTradeReceivedAmount,
  getTradeRefillInfo,
  migrateTradeState,
  reconcileTradeState,
  validateTrade,
  type TradeExecutionState,
  type TradeRequest,
} from './trade.ts';

const wallet = (overrides: Partial<TradeExecutionState['wallet']> = {}): TradeExecutionState['wallet'] => ({
  metal: 20_000,
  minerals: 10_000,
  gas: 5_000,
  debris: 100_000,
  ...overrides,
});

const state = (overrides: Partial<TradeExecutionState> = {}): TradeExecutionState => ({
  wallet: wallet(),
  trade: createDefaultTradeState(),
  ...overrides,
});

const request = (overrides: Partial<TradeRequest> = {}): TradeRequest => ({
  source: 'metal',
  target: 'minerals',
  amount: 1_000,
  ...overrides,
});

test('trade slots are level × 3 and Trade Center is capped at level 10', () => {
  assert.equal(getTradeMaxSlots(0), 0);
  assert.equal(getTradeMaxSlots(1), 3);
  assert.equal(getTradeMaxSlots(2), 6);
  assert.equal(getTradeMaxSlots(10), 30);
  assert.equal(getTradeMaxSlots(99), 30);
  assert.equal(TRADE_CENTER_MAX_LEVEL, 10);
  assert.equal(getBuildingDefinition('trade-center').maxLevel, 10);

  const migratedLevels = migrateBuildingLevels({ 'trade-center': 19, construction: 19 });
  assert.equal(migratedLevels['trade-center'], 10);
  assert.equal(migratedLevels.construction, 19);

  const levelNine = createDefaultBuildingLevels();
  levelNine['trade-center'] = 9;
  const queue = migrateBuildingQueue([{
    kind: 'building', assetRole: 'trade-center', planetId: 'helion-01',
    enqueuedAt: 1, startedAt: 1, finishAt: 100, targetLevel: 20,
  }], 'helion-01', levelNine);
  assert.equal(queue.length, 1);
  assert.equal(queue[0].targetLevel, 10);

  const levelTen = createDefaultBuildingLevels();
  levelTen['trade-center'] = 10;
  assert.equal(migrateBuildingQueue(queue, 'helion-01', levelTen).length, 0);
});

test('trade amount limit is resource rating points × 10', () => {
  assert.equal(getTradeAmountLimit(855_880), 8_558_800);
  assert.equal(getTradeAmountLimit(0), 0);
  assert.equal(getTradeAmountLimit(-10), 0);
});

test('base-resource pairs are 1:1 and debris exchanges are floor(amount × 0.6)', () => {
  for (const source of ['metal', 'minerals', 'gas'] as const) {
    assert.equal(getTradeReceivedAmount(source, 1_001), 1_001);
  }
  assert.equal(getTradeReceivedAmount('debris', 1_000), 600);
  assert.equal(getTradeReceivedAmount('debris', 1_001), 600);
  assert.equal(getTradeReceivedAmount('debris', 1_009), 605);
});

test('validation rejects same resource, debris target, zero/fraction, limit, wallet and no slot', () => {
  const now = 100_000;
  const rating = 100;
  const initial = state();

  assert.equal(validateTrade(initial, 1, rating, request({ source: 'metal', target: 'metal' }), now).reason, 'Нельзя обменивать ресурс на самого себя');
  assert.equal(validateTrade(initial, 1, rating, request({ target: 'debris' as never }), now).reason, 'Нельзя купить обломки');
  assert.equal(validateTrade(initial, 1, rating, request({ amount: 0 }), now).reason, 'Введите целое положительное количество');
  assert.equal(validateTrade(initial, 1, rating, request({ amount: 10.5 }), now).reason, 'Введите целое положительное количество');
  assert.equal(validateTrade(initial, 1, rating, request({ amount: 1_001 }), now).reason, 'Превышен лимит одной сделки');
  assert.equal(validateTrade(state({ wallet: wallet({ metal: 50 }) }), 1, 10_000, request({ amount: 51 }), now).reason, 'Недостаточно ресурса');
  assert.equal(validateTrade(initial, 0, 10_000, request(), now).reason, 'Торговый центр не построен');

  let full = initial;
  for (let index = 0; index < 3; index += 1) {
    const result = executeTrade(full, 1, 10_000, request({ amount: 1 }), now);
    assert.equal(result.ok, true);
    full = result.state;
  }
  const blocked = executeTrade(full, 1, 10_000, request({ amount: 1 }), now);
  assert.equal(blocked.ok, false);
  assert.equal(blocked.reason, 'Нет доступных сделок');
  assert.equal(blocked.state, full);
});

test('successful trade atomically moves resources and appends exactly one refill timestamp', () => {
  const now = 500_000;
  const initial = state();
  const result = executeTrade(initial, 1, 855_880, request({ amount: 4_000 }), now);

  assert.equal(result.ok, true);
  assert.equal(result.received, 4_000);
  assert.equal(result.state.wallet.metal, initial.wallet.metal - 4_000);
  assert.equal(result.state.wallet.minerals, initial.wallet.minerals + 4_000);
  assert.equal(result.state.wallet.gas, initial.wallet.gas);
  assert.equal(result.state.wallet.debris, initial.wallet.debris);
  assert.deepEqual(result.state.trade.refillAtQueue, [now + TRADE_REFILL_INTERVAL_MS]);
  assert.equal(result.refillAt, now + TRADE_REFILL_INTERVAL_MS);
  assert.deepEqual(initial.trade.refillAtQueue, []);
});

test('three spent slots refill sequentially at 15, 30 and 45 minutes without double refill', () => {
  const now = 1_000_000;
  let current = state();
  for (let index = 0; index < 3; index += 1) {
    const result = executeTrade(current, 1, 855_880, request({ amount: 1 }), now);
    assert.equal(result.ok, true);
    current = result.state;
  }

  assert.deepEqual(current.trade.refillAtQueue, [
    now + TRADE_REFILL_INTERVAL_MS,
    now + TRADE_REFILL_INTERVAL_MS * 2,
    now + TRADE_REFILL_INTERVAL_MS * 3,
  ]);
  assert.equal(getTradeRefillInfo(current.trade, 1, now).availableSlots, 0);
  assert.equal(getTradeRefillInfo(current.trade, 1, now).fullRefillMs, TRADE_REFILL_INTERVAL_MS * 3);

  const after15 = reconcileTradeState(current.trade, 1, now + TRADE_REFILL_INTERVAL_MS).state;
  assert.equal(getTradeRefillInfo(after15, 1, now + TRADE_REFILL_INTERVAL_MS).availableSlots, 1);
  assert.deepEqual(after15.refillAtQueue, [now + TRADE_REFILL_INTERVAL_MS * 2, now + TRADE_REFILL_INTERVAL_MS * 3]);

  const after30 = reconcileTradeState(after15, 1, now + TRADE_REFILL_INTERVAL_MS * 2).state;
  assert.equal(getTradeRefillInfo(after30, 1, now + TRADE_REFILL_INTERVAL_MS * 2).availableSlots, 2);

  const after45 = reconcileTradeState(after30, 1, now + TRADE_REFILL_INTERVAL_MS * 3).state;
  assert.equal(getTradeRefillInfo(after45, 1, now + TRADE_REFILL_INTERVAL_MS * 3).availableSlots, 3);
  assert.deepEqual(after45.refillAtQueue, []);

  const repeated = reconcileTradeState(after45, 1, now + TRADE_REFILL_INTERVAL_MS * 60);
  assert.equal(repeated.changed, false);
  assert.deepEqual(repeated.state.refillAtQueue, []);
});

test('trade state migration is safe, removes matured entries and caps queue to current slots', () => {
  const now = 10_000;
  assert.deepEqual(migrateTradeState(undefined, 2, now), { refillAtQueue: [] });
  assert.deepEqual(migrateTradeState({ refillAtQueue: 'bad' }, 2, now), { refillAtQueue: [] });

  const migrated = migrateTradeState({
    refillAtQueue: [
      now - 1,
      now + 5_000,
      Number.NaN,
      now + 4_000,
      now + 6_000,
      now + 7_000,
      now + 8_000,
    ],
  }, 1, now);

  assert.equal(migrated.refillAtQueue.length, 3);
  assert.equal(migrated.refillAtQueue[0], now + 4_000);
  assert.equal(migrated.refillAtQueue[1], migrated.refillAtQueue[0] + TRADE_REFILL_INTERVAL_MS);
  assert.equal(migrated.refillAtQueue[2], migrated.refillAtQueue[1] + TRADE_REFILL_INTERVAL_MS);
});
