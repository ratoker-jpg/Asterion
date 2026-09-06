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
const REFILL_MS = 15 * 60 * 1000;
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
  await sleep(110);
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

async function setInput(win, selector, value) {
  const changed = await win.webContents.executeJavaScript(`(() => {
    const input = document.querySelector(${JSON.stringify(selector)});
    if (!(input instanceof HTMLInputElement)) return false;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    setter?.call(input, ${JSON.stringify(String(value))});
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  })()`);
  if (!changed) throw new Error(`Input not found: ${selector}`);
  await settle(win);
}

async function hover(win, selector) {
  const point = await win.webContents.executeJavaScript(`(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    if (!element) return null;
    const rect = element.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  })()`);
  if (!point) throw new Error(`Hover target not found: ${selector}`);
  await win.webContents.debugger.sendCommand('Input.dispatchMouseEvent', { type: 'mouseMoved', x: point.x, y: point.y });
  await settle(win);
}

async function capture(win, directory, name) {
  await settle(win);
  const result = await win.webContents.debugger.sendCommand('Page.captureScreenshot', {
    format: 'png',
    fromSurface: true,
    captureBeyondViewport: false,
  });
  fs.writeFileSync(path.join(directory, `${name}.png`), Buffer.from(result.data, 'base64'));
}

async function seedTradeCenter(win) {
  const ok = await win.webContents.executeJavaScript(`(() => {
    const save = JSON.parse(localStorage.getItem(${JSON.stringify(SAVE_KEY)}) || 'null');
    const planet = save?.planets?.['helion-01'];
    if (!planet?.buildings || !planet?.recycling) return false;
    planet.buildings['trade-center'] = 1;
    planet.trade = { refillAtQueue: [] };
    planet.recycling.availableDebris = 100000;
    save.rating = { resourcePoints: 855880 };
    save.metal = 15880;
    save.minerals = 12712;
    save.gas = 6421;
    save.schemaVersion = Math.max(Number(save.schemaVersion) || 0, 7);
    localStorage.setItem(${JSON.stringify(SAVE_KEY)}, JSON.stringify(save));
    return true;
  })()`);
  if (!ok) throw new Error('Could not seed Trade Center state');
  await reload(win);
}

async function activateIndustry(win) {
  await click(win, '.header-zone--industry');
  await waitFor(win, `document.querySelector('[data-qa-zone-view][data-zone="industry"]')`);
}

async function openTradeCenter(win) {
  await click(win, '[data-zone-building-role="trade-center"]');
  await waitFor(win, `document.querySelector('[data-qa-building-dialog="trade-center"]')`);
  await click(win, '[data-qa-enter-building="trade-center"]');
  await waitFor(win, `document.querySelector('[data-qa-trade-center]')`);
  await settle(win);
}

async function readScreen(win) {
  return win.webContents.executeJavaScript(`(() => {
    const root = document.querySelector('[data-qa-trade-center]');
    if (!root) return null;
    const text = (selector) => root.querySelector(selector)?.textContent?.replace(/\\s+/g, ' ').trim() ?? '';
    const attr = (selector, name) => root.querySelector(selector)?.getAttribute(name) ?? null;
    const input = root.querySelector('[data-qa-trade-amount-input]');
    const slider = root.querySelector('[data-qa-trade-amount-slider]');
    return {
      level: Number(attr('[data-qa-trade-level]', 'data-qa-trade-level')),
      limit: Number(attr('[data-qa-trade-limit]', 'data-qa-trade-limit')),
      rating: Number(attr('[data-qa-trade-rating]', 'data-qa-trade-rating')),
      slots: attr('[data-qa-trade-slots]', 'data-qa-trade-slots'),
      queueCount: Number(attr('[data-qa-trade-refill-queue]', 'data-qa-trade-refill-queue')) || 0,
      queueSegments: root.querySelectorAll('[data-qa-trade-refill-segment]').length,
      nextRefill: text('[data-qa-trade-next-refill]'),
      fullRefill: text('[data-qa-trade-full-refill]'),
      allAvailable: Boolean(root.querySelector('[data-qa-trade-all-available]')),
      source: Array.from(root.querySelectorAll('[data-qa-trade-source]')).find((item) => item.getAttribute('data-qa-trade-selected') === 'true')?.getAttribute('data-qa-trade-source') ?? null,
      target: Array.from(root.querySelectorAll('[data-qa-trade-target]')).find((item) => item.getAttribute('data-qa-trade-selected') === 'true')?.getAttribute('data-qa-trade-target') ?? null,
      metalTargetDisabled: Boolean(root.querySelector('[data-qa-trade-target="metal"]')?.disabled),
      debrisTargetExists: Boolean(root.querySelector('[data-qa-trade-target="debris"]')),
      rate: text('[data-qa-trade-rate]'),
      validation: text('[data-qa-trade-validation]'),
      submitDisabled: Boolean(root.querySelector('[data-qa-trade-submit]')?.disabled),
      amount: input instanceof HTMLInputElement ? Number(input.value) : null,
      slider: slider instanceof HTMLInputElement ? Number(slider.value) : null,
      send: Number(attr('[data-qa-trade-send]', 'data-qa-trade-send')),
      receive: Number(attr('[data-qa-trade-receive]', 'data-qa-trade-receive')),
      toast: text('[data-qa-trade-toast]'),
    };
  })()`);
}

