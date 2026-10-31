// Cloud world in the built game against a local cloud server (the server's own
// code, server/src/server.ts, on 127.0.0.1 — CI never reaches a real server).
// Two "computers" are two Electron profiles; every step is a real Electron
// process (hidden window):
//
//   settings      Settings → «Облачный мир»: address and key typed, «Проверить связь»
//   first-play    a campaign not yet on the server: local entry; leaving it hands the world over
//   (the server keeps it alive for --live-seconds)
//   from-server   «Продолжить»: «Получаем мир с сервера…», the server's world applied in seconds
//   version       an older game: «Мир на сервере живёт в более новой версии», «Досчитать на этом ПК»
//                 catches up locally, the server world stops (kept as a backup)
//   offline       the server is down: local entry at once; closing the window waits ≤ a few seconds
//   local-newer   played offline, server back: the local save goes on, the server world stops
//   second-pc     a profile without the campaign: «Загрузить игру → На сервере»
//   conflict      both copies changed: the choice with dates; «Взять с сервера» keeps a local copy slot
//   wrong-key     the server refuses the key: local entry with the reason
//   leave-behind  the owner's case: the player leaves during a long local catch-up; the server gets a world far behind
//   server-catchup «Загрузить игру → На сервере» shows how far behind it is; «Продолжить» opens «Мир догоняется
//                 на сервере» (no claim while it catches up); when the server has caught up the game takes the world
//   take-now      the same far-behind world: «Досчитать на этом ПК» claims at once and the game replays the rest
//   newer-game    a game newer than the server: the server is asked to update, the update moves the living world
//                 to the new release, and the game takes it without a version mismatch
//   local-reference (with --fixture) the same absence caught up locally, for the timing comparison
//
//   npm run test:cloud-world-ui                       (small generated world, CI)
//   npm run test:cloud-world-ui -- --fixture=late-game-day-2.json --live-seconds=300 --behind-minutes=30
//       [--server-url=https://host --key-file=cloud-key.txt] [--only-relay] [--only-catchup --behind-hours=6]
//   (--only-catchup: settings, first play, then the server catch-up phases only — the screenshot run on a late world)
//
// Prints one JSON line per step and exits 1 on any failed expectation.
const { app, BrowserWindow, session } = require('electron');
const { spawn, spawnSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const raw = args.find((arg) => arg.startsWith(`--${name}=`));
  return raw ? raw.slice(name.length + 3) : fallback;
};
const ROOT = path.join(__dirname, '..');
const PHASE = option('phase');
// A real server keeps every run: each run gets its own campaign id there.
const SLOT_ID = option('slot', 'slot-cloudqa-0001');
const SLOT_KEY = `asterion.slot.${SLOT_ID}.v1`;
const SLOT_INDEX_KEY = 'asterion.slots.index.v1';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const cursorInText = (text) => {
  const match = /"npcReplay":\{"version":1,"processedThroughAt":(\d+)/.exec(text);
  return match ? Number(match[1]) : null;
};
const OUT_DIR = path.join(ROOT, 'visual-qa', 'cloud-world');

if (!PHASE) {
  const fixture = option('fixture');
  // --server-url/--key-file: a real cloud server instead of the local one (the
  // unreachable server is then an address nothing listens on).
  const realUrl = option('server-url');
  const slotArg = `--slot=${realUrl ? `slot-cloudqa-${crypto.randomBytes(3).toString('hex')}` : SLOT_ID}`;
  const liveSeconds = Number(option('live-seconds', fixture ? '300' : '40'));
  const behindMinutes = Number(option('behind-minutes', fixture ? '30' : '20'));
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'asterion-cloud-qa-'));
  const profiles = { a: path.join(temp, 'pc-a'), b: path.join(temp, 'pc-b'), c: path.join(temp, 'pc-c') };
  for (const dir of Object.values(profiles)) fs.mkdirSync(dir, { recursive: true });
  const dataDir = path.join(temp, 'server');
  fs.mkdirSync(dataDir, { recursive: true });
  const key = realUrl ? fs.readFileSync(option('key-file'), 'utf8').trim() : crypto.randomBytes(36).toString('base64url');
  const keyFile = path.join(temp, 'access-key');
  fs.writeFileSync(keyFile, key);
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const version = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
  const loader = require('url').pathToFileURL(path.join(ROOT, 'src/domain/combat/test-asset-loader.mjs')).href;
  const nodeArgs = ['--experimental-strip-types', '--no-warnings', '--experimental-loader', loader];
  const nodeBin = process.env.ASTERION_QA_NODE || 'node';

  // The world: a late-game fixture, or a small generated campaign.
  const worldFile = path.join(temp, 'world.json');
  if (fixture) fs.copyFileSync(path.resolve(fixture), worldFile);
  else {
    const made = spawnSync(nodeBin, [...nodeArgs, path.join(ROOT, 'tools/cloud-qa-world.mjs'), worldFile, '6', String(Date.now() - 2 * 3_600_000)], { cwd: ROOT, encoding: 'utf8' });
    if (made.status !== 0) { console.error(made.stderr); process.exit(1); }
  }
  const worldText = fs.readFileSync(worldFile, 'utf8');
  const cursor0 = cursorInText(worldText);
  // One virtual clock for the game pages and the server: the world's own time, `behindMinutes` ahead of its cursor.
  const offset = Math.round((cursor0 + behindMinutes * 60_000 - Date.now()) / 60_000) * 60_000;

  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  let server = null;
  let port = 0;
  const freePort = () => new Promise((resolve) => { const probe = net.createServer(); probe.listen(0, '127.0.0.1', () => { const { port: p } = probe.address(); probe.close(() => resolve(p)); }); });
  let reachable = true;
  const base = () => realUrl || `http://127.0.0.1:${port}`;
  // serverVersion: the release the server runs (newer-game updates it); every game version runs this branch's runner.
  let serverVersion = version;
  const startServer = async () => {
    if (realUrl) { reachable = true; return; }
    if (!port) port = await freePort();
    server = spawn(nodeBin, [...nodeArgs, path.join(ROOT, 'server/src/server.ts')], {
      cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, ASTERION_DATA: dataDir, ASTERION_KEY_FILE: keyFile, ASTERION_PORT: String(port), ASTERION_VERSION: serverVersion,
        ASTERION_RELEASES: path.join(dataDir, 'releases'), ASTERION_STEP_MS: '2000', ASTERION_STEP_BUDGET_MS: '3000',
        ASTERION_RUNNER_OVERRIDE: JSON.stringify({ script: path.join(ROOT, 'server/src/runner.ts'), execArgv: nodeArgs }) },
    });
    server.stdout.on('data', (chunk) => fs.appendFileSync(path.join(temp, 'server.log'), chunk));
    server.stderr.on('data', (chunk) => fs.appendFileSync(path.join(temp, 'server.log'), chunk));
    for (let attempt = 0; attempt < 100; attempt += 1) {
      try { if ((await fetch(`${base()}/v1/health`)).ok) return; } catch { /* starting */ }
      await sleep(100);
    }
    throw new Error('the local cloud server did not start');
  };
  const stopServer = async () => {
    if (realUrl) { reachable = false; return; }
    if (!server) return;
    const exited = new Promise((resolve) => server.once('exit', resolve));
    server.kill('SIGTERM');
    await Promise.race([exited, sleep(30_000)]);
    server = null;
  };
  const SLOT = slotArg.slice('--slot='.length);
  const apiGet = async (route) => (await fetch(`${base()}${route.replace(SLOT_ID, SLOT)}`, { headers: { authorization: `Bearer ${key}` } })).json();
  const writeCloud = (profile, values) => {
    fs.writeFileSync(path.join(profile, 'cloud.json'), JSON.stringify({ url: base(), enabled: true, ...values }));
    fs.writeFileSync(path.join(profile, 'cloud-key.txt'), `${values.key ?? key}\n`);
  };
  // shiftMs: the player comes back that much later (the pages' clock moves on; the server's world falls behind).
  const phaseArgs = (name, profile, extra, shiftMs) => {
    // The address of an unreachable server: nothing listens on port 9.
    if (realUrl && fs.existsSync(path.join(profile, 'cloud.json'))) {
      const config = JSON.parse(fs.readFileSync(path.join(profile, 'cloud.json'), 'utf8'));
      fs.writeFileSync(path.join(profile, 'cloud.json'), JSON.stringify({ ...config, url: reachable ? realUrl : 'http://127.0.0.1:9' }));
    }
    return [__filename, `--phase=${name}`, `--profile=${profile}`, `--offset=${offset + shiftMs}`, `--url=${base()}`, slotArg, ...extra];
  };
  const phaseResult = (name, status, stdout, stderr) => {
    const line = (stdout || '').split('\n').find((text) => text.startsWith('{"phase"'));
    if (status !== 0 || !line) throw new Error(`Phase ${name} failed (${status}): ${(stderr || '').slice(-3_000)}`);
    const result = JSON.parse(line);
    console.log(JSON.stringify(result));
    return result;
  };
  const phase = (name, profile, extra = [], shiftMs = 0) => {
    const child = spawnSync(process.execPath, phaseArgs(name, profile, extra, shiftMs),
      { cwd: ROOT, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, timeout: 90 * 60_000, env });
    return phaseResult(name, child.status, child.stdout, child.stderr);
  };
  /** A phase the driver acts on meanwhile (the server is updated while the game waits). */
  const phaseAsync = (name, profile, extra = [], shiftMs = 0) => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, phaseArgs(name, profile, extra, shiftMs), { cwd: ROOT, env });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('exit', (status) => { try { resolve(phaseResult(name, status, stdout, stderr)); } catch (error) { reject(error); } });
  });
  const onlyCatchup = args.includes('--only-catchup');
  const failures = [];
  const expect = (ok, message) => { if (!ok) failures.push(message); };
  const results = {};
  (async () => {
    try {
      await startServer();
      results.settings = phase('settings', profiles.a, [`--key=${key}`]);
      expect(results.settings.serverVersionShown, 'Settings → «Облачный мир» reaches the server with the typed address and key');

      results.firstPlay = phase('first-play', profiles.a, [`--world=${worldFile}`]);
      expect(results.firstPlay.entered && !results.firstPlay.bannerError, 'a campaign not on the server opens locally');
      expect(results.firstPlay.upload?.ok && results.firstPlay.upload.left, 'leaving the campaign handed the world to the server');
      let view = await apiGet(`/v1/campaigns/${SLOT_ID}`);
      expect(view.live?.status === 'running', 'the server keeps the world alive after the player left');
      await sleep(liveSeconds * 1_000);
      view = await apiGet(`/v1/campaigns/${SLOT_ID}`);
      results.liveBeforeReturn = { worldAt: view.live?.worldAt, lagMs: view.live?.lagMs, headRevision: view.head?.revision };
      console.log(JSON.stringify({ phase: 'server-lived', seconds: liveSeconds, ...results.liveBeforeReturn }));

      results.fromServer = phase('from-server', profiles.a);
      expect(results.fromServer.bannerSeen, 'the entry showed «Получаем мир с сервера…»');
      expect(results.fromServer.applied, 'the server world was applied');
      expect(results.fromServer.gapAfterApplyMs !== null && results.fromServer.gapAfterApplyMs < 60_000, 'after applying, the world is less than a minute behind the clock');
      expect(results.fromServer.cursorAfterApply >= results.liveBeforeReturn.worldAt, 'the applied world is the one the server lived');
      view = await apiGet(`/v1/campaigns/${SLOT_ID}`);
      expect(view.head.origin === 'client' && view.live?.status === 'running', 'leaving again handed the world back to the server');
      const claimedRevision = view.snapshots.find((snapshot) => snapshot.origin === 'server' && snapshot.kind === 'revision');
      expect(Boolean(claimedRevision), 'the world the server handed back is kept as a revision');

      if (fixture) {
        // The same absence on another computer without the server: the local catch-up of the same save.
        const left = view.snapshots.find((snapshot) => snapshot.revision === results.fromServer.claimedFromRevision);
        if (left) {
          const response = await fetch(`${base()}/v1/campaigns/${SLOT}/snapshots/${left.id}`, { headers: { authorization: `Bearer ${key}` } });
          const text = require('zlib').gunzipSync(Buffer.from(await response.arrayBuffer())).toString('utf8');
          const leftFile = path.join(temp, 'left.json');
          fs.writeFileSync(leftFile, text);
          results.localReference = phase('local-reference', profiles.c, [`--world=${leftFile}`, `--gap-ms=${results.fromServer.cursorAfterApply - cursorInText(text)}`]);
        }
      }

      // --only-relay: the timing run of a late world stops after the relay and its local reference.
      if (args.includes('--only-relay')) throw Object.assign(new Error('only-relay'), { done: true });
      if (!onlyCatchup) {
      results.version = phase('version', profiles.a, ['--app-version=0.0.1-qa']);
      expect(results.version.waitSeen === 'game-older', 'an older game does not take a world of a newer release: it says so and waits');
      expect(results.version.entered && !results.version.applied, '«Досчитать на этом ПК» opens the local save');
      expect(/верси/.test(results.version.notices.join(' ')), 'the player sees why the world is caught up locally');
      view = await apiGet(`/v1/campaigns/${SLOT_ID}`);
      expect(view.live === null || view.live.gameVersion === '0.0.1-qa', 'the server world of the other version stopped');
      expect(view.snapshots.some((snapshot) => snapshot.kind === 'backup'), 'the stopped server world is kept as a backup');

      await stopServer();
      results.offline = phase('offline', profiles.a);
      expect(results.offline.entered && results.offline.entryMs < 15_000, 'with the server down the campaign opens locally at once');
      expect(/связи|ответил/.test(results.offline.notices.join(' ')), 'the player sees that the server is unreachable');
      expect(results.offline.quitMs < 8_000, 'closing the window waited only briefly for the unreachable server');
      await startServer();
      await sleep(3_000);

      results.localNewer = phase('local-newer', profiles.a);
      expect(results.localNewer.entered && !results.localNewer.applied, 'a local save newer than the server goes on');
      expect(results.localNewer.upload?.ok, 'its upload replaced the server copy');

      writeCloud(profiles.b, {});
      results.secondPc = phase('second-pc', profiles.b);
      expect(results.secondPc.listed, 'a computer without the campaign lists it under «На сервере»');
      expect(results.secondPc.entered && results.secondPc.applied, 'the second computer opens the server campaign');
      expect(results.secondPc.upload?.ok, 'the second computer handed its world back on leaving');

      await stopServer();
      results.offlineChange = phase('offline', profiles.a);
      await startServer();
      await sleep(3_000);
      results.conflict = phase('conflict', profiles.a);
      expect(results.conflict.dialog === 'diverged', 'both copies changed: the player is asked');
      expect(results.conflict.datesShown, 'the choice shows dates of both copies');
      expect(results.conflict.entered && results.conflict.applied, '«Взять с сервера» opens the server world');
      expect(results.conflict.localCopyKept, 'this computer\'s copy is kept as a separate slot');

      const realKey = fs.readFileSync(path.join(profiles.a, 'cloud-key.txt'), 'utf8');
      fs.writeFileSync(path.join(profiles.a, 'cloud-key.txt'), `${crypto.randomBytes(36).toString('base64url')}\n`);
      results.wrongKey = phase('wrong-key', profiles.a);
      fs.writeFileSync(path.join(profiles.a, 'cloud-key.txt'), realKey);
      expect(results.wrongKey.entered && !results.wrongKey.applied, 'a refused key opens the local save');
      expect(/ключ/.test(results.wrongKey.notices.join(' ')), 'the player sees that the key was refused');
      const log = fs.existsSync(path.join(temp, 'server.log')) ? fs.readFileSync(path.join(temp, 'server.log'), 'utf8') : '';
      expect(!log.includes(key), 'the access key never reaches the server log');
      // Back in sync with the server before the catch-up phases (the wrong-key run played locally).
      results.resync = phase('local-newer', profiles.a);
      }

      // The owner's case (30.10): the player comes back hours later and the server world is in step, so the game
      // takes it and starts the local catch-up of the hours this computer was away; the player leaves in the middle
      // of it, and the server gets a world far behind the clock.
      const behindMs = Number(option('behind-hours', fixture ? '6' : '48')) * 3_600_000;
      results.leaveBehind = phase('leave-behind', profiles.a, [], behindMs);
      expect(results.leaveBehind.localCatchupSeen, 'the hours away are replayed locally (the server did not live them)');
      expect(results.leaveBehind.upload?.ok && results.leaveBehind.upload.left, 'leaving during the local catch-up handed the world to the server');
      view = await apiGet(`/v1/campaigns/${SLOT_ID}`);
      results.behindOnServer = { lagMs: view.live?.lagMs, status: view.live?.status };
      expect(view.live?.status === 'running' && view.live.lagMs > 2 * 60_000, 'the server holds the world far behind the clock');

      results.serverCatchup = phase('server-catchup', profiles.a, [], behindMs);
      expect(results.serverCatchup.listedBehind, '«Загрузить игру → На сервере» shows the world living on the server and how far behind it is');
      expect(results.serverCatchup.waitSeen === 'catching-up', '«Продолжить» opens «Мир догоняется на сервере»');
      expect(results.serverCatchup.noClaimWhileWaiting, 'no claim while the server catches up');
      expect(results.serverCatchup.entered && results.serverCatchup.applied, 'when the server caught up, the game took the world');
      expect(results.serverCatchup.gapAfterApplyMs !== null && results.serverCatchup.gapAfterApplyMs < 3 * 60_000, 'the world taken is at most a couple of minutes behind');

      // Far behind again: this time «Досчитать на этом ПК» takes it at once and the game replays the rest itself.
      results.leaveBehindAgain = phase('leave-behind', profiles.a, [], 2 * behindMs);
      results.takeNow = phase('take-now', profiles.a, [], 2 * behindMs);
      expect(results.takeNow.waitSeen === 'catching-up', 'a world far behind on the server: the game waits instead of claiming');
      expect(results.takeNow.entered && results.takeNow.applied, '«Досчитать на этом ПК» takes the world at once');
      expect(results.takeNow.gapAfterApplyMs > 2 * 60_000 && results.takeNow.localCatchupSeen, '...still behind, and the game replays the rest itself');

      if (!realUrl) {
        // The game updated before the server: it asks the server to update and waits; asterion-update restarts the
        // service on the new release, which moves the living world (server.ts migrateLive); the game takes it.
        const requestFile = path.join(dataDir, 'update-request');
        fs.rmSync(requestFile, { force: true });
        const newer = phaseAsync('newer-game', profiles.a, ['--app-version=9.9.9'], 2 * behindMs);
        const askedAt = Date.now();
        while (!fs.existsSync(requestFile) && Date.now() - askedAt < 180_000) await sleep(250);
        results.updateRequested = fs.existsSync(requestFile) ? fs.readFileSync(requestFile, 'utf8').trim() : null;
        expect(results.updateRequested === '9.9.9', 'the newer game asked the server to update');
        await sleep(8_000);
        await stopServer();
        serverVersion = '9.9.9';
        await startServer();
        results.newerGame = await newer;
        expect(results.newerGame.waitSeen === 'server-updating', 'the newer game waits for the server instead of throwing its world away');
        expect(results.newerGame.entered && results.newerGame.applied, 'after the update the newer game took the world the server kept living');
        const serverLog = fs.readFileSync(path.join(temp, 'server.log'), 'utf8');
        expect(new RegExp(`moved from game ${version.replace(/\./g, '\\.')} to 9\\.9\\.9`).test(serverLog), 'the server moved the living world to the new release');
        view = await apiGet(`/v1/campaigns/${SLOT_ID}`);
        expect(view.snapshots.filter((snapshot) => snapshot.kind === 'backup' && snapshot.savedAt > askedAt).length === 0, 'nothing of the server world was set aside as a backup');
      }
      results.campaign = SLOT;
    } catch (error) {
      if (!error.done) failures.push(error.stack || error.message);
    }
    await stopServer().catch(() => undefined);
    fs.writeFileSync(path.join(OUT_DIR, 'results.json'), JSON.stringify(results, null, 2));
    try { fs.rmSync(temp, { recursive: true, force: true }); } catch { /* Chromium may still hold files */ }
    if (failures.length) {
      console.error(`Cloud world QA failed:\n- ${failures.join('\n- ')}`);
      process.exit(1);
      return;
    }
    console.log('Cloud world QA passed.');
    process.exit(0);
  })();
} else {
  // ---- One step in one Electron process ----
  const PROFILE = option('profile');
  app.setPath('userData', PROFILE);
  // Run as a script, Electron reports its own version; the packaged game reports package.json's.
  app.setVersion(option('app-version', JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version));
  app.disableHardwareAcceleration();
  app.commandLine.appendSwitch('disable-renderer-backgrounding');
  app.commandLine.appendSwitch('disable-background-timer-throttling');
  app.on('window-all-closed', () => {});
  const { registerSaveStore } = require('./save-store.cjs');
  const { registerCloud } = require('./cloud.cjs');
  const OFFSET = Number(option('offset', '0'));
  const shots = !process.env.ASTERION_SKIP_SCREENSHOTS;

  const run = (win, source) => win.webContents.executeJavaScript(source);
  async function waitFor(win, expression, timeoutMs = 120_000) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      if (await run(win, `Boolean(${expression})`)) return true;
      await sleep(100);
    }
    throw new Error(`Timed out waiting for: ${expression}`);
  }
  const load = (win, search) => win.loadFile(path.join(ROOT, 'dist', 'index.html'), search ? { search } : undefined);
  // The virtual clock and a probe that keeps every notice and whether the cloud banner showed.
  async function prepare(win) {
    await load(win, '');
    const dbg = win.webContents.debugger;
    if (!dbg.isAttached()) dbg.attach('1.3');
    await dbg.sendCommand('Page.enable');
    await dbg.sendCommand('Page.addScriptToEvaluateOnNewDocument', { source: `(() => {
      const RealDate = Date; const offset = ${OFFSET};
      class MovedDate extends RealDate {
        constructor(...a) { if (a.length === 0) super(RealDate.now() + offset); else super(...a); }
        static now() { return RealDate.now() + offset; }
      }
      globalThis.Date = MovedDate;
      const qa = window.__cloudQa = { notices: [], banner: [], conflict: null };
      new MutationObserver(() => {
        for (const node of document.querySelectorAll('[data-qa-runtime-notice] span, .runtime-toast-stack *')) {
          const text = (node.textContent || '').trim();
          if (text && !qa.notices.includes(text)) qa.notices.push(text);
        }
        const banner = document.querySelector('[data-qa-cloud-entry="busy"] h2');
        if (banner && !qa.banner.includes(banner.textContent)) qa.banner.push(banner.textContent);
      }).observe(document, { childList: true, subtree: true, characterData: true });
    })();` });
  }
  const shot = async (win, name, settle = true) => {
    if (!shots) return;
    // Menu screens and dialogs fade in (menu-motion.css); the entry banner is caught as it is.
    if (settle) await sleep(1_600);
    const image = await win.webContents.capturePage();
    fs.writeFileSync(path.join(OUT_DIR, `${name}.png`), image.toPNG());
  };
  const menu = async (win) => { await load(win, ''); await waitFor(win, `document.querySelector('[data-qa-menu]')`); };
  const syncFile = () => { try { return JSON.parse(fs.readFileSync(path.join(PROFILE, 'cloud-sync.json'), 'utf8')); } catch { return {}; } };
  /** The stored save text of the slot (localStorage, or the desktop store file its pointer names). */
  const storedText = async (win) => {
    const raw = await run(win, `localStorage.getItem(${JSON.stringify(SLOT_KEY)})`);
    if (!raw) return null;
    if (raw.length < 512 && raw.includes('asterionExternalSave')) {
      const pointer = JSON.parse(raw).asterionExternalSave;
      const file = path.join(PROFILE, 'saves', `${SLOT_KEY}.${pointer.writeId}.save.json`);
      return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
    }
    return raw;
  };
  const pageNow = (win) => run(win, 'Date.now()');
  async function seed(win, text) {
    const meta = {
      id: SLOT_ID, name: 'Облачный мир QA', createdAt: Date.now(), updatedAt: Date.now(), playTimeMs: 0, factionId: 'aegis', playerName: 'Облачный QA',
      campaignSpeed: (/"campaignSpeed":"(\w+)"/.exec(text) || [])[1] || 'standard', schemaVersion: Number((/"schemaVersion":(\d+)/.exec(text) || [])[1] || 0),
      storageKey: SLOT_KEY, mode: 'production',
      summary: { planets: 1, npcCount: 6, galaxyCount: Number((/"galaxyCount":(\d+)/.exec(text) || [])[1] || 1), days: 0, crystals: 0, victory: false },
    };
    await menu(win);
    await run(win, text.length < 8_000_000
      ? `localStorage.setItem(${JSON.stringify(SLOT_KEY)}, ${JSON.stringify(text)})`
      : `(() => { window.asterionDesktop.saveStore.write(${JSON.stringify(SLOT_KEY)}, 'qa-seed', ${JSON.stringify(text)});
          localStorage.setItem(${JSON.stringify(SLOT_KEY)}, JSON.stringify({ asterionExternalSave: { version: 1, writeId: 'qa-seed', chars: ${text.length} }, saveWriter: 1 })); })()`);
    await run(win, `localStorage.setItem(${JSON.stringify(SLOT_INDEX_KEY)}, ${JSON.stringify(JSON.stringify({ version: 1, activeSlotId: SLOT_ID, slots: [meta] }))})`);
  }
  /** «Продолжить» from the main menu until the game (or a choice) is on screen. */
  async function continueCampaign(win, out, beforeShot) {
    await menu(win);
    const started = Date.now();
    await run(win, `document.querySelector('[data-qa-continue]').click()`);
    if (beforeShot) {
      // The banner is on screen while the server is asked.
      const seen = await waitFor(win, `document.querySelector('[data-qa-cloud-entry="busy"]') || document.querySelector('[data-qa-navigation="utility"]')`, 60_000).catch(() => false);
      if (seen && await run(win, `Boolean(document.querySelector('[data-qa-cloud-entry="busy"]'))`)) await shot(win, beforeShot, false);
    }
    await waitFor(win, `document.querySelector('[data-qa-navigation="utility"]') || document.querySelector('[data-qa-cloud-conflict]') || document.querySelector('.menu-modal [data-qa-confirm-yes]') || document.querySelector('[data-qa-cloud-wait]')`, 600_000);
    out.entryMs = Date.now() - started;
    out.entered = await run(win, `Boolean(document.querySelector('[data-qa-navigation="utility"]'))`);
    out.dialog = await run(win, `document.querySelector('[data-qa-cloud-conflict]')?.getAttribute('data-qa-cloud-conflict') || null`);
    out.waitSeen = await run(win, `document.querySelector('[data-qa-cloud-wait]')?.getAttribute('data-qa-cloud-wait') || null`);
  }
  /** «Досчитать на этом ПК» in the wait window, until the game is on screen. */
  async function takeNow(win, out) {
    const started = Date.now();
    await run(win, `document.querySelector('[data-qa-cloud-wait-take]').click()`);
    await waitFor(win, `document.querySelector('[data-qa-navigation="utility"]')`, 600_000);
    out.takeNowMs = Date.now() - started;
    out.entered = true;
  }
  /** The facts of the wait window as the player reads them. */
  const waitFacts = (win) => run(win, `Object.fromEntries([...document.querySelectorAll('.cloud-wait__facts div')].map((item) => [item.querySelector('dt').textContent, item.querySelector('dd').textContent]))`);
  /** The same screen at the two reference sizes (the menu stage scales from 1920×1080). */
  async function shotSizes(win, name) {
    if (!shots) return;
    for (const [width, height] of [[1920, 1080], [1280, 720]]) {
      win.setContentSize(width, height);
      await sleep(1_200);
      const image = await win.webContents.capturePage();
      fs.writeFileSync(path.join(OUT_DIR, `${name}-${width}x${height}.png`), image.toPNG());
    }
    win.setContentSize(1600, 900);
    await sleep(300);
  }
  /** The server's view of the campaign, read with this computer's settings (the key stays in the profile). */
  async function serverCampaign() {
    const config = JSON.parse(fs.readFileSync(path.join(PROFILE, 'cloud.json'), 'utf8'));
    const key = fs.readFileSync(path.join(PROFILE, 'cloud-key.txt'), 'utf8').trim();
    const response = await fetch(`${config.url}/v1/campaigns/${SLOT_ID}`, { headers: { authorization: `Bearer ${key}` } });
    return response.ok ? response.json() : null;
  }
  async function afterEntry(win, out) {
    // A late world mounts for a while before the game shows the entry notice.
    const started = Date.now();
    await sleep(800);
    while (Date.now() - started < 10_000 && (await run(win, 'window.__cloudQa.notices.length')) < 2) await sleep(200);
    const qa = await run(win, 'window.__cloudQa');
    out.notices = qa.notices;
    out.bannerSeen = qa.banner.some((text) => text.startsWith('Получаем мир с сервера'));
    out.applied = qa.notices.some((text) => /Мир получен с сервера|Загружена копия с сервера/.test(text));
    out.bannerError = qa.notices.some((text) => /Нет связи|не получен|недоступен/.test(text));
  }
  /** Until no catch-up is running (the world is at the clock). */
  async function caughtUp(win, timeoutMs = 1_800_000) {
    const started = Date.now();
    let quiet = 0;
    while (Date.now() - started < timeoutMs) {
      const busy = await run(win, `Boolean(document.querySelector('[data-qa-npc-catchup="progress"]'))`);
      quiet = busy ? 0 : quiet + 1;
      if (quiet >= 8) return Date.now() - started;
      await sleep(250);
    }
    throw new Error('the catch-up did not finish');
  }
  /** Pause menu → «В главное меню»; returns the upload the main process made of the hand-over. */
  async function leaveToMenu(win) {
    const before = syncFile().lastUpload?.at ?? 0;
    await run(win, `document.querySelector('[data-qa-npc-catchup-close]')?.click()`);
    await sleep(300);
    // In the middle of a catch-up its window opens the pause menu itself.
    await run(win, `document.querySelector('[data-qa-npc-catchup="progress"] .npc-catchup-window__secondary')?.click()
      ?? window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
    await waitFor(win, `document.querySelector('[data-qa-pause="menu"]')`, 20_000);
    await run(win, `document.querySelector('[data-qa-pause="menu"]').click()`);
    await waitFor(win, `document.querySelector('[data-qa-menu]')`, 60_000);
    const started = Date.now();
    while (Date.now() - started < 300_000) {
      const upload = syncFile().lastUpload;
      if (upload && upload.at > before) return upload;
      await sleep(200);
    }
    return null;
  }

  async function step() {
    await app.whenReady();
    registerSaveStore();
    registerCloud();
    // Offscreen rendering keeps painting a hidden window, so screenshots show the current frame.
    const win = new BrowserWindow({ show: false, focusable: false, skipTaskbar: true, width: 1600, height: 900, backgroundColor: '#02050a',
      webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, sandbox: true, backgroundThrottling: false, offscreen: shots } });
    await prepare(win);
    const out = { phase: PHASE };
    if (PHASE === 'settings') {
      await menu(win);
      await run(win, `document.querySelector('[data-qa-menu-action="settings"]').click()`);
      await waitFor(win, `document.querySelector('[data-qa-settings-section="cloud"]')`);
      await run(win, `document.querySelector('[data-qa-settings-section="cloud"]').click()`);
      await waitFor(win, `document.querySelector('[data-qa-cloud-url]')`);
      // Typed as a player would (React inputs need input events).
      win.focus();
      for (const [selector, value] of [['[data-qa-cloud-url]', option('url')], ['[data-qa-cloud-key]', option('key')]]) {
        await run(win, `document.querySelector('${selector}').focus()`);
        await win.webContents.insertText(value);
      }
      await run(win, `document.querySelector('[data-qa-cloud-toggle="on"]').click()`);
      await waitFor(win, `document.querySelector('[data-qa-cloud-settings="on"]')`);
      await waitFor(win, `/версия/.test(document.querySelector('[data-qa-cloud-status]')?.textContent || '')`, 30_000);
      out.serverVersionShown = true;
      out.keyStoredOutsideRepo = fs.existsSync(path.join(PROFILE, 'cloud-key.txt'));
      out.keyNotInConfig = !fs.readFileSync(path.join(PROFILE, 'cloud.json'), 'utf8').includes(option('key'));
      await shot(win, '01-settings-cloud');
    } else if (PHASE === 'first-play') {
      await seed(win, fs.readFileSync(option('world'), 'utf8'));
      await continueCampaign(win, out);
      await afterEntry(win, out);
      out.catchupMs = await caughtUp(win);
      out.upload = await leaveToMenu(win);
    } else if (PHASE === 'from-server' || PHASE === 'local-newer' || PHASE === 'version' || PHASE === 'wrong-key') {
      const before = await storedText(win);
      out.cursorBefore = before && cursorInText(before);
      await continueCampaign(win, out, PHASE === 'from-server' ? '02-entry-banner' : null);
      if (PHASE === 'version' && out.waitSeen) {
        await shot(win, '06-game-older');
        await takeNow(win, out);
      }
      await afterEntry(win, out);
      const text = await storedText(win);
      out.cursorAfterApply = text && cursorInText(text);
      out.gapAfterApplyMs = out.cursorAfterApply ? (await pageNow(win)) - out.cursorAfterApply : null;
      out.claimedFromRevision = syncFile().campaigns?.[SLOT_ID]?.revision - 1;
      out.remainingCatchupMs = await caughtUp(win);
      if (PHASE === 'from-server') await shot(win, '03-applied');
      out.upload = await leaveToMenu(win);
    } else if (PHASE === 'offline') {
      await continueCampaign(win, out);
      await afterEntry(win, out);
      await caughtUp(win);
      // Play a little so the local save moves on, then close the window as a player would.
      await sleep(6_000);
      await run(win, `window.dispatchEvent(new Event('asterion:save-flush'))`);
      const started = Date.now();
      const closed = new Promise((resolve) => win.once('closed', resolve));
      win.close();
      await closed;
      await session.defaultSession.flushStorageData();
      app.once('will-quit', () => {
        out.quitMs = Date.now() - started;
        console.log(JSON.stringify(out));
      });
      app.quit();
      return;
    } else if (PHASE === 'second-pc') {
      await menu(win);
      await run(win, `document.querySelector('[data-qa-menu-action="load"]').click()`);
      await waitFor(win, `document.querySelector('[data-qa-cloud-remote-open="${SLOT_ID}"]')`, 30_000);
      out.listed = true;
      await shot(win, '04-second-pc-load');
      const started = Date.now();
      await run(win, `document.querySelector('[data-qa-cloud-remote-open="${SLOT_ID}"]').click()`);
      await waitFor(win, `document.querySelector('[data-qa-navigation="utility"]')`, 600_000);
      out.entryMs = Date.now() - started;
      out.entered = true;
      await afterEntry(win, out);
      out.applied = (await storedText(win)) !== null;
      out.slotId = await run(win, `JSON.parse(localStorage.getItem(${JSON.stringify(SLOT_INDEX_KEY)})).slots.map((slot) => slot.id)`);
      await caughtUp(win);
      out.upload = await leaveToMenu(win);
    } else if (PHASE === 'conflict') {
      await continueCampaign(win, out);
      out.datesShown = await run(win, `/сохранено \\d\\d\\.\\d\\d\\.\\d{4}/.test(document.querySelector('[data-qa-cloud-conflict]')?.textContent || '') && /выгружено \\d\\d\\.\\d\\d\\.\\d{4}/.test(document.querySelector('[data-qa-cloud-conflict]')?.textContent || '')`);
      await shot(win, '05-conflict');
      await run(win, `document.querySelector('[data-qa-cloud-choose="server"]').click()`);
      await waitFor(win, `document.querySelector('[data-qa-navigation="utility"]')`, 600_000);
      out.entered = true;
      await afterEntry(win, out);
      out.localCopyKept = await run(win, `JSON.parse(localStorage.getItem(${JSON.stringify(SLOT_INDEX_KEY)})).slots.some((slot) => / \\(копия\\)$/.test(slot.name))`);
      await caughtUp(win);
      out.upload = await leaveToMenu(win);
    } else if (PHASE === 'take-now' || PHASE === 'leave-behind') {
      await continueCampaign(win, out);
      if (out.waitSeen) {
        out.lagAtEntryMs = Number(await run(win, `document.querySelector('[data-qa-cloud-wait-lag]')?.getAttribute('data-qa-cloud-wait-lag') || 0`));
        out.facts = await waitFacts(win);
        await takeNow(win, out);
      }
      out.localCatchupSeen = await waitFor(win, `document.querySelector('[data-qa-npc-catchup="progress"]')`, 60_000).then(() => true, () => false);
      await afterEntry(win, out);
      const text = await storedText(win);
      out.cursorAfterApply = text && cursorInText(text);
      out.gapAfterApplyMs = out.cursorAfterApply ? (await pageNow(win)) - out.cursorAfterApply : null;
      if (PHASE === 'take-now') await shot(win, '07-take-now-local-catchup');
      // The player leaves in the middle of the local catch-up (the owner's case on 30.10).
      out.upload = await leaveToMenu(win);
    } else if (PHASE === 'server-catchup') {
      // «Загрузить игру → На сервере»: this computer's campaign, living on the server, and how far behind it is.
      await menu(win);
      await run(win, `document.querySelector('[data-qa-menu-action="load"]').click()`);
      out.listedBehind = await waitFor(win, `/отстаёт/.test(document.querySelector('[data-qa-cloud-remote-campaign="${SLOT_ID}"] [data-qa-cloud-remote-status]')?.textContent || '')`, 60_000).then(() => true, () => false);
      out.listedText = await run(win, `document.querySelector('[data-qa-cloud-remote-campaign="${SLOT_ID}"] [data-qa-cloud-remote-status]')?.textContent || ''`);
      // The «На сервере» block sits under the slot list: scrolled into view as a player would.
      await run(win, `document.querySelector('[data-qa-cloud-remote]')?.scrollIntoView({ block: 'end' })`);
      await shotSizes(win, '08-load-on-server');
      await continueCampaign(win, out);
      if (out.waitSeen === 'catching-up') {
        // The speed shows after the server measured a few seconds of its catch-up.
        await waitFor(win, `document.querySelector('[data-qa-cloud-wait-rate]')?.getAttribute('data-qa-cloud-wait-rate')`, 60_000).catch(() => undefined);
        await sleep(4_000);
        out.facts = await waitFacts(win);
        await shotSizes(win, '05-server-catchup');
        // While the window is up the world stays alive on the server: never claimed.
        const waitStarted = Date.now();
        out.noClaimWhileWaiting = true;
        out.lagSamples = [];
        while (await run(win, `Boolean(document.querySelector('[data-qa-cloud-wait]'))`)) {
          const view = await serverCampaign().catch(() => null);
          if (view) {
            out.lagSamples.push({ s: Math.round((Date.now() - waitStarted) / 1000), lagMs: view.live?.lagMs ?? null, rate: view.live?.rate ?? null });
            if (!view.live || view.live.status !== 'running') out.noClaimWhileWaiting = await run(win, `!document.querySelector('[data-qa-cloud-wait]')`);
          }
          if (Date.now() - waitStarted > 80 * 60_000) throw new Error('the server did not catch up in 80 minutes');
          await sleep(5_000);
        }
        out.waitedMs = Date.now() - waitStarted;
        out.lagSamples = out.lagSamples.filter((_, index, all) => index % Math.max(1, Math.ceil(all.length / 12)) === 0 || index === all.length - 1);
        await waitFor(win, `document.querySelector('[data-qa-navigation="utility"]')`, 600_000);
        out.entered = true;
      }
      await afterEntry(win, out);
      const text = await storedText(win);
      out.cursorAfterApply = text && cursorInText(text);
      out.gapAfterApplyMs = out.cursorAfterApply ? (await pageNow(win)) - out.cursorAfterApply : null;
      out.remainingCatchupMs = await caughtUp(win);
      out.upload = await leaveToMenu(win);
    } else if (PHASE === 'newer-game') {
      await continueCampaign(win, out);
      if (out.waitSeen) {
        out.facts = await waitFacts(win);
        await shot(win, '09-server-updating');
        const started = Date.now();
        await waitFor(win, `document.querySelector('[data-qa-navigation="utility"]')`, 15 * 60_000);
        out.waitedMs = Date.now() - started;
        out.entered = true;
      }
      await afterEntry(win, out);
      out.remainingCatchupMs = await caughtUp(win);
      out.upload = await leaveToMenu(win);
    } else if (PHASE === 'local-reference') {
      // Cloud off on this computer: the same absence is caught up by the game itself.
      const text = fs.readFileSync(option('world'), 'utf8');
      await seed(win, text);
      out.serverGapMs = Number(option('gap-ms'));
      out.actualGapMs = (await pageNow(win)) - cursorInText(text);
      await continueCampaign(win, out);
      out.catchupMs = await caughtUp(win);
      out.totalMs = out.entryMs + out.catchupMs;
      await menu(win);
    }
    await menu(win).catch(() => undefined);
    console.log(JSON.stringify(out));
    app.exit(0);
  }
  step().catch((error) => { console.error(error); app.exit(1); });
}
