import assert from 'node:assert/strict';
import test from 'node:test';

import { TRUCE_OFFER_DELAY_MS, TEST_BOT_ALLIANCE_ID, TEST_BOT_OWNER_ID, TEST_FIXTURE_ALLIANCE_ID } from './catalog.ts';
import { declareWar, proposeTruce, respondTruce, selectAllianceRelations, selectTruceAvailability } from './diplomacy.ts';
import { createDefaultCommandState, ensureTestBotAlliance, migrateCommandState } from './repository.ts';
import { normalizeEmblem, suggestAllianceTag } from './emblem.ts';
import type { CommandResult, CommandState } from './types.ts';

const PLAYER = 'player-current';
const HOUR = 60 * 60 * 1000;

function seed(): CommandState {
  return createDefaultCommandState('test', { playerId: PLAYER, playerDisplayName: 'Dendrilion', now: 1000 });
}

function ok(result: CommandResult): CommandState {
  assert.equal(result.ok, true, result.ok ? '' : result.message);
  return result.state;
}

test('Test Mode world has the Bot 01 alliance; production never gets it, even from a test save', () => {
  const state = seed();
  assert.ok(state.alliances.some((alliance) => alliance.id === TEST_BOT_ALLIANCE_ID && alliance.leaderOwnerId === TEST_BOT_OWNER_ID));
  assert.equal(migrateCommandState(state, 'production').alliances.length, 0);
});

test('older Test Mode saves get the Bot 01 alliance once; a bot with a pending application is left alone', () => {
  const state = seed();
  const withoutBot = { ...state, alliances: state.alliances.filter((alliance) => alliance.id !== TEST_BOT_ALLIANCE_ID) };
  const migrated = migrateCommandState(withoutBot, 'test');
  assert.equal(migrated.alliances.filter((alliance) => alliance.id === TEST_BOT_ALLIANCE_ID).length, 1);
  assert.equal(ensureTestBotAlliance(migrated, 5).alliances.length, migrated.alliances.length);
  const pending: CommandState = {
    ...withoutBot,
    applications: [{ id: 'application-9', allianceId: TEST_FIXTURE_ALLIANCE_ID, allianceName: 'x', ownerId: TEST_BOT_OWNER_ID, displayName: 'Бот 01', status: 'pending', reason: null, createdAt: 1, resolvedAt: null, resolvedByOwnerId: null }],
  };
  assert.equal(ensureTestBotAlliance(pending, 5).alliances.some((alliance) => alliance.id === TEST_BOT_ALLIANCE_ID), false);
});

test('a leader declares war at once; both sides see it; plain members cannot; no double war; survives a save', () => {
  let state = ok(declareWar(seed(), PLAYER, TEST_BOT_ALLIANCE_ID, { now: 10 }));
  const mine = selectAllianceRelations(state, TEST_FIXTURE_ALLIANCE_ID);
  const theirs = selectAllianceRelations(state, TEST_BOT_ALLIANCE_ID);
  assert.equal(mine.length, 1);
  assert.equal(mine[0].status, 'war');
  assert.equal(mine[0].id, TEST_BOT_ALLIANCE_ID);
  assert.equal(theirs[0].id, TEST_FIXTURE_ALLIANCE_ID);
  assert.equal(declareWar(state, PLAYER, TEST_BOT_ALLIANCE_ID, { now: 11 }).ok, false);
  assert.equal(declareWar(state, 'member-ira-vel', TEST_BOT_ALLIANCE_ID, { now: 11 }).ok, false, 'a plain member cannot declare war');
  assert.equal(declareWar(state, PLAYER, TEST_FIXTURE_ALLIANCE_ID, { now: 11 }).ok, false, 'not against itself');
  state = migrateCommandState(JSON.parse(JSON.stringify(state)), 'test');
  assert.equal(selectAllianceRelations(state, TEST_FIXTURE_ALLIANCE_ID)[0].since, 10);
});

