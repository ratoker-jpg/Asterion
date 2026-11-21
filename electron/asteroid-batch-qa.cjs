// Focused Electron QA for the universe asteroid gas batch planner.
// The Test Mode save lives in a fresh in-memory partition; screenshots stay in %TEMP%.
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { editSaveIdle } = require('./qa-save-edit.cjs');

app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-gpu');
app.on('window-all-closed', () => {});

const ROOT = path.join(__dirname, '..');
const TEST_KEY = 'asterion.vertical-slice.test.v1';
const OUTPUT = process.env.ASTERION_QA_OUTPUT || fs.mkdtempSync(path.join(os.tmpdir(), 'asterion-asteroid-batch-qa-'));
const skipScreenshots = process.env.ASTERION_SKIP_SCREENSHOTS === '1';
const WIDTH = 1440;
const HEIGHT = 960;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const FIXTURE = {
  targets: [
    { id: 'asteroid:71001', coordinate: { galaxy: 1, system: 4, position: 24 }, debris: true, active: true },
    { id: 'asteroid:71002', coordinate: { galaxy: 1, system: 5, position: 24 }, debris: true },
    { id: 'asteroid:71003', coordinate: { galaxy: 1, system: 6, position: 24 }, debris: true },
    { id: 'asteroid:71004', coordinate: { galaxy: 1, system: 7, position: 24 }, debris: false },
    { id: 'asteroid:71005', coordinate: { galaxy: 1, system: 8, position: 24 }, debris: true },
    { id: 'asteroid:71006', coordinate: { galaxy: 2, system: 8, position: 24 }, debris: true },
  ],
  sources: [
    { id: 'helion-01', name: 'Домашняя планета', coordinate: { galaxy: 1, system: 1, position: 1 }, recyclers: 20 },
    { id: 'qa-batch-source-a', name: 'Источник QA A', coordinate: { galaxy: 1, system: 5, position: 1 }, recyclers: 10 },
    { id: 'qa-batch-source-b', name: 'Источник QA B', coordinate: { galaxy: 2, system: 8, position: 1 }, recyclers: 10 },
  ],
};

async function js(win, source) {
  return win.webContents.executeJavaScript(source).catch((error) => {
    console.error('Renderer JavaScript failed:', String(error).slice(0, 500));
    throw error;
  });
}

async function pageState(win) {
  return js(win, `(() => ({
    route: document.querySelector('[data-qa-route].is-active, [data-qa-route][aria-current]')?.getAttribute('data-qa-route') || '',
    dialog: document.querySelector('[data-qa-asteroid-batch-dialog]')?.getAttribute('data-qa-asteroid-batch-dialog') || '',
    body: (document.body?.innerText || '').replace(/\\s+/g, ' ').slice(0, 320),
    rows: document.querySelectorAll('[data-qa-asteroid-batch-row]').length,
    flights: (() => { try { return JSON.parse(localStorage.getItem(${JSON.stringify(TEST_KEY)}) || '{}')?.flights?.records?.length ?? -1; } catch { return -1; } })(),
  }))()`);
}

async function waitFor(win, expression, timeoutMs = 15_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await js(win, `Boolean(${expression})`)) return;
    await sleep(60);
  }
  throw new Error(`Timed out waiting for: ${expression}\nPage state: ${JSON.stringify(await pageState(win))}`);
}

async function click(win, selector) {
  const result = await js(win, `(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    if (!element || element.disabled) return false;
    element.click();
    return true;
  })()`);
  if (!result) throw new Error(`Missing or disabled control: ${selector}`);
  await sleep(120);
}

async function setValue(win, selector, value, elementType = 'HTMLInputElement') {
  const result = await js(win, `(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    if (!element || element.disabled) return { ok: false, reason: element ? 'disabled' : 'missing' };
    const setter = Object.getOwnPropertyDescriptor(${elementType}.prototype, 'value')?.set;
    setter?.call(element, ${JSON.stringify(String(value))});
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
    return { ok: element.value === ${JSON.stringify(String(value))}, value: element.value };
  })()`);
  if (!result?.ok) throw new Error(`Could not set ${selector} to ${value}: ${JSON.stringify(result)}`);
  await sleep(100);
}

