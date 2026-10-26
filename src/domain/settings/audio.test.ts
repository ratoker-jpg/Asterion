import assert from 'node:assert/strict';
import test from 'node:test';
import {
  AUDIO_FULL_SCALE_GAIN,
  AUDIO_PREFERENCES_KEY,
  channelGain,
  createDefaultAudioPreferences,
  normalizeAudioPreferences,
  persistAudioPreferences,
  readAudioPreferences,
} from './audio.ts';
import { PREFERENCES_KEY } from './preferences.ts';

class MemoryStorage {
  private values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
  removeItem(key: string) { this.values.delete(key); }
}

test('audio defaults are audible and deterministic', () => {
  const defaults = createDefaultAudioPreferences();
  assert.deepEqual(defaults, createDefaultAudioPreferences());
  assert.equal(defaults.muted, false);
  assert.ok(channelGain(defaults, 'effects') > 0);
  assert.ok(channelGain(defaults, 'music') < channelGain(defaults, 'effects'), 'music sits under the effects');
});

test('malformed audio preferences fall back to defaults', () => {
  const storage = new MemoryStorage();
  storage.setItem(AUDIO_PREFERENCES_KEY, '{broken');
  assert.deepEqual(readAudioPreferences(storage), createDefaultAudioPreferences());
  assert.deepEqual(normalizeAudioPreferences(null), createDefaultAudioPreferences());
  assert.deepEqual(normalizeAudioPreferences({ master: 'loud', music: Number.NaN }), createDefaultAudioPreferences());
});

test('audio volumes are clamped and rounded', () => {
  const normalized = normalizeAudioPreferences({ master: 140, music: -5, effects: 33.6, interface: 0, muted: 'yes' });
  assert.deepEqual(normalized, { version: 1, muted: false, master: 100, music: 0, effects: 34, interface: 0 });
});

test('audio preferences round-trip under their own key', () => {
  const storage = new MemoryStorage();
  const next = { ...createDefaultAudioPreferences(), muted: true, music: 10 };
  assert.equal(persistAudioPreferences(next, storage), true);
  assert.deepEqual(readAudioPreferences(storage), next);
  assert.equal(storage.getItem(PREFERENCES_KEY), null, 'interface preferences are untouched');
});

test('mute and zero master silence every channel', () => {
  const defaults = createDefaultAudioPreferences();
  assert.equal(channelGain({ ...defaults, muted: true }, 'effects'), 0);
  assert.equal(channelGain({ ...defaults, master: 0 }, 'music'), 0);
  assert.equal(channelGain({ ...defaults, master: 100, interface: 100 }, 'interface'), AUDIO_FULL_SCALE_GAIN);
});
