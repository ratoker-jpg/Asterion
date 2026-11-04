// «Эталонный флот» QA at 1920×1080 and 1280×720: the worst cases on screen
// (all ship types, every race, millions of ships, a plan bigger than the hangar,
// an empty plan, no shipyard, no resources, a long queue, long names, locked
// ships), the layout contract (inside the window, no cut numbers, no overlaps,
// no native tooltips), one line and all lines started with the exact amount,
// partial affordability, several lines started in a row across clock ticks,
// the plan surviving a reload, copying a plan and the «Империя» glance.
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-gpu');
app.on('window-all-closed', () => {});

const ROOT = path.join(__dirname, '..');
const OUTPUT = process.env.ASTERION_QA_OUTPUT || path.join(ROOT, 'visual-qa', 'fleet-planner');
const SKIP_SCREENSHOTS = process.env.ASTERION_SKIP_SCREENSHOTS === '1';
const SAVE_KEY = 'asterion.vertical-slice.test.v1';
const VIEWPORTS = [[1920, 1080], [1280, 720]];
const HOME = 'helion-01';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const failures = [];
const fail = (message, detail) => { failures.push({ message, detail }); console.error(`[planner-qa] ${message}`, JSON.stringify(detail ?? null)); };
const check = (ok, message, detail) => { if (!ok) fail(message, detail); };

// The owner's example, scaled to fit a level-30 hangar.
const OWNER_PLAN = { targets: { scout: 300, defender: 300, destroyer: 40, battleship: 100 }, fillShipId: 'bomber' };
const ALL_SHIPS = ['solar-satellite', 'spy-probe', 'transporter', 'mega-transporter', 'colonizer', 'recycler', 'scout', 'cruiser', 'defender', 'battleship', 'destroyer', 'bomber', 'death-star'];
const COLONIES = [
  ['planet-1-1-6', 'Кассия', 1, 6],
  ['planet-1-2-4', 'Ферон Великая Северная Колония Альфа', 2, 4],
  ['planet-1-3-9', 'Тавр', 3, 9],
  ['planet-1-5-2', 'Нордин', 5, 2],
  ['planet-1-17-11', 'Колония 17-11', 17, 11],
  ['planet-1-17-5', 'Колония 17-5', 17, 5],
];

async function waitFor(win, expression, timeoutMs = 10000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await win.webContents.executeJavaScript(`Boolean(${expression})`)) return;
    await sleep(50);
  }
  throw new Error(`Timed out waiting for: ${expression}`);
}
const run = (win, source) => win.webContents.executeJavaScript(source);

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

