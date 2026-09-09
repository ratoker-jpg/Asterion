const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-gpu');
app.on('window-all-closed', () => {});

const ROOT = path.join(__dirname, '..');
const OUTPUT = path.join(ROOT, 'artifacts-pass1', 'test-mode-qa');
const PRODUCTION_KEY = 'asterion.vertical-slice.v1';
const TEST_KEY = 'asterion.vertical-slice.test.v1';
const VIEWPORTS = [[1920, 1080], [1280, 720]];
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const skipScreenshots = process.env.ASTERION_SKIP_SCREENSHOTS === '1';

async function waitFor(win, expression, timeoutMs = 10_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await win.webContents.executeJavaScript(`Boolean(${expression})`)) return;
    await sleep(50);
  }
  throw new Error(`Timed out waiting for: ${expression}`);
}

async function settle(win) {
  // requestAnimationFrame can remain pending while Chromium lays out a very
  // tall long-page workspace. A bounded delay keeps QA deterministic; callers
  // that need a concrete state use waitFor immediately afterwards.
  await sleep(100);
}

async function loadMode(win, mode) {
  const done = new Promise((resolve) => win.webContents.once('did-finish-load', resolve));
  await win.loadFile(path.join(ROOT, 'dist', 'index.html'), mode === 'test' ? { search: '?mode=test' } : undefined);
  await done;
  await waitFor(win, `document.querySelector('.utility-navigation')`);
  await waitFor(win, `localStorage.getItem(${JSON.stringify(mode === 'test' ? TEST_KEY : PRODUCTION_KEY)})`);
  await settle(win);
}

async function reload(win, mode) {
  const done = new Promise((resolve) => win.webContents.once('did-finish-load', resolve));
  win.webContents.reload();
  await done;
  await waitFor(win, `document.querySelector('.utility-navigation')`);
  await settle(win);
  const activeKey = mode === 'test' ? TEST_KEY : PRODUCTION_KEY;
  await waitFor(win, `localStorage.getItem(${JSON.stringify(activeKey)})`);
}

async function click(win, selector) {
  const ok = await win.webContents.executeJavaScript(`(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    if (!element || element.disabled) return false;
    element.click();
    return true;
  })()`);
  if (!ok) throw new Error(`Element not found/enabled: ${selector}`);
  await settle(win);
}

async function clickText(win, selector, text) {
  const ok = await win.webContents.executeJavaScript(`(() => {
    const element = Array.from(document.querySelectorAll(${JSON.stringify(selector)}))
      .find((node) => node.textContent?.replace(/\\s+/g, ' ').trim().includes(${JSON.stringify(text)}));
    if (!element || element.disabled) return false;
    element.click();
    return true;
  })()`);
  if (!ok) throw new Error(`Text element not found/enabled: ${selector} ${text}`);
  await settle(win);
}

async function capture(win, directory, name) {
  if (skipScreenshots) {
    console.log(`[test-mode-qa] screenshot skipped: ${name}`);
    return;
  }
  await win.webContents.executeJavaScript('window.scrollTo(0, 0)');
  // Long-page mode deliberately exposes the document's natural height. Waiting
  // for another animation frame here makes Chromium lay out and paint the
  // entire page before a screenshot is requested. Navigation and interaction
  // helpers already settle the state before capture.
  await sleep(100);
  const { width, height } = await win.webContents.executeJavaScript('({ width: innerWidth, height: innerHeight })');
  const result = await win.webContents.debugger.sendCommand('Page.captureScreenshot', {
    format: 'png',
    fromSurface: false,
    captureBeyondViewport: false,
    // Capture only the visible viewport. Long-page behavior is asserted via
    // DOM geometry and overflow checks below.
    clip: { x: 0, y: 0, width, height, scale: 1 },
  });
  fs.writeFileSync(path.join(directory, `${name}.png`), Buffer.from(result.data, 'base64'));
}

async function readEnvelope(win, key) {
  return win.webContents.executeJavaScript(`JSON.parse(localStorage.getItem(${JSON.stringify(key)}) || 'null')`);
}

