// Campaign storage of the cloud server (docs/reports/CLOUD_WORLD_2026-10-30.md).
//
//   <data>/campaigns/<id>/campaign.json     metadata: head revision, snapshots, live world
//   <data>/campaigns/<id>/snap-<n>.json.gz  one gzip save per snapshot (the client's exact text)
//
// Every upload and every world the server hands back is a numbered revision;
// revisions form one line (an upload names the revision it continues). A live
// world stopped without being handed back (the client went its own way) and
// the head a forced upload replaced are kept as backups next to them. Old
// snapshots rotate out by count per campaign and by total size on disk.
import fs from 'node:fs';
import path from 'node:path';

export const CAMPAIGN_ID = /^slot-[a-z0-9-]{1,40}$/;

export type SnapshotKind = 'revision' | 'backup';
export type SnapshotOrigin = 'client' | 'server';

export type Snapshot = {
  /** Unique per campaign; revisions use their revision number. */
  id: number;
  kind: SnapshotKind;
  revision: number;
  /** The revision this one continues (0: the first upload). */
  parent: number;
  origin: SnapshotOrigin;
  savedAt: number;
  /** Replay cursor of the world (game time it has been lived to). */
  worldAt: number;
  gameVersion: string;
  schemaVersion: number;
  deviceId: string;
  /** Uploaded with «the player left»: the server keeps it alive. */
  left: boolean;
  /** sha256 of the uncompressed save text. */
  digest: string;
  bytes: number;
  gzBytes: number;
  note?: string;
};

export type LiveStatus = 'running' | 'paused' | 'waiting-version' | 'failed';

export type LiveWorld = {
  status: LiveStatus;
  /** The revision the world was left at and continues. */
  baseRevision: number;
  gameVersion: string;
  startedAt: number;
  clockOffsetMs: number;
  /** Replay cursor of the newest state the runner reported. */
  worldAt: number;
  /** Wall time of that report. */
  reportedAt: number;
  /** The last checkpoint written to disk (null until the first one). */
  checkpointWorldAt: number | null;
  /** npcReplay of the left save (the summary the absence started with). */
  leftReplay?: unknown;
  error?: string;
};

export type Campaign = {
  version: 1;
  id: string;
  name: string;
  createdAt: number;
  head: number;
  nextSnapshotId: number;
  snapshots: Snapshot[];
  live: LiveWorld | null;
};

export type RetentionPolicy = {
  /** Snapshots kept per campaign (head and the live world's base always stay). */
  maxSnapshotsPerCampaign: number;
  /** Total gzip bytes of all snapshots. */
  maxTotalBytes: number;
  /** Rotation also starts when the disk has less free space than this. */
  minFreeBytes: number;
};

export const DEFAULT_RETENTION: RetentionPolicy = {
  maxSnapshotsPerCampaign: 40,
  maxTotalBytes: 30 * 1024 ** 3,
  minFreeBytes: 10 * 1024 ** 3,
};

export function campaignDir(dataDir: string, id: string): string {
  if (!CAMPAIGN_ID.test(id)) throw new Error('Invalid campaign id.');
  return path.join(dataDir, 'campaigns', id);
}

export function snapshotFile(dataDir: string, id: string, snapshotId: number): string {
  return path.join(campaignDir(dataDir, id), `snap-${snapshotId}.json.gz`);
}

export function liveCheckpointFile(dataDir: string, id: string): string {
  return path.join(campaignDir(dataDir, id), 'live-checkpoint.json.gz');
}

function writeJsonAtomic(file: string, value: unknown): void {
  const temporary = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(temporary, JSON.stringify(value, null, 1));
  fs.renameSync(temporary, file);
}

