export type RuntimeMode = 'production' | 'test';

export const PRODUCTION_SAVE_KEY = 'asterion.vertical-slice.v1';
export const TEST_SAVE_KEY = 'asterion.vertical-slice.test.v1';
export const RUNTIME_SAVE_SCHEMA_VERSION = 10;

// Test Mode is deliberately accelerated at the runtime boundary. Production
// keeps the 15 minute prototype duration and never reads this scale.
export const TEST_TIME_SCALE = 15;
export const RUNTIME_STATE_CHANGED_EVENT = 'asterion:runtime-state-changed';

export function resolveRuntimeMode(search?: string): RuntimeMode {
  const source = search ?? (typeof window !== 'undefined' ? window.location.search : '');
  try {
    return new URLSearchParams(source).get('mode') === 'test' ? 'test' : 'production';
  } catch {
    return 'production';
  }
}

export const ACTIVE_RUNTIME_MODE: RuntimeMode = resolveRuntimeMode();

export function getRuntimeSaveKey(mode: RuntimeMode = ACTIVE_RUNTIME_MODE): string {
  return mode === 'test' ? TEST_SAVE_KEY : PRODUCTION_SAVE_KEY;
}

export function scaleRuntimeDuration(
  durationMs: number,
  mode: RuntimeMode = ACTIVE_RUNTIME_MODE,
): number {
  const safeDuration = Math.max(1, Math.round(durationMs));
  return mode === 'test' ? Math.max(1, Math.round(safeDuration / TEST_TIME_SCALE)) : safeDuration;
}
