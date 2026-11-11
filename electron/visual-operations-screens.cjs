// «Операции» redo (11.11.2026): worst-case screenshots of the operations screen at
// 1280×720 and 2560×1080.
// Data comes from the Test Mode fixture route `#operations-variant-a-<scenario>`
// (src/operations-variant-a-qa-fixture.ts): every tab and kind (pirate base, unique
// object, anomaly), a long list (14 pirate bases and 6 objects) with long names and
// seconds-left timers, an active pirate base without probes, an expedition that mines
// hundreds of millions, completed operations with 12-digit numbers and a world
// without any operation.
// Layout contracts (ASTERION_QA_CHECKS=0 records them without failing, used for the
// «before» run on main): no text cut off without an ellipsis, no native title
// tooltips, the screen fits the window, no horizontal scroll.
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-gpu');
app.on('window-all-closed', () => {});

const ROOT = path.join(__dirname, '..');
const OUTPUT = process.env.ASTERION_QA_OUTPUT || path.join(ROOT, 'visual-qa', 'screens-operations', 'run');
const CHECKS = process.env.ASTERION_QA_CHECKS !== '0';
const SHOTS = process.env.ASTERION_SKIP_SCREENSHOTS !== '1';
const SAVE_KEY = 'asterion.vertical-slice.test.v1';
const VIEWPORTS = [[1280, 720], [2560, 1080]];
const ROOT_SELECTOR = '.operations-shell-v2';
const TAB_LABELS = { available: 'ДОСТУПНЫЕ', active: 'АКТИВНЫЕ', completed: 'ЗАВЕРШЁННЫЕ' };
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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

async function reload(win) {
  const loaded = new Promise((resolve) => win.webContents.once('did-finish-load', resolve));
  win.webContents.reload();
  await loaded;
  await waitFor(win, `document.querySelector('[data-qa-navigation="primary"]')`);
  await win.webContents.executeJavaScript('document.fonts?.ready');
  await settle(win);
}

async function openOperations(win) {
  await win.webContents.executeJavaScript(`document.querySelector('[data-qa-navigation="primary"] [data-qa-route="operations"]')?.click()`);
  await waitFor(win, `document.querySelector('${ROOT_SELECTOR}')`);
  await settle(win, 420);
}

/** Works on the old screen (tab labels) and on the new one (data-qa hooks). */
async function openTab(win, tab) {
  const clicked = await win.webContents.executeJavaScript(`(() => {
    const hook = document.querySelector('[data-qa-operations-tab="${tab}"]');
    const old = [...document.querySelectorAll('.operations-tabs-v2 [role="tab"]')].find((node) => node.textContent.includes(${JSON.stringify(TAB_LABELS[tab])}));
    const button = hook || old;
    if (!button) return false;
    button.click();
    return true;
  })()`);
  if (!clicked) throw new Error(`Operations tab not found: ${tab}`);
  await settle(win, 380);
}

async function cardCount(win, kind) {
  return win.webContents.executeJavaScript(`document.querySelectorAll('.operation-feed-card-v2${kind ? `[data-contact-kind="${kind}"]` : ''}').length`);
}

/** Selects the n-th card of a kind (or of the list) and scrolls it into view. */
async function selectCard(win, kind, index = 0) {
  const ok = await win.webContents.executeJavaScript(`(() => {
    const cards = [...document.querySelectorAll('.operation-feed-card-v2${kind ? `[data-contact-kind="${kind}"]` : ''}')];
    const card = cards.at(${index});
    if (!card) return false;
    card.scrollIntoView({ block: 'center' });
    card.click();
    return true;
  })()`);
  if (!ok) throw new Error(`Operation card not found: ${kind || 'any'} #${index}`);
  await settle(win, 420);
}

/** Text that is cut off (an ellipsis is allowed). */
function clippedText(win) {
  return win.webContents.executeJavaScript(`(() => {
    const out = [];
    document.querySelectorAll('${ROOT_SELECTOR}').forEach((root) => root.querySelectorAll('strong, small, em, b, span, h1, h2, h3, h4, p, time, dt, dd, button, label').forEach((node) => {
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
    const inside = (box) => !box || (box.top >= -1 && box.left >= -1 && box.bottom <= innerHeight + 1 && box.right <= innerWidth + 1);
    return {
      fits: Boolean(view) && inside(view),
      horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 2,
      nativeTitles: Array.from(document.querySelectorAll('${ROOT_SELECTOR} [title]')).map((node) => node.getAttribute('title').slice(0, 60)),
      cards: document.querySelectorAll('.operation-feed-card-v2').length,
    };
  })()`);
}

