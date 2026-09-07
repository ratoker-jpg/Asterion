const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-gpu');
app.on('window-all-closed', () => {});

const ROOT = path.join(__dirname, '..');
const OUTPUT = path.join(ROOT, 'artifacts', 'universe-planet-qa');
const SAVE_KEY = 'asterion.vertical-slice.v1';
const VIEWPORTS = [[1920, 1080], [1280, 720]];
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const skipScreenshots = process.env.ASTERION_SKIP_SCREENSHOTS === '1';

async function waitFor(win, expression, timeoutMs = 10_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await win.webContents.executeJavaScript(`Boolean(${expression})`)) return;
    await sleep(60);
  }
  throw new Error(`Timed out waiting for: ${expression}`);
}

async function settle(win) {
  // Offscreen pages can pause requestAnimationFrame while CDP emulation is
  // being applied. A bounded settle keeps this QA deterministic.
  await sleep(110);
}

async function reload(win) {
  const done = new Promise((resolve) => win.webContents.once('did-finish-load', resolve));
  win.webContents.reload();
  await done;
  await waitFor(win, `document.querySelector('.utility-navigation')`);
  await waitFor(win, `localStorage.getItem(${JSON.stringify(SAVE_KEY)})`);
  await settle(win);
}

async function clickPrimary(win, label) {
  const clicked = await win.webContents.executeJavaScript(`(() => {
    const button = Array.from(document.querySelectorAll('.primary-navigation button'))
      .find((item) => item.textContent?.trim() === ${JSON.stringify(label)});
    if (!button) return false;
    button.click();
    return true;
  })()`);
  if (!clicked) throw new Error(`Primary navigation button not found: ${label}`);
  await waitFor(win, `document.querySelector('[data-qa-universe]')`);
  await settle(win);
}

async function clickObject(win, selector) {
  const clicked = await win.webContents.executeJavaScript(`(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    if (!element) return false;
    element.click();
    return true;
  })()`);
  if (!clicked) throw new Error(`Universe object not found: ${selector}`);
  await waitFor(win, `document.querySelector('[data-qa-universe-inspector]')`);
  await settle(win);
}

async function capture(win, directory, name) {
  if (skipScreenshots) {
    console.log(`[universe-planet-qa] screenshot skipped: ${name}`);
    return;
  }
  await sleep(100);
  const result = await win.webContents.debugger.sendCommand('Page.captureScreenshot', {
    format: 'png',
    fromSurface: true,
    captureBeyondViewport: false,
  });
  fs.writeFileSync(path.join(directory, `${name}.png`), Buffer.from(result.data, 'base64'));
}

async function selectSystem(win, system) {
  const changed = await win.webContents.executeJavaScript(`(() => {
    const element = document.querySelector('.universe-jump select');
    if (!element) return false;
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set;
    setter?.call(element, ${JSON.stringify(String(system))});
    element.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  })()`);
  if (!changed) throw new Error('Universe system selector not found');
  await waitFor(win, `document.querySelector('[data-qa-universe]')?.getAttribute('data-qa-universe-system') === ${JSON.stringify(String(system))}`);
  await settle(win);
}

async function mapSnapshot(win) {
  return win.webContents.executeJavaScript(`(() => {
    const root = document.documentElement;
    const objects = Array.from(document.querySelectorAll('[data-qa-universe-scene] [data-qa-universe-object]'));
    const positions = Array.from(document.querySelectorAll('[data-qa-universe-scene] [data-qa-universe-kind]:not([data-qa-universe-kind="asteroid"])'));
    const animatedSelectors = ['.system-star', '.system-planet', '.system-asteroid', '.empty-slot'];
    const animated = Object.fromEntries(animatedSelectors.map((selector) => [selector, getComputedStyle(document.querySelector(selector)).animationName]));
    const rects = () => objects.map((node) => {
      const rect = node.getBoundingClientRect();
      return { id: node.getAttribute('data-qa-universe-object'), x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) };
    });
    return {
      system: document.querySelector('[data-qa-universe]')?.getAttribute('data-qa-universe-system') || '',
      systemOptions: document.querySelectorAll('.universe-jump select option').length,
      positionCount: positions.length,
      objectKinds: [...new Set(objects.map((node) => node.getAttribute('data-qa-universe-kind')))].sort(),
      asteroidCount: document.querySelectorAll('[data-qa-universe-kind="asteroid"]').length,
      asteroidToggle: document.querySelector('[data-qa-universe-asteroids-toggle]')?.getAttribute('aria-pressed') || '',
      homeCaption: document.querySelector('[data-qa-universe-object="player-planet-helion-01"] [data-qa-map-caption]')?.textContent?.trim() || '',
      mapCaptions: Array.from(document.querySelectorAll('[data-qa-map-caption]')).map((node) => node.textContent?.trim() || ''),
      coordinateLineCount: document.querySelectorAll('.system-planet small, .empty-slot small').length,
      animated,
      rects: rects(),
      viewport: { innerWidth: innerWidth, innerHeight: innerHeight, devicePixelRatio },
      horizontalOverflow: root.scrollWidth > root.clientWidth + 2,
      bodyHorizontalOverflow: document.body.scrollWidth > document.body.clientWidth + 2,
      localStorageKeys: Object.keys(localStorage),
      htmlClass: document.documentElement.className,
      webStageScale: getComputedStyle(document.documentElement).getPropertyValue('--web-stage-scale').trim(),
      visualViewport: window.visualViewport ? { width: window.visualViewport.width, height: window.visualViewport.height } : null,
      stageRect: (() => { const rect = document.querySelector('.stage')?.getBoundingClientRect(); return rect ? { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) } : null; })(),
    };
  })()`);
}

