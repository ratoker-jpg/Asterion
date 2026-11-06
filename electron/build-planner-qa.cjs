// «Планировщик стройки» QA at 1280×720 and 1920×1080: the screen on screen (empty plan,
// a plan with waiting lines, paused), the layout contract, and the rule that matters most:
// nothing starts by itself while the window is not active, and with an active window the
// queue fills with ordinary build orders and the plan survives a reload.
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');
const { editSaveIdle } = require('./qa-save-edit.cjs');

app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-gpu');
app.on('window-all-closed', () => {});

const ROOT = path.join(__dirname, '..');
const OUTPUT = process.env.ASTERION_QA_OUTPUT || path.join(ROOT, 'visual-qa', 'build-planner');
const SKIP_SCREENSHOTS = process.env.ASTERION_SKIP_SCREENSHOTS === '1';
const SAVE_KEY = 'asterion.vertical-slice.test.v1';
const VIEWPORTS = [[1280, 720], [1920, 1080]];
const HOME = 'helion-01';
// Seven planets like the owner's empire, one with a very long name.
const COLONIES = [
  ['planet-1-1-6', 'Кассия', 1, 6],
  ['planet-1-2-4', 'Ферон Великая Северная Колония Альфа', 2, 4],
  ['planet-1-3-9', 'Тавр', 3, 9],
  ['planet-1-5-2', 'Нордин', 5, 2],
  ['planet-1-17-11', 'Колония 17-11', 17, 11],
  ['planet-1-17-5', 'Колония 17-5', 17, 5],
];
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const failures = [];
const fail = (message, detail) => { failures.push({ message, detail }); console.error(`[build-plan-qa] ${message}`, JSON.stringify(detail ?? null)); };
const check = (ok, message, detail) => { if (!ok) fail(message, detail); };
const run = (win, source) => win.webContents.executeJavaScript(source);

