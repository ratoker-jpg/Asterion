// Frame pacing of the built game on a late-game save: requestAnimationFrame
// intervals (p50 / p95 / worst) and long tasks per screen, idle and while an
// NPC catch-up runs. Uses a disposable userData directory.
//
//   npm run test:late-game-fps-ui -- [--fixture=F] [--catchup-hours=H] [--seconds=N] [--software] [--out=DIR]
//
// --fixture: a plain SaveState JSON from `npm run benchmark:late-game -- generate`
//   (day 3 / day 7 of the full world). The save is loaded as is; the page
//   clock is moved so that its replay cursor sits H hours before "now"
//   (H = 0: idle at once).
//   Without it a fresh full-world campaign (day 0, 2026-01-01) is used, which
//   CI can afford; --catchup-hours=H then makes the game itself catch up H hours.
// --software: CPU rendering, as the other Electron QA jobs (the game itself uses the GPU).
// --max-p95-ms=X: fail when an idle screen's p95 frame interval exceeds X (CI: 150).
const { app, BrowserWindow } = require('electron');
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const raw = args.find((arg) => arg.startsWith(`--${name}=`));
  return raw ? raw.slice(name.length + 3) : fallback;
};
// CI runners have no GPU worth measuring: CPU rendering there, as the other Electron QA jobs.
const SOFTWARE = args.includes('--software') || process.env.CI === 'true';
if (SOFTWARE) {
  app.disableHardwareAcceleration();
  app.commandLine.appendSwitch('disable-gpu');
}
// Keep producing frames when the window is covered or the screen is locked.
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.on('window-all-closed', () => {});

const PROFILE = fs.mkdtempSync(path.join(os.tmpdir(), 'asterion-fps-qa-'));
app.setPath('userData', PROFILE);

const ROOT = path.join(__dirname, '..');
const FIXTURE = option('fixture');
const CATCHUP_HOURS = Number(option('catchup-hours', '0'));
const SECONDS = Number(option('seconds', '6'));
// CI budget: a screen that blocks the UI thread every second shows in p95 at once.
const MAX_P95_MS = option('max-p95-ms') ? Number(option('max-p95-ms')) : process.env.CI === 'true' ? 150 : null;
// --cpu-profile=F: a renderer CPU profile of the idle planet screen (diagnostics).
const CPU_PROFILE = option('cpu-profile');
const OUTPUT = option('out', path.join(ROOT, 'artifacts', 'late-game-fps-qa'));
const LEGACY_KEY = 'asterion.vertical-slice.v1';
const SLOT_INDEX_KEY = 'asterion.slots.index.v1';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const run = (win, source) => win.webContents.executeJavaScript(source);

// Header route, the element that marks the screen as shown.
const SCREENS = [
  ['planet', '.planet-page-v3'],
  ['universe', '.universe-view'],
  ['fleets', '.fleet-main-v1'],
  ['rating', '[data-qa-utility-screen="rating"]'],
  ['command', '.command-view'],
  ['reports', '.reports-view'],
];

function freshCampaign() {
  const source = `
    import { createFullWorldFixture } from './tools/benchmark-npc-full-world.mjs';
    console.log(JSON.stringify(createFullWorldFixture()));
  `;
  const child = spawnSync(process.execPath, [
    '--experimental-strip-types',
    '--experimental-loader', pathToFileURL(path.join(ROOT, 'src', 'domain', 'combat', 'test-asset-loader.mjs')).href,
    '--input-type=module', '-e', source,
  ], { cwd: ROOT, encoding: 'utf8', env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, maxBuffer: 256 * 1024 * 1024, timeout: 60_000 });
  if (child.status !== 0) throw new Error(`Campaign generation failed: ${(child.stderr || child.stdout).slice(-2_000)}`);
  return JSON.parse(child.stdout.trim());
}

/**
 * The save stays as generated; the page clock is moved instead so that the
 * replay cursor sits CATCHUP_HOURS before "now" (a whole number of minutes,
 * which App passes on to the catch-up worker).
 */
function prepareSave() {
  const state = FIXTURE ? JSON.parse(fs.readFileSync(FIXTURE, 'utf8')) : freshCampaign();
  const cursor = state.npcReplay?.processedThroughAt ?? state.resourceClock.lastReconciledAt;
  const target = cursor + CATCHUP_HOURS * 3_600_000;
  const delta = Math.round((target - Date.now()) / 60_000) * 60_000;
  return { raw: JSON.stringify(state), delta, sourceCursor: cursor };
}

