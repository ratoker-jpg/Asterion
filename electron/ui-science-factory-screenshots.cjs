// Before/after screenshots for the Science and Production bots redesign.
//
//   npx electron electron/ui-science-factory-screenshots.cjs --dist=<built dist> --out=<dir>
//
// Frames, each at 1920×1080 and 1280×720:
// - science-queued: Physics at level 2 with one more level in the queue;
// - factory-allocated: 6 robots on metal, 4 on minerals, 4 of 14 free;
// - factory-none-free: 10 on metal, 4 on minerals, none free.
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');
const { editSaveIdle } = require('./qa-save-edit.cjs');

app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-gpu');
app.on('window-all-closed', () => {});

const ROOT = path.join(__dirname, '..');
const args = Object.fromEntries(process.argv.filter((arg) => arg.startsWith('--')).map((arg) => {
  const [key, value] = arg.slice(2).split('=');
  return [key, value ?? '1'];
}));
const DIST = path.resolve(args.dist || path.join(ROOT, 'dist'));
const OUTPUT = path.resolve(args.out || path.join(ROOT, 'visual-qa', 'ui-science-factory', 'after'));
const SAVE_KEY = 'asterion.vertical-slice.test.v1';
const TEST_TIME_SCALE_KEY = 'asterion.test-time-scale.v1';
const VIEWPORTS = args.viewport ? [args.viewport.split('x').map(Number)] : [[1920, 1080], [1280, 720]];
const ONLY_SCIENCE = args.only === 'science';
const PHYSICS_ID = 1;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const run = (win, source) => win.webContents.executeJavaScript(source);

async function waitFor(win, expression, timeoutMs = 15_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await run(win, `Boolean(${expression})`)) return;
    await sleep(60);
  }
  throw new Error(`Timed out waiting for: ${expression}`);
}

// Hidden windows do not advance CSS animations: finish the finite ones.
async function settle(win, ms = 300) {
  await run(win, 'document.fonts?.ready');
  await run(win, `document.getAnimations().forEach((a) => { try { if (a.effect?.getTiming().iterations !== Infinity) a.finish(); } catch {} })`);
  await sleep(ms);
}

async function click(win, selector) {
  const clicked = await run(win, `(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    if (!element || element.disabled) return false;
    element.click();
    return true;
  })()`);
  if (!clicked) throw new Error(`Element not found/enabled: ${selector}`);
  await settle(win, 150);
}

async function capture(win, directory, name) {
  await settle(win);
  win.webContents.invalidate();
  await sleep(300);
  const { width, height } = await run(win, '({ width: innerWidth, height: innerHeight })');
  const image = await win.capturePage({ x: 0, y: 0, width, height });
  fs.writeFileSync(path.join(directory, `${name}.png`), image.toPNG());
  console.log(`[shots] ${path.relative(ROOT, path.join(directory, name))}.png`);
}

async function seed(win) {
  const ok = await editSaveIdle(win, `(() => {
    const save = JSON.parse(localStorage.getItem(${JSON.stringify(SAVE_KEY)}) || 'null');
    const planet = save?.planets?.['helion-01'];
    if (!save || !planet?.buildings || !save.science?.levels) return false;
    planet.buildings.research = 3;
    planet.buildings.construction = 10;
    planet.buildings['advanced-factory'] = 2;
    planet.buildings.shipyard = 1;
    planet.buildings['planetary-government'] = 1;
    planet.buildings.spaceport = 1;
    planet.productionBots = { metal: 0, minerals: 0, gas: 0 };
    save.metal = 1_000_000;
    save.minerals = 1_000_000;
    save.gas = 1_000_000;
    planet.energy = 1_000_000;
    save.resourceClock = { lastReconciledAt: Date.now(), remainder: { metal: 0, minerals: 0, gas: 0, energy: 0 } };
    save.science.levels[${PHYSICS_ID}] = 2;
    save.science.queue = [];
    save.schemaVersion = Math.max(Number(save.schemaVersion) || 0, 10);
    localStorage.setItem(${JSON.stringify(SAVE_KEY)}, JSON.stringify(save));
    localStorage.setItem(${JSON.stringify(TEST_TIME_SCALE_KEY)}, '1');
    return true;
  })()`, { ready: `document.querySelector('[data-qa-navigation]')`, label: 'fixture', commands: false });
  if (!ok) throw new Error('Could not seed the save');
  await waitFor(win, `document.querySelector('[data-qa-navigation="utility"]')`);
  await settle(win);
}

async function setBots(win, resource, value) {
  const changed = await run(win, `(() => {
    const input = document.querySelector('[data-qa-bot-slider=${JSON.stringify(resource)}]');
    if (!(input instanceof HTMLInputElement)) return false;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    setter?.call(input, ${JSON.stringify(String(value))});
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  })()`);
  if (!changed) throw new Error(`Range not found: ${resource}`);
  await settle(win, 120);
}

async function runViewport(width, height) {
  const label = `${width}x${height}`;
  const directory = path.join(OUTPUT, label);
  fs.mkdirSync(directory, { recursive: true });
  const win = new BrowserWindow({ width, height, useContentSize: true, show: false, backgroundColor: '#02050a', webPreferences: { offscreen: true, sandbox: false, backgroundThrottling: false, partition: `qa-ui-science-factory-${label}` } });
  await win.loadFile(path.join(DIST, 'index.html'), { search: '?mode=test' });
  await waitFor(win, `document.querySelector('[data-qa-navigation="utility"]')`);
  await seed(win);

  await click(win, '[data-qa-route="science"]');
  await waitFor(win, `document.querySelector('[data-qa-science-root]')`);
  await click(win, `[data-qa-science-id="${PHYSICS_ID}"] [data-qa-science-action]`);
  await waitFor(win, `document.querySelector('[data-qa-science-queue-count]')?.textContent === '1/3'`);
  await run(win, 'window.scrollTo(0, 0)');
  await sleep(5500); // let the «added to the queue» toast go away
  await capture(win, directory, 'science-queued');

  if (ONLY_SCIENCE) { win.destroy(); return; }
  await click(win, '[data-qa-route="planet"]');
  await click(win, '[data-qa-zone="industry"]');
  await waitFor(win, `document.querySelector('[data-qa-zone-view][data-zone="industry"]')`);
  await click(win, '[data-zone-building-role="construction"]');
  await waitFor(win, `document.querySelector('[data-qa-building-dialog="construction"]')`);
  await click(win, '[data-qa-enter-building="construction"]');
  await waitFor(win, `document.querySelector('[data-qa-production-bots="construction"]')`);

  await setBots(win, 'metal', 6);
  await setBots(win, 'minerals', 4);
  await click(win, '[data-qa-production-bots-distribute]');
  await sleep(5500); // let the confirmation toasts go away
  await capture(win, directory, 'factory-allocated');

  await setBots(win, 'metal', 10);
  await click(win, '[data-qa-production-bots-distribute]');
  await sleep(5500);
  await capture(win, directory, 'factory-none-free');
  win.destroy();
}

app.whenReady().then(async () => {
  try {
    for (const [width, height] of VIEWPORTS) await runViewport(width, height);
    app.exit(0);
  } catch (error) {
    console.error(error.stack || error);
    app.exit(1);
  }
});
