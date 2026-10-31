// Cloud world transport (docs/reports/CLOUD_WORLD_2026-10-30.md): the main
// process talks to the cloud server so compression and the network never run
// on the game's thread, and a closing window does not wait on them. The
// renderer decides what to do (src/application/cloud/cloud-sync.ts); this
// file uploads, downloads and remembers which server revision each local
// save equals.
//
//   <userData>/cloud.json        address, on/off, this computer's device id
//   <userData>/cloud-key.txt     the access key (written only from the settings screen or the deploy script)
//   <userData>/cloud-sync.json   per campaign: the revision and digest the local save equals, last upload
const { app, ipcMain } = require('electron');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { promisify } = require('util');

const gzip = promisify(zlib.gzip);
const gunzip = promisify(zlib.gunzip);

const CAMPAIGN_ID = /^slot-[a-z0-9-]{1,40}$/;
/** A closing window waits this long for the network once the save is compressed. */
const EXIT_NETWORK_WAIT_MS = 2_500;
/** ...and at most this long for compressing it (a late world takes 1–2 s). */
const EXIT_COMPRESS_WAIT_MS = 6_000;
const REQUEST_TIMEOUT_MS = 15_000;
const TRANSFER_TIMEOUT_MS = 5 * 60_000;

const file = (name) => path.join(app.getPath('userData'), name);

function readJson(name, fallback) {
  try { return JSON.parse(fs.readFileSync(file(name), 'utf8')); } catch { return fallback; }
}

function writeJson(name, value) {
  fs.mkdirSync(app.getPath('userData'), { recursive: true });
  const target = file(name);
  fs.writeFileSync(`${target}.tmp`, JSON.stringify(value, null, 1));
  fs.renameSync(`${target}.tmp`, target);
}

function settings() {
  const stored = readJson('cloud.json', {});
  let deviceId = typeof stored.deviceId === 'string' && /^[a-z0-9-]{8,64}$/.test(stored.deviceId) ? stored.deviceId : null;
  if (!deviceId) {
    deviceId = `pc-${crypto.randomBytes(8).toString('hex')}`;
    writeJson('cloud.json', { ...stored, deviceId });
  }
  return { url: typeof stored.url === 'string' ? stored.url : '', enabled: stored.enabled === true, deviceId };
}

function readKey() {
  try { return fs.readFileSync(file('cloud-key.txt'), 'utf8').trim(); } catch { return ''; }
}

/** «host», «https://host/», «http://127.0.0.1:8787» → base URL; plain http only for this computer. */
function normalizeUrl(raw) {
  const text = String(raw || '').trim();
  if (!text) return '';
  const withScheme = /^[a-z]+:\/\//i.test(text) ? text : `https://${text}`;
  const url = new URL(withScheme);
  const local = url.hostname === '127.0.0.1' || url.hostname === 'localhost' || url.hostname === '[::1]';
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) throw new Error('Адрес сервера должен начинаться с https://');
  return `${url.protocol}//${url.host}`;
}

function syncState() {
  const stored = readJson('cloud-sync.json', {});
  return { campaigns: stored.campaigns && typeof stored.campaigns === 'object' ? stored.campaigns : {}, lastUpload: stored.lastUpload ?? null, lastError: stored.lastError ?? null };
}

function updateSync(change) {
  const next = change(syncState());
  writeJson('cloud-sync.json', next);
  return next;
}

function setRecord(id, record) {
  updateSync((state) => ({ ...state, campaigns: { ...state.campaigns, [id]: { ...(state.campaigns[id] ?? {}), ...record } } }));
}

const digestOf = (text) => crypto.createHash('sha256').update(text, 'utf8').digest('hex');

class CloudError extends Error {
  constructor(code, message, extra = {}) {
    super(message);
    this.code = code;
    Object.assign(this, extra);
  }
}

