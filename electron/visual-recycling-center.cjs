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
  await waitFor(win, `document.querySelector('[data-qa-navigation="utility"]')`);
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

async function setNumberInput(win, selector, value) {
  const changed = await win.webContents.executeJavaScript(`(() => {
    const input = document.querySelector(${JSON.stringify(selector)});
    if (!(input instanceof HTMLInputElement)) return false;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    setter?.call(input, ${JSON.stringify(String(value))});
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  })()`);
  if (!changed) throw new Error(`Number input not found: ${selector}`);
  await settle(win);
}

async function capture(win, directory, name) {
  await win.webContents.executeJavaScript('window.scrollTo(0, 0)');
  await settle(win);
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
    planet.buildings.recycling = 3;
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
  await click(win, '[data-qa-zone="industry"]');
  await waitFor(win, `document.querySelector('[data-qa-zone-view][data-zone="industry"]')`);
}

async function openCenter(win) {
  await click(win, '[data-zone-building-role="recycling"]');
  await waitFor(win, `document.querySelector('[data-qa-building-dialog="recycling"]')`);
  await click(win, '[data-qa-enter-building="recycling"]');
  await waitFor(win, `document.querySelector('[data-qa-recycling-center]')`);
  await waitFor(win, `document.documentElement.classList.contains('asterion-long-page')`);
  await settle(win);
}

