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
const TEST_SAVE_KEY = 'asterion.vertical-slice.test.v1';
const TEST_RESOURCE_CAPACITIES = {
  metal: 450_100_000,
  minerals: 300_100_000,
  gas: 189_382_930,
};
const REPRESENTATIVE_RATIOS = [10, 37, 60, 75, 85, 86, 95];
const EXPECTED_RESOURCE_COLORS = {
  normal: 'rgb(53,229,138)',
  positive: 'rgb(139,227,107)',
  watch: 'rgb(217,237,121)',
  warning: 'rgb(255,225,90)',
  danger: 'rgb(255,179,71)',
  critical: 'rgb(240,68,94)',
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
  await waitFor(win, `document.querySelector('[data-qa-route="${route}"][aria-current="page"]')`);
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
      primaryCurrent: Array.from(document.querySelectorAll('[data-qa-navigation="primary"] [data-qa-route][aria-current="page"]')).map((element) => element.getAttribute('data-qa-route')),
      utilityCurrent: Array.from(document.querySelectorAll('[data-qa-navigation="utility"] [data-qa-route][aria-current="page"]')).map((element) => element.getAttribute('data-qa-route')),
      resources: Array.from(document.querySelectorAll('[data-qa-resource-chip]')).map((element) => ({
        kind: element.getAttribute('data-qa-resource-chip'),
        fill: Boolean(element.querySelector('.asterion-header__resource-fill')),
        value: element.querySelector('strong')?.textContent?.trim() ?? '',
        ratio: Number(element.getAttribute('data-qa-resource-ratio') || 0),
        tone: element.getAttribute('data-qa-resource-tone'),
        pulse: element.getAttribute('data-qa-resource-pulse') === 'true',
        fillHeight: element.querySelector('.asterion-header__resource-fill')
          ? getComputedStyle(element.querySelector('.asterion-header__resource-fill')).height
          : null,
        fillColor: element.querySelector('.asterion-header__resource-fill i')
          ? getComputedStyle(element.querySelector('.asterion-header__resource-fill i')).backgroundColor
          : null,
        fillAnimationName: element.querySelector('.asterion-header__resource-fill i')
          ? getComputedStyle(element.querySelector('.asterion-header__resource-fill i')).animationName
          : null,
        fillAnimationDuration: element.querySelector('.asterion-header__resource-fill i')
          ? getComputedStyle(element.querySelector('.asterion-header__resource-fill i')).animationDuration
          : null,
      })),
      resourceRail: rect(document.querySelector('[data-qa-resource-rail]')),
      resourceRects: Array.from(document.querySelectorAll('[data-qa-resource-chip]')).map((element) => rect(element)),
      campaignRects: {
        campaign: rect(document.querySelector('[data-qa-campaign]')),
        status: rect(document.querySelector('.asterion-header__campaign-status')),
        time: rect(document.querySelector('.asterion-header__campaign time')),
        utility: rect(document.querySelector('[data-qa-navigation="utility"]')),
      },
      headerStyle: {
        top: getComputedStyle(header).top,
        height: getComputedStyle(header).height,
      },
      workspaceStyle: {
        top: getComputedStyle(workspace).top,
        bottom: getComputedStyle(workspace).bottom,
      },
      zones,
      reducedMotion: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
      genericHeaderClasses: ['.resources', '.resource-chip', '.campaign-block'].filter((selector) => header?.querySelector(selector)),
      horizontalOverflow: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) > window.innerWidth + 2,
      faction: header?.getAttribute('data-faction') ?? null,
    };
    return values;
  })()`);
}

async function readResourceContract(win) {
  return win.webContents.executeJavaScript(`(() => Array.from(document.querySelectorAll('[data-qa-resource-chip]')).map((element) => ({
    kind: element.getAttribute('data-qa-resource-chip'),
    ratio: Number(element.getAttribute('data-qa-resource-ratio') || 0),
    tone: element.getAttribute('data-qa-resource-tone'),
    pulse: element.getAttribute('data-qa-resource-pulse') === 'true',
    fill: Boolean(element.querySelector('.asterion-header__resource-fill')),
    color: element.querySelector('.asterion-header__resource-fill i')
      ? getComputedStyle(element.querySelector('.asterion-header__resource-fill i')).backgroundColor
      : null,
    animationName: element.querySelector('.asterion-header__resource-fill i')
      ? getComputedStyle(element.querySelector('.asterion-header__resource-fill i')).animationName
      : null,
    animationDuration: element.querySelector('.asterion-header__resource-fill i')
      ? getComputedStyle(element.querySelector('.asterion-header__resource-fill i')).animationDuration
      : null,
  })))()`);
}

function expectedResourceTone(ratio) {
  if (ratio <= 20) return 'normal';
  if (ratio <= 40) return 'positive';
  if (ratio <= 55) return 'watch';
  if (ratio <= 70) return 'warning';
  if (ratio <= 85) return 'danger';
  return 'critical';
}

async function loadMode(win, file, search) {
  await win.loadFile(file, search ? { search } : undefined);
  await waitFor(win, `document.querySelector('[data-qa-header]')`);
  await win.webContents.executeJavaScript('document.fonts?.ready');
  await settle(win);
}

async function assertRepresentativeRatios(win, file, label) {
  const original = await win.webContents.executeJavaScript(`localStorage.getItem(${JSON.stringify(TEST_SAVE_KEY)})`);
  const parsed = original ? JSON.parse(original) : {};
  const originalHomeworld = parsed.planets?.['helion-01'] ?? {};
  const originalBuildings = originalHomeworld.buildings ?? {};
  const baseline = {
    ...parsed,
    schemaVersion: 12,
    metal: 0,
    minerals: 0,
    gas: 0,
    planets: {
      ...parsed.planets,
      'helion-01': {
        ...originalHomeworld,
        buildings: {
          ...originalBuildings,
          'metal-production-1': 0,
          'metal-production-2': 0,
          'metal-production-3': 0,
          'mineral-production-1': 0,
          'mineral-production-2': 0,
          'gas-production-1': 0,
          'gas-production-2': 0,
          'basic-energy': 0,
          'advanced-energy': 0,
          'metal-storage': 20,
          'mineral-storage': 20,
          'gas-storage': 20,
        },
        productionBots: { metal: 0, minerals: 0, gas: 0 },
      },
    },
    resourceClock: {
      lastReconciledAt: Date.now(),
      remainder: { metal: 0, minerals: 0, gas: 0, energy: 0 },
    },
  };

  try {
    const reducedMotion = await win.webContents.executeJavaScript(`window.matchMedia('(prefers-reduced-motion: reduce)').matches`);
    await win.webContents.executeJavaScript(`localStorage.setItem(${JSON.stringify(TEST_SAVE_KEY)}, ${JSON.stringify(JSON.stringify(baseline))})`);
    await loadMode(win, file, '?mode=test');
    for (const ratio of REPRESENTATIVE_RATIOS) {
      const seeded = {
        ...baseline,
        metal: Math.floor(TEST_RESOURCE_CAPACITIES.metal * ratio / 100),
        minerals: Math.floor(TEST_RESOURCE_CAPACITIES.minerals * ratio / 100),
        gas: Math.floor(TEST_RESOURCE_CAPACITIES.gas * ratio / 100),
        resourceClock: {
          lastReconciledAt: Date.now(),
          remainder: { metal: 0, minerals: 0, gas: 0, energy: 0 },
        },
      };
      await win.webContents.executeJavaScript(`localStorage.setItem(${JSON.stringify(TEST_SAVE_KEY)}, ${JSON.stringify(JSON.stringify(seeded))})`);
      await win.reload();
      await waitFor(win, `document.querySelector('[data-qa-header]')`);
      await settle(win);

      const resources = await readResourceContract(win);
      for (const kind of ['metal', 'mineral', 'gas']) {
        const storageKey = kind === 'mineral' ? 'minerals' : kind;
        const item = resources.find((candidate) => candidate.kind === kind);
        const expectedRatio = (seeded[storageKey] / TEST_RESOURCE_CAPACITIES[storageKey]) * 100;
        const expectedTone = expectedResourceTone(ratio);
        const normalizedColor = item?.color?.replace(/\s+/g, '') ?? null;
        const expectedPulse = ratio > 85;
        const hasPulseAnimation = item?.animationName === 'asterion-header-resource-critical-pulse' && item.animationDuration !== '0s';
        const reducedMotionPulse = item?.animationName === 'none' && item.animationDuration === '0s';
        const pulseContract = expectedPulse
          ? (hasPulseAnimation || (reducedMotion && reducedMotionPulse))
          : !hasPulseAnimation;
        if (!item || Math.abs(item.ratio - expectedRatio) > 0.0001 || item.tone !== expectedTone || item.pulse !== expectedPulse || !pulseContract || !item.fill || normalizedColor !== EXPECTED_RESOURCE_COLORS[expectedTone]) {
          throw new Error(`${label}: representative ${ratio}% ${kind} contract failed: ${JSON.stringify({ item, expectedRatio, expectedTone, expectedPulse, hasPulseAnimation, reducedMotion })}`);
        }
      }

      const population = resources.find((candidate) => candidate.kind === 'population');
      const energy = resources.find((candidate) => candidate.kind === 'energy');
      if (!population || population.pulse || !energy || energy.fill) {
        throw new Error(`${label}: representative ${ratio}% population/energy pulse contract failed: ${JSON.stringify({ population, energy })}`);
      }
    }
  } finally {
    await win.webContents.executeJavaScript(original == null
      ? `localStorage.removeItem(${JSON.stringify(TEST_SAVE_KEY)})`
      : `localStorage.setItem(${JSON.stringify(TEST_SAVE_KEY)}, ${JSON.stringify(original)})`);
    await loadMode(win, file);
  }
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

async function readPlanetMenuContract(win) {
  const opened = await win.webContents.executeJavaScript(`(() => {
    const button = document.querySelector('[data-qa-current-planet]');
    if (!button) return false;
    button.click();
    return true;
  })()`);
  if (!opened) throw new Error('Planet selector button not found');
  await waitFor(win, `document.querySelector('[data-qa-planet-list], #asterion-header-planet-list')`);
  const openState = await win.webContents.executeJavaScript(`(() => {
    const button = document.querySelector('[data-qa-current-planet]');
    const list = document.querySelector('#asterion-header-planet-list');
    const options = Array.from(document.querySelectorAll('[data-qa-planet-option]'));
    return {
      expanded: button?.getAttribute('aria-expanded') === 'true',
      controls: button?.getAttribute('aria-controls') === list?.id,
      listbox: list?.getAttribute('role') === 'listbox',
      optionCount: options.length,
      selectedCount: options.filter((option) => option.getAttribute('aria-selected') === 'true').length,
    };
  })()`);
  await win.webContents.executeJavaScript(`document.querySelector('[data-qa-planet-option]')?.focus()`);
  await win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'ESC' });
  await win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'ESC' });
  await waitFor(win, `document.querySelector('[data-qa-current-planet]')?.getAttribute('aria-expanded') === 'false'`);
  const closedFocus = await win.webContents.executeJavaScript(`document.activeElement?.matches('[data-qa-current-planet]')`);
  return { ...openState, closedFocus };
}

async function readPlanetMenuFocusContract(win) {
  const openMenu = async () => {
    await win.webContents.executeJavaScript(`(() => {
      const button = document.querySelector('[data-qa-current-planet]');
      if (!button) return false;
      button.focus();
      button.click();
      return true;
    })()`);
    await waitFor(win, `document.querySelector('#asterion-header-planet-list')`);
  };

  const routeFocus = {};
  for (const route of ['reports', 'universe']) {
    await openMenu();
    await win.webContents.executeJavaScript(`(() => {
      const button = document.querySelector('[data-qa-route="${route}"]');
      if (!button) return false;
      button.focus();
      button.click();
      return true;
    })()`);
    await waitFor(win, `document.querySelector('[data-qa-route="${route}"][aria-current="page"]')`);
    await waitFor(win, `document.querySelector('[data-qa-current-planet]')?.getAttribute('aria-expanded') === 'false'`);
    routeFocus[route] = await win.webContents.executeJavaScript(`document.activeElement?.getAttribute('data-qa-route') === ${JSON.stringify(route)}`);
    await clickRoute(win, 'planet');
  }

  await openMenu();
  await win.webContents.executeJavaScript(`(() => {
    const button = document.querySelector('[data-qa-zone="resource"]');
    if (!button) return false;
    button.focus();
    button.click();
    return true;
  })()`);
  await waitFor(win, `document.querySelector('[data-qa-zone-view][data-zone="resource"]')`);
  await waitFor(win, `document.querySelector('[data-qa-current-planet]')?.getAttribute('aria-expanded') === 'false'`);
  const zoneFocus = await win.webContents.executeJavaScript(`document.activeElement?.getAttribute('data-qa-zone') === 'resource'`);

  await clickRoute(win, 'planet');
  await openMenu();
  await win.webContents.executeJavaScript(`document.querySelector('[data-qa-planet-option]')?.focus(); document.querySelector('[data-qa-planet-option]')?.click()`);
  await waitFor(win, `document.querySelector('[data-qa-current-planet]')?.getAttribute('aria-expanded') === 'false'`);
  const planetSelectionFocus = await win.webContents.executeJavaScript(`document.activeElement?.matches('[data-qa-current-planet]')`);

  return { routeFocus, zoneFocus, planetSelectionFocus };
}

async function readThemeContract(win) {
  return win.webContents.executeJavaScript(`(() => {
    const rect = (element) => {
      if (!element) return null;
      const value = element.getBoundingClientRect();
      return [value.x, value.y, value.width, value.height].map((part) => Math.round(part * 100) / 100);
    };
    const header = document.querySelector('[data-qa-header]');
    const original = header?.getAttribute('data-faction');
    const accents = {};
    const geometry = {};
    for (const faction of ['aegis', 'synod', 'veyra']) {
      header?.setAttribute('data-faction', faction);
      accents[faction] = getComputedStyle(header).getPropertyValue('--header-accent').trim();
      geometry[faction] = {
        header: rect(header),
        planet: rect(document.querySelector('.asterion-header__planet-module')),
        orbit: rect(document.querySelector('.asterion-header__planet-orbit')),
        resources: rect(document.querySelector('[data-qa-resource-rail]')),
      };
    }
    if (header && original) header.setAttribute('data-faction', original);
    return { accents, geometry };
  })()`);
}

function overlaps(left, right) {
  return left && right && left.x < right.x + right.width - 0.5 && left.x + left.width > right.x + 0.5 && left.y < right.y + right.height - 0.5 && left.y + left.height > right.y + 0.5;
}

function assertContract(label, header, tooltip, planetMenu, planetMenuFocus, themes) {
  const expectedPrimary = PRIMARY_ROUTES.map(([id]) => id);
  if (JSON.stringify(header.primaryRoutes) !== JSON.stringify(expectedPrimary)) {
    throw new Error(`${label}: primary route IDs are not stable`);
  }
  if (JSON.stringify(header.utilityRoutes) !== JSON.stringify(UTILITY_ROUTES)) {
    throw new Error(`${label}: utility route IDs are not stable`);
  }
  if (JSON.stringify(header.primaryCurrent) !== JSON.stringify(['planet']) || header.utilityCurrent.length) {
    throw new Error(`${label}: aria-current route state is not exclusive`);
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
  if (new Set(Object.values(themes.accents)).size !== 3) throw new Error(`${label}: faction theme accents are not distinct`);
  if (!planetMenu.expanded || !planetMenu.controls || !planetMenu.listbox || planetMenu.optionCount !== 1 || planetMenu.selectedCount !== 1 || !planetMenu.closedFocus) {
    throw new Error(`${label}: planet selector keyboard contract failed: ${JSON.stringify(planetMenu)}`);
  }
  if (!planetMenuFocus.routeFocus.reports || !planetMenuFocus.routeFocus.universe || !planetMenuFocus.zoneFocus || !planetMenuFocus.planetSelectionFocus) {
    throw new Error(`${label}: planet menu restored focus for the wrong dismissal reason: ${JSON.stringify(planetMenuFocus)}`);
  }
  const resourceKinds = header.resources.map((item) => item.kind);
  if (JSON.stringify(resourceKinds) !== JSON.stringify(['metal', 'mineral', 'gas', 'energy', 'population'])) {
    throw new Error(`${label}: resource order/count drifted: ${JSON.stringify(header.resources)}`);
  }
  for (const item of header.resources) {
    const shouldHaveFill = item.kind !== 'energy';
    const shouldPulse = ['metal', 'mineral', 'gas'].includes(item.kind) && item.ratio > 85;
    const expectedColors = {
      normal: 'rgb(53,229,138)',
      positive: 'rgb(139,227,107)',
      watch: 'rgb(217,237,121)',
      warning: 'rgb(255,225,90)',
      danger: 'rgb(255,179,71)',
      critical: 'rgb(240,68,94)',
    };
    const normalizedColor = item.fillColor?.replace(/\s+/g, '') ?? null;
    const hasPulseAnimation = item.pulse && item.fillAnimationName === 'asterion-header-resource-critical-pulse' && item.fillAnimationDuration !== '0s';
    const reducedMotionPulse = item.fillAnimationName === 'none' && item.fillAnimationDuration === '0s';
    const pulseContract = shouldPulse
      ? (hasPulseAnimation || (header.reducedMotion && reducedMotionPulse))
      : !hasPulseAnimation;
    if (item.fill !== shouldHaveFill || item.pulse !== shouldPulse || !pulseContract || (item.fill && item.fillHeight !== '7px') || (item.fill && normalizedColor !== expectedColors[item.tone]) || (item.kind === 'population' && item.value.includes('/'))) {
      throw new Error(`${label}: resource presentation contract failed: ${JSON.stringify({ ...item, reducedMotion: header.reducedMotion })}`);
    }
  }
  const resourceRects = header.resourceRects.filter(Boolean);
  const resourceRail = header.resourceRail;
  if (!resourceRail || resourceRects.some((item) => item.x < resourceRail.x - 0.5 || item.y < resourceRail.y - 0.5 || item.x + item.width > resourceRail.x + resourceRail.width + 0.5 || item.y + item.height > resourceRail.y + resourceRail.height + 0.5)) {
    throw new Error(`${label}: resource card escapes its rail ${JSON.stringify({ resourceRail, resourceRects })}`);
  }
  for (let index = 0; index < resourceRects.length; index += 1) {
    for (let other = index + 1; other < resourceRects.length; other += 1) {
      if (overlaps(resourceRects[index], resourceRects[other])) throw new Error(`${label}: resource cards overlap`);
    }
  }
  const campaignChildren = [header.campaignRects.status, header.campaignRects.time, header.campaignRects.utility].filter(Boolean);
  const campaign = header.campaignRects.campaign;
  if (!campaign || campaignChildren.some((item) => item.x < campaign.x - 0.5 || item.y < campaign.y - 0.5 || item.x + item.width > campaign.x + campaign.width + 0.5 || item.y + item.height > campaign.y + campaign.height + 0.5)) {
    throw new Error(`${label}: campaign content escapes its frame`);
  }
  for (let index = 0; index < campaignChildren.length; index += 1) {
    for (let other = index + 1; other < campaignChildren.length; other += 1) {
      if (overlaps(campaignChildren[index], campaignChildren[other])) throw new Error(`${label}: campaign content overlaps ${JSON.stringify(header.campaignRects)}`);
    }
  }
  const themeGeometry = Object.values(themes.geometry);
  if (themeGeometry.some((geometry) => JSON.stringify(geometry) !== JSON.stringify(themeGeometry[0]))) {
    throw new Error(`${label}: faction theme changed header geometry`);
  }
}

async function main() {
  const results = [];
  const file = path.join(ROOT, 'dist', 'index.html');
  for (const [width, height] of VIEWPORTS) {
    const win = new BrowserWindow({ width, height, show: false, webPreferences: { offscreen: true, sandbox: false } });
    try {
      await loadMode(win, file);
      await clickRoute(win, 'planet');
      const header = await readHeaderContract(win);
      const tooltip = await readTooltipContract(win);
      const planetMenu = await readPlanetMenuContract(win);
      const planetMenuFocus = await readPlanetMenuFocusContract(win);
      const themes = await readThemeContract(win);
      assertContract(`${width}x${height}`, header, tooltip, planetMenu, planetMenuFocus, themes);
      await assertRepresentativeRatios(win, file, `${width}x${height}`);

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
