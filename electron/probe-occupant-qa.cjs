// QA: a spy probe sent to an OCCUPIED unique object reveals the occupant (planet-espionage tiers).
// Real UI path in test mode: Bot 01 occupies a contact -> «ИССЛЕДОВАТЬ» sends a real probe ->
// on arrival the «Исследование объекта» report carries the «КТО ЗАНИМАЕТ» block.
//   npm run build && ASTERION_QA_SPY_LEVEL=0 electron electron/probe-occupant-qa.cjs
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-gpu');
app.on('window-all-closed', () => {});

const ROOT = path.join(__dirname, '..');
const OUTPUT = process.env.ASTERION_QA_OUTPUT || path.join(ROOT, 'visual-qa', 'probe-occupant');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const ev = (win, code) => win.webContents.executeJavaScript(code);

async function waitFor(win, expression, timeoutMs = 20_000, label = expression) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await ev(win, `Boolean(${expression})`)) return;
    await sleep(80);
  }
  throw new Error(`Timed out waiting for: ${label}`);
}
async function click(win, selector) {
  await waitFor(win, `document.querySelector(${JSON.stringify(selector)})`, 20_000, selector);
  const ok = await ev(win, `(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el || el.disabled) return false; el.click(); return true; })()`);
  if (!ok) throw new Error(`Could not click ${selector}`);
  await sleep(250);
}
async function shot(win, name) {
  await sleep(300);
  const result = await win.webContents.debugger.sendCommand('Page.captureScreenshot', { format: 'png', fromSurface: true });
  fs.writeFileSync(path.join(OUTPUT, `${name}.png`), Buffer.from(result.data, 'base64'));
  console.log('screenshot', name);
}

const LEVEL = Number(process.env.ASTERION_QA_SPY_LEVEL ?? 0);
const TAG = process.env.ASTERION_QA_TAG || `spy-${LEVEL}`;

async function main() {
  fs.mkdirSync(OUTPUT, { recursive: true });
  const [width, height] = [1600, 900];
  const win = new BrowserWindow({ width: 1000, height: 700, useContentSize: true, show: false, backgroundColor: '#02050a',
    webPreferences: { offscreen: true, contextIsolation: true, sandbox: true, partition: `qa-probe-occupant-${Date.now()}` } });
  win.webContents.on('console-message', (event) => { if (/error/i.test(event.message || '')) console.warn('renderer:', event.message); });
  await win.loadURL('about:blank');
  win.webContents.debugger.attach('1.3');
  await win.webContents.debugger.sendCommand('Page.enable');
  await win.webContents.debugger.sendCommand('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false, screenWidth: width, screenHeight: height });
  const load = async () => {
    const loaded = new Promise((resolve) => win.webContents.once('did-finish-load', resolve));
    await win.loadFile(path.join(ROOT, 'dist', 'index.html'), { search: '?mode=test' });
    await loaded;
    await waitFor(win, `document.querySelector('[data-qa-navigation="utility"]')`);
    await sleep(2500);
  };
  await load();
  // Give the player the espionage level under test, then reload so the runtime reads it.
  await ev(win, `(() => { const K = 'asterion.vertical-slice.test.v1'; const s = JSON.parse(localStorage.getItem(K));
    s.science.levels[5] = ${LEVEL}; const p = s.planets['helion-01']; p.fleet.ships['spy-probe'] = Math.max(5, p.fleet.ships['spy-probe'] || 0);
    localStorage.setItem(K, JSON.stringify(s)); })()`);
  await load();

  await click(win, '[data-qa-route="operations"]');
  await sleep(800);
  const picked = await ev(win, `(() => { const card = Array.from(document.querySelectorAll('button')).find((b) => /^УНИКАЛЬНЫЙ ОБЪЕКТ/.test(b.textContent.trim()) || /^АНОМАЛИЯ/.test(b.textContent.trim())); if (!card) return false; card.click(); return true; })()`);
  if (!picked) throw new Error('no unique object / anomaly card in Operations');
  await sleep(500);
  await waitFor(win, `document.querySelector('[data-qa-bot01-exploration]')`, 15_000, 'Bot 01 occupy button');
  const objectId = await ev(win, `document.querySelector('[data-qa-bot01-exploration]')?.getAttribute('data-qa-bot01-exploration')`);
  await click(win, `[data-qa-bot01-exploration="${objectId}"]`);

  await click(win, '[data-qa-route="universe"]');
  await waitFor(win, `document.querySelector('[data-qa-universe]')`);
  const system = objectId.split(':')[2];
  await ev(win, `(() => { const el = document.querySelector('.universe-jump select');
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(el, ${JSON.stringify(system)});
    el.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  await waitFor(win, `document.querySelector('[data-qa-universe-object="${objectId}"] [data-qa-universe-map-occupancy="occupied"]')`, 240_000, 'occupied marker');
  await click(win, `[data-qa-universe-object="${objectId}"]`);
  await waitFor(win, `document.querySelector('[data-qa-universe-special-action="exploration-recon"]')`);
  await click(win, '[data-qa-universe-special-action="exploration-recon"]');
  await sleep(1200);
  // Fleet screen may need a confirm; the recon command is one probe, dispatched directly.
  await waitFor(win, `document.querySelector('[data-qa-navigation] [data-qa-route="reports"] .asterion-header__nav-badge')`, 240_000, 'new report badge').catch(() => {});
  await click(win, '[data-qa-navigation] [data-qa-route="reports"]');
  await sleep(500);
  await ev(win, `document.querySelector('[data-message-folder="battle"]')?.click()`);
  await sleep(500);
  await waitFor(win, `document.querySelector('[data-report-item-id^="exploration-recon:"]')`, 240_000, 'recon report').catch(async (error) => {
    const dump = await ev(win, `({ items: Array.from(document.querySelectorAll('[data-report-item-id]')).map((e) => e.getAttribute('data-report-item-id')), text: document.body.innerText.slice(0, 600) })`);
    throw new Error(error.message + ' ' + JSON.stringify(dump));
  });
  await ev(win, `document.querySelector('[data-report-item-id^="exploration-recon:"] button, [data-report-item-id^="exploration-recon:"]').click()`);
  await waitFor(win, `document.querySelector('[data-qa-occupant-report]')`, 15_000, 'occupant block');
  const info = await ev(win, `(() => { const b = document.querySelector('[data-qa-occupant-report]'); return { quality: b.dataset.quality, text: b.innerText, fleetHidden: Boolean(b.querySelector('[data-qa-occupant-fleet-hidden]')), ships: b.querySelectorAll('.spy-report-entity').length }; })()`);
  console.log(JSON.stringify(info));
  await ev(win, `document.querySelector('[data-qa-occupant-report]').scrollIntoView({ block: 'center' })`);
  await shot(win, `report-occupant-${TAG}`);
  fs.writeFileSync(path.join(OUTPUT, `result-${TAG}.json`), JSON.stringify({ objectId, info }, null, 2));
  console.log('QA OK');
}

app.whenReady().then(main).then(() => app.exit(0)).catch((error) => { console.error('QA FAILED:', error.message); app.exit(1); });
