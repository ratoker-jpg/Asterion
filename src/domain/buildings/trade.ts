import { TRADE_CENTER_MAX_LEVEL } from './resource-zone.ts';
import { creditResources, type ResourceCapacitiesInput, type ResourceCreditResult } from '../resources/credit.ts';
import { CAMPAIGN_SPEED_SCALE, type CampaignSpeed } from '../runtime/mode.ts';

export const TRADE_REFILL_INTERVAL_MS = 15 * 60 * 1000;
export const TRADE_RESOURCES = ['metal', 'minerals', 'gas', 'debris'] as const;
export const TRADE_TARGET_RESOURCES = ['metal', 'minerals', 'gas'] as const;

export type TradeResource = (typeof TRADE_RESOURCES)[number];
export type TradeTargetResource = (typeof TRADE_TARGET_RESOURCES)[number];

export type TradeWallet = {
  metal: number;
  minerals: number;
  gas: number;
  debris: number;
};

export type TradeState = {
  refillAtQueue: number[];
  /** Real-time interval for this campaign's trade charges; absent in saves from before speed-aware trade. */
  refillIntervalMs?: number;
};

export type TradeRequest = {
  source: TradeResource | null;
  target: TradeTargetResource | null;
  amount: number;
};

export type TradeExecutionState = {
  wallet: TradeWallet;
  trade: TradeState;
  capacities?: ResourceCapacitiesInput;
};

export type TradeRefillInfo = {
  maxSlots: number;
  availableSlots: number;
  missingSlots: number;
  refillAtQueue: number[];
  nextRefillAt: number | null;
  fullRefillAt: number | null;
  nextRefillMs: number;
  fullRefillMs: number;
  refillIntervalMs: number;
};

export type TradeValidation = {
  canTrade: boolean;
  reason: string | null;
  amountLimit: number;
  received: number;
  refill: TradeRefillInfo;
};

export type TradeExecution = TradeValidation & {
  ok: boolean;
  state: TradeExecutionState;
  refillAt: number | null;
  credit?: ResourceCreditResult;
};

function toNonNegativeInteger(value: unknown, fallback = 0): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.max(0, Math.floor(value));
}

function toSafeTimestamp(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return null;
  return Math.floor(value);
}

function toSafeRefillInterval(value: unknown, fallback = TRADE_REFILL_INTERVAL_MS): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return fallback;
  return Math.max(1, Math.floor(value));
}

/** The player's 15-minute trade interval follows the saved universe speed only. */
export function getTradeRefillIntervalMsForCampaignSpeed(speed: CampaignSpeed): number {
  const multiplier = CAMPAIGN_SPEED_SCALE[speed] ?? 1;
  return Math.max(1, Math.round(TRADE_REFILL_INTERVAL_MS / multiplier));
}