async function seedTestRuntime(win, changes = {}) {
  const ok = await win.webContents.executeJavaScript(`(() => {
    const save = JSON.parse(localStorage.getItem(${JSON.stringify(TEST_KEY)}) || 'null');
    const planet = save?.planets?.['helion-01'];
    if (!save || !planet) return false;
    Object.assign(planet.buildings, ${JSON.stringify(changes.buildings || {})});
    if (${changes.scienceLevels ? 'true' : 'false'}) Object.assign(save.science.levels, ${JSON.stringify(changes.scienceLevels || {})});
    if (${changes.scienceQueue ? 'true' : 'false'}) save.science.queue = ${JSON.stringify(changes.scienceQueue || [])};
    if (${changes.spaceport ? 'true' : 'false'}) {
      planet.spaceportUpgrades = ${JSON.stringify(changes.spaceport)};
    }
    save.metal = ${changes.metal ?? 1_000_000};
    save.minerals = ${changes.minerals ?? 1_000_000};
    save.gas = ${changes.gas ?? 1_000_000};
    planet.energy = ${changes.energy ?? 1_000_000};
    localStorage.setItem(${JSON.stringify(TEST_KEY)}, JSON.stringify(save));
    return true;
  })()`);
  if (!ok) throw new Error('Could not seed Test Mode runtime');
  await reload(win, 'test');
}

async function openScience(win) {
  await clickText(win, '.utility-navigation button', 'Наука');
  await waitFor(win, `document.querySelector('[data-qa-science-root]')`);
}

async function openSpaceport(win, track = 'ships') {
  await click(win, '.header-zone--military');
  await waitFor(win, `document.querySelector('[data-qa-zone-view][data-zone="military"]')`);
  await click(win, '[data-zone-building-role="spaceport"]');
  await waitFor(win, `document.querySelector('[data-qa-building-dialog="spaceport"]')`);
  await click(win, '[data-qa-enter-building="spaceport"]');
  await waitFor(win, `document.querySelector('[data-qa-spaceport-upgrades]')`);
  if (track === 'commanders') await click(win, '[data-qa-spaceport-tab="commanders"]');
}

async function openFleet(win) {
  await clickText(win, '.primary-navigation button', 'Флоты');
  await waitFor(win, `document.querySelector('.fleet-workspace-v1')`);
}

async function readQaState(win) {
  return win.webContents.executeJavaScript(`(() => {
    const test = JSON.parse(localStorage.getItem(${JSON.stringify(TEST_KEY)}) || 'null');
    const production = JSON.parse(localStorage.getItem(${JSON.stringify(PRODUCTION_KEY)}) || 'null');
    const mode = document.querySelector('[data-qa-runtime-mode]')?.getAttribute('data-qa-runtime-mode') ?? 'production';
    const active = mode === 'test' ? test : production;
    const planet = active?.planets?.['helion-01'];
    const horizontalOverflow = document.documentElement.scrollWidth > innerWidth + 2 || document.body.scrollWidth > innerWidth + 2;
    return {
      mode,
      banner: Boolean(document.querySelector('[data-qa-test-mode-banner]')),
      scale: document.querySelector('[data-qa-test-time-scale]')?.textContent?.trim() ?? '',
      testResources: { metal: test?.metal, minerals: test?.minerals, gas: test?.gas, energy: planet?.energy },
      productionResources: { metal: production?.metal, minerals: production?.minerals, gas: production?.gas },
      buildings: planet?.buildings ?? null,
      fleet: planet?.fleet ?? null,
      scienceLevels: active?.science?.levels ?? null,
      buildingQueue: active?.queues?.['helion-01']?.length ?? -1,
      scienceQueue: active?.science?.queue?.length ?? -1,
      shipQueue: planet?.spaceportUpgrades?.shipQueue?.length ?? -1,
      commanderQueue: planet?.spaceportUpgrades?.commanderQueue?.length ?? -1,
      horizontalOverflow,
      fleetPageLong: document.documentElement.classList.contains('asterion-long-page'),
      populationChips: Array.from(document.querySelectorAll('.header-resource-rail .resource-chip--population'))
        .map((node) => node.textContent?.replace(/\s+/g, ' ').trim() ?? ''),
      fleetPopulation: document.querySelector('[data-qa-fleet-population]')?.textContent?.trim() ?? '',
      fleetFlightActions: Array.from(document.querySelectorAll('.fleet-flight-actions-v1 button')).map((node) => ({
        text: node.textContent?.replace(/\s+/g, ' ').trim() ?? '',
        top: node.getBoundingClientRect().top,
        bottom: node.getBoundingClientRect().bottom,
      })),
      fleetFlightPanelBottom: document.querySelector('.fleet-flights-v1')?.getBoundingClientRect().bottom ?? -1,
      fleetRosterOverflow: (() => {
        const node = document.querySelector('[data-qa-fleet-roster]');
        return node ? node.scrollHeight > node.clientHeight + 2 : false;
      })(),
      fleetRosterOverflowY: (() => {
        const node = document.querySelector('[data-qa-fleet-roster]');
        return node ? getComputedStyle(node).overflowY : '';
      })(),
      fleetRoster: Array.from(document.querySelectorAll('[data-qa-fleet-ship]')).map((node) => ({
        id: node.getAttribute('data-qa-fleet-ship'),
        owned: Number(node.querySelector('[data-qa-fleet-owned]')?.textContent || 0),
        population: Number(node.querySelector('[data-qa-fleet-unit-population]')?.textContent || 0),
      })),
    };
  })()`);
}

