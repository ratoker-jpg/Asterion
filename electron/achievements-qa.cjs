'use strict';

// Focused Electron QA for the first development achievements in Messages.
// The fixture edits only an existing building level in the isolated test save.
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { PARSE_SAVE } = require('./qa-save.cjs');
const { patchSaveIdle } = require('./qa-save-edit.cjs');

app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-gpu');
app.on('window-all-closed', () => {});

const ROOT = path.join(__dirname, '..');
const SAVE_KEY = 'asterion.vertical-slice.test.v1';
const HOME = 'helion-01';
const BUILDING = 'metal-production-1';
const COMMANDERS = ['corsair', 'hunter', 'executioner', 'juggernaut', 'typhoon', 'viper', 'phantom', 'scorpion', 'annihilator', 'reanimator', 'argo', 'judge', 'polias'];
const VIEWPORTS = [[1280, 720], [2560, 1080]];
const OUTPUT = process.env.ASTERION_QA_OUTPUT || path.join(os.tmpdir(), `asterion-achievements-${Date.now()}`);
const SKIP_SCREENSHOTS = process.env.ASTERION_SKIP_SCREENSHOTS === '1';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(win, expression, timeoutMs = 20_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await win.webContents.executeJavaScript(`Boolean(${expression})`)) return;
    await sleep(60);
  }
  throw new Error(`Timed out waiting for: ${expression}`);
}

async function settle(win, ms = 220) {
  await win.webContents.executeJavaScript('new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
  await sleep(ms);
}

async function clickSelector(win, selector) {
  const clicked = await win.webContents.executeJavaScript(`(() => {
    const node = document.querySelector(${JSON.stringify(selector)});
    if (!node || node.disabled) return false;
    node.click();
    return true;
  })()`);
  if (!clicked) throw new Error(`Element not found/enabled: ${selector}`);
  await settle(win);
}

async function clickFilter(win, selector) {
  await clickSelector(win, selector);
  await waitFor(win, `document.querySelector(${JSON.stringify(selector)})?.getAttribute('aria-pressed') === 'true'`);
}

async function pressEnter(win, selector) {
  const focused = await win.webContents.executeJavaScript(`(() => {
    const node = document.querySelector(${JSON.stringify(selector)});
    if (!node || node.disabled) return false;
    node.focus();
    return document.activeElement === node;
  })()`);
  if (!focused) throw new Error(`Button could not receive focus: ${selector}`);
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Return' });
  win.webContents.sendInputEvent({ type: 'char', keyCode: String.fromCharCode(13) });
  win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Return' });
  await settle(win);
  await waitFor(win, `document.querySelector(${JSON.stringify(selector)})?.getAttribute('aria-pressed') === 'true'`);
}

async function rowState(win, id) {
  return win.webContents.executeJavaScript(`(() => {
    const row = document.querySelector('[data-qa-achievement-row="' + ${JSON.stringify(id)} + '"]');
    if (!row || !row.getClientRects().length) return null;
    return {
      text: (row.innerText || row.textContent || '').replace(/\\s+/g, ' ').trim(),
      status: row.getAttribute('data-achievement-status'),
      progress: row.querySelector('[data-qa-achievement-progress]')?.getAttribute('aria-valuetext') || '',
    };
  })()`);
}

async function achievementSummary(win) {
  return win.webContents.executeJavaScript(`(() => {
    const summary = document.querySelector('[data-qa-achievement-summary]');
    return summary ? { points: Number(summary.getAttribute('data-achievement-points')), rank: summary.getAttribute('data-achievement-rank') } : null;
  })()`);
}

function assert(condition, message, detail) {
  if (!condition) throw new Error(`${message}${detail === undefined ? '' : `: ${JSON.stringify(detail)}`}`);
}

function hasProgress(text, current, goal) {
  const escaped = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`${escaped(current)}\\s*(?:/|из)\\s*${escaped(goal)}`).test(text);
}

