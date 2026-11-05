// Screenshots of the Simulator at 1280×720 and 1920×1080 (run in CI, never on the player's PC).
//
//   npx electron electron/simulator-redo-screenshots.cjs --dist=<built dist> --out=<dir> [--before]
//
// Worst cases: all three races, every ship and defence, huge numbers, empty sides,
// a long battle, a draw, a commander on each side, a long scenario name, no saved
// scenarios. Every "after" frame checks that no text is cut or runs over a number.
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
const OUTPUT = path.resolve(args.out || path.join(ROOT, 'visual-qa', 'simulator-redo', BEFORE ? 'before' : 'after'));
const SAVE_KEY = 'asterion.vertical-slice.test.v1';
const VIEWPORTS = args.viewport ? [args.viewport.split('x').map(Number)] : [[1280, 720], [1920, 1080]];
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const run = (win, source) => win.webContents.executeJavaScript(source);
const problems = [];
const notes = [];
const A = '[data-qa-sim-side="attacker"]';
const D = '[data-qa-sim-side="defender"]';

async function waitFor(win, expression, timeoutMs = 20_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await run(win, `Boolean(${expression})`)) return;
    await sleep(60);
  }
  throw new Error(`Timed out waiting for: ${expression}`);
}

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
  await settle(win, 100);
}

// Tiles leave the shelf as they are clicked, so each click takes the first one left.
async function addAll(win, scope) {
  for (let guard = 0; guard < 40; guard += 1) {
    const clicked = await run(win, `(() => { const tile = document.querySelector(${JSON.stringify(`${scope} [data-qa-simulator-add]:not(:disabled)`)}); if (!tile) return false; tile.click(); return true; })()`);
    if (!clicked) break;
    await sleep(40);
  }
  await settle(win, 100);
}

async function setField(win, selector, value) {
  const changed = await run(win, `(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    if (!element) return false;
    const prototype = element instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, 'value').set.call(element, ${JSON.stringify(String(value))});
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  })()`);
  if (!changed) throw new Error(`Field not found: ${selector}`);
  await settle(win, 100);
}

async function setEvery(win, scope, value) {
  await run(win, `document.querySelectorAll(${JSON.stringify(`${scope} .simx-row input[aria-label^="Количество"]`)}).forEach((element) => {
    if (Number(element.getAttribute('max')) <= 1) return;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(element, ${JSON.stringify(String(value))});
    element.dispatchEvent(new Event('input', { bubbles: true }));
  })`);
  await settle(win, 100);
}

