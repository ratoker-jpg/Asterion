const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-gpu');
app.on('window-all-closed', () => {});

const ROOT = path.join(__dirname, '..');
const OUTPUT = path.join(ROOT, 'artifacts-pass1', 'resource-assets-qa');
const SAVE_KEY = 'asterion.vertical-slice.test.v1';
const VIEWPORTS = [[1920, 1080], [1280, 720]];
const RESOURCE_ASSET_BASE = {
  metal: 'metal',
  minerals: 'mineral',
  gas: 'gas',
  energy: 'energy',
  population: 'population',
  debris: 'debris',
};
const RESOURCE_ICON_OPTICAL_SCALES = {
  metal: 1.28,
  minerals: 1,
  gas: 1,
  energy: 1,
  population: 1,
  debris: 1,
};
const OPTICAL_SCALE_TOLERANCE = 0.01;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(win, expression, timeoutMs = 10_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      if (await win.webContents.executeJavaScript(`Boolean(${expression})`)) return;
    } catch (error) {
      throw new Error(`Renderer expression failed: ${expression}\n${error?.stack || error}`);
    }
    await sleep(50);
  }
  throw new Error(`Timed out waiting for: ${expression}`);
}

async function settle(win) {
  await sleep(90);
}

async function loadTestMode(win) {
  const done = new Promise((resolve) => win.webContents.once('did-finish-load', resolve));
  await win.loadFile(path.join(ROOT, 'dist', 'index.html'), { search: '?mode=test' });
  await done;
  await waitFor(win, `document.querySelector('[data-qa-navigation="utility"]')`);
  await waitFor(win, `localStorage.getItem(${JSON.stringify(SAVE_KEY)})`);
  await settle(win);
}

