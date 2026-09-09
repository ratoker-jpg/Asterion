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
  if (!clicked) throw new Error(`Clickable element not found/enabled: ${selector}`);
  await settle(win);
}

async function setRange(win, resource, value) {
  const changed = await win.webContents.executeJavaScript(`(() => {
    const input = document.querySelector('[data-qa-bot-slider=${JSON.stringify(resource)}]');
    if (!(input instanceof HTMLInputElement)) return false;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    setter?.call(input, ${JSON.stringify(String(value))});
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  })()`);
  if (!changed) throw new Error(`Range not found: ${resource}`);
  await settle(win);
}

async function seedPlanet(win) {
  const ok = await win.webContents.executeJavaScript(`(() => {
    const raw = localStorage.getItem(${JSON.stringify(SAVE_KEY)});
    const save = raw ? JSON.parse(raw) : null;
    const planet = save?.planets?.['helion-01'];
    if (!planet?.buildings) return false;
    planet.buildings.construction = 10;
    planet.buildings['advanced-factory'] = 2;
    planet.buildings.shipyard = 1;
    planet.buildings.research = 1;
    planet.buildings['planetary-government'] = 1;
    planet.buildings.spaceport = 1;
    planet.productionBots = { metal: 0, minerals: 0, gas: 0 };
    save.schemaVersion = Math.max(Number(save.schemaVersion) || 0, 5);
    localStorage.setItem(${JSON.stringify(SAVE_KEY)}, JSON.stringify(save));
    return true;
  })()`);
  if (!ok) throw new Error('Could not seed production bot planet');
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

async function enterProductionBots(win, role) {
  await openBuilding(win, role);
  await click(win, `[data-qa-enter-building="${role}"]`);
  await waitFor(win, `document.querySelector('[data-qa-production-bots=${JSON.stringify(role)}]')`);
}

async function readAppliedSave(win) {
  return win.webContents.executeJavaScript(`(() => {
    const save = JSON.parse(localStorage.getItem(${JSON.stringify(SAVE_KEY)}) || '{}');
    return {
      schemaVersion: save.schemaVersion,
      buildings: save.planets?.['helion-01']?.buildings,
      productionBots: save.planets?.['helion-01']?.productionBots,
    };
  })()`);
}

async function readHeaderIncome(win) {
  return win.webContents.executeJavaScript(`(() => {
    const read = (kind) => document.querySelector('.resource-chip--' + kind + ' .resource-tooltip')?.textContent?.replace(/\\s+/g, ' ').trim() ?? '';
    return { metal: read('metal'), minerals: read('mineral'), gas: read('gas') };
  })()`);
}

async function readZoneIncome(win) {
  return win.webContents.executeJavaScript(`(() => {
    const read = (resource) => document.querySelector('[data-resource-income="' + resource + '"] strong')?.textContent?.replace(/\\s+/g, ' ').trim() ?? '';
    return { metal: read('metal'), minerals: read('minerals'), gas: read('gas') };
  })()`);
}

async function readBotScreen(win, role) {
  return win.webContents.executeJavaScript(`(() => {
    const root = document.querySelector('[data-qa-production-bots=${JSON.stringify(role)}]');
    if (!root) return null;
    const text = (selector) => root.querySelector(selector)?.textContent?.replace(/\\s+/g, ' ').trim() ?? '';
    const disabled = (selector) => Boolean(root.querySelector(selector)?.disabled);
    const numberAttr = (selector, attribute) => {
      const raw = root.querySelector(selector)?.getAttribute(attribute);
      return raw == null ? null : Number(raw);
    };
    return {
      available: numberAttr('[data-qa-bots-available]', 'data-qa-bots-available'),
      total: numberAttr('[data-qa-bots-draft-total]', 'data-qa-bots-draft-total'),
      free: numberAttr('[data-qa-bots-draft-free]', 'data-qa-bots-draft-free'),
      draft: {
        metal: text('[data-qa-bot-draft="metal"]'),
        minerals: text('[data-qa-bot-draft="minerals"]'),
        gas: text('[data-qa-bot-draft="gas"]'),
      },
      applied: {
        metal: text('[data-qa-bot-current-bonus="metal"]'),
        minerals: text('[data-qa-bot-current-bonus="minerals"]'),
        gas: text('[data-qa-bot-current-bonus="gas"]'),
      },
      effects: {
        metal: text('[data-qa-bot-draft-effect="metal"]'),
        minerals: text('[data-qa-bot-draft-effect="minerals"]'),
        gas: text('[data-qa-bot-draft-effect="gas"]'),
      },
      distributeDisabled: disabled('[data-qa-production-bots-distribute]'),
      plusMetalDisabled: disabled('[data-qa-bot-plus="metal"]'),
      minusMetalDisabled: disabled('[data-qa-bot-minus="metal"]'),
      toast: text('[data-qa-production-bots-toast]'),
    };
  })()`);
}

async function measure(win, role) {
  return win.webContents.executeJavaScript(`(() => {
    const root = document.querySelector('[data-qa-production-bots=${JSON.stringify(role)}]');
    const stage = document.querySelector('.stage');
    if (!root || !stage) return null;
    const pick = (element) => {
      const rect = element.getBoundingClientRect();
      return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height };
    };
    const rows = Array.from(root.querySelectorAll('[data-qa-production-bot-resource]')).map((row) => ({
      row: pick(row),
      minus: pick(row.querySelector('[data-qa-bot-minus]')),
      slider: pick(row.querySelector('[data-qa-bot-slider]')),
      plus: pick(row.querySelector('[data-qa-bot-plus]')),
      count: pick(row.querySelector('[data-qa-bot-draft]')),
    }));
    return {
      viewport: { width: window.innerWidth, height: window.innerHeight },
      document: { width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight },
      stage: pick(stage),
      root: pick(root),
      rows,
    };
  })()`);
}

function assertGeometry(snapshot, label, role) {
  if (!snapshot) throw new Error(`${label}/${role}: missing geometry`);
  const epsilon = 2;
  const { viewport, document, stage, root, rows } = snapshot;
  if (document.width > viewport.width + epsilon) throw new Error(`${label}/${role}: horizontal scroll: ${JSON.stringify(snapshot)}`);
  if (Math.abs(stage.left) > epsilon || Math.abs(stage.top) > epsilon || Math.abs(stage.right - viewport.width) > epsilon || Math.abs(stage.bottom - viewport.height) > epsilon) {
    throw new Error(`${label}/${role}: stage is not viewport aligned: ${JSON.stringify(snapshot)}`);
  }
  if (root.left < -epsilon || root.right > viewport.width + epsilon || root.top < -epsilon || root.bottom > viewport.height + epsilon) {
    throw new Error(`${label}/${role}: root clipped: ${JSON.stringify(snapshot)}`);
  }
  if (rows.length !== 3) throw new Error(`${label}/${role}: expected 3 rows: ${JSON.stringify(snapshot)}`);
  for (const item of rows) {
    if (item.row.left < root.left - epsilon || item.row.right > root.right + epsilon) throw new Error(`${label}/${role}: row overflow`);
    if (item.minus.width < 30 || item.plus.width < 30 || item.slider.width < 110 || item.count.width < 28) throw new Error(`${label}/${role}: controls too small: ${JSON.stringify(item)}`);
    if (item.minus.right > item.slider.left + epsilon || item.slider.right > item.plus.left + epsilon || item.plus.right > item.count.left + epsilon) {
      throw new Error(`${label}/${role}: controls overlap: ${JSON.stringify(item)}`);
    }
  }
}

async function verifyReturn(win, role, viaEscape = false) {
  if (viaEscape) {
    await win.webContents.executeJavaScript(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))`);
    await settle(win);
  } else {
    await click(win, '[data-qa-production-bots-back]');
  }
  await waitFor(win, `document.querySelector('[data-qa-zone-view][data-zone="industry"]')`);
  await waitFor(win, `document.querySelector('[data-qa-building-dialog=${JSON.stringify(role)}]')`);
}

async function verifyFlow(win, directory, label) {
  await win.webContents.executeJavaScript(`localStorage.removeItem(${JSON.stringify(SAVE_KEY)})`);
  await reload(win);
  await seedPlanet(win);

  await activateZone(win, 'resource');
  const incomeBefore = await readZoneIncome(win);
  if (JSON.stringify(incomeBefore) !== JSON.stringify({ metal: '150', minerals: '150', gas: '100' })) {
    throw new Error(`${label}: base income mismatch ${JSON.stringify(incomeBefore)}`);
  }

  await activateZone(win, 'industry');
  await enterProductionBots(win, 'construction');

  let screen = await readBotScreen(win, 'construction');
  if (!screen || screen.available !== 14 || screen.total !== 0 || screen.free !== 14) throw new Error(`${label}: initial pool mismatch ${JSON.stringify(screen)}`);
  if (JSON.stringify(screen.applied) !== JSON.stringify({ metal: '+0%', minerals: '+0%', gas: '+0%' })) throw new Error(`${label}: initial applied bonus mismatch ${JSON.stringify(screen)}`);
  if (!screen.distributeDisabled || !screen.minusMetalDisabled) throw new Error(`${label}: initial controls mismatch ${JSON.stringify(screen)}`);

  const beforeGeometry = await measure(win, 'construction');
  assertGeometry(beforeGeometry, label, 'construction');
  await capture(win, directory, 'production-bots-before');

  for (let index = 0; index < 6; index += 1) await click(win, '[data-qa-bot-plus="metal"]');
  await click(win, '[data-qa-bot-minus="metal"]');
  await click(win, '[data-qa-bot-plus="metal"]');
  await setRange(win, 'minerals', 4);

  screen = await readBotScreen(win, 'construction');
  if (JSON.stringify(screen?.draft) !== JSON.stringify({ metal: '6', minerals: '4', gas: '0' })) throw new Error(`${label}: draft mismatch ${JSON.stringify(screen)}`);
  if (screen.total !== 10 || screen.free !== 4 || screen.effects.metal !== '6 ботов · +36%' || screen.effects.minerals !== '4 бота · +20%') {
    throw new Error(`${label}: draft summary mismatch ${JSON.stringify(screen)}`);
  }
  if (screen.distributeDisabled) throw new Error(`${label}: distribute should be enabled`);
  if (JSON.stringify(screen.applied) !== JSON.stringify({ metal: '+0%', minerals: '+0%', gas: '+0%' })) throw new Error(`${label}: draft leaked into applied bonus`);

  const saveBeforeApply = await readAppliedSave(win);
  if (JSON.stringify(saveBeforeApply.productionBots) !== JSON.stringify({ metal: 0, minerals: 0, gas: 0 })) throw new Error(`${label}: draft mutated save before apply ${JSON.stringify(saveBeforeApply)}`);
  const headerBeforeApply = await readHeaderIncome(win);
  if (!headerBeforeApply.metal.includes('150/ч') || !headerBeforeApply.minerals.includes('150/ч') || !headerBeforeApply.gas.includes('100/ч')) {
    throw new Error(`${label}: draft changed header income ${JSON.stringify(headerBeforeApply)}`);
  }

  await click(win, '[data-qa-production-bots-distribute]');
  await waitFor(win, `document.querySelector('[data-qa-production-bots-toast]')?.textContent?.includes('Роботы перераспределены')`);
  screen = await readBotScreen(win, 'construction');
  if (JSON.stringify(screen?.applied) !== JSON.stringify({ metal: '+36%', minerals: '+20%', gas: '+0%' })) throw new Error(`${label}: applied bonus mismatch ${JSON.stringify(screen)}`);
  if (!screen.toast.includes('Роботы перераспределены')) throw new Error(`${label}: success toast missing`);

  const saveAfterApply = await readAppliedSave(win);
  if (Number(saveAfterApply.schemaVersion) < 5 || JSON.stringify(saveAfterApply.productionBots) !== JSON.stringify({ metal: 6, minerals: 4, gas: 0 })) {
    throw new Error(`${label}: applied save mismatch ${JSON.stringify(saveAfterApply)}`);
  }
  const headerAfterApply = await readHeaderIncome(win);
  if (!headerAfterApply.metal.includes('204/ч')) throw new Error(`${label}: metal header income not applied ${JSON.stringify(headerAfterApply)}`);
  if (!headerAfterApply.minerals.includes('180/ч')) throw new Error(`${label}: mineral header income not applied ${JSON.stringify(headerAfterApply)}`);

  const afterGeometry = await measure(win, 'construction');
  assertGeometry(afterGeometry, label, 'construction');
  await capture(win, directory, 'production-bots-after');

  await verifyReturn(win, 'construction');
  await click(win, '.resource-building-dialog-close');
  await enterProductionBots(win, 'advanced-factory');
  screen = await readBotScreen(win, 'advanced-factory');
  if (screen?.available !== 14 || JSON.stringify(screen.applied) !== JSON.stringify({ metal: '+36%', minerals: '+20%', gas: '+0%' })) {
    throw new Error(`${label}: shared assignment missing from advanced factory ${JSON.stringify(screen)}`);
  }
  assertGeometry(await measure(win, 'advanced-factory'), label, 'advanced-factory');
  await verifyReturn(win, 'advanced-factory', true);

  await reload(win);
  const reloadedSave = await readAppliedSave(win);
  if (JSON.stringify(reloadedSave.productionBots) !== JSON.stringify({ metal: 6, minerals: 4, gas: 0 })) throw new Error(`${label}: assignment lost after reload ${JSON.stringify(reloadedSave)}`);
  if (Number(reloadedSave.buildings?.['advanced-factory']) !== 2) throw new Error(`${label}: building level changed unexpectedly after reload`);

  await activateZone(win, 'resource');
  const incomeAfter = await readZoneIncome(win);
  if (incomeAfter.metal !== '204') throw new Error(`${label}: applied metal zone income mismatch ${JSON.stringify(incomeAfter)}`);
  if (incomeAfter.minerals !== '180' || incomeAfter.gas !== '100') throw new Error(`${label}: applied zone income mismatch ${JSON.stringify(incomeAfter)}`);

  return {
    viewport: label,
    applied: { metal: 6, minerals: 4, gas: 0 },
    incomeBefore,
    incomeAfter,
    beforeGeometry,
    afterGeometry,
    verified: [
      'draft-does-not-change-save-or-income',
      'plus-minus-controls',
      'range-slider-change',
      'atomic-distribute',
      'success-toast',
      'shared-factory-and-advanced-factory-assignment',
      'reload-persistence',
      'back-return-context',
      'escape-return-context',
      'no-horizontal-scroll-or-control-overlap',
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
        partition: 'qa-production-bots-functional',
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
      fs.writeFileSync(path.join(directory, 'production-bots-metrics.json'), JSON.stringify(result, null, 2));
    }

    win.webContents.debugger.detach();
    win.destroy();
    app.exit(0);
  } catch (error) {
    console.error(error);
    try {
      if (win?.webContents.debugger.isAttached()) win.webContents.debugger.detach();
    } catch {}
    win?.destroy();
    app.exit(1);
  }
});
