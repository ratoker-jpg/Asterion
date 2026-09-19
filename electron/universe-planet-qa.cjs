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
const OUTPUT = path.join(ROOT, 'artifacts', 'universe-planet-qa');
const SAVE_KEY = 'asterion.vertical-slice.test.v1';
const VIEWPORTS = [[1920, 1080], [1280, 720]];
// Freeze the renderer clock so the scheduled asteroid fixture is stable and
// the QA contract cannot silently weaken when the test is run on another day.
const QA_UNIVERSE_NOW = Date.UTC(2026, 0, 1, 2, 0, 0);
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
  // Offscreen pages can pause requestAnimationFrame while CDP emulation is
  // being applied. A bounded settle keeps this QA deterministic.
  await sleep(110);
}

async function reload(win) {
  const done = new Promise((resolve) => win.webContents.once('did-finish-load', resolve));
  win.webContents.reload();
  await done;
  await waitFor(win, `document.querySelector('[data-qa-navigation="utility"]')`);
  await waitFor(win, `localStorage.getItem(${JSON.stringify(SAVE_KEY)})`);
  await settle(win);
}

async function clickPrimary(win, route) {
  const clicked = await win.webContents.executeJavaScript(`(() => {
    const button = document.querySelector('[data-qa-route="${route}"]');
    if (!button) return false;
    button.click();
    return true;
  })()`);
  if (!clicked) throw new Error(`Primary navigation route not found: ${route}`);
  await waitFor(win, `document.querySelector('[data-qa-universe]')`);
  await settle(win);
}

async function clickObject(win, selector) {
  await clickAt(win, selector);
  await waitFor(win, `document.querySelector('[data-qa-universe-inspector]')`);
  await settle(win);
}

async function clickAt(win, selector, backdrop = false, settleAfter = true) {
  const point = await win.webContents.executeJavaScript(`(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    if (!element) return null;
    element.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    const rect = element.getBoundingClientRect();
    const x = ${backdrop} ? rect.left + 3 : rect.left + rect.width / 2;
    const y = ${backdrop} ? rect.top + 3 : rect.top + rect.height / 2;
    const hit = document.elementFromPoint(x, y);
    if (${backdrop} ? hit !== element : !element.contains(hit)) throw new Error('Click target occluded: ' + ${JSON.stringify(selector)});
    return { x, y };
  })()`);
  if (!point) throw new Error(`Click target missing: ${selector}`);
  await win.webContents.debugger.sendCommand('Input.dispatchMouseEvent', { type: 'mouseMoved', ...point });
  await win.webContents.debugger.sendCommand('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', clickCount: 1 });
  await win.webContents.debugger.sendCommand('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', clickCount: 1 });
  if (settleAfter) await settle(win);
}

async function setInputValue(win, selector, value) {
  const changed = await win.webContents.executeJavaScript(`(() => {
    const input = document.querySelector(${JSON.stringify(selector)});
    if (!input) return false;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    setter?.call(input, ${JSON.stringify(String(value))});
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  })()`);
  if (!changed) throw new Error(`Input not found: ${selector}`);
  await settle(win);
}

async function pressKey(win, key, modifiers = 0) {
  const code = key === 'Tab' ? 9 : 27;
  await win.webContents.debugger.sendCommand('Input.dispatchKeyEvent', { type: 'rawKeyDown', key, code: key, windowsVirtualKeyCode: code, modifiers });
  await win.webContents.debugger.sendCommand('Input.dispatchKeyEvent', { type: 'keyUp', key, code: key, windowsVirtualKeyCode: code, modifiers });
  await settle(win);
}

async function findObject(win, selector, { required = true } = {}) {
  for (let system = 1; system <= 40; system += 1) {
    await selectSystem(win, system);
    if (await win.webContents.executeJavaScript(`Boolean(document.querySelector(${JSON.stringify(selector)}))`)) return system;
  }
  if (required) throw new Error(`Object absent from all 40 systems: ${selector}`);
  return 0;
}

async function capture(win, directory, name) {
  if (skipScreenshots) {
    console.log(`[universe-planet-qa] screenshot skipped: ${name}`);
    return;
  }
  await sleep(100);
  const result = await win.webContents.debugger.sendCommand('Page.captureScreenshot', {
    format: 'png',
    fromSurface: true,
    captureBeyondViewport: false,
  });
  fs.writeFileSync(path.join(directory, `${name}.png`), Buffer.from(result.data, 'base64'));
}

async function selectSystem(win, system) {
  const changed = await win.webContents.executeJavaScript(`(() => {
    const element = document.querySelector('.universe-jump select');
    if (!element) return false;
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set;
    setter?.call(element, ${JSON.stringify(String(system))});
    element.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  })()`);
  if (!changed) throw new Error('Universe system selector not found');
  await waitFor(win, `document.querySelector('[data-qa-universe]')?.getAttribute('data-qa-universe-system') === ${JSON.stringify(String(system))}`);
  await settle(win);
}