async function readSave(win) {
  return js(win, `JSON.parse(localStorage.getItem(${JSON.stringify(TEST_KEY)}) || 'null')`);
}

async function capture(win, name) {
  if (skipScreenshots) return;
  await sleep(250);
  const { data } = await win.webContents.debugger.sendCommand('Page.captureScreenshot', {
    format: 'png', captureBeyondViewport: false,
  });
  fs.mkdirSync(OUTPUT, { recursive: true });
  fs.writeFileSync(path.join(OUTPUT, `${name}.png`), Buffer.from(data, 'base64'));
}

function coordinateKey(coordinate) {
  return [coordinate?.galaxy, coordinate?.system, coordinate?.position].join(':');
}

function formatCoordinate(coordinate) {
  return `[${coordinateKey(coordinate)}]`;
}

function coordinateMatches(text, coordinate) {
  const match = String(text).match(/\[(\d+):(\d+):(\d+)\]/);
  const expected = [coordinate.galaxy, coordinate.system, coordinate.position];
  return Boolean(match && match.slice(1).map(Number).every((value, index) => value === expected[index]));
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function seedSourcePlanet(save, basePlanet, source) {
  const planet = JSON.parse(JSON.stringify(basePlanet));
  planet.name = source.name;
  planet.universeGalaxy = source.coordinate.galaxy;
  planet.universeSystem = source.coordinate.system;
  planet.universePosition = source.coordinate.position;
  planet.buildings = { ...(planet.buildings || {}), hangar: Math.max(25, planet.buildings?.hangar ?? 0) };
  planet.fleet = planet.fleet || { ships: {}, commanders: {} };
  planet.fleet.ships = Object.fromEntries(Object.keys(planet.fleet.ships || {}).map((id) => [id, 0]));
  planet.fleet.ships.recycler = source.recyclers;
  planet.resources = { ...(planet.resources || {}), metal: 1_000_000_000, minerals: 1_000_000_000, gas: 1_000_000_000 };
  save.planets[source.id] = planet;
}

async function seedFixture(win) {
  const targetIndices = FIXTURE.targets.map((target) => Number(target.id.slice('asteroid:'.length)));
  const now = Date.now() - 2_000;
  const source = `(() => {
    const save = JSON.parse(localStorage.getItem(${JSON.stringify(TEST_KEY)}) || 'null');
    const home = save?.planets?.['helion-01'];
    if (!save || !home) return { ok: false, error: 'missing Test Mode save or helion-01' };

    save.currentPlanetId = 'helion-01';
    save.worldConfig = { ...(save.worldConfig || {}), world: { ...(save.worldConfig?.world || {}), galaxyCount: 2 } };
    save.science = { ...(save.science || {}), levels: { ...(save.science?.levels || {}), 6: 0 } };
    for (const planet of Object.values(save.planets)) {
      planet.fleet = planet.fleet || { ships: {}, commanders: {} };
      planet.fleet.ships = Object.fromEntries(Object.keys(planet.fleet.ships || {}).map((id) => [id, 0]));
      planet.fleet.ships.recycler = 0;
    }
    (${seedSourcePlanet.toString()})(save, home, ${JSON.stringify(FIXTURE.sources[1])});
    (${seedSourcePlanet.toString()})(save, home, ${JSON.stringify(FIXTURE.sources[2])});
    home.name = ${JSON.stringify(FIXTURE.sources[0].name)};
    home.universeGalaxy = 1;
    home.universeSystem = 1;
    home.universePosition = 1;
    home.buildings = { ...(home.buildings || {}), hangar: Math.max(25, home.buildings?.hangar ?? 0) };
    home.fleet = home.fleet || { ships: {}, commanders: {} };
    home.fleet.ships = Object.fromEntries(Object.keys(home.fleet.ships || {}).map((id) => [id, 0]));
    home.fleet.ships.recycler = ${FIXTURE.sources[0].recyclers};
    home.resources = { ...(home.resources || {}), metal: 1_000_000_000, minerals: 1_000_000_000, gas: 1_000_000_000 };
    save.flights = { records: [], requestIndex: {} };

    const simulation = save.asteroidSimulation || {};
    const base = simulation.asteroids?.[0] || {};
    const fixtureAsteroids = ${JSON.stringify(FIXTURE.targets)}.map((target) => {
      const asteroid = { ...base };
      delete asteroid.nextCoordinate;
      return {
        ...asteroid,
        spawnIndex: Number(target.id.slice('asteroid:'.length)),
        spawnedAt: ${now} - 60_000,
        movementIndex: 0,
        previousMoveAt: ${now},
        nextMoveAt: ${now} + 3_600_000,
        coordinate: { ...target.coordinate },
        gasYield: 123_456_789,
        gasRatePerHour: 0,
        gasUpdatedAt: ${now},
        gasRemainder: 0,
      };
    });
    save.asteroidSimulation = {
      version: 1,
      processedThroughAt: ${now},
      nextSpawnIndex: Math.max(Number(simulation.nextSpawnIndex || 0), ${Math.max(...targetIndices) + 1}),
      asteroids: fixtureAsteroids,
    };
    save.asteroidDebrisBySpawnIndex = Object.fromEntries(${JSON.stringify(FIXTURE.targets.filter((target) => target.debris).map((target) => [target.id.slice('asteroid:'.length), 25_000]))});
    localStorage.setItem(${JSON.stringify(TEST_KEY)}, JSON.stringify(save));
    return { ok: true, targets: fixtureAsteroids.length, galaxyCount: save.worldConfig.world.galaxyCount };
  })()`;
  const result = await editSaveIdle(win, source, {
    ready: `document.querySelector('[data-qa-navigation="utility"]') && localStorage.getItem(${JSON.stringify(TEST_KEY)})`,
    held: `(() => { try { const save = JSON.parse(localStorage.getItem(${JSON.stringify(TEST_KEY)}) || '{}'); return save.asteroidSimulation?.asteroids?.length === ${FIXTURE.targets.length} && save.asteroidDebrisBySpawnIndex?.['71002'] === 25000 && save.worldConfig?.world?.galaxyCount === 2; } catch { return false; } })()`,
    label: 'asteroid batch fixture',
  });
  if (!result?.ok) throw new Error(`Could not seed asteroid batch fixture: ${JSON.stringify(result)}`);
  await waitFor(win, `document.querySelector('[data-qa-navigation="utility"]')`);
}

async function setFleetShipQuantity(win, shipId, quantity) {
  const result = await js(win, `(() => {
    const input = document.querySelector(${JSON.stringify(`[data-qa-fleet-ship="${shipId}"] input[type="number"]`)});
    if (!input || input.disabled) return false;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    setter?.call(input, ${JSON.stringify(String(quantity))});
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    return input.value === ${JSON.stringify(String(quantity))};
  })()`);
  if (!result) throw new Error(`Could not select fleet ship ${shipId}`);
  await sleep(100);
}

async function setFlightCoordinate(win, field, value) {
  await setValue(win, `[name="flight-preview-target-${field}"]`, value);
}

async function launchExistingGasFlight(win, target) {
  await click(win, '[data-qa-route="fleets"]');
  await waitFor(win, `document.querySelector('.fleet-workspace-v1')`);
  await click(win, '[data-qa-mission-id="gas"]');
  await waitFor(win, `document.querySelector('[data-qa-mission-current]')?.getAttribute('data-qa-mission-current') === 'gas'`);
  await setFleetShipQuantity(win, 'recycler', 1);
  await click(win, '[data-qa-flight-preview-open]');
  await waitFor(win, `document.querySelector('[data-qa-flight-preview-backdrop] [data-qa-flight-target-inputs]')`);
  await setFlightCoordinate(win, 'galaxy', target.coordinate.galaxy);
  await setFlightCoordinate(win, 'system', target.coordinate.system);
  await setFlightCoordinate(win, 'position', target.coordinate.position);
  await click(win, '[data-qa-flight-target-step] .flight-timeline-edit');
  await waitFor(win, `document.querySelector('[data-qa-gas-asteroid-preview]') && !document.querySelector('[data-qa-flight-dispatch-confirm]')?.disabled`, 20_000);
  const preview = await js(win, `(() => ({
    target: document.querySelector('[data-qa-flight-target-step]')?.textContent?.replace(/\\s+/g, ' ').trim() || '',
    hit: document.querySelector('[data-qa-gas-asteroid-hit]')?.getAttribute('data-qa-gas-asteroid-hit') || '',
    disabled: document.querySelector('[data-qa-flight-dispatch-confirm]')?.disabled ?? true,
  }))()`);
  if (preview.disabled || !coordinateMatches(preview.target, target.coordinate) || !['hit', 'miss'].includes(preview.hit)) {
    throw new Error(`The single asteroid gas flight preview is invalid: ${JSON.stringify({ preview, target })}`);
  }
  await click(win, '[data-qa-flight-dispatch-confirm]');
  const coordinate = target.coordinate;
  await waitFor(win, `JSON.parse(localStorage.getItem(${JSON.stringify(TEST_KEY)}) || '{}')?.flights?.records?.some((flight) => flight.missionId === 'gas' && flight.destinationCoordinate?.galaxy === ${coordinate.galaxy} && flight.destinationCoordinate?.system === ${coordinate.system} && flight.destinationCoordinate?.position === ${coordinate.position})`, 20_000);
  const save = await readSave(win);
  const flight = save.flights.records.find((item) => item.missionId === 'gas' && coordinateKey(item.destinationCoordinate) === coordinateKey(coordinate));
  if (!flight || flight.targetKind !== 'asteroid' || flight.phase !== 'outbound'
    || flight.originPlanetId !== 'helion-01' || JSON.stringify(flight.selectedShips) !== JSON.stringify({ recycler: 1 })) {
    throw new Error(`Single flight did not create the expected real asteroid dispatch: ${JSON.stringify(flight)}`);
  }
  return flight;
}

async function addCompletedHistory(win, activeFlight) {
  const now = Date.now();
  const active = JSON.stringify(activeFlight);
  const source = `(() => {
    const save = JSON.parse(localStorage.getItem(${JSON.stringify(TEST_KEY)}) || 'null');
    const active = ${active};
    const records = save?.flights?.records;
    if (!save || !Array.isArray(records) || !records.some((flight) => flight.id === active.id)) return { ok: false, error: 'active flight missing' };
    for (let index = 0; index < 5; index += 1) {
      const record = JSON.parse(JSON.stringify(active));
      record.id = 'qa-batch-history-' + index;
      record.requestId = 'qa-batch-history-request-' + index;
      record.missionId = 'gas';
      record.ownerSide = 'player';
      record.selectedShips = { recycler: 1 };
      record.phase = 'completed';
      record.completionReason = 'normal';
      record.completedAt = ${now} - 60000 - index;
      record.departedAt = ${now} - 180000 - index;
      record.arrivalAt = ${now} - 120000 - index;
      record.returnAt = ${now} - 60000 - index;
      record.oneWayDurationMs = 60000;
      record.originPlanetId = 'helion-01';
      record.destinationCoordinate = { galaxy: 1, system: 30, position: index + 1 };
      record.destination = { kind: 'coordinate', coordinate: record.destinationCoordinate };
      records.push(record);
    }
    localStorage.setItem(${JSON.stringify(TEST_KEY)}, JSON.stringify(save));
    return { ok: true, count: records.length };
  })()`;
  const result = await editSaveIdle(win, source, {
    ready: `document.querySelector('[data-qa-navigation="utility"]') && localStorage.getItem(${JSON.stringify(TEST_KEY)})`,
    held: `(() => { try { const save = JSON.parse(localStorage.getItem(${JSON.stringify(TEST_KEY)}) || '{}'); return save.flights?.records?.filter((flight) => flight.id?.startsWith('qa-batch-history-')).length === 5; } catch { return false; } })()`,
    label: 'inactive flight history fixture',
  });
  if (!result?.ok) throw new Error(`Could not add completed flight history: ${JSON.stringify(result)}`);
}

async function openBatchDialog(win) {
  if (await js(win, `Boolean(document.querySelector('[data-qa-asteroid-batch-dialog]'))`)) return;
  await click(win, '[data-qa-route="universe"]');
  await waitFor(win, `document.querySelector('[data-qa-universe]')`);
  await click(win, '[data-qa-universe-find-asteroid-gas]');
  await waitFor(win, `document.querySelector('[data-qa-asteroid-batch-dialog]')`);
}

async function selectGalaxy(win, galaxy) {
  const trigger = '[aria-label="Галактика для поиска астероидов"][data-qa-game-select-trigger]';
  const current = await js(win, `document.querySelector('[data-qa-asteroid-batch-galaxy]')?.value || ''`);
  if (current === String(galaxy)) return;
  await click(win, trigger);
  await waitFor(win, `document.querySelector('[data-qa-game-select-list]')`);
  await click(win, `[data-qa-game-select-option="${galaxy}"]`);
  await waitFor(win, `document.querySelector('[data-qa-asteroid-batch-galaxy]')?.value === ${JSON.stringify(String(galaxy))}`);
}

async function scanRange(win, galaxy, from, to) {
  await selectGalaxy(win, galaxy);
  await setValue(win, '[data-qa-asteroid-batch-range-from]', from);
  await setValue(win, '[data-qa-asteroid-batch-range-to]', to);
  await waitFor(win, `document.querySelector('[data-qa-asteroid-batch-range-from]')?.getAttribute('aria-invalid') === 'false' && document.querySelector('[data-qa-asteroid-batch-range-to]')?.getAttribute('aria-invalid') === 'false'`);
  await click(win, '[data-qa-asteroid-batch-scan]');
  await waitFor(win, `['ready', 'partial', 'empty'].includes(document.querySelector('[data-qa-asteroid-batch-dialog]')?.getAttribute('data-qa-asteroid-batch-dialog') || '')`);
  await waitFor(win, `document.querySelector('[data-qa-asteroid-batch-results]')`);
}

async function readBatchRows(win) {
  return js(win, `Array.from(document.querySelectorAll('[data-qa-asteroid-batch-row]')).map((row) => {
    const quantity = row.querySelector('[data-qa-asteroid-batch-quantity]');
    const coordinate = row.querySelector('.abatch__target-main small')?.textContent?.trim() || '';
    return {
      id: row.getAttribute('data-qa-asteroid-batch-row') || '',
      active: row.hasAttribute('data-qa-asteroid-batch-active'),
      debris: row.querySelector('[data-qa-asteroid-batch-debris]')?.getAttribute('data-qa-asteroid-batch-debris') || '',
      quantity: Number(quantity?.value || 0),
      disabled: quantity?.disabled ?? true,
      refused: Boolean(row.querySelector('[data-qa-asteroid-batch-refused]')),
      flight: row.querySelector('[data-qa-asteroid-batch-flight]')?.textContent?.replace(/\\s+/g, ' ').trim() || '',
      coordinate,
    };
  })`);
}

function assert(label, condition, details) {
  if (!condition) throw new Error(`${label}: ${JSON.stringify(details)}`);
}

async function checkGalaxyOnePlanning(win, preflight) {
  await openBatchDialog(win);
  await scanRange(win, 1, 4, 7);
  const rows = await readBatchRows(win);
  const expectedIds = FIXTURE.targets.slice(0, 4).map((target) => target.id).sort();
  const actualIds = rows.map((row) => row.id).sort();
  assert('inclusive range and selected galaxy', JSON.stringify(actualIds) === JSON.stringify(expectedIds), { actualIds, expectedIds, rows });
  assert('no duplicate target rows', new Set(rows.map((row) => row.id)).size === rows.length
    && new Set(rows.map((row) => row.coordinate)).size === rows.length, rows);

  const firstNoDebris = rows.findIndex((row) => row.debris === 'no');
  assert('debris targets appear before targets without debris', firstNoDebris >= 0
    && rows.slice(firstNoDebris).every((row) => row.debris === 'no')
    && rows.slice(0, firstNoDebris).every((row) => row.debris === 'yes'), rows.map(({ id, debris }) => ({ id, debris })));

  const activeRow = rows.find((row) => row.id === preflight.targetId);
  assert('same-coordinate active gas flight is excluded from allocation', activeRow?.active && activeRow.disabled, activeRow);

  const fixtureState = await js(win, `(() => {
    const sources = Array.from(document.querySelectorAll('[data-qa-asteroid-batch-source]')).map((item) => item.getAttribute('data-qa-asteroid-batch-source'));
    const total = Number(document.querySelector('[data-qa-asteroid-batch-total]')?.getAttribute('data-qa-asteroid-batch-total'));
    const equal = document.querySelector('[data-qa-asteroid-batch-equal]')?.value || '';
    return { sources, total, equal };
  })()`);
  const expectedSources = FIXTURE.sources.map((source) => source.id).sort();
  assert('all owned recycler sources are included', expectedSources.every((id) => fixtureState.sources.includes(id))
    && fixtureState.total === 39, { fixtureState, expectedSources });
  assert('default allocation is ten recyclers per target', fixtureState.equal === '10', fixtureState);

  await capture(win, 'asteroid-batch-galaxy-1-results');
  await click(win, '[data-qa-asteroid-batch-distribute]');
  await waitFor(win, `Number(document.querySelector('[data-qa-asteroid-batch-quantity="${FIXTURE.targets[1].id}"]')?.value || 0) === 10`);
  const distributed = await readBatchRows(win);
  const byId = new Map(distributed.map((row) => [row.id, row]));
  const selectedDebris = [FIXTURE.targets[1].id, FIXTURE.targets[2].id].map((id) => byId.get(id));
  const cappedPlain = byId.get(FIXTURE.targets[3].id);
  assert('equal distribution allocates ten recyclers to the first two debris targets', selectedDebris.every((row) => row?.debris === 'yes' && row.quantity === 10 && !row.refused), { distributed });
  assert('canonical active-flight cap leaves the later no-debris target unselected', cappedPlain?.quantity === 0, cappedPlain);

  await capture(win, 'asteroid-batch-equal-allocation');
  await click(win, '[data-qa-asteroid-batch-send]');
  const targetB = FIXTURE.targets[1].coordinate;
  const targetC = FIXTURE.targets[2].coordinate;
  const expectedKeys = [coordinateKey(targetB), coordinateKey(targetC)].sort();
  await waitFor(win, `(() => { const save = JSON.parse(localStorage.getItem(${JSON.stringify(TEST_KEY)}) || '{}'); const records = save?.flights?.records || []; return records.filter((flight) => flight.missionId === 'gas' && flight.requestId?.startsWith('asteroid-gas-batch-')).length === 2; })()`, 30_000);
  const finalSave = await readSave(win);
  const batchRecords = finalSave.flights.records.filter((flight) => flight.missionId === 'gas'
    && flight.requestId?.startsWith('asteroid-gas-batch-'));
  const actualKeys = batchRecords.map((flight) => coordinateKey(flight.destinationCoordinate)).sort();
  assert('batch dispatch writes two real gas flights to the accepted debris targets', JSON.stringify(actualKeys) === JSON.stringify(expectedKeys), { actualKeys, expectedKeys, batchRecords });
  assert('batch dispatch records use the requested recycler quantity and asteroid target kind', batchRecords.every((flight) => (
    flight.targetKind === 'asteroid' && flight.phase === 'outbound'
      && JSON.stringify(flight.selectedShips) === JSON.stringify({ recycler: 10 })
      && FIXTURE.sources.some((source) => source.id === flight.originPlanetId)
  )), batchRecords);
  assert('batch dispatch request and flight IDs are unique', new Set(batchRecords.map((flight) => flight.id)).size === 2
    && new Set(batchRecords.map((flight) => flight.requestId)).size === 2, batchRecords);

  const liveGas = finalSave.flights.records.filter((flight) => flight.missionId === 'gas'
    && ['outbound', 'arrived', 'returning'].includes(flight.phase)
    && (flight.ownerSide === undefined || flight.ownerSide === 'player'));
  const liveCoordinates = liveGas.map((flight) => coordinateKey(flight.destinationCoordinate));
  assert('active gas records have no duplicate target coordinates', new Set(liveCoordinates).size === liveGas.length, liveGas);
  assert('slot usage reaches the true three-flight cap despite longer completed history', finalSave.science.levels[6] === 0
    && liveGas.length === 3 && finalSave.flights.records.length > 3, {
      computerSystems: finalSave.science.levels[6], liveGas: liveGas.length, historyLength: finalSave.flights.records.length,
    });
  assert('pre-existing target was not dispatched again', batchRecords.every((flight) => coordinateKey(flight.destinationCoordinate) !== coordinateKey(preflight.coordinate))
    && finalSave.flights.records.some((flight) => flight.id === preflight.id), { preflight, batchRecords });

  return { batchRecords, liveGas, finalSave };
}

async function checkOtherGalaxyScan(win) {
  await openBatchDialog(win);
  await scanRange(win, 2, 8, 8);
  const rows = await readBatchRows(win);
  const expected = FIXTURE.targets.filter((target) => target.coordinate.galaxy === 2 && target.coordinate.system === 8).map((target) => target.id);
  assert('galaxy selection and inclusive single-system scan', rows.length === 1 && rows[0].id === expected[0]
    && coordinateMatches(rows[0].coordinate, { galaxy: 2, system: 8, position: 24 }), { rows, expected });
}

async function run() {
  fs.mkdirSync(OUTPUT, { recursive: true });
  const win = new BrowserWindow({
    width: WIDTH,
    height: HEIGHT,
    useContentSize: true,
    show: false,
    backgroundColor: '#02050a',
    webPreferences: {
      offscreen: true,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      partition: `inMemory:qa-asteroid-batch-${process.pid}`,
    },
  });
  win.webContents.on('console-message', (_event, level, message) => {
    if (level >= 2) console.warn('renderer:', message);
  });
  try {
    await win.loadURL('about:blank');
    win.webContents.debugger.attach('1.3');
    await win.webContents.debugger.sendCommand('Page.enable');
    await win.webContents.debugger.sendCommand('Emulation.setDeviceMetricsOverride', {
      width: WIDTH, height: HEIGHT, deviceScaleFactor: 1, mobile: false, screenWidth: WIDTH, screenHeight: HEIGHT,
    });
    await win.loadFile(path.join(ROOT, 'dist', 'index.html'), { search: '?mode=test' });
    await waitFor(win, `document.querySelector('[data-qa-navigation="utility"]')`, 60_000);
    await waitFor(win, `localStorage.getItem(${JSON.stringify(TEST_KEY)})`, 30_000);
    await seedFixture(win);

    const preflight = await launchExistingGasFlight(win, FIXTURE.targets[0]);
    const preflightTarget = { ...preflight, targetId: FIXTURE.targets[0].id, coordinate: FIXTURE.targets[0].coordinate };
    await addCompletedHistory(win, preflight);
    const seeded = await readSave(win);
    assert('inactive history fixture exceeds the slot limit without consuming slots', seeded.flights.records.length === 6
      && seeded.flights.records.filter((flight) => ['outbound', 'arrived', 'returning'].includes(flight.phase)).length === 1, {
        records: seeded.flights.records.length,
        phases: seeded.flights.records.map((flight) => ({ mission: flight.missionId, phase: flight.phase })),
      });

    const dispatch = await checkGalaxyOnePlanning(win, preflightTarget);
    await checkOtherGalaxyScan(win);
    console.log('Asteroid batch QA passed.', JSON.stringify({
      screenshotDirectory: OUTPUT,
      preflight: { coordinate: formatCoordinate(preflightTarget.coordinate), id: preflight.id },
      batchDispatches: dispatch.batchRecords.map((flight) => ({
        source: flight.originPlanetId,
        target: formatCoordinate(flight.destinationCoordinate),
        recyclers: flight.selectedShips.recycler,
      })),
      liveGasFlightCount: dispatch.liveGas.length,
    }));
  } finally {
    win.destroy();
  }
}

app.whenReady().then(async () => {
  try {
    await run();
    app.exit(0);
  } catch (error) {
    console.error(error?.stack || error);
    app.exit(1);
  }
});
