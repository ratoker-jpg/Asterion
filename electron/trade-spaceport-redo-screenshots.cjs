// Screenshots for the Trade centre and Spaceport upgrades redo.
//
//   npx electron electron/trade-spaceport-redo-screenshots.cjs --dist=<built dist> --out=<dir> [--before] [--mocks]
//
// Worst cases at 1920×1080 and 1280×720: 200 million debris against a per-deal
// limit in the tens of millions, no deals left, an empty resource, an empty and
// a full queue, every disabled reason, 40 commander levels, all three races.
// --before keeps to the frames the old screens can show (same fixtures).
// --mocks renders the static layout variants (visual-qa/trade-spaceport-redo/mocks) instead.
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
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
const OUTPUT = path.resolve(args.out || path.join(ROOT, 'visual-qa', 'trade-spaceport-redo', args.before ? 'before' : 'after'));
const BEFORE = Boolean(args.before);
const SAVE_KEY = 'asterion.vertical-slice.test.v1';
const TEST_TIME_SCALE_KEY = 'asterion.test-time-scale.v1';
const VIEWPORTS = args.viewport ? [args.viewport.split('x').map(Number)] : [[1920, 1080], [1280, 720]];
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const run = (win, source) => win.webContents.executeJavaScript(source);

async function waitFor(win, expression, timeoutMs = 20_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await run(win, `Boolean(${expression})`)) return;
    await sleep(60);
  }
  throw new Error(`Timed out waiting for: ${expression}`);
}

// Hidden windows do not advance CSS animations: finish the finite ones.
async function settle(win, ms = 250) {
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
  await settle(win, 120);
}

async function setInput(win, selector, value) {
  const changed = await run(win, `(() => {
    const input = document.querySelector(${JSON.stringify(selector)});
    if (!(input instanceof HTMLInputElement)) return false;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, ${JSON.stringify(String(value))});
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  })()`);
  if (!changed) throw new Error(`Input not found: ${selector}`);
  await settle(win, 120);
}

async function hover(win, selector) {
  const point = await run(win, `(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    if (!element) return null;
    element.scrollIntoView({ block: 'center' });
    const rect = element.getBoundingClientRect();
    return { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2) };
  })()`);
  if (!point) throw new Error(`Hover target not found: ${selector}`);
  await sleep(120);
  win.webContents.sendInputEvent({ type: 'mouseMove', x: 1, y: 1 });
  await sleep(60);
  win.webContents.sendInputEvent({ type: 'mouseMove', ...point });
  await sleep(320);
}

async function capture(win, directory, name, { keepAnimations = false } = {}) {
  if (!keepAnimations) await settle(win);
  win.webContents.invalidate();
  await sleep(300);
  const { width, height } = await run(win, '({ width: innerWidth, height: innerHeight })');
  const image = await win.capturePage({ x: 0, y: 0, width, height });
  fs.writeFileSync(path.join(directory, `${name}.png`), image.toPNG());
  console.log(`[shots] ${path.relative(ROOT, path.join(directory, name))}.png`);
}

/** `mutate` is page-side code over `save`, `planet` and `now`. */
async function seed(win, { race = 'aegis', mutate = '' } = {}) {
  const ok = await editSaveIdle(win, `(() => {
    const save = JSON.parse(localStorage.getItem(${JSON.stringify(SAVE_KEY)}) || 'null');
    const planet = save?.planets?.['helion-01'];
    if (!save || !planet?.buildings || !planet?.recycling) return false;
    const now = Date.now();
    if (save.profile) save.profile.factionId = ${JSON.stringify(race)};
    planet.name = 'Москва';
    planet.buildings['trade-center'] = 10;
    planet.buildings.spaceport = 10;
    planet.buildings.shipyard = 20;
    planet.buildings['metal-production-1'] = 30;
    planet.buildings['metal-production-2'] = 20;
    planet.buildings['mineral-production-1'] = 30;
    planet.buildings['mineral-production-2'] = 20;
    planet.buildings['gas-production-1'] = 30;
    planet.buildings['gas-production-2'] = 20;
    planet.trade = { refillAtQueue: [now + 384_000] };
    planet.recycling.availableDebris = 202_278_751;
    planet.spaceportUpgrades = { shipLevels: {}, shipQueue: [], commanderQueue: [] };
    planet.resources = { ...(planet.resources || {}), metal: 23_383_718, minerals: 28_930_056, gas: 24_420_616 };
    save.metal = 23_383_718;
    save.minerals = 28_930_056;
    save.gas = 24_420_616;
    save.science = save.science || { levels: {}, queue: [] };
    save.science.levels = { ...Object.fromEntries(Array.from({ length: 21 }, (_, i) => [i + 1, 15])) };
    save.shipUpgradeLevels = { transporter: 10, 'mega-transporter': 1, scout: 3, defender: 5, cruiser: 8, battleship: 9, corsair: 17 };
    save.resourceClock = { lastReconciledAt: now, remainder: { metal: 0, minerals: 0, gas: 0, energy: 0 } };
    save.schemaVersion = Math.max(Number(save.schemaVersion) || 0, 10);
    ${mutate}
    localStorage.setItem(${JSON.stringify(SAVE_KEY)}, JSON.stringify(save));
    localStorage.setItem(${JSON.stringify(TEST_TIME_SCALE_KEY)}, '1');
    return true;
  })()`, { ready: `document.querySelector('[data-qa-navigation]')`, label: 'fixture' });
  if (!ok) throw new Error('Could not seed the save');
  await waitFor(win, `document.querySelector('[data-qa-navigation="utility"]')`);
  await settle(win);
}

