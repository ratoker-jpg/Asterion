const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-gpu');
app.on('window-all-closed', () => {});

const ROOT = path.join(__dirname, '..');
const OUTPUT = process.env.ASTERION_QA_OUTPUT || path.join(ROOT, 'artifacts-pass1', 'command-journal-qa');
const PRODUCTION_KEY = 'asterion.vertical-slice.v1';
const TEST_KEY = 'asterion.vertical-slice.test.v1';
const TIME_SCALE_KEY = 'asterion.test-time-scale.v1';
const VIEWPORTS = [[1920, 1080], [1280, 720]];
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const skipScreenshots = process.env.ASTERION_SKIP_SCREENSHOTS === '1';

const run = (win, source) => win.webContents.executeJavaScript(source);

async function waitFor(win, expression, timeoutMs = 20_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await run(win, `Boolean(${expression})`)) return;
    await sleep(80);
  }
  throw new Error(`Timed out waiting for: ${expression}`);
}

async function load(win, mode) {
  const done = new Promise((resolve) => win.webContents.once('did-finish-load', resolve));
  await win.loadFile(path.join(ROOT, 'dist', 'index.html'), { search: mode === 'test' ? '?mode=test' : '?autostart=continue' });
  await done;
  await waitFor(win, `document.querySelector('[data-qa-navigation="utility"]')`);
  await waitFor(win, `localStorage.getItem(${JSON.stringify(mode === 'test' ? TEST_KEY : PRODUCTION_KEY)})`);
  await sleep(150);
}

async function reload(win, mode) {
  const done = new Promise((resolve) => win.webContents.once('did-finish-load', resolve));
  win.webContents.reload();
  await done;
  await waitFor(win, `document.querySelector('[data-qa-navigation="utility"]')`);
  await waitFor(win, `localStorage.getItem(${JSON.stringify(mode === 'test' ? TEST_KEY : PRODUCTION_KEY)})`);
  await sleep(150);
}

async function openRoute(win, route, readySelector) {
  const clicked = await run(win, `(() => {
    const button = document.querySelector('[data-qa-navigation="primary"] [data-qa-route="${route}"]') || document.querySelector('[data-qa-route="${route}"]');
    if (!button || button.disabled) return false;
    button.click();
    return true;
  })()`);
  if (!clicked) throw new Error(`Route button not found: ${route}`);
  await waitFor(win, `document.querySelector(${JSON.stringify(readySelector)})`);
  await sleep(120);
}

async function capture(win, label, name) {
  if (skipScreenshots) return;
  const directory = path.join(OUTPUT, label);
  await sleep(600);
  fs.mkdirSync(directory, { recursive: true });
  const [width, height] = win.getContentSize();
  const image = await win.capturePage({ x: 0, y: 0, width, height });
  fs.writeFileSync(path.join(directory, `${name}.png`), image.toPNG());
}

const readSave = (win, key) => run(win, `JSON.parse(localStorage.getItem(${JSON.stringify(key)}) || 'null')`);

async function patchSave(win, key, patchSource) {
  await run(win, `(() => {
    const save = JSON.parse(localStorage.getItem(${JSON.stringify(key)}) || '{}');
    (${patchSource})(save);
    localStorage.setItem(${JSON.stringify(key)}, JSON.stringify(save));
  })()`);
}

async function click(win, selector) {
  const ok = await run(win, `(() => { const node = document.querySelector(${JSON.stringify(selector)}); if (!node || node.disabled) return false; node.click(); return true; })()`);
  if (!ok) throw new Error(`Missing or disabled control: ${selector}`);
  await sleep(140);
}

async function setField(win, selector, value) {
  const ok = await run(win, `(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    if (!element) return false;
    const prototype = element instanceof HTMLSelectElement ? HTMLSelectElement.prototype
      : element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, 'value').set.call(element, ${JSON.stringify(String(value))});
    element.dispatchEvent(new Event(element instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }));
    return true;
  })()`);
  if (!ok) throw new Error(`Missing field: ${selector}`);
  await sleep(100);
}

function assert(condition, message, detail) {
  if (!condition) throw new Error(`${message}${detail === undefined ? '' : ` ${JSON.stringify(detail)}`}`);
}