async function readScreen(win) {
  return win.webContents.executeJavaScript(`(() => {
    const root = document.querySelector('[data-qa-recycling-center]');
    if (!root) return null;
    const text = (selector, scope = root) => scope.querySelector(selector)?.textContent?.replace(/\\s+/g, ' ').trim() ?? '';
    const attrNum = (selector, attribute) => {
      const raw = root.querySelector(selector)?.getAttribute(attribute);
      return raw == null ? null : Number(raw);
    };
    const disabled = (selector) => Boolean(root.querySelector(selector)?.disabled);
    const debrisInput = root.querySelector('[data-qa-recycling-debris-input]');
    const jobs = Array.from(root.querySelectorAll('[data-qa-recycling-job]')).map((job) => ({
      id: job.getAttribute('data-qa-recycling-job'),
      status: job.getAttribute('data-qa-recycling-status'),
      timer: text('[data-qa-recycling-job-timer]', job),
      allocation: text('[data-qa-recycling-job-allocation]', job),
      output: text('[data-qa-recycling-job-output]', job),
      collectDisabled: Boolean(job.querySelector('[data-qa-recycling-collect]')?.disabled),
    }));
    return {
      freeDebris: attrNum('[data-qa-recycling-free-debris]', 'data-qa-recycling-free-debris'),
      totalDebris: attrNum('[data-qa-recycling-total-debris]', 'data-qa-recycling-total-debris'),
      debrisValue: attrNum('[data-qa-recycling-debris-input]', 'data-qa-recycling-debris-value'),
      debrisInputValue: debrisInput instanceof HTMLInputElement ? Number(debrisInput.value) : null,
      jobs: attrNum('[data-qa-recycling-job-count]', 'data-qa-recycling-job-count'),
      maxJobs: attrNum('[data-qa-recycling-max-jobs]', 'data-qa-recycling-max-jobs'),
      allocationTotal: attrNum('[data-qa-recycling-allocation-total]', 'data-qa-recycling-allocation-total'),
      validation: text('[data-qa-recycling-validation]'),
      startDisabled: disabled('[data-qa-recycling-start]'),
      nextEfficiency: text('[data-qa-recycling-next-efficiency]'),
      duration: text('[data-qa-recycling-duration]'),
      hasLargePreviewStrip: Boolean(root.querySelector('.recycling-preview-strip')),
      jobRows: jobs,
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

async function makeReady(win, jobIndex = 0) {
  const ok = await win.webContents.executeJavaScript(`(() => {
    const save = JSON.parse(localStorage.getItem(${JSON.stringify(SAVE_KEY)}) || '{}');
    const job = save.planets?.['helion-01']?.recycling?.jobs?.[${jobIndex}];
    if (!job) return false;
    const duration = Math.max(1000, Math.ceil((job.debrisAmount / 18 * 1000) / 1000) * 1000);
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

async function makeExpiredForAutoCollect(win, jobIndex = 0) {
  const ok = await win.webContents.executeJavaScript(`(() => {
    const save = JSON.parse(localStorage.getItem(${JSON.stringify(SAVE_KEY)}) || '{}');
    const job = save.planets?.['helion-01']?.recycling?.jobs?.[${jobIndex}];
    if (!job) return false;
    const duration = Math.max(1000, Math.ceil((job.debrisAmount / 18 * 1000) / 1000) * 1000);
    const storage = 24 * 60 * 60 * 1000;
    job.startedAt = Date.now() - duration - storage - 2000;
    job.finishAt = job.startedAt + duration;
    job.collectExpiresAt = job.finishAt + storage;
    job.status = 'ready';
    localStorage.setItem(${JSON.stringify(SAVE_KEY)}, JSON.stringify(save));
    return true;
  })()`);
  if (!ok) throw new Error('Could not move recycling job beyond auto-collect boundary');
  await reload(win);
}

async function measure(win) {
  return win.webContents.executeJavaScript(`(() => {
    const root = document.querySelector('[data-qa-recycling-center]');
    const stage = document.querySelector('.stage');
    if (!root || !stage) return null;
    const pick = (element) => {
      if (!element) return null;
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
    const jobScrollElement = root.querySelector('[data-qa-recycling-job-list]');
    const jobHeaderElement = root.querySelector('[data-qa-recycling-job-table-header]');
    const jobRowElements = Array.from(root.querySelectorAll('[data-qa-recycling-job]'));
    return {
      viewport: { width: window.innerWidth, height: window.innerHeight },
      document: { width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight },
      longPage: document.documentElement.classList.contains('asterion-long-page'),
      stage: pick(stage),
      root: pick(root),
      debrisInput: pick(root.querySelector('[data-qa-recycling-debris-input]')),
      debrisSlider: pick(root.querySelector('[data-qa-recycling-debris-slider]')),
      start: pick(root.querySelector('[data-qa-recycling-start]')),
      rows,
      jobScroll: pick(jobScrollElement),
      jobScrollWidth: jobScrollElement?.scrollWidth ?? 0,
      jobClientWidth: jobScrollElement?.clientWidth ?? 0,
      jobScrollHeight: jobScrollElement?.scrollHeight ?? 0,
      jobClientHeight: jobScrollElement?.clientHeight ?? 0,
      jobHeader: pick(jobHeaderElement),
      jobHeaderCells: jobHeaderElement ? Array.from(jobHeaderElement.children).map(pick) : [],
      jobRows: jobRowElements.map((job) => ({
        row: pick(job),
        cells: Array.from(job.children).map(pick),
      })),
    };
  })()`);
}

function assertGeometry(snapshot, label, expectedJobRows = 0) {
  if (!snapshot) throw new Error(`${label}: missing geometry`);
  const epsilon = 2;
  const { viewport, document, longPage, stage, root, debrisInput, debrisSlider, start, rows, jobScroll, jobScrollWidth, jobClientWidth, jobScrollHeight, jobClientHeight, jobHeader, jobHeaderCells, jobRows } = snapshot;
  if (!longPage) throw new Error(`${label}: recycling center did not activate global page scroll`);
  if (document.width > viewport.width + epsilon) throw new Error(`${label}: horizontal page scroll ${JSON.stringify(snapshot)}`);
  if (document.height <= viewport.height + epsilon) throw new Error(`${label}: document did not become vertically scrollable ${JSON.stringify(snapshot)}`);
  const stageCenter = (stage.left + stage.right) / 2;
  const documentCenter = document.width / 2;
  if (Math.abs(stageCenter - documentCenter) > epsilon || Math.abs(stage.top) > epsilon) {
    throw new Error(`${label}: long-page stage not centered in document content ${JSON.stringify(snapshot)}`);
  }
  if (stage.bottom <= viewport.height + epsilon) throw new Error(`${label}: long-page stage did not grow below viewport`);
  if (root.left < -epsilon || root.right > viewport.width + epsilon || root.top < -epsilon) throw new Error(`${label}: root clipped horizontally or above viewport`);
  if (!debrisInput || debrisInput.width < 110 || debrisSlider.width < 100 || start.width < 180) throw new Error(`${label}: primary controls too small`);
  if (rows.length !== 3) throw new Error(`${label}: expected three resource rows`);
  for (const item of rows) {
    if (item.minus.width < 26 || item.plus.width < 26 || item.slider.width < 90 || item.percent.width < 28) throw new Error(`${label}: resource controls too small ${JSON.stringify(item)}`);
    if (item.minus.right > item.slider.left + epsilon || item.slider.right > item.plus.left + epsilon || item.plus.right > item.percent.left + epsilon) throw new Error(`${label}: resource controls overlap ${JSON.stringify(item)}`);
  }
  if (expectedJobRows === 0) return;
  if (!jobScroll || !jobHeader || jobRows.length !== expectedJobRows) throw new Error(`${label}: process table missing rows ${JSON.stringify(snapshot)}`);
  if (jobScroll.left < root.left - epsilon || jobScroll.right > root.right + epsilon) throw new Error(`${label}: process list escapes root`);
  if (jobScrollWidth < jobClientWidth) throw new Error(`${label}: process table does not fill list width`);
  if (jobScrollHeight > jobClientHeight + epsilon) throw new Error(`${label}: process list created nested vertical scroll`);
  if (jobHeaderCells.length !== 5) throw new Error(`${label}: process header does not have five columns`);
  for (const item of jobRows) {
    if (!item.row || item.cells.length !== 5) throw new Error(`${label}: process row does not have five columns ${JSON.stringify(item)}`);
    if (Math.abs(item.row.left - jobHeader.left) > epsilon || Math.abs(item.row.right - jobHeader.right) > epsilon) throw new Error(`${label}: process row/header widths differ`);
    for (let index = 0; index < 5; index += 1) {
      if (Math.abs(item.cells[index].left - jobHeaderCells[index].left) > epsilon || Math.abs(item.cells[index].right - jobHeaderCells[index].right) > epsilon) {
        throw new Error(`${label}: process column ${index} misaligned`);
      }
    }
  }
}

async function verifyGlobalScroll(win, label) {
  const maxScroll = await win.webContents.executeJavaScript(`Math.max(0, document.documentElement.scrollHeight - window.innerHeight)`);
  if (maxScroll <= 0) throw new Error(`${label}: no global scroll range`);
  await win.webContents.executeJavaScript('window.scrollTo(0, document.documentElement.scrollHeight)');
  await settle(win);
  const scrollY = await win.webContents.executeJavaScript('window.scrollY');
  if (scrollY <= 0) throw new Error(`${label}: global page scroll did not move`);
  await win.webContents.executeJavaScript('window.scrollTo(0, 0)');
  await settle(win);
}

async function verifyReturn(win) {
  await click(win, '[data-qa-recycling-back]');
  await waitFor(win, `document.querySelector('[data-qa-zone-view][data-zone="industry"]')`);
  await waitFor(win, `document.querySelector('[data-qa-building-dialog="recycling"]')`);
  await click(win, '[data-qa-enter-building="recycling"]');
  await waitFor(win, `document.querySelector('[data-qa-recycling-center]')`);
  await waitFor(win, `document.documentElement.classList.contains('asterion-long-page')`);
  await win.webContents.executeJavaScript(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))`);
  await settle(win);
  await waitFor(win, `document.querySelector('[data-qa-zone-view][data-zone="industry"]')`);
  await waitFor(win, `document.querySelector('[data-qa-building-dialog="recycling"]')`);
}

async function startConfiguredJob(win, debrisAmount, metal, minerals, gas) {
  await setNumberInput(win, '[data-qa-recycling-debris-input]', debrisAmount);
  await setRange(win, '[data-qa-recycling-allocation-slider="metal"]', metal);
  await setRange(win, '[data-qa-recycling-allocation-slider="minerals"]', minerals);
  await setRange(win, '[data-qa-recycling-allocation-slider="gas"]', gas);
  const screen = await readScreen(win);
  if (screen?.debrisInputValue !== debrisAmount || screen.debrisValue !== debrisAmount) throw new Error(`Manual debris input did not update state: ${JSON.stringify(screen)}`);
  if (screen?.startDisabled || screen.allocationTotal !== 100) throw new Error(`Configured job should be startable: ${JSON.stringify(screen)}`);
  await click(win, '[data-qa-recycling-start]');
  await settle(win);
}

async function verifyFlow(win, directory, label) {
  await win.webContents.executeJavaScript(`localStorage.removeItem(${JSON.stringify(SAVE_KEY)})`);
  await reload(win);
  await seedPlanet(win);
  const seeded = await readSave(win);
  if (Number(seeded.schemaVersion) < 6 || Number(seeded.recyclingLevel) !== 3) throw new Error(`${label}: seed migration mismatch ${JSON.stringify(seeded)}`);
  const queueBefore = JSON.stringify(seeded.queue);

  await activateIndustry(win);
  await openCenter(win);
  let screen = await readScreen(win);
  if (!screen || screen.freeDebris !== 100000 || screen.totalDebris !== 100000 || screen.jobs !== 0 || screen.maxJobs !== 3) throw new Error(`${label}: initial recycling state mismatch ${JSON.stringify(screen)}`);
  if (screen.nextEfficiency !== '90%') throw new Error(`${label}: next efficiency must not include plus sign ${JSON.stringify(screen)}`);
  if (screen.hasLargePreviewStrip) throw new Error(`${label}: obsolete large time/efficiency/output strip still exists`);
  assertGeometry(await measure(win), label);
  await verifyGlobalScroll(win, label);
  await capture(win, directory, 'recycling-empty');

  await setNumberInput(win, '[data-qa-recycling-debris-input]', 10000);
  screen = await readScreen(win);
  if (screen?.debrisInputValue !== 10000 || screen.debrisValue !== 10000 || screen.duration !== '00:09:16') throw new Error(`${label}: manual debris amount or compact duration mismatch ${JSON.stringify(screen)}`);
  await setRange(win, '[data-qa-recycling-allocation-slider="metal"]', 60);
  await setRange(win, '[data-qa-recycling-allocation-slider="minerals"]', 30);
  screen = await readScreen(win);
  if (!screen?.startDisabled || screen.allocationTotal !== 90 || !screen.validation.includes('Распределите оставшиеся 10%')) throw new Error(`${label}: 60/30 validation failed ${JSON.stringify(screen)}`);

  await setRange(win, '[data-qa-recycling-allocation-slider="minerals"]', 40);
  screen = await readScreen(win);
  if (screen?.startDisabled || screen.allocationTotal !== 100) throw new Error(`${label}: 60/40 should enable start ${JSON.stringify(screen)}`);
  await click(win, '[data-qa-recycling-start]');
  await waitFor(win, `document.querySelectorAll('[data-qa-recycling-job]').length === 1`);
  screen = await readScreen(win);
  if (screen?.freeDebris !== 90000 || screen.jobs !== 1 || screen.jobRows[0]?.status !== 'processing' || !screen.jobRows[0]?.collectDisabled) throw new Error(`${label}: first processing state mismatch ${JSON.stringify(screen)}`);
  if (screen.jobRows[0]?.allocation !== '60% металл · 40% минералы · 0% газ') throw new Error(`${label}: allocation text must show all resources ${JSON.stringify(screen)}`);
  if (!screen.jobRows[0]?.output.includes('М 5') || !screen.jobRows[0]?.output.includes('Мин 3') || !screen.jobRows[0]?.output.includes('Газ 0')) throw new Error(`${label}: output text must show all resources ${JSON.stringify(screen)}`);
  if (!screen.jobRows[0]?.timer.startsWith('Осталось:')) throw new Error(`${label}: processing timer label mismatch ${JSON.stringify(screen)}`);
  const firstJobId = screen.jobRows[0].id;
  const afterFirstStart = await readSave(win);
  if (JSON.stringify(afterFirstStart.queue) !== queueBefore) throw new Error(`${label}: building FIFO changed during recycling`);
  if (afterFirstStart.recycling?.jobs?.length !== 1) throw new Error(`${label}: recycling job not persisted`);

  await startConfiguredJob(win, 6000, 0, 0, 100);
  await waitFor(win, `document.querySelectorAll('[data-qa-recycling-job]').length === 2`);
  await startConfiguredJob(win, 4000, 100, 0, 0);
  await waitFor(win, `document.querySelectorAll('[data-qa-recycling-job]').length === 3`);
  screen = await readScreen(win);
  if (screen?.freeDebris !== 80000 || screen.jobs !== 3 || screen.jobRows.some((job) => job.status !== 'processing')) throw new Error(`${label}: multi-processing state mismatch ${JSON.stringify(screen)}`);

  await setNumberInput(win, '[data-qa-recycling-debris-input]', 1000);
  screen = await readScreen(win);
  if (!screen?.startDisabled || screen.validation !== 'Все процессы заняты') throw new Error(`${label}: concurrent limit not enforced ${JSON.stringify(screen)}`);
  assertGeometry(await measure(win), label, 3);
  await verifyGlobalScroll(win, label);
  await capture(win, directory, 'recycling-processing-list');

  await makeReady(win, 0);
  screen = await readScreen(win);
  const readyRows = screen?.jobRows.filter((job) => job.status === 'ready') ?? [];
  const processingRows = screen?.jobRows.filter((job) => job.status === 'processing') ?? [];
  if (readyRows.length !== 1 || processingRows.length !== 2) throw new Error(`${label}: mixed ready/processing list mismatch ${JSON.stringify(screen)}`);
  if (readyRows[0].collectDisabled || !readyRows[0].timer.startsWith('Получить до:')) throw new Error(`${label}: ready row state mismatch ${JSON.stringify(screen)}`);
  if (!readyRows[0].timer.includes('23:') && !readyRows[0].timer.includes('24:')) throw new Error(`${label}: 24-hour collect timer missing ${JSON.stringify(screen)}`);
  if (processingRows.some((job) => !job.collectDisabled || !job.timer.startsWith('Осталось:'))) throw new Error(`${label}: processing rows changed in mixed list ${JSON.stringify(screen)}`);
  assertGeometry(await measure(win), label, 3);
  await capture(win, directory, 'recycling-ready-processing-list');

  const collectSelector = `[data-qa-recycling-collect="${firstJobId}"]`;
  await click(win, collectSelector);
  await waitFor(win, `!document.querySelector('[data-qa-recycling-job="${firstJobId}"]')`);
  await waitFor(win, `document.querySelector('[data-qa-recycling-toast]')?.textContent?.includes('Ресурсы получены')`);
  const collected = await readSave(win);
  if (collected.recycling?.jobs?.length !== 2) throw new Error(`${label}: collected job not removed exactly once`);
  if (Number(collected.metal) !== 20980 || Number(collected.minerals) !== 16112 || Number(collected.gas) !== 6421) throw new Error(`${label}: wallet output mismatch ${JSON.stringify(collected)}`);
  if (JSON.stringify(collected.queue) !== queueBefore) throw new Error(`${label}: building FIFO changed after collect`);

  await makeExpiredForAutoCollect(win, 0);
  await waitFor(win, `(() => {
    const save = JSON.parse(localStorage.getItem(${JSON.stringify(SAVE_KEY)}) || '{}');
    return save.planets?.['helion-01']?.recycling?.jobs?.length === 1 && Number(save.gas) === 11521;
  })()`);
  const autoCollected = await readSave(win);
  if (autoCollected.recycling?.jobs?.length !== 1) throw new Error(`${label}: auto-collected job was not removed ${JSON.stringify(autoCollected)}`);
  if (Number(autoCollected.metal) !== 20980 || Number(autoCollected.minerals) !== 16112 || Number(autoCollected.gas) !== 11521) throw new Error(`${label}: 24h auto-collect did not atomically credit wallet ${JSON.stringify(autoCollected)}`);
  if (JSON.stringify(autoCollected.queue) !== queueBefore) throw new Error(`${label}: building FIFO changed after auto-collect`);

  await reload(win);
  await settle(win);
  const afterRepeatReload = await readSave(win);
  if (Number(afterRepeatReload.metal) !== 20980 || Number(afterRepeatReload.minerals) !== 16112 || Number(afterRepeatReload.gas) !== 11521) throw new Error(`${label}: auto-collect paid twice after reload ${JSON.stringify(afterRepeatReload)}`);
  if (afterRepeatReload.recycling?.jobs?.length !== 1) throw new Error(`${label}: auto-collect state changed on repeated reload ${JSON.stringify(afterRepeatReload)}`);

  await activateIndustry(win);
  await openCenter(win);
  await verifyReturn(win);
  return {
    viewport: label,
    screenshots: ['recycling-empty.png', 'recycling-processing-list.png', 'recycling-ready-processing-list.png'],
    walletAfterCollect: { metal: collected.metal, minerals: collected.minerals, gas: collected.gas },
    walletAfterAutoCollect: { metal: autoCollected.metal, minerals: autoCollected.minerals, gas: autoCollected.gas },
    verified: [
      'temporary-100000-debris-stock',
      'manual-debris-input-and-compact-duration',
      'global-document-scroll-with-growing-recycling-window',
      'no-nested-vertical-process-scroll',
      'large-preview-strip-removed',
      '60-30-disabled-with-exact-remainder',
      '60-40-starts',
      'debris-reserved-immediately',
      'three-processing-rows-use-five-column-table',
      'processing-disabled-collect',
      'concurrent-limit-at-level-three',
      'mixed-ready-and-processing-rows',
      'absolute-time-ready-state',
      '24-hour-collect-timer',
      'collect-updates-wallet-once',
      '24-hour-auto-collect-credits-wallet-once',
      'offline-auto-collect-survives-repeat-reload-without-double-payout',
      'building-fifo-unchanged',
      'next-efficiency-without-plus-prefix',
      'back-and-escape-restore-industry-modal',
      'no-horizontal-page-overflow-or-control-overlap',
      'process-table-columns-remain-aligned',
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
