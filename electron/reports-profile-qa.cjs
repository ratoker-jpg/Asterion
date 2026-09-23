const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');
const {
  assertRenderedFactionGeneralPortraits,
  inspectRenderedFactionGeneralPortraits,
} = require('./faction-general-qa.cjs');

app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-gpu');
app.on('window-all-closed', () => {});

const ROOT = path.join(__dirname, '..');
const OUTPUT = process.env.ASTERION_QA_OUTPUT || path.join(ROOT, 'artifacts-pass1', 'reports-profile-qa');
const SAVE_KEY = 'asterion.vertical-slice.test.v1';
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
  await waitFor(win, `document.querySelector('[data-qa-navigation="primary"]')`);
  await win.webContents.executeJavaScript('document.fonts?.ready');
  await settle(win);
}

async function clickPrimary(win, route, waitExpression = `document.querySelector('[data-qa-profile]')`) {
  const clicked = await win.webContents.executeJavaScript(`(() => {
   const button = document.querySelector('[data-qa-navigation="primary"] [data-qa-route="${route}"]');
    if (!button) return false;
    button.click();
    return true;
  })()`);
  if (!clicked) throw new Error(`Primary navigation button not found: ${route}`);
  await waitFor(win, waitExpression);
  await settle(win);
}

async function clickUtility(win, route) {
  const clicked = await win.webContents.executeJavaScript(`(() => {
   const button = document.querySelector('[data-qa-navigation="utility"] [data-qa-route="${route}"]');
    if (!button) return false;
    button.click();
    return true;
  })()`);
  if (!clicked) throw new Error(`Utility navigation button not found: ${route}`);
  await waitFor(win, `document.querySelector('[data-qa-utility-screen="${route}"]')`);
  await settle(win);
}

async function ratingAllianceSnapshot(win) {
  return win.webContents.executeJavaScript(`(() => {
    const row = document.querySelector('.rating-row-v2.current');
    return {
      name: row?.querySelector('.identity-v2 strong')?.textContent?.trim() ?? '',
      tag: row?.querySelector('.alliance-tag-v2')?.textContent?.trim() ?? '',
      emblem: row?.querySelector('.command-emblem')?.className ?? '',
      visible: Boolean(row),
    };
  })()`);
}

async function showCurrentAllianceRating(win) {
  const clicked = await win.webContents.executeJavaScript(`(() => {
    const alliances = Array.from(document.querySelectorAll('.rating-mode-tabs-v2 button')).find((item) => item.textContent?.trim() === 'АЛЬЯНСЫ');
    alliances?.click();
    return Boolean(alliances);
  })()`);
  if (!clicked) throw new Error('Alliance rating mode button not found');
  await settle(win);
  const position = await win.webContents.executeJavaScript(`(() => {
    const button = Array.from(document.querySelectorAll('.rating-toolbar-v2 button')).find((item) => item.textContent?.trim() === 'ПОКАЗАТЬ МОЮ ПОЗИЦИЮ');
    button?.click();
    return Boolean(button);
  })()`);
  if (!position) throw new Error('Current rating position button not found');
  await waitFor(win, `document.querySelector('.rating-row-v2.current')`);
  await settle(win);
}

