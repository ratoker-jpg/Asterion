// The cloud server end to end on localhost (the CI mock is the server itself):
// access key, revision rules, a world kept alive and handed back, backups,
// a restart in the middle of a living world, and the handed-back world equal
// to a local catch-up of the same length from the same save.
import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { execFile, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createCloudServer, errorHeadline, planCrash, type ServerConfig } from './server.ts';
import { parseNpcJournalLines } from '../../src/application/npc-journal.ts';
import { DEFAULT_RETENTION } from './store.ts';
import { memoryStorage } from '../../src/application/npc-runtime.test-support.ts';
import { createDefaultNewGameConfig } from '../../src/domain/world/config.ts';
import { createInitialSaveState, createPersistenceFacade, serializeSaveForStorage } from '../../src/application/persistence.ts';
import { freezeNpcCatchupTarget } from '../../src/application/npc-catchup.ts';
import { runNpcCatchup } from '../../src/application/npc-catchup-runner.ts';
import { applyCampaignRuntimeForCatchup } from '../../src/application/npc-catchup-runner.ts';
import { reconcileRuntime } from '../../src/application/reconcile.ts';
import type { SaveState } from '../../src/application/contracts.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const KEY = 'test-key-0123456789abcdef0123456789abcdef';
const DEVICE = 'device-test-0001';
const VERSION = '1.2.3';

function config(dataDir: string, overrides: Partial<ServerConfig> = {}): ServerConfig {
  return {
    host: '127.0.0.1', port: 0, dataDir, keyHash: createHash('sha256').update(KEY).digest(), version: VERSION,
    releasesDir: path.join(dataDir, 'releases'),
    runnerOverride: {
      script: path.join(here, 'runner.ts'),
      execArgv: ['--experimental-strip-types', '--no-warnings', '--experimental-loader', pathToFileURL(path.join(root, 'src/domain/combat/test-asset-loader.mjs')).href],
      version: VERSION,
    },
    runnerExecArgv: [], stepMs: 200, stepBudgetMs: 1_000, checkpointEveryMs: 60 * 60_000,
    maxUploadGzBytes: 50 * 1024 ** 2, maxSaveBytes: 400 * 1024 ** 2, retention: DEFAULT_RETENTION, trustProxy: true,
    log: () => undefined,
    ...overrides,
  };
}

/** A small production world left half an hour ago: the server has a real absence to live. */
function leftWorld(minutesAgo = 30): string {
  const base = createDefaultNewGameConfig({ seed: 'CLOUD-SERVER-TEST', factionId: 'aegis', playerName: 'Cloud QA' });
  const setup = { ...base, world: { ...base.world, galaxyCount: 1, npcCount: 4 } };
  const state = createInitialSaveState('production', Date.now() - minutesAgo * 60_000, setup);
  const storage = memoryStorage();
  const facade = createPersistenceFacade({ mode: 'production', storage, saveKey: 'save' });
  assert.equal(facade.write(state).ok, true);
  return storage.getItem('save')!;
}

const sha = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');

async function upload(base: string, id: string, text: string, headers: Record<string, string>) {
  const body = zlib.gzipSync(text);
  return fetch(`${base}/v1/campaigns/${id}/revisions`, {
    method: 'PUT', body,
    headers: {
      authorization: `Bearer ${KEY}`, 'content-type': 'application/gzip', 'x-asterion-game-version': VERSION, 'x-asterion-schema': '1',
      'x-asterion-digest': sha(text), 'x-asterion-device': DEVICE, 'x-asterion-world-at': '0', 'x-asterion-left': '0', 'x-asterion-base-revision': '0',
      'x-asterion-name': encodeURIComponent('Тест'), ...headers,
    },
  });
}

const api = (base: string, route: string, init: RequestInit = {}) => fetch(`${base}${route}`, {
  ...init, headers: { authorization: `Bearer ${KEY}`, 'content-type': 'application/json', ...(init.headers as Record<string, string> | undefined) },
});