/** The world for a scenario; written with the reload in one renderer turn so no autosave lands in between. */
async function seed(win, scenario = {}) {
  const loaded = new Promise((resolve) => win.webContents.once('did-finish-load', resolve));
  const ok = await run(win, `(() => {
    const scenario = ${JSON.stringify(scenario)};
    const save = JSON.parse(localStorage.getItem(${JSON.stringify(SAVE_KEY)}) || 'null');
    const home = save?.planets?.[${JSON.stringify(HOME)}];
    if (!home) return false;
    const now = Date.now();
    const shipIds = Object.keys(home.fleet.ships);
    const ships = (list) => Object.fromEntries(shipIds.map((id) => [id, (list || {})[id] || 0]));
    save.profile.factionId = scenario.race || 'aegis';
    if (save.worldConfig) save.worldConfig.factionId = save.profile.factionId;
    home.name = scenario.homeName || 'Москва';
    home.fleet.ships = ships(scenario.ships);
    home.solarSatellites = 0;
    home.overpopulation = undefined;
    for (const key of Object.keys(home.buildings)) home.buildings[key] = Math.max(home.buildings[key] || 0, 1);
    home.buildings.shipyard = scenario.shipyard ?? 30;
    home.buildings.hangar = scenario.hangar ?? 30;
    home.buildings['advanced-factory'] = 30;
    home.buildings.research = 30;
    home.buildings.spaceport = 30;
    home.fleetProduction = { shipQueue: [], defenseQueue: [], commanderQueue: [] };
    for (let index = 0; index < (scenario.queue || 0); index += 1) {
      const startedAt = now + index * 3600000;
      home.fleetProduction.shipQueue.push({ id: 'qa-order-' + index, queueKind: 'ships', itemId: index % 2 ? 'scout' : 'cruiser', quantity: 1000, completedQuantity: 0, enqueuedAt: now, startedAt, finishAt: startedAt + 3600000, effectiveDurationMs: 3600, cost: { metal: 1, minerals: 1, gas: 1 }, refundEligible: true });
    }
    const level = scenario.science ?? 30;
    for (const id of Object.keys(save.science.levels)) save.science.levels[id] = level;
    save.science.queue = [];
    save.currentPlanetId = ${JSON.stringify(HOME)};
    const wallet = scenario.wallet || { metal: 900000000, minerals: 900000000, gas: 900000000 };
    home.resources = wallet;
    Object.assign(save, wallet);
    save.queues = { [${JSON.stringify(HOME)}]: [] };
    for (const [id, name, system, position] of scenario.colonies === false ? [] : ${JSON.stringify(COLONIES)}) {
      const planet = JSON.parse(JSON.stringify(home));
      Object.assign(planet, { name, universeGalaxy: 1, universeSystem: system, universePosition: position, skin: 'colonized', resources: wallet });
      planet.fleet.ships = ships({});
      planet.fleetProduction = { shipQueue: [], defenseQueue: [], commanderQueue: [] };
      save.planets[id] = planet;
      save.queues[id] = [];
      if (save.resourceClock?.byPlanet) save.resourceClock.byPlanet[id] = { ...(save.resourceClock.byPlanet[${JSON.stringify(HOME)}] || {}), lastReconciledAt: now };
    }
    save.flights = { records: [], requestIndex: {} };
    save.fleetUi = { favoriteTargets: [], ...(scenario.plans ? { plans: scenario.plans } : {}) };
    localStorage.setItem(${JSON.stringify(SAVE_KEY)}, JSON.stringify(save));
    localStorage.setItem('asterion.test-time-scale.v1', '1');
    setTimeout(() => window.location.reload(), 0);
    return true;
  })()`);
  if (!ok) throw new Error('Could not seed the fixture');
  await loaded;
  await waitFor(win, `document.querySelector('[data-qa-navigation="utility"]')`, 20000);
  await run(win, 'document.fonts?.ready');
  await settle(win, 300);
}

async function openPlanner(win) {
  await click(win, '[data-qa-planet-section="empire"]');
  await waitFor(win, `document.querySelector('[data-qa-empire-planner]')`);
  await click(win, '[data-qa-empire-planner]');
  await waitFor(win, `document.querySelector('[data-qa-fleet-planner]')`);
  await settle(win, 900);
}

const lineData = (win, id) => run(win, `(() => {
  const node = document.querySelector('[data-qa-fleet-plan-line=${JSON.stringify(id)}]');
  return node ? { state: node.dataset.qaFleetPlanLineState, missing: Number(node.dataset.qaFleetPlanLineMissing), target: Number(node.dataset.qaFleetPlanLineTarget), current: Number(node.dataset.qaFleetPlanLineCurrent) } : null;
})()`);

const savedSave = (win) => run(win, `JSON.parse(localStorage.getItem(${JSON.stringify(SAVE_KEY)}))`);

async function typeTarget(win, id, value) {
  await run(win, `(() => {
    const input = document.querySelector('[data-qa-fleet-plan-target=${JSON.stringify(id)}]');
    input.focus();
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(input, ${JSON.stringify(String(value))});
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.blur();
  })()`);
  await settle(win);
}

