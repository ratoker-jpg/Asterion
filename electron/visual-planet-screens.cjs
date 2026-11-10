// Planet screens redo (10.11.2026): worst-case screenshots of «Орбита», the three
// building zones and the building dialog at 1280×720 and 2560×1080, for every race.
// Cases: 7 planets with long names, every zone full at maximum level, huge resource
// numbers, a full queue, a building that cannot be afforded (with its reason), the
// demolish confirmation and an empty new colony.
// Layout contracts (ASTERION_QA_CHECKS=0 records them without failing, used for the
// «before» run on main): nothing in the zone panels or the dialog is cut off, the
// zone plates on «Орбита» do not cover the side columns or the dock, the dialog fits
// the window and no native title tooltips are left.
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-gpu');
app.on('window-all-closed', () => {});

const ROOT = path.join(__dirname, '..');
const OUTPUT = process.env.ASTERION_QA_OUTPUT || path.join(ROOT, 'visual-qa', 'screens-planet', 'run');
const CHECKS = process.env.ASTERION_QA_CHECKS !== '0';
const SHOTS = process.env.ASTERION_SKIP_SCREENSHOTS !== '1';
const SAVE_KEY = 'asterion.vertical-slice.test.v1';
const VIEWPORTS = [[1280, 720], [2560, 1080]];
const RACES = ['aegis', 'synod', 'veyra'];
const LONG_HOME = 'Ферон Великая Северная Колония Альфа-Центавра';
const COLONIES = [
  ['planet-1-1-6', 'Кассиопея Восточный Рубеж Обороны', 1, 6],
  ['planet-1-2-4', 'Новая Надежда Первой Экспедиции', 2, 4],
  ['planet-1-3-9', 'Тавр', 3, 9],
  ['planet-1-5-2', 'Нордин Ледяной Перевал Седьмого Сектора', 5, 2],
  ['planet-1-17-11', 'Колония 17-11 Шахтёрская Глубинная', 17, 11],
  ['planet-1-17-5', 'Пустая колония без зданий и ресурсов', 17, 5],
];
const EMPTY_COLONY = 'planet-1-17-5';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(win, expression, timeoutMs = 10000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await win.webContents.executeJavaScript(`Boolean(${expression})`)) return;
    await sleep(50);
  }
  throw new Error(`Timed out waiting for: ${expression}`);
}

