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
  /** The server's world runner stopped and was raised again (or was given up on): when, no technical details (server/src/store.ts publicRecovery). */
  recovery?: {
    /** Wall time the world stopped. */
    stalledAt: number;
    stalledWorldAt: number;
    restarts: number;
    /** Wall time a new runner took the world over again. */
    recoveredAt?: number;
    /** The server is waiting out a pause before its next attempt. */
    nextAttemptAt?: number;
  };
};

export type CloudCampaignView = {
  id: string;
  name: string;
  createdAt: number;
  head: CloudSnapshotView | null;
  live: CloudLiveView | null;
  /** The computer that is playing the campaign and how long ago its game last reported (older servers omit it). */
  lease?: { deviceId: string; ageMs: number } | null;
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
  /** Game time the local save was lived to (null: no local save). */
  localWorldAt?: number | null;
};

/**
 * The server's lease (server.ts): a game that played this campaign and then
 * went silent for CLOUD_LEASE_MS (power cut, sleep, crash, no network) loses
 * the world to the server, which carries on from the last uploaded revision.
 * The game reports every CLOUD_HEARTBEAT_EVERY_MS, so a lease survives four
 * missed reports of a flaky connection, yet a night off is never idle. A
 * takeover that came too early costs nothing: the game that is still there
 * uploads its own save, which wins over the server's world (kept as a backup).
 */
export const CLOUD_LEASE_MS = 5 * 60_000;
export const CLOUD_HEARTBEAT_EVERY_MS = 60_000;

/**
 * Orders a power cut can lose are the ones given after the last upload; the
 * game uploads every CLOUD_UPLOAD_EVERY_MS (a save is ~3 MB compressed).
 */
export const CLOUD_UPLOAD_EVERY_MS = 3 * 60_000;

/**
 * A local save that played on past the last upload by more than this holds
 * orders the server never saw: it is kept as a copy before the server's world
 * replaces it.
 */
export const LOCAL_COPY_MIN_MS = 30_000;

/**
 * More than this of play past the last upload is not the tail of a cut-off
 * session (that is at most a few upload periods) but real offline play: the
 * player decides which world goes on.
 */
export const LOCAL_UNSYNCED_MAX_MS = 15 * 60_000;

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

/**
 * A server that is only behind this game's version updates itself within a
 * minute or so (asterion-update.timer); the player is not asked anything
 * until it takes unusually long.
 */
export const SERVER_UPDATE_QUIET_MS = 2 * 60_000;

/**
 * How the server wait is shown: `quiet` is one calm line on the normal loading
 * screen (the game opens the world by itself), `choice` is the plain-language
 * decision with «Досчитать на этом ПК». Only a routine server update stays
 * quiet, and only until it takes too long or the server reports a failure.
 */
export type CloudWaitPresentation = 'quiet' | 'choice';

export function waitPresentation(input: {
  reason: CloudWaitReason;
  /** Wall time since the wait began. */
  waitedMs: number;
  live: CloudLiveView | null;
}):CloudWaitPresentation {
  if (input.reason !== 'server-updating') return 'choice';
  if (input.live?.status === 'failed' || input.live?.error) return 'choice';
  if (input.waitedMs >= SERVER_UPDATE_QUIET_MS) return 'choice';
  return 'quiet';
}

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
  | { action: 'claim'; baseRevision: number; keepLocalCopy?: boolean }
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
  | 'waiting-version'
  /** The world on the server stopped for good (its runner kept failing): the game goes on from this computer's save. */
  | 'server-failed';

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
  // Another computer's game is still reporting: this one never takes the campaign from under it.
  if (!live && campaign.lease && campaign.lease.deviceId !== input.deviceId && campaign.lease.ageMs < CLOUD_LEASE_MS) return { action: 'ask', reason: 'other-device' };
  if (!unchanged) {
    if (head.revision === record.revision) {
      // The server took this campaign over because its game stopped without leaving (the head is a plain upload,
      // not a hand-over) and has lived past where this save stops: its world wins, and what this save did after the
      // last upload (at most the tail of a cut-off session) is kept as a copy. Much more play than that is real
      // offline play: the player chooses. A save that is as far or further along, or one that followed a clean exit,
      // stays and the server's world is released.
      if (live && live.baseRevision === head.revision && !head.left && input.localWorldAt != null && live.worldAt > input.localWorldAt) {
        if (input.localWorldAt - head.worldAt > LOCAL_UNSYNCED_MAX_MS) return { action: 'ask', reason: 'diverged' };
        const taken = claimOrLocal(input, head.revision, live);
        if (taken.action === 'claim') return { ...taken, keepLocalCopy: input.localWorldAt > head.worldAt + LOCAL_COPY_MIN_MS };
        if (taken.action === 'wait') return taken;
      }
      return { action: 'local', reason: 'local-newer', release: Boolean(live) };
    }
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
  if (live.status === 'failed') {
    // Nothing alive to take (the server gave up on its runner): the server world is kept as a backup, this computer goes on.
    return { action: 'local', reason: 'server-failed', release: true };
  }
  if (order !== 0 || live.status === 'waiting-version') {
    if (input.takeNow) return { action: 'local', reason: order === 0 ? 'waiting-version' : 'version-mismatch', release: true };
    return { action: 'wait', reason: order > 0 ? 'game-older' : 'server-updating', baseRevision };
  }
  if (!input.takeNow && live.status === 'running' && ((live.lagMs ?? 0) > SERVER_CATCHUP_WAIT_LAG_MS || live.recovery?.nextAttemptAt !== undefined)) {
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
    case 'version-mismatch': return 'Мир на сервере жил в другой версии игры: по вашему выбору досчитываем на этом ПК, мир сервера сохранён резервной копией.';
    case 'schema-newer': return 'Копия на сервере создана более новой версией игры: продолжаем локальную.';
    case 'waiting-version': return 'Сервер ещё не обновился до вашей версии: по вашему выбору досчитываем на этом ПК, мир сервера сохранён резервной копией.';
    case 'server-failed': return describeServerStall(campaign?.live ?? null, 'local') ?? 'Мир на сервере остановился: игра досчитала время сама по сохранению этого компьютера.';
    default: return '';
  }
}

/** What the player did with a world that stopped on the server: took what the server raised, waits for it, or counted the time itself. */
export type ServerStallOutcome = 'took-server' | 'waiting' | 'local';

const stallTime = (ms: number) => new Date(ms).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

/**
 * A calm line for a world whose runner stopped on the server: since when, and
 * what became of it. Null when nothing happened (no detail, no error text).
 */
export function describeServerStall(live: CloudLiveView | null, outcome: ServerStallOutcome): string | null {
  if (!live || (!live.recovery && live.status !== 'failed')) return null;
  const since = stallTime(live.recovery?.stalledAt ?? live.reportedAt);
  if (outcome === 'local') return `Мир на сервере стоял с ${since} и не смог продолжиться. Игра досчитала время сама по сохранению этого компьютера; мир сервера сохранён резервной копией.`;
  if (outcome === 'waiting') {
    return live.recovery?.nextAttemptAt !== undefined
      ? `Мир на сервере остановился в ${since}. Сервер продолжит его сам через несколько минут, ничего не потеряно.`
      : `Мир на сервере стоял с ${since}, затем сервер продолжил его сам и теперь догоняет время.`;
  }
  return `Мир на сервере стоял с ${since}, затем сервер продолжил его сам. Игра взяла мир сервера.`;
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
