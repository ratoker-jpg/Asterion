const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-gpu');
app.on('window-all-closed', () => {});

const ROOT = path.join(__dirname, '..');
const OUTPUT = process.env.ASTERION_QA_OUTPUT || path.join(ROOT, 'artifacts-pass1', 'command-aid-qa');
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
  await win.loadFile(path.join(ROOT, 'dist', 'index.html'), mode === 'test' ? { search: '?mode=test' } : undefined);
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

const view = (win) => run(win, `(() => ({
  charges: document.querySelector('[data-qa-request-charges]')?.textContent?.trim() || '',
  chargeLine: document.querySelector('[data-qa-charge-line]')?.textContent?.trim() || '',
  blocker: document.querySelector('[data-qa-request-blocker]')?.textContent?.trim() || '',
  createDisabled: document.querySelector('[data-qa-request-create]')?.disabled === true,
  testBox: Boolean(document.querySelector('[data-qa-aid-test-box]')),
  mine: Array.from(document.querySelectorAll('[data-qa-my-requests] > li')).map((node) => ({
    id: node.getAttribute('data-qa-request-id'),
    requested: node.querySelector('[data-qa-request-requested]')?.textContent?.replace(/\\s/g, '') || '',
    inFlight: node.querySelector('[data-qa-request-inflight]')?.textContent?.replace(/\\s/g, '') || '',
    delivered: node.querySelector('[data-qa-request-delivered]')?.textContent?.replace(/\\s/g, '') || '',
    cancelDisabled: node.querySelector('[data-qa-request-cancel]')?.disabled === true,
  })),
  incoming: Array.from(document.querySelectorAll('[data-qa-incoming-requests] > li')).map((node) => node.getAttribute('data-qa-request-id')),
  closed: document.querySelectorAll('[data-qa-closed-requests] li').length,
  overflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
  text: document.querySelector('.command-view')?.innerText || '',
}))()`);

async function openRequestsTab(win) {
  await openRoute(win, 'command', '.command-view');
  await click(win, '[data-qa-command-tab="requests"]');
  await waitFor(win, `document.querySelector('[data-qa-requests]')`);
}