async function settle(win, ms = 120) {
  await win.webContents.executeJavaScript('new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
  await sleep(ms);
}

async function capture(win, directory, name) {
  if (!SHOTS) return;
  await win.webContents.executeJavaScript(`document.getAnimations().forEach((animation) => {
    const timing = animation.effect?.getComputedTiming?.();
    if (timing && Number.isFinite(timing.endTime)) animation.currentTime = timing.endTime;
  })`);
  await settle(win, 80);
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
  await settle(win, 250);
}

/** Every building at its maximum level, read from the tiles («Уровень N из MAX»). */
async function readMaxLevels(win) {
  const levels = {};
  for (const zone of ['resource', 'industry', 'military']) {
    await openZone(win, zone);
    Object.assign(levels, await win.webContents.executeJavaScript(`Object.fromEntries(Array.from(document.querySelectorAll('[data-zone-selector-role]'))
      .map((node) => [node.getAttribute('data-zone-selector-role'), Number((node.getAttribute('aria-label') || '').match(/из (\\d+)/)?.[1] || 1)]))`));
  }
  return levels;
}

/** Rewrites the save and reloads in one renderer turn, so no autosave runs in between. */
async function seed(win, options) {
  const loaded = new Promise((resolve) => win.webContents.once('did-finish-load', resolve));
  const ok = await win.webContents.executeJavaScript(`(() => {
    const options = ${JSON.stringify(options)};
    const save = JSON.parse(localStorage.getItem(${JSON.stringify(SAVE_KEY)}) || 'null');
    const home = save?.planets?.['helion-01'];
    if (!home?.buildings) return false;
    const now = Date.now();
    if (!window.__qaPristineHome) window.__qaPristineHome = JSON.stringify(home);
    const roles = Object.keys(home.buildings);
    const levels = (value) => Object.fromEntries(roles.map((role) => [role, typeof value === 'number' ? value : Math.min(value[role] ?? 0, options.max?.[role] ?? 99)]));
    home.name = ${JSON.stringify(LONG_HOME)};
    home.buildings = levels(options.buildings);
    home.energy = 999999999;
    if (save.profile) save.profile.factionId = options.race;
    if (save.worldConfig) save.worldConfig.factionId = options.race;
    save.metal = options.wallet; save.minerals = options.wallet; save.gas = options.wallet;
    if (home.resources) home.resources = { ...home.resources, metal: options.wallet, minerals: options.wallet, gas: options.wallet };
    save.queues = { 'helion-01': (options.queue || []).map((item, index) => ({
      id: 'qa-' + index, planetId: 'helion-01', assetRole: item.role, targetLevel: item.level,
      cost: { metal: 0, minerals: 0, gas: 0, energy: 0 },
      enqueuedAt: now + index, startedAt: now + (item.start ?? 0), finishAt: now + item.finish,
    })) };
    for (const [id, name, system, position] of ${JSON.stringify(COLONIES)}) {
      const planet = JSON.parse(JSON.stringify(home));
      const empty = id === ${JSON.stringify(EMPTY_COLONY)};
      Object.assign(planet, { name, universeGalaxy: 1, universeSystem: system, universePosition: position, skin: empty ? 'barren' : 'oceanic' });
      planet.buildings = levels(empty ? 0 : options.buildings);
      if (planet.resources) planet.resources = empty ? { ...planet.resources, metal: 0, minerals: 0, gas: 0 } : planet.resources;
      if (planet.fleet?.ships) planet.fleet.ships = Object.fromEntries(Object.keys(planet.fleet.ships).map((ship) => [ship, 0]));
      save.planets[id] = planet;
      save.queues[id] = [];
      if (save.resourceClock?.byPlanet) save.resourceClock.byPlanet[id] = { ...(save.resourceClock.byPlanet['helion-01'] || {}), lastReconciledAt: now };
    }
    save.currentPlanetId = options.current || 'helion-01';
    save.resourceClock = { ...(save.resourceClock || {}), lastReconciledAt: now, remainder: { metal: 0, minerals: 0, gas: 0, energy: 0 } };
    localStorage.setItem(${JSON.stringify(SAVE_KEY)}, JSON.stringify(save));
    localStorage.setItem('asterion.test-time-scale.v1', '1');
    setTimeout(() => window.location.reload(), 0);
    return true;
  })()`);
  if (!ok) throw new Error('Could not seed the planet screens fixture');
  await loaded;
  await waitFor(win, `document.querySelector('[data-qa-navigation="utility"]')`, 20000);
  await win.webContents.executeJavaScript('document.fonts?.ready');
  await settle(win, 400);
}

async function openOrbit(win) {
  await click(win, '[data-qa-route="planet"]');
  if (await win.webContents.executeJavaScript(`Boolean(document.querySelector('[data-qa-planet-section="current"]'))`)) await click(win, '[data-qa-planet-section="current"]');
  await waitFor(win, `document.querySelector('[data-qa-planet-orbit]')`);
  await settle(win, 700);
}

async function openZone(win, zone) {
  await click(win, `[data-qa-zone="${zone}"]`);
  await waitFor(win, `document.querySelector('[data-qa-zone-view][data-zone=${JSON.stringify(zone)}]')`);
  await waitFor(win, `Array.from(document.querySelectorAll('[data-qa-zone-view] img')).every((img) => img.complete)`);
  await settle(win, 400);
}

async function openDialog(win, role) {
  await click(win, `[data-zone-selector-role="${role}"]`);
  await waitFor(win, `document.querySelector('[data-qa-building-dialog="${role}"]')`);
  await settle(win, 350);
}

async function closeDialog(win) {
  await click(win, '.resource-building-dialog-close');
  await waitFor(win, `!document.querySelector('[data-qa-building-dialog]')`);
}

/** Text that is cut off (an ellipsis is allowed only where `allow` matches). */
function clippedText(win, scope) {
  return win.webContents.executeJavaScript(`(() => {
    const out = [];
    document.querySelectorAll(${JSON.stringify(scope)}).forEach((root) => root.querySelectorAll('strong, small, em, b, span, h1, h2, h3, p, time, dt, dd').forEach((node) => {
      if (!node.getClientRects().length || !node.textContent.trim() || node.children.length) return;
      const style = getComputedStyle(node);
      if (style.position === 'absolute' && style.clipPath !== 'none') return;
      const cut = node.scrollWidth > node.clientWidth + 1 && style.overflow !== 'visible';
      if (cut && style.textOverflow !== 'ellipsis') out.push(node.textContent.trim().slice(0, 60));
    }));
    return out;
  })()`);
}

function boxesOverlap(win, pairs) {
  return win.webContents.executeJavaScript(`(() => {
    const box = (selector) => Array.from(document.querySelectorAll(selector)).filter((node) => node.getClientRects().length).map((node) => node.getBoundingClientRect());
    const hit = (a, b) => a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1;
    return ${JSON.stringify(pairs)}.filter(([a, b]) => box(a).some((x) => box(b).some((y) => hit(x, y)))).map(([a, b]) => a + ' × ' + b);
  })()`);
}

async function runViewport(win, directory, max, race) {
  const metrics = { race, failures: [] };
  const fail = (message, detail) => {
    metrics.failures.push(`${message}: ${JSON.stringify(detail)}`);
    if (CHECKS) throw new Error(`${race} ${message}: ${JSON.stringify(detail)}`);
  };
  const prefix = race;

  // 1. Seven planets with long names, every zone full at maximum level, huge numbers, a full queue.
  const queued = ['metal-storage', 'research', 'hangar'];
  const almost = { ...max, ...Object.fromEntries(queued.map((role) => [role, max[role] - 1])) };
  await seed(win, { race, buildings: almost, max, wallet: 999999999999, queue: [
    { role: 'metal-storage', level: max['metal-storage'], finish: 3 * 3600_000 + 59 * 60_000 },
    { role: 'research', level: max.research, start: 4 * 3600_000, finish: 9 * 3600_000 },
    { role: 'hangar', level: max.hangar, start: 9 * 3600_000, finish: 14 * 3600_000 },
  ] });
  await openOrbit(win);
  metrics.orbitOverlap = await boxesOverlap(win, [
    ['.planet-orbit__zone', '.planet-orbit__side'], ['.planet-orbit__zone', '.planet-orbit__worlds'], ['.planet-orbit__zone', '.planet-orbit__dock'],
    ['.planet-orbit__side', '.planet-orbit__dock'], ['.planet-orbit__worlds', '.planet-orbit__dock'],
  ]);
  if (metrics.orbitOverlap.length) fail('Orbit blocks overlap', metrics.orbitOverlap);
  metrics.orbitClipped = await clippedText(win, '.planet-orbit__dock, .planet-orbit__side');
  if (metrics.orbitClipped.length) fail('Orbit text is cut off', metrics.orbitClipped);
  metrics.nativeTitles = await win.webContents.executeJavaScript(`Array.from(document.querySelectorAll('.planet-orbit [title], .resource-zone-view [title]')).map((node) => node.getAttribute('title'))`);
  if (metrics.nativeTitles.length) fail('Native title tooltips remain', metrics.nativeTitles);
  await capture(win, directory, `${prefix}-01-orbit-7-planets-full-queue`);

  for (const zone of ['resource', 'industry', 'military']) {
    await openZone(win, zone);
    metrics[`${zone}Clipped`] = await clippedText(win, '.resource-zone-summary, .resource-zone-queue');
    if (metrics[`${zone}Clipped`].length) fail(`${zone} zone text is cut off`, metrics[`${zone}Clipped`]);
    await capture(win, directory, `${prefix}-02-zone-${zone}-max`);
  }

  await openZone(win, 'resource');
  await openDialog(win, 'metal-production-1');
  metrics.maxDialog = await win.webContents.executeJavaScript(`(() => { const r = document.querySelector('.resource-building-dialog').getBoundingClientRect(); return { top: r.top, bottom: r.bottom, height: innerHeight }; })()`);
  if (metrics.maxDialog.top < 0 || metrics.maxDialog.bottom > metrics.maxDialog.height) fail('Dialog does not fit', metrics.maxDialog);
  await capture(win, directory, `${prefix}-03-dialog-max-level`);
  await closeDialog(win);

  // 2. A building that cannot be afforded, with the visible reason; then demolish confirmation.
  const mid = Object.fromEntries(Object.entries(max).map(([role, level]) => [role, Math.max(1, Math.floor(level / 2))]));
  await seed(win, { race, buildings: mid, max, wallet: 1500 });
  await openZone(win, 'resource');
  await openDialog(win, 'metal-production-2');
  metrics.unaffordable = await win.webContents.executeJavaScript(`(() => {
    const dialog = document.querySelector('[data-qa-building-dialog]');
    const r = dialog.getBoundingClientRect();
    return { status: dialog.querySelector('[data-qa-build-status]')?.textContent.replace(/\\s+/g, ' ').trim(), missing: dialog.querySelectorAll('[data-qa-building-cost] em').length, disabled: dialog.querySelector('[data-qa-build-button]')?.disabled, fits: r.top >= 0 && r.bottom <= innerHeight };
  })()`);
  if (!metrics.unaffordable.disabled || !metrics.unaffordable.missing || !metrics.unaffordable.fits) fail('Unaffordable dialog is incomplete', metrics.unaffordable);
  metrics.dialogClipped = await clippedText(win, '.resource-building-dialog');
  if (metrics.dialogClipped.length) fail('Dialog text is cut off', metrics.dialogClipped);
  await capture(win, directory, `${prefix}-04-dialog-cannot-afford`);
  await click(win, '[data-qa-building-details-toggle]');
  await capture(win, directory, `${prefix}-05-dialog-details`);
  await click(win, '[data-qa-destroy-building]');
  await waitFor(win, `document.querySelector('[data-qa-action-confirm]')`);
  await settle(win, 300);
  await capture(win, directory, `${prefix}-06-demolish-confirm`);
  await click(win, '[data-qa-action-confirm-no]');
  await closeDialog(win);

  // 3. An empty new colony (its second gas well shows the requirements block).
  await seed(win, { race, buildings: max, max, wallet: 999999999999, current: EMPTY_COLONY });
  await openOrbit(win);
  await capture(win, directory, `${prefix}-07-orbit-empty-colony`);
  await openZone(win, 'resource');
  await capture(win, directory, `${prefix}-08-zone-empty-colony`);
  await openDialog(win, 'gas-production-2');
  await capture(win, directory, `${prefix}-09-dialog-requirements`);
  await closeDialog(win);
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
      webPreferences: { offscreen: true, contextIsolation: true, nodeIntegration: false, sandbox: true, partition: 'qa-planet-screens' },
    });
    await win.loadFile(path.join(ROOT, 'dist', 'index.html'), { search: '?mode=test' });
    await waitFor(win, `document.querySelector('[data-qa-navigation="utility"]')`, 20000);
    win.webContents.debugger.attach('1.3');
    const all = {};
    for (const [width, height] of VIEWPORTS) {
      const directory = path.join(OUTPUT, `${width}x${height}`);
      fs.mkdirSync(directory, { recursive: true });
      await win.webContents.debugger.sendCommand('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false, screenWidth: width, screenHeight: height });
      await settle(win);
      const max = await readMaxLevels(win);
      for (const race of RACES) all[`${width}x${height}:${race}`] = await runViewport(win, directory, max, race);
    }
    fs.writeFileSync(path.join(OUTPUT, 'planet-screens-metrics.json'), JSON.stringify(all, null, 2));
    console.log(JSON.stringify(Object.fromEntries(Object.entries(all).map(([key, value]) => [key, value.failures])), null, 2));
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
