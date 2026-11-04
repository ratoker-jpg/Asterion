// A player command landing in the short gap between a clock tick's commit and
// that tick's passive effect must survive.
//
// The window: React commits the second's `now`, then runs the effect that
// reconciles the world a task later. A click in between makes React run that
// effect inside the command's flushSync, while `stateRef` still holds the world
// without the command; the tick then wrote its world over the command (a job
// collected with the «Ресурсы получены» toast came straight back). CI hit this
// at random as «Timed out waiting for: !document.querySelector('[data-qa-recycling-job=...]')».
//
// A MutationObserver callback runs right after the commit, so the click lands
// in that gap on purpose, once per tick, instead of once in a hundred runs.
const { app, BrowserWindow } = require('electron');
const path = require('path');
const { editSaveIdle } = require('./qa-save-edit.cjs');

app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-gpu');
app.on('window-all-closed', () => {});

const ROOT = path.join(__dirname, '..');
const SAVE_KEY = 'asterion.vertical-slice.test.v1';
const TEST_TIME_SCALE_KEY = 'asterion.test-time-scale.v1';
const JOBS = 10;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(win, expression, timeoutMs = 15_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await win.webContents.executeJavaScript(`Boolean(${expression})`)) return;
    await sleep(50);
  }
  throw new Error(`Timed out waiting for: ${expression}`);
}

async function click(win, selector) {
  const clicked = await win.webContents.executeJavaScript(`(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    if (!element || element.disabled) return false;
    element.click();
    return true;
  })()`);
  if (!clicked) throw new Error(`Clickable element not found/enabled: ${selector}`);
}

app.whenReady().then(async () => {
  let win;
  try {
    win = new BrowserWindow({
      width: 1280,
      height: 720,
      show: false,
      backgroundColor: '#02050a',
      webPreferences: { offscreen: true, contextIsolation: true, nodeIntegration: false, sandbox: true, partition: 'qa-command-tick-race' },
    });
    await win.loadFile(path.join(ROOT, 'dist', 'index.html'), { search: '?mode=test' });
    await waitFor(win, `document.querySelector('[data-qa-navigation="utility"]')`, 60_000);

    const value = await editSaveIdle(win, `(() => {
      const raw = localStorage.getItem(${JSON.stringify(SAVE_KEY)});
      const save = raw ? PARSE_SAVE(raw) : null;
      const planet = save?.planets?.['helion-01'];
      if (!planet?.buildings) return false;
      planet.buildings.recycling = 10;
      const now = Date.now();
      const allocation = { metal: 100, minerals: 0, gas: 0 };
      planet.recycling = { availableDebris: 100000, jobs: Array.from({ length: ${JOBS} }, (_, index) => ({
        id: 'race-' + index, debrisAmount: 1000, allocationPercent: allocation, efficiencyPercent: 120,
        output: { metal: 1200, minerals: 0, gas: 0 }, startedAt: now - 60000, finishAt: now - 30000,
        collectExpiresAt: now - 30000 + 86400000, status: 'ready',
      })) };
      localStorage.setItem(${JSON.stringify(SAVE_KEY)}, JSON.stringify(save));
      localStorage.setItem(${JSON.stringify(TEST_TIME_SCALE_KEY)}, '1');
      return true;
    })()`, { label: 'command tick race seed' });
    if (value === false) throw new Error('fixture mutation was rejected');

    await click(win, '[data-qa-zone="industry"]');
    await waitFor(win, `document.querySelector('[data-qa-zone-view][data-zone="industry"]')`);
    await click(win, '[data-zone-building-role="recycling"]');
    await waitFor(win, `document.querySelector('[data-qa-building-dialog="recycling"]')`);
    await click(win, '[data-qa-enter-building="recycling"]');
    await waitFor(win, `document.querySelectorAll('[data-qa-recycling-job]').length === ${JOBS}`);

    const results = [];
    for (let index = 0; index < JOBS; index += 1) {
      const id = `race-${index}`;
      // Arm: the next commit of the screen (the timers change every second) clicks in the gap.
      await win.webContents.executeJavaScript(`new Promise((resolve) => {
        const root = document.querySelector('[data-qa-recycling-center]');
        const observer = new MutationObserver(() => {
          observer.disconnect();
          document.querySelector('[data-qa-recycling-collect="${id}"]').click();
          resolve(true);
        });
        observer.observe(root, { subtree: true, characterData: true, childList: true });
      })`);
      await sleep(1_400);
      const row = await win.webContents.executeJavaScript(`Boolean(document.querySelector('[data-qa-recycling-job="${id}"]'))`);
      results.push({ id, cameBack: row });
    }
    const metal = await win.webContents.executeJavaScript(`document.querySelectorAll('[data-qa-recycling-job]').length`);
    const lost = results.filter((item) => item.cameBack);
    console.log(`Command tick race: ${JOBS - lost.length}/${JOBS} commands survived; rows left ${metal}`);
    if (lost.length) throw new Error(`A clock tick wrote over ${lost.length} of ${JOBS} commands: ${JSON.stringify(lost)}`);
    console.log('Command tick race QA passed.');
    win.destroy();
    app.exit(0);
  } catch (error) {
    console.error(error);
    win?.destroy();
    app.exit(1);
  }
});
