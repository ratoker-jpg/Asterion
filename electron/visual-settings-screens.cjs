// «Настройки» redo (12.11.2026): worst-case screenshots of the settings screen at
// 1280×720 and 2560×1080, opened from the in-game menu (≡ → Настройки).
// Data is deterministic: the preferences, sound and frame-counter switches are
// written to localStorage before a reload, and the Windows app is played by a
// stand-in `window.asterionDesktop` (window mode, cloud world with fixed dates and
// long values, bot journal). No real server, no key: the key field stays empty.
// Layout contracts (ASTERION_QA_CHECKS=0 records them without failing, used for the
// «before» run on main): no text cut off without an ellipsis, no native title
// tooltips, no native <select>, no horizontal scroll.
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');
const { waitForCommands } = require('./qa-save-edit.cjs');

app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-gpu');
app.on('window-all-closed', () => {});

const ROOT = path.join(__dirname, '..');
const OUTPUT = process.env.ASTERION_QA_OUTPUT || path.join(ROOT, 'visual-qa', 'screens-settings', 'run');
const CHECKS = process.env.ASTERION_QA_CHECKS !== '0';
const SHOTS = process.env.ASTERION_SKIP_SCREENSHOTS !== '1';
const SAVE_KEY = 'asterion.vertical-slice.test.v1';
const VIEWPORTS = [[1280, 720], [2560, 1080]];
const ROOT_SELECTOR = '.settings-view-v2';
const KEYS = ['hud', 'pageTitle', 'sectionTitle', 'body', 'table', 'control', 'secondary', 'helper'];
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Fixed moments (UTC): 12.11.2026 18:40 and around it.
const T = Date.UTC(2026, 10, 12, 18, 40, 0);

async function waitFor(win, expression, timeoutMs = 20000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await win.webContents.executeJavaScript(`Boolean(${expression})`)) return;
    await sleep(60);
  }
  throw new Error(`Timed out waiting for: ${expression}`);
}