const journal = (win) => run(win, `(() => ({
  state: document.querySelector('[data-qa-journal-state]')?.getAttribute('data-qa-journal-state') || '',
  entries: Array.from(document.querySelectorAll('[data-qa-journal-entry]')).map((n) => n.getAttribute('data-qa-journal-entry')),
  text: document.querySelector('.command-journal')?.innerText || '',
  html: document.documentElement.outerHTML,
  sun: Boolean(document.querySelector('[data-qa-sun-raid-panel]')),
  sunText: document.querySelector('[data-qa-sun-raid-panel]')?.innerText || '',
  sunControls: document.querySelectorAll('[data-qa-sun-raid-panel] [data-qa-sun-attack], [data-qa-sun-raid-panel] [data-qa-sun-support]').length,
  overflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
  contentOverflow: (() => { const c = document.querySelector('.command-content'); return c ? c.scrollWidth > c.clientWidth + 1 : false; })(),
}))()`);

// The alliance journal lives on «Штаб» (overview), the first tab a member sees.
async function openJournal(win) {
  await openRoute(win, 'command', '.command-view');
  await click(win, '[data-qa-command-tab="overview"]');
  await waitFor(win, `document.querySelector('[data-qa-journal-state]')`);
}


// Moves the player's join time and replaces the alliance events with two sentinel events (before / after the join).
const seedJoin = (win, key, joinedAgoMs, oldAgoMs, newAgoMs) => patchSave(win, key, `(save) => {
  const alliance = save.command.alliances.find((a) => a.members.some((m) => m.ownerId === save.profile.playerId));
  const now = Date.now();
  alliance.members.find((m) => m.ownerId === save.profile.playerId).joinedAt = now - ${joinedAgoMs};
  const make = (tag, at, units) => ({ id: 'aid_delivered:SENTINEL-' + tag, kind: 'aid_delivered', at, allianceId: alliance.id, requestId: 'SENTINEL-REQ-' + tag, actorOwnerId: 'member-ira-vel', audience: 'alliance', flightId: 'SENTINEL-' + tag, units });
  save.command.aidEvents = [make('OLD', now - ${oldAgoMs}, 987654), make('NEW', now - ${newAgoMs}, 876543), make('BADTIME', 1e20, 555555)];
}`);

