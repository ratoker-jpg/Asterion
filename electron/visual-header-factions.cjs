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

async function inspectHeader(win, faction) {
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

async function inspectTooltip(win) {
  const focused = await win.webContents.executeJavaScript(`(() => {
    const chip = document.querySelector('.header-resource-rail .resource-chip');
    if (!chip) return false;
    chip.focus();
    return document.activeElement === chip;
  })()`);
  if (!focused) throw new Error('Resource chip could not receive focus for tooltip QA');
  await settle(win);

  const tooltip = await win.webContents.executeJavaScript(`(() => {
    const item = document.querySelector('.header-resource-rail .resource-chip .resource-tooltip');
    if (!item) return null;
    const style = getComputedStyle(item);
    const r = item.getBoundingClientRect();
    let clippedBy = null;
    let parent = item.parentElement;
    while (parent && parent !== document.body) {
      const parentStyle = getComputedStyle(parent);
      const overflowX = parentStyle.overflowX;
      const overflowY = parentStyle.overflowY;
      if (overflowX !== 'visible' || overflowY !== 'visible') {
        const pr = parent.getBoundingClientRect();
        if (r.left < pr.left - 0.5 || r.right > pr.right + 0.5 || r.top < pr.top - 0.5 || r.bottom > pr.bottom + 0.5) {
          clippedBy = { className: parent.className, overflowX, overflowY };
          break;
        }
      }
      parent = parent.parentElement;
    }
    return {
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

  if (!tooltip) throw new Error('Resource tooltip missing');
  if (tooltip.opacity !== '1') throw new Error(`Resource tooltip is not visible after focus: ${JSON.stringify(tooltip)}`);
  if (tooltip.width <= 0 || tooltip.height <= 0) throw new Error(`Resource tooltip has zero size: ${JSON.stringify(tooltip)}`);
  if (tooltip.left < 0 || tooltip.right > tooltip.viewportWidth || tooltip.top < 0 || tooltip.bottom > tooltip.viewportHeight) {
    throw new Error(`Resource tooltip escapes viewport: ${JSON.stringify(tooltip)}`);
  }
  if (tooltip.clippedBy) throw new Error(`Resource tooltip is clipped by ancestor: ${JSON.stringify(tooltip)}`);
  if (!tooltip.text) throw new Error('Resource tooltip has no live text');
  return tooltip;
}

function verifyArt(snapshot, faction) {
  const local = `faction-header-v2/${faction}`;
  if (!snapshot.art.selector?.includes(`${local}/planet_selector.png`)) {
    throw new Error(`${faction}: selector is not using local v2 art: ${snapshot.art.selector}`);
  }
  if (!snapshot.art.campaign?.includes(`${local}/campaign_utility.png`)) {
    throw new Error(`${faction}: campaign is not using local v2 art: ${snapshot.art.campaign}`);
  }
  if (faction === 'aegis') {
    if (!snapshot.art.resource?.includes('faction-header-v2/aegis/resource_cell.png')) {
      throw new Error(`aegis: resource cell is not using local v2 art: ${snapshot.art.resource}`);
    }
    if (!snapshot.art.activeNav?.includes('faction-header-v2/aegis/navigation_active.png')) {
      throw new Error(`aegis: active navigation is not using local v2 art: ${snapshot.art.activeNav}`);
    }
  } else {
    if (!snapshot.art.planet?.includes(`${local}/planet_frame.png`)) {
      throw new Error(`${faction}: planet frame is not using local v2 art: ${snapshot.art.planet}`);
    }
    if (!snapshot.art.navRail?.includes(`${local}/navigation_rail.png`)) {
      throw new Error(`${faction}: navigation rail is not using local v2 art: ${snapshot.art.navRail}`);
    }
  }
}

function verifyLiveContent(snapshot, faction) {
  if (snapshot.faction !== faction) throw new Error(`${faction}: root faction mismatch: ${snapshot.faction}`);
  if (!snapshot.content.selectorText) throw new Error(`${faction}: current planet selector lost live text`);
  if (snapshot.content.resourceCount !== 5 || snapshot.content.resourceTexts.some((text) => !text)) {
    throw new Error(`${faction}: resource live DOM is incomplete: ${JSON.stringify(snapshot.content.resourceTexts)}`);
  }
  if (snapshot.content.navigationCount !== 6 || snapshot.content.navigationTexts.some((text) => !text)) {
    throw new Error(`${faction}: navigation live DOM is incomplete: ${JSON.stringify(snapshot.content.navigationTexts)}`);
  }
  if (!snapshot.content.campaignTime) throw new Error(`${faction}: campaign timer lost live text`);
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
    for (const faction of FACTIONS) {
      await win.loadFile(path.join(ROOT, 'dist', 'index.html'), { query: { headerFaction: faction } });
      await waitFor(win, `document.querySelector('.asterion-header') && document.querySelectorAll('.primary-navigation button').length === 6`);
      await settle(win);

      const snapshot = await inspectHeader(win, faction);
      verifyArt(snapshot, faction);
      verifyLiveContent(snapshot, faction);
      if (!referenceGeometry) referenceGeometry = snapshot.geometry;
      else {
        for (const key of Object.keys(referenceGeometry)) {
          if (!referenceGeometry[key] || !snapshot.geometry[key]) throw new Error(`${faction}: missing geometry for ${key}`);
          assertSameRect(referenceGeometry[key], snapshot.geometry[key], `${faction}/${key}`);
        }
      }

      const tooltip = await inspectTooltip(win);
      await capture(win, faction);
      results.push({ ...snapshot, tooltip });
    }

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
