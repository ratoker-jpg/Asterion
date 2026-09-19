const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');
const {
  assertBuiltFactionGeneralAssets,
  assertRenderedFactionGeneralPortraits,
  getBuiltFactionGeneralAssets,
  inspectFactionGeneralAssets,
  inspectRenderedFactionGeneralPortraits,
} = require('./faction-general-qa.cjs');

app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-gpu');
app.on('window-all-closed', () => {});

const ROOT = path.join(__dirname, '..');
const OUTPUT = process.env.ASTERION_QA_OUTPUT || path.join(ROOT, 'artifacts-pass1', 'production-test-isolation-qa');
const PRODUCTION_KEY = 'asterion.vertical-slice.v1';
const TEST_KEY = 'asterion.vertical-slice.test.v1';
const VIEWPORTS = [[1920, 1080], [1280, 720]];
const BUILT_FACTION_GENERAL_ASSETS = getBuiltFactionGeneralAssets(ROOT);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const skipScreenshots = process.env.ASTERION_SKIP_SCREENSHOTS === '1';

async function waitFor(win, expression, timeoutMs = 10_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await win.webContents.executeJavaScript(`Boolean(${expression})`)) return;
    await sleep(60);
  }
  throw new Error(`Timed out waiting for: ${expression}`);
}

async function settle(win) {
  await sleep(120);
}

async function loadMode(win, mode) {
  const done = new Promise((resolve) => win.webContents.once('did-finish-load', resolve));
  await win.loadFile(path.join(ROOT, 'dist', 'index.html'), mode === 'test' ? { search: '?mode=test' } : undefined);
  await done;
  await waitFor(win, `document.querySelector('[data-qa-navigation="utility"]')`);
  await waitFor(win, `localStorage.getItem(${JSON.stringify(mode === 'test' ? TEST_KEY : PRODUCTION_KEY)})`);
  await settle(win);
}

async function reload(win, mode) {
  const done = new Promise((resolve) => win.webContents.once('did-finish-load', resolve));
  win.webContents.reload();
  await done;
  await waitFor(win, `document.querySelector('[data-qa-navigation="utility"]')`);
  await waitFor(win, `localStorage.getItem(${JSON.stringify(mode === 'test' ? TEST_KEY : PRODUCTION_KEY)})`);
  await settle(win);
}

async function clickRoute(win, navigation, route, waitExpression) {
  const clicked = await win.webContents.executeJavaScript(`(() => {
    const button = document.querySelector('[data-qa-navigation="${navigation}"] [data-qa-route="${route}"]');
    if (!button || button.disabled) return false;
    button.click();
    return true;
  })()`);
  if (!clicked) throw new Error(`Route not found: ${navigation}/${route}`);
  await waitFor(win, waitExpression);
  await settle(win);
}

async function readEnvelope(win, key) {
  return win.webContents.executeJavaScript(`JSON.parse(localStorage.getItem(${JSON.stringify(key)}) || 'null')`);
}

async function capture(win, directory, name) {
  if (skipScreenshots) return;
  fs.mkdirSync(directory, { recursive: true });
  const image = await win.capturePage({ x: 0, y: 0, width: win.getContentSize()[0], height: win.getContentSize()[1] });
  fs.writeFileSync(path.join(directory, `${name}.png`), image.toPNG());
}

