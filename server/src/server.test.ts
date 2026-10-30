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
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createCloudServer, type ServerConfig } from './server.ts';
import { DEFAULT_RETENTION } from './store.ts';
import { memoryStorage } from '../../src/application/npc-runtime.test-support.ts';
import { createDefaultNewGameConfig } from '../../src/domain/world/config.ts';
import { createInitialSaveState, createPersistenceFacade, serializeSaveForStorage } from '../../src/application/persistence.ts';
import { freezeNpcCatchupTarget } from '../../src/application/npc-catchup.ts';
import { runNpcCatchup } from '../../src/application/npc-catchup-runner.ts';
import { applyCampaignRuntimeForCatchup } from '../../src/application/npc-catchup-runner.ts';
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