async function movePageClock(win, offsetMs) {
  if (!offsetMs) return;
  const dbg = win.webContents.debugger;
  if (!dbg.isAttached()) dbg.attach('1.3');
  await dbg.sendCommand('Page.enable');
  await dbg.sendCommand('Page.addScriptToEvaluateOnNewDocument', { source: `(() => {
    const RealDate = Date;
    const offset = ${offsetMs};
    class MovedDate extends RealDate {
      constructor(...args) { if (args.length === 0) super(RealDate.now() + offset); else super(...args); }
      static now() { return RealDate.now() + offset; }
    }
    globalThis.Date = MovedDate;
  })();` });
}

async function waitFor(win, expression, timeoutMs = 30_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await run(win, `Boolean(${expression})`)) return;
    await sleep(80);
  }
  throw new Error(`Timed out waiting for: ${expression}`);
}

async function load(win, search) {
  await win.loadFile(path.join(ROOT, 'dist', 'index.html'), search ? { search } : undefined);
}

const PROBE = `(() => {
  if (window.__fpsQa) return;
  const qa = { on: false, frames: [], longTasks: [], gaps: [], last: 0, lastTimer: 0 };
  // A 16 ms timer: its gaps are how long the UI thread was busy, whether or not
  // the compositor is producing frames (a locked screen stops rAF, not timers).
  setInterval(() => {
    const now = performance.now();
    if (qa.on && qa.lastTimer) qa.gaps.push(now - qa.lastTimer);
    qa.lastTimer = now;
  }, 16);
  window.__fpsQa = qa;
  try {
    new PerformanceObserver((list) => { if (qa.on) for (const entry of list.getEntries()) qa.longTasks.push(entry.duration); })
      .observe({ type: 'longtask', buffered: false });
  } catch { /* longtask timing unavailable */ }
  const tick = (time) => {
    if (qa.on && qa.last) qa.frames.push(time - qa.last);
    qa.last = time;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  qa.start = () => { qa.frames = []; qa.longTasks = []; qa.gaps = []; qa.last = 0; qa.lastTimer = 0; qa.on = true; };
  qa.stop = () => {
    qa.on = false;
    const sorted = [...qa.frames].sort((a, b) => a - b);
    const pick = (q) => sorted.length ? sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * q) - 1)] : null;
    const total = qa.frames.reduce((sum, value) => sum + value, 0);
    const longTasks = [...qa.longTasks].sort((a, b) => a - b);
    const round = (value) => value === null ? null : Math.round(value * 10) / 10;
    return {
      frames: sorted.length,
      fps: total ? Math.round(sorted.length / total * 1000 * 10) / 10 : null,
      p50Ms: round(pick(0.5)), p95Ms: round(pick(0.95)), worstMs: round(sorted.length ? sorted[sorted.length - 1] : null),
      over33Ms: sorted.filter((value) => value > 33.4).length,
      longTasks: { count: longTasks.length, totalMs: Math.round(longTasks.reduce((sum, value) => sum + value, 0)),
        worstMs: longTasks.length ? Math.round(longTasks[longTasks.length - 1]) : null },
      timer: (() => {
        const gaps = [...qa.gaps].sort((a, b) => a - b);
        const at = (q) => gaps.length ? round(gaps[Math.min(gaps.length - 1, Math.ceil(gaps.length * q) - 1)]) : null;
        return { samples: gaps.length, p50Ms: at(0.5), p95Ms: at(0.95), worstMs: gaps.length ? round(gaps[gaps.length - 1]) : null };
      })(),
    };
  };
})()`;

async function measure(win, seconds) {
  await run(win, PROBE);
  await run(win, 'window.__fpsQa.start()');
  await sleep(seconds * 1_000);
  return run(win, 'window.__fpsQa.stop()');
}

async function openScreen(win, route, selector) {
  const clicked = await run(win, `(() => {
    const element = document.querySelector('[data-qa-route="${route}"]');
    if (!element || element.disabled) return false;
    element.click();
    return true;
  })()`);
  if (!clicked) throw new Error(`Route button not found: ${route}`);
  await waitFor(win, `document.querySelector(${JSON.stringify(selector)})`, 20_000);
  await sleep(1_500);
}