async function inspectMode(win, mode, label) {
  const expectedNpcCount = mode === 'test' ? 8 : 0;
  const expectedReports = mode === 'test' ? 3 : 0;
  const expectedOperations = mode === 'test' ? 4 : 0;
  const envelope = await readEnvelope(win, mode === 'test' ? TEST_KEY : PRODUCTION_KEY);
  const modeMarker = await win.webContents.executeJavaScript(`document.querySelector('[data-qa-runtime-mode]')?.getAttribute('data-qa-runtime-mode') || ''`);
  if (modeMarker !== mode) throw new Error(`${label}: runtime mode marker mismatch ${modeMarker}`);

  await clickRoute(win, 'primary', 'command', `document.querySelector('.command-view')`);
  const command = await win.webContents.executeJavaScript(`(() => ({
    empty: Boolean(document.querySelector('[data-qa-command-empty]')),
    createAlliance: document.querySelector('[data-qa-create-alliance]')?.textContent?.trim() || '',
    status: document.querySelector('.command-view__status strong')?.textContent?.trim() || '',
  }))()`);
  if (mode === 'production' && (!command.empty || command.createAlliance !== 'СОЗДАТЬ СОЮЗ' || command.status !== 'СОЮЗ НЕ СОЗДАН')) {
    throw new Error(`${label}: production command empty state mismatch ${JSON.stringify(command)}`);
  }
  if (mode === 'test' && (command.empty || !command.status.includes('Содружество Гелион'))) {
    throw new Error(`${label}: test command fixture mismatch ${JSON.stringify(command)}`);
  }
  await capture(win, path.join(OUTPUT, label), `${mode}-command`);

  await clickRoute(win, 'utility', 'rating', `document.querySelector('[data-qa-utility-screen="rating"]')`);
  const playerRating = await win.webContents.executeJavaScript(`(() => ({
    rows: document.querySelectorAll('[data-qa-rating-player-row]').length,
    empty: Boolean(document.querySelector('[data-qa-rating-empty]')),
  }))()`);
  if (mode === 'production' && (playerRating.rows !== 1 || playerRating.empty)) throw new Error(`${label}: production player rating mismatch ${JSON.stringify(playerRating)}`);
  if (mode === 'test' && playerRating.rows === 0) throw new Error(`${label}: test player rating is empty`);
  await win.webContents.executeJavaScript(`Array.from(document.querySelectorAll('.rating-mode-tabs-v2 button')).find((node) => node.textContent?.trim() === 'АЛЬЯНСЫ')?.click()`);
  await settle(win);
  const allianceRating = await win.webContents.executeJavaScript(`({ empty: Boolean(document.querySelector('[data-qa-rating-empty]')), rows: document.querySelectorAll('.rating-table-v2--alliances .rating-row-v2:not(.rating-head-v2)').length })`);
  if (mode === 'production' && (!allianceRating.empty || allianceRating.rows !== 0)) throw new Error(`${label}: production alliance rating mismatch ${JSON.stringify(allianceRating)}`);
  if (mode === 'test' && (allianceRating.empty || allianceRating.rows === 0)) throw new Error(`${label}: test alliance rating is empty ${JSON.stringify(allianceRating)}`);
  await capture(win, path.join(OUTPUT, label), `${mode}-rating`);

  await clickRoute(win, 'primary', 'reports', `document.querySelector('[data-qa-profile]')`);
  const profile = await win.webContents.executeJavaScript(`({
    general: document.querySelector('[data-qa-profile] [data-qa-faction-general]')?.getAttribute('data-faction') || '',
    battleFolders: document.querySelectorAll('[data-message-folder="battle"]').length,
    fixtureNote: Boolean(document.querySelector('[data-qa-profile] .reports-fixture-note')),
  })`);
  if (profile.general !== 'aegis' || profile.battleFolders !== 1) throw new Error(`${label}: faction profile contract mismatch ${JSON.stringify(profile)}`);
  const profilePortraits = await inspectRenderedFactionGeneralPortraits(win, '[data-qa-profile] [data-qa-faction-general]');
  assertRenderedFactionGeneralPortraits(profilePortraits, ['aegis'], `${label} profile`);
  if (profile.fixtureNote !== (mode === 'test')) throw new Error(`${label}: profile fixture note visibility mismatch ${JSON.stringify(profile)}`);
  await win.webContents.executeJavaScript(`document.querySelector('[data-message-folder="battle"]')?.click()`);
  await waitFor(win, `document.querySelector('[data-qa-folder-view="battle"]')`);
  await settle(win);
  const reports = await win.webContents.executeJavaScript(`({ rows: document.querySelectorAll('[data-qa-message-list] .reports-list-item').length, empty: Boolean(document.querySelector('[data-qa-folder-view="battle"] [data-qa-empty-folder]')) || Boolean(document.querySelector('.reports-empty-dossier')) })`);
  if (mode === 'production' && reports.rows !== 0) throw new Error(`${label}: production reports contain demo rows ${JSON.stringify(reports)}`);
  if (mode === 'test' && reports.rows === 0) throw new Error(`${label}: test reports have no battle rows ${JSON.stringify(reports)}`);
  await capture(win, path.join(OUTPUT, label), `${mode}-reports`);

  await clickRoute(win, 'primary', 'universe', `document.querySelector('[data-qa-universe]')`);
  const universe = await win.webContents.executeJavaScript(`({
    marker: document.querySelector('[data-qa-universe]')?.getAttribute('data-qa-universe-npc-count') || '',
    nodes: document.querySelectorAll('[data-qa-universe-kind="npc"]').length,
  })`);
  if (Number(universe.marker) !== expectedNpcCount || (mode === 'production' && universe.nodes !== 0)) throw new Error(`${label}: NPC isolation mismatch ${JSON.stringify(universe)}`);
  if (mode === 'test') {
    let npcPortrait = '';
    for (let system = 1; system <= 40 && !npcPortrait; system += 1) {
      await win.webContents.executeJavaScript(`(() => { const select = document.querySelector('select[aria-label="Солнечная система"]'); if (select) { select.value = '${system}'; select.dispatchEvent(new Event('change', { bubbles: true })); } })()`);
      await settle(win);
      npcPortrait = await win.webContents.executeJavaScript(`document.querySelector('[data-qa-universe-kind="npc"][data-qa-universe-relation="neutral"]')?.getAttribute('data-qa-universe-object') || ''`);
    }
    if (!npcPortrait) throw new Error(`${label}: Test Mode NPC nodes were not reachable from the universe selector`);
    await win.webContents.executeJavaScript(`document.querySelector('[data-qa-universe-object="${npcPortrait}"]')?.click()`);
    await waitFor(win, `document.querySelector('[data-qa-universe-inspector]')`);
    const npcPortraits = await inspectRenderedFactionGeneralPortraits(win, '[data-qa-universe-inspector] [data-qa-faction-general]');
    assertRenderedFactionGeneralPortraits(npcPortraits, ['veyra'], `${label} universe`);
  }
  await capture(win, path.join(OUTPUT, label), `${mode}-universe`);

  if (envelope?.combat?.reports?.length !== expectedReports || envelope?.operations?.items?.length !== expectedOperations) {
    throw new Error(`${label}: persisted fixture counts mismatch ${JSON.stringify({ reports: envelope?.combat?.reports?.length, operations: envelope?.operations?.items?.length })}`);
  }
  return envelope;
}