async function waitFor(win, expression, timeoutMs = 10000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await run(win, `Boolean(${expression})`)) return;
    await sleep(50);
  }
  throw new Error(`Timed out waiting for: ${expression}`);
}
async function settle(win, ms = 160) {
  await run(win, 'new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
  await sleep(ms);
}
async function capture(win, directory, name) {
  if (SKIP_SCREENSHOTS) return;
  await run(win, `document.getAnimations().forEach((animation) => {
    const timing = animation.effect?.getComputedTiming?.();
    if (timing && Number.isFinite(timing.endTime)) animation.currentTime = timing.endTime;
  })`);
  await settle(win, 60);
  const result = await win.webContents.debugger.sendCommand('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: false });
  fs.writeFileSync(path.join(directory, `${name}.png`), Buffer.from(result.data, 'base64'));
}
async function click(win, selector) {
  const clicked = await run(win, `(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    if (!element || element.disabled) return false;
    element.click();
    return true;
  })()`);
  if (!clicked) throw new Error(`Element not found/enabled: ${selector}`);
  await settle(win);
}
const savedSave = (win) => run(win, `JSON.parse(localStorage.getItem(${JSON.stringify(SAVE_KEY)}))`);
// The QA window is hidden, so the page reports «not visible» by itself: say what «the player is in the game» means.
const setActive = (win, active) => run(win, `(() => {
  document.hasFocus = () => ${active ? 'true' : 'false'};
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => ${active ? "'visible'" : "'hidden'"} });
  return true;
})()`);

async function seed(win, scenario = {}) {
  const ok = await editSaveIdle(win, `(() => {
    const scenario = ${JSON.stringify(scenario)};
    const save = JSON.parse(localStorage.getItem(${JSON.stringify(SAVE_KEY)}) || 'null');
    const home = save?.planets?.[${JSON.stringify(HOME)}];
    if (!home) return false;
    save.profile.factionId = scenario.race || 'aegis';
    if (save.worldConfig) save.worldConfig.factionId = save.profile.factionId;
    home.name = scenario.homeName || 'Москва';
    home.overpopulation = undefined;
    home.buildings['metal-production-1'] = 3;
    home.buildings['mineral-production-1'] = 3;
    home.buildings['gas-production-1'] = 2;
    home.buildings['basic-energy'] = 4;
    home.buildings['metal-storage'] = 20;
    const wallet = scenario.wallet || { metal: 900000000, minerals: 900000000, gas: 900000000 };
    home.resources = wallet;
    Object.assign(save, wallet);
    save.currentPlanetId = ${JSON.stringify(HOME)};
    save.queues = { [${JSON.stringify(HOME)}]: [] };
    const now = Date.now();
    for (const [id, name, system, position] of ${JSON.stringify(COLONIES)}) {
      const planet = JSON.parse(JSON.stringify(home));
      Object.assign(planet, { name, universeGalaxy: 1, universeSystem: system, universePosition: position, skin: 'colonized', resources: wallet });
      save.planets[id] = planet;
      save.queues[id] = [];
      if (save.resourceClock?.byPlanet) save.resourceClock.byPlanet[id] = { ...(save.resourceClock.byPlanet[${JSON.stringify(HOME)}] || {}), lastReconciledAt: now };
    }
    const plans = { ...(scenario.others || {}), ...(scenario.plan ? { [${JSON.stringify(HOME)}]: scenario.plan } : {}) };
    save.fleetUi = { favoriteTargets: [], ...(Object.keys(plans).length ? { buildPlans: plans } : {}) };
    localStorage.setItem(${JSON.stringify(SAVE_KEY)}, JSON.stringify(save));
    localStorage.setItem('asterion.test-time-scale.v1', '1');
    return true;
  })()`, { ready: `document.querySelector('[data-qa-navigation="utility"]')`, label: 'build planner fixture' });
  if (!ok) throw new Error('Could not seed the fixture');
  await run(win, 'document.fonts?.ready');
  await settle(win, 300);
}

async function openPlanner(win) {
  await click(win, '[data-qa-planet-section="empire"]');
  await waitFor(win, `document.querySelector('[data-qa-empire-build-planner]')`);
  await click(win, '[data-qa-empire-build-planner]');
  await waitFor(win, `document.querySelector('[data-qa-build-planner]')`);
  await settle(win, 900);
}

async function checkLayout(win, label) {
  const report = await run(win, `(() => {
    const dialog = document.querySelector('[data-qa-build-planner]');
    if (!dialog) return { missing: true };
    const box = dialog.getBoundingClientRect();
    const problems = [];
    if (box.left < 0 || box.top < 0 || box.right > innerWidth + 0.5 || box.bottom > innerHeight + 0.5) problems.push('dialog outside the window');
    if (dialog.scrollWidth > dialog.clientWidth + 1) problems.push('dialog scrolls sideways');
    if (dialog.querySelector('[title]')) problems.push('native tooltip');
    const grid = dialog.querySelector('.bplan-grid');
    if (grid && grid.scrollWidth > grid.clientWidth + 1) problems.push('tile grid scrolls sideways');
    for (const tile of dialog.querySelectorAll('[data-qa-build-plan-line]')) {
      const box = tile.getBoundingClientRect();
      for (const cell of tile.querySelectorAll('*')) {
        const rect = cell.getBoundingClientRect();
        if (rect.width && (rect.left < box.left - 1 || rect.right > box.right + 1)) { problems.push('outside the tile: ' + tile.dataset.qaBuildPlanLine + ' ' + cell.className); break; }
      }
      const levels = tile.querySelector('[data-qa-build-plan-levels]')?.textContent ?? '';
      if (Number(tile.dataset.qaBuildPlanLineTarget) < Number(tile.dataset.qaBuildPlanLineCurrent) && !levels.includes('уже')) problems.push('target below current reads as progress: ' + levels);
    }
    for (const node of dialog.querySelectorAll('.bplan-tile__go, .fplan__btn, .bplan-presets button, .bplan-status p:not(.is-next) b, .bplan-tile__levels span, .bplan-tile__cost span, .bplan-tile__target>button')) {
      if (node.scrollWidth > node.clientWidth + 1) problems.push('text cut: ' + node.textContent.trim().slice(0, 50));
    }
    return { problems, lanes: dialog.querySelectorAll('[data-qa-build-plan-line]').length };
  })()`);
  if (report.missing) return fail(`${label}: planner is not open`);
  if (report.problems.length) fail(`${label}: layout`, report.problems);
  return report;
}

const PLAN = { targets: { 'metal-production-1': 12, 'mineral-production-1': 12, 'gas-production-1': 8, 'basic-energy': 10, 'metal-storage': 5, 'metal-production-2': 1 } };

async function runViewport(win, directory) {
  const metrics = {};
  // 1. Empty plan, a click on a preset fills the plan.
  await setActive(win, false);
  await seed(win, {});
  await openPlanner(win);
  check(await run(win, `Boolean(document.querySelector('[data-qa-build-plan-empty]'))`), 'An empty plan shows the start screen');
  await checkLayout(win, '01-empty');
  await capture(win, directory, '01-empty');
  await click(win, '[data-qa-build-plan-preset="metal-production-1:10"]');
  await waitFor(win, `document.querySelector('[data-qa-build-plan-lanes]')`);
  const preset = await savedSave(win);
  check((preset.fleetUi?.buildPlans?.[HOME]?.targets?.['metal-production-1'] ?? 0) === 10, 'A preset sets the targets in the save', preset.fleetUi);

  // 2. A window that is not active builds nothing, whatever the resources.
  await seed(win, { plan: PLAN });
  await openPlanner(win);
  await sleep(2600);
  const idle = await savedSave(win);
  check((idle.queues?.[HOME] ?? []).length === 0, 'Nothing starts while the window is not active', idle.queues);
  const idleView = await run(win, `({ next: document.querySelector('.bplan-status .is-next b')?.textContent ?? null, lines: document.querySelectorAll('[data-qa-build-plan-line]').length, headline: document.querySelector('[data-qa-build-plan-headline] b')?.textContent ?? null })`);
  check(idleView.lines >= 6 && idleView.next, 'The plan shows its lines and the next upgrade', idleView);
  const layout = await checkLayout(win, '02-plan');
  metrics.plan = layout;
  await capture(win, directory, '02-plan');

  // 3. An active window starts ordinary build orders up to the queue limit, and the plan survives a reload.
  await setActive(win, true);
  await sleep(2600);
  const active = await savedSave(win);
  const queue = active.queues?.[HOME] ?? [];
  check(queue.length === 3, 'An active window fills the build queue', { roles: queue.map((item) => item.assetRole), page: await run(win, '({ v: document.visibilityState, f: document.hasFocus(), notice: document.querySelector("[role=status]")?.textContent ?? null })') });
  check(queue.every((item) => item.kind === 'building'), 'Auto-starts are ordinary build orders', queue);
  await waitFor(win, `document.querySelector('.bplan-status')?.textContent.includes('3 из 3')`);
  await checkLayout(win, '03-building');
  await capture(win, directory, '03-building');
  await run(win, 'location.reload()');
  await waitFor(win, `document.querySelector('[data-qa-navigation="utility"]')`, 20000);
  const reloaded = await savedSave(win);
  check(Object.keys(reloaded.fleetUi?.buildPlans?.[HOME]?.targets ?? {}).length === 6, 'The plan survives a reload', reloaded.fleetUi);

  // 4. Paused: nothing starts even in an active window.
  await setActive(win, true);
  await seed(win, { plan: { ...PLAN, paused: true } });
  await setActive(win, true);
  await openPlanner(win);
  await sleep(2600);
  const paused = await savedSave(win);
  check((paused.queues?.[HOME] ?? []).length === 0, 'A paused plan starts nothing', paused.queues);
  await checkLayout(win, '04-paused');
  await capture(win, directory, '04-paused');

  // 5. Poor wallet: the lines say what they lack.
  await setActive(win, true);
  await seed(win, { plan: PLAN, wallet: { metal: 10, minerals: 10, gas: 0 } });
  await setActive(win, true);
  await openPlanner(win);
  await sleep(1500);
  const poor = await run(win, `Array.from(document.querySelectorAll('[data-qa-build-plan-wait]')).map((node) => node.dataset.qaBuildPlanWait)`);
  check(poor.includes('resources'), 'Short lines say they lack resources', poor);
  await checkLayout(win, '05-poor');
  await capture(win, directory, '05-poor');

  // 6. Worst case: seven planets, a very long home name, every building in the plan.
  await setActive(win, false);
  const everything = { targets: Object.fromEntries(['metal-production-1', 'metal-production-2', 'metal-production-3', 'mineral-production-1', 'mineral-production-2', 'gas-production-1', 'gas-production-2', 'basic-energy', 'advanced-energy', 'hangar', 'construction', 'advanced-factory', 'metal-storage', 'mineral-storage', 'gas-storage', 'recycling', 'trade-center'].map((role, index) => [role, 8 + (index % 5) * 4])) };
  await seed(win, { plan: everything, homeName: 'Ферон Великая Северная Колония Бета', others: { 'planet-1-1-6': PLAN, 'planet-1-3-9': { ...PLAN, paused: true } } });
  await openPlanner(win);
  const tabs = await run(win, `document.querySelectorAll('[data-qa-build-plan-planet]').length`);
  check(tabs === 7, 'All seven planets have a tab', tabs);
  await checkLayout(win, '06-seven-planets-long-name');
  await capture(win, directory, '06-seven-planets-long-name');
  await run(win, `document.querySelector('.bplan-grid')?.scrollTo(0, 100000)`);
  await settle(win, 200);
  await capture(win, directory, '07-scrolled-to-shelf');

  // 8. A target below the current level reads as «already higher», not «20 of 5».
  const passed = await run(win, `document.querySelector('[data-qa-build-plan-line="metal-storage"] [data-qa-build-plan-levels]')?.textContent ?? null`);
  await seed(win, { plan: PLAN, others: { 'planet-1-1-6': PLAN } });
  await openPlanner(win);
  const below = await run(win, `document.querySelector('[data-qa-build-plan-line="metal-storage"] [data-qa-build-plan-levels]')?.textContent ?? null`);
  check(below && below.includes('уже') && !below.includes('5'), 'A passed target reads as already higher', { below, passed });
  check(await run(win, `!document.querySelector('[data-qa-build-plan-preset="metal-storage:25"]') && Boolean(document.querySelector('[data-qa-build-plan-preset="metal-storage:20"]'))`), 'Storages offer no level above their last one (20)');
  // The picture opens what the building does; the arrows move it in the priority.
  await click(win, '[data-qa-build-plan-info="mineral-production-1"]');
  const info = await run(win, `document.querySelector('[data-qa-build-plan-info-card]')?.textContent ?? ''`);
  check(info.includes('Сейчас') && info.includes('По плану'), 'The info card says what the building gives now and by plan', info);
  await checkLayout(win, '09-info');
  await capture(win, directory, '09-info');
  await click(win, '[data-qa-build-plan-info-back]');
  await click(win, '[data-qa-build-plan-down="metal-production-1"]');
  const order = await run(win, `Array.from(document.querySelectorAll('[data-qa-build-plan-line]')).map((node) => node.dataset.qaBuildPlanLine)`);
  check(order[0] !== 'metal-production-1' && order.indexOf('metal-production-1') > 0, 'The arrows move a building in the priority', order);
  const saved = await savedSave(win);
  check(Array.isArray(saved.fleetUi?.buildPlans?.[HOME]?.order), 'The priority is saved', saved.fleetUi?.buildPlans?.[HOME]);
  await click(win, '[data-qa-build-plan-copy]');
  await waitFor(win, `document.querySelector('[data-qa-build-plan-copy-list]')`);
  await checkLayout(win, '08-copy-list');
  await capture(win, directory, '08-copy-list');
  return metrics;
}

app.whenReady().then(async () => {
  let win;
  try {
    fs.mkdirSync(OUTPUT, { recursive: true });
    win = new BrowserWindow({
      width: 1000, height: 700, show: false, backgroundColor: '#02050a',
      webPreferences: { offscreen: true, contextIsolation: true, nodeIntegration: false, sandbox: true, partition: 'qa-build-planner' },
    });
    await win.loadFile(path.join(ROOT, 'dist', 'index.html'), { search: '?mode=test' });
    await waitFor(win, `document.querySelector('[data-qa-navigation="utility"]')`, 20000);
    win.webContents.debugger.attach('1.3');
    for (const [width, height] of VIEWPORTS) {
      const directory = path.join(OUTPUT, `${width}x${height}`);
      fs.mkdirSync(directory, { recursive: true });
      await win.webContents.debugger.sendCommand('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false, screenWidth: width, screenHeight: height });
      await settle(win);
      fs.writeFileSync(path.join(directory, 'metrics.json'), JSON.stringify(await runViewport(win, directory), null, 2));
    }
    win.webContents.debugger.detach();
    win.destroy();
    if (failures.length) { console.error(`[build-plan-qa] ${failures.length} check(s) failed`); app.exit(1); return; }
    console.log('[build-plan-qa] all checks passed');
    app.exit(0);
  } catch (error) {
    console.error(error);
    if (failures.length) console.error(JSON.stringify(failures));
    try { if (win?.webContents.debugger.isAttached()) win.webContents.debugger.detach(); } catch {}
    win?.destroy();
    app.exit(1);
  }
});
