import assert from 'node:assert/strict';
import test from 'node:test';

import { CURRENT_PLAYER_DISPLAY_NAME, createPlayerRatingEntries } from '../rating/fixtures.ts';
import type { OwnerScore } from '../rating/types.ts';
import { createDefaultCommandState } from '../command/repository.ts';
import {
  createDefaultPlayerProfileState,
  CURRENT_PLAYER_FACTION_ID,
  migratePlayerProfileState,
  playerFactionLabel,
  syncPlayerProfileWithCommand,
  syncPlayerProfileWithFaction,
} from './repository.ts';
import { selectPlayerProfileMetrics, selectPlayerRatingEntry } from './selectors.ts';

test('default player profile uses the current Aegis fixture before Command sync', () => {
  assert.deepEqual(createDefaultPlayerProfileState(), {
    playerId: 'player-current',
    displayName: 'Dendrilion',
    factionId: 'aegis',
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
    factionId: 'aegis',
    allianceId: null,
    alliance: null,
    protectionMode: false,
  });
});

test('active alliance keeps only explicitly saved identity and emblem', () => {
  const profile = migratePlayerProfileState({
    playerId: 'player-current',
    displayName: 'Dendrilion',
    factionId: 'aegis',
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

test('profile alliance identity syncs from the existing Command alliance', () => {
  const command = createDefaultCommandState('test', { playerId: createDefaultPlayerProfileState().playerId });
  const profile = syncPlayerProfileWithCommand(createDefaultPlayerProfileState(), command);

  assert.equal(profile.allianceId, 'alliance-test-helion-v1');
  assert.deepEqual(profile.alliance, {
    id: 'alliance-test-helion-v1',
    name: 'Содружество Гелион',
    tag: 'HLN',
    emblem: { glyph: 'starforge', accent: 'cyan' },
  });
});

test('profile faction sync repairs the legacy fixture to the current Aegis player', () => {
  const profile = syncPlayerProfileWithFaction({
    ...createDefaultPlayerProfileState(),
    factionId: 'synod',
  }, CURRENT_PLAYER_FACTION_ID);

  assert.equal(profile.factionId, 'aegis');
});

test('profile metrics come from the rating selector and stay in sync with the current rating row', () => {
  const profile = createDefaultPlayerProfileState();
  const score: OwnerScore = {
    ownerId: profile.playerId,
    resourcePoints: 0,
    battlePoints: 0,
    totalPoints: 0,
    achievementPoints: 0,
  };
  const entry = selectPlayerRatingEntry(score, profile.playerId);
  const metrics = selectPlayerProfileMetrics(profile, score);
  const current = createPlayerRatingEntries(score).find((candidate) => candidate.isCurrentPlayer);

  assert.equal(entry?.name, CURRENT_PLAYER_DISPLAY_NAME);
  assert.equal(entry?.id, current?.id);
  assert.deepEqual(metrics.map((metric) => metric.value), [0, 0, 0, 0]);
});