async function runViewport(width, height) {
  const label = `${width}x${height}`;
  const win = new BrowserWindow({ width, height, show: false, webPreferences: { sandbox: false } });
  win.webContents.on('console-message', (_event, _level, message) => {
    if (/error/i.test(message)) console.warn(`[${label}] renderer: ${message}`);
  });
  try {
    await loadMode(win, 'production');
    await win.webContents.executeJavaScript(`localStorage.removeItem(${JSON.stringify(PRODUCTION_KEY)}); localStorage.removeItem(${JSON.stringify(TEST_KEY)});`);
    await reload(win, 'production');
    const builtAssets = await inspectFactionGeneralAssets(win, BUILT_FACTION_GENERAL_ASSETS);
    assertBuiltFactionGeneralAssets(builtAssets, `${label} build`);
    const productionBefore = await inspectMode(win, 'production', label);
    await loadMode(win, 'test');
    const testEnvelope = await inspectMode(win, 'test', label);
    await reload(win, 'test');
    const testReloaded = await readEnvelope(win, TEST_KEY);
    if (testReloaded?.combat?.reports?.length !== testEnvelope?.combat?.reports?.length || testReloaded?.command?.alliance?.name !== 'Содружество Гелион') {
      throw new Error(`${label}: Test Mode reload lost fixtures`);
    }
    const productionAfterTest = await readEnvelope(win, PRODUCTION_KEY);
    if (productionAfterTest?.command?.alliance?.name !== productionBefore?.command?.alliance?.name || productionAfterTest?.combat?.reports?.length !== productionBefore?.combat?.reports?.length) {
      throw new Error(`${label}: Test Mode mutated Production save`);
    }
  } finally {
    if (!win.isDestroyed()) win.destroy();
  }
}

app.whenReady().then(async () => {
  try {
    for (const [width, height] of VIEWPORTS) await runViewport(width, height);
    console.log('production-test-isolation-qa: PASS');
    app.quit();
  } catch (error) {
    console.error(error);
    app.exit(1);
  }
});