async function mapSnapshot(win) {
  return win.webContents.executeJavaScript(`(() => {
    const root = document.documentElement;
    const objects = Array.from(document.querySelectorAll('[data-qa-universe-scene] [data-qa-universe-object]'));
    const positions = Array.from(document.querySelectorAll('[data-qa-universe-scene] [data-qa-universe-kind]:not([data-qa-universe-kind="asteroid"])'));
    const animatedSelectors = ['.system-star', '.system-planet', '.system-asteroid', '.empty-slot'];
    const animated = Object.fromEntries(animatedSelectors.map((selector) => [selector, document.querySelector(selector) ? getComputedStyle(document.querySelector(selector)).animationName : null]));
    const rects = () => objects.map((node) => {
      const rect = node.getBoundingClientRect();
      return { id: node.getAttribute('data-qa-universe-object'), kind: node.getAttribute('data-qa-universe-kind'), position: node.getAttribute('data-qa-universe-asteroid-position') || '', x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    });
    return {
      system: document.querySelector('[data-qa-universe]')?.getAttribute('data-qa-universe-system') || '',
      systemOptions: document.querySelectorAll('.universe-jump select option').length,
      systemOptionTexts: Array.from(document.querySelectorAll('.universe-jump select option')).map((option) => option.textContent?.trim() || ''),
      positionCount: positions.length,
      objectKinds: [...new Set(objects.map((node) => node.getAttribute('data-qa-universe-kind')))].sort(),
      asteroidCount: document.querySelectorAll('[data-qa-universe-kind="asteroid"]').length,
      asteroidToggle: document.querySelector('[data-qa-universe-asteroids-toggle]')?.getAttribute('aria-pressed') || '',
      homeCaption: document.querySelector('[data-qa-universe-object="player-planet-helion-01"] [data-qa-map-caption]')?.textContent?.trim() || '',
      legend: Array.from(document.querySelectorAll('.universe-map-legend span')).map((node) => ({ text: node.textContent?.trim() || '', className: node.className })),
      ownerRelations: Array.from(document.querySelectorAll('[data-qa-universe-kind="player"], [data-qa-universe-kind="npc"]')).map((node) => ({ id: node.getAttribute('data-qa-universe-object'), relation: node.getAttribute('data-qa-universe-relation') || '', className: node.className })),
      mapCaptions: Array.from(document.querySelectorAll('[data-qa-map-caption]')).map((node) => node.textContent?.trim() || ''),
      coordinateLineCount: document.querySelectorAll('.system-planet small, .empty-slot small').length,
      animated,
      rects: rects(),
      viewport: { innerWidth: innerWidth, innerHeight: innerHeight, devicePixelRatio },
      horizontalOverflow: root.scrollWidth > root.clientWidth + 2,
      bodyHorizontalOverflow: document.body.scrollWidth > document.body.clientWidth + 2,
      localStorageKeys: Object.keys(localStorage),
      htmlClass: document.documentElement.className,
      webStageScale: getComputedStyle(document.documentElement).getPropertyValue('--web-stage-scale').trim(),
      visualViewport: window.visualViewport ? { width: window.visualViewport.width, height: window.visualViewport.height } : null,
      stageRect: (() => { const rect = document.querySelector('.stage')?.getBoundingClientRect(); return rect ? { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) } : null; })(),
    };
  })()`);
}

async function stableObjectRects(win, before) {
  await sleep(1_100);
  return win.webContents.executeJavaScript(`(() => {
    const ids = ${JSON.stringify(before.map((item) => item.id))};
    return ids.map((id) => {
      const node = document.querySelector('[data-qa-universe-object="' + id + '"]');
      if (!node) return null;
      const rect = node.getBoundingClientRect();
      return { id, kind: node.getAttribute('data-qa-universe-kind'), position: node.getAttribute('data-qa-universe-asteroid-position') || '', x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    });
  })()`);
}

async function inspectorSnapshot(win) {
  return win.webContents.executeJavaScript(`(() => {
    const inspector = document.querySelector('[data-qa-universe-inspector]');
    const points = Array.from(document.querySelectorAll('[data-qa-universe-points] dd')).map((node) => node.textContent?.trim() || '');
    const actions = Array.from(document.querySelectorAll('[data-qa-universe-action]')).map((node) => ({
      action: node.getAttribute('data-qa-universe-action'),
      status: node.getAttribute('data-qa-universe-action-status'),
      disabled: Boolean(node.disabled),
      title: node.getAttribute('title') || '',
    }));
    const specialActions = Array.from(document.querySelectorAll('[data-qa-universe-special-action]')).map((node) => ({
      action: node.getAttribute('data-qa-universe-special-action'),
      disabled: Boolean(node.disabled),
      title: node.getAttribute('title') || '',
    }));
    return {
      kind: inspector?.getAttribute('data-qa-inspector-kind') || '',
      text: inspector?.textContent?.replace(/\\s+/g, ' ').trim() || '',
      ownerName: document.querySelector('[data-qa-universe-owner-name]')?.textContent?.trim() || '',
      avatar: document.querySelector('[data-qa-universe-avatar] img')?.getAttribute('src') || '',
      points,
      planetRows: document.querySelectorAll('[data-qa-universe-planet-row]').length,
      ownerId: document.querySelector('[data-qa-universe-owner]')?.getAttribute('data-qa-universe-owner'),
      rows: Array.from(document.querySelectorAll('[data-qa-universe-planet-row]')).map((row) => ({
        id: row.getAttribute('data-qa-universe-planet-row'),
        coordinate: row.querySelector('[data-qa-universe-visit] small span')?.textContent?.match(/\\[\\d+:\\d+:\\d+\\]/)?.[0] || '',
        visitId: row.querySelector('[data-qa-universe-visit]')?.getAttribute('data-qa-universe-visit'),
      })),
      actions,
      specialActions,
      specialActionDisabled: Boolean(document.querySelector('[data-qa-universe-special-action]')?.disabled),
      targetCoordinate: document.querySelector('[data-qa-universe-target-coordinate]')?.getAttribute('data-qa-universe-target-coordinate') || '',
      underlyingKind: document.querySelector('[data-qa-universe-special]')?.getAttribute('data-qa-universe-underlying-kind') || '',
    };
  })()`);
}

async function dismissInspector(win) {
  await clickAt(win, '[data-qa-universe-inspector] .universe-inspector-close');
  await waitFor(win, `!document.querySelector('[data-qa-universe-inspector]')`);
  await settle(win);
}