async function hover(win, selector) {
  const point = await run(win, `(() => { const rect = document.querySelector(${JSON.stringify(selector)})?.getBoundingClientRect(); return rect ? { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2) } : null; })()`);
  if (!point) throw new Error(`Hover target not found: ${selector}`);
  await win.webContents.debugger.sendCommand('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 1, y: 1 });
  await sleep(60);
  await win.webContents.debugger.sendCommand('Input.dispatchMouseEvent', { type: 'mouseMoved', ...point });
  await sleep(600);
}

async function audit(win, name, label) {
  const found = await run(win, `(() => {
    const issues = [];
    const host = document.querySelector('.simx');
    if (!host) return ['no screen'];
    const visible = (node) => { const rect = node.getBoundingClientRect(); return rect.width > 0 && rect.height > 0; };
    for (const node of host.querySelectorAll('h2,h3,h4,p,small,strong,b,em,span,button,li')) {
      if (node.closest('.simx-tip')) continue;
      const style = getComputedStyle(node);
      if (style.display === 'none' || style.visibility === 'hidden' || style.display === 'inline' || !visible(node)) continue;
      if (node.scrollWidth > node.clientWidth + 2 && node.clientWidth > 0) issues.push({ cut: node.tagName + '.' + node.className, text: node.textContent.trim().slice(0, 50), scroll: node.scrollWidth, client: node.clientWidth });
    }
    for (const row of host.querySelectorAll('.simx-row, .simx-tech, .simx-strip, .simx-side__head, .simx-head, .simx-group__head, .simx-tile')) {
      const cells = [...row.children].filter((cell) => visible(cell) && !cell.matches('.simx-tip, i'));
      for (let i = 0; i < cells.length; i += 1) for (let j = i + 1; j < cells.length; j += 1) {
        const a = cells[i].getBoundingClientRect();
        const b = cells[j].getBoundingClientRect();
        if (a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1) issues.push({ overlap: [cells[i].className, cells[j].className], row: row.className });
      }
    }
    const core = host.querySelector('.simx-core')?.getBoundingClientRect();
    if (core && core.bottom > innerHeight + 1 && document.documentElement.scrollTop > 0) issues.push({ coreBelowWindow: core.bottom });
    const fontFloor = [...host.querySelectorAll('strong,small,span,button,h4')].filter((node) => visible(node) && node.closest('.simx') && !node.closest('.simx-tip') && parseFloat(getComputedStyle(node).fontSize) < 12);
    if (fontFloor.length) issues.push({ tinyText: fontFloor.slice(0, 3).map((node) => node.className + ':' + getComputedStyle(node).fontSize) });
    if (document.documentElement.scrollWidth > innerWidth + 2) issues.push({ horizontalOverflow: document.documentElement.scrollWidth });
    if (host.querySelector('select:not(.game-select__native)')) issues.push({ systemSelect: true });
    if (host.querySelector('[title]')) issues.push({ systemTooltip: host.querySelector('[title]').outerHTML.slice(0, 80) });
    return issues.slice(0, 12);
  })()`);
  if (found.length) {
    problems.push({ label, name, found });
    console.log(`[audit] ${label}/${name}: ${JSON.stringify(found)}`);
  }
}

async function capture(win, directory, name, label) {
  await run(win, `document.querySelectorAll('.runtime-toast-stack').forEach((n) => { n.style.visibility = 'hidden'; })`);
  await settle(win);
  await sleep(200);
  const result = await win.webContents.debugger.sendCommand('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: false });
  fs.writeFileSync(path.join(directory, `${name}.png`), Buffer.from(result.data, 'base64'));
  console.log(`[shots] ${path.relative(ROOT, path.join(directory, name))}.png`);
  if (!BEFORE) await audit(win, name, label);
}

/** `mutate` is page-side code over `save` and `planet`. */
async function seed(win, { race = 'aegis', mutate = '' } = {}) {
  const ok = await editSaveIdle(win, `(() => {
    const save = JSON.parse(localStorage.getItem(${JSON.stringify(SAVE_KEY)}) || 'null');
    const planet = save?.planets?.['helion-01'];
    if (!save || !planet?.buildings) return false;
    if (save.profile) save.profile.factionId = ${JSON.stringify(race)};
    planet.name = 'Москва';
    planet.buildings.shipyard = 20;
    planet.buildings.hangar = 20;
    planet.fleet.ships = { ...planet.fleet.ships, 'spy-probe': 8, scout: 94, battleship: 430, destroyer: 167, transporter: 1250, recycler: 77, cruiser: 500 };
    planet.fleet.commanders = { ...planet.fleet.commanders, corsair: 1, judge: 1 };
    planet.defense.defenses = { ...planet.defense.defenses, 'tower-shield': 1 };
    save.science = save.science || { levels: {}, queue: [] };
    save.science.levels = Object.fromEntries(Array.from({ length: 21 }, (_, i) => [i + 1, 12]));
    save.schemaVersion = Math.max(Number(save.schemaVersion) || 0, 13);
    if (save.combatSimulator) { save.combatSimulator.presets = []; delete save.combatSimulator.lastScenario; }
    ${mutate}
    localStorage.setItem(${JSON.stringify(SAVE_KEY)}, JSON.stringify(save));
    return true;
  })()`, { ready: `document.querySelector('[data-qa-navigation]')`, label: 'fixture' });
  if (!ok) throw new Error('Could not seed the save');
  await waitFor(win, `document.querySelector('[data-qa-navigation="utility"]')`);
  await settle(win);
}

async function openSimulator(win) {
  await click(win, '[data-qa-route="fleets"]');
  await waitFor(win, `document.querySelector('.fleet-workspace-v1')`);
  await click(win, '[data-qa-fleet-section="simulator"]');
  await waitFor(win, `document.querySelector('.simulator-view-v1')`);
  await settle(win);
}

const toTop = (win) => run(win, 'window.scrollTo(0, 0)');
const toBottom = async (win) => { await run(win, 'window.scrollTo(0, document.documentElement.scrollHeight)'); await settle(win); };

async function fight(win) {
  await click(win, '.sim-run-v1');
  await waitFor(win, `document.querySelector('[data-qa-sim-result]')`);
  await sleep(1100);
  return run(win, `({ winner: document.querySelector('[data-qa-sim-result]').getAttribute('data-qa-sim-winner'), rounds: document.querySelector('[data-qa-sim-rounds]').textContent })`);
}

async function raceSelect(win, side, race) { await setField(win, `#sim-${side}-race`, race); }

const SPY_REPORT = `{
  id: 'qa-spy-1', missionId: 'qa-mission-1', createdAt: Date.now() - 60000, sourcePlanetId: 'helion-01',
  targetPlanetId: 'qa-target', targetPlanetName: 'Новая Заря Дальнего Рубежа Системы', targetOwnerId: 'npc-1', targetOwnerName: 'Адмирал Вега',
  targetRaceId: 'synod', targetRelation: 'neutral', targetCoordinate: { galaxy: 1, system: 42, position: 7 },
  spyLevel: 10, targetEspionageLevel: 2, delta: 8, roll: 0.5, quality: 'full',
  resources: { metal: 4200000, minerals: 3100000, gas: 950000, debris: 0, developmentEnergy: 0 },
  defense: {}, fleet: {}, commanders: {},
}`;

async function scenes(win, directory, label) {
  const shot = (name) => capture(win, directory, name, label);
  if (BEFORE) {
    await seed(win);
    await openSimulator(win);
    await shot('01-empty');
    await toBottom(win);
    await shot('02-empty-bottom');
    return;
  }

  // Empty sides, nothing saved.
  await seed(win);
  await openSimulator(win);
  await shot('01-empty-no-scenarios');

  // A usual battle with a commander on each side.
  await click(win, `${A} [data-qa-sim-fill-planet="attacker"]`);
  await shot('02-attacker-from-planet');
  for (const id of ['scout', 'battleship', 'destroyer', 'cruiser', 'corsair']) await click(win, `${D} [data-qa-simulator-add="${id}"]`);
  await setEvery(win, D, 300);
  await run(win, `document.activeElement?.blur()`);
  await shot('03-filled-commander-each-side');
  await hover(win, `${A} .simx-row .simx-row__who`);
  await shot('04-unit-tooltip');
  const fought = await fight(win);
  notes.push({ label, scene: 'usual', ...fought });
  await shot('05-result');
  await toBottom(win);
  await shot('05b-result-scrolled');
  await toTop(win);
  await click(win, '[data-qa-sim-details]');
  await waitFor(win, `document.querySelector('[data-qa-battle-report-modal]')`);
  await sleep(400);
  await capture(win, directory, '06-details-report', label);
  await click(win, '.battle-report-modal-close-v1');

  // Technologies open on both sides.
  await run(win, `document.querySelectorAll('.simx-tech-toggle').forEach((b) => b.click())`);
  await shot('07-technologies-open');
  await hover(win, `${D} .simx-tech:nth-child(2) .simx-tech__who`);
  await shot('07b-technology-tooltip');
  await run(win, `document.querySelectorAll('.simx-tech-toggle').forEach((b) => b.click())`);

  // Own dropdown on a real list.
  await click(win, `${A} .simx-field .game-select__trigger`);
  await settle(win, 300);
  await capture(win, directory, '08-race-dropdown', label);
  await run(win, `document.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))`);
  await run(win, `window.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))`);
  await click(win, '[data-qa-sim-clear-all]');

  // Every ship and every defence of all three races.
  for (const race of ['aegis', 'synod', 'veyra']) {
    await raceSelect(win, 'attacker', race);
    await raceSelect(win, 'defender', race);
    await addAll(win, A);
    await addAll(win, D);
    await setEvery(win, A, 700);
    await setEvery(win, D, 700);
    await run(win, `document.activeElement?.blur()`);
    await shot(`09-all-units-${race}`);
    if (race === 'aegis') {
      await toBottom(win);
      await shot('09b-all-units-bottom');
      await toTop(win);
    }
    const allFought = await fight(win);
    notes.push({ label, scene: `all-${race}`, ...allFought });
    await shot(`10-all-units-result-${race}`);
    await click(win, '[data-qa-sim-clear-all]');
  }

  // Huge numbers straight from a saved scenario: they break the limit and the screen must say so.
  await seed(win, { mutate: `
    const empty = { ships: [], commanders: [], commander: null, activeCommanderId: null };
    const huge = (ids) => ids.map((entityId, i) => ({ entityId, count: 987654321 - i, level: 10 }));
    save.combatSimulator = { ...(save.combatSimulator || {}), presets: [] };
    save.combatSimulator.lastScenario = {
      maxRounds: 12, technologyMode: 'independent', executionMode: 'production', attackerFactionId: 'aegis', defenderFactionId: 'aegis',
      attackerTechnologies: {}, defenderTechnologies: {},
      attacker: { ...empty, ships: huge(['scout', 'battleship', 'destroyer', 'cruiser']) },
      defender: { ...empty, defenses: [], ships: huge(['scout', 'battleship', 'destroyer', 'cruiser']) },
    };
  ` });
  await openSimulator(win);
  await shot('11-huge-numbers-over-limit');

  // The longest legal strings in every result cell, over a real result.
  await click(win, '[data-qa-sim-clear-all]');
  await click(win, `${A} [data-qa-simulator-add="battleship"]`);
  await click(win, `${D} [data-qa-simulator-add="scout"]`);
  await setField(win, `${A} [data-qa-simulator-unit="battleship"] input[aria-label^="Количество"]`, 500);
  await run(win, `document.activeElement?.blur()`);
  await fight(win);
  await run(win, `(() => {
    const set = (node, value) => { if (node) node.textContent = value; };
    document.querySelectorAll('[data-qa-sim-force] > strong').forEach((node) => set(node, '−987 654 321'));
    set(document.querySelector('[data-qa-sim-debris] strong'), '987 654 321 012');
    set(document.querySelector('[data-qa-sim-loot] strong'), '987 654 321 012');
    document.querySelectorAll('.simx-row__name > small').forEach((node) => { node.innerHTML = '<em>−987,7 млн</em> осталось 987,7 млн'; });
    document.querySelectorAll('.simx-num > input[aria-label^="Количество"]').forEach((node) => { node.type = 'text'; node.value = '987654321'; });
  })()`);
  await shot('12-huge-numbers-result');

  // A long battle and a draw.
  await click(win, '[data-qa-sim-clear-all]');
  await click(win, `${A} [data-qa-simulator-add="cruiser"]`);
  await click(win, `${D} [data-qa-simulator-add="cruiser"]`);
  await click(win, `.simx-rounds button:last-child`);
  await setField(win, `${A} [data-qa-simulator-unit="cruiser"] input[aria-label^="Количество"]`, 1200);
  await setField(win, `${D} [data-qa-simulator-unit="cruiser"] input[aria-label^="Количество"]`, 1200);
  await run(win, `document.activeElement?.blur()`);
  const long = await fight(win);
  notes.push({ label, scene: 'long', ...long });
  await shot('13-long-battle');
  let drawn = false;
  for (const [unit, count] of [['cruiser', 1000], ['battleship', 900], ['destroyer', 600], ['scout', 5000]]) {
    await click(win, '[data-qa-sim-clear-all]');
    await click(win, `${A} [data-qa-simulator-add="${unit}"]`);
    await click(win, `${D} [data-qa-simulator-add="${unit}"]`);
    await click(win, '.simx-rounds button:first-child');
    await setField(win, `${A} [data-qa-simulator-unit="${unit}"] input[aria-label^="Количество"]`, count);
    await setField(win, `${D} [data-qa-simulator-unit="${unit}"] input[aria-label^="Количество"]`, count);
    await run(win, `document.activeElement?.blur()`);
    const outcome = await fight(win);
    notes.push({ label, scene: `draw-try-${unit}`, ...outcome });
    if (outcome.winner === 'draw') { drawn = true; break; }
  }
  if (!drawn) notes.push({ label, scene: 'draw', missing: true });
  await shot('14-draw');

  // A long scenario name, and the list scrolls with the arrow keys (Codex finding in GameSelect).
  const LONG_NAME = 'Линкоры с командиром против всей обороны Синода ';
  await seed(win, { mutate: `
    save.combatSimulator = { ...(save.combatSimulator || {}), presets: [] };
  ` });
  await openSimulator(win);
  await click(win, `${A} [data-qa-simulator-add="scout"]`);
  await click(win, `${D} [data-qa-simulator-add="scout"]`);
  for (let index = 0; index < 14; index += 1) {
    await setField(win, '#sim-preset-name', `${LONG_NAME.slice(0, 44)} ${index + 1}`);
    await click(win, '[data-qa-sim-save]');
  }
  await shot('15-long-scenario-name');
  const before = await run(win, `(() => { const trigger = document.querySelector('.simx-scenarios .game-select__trigger'); trigger.focus(); trigger.click(); return true; })()`);
  await settle(win, 300);
  const keyboard = [];
  if (before) {
    for (let step = 0; step < 14; step += 1) {
      await run(win, `document.querySelector('.simx-scenarios .game-select__trigger').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))`);
      await sleep(70);
      keyboard.push(await run(win, `(() => { const list = document.querySelector('[data-qa-game-select-list]'); const active = list?.querySelector('.is-active'); if (!active) return 'none'; const l = list.getBoundingClientRect(); const a = active.getBoundingClientRect(); return a.top >= l.top - 1 && a.bottom <= l.bottom + 1 ? 'seen' : 'hidden'; })()`));
    }
  }
  if (keyboard.includes('hidden')) problems.push({ label, name: 'game-select-keyboard', found: keyboard });
  notes.push({ label, scene: 'keyboard', keyboard: keyboard.join(',') });
  await capture(win, directory, '16-scenario-dropdown-keyboard', label);
  await run(win, `document.querySelector('.simx-scenarios .game-select__trigger').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);

  // Fill the defender from a spy report: loot gets real figures.
  await seed(win, { mutate: `
    save.combatSimulator = { ...(save.combatSimulator || {}), presets: [] };
    save.espionage = save.espionage || { missions: [], reports: [], hunterNotices: [] };
    const report = ${SPY_REPORT};
    report.fleet = { 'scout': 40 };
    report.defense = { 'tower-shield': 1 };
    save.espionage.reports = [report];
  ` });
  await openSimulator(win);
  await click(win, `${A} [data-qa-sim-fill-planet="attacker"]`);
  const hasReport = await run(win, `Boolean(document.querySelector('[data-qa-sim-fill-report] option[value="qa-spy-1"]'))`);
  notes.push({ label, scene: 'spy-report-offered', hasReport });
  if (hasReport) {
    await setField(win, '[data-qa-sim-fill-report]', 'qa-spy-1');
    await shot('17-defender-from-report');
    const fromReport = await fight(win);
    notes.push({ label, scene: 'spy-report', ...fromReport });
    await shot('18-loot-from-report');
  }
}

async function runViewport(width, height) {
  const label = `${width}x${height}`;
  const directory = path.join(OUTPUT, label);
  fs.mkdirSync(directory, { recursive: true });
  const win = new BrowserWindow({ width, height, useContentSize: true, show: false, backgroundColor: '#02050a', webPreferences: { offscreen: true, sandbox: false, backgroundThrottling: false, partition: `qa-simulator-redo-${label}${BEFORE ? '-before' : ''}` } });
  await win.loadFile(path.join(DIST, 'index.html'), { search: '?mode=test' });
  win.webContents.debugger.attach('1.3');
  await win.webContents.debugger.sendCommand('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false, screenWidth: width, screenHeight: height });
  await waitFor(win, `document.querySelector('[data-qa-navigation="utility"]')`);
  await scenes(win, directory, label);
  win.destroy();
}

app.whenReady().then(async () => {
  try {
    for (const [width, height] of VIEWPORTS) await runViewport(width, height);
    fs.writeFileSync(path.join(OUTPUT, 'audit.json'), JSON.stringify({ problems, notes }, null, 1));
    console.log(`[audit] frames with problems: ${problems.length}`);
    console.log(JSON.stringify(notes));
    app.exit(0);
  } catch (error) {
    console.error(error.stack || error);
    fs.mkdirSync(OUTPUT, { recursive: true });
    fs.writeFileSync(path.join(OUTPUT, 'audit.json'), JSON.stringify({ problems, notes, error: String(error.stack || error) }, null, 1));
    app.exit(1);
  }
});
