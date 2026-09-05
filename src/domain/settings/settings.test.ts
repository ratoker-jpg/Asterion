import assert from 'node:assert/strict';
import test from 'node:test';
import { getDesktopBridge, parseDesktopDisplayRequest } from './desktop.ts';
import {
  CAMPAIGN_SAVE_KEY,
  PREFERENCES_KEY,
  createDefaultPreferences,
  normalizePreferences,
  normalizeTypographyScale,
  persistPreferences,
  readPreferences,
  resetPreferences,
  updateTypographyScale,
} from './preferences.ts';

class MemoryStorage {
  private values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
  removeItem(key: string) { this.values.delete(key); }
}

test('settings defaults are deterministic', () => {
  assert.deepEqual(createDefaultPreferences(), createDefaultPreferences());
});

test('malformed preferences are safe', () => {
  const storage = new MemoryStorage();
  storage.setItem(PREFERENCES_KEY, '{broken');
  assert.deepEqual(readPreferences(storage), createDefaultPreferences());
  assert.deepEqual(normalizePreferences(null), createDefaultPreferences());
});

test('typography scales clamp and step independently', () => {
  assert.equal(normalizeTypographyScale(77), 80);
  assert.equal(normalizeTypographyScale(183), 180);
  assert.equal(normalizeTypographyScale(137), 135);
  assert.equal(normalizeTypographyScale(Number.NaN), 100);

  const defaults = createDefaultPreferences();
  const helper = updateTypographyScale(defaults, 'helper', 180);
  assert.equal(helper.typography.helper, 180);
  assert.equal(helper.typography.hud, 100);
  assert.equal(helper.typography.body, 100);

  const hud = updateTypographyScale(defaults, 'hud', 130);
  assert.equal(hud.typography.hud, 130);
  assert.equal(hud.typography.helper, 100);
  assert.equal(hud.typography.body, 100);
});

test('preferences persistence is separate from campaign save', () => {
  const storage = new MemoryStorage();
  storage.setItem(CAMPAIGN_SAVE_KEY, JSON.stringify({ metal: 99 }));
  const prefs = updateTypographyScale(createDefaultPreferences(), 'table', 125);
  assert.equal(persistPreferences(prefs, storage), true);
  assert.equal(readPreferences(storage).typography.table, 125);

  resetPreferences(storage);
  assert.equal(storage.getItem(PREFERENCES_KEY), null);
  assert.equal(storage.getItem(CAMPAIGN_SAVE_KEY), JSON.stringify({ metal: 99 }));
});

test('campaign storage changes do not erase preferences', () => {
  const storage = new MemoryStorage();
  const prefs = updateTypographyScale(createDefaultPreferences(), 'hud', 145);
  persistPreferences(prefs, storage);
  storage.setItem(CAMPAIGN_SAVE_KEY, JSON.stringify({ reset: true }));
  storage.removeItem(CAMPAIGN_SAVE_KEY);
  assert.equal(readPreferences(storage).typography.hud, 145);
});

test('desktop bridge input is validated and web environment is safe', () => {
  assert.deepEqual(parseDesktopDisplayRequest({ mode: 'windowed', preset: '1600x900' }), { mode: 'windowed', preset: '1600x900' });
  assert.equal(parseDesktopDisplayRequest({ mode: 'windowed', preset: '800x600' }), null);
  assert.equal(parseDesktopDisplayRequest({ mode: 'invalid', preset: '1920x1080' }), null);
  assert.equal(getDesktopBridge({}), null);
});
