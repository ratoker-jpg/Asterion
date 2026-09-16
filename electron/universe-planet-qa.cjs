const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-gpu');
app.on('window-all-closed', () => {});

const ROOT = path.join(__dirname, '..');
const OUTPUT = path.join(ROOT, 'artifacts', 'universe-planet-qa');
const SAVE_KEY = 'asterion.vertical-slice.v1';
const VIEWPORTS = [[1920, 1080], [1280, 720]];
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
    if (!element) throw new Error('Click target missing');
    element.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    const rect = element.getBoundingClientRect();
    const x = ${backdrop} ? rect.left + 3 : rect.left + rect.width / 2;
    const y = ${backdrop} ? rect.top + 3 : rect.top + rect.height / 2;
    const hit = document.elementFromPoint(x, y);
    if (${backdrop} ? hit !== element : !element.contains(hit)) throw new Error('Click target occluded: ' + ${JSON.stringify(selector)});
    return { x, y };
  })()`);
  await win.webContents.debugger.sendCommand('Input.dispatchMouseEvent', { type: 'mouseMoved', ...point });
  await win.webContents.debugger.sendCommand('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', clickCount: 1 });
  await win.webContents.debugger.sendCommand('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', clickCount: 1 });
  if (settleAfter) await settle(win);
}

async function pressKey(win, key, modifiers = 0) {
  const code = key === 'Tab' ? 9 : 27;
  await win.webContents.debugger.sendCommand('Input.dispatchKeyEvent', { type: 'rawKeyDown', key, code: key, windowsVirtualKeyCode: code, modifiers });
  await win.webContents.debugger.sendCommand('Input.dispatchKeyEvent', { type: 'keyUp', key, code: key, windowsVirtualKeyCode: code, modifiers });
  await settle(win);
}

async function findObject(win, selector) {
  for (let system = 1; system <= 40; system += 1) {
    await selectSystem(win, system);
    if (await win.webContents.executeJavaScript(`Boolean(document.querySelector(${JSON.stringify(selector)}))`)) return system;
  }
  throw new Error(`Object absent from all 40 systems: ${selector}`);
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
      specialActionDisabled: Boolean(document.querySelector('[data-qa-universe-special-action]')?.disabled),
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
    await win.loadFile(path.join(ROOT, 'dist', 'index.html'));
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
    if (player.kind !== 'player' || player.ownerName !== 'Dendrilion' || !player.avatar.includes('aegis_profile_avatar') || player.points.length !== 4 || player.planetRows !== 1 || player.actions.length !== 2 || player.actions.some((action) => !action.disabled || action.status !== 'disabled' || !action.title.includes('Это ваша планета'))) {
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
    if (npc.kind !== 'npc' || npc.ownerName !== 'Бот 01' || !npc.ownerId || npc.planetRows !== 7 || npc.actions.length !== 14 || npc.actions.some((action) => action.disabled || action.status !== 'prototype')) throw new Error(`${label}: NPC action/list contract failed ${JSON.stringify(npc)}`);
    const systems = npc.rows.map((row) => Number(row.coordinate.slice(1, -1).split(':')[1]));
    if (new Set(systems).size !== 7 || systems.some((system) => !Number.isInteger(system) || system < 1 || system > 40) || new Set(npc.rows.map((row) => row.id)).size !== 7 || npc.rows.some((row) => row.visitId !== row.id || !/^\[1:\d+:\d+\]$/.test(row.coordinate) || Number(row.coordinate.slice(1, -1).split(':')[2]) < 1 || Number(row.coordinate.slice(1, -1).split(':')[2]) > 24)) throw new Error(`${label}: NPC coordinates/visit targets failed ${JSON.stringify(npc.rows)}`);
    await capture(win, directory, 'npc-inspector');
    const beforePrototypeAction = await win.webContents.executeJavaScript(`localStorage.getItem(${JSON.stringify(SAVE_KEY)})`);
    // Read the envelope immediately after the prototype click. Waiting for
    // the notice first can cross App's one-second runtime reconciliation tick,
    // which legitimately persists a new resource clock and creates a false
    // positive for an action that itself does not mutate the save.
    await clickAt(win, '[data-qa-universe-action="fleet"]', false, false);
    const afterPrototypeAction = await win.webContents.executeJavaScript(`localStorage.getItem(${JSON.stringify(SAVE_KEY)})`);
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
    if (empty.kind !== 'empty' || !empty.text.includes('Свободная позиция') || !empty.text.includes('Свободная орбитальная позиция') || !empty.specialActionDisabled) throw new Error(`${label}: empty inspector contract failed ${JSON.stringify(empty)}`);
    await capture(win, directory, 'empty-inspector');
    await dismissInspector(win);

    const asteroidId = await win.webContents.executeJavaScript(`(() => {
      const asteroids = [...document.querySelectorAll('[data-qa-universe-kind="asteroid"]')];
      return (asteroids.find((node) => { const rect = node.getBoundingClientRect(); const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2); return hit === node || node.contains(hit); }) || asteroids[0])?.getAttribute('data-qa-universe-object') || '';
    })()`);
    await clickObject(win, `[data-qa-universe-object="${asteroidId}"]`);
    const asteroid = await inspectorSnapshot(win);
    checkCopy(asteroid);
    await checkModal(win);
    if (asteroid.kind !== 'asteroid' || !asteroid.text.includes('СКРЫТ ДО ПЕРЕРАБОТКИ') || !asteroid.text.includes('Следующее перемещение через') || !asteroid.specialActionDisabled) throw new Error(`${label}: asteroid inspector contract failed ${JSON.stringify(asteroid)}`);
    await capture(win, directory, 'asteroid-inspector');
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

    const anomalySystem = await findObject(win, '[data-qa-universe-kind="anomaly"]');
    await clickObject(win, '[data-qa-universe-kind="anomaly"]');
    const anomaly = await inspectorSnapshot(win);
    checkCopy(anomaly);
    await checkModal(win);
    if (anomaly.kind !== 'anomaly' || !anomaly.text.includes('Аномалия') || !anomaly.text.includes('исчезнет через') || !anomaly.specialActionDisabled) throw new Error(`${label}: anomaly inspector contract failed ${JSON.stringify(anomaly)}`);
    await capture(win, directory, 'anomaly-inspector');
    await dismissInspector(win);

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
      specialInspectors: { empty: empty.kind, asteroid: asteroid.kind, pirate: pirate.kind, anomaly: anomaly.kind, uninhabited: 'uninhabited', unique: 'unique' },
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
