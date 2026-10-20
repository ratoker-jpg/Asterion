export type RuntimeMode = 'production' | 'test';

export const PRODUCTION_SAVE_KEY = 'asterion.vertical-slice.v1';
export const TEST_SAVE_KEY = 'asterion.vertical-slice.test.v1';
/** Save-schema boundary that migrates the legacy asteroid gas rate table once. */
export const ASTEROID_GAS_RATE_MIGRATION_SCHEMA_VERSION = 22;
export const RUNTIME_SAVE_SCHEMA_VERSION = ASTEROID_GAS_RATE_MIGRATION_SCHEMA_VERSION;

// Test Mode is deliberately accelerated at the runtime boundary. Production
// never reads any test speed setting.
export const TEST_TIME_SCALE = 15;
export const TEST_TIME_SCALE_OPTIONS = [1, 10, TEST_TIME_SCALE, 100, 200, 300, 500] as const;
export type TestTimeScale = (typeof TEST_TIME_SCALE_OPTIONS)[number];
export const TEST_TIME_SCALE_STORAGE_KEY = 'asterion.test-time-scale.v1';
export const RUNTIME_STATE_CHANGED_EVENT = 'asterion:runtime-state-changed';
export const RUNTIME_RESET_EVENT = 'asterion:runtime-reset';

let resetGeneration = 0;

export function getRuntimeResetGeneration(): number {
  return resetGeneration;
}

/** Invalidates mounted runtime consumers before the canonical state is written. */
export function dispatchRuntimeReset(
  mode: RuntimeMode = ACTIVE_RUNTIME_MODE,
  target: EventTarget = typeof window !== 'undefined' ? window : new EventTarget(),
): number {
  resetGeneration += 1;
  if (typeof CustomEvent !== 'undefined') {
    target.dispatchEvent(new CustomEvent<{ mode: RuntimeMode; generation: number }>(RUNTIME_RESET_EVENT, {
      detail: { mode, generation: resetGeneration },
    }));
  }
  return resetGeneration;
}

export function resolveRuntimeMode(search?: string): RuntimeMode {
  const source = search ?? (typeof window !== 'undefined' ? window.location.search : '');
  // Extra preview/cache parameters must not silently switch Test Mode to Production.
  // Keep test opt-in strict: exactly one explicit, case-sensitive mode=test.
  if (!source.startsWith('?')) return 'production';
  const modes = new URLSearchParams(source).getAll('mode');
  return modes.length === 1 && modes[0] === 'test' ? 'test' : 'production';
}

export const ACTIVE_RUNTIME_MODE: RuntimeMode = resolveRuntimeMode();

/**
 * Production saves live in save slots (see `application/slots.ts`). The session
 * layer points this at the active slot's storage key before the game mounts,
 * so every repository that reads/writes "the save" uses the active slot.
 * Test Mode keeps its single isolated key.
 */
let activeProductionSaveKey: string | null = null;

export function setActiveProductionSaveKey(key: string | null): void {
  activeProductionSaveKey = typeof key === 'string' && key.trim() ? key : null;
}

export function getRuntimeSaveKey(mode: RuntimeMode = ACTIVE_RUNTIME_MODE): string {
  return mode === 'test' ? TEST_SAVE_KEY : activeProductionSaveKey ?? PRODUCTION_SAVE_KEY;
}

/** Campaign speed chosen at «Новая игра»; fixed for the whole campaign. */
export type CampaignSpeed = 'slow' | 'standard' | 'fast';
export const CAMPAIGN_SPEED_SCALE: Readonly<Record<CampaignSpeed, number>> = Object.freeze({
  slow: 0.5,
  standard: 1,
  fast: 2,
});

let campaignTimeScale = 1;

/** Production time scale of the loaded campaign. Standard (×1) is the legacy behaviour bit-for-bit. */
export function setCampaignTimeScale(value: number): void {
  campaignTimeScale = Number.isFinite(value) && value > 0 ? value : 1;
}

export function getCampaignTimeScale(): number {
  return campaignTimeScale;
}

/** Elapsed-time multiplier: Test Mode uses its selector, production the campaign speed. */
export function getRuntimeElapsedScale(mode: RuntimeMode = ACTIVE_RUNTIME_MODE, testTimeScale: unknown = TEST_TIME_SCALE): number {
  return mode === 'test' ? normalizeTestTimeScale(testTimeScale) : campaignTimeScale;
}

export function normalizeTestTimeScale(value: unknown): TestTimeScale {
  const numeric = typeof value === 'number' ? value : Number(value);
  return (TEST_TIME_SCALE_OPTIONS as readonly number[]).includes(numeric)
    ? numeric as TestTimeScale
    : TEST_TIME_SCALE;
}

export function resolveTestTimeScale(value?: unknown): TestTimeScale {
  return normalizeTestTimeScale(value ?? (
    typeof window !== 'undefined' ? window.localStorage.getItem(TEST_TIME_SCALE_STORAGE_KEY) : undefined
  ));
}

export function scaleRuntimeDuration(
  durationMs: number,
  mode: RuntimeMode = ACTIVE_RUNTIME_MODE,
  testTimeScale: number = TEST_TIME_SCALE,
): number {
  const safeDuration = Math.max(1, Math.round(durationMs));
  if (mode === 'test') return Math.max(1, Math.round(safeDuration / normalizeTestTimeScale(testTimeScale)));
  return campaignTimeScale === 1 ? safeDuration : Math.max(1, Math.round(safeDuration / campaignTimeScale));
}
