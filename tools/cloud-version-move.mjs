// The production case of 31.10.2026 on this computer: the cloud server runs
// release 1.1.0 and keeps a world alive in the runner of release 1.0.2 (the
// game version the player left it with). Its self-update installs this
// branch's server; the new server must move the living world to its own
// release without losing what the old runner computed.
//
//   npm run cloud:version-move -- --fixture=late-game-day-1.json [--behind-hours=3]
//       [--old-seconds=60] [--new-seconds=60] [--as-version=1.2.0]
//
// Downloads asterion-server-1.0.2.tgz and asterion-server-1.1.0.tgz from the
// public GitHub releases (gh), builds this branch's bundle as --as-version,
// and runs them as asterion-update would lay them out: <tmp>/releases/X.Y.Z.
// The old server is stopped the hard way (on Windows a process cannot catch
// SIGTERM): the 1.0.2 runner writes its checkpoint when its supervisor goes
// away (runner.ts 'disconnect'), which also covers a crash on the VPS. Prints
// one JSON line: the world times before and after the move and whether the
// claimed world equals this branch's own continuation of the old runner's
// checkpoint (after load, as the game reads a save).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { spawn, spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createPersistenceFacade, serializeSaveForStorage } from '../src/application/persistence.ts';
import { applyCampaignRuntimeForCatchup } from '../src/application/npc-catchup-runner.ts';
import { advanceLiveWorld, finishLiveWorld } from '../src/application/npc-live-world.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const option = (name, fallback) => {
  const raw = args.find((arg) => arg.startsWith(`--${name}=`));
  return raw ? raw.slice(name.length + 3) : fallback;
};
const fixture = option('fixture');
if (!fixture) { console.error('Usage: --fixture=<schema 28 save.json> [--behind-hours=3]'); process.exit(2); }
const behindMs = Number(option('behind-hours', '3')) * 3_600_000;
const oldSeconds = Number(option('old-seconds', '60'));
const newSeconds = Number(option('new-seconds', '60'));
const NEW = option('as-version', '1.2.0');
const OLD_SERVER = '1.1.0';
const OLD_GAME = '1.0.2';
const sha = (text) => createHash('sha256').update(text, 'utf8').digest('hex');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const log = (...parts) => process.stderr.write(`${new Date().toISOString().slice(11, 19)} ${parts.join(' ')}\n`);
const cursorOf = (text) => Number((/"npcReplay":\{"version":1,"processedThroughAt":(\d+)/.exec(text) ?? [])[1] ?? 0);
const minutes = (ms) => +(ms / 60_000).toFixed(1);

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'asterion-version-move-'));
const releases = path.join(temp, 'releases');
const dataDir = path.join(temp, 'data');
fs.mkdirSync(dataDir, { recursive: true });
const keyFile = path.join(temp, 'access-key');
const key = randomBytes(36).toString('base64url');
fs.writeFileSync(keyFile, key);

// The two published releases, as asterion-update installs them.
for (const version of [OLD_GAME, OLD_SERVER]) {
  const download = path.join(temp, `download-${version}`);
  fs.mkdirSync(download, { recursive: true });
  const got = spawnSync('gh', ['release', 'download', `v${version}`, '-R', 'ratoker-jpg/Asterion', '-p', `asterion-server-${version}.tgz`, '-D', download], { encoding: 'utf8' });
  if (got.status !== 0) throw new Error(`gh release download v${version}: ${got.stderr}`);
  fs.mkdirSync(path.join(releases, version), { recursive: true });
  // Relative paths: GNU tar reads «D:» as a remote host.
  const unpacked = spawnSync('tar', ['-xzf', `asterion-server-${version}.tgz`, '-C', path.relative(download, path.join(releases, version)).split(path.sep).join('/')], { cwd: download, encoding: 'utf8' });
  if (unpacked.status !== 0) throw new Error(`tar ${version}: ${unpacked.stderr}`);
}
// This branch's server as the release the update brings.
const built = spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'build:server'], { cwd: ROOT, encoding: 'utf8', shell: true, env: { ...process.env, ASTERION_VERSION: NEW } });
if (built.status !== 0) throw new Error(`build:server: ${built.stderr || built.stdout}`);
fs.cpSync(path.join(ROOT, 'dist-server'), path.join(releases, NEW), { recursive: true });
log(`releases: ${fs.readdirSync(releases).join(', ')}`);

