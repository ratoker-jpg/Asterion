// Planet / resource zone UI pass: captures the states the owner complained about
// (1M+ production, disabled quick «+» with its reason, map hover tooltip, the
// building dialog, a 3-item queue, stacked toasts and the planet dock) at
// 1920×1080 and 1280×720, and checks the layout contracts that fixed them.
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-gpu');
app.on('window-all-closed', () => {});

const ROOT = path.join(__dirname, '..');
const OUTPUT = process.env.ASTERION_QA_OUTPUT || path.join(ROOT, 'visual-qa', 'planet-pass-run');
const CHECKS = process.env.ASTERION_QA_CHECKS !== '0';
const SAVE_KEY = 'asterion.vertical-slice.test.v1';
const VIEWPORTS = [[1920, 1080], [1280, 720]];
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const RICH_BUILDINGS = {
  'metal-production-1': 15, 'metal-production-2': 30, 'mineral-production-1': 30, 'mineral-production-2': 10,
  'gas-production-1': 10, 'basic-energy': 30, construction: 10, research: 5, factory: 10,
};

async function waitFor(win, expression, timeoutMs = 8000) {
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
  // Hidden windows do not advance CSS animations: seek finite ones to their end first.
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

async function hover(win, selector) {
  const point = await win.webContents.executeJavaScript(`(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    if (!element) return null;
    element.scrollIntoView({ block: 'nearest' });
    const box = element.getBoundingClientRect();
    return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
  })()`);
  if (!point) throw new Error(`Hover target not found: ${selector}`);
  await win.webContents.debugger.sendCommand('Input.dispatchMouseEvent', { type: 'mouseMoved', x: point.x, y: point.y });
  await settle(win, 260);
}

async function unhover(win) {
  await win.webContents.debugger.sendCommand('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 2, y: 2 });
  await settle(win);
}

/** Writes the fixture and reloads in one renderer turn, so no autosave runs in between. */
async function seed(win, { buildings = RICH_BUILDINGS, wallet = 999999999, queue = [], bots = { metal: 5, minerals: 5, gas: 0 }, math = 4 } = {}) {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const loaded = new Promise((resolve) => win.webContents.once('did-finish-load', resolve));
    const ok = await win.webContents.executeJavaScript(`(() => {
      const save = JSON.parse(localStorage.getItem(${JSON.stringify(SAVE_KEY)}) || 'null');
      const planet = save?.planets?.['helion-01'];
      if (!planet?.buildings) return false;
      const now = Date.now();
      planet.buildings = { ...planet.buildings, ...${JSON.stringify(buildings)} };
      planet.energy = 999999999;
      planet.productionBots = ${JSON.stringify(bots)};
      save.metal = ${wallet};
      save.minerals = ${wallet};
      save.gas = ${wallet};
      if (planet.resources) planet.resources = { ...planet.resources, metal: ${wallet}, minerals: ${wallet}, gas: ${wallet} };
      if (save.science?.levels) save.science.levels[3] = ${math};
      save.queues = { 'helion-01': ${JSON.stringify(queue)}.map((item, index) => ({
        id: 'qa-' + index, planetId: 'helion-01', assetRole: item.role, targetLevel: item.level,
        cost: { metal: 0, minerals: 0, gas: 0, energy: 0 },
        enqueuedAt: now + index, startedAt: now + (item.startOffset ?? 0), finishAt: now + item.finishOffset,
      })) };
      save.resourceClock = { lastReconciledAt: now, remainder: { metal: 0, minerals: 0, gas: 0, energy: 0 } };
      save.schemaVersion = Math.max(Number(save.schemaVersion) || 0, 10);
      localStorage.setItem(${JSON.stringify(SAVE_KEY)}, JSON.stringify(save));
      localStorage.setItem('asterion.test-time-scale.v1', '1');
      setTimeout(() => window.location.reload(), 0);
      return true;
    })()`);
    if (!ok) throw new Error('Could not seed the planet pass fixture');
    await loaded;
    await waitFor(win, `document.querySelector('[data-qa-navigation="utility"]')`);
    await win.webContents.executeJavaScript('document.fonts?.ready');
    await settle(win, 300);
    const held = await win.webContents.executeJavaScript(`(() => {
      const save = JSON.parse(localStorage.getItem(${JSON.stringify(SAVE_KEY)}) || 'null');
      return save?.planets?.['helion-01']?.buildings?.['metal-production-1'] === ${buildings['metal-production-1'] ?? 'undefined'};
    })()`);
    if (held) return;
  }
  throw new Error('Planet pass fixture was overwritten by the running game three times');
}

async function openZone(win, zone) {
  await click(win, `[data-qa-zone="${zone}"]`);
  await waitFor(win, `document.querySelector('[data-qa-zone-view][data-zone=${JSON.stringify(zone)}] .resource-zone-summary img')`);
  await waitFor(win, `Array.from(document.querySelectorAll('[data-qa-zone-view] img')).every((img) => img.complete)`);
  await settle(win, 300);
}

/** Every pair of text boxes inside `scope` that visibly overlap. */
function overlaps(win, scope, itemSelector) {
  return win.webContents.executeJavaScript(`(() => {
    const result = [];
    document.querySelectorAll(${JSON.stringify(scope)}).forEach((card) => {
      const nodes = Array.from(card.querySelectorAll(${JSON.stringify(itemSelector)})).filter((node) => node.getClientRects().length && node.textContent.trim());
      const boxes = nodes.map((node) => ({ text: node.textContent.trim(), box: node.getBoundingClientRect() }));
      for (let i = 0; i < boxes.length; i += 1) for (let j = i + 1; j < boxes.length; j += 1) {
        const a = boxes[i].box; const b = boxes[j].box;
        if (a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1) {
          const contains = (x, y) => x.left <= y.left && x.right >= y.right && x.top <= y.top && x.bottom >= y.bottom;
          if (!contains(a, b) && !contains(b, a)) result.push([boxes[i].text, boxes[j].text]);
        }
      }
    });
    return result;
  })()`);
}

function clipped(win, selector) {
  return win.webContents.executeJavaScript(`Array.from(document.querySelectorAll(${JSON.stringify(selector)}))
    .filter((node) => node.scrollWidth > node.clientWidth + 1).map((node) => node.textContent.trim())`);
}

async function runViewport(win, directory) {
  const metrics = {};
  const fail = (message, detail) => { if (CHECKS) throw new Error(`${message}: ${JSON.stringify(detail)}`); metrics.failures = [...(metrics.failures ?? []), message]; };

  // 1. Rich planet: 1M+ production, enabled quick buttons, the map hover tooltip.
  await seed(win);
  await openZone(win, 'resource');
  metrics.income = await win.webContents.executeJavaScript(`Array.from(document.querySelectorAll('[data-resource-income]')).map((row) => row.textContent.replace(/\\s+/g, ' ').trim())`);
  metrics.incomeClipped = await clipped(win, '[data-resource-income] strong');
  if (metrics.incomeClipped.length) fail('Income values do not fit', metrics.incomeClipped);
  await capture(win, directory, '01-resource-zone-1m-income');

  await hover(win, '[data-zone-building-role="mineral-production-1"]');
  metrics.mapHoverOnTop = await win.webContents.executeJavaScript(`(() => {
    const caption = document.querySelector('[data-zone-building-role="mineral-production-1"] .resource-building-caption');
    const box = caption.getBoundingClientRect();
    const points = [[box.left + 6, box.top + 6], [box.right - 6, box.top + 6], [box.left + box.width / 2, box.top + box.height / 2], [box.left + 6, box.bottom - 6], [box.right - 6, box.bottom - 6]];
    return points.every(([x, y]) => caption.contains(document.elementFromPoint(x, y)));
  })()`);
  if (!metrics.mapHoverOnTop) fail('Hovered map caption is covered by another building', metrics.mapHoverOnTop);
  await capture(win, directory, '02-map-hover-on-top');
  await unhover(win);

  // The owner's case: a tile's name card used to slide under the map captions.
  await hover(win, '[data-zone-selector-role="gas-production-1"]');
  metrics.tileTipOnTop = await win.webContents.executeJavaScript(`(() => {
    const tip = document.querySelector('[data-qa-tile-tooltip]');
    if (!tip) return 'no tooltip';
    tip.style.pointerEvents = 'auto';
    const box = tip.getBoundingClientRect();
    const points = [[box.left + 12, box.top + 12], [box.right - 12, box.top + 12], [box.left + box.width / 2, box.top + box.height / 2], [box.left + 12, box.bottom - 12], [box.right - 12, box.bottom - 12]];
    const misses = points.filter(([x, y]) => !tip.contains(document.elementFromPoint(x, y)))
      .map(([x, y]) => { const hit = document.elementFromPoint(x, y); return hit ? hit.tagName + '.' + hit.className + '<' + (hit.parentElement?.className ?? '') : 'none@' + x + ',' + y; });
    tip.style.pointerEvents = '';
    return misses.length ? misses : true;
  })()`);
  if (metrics.tileTipOnTop !== true) fail('Tile tooltip is covered by the map', metrics.tileTipOnTop);
  await capture(win, directory, '03-tile-tooltip-on-top');
  await unhover(win);

  await hover(win, '[data-qa-quick-build="metal-production-1"]');
  await capture(win, directory, '03b-quick-enabled-hover');
  await unhover(win);

  // 2. Building dialog of a producing mine (bonuses from science and bots).
  await click(win, '[data-zone-selector-role="metal-production-1"]');
  await waitFor(win, `document.querySelector('[data-qa-building-dialog="metal-production-1"]')`);
  await settle(win, 300);
  metrics.dialogText = await win.webContents.executeJavaScript(`document.querySelector('[data-qa-building-dialog]').innerText`);
  if (/production bots|База Добыча|БАЗОВОЕ ВРЕМЯ/i.test(metrics.dialogText)) fail('Dialog still shows the technical breakdown', metrics.dialogText);
  await capture(win, directory, '04-building-dialog');
  if (await win.webContents.executeJavaScript(`Boolean(document.querySelector('[data-qa-building-details-toggle]'))`)) {
    await click(win, '[data-qa-building-details-toggle]');
    await capture(win, directory, '05-building-dialog-details');
  }
  await click(win, '.resource-building-dialog-close');

  // 3. Poor planet: quick «+» blocked by a shortage, with its reason.
  await seed(win, { wallet: 1500 });
  await openZone(win, 'resource');
  await hover(win, '[data-qa-quick-build="metal-production-1"]');
  metrics.disabledReason = await win.webContents.executeJavaScript(`(() => {
    const button = document.querySelector('[data-qa-quick-build="metal-production-1"]');
    const tip = document.querySelector('[data-qa-quick-tooltip]');
    return { title: button.getAttribute('title'), tip: tip ? tip.innerText : null, visible: Boolean(tip && tip.getBoundingClientRect().width > 0) };
  })()`);
  if (metrics.disabledReason.title) fail('Quick «+» still uses the native title tooltip', metrics.disabledReason);
  if (!metrics.disabledReason.visible || !/не хватает/i.test(metrics.disabledReason.tip ?? '')) fail('Disabled quick «+» has no visible reason', metrics.disabledReason);
  await capture(win, directory, '06-quick-disabled-reason');
  await unhover(win);
  await hover(win, '[data-qa-quick-build="mineral-production-2"]');
  await capture(win, directory, '07-quick-blocked-requirements');
  await unhover(win);

  // 4. Three-item queue held long enough to read.
  await seed(win, { queue: [
    { role: 'mineral-production-2', level: 11, finishOffset: 5 * 60_000 },
    { role: 'mineral-production-2', level: 12, startOffset: 5 * 60_000, finishOffset: 10 * 60_000 },
    { role: 'construction', level: 11, startOffset: 10 * 60_000, finishOffset: 15 * 60_000 },
  ] });
  await openZone(win, 'resource');
  metrics.queueOverlaps = await overlaps(win, '.resource-zone-queue-card', 'small, strong, em, b, time');
  if (metrics.queueOverlaps.length) fail('Queue card text overlaps', metrics.queueOverlaps);
  await capture(win, directory, '08-queue-three-items');

  // 5. Planet screen dock with the same queue and 1M+ income.
  await click(win, '[data-qa-route="planet"]');
  await settle(win, 600);
  metrics.planetIncomeClipped = await clipped(win, '.planet-orbit__income b');
  if (metrics.planetIncomeClipped.length) fail('Planet income values do not fit', metrics.planetIncomeClipped);
  await capture(win, directory, '09-planet-dock');

  // 6. Several builds finishing at once: toasts.
  await seed(win, { queue: [
    { role: 'metal-production-1', level: 15, finishOffset: 1200 },
    { role: 'construction', level: 11, startOffset: 1200, finishOffset: 1500 },
    { role: 'research', level: 6, startOffset: 1500, finishOffset: 1800 },
  ], buildings: { ...RICH_BUILDINGS, 'metal-production-1': 14 } });
  await openZone(win, 'resource');
  await sleep(2600);
  await settle(win);
  metrics.toasts = await win.webContents.executeJavaScript(`Array.from(document.querySelectorAll('[data-qa-runtime-toast]')).map((toast) => toast.innerText.replace(/\\s+/g, ' ').trim())`);
  metrics.toastCoversIncome = await win.webContents.executeJavaScript(`(() => {
    const income = document.querySelector('.resource-zone-economy')?.getBoundingClientRect();
    if (!income) return false;
    return Array.from(document.querySelectorAll('[data-qa-runtime-toast]')).some((toast) => {
      const box = toast.getBoundingClientRect();
      return box.left < income.right && income.left < box.right && box.top < income.bottom && income.top < box.bottom;
    });
  })()`);
  if (metrics.toastCoversIncome) fail('Toasts cover the income panel', metrics.toasts);
  await capture(win, directory, '10-toasts');
  return metrics;
}

app.whenReady().then(async () => {
  let win;
  try {
    fs.mkdirSync(OUTPUT, { recursive: true });
    win = new BrowserWindow({
      width: 1000,
      height: 700,
      show: false,
      backgroundColor: '#02050a',
      webPreferences: { offscreen: true, contextIsolation: true, nodeIntegration: false, sandbox: true, partition: 'qa-planet-pass' },
    });
    await win.loadFile(path.join(ROOT, 'dist', 'index.html'), { search: '?mode=test' });
    await waitFor(win, `document.querySelector('[data-qa-navigation="utility"]')`, 20000);
    win.webContents.debugger.attach('1.3');
    for (const [width, height] of VIEWPORTS) {
      const directory = path.join(OUTPUT, `${width}x${height}`);
      fs.mkdirSync(directory, { recursive: true });
      await win.webContents.debugger.sendCommand('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false, screenWidth: width, screenHeight: height });
      await settle(win);
      fs.writeFileSync(path.join(directory, 'planet-pass-metrics.json'), JSON.stringify(await runViewport(win, directory), null, 2));
    }
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
