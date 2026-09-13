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
    const scenes = Array.from(modal?.querySelectorAll('[data-qa-battle-scene]') || []);
    const backdrops = Array.from(modal?.querySelectorAll('.battle-scene-backdrop-v1') || []);
    const outcome = modal?.querySelector('[data-qa-battle-outcome]');
    const visual = modal?.querySelector('[data-qa-battle-visual-report]');
    const focusables = Array.from(modal?.querySelectorAll('button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), summary, [tabindex]:not([tabindex="-1"])') || []);
    const technologyRows = Array.from(modal?.querySelectorAll('.battle-tech-table-row-v1') || []);
    const layoutNodes = Array.from(modal?.querySelectorAll('.battle-stack-row-v1, .battle-scene-v1, .battle-scene-fleet-field-v1, .battle-scene-planet-deck-v1, .battle-scene-zone-v1, .battle-scene-defense-zone-v1') || []);
    const tooltipClips = Array.from(modal?.querySelectorAll('.battle-scene-stack-v1') || []).reduce((count, stack) => {
      const tooltip = stack.querySelector('.battle-scene-tooltip-v1');
      if (!tooltip || !scroll) return count;
      const previousVisibility = tooltip.style.visibility;
      const previousOpacity = tooltip.style.opacity;
      tooltip.style.visibility = 'visible';
      tooltip.style.opacity = '1';
      const tooltipRect = tooltip.getBoundingClientRect();
      const scrollRect = scroll.getBoundingClientRect();
      tooltip.style.visibility = previousVisibility;
      tooltip.style.opacity = previousOpacity;
      return count + (tooltipRect.left < scrollRect.left - 1 || tooltipRect.right > scrollRect.right + 1 ? 1 : 0);
    }, 0);
    return {
      present: Boolean(modal),
      ariaModal: modal?.getAttribute('aria-modal') || '',
      labelledBy: modal?.getAttribute('aria-labelledby') || '',
      sceneCount: scenes.length,
      backdropCount: backdrops.length,
      backdropBackgroundSizes: backdrops.map((node) => getComputedStyle(node).backgroundSize),
      analysisOpenCount: modal?.querySelectorAll('[data-qa-battle-round-analysis][open]').length || 0,
      cellSizes: scenes.map((scene) => scene.getAttribute('data-qa-battle-cell-size') || ''),
      hasOverallLosses: Boolean(modal?.querySelector('[data-qa-battle-summary]')),
      hasHeaderTable: Boolean(modal?.querySelector('[data-qa-battle-unit-table]')),
      headerAvatarCount: modal?.querySelectorAll('[data-qa-battle-side-avatar]').length || 0,
      technologyRowCount: technologyRows.length,
      technologyTooltipCount: modal?.querySelectorAll('.battle-tech-tooltip-v1').length || 0,
      technologyTooltipImageCount: modal?.querySelectorAll('.battle-tech-tooltip-row-v1 img').length || 0,
      visibleTechnologyLevel: technologyRows.some((row) => (row.querySelector(':scope > span')?.textContent || '').toLowerCase().includes('уровень')),
      technologyRowsFocusable: technologyRows.every((row) => row.tabIndex >= 0),
      hasBattlePoints: Boolean(modal?.querySelector('[data-qa-battle-points]')),
      hasVisualAnchor: Boolean(modal?.querySelector('[data-qa-battle-visual-anchor]')),
      hasComposition: Boolean(modal?.querySelector('[data-qa-battle-composition]')),
      hasOutcome: Boolean(modal?.querySelector('[data-qa-battle-outcome]')),
      outcomeBeforeVisual: Boolean(outcome && visual && (outcome.compareDocumentPosition(visual) & 4)),
      internalScroll: Boolean(scroll && scroll.scrollHeight > scroll.clientHeight),
      internalHorizontalOverflow: Boolean(scroll && scroll.scrollWidth > scroll.clientWidth + 2),
      layoutOverflowCount: layoutNodes.filter((node) => node.scrollWidth > node.clientWidth + 2).length,
      tooltipHorizontalClips: tooltipClips,
      bodyLocked: document.body.style.overflow === 'hidden',
      stageInert: Boolean(document.querySelector('.stage')?.inert),
      focusableCount: focusables.length,
    };
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
    const button = document.querySelector('#sim-attacker-ships button[aria-label^="Увеличить"]');
    if (!button) return false;
    button.click();
    return true;
  })()`);
  if (!attackerAdded) throw new Error('Simulator attacker unit control not available');
  await settle(win);
  const defenderAdded = await win.webContents.executeJavaScript(`(() => {
    const button = document.querySelector('#sim-defender-ships button[aria-label^="Увеличить"]');
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
      hasSaveButton: Boolean(modal?.querySelector('.battle-save-v1')),
      hasGenericAttacker: text.includes('Атакующий'),
      hasGenericDefender: text.includes('Защитник'),
      hasInlineResult: Boolean(document.querySelector('.sim-result-v1')),
    };
  })()`);
  if (!simulationModal.present || simulationModal.sceneCount < 1 || simulationModal.internalHorizontalOverflow || simulationPresentation.source !== 'simulation' || simulationPresentation.hasSaveButton || !simulationPresentation.hasGenericAttacker || !simulationPresentation.hasGenericDefender || simulationPresentation.hasInlineResult) {
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
  if (!modal.present || modal.ariaModal !== 'true' || !modal.labelledBy || modal.sceneCount !== 5 || modal.backdropCount !== modal.sceneCount || modal.backdropBackgroundSizes.some((value) => value.split(',').some((size) => size.trim() !== 'cover')) || modal.analysisOpenCount !== 0 || modal.cellSizes.some((value) => value !== '100px') || !modal.hasOverallLosses || !modal.hasHeaderTable || modal.headerAvatarCount !== 2 || modal.technologyRowCount !== 16 || modal.technologyTooltipCount !== 16 || modal.technologyTooltipImageCount !== 24 || modal.visibleTechnologyLevel || !modal.technologyRowsFocusable || !modal.hasBattlePoints || modal.hasVisualAnchor || !modal.hasComposition || !modal.hasOutcome || !modal.outcomeBeforeVisual || !modal.internalScroll || modal.internalHorizontalOverflow || modal.layoutOverflowCount !== 0 || modal.tooltipHorizontalClips !== 0 || !modal.bodyLocked || !modal.stageInert) {
    throw new Error(`Battle modal contract failed at ${label}: ${JSON.stringify(modal)}`);
  }
  await capture(win, directory, 'battle-report-modal');

  await win.webContents.executeJavaScript(`(() => {
    const scroll = document.querySelector('[role="dialog"][data-qa-battle-report-modal] .battle-report-modal-scroll-v1');
    const scene = scroll?.querySelector('[data-qa-battle-scene]');
    if (scroll && scene) scroll.scrollTop = Math.max(0, scene.offsetTop - 16);
  })()`);
  await settle(win);
  await capture(win, directory, 'battle-report-scene');
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
    const tooltipText = Array.from(modal?.querySelectorAll('.battle-scene-tooltip-v1') || []).map((node) => node.textContent || '').join(' ');
    const lastRound = modal?.querySelector('[data-qa-battle-round="5"]');
    return {
    firstRoundSpyCount: document.querySelector('[data-qa-battle-round="1"] [data-qa-battle-stack="spy-probe"]')?.getAttribute('data-qa-battle-stack-count') || '',
    secondRoundSpyPresent: Boolean(document.querySelector('[data-qa-battle-round="2"] [data-qa-battle-stack="spy-probe"]')),
    missingDataText: Boolean(lastRound?.querySelector('.battle-scene-empty-v1')) || /ОБОРОНА НЕ ЗАФИКСИРОВАНА|Оборона не зафиксирована/.test(lastRound?.textContent || ''),
    tooltipHasQuantity: tooltipText.includes('Количество'),
  };
  })()`);
  if (transition.firstRoundSpyCount !== '6' || transition.secondRoundSpyPresent || transition.missingDataText || transition.tooltipHasQuantity) {
    throw new Error(`Battle snapshot transition contract failed at ${label}: ${JSON.stringify(transition)}`);
  }
  await capture(win, directory, 'battle-report-snapshot-transition');

  await win.webContents.executeJavaScript(`document.querySelector('.battle-report-modal-close-v1')?.click()`);
  await waitFor(win, `!document.querySelector('[role="dialog"][data-qa-battle-report-modal]')`);
  const simulator = await exerciseSimulatorModalFlow(win);
  return { viewport: label, list, modal, focus, closeState, transition, bottom, simulator };
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
    fs.writeFileSync(path.join(OUTPUT, 'results.json'), JSON.stringify({ results }, null, 2));
    console.log('Battle report QA passed: list losses, accessible scrollable modal, static all-round scenes, 100px cell contract, focus trap, Escape restoration, mobile overflow, rewards and snapshot transitions.');
    win.destroy();
    app.exit(0);
  } catch (error) {
    console.error(error);
    win?.destroy();
    app.exit(1);
  }
});
