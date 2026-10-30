// Revision rules and backup rotation of the cloud store.
import assert from 'node:assert/strict';
import test from 'node:test';
import { addSnapshot, checkUpload, createCampaign, planRotation, protectedSnapshots, type Campaign } from './store.ts';

const GB = 1024 ** 3;

function campaignWith(id: string, count: number, gzBytes: number, start = 0): Campaign {
  let campaign = createCampaign(id, id, 0);
  for (let index = 0; index < count; index += 1) {
    campaign = addSnapshot(campaign, {
      kind: 'revision', parent: campaign.head, origin: 'client', savedAt: start + index, worldAt: index, gameVersion: '1.0.0', schemaVersion: 1,
      deviceId: 'device-0001', left: false, digest: 'a'.repeat(64), bytes: gzBytes * 10, gzBytes,
    }).campaign;
  }
  return campaign;
}

test('an upload continues the head; anything else needs the player\'s explicit choice', () => {
  assert.deepEqual(checkUpload(null, 0, false), { ok: true });
  const campaign = campaignWith('slot-a', 3, 1);
  assert.deepEqual(checkUpload(campaign, 3, false), { ok: true });
  assert.deepEqual(checkUpload(campaign, 2, false), { ok: false, status: 409, code: 'stale-base', head: 3 });
  assert.deepEqual(checkUpload(campaign, 4, false), { ok: false, status: 409, code: 'ahead-of-server', head: 3 });
  assert.deepEqual(checkUpload(campaign, 1, true), { ok: true });
});

test('revisions number one line; backups keep the revision they belong to', () => {
  let campaign = campaignWith('slot-a', 2, 1);
  assert.equal(campaign.head, 2);
  const backup = addSnapshot(campaign, {
    kind: 'backup', revision: 2, parent: 2, origin: 'server', savedAt: 9, worldAt: 9, gameVersion: '1.0.0', schemaVersion: 1,
    deviceId: 'server', left: false, digest: 'b'.repeat(64), bytes: 10, gzBytes: 1,
  });
  campaign = backup.campaign;
  assert.equal(campaign.head, 2, 'a backup never moves the head');
  assert.equal(backup.snapshot.revision, 2);
  assert.equal(backup.snapshot.id, 3);
});

test('rotation keeps the newest per campaign, the head and the living world\'s base', () => {
  const campaign = { ...campaignWith('slot-a', 10, 1), live: { status: 'running' as const, baseRevision: 2, gameVersion: '1.0.0', startedAt: 0, clockOffsetMs: 0, worldAt: 0, reportedAt: 0, checkpointWorldAt: null } };
  assert.deepEqual([...protectedSnapshots(campaign)].sort((x, y) => x - y), [2, 10]);
  const doomed = planRotation([campaign], { maxSnapshotsPerCampaign: 4, maxTotalBytes: 1e12, minFreeBytes: 0 }, 1e12);
  assert.deepEqual(doomed.map((entry) => entry.snapshotId), [1, 3, 4, 5, 6, 7], 'six oldest go; the base of the living world stays');
});

test('rotation by disk: oldest snapshots of every campaign go until the budget and the free reserve hold', () => {
  const a = campaignWith('slot-a', 5, GB, 0);
  const b = campaignWith('slot-b', 5, GB, 100);
  const policy = { maxSnapshotsPerCampaign: 40, maxTotalBytes: 6 * GB, minFreeBytes: 10 * GB };
  assert.deepEqual(planRotation([a, b], policy, 20 * GB).map((entry) => `${entry.campaignId}:${entry.snapshotId}`),
    ['slot-a:1', 'slot-a:2', 'slot-a:3', 'slot-a:4'], 'down to 6 GB, oldest first, heads stay');
  assert.deepEqual(planRotation([a, b], { ...policy, maxTotalBytes: 100 * GB }, 8 * GB).map((entry) => `${entry.campaignId}:${entry.snapshotId}`),
    ['slot-a:1', 'slot-a:2'], 'a full disk frees its reserve');
  assert.equal(planRotation([a, b], { ...policy, maxTotalBytes: GB }, 0).length, 8, 'never the heads, even over budget');
});