async function readSave(win) {
  return win.webContents.executeJavaScript(`(() => {
    const save = JSON.parse(localStorage.getItem(${JSON.stringify(SAVE_KEY)}) || '{}');
    const planet = save.planets?.['helion-01'];
    return {
      schemaVersion: save.schemaVersion,
      metal: save.metal,
      minerals: save.minerals,
      gas: save.gas,
      debris: planet?.recycling?.availableDebris,
      trade: planet?.trade,
      tradeLevel: planet?.buildings?.['trade-center'],
      rating: save.rating?.resourcePoints,
      buildingQueue: save.queues?.['helion-01'] ?? [],
      recyclingJobs: planet?.recycling?.jobs ?? [],
    };
  })()`);
}

async function measure(win) {
  return win.webContents.executeJavaScript(`(() => {
    const root = document.querySelector('[data-qa-trade-center]');
    if (!root) return null;
    const pick = (element) => {
      if (!element) return null;
      const rect = element.getBoundingClientRect();
      return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height };
    };
    return {
      viewport: { width: window.innerWidth, height: window.innerHeight },
      document: { width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight },
      root: pick(root),
      info: pick(root.querySelector('.trade-info-panel')),
      workspace: pick(root.querySelector('.trade-workspace')),
      flow: pick(root.querySelector('.trade-flow')),
      sourceCards: Array.from(root.querySelectorAll('[data-qa-trade-source]')).map(pick),
      targetCards: Array.from(root.querySelectorAll('[data-qa-trade-target]')).map(pick),
      input: pick(root.querySelector('[data-qa-trade-amount-input]')),
      slider: pick(root.querySelector('[data-qa-trade-amount-slider]')),
      minus: pick(root.querySelector('[data-qa-trade-minus]')),
      plus: pick(root.querySelector('[data-qa-trade-plus]')),
      max: pick(root.querySelector('[data-qa-trade-max]')),
      submit: pick(root.querySelector('[data-qa-trade-submit]')),
    };
  })()`);
}

function assertGeometry(snapshot, label) {
  if (!snapshot) throw new Error(`${label}: missing Trade Center geometry`);
  const epsilon = 2;
  const { viewport, document, root, info, workspace, flow, sourceCards, targetCards, input, slider, minus, plus, max, submit } = snapshot;
  if (document.width > viewport.width + epsilon) throw new Error(`${label}: horizontal page overflow ${JSON.stringify(snapshot)}`);
  if (root.left < -epsilon || root.right > viewport.width + epsilon || root.top < -epsilon) throw new Error(`${label}: Trade Center root clipped ${JSON.stringify(snapshot)}`);
  if (!info || !workspace || info.right > workspace.left + epsilon) throw new Error(`${label}: main columns overlap`);
  if (!flow || sourceCards.length !== 4 || targetCards.length !== 3) throw new Error(`${label}: resource flow incomplete`);
  for (const card of [...sourceCards, ...targetCards]) {
    if (!card || card.width < 75 || card.height < 55) throw new Error(`${label}: resource card unreadable ${JSON.stringify(card)}`);
  }
  if (!input || input.width < 85 || !slider || slider.width < 100 || !minus || minus.width < 25 || !plus || plus.width < 25 || !max || max.width < 45 || !submit || submit.width < 150) {
    throw new Error(`${label}: amount/action controls too small ${JSON.stringify(snapshot)}`);
  }
  if (minus.right > input.left + epsilon || input.right > slider.left + epsilon || slider.right > plus.left + epsilon || plus.right > max.left + epsilon) {
    throw new Error(`${label}: amount controls overlap ${JSON.stringify(snapshot)}`);
  }
}