async function testModeScenario(win, label) {
  await load(win, 'test');
  await run(win, `localStorage.removeItem(${JSON.stringify(TEST_KEY)}); localStorage.setItem(${JSON.stringify(TIME_SCALE_KEY)}, '500');`);
  await reload(win, 'test');
  await openRequestsTab(win);

  // 1. Honest start: 0/3 and the 15-minute first charge counting on the (accelerated) clock; the form is blocked, not hidden.
  let state = await view(win);
  assert(state.charges.startsWith('0/3') || state.charges.startsWith('1/3'), `${label}: charge counter is visible`, state);
  assert(state.testBox, `${label}: Test Mode shows the Ira Vel scenario box`, state);
  await capture(win, label, 'requests-empty');

  // Test Mode wallets start full, so a request would burn on arrival: the form must say so before sending.
  await setField(win, '[data-qa-request-resource]', 'metal');
  await setField(win, '[data-qa-request-amount]', '50000');
  await waitFor(win, `document.querySelector('[data-qa-request-overflow]')`);
  const warning = await run(win, `document.querySelector('[data-qa-request-overflow]')?.textContent || ''`);
  assert(/сгорит/.test(warning) && /не будет засчитано/.test(warning), `${label}: overflow warning is shown before creating the request`, warning);
  await capture(win, label, 'requests-overflow-warning');
  // Make room on the planet so the following deliveries are accepted (the overflow rule itself is unit-tested).
  await patchSave(win, TEST_KEY, `(save) => {
    const planet = save.planets[save.currentPlanetId];
    planet.resources = { metal: 1000000, minerals: 1000000, gas: 1000000 };
    save.metal = 1000000; save.minerals = 1000000; save.gas = 1000000;
    // Real cargo hulls for the player's own aid flight (a Test Mode QA seed, like the other fleet QAs).
    planet.fleet.ships['mega-transporter'] = 10;
  }`);
  await reload(win, 'test');
  await openRequestsTab(win);

  // 2. The first charge arrives (15 min / 500 = ~2 s), then a real request is created for a concrete own planet.
  await waitFor(win, `/^[1-3]\\/3/.test(document.querySelector('[data-qa-request-charges]')?.textContent?.trim() || '')`);
  await setField(win, '[data-qa-request-resource]', 'metal');
  await setField(win, '[data-qa-request-amount]', '50000');
  await waitFor(win, `!document.querySelector('[data-qa-request-create]')?.disabled`);
  await capture(win, label, 'requests-form');
  await click(win, '[data-qa-request-create]');
  await waitFor(win, `document.querySelectorAll('[data-qa-my-requests] > li').length === 1`);
  state = await view(win);
  assert(state.mine[0].requested === '50000' && state.mine[0].delivered === '0' && state.mine[0].inFlight === '0', `${label}: new request shows requested/in flight/delivered`, state.mine);
  let save = await readSave(win, TEST_KEY);
  const first = save.command.requests[0];
  assert(first.status === 'open' && first.resource === 'metal' && first.requested === 50000 && first.planetId === save.currentPlanetId && first.helpStarted === false, `${label}: request persisted with stable ids`, first);

  // 3. Ira Vel helps the player through the real flight runtime (explicit QA action).
  await click(win, '[data-qa-test-ira-prepare]');
  await click(win, '[data-qa-test-ira-help]');
  await waitFor(win, `JSON.parse(localStorage.getItem(${JSON.stringify(TEST_KEY)}) || '{}')?.flights?.records?.some((f) => f.missionId === 'aid' && f.ownerSide === 'npc')`);
  save = await readSave(win, TEST_KEY);
  const iraFlight = save.flights.records.find((f) => f.missionId === 'aid' && f.ownerSide === 'npc');
  assert(iraFlight.aid.requestId === first.id && iraFlight.destinationPlanetId === first.planetId && iraFlight.cargo.metal === 50000, `${label}: Ira flight is bound to the request and its planet`, iraFlight);
  await waitFor(win, `JSON.parse(localStorage.getItem(${JSON.stringify(TEST_KEY)}) || '{}')?.command?.requests?.[0]?.delivered === 50000`);
  state = await view(win);
  assert(state.mine.length === 0 && state.closed >= 1, `${label}: a delivered request leaves the open list`, state);
  save = await readSave(win, TEST_KEY);
  const ira = save.command.alliances[0].members.find((m) => m.ownerId === 'member-ira-vel');
  assert(save.command.requests[0].status === 'completed' && ira.deliveredUnits === 50000, `${label}: delivery closes the request and credits Ira's contribution`, { request: save.command.requests[0], ira });
  await capture(win, label, 'requests-delivered-by-ira');

  // 4. The player helps Ira Vel with a real "Помощь союзу" fleet prepared from her request.
  await openRequestsTab(win);
  await click(win, '[data-qa-test-ira-request]');
  await waitFor(win, `document.querySelectorAll('[data-qa-incoming-requests] > li').length === 1`);
  await capture(win, label, 'requests-incoming');
  await click(win, '[data-qa-request-help]');
  await waitFor(win, `document.querySelector('.fleet-workspace-v1')`);
  await waitFor(win, `document.querySelector('#fleet-mission')?.value === 'aid'`);
  await setField(win, '[data-qa-fleet-ship="mega-transporter"] input[type="number"]', '3');
  await click(win, '[data-qa-flight-preview-open]');
  await waitFor(win, `document.querySelector('[data-qa-aid-request-summary]')`);
  await waitFor(win, `document.querySelector('[data-qa-cargo="metal"]')`);
  const onlyRequested = await run(win, `Array.from(document.querySelectorAll('[data-qa-flight-cargo] [data-qa-cargo]')).map((n) => n.getAttribute('data-qa-cargo'))`);
  assert(onlyRequested.length === 1 && onlyRequested[0] === 'metal', `${label}: the cargo form offers only the requested resource`, onlyRequested);
  await setField(win, '[data-qa-cargo="metal"]', '60000');
  await waitFor(win, `!document.querySelector('[data-qa-flight-dispatch-confirm]')?.disabled`);
  await capture(win, label, 'aid-flight-preview');
  await click(win, '[data-qa-flight-dispatch-confirm]');
  await waitFor(win, `JSON.parse(localStorage.getItem(${JSON.stringify(TEST_KEY)}) || '{}')?.flights?.records?.some((f) => f.missionId === 'aid' && f.ownerSide !== 'npc')`);
  save = await readSave(win, TEST_KEY);
  const playerFlight = save.flights.records.find((f) => f.missionId === 'aid' && f.ownerSide !== 'npc');
  const iraRequest = save.command.requests.find((r) => r.authorOwnerId === 'member-ira-vel');
  assert(playerFlight.aid.requestId === iraRequest.id && playerFlight.cargo.metal === 60000 && playerFlight.cargo.minerals === 0 && playerFlight.targetRelation === 'ally' && iraRequest.helpStarted === true, `${label}: player aid flight is bound and reserved`, { playerFlight, iraRequest });
  await waitFor(win, `JSON.parse(localStorage.getItem(${JSON.stringify(TEST_KEY)}) || '{}')?.command?.requests?.find((r) => r.authorOwnerId === 'member-ira-vel')?.delivered === 60000`);
  save = await readSave(win, TEST_KEY);
  const me = save.command.alliances[0].members.find((m) => m.ownerId === save.profile.playerId);
  assert(me.deliveredUnits === 60000, `${label}: the player's contribution counts only the delivered units`, me);

  // 5. Reload must not repeat any credit.
  await reload(win, 'test');
  await sleep(1500);
  const after = await readSave(win, TEST_KEY);
  const afterMe = after.command.alliances[0].members.find((m) => m.ownerId === after.profile.playerId);
  const afterIra = after.command.alliances[0].members.find((m) => m.ownerId === 'member-ira-vel');
  assert(afterMe.deliveredUnits === 60000 && afterIra.deliveredUnits === 50000, `${label}: no double credit after reload`, { afterMe, afterIra });
  assert(after.command.aidEvents.filter((e) => e.kind === 'aid_delivered').length === 2, `${label}: exactly two delivery events`, after.command.aidEvents);
  await openRequestsTab(win);
  state = await view(win);
  assert(!state.overflowX, `${label}: no horizontal overflow`, state);
  await capture(win, label, 'requests-after-reload');

  // 6. Manual path: the mission picked from the fleet window lists only open requests and binds the chosen one.
  await click(win, '[data-qa-test-ira-request]');
  await waitFor(win, `document.querySelectorAll('[data-qa-incoming-requests] > li').length === 1`);
  await openRoute(win, 'fleets', '.fleet-workspace-v1');
  await setField(win, '#fleet-mission', 'aid');
  await setField(win, '[data-qa-fleet-ship="mega-transporter"] input[type="number"]', '2');
  await click(win, '[data-qa-flight-preview-open]');
  await waitFor(win, `document.querySelector('[data-qa-aid-request-select]')`);
  const choices = await run(win, `Array.from(document.querySelectorAll('[data-qa-aid-request-select] option')).map((o) => ({ value: o.value, disabled: o.disabled }))`);
  assert(choices.length === 2 && choices[1].value && !choices[1].disabled, `${label}: the picker offers the open request of an ally`, choices);
  assert(!(await run(win, `Boolean(document.querySelector('[data-qa-flight-dispatch-confirm]') && !document.querySelector('[data-qa-flight-dispatch-confirm]').disabled)`)), `${label}: nothing can be sent before a request is chosen`);
  await setField(win, '[data-qa-aid-request-select]', choices[1].value);
  await waitFor(win, `document.querySelector('[data-qa-cargo="metal"]')`);
  await setField(win, '[data-qa-cargo="metal"]', '10000');
  await waitFor(win, `!document.querySelector('[data-qa-flight-dispatch-confirm]')?.disabled`);
  await click(win, '[data-qa-flight-dispatch-confirm]');
  await waitFor(win, `JSON.parse(localStorage.getItem(${JSON.stringify(TEST_KEY)}) || '{}')?.flights?.records?.filter((f) => f.missionId === 'aid' && f.ownerSide !== 'npc').length === 2`);
  save = await readSave(win, TEST_KEY);
  const manual = save.flights.records.filter((f) => f.missionId === 'aid' && f.ownerSide !== 'npc').at(-1);
  assert(manual.aid.requestId === choices[1].value && manual.cargo.metal === 10000, `${label}: the manually chosen request is the one that was served`, manual);
}

