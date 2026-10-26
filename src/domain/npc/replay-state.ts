import type { WorldCatchupSummary } from './world-catchup-summary.ts';

export type NpcReplayState = {
  version: 1;
  processedThroughAt: number;
  targetAt: number;
  /** World news of the current (or last, until dismissed) catch-up. */
  summary?: WorldCatchupSummary;
};

export function isNpcReplayMetadata(value: unknown): value is NpcReplayState {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const source = value as Record<string, unknown>;
  return source.version === 1 && Number.isSafeInteger(source.processedThroughAt)
    && Number(source.processedThroughAt) >= 0 && Number.isSafeInteger(source.targetAt)
    && Number(source.targetAt) >= Number(source.processedThroughAt);
}