async function waitFor<T>(read: () => Promise<T>, done: (value: T) => boolean, timeoutMs = 60_000): Promise<T> {
  const startedAt = Date.now();
  for (;;) {
    const value = await read();
    if (done(value)) return value;
    if (Date.now() - startedAt > timeoutMs) throw new Error(`Timed out: ${JSON.stringify(value).slice(0, 400)}`);
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
}

function load(text: string): SaveState {
  const storage = memoryStorage();
  storage.setItem('save', text);
  const loaded = createPersistenceFacade({ mode: 'production', storage, saveKey: 'save' }).load();
  assert.equal(loaded.status, 'loaded');
  return (loaded as { state: SaveState }).state;
}

test('access key, revision line, living world, claim, backups and restart', async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'asterion-cloud-'));
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  let cloud = createCloudServer(config(dataDir));
  let port = await cloud.listen();
  t.after(() => cloud.close());
  let base = `http://127.0.0.1:${port}`;
  const id = 'slot-test-0001';

  assert.equal((await fetch(`${base}/v1/health`)).status, 200);
  assert.equal((await fetch(`${base}/v1/campaigns`)).status, 401, 'no key: refused');
  assert.equal((await fetch(`${base}/v1/campaigns`, { headers: { authorization: 'Bearer wrong' } })).status, 401, 'wrong key: refused');
  assert.equal((await api(base, '/v1/campaigns/not-a-slot')).status, 404);

  const first = leftWorld();
  const firstUpload = await upload(base, id, first, {});
  assert.equal(firstUpload.status, 200, await firstUpload.clone().text());
  assert.equal((await firstUpload.json()).revision, 1);
  const stale = await upload(base, id, first, { 'x-asterion-base-revision': '0' });
  assert.equal(stale.status, 409, 'an upload that does not continue the head is refused');
  assert.equal((await stale.json()).error, 'stale-base');
  const bad = await upload(base, id, first, { 'x-asterion-base-revision': '1', 'x-asterion-digest': 'a'.repeat(64) });
  assert.equal(bad.status, 400, 'a body that does not match its digest is refused');

  // The player leaves: revision 2 comes alive.
  const left = leftWorld(30);
  const leftState = load(left);
  const leaving = await upload(base, id, left, { 'x-asterion-base-revision': '1', 'x-asterion-left': '1' });
  assert.equal(leaving.status, 200);
  assert.equal((await leaving.json()).campaign.live.status, 'running');
  const alive = await waitFor(async () => (await api(base, `/v1/campaigns/${id}`)).json(),
    (view) => view.live?.lagMs !== null && view.live?.lagMs < 5_000 && view.live.worldAt > leftState.npcReplay!.processedThroughAt);
  assert.equal(alive.head.revision, 2);

  const wrongVersion = await api(base, `/v1/campaigns/${id}/claim`, { method: 'POST', body: JSON.stringify({ baseRevision: 2, gameVersion: '9.9.9' }) });
  assert.equal(wrongVersion.status, 409);
  assert.equal((await wrongVersion.json()).error, 'version-mismatch', 'a different game version never takes the server world');
  const wrongBase = await api(base, `/v1/campaigns/${id}/claim`, { method: 'POST', body: JSON.stringify({ baseRevision: 1, gameVersion: VERSION }) });
  assert.equal(wrongBase.status, 409, 'a client holding an older revision does not take the world');

  const claimed = await api(base, `/v1/campaigns/${id}/claim`, { method: 'POST', body: JSON.stringify({ baseRevision: 2, gameVersion: VERSION }) });
  assert.equal(claimed.status, 200);
  assert.equal(claimed.headers.get('x-asterion-revision'), '3');
  assert.equal(claimed.headers.get('x-asterion-origin'), 'server');
  const text = zlib.gunzipSync(Buffer.from(await claimed.arrayBuffer())).toString('utf8');
  assert.equal(sha(text), claimed.headers.get('x-asterion-digest'));
  const world = load(text);
  const worldAt = world.npcReplay!.processedThroughAt;
  assert.ok(worldAt > leftState.npcReplay!.processedThroughAt + 29 * 60_000, 'the server lived the absence');
  assert.equal(world.npcReplay!.summary?.fromAt, leftState.npcReplay!.processedThroughAt, 'the world news start where the player left');

  // Quality: the same world a local catch-up of the same length makes from the same save.
  applyCampaignRuntimeForCatchup(leftState, worldAt);
  const local = await runNpcCatchup(freezeNpcCatchupTarget(leftState, worldAt), { now: () => worldAt });
  assert.equal(sha(serializeSaveForStorage(local.state, 'production')), sha(text), 'server world = local catch-up, byte for byte');
  // The bot journal (npc-journal.ts): written by the server while the player is away, handed out beside the world.
  const botJournal = await api(base, `/v1/campaigns/${id}/bot-journal`);
  assert.equal(botJournal.status, 200);
  const journalEntries = parseNpcJournalLines(await botJournal.text());
  assert.ok(journalEntries.some((entry) => entry.k === 'top'), 'the server keeps the bot journal while the player is away');
  assert.ok(journalEntries.every((entry) => entry.t <= worldAt), 'journal entries belong to the lived world');

  const after = await (await api(base, `/v1/campaigns/${id}`)).json();
  assert.equal(after.live, null, 'the relay is back with the client');
  assert.equal(after.head.revision, 3);
  assert.equal((await api(base, `/v1/campaigns/${id}/claim`, { method: 'POST', body: JSON.stringify({ baseRevision: 3, gameVersion: VERSION }) })).status, 204);

  // Left again, then the player comes back offline and uploads their own continuation: the server world becomes a backup.
  assert.equal((await upload(base, id, text, { 'x-asterion-base-revision': '3', 'x-asterion-left': '1' })).status, 200);
  await waitFor(async () => (await api(base, `/v1/campaigns/${id}`)).json(), (view) => view.live?.lagMs !== null && view.live?.lagMs < 5_000);
  // A restart in the middle (an update): the world checkpoints and resumes.
  await cloud.close();
  cloud = createCloudServer(config(dataDir));
  port = await cloud.listen();
  base = `http://127.0.0.1:${port}`;
  const resumed = await waitFor(async () => (await api(base, `/v1/campaigns/${id}`)).json(), (view) => view.live?.status === 'running' && view.live?.lagMs !== null && view.live?.lagMs < 5_000);
  assert.equal(resumed.live.baseRevision, 4);
  const own = await upload(base, id, text, { 'x-asterion-base-revision': '4' });
  assert.equal(own.status, 200);
  const view = (await own.json()).campaign;
  assert.equal(view.live, null);
  assert.equal(view.head.revision, 5);
  assert.ok(view.snapshots.some((snapshot: { kind: string; revision: number }) => snapshot.kind === 'backup' && snapshot.revision === 4), 'the server world is kept as a backup');
  const backup = view.snapshots.find((snapshot: { kind: string }) => snapshot.kind === 'backup');
  const download = await api(base, `/v1/campaigns/${id}/snapshots/${backup.id}`);
  assert.equal(download.status, 200);
  assert.equal(sha(zlib.gunzipSync(Buffer.from(await download.arrayBuffer())).toString('utf8')), backup.digest);

  // A forced upload (the player chose the local copy) keeps the replaced head as a backup.
  const forced = await upload(base, id, first, { 'x-asterion-base-revision': '2', 'x-asterion-force': '1' });
  assert.equal(forced.status, 200);
  const forcedView = (await forced.json()).campaign;
  assert.equal(forcedView.head.revision, 6);
  assert.equal(forcedView.head.parent, 2);
  assert.ok(forcedView.snapshots.some((snapshot: { kind: string; revision: number }) => snapshot.kind === 'backup' && snapshot.revision === 5));

  const status = await (await api(base, '/v1/status')).json();
  assert.equal(status.version, VERSION);
  assert.equal(status.campaigns, 1);
});

