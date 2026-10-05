const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-gpu');
app.on('window-all-closed', () => {});

const ROOT = path.join(__dirname, '..');
const OUTPUT = process.env.ASTERION_QA_OUTPUT || path.join(ROOT, 'artifacts', 'space-flight-qa');
const TEST_KEY = 'asterion.vertical-slice.test.v1';
const VIEWPORTS = [[1920, 1080], [1280, 720]];
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(win, expression, timeoutMs = 10_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await win.webContents.executeJavaScript(`Boolean(${expression})`)) return;
    await sleep(50);
  }
  throw new Error(`Timed out waiting for: ${expression}`);
}

async function reload(win) {
  const loaded = new Promise((resolve) => win.webContents.once('did-finish-load', resolve));
  win.webContents.reload();
  await loaded;
  await waitFor(win, `document.querySelector('[data-qa-navigation="utility"]')`);
  await waitFor(win, `localStorage.getItem(${JSON.stringify(TEST_KEY)})`);
  await sleep(100);
}

async function click(win, selector) {
  const clicked = await win.webContents.executeJavaScript(`(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    if (!element || element.disabled) return false;
    element.click();
    return true;
  })()`);
  if (!clicked) throw new Error(`Element not found or disabled: ${selector}`);
  await sleep(100);
}

async function readSave(win) {
  return win.webContents.executeJavaScript(`JSON.parse(localStorage.getItem(${JSON.stringify(TEST_KEY)}) || 'null')`);
}

