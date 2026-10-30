/**
 * The cloud relay (docs/reports/CLOUD_WORLD_2026-10-30.md): while the player
 * is in a campaign the game computes the world; when they leave it uploads
 * the save and the server keeps that world alive; on entry the game takes the
 * server's world back if it continues exactly the save on this computer.
 * Only one side ever moves a world. These are the rules for entry; the
 * transport is electron/cloud.cjs.
 */

/** What this computer remembers of a campaign: its local save equals server revision `revision`. */
export type CloudSyncRecord = {
  revision: number;
  /** sha256 of the local save text at that moment. */
  digest: string;
  syncedAt: number;
  /** The player chose this computer's copy over a diverged server copy: the next upload replaces the head. */
  forceNext?: boolean;
};

/** The server's view of a campaign (server/src/store.ts describeCampaign). */
export type CloudSnapshotView = {
  id: number;
  kind: 'revision' | 'backup';
  revision: number;
  parent: number;
  origin: 'client' | 'server';
  savedAt: number;
  worldAt: number;
  gameVersion: string;
  schemaVersion: number;
  deviceId: string;
  left: boolean;
  digest: string;
  bytes: number;
  gzBytes: number;
  note?: string;
};

export type CloudLiveView = {
  status: 'running' | 'paused' | 'waiting-version' | 'failed';
  baseRevision: number;
  gameVersion: string;
  startedAt: number;
  worldAt: number;
  reportedAt: number;
  lagMs: number | null;
  /** Catch-up speed of the running world: game ms per wall ms (null until measured; older servers omit it). */
  rate?: number | null;
  /** Wall time until the running world reaches the clock at that speed. */
  etaMs?: number | null;
  /** The server moved the world from this game version on its last update. */
  migratedFrom?: string;
  error?: string;
};

export type CloudCampaignView = {
  id: string;
  name: string;
  createdAt: number;
  head: CloudSnapshotView | null;
  live: CloudLiveView | null;
  snapshots: CloudSnapshotView[];
};

export type CloudEntryInput = {
  /** Digest of the local save text; null when this computer has no save of the campaign. */
  localDigest: string | null;
  /** When the local save was last written (slot card). */
  localSavedAt: number | null;
  record: CloudSyncRecord | null;
  campaign: CloudCampaignView | null;
  appVersion: string;
  deviceId: string;
  /** Save schema this build reads. */
  schemaVersion: number;
  /**
   * The player chose «Досчитать на этом ПК» in the server wait: take the
   * living world now (or, when this version cannot take it, go on locally).
   */
  takeNow?: boolean;
};

/**
 * A living world further behind the clock than this is still catching up on
 * the server: the game waits for it instead of taking it and replaying the
 * rest itself. In the steady state the server's lag is 0–10 s (a step every
 * 10 s), and right after a hand-over it catches up within a minute, so the
 * normal relay never waits. What is left after a claim (≤ 2 game minutes plus
 * the transfer) replays locally in seconds even on a late world (day 3: ~4 s
 * per game minute), so waiting for a smaller lag would gain nothing.
 */
export const SERVER_CATCHUP_WAIT_LAG_MS = 2 * 60_000;

/** «1.10.0» > «1.9.3»: numeric MAJOR.MINOR.PATCH (pre-release suffixes ignored). */
export function compareGameVersions(left: string, right: string): number {
  const parts = (version: string) => version.split(/[-+]/)[0]!.split('.').map((part) => Number(part) || 0);
  const [a, b] = [parts(left), parts(right)];
  for (let index = 0; index < 3; index += 1) {
    const difference = (a[index] ?? 0) - (b[index] ?? 0);
    if (difference !== 0) return Math.sign(difference);
  }
  return 0;
}

export type CloudConflictReason =
  /** Both sides changed since they were last the same. */
  | 'diverged'
  /** This computer never synced the campaign, and the server holds a copy. */
  | 'unknown-local'
  /** The server holds an older revision than this computer synced (restored or reset server). */
  | 'server-behind'
  /** Another computer uploaded a newer revision and is still playing it. */
  | 'other-device';

