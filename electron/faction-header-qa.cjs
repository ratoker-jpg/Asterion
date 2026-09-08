const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-gpu');
app.on('window-all-closed', () => {});
console.log('faction header QA boot');

const ROOT = path.join(__dirname, '..');
const DIST = path.join(ROOT, 'dist', 'index.html');
const OUTPUT = path.join(ROOT, 'artifacts', 'faction-header-qa-v2');
const SAVE_KEY = 'asterion.vertical-slice.v1';
const FACTIONS = [
  ['aegis', 'Астеры'],
  ['synod', 'Илары'],
  ['veyra', 'Рой'],
];
const VIEWPORTS = [[1920, 1080], [1280, 720]];
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(win, expression, timeoutMs = 8000) {
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
  await waitFor(win, `document.querySelector('[data-qa-header-theme]')`);
  await win.webContents.executeJavaScript('document.fonts?.ready');
  await settle(win);
}

async function seedOverflowFixture(win) {
  await win.webContents.executeJavaScript(`localStorage.setItem(${JSON.stringify(SAVE_KEY)}, ${JSON.stringify(JSON.stringify({
    metal: 999_999_999,
    minerals: 999_999_999,
    gas: 999_999_999,
    planets: {
      'helion-01': {
        name: 'Helion 01',
        skin: 'colonized',
        energy: 1_000_000,
        buildings: { hangar: 20 },
        fleet: { ships: { 'solar-satellite': 25_112 }, commanders: {} },
      },
    },
  }))}`);
  await reload(win);
}

async function capture(win, filePath, clip) {
  const params = { format: 'png', fromSurface: true, captureBeyondViewport: false };
  if (clip) params.clip = { ...clip, scale: 1 };
  const result = await win.webContents.debugger.sendCommand('Page.captureScreenshot', params);
  fs.writeFileSync(filePath, Buffer.from(result.data, 'base64'));
}

async function inspect(win, faction, width, height) {
  return win.webContents.executeJavaScript(`(() => {
    const header = document.querySelector('.asterion-header');
    const rect = (element) => {
      if (!element) return null;
      const value = element.getBoundingClientRect();
      return { x: value.x, y: value.y, right: value.right, bottom: value.bottom, width: value.width, height: value.height };
    };
    const critical = document.querySelector('[data-qa-resource="metal"] .resource-fill--critical i');
    const population = document.querySelector('[data-qa-resource="population"] strong');
    const focusTarget = document.querySelector('.primary-navigation button');
    focusTarget?.focus();
    return {
      faction: header?.dataset.faction ?? null,
      label: header?.dataset.qaHeaderTheme ?? null,
      viewport: { width: window.innerWidth, height: window.innerHeight },
      header: rect(header),
      stage: rect(document.querySelector('.stage')),
      workspace: rect(document.querySelector('.workspace')),
      populationText: population?.textContent?.trim() ?? null,
      populationHasCapacitySuffix: Boolean(population?.textContent?.includes('/')),
      resourceTones: Object.fromEntries(Array.from(document.querySelectorAll('[data-qa-resource]')).map((item) => [item.dataset.qaResource, item.dataset.qaFillTone])),
      criticalBarColor: critical ? getComputedStyle(critical).backgroundColor : null,
      focusedHeaderControl: document.activeElement === focusTarget,
      focusOutline: focusTarget ? getComputedStyle(focusTarget).outlineStyle : null,
      reducedMotionAnimation: getComputedStyle(document.querySelector('.header-planet-orbit'), '::after').animationName,
      brokenImages: Array.from(document.images).filter((image) => !image.complete || image.naturalWidth === 0).map((image) => image.currentSrc || image.src),
      resourceRequests: performance.getEntriesByType('resource').filter((entry) => entry.name.includes('/assets/')).length,
    };
  })()`);
}

