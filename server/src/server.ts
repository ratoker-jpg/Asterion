// Asterion cloud server: cloud saves with backups and one world kept alive
// while its player is away (docs/reports/CLOUD_WORLD_2026-10-30.md).
//
// Plain HTTP on 127.0.0.1 behind Caddy (TLS). Every request but /v1/health
// carries the access key the server generated (Authorization: Bearer). Game
// code runs only in the world runner (runner.ts), a child process started from
// the release the world belongs to. An update of the server moves a living
// world to the new release from its checkpoint (migrateLive), so the server's
// progress survives every release and a game of the new version takes it.
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import zlib from 'node:zlib';
import { fork, type ChildProcess } from 'node:child_process';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import { Transform } from 'node:stream';
import {
  addSnapshot, campaignDir, checkUpload, createCampaign, describeCampaign, headSnapshot, listCampaigns, liveCheckpointFile,
  planRotation, readCampaign, removeSnapshots, snapshotFile, writeCampaign, CAMPAIGN_ID, DEFAULT_RETENTION,
  type Campaign, type RetentionPolicy, type Snapshot,
} from './store.ts';
import type { RunnerMessage, RunnerRequest, RunnerStart, RunnerWritten } from './runner.ts';
import { compareGameVersions } from '../../src/application/cloud/cloud-sync.ts';

declare const __ASTERION_SERVER_VERSION__: string | undefined;

export type ServerConfig = {
  host: string;
  port: number;
  dataDir: string;
  /** sha256 of the access key (the key itself is never kept in memory longer than reading it). */
  keyHash: Buffer;
  version: string;
  /** Directory of installed releases (<dir>/<version>/runner.mjs). */
  releasesDir: string;
  /** Development and tests: run this runner for every game version (`node args… script`). */
  runnerOverride?: { script: string; execArgv: string[]; version?: string };
  runnerExecArgv: string[];
  stepMs: number;
  stepBudgetMs: number;
  checkpointEveryMs: number;
  maxUploadGzBytes: number;
  maxSaveBytes: number;
  retention: RetentionPolicy;
  /** Trust X-Forwarded-For from this proxy address (Caddy on localhost). */
  trustProxy: boolean;
  log: (line: string) => void;
};

export function configFromEnv(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const keyFile = env.ASTERION_KEY_FILE ?? '/etc/asterion/access-key';
  const key = fs.readFileSync(keyFile, 'utf8').trim();
  if (key.length < 32) throw new Error(`Access key in ${keyFile} is too short.`);
  const override = env.ASTERION_RUNNER_OVERRIDE;
  return {
    host: env.ASTERION_HOST ?? '127.0.0.1',
    port: Number(env.ASTERION_PORT ?? 8787),
    dataDir: env.ASTERION_DATA ?? '/var/lib/asterion',
    keyHash: createHash('sha256').update(key).digest(),
    version: env.ASTERION_VERSION ?? (typeof __ASTERION_SERVER_VERSION__ === 'string' ? __ASTERION_SERVER_VERSION__ : '0.0.0-dev'),
    releasesDir: env.ASTERION_RELEASES ?? '/opt/asterion/releases',
    ...(override ? { runnerOverride: JSON.parse(override) as ServerConfig['runnerOverride'] } : {}),
    runnerExecArgv: (env.ASTERION_RUNNER_NODE_ARGS ?? '--max-old-space-size=2300').split(' ').filter(Boolean),
    stepMs: Number(env.ASTERION_STEP_MS ?? 10_000),
    stepBudgetMs: Number(env.ASTERION_STEP_BUDGET_MS ?? 4_000),
    checkpointEveryMs: Number(env.ASTERION_CHECKPOINT_MS ?? 10 * 60_000),
    maxUploadGzBytes: Number(env.ASTERION_MAX_UPLOAD_BYTES ?? 160 * 1024 ** 2),
    maxSaveBytes: Number(env.ASTERION_MAX_SAVE_BYTES ?? 900 * 1024 ** 2),
    retention: {
      maxSnapshotsPerCampaign: Number(env.ASTERION_KEEP_SNAPSHOTS ?? DEFAULT_RETENTION.maxSnapshotsPerCampaign),
      maxTotalBytes: Number(env.ASTERION_MAX_STORE_BYTES ?? DEFAULT_RETENTION.maxTotalBytes),
      minFreeBytes: Number(env.ASTERION_MIN_FREE_BYTES ?? DEFAULT_RETENTION.minFreeBytes),
    },
    trustProxy: env.ASTERION_TRUST_PROXY !== '0',
    log: (line) => console.log(line),
  };
}

