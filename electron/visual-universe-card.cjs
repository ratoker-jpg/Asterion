// Universe object card and «Обломки поблизости» redo (11.11.2026): worst-case screenshots
// at 1280×720 and 2560×1080.
// Data comes from the Test Mode route `#universe-card-<scenario>`
// (src/ui/universe/object-card-qa-fixture.ts): every object is seeded with a frozen clock,
// nothing is searched in the live world. States: a free position (empty and with
// 987 654 321 000 debris), an uninhabited planet, an asteroid with and without debris,
// a pirate base (new, scouted with seconds left, no probes and a failed recon), a unique
// object (free with a 66-character name, occupied, occupied and scouted with a long owner
// name), an anomaly (own fleet mining, out of range), the debris list (3 fields, 22 fields
// with 12-digit amounts and a long planet name, none) and the map's system picker.
// Layout contracts (ASTERION_QA_CHECKS=0 records them without failing, used for the
// «before» run on main): no text cut off without an ellipsis, no native title tooltips
// in the card or on the map, the window fits the screen, no horizontal scroll.
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');
const { waitForCommands } = require('./qa-save-edit.cjs');

app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-gpu');
app.on('window-all-closed', () => {});

const ROOT = path.join(__dirname, '..');
const OUTPUT = process.env.ASTERION_QA_OUTPUT || path.join(ROOT, 'visual-qa', 'screens-universe-card', 'run');
const CHECKS = process.env.ASTERION_QA_CHECKS !== '0';
const SHOTS = process.env.ASTERION_SKIP_SCREENSHOTS !== '1';
const SAVE_KEY = 'asterion.vertical-slice.test.v1';
const VIEWPORTS = [[1280, 720], [2560, 1080]];
const DIALOG = '[data-qa-universe-inspector], [data-qa-debris-finder]';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const SHOTS_LIST = [
  ['01-empty', 'empty'],
  ['02-empty-huge-debris', 'empty-huge-debris'],
  ['03-uninhabited', 'uninhabited'],
  ['04-asteroid-debris', 'asteroid-debris'],
  ['05-asteroid-no-debris', 'asteroid'],
  ['06-pirate-new', 'pirate-new'],
  ['07-pirate-scouted-seconds-left', 'pirate-scouted'],
  ['08-pirate-no-probes', 'pirate-no-probes'],
  ['09-unique-free-long-name', 'unique-free'],
  ['10-unique-occupied', 'unique-occupied'],
  ['11-unique-occupied-scouted', 'unique-occupied-scouted'],
  ['12-anomaly-own-fleet', 'anomaly-self'],
  ['13-anomaly-out-of-range', 'anomaly-out'],
  ['14-debris-few', 'debris-few'],
  ['15-debris-many-top', 'debris-many'],
  ['16-debris-many-end', 'debris-many', 'end'],
  ['17-debris-empty', 'debris-empty'],
];

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
  await waitFor(win, `Array.from(document.querySelectorAll('${DIALOG.replace(/'/g, "\\'")}')).every((root) => Array.from(root.querySelectorAll('img')).every((img) => img.complete))`, 15000).catch(() => {});
  // Finish entrances; infinite loops (the floating art) stay where they are.
  await win.webContents.executeJavaScript(`document.getAnimations().forEach((animation) => {
    const timing = animation.effect?.getComputedTiming?.();
    if (timing && Number.isFinite(timing.endTime)) animation.currentTime = timing.endTime;
  })`);
  await settle(win, 120);
  const result = await win.webContents.debugger.sendCommand('Page.captureScreenshot', { format: 'jpeg', quality: 80, fromSurface: true, captureBeyondViewport: false });
  fs.writeFileSync(path.join(directory, `${name}.jpg`), Buffer.from(result.data, 'base64'));
}

async function reload(win) {
  const loaded = new Promise((resolve) => win.webContents.once('did-finish-load', resolve));
  win.webContents.reload();
  await loaded;
  await waitFor(win, `document.querySelector('[data-qa-navigation="primary"]')`);
  await waitForCommands(win);
  await win.webContents.executeJavaScript('document.fonts?.ready');
  await settle(win);
}

async function openUniverse(win) {
  await win.webContents.executeJavaScript(`document.querySelector('[data-qa-navigation="primary"] [data-qa-route="universe"]')?.click()`);
  await waitFor(win, `document.querySelector('[data-qa-universe]')`);
  await settle(win, 420);
}

