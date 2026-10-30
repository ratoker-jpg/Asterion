// Cloud world in the built game against a local cloud server (the server's own
// code, server/src/server.ts, on 127.0.0.1 — CI never reaches a real server).
// Two "computers" are two Electron profiles; every step is a real Electron
// process (hidden window):
//
//   settings      Settings → «Облачный мир»: address and key typed, «Проверить связь»
//   first-play    a campaign not yet on the server: local entry; leaving it hands the world over
//   (the server keeps it alive for --live-seconds)
//   from-server   «Продолжить»: «Получаем мир с сервера…», the server's world applied in seconds
//   version       a game of another version: local catch-up, the server world stops (kept as a backup)
//   offline       the server is down: local entry at once; closing the window waits ≤ a few seconds
//   local-newer   played offline, server back: the local save goes on, the server world stops
//   second-pc     a profile without the campaign: «Загрузить игру → На сервере»
//   conflict      both copies changed: the choice with dates; «Взять с сервера» keeps a local copy slot
//   wrong-key     the server refuses the key: local entry with the reason
//   local-reference (with --fixture) the same absence caught up locally, for the timing comparison
//
//   npm run test:cloud-world-ui                       (small generated world, CI)
//   npm run test:cloud-world-ui -- --fixture=late-game-day-2.json --live-seconds=300 --behind-minutes=30
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
  const startServer = async () => {
    if (realUrl) { reachable = true; return; }
    if (!port) port = await freePort();
    server = spawn(nodeBin, [...nodeArgs, path.join(ROOT, 'server/src/server.ts')], {
      cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, ASTERION_DATA: dataDir, ASTERION_KEY_FILE: keyFile, ASTERION_PORT: String(port), ASTERION_VERSION: version,
        ASTERION_RELEASES: path.join(dataDir, 'releases'), ASTERION_STEP_MS: '2000', ASTERION_STEP_BUDGET_MS: '3000',
        ASTERION_RUNNER_OVERRIDE: JSON.stringify({ script: path.join(ROOT, 'server/src/runner.ts'), execArgv: nodeArgs, version }) },
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
  const phase = (name, profile, extra = []) => {
    // The address of an unreachable server: nothing listens on port 9.
    if (realUrl && fs.existsSync(path.join(profile, 'cloud.json'))) {
      const config = JSON.parse(fs.readFileSync(path.join(profile, 'cloud.json'), 'utf8'));
      fs.writeFileSync(path.join(profile, 'cloud.json'), JSON.stringify({ ...config, url: reachable ? realUrl : 'http://127.0.0.1:9' }));
    }
    const child = spawnSync(process.execPath, [__filename, `--phase=${name}`, `--profile=${profile}`, `--offset=${offset}`, `--url=${base()}`, slotArg, ...extra],
      { cwd: ROOT, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, timeout: 30 * 60_000, env });
    const line = (child.stdout || '').split('\n').find((text) => text.startsWith('{"phase"'));
    if (child.status !== 0 || !line) throw new Error(`Phase ${name} failed (${child.status}): ${(child.stderr || '').slice(-3_000)}`);
    const result = JSON.parse(line);
    console.log(JSON.stringify(result));
    return result;
  };
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

      results.version = phase('version', profiles.a, ['--app-version=0.0.1-qa']);
      expect(results.version.entered && !results.version.applied, 'another game version does not take the server world');
      expect(/версией/.test(results.version.notices.join(' ')), 'the player sees why the world is caught up locally');
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
      results.campaign = SLOT;
    } catch (error) {
      failures.push(error.stack || error.message);
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
  const shot = async (win, name) => {
    if (!shots) return;
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
      if (seen && await run(win, `Boolean(document.querySelector('[data-qa-cloud-entry="busy"]'))`)) await shot(win, beforeShot);
    }
    await waitFor(win, `document.querySelector('[data-qa-navigation="utility"]') || document.querySelector('[data-qa-cloud-conflict]') || document.querySelector('.menu-modal [data-qa-confirm-yes]')`, 600_000);
    out.entryMs = Date.now() - started;
    out.entered = await run(win, `Boolean(document.querySelector('[data-qa-navigation="utility"]'))`);
    out.dialog = await run(win, `document.querySelector('[data-qa-cloud-conflict]')?.getAttribute('data-qa-cloud-conflict') || null`);
  }
  async function afterEntry(win, out) {
    await sleep(800);
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
    await run(win, `window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
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
    const win = new BrowserWindow({ show: false, focusable: false, skipTaskbar: true, width: 1600, height: 900,
      webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, sandbox: true, backgroundThrottling: false } });
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
