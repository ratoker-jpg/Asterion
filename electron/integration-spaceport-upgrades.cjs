const { app, BrowserWindow } = require('electron');
const path = require('path');

app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-gpu');
app.on('window-all-closed', () => {});

const ROOT = path.join(__dirname, '..');
const SAVE_KEY = 'asterion.vertical-slice.v1';
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
  await sleep(100);
}

async function reload(win) {
  const done = new Promise((resolve) => win.webContents.once('did-finish-load', resolve));
  win.webContents.reload();
  await done;
  await waitFor(win, `document.querySelector('.utility-navigation')`);
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

async function seed(win) {
  await win.webContents.executeJavaScript(`localStorage.removeItem(${JSON.stringify(SAVE_KEY)})`);
  await reload(win);
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
  if (!ok) throw new Error('Could not seed Spaceport integration state');
  await reload(win);
}

async function openSpaceport(win, track = 'ships') {
  await click(win, '.header-zone--military');
  await waitFor(win, `document.querySelector('[data-qa-zone-view][data-zone="military"]')`);
  await click(win, '[data-zone-building-role="spaceport"]');
  await waitFor(win, `document.querySelector('[data-qa-building-dialog="spaceport"]')`);
  await click(win, '[data-qa-enter-building="spaceport"]');
  await waitFor(win, `document.querySelector('[data-qa-spaceport-upgrades]')`);
  if (track === 'commanders') await click(win, '[data-qa-spaceport-tab="commanders"]');
}

async function reopenSpaceport(win, track = 'ships') {
  await reload(win);
  await openSpaceport(win, track);
}

async function readSave(win) {
  return win.webContents.executeJavaScript(`(() => {
    const save = JSON.parse(localStorage.getItem(${JSON.stringify(SAVE_KEY)}) || '{}');
    const planet = save.planets?.['helion-01'];
    return {
      metal: save.metal,
      minerals: save.minerals,
      gas: save.gas,
      levels: planet?.spaceportUpgrades?.shipLevels ?? {},
      shipQueue: planet?.spaceportUpgrades?.shipQueue ?? [],
      commanderQueue: planet?.spaceportUpgrades?.commanderQueue ?? [],
    };
  })()`);
}

function assertChain(queue, shipId, label) {
  if (queue.length !== 3) throw new Error(`${label}: expected 3 tasks, got ${JSON.stringify(queue)}`);
  if (!queue.every((task) => task.shipId === shipId)) throw new Error(`${label}: queue target mismatch ${JSON.stringify(queue)}`);
  const chain = queue.map((task) => [task.fromLevel, task.toLevel]);
  if (JSON.stringify(chain) !== JSON.stringify([[0, 1], [1, 2], [2, 3]])) {
    throw new Error(`${label}: level chain mismatch ${JSON.stringify(chain)}`);
  }
  if (queue[1].startedAt !== queue[0].finishAt || queue[2].startedAt !== queue[1].finishAt) {
    throw new Error(`${label}: queue is not strict FIFO ${JSON.stringify(queue)}`);
  }
}

async function assertRepeatedRow(win, shipId, maxLevel, label) {
  const snapshot = await win.webContents.executeJavaScript(`(() => {
    const row = document.querySelector('[data-qa-spaceport-card=${JSON.stringify(shipId)}]');
    if (!row) return null;
    const button = row.querySelector('[data-qa-spaceport-upgrade]');
    const progress = row.querySelector('[data-qa-spaceport-level-progress]');
    return {
      queuedCount: row.getAttribute('data-qa-spaceport-queued-count'),
      positions: Array.from(row.querySelectorAll('[data-qa-spaceport-queued-task]')).map((node) => node.getAttribute('data-qa-spaceport-queued-position')),
      buttonDisabled: Boolean(button?.disabled),
      buttonText: button?.textContent?.replace(/\s+/g, ' ').trim() ?? '',
      queueBlocker: row.querySelector('[data-qa-spaceport-blocker="queue"]')?.textContent?.replace(/\s+/g, ' ').trim() ?? '',
      maxLevel: progress?.getAttribute('data-qa-max-level'),
      currentLevel: progress?.getAttribute('data-qa-current-level'),
      projectedLevel: progress?.getAttribute('data-qa-projected-level'),
    };
  })()`);
  if (!snapshot) throw new Error(`${label}: row missing`);
  if (snapshot.queuedCount !== '3' || JSON.stringify(snapshot.positions) !== JSON.stringify(['1', '2', '3'])) {
    throw new Error(`${label}: repeated queue positions missing ${JSON.stringify(snapshot)}`);
  }
  if (!snapshot.buttonDisabled || !snapshot.queueBlocker.includes('Очередь улучшений заполнена')) {
    throw new Error(`${label}: fourth enqueue not blocked by queue capacity ${JSON.stringify(snapshot)}`);
  }
  if (snapshot.maxLevel !== String(maxLevel) || snapshot.currentLevel !== '0' || snapshot.projectedLevel !== '3') {
    throw new Error(`${label}: progress metadata mismatch ${JSON.stringify(snapshot)}`);
  }
}

async function forceOfflineCompletion(win) {
  const ok = await win.webContents.executeJavaScript(`(() => {
    const save = JSON.parse(localStorage.getItem(${JSON.stringify(SAVE_KEY)}) || '{}');
    const state = save.planets?.['helion-01']?.spaceportUpgrades;
    if (!state) return false;
    const base = Date.now() - 5000;
    for (const queue of [state.shipQueue, state.commanderQueue]) {
      if (!Array.isArray(queue) || queue.length !== 3) return false;
      queue.forEach((task, index) => {
        task.startedAt = base + index * 10;
        task.finishAt = base + index * 10 + 5;
        task.effectiveDurationMs = 5;
      });
    }
    localStorage.setItem(${JSON.stringify(SAVE_KEY)}, JSON.stringify(save));
    return true;
  })()`);
  if (!ok) throw new Error('Could not force offline completion');
}

async function seedMaxLevels(win) {
  const ok = await win.webContents.executeJavaScript(`(() => {
    const save = JSON.parse(localStorage.getItem(${JSON.stringify(SAVE_KEY)}) || '{}');
    const state = save.planets?.['helion-01']?.spaceportUpgrades;
    if (!state) return false;
    state.shipQueue = [];
    state.commanderQueue = [];
    state.shipLevels.transporter = 10;
    state.shipLevels.corsair = 40;
    localStorage.setItem(${JSON.stringify(SAVE_KEY)}, JSON.stringify(save));
    return true;
  })()`);
  if (!ok) throw new Error('Could not seed max levels');
}

async function assertMaxRow(win, shipId, expectedMax, label) {
  const snapshot = await win.webContents.executeJavaScript(`(() => {
    const row = document.querySelector('[data-qa-spaceport-card=${JSON.stringify(shipId)}]');
    const progress = row?.querySelector('[data-qa-spaceport-level-progress]');
    const button = row?.querySelector('[data-qa-spaceport-upgrade]');
    return row ? {
      max: progress?.getAttribute('data-qa-max-level'),
      current: progress?.getAttribute('data-qa-current-level'),
      completed: progress?.querySelectorAll('.is-complete').length ?? 0,
      text: row.textContent?.replace(/\s+/g, ' ').trim() ?? '',
      disabled: Boolean(button?.disabled),
    } : null;
  })()`);
  if (!snapshot || snapshot.max !== String(expectedMax) || snapshot.current !== String(expectedMax) || snapshot.completed !== expectedMax || !snapshot.disabled || !snapshot.text.includes('Максимальный уровень')) {
    throw new Error(`${label}: max-level UI mismatch ${JSON.stringify(snapshot)}`);
  }
}

async function assertRequirementBadges(win) {
  const snapshot = await win.webContents.executeJavaScript(`(() => {
    const row = document.querySelector('[data-qa-spaceport-card="defender"]');
    if (!row) return null;
    const badges = Array.from(row.querySelectorAll('[data-qa-spaceport-requirement-badge]'));
    const target = badges.find((badge) => badge.getAttribute('data-qa-spaceport-requirement-status') === 'missing') ?? badges[0];
    target?.focus();
    return {
      count: badges.length,
      allHaveArt: badges.every((badge) => Boolean(badge.querySelector('img')?.getAttribute('src'))),
      allFocusable: badges.every((badge) => badge.tabIndex === 0),
      tooltip: target?.getAttribute('data-tooltip') ?? '',
      tooltipVisibility: target ? getComputedStyle(target, '::after').visibility : '',
      blockers: Array.from(row.querySelectorAll('[data-qa-spaceport-blocker="requirement"]')).map((node) => node.textContent?.replace(/\s+/g, ' ').trim() ?? ''),
      fallbackCount: row.querySelectorAll('[data-qa-spaceport-requirement-fallback]').length,
    };
  })()`);
  if (!snapshot || snapshot.count < 3 || !snapshot.allHaveArt || !snapshot.allFocusable || snapshot.fallbackCount !== 0) {
    throw new Error(`Known Defender requirements are not asset badges ${JSON.stringify(snapshot)}`);
  }
  if (!snapshot.tooltip.includes('Текущий уровень:') || !snapshot.tooltip.includes('Требуется:') || !snapshot.tooltip.includes('Статус:') || snapshot.tooltipVisibility !== 'visible') {
    throw new Error(`Requirement hover/focus tooltip is not available ${JSON.stringify(snapshot)}`);
  }
  if (!snapshot.blockers.some((value) => value.includes('Ионная наука')) || !snapshot.blockers.some((value) => value.includes('Топливные элементы'))) {
    throw new Error(`Concrete requirement blockers missing ${JSON.stringify(snapshot)}`);
  }
}

async function verify(win) {
  await seed(win);
  await openSpaceport(win, 'ships');

  const excludedVisible = await win.webContents.executeJavaScript(`['solar-satellite','spy-probe','colonizer','recycler'].filter((id) => document.querySelector('[data-qa-spaceport-card="' + id + '"]'))`);
  if (excludedVisible.length) throw new Error(`Excluded ships visible in upgrade catalog: ${excludedVisible.join(', ')}`);

  for (let index = 0; index < 3; index += 1) {
    await click(win, '[data-qa-spaceport-upgrade="transporter"]');
    await waitFor(win, `document.querySelector('[data-qa-spaceport-queue-count]')?.getAttribute('data-qa-spaceport-queue-count') === '${index + 1}/3'`);
  }
  let saved = await readSave(win);
  assertChain(saved.shipQueue, 'transporter', 'ordinary ship UI enqueue');
  if (saved.metal !== 98500 || saved.minerals !== 99250 || saved.gas !== 100000) throw new Error(`ordinary ship resource deduction mismatch ${JSON.stringify(saved)}`);
  await assertRepeatedRow(win, 'transporter', 10, 'ordinary ship row');

  await click(win, '[data-qa-spaceport-tab="commanders"]');
  for (let index = 0; index < 3; index += 1) {
    await click(win, '[data-qa-spaceport-upgrade="corsair"]');
    await waitFor(win, `document.querySelector('[data-qa-spaceport-queue-count]')?.getAttribute('data-qa-spaceport-queue-count') === '${index + 1}/3'`);
  }
  saved = await readSave(win);
  assertChain(saved.commanderQueue, 'corsair', 'Corsair UI enqueue');
  if (saved.shipQueue.length !== 3) throw new Error('Commander enqueue mutated ordinary queue');
  if (saved.metal !== 97000 || saved.minerals !== 98500 || saved.gas !== 100000) throw new Error(`commander resource deduction mismatch ${JSON.stringify(saved)}`);
  await assertRepeatedRow(win, 'corsair', 40, 'Corsair row');

  await forceOfflineCompletion(win);
  await reopenSpaceport(win, 'ships');
  saved = await readSave(win);
  if (saved.levels.transporter !== 3 || saved.levels.corsair !== 3 || saved.shipQueue.length || saved.commanderQueue.length) {
    throw new Error(`offline completion mismatch ${JSON.stringify(saved)}`);
  }
  await reopenSpaceport(win, 'ships');
  const secondReload = await readSave(win);
  if (secondReload.levels.transporter !== 3 || secondReload.levels.corsair !== 3) {
    throw new Error(`offline completion applied more than once ${JSON.stringify(secondReload)}`);
  }

  await assertRequirementBadges(win);

  await seedMaxLevels(win);
  await reopenSpaceport(win, 'ships');
  await assertMaxRow(win, 'transporter', 10, 'ordinary max');
  await click(win, '[data-qa-spaceport-tab="commanders"]');
  await assertMaxRow(win, 'corsair', 40, 'commander max');
}

app.whenReady().then(async () => {
  let win;
  try {
    win = new BrowserWindow({
      width: 1280,
      height: 720,
      show: false,
      backgroundColor: '#02050a',
      webPreferences: {
        offscreen: true,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        partition: 'qa-spaceport-upgrades-integration',
      },
    });
    await win.loadFile(path.join(ROOT, 'dist', 'index.html'));
    await verify(win);
    win.destroy();
    app.exit(0);
  } catch (error) {
    console.error(error);
    win?.destroy();
    app.exit(1);
  }
});
