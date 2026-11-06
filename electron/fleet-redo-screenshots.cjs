// Screenshots of the Fleets section at 1920×1080 and 1280×720 (run in CI, never on the player's PC).
//
//   npx electron electron/fleet-redo-screenshots.cjs --dist=<built dist> --out=<dir> [--before]
//
// Worst cases: three races, 9-digit fleets, 8-digit costs, no ships, nothing
// affordable, locked units, a busy queue, a mission without ships, a long planet
// name, a planet without a shipyard. --before keeps to the frames the old screen
// can show, on the same fixtures. Every "after" frame also checks that no text
// inside a row or a tile is cut or runs over its neighbour.
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
const BEFORE = Boolean(args.before);
const OUTPUT = path.resolve(args.out || path.join(ROOT, 'visual-qa', 'fleet-redo', BEFORE ? 'before' : 'after'));
const SAVE_KEY = 'asterion.vertical-slice.test.v1';
const TEST_TIME_SCALE_KEY = 'asterion.test-time-scale.v1';
const VIEWPORTS = args.viewport ? [args.viewport.split('x').map(Number)] : [[1920, 1080], [1280, 720]];
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const run = (win, source) => win.webContents.executeJavaScript(source);
const problems = [];

async function waitFor(win, expression, timeoutMs = 20_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await run(win, `Boolean(${expression})`)) return;
    await sleep(60);
  }
  throw new Error(`Timed out waiting for: ${expression}`);
}