export type CloudEntryDecision =
  /** The server keeps the world alive for exactly this save: take it (claim). */
  | { action: 'claim'; baseRevision: number }
  /**
   * The server has a newer revision continuing this save (another computer,
   * or a finished live world). `release`: a living world on top of it cannot
   * be taken (another game version), so it stops and this computer goes on.
   */
  | { action: 'download'; snapshotId: number; revision: number; release: boolean }
  /** Play the local save. `release`: stop the server's living world first (this computer goes on). */
  | { action: 'local'; reason: CloudLocalReason; release: boolean }
  | { action: 'ask'; reason: CloudConflictReason }
  /**
   * The world stays on the server for now and the game waits (the server
   * wait window): it is still catching up there, or the server is moving it
   * to this game's release, or it lives in a newer release than this game.
   */
  | { action: 'wait'; reason: CloudWaitReason; baseRevision: number };

export type CloudWaitReason =
  /** The world is more than SERVER_CATCHUP_WAIT_LAG_MS behind the clock and the server is catching it up. */
  | 'catching-up'
  /** The world lives in an older release than this game: the server updates and moves it (server.ts migrateLive). */
  | 'server-updating'
  /** The world lives in a newer release than this game: the game updates first. */
  | 'game-older';

export type CloudLocalReason =
  | 'not-on-server'
  | 'same'
  | 'local-newer'
  | 'version-mismatch'
  | 'schema-newer'
  | 'waiting-version';

/** The server world as of now: the living one, or the head revision. */
export function serverWorldAt(campaign: CloudCampaignView): number {
  return campaign.live ? Math.max(campaign.live.worldAt, campaign.head?.worldAt ?? 0) : campaign.head?.worldAt ?? 0;
}

/**
 * Entry rules. A world from the server is taken only when it continues the
 * very save on this computer (unchanged since it was uploaded or downloaded)
 * and, for a living world, was computed by this game version. Anything that
 * could lose either side's progress asks the player.
 */
export function decideCloudEntry(input: CloudEntryInput): CloudEntryDecision {
  const { campaign, record, localDigest } = input;
  const head = campaign?.head ?? null;
  if (!campaign || !head) return { action: 'local', reason: 'not-on-server', release: false };
  const live = campaign.live;
  const unchanged = record !== null && localDigest !== null && localDigest === record.digest;
  if (localDigest === null) {
    // Nothing here to lose: a second computer opens the server copy.
    if (live && live.baseRevision === head.revision) {
      const taken = claimOrLocal(input, head.revision, live);
      if (taken.action === 'claim' || taken.action === 'wait') return taken;
    }
    return head.schemaVersion > input.schemaVersion
      ? { action: 'local', reason: 'schema-newer', release: false }
      : { action: 'download', snapshotId: head.id, revision: head.revision, release: Boolean(live) };
  }
  if (!record) return { action: 'ask', reason: 'unknown-local' };
  if (head.revision < record.revision) return { action: 'ask', reason: 'server-behind' };
  if (!unchanged) {
    // This computer played on (offline, or the server was unreachable on entry).
    if (head.revision === record.revision) return { action: 'local', reason: 'local-newer', release: Boolean(live) };
    return { action: 'ask', reason: 'diverged' };
  }
  if (head.revision === record.revision) {
    if (live && live.baseRevision === head.revision) return claimOrLocal(input, head.revision, live);
    return { action: 'local', reason: 'same', release: false };
  }
  // The server moved on from exactly this save.
  if (!head.left && head.origin === 'client' && head.deviceId !== input.deviceId) return { action: 'ask', reason: 'other-device' };
  if (head.schemaVersion > input.schemaVersion) return { action: 'local', reason: 'schema-newer', release: false };
  if (live && live.baseRevision === head.revision) {
    // A world living on top of that newer revision: taken if this version computed it, else its base is.
    const taken = claimOrLocal(input, head.revision, live);
    return taken.action === 'claim' || taken.action === 'wait' ? taken : { action: 'download', snapshotId: head.id, revision: head.revision, release: true };
  }
  return { action: 'download', snapshotId: head.id, revision: head.revision, release: false };
}