async function assertTooltip(win, label, selector) {
  await hover(win, selector);
  const state = await win.webContents.executeJavaScript(`(() => {
    const card = document.querySelector(${JSON.stringify(selector)});
    const tip = card?.querySelector('[data-qa-trade-tooltip]');
    if (!tip) return null;
    const style = getComputedStyle(tip);
    const rect = tip.getBoundingClientRect();
    const panel = card.closest('.trade-resource-panel')?.getBoundingClientRect();
    return {
      opacity: Number(style.opacity),
      visibility: style.visibility,
      rect: { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom },
      panel: panel ? { left: panel.left, top: panel.top, right: panel.right, bottom: panel.bottom } : null,
      viewport: { width: innerWidth, height: innerHeight },
    };
  })()`);
  if (!state || state.opacity < 0.9 || state.visibility !== 'visible') throw new Error(`${label}: tooltip not visible ${JSON.stringify(state)}`);
  if (state.rect.left < 0 || state.rect.right > state.viewport.width || state.rect.top < 0 || state.rect.bottom > state.viewport.height) throw new Error(`${label}: tooltip clipped by viewport ${JSON.stringify(state)}`);
  if (state.panel && state.rect.top < state.panel.top && state.rect.bottom <= state.panel.top) {
    // Expected: tooltip may sit above the card, but it must remain visible because the panel uses overflow: visible.
  }
}

async function setRefillQueueForOfflineStep(win, offsets) {
  const ok = await win.webContents.executeJavaScript(`(() => {
    const save = JSON.parse(localStorage.getItem(${JSON.stringify(SAVE_KEY)}) || '{}');
    const planet = save.planets?.['helion-01'];
    if (!planet?.trade) return false;
    const base = Date.now();
    planet.trade.refillAtQueue = ${JSON.stringify(offsets)}.map((offset) => base + offset);
    localStorage.setItem(${JSON.stringify(SAVE_KEY)}, JSON.stringify(save));
    return true;
  })()`);
  if (!ok) throw new Error('Could not rewrite trade refill queue');
  await reload(win);
  await activateIndustry(win);
  await openTradeCenter(win);
}

