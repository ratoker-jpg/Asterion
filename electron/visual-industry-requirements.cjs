const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-gpu');
app.on('window-all-closed', () => {});

const ROOT = path.join(__dirname, '..');
const OUTPUT = path.join(ROOT, 'visual-qa');
const SAVE_KEY = 'asterion.vertical-slice.v1';
const VIEWPORTS = [[1920,1080],[1600,900],[1280,720]];
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(win, expression, timeoutMs = 6000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await win.webContents.executeJavaScript(`Boolean(${expression})`)) return;
    await sleep(50);
  }
  throw new Error(`Timed out waiting for: ${expression}`);
}

async function settle(win) {
  await win.webContents.executeJavaScript('new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
  await sleep(60);
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

async function activateIndustryZone(win) {
  const clicked = await win.webContents.executeJavaScript(`(() => {
    const button = document.querySelector('.header-zone--industry');
    if (!button) return false;
    button.click();
    return true;
  })()`);
  if (!clicked) throw new Error('Industry zone header button not found');
  await waitFor(win, `document.querySelector('[data-qa-zone-view][data-zone="industry"]')`);
  await waitFor(win, `(() => {
    const terrain = document.querySelector('[data-qa-zone-terrain][data-zone="industry"]');
    const images = Array.from(document.querySelectorAll('[data-zone-building-role] img'));
    return terrain?.complete && terrain.naturalWidth > 0 && images.length === 7 && images.every((image) => image.complete && image.naturalWidth > 0);
  })()`);
  await settle(win);
}

async function verifyIndustryRequirements(win, directory) {
  await win.webContents.executeJavaScript(`localStorage.removeItem(${JSON.stringify(SAVE_KEY)})`);
  await reload(win);
  await activateIndustryZone(win);

  const blocked = await win.webContents.executeJavaScript(`(() => {
    const snapshot = (role) => {
      const node = document.querySelector('[data-zone-building-role="' + role + '"]');
      const tile = document.querySelector('[data-zone-selector-role="' + role + '"]');
      return {
        role,
        nodeBlocked: Boolean(node?.classList.contains('blocked')),
        tileBlocked: Boolean(tile?.classList.contains('blocked')),
        aria: tile?.getAttribute('aria-label') ?? '',
      };
    };
    const terrain = document.querySelector('[data-qa-zone-terrain][data-zone="industry"]');
    return {
      terrain: terrain ? {
        source: terrain.getAttribute('data-terrain-source'),
        src: terrain.currentSrc || terrain.src || '',
        naturalWidth: terrain.naturalWidth,
        naturalHeight: terrain.naturalHeight,
      } : null,
      advancedFactory: snapshot('advanced-factory'),
      recycling: snapshot('recycling'),
    };
  })()`);

  if (!blocked.terrain || blocked.terrain.source !== 'industry-terrain.png' || !blocked.terrain.src.includes('industry-terrain') || blocked.terrain.naturalWidth <= 0 || blocked.terrain.naturalHeight <= 0) {
    throw new Error(`Industry terrain contract failed: ${JSON.stringify(blocked.terrain)}`);
  }
  for (const item of [blocked.advancedFactory, blocked.recycling]) {
    if (!item.nodeBlocked || !item.tileBlocked || !item.aria.includes('Требования не выполнены')) {
      throw new Error(`Industry blocked state missing for ${item.role}: ${JSON.stringify(item)}`);
    }
  }

  await capture(win, directory, 'industry-zone-blocked-requirements');

  const opened = await win.webContents.executeJavaScript(`(() => {
    const button = document.querySelector('[data-zone-building-role="recycling"]');
    if (!button) return false;
    button.click();
    return true;
  })()`);
  if (!opened) throw new Error('Recycling building node not found');
  await waitFor(win, `document.querySelector('[data-qa-building-dialog="recycling"]')`);
  await settle(win);

  const dialog = await win.webContents.executeJavaScript(`(() => {
    const root = document.querySelector('[data-qa-building-dialog="recycling"]');
    const requirementRows = Array.from(root?.querySelectorAll('.resource-building-requirements > div') ?? []);
    return {
      zone: root?.getAttribute('data-qa-building-zone') ?? '',
      status: root?.querySelector('[data-qa-build-status]')?.getAttribute('data-qa-build-status') ?? '',
      disabled: Boolean(root?.querySelector('[data-qa-build-button]')?.disabled),
      requirements: requirementRows.map((row) => row.textContent?.replace(/\s+/g, ' ').trim() ?? ''),
    };
  })()`);

  if (dialog.zone !== 'industry' || dialog.status !== 'requirements-unmet' || !dialog.disabled || dialog.requirements.length !== 2) {
    throw new Error(`Recycling dialog blocked contract failed: ${JSON.stringify(dialog)}`);
  }
  const combined = dialog.requirements.join(' | ');
  if (!combined.includes('Верфь — ур. 5') || !combined.includes('Химия — ур. 6') || dialog.requirements.some((row) => !row.includes('сейчас'))) {
    throw new Error(`Recycling requirements list is incomplete: ${JSON.stringify(dialog)}`);
  }

  await capture(win, directory, 'industry-zone-recycling-requirements-dialog');
  return { screen: 'industry-requirements', blocked, dialog };
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
        partition: 'qa-industry-requirements',
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
      const result = await verifyIndustryRequirements(win, directory);
      fs.writeFileSync(path.join(directory, 'industry-requirements-metrics.json'), JSON.stringify(result, null, 2));
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