/**
 * A living world is taken only by the game version it lives in and once it
 * has (nearly) reached the clock; until then the game waits and the world
 * stays on the server. Only the player's explicit «Досчитать на этом ПК»
 * (`takeNow`) takes a world that is still catching up, or, across versions,
 * stops it (a server backup) and goes on locally as before.
 */
function claimOrLocal(input: CloudEntryInput, baseRevision: number, live: CloudLiveView): CloudEntryDecision {
  const order = compareGameVersions(live.gameVersion, input.appVersion);
  if (order !== 0 || live.status === 'waiting-version') {
    if (input.takeNow) return { action: 'local', reason: order === 0 ? 'waiting-version' : 'version-mismatch', release: true };
    return { action: 'wait', reason: order > 0 ? 'game-older' : 'server-updating', baseRevision };
  }
  if (!input.takeNow && live.status === 'running' && (live.lagMs ?? 0) > SERVER_CATCHUP_WAIT_LAG_MS) {
    return { action: 'wait', reason: 'catching-up', baseRevision };
  }
  return { action: 'claim', baseRevision };
}

/** Player-facing line for a local entry the server did not take part in. */
export function describeLocalReason(reason: CloudLocalReason, campaign: CloudCampaignView | null): string {
  switch (reason) {
    case 'not-on-server': return 'Кампании ещё нет на сервере: она будет выгружена при выходе.';
    case 'same': return 'Мир на сервере совпадает с этим компьютером.';
    case 'local-newer': return 'На этом компьютере мир новее серверного: продолжаем его, сервер получит копию.';
    case 'version-mismatch': return `Мир на сервере прожит версией ${campaign?.live?.gameVersion ?? '?'}, у вас другая: досчитываем локально.`;
    case 'schema-newer': return 'Копия на сервере создана более новой версией игры: продолжаем локальную.';
    case 'waiting-version': return 'Сервер ещё не обновился до вашей версии: досчитываем локально.';
    default: return '';
  }
}

export function describeConflict(reason: CloudConflictReason): string {
  switch (reason) {
    case 'diverged': return 'После последней синхронизации кампания менялась и здесь, и на сервере.';
    case 'unknown-local': return 'Этот компьютер ещё не синхронизировал кампанию, а на сервере уже есть её копия.';
    case 'server-behind': return 'На сервере более старая копия, чем была синхронизирована с этим компьютером.';
    case 'other-device': return 'Кампания сейчас открыта на другом компьютере (последняя выгрузка без выхода из игры).';
    default: return '';
  }
}

/** Page clock minus wall clock, as App passes it to the catch-up worker (0 in the game; QA moves the page clock). */
export function pageClockOffsetMs(): number {
  if (typeof performance === 'undefined') return 0;
  return Math.round((Date.now() - (performance.timeOrigin + performance.now())) / 60_000) * 60_000;
}

/** sha256 hex of UTF-8 text (the digest the server and electron/cloud.cjs compute). */
export async function sha256Text(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** Replay cursor of a save text without parsing tens of megabytes. */
export function saveWorldAt(text: string): number {
  const match = /"npcReplay":\{"version":1,"processedThroughAt":(\d+)/.exec(text);
  if (match) return Number(match[1]);
  const clock = /"lastReconciledAt":(\d+(?:\.\d+)?)/.exec(text);
  return clock ? Math.floor(Number(clock[1])) : 0;
}

export function saveSchemaVersion(text: string): number {
  const match = /"schemaVersion":(\d+)/.exec(text.slice(0, 4096)) ?? /"schemaVersion":(\d+)/.exec(text);
  return match ? Number(match[1]) : 0;
}