async function main() {
  await app.whenReady();
  // Never shown and never focused (it must not take over the desktop): the
  // page renders offscreen at 60 fps, so rAF intervals still reflect the UI thread.
  const win = new BrowserWindow({
    show: false, width: 1920, height: 1080, useContentSize: true, focusable: false, skipTaskbar: true,
    webPreferences: { contextIsolation: true, sandbox: true, backgroundThrottling: false, offscreen: true },
  });
  win.webContents.setFrameRate(60);
  const save = prepareSave();
  await load(win, '?autostart=continue');
  await waitFor(win, `document.querySelector('[data-qa-navigation="utility"]')`);
  const saveKey = await run(win, `(() => {
    const index = JSON.parse(localStorage.getItem(${JSON.stringify(SLOT_INDEX_KEY)}) || 'null');
    const slot = index?.slots?.find((item) => item.id === index.activeSlotId);
    return slot?.storageKey || ${JSON.stringify(LEGACY_KEY)};
  })()`);
  await run(win, `localStorage.setItem(${JSON.stringify(saveKey)}, ${JSON.stringify(save.raw)})`);
  await movePageClock(win, save.delta);
  const loadStarted = Date.now();
  await load(win, '?autostart=continue');
  try {
    await waitFor(win, `document.querySelector('[data-qa-navigation="utility"]')`, 180_000);
  } catch (error) {
    const screen = await run(win, `JSON.stringify({ text: (document.body?.innerText || '').slice(-260), index: localStorage.getItem(${JSON.stringify(SLOT_INDEX_KEY)}), saved: (localStorage.getItem(${JSON.stringify(saveKey)}) || '').length, key: ${JSON.stringify(saveKey)} })`).catch((e) => String(e));
    throw new Error(`${error.message}
On screen: ${screen}`);
  }
  const result = {
    fixture: FIXTURE ? path.basename(FIXTURE) : 'fresh full-world campaign (day 0)',
    saveChars: save.raw.length, pageClockOffsetMs: save.delta, catchupHours: CATCHUP_HOURS,
    rendering: SOFTWARE ? 'software (disable-gpu)' : 'gpu', viewport: [1920, 1080], secondsPerScreen: SECONDS,
    loadMs: Date.now() - loadStarted, catchup: null, screens: {},
  };
  await run(win, PROBE);
  if (CATCHUP_HOURS > 0) {
    // Frames while the world catches up (the progress window is over the planet screen).
    await run(win, 'window.__fpsQa.start()');
    const started = Date.now();
    const pending = `(() => { try { const save = JSON.parse(localStorage.getItem(${JSON.stringify(saveKey)}) || 'null');
      return save?.npcReplay?.targetAt > save?.npcReplay?.processedThroughAt; } catch { return true; } })()`;
    await waitFor(win, `!${pending} && !document.querySelector('[data-qa-npc-catchup] [role="progressbar"]')`, 3_600_000);
    result.catchup = { wallMs: Date.now() - started, gameHoursPerSecond: CATCHUP_HOURS / ((Date.now() - started) / 1000),
      frames: await run(win, 'window.__fpsQa.stop()') };
    await run(win, `document.querySelector('[data-qa-npc-catchup-close]')?.click()`);
    await sleep(500);
  }
  if (CPU_PROFILE) {
    await openScreen(win, 'planet', '.planet-page-v3');
    const dbg = win.webContents.debugger;
    if (!dbg.isAttached()) dbg.attach('1.3');
    await dbg.sendCommand('Profiler.enable');
    await dbg.sendCommand('Profiler.start');
    await sleep(SECONDS * 1_000);
    const { profile } = await dbg.sendCommand('Profiler.stop');
    fs.writeFileSync(CPU_PROFILE, JSON.stringify(profile));
  }
  for (const [route, selector] of SCREENS) {
    await openScreen(win, route, selector);
    result.screens[route] = await measure(win, SECONDS);
    process.stderr.write(`${route}: ${JSON.stringify(result.screens[route])}\n`);
  }
  fs.mkdirSync(OUTPUT, { recursive: true });
  fs.writeFileSync(path.join(OUTPUT, 'fps.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
  if (MAX_P95_MS !== null) {
    const slow = Object.entries(result.screens).filter(([, value]) => value.p95Ms === null || value.p95Ms > MAX_P95_MS);
    if (slow.length) throw new Error(`Idle frame p95 over ${MAX_P95_MS} ms: ${slow.map(([route, value]) => `${route} ${value.p95Ms}`).join(', ')}`);
  }
}

const cleanup = () => {
  try { fs.rmSync(PROFILE, { recursive: true, force: true }); } catch { /* Chromium may still hold the profile on Windows */ }
};
main().then(() => { cleanup(); app.exit(0); }, (error) => {
  console.error(error);
  cleanup();
  app.exit(1);
});
