// TEMPORARY (branch only, removed before merge): screenshots of the new
// «Звёздный атлас» and right-click circles, normal and worst cases.
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-gpu');
app.on('window-all-closed', () => {});

const ROOT = path.join(__dirname, '..');
const OUTPUT = path.join(ROOT, 'artifacts', 'atlas-shots');
const SAVE_KEY = 'asterion.vertical-slice.test.v1';
const NOW = Date.UTC(2026, 0, 1, 2, 0, 0);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function js(win, code) { return win.webContents.executeJavaScript(code); }
async function waitFor(win, expression, timeoutMs = 10_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await js(win, `Boolean(${expression})`)) return;
    await sleep(60);
  }
  throw new Error(`Timed out waiting for: ${expression}`);
}
async function point(win, selector) {
  return js(win, `(() => { const e = document.querySelector(${JSON.stringify(selector)}); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
}
async function mouse(win, selector, button = 'left') {
  const p = await point(win, selector);
  if (!p) throw new Error(`missing ${selector}`);
  await win.webContents.debugger.sendCommand('Input.dispatchMouseEvent', { type: 'mouseMoved', x: p.x, y: p.y });
  await win.webContents.debugger.sendCommand('Input.dispatchMouseEvent', { type: 'mousePressed', x: p.x, y: p.y, button, clickCount: 1 });
  await win.webContents.debugger.sendCommand('Input.dispatchMouseEvent', { type: 'mouseReleased', x: p.x, y: p.y, button, clickCount: 1 });
  await sleep(150);
}
async function hover(win, selector) {
  const p = await point(win, selector);
  if (!p) return;
  await win.webContents.debugger.sendCommand('Input.dispatchMouseEvent', { type: 'mouseMoved', x: p.x, y: p.y });
  await sleep(300);
}
async function escape(win) {
  await win.webContents.debugger.sendCommand('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await win.webContents.debugger.sendCommand('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await sleep(250);
}
async function shot(win, dir, name) {
  await sleep(900);
  const result = await win.webContents.debugger.sendCommand('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: false });
  fs.writeFileSync(path.join(dir, `${name}.png`), Buffer.from(result.data, 'base64'));
  console.log(`[atlas-shots] ${path.basename(dir)}/${name}`);
}
async function selectSystem(win, system) {
  await js(win, `(() => { const e = document.querySelector('.universe-jump select'); const s = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set; s.call(e, ${JSON.stringify(String(system))}); e.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  await waitFor(win, `document.querySelector('[data-qa-universe]')?.getAttribute('data-qa-universe-system') === ${JSON.stringify(String(system))}`);
  await sleep(120);
}
async function findObject(win, selector) {
  for (let system = 1; system <= 40; system += 1) {
    await selectSystem(win, system);
    if (await js(win, `Boolean(document.querySelector(${JSON.stringify(selector)}))`)) return system;
  }
  return 0;
}
async function openAtlas(win, selector) {
  await mouse(win, selector);
  await waitFor(win, `document.querySelector('[data-qa-universe-inspector]')`);
  await sleep(1400);
}
async function closeAtlas(win) {
  await mouse(win, '.star-atlas__close');
  await waitFor(win, `!document.querySelector('[data-qa-universe-inspector]')`);
}
async function report(win, dir, name) {
  const facts = await js(win, `(() => {
    const over = [...document.querySelectorAll('.star-atlas *, .quick-pop *')].filter((e) => e.scrollWidth > e.clientWidth + 1 && getComputedStyle(e).overflow === 'visible' && e.children.length === 0).map((e) => e.className + ':' + e.textContent.slice(0, 30));
    const root = document.querySelector('.star-atlas, .quick-pop');
    const r = root?.getBoundingClientRect();
    return { over, inside: r ? r.left >= 0 && r.top >= 0 && r.right <= innerWidth + 1 && r.bottom <= innerHeight + 1 : null, docOverflow: document.documentElement.scrollWidth > innerWidth };
  })()`);
  fs.writeFileSync(path.join(dir, `${name}.json`), JSON.stringify(facts, null, 2));
}

async function run(width, height) {
  const label = `${width}x${height}`;
  const dir = path.join(OUTPUT, label);
  fs.mkdirSync(dir, { recursive: true });
  const win = new BrowserWindow({ width: 1000, height: 700, useContentSize: true, show: false, backgroundColor: '#02050a',
    webPreferences: { offscreen: true, contextIsolation: true, sandbox: true, partition: `atlas-${label}` } });
  await win.loadURL('about:blank');
  win.webContents.debugger.attach('1.3');
  await win.webContents.debugger.sendCommand('Page.enable');
  await win.webContents.debugger.sendCommand('Page.addScriptToEvaluateOnNewDocument', { source: `Date.now = () => ${NOW};` });
  await win.webContents.debugger.sendCommand('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false, screenWidth: width, screenHeight: height });
  const loaded = new Promise((resolve) => win.webContents.once('did-finish-load', resolve));
  await win.loadFile(path.join(ROOT, 'dist', 'index.html'), { search: '?mode=test' });
  await loaded;
  await waitFor(win, `document.querySelector('[data-qa-navigation="utility"]')`);
  await waitFor(win, `localStorage.getItem(${JSON.stringify(SAVE_KEY)})`);
  await js(win, `document.querySelector('[data-qa-route="universe"]').click()`);
  await waitFor(win, `document.querySelector('[data-qa-universe]')`);
  await sleep(400);

  // 1. Own planet: spy and attack grey with reasons.
  await selectSystem(win, 1);
  await openAtlas(win, '[data-qa-universe-object="player-planet-helion-01"]');
  await shot(win, dir, '01-atlas-own');
  await hover(win, '[data-qa-universe-action="spy"]');
  await shot(win, dir, '02-atlas-own-hint');
  await report(win, dir, '01-atlas-own');
  await closeAtlas(win);

  // 2. Ally.
  const ally = '[data-qa-universe-object="test-mode-ally-ira-vel-v1"]';
  if (await findObject(win, ally)) {
    await openAtlas(win, ally);
    await shot(win, dir, '03-atlas-ally');
    await closeAtlas(win);
  }

  // 3. Neutral bot with 7 planets.
  const npc = '[data-qa-universe-kind="npc"][data-qa-universe-relation="neutral"]';
  const npcSystem = await findObject(win, npc);
  if (npcSystem) {
    await openAtlas(win, npc);
    await shot(win, dir, '04-atlas-bot-7-planets');
    await report(win, dir, '04-atlas-bot-7-planets');
    // Worst case: long names, huge numbers, debris everywhere, no alliance.
    await js(win, `(() => {
      document.querySelector('[data-qa-universe-owner-name]').textContent = 'Верховный Архонт Звёздного Предела Максимилиан';
      document.querySelector('.star-atlas__head h2 span').textContent = 'Новая Константинопольская Обсерватория-12';
      document.querySelectorAll('.star-atlas__point dd').forEach((e) => { e.textContent = '987 654 321 012'; });
      document.querySelectorAll('.star-atlas__row-planet strong').forEach((e, i) => { e.textContent = i % 2 ? 'Ы' : 'Длинное-Название-Планеты-Без-Пробелов-Номер-' + i; });
      document.querySelectorAll('.star-atlas__row-planet > span').forEach((e) => { if (!e.querySelector('em')) { const em = document.createElement('em'); em.textContent = 'обломки 1 234 567 890'; e.append(em); } });
      const alliance = document.querySelector('.star-atlas__alliance b'); if (alliance) alliance.textContent = 'Объединённая Конфедерация Свободных Миров Внешнего Кольца';
      document.querySelectorAll('.star-atlas__time').forEach((e) => { e.textContent = '123:59:59'; });
    })()`);
    await shot(win, dir, '05-atlas-worst-case');
    await report(win, dir, '05-atlas-worst-case');
    await closeAtlas(win);

    // 4. Right click on the bot planet.
    await selectSystem(win, npcSystem);
    await mouse(win, npc, 'right');
    await waitFor(win, `document.querySelector('[data-qa-quick-menu]')`);
    await shot(win, dir, '06-right-click-bot');
    await report(win, dir, '06-right-click-bot');
    await js(win, `(() => { const b = document.querySelector('.quick-pop__head b span'); if (b) b.textContent = 'Новая Константинопольская Обсерватория-12'; })()`);
    await shot(win, dir, '07-right-click-long-name');
    await escape(win);
  }

  // 5. Right click on own planet, on an empty position and on the rightmost object.
  await selectSystem(win, 1);
  await mouse(win, '[data-qa-universe-object="player-planet-helion-01"]', 'right');
  await waitFor(win, `document.querySelector('[data-qa-quick-menu]')`);
  await shot(win, dir, '08-right-click-own');
  await escape(win);
  if (await js(win, `Boolean(document.querySelector('[data-qa-universe-kind="empty"]'))`)) {
    await mouse(win, '[data-qa-universe-kind="empty"]', 'right');
    await shot(win, dir, '09-right-click-empty');
    await escape(win);
  }
  const rightmost = await js(win, `(() => { const all = [...document.querySelectorAll('[data-qa-universe-object]')]; all.sort((a, b) => b.getBoundingClientRect().right - a.getBoundingClientRect().right); const e = all[0]; return e ? e.getAttribute('data-qa-universe-object') : null; })()`);
  if (rightmost) {
    await mouse(win, `[data-qa-universe-object="${rightmost}"]`, 'right');
    await shot(win, dir, '10-right-click-right-edge');
    await report(win, dir, '10-right-click-right-edge');
    await escape(win);
  }
  const pirate = '[data-qa-universe-kind="pirate"]';
  if (await findObject(win, pirate)) {
    await mouse(win, pirate, 'right');
    await shot(win, dir, '11-right-click-pirates');
    await escape(win);
  }
  win.destroy();
}

app.whenReady().then(async () => {
  try {
    for (const [w, h] of [[1920, 1080], [1280, 720]]) await run(w, h);
    app.quit();
  } catch (error) {
    process.stderr.write(`${error.stack || error}\n`);
    app.exit(1);
  }
});