test('one living world: leaving another campaign finishes the first into a revision', async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'asterion-cloud-'));
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  const cloud = createCloudServer(config(dataDir));
  const base = `http://127.0.0.1:${await cloud.listen()}`;
  t.after(() => cloud.close());
  assert.equal((await upload(base, 'slot-a', leftWorld(5), { 'x-asterion-left': '1' })).status, 200);
  await waitFor(async () => (await api(base, '/v1/campaigns/slot-a')).json(), (view) => view.live?.lagMs !== null && view.live?.lagMs < 5_000);
  assert.equal((await upload(base, 'slot-b', leftWorld(5), { 'x-asterion-left': '1' })).status, 200);
  const a = await (await api(base, '/v1/campaigns/slot-a')).json();
  assert.equal(a.live, null);
  assert.equal(a.head.revision, 2);
  assert.equal(a.head.origin, 'server');
  assert.equal(cloud.liveCampaignId(), 'slot-b');
});

test('rate limit and the wrong-key lockout', async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'asterion-cloud-'));
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  const lines: string[] = [];
  const cloud = createCloudServer(config(dataDir, { log: (line) => lines.push(line) }));
  const base = `http://127.0.0.1:${await cloud.listen()}`;
  t.after(() => cloud.close());
  const statuses: number[] = [];
  for (let attempt = 0; attempt < 12; attempt += 1) statuses.push((await fetch(`${base}/v1/status`, { headers: { authorization: 'Bearer nope' } })).status);
  assert.deepEqual(statuses.slice(0, 10), Array(10).fill(401));
  assert.equal(statuses.at(-1), 429, 'ten wrong keys block the address');
  assert.equal((await api(base, '/v1/status')).status, 429, 'the right key from a blocked address waits too');
  assert.ok(lines.every((line) => !line.includes(KEY)), 'the key never reaches the log');
  assert.ok(lines.some((line) => line === 'asterion auth failed from 127.0.0.1'));
});

/** A save as the game reads it (a world resumed from a checkpoint went through a load). */
function loadedDigest(text: string): string {
  return sha(serializeSaveForStorage(load(text), 'production'));
}

async function claimWorld(base: string, id: string, baseRevision: number, gameVersion: string) {
  const response = await api(base, `/v1/campaigns/${id}/claim`, { method: 'POST', body: JSON.stringify({ baseRevision, gameVersion }) });
  if (response.status !== 200) return { status: response.status, body: await response.json() as { error: string } };
  const text = zlib.gunzipSync(Buffer.from(await response.arrayBuffer())).toString('utf8');
  assert.equal(sha(text), response.headers.get('x-asterion-digest'));
  return { status: 200, text, worldAt: Number(response.headers.get('x-asterion-world-at')), gameVersion: response.headers.get('x-asterion-game-version') };
}

test('an update of the server moves the living world to the new release: no progress lost, same world as a local catch-up', async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'asterion-cloud-'));
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  const NEXT = '1.3.0';
  // Every version runs this branch's runner: what is checked is the server's move, not two builds (tools/cloud-version-move.mjs runs real releases).
  const anyVersion = (version: string): Partial<ServerConfig> => ({ version, runnerOverride: { ...config(dataDir).runnerOverride!, version: undefined } });
  let cloud = createCloudServer(config(dataDir, anyVersion(VERSION)));
  let base = `http://127.0.0.1:${await cloud.listen()}`;
  t.after(() => cloud.close());
  const id = 'slot-update-0001';
  const left = leftWorld(40);
  const leftState = load(left);
  assert.equal((await upload(base, id, left, { 'x-asterion-left': '1' })).status, 200);
  await waitFor(async () => (await api(base, `/v1/campaigns/${id}`)).json(), (view) => view.live?.lagMs !== null && view.live?.lagMs < 5_000);

  // The game updated before the server did: it may not take the world, and the server asks for its own update.
  const early = await claimWorld(base, id, 1, NEXT);
  assert.equal(early.status, 409);
  assert.equal(early.body!.error, 'version-mismatch');
  assert.equal(fs.readFileSync(path.join(dataDir, 'update-request'), 'utf8').trim(), NEXT, 'a newer game asks the server to update');
  fs.rmSync(path.join(dataDir, 'update-request'));
  const asked = await (await api(base, '/v1/update-request', { method: 'POST', body: JSON.stringify({ gameVersion: NEXT }) })).json();
  assert.deepEqual(asked, { requested: true, serverVersion: VERSION });
  assert.ok(fs.existsSync(path.join(dataDir, 'update-request')));
  fs.rmSync(path.join(dataDir, 'update-request'));
  const older = await (await api(base, '/v1/update-request', { method: 'POST', body: JSON.stringify({ gameVersion: '1.0.0' }) })).json();
  assert.equal(older.requested, false, 'an older game asks for nothing');

  // asterion-update restarts the service: the old runner checkpoints, the new server moves the world.
  await cloud.close();
  const before = JSON.parse(fs.readFileSync(path.join(dataDir, 'campaigns', id, 'campaign.json'), 'utf8')).live;
  assert.equal(before.gameVersion, VERSION);
  assert.ok(before.checkpointWorldAt > leftState.npcReplay!.processedThroughAt, 'the old runner checkpointed its progress');
  cloud = createCloudServer(config(dataDir, anyVersion(NEXT)));
  base = `http://127.0.0.1:${await cloud.listen()}`;
  const moved = await waitFor(async () => (await api(base, `/v1/campaigns/${id}`)).json(),
    (view) => view.live?.status === 'running' && view.live?.lagMs !== null && view.live.lagMs < 5_000);
  assert.equal(moved.live.gameVersion, NEXT);
  assert.equal(moved.live.migratedFrom, VERSION);
  assert.ok(moved.live.worldAt >= before.checkpointWorldAt, 'the world time never goes back across the update');

  // An older game does not take the new release's world (and asks for no update); the updated game takes it.
  const stale = await claimWorld(base, id, 1, VERSION);
  assert.equal(stale.status, 409);
  assert.equal(fs.existsSync(path.join(dataDir, 'update-request')), false);
  const taken = await claimWorld(base, id, 1, NEXT);
  assert.equal(taken.status, 200);
  assert.equal(taken.gameVersion, NEXT);
  assert.ok(taken.worldAt! >= before.checkpointWorldAt);
  const world = load(taken.text!);
  assert.equal(world.npcReplay!.summary?.fromAt, leftState.npcReplay!.processedThroughAt, 'one absence from where the player left, across the update');

  // Quality: the same world a local catch-up of the whole absence makes from the left save.
  const local = load(left);
  applyCampaignRuntimeForCatchup(local, taken.worldAt!);
  const caughtUp = await runNpcCatchup(freezeNpcCatchupTarget(local, taken.worldAt!), { now: () => taken.worldAt! });
  assert.equal(loadedDigest(taken.text!), loadedDigest(serializeSaveForStorage(caughtUp.state, 'production')), 'server world across the update = local catch-up');
});

