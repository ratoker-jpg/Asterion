// Late-game saves across real restarts of the built game (hidden, unfocused
// windows; one disposable profile shared by several Electron processes):
//
//   1. migration: a save an older build left in localStorage (day 2, ~40 M
//      characters) loads, and the game's next write moves it to the desktop
//      store behind a pointer;
//   2. restart: that world loads again after the process exits;
//   3. close during a catch-up: a day-3 world (~58 M, over the localStorage
//      limit) catching up one hour is closed mid-way; after a restart it
//      loads and keeps the progress the worker had saved;
//   4. close during an asynchronous write: the main process is made slow to
//      finish file writes, the window is closed while one is in flight; the
//      newest state is on disk anyway (flushed synchronously on pagehide).
//
//   npm run test:late-save-ui -- --plain=late-game-day-2.json --large=late-game-day-3.json
//
// The fixtures come from `npm run benchmark:late-game -- generate` (they are
// too large for CI). Exits 1 on any loss.
const { app, BrowserWindow, session } = require('electron');
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const raw = args.find((arg) => arg.startsWith(`--${name}=`));
  return raw ? raw.slice(name.length + 3) : fallback;
};
const ROOT = path.join(__dirname, '..');
const PHASE = option('phase');
const SLOT_INDEX_KEY = 'asterion.slots.index.v1';
const LEGACY_KEY = 'asterion.vertical-slice.v1';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

if (!PHASE) {
  // Driver: plain Node in the Electron binary, one child process per phase.
  const plain = option('plain');
  const large = option('large');
  if (!plain || !large) {
    console.error('Usage: --plain=<day-2 fixture> --large=<day-3 fixture>');
    process.exit(2);
  }
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'asterion-late-save-qa-'));
  // Each phase is a real Electron app, not Node.
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const phase = (name, extra = []) => {
    const child = spawnSync(process.execPath, [__filename, `--phase=${name}`, `--profile=${profile}`, ...extra],
      { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 20 * 60_000, env });
    const line = (child.stdout || '').split('\n').find((text) => text.startsWith('{"phase"'));
    if (child.status !== 0 || !line) throw new Error(`Phase ${name} failed (${child.status}): ${(child.stderr || '').slice(-3_000)}`);
    const result = JSON.parse(line);
    console.log(JSON.stringify(result));
    return result;
  };
  const failures = [];
  const expect = (ok, message) => { if (!ok) failures.push(message); };
  try {
    const migrated = phase('migrate', [`--fixture=${path.resolve(plain)}`]);
    expect(migrated.seededPlainChars > 8_000_000 && migrated.seededPlainChars < 52_000_000, 'the plain seed is a localStorage-sized late save');
    expect(migrated.after.external && migrated.after.fileExists, 'the game moved the old localStorage save to the desktop store');
    const restarted = phase('reload');
    expect(restarted.loaded && !restarted.problem, 'the migrated save loads after a restart');
    expect(restarted.loadedCursor >= migrated.after.fileCursor, 'the restart did not go back in time');

    const closed = phase('catchup-close', [`--fixture=${path.resolve(large)}`, '--catchup-hours=1']);
    expect(closed.progressSaved, 'the worker saved catch-up progress before the window closed');
    expect(closed.closedMidCatchup, 'the window closed while the catch-up was still running');
    expect(closed.fileCursorAtClose >= closed.savedCursorBeforeClose, 'closing did not replace saved progress with an older state');
    const resumed = phase('reload');
    expect(resumed.loaded && !resumed.problem, 'the day-3 save loads after closing mid catch-up');
    expect(resumed.loadedCursor >= closed.fileCursorAtClose, 'catch-up progress written before closing is kept');
    expect(resumed.loadedCursor > closed.seedCursor, 'progress beyond the seed survived');

    const asyncClose = phase('async-close');
    expect(asyncClose.closedDuringAsyncWrite, 'the window closed while an asynchronous write was in flight');
    expect(asyncClose.fileCursorAfterClose >= asyncClose.cursorAtClose, 'the newest state reached the disk on close');
    const final = phase('reload');
    expect(final.loaded && !final.problem, 'the save loads after closing during an asynchronous write');
    expect(final.loadedCursor >= asyncClose.cursorAtClose, 'nothing was lost by closing during the write');
  } catch (error) {
    failures.push(error.message);
  }
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* Chromium may still hold files */ }
  if (failures.length) {
    console.error(`Late save QA failed:\n- ${failures.join('\n- ')}`);
    process.exit(1);
  }
  console.log('Late save QA passed.');
  process.exit(0);
}