app.whenReady().then(async () => {
  console.log('faction header QA ready');
  let win;
  const result = { viewports: [], screenshots: [], consoleErrors: [], failedLoads: [] };
  try {
    fs.mkdirSync(OUTPUT, { recursive: true });
    win = new BrowserWindow({
      width: 1920,
      height: 1080,
      show: false,
      backgroundColor: '#02050a',
      webPreferences: { offscreen: true, contextIsolation: true, nodeIntegration: false, sandbox: true, partition: 'qa-faction-header' },
    });
    console.log('browser window created');
    win.webContents.on('console-message', (_event, level, message, line, sourceId) => {
      if (level >= 2) result.consoleErrors.push({ level, message, line, sourceId });
    });
    win.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
      result.failedLoads.push({ errorCode, errorDescription, validatedURL });
    });
    win.webContents.debugger.attach('1.3');

    for (const [faction, label] of FACTIONS) {
      for (const [width, height] of VIEWPORTS) {
        console.log(`rendering ${faction} ${width}x${height}`);
        await win.webContents.debugger.sendCommand('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false, screenWidth: width, screenHeight: height });
        await win.loadFile(DIST, { query: { faction } });
        await waitFor(win, `document.querySelector('[data-qa-header-theme]')`);
        await seedOverflowFixture(win);
        const snapshot = await inspect(win, faction, width, height);
        const headerBottom = Math.min(height, Math.ceil(snapshot.header.bottom + 12));
        const labelName = `${faction}-${width}x${height}`;
        const fullPath = path.join(OUTPUT, `${labelName}.png`);
        const headerPath = path.join(OUTPUT, `${labelName}-header.png`);
        await capture(win, fullPath);
        await capture(win, headerPath, { x: 0, y: 0, width, height: headerBottom });
        result.screenshots.push(fullPath, headerPath);
        result.viewports.push({ faction, label, ...snapshot, screenshot: { full: fullPath, header: headerPath } });

        if (snapshot.faction !== faction || snapshot.label !== label) throw new Error(`${labelName}: faction theme did not resolve`);
        if (snapshot.viewport.width !== width || snapshot.viewport.height !== height) throw new Error(`${labelName}: viewport mismatch`);
        const normalizedPopulation = snapshot.populationText?.replace(/\s+/g, ' ');
        if (normalizedPopulation !== '25 112' || snapshot.populationHasCapacitySuffix) throw new Error(`${labelName}: population contract failed: ${JSON.stringify(snapshot)}`);
        const storageTones = Object.entries(snapshot.resourceTones).filter(([resource]) => resource !== 'energy').map(([, tone]) => tone);
        if (!storageTones.every((tone) => tone === 'critical') || snapshot.resourceTones.energy !== 'none') throw new Error(`${labelName}: storage or energy status is incorrect: ${JSON.stringify(snapshot.resourceTones)}`);
        if (!snapshot.criticalBarColor?.replace(/\s/g, '').includes('255,95,105')) throw new Error(`${labelName}: critical resource bar is not red: ${JSON.stringify(snapshot)}`);
        if (snapshot.focusOutline === 'none' || snapshot.focusOutline === 'hidden') throw new Error(`${labelName}: focus outline is not visible: ${JSON.stringify(snapshot)}`);
        if (snapshot.header.bottom > snapshot.workspace.y || snapshot.brokenImages.length || !snapshot.focusedHeaderControl || snapshot.resourceRequests === 0) throw new Error(`${labelName}: layout, interaction, or asset contract failed: ${JSON.stringify(snapshot)}`);

        await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
        await reload(win);
        const reduced = await inspect(win, faction, width, height);
        result.viewports[result.viewports.length - 1].reducedMotion = reduced;
        if (reduced.reducedMotionAnimation !== 'none') throw new Error(`${labelName}: reduced motion did not disable orbit animation`);
        await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [] });
      }
    }

    if (result.consoleErrors.length || result.failedLoads.length) throw new Error(`Console or load failures: ${JSON.stringify({ consoleErrors: result.consoleErrors, failedLoads: result.failedLoads })}`);
    fs.writeFileSync(path.join(OUTPUT, 'result.json'), JSON.stringify(result, null, 2));
    console.log(`Faction header QA passed: ${result.viewports.length} renders, ${result.screenshots.length} screenshots.`);
    win.webContents.debugger.detach();
    win.destroy();
    app.exit(0);
  } catch (error) {
    console.error(error);
    fs.writeFileSync(path.join(OUTPUT, 'result.json'), JSON.stringify({ ...result, error: String(error) }, null, 2));
    try { if (win?.webContents.debugger.isAttached()) win.webContents.debugger.detach(); } catch {}
    win?.destroy();
    app.exit(1);
  }
});
