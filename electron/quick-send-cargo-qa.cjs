// Quick-send panel: debris in transport, «Дислокация» naming and no cargo,
// full ship names, the reason beside a planet that cannot send.
// Screenshots go to visual-qa/quick-send-cargo/<viewport> (ASTERION_QA_OUTPUT overrides).
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');
const { editSaveIdle } = require('./qa-save-edit.cjs');

app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-gpu');
app.on('window-all-closed', () => {});

const ROOT = path.join(__dirname, '..');
const OUTPUT = process.env.ASTERION_QA_OUTPUT || path.join(ROOT, 'visual-qa', 'quick-send-cargo');
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

const js = (win, source) => win.webContents.executeJavaScript(source).catch((e) => { console.error('JS FAIL:', String(e).slice(0, 300)); throw e; });

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


async function seed(win) {
  return editSaveIdle(win, `(() => {
    const save = JSON.parse(localStorage.getItem(${JSON.stringify(SAVE_KEY)}) || '{}');
    const home = save.planets['helion-01'];
    home.buildings = { ...home.buildings, hangar: Math.max(home.buildings?.hangar ?? 0, 25) };
    home.recycling = { ...home.recycling, availableDebris: 4200 };
    for (const [id, name, system, position] of [['qa-colony-a', 'Ростов', 9, 5], ['qa-colony-b', 'Москва', 4, 9]]) {
      save.planets[id] = { ...JSON.parse(JSON.stringify(home)), name, universeGalaxy: 1, universeSystem: system, universePosition: position };
    }
    for (const id of Object.keys(save.planets)) {
      const planet = save.planets[id];
      planet.fleet = planet.fleet || { ships: {}, commanders: {} };
      planet.fleet.ships = { ...planet.fleet.ships, 'spy-probe': 3, recycler: 1261, transporter: 40, 'mega-transporter': 6, cruiser: 12, scout: 20, colonizer: 0 };
      planet.resources = { metal: 900000, minerals: 700000, gas: 500000 };
    }
    // «Москва» has no gas: it cannot send, and the panel must say why.
    // (The `held` check allows a few units of gas: the reloaded game's first production tick runs before the check.)
    save.planets['qa-colony-b'].resources = { metal: 900000, minerals: 700000, gas: 0 };
    localStorage.setItem(${JSON.stringify(SAVE_KEY)}, JSON.stringify(save));
    return Object.keys(save.planets);
  })()`, { label: 'quick send cargo', held: `JSON.parse(localStorage.getItem(${JSON.stringify(SAVE_KEY)}) || '{}').planets?.['qa-colony-b']?.resources?.gas < 5000` });
}

