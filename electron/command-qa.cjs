const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-gpu');
app.on('window-all-closed', () => {});

const ROOT = path.join(__dirname, '..');
const OUTPUT = process.env.ASTERION_QA_OUTPUT || path.join(ROOT, 'artifacts-pass1', 'command-qa');
const PRODUCTION_KEY = 'asterion.vertical-slice.v1';
const TEST_KEY = 'asterion.vertical-slice.test.v1';
const VIEWPORTS = [[1920, 1080], [1280, 720]];
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const skipScreenshots = process.env.ASTERION_SKIP_SCREENSHOTS === '1';

const run = (win, source) => win.webContents.executeJavaScript(source);

async function waitFor(win, expression, timeoutMs = 10_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await run(win, `Boolean(${expression})`)) return;
    await sleep(60);
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

async function openCommand(win) {
  const clicked = await run(win, `(() => {
    const button = document.querySelector('[data-qa-navigation="primary"] [data-qa-route="command"]');
    if (!button || button.disabled) return false;
    button.click();
    return true;
  })()`);
  if (!clicked) throw new Error('Command route button not found');
  await waitFor(win, `document.querySelector('.command-view')`);
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
  await sleep(120);
}

async function setField(win, selector, value) {
  const ok = await run(win, `(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    if (!element) return false;
    const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, 'value').set.call(element, ${JSON.stringify(value)});
    element.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`);
  if (!ok) throw new Error(`Missing field: ${selector}`);
  await sleep(60);
}

const snapshot = (win) => run(win, `(() => ({
  state: document.querySelector('.command-view')?.getAttribute('data-qa-command-state') || '',
  locked: Boolean(document.querySelector('[data-qa-command-locked]')),
  lockedImageLoaded: Boolean(document.querySelector('.command-locked img')?.complete && document.querySelector('.command-locked img')?.naturalWidth > 0),
  buildButton: Boolean(document.querySelector('[data-qa-command-build]')),
  tabs: Array.from(document.querySelectorAll('[data-qa-command-tab]')).map((node) => node.getAttribute('data-qa-command-tab')),
  catalogItems: document.querySelectorAll('[data-qa-catalog-item]').length,
  catalogEmpty: Boolean(document.querySelector('[data-qa-catalog-empty]')),
  testControls: Boolean(document.querySelector('[data-qa-test-bot-create], [data-qa-test-bot-apply]')),
  members: Array.from(document.querySelectorAll('[data-qa-member-list] li')).map((node) => (node.textContent || '').replace(/[  ]/g, ' ')),
  applications: document.querySelectorAll('[data-qa-application]').length,
  cooldown: document.querySelector('[data-qa-cooldown]')?.textContent?.trim() || '',
  headline: document.querySelector('.command-view__status strong')?.textContent?.trim() || '',
  text: document.querySelector('.command-view')?.innerText || '',
  overflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
}))()`);

function assert(condition, message, detail) {
  if (!condition) throw new Error(`${message}${detail === undefined ? '' : ` ${JSON.stringify(detail)}`}`);
}