async function runViewport(width, height) {
  const label = `${width}x${height}`;
  const directory = path.join(OUTPUT, label);
  fs.mkdirSync(directory, { recursive: true });
  const win = new BrowserWindow({ width, height, show: false, webPreferences: { sandbox: false } });
  win.webContents.on('console-message', (_event, _level, message) => {
    if (/error/i.test(message)) console.warn(`[${label}] renderer: ${message}`);
  });

  try {
    await loadMode(win, 'production');
    win.webContents.debugger.attach('1.3');
    await win.webContents.executeJavaScript(`localStorage.removeItem(${JSON.stringify(PRODUCTION_KEY)}); localStorage.removeItem(${JSON.stringify(TEST_KEY)});`);
    await reload(win, 'production');
    const productionInitial = await readQaState(win);
    if (productionInitial.mode !== 'production' || productionInitial.banner || productionInitial.testResources.metal === 1_000_000 || !productionInitial.scienceLevels || Object.values(productionInitial.scienceLevels).some((level) => level !== 0) || await win.webContents.executeJavaScript(`document.querySelectorAll('[data-qa-test-speed]').length`) !== 0) {
      throw new Error(`${label}: production isolation/fixture mismatch ${JSON.stringify(productionInitial)}`);
    }
    await capture(win, directory, 'production-overview');
    const productionBeforeTest = await readEnvelope(win, PRODUCTION_KEY);

    await loadMode(win, 'test');
    const initial = await readQaState(win);
    if (initial.mode !== 'test' || !initial.banner || !initial.scale.includes('×15') || initial.testResources.metal !== 999_999_999 || initial.testResources.minerals !== 999_999_999 || initial.testResources.gas !== 999_999_999 || initial.testResources.energy !== 999_999_999 || initial.buildingQueue !== 0 || initial.scienceQueue !== 0 || initial.shipQueue !== 0 || initial.commanderQueue !== 0) {
      throw new Error(`${label}: Test Mode fixture mismatch ${JSON.stringify(initial)}`);
    }
    const speedButtons = await win.webContents.executeJavaScript(`Array.from(document.querySelectorAll('[data-qa-test-speed]')).map((node) => node.getAttribute('data-qa-test-speed'))`);
    if (JSON.stringify(speedButtons) !== JSON.stringify(['1', '10', '15', '100', '200', '300', '500'])) {
      throw new Error(`${label}: Test Mode speed selector mismatch ${JSON.stringify(speedButtons)}`);
    }
    await click(win, '[data-qa-test-speed="500"]');
    await waitFor(win, `document.querySelector('[data-qa-test-time-scale]')?.textContent?.includes('×500')`);
    await click(win, '[data-qa-test-speed="15"]');
    await reload(win, 'test');
    if (!(await win.webContents.executeJavaScript(`document.querySelector('[data-qa-test-time-scale]')?.textContent?.includes('×15')`))) {
      throw new Error(`${label}: Test Mode speed selection did not persist`);
    }
    if (initial.populationChips.length !== 1 || !initial.populationChips[0].includes('58 / 120')) {
      throw new Error(`${label}: population must use the unified fleet entity/capacity display ${JSON.stringify(initial.populationChips)}`);
    }
    const canonicalBuildingLevelOne = new Set(['metal-production-1', 'mineral-production-1', 'gas-production-1', 'basic-energy', 'hangar']);
    const canonicalBuildingsOnly = canonicalBuildingLevelOne.size === Object.values(initial.buildings || {}).filter((level) => level === 1).length
      && [...canonicalBuildingLevelOne].every((id) => initial.buildings?.[id] === 1)
      && Object.entries(initial.buildings || {}).every(([id, level]) => canonicalBuildingLevelOne.has(id) ? level === 1 : level === 0);
    const canonicalFleetShips = { scout: 20, transporter: 10, recycler: 1, 'spy-probe': 3 };
    const canonicalFleetOnly = Object.entries(initial.fleet?.ships || {}).every(([id, count]) => count === (canonicalFleetShips[id] || 0))
      && Object.values(initial.fleet?.commanders || {}).every((count) => count === 0);
    if (!canonicalBuildingsOnly || !canonicalFleetOnly || initial.buildings?.hangar !== 1 || initial.fleet?.ships?.scout !== 20 || initial.fleet?.ships?.transporter !== 10 || initial.fleet?.ships?.recycler !== 1 || initial.fleet?.ships?.['spy-probe'] !== 3) {
      throw new Error(`${label}: canonical building/fleet mismatch ${JSON.stringify(initial)}`);
    }
    await capture(win, directory, 'test-overview');
    await clickText(win, '.shell-notice button', 'СБРОСИТЬ ТЕСТОВОЕ СОХРАНЕНИЕ');
    await waitFor(win, `JSON.parse(localStorage.getItem(${JSON.stringify(TEST_KEY)}) || '{}').metal === 999999999`);
    const afterTestReset = await readQaState(win);
    const productionAfterReset = await readEnvelope(win, PRODUCTION_KEY);
    if (afterTestReset.testResources.metal !== 999_999_999 || productionAfterReset.metal !== productionBeforeTest.metal) throw new Error(`${label}: Test Mode reset crossed save keys`);

    await win.webContents.executeJavaScript(`(() => {
      const save = JSON.parse(localStorage.getItem(${JSON.stringify(TEST_KEY)}) || 'null');
      const fleet = save?.planets?.['helion-01']?.fleet;
      if (!fleet) return false;
      fleet.commanders = { ...(fleet.commanders || {}), corsair: 1 };
      localStorage.setItem(${JSON.stringify(TEST_KEY)}, JSON.stringify(save));
      return true;
    })()`);
    await reload(win, 'test');
    await openFleet(win);
    const commanderFleet = await readQaState(win);
    if (!commanderFleet.fleetPopulation.includes('66 / 120')) throw new Error(`${label}: commander population was not included in fleet capacity ${JSON.stringify(commanderFleet)}`);

    await win.webContents.executeJavaScript(`(() => {
      const save = JSON.parse(localStorage.getItem(${JSON.stringify(TEST_KEY)}) || 'null');
      const fleet = save?.planets?.['helion-01']?.fleet;
      if (!fleet) return false;
      fleet.commanders = { ...(fleet.commanders || {}), corsair: 0 };
      delete save.planets['helion-01'].fleet;
      localStorage.setItem(${JSON.stringify(TEST_KEY)}, JSON.stringify(save));
      return true;
    })()`);
    await reload(win, 'test');
    const legacyFleet = await readQaState(win);
    if (legacyFleet.fleet?.ships?.scout !== 20 || legacyFleet.fleet?.ships?.transporter !== 10 || legacyFleet.fleet?.ships?.recycler !== 1 || legacyFleet.fleet?.ships?.['spy-probe'] !== 3) {
      throw new Error(`${label}: legacy save without fleet did not receive canonical fleet ${JSON.stringify(legacyFleet)}`);
    }

    await openScience(win);
    const scienceBlocked = await win.webContents.executeJavaScript(`(() => { const row = document.querySelector('[data-qa-science-id="1"]'); return { status: row?.getAttribute('data-qa-science-status'), disabled: Boolean(row?.querySelector('[data-qa-science-action]')?.disabled) }; })()`);
    if (scienceBlocked.status !== 'requirements-unmet' || !scienceBlocked.disabled) throw new Error(`${label}: Science requirements were bypassed ${JSON.stringify(scienceBlocked)}`);

    await seedTestRuntime(win, { buildings: { construction: 1, research: 1 } });
    await openScience(win);
    for (let index = 0; index < 3; index += 1) await click(win, '[data-qa-science-id="1"] [data-qa-science-action]');
    await waitFor(win, `document.querySelector('[data-qa-science-queue-count]')?.textContent === '3/3'`);
    await capture(win, directory, 'test-science-queue-3of3');
    const scienceQueue = await readEnvelope(win, TEST_KEY);
    if (scienceQueue.science.queue.length !== 3) throw new Error(`${label}: Science queue did not persist three tasks`);

    const finishedScienceTask = [{
      id: 'qa-offline-science', scienceId: 1, fromLevel: 0, toLevel: 1,
      startedAt: Date.now() - 2_000, finishAt: Date.now() - 1_000, durationMs: 1_000,
      cost: { metal: 1, minerals: 1, gas: 1, energy: 0 },
    }];
    await seedTestRuntime(win, { buildings: { construction: 1, research: 1 }, scienceLevels: { 1: 0 }, scienceQueue: finishedScienceTask });
    await openScience(win);
    await waitFor(win, `document.querySelector('[data-qa-science-queue-count]')?.textContent === '0/3'`);
    const scienceOffline = await readEnvelope(win, TEST_KEY);
    if (scienceOffline.science.levels[1] !== 1 || scienceOffline.science.queue.length !== 0) throw new Error(`${label}: Science offline completion failed`);
    await reload(win, 'test');
    const scienceSecondReload = await readEnvelope(win, TEST_KEY);
    if (scienceSecondReload.science.levels[1] !== 1 || scienceSecondReload.science.queue.length !== 0) throw new Error(`${label}: Science completion duplicated after reload`);

    const emptySpaceport = { shipLevels: {}, shipQueue: [], commanderQueue: [] };
    await seedTestRuntime(win, {
      buildings: { construction: 1, research: 1, spaceport: 1, shipyard: 1 },
      scienceLevels: { 4: 1 },
      spaceport: emptySpaceport,
    });
    await openSpaceport(win, 'ships');
    const requirementState = await win.webContents.executeJavaScript(`(() => { const row = document.querySelector('[data-qa-spaceport-card="scout"]'); return { badges: row?.querySelectorAll('[data-qa-spaceport-requirement-badge]').length ?? 0, statuses: Array.from(row?.querySelectorAll('[data-qa-spaceport-requirement-badge]') ?? []).map((node) => node.getAttribute('data-qa-spaceport-requirement-status')), duration: Number(row?.getAttribute('data-qa-spaceport-duration-ms') || 0) }; })()`);
    if (requirementState.badges < 2 || requirementState.statuses.some((status) => status !== 'met') || requirementState.duration >= 900_000) throw new Error(`${label}: Spaceport requirement/acceleration mismatch ${JSON.stringify(requirementState)}`);
    for (let index = 0; index < 3; index += 1) await click(win, '[data-qa-spaceport-upgrade="scout"]');
    await waitFor(win, `document.querySelector('[data-qa-spaceport-queue-count]')?.getAttribute('data-qa-spaceport-queue-count') === '3/3'`);
    const ordinaryFull = await win.webContents.executeJavaScript(`(() => { const row = document.querySelector('[data-qa-spaceport-card="scout"]'); return { disabled: Boolean(row?.querySelector('[data-qa-spaceport-upgrade]')?.disabled), positions: Array.from(row?.querySelectorAll('[data-qa-spaceport-queued-position]') ?? []).map((node) => node.getAttribute('data-qa-spaceport-queued-position')) }; })()`);
    if (!ordinaryFull.disabled || JSON.stringify(ordinaryFull.positions) !== JSON.stringify(['1', '2', '3'])) throw new Error(`${label}: ordinary Spaceport queue contract failed ${JSON.stringify(ordinaryFull)}`);
    await click(win, '[data-qa-spaceport-tab="commanders"]');
    for (let index = 0; index < 2; index += 1) await click(win, '[data-qa-spaceport-upgrade="corsair"]');
    await waitFor(win, `document.querySelector('[data-qa-spaceport-queue-count]')?.getAttribute('data-qa-spaceport-queue-count') === '2/3'`);
    await capture(win, directory, 'test-spaceport-both-queues');

    const afterQueues = await readEnvelope(win, TEST_KEY);
    if (afterQueues.planets['helion-01'].spaceportUpgrades.shipQueue.length !== 3 || afterQueues.planets['helion-01'].spaceportUpgrades.commanderQueue.length !== 2) throw new Error(`${label}: parallel Spaceport queues were not persisted ${JSON.stringify(afterQueues.planets['helion-01'].spaceportUpgrades)}`);
    if (productionBeforeTest.metal !== (await readEnvelope(win, PRODUCTION_KEY)).metal) throw new Error(`${label}: Test Mode changed production save`);

    const offlineSpaceport = {
      ...afterQueues.planets['helion-01'].spaceportUpgrades,
      shipQueue: [{ ...afterQueues.planets['helion-01'].spaceportUpgrades.shipQueue[0], startedAt: Date.now() - 2_000, finishAt: Date.now() - 1_000, effectiveDurationMs: 1_000 }],
      commanderQueue: [],
    };
    await seedTestRuntime(win, { buildings: { construction: 1, research: 1, spaceport: 1, shipyard: 1 }, scienceLevels: { 4: 1 }, spaceport: offlineSpaceport });
    await openSpaceport(win, 'ships');
    await waitFor(win, `document.querySelector('[data-qa-spaceport-card="scout"] [data-qa-current-level]')?.getAttribute('data-qa-current-level') === '1'`);
    const offlineOnce = await readEnvelope(win, TEST_KEY);
    await reload(win, 'test');
    const offlineTwice = await readEnvelope(win, TEST_KEY);
    if (offlineOnce.planets['helion-01'].spaceportUpgrades.shipLevels.scout !== 1 || offlineTwice.planets['helion-01'].spaceportUpgrades.shipLevels.scout !== 1) throw new Error(`${label}: Spaceport offline completion was not exact-once`);

    const maxSpaceport = { shipLevels: { scout: 10, corsair: 40 }, shipQueue: [], commanderQueue: [] };
    await seedTestRuntime(win, { buildings: { construction: 1, research: 1, spaceport: 1, shipyard: 1 }, scienceLevels: { 4: 1 }, spaceport: maxSpaceport });
    await openSpaceport(win, 'ships');
    const maxShip = await win.webContents.executeJavaScript(`(() => { const row = document.querySelector('[data-qa-spaceport-card="scout"]'); return { current: row?.querySelector('[data-qa-current-level]')?.getAttribute('data-qa-current-level'), max: row?.querySelector('[data-qa-max-level]')?.getAttribute('data-qa-max-level'), disabled: Boolean(row?.querySelector('[data-qa-spaceport-upgrade]')?.disabled) }; })()`);
    await click(win, '[data-qa-spaceport-tab="commanders"]');
    const maxCommander = await win.webContents.executeJavaScript(`(() => { const row = document.querySelector('[data-qa-spaceport-card="corsair"]'); return { current: row?.querySelector('[data-qa-current-level]')?.getAttribute('data-qa-current-level'), max: row?.querySelector('[data-qa-max-level]')?.getAttribute('data-qa-max-level'), disabled: Boolean(row?.querySelector('[data-qa-spaceport-upgrade]')?.disabled) }; })()`);
    if (maxShip.current !== '10' || maxShip.max !== '10' || !maxShip.disabled || maxCommander.current !== '40' || maxCommander.max !== '40' || !maxCommander.disabled) throw new Error(`${label}: max levels mismatch ${JSON.stringify({ maxShip, maxCommander })}`);

    await openFleet(win);
    const fleetRoot = await readQaState(win);
    if (!fleetRoot.fleetPopulation.includes('58 / 120')) throw new Error(`${label}: fleet population resolver UI mismatch ${JSON.stringify(fleetRoot)}`);
    const expectedFleetRoster = [
      { id: 'spy-probe', owned: 3, population: 1 },
      { id: 'transporter', owned: 10, population: 1 },
      { id: 'recycler', owned: 1, population: 5 },
      { id: 'scout', owned: 20, population: 2 },
    ];
    if (JSON.stringify(fleetRoot.fleetRoster) !== JSON.stringify(expectedFleetRoster)) throw new Error(`${label}: current fleet roster UI mismatch ${JSON.stringify(fleetRoot.fleetRoster)}`);
    if (fleetRoot.fleetRosterOverflow || fleetRoot.fleetRosterOverflowY !== 'visible') throw new Error(`${label}: fleet roster still owns an internal scrollbar ${JSON.stringify(fleetRoot)}`);
    if (fleetRoot.fleetFlightActions.length !== 3 || fleetRoot.fleetFlightActions.some((action) => action.bottom > fleetRoot.fleetFlightPanelBottom + 2 || action.bottom <= action.top)) {
      throw new Error(`${label}: fleet flight action buttons are clipped or missing ${JSON.stringify(fleetRoot)}`);
    }
    await capture(win, directory, 'test-fleet-roster');

    await win.webContents.executeJavaScript(`(() => {
      const save = JSON.parse(localStorage.getItem(${JSON.stringify(TEST_KEY)}) || 'null');
      const fleet = save?.planets?.['helion-01']?.fleet;
      if (!fleet) return false;
      for (const id of Object.keys(fleet.ships || {})) {
        if (id !== 'death-star') fleet.ships[id] = Math.max(1, Number(fleet.ships[id] || 0));
      }
      localStorage.setItem(${JSON.stringify(TEST_KEY)}, JSON.stringify(save));
      return true;
    })()`);
    await reload(win, 'test');
    await openFleet(win);
    const expandedFleet = await readQaState(win);
    if (!expandedFleet.fleetPageLong || expandedFleet.fleetRoster.length < 8 || expandedFleet.fleetRosterOverflow || expandedFleet.fleetRosterOverflowY !== 'visible') {
      throw new Error(`${label}: expanded fleet did not use the global page scroll ${JSON.stringify(expandedFleet)}`);
    }
    await capture(win, directory, 'test-fleet-roster-expanded');

    await win.webContents.executeJavaScript(`(() => {
      const save = JSON.parse(localStorage.getItem(${JSON.stringify(TEST_KEY)}) || 'null');
      const fleet = save?.planets?.['helion-01']?.fleet;
      if (!fleet) return false;
      for (const id of Object.keys(fleet.ships || {})) fleet.ships[id] = 0;
      Object.assign(fleet.ships, { scout: 20, transporter: 10, recycler: 1, 'spy-probe': 3 });
      localStorage.setItem(${JSON.stringify(TEST_KEY)}, JSON.stringify(save));
      return true;
    })()`);
    await reload(win, 'test');
    await openFleet(win);
    const restoredFleet = await readQaState(win);
    if (!restoredFleet.fleetPageLong || restoredFleet.fleetRosterOverflow || restoredFleet.fleetRosterOverflowY !== 'visible' || !restoredFleet.fleetPopulation.includes('58 / 120')) {
      throw new Error(`${label}: canonical fleet restore after global-scroll QA failed ${JSON.stringify(restoredFleet)}`);
    }
    await clickText(win, '.fleet-sidebar-v1 button', 'Корабли');
    await waitFor(win, `document.querySelector('[data-qa-fleet-summary]')`);
    const fleetUi = await readQaState(win);
    if (!fleetUi.fleetPopulation.includes('58 / 120') || !(await documentHasNoOverflow(win))) throw new Error(`${label}: fleet construction UI mismatch`);
    await capture(win, directory, 'test-fleet-construction');

    const final = await readQaState(win);
    if (final.horizontalOverflow) throw new Error(`${label}: horizontal overflow detected`);
    return {
      viewport: label,
      screenshots: skipScreenshots ? [] : fs.readdirSync(directory).filter((name) => name.endsWith('.png')).sort(),
      screenshotsSkipped: skipScreenshots,
      final,
    };
  } finally {
    if (!win.isDestroyed()) {
      try { win.webContents.debugger.detach(); } catch {}
      await win.close();
    }
  }
}

async function documentHasNoOverflow(win) {
  return win.webContents.executeJavaScript('document.documentElement.scrollWidth <= innerWidth + 2 && document.body.scrollWidth <= innerWidth + 2');
}

async function main() {
  fs.mkdirSync(OUTPUT, { recursive: true });
  const results = [];
  try {
    for (const [width, height] of VIEWPORTS) {
      results.push(await runViewport(width, height));
    }
    fs.writeFileSync(path.join(OUTPUT, 'result.json'), JSON.stringify({ results }, null, 2));
    console.log(JSON.stringify({ results }, null, 2));
  } finally {
    app.quit();
  }
}

app.whenReady().then(main).catch((error) => {
  console.error(error.stack || error);
  app.exit(1);
});