async function testModeScenario(win, label) {
  await load(win, 'test');
  await run(win, `localStorage.removeItem(${JSON.stringify(TEST_KEY)}); localStorage.setItem(${JSON.stringify(TIME_SCALE_KEY)}, '500');`);
  await reload(win, 'test');
  const MIN = 60000;
  const HOUR = 60 * MIN;

  // 1. Fresh member (30 min): hidden sentinel events must leave no trace in the DOM.
  await seedJoin(win, TEST_KEY, 30 * MIN, 40 * MIN, 10 * MIN);
  await reload(win, 'test');
  await openJournal(win);
  let state = await journal(win);
  assert(state.state === 'locked', `${label}: a 30-minute member sees the locked journal`, state.state);
  assert(!/SENTINEL|987654|876543|987 654|876 543/.test(state.html), `${label}: locked DOM holds no hidden event data`);
  assert(/через/.test(state.text) && state.entries.length === 0, `${label}: only the unlock countdown is shown`, state.text);
  assert(!state.overflowX && !state.contentOverflow, `${label}: no overflow (locked)`, state);
  await capture(win, label, 'journal-locked');
  await click(win, '[data-qa-command-tab="operations"]');
  await waitFor(win, `document.querySelector('[data-qa-sun-raid-panel]')`);
  const operations = await journal(win);
  assert(operations.sun && /КОМАНДНЫЙ РЕЙД/.test(operations.sunText) && /СОЛНЦА ГАЛАКТИКИ/.test(operations.sunText) && operations.sunControls === 2, `${label}: Operations shows the live Sun Raid panel and its attack/support actions`, operations.sunText);
  assert(!/SENTINEL|987654|876543|987 654|876 543/.test(operations.html), `${label}: operations DOM holds no hidden event data`);

  // 2. Three hours in: only events after the join are readable.
  await seedJoin(win, TEST_KEY, 3 * HOUR, 4 * HOUR, HOUR);
  await reload(win, 'test');
  await openJournal(win);
  state = await journal(win);
  assert(state.state === 'open' && state.entries.length === 1, `${label}: after 2 h exactly the post-join event is shown`, state);
  assert(/876\s?543/.test(state.text) && !/987\s?654/.test(state.text) && !/555\s?555/.test(state.text), `${label}: pre-join and corrupted-time events stay hidden and the journal still renders`, state.text);
  assert(!/SENTINEL/.test(state.html), `${label}: raw event ids never reach the DOM`);
  assert(!state.overflowX && !state.contentOverflow, `${label}: no overflow (open)`, state);
  await capture(win, label, 'journal-open');

  // 3. Re-join: a fresh joinedAt locks the journal and hides the earlier stay again.
  await seedJoin(win, TEST_KEY, 5 * MIN, 4 * HOUR, HOUR);
  await reload(win, 'test');
  await openJournal(win);
  state = await journal(win);
  assert(state.state === 'locked' && !/SENTINEL|876543|876 543/.test(state.html), `${label}: a fresh join locks the journal`, state.state);

  // 4. Real producers: request -> Ira helps -> journal rows, no duplicates after reload.
  await patchSave(win, TEST_KEY, `(save) => {
    const alliance = save.command.alliances.find((a) => a.members.some((m) => m.ownerId === save.profile.playerId));
    alliance.members.find((m) => m.ownerId === save.profile.playerId).joinedAt = Date.now() - 3 * 3600000;
    save.command.aidEvents = [];
    const planet = save.planets[save.currentPlanetId];
    planet.resources = { metal: 1000000, minerals: 1000000, gas: 1000000 };
    save.metal = 1000000; save.minerals = 1000000; save.gas = 1000000;
  }`);
  await reload(win, 'test');
  await openRoute(win, 'command', '.command-view');
  await click(win, '[data-qa-command-tab="requests"]');
  await waitFor(win, `/^[1-3]\\/3/.test(document.querySelector('[data-qa-request-charges]')?.textContent?.trim() || '')`);
  await setField(win, '[data-qa-request-resource]', 'metal');
  await setField(win, '[data-qa-request-amount]', '50000');
  await waitFor(win, `!document.querySelector('[data-qa-request-create]')?.disabled`);
  await click(win, '[data-qa-request-create]');
  await waitFor(win, `document.querySelectorAll('[data-qa-my-requests] > li').length === 1`);
  await click(win, '[data-qa-test-ira-prepare]');
  await click(win, '[data-qa-test-ira-help]');
  await waitFor(win, `JSON.parse(localStorage.getItem(${JSON.stringify(TEST_KEY)}) || '{}')?.command?.requests?.[0]?.delivered === 50000`);
  await click(win, '[data-qa-command-tab="overview"]');
  await waitFor(win, `document.querySelector('[data-qa-journal-state="open"]')`);
  state = await journal(win);
  const kinds = state.entries.slice().sort();
  assert(kinds.join() === ['aid_delivered', 'aid_launched', 'request_created'].join(), `${label}: journal shows creation, launch and delivery of the real aid`, kinds);
  await capture(win, label, 'journal-real-aid');
  await reload(win, 'test');
  await sleep(1500);
  await openJournal(win);
  const again = await journal(win);
  assert(again.entries.length === kinds.length, `${label}: reload does not duplicate rows`, again.entries);
  const save = await readSave(win, TEST_KEY);
  assert(new Set(save.command.aidEvents.map((e) => e.id)).size === save.command.aidEvents.length, `${label}: event ids stay unique`);

  // 5. Diplomacy: a real second alliance (Bot 01, Test Mode fixture), war at once, truce after 3 h (Test Mode clock), accepted by the bot's test control.
  await click(win, '[data-qa-command-tab="diplomacy"]');
  await waitFor(win, `document.querySelector('[data-qa-diplomacy-item="alliance-test-bot01-v1"]')`);
  await run(win, `document.querySelector('[data-qa-diplomacy-item="alliance-test-bot01-v1"]').click()`);
  assert(await run(win, `document.querySelector('[data-qa-diplomacy-item="alliance-test-bot01-v1"]').getAttribute('data-qa-relation-status') === 'neutral'`), `${label}: Bot 01 alliance starts neutral`);
  await click(win, '[data-qa-declare-war]');
  await click(win, '[data-qa-confirm]');
  await waitFor(win, `document.querySelector('[data-qa-diplomacy-item="alliance-test-bot01-v1"]')?.getAttribute('data-qa-relation-status') === 'war'`);
  assert(await run(win, `document.querySelector('[data-qa-truce-propose]')?.disabled === true`), `${label}: a truce cannot be offered right after the declaration`);
  let saveWar = await readSave(win, TEST_KEY);
  assert(saveWar.command.diplomacy.filter((relation) => relation.status === 'war').length === 2, `${label}: war persisted for both sides`, saveWar.command.diplomacy);
  await capture(win, label, 'diplomacy-war');
  // Move the war start 4 h back (the time is moved in the save, not accelerated) so a truce may be offered.
  await patchSave(win, TEST_KEY, `(save) => { for (const relation of save.command.diplomacy) relation.since = Date.now() - 4 * 3600000; }`);
  await reload(win, 'test');
  await openRoute(win, 'command', '.command-view');
  await click(win, '[data-qa-command-tab="diplomacy"]');
  await waitFor(win, `document.querySelector('[data-qa-test-bot-truce]')`);
  await click(win, '[data-qa-test-bot-truce]');
  await waitFor(win, `document.querySelector('[data-qa-truce-accept]')`);
  await click(win, '[data-qa-truce-accept]');
  await waitFor(win, `document.querySelector('[data-qa-diplomacy-item="alliance-test-bot01-v1"]')?.getAttribute('data-qa-relation-status') === 'neutral'`);
  saveWar = await readSave(win, TEST_KEY);
  assert(saveWar.command.diplomacy.length === 0, `${label}: an accepted truce ends the war`, saveWar.command.diplomacy);
}