async function verifyReturn(win) {
  await click(win, '[data-qa-trade-back]');
  await waitFor(win, `document.querySelector('[data-qa-zone-view][data-zone="industry"]')`);
  await waitFor(win, `document.querySelector('[data-qa-building-dialog="trade-center"]')`);
  await click(win, '[data-qa-enter-building="trade-center"]');
  await waitFor(win, `document.querySelector('[data-qa-trade-center]')`);
  await win.webContents.executeJavaScript(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))`);
  await settle(win);
  await waitFor(win, `document.querySelector('[data-qa-zone-view][data-zone="industry"]')`);
  await waitFor(win, `document.querySelector('[data-qa-building-dialog="trade-center"]')`);
}

async function verifyFlow(win, directory, label) {
  await win.webContents.executeJavaScript(`localStorage.removeItem(${JSON.stringify(SAVE_KEY)})`);
  await reload(win);
  await seedTradeCenter(win);
  const seeded = await readSave(win);
  if (Number(seeded.schemaVersion) < 7 || seeded.tradeLevel !== 1 || seeded.rating !== 855880) throw new Error(`${label}: seeded envelope mismatch ${JSON.stringify(seeded)}`);
  const buildingQueueBefore = JSON.stringify(seeded.buildingQueue);
  const recyclingJobsBefore = JSON.stringify(seeded.recyclingJobs);

  await activateIndustry(win);
  await openTradeCenter(win);
  let screen = await readScreen(win);
  if (!screen || screen.level !== 1 || screen.limit !== 8558800 || screen.rating !== 855880 || screen.slots !== '3/3' || !screen.allAvailable) throw new Error(`${label}: initial Trade Center state mismatch ${JSON.stringify(screen)}`);
  if (screen.source !== 'metal' || screen.target !== 'minerals' || !screen.metalTargetDisabled || screen.debrisTargetExists || screen.rate !== '1 : 1') throw new Error(`${label}: initial pair/target rules mismatch ${JSON.stringify(screen)}`);
  assertGeometry(await measure(win), label);
  await capture(win, directory, 'trade-standard');

  await click(win, '[data-qa-trade-source="debris"]');
  await click(win, '[data-qa-trade-target="gas"]');
  screen = await readScreen(win);
  if (screen?.source !== 'debris' || screen.target !== 'gas' || screen.rate !== '1 : 0,6') throw new Error(`${label}: debris pair mismatch ${JSON.stringify(screen)}`);
  await assertTooltip(win, label, '[data-qa-trade-source="debris"]');
  await capture(win, directory, 'trade-pair-tooltip');

  await click(win, '[data-qa-trade-source="metal"]');
  await click(win, '[data-qa-trade-target="minerals"]');
  await setInput(win, '[data-qa-trade-amount-input]', 500);
  screen = await readScreen(win);
  if (screen?.amount !== 500 || screen.slider !== 500 || screen.send !== 500 || screen.receive !== 500) throw new Error(`${label}: numeric input not synchronized ${JSON.stringify(screen)}`);
  await click(win, '[data-qa-trade-plus]');
  if ((await readScreen(win))?.amount !== 501) throw new Error(`${label}: plus control not synchronized`);
  await click(win, '[data-qa-trade-minus]');
  if ((await readScreen(win))?.amount !== 500) throw new Error(`${label}: minus control not synchronized`);
  await setInput(win, '[data-qa-trade-amount-slider]', 750);
  if ((await readScreen(win))?.amount !== 750) throw new Error(`${label}: range not synchronized`);
  await click(win, '[data-qa-trade-max]');
  if ((await readScreen(win))?.amount !== 15880) throw new Error(`${label}: MAX did not use min(balance, trade limit)`);

  await setInput(win, '[data-qa-trade-amount-input]', 1000);
  screen = await readScreen(win);
  if (screen?.submitDisabled || screen.receive !== 1000) throw new Error(`${label}: base 1:1 trade should be valid ${JSON.stringify(screen)}`);
  await click(win, '[data-qa-trade-submit]');
  await waitFor(win, `document.querySelector('[data-qa-trade-toast]')?.textContent?.includes('Обмен выполнен')`);
  screen = await readScreen(win);
  if (screen?.amount !== 0 || screen.source !== 'metal' || screen.target !== 'minerals' || screen.slots !== '2/3' || screen.queueCount !== 1 || screen.queueSegments !== 1) throw new Error(`${label}: first trade UI state mismatch ${JSON.stringify(screen)}`);
  let saved = await readSave(win);
  if (saved.metal !== 14880 || saved.minerals !== 13712 || saved.gas !== 6421 || saved.debris !== 100000 || saved.trade?.refillAtQueue?.length !== 1) throw new Error(`${label}: first trade wallet/state mismatch ${JSON.stringify(saved)}`);
  if (JSON.stringify(saved.buildingQueue) !== buildingQueueBefore || JSON.stringify(saved.recyclingJobs) !== recyclingJobsBefore) throw new Error(`${label}: unrelated queues/jobs changed after base trade`);

  await click(win, '[data-qa-trade-source="debris"]');
  await click(win, '[data-qa-trade-target="gas"]');
  await setInput(win, '[data-qa-trade-amount-input]', 1001);
  screen = await readScreen(win);
  if (screen?.rate !== '1 : 0,6' || screen.receive !== 600 || screen.submitDisabled) throw new Error(`${label}: debris 0.6 preview mismatch ${JSON.stringify(screen)}`);
  await click(win, '[data-qa-trade-submit]');
  await waitFor(win, `document.querySelector('[data-qa-trade-slots]')?.getAttribute('data-qa-trade-slots') === '1/3'`);
  screen = await readScreen(win);
  if (screen?.queueCount !== 2 || screen.queueSegments !== 2 || !screen.nextRefill.includes('+1 через') || !screen.fullRefill) throw new Error(`${label}: sequential refill UI missing ${JSON.stringify(screen)}`);
  saved = await readSave(win);
  if (saved.metal !== 14880 || saved.minerals !== 13712 || saved.gas !== 7021 || saved.debris !== 98999) throw new Error(`${label}: debris exchange wallet mismatch ${JSON.stringify(saved)}`);
  if (saved.trade.refillAtQueue.length !== 2 || saved.trade.refillAtQueue[1] - saved.trade.refillAtQueue[0] !== REFILL_MS) throw new Error(`${label}: two-slot refill queue is not sequential ${JSON.stringify(saved.trade)}`);
  await capture(win, directory, 'trade-success-slots');

  await click(win, '[data-qa-trade-source="minerals"]');
  await click(win, '[data-qa-trade-target="metal"]');
  await setInput(win, '[data-qa-trade-amount-input]', 500);
  await click(win, '[data-qa-trade-submit]');
  await waitFor(win, `document.querySelector('[data-qa-trade-slots]')?.getAttribute('data-qa-trade-slots') === '0/3'`);
  screen = await readScreen(win);
  if (screen?.queueCount !== 3 || screen.queueSegments !== 3 || screen.validation !== 'Нет доступных сделок' || !screen.submitDisabled) throw new Error(`${label}: no-slot state mismatch ${JSON.stringify(screen)}`);
  saved = await readSave(win);
  if (saved.metal !== 15380 || saved.minerals !== 13212 || saved.gas !== 7021 || saved.debris !== 98999) throw new Error(`${label}: third trade wallet mismatch ${JSON.stringify(saved)}`);
  if (saved.trade.refillAtQueue.length !== 3 || saved.trade.refillAtQueue[1] - saved.trade.refillAtQueue[0] !== REFILL_MS || saved.trade.refillAtQueue[2] - saved.trade.refillAtQueue[1] !== REFILL_MS) throw new Error(`${label}: three-slot FIFO refill mismatch ${JSON.stringify(saved.trade)}`);

  await reload(win);
  await activateIndustry(win);
  await openTradeCenter(win);
  screen = await readScreen(win);
  if (screen?.slots !== '0/3' || screen.queueCount !== 3) throw new Error(`${label}: spent slots did not persist reload ${JSON.stringify(screen)}`);

  await setRefillQueueForOfflineStep(win, [-1000, REFILL_MS, REFILL_MS * 2]);
  screen = await readScreen(win);
  if (screen?.slots !== '1/3' || screen.queueCount !== 2 || screen.queueSegments !== 2) throw new Error(`${label}: first offline refill not reconciled ${JSON.stringify(screen)}`);
  await setRefillQueueForOfflineStep(win, [-1000, REFILL_MS]);
  screen = await readScreen(win);
  if (screen?.slots !== '2/3' || screen.queueCount !== 1) throw new Error(`${label}: second offline refill not reconciled ${JSON.stringify(screen)}`);
  await setRefillQueueForOfflineStep(win, [-1000]);
  screen = await readScreen(win);
  if (screen?.slots !== '3/3' || !screen.allAvailable || screen.queueCount !== 0) throw new Error(`${label}: full offline refill not reconciled ${JSON.stringify(screen)}`);
  const afterOffline = await readSave(win);
  if (afterOffline.metal !== 15380 || afterOffline.minerals !== 13212 || afterOffline.gas !== 7021 || afterOffline.debris !== 98999) throw new Error(`${label}: offline refill changed wallet ${JSON.stringify(afterOffline)}`);

  assertGeometry(await measure(win), label);
  await verifyReturn(win);
  return {
    viewport: label,
    screenshots: ['trade-standard.png', 'trade-pair-tooltip.png', 'trade-success-slots.png'],
    finalWallet: { metal: afterOffline.metal, minerals: afterOffline.minerals, gas: afterOffline.gas, debris: afterOffline.debris },
    verified: [
      'level-one-entry-and-back-escape',
      'rating-855880-drives-limit-8558800',
      'source-target-selection-and-disabled-same-resource',
      'no-debris-target',
      'hover-tooltip-visible-and-not-clipped',
      'numeric-slider-minus-plus-max-synchronized',
      'base-resource-one-to-one-trade',
      'debris-to-base-floor-0.6-trade',
      'atomic-wallet-and-slot-update',
      'sequential-15-minute-refill-queue',
      'spent-slots-persist-reload',
      'offline-refill-reconciles-one-by-one',
      'no-double-wallet-change-during-refill',
      'building-fifo-and-recycling-jobs-unchanged',
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
        partition: 'qa-trade-center-functional',
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
      fs.writeFileSync(path.join(directory, 'trade-center-metrics.json'), JSON.stringify(result, null, 2));
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
