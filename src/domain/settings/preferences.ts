export const ASTERION_PREFERENCES_KEY = 'asterion.preferences.v1';
export const ASTERION_CAMPAIGN_KEY = 'asterion.vertical-slice.v1';

export const TEXT_SCALES = [0.9, 1, 1.1, 1.2, 1.3, 1.5, 1.7] as const;
export const WINDOW_RESOLUTIONS = ['1280x720', '1600x900', '1920x1080', '2560x1440'] as const;
export const WINDOW_MODES = ['fullscreen', 'windowed'] as const;

export type TextScale = (typeof TEXT_SCALES)[number];
export type WindowResolution = (typeof WINDOW_RESOLUTIONS)[number];
export type WindowMode = (typeof WINDOW_MODES)[number];

export type AsterionPreferences = {
  textScale: TextScale;
  reducedMotion: boolean;
  tooltipsEnabled: boolean;
  windowMode: WindowMode;
  windowResolution: WindowResolution;
};

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

type FontBaseline = {
  value: string;
  priority: string;
};

const fontBaselines = new WeakMap<CSSStyleDeclaration, FontBaseline>();

export const DEFAULT_PREFERENCES: Readonly<AsterionPreferences> = Object.freeze({
  textScale: 1,
  reducedMotion: false,
  tooltipsEnabled: true,
  windowMode: 'fullscreen',
  windowResolution: '1920x1080',
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isWindowResolution(value: unknown): value is WindowResolution {
  return typeof value === 'string' && (WINDOW_RESOLUTIONS as readonly string[]).includes(value);
}

function isWindowMode(value: unknown): value is WindowMode {
  return typeof value === 'string' && (WINDOW_MODES as readonly string[]).includes(value);
}

export function normalizeTextScale(value: unknown): TextScale {
  if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_PREFERENCES.textScale;
  const clamped = Math.min(TEXT_SCALES.at(-1) ?? 1.7, Math.max(TEXT_SCALES[0], value));
  return TEXT_SCALES.reduce((best, candidate) => (
    Math.abs(candidate - clamped) < Math.abs(best - clamped) ? candidate : best
  ), DEFAULT_PREFERENCES.textScale);
}

export function migratePreferences(value: unknown): AsterionPreferences {
  if (!isRecord(value)) return { ...DEFAULT_PREFERENCES };
  return {
    textScale: normalizeTextScale(value.textScale),
    reducedMotion: typeof value.reducedMotion === 'boolean' ? value.reducedMotion : DEFAULT_PREFERENCES.reducedMotion,
    tooltipsEnabled: typeof value.tooltipsEnabled === 'boolean' ? value.tooltipsEnabled : DEFAULT_PREFERENCES.tooltipsEnabled,
    windowMode: isWindowMode(value.windowMode) ? value.windowMode : DEFAULT_PREFERENCES.windowMode,
    windowResolution: isWindowResolution(value.windowResolution) ? value.windowResolution : DEFAULT_PREFERENCES.windowResolution,
  };
}

function resolveStorage(storage?: StorageLike): StorageLike | null {
  if (storage) return storage;
  if (typeof window === 'undefined') return null;
  return window.localStorage;
}

export function readPreferences(storage?: StorageLike): AsterionPreferences {
  const target = resolveStorage(storage);
  if (!target) return { ...DEFAULT_PREFERENCES };
  try {
    const raw = target.getItem(ASTERION_PREFERENCES_KEY);
    if (!raw) return { ...DEFAULT_PREFERENCES };
    return migratePreferences(JSON.parse(raw));
  } catch {
    return { ...DEFAULT_PREFERENCES };
  }
}

export type PersistPreferencesResult =
  | { ok: true; value: AsterionPreferences }
  | { ok: false; value: AsterionPreferences; error: string };

export function persistPreferences(value: unknown, storage?: StorageLike): PersistPreferencesResult {
  const normalized = migratePreferences(value);
  const target = resolveStorage(storage);
  if (!target) return { ok: false, value: normalized, error: 'Локальное хранилище настроек недоступно.' };
  try {
    target.setItem(ASTERION_PREFERENCES_KEY, JSON.stringify(normalized));
    return { ok: true, value: normalized };
  } catch {
    return { ok: false, value: normalized, error: 'Не удалось сохранить настройки интерфейса.' };
  }
}

export function resetPreferences(storage?: StorageLike): AsterionPreferences {
  const target = resolveStorage(storage);
  try {
    target?.removeItem(ASTERION_PREFERENCES_KEY);
  } catch {
    // Reset remains deterministic even if storage is unavailable.
  }
  return { ...DEFAULT_PREFERENCES };
}

function scaleFontDeclaration(style: CSSStyleDeclaration, scale: number) {
  let baseline = fontBaselines.get(style);
  if (!baseline) {
    const value = style.getPropertyValue('font-size').trim();
    if (!value) return;
    baseline = { value, priority: style.getPropertyPriority('font-size') };
    fontBaselines.set(style, baseline);
  }

  const match = baseline.value.match(/^(-?\d*\.?\d+)(px|rem|em)$/i);
  if (!match) return;
  const numeric = Number(match[1]);
  if (!Number.isFinite(numeric)) return;
  const scaled = Math.round(numeric * scale * 1000) / 1000;
  style.setProperty('font-size', `${scaled}${match[2]}`, baseline.priority);
}

function scaleRuleList(rules: CSSRuleList, scale: number) {
  for (const rule of Array.from(rules)) {
    if (typeof CSSStyleRule !== 'undefined' && rule instanceof CSSStyleRule) {
      scaleFontDeclaration(rule.style, scale);
    }
    const nestedRules = (rule as CSSRule & { cssRules?: CSSRuleList }).cssRules;
    if (nestedRules) scaleRuleList(nestedRules, scale);
  }
}

/**
 * Applies device/UI preferences centrally. Asterion's existing CSS uses many
 * fixed desktop font sizes; scaling stylesheet declarations from a cached
 * baseline lets the preference affect the whole shell without plumbing props
 * through every screen or changing the 1920x1080 stage geometry.
 */
export function applyPreferencesToDocument(preferences: AsterionPreferences) {
  if (typeof document === 'undefined') return;
  const normalized = migratePreferences(preferences);
  const root = document.documentElement;
  root.style.setProperty('--asterion-text-scale', String(normalized.textScale));
  root.dataset.textScale = String(Math.round(normalized.textScale * 100));
  root.dataset.reducedMotion = normalized.reducedMotion ? 'true' : 'false';
  root.dataset.tooltips = normalized.tooltipsEnabled ? 'on' : 'off';

  for (const sheet of Array.from(document.styleSheets)) {
    try {
      scaleRuleList(sheet.cssRules, normalized.textScale);
    } catch {
      // Cross-origin or unavailable stylesheets are intentionally ignored.
    }
  }
}