async function runViewport(width, height) {
  const label = `${width}x${height}`;
  const directory = path.join(OUTPUT, label);
  const win = new BrowserWindow({
    width, height, useContentSize: true, show: false, backgroundColor: '#02050a',
    webPreferences: { offscreen: true, contextIsolation: true, nodeIntegration: false, sandbox: true, partition: `qa-quick-send-cargo-${label}` },
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
    await openUniverse(win);
    await selectSystem(win, 1);

    // Own planet menu: «Дислокация», never «Перебазировать».
    await rightClick(win, '[data-qa-universe-object="player-planet-helion-01"]');
    const menu = await menuSnapshot(win);
    if (!/Дислокация/.test(menu.text) || /Перебаз/i.test(menu.text)) throw new Error(`${label}: menu naming ${menu.text}`);
    await capture(win, directory, 'own-planet-menu');

    // Transport: debris is a fourth cargo row, limited by the planet's debris and the hold.
    await chooseAction(win, label, 'transport');
    const rows = await js(win, `[...document.querySelectorAll('[data-qa-quick-cargo]')].map((row) => row.getAttribute('data-qa-quick-cargo'))`);
    if (JSON.stringify(rows) !== JSON.stringify(['metal', 'minerals', 'gas', 'debris'])) throw new Error(`${label}: cargo rows ${JSON.stringify(rows)}`);
    await js(win, `(() => { const slider = document.querySelector('[data-qa-quick-cargo="debris"] [role="slider"], [data-qa-quick-cargo="debris"] input[type="range"]'); if (slider) slider.focus(); })()`);
    await js(win, `(() => { const el = document.querySelector('[data-qa-quick-cargo="debris"] [role="slider"], [data-qa-quick-cargo="debris"] input[type="range"]'); if (!el) return; el.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true })); })()`);
    await sleep(150);
    await capture(win, directory, 'transport-debris');
    await closeMenu(win);

    // Дислокация: full ship names, no cargo rows, a reason beside the planet that cannot send.
    await rightClick(win, '[data-qa-universe-object="player-planet-helion-01"]');
    await chooseAction(win, label, 'deployment');
    const check = await js(win, `(() => { try {
      const panel = document.querySelector('[data-qa-quick-send="deployment"]');
      const names = [...panel.querySelectorAll('.quick-send__ships b')].map((b) => ({ text: b.textContent, clipped: b.scrollWidth > b.clientWidth + 1 }));
      return { names, cargo: panel.querySelectorAll('[data-qa-quick-cargo]').length, why: [...panel.querySelectorAll('[data-qa-quick-why]')].map((n) => n.textContent) };
    } catch (e) { return { err: String(e) }; } })()`);
    if (check.err) throw new Error(check.err);
    if (check.cargo !== 4) throw new Error(`${label}: «Дислокация» must have 4 cargo rows, has ${check.cargo}`);
    if (check.names.some((name) => name.clipped)) throw new Error(`${label}: clipped ship names ${JSON.stringify(check.names)}`);
    await capture(win, directory, 'dislocation-panel');
    console.log(label, JSON.stringify(check));
    await closeMenu(win);

    // Full fleet screen: «Дислокация» has the cargo editor and its own texts.
    const click = (selector) => js(win, `(() => { const e = document.querySelector(${JSON.stringify(selector)}); if (!e || e.disabled) return false; e.click(); return true; })()`);
    const setValue = (selector, proto, value, type) => js(win, `(() => { const e = document.querySelector(${JSON.stringify(selector)}); Object.getOwnPropertyDescriptor(${proto}.prototype, 'value').set.call(e, ${JSON.stringify(String(value))}); e.dispatchEvent(new Event(${JSON.stringify(type)}, { bubbles: true })); })()`);
    await click('[data-qa-route="fleets"]');
    await waitFor(win, `document.querySelector('[data-qa-fleet-root]')`);
    await click('[data-qa-mission-id="deployment"]');
    await sleep(150);
    await setValue('[data-qa-fleet-ship="transporter"] input[type="number"]', 'HTMLInputElement', 2, 'input');
    await click('[data-qa-flight-preview-open]');
    await waitFor(win, `document.querySelector('[data-qa-deployment-target-select] select')`);
    await setValue('[data-qa-deployment-target-select] select', 'HTMLSelectElement', 'qa-colony-a', 'change');
    await waitFor(win, `document.querySelector('[data-qa-flight-cargo]')`);
    await sleep(300);
    const plan = await js(win, `(() => ({ cargo: document.querySelectorAll('[data-qa-flight-cargo] [data-qa-cargo]').length, text: document.querySelector('.flight-timeline-notes')?.innerText || '' }))()`);
    if (plan.cargo !== 4 || /колонизатор/.test(plan.text)) throw new Error(`${label}: fleet screen deployment ${JSON.stringify(plan)}`);
    await capture(win, directory, 'fleet-screen-dislocation-cargo');
    if (!check.why.length || check.why.some((text) => !text || /undefined/.test(text))) throw new Error(`${label}: reason missing ${JSON.stringify(check.why)}`);
  } finally {
    win.destroy();
  }
}

app.whenReady().then(async () => {
  try {
    if (!skipScreenshots) for (const [width, height] of VIEWPORTS) fs.rmSync(path.join(OUTPUT, `${width}x${height}`), { recursive: true, force: true });
    for (const [width, height] of VIEWPORTS) await runViewport(width, height);
    console.log('Quick send cargo QA passed.');
    app.exit(0);
  } catch (error) {
    console.error(error);
    app.exit(1);
  }
});