async function stableObjectRects(win, before) {
  await sleep(1_100);
  return win.webContents.executeJavaScript(`(() => {
    const ids = ${JSON.stringify(before.map((item) => item.id))};
    return ids.map((id) => {
      const node = document.querySelector('[data-qa-universe-object="' + id + '"]');
      if (!node) return null;
      const rect = node.getBoundingClientRect();
      return { id, x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) };
    });
  })()`);
}

async function inspectorSnapshot(win) {
  return win.webContents.executeJavaScript(`(() => {
    const inspector = document.querySelector('[data-qa-universe-inspector]');
    const points = Array.from(document.querySelectorAll('[data-qa-universe-points] dd')).map((node) => node.textContent?.trim() || '');
    const actions = Array.from(document.querySelectorAll('[data-qa-universe-action]')).map((node) => ({
      action: node.getAttribute('data-qa-universe-action'),
      status: node.getAttribute('data-qa-universe-action-status'),
      disabled: Boolean(node.disabled),
      title: node.getAttribute('title') || '',
    }));
    return {
      kind: inspector?.getAttribute('data-qa-inspector-kind') || '',
      text: inspector?.textContent?.replace(/\\s+/g, ' ').trim() || '',
      ownerName: document.querySelector('[data-qa-universe-owner-name]')?.textContent?.trim() || '',
      avatar: document.querySelector('[data-qa-universe-avatar] img')?.getAttribute('src') || '',
      points,
      planetRows: document.querySelectorAll('[data-qa-universe-planet-row]').length,
      actions,
      specialActionDisabled: Boolean(document.querySelector('[data-qa-universe-special-action]')?.disabled),
    };
  })()`);
}

async function dismissInspector(win) {
  await win.webContents.executeJavaScript(`document.querySelector('[data-qa-universe-inspector] .universe-inspector-close')?.click()`);
  await waitFor(win, `!document.querySelector('[data-qa-universe-inspector]')`);
  await settle(win);
}

