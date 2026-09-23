import type {
  InitializedUniverseAsteroidRuntimeState,
  UniverseAsteroidRuntimeState,
} from './types.ts';

export const ASTEROID_GAS_CAP = 200_000;
export const ASTEROID_GAS_HOUR_MS = 60 * 60 * 1_000;
export const ASTEROID_GAS_RATES_PER_HOUR = [2_500, 10_000, 25_000] as const;

const GAS_RATE_SEED = 0x6A52;
const UINT32_RANGE = 0x1_0000_0000;

function mulberry32(seed: number) {
  return () => {
    let value = seed += 0x6D2B79F5;
    value = Math.imul(value ^ value >>> 15, value | 1);
    value ^= value + Math.imul(value ^ value >>> 7, value | 61);
    return ((value ^ value >>> 14) >>> 0) / UINT32_RANGE;
  };
}

function seededGasRandom(spawnIndex: number) {
  let seed = 2166136261;
  for (const part of [GAS_RATE_SEED, Math.floor(spawnIndex)]) {
    seed = Math.imul(seed ^ (part >>> 0), 16777619);
  }
  return mulberry32(seed >>> 0);
}

function safeTimestamp(value: unknown, fallback = 0) {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : fallback;
}

function validRate(value: unknown): value is typeof ASTEROID_GAS_RATES_PER_HOUR[number] {
  return ASTEROID_GAS_RATES_PER_HOUR.includes(value as typeof ASTEROID_GAS_RATES_PER_HOUR[number]);
}

function validRemainder(value: unknown): value is number {
  return typeof value === 'number'
    && Number.isSafeInteger(value)
    && value >= 0
    && value < ASTEROID_GAS_HOUR_MS;
}

function normalizedGasAmount(value: number) {
  return Number.isFinite(value)
    ? Math.min(ASTEROID_GAS_CAP, Math.max(0, Math.trunc(value)))
    : 0;
}

/** Selects a persistent per-asteroid rate without consulting mutable runtime RNG. */
export function getAsteroidGasRatePerHour(spawnIndex: number): typeof ASTEROID_GAS_RATES_PER_HOUR[number] {
  const random = seededGasRandom(spawnIndex);
  const bucket = Math.floor(random() * ASTEROID_GAS_RATES_PER_HOUR.length);
  return ASTEROID_GAS_RATES_PER_HOUR[bucket];
}

/**
 * Backfills gas fields for legacy asteroid saves. Missing gas clocks begin at
 * `atMs`, so existing reserves do not accrue gas before the migration time.
 */
export function initializeAsteroidGasState(
  state: UniverseAsteroidRuntimeState,
  atMs: number,
): InitializedUniverseAsteroidRuntimeState {
  const timestamp = safeTimestamp(atMs);
  const gasYield = normalizedGasAmount(state.gasYield);
  const gasRatePerHour = validRate(state.gasRatePerHour)
    ? state.gasRatePerHour
    : getAsteroidGasRatePerHour(state.spawnIndex);
  const gasUpdatedAt = safeTimestamp(state.gasUpdatedAt, timestamp);
  const gasRemainder = gasYield >= ASTEROID_GAS_CAP || !validRemainder(state.gasRemainder)
    ? 0
    : state.gasRemainder;

  if (gasYield === state.gasYield
    && gasRatePerHour === state.gasRatePerHour
    && gasUpdatedAt === state.gasUpdatedAt
    && gasRemainder === state.gasRemainder) {
    return state as InitializedUniverseAsteroidRuntimeState;
  }

  return { ...state, gasYield, gasRatePerHour, gasUpdatedAt, gasRemainder };
}

/**
 * Advance gas using integer rate×milliseconds arithmetic. The timestamp is
 * monotonic, and reaching the cap discards any excess fractional production.
 */
export function advanceAsteroidGasAt(
  state: UniverseAsteroidRuntimeState,
  atMs: number,
): InitializedUniverseAsteroidRuntimeState {
  const initialized = initializeAsteroidGasState(state, atMs);
  const timestamp = safeTimestamp(atMs, initialized.gasUpdatedAt);
  if (timestamp <= initialized.gasUpdatedAt) return initialized;

  const elapsedMs = timestamp - initialized.gasUpdatedAt;
  const accruedNumerator = BigInt(initialized.gasRatePerHour) * BigInt(elapsedMs)
    + BigInt(initialized.gasRemainder);
  const wholeGas = accruedNumerator / BigInt(ASTEROID_GAS_HOUR_MS);
  const nextGas = BigInt(initialized.gasYield) + wholeGas;
  const reachedCap = nextGas >= BigInt(ASTEROID_GAS_CAP);

  return {
    ...initialized,
    gasYield: reachedCap ? ASTEROID_GAS_CAP : Number(nextGas),
    gasUpdatedAt: timestamp,
    gasRemainder: reachedCap ? 0 : Number(accruedNumerator % BigInt(ASTEROID_GAS_HOUR_MS)),
  };
}
