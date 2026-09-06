const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-gpu');
app.on('window-all-closed', () => {});

const ROOT = path.join(__dirname, '..');
const OUTPUT = path.join(ROOT, 'visual-qa');
const SAVE_KEY = 'asterion.vertical-slice.v1';
const VIEWPORTS = [[1920, 1080], [1280, 720]];
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(win, expression, timeoutMs = 7000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await win.webContents.executeJavaScript(`Boolean(${expression})`)) return;
    await sleep(50);
  }
  throw new Error(`Timed out waiting for: ${expression}`);
}

async function settle(win) {
  await win.webContents.executeJavaScript('new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
  await sleep(100);
}

async function reload(win) {
  const done = new Promise((resolve) => win.webContents.once('did-finish-load', resolve));
  win.webContents.reload();
  await done;
  await waitFor(win, `document.querySelector('.utility-navigation')`);
  await win.webContents.executeJavaScript('document.fonts?.ready');
  await settle(win);
}

async function click(win, selector) {
  const clicked = await win.webContents.executeJavaScript(`(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    if (!element || element.disabled) return false;
    element.click();
    return true;
  })()`);
  if (!clicked) throw new Error(`Clickable element not found/enabled: ${selector}`);
  await settle(win);
}

async function setRange(win, selector, value) {
  const changed = await win.webContents.executeJavaScript(`(() => {
    const input = document.querySelector(${JSON.stringify(selector)});
    if (!(input instanceof HTMLInputElement)) return false;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    setter?.call(input, ${JSON.stringify(String(value))});
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  })()`);
  if (!changed) throw new Error(`Range not found: ${selector}`);
  await settle(win);
}

async function capture(win, directory, name) {
  const result = await win.webContents.debugger.sendCommand('Page.captureScreenshot', {
    format: 'png',
    fromSurface: true,
    captureBeyondViewport: false,
  });
  fs.writeFileSync(path.join(directory, `${name}.png`), Buffer.from(result.data, 'base64'));
}

async function seedPlanet(win) {
  const ok = await win.webContents.executeJavaScript(`(() => {
    const raw = localStorage.getItem(${JSON.stringify(SAVE_KEY)});
    const save = raw ? JSON.parse(raw) : null;
    const planet = save?.planets?.['helion-01'];
    if (!planet?.buildings) return false;
    planet.buildings.recycling = 1;
    planet.buildings.shipyard = Math.max(5, Number(planet.buildings.shipyard) || 0);
    planet.recycling = { availableDebris: 100000, jobs: [] };
    save.schemaVersion = Math.max(Number(save.schemaVersion) || 0, 6);
    localStorage.setItem(${JSON.stringify(SAVE_KEY)}, JSON.stringify(save));
    return true;
  })()`);
  if (!ok) throw new Error('Could not seed recycling planet');
  await reload(win);
}

async function activateIndustry(win) {
  await click(win, '.header-zone--industry');
  await waitFor(win, `document.querySelector('[data-qa-zone-view][data-zone="industry"]')`);
}

async function openCenter(win) {
  await click(win, '[data-zone-building-role="recycling"]');
  await waitFor(win, `document.querySelector('[data-qa-building-dialog="recycling"]')`);
  await click(win, '[data-qa-enter-building="recycling"]');
  await waitFor(win, `document.querySelector('[data-qa-recycling-center]')`);
}

async function readScreen(win) {
  return win.webContents.executeJavaScript(`(() => {
    const root = document.querySelector('[data-qa-recycling-center]');
    if (!root) return null;
    const text = (selector) => root.querySelector(selector)?.textContent?.replace(/\\s+/g, ' ').trim() ?? '';
    const attrNum = (selector, attribute) => {
      const raw = root.querySelector(selector)?.getAttribute(attribute);
      return raw == null ? null : Number(raw);
    };
    const disabled = (selector) => Boolean(root.querySelector(selector)?.disabled);
    const job = root.querySelector('[data-qa-recycling-job]');
    return {
      freeDebris: attrNum('[data-qa-recycling-free-debris]', 'data-qa-recycling-free-debris'),
      totalDebris: attrNum('[data-qa-recycling-total-debris]', 'data-qa-recycling-total-debris'),
      jobs: attrNum('[data-qa-recycling-job-count]', 'data-qa-recycling-job-count'),
      allocationTotal: attrNum('[data-qa-recycling-allocation-total]', 'data-qa-recycling-allocation-total'),
      validation: text('[data-qa-recycling-validation]'),
      startDisabled: disabled('[data-qa-recycling-start]'),
      jobId: job?.getAttribute('data-qa-recycling-job') ?? null,
      jobStatus: job?.getAttribute('data-qa-recycling-status') ?? null,
      jobTimer: text('[data-qa-recycling-job-timer]'),
      collectDisabled: job ? Boolean(job.querySelector('[data-qa-recycling-collect]')?.disabled) : null,
      toast: text('[data-qa-recycling-toast]'),
    };
  })()`);
}

async function readSave(win) {
  return win.webContents.executeJavaScript(`(() => {
    const save = JSON.parse(localStorage.getItem(${JSON.stringify(SAVE_KEY)}) || '{}');
    return {
      schemaVersion: save.schemaVersion,
      metal: save.metal,
      minerals: save.minerals,
      gas: save.gas,
      queue: save.queues?.['helion-01'] ?? [],
      recycling: save.planets?.['helion-01']?.recycling,
      recyclingLevel: save.planets?.['helion-01']?.buildings?.recycling,
    };
  })()`);
}

async function makeReady(win) {
  const ok = await win.webContents.executeJavaScript(`(() => {
    const save = JSON.parse(localStorage.getItem(${JSON.stringify(SAVE_KEY)}) || '{}');
    const job = save.planets?.['helion-01']?.recycling?.jobs?.[0];
    if (!job) return false;
    const duration = Math.max(1000, Math.ceil((job.debrisAmount / 1000000 * 3 * 60 * 60 * 1000) / 1000) * 1000);
    job.startedAt = Date.now() - duration - 2000;
    job.finishAt = job.startedAt + duration;
    job.collectExpiresAt = null;
    job.status = 'processing';
    localStorage.setItem(${JSON.stringify(SAVE_KEY)}, JSON.stringify(save));
    return true;
  })()`);
  if (!ok) throw new Error('Could not move recycling job to ready state');
  await reload(win);
  await activateIndustry(win);
  await openCenter(win);
}

async function measure(win) {
  return win.webContents.executeJavaScript(`(() => {
    const root = document.querySelector('[data-qa-recycling-center]');
    const stage = document.querySelector('.stage');
    if (!root || !stage) return null;
    const pick = (element) => {
      const rect = element.getBoundingClientRect();
      return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height };
    };
    const rows = Array.from(root.querySelectorAll('[data-qa-recycling-resource]')).map((row) => ({
      row: pick(row),
      minus: pick(row.querySelector('[data-qa-recycling-allocation-minus]')),
      slider: pick(row.querySelector('[data-qa-recycling-allocation-slider]')),
      plus: pick(row.querySelector('[data-qa-recycling-allocation-plus]')),
      percent: pick(row.querySelector('[data-qa-recycling-allocation-value]')),
    }));
    return {
      viewport: { width: window.innerWidth, height: window.innerHeight },
      document: { width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight },
      stage: pick(stage),
      root: pick(root),
      debrisSlider: pick(root.querySelector('[data-qa-recycling-debris-slider]')),
      start: pick(root.querySelector('[data-qa-recycling-start]')),
      rows,
    };
  })()`);
}

function assertGeometry(snapshot, label) {
  if (!snapshot) throw new Error(`${label}: missing geometry`);
  const epsilon = 2;
  const { viewport, document, stage, root, debrisSlider, start, rows } = snapshot;
  if (document.width > viewport.width + epsilon) throw new Error(`${label}: horizontal scroll ${JSON.stringify(snapshot)}`);
  if (Math.abs(stage.left) > epsilon || Math.abs(stage.top) > epsilon || Math.abs(stage.right - viewport.width) > epsilon || Math.abs(stage.bottom - viewport.height) > epsilon) {
    throw new Error(`${label}: stage not viewport aligned ${JSON.stringify(snapshot)}`);
  }
  if (root.left < -epsilon || root.right > viewport.width + epsilon || root.top < -epsilon || root.bottom > viewport.height + epsilon) throw new Error(`${label}: root clipped`);
  if (debrisSlider.width < 100 || start.width < 180) throw new Error(`${label}: primary controls too small`);
  if (rows.length !== 3) throw new Error(`${label}: expected three resource rows`);
  for (const item of rows) {
    if (item.minus.width < 26 || item.plus.width < 26 || item.slider.width < 90 || item.percent.width < 28) throw new Error(`${label}: resource controls too small ${JSON.stringify(item)}`);
    if (item.minus.right > item.slider.left + epsilon || item.slider.right > item.plus.left + epsilon || item.plus.right > item.percent.left + epsilon) throw new Error(`${label}: resource controls overlap ${JSON.stringify(item)}`);
  }
}

async function verifyReturn(win) {
  await click(win, '[data-qa-recycling-back]');
  await waitFor(win, `document.querySelector('[data-qa-zone-view][data-zone="industry"]')`);
  await waitFor(win, `document.querySelector('[data-qa-building-dialog="recycling"]')`);
  await click(win, '[data-qa-enter-building="recycling"]');
  await waitFor(win, `document.querySelector('[data-qa-recycling-center]')`);
  await win.webContents.executeJavaScript(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))`);
  await settle(win);
  await waitFor(win, `document.querySelector('[data-qa-zone-view][data-zone="industry"]')`);
  await waitFor(win, `document.querySelector('[data-qa-building-dialog="recycling"]')`);
}

async function verifyFlow(win, directory, label) {
  await win.webContents.executeJavaScript(`localStorage.removeItem(${JSON.stringify(SAVE_KEY)})`);
  await reload(win);
  await seedPlanet(win);
  const seeded = await readSave(win);
  if (Number(seeded.schemaVersion) < 6 || Number(seeded.recyclingLevel) !== 1) throw new Error(`${label}: seed migration mismatch ${JSON.stringify(seeded)}`);
  const queueBefore = JSON.stringify(seeded.queue);

  await activateIndustry(win);
  await openCenter(win);
  let screen = await readScreen(win);
  if (!screen || screen.freeDebris !== 100000 || screen.totalDebris !== 100000 || screen.jobs !== 0) throw new Error(`${label}: initial recycling state mismatch ${JSON.stringify(screen)}`);
  assertGeometry(await measure(win), label);
  await capture(win, directory, 'recycling-empty');

  await setRange(win, '[data-qa-recycling-debris-slider]', 10000);
  await setRange(win, '[data-qa-recycling-allocation-slider="metal"]', 60);
  await setRange(win, '[data-qa-recycling-allocation-slider="minerals"]', 30);
  screen = await readScreen(win);
  if (!screen?.startDisabled || screen.allocationTotal !== 90 || !screen.validation.includes('Распределите оставшиеся 10%')) throw new Error(`${label}: 60/30 validation failed ${JSON.stringify(screen)}`);

  await setRange(win, '[data-qa-recycling-allocation-slider="minerals"]', 40);
  screen = await readScreen(win);
  if (screen?.startDisabled || screen.allocationTotal !== 100) throw new Error(`${label}: 60/40 should enable start ${JSON.stringify(screen)}`);
  await click(win, '[data-qa-recycling-start]');
  await waitFor(win, `document.querySelector('[data-qa-recycling-job]')`);
  screen = await readScreen(win);
  if (screen?.freeDebris !== 90000 || screen.jobs !== 1 || screen.jobStatus !== 'processing' || !screen.collectDisabled) throw new Error(`${label}: processing state mismatch ${JSON.stringify(screen)}`);
  const afterStart = await readSave(win);
  if (JSON.stringify(afterStart.queue) !== queueBefore) throw new Error(`${label}: building FIFO changed during recycling`);
  if (afterStart.recycling?.jobs?.length !== 1) throw new Error(`${label}: recycling job not persisted`);

  await setRange(win, '[data-qa-recycling-debris-slider]', 1000);
  screen = await readScreen(win);
  if (!screen?.startDisabled || screen.validation !== 'Все процессы заняты') throw new Error(`${label}: concurrent limit not enforced ${JSON.stringify(screen)}`);
  assertGeometry(await measure(win), label);
  await capture(win, directory, 'recycling-processing');

  await makeReady(win);
  screen = await readScreen(win);
  if (screen?.jobStatus !== 'ready' || screen.collectDisabled || !screen.jobTimer.startsWith('Получить до ')) throw new Error(`${label}: ready state mismatch ${JSON.stringify(screen)}`);
  if (!screen.jobTimer.includes('23:') && !screen.jobTimer.includes('24:')) throw new Error(`${label}: 24-hour collect timer missing ${JSON.stringify(screen)}`);
  assertGeometry(await measure(win), label);
  await capture(win, directory, 'recycling-ready');

  await click(win, '[data-qa-recycling-collect]');
  await waitFor(win, `!document.querySelector('[data-qa-recycling-job]')`);
  await waitFor(win, `document.querySelector('[data-qa-recycling-toast]')?.textContent?.includes('Ресурсы получены')`);
  const collected = await readSave(win);
  if (collected.recycling?.jobs?.length !== 0) throw new Error(`${label}: collected job not removed`);
  if (Number(collected.metal) !== 20380 || Number(collected.minerals) !== 15712 || Number(collected.gas) !== 6421) throw new Error(`${label}: wallet output mismatch ${JSON.stringify(collected)}`);
  if (JSON.stringify(collected.queue) !== queueBefore) throw new Error(`${label}: building FIFO changed after collect`);

  await verifyReturn(win);
  return {
    viewport: label,
    screenshots: ['recycling-empty.png', 'recycling-processing.png', 'recycling-ready.png'],
    walletAfterCollect: { metal: collected.metal, minerals: collected.minerals, gas: collected.gas },
    verified: [
      'temporary-100000-debris-stock',
      '60-30-disabled-with-exact-remainder',
      '60-40-starts',
      'debris-reserved-immediately',
      'processing-card-and-disabled-collect',
      'concurrent-limit',
      'absolute-time-ready-state',
      '24-hour-collect-timer',
      'collect-updates-wallet-once',
      'building-fifo-unchanged',
      'back-and-escape-restore-industry-modal',
      'no-horizontal-page-overflow-or-control-overlap',
    ],
  };
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
      webPreferences: {
        offscreen: true,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        partition: 'qa-recycling-center-functional',
      },
    });
    await win.loadFile(path.join(ROOT, 'dist', 'index.html'));
    win.webContents.debugger.attach('1.3');

    for (const [width, height] of VIEWPORTS) {
      const label = `${width}x${height}`;
      const directory = path.join(OUTPUT, label);
      fs.mkdirSync(directory, { recursive: true });
      await win.webContents.debugger.sendCommand('Emulation.setDeviceMetricsOverride', {
        width,
        height,
        deviceScaleFactor: 1,
        mobile: false,
        screenWidth: width,
        screenHeight: height,
      });
      await settle(win);
      const result = await verifyFlow(win, directory, label);
      fs.writeFileSync(path.join(directory, 'recycling-center-metrics.json'), JSON.stringify(result, null, 2));
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