test('a new release that cannot load the world: it goes on in the release it lived in', async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'asterion-cloud-'));
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  let cloud = createCloudServer(config(dataDir));
  let base = `http://127.0.0.1:${await cloud.listen()}`;
  t.after(() => cloud.close());
  const id = 'slot-update-0002';
  assert.equal((await upload(base, id, leftWorld(10), { 'x-asterion-left': '1' })).status, 200);
  await waitFor(async () => (await api(base, `/v1/campaigns/${id}`)).json(), (view) => view.live?.lagMs !== null && view.live?.lagMs < 5_000);
  await cloud.close();
  // Release 1.4.0's runner dies at once; 1.2.3 keeps its runner (the override).
  fs.mkdirSync(path.join(dataDir, 'releases', '1.4.0'), { recursive: true });
  fs.writeFileSync(path.join(dataDir, 'releases', '1.4.0', 'runner.mjs'), 'process.exit(3);\n');
  cloud = createCloudServer(config(dataDir, { version: '1.4.0' }));
  base = `http://127.0.0.1:${await cloud.listen()}`;
  const back = await waitFor(async () => (await api(base, `/v1/campaigns/${id}`)).json(),
    (view) => view.live?.gameVersion === VERSION && view.live?.status === 'running' && view.live?.lagMs !== null && view.live.lagMs < 5_000);
  assert.equal(back.live.gameVersion, VERSION);
  const stored = JSON.parse(fs.readFileSync(path.join(dataDir, 'campaigns', id, 'campaign.json'), 'utf8')).live;
  assert.match(stored.migrationError, /exited \(3\)/);
  assert.equal((await claimWorld(base, id, 1, VERSION)).status, 200, 'the game of its version takes it as before');
});

test('a world left by a game older than every kept release goes on in this release', async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'asterion-cloud-'));
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  const CURRENT = '1.4.0';
  const cloud = createCloudServer(config(dataDir, { version: CURRENT, runnerOverride: { ...config(dataDir).runnerOverride!, version: CURRENT } }));
  const base = `http://127.0.0.1:${await cloud.listen()}`;
  t.after(() => cloud.close());
  const id = 'slot-old-game-0001';
  assert.equal((await upload(base, id, leftWorld(10), { 'x-asterion-left': '1', 'x-asterion-game-version': VERSION })).status, 200);
  const view = await waitFor(async () => (await api(base, `/v1/campaigns/${id}`)).json(),
    (item) => item.live?.status === 'running' && item.live?.lagMs !== null && item.live.lagMs < 5_000);
  assert.equal(view.live.gameVersion, CURRENT);
  assert.equal(view.live.migratedFrom, VERSION);
  assert.ok(!fs.existsSync(path.join(dataDir, 'update-request')), 'no update is asked for: there is no such release to wait for');
});

test('a world far behind the clock reports how fast the server catches it up', async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'asterion-cloud-'));
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  // A tiny compute budget per step and a long absence: the catch-up takes a while, as on a slow server with a late world.
  const cloud = createCloudServer(config(dataDir, { stepBudgetMs: 15 }));
  const base = `http://127.0.0.1:${await cloud.listen()}`;
  t.after(() => cloud.close());
  const id = 'slot-catchup-0001';
  assert.equal((await upload(base, id, leftWorld(3 * 24 * 60), { 'x-asterion-left': '1' })).status, 200);
  const measured = await waitFor(async () => (await api(base, `/v1/campaigns/${id}`)).json(),
    (view) => (view.live?.rate ?? null) !== null || (view.live?.lagMs !== null && view.live?.lagMs < 5_000), 120_000);
  assert.ok(measured.live.lagMs > 2 * 60_000, `still catching up when the speed is known (lag ${measured.live.lagMs})`);
  assert.ok(measured.live.rate > 1, 'faster than the clock');
  assert.ok(measured.live.etaMs > 0);
  const status = await (await api(base, '/v1/status')).json();
  assert.equal(status.live.campaignId, id);
  assert.ok(status.live.rate > 1);
});

/* ---------------------------------------------------------------- crashes */

const FAULT_RUNNER = path.join(here, 'runner-fault.test-support.ts');

/** A server whose runner dies as `faultFile` says; it checkpoints on every tick and waits little between attempts. */
function faultConfig(dataDir: string, overrides: Partial<ServerConfig> = {}): ServerConfig {
  const base = config(dataDir);
  return config(dataDir, {
    runnerOverride: { ...base.runnerOverride!, script: FAULT_RUNNER },
    checkpointEveryMs: 1,
    restart: { backoffMs: [150, 300], maxAttempts: 6, sameSpotMs: 30 * 60_000 },
    ...overrides,
  });
}

