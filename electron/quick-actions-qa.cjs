// Quick actions on map objects (right mouse button in «Вселенная»):
// the menu per object type, a disabled action with its reason, the
// multi-planet quick-send panel and a real send through the game's dispatch.
// Screenshots go to visual-qa/quick-actions/<viewport>/final (ASTERION_QA_OUTPUT
// overrides; ASTERION_SKIP_SCREENSHOTS=1 keeps the checks only).
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');
const { editSaveIdle } = require('./qa-save-edit.cjs');

app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-gpu');
app.on('window-all-closed', () => {});

const ROOT = path.join(__dirname, '..');
const OUTPUT = process.env.ASTERION_QA_OUTPUT || path.join(ROOT, 'visual-qa', 'quick-actions');
const SAVE_KEY = 'asterion.vertical-slice.test.v1';
const VIEWPORTS = [[1920, 1080], [1280, 720]];
const skipScreenshots = process.env.ASTERION_SKIP_SCREENSHOTS === '1';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(win, expression, timeoutMs = 10_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await win.webContents.executeJavaScript(`Boolean(${expression})`)) return;
    await sleep(60);
  }
  throw new Error(`Timed out waiting for: ${expression}`);
}

const js = (win, source) => win.webContents.executeJavaScript(source);

async function capture(win, directory, name) {
  if (skipScreenshots) return;
  await sleep(320);
  // CDP captures the emulated viewport exactly (capturePage follows the native surface).
  const { data } = await win.webContents.debugger.sendCommand('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  const file = path.join(directory, `${name}.png`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, Buffer.from(data, 'base64'));
}

async function openUniverse(win) {
  await js(win, `document.querySelector('[data-qa-route="universe"]')?.click()`);
  await waitFor(win, `document.querySelector('[data-qa-universe]')`);
  await sleep(200);
}

async function selectSystem(win, system) {
  await js(win, `(() => {
    const element = document.querySelector('.universe-jump select');
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set;
    setter.call(element, ${JSON.stringify(String(system))});
    element.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);
  await waitFor(win, `document.querySelector('[data-qa-universe]')?.getAttribute('data-qa-universe-system') === ${JSON.stringify(String(system))}`);
  await sleep(150);
}

/** Right mouse button on a map object, as the player does it. */
async function rightClick(win, selector) {
  const point = await js(win, `(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    if (!element) return null;
    const rect = element.getBoundingClientRect();
    return { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2) };
  })()`);
  if (!point) throw new Error(`Map object not found: ${selector}`);
  win.webContents.sendInputEvent({ type: 'mouseDown', x: point.x, y: point.y, button: 'right', clickCount: 1 });
  win.webContents.sendInputEvent({ type: 'mouseUp', x: point.x, y: point.y, button: 'right', clickCount: 1 });
  win.webContents.sendInputEvent({ type: 'contextMenu', x: point.x, y: point.y, button: 'right' });
  try {
    await waitFor(win, `document.querySelector('[data-qa-quick-menu]')`, 3_000);
  } catch {
    // Offscreen windows do not always turn the right button into a contextmenu event.
    await js(win, `(() => {
      const element = document.querySelector(${JSON.stringify(selector)});
      element.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2, clientX: ${point.x}, clientY: ${point.y} }));
    })()`);
    await waitFor(win, `document.querySelector('[data-qa-quick-menu]')`);
  }
  await sleep(120);
}

async function closeMenu(win) {
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
  win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
  await waitFor(win, `!document.querySelector('[data-qa-quick-menu]')`);
}

async function menuSnapshot(win) {
  return js(win, `(() => {
    const menu = document.querySelector('[data-qa-quick-menu]');
    const rect = menu?.getBoundingClientRect();
    return {
      kind: menu?.getAttribute('data-qa-quick-menu'),
      actions: [...document.querySelectorAll('[data-qa-quick-action]')].map((item) => ({
        id: item.getAttribute('data-qa-quick-action'),
        enabled: item.getAttribute('data-qa-quick-enabled') === 'true',
        reason: item.querySelector('[data-qa-quick-reason]')?.textContent || '',
      })),
      inside: rect ? rect.left >= 0 && rect.top >= 0 && rect.right <= innerWidth && rect.bottom <= innerHeight : false,
      focused: document.activeElement?.getAttribute('data-qa-quick-action') || document.activeElement?.getAttribute('data-qa-quick-go') !== null && document.activeElement?.hasAttribute('data-qa-quick-go') ? 'go' : document.activeElement?.getAttribute('data-qa-quick-action') || '',
      text: menu?.innerText || '',
    };
  })()`);
}

/** Picks an action from the open menu; a refused one fails with the reasons on screen. */
async function chooseAction(win, label, id) {
  const snapshot = await menuSnapshot(win);
  const action = snapshot.actions.find((item) => item.id === id);
  if (!action?.enabled) throw new Error(`${label}: «${id}» refused ${JSON.stringify(snapshot.actions)}`);
  await js(win, `document.querySelector('[data-qa-quick-action="${id}"]').click()`);
  await waitFor(win, `document.querySelector('[data-qa-quick-send="${id}"]')`);
}

function expectActions(label, snapshot, ids) {
  const actual = snapshot.actions.map((action) => action.id);
  if (JSON.stringify(actual) !== JSON.stringify(ids)) throw new Error(`${label}: actions ${JSON.stringify(actual)} != ${JSON.stringify(ids)}`);
  if (!snapshot.inside) throw new Error(`${label}: menu leaves the window`);
  if (/runtime|preview|undefined|NaN|null/i.test(snapshot.text)) throw new Error(`${label}: technical text in menu: ${snapshot.text}`);
}

/** Ships on every own planet, a colonizer nowhere (its action shows the reason). */
async function seedFleet(win) {
  return editSaveIdle(win, `(() => {
    const save = JSON.parse(localStorage.getItem(${JSON.stringify(SAVE_KEY)}) || '{}');
    // Two more own planets (copies of the homeworld at free positions), so a
    // target can be reached from several planets.
    const home = save.planets['helion-01'];
    // Room in the homeworld hangar for a rebase from the colonies.
    home.buildings = { ...home.buildings, hangar: Math.max(home.buildings?.hangar ?? 0, 25) };
    for (const [id, name, system, position] of [['qa-colony-a', 'Вега', 9, 5], ['qa-colony-b', 'Орион', 4, 9]]) {
      save.planets[id] = { ...JSON.parse(JSON.stringify(home)), name, universeGalaxy: 1, universeSystem: system, universePosition: position };
    }
    const ids = Object.keys(save.planets || {});
    ids.forEach((id, index) => {
      const planet = save.planets[id];
      planet.fleet = planet.fleet || { ships: {}, commanders: {} };
      planet.fleet.ships = { ...planet.fleet.ships, 'spy-probe': 3, recycler: 6, transporter: 4, cruiser: 12 + index * 4, scout: 20, colonizer: 0 };
    });
    localStorage.setItem(${JSON.stringify(SAVE_KEY)}, JSON.stringify(save));
    return ids;
  })()`, { label: 'quick actions fleet', held: `Object.values(JSON.parse(localStorage.getItem(${JSON.stringify(SAVE_KEY)}) || '{}').planets || {}).every((planet) => planet.fleet?.ships?.recycler === 6)` });
}

async function runViewport(width, height) {
  const label = `${width}x${height}`;
  const directory = path.join(OUTPUT, label);
  const win = new BrowserWindow({
    width, height, useContentSize: true, show: false, backgroundColor: '#02050a',
    webPreferences: { offscreen: true, contextIsolation: true, nodeIntegration: false, sandbox: true, partition: `qa-quick-actions-${label}` },
  });
  try {
    await win.loadURL('about:blank');
    win.webContents.debugger.attach('1.3');
    await win.webContents.debugger.sendCommand('Page.enable');
    await win.webContents.debugger.sendCommand('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false, screenWidth: width, screenHeight: height });
    await win.loadFile(path.join(ROOT, 'dist', 'index.html'), { search: '?mode=test' });
    await waitFor(win, `document.querySelector('[data-qa-navigation="utility"]')`, 60_000);
    await waitFor(win, `localStorage.getItem(${JSON.stringify(SAVE_KEY)})`, 30_000);
    const planetIds = await seedFleet(win);
    await openUniverse(win);

    if (process.env.ASTERION_QA_DUMP === '1') {
      const dump = [];
      for (let system = 1; system <= 12; system += 1) {
        await selectSystem(win, system);
        dump.push(await js(win, `(() => ({ system: ${system}, objects: [...document.querySelectorAll('[data-qa-universe-object]')].map((node) => [node.getAttribute('data-qa-universe-object'), node.getAttribute('data-qa-universe-kind'), node.getAttribute('data-qa-universe-relation') || '', node.getAttribute('data-qa-universe-underlying-kind') || '', node.classList.contains('system-planet--with-debris') || node.classList.contains('empty-slot--with-debris') ? 'debris' : '']).filter((row) => row[1] !== 'empty' || row[4]) }))()`));
      }
      console.log(JSON.stringify({ planetIds, dump }, null, 1));
      return;
    }
    await scenarios(win, directory, label);
  } finally {
    win.destroy();
  }
}

async function scenarios(win, directory, label) {
  // 1. Enemy planet: the menu beside it. (The radial variant it was compared
  // with is kept as screenshots in visual-qa/quick-actions/variants.)
  await selectSystem(win, 8);
  const enemy = '[data-qa-universe-relation="neutral"]';
  await rightClick(win, enemy);
  const enemyMenu = await menuSnapshot(win);
  expectActions(`${label} enemy planet`, enemyMenu, ['spy', 'attack', 'transport', 'recycle']);
  if (enemyMenu.kind !== 'menu') throw new Error(`${label}: action menu expected`);
  await capture(win, directory, 'final/enemy-planet-menu');

  // Keyboard: focus starts on the first action, arrows move it.
  const focusBefore = await js(win, `document.activeElement?.getAttribute('data-qa-quick-action')`);
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Down' });
  win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Down' });
  await sleep(80);
  const focusAfter = await js(win, `document.activeElement?.getAttribute('data-qa-quick-action')`);
  if (focusBefore !== 'spy' || focusAfter !== 'attack') throw new Error(`${label}: keyboard focus ${focusBefore} → ${focusAfter}`);

  // 2. Debris on a planet's orbit: the recycler, sized to the debris.
  await selectSystem(win, 11);
  await rightClick(win, enemy);
  expectActions(`${label} debris planet`, await menuSnapshot(win), ['spy', 'attack', 'transport', 'recycle']);
  const debrisMenu = await menuSnapshot(win);
  if (!debrisMenu.actions.find((action) => action.id === 'recycle')?.enabled) throw new Error(`${label}: recycle refused ${JSON.stringify(debrisMenu.actions)}`);
  await js(win, `document.querySelector('[data-qa-quick-action="recycle"]').click()`);
  await waitFor(win, `document.querySelector('[data-qa-quick-send="recycle"] [data-qa-quick-ship="recycler"]')`);
  await capture(win, directory, 'final/debris-recycle-panel');
  await closeMenu(win);
  await selectSystem(win, 8);

  // Own planet: transport, and a rebase gathered from the other planets.
  await selectSystem(win, 1);
  await rightClick(win, '[data-qa-universe-object="player-planet-helion-01"]');
  expectActions(`${label} own planet`, await menuSnapshot(win), ['transport', 'deployment']);
  await chooseAction(win, label, 'deployment');
  await capture(win, directory, 'final/own-planet-rebase-panel');
  // A click outside closes it.
  const bottom = Math.round((await js(win, 'innerHeight')) - 6);
  win.webContents.sendInputEvent({ type: 'mouseDown', x: 6, y: bottom, button: 'left', clickCount: 1 });
  win.webContents.sendInputEvent({ type: 'mouseUp', x: 6, y: bottom, button: 'left', clickCount: 1 });
  await waitFor(win, `!document.querySelector('[data-qa-quick-menu]')`);

  await selectSystem(win, 8);
  // 3. Attack from several planets in one go.
  await rightClick(win, enemy);
  await chooseAction(win, label, 'attack');
  const legs = await js(win, `[...document.querySelectorAll('[data-qa-quick-leg]')].map((leg) => [leg.getAttribute('data-qa-quick-leg'), leg.getAttribute('data-qa-quick-leg-checked')])`);
  if (legs.length !== 3 || legs.filter((leg) => leg[1] === 'true').length !== 1) throw new Error(`${label}: legs ${JSON.stringify(legs)}`);
  for (const [planetId, checked] of legs) {
    if (checked !== 'true') await js(win, `document.querySelector('[data-qa-quick-origin="${planetId}"]').click()`);
  }
  await waitFor(win, `document.querySelectorAll('[data-qa-quick-leg-checked="true"]').length === 3`);
  try {
    await waitFor(win, `document.querySelector('[data-qa-quick-route="ok"]')`, 3_000);
  } catch {
    throw new Error(`${label}: attack legs refused: ${await js(win, `[...document.querySelectorAll('[data-qa-quick-error]')].map((node) => node.textContent).join(' | ')`)}`);
  }
  const panelBox = await js(win, `(() => { const r = document.querySelector('[data-qa-quick-menu]').getBoundingClientRect(); return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, h: innerHeight, w: innerWidth }; })()`);
  if (panelBox.top < 0 || panelBox.left < 0 || panelBox.bottom > panelBox.h || panelBox.right > panelBox.w) throw new Error(`${label}: quick-send panel leaves the window ${JSON.stringify(panelBox)}`);
  await capture(win, directory, 'final/quick-send-attack-three-planets');
  await js(win, `document.querySelector('[data-qa-quick-go]').click()`);
  await waitFor(win, `!document.querySelector('[data-qa-quick-menu]')`);
  await waitFor(win, `/Отправлено флотов: 3/.test(document.body.innerText)`, 5_000);
  // Every flight slot is now taken: the game's own limit is the reason shown.
  await rightClick(win, enemy);
  const limited = await menuSnapshot(win);
  if (limited.actions.find((action) => action.id === 'transport')?.enabled || !/лимит одновременных полётов/.test(limited.text)) throw new Error(`${label}: flight limit reason missing ${JSON.stringify(limited.actions)}`);
  await capture(win, directory, 'final/disabled-flight-limit-reason');
  await closeMenu(win);

  // 4. Asteroid: «Колонизировать» is shown with its reason (no colonizer anywhere).
  await selectSystem(win, 1);
  await rightClick(win, '[data-qa-universe-kind="asteroid"][data-qa-universe-underlying-kind="empty"]');
  const asteroid = await menuSnapshot(win);
  expectActions(`${label} asteroid`, asteroid, ['colonize', 'gas']);
  if (asteroid.actions[0].enabled || !/колонизатор/.test(asteroid.actions[0].reason)) throw new Error(`${label}: colonize reason ${JSON.stringify(asteroid.actions[0])}`);
  await capture(win, directory, 'final/asteroid-menu-disabled-reason');
  await closeMenu(win);

  // 5. Unique object: probe and expedition (attack when occupied).
  await selectSystem(win, 5);
  await rightClick(win, '[data-qa-universe-kind="unique"]');
  const unique = await menuSnapshot(win);
  if (unique.actions[0]?.id !== 'exploration-recon' || !['expedition', 'exploration-attack'].includes(unique.actions[1]?.id)) throw new Error(`${label}: unique actions ${JSON.stringify(unique.actions)}`);
  await capture(win, directory, 'final/unique-object-menu');

  // 6. «Карточка объекта» and the left click still open the full dialog.
  await js(win, `document.querySelector('[data-qa-quick-open-card]').click()`);
  await waitFor(win, `document.querySelector('[data-qa-universe-inspector]') && !document.querySelector('[data-qa-quick-menu]')`);
  await js(win, `document.querySelector('[data-qa-universe-inspector] [data-asterion-close]').click()`);
  await waitFor(win, `!document.querySelector('[data-qa-universe-inspector]')`);
  await js(win, `document.querySelector('[data-qa-universe-kind="unique"]').click()`);
  await waitFor(win, `document.querySelector('[data-qa-universe-inspector]')`);
}

app.whenReady().then(async () => {
  try {
    // Only this run's viewport folders are replaced; variants/ holds the design comparison.
    if (!skipScreenshots && !process.env.ASTERION_QA_DUMP) for (const [width, height] of VIEWPORTS) fs.rmSync(path.join(OUTPUT, `${width}x${height}`), { recursive: true, force: true });
    for (const [width, height] of VIEWPORTS) await runViewport(width, height);
    console.log('Quick actions QA passed.');
    app.exit(0);
  } catch (error) {
    console.error(error);
    app.exit(1);
  }
});
