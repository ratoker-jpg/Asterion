const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-gpu');
app.on('window-all-closed', () => {});

const ROOT = path.join(__dirname, '..');
const OUTPUT = path.join(ROOT, 'visual-qa', 'building-actions-run');
const SAVE_KEY = 'asterion.vertical-slice.test.v1';
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
  await sleep(80);
}

async function reload(win) {
  const done = new Promise((resolve) => win.webContents.once('did-finish-load', resolve));
  win.webContents.reload();
  await done;
  await waitFor(win, `document.querySelector('.utility-navigation')`);
  await win.webContents.executeJavaScript('document.fonts?.ready');
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

async function seed(win, buildings) {
  const ok = await win.webContents.executeJavaScript(`(() => {
    const raw = localStorage.getItem(${JSON.stringify(SAVE_KEY)});
    const save = raw ? JSON.parse(raw) : null;
    const planet = save?.planets?.['helion-01'];
    if (!planet?.buildings) return false;
    planet.buildings = { ...planet.buildings, ...${JSON.stringify(buildings)} };
    planet.energy = 999999999;
    planet.productionBots = { metal: 0, minerals: 0, gas: 0 };
    save.metal = 999999999;
    save.minerals = 999999999;
    save.gas = 999999999;
    save.queues = { 'helion-01': [] };
    save.schemaVersion = Math.max(Number(save.schemaVersion) || 0, 10);
    localStorage.setItem(${JSON.stringify(SAVE_KEY)}, JSON.stringify(save));
    localStorage.setItem('asterion.test-time-scale.v1', '1');
    return true;
  })()`);
  if (!ok) throw new Error('Could not seed building action scenario');
  await reload(win);
}

async function activateZone(win, zone) {
  await click(win, `.header-zone--${zone}`);
  await waitFor(win, `document.querySelector('[data-qa-zone-view][data-zone=${JSON.stringify(zone)}]')`);
}

async function openBuilding(win, role) {
  await click(win, `[data-zone-building-role="${role}"]`);
  await waitFor(win, `document.querySelector('[data-qa-building-dialog=${JSON.stringify(role)}]')`);
}

async function closeDialog(win) {
  await click(win, '.resource-building-dialog-close');
  await waitFor(win, `!document.querySelector('[data-qa-building-dialog]')`);
}

async function buildCurrent(win, role) {
  await openBuilding(win, role);
  await click(win, '[data-qa-build-button]');
  await waitFor(win, `!document.querySelector('[data-qa-building-dialog]')`);
}

async function confirm(win) {
  await waitFor(win, `document.querySelector('[data-qa-action-confirm]')`);
  const text = await win.webContents.executeJavaScript(`document.querySelector('[data-qa-action-confirm]')?.textContent?.replace(/\\s+/g, ' ').trim() ?? ''`);
  await click(win, '[data-qa-action-confirm-yes]');
  return text;
}

async function verifyDependentQueueCancellation(win, directory) {
  await seed(win, { construction: 1 });
  await activateZone(win, 'industry');
  await buildCurrent(win, 'construction');
  await buildCurrent(win, 'construction');
  await buildCurrent(win, 'construction');

  const before = await win.webContents.executeJavaScript(`(() => {
    const save = JSON.parse(localStorage.getItem(${JSON.stringify(SAVE_KEY)}) || '{}');
    return {
      queue: save.queues?.['helion-01'] ?? [],
      wallet: { metal: save.metal, minerals: save.minerals, gas: save.gas, energy: save.planets?.['helion-01']?.energy ?? 0 },
      labels: Array.from(document.querySelectorAll('[data-qa-queue-role] button[aria-label]')).map((node) => node.getAttribute('aria-label')),
    };
  })()`);
  if (before.queue.length !== 3 || before.queue.map((item) => item.targetLevel).join(',') !== '2,3,4' || before.labels.some((label) => !/уровень [234]$/i.test(label ?? ''))) {
    throw new Error(`Dependent building queue was not sequential: ${JSON.stringify(before)}`);
  }
  await capture(win, directory, 'queue-dependent-chain');

  await click(win, '[data-qa-queue-cancel="1"]');
  const confirmation = await confirm(win);
  if (!confirmation.includes('90%')) throw new Error(`Dependent queue confirmation is incomplete: ${confirmation}`);
  await waitFor(win, `document.querySelectorAll('[data-qa-queue-role]').length === 0`);
  const after = await win.webContents.executeJavaScript(`(() => {
    const save = JSON.parse(localStorage.getItem(${JSON.stringify(SAVE_KEY)}) || '{}');
    const queue = save.queues?.['helion-01'] ?? [];
    const wallet = { metal: save.metal, minerals: save.minerals, gas: save.gas, energy: save.planets?.['helion-01']?.energy ?? 0 };
    const refund = Object.fromEntries(['metal', 'minerals', 'gas'].map((key) => [key, wallet[key] - ${JSON.stringify(before.wallet)}[key]]));
    const expected = ${JSON.stringify(before.queue)}.reduce((total, item) => {
      for (const key of ['metal', 'minerals', 'gas', 'energy']) {
        if (key === 'energy') continue;
        total[key] += Math.floor((item.cost?.[key] ?? 0) * 0.9);
      }
      return total;
    }, { metal: 0, minerals: 0, gas: 0 });
    return {
      queue,
      refund,
      expected,
      notice: document.querySelector('.shell-notice span')?.textContent?.trim() ?? '',
      queueHeader: document.querySelector('.resource-zone-queue .resource-zone-panel-title > span')?.textContent?.trim() ?? '',
    };
  })()`);
  if (after.queue.length !== 0 || JSON.stringify(after.refund) !== JSON.stringify(after.expected) || !after.notice.includes('Каскадно отменено ещё 2 зависимых проектов') || after.queueHeader !== '0 / 3') {
    throw new Error(`Dependent building cancellation mismatch: ${JSON.stringify({ before, after })}`);
  }
  await capture(win, directory, 'queue-dependent-cancelled');
  return { before, after, confirmation };
}

async function verifyQueueCancellation(win, directory) {
  await seed(win, { 'metal-production-1': 20, construction: 1, shipyard: 1 });
  await activateZone(win, 'resource');
  await buildCurrent(win, 'metal-production-1');
  await activateZone(win, 'industry');
  await buildCurrent(win, 'construction');
  await activateZone(win, 'military');
  await buildCurrent(win, 'shipyard');

  const initial = await win.webContents.executeJavaScript(`(() => ({
    cancelButtons: document.querySelectorAll('[data-qa-queue-cancel]').length,
    roles: Array.from(document.querySelectorAll('[data-qa-queue-role]')).map((node) => node.getAttribute('data-qa-queue-role')),
  }))()`);
  if (initial.cancelButtons !== 3 || initial.roles.join(',') !== 'metal-production-1,construction,shipyard') {
    throw new Error(`Queue cancel controls missing: ${JSON.stringify(initial)}`);
  }
  await capture(win, directory, 'queue-cancel-controls');

  await click(win, '[data-qa-queue-cancel="2"]');
  await capture(win, directory, 'queue-cancel-confirm');
  const cancelText = await confirm(win);
  if (!cancelText.includes('90%') || (!cancelText.includes('Промышленный комплекс') && !cancelText.includes('Фабрика'))) {
    throw new Error(`Queue cancel confirmation is incomplete: ${cancelText}`);
  }
  await waitFor(win, `document.querySelectorAll('[data-qa-queue-cancel]').length === 2`);
  const afterMiddle = await win.webContents.executeJavaScript(`Array.from(document.querySelectorAll('[data-qa-queue-role]')).map((node) => node.getAttribute('data-qa-queue-role')).join(',')`);
  if (afterMiddle !== 'metal-production-1,shipyard') throw new Error(`Middle queue cancellation mismatch: ${afterMiddle}`);

  await click(win, '[data-qa-queue-cancel="2"]');
  await confirm(win);
  await waitFor(win, `document.querySelectorAll('[data-qa-queue-cancel]').length === 1`);
  await click(win, '[data-qa-queue-cancel="1"]');
  await confirm(win);
  await waitFor(win, `document.querySelectorAll('[data-qa-queue-cancel]').length === 0`);
  const finalQueue = await win.webContents.executeJavaScript(`(() => ({
    queueCount: document.querySelectorAll('[data-qa-queue-role]').length,
    queueHeader: document.querySelector('.resource-zone-queue .resource-zone-panel-title > span')?.textContent?.trim() ?? '',
  }))()`);
  if (finalQueue.queueCount !== 0 || finalQueue.queueHeader !== '0 / 3') throw new Error(`Queue did not empty: ${JSON.stringify(finalQueue)}`);
  await capture(win, directory, 'queue-cancelled-all-slots');
  return { initial, afterMiddle, finalQueue, confirmation: cancelText };
}

async function verifyDestroy(win, directory) {
  await seed(win, { construction: 1 });
  await activateZone(win, 'industry');
  await openBuilding(win, 'construction');
  const enabled = await win.webContents.executeJavaScript(`(() => {
    const button = document.querySelector('[data-qa-destroy-building]');
    return { exists: Boolean(button), disabled: Boolean(button?.disabled) };
  })()`);
  if (!enabled.exists || enabled.disabled) throw new Error(`Destroy button should be enabled: ${JSON.stringify(enabled)}`);

  await click(win, '[data-qa-destroy-building]');
  const destroyText = await win.webContents.executeJavaScript(`document.querySelector('[data-qa-action-confirm]')?.textContent?.replace(/\\s+/g, ' ').trim() ?? ''`);
  if (!destroyText.includes('50–80%') || !destroyText.includes('разрушить')) throw new Error(`Destroy confirmation is incomplete: ${destroyText}`);
  await capture(win, directory, 'destroy-level-confirm');
  await click(win, '[data-qa-action-confirm-yes]');
  await waitFor(win, `document.querySelector('[data-qa-building-dialog="construction"]')`);
  const afterDestroy = await win.webContents.executeJavaScript(`(() => ({
    current: document.querySelector('.resource-building-level--current strong')?.textContent?.trim() ?? '',
    hasDestroy: Boolean(document.querySelector('[data-qa-destroy-building]')),
    storedLevel: JSON.parse(localStorage.getItem(${JSON.stringify(SAVE_KEY)}) || '{}')?.planets?.['helion-01']?.buildings?.construction ?? -1,
  }))()`);
  if (afterDestroy.current !== '0' || afterDestroy.hasDestroy || afterDestroy.storedLevel !== 0) {
    throw new Error(`Destroy 1→0 contract failed: ${JSON.stringify(afterDestroy)}`);
  }
  await closeDialog(win);

  await seed(win, { construction: 1 });
  await activateZone(win, 'industry');
  await buildCurrent(win, 'construction');
  await openBuilding(win, 'construction');
  const blocked = await win.webContents.executeJavaScript(`(() => {
    const button = document.querySelector('[data-qa-destroy-building]');
    return { exists: Boolean(button), disabled: Boolean(button?.disabled), title: button?.getAttribute('title') ?? '' };
  })()`);
  if (!blocked.exists || !blocked.disabled || !blocked.title.includes('строительства')) {
    throw new Error(`Destroy should be disabled during construction: ${JSON.stringify(blocked)}`);
  }
  await capture(win, directory, 'destroy-level-disabled-during-queue');
  await closeDialog(win);
  return { enabled, destroyConfirmation: destroyText, afterDestroy, blocked };
}

async function runViewport(win, directory) {
  return {
    screen: 'building-actions',
    dependentQueue: await verifyDependentQueueCancellation(win, directory),
    queue: await verifyQueueCancellation(win, directory),
    destroy: await verifyDestroy(win, directory),
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
      webPreferences: { offscreen: true, contextIsolation: true, nodeIntegration: false, sandbox: true, partition: 'qa-building-actions' },
    });
    await win.loadFile(path.join(ROOT, 'dist', 'index.html'), { search: '?mode=test' });
    win.webContents.debugger.attach('1.3');
    for (const [width, height] of VIEWPORTS) {
      const label = `${width}x${height}`;
      const directory = path.join(OUTPUT, label);
      fs.mkdirSync(directory, { recursive: true });
      await win.webContents.debugger.sendCommand('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false, screenWidth: width, screenHeight: height });
      await settle(win);
      fs.writeFileSync(path.join(directory, 'building-actions-metrics.json'), JSON.stringify(await runViewport(win, directory), null, 2));
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
