// «Флоты»: the ship picture of a mission card (.fc-ship__art) is centred between the title row
// and the amount row and never clipped by the card. Screenshots at 1280×720 and 2560×1080 on
// every mission tab, "before" (the old right-anchored rule put back by a style tag) and "after".
// ASTERION_QA_CHECKS=0 records the numbers without failing.
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');
const { waitForCommands } = require('./qa-save-edit.cjs');

app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-gpu');
app.on('window-all-closed', () => {});

const ROOT = path.join(__dirname, '..');
const OUTPUT = process.env.ASTERION_QA_OUTPUT || path.join(ROOT, 'visual-qa', 'fleet-ship-cards');
const CHECKS = process.env.ASTERION_QA_CHECKS !== '0';
const SHOTS = process.env.ASTERION_SKIP_SCREENSHOTS !== '1';
const VIEWPORTS = [[1280, 720], [2560, 1080]];
const SAVE_KEY = 'asterion.vertical-slice.test.v1';
const OLD_CSS = '.fleet-workspace-v1 .fleet-root-v2 .fc-ship__art{left:auto !important;right:-6px !important;top:34px !important;bottom:auto !important;width:176px !important;height:146px !important;max-width:62% !important}';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(win, expression, timeoutMs = 30000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await win.webContents.executeJavaScript(`Boolean(${expression})`)) return;
    await sleep(80);
  }
  throw new Error(`Timed out waiting for: ${expression}`);
}
const run = (win, code) => win.webContents.executeJavaScript(code);
async function settle(win, ms = 300) {
  await run(win, 'new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))');
  await sleep(ms);
}
async function capture(win, directory, name) {
  if (!SHOTS) return;
  await run(win, `document.getAnimations().forEach((a) => { const t = a.effect?.getComputedTiming?.(); if (t && Number.isFinite(t.endTime)) a.currentTime = t.endTime; })`);
  await settle(win, 150);
  const result = await win.webContents.debugger.sendCommand('Page.captureScreenshot', { format: 'jpeg', quality: 82, fromSurface: true });
  fs.writeFileSync(path.join(directory, `${name}.jpg`), Buffer.from(result.data, 'base64'));
}

/** Art box against the card: centred within 3px, inside the card, clear of the title and amount rows. */
function measure(win) {
  return run(win, `(() => Array.from(document.querySelectorAll('.fleet-root-v2 .fc-ship')).map((card) => {
    const c = card.getBoundingClientRect();
    const art = card.querySelector('.fc-ship__art')?.getBoundingClientRect();
    const img = card.querySelector('.fc-ship__art img')?.getBoundingClientRect();
    const amount = card.querySelector('.fc-ship__amount')?.getBoundingClientRect();
    if (!art || !img || !amount) return { name: card.querySelector('h3')?.textContent, missing: true };
    return {
      name: card.querySelector('h3')?.textContent,
      offCentre: Math.round(Math.abs((img.left + img.right) / 2 - (c.left + c.right) / 2)),
      clippedX: Math.round(Math.max(0, c.left - img.left, img.right - c.right)),
      overAmount: Math.round(Math.max(0, img.bottom - amount.top)),
    };
  }))()`);
}

app.whenReady().then(async () => {
  let win;
  const failures = [];
  const report = {};
  try {
    win = new BrowserWindow({ width: 1280, height: 720, show: false, backgroundColor: '#02050a',
      webPreferences: { offscreen: true, contextIsolation: true, nodeIntegration: false, sandbox: true, partition: 'qa-fleet-ship-cards' } });
    await win.loadFile(path.join(ROOT, 'dist', 'index.html'), { search: '?mode=test' });
    await waitFor(win, `document.querySelector('[data-qa-navigation="primary"]') && localStorage.getItem(${JSON.stringify(SAVE_KEY)})`);
    await waitForCommands(win);
    win.webContents.debugger.attach('1.3');
    for (const [width, height] of VIEWPORTS) {
      await win.webContents.debugger.sendCommand('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false, screenWidth: width, screenHeight: height });
      await settle(win);
      await run(win, `document.querySelector('[data-qa-route="fleets"]').click()`);
      await waitFor(win, `document.querySelector('[data-qa-fleet-root]')`);
      const missions = await run(win, `Array.from(document.querySelectorAll('[data-qa-mission-id]')).map((n) => n.getAttribute('data-qa-mission-id'))`);
      for (const variant of ['before', 'after']) {
        const directory = path.join(OUTPUT, variant, `${width}x${height}`);
        fs.mkdirSync(directory, { recursive: true });
        await run(win, `(() => { document.getElementById('qa-old-ship-art')?.remove(); if (${variant === 'before'}) { const s = document.createElement('style'); s.id = 'qa-old-ship-art'; s.textContent = ${JSON.stringify(OLD_CSS)}; document.head.append(s); } })()`);
        for (const mission of missions) {
          await run(win, `document.querySelector('[data-qa-mission-id="${mission}"]')?.click()`);
          await settle(win, 450);
          const cards = await measure(win);
          report[`${width}x${height}:${variant}:${mission}`] = cards;
          if (variant === 'after') for (const card of cards) {
            if (card.missing) continue;
            if (card.offCentre > 3 || card.clippedX > 0 || card.overAmount > 0) failures.push({ viewport: `${width}x${height}`, mission, card });
          }
          if (cards.length) await capture(win, directory, mission);
        }
      }
    }
    fs.writeFileSync(path.join(OUTPUT, 'metrics.json'), JSON.stringify({ report, failures }, null, 2));
    console.log(JSON.stringify({ cards: Object.fromEntries(Object.entries(report).map(([k, v]) => [k, v.length])), failures }, null, 2));
    win.webContents.debugger.detach();
    win.destroy();
    app.exit(CHECKS && failures.length ? 1 : 0);
  } catch (error) {
    console.error(error);
    win?.destroy();
    app.exit(1);
  }
});