class HttpError extends Error {
  readonly status: number;
  readonly code: string;
  readonly extra: Record<string, unknown>;
  constructor(status: number, code: string, message: string, extra: Record<string, unknown> = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}

/* ------------------------------------------------------------------ live world */

type LiveRun = {
  campaignId: string;
  child: ChildProcess;
  ready: Promise<void>;
  waiting: Map<string, (message: RunnerMessage) => void>;
  lastStatus?: Extract<RunnerMessage, { type: 'status' }>;
  /** Recent (wall time, world time) pairs: how fast the world catches up. */
  history: Array<{ at: number; worldAt: number }>;
  /** Moved here from this game version at start (an update): resumed in it again if the new runner cannot load the world. */
  migratedFrom?: string;
  loaded: boolean;
  exited: boolean;
};

/** The catch-up speed is measured over this much wall time. */
const RATE_WINDOW_MS = 2 * 60_000;

/** Game milliseconds the world advances per wall millisecond over the recent window (null until measurable). */
export function catchUpRate(history: ReadonlyArray<{ at: number; worldAt: number }>): number | null {
  const last = history.at(-1);
  const first = history.find((sample) => last !== undefined && last.at - sample.at <= RATE_WINDOW_MS);
  if (!last || !first || last.at - first.at < 5_000) return null;
  return Math.max(0, (last.worldAt - first.worldAt) / (last.at - first.at));
}

/** Wall time until a world `lagMs` behind the clock reaches it at `rate` (the clock moves on meanwhile). */
export function catchUpEtaMs(lagMs: number | null, rate: number | null): number | null {
  if (lagMs === null || rate === null || rate <= 1.02) return null;
  return Math.round(lagMs / (rate - 1));
}

export function createCloudServer(config: ServerConfig) {
  fs.mkdirSync(path.join(config.dataDir, 'campaigns'), { recursive: true });
  const locks = new Map<string, Promise<unknown>>();
  let live: LiveRun | null = null;
  let lastPersistAt = 0;
  let closing = false;

  /** One operation per campaign at a time (uploads, claims, releases). */
  const withLock = <T>(id: string, task: () => Promise<T>): Promise<T> => {
    const previous = locks.get(id) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(task);
    locks.set(id, next.catch(() => undefined));
    return next;
  };
  const updateCampaign = (id: string, change: (campaign: Campaign) => Campaign) => {
    const current = readCampaign(config.dataDir, id);
    if (!current) return null;
    const next = change(current);
    writeCampaign(config.dataDir, next);
    return next;
  };

  function runnerFor(version: string): { script: string; execArgv: string[] } | null {
    if (config.runnerOverride && (!config.runnerOverride.version || config.runnerOverride.version === version)) {
      return { script: config.runnerOverride.script, execArgv: config.runnerOverride.execArgv };
    }
    const script = path.join(config.releasesDir, version, 'runner.mjs');
    return fs.existsSync(script) ? { script, execArgv: config.runnerExecArgv } : null;
  }

  function requestUpdate(version: string): void {
    // A systemd path unit starts asterion-update.service when this file appears.
    try { fs.writeFileSync(path.join(config.dataDir, 'update-request'), `${version}\n`); } catch { /* the timer checks anyway */ }
  }

  function send(run: LiveRun, message: RunnerRequest): void {
    if (!run.exited && run.child.connected) run.child.send(message);
  }

  function startRun(campaign: Campaign, resume: boolean, migratedFrom?: string): void {
    const state = campaign.live!;
    const runner = runnerFor(state.gameVersion);
    if (!runner) {
      updateCampaign(campaign.id, (current) => ({ ...current, live: current.live && { ...current.live, status: 'waiting-version' } }));
      requestUpdate(state.gameVersion);
      config.log(`live ${campaign.id}: no runner for game version ${state.gameVersion}, waiting for the release`);
      return;
    }
    const base = campaign.snapshots.find((snapshot) => snapshot.kind === 'revision' && snapshot.revision === state.baseRevision);
    const checkpoint = liveCheckpointFile(config.dataDir, campaign.id);
    // The checkpoint belongs to this live world (endLive removes it). The runner also writes it when its
    // supervisor dies (runner.ts on 'disconnect'), before the supervisor could record it in campaign.json.
    const fromCheckpoint = resume && fs.existsSync(checkpoint) && (state.checkpointWorldAt !== null || state.leftReplay !== undefined);
    if (!base && !fromCheckpoint) throw new Error(`Live world ${campaign.id} has no base snapshot.`);
    const child = fork(runner.script, [], { execArgv: runner.execArgv, stdio: ['ignore', 'inherit', 'inherit', 'ipc'], serialization: 'advanced' });
    const run: LiveRun = {
      campaignId: campaign.id, child, waiting: new Map(), history: [], loaded: false, exited: false, ready: Promise.resolve(),
      ...(migratedFrom ? { migratedFrom } : {}),
    };
    run.ready = new Promise<void>((resolve, reject) => {
      run.waiting.set('ready', (message) => (message.type === 'ready' ? resolve() : reject(new Error((message as { message?: string }).message ?? 'runner failed'))));
    });
    run.ready.catch(() => undefined);
    child.on('message', (message: RunnerMessage) => onRunnerMessage(run, message));
    child.on('exit', (code, signal) => {
      run.exited = true;
      for (const [, waiter] of run.waiting) waiter({ type: 'error', message: `runner exited (${code ?? signal})` });
      run.waiting.clear();
      if (live === run) {
        live = null;
        if (!closing && code !== 0 && run.migratedFrom && !run.loaded && runnerFor(run.migratedFrom)) {
          // This release could not load the world: it goes on in the release it lived in.
          const back = updateCampaign(run.campaignId, (current) => ({ ...current, live: current.live && {
            ...current.live, gameVersion: run.migratedFrom!, migrationError: `runner ${current.live.gameVersion} exited (${code ?? signal}) before loading the world`,
          } }));
          config.log(`live ${run.campaignId}: game ${config.version} did not load the world, back to ${run.migratedFrom}`);
          if (back?.live) {
            try { startRun(back, true); } catch (error) { config.log(`resume ${run.campaignId} failed: ${String(error)}`); }
          }
          return;
        }
        if (!closing && code !== 0) {
          updateCampaign(run.campaignId, (current) => ({ ...current, live: current.live && { ...current.live, status: 'failed', error: `runner exited (${code ?? signal})` } }));
          config.log(`live ${run.campaignId}: runner exited with ${code ?? signal}`);
        }
      }
    });
    live = run;
    const start: RunnerStart = {
      type: 'start',
      input: fromCheckpoint ? checkpoint : snapshotFile(config.dataDir, campaign.id, base!.id),
      resume: Boolean(fromCheckpoint),
      ...(fromCheckpoint ? { leftReplay: state.leftReplay as RunnerStart['leftReplay'] } : {}),
      clockOffsetMs: state.clockOffsetMs,
      stepMs: config.stepMs,
      stepBudgetMs: config.stepBudgetMs,
      checkpointFile: checkpoint,
      checkpointEveryMs: config.checkpointEveryMs,
    };
    send(run, start);
    updateCampaign(campaign.id, (current) => ({ ...current, live: current.live && { ...current.live, status: 'running', error: undefined } }));
    config.log(`live ${campaign.id}: started (game ${state.gameVersion}, ${fromCheckpoint ? 'from checkpoint' : `from revision ${state.baseRevision}`})`);
  }

  function onRunnerMessage(run: LiveRun, message: RunnerMessage): void {
    const waiter = run.waiting.get(message.type === 'error' ? [...run.waiting.keys()][0] ?? '' : message.type);
    if (message.type === 'ready') {
      run.loaded = true;
      run.history = [{ at: Date.now(), worldAt: message.worldAt }];
      updateCampaign(run.campaignId, (current) => ({ ...current, live: current.live && {
        ...current.live, worldAt: message.worldAt, reportedAt: Date.now(),
        ...(current.live.leftReplay === undefined ? { leftReplay: message.leftReplay } : {}),
      } }));
      config.log(`live ${run.campaignId}: loaded in ${message.loadMs} ms, rss ${Math.round(message.rss / 1e6)} MB`);
    } else if (message.type === 'status') {
      run.lastStatus = message;
      const at = Date.now();
      run.history.push({ at, worldAt: message.worldAt });
      while (run.history.length > 2 && at - run.history[1]!.at > RATE_WINDOW_MS) run.history.shift();
      if (Date.now() - lastPersistAt > 60_000) {
        lastPersistAt = Date.now();
        updateCampaign(run.campaignId, (current) => ({ ...current, live: current.live && { ...current.live, worldAt: message.worldAt, reportedAt: Date.now() } }));
      }
    } else if (message.type === 'checkpoint') {
      updateCampaign(run.campaignId, (current) => ({ ...current, live: current.live && {
        ...current.live, checkpointWorldAt: message.written.worldAt, worldAt: message.written.worldAt, reportedAt: Date.now(),
      } }));
    } else if (message.type === 'error') {
      config.log(`live ${run.campaignId}: runner error ${message.message.split('\n')[0]}`);
    }
    if (waiter) {
      run.waiting.delete(message.type === 'error' ? [...run.waiting.keys()][0]! : message.type);
      waiter(message);
    }
  }

  /** Stops the living world and writes it to `out`; `finish` hands it back (closes the absence). */
  async function stopRun(run: LiveRun, out: string, finish: boolean, timeoutMs = 180_000): Promise<RunnerWritten> {
    await run.ready;
    if (run.exited) throw new Error('The world runner is not running.');
    const stopped = new Promise<RunnerMessage>((resolve) => run.waiting.set('stopped', resolve));
    send(run, { type: 'stop', out, finish });
    const timeout = new Promise<never>((_, reject) => setTimeout(() => reject(new Error('The world runner did not stop in time.')), timeoutMs).unref());
    const message = await Promise.race([stopped, timeout]);
    if (message.type !== 'stopped') throw new Error(message.type === 'error' ? message.message : 'The world runner failed.');
    if (live === run) live = null;
    return message.written;
  }

  async function gzipFileStats(file: string): Promise<{ digest: string; bytes: number; gzBytes: number }> {
    const hash = createHash('sha256');
    let bytes = 0;
    await pipeline(fs.createReadStream(file), zlib.createGunzip(), new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        bytes += chunk.length;
        if (bytes > config.maxSaveBytes) return callback(new HttpError(413, 'too-large', 'The save is too large.'));
        hash.update(chunk);
        callback();
      },
    }));
    return { digest: hash.digest('hex'), bytes, gzBytes: fs.statSync(file).size };
  }

  /** Moves a runner output into the campaign as a snapshot. */
  function storeWritten(campaign: Campaign, written: RunnerWritten, kind: Snapshot['kind'], note: string, gameVersion: string, left: boolean): { campaign: Campaign; snapshot: Snapshot } {
    const head = headSnapshot(campaign);
    const added = addSnapshot(campaign, {
      kind, parent: campaign.head, origin: 'server', savedAt: Date.now(), worldAt: written.worldAt, gameVersion,
      schemaVersion: head?.schemaVersion ?? 0, deviceId: 'server', left, digest: written.digest, bytes: written.bytes, gzBytes: written.gzBytes, note,
      ...(kind === 'backup' ? { revision: campaign.live?.baseRevision ?? campaign.head } : {}),
    });
    fs.renameSync(written.file, snapshotFile(config.dataDir, campaign.id, added.snapshot.id));
    return added;
  }

  /**
   * Ends the living world of a campaign. `claim`: becomes the next revision
   * (the player takes it). `keep-backup`: kept as a backup only (the player
   * went on with their own save). `checkpoint`: left to resume (shutdown).
   */
  async function endLive(campaign: Campaign, mode: 'claim' | 'keep-backup' | 'hand-over'): Promise<{ campaign: Campaign; snapshot: Snapshot | null }> {
    const state = campaign.live;
    if (!state) return { campaign, snapshot: null };
    const out = path.join(campaignDir(config.dataDir, campaign.id), `out-${randomBytes(6).toString('hex')}.json.gz`);
    let written: RunnerWritten | null = null;
    if (live?.campaignId === campaign.id) {
      written = await stopRun(live, out, mode !== 'keep-backup');
    } else if (state.checkpointWorldAt !== null && fs.existsSync(liveCheckpointFile(config.dataDir, campaign.id)) && mode === 'keep-backup') {
      fs.copyFileSync(liveCheckpointFile(config.dataDir, campaign.id), out);
      written = { file: out, worldAt: state.checkpointWorldAt, ...(await gzipFileStats(out)), ms: 0 };
    } else if (state.status !== 'waiting-version' && mode !== 'keep-backup') {
      // Not running (failed, or the server just started): finish it from its checkpoint or base in a runner.
      const resumable = { ...campaign, live: state };
      startRun(resumable, true);
      if (live?.campaignId === campaign.id) written = await stopRun(live, out, true);
    }
    let next: Campaign = { ...campaign, live: null };
    let snapshot: Snapshot | null = null;
    if (written) {
      const stored = mode === 'keep-backup'
        ? storeWritten(next, written, 'backup', 'Мир сервера на момент, когда игрок продолжил свою копию', state.gameVersion, false)
        : storeWritten(next, written, 'revision', mode === 'claim' ? 'Мир, прожитый сервером, передан игре' : 'Мир, прожитый сервером, до выгрузки другой кампании', state.gameVersion, mode === 'hand-over');
      next = stored.campaign;
      snapshot = stored.snapshot;
    }
    fs.rmSync(liveCheckpointFile(config.dataDir, campaign.id), { force: true });
    writeCampaign(config.dataDir, next);
    config.log(`live ${campaign.id}: ended (${mode})${snapshot ? `, snapshot ${snapshot.id} rev ${snapshot.revision}` : ''}`);
    return { campaign: next, snapshot };
  }

  /**
   * An update of the server: a world living in an older game version goes on
   * in this release. The old runner wrote a checkpoint (its schema) when the
   * old server stopped; this release's runner loads it as the game loads an
   * older save (migrations only go forward) and keeps it alive from there.
   * So the server's progress survives the update, and a game of this version
   * takes the world without a version mismatch. Returns the version it left.
   */
  function migrateLive(campaign: Campaign): string | null {
    const state = campaign.live;
    if (!state || compareGameVersions(state.gameVersion, config.version) >= 0 || !runnerFor(config.version)) return null;
    const from = state.gameVersion;
    const worldAt = state.checkpointWorldAt ?? state.worldAt;
    const { migrationError: _cleared, ...rest } = state;
    writeCampaign(config.dataDir, { ...campaign, live: {
      ...rest, gameVersion: config.version,
      ...(state.status === 'waiting-version' ? { status: 'running' as const } : {}),
      migrations: [...(state.migrations ?? []), { from, to: config.version, at: Date.now(), worldAt }].slice(-10),
    } });
    config.log(`live ${campaign.id}: moved from game ${from} to ${config.version} (world at ${new Date(worldAt).toISOString()})`);
    return from;
  }

  function rotate(): void {
    let free = Number.POSITIVE_INFINITY;
    try {
      const stats = fs.statfsSync(config.dataDir);
      free = stats.bavail * stats.bsize;
    } catch { /* no statfs: the size budget still applies */ }
    const campaigns = listCampaigns(config.dataDir);
    const doomed = planRotation(campaigns, config.retention, free);
    const byCampaign = new Map<string, Set<number>>();
    for (const entry of doomed) {
      const set = byCampaign.get(entry.campaignId) ?? new Set<number>();
      set.add(entry.snapshotId);
      byCampaign.set(entry.campaignId, set);
    }
    for (const [id, ids] of byCampaign) {
      updateCampaign(id, (current) => removeSnapshots(current, ids));
      for (const snapshotId of ids) fs.rmSync(snapshotFile(config.dataDir, id, snapshotId), { force: true });
      config.log(`rotation ${id}: removed ${ids.size} old snapshot(s)`);
    }
  }

  /* --------------------------------------------------------------- requests */

  const failures = new Map<string, { count: number; since: number; blockedUntil: number }>();
  const buckets = new Map<string, { tokens: number; at: number }>();

  function clientIp(request: http.IncomingMessage): string {
    const remote = request.socket.remoteAddress ?? '';
    const forwarded = request.headers['x-forwarded-for'];
    if (config.trustProxy && (remote === '127.0.0.1' || remote === '::1' || remote === '::ffff:127.0.0.1') && typeof forwarded === 'string') {
      return forwarded.split(',').at(-1)!.trim();
    }
    return remote;
  }

  function rateLimit(ip: string): void {
    const now = Date.now();
    const bucket = buckets.get(ip) ?? { tokens: 60, at: now };
    bucket.tokens = Math.min(60, bucket.tokens + ((now - bucket.at) / 60_000) * 60);
    bucket.at = now;
    if (bucket.tokens < 1) throw new HttpError(429, 'rate-limited', 'Слишком много запросов.');
    bucket.tokens -= 1;
    buckets.set(ip, bucket);
  }

  function authorize(request: http.IncomingMessage, ip: string): void {
    const now = Date.now();
    const record = failures.get(ip);
    if (record && record.blockedUntil > now) throw new HttpError(429, 'blocked', 'Слишком много неверных ключей. Попробуйте позже.');
    const header = request.headers.authorization ?? '';
    const key = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
    const ok = key.length > 0 && timingSafeEqual(createHash('sha256').update(key).digest(), config.keyHash);
    if (ok) return;
    const next = record && now - record.since < 10 * 60_000 ? { ...record, count: record.count + 1 } : { count: 1, since: now, blockedUntil: 0 };
    if (next.count >= 10) next.blockedUntil = now + 15 * 60_000;
    failures.set(ip, next);
    // fail2ban reads this line (server/deploy/fail2ban-asterion.conf); the key is never logged.
    config.log(`asterion auth failed from ${ip}`);
    throw new HttpError(401, 'unauthorized', 'Неверный ключ доступа.');
  }

  function json(response: http.ServerResponse, status: number, body: unknown): void {
    const text = JSON.stringify(body);
    response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    response.end(text);
  }

  async function readJson(request: http.IncomingMessage): Promise<Record<string, unknown>> {
    let size = 0;
    const chunks: Buffer[] = [];
    for await (const chunk of request) {
      size += (chunk as Buffer).length;
      if (size > 64 * 1024) throw new HttpError(413, 'too-large', 'Request too large.');
      chunks.push(chunk as Buffer);
    }
    if (!size) return {};
    try { return JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>; } catch { throw new HttpError(400, 'bad-json', 'Bad JSON.'); }
  }

  function header(request: http.IncomingMessage, name: string): string {
    const value = request.headers[name];
    return typeof value === 'string' ? value : '';
  }

  const VERSION = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]{1,40})?$/;
  const DIGEST = /^[a-f0-9]{64}$/;
  const DEVICE = /^[a-z0-9-]{8,64}$/;

  async function upload(request: http.IncomingMessage, id: string): Promise<unknown> {
    const baseRevision = Number(header(request, 'x-asterion-base-revision'));
    const gameVersion = header(request, 'x-asterion-game-version');
    const schemaVersion = Number(header(request, 'x-asterion-schema'));
    const digest = header(request, 'x-asterion-digest');
    const deviceId = header(request, 'x-asterion-device');
    const left = header(request, 'x-asterion-left') === '1';
    const force = header(request, 'x-asterion-force') === '1';
    const worldAt = Number(header(request, 'x-asterion-world-at'));
    const clockOffsetMs = Math.round(Number(header(request, 'x-asterion-clock-offset') || 0));
    const name = decodeURIComponent(header(request, 'x-asterion-name') || '').slice(0, 60);
    if (!Number.isSafeInteger(baseRevision) || baseRevision < 0 || !VERSION.test(gameVersion) || !Number.isSafeInteger(schemaVersion)
      || !DIGEST.test(digest) || !DEVICE.test(deviceId) || !Number.isFinite(worldAt) || !Number.isFinite(clockOffsetMs)
      || Math.abs(clockOffsetMs) > 400 * 86_400_000) {
      throw new HttpError(400, 'bad-headers', 'Bad upload headers.');
    }
    if (header(request, 'content-type') !== 'application/gzip') throw new HttpError(415, 'gzip-only', 'Upload a gzip body.');
    const declared = Number(header(request, 'content-length'));
    if (Number.isFinite(declared) && declared > config.maxUploadGzBytes) throw new HttpError(413, 'too-large', 'The save is too large.');
    return withLock(id, async () => {
      const existing = readCampaign(config.dataDir, id);
      const check = checkUpload(existing, baseRevision, force);
      if (!check.ok) {
        request.resume();
        throw new HttpError(check.status, check.code, 'Сервер хранит другую версию кампании.', { head: check.head });
      }
      fs.mkdirSync(campaignDir(config.dataDir, id), { recursive: true });
      const temporary = path.join(campaignDir(config.dataDir, id), `upload-${randomBytes(6).toString('hex')}.json.gz`);
      let received = 0;
      try {
        await pipeline(request, new Transform({
          transform(chunk: Buffer, _encoding, callback) {
            received += chunk.length;
            if (received > config.maxUploadGzBytes) return callback(new HttpError(413, 'too-large', 'The save is too large.'));
            callback(null, chunk);
          },
        }), fs.createWriteStream(temporary));
        let stats: Awaited<ReturnType<typeof gzipFileStats>>;
        try { stats = await gzipFileStats(temporary); } catch (error) {
          if (error instanceof HttpError) throw error;
          throw new HttpError(400, 'bad-gzip', 'The upload is not a readable gzip save.');
        }
        if (stats.digest !== digest) throw new HttpError(400, 'digest-mismatch', 'The upload does not match its digest.');
        let campaign = existing ?? createCampaign(id, name, Date.now());
        if (name) campaign = { ...campaign, name };
        // The player's own save wins over the world the server kept alive meanwhile; that world stays as a backup.
        if (campaign.live) campaign = (await endLive(campaign, 'keep-backup')).campaign;
        const replacedHead = force && existing && baseRevision !== existing.head ? headSnapshot(campaign) : null;
        if (replacedHead) {
          campaign = { ...campaign, snapshots: campaign.snapshots.map((snapshot) => snapshot.id === replacedHead.id
            ? { ...snapshot, kind: 'backup' as const, note: 'Заменено выгрузкой, выбранной игроком' } : snapshot) };
        }
        const added = addSnapshot(campaign, {
          kind: 'revision', parent: campaign.head, origin: 'client', savedAt: Date.now(), worldAt, gameVersion, schemaVersion, deviceId, left,
          digest, bytes: stats.bytes, gzBytes: stats.gzBytes,
        });
        if (replacedHead) {
          // A forced revision continues what the player chose, not the head it replaced.
          added.snapshot.parent = baseRevision;
          added.campaign.snapshots[added.campaign.snapshots.length - 1] = added.snapshot;
        }
        campaign = added.campaign;
        fs.renameSync(temporary, snapshotFile(config.dataDir, id, added.snapshot.id));
        if (left) {
          // One living world: another campaign's world is finished into a revision of its own.
          if (live && live.campaignId !== id) {
            const other = readCampaign(config.dataDir, live.campaignId);
            if (other) await withLockFree(() => endLive(other, 'hand-over'));
          }
          campaign = { ...campaign, live: {
            status: 'running', baseRevision: added.snapshot.revision, gameVersion, startedAt: Date.now(), clockOffsetMs,
            worldAt, reportedAt: Date.now(), checkpointWorldAt: null,
          } };
        }
        writeCampaign(config.dataDir, campaign);
        if (campaign.live) startRun(campaign, false);
        config.log(`upload ${id}: revision ${added.snapshot.revision} (${Math.round(stats.gzBytes / 1024)} KiB gz, game ${gameVersion}${left ? ', player left' : ''}${force ? ', forced' : ''})`);
        try { rotate(); } catch (error) { config.log(`rotation failed: ${String(error)}`); }
        return { revision: added.snapshot.revision, campaign: describeCampaign(readCampaign(config.dataDir, id)!, Date.now()) };
      } finally {
        fs.rmSync(temporary, { force: true });
      }
    });
  }

  // endLive of another campaign while holding this campaign's lock: the other campaign's lock is not taken
  // (its own requests wait on the live run's stop anyway).
  const withLockFree = <T>(task: () => Promise<T>) => task();

  function sendSnapshot(response: http.ServerResponse, campaign: Campaign, snapshot: Snapshot): void {
    const file = snapshotFile(config.dataDir, campaign.id, snapshot.id);
    const size = fs.statSync(file).size;
    response.writeHead(200, {
      'content-type': 'application/gzip',
      'content-length': String(size),
      'cache-control': 'no-store',
      'x-asterion-revision': String(snapshot.revision),
      'x-asterion-snapshot': String(snapshot.id),
      'x-asterion-digest': snapshot.digest,
      'x-asterion-game-version': snapshot.gameVersion,
      'x-asterion-world-at': String(snapshot.worldAt),
      'x-asterion-origin': snapshot.origin,
    });
    fs.createReadStream(file).pipe(response);
  }

  async function claim(request: http.IncomingMessage, response: http.ServerResponse, id: string): Promise<void> {
    const body = await readJson(request);
    const baseRevision = Number(body.baseRevision);
    const gameVersion = String(body.gameVersion ?? '');
    if (!Number.isSafeInteger(baseRevision) || !VERSION.test(gameVersion)) throw new HttpError(400, 'bad-request', 'Bad claim.');
    const result = await withLock(id, async () => {
      let campaign = readCampaign(config.dataDir, id);
      if (!campaign) throw new HttpError(404, 'not-found', 'Кампании нет на сервере.');
      if (baseRevision > campaign.head) throw new HttpError(409, 'ahead-of-server', 'Сервер отстаёт от этой копии.', { head: campaign.head });
      if (campaign.live) {
        if (campaign.live.baseRevision !== campaign.head) throw new HttpError(409, 'stale-live', 'Живой мир не продолжает последнюю ревизию.');
        if (baseRevision !== campaign.head) throw new HttpError(409, 'stale-base', 'Сервер хранит более новую версию кампании.', { head: campaign.head });
        if (campaign.live.gameVersion !== gameVersion) {
          if (compareGameVersions(gameVersion, config.version) > 0) requestUpdate(gameVersion);
          throw new HttpError(409, 'version-mismatch', `Мир на сервере живёт в версии ${campaign.live.gameVersion}, а игра — ${gameVersion}.`, { worldVersion: campaign.live.gameVersion });
        }
        const ended = await endLive(campaign, 'claim');
        campaign = ended.campaign;
        if (ended.snapshot) return { campaign, snapshot: ended.snapshot };
      }
      if (campaign.head === baseRevision) return { campaign, snapshot: null };
      return { campaign, snapshot: headSnapshot(campaign) };
    });
    if (!result.snapshot) {
      response.writeHead(204, { 'x-asterion-revision': String(result.campaign.head) });
      response.end();
      return;
    }
    sendSnapshot(response, result.campaign, result.snapshot);
  }

  async function release(request: http.IncomingMessage, id: string): Promise<unknown> {
    await readJson(request);
    return withLock(id, async () => {
      const campaign = readCampaign(config.dataDir, id);
      if (!campaign) throw new HttpError(404, 'not-found', 'Кампании нет на сервере.');
      const ended = await endLive(campaign, 'keep-backup');
      return { campaign: describeCampaign(ended.campaign, Date.now()) };
    });
  }

  function statusBody() {
    let disk: { freeBytes: number; totalBytes: number } | null = null;
    try {
      const stats = fs.statfsSync(config.dataDir);
      disk = { freeBytes: stats.bavail * stats.bsize, totalBytes: stats.blocks * stats.bsize };
    } catch { disk = null; }
    const campaigns = listCampaigns(config.dataDir);
    let versions: string[] = [];
    try { versions = fs.readdirSync(config.releasesDir).filter((name) => VERSION.test(name)).sort(); } catch { versions = []; }
    return {
      version: config.version,
      versions,
      now: Date.now(),
      disk,
      storedBytes: campaigns.reduce((sum, campaign) => sum + campaign.snapshots.reduce((inner, snapshot) => inner + snapshot.gzBytes, 0), 0),
      campaigns: campaigns.length,
      live: live ? {
        campaignId: live.campaignId,
        worldAt: live.lastStatus?.worldAt ?? null,
        lagMs: live.lastStatus?.lagMs ?? null,
        tickMs: live.lastStatus?.tickMs ?? null,
        cpuShare: live.lastStatus?.cpuShare ?? null,
        rss: live.lastStatus?.rss ?? null,
        rate: catchUpRate(live.history),
        etaMs: catchUpEtaMs(live.lastStatus?.lagMs ?? null, catchUpRate(live.history)),
      } : null,
    };
  }

  function liveView(campaign: Campaign) {
    const view = describeCampaign(campaign, Date.now());
    if (view.live && live?.campaignId === campaign.id && live.lastStatus) {
      const rate = catchUpRate(live.history);
      // The lag as of now: the clock moved on since the last tick reported.
      const lagMs = Math.max(0, Date.now() + campaign.live!.clockOffsetMs - live.lastStatus.worldAt);
      view.live = { ...view.live, worldAt: live.lastStatus.worldAt, reportedAt: Date.now(), lagMs, rate, etaMs: catchUpEtaMs(lagMs, rate) };
    }
    return view;
  }

  async function route(request: http.IncomingMessage, response: http.ServerResponse): Promise<void> {
    const url = new URL(request.url ?? '/', 'http://localhost');
    const ip = clientIp(request);
    if (request.method === 'GET' && url.pathname === '/v1/health') return json(response, 200, { ok: true });
    rateLimit(ip);
    authorize(request, ip);
    if (closing) throw new HttpError(503, 'restarting', 'Сервер перезапускается.');
    if (request.method === 'GET' && url.pathname === '/v1/status') return json(response, 200, statusBody());
    if (request.method === 'POST' && url.pathname === '/v1/update-request') {
      // A game newer than this server: the living world moves to that release once the server installs it (migrateLive).
      const body = await readJson(request);
      const gameVersion = String(body.gameVersion ?? '');
      if (!VERSION.test(gameVersion)) throw new HttpError(400, 'bad-request', 'Bad version.');
      const newer = compareGameVersions(gameVersion, config.version) > 0;
      if (newer) requestUpdate(gameVersion);
      return json(response, 200, { requested: newer, serverVersion: config.version });
    }
    if (request.method === 'GET' && url.pathname === '/v1/campaigns') {
      return json(response, 200, { campaigns: listCampaigns(config.dataDir).map(liveView) });
    }
    const match = /^\/v1\/campaigns\/([^/]+)(?:\/(revisions|claim|release|snapshots)(?:\/(\d+))?)?$/.exec(url.pathname);
    if (!match || !CAMPAIGN_ID.test(match[1]!)) throw new HttpError(404, 'not-found', 'Not found.');
    const [, id, action, snapshotId] = match as unknown as [string, string, string | undefined, string | undefined];
    if (!action && request.method === 'GET') {
      const campaign = readCampaign(config.dataDir, id);
      if (!campaign) throw new HttpError(404, 'not-found', 'Кампании нет на сервере.');
      return json(response, 200, liveView(campaign));
    }
    if (action === 'revisions' && request.method === 'PUT' && !snapshotId) return json(response, 200, await upload(request, id));
    if (action === 'claim' && request.method === 'POST') return claim(request, response, id);
    if (action === 'release' && request.method === 'POST') return json(response, 200, await release(request, id));
    if (action === 'snapshots' && request.method === 'GET' && snapshotId) {
      const campaign = readCampaign(config.dataDir, id);
      const snapshot = campaign?.snapshots.find((item) => item.id === Number(snapshotId));
      if (!campaign || !snapshot) throw new HttpError(404, 'not-found', 'Снимка нет на сервере.');
      return sendSnapshot(response, campaign, snapshot);
    }
    throw new HttpError(405, 'method', 'Method not allowed.');
  }

  const server = http.createServer((request, response) => {
    route(request, response).catch((error: unknown) => {
      if (response.headersSent) { response.destroy(); return; }
      if (error instanceof HttpError) {
        json(response, error.status, { error: error.code, message: error.message, ...error.extra });
      } else {
        config.log(`request failed: ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
        json(response, 500, { error: 'internal', message: 'Ошибка сервера.' });
      }
      // An unread upload body is drained (Caddy caps it), so the client still reads this answer.
      if (!request.complete) request.resume();
    });
  });
  server.requestTimeout = 10 * 60_000;
  server.headersTimeout = 30_000;

  return {
    server,
    config,
    async listen(): Promise<number> {
      await new Promise<void>((resolve) => server.listen(config.port, config.host, resolve));
      const address = server.address();
      // An update: worlds of older game versions move to this release (migrateLive).
      const migrated = new Map<string, string>();
      for (const campaign of listCampaigns(config.dataDir)) {
        const from = migrateLive(campaign);
        if (from) migrated.set(campaign.id, from);
      }
      // Resume the world that was alive when the server stopped (an update or a reboot).
      const running = listCampaigns(config.dataDir).filter((campaign) => campaign.live && campaign.live.status !== 'failed')
        .sort((left, right) => right.live!.startedAt - left.live!.startedAt);
      for (const [index, campaign] of running.entries()) {
        if (index === 0) {
          try { startRun(campaign, true, migrated.get(campaign.id)); } catch (error) { config.log(`resume ${campaign.id} failed: ${String(error)}`); }
        } else {
          // More than one is a leftover: finish it into a revision when its player returns.
          writeCampaign(config.dataDir, { ...campaign, live: { ...campaign.live!, status: 'paused' } });
        }
      }
      config.log(`asterion cloud ${config.version} listening on ${config.host}:${typeof address === 'object' && address ? address.port : config.port}`);
      return typeof address === 'object' && address ? address.port : config.port;
    },
    /** Shutdown (update, reboot): the living world writes a checkpoint and resumes on the next start. */
    async close(): Promise<void> {
      closing = true;
      server.close();
      const run = live;
      if (run && !run.exited) {
        try {
          const written = await stopRun(run, liveCheckpointFile(config.dataDir, run.campaignId), false, 120_000);
          updateCampaign(run.campaignId, (current) => ({ ...current, live: current.live && { ...current.live, checkpointWorldAt: written.worldAt, worldAt: written.worldAt, reportedAt: Date.now() } }));
          config.log(`live ${run.campaignId}: checkpoint at shutdown (${written.ms} ms)`);
        } catch (error) {
          config.log(`live ${run.campaignId}: checkpoint at shutdown failed: ${String(error)}`);
          run.child.kill('SIGKILL');
        }
      }
      server.closeAllConnections();
    },
    /** Tests: the current runner. */
    liveCampaignId: () => live?.campaignId ?? null,
  };
}

const isMain = process.argv[1] && /server\.(ts|mjs)$/.test(process.argv[1]) && !process.send;
if (isMain) {
  const cloud = createCloudServer(configFromEnv());
  cloud.listen().catch((error) => { console.error(error); process.exit(1); });
  let stopping = false;
  const stop = () => {
    if (stopping) return;
    stopping = true;
    cloud.close().finally(() => process.exit(0));
  };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
}