async function openTrade(win) {
  await click(win, '[data-qa-zone="industry"]');
  await waitFor(win, `document.querySelector('[data-qa-zone-view][data-zone="industry"]')`);
  await click(win, '[data-zone-building-role="trade-center"]');
  await waitFor(win, `document.querySelector('[data-qa-building-dialog="trade-center"]')`);
  await click(win, '[data-qa-enter-building="trade-center"]');
  await waitFor(win, `document.querySelector('[data-qa-trade-center]')`);
  await sleep(5200); // let the "module opened" toast go away
  await settle(win);
}

async function openSpaceport(win) {
  await click(win, '[data-qa-zone="military"]');
  await waitFor(win, `document.querySelector('[data-qa-zone-view][data-zone="military"]')`);
  await click(win, '[data-zone-building-role="spaceport"]');
  await waitFor(win, `document.querySelector('[data-qa-building-dialog="spaceport"]')`);
  await click(win, '[data-qa-enter-building="spaceport"]');
  await waitFor(win, `document.querySelector('[data-qa-spaceport-upgrades]')`);
  await sleep(5200);
  await settle(win);
}

async function tradeScenes(win, directory) {
  await seed(win);
  await openTrade(win);
  await capture(win, directory, 'trade-01-start');

  await click(win, '[data-qa-trade-source="debris"]');
  await click(win, '[data-qa-trade-target="gas"]');
  await click(win, '[data-qa-trade-max]');
  await capture(win, directory, 'trade-02-debris-max');
  if (BEFORE) return;

  await click(win, '[data-qa-trade-source="metal"]');
  await click(win, '[data-qa-trade-target="minerals"]');
  await click(win, '[data-qa-trade-share="50"]');
  await capture(win, directory, 'trade-03-metal-half');

  await setInput(win, '[data-qa-trade-amount-input]', '999999999999');
  await capture(win, directory, 'trade-04-over-limit');

  await click(win, '[data-qa-trade-max]');
  await click(win, '[data-qa-trade-submit]');
  await waitFor(win, `document.querySelector('[data-qa-trade-toast]')?.textContent?.includes('Обмен выполнен')`);
  await capture(win, directory, 'trade-05-success', { keepAnimations: true });

  await hover(win, '[data-qa-trade-source="debris"]');
  await capture(win, directory, 'trade-06-tooltip', { keepAnimations: true });

  // No deals left: 30 of 30 spent, the timer and the reason are the only news.
  await seed(win, { mutate: `planet.trade = { refillAtQueue: Array.from({ length: 30 }, (_, i) => now + 200_000 + i * 900_000) };` });
  await openTrade(win);
  await click(win, '[data-qa-trade-max]');
  await capture(win, directory, 'trade-07-no-deals');

  // A young planet: level 1, small numbers, no gas at all, two of three deals used.
  await seed(win, { mutate: `planet.buildings['trade-center'] = 1; planet.trade = { refillAtQueue: [now + 200_000, now + 1_100_000] }; planet.recycling.availableDebris = 1200; save.metal = 15880; save.minerals = 712; save.gas = 0; planet.resources = { ...planet.resources, metal: 15880, minerals: 712, gas: 0 };` });
  await openTrade(win);
  await capture(win, directory, 'trade-08-young-planet');
}