async function checkModal(win) {
  const state = await win.webContents.executeJavaScript(`(() => {
    const dialog = document.querySelector('[data-qa-universe-inspector]');
    const rect = dialog.getBoundingClientRect();
    return { role: dialog.getAttribute('role'), modal: dialog.getAttribute('aria-modal'),
      portal: dialog.parentElement.parentElement === document.body, inert: document.querySelector('.stage').inert,
      focused: dialog.contains(document.activeElement),
      centered: Math.abs(rect.x + rect.width / 2 - innerWidth / 2) <= 2 && Math.abs(rect.y + rect.height / 2 - innerHeight / 2) <= 2,
      fits: rect.x >= 0 && rect.y >= 0 && rect.right <= innerWidth + 1 && rect.bottom <= innerHeight + 1 };
  })()`);
  if (state.role !== 'dialog' || state.modal !== 'true' || !state.portal || !state.inert || !state.focused || !state.centered || !state.fits) throw new Error(`Modal contract failed: ${JSON.stringify(state)}`);
  for (const reverse of [true, false]) {
    await win.webContents.executeJavaScript(`(() => {
      const controls = [...document.querySelectorAll('[data-qa-universe-inspector] button:not(:disabled), [data-qa-universe-inspector] [tabindex="0"]')];
      controls[${reverse} ? 0 : controls.length - 1].focus();
    })()`);
    await pressKey(win, 'Tab', reverse ? 8 : 0);
    const trapped = await win.webContents.executeJavaScript(`(() => {
      const controls = [...document.querySelectorAll('[data-qa-universe-inspector] button:not(:disabled), [data-qa-universe-inspector] [tabindex="0"]')];
      return document.activeElement === controls[${reverse} ? controls.length - 1 : 0];
    })()`);
    if (!trapped) throw new Error(`Modal focus trap failed: ${reverse ? 'Shift+Tab' : 'Tab'}`);
  }
}

async function checkRestoredFocus(win, id) {
  await waitFor(win, `!document.querySelector('[data-qa-universe-inspector]') && !document.querySelector('.stage').inert && document.activeElement?.getAttribute('data-qa-universe-object') === ${JSON.stringify(id)}`);
}

function checkCopy(snapshot) {
  if (/runtime|fixture|рантайм|фикстур/i.test(snapshot.text)) throw new Error(`Implementation jargon in inspector: ${snapshot.text}`);
}