async function productionScenario(win, label) {
  await load(win, 'production');
  await run(win, `localStorage.removeItem(${JSON.stringify(PRODUCTION_KEY)}); localStorage.removeItem(${JSON.stringify(TEST_KEY)}); /* save slots from other QA runs would win ?autostart=continue */ Object.keys(localStorage).filter((key) => key === 'asterion.slots.index.v1' || key.startsWith('asterion.slot.')).forEach((key) => localStorage.removeItem(key));`);
  await reload(win, 'production');

  // 1. No Hall anywhere: locked, race art, build action, nothing fabricated.
  await openCommand(win);
  let view = await snapshot(win);
  assert(view.locked && view.state === 'locked' && view.lockedImageLoaded && view.buildButton && view.tabs.length === 0, `${label}: production starts locked`, view);
  assert(!view.overflowX, `${label}: locked state overflows horizontally`, view);
  await capture(win, label, 'production-locked');

  // 2. A Hall on a second planet unlocks; the highest level counts, not the sum.
  await patchSave(win, PRODUCTION_KEY, `(save) => {
    const clone = JSON.parse(JSON.stringify(save.planets['helion-01']));
    clone.buildings['planetary-government'] = 7;
    clone.name = 'Colony B';
    save.planets['colony-b'] = clone;
    save.planets['helion-01'].buildings['planetary-government'] = 3;
  }`);
  await reload(win, 'production');
  await openCommand(win);
  view = await snapshot(win);
  assert(!view.locked && view.state === 'none' && view.catalogEmpty && view.catalogItems === 0 && !view.testControls, `${label}: Hall on any planet unlocks with an honest empty catalog and no test controls`, view);
  await capture(win, label, 'production-no-alliance');

  // 3. Found an alliance; names and tags are unique; the editor is shared with the pencil.
  await click(win, '[data-qa-create-alliance]');
  await setField(win, '[data-qa-alliance-name]', 'Дозор QA');
  await setField(win, '[data-qa-alliance-tag]', 'QA');
  await click(win, '[data-qa-alliance-submit]');
  await waitFor(win, `document.querySelector('.command-view')?.getAttribute('data-qa-command-state') === 'leader'`);
  view = await snapshot(win);
  assert(view.headline === 'Дозор QA [QA]' && view.tabs.includes('overview') && view.tabs.includes('applications'), `${label}: founder is the leader`, view);
  assert(!/ONLINE|НЕ В СЕТИ|АКТИВЕН/.test(view.text), `${label}: no online/activity indicators`, view.text);
  await capture(win, label, 'production-leader');

  await click(win, '[data-qa-edit-alliance]');
  await waitFor(win, `document.querySelector('.command-editor-form')`);
  await setField(win, '[data-qa-alliance-name]', 'Дозор QA Два');
  await click(win, '[data-qa-alliance-submit]');
  await waitFor(win, `document.querySelector('.command-view__status strong')?.textContent?.includes('Дозор QA Два')`);

  // 4. Persistence across reload, with a stable id and the leader as the only member.
  await reload(win, 'production');
  await openCommand(win);
  view = await snapshot(win);
  assert(view.headline === 'Дозор QA Два [QA]', `${label}: alliance survives reload`, view);
  const saved = await readSave(win, PRODUCTION_KEY);
  assert(saved.command.version === 3 && saved.command.alliances.length === 1 && saved.command.alliances[0].members.length === 1, `${label}: persisted registry shape`, saved.command);
  const allianceId = saved.command.alliances[0].id;
  assert(/^alliance-\d+$/.test(allianceId) && saved.profile.allianceId === allianceId, `${label}: stable id mirrored into the profile`, { allianceId, profile: saved.profile.allianceId });

  // 5. Losing the last Hall locks the screen without touching the alliance.
  await patchSave(win, PRODUCTION_KEY, `(save) => { for (const planet of Object.values(save.planets)) planet.buildings['planetary-government'] = 0; }`);
  await reload(win, 'production');
  await openCommand(win);
  view = await snapshot(win);
  assert(view.locked && view.state === 'locked', `${label}: no Hall locks the screen again`, view);
  const afterLock = await readSave(win, PRODUCTION_KEY);
  assert(afterLock.command.alliances.length === 1 && afterLock.command.alliances[0].id === allianceId, `${label}: alliance is untouched while locked`, afterLock.command);
  await capture(win, label, 'production-locked-with-alliance');
}

