// «Империя» console QA: 7 planets with the worst cases (a long name, an empty
// planet, full storages, every build queue empty) at 1920×1080 and 1280×720.
// Checks the layout contract (all lanes on screen, no horizontal scroll, no
// overlapping cells), queues a building from the console, gathers resources
// from several planets in one send, and checks toasts never cover a control.
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-gpu');
app.on('window-all-closed', () => {});

const ROOT = path.join(__dirname, '..');
const OUTPUT = process.env.ASTERION_QA_OUTPUT || path.join(ROOT, 'visual-qa', 'empire-management');
const SKIP_SCREENSHOTS = process.env.ASTERION_SKIP_SCREENSHOTS === '1';
const SAVE_KEY = 'asterion.vertical-slice.test.v1';
const VIEWPORTS = [[1920, 1080], [1280, 720]];
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const failures = [];
const fail = (message, detail) => { failures.push({ message, detail }); console.error(`[empire-qa] ${message}`, JSON.stringify(detail)); };

const COLONIES = [
  ['planet-1-1-6', 'Кассия', 1, 6, { metal: 2000000, minerals: 1500000, gas: 800000 }, { transporter: 12 }],
  ['planet-1-2-4', 'Ферон Великая Северная Колония Альфа', 2, 4, { metal: 0, minerals: 0, gas: 0 }, {}],
  ['planet-1-3-9', 'Тавр', 3, 9, { metal: 2000900, minerals: 1500900, gas: 800600 }, { recycler: 5, 'mega-transporter': 3 }],
  ['planet-1-5-2', 'Нордин', 5, 2, { metal: 1e15, minerals: 1e15, gas: 1e15 }, { cruiser: 40 }],
  ['planet-1-17-11', 'Колония 17-11', 17, 11, { metal: 637077, minerals: 521440, gas: 166072 }, { transporter: 4 }],
  ['planet-1-17-5', 'Колония 17-5', 17, 5, { metal: 271304, minerals: 627596, gas: 486989 }, {}],
];

async function waitFor(win, expression, timeoutMs = 8000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await win.webContents.executeJavaScript(`Boolean(${expression})`)) return;
    await sleep(50);
  }
  throw new Error(`Timed out waiting for: ${expression}`);
}

