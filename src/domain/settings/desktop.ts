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

type AsterionDesktopBridge = {
  getDisplaySettings: () => Promise<DesktopDisplaySettings>;
  setWindowMode: (mode: WindowMode) => Promise<DesktopActionResult>;
  setWindowSize: (resolution: WindowResolution) => Promise<DesktopActionResult>;
};

declare global {
  interface Window {
    asterionDesktop?: AsterionDesktopBridge;
  }
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

/**
 * Window settings are Electron-only. Web/Pages returns an explicit unavailable
 * result rather than pretending that browser JavaScript changed the desktop.
 */
export async function applyDesktopPreferences(preferences: AsterionPreferences): Promise<DesktopActionResult> {
  if (!isDesktopBridgeAvailable()) return { ok: false, reason: 'desktop-unavailable' };
  try {
    const modeResult = await window.asterionDesktop!.setWindowMode(preferences.windowMode);
    if (!modeResult.ok) return modeResult;
    if (preferences.windowMode === 'windowed') {
      return await window.asterionDesktop!.setWindowSize(preferences.windowResolution);
    }
    return modeResult;
  } catch {
    return { ok: false, reason: 'desktop-bridge-error' };
  }
}
