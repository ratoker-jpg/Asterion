const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-gpu');
app.on('window-all-closed', () => {});

const ROOT = path.join(__dirname, '..');
const OUTPUT = path.join(ROOT, 'artifacts', 'reports-profile-qa');
const SAVE_KEY = 'asterion.vertical-slice.v1';
const VIEWPORTS = [[1920, 1080], [1280, 720]];
const EXPECTED_FOLDER_IDS = ['system', 'battle', 'command', 'arena', 'flights', 'alliances', 'achievements'];
const EXPECTED_FOLDER_LABELS = ['Система', 'Доклады', 'Командные доклады', 'Арена', 'Полёты', 'Союзы', 'Достижения'];
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(win, expression, timeoutMs = 8000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await win.webContents.executeJavaScript(`Boolean(${expression})`)) return;
    await sleep(60);
  }
  throw new Error(`Timed out waiting for: ${expression}`);
}

async function settle(win) {
  await win.webContents.executeJavaScript('new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
  await sleep(80);
}

async function reload(win) {
  const done = new Promise((resolve) => win.webContents.once('did-finish-load', resolve));
  win.webContents.reload();
  await done;
  await waitFor(win, `document.querySelector('.primary-navigation')`);
  await win.webContents.executeJavaScript('document.fonts?.ready');
  await settle(win);
}

async function clickPrimary(win, label) {
  const clicked = await win.webContents.executeJavaScript(`(() => {
    const button = Array.from(document.querySelectorAll('.primary-navigation button')).find((item) => item.textContent?.trim() === ${JSON.stringify(label)});
    if (!button) return false;
    button.click();
    return true;
  })()`);
  if (!clicked) throw new Error(`Primary navigation button not found: ${label}`);
  await waitFor(win, `document.querySelector('[data-qa-profile]')`);
  await settle(win);
}

async function clickFolder(win, id) {
  const clicked = await win.webContents.executeJavaScript(`(() => {
    const button = document.querySelector('[data-message-folder="${id}"]');
    if (!button) return false;
    button.click();
    return true;
  })()`);
  if (!clicked) throw new Error(`Message folder not found: ${id}`);
  await waitFor(win, `document.querySelector('[data-qa-folder-view="${id}"]')`);
  await settle(win);
}

async function capture(win, directory, name) {
  const image = await win.webContents.capturePage();
  fs.writeFileSync(path.join(directory, `${name}.png`), image.toPNG());
}

async function profileSnapshot(win) {
  return win.webContents.executeJavaScript(`(() => {
    const root = document.documentElement;
    const profile = document.querySelector('[data-qa-profile]');
    const metricValues = Array.from(document.querySelectorAll('[data-qa-profile-metric]')).map((item) => item.textContent?.replace(/\\s+/g, ' ').trim() ?? '');
    return {
      visible: Boolean(profile),
      name: profile?.querySelector('h3')?.textContent?.trim() ?? '',
      avatar: profile?.querySelector('.reports-profile-avatar img')?.getAttribute('src') ?? '',
      alliance: profile?.querySelector('.reports-profile-alliance-link strong')?.textContent?.trim() ?? '',
      metricValues,
      folderIds: Array.from(document.querySelectorAll('[data-message-folder]')).map((item) => item.getAttribute('data-message-folder') || ''),
      folderLabels: Array.from(document.querySelectorAll('[data-message-folder] strong')).map((item) => item.textContent?.trim() || ''),
      focusableMetrics: document.querySelectorAll('[data-qa-profile-metric][tabindex="0"]').length,
      viewport: { innerWidth: window.innerWidth, innerHeight: window.innerHeight, devicePixelRatio: window.devicePixelRatio },
      stageRect: (() => { const rect = document.querySelector('.stage')?.getBoundingClientRect(); return rect ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height } : null; })(),
      horizontalOverflow: root.scrollWidth > root.clientWidth + 2,
      bodyHorizontalOverflow: document.body.scrollWidth > document.body.clientWidth + 2,
    };
  })()`);
}

async function savedState(win) {
  return win.webContents.executeJavaScript(`(() => {
    try { return JSON.parse(localStorage.getItem(${JSON.stringify(SAVE_KEY)}) || '{}'); } catch { return {}; }
  })()`);
}

async function runViewport(win, width, height) {
  const label = `${width}x${height}`;
  const directory = path.join(OUTPUT, label);
  fs.mkdirSync(directory, { recursive: true });
  win.setContentSize(width, height);
  await settle(win);
  await win.webContents.executeJavaScript(`localStorage.removeItem(${JSON.stringify(SAVE_KEY)}); localStorage.removeItem('asterion.preferences.v2');`);
  await reload(win);
  await clickPrimary(win, 'Сообщения');

  const profile = await profileSnapshot(win);
  if (!profile.visible || profile.name !== 'Dendrilion' || !profile.avatar.includes('aegis_profile_avatar') || profile.alliance !== 'Содружество Гелион') throw new Error(`Profile contract failed at ${label}: ${JSON.stringify(profile)}`);
  if (JSON.stringify(profile.folderIds) !== JSON.stringify(EXPECTED_FOLDER_IDS) || JSON.stringify(profile.folderLabels) !== JSON.stringify(EXPECTED_FOLDER_LABELS)) throw new Error(`Reports folder contract failed at ${label}: ${JSON.stringify(profile)}`);
  if (profile.metricValues.length !== 4 || profile.focusableMetrics !== 4 || profile.horizontalOverflow || profile.bodyHorizontalOverflow) throw new Error(`Profile geometry/metrics contract failed at ${label}: ${JSON.stringify(profile)}`);
  await win.webContents.executeJavaScript(`document.querySelector('[data-qa-profile-metric="resourcePoints"]')?.focus()`);
  const metricFocus = await win.webContents.executeJavaScript(`document.activeElement?.getAttribute('data-qa-profile-metric') || ''`);
  if (metricFocus !== 'resourcePoints') throw new Error(`Profile metric keyboard focus failed at ${label}: ${metricFocus}`);
  await capture(win, directory, 'profile');

  const beforeActiveAlliance = await savedState(win);
  await win.webContents.executeJavaScript(`(() => {
    const save = JSON.parse(localStorage.getItem(${JSON.stringify(SAVE_KEY)}) || '{}');
    save.profile = { playerId: 'player-current', displayName: 'Dendrilion', factionId: 'aegis', allianceId: 'alliance-ion', alliance: { id: 'alliance-ion', name: 'Ion Pact', tag: 'ION', emblem: { glyph: 'orbit', accent: 'violet' } }, protectionMode: false };
    localStorage.setItem(${JSON.stringify(SAVE_KEY)}, JSON.stringify(save));
  })()`);
  await reload(win);
  await clickPrimary(win, 'Сообщения');
  await waitFor(win, `document.querySelector('.reports-profile-alliance-link')`);
  await win.webContents.executeJavaScript(`document.querySelector('.reports-profile-alliance-link')?.click()`);
  await waitFor(win, `document.querySelector('.command-view')`);
  const commandRoute = await win.webContents.executeJavaScript(`document.querySelector('.command-view')?.getAttribute('aria-label') || ''`);
  if (commandRoute !== 'Командование союза') throw new Error(`Alliance command route failed at ${label}: ${commandRoute}`);

  await win.webContents.executeJavaScript(`localStorage.setItem(${JSON.stringify(SAVE_KEY)}, ${JSON.stringify(JSON.stringify(beforeActiveAlliance))})`);
  await reload(win);
  await clickPrimary(win, 'Сообщения');
  await clickFolder(win, 'alliances');
  const allianceBefore = await win.webContents.executeJavaScript(`(() => ({
    total: document.querySelectorAll('[data-qa-message-list] .reports-list-item').length,
    deleteAllDisabled: Boolean(document.querySelector('[data-qa-delete-all]')?.disabled),
    deleteSelectedDisabled: Boolean(document.querySelector('[data-qa-delete-selected]')?.disabled),
  }))()`);
  if (allianceBefore.total < 1 || allianceBefore.deleteAllDisabled) throw new Error(`Alliance deletion controls failed at ${label}: ${JSON.stringify(allianceBefore)}`);
  await win.webContents.executeJavaScript(`window.confirm = () => true; document.querySelector('[data-qa-message-list] input[type="checkbox"]')?.click(); document.querySelector('[data-qa-delete-selected]')?.click();`);
  await waitFor(win, `document.querySelector('[data-qa-delete-selected]')?.disabled === true`);
  const afterAllianceDelete = await savedState(win);
  if (!afterAllianceDelete.reports?.hiddenIds?.some((id) => id.startsWith('alliance:operation:'))) throw new Error(`Alliance tombstone missing at ${label}: ${JSON.stringify(afterAllianceDelete.reports)}`);
  await capture(win, directory, 'alliances-after-delete');

  const battleBefore = await savedState(win);
  if (!Array.isArray(battleBefore.combat?.reports) || battleBefore.combat.reports.length < 1) throw new Error(`Canonical battle fixture missing at ${label}`);
  const canonicalBattleId = battleBefore.combat.reports.find((report) => report.missionType !== 'simulation' && report.missionType !== 'arena')?.id;
  if (!canonicalBattleId) throw new Error(`Visible canonical battle fixture missing at ${label}`);
  const savedBattleIds = [...new Set([...(battleBefore.combat.savedReportIds || []), canonicalBattleId])];
  await win.webContents.executeJavaScript(`(() => { const save = JSON.parse(localStorage.getItem(${JSON.stringify(SAVE_KEY)}) || '{}'); save.combat.savedReportIds = ${JSON.stringify(savedBattleIds)}; localStorage.setItem(${JSON.stringify(SAVE_KEY)}, JSON.stringify(save)); })()`);
  await reload(win);
  await clickPrimary(win, 'Сообщения');
  await clickFolder(win, 'battle');
  await waitFor(win, `document.querySelector('[data-qa-message-list] .reports-list-item')`);
  await win.webContents.executeJavaScript(`window.confirm = () => true; document.querySelector('[data-qa-message-list] input[type="checkbox"]')?.click(); document.querySelector('[data-qa-delete-selected]')?.click();`);
  await waitFor(win, `document.querySelector('[data-qa-delete-selected]')?.disabled === true`);
  const afterBattleDelete = await savedState(win);
  if (afterBattleDelete.combat?.reports?.length !== battleBefore.combat.reports.length || !afterBattleDelete.combat.savedReportIds.includes(canonicalBattleId) || !afterBattleDelete.reports.hiddenIds.includes(`battle:${canonicalBattleId}`)) throw new Error(`Canonical battle preservation failed at ${label}: ${JSON.stringify({ before: battleBefore.combat, after: afterBattleDelete.combat, reports: afterBattleDelete.reports })}`);
  await capture(win, directory, 'battle-after-delete');

  await reload(win);
  await clickPrimary(win, 'Сообщения');
  await clickFolder(win, 'battle');
  const reloaded = await savedState(win);
  const persisted = await win.webContents.executeJavaScript(`(() => {
    const id = ${JSON.stringify(`battle:${canonicalBattleId}`)};
    const visible = Array.from(document.querySelectorAll('[data-report-item-id]')).some((item) => item.getAttribute('data-report-item-id') === id);
    return !visible && Boolean(document.querySelector('[data-qa-delete-selected]')?.disabled);
  })()`);
  if (!persisted || !reloaded.reports?.hiddenIds?.includes(`battle:${canonicalBattleId}`)) throw new Error(`Tombstone reload failed at ${label}: ${JSON.stringify({ persisted, reports: reloaded.reports })}`);

  return { viewport: label, profile, metricFocus, allianceBefore, canonicalBattleId, horizontalOverflow: profile.horizontalOverflow || profile.bodyHorizontalOverflow, persistedTombstone: true };
}

app.whenReady().then(async () => {
  let win;
  try {
    fs.rmSync(OUTPUT, { recursive: true, force: true });
    fs.mkdirSync(OUTPUT, { recursive: true });
    win = new BrowserWindow({ width: 1920, height: 1080, useContentSize: true, show: false, backgroundColor: '#02050a', webPreferences: { offscreen: true, contextIsolation: true, nodeIntegration: false, sandbox: true, partition: 'qa-reports-profile' } });
    await win.loadFile(path.join(ROOT, 'dist', 'index.html'));
    const results = [];
    for (const [width, height] of VIEWPORTS) results.push(await runViewport(win, width, height));
    fs.writeFileSync(path.join(OUTPUT, 'results.json'), JSON.stringify({ results }, null, 2));
    console.log('Reports/profile QA passed: profile landing, Aegis avatar/rating data, live alliance command route, folder deletion, tombstone reload and canonical battle preservation at both viewports.');
    win.destroy();
    app.exit(0);
  } catch (error) {
    console.error(error);
    win?.destroy();
    app.exit(1);
  }
});