// Hidden windows do not advance CSS animations: finish the finite ones.
async function settle(win, ms = 200) {
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

async function clickAll(win, selector) {
  await run(win, `document.querySelectorAll(${JSON.stringify(selector)}).forEach((element) => { if (!element.disabled) element.click(); })`);
  await settle(win, 120);
}

async function hover(win, selector) {
  const point = await run(win, `(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    if (!element) return null;
    const rect = element.getBoundingClientRect();
    return { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2) };
  })()`);
  if (!point) throw new Error(`Hover target not found: ${selector}`);
  await win.webContents.debugger.sendCommand('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 1, y: 1 });
  await sleep(60);
  await win.webContents.debugger.sendCommand('Input.dispatchMouseEvent', { type: 'mouseMoved', ...point });
  await sleep(320);
}

async function audit(win, name, label) {
  const found = await run(win, `(() => {
    const issues = [];
    const scope = '.fleet-workspace-v1, [data-qa-flight-preview-backdrop]';
    for (const host of document.querySelectorAll(scope)) {
      for (const node of host.querySelectorAll('h2,h3,p,small,strong,b,em,span,dd,button,time')) {
        if (node.closest('[role="tooltip"], .shipyard-stats-tooltip-v1, .fc-tip, .fc-wing > h3, .fc-ship__art, .fc-dock__status') || node.querySelector(':scope > .fc-tip')) continue;
        const style = getComputedStyle(node);
        if (style.display === 'none' || style.visibility === 'hidden' || style.display === 'inline') continue;
        if (node.scrollWidth > node.clientWidth + 2 && node.clientWidth > 0) issues.push({ cut: node.tagName + '.' + node.className, text: node.textContent.trim().slice(0, 50), scroll: node.scrollWidth, client: node.clientWidth });
      }
      // Sibling cells of a row must not overlap.
      for (const row of host.querySelectorAll('.fc-unit, .fc-ship')) {
        const cells = [...row.children].filter((cell) => cell.getBoundingClientRect().width > 0 && !cell.matches('.shipyard-stats-tooltip-v1, .fc-ship__art, .fc-unit__info'));
        for (let i = 0; i < cells.length; i += 1) for (let j = i + 1; j < cells.length; j += 1) {
          const a = cells[i].getBoundingClientRect();
          const b = cells[j].getBoundingClientRect();
          if (a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1) issues.push({ overlap: [cells[i].className, cells[j].className], row: row.getAttribute('data-qa-fleet-production-item') || row.getAttribute('data-qa-fleet-ship') || row.getAttribute('data-qa-repair-card') });
        }
      }
    }
    const dialog = document.querySelector('.flight-briefing-v2');
    if (dialog) {
      const edge = dialog.getBoundingClientRect();
      for (const node of dialog.querySelectorAll('button, input:not(.game-select__native), .game-select__trigger')) {
        const rect = node.getBoundingClientRect();
        if (rect.width > 0 && rect.right > edge.right - 8) issues.push({ outsideDialog: node.className || node.tagName, text: node.textContent.trim().slice(0, 20) });
      }
    }
    const page = document.documentElement;
    if (page.scrollWidth > innerWidth + 2) issues.push({ horizontalOverflow: page.scrollWidth });
    return issues.slice(0, 12);
  })()`);
  if (found.length) {
    problems.push({ label, name, found });
    console.log(`[audit] ${label}/${name}: ${JSON.stringify(found)}`);
  }
}

// The flight plan for every mission that changes its layout: cargo or none, a target list or typed coordinates.
async function planScenes(win, directory, label) {
  await seed(win, { mutate: `${COLONY} planet.fleet.ships = { ...planet.fleet.ships, 'mega-transporter': 40 };` });
  await openRoot(win);
  const fill = async (field, value) => {
    await run(win, `(() => { const n = document.querySelector('[name="flight-preview-target-${field}"]'); if (!n) return; Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(n, ${JSON.stringify(String(value))}); n.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  };
  for (const [mission, target] of [['transport', 'own'], ['deployment', 'own'], ['space-flight', null], ['attack', 'typed'], ['espionage', 'typed'], ['colonize', 'typed'], ['recycle', 'typed'], ['gas', 'typed'], ['expedition', null], ['pirate-elimination', null], ['sun-support', null]]) {
    await click(win, `[data-qa-mission-id="${mission}"]`);
    await click(win, '[data-qa-fleet-select-all]');
    if (await run(win, `Boolean(document.querySelector('[data-qa-flight-preview-open]')?.disabled)`)) { console.log('[plan] no launch for', mission); continue; }
    await click(win, '[data-qa-flight-preview-open]');
    await waitFor(win, `document.querySelector('[data-qa-flight-preview-backdrop]')`);
    await capture(win, directory, `plan-${mission}-1-no-target`, label);
    if (target === 'own') {
      await run(win, `(() => { const s = document.querySelector('.flight-briefing-v2__left .game-select__native:not([data-qa-flight-source-select])'); const v = [...s.options].find((o) => o.value && !o.disabled)?.value; Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(s, v); s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
      await capture(win, directory, `plan-${mission}-2-target`, label);
    } else if (target === 'typed') {
      await fill('galaxy', 1);
      await fill('system', 2);
      await fill('position', 7);
      await settle(win);
      await capture(win, directory, `plan-${mission}-2-target`, label);
    }
    await click(win, '[data-qa-flight-preview-cancel]');
    await waitFor(win, `!document.querySelector('[data-qa-flight-preview-backdrop]')`);
  }
}

const INFLATE = `(() => {
  // The save loader clamps a fleet to its hangar, so 9-digit fleets and 8-digit
  // prices cannot come from a save: the longest realistic strings go straight
  // into the rendered screen to prove the layout holds them.
  const set = (node, value) => { if (node) node.textContent = value; };
  document.querySelectorAll('[data-qa-fleet-owned]').forEach((node) => set(node, '987 654 321'));
  document.querySelectorAll('.fc-ship__amount input').forEach((node) => { node.value = '987654321'; });
  document.querySelectorAll('[data-qa-unit-owned]').forEach((node) => set(node, '987 654 321'));
  document.querySelectorAll('.fc-unit__cost dd').forEach((node) => set(node, '88 888 888'));
  document.querySelectorAll('.fc-unit__amount input').forEach((node) => { if (node.type === 'number') node.value = '987654321'; });
  document.querySelectorAll('[data-qa-unit-can-build]').forEach((node) => set(node, 'можно до 987 654 321'));
  document.querySelectorAll('.fc-unit__stock').forEach((node) => { if (!node.querySelector('em')) { const em = document.createElement('em'); em.textContent = '+987 654 321 строится'; node.append(em); } });
  document.querySelectorAll('.fleet-production-order-main-v1 small').forEach((node) => set(node, 'осталось 123 456 789 из 987 654 321'));
  document.querySelectorAll('.fc-dock > div > b').forEach((node) => set(node, '987 654 321'));
})()`;

async function capture(win, directory, name, label) {
  await run(win, `document.querySelectorAll('.runtime-toast-stack').forEach((n) => { n.style.visibility = ${JSON.stringify(name === 'root-01-normal' ? 'visible' : 'hidden')}; })`);
  await settle(win);
  await sleep(250);
  const result = await win.webContents.debugger.sendCommand('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: false });
  fs.writeFileSync(path.join(directory, `${name}.png`), Buffer.from(result.data, 'base64'));
  console.log(`[shots] ${path.relative(ROOT, path.join(directory, name))}.png`);
  if (!BEFORE) await audit(win, name, label);
}

async function emulate(win, width, height) {
  win.webContents.debugger.attach('1.3');
  await win.webContents.debugger.sendCommand('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false, screenWidth: width, screenHeight: height });
}

/** `mutate` is page-side code over `save`, `planet` and `now`. */
async function seed(win, { race = 'aegis', mutate = '' } = {}) {
  const ok = await editSaveIdle(win, `(() => {
    const save = JSON.parse(localStorage.getItem(${JSON.stringify(SAVE_KEY)}) || 'null');
    const planet = save?.planets?.['helion-01'];
    if (!save || !planet?.buildings) return false;
    const now = Date.now();
    if (save.profile) save.profile.factionId = ${JSON.stringify(race)};
    planet.name = 'Москва';
    planet.buildings.shipyard = 20;
    planet.buildings.hangar = 20;
    planet.buildings['advanced-factory'] = 10;
    planet.buildings.spaceport = 10;
    planet.resources = { ...(planet.resources || {}), metal: 40_000_000, minerals: 40_000_000, gas: 40_000_000 };
    save.metal = 40_000_000;
    save.minerals = 40_000_000;
    save.gas = 40_000_000;
    save.science = save.science || { levels: {}, queue: [] };
    save.science.levels = Object.fromEntries(Array.from({ length: 21 }, (_, i) => [i + 1, 15]));
    save.resourceClock = { lastReconciledAt: now, remainder: { metal: 0, minerals: 0, gas: 0, energy: 0 } };
    planet.fleet.ships = { ...planet.fleet.ships, 'spy-probe': 8, scout: 94, battleship: 430, destroyer: 167, bomber: 2, transporter: 1250, recycler: 77, colonizer: 3, cruiser: 500, defender: 40 };
    planet.fleet.commanders = { ...planet.fleet.commanders, corsair: 1, judge: 1 };
    save.schemaVersion = Math.max(Number(save.schemaVersion) || 0, 13);
    ${mutate}
    localStorage.setItem(${JSON.stringify(SAVE_KEY)}, JSON.stringify(save));
    localStorage.setItem(${JSON.stringify(TEST_TIME_SCALE_KEY)}, '1');
    return true;
  })()`, { ready: `document.querySelector('[data-qa-navigation]')`, label: 'fixture' });
  if (!ok) throw new Error('Could not seed the save');
  await waitFor(win, `document.querySelector('[data-qa-navigation="utility"]')`);
  await settle(win);
}

async function openRoot(win) {
  await click(win, '[data-qa-route="fleets"]');
  await waitFor(win, `document.querySelector('[data-qa-fleet-root]')`);
  await settle(win);
}

async function openSection(win, section, ready) {
  await openRoot(win);
  await click(win, `[data-qa-fleet-section="${section}"]`);
  await waitFor(win, `document.querySelector(${JSON.stringify(ready)})`);
  await settle(win);
}

const queueOf = (kind, ids) => `(() => {
  let finishAt = now;
  return [${ids.map(([itemId, quantity], index) => `(() => { const startedAt = finishAt; finishAt = startedAt + 2000 * ${quantity}; return {
    id: 'qa-order-${index}', queueKind: '${kind}', itemId: '${itemId}', quantity: ${quantity}, completedQuantity: 0,
    enqueuedAt: now, startedAt, finishAt, effectiveDurationMs: 2000, cost: { metal: 1, minerals: 1, gas: 0 }, refundEligible: true,
  }; })()`).join(',')}];
})()`;

const HUGE_FLEET = `planet.fleet.ships = { ...planet.fleet.ships, 'spy-probe': 123456789, scout: 987654321, battleship: 456789012, destroyer: 111222333, bomber: 99999999, transporter: 999999999, 'mega-transporter': 876543210, recycler: 765432109, colonizer: 654321098, cruiser: 543210987, defender: 432109876, 'death-star': 12345678 };`;
const COLONY = `{
  const colony = JSON.parse(JSON.stringify(planet));
  colony.id = 'qa-colony-01';
  colony.name = 'Колония с очень длинным названием для проверки';
  colony.universeGalaxy = planet.universeGalaxy;
  colony.universeSystem = planet.universeSystem;
  colony.universePosition = planet.universePosition === 2 ? 3 : 2;
  save.planets['qa-colony-01'] = colony;
}`;

async function rootScenes(win, directory, label) {
  const shot = (name) => capture(win, directory, name, label);
  await seed(win);
  await openRoot(win);
  await shot('root-01-normal');

  if (BEFORE) return;
  await clickAll(win, '[data-qa-fleet-ship="battleship"] .fc-ship__amount button:last-of-type, [data-qa-fleet-ship="scout"] .fc-ship__amount button:last-of-type');
  await click(win, '[data-qa-mission-id="attack"]');
  await shot('root-02-attack-picked');

  await seed(win, { mutate: `${HUGE_FLEET} planet.name = 'Новая Константинополия-на-Орбите Великой Туманности';` });
  await openRoot(win);
  await click(win, '[data-qa-fleet-select-all]');
  await seed(win, { mutate: `planet.name = 'Новая Константинополия-на-Орбите Великой Туманности';` });
  await openRoot(win);
  await click(win, '[data-qa-fleet-select-all]');
  await run(win, INFLATE);
  await shot('root-03-huge-long-name');

  await seed(win, { mutate: `planet.fleet.ships = Object.fromEntries(Object.keys(planet.fleet.ships).map((id) => [id, 0])); planet.fleet.commanders = Object.fromEntries(Object.keys(planet.fleet.commanders).map((id) => [id, 0]));` });
  await openRoot(win);
  await shot('root-04-no-ships');

  await seed(win, { mutate: `planet.fleet.ships = Object.fromEntries(Object.keys(planet.fleet.ships).map((id) => [id, id === 'transporter' ? 5 : 0]));` });
  await openRoot(win);
  await click(win, '[data-qa-mission-id="recycle"]');
  await shot('root-05-mission-without-ships');

  // The QA runners open a 1008×655 window, with the flights list expanded and four ships.
  await seed(win, { mutate: `planet.fleet.ships = Object.fromEntries(Object.keys(planet.fleet.ships).map((id) => [id, ['spy-probe', 'colonizer', 'recycler', 'scout'].includes(id) ? 5 : 0]));` });
  await openRoot(win);
  await click(win, '[data-qa-flights-toggle]');
  await shot('root-07-flights-open');
  if (await run(win, `Boolean(document.querySelector('[data-qa-bot01-scenario]:not(:disabled)'))`)) {
    await click(win, '[data-qa-bot01-scenario]');
    await sleep(600);
    await shot('root-08-flights-incoming');
  }

  await seed(win, { mutate: COLONY });
  await openRoot(win);
  await click(win, '[data-qa-mission-id="space-flight"]');
  await shot('root-06-space-flight');
  await click(win, '[data-qa-mission-id="transport"]');
  await clickAll(win, '[data-qa-fleet-ship="transporter"] .fc-ship__amount button:last-of-type');
  await click(win, '[data-qa-flight-preview-open]');
  await waitFor(win, `document.querySelector('[data-qa-flight-preview-backdrop]')`);
  await shot('plan-01-transport');
  await click(win, '[data-qa-transport-target-select] [data-qa-game-select-trigger]');
  await shot('plan-02-dropdown-open');
  await click(win, '[data-qa-flight-preview-cancel]');
}

async function catalogueScenes(win, directory, label) {
  const shot = (name) => capture(win, directory, name, label);
  await seed(win);
  await openSection(win, 'ships', '[data-qa-construction-mode="ships"]');
  await shot('ships-01-normal');
  await openSection(win, 'defense', '[data-qa-construction-mode="defense"]');
  await shot('defense-01-normal');
  await openSection(win, 'commander-ships', '[data-qa-construction-mode="commander"]');
  await shot('commanders-01-normal');
  await seed(win, { mutate: `planet.repair = { tokens: 12, ships: { scout: 12, battleship: 450, 'mega-transporter': 3 }, defenses: { 'ballistic-turret': 80 } };` });
  await openSection(win, 'repair', '[data-qa-repair-card]');
  await shot('repair-01-units');
  await openSection(win, 'combat-priority', '.combat-priority-view-v1');
  await shot('priority-01');
  if (BEFORE) return;

  await openSection(win, 'battles', '.battle-view-v1');
  await shot('battles-01-shell');
  await openSection(win, 'simulator', '.simulator-view-v1');
  await shot('simulator-01-shell');
  const setSim = async (side, id, value) => run(win, `(() => {
    const input = document.querySelector('[id="sim-${side}-ships"] [data-qa-simulator-unit="${id}"] .sim-count-control-v1 input');
    if (!input) return false;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, '${value}');
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    input.dispatchEvent(new Event('blur', { bubbles: true }));
    return true;
  })()`);
  for (const [side, id, value] of [['attacker', 'cruiser', 500], ['attacker', 'battleship', 430], ['attacker', 'destroyer', 167], ['attacker', 'scout', 94], ['defender', 'cruiser', 300], ['defender', 'battleship', 260], ['defender', 'destroyer', 80]]) await setSim(side, id, value);
  await settle(win);
  await shot('simulator-02-editing');
  if (await run(win, `Boolean(document.querySelector('.sim-run-v1:not(:disabled)'))`)) {
    await click(win, '.sim-run-v1');
    await settle(win, 1400);
    await shot('simulator-03-result');
  }

  await seed(win, { mutate: `planet.fleetProduction.shipQueue = ${queueOf('ships', [['battleship', 100], ['destroyer', 50], ['scout', 8], ['transporter', 100], ['recycler', 5], ['colonizer', 1]])};` });
  await openSection(win, 'ships', '[data-qa-construction-mode="ships"]');
  await shot('ships-02-busy-queue');
  await run(win, INFLATE);
  await shot('ships-02b-huge-numbers');
  await hover(win, '[data-qa-fleet-production-item="transporter"] .fc-unit__art');
  await shot('ships-03-stats-hover');
  await run(win, 'window.scrollTo(0, document.documentElement.scrollHeight)');
  await settle(win);
  await shot('ships-04-scrolled-to-end');
  await run(win, 'window.scrollTo(0, 0)');

  await seed(win, { mutate: `planet.resources = { ...planet.resources, metal: 0, minerals: 0, gas: 0 }; save.metal = 0; save.minerals = 0; save.gas = 0;` });
  await openSection(win, 'ships', '[data-qa-construction-mode="ships"]');
  await shot('ships-05-nothing-affordable');

  await seed(win, { mutate: `planet.buildings.shipyard = 2; save.science.levels = {};` });
  await openSection(win, 'ships', '[data-qa-construction-mode="ships"]');
  await shot('ships-06-locked');
  await openSection(win, 'defense', '[data-qa-construction-mode="defense"]');
  await shot('defense-02-locked');
  await openSection(win, 'commander-ships', '[data-qa-construction-mode="commander"]');
  await shot('commanders-02-locked');

  await seed(win, { mutate: `planet.buildings.shipyard = 0; planet.name = 'Новая Константинополия-на-Орбите Великой Туманности';` });
  await openSection(win, 'ships', '[data-qa-construction-mode="ships"]');
  await shot('ships-07-no-shipyard');
}

async function raceScenes(win, directory, label) {
  for (const race of ['synod', 'veyra']) {
    await seed(win, { race });
    await openRoot(win);
    await capture(win, directory, `race-${race}-root`, label);
    await click(win, '[data-qa-fleet-section="ships"]');
    await waitFor(win, `document.querySelector('[data-qa-construction-mode="ships"]')`);
    await capture(win, directory, `race-${race}-ships`, label);
    await click(win, '[data-qa-fleet-section="defense"]');
    await waitFor(win, `document.querySelector('[data-qa-construction-mode="defense"]')`);
    await capture(win, directory, `race-${race}-defense`, label);
  }
}

async function runViewport(width, height) {
  const label = `${width}x${height}`;
  const directory = path.join(OUTPUT, label);
  fs.mkdirSync(directory, { recursive: true });
  const win = new BrowserWindow({ width, height, useContentSize: true, show: false, backgroundColor: '#02050a', webPreferences: { offscreen: true, sandbox: false, backgroundThrottling: false, partition: `qa-fleet-redo-${label}${BEFORE ? '-before' : ''}` } });
  await win.loadFile(path.join(DIST, 'index.html'), { search: '?mode=test' });
  await emulate(win, width, height);
  await waitFor(win, `document.querySelector('[data-qa-navigation="utility"]')`);
  if (args.only === 'plan') {
    await seed(win);
    await openRoot(win);
    await capture(win, directory, 'root-01-normal', label);
    await planScenes(win, directory, label);
    win.destroy();
    return;
  }
  await rootScenes(win, directory, label);
  await catalogueScenes(win, directory, label);
  if (!BEFORE) await raceScenes(win, directory, label);
  win.destroy();
}

app.whenReady().then(async () => {
  try {
    for (const [width, height] of VIEWPORTS) await runViewport(width, height);
    fs.writeFileSync(path.join(OUTPUT, 'audit.json'), JSON.stringify(problems, null, 1));
    console.log(`[audit] frames with problems: ${problems.length}`);
    app.exit(0);
  } catch (error) {
    console.error(error.stack || error);
    app.exit(1);
  }
});