// systemd stops the service with SIGTERM, which the server handles (checkpoint, then exit). Windows cannot
// deliver signals to another process, so each bundle runs under this wrapper: «stop» on stdin raises the
// same handler.
const stopWrapper = path.join(temp, 'stop-wrapper.mjs');
fs.writeFileSync(stopWrapper, [
  "import { pathToFileURL } from 'node:url';",
  'const target = process.argv[2];',
  'process.argv.splice(1, 2, target);',
  'await import(pathToFileURL(target).href);',
  "process.stdin.on('data', (chunk) => { if (String(chunk).includes('stop')) process.emit('SIGTERM'); });",
].join(String.fromCharCode(10)));
// Each bundle reports its own compiled version.
const { ASTERION_VERSION: _ignored, ...bundleEnv } = process.env;
let server = null;
let port = 0;
const serverLog = path.join(temp, 'server.log');
async function start(version) {
  port = port || 18_700 + Math.floor(Math.random() * 500);
  server = spawn(process.execPath, [stopWrapper, path.join(releases, version, 'server.mjs')], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...bundleEnv, ASTERION_DATA: dataDir, ASTERION_KEY_FILE: keyFile, ASTERION_RELEASES: releases, ASTERION_PORT: String(port),
      ASTERION_RUNNER_NODE_ARGS: '--max-old-space-size=6144' },
  });
  for (const stream of [server.stdout, server.stderr]) stream.on('data', (chunk) => fs.appendFileSync(serverLog, chunk));
  for (let attempt = 0; attempt < 200; attempt += 1) {
    try { if ((await fetch(`http://127.0.0.1:${port}/v1/health`)).ok) return; } catch { /* starting */ }
    await sleep(100);
  }
  throw new Error(`server ${version} did not start`);
}
const api = (route, init = {}) => fetch(`http://127.0.0.1:${port}${route}`, { ...init, headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json', ...(init.headers ?? {}) } });
const view = async (id) => (await api(`/v1/campaigns/${id}`)).json();

function load(text, at) {
  const storage = new Map([['save', text]]);
  const loaded = createPersistenceFacade({ mode: 'production', saveKey: 'save', now: () => at,
    storage: { getItem: (k) => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, v), removeItem: (k) => storage.delete(k) } }).load();
  if (loaded.status !== 'loaded') throw new Error(`does not load: ${loaded.status}`);
  return loaded.state;
}

const result = { fixture: path.basename(fixture), oldServer: OLD_SERVER, oldRunner: OLD_GAME, newServer: NEW };
try {
  await start(OLD_SERVER);
  const status = await (await api('/v1/status')).json();
  result.oldServerReports = status.version;
  // The 1.0.2 game leaves the world: its stored text (schema 28), already `behind` the clock (the owner's case).
  const text = fs.readFileSync(fixture, 'utf8');
  const leftAt = cursorOf(text);
  const id = `slot-version-move-${randomBytes(2).toString('hex')}`;
  const uploaded = await fetch(`http://127.0.0.1:${port}/v1/campaigns/${id}/revisions`, {
    method: 'PUT', body: zlib.gzipSync(text, { level: 6 }),
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/gzip', 'x-asterion-base-revision': '0', 'x-asterion-game-version': OLD_GAME,
      'x-asterion-schema': String(/"schemaVersion":(\d+)/.exec(text)[1]), 'x-asterion-digest': sha(text), 'x-asterion-device': 'pc-version-move-qa',
      'x-asterion-left': '1', 'x-asterion-world-at': String(leftAt), 'x-asterion-clock-offset': String(Math.round(leftAt + behindMs - Date.now())),
      'x-asterion-name': encodeURIComponent('QA version move') },
  });
  if (!uploaded.ok) throw new Error(`upload ${uploaded.status}: ${await uploaded.text()}`);
  result.schemaLeft = Number(/"schemaVersion":(\d+)/.exec(text)[1]);
  await sleep(oldSeconds * 1_000);
  const before = await view(id);
  result.beforeUpdate = { gameVersion: before.live?.gameVersion, livedMin: minutes((before.live?.worldAt ?? leftAt) - leftAt), lagMin: minutes(before.live?.lagMs ?? 0) };
  log(`old runner ${before.live?.gameVersion}: lived ${result.beforeUpdate.livedMin} game min, lag ${result.beforeUpdate.lagMin} min`);

  // The update (asterion-update → systemctl restart): SIGTERM to the old supervisor, which checkpoints the
  // world with the 1.0.2 runner and records it, then exits.
  const checkpoint = path.join(dataDir, 'campaigns', id, 'live-checkpoint.json.gz');
  const stoppedAt = Date.now();
  const exited = new Promise((resolve) => server.once('exit', resolve));
  server.stdin.write('stop' + String.fromCharCode(10));
  await Promise.race([exited, sleep(150_000)]);
  const recorded = JSON.parse(fs.readFileSync(path.join(dataDir, 'campaigns', id, 'campaign.json'), 'utf8')).live;
  result.stop = { ms: Date.now() - stoppedAt, recordedCheckpointMin: recorded.checkpointWorldAt === null ? null : minutes(recorded.checkpointWorldAt - leftAt) };
  const checkpointText = zlib.gunzipSync(fs.readFileSync(checkpoint)).toString('utf8');
  const checkpointAt = cursorOf(checkpointText);
  const keep = option('keep');
  if (keep) { fs.mkdirSync(keep, { recursive: true }); fs.writeFileSync(path.join(keep, 'checkpoint-1.0.2.json'), checkpointText); }
  result.checkpoint = { schema: Number(/"schemaVersion":(\d+)/.exec(checkpointText)[1]), livedMin: minutes(checkpointAt - leftAt), writtenInMs: Date.now() - stoppedAt };
  log(`checkpoint of the ${OLD_GAME} runner: schema ${result.checkpoint.schema}, lived ${result.checkpoint.livedMin} game min`);

  await start(NEW);
  let moved = null;
  for (let waited = 0; waited < 300_000 && !(moved?.live?.gameVersion === NEW && moved.live.worldAt > checkpointAt); waited += 1_000) {
    moved = await view(id);
    await sleep(1_000);
  }
  result.afterUpdate = { gameVersion: moved?.live?.gameVersion, migratedFrom: moved?.live?.migratedFrom, status: moved?.live?.status,
    livedMin: minutes((moved?.live?.worldAt ?? 0) - leftAt), notBack: (moved?.live?.worldAt ?? 0) >= checkpointAt };
  await sleep(newSeconds * 1_000);
  const living = await view(id);
  result.newRunner = { livedMin: minutes(living.live.worldAt - leftAt), lagMin: minutes(living.live.lagMs ?? 0), rate: living.live.rate };

  // An older game does not take the new release's world; the updated game does.
  result.oldGameClaim = (await api(`/v1/campaigns/${id}/claim`, { method: 'POST', body: JSON.stringify({ baseRevision: 1, gameVersion: OLD_GAME }) })).status;
  const claimed = await api(`/v1/campaigns/${id}/claim`, { method: 'POST', body: JSON.stringify({ baseRevision: 1, gameVersion: NEW }) });
  if (claimed.status !== 200) throw new Error(`claim ${claimed.status}: ${await claimed.text()}`);
  const world = zlib.gunzipSync(Buffer.from(await claimed.arrayBuffer())).toString('utf8');
  const worldAt = Number(claimed.headers.get('x-asterion-world-at'));
  if (keep) fs.writeFileSync(path.join(keep, 'claimed.json'), JSON.stringify({ worldAt, leftAt, resumeLog: fs.readFileSync(serverLog, 'utf8'), world }));
  result.claimed = { status: claimed.status, gameVersion: claimed.headers.get('x-asterion-game-version'), schema: Number(/"schemaVersion":(\d+)/.exec(world)[1]),
    livedMin: minutes(worldAt - leftAt), digestOk: sha(world) === claimed.headers.get('x-asterion-digest') };
  log(`claimed: lived ${result.claimed.livedMin} game min in total`);

  // This branch's own continuation of the 1.0.2 checkpoint (what its runner does on resume), then both loaded.
  const left = load(text, leftAt);
  let resumed = load(checkpointText, checkpointAt);
  applyCampaignRuntimeForCatchup(resumed, worldAt);
  // The world is claimed while it may still be catching up (its target is the clock): stop at the same cursor,
  // and keep the server's target (the clock at the claim) for the comparison.
  const serverTarget = load(world, worldAt).npcReplay.targetAt;
  resumed = { ...resumed, npcReplay: { ...resumed.npcReplay, targetAt: worldAt } };
  resumed = advanceLiveWorld(resumed, worldAt).state;
  const finished = finishLiveWorld(resumed, { npcReplay: left.npcReplay });
  const local = { ...finished, npcReplay: { ...finished.npcReplay, targetAt: serverTarget } };
  const loadedDigest = (saveText) => sha(serializeSaveForStorage(load(saveText, worldAt), 'production'));
  result.equalAfterLoad = loadedDigest(world) === loadedDigest(serializeSaveForStorage(local, 'production'));
  result.summaryFrom = load(world, worldAt).npcReplay?.summary?.fromAt === leftAt;
  result.serverLog = fs.readFileSync(serverLog, 'utf8').split('\n').filter((line) => /moved from|started \(game|back to|ended/.test(line));
} finally {
  server?.kill();
  await sleep(1_000);
  try { fs.rmSync(temp, { recursive: true, force: true }); } catch { /* a runner may still hold files */ }
}
console.log(JSON.stringify(result));
if (!result.afterUpdate?.notBack || result.afterUpdate.gameVersion !== NEW || !result.equalAfterLoad) process.exitCode = 1;
