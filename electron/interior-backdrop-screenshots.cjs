// Building interiors over the game background: one frame per interior screen
// (production robots, recycling, trade, spaceport) at 1920×1080 and 1280×720.
//
//   npx electron electron/interior-backdrop-screenshots.cjs --dist=<built dist> --out=<dir>
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
const OUTPUT = path.resolve(args.out || path.join(ROOT, 'visual-qa', 'factory-robots-redo', 'interiors'));
const SAVE_KEY = 'asterion.vertical-slice.test.v1';
const TEST_TIME_SCALE_KEY = 'asterion.test-time-scale.v1';
const VIEWPORTS = args.viewport ? [args.viewport.split('x').map(Number)] : [[1920, 1080], [1280, 720]];
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
    planet.buildings['metal-production-1'] = 30;
    planet.buildings['metal-production-2'] = 20;
    planet.buildings['mineral-production-1'] = 30;
    planet.buildings['mineral-production-2'] = 20;
    planet.buildings['gas-production-1'] = 30;
    planet.buildings['gas-production-2'] = 20;
    planet.buildings.construction = 10;
    planet.buildings['advanced-factory'] = 2;
    planet.buildings.shipyard = 1;
    planet.buildings['planetary-government'] = 1;
    planet.buildings.spaceport = 5;
    planet.buildings.recycling = 5;
    planet.buildings['trade-center'] = 5;
    planet.productionBots = { metal: 0, minerals: 0, gas: 0 };
    save.metal = 1_000_000;
    save.minerals = 1_000_000;
    save.gas = 1_000_000;
    planet.energy = 1_000_000;
    save.resourceClock = { lastReconciledAt: Date.now(), remainder: { metal: 0, minerals: 0, gas: 0, energy: 0 } };
    save.schemaVersion = Math.max(Number(save.schemaVersion) || 0, 10);
    localStorage.setItem(${JSON.stringify(SAVE_KEY)}, JSON.stringify(save));
    localStorage.setItem(${JSON.stringify(TEST_TIME_SCALE_KEY)}, '1');
    return true;
  })()`, { ready: `document.querySelector('[data-qa-navigation]')`, label: 'fixture', commands: false });
  if (!ok) throw new Error('Could not seed the save');
  await waitFor(win, `document.querySelector('[data-qa-navigation="utility"]')`);
  await settle(win);
}

const INTERIORS = [
  ['industry', 'construction', '[data-qa-production-bots="construction"]', 'production-bots'],
  ['industry', 'recycling', '[data-qa-recycling-center]', 'recycling'],
  ['industry', 'trade-center', '[data-qa-trade-center]', 'trade'],
  ['military', 'spaceport', '[data-qa-spaceport-upgrades]', 'spaceport'],
];

async function runViewport(width, height) {
  const label = `${width}x${height}`;
  const directory = path.join(OUTPUT, label);
  fs.mkdirSync(directory, { recursive: true });
  const win = new BrowserWindow({ width, height, useContentSize: true, show: false, backgroundColor: '#02050a', webPreferences: { offscreen: true, sandbox: false, backgroundThrottling: false, partition: `qa-interior-backdrop-${label}` } });
  await win.loadFile(path.join(DIST, 'index.html'), { search: '?mode=test' });
  await waitFor(win, `document.querySelector('[data-qa-navigation="utility"]')`);
  await seed(win);

  for (const [zone, role, ready, name] of INTERIORS) {
    await click(win, `[data-qa-zone="${zone}"]`);
    await waitFor(win, `document.querySelector('[data-qa-zone-view][data-zone="${zone}"]')`);
    await click(win, `[data-zone-building-role="${role}"]`);
    await waitFor(win, `document.querySelector('[data-qa-building-dialog="${role}"]')`);
    await click(win, `[data-qa-enter-building="${role}"]`);
    await waitFor(win, `document.querySelector('${ready}')`);
    await sleep(5500); // let the «module opened» notice go away
    await capture(win, directory, name);
    await run(win, `window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))`);
    await waitFor(win, `document.querySelector('[data-qa-building-dialog="${role}"]')`);
    await click(win, '.resource-building-dialog-close');
  }
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