function setFault(file: string, fault: { crashes: number; afterStatuses: number }): void {
  const current = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) as { done?: number } : {};
  fs.writeFileSync(file, JSON.stringify({ ...fault, ...(current.done ? { done: current.done } : {}) }));
}

const readCrashes = (dataDir: string, id: string): Array<{ error: string; verdict: string; attempt: number; worldAt: number }> => {
  try { return JSON.parse(fs.readFileSync(path.join(dataDir, 'campaigns', id, 'crash.json'), 'utf8')).crashes; } catch { return []; }
};

/** The world a local catch-up of the same save to the same moment makes, as the game would store it after a load. */
async function localDigestAt(left: string, worldAt: number): Promise<string> {
  const local = load(left);
  applyCampaignRuntimeForCatchup(local, worldAt);
  const caughtUp = await runNpcCatchup(freezeNpcCatchupTarget(local, worldAt), { now: () => worldAt });
  return loadedDigest(serializeSaveForStorage(caughtUp.state, 'production'));
}

const settled = (view: { live?: { status: string; lagMs: number | null } | null }) => view.live?.status === 'running' && view.live.lagMs !== null && view.live.lagMs < 5_000;

for (const [label, afterStatuses] of [['before any checkpoint (the revision it started at)', 0], ['after checkpoints (the last checkpoint)', 2]] as const) {
  test(`a runner that dies in the middle of a step is raised again ${label}: the world equals one that never crashed`, async (t) => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'asterion-cloud-'));
    const faultFile = path.join(dataDir, 'fault.json');
    setFault(faultFile, { crashes: 1, afterStatuses });
    process.env.ASTERION_TEST_FAULT = faultFile;
    const lines: string[] = [];
    const cloud = createCloudServer(faultConfig(dataDir, { log: (line) => lines.push(line) }));
    const base = `http://127.0.0.1:${await cloud.listen()}`;
    t.after(() => { delete process.env.ASTERION_TEST_FAULT; return cloud.close().finally(() => fs.rmSync(dataDir, { recursive: true, force: true })); });
    const id = 'slot-crash-0001';
    const left = leftWorld(30);
    assert.equal((await upload(base, id, left, { 'x-asterion-left': '1' })).status, 200);

    const recovered = await waitFor(async () => (await api(base, `/v1/campaigns/${id}`)).json(),
      (view) => view.live?.recovery?.recoveredAt !== undefined && settled(view), 90_000);
    assert.equal(recovered.live.recovery.restarts, 1);
    assert.ok(recovered.live.recovery.stalledAt > 0 && recovered.live.recovery.recoveredAt >= recovered.live.recovery.stalledAt);
    assert.equal(recovered.live.error, undefined);
    assert.equal(JSON.stringify(recovered).includes('Injected'), false, 'the player never sees the error text');
    const crashes = readCrashes(dataDir, id);
    assert.equal(crashes.length, 1);
    assert.match(crashes[0]!.error, /Injected fault #1 in the middle of a step[\s\S]+\n\s+at /, 'the diagnostics keep the error and its stack');
    assert.ok(lines.some((line) => /runner crashed .* attempt 1\/6/.test(line)));
    assert.equal(fs.existsSync(path.join(dataDir, 'campaigns', id, 'crash-checkpoint.json.gz')), false, 'nothing given up on: no crash checkpoint');
    const starts = lines.filter((line) => line.includes(': started ('));
    assert.equal(starts.length, 2);
    assert.match(starts[1]!, afterStatuses === 0 ? /from revision 1/ : /from checkpoint/, 'the restart resumed from where the label says');

    const journal = (await (await api(base, `/v1/campaigns/${id}/bot-journal`)).text()).split('\n').filter(Boolean);
    assert.ok(journal.length > 0);
    assert.equal(new Set(journal).size, journal.length, 'the bot journal has no line twice: what the crashed runner wrote past the resume point was dropped');
    const taken = await claimWorld(base, id, 1, VERSION);
    assert.equal(taken.status, 200);
    assert.equal(loadedDigest(taken.text!), await localDigestAt(left, taken.worldAt!), 'after the crash and the restart: byte for byte the world of a run without the crash');
  });
}

test('the same error at the same place of the world stops the restarts: failed with a reason, evidence kept, raised by hand', async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'asterion-cloud-'));
  const faultFile = path.join(dataDir, 'fault.json');
  setFault(faultFile, { crashes: 99, afterStatuses: 1 });
  process.env.ASTERION_TEST_FAULT = faultFile;
  const cloud = createCloudServer(faultConfig(dataDir));
  const base = `http://127.0.0.1:${await cloud.listen()}`;
  t.after(() => { delete process.env.ASTERION_TEST_FAULT; return cloud.close().finally(() => fs.rmSync(dataDir, { recursive: true, force: true })); });
  const id = 'slot-crash-0002';
  const left = leftWorld(30);
  assert.equal((await upload(base, id, left, { 'x-asterion-left': '1' })).status, 200);

  const failed = await waitFor(async () => (await api(base, `/v1/campaigns/${id}`)).json(), (view) => view.live?.status === 'failed', 90_000);
  assert.match(failed.live.error, /дважды остановился на одном и том же месте/);
  assert.equal(failed.live.recovery.restarts, 2);
  assert.equal(readCrashes(dataDir, id).length, 2);
  assert.ok(fs.existsSync(path.join(dataDir, 'campaigns', id, 'crash-checkpoint.json.gz')), 'the checkpoint is kept next to the campaign');
  await new Promise((resolve) => setTimeout(resolve, 1_000));
  assert.equal(readCrashes(dataDir, id).length, 2, 'no attempts after giving up');
  assert.equal((await (await api(base, `/v1/campaigns/${id}`)).json()).live.status, 'failed');

  // The operator raises it (the fault is gone): from the checkpoint, once.
  setFault(faultFile, { crashes: 0, afterStatuses: 1 });
  const raised = await api(base, `/v1/campaigns/${id}/recover`, { method: 'POST', body: '{}' });
  assert.equal(raised.status, 200);
  assert.equal((await raised.json()).from, 'checkpoint');
  const again = await api(base, `/v1/campaigns/${id}/recover`, { method: 'POST', body: '{}' });
  assert.equal(again.status, 409);
  assert.equal((await again.json()).error, 'already-running');
  const back = await waitFor(async () => (await api(base, `/v1/campaigns/${id}`)).json(), settled, 90_000);
  assert.equal(back.live.error, undefined);
  const taken = await claimWorld(base, id, 1, VERSION);
  assert.equal(taken.status, 200);
  assert.equal(loadedDigest(taken.text!), await localDigestAt(left, taken.worldAt!), 'raised by hand: the same world as without the crashes');
  assert.equal((await api(base, '/v1/campaigns/slot-none/recover', { method: 'POST', body: '{}' })).status, 404);
});

