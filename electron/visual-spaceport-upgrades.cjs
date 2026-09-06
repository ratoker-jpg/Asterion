const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-gpu');
app.on('window-all-closed', () => {});

const ROOT = path.join(__dirname, '..');
const OUTPUT = path.join(ROOT, 'visual-qa');
const SAVE_KEY = 'asterion.vertical-slice.v1';
const VIEWPORTS = [[1920, 1080], [1280, 720]];
const LEVEL_ONE_DURATION = 855000;
const LEVEL_TEN_DURATION = 450000;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(win, expression, timeoutMs = 8000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await win.webContents.executeJavaScript(`Boolean(${expression})`)) return;
    await sleep(50);
  }
  throw new Error(`Timed out waiting for: ${expression}`);
}

async function settle(win) {
  await win.webContents.executeJavaScript('new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
  await sleep(140);
}

async function reload(win) {
  const done = new Promise((resolve) => win.webContents.once('did-finish-load', resolve));
  win.webContents.reload();
  await done;
  await waitFor(win, `document.querySelector('.utility-navigation')`);
  await win.webContents.executeJavaScript('document.fonts?.ready');
  await settle(win);
}

async function click(win, selector) {
  const clicked = await win.webContents.executeJavaScript(`(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    if (!element || element.disabled) return false;
    element.click();
    return true;
  })()`);
  if (!clicked) throw new Error(`Clickable element not found/enabled: ${selector}`);
  await settle(win);
}

async function capture(win, directory, name) {
  await win.webContents.executeJavaScript('window.scrollTo(0, 0)');
  await settle(win);
  const result = await win.webContents.debugger.sendCommand('Page.captureScreenshot', {
    format: 'png',
    fromSurface: true,
    captureBeyondViewport: false,
  });
  fs.writeFileSync(path.join(directory, `${name}.png`), Buffer.from(result.data, 'base64'));
}

async function seedSpaceport(win) {
  const ok = await win.webContents.executeJavaScript(`(() => {
    const save = JSON.parse(localStorage.getItem(${JSON.stringify(SAVE_KEY)}) || 'null');
    const planet = save?.planets?.['helion-01'];
    if (!planet?.buildings) return false;
    planet.buildings.spaceport = 1;
    planet.buildings.shipyard = 20;
    planet.spaceportUpgrades = { shipLevels: {}, shipQueue: [], commanderQueue: [] };
    save.metal = 100000;
    save.minerals = 100000;
    save.gas = 100000;
    save.schemaVersion = Math.max(Number(save.schemaVersion) || 0, 8);
    localStorage.setItem(${JSON.stringify(SAVE_KEY)}, JSON.stringify(save));
    return true;
  })()`);
  if (!ok) throw new Error('Could not seed Spaceport state');
  await reload(win);
}

async function activateMilitary(win) {
  await click(win, '.header-zone--military');
  await waitFor(win, `document.querySelector('[data-qa-zone-view][data-zone="military"]')`);
}

async function openSpaceport(win) {
  await click(win, '[data-zone-building-role="spaceport"]');
  await waitFor(win, `document.querySelector('[data-qa-building-dialog="spaceport"]')`);
  await click(win, '[data-qa-enter-building="spaceport"]');
  await waitFor(win, `document.querySelector('[data-qa-spaceport-upgrades]')`);
  await settle(win);
}

async function reopenSpaceport(win, track = 'ships') {
  await reload(win);
  await activateMilitary(win);
  await openSpaceport(win);
  if (track === 'commanders') await click(win, '[data-qa-spaceport-tab="commanders"]');
}

async function readSave(win) {
  return win.webContents.executeJavaScript(`(() => {
    const save = JSON.parse(localStorage.getItem(${JSON.stringify(SAVE_KEY)}) || '{}');
    const planet = save.planets?.['helion-01'];
    return {
      schemaVersion: save.schemaVersion,
      metal: save.metal,
      minerals: save.minerals,
      gas: save.gas,
      spaceport: planet?.buildings?.spaceport,
      shipyard: planet?.buildings?.shipyard,
      levels: planet?.spaceportUpgrades?.shipLevels ?? {},
      shipQueue: planet?.spaceportUpgrades?.shipQueue ?? [],
      commanderQueue: planet?.spaceportUpgrades?.commanderQueue ?? [],
    };
  })()`);
}

async function readScreen(win) {
  return win.webContents.executeJavaScript(`(() => {
    const root = document.querySelector('[data-qa-spaceport-upgrades]');
    if (!root) return null;
    const queue = root.querySelector('[data-qa-spaceport-queue-count]');
    const activeTab = root.querySelector('[data-qa-spaceport-tab][aria-pressed="true"]');
    const defender = root.querySelector('[data-qa-spaceport-card="defender"]');
    const solar = root.querySelector('[data-qa-spaceport-card="solar-satellite"]');
    const text = (node) => node?.textContent?.replace(/\\s+/g, ' ').trim() ?? '';
    return {
      track: root.getAttribute('data-qa-spaceport-track'),
      queueCount: queue?.getAttribute('data-qa-spaceport-queue-count') ?? null,
      queueText: text(queue),
      emptyQueue: Boolean(root.querySelector('[data-qa-spaceport-queue-empty]')),
      activeTab: activeTab?.getAttribute('data-qa-spaceport-tab') ?? null,
      activeCountdown: text(root.querySelector('[data-qa-spaceport-queue-task] time')),
      taskCount: root.querySelectorAll('[data-qa-spaceport-queue-task]').length,
      defenderBlockers: Array.from(defender?.querySelectorAll('[data-qa-spaceport-blocker="requirement"]') ?? []).map(text),
      solarQueued: solar?.getAttribute('data-qa-spaceport-queued') ?? null,
      solarButtonDisabled: Boolean(solar?.querySelector('[data-qa-spaceport-upgrade]')?.disabled),
      solarResourceBlockers: Array.from(solar?.querySelectorAll('[data-qa-spaceport-blocker="resource"]') ?? []).map(text),
      queueFullStrip: text(root.querySelector('[data-qa-spaceport-blocker="queue"]')),
    };
  })()`);
}

async function measureLayout(win) {
  return win.webContents.executeJavaScript(`(() => {
    const root = document.querySelector('[data-qa-spaceport-upgrades]');
    if (!root) return null;
    const pick = (element) => {
      if (!element) return null;
      const rect = element.getBoundingClientRect();
      return {
        left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom,
        width: rect.width, height: rect.height,
        clientWidth: element.clientWidth, scrollWidth: element.scrollWidth,
        clientHeight: element.clientHeight, scrollHeight: element.scrollHeight,
      };
    };
    const sidebar = root.querySelector('[data-qa-spaceport-sidebar]');
    const main = root.querySelector('.spaceport-main-v2');
    const catalog = root.querySelector('.spaceport-catalog-v2');
    const rows = Array.from(root.querySelectorAll('.spaceport-row-v2')).map(pick);
    const defender = root.querySelector('[data-qa-spaceport-card="defender"]');
    const defenderAction = defender?.querySelector('.spaceport-row-action-v2');
    const defenderInfo = defender?.querySelector('.spaceport-row-info-v2');
    const catalogStyle = catalog ? getComputedStyle(catalog) : null;
    const sidebarStyle = sidebar ? getComputedStyle(sidebar) : null;
    return {
      viewport: { width: innerWidth, height: innerHeight },
      document: { width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight },
      longPage: document.documentElement.classList.contains('asterion-long-page'),
      root: pick(root),
      sidebar: pick(sidebar),
      main: pick(main),
      catalog: pick(catalog),
      rows,
      defenderInfo: pick(defenderInfo),
      defenderAction: pick(defenderAction),
      catalogOverflowY: catalogStyle?.overflowY ?? null,
      sidebarPosition: sidebarStyle?.position ?? null,
    };
  })()`);
}

function assertLayout(snapshot, label) {
  if (!snapshot) throw new Error(`${label}: missing Spaceport layout snapshot`);
  const epsilon = 3;
  const { viewport, document, root, sidebar, main, catalog, rows, defenderInfo, defenderAction } = snapshot;
  if (!snapshot.longPage) throw new Error(`${label}: Spaceport did not use global long-page scroll`);
  if (document.width > viewport.width + epsilon) throw new Error(`${label}: horizontal page overflow ${JSON.stringify(snapshot)}`);
  if (!root || root.left < -epsilon || root.right > viewport.width + epsilon) throw new Error(`${label}: Spaceport root clipped horizontally ${JSON.stringify(root)}`);
  if (!sidebar || !main || sidebar.right > main.left + epsilon) throw new Error(`${label}: sidebar/main overlap`);
  if (snapshot.sidebarPosition !== 'sticky' && viewport.width > 820) throw new Error(`${label}: sidebar is not sticky (${snapshot.sidebarPosition})`);
  if (!catalog || ['auto', 'scroll'].includes(snapshot.catalogOverflowY)) throw new Error(`${label}: catalog owns forbidden internal vertical scroll (${snapshot.catalogOverflowY})`);
  if (catalog.scrollHeight > catalog.clientHeight + epsilon) throw new Error(`${label}: catalog is internally clipped instead of growing naturally ${JSON.stringify(catalog)}`);
  if (rows.length < 8) throw new Error(`${label}: catalog rows missing (${rows.length})`);
  const expectedRowWidth = catalog.width - 0;
  for (const row of rows.slice(0, 5)) {
    if (!row || row.width < expectedRowWidth - 12) throw new Error(`${label}: row is not full-width ${JSON.stringify({ row, catalog })}`);
  }
  if (!defenderInfo || defenderInfo.scrollWidth > defenderInfo.clientWidth + epsilon) throw new Error(`${label}: long requirement/info content clipped horizontally`);
  if (!defenderAction || defenderAction.scrollWidth > defenderAction.clientWidth + epsilon) throw new Error(`${label}: CTA/action content clipped horizontally`);
  const pageTail = document.height - root.bottom;
  if (pageTail < -epsilon || pageTail > 260) throw new Error(`${label}: suspicious blank tail after Spaceport content (${pageTail}px)`);
  if (document.height > 8000) throw new Error(`${label}: runaway document height ${document.height}`);
}

async function assertStablePageHeight(win, label) {
  const heights = [];
  for (let index = 0; index < 7; index += 1) {
    heights.push(await win.webContents.executeJavaScript('document.documentElement.scrollHeight'));
    await sleep(120);
  }
  const min = Math.min(...heights);
  const max = Math.max(...heights);
  if (max - min > 3) throw new Error(`${label}: document height keeps growing ${JSON.stringify(heights)}`);
  if (max > 8000) throw new Error(`${label}: document height runaway ${JSON.stringify(heights)}`);
  return heights;
}

async function seedThirdCommanderTask(win) {
  const ok = await win.webContents.executeJavaScript(`(() => {
    const save = JSON.parse(localStorage.getItem(${JSON.stringify(SAVE_KEY)}) || '{}');
    const state = save.planets?.['helion-01']?.spaceportUpgrades;
    if (!state || state.commanderQueue?.length !== 2) return false;
    const tail = state.commanderQueue[state.commanderQueue.length - 1];
    state.commanderQueue.push({
      id: 'qa-commander-third',
      track: 'commanders',
      shipId: 'executioner',
      fromLevel: Number(state.shipLevels?.executioner) || 0,
      toLevel: (Number(state.shipLevels?.executioner) || 0) + 1,
      startedAt: tail.finishAt,
      finishAt: tail.finishAt + ${LEVEL_ONE_DURATION},
      spaceportLevelAtStart: 1,
      effectiveDurationMs: ${LEVEL_ONE_DURATION},
    });
    save.metal -= 500;
    save.minerals -= 250;
    localStorage.setItem(${JSON.stringify(SAVE_KEY)}, JSON.stringify(save));
    return true;
  })()`);
  if (!ok) throw new Error('Could not seed third commander task');
}

async function finishFirstShipOffline(win) {
  const ok = await win.webContents.executeJavaScript(`(() => {
    const save = JSON.parse(localStorage.getItem(${JSON.stringify(SAVE_KEY)}) || '{}');
    const queue = save.planets?.['helion-01']?.spaceportUpgrades?.shipQueue;
    if (!Array.isArray(queue) || queue.length !== 3) return false;
    queue[0].finishAt = Date.now() - 1000;
    localStorage.setItem(${JSON.stringify(SAVE_KEY)}, JSON.stringify(save));
    return true;
  })()`);
  if (!ok) throw new Error('Could not force first ship completion');
}

async function setSpaceportLevel(win, level) {
  const ok = await win.webContents.executeJavaScript(`(() => {
    const save = JSON.parse(localStorage.getItem(${JSON.stringify(SAVE_KEY)}) || '{}');
    const planet = save.planets?.['helion-01'];
    if (!planet?.buildings) return false;
    planet.buildings.spaceport = ${Number(level)};
    localStorage.setItem(${JSON.stringify(SAVE_KEY)}, JSON.stringify(save));
    return true;
  })()`);
  if (!ok) throw new Error(`Could not set Spaceport level ${level}`);
}

async function seedInsufficientResources(win) {
  const ok = await win.webContents.executeJavaScript(`(() => {
    const save = JSON.parse(localStorage.getItem(${JSON.stringify(SAVE_KEY)}) || '{}');
    const planet = save.planets?.['helion-01'];
    if (!planet?.spaceportUpgrades) return false;
    planet.spaceportUpgrades.shipQueue = [];
    planet.spaceportUpgrades.commanderQueue = [];
    planet.buildings.spaceport = 4;
    save.metal = 0;
    save.minerals = 0;
    save.gas = 0;
    localStorage.setItem(${JSON.stringify(SAVE_KEY)}, JSON.stringify(save));
    return true;
  })()`);
  if (!ok) throw new Error('Could not seed insufficient-resource Spaceport state');
}

async function verifyBackAndEscape(win) {
  await click(win, '[data-qa-building-interior-back]');
  await waitFor(win, `document.querySelector('[data-qa-zone-view][data-zone="military"]')`);
  await waitFor(win, `document.querySelector('[data-qa-building-dialog="spaceport"]')`);
  await click(win, '[data-qa-enter-building="spaceport"]');
  await waitFor(win, `document.querySelector('[data-qa-spaceport-upgrades]')`);
  await win.webContents.executeJavaScript(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))`);
  await settle(win);
  await waitFor(win, `document.querySelector('[data-qa-zone-view][data-zone="military"]')`);
  await waitFor(win, `document.querySelector('[data-qa-building-dialog="spaceport"]')`);
}

async function verifyFlow(win, directory, label) {
  await win.webContents.executeJavaScript(`localStorage.removeItem(${JSON.stringify(SAVE_KEY)})`);
  await reload(win);
  await seedSpaceport(win);
  let saved = await readSave(win);
  if (Number(saved.schemaVersion) < 8 || saved.spaceport !== 1 || saved.shipyard !== 20) throw new Error(`${label}: seed mismatch ${JSON.stringify(saved)}`);

  await activateMilitary(win);
  await openSpaceport(win);
  let screen = await readScreen(win);
  if (!screen || screen.track !== 'ships' || screen.activeTab !== 'ships' || screen.queueCount !== '0/3' || !screen.emptyQueue) {
    throw new Error(`${label}: initial selected queue mismatch ${JSON.stringify(screen)}`);
  }
  if (!screen.defenderBlockers.some((value) => value.includes('Нужна Ионная наука ур. 2')) || !screen.defenderBlockers.some((value) => value.includes('Нужна Топливные элементы ур. 4'))) {
    throw new Error(`${label}: locked Defender lacks concrete blockers ${JSON.stringify(screen.defenderBlockers)}`);
  }
  assertLayout(await measureLayout(win), label);
  const initialHeights = await assertStablePageHeight(win, `${label}/initial`);
  await capture(win, directory, 'spaceport-standard');

  await click(win, '[data-qa-spaceport-upgrade="solar-satellite"]');
  await waitFor(win, `document.querySelector('[data-qa-spaceport-queue-count]')?.getAttribute('data-qa-spaceport-queue-count') === '1/3'`);
  screen = await readScreen(win);
  if (screen?.queueCount !== '1/3' || screen.taskCount !== 1 || screen.solarQueued !== 'true' || !screen.solarButtonDisabled || !/^\\d{2}:\\d{2}:\\d{2}$/.test(screen.activeCountdown)) {
    throw new Error(`${label}: active 1/3 queue state mismatch ${JSON.stringify(screen)}`);
  }
  saved = await readSave(win);
  if (saved.shipQueue.length !== 1 || saved.shipQueue[0].shipId !== 'solar-satellite' || saved.shipQueue[0].spaceportLevelAtStart !== 1 || saved.shipQueue[0].effectiveDurationMs !== LEVEL_ONE_DURATION) {
    throw new Error(`${label}: level-one task snapshot mismatch ${JSON.stringify(saved.shipQueue)}`);
  }
  if (saved.metal !== 99500 || saved.minerals !== 99750 || saved.gas !== 100000) throw new Error(`${label}: first enqueue wallet mismatch ${JSON.stringify(saved)}`);
  await capture(win, directory, 'spaceport-active-1-of-3');

  await click(win, '[data-qa-spaceport-upgrade="transporter"]');
  await click(win, '[data-qa-spaceport-upgrade="mega-transporter"]');
  await waitFor(win, `document.querySelector('[data-qa-spaceport-queue-count]')?.getAttribute('data-qa-spaceport-queue-count') === '3/3'`);
  screen = await readScreen(win);
  if (screen?.queueCount !== '3/3' || screen.taskCount !== 3 || !screen.queueFullStrip.includes('Очередь заполнена')) throw new Error(`${label}: normal queue 3/3 mismatch ${JSON.stringify(screen)}`);
  saved = await readSave(win);
  if (saved.shipQueue.length !== 3 || new Set(saved.shipQueue.map((task) => task.shipId)).size !== 3) throw new Error(`${label}: normal queue not three distinct tasks ${JSON.stringify(saved.shipQueue)}`);
  if (!saved.shipQueue.every((task) => task.spaceportLevelAtStart === 1 && task.effectiveDurationMs === LEVEL_ONE_DURATION)) throw new Error(`${label}: normal queue snapshots changed ${JSON.stringify(saved.shipQueue)}`);
  await capture(win, directory, 'spaceport-ships-3-of-3');

  await click(win, '[data-qa-spaceport-tab="commanders"]');
  screen = await readScreen(win);
  if (screen?.track !== 'commanders' || screen.queueCount !== '0/3' || !screen.emptyQueue) throw new Error(`${label}: commander queue did not stay independent ${JSON.stringify(screen)}`);
  await click(win, '[data-qa-spaceport-upgrade="corsair"]');
  await click(win, '[data-qa-spaceport-upgrade="hunter"]');
  screen = await readScreen(win);
  if (screen?.queueCount !== '2/3' || screen.taskCount !== 2) throw new Error(`${label}: commander UI enqueue mismatch ${JSON.stringify(screen)}`);
  await seedThirdCommanderTask(win);
  await reopenSpaceport(win, 'commanders');
  screen = await readScreen(win);
  saved = await readSave(win);
  if (screen?.queueCount !== '3/3' || screen.taskCount !== 3 || saved.shipQueue.length !== 3 || saved.commanderQueue.length !== 3) {
    throw new Error(`${label}: independent full queues mismatch ${JSON.stringify({ screen, saved })}`);
  }
  await capture(win, directory, 'spaceport-commanders-3-of-3');

  await reopenSpaceport(win, 'ships');
  saved = await readSave(win);
  if (saved.shipQueue.length !== 3 || saved.commanderQueue.length !== 3) throw new Error(`${label}: queues did not persist reload`);

  await finishFirstShipOffline(win);
  await reopenSpaceport(win, 'ships');
  saved = await readSave(win);
  if (saved.levels['solar-satellite'] !== 1 || saved.shipQueue.length !== 2 || saved.commanderQueue.length !== 3) {
    throw new Error(`${label}: offline completion mismatch ${JSON.stringify(saved)}`);
  }
  await reopenSpaceport(win, 'ships');
  const savedSecondReload = await readSave(win);
  if (savedSecondReload.levels['solar-satellite'] !== 1 || savedSecondReload.shipQueue.length !== 2) {
    throw new Error(`${label}: offline completion applied twice ${JSON.stringify(savedSecondReload)}`);
  }

  await setSpaceportLevel(win, 10);
  await reopenSpaceport(win, 'ships');
  const beforeLevelTenEnqueue = await readSave(win);
  if (!beforeLevelTenEnqueue.shipQueue.every((task) => task.spaceportLevelAtStart === 1 && task.effectiveDurationMs === LEVEL_ONE_DURATION)) {
    throw new Error(`${label}: existing queue recalculated after Spaceport level change ${JSON.stringify(beforeLevelTenEnqueue.shipQueue)}`);
  }
  await click(win, '[data-qa-spaceport-upgrade="scout"]');
  saved = await readSave(win);
  const newest = saved.shipQueue.at(-1);
  if (saved.shipQueue.length !== 3 || newest?.shipId !== 'scout' || newest?.spaceportLevelAtStart !== 10 || newest?.effectiveDurationMs !== LEVEL_TEN_DURATION) {
    throw new Error(`${label}: level-ten new-task snapshot mismatch ${JSON.stringify(saved.shipQueue)}`);
  }
  if (!saved.shipQueue.slice(0, 2).every((task) => task.effectiveDurationMs === LEVEL_ONE_DURATION)) throw new Error(`${label}: old tasks were recalculated`);

  assertLayout(await measureLayout(win), `${label}/post-reload`);
  const finalHeights = await assertStablePageHeight(win, `${label}/post-reload`);
  await verifyBackAndEscape(win);

  await seedInsufficientResources(win);
  await reopenSpaceport(win, 'ships');
  screen = await readScreen(win);
  if (screen?.queueCount !== '0/3' || !screen.solarResourceBlockers.some((value) => value.includes('Недостаточно металла')) || !screen.solarResourceBlockers.some((value) => value.includes('Недостаточно минералов'))) {
    throw new Error(`${label}: concrete insufficient-resource blockers missing ${JSON.stringify(screen)}`);
  }
  assertLayout(await measureLayout(win), `${label}/insufficient`);
  await assertStablePageHeight(win, `${label}/insufficient`);
  await capture(win, directory, 'spaceport-insufficient-resources');

  return {
    viewport: label,
    screenshots: [
      'spaceport-standard.png',
      'spaceport-active-1-of-3.png',
      'spaceport-ships-3-of-3.png',
      'spaceport-commanders-3-of-3.png',
      'spaceport-insufficient-resources.png',
    ],
    initialScrollHeightSamples: initialHeights,
    finalScrollHeightSamples: finalHeights,
    verified: [
      'science-style-sidebar-and-full-width-rows',
      'global-document-scroll-without-catalog-inner-scroll',
      'document-height-stable-no-runaway-growth',
      'no-horizontal-page-overflow',
      'selected-tab-and-selected-queue-only',
      'queue-empty-state-0-of-3',
      'active-task-1-of-3-with-countdown',
      'normal-queue-3-of-3',
      'commander-queue-3-of-3-and-independent',
      'queued-target-disabled-in-ui',
      'locked-defender-has-concrete-requirement-reasons',
      'insufficient-resources-have-concrete-reasons',
      'save-reload-persists-both-queues',
      'offline-completion-exactly-once',
      'spaceport-level-change-does-not-recalculate-existing-tasks',
      'level-ten-new-task-uses-50-percent-duration',
      'back-and-escape-return-to-spaceport-dialog',
    ],
  };
}

app.whenReady().then(async () => {
  let win;
  try {
    fs.mkdirSync(OUTPUT, { recursive: true });
    win = new BrowserWindow({
      width: 1000,
      height: 700,
      show: false,
      backgroundColor: '#02050a',
      webPreferences: {
        offscreen: true,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        partition: 'qa-spaceport-upgrades-functional',
      },
    });
    await win.loadFile(path.join(ROOT, 'dist', 'index.html'));
    win.webContents.debugger.attach('1.3');

    for (const [width, height] of VIEWPORTS) {
      const label = `${width}x${height}`;
      const directory = path.join(OUTPUT, label);
      fs.mkdirSync(directory, { recursive: true });
      await win.webContents.debugger.sendCommand('Emulation.setDeviceMetricsOverride', {
        width,
        height,
        deviceScaleFactor: 1,
        mobile: false,
        screenWidth: width,
        screenHeight: height,
      });
      await settle(win);
      const result = await verifyFlow(win, directory, label);
      fs.writeFileSync(path.join(directory, 'spaceport-upgrades-metrics.json'), JSON.stringify(result, null, 2));
    }

    win.webContents.debugger.detach();
    win.destroy();
    app.exit(0);
  } catch (error) {
    console.error(error);
    try { if (win?.webContents.debugger.isAttached()) win.webContents.debugger.detach(); } catch {}
    win?.destroy();
    app.exit(1);
  }
});
