import assert from 'node:assert/strict';
import test from 'node:test';

import { CURRENT_PLAYER_DISPLAY_NAME, createDefaultRatingPrototypeState, createPlayerRatingEntries } from '../rating/fixtures.ts';
import {
  createDefaultPlayerProfileState,
  migratePlayerProfileState,
  playerFactionLabel,
} from './repository.ts';
import { selectPlayerProfileMetrics, selectPlayerRatingEntry } from './selectors.ts';

test('default player profile is a persisted prototype fixture without alliance membership', () => {
  assert.deepEqual(createDefaultPlayerProfileState(), {
    playerId: 'player-current',
    displayName: 'Dendrilion',
    factionId: 'synod',
    allianceId: null,
    alliance: null,
    protectionMode: false,
  });
});

test('profile migration fills missing fields and rejects malformed alliance membership', () => {
  assert.deepEqual(migratePlayerProfileState({
    playerId: ' player-custom ',
    displayName: '  Dendrilion   Prime ',
    factionId: 'not-a-faction',
    allianceId: 'alliance-bad',
    alliance: { name: 'No emblem', tag: 'BAD' },
    protectionMode: 'true',
  }), {
    playerId: 'player-custom',
    displayName: 'Dendrilion Prime',
    factionId: 'synod',
    allianceId: null,
    alliance: null,
    protectionMode: false,
  });
});

test('active alliance keeps only explicitly saved identity and emblem', () => {
  const profile = migratePlayerProfileState({
    playerId: 'player-current',
    displayName: 'Dendrilion',
    factionId: 'synod',
    allianceId: 'alliance-ion',
    alliance: { id: 'alliance-ion', name: 'Ion Pact', tag: 'ION', emblem: { glyph: 'orbit', accent: 'violet' } },
    protectionMode: false,
  });
  assert.equal(profile.allianceId, 'alliance-ion');
  assert.deepEqual(profile.alliance, { id: 'alliance-ion', name: 'Ion Pact', tag: 'ION', emblem: { glyph: 'orbit', accent: 'violet' } });
});

test('compatibility faction ids use visible Russian labels', () => {
  assert.equal(playerFactionLabel('aegis'), 'Астеры');
  assert.equal(playerFactionLabel('synod'), 'Илары');
  assert.equal(playerFactionLabel('veyra'), 'Рой');
});

test('profile metrics come from the rating selector and stay in sync with the current rating row', () => {
  const rating = createDefaultRatingPrototypeState();
  const profile = createDefaultPlayerProfileState();
  const entry = selectPlayerRatingEntry(rating, profile.playerId);
  const metrics = selectPlayerProfileMetrics(profile, rating);
  const current = createPlayerRatingEntries(rating.resourcePoints).find((candidate) => candidate.isCurrentPlayer);

  assert.equal(entry?.name, CURRENT_PLAYER_DISPLAY_NAME);
  assert.equal(entry?.id, current?.id);
  assert.deepEqual(metrics.map((metric) => metric.value), [855_880, 469_240, 1_325_120, 72_332]);
});