/** Inside the window, nothing cut or overlapping, one corner family, no native tooltips. */
async function checkLayout(win, label) {
  const report = await run(win, `(() => {
    const dialog = document.querySelector('[data-qa-fleet-planner]');
    if (!dialog) return { missing: true };
    const box = dialog.getBoundingClientRect();
    const problems = [];
    if (box.left < 0 || box.top < 0 || box.right > innerWidth + 0.5 || box.bottom > innerHeight + 0.5) problems.push('dialog outside the window');
    if (dialog.scrollWidth > dialog.clientWidth + 1) problems.push('dialog scrolls sideways');
    const close = dialog.querySelector('[data-qa-fleet-planner-close]').getBoundingClientRect();
    if (close.right < box.right - 40 || close.top > box.top + 40) problems.push('close is not top right');
    if (dialog.querySelector('[title]')) problems.push('native tooltip: ' + dialog.querySelector('[title]').getAttribute('title'));
    const lanes = dialog.querySelector('[data-qa-fleet-plan-lanes]');
    const list = lanes?.getBoundingClientRect();
    for (const lane of dialog.querySelectorAll('[data-qa-fleet-plan-line]')) {
      const cells = Array.from(lane.children).map((cell) => cell.getBoundingClientRect());
      for (let i = 1; i < cells.length; i += 1) if (cells[i].left < cells[i - 1].right - 1) problems.push('overlap in ' + lane.dataset.qaFleetPlanLine + ' cell ' + i);
      if (cells.at(-1).right > lane.getBoundingClientRect().right + 1) problems.push('line sticks out: ' + lane.dataset.qaFleetPlanLine);
    }
    for (const node of dialog.querySelectorAll('.fplan-lane__parts span, .fplan-lane__go, .fplan-lane__fill-value, .fplan__summary b, .fplan-hangar p > *, .fplan__btn')) {
      if (node.scrollWidth > node.clientWidth + 1 && !node.classList.contains('fplan-hangar__over')) problems.push('text cut: ' + node.textContent.trim().slice(0, 50));
    }
    const hangar = dialog.querySelector('.fplan-hangar p');
    if (hangar && hangar.scrollWidth > hangar.clientWidth + 1) problems.push('hangar line cut');
    for (const node of dialog.querySelectorAll('.fplan-lane__input')) {
      const canvas = document.createElement('canvas').getContext('2d');
      const style = getComputedStyle(node);
      canvas.font = style.fontWeight + ' ' + style.fontSize + ' ' + style.fontFamily;
      if (canvas.measureText(node.value).width > node.clientWidth - 8) problems.push('number too wide for its field: ' + node.value);
    }
    return { problems, lanes: dialog.querySelectorAll('[data-qa-fleet-plan-line]').length, listScroll: lanes ? lanes.scrollHeight - lanes.clientHeight : 0, listHeight: list ? Math.round(list.height) : 0 };
  })()`);
  if (report.missing) return fail(`${label}: planner is not open`);
  if (report.problems.length) fail(`${label}: layout`, report.problems);
  return report;
}

async function scene(win, directory, name, scenario, after) {
  await seed(win, scenario);
  await openPlanner(win);
  if (after) await after();
  const report = await checkLayout(win, name);
  await capture(win, directory, name);
  return report;
}