async function settle(win, ms = 160) {
  await win.webContents.executeJavaScript('new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
  await sleep(ms);
}

async function capture(win, directory, name) {
  if (SKIP_SCREENSHOTS) return;
  await win.webContents.executeJavaScript(`document.getAnimations().forEach((animation) => {
    const timing = animation.effect?.getComputedTiming?.();
    if (timing && Number.isFinite(timing.endTime)) animation.currentTime = timing.endTime;
  })`);
  await settle(win, 60);
  const result = await win.webContents.debugger.sendCommand('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: false });
  fs.writeFileSync(path.join(directory, `${name}.png`), Buffer.from(result.data, 'base64'));
}

async function click(win, selector) {
  const clicked = await win.webContents.executeJavaScript(`(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    if (!element || element.disabled) return false;
    element.click();
    return true;
  })()`);
  if (!clicked) throw new Error(`Element not found/enabled: ${selector}`);
  await settle(win);
}

/** Seven planets; writes the save and reloads in one renderer turn so no autosave runs in between. */
async function seed(win) {
  const loaded = new Promise((resolve) => win.webContents.once('did-finish-load', resolve));
  const ok = await win.webContents.executeJavaScript(`(() => {
    const save = JSON.parse(localStorage.getItem(${JSON.stringify(SAVE_KEY)}) || 'null');
    const home = save?.planets?.['helion-01'];
    if (!home) return false;
    const now = Date.now();
    const ships = (list) => Object.fromEntries(Object.keys(home.fleet.ships).map((id) => [id, list[id] || 0]));
    home.fleet.ships = ships({ 'spy-probe': 5, transporter: 30, 'mega-transporter': 5, recycler: 15, cruiser: 60, battleship: 20, scout: 40 });
    save.currentPlanetId = 'helion-01';
    save.metal = 450100000; save.minerals = 300100000; save.gas = 189382930;
    save.queues = { 'helion-01': [] };
    save.science.queue = [];
    for (const [id, name, system, position, resources, fleet] of ${JSON.stringify(COLONIES)}) {
      const planet = JSON.parse(JSON.stringify(home));
      Object.assign(planet, { name, universeGalaxy: 1, universeSystem: system, universePosition: position, skin: 'colonized', resources });
      planet.fleet.ships = ships(fleet);
      save.planets[id] = planet;
      save.queues[id] = [];
      if (save.resourceClock?.byPlanet) save.resourceClock.byPlanet[id] = { ...(save.resourceClock.byPlanet['helion-01'] || {}), lastReconciledAt: now };
    }
    save.flights = { records: [], requestIndex: {} };
    localStorage.setItem(${JSON.stringify(SAVE_KEY)}, JSON.stringify(save));
    localStorage.setItem('asterion.test-time-scale.v1', '1');
    setTimeout(() => window.location.reload(), 0);
    return true;
  })()`);
  if (!ok) throw new Error('Could not seed the empire fixture');
  await loaded;
  await waitFor(win, `document.querySelector('[data-qa-planet-section="empire"]')`, 20000);
  await win.webContents.executeJavaScript('document.fonts?.ready');
  await settle(win, 300);
}

function coveredControls(win) {
  return win.webContents.executeJavaScript(`(() => {
    const toasts = Array.from(document.querySelectorAll('[data-qa-runtime-toast]')).map((toast) => toast.getBoundingClientRect());
    return Array.from(document.querySelectorAll('button, a, input, select, textarea, [role=tab], [role=button]'))
      .filter((node) => !node.closest('.runtime-toast-stack'))
      .filter((node) => {
        const box = node.getBoundingClientRect();
        const style = getComputedStyle(node);
        return box.width > 2 && box.height > 2 && style.visibility !== 'hidden' && style.opacity !== '0'
          && toasts.some((toast) => box.left < toast.right && toast.left < box.right && box.top < toast.bottom && toast.top < box.bottom);
      })
      .map((node) => (node.getAttribute('aria-label') || node.textContent || '').trim().slice(0, 40));
  })()`);
}

async function runViewport(win, directory) {
  const metrics = {};
  await seed(win);
  await click(win, '[data-qa-planet-section="empire"]');
  await waitFor(win, `document.querySelectorAll('[data-qa-empire-row]').length === 7`);
  await settle(win, 500);

  metrics.layout = await win.webContents.executeJavaScript(`(() => {
    const lanes = Array.from(document.querySelectorAll('[data-qa-empire-row]'));
    const empire = document.querySelector('[data-qa-empire]');
    const overlaps = [];
    for (const lane of lanes) {
      const cells = Array.from(lane.children).map((cell) => cell.getBoundingClientRect());
      for (let i = 1; i < cells.length; i += 1) if (cells[i].left < cells[i - 1].right - 1) overlaps.push(lane.dataset.qaEmpireRow + ':' + i);
      const box = lane.getBoundingClientRect();
      if (cells.some((cell) => cell.right > box.right + 1)) overlaps.push(lane.dataset.qaEmpireRow + ':out');
    }
    return {
      lanes: lanes.length,
      lowestLane: Math.round(Math.max(...lanes.map((lane) => lane.getBoundingClientRect().bottom))),
      viewport: [innerWidth, innerHeight],
      pageScrollX: document.documentElement.scrollWidth - innerWidth,
      empireScrollX: empire.scrollWidth - empire.clientWidth,
      overlaps,
      idle: Number(document.querySelector('[data-qa-empire-idle]').dataset.qaEmpireIdle),
      full: document.querySelectorAll('[data-qa-empire-row="planet-1-5-2"] [data-qa-empire-fill="full"]').length,
      longNameClipped: (() => { const b = document.querySelector('[data-qa-empire-row="planet-1-2-4"] .empire-lane__planet b'); return b.scrollWidth > b.clientWidth; })(),
    };
  })()`);
  const layout = metrics.layout;
  if (layout.lanes !== 7) fail('Not all 7 planets are listed', layout);
  if (layout.lowestLane > layout.viewport[1]) fail('A planet lane is below the screen', layout);
  if (layout.pageScrollX > 0 || layout.empireScrollX > 0) fail('Horizontal scroll on the empire screen', layout);
  if (layout.overlaps.length) fail('Lane cells overlap', layout.overlaps);
  if (layout.idle !== 7) fail('Idle markers: expected 7 planets with an empty queue', layout);
  if (layout.full !== 3) fail('Full storages are not marked on Нордин', layout);
  await capture(win, directory, '01-empire-7-planets');

  // Queue a building on another planet without switching to it.
  await click(win, '[data-qa-empire-add="planet-1-1-6"]');
  await waitFor(win, `document.querySelector('[data-qa-empire-picker="planet-1-1-6"] [data-qa-empire-build]:not([aria-disabled="true"])')`);
  metrics.pickerOnScreen = await win.webContents.executeJavaScript(`(() => { const b = document.querySelector('[data-qa-empire-picker]').getBoundingClientRect(); return b.left >= 0 && b.top >= 0 && b.right <= innerWidth && b.bottom <= innerHeight; })()`);
  if (!metrics.pickerOnScreen) fail('Build picker leaves the screen', metrics.pickerOnScreen);
  await capture(win, directory, '02-build-picker');
  await click(win, '[data-qa-empire-picker] [data-qa-empire-build]:not([aria-disabled="true"])');
  await settle(win, 300);
  metrics.queued = await win.webContents.executeJavaScript(`({
    queue: Number(document.querySelector('[data-qa-empire-row="planet-1-1-6"] [data-qa-empire-queue]').dataset.qaEmpireQueue),
    current: JSON.parse(localStorage.getItem(${JSON.stringify(SAVE_KEY)}) || '{}').currentPlanetId,
  })`);
  if (metrics.queued.queue !== 1) fail('Building from the console did not enter the planet queue', metrics.queued);
  await click(win, '[data-qa-empire-picker] header button');
  metrics.buildToastCovers = await coveredControls(win);
  if (metrics.buildToastCovers.length) fail('Toast covers controls on the empire screen', metrics.buildToastCovers);
  await capture(win, directory, '03-queued-from-console');

  // «Сюда» on the empty planet: resources from the other planets, one send.
  await click(win, '[data-qa-empire-here="planet-1-2-4"]');
  await waitFor(win, `document.querySelector('[data-qa-empire-drawer="transport"] [data-qa-quick-route="ok"]')`);
  metrics.drawer = await win.webContents.executeJavaScript(`(() => {
    const box = document.querySelector('[data-qa-empire-drawer]').getBoundingClientRect();
    const legs = Array.from(document.querySelectorAll('[data-qa-quick-leg][data-qa-quick-leg-checked="true"]'));
    return {
      onScreen: box.left >= 0 && box.top >= 0 && box.right <= innerWidth && box.bottom <= innerHeight,
      checked: legs.map((leg) => leg.dataset.qaQuickLeg),
      cargo: legs.map((leg) => Array.from(leg.querySelectorAll('[data-qa-quick-cargo] em')).map((em) => em.textContent).join('/')),
    };
  })()`);
  if (!metrics.drawer.onScreen) fail('Logistics drawer leaves the screen', metrics.drawer);
  if (metrics.drawer.checked.length < 2) fail('Gather did not pre-check several source planets', metrics.drawer);
  if (metrics.drawer.cargo.some((cargo) => cargo === '0/0/0')) fail('A checked source has no cargo', metrics.drawer);
  // A toast that was already up must leave the drawer's controls once it opens.
  await sleep(700);
  metrics.drawerToastCovers = await coveredControls(win);
  if (metrics.drawerToastCovers.length) fail('Toast covers drawer controls', metrics.drawerToastCovers);
  await capture(win, directory, '04-gather-resources');
  await click(win, '[data-qa-empire-drawer] [data-qa-quick-go]');
  await settle(win, 400);
  metrics.sent = await win.webContents.executeJavaScript(`({
    drawerOpen: Boolean(document.querySelector('[data-qa-empire-drawer]')),
    incoming: document.querySelector('[data-qa-empire-row="planet-1-2-4"] .empire-fleet small').textContent,
  })`);
  if (metrics.sent.drawerOpen) fail('Drawer stayed open after every leg was accepted', metrics.sent);
  if (!/летят сюда/.test(metrics.sent.incoming)) fail('Incoming transports are not shown on the target lane', metrics.sent);
  metrics.sendToastCovers = await coveredControls(win);
  if (metrics.sendToastCovers.length) fail('Toast covers controls after sending', metrics.sendToastCovers);
  await capture(win, directory, '05-sent');

  // Fleet mode of the same drawer.
  await click(win, '[data-qa-empire-gather="deployment"]');
  await waitFor(win, `document.querySelector('[data-qa-empire-drawer="deployment"] [data-qa-quick-leg]')`);
  await capture(win, directory, '06-gather-fleet');
  await win.webContents.executeJavaScript(`document.querySelector('[data-qa-empire-drawer] .quick-send__close')?.click()`);
  await settle(win);

  // «Текущая планета»: the switch does not sit on the planet title.
  await click(win, '[data-qa-planet-section="current"]');
  await waitFor(win, `document.querySelector('[data-qa-planet-orbit]')`);
  await settle(win, 300);
  metrics.switchClear = await win.webContents.executeJavaScript(`(() => {
    const a = document.querySelector('[data-qa-planet-sections]').getBoundingClientRect();
    const b = document.querySelector('.planet-orbit__name').getBoundingClientRect();
    return !(a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom);
  })()`);
  if (!metrics.switchClear) fail('Section switch covers the planet title', metrics.switchClear);
  await capture(win, directory, '07-current-planet');
  return metrics;
}

app.whenReady().then(async () => {
  let win;
  try {
    fs.mkdirSync(OUTPUT, { recursive: true });
    win = new BrowserWindow({
      width: 1000, height: 700, show: false, backgroundColor: '#02050a',
      webPreferences: { offscreen: true, contextIsolation: true, nodeIntegration: false, sandbox: true, partition: 'qa-empire-management' },
    });
    await win.loadFile(path.join(ROOT, 'dist', 'index.html'), { search: '?mode=test' });
    await waitFor(win, `document.querySelector('[data-qa-navigation="utility"]')`, 20000);
    win.webContents.debugger.attach('1.3');
    for (const [width, height] of VIEWPORTS) {
      const directory = path.join(OUTPUT, `${width}x${height}`);
      fs.mkdirSync(directory, { recursive: true });
      await win.webContents.debugger.sendCommand('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false, screenWidth: width, screenHeight: height });
      await settle(win);
      fs.writeFileSync(path.join(directory, 'empire-metrics.json'), JSON.stringify(await runViewport(win, directory), null, 2));
    }
    win.webContents.debugger.detach();
    win.destroy();
    if (failures.length) { console.error(`[empire-qa] ${failures.length} check(s) failed`); app.exit(1); return; }
    console.log('[empire-qa] all checks passed');
    app.exit(0);
  } catch (error) {
    console.error(error);
    try { if (win?.webContents.debugger.isAttached()) win.webContents.debugger.detach(); } catch {}
    win?.destroy();
    app.exit(1);
  }
});
