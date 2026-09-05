export const TYPOGRAPHY_KEYS = [
  'hud',
  'pageTitle',
  'sectionTitle',
  'body',
  'table',
  'control',
  'secondary',
  'helper',
] as const;

export type TypographyKey = (typeof TYPOGRAPHY_KEYS)[number];
export type TypographyScales = Record<TypographyKey, number>;

export const WINDOW_PRESETS = ['1280x720', '1600x900', '1920x1080', '2560x1440'] as const;
export type WindowPreset = (typeof WINDOW_PRESETS)[number];
export type DisplayMode = 'fullscreen' | 'windowed';

export type UiPreferencesV2 = {
  version: 2;
  typography: TypographyScales;
  display: {
    mode: DisplayMode;
    preset: WindowPreset;
  };
};

export type DesktopDisplayRequest = UiPreferencesV2['display'];
export type DesktopDisplayState = {
  mode: DisplayMode;
  width: number;
  height: number;
};

export type AsterionDesktopBridge = {
  getDisplayState: () => Promise<DesktopDisplayState>;
  setDisplay: (request: DesktopDisplayRequest) => Promise<DesktopDisplayState>;
  onDisplayState?: (listener: (state: DesktopDisplayState) => void) => () => void;
};
