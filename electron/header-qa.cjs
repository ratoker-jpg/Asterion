const { app, BrowserWindow } = require('electron');
const path = require('path');

app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-gpu');
app.on('window-all-closed', () => {});

const ROOT = path.join(__dirname, '..');
const VIEWPORTS = [[1920, 1080], [1280, 720]];
const PRIMARY_ROUTES = [
  ['planet', '.planet-page-v3'],
  ['universe', '.universe-view'],
  ['fleets', '.fleet-main-v1'],
  ['operations', '.operations-shell-v2'],
  ['command', '.command-view'],
  ['reports', '.reports-view'],
];
const UTILITY_ROUTES = ['settings', 'rating', 'science'];
const EXPECTED_ZONE_POSITIONS = {
  resource: ['4px', '59px'],
  industry: ['173px', '49px'],
  military: ['87px', '161px'],
};
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
  await sleep(120);
}

async function clickRoute(win, route) {
  const clicked = await win.webContents.executeJavaScript(`(() => {
    const element = document.querySelector('[data-qa-route="${route}"]');
    if (!element || element.disabled) return false;
    element.click();
    return true;
  })()`);
  if (!clicked) throw new Error(`Route button not found: ${route}`);

  if (UTILITY_ROUTES.includes(route)) {
    await waitFor(win, `document.querySelector('[data-qa-utility-screen="${route}"]')`);
  } else {
    const selector = PRIMARY_ROUTES.find(([id]) => id === route)?.[1];
    const workspaceSelector = route === 'fleets' ? 'true' : `document.querySelector('.workspace--${route}')`;
    await waitFor(win, `${workspaceSelector} && document.querySelector(${JSON.stringify(selector)})`);
  }
  await settle(win);
}

async function readHeaderContract(win) {
  return win.webContents.executeJavaScript(`(() => {
    const rect = (element) => {
      if (!element) return null;
      const value = element.getBoundingClientRect();
      return { x: value.x, y: value.y, width: value.width, height: value.height };
    };
    const header = document.querySelector('[data-qa-header]');
    const workspace = document.querySelector('.workspace');
    const zones = Object.fromEntries(Array.from(document.querySelectorAll('[data-qa-zone]')).map((element) => {
      const style = getComputedStyle(element);
      return [element.getAttribute('data-qa-zone'), {
        rect: rect(element),
        left: style.left,
        top: style.top,
        position: style.position,
      }];
    }));
    const values = {
      header: rect(header),
      planetModule: rect(document.querySelector('.asterion-header__planet-module')),
      orbit: rect(document.querySelector('.asterion-header__planet-orbit')),
      workspace: rect(workspace),
      primaryRoutes: Array.from(document.querySelectorAll('[data-qa-navigation="primary"] [data-qa-route]')).map((element) => element.getAttribute('data-qa-route')),
      utilityRoutes: Array.from(document.querySelectorAll('[data-qa-navigation="utility"] [data-qa-route]')).map((element) => element.getAttribute('data-qa-route')),
      headerStyle: {
        top: getComputedStyle(header).top,
        height: getComputedStyle(header).height,
      },
      workspaceStyle: {
        top: getComputedStyle(workspace).top,
        bottom: getComputedStyle(workspace).bottom,
      },
      zones,
      genericHeaderClasses: ['.resources', '.resource-chip', '.campaign-block'].filter((selector) => header?.querySelector(selector)),
      horizontalOverflow: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) > window.innerWidth + 2,
      faction: header?.getAttribute('data-faction') ?? null,
    };
    return values;
  })()`);
}

async function readTooltipContract(win) {
  await win.webContents.executeJavaScript(`(() => {
    const chip = document.querySelector('[data-qa-resource-chip="metal"]');
    chip?.focus();
    return document.activeElement === chip;
  })()`);
  await settle(win);
  return win.webContents.executeJavaScript(`(() => {
    const chip = document.querySelector('[data-qa-resource-chip="metal"]');
    const tooltip = document.querySelector('[data-qa-resource-tooltip="metal"]');
    return {
      focusable: chip instanceof HTMLElement && chip.tabIndex >= 0,
      describedBy: chip?.getAttribute('aria-describedby') ?? null,
      text: tooltip?.textContent?.replace(/\\s+/g, ' ').trim() ?? '',
    };
  })()`);
}