async function scenario(win, name) {
  await win.webContents.executeJavaScript(`history.replaceState(null, '', ${JSON.stringify(name ? `#universe-card-${name}` : '#')})`);
  await reload(win);
  await openUniverse(win);
  if (!name) return;
  await waitFor(win, `document.querySelector(${JSON.stringify(DIALOG)})`);
  // Flight times arrive a frame after the window opens (the old card has none).
  await waitFor(win, `!document.querySelector('.oc-eta.is-pending') && ![...document.querySelectorAll('[data-qa-debris-eta]')].some((node) => node.textContent.includes('··'))`, 8000).catch(() => {});
  await settle(win, 380);
}

/** Text that is cut off (an ellipsis is allowed). */
function clippedText(win) {
  return win.webContents.executeJavaScript(`(() => {
    const out = [];
    document.querySelectorAll(${JSON.stringify(DIALOG)}).forEach((root) => root.querySelectorAll('strong, small, em, b, span, h1, h2, h3, h4, p, time, dt, dd, button, label, li').forEach((node) => {
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
    const dialog = document.querySelector(${JSON.stringify(DIALOG)});
    const box = dialog?.getBoundingClientRect();
    const inside = (rect) => !rect || (rect.top >= -1 && rect.left >= -1 && rect.bottom <= innerHeight + 1 && rect.right <= innerWidth + 1);
    return {
      fits: inside(box),
      size: box ? [Math.round(box.width), Math.round(box.height)] : null,
      horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 2,
      nativeTitles: Array.from(document.querySelectorAll('[data-qa-universe] [title], [data-qa-universe-inspector] [title], [data-qa-debris-finder] [title]')).map((node) => node.getAttribute('title').slice(0, 60)),
      nativeSelects: document.querySelectorAll('[data-qa-universe] select:not(.game-select__native)').length,
      actions: Array.from(document.querySelectorAll('[data-qa-universe-special-action]')).map((node) => node.getAttribute('data-qa-universe-special-action') + (node.disabled ? ':off' : '')),
    };
  })()`);
}

async function runViewport(win, directory, label) {
  const metrics = { failures: [], shots: {} };
  const fail = (message, detail) => {
    metrics.failures.push(`${message}: ${JSON.stringify(detail)}`);
    if (CHECKS) throw new Error(`${label} ${message}: ${JSON.stringify(detail)}`);
  };
  const shot = async (name) => {
    const clipped = await clippedText(win);
    const box = await layout(win);
    metrics.shots[name] = { clipped, ...box };
    if (clipped.length) fail(`${name}: text is cut off`, clipped);
    if (!box.fits || box.horizontalOverflow) fail(`${name}: window does not fit`, box);
    if (box.nativeTitles.length) fail(`${name}: native title tooltips remain`, box.nativeTitles);
    if (box.nativeSelects) fail(`${name}: native selects remain on the map`, box.nativeSelects);
    await capture(win, directory, name);
  };

  let previous = null;
  for (const [name, fixture, where] of SHOTS_LIST) {
    if (fixture !== previous) await scenario(win, fixture);
    previous = fixture;
    if (where === 'end') {
      await win.webContents.executeJavaScript(`(() => { const list = document.querySelector('.universe-debris-finder__list'); if (list) list.scrollTop = list.scrollHeight; })()`);
      await settle(win, 240);
    }
    await shot(name);
  }

  // The map itself: the system picker (the game's dropdown instead of a native select).
  await scenario(win, null);
  const picker = await win.webContents.executeJavaScript(`(() => {
    const trigger = document.querySelector('.universe-jump [data-qa-game-select-trigger]');
    if (!trigger) return false;
    trigger.click();
    return true;
  })()`);
  if (picker) {
    await waitFor(win, `document.querySelector('[data-qa-game-select-list]')`, 5000).catch(() => {});
    await settle(win, 300);
  }
  metrics.shots['18-map-system-picker'] = await layout(win);
  if (metrics.shots['18-map-system-picker'].nativeTitles.length) fail('map: native title tooltips remain', metrics.shots['18-map-system-picker'].nativeTitles);
  await capture(win, directory, '18-map-system-picker');
  await win.webContents.executeJavaScript(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
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
      webPreferences: { offscreen: true, contextIsolation: true, nodeIntegration: false, sandbox: true, partition: 'qa-universe-card' },
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
    fs.writeFileSync(path.join(OUTPUT, 'universe-card-metrics.json'), JSON.stringify(all, null, 2));
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