test('a world given up on tries again when the server is updated', async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'asterion-cloud-'));
  const faultFile = path.join(dataDir, 'fault.json');
  setFault(faultFile, { crashes: 99, afterStatuses: 0 });
  process.env.ASTERION_TEST_FAULT = faultFile;
  let cloud = createCloudServer(faultConfig(dataDir));
  let base = `http://127.0.0.1:${await cloud.listen()}`;
  t.after(() => { delete process.env.ASTERION_TEST_FAULT; return cloud.close().finally(() => fs.rmSync(dataDir, { recursive: true, force: true })); });
  const id = 'slot-crash-0003';
  assert.equal((await upload(base, id, leftWorld(20), { 'x-asterion-left': '1' })).status, 200);
  await waitFor(async () => (await api(base, `/v1/campaigns/${id}`)).json(), (view) => view.live?.status === 'failed', 90_000);
  await cloud.close();

  // The same release restarts (a reboot): still given up on. A newer release (the fix) tries again.
  cloud = createCloudServer(faultConfig(dataDir));
  base = `http://127.0.0.1:${await cloud.listen()}`;
  assert.equal((await (await api(base, `/v1/campaigns/${id}`)).json()).live.status, 'failed');
  await cloud.close();
  setFault(faultFile, { crashes: 0, afterStatuses: 0 });
  const NEXT = '1.2.4';
  cloud = createCloudServer(faultConfig(dataDir, { version: NEXT, runnerOverride: { ...faultConfig(dataDir).runnerOverride!, version: undefined } }));
  base = `http://127.0.0.1:${await cloud.listen()}`;
  const back = await waitFor(async () => (await api(base, `/v1/campaigns/${id}`)).json(), settled, 90_000);
  assert.equal(back.live.gameVersion, NEXT);
  assert.equal(back.live.error, undefined);
});

test('restart plan: pauses grow, the same error at the same place stops, a different one counts, too many in a row stops', () => {
  const policy = { backoffMs: [5_000, 15_000, 45_000], maxAttempts: 4, sameSpotMs: 30 * 60_000 };
  const at = 1_000_000;
  const first = planCrash(undefined, { at, worldAt: 100, headline: 'boom #' }, policy, '1.0.0');
  assert.equal(first.failedReason, null);
  assert.equal(first.delayMs, 5_000);
  assert.equal(first.recovery.nextAttemptAt, at + 5_000);
  const second = planCrash(first.recovery, { at: at + 10_000, worldAt: 100 + 40 * 60_000, headline: 'other #' }, policy, '1.0.0');
  assert.equal(second.failedReason, null, 'another error is not a repeat');
  assert.equal(second.delayMs, 15_000);
  assert.equal(second.recovery.stalledAt, at, 'one stall: it began at the first crash');
  assert.equal(second.recovery.total, 2);
  const third = planCrash(second.recovery, { at: at + 40_000, worldAt: 100 + 50 * 60_000, headline: 'x #' }, policy, '1.0.0');
  const fourth = planCrash(third.recovery, { at: at + 90_000, worldAt: 100 + 130 * 60_000, headline: 'y #' }, policy, '1.0.0');
  assert.equal(fourth.delayMs, 45_000, 'the last pause repeats');
  const fifth = planCrash(fourth.recovery, { at: at + 200_000, worldAt: 100 + 230 * 60_000, headline: 'z #' }, policy, '1.0.0');
  assert.equal(fifth.failedReason, 'too-many');
  assert.equal(fifth.recovery.failedOnVersion, '1.0.0');
  const repeat = planCrash(first.recovery, { at: at + 10_000, worldAt: 100 + 5 * 60_000, headline: 'boom #' }, policy, '1.0.0');
  assert.equal(repeat.failedReason, 'same-spot');
  const healthy = planCrash({ ...first.recovery, consecutive: 0 }, { at: at + 10_000, worldAt: 100, headline: 'boom #' }, policy, '1.0.0');
  assert.equal(healthy.failedReason, null, 'after a healthy run the same error is a new stall');
  assert.equal(healthy.recovery.stalledAt, at + 10_000);
  assert.equal(errorHeadline('Injected fault #12 at 1730000000000\n  at x'), 'Injected fault ## at #');
});

