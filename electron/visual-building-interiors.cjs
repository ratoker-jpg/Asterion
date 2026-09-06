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
const BUILT_INTERIOR_ROLES = [
  'construction',
  'advanced-factory',
  'recycling',
  'trade-center',
  'shipyard',
  'research',
  'spaceport',
  'planetary-government',
  'bank',
];
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

async function setBuiltInteriorSave(win) {
  const ok = await win.webContents.executeJavaScript(`(() => {
    const raw = localStorage.getItem(${JSON.stringify(SAVE_KEY)});
    const save = raw ? JSON.parse(raw) : null;
    const planet = save?.planets?.['helion-01'];
    if (!planet?.buildings) return false;
    for (const role of ${JSON.stringify(BUILT_INTERIOR_ROLES)}) planet.buildings[role] = 1;
    planet.buildings.construction = 10;
    planet.buildings['advanced-factory'] = 2;
    planet.productionBots = { metal: 0, minerals: 0, gas: 0 };
    save.schemaVersion = Math.max(Number(save.schemaVersion) || 0, 5);
    localStorage.setItem(${JSON.stringify(SAVE_KEY)}, JSON.stringify(save));
    return true;
  })()`);
  if (!ok) throw new Error('Could not seed building interiors');
  await reload(win);
}

async function activateZone(win, zone) {
  await click(win, `.header-zone--${zone}`);
  await waitFor(win, `document.querySelector('[data-qa-zone-view][data-zone=${JSON.stringify(zone)}]')`);
}

async function openBuildingDialog(win, role) {
  await click(win, `[data-zone-building-role="${role}"]`);
  await waitFor(win, `document.querySelector('[data-qa-building-dialog=${JSON.stringify(role)}]')`);
  await waitFor(win, `document.querySelector('[data-qa-building-dialog=${JSON.stringify(role)}] [data-qa-enter-building=${JSON.stringify(role)}]')`);
}

async function enterBuilding(win, role) {
  await openBuildingDialog(win, role);
  await click(win, `[data-qa-enter-building="${role}"]`);
}

async function assertReturned(win, zone, role) {
  await waitFor(win, `document.querySelector('[data-qa-zone-view][data-zone=${JSON.stringify(zone)}]')`);
  await waitFor(win, `document.querySelector('[data-qa-building-dialog=${JSON.stringify(role)}]')`);
  const snapshot = await win.webContents.executeJavaScript(`(() => ({
    zone: document.querySelector('[data-qa-zone-view]')?.getAttribute('data-zone') ?? '',
    role: document.querySelector('[data-qa-building-dialog]')?.getAttribute('data-qa-building-dialog') ?? '',
    planet: document.querySelector('.current-planet-select strong')?.textContent?.replace(/\\s+/g, ' ').trim() ?? '',
  }))()`);
  if (snapshot.zone !== zone || snapshot.role !== role || !snapshot.planet.includes('Helion 01')) {
    throw new Error(`Return context mismatch: ${JSON.stringify(snapshot)}`);
  }
}

async function pressEscape(win) {
  await win.webContents.executeJavaScript(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))`);
  await settle(win);
}

async function closeDialog(win) {
  await click(win, '.resource-building-dialog-close');
  await waitFor(win, `!document.querySelector('[data-qa-building-dialog]')`);
}

async function verifyProductionHost(win, directory) {
  await activateZone(win, 'industry');

  await enterBuilding(win, 'construction');
  await waitFor(win, `document.querySelector('[data-qa-production-bots="construction"]')`);
  await capture(win, directory, 'building-interior-production-factory');
  await click(win, '[data-qa-production-bots-back]');
  await assertReturned(win, 'industry', 'construction');
  await closeDialog(win);

  await enterBuilding(win, 'advanced-factory');
  await waitFor(win, `document.querySelector('[data-qa-production-bots="advanced-factory"]')`);
  await pressEscape(win);
  await assertReturned(win, 'industry', 'advanced-factory');
  await closeDialog(win);
}

async function verifyMilitaryDeepLinks(win, directory) {
  await activateZone(win, 'military');

  await enterBuilding(win, 'shipyard');
  await waitFor(win, `document.querySelector('.primary-navigation button.active span')?.textContent?.trim() === 'Флоты'`);
  await waitFor(win, `document.querySelector('.fleet-main-v1--shipyard')`);
  await waitFor(win, `document.querySelector('[data-qa-building-interior-back]')`);
  await capture(win, directory, 'building-interior-fleet-from-shipyard');
  await pressEscape(win);
  await assertReturned(win, 'military', 'shipyard');
  await closeDialog(win);

  await enterBuilding(win, 'research');
  await waitFor(win, `document.querySelector('.science-view-v2')`);
  await waitFor(win, `document.querySelector('[data-qa-building-interior-back]')`);
  await click(win, '[data-qa-building-interior-back]');
  await assertReturned(win, 'military', 'research');
  await closeDialog(win);

  await enterBuilding(win, 'planetary-government');
  await waitFor(win, `document.querySelector('.command-view')`);
  await waitFor(win, `document.querySelector('[data-qa-building-interior-back]')`);
  await pressEscape(win);
  await assertReturned(win, 'military', 'planetary-government');
  await closeDialog(win);

  await enterBuilding(win, 'spaceport');
  await waitFor(win, `document.querySelector('[data-qa-building-interior-host="spaceport"]')`);
  const hostText = await win.webContents.executeJavaScript(`document.querySelector('[data-qa-building-interior-host="spaceport"]')?.textContent ?? ''`);
  if (!hostText.includes('Модуль будет доступен в следующем обновлении')) throw new Error(`Future host empty state missing: ${hostText}`);
  await click(win, '[data-qa-building-interior-back]');
  await assertReturned(win, 'military', 'spaceport');
}

async function verifyFlow(win, directory) {
  await win.webContents.executeJavaScript(`localStorage.removeItem(${JSON.stringify(SAVE_KEY)})`);
  await reload(win);
  await setBuiltInteriorSave(win);

  await verifyProductionHost(win, directory);
  await verifyMilitaryDeepLinks(win, directory);

  return {
    screen: 'building-interiors-navigation',
    verified: [
      'factory-enter-back-return',
      'advanced-factory-enter-escape-return',
      'shipyard-fleet-deep-link-escape-return',
      'research-science-deep-link-back-return',
      'government-command-deep-link-escape-return',
      'future-host-back-return',
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
        partition: 'qa-building-interiors',
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
      const result = await verifyFlow(win, directory);
      fs.writeFileSync(path.join(directory, 'building-interiors-metrics.json'), JSON.stringify(result, null, 2));
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