// ---- One phase in one Electron process ----
const PROFILE = option('profile');
app.setPath('userData', PROFILE);
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.on('window-all-closed', () => {});
const STATE_FILE = path.join(PROFILE, 'late-save-qa.json');
const memo = () => (fs.existsSync(STATE_FILE) ? JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')) : {});
const remember = (values) => fs.writeFileSync(STATE_FILE, JSON.stringify({ ...memo(), ...values }));

// Phase 4: file writes in the main process take seconds, so a close lands inside one.
let asyncWritesInFlight = 0;
let newestRequestedCursor = null;
const cursorInText = (text) => {
  const match = typeof text === 'string' ? /"npcReplay":\{"version":1,"processedThroughAt":(\d+)/.exec(text) : null;
  return match ? Number(match[1]) : null;
};
if (PHASE === 'async-close') {
  const realWrite = fs.promises.writeFile;
  fs.promises.writeFile = async (...writeArgs) => {
    asyncWritesInFlight += 1;
    const cursor = cursorInText(writeArgs[1]);
    if (cursor !== null) newestRequestedCursor = Math.max(newestRequestedCursor ?? 0, cursor);
    try {
      await sleep(4_000);
      return await realWrite(...writeArgs);
    } finally {
      asyncWritesInFlight -= 1;
    }
  };
}
const { registerSaveStore } = require('./save-store.cjs');

const run = (win, source) => win.webContents.executeJavaScript(source);
async function waitFor(win, expression, timeoutMs = 60_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await run(win, `Boolean(${expression})`)) return true;
    await sleep(100);
  }
  throw new Error(`Timed out waiting for: ${expression}`);
}
async function load(win, search) {
  await win.loadFile(path.join(ROOT, 'dist', 'index.html'), search ? { search } : undefined);
}
async function movePageClock(win, offsetMs) {
  if (!offsetMs) return;
  const dbg = win.webContents.debugger;
  if (!dbg.isAttached()) dbg.attach('1.3');
  await dbg.sendCommand('Page.enable');
  await dbg.sendCommand('Page.addScriptToEvaluateOnNewDocument', { source: `(() => {
    const RealDate = Date; const offset = ${offsetMs};
    class MovedDate extends RealDate {
      constructor(...a) { if (a.length === 0) super(RealDate.now() + offset); else super(...a); }
      static now() { return RealDate.now() + offset; }
    }
    globalThis.Date = MovedDate;
  })();` });
}
const PROBE = `(() => {
  if (window.__saveQa) return;
  const qa = { replay: null };
  window.addEventListener('asterion:runtime-state-changed', (event) => { if (event.detail?.npcReplay) qa.replay = { ...event.detail.npcReplay }; });
  window.addEventListener('asterion:npc-catchup-progress', (event) => { if (event.detail) qa.replay = { ...event.detail, progress: true }; });
  window.__saveQa = qa;
})()`;
const pointerOf = (win, key) => run(win, `(() => { const raw = localStorage.getItem(${JSON.stringify(key)}) || '';
  try { const pointer = JSON.parse(raw.length < 512 ? raw : 'null')?.asterionExternalSave; if (pointer) return { external: true, writeId: pointer.writeId, chars: pointer.chars }; } catch {}
  return { external: false, chars: raw.length }; })()`);
/** The replay cursor stored in the save file a pointer names. */
function fileCursor(key, pointer) {
  if (!pointer?.external) return null;
  const file = path.join(PROFILE, 'saves', `${key}.${pointer.writeId}.save.json`);
  if (!fs.existsSync(file)) return null;
  const state = JSON.parse(fs.readFileSync(file, 'utf8'));
  return state.npcReplay?.processedThroughAt ?? null;
}
async function openGame(win, offsetMs) {
  // The debugger attaches to a loaded page (a fresh window's blank page never answers Page.enable).
  if (!win.webContents.getURL()) await load(win, '');
  await movePageClock(win, offsetMs);
  await load(win, '?autostart=continue');
  await run(win, PROBE);
  await waitFor(win, `document.querySelector('[data-qa-navigation="utility"]') || document.querySelector('[data-qa-save-problem]')`, 240_000);
  await run(win, PROBE);
  return !(await run(win, `Boolean(document.querySelector('[data-qa-save-problem]'))`));
}
/** Closes the window as a player would and lets Chromium write localStorage. */
async function closeGame(win) {
  const closed = new Promise((resolve) => win.once('closed', resolve));
  win.close();
  await closed;
  await session.defaultSession.flushStorageData();
}
/** A fresh slot's storage key, seeded with `raw` (the store for long saves, as the game writes them). */
async function seed(win, raw, plain) {
  await load(win, '?autostart=continue');
  await waitFor(win, `document.querySelector('[data-qa-navigation="utility"]')`);
  const key = await run(win, `(() => {
    const index = JSON.parse(localStorage.getItem(${JSON.stringify(SLOT_INDEX_KEY)}) || 'null');
    return index?.slots?.find((item) => item.id === index.activeSlotId)?.storageKey || ${JSON.stringify(LEGACY_KEY)};
  })()`);
  // Back to the menu: a running game autosaves every tick.
  await load(win, '');
  await sleep(1_000);
  await run(win, plain
    ? `localStorage.setItem(${JSON.stringify(key)}, ${JSON.stringify(raw)})`
    : `(() => { window.asterionDesktop.saveStore.write(${JSON.stringify(key)}, 'qa-seed', ${JSON.stringify(raw)});
        localStorage.setItem(${JSON.stringify(key)}, JSON.stringify({ asterionExternalSave: { version: 1, writeId: 'qa-seed', chars: ${raw.length} }, saveWriter: 1 })); })()`);
  return key;
}

