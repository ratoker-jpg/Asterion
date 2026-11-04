const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const { editSaveIdle } = require('./qa-save-edit.cjs');
const path = require('path');

app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-gpu');
app.on('window-all-closed', () => {});

const ROOT = path.join(__dirname, '..');
const OUTPUT = process.env.ASTERION_QA_OUTPUT || path.join(ROOT, 'visual-qa');
const SAVE_KEY = 'asterion.vertical-slice.test.v1';
const TEST_TIME_SCALE_KEY = 'asterion.test-time-scale.v1';
const EXPECTED_METAL_AFTER_COLLECT = 19_280;
const EXPECTED_MINERALS_AFTER_COLLECT = 12_712;
const EXPECTED_GAS_AFTER_COLLECT = 6_421;
const EXPECTED_GAS_AFTER_AUTO_COLLECT = 11_521;
const EXPECTED_METAL_AFTER_AUTO_COLLECT = 19_280;
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

async function rendererMutationAndReload(win, source, label) {
  // Run while the game is not running, then load it (qa-save-edit.cjs): the
  // running game would write its own state over the fixture while it unloads.
  const value = await editSaveIdle(win, source, { ready: `document.querySelector('[data-qa-navigation="utility"]')`, label });
  if (value === false) throw new Error(`${label}: fixture mutation was rejected`);
  await settle(win);
}