test('truce: only after 3 h, the other side answers, a rejection pauses 3 h, acceptance ends the war', () => {
  let state = ok(declareWar(seed(), PLAYER, TEST_BOT_ALLIANCE_ID, { now: 0 }));
  const early = proposeTruce(state, PLAYER, TEST_BOT_ALLIANCE_ID, { now: 2 * HOUR });
  assert.equal(early.ok, false);
  assert.equal(early.ok ? 0 : early.retryAt, TRUCE_OFFER_DELAY_MS);

  state = ok(proposeTruce(state, PLAYER, TEST_BOT_ALLIANCE_ID, { now: 3 * HOUR }));
  assert.equal(selectTruceAvailability(state, TEST_FIXTURE_ALLIANCE_ID, TEST_BOT_ALLIANCE_ID, { now: 3 * HOUR }).state, 'sent');
  assert.equal(selectTruceAvailability(state, TEST_BOT_ALLIANCE_ID, TEST_FIXTURE_ALLIANCE_ID, { now: 3 * HOUR }).state, 'received');
  assert.equal(respondTruce(state, PLAYER, TEST_BOT_ALLIANCE_ID, true, { now: 3 * HOUR }).ok, false, 'the proposer cannot answer itself');

  state = ok(respondTruce(state, TEST_BOT_OWNER_ID, TEST_FIXTURE_ALLIANCE_ID, false, { now: 4 * HOUR }));
  assert.equal(selectAllianceRelations(state, TEST_FIXTURE_ALLIANCE_ID)[0].status, 'war');
  assert.equal(proposeTruce(state, PLAYER, TEST_BOT_ALLIANCE_ID, { now: 6 * HOUR }).ok, false, '3 h after a rejection');
  state = ok(proposeTruce(state, TEST_BOT_OWNER_ID, TEST_FIXTURE_ALLIANCE_ID, { now: 7 * HOUR }));
  state = ok(respondTruce(state, PLAYER, TEST_BOT_ALLIANCE_ID, true, { now: 7 * HOUR }));
  assert.equal(selectAllianceRelations(state, TEST_FIXTURE_ALLIANCE_ID).length, 0);
  assert.equal(selectAllianceRelations(state, TEST_BOT_ALLIANCE_ID).length, 0);
});

test('the Test Mode clock scale shortens the truce wait; a disbanded alliance ends the war on load', () => {
  let state = ok(declareWar(seed(), PLAYER, TEST_BOT_ALLIANCE_ID, { now: 0 }));
  assert.equal(proposeTruce(state, PLAYER, TEST_BOT_ALLIANCE_ID, { now: HOUR / 100, elapsedScale: 300 }).ok, true);
  state = { ...state, alliances: state.alliances.filter((alliance) => alliance.id !== TEST_BOT_ALLIANCE_ID) };
  assert.equal(migrateCommandState(state, 'production').diplomacy.length, 0);
});

test('emblem constructor keeps old emblems unchanged and validates new parts; tag suggestion from the name', () => {
  assert.deepEqual(normalizeEmblem({ glyph: 'orbit', accent: 'amber' }), { glyph: 'orbit', accent: 'amber' });
  assert.deepEqual(
    normalizeEmblem({ glyph: 'crown', accent: 'silver', shape: 'hex', field: 'stars', fieldColor: 'royal' }),
    { glyph: 'crown', accent: 'silver', shape: 'hex', field: 'stars', fieldColor: 'royal' },
  );
  assert.deepEqual(normalizeEmblem({ glyph: 'nope', accent: 'nope', shape: 'x' }), { glyph: 'starforge', accent: 'cyan' });
  assert.equal(suggestAllianceTag('Содружество Гелион'), 'SG');
  assert.equal(suggestAllianceTag('Северный Пояс Ориона'), 'SPO');
  assert.equal(suggestAllianceTag('Авангард'), 'AVA');
  assert.equal(suggestAllianceTag('Iron Fleet'), 'IF');
});
