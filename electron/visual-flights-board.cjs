// «Рейсы и миссии» (concepts v2 section 1, 12.11.2026): worst-case frames at
// 1280×720 and 2560×1080.
// Data comes from the Test Mode route `#flights-board-<scenario>`
// (src/ui/fleet/flights-board-qa-fixture.ts): seeded flights on a frozen clock,
// nothing is written to the save. Scenarios: no flights, one flight, 3 attacks
// and 25 own missions (top and end of the internal scroll), 3 incoming attacks
// with their composition (Espionage 10), long planet and owner names with
// 12-digit numbers, and a fleet of 9 ship types (card closed and opened).
// Layout contracts (ASTERION_QA_CHECKS=0 records them without failing, used for
// the «before» run on main, where the old «Все рейсы» list opens instead):
// no text cut off without an ellipsis, no native title tooltips or selects on
// the board, no horizontal scroll, the bottom card stays on screen, the list
// scrolls inside itself.
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');
const { waitForCommands } = require('./qa-save-edit.cjs');

app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-gpu');
app.on('window-all-closed', () => {});

const ROOT = path.join(__dirname, '..');
const OUTPUT = process.env.ASTERION_QA_OUTPUT || path.join(ROOT, 'visual-qa', 'flights-board', 'run');
const CHECKS = process.env.ASTERION_QA_CHECKS !== '0';
const SHOTS = process.env.ASTERION_SKIP_SCREENSHOTS !== '1';
const SAVE_KEY = 'asterion.vertical-slice.test.v1';
const VIEWPORTS = [[1280, 720], [2560, 1080]];
const BOARD = '[data-qa-flights-board]';
const ROOTS = '[data-qa-flights-drop], .fleet-flights-v2';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// [frame, scenario, step, expectations]
const SHOTS_LIST = [
  ['01-empty', 'empty', null, { rows: 0, empty: true }],
  ['02-one-flight', 'one', null, { rows: 1, hot: 0 }],
  ['03-attacks-3-composition', 'attacks', null, { rows: 3, hot: 3, cardShips: 4 }],
  ['04-attack-second-picked', 'attacks', 'pick-second', { rows: 3, hot: 3, cardShips: 2 }],
  ['05-many-28-top', 'many', null, { rows: 28, hot: 3, scrolls: true, hiddenComposition: true }],
  ['06-many-28-end', 'many', 'end', { rows: 28, hot: 3, scrolls: true }],
  ['07-long-names-12-digits', 'long', null, { rows: 7, hot: 1 }],
  ['08-nine-types-card', 'nine', null, { cardShips: 5, more: '+4' }],
  ['09-nine-types-card-open', 'nine', 'more', { cardShips: 9 }],
];

async function waitFor(win, expression, timeoutMs = 20000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await win.webContents.executeJavaScript(`Boolean(${expression})`)) return;
    await sleep(60);
  }
  throw new Error(`Timed out waiting for: ${expression}`);
}