test('recover-world.sh raises a failed world through the server and never prints the key', async (t) => {
  const bash = spawnSync('bash', ['--version']);
  if (bash.error) return t.skip('no bash on this machine');
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'asterion-cloud-'));
  const faultFile = path.join(dataDir, 'fault.json');
  setFault(faultFile, { crashes: 99, afterStatuses: 1 });
  process.env.ASTERION_TEST_FAULT = faultFile;
  const cloud = createCloudServer(faultConfig(dataDir));
  const port = await cloud.listen();
  const base = `http://127.0.0.1:${port}`;
  t.after(() => { delete process.env.ASTERION_TEST_FAULT; return cloud.close().finally(() => fs.rmSync(dataDir, { recursive: true, force: true })); });
  const keyFile = path.join(dataDir, 'access-key');
  fs.writeFileSync(keyFile, `${KEY}\n`);
  const id = 'slot-crash-0004';
  assert.equal((await upload(base, id, leftWorld(20), { 'x-asterion-left': '1' })).status, 200);
  await waitFor(async () => (await api(base, `/v1/campaigns/${id}`)).json(), (view) => view.live?.status === 'failed', 90_000);
  setFault(faultFile, { crashes: 0, afterStatuses: 1 });

  // Asynchronous: the server under test lives in this process.
  const run = (args: string[], env: Record<string, string> = {}) => new Promise<{ status: number | null; stdout: string; stderr: string }>((resolve) => {
    execFile('bash', [path.join(root, 'server/deploy/recover-world.sh'), '--local', ...args],
      { env: { ...process.env, ASTERION_URL: base, ASTERION_KEY_FILE: keyFile, ...env } },
      (error, stdout, stderr) => resolve({ status: error ? (typeof error.code === 'number' ? error.code : 1) : 0, stdout, stderr }));
  });
  const wrongKey = path.join(dataDir, 'wrong-key');
  fs.writeFileSync(wrongKey, 'x'.repeat(40));
  const refused = await run([], { ASTERION_KEY_FILE: wrongKey });
  assert.notEqual(refused.status, 0, 'a wrong key raises nothing');
  assert.equal(`${refused.stdout}${refused.stderr}`.includes(KEY), false);
  const done = await run([]);
  assert.equal(done.status, 0, done.stderr);
  assert.match(done.stdout, /Мир slot-crash-0004 поднят \(с контрольной точки\)/);
  assert.equal(`${done.stdout}${done.stderr}`.includes(KEY), false, 'the key is never printed');
  await waitFor(async () => (await api(base, `/v1/campaigns/${id}`)).json(), settled, 90_000);
  const nothing = await run([]);
  assert.equal(nothing.status, 0);
  assert.match(nothing.stdout, /поднимать нечего/);
});

/* ------------------------------------------------------------------ lease and takeover */

const LEASE_MS = 1_500;
const takeoverConfig = (overrides: Partial<ServerConfig> = {}): Partial<ServerConfig> => ({ leaseMs: LEASE_MS, leaseCheckMs: 150, ...overrides });

const heartbeat = (base: string, id: string, body: Record<string, unknown>) => api(base, `/v1/campaigns/${id}/heartbeat`, {
  method: 'POST', body: JSON.stringify({ deviceId: DEVICE, baseRevision: 1, gameVersion: VERSION, clockOffsetMs: 0, ...body }),
});

/** The first place two JSON texts differ (a readable failure for «the same world»). */
function firstDiff(left: string, right: string, path = ''): string | null {
  const [a, b] = [JSON.parse(left) as unknown, JSON.parse(right) as unknown];
  const walk = (x: unknown, y: unknown, at: string): string | null => {
    if (JSON.stringify(x) === JSON.stringify(y)) return null;
    if (x && y && typeof x === 'object' && typeof y === 'object') {
      for (const key of new Set([...Object.keys(x as object), ...Object.keys(y as object)])) {
        const found = walk((x as Record<string, unknown>)[key], (y as Record<string, unknown>)[key], `${at}.${key}`);
        if (found) return found;
      }
    }
    return `${at}: ${JSON.stringify(x)?.slice(0, 120)} <> ${JSON.stringify(y)?.slice(0, 120)}`;
  };
  return walk(a, b, path);
}

const view = async (base: string, id: string) => (await api(base, `/v1/campaigns/${id}`)).json();

/** The world the game would have after a local catch-up from `text` to `target`, without the news summary (a hand-over closes it). */
async function localWorldText(text: string, target: number): Promise<string> {
  const state = load(text);
  applyCampaignRuntimeForCatchup(state, target);
  const caught = await runNpcCatchup(freezeNpcCatchupTarget(state, target), { now: () => target });
  return withoutSummary(serializeSaveForStorage(caught.state as SaveState, 'production'));
}

/** The physical world as npc-catchup-slicing.test.ts compares it: what a time slice may legitimately move (the replay cursor's last step, report metadata) is left out. */
async function physicalWorld(text: string, target: number): Promise<unknown> {
  const state = load(text);
  applyCampaignRuntimeForCatchup(state, target);
  const caught = (await runNpcCatchup(freezeNpcCatchupTarget(state, target), { now: () => target })).state as SaveState;
  // The clock tick that follows a catch-up brings every planet up to the same instant.
  const world = reconcileRuntime(caught, { planetId: caught.currentPlanetId, now: target, mode: 'production', testTimeScale: 1 }).state;
  return JSON.parse(JSON.stringify({
    npc: world.npc, npcScience: world.npcScience,
    targets: Object.fromEntries(Object.entries(world.espionage?.targets ?? {}).map(([id, entry]) => [id, { ...entry, repair: undefined }])),
    flights: world.flights.records, missions: world.espionage?.missions, spyReports: world.espionage?.reports,
    command: world.command, pirate: world.pirate, exploration: world.exploration, asteroids: world.asteroidSimulation,
    battles: world.combat.reports.map((report) => report.id), rating: world.rating,
  }));
}

/** A hand-over closes the absence's news summary; a game that never left keeps it open: everything else must be equal. */
function withoutSummary(text: string): string {
  const walk = (value: unknown): void => {
    if (!value || typeof value !== 'object') return;
    const record = value as Record<string, unknown>;
    if (record.npcReplay && typeof record.npcReplay === 'object') delete (record.npcReplay as Record<string, unknown>).summary;
    for (const child of Object.values(record)) walk(child);
  };
  const parsed = JSON.parse(text) as unknown;
  walk(parsed);
  return JSON.stringify(parsed);
}
const localWorld = localWorldText;