async function updateAllianceThroughCommand(win) {
  await clickPrimary(win, 'command', `document.querySelector('.command-view')`);
  const opened = await win.webContents.executeJavaScript(`(() => {
    const button = Array.from(document.querySelectorAll('.command-tabs button')).find((item) => item.textContent?.trim() === 'НАСТРОЙКИ СОЮЗА');
    button?.click();
    return Boolean(button);
  })()`);
  if (!opened) throw new Error('Command settings tab not found');
  await waitFor(win, `document.querySelector('.command-settings-form')`);
  await win.webContents.executeJavaScript(`(() => {
    const setValue = (selector, value) => {
      const element = document.querySelector(selector);
      if (!element) return false;
      const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
      setter?.call(element, value);
      element.dispatchEvent(new Event('input', { bubbles: true }));
      element.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    };
    setValue('.command-settings-form input', 'Содружество Север');
    setValue('.command-settings-form label:nth-child(2) input', 'NORTH');
  })()`);
  await settle(win);
  await win.webContents.executeJavaScript(`document.querySelector('.command-emblem-options button:nth-child(3)')?.click()`);
  await settle(win);
  await win.webContents.executeJavaScript(`document.querySelector('.command-accent-options button[aria-label="amber"]')?.click()`);
  await settle(win);
  await win.webContents.executeJavaScript(`document.querySelector('.command-settings-form button.primary')?.click()`);
  await waitFor(win, `document.querySelector('.command-view__status strong')?.textContent?.includes('Содружество Север')`);
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
      allianceTag: profile?.querySelector('.reports-profile-alliance-link small')?.textContent?.match(/\\[([^\\]]+)\\]/)?.[1] ?? '',
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
  await clickPrimary(win, 'reports');

  const episodeStartedAt = Date.now() - 10 * 60_000;
  const overpopulationReport = {
    id: `overpopulation:qa-colony:${episodeStartedAt}`,
    planetId: 'qa-colony',
    planetName: 'Колония QA',
    factionId: 'aegis',
    populationBefore: 35_000,
    populationAfter: 25_000,
    capacity: 25_000,
    episodeStartedAt,
    episodeEndedAt: Date.now(),
    removedShips: [{ shipId: 'scout', count: 12 }, { shipId: 'destroyer', count: 3 }],
  };
  const recyclerArrivalReports = [
    {
      id: 'recycler-arrival:qa-nonzero-flight',
      flightId: 'qa-nonzero-flight',
      coordinate: { galaxy: 2, system: 14, position: 7 },
      arrivedAtMs: Date.now() - 60_000,
      collectedDebris: 800,
      remainingOrbitalDebris: 200,
    },
    {
      id: 'recycler-arrival:qa-zero-flight',
      flightId: 'qa-zero-flight',
      coordinate: { galaxy: 1, system: 1, position: 3 },
      arrivedAtMs: Date.now() - 30_000,
      collectedDebris: 0,
      remainingOrbitalDebris: 0,
    },
  ];
  const seededReport = await win.webContents.executeJavaScript(`(() => {
    try {
      const save = JSON.parse(localStorage.getItem(${JSON.stringify(SAVE_KEY)}) || '{}');
      save.reports = { ...(save.reports || {}), overpopulationReports: [${JSON.stringify(overpopulationReport)}], recyclerArrivalReports: [${JSON.stringify(recyclerArrivalReports[0])}, ${JSON.stringify(recyclerArrivalReports[1])}] };
      localStorage.setItem(${JSON.stringify(SAVE_KEY)}, JSON.stringify(save));
      return true;
    } catch { return false; }
  })()`);
  if (!seededReport) throw new Error(`Unable to seed overpopulation report at ${label}`);
  await reload(win);
  await clickPrimary(win, 'reports');
  await clickFolder(win, 'system');
  const reportSelector = `[data-report-item-id="${overpopulationReport.id}"] .reports-list-open`;
  await waitFor(win, `document.querySelector(${JSON.stringify(reportSelector)})`);
  const openedReport = await win.webContents.executeJavaScript(`(() => {
    const button = document.querySelector(${JSON.stringify(reportSelector)});
    if (!button) return false;
    button.click();
    return true;
  })()`);
  if (!openedReport) throw new Error(`Overpopulation report row could not be opened at ${label}`);
  await waitFor(win, `document.querySelector('[data-qa-overpopulation-report="${overpopulationReport.id}"]')`);
  await waitFor(win, `Array.from(document.querySelectorAll('[data-qa-overpopulation-loss] img')).length === 2 && Array.from(document.querySelectorAll('[data-qa-overpopulation-loss] img')).every((image) => image.complete && image.naturalWidth > 0)`);
  const overpopulationDossier = await win.webContents.executeJavaScript(`(() => {
    const dossier = document.querySelector('[data-qa-overpopulation-report="${overpopulationReport.id}"]');
    const rawText = dossier?.textContent ?? '';
    const text = rawText.replace(/\\s+/g, '');
    return {
      visible: Boolean(dossier),
      unlocked: rawText.toLowerCase().includes('планета разблокирована'),
      planet: text.includes('КолонияQA'),
      populationBefore: text.includes('35000'),
      populationAfter: text.includes('25000'),
      lossCount: text.includes('15ед.'),
      losses: Array.from(dossier?.querySelectorAll('[data-qa-overpopulation-loss]') ?? []).map((node) => ({
        id: node.getAttribute('data-qa-overpopulation-loss'),
        count: node.querySelector('b')?.textContent?.trim() ?? '',
        imageLoaded: Boolean(node.querySelector('img')?.complete && node.querySelector('img')?.naturalWidth > 0),
      })),
    };
  })()`);
  if (!overpopulationDossier.visible || !overpopulationDossier.unlocked || !overpopulationDossier.planet || !overpopulationDossier.populationBefore || !overpopulationDossier.populationAfter || !overpopulationDossier.lossCount || overpopulationDossier.losses.length !== 2 || overpopulationDossier.losses.some((loss) => !loss.imageLoaded)) {
    throw new Error(`Overpopulation report dossier contract failed at ${label}: ${JSON.stringify(overpopulationDossier)}`);
  }
  await capture(win, directory, 'overpopulation-dossier');

  for (const [index, report] of recyclerArrivalReports.entries()) {
    const selector = `[data-report-item-id="${report.id}"] .reports-list-open`;
    await waitFor(win, `document.querySelector(${JSON.stringify(selector)})`);
    const opened = await win.webContents.executeJavaScript(`(() => {
      const button = document.querySelector(${JSON.stringify(selector)});
      if (!button) return false;
      button.click();
      return true;
    })()`);
    if (!opened) throw new Error(`Recycler arrival report row could not be opened at ${label}: ${report.id}`);
    await waitFor(win, `document.querySelector('.reports-dossier--generic')?.textContent?.includes(${JSON.stringify(`[${report.coordinate.galaxy}:${report.coordinate.system}:${report.coordinate.position}]`)})`);
    const dossier = await win.webContents.executeJavaScript(`(() => {
      const node = document.querySelector('.reports-dossier--generic');
      const text = node?.textContent?.replace(/\\s+/g, ' ') ?? '';
      return {
        visible: Boolean(node),
        coordinate: text.includes(${JSON.stringify(`[${report.coordinate.galaxy}:${report.coordinate.system}:${report.coordinate.position}]`)}),
        collected: text.includes(${JSON.stringify(String(report.collectedDebris))}),
        remaining: text.includes(${JSON.stringify(String(report.remainingOrbitalDebris))}),
        zeroMessage: text.includes('На орбите обломков не найдено'),
        revealsCargo: /газ|груз|запас газа/i.test(text),
      };
    })()`);
    if (!dossier.visible || !dossier.coordinate || !dossier.collected || !dossier.remaining
      || (report.collectedDebris === 0 && !dossier.zeroMessage) || dossier.revealsCargo) {
      throw new Error(`Recycler arrival dossier contract failed at ${label}: ${JSON.stringify({ report, dossier })}`);
    }
    await capture(win, directory, index === 0 ? 'recycler-arrival-nonzero' : 'recycler-arrival-zero');
  }

  await reload(win);
  await clickPrimary(win, 'reports');
  await clickFolder(win, 'system');
  for (const report of recyclerArrivalReports) {
    const selector = `[data-report-item-id="${report.id}"]`;
    const persistedCount = await win.webContents.executeJavaScript(`document.querySelectorAll(${JSON.stringify(selector)}).length`);
    if (persistedCount !== 1) throw new Error(`Recycler arrival report reload count failed at ${label}: ${report.id} count=${persistedCount}`);
  }
  await clickPrimary(win, 'universe', `document.querySelector('[data-qa-universe]')`);
  await clickPrimary(win, 'reports');

  const profile = await profileSnapshot(win);
  if (!profile.visible || profile.name !== 'Dendrilion' || !profile.avatar.includes('aegis_general') || profile.alliance !== 'Содружество Гелион' || profile.allianceTag !== 'HLN') throw new Error(`Profile contract failed at ${label}: ${JSON.stringify(profile)}`);
  const profilePortraits = await inspectRenderedFactionGeneralPortraits(win, '[data-qa-profile] [data-qa-faction-general]');
  assertRenderedFactionGeneralPortraits(profilePortraits, ['aegis'], `${label} profile`);
  if (JSON.stringify(profile.folderIds) !== JSON.stringify(EXPECTED_FOLDER_IDS) || JSON.stringify(profile.folderLabels) !== JSON.stringify(EXPECTED_FOLDER_LABELS)) throw new Error(`Reports folder contract failed at ${label}: ${JSON.stringify(profile)}`);
  if (profile.metricValues.length !== 4 || profile.focusableMetrics !== 4 || profile.horizontalOverflow || profile.bodyHorizontalOverflow) throw new Error(`Profile geometry/metrics contract failed at ${label}: ${JSON.stringify(profile)}`);
  await win.webContents.executeJavaScript(`document.querySelector('[data-qa-profile-metric="resourcePoints"]')?.focus()`);
  const metricFocus = await win.webContents.executeJavaScript(`document.activeElement?.getAttribute('data-qa-profile-metric') || ''`);
  if (metricFocus !== 'resourcePoints') throw new Error(`Profile metric keyboard focus failed at ${label}: ${metricFocus}`);
  await capture(win, directory, 'profile');

  await clickUtility(win, 'rating');
  await showCurrentAllianceRating(win);
  const initialRating = await ratingAllianceSnapshot(win);
  if (!initialRating.visible || initialRating.name !== 'Содружество Гелион' || initialRating.tag !== '[HLN]' || !initialRating.emblem.includes('starforge')) throw new Error(`Initial alliance rating contract failed at ${label}: ${JSON.stringify(initialRating)}`);

  await updateAllianceThroughCommand(win);
  const commandAlliance = await win.webContents.executeJavaScript(`document.querySelector('.command-view__status strong')?.textContent?.trim() || ''`);
  if (commandAlliance !== 'Содружество Север [NORTH]') throw new Error(`Command alliance update failed at ${label}: ${commandAlliance}`);

  await clickPrimary(win, 'reports');
  const updatedProfile = await profileSnapshot(win);
  if (updatedProfile.alliance !== 'Содружество Север' || updatedProfile.allianceTag !== 'NORTH') throw new Error(`Updated profile alliance contract failed at ${label}: ${JSON.stringify(updatedProfile)}`);
  await clickUtility(win, 'rating');
  await showCurrentAllianceRating(win);
  const updatedRating = await ratingAllianceSnapshot(win);
  if (!updatedRating.visible || updatedRating.name !== 'Содружество Север' || updatedRating.tag !== '[NORTH]' || !updatedRating.emblem.includes('vanguard')) throw new Error(`Updated alliance rating contract failed at ${label}: ${JSON.stringify(updatedRating)}`);
  const updatedState = await savedState(win);
  if (updatedState.command?.alliance?.name !== 'Содружество Север' || updatedState.command?.alliance?.tag !== 'NORTH' || updatedState.command?.alliance?.emblem?.glyph !== 'vanguard' || updatedState.command?.alliance?.emblem?.accent !== 'amber') throw new Error(`Updated command save contract failed at ${label}: ${JSON.stringify(updatedState.command?.alliance)}`);

  const beforeActiveAlliance = await savedState(win);
  await win.webContents.executeJavaScript(`(() => {
    const save = JSON.parse(localStorage.getItem(${JSON.stringify(SAVE_KEY)}) || '{}');
    save.profile = { playerId: 'player-current', displayName: 'Dendrilion', factionId: 'aegis', allianceId: 'alliance-ion', alliance: { id: 'alliance-ion', name: 'Ion Pact', tag: 'ION', emblem: { glyph: 'orbit', accent: 'violet' } }, protectionMode: false };
    localStorage.setItem(${JSON.stringify(SAVE_KEY)}, JSON.stringify(save));
  })()`);
  await reload(win);
  await clickPrimary(win, 'reports');
  const reloadedProfile = await profileSnapshot(win);
  if (reloadedProfile.alliance !== 'Содружество Север' || reloadedProfile.allianceTag !== 'NORTH') throw new Error(`Reloaded profile alliance contract failed at ${label}: ${JSON.stringify(reloadedProfile)}`);
  await clickUtility(win, 'rating');
  await showCurrentAllianceRating(win);
  const reloadedRating = await ratingAllianceSnapshot(win);
  if (!reloadedRating.visible || reloadedRating.name !== 'Содружество Север' || reloadedRating.tag !== '[NORTH]' || !reloadedRating.emblem.includes('vanguard')) throw new Error(`Reloaded alliance rating contract failed at ${label}: ${JSON.stringify(reloadedRating)}`);
  await clickPrimary(win, 'reports');
  await waitFor(win, `document.querySelector('.reports-profile-alliance-link')`);
  await win.webContents.executeJavaScript(`document.querySelector('.reports-profile-alliance-link')?.click()`);
  await waitFor(win, `document.querySelector('.command-view')`);
  const commandRoute = await win.webContents.executeJavaScript(`document.querySelector('.command-view')?.getAttribute('aria-label') || ''`);
  if (commandRoute !== 'Командование союза') throw new Error(`Alliance command route failed at ${label}: ${commandRoute}`);

  await win.webContents.executeJavaScript(`localStorage.setItem(${JSON.stringify(SAVE_KEY)}, ${JSON.stringify(JSON.stringify(beforeActiveAlliance))})`);
  await reload(win);
  await clickPrimary(win, 'reports');
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
  await clickPrimary(win, 'reports');
  await clickFolder(win, 'battle');
  await waitFor(win, `document.querySelector('[data-qa-message-list] .reports-list-item')`);
  await win.webContents.executeJavaScript(`window.confirm = () => true; document.querySelector('[data-qa-message-list] input[type="checkbox"]')?.click(); document.querySelector('[data-qa-delete-selected]')?.click();`);
  await waitFor(win, `document.querySelector('[data-qa-delete-selected]')?.disabled === true`);
  const afterBattleDelete = await savedState(win);
  if (afterBattleDelete.combat?.reports?.length !== battleBefore.combat.reports.length || !afterBattleDelete.combat.savedReportIds.includes(canonicalBattleId) || !afterBattleDelete.reports.hiddenIds.includes(`battle:${canonicalBattleId}`)) throw new Error(`Canonical battle preservation failed at ${label}: ${JSON.stringify({ before: battleBefore.combat, after: afterBattleDelete.combat, reports: afterBattleDelete.reports })}`);
  await capture(win, directory, 'battle-after-delete');

  await reload(win);
  await clickPrimary(win, 'reports');
  await clickFolder(win, 'battle');
  const reloaded = await savedState(win);
  const persisted = await win.webContents.executeJavaScript(`(() => {
    const id = ${JSON.stringify(`battle:${canonicalBattleId}`)};
    const visible = Array.from(document.querySelectorAll('[data-report-item-id]')).some((item) => item.getAttribute('data-report-item-id') === id);
    return !visible && Boolean(document.querySelector('[data-qa-delete-selected]')?.disabled);
  })()`);
  if (!persisted || !reloaded.reports?.hiddenIds?.includes(`battle:${canonicalBattleId}`)) throw new Error(`Tombstone reload failed at ${label}: ${JSON.stringify({ persisted, reports: reloaded.reports })}`);

  return { viewport: label, profile, overpopulationDossier, initialRating, updatedProfile, updatedRating, reloadedProfile, reloadedRating, metricFocus, allianceBefore, canonicalBattleId, horizontalOverflow: profile.horizontalOverflow || profile.bodyHorizontalOverflow, persistedTombstone: true };
}

app.whenReady().then(async () => {
  let win;
  try {
    fs.mkdirSync(OUTPUT, { recursive: true });
    win = new BrowserWindow({ width: 1920, height: 1080, useContentSize: true, show: false, backgroundColor: '#02050a', webPreferences: { offscreen: true, contextIsolation: true, nodeIntegration: false, sandbox: true, partition: 'qa-reports-profile' } });
    await win.loadFile(path.join(ROOT, 'dist', 'index.html'), { search: '?mode=test' });
    const results = [];
    for (const [width, height] of VIEWPORTS) results.push(await runViewport(win, width, height));
    fs.writeFileSync(path.join(OUTPUT, 'results.json'), JSON.stringify({ results }, null, 2));
    console.log('Reports/profile QA passed: overpopulation unlock dossier and ship art, profile/rating alliance sync, command update, reload persistence, deletion tombstones and canonical battle preservation at both viewports.');
    win.destroy();
    app.exit(0);
  } catch (error) {
    console.error(error);
    win?.destroy();
    app.exit(1);
  }
});