async function reload(win) {
  const done = new Promise((resolve) => win.webContents.once('did-finish-load', resolve));
  win.webContents.reload();
  await done;
  await waitFor(win, `document.querySelector('[data-qa-navigation="utility"]')`);
  await waitFor(win, `localStorage.getItem(${JSON.stringify(SAVE_KEY)})`);
  await settle(win);
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

async function clickText(win, selector, text) {
  const clicked = await win.webContents.executeJavaScript(`(() => {
    const element = [...document.querySelectorAll(${JSON.stringify(selector)})]
      .find((candidate) => candidate.textContent?.replace(/\\s+/g, ' ').trim().includes(${JSON.stringify(text)}));
    if (!element || element.disabled) return false;
    element.click();
    return true;
  })()`);
  if (!clicked) throw new Error(`Text element not found/enabled: ${selector} ${text}`);
  await settle(win);
}

async function activateRoute(win, route, selector) {
  await click(win, `[data-qa-route="${route}"]`);
  await waitFor(win, `document.querySelector(${JSON.stringify(selector)})`);
}

async function activateZone(win, zone) {
  await click(win, `[data-qa-zone="${zone}"]`);
  await waitFor(win, `document.querySelector('[data-qa-zone-view][data-zone=${JSON.stringify(zone)}]')`);
}

async function openBuildingDialog(win, role) {
  await click(win, `[data-zone-building-role="${role}"]`);
  await waitFor(win, `document.querySelector('[data-qa-building-dialog=${JSON.stringify(role)}]')`);
}

async function closeBuildingDialog(win) {
  await click(win, '.resource-building-dialog-close');
  await waitFor(win, `!document.querySelector('[data-qa-building-dialog]')`);
}

async function waitForResourceImages(win, scopeSelector) {
  const encoded = JSON.stringify(scopeSelector);
  await waitFor(win, `(() => {
    const root = document.querySelector(${encoded});
    const images = root ? [...root.querySelectorAll('img[data-qa-resource-kind]')] : [];
    return Boolean(root && images.length && images.every((image) => image.complete && image.naturalWidth > 0));
  })()`);
}

async function readResourceImages(win, scopeSelector) {
  return win.webContents.executeJavaScript(`(() => {
    const root = document.querySelector(${JSON.stringify(scopeSelector)});
    if (!root) return null;
    return [...root.querySelectorAll('img[data-qa-resource-kind]')].map((image) => {
      const style = getComputedStyle(image);
      const transformValues = style.transform.match(/^matrix\\(([^)]+)\\)$/)?.[1].split(',').map(Number);
      const transformScaleX = transformValues ? Math.hypot(transformValues[0], transformValues[1]) : 1;
      const transformScaleY = transformValues ? Math.hypot(transformValues[2], transformValues[3]) : 1;
      const rect = image.getBoundingClientRect();
      return {
        kind: image.getAttribute('data-qa-resource-kind') || '',
        asset: image.getAttribute('data-qa-resource-asset') || '',
        declaredOpticalScale: image.getAttribute('data-qa-resource-optical-scale') || '',
        transform: style.transform,
        transformScaleX,
        transformScaleY,
        src: image.currentSrc || image.src || '',
        naturalWidth: image.naturalWidth,
        layoutWidth: image.offsetWidth,
        layoutHeight: image.offsetHeight,
        width: rect.width,
        height: rect.height,
      };
    });
  })()`);
}

function assetName(value) {
  return String(value || '').split(/[\\/]/).pop()?.split('?')[0] || '';
}

function assertResourceImages(label, images, requiredKinds, { exact = false } = {}) {
  if (!images) throw new Error(`${label}: scope not found`);
  const availableKinds = [...new Set(images.map((image) => image.kind))];
  if (exact && (availableKinds.length !== requiredKinds.length || requiredKinds.some((kind) => !availableKinds.includes(kind)))) {
    throw new Error(`${label}: resource kind set mismatch ${JSON.stringify({ requiredKinds, availableKinds, images })}`);
  }
  for (const kind of requiredKinds) {
    const matching = images.filter((image) => image.kind === kind);
    if (!matching.length) throw new Error(`${label}: missing resource kind ${kind} ${JSON.stringify({ availableKinds, images })}`);
    const base = RESOURCE_ASSET_BASE[kind];
    const expectedOpticalScale = RESOURCE_ICON_OPTICAL_SCALES[kind];
    const pattern = new RegExp(`^${base}(?:-[^/]+)?\\.png$`, 'i');
    for (const image of matching) {
      const asset = assetName(image.asset);
      const source = assetName(image.src);
      const declaredOpticalScale = Number(image.declaredOpticalScale);
      const scaleMatches = (actual) => Number.isFinite(actual) && Math.abs(actual - expectedOpticalScale) <= OPTICAL_SCALE_TOLERANCE;
      if (
        !pattern.test(asset) ||
        !pattern.test(source) ||
        asset !== source ||
        image.naturalWidth <= 0 ||
        image.width <= 0 ||
        image.height <= 0 ||
        image.layoutWidth <= 0 ||
        image.layoutHeight <= 0 ||
        !scaleMatches(declaredOpticalScale) ||
        !scaleMatches(image.transformScaleX) ||
        !scaleMatches(image.transformScaleY)
      ) {
        throw new Error(`${label}: resource asset contract mismatch ${JSON.stringify({ kind, image, expectedBase: base })}`);
      }
    }
  }
}

async function seedSave(win) {
  const seeded = await win.webContents.executeJavaScript(`(() => {
    const save = JSON.parse(localStorage.getItem(${JSON.stringify(SAVE_KEY)}) || 'null');
    const planet = save?.planets?.['helion-01'];
    if (!save || !planet?.buildings) return false;
    Object.assign(planet.buildings, {
      construction: 10,
      'advanced-factory': 2,
      recycling: 3,
      'trade-center': 3,
      shipyard: 1,
      research: 1,
      spaceport: 1,
      'planetary-government': 1,
      hangar: 1,
    });
    planet.productionBots = { metal: 0, minerals: 0, gas: 0 };
    planet.recycling = { availableDebris: 100000, jobs: [] };
    planet.trade = { refillAtQueue: [] };
    planet.energy = 999999999;
    save.metal = 999999999;
    save.minerals = 999999999;
    save.gas = 999999999;
    save.queues = { 'helion-01': [] };
    save.schemaVersion = Math.max(Number(save.schemaVersion) || 0, 10);
    localStorage.setItem(${JSON.stringify(SAVE_KEY)}, JSON.stringify(save));
    return true;
  })()`);
  if (!seeded) throw new Error('Could not seed resource asset QA save');
  await reload(win);
}

async function assertHeader(win) {
  await waitForResourceImages(win, '[data-qa-resource-rail]');
  const images = await readResourceImages(win, '[data-qa-resource-rail]');
  assertResourceImages('header', images, ['metal', 'minerals', 'gas', 'energy', 'population'], { exact: true });
}

async function assertBuildingDialog(win, role) {
  const selector = `[data-qa-building-dialog="${role}"]`;
  await waitForResourceImages(win, selector);
  const images = await readResourceImages(win, selector);
  assertResourceImages(`building dialog ${role}`, images, ['metal', 'minerals', 'gas', 'energy']);
}

async function assertCanonicalShipyard(win) {
  const identity = await win.webContents.executeJavaScript(`(() => {
    const root = document.querySelector('[data-qa-building-role="shipyard"]');
    return {
      name: root?.querySelector('strong')?.textContent?.trim() || document.querySelector('.shipyard-page-title-v1 h2')?.textContent?.trim() || '',
      asset: root?.getAttribute('data-qa-building-asset') || '',
      image: root?.querySelector('img')?.getAttribute('src') || '',
    };
  })()`);
  if (identity.name !== 'Верфь' || !/building\.aegis\.shipyard(?:-[^/]+)?\.png$/.test(assetName(identity.asset)) || identity.image !== identity.asset) {
    throw new Error(`shipyard identity contract mismatch ${JSON.stringify(identity)}`);
  }
}

async function assertUniverseAssetsUntouched(win) {
  const result = await win.webContents.executeJavaScript(`(() => {
    const root = document.querySelector('[data-qa-universe]');
    const asteroid = root?.querySelector('[data-qa-universe-kind="asteroid"] img');
    return {
      root: Boolean(root),
      resourceMarkers: root?.querySelectorAll('[data-qa-resource-kind]').length || 0,
      asteroidSrc: asteroid?.getAttribute('src') || '',
      asteroidWidth: asteroid?.naturalWidth || 0,
    };
  })()`);
  if (!result.root || result.resourceMarkers !== 0 || !result.asteroidSrc || result.asteroidWidth <= 0) {
    throw new Error(`universe asset contract mismatch ${JSON.stringify(result)}`);
  }
}

async function verifyViewport(width, height) {
  const label = `${width}x${height}`;
  const win = new BrowserWindow({
    width: 1000,
    height: 700,
    show: false,
    backgroundColor: '#02050a',
    webPreferences: {
      offscreen: true,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      partition: `qa-resource-assets-${width}`,
    },
  });
  try {
    await loadTestMode(win);
    win.webContents.debugger.attach('1.3');
    await win.webContents.debugger.sendCommand('Emulation.setDeviceMetricsOverride', {
      width,
      height,
      deviceScaleFactor: 1,
      mobile: false,
      screenWidth: width,
      screenHeight: height,
    });
    await seedSave(win);

    await assertHeader(win);

    await activateZone(win, 'resource');
    await waitForResourceImages(win, '[data-qa-resource-zone]');
    assertResourceImages('resource zone', await readResourceImages(win, '[data-qa-resource-zone]'), ['metal', 'minerals', 'gas']);
    await openBuildingDialog(win, 'metal-production-1');
    await assertBuildingDialog(win, 'metal-production-1');
    await closeBuildingDialog(win);

    await activateZone(win, 'industry');
    await openBuildingDialog(win, 'construction');
    await assertBuildingDialog(win, 'construction');
    await click(win, '[data-qa-enter-building="construction"]');
    await waitFor(win, `document.querySelector('[data-qa-production-bots="construction"]')`);
    await waitForResourceImages(win, '[data-qa-production-bots="construction"]');
    assertResourceImages('production bots', await readResourceImages(win, '[data-qa-production-bots="construction"]'), ['metal', 'minerals', 'gas']);
    await click(win, '[data-qa-production-bots-back]');
    await waitFor(win, `document.querySelector('[data-qa-building-dialog="construction"]')`);
    await closeBuildingDialog(win);

    await openBuildingDialog(win, 'recycling');
    await assertBuildingDialog(win, 'recycling');
    await click(win, '[data-qa-enter-building="recycling"]');
    await waitFor(win, `document.querySelector('[data-qa-recycling-center]')`);
    await waitForResourceImages(win, '[data-qa-recycling-center]');
    assertResourceImages('recycling center', await readResourceImages(win, '[data-qa-recycling-center]'), ['metal', 'minerals', 'gas', 'debris']);
    await click(win, '[data-qa-recycling-back]');
    await waitFor(win, `document.querySelector('[data-qa-building-dialog="recycling"]')`);
    await closeBuildingDialog(win);

    await openBuildingDialog(win, 'trade-center');
    await assertBuildingDialog(win, 'trade-center');
    await click(win, '[data-qa-enter-building="trade-center"]');
    await waitFor(win, `document.querySelector('[data-qa-trade-center]')`);
    await waitForResourceImages(win, '[data-qa-trade-center]');
    assertResourceImages('trade center', await readResourceImages(win, '[data-qa-trade-center]'), ['metal', 'minerals', 'gas', 'debris']);
    await click(win, '[data-qa-trade-back]');
    await waitFor(win, `document.querySelector('[data-qa-building-dialog="trade-center"]')`);
    await closeBuildingDialog(win);

    await activateRoute(win, 'fleets', '.fleet-workspace-v1');
    await assertCanonicalShipyard(win);
    await click(win, '[data-qa-fleet-section="ships"]');
    await waitFor(win, `document.querySelector('.shipyard-view-v1')`);
    await waitForResourceImages(win, '.shipyard-view-v1');
    assertResourceImages('shipyard', await readResourceImages(win, '.shipyard-view-v1'), ['metal', 'minerals', 'gas', 'population']);
    await assertCanonicalShipyard(win);
    await click(win, '[data-qa-fleet-section="defense"]');
    await waitFor(win, `document.querySelector('.shipyard-view-v1')`);
    await waitForResourceImages(win, '.shipyard-view-v1');
    assertResourceImages('defense catalog', await readResourceImages(win, '.shipyard-view-v1'), ['metal', 'minerals', 'gas', 'population']);
    await click(win, '[data-qa-fleet-section="repair"]');
    await waitFor(win, `document.querySelector('.repair-workshop-v1')`);
    await waitForResourceImages(win, '.repair-workshop-v1');
    assertResourceImages('repair workshop', await readResourceImages(win, '.repair-workshop-v1'), ['metal', 'minerals', 'gas', 'population']);

    await activateRoute(win, 'operations', '.operations-shell-v2');
    await waitForResourceImages(win, '.operations-shell-v2');
    assertResourceImages('operations', await readResourceImages(win, '.operations-shell-v2'), ['metal', 'minerals', 'gas']);

    await activateRoute(win, 'command', '.command-view');
    await clickText(win, '.command-tabs button', 'ЗАПРОСЫ РЕСУРСОВ');
    await waitFor(win, `document.querySelector('.command-request-stack--full')`);
    await waitForResourceImages(win, '.command-view');
    assertResourceImages('command', await readResourceImages(win, '.command-view'), ['metal', 'minerals', 'gas', 'energy']);

    await activateRoute(win, 'reports', '.reports-view');
    await click(win, '[data-message-folder="battle"]');
    await waitFor(win, `document.querySelector('[data-qa-message-folder-view="battle"]')`);
    await click(win, '.reports-list-open');
    await waitFor(win, `document.querySelector('.reports-dossier--battle')`);
    await waitForResourceImages(win, '.reports-dossier--battle');
    assertResourceImages('reports battle dossier', await readResourceImages(win, '.reports-dossier--battle'), ['metal', 'minerals', 'gas', 'debris']);

    await activateRoute(win, 'universe', '[data-qa-universe]');
    await assertUniverseAssetsUntouched(win);

    const result = { viewport: label, ok: true };
    fs.mkdirSync(OUTPUT, { recursive: true });
    fs.writeFileSync(path.join(OUTPUT, `${label}.json`), JSON.stringify(result, null, 2));
    console.log(`[${label}] resource asset QA passed`);
    return result;
  } finally {
    try {
      if (win.webContents.debugger.isAttached()) win.webContents.debugger.detach();
    } catch {}
    if (!win.isDestroyed()) await win.close();
  }
}

async function main() {
  const results = [];
  try {
    for (const [width, height] of VIEWPORTS) results.push(await verifyViewport(width, height));
    fs.mkdirSync(OUTPUT, { recursive: true });
    fs.writeFileSync(path.join(OUTPUT, 'result.json'), JSON.stringify({ ok: true, viewports: results }, null, 2));
    console.log(JSON.stringify({ ok: true, viewports: results }, null, 2));
  } finally {
    app.quit();
  }
}

app.whenReady().then(main).catch((error) => {
  console.error(error.stack || error);
  app.exit(1);
});