async function runViewport(width, height) {
  const label = `${width}x${height}`;
  const directory = path.join(OUTPUT, label);
  fs.mkdirSync(directory, { recursive: true });
  const win = new BrowserWindow({
    // CDP owns the logical viewport below; keep the native offscreen surface
    // modest so Windows compositor/DPI settings do not distort the capture.
    width: 1000,
    height: 700,
    useContentSize: true,
    show: false,
    backgroundColor: '#02050a',
    webPreferences: {
      offscreen: true,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      partition: `qa-universe-${label}`,
    },
  });
  win.webContents.on('console-message', (_event, _level, message) => {
    if (/error/i.test(message)) console.warn(`[${label}] renderer: ${message}`);
  });

  try {
    const loaded = new Promise((resolve) => win.webContents.once('did-finish-load', resolve));
    await win.loadFile(path.join(ROOT, 'dist', 'index.html'));
    await loaded;
    await waitFor(win, `document.querySelector('.utility-navigation')`);
    win.webContents.debugger.attach('1.3');
    await win.webContents.debugger.sendCommand('Emulation.setDeviceMetricsOverride', {
      width,
      height,
      deviceScaleFactor: 1,
      mobile: false,
      screenWidth: width,
      screenHeight: height,
    });
    await settle(win);
    await waitFor(win, `localStorage.getItem(${JSON.stringify(SAVE_KEY)})`);
    await win.webContents.executeJavaScript(`localStorage.removeItem(${JSON.stringify(SAVE_KEY)}); localStorage.removeItem('asterion.preferences.v2');`);
    await reload(win);
    await clickPrimary(win, 'Вселенная');

    const map = await mapSnapshot(win);
    if (map.system !== '1' || map.systemOptions !== 40 || map.positionCount !== 24 || map.viewport.innerWidth !== width || map.viewport.innerHeight !== height) throw new Error(`${label}: map cardinality/viewport failed ${JSON.stringify(map)}`);
    if (!map.objectKinds.includes('empty') || !map.objectKinds.includes('npc') || !map.objectKinds.includes('pirate') || !map.objectKinds.includes('anomaly') || !map.objectKinds.includes('player') || map.asteroidCount < 3) {
      throw new Error(`${label}: object fixture coverage failed ${JSON.stringify(map)}`);
    }
    if (map.homeCaption !== '★ Dendrilion' || map.coordinateLineCount !== 0 || map.mapCaptions.some((caption) => /\\[\\d+:\\d+:\\d+\\]/.test(caption))) throw new Error(`${label}: map caption contract failed ${JSON.stringify(map)}`);
    if (Object.values(map.animated).some((name) => name !== 'none')) throw new Error(`${label}: universe motion must be disabled ${JSON.stringify(map.animated)}`);
    if (map.horizontalOverflow || map.bodyHorizontalOverflow || !map.stageRect || Math.abs(map.stageRect.x) > 2 || Math.abs(map.stageRect.y) > 2 || Math.abs(map.stageRect.width - width) > 2 || Math.abs(map.stageRect.height - height) > 2) throw new Error(`${label}: map layout/overflow failed ${JSON.stringify(map)}`);
    if (!map.localStorageKeys.includes(SAVE_KEY) || map.localStorageKeys.some((key) => /universe/i.test(key))) throw new Error(`${label}: unexpected universe save key ${JSON.stringify(map.localStorageKeys)}`);

    const stableRects = await stableObjectRects(win, map.rects);
    if (JSON.stringify(stableRects) !== JSON.stringify(map.rects)) throw new Error(`${label}: map moved after 1.1s ${JSON.stringify({ before: map.rects, after: stableRects })}`);
    await capture(win, directory, 'static-map');

    await clickObject(win, '[data-qa-universe-object="player-planet-helion-01"]');
    const player = await inspectorSnapshot(win);
    if (player.kind !== 'player' || player.ownerName !== 'Dendrilion' || !player.avatar.includes('aegis_profile_avatar') || player.points.length !== 4 || player.planetRows !== 1 || player.actions.length !== 2 || player.actions.some((action) => !action.disabled || action.status !== 'disabled' || !action.title.includes('Это ваша планета'))) {
      throw new Error(`${label}: player inspector contract failed ${JSON.stringify(player)}`);
    }
    if (!player.text.includes('Астеры') || !player.text.includes('Содружество Гелион') || !player.text.includes('[HLN]')) throw new Error(`${label}: player profile identity contract failed ${JSON.stringify(player)}`);
    await capture(win, directory, 'player-inspector');
    await dismissInspector(win);

    await clickObject(win, '[data-qa-universe-object="npc-bot-01-prime"]');
    const npc = await inspectorSnapshot(win);
    if (npc.kind !== 'npc' || npc.ownerName !== 'Bot 01' || npc.planetRows !== 3 || npc.actions.length !== 6 || npc.actions.some((action) => action.disabled || action.status !== 'prototype')) throw new Error(`${label}: NPC action/list contract failed ${JSON.stringify(npc)}`);
    const beforePrototypeAction = await win.webContents.executeJavaScript(`localStorage.getItem(${JSON.stringify(SAVE_KEY)})`);
    await win.webContents.executeJavaScript(`document.querySelector('[data-qa-universe-action="fleet"]')?.click()`);
    await waitFor(win, `document.querySelector('.shell-notice span')?.textContent?.includes('Прототип — отправка не подключена')`);
    const prototypeNotice = await win.webContents.executeJavaScript(`document.querySelector('.shell-notice span')?.textContent?.replace(/\\s+/g, ' ').trim() || ''`);
    if (!prototypeNotice.includes('[1:1:4]')) throw new Error(`${label}: prototype action target missing ${prototypeNotice}`);
    const afterPrototypeAction = await win.webContents.executeJavaScript(`localStorage.getItem(${JSON.stringify(SAVE_KEY)})`);
    if (beforePrototypeAction !== afterPrototypeAction) throw new Error(`${label}: prototype action mutated the save envelope`);
    await dismissInspector(win);

    await clickObject(win, '[data-qa-universe-kind="empty"]');
    const empty = await inspectorSnapshot(win);
    if (empty.kind !== 'empty' || !empty.text.includes('Свободная позиция') || !empty.text.includes('Колонизация появится') || !empty.specialActionDisabled) throw new Error(`${label}: empty inspector contract failed ${JSON.stringify(empty)}`);
    await capture(win, directory, 'empty-inspector');
    await dismissInspector(win);

    await clickObject(win, '[data-qa-universe-kind="pirate"]');
    const pirate = await inspectorSnapshot(win);
    if (pirate.kind !== 'pirate' || !pirate.text.includes('Пиратский объект') || !pirate.text.includes('Боевой runtime') || !pirate.specialActionDisabled) throw new Error(`${label}: pirate inspector contract failed ${JSON.stringify(pirate)}`);
    await capture(win, directory, 'pirate-inspector');
    await dismissInspector(win);

    await clickObject(win, '[data-qa-universe-kind="anomaly"]');
    const anomaly = await inspectorSnapshot(win);
    if (anomaly.kind !== 'anomaly' || !anomaly.text.includes('Аномалия') || !anomaly.text.includes('Стоимость, добыча и эффекты') || !anomaly.specialActionDisabled) throw new Error(`${label}: anomaly inspector contract failed ${JSON.stringify(anomaly)}`);
    await capture(win, directory, 'anomaly-inspector');
    await dismissInspector(win);

    const toggle = '[data-qa-universe-asteroids-toggle]';
    await win.webContents.executeJavaScript(`document.querySelector(${JSON.stringify(toggle)})?.click()`);
    await waitFor(win, `document.querySelectorAll('[data-qa-universe-kind="asteroid"]').length === 0`);
    await win.webContents.executeJavaScript(`document.querySelector(${JSON.stringify(toggle)})?.click()`);
    await waitFor(win, `document.querySelectorAll('[data-qa-universe-kind="asteroid"]').length >= 3`);

    await selectSystem(win, 40);
    const lastSystem = await mapSnapshot(win);
    if (lastSystem.system !== '40' || lastSystem.positionCount !== 24 || lastSystem.horizontalOverflow || lastSystem.bodyHorizontalOverflow) throw new Error(`${label}: system navigation contract failed ${JSON.stringify(lastSystem)}`);
    await selectSystem(win, 1);
    await clickObject(win, '[data-qa-universe-object="player-planet-helion-01"]');
    await win.webContents.executeJavaScript(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))`);
    await waitFor(win, `!document.querySelector('[data-qa-universe-inspector]')`);

    const screenshots = skipScreenshots ? [] : fs.readdirSync(directory).filter((name) => name.endsWith('.png')).sort();
    return {
      viewport: label,
      map: { system: map.system, systemOptions: map.systemOptions, positionCount: map.positionCount, asteroidCount: map.asteroidCount, objectKinds: map.objectKinds, homeCaption: map.homeCaption },
      layout: { htmlClass: map.htmlClass, webStageScale: map.webStageScale, visualViewport: map.visualViewport, stageRect: map.stageRect },
      player: { ownerName: player.ownerName, points: player.points, planetRows: player.planetRows },
      npc: { ownerName: npc.ownerName, planetRows: npc.planetRows, prototypeNotice },
      specialInspectors: { empty: empty.kind, pirate: pirate.kind, anomaly: anomaly.kind },
      stableAfterMs: 1_100,
      horizontalOverflow: false,
      stageRect: map.stageRect,
      screenshots,
      screenshotsSkipped: skipScreenshots,
    };
  } finally {
    if (!win.isDestroyed()) {
      try { if (win.webContents.debugger.isAttached()) win.webContents.debugger.detach(); } catch {}
      await win.close();
    }
  }
}

async function main() {
  fs.rmSync(OUTPUT, { recursive: true, force: true });
  fs.mkdirSync(OUTPUT, { recursive: true });
  const results = [];
  try {
    for (const [width, height] of VIEWPORTS) results.push(await runViewport(width, height));
    fs.writeFileSync(path.join(OUTPUT, 'results.json'), JSON.stringify({ results }, null, 2));
    console.log(JSON.stringify({ results }, null, 2));
    app.quit();
  } catch (error) {
    process.stderr.write(`${error.stack || error}\n`);
    app.exit(1);
  }
}

app.whenReady().then(main);