async function productionScenario(win, label) {
  await load(win, 'production');
  await run(win, `localStorage.removeItem(${JSON.stringify(PRODUCTION_KEY)}); localStorage.removeItem(${JSON.stringify(TEST_KEY)});`);
  await reload(win, 'production');
  await patchSave(win, PRODUCTION_KEY, `(save) => { save.planets['helion-01'].buildings['planetary-government'] = 1; }`);
  await reload(win, 'production');
  await openRoute(win, 'command', '.command-view');
  await click(win, '[data-qa-create-alliance]');
  await setField(win, '[data-qa-alliance-name]', 'Дозор Помощи');
  await setField(win, '[data-qa-alliance-tag]', 'DPM');
  await click(win, '[data-qa-alliance-submit]');
  await waitFor(win, `document.querySelector('.command-view')?.getAttribute('data-qa-command-state') === 'leader'`);
  await click(win, '[data-qa-command-tab="requests"]');
  await waitFor(win, `document.querySelector('[data-qa-requests]')`);
  const state = await view(win);
  assert(!state.testBox, `${label}: production has no Ira Vel scenario`, state);
  assert(state.charges.startsWith('0/3') && state.createDisabled && /заряд/i.test(state.blocker), `${label}: production starts with 0/3 and a blocked form`, state);
  assert(state.incoming.length === 0 && state.mine.length === 0, `${label}: production has no fabricated requests`, state);
  const save = await readSave(win, PRODUCTION_KEY);
  assert(save.command.requests.length === 0 && save.flights.records.length === 0 && Object.keys(save.alliedPlanets || {}).length === 0, `${label}: production stays free of fixtures and gifts`, save.command);
  await capture(win, label, 'production-requests');
}

async function runViewport(width, height) {
  const label = `${width}x${height}`;
  const win = new BrowserWindow({ width, height, show: false, webPreferences: { sandbox: false, partition: 'command-aid-qa-isolated' } });
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
    console.log('command-aid-qa: PASS');
    app.quit();
  } catch (error) {
    console.error(error);
    app.exit(1);
  }
});