function countdownSeconds(value) {
  const match = /^(\d+):(\d{2})$/.exec(value);
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

function assertArrivalCountdown(label, displayed, savedArrivalAt) {
  const displayedSeconds = countdownSeconds(displayed.text);
  const expectedSeconds = Math.max(0, Math.ceil((savedArrivalAt - displayed.observedAt) / 1_000));
  if (displayed.arrivalAt !== savedArrivalAt || displayedSeconds === null || Math.abs(displayedSeconds - expectedSeconds) > 1) {
    throw new Error(`${label}: displayed arrival countdown does not match the persisted flight time ${JSON.stringify({ displayed, savedArrivalAt, expectedSeconds })}`);
  }
}

async function seedCommanderOnlySave(win) {
  const result = await win.webContents.executeJavaScript(`(() => {
    try {
      const save = JSON.parse(localStorage.getItem(${JSON.stringify(TEST_KEY)}) || 'null');
      const planet = save?.planets?.[save.currentPlanetId];
      if (!save || !planet) return { ok: false, error: 'test save or current planet is missing' };
      planet.fleet.ships = Object.fromEntries(Object.keys(planet.fleet.ships).map((id) => [id, 0]));
      planet.fleet.commanders = Object.fromEntries(Object.keys(planet.fleet.commanders).map((id) => [id, id === 'hunter' ? 1 : 0]));
      planet.solarSatellites = 2;
      planet.defense.defenses['ballistic-turret'] = 3;
      planet.resources = { ...planet.resources, gas: 1_000 };
      save.gas = 1_000;
      save.shipUpgradeLevels = { ...(save.shipUpgradeLevels || {}) };
      const now = Date.now();
      const clock = save.resourceClock || {};
      const currentClock = clock.byPlanet?.[save.currentPlanetId] || clock;
      save.resourceClock = {
        ...clock,
        ...currentClock,
        lastReconciledAt: now,
        byPlanet: { ...(clock.byPlanet || {}), [save.currentPlanetId]: { ...currentClock, lastReconciledAt: now } },
      };
      localStorage.setItem(${JSON.stringify(TEST_KEY)}, JSON.stringify(save));
      return { ok: true, planetId: save.currentPlanetId };
    } catch (error) {
      return { ok: false, error: String(error?.stack || error) };
    }
  })()`);
  if (!result?.ok) throw new Error(`Could not seed commander-only flight: ${result?.error || 'unknown error'}`);
  await reload(win);
  return result.planetId;
}

async function setMission(win, missionId) {
  const changed = await win.webContents.executeJavaScript(`(() => {
    const select = document.querySelector('#fleet-mission');
    if (!select) return false;
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set;
    setter?.call(select, ${JSON.stringify(missionId)});
    select.dispatchEvent(new Event('change', { bubbles: true }));
    return select.value === ${JSON.stringify(missionId)};
  })()`);
  if (!changed) throw new Error(`Could not select mission: ${missionId}`);
  await sleep(100);
}

async function setDuration(win, minutes) {
  const changed = await win.webContents.executeJavaScript(`(() => {
    const input = document.querySelector('[data-qa-space-flight-duration] input');
    if (!input) return false;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    setter?.call(input, ${JSON.stringify(String(minutes))});
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    return input.value === ${JSON.stringify(String(minutes))};
  })()`);
  if (!changed) throw new Error(`Could not set Space Flight duration to ${minutes} minutes`);
  await sleep(100);
}

async function capture(win, directory, name) {
  const image = await win.webContents.capturePage();
  fs.writeFileSync(path.join(directory, `${name}.png`), image.toPNG());
}

async function runViewport(width, height) {
  const label = `${width}x${height}`;
  const directory = path.join(OUTPUT, label);
  fs.mkdirSync(directory, { recursive: true });
  const win = new BrowserWindow({
    width,
    height,
    useContentSize: true,
    show: false,
    backgroundColor: '#02050a',
    webPreferences: { offscreen: true, contextIsolation: true, nodeIntegration: false, sandbox: true, partition: `qa-space-flight-${width}` },
  });

  try {
    const loaded = new Promise((resolve) => win.webContents.once('did-finish-load', resolve));
    await win.loadFile(path.join(ROOT, 'dist', 'index.html'), { search: '?mode=test' });
    await loaded;
    await waitFor(win, `document.querySelector('[data-qa-navigation="utility"]')`);
    await waitFor(win, `localStorage.getItem(${JSON.stringify(TEST_KEY)})`);
    win.webContents.debugger.attach('1.3');
    await win.webContents.debugger.sendCommand('Emulation.setDeviceMetricsOverride', {
      width,
      height,
      deviceScaleFactor: 1,
      mobile: false,
      screenWidth: width,
      screenHeight: height,
    });
    await waitFor(win, `innerWidth === ${width} && innerHeight === ${height}`);
    const sourcePlanetId = await seedCommanderOnlySave(win);

    await waitFor(win, `document.querySelector('[data-qa-test-time-scale]')?.textContent?.includes('×15')`);
    await click(win, '[data-qa-route="fleets"]');
    await waitFor(win, `document.querySelector('.fleet-workspace-v1')`);
    await setMission(win, 'space-flight');

    const formation = await win.webContents.executeJavaScript(`(() => {
      const roster = Array.from(document.querySelectorAll('[data-qa-fleet-roster] [data-qa-fleet-ship]')).map((row) => ({
        id: row.getAttribute('data-qa-fleet-ship') || '',
        count: Number(row.querySelector('input[type="number"]')?.value || 0),
      }));
      const commander = document.querySelector('[data-qa-space-flight-prep] input[type="checkbox"]');
      if (!commander) return { ok: false, reason: 'commander selection is missing', roster };
      commander.click();
      return {
        ok: true,
        commanderName: commander.closest('label')?.textContent?.replace(/\\s+/g, ' ').trim() || '',
        roster,
        previewDisabled: Boolean(document.querySelector('[data-qa-flight-preview-open]')?.disabled),
        satelliteListed: roster.some((item) => item.id === 'solar-satellite'),
        viewport: { width: innerWidth, height: innerHeight },
      };
    })()`);
    if (!formation.ok || formation.previewDisabled || formation.satelliteListed
      || formation.roster.some((item) => item.count !== 0)
      || formation.viewport.width !== width || formation.viewport.height !== height) {
      throw new Error(`${label}: commander-only formation failed ${JSON.stringify(formation)}`);
    }
    await setDuration(win, 7);
    await capture(win, directory, 'commander-only-formation');

    await click(win, '[data-qa-flight-preview-open]');
    await waitFor(win, `document.querySelector('[data-qa-flight-preview]') && !document.querySelector('[data-qa-flight-dispatch-confirm]')?.disabled`);
    const preview = await win.webContents.executeJavaScript(`(() => {
      const metrics = Array.from(document.querySelectorAll('[data-qa-flight-preview] > div'));
      const metric = (label) => metrics.find((item) => item.querySelector('small')?.textContent?.trim() === label)?.querySelector('strong')?.textContent?.trim() || '';
      const gas = metrics.find((metric) => metric.querySelector('small')?.textContent?.trim() === 'ГАЗ')?.querySelector('strong')?.textContent?.trim() || '';
      const eta = document.querySelector('[data-qa-flight-eta]')?.textContent?.replace(/\\s+/g, ' ').trim() || '';
      return {
        targetless: Boolean(document.querySelector('[data-qa-space-flight-targetless]')),
        durationMs: Number(document.querySelector('[data-qa-flight-preview]')?.getAttribute('data-qa-flight-preview-duration')),
        arrivalAt: Number(document.querySelector('[data-qa-flight-preview]')?.getAttribute('data-qa-flight-preview-arrival-at')),
        displayedArrival: document.querySelector('[data-qa-flight-eta] .is-arrival span')?.textContent?.replace(/\s+/g, ' ').trim() || '',
        formattedArrival: new Date(Number(document.querySelector('[data-qa-flight-preview]')?.getAttribute('data-qa-flight-preview-arrival-at'))).toLocaleString('ru-RU', {
          day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Europe/Moscow',
        }),
        configuredDurationMinutes: Number(document.querySelector('[data-qa-space-flight-duration] input')?.value),
        oneWayDuration: metric('ТУДА'),
        returnDuration: metric('ОБРАТНО'),
        roundTripDuration: metric('ПОЛНЫЙ ЦИКЛ'),
        gas,
        eta,
        cargoCapacity: document.querySelector('[data-qa-flight-cargo]')?.getAttribute('data-qa-cargo-capacity') || '',
        sendDisabled: Boolean(document.querySelector('[data-qa-flight-dispatch-confirm]')?.disabled),
      };
    })()`);
    if (!preview.targetless || preview.configuredDurationMinutes !== 7 || preview.durationMs !== 28_000
      || preview.oneWayDuration !== '00:28' || preview.returnDuration !== '00:28' || preview.roundTripDuration !== '00:56'
      || preview.gas !== '100' || preview.sendDisabled
      || preview.displayedArrival !== `${preview.formattedArrival} МСК`) {
      throw new Error(`${label}: Space Flight preview contract failed ${JSON.stringify(preview)}`);
    }
    await capture(win, directory, 'space-flight-preview');
    const beforeSend = await readSave(win);
    const beforeGas = beforeSend.planets[sourcePlanetId].resources.gas;
    const beforeDefense = JSON.stringify(beforeSend.planets[sourcePlanetId].defense);
    await click(win, '[data-qa-flight-dispatch-confirm]');
    await waitFor(win, `JSON.parse(localStorage.getItem(${JSON.stringify(TEST_KEY)}) || '{}')?.flights?.records?.some((flight) => flight.missionId === 'space-flight')`);

    let save = await readSave(win);
    let flights = save.flights.records.filter((flight) => flight.missionId === 'space-flight');
    let flight = flights[0];
    const selectedShips = Object.fromEntries(Object.entries(flight?.selectedShips || {}).filter(([, count]) => count > 0));
    const selectedCommanders = Object.fromEntries(Object.entries(flight?.selectedCommanders || {}).filter(([, count]) => count > 0));
    const expectedCommander = formation.commanderName.split(' ')[0].toLowerCase();
    const afterPlanet = save.planets[sourcePlanetId];
    const gasDelta = beforeGas - afterPlanet.resources.gas;
    if (flights.length !== 1 || !flight || Object.keys(selectedShips).length !== 0
      || Object.keys(selectedCommanders).length !== 1 || flight.gasCost !== 100
      || flight.oneWayDurationMs !== 28_000 || flight.arrivalAt - flight.departedAt !== 28_000 || flight.returnAt !== undefined
      || Math.abs(flight.arrivalAt - preview.arrivalAt) > 5_000
      || (gasDelta < 90 || gasDelta > 110)
      || afterPlanet.solarSatellites !== 2
      || JSON.stringify(afterPlanet.defense) !== beforeDefense
      || Object.values(afterPlanet.fleet.ships).some((count) => count !== 0)) {
      throw new Error(`${label}: persisted commander-only Space Flight is invalid ${JSON.stringify({ flights, selectedShips, selectedCommanders, gasDelta, satellites: afterPlanet.solarSatellites, defenseUnchanged: JSON.stringify(afterPlanet.defense) === beforeDefense })}`);
    }
    await waitFor(win, `document.querySelector('[data-qa-flight-row]')`);
    const displayedArrival = await win.webContents.executeJavaScript(`(() => {
      const arrival = document.querySelector('[data-qa-flight-row="${flight.id}"] [data-qa-flight-arrival]');
      return {
        text: arrival?.textContent?.trim() || '',
        arrivalAt: Number(arrival?.getAttribute('data-qa-flight-arrival-at')),
        observedAt: Date.now(),
      };
    })()`);
    assertArrivalCountdown(label, displayedArrival, flight.arrivalAt);
    const targetCell = await win.webContents.executeJavaScript(`(() => {
      const row = document.querySelector('[data-qa-flight-row="${flight.id}"]');
      const target = row?.querySelector('[data-qa-flight-target]');
      return {
        targetless: Boolean(target?.querySelector('[data-qa-space-flight-targetless]')),
        label: target?.textContent?.replace(/\\s+/g, ' ').trim() || '',
        includesCoordinate: /\\[\\d+:\\d+:\\d+\\]/.test(target?.textContent || ''),
      };
    })()`);
    if (!targetCell.targetless || !targetCell.label.includes('Без планетарной цели') || targetCell.includesCoordinate) {
      throw new Error(`${label}: targetless flight row displays an invalid target ${JSON.stringify(targetCell)}`);
    }
    await capture(win, directory, 'space-flight-outbound');

    await reload(win);
    await click(win, '[data-qa-route="fleets"]');
    await waitFor(win, `document.querySelector('.fleet-workspace-v1')`);
    save = await readSave(win);
    flights = save.flights.records.filter((item) => item.missionId === 'space-flight');
    if (flights.length !== 1 || flights[0].oneWayDurationMs !== 28_000 || flights[0].arrivalAt - flights[0].departedAt !== 28_000) {
      throw new Error(`${label}: accelerated Space Flight was lost or changed after reload ${JSON.stringify(flights)}`);
    }
    const reloadedArrival = await win.webContents.executeJavaScript(`(() => {
      const arrival = document.querySelector('[data-qa-flight-row="${flight.id}"] [data-qa-flight-arrival]');
      return {
        text: arrival?.textContent?.trim() || '',
        arrivalAt: Number(arrival?.getAttribute('data-qa-flight-arrival-at')),
        observedAt: Date.now(),
      };
    })()`);
    assertArrivalCountdown(`${label} after reload`, reloadedArrival, flights[0].arrivalAt);
    const reloadedTargetCell = await win.webContents.executeJavaScript(`(() => {
      const target = document.querySelector('[data-qa-flight-row="${flight.id}"] [data-qa-flight-target]');
      return {
        targetless: Boolean(target?.querySelector('[data-qa-space-flight-targetless]')),
        label: target?.textContent?.replace(/\\s+/g, ' ').trim() || '',
        includesCoordinate: /\\[\\d+:\\d+:\\d+\\]/.test(target?.textContent || ''),
      };
    })()`);
    if (!reloadedTargetCell.targetless || !reloadedTargetCell.label.includes('Без планетарной цели') || reloadedTargetCell.includesCoordinate) {
      throw new Error(`${label}: reloaded targetless flight row displays an invalid target ${JSON.stringify(reloadedTargetCell)}`);
    }

    await click(win, '[data-qa-bot01-scenario]');
    await waitFor(win, `JSON.parse(localStorage.getItem(${JSON.stringify(TEST_KEY)}) || '{}')?.espionage?.bot01IncomingScenario`);
    await waitFor(win, `document.querySelector('[data-qa-flight-incoming-attack] [data-qa-flight-no-recall]')`);
    save = await readSave(win);
    const incoming = save.flights.records.filter((item) => item.ownerSide === 'bot01' && item.missionId === 'attack');
    const incomingRow = await win.webContents.executeJavaScript(`(() => {
      const row = document.querySelector('[data-qa-flight-incoming-attack]');
      return {
        ownerSide: row?.getAttribute('data-qa-flight-owner-side') || '',
        label: row?.querySelector('[data-qa-flight-bot01-label]')?.textContent?.trim() || '',
        noRecall: Boolean(row?.querySelector('[data-qa-flight-no-recall]')),
        red: row?.classList.contains('fleet-flight-row-v1--incoming-attack') ?? false,
        horizontalOverflow: document.documentElement.scrollWidth > innerWidth + 2 || document.body.scrollWidth > innerWidth + 2,
      };
    })()`);
    const scenarioButton = await win.webContents.executeJavaScript(`Boolean(document.querySelector('[data-qa-bot01-scenario]')?.disabled)`);
    if (incoming.length !== 1 || incomingRow.ownerSide !== 'bot01' || !incomingRow.label.includes('BOT 01')
      || !incomingRow.noRecall || !incomingRow.red || incomingRow.horizontalOverflow || !scenarioButton) {
      throw new Error(`${label}: one-shot incoming Bot 01 UI contract failed ${JSON.stringify({ incoming, incomingRow, scenarioButton })}`);
    }
    await capture(win, directory, 'bot01-incoming-attack');

    await reload(win);
    await click(win, '[data-qa-route="fleets"]');
    await waitFor(win, `document.querySelector('.fleet-workspace-v1')`);
    save = await readSave(win);
    flights = save.flights.records.filter((item) => item.missionId === 'space-flight');
    const incomingAfterReload = save.flights.records.filter((item) => item.ownerSide === 'bot01' && item.missionId === 'attack');
    const reloadUi = await win.webContents.executeJavaScript(`({
      incomingRowCount: document.querySelectorAll('[data-qa-flight-incoming-attack]').length,
      scenarioDisabled: Boolean(document.querySelector('[data-qa-bot01-scenario]')?.disabled),
    })`);
    if (flights.length !== 1 || incomingAfterReload.length !== 1 || reloadUi.incomingRowCount !== 1 || !reloadUi.scenarioDisabled) {
      throw new Error(`${label}: Space Flight or Bot 01 scenario duplicated or vanished after reload ${JSON.stringify({ flights, incomingAfterReload, reloadUi })}`);
    }
    await capture(win, directory, 'bot01-incoming-attack-reloaded');

    return { viewport: label, commander: expectedCommander, configuredDurationMinutes: preview.configuredDurationMinutes, previewOneWayDuration: preview.oneWayDuration, previewRoundTripDuration: preview.roundTripDuration, durationMs: flight.oneWayDurationMs, savedArrivalDurationMs: flight.arrivalAt - flight.departedAt, gasCost: flight.gasCost, gasDelta, selectedShips, selectedCommanders, satellitesAfterDispatch: afterPlanet.solarSatellites, defensePreserved: JSON.stringify(afterPlanet.defense) === beforeDefense, targetCell, incomingRow, persistedAfterReload: true, screenshots: fs.readdirSync(directory).filter((name) => name.endsWith('.png')).sort() };
  } finally {
    if (win.webContents.debugger.isAttached()) win.webContents.debugger.detach();
    win.destroy();
  }
}

app.whenReady().then(async () => {
  try {
    if (fs.existsSync(OUTPUT)) throw new Error(`Refusing to overwrite existing QA output: ${OUTPUT}`);
    fs.mkdirSync(OUTPUT, { recursive: true });
    const results = [];
    for (const [width, height] of VIEWPORTS) results.push(await runViewport(width, height));
    fs.writeFileSync(path.join(OUTPUT, 'results.json'), JSON.stringify({ results }, null, 2));
    console.log(`Space Flight UI QA passed at ${VIEWPORTS.map(([width, height]) => `${width}x${height}`).join(' and ')}. Output: ${OUTPUT}`);
    app.exit(0);
  } catch (error) {
    console.error(error);
    app.exit(1);
  }
});