// The fixture builds its pirate bases from one real contact. Test Mode does not
// promise one in the home system at the wall-clock time of the run, so move the
// home planet through the systems until a base is in sight (the same approach as the
// earlier Variant A capture tool).
async function findPirateSystem(win) {
  for (let system = 1; system <= 40; system += 1) {
    await win.webContents.executeJavaScript(`(() => {
      const save = JSON.parse(localStorage.getItem(${JSON.stringify(SAVE_KEY)}) || '{}');
      const planet = save.planets?.['helion-01'];
      if (!planet) throw new Error('Test Mode homeworld was not persisted');
      planet.universeGalaxy = 1;
      planet.universeSystem = ${system};
      localStorage.setItem(${JSON.stringify(SAVE_KEY)}, JSON.stringify(save));
    })()`);
    await reload(win);
    await openOperations(win);
    if (await cardCount(win, 'pirate') > 0) return system;
  }
  throw new Error('No pirate base in sight in systems 1–40 of the Test Mode galaxy.');
}

async function scenario(win, name) {
  await win.webContents.executeJavaScript(`history.replaceState(null, '', '#operations-variant-a-${name}')`);
  await reload(win);
  await openOperations(win);
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
    if (!box.fits || box.horizontalOverflow) fail(`${name}: screen does not fit`, box);
    if (box.nativeTitles.length) fail(`${name}: native title tooltips remain`, box.nativeTitles);
    await capture(win, directory, name);
  };

  metrics.pirateSystem = await findPirateSystem(win);

  // 1. Available: a pirate base, an unscouted unique object, an anomaly.
  await scenario(win, 'available');
  await openTab(win, 'available');
  await selectCard(win, 'pirate');
  await shot('01-available-pirate');
  await selectCard(win, 'unique');
  await shot('02-available-object-unscouted');
  await selectCard(win, 'anomaly');
  await shot('03-available-anomaly');

  // 2. A long list: 14 bases, 6 objects, long names, seconds left.
  await scenario(win, 'many');
  await openTab(win, 'available');
  metrics.manyCards = await cardCount(win);
  if (metrics.manyCards !== 20) fail('Long list is not 20 operations', metrics.manyCards);
  await selectCard(win, null, 0);
  await shot('04-many-top');
  await selectCard(win, null, -1);
  await shot('05-many-end-long-name');
  await selectCard(win, 'pirate', 13);
  await shot('06-many-pirate-seconds-left');

  // 3. In progress: a scouted base, a base without probes, own fleet mining, an object taken by a rival.
  await scenario(win, 'active');
  await openTab(win, 'active');
  await selectCard(win, 'pirate', 0);
  await shot('07-active-pirate-scouted');
  await selectCard(win, 'pirate', 1);
  await shot('08-active-pirate-no-probes');
  await selectCard(win, 'unique');
  await shot('09-active-mining-huge-cargo');
  await selectCard(win, 'anomaly');
  await shot('10-active-object-taken');

  // 4. Results: a victory with the reward breakdown, a delivered expedition, a lost one.
  await scenario(win, 'completed');
  await openTab(win, 'completed');
  await selectCard(win, 'pirate');
  await shot('11-completed-pirate-victory');
  await selectCard(win, 'unique');
  await shot('12-completed-expedition-delivered');
  await selectCard(win, 'anomaly');
  await shot('13-completed-expedition-lost');

  // 5. Nothing at all.
  await scenario(win, 'empty');
  await openTab(win, 'available');
  if (await cardCount(win)) fail('Empty world still lists operations', await cardCount(win));
  await shot('14-empty-available');
  await openTab(win, 'completed');
  await shot('15-empty-completed');
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
      webPreferences: { offscreen: true, contextIsolation: true, nodeIntegration: false, sandbox: true, partition: 'qa-operations-screens' },
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
    fs.writeFileSync(path.join(OUTPUT, 'operations-screens-metrics.json'), JSON.stringify(all, null, 2));
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