async function patchBuildingLevel(win, level) {
  const source = `(save) => {
    const home = save.planets?.[${JSON.stringify(HOME)}];
    if (!home?.buildings || !Object.prototype.hasOwnProperty.call(home.buildings, ${JSON.stringify(BUILDING)})) throw new Error('Existing campaign building is missing');
    for (const planet of Object.values(save.planets || {})) {
      const buildings = planet?.buildings;
      if (!buildings) continue;
      for (const [id, value] of Object.entries(buildings)) {
        if (planet === home && id === ${JSON.stringify(BUILDING)}) continue;
        buildings[id] = Math.min(1, Math.max(0, Math.floor(Number(value) || 0)));
      }
    }
    home.buildings[${JSON.stringify(BUILDING)}] = ${level};
    save.science = { ...(save.science || {}), levels: { 1: 1 }, queue: [] };
    const commanderLevels = Object.fromEntries(${JSON.stringify(COMMANDERS)}.map((id) => [id, id === 'corsair' ? 1 : 0]));
    save.shipUpgradeLevels = { ...(save.shipUpgradeLevels || {}), ...commanderLevels };
    for (const planet of Object.values(save.planets || {})) {
      if (!planet?.spaceportUpgrades) continue;
      planet.spaceportUpgrades = { ...planet.spaceportUpgrades, shipLevels: { ...(planet.spaceportUpgrades.shipLevels || {}), ...commanderLevels }, commanderQueue: [] };
    }
  }`;
  const held = `(() => { const PARSE_SAVE = ${PARSE_SAVE}; const save = PARSE_SAVE(localStorage.getItem(${JSON.stringify(SAVE_KEY)}) || '{}'); return save.planets?.[${JSON.stringify(HOME)}]?.buildings?.[${JSON.stringify(BUILDING)}] === ${level}; })()`;
  await patchSaveIdle(win, SAVE_KEY, source, { label: `achievement fixture level ${level}`, held });
}

async function prepareRealConstructionFixture(win) {
  const source = `(save) => {
    const home = save.planets?.[${JSON.stringify(HOME)}];
    if (!home?.buildings || !Object.prototype.hasOwnProperty.call(home.buildings, ${JSON.stringify(BUILDING)})) throw new Error('Existing campaign building is missing');
    for (const planet of Object.values(save.planets || {})) {
      const buildings = planet?.buildings;
      if (!buildings) continue;
      for (const [id, value] of Object.entries(buildings)) {
        if (planet === home && id === ${JSON.stringify(BUILDING)}) continue;
        buildings[id] = Math.min(1, Math.max(0, Math.floor(Number(value) || 0)));
      }
    }
    home.buildings[${JSON.stringify(BUILDING)}] = 14;
    home.energy = 999999999;
    save.metal = 999999999;
    save.minerals = 999999999;
    save.gas = 999999999;
    save.queues = { ...(save.queues || {}), [${JSON.stringify(HOME)}]: [] };
    save.science = { ...(save.science || {}), levels: { 1: 1 }, queue: [] };
    const commanderLevels = Object.fromEntries(${JSON.stringify(COMMANDERS)}.map((id) => [id, id === 'corsair' ? 1 : 0]));
    save.shipUpgradeLevels = { ...(save.shipUpgradeLevels || {}), ...commanderLevels };
    for (const planet of Object.values(save.planets || {})) {
      if (!planet?.spaceportUpgrades) continue;
      planet.spaceportUpgrades = { ...planet.spaceportUpgrades, shipLevels: { ...(planet.spaceportUpgrades.shipLevels || {}), ...commanderLevels }, commanderQueue: [] };
    }
    localStorage.setItem('asterion.test-time-scale.v1', '1');
  }`;
  const held = `(() => { const PARSE_SAVE = ${PARSE_SAVE}; const save = PARSE_SAVE(localStorage.getItem(${JSON.stringify(SAVE_KEY)}) || '{}'); return save.planets?.[${JSON.stringify(HOME)}]?.buildings?.[${JSON.stringify(BUILDING)}] === 14 && (save.queues?.[${JSON.stringify(HOME)}] ?? []).length === 0; })()`;
  await patchSaveIdle(win, SAVE_KEY, source, { label: 'real construction fixture at level 14', held });
}

async function readConstructionState(win) {
  return win.webContents.executeJavaScript(`(() => {
    const PARSE_SAVE = ${PARSE_SAVE};
    const save = PARSE_SAVE(localStorage.getItem(${JSON.stringify(SAVE_KEY)}) || '{}');
    const queue = save.queues?.[${JSON.stringify(HOME)}] ?? [];
    return {
      level: save.planets?.[${JSON.stringify(HOME)}]?.buildings?.[${JSON.stringify(BUILDING)}] ?? null,
      queue: queue.map(({ id, assetRole, targetLevel, enqueuedAt, startedAt, finishAt, durationMs }) => ({ id, assetRole, targetLevel, enqueuedAt, startedAt, finishAt, durationMs })),
    };
  })()`);
}

