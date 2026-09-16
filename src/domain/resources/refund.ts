import type { ResourceCost } from '../combat/types.ts';

/** Canonical cancellation range used by queued resource-backed projects. */
export const CANCEL_REFUND_MIN_PERCENT = 60;
export const CANCEL_REFUND_MAX_PERCENT = 80;

export function selectCancelRefundPercent(rng: () => number = Math.random): number {
  const sampled = rng();
  const normalized = Number.isFinite(sampled) ? Math.min(0.999_999_999, Math.max(0, sampled)) : 0;
  return CANCEL_REFUND_MIN_PERCENT + Math.floor(
    normalized * (CANCEL_REFUND_MAX_PERCENT - CANCEL_REFUND_MIN_PERCENT + 1),
  );
}

export function calculateRefund(cost: ResourceCost, refundPercent: number): ResourceCost {
  const percent = Math.max(0, Math.min(100, Math.floor(refundPercent)));
  return {
    metal: Math.floor(Math.max(0, cost.metal) * percent / 100),
    minerals: Math.floor(Math.max(0, cost.minerals) * percent / 100),
    gas: Math.floor(Math.max(0, cost.gas) * percent / 100),
  };
}