export function readCampaign(dataDir: string, id: string): Campaign | null {
  try {
    return JSON.parse(fs.readFileSync(path.join(campaignDir(dataDir, id), 'campaign.json'), 'utf8')) as Campaign;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

export function writeCampaign(dataDir: string, campaign: Campaign): void {
  fs.mkdirSync(campaignDir(dataDir, campaign.id), { recursive: true });
  writeJsonAtomic(path.join(campaignDir(dataDir, campaign.id), 'campaign.json'), campaign);
}

export function listCampaigns(dataDir: string): Campaign[] {
  let names: string[] = [];
  try { names = fs.readdirSync(path.join(dataDir, 'campaigns')); } catch { return []; }
  return names.filter((name) => CAMPAIGN_ID.test(name)).flatMap((name) => {
    try { return [readCampaign(dataDir, name)].filter((value): value is Campaign => Boolean(value)); } catch { return []; }
  });
}

export function headSnapshot(campaign: Campaign): Snapshot | null {
  return campaign.snapshots.find((snapshot) => snapshot.kind === 'revision' && snapshot.revision === campaign.head) ?? null;
}

export function createCampaign(id: string, name: string, now: number): Campaign {
  return { version: 1, id, name: name.slice(0, 60) || 'Кампания', createdAt: now, head: 0, nextSnapshotId: 1, snapshots: [], live: null };
}

export type UploadCheck =
  | { ok: true }
  | { ok: false; status: 409; code: 'stale-base' | 'ahead-of-server'; head: number };

/**
 * An upload continues the head (or is the first one). Anything else would
 * fork the campaign silently; the client asks the player instead and sends
 * `force` only after the player chose the local world.
 */
export function checkUpload(campaign: Campaign | null, baseRevision: number, force: boolean): UploadCheck {
  const head = campaign?.head ?? 0;
  if (force || baseRevision === head) return { ok: true };
  return { ok: false, status: 409, code: baseRevision > head ? 'ahead-of-server' : 'stale-base', head };
}

/** Adds a stored snapshot file (already at snapshotFile(..., id)) to the metadata. */
export function addSnapshot(campaign: Campaign, snapshot: Omit<Snapshot, 'id' | 'revision'> & { revision?: number }): { campaign: Campaign; snapshot: Snapshot } {
  const id = campaign.nextSnapshotId;
  const revision = snapshot.kind === 'revision' ? campaign.head + 1 : (snapshot.revision ?? campaign.head);
  const stored: Snapshot = { ...snapshot, id, revision };
  return {
    campaign: {
      ...campaign,
      nextSnapshotId: id + 1,
      head: snapshot.kind === 'revision' ? revision : campaign.head,
      snapshots: [...campaign.snapshots, stored],
    },
    snapshot: stored,
  };
}

/** Snapshot ids no rotation may remove: the head and the live world's base. */
export function protectedSnapshots(campaign: Campaign): Set<number> {
  const keep = new Set<number>();
  const head = headSnapshot(campaign);
  if (head) keep.add(head.id);
  if (campaign.live) {
    const base = campaign.snapshots.find((snapshot) => snapshot.kind === 'revision' && snapshot.revision === campaign.live!.baseRevision);
    if (base) keep.add(base.id);
  }
  return keep;
}

/**
 * Which snapshots to delete: first everything over the per-campaign count
 * (oldest first), then the oldest snapshots of all campaigns until the total
 * fits the size budget and the disk keeps its free reserve.
 */
export function planRotation(campaigns: readonly Campaign[], policy: RetentionPolicy, freeBytes: number): Array<{ campaignId: string; snapshotId: number }> {
  const doomed: Array<{ campaignId: string; snapshotId: number; savedAt: number; gzBytes: number }> = [];
  const remaining: Array<{ campaignId: string; snapshotId: number; savedAt: number; gzBytes: number }> = [];
  let total = 0;
  for (const campaign of campaigns) {
    const keep = protectedSnapshots(campaign);
    const removable = campaign.snapshots.filter((snapshot) => !keep.has(snapshot.id)).sort((left, right) => left.savedAt - right.savedAt || left.id - right.id);
    const overCount = Math.max(0, campaign.snapshots.length - policy.maxSnapshotsPerCampaign);
    removable.forEach((snapshot, index) => {
      const entry = { campaignId: campaign.id, snapshotId: snapshot.id, savedAt: snapshot.savedAt, gzBytes: snapshot.gzBytes };
      if (index < overCount) doomed.push(entry);
      else remaining.push(entry);
    });
    for (const snapshot of campaign.snapshots) total += snapshot.gzBytes;
  }
  for (const entry of doomed) {
    total -= entry.gzBytes;
    freeBytes += entry.gzBytes;
  }
  remaining.sort((left, right) => left.savedAt - right.savedAt || left.snapshotId - right.snapshotId);
  for (const entry of remaining) {
    if (total <= policy.maxTotalBytes && freeBytes >= policy.minFreeBytes) break;
    doomed.push(entry);
    total -= entry.gzBytes;
    freeBytes += entry.gzBytes;
  }
  return doomed.map(({ campaignId, snapshotId }) => ({ campaignId, snapshotId }));
}

export function removeSnapshots(campaign: Campaign, snapshotIds: ReadonlySet<number>): Campaign {
  return { ...campaign, snapshots: campaign.snapshots.filter((snapshot) => !snapshotIds.has(snapshot.id)) };
}

/** What the client sees of a campaign (no file paths). */
export function describeCampaign(campaign: Campaign, now: number) {
  const head = headSnapshot(campaign);
  return {
    id: campaign.id,
    name: campaign.name,
    createdAt: campaign.createdAt,
    head: head ? publicSnapshot(head) : null,
    live: campaign.live ? {
      status: campaign.live.status,
      baseRevision: campaign.live.baseRevision,
      gameVersion: campaign.live.gameVersion,
      startedAt: campaign.live.startedAt,
      worldAt: campaign.live.worldAt,
      reportedAt: campaign.live.reportedAt,
      lagMs: campaign.live.status === 'running' ? Math.max(0, now + campaign.live.clockOffsetMs - campaign.live.worldAt) : null,
      ...(campaign.live.error ? { error: campaign.live.error } : {}),
    } : null,
    snapshots: [...campaign.snapshots].sort((left, right) => right.id - left.id).map(publicSnapshot),
  };
}

export type PublicCampaign = ReturnType<typeof describeCampaign>;

function publicSnapshot(snapshot: Snapshot) {
  const { id, kind, revision, parent, origin, savedAt, worldAt, gameVersion, schemaVersion, deviceId, left, digest, bytes, gzBytes, note } = snapshot;
  return { id, kind, revision, parent, origin, savedAt, worldAt, gameVersion, schemaVersion, deviceId, left, digest, bytes, gzBytes, ...(note ? { note } : {}) };
}