async function advanceRendererClockTo(win, timestamp) {
  const advancedTo = await win.webContents.executeJavaScript(`(() => {
    const key = '__asterionVisualQaClock';
    const clock = window[key] ?? { realNow: Date.now.bind(Date), offset: 0 };
    clock.offset = Math.max(0, ${timestamp} - clock.realNow());
    window[key] = clock;
    Date.now = () => clock.realNow() + clock.offset;
    return Date.now();
  })()`);
  if (!Number.isFinite(advancedTo) || advancedTo < timestamp) {
    throw new Error(`Could not advance visual QA clock to ${timestamp}: ${advancedTo}`);
  }
  return advancedTo;
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
  await rendererMutationAndReload(win, `(() => {
    const raw = localStorage.getItem(${JSON.stringify(SAVE_KEY)});
    const save = raw ? JSON.parse(raw) : null;
    const planet = save?.planets?.['helion-01'];
    if (!planet?.buildings) return false;
    planet.buildings.recycling = 3;
    planet.buildings.shipyard = Math.max(5, Number(planet.buildings.shipyard) || 0);
    for (const role of ['metal-production-1', 'metal-production-2', 'metal-production-3', 'mineral-production-1', 'mineral-production-2', 'gas-production-1', 'gas-production-2']) {
      planet.buildings[role] = 0;
    }
    planet.recycling = { availableDebris: 100000, jobs: [] };
    planet.resources = { ...(planet.resources || {}), metal: 15_880, minerals: 12_712, gas: 6_421 };
    save.metal = 15_880;
    save.minerals = 12_712;
    save.gas = 6_421;
    save.resourceClock = { lastReconciledAt: Date.now(), remainder: { metal: 0, minerals: 0, gas: 0, energy: 0 } };
    save.schemaVersion = Math.max(Number(save.schemaVersion) || 0, 6);
    localStorage.setItem(${JSON.stringify(SAVE_KEY)}, JSON.stringify(save));
    localStorage.setItem(${JSON.stringify(TEST_TIME_SCALE_KEY)}, '1');
    return true;
  })()`, 'Could not seed recycling planet');
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
    const jobs = Array.from(root.querySelectorAll('[data-qa-recycling-job]')).map((job) => ({
      id: job.getAttribute('data-qa-recycling-job'),
      status: job.getAttribute('data-qa-recycling-status'),
      timer: job.querySelector('[data-qa-recycling-job-timer]')?.getAttribute('data-qa-recycling-job-timer') ?? '',
      timerText: text('[data-qa-recycling-job-timer]', job),
      output: Number(job.querySelector('[data-qa-recycling-job-output]')?.getAttribute('data-qa-recycling-job-output')),
      collectDisabled: Boolean(job.disabled),
    }));
    const debrisInput = root.querySelector('[data-qa-recycling-debris-input]');
    return {
      freeDebris: attrNum('[data-qa-recycling-free-debris]', 'data-qa-recycling-free-debris'),
      totalDebris: attrNum('[data-qa-recycling-total-debris]', 'data-qa-recycling-total-debris'),
      debrisValue: attrNum('[data-qa-recycling-debris-input]', 'data-qa-recycling-debris-value'),
      debrisInputValue: debrisInput instanceof HTMLInputElement ? Number(debrisInput.value) : null,
      jobs: attrNum('[data-qa-recycling-job-count]', 'data-qa-recycling-job-count'),
      maxJobs: attrNum('[data-qa-recycling-job-count]', 'data-qa-recycling-max-jobs'),
      freeSlots: attrNum('[data-qa-recycling-free-slots]', 'data-qa-recycling-free-slots'),
      lockedSlots: root.querySelectorAll('[data-qa-recycling-locked-slot]').length,
      startCount: attrNum('[data-qa-recycling-start]', 'data-qa-recycling-start-count'),
      startDisabled: Boolean(root.querySelector('[data-qa-recycling-start]')?.disabled),
      startText: text('[data-qa-recycling-start]'),
      validation: root.querySelector('[data-qa-recycling-validation]')?.getAttribute('data-qa-recycling-validation') ?? '',
      outputTotal: attrNum('[data-qa-recycling-output-total]', 'data-qa-recycling-output-total'),
      nextEfficiency: text('[data-qa-recycling-next-efficiency]'),
      duration: text('[data-qa-recycling-duration]'),
      collectAll: attrNum('[data-qa-recycling-collect-all]', 'data-qa-recycling-collect-all'),
      jobRows: jobs,
      notice: text('[data-qa-runtime-notice]', document),
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
      planetResources: save.planets?.['helion-01']?.resources,
      queue: save.queues?.['helion-01'] ?? [],
      recycling: save.planets?.['helion-01']?.recycling,
      recyclingLevel: save.planets?.['helion-01']?.buildings?.recycling,
    };
  })()`);
}

async function makeReady(win, jobIndex = 0) {
  const job = (await readSave(win)).recycling?.jobs?.[jobIndex];
  if (!job) throw new Error(`Could not find recycling job ${jobIndex}`);
  await advanceRendererClockTo(win, job.finishAt + 1);
  await waitFor(win, `document.querySelector('[data-qa-recycling-job="${job.id}"][data-qa-recycling-status="ready"]')`);
  await activateIndustry(win);
  await openCenter(win);
}

async function makeExpiredForAutoCollect(win) {
  const jobs = (await readSave(win)).recycling?.jobs ?? [];
  if (jobs.length === 0) throw new Error('Could not find a recycling job for auto-collect');
  const nextAutoCollectAt = Math.min(...jobs.map((job) => job.finishAt + 24 * 60 * 60 * 1000));
  await advanceRendererClockTo(win, nextAutoCollectAt + 1);
  await waitFor(win, `(() => {
    const save = JSON.parse(localStorage.getItem(${JSON.stringify(SAVE_KEY)}) || '{}');
    return save.planets?.['helion-01']?.recycling?.jobs?.length === 1 && Number(save.gas) === ${EXPECTED_GAS_AFTER_AUTO_COLLECT};
  })()`);
}

// The screen is one fixed game screen: nothing scrolls, nothing leaves the
// screen, nothing overlaps, no text is cut, and every figure stays on its line.
async function assertGeometry(win, label) {
  const problems = await win.webContents.executeJavaScript(`(() => {
    const root = document.querySelector('[data-qa-recycling-center]');
    const stage = document.querySelector('.stage');
    if (!root || !stage) return ['screen is missing'];
    const problems = [];
    if (document.documentElement.classList.contains('asterion-long-page')) problems.push('the screen became a long scrolling page');
    if (document.documentElement.scrollWidth > window.innerWidth + 2) problems.push('horizontal page scroll');
    if (document.documentElement.scrollHeight > window.innerHeight + 2) problems.push('vertical page scroll');
    const rootBox = root.getBoundingClientRect();
    if (root.scrollHeight > root.clientHeight + 2) problems.push('content is taller than the screen by ' + (root.scrollHeight - root.clientHeight));
    const boxOf = (element) => element.getBoundingClientRect();
    for (const element of root.querySelectorAll('.rc-header, .rc-pile, .rc-core, .rc-bay, .rc-floor, .rc-slot, .rc-start')) {
      const box = boxOf(element);
      if (box.left < rootBox.left - 2 || box.right > rootBox.right + 2 || box.bottom > rootBox.bottom + 2) problems.push(element.className + ' leaves the screen');
    }
    for (const element of root.querySelectorAll('.rc-pile__total, .rc-bay__get strong, .rc-slot > b, .rc-slot > small, .rc-start, .rc-core__summary, .rc-floor__head h2, .rc-floor__free, .rc-collect-all')) {
      if (element.scrollWidth > element.clientWidth + 1) problems.push('text is cut: ' + element.textContent);
    }
    const slots = [...root.querySelectorAll('.rc-slot')];
    if (slots.length !== 10) problems.push('expected 10 process places, got ' + slots.length);
    slots.forEach((slot, index) => {
      if (index > 0 && boxOf(slot).left < boxOf(slots[index - 1]).right - 1) problems.push('process places overlap at ' + index);
      for (const text of slot.querySelectorAll(':scope > b, :scope > small')) {
        const box = boxOf(text);
        const own = boxOf(slot);
        if (box.left < own.left - 1 || box.right > own.right + 1) problems.push('text wider than its place: ' + text.textContent);
      }
    });
    const head = [...root.querySelectorAll('.rc-floor__head > *')];
    head.forEach((item, index) => {
      if (index > 0 && boxOf(item).left < boxOf(head[index - 1]).right - 1) problems.push('process header overlaps: ' + item.textContent);
    });
    for (const element of root.querySelectorAll('[title]')) problems.push('native tooltip on ' + element.className);
    return problems;
  })()`);
  if (problems.length) throw new Error(`${label}: ${problems.join('; ')}`);
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

// One share sets, the other two follow: this order reaches the exact split.
async function setSplit(win, metal, minerals, gas) {
  await setRange(win, '[data-qa-recycling-allocation-slider="metal"]', 100);
  if (minerals > 0) await setRange(win, '[data-qa-recycling-allocation-slider="minerals"]', minerals);
  if (gas > 0) await setRange(win, '[data-qa-recycling-allocation-slider="gas"]', gas);
  const split = await win.webContents.executeJavaScript(`['metal', 'minerals', 'gas'].map((resource) => document.querySelector('[data-qa-recycling-allocation-value="' + resource + '"]')?.textContent)`);
  if (split.join() !== [metal + '%', minerals + '%', gas + '%'].join()) throw new Error(`Split did not reach ${metal}/${minerals}/${gas}: ${split}`);
}

async function startConfiguredJob(win, debrisAmount, metal, minerals, gas) {
  await setNumberInput(win, '[data-qa-recycling-debris-input]', debrisAmount);
  await click(win, '[data-qa-recycling-free-slot="1"]');
  await setSplit(win, metal, minerals, gas);
  const screen = await readScreen(win);
  if (screen?.debrisInputValue !== debrisAmount || screen.debrisValue !== debrisAmount) throw new Error(`Manual debris input did not update state: ${JSON.stringify(screen)}`);
  if (screen?.startDisabled || screen.startCount !== 1) throw new Error(`Configured job should be startable: ${JSON.stringify(screen)}`);
  await click(win, '[data-qa-recycling-start]');
  await settle(win);
}

async function verifyFlow(win, directory, label) {
  await rendererMutationAndReload(win, `(() => {
    localStorage.removeItem(${JSON.stringify(SAVE_KEY)});
    return true;
  })()`, `${label}: clear save`);
  await seedPlanet(win);
  const seeded = await readSave(win);
  if (Number(seeded.schemaVersion) < 6 || Number(seeded.recyclingLevel) !== 3) throw new Error(`${label}: seed migration mismatch ${JSON.stringify(seeded)}`);
  if (Number(seeded.metal) !== 15_880 || Number(seeded.minerals) !== 12_712 || Number(seeded.gas) !== 6_421
    || Number(seeded.planetResources?.metal) !== 15_880 || Number(seeded.planetResources?.minerals) !== 12_712 || Number(seeded.planetResources?.gas) !== 6_421) {
    throw new Error(`${label}: seeded canonical wallet mismatch ${JSON.stringify(seeded)}`);
  }
  const queueBefore = JSON.stringify(seeded.queue);

  await activateIndustry(win);
  await openCenter(win);
  let screen = await readScreen(win);
  if (!screen || screen.freeDebris !== 100000 || screen.totalDebris !== 100000 || screen.jobs !== 0 || screen.maxJobs !== 3) throw new Error(`${label}: initial recycling state mismatch ${JSON.stringify(screen)}`);
  if (screen.nextEfficiency !== '90%') throw new Error(`${label}: next efficiency must not include plus sign ${JSON.stringify(screen)}`);
  // Ready for one click: everything, over all free places.
  if (screen.debrisValue !== 100000 || screen.startCount !== 3 || screen.startDisabled || screen.lockedSlots !== 7) throw new Error(`${label}: default batch mismatch ${JSON.stringify(screen)}`);
  await assertGeometry(win, `${label} empty`);
  await capture(win, directory, 'recycling-empty');

  await setNumberInput(win, '[data-qa-recycling-debris-input]', 10000);
  await click(win, '[data-qa-recycling-free-slot="1"]');
  screen = await readScreen(win);
  if (screen?.debrisInputValue !== 10000 || screen.debrisValue !== 10000 || screen.duration !== '00:00:56') throw new Error(`${label}: manual debris amount or duration mismatch ${JSON.stringify(screen)}`);
  await setSplit(win, 60, 40, 0);
  screen = await readScreen(win);
  if (screen?.startDisabled || screen.outputTotal !== 8500) throw new Error(`${label}: 60/40 should enable start ${JSON.stringify(screen)}`);
  await click(win, '[data-qa-recycling-start]');
  await waitFor(win, `document.querySelectorAll('[data-qa-recycling-job]').length === 1`);
  screen = await readScreen(win);
  if (screen?.freeDebris !== 90000 || screen.jobs !== 1 || screen.jobRows[0]?.status !== 'processing' || !screen.jobRows[0]?.collectDisabled) throw new Error(`${label}: first processing state mismatch ${JSON.stringify(screen)}`);
  if (screen.jobRows[0]?.output !== 8500 || screen.jobRows[0]?.timer !== 'remaining') throw new Error(`${label}: processing job state mismatch ${JSON.stringify(screen)}`);
  const afterFirstStart = await readSave(win);
  if (JSON.stringify(afterFirstStart.queue) !== queueBefore) throw new Error(`${label}: building FIFO changed during recycling`);
  if (afterFirstStart.recycling?.jobs?.length !== 1) throw new Error(`${label}: recycling job not persisted`);

  await startConfiguredJob(win, 6000, 0, 0, 100);
  await waitFor(win, `document.querySelectorAll('[data-qa-recycling-job]').length === 2`);
  await startConfiguredJob(win, 4000, 100, 0, 0);
  await waitFor(win, `document.querySelectorAll('[data-qa-recycling-job]').length === 3`);
  screen = await readScreen(win);
  if (screen?.freeDebris !== 80000 || screen.jobs !== 3 || screen.jobRows.some((job) => job.status !== 'processing')) throw new Error(`${label}: multi-processing state mismatch ${JSON.stringify(screen)}`);
  const shortestJobId = screen.jobRows[2]?.id;
  if (!shortestJobId) throw new Error(`${label}: shortest processing job not found ${JSON.stringify(screen)}`);

  if (!screen.startDisabled || !screen.validation.includes('заняты')) throw new Error(`${label}: concurrent limit not enforced ${JSON.stringify(screen)}`);
  await assertGeometry(win, `${label} processing`);
  await capture(win, directory, 'recycling-processing-list');

  await makeReady(win, 2);
  await waitFor(win, `document.querySelector('[data-qa-recycling-job="${shortestJobId}"][data-qa-recycling-status="ready"]')`);
  screen = await readScreen(win);
  const readyRows = screen?.jobRows.filter((job) => job.status === 'ready') ?? [];
  const processingRows = screen?.jobRows.filter((job) => job.status === 'processing') ?? [];
  if (readyRows.length !== 1 || processingRows.length !== 2 || screen.collectAll !== 1) throw new Error(`${label}: mixed ready/processing list mismatch ${JSON.stringify(screen)}`);
  if (readyRows[0].collectDisabled || readyRows[0].timer !== 'expires') throw new Error(`${label}: ready row state mismatch ${JSON.stringify(screen)}`);
  if (!readyRows[0].timerText.includes('23:') && !readyRows[0].timerText.includes('24:')) throw new Error(`${label}: 24-hour collect timer missing ${JSON.stringify(screen)}`);
  if (processingRows.some((job) => !job.collectDisabled || job.timer !== 'remaining')) throw new Error(`${label}: processing rows changed in mixed list ${JSON.stringify(screen)}`);
  await assertGeometry(win, `${label} mixed`);
  await capture(win, directory, 'recycling-ready-processing-list');

  const collectSelector = `[data-qa-recycling-collect="${shortestJobId}"]`;
  await click(win, collectSelector);
  await waitFor(win, `!document.querySelector('[data-qa-recycling-job="${shortestJobId}"]')`);
  await waitFor(win, `document.querySelector('[data-qa-runtime-notice]')?.textContent?.includes('Ресурсы получены')`);
  await waitFor(win, `(() => {
    const save = JSON.parse(localStorage.getItem(${JSON.stringify(SAVE_KEY)}) || '{}');
    return save.planets?.['helion-01']?.recycling?.jobs?.length === 2;
  })()`);
  const collected = await readSave(win);
  if (collected.recycling?.jobs?.length !== 2) throw new Error(`${label}: collected job not removed exactly once`);
  if (Number(collected.metal) !== EXPECTED_METAL_AFTER_COLLECT || Number(collected.minerals) !== EXPECTED_MINERALS_AFTER_COLLECT || Number(collected.gas) !== EXPECTED_GAS_AFTER_COLLECT) throw new Error(`${label}: wallet output mismatch ${JSON.stringify(collected)}`);
  if (JSON.stringify(collected.queue) !== queueBefore) throw new Error(`${label}: building FIFO changed after collect`);

  await makeExpiredForAutoCollect(win);
  const autoCollected = await readSave(win);
  if (autoCollected.recycling?.jobs?.length !== 1) throw new Error(`${label}: auto-collected job was not removed ${JSON.stringify(autoCollected)}`);
  if (Number(autoCollected.metal) !== EXPECTED_METAL_AFTER_AUTO_COLLECT || Number(autoCollected.minerals) !== EXPECTED_MINERALS_AFTER_COLLECT || Number(autoCollected.gas) !== EXPECTED_GAS_AFTER_AUTO_COLLECT) throw new Error(`${label}: 24h auto-collect did not atomically credit wallet ${JSON.stringify(autoCollected)}`);
  if (JSON.stringify(autoCollected.queue) !== queueBefore) throw new Error(`${label}: building FIFO changed after auto-collect`);

  await reload(win);
  await settle(win);
  const afterRepeatReload = await readSave(win);
  if (Number(afterRepeatReload.metal) !== EXPECTED_METAL_AFTER_AUTO_COLLECT || Number(afterRepeatReload.minerals) !== EXPECTED_MINERALS_AFTER_COLLECT || Number(afterRepeatReload.gas) !== EXPECTED_GAS_AFTER_AUTO_COLLECT) throw new Error(`${label}: auto-collect paid twice after reload ${JSON.stringify(afterRepeatReload)}`);
  if (afterRepeatReload.recycling?.jobs?.length !== 1) throw new Error(`${label}: auto-collect state changed on repeated reload ${JSON.stringify(afterRepeatReload)}`);

  await activateIndustry(win);
  await openCenter(win);
  await verifyReturn(win);
  return {
    viewport: label,
    walletAfterCollect: { metal: collected.metal, minerals: collected.minerals, gas: collected.gas },
    walletAfterAutoCollect: { metal: autoCollected.metal, minerals: autoCollected.minerals, gas: autoCollected.gas },
  };
}

async function seedWorstCase(win, level, debris) {
  await rendererMutationAndReload(win, `(() => {
    const raw = localStorage.getItem(${JSON.stringify(SAVE_KEY)});
    const save = raw ? JSON.parse(raw) : null;
    const planet = save?.planets?.['helion-01'];
    if (!planet?.buildings) return false;
    planet.buildings.recycling = ${level};
    planet.name = 'Москва';
    planet.recycling = { availableDebris: ${debris}, jobs: [] };
    save.resourceClock = { lastReconciledAt: Date.now(), remainder: { metal: 0, minerals: 0, gas: 0, energy: 0 } };
    localStorage.setItem(${JSON.stringify(SAVE_KEY)}, JSON.stringify(save));
    localStorage.setItem(${JSON.stringify(TEST_TIME_SCALE_KEY)}, '1');
    return true;
  })()`, 'Could not seed the worst case');
  await activateIndustry(win);
  await openCenter(win);
}

// The worst cases of the task: 200 млн debris, ten running, all ready, nothing
// left, building level 1 with one place. Each at both window sizes.
async function verifyWorstCases(win, label) {
  const directory = path.join(OUTPUT, 'recycling-center-redo', label);
  fs.mkdirSync(directory, { recursive: true });

  await seedWorstCase(win, 10, 200_000_000);
  let screen = await readScreen(win);
  if (screen.startCount !== 10 || screen.startDisabled || screen.startText !== 'Запустить 10 процессов') throw new Error(`${label}: the default batch must be all ten ${JSON.stringify(screen)}`);
  // 200 млн at 120%, 20 млн per process at 980 per second.
  if (screen.outputTotal !== 240_000_000 || screen.duration !== '05:40:09') throw new Error(`${label}: the batch preview is wrong ${JSON.stringify(screen)}`);
  await assertGeometry(win, `${label} 200 млн`);
  await capture(win, directory, 'debris-200m');

  await click(win, '[data-qa-recycling-free-slot="4"]');
  await assertGeometry(win, `${label} four picked`);
  await capture(win, directory, 'four-selected');
  await click(win, '[data-qa-recycling-free-slot="10"]');

  await click(win, '[data-qa-recycling-start]');
  await waitFor(win, `document.querySelectorAll('[data-qa-recycling-job]').length === 10`);
  screen = await readScreen(win);
  if (screen.freeDebris !== 0 || screen.jobs !== 10 || new Set(screen.jobRows.map((job) => job.id)).size !== 10) throw new Error(`${label}: ten processes must start at once ${JSON.stringify(screen)}`);
  if (!screen.startDisabled) throw new Error(`${label}: start must wait now ${JSON.stringify(screen)}`);
  await assertGeometry(win, `${label} ten running`);
  await capture(win, directory, 'ten-running');

  const saved = await waitForSavedJobs(win, 10);
  await advanceRendererClockTo(win, Math.floor((saved[0].startedAt + saved[0].finishAt) / 2));
  await settle(win);
  await sleep(1100);
  await assertGeometry(win, `${label} half way`);
  await capture(win, directory, 'ten-half-way');

  await advanceRendererClockTo(win, Math.max(...saved.map((job) => job.finishAt)) + 1);
  await waitFor(win, `document.querySelector('[data-qa-recycling-collect-all="10"]')`);
  await assertGeometry(win, `${label} all ready`);
  await capture(win, directory, 'ten-ready');

  const before = await readSave(win);
  await click(win, '[data-qa-recycling-collect-all]');
  await waitFor(win, `document.querySelectorAll('[data-qa-recycling-job]').length === 0`);
  await waitForSavedJobs(win, 0);
  const after = await readSave(win);
  if (!(Number(after.metal) >= Number(before.metal))) throw new Error(`${label}: collect-all did not credit ${JSON.stringify({ before, after })}`);
  screen = await readScreen(win);
  if (!screen.startDisabled || !screen.validation.includes('Обломков нет')) throw new Error(`${label}: zero debris must say where debris comes from ${JSON.stringify(screen)}`);
  await assertGeometry(win, `${label} no debris`);
  await capture(win, directory, 'no-debris');

  await seedWorstCase(win, 1, 200_000_000);
  screen = await readScreen(win);
  if (screen.maxJobs !== 1 || screen.lockedSlots !== 9 || screen.startCount !== 1 || screen.startText !== 'Запустить 1 процесс') throw new Error(`${label}: level 1 has one place ${JSON.stringify(screen)}`);
  await assertGeometry(win, `${label} level 1`);
  await capture(win, directory, 'level-1');

  // Numbers far past anything a campaign reaches must still fit their places.
  await seedWorstCase(win, 10, 987_654_321_098);
  await assertGeometry(win, `${label} huge debris`);
  await capture(win, directory, 'debris-huge');
  await click(win, '[data-qa-recycling-start]');
  await waitFor(win, `document.querySelectorAll('[data-qa-recycling-job]').length === 10`);
  await assertGeometry(win, `${label} huge running`);
  await capture(win, directory, 'huge-running');

  await seedPartlyReady(win);
  await waitFor(win, `document.querySelector('[data-qa-recycling-collect-all="4"]')`);
  await assertGeometry(win, `${label} partly ready`);
  await capture(win, directory, 'partly-ready');

  await verifyNotBuilt(win, directory, label);
}

// Four ready, three running, three free, and debris left to start them.
async function seedPartlyReady(win) {
  await rendererMutationAndReload(win, `(() => {
    const raw = localStorage.getItem(${JSON.stringify(SAVE_KEY)});
    const save = raw ? JSON.parse(raw) : null;
    const planet = save?.planets?.['helion-01'];
    if (!planet?.buildings) return false;
    const now = Date.now();
    const allocation = { metal: 50, minerals: 30, gas: 20 };
    const job = (id, startedAt, finishAt) => ({
      id, debrisAmount: 10000000, allocationPercent: allocation, efficiencyPercent: 120,
      output: { metal: 6000000, minerals: 3600000, gas: 2400000 },
      startedAt, finishAt, collectExpiresAt: finishAt + 86400000, status: finishAt <= now ? 'ready' : 'processing',
    });
    planet.buildings.recycling = 10;
    planet.recycling = { availableDebris: 45000000, jobs: [
      ...[0, 1, 2, 3].map((index) => job('ready-' + index, now - 7200000, now - 600000 * (index + 1))),
      ...[0, 1, 2].map((index) => job('running-' + index, now - 1800000, now + 1800000 * (index + 1))),
    ] };
    save.resourceClock = { lastReconciledAt: now, remainder: { metal: 0, minerals: 0, gas: 0, energy: 0 } };
    localStorage.setItem(${JSON.stringify(SAVE_KEY)}, JSON.stringify(save));
    localStorage.setItem(${JSON.stringify(TEST_TIME_SCALE_KEY)}, '1');
    return true;
  })()`, 'Could not seed the partly ready case');
  await activateIndustry(win);
  await openCenter(win);
}

// A building that is not built has no inside: its card offers to build it and no way in.
async function verifyNotBuilt(win, directory, label) {
  await rendererMutationAndReload(win, `(() => {
    const raw = localStorage.getItem(${JSON.stringify(SAVE_KEY)});
    const save = raw ? JSON.parse(raw) : null;
    const planet = save?.planets?.['helion-01'];
    if (!planet?.buildings) return false;
    planet.buildings.recycling = 0;
    planet.recycling = { availableDebris: 5000000, jobs: [] };
    localStorage.setItem(${JSON.stringify(SAVE_KEY)}, JSON.stringify(save));
    return true;
  })()`, 'Could not seed the building that is not built');
  await activateIndustry(win);
  await click(win, '[data-zone-building-role="recycling"]');
  await waitFor(win, `document.querySelector('[data-qa-building-dialog="recycling"]')`);
  const canEnter = await win.webContents.executeJavaScript(`Boolean(document.querySelector('[data-qa-enter-building="recycling"]'))`);
  if (canEnter) throw new Error(`${label}: a building that is not built must have no way in`);
  await capture(win, directory, 'not-built');
}

async function waitForSavedJobs(win, count) {
  await waitFor(win, `(() => {
    const save = JSON.parse(localStorage.getItem(${JSON.stringify(SAVE_KEY)}) || '{}');
    return save.planets?.['helion-01']?.recycling?.jobs?.length === ${count};
  })()`);
  return (await readSave(win)).recycling.jobs;
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
    await win.loadFile(path.join(ROOT, 'dist', 'index.html'), { search: '?mode=test' });
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
      await verifyWorstCases(win, label);
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
