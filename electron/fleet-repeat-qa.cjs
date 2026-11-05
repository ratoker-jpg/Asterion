// The fleet screen keeps its target (audit 03.11, М3): the map opens on the
// current planet, a rebase opens on the last own target, «Повторить» rebuilds a
// flight, and after «Отправить» a second wave goes from another planet without
// the map. Screenshots go to visual-qa/fleet-repeat/<viewport> (ASTERION_QA_OUTPUT
// overrides; ASTERION_SKIP_SCREENSHOTS=1 keeps the checks only).
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');
const { editSaveIdle } = require('./qa-save-edit.cjs');

app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-gpu');
app.on('window-all-closed', () => {});

const ROOT = path.join(__dirname, '..');
const OUTPUT = process.env.ASTERION_QA_OUTPUT || path.join(ROOT, 'visual-qa', 'fleet-repeat');
const SAVE_KEY = 'asterion.vertical-slice.test.v1';
const VIEWPORTS = [[1920, 1080], [1280, 720]];
const skipScreenshots = process.env.ASTERION_SKIP_SCREENSHOTS === '1';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const js = (win, source) => win.webContents.executeJavaScript(source);

async function waitFor(win, expression, timeoutMs = 10_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await js(win, `Boolean(${expression})`)) return;
    await sleep(60);
  }
  throw new Error(`Timed out waiting for: ${expression}\n${await js(win, `(document.querySelector('.flight-timeline-modal')?.innerText || document.querySelector('[data-qa-fleet-status]')?.innerText || '').slice(0, 1500)`)}`);
}