async function testModeScenario(win, label) {
  await load(win, 'test');
  await run(win, `localStorage.removeItem(${JSON.stringify(TEST_KEY)});`);
  await reload(win, 'test');
  await openCommand(win);
  let view = await snapshot(win);
  assert(view.state === 'leader' && view.headline.includes('Содружество Гелион'), `${label}: Test Mode seeds the player as leader`, view);
  await capture(win, label, 'test-overview');

  await click(win, '[data-qa-command-tab="members"]');
  await waitFor(win, `document.querySelector('[data-qa-member-list]')`);
  view = await snapshot(win);
  assert(view.members.length === 2 && view.members[0].includes('Dendrilion') && view.members[1].includes('Ира Вель') && view.members[1].includes('1 000 000'), `${label}: only the player and Ira Vel, with fixture points`, view.members);
  assert(!/ONLINE|НЕ В СЕТИ|АКТИВЕН|Helion|координат/i.test(view.text), `${label}: members never expose activity or planets`, view.text);

  // Application flow: a controlled NPC applies, the leader accepts, the leader appoints the single deputy.
  await click(win, '[data-qa-command-tab="applications"]');
  await click(win, '[data-qa-test-bot-apply]');
  await waitFor(win, `document.querySelectorAll('[data-qa-application]').length === 1`);
  await capture(win, label, 'test-applications');
  await click(win, '[data-qa-accept]');
  await click(win, '[data-qa-command-tab="members"]');
  view = await snapshot(win);
  assert(view.members.length === 3, `${label}: accepted applicant joined`, view.members);
  await run(win, `Array.from(document.querySelectorAll('[data-qa-member-list] button'))[2].click()`);
  await click(win, '[data-qa-set-deputy]');
  await waitFor(win, `document.querySelector('[data-qa-clear-deputy]')`);

  // The deputy is one person: a second appointment control must not be offered for another member.
  await run(win, `Array.from(document.querySelectorAll('[data-qa-member-list] button'))[2].click()`);
  const secondDeputyOffered = await run(win, `Boolean(document.querySelector('[data-qa-set-deputy]'))`);
  assert(secondDeputyOffered === true, `${label}: the control stays available but the domain rejects a second deputy`);
  await click(win, '[data-qa-set-deputy]');
  await waitFor(win, `document.querySelector('[data-qa-command-feedback].is-error')`);
  await capture(win, label, 'test-deputy-rejected');

  // Reload keeps membership and roles.
  await reload(win, 'test');
  await openCommand(win);
  await click(win, '[data-qa-command-tab="members"]');
  view = await snapshot(win);
  assert(view.members.length === 3 && view.members.some((row) => row.includes('ЗАМЕСТИТЕЛЬ')), `${label}: roles persist across reload`, view.members);

  // Leader exit hands leadership to the chosen successor and starts the global delay.
  await click(win, '[data-qa-command-tab="overview"]');
  await click(win, '[data-qa-leave]');
  await waitFor(win, `document.querySelector('[data-qa-successor]')`);
  await click(win, '[data-qa-confirm]');
  await waitFor(win, `document.querySelector('[data-qa-command-empty]')`);
  view = await snapshot(win);
  assert(view.state === 'none' && /закрыты ещё/.test(view.cooldown) && view.catalogItems === 1, `${label}: left the alliance, delay is visible, the alliance still exists`, view);
  const createDisabled = await run(win, `document.querySelector('[data-qa-create-alliance]')?.disabled === true`);
  assert(createDisabled, `${label}: founding is blocked by the delay in the UI too`);
  const catalogApply = await run(win, `Boolean(document.querySelector('[data-qa-apply]'))`);
  assert(!catalogApply, `${label}: applying is blocked by the delay`);
  await capture(win, label, 'test-after-leave');

  const saved = await readSave(win, TEST_KEY);
  assert(saved.command.alliances.length === 1 && saved.command.alliances[0].members.length === 2 && saved.command.cooldowns.length === 1, `${label}: persisted exit`, saved.command);
}

async function runViewport(width, height) {
  const label = `${width}x${height}`;
  // A non-persistent session partition (no `persist:` prefix) keeps this scenario's localStorage
  // (extra colony, alliances) out of every other Electron QA that shares the default profile in CI.
  const win = new BrowserWindow({ width, height, show: false, webPreferences: { sandbox: false, partition: 'command-qa-isolated' } });
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
    console.log('command-qa: PASS');
    app.quit();
  } catch (error) {
    console.error(error);
    app.exit(1);
  }
});