async function productionScenario(win, label) {
  await load(win, 'production');
  await run(win, `localStorage.removeItem(${JSON.stringify(PRODUCTION_KEY)}); localStorage.removeItem(${JSON.stringify(TEST_KEY)});`);
  await reload(win, 'production');
  await patchSave(win, PRODUCTION_KEY, `(save) => { save.planets['helion-01'].buildings['planetary-government'] = 1; }`);
  await reload(win, 'production');
  await openRoute(win, 'command', '.command-view');
  await click(win, '[data-qa-create-alliance]');
  await setField(win, '[data-qa-alliance-name]', 'Журнал Дозора с очень длинным названием');
  await setField(win, '[data-qa-alliance-tag]', 'JRN');
  await click(win, '[data-qa-alliance-submit]');
  await waitFor(win, `document.querySelector('.command-view')?.getAttribute('data-qa-command-state') === 'leader'`);
  await click(win, '[data-qa-command-tab="overview"]');
  await waitFor(win, `document.querySelector('[data-qa-journal-state="locked"]')`);
  let state = await journal(win);
  assert(state.entries.length === 0 && !state.overflowX && !state.contentOverflow, `${label}: production journal is locked and fits`, state);
  await capture(win, label, 'production-journal-locked');
  await patchSave(win, PRODUCTION_KEY, `(save) => { save.command.alliances[0].members[0].joinedAt = Date.now() - 3 * 3600000; }`);
  await reload(win, 'production');
  await openJournal(win);
  state = await journal(win);
  assert(state.state === 'empty' && /пока нет/.test(state.text), `${label}: production journal is empty and invents nothing`, state);
  const save = await readSave(win, PRODUCTION_KEY);
  assert(save.command.aidEvents.length === 0, `${label}: production save has no fabricated events`, save.command.aidEvents);
  await capture(win, label, 'production-journal-empty');
}

async function runViewport(width, height) {
  const label = `${width}x${height}`;
  const win = new BrowserWindow({ width, height, show: process.env.ASTERION_QA_SHOW === '1', webPreferences: { sandbox: false, partition: 'command-journal-qa-isolated' } });
  win.webContents.on('console-message', (_event, _level, message) => {
    if (/error/i.test(message)) console.warn(`[${label}] renderer: ${message}`);
  });
  try {
    await productionScenario(win, label);
    await testModeScenario(win, label);
  } finally {
    if (!win.isDestroyed()) win.destroy();
  }
}

app.whenReady().then(async () => {
  try {
    for (const [width, height] of VIEWPORTS) await runViewport(width, height);
    console.log('command-journal-qa: PASS');
    app.quit();
  } catch (error) {
    console.error(error);
    app.exit(1);
  }
});