async function spaceportScenes(win, directory) {
  await seed(win);
  await openSpaceport(win);
  await capture(win, directory, 'spaceport-01-empty-queue');

  await click(win, '[data-qa-spaceport-upgrade="cruiser"]');
  await click(win, '[data-qa-spaceport-upgrade="cruiser"]');
  await capture(win, directory, 'spaceport-02-two-queued');
  if (BEFORE) return;

  await click(win, '[data-qa-spaceport-upgrade="scout"]');
  await capture(win, directory, 'spaceport-03-queue-full');

  await run(win, 'window.scrollTo(0, document.documentElement.scrollHeight)');
  await capture(win, directory, 'spaceport-04-scrolled');
  await run(win, 'window.scrollTo(0, 0)');

  await click(win, '[data-qa-spaceport-tab="commanders"]');
  await capture(win, directory, 'spaceport-05-commanders');

  // Little money: the short resource is red and named under the button.
  await seed(win, { mutate: `save.metal = 3000; save.minerals = 900; save.gas = 150; planet.resources = { ...planet.resources, metal: 3000, minerals: 900, gas: 150 };` });
  await openSpaceport(win);
  await capture(win, directory, 'spaceport-06-poor');

  // No science and a small shipyard: the missing requirements are red and named.
  await seed(win, { mutate: `save.science.levels = {}; planet.buildings.shipyard = 2; save.shipUpgradeLevels = {};` });
  await openSpaceport(win);
  await capture(win, directory, 'spaceport-07-missing-requirements');
  await hover(win, '[data-qa-spaceport-card="defender"] [data-qa-spaceport-requirement-status="missing"]');
  await capture(win, directory, 'spaceport-08-tooltip', { keepAnimations: true });

  // Late game: everything maxed, costs in the millions on what is left.
  await seed(win, { mutate: `save.shipUpgradeLevels = { transporter: 10, 'mega-transporter': 10, scout: 9, defender: 9, cruiser: 9, bomber: 9, destroyer: 9, battleship: 9 };` });
  await openSpaceport(win);
  await capture(win, directory, 'spaceport-09-late-game');
}

async function raceScenes(win, directory) {
  for (const race of ['synod', 'veyra']) {
    await seed(win, { race });
    await openTrade(win);
    await click(win, '[data-qa-trade-source="debris"]');
    await click(win, '[data-qa-trade-max]');
    await capture(win, directory, `race-${race}-trade`);
    await seed(win, { race });
    await openSpaceport(win);
    await click(win, '[data-qa-spaceport-upgrade="cruiser"]');
    await capture(win, directory, `race-${race}-spaceport`);
  }
}

async function runViewport(width, height) {
  const label = `${width}x${height}`;
  const directory = path.join(OUTPUT, label);
  fs.mkdirSync(directory, { recursive: true });
  const win = new BrowserWindow({ width, height, useContentSize: true, show: false, backgroundColor: '#02050a', webPreferences: { offscreen: true, sandbox: false, backgroundThrottling: false, partition: `qa-trade-spaceport-redo-${label}${BEFORE ? '-before' : ''}` } });
  await win.loadFile(path.join(DIST, 'index.html'), { search: '?mode=test' });
  await waitFor(win, `document.querySelector('[data-qa-navigation="utility"]')`);
  await tradeScenes(win, directory);
  await spaceportScenes(win, directory);
  if (!BEFORE) await raceScenes(win, directory);
  win.destroy();
}

async function runMocks() {
  fs.mkdirSync(OUTPUT, { recursive: true });
  const page = path.join(ROOT, 'visual-qa', 'trade-spaceport-redo', 'mocks', 'mocks.html');
  const win = new BrowserWindow({ width: 1920, height: 1080, useContentSize: true, show: false, backgroundColor: '#02050a', webPreferences: { offscreen: true, sandbox: false, backgroundThrottling: false } });
  for (const variant of ['tA', 'tB', 'tC', 'sA', 'sB', 'sC']) {
    const url = pathToFileURL(page);
    url.searchParams.set('v', variant);
    await win.loadURL(url.href);
    await sleep(1000);
    await capture(win, OUTPUT, `variant-${variant}`);
  }
  win.destroy();
}

app.whenReady().then(async () => {
  try {
    if (args.mocks) await runMocks();
    else for (const [width, height] of VIEWPORTS) await runViewport(width, height);
    app.exit(0);
  } catch (error) {
    console.error(error.stack || error);
    app.exit(1);
  }
});
