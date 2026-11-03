// Entry rules of the cloud relay: take the server's world only when it
// continues exactly the save on this computer; ask whenever either side could
// lose progress; otherwise play locally as before.
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  compareGameVersions, decideCloudEntry, describeLocalReason, describeServerStall, saveSchemaVersion, SERVER_CATCHUP_WAIT_LAG_MS, SERVER_UPDATE_QUIET_MS, saveWorldAt, sha256Text, waitPresentation,
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

test('another game version lives the world: wait for the server to move it (older) or for the game update (newer)', () => {
  assert.deepEqual(decideCloudEntry(input({ campaign: campaign(snapshot(3), { gameVersion: '1.0.9' }) })),
    { action: 'wait', reason: 'server-updating', baseRevision: 3 }, 'the game is newer than the server: the server moves the world, nothing is thrown away');
  assert.deepEqual(decideCloudEntry(input({ campaign: campaign(snapshot(3), { status: 'waiting-version' }) })),
    { action: 'wait', reason: 'server-updating', baseRevision: 3 });
  assert.deepEqual(decideCloudEntry(input({ campaign: campaign(snapshot(3), { gameVersion: '1.2.0' }) })),
    { action: 'wait', reason: 'game-older', baseRevision: 3 });
  // «Досчитать на этом ПК»: the old local path, the server world kept as a backup.
  assert.deepEqual(decideCloudEntry(input({ takeNow: true, campaign: campaign(snapshot(3), { gameVersion: '1.0.9' }) })),
    { action: 'local', reason: 'version-mismatch', release: true });
  assert.deepEqual(decideCloudEntry(input({ takeNow: true, campaign: campaign(snapshot(3), { status: 'waiting-version' }) })),
    { action: 'local', reason: 'waiting-version', release: true });
  assert.equal(compareGameVersions('1.10.0', '1.9.3'), 1);
  assert.equal(compareGameVersions('1.0.2', '1.1.0'), -1);
  assert.equal(compareGameVersions('1.1.0', '1.1.0'), 0);
});

test('a world still catching up on the server stays there: no claim until it is within the threshold', () => {
  const behind = campaign(snapshot(3), { lagMs: 19 * 3_600_000 });
  assert.deepEqual(decideCloudEntry(input({ campaign: behind })), { action: 'wait', reason: 'catching-up', baseRevision: 3 });
  assert.deepEqual(decideCloudEntry(input({ campaign: campaign(snapshot(3), { lagMs: SERVER_CATCHUP_WAIT_LAG_MS }) })), { action: 'claim', baseRevision: 3 });
  assert.deepEqual(decideCloudEntry(input({ campaign: campaign(snapshot(3), { lagMs: SERVER_CATCHUP_WAIT_LAG_MS + 1 }) })),
    { action: 'wait', reason: 'catching-up', baseRevision: 3 });
  assert.deepEqual(decideCloudEntry(input({ takeNow: true, campaign: behind })), { action: 'claim', baseRevision: 3 }, '«Досчитать на этом ПК» claims now');
  assert.deepEqual(decideCloudEntry(input({ campaign: campaign(snapshot(3), { status: 'paused', lagMs: null }) })), { action: 'claim', baseRevision: 3 },
    'a paused world does not move on the server: nothing to wait for');
  assert.deepEqual(decideCloudEntry(input({ localDigest: null, record: null, campaign: behind })), { action: 'wait', reason: 'catching-up', baseRevision: 3 },
    'a second computer waits too');
  assert.deepEqual(decideCloudEntry(input({ campaign: campaign(snapshot(5, { deviceId: OTHER }), { lagMs: 3_600_000 }) })),
    { action: 'wait', reason: 'catching-up', baseRevision: 5 }, 'a world living on a newer revision of this save');
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
  assert.deepEqual(decideCloudEntry(input({ takeNow: true, campaign: campaign(snapshot(5, { deviceId: OTHER }), { gameVersion: '1.0.0' }) })),
    { action: 'download', snapshotId: 5, revision: 5, release: true }, 'another version lives it and the player goes on here: its base is taken, the world stops');
  assert.deepEqual(decideCloudEntry(input({ campaign: campaign(snapshot(5, { deviceId: OTHER, schemaVersion: 99 })) })),
    { action: 'local', reason: 'schema-newer', release: false });
});

test('second computer without a local save: take the server copy', () => {
  assert.deepEqual(decideCloudEntry(input({ localDigest: null, record: null, campaign: campaign(snapshot(7), {}) })), { action: 'claim', baseRevision: 7 });
  assert.deepEqual(decideCloudEntry(input({ localDigest: null, record: null, campaign: campaign(snapshot(7)) })),
    { action: 'download', snapshotId: 7, revision: 7, release: false });
  assert.deepEqual(decideCloudEntry(input({ localDigest: null, record: null, campaign: campaign(snapshot(7), { gameVersion: '2.0.0' }) })),
    { action: 'wait', reason: 'game-older', baseRevision: 7 });
  assert.deepEqual(decideCloudEntry(input({ takeNow: true, localDigest: null, record: null, campaign: campaign(snapshot(7), { gameVersion: '2.0.0' }) })),
    { action: 'download', snapshotId: 7, revision: 7, release: true });
});

test('digests and save fields read without parsing the save', async () => {
  const text = '{"schemaVersion":28,"npc":{},"npcReplay":{"version":1,"processedThroughAt":1767312000000,"targetAt":1767312000000},"x":"Привет"}';
  assert.equal(await sha256Text(text), createHash('sha256').update(text, 'utf8').digest('hex'), 'the renderer digest is the server digest');
  assert.equal(saveWorldAt(text), 1767312000000);
  assert.equal(saveSchemaVersion(text), 28);
  assert.equal(saveWorldAt('{"resourceClock":{"lastReconciledAt":123.5}}'), 123);
});

