// Entry rules of the cloud relay: take the server's world only when it
// continues exactly the save on this computer; ask whenever either side could
// lose progress; otherwise play locally as before.
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  decideCloudEntry, saveSchemaVersion, saveWorldAt, sha256Text,
  type CloudCampaignView, type CloudEntryInput, type CloudSnapshotView,
} from './cloud-sync.ts';
import { createHash } from 'node:crypto';

const ME = 'device-mine-0001';
const OTHER = 'device-other-0002';

function snapshot(revision: number, extra: Partial<CloudSnapshotView> = {}): CloudSnapshotView {
  return {
    id: revision, kind: 'revision', revision, parent: revision - 1, origin: 'client', savedAt: 1_000 + revision, worldAt: 500 + revision,
    gameVersion: '1.1.0', schemaVersion: 28, deviceId: ME, left: true, digest: `d${revision}`, bytes: 1, gzBytes: 1, ...extra,
  };
}

function campaign(head: CloudSnapshotView, live: Partial<NonNullable<CloudCampaignView['live']>> | null = null): CloudCampaignView {
  return {
    id: 'slot-a', name: 'A', createdAt: 0, head, snapshots: [head],
    live: live ? { status: 'running', baseRevision: head.revision, gameVersion: '1.1.0', startedAt: 0, worldAt: 900, reportedAt: 0, lagMs: 0, ...live } : null,
  };
}

const input = (overrides: Partial<CloudEntryInput>): CloudEntryInput => ({
  localDigest: 'local', localSavedAt: 1_000, record: { revision: 3, digest: 'local', syncedAt: 1 }, campaign: null,
  appVersion: '1.1.0', deviceId: ME, schemaVersion: 28, ...overrides,
});

test('apply: the server keeps alive exactly the save on this computer, same version', () => {
  assert.deepEqual(decideCloudEntry(input({ campaign: campaign(snapshot(3), {}) })), { action: 'claim', baseRevision: 3 });
});

test('do not apply: another game version computed the living world (it stops, the client catches up itself)', () => {
  assert.deepEqual(decideCloudEntry(input({ campaign: campaign(snapshot(3), { gameVersion: '1.0.9' }) })),
    { action: 'local', reason: 'version-mismatch', release: true });
  assert.deepEqual(decideCloudEntry(input({ campaign: campaign(snapshot(3), { status: 'waiting-version' }) })),
    { action: 'local', reason: 'waiting-version', release: true });
});

test('do not apply: the local save changed after the upload (played offline) — local is newer, server world stops', () => {
  assert.deepEqual(decideCloudEntry(input({ localDigest: 'changed', campaign: campaign(snapshot(3), {}) })),
    { action: 'local', reason: 'local-newer', release: true });
  assert.deepEqual(decideCloudEntry(input({ localDigest: 'changed', campaign: campaign(snapshot(3)) })),
    { action: 'local', reason: 'local-newer', release: false });
});

test('nothing on the server, or the same save: local', () => {
  assert.deepEqual(decideCloudEntry(input({ campaign: null })), { action: 'local', reason: 'not-on-server', release: false });
  assert.deepEqual(decideCloudEntry(input({ campaign: campaign(snapshot(3)) })), { action: 'local', reason: 'same', release: false });
});

test('ask: both sides changed, an unsynced local copy, a server behind this computer, another computer still playing', () => {
  assert.deepEqual(decideCloudEntry(input({ localDigest: 'changed', campaign: campaign(snapshot(5)) })), { action: 'ask', reason: 'diverged' });
  assert.deepEqual(decideCloudEntry(input({ record: null, campaign: campaign(snapshot(1)) })), { action: 'ask', reason: 'unknown-local' });
  assert.deepEqual(decideCloudEntry(input({ campaign: campaign(snapshot(2)) })), { action: 'ask', reason: 'server-behind' });
  assert.deepEqual(decideCloudEntry(input({ campaign: campaign(snapshot(4, { left: false, deviceId: OTHER })) })), { action: 'ask', reason: 'other-device' });
});

test('newer revision continuing this unchanged save: download it, or take its living world', () => {
  assert.deepEqual(decideCloudEntry(input({ campaign: campaign(snapshot(5, { deviceId: OTHER, left: true })) })),
    { action: 'download', snapshotId: 5, revision: 5, release: false });
  assert.deepEqual(decideCloudEntry(input({ campaign: campaign(snapshot(4, { origin: 'server', deviceId: 'server', left: true })) })),
    { action: 'download', snapshotId: 4, revision: 4, release: false }, 'a living world finished into a revision (another campaign was left)');
  assert.deepEqual(decideCloudEntry(input({ campaign: campaign(snapshot(5, { deviceId: OTHER }), {}) })), { action: 'claim', baseRevision: 5 });
  assert.deepEqual(decideCloudEntry(input({ campaign: campaign(snapshot(5, { deviceId: OTHER }), { gameVersion: '1.0.0' }) })),
    { action: 'download', snapshotId: 5, revision: 5, release: true }, 'another version lives it: its base is taken, the world stops');
  assert.deepEqual(decideCloudEntry(input({ campaign: campaign(snapshot(5, { deviceId: OTHER, schemaVersion: 99 })) })),
    { action: 'local', reason: 'schema-newer', release: false });
});

test('second computer without a local save: take the server copy', () => {
  assert.deepEqual(decideCloudEntry(input({ localDigest: null, record: null, campaign: campaign(snapshot(7), {}) })), { action: 'claim', baseRevision: 7 });
  assert.deepEqual(decideCloudEntry(input({ localDigest: null, record: null, campaign: campaign(snapshot(7)) })),
    { action: 'download', snapshotId: 7, revision: 7, release: false });
  assert.deepEqual(decideCloudEntry(input({ localDigest: null, record: null, campaign: campaign(snapshot(7), { gameVersion: '2.0.0' }) })),
    { action: 'download', snapshotId: 7, revision: 7, release: true });
});

test('digests and save fields read without parsing the save', async () => {
  const text = '{"schemaVersion":28,"npc":{},"npcReplay":{"version":1,"processedThroughAt":1767312000000,"targetAt":1767312000000},"x":"Привет"}';
  assert.equal(await sha256Text(text), createHash('sha256').update(text, 'utf8').digest('hex'), 'the renderer digest is the server digest');
  assert.equal(saveWorldAt(text), 1767312000000);
  assert.equal(saveSchemaVersion(text), 28);
  assert.equal(saveWorldAt('{"resourceClock":{"lastReconciledAt":123.5}}'), 123);
});
