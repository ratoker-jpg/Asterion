const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

console.log('[pirate-operations-qa] main script loaded');
process.on('uncaughtException', (error) => console.error('[pirate-operations-qa] uncaught exception', error));
process.on('unhandledRejection', (error) => console.error('[pirate-operations-qa] unhandled rejection', error));

app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-gpu');
app.on('window-all-closed', () => {});

const ROOT = path.join(__dirname, '..');
const OUTPUT = process.env.ASTERION_QA_OUTPUT || path.join(ROOT, 'artifacts', 'pirate-operations-qa');
const SAVE_KEY = 'asterion.vertical-slice.test.v1';
const TEST_TIME_SCALE_KEY = 'asterion.test-time-scale.v1';
const VIEWPORTS = [[1920, 1080], [1280, 720], [390, 844]];
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(win, expression, timeoutMs = 15_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await win.webContents.executeJavaScript(`Boolean(${expression})`)) return;
    await sleep(60);
  }
  throw new Error(`Timed out waiting for: ${expression}`);
}

async function settle(win) {
  await win.webContents.executeJavaScript('new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
  await sleep(90);
}

async function reload(win) {
  const loaded = new Promise((resolve) => win.webContents.once('did-finish-load', resolve));
  win.webContents.reload();
  await loaded;
  await waitFor(win, `document.querySelector('[data-qa-navigation="primary"]')`);
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
  if (!clicked) throw new Error(`Element not found or disabled: ${selector}`);
  await settle(win);
}

async function clickPrimary(win, route, expression) {
  await click(win, `[data-qa-navigation="primary"] [data-qa-route="${route}"]`);
  await waitFor(win, expression);
  await settle(win);
}

async function clickFolder(win, folder) {
  await click(win, `[data-message-folder="${folder}"]`);
  await waitFor(win, `document.querySelector('[data-qa-folder-view="${folder}"]')`);
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

async function readSave(win) {
  return win.webContents.executeJavaScript(`JSON.parse(localStorage.getItem(${JSON.stringify(SAVE_KEY)}) || 'null')`);
}

async function seedTestPlayer(win) {
  const result = await win.webContents.executeJavaScript(`(() => {
    try {
      if (location.search !== '?mode=test') return { ok: false, reason: 'QA must use Test Mode' };
      const save = JSON.parse(localStorage.getItem(${JSON.stringify(SAVE_KEY)}) || 'null');
      const planet = save?.planets?.[save.currentPlanetId];
      if (!save || !planet?.fleet?.ships) return { ok: false, reason: 'test save or current fleet is missing' };
      const shipIds = Object.keys(planet.fleet.ships);
      for (const id of shipIds) planet.fleet.ships[id] = id === 'scout' ? 50 : id === 'spy-probe' ? 1 : 0;
      if (planet.fleet.commanders && typeof planet.fleet.commanders === 'object') {
        for (const id of Object.keys(planet.fleet.commanders)) planet.fleet.commanders[id] = 0;
      }
      const resources = { metal: 1_000_000, minerals: 1_000_000, gas: 1_000_000 };
      planet.resources = { ...(planet.resources || {}), ...resources };
      save.metal = resources.metal;
      save.minerals = resources.minerals;
      save.gas = resources.gas;
      if (save.science?.levels && typeof save.science.levels === 'object') {
        for (const id of Object.keys(save.science.levels)) save.science.levels[id] = Math.max(save.science.levels[id] || 0, 10);
      }
      save.shipUpgradeLevels = { ...(save.shipUpgradeLevels || {}) };
      for (const id of Object.keys(save.shipUpgradeLevels)) save.shipUpgradeLevels[id] = Math.max(save.shipUpgradeLevels[id] || 0, 10);
      if (planet.spaceportUpgrades?.shipLevels) {
        for (const id of Object.keys(planet.spaceportUpgrades.shipLevels)) planet.spaceportUpgrades.shipLevels[id] = Math.max(planet.spaceportUpgrades.shipLevels[id] || 0, 10);
      }
      localStorage.setItem(${JSON.stringify(SAVE_KEY)}, JSON.stringify(save));
      localStorage.setItem(${JSON.stringify(TEST_TIME_SCALE_KEY)}, '15');
      return { ok: true, planetId: save.currentPlanetId, shipIds, testTimeScale: 15 };
    } catch (error) {
      return { ok: false, reason: String(error?.stack || error) };
    }
  })()`);
  if (!result?.ok) throw new Error(`Could not prepare the isolated Test Mode save: ${result?.reason || 'unknown error'}`);
  await reload(win);
  const inventory = await win.webContents.executeJavaScript(`(() => {
    const save = JSON.parse(localStorage.getItem(${JSON.stringify(SAVE_KEY)}) || '{}');
    const planet = save.planets?.[save.currentPlanetId];
    return { probe: Number(planet?.fleet?.ships?.['spy-probe'] || 0), scout: Number(planet?.fleet?.ships?.scout || 0), ships: Object.values(planet?.fleet?.ships || {}).reduce((sum, count) => sum + Number(count || 0), 0), timeScale: localStorage.getItem(${JSON.stringify(TEST_TIME_SCALE_KEY)}) };
  })()`);
  if (inventory.probe < 1 || inventory.scout < 50 || inventory.timeScale !== '15') throw new Error(`Test Mode fixture failed to hydrate: ${JSON.stringify(inventory)}`);
  return { ...result, inventory };
}

async function selectSystem(win, system) {
  const changed = await win.webContents.executeJavaScript(`(() => {
    const select = document.querySelector('.universe-jump select');
    if (!select) return false;
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set;
    setter?.call(select, ${JSON.stringify(String(system))});
    select.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  })()`);
  if (!changed) throw new Error('Universe system selector not found');
  await waitFor(win, `document.querySelector('[data-qa-universe]')?.getAttribute('data-qa-universe-system') === ${JSON.stringify(String(system))}`);
  await settle(win);
}

async function findActiveContact(win) {
  for (let system = 1; system <= 40; system += 1) {
    await selectSystem(win, system);
    const pirateId = await win.webContents.executeJavaScript(`document.querySelector('[data-qa-universe-kind="pirate"]')?.getAttribute('data-qa-universe-object') || ''`);
    if (!pirateId) continue;
    const selected = await win.webContents.executeJavaScript(`(() => {
      const node = document.querySelector('[data-qa-universe-kind="pirate"]');
      if (!node) return false;
      node.click();
      return true;
    })()`);
    if (!selected) continue;
    await settle(win);
    const contact = await win.webContents.executeJavaScript(`(() => {
      const recon = document.querySelector('[data-qa-universe-special-action="pirate-recon"]');
      const attack = document.querySelector('[data-qa-universe-special-action="pirate-elimination"]');
      return { id: ${JSON.stringify(pirateId)}, system: ${system}, cycleKey: recon?.getAttribute('data-qa-universe-contact-cycle') || '', reconEnabled: Boolean(recon && !recon.disabled), attackEnabled: Boolean(attack && !attack.disabled), status: document.querySelector('[data-qa-universe-special-status]')?.textContent || '', coordinate: document.querySelector('[data-qa-universe-inspector]')?.textContent?.match(/\\[\\d+:\\d+:\\d+\\]/)?.[0] || '' };
    })()`);
    const countdown = /исчезнет через (\d+) мин (\d+) с/.exec(contact.status);
    const remainingSeconds = countdown ? Number(countdown[1]) * 60 + Number(countdown[2]) : 0;
    if (contact.cycleKey && contact.reconEnabled && contact.attackEnabled && remainingSeconds > 180) {
      return { ...contact, remainingSeconds };
    }
  }
  throw new Error('No active pirate contact with an available recon action and more than three minutes remaining was visible in systems 1–40 of the current galaxy. The QA did not inject or advance the pirate schedule.');
}

async function grantTargetSystemColony(win, contact) {
  const result = await win.webContents.executeJavaScript(`(() => {
    const save = JSON.parse(localStorage.getItem(${JSON.stringify(SAVE_KEY)}) || 'null');
    const origin = save?.planets?.[save.currentPlanetId];
    if (!origin) return { ok: false, reason: 'missing homeworld' };
    // Grant only target-system ownership; the origin fleet remains on the homeworld.
    const targetPosition = Number(${JSON.stringify(contact.coordinate.split(':')[2]?.replace(']', '') || '1')});
    const colony = structuredClone(origin);
    colony.name = 'QA pirate access colony';
    colony.universeGalaxy = 1;
    colony.universeSystem = ${JSON.stringify(contact.system)};
    colony.universePosition = targetPosition === 1 ? 2 : 1;
    for (const id of Object.keys(colony.fleet.ships)) colony.fleet.ships[id] = 0;
    for (const id of Object.keys(colony.fleet.commanders ?? {})) colony.fleet.commanders[id] = 0;
    save.planets['qa-pirate-access'] = colony;
    save.queues['qa-pirate-access'] = [];
    localStorage.setItem(${JSON.stringify(SAVE_KEY)}, JSON.stringify(save));
    return { ok: true, system: colony.universeSystem };
  })()`);
  if (!result.ok) throw new Error(`Pirate raid QA could not grant target-system colony: ${result.reason}`);
  await reload(win);
}

async function reselectContact(win, contact) {
  await selectSystem(win, contact.system);
  const result = await win.webContents.executeJavaScript(`(() => {
    const node = document.querySelector('[data-qa-universe-kind="pirate"]');
    if (!node || node.getAttribute('data-qa-universe-object') !== ${JSON.stringify(contact.id)}) return null;
    node.click();
    return true;
  })()`);
  if (!result) throw new Error(`The original pirate contact ${contact.id} is no longer present in system ${contact.system}`);
  await settle(win);
  const current = await win.webContents.executeJavaScript(`(() => {
    const recon = document.querySelector('[data-qa-universe-special-action="pirate-recon"]');
    const attack = document.querySelector('[data-qa-universe-special-action="pirate-elimination"]');
    return { cycleKey: recon?.getAttribute('data-qa-universe-contact-cycle') || '', attackEnabled: Boolean(attack && !attack.disabled) };
  })()`);
  if (current.cycleKey !== contact.cycleKey || !current.attackEnabled) {
    throw new Error(`The original pirate contact cycle is no longer available for fleet preparation: ${JSON.stringify(current)}`);
  }
}

async function selectAllAvailableShips(win) {
  const result = await win.webContents.executeJavaScript(`(() => {
    const button = Array.from(document.querySelectorAll('.fleet-selection-line-v1 button')).find((item) => item.textContent?.trim() === 'Макс.');
    if (!button) return { ok: false, reason: 'fleet-wide Max button missing' };
    button.click();
    return { ok: true };
  })()`);
  if (!result?.ok) throw new Error(`Could not select the available fleet: ${result?.reason || 'unknown error'}`);
  await settle(win);
  const launchState = await win.webContents.executeJavaScript(`(() => {
    const rows = Array.from(document.querySelectorAll('[data-qa-fleet-ship]'));
    const button = document.querySelector('[data-qa-flight-preview-open]');
    return {
      launchable: Boolean(button && !button.disabled),
      selectedCount: document.querySelector('.fleet-selection-line-v1 strong')?.textContent?.trim() || '',
      rows: rows.map((row) => ({ id: row.getAttribute('data-qa-fleet-ship'), owned: row.querySelector('[data-qa-fleet-owned]')?.textContent?.trim() || '', selected: row.querySelector('input')?.value || '' })),
      timeScale: document.querySelector('[data-qa-test-time-scale]')?.textContent?.trim() || '',
    };
  })()`);
  if (!launchState.launchable) throw new Error(`The seeded available fleet is not launchable within the UI population and mission constraints: ${JSON.stringify(launchState)}`);
  return await win.webContents.executeJavaScript(`Array.from(document.querySelectorAll('[data-qa-fleet-ship]')).filter((row) => {
    const input = row.querySelector('input'); return input && Number(input.value) > 0;
  }).map((row) => row.getAttribute('data-qa-fleet-ship'))`);
}

async function runViewport(width, height) {
  const label = `${width}x${height}`;
  console.log(`[pirate-operations-qa] viewport ${label} starting`);
  const directory = path.join(OUTPUT, label);
  fs.mkdirSync(directory, { recursive: true });
  const win = new BrowserWindow({
    width: 1000,
    height: 700,
    useContentSize: true,
    show: false,
    backgroundColor: '#02050a',
    webPreferences: { offscreen: true, contextIsolation: true, nodeIntegration: false, sandbox: true, partition: `qa-pirate-operations-${width}` },
  });
  const diagnostics = { consoleErrors: [], failedRequests: [], loadFailures: [] };
  win.webContents.on('console-message', (_event, level, message, lineNumber, sourceId) => {
    if (level >= 2) diagnostics.consoleErrors.push({ level, message, lineNumber, sourceId });
  });
  win.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    if (errorCode !== -3) diagnostics.loadFailures.push({ errorCode, errorDescription, validatedURL, isMainFrame });
  });
  win.webContents.session.webRequest.onErrorOccurred({ urls: ['*://*/*'] }, (_details) => {
    diagnostics.failedRequests.push({ url: _details.url, error: _details.error, resourceType: _details.resourceType });
  });

  try {
    await win.loadURL('about:blank');
    win.webContents.debugger.attach('1.3');
    await win.webContents.debugger.sendCommand('Page.enable');
    await win.webContents.debugger.sendCommand('Emulation.setDeviceMetricsOverride', {
      width,
      height,
      deviceScaleFactor: 1,
      mobile: false,
      screenWidth: width,
      screenHeight: height,
    });
    const loaded = new Promise((resolve) => win.webContents.once('did-finish-load', resolve));
    await win.loadFile(path.join(ROOT, 'dist', 'index.html'), { search: '?mode=test' });
    await loaded;
    await waitFor(win, `document.querySelector('[data-qa-navigation="primary"]')`);
    await waitFor(win, `localStorage.getItem(${JSON.stringify(SAVE_KEY)})`);
    await waitFor(win, `innerWidth === ${width} && innerHeight === ${height}`);
    console.log(`[pirate-operations-qa] viewport ${label} loaded`);
    const fixture = await seedTestPlayer(win);

    await clickPrimary(win, 'universe', `document.querySelector('[data-qa-universe]')`);
    const contact = await findActiveContact(win);
    console.log(`[pirate-operations-qa] viewport ${label} contact ${contact.cycleKey}`);
    await grantTargetSystemColony(win, contact);
    await clickPrimary(win, 'operations', `document.querySelector('.operations-layout-v2')`);
    const operationCheck = await win.webContents.executeJavaScript(`(() => {
      const cards = [...document.querySelectorAll('[data-qa-pirate-contact]')];
      const systems = cards.map((card) => Number(/Система\\s+(\\d+)/.exec(card.textContent || '')?.[1]));
      const scroll = document.querySelector('.operations-feed-scroll-v2');
      const layout = document.querySelector('.operations-layout-v2');
      return { systems, bounded: Boolean(scroll && layout && layout.getBoundingClientRect().height < 780) };
    })()`);
    if (!operationCheck.bounded || operationCheck.systems.some((system) => system !== 1 && system !== contact.system)) {
      throw new Error(`Operations leaked foreign pirate systems or unbounded layout: ${JSON.stringify(operationCheck)}`);
    }
    await capture(win, directory, 'operations-owned-pirate-contacts');
    await clickPrimary(win, 'universe', `document.querySelector('[data-qa-universe]')`);
    await reselectContact(win, contact);
    await capture(win, directory, 'universe-active-pirate-contact');
    const reconClicked = await win.webContents.executeJavaScript(`(() => {
      const button = document.querySelector('[data-qa-universe-special-action="pirate-recon"]');
      if (!button || button.disabled) return false;
      button.click();
      return true;
    })()`);
    if (!reconClicked) throw new Error('Recon action became unavailable before dispatch');
    await waitFor(win, `JSON.parse(localStorage.getItem(${JSON.stringify(SAVE_KEY)}) || '{}').flights?.records?.some((flight) => flight.missionId === 'pirate-recon' && flight.pirateSnapshot?.contactCycleKey === ${JSON.stringify(contact.cycleKey)})`);
    const reconFlight = await win.webContents.executeJavaScript(`(() => {
      const save = JSON.parse(localStorage.getItem(${JSON.stringify(SAVE_KEY)}) || '{}');
      return save.flights.records.find((flight) => flight.missionId === 'pirate-recon' && flight.pirateSnapshot?.contactCycleKey === ${JSON.stringify(contact.cycleKey)}) || null;
    })()`);
    if (!reconFlight) throw new Error('Recon action did not create a persisted pirate-recon flight');
    console.log(`[pirate-operations-qa] viewport ${label} recon flight ${reconFlight.id}`);
    await clickPrimary(win, 'fleets', `document.querySelector('.fleet-workspace-v1')`);
    await waitFor(win, `document.querySelector('[data-qa-flight-row="${reconFlight.id}"]')`);
    await capture(win, directory, 'pirate-recon-flight');
    await waitFor(win, `JSON.parse(localStorage.getItem(${JSON.stringify(SAVE_KEY)}) || '{}').pirate?.reconReports?.some((report) => report.missionId === ${JSON.stringify(reconFlight.pirateSnapshot?.reconMission?.missionId || reconFlight.id)})`, 45_000);
    const reconReport = await win.webContents.executeJavaScript(`(() => {
      const save = JSON.parse(localStorage.getItem(${JSON.stringify(SAVE_KEY)}) || '{}');
      return save.pirate?.reconReports?.find((report) => report.missionId === ${JSON.stringify(reconFlight.pirateSnapshot?.reconMission?.missionId || reconFlight.id)}) || null;
    })()`);
    if (!reconReport) throw new Error('The real recon flight returned without a persisted report');
    const reconReturn = await win.webContents.executeJavaScript(`(() => {
      const save = JSON.parse(localStorage.getItem(${JSON.stringify(SAVE_KEY)}) || '{}');
      return save.flights.records.find((flight) => flight.id === ${JSON.stringify(reconFlight.id)}) || null;
    })()`);
    await waitFor(win, `JSON.parse(localStorage.getItem(${JSON.stringify(SAVE_KEY)}) || '{}').flights?.records?.some((flight) => flight.id === ${JSON.stringify(reconFlight.id)} && flight.phase === 'completed')`, 45_000);
    const completedReconFlight = await win.webContents.executeJavaScript(`(() => {
      const save = JSON.parse(localStorage.getItem(${JSON.stringify(SAVE_KEY)}) || '{}');
      return save.flights.records.find((flight) => flight.id === ${JSON.stringify(reconFlight.id)}) || null;
    })()`);
    if (!completedReconFlight || completedReconFlight.phase !== 'completed') throw new Error(`Recon probe did not complete its return: ${JSON.stringify(completedReconFlight)}`);
    console.log(`[pirate-operations-qa] viewport ${label} recon return complete`);

    await clickPrimary(win, 'reports', `document.querySelector('.reports-view')`);
    await clickFolder(win, 'system');
    const reportSelector = `[data-report-item-id="${reconReport.id}"] .reports-list-open`;
    await waitFor(win, `document.querySelector(${JSON.stringify(reportSelector)})`);
    await click(win, reportSelector);
    await waitFor(win, `document.querySelector('[data-qa-pirate-recon-report="${reconReport.id}"]')`);
    const dossier = await win.webContents.executeJavaScript(`(() => {
      const node = document.querySelector('[data-qa-pirate-recon-report="${reconReport.id}"]');
      const text = node?.textContent?.replace(/\\s+/g, ' ') || '';
      const percentages = Array.from(node?.querySelectorAll('.pirate-recon-report-list strong') || []).map((item) => item.textContent?.match(/(\\d+)%/)?.[1]).filter(Boolean).map(Number);
      return { visible: Boolean(node), text, outcome: ${JSON.stringify(reconReport.outcome)}, percentages, horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 2 || document.body.scrollWidth > document.body.clientWidth + 2 };
    })()`);
    if (!dossier.visible || dossier.horizontalOverflow) throw new Error(`Recon dossier layout failed at ${label}: ${JSON.stringify(dossier)}`);
    if (dossier.outcome === 'success' && dossier.percentages.length && dossier.percentages.reduce((sum, value) => sum + value, 0) !== 100) {
      throw new Error(`Recon success percentages do not total 100 at ${label}: ${JSON.stringify(dossier.percentages)}`);
    }
    if (/\\b(?:тир\\s*[123]|корпусов?|точн(?:ое|ых) количество)\\b/i.test(dossier.text)) {
      throw new Error(`Recon dossier exposed an internal tier or exact count at ${label}`);
    }
    await capture(win, directory, 'pirate-recon-report');

    await clickPrimary(win, 'universe', `document.querySelector('[data-qa-universe]')`);
    await reselectContact(win, contact);
    const attackOpened = await win.webContents.executeJavaScript(`(() => {
      const button = document.querySelector('[data-qa-universe-special-action="pirate-elimination"]');
      if (!button || button.disabled) return false;
      button.click();
      return true;
    })()`);
    if (!attackOpened) throw new Error('Pirate elimination action is unavailable for the reconned live contact');
    await waitFor(win, `document.querySelector('.fleet-workspace-v1[data-qa-flight-launch-context] [data-qa-attack-prep]')`);
    const launchContext = await win.webContents.executeJavaScript(`(() => {
      const root = document.querySelector('.fleet-workspace-v1');
      return { target: root?.getAttribute('data-qa-flight-launch-context') || '', relation: root?.getAttribute('data-qa-target-relation') || '', mission: document.querySelector('#fleet-mission')?.value || '' };
    })()`);
    if (launchContext.mission !== 'pirate-elimination' || launchContext.relation !== 'neutral' || !launchContext.target) {
      throw new Error(`Pirate elimination launch context was not preserved: ${JSON.stringify(launchContext)}`);
    }
    const fleetRosterState = await win.webContents.executeJavaScript(`(() => {
      const scout = document.querySelector('[data-qa-fleet-ship="scout"]');
      return { scoutOwned: Number(scout?.querySelector('[data-qa-fleet-owned]')?.textContent || 0), rowCount: document.querySelectorAll('[data-qa-fleet-ship]').length };
    })()`);
    if (fleetRosterState.scoutOwned < 1) throw new Error(`The normal fleet preparation roster does not expose the seeded scout: ${JSON.stringify(fleetRosterState)}`);
    await capture(win, directory, 'pirate-elimination-fleet-roster');
    const selectedCombatShips = await selectAllAvailableShips(win);
    await capture(win, directory, 'pirate-elimination-fleet-preparation');
    await click(win, '[data-qa-flight-preview-open]');
    await settle(win);
    await capture(win, directory, 'pirate-elimination-preview-attempt');
    const previewOpened = await win.webContents.executeJavaScript(`Boolean(document.querySelector('[data-qa-flight-preview-backdrop]'))`);
    if (!previewOpened) {
      const buttonState = await win.webContents.executeJavaScript(`(() => {
        const button = document.querySelector('[data-qa-flight-preview-open]');
        return { buttonText: button?.textContent?.trim() || '', disabled: Boolean(button?.disabled), mission: document.querySelector('#fleet-mission')?.value || '', root: document.querySelector('.fleet-workspace-v1')?.outerHTML?.slice(0, 800) || '' };
      })()`);
      throw new Error(`The fleet preview did not open after the primary action: ${JSON.stringify(buttonState)}`);
    }
    const previewState = await win.webContents.executeJavaScript(`(() => ({
      error: document.querySelector('[data-qa-flight-preview-error]')?.textContent?.trim() || '',
      confirmDisabled: Boolean(document.querySelector('[data-qa-flight-dispatch-confirm]')?.disabled),
      targetRelation: document.querySelector('.fleet-workspace-v1')?.getAttribute('data-qa-target-relation') || '',
      selectedCount: document.querySelector('.fleet-selection-line-v1 strong')?.textContent?.trim() || '',
    }))()`);
    if (previewState.confirmDisabled) throw new Error(`Pirate elimination preview cannot be dispatched at ${label}: ${JSON.stringify(previewState)}`);
    await capture(win, directory, 'pirate-elimination-flight-preview');
    await click(win, '[data-qa-flight-dispatch-confirm]');
    await waitFor(win, `JSON.parse(localStorage.getItem(${JSON.stringify(SAVE_KEY)}) || '{}').flights?.records?.some((flight) => flight.missionId === 'pirate-elimination' && flight.pirateSnapshot?.contactCycleKey === ${JSON.stringify(contact.cycleKey)})`);
    const attackFlight = await win.webContents.executeJavaScript(`(() => {
      const save = JSON.parse(localStorage.getItem(${JSON.stringify(SAVE_KEY)}) || '{}');
      return save.flights.records.find((flight) => flight.missionId === 'pirate-elimination' && flight.pirateSnapshot?.contactCycleKey === ${JSON.stringify(contact.cycleKey)}) || null;
    })()`);
    if (!attackFlight?.attackSnapshot || !attackFlight.selectedShips || !Object.values(attackFlight.selectedShips).some((count) => count > 0)) {
      throw new Error(`Pirate elimination dispatch did not persist the selected fleet and launch snapshot: ${JSON.stringify(attackFlight)}`);
    }
    await settle(win);
    await capture(win, directory, 'pirate-elimination-outbound');
    await waitFor(win, `JSON.parse(localStorage.getItem(${JSON.stringify(SAVE_KEY)}) || '{}').combat?.reports?.some((report) => report.missionType === 'pirate-elimination')`, 60_000);
    await waitFor(win, `JSON.parse(localStorage.getItem(${JSON.stringify(SAVE_KEY)}) || '{}').flights?.records?.some((flight) => flight.id === ${JSON.stringify(attackFlight.id)} && flight.phase === 'completed')`, 60_000);
    const finalState = await readSave(win);
    const finalAttackFlight = finalState.flights.records.find((flight) => flight.id === attackFlight.id);
    const battleReport = finalState.combat.reports.find((report) => report.missionType === 'pirate-elimination');
    const result = {
      viewport: label,
      fixture,
      contact,
      recon: { flightId: reconFlight.id, reportId: reconReport.id, outcome: reconReport.outcome, returnPhase: completedReconFlight?.phase || 'removed' },
      attack: { flightId: attackFlight.id, phase: finalAttackFlight?.phase, completionReason: finalAttackFlight?.completionReason, battleReportId: battleReport?.id, selectedCombatShips },
      viewportMetrics: await win.webContents.executeJavaScript(`({ width: innerWidth, height: innerHeight, horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 2 || document.body.scrollWidth > document.body.clientWidth + 2 })`),
      diagnostics,
    };
    if (!battleReport || finalAttackFlight?.phase !== 'completed') throw new Error(`Pirate elimination did not complete: ${JSON.stringify(result)}`);
    console.log(`[pirate-operations-qa] viewport ${label} elimination return complete`);
    await clickPrimary(win, 'reports', `document.querySelector('.reports-view')`);
    await clickFolder(win, 'battle');
    const battleItemSelector = `[data-report-item-id="battle:${battleReport.id}"] .reports-list-open`;
    await waitFor(win, `document.querySelector(${JSON.stringify(battleItemSelector)})`);
    await click(win, battleItemSelector);
    await waitFor(win, `document.querySelector('.reports-dossier--battle')`);
    await capture(win, directory, 'pirate-elimination-battle-report');
    fs.writeFileSync(path.join(directory, 'journey.json'), JSON.stringify(result, null, 2));
    return result;
  } finally {
    win.destroy();
  }
}

app.whenReady().then(async () => {
  console.log('[pirate-operations-qa] app ready');
  try {
    fs.mkdirSync(OUTPUT, { recursive: true });
    const results = [];
    for (const [width, height] of VIEWPORTS) results.push(await runViewport(width, height));
    fs.writeFileSync(path.join(OUTPUT, 'results.json'), JSON.stringify({ results }, null, 2));
    console.log(JSON.stringify({ results }, null, 2));
    app.exit(0);
  } catch (error) {
    console.error(error);
    app.exit(1);
  }
});
