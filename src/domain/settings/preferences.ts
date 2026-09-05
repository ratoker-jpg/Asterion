import { TYPOGRAPHY_KEYS, type TypographyKey, type TypographyScales, type UiPreferencesV2, WINDOW_PRESETS } from './types.ts';

export const PREFERENCES_KEY = 'asterion.preferences.v2';
export const CAMPAIGN_SAVE_KEY = 'asterion.vertical-slice.v1';
export const TYPOGRAPHY_MIN = 80;
export const TYPOGRAPHY_MAX = 180;
export const TYPOGRAPHY_STEP = 5;

export type PreferenceStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export function normalizeTypographyScale(value: unknown) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 100;
  const stepped = Math.round(value / TYPOGRAPHY_STEP) * TYPOGRAPHY_STEP;
  return Math.max(TYPOGRAPHY_MIN, Math.min(TYPOGRAPHY_MAX, stepped));
}

export function createDefaultTypographyScales(): TypographyScales {
  return {
    hud: 100,
    pageTitle: 100,
    sectionTitle: 100,
    body: 100,
    table: 100,
    control: 100,
    secondary: 100,
    helper: 100,
  };
}

export function createDefaultPreferences(): UiPreferencesV2 {
  return {
    version: 2,
    typography: createDefaultTypographyScales(),
    display: {
      mode: 'fullscreen',
      preset: '1920x1080',
    },
  };
}

function isWindowPreset(value: unknown): value is UiPreferencesV2['display']['preset'] {
  return typeof value === 'string' && WINDOW_PRESETS.includes(value as UiPreferencesV2['display']['preset']);
}

export function normalizePreferences(value: unknown): UiPreferencesV2 {
  const defaults = createDefaultPreferences();
  if (!value || typeof value !== 'object') return defaults;

  const candidate = value as {
    typography?: Partial<Record<TypographyKey, unknown>>;
    display?: { mode?: unknown; preset?: unknown };
  };

  const typography = createDefaultTypographyScales();
  for (const key of TYPOGRAPHY_KEYS) {
    typography[key] = normalizeTypographyScale(candidate.typography?.[key]);
  }

  return {
    version: 2,
    typography,
    display: {
      mode: candidate.display?.mode === 'windowed' ? 'windowed' : 'fullscreen',
      preset: isWindowPreset(candidate.display?.preset) ? candidate.display.preset : defaults.display.preset,
    },
  };
}

function resolveStorage(storage?: PreferenceStorage | null) {
  if (storage) return storage;
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

export function readPreferences(storage?: PreferenceStorage | null): UiPreferencesV2 {
  const target = resolveStorage(storage);
  if (!target) return createDefaultPreferences();

  try {
    const raw = target.getItem(PREFERENCES_KEY);
    return raw ? normalizePreferences(JSON.parse(raw)) : createDefaultPreferences();
  } catch {
    return createDefaultPreferences();
  }
}

export function persistPreferences(preferences: UiPreferencesV2, storage?: PreferenceStorage | null) {
  const target = resolveStorage(storage);
  if (!target) return false;

  try {
    target.setItem(PREFERENCES_KEY, JSON.stringify(normalizePreferences(preferences)));
    return true;
  } catch {
    return false;
  }
}

export function resetPreferences(storage?: PreferenceStorage | null) {
  const target = resolveStorage(storage);
  const defaults = createDefaultPreferences();
  if (!target) return defaults;

  try {
    target.removeItem(PREFERENCES_KEY);
  } catch {
    // Storage may be blocked; defaults still remain safe in memory.
  }
  return defaults;
}

export function updateTypographyScale(preferences: UiPreferencesV2, key: TypographyKey, value: unknown): UiPreferencesV2 {
  return {
    ...preferences,
    typography: {
      ...preferences.typography,
      [key]: normalizeTypographyScale(value),
    },
  };
}

export function applyTypographyPreferences(
  preferences: UiPreferencesV2,
  target?: { style: { setProperty: (name: string, value: string) => void } } | null,
) {
  let element = target;
  if (!element) {
    try {
      element = typeof document === 'undefined' ? null : document.documentElement;
    } catch {
      element = null;
    }
  }
  if (!element) return;

  const normalized = normalizePreferences(preferences);
  for (const key of TYPOGRAPHY_KEYS) {
    const cssKey = key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
    element.style.setProperty(`--text-scale-${cssKey}`, String(normalized.typography[key] / 100));
  }
}
