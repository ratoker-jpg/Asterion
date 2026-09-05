import assert from 'node:assert/strict';
import test from 'node:test';

import { applyDesktopPreferences, isDesktopBridgeAvailable } from './desktop.ts';
import {
  ASTERION_CAMPAIGN_KEY,
  ASTERION_PREFERENCES_KEY,
  DEFAULT_PREFERENCES,
  migratePreferences,
  normalizeTextScale,
  persistPreferences,
  readPreferences,
  resetPreferences,
} from './preferences.ts';

class MemoryStorage {
  private values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
  removeItem(key: string) { this.values.delete(key); }
}

test('default preferences are deterministic', () => {
  assert.deepEqual(migratePreferences(undefined), DEFAULT_PREFERENCES);
  assert.deepEqual(migratePreferences(undefined), migratePreferences(undefined));
});

test('malformed preferences migrate safely', () => {
  assert.deepEqual(migratePreferences({
    textScale: 'huge',
    reducedMotion: 'yes',
    tooltipsEnabled: 1,
    windowMode: 'borderless',
    windowResolution: '9999x9999',
  }), DEFAULT_PREFERENCES);
});

test('textScale clamps and snaps to supported values including accessibility scales', () => {
  assert.equal(normalizeTextScale(-20), 0.9);
  assert.equal(normalizeTextScale(99), 1.7);
  assert.equal(normalizeTextScale(1.17), 1.2);
  assert.equal(normalizeTextScale(1.48), 1.5);
  assert.equal(normalizeTextScale(1.68), 1.7);
  assert.equal(normalizeTextScale(Number.NaN), 1);
});

test('invalid resolution falls back to canonical desktop default', () => {
  const migrated = migratePreferences({ ...DEFAULT_PREFERENCES, windowResolution: '1440x900' });
  assert.equal(migrated.windowResolution, '1920x1080');
});

test('reset settings restores defaults and removes only the preferences key', () => {
  const storage = new MemoryStorage();
  storage.setItem(ASTERION_CAMPAIGN_KEY, JSON.stringify({ metal: 777 }));
  persistPreferences({ ...DEFAULT_PREFERENCES, textScale: 1.7 }, storage);

  assert.deepEqual(resetPreferences(storage), DEFAULT_PREFERENCES);
  assert.equal(storage.getItem(ASTERION_PREFERENCES_KEY), null);
  assert.deepEqual(JSON.parse(storage.getItem(ASTERION_CAMPAIGN_KEY) ?? '{}'), { metal: 777 });
});

test('preferences persistence does not touch campaign save', () => {
  const storage = new MemoryStorage();
  const campaign = JSON.stringify({ schemaVersion: 4, reports: { readIds: ['keep'] } });
  storage.setItem(ASTERION_CAMPAIGN_KEY, campaign);

  const result = persistPreferences({ ...DEFAULT_PREFERENCES, reducedMotion: true }, storage);
  assert.equal(result.ok, true);
  assert.equal(storage.getItem(ASTERION_CAMPAIGN_KEY), campaign);
  assert.equal(readPreferences(storage).reducedMotion, true);
});

test('campaign reset does not destroy device preferences', () => {
  const storage = new MemoryStorage();
  persistPreferences({ ...DEFAULT_PREFERENCES, textScale: 1.5, tooltipsEnabled: false }, storage);
  storage.setItem(ASTERION_CAMPAIGN_KEY, JSON.stringify({ metal: 1 }));
  storage.removeItem(ASTERION_CAMPAIGN_KEY);

  assert.equal(readPreferences(storage).textScale, 1.5);
  assert.equal(readPreferences(storage).tooltipsEnabled, false);
});

test('unsupported web environment is explicit and does not throw', async () => {
  assert.equal(isDesktopBridgeAvailable(), false);
  assert.deepEqual(await applyDesktopPreferences({ ...DEFAULT_PREFERENCES, windowMode: 'windowed' }), {
    ok: false,
    reason: 'desktop-unavailable',
  });
});

test('reduced motion and tooltip preferences remain deterministic booleans', () => {
  const first = migratePreferences({ ...DEFAULT_PREFERENCES, reducedMotion: true, tooltipsEnabled: false });
  const second = migratePreferences(first);
  assert.deepEqual(second, first);
  assert.equal(first.reducedMotion, true);
  assert.equal(first.tooltipsEnabled, false);
});

test('preferences use a dedicated storage owner distinct from campaign state', () => {
  assert.notEqual(ASTERION_PREFERENCES_KEY, ASTERION_CAMPAIGN_KEY);
  assert.equal(ASTERION_PREFERENCES_KEY, 'asterion.preferences.v1');
});
