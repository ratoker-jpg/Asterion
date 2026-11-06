/**
 * Planet shield («Щит») and protected stores. Pure rules, no state access.
 *
 * One shield covers ALL planets of an owner. While it is active nobody can
 * attack the owner's planets and the owner cannot attack anyone; spying,
 * transport and deployment stay open. After it ends a cooldown runs, counted
 * from the end of the activation. Durations are real milliseconds per world
 * speed (owner decision 06.11.2026), so catch-up and the live game agree.
 */
import type { CampaignSpeed } from '../runtime/mode.ts';

const HOUR_MS = 3_600_000;

export type ShieldTiming = Readonly<{ durationMs: number; cooldownMs: number }>;

/** normal ×1: 3 h / 12 h; fast: 1.5 h / 6 h; fastest: 30 min / 3 h; slow ×0.5 doubles normal. */
export const SHIELD_TIMING: Readonly<Record<CampaignSpeed, ShieldTiming>> = Object.freeze({
  slow: Object.freeze({ durationMs: 6 * HOUR_MS, cooldownMs: 24 * HOUR_MS }),
  standard: Object.freeze({ durationMs: 3 * HOUR_MS, cooldownMs: 12 * HOUR_MS }),
  fast: Object.freeze({ durationMs: 1.5 * HOUR_MS, cooldownMs: 6 * HOUR_MS }),
  superfast: Object.freeze({ durationMs: 0.5 * HOUR_MS, cooldownMs: 3 * HOUR_MS }),
});

export function shieldTiming(speed: CampaignSpeed | undefined): ShieldTiming {
  return SHIELD_TIMING[speed ?? 'standard'] ?? SHIELD_TIMING.standard;
}

/** Saved per owner. Absent record = never activated, no cooldown. */
export type ShieldRecord = Readonly<{
  activatedAt: number;
  /** Shield protects in [activatedAt, activeUntil). */
  activeUntil: number;
  /** The next activation is allowed from here (activeUntil + cooldown). */
  readyAt: number;
}>;

export type ShieldStatus =
  | Readonly<{ phase: 'active'; remainingMs: number; activeUntil: number }>
  | Readonly<{ phase: 'cooldown'; remainingMs: number; readyAt: number }>
  | Readonly<{ phase: 'ready' }>;

export function shieldStatus(record: ShieldRecord | undefined, at: number): ShieldStatus {
  if (!record) return { phase: 'ready' };
  if (at >= record.activatedAt && at < record.activeUntil) return { phase: 'active', remainingMs: record.activeUntil - at, activeUntil: record.activeUntil };
  if (at < record.readyAt) return { phase: 'cooldown', remainingMs: record.readyAt - at, readyAt: record.readyAt };
  return { phase: 'ready' };
}

export function isShieldActive(record: ShieldRecord | undefined, at: number): boolean {
  return shieldStatus(record, at).phase === 'active';
}

export function createShieldRecord(speed: CampaignSpeed | undefined, at: number): ShieldRecord {
  const { durationMs, cooldownMs } = shieldTiming(speed);
  return { activatedAt: at, activeUntil: at + durationMs, readyAt: at + durationMs + cooldownMs };
}

export function migrateShieldRecord(value: unknown): ShieldRecord | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const raw = value as Record<string, unknown>;
  const [a, u, r] = [raw.activatedAt, raw.activeUntil, raw.readyAt];
  if (typeof a !== 'number' || typeof u !== 'number' || typeof r !== 'number'
    || !Number.isFinite(a) || !Number.isFinite(u) || !Number.isFinite(r) || u < a || r < u) return undefined;
  return { activatedAt: Math.floor(a), activeUntil: Math.floor(u), readyAt: Math.floor(r) };
}

/** «00:42» for under an hour, «2:05:09» otherwise (minutes:seconds / hours:minutes:seconds). */
export function formatShieldRemaining(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

const PROTECTED_TIERS: ReadonlyArray<readonly [upTo: number, share: number]> = [
  [1_000_000, 0.10],
  [10_000_000, 0.05],
  [100_000_000, 0.01],
  [Infinity, 0.002],
];

/**
 * Part of one resource's storage that can never be looted: 10 % of the first
 * 1M of capacity, 5 % of the next 9M, 1 % of the next 90M, 0.2 % above 100M.
 */
export function protectedStoreAmount(capacity: number): number {
  const cap = Number.isFinite(capacity) ? Math.max(0, capacity) : 0;
  let floor = 0;
  let from = 0;
  for (const [upTo, share] of PROTECTED_TIERS) {
    if (cap <= from) break;
    floor += (Math.min(cap, upTo) - from) * share;
    from = upTo;
  }
  return Math.floor(floor);
}

/** What a raid may take from `stock`: only what lies above min(stock, protected). */
export function lootableAbove(stock: number, capacity: number): number {
  const held = Number.isFinite(stock) ? Math.max(0, stock) : 0;
  return Math.max(0, held - Math.min(held, protectedStoreAmount(capacity)));
}
