// Icons batch 1: frames of the places that show the header, resource, zone, mission and
// Operations tab icons, at 1280×720 and 2560×1080. Every <img> on each screen must load
// (naturalWidth > 0), so a broken import or a missing WebP fails the run.
// ASTERION_QA_CHECKS=0 records the numbers without failing.
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');
const { waitForCommands } = require('./qa-save-edit.cjs');

app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-gpu');
app.on('window-all-closed', () => {});

const ROOT = path.join(__dirname, '..');
const OUTPUT = process.env.ASTERION_QA_OUTPUT || path.join(ROOT, 'visual-qa', 'icons-batch');
const CHECKS = process.env.ASTERION_QA_CHECKS !== '0';
const VIEWPORTS = [[1280, 720], [2560, 1080]];
const SAVE_KEY = 'asterion.vertical-slice.test.v1';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const run = (win, code) => win.webContents.executeJavaScript(code);

async function waitFor(win, expression, timeoutMs = 30000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await run(win, `Boolean(${expression})`)) return;
    await sleep(80);
  }
  throw new Error(`Timed out waiting for: ${expression}`);
}
async function settle(win, ms = 300) {
  await run(win, 'new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))');
  await sleep(ms);
}
async function capture(win, directory, name) {
  await run(win, `document.getAnimations().forEach((a) => { const t = a.effect?.getComputedTiming?.(); if (t && Number.isFinite(t.endTime)) a.currentTime = t.endTime; })`);
  await settle(win, 200);
  const result = await win.webContents.debugger.sendCommand('Page.captureScreenshot', { format: 'jpeg', quality: 86, fromSurface: true });
  fs.writeFileSync(path.join(directory, `${name}.jpg`), Buffer.from(result.data, 'base64'));
}
/** Visible images that failed to load. */
function brokenImages(win) {
  return run(win, `Promise.all(Array.from(document.images).filter((img) => img.getClientRects().length).map((img) => img.decode().then(() => null, () => img.getAttribute('src'))))
    .then((list) => list.filter(Boolean).concat(Array.from(document.images).filter((img) => img.complete && img.getClientRects().length && img.naturalWidth === 0).map((img) => img.getAttribute('src'))))
    .then((list) => [...new Set(list)])`);
}
async function route(win, id) {
  await run(win, `document.querySelector('[data-qa-navigation="primary"] [data-qa-route="${id}"]')?.click()`);
  await settle(win, 500);
}

app.whenReady().then(async () => {
  let win;
  const failures = [];
  const shots = [];
  try {
    win = new BrowserWindow({ width: 1280, height: 720, show: false, backgroundColor: '#02050a',
      webPreferences: { offscreen: true, contextIsolation: true, nodeIntegration: false, sandbox: true, partition: 'qa-icons-batch' } });
    await win.loadFile(path.join(ROOT, 'dist', 'index.html'), { search: '?mode=test' });
    await waitFor(win, `document.querySelector('[data-qa-navigation="primary"]') && localStorage.getItem(${JSON.stringify(SAVE_KEY)})`);
    await waitForCommands(win);
    await run(win, 'document.fonts?.ready');
    win.webContents.debugger.attach('1.3');
    for (const [width, height] of VIEWPORTS) {
      const size = `${width}x${height}`;
      const directory = path.join(OUTPUT, size);
      fs.mkdirSync(directory, { recursive: true });
      await win.webContents.debugger.sendCommand('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false, screenWidth: width, screenHeight: height });
      await settle(win, 500);
      const step = async (name, action) => {
        try {
          await action();
          const broken = await brokenImages(win);
          if (broken.length) failures.push({ size, name, broken });
          await capture(win, directory, name);
          shots.push(`${size}/${name}`);
        } catch (error) {
          failures.push({ size, name, error: String(error?.message || error) });
        }
      };
      await step('01-header-planet', async () => { await route(win, 'planet'); });
      await step('02-fleets-missions', async () => {
        await route(win, 'fleets');
        await waitFor(win, `document.querySelector('[data-qa-fleet-root]') || document.querySelector('[data-qa-mission-id]')`);
        await run(win, `document.querySelector('[data-qa-fleet-section="root"]')?.click()`);
        await settle(win, 400);
      });
      await step('03-flight-plan-mission', async () => {
        await run(win, `(() => {
          for (const tile of document.querySelectorAll('[data-qa-fleet-ship]')) {
            const button = [...tile.querySelectorAll('button')].find((node) => ['МАКС.', 'Все', 'МАКС'].includes(node.textContent.trim()) && !node.disabled);
            if (button) { button.click(); return true; }
          }
          return false;
        })()`);
        await settle(win, 250);
        await run(win, `document.querySelector('[data-qa-flight-preview-open]')?.click()`);
        await settle(win, 600);
      });
      await run(win, `document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
      await settle(win, 300);
      for (const tab of ['available', 'active']) {
        await step(`04-operations-${tab}`, async () => {
          await route(win, 'operations');
          await run(win, `document.querySelector('[data-qa-operations-tab="${tab}"]')?.click()`);
          await settle(win, 450);
        });
      }
      // «Командование»: help and Sun-raid tiles use the mission icons.
      await step('05-command-missions', async () => { await route(win, 'command'); await settle(win, 400); });
    }
    // «Рейсы и миссии» with 25 seeded missions (Test Mode fixture, nothing saved): mission counts.
    await run(win, `history.replaceState(null, '', '#flights-board-many')`);
    const loaded = new Promise((resolve) => win.webContents.once('did-finish-load', resolve));
    win.webContents.reload();
    await loaded;
    await waitFor(win, `document.querySelector('[data-qa-navigation="primary"]')`);
    await waitForCommands(win);
    for (const [width, height] of VIEWPORTS) {
      const size = `${width}x${height}`;
      await win.webContents.debugger.sendCommand('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false, screenWidth: width, screenHeight: height });
      await settle(win, 400);
      try {
        await route(win, 'fleets');
        await waitFor(win, `document.querySelector('.fleet-workspace-v1 [data-qa-flights-toggle]')`);
        await run(win, `(() => { const t = document.querySelector('[data-qa-flights-toggle]'); if (t && t.getAttribute('aria-expanded') !== 'true') t.click(); })()`);
        await settle(win, 500);
        const broken = await brokenImages(win);
        if (broken.length) failures.push({ size, name: '06-flights-missions', broken });
        await capture(win, path.join(OUTPUT, size), '06-flights-missions');
        shots.push(`${size}/06-flights-missions`);
        await run(win, `document.querySelector('[data-qa-flights-toggle]')?.click()`);
        await settle(win, 200);
      } catch (error) {
        failures.push({ size, name: '06-flights-missions', error: String(error?.message || error) });
      }
    }
    fs.writeFileSync(path.join(OUTPUT, 'metrics.json'), JSON.stringify({ shots, failures }, null, 2));
    console.log(JSON.stringify({ shots, failures }, null, 2));
    win.webContents.debugger.detach();
    win.destroy();
    app.exit(CHECKS && failures.length ? 1 : 0);
  } catch (error) {
    console.error(error);
    win?.destroy();
    app.exit(1);
  }
});
