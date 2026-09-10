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
  await waitFor(win, `document.querySelector('[data-qa-navigation="utility"]')`);
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

async function capture(win, directory, name, selector = null) {
  if (selector) {
    await win.webContents.executeJavaScript(`document.querySelector(${JSON.stringify(selector)})?.scrollIntoView({ block: 'center', inline: 'nearest' })`);
  } else {
    await win.webContents.executeJavaScript('window.scrollTo(0, 0)');
  }
  await settle(win);
  const result = await win.webContents.debugger.sendCommand('Page.captureScreenshot', {
    format: 'png',
    fromSurface: true,
    captureBeyondViewport: false,
  });
  fs.writeFileSync(path.join(directory, `${name}.png`), Buffer.from(result.data, 'base64'));
}

async function seedSpaceport(win) {
  await win.webContents.executeJavaScript(`localStorage.removeItem(${JSON.stringify(SAVE_KEY)})`);
  await reload(win);
  const ok = await win.webContents.executeJavaScript(`(() => {
    const save = JSON.parse(localStorage.getItem(${JSON.stringify(SAVE_KEY)}) || 'null');
    const planet = save?.planets?.['helion-01'];
    if (!planet?.buildings) return false;
    planet.buildings.spaceport = 1;
    planet.buildings.shipyard = 20;
    save.science = save.science || { levels: {}, queue: [] };
    save.science.levels = save.science.levels || {};
    save.science.levels[3] = 2;
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
  await click(win, '[data-qa-zone="military"]');
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

async function measureLayout(win) {
  return win.webContents.executeJavaScript(`(() => {
    const root = document.querySelector('[data-qa-spaceport-upgrades]');
    if (!root) return null;
    const pick = (element) => {
      if (!element) return null;
      const rect = element.getBoundingClientRect();
      return {
        left: rect.left,
        right: rect.right,
        width: rect.width,
        clientWidth: element.clientWidth,
        scrollWidth: element.scrollWidth,
        clientHeight: element.clientHeight,
        scrollHeight: element.scrollHeight,
      };
    };
    const sidebar = root.querySelector('[data-qa-spaceport-sidebar]');
    const main = root.querySelector('.spaceport-main-v2');
    const catalog = root.querySelector('.spaceport-catalog-v2');
    const rows = Array.from(root.querySelectorAll('.spaceport-row-v2')).map(pick);
    return {
      viewport: { width: innerWidth, height: innerHeight },
      document: { width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight },
      longPage: document.documentElement.classList.contains('asterion-long-page'),
      root: pick(root),
      sidebar: pick(sidebar),
      main: pick(main),
      catalog: pick(catalog),
      rows,
      catalogOverflowY: catalog ? getComputedStyle(catalog).overflowY : null,
      sidebarPosition: sidebar ? getComputedStyle(sidebar).position : null,
    };
  })()`);
}

function assertLayout(snapshot, label) {
  if (!snapshot) throw new Error(`${label}: missing Spaceport layout snapshot`);
  const epsilon = 3;
  const { viewport, document, root, sidebar, main, catalog, rows } = snapshot;
  if (!snapshot.longPage) throw new Error(`${label}: global page scroll mode missing`);
  if (document.width > viewport.width + epsilon) throw new Error(`${label}: horizontal page overflow ${JSON.stringify(snapshot)}`);
  if (!root || root.left < -epsilon || root.right > viewport.width + epsilon) throw new Error(`${label}: root clipped horizontally ${JSON.stringify(root)}`);
  if (!sidebar || !main || sidebar.right > main.left + epsilon) throw new Error(`${label}: sidebar/main overlap`);
  if (viewport.width > 820 && snapshot.sidebarPosition !== 'sticky') throw new Error(`${label}: sidebar is not sticky`);
  if (!catalog || ['auto', 'scroll'].includes(snapshot.catalogOverflowY)) throw new Error(`${label}: catalog owns forbidden vertical scroll`);
  if (catalog.scrollHeight > catalog.clientHeight + epsilon) throw new Error(`${label}: catalog is internally clipped`);
  if (rows.length < 9) throw new Error(`${label}: catalog rows missing (${rows.length})`);
  const expectedWidth = catalog.width - 28;
  for (const row of rows.slice(0, 5)) {
    if (!row || row.width < expectedWidth - 4) throw new Error(`${label}: row is not full-width ${JSON.stringify({ row, catalog })}`);
    if (row.scrollWidth > row.clientWidth + epsilon) throw new Error(`${label}: row has horizontal overflow ${JSON.stringify(row)}`);
  }
  if (document.height > 9000) throw new Error(`${label}: runaway document height ${document.height}`);
}

async function assertStableHeight(win, label) {
  const heights = [];
  for (let index = 0; index < 5; index += 1) {
    heights.push(await win.webContents.executeJavaScript('document.documentElement.scrollHeight'));
    await sleep(100);
  }
  if (Math.max(...heights) - Math.min(...heights) > 3) throw new Error(`${label}: document height keeps growing ${JSON.stringify(heights)}`);
  return heights;
}

async function prepareRequirementTarget(win) {
  return win.webContents.executeJavaScript(`(() => {
    const defender = document.querySelector('[data-qa-spaceport-card="defender"]');
    const badges = Array.from(defender?.querySelectorAll('[data-qa-spaceport-requirement-badge]') ?? []);
    const target = badges.find((badge) => badge.getAttribute('data-qa-spaceport-requirement-status') === 'missing') ?? badges[0];
    const targetIndex = badges.indexOf(target);
    if (!target || targetIndex < 0) return null;
    target.scrollIntoView({ block: 'center', inline: 'center' });
    const rect = target.getBoundingClientRect();
    return {
      targetIndex,
      hasPreviousBadge: targetIndex > 0,
      center: { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2) },
      viewport: { width: innerWidth, height: innerHeight },
    };
  })()`);
}

async function openRequirementTooltip(win, interaction) {
  const prepared = await prepareRequirementTarget(win);
  if (!prepared) throw new Error('Requirement badge target is missing');
  await settle(win);

  if (interaction === 'focus') {
    if (!prepared.hasPreviousBadge) throw new Error('Requirement keyboard-focus QA needs a preceding badge');
    const predecessorFocused = await win.webContents.executeJavaScript(`(() => {
      const defender = document.querySelector('[data-qa-spaceport-card="defender"]');
      const badges = Array.from(defender?.querySelectorAll('[data-qa-spaceport-requirement-badge]') ?? []);
      const target = badges.find((badge) => badge.getAttribute('data-qa-spaceport-requirement-status') === 'missing') ?? badges[0];
      const index = badges.indexOf(target);
      const predecessor = index > 0 ? badges[index - 1] : null;
      predecessor?.focus();
      return Boolean(predecessor && document.activeElement === predecessor);
    })()`);
    if (!predecessorFocused) throw new Error('Could not prepare preceding requirement badge for Tab navigation');
    await settle(win);
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Tab' });
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Tab' });
  } else {
    await win.webContents.executeJavaScript('document.activeElement?.blur()');
    await settle(win);
    win.webContents.sendInputEvent({ type: 'mouseMove', x: 1, y: 1, movementX: 0, movementY: 0 });
    await sleep(50);
    win.webContents.sendInputEvent({
      type: 'mouseMove',
      x: Math.max(1, Math.min(prepared.viewport.width - 2, prepared.center.x)),
      y: Math.max(1, Math.min(prepared.viewport.height - 2, prepared.center.y)),
      movementX: 0,
      movementY: 0,
    });
  }
  await settle(win);

  return win.webContents.executeJavaScript(`(() => {
    const excluded = ['solar-satellite','spy-probe','colonizer','recycler'];
    const defender = document.querySelector('[data-qa-spaceport-card="defender"]');
    const badges = Array.from(defender?.querySelectorAll('[data-qa-spaceport-requirement-badge]') ?? []);
    const target = badges.find((badge) => badge.getAttribute('data-qa-spaceport-requirement-status') === 'missing') ?? badges[0];
    const tooltip = target?.querySelector('[role="tooltip"]') ?? null;
    const style = tooltip ? getComputedStyle(tooltip) : null;
    const rect = tooltip?.getBoundingClientRect() ?? null;
    const clippedBy = [];
    if (tooltip && rect) {
      for (let ancestor = tooltip.parentElement; ancestor && ancestor !== document.documentElement; ancestor = ancestor.parentElement) {
        const ancestorStyle = getComputedStyle(ancestor);
        const ancestorRect = ancestor.getBoundingClientRect();
        const clipsX = ['hidden', 'clip', 'auto', 'scroll'].includes(ancestorStyle.overflowX);
        const clipsY = ['hidden', 'clip', 'auto', 'scroll'].includes(ancestorStyle.overflowY);
        if ((clipsX && (rect.left < ancestorRect.left - 1 || rect.right > ancestorRect.right + 1)) ||
            (clipsY && (rect.top < ancestorRect.top - 1 || rect.bottom > ancestorRect.bottom + 1))) {
          clippedBy.push(ancestor.getAttribute('class') || ancestor.tagName);
        }
      }
    }
    const text = tooltip?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
    const details = Array.from(tooltip?.querySelectorAll(':scope > span') ?? []).map((node) => node.textContent?.replace(/\s+/g, ' ').trim() ?? '');
    return {
      excludedVisible: excluded.filter((id) => document.querySelector('[data-qa-spaceport-card="' + id + '"]')),
      transporter: Boolean(document.querySelector('[data-qa-spaceport-card="transporter"]')),
      megaTransporter: Boolean(document.querySelector('[data-qa-spaceport-card="mega-transporter"]')),
      badgeCount: badges.length,
      badgeArts: badges.map((badge) => badge.querySelector('img')?.getAttribute('src') ?? ''),
      fallbackCount: defender?.querySelectorAll('[data-qa-spaceport-requirement-fallback]').length ?? 0,
      focused: Boolean(target && document.activeElement === target),
      exists: Boolean(tooltip),
      ariaHidden: tooltip?.getAttribute('aria-hidden') ?? null,
      visibility: style?.visibility ?? '',
      opacity: style?.opacity ?? '',
      rect: rect ? { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height } : null,
      inViewport: Boolean(rect && rect.left >= -1 && rect.top >= -1 && rect.right <= innerWidth + 1 && rect.bottom <= innerHeight + 1),
      clippedBy,
      text,
      name: tooltip?.querySelector('strong')?.textContent?.replace(/\s+/g, ' ').trim() ?? '',
      details,
      expectedName: target?.getAttribute('data-qa-spaceport-requirement-badge') ?? '',
      expectedStatus: target?.getAttribute('data-qa-spaceport-requirement-status') ?? '',
      blockers: Array.from(defender?.querySelectorAll('[data-qa-spaceport-blocker="requirement"]') ?? []).map((node) => node.textContent?.replace(/\s+/g, ' ').trim() ?? ''),
    };
  })()`);
}

function assertRequirementTooltip(snapshot, label, interaction) {
  if (snapshot.excludedVisible.length || !snapshot.transporter || !snapshot.megaTransporter) throw new Error(`${label}: catalog filter mismatch ${JSON.stringify(snapshot)}`);
  if (snapshot.badgeCount < 3 || snapshot.badgeArts.some((src) => !src) || snapshot.fallbackCount !== 0) throw new Error(`${label}: known requirements are not asset badges ${JSON.stringify(snapshot)}`);
  if (!snapshot.exists || snapshot.ariaHidden !== 'false' || snapshot.visibility !== 'visible' || snapshot.opacity !== '1') {
    throw new Error(`${label}: DOM tooltip is not visible via ${interaction} ${JSON.stringify(snapshot)}`);
  }
  if (!snapshot.rect || snapshot.rect.width <= 0 || snapshot.rect.height <= 0 || !snapshot.inViewport || snapshot.clippedBy.length > 0) {
    throw new Error(`${label}: DOM tooltip geometry/clipping failed via ${interaction} ${JSON.stringify(snapshot)}`);
  }
  const expectedStatusText = snapshot.expectedStatus === 'missing' ? 'Статус: не выполнено' : 'Статус: выполнено';
  if (!snapshot.expectedName || snapshot.name !== snapshot.expectedName || !snapshot.text.includes(snapshot.expectedName) ||
      !snapshot.details.some((value) => value.startsWith('Текущий уровень:')) ||
      !snapshot.details.some((value) => value.startsWith('Требуется:')) ||
      !snapshot.details.includes(expectedStatusText)) {
    throw new Error(`${label}: DOM tooltip text is incomplete via ${interaction} ${JSON.stringify(snapshot)}`);
  }
}

async function assertCatalogAndRequirements(win, label) {
  const focusSnapshot = await openRequirementTooltip(win, 'focus');
  if (!focusSnapshot.focused) throw new Error(`${label}: requirement badge did not receive keyboard Tab focus ${JSON.stringify(focusSnapshot)}`);
  assertRequirementTooltip(focusSnapshot, label, 'keyboard focus');

  const hoverSnapshot = await openRequirementTooltip(win, 'hover');
  assertRequirementTooltip(hoverSnapshot, label, 'hover');

  if (!hoverSnapshot.blockers.some((value) => value.includes('Ионная наука')) || !hoverSnapshot.blockers.some((value) => value.includes('Топливные элементы'))) throw new Error(`${label}: blocker strips missing ${JSON.stringify(hoverSnapshot)}`);
}

async function enqueueThree(win, shipId) {
  for (let index = 0; index < 3; index += 1) {
    await click(win, `[data-qa-spaceport-upgrade="${shipId}"]`);
    await waitFor(win, `document.querySelector('[data-qa-spaceport-queue-count]')?.getAttribute('data-qa-spaceport-queue-count') === '${index + 1}/3'`);
  }
  const row = await win.webContents.executeJavaScript(`(() => {
    const node = document.querySelector('[data-qa-spaceport-card=${JSON.stringify(shipId)}]');
    return node ? {
      queuedCount: node.getAttribute('data-qa-spaceport-queued-count'),
      positions: Array.from(node.querySelectorAll('[data-qa-spaceport-queued-task]')).map((item) => item.getAttribute('data-qa-spaceport-queued-position')),
      queueBlocker: node.querySelector('[data-qa-spaceport-blocker="queue"]')?.textContent?.replace(/\s+/g, ' ').trim() ?? '',
      buttonDisabled: Boolean(node.querySelector('[data-qa-spaceport-upgrade]')?.disabled),
    } : null;
  })()`);
  if (!row || row.queuedCount !== '3' || JSON.stringify(row.positions) !== JSON.stringify(['1','2','3']) || !row.buttonDisabled || !row.queueBlocker.includes('Очередь улучшений заполнена')) {
    throw new Error(`${shipId}: repeated queue UI mismatch ${JSON.stringify(row)}`);
  }
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
  if (!ok) throw new Error('Could not seed max-level state');
}

async function assertMaxProgress(win, shipId, maxLevel, label) {
  const result = await win.webContents.executeJavaScript(`(() => {
    const row = document.querySelector('[data-qa-spaceport-card=${JSON.stringify(shipId)}]');
    const progress = row?.querySelector('[data-qa-spaceport-level-progress]');
    return row ? {
      current: progress?.getAttribute('data-qa-current-level'),
      max: progress?.getAttribute('data-qa-max-level'),
      completeSegments: progress?.querySelectorAll('.is-complete').length ?? 0,
      queuedSegments: progress?.querySelectorAll('.is-queued').length ?? 0,
      text: row.textContent?.replace(/\s+/g, ' ').trim() ?? '',
    } : null;
  })()`);
  if (!result || result.current !== String(maxLevel) || result.max !== String(maxLevel) || result.completeSegments !== maxLevel || result.queuedSegments !== 0 || !result.text.includes('Максимальный уровень')) {
    throw new Error(`${label}: max progress mismatch ${JSON.stringify(result)}`);
  }
}

async function verifyFlow(win, directory, label) {
  await seedSpaceport(win);
  await activateMilitary(win);
  await openSpaceport(win);

  await assertCatalogAndRequirements(win, label);
  assertLayout(await measureLayout(win), `${label}/ships-standard`);
  const initialHeights = await assertStableHeight(win, `${label}/ships-standard`);
  await capture(win, directory, 'spaceport-ships-standard');
  await capture(win, directory, 'spaceport-blocked-requirements', '[data-qa-spaceport-card="defender"]');

  await win.webContents.executeJavaScript('window.scrollTo(0, 0)');
  await enqueueThree(win, 'transporter');
  assertLayout(await measureLayout(win), `${label}/ships-repeated`);
  await capture(win, directory, 'spaceport-ships-repeated-3-of-3');

  await click(win, '[data-qa-spaceport-tab="commanders"]');
  assertLayout(await measureLayout(win), `${label}/commanders-standard`);
  await enqueueThree(win, 'corsair');
  assertLayout(await measureLayout(win), `${label}/commanders-repeated`);
  await capture(win, directory, 'spaceport-commanders-repeated-3-of-3');

  await seedMaxLevels(win);
  await reopenSpaceport(win, 'ships');
  await assertMaxProgress(win, 'transporter', 10, `${label}/ship-max`);
  assertLayout(await measureLayout(win), `${label}/ship-max`);
  await capture(win, directory, 'spaceport-ships-max-level');

  await click(win, '[data-qa-spaceport-tab="commanders"]');
  await assertMaxProgress(win, 'corsair', 40, `${label}/commander-max`);
  assertLayout(await measureLayout(win), `${label}/commander-max`);
  const finalHeights = await assertStableHeight(win, `${label}/commander-max`);
  await capture(win, directory, 'spaceport-commanders-max-level');

  return {
    viewport: label,
    screenshots: [
      'spaceport-ships-standard.png',
      'spaceport-blocked-requirements.png',
      'spaceport-ships-repeated-3-of-3.png',
      'spaceport-commanders-repeated-3-of-3.png',
      'spaceport-ships-max-level.png',
      'spaceport-commanders-max-level.png',
    ],
    initialScrollHeightSamples: initialHeights,
    finalScrollHeightSamples: finalHeights,
    verified: [
      'sidebar-left-full-width-rows-right',
      'global-document-scroll-without-catalog-inner-scroll',
      'no-horizontal-overflow',
      'four-utility-ships-excluded-from-upgrade-catalog',
      'transporter-and-mega-transporter-remain',
      'known-requirements-use-asset-badges',
      'requirement-dom-tooltip-keyboard-focus-and-hover',
      'requirement-tooltip-visible-nonzero-in-viewport-unclipped',
      'concrete-red-requirement-blockers',
      'ordinary-repeated-queue-0-1-2-3-visual-state',
      'commander-repeated-queue-0-1-2-3-visual-state',
      'ordinary-max-progress-10',
      'commander-max-progress-40',
      'document-height-stable',
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
        partition: 'qa-spaceport-upgrades-visual',
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
