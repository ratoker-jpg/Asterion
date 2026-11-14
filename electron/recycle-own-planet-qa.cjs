// Debris on a planet's own orbit (the owner's «Питер» case): right mouse button on
// the planet offers «Собрать обломки» from that planet's own recyclers; transport
// and rebase to the same planet say «на других ваших планетах»; with no recyclers
// anywhere the refusal says «ни на одной». Screenshots: visual-qa/recycle-own-planet/.
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');
const { editSaveIdle } = require('./qa-save-edit.cjs');

app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-gpu');
app.on('window-all-closed', () => {});

const ROOT = path.join(__dirname, '..');
const OUTPUT = process.env.ASTERION_QA_OUTPUT || path.join(ROOT, 'visual-qa', 'recycle-own-planet');
const SAVE_KEY = 'asterion.vertical-slice.test.v1';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const js = (win, source) => win.webContents.executeJavaScript(source);
const SAVE = `JSON.parse(localStorage.getItem(${JSON.stringify(SAVE_KEY)}))`;

async function waitFor(win, expression, timeoutMs = 10_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await js(win, `Boolean(${expression})`)) return;
    await sleep(60);
  }
  throw new Error(`Timed out waiting for: ${expression}`);
}

async function capture(win, name) {
  await sleep(320);
  const { data } = await win.webContents.debugger.sendCommand('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  const file = path.join(OUTPUT, `${name}.png`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, Buffer.from(data, 'base64'));
}

async function selectSystem(win, system) {
  await js(win, `(() => {
    const element = document.querySelector('.universe-jump select');
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(element, ${JSON.stringify(String(system))});
    element.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);
  await waitFor(win, `document.querySelector('[data-qa-universe]')?.getAttribute('data-qa-universe-system') === ${JSON.stringify(String(system))}`);
  await sleep(150);
}

async function rightClick(win, selector) {
  const point = await js(win, `(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    if (!element) return null;
    const rect = element.getBoundingClientRect();
    return { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2) };
  })()`);
  if (!point) throw new Error(`Map object not found: ${selector}`);
  await js(win, `document.querySelector(${JSON.stringify(selector)}).dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2, clientX: ${point.x}, clientY: ${point.y} }))`);
  await waitFor(win, `document.querySelector('[data-qa-quick-menu]')`);
  await sleep(120);
}

async function menuSnapshot(win) {
  return js(win, `({
    actions: [...document.querySelectorAll('[data-qa-quick-action]')].map((item) => ({
      id: item.getAttribute('data-qa-quick-action'),
      enabled: item.getAttribute('data-qa-quick-enabled') === 'true',
      reason: item.querySelector('[data-qa-quick-reason]')?.textContent || '',
    })),
    text: document.querySelector('[data-qa-quick-menu]')?.innerText || '',
  })`);
}

async function closeMenu(win) {
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
  win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
  await waitFor(win, `!document.querySelector('[data-qa-quick-menu]')`);
}

/** Debris on the homeworld's orbit; recyclers, mega-transports and warships on it, recyclers on a colony. */
function seed(recyclersHome, recyclersColony, debris = 44100000) {
  return `(() => {
    const save = JSON.parse(localStorage.getItem(${JSON.stringify(SAVE_KEY)}) || '{}');
    const home = save.planets['helion-01'];
    home.buildings = { ...home.buildings, hangar: Math.max(home.buildings?.hangar ?? 0, 25) };
    if (!save.planets['qa-colony-a']) save.planets['qa-colony-a'] = { ...JSON.parse(JSON.stringify(home)), name: 'Вега', universeGalaxy: 1, universeSystem: 9, universePosition: 5 };
    save.planets['helion-01'].fleet.ships = { ...home.fleet.ships, recycler: ${recyclersHome}, 'mega-transporter': 2500, transporter: 40, cruiser: 146 };
    save.planets['qa-colony-a'].fleet.ships = { ...save.planets['qa-colony-a'].fleet.ships, recycler: ${recyclersColony}, 'mega-transporter': 0, transporter: 0, cruiser: 0 };
    const coordinate = { galaxy: home.universeGalaxy ?? 1, system: home.universeSystem ?? 1, position: home.universePosition ?? 1 };
    save.espionage = { ...(save.espionage || {}), orbitalDebris: { ...((save.espionage || {}).orbitalDebris || {}), qaown: {
      id: 'qaown', targetPlanetId: 'helion-01', targetPlanetName: home.name, targetOwnerId: save.profile.playerId, targetCoordinate: coordinate, debris: ${debris}, createdAt: Date.now() - 1000,
    } } };
    if (${debris} <= 0) delete save.espionage.orbitalDebris.qaown;
    localStorage.setItem(${JSON.stringify(SAVE_KEY)}, JSON.stringify(save));
    return coordinate.system;
  })()`;
}

async function openUniverseAt(win, system) {
  await js(win, `document.querySelector('[data-qa-route="universe"]')?.click()`);
  await waitFor(win, `document.querySelector('[data-qa-universe]')`);
  await selectSystem(win, system);
}

/** «Подробно»: the quick window hands over to the fleet screen; some recyclers are chosen there and the plan opens. */
async function openFleetPlanWithRecyclers(win) {
  await js(win, `document.querySelector('[data-qa-quick-details]').click()`);
  await waitFor(win, `document.querySelector('.fleet-workspace-v1')`, 20_000);
  await waitFor(win, `document.querySelector('[data-qa-fleet-ship="recycler"] input[type="number"]')`, 20_000);
  await js(win, `(() => {
    const element = document.querySelector('[data-qa-fleet-ship="recycler"] input[type="number"]');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(element, '5');
    element.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  await waitFor(win, `document.querySelector('[data-qa-flight-preview-open]') && !document.querySelector('[data-qa-flight-preview-open]').disabled`, 15_000);
  await js(win, `document.querySelector('[data-qa-flight-preview-open]').click()`);
  await waitFor(win, `document.querySelector('[data-qa-flight-dispatch-confirm]')`, 15_000);
  await sleep(600);
}

async function main() {
  const [width, height] = [1920, 1080];
  const win = new BrowserWindow({
    width, height, useContentSize: true, show: false, backgroundColor: '#02050a',
    webPreferences: { offscreen: true, contextIsolation: true, nodeIntegration: false, sandbox: true, partition: 'qa-recycle-own-planet' },
  });
  win.webContents.debugger.attach('1.3');
  await win.loadURL('about:blank');
  await win.webContents.debugger.sendCommand('Page.enable');
  await win.webContents.debugger.sendCommand('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false, screenWidth: width, screenHeight: height });
  await win.loadFile(path.join(ROOT, 'dist', 'index.html'), { search: '?mode=test' });
  await waitFor(win, `document.querySelector('[data-qa-navigation="utility"]')`, 60_000);
  await waitFor(win, `localStorage.getItem(${JSON.stringify(SAVE_KEY)})`, 30_000);

  // 1. Recyclers on the planet itself (and on a colony).
  const system = await editSaveIdle(win, seed(2054, 6), { label: 'own orbit debris', held: `${SAVE}.planets['helion-01'].fleet.ships.recycler === 2054` });
  await openUniverseAt(win, system);
  const planet = '[data-qa-universe-object="player-planet-helion-01"]';
  await rightClick(win, planet);
  const menu = await menuSnapshot(win);
  console.log('menu 1', JSON.stringify(menu.actions));
  if (!menu.actions.find((a) => a.id === 'recycle')?.enabled) throw new Error(`recycle refused: ${JSON.stringify(menu.actions)}`);
  if (/ни на одной/.test(menu.text)) throw new Error(`misleading text: ${menu.text}`);
  await capture(win, 'menu-recyclers-on-planet');
  await js(win, `document.querySelector('[data-qa-quick-action="recycle"]').click()`);
  await waitFor(win, `document.querySelector('[data-qa-quick-send="recycle"] [data-qa-quick-ship="recycler"]')`);
  const legs = await js(win, `[...document.querySelectorAll('[data-qa-quick-leg]')].map((leg) => [leg.getAttribute('data-qa-quick-leg'), leg.getAttribute('data-qa-quick-leg-checked')])`);
  console.log('legs', JSON.stringify(legs));
  if (!legs.some((leg) => leg[0] === 'helion-01' && leg[1] === 'true')) throw new Error(`own planet is not a checked source: ${JSON.stringify(legs)}`);
  await capture(win, 'recycle-panel-own-planet-source');
  const note = await js(win, `document.querySelector('[data-qa-quick-recycle-note]')?.textContent || ''`);
  console.log('note', note);

  // 1b. «Подробно»: the fleet screen's «Переработка» plan to the planet's own coordinate can be sent.
  await openFleetPlanWithRecyclers(win);
  const dispatchState = await js(win, `(() => { const b = document.querySelector('[data-qa-flight-dispatch-confirm]'); return { disabled: b.disabled, text: document.querySelector('[data-qa-flight-dispatch-confirm]').closest('section,aside,div')?.innerText.slice(0, 400) }; })()`);
  console.log('fleet screen send', JSON.stringify(dispatchState));
  await capture(win, 'fleet-screen-recycle-own-orbit');
  if (dispatchState.disabled) throw new Error('fleet screen: ОТПРАВИТЬ is disabled for recycle to own orbit');
  await js(win, `document.querySelector('[data-qa-route="universe"]')?.click()`);
  await waitFor(win, `document.querySelector('[data-qa-universe]')`);

  // 2. No recyclers on the planet, some on the colony: the colony is the source.
  await editSaveIdle(win, seed(0, 6), { label: 'recyclers only on colony', held: `${SAVE}.planets['helion-01'].fleet.ships.recycler === 0` });
  await openUniverseAt(win, system);
  await rightClick(win, planet);
  const menu2 = await menuSnapshot(win);
  if (!menu2.actions.find((a) => a.id === 'recycle')?.enabled) throw new Error(`recycle from colony refused: ${JSON.stringify(menu2.actions)}`);
  await capture(win, 'menu-recyclers-on-other-planet');
  await closeMenu(win);

  // 3. No recyclers anywhere: the refusal is true; transport to the same planet says «на других».
  await editSaveIdle(win, seed(0, 0), { label: 'no recyclers', held: `${SAVE}.planets['qa-colony-a'].fleet.ships.recycler === 0` });
  await openUniverseAt(win, system);
  await rightClick(win, planet);
  const menu3 = await menuSnapshot(win);
  console.log('menu 3', JSON.stringify(menu3.actions));
  const recycle3 = menu3.actions.find((a) => a.id === 'recycle');
  if (recycle3?.enabled || !/Нет свободных переработчиков ни на одной вашей планете/.test(recycle3?.reason || '')) throw new Error(`recycle reason: ${JSON.stringify(recycle3)}`);
  const transport3 = menu3.actions.find((a) => a.id === 'transport');
  if (transport3?.enabled || !/на других ваших планетах/.test(transport3?.reason || '')) throw new Error(`transport reason: ${JSON.stringify(transport3)}`);
  await capture(win, 'menu-no-recyclers-anywhere');
  await closeMenu(win);

  // 4. No debris anywhere: recycle is still offered and the fleet screen can send it (in advance).
  await editSaveIdle(win, seed(2054, 0, 0), { label: 'no debris', held: `!(${SAVE}.espionage.orbitalDebris || {}).qaown && ${SAVE}.planets['helion-01'].fleet.ships.recycler === 2054` });
  await openUniverseAt(win, system);
  await rightClick(win, planet);
  const menu4 = await menuSnapshot(win);
  const recycle4 = menu4.actions.find((a) => a.id === 'recycle');
  if (!recycle4?.enabled) throw new Error(`recycle without debris refused: ${JSON.stringify(menu4.actions)}`);
  await capture(win, 'menu-no-debris-recycle-offered');
  await js(win, `document.querySelector('[data-qa-quick-action="recycle"]').click()`);
  await waitFor(win, `document.querySelector('[data-qa-quick-recycle-note]')`);
  console.log('note 4', await js(win, `document.querySelector('[data-qa-quick-recycle-note]').textContent`));
  await capture(win, 'recycle-panel-no-debris-note');
  await openFleetPlanWithRecyclers(win);
  if (await js(win, `document.querySelector('[data-qa-flight-dispatch-confirm]').disabled`)) throw new Error('fleet screen: ОТПРАВИТЬ disabled for recycle without debris');
  await capture(win, 'fleet-screen-recycle-no-debris');
  win.destroy();
}

app.whenReady().then(async () => {
  try {
    fs.rmSync(OUTPUT, { recursive: true, force: true });
    await main();
    console.log('Recycle own planet QA passed.');
    app.exit(0);
  } catch (error) {
    console.error(error);
    app.exit(1);
  }
});
