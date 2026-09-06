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
const ROLES = ['construction', 'advanced-factory'];
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
  await settle(win);
}

async function click(win, selector) {
  const clicked = await win.webContents.executeJavaScript(`(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    if (!element) return false;
    element.click();
    return true;
  })()`);
  if (!clicked) throw new Error(`Element not found: ${selector}`);
  await settle(win);
}

async function seedBuiltBuildings(win) {
  const ok = await win.webContents.executeJavaScript(`(() => {
    const raw = localStorage.getItem(${JSON.stringify(SAVE_KEY)});
    const save = raw ? JSON.parse(raw) : null;
    const buildings = save?.planets?.['helion-01']?.buildings;
    if (!buildings) return false;
    buildings.construction = 1;
    buildings['advanced-factory'] = 1;
    localStorage.setItem(${JSON.stringify(SAVE_KEY)}, JSON.stringify(save));
    return true;
  })()`);
  if (!ok) throw new Error('Could not seed production buildings');
  await reload(win);
}

async function activateIndustry(win) {
  await click(win, '.header-zone--industry');
  await waitFor(win, `document.querySelector('[data-qa-zone-view][data-zone="industry"]')`);
}

async function openProductionBots(win, role) {
  await click(win, `[data-zone-building-role="${role}"]`);
  await waitFor(win, `document.querySelector('[data-qa-building-dialog="${role}"]')`);
  await click(win, `[data-qa-enter-building="${role}"]`);
  await waitFor(win, `document.querySelector('[data-qa-production-bots="${role}"]')`);
}

async function measure(win, role) {
  return win.webContents.executeJavaScript(`(() => {
    const root = document.querySelector('[data-qa-production-bots=${JSON.stringify(role)}]');
    const stage = document.querySelector('.stage');
    const workspace = document.querySelector('.workspace');
    if (!root || !stage || !workspace) return null;
    const pick = (element) => {
      const rect = element.getBoundingClientRect();
      return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height };
    };
    return {
      viewport: { width: window.innerWidth, height: window.innerHeight },
      document: { width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight },
      htmlClasses: document.documentElement.className,
      stage: pick(stage),
      workspace: pick(workspace),
      root: pick(root),
      cards: Array.from(root.querySelectorAll('[data-qa-production-bot-resource]')).map(pick),
    };
  })()`);
}

function assertFitsViewport(snapshot, label, role) {
  if (!snapshot) throw new Error(`${label}/${role}: no production bots geometry`);
  const epsilon = 1.5;
  const { viewport, stage, root, cards } = snapshot;

  if (Math.abs(stage.left) > epsilon || Math.abs(stage.top) > epsilon || Math.abs(stage.right - viewport.width) > epsilon || Math.abs(stage.bottom - viewport.height) > epsilon) {
    throw new Error(`${label}/${role}: scaled stage is not viewport-aligned: ${JSON.stringify(snapshot)}`);
  }
  if (root.left < -epsilon || root.right > viewport.width + epsilon || root.top < -epsilon || root.bottom > viewport.height + epsilon) {
    throw new Error(`${label}/${role}: production bots root is clipped by viewport: ${JSON.stringify(snapshot)}`);
  }
  if (cards.length !== 3 || cards.some((card) => card.width <= 0 || card.left < root.left - epsilon || card.right > root.right + epsilon)) {
    throw new Error(`${label}/${role}: production bot cards overflow their root: ${JSON.stringify(snapshot)}`);
  }
}

async function verifyRole(win, directory, role, label) {
  await activateIndustry(win);
  await openProductionBots(win, role);
  const snapshot = await measure(win, role);
  assertFitsViewport(snapshot, label, role);
  fs.writeFileSync(path.join(directory, `production-bots-${role}-viewport.json`), JSON.stringify(snapshot, null, 2));
  await click(win, '[data-qa-production-bots-back]');
  await waitFor(win, `document.querySelector('[data-qa-building-dialog="${role}"]')`);
  await click(win, '.resource-building-dialog-close');
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
        partition: 'qa-production-bots-strict',
      },
    });
    await win.loadFile(path.join(ROOT, 'dist', 'index.html'));
    win.webContents.debugger.attach('1.3');

    await win.webContents.executeJavaScript(`localStorage.removeItem(${JSON.stringify(SAVE_KEY)})`);
    await reload(win);
    await seedBuiltBuildings(win);

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
      for (const role of ROLES) await verifyRole(win, directory, role, label);
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