/** Player-facing text of a failed request. */
function errorText(error) {
  if (error instanceof CloudError) return error.message;
  const text = String(error && (error.cause && error.cause.code || error.message) || error || '');
  if (/abort|timeout/i.test(text)) return 'Сервер не ответил вовремя';
  if (/ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ECONNRESET|EHOSTUNREACH|ENETUNREACH|fetch failed|network/i.test(text)) return 'Нет связи с сервером';
  if (/CERT|SSL|TLS/i.test(text)) return 'Сертификат сервера не принят';
  return 'Ошибка облачного мира';
}

function config() {
  const current = settings();
  const key = readKey();
  if (!current.enabled) throw new CloudError('disabled', 'Облачный мир выключен');
  if (!current.url || !key) throw new CloudError('not-configured', 'Не указан адрес или ключ сервера');
  return { ...current, base: normalizeUrl(current.url), key };
}

async function request(route, { method = 'GET', body, headers = {}, timeoutMs = REQUEST_TIMEOUT_MS, raw = false, override } = {}) {
  const cfg = override ?? config();
  const response = await fetch(`${cfg.base}${route}`, {
    method,
    body,
    headers: { authorization: `Bearer ${cfg.key}`, ...headers },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (raw && response.ok) return response;
  if (response.status === 204) return { status: 204, headers: response.headers };
  let payload = null;
  try { payload = await response.json(); } catch { payload = null; }
  if (response.ok) return payload;
  if (response.status === 401) throw new CloudError('unauthorized', 'Сервер не принял ключ доступа');
  if (response.status === 429) throw new CloudError('rate-limited', payload && payload.message || 'Сервер просит подождать');
  if (response.status === 404) throw new CloudError('not-found', payload && payload.message || 'Не найдено на сервере');
  throw new CloudError(payload && payload.error || `http-${response.status}`, payload && payload.message || `Сервер ответил ${response.status}`, payload || {});
}

/* --------------------------------------------------------------- uploads */

const queues = new Map();
/** Exit uploads still running: a quitting app waits for them a little. */
const exitUploads = new Set();

function enqueue(id, task) {
  const previous = queues.get(id) || Promise.resolve();
  const next = previous.catch(() => undefined).then(task);
  queues.set(id, next.catch(() => undefined));
  return next;
}

function validMeta(meta) {
  return meta && typeof meta === 'object' && Number.isFinite(meta.worldAt) && Number.isFinite(meta.schemaVersion);
}

/**
 * One upload: compress in the thread pool, send with the revision the local
 * save continues, and remember the new revision for this exact text.
 */
function upload(id, name, text, meta, hooks = {}) {
  return enqueue(id, async () => {
    const startedAt = Date.now();
    const result = { campaignId: id, at: startedAt, left: Boolean(meta.left), ok: false };
    try {
      const cfg = config();
      const digest = digestOf(text);
      const record = syncState().campaigns[id] || null;
      if (record && record.digest === digest && record.revision > 0 && !meta.left && !record.forceNext) {
        // Nothing changed since the last upload or download.
        return { ...result, ok: true, revision: record.revision, unchanged: true };
      }
      const body = await gzip(text, { level: 6 });
      hooks.compressed?.();
      const response = await request(`/v1/campaigns/${id}/revisions`, {
        override: cfg,
        method: 'PUT',
        body,
        timeoutMs: hooks.timeoutMs ?? TRANSFER_TIMEOUT_MS,
        headers: {
          'content-type': 'application/gzip',
          'x-asterion-base-revision': String(record ? record.revision : 0),
          'x-asterion-game-version': app.getVersion(),
          'x-asterion-schema': String(Math.floor(meta.schemaVersion)),
          'x-asterion-digest': digest,
          'x-asterion-device': cfg.deviceId,
          'x-asterion-left': meta.left ? '1' : '0',
          'x-asterion-world-at': String(Math.floor(meta.worldAt)),
          'x-asterion-clock-offset': String(Math.round(meta.clockOffsetMs || 0)),
          'x-asterion-name': encodeURIComponent(String(name || '').slice(0, 60)),
          ...(record && record.forceNext ? { 'x-asterion-force': '1' } : {}),
        },
      });
      setRecord(id, { revision: response.revision, digest, syncedAt: Date.now(), forceNext: false });
      Object.assign(result, { ok: true, revision: response.revision, gzBytes: body.length, ms: Date.now() - startedAt, live: response.campaign && response.campaign.live });
    } catch (error) {
      Object.assign(result, { ok: false, code: error.code || 'network', error: errorText(error), ms: Date.now() - startedAt });
      if (error.code === 'stale-base' || error.code === 'ahead-of-server') result.error = 'Сервер хранит другую версию кампании: выбор будет предложен при входе';
    }
    if (!(result.code === 'disabled' || result.code === 'not-configured')) {
      updateSync((state) => ({ ...state, lastUpload: result, lastError: result.ok ? state.lastError : { at: Date.now(), text: result.error } }));
    }
    return result;
  });
}

/* ------------------------------------------------------------- downloads */

async function readSnapshotResponse(response) {
  const packed = Buffer.from(await response.arrayBuffer());
  const text = (await gunzip(packed)).toString('utf8');
  const digest = digestOf(text);
  if (digest !== response.headers.get('x-asterion-digest')) throw new CloudError('digest-mismatch', 'Мир с сервера пришёл повреждённым');
  return {
    text,
    digest,
    revision: Number(response.headers.get('x-asterion-revision')),
    snapshotId: Number(response.headers.get('x-asterion-snapshot')),
    origin: response.headers.get('x-asterion-origin'),
    worldAt: Number(response.headers.get('x-asterion-world-at')),
    gameVersion: response.headers.get('x-asterion-game-version'),
    gzBytes: packed.length,
  };
}

function guard(task) {
  return task().then((value) => ({ ok: true, ...value }), (error) => ({ ok: false, code: error.code || 'network', error: errorText(error) }));
}

function publicSettings() {
  const current = settings();
  const state = syncState();
  return {
    url: current.url,
    enabled: current.enabled,
    hasKey: readKey().length > 0,
    deviceId: current.deviceId,
    appVersion: app.getVersion(),
    lastUpload: state.lastUpload,
    lastError: state.lastError,
  };
}

function registerCloud() {
  ipcMain.handle('asterion:cloud:get', () => publicSettings());
  ipcMain.handle('asterion:cloud:set', (_event, next) => {
    const current = readJson('cloud.json', {});
    const update = { ...current, deviceId: settings().deviceId };
    if (next && typeof next.url === 'string') update.url = next.url.trim() ? normalizeUrl(next.url) : '';
    if (next && typeof next.enabled === 'boolean') update.enabled = next.enabled;
    if (next && typeof next.key === 'string' && next.key.trim()) {
      const key = next.key.trim();
      if (!/^[A-Za-z0-9_-]{32,128}$/.test(key)) throw new Error('Ключ доступа выглядит неверно');
      fs.writeFileSync(file('cloud-key.txt'), `${key}\n`, { mode: 0o600 });
    }
    writeJson('cloud.json', update);
    return publicSettings();
  });
  ipcMain.handle('asterion:cloud:server', () => guard(async () => {
    const [status, list] = await Promise.all([request('/v1/status'), request('/v1/campaigns')]);
    return { status, campaigns: list.campaigns };
  }));
  ipcMain.handle('asterion:cloud:campaign', (_event, id) => guard(async () => {
    if (!CAMPAIGN_ID.test(id)) throw new CloudError('bad-id', 'Неверный слот');
    try {
      return { campaign: await request(`/v1/campaigns/${id}`, { timeoutMs: 6_000 }) };
    } catch (error) {
      if (error.code === 'not-found') return { campaign: null };
      throw error;
    }
  }));
  ipcMain.handle('asterion:cloud:record', (_event, id) => syncState().campaigns[id] || null);
  ipcMain.handle('asterion:cloud:upload', (_event, id, name, text, meta) => {
    if (!CAMPAIGN_ID.test(id) || typeof text !== 'string' || !validMeta(meta)) return { ok: false, error: 'Неверная выгрузка' };
    return upload(id, name, text, meta);
  });
  // The window is closing or reloading: the upload is queued and the renderer goes on at once.
  ipcMain.on('asterion:cloud:upload-exit', (event, id, name, text, meta) => {
    event.returnValue = { queued: false };
    if (!CAMPAIGN_ID.test(id) || typeof text !== 'string' || !validMeta(meta)) return;
    let compressed;
    const compressedPromise = new Promise((resolve) => { compressed = resolve; });
    const running = upload(id, name, text, { ...meta, left: true }, { compressed });
    const entry = { running, compressedPromise };
    exitUploads.add(entry);
    running.finally(() => exitUploads.delete(entry));
    event.returnValue = { queued: true };
  });
  ipcMain.handle('asterion:cloud:wait', async (_event, id) => {
    const pending = queues.get(id);
    if (pending) await Promise.race([pending, new Promise((resolve) => setTimeout(resolve, 60_000))]);
    return syncState().lastUpload;
  });
  ipcMain.handle('asterion:cloud:claim', (_event, id, baseRevision) => guard(async () => {
    const response = await request(`/v1/campaigns/${id}/claim`, {
      method: 'POST',
      raw: true,
      timeoutMs: TRANSFER_TIMEOUT_MS,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ baseRevision, gameVersion: app.getVersion(), deviceId: settings().deviceId }),
    });
    if (response.status === 204) return { none: true, revision: Number(response.headers.get('x-asterion-revision')) };
    return { world: await readSnapshotResponse(response) };
  }));
  ipcMain.handle('asterion:cloud:download', (_event, id, snapshotId) => guard(async () => {
    const response = await request(`/v1/campaigns/${id}/snapshots/${Math.floor(snapshotId)}`, { raw: true, timeoutMs: TRANSFER_TIMEOUT_MS });
    return { world: await readSnapshotResponse(response) };
  }));
  ipcMain.handle('asterion:cloud:release', (_event, id) => guard(async () => {
    const result = await request(`/v1/campaigns/${id}/release`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    return { campaign: result.campaign };
  }));
  ipcMain.handle('asterion:cloud:update-request', () => guard(async () => {
    const result = await request('/v1/update-request', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ gameVersion: app.getVersion() }) });
    return { requested: Boolean(result.requested), serverVersion: String(result.serverVersion || '') };
  }));
  /** The local save is now exactly this server revision (after a download was written, or an explicit choice). */
  ipcMain.handle('asterion:cloud:mark-synced', (_event, id, revision, digest) => {
    if (!CAMPAIGN_ID.test(id) || !Number.isSafeInteger(revision) || !/^[a-f0-9]{64}$/.test(digest)) return false;
    setRecord(id, { revision, digest, syncedAt: Date.now(), forceNext: false });
    return true;
  });
  /** The player chose this computer's copy: the next upload replaces the server head (which stays a backup). */
  ipcMain.handle('asterion:cloud:prefer-local', (_event, id) => {
    if (!CAMPAIGN_ID.test(id)) return false;
    setRecord(id, { forceNext: true, revision: syncState().campaigns[id]?.revision ?? 0, digest: syncState().campaigns[id]?.digest ?? '' });
    return true;
  });

  // Quitting with an exit upload in flight: wait for compression, then at most EXIT_NETWORK_WAIT_MS for the server.
  let waitedForExit = false;
  app.on('before-quit', (event) => {
    if (waitedForExit || exitUploads.size === 0) return;
    event.preventDefault();
    waitedForExit = true;
    const entries = [...exitUploads];
    const timeout = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    Promise.race([Promise.all(entries.map((entry) => entry.compressedPromise)), timeout(EXIT_COMPRESS_WAIT_MS)])
      .then(() => Promise.race([Promise.allSettled(entries.map((entry) => entry.running)), timeout(EXIT_NETWORK_WAIT_MS)]))
      .finally(() => app.quit());
  });
}

module.exports = { registerCloud, normalizeUrl };
