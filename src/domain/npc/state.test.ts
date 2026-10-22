import assert from 'node:assert/strict';
import test from 'node:test';

import { NPC_TRAIT_NAMES, createNpcState, isNpcProfile, migrateNpcState, validateNpcState } from './state.ts';
import { NPC_STATE_VERSION, type NpcProfile, type NpcStateV1 } from './types.ts';

test('creation supports zero and one hundred owner profiles with stable owner-keyed variety', () => {
  assert.equal(Object.keys(createNpcState([], 'campaign-salt', 1_000).profiles).length, 0);
  const owners = Array.from({ length: 100 }, (_, index) => 'npc-owner-' + String(index).padStart(3, '0'));
  const first = createNpcState(owners, 'campaign-salt', 1_000);
  const reloaded = createNpcState([...owners].reverse(), 'campaign-salt', 1_000);
  assert.deepEqual(reloaded, first);
  assert.equal(Object.keys(first.profiles).length, 100);
  assert.equal(new Set(Object.keys(first.profiles)).size, 100);
  const profileSignatures = new Set(Object.values(first.profiles).map((profile) => JSON.stringify(profile.traits)));
  assert.equal(profileSignatures.size, 100, 'salted profiles vary by owner rather than list position');
  for (const [ownerId, profile] of Object.entries(first.profiles)) {
    assert.equal(profile.ownerId, ownerId);
    assert.deepEqual(Object.keys(profile.traits).sort(), [...NPC_TRAIT_NAMES].sort());
    assert.ok(Object.values(profile.traits).every((trait) => trait >= 0 && trait <= 1));
    assert.ok(profile.session.timezoneOffsetMinutes >= -720 && profile.session.timezoneOffsetMinutes <= 840);
    assert.equal(Math.abs(profile.session.timezoneOffsetMinutes % 15), 0);
    assert.ok(isNpcProfile(profile));
  }
  assert.ok(validateNpcState(first));
});

test('same public seed is irrelevant while a new private campaign salt changes profiles', () => {
  const ownerIds = ['npc-a', 'npc-b', 'npc-c', 'npc-d'];
  const oldCampaign = createNpcState(ownerIds, 'private-salt-one', 0);
  const newCampaign = createNpcState(ownerIds, 'private-salt-two', 0);
  assert.notDeepEqual(
    Object.values(newCampaign.profiles).map((profile) => profile.traits),
    Object.values(oldCampaign.profiles).map((profile) => profile.traits),
  );
});

test('v1 migration preserves saved profiles and cursors, salt, and orphan owners', () => {
  const original = createNpcState(['npc-current'], 'persisted-private-salt', 100);
  const profile = original.profiles['npc-current']!;
  const withCursor: NpcProfile = {
    ...profile,
    cursor: { at: 90, priority: 'fleet-arrival', eventId: 'arrival-1' },
    memory: [{ id: 'memory-1', kind: 'observed-battle', at: 80, valence: 0.4, salience: 0.8, factIds: ['fact-1'] }],
  };
  const saved: NpcStateV1 = {
    ...original,
    profiles: { 'npc-current': withCursor, 'npc-orphan': { ...profile, ownerId: 'npc-orphan' } },
  };
  const migrated = migrateNpcState(saved, ['npc-current', 'npc-new'], 'fallback-must-not-replace', 500);
  assert.equal(migrated.personaSalt, 'persisted-private-salt');
  assert.equal(migrated.profiles['npc-current'], withCursor, 'valid current profile stays untouched');
  assert.equal(migrated.profiles['npc-current']?.cursor?.eventId, 'arrival-1');
  assert.equal(migrated.profiles['npc-orphan']?.ownerId, 'npc-orphan');
  assert.equal(migrated.profiles['npc-new']?.ownerId, 'npc-new');
  assert.ok(validateNpcState(migrated));
});

test('absent legacy production or test state uses deterministic fallback salt and supplied saved time', () => {
  const productionMigration = migrateNpcState(undefined, ['npc-a'], 'legacy-hash-from-save', 42_000);
  const testMigration = migrateNpcState(undefined, ['npc-a'], 'legacy-hash-from-save', 42_000);
  assert.deepEqual(productionMigration, testMigration);
  assert.equal(productionMigration.personaSalt, 'legacy-hash-from-save');
  assert.equal(productionMigration.profiles['npc-a']?.activity.updatedAt, 42_000);
});

test('future and malformed v1 schemas fail closed before state regeneration', () => {
  assert.throws(() => migrateNpcState({ version: NPC_STATE_VERSION + 1 }, [], 'fallback', 0), /future NPC state version/);
  assert.throws(() => migrateNpcState(null, [], 'fallback', 0), /NPC state must be an object/);
  const valid = createNpcState(['npc-a'], 'persisted-salt', 0);
  const malformed = { ...valid, profiles: { 'npc-a': { ...valid.profiles['npc-a']!, traits: { attention: 2 } } } };
  assert.equal(validateNpcState(malformed), false);
  assert.throws(() => migrateNpcState(malformed, ['npc-a'], 'fallback', 50), /Malformed NPC state version 1/);
  assert.deepEqual(migrateNpcState(valid, ['npc-a'], '', 1), valid, 'valid saves need no fallback salt');
  assert.throws(() => createNpcState(['duplicate', 'duplicate'], 'salt', 0), /unique/);
});