async function runViewport(win, directory) {
  const metrics = {};
  const homePlan = (plan) => ({ [HOME]: plan });
  const fleet = { scout: 180, defender: 300, battleship: 24, destroyer: 8, bomber: 240 };

  metrics.empty = await scene(win, directory, '01-empty-plan', { ships: fleet });
  check(await run(win, `Boolean(document.querySelector('[data-qa-fleet-plan-empty]'))`), 'An empty plan shows its own screen');
  check(await run(win, `document.querySelector('[data-qa-fleet-plan-start-all]').disabled`), 'Start all is disabled on an empty plan');

  metrics.owner = await scene(win, directory, '02-owner-plan', { ships: fleet, plans: homePlan(OWNER_PLAN), queue: 0 });
  const scout = await lineData(win, 'scout');
  check(scout?.missing === 120, 'Missing = target − ships', scout);
  check((await lineData(win, 'defender'))?.state === 'done', 'A reached target reads as done');
  const fill = await lineData(win, 'bomber');
  check(fill?.missing > 0, 'The fill line wants the rest of the hangar', fill);
  check(await run(win, `document.querySelector('[data-qa-fleet-plan-lanes]').lastElementChild.dataset.qaFleetPlanLine === 'bomber'`), 'The fill line is last');

  // One line: exactly the missing amount, and the line says so at once.
  await click(win, '[data-qa-fleet-plan-start="scout"]');
  const started = await lineData(win, 'scout');
  check(started?.missing === 0 && started?.current === 300, 'One click starts exactly the missing amount', started);
  check(await run(win, `/Запущено 120/.test(document.querySelector('[data-qa-fleet-plan-report]')?.textContent || '')`), 'The report names what started');
  await capture(win, directory, '03-after-one-line');
  await click(win, '[data-qa-fleet-plan-start-all]');
  await settle(win, 300);
  await capture(win, directory, '04-after-start-all');
  const afterAll = await run(win, `Array.from(document.querySelectorAll('[data-qa-fleet-plan-line]')).map((node) => [node.dataset.qaFleetPlanLine, Number(node.dataset.qaFleetPlanLineMissing)])`);
  check(afterAll.every(([, missing]) => missing === 0), 'Start all leaves nothing missing', afterAll);

  // Plan edits: typing a number, one fill line at most, reload keeps it all.
  await typeTarget(win, 'defender', 2000);
  check((await lineData(win, 'defender'))?.target === 2000, 'A typed number becomes the target');
  await click(win, '[data-qa-fleet-plan-fill="scout"]');
  const fills = await run(win, `document.querySelectorAll('.fplan-lane__fill.is-on').length`);
  check(fills === 1, 'One fill line at most', fills);
  await click(win, '[data-qa-fleet-plan-fill="bomber"]');
  await settle(win, 1300);
  const reloaded = new Promise((resolve) => win.webContents.once('did-finish-load', resolve));
  await run(win, 'setTimeout(() => window.location.reload(), 0); true');
  await reloaded;
  await waitFor(win, `document.querySelector('[data-qa-navigation="utility"]')`, 20000);
  await settle(win, 300);
  const stored = (await savedSave(win)).fleetUi?.plans?.[HOME];
  check(stored?.targets?.defender === 2000 && stored?.targets?.scout > 0 && stored?.fillShipId === 'bomber', 'The edited plan is in the save', stored);
  const queue = (await savedSave(win)).planets[HOME].fleetProduction.shipQueue;
  check(queue.length >= 3, 'All started orders survive the reload', queue.map((order) => order.itemId));

  // Several lines one after another, with clock ticks between them: none is lost.
  await seed(win, { ships: {}, plans: homePlan({ targets: { scout: 11, defender: 12, cruiser: 13, battleship: 14, bomber: 15, recycler: 16 } }) });
  await openPlanner(win);
  const raceIds = ['scout', 'defender', 'cruiser', 'battleship', 'bomber', 'recycler'];
  await run(win, `new Promise((resolve) => {
    const ids = ${JSON.stringify(raceIds)};
    document.querySelector('[data-qa-fleet-plan-start=' + JSON.stringify(ids[0]) + ']').click();
    document.querySelector('[data-qa-fleet-plan-start=' + JSON.stringify(ids[1]) + ']').click();
    let index = 2;
    const timer = setInterval(() => {
      if (index >= ids.length) { clearInterval(timer); resolve(); return; }
      document.querySelector('[data-qa-fleet-plan-start=' + JSON.stringify(ids[index]) + ']').click();
      index += 1;
    }, 370);
  })`);
  await settle(win, 1300);
  const raceLines = await Promise.all(raceIds.map((id) => lineData(win, id)));
  check(raceLines.every((line) => line?.missing === 0), 'Lines started in a row across ticks: none lost', raceLines);
  const raceReload = new Promise((resolve) => win.webContents.once('did-finish-load', resolve));
  await run(win, 'setTimeout(() => window.location.reload(), 0); true');
  await raceReload;
  await waitFor(win, `document.querySelector('[data-qa-navigation="utility"]')`, 20000);
  await settle(win, 300);
  const raceQueue = (await savedSave(win)).planets[HOME].fleetProduction.shipQueue.map((order) => [order.itemId, order.quantity]);
  check(raceIds.every((id, index) => raceQueue.some(([itemId, quantity]) => itemId === id && quantity === 11 + (id === 'scout' ? 0 : id === 'defender' ? 1 : id === 'cruiser' ? 2 : id === 'battleship' ? 3 : id === 'bomber' ? 4 : 5))), 'Lines started in a row: all in the saved queue', raceQueue);

  metrics.all = await scene(win, directory, '05-all-ship-types', { ships: { scout: 500, defender: 200, 'death-star': 1 }, plans: homePlan({ targets: Object.fromEntries(ALL_SHIPS.filter((id) => id !== 'bomber').map((id, index) => [id, 500 + index * 700])), fillShipId: 'bomber' }) });
  check(metrics.all.lanes === 13, 'All 13 types can be planned', metrics.all);

  metrics.huge = await scene(win, directory, '06-millions', {
    ships: { scout: 12_500_000, defender: 3_400_000, battleship: 980_000, bomber: 1_450_000 },
    wallet: { metal: 4_500_000_000_000, minerals: 3_100_000_000_000, gas: 2_000_000_000_000 },
    plans: homePlan({ targets: { scout: 25_000_000, defender: 15_000_000, cruiser: 7_777_777, battleship: 2_000_000, destroyer: 1_000_000 }, fillShipId: 'bomber' }),
  });

  metrics.over = await scene(win, directory, '07-plan-bigger-than-hangar', { hangar: 3, ships: { scout: 40 }, plans: homePlan(OWNER_PLAN) });
  check(await run(win, `/больше ангара на/.test(document.querySelector('[data-qa-fleet-plan-over-text]')?.textContent || '')`), 'A plan over the hangar says it in numbers');
  check(await run(win, `Number(document.querySelector('[data-qa-fleet-plan-hangar]').dataset.qaFleetPlanOver) > 0`), 'Over amount is exposed');

  metrics.noYard = await scene(win, directory, '08-no-shipyard', { shipyard: 0, ships: {}, plans: homePlan(OWNER_PLAN) });
  check(await run(win, `Boolean(document.querySelector('[data-qa-fleet-plan-no-yard]'))`), 'No shipyard is said plainly');
  check(await run(win, `!document.querySelector('[data-qa-fleet-plan-start]')`), 'No shipyard: no start buttons');
  check(await run(win, `document.querySelector('[data-qa-fleet-plan-line-reason]')?.textContent.trim().length > 0`), 'No shipyard: the line shows the reason');

  metrics.noMoney = await scene(win, directory, '09-no-resources', { wallet: { metal: 0, minerals: 0, gas: 0 }, ships: fleet, plans: homePlan(OWNER_PLAN) });
  check(await run(win, `!document.querySelector('[data-qa-fleet-plan-start]')`), 'No resources: nothing to click on a line');
  check(await run(win, `document.querySelector('[data-qa-fleet-plan-start-all]').disabled`), 'No resources: start all is off');

  metrics.partial = await scene(win, directory, '10-partly-affordable', { wallet: { metal: 900000, minerals: 500000, gas: 300000 }, ships: { scout: 900 }, plans: homePlan(OWNER_PLAN) });
  await click(win, '[data-qa-fleet-plan-start-all]');
  await settle(win, 300);
  check(await run(win, `(document.querySelector('[data-qa-fleet-plan-report-warn]')?.textContent || '').length > 0`), 'Partly affordable: the report says what is short');
  await capture(win, directory, '11-partly-after-start');
  await checkLayout(win, '11-partly-after-start');

  metrics.queue = await scene(win, directory, '12-long-queue', { queue: 40, ships: fleet, plans: homePlan(OWNER_PLAN) });

  metrics.locked = await scene(win, directory, '13-requirements-not-met', { science: 0, ships: {}, plans: homePlan(OWNER_PLAN) });
  check(await run(win, `document.querySelectorAll('[data-qa-fleet-plan-line-state="locked"]').length > 0`), 'Locked lines exist in this scene');

  for (const race of ['synod', 'veyra']) {
    await scene(win, directory, `14-race-${race}`, { race, homeName: 'Ферон Великая Северная Колония Бета', ships: { scout: 300, cruiser: 12 }, plans: homePlan({ targets: Object.fromEntries(ALL_SHIPS.filter((id) => id !== 'bomber').map((id, index) => [id, 40 + index * 90])), fillShipId: 'bomber' }) });
    await click(win, `[data-qa-fleet-planner-close]`);
    await settle(win);
    await openEmpty(win, directory, race);
  }

  // Copy: from another planet, one click, can be undone.
  await seed(win, { ships: fleet, plans: { 'planet-1-1-6': OWNER_PLAN, 'planet-1-3-9': { targets: { scout: 5 } } } });
  await openPlanner(win);
  await click(win, '[data-qa-fleet-plan-copy]');
  await settle(win, 400);
  await capture(win, directory, '16-copy-list');
  await click(win, '[data-qa-fleet-plan-copy-from="planet-1-1-6"]');
  check((await lineData(win, 'scout'))?.target === 300, 'Copy brings the other planet\'s numbers');
  await click(win, '[data-qa-fleet-plan-planet="planet-1-3-9"]');
  await settle(win, 400);
  await click(win, '[data-qa-fleet-plan-copy]');
  await click(win, `[data-qa-fleet-plan-copy-from="${HOME}"]`);
  await settle(win, 200);
  check((await lineData(win, 'defender'))?.target === 300, 'Copy replaces the plan on the second planet');
  check(await run(win, `Boolean(document.querySelector('[data-qa-fleet-plan-undo]'))`), 'Replacing a plan offers undo');
  await capture(win, directory, '17-copy-replaced-undo');
  await click(win, '[data-qa-fleet-plan-undo]');
  check((await lineData(win, 'defender')) === null, 'Undo brings the old plan back');
  await click(win, '[data-qa-fleet-planner-close]');
  check(await run(win, `!document.querySelector('[data-qa-fleet-planner]')`), 'The close button closes');

  // The glance in «Империя».
  await seed(win, { ships: fleet, plans: { [HOME]: OWNER_PLAN, 'planet-1-1-6': { targets: { scout: 1 } }, 'planet-1-3-9': { targets: { scout: 1e9 } } } });
  await click(win, '[data-qa-planet-section="empire"]');
  await waitFor(win, `document.querySelectorAll('[data-qa-empire-row]').length === 7`);
  await settle(win, 500);
  check(await run(win, `Number(document.querySelector('[data-qa-empire-plan="${HOME}"]').dataset.qaEmpirePlanMissing) > 0`), 'Империя shows what is missing');
  await capture(win, directory, '18-empire-glance');
  await click(win, `[data-qa-empire-more="${HOME}"]`);
  await settle(win, 600);
  await capture(win, directory, '19-empire-open-row');
  await click(win, `[data-qa-empire-plan-start="${HOME}"]`);
  await settle(win, 300);
  check(await run(win, `Number(document.querySelector('[data-qa-empire-plan="${HOME}"]').dataset.qaEmpirePlanMissing) === 0`), 'Империя can start the whole plan');
  await click(win, `[data-qa-empire-plan="planet-1-3-9"]`);
  await waitFor(win, `document.querySelector('[data-qa-fleet-planner="planet-1-3-9"]')`);
  await settle(win, 900);
  await capture(win, directory, '20-opened-from-empire');

  // The order picker of «Империя» knows the plan and opens the planner.
  await seed(win, { ships: fleet, plans: homePlan(OWNER_PLAN) });
  await click(win, '[data-qa-planet-section="empire"]');
  await waitFor(win, `document.querySelector('[data-qa-empire-order="${HOME}"]')`);
  await click(win, `[data-qa-empire-more="${HOME}"]`);
  await settle(win, 500);
  await click(win, '[data-qa-empire-yard-open="ships"]');
  await waitFor(win, `document.querySelector('[data-qa-empire-yard-planner]')`);
  check(await run(win, `Number(document.querySelector('[data-qa-empire-produce-item="scout"]').dataset.qaEmpireProduceLacking) === 120`), 'The order list shows what the plan lacks');
  await click(win, '[data-qa-empire-produce-item="scout"]');
  check(await run(win, `document.querySelector('[data-qa-empire-produce-qty]').value === '120'`), 'The order starts at the missing number');
  await capture(win, directory, '21-order-picker');
  await click(win, '[data-qa-empire-yard-planner]');
  await waitFor(win, `document.querySelector('[data-qa-fleet-planner]')`);
  await click(win, '[data-qa-fleet-planner-close]');

  // A fleet on a mission counts as «в рейсе» and is not ordered again.
  await seed(win, { ships: fleet, plans: homePlan(OWNER_PLAN) });
  await run(win, `window.__planFlight = null; window.addEventListener('asterion:flight-command-result', (event) => { window.__planFlight = event.detail?.ok ? 'ok' : JSON.stringify(event.detail?.error); }); window.dispatchEvent(new CustomEvent('asterion:flight-dispatch-request', { detail: {
    missionId: 'transport', originPlanetId: ${JSON.stringify(HOME)}, targetRelation: 'self',
    destination: { kind: 'planet', planetId: 'planet-1-1-6', coordinate: { galaxy: 1, system: 1, position: 6 } },
    cargo: { metal: 100, minerals: 0, gas: 0, debris: 0 }, selectedShips: { scout: 60 }, selectedCommanders: {},
  } })); true`);
  await settle(win, 400);
  await openPlanner(win);
  const flying = await run(win, `Number(document.querySelector('[data-qa-fleet-plan-line="scout"] [data-qa-fleet-plan-line-away]')?.dataset.qaFleetPlanLineAway ?? 0)`);
  check(flying === 60, 'A fleet on a mission shows as «в рейсе»', { flying, result: await run(win, 'window.__planFlight') });
  check((await lineData(win, 'scout'))?.missing === 120, 'A fleet on a mission is not ordered again', await lineData(win, 'scout'));
  await checkLayout(win, '23-fleet-in-flight');
  await capture(win, directory, '23-fleet-in-flight');

  // A stress beyond the catalogue: 24 lines (the game has 13), the list scrolls and nothing breaks.
  await seed(win, { ships: fleet, plans: homePlan({ targets: Object.fromEntries(ALL_SHIPS.map((id, index) => [id, 500 + index * 700])) }) });
  await openPlanner(win);
  await run(win, `(() => {
    const list = document.querySelector('[data-qa-fleet-plan-lanes]');
    for (const node of Array.from(list.children).slice(0, 11)) list.append(node.cloneNode(true));
  })()`);
  await settle(win, 400);
  metrics.stress = await checkLayout(win, '22-24-lines');
  check(metrics.stress.lanes === 24 && metrics.stress.listScroll > 0, 'Many lines scroll inside the list', metrics.stress);
  await capture(win, directory, '22-24-lines');

  return metrics;
}

async function openEmpty(win, directory, race) {
  await seed(win, { race, ships: { scout: 40 } });
  await openPlanner(win);
  await checkLayout(win, `15-empty-${race}`);
  await capture(win, directory, `15-empty-${race}`);
}

app.whenReady().then(async () => {
  let win;
  try {
    fs.mkdirSync(OUTPUT, { recursive: true });
    win = new BrowserWindow({
      width: 1000, height: 700, show: false, backgroundColor: '#02050a',
      webPreferences: { offscreen: true, contextIsolation: true, nodeIntegration: false, sandbox: true, partition: 'qa-fleet-planner' },
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
    if (failures.length) { console.error(`[planner-qa] ${failures.length} check(s) failed`); app.exit(1); return; }
    console.log('[planner-qa] all checks passed');
    app.exit(0);
  } catch (error) {
    console.error(error);
    if (failures.length) console.error(JSON.stringify(failures));
    try { if (win?.webContents.debugger.isAttached()) win.webContents.debugger.detach(); } catch {}
    win?.destroy();
    app.exit(1);
  }
});
