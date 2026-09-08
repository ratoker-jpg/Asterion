const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-gpu');
app.on('window-all-closed', () => {});

const ROOT = path.join(__dirname, '..');
const OUTPUT = path.join(ROOT, 'visual-qa', 'header-factions');
const FACTIONS = ['aegis', 'synod', 'veyra'];
const WIDTH = 1920;
const HEIGHT = 1080;
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
  await win.webContents.executeJavaScript('document.fonts?.ready');
  await win.webContents.executeJavaScript('new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
  await sleep(180);
}

async function capture(win, name) {
  const result = await win.webContents.debugger.sendCommand('Page.captureScreenshot', {
    format: 'png',
    fromSurface: true,
    captureBeyondViewport: false,
  });
  fs.writeFileSync(path.join(OUTPUT, `${name}.png`), Buffer.from(result.data, 'base64'));
}

function almostEqual(left, right, tolerance = 0.75) {
  return Math.abs(left - right) <= tolerance;
}

function assertSameRect(reference, actual, key) {
  for (const field of ['x', 'y', 'width', 'height']) {
    if (!almostEqual(reference[field], actual[field])) {
      throw new Error(`${key}: faction geometry drifted at ${field}: ${reference[field]} -> ${actual[field]}`);
    }
  }
}

async function inspectHeader(win) {
  return win.webContents.executeJavaScript(`(() => {
    const rect = (selector) => {
      const element = document.querySelector(selector);
      if (!element) return null;
      const r = element.getBoundingClientRect();
      return { x:r.x, y:r.y, width:r.width, height:r.height };
    };
    const background = (selector, pseudo) => {
      const element = document.querySelector(selector);
      return element ? getComputedStyle(element, pseudo).backgroundImage : null;
    };
    const resources = Array.from(document.querySelectorAll('.header-resource-rail .resource-chip'));
    const navigation = Array.from(document.querySelectorAll('.primary-navigation button'));
    const selector = document.querySelector('.current-planet-select');
    const campaignTime = document.querySelector('.campaign-module time');
    const activeNavigation = document.querySelector('.primary-navigation button.active');
    return {
      faction: document.documentElement.dataset.headerFaction,
      geometry: {
        header: rect('.asterion-header'),
        orbit: rect('.header-planet-orbit'),
        selector: rect('.current-planet-select'),
        resources: rect('.header-resource-rail'),
        campaign: rect('.campaign-module'),
        navigation: rect('.primary-navigation'),
      },
      content: {
        selectorText: selector?.textContent?.replace(/\\s+/g, ' ').trim() || '',
        resourceCount: resources.length,
        resourceTexts: resources.map((item) => item.textContent?.replace(/\\s+/g, ' ').trim() || ''),
        navigationCount: navigation.length,
        navigationTexts: navigation.map((item) => item.textContent?.replace(/\\s+/g, ' ').trim() || ''),
        campaignTime: campaignTime?.textContent?.trim() || '',
      },
      art: {
        selector: background('.current-planet-select', '::before'),
        resource: background('.header-resource-rail .resource-chip', '::before'),
        campaign: background('.campaign-module', '::after'),
        planet: background('.header-planet-orbit', '::before'),
        navRail: background('.primary-navigation', '::before'),
        activeNav: activeNavigation ? getComputedStyle(activeNavigation, '::before').backgroundImage : null,
      },
    };
  })()`);
}

async function prepareTooltipTarget(win) {
  return win.webContents.executeJavaScript(`(() => {
    const chips = Array.from(document.querySelectorAll('.header-resource-rail .resource-chip'));
    const predecessor = chips[0];
    const target = chips[1];
    if (!predecessor || !target) return null;
    predecessor.focus();
    const rect = target.getBoundingClientRect();
    return {
      predecessorFocused: document.activeElement === predecessor,
      center: { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2) },
      viewport: { width: innerWidth, height: innerHeight },
    };
  })()`);
}