async function runViewport(width, height) {
  const label = `${width}x${height}`;
  const directory = path.join(OUTPUT, label);
  fs.mkdirSync(directory, { recursive: true });
  const win = new BrowserWindow({
    // CDP owns the logical viewport below; keep the native offscreen surface
    // modest so Windows compositor/DPI settings do not distort the capture.
    width: 1000,
    height: 700,
    useContentSize: true,
    show: false,
    backgroundColor: '#02050a',
    webPreferences: {
      offscreen: true,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      partition: `qa-universe-${label}`,
    },
  });
  win.webContents.on('console-message', (event) => {
    const message = event.message || '';
    if (/error/i.test(message)) console.warn(`[${label}] renderer: ${message}`);
  });

  try {
    const loaded = new Promise((resolve) => win.webContents.once('did-finish-load', resolve));
    await win.loadFile(path.join(ROOT, 'dist', 'index.html'), { search: '?mode=test' });
    await loaded;
    await waitFor(win, `document.querySelector('[data-qa-navigation="utility"]')`);
    win.webContents.debugger.attach('1.3');
    await win.webContents.debugger.sendCommand('Emulation.setDeviceMetricsOverride', {
      width,
      height,
      deviceScaleFactor: 1,
      mobile: false,
      screenWidth: width,
      screenHeight: height,
    });
    await settle(win);
    await waitFor(win, `localStorage.getItem(${JSON.stringify(SAVE_KEY)})`);
    await win.webContents.executeJavaScript(`localStorage.removeItem(${JSON.stringify(SAVE_KEY)}); localStorage.removeItem('asterion.preferences.v2');`);
    await reload(win);
    await win.webContents.executeJavaScript(`void (Date.now = () => ${QA_UNIVERSE_NOW});`);
    await clickPrimary(win, 'universe');

    const map = await mapSnapshot(win);
    if (map.system !== '1' || map.systemOptions !== 40 || map.systemOptionTexts.some((text, index) => text !== String(index + 1).padStart(2, '0')) || map.positionCount !== 24 || map.viewport.innerWidth !== width || map.viewport.innerHeight !== height) throw new Error(`${label}: map cardinality/viewport failed ${JSON.stringify(map)}`);
    if (!map.objectKinds.includes('empty') || !map.objectKinds.includes('player') || map.asteroidCount < 3) {
      throw new Error(`${label}: object fixture coverage failed ${JSON.stringify(map)}`);
    }
    if (map.homeCaption !== '★ Dendrilion' || map.coordinateLineCount !== 0 || map.mapCaptions.some((caption) => /\\[\\d+:\\d+:\\d+\\]/.test(caption))) throw new Error(`${label}: map caption contract failed ${JSON.stringify(map)}`);
    const expectedLegend = ['Ваш мир', 'Союзная', 'Вражеская', 'Нейтральная', 'Необитаемые', 'Уникальные', 'Отступники', 'Аномалии'];
    if (JSON.stringify(map.legend.map((item) => item.text)) !== JSON.stringify(expectedLegend) || map.ownerRelations.find((item) => item.id === 'player-planet-helion-01')?.relation !== 'self') throw new Error(`${label}: relation color legend contract failed ${JSON.stringify({ legend: map.legend, ownerRelations: map.ownerRelations })}`);
    if (Object.values(map.animated).some((name) => name !== null && name !== 'none')) throw new Error(`${label}: map wrappers must remain static ${JSON.stringify(map.animated)}`);
    if (map.horizontalOverflow || map.bodyHorizontalOverflow || !map.stageRect || Math.abs(map.stageRect.x) > 2 || Math.abs(map.stageRect.y) > 2 || Math.abs(map.stageRect.width - width) > 2 || Math.abs(map.stageRect.height - height) > 2) throw new Error(`${label}: map layout/overflow failed ${JSON.stringify(map)}`);
    if (!map.localStorageKeys.includes(SAVE_KEY) || map.localStorageKeys.some((key) => /universe/i.test(key))) throw new Error(`${label}: unexpected universe save key ${JSON.stringify(map.localStorageKeys)}`);

    const stableRects = await stableObjectRects(win, map.rects);
    if (stableRects.some((rect) => !rect)) throw new Error(`${label}: map objects disappeared`);
    const stationary = map.rects.filter((rect) => rect.kind !== 'asteroid');
    const stationaryAfter = stableRects.filter((rect) => rect.kind !== 'asteroid');
    if (JSON.stringify(stationaryAfter) !== JSON.stringify(stationary)) throw new Error(`${label}: planet positions moved after 1.1s`);
    const asteroidsHoldPosition = map.rects.filter((rect) => rect.kind === 'asteroid').every((before) => {
      const after = stableRects.find((rect) => rect.id === before.id);
      return after && after.position === before.position;
    });
    if (!asteroidsHoldPosition) throw new Error(`${label}: asteroid changed its numbered position during a dwell window`);
    await capture(win, directory, 'static-map');

    await clickObject(win, '[data-qa-universe-object="player-planet-helion-01"]');
    const player = await inspectorSnapshot(win);
    checkCopy(player);
    await checkModal(win);
    const playerPortraits = await inspectRenderedFactionGeneralPortraits(win, '[data-qa-universe-inspector] [data-qa-faction-general]');
    assertRenderedFactionGeneralPortraits(playerPortraits, ['aegis'], `${label} player universe`);
    if (player.kind !== 'player' || player.ownerName !== 'Dendrilion' || !player.avatar.includes('aegis_general') || player.points.length !== 4 || player.planetRows !== 1 || player.actions.length !== 2 || player.actions.some((action) => !action.disabled || action.status !== 'disabled' || !action.title.includes('Это ваша планета'))) {
      throw new Error(`${label}: player inspector contract failed ${JSON.stringify(player)}`);
    }
    if (!player.text.includes('Астеры') || !player.text.includes('Содружество Гелион') || !player.text.includes('[HLN]')) throw new Error(`${label}: player profile identity contract failed ${JSON.stringify(player)}`);
    await capture(win, directory, 'player-inspector');
    await dismissInspector(win);
    await checkRestoredFocus(win, 'player-planet-helion-01');

    const npcSystem = await findObject(win, '[data-qa-universe-kind="npc"]');
    const npcId = await win.webContents.executeJavaScript(`document.querySelector('[data-qa-universe-kind="npc"]').getAttribute('data-qa-universe-object')`);
    const npcRelation = await win.webContents.executeJavaScript(`document.querySelector('[data-qa-universe-kind="npc"]').getAttribute('data-qa-universe-relation')`);
    if (npcRelation !== 'neutral') throw new Error(`${label}: unassigned bot must remain neutral, got ${npcRelation}`);
    await clickObject(win, '[data-qa-universe-kind="npc"]');
    const npc = await inspectorSnapshot(win);
    checkCopy(npc);
    await checkModal(win);
    const npcPortraits = await inspectRenderedFactionGeneralPortraits(win, '[data-qa-universe-inspector] [data-qa-faction-general]');
    assertRenderedFactionGeneralPortraits(npcPortraits, ['veyra'], `${label} NPC universe`);
    if (npc.kind !== 'npc' || npc.ownerName !== 'Бот 01' || !npc.ownerId || npc.planetRows !== 7 || npc.actions.length !== 14 || npc.actions.some((action) => action.disabled || action.status !== 'prototype')) throw new Error(`${label}: NPC action/list contract failed ${JSON.stringify(npc)}`);
    const systems = npc.rows.map((row) => Number(row.coordinate.slice(1, -1).split(':')[1]));
    if (new Set(systems).size !== 7 || systems.some((system) => !Number.isInteger(system) || system < 1 || system > 40) || new Set(npc.rows.map((row) => row.id)).size !== 7 || npc.rows.some((row) => row.visitId !== row.id || !/^\[1:\d+:\d+\]$/.test(row.coordinate) || Number(row.coordinate.slice(1, -1).split(':')[2]) < 1 || Number(row.coordinate.slice(1, -1).split(':')[2]) > 24)) throw new Error(`${label}: NPC coordinates/visit targets failed ${JSON.stringify(npc.rows)}`);
    await capture(win, directory, 'npc-inspector');
    const saveWithoutRuntimeClock = `(() => {
      const save = JSON.parse(localStorage.getItem(${JSON.stringify(SAVE_KEY)}) || 'null');
      if (save) delete save.resourceClock;
      return JSON.stringify(save);
    })()`;
    const beforePrototypeAction = await win.webContents.executeJavaScript(saveWithoutRuntimeClock);
    // Read the envelope immediately after the prototype click. Waiting for
    // the notice first can cross App's one-second runtime reconciliation tick,
    // which legitimately persists a new resource clock and creates a false
    // positive for an action that itself does not mutate the save.
    await clickAt(win, '[data-qa-universe-action="fleet"]', false, false);
    const afterPrototypeAction = await win.webContents.executeJavaScript(saveWithoutRuntimeClock);
    if (beforePrototypeAction !== afterPrototypeAction) throw new Error(`${label}: prototype action mutated the save envelope`);
    await waitFor(win, `document.querySelector('.shell-notice span')?.textContent?.includes('Прототип — отправка не подключена')`);
    const prototypeNotice = await win.webContents.executeJavaScript(`document.querySelector('.shell-notice span')?.textContent?.replace(/\\s+/g, ' ').trim() || ''`);
    if (!prototypeNotice.includes(npc.rows[0].coordinate)) throw new Error(`${label}: prototype action target missing ${prototypeNotice}`);
    await dismissInspector(win);
    await checkRestoredFocus(win, npcId);

    // Visit every holding through its row, then reopen the actual map planet.
    await clickObject(win, `[data-qa-universe-object="${npcId}"]`);
    for (const row of [...npc.rows.filter((row) => systems[npc.rows.indexOf(row)] !== npcSystem), ...npc.rows.filter((row) => systems[npc.rows.indexOf(row)] === npcSystem)]) {
      const targetSystem = Number(row.coordinate.slice(1, -1).split(':')[1]);
      await clickAt(win, `[data-qa-universe-visit="${row.id}"]`);
      await waitFor(win, `!document.querySelector('[data-qa-universe-inspector]') && !document.querySelector('.stage').inert && document.querySelector('[data-qa-universe]')?.getAttribute('data-qa-universe-system') === ${JSON.stringify(String(targetSystem))}`);
      await clickObject(win, `[data-qa-universe-object="${row.id}"]`);
      const reopened = await inspectorSnapshot(win);
      if (reopened.ownerId !== npc.ownerId || reopened.ownerName !== 'Бот 01' || JSON.stringify(reopened.rows) !== JSON.stringify(npc.rows) || reopened.actions.length !== 14 || reopened.actions.some((action) => action.disabled || action.status !== 'prototype')) throw new Error(`${label}: visit did not reopen the same seven holdings ${JSON.stringify(reopened)}`);
      const selectedCoordinate = await win.webContents.executeJavaScript(`document.querySelector('.universe-inspector-header span')?.textContent`);
      if (selectedCoordinate !== row.coordinate) throw new Error(`${label}: visited planet coordinate mismatch ${selectedCoordinate}`);
    }
    await clickAt(win, '.universe-modal-backdrop', true);
    await checkRestoredFocus(win, npc.rows.find((row) => Number(row.coordinate.slice(1, -1).split(':')[1]) === npcSystem).id);
    await selectSystem(win, 1);

    await clickObject(win, '[data-qa-universe-kind="empty"]');
    const empty = await inspectorSnapshot(win);
    checkCopy(empty);
    if (empty.kind !== 'empty' || !empty.text.includes('Свободная позиция') || !empty.text.includes('Свободная орбитальная позиция') || empty.specialActionDisabled) throw new Error(`${label}: empty inspector contract failed ${JSON.stringify(empty)}`);
    await capture(win, directory, 'empty-inspector');
    await dismissInspector(win);

    let asteroidSystem = 0;
    let asteroidIds = null;
    for (let candidateSystem = 1; candidateSystem <= 40; candidateSystem += 1) {
      await selectSystem(win, candidateSystem);
      const candidateIds = await win.webContents.executeJavaScript(`(() => {
        const asteroids = [...document.querySelectorAll('[data-qa-universe-kind="asteroid"]')];
        return {
          free: asteroids.find((node) => node.getAttribute('data-qa-universe-underlying-kind') === 'empty')?.getAttribute('data-qa-universe-object') || '',
          occupied: asteroids.find((node) => node.getAttribute('data-qa-universe-underlying-kind') && node.getAttribute('data-qa-universe-underlying-kind') !== 'empty')?.getAttribute('data-qa-universe-object') || '',
        };
      })()`);
      if (candidateIds.free && candidateIds.occupied) {
        asteroidSystem = candidateSystem;
        asteroidIds = candidateIds;
        break;
      }
    }
    if (!asteroidIds) throw new Error(`${label}: asteroid overlay fixtures did not include both free and occupied underlying positions in any system`);
    await clickObject(win, `[data-qa-universe-object="${asteroidIds.free}"]`);
    const freeAsteroid = await inspectorSnapshot(win);
    checkCopy(freeAsteroid);
    await checkModal(win);
    if (freeAsteroid.kind !== 'asteroid' || freeAsteroid.underlyingKind !== 'empty' || !freeAsteroid.text.includes('СКРЫТ ДО ПЕРЕРАБОТКИ') || !freeAsteroid.text.includes('Следующее перемещение через') || !freeAsteroid.specialActions.some((action) => action.action === 'colonize' && !action.disabled) || !freeAsteroid.specialActions.some((action) => action.action === 'asteroid-recycler' && action.disabled)) throw new Error(`${label}: free asteroid inspector contract failed ${JSON.stringify(freeAsteroid)}`);
    await capture(win, directory, 'asteroid-inspector');
    await clickAt(win, '[data-qa-universe-special-action="colonize"]');
    await waitFor(win, `document.querySelector('.fleet-workspace-v1[data-qa-flight-launch-context]')`);
    const launchContext = await win.webContents.executeJavaScript(`document.querySelector('.fleet-workspace-v1')?.getAttribute('data-qa-flight-launch-context') || ''`);
    if (launchContext !== freeAsteroid.targetCoordinate) throw new Error(`${label}: asteroid colonization target context was not preserved ${JSON.stringify({ launchContext, target: freeAsteroid.targetCoordinate })}`);
    await waitFor(win, `document.querySelector('[data-qa-flight-preview-open]') && !document.querySelector('[data-qa-flight-preview-open]').disabled`);
    const geometryBeforePreview = await win.webContents.executeJavaScript(`(() => { const rect = (selector) => document.querySelector(selector)?.getBoundingClientRect().toJSON() || null; return { fleet: rect('.fleet-workspace-v1'), sidebar: rect('.fleet-sidebar-v1'), horizontalOverflow: document.documentElement.scrollWidth > innerWidth + 2 || document.body.scrollWidth > innerWidth + 2 }; })()`);
    await clickAt(win, '[data-qa-flight-preview-open]');
    await waitFor(win, `document.querySelector('[data-qa-flight-preview-backdrop]')`);
    const timelineText = await win.webContents.executeJavaScript(`document.querySelector('[data-qa-flight-preview-backdrop]')?.textContent?.replace(/\s+/g, ' ').trim() || ''`);
    const timelineFields = ['ИСТОЧНИК', 'выбрано флотом', 'ЦЕЛЬ', 'Свободная координата', 'СОСТАВ ФЛОТА', 'Колонизатор × 1', 'Население: 12', 'ПАРАМЕТРЫ ПЕРЕЛЁТА', 'ЭФФ. СКОРОСТЬ', 'ТУДА', 'ОБРАТНО', 'ПОЛНЫЙ ЦИКЛ', 'ГАЗ', 'ПРИБЫТИЕ', 'МОСКОВСКОЕ ВРЕМЯ', 'МСК', 'ЗАГРУЗКА КОРАБЛЯ', 'НЕДОСТУПНО ДЛЯ КОЛОНИЗАЦИИ', 'Газ списывается только за один путь туда.', 'При отзыве колонизатор возвращается', 'ОТМЕНА', 'ОТПРАВИТЬ'];
    if (timelineFields.some((field) => !timelineText.includes(field))) throw new Error(`${label}: Concept 2 Mission Timeline fields are incomplete ${JSON.stringify({ missing: timelineFields.filter((field) => !timelineText.includes(field)), timelineText })}`);
    const timelineStructure = await win.webContents.executeJavaScript(`(() => ({
      sourceIsLocked: Boolean(document.querySelector('[data-qa-flight-source-step]')) && !document.querySelector('[data-qa-flight-source-step] .flight-timeline-edit'),
      targetCanEdit: Boolean(document.querySelector('[data-qa-flight-target-step] .flight-timeline-edit')),
      routePanelRemoved: !document.querySelector('.flight-timeline-route-panel'),
      targetInputsHiddenUntilEdit: !document.querySelector('[data-qa-flight-target-inputs]'),
    }))()`);
    if (!timelineStructure.sourceIsLocked || !timelineStructure.targetCanEdit || !timelineStructure.routePanelRemoved || !timelineStructure.targetInputsHiddenUntilEdit) throw new Error(`${label}: Mission Timeline source/target structure is incorrect ${JSON.stringify(timelineStructure)}`);
    const timelineCargo = await win.webContents.executeJavaScript(`(() => {
      const cargo = document.querySelector('[data-qa-flight-cargo]');
      const fields = cargo ? Array.from(cargo.querySelectorAll('input')) : [];
      const inputWidths = fields.map((input) => Math.round(input.getBoundingClientRect().width));
      return {
        present: Boolean(cargo),
        disabled: cargo?.getAttribute('aria-disabled') === 'true',
        inputsDisabled: fields.length === 4 && fields.every((input) => input.disabled),
        inputWidths,
        minInputWidth: inputWidths.length ? Math.min(...inputWidths) : 0,
      };
    })()`);
    if (!timelineCargo.present || !timelineCargo.disabled || !timelineCargo.inputsDisabled || timelineCargo.minInputWidth < 110) throw new Error(`${label}: colonization cargo controls are missing, enabled, or too narrow ${JSON.stringify(timelineCargo)}`);
    const timelineViewport = await win.webContents.executeJavaScript(`(() => {
      const modal = document.querySelector('.flight-timeline-modal');
      const backdrop = document.querySelector('[data-qa-flight-preview-backdrop]');
      return {
        modalOverflowY: modal ? getComputedStyle(modal).overflowY : '',
        modalScrollable: modal ? modal.scrollHeight > modal.clientHeight + 2 : true,
        backdropOverflowY: backdrop ? getComputedStyle(backdrop).overflowY : '',
        modalFitsViewport: modal ? modal.getBoundingClientRect().top >= 0 && modal.getBoundingClientRect().bottom <= innerHeight + 1 : false,
      };
    })()`);
    if (timelineViewport.modalOverflowY !== 'hidden' || timelineViewport.modalScrollable || timelineViewport.backdropOverflowY === 'auto' || !timelineViewport.modalFitsViewport) throw new Error(`${label}: Mission Timeline must fit the viewport without an inner scrollbar ${JSON.stringify(timelineViewport)}`);
    const geometryDuringPreview = await win.webContents.executeJavaScript(`(() => { const rect = (selector) => document.querySelector(selector)?.getBoundingClientRect().toJSON() || null; return { fleet: rect('.fleet-workspace-v1'), sidebar: rect('.fleet-sidebar-v1'), horizontalOverflow: document.documentElement.scrollWidth > innerWidth + 2 || document.body.scrollWidth > innerWidth + 2 }; })()`);
    const stableRect = (left, right) => left && right && ['x', 'y', 'width', 'height'].every((key) => Math.abs(left[key] - right[key]) <= 1);
    const stableFrame = (left, right) => left && right && ['x', 'y', 'width'].every((key) => Math.abs(left[key] - right[key]) <= 1);
    if (!stableRect(geometryBeforePreview.fleet, geometryDuringPreview.fleet) || !stableRect(geometryBeforePreview.sidebar, geometryDuringPreview.sidebar) || geometryBeforePreview.horizontalOverflow || geometryDuringPreview.horizontalOverflow) throw new Error(`${label}: flight preview changed page geometry or introduced horizontal overflow ${JSON.stringify({ before: geometryBeforePreview, during: geometryDuringPreview })}`);
    await clickAt(win, '[data-qa-flight-target-step] .flight-timeline-edit');
    await waitFor(win, `document.querySelector('[data-qa-flight-target-inputs]')`);
    await setInputValue(win, '[name="flight-preview-target-galaxy"]', 1);
    await setInputValue(win, '[name="flight-preview-target-system"]', 1);
    await setInputValue(win, '[name="flight-preview-target-position"]', 1);
    const occupiedTargetState = await win.webContents.executeJavaScript(`(() => {
      const status = document.querySelector('[data-qa-flight-target-status]');
      return { text: status?.textContent?.replace(/\s+/g, ' ').trim() || '', invalid: status?.classList.contains('is-invalid') || false, dispatch: Boolean(document.querySelector('[data-qa-flight-dispatch-confirm]')) };
    })()`);
    if (!occupiedTargetState.invalid || !occupiedTargetState.text.includes('Координата уже занята') || occupiedTargetState.dispatch) throw new Error(`${label}: typed occupied target was not rejected in Mission Timeline ${JSON.stringify(occupiedTargetState)}`);
    const freeTargetParts = (freeAsteroid.targetCoordinate.match(/\d+/g) || []).map(Number);
    if (freeTargetParts.length !== 3) throw new Error(`${label}: free asteroid coordinate could not be parsed ${freeAsteroid.targetCoordinate}`);
    await setInputValue(win, '[name="flight-preview-target-galaxy"]', freeTargetParts[0]);
    await setInputValue(win, '[name="flight-preview-target-system"]', freeTargetParts[1]);
    await setInputValue(win, '[name="flight-preview-target-position"]', freeTargetParts[2]);
    await waitFor(win, `document.querySelector('[data-qa-flight-dispatch-confirm]')`);
    await clickAt(win, '[data-qa-flight-dispatch-confirm]');
    await waitFor(win, `document.querySelector('[data-qa-flight-row]')`);
    const dispatchedFlight = await win.webContents.executeJavaScript(`(() => {
      const row = document.querySelector('[data-qa-flight-row]');
      return {
        count: document.querySelectorAll('[data-qa-flight-row]').length,
        phase: row?.getAttribute('data-qa-flight-phase') || '',
        origin: row?.querySelector('[data-qa-flight-origin]')?.textContent?.trim() || '',
        target: row?.querySelector('[data-qa-flight-target]')?.textContent?.trim() || '',
      };
    })()`);
    if (dispatchedFlight.count !== 1 || dispatchedFlight.phase !== 'outbound' || dispatchedFlight.target !== freeAsteroid.targetCoordinate) throw new Error(`${label}: free asteroid colonization dispatch contract failed ${JSON.stringify({ dispatchedFlight, target: freeAsteroid.targetCoordinate })}`);
    await waitFor(win, `!document.querySelector('[data-qa-flight-preview-backdrop]')`);
    const geometryAfterDispatch = await win.webContents.executeJavaScript(`(() => { const rect = (selector) => document.querySelector(selector)?.getBoundingClientRect().toJSON() || null; return { fleet: rect('.fleet-workspace-v1'), sidebar: rect('.fleet-sidebar-v1'), horizontalOverflow: document.documentElement.scrollWidth > innerWidth + 2 || document.body.scrollWidth > document.body.clientWidth + 2 }; })()`);
    if (!stableFrame(geometryBeforePreview.fleet, geometryAfterDispatch.fleet) || !stableFrame(geometryBeforePreview.sidebar, geometryAfterDispatch.sidebar) || geometryAfterDispatch.horizontalOverflow) throw new Error(`${label}: flight dispatch shifted Fleet or introduced horizontal overflow ${JSON.stringify({ before: geometryBeforePreview, after: geometryAfterDispatch, dispatchedFlight })}`);
    const returnedToUniverse = await win.webContents.executeJavaScript(`(() => { const button = document.querySelector('[data-qa-route="universe"]'); if (!button) return false; button.click(); return true; })()`);
    if (!returnedToUniverse) throw new Error(`${label}: could not return to Universe after asteroid flight preview`);
    await waitFor(win, `document.querySelector('[data-qa-universe]')`);
    await settle(win);
    await selectSystem(win, asteroidSystem);

    await clickObject(win, `[data-qa-universe-object="${asteroidIds.occupied}"]`);
    const occupiedAsteroid = await inspectorSnapshot(win);
    checkCopy(occupiedAsteroid);
    await checkModal(win);
    if (occupiedAsteroid.kind !== 'asteroid' || occupiedAsteroid.underlyingKind === 'empty' || occupiedAsteroid.specialActions.some((action) => action.action === 'colonize') || !occupiedAsteroid.specialActions.some((action) => action.action === 'asteroid-recycler' && action.disabled)) throw new Error(`${label}: occupied asteroid inspector contract failed ${JSON.stringify(occupiedAsteroid)}`);
    await dismissInspector(win);

    const pirateSystem = await findObject(win, '[data-qa-universe-kind="pirate"]');
    await clickObject(win, '[data-qa-universe-kind="pirate"]');
    const pirate = await inspectorSnapshot(win);
    checkCopy(pirate);
    await checkModal(win);
    if (pirate.kind !== 'pirate' || !pirate.text.includes('Пиратский объект') || !pirate.text.includes('исчезнет через') || !pirate.specialActionDisabled) throw new Error(`${label}: pirate inspector contract failed ${JSON.stringify(pirate)}`);
    await capture(win, directory, 'pirate-inspector');
    await dismissInspector(win);
    await selectSystem(win, pirateSystem);
    const pirateAnimation = await win.webContents.executeJavaScript(`(() => {
      const pirate = document.querySelector('[data-qa-universe-kind="pirate"]');
      const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      const image = pirate?.querySelector('img');
      return {
        reducedMotion,
        present: Boolean(pirate),
        image: image ? getComputedStyle(image).animationName : 'none',
        before: pirate ? getComputedStyle(pirate, '::before').animationName : 'none',
      };
    })()`);
    if (!pirateAnimation.present) {
      throw new Error(`${label}: pirate visual missing ${JSON.stringify(pirateAnimation)}`);
    }
    const pirateAnimationNames = [pirateAnimation.image, pirateAnimation.before];
    if (pirateAnimation.reducedMotion && pirateAnimationNames.some((name) => name !== 'none')) {
      throw new Error(`${label}: reduced-motion pirate visual must disable animation ${JSON.stringify(pirateAnimation)}`);
    }
    if (!pirateAnimation.reducedMotion && pirateAnimationNames.some((name) => name === 'none')) {
      throw new Error(`${label}: pirate visual animation missing ${JSON.stringify(pirateAnimation)}`);
    }

    // Anomalies are probabilistic timed objects and can be absent across all
    // systems during a legitimate quiet cycle. Verify their inspector when a
    // live anomaly exists, but do not turn the real-time schedule into a flaky
    // UI gate.
    const anomalySystem = await findObject(win, '[data-qa-universe-kind="anomaly"]', { required: false });
    const anomaly = anomalySystem
      ? await (async () => {
        await clickObject(win, '[data-qa-universe-kind="anomaly"]');
        const snapshot = await inspectorSnapshot(win);
        checkCopy(snapshot);
        await checkModal(win);
        if (snapshot.kind !== 'anomaly' || !snapshot.text.includes('Аномалия') || !snapshot.text.includes('исчезнет через') || !snapshot.specialActionDisabled) throw new Error(`${label}: anomaly inspector contract failed ${JSON.stringify(snapshot)}`);
        await capture(win, directory, 'anomaly-inspector');
        await dismissInspector(win);
        return snapshot;
      })()
      : { kind: 'not-spawned' };

    let uniqueSystem = 1;
    for (const kind of ['uninhabited', 'unique']) {
      const foundSystem = await findObject(win, `[data-qa-universe-kind="${kind}"]`);
      if (kind === 'unique') uniqueSystem = foundSystem;
      await clickObject(win, `[data-qa-universe-kind="${kind}"]`);
      const special = await inspectorSnapshot(win);
      checkCopy(special);
      await checkModal(win);
      if (special.kind !== kind || !special.text.includes('Владелец отсутствует') || !special.specialActionDisabled) throw new Error(`${label}: ${kind} inspector contract failed ${JSON.stringify(special)}`);
      await capture(win, directory, `${kind}-inspector`);
      await dismissInspector(win);
    }
    await selectSystem(win, 1);

    const toggle = '[data-qa-universe-asteroids-toggle]';
    await win.webContents.executeJavaScript(`document.querySelector(${JSON.stringify(toggle)})?.click()`);
    await waitFor(win, `document.querySelectorAll('[data-qa-universe-kind="asteroid"]').length === 0`);
    await win.webContents.executeJavaScript(`document.querySelector(${JSON.stringify(toggle)})?.click()`);
    await waitFor(win, `document.querySelectorAll('[data-qa-universe-kind="asteroid"]').length >= 3`);

    await selectSystem(win, 40);
    const lastSystem = await mapSnapshot(win);
    if (lastSystem.system !== '40' || lastSystem.positionCount !== 24 || lastSystem.horizontalOverflow || lastSystem.bodyHorizontalOverflow) throw new Error(`${label}: system navigation contract failed ${JSON.stringify(lastSystem)}`);
    await selectSystem(win, 1);
    await clickObject(win, '[data-qa-universe-object="player-planet-helion-01"]');
    await pressKey(win, 'Escape');
    await checkRestoredFocus(win, 'player-planet-helion-01');

    const screenshots = skipScreenshots ? [] : fs.readdirSync(directory).filter((name) => name.endsWith('.png')).sort();
    return {
      viewport: label,
      map: { system: map.system, systemOptions: map.systemOptions, positionCount: map.positionCount, asteroidCount: map.asteroidCount, objectKinds: map.objectKinds, homeCaption: map.homeCaption },
      layout: { htmlClass: map.htmlClass, webStageScale: map.webStageScale, visualViewport: map.visualViewport, stageRect: map.stageRect },
      player: { ownerName: player.ownerName, points: player.points, planetRows: player.planetRows },
      npc: { ownerName: npc.ownerName, planetRows: npc.planetRows, rows: npc.rows, prototypeNotice },
      specialInspectors: { empty: empty.kind, asteroid: freeAsteroid.kind, occupiedAsteroid: occupiedAsteroid.kind, pirate: pirate.kind, anomaly: anomaly.kind, uninhabited: 'uninhabited', unique: 'unique' },
      asteroidsHoldPosition,
      timedObjectSystems: { pirate: pirateSystem, anomaly: anomalySystem, unique: uniqueSystem },
      pirateAnimation,
      stableAfterMs: 1_100,
      horizontalOverflow: false,
      stageRect: map.stageRect,
      screenshots,
      screenshotsSkipped: skipScreenshots,
    };
  } finally {
    if (!win.isDestroyed()) {
      try { if (win.webContents.debugger.isAttached()) win.webContents.debugger.detach(); } catch {}
      await win.close();
    }
  }
}

async function main() {
  fs.mkdirSync(OUTPUT, { recursive: true });
  const results = [];
  try {
    for (const [width, height] of VIEWPORTS) results.push(await runViewport(width, height));
    fs.writeFileSync(path.join(OUTPUT, 'results.json'), JSON.stringify({ results }, null, 2));
    console.log(JSON.stringify({ results }, null, 2));
    app.quit();
  } catch (error) {
    process.stderr.write(`${error.stack || error}\n`);
    app.exit(1);
  }
}

app.whenReady().then(main);
