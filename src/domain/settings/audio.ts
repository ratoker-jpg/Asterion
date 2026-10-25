import type { PreferenceStorage } from './preferences.ts';

/**
 * Sound settings live apart from the interface preferences (own key, own
 * version): they are read by the audio engine before any screen mounts and
 * never touch the campaign save.
 */
export const AUDIO_PREFERENCES_KEY = 'asterion.audio.v1';

export const AUDIO_CHANNELS = ['master', 'music', 'effects', 'interface'] as const;
export type AudioChannel = (typeof AUDIO_CHANNELS)[number];

export type AudioPreferencesV1 = {
  version: 1;
  muted: boolean;
} & Record<AudioChannel, number>;

export const AUDIO_VOLUME_MIN = 0;
export const AUDIO_VOLUME_MAX = 100;

export function createDefaultAudioPreferences(): AudioPreferencesV1 {
  return { version: 1, muted: false, master: 90, music: 55, effects: 75, interface: 60 };
}

export function normalizeAudioVolume(value: unknown, fallback: number) {
  const numeric = typeof value === 'number' ? value : Number.NaN;
  if (!Number.isFinite(numeric)) return fallback;
  return Math.round(Math.min(AUDIO_VOLUME_MAX, Math.max(AUDIO_VOLUME_MIN, numeric)));
}

export function normalizeAudioPreferences(value: unknown): AudioPreferencesV1 {
  const defaults = createDefaultAudioPreferences();
  if (!value || typeof value !== 'object') return defaults;
  const candidate = value as Partial<Record<keyof AudioPreferencesV1, unknown>>;
  return {
    version: 1,
    muted: candidate.muted === true,
    master: normalizeAudioVolume(candidate.master, defaults.master),
    music: normalizeAudioVolume(candidate.music, defaults.music),
    effects: normalizeAudioVolume(candidate.effects, defaults.effects),
    interface: normalizeAudioVolume(candidate.interface, defaults.interface),
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

export function readAudioPreferences(storage?: PreferenceStorage | null): AudioPreferencesV1 {
  const target = resolveStorage(storage);
  if (!target) return createDefaultAudioPreferences();
  try {
    const raw = target.getItem(AUDIO_PREFERENCES_KEY);
    return raw ? normalizeAudioPreferences(JSON.parse(raw)) : createDefaultAudioPreferences();
  } catch {
    return createDefaultAudioPreferences();
  }
}

export function persistAudioPreferences(preferences: AudioPreferencesV1, storage?: PreferenceStorage | null) {
  const target = resolveStorage(storage);
  if (!target) return false;
  try {
    target.setItem(AUDIO_PREFERENCES_KEY, JSON.stringify(normalizeAudioPreferences(preferences)));
    return true;
  } catch {
    return false;
  }
}

/** Bus gain at 100 % / 100 %: the synthesised voices are mixed quiet, the bus brings them up. */
export const AUDIO_FULL_SCALE_GAIN = 1.6;

/** Gain of one bus: perceived loudness follows the square of the slider product. */
export function channelGain(preferences: AudioPreferencesV1, channel: Exclude<AudioChannel, 'master'>) {
  if (preferences.muted) return 0;
  const level = (preferences.master / AUDIO_VOLUME_MAX) * (preferences[channel] / AUDIO_VOLUME_MAX);
  return AUDIO_FULL_SCALE_GAIN * level * level;
}