async function readTooltip(win) {
  return win.webContents.executeJavaScript(`(() => {
    const chips = Array.from(document.querySelectorAll('.header-resource-rail .resource-chip'));
    const target = chips[1];
    const item = target?.querySelector('.resource-tooltip') ?? null;
    if (!item) return null;
    const style = getComputedStyle(item);
    const r = item.getBoundingClientRect();
    const clippedBy = [];
    for (let parent = item.parentElement; parent && parent !== document.documentElement; parent = parent.parentElement) {
      const parentStyle = getComputedStyle(parent);
      const parentRect = parent.getBoundingClientRect();
      const clipsX = ['hidden','clip','auto','scroll'].includes(parentStyle.overflowX);
      const clipsY = ['hidden','clip','auto','scroll'].includes(parentStyle.overflowY);
      if ((clipsX && (r.left < parentRect.left - 1 || r.right > parentRect.right + 1)) ||
          (clipsY && (r.top < parentRect.top - 1 || r.bottom > parentRect.bottom + 1))) {
        clippedBy.push(parent.getAttribute('class') || parent.tagName);
      }
    }
    return {
      focused: document.activeElement === target,
      visibility: style.visibility,
      opacity: style.opacity,
      width: r.width,
      height: r.height,
      left: r.left,
      right: r.right,
      top: r.top,
      bottom: r.bottom,
      viewportWidth: innerWidth,
      viewportHeight: innerHeight,
      clippedBy,
      text: item.textContent?.replace(/\\s+/g, ' ').trim() || '',
    };
  })()`);
}

function assertTooltip(snapshot, faction, interaction, requireFocus = false) {
  if (!snapshot) throw new Error(`${faction}: resource tooltip missing via ${interaction}`);
  if (requireFocus && !snapshot.focused) throw new Error(`${faction}: resource chip did not receive keyboard Tab focus: ${JSON.stringify(snapshot)}`);
  if (snapshot.visibility !== 'visible' || snapshot.opacity !== '1') {
    throw new Error(`${faction}: resource tooltip is not visible via ${interaction}: ${JSON.stringify(snapshot)}`);
  }
  if (snapshot.width <= 0 || snapshot.height <= 0) throw new Error(`${faction}: resource tooltip has zero size via ${interaction}: ${JSON.stringify(snapshot)}`);
  if (snapshot.left < 0 || snapshot.right > snapshot.viewportWidth || snapshot.top < 0 || snapshot.bottom > snapshot.viewportHeight) {
    throw new Error(`${faction}: resource tooltip escapes viewport via ${interaction}: ${JSON.stringify(snapshot)}`);
  }
  if (snapshot.clippedBy.length) throw new Error(`${faction}: resource tooltip is clipped via ${interaction}: ${JSON.stringify(snapshot)}`);
  if (!snapshot.text) throw new Error(`${faction}: resource tooltip has no live text via ${interaction}`);
}

async function inspectTooltipInteractions(win, faction) {
  const prepared = await prepareTooltipTarget(win);
  if (!prepared?.predecessorFocused) throw new Error(`${faction}: could not prepare preceding resource chip for keyboard navigation`);
  await settle(win);
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Tab' });
  win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Tab' });
  await settle(win);
  const focus = await readTooltip(win);
  assertTooltip(focus, faction, 'keyboard focus', true);

  await win.webContents.executeJavaScript('document.activeElement?.blur()');
  win.webContents.sendInputEvent({ type: 'mouseMove', x: 1, y: 1, movementX: 0, movementY: 0 });
  await sleep(50);
  win.webContents.sendInputEvent({
    type: 'mouseMove',
    x: Math.max(1, Math.min(prepared.viewport.width - 2, prepared.center.x)),
    y: Math.max(1, Math.min(prepared.viewport.height - 2, prepared.center.y)),
    movementX: 0,
    movementY: 0,
  });
  await settle(win);
  const hover = await readTooltip(win);
  assertTooltip(hover, faction, 'hover');
  return { focus, hover };
}

function hasBundledAsset(value, stem) {
  return typeof value === 'string' && value !== 'none' && value.includes(stem);
}

function verifyArt(snapshot, faction) {
  if (!hasBundledAsset(snapshot.art.selector, 'planet_selector')) throw new Error(`${faction}: selector is not using bundled v2 art: ${snapshot.art.selector}`);
  if (!hasBundledAsset(snapshot.art.campaign, 'campaign_utility')) throw new Error(`${faction}: campaign is not using bundled v2 art: ${snapshot.art.campaign}`);
  if (faction === 'aegis') {
    if (!hasBundledAsset(snapshot.art.resource, 'resource_cell')) throw new Error(`aegis: resource cell is not using bundled v2 art: ${snapshot.art.resource}`);
    if (!hasBundledAsset(snapshot.art.activeNav, 'navigation_active')) throw new Error(`aegis: active navigation is not using bundled v2 art: ${snapshot.art.activeNav}`);
  } else {
    if (!hasBundledAsset(snapshot.art.planet, 'planet_frame')) throw new Error(`${faction}: planet frame is not using bundled v2 art: ${snapshot.art.planet}`);
    if (!hasBundledAsset(snapshot.art.navRail, 'navigation_rail')) throw new Error(`${faction}: navigation rail is not using bundled v2 art: ${snapshot.art.navRail}`);
  }
}

