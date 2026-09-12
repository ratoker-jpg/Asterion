export type RuntimeMode = 'production' | 'test';

export const PRODUCTION_SAVE_KEY = 'asterion.vertical-slice.v1';
export const TEST_SAVE_KEY = 'asterion.vertical-slice.test.v1';
export const RUNTIME_SAVE_SCHEMA_VERSION = 13;

// Test Mode is deliberately accelerated at the runtime boundary. Production
// never reads any test speed setting.
export const TEST_TIME_SCALE = 15;
export const TEST_TIME_SCALE_OPTIONS = [1, 10, TEST_TIME_SCALE, 100, 200, 300, 500] as const;
export type TestTimeScale = (typeof TEST_TIME_SCALE_OPTIONS)[number];
export const TEST_TIME_SCALE_STORAGE_KEY = 'asterion.test-time-scale.v1';
export const RUNTIME_STATE_CHANGED_EVENT = 'asterion:runtime-state-changed';

export function resolveRuntimeMode(search?: string): RuntimeMode {
  const source = search ?? (typeof window !== 'undefined' ? window.location.search : '');
  return source === '?mode=test' ? 'test' : 'production';
}

export const ACTIVE_RUNTIME_MODE: RuntimeMode = resolveRuntimeMode();

export function getRuntimeSaveKey(mode: RuntimeMode = ACTIVE_RUNTIME_MODE): string {
  return mode === 'test' ? TEST_SAVE_KEY : PRODUCTION_SAVE_KEY;
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
  return mode === 'test' ? Math.max(1, Math.round(safeDuration / normalizeTestTimeScale(testTimeScale))) : safeDuration;
}