async function runRealConstructionCompletion() {
  const label = 'real-build-1280x720';
  const directory = path.join(OUTPUT, label);
  fs.mkdirSync(directory, { recursive: true });
  const win = new BrowserWindow({
    width: 1280, height: 720, show: false, backgroundColor: '#02050a',
    webPreferences: { offscreen: true, contextIsolation: true, nodeIntegration: false, sandbox: true, partition: `qa-achievements-real-build-${Date.now()}` },
  });
  try {
    await win.loadFile(path.join(ROOT, 'dist', 'index.html'), { search: '?mode=test' });
    await waitFor(win, `document.querySelector('[data-qa-navigation="utility"]')`);
    win.webContents.debugger.attach('1.3');
    await win.webContents.debugger.sendCommand('Emulation.setDeviceMetricsOverride', { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false, screenWidth: 1280, screenHeight: 720 });

    await prepareRealConstructionFixture(win);
    await openAchievements(win);
    const before = { state: await readConstructionState(win), builder: await rowState(win, 'builder'), summary: await achievementSummary(win) };
    assert(before.state.level === 14 && before.state.queue.length === 0, 'Real construction fixture is not a clean level-14 save', before.state);
    assert(before.builder?.status === 'in-progress' && hasProgress(before.builder.progress, 14, 15), 'Builder is not in progress before the real construction action', before.builder);

    await clickSelector(win, '[data-qa-navigation="primary"] [data-qa-route="planet"]');
    await waitFor(win, `document.querySelector('[data-qa-zone="resource"]')`);
    await clickSelector(win, '[data-qa-zone="resource"]');
    await waitFor(win, `document.querySelector('[data-qa-zone-view][data-zone="resource"]')`);
    await clickSelector(win, `[data-zone-building-role="${BUILDING}"]`);
    await waitFor(win, `document.querySelector('[data-qa-building-dialog="${BUILDING}"] [data-qa-build-button]')`);
    const buildButton = await win.webContents.executeJavaScript(`(() => { const button = document.querySelector('[data-qa-build-button]'); return { disabled: button?.disabled ?? true, label: (button?.innerText || '').replace(/\\s+/g, ' ').trim() }; })()`);
    assert(!buildButton.disabled, 'Level-15 construction button is disabled in the fixture', buildButton);
    await clickSelector(win, '[data-qa-build-button]');
    await waitFor(win, `!document.querySelector('[data-qa-building-dialog]')`);
    await waitFor(win, `(() => { const PARSE_SAVE = ${PARSE_SAVE}; const save = PARSE_SAVE(localStorage.getItem(${JSON.stringify(SAVE_KEY)}) || '{}'); const queue = save.queues?.[${JSON.stringify(HOME)}] ?? []; return queue.length === 1 && queue[0].assetRole === ${JSON.stringify(BUILDING)} && queue[0].targetLevel === 15; })()`);
    const queued = await readConstructionState(win);
    assert(queued.level === 14 && queued.queue.length === 1 && queued.queue[0].targetLevel === 15, 'UI construction command did not create the expected real queue entry', queued);

    const completedAt = Date.now() - 60_000;
    const makeDueSource = `(save) => {
      const queue = save.queues?.[${JSON.stringify(HOME)}];
      if (!Array.isArray(queue) || queue.length !== 1 || queue[0].assetRole !== ${JSON.stringify(BUILDING)} || queue[0].targetLevel !== 15) throw new Error('Expected the UI-created level-15 building queue item');
      const item = queue[0];
      const duration = Math.max(1, Number(item.durationMs) || 1);
      item.enqueuedAt = ${completedAt} - duration;
      item.startedAt = ${completedAt} - duration;
      item.finishAt = ${completedAt};
    }`;
    const completedHeld = `(() => { const PARSE_SAVE = ${PARSE_SAVE}; const save = PARSE_SAVE(localStorage.getItem(${JSON.stringify(SAVE_KEY)}) || '{}'); return save.planets?.[${JSON.stringify(HOME)}]?.buildings?.[${JSON.stringify(BUILDING)}] === 15 && (save.queues?.[${JSON.stringify(HOME)}] ?? []).length === 0; })()`;
    await patchSaveIdle(win, SAVE_KEY, makeDueSource, { label: 'advance UI-created construction to due time', held: completedHeld });
    const after = await readConstructionState(win);
    assert(after.level === 15 && after.queue.length === 0, 'Runtime did not complete the due UI-created building queue item', after);

    await openAchievements(win);
    await clickFilter(win, '[data-qa-achievement-group-filter="growth"]');
    await waitFor(win, `document.querySelector('[data-qa-achievement-row="builder"]')?.getAttribute('data-achievement-status') === 'earned'`);
    const builder = await rowState(win, 'builder');
    const summary = await achievementSummary(win);
    assert(builder?.status === 'earned' && builder.text.includes('Получено'), 'Normal queue completion did not grant Builder', builder);
    assert(summary?.points - before.summary.points >= 10, 'Builder completion did not increase the achievement score by at least 10 points', { before: before.summary, after: summary });
    await clickSelector(win, '[data-qa-achievement-row="builder"]');
    await waitFor(win, `document.querySelector('[data-qa-achievement-detail][data-qa-achievement-selected="builder"]')`);
    await capture(win, directory, 'real-construction-builder-earned');
    return { fixture: before, uiBuildButton: buildButton, queued, forcedDueAt: completedAt, completed: after, builder, summary, pointsDelta: summary.points - before.summary.points, screenshot: 'real-construction-builder-earned.png' };
  } finally {
    try { if (win.webContents.debugger.isAttached()) win.webContents.debugger.detach(); } catch {}
    win.destroy();
  }
}

