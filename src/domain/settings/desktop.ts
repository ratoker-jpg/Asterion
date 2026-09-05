import { WINDOW_PRESETS, type AsterionDesktopBridge, type DesktopDisplayRequest, type WindowPreset } from './types.ts';

const PRESET_DIMENSIONS: Record<WindowPreset, readonly [number, number]> = {
  '1280x720': [1280, 720],
  '1600x900': [1600, 900],
  '1920x1080': [1920, 1080],
  '2560x1440': [2560, 1440],
};

export function parseDesktopDisplayRequest(value: unknown): DesktopDisplayRequest | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as { mode?: unknown; preset?: unknown };
  if (candidate.mode !== 'fullscreen' && candidate.mode !== 'windowed') return null;
  if (typeof candidate.preset !== 'string' || !WINDOW_PRESETS.includes(candidate.preset as WindowPreset)) return null;
  return { mode: candidate.mode, preset: candidate.preset as WindowPreset };
}

export function getWindowPresetDimensions(preset: WindowPreset) {
  return PRESET_DIMENSIONS[preset];
}

export function getDesktopBridge(scope: unknown = globalThis): AsterionDesktopBridge | null {
  if (!scope || typeof scope !== 'object') return null;
  const bridge = (scope as { asterionDesktop?: Partial<AsterionDesktopBridge> }).asterionDesktop;
  if (!bridge || typeof bridge.getDisplayState !== 'function' || typeof bridge.setDisplay !== 'function') return null;
  return bridge as AsterionDesktopBridge;
}
