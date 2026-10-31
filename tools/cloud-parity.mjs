// Cloud world against a real server: a late-game save is left with the
// server, lives there for a while, and is taken back; then the same absence
// is caught up locally with npc-catchup-runner from the same save. Prints the
// digests (they must match), the server's cost while it held the world, and
// how long taking the world back took compared to the local catch-up.
//
//   npm run cloud:parity -- --fixture=late-game-day-2.json --minutes=10 [--behind-minutes=30]
//       (`equal`: the bytes; `equalAfterLoad`: both loaded as the game loads a save —
//       the check that holds across a server restart in the middle)
//       [--id=slot-qa-parity-day2]
//   By default a LOCAL server (server/src/server.ts on 127.0.0.1) with its own temporary key and data
//   directory. A remote server only with all three: --url=https://host --allow-remote --key-file=F
//   (31.10.2026: a run without --url once went to the production server, which holds one live world).
//   The player's key in %APPDATA% is never read.
//
// --behind-minutes leaves the save that far behind the (shifted) clock, so the
// server first catches up an absence before it keeps the world alive. The
// server's clock is the save's own time (the clock offset header), like a QA
// page clock: no real months of absence are replayed.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { createHash, randomBytes } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createCloudServer } from '../server/src/server.ts';
import { DEFAULT_RETENTION } from '../server/src/store.ts';
import { createPersistenceFacade, serializeSaveForStorage } from '../src/application/persistence.ts';
import { freezeNpcCatchupTarget } from '../src/application/npc-catchup.ts';
import { applyCampaignRuntimeForCatchup, runNpcCatchup } from '../src/application/npc-catchup-runner.ts';

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const raw = args.find((arg) => arg.startsWith(`--${name}=`));
  return raw ? raw.slice(name.length + 3) : fallback;
};
const fixture = option('fixture');
if (!fixture) { console.error('Usage: --fixture=<save.json> [--minutes=10] [--behind-minutes=0]'); process.exit(2); }
const minutes = Number(option('minutes', '10'));
const behindMinutes = Number(option('behind-minutes', '0'));
const remote = option('url');
if (remote && (!args.includes('--allow-remote') || !option('key-file'))) {
  console.error('A remote server needs --url, --allow-remote and --key-file together (the default is a local server).');
  process.exit(2);
}
const id = option('id', `slot-qa-parity-${randomBytes(3).toString('hex')}`);
const version = option('version', JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version);
let key;
let base;
let localServer = null;
if (remote) {
  base = remote;
  key = fs.readFileSync(option('key-file'), 'utf8').trim();
} else {
  // The server's own code on 127.0.0.1, as server/src/server.test.ts runs it.
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'asterion-cloud-parity-'));
  key = randomBytes(36).toString('base64url');
  localServer = createCloudServer({
    host: '127.0.0.1', port: 0, dataDir, keyHash: createHash('sha256').update(key).digest(), version,
    releasesDir: path.join(dataDir, 'releases'),
    runnerOverride: {
      script: path.join(root, 'server/src/runner.ts'),
      execArgv: ['--max-old-space-size=8192', '--experimental-strip-types', '--no-warnings', '--experimental-loader',
        pathToFileURL(path.join(root, 'src/domain/combat/test-asset-loader.mjs')).href],
      version,
    },
    runnerExecArgv: [], stepMs: 1_000, stepBudgetMs: 2_000, checkpointEveryMs: 60 * 60_000,
    maxUploadGzBytes: 200 * 1024 ** 2, maxSaveBytes: 1024 ** 3, retention: DEFAULT_RETENTION, trustProxy: false,
    log: () => undefined,
  });
  base = `http://127.0.0.1:${await localServer.listen()}`;
  process.on('exit', () => fs.rmSync(dataDir, { recursive: true, force: true }));
}
const sha = (text) => createHash('sha256').update(text, 'utf8').digest('hex');
const log = (...parts) => process.stderr.write(`${new Date().toISOString().slice(11, 19)} ${parts.join(' ')}\n`);
const api = (route, init = {}) => fetch(`${base}${route}`, { ...init, headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json', ...(init.headers ?? {}) } });

function load(text, at) {
  const storage = new Map([['save', text]]);
  const facade = createPersistenceFacade({ mode: 'production', saveKey: 'save', now: () => at,
    storage: { getItem: (k) => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, v), removeItem: (k) => storage.delete(k) } });
  const loaded = facade.load();
  if (loaded.status !== 'loaded') throw new Error(`fixture does not load: ${loaded.status}`);
  return loaded.state;
}

// The save as the game stores it (the client uploads its stored text).
const raw = fs.readFileSync(fixture, 'utf8');
const leftAt = Number(/"npcReplay":\{"version":1,"processedThroughAt":(\d+)/.exec(raw)[1]);
const text = serializeSaveForStorage(load(raw, leftAt), 'production');
// The server's clock: the save's time plus how far behind it is left.
const clockOffsetMs = leftAt + behindMinutes * 60_000 - Date.now();
const packed = zlib.gzipSync(text, { level: 6 });
log(`fixture ${fixture}: ${(text.length / 1e6).toFixed(1)} M chars, gzip ${(packed.length / 1e6).toFixed(1)} MB, campaign ${id}`);

let started = performance.now();
const uploaded = await fetch(`${base}/v1/campaigns/${id}/revisions`, {
  method: 'PUT', body: packed,
  headers: {
    authorization: `Bearer ${key}`, 'content-type': 'application/gzip', 'x-asterion-base-revision': '0', 'x-asterion-game-version': version,
    'x-asterion-schema': String(/"schemaVersion":(\d+)/.exec(text)[1]), 'x-asterion-digest': sha(text), 'x-asterion-device': 'pc-cloud-parity-qa',
    'x-asterion-left': '1', 'x-asterion-world-at': String(leftAt), 'x-asterion-clock-offset': String(clockOffsetMs), 'x-asterion-name': encodeURIComponent(`QA parity ${fixture.split(/[\\/]/).pop()}`),
  },
});
if (!uploaded.ok) throw new Error(`upload ${uploaded.status}: ${await uploaded.text()}`);
const uploadMs = performance.now() - started;
log(`uploaded in ${(uploadMs / 1000).toFixed(1)} s`);

const samples = [];
const until = Date.now() + minutes * 60_000;
let caughtUpAt = null;
while (Date.now() < until) {
  await new Promise((resolve) => setTimeout(resolve, 15_000));
  const status = await (await api('/v1/status')).json();
  if (status.live?.campaignId !== id) continue;
  samples.push({ at: Date.now(), ...status.live });
  if (caughtUpAt === null && status.live.lagMs !== null && status.live.lagMs < 30_000) caughtUpAt = Date.now();
  log(`live: lag ${Math.round((status.live.lagMs ?? 0) / 1000)} s, tick ${status.live.tickMs} ms, cpu ${((status.live.cpuShare ?? 0) * 100).toFixed(1)}%, rss ${Math.round((status.live.rss ?? 0) / 1e6)} MB`);
}

started = performance.now();
const claimed = await api(`/v1/campaigns/${id}/claim`, { method: 'POST', body: JSON.stringify({ baseRevision: 1, gameVersion: version }) });
if (claimed.status !== 200) throw new Error(`claim ${claimed.status}: ${await claimed.text()}`);
const claimedPacked = Buffer.from(await claimed.arrayBuffer());
const claimMs = performance.now() - started;
const serverText = zlib.gunzipSync(claimedPacked).toString('utf8');
const serverDigest = sha(serverText);
if (serverDigest !== claimed.headers.get('x-asterion-digest')) throw new Error('claimed world does not match its digest');
const worldAt = Number(claimed.headers.get('x-asterion-world-at'));
log(`claimed in ${(claimMs / 1000).toFixed(1)} s (${(claimedPacked.length / 1e6).toFixed(1)} MB gz); the server lived ${((worldAt - leftAt) / 60_000).toFixed(1)} game minutes`);

// The same absence on this computer, from the same save.
const left = load(text, leftAt);
applyCampaignRuntimeForCatchup(left, worldAt);
started = performance.now();
const local = await runNpcCatchup(freezeNpcCatchupTarget(left, worldAt), { now: () => worldAt });
const localMs = performance.now() - started;
const localDigest = sha(serializeSaveForStorage(local.state, 'production'));
// After a server restart in the middle (an update), the world resumed from a
// checkpoint went through a load: compare both as the game reads them.
const loadedDigest = (saveText) => sha(serializeSaveForStorage(load(saveText, worldAt), 'production'));
const serverLoadedDigest = loadedDigest(serverText);
const localLoadedDigest = loadedDigest(serializeSaveForStorage(local.state, 'production'));
log(`local catch-up of the same ${((worldAt - leftAt) / 60_000).toFixed(1)} minutes: ${(localMs / 1000).toFixed(1)} s`);

const steady = samples.filter((sample) => caughtUpAt !== null && sample.at >= caughtUpAt);
const median = (values) => { const sorted = [...values].sort((a, b) => a - b); return sorted.length ? sorted[Math.floor(sorted.length / 2)] : null; };
const result = {
  fixture: fixture.split(/[\\/]/).pop(), campaign: id, version,
  saveChars: text.length, uploadGzBytes: packed.length, uploadMs: Math.round(uploadMs),
  behindMinutes, livedGameMinutes: +((worldAt - leftAt) / 60_000).toFixed(2), wallMinutes: minutes,
  catchUpWallSeconds: caughtUpAt === null ? null : Math.round((caughtUpAt - (until - minutes * 60_000)) / 1000),
  steadyCpuShare: median(steady.map((sample) => sample.cpuShare)), steadyTickMs: median(steady.map((sample) => sample.tickMs)),
  maxRssMB: Math.round(Math.max(0, ...samples.map((sample) => sample.rss ?? 0)) / 1e6),
  claimMs: Math.round(claimMs), claimGzBytes: claimedPacked.length,
  localCatchupMs: Math.round(localMs),
  serverDigest, localDigest, equal: serverDigest === localDigest,
  equalAfterLoad: serverLoadedDigest === localLoadedDigest,
};
console.log(JSON.stringify({ server: remote ? 'remote' : 'local', ...result }));
if (!result.equalAfterLoad) process.exitCode = 1;
if (localServer) await localServer.close();