function sameQueue(a: readonly number[], b: readonly number[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

export function isTradeResource(value: unknown): value is TradeResource {
  return typeof value === 'string' && (TRADE_RESOURCES as readonly string[]).includes(value);
}

export function isTradeTargetResource(value: unknown): value is TradeTargetResource {
  return typeof value === 'string' && (TRADE_TARGET_RESOURCES as readonly string[]).includes(value);
}

export function createDefaultTradeState(refillIntervalMs = TRADE_REFILL_INTERVAL_MS): TradeState {
  return { refillAtQueue: [], refillIntervalMs: toSafeRefillInterval(refillIntervalMs) };
}

export function getTradeMaxSlots(level: number): number {
  const safeLevel = Math.min(TRADE_CENTER_MAX_LEVEL, Math.max(0, Math.floor(Number.isFinite(level) ? level : 0)));
  return safeLevel * 3;
}

export function getTradeAmountLimit(resourceRatingPoints: number): number {
  return toNonNegativeInteger(resourceRatingPoints) * 10;
}

function normalizeFutureQueue(value: unknown, maxSlots: number, now: number, intervalMs: number): number[] {
  if (!Array.isArray(value) || maxSlots <= 0) return [];
  const candidates = value
    .map(toSafeTimestamp)
    .filter((timestamp): timestamp is number => timestamp != null && timestamp > now)
    .sort((a, b) => a - b)
    .slice(0, maxSlots);

  const normalized: number[] = [];
  for (const timestamp of candidates) {
    if (normalized.length === 0) {
      normalized.push(timestamp);
      continue;
    }
    normalized.push(Math.max(timestamp, normalized[normalized.length - 1] + intervalMs));
  }
  return normalized;
}

export function migrateTradeState(
  value: unknown,
  tradeCenterLevel: number,
  now = Date.now(),
  desiredRefillIntervalMs = TRADE_REFILL_INTERVAL_MS,
): TradeState {
  const source = value && typeof value === 'object' ? value as { refillAtQueue?: unknown; refillIntervalMs?: unknown } : null;
  const oldInterval = toSafeRefillInterval(source?.refillIntervalMs);
  const refillIntervalMs = toSafeRefillInterval(desiredRefillIntervalMs);
  const maxSlots = getTradeMaxSlots(tradeCenterLevel);
  // Expire charges using the old cadence before scaling anything that remains.
  const previousQueue = normalizeFutureQueue(source?.refillAtQueue, maxSlots, now, oldInterval);
  // Scale each remaining offset from now so the first charge keeps its partial
  // progress and later charges keep their sequential spacing. Persisting the
  // new interval makes subsequent loads idempotent.
  const refillAtQueue = oldInterval === refillIntervalMs
    ? previousQueue
    : normalizeFutureQueue(
      previousQueue.map((timestamp) => now + Math.max(1, Math.round((timestamp - now) * refillIntervalMs / oldInterval))),
      maxSlots,
      now,
      refillIntervalMs,
    );
  return { refillAtQueue, refillIntervalMs };
}

export function reconcileTradeState(state: TradeState, tradeCenterLevel: number, now: number): { state: TradeState; changed: boolean } {
  const refillIntervalMs = toSafeRefillInterval(state.refillIntervalMs);
  const refillAtQueue = normalizeFutureQueue(state.refillAtQueue, getTradeMaxSlots(tradeCenterLevel), now, refillIntervalMs);
  const changed = !sameQueue(refillAtQueue, state.refillAtQueue) || state.refillIntervalMs !== refillIntervalMs;
  return {
    state: changed ? { ...state, refillAtQueue, refillIntervalMs } : state,
    changed,
  };
}

export function getTradeRefillInfo(state: TradeState, tradeCenterLevel: number, now: number): TradeRefillInfo {
  const maxSlots = getTradeMaxSlots(tradeCenterLevel);
  const reconciled = reconcileTradeState(state, tradeCenterLevel, now).state;
  const refillAtQueue = reconciled.refillAtQueue;
  const missingSlots = Math.min(maxSlots, refillAtQueue.length);
  const availableSlots = Math.max(0, maxSlots - missingSlots);
  const nextRefillAt = refillAtQueue[0] ?? null;
  const fullRefillAt = refillAtQueue[refillAtQueue.length - 1] ?? null;
  return {
    maxSlots,
    availableSlots,
    missingSlots,
    refillAtQueue: [...refillAtQueue],
    nextRefillAt,
    fullRefillAt,
    nextRefillMs: nextRefillAt == null ? 0 : Math.max(0, nextRefillAt - now),
    fullRefillMs: fullRefillAt == null ? 0 : Math.max(0, fullRefillAt - now),
    refillIntervalMs: reconciled.refillIntervalMs ?? TRADE_REFILL_INTERVAL_MS,
  };
}

export function getTradeReceivedAmount(source: TradeResource, amount: number): number {
  const safeAmount = toNonNegativeInteger(amount);
  return source === 'debris' ? Math.floor(safeAmount * 6 / 10) : safeAmount;
}

export function getTradeSourceBalance(wallet: TradeWallet, source: TradeResource): number {
  return toNonNegativeInteger(wallet[source]);
}

export function getTradeMaxAmount(wallet: TradeWallet, source: TradeResource, resourceRatingPoints: number): number {
  return Math.min(getTradeSourceBalance(wallet, source), getTradeAmountLimit(resourceRatingPoints));
}

export function validateTrade(
  state: TradeExecutionState,
  tradeCenterLevel: number,
  resourceRatingPoints: number,
  request: TradeRequest,
  now: number,
): TradeValidation {
  const amountLimit = getTradeAmountLimit(resourceRatingPoints);
  const refill = getTradeRefillInfo(state.trade, tradeCenterLevel, now);
  const source = request.source;
  const target = request.target as unknown;
  const amount = request.amount;

  const invalid = (reason: string): TradeValidation => ({ canTrade: false, reason, amountLimit, received: 0, refill });

  if (tradeCenterLevel < 1 || refill.maxSlots <= 0) return invalid('Торговый центр не построен');
  if (refill.availableSlots <= 0) return invalid('Нет доступных сделок');
  if (!isTradeResource(source)) return invalid('Выберите ресурс продажи');
  if (target === 'debris') return invalid('Нельзя купить обломки');
  if (!isTradeTargetResource(target)) return invalid('Выберите ресурс покупки');
  if (source !== 'debris' && source === target) return invalid('Нельзя обменивать ресурс на самого себя');
  if (!Number.isInteger(amount) || amount <= 0) return invalid('Введите целое положительное количество');
  if (amount > amountLimit) return invalid('Превышен лимит одной сделки');
  if (amount > getTradeSourceBalance(state.wallet, source)) return invalid('Недостаточно ресурса');

  return {
    canTrade: true,
    reason: null,
    amountLimit,
    received: getTradeReceivedAmount(source, amount),
    refill,
  };
}

export function executeTrade(
  state: TradeExecutionState,
  tradeCenterLevel: number,
  resourceRatingPoints: number,
  request: TradeRequest,
  now: number,
): TradeExecution {
  const validation = validateTrade(state, tradeCenterLevel, resourceRatingPoints, request, now);
  if (!validation.canTrade || !isTradeResource(request.source) || !isTradeTargetResource(request.target)) {
    return { ...validation, ok: false, state, refillAt: null };
  }

  const reconciled = reconcileTradeState(state.trade, tradeCenterLevel, now).state;
  const previousRefillAt = reconciled.refillAtQueue[reconciled.refillAtQueue.length - 1] ?? now;
  const refillIntervalMs = reconciled.refillIntervalMs ?? TRADE_REFILL_INTERVAL_MS;
  const refillAt = Math.max(now, previousRefillAt) + refillIntervalMs;
  const walletAfterSpend: TradeWallet = { ...state.wallet };
  walletAfterSpend[request.source] -= request.amount;
  const unlimitedCapacities = { metal: Number.MAX_SAFE_INTEGER, minerals: Number.MAX_SAFE_INTEGER, gas: Number.MAX_SAFE_INTEGER };
  const credit = creditResources(
    walletAfterSpend,
    state.capacities ?? unlimitedCapacities,
    { [request.target]: validation.received },
  );
  const wallet: TradeWallet = {
    ...walletAfterSpend,
    metal: credit.wallet.metal,
    minerals: credit.wallet.minerals,
    gas: credit.wallet.gas,
  };

  return {
    ...validation,
    ok: true,
    refillAt,
    state: {
      wallet,
      trade: { ...reconciled, refillAtQueue: [...reconciled.refillAtQueue, refillAt] },
    },
    credit,
  };
}