const stalled = { stalledAt: Date.UTC(2026, 10, 2, 9, 30), stalledWorldAt: 700, restarts: 1 };

test('a world that stopped on the server: waiting out the pause, given up on, or raised again', () => {
  // The server waits out a pause before its next attempt: the game waits for it, however small the lag looks.
  const pause = campaign(snapshot(3), { lagMs: 10_000, recovery: { ...stalled, nextAttemptAt: Date.now() + 5_000 } });
  assert.deepEqual(decideCloudEntry(input({ campaign: pause })), { action: 'wait', reason: 'catching-up', baseRevision: 3 });
  // Raised again and caught up: the game takes it like any other world.
  const raised = campaign(snapshot(3), { lagMs: 0, recovery: { ...stalled, recoveredAt: stalled.stalledAt + 60_000 } });
  assert.deepEqual(decideCloudEntry(input({ campaign: raised })), { action: 'claim', baseRevision: 3 });
  // Given up on: nothing to take, this computer goes on from its own save and the server world stays a backup.
  const failed = campaign(snapshot(3), { status: 'failed', recovery: stalled, error: 'x' });
  assert.deepEqual(decideCloudEntry(input({ campaign: failed })), { action: 'local', reason: 'server-failed', release: true });
  assert.deepEqual(decideCloudEntry(input({ takeNow: true, campaign: failed })), { action: 'local', reason: 'server-failed', release: true });
  // A second computer without the campaign downloads the base copy and releases the failed world.
  assert.deepEqual(decideCloudEntry(input({ localDigest: null, record: null, campaign: failed })), { action: 'download', snapshotId: 3, revision: 3, release: true });
});

test('the stall line is calm: when it stopped and what happened, no technical details; nothing when all was well', () => {
  assert.equal(describeServerStall(campaign(snapshot(3), { lagMs: 0 }).live, 'took-server'), null, 'no recovery, no line');
  assert.equal(describeServerStall(null, 'local'), null);
  const raised = campaign(snapshot(3), { recovery: { ...stalled, recoveredAt: stalled.stalledAt + 60_000 } }).live;
  assert.match(describeServerStall(raised, 'took-server')!, /^Мир на сервере стоял с .+, затем сервер продолжил его сам\. Игра взяла мир сервера\.$/);
  assert.match(describeServerStall(raised, 'waiting')!, /сервер продолжил его сам и теперь догоняет время/);
  const pause = campaign(snapshot(3), { recovery: { ...stalled, nextAttemptAt: 1 } }).live;
  assert.match(describeServerStall(pause, 'waiting')!, /Сервер продолжит его сам через несколько минут, ничего не потеряно/);
  const failed = campaign(snapshot(3), { status: 'failed', error: 'Расчёт мира дважды остановился: «boom #»', recovery: stalled });
  const text = describeLocalReason('server-failed', failed);
  assert.match(text, /Игра досчитала время сама по сохранению этого компьютера/);
  for (const line of [text, describeServerStall(raised, 'took-server')!, describeServerStall(pause, 'waiting')!]) {
    assert.doesNotMatch(line, /boom|runner|stack|ошибк|checkpoint|контрольн/i, 'no error text, no jargon');
  }
  // A failed world from an older server (no recovery details) still gets a line, dated by its last report.
  assert.match(describeLocalReason('server-failed', campaign(snapshot(3), { status: 'failed' })), /Мир на сервере стоял с/);
});

test('server behind the game: silent wait, then the plain choice after the quiet window', () => {
  const behind = campaign(snapshot(3), { gameVersion: '1.0.9' }).live;
  const wait = (waitedMs: number, live = behind) => waitPresentation({ reason: 'server-updating', waitedMs, live });
  assert.equal(wait(0), 'quiet', 'a routine update is not shown as a decision');
  assert.equal(wait(SERVER_UPDATE_QUIET_MS - 1), 'quiet');
  assert.equal(wait(SERVER_UPDATE_QUIET_MS), 'choice', 'unusually long: the fallback choice');
  assert.equal(wait(1_000, { ...behind!, status: 'failed' }), 'choice', 'the server reports a failure: the choice at once');
  assert.equal(wait(1_000, { ...behind!, error: 'x' }), 'choice');
  assert.equal(wait(0, null), 'quiet', 'no report yet is still a routine wait');
});

test('other waits are never silent: catching-up and a game older than the server', () => {
  const live = campaign(snapshot(3), {}).live;
  assert.equal(waitPresentation({ reason: 'catching-up', waitedMs: 0, live }), 'choice');
  assert.equal(waitPresentation({ reason: 'game-older', waitedMs: 0, live }), 'choice');
});

test('server updated and caught up: the wait ends by itself (claim)', () => {
  const entry = (live: Partial<NonNullable<CloudCampaignView['live']>>) => decideCloudEntry(input({ campaign: campaign(snapshot(3), live) }));
  assert.equal(entry({ gameVersion: '1.0.9' }).action, 'wait');
  assert.equal(entry({ gameVersion: '1.1.0', lagMs: 0 }).action, 'claim', 'new version reported and caught up: auto-open');
});

test('local-entry notices carry no version numbers', () => {
  assert.doesNotMatch(describeLocalReason('version-mismatch', campaign(snapshot(3), { gameVersion: '1.0.9' })), /\d\.\d/);
});