test('a game that goes silent loses the campaign to the server; heartbeats keep it; the world equals a local catch-up', async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'asterion-cloud-'));
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  const cloud = createCloudServer(config(dataDir, takeoverConfig()));
  const base = `http://127.0.0.1:${await cloud.listen()}`;
  t.after(() => cloud.close());
  const id = 'slot-lease-0001';
  const text = leftWorld(40);
  const saved = load(text);
  // A plain upload (the player is still in the game): no living world, but the game now holds the campaign.
  assert.equal((await upload(base, id, text, {})).status, 200);
  const held = await view(base, id);
  assert.equal(held.live, null);
  assert.equal(held.lease.deviceId, DEVICE);
  assert.equal((await heartbeat(base, id, { baseRevision: 0 })).status, 409, 'a heartbeat for another revision is refused');

  // Heartbeats for longer than the lease keep the world with the game.
  for (let beat = 0; beat < 4; beat += 1) {
    await new Promise((resolve) => setTimeout(resolve, LEASE_MS / 2));
    const answer = await heartbeat(base, id, {});
    assert.equal(answer.status, 200);
    assert.equal((await answer.json()).takenOver, false);
  }
  assert.equal((await view(base, id)).live, null, 'a game that keeps reporting keeps its world');
  const other = await heartbeat(base, id, { deviceId: 'device-other-0002' });
  assert.equal(other.status, 409, 'two computers: the second does not take the campaign from the first');
  assert.equal((await other.json()).error, 'other-device');

  // Silence: the server carries on from the last uploaded revision.
  const lived = await waitFor(() => view(base, id), (value) => value.live?.lagMs !== null && value.live?.lagMs < 5_000 && value.live.worldAt > saved.npcReplay!.processedThroughAt + 30 * 60_000);
  assert.equal(lived.live.baseRevision, 1);
  assert.equal(lived.lease, null);
  assert.equal(cloud.liveCampaignId(), id);
  // The game that is still there is told, and its own save wins over the server's world (kept as a backup).
  const late = await heartbeat(base, id, {});
  assert.equal((await late.json()).takenOver, true);

  const claimed = await claimWorld(base, id, 1, VERSION);
  assert.equal(claimed.status, 200);
  const localText = await localWorldText(text, claimed.worldAt!);
  assert.equal(withoutSummary(claimed.text!), localText, `${firstDiff(withoutSummary(claimed.text!), localText)} -- server takeover = local catch-up from the same save, byte for byte`);
});

test('the client returns while the server is still catching up: what is left replays locally to the same world', async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'asterion-cloud-'));
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  const cloud = createCloudServer(config(dataDir, takeoverConfig({ stepBudgetMs: 60 })));
  const base = `http://127.0.0.1:${await cloud.listen()}`;
  t.after(() => cloud.close());
  const id = 'slot-lease-0002';
  const text = leftWorld(24 * 60);
  const saved = load(text);
  assert.equal((await upload(base, id, text, {})).status, 200);
  const midway = await waitFor(() => view(base, id), (value) => value.live?.worldAt > saved.npcReplay!.processedThroughAt + 3_600_000 && value.live.lagMs > 3 * 3_600_000);
  assert.equal(midway.live.baseRevision, 1);
  const claimed = await claimWorld(base, id, 1, VERSION);
  assert.equal(claimed.status, 200);
  assert.ok(claimed.worldAt! < Date.now() - 3_600_000, 'the claim came in the middle of the catch-up');
  const target = Date.now();
  // The game continues the handed-over world to now; a game that never left it replays the whole absence itself: the same world.
  const [continued, whole] = [await physicalWorld(claimed.text!, target) as Record<string, unknown>, await physicalWorld(text, target) as Record<string, unknown>];
  for (const key of Object.keys(whole)) {
    assert.deepEqual(continued[key], whole[key], `${key}: any time slicing gives the same physical world`);
  }
});

test('a world left by an older game moves to this release on takeover, and the played-last campaign lives', async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'asterion-cloud-'));
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  const cloud = createCloudServer(config(dataDir, takeoverConfig()));
  const base = `http://127.0.0.1:${await cloud.listen()}`;
  t.after(() => cloud.close());
  // An old campaign lives (its player left it).
  assert.equal((await upload(base, 'slot-old-0001', leftWorld(5), { 'x-asterion-left': '1' })).status, 200);
  await waitFor(() => view(base, 'slot-old-0001'), (value) => value.live?.lagMs !== null && value.live?.lagMs < 5_000);
  assert.equal(cloud.liveCampaignId(), 'slot-old-0001');
  // The player plays another one, saved by an older game version: the idle world is finished at once (its memory is free).
  const text = leftWorld(40);
  assert.equal((await upload(base, 'slot-new-0001', text, { 'x-asterion-game-version': '1.0.0' })).status, 200);
  await waitFor(async () => cloud.liveCampaignId(), (value) => value === null);
  const old = await view(base, 'slot-old-0001');
  assert.equal(old.live, null);
  assert.equal(old.head.origin, 'server', 'the idle campaign is a finished revision');
  // Silence: the campaign played last lives, in this release.
  const lived = await waitFor(() => view(base, 'slot-new-0001'), (value) => value.live?.lagMs !== null && value.live?.lagMs < 5_000);
  assert.equal(cloud.liveCampaignId(), 'slot-new-0001');
  assert.equal(lived.live.gameVersion, VERSION);
  assert.equal(lived.live.migratedFrom, '1.0.0');
  assert.equal((await claimWorld(base, 'slot-new-0001', 1, VERSION)).status, 200);
});
