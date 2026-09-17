const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-gpu');
app.on('window-all-closed', () => {});

const ROOT = path.join(__dirname, '..');
const OUTPUT = path.join(ROOT, 'artifacts', 'battle-report-qa');
const SAVE_KEY = 'asterion.vertical-slice.v1';
const VIEWPORTS = [[1440, 900], [390, 844]];
const skipScreenshots = process.env.ASTERION_SKIP_SCREENSHOTS === '1';
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

async function clickPrimary(win, route, waitExpression) {
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

async function clickBattleSection(win) {
  const clicked = await win.webContents.executeJavaScript(`(() => {
    const button = document.querySelector('[data-qa-fleet-section="battles"]');
    if (!button) return false;
    button.click();
    return true;
  })()`);
  if (!clicked) throw new Error('Fleet battles section not found');
  await waitFor(win, `document.querySelector('[data-qa-battle-card]')`);
  await settle(win);
}

async function capture(win, directory, name) {
  if (skipScreenshots) return;
  const image = await win.webContents.capturePage();
  fs.writeFileSync(path.join(directory, `${name}.png`), image.toPNG());
}

async function listSnapshot(win) {
  return win.webContents.executeJavaScript(`(() => ({
    cardCount: document.querySelectorAll('[data-qa-battle-card]').length,
    collapsedCardCount: document.querySelectorAll('[data-qa-battle-card]:not([open])').length,
    cardLossCount: document.querySelectorAll('[data-qa-battle-losses]').length,
    openButtonCount: document.querySelectorAll('[data-qa-battle-open]').length,
    resultIconCount: document.querySelectorAll('[data-qa-battle-card] .battle-result-icon-v1').length,
    resultLabels: Array.from(document.querySelectorAll('[data-qa-battle-card] .battle-result-badge-v1 strong')).map((node) => node.textContent?.trim() || ''),
    rootHorizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 2,
    bodyHorizontalOverflow: document.body.scrollWidth > document.body.clientWidth + 2,
  }))()`);
}

async function openBattle(win, reportId) {
  const selector = reportId ? `[data-qa-battle-open="${reportId}"]` : '[data-qa-battle-open]';
  const clicked = await win.webContents.executeJavaScript(`(() => {
    const button = document.querySelector(${JSON.stringify(selector)});
    if (!button) return false;
    const card = button.closest('details');
    if (card) card.open = true;
    button.focus();
    button.click();
    return true;
  })()`);
  if (!clicked) throw new Error(`Battle report open button not found: ${reportId || 'first'}`);
  await waitFor(win, `document.querySelector('[role="dialog"][data-qa-battle-report-modal]')`);
  await settle(win);
}

async function modalSnapshot(win) {
  return win.webContents.executeJavaScript(`(() => {
    const modal = document.querySelector('[role="dialog"][data-qa-battle-report-modal]');
    const scroll = modal?.querySelector('.battle-report-modal-scroll-v1');
    const outcome = modal?.querySelector('[data-qa-battle-outcome]');
    const focusables = Array.from(modal?.querySelectorAll('button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), summary, [tabindex]:not([tabindex="-1"])') || []);
    const technologyRows = Array.from(modal?.querySelectorAll('.battle-tech-table-row-v1') || []);
    const roundLog = modal?.querySelector('[data-qa-battle-round-log]');
    const rounds = Array.from(modal?.querySelectorAll('[data-qa-battle-round]') || []);
    const outcomeStateHeader = modal?.querySelector('.battle-outcome-mini-table-head-v1')?.textContent || '';
    const text = modal?.textContent || '';
    return {
      present: Boolean(modal),
      ariaModal: modal?.getAttribute('aria-modal') || '',
      labelledBy: modal?.getAttribute('aria-labelledby') || '',
      analysisOpenCount: modal?.querySelectorAll('[data-qa-battle-round-analysis][open]').length || 0,
      hasOverallLosses: Boolean(modal?.querySelector('[data-qa-battle-summary]')),
      hasHeaderTable: Boolean(modal?.querySelector('[data-qa-battle-unit-table]')),
      headerAvatarCount: modal?.querySelectorAll('[data-qa-battle-side-avatar]').length || 0,
      technologyRowCount: technologyRows.length,
      technologyTooltipCount: modal?.querySelectorAll('.battle-tech-tooltip-v1').length || 0,
      technologyTooltipImageCount: modal?.querySelectorAll('.battle-tech-tooltip-row-v1 img').length || 0,
      visibleTechnologyLevel: technologyRows.some((row) => (row.querySelector(':scope > span')?.textContent || '').includes('из')),
      technologyRowsFocusable: technologyRows.every((row) => row.tabIndex >= 0),
      eventCardCount: modal?.querySelectorAll('[data-qa-battle-event]').length || 0,
      hasBattlePoints: Boolean(modal?.querySelector('[data-qa-battle-points]')),
      hasVisualReport: Boolean(modal?.querySelector('[data-qa-battle-visual-report]')),
      hasInitialSnapshot: Boolean(modal?.querySelector('[data-qa-battle-initial-snapshot]')),
      hasProvenance: Boolean(modal?.querySelector('[data-qa-battle-provenance]')),
      hasRoundSummary: Boolean(modal?.querySelector('.battle-round-summary-v1')),
      hasRoundLog: Boolean(roundLog),
      roundCount: rounds.length,
      hasComposition: Boolean(modal?.querySelector('[data-qa-battle-composition]')),
      hasOutcome: Boolean(modal?.querySelector('[data-qa-battle-outcome]')),
      hasOutcomeBeforeAfter: outcomeStateHeader.includes('БЫЛО') && outcomeStateHeader.includes('ОСТАЛОСЬ'),
      outcomeBeforeRoundLog: Boolean(outcome && roundLog && (outcome.compareDocumentPosition(roundLog) & 4)),
      internalScroll: Boolean(scroll && scroll.scrollHeight > scroll.clientHeight),
      internalHorizontalOverflow: Boolean(scroll && scroll.scrollWidth > scroll.clientWidth + 2),
      technicalText: /CONFIRMED|INFERRED|NOT CALIBRATED|REPLAYABLE|SNAPSHOT|CALIBRATION|PRODUCTION|SHARED|INDEPENDENT|ПРОФИЛЬ И ВОСПРОИЗВОДИМОСТЬ|RAW|МИТИГАЦИЯ|МАТЧАП/i.test(text),
      bodyLocked: document.body.style.overflow === 'hidden',
      stageInert: Boolean(document.querySelector('.stage')?.inert),
      focusableCount: focusables.length,
    };
  })()`);
}

async function measureBattleSceneGeometry(win) {
  return win.webContents.executeJavaScript(`(() => {
    const modal = document.querySelector('[role="dialog"][data-qa-battle-report-modal]');
    const scenes = Array.from(modal?.querySelectorAll('[data-qa-battle-scene]') || []);
    const firstScene = scenes.find((scene) => scene.getAttribute('data-qa-battle-scene') === '1') || scenes[0];
    const fiveRowScene = scenes.find((scene) => scene.getAttribute('data-qa-battle-scene') === '5') || scenes[scenes.length - 1];
    const firstFleetZones = Array.from(firstScene?.querySelectorAll('.battle-scene-fleet-grid-v1 > .battle-scene-side-v1 > .battle-scene-zone-v1') || []);
    const fiveFleetZones = Array.from(fiveRowScene?.querySelectorAll('.battle-scene-fleet-grid-v1 > .battle-scene-side-v1 > .battle-scene-zone-v1') || []);
    const simpleRect = (node) => node ? (() => {
      const rect = node.getBoundingClientRect();
      return { top: rect.top, height: rect.height };
    })() : null;
    const fleetBeforeDefense = simpleRect(firstScene?.querySelector('.battle-scene-fleet-field-v1'));
    const appendCopies = (zone, template, count) => {
      if (!zone || !template) return;
      while (zone.children.length < count) zone.appendChild(template.cloneNode(true));
    };

    const targetStacksPerZone = window.innerWidth > 1100 ? 25 : window.innerWidth > 560 ? 15 : 10;
    fiveFleetZones.forEach((zone, index) => appendCopies(zone, zone.firstElementChild || firstFleetZones[index]?.firstElementChild || firstFleetZones[0]?.firstElementChild, targetStacksPerZone));
    const defenseZone = firstScene?.querySelector('.battle-scene-defense-zone-v1');
    appendCopies(defenseZone, defenseZone?.firstElementChild, 9);

    const readRect = (node) => {
      if (!node) return null;
      const rect = node.getBoundingClientRect();
      return {
        top: Number(rect.top.toFixed(2)),
        right: Number(rect.right.toFixed(2)),
        bottom: Number(rect.bottom.toFixed(2)),
        left: Number(rect.left.toFixed(2)),
        width: Number(rect.width.toFixed(2)),
        height: Number(rect.height.toFixed(2)),
      };
    };
    const rowTops = (rects) => rects.reduce((rows, rect) => {
      if (!rows.some((top) => Math.abs(top - rect.top) < 2)) rows.push(rect.top);
      return rows;
    }, []);
    const closeEnough = (left, right, tolerance = 2) => Number.isFinite(left) && Number.isFinite(right) && Math.abs(left - right) <= tolerance;
    const relativeAnchor = (inner, outer) => inner && outer ? {
      top: Number((inner.top - outer.top).toFixed(2)),
      right: Number((outer.right - inner.right).toFixed(2)),
      bottom: Number((outer.bottom - inner.bottom).toFixed(2)),
      left: Number((inner.left - outer.left).toFixed(2)),
    } : null;

    return scenes.map((scene) => {
      const space = scene.querySelector('.battle-scene-space-layer-v1');
      const fleet = scene.querySelector('.battle-scene-fleet-field-v1');
      const celestialLayer = scene.querySelector('.battle-scene-celestial-layer-v2');
      const celestialObject = scene.querySelector('.battle-scene-celestial-object-v2');
      const defense = scene.querySelector('.battle-scene-defense-zone-v1');
      const fleetStackRects = Array.from(fleet?.querySelectorAll('.battle-scene-stack-v1') || []).map(readRect);
      const defenseStackRects = Array.from(defense?.querySelectorAll('.battle-scene-stack-v1') || []).map(readRect);
      const sceneRect = readRect(scene);
      const fleetRect = readRect(fleet);
      const celestialLayerRect = readRect(celestialLayer);
      const celestialObjectRect = readRect(celestialObject);
      const fleetZones = Array.from(fleet?.querySelectorAll('.battle-scene-fleet-grid-v1 > .battle-scene-side-v1 > .battle-scene-zone-v1') || []);
      const fleetZoneRects = fleetZones.map(readRect);
      const fleetZoneRowCounts = fleetZones.map((zone) => rowTops(Array.from(zone.querySelectorAll(':scope > .battle-scene-stack-v1') || []).map(readRect)).length);
      return {
        index: scene.getAttribute('data-qa-battle-scene') || '',
        requestedFleetRows: Number.parseInt(getComputedStyle(scene).getPropertyValue('--battle-fleet-rows').trim(), 10) || 0,
        actualFleetRows: Math.max(0, ...fleetZoneRowCounts),
        scene: sceneRect,
        space: readRect(space),
        fleet: fleetRect,
        fleetBeforeDefense: scene === firstScene ? fleetBeforeDefense : null,
        fleetAfterDefense: scene === firstScene ? simpleRect(fleet) : null,
        fleetZoneRects,
        fleetZoneRowCounts,
        fleetBaselinePass: sceneRect?.width < 700 || fleetZoneRects.length >= 2 && closeEnough(fleetZoneRects[0]?.top, fleetZoneRects[1]?.top),
        celestialLayer: celestialLayerRect,
        celestialObject: celestialObjectRect,
        celestialObjectAnchor: relativeAnchor(celestialObjectRect, celestialLayerRect),
        defense: readRect(defense),
        fleetStackRects,
        defenseStackRects,
        defenseRowCount: rowTops(defenseStackRects).length,
        defenseAnchorOffset: defenseStackRects.length && celestialLayerRect
          ? Number(((window.innerWidth <= 760
            ? celestialLayerRect.bottom - Math.max(...defenseStackRects.map((rect) => rect.bottom))
            : Math.min(...defenseStackRects.map((rect) => rect.top)) - celestialLayerRect.top)).toFixed(2))
          : null,
        spaceBackgroundSize: space ? getComputedStyle(space).backgroundSize : '',
        spaceBackgroundImage: space ? getComputedStyle(space).backgroundImage : '',
        celestialObjectBackgroundSize: celestialObject ? getComputedStyle(celestialObject).backgroundSize : '',
        celestialObjectBackgroundImage: celestialObject ? getComputedStyle(celestialObject).backgroundImage : '',
        celestialLayerOverflow: celestialLayer ? getComputedStyle(celestialLayer).overflow : '',
        celestialObjectOverflow: celestialObject ? getComputedStyle(celestialObject).overflow : '',
        defensePosition: defense ? getComputedStyle(defense).position : '',
        celestialLayerDisplay: celestialLayer ? getComputedStyle(celestialLayer).display : '',
      };
    });
  })()`);
}

function almostEqual(left, right, tolerance = 2) {
  return Number.isFinite(left) && Number.isFinite(right) && Math.abs(left - right) <= tolerance;
}

function covers(outer, inner, tolerance = 2) {
  return Boolean(outer && inner)
    && outer.top <= inner.top + tolerance
    && outer.left <= inner.left + tolerance
    && outer.right >= inner.right - tolerance
    && outer.bottom >= inner.bottom - tolerance;
}

function inside(inner, outer, tolerance = 2) {
  return covers(outer, inner, tolerance);
}

function overlaps(left, right, tolerance = 0) {
  return Boolean(left && right)
    && left.left < right.right - tolerance
    && left.right > right.left + tolerance
    && left.top < right.bottom - tolerance
    && left.bottom > right.top + tolerance;
}

function assertBattleSceneGeometry(samples, label) {
  const first = samples.find((sample) => sample.actualFleetRows === 1);
  const five = samples.find((sample) => sample.actualFleetRows === 5);
  const everyScenePasses = samples.length > 0 && samples.every((sample) => {
    const celestialObjectIsSquare = Boolean(sample.celestialObject && sample.celestialObject.width > 0 && sample.celestialObject.height > 0)
      && Math.abs(sample.celestialObject.width / sample.celestialObject.height - 1) < 0.02;
    const compactViewport = Boolean(sample.scene && sample.scene.width <= 760);
    const fleetShipsStayAboveCelestial = sample.fleetStackRects.every((rect) => inside(rect, sample.fleet) && rect.bottom <= sample.celestialLayer.top + 2);
    const defenseSharesPlanetAnchor = !sample.defense
      || (inside(sample.defense, sample.celestialLayer)
        && sample.defenseAnchorOffset != null
        && sample.defenseAnchorOffset >= 0
        && sample.defenseAnchorOffset < 80
        && sample.defenseStackRects.every((rect) => inside(rect, sample.celestialLayer) && !inside(rect, sample.fleet)));
    return covers(sample.space, sample.scene)
      && inside(sample.celestialLayer, sample.scene)
      && overlaps(sample.celestialObject, sample.celestialLayer)
      && celestialObjectIsSquare
      && sample.celestialObjectAnchor?.right === (compactViewport ? 18 : -450)
      && sample.celestialObjectAnchor?.bottom === (compactViewport ? 0 : -700)
      && sample.celestialObjectBackgroundSize === 'contain'
      && sample.celestialObjectBackgroundImage.includes('battle-planet-transparent-v1')
      && sample.celestialLayerOverflow === 'hidden'
      && sample.celestialObjectOverflow === 'visible'
      && almostEqual(sample.fleet?.bottom, sample.celestialLayer?.top)
      && fleetShipsStayAboveCelestial
      && defenseSharesPlanetAnchor
      && (!sample.defense || sample.defensePosition === 'absolute')
      && sample.spaceBackgroundSize.split(',').every((size) => size.trim() === 'cover')
      && sample.spaceBackgroundImage.includes('battle-space-background-v1')
      && !sample.spaceBackgroundImage.includes('battle-bg-approved-candidate')
      && !sample.celestialObjectBackgroundImage.includes('battle-bg-approved-candidate');
  });
  const fleetRowsGrow = Boolean(first && five && five.fleet && first.fleet)
    && five.fleet.height > first.fleet.height + 100;
  const fleetRowsAreReal = Boolean(first && five)
    && first.actualFleetRows === 1
    && five.actualFleetRows === 5
    && five.fleetZoneRowCounts.every((count) => count === 5);
  const celestialSizeStable = Boolean(first && five && first.celestialLayer && five.celestialLayer && first.celestialObject && five.celestialObject)
    && almostEqual(first.celestialLayer.width, five.celestialLayer.width)
    && almostEqual(first.celestialLayer.height, five.celestialLayer.height)
    && almostEqual(first.celestialObject.width, five.celestialObject.width)
    && almostEqual(first.celestialObject.height, five.celestialObject.height)
    && JSON.stringify(first.celestialObjectAnchor) === JSON.stringify(five.celestialObjectAnchor);
  const commonFleetBaseline = Boolean(first?.fleetBaselinePass);
  const defenseDoesNotAffectFleet = Boolean(first?.fleetBeforeDefense && first?.fleetAfterDefense)
    && almostEqual(first.fleetBeforeDefense.top, first.fleetAfterDefense.top)
    && almostEqual(first.fleetBeforeDefense.height, first.fleetAfterDefense.height);
  const multipleDefenseRows = Boolean(first && first.defenseRowCount >= 3);
  if (!first || !five || !everyScenePasses || !fleetRowsGrow || !fleetRowsAreReal || !celestialSizeStable || !commonFleetBaseline || !defenseDoesNotAffectFleet || !multipleDefenseRows) {
    throw new Error(`Battle scene layer geometry contract failed at ${label}: ${JSON.stringify({ samples, first, five, everyScenePasses, fleetRowsGrow, fleetRowsAreReal, celestialSizeStable, commonFleetBaseline, defenseDoesNotAffectFleet, multipleDefenseRows })}`);
  }
  return { samples, fleetRowsGrow, fleetRowsAreReal, celestialSizeStable, commonFleetBaseline, defenseDoesNotAffectFleet, multipleDefenseRows };
}

async function positionBattleScene(win, roundIndex) {
  await win.webContents.executeJavaScript(`(() => {
    const scroll = document.querySelector('[role="dialog"][data-qa-battle-report-modal] .battle-report-modal-scroll-v1');
    const scene = document.querySelector('[role="dialog"][data-qa-battle-report-modal] [data-qa-battle-scene="${roundIndex}"]');
    if (scroll && scene) scroll.scrollTop = Math.max(0, scroll.scrollTop + scene.getBoundingClientRect().top - scroll.getBoundingClientRect().top - 16);
  })()`);
  await settle(win);
}

async function setBattleSceneMode(win, mode) {
  return win.webContents.executeJavaScript(`(() => {
    const scene = document.querySelector('[role="dialog"][data-qa-battle-report-modal] [data-qa-battle-scene="1"]');
    if (!scene) return null;
    scene.setAttribute('data-qa-battle-celestial-mode', ${JSON.stringify(mode)});
    const layer = scene.querySelector('.battle-scene-celestial-layer-v2');
    const object = scene.querySelector('.battle-scene-celestial-object-v2');
    return {
      mode: scene.getAttribute('data-qa-battle-celestial-mode') || '',
      layerDisplay: layer ? getComputedStyle(layer).display : '',
      objectBackgroundImage: object ? getComputedStyle(object).backgroundImage : '',
      sceneHeight: scene.getBoundingClientRect().height,
    };
  })()`);
}

async function captureBattleCelestialModes(win, directory) {
  const modes = {};
  for (const mode of ['planet', 'sun', 'clean-space']) {
    const snapshot = await setBattleSceneMode(win, mode);
    await positionBattleScene(win, 1);
    await capture(win, directory, `battle-report-scene-1-row-${mode}`);
    modes[mode] = snapshot;
  }
  await setBattleSceneMode(win, 'planet');
  await positionBattleScene(win, 1);
  const planet = modes.planet;
  const sun = modes.sun;
  const cleanSpace = modes['clean-space'];
  if (!planet || !sun || !cleanSpace
      || planet.layerDisplay !== 'block'
      || sun.layerDisplay !== 'block'
      || !planet.objectBackgroundImage.includes('battle-planet-transparent-v1')
      || !sun.objectBackgroundImage.includes('battle-sun-transparent-v1')
      || cleanSpace.layerDisplay !== 'none'
      || !Number.isFinite(planet.sceneHeight)
      || !Number.isFinite(sun.sceneHeight)
      || cleanSpace.sceneHeight >= planet.sceneHeight) {
    throw new Error(`Battle celestial mode contract failed: ${JSON.stringify(modes)}`);
  }
  return modes;
}

async function exerciseRoundAnalysis(win) {
  return win.webContents.executeJavaScript(`(() => {
    const modal = document.querySelector('[role="dialog"][data-qa-battle-report-modal]');
    const scroll = modal?.querySelector('.battle-report-modal-scroll-v1');
    const details = modal?.querySelector('[data-qa-battle-round-analysis="1"]');
    const summary = details?.querySelector('summary');
    if (!scroll || !details || !summary) return { available: false };
    scroll.scrollTop = Math.min(120, Math.max(0, scroll.scrollHeight - scroll.clientHeight));
    const before = scroll.scrollTop;
    summary.click();
    return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => {
      const after = scroll.scrollTop;
      const expanded = details.open;
      const eventCardCount = details.querySelectorAll('[data-qa-battle-event]').length;
      summary.click();
      resolve({ available: true, before, after, delta: Number((after - before).toFixed(2)), expanded, eventCardCount });
    })));
  })()`);
}

async function exerciseFocusTrapAndEscape(win) {
  return win.webContents.executeJavaScript(`(() => {
    const modal = document.querySelector('[role="dialog"][data-qa-battle-report-modal]');
    const focusables = Array.from(modal?.querySelectorAll('button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), summary, [tabindex]:not([tabindex="-1"])') || []);
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    last?.focus();
    last?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
    const wrappedToFirst = document.activeElement === first;
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    return { wrappedToFirst };
  })()`);
}

async function exerciseSimulatorModalFlow(win) {
  const backToFleet = await win.webContents.executeJavaScript(`(() => {
    const button = document.querySelector('.battle-back-v1');
    if (!button) return false;
    button.click();
    return true;
  })()`);
  if (!backToFleet) throw new Error('Battle view back button not found before simulator QA');
  await waitFor(win, `document.querySelector('[data-qa-fleet-section="simulator"]')`);

  const opened = await win.webContents.executeJavaScript(`(() => {
    const button = document.querySelector('[data-qa-fleet-section="simulator"]');
    if (!button) return false;
    button.click();
    return true;
  })()`);
  if (!opened) throw new Error('Simulator fleet section not found');
  await waitFor(win, `document.querySelector('.simulator-view-v1')`);
  const attackerAdded = await win.webContents.executeJavaScript(`(() => {
    const button = document.querySelector('#sim-attacker-ships [data-qa-simulator-unit="scout"] button[aria-label^="Увеличить"]');
    if (!button) return false;
    button.click();
    return true;
  })()`);
  if (!attackerAdded) throw new Error('Simulator attacker unit control not available');
  await settle(win);
  const defenderAdded = await win.webContents.executeJavaScript(`(() => {
    const button = document.querySelector('#sim-defender-ships [data-qa-simulator-unit="scout"] button[aria-label^="Увеличить"]');
    if (!button) return false;
    button.click();
    return true;
  })()`);
  if (!defenderAdded) throw new Error('Simulator defender unit control not available');
  await settle(win);

  const run = await win.webContents.executeJavaScript(`(() => {
    const button = document.querySelector('.sim-run-v1');
    if (!button || button.disabled) return false;
    button.click();
    return true;
  })()`);
  if (!run) {
    const state = await win.webContents.executeJavaScript(`(() => ({
      disabled: Boolean(document.querySelector('.sim-run-v1')?.disabled),
      notice: document.querySelector('.sim-validation-v1')?.textContent?.replace(/\\s+/g, ' ').trim() || '',
      attackerUnits: document.querySelector('#sim-attacker-ships')?.textContent?.match(/Выбрано: [^\\n]+/)?.[0] || '',
      defenderUnits: document.querySelector('#sim-defender-ships')?.textContent?.match(/Выбрано: [^\\n]+/)?.[0] || '',
      attackerButtons: Array.from(document.querySelectorAll('#sim-attacker-ships button[aria-label^="Увеличить"]')).slice(0, 2).map((button) => ({ disabled: button.disabled, label: button.getAttribute('aria-label') || '' })),
      defenderButtons: Array.from(document.querySelectorAll('#sim-defender-ships button[aria-label^="Увеличить"]')).slice(0, 2).map((button) => ({ disabled: button.disabled, label: button.getAttribute('aria-label') || '' })),
      attackerInputs: Array.from(document.querySelectorAll('#sim-attacker-ships input[type="number"]')).slice(0, 2).map((input) => ({ value: input.value, disabled: input.disabled })),
      defenderInputs: Array.from(document.querySelectorAll('#sim-defender-ships input[type="number"]')).slice(0, 2).map((input) => ({ value: input.value, disabled: input.disabled })),
    }))()`);
    throw new Error(`Simulator run button did not become enabled: ${JSON.stringify(state)}`);
  }
  await waitFor(win, `document.querySelector('[role="dialog"][data-qa-battle-report-modal][data-qa-battle-report-source="simulation"]')`);
  await settle(win);

  const simulationModal = await modalSnapshot(win);
  const simulationPresentation = await win.webContents.executeJavaScript(`(() => {
    const modal = document.querySelector('[role="dialog"][data-qa-battle-report-source="simulation"]');
    const text = modal?.textContent || '';
    return {
      source: modal?.getAttribute('data-qa-battle-report-source') || '',
      hasSaveButton: Boolean(modal?.querySelector('[data-qa-battle-save-simulation]')),
      hasGenericAttacker: text.includes('Атакующий'),
      hasGenericDefender: text.includes('Защитник'),
      hasTechnicalLabels: /CONFIRMED|INFERRED|NOT CALIBRATED|REPLAYABLE|SNAPSHOT|CALIBRATION|PRODUCTION|SHARED|INDEPENDENT|ПРОФИЛЬ И ВОСПРОИЗВОДИМОСТЬ/i.test(text),
      hasInlineResult: Boolean(document.querySelector('.sim-result-v1')),
    };
  })()`);
  if (!simulationModal.present || simulationModal.hasVisualReport || simulationModal.hasInitialSnapshot || simulationModal.hasProvenance || simulationModal.hasRoundSummary || !simulationModal.hasRoundLog || simulationModal.roundCount < 1 || simulationModal.internalHorizontalOverflow || simulationPresentation.source !== 'simulation' || simulationPresentation.hasSaveButton || simulationPresentation.hasTechnicalLabels || !simulationPresentation.hasGenericAttacker || !simulationPresentation.hasGenericDefender || simulationPresentation.hasInlineResult) {
    throw new Error(`Simulator modal contract failed: ${JSON.stringify({ simulationModal, simulationPresentation })}`);
  }

  const beforeCloseState = await win.webContents.executeJavaScript(`(() => {
    try {
      const state = JSON.parse(localStorage.getItem(${JSON.stringify(SAVE_KEY)}) || '{}');
      return {
        reportIds: state.combat?.reports?.map((report) => report.id) || [],
        savedReportIds: state.combat?.savedReportIds || [],
      };
    } catch { return { reportIds: [], savedReportIds: [] }; }
  })()`);

  await win.webContents.executeJavaScript(`document.querySelector('.battle-report-modal-close-v1')?.click()`);
  await waitFor(win, `!document.querySelector('[role="dialog"][data-qa-battle-report-modal]')`);
  await settle(win);
  const afterCloseState = await win.webContents.executeJavaScript(`(() => {
    let state = {};
    try { state = JSON.parse(localStorage.getItem(${JSON.stringify(SAVE_KEY)}) || '{}'); } catch {}
    const attackerInputs = Array.from(document.querySelectorAll('#sim-attacker-ships input[type="number"]'));
    const defenderInputs = Array.from(document.querySelectorAll('#sim-defender-ships input[type="number"]'));
    return {
      reportIds: state.combat?.reports?.map((report) => report.id) || [],
      savedReportIds: state.combat?.savedReportIds || [],
      hasInlineResult: Boolean(document.querySelector('.sim-result-v1')),
      attackerSelected: attackerInputs.some((input) => Number(input.value) > 0),
      defenderSelected: defenderInputs.some((input) => Number(input.value) > 0),
    };
  })()`);
  if (JSON.stringify(beforeCloseState) !== JSON.stringify({ reportIds: afterCloseState.reportIds, savedReportIds: afterCloseState.savedReportIds }) || afterCloseState.hasInlineResult || !afterCloseState.attackerSelected || !afterCloseState.defenderSelected) {
    throw new Error(`Simulator isolation contract failed: ${JSON.stringify({ beforeCloseState, afterCloseState })}`);
  }

  const rerun = await win.webContents.executeJavaScript(`(() => {
    const button = document.querySelector('.sim-run-v1');
    if (!button || button.disabled) return false;
    button.click();
    return true;
  })()`);
  if (!rerun) throw new Error('Simulator rerun button not available after closing result');
  await waitFor(win, `document.querySelector('[role="dialog"][data-qa-battle-report-source="simulation"]')`);
  await settle(win);
  await win.webContents.executeJavaScript(`document.querySelector('.battle-report-modal-close-v1')?.click()`);
  await waitFor(win, `!document.querySelector('[role="dialog"][data-qa-battle-report-modal]')`);
  return { simulationModal, simulationPresentation, beforeCloseState, afterCloseState, rerun: true };
}

async function runViewport(win, width, height) {
  const label = `${width}x${height}`;
  const directory = path.join(OUTPUT, label);
  fs.mkdirSync(directory, { recursive: true });
  win.setContentSize(width, height);
  await settle(win);
  await win.webContents.executeJavaScript(`localStorage.removeItem(${JSON.stringify(SAVE_KEY)}); localStorage.removeItem('asterion.preferences.v2');`);
  await reload(win);
  await clickPrimary(win, 'fleets', `document.querySelector('[data-qa-fleet-section="battles"]')`);
  await clickBattleSection(win);

  const list = await listSnapshot(win);
  if (list.cardCount !== 3 || list.collapsedCardCount !== 3 || list.cardLossCount !== 6 || list.openButtonCount !== 3 || list.resultIconCount !== 3 || JSON.stringify(list.resultLabels) !== JSON.stringify(['ПОБЕДА', 'ПОРАЖЕНИЕ', 'НИЧЬЯ']) || list.rootHorizontalOverflow || list.bodyHorizontalOverflow) {
    throw new Error(`Battle list contract failed at ${label}: ${JSON.stringify(list)}`);
  }

  await openBattle(win, 'battle-demo-attacker-victory');
  const modal = await modalSnapshot(win);
  if (!modal.present || modal.ariaModal !== 'true' || !modal.labelledBy || modal.roundCount !== 5 || modal.analysisOpenCount !== 0 || !modal.hasOverallLosses || !modal.hasHeaderTable || modal.headerAvatarCount !== 2 || modal.technologyRowCount < 1 || modal.technologyTooltipCount !== modal.technologyRowCount || modal.technologyTooltipImageCount < modal.technologyRowCount || !modal.visibleTechnologyLevel || !modal.technologyRowsFocusable || modal.eventCardCount < 1 || !modal.hasBattlePoints || modal.hasVisualReport || modal.hasInitialSnapshot || modal.hasProvenance || modal.hasRoundSummary || !modal.hasRoundLog || !modal.hasComposition || !modal.hasOutcome || !modal.hasOutcomeBeforeAfter || !modal.outcomeBeforeRoundLog || !modal.internalScroll || modal.internalHorizontalOverflow || modal.technicalText || !modal.bodyLocked || !modal.stageInert) {
    throw new Error(`Battle modal contract failed at ${label}: ${JSON.stringify(modal)}`);
  }
  await capture(win, directory, 'battle-report-modal');
  await win.webContents.executeJavaScript(`(() => {
    const scroll = document.querySelector('[role="dialog"][data-qa-battle-report-modal] .battle-report-modal-scroll-v1');
    const outcome = scroll?.querySelector('[data-qa-battle-outcome]');
    if (scroll && outcome) scroll.scrollTop = Math.max(0, outcome.offsetTop - 16);
  })()`);
  await settle(win);
  await capture(win, directory, 'battle-report-outcome');
  const bottom = await win.webContents.executeJavaScript(`(() => {
    const scroll = document.querySelector('[role="dialog"][data-qa-battle-report-modal] .battle-report-modal-scroll-v1');
    if (!scroll) return { atBottom: false, backButtonVisible: false };
    scroll.scrollTop = scroll.scrollHeight;
    const backButton = scroll.querySelector('.battle-modal-back-v1');
    const rect = backButton?.getBoundingClientRect();
    return {
      atBottom: scroll.scrollTop >= scroll.scrollHeight - scroll.clientHeight - 2,
      backButtonVisible: Boolean(rect && rect.top >= 0 && rect.bottom <= window.innerHeight),
    };
  })()`);
  await settle(win);
  if (!bottom.atBottom || !bottom.backButtonVisible) throw new Error(`Battle modal bottom scroll contract failed at ${label}: ${JSON.stringify(bottom)}`);

  const analysis = await exerciseRoundAnalysis(win);
  await settle(win);
  if (!analysis.available || !analysis.expanded || analysis.eventCardCount < 1 || Math.abs(analysis.delta) > 1) {
    throw new Error(`Battle round analysis contract failed at ${label}: ${JSON.stringify(analysis)}`);
  }

  const focus = await exerciseFocusTrapAndEscape(win);
  await waitFor(win, `!document.querySelector('[role="dialog"][data-qa-battle-report-modal]')`);
  const closeState = await win.webContents.executeJavaScript(`(() => ({
    stageInert: Boolean(document.querySelector('.stage')?.inert),
    bodyLocked: document.body.style.overflow === 'hidden',
    restoredTrigger: document.activeElement?.getAttribute('data-qa-battle-open') || '',
  }))()`);
  if (!focus.wrappedToFirst || closeState.stageInert || closeState.bodyLocked || closeState.restoredTrigger !== 'battle-demo-attacker-victory') {
    throw new Error(`Battle modal focus/escape contract failed at ${label}: ${JSON.stringify({ focus, closeState })}`);
  }

  await openBattle(win, 'battle-demo-round-limit-draw');
  const transition = await win.webContents.executeJavaScript(`(() => {
    const modal = document.querySelector('[role="dialog"][data-qa-battle-report-modal]');
    const lastRound = modal?.querySelector('[data-qa-battle-round="5"]');
    const firstRound = modal?.querySelector('[data-qa-battle-round="1"]');
    return {
    firstRoundBeforeState: Boolean(firstRound?.textContent?.includes('До действий')),
    firstRoundAfterState: Boolean(firstRound?.textContent?.includes('после действий')),
    secondRoundPresent: Boolean(modal?.querySelector('[data-qa-battle-round="2"]')),
    lastRoundPresent: Boolean(lastRound),
    hasActionsSummary: Boolean(lastRound?.querySelector('.battle-round-action-v1')),
  };
  })()`);
  if (!transition.firstRoundBeforeState || !transition.firstRoundAfterState || !transition.secondRoundPresent || !transition.lastRoundPresent || !transition.hasActionsSummary) {
    throw new Error(`Battle snapshot transition contract failed at ${label}: ${JSON.stringify(transition)}`);
  }
  await win.webContents.executeJavaScript(`(() => {
    const scroll = document.querySelector('[role="dialog"][data-qa-battle-report-modal] .battle-report-modal-scroll-v1');
    const roundLog = scroll?.querySelector('[data-qa-battle-round-log]');
    if (scroll && roundLog) scroll.scrollTop = Math.max(0, roundLog.offsetTop - 16);
  })()`);
  await settle(win);
  await capture(win, directory, 'battle-report-round-log');

  await win.webContents.executeJavaScript(`document.querySelector('.battle-report-modal-close-v1')?.click()`);
  await waitFor(win, `!document.querySelector('[role="dialog"][data-qa-battle-report-modal]')`);
  const simulator = await exerciseSimulatorModalFlow(win);
  return { viewport: label, list, modal, analysis, focus, closeState, transition, bottom, simulator };
}

app.whenReady().then(async () => {
  let win;
  try {
    fs.rmSync(OUTPUT, { recursive: true, force: true });
    fs.mkdirSync(OUTPUT, { recursive: true });
    win = new BrowserWindow({
      width: 1440,
      height: 900,
      useContentSize: true,
      show: false,
      backgroundColor: '#02050a',
      webPreferences: { offscreen: true, contextIsolation: true, nodeIntegration: false, sandbox: true, partition: 'qa-battle-reports' },
    });
    await win.loadFile(path.join(ROOT, 'dist', 'index.html'));
    const results = [];
    for (const [width, height] of VIEWPORTS) results.push(await runViewport(win, width, height));
    fs.writeFileSync(path.join(OUTPUT, 'results.json'), JSON.stringify({ results, screenshotsSkipped: skipScreenshots }, null, 2));
    console.log('Battle report QA passed: list losses, population ledgers, readable technology rows, text round log, simulator isolation, focus trap, Escape restoration, mobile overflow, rewards and round transitions.');
    win.destroy();
    app.exit(0);
  } catch (error) {
    console.error(error);
    win?.destroy();
    app.exit(1);
  }
});