async function settle(win, ms = 160) {
  await win.webContents.executeJavaScript('new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
  await sleep(ms);
}

async function capture(win, directory, name) {
  if (!SHOTS) return;
  await waitFor(win, `Array.from(document.querySelectorAll('${ROOT_SELECTOR} img')).every((img) => img.complete)`, 15000).catch(() => {});
  await win.webContents.executeJavaScript(`document.getAnimations().forEach((animation) => {
    const timing = animation.effect?.getComputedTiming?.();
    if (timing && Number.isFinite(timing.endTime)) animation.currentTime = timing.endTime;
  })`);
  await settle(win, 120);
  const result = await win.webContents.debugger.sendCommand('Page.captureScreenshot', { format: 'jpeg', quality: 80, fromSurface: true, captureBeyondViewport: false });
  fs.writeFileSync(path.join(directory, `${name}.jpg`), Buffer.from(result.data, 'base64'));
}

/** Preferences, sound and the frame counter, written before the game starts. */
async function prepare(win, { text = 100, muted = false, frameMeter = false, display = { mode: 'windowed', preset: '1600x900' } } = {}) {
  const typography = Object.fromEntries(KEYS.map((key) => [key, text]));
  await win.webContents.executeJavaScript(`(() => {
    localStorage.setItem('asterion.preferences.v2', ${JSON.stringify(JSON.stringify({ version: 2, typography, display }))});
    localStorage.setItem('asterion.audio.v1', ${JSON.stringify(JSON.stringify({ version: 1, muted, master: 90, music: 55, effects: 75, interface: 60 }))});
    localStorage.setItem('asterion.frame-meter.v1', ${JSON.stringify(frameMeter ? '1' : '0')});
  })()`);
  const loaded = new Promise((resolve) => win.webContents.once('did-finish-load', resolve));
  win.webContents.reload();
  await loaded;
  await waitFor(win, `document.querySelector('[data-qa-navigation="primary"]')`);
  await waitForCommands(win);
  await win.webContents.executeJavaScript('document.fonts?.ready');
  await settle(win);
}

/**
 * The Windows app as the settings screen sees it. `cloud`: 'live' (on, a world
 * runs on the server, long names, a stall and a last error), 'off' (switched off,
 * the server did not answer) or null (no cloud bridge).
 */
async function installDesktop(win, cloud) {
  const settings = cloud === 'live'
    ? {
      url: 'https://asterion-world.example-hosting-provider.cloud/very/long/path/to/the/server',
      enabled: true, hasKey: true, deviceId: 'qa-device', appVersion: '1.8.99',
      lastUpload: { campaignId: 'c1', at: T - 95_000, left: false, ok: true, revision: 128_456, gzBytes: 48_734_208 },
      lastError: { at: T - 3_600_000, text: 'Сервер не ответил за 30 секунд: соединение прервано на стороне провайдера, повторная попытка через 5 минут' },
    }
    : { url: 'https://asterion-world.example', enabled: false, hasKey: false, deviceId: 'qa-device', appVersion: '1.8.99', lastUpload: null, lastError: null };
  const server = cloud === 'live'
    ? {
      ok: true,
      status: { version: '1.8.99', versions: ['1.8.99'], now: T, disk: { freeBytes: 182.4 * 1024 ** 3, totalBytes: 240 * 1024 ** 3 }, storedBytes: 12.7 * 1024 ** 3, campaigns: 3,
        live: { campaignId: 'c1', worldAt: T - 42_000, lagMs: 42_000, tickMs: 120, cpuShare: 0.034, rss: 612 * 1024 ** 2 } },
      campaigns: [
        { id: 'c1', name: 'Империя Солнечного Ветра — кампания с очень длинным названием для проверки', createdAt: T - 30 * 86_400_000, head: null, snapshots: [],
          live: { status: 'running', baseRevision: 128_456, gameVersion: '1.8.99', startedAt: T - 86_400_000, worldAt: T - 42_000, reportedAt: T - 60_000, lagMs: 42_000,
            recovery: { stalledAt: T - 7_200_000, stalledWorldAt: T - 7_200_000, restarts: 1 } } },
      ],
    }
    : { ok: false, code: 'unreachable', error: 'сервер не отвечает' };
  await win.webContents.executeJavaScript(`(() => {
    const never = () => new Promise(() => {});
    let settings = ${JSON.stringify(settings)};
    let display = { mode: 'windowed', width: 1600, height: 900 };
    window.asterionDesktop = {
      getDisplayState: async () => display,
      setDisplay: async (request) => { display = request.mode === 'fullscreen' ? { mode: 'fullscreen', width: 2560, height: 1440 } : { mode: 'windowed', width: Number(request.preset.split('x')[0]), height: Number(request.preset.split('x')[1]) }; return display; },
      onDisplayState: () => () => {},
      botJournal: { append: () => {}, read: async () => '', path: async () => '' },
      ${cloud ? `cloud: {
        get: async () => settings,
        set: async (next) => { settings = { ...settings, ...('enabled' in next ? { enabled: next.enabled } : {}), url: next.url ?? settings.url }; return settings; },
        server: async () => (${JSON.stringify(server)}),
        campaign: never, record: never, upload: never, uploadOnExit: () => undefined, wait: never, claim: never, download: never,
        release: never, requestUpdate: never, heartbeat: never, markSynced: never, preferLocal: never,
      },` : ''}
    };
  })()`);
}

async function openSettings(win, section) {
  const open = await win.webContents.executeJavaScript(`Boolean(document.querySelector('[data-qa-utility-screen="settings"]'))`);
  if (!open) {
    await win.webContents.executeJavaScript(`document.querySelector('[data-qa-pause-open]').click()`);
    await waitFor(win, `document.querySelector('[data-qa-pause="settings"]')`);
    await win.webContents.executeJavaScript(`document.querySelector('[data-qa-pause="settings"]').click()`);
    await waitFor(win, `document.querySelector('[data-qa-utility-screen="settings"] ${ROOT_SELECTOR}') && !document.querySelector('[data-qa-pause-menu]')`);
  }
  const clicked = await win.webContents.executeJavaScript(`(() => {
    const button = document.querySelector('[data-qa-settings-section="${section}"]');
    if (!button) return false;
    button.click();
    return true;
  })()`);
  if (!clicked) throw new Error(`Settings section not found: ${section}`);
  await settle(win, 420);
  await win.webContents.executeJavaScript('window.scrollTo(0, 0)');
  await settle(win, 120);
}

/** Text that is cut off (an ellipsis is allowed). */
function clippedText(win) {
  return win.webContents.executeJavaScript(`(() => {
    const out = [];
    document.querySelectorAll('${ROOT_SELECTOR}').forEach((root) => root.querySelectorAll('strong, small, em, b, span, h1, h2, h3, h4, p, time, dt, dd, button, label, output, kbd').forEach((node) => {
      if (!node.getClientRects().length || !node.textContent.trim() || node.children.length) return;
      const style = getComputedStyle(node);
      const cutX = node.scrollWidth > node.clientWidth + 1 && style.overflow !== 'visible';
      const cutY = node.scrollHeight > node.clientHeight + 2 && style.overflowY !== 'visible' && style.overflowY !== 'auto';
      if ((cutX && style.textOverflow !== 'ellipsis') || cutY) out.push(node.textContent.trim().slice(0, 60));
    }));
    return out;
  })()`);
}

async function layout(win) {
  return win.webContents.executeJavaScript(`(() => {
    const view = document.querySelector('${ROOT_SELECTOR}')?.getBoundingClientRect();
    return {
      present: Boolean(view),
      horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 2,
      nativeTitles: Array.from(document.querySelectorAll('${ROOT_SELECTOR} [title]')).map((node) => node.getAttribute('title').slice(0, 60)),
      visibleSelects: Array.from(document.querySelectorAll('${ROOT_SELECTOR} select')).filter((node) => !node.closest('.game-select')).length,
      keyShown: /[A-Za-z0-9]{24,}/.test(document.querySelector('[data-qa-cloud-key]')?.value || ''),
      pageHeight: document.documentElement.scrollHeight,
    };
  })()`);
}

async function runViewport(win, directory, label) {
  const metrics = { failures: [], shots: {} };
  const fail = (message, detail) => {
    metrics.failures.push(`${message}: ${JSON.stringify(detail)}`);
    if (CHECKS) throw new Error(`${label} ${message}: ${JSON.stringify(detail)}`);
  };
  const shot = async (name, { bottom = false } = {}) => {
    if (bottom) {
      await win.webContents.executeJavaScript('window.scrollTo(0, document.documentElement.scrollHeight)');
      await settle(win, 200);
    }
    const clipped = await clippedText(win);
    const box = await layout(win);
    metrics.shots[name] = { clipped, ...box };
    if (!box.present) fail(`${name}: settings screen is missing`, box);
    if (clipped.length) fail(`${name}: text is cut off`, clipped);
    if (box.horizontalOverflow) fail(`${name}: horizontal scroll`, box);
    if (box.nativeTitles.length) fail(`${name}: native title tooltips remain`, box.nativeTitles);
    if (box.visibleSelects) fail(`${name}: native select remains`, box.visibleSelects);
    if (box.keyShown) throw new Error(`${name}: a key is visible`);
    await capture(win, directory, name);
    if (bottom) {
      await win.webContents.executeJavaScript('window.scrollTo(0, 0)');
      await settle(win, 120);
    }
  };
  const click = async (selector) => {
    const ok = await win.webContents.executeJavaScript(`(() => { const node = document.querySelector(${JSON.stringify(selector)}); if (!node) return false; node.click(); return true; })()`);
    await settle(win, 260);
    return ok;
  };

  // 1. Defaults, in a browser-like shell (no Windows app): what most players see first.
  await prepare(win);
  await openSettings(win, 'sound');
  await shot('01-sound-default');
  await click('[data-qa-sound-mute]');
  await shot('02-sound-muted');
  await click('[data-qa-sound-mute]');
  await openSettings(win, 'interface');
  await shot('03-text-default');
  await openSettings(win, 'screen');
  await shot('04-screen-no-app');
  await openSettings(win, 'cloud');
  await shot('05-cloud-no-app');
  await openSettings(win, 'journal');
  await shot('06-journals-no-app');

  // 2. The Windows app: window mode, the frame counter on, the cloud world running with long values.
  await prepare(win, { frameMeter: true });
  await installDesktop(win, 'live');
  await openSettings(win, 'screen');
  await shot('07-screen-app-meter-on');
  if (await click('[data-qa-settings-window-size] .game-select__trigger')) {
    await shot('08-screen-window-size-open');
    await win.webContents.executeJavaScript(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
    await click('[data-qa-settings-window-size] .game-select__trigger');
    await settle(win, 200);
  }
  await openSettings(win, 'cloud');
  await waitFor(win, `/1\\.8\\.99/.test(document.querySelector('[data-qa-cloud-status]')?.textContent || '')`, 8000).catch(() => {});
  await settle(win, 200);
  await shot('09-cloud-live-long-values');
  await shot('10-cloud-live-long-values-bottom', { bottom: true });
  await openSettings(win, 'journal');
  await shot('11-journals-app');

  // 3. The cloud world switched off and the server unreachable.
  await prepare(win);
  await installDesktop(win, 'off');
  await openSettings(win, 'cloud');
  await shot('12-cloud-off');

  // 4. Worst case: every text size at 180 %.
  await prepare(win, { text: 180, muted: true, frameMeter: true });
  await installDesktop(win, 'live');
  await openSettings(win, 'interface');
  await shot('13-text-180-top');
  await shot('14-text-180-bottom', { bottom: true });
  await openSettings(win, 'sound');
  await shot('15-sound-muted-text-180');
  await openSettings(win, 'screen');
  await shot('16-screen-text-180');
  await openSettings(win, 'cloud');
  await waitFor(win, `/1\\.8\\.99/.test(document.querySelector('[data-qa-cloud-status]')?.textContent || '')`, 8000).catch(() => {});
  await settle(win, 200);
  await shot('17-cloud-text-180', { bottom: true });

  // 5. Every text size at the minimum 80 %, and the reset (new screen: asks first).
  await prepare(win, { text: 80 });
  await openSettings(win, 'interface');
  await shot('18-text-80');
  if (await click('[data-qa-settings-reset]')) {
    await shot('19-reset-confirm');
    if (await click('[data-qa-settings-reset-confirm]')) {
      const after = await win.webContents.executeJavaScript(`getComputedStyle(document.documentElement).getPropertyValue('--text-scale-body').trim()`);
      metrics.resetTextScale = after;
      if (after !== '1') fail('Reset did not bring text back to 100 %', after);
      await shot('20-after-reset');
    }
  }
  return metrics;
}

app.whenReady().then(async () => {
  let win;
  try {
    fs.mkdirSync(OUTPUT, { recursive: true });
    win = new BrowserWindow({
      width: 1280,
      height: 720,
      show: false,
      backgroundColor: '#02050a',
      webPreferences: { offscreen: true, contextIsolation: true, nodeIntegration: false, sandbox: true, partition: 'qa-settings-screens' },
    });
    await win.loadFile(path.join(ROOT, 'dist', 'index.html'), { search: '?mode=test' });
    await waitFor(win, `document.querySelector('[data-qa-navigation="primary"]') && localStorage.getItem(${JSON.stringify(SAVE_KEY)})`, 30000);
    win.webContents.debugger.attach('1.3');
    const all = {};
    for (const [width, height] of VIEWPORTS) {
      const label = `${width}x${height}`;
      const directory = path.join(OUTPUT, label);
      fs.mkdirSync(directory, { recursive: true });
      await win.webContents.debugger.sendCommand('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false, screenWidth: width, screenHeight: height });
      await settle(win);
      all[label] = await runViewport(win, directory, label);
    }
    fs.writeFileSync(path.join(OUTPUT, 'settings-screens-metrics.json'), JSON.stringify(all, null, 2));
    console.log(JSON.stringify(all, null, 2));
    win.webContents.debugger.detach();
    win.destroy();
    app.exit(0);
  } catch (error) {
    console.error(error);
    try { if (win?.webContents.debugger.isAttached()) win.webContents.debugger.detach(); } catch {}
    win?.destroy();
    app.exit(1);
  }
});
