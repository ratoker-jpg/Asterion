import type { EarnedAchievementRecord } from './development.ts';

export type AchievementPurchaseRecord = Readonly<{
  lookId: string;
  price: number;
  at: number;
}>;

/** The local chronicle shape approved by the achievement concept, version 1. */
export type AchievementChronicle = Readonly<{
  version: 1;
  earned: readonly EarnedAchievementRecord[];
  purchases: readonly AchievementPurchaseRecord[];
  counters: Readonly<Record<string, number>>;
  rounds: readonly unknown[];
  [key: string]: unknown;
}>;

export type AchievementChronicleParse =
  | Readonly<{ ok: true; chronicle: AchievementChronicle }>
  | Readonly<{ ok: false; reason: 'invalid' | 'newer' }>;

export function createAchievementChronicle(): AchievementChronicle {
  return { version: 1, earned: [], purchases: [], counters: {}, rounds: [] };
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isEarnedRecord(value: unknown): value is EarnedAchievementRecord {
  if (!isObjectRecord(value) || typeof value.id !== 'string' || value.id.length === 0 || !Number.isFinite(value.at)) return false;
  return (value.campaignId === undefined || typeof value.campaignId === 'string')
    && (value.roundId === undefined || typeof value.roundId === 'string');
}

function isPurchaseRecord(value: unknown): value is AchievementPurchaseRecord {
  return isObjectRecord(value)
    && typeof value.lookId === 'string'
    && value.lookId.length > 0
    && typeof value.price === 'number'
    && Number.isFinite(value.price)
    && value.price >= 0
    && typeof value.at === 'number'
    && Number.isFinite(value.at);
}

function isCounterRecord(value: unknown): value is Record<string, number> {
  return isObjectRecord(value)
    && Object.values(value).every((count) => Number.isSafeInteger(count) && Number(count) >= 0);
}

export function parseAchievementChronicle(text: string): AchievementChronicleParse {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, reason: 'invalid' };
  }
  if (!isObjectRecord(parsed) || typeof parsed.version !== 'number') return { ok: false, reason: 'invalid' };
  if (parsed.version > 1) return { ok: false, reason: 'newer' };
  if (parsed.version !== 1
    || !Array.isArray(parsed.earned)
    || !parsed.earned.every(isEarnedRecord)
    || !Array.isArray(parsed.purchases)
    || !parsed.purchases.every(isPurchaseRecord)
    || !isCounterRecord(parsed.counters)
    || !Array.isArray(parsed.rounds)) return { ok: false, reason: 'invalid' };
  return { ok: true, chronicle: parsed as AchievementChronicle };
}
