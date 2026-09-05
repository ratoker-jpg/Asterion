import type { AsterionPreferences, WindowMode, WindowResolution } from './preferences.ts';

export type DesktopDisplaySettings = {
  mode: WindowMode;
  resolution: WindowResolution | string;
  fullscreen: boolean;
};

export type DesktopActionResult = {
  ok: boolean;
  settings?: DesktopDisplaySettings;
  reason?: string;
};

export type DesktopApplyOptions = {
  force?: boolean;
};

type DesktopDisplaySettingsListener = (settings: DesktopDisplaySettings) => void;

type AsterionDesktopBridge = {
  getDisplaySettings: () => Promise<DesktopDisplaySettings>;
  setWindowMode: (mode: WindowMode) => Promise<DesktopActionResult>;
  setWindowSize: (resolution: WindowResolution) => Promise<DesktopActionResult>;
  onDisplaySettingsChanged?: (listener: DesktopDisplaySettingsListener) => () => void;
};

declare global {
  interface Window {
    asterionDesktop?: AsterionDesktopBridge;
  }
}

let lastAppliedWindowPreferenceKey: string | null = null;

function getWindowPreferenceKey(preferences: AsterionPreferences) {
  return `${preferences.windowMode}:${preferences.windowResolution}`;
}

export function isDesktopBridgeAvailable() {
  return typeof window !== 'undefined' && Boolean(window.asterionDesktop);
}

export async function getDesktopDisplaySettings(): Promise<DesktopDisplaySettings | null> {
  if (!isDesktopBridgeAvailable()) return null;
  try {
    return await window.asterionDesktop!.getDisplaySettings();
  } catch {
    return null;
  }
}

export function subscribeDesktopDisplaySettings(listener: DesktopDisplaySettingsListener) {
  if (!isDesktopBridgeAvailable()) return () => {};
  const subscribe = window.asterionDesktop!.onDisplaySettingsChanged;
  if (!subscribe) return () => {};
  try {
    return subscribe(listener);
  } catch {
    return () => {};
  }
}

/**
 * Window settings are Electron-only. Web/Pages returns an explicit unavailable
 * result rather than pretending that browser JavaScript changed the desktop.
 *
 * App calls this when any preference changes. Remembering the last window-only
 * signature prevents unrelated text/tooltips/motion changes from reapplying a
 * stale saved fullscreen mode after the user toggled the real window with F11
 * or Escape. A genuine window-mode/resolution preference change produces a new
 * signature and still reaches Electron. Explicit reset flows may pass force so
 * canonical desktop defaults are reapplied even when the saved signature did
 * not change.
 */
export async function applyDesktopPreferences(
  preferences: AsterionPreferences,
  options: DesktopApplyOptions = {},
): Promise<DesktopActionResult> {
  if (!isDesktopBridgeAvailable()) return { ok: false, reason: 'desktop-unavailable' };
  const preferenceKey = getWindowPreferenceKey(preferences);
  if (!options.force && preferenceKey === lastAppliedWindowPreferenceKey) {
    const settings = await getDesktopDisplaySettings();
    return settings ? { ok: true, settings, reason: 'window-preferences-unchanged' } : { ok: true, reason: 'window-preferences-unchanged' };
  }

  try {
    const modeResult = await window.asterionDesktop!.setWindowMode(preferences.windowMode);
    if (!modeResult.ok) return modeResult;
    if (preferences.windowMode === 'windowed') {
      const sizeResult = await window.asterionDesktop!.setWindowSize(preferences.windowResolution);
      if (!sizeResult.ok) return sizeResult;
      lastAppliedWindowPreferenceKey = preferenceKey;
      return sizeResult;
    }
    lastAppliedWindowPreferenceKey = preferenceKey;
    return modeResult;
  } catch {
    return { ok: false, reason: 'desktop-bridge-error' };
  }
}
