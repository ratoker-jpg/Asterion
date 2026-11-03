// QA: «Атаковать» on an occupied unique object / anomaly (owner playtest 1.8.7).
// Real UI path in test mode: Operations -> Bot 01 occupies a contact (a real
// flight, resolved on arrival) -> Universe: the object dialog offers
// «АТАКОВАТЬ» -> the Fleets screen opens with the ordinary «Атака» mission.
//   npm run build && electron electron/unique-object-attack-qa.cjs
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-gpu');
app.on('window-all-closed', () => {});

const ROOT = path.join(__dirname, '..');
const OUTPUT = process.env.ASTERION_QA_OUTPUT || path.join(ROOT, 'visual-qa', 'unique-object-attack');
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

async function main() {
  fs.mkdirSync(OUTPUT, { recursive: true });
  const [width, height] = [1600, 900];
  const win = new BrowserWindow({ width: 1000, height: 700, useContentSize: true, show: false, backgroundColor: '#02050a',
    webPreferences: { offscreen: true, contextIsolation: true, sandbox: true, partition: `qa-unique-attack-${Date.now()}` } });
  win.webContents.on('console-message', (event) => { if (/error/i.test(event.message || '')) console.warn('renderer:', event.message); });
  await win.loadURL('about:blank');
  win.webContents.debugger.attach('1.3');
  await win.webContents.debugger.sendCommand('Page.enable');
  await win.webContents.debugger.sendCommand('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false, screenWidth: width, screenHeight: height });
  const loaded = new Promise((resolve) => win.webContents.once('did-finish-load', resolve));
  await win.loadFile(path.join(ROOT, 'dist', 'index.html'), { search: '?mode=test' });
  await loaded;
  await waitFor(win, `document.querySelector('[data-qa-navigation="utility"]')`);
  await sleep(2500);

  // 1. Operations: take a free exploration contact and let Bot 01 occupy it.
  await click(win, '[data-qa-route="operations"]');
  await sleep(800);
  const picked = await ev(win, `(() => { const card = Array.from(document.querySelectorAll('button')).find((b) => /^УНИКАЛЬНЫЙ ОБЪЕКТ/.test(b.textContent.trim()) || /^АНОМАЛИЯ/.test(b.textContent.trim())); if (!card) return false; card.click(); return true; })()`);
  if (!picked) throw new Error('no unique object / anomaly card in Operations (none in radius)');
  await sleep(500);
  await waitFor(win, `document.querySelector('[data-qa-bot01-exploration]')`, 15_000, 'Bot 01 occupy button').catch(async () => {
    const buttons = await ev(win, `Array.from(document.querySelectorAll('button')).map((b) => b.textContent.trim().slice(0, 40)).slice(0, 40)`);
    throw new Error('no exploration dossier in Operations; buttons: ' + JSON.stringify(buttons));
  });
  const objectId = await ev(win, `document.querySelector('[data-qa-bot01-exploration]')?.getAttribute('data-qa-bot01-exploration')`);
  console.log('target', objectId);
  await click(win, `[data-qa-bot01-exploration="${objectId}"]`);

  // 2. Universe: wait until the real Bot 01 flight lands and the object reads «occupied».
  await click(win, '[data-qa-route="universe"]');
  await waitFor(win, `document.querySelector('[data-qa-universe]')`);
  const system = objectId.split(':')[2];
  await ev(win, `(() => { const el = document.querySelector('.universe-jump select');
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(el, ${JSON.stringify(system)});
    el.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  await waitFor(win, `document.querySelector('[data-qa-universe]')?.getAttribute('data-qa-universe-system') === ${JSON.stringify(String(Number(system)))}`);
  await waitFor(win, `document.querySelector('[data-qa-universe-object="${objectId}"]')`, 20_000, 'object marker');
  await waitFor(win, `document.querySelector('[data-qa-universe-object="${objectId}"] [data-qa-universe-map-occupancy="occupied"]')`, 240_000, 'occupied marker');
  await shot(win, '1-system-view-occupied-object');

  // 3. The dialog of the occupied object has the attack action.
  await click(win, `[data-qa-universe-object="${objectId}"]`);
  await waitFor(win, `document.querySelector('[data-qa-universe-inspector]')`);
  const dialog = await ev(win, `(() => ({
    status: document.querySelector('[data-qa-universe-special-status]')?.textContent,
    actions: Array.from(document.querySelectorAll('[data-qa-universe-special-action]')).map((b) => ({ action: b.getAttribute('data-qa-universe-special-action'), text: b.textContent.trim(), disabled: b.disabled })),
  }))()`);
  console.log(JSON.stringify(dialog));
  const attack = dialog.actions.find((a) => a.action === 'exploration-attack');
  if (!attack || attack.disabled || attack.text !== 'АТАКОВАТЬ') throw new Error('АТАКОВАТЬ missing/disabled: ' + JSON.stringify(dialog));
  if (dialog.actions.find((a) => a.action === 'expedition' && !a.disabled)) throw new Error('expedition must stay disabled on an occupied object');
  await shot(win, '2-unique-object-dialog-attack-button');

  // 4. Click it: the Fleets screen opens with the ordinary attack mission and the object as target.
  await click(win, '[data-qa-universe-special-action="exploration-attack"]');
  await sleep(1500);
  const fleets = await ev(win, `({ inspectorOpen: Boolean(document.querySelector('[data-qa-universe-inspector]')), text: document.body.innerText.slice(0, 4000) })`);
  if (fleets.inspectorOpen) throw new Error('inspector still open after attack click');
  if (!/Атак/.test(fleets.text)) throw new Error('Fleet screen did not show the attack mission: ' + fleets.text.slice(0, 600));
  await shot(win, '3-fleets-attack-mission-prefilled');
  fs.writeFileSync(path.join(OUTPUT, 'result.json'), JSON.stringify({ objectId, dialog, fleetsExcerpt: fleets.text.slice(0, 1500) }, null, 2));
  console.log('QA OK');
}

app.whenReady().then(main).then(() => app.exit(0)).catch((error) => { console.error('QA FAILED:', error.message); app.exit(1); });