async function readThemeContract(win) {
  return win.webContents.executeJavaScript(`(() => {
    const header = document.querySelector('[data-qa-header]');
    const original = header?.getAttribute('data-faction');
    const accents = {};
    for (const faction of ['aegis', 'synod', 'veyra']) {
      header?.setAttribute('data-faction', faction);
      accents[faction] = getComputedStyle(header).getPropertyValue('--header-accent').trim();
    }
    if (header && original) header.setAttribute('data-faction', original);
    return accents;
  })()`);
}

function assertContract(label, header, tooltip, themes) {
  const expectedPrimary = PRIMARY_ROUTES.map(([id]) => id);
  if (JSON.stringify(header.primaryRoutes) !== JSON.stringify(expectedPrimary)) {
    throw new Error(`${label}: primary route IDs are not stable`);
  }
  if (JSON.stringify(header.utilityRoutes) !== JSON.stringify(UTILITY_ROUTES)) {
    throw new Error(`${label}: utility route IDs are not stable`);
  }
  if (header.genericHeaderClasses.length) throw new Error(`${label}: generic header classes are still visual owners`);
  if (header.horizontalOverflow) throw new Error(`${label}: horizontal overflow detected`);
  if (header.headerStyle.top !== '20px' || header.headerStyle.height !== '220px') {
    throw new Error(`${label}: canonical header geometry drifted`);
  }
  if (!header.workspace || header.workspaceStyle.top !== '246px') throw new Error(`${label}: workspace top is not tied to header geometry`);

  for (const [zone, [left, top]] of Object.entries(EXPECTED_ZONE_POSITIONS)) {
    const item = header.zones[zone];
    if (!item || item.position !== 'absolute' || item.left !== left || item.top !== top) {
      throw new Error(`${label}: ${zone} zone is not in the radial HUD position`);
    }
  }
  const rects = Object.values(header.zones).map((item) => item.rect).filter(Boolean);
  if (rects.length !== 3 || new Set(rects.map((item) => `${item.x}:${item.y}`)).size !== 3) {
    throw new Error(`${label}: zone buttons overlap or are missing`);
  }
  if (!tooltip.focusable || !tooltip.describedBy || !tooltip.text) {
    throw new Error(`${label}: resource tooltip is not keyboard-addressable`);
  }
  if (new Set(Object.values(themes)).size !== 3) throw new Error(`${label}: faction theme accents are not distinct`);
}

async function main() {
  const results = [];
  for (const [width, height] of VIEWPORTS) {
    const win = new BrowserWindow({ width, height, show: false, webPreferences: { offscreen: true, sandbox: false } });
    try {
      await win.loadFile(path.join(ROOT, 'dist', 'index.html'));
      await waitFor(win, `document.querySelector('[data-qa-header]')`);
      await win.webContents.executeJavaScript('document.fonts?.ready');
      await settle(win);
      await clickRoute(win, 'planet');
      const header = await readHeaderContract(win);
      const tooltip = await readTooltipContract(win);
      const themes = await readThemeContract(win);
      assertContract(`${width}x${height}`, header, tooltip, themes);

      for (const [route] of PRIMARY_ROUTES) await clickRoute(win, route);
      for (const route of UTILITY_ROUTES) await clickRoute(win, route);

      results.push({
        viewport: `${width}x${height}`,
        header: header.header,
        planetModule: header.planetModule,
        workspace: header.workspace,
        themes,
      });
    } finally {
      win.destroy();
    }
  }
  console.log(JSON.stringify({ ok: true, results }, null, 2));
}

app.whenReady().then(main).then(
  () => app.quit(),
  (error) => {
    console.error(error.stack || error);
    app.exit(1);
  },
);
