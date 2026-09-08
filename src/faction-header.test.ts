import assert from 'node:assert/strict';
import test from 'node:test';
import {
  FACTION_HEADER_THEMES,
  getResourceFillPercent,
  getResourceFillTone,
  resolveFactionHeaderId,
} from './faction-header.ts';

test('header theme registry keeps Russian faction labels and distinct material accents', () => {
  assert.deepEqual(
    Object.values(FACTION_HEADER_THEMES).map((theme) => theme.label),
    ['Астеры', 'Илары', 'Рой'],
  );
  assert.notEqual(FACTION_HEADER_THEMES.aegis.accent, FACTION_HEADER_THEMES.synod.accent);
  assert.notEqual(FACTION_HEADER_THEMES.synod.accent, FACTION_HEADER_THEMES.veyra.accent);
});

test('faction preview query overrides only the visual header theme', () => {
  assert.equal(resolveFactionHeaderId('aegis', '?faction=synod'), 'synod');
  assert.equal(resolveFactionHeaderId('veyra', '?faction=unknown'), 'veyra');
  assert.equal(resolveFactionHeaderId('aegis', ''), 'aegis');
});

test('full and overflow resource states are always critical', () => {
  assert.equal(getResourceFillTone(60_000, 60_000), 'critical');
  assert.equal(getResourceFillTone(60_001, 60_000), 'critical');
  assert.equal(getResourceFillTone(45_000, 60_000), 'warning');
  assert.equal(getResourceFillTone(30_000, 60_000), 'normal');
  assert.equal(getResourceFillTone(12_000), 'none');
  assert.equal(getResourceFillTone(140), 'none');
  assert.equal(getResourceFillPercent(90_000, 60_000), 100);
});