function verifyLiveContent(snapshot, faction) {
  if (snapshot.faction !== faction) throw new Error(`${faction}: root faction mismatch: ${snapshot.faction}`);
  if (!snapshot.content.selectorText) throw new Error(`${faction}: current planet selector lost live text`);
  if (snapshot.content.resourceCount !== 5 || snapshot.content.resourceTexts.some((text) => !text)) throw new Error(`${faction}: resource live DOM is incomplete`);
  if (snapshot.content.navigationCount !== 6 || snapshot.content.navigationTexts.some((text) => !text)) throw new Error(`${faction}: navigation live DOM is incomplete`);
  if (!snapshot.content.campaignTime) throw new Error(`${faction}: campaign timer lost live text`);
}

function verifyFactionAssetsAreDistinct(results) {
  for (const key of ['selector', 'campaign']) {
    const values = results.map((item) => item.art[key]);
    if (new Set(values).size !== values.length) throw new Error(`${key}: faction art unexpectedly resolves to the same bundled asset: ${JSON.stringify(values)}`);
  }
  const alienPlanet = results.filter((item) => item.faction !== 'aegis').map((item) => item.art.planet);
  const alienRail = results.filter((item) => item.faction !== 'aegis').map((item) => item.art.navRail);
  if (new Set(alienPlanet).size !== alienPlanet.length) throw new Error(`Synod/Veyra planet art is not distinct: ${JSON.stringify(alienPlanet)}`);
  if (new Set(alienRail).size !== alienRail.length) throw new Error(`Synod/Veyra navigation art is not distinct: ${JSON.stringify(alienRail)}`);
}

app.whenReady().then(async () => {
  let win;
  try {
    fs.rmSync(OUTPUT, { recursive: true, force: true });
    fs.mkdirSync(OUTPUT, { recursive: true });

    win = new BrowserWindow({
      width: WIDTH,
      height: HEIGHT,
      show: false,
      backgroundColor: '#02050a',
      webPreferences: {
        offscreen: true,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        partition: 'qa-header-factions',
      },
    });

    await win.loadFile(path.join(ROOT, 'dist', 'index.html'), { query: { headerFaction: FACTIONS[0] } });
    await waitFor(win, `document.querySelector('.asterion-header') && document.querySelectorAll('.primary-navigation button').length === 6`);
    win.webContents.debugger.attach('1.3');
    await win.webContents.debugger.sendCommand('Emulation.setDeviceMetricsOverride', {
      width: WIDTH,
      height: HEIGHT,
      deviceScaleFactor: 1,
      mobile: false,
      screenWidth: WIDTH,
      screenHeight: HEIGHT,
    });

    const results = [];
    let referenceGeometry = null;
    for (let index = 0; index < FACTIONS.length; index += 1) {
      const faction = FACTIONS[index];
      if (index > 0) {
        await win.loadFile(path.join(ROOT, 'dist', 'index.html'), { query: { headerFaction: faction } });
        await waitFor(win, `document.querySelector('.asterion-header') && document.querySelectorAll('.primary-navigation button').length === 6`);
      }
      await settle(win);

      const snapshot = await inspectHeader(win);
      verifyArt(snapshot, faction);
      verifyLiveContent(snapshot, faction);
      if (!referenceGeometry) referenceGeometry = snapshot.geometry;
      else {
        for (const key of Object.keys(referenceGeometry)) {
          if (!referenceGeometry[key] || !snapshot.geometry[key]) throw new Error(`${faction}: missing geometry for ${key}`);
          assertSameRect(referenceGeometry[key], snapshot.geometry[key], `${faction}/${key}`);
        }
      }

      const tooltip = await inspectTooltipInteractions(win, faction);
      await capture(win, faction);
      results.push({ ...snapshot, tooltip });
    }

    verifyFactionAssetsAreDistinct(results);
    fs.writeFileSync(path.join(OUTPUT, 'metrics.json'), JSON.stringify(results, null, 2));
    console.log('Faction header visual QA passed for aegis, synod and veyra at 1920x1080.');
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