async function openAchievements(win) {
  await waitFor(win, `document.querySelector('[data-qa-navigation="primary"] [data-qa-route="reports"]')`);
  await clickSelector(win, '[data-qa-navigation="primary"] [data-qa-route="reports"]');
  await waitFor(win, `document.querySelector('[data-message-folder="achievements"]')`);
  await clickSelector(win, '[data-message-folder="achievements"]');
  await waitFor(win, `document.querySelector('[data-qa-achievements-view]') && document.querySelector('[data-qa-achievement-summary]')`);
}

async function capture(win, directory, name) {
  if (SKIP_SCREENSHOTS) return false;
  await settle(win, 350);
  const result = await win.webContents.debugger.sendCommand('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: false });
  fs.writeFileSync(path.join(directory, `${name}.png`), Buffer.from(result.data, 'base64'));
  return true;
}

async function layout(win) {
  return win.webContents.executeJavaScript(`(() => {
    const view = document.querySelector('[data-qa-achievements-view]')?.getBoundingClientRect();
    const detail = document.querySelector('[data-qa-achievement-detail]')?.getBoundingClientRect();
    return {
      fits: Boolean(view && detail) && view.left >= -1 && view.top >= -1 && view.right <= innerWidth + 1 && view.bottom <= innerHeight + 1 && detail.width > 0 && detail.height > 0,
      horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 2,
    };
  })()`);
}

async function typeHierarchy(win, rowId) {
  return win.webContents.executeJavaScript(`(() => {
    const row = document.querySelector('[data-qa-achievement-row="' + ${JSON.stringify(rowId)} + '"]');
    const summaryPoints = document.querySelector('.achievement-summary__points');
    const detailPoints = document.querySelector('.achievement-detail__points');
    const detailTitle = document.querySelector('[data-qa-achievement-detail] h2');
    const rowStatus = row?.querySelector('.achievement-row__progress-copy b, .achievement-row__earned');
    const rowTitle = row?.querySelector('.achievement-row__name > strong');
    const size = (node) => node ? Number.parseFloat(getComputedStyle(node).fontSize) || 0 : 0;
    const summarySize = size(summaryPoints);
    const detailSize = size(detailPoints);
    const statusSize = size(rowStatus);
    const headingSize = size(detailTitle);
    const rowTitleSize = size(rowTitle);
    return {
      summaryPoints: summarySize, detailPoints: detailSize, rowStatus: statusSize,
      detailHeading: headingSize, rowTitle: rowTitleSize,
      summaryToStatus: statusSize ? summarySize / statusSize : 0,
      detailToStatus: statusSize ? detailSize / statusSize : 0,
      headingToRow: rowTitleSize ? headingSize / rowTitleSize : 0,
    };
  })()`);
}

function assertTypeHierarchy(metrics, viewport, rowId) {
  assert(metrics.summaryPoints > 0 && metrics.detailPoints > 0 && metrics.rowStatus > 0 && metrics.detailHeading > 0 && metrics.rowTitle > 0,
    `${viewport} missing computed achievement typography`, metrics);
  assert(metrics.summaryToStatus > 1.5, `${viewport} summary points are too close to row status size`, { rowId, ...metrics });
  assert(metrics.detailToStatus > 1.5, `${viewport} detail points are too close to row status size`, { rowId, ...metrics });
  assert(metrics.headingToRow > 1, `${viewport} detail heading does not exceed row title size`, { rowId, ...metrics });
}

async function runViewport(width, height) {
  const label = `${width}x${height}`;
  const directory = path.join(OUTPUT, label);
  fs.mkdirSync(directory, { recursive: true });
  const win = new BrowserWindow({
    width, height, show: false, backgroundColor: '#02050a',
    webPreferences: { offscreen: true, contextIsolation: true, nodeIntegration: false, sandbox: true, partition: `qa-achievements-${label}-${Date.now()}` },
  });
  const results = { viewport: label, levels: {}, screenshots: [] };
  try {
    await win.loadFile(path.join(ROOT, 'dist', 'index.html'), { search: '?mode=test' });
    await waitFor(win, `document.querySelector('[data-qa-navigation="utility"]')`);
    win.webContents.debugger.attach('1.3');
    await win.webContents.debugger.sendCommand('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false, screenWidth: width, screenHeight: height });

    // «Строитель» is in progress at 14; 15 earns it while «Зодчий» continues; 25 earns both.
    await patchBuildingLevel(win, 14);
    await openAchievements(win);
    await clickFilter(win, '[data-qa-achievement-group-filter="growth"]');
    await clickFilter(win, '[data-qa-achievement-status-filter="not-started"]');
    await waitFor(win, `document.querySelector('[data-qa-achievement-empty] [data-qa-achievement-filter-reset]')`);
    await clickSelector(win, '[data-qa-achievement-filter-reset]');
    await waitFor(win, `document.querySelector('[data-qa-achievement-group-filter="all"][aria-pressed="true"]')`);
    await waitFor(win, `document.querySelector('[data-qa-achievement-status-filter="all"][aria-pressed="true"]')`);
    await clickFilter(win, '[data-qa-achievement-group-filter="growth"]');
    await clickFilter(win, '[data-qa-achievement-status-filter="earned"]');
    const earned14 = {
      builder: await rowState(win, 'builder'), architect: await rowState(win, 'architect'),
      scholar: await rowState(win, 'scholar'), bridge: await rowState(win, 'bridge'), powerGrid: await rowState(win, 'power-grid'),
    };
    assert(!earned14.builder && !earned14.architect && !earned14.scholar && !earned14.bridge, 'Unfinished growth milestones appeared in the earned filter', earned14);
    await pressEnter(win, '[data-qa-achievement-status-filter="in-progress"]');
    const builder14 = await rowState(win, 'builder');
    const architect14 = await rowState(win, 'architect');
    const scholar14 = await rowState(win, 'scholar');
    const bridge14 = await rowState(win, 'bridge');
    assert(builder14?.status === 'in-progress' && hasProgress(builder14.progress, 14, 15), 'Builder progress at level 14 is not visible', builder14);
    assert(architect14?.status === 'in-progress' && hasProgress(architect14.progress, 14, 25), 'Architect progress at level 14 is not visible', architect14);
    assert(scholar14?.status === 'in-progress' && hasProgress(scholar14.progress, 1, 10), 'Scholar does not show the one completed research level', scholar14);
    assert(bridge14?.status === 'in-progress' && hasProgress(bridge14.progress, 1, 10), 'Bridge does not show the one completed commander level', bridge14);
    const points14 = await achievementSummary(win);
    assert(points14, 'Achievement points summary is missing at level 14');
    results.levels['14'] = { points: points14.points, builder: builder14, architect: architect14, scholar: scholar14, bridge: bridge14, earnedFilter: earned14 };
    await clickSelector(win, '[data-qa-achievement-row="builder"]');
    await waitFor(win, `document.querySelector('[data-qa-achievement-detail][data-qa-achievement-selected="builder"]')`);
    const detailProgress14 = await win.webContents.executeJavaScript(`document.querySelector('[data-qa-achievement-detail-progress]')?.getAttribute('aria-valuetext') || ''`);
    assert(hasProgress(detailProgress14, 14, 15), 'Builder detail progress is missing', detailProgress14);
    const layout14 = await layout(win);
    assert(layout14.fits && !layout14.horizontalOverflow, 'Achievements screen does not fit the viewport', layout14);
    const hierarchy14 = await typeHierarchy(win, 'builder');
    assertTypeHierarchy(hierarchy14, label, 'builder');
    results.levels['14'].typeHierarchy = hierarchy14;
    if (await capture(win, directory, '14-builder-in-progress-detail')) results.screenshots.push('14-builder-in-progress-detail.png');

    await patchBuildingLevel(win, 15);
    await openAchievements(win);
    await clickFilter(win, '[data-qa-achievement-group-filter="growth"]');
    await clickFilter(win, '[data-qa-achievement-status-filter="in-progress"]');
    const builder15progress = await rowState(win, 'builder');
    const architect15 = await rowState(win, 'architect');
    assert(!builder15progress, 'Earned Builder remained in the in-progress filter', builder15progress);
    assert(architect15?.status === 'in-progress' && hasProgress(architect15.progress, 15, 25), 'Architect progress at level 15 is not visible', architect15);
    await clickFilter(win, '[data-qa-achievement-status-filter="earned"]');
    const builder15 = await rowState(win, 'builder');
    assert(builder15?.status === 'earned' && builder15.text.includes('Получено'), 'Builder was not earned at level 15', builder15);
    assert(!await rowState(win, 'scholar') && !await rowState(win, 'bridge'), 'Scholar or Bridge appeared in the earned filter before meeting its goal', { scholar: await rowState(win, 'scholar'), bridge: await rowState(win, 'bridge') });
    const points15 = await achievementSummary(win);
    assert(points15?.points - points14.points === 10, 'Builder score delta is not 10 points', { before: points14.points, after: points15?.points });
    results.levels['15'] = { points: points15.points, builder: builder15, architectInProgress: architect15 };
    await clickSelector(win, '[data-qa-achievement-row="builder"]');
    await waitFor(win, `document.querySelector('[data-qa-achievement-detail][data-qa-achievement-selected="builder"]')`);
    const layout15 = await layout(win);
    assert(layout15.fits && !layout15.horizontalOverflow, 'Achievements screen does not fit the viewport', layout15);
    const hierarchy15 = await typeHierarchy(win, 'builder');
    assertTypeHierarchy(hierarchy15, label, 'builder');
    results.levels['15'].typeHierarchy = hierarchy15;
    if (await capture(win, directory, '15-builder-earned')) results.screenshots.push('15-builder-earned.png');

    await patchBuildingLevel(win, 25);
    await openAchievements(win);
    await clickFilter(win, '[data-qa-achievement-group-filter="growth"]');
    await clickFilter(win, '[data-qa-achievement-status-filter="earned"]');
    const builder25 = await rowState(win, 'builder');
    const architect25 = await rowState(win, 'architect');
    const scholar25 = await rowState(win, 'scholar');
    const bridge25 = await rowState(win, 'bridge');
    assert(builder25?.status === 'earned' && builder25.text.includes('Получено'), 'Builder is not earned at level 25', builder25);
    assert(architect25?.status === 'earned' && architect25.text.includes('Получено'), 'Architect was not earned at level 25', architect25);
    assert(!scholar25 && !bridge25, 'Scholar or Bridge appeared in the earned filter below its goal', { scholar25, bridge25 });
    const points25 = await achievementSummary(win);
    assert(points25?.points - points15.points === 25, 'Architect score delta is not 25 points', { before: points15.points, after: points25?.points });
    results.levels['25'] = { points: points25.points, builder: builder25, architect: architect25 };
    await clickSelector(win, '[data-qa-achievement-row="architect"]');
    await waitFor(win, `document.querySelector('[data-qa-achievement-detail][data-qa-achievement-selected="architect"]')`);
    const layout25 = await layout(win);
    assert(layout25.fits && !layout25.horizontalOverflow, 'Achievements screen does not fit the viewport', layout25);
    const hierarchy25 = await typeHierarchy(win, 'architect');
    assertTypeHierarchy(hierarchy25, label, 'architect');
    results.levels['25'].typeHierarchy = hierarchy25;
    if (await capture(win, directory, '25-architect-earned-detail')) results.screenshots.push('25-architect-earned-detail.png');
    return results;
  } finally {
    try { if (win.webContents.debugger.isAttached()) win.webContents.debugger.detach(); } catch {}
    win.destroy();
  }
}

app.whenReady().then(async () => {
  try {
    fs.mkdirSync(OUTPUT, { recursive: true });
    const results = {};
    for (const [width, height] of VIEWPORTS) results[`${width}x${height}`] = await runViewport(width, height);
    results.realConstructionCompletion = await runRealConstructionCompletion();
    fs.writeFileSync(path.join(OUTPUT, 'achievements-qa.json'), JSON.stringify(results, null, 2));
    console.log(JSON.stringify({ output: OUTPUT, results }, null, 2));
    app.exit(0);
  } catch (error) {
    console.error(error);
    app.exit(1);
  }
});