async function settle(win, ms = 160) {
  await win.webContents.executeJavaScript('new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
  await sleep(ms);
}

async function capture(win, directory, name) {
  if (!SHOTS) return;
  await waitFor(win, `Array.from(document.querySelectorAll('.fleet-workspace-v1 img')).every((img) => img.complete)`, 15000).catch(() => {});
  await win.webContents.executeJavaScript(`document.getAnimations().forEach((animation) => {
    const timing = animation.effect?.getComputedTiming?.();
    if (timing && Number.isFinite(timing.endTime)) animation.currentTime = timing.endTime;
  })`);
  await settle(win, 120);
  const result = await win.webContents.debugger.sendCommand('Page.captureScreenshot', { format: 'jpeg', quality: 82, fromSurface: true, captureBeyondViewport: false });
  fs.writeFileSync(path.join(directory, `${name}.jpg`), Buffer.from(result.data, 'base64'));
}

async function reload(win) {
  const loaded = new Promise((resolve) => win.webContents.once('did-finish-load', resolve));
  win.webContents.reload();
  await loaded;
  await waitFor(win, `document.querySelector('[data-qa-navigation="primary"]')`);
  await waitForCommands(win);
  await win.webContents.executeJavaScript('document.fonts?.ready');
  await settle(win);
}

async function scenario(win, name) {
  await win.webContents.executeJavaScript(`history.replaceState(null, '', ${JSON.stringify(`#flights-board-${name}`)})`);
  await reload(win);
  await win.webContents.executeJavaScript(`document.querySelector('[data-qa-navigation="primary"] [data-qa-route="fleets"]')?.click()`);
  await waitFor(win, `document.querySelector('.fleet-workspace-v1 [data-qa-flights-toggle]')`);
  await settle(win, 300);
  await win.webContents.executeJavaScript(`(() => {
    const toggle = document.querySelector('[data-qa-flights-toggle]');
    if (toggle && toggle.getAttribute('aria-expanded') !== 'true') toggle.click();
  })()`);
  await waitFor(win, `document.querySelector('[data-qa-flights-toggle]')?.getAttribute('aria-expanded') === 'true'`);
  await settle(win, 420);
}

async function step(win, name) {
  if (name === 'end') {
    await win.webContents.executeJavaScript(`(() => { const list = document.querySelector('[data-qa-flights-list]'); if (list) list.scrollTop = list.scrollHeight; })()`);
  } else if (name === 'pick-second') {
    await win.webContents.executeJavaScript(`document.querySelectorAll('[data-qa-flight-row].is-hot [data-qa-flight-ships-open]')[1]?.click()`);
  } else if (name === 'more') {
    await win.webContents.executeJavaScript(`document.querySelector('[data-qa-flight-card-more]')?.click()`);
  }
  await settle(win, 260);
}

/** Text that is cut off (an ellipsis is allowed); the screen-reader copy is not on screen by design. */
function clippedText(win) {
  return win.webContents.executeJavaScript(`(() => {
    const out = [];
    document.querySelectorAll(${JSON.stringify(ROOTS)}).forEach((root) => root.querySelectorAll('strong, small, em, b, span, h1, h2, h3, h4, p, button, label, i').forEach((node) => {
      if (node.closest('.fl-sr') || !node.getClientRects().length || !node.textContent.trim() || node.children.length) return;
      const style = getComputedStyle(node);
      const cutX = node.scrollWidth > node.clientWidth + 1 && style.overflow !== 'visible';
      const cutY = node.scrollHeight > node.clientHeight + 2 && style.overflowY !== 'visible' && style.overflowY !== 'auto';
      if ((cutX && style.textOverflow !== 'ellipsis') || cutY) out.push(node.textContent.trim().slice(0, 60));
      // Text wider than its own row cell spills over the next column.
      const cell = node.closest('.fl-row > *');
      if (cell) {
        const box = node.getBoundingClientRect();
        const outer = cell.getBoundingClientRect();
        if (box.right > outer.right + 2 || box.left < outer.left - 2) out.push('spills: ' + node.textContent.trim().slice(0, 60));
      }
    }));
    return out;
  })()`);
}

async function layout(win) {
  return win.webContents.executeJavaScript(`(() => {
    const board = document.querySelector(${JSON.stringify(BOARD)});
    const list = document.querySelector('[data-qa-flights-list]');
    const card = document.querySelector('[data-qa-flight-card]');
    const rect = (node) => node ? node.getBoundingClientRect() : null;
    const inside = (box) => !box || (box.top >= -1 && box.left >= -1 && box.bottom <= innerHeight + 1 && box.right <= innerWidth + 1);
    const more = document.querySelector('[data-qa-flight-card-more]');
    return {
      board: Boolean(board),
      rows: document.querySelectorAll('[data-qa-flight-row]').length,
      hot: document.querySelectorAll('[data-qa-flight-row].is-hot').length,
      empty: Boolean(document.querySelector('[data-qa-flight-empty]')),
      cardShips: document.querySelectorAll('[data-qa-flight-card-ship]').length,
      cardHidden: Boolean(card?.querySelector('.fl-focus__hidden')),
      hiddenComposition: document.querySelectorAll('[data-qa-flight-row] [data-qa-incoming-composition-hidden]').length,
      more: more ? more.textContent.trim() : null,
      cardFits: inside(rect(card)),
      boardFits: inside(rect(board)),
      listScrolls: list ? list.scrollHeight > list.clientHeight + 4 : false,
      horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 2,
      nativeTitles: Array.from(document.querySelectorAll('${BOARD} [title], .fleet-flights-v2 [title]')).map((node) => node.getAttribute('title').slice(0, 60)),
      nativeSelects: document.querySelectorAll('${BOARD} select').length,
    };
  })()`);
}

async function runViewport(win, directory, label) {
  const metrics = { failures: [], shots: {} };
  const fail = (message, detail) => {
    metrics.failures.push(`${message}: ${JSON.stringify(detail)}`);
    if (CHECKS) throw new Error(`${label} ${message}: ${JSON.stringify(detail)}`);
  };
  let previous = null;
  for (const [name, fixture, where, expect] of SHOTS_LIST) {
    if (fixture !== previous || where === null) await scenario(win, fixture);
    previous = fixture;
    if (where) await step(win, where);
    const clipped = await clippedText(win);
    const box = await layout(win);
    metrics.shots[name] = { clipped, ...box };
    if (box.board) {
      if (clipped.length) fail(`${name}: text is cut off`, clipped);
      if (box.horizontalOverflow || !box.boardFits) fail(`${name}: board does not fit the window`, box);
      if (!box.cardFits) fail(`${name}: the bottom card leaves the window`, box);
      if (box.nativeTitles.length) fail(`${name}: native title tooltips`, box.nativeTitles);
      if (box.nativeSelects) fail(`${name}: native selects`, box.nativeSelects);
      if (expect.rows !== undefined && box.rows !== expect.rows) fail(`${name}: expected ${expect.rows} rows`, box);
      if (expect.hot !== undefined && box.hot !== expect.hot) fail(`${name}: expected ${expect.hot} attack rows on top`, box);
      if (expect.empty && !box.empty) fail(`${name}: empty state missing`, box);
      if (expect.cardShips !== undefined && box.cardShips !== expect.cardShips) fail(`${name}: expected ${expect.cardShips} ship cards`, box);
      if (expect.more !== undefined && box.more !== expect.more) fail(`${name}: expected «${expect.more}»`, box);
      if (expect.scrolls && !box.listScrolls) fail(`${name}: the long list must scroll inside`, box);
      if (expect.hiddenComposition && (box.hiddenComposition !== 3 || !box.cardHidden)) fail(`${name}: attacks below Espionage 10 must hide the composition`, box);
    } else if (CHECKS) {
      fail(`${name}: «Рейсы и миссии» board missing`, box);
    }
    await capture(win, directory, name);
  }
  return metrics;
}

app.whenReady().then(async () => {
  let win;
  try {
    fs.mkdirSync(OUTPUT, { recursive: true });
    win = new BrowserWindow({
      width: 1280,
      height: 720,
      show: false,
      backgroundColor: '#02050a',
      webPreferences: { offscreen: true, contextIsolation: true, nodeIntegration: false, sandbox: true, partition: 'qa-flights-board' },
    });
    await win.loadFile(path.join(ROOT, 'dist', 'index.html'), { search: '?mode=test' });
    await waitFor(win, `document.querySelector('[data-qa-navigation="primary"]') && localStorage.getItem(${JSON.stringify(SAVE_KEY)})`, 30000);
    win.webContents.debugger.attach('1.3');
    const all = {};
    for (const [width, height] of VIEWPORTS) {
      const label = `${width}x${height}`;
      const directory = path.join(OUTPUT, label);
      fs.mkdirSync(directory, { recursive: true });
      await win.webContents.debugger.sendCommand('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false, screenWidth: width, screenHeight: height });
      await settle(win);
      all[label] = await runViewport(win, directory, label);
    }
    fs.writeFileSync(path.join(OUTPUT, 'flights-board-metrics.json'), JSON.stringify(all, null, 2));
    console.log(JSON.stringify(all, null, 2));
    win.webContents.debugger.detach();
    win.destroy();
    app.exit(0);
  } catch (error) {
    console.error(error);
    try { if (win?.webContents.debugger.isAttached()) win.webContents.debugger.detach(); } catch {}
    win?.destroy();
    app.exit(1);
  }
});