async function capture(win, directory, name) {
  if (skipScreenshots) return;
  // Notices stack over the top-left of the screen; the screenshot is about the fleet screen.
  await js(win, `document.querySelectorAll('[data-qa-runtime-toast] button').forEach((button) => button.click())`);
  await sleep(320);
  const { data } = await win.webContents.debugger.sendCommand('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  const file = path.join(directory, `${name}.png`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, Buffer.from(data, 'base64'));
}

/** Counts the player's clicks for the audit scenarios. */
let clicks = 0;
async function click(win, selector) {
  clicks += 1;
  const found = await js(win, `(() => { const element = document.querySelector(${JSON.stringify(selector)}); if (!element || element.disabled) return false; element.click(); return true; })()`);
  if (!found) throw new Error(`Missing or disabled control: ${selector}`);
  await sleep(120);
}

async function choose(win, selector, value) {
  clicks += 1;
  const ok = await js(win, `(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    if (!element) return false;
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(element, ${JSON.stringify(String(value))});
    element.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  })()`);
  if (!ok) throw new Error(`Missing select: ${selector}`);
  await sleep(150);
}

async function typeNumber(win, selector, value) {
  clicks += 1;
  await js(win, `(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(element, ${JSON.stringify(String(value))});
    element.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  await sleep(100);
}

function expectClicks(label, scenario, allowed) {
  if (clicks > allowed) throw new Error(`${label}: ${scenario} took ${clicks} clicks, the audit allows ${allowed}`);
  console.log(`${label}: ${scenario} — ${clicks} clicks`);
}

const playerFlights = (win, missionId) => js(win, `(() => {
  const save = JSON.parse(localStorage.getItem(${JSON.stringify(SAVE_KEY)}) || '{}');
  return (save.flights?.records || []).filter((flight) => (!flight.ownerSide || flight.ownerSide === 'player') && flight.missionId === ${JSON.stringify(missionId)} && flight.phase === 'outbound')
    .map((flight) => ({ origin: flight.originPlanetId, target: flight.destinationCoordinate, ships: flight.selectedShips }));
})()`);

async function seed(win) {
  return editSaveIdle(win, `(() => {
    const save = JSON.parse(localStorage.getItem(${JSON.stringify(SAVE_KEY)}) || '{}');
    const home = save.planets['helion-01'];
    home.buildings = { ...home.buildings, hangar: Math.max(home.buildings?.hangar ?? 0, 25) };
    for (const [id, name, system, position] of [['qa-colony-a', 'Вега', 9, 5], ['qa-colony-b', 'Орион', 4, 9]]) {
      save.planets[id] = { ...JSON.parse(JSON.stringify(home)), name, universeGalaxy: 1, universeSystem: system, universePosition: position };
    }
    Object.values(save.planets).forEach((planet, index) => {
      planet.fleet = planet.fleet || { ships: {}, commanders: {} };
      planet.fleet.ships = { ...planet.fleet.ships, 'spy-probe': 2, recycler: 2, transporter: 4, cruiser: 10 + index * 5, scout: 12, colonizer: 0 };
    });
    // Room for five flights at once (3 + 1.5 per «Компьютерные системы» level), the game's own limit.
    save.science = { ...save.science, levels: { ...(save.science?.levels || {}), 6: 2 } };
    // Standing on Вега (system 9), not on the homeworld.
    save.currentPlanetId = 'qa-colony-a';
    delete save.fleetUi;
    localStorage.setItem(${JSON.stringify(SAVE_KEY)}, JSON.stringify(save));
    return true;
  })()`, { label: 'fleet repeat seed', held: `JSON.parse(localStorage.getItem(${JSON.stringify(SAVE_KEY)}) || '{}').planets?.['qa-colony-b']?.fleet?.ships?.cruiser === 20` });
}

async function openFleets(win) {
  await click(win, '[data-qa-route="fleets"]');
  await waitFor(win, `document.querySelector('[data-qa-fleet-root]')`);
}

async function runViewport(width, height) {
  const label = `${width}x${height}`;
  const directory = path.join(OUTPUT, label);
  const win = new BrowserWindow({
    width, height, useContentSize: true, show: false, backgroundColor: '#02050a',
    webPreferences: { offscreen: true, contextIsolation: true, nodeIntegration: false, sandbox: true, partition: `qa-fleet-repeat-${label}` },
  });
  try {
    await win.loadURL('about:blank');
    win.webContents.debugger.attach('1.3');
    await win.webContents.debugger.sendCommand('Page.enable');
    await win.webContents.debugger.sendCommand('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false, screenWidth: width, screenHeight: height });
    await win.loadFile(path.join(ROOT, 'dist', 'index.html'), { search: '?mode=test' });
    await waitFor(win, `document.querySelector('[data-qa-navigation="utility"]')`, 60_000);
    await waitFor(win, `localStorage.getItem(${JSON.stringify(SAVE_KEY)})`, 30_000);
    await seed(win);
    await scenarios(win, directory, label);
  } finally {
    win.destroy();
  }
}

async function scenarios(win, directory, label) {
  // Scenario 10: the map opens on the current planet's system (Вега, 9), not on the homeworld's.
  clicks = 0;
  await click(win, '[data-qa-route="universe"]');
  await waitFor(win, `document.querySelector('[data-qa-universe]')`);
  const system = await js(win, `document.querySelector('[data-qa-universe]').getAttribute('data-qa-universe-system')`);
  if (system !== '9') throw new Error(`${label}: map opened on system ${system}, expected 9`);
  expectClicks(label, 'scenario 10 (map at the current planet)', 1);
  await capture(win, directory, '10-map-opens-on-current-planet');

  // Scenario 9: the rebase opens on the last own target.
  await openFleets(win);
  const deploy = async () => {
    await click(win, '[data-qa-mission-id="deployment"]');
    await typeNumber(win, '[data-qa-fleet-ship="scout"] input[type="number"]', 2);
    await click(win, '[data-qa-flight-preview-open]');
    await waitFor(win, `document.querySelector('[data-qa-deployment-target-select] select')`);
  };
  await deploy();
  await choose(win, '[data-qa-deployment-target-select] select', 'helion-01');
  await waitFor(win, `!document.querySelector('[data-qa-flight-dispatch-confirm]').disabled`);
  await click(win, '[data-qa-flight-dispatch-confirm]');
  await waitFor(win, `document.querySelector('[data-qa-fleet-sent-strip]')`);
  await click(win, '[data-qa-fleet-sent-done]');
  clicks = 0;
  await deploy();
  const remembered = await js(win, `document.querySelector('[data-qa-deployment-target-select] select').value`);
  if (remembered !== 'helion-01') throw new Error(`${label}: rebase opened on «${remembered}», expected the last target helion-01`);
  const hint = await js(win, `document.querySelector('[data-qa-flight-draft-hint]')?.innerText || ''`);
  if (/Введите галактику/.test(hint)) throw new Error(`${label}: rebase still asks for coordinates: ${hint}`);
  await waitFor(win, `!document.querySelector('[data-qa-flight-dispatch-confirm]').disabled`);
  expectClicks(label, 'scenario 9 (rebase: target already chosen)', 3);
  await capture(win, directory, '09-deploy-opens-on-last-target');
  await click(win, '[data-qa-flight-preview-cancel]');

  // Scenario 4: «Повторить» in «Все рейсы» rebuilds source, target and ships.
  await click(win, '[data-qa-flights-toggle]');
  await waitFor(win, `document.querySelector('[data-qa-flight-repeat]')`);
  await capture(win, directory, '04-all-flights-repeat');
  clicks = 0;
  await click(win, '[data-qa-flight-repeat]');
  await waitFor(win, `document.querySelector('[data-qa-flight-source-step]') && document.querySelector('[data-qa-deployment-target-select] select')?.value === 'helion-01'`);
  const repeatSource = await js(win, `document.querySelector('[data-qa-flight-source-select]')?.value`);
  const repeatShips = await js(win, `document.querySelector('[data-qa-flight-ships]')?.innerText || ''`);
  if (repeatSource !== 'qa-colony-a' || !/×2/.test(repeatShips)) throw new Error(`${label}: repeat source ${repeatSource}, ships ${repeatShips}`);
  await waitFor(win, `!document.querySelector('[data-qa-flight-dispatch-confirm]').disabled`);
  await capture(win, directory, '04-repeat-plan');
  await click(win, '[data-qa-flight-dispatch-confirm]');
  await waitFor(win, `document.querySelector('[data-qa-fleet-sent-strip]')`);
  expectClicks(label, 'scenario 4 («Повторить» → «Отправить»)', 2);
  await waitFor(win, `(${(await playerFlights(win, 'deployment')).length} >= 0) && JSON.parse(localStorage.getItem(${JSON.stringify(SAVE_KEY)})).flights.records.filter((flight) => flight.missionId === 'deployment' && flight.phase === 'outbound').length === 2`, 8_000);
  await click(win, '[data-qa-fleet-sent-done]');

  // Attack from the map, then a second wave from another planet without the map.
  await click(win, '[data-qa-route="universe"]');
  await waitFor(win, `document.querySelector('[data-qa-universe]')`);
  await js(win, `(() => {
    const element = document.querySelector('.universe-jump select');
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(element, '8');
    element.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);
  await waitFor(win, `document.querySelector('[data-qa-universe]')?.getAttribute('data-qa-universe-system') === '8'`);
  await click(win, '[data-qa-universe-relation="neutral"]');
  await waitFor(win, `document.querySelector('[data-qa-universe-inspector] [data-qa-universe-action="attack"]')`);
  await click(win, '[data-qa-universe-inspector] [data-qa-universe-action="attack"]');
  await waitFor(win, `document.querySelector('[data-qa-attack-prep]')`);
  await click(win, '[data-qa-fleet-select-all]');
  await click(win, '[data-qa-flight-preview-open]');
  await waitFor(win, `document.querySelector('[data-qa-flight-favorite-toggle]')`);
  await click(win, '[data-qa-flight-favorite-toggle]');
  await waitFor(win, `document.querySelector('[data-qa-flight-favorite-toggle]')?.getAttribute('aria-pressed') === 'true'`);
  await capture(win, directory, '05-attack-plan-favourite');
  await waitFor(win, `!document.querySelector('[data-qa-flight-dispatch-confirm]').disabled`);
  await click(win, '[data-qa-flight-dispatch-confirm]');
  await waitFor(win, `document.querySelector('[data-qa-fleet-sent-strip]')`);
  const kept = await js(win, `({ mission: document.querySelector('[data-qa-mission-current]')?.getAttribute('data-qa-mission-current'), target: document.querySelector('[data-qa-flight-launch-context]')?.getAttribute('data-qa-flight-launch-context') })`);
  if (kept.mission !== 'attack' || !kept.target) throw new Error(`${label}: after «Отправить» the screen forgot the target ${JSON.stringify(kept)}`);
  await capture(win, directory, '05-after-send-strip');

  // Scenario 5: «Ещё с другой планеты» → source → «Отправить».
  clicks = 0;
  await click(win, '[data-qa-fleet-next-wave]');
  await waitFor(win, `document.querySelector('[data-qa-flight-source-select]')`);
  const firstChoice = await js(win, `document.querySelector('[data-qa-flight-source-select]').value`);
  if (firstChoice === 'qa-colony-a') throw new Error(`${label}: next wave offered the planet that just sent`);
  const other = firstChoice === 'helion-01' ? 'qa-colony-b' : 'helion-01';
  await choose(win, '[data-qa-flight-source-select]', other);
  await waitFor(win, `document.querySelector('[data-qa-flight-source-select]').value === ${JSON.stringify(other)} && /×/.test(document.querySelector('[data-qa-flight-ships]')?.innerText || '')`);
  const currentPlanet = await js(win, `JSON.parse(localStorage.getItem(${JSON.stringify(SAVE_KEY)})).currentPlanetId`);
  if (currentPlanet !== 'qa-colony-a') throw new Error(`${label}: changing the source switched the current planet to ${currentPlanet}`);
  await waitFor(win, `!document.querySelector('[data-qa-flight-dispatch-confirm]').disabled`);
  await capture(win, directory, '05-next-wave-source-changed');
  await click(win, '[data-qa-flight-dispatch-confirm]');
  await waitFor(win, `document.querySelector('[data-qa-fleet-sent-strip]')`);
  expectClicks(label, 'scenario 5 (second wave from another planet)', 4);
  if (await js(win, `Boolean(document.querySelector('[data-qa-universe]'))`)) throw new Error(`${label}: the map opened during the second wave`);
  await waitFor(win, `JSON.parse(localStorage.getItem(${JSON.stringify(SAVE_KEY)})).flights.records.filter((flight) => flight.missionId === 'attack' && (!flight.ownerSide || flight.ownerSide === 'player') && flight.phase === 'outbound').length === 2`, 8_000);
  const attacks = await playerFlights(win, 'attack');
  if (new Set(attacks.map((flight) => flight.origin)).size !== 2 || new Set(attacks.map((flight) => JSON.stringify(flight.target))).size !== 1) throw new Error(`${label}: attacks ${JSON.stringify(attacks)}`);

  // Picking another planet in the header keeps mission and target.
  // The planet that has not sent yet still has its ships.
  const unused = ['helion-01', 'qa-colony-b'].find((id) => !attacks.some((flight) => flight.origin === id));
  await click(win, '.hdr-planet-select');
  await waitFor(win, `document.querySelector('[data-qa-planet-option="${unused}"]')`);
  await click(win, `[data-qa-planet-option="${unused}"]`);
  await waitFor(win, `JSON.parse(localStorage.getItem(${JSON.stringify(SAVE_KEY)})).currentPlanetId === ${JSON.stringify(unused)}`);
  const afterSwitch = await js(win, `({ mission: document.querySelector('[data-qa-mission-current]')?.getAttribute('data-qa-mission-current'), target: document.querySelector('[data-qa-flight-launch-context]')?.getAttribute('data-qa-flight-launch-context') })`);
  if (afterSwitch.mission !== 'attack' || afterSwitch.target !== kept.target) throw new Error(`${label}: the header switch reset the screen ${JSON.stringify(afterSwitch)}`);
  await capture(win, directory, '05-header-switch-keeps-target');

  // The favourite is in the save (UI data) and listed in step 02.
  await waitFor(win, `(JSON.parse(localStorage.getItem(${JSON.stringify(SAVE_KEY)})).fleetUi?.favoriteTargets || []).length === 1`, 8_000);
  await click(win, '[data-qa-fleet-select-all]');
  await click(win, '[data-qa-flight-preview-open]');
  // The list shows while the target is being changed.
  await click(win, '[data-qa-flight-target-status] .flight-timeline-edit:not([data-qa-flight-favorite-toggle])');
  await waitFor(win, `document.querySelector('[data-qa-flight-favorite-select] select')?.options.length === 2`);
  await capture(win, directory, '06-favourites-in-plan');
  await click(win, '[data-qa-flight-preview-cancel]');
}

app.whenReady().then(async () => {
  try {
    if (!skipScreenshots) fs.rmSync(OUTPUT, { recursive: true, force: true });
    for (const [width, height] of VIEWPORTS) await runViewport(width, height);
    console.log('Fleet repeat QA passed.');
    app.exit(0);
  } catch (error) {
    console.error(error);
    app.exit(1);
  }
});
