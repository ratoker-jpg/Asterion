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
const OUTPUT = process.env.ASTERION_QA_OUTPUT || path.join(ROOT, 'artifacts', 'universe-planet-qa');
const SAVE_KEY = 'asterion.vertical-slice.test.v1';
const VIEWPORTS = [[1920, 1080], [1280, 720]];
// Freeze the renderer clock so the scheduled asteroid fixture is stable and
// the QA contract cannot silently weaken when the test is run on another day.
const QA_UNIVERSE_NOW = Date.UTC(2026, 0, 1, 2, 0, 0);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const skipScreenshots = process.env.ASTERION_SKIP_SCREENSHOTS === '1';

function hasBundledImageAsset(src, prefixes) {
  const path = String(src).split(/[?#]/, 1)[0];
  const filename = path.slice(path.lastIndexOf('/') + 1).toLowerCase();
  return /\.(?:png|webp)$/i.test(filename) && prefixes.some((prefix) => filename.startsWith(prefix));
}

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

async function clickAt(win, selector, backdrop = false, settleAfter = true, preserveScroll = false) {
  const point = await win.webContents.executeJavaScript(`(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    if (!element) return null;
    const scrollY = window.scrollY;
    element.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    const rect = element.getBoundingClientRect();
    const points = ${backdrop}
      ? [{ x: rect.left + 3, y: rect.top + 3 }]
      : [[.5, .5], [.25, .25], [.75, .25], [.25, .75], [.75, .75]].map(([px, py]) => ({ x: rect.left + rect.width * px, y: rect.top + rect.height * py }));
    const point = points.find(({ x, y }) => { const hit = document.elementFromPoint(x, y); return ${backdrop} ? hit === element : element.contains(hit); });
    if (!point) throw new Error('Click target occluded: ' + ${JSON.stringify(selector)});
    return { ...point, scrollY };
  })()`);
  if (!point) throw new Error(`Click target missing: ${selector}`);
  const { x, y } = point;
  await win.webContents.debugger.sendCommand('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
  await win.webContents.debugger.sendCommand('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
  await win.webContents.debugger.sendCommand('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
  if (preserveScroll) await win.webContents.executeJavaScript(`window.scrollTo(0, ${point.scrollY})`);
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
      debrisMarkers: Array.from(document.querySelectorAll('.universe-debris-marker')).map((marker) => {
        const button = marker.closest('[data-qa-universe-object]');
        return {
          id: button?.getAttribute('data-qa-universe-object') || '',
          kind: button?.getAttribute('data-qa-universe-kind') || '',
          ariaLabel: button?.getAttribute('aria-label') || '',
          amount: (marker.querySelector('[role="tooltip"]')?.textContent || '').replace(/\\D/g, ''),
          tooltip: marker.querySelector('[role="tooltip"]')?.textContent?.trim() || '',
        };
      }),
      capturedDebrisMarkers: Array.from(document.querySelectorAll('.universe-asteroid-debris-marker')).map((marker) => {
        const button = marker.closest('[data-qa-universe-object]');
        const tooltip = marker.querySelector('[role="tooltip"]');
        return {
          id: button?.getAttribute('data-qa-universe-object') || '',
          spawnIndex: button?.getAttribute('data-qa-universe-asteroid-spawn-index') || '',
          coordinatePosition: button?.getAttribute('data-qa-universe-asteroid-position') || '',
          ariaLabel: button?.getAttribute('aria-label') || '',
          describedByText: button?.querySelector('[role="tooltip"]')?.textContent?.trim() || tooltip?.textContent?.trim() || '',
          tooltip: tooltip?.textContent?.trim() || '',
          html: button?.outerHTML || '',
        };
      }),
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

async function seedOrbitalDebrisMarkers(win) {
  const dead = await win.webContents.executeJavaScript(`(() => {
    const empty = document.querySelector('[data-qa-universe-kind="empty"]');
    const coordinate = empty?.getAttribute('aria-label')?.match(/\\[(\\d+):(\\d+):(\\d+)\\]/);
    return coordinate ? {
      galaxy: Number(coordinate[1]),
      system: Number(coordinate[2]),
      position: Number(coordinate[3]),
    } : null;
  })()`);
  if (!dead) throw new Error('Could not find a stable empty coordinate for the dead debris fixture.');

  let asteroid = null;
  for (let system = 1; system <= 40 && !asteroid; system += 1) {
    if (system !== 1) await selectSystem(win, system);
    asteroid = await win.webContents.executeJavaScript(`(() => {
      const candidates = [...document.querySelectorAll('[data-qa-universe-kind="asteroid"]')];
      for (const node of candidates) {
        const next = node.getAttribute('data-qa-universe-asteroid-next-coordinate') || '';
        const match = next.match(/\\[(\\d+):(\\d+):(\\d+)\\]/);
        if (!match) continue;
        const nextMoveAt = Number(node.getAttribute('data-qa-universe-asteroid-next-move'));
        const spawnIndex = node.getAttribute('data-qa-universe-asteroid-spawn-index') || '';
        if (spawnIndex && Number.isFinite(nextMoveAt)) return {
          id: node.getAttribute('data-qa-universe-object') || '',
          spawnIndex,
          system: Number(document.querySelector('[data-qa-universe]')?.getAttribute('data-qa-universe-system')),
          nextSystem: Number(match[2]),
          fromPosition: Number(node.getAttribute('data-qa-universe-asteroid-position')),
          toPosition: Number(match[3]),
          nextMoveAt,
        };
      }
      return null;
    })()`);
  }
  if (!asteroid) throw new Error('Could not find an asteroid with a scheduled next position.');

  const fixtures = await win.webContents.executeJavaScript(`(() => {
    const save = JSON.parse(localStorage.getItem(${JSON.stringify(SAVE_KEY)}) || '{}');
    const espionage = save.espionage || {};
    const targets = espionage.targets || espionage.bot01Planets || {};
    const live = Object.values(targets).find((target) => target?.coordinate && target?.resources);
    if (!live) return null;
    live.resources.debris = 23456;
    const deadCoordinate = ${JSON.stringify(dead)};
    const deadTargetId = 'qa-dead-orbit-debris';
    espionage.orbitalDebris = espionage.orbitalDebris || {};
    espionage.orbitalDebris[deadTargetId] = {
      id: deadTargetId,
      targetPlanetId: deadTargetId,
      targetPlanetName: 'QA destroyed target',
      targetOwnerId: 'qa-owner',
      targetCoordinate: deadCoordinate,
      debris: 34567,
      createdAt: ${QA_UNIVERSE_NOW},
    };
    save.espionage = espionage;
    save.asteroidDebrisBySpawnIndex = save.asteroidDebrisBySpawnIndex || {};
    save.asteroidDebrisBySpawnIndex[${JSON.stringify(asteroid.spawnIndex)}] = 876543;
    localStorage.setItem(${JSON.stringify(SAVE_KEY)}, JSON.stringify(save));
    return {
      liveTargetId: live.id,
      liveCoordinate: live.coordinate,
      deadTargetId,
      deadCoordinate,
    };
  })()`);
  return { ...fixtures, asteroid };
}

async function debrisMarkerSnapshot(win, selector) {
  return win.webContents.executeJavaScript(`(() => {
    const button = document.querySelector(${JSON.stringify(selector)});
    const marker = button?.querySelector('.universe-debris-marker');
    const tooltip = marker?.querySelector('[role="tooltip"]');
    const rect = button?.getBoundingClientRect();
    return {
      tagName: button?.tagName || '',
      tabIndex: button?.tabIndex ?? -1,
      ariaLabel: button?.getAttribute('aria-label') || '',
      describedBy: button?.getAttribute('aria-describedby') || '',
      amount: (tooltip?.textContent || '').replace(/\\D/g, ''),
      tooltipId: tooltip?.id || '',
      tooltipText: tooltip?.textContent?.trim() || '',
      tooltipVisibility: tooltip ? getComputedStyle(tooltip).visibility : '',
      rect: rect ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height } : null,
      markerRect: marker?.getBoundingClientRect() ? (() => { const markerRect=marker.getBoundingClientRect(); return { x: markerRect.x, y: markerRect.y, width: markerRect.width, height: markerRect.height }; })() : null,
    };
  })()`);
}

async function verifyDebrisMarkerInteraction(win, selector, expectedAmount) {
  const initial = await debrisMarkerSnapshot(win, selector);
  if (initial.tagName !== 'BUTTON' || initial.tabIndex < 0 || !initial.ariaLabel.replace(/\D/g, '').includes(expectedAmount)
    || !initial.describedBy.split(/\s+/).includes(initial.tooltipId) || !initial.tooltipText.replace(/\D/g, '').includes(expectedAmount)
    || !initial.rect || !initial.markerRect
    || initial.markerRect.x < initial.rect.x || initial.markerRect.y < initial.rect.y
    || initial.markerRect.x + initial.markerRect.width > initial.rect.x + initial.rect.width
    || initial.markerRect.y + initial.markerRect.height > initial.rect.y + initial.rect.height) {
    throw new Error(`Debris marker accessible-name contract failed: ${JSON.stringify(initial)}`);
  }

  await win.webContents.debugger.sendCommand('Emulation.setFocusEmulationEnabled', { enabled: true });
  await win.webContents.executeJavaScript(`document.querySelector(${JSON.stringify(selector)})?.focus()`);
  const focusState = await win.webContents.executeJavaScript(`(() => { const button=document.querySelector(${JSON.stringify(selector)}); const tooltip=button?.querySelector('[role="tooltip"]'); return { active: document.activeElement === button, focused: button?.matches(':focus') ?? false, visibility: tooltip ? getComputedStyle(tooltip).visibility : '', selectorMatch: button?.matches('.workspace--universe .universe-view-v3 .empty-slot:focus') ?? false }; })()`);
  if (!focusState.active || focusState.visibility !== 'visible') throw new Error(`Debris tooltip focus state failed: ${JSON.stringify(focusState)}`);
  const focused = await debrisMarkerSnapshot(win, selector);
  if (focused.tooltipVisibility !== 'visible') throw new Error(`Debris tooltip did not appear on focus: ${JSON.stringify(focused)}`);

  await win.webContents.executeJavaScript(`document.querySelector(${JSON.stringify(selector)})?.blur()`);
  await win.webContents.debugger.sendCommand('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 0, y: 0 });
  await waitFor(win, `(() => { const tooltip=document.querySelector(${JSON.stringify(selector)})?.querySelector('[role="tooltip"]'); return tooltip && getComputedStyle(tooltip).visibility === 'hidden'; })()`);
  const { x, y, width, height } = initial.rect;
  await win.webContents.debugger.sendCommand('Input.dispatchMouseEvent', { type: 'mouseMoved', x: x + width / 2, y: y + height / 2 });
  await waitFor(win, `(() => { const tooltip=document.querySelector(${JSON.stringify(selector)})?.querySelector('[role="tooltip"]'); return tooltip && getComputedStyle(tooltip).visibility === 'visible'; })()`);
  const hovered = await debrisMarkerSnapshot(win, selector);
  if (hovered.tooltipVisibility !== 'visible') throw new Error(`Debris tooltip did not appear on hover: ${JSON.stringify(hovered)}`);
  return { focused: focused.tooltipVisibility, hovered: hovered.tooltipVisibility, amount: initial.amount };
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
    const specialImage = document.querySelector('[data-qa-universe-special] img');
    return {
      kind: inspector?.getAttribute('data-qa-inspector-kind') || '',
      text: inspector?.textContent?.replace(/\\s+/g, ' ').trim() || '',
      ownerName: document.querySelector('[data-qa-universe-owner-name]')?.textContent?.trim() || '',
      avatar: document.querySelector('[data-qa-universe-avatar] img')?.getAttribute('src') || '',
      specialArt: {
        src: specialImage?.getAttribute('src') || '',
        loaded: Boolean(specialImage?.complete && specialImage.naturalWidth > 0),
        width: specialImage?.naturalWidth || 0,
        height: specialImage?.naturalHeight || 0,
      },
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
    await win.loadURL('about:blank');
    win.webContents.debugger.attach('1.3');
    await win.webContents.debugger.sendCommand('Page.enable');
    await win.webContents.debugger.sendCommand('Page.addScriptToEvaluateOnNewDocument', {
      source: `Date.now = () => ${QA_UNIVERSE_NOW};`,
    });
    await win.webContents.debugger.sendCommand('Emulation.setDeviceMetricsOverride', {
      width,
      height,
      deviceScaleFactor: 1,
      mobile: false,
      screenWidth: width,
      screenHeight: height,
    });
    const loaded = new Promise((resolve) => win.webContents.once('did-finish-load', resolve));
    await win.loadFile(path.join(ROOT, 'dist', 'index.html'), { search: '?mode=test' });
    await loaded;
    await waitFor(win, `document.querySelector('[data-qa-navigation="utility"]')`);
    await settle(win);
    await waitFor(win, `localStorage.getItem(${JSON.stringify(SAVE_KEY)})`);
    // Each viewport has a fresh Electron partition, and the pre-document
    // clock injection ensures persistence creates its asteroid baseline at
    // the same deterministic epoch used by the movement assertions.
    const asteroidBaseline = await win.webContents.executeJavaScript(`(() => {
      const save = JSON.parse(localStorage.getItem(${JSON.stringify(SAVE_KEY)}) || '{}');
      const simulation = save.asteroidSimulation || {};
      return {
        processedThroughAt: simulation.processedThroughAt,
        nextSpawnIndex: simulation.nextSpawnIndex,
        spawnIndices: (simulation.asteroids || []).map((asteroid) => asteroid.spawnIndex),
      };
    })()`);
    if (asteroidBaseline.processedThroughAt !== QA_UNIVERSE_NOW || asteroidBaseline.nextSpawnIndex !== 3
      || JSON.stringify(asteroidBaseline.spawnIndices) !== '[0,1,2]') {
      throw new Error(`${label}: app did not persist the fixed-clock asteroid baseline ${JSON.stringify(asteroidBaseline)}`);
    }
    await win.webContents.executeJavaScript(`void (Date.now = () => ${QA_UNIVERSE_NOW});`);
    await clickPrimary(win, 'universe');
    const debrisFixtures = await seedOrbitalDebrisMarkers(win);
    if (!debrisFixtures) throw new Error(`${label}: could not seed live debris target`);
    await reload(win);
    await win.webContents.executeJavaScript(`void (Date.now = () => ${QA_UNIVERSE_NOW});`);
    await clickPrimary(win, 'universe');

    const map = await mapSnapshot(win);
    if (map.system !== '1' || map.systemOptions !== 40 || map.systemOptionTexts.some((text, index) => text !== String(index + 1).padStart(2, '0')) || map.positionCount !== 24 || map.viewport.innerWidth !== width || map.viewport.innerHeight !== height) throw new Error(`${label}: map cardinality/viewport failed ${JSON.stringify(map)}`);
    if (!map.debrisMarkers.some((marker) => marker.kind === 'empty' && marker.amount.replace(/\D/g, '') === '34567')) {
      throw new Error(`${label}: map snapshot did not include the dead-target debris marker ${JSON.stringify(map.debrisMarkers)}`);
    }
    if (!map.objectKinds.includes('empty') || !map.objectKinds.includes('player') || map.asteroidCount < 3) {
      throw new Error(`${label}: object fixture coverage failed ${JSON.stringify(map)}`);
    }
    if (map.homeCaption !== '★ Dendrilion' || map.coordinateLineCount !== 0 || map.mapCaptions.some((caption) => /\\[\\d+:\\d+:\\d+\\]/.test(caption))) throw new Error(`${label}: map caption contract failed ${JSON.stringify(map)}`);
    const expectedLegend = ['Ваш мир', 'Союзная', 'Вражеская', 'Нейтральная', 'Необитаемые', 'Уникальные', 'Отступники', 'Аномалии'];
    if (JSON.stringify(map.legend.map((item) => item.text)) !== JSON.stringify(expectedLegend)
      || map.ownerRelations.find((item) => item.id === 'player-planet-helion-01')?.relation !== 'self'
      || map.ownerRelations.find((item) => item.id === 'test-mode-ally-ira-vel-v1')?.relation !== 'ally') {
      throw new Error(`${label}: relation color legend contract failed ${JSON.stringify({ legend: map.legend, ownerRelations: map.ownerRelations })}`);
    }
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

    const deadCoordinateLabel = `[${debrisFixtures.deadCoordinate.galaxy}:${debrisFixtures.deadCoordinate.system}:${debrisFixtures.deadCoordinate.position}]`;
    const deadSelector = `[data-qa-universe-kind="empty"][aria-label*="${deadCoordinateLabel}"]`;
    const deadMarker = await debrisMarkerSnapshot(win, deadSelector);
    if (deadMarker.amount !== '34567' || deadMarker.tagName !== 'BUTTON' || !deadMarker.ariaLabel.replace(/\D/g, '').includes(deadMarker.amount)) {
      throw new Error(`${label}: dead-target debris was not rendered on its empty coordinate: ${JSON.stringify({ deadCoordinate: debrisFixtures.deadCoordinate, deadMarker })}`);
    }
    const deadDebrisInteraction = await verifyDebrisMarkerInteraction(win, deadSelector, deadMarker.amount);

    await selectSystem(win, debrisFixtures.liveCoordinate.system);
    const liveSelector = `[data-qa-universe-object="${debrisFixtures.liveTargetId}"]`;
    const liveMarker = await debrisMarkerSnapshot(win, liveSelector);
    if (liveMarker.amount !== '23456' || !liveMarker.ariaLabel.replace(/\D/g, '').includes(liveMarker.amount)) {
      throw new Error(`${label}: live-target debris was not rendered on its occupied coordinate: ${JSON.stringify({ liveTargetId: debrisFixtures.liveTargetId, liveCoordinate: debrisFixtures.liveCoordinate, liveMarker })}`);
    }
    const liveDebrisInteraction = await verifyDebrisMarkerInteraction(win, liveSelector, liveMarker.amount);
    await selectSystem(win, 1);

    await clickObject(win, '[data-qa-universe-object="player-planet-helion-01"]');
    const player = await inspectorSnapshot(win);
    checkCopy(player);
    await checkModal(win);
    const playerPortraits = await inspectRenderedFactionGeneralPortraits(win, '[data-qa-universe-inspector] [data-qa-faction-general]');
    assertRenderedFactionGeneralPortraits(playerPortraits, ['aegis'], `${label} player universe`);
    const playerSpyAction = player.actions.find((action) => action.action === 'spy');
    const playerFleetAction = player.actions.find((action) => action.action === 'fleet');
    const playerAttackAction = player.actions.find((action) => action.action === 'attack');
    if (player.kind !== 'player' || player.ownerName !== 'Dendrilion' || !player.avatar.includes('aegis_general') || player.points.length !== 4 || player.planetRows !== 1 || player.actions.length !== 3
      || !playerSpyAction || !playerSpyAction.disabled || playerSpyAction.status !== 'disabled' || !playerSpyAction.title.includes('Это ваша планета')
      || !playerFleetAction || playerFleetAction.disabled || playerFleetAction.status !== 'supported' || !playerFleetAction.title.includes('Своя планета принимает транспортировку')
      || !playerAttackAction || !playerAttackAction.disabled || playerAttackAction.status !== 'disabled' || !playerAttackAction.title.includes('Атака запрещена против своей планеты')) {
      throw new Error(`${label}: player inspector contract failed ${JSON.stringify(player)}`);
    }
    if (!player.text.includes('Астеры') || !player.text.includes('Содружество Гелион') || !player.text.includes('[HLN]')) throw new Error(`${label}: player profile identity contract failed ${JSON.stringify(player)}`);
    await capture(win, directory, 'player-inspector');
    await dismissInspector(win);
    await checkRestoredFocus(win, 'player-planet-helion-01');
    await clickObject(win, '[data-qa-universe-object="player-planet-helion-01"]');
    await clickAt(win, '[data-qa-universe-action="fleet"]');
    await waitFor(win, `document.querySelector('.fleet-workspace-v1[data-qa-flight-launch-context]')?.getAttribute('data-qa-flight-launch-context') === '[1:1:1]'`);
    const ownLaunchRelation = await win.webContents.executeJavaScript(`document.querySelector('.fleet-workspace-v1')?.getAttribute('data-qa-target-relation') || ''`);
    if (ownLaunchRelation !== 'self') throw new Error(`${label}: own planet fleet action did not preserve self relation: ${ownLaunchRelation}`);
    await clickPrimary(win, 'universe');
    await selectSystem(win, 1);

    const npcSelector = '[data-qa-universe-kind="npc"][data-qa-universe-relation="neutral"]';
    const npcSystem = await findObject(win, npcSelector);
    const npcId = await win.webContents.executeJavaScript(`document.querySelector(${JSON.stringify(npcSelector)}).getAttribute('data-qa-universe-object')`);
    const npcRelation = await win.webContents.executeJavaScript(`document.querySelector(${JSON.stringify(npcSelector)}).getAttribute('data-qa-universe-relation')`);
    if (npcRelation !== 'neutral') throw new Error(`${label}: unassigned bot must remain neutral, got ${npcRelation}`);
    await clickObject(win, npcSelector);
    const npc = await inspectorSnapshot(win);
    checkCopy(npc);
    await checkModal(win);
    const npcPortraits = await inspectRenderedFactionGeneralPortraits(win, '[data-qa-universe-inspector] [data-qa-faction-general]');
    assertRenderedFactionGeneralPortraits(npcPortraits, ['veyra'], `${label} NPC universe`);
    const npcSpyActions = npc.actions.filter((action) => action.action === 'spy');
    const npcFleetActions = npc.actions.filter((action) => action.action === 'fleet');
    const npcAttackActions = npc.actions.filter((action) => action.action === 'attack');
    if (npc.kind !== 'npc' || npc.ownerName !== 'Бот 01' || !npc.ownerId || npc.planetRows !== 7 || npc.actions.length !== 21
      || npcSpyActions.length !== 7 || npcSpyActions.some((action) => action.disabled || action.status !== 'supported' || !action.title.includes('доступна для шпионажа'))
      || npcFleetActions.length !== 7 || npcFleetActions.some((action) => !action.disabled || action.status !== 'disabled' || !action.title.includes('только на свою или явную союзную планету'))
      || npcAttackActions.length !== 7 || npcAttackActions.some((action) => action.disabled || action.status !== 'supported' || !action.title.includes('доступна для атаки'))) {
      throw new Error(`${label}: NPC action/list contract failed ${JSON.stringify(npc)}`);
    }
    const systems = npc.rows.map((row) => Number(row.coordinate.slice(1, -1).split(':')[1]));
    if (new Set(systems).size !== 7 || systems.some((system) => !Number.isInteger(system) || system < 1 || system > 40) || new Set(npc.rows.map((row) => row.id)).size !== 7 || npc.rows.some((row) => row.visitId !== row.id || !/^\[1:\d+:\d+\]$/.test(row.coordinate) || Number(row.coordinate.slice(1, -1).split(':')[2]) < 1 || Number(row.coordinate.slice(1, -1).split(':')[2]) > 24)) throw new Error(`${label}: NPC coordinates/visit targets failed ${JSON.stringify(npc.rows)}`);
    await capture(win, directory, 'npc-inspector');
    await dismissInspector(win);
    await checkRestoredFocus(win, npcId);

    await clickObject(win, npcSelector);
    await clickAt(win, '[data-qa-universe-action="attack"]');
    await waitFor(win, `document.querySelector('[data-qa-attack-prep]') && document.querySelector('[data-qa-target-relation]')?.getAttribute('data-qa-target-relation') === 'neutral'`);
    const attackPrep = await win.webContents.executeJavaScript(`(() => ({
      mission: document.querySelector('#fleet-mission')?.value || '',
      rounds: Array.from(document.querySelectorAll('[data-qa-attack-rounds] option')).map((option) => option.value),
      roster: Array.from(document.querySelectorAll('[data-qa-fleet-ship]')).map((row) => row.getAttribute('data-qa-fleet-ship')),
      relation: document.querySelector('[data-qa-target-relation]')?.getAttribute('data-qa-target-relation') || '',
    }))()`);
    const expectedAttackRoster = ['spy-probe', 'colonizer', 'recycler', 'scout'];
    if (attackPrep.mission !== 'attack' || JSON.stringify(attackPrep.rounds) !== JSON.stringify(['5', '8', '12']) || attackPrep.relation !== 'neutral' || JSON.stringify(attackPrep.roster) !== JSON.stringify(expectedAttackRoster)) {
      throw new Error(`${label}: attack preparation contract failed ${JSON.stringify(attackPrep)}`);
    }
    await clickPrimary(win, 'universe');
    await selectSystem(win, npcSystem);

    const allySelector = '[data-qa-universe-object="test-mode-ally-ira-vel-v1"]';
    await findObject(win, allySelector);
    await clickObject(win, allySelector);
    const ally = await inspectorSnapshot(win);
    const allyFleetAction = ally.actions.find((action) => action.action === 'fleet');
    const allyAttackAction = ally.actions.find((action) => action.action === 'attack');
    if (ally.kind !== 'npc' || ally.ownerName !== 'Ира Вель' || ally.ownerId !== 'member-ira-vel' || ally.planetRows !== 1
      || !allyFleetAction || allyFleetAction.disabled || allyFleetAction.status !== 'supported'
      || !allyAttackAction || !allyAttackAction.disabled || allyAttackAction.status !== 'disabled' || !allyAttackAction.title.includes('союзной планеты')) {
      throw new Error(`${label}: explicit ally transport action contract failed ${JSON.stringify(ally)}`);
    }
    await clickAt(win, '[data-qa-universe-action="fleet"]');
    await waitFor(win, `document.querySelector('[data-qa-flight-launch-context]')?.getAttribute('data-qa-flight-launch-context') === '[1:1:2]'`);
    await clickPrimary(win, 'universe');
    await selectSystem(win, npcSystem);

    // Visit every holding through its row, then reopen the actual map planet.
    await clickObject(win, `[data-qa-universe-object="${npcId}"]`);
    for (const row of [...npc.rows.filter((row) => systems[npc.rows.indexOf(row)] !== npcSystem), ...npc.rows.filter((row) => systems[npc.rows.indexOf(row)] === npcSystem)]) {
      const targetSystem = Number(row.coordinate.slice(1, -1).split(':')[1]);
      await clickAt(win, `[data-qa-universe-visit="${row.id}"]`);
      await waitFor(win, `!document.querySelector('[data-qa-universe-inspector]') && !document.querySelector('.stage').inert && document.querySelector('[data-qa-universe]')?.getAttribute('data-qa-universe-system') === ${JSON.stringify(String(targetSystem))}`);
      await clickObject(win, `[data-qa-universe-object="${row.id}"]`);
      const reopened = await inspectorSnapshot(win);
      const reopenedSpyActions = reopened.actions.filter((action) => action.action === 'spy');
      const reopenedFleetActions = reopened.actions.filter((action) => action.action === 'fleet');
      const reopenedAttackActions = reopened.actions.filter((action) => action.action === 'attack');
      if (reopened.ownerId !== npc.ownerId || reopened.ownerName !== 'Бот 01' || JSON.stringify(reopened.rows) !== JSON.stringify(npc.rows) || reopened.actions.length !== 21
        || reopenedSpyActions.length !== 7 || reopenedSpyActions.some((action) => action.disabled || action.status !== 'supported' || !action.title.includes('доступна для шпионажа'))
        || reopenedFleetActions.length !== 7 || reopenedFleetActions.some((action) => !action.disabled || action.status !== 'disabled' || !action.title.includes('только на свою или явную союзную планету'))
        || reopenedAttackActions.length !== 7 || reopenedAttackActions.some((action) => action.disabled || action.status !== 'supported' || !action.title.includes('доступна для атаки'))) {
        throw new Error(`${label}: visit did not reopen the same seven holdings ${JSON.stringify(reopened)}`);
      }
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
    if (freeAsteroid.kind !== 'asteroid' || freeAsteroid.underlyingKind !== 'empty' || !freeAsteroid.text.includes('СКРЫТ ДО ПЕРЕРАБОТКИ') || !freeAsteroid.text.includes('Следующее перемещение через')
      || !freeAsteroid.specialActions.some((action) => action.action === 'colonize' && !action.disabled)
      || freeAsteroid.specialActions.filter((action) => action.action === 'asteroid-recycler' && !action.disabled).length !== 1
      || freeAsteroid.specialActions.some((action) => action.action === 'gas-extraction')) {
      throw new Error(`${label}: free asteroid inspector must show one combined recycler action ${JSON.stringify(freeAsteroid)}`);
    }
    await capture(win, directory, 'asteroid-inspector');
    await clickAt(win, '[data-qa-universe-special-action="colonize"]');
    await waitFor(win, `document.querySelector('.fleet-workspace-v1[data-qa-flight-launch-context]')`);
    const launchContext = await win.webContents.executeJavaScript(`document.querySelector('.fleet-workspace-v1')?.getAttribute('data-qa-flight-launch-context') || ''`);
    if (launchContext !== freeAsteroid.targetCoordinate) throw new Error(`${label}: asteroid colonization target context was not preserved ${JSON.stringify({ launchContext, target: freeAsteroid.targetCoordinate })}`);
    await waitFor(win, `document.querySelector('[data-qa-flight-preview-open]') && !document.querySelector('[data-qa-flight-preview-open]').disabled`);
    const geometryBeforePreview = await win.webContents.executeJavaScript(`(() => { const rect = (selector) => document.querySelector(selector)?.getBoundingClientRect().toJSON() || null; return { fleet: rect('.fleet-workspace-v1'), sidebar: rect('.fleet-sidebar-v1'), horizontalOverflow: document.documentElement.scrollWidth > innerWidth + 2 || document.body.scrollWidth > innerWidth + 2 }; })()`);
    await clickAt(win, '[data-qa-flight-preview-open]', false, true, true);
    await waitFor(win, `document.querySelector('[data-qa-flight-preview-backdrop]')`);
    const timelineText = await win.webContents.executeJavaScript(`document.querySelector('[data-qa-flight-preview-backdrop]')?.textContent?.replace(/\s+/g, ' ').trim() || ''`);
    const timelineFields = ['ИСТОЧНИК', 'выбрано флотом', 'ЦЕЛЬ', 'Цель подтверждена', 'СОСТАВ ФЛОТА', 'Колонизатор', 'Население: 12', 'ПАРАМЕТРЫ ПЕРЕЛЁТА', 'ЭФФ. СКОРОСТЬ', 'ТУДА', 'ОБРАТНО', 'ПОЛНЫЙ ЦИКЛ', 'ГАЗ', 'НАСЕЛЕНИЕ', 'ПРИБЫТИЕ', 'МОСКОВСКОЕ ВРЕМЯ', 'МСК', 'Газ списывается только за один путь туда.', 'При отзыве колонизатор возвращается', 'ОТМЕНА', 'ОТПРАВИТЬ'];
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
    if (timelineCargo.present) throw new Error(`${label}: colonization must not expose a resource cargo editor ${JSON.stringify(timelineCargo)}`);
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
      const dispatch = document.querySelector('[data-qa-flight-dispatch-confirm]');
      return {
        text: status?.textContent?.replace(/\s+/g, ' ').trim() || '',
        invalid: status?.classList.contains('is-invalid') || false,
        dispatchEnabled: Boolean(dispatch && !dispatch.disabled),
        inputs: Array.from(document.querySelectorAll('[data-qa-flight-target-inputs] input')).map((input) => input.value),
      };
     })()`);
    if (occupiedTargetState.invalid || !occupiedTargetState.text.includes('Координаты будут проверены при отправке') || !occupiedTargetState.dispatchEnabled) throw new Error(`${label}: occupied target was checked before Send in Mission Timeline ${JSON.stringify(occupiedTargetState)}`);
    await clickAt(win, '[data-qa-flight-dispatch-confirm]');
    await waitFor(win, `document.querySelector('[data-qa-flight-target-status].is-invalid')`);
    const rejectedOccupiedTarget = await win.webContents.executeJavaScript(`(() => {
      const status = document.querySelector('[data-qa-flight-target-status]');
      const dispatch = document.querySelector('[data-qa-flight-dispatch-confirm]');
      return {
        text: status?.textContent?.replace(/\\s+/g, ' ').trim() || '',
        invalid: status?.classList.contains('is-invalid') || false,
        dispatchEnabled: Boolean(dispatch && !dispatch.disabled),
        modalOpen: Boolean(document.querySelector('[data-qa-flight-preview-backdrop]')),
        inputs: Array.from(document.querySelectorAll('[data-qa-flight-target-inputs] input')).map((input) => input.value),
      };
    })()`);
    if (!rejectedOccupiedTarget.invalid || !rejectedOccupiedTarget.text.includes('Координата уже занята') || rejectedOccupiedTarget.dispatchEnabled || !rejectedOccupiedTarget.modalOpen || JSON.stringify(rejectedOccupiedTarget.inputs) !== JSON.stringify(['1', '1', '1'])) throw new Error(`${label}: Send did not reject occupied target while preserving Mission Timeline editing ${JSON.stringify(rejectedOccupiedTarget)}`);
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
    if (occupiedAsteroid.kind !== 'asteroid' || occupiedAsteroid.underlyingKind === 'empty' || occupiedAsteroid.specialActions.some((action) => action.action === 'colonize')
      || occupiedAsteroid.specialActions.filter((action) => action.action === 'asteroid-recycler' && !action.disabled).length !== 1
      || occupiedAsteroid.specialActions.some((action) => action.action === 'gas-extraction')) {
      throw new Error(`${label}: occupied asteroid inspector must show one combined recycler action ${JSON.stringify(occupiedAsteroid)}`);
    }
    await dismissInspector(win);

    await selectSystem(win, debrisFixtures.asteroid.system);
    const capturedSelector = `[data-qa-universe-object="${debrisFixtures.asteroid.id}"]`;
    const capturedBefore = await win.webContents.executeJavaScript(`(() => {
      const node = document.querySelector(${JSON.stringify(capturedSelector)});
      const marker = node?.querySelector('.universe-asteroid-debris-marker');
      const tooltip = marker?.querySelector('[role="tooltip"]');
      return { present: Boolean(node && marker), spawnIndex: node?.getAttribute('data-qa-universe-asteroid-spawn-index') || '',
        position: Number(node?.getAttribute('data-qa-universe-asteroid-position')), ariaLabel: node?.getAttribute('aria-label') || '',
        title: node?.getAttribute('title') || '', describedBy: node?.getAttribute('aria-describedby') || '',
        tooltipId: tooltip?.id || '', tooltip: tooltip?.textContent?.trim() || '', html: node?.outerHTML || '' };
    })()`);
    if (!capturedBefore.present || capturedBefore.spawnIndex !== debrisFixtures.asteroid.spawnIndex || capturedBefore.position !== debrisFixtures.asteroid.fromPosition
      || capturedBefore.ariaLabel.includes('876543') || capturedBefore.title.includes('876543') || capturedBefore.tooltip !== 'На астероиде есть обломки'
      || !capturedBefore.describedBy.split(/\s+/).includes(capturedBefore.tooltipId) || capturedBefore.html.includes('876543')
      || !capturedBefore.html.includes('universe-asteroid-debris-marker') || capturedBefore.html.includes('class="universe-debris-marker"')) {
      throw new Error(`${label}: captured debris must render as a separate nonnumeric marker on its asteroid ${JSON.stringify({ capturedBefore, fixture: debrisFixtures.asteroid })}`);
    }
    await clickObject(win, capturedSelector);
    const capturedInspector = await inspectorSnapshot(win);
    const capturedInspectorRow = await win.webContents.executeJavaScript(`(() => { const row = document.querySelector('[data-qa-universe-inspector] [data-qa-universe-asteroid-debris="present"]'); return { label: row?.querySelector('dt')?.textContent?.trim() || '', value: row?.querySelector('dd')?.textContent?.trim() || '' }; })()`);
    if (capturedInspector.kind !== 'asteroid' || capturedInspectorRow.label !== 'Обломки на астероиде' || capturedInspectorRow.value !== 'есть' || capturedInspector.text.includes('876543')) {
      throw new Error(`${label}: asteroid card must expose only the binary presence row ${JSON.stringify({ capturedInspector, capturedInspectorRow })}`);
    }
    await dismissInspector(win);
    let absentAsteroid = await win.webContents.executeJavaScript(`(() => [...document.querySelectorAll('[data-qa-universe-kind="asteroid"]')].find((node) => node.getAttribute('data-qa-universe-object') !== ${JSON.stringify(debrisFixtures.asteroid.id)})?.getAttribute('data-qa-universe-object') || '')()`);
    if (!absentAsteroid) {
      await selectSystem(win, 1);
      absentAsteroid = await win.webContents.executeJavaScript(`(() => [...document.querySelectorAll('[data-qa-universe-kind="asteroid"]')].find((node) => node.getAttribute('data-qa-universe-object') !== ${JSON.stringify(debrisFixtures.asteroid.id)})?.getAttribute('data-qa-universe-object') || '')()`);
    }
    if (!absentAsteroid) throw new Error(`${label}: no unladen asteroid was available for the binary inspector check`);
    await clickObject(win, `[data-qa-universe-object="${absentAsteroid}"]`);
    const emptyCargoInspector = await inspectorSnapshot(win);
    const emptyCargoRow = await win.webContents.executeJavaScript(`(() => { const row = document.querySelector('[data-qa-universe-inspector] [data-qa-universe-asteroid-debris="absent"]'); return { label: row?.querySelector('dt')?.textContent?.trim() || '', value: row?.querySelector('dd')?.textContent?.trim() || '' }; })()`);
    if (emptyCargoInspector.kind !== 'asteroid' || emptyCargoRow.label !== 'Обломки на астероиде' || emptyCargoRow.value !== 'нет') throw new Error(`${label}: empty asteroid card must report no debris ${JSON.stringify({ emptyCargoInspector, emptyCargoRow })}`);

    await win.webContents.executeJavaScript(`void (Date.now = () => ${debrisFixtures.asteroid.nextMoveAt + 1});`);
    await sleep(1_200);
    await selectSystem(win, debrisFixtures.asteroid.nextSystem);
    await waitFor(win, `(() => { const node = document.querySelector(${JSON.stringify(capturedSelector)}); return Number(node?.getAttribute('data-qa-universe-asteroid-position')) === ${debrisFixtures.asteroid.toPosition} && Boolean(node?.querySelector('.universe-asteroid-debris-marker')); })()`);
    const capturedAfter = await win.webContents.executeJavaScript(`(() => {
      const node = document.querySelector(${JSON.stringify(capturedSelector)});
      const marker = node?.querySelector('.universe-asteroid-debris-marker');
      const tooltip = marker?.querySelector('[role="tooltip"]');
      return { position: Number(node?.getAttribute('data-qa-universe-asteroid-position')), tooltip: tooltip?.textContent?.trim() || '',
        ariaLabel: node?.getAttribute('aria-label') || '', title: node?.getAttribute('title') || '', html: node?.outerHTML || '' };
    })()`);
    if (capturedAfter.position !== debrisFixtures.asteroid.toPosition || capturedAfter.tooltip !== 'На астероиде есть обломки'
      || capturedAfter.ariaLabel.includes('876543') || capturedAfter.title.includes('876543') || capturedAfter.html.includes('876543')) {
      throw new Error(`${label}: captured debris marker did not follow the asteroid with presence-only labels ${JSON.stringify({ capturedAfter, fixture: debrisFixtures.asteroid })}`);
    }
    await selectSystem(win, debrisFixtures.deadCoordinate.system);
    const stationaryDebrisAfter = await debrisMarkerSnapshot(win, `[data-qa-universe-kind="empty"][aria-label*="[${debrisFixtures.deadCoordinate.galaxy}:${debrisFixtures.deadCoordinate.system}:${debrisFixtures.deadCoordinate.position}]"]`);
    if (stationaryDebrisAfter.amount !== '34567') throw new Error(`${label}: free orbital debris did not remain at its fixed coordinate ${JSON.stringify(stationaryDebrisAfter)}`);

    const pirateSystem = await findObject(win, '[data-qa-universe-kind="pirate"]');
    await clickObject(win, '[data-qa-universe-kind="pirate"]');
    const pirate = await inspectorSnapshot(win);
    checkCopy(pirate);
    await checkModal(win);
    if (pirate.kind !== 'pirate' || !pirate.text.includes('Пиратский объект') || !pirate.text.includes('исчезнет через') || !pirate.specialActionDisabled
      || !pirate.specialArt.loaded || !hasBundledImageAsset(pirate.specialArt.src, ['pirate-planet-', 'planet-020-', 'orbital-forge-'])) throw new Error(`${label}: pirate inspector contract failed ${JSON.stringify(pirate)}`);
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
        if (snapshot.kind !== 'anomaly' || !snapshot.text.includes('Аномалия') || !snapshot.text.includes('исчезнет через') || !snapshot.specialActionDisabled
          || !snapshot.specialArt.loaded || !hasBundledImageAsset(snapshot.specialArt.src, ['anomaly-'])) throw new Error(`${label}: anomaly inspector contract failed ${JSON.stringify(snapshot)}`);
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
      if (special.kind !== kind || !special.text.includes('Владелец отсутствует') || !special.specialActionDisabled
        || (kind === 'unique' && (!special.specialArt.loaded || !hasBundledImageAsset(special.specialArt.src, ['unique-variant-', 'planet-010-', 'planet-013-', 'planet-021-'])))) throw new Error(`${label}: ${kind} inspector contract failed ${JSON.stringify(special)}`);
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

    await win.webContents.executeJavaScript(`(() => {
      const save = JSON.parse(localStorage.getItem(${JSON.stringify(SAVE_KEY)}) || '{}');
      const espionage = save.espionage || {};
      const targets = espionage.targets || espionage.bot01Planets || {};
      const live = Object.values(targets).find((target) => target?.id === ${JSON.stringify(debrisFixtures.liveTargetId)});
      if (live?.resources) live.resources.debris = 0;
      if (espionage.orbitalDebris) delete espionage.orbitalDebris[${JSON.stringify(debrisFixtures.deadTargetId)}];
      save.espionage = espionage;
      localStorage.setItem(${JSON.stringify(SAVE_KEY)}, JSON.stringify(save));
    })()`);
    await reload(win);
    await win.webContents.executeJavaScript(`void (Date.now = () => ${QA_UNIVERSE_NOW});`);
    await clickPrimary(win, 'universe');
    await selectSystem(win, debrisFixtures.deadCoordinate.system);
    if (await win.webContents.executeJavaScript(`Boolean(document.querySelector(${JSON.stringify(deadSelector)})?.querySelector('.universe-debris-marker'))`)) {
      throw new Error(`${label}: dead-coordinate marker remained after the orbital ledger was cleared`);
    }
    await selectSystem(win, debrisFixtures.liveCoordinate.system);
    if (await win.webContents.executeJavaScript(`Boolean(document.querySelector(${JSON.stringify(liveSelector)})?.querySelector('.universe-debris-marker'))`)) {
      throw new Error(`${label}: live-coordinate marker remained after its target debris reached zero`);
    }
    await capture(win, directory, 'debris-markers-zero');

    await win.webContents.executeJavaScript(`document.querySelector('[data-qa-navigation="primary"] [data-qa-route="planet"]')?.click()`);
    await waitFor(win, `document.querySelector('.owned-planet-edit-v4')`);
    const openSkinPicker = await win.webContents.executeJavaScript(`(() => {
      const row = [...document.querySelectorAll('.owned-planet-row-v4')].find((item) => item.textContent?.includes('Helion 01'));
      const button = row?.querySelector('.owned-planet-edit-v4');
      button?.click();
      return Boolean(button);
    })()`);
    if (!openSkinPicker) throw new Error(`${label}: could not open the homeworld skin picker`);
    await waitFor(win, `document.querySelectorAll('.skin-picker-grid [data-qa-planet-skin^="skin-asterion-"]').length === 9`);
    await waitFor(win, `Array.from(document.querySelectorAll('.skin-picker-grid [data-qa-planet-skin^="skin-asterion-"] img')).every((image) => image.complete && image.naturalWidth > 0)`);
    const picker = await win.webContents.executeJavaScript(`(() => ({
      total: document.querySelectorAll('.skin-picker-grid [data-qa-planet-skin]').length,
      newSkins: Array.from(document.querySelectorAll('.skin-picker-grid [data-qa-planet-skin^="skin-asterion-"]')).map((button) => ({ id: button.getAttribute('data-qa-planet-skin'), label: button.querySelector('span')?.textContent?.trim() || '', src: button.querySelector('img')?.getAttribute('src') || '', loaded: Boolean(button.querySelector('img')?.complete && button.querySelector('img')?.naturalWidth > 0), naturalWidth: button.querySelector('img')?.naturalWidth || 0, naturalHeight: button.querySelector('img')?.naturalHeight || 0 })),
    }))()`);
    if (picker.total !== 30 || picker.newSkins.length !== 9 || picker.newSkins.some((skin, index) => skin.id !== `skin-asterion-${String(index + 1).padStart(2, '0')}` || !skin.label || !skin.loaded || skin.naturalWidth !== 1024 || skin.naturalHeight !== 1024 || !skin.src.endsWith('.webp'))) {
      throw new Error(`${label}: new planet skins are missing from the picker ${JSON.stringify(picker)}`);
    }
    const selectedSkinId = 'skin-asterion-09';
    await win.webContents.executeJavaScript(`document.querySelector('[data-qa-planet-skin="${selectedSkinId}"]')?.click()`);
    await waitFor(win, `JSON.parse(localStorage.getItem(${JSON.stringify(SAVE_KEY)}) || '{}').planets?.['helion-01']?.skin === ${JSON.stringify(selectedSkinId)}`);
    const selectedSkin = await win.webContents.executeJavaScript(`(() => ({ src: document.querySelector('[data-qa-planet-skin-art]')?.getAttribute('src') || '', loaded: Boolean(document.querySelector('[data-qa-planet-skin-art]')?.complete && document.querySelector('[data-qa-planet-skin-art]')?.naturalWidth > 0) }))()`);
    if (!selectedSkin.loaded || !selectedSkin.src.endsWith('/skin-asterion-09.webp')) throw new Error(`${label}: selected planet art did not update ${JSON.stringify(selectedSkin)}`);
    await win.webContents.executeJavaScript(`document.querySelector('.planet-editor-modal-v5 [data-asterion-close]')?.click()`);
    await waitFor(win, `!document.querySelector('.planet-editor-modal-v5')`);
    await reload(win);
    await win.webContents.executeJavaScript(`document.querySelector('[data-qa-navigation="primary"] [data-qa-route="planet"]')?.click()`);
    await waitFor(win, `document.querySelector('[data-qa-planet-skin-art]')?.complete && document.querySelector('[data-qa-planet-skin-art]')?.naturalWidth > 0`);
    const persistedSkin = await win.webContents.executeJavaScript(`(() => { const image = document.querySelector('[data-qa-planet-skin-art]'); const rect = image?.getBoundingClientRect(); return { saved: JSON.parse(localStorage.getItem(${JSON.stringify(SAVE_KEY)}) || '{}').planets?.['helion-01']?.skin || '', src: image?.getAttribute('src') || '', naturalWidth: image?.naturalWidth || 0, naturalHeight: image?.naturalHeight || 0, displayWidth: rect?.width || 0, displayHeight: rect?.height || 0 }; })()`);
    if (persistedSkin.saved !== selectedSkinId || !persistedSkin.src.endsWith('/skin-asterion-09.webp') || persistedSkin.naturalWidth !== 1024 || persistedSkin.naturalHeight !== 1024 || persistedSkin.displayWidth <= 0 || persistedSkin.displayHeight <= 0 || persistedSkin.displayWidth > 520 || persistedSkin.displayHeight > 520) throw new Error(`${label}: selected high-resolution skin did not survive reload or has unexpected display size ${JSON.stringify(persistedSkin)}`);
    await capture(win, directory, 'planet-skin-persisted');
    await clickPrimary(win, 'universe');
    await waitFor(win, `(() => { const image = document.querySelector('[data-qa-universe-object="player-planet-helion-01"] img'); return image?.complete && image.naturalWidth === 128 && image.naturalHeight === 128; })()`);
    const mapSkinPreview = await win.webContents.executeJavaScript(`(() => { const image = document.querySelector('[data-qa-universe-object="player-planet-helion-01"] img'); return { src: image?.getAttribute('src') || '', naturalWidth: image?.naturalWidth || 0, naturalHeight: image?.naturalHeight || 0 }; })()`);
    if (!mapSkinPreview.src.endsWith('/planet-previews/skin-asterion-09.webp') || mapSkinPreview.naturalWidth !== 128 || mapSkinPreview.naturalHeight !== 128) throw new Error(`${label}: Universe did not use the audited 128px skin preview ${JSON.stringify(mapSkinPreview)}`);

    const screenshots = skipScreenshots ? [] : fs.readdirSync(directory).filter((name) => name.endsWith('.png')).sort();
    return {
      viewport: label,
      map: { system: map.system, systemOptions: map.systemOptions, positionCount: map.positionCount, asteroidCount: map.asteroidCount, objectKinds: map.objectKinds, homeCaption: map.homeCaption },
      layout: { htmlClass: map.htmlClass, webStageScale: map.webStageScale, visualViewport: map.visualViewport, stageRect: map.stageRect },
      player: { ownerName: player.ownerName, points: player.points, planetRows: player.planetRows },
      npc: { ownerName: npc.ownerName, planetRows: npc.planetRows, rows: npc.rows, fleetActionsDisabled: npcFleetActions.every((action) => action.disabled && action.status === 'disabled') },
      specialInspectors: { empty: empty.kind, asteroid: freeAsteroid.kind, occupiedAsteroid: occupiedAsteroid.kind, pirate: pirate.kind, anomaly: anomaly.kind, uninhabited: 'uninhabited', unique: 'unique' },
      debrisMarkers: {
        dead: { coordinate: debrisFixtures.deadCoordinate, amount: deadMarker.amount, interaction: deadDebrisInteraction },
        live: { coordinate: debrisFixtures.liveCoordinate, amount: liveMarker.amount, interaction: liveDebrisInteraction },
        cleared: true,
      },
      planetSkin: { pickerCount: picker.total, selected: selectedSkinId, persisted: persistedSkin.saved === selectedSkinId, runtimeArt: persistedSkin.src, naturalResolution: [persistedSkin.naturalWidth, persistedSkin.naturalHeight], displaySize: [persistedSkin.displayWidth, persistedSkin.displayHeight], mapPreview: mapSkinPreview },
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