async function phase() {
  await app.whenReady();
  registerSaveStore();
  const win = new BrowserWindow({ show: false, focusable: false, skipTaskbar: true, width: 1600, height: 900,
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, sandbox: true, backgroundThrottling: false } });
  const out = { phase: PHASE };
  if (PHASE === 'migrate') {
    const raw = fs.readFileSync(option('fixture'), 'utf8');
    const state = JSON.parse(raw);
    const offset = Math.round((state.npcReplay.processedThroughAt - Date.now()) / 60_000) * 60_000;
    const key = await seed(win, raw, true);
    out.seededPlainChars = raw.length;
    out.loaded = await openGame(win, offset);
    // The next write of this ~40 M save goes to the desktop store.
    await waitFor(win, `(() => { const raw = localStorage.getItem(${JSON.stringify(key)}) || ''; return raw.length < 512 && raw.includes('asterionExternalSave'); })()`, 180_000);
    const pointer = await pointerOf(win, key);
    out.after = { ...pointer, fileExists: fileCursor(key, pointer) !== null, fileCursor: fileCursor(key, pointer) };
    await closeGame(win);
    out.after.fileCursorAfterClose = fileCursor(key, await pointerAfterClose(key));
    remember({ key, offset });
  } else if (PHASE === 'reload') {
    const { key, offset } = memo();
    out.loaded = await openGame(win, offset);
    out.problem = !out.loaded;
    if (out.loaded) {
      await waitFor(win, 'window.__saveQa.replay', 60_000);
      out.loadedCursor = (await run(win, 'window.__saveQa.replay')).processedThroughAt;
    }
    out.pointer = await pointerOf(win, key);
    // Leave without writing anything newer than what was checked.
    await load(win, '');
    await closeGame(win);
  } else if (PHASE === 'catchup-close') {
    const raw = fs.readFileSync(option('fixture'), 'utf8');
    const state = JSON.parse(raw);
    const hours = Number(option('catchup-hours', '1'));
    out.seedCursor = state.npcReplay.processedThroughAt;
    const offset = Math.round((out.seedCursor + hours * 3_600_000 - Date.now()) / 60_000) * 60_000;
    const key = await seed(win, raw, false);
    out.loaded = await openGame(win, offset);
    // Until the worker has saved progress past the seed (the file the pointer names says so), then close mid-way.
    const started = Date.now();
    let saved = null;
    while (Date.now() - started < 900_000) {
      saved = fileCursor(key, await pointerOf(win, key));
      if (saved !== null && saved > out.seedCursor) break;
      await sleep(1_000);
    }
    const replay = await run(win, 'window.__saveQa.replay');
    out.savedCursorBeforeClose = saved;
    out.progressAtClose = replay && { processedThroughAt: replay.processedThroughAt, targetAt: replay.targetAt };
    out.progressSaved = saved !== null && saved > out.seedCursor;
    out.closedMidCatchup = Boolean(replay && replay.processedThroughAt < replay.targetAt);
    await closeGame(win);
    // What the pointer names on disk once the window is gone.
    out.fileCursorAtClose = fileCursor(key, await pointerAfterClose(key));
    remember({ key, offset });
  } else if (PHASE === 'async-close') {
    const { key, offset } = memo();
    out.loaded = await openGame(win, offset);
    // Wait until a clock-tick autosave is in flight in the (slowed) main process, then close.
    const started = Date.now();
    while (asyncWritesInFlight === 0 && Date.now() - started < 240_000) await sleep(50);
    out.closedDuringAsyncWrite = asyncWritesInFlight > 0;
    // The state being written when the window closed: the newest the game asked to keep.
    out.cursorAtClose = newestRequestedCursor;
    await closeGame(win);
    // The slowed write may still finish after the close; it must not win.
    while (asyncWritesInFlight > 0) await sleep(100);
    out.fileCursorAfterClose = fileCursor(key, await pointerAfterClose(key));
  }
  console.log(JSON.stringify(out));
}

/** The pointer for `key` as stored once the game window is gone (a menu page does not write saves). */
async function pointerAfterClose(key) {
  const reader = new BrowserWindow({ show: false, focusable: false, skipTaskbar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, sandbox: true } });
  await load(reader, '');
  const pointer = await pointerOf(reader, key);
  reader.destroy();
  return pointer;
}

phase().then(() => app.exit(0), (error) => { console.error(error); app.exit(1); });
