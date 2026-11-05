const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');
const { editSaveIdle } = require('./qa-save-edit.cjs');

app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-gpu');
app.on('window-all-closed', () => {});

const ROOT = path.join(__dirname, '..');
const OUTPUT = process.env.ASTERION_QA_OUTPUT || path.join(ROOT, 'artifacts-pass1', 'combat-simulator-qa');
const SAVE_KEY = 'asterion.vertical-slice.test.v1';
const VIEWPORTS = [[1920, 1080], [1280, 720]];
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

async function click(win, selector) {
  const clicked = await win.webContents.executeJavaScript(`(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    if (!element) return false;
    element.click();
    return true;
  })()`);
  if (!clicked) throw new Error(`Element not found: ${selector}`);
  await settle(win);
}

async function clickAll(win, selector) {
  await win.webContents.executeJavaScript(`document.querySelectorAll(${JSON.stringify(selector)}).forEach((element) => element.click())`);
  await settle(win);
}

async function setField(win, selector, value) {
  const changed = await win.webContents.executeJavaScript(`(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    if (!element) return false;
    const prototype = element instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
    setter?.call(element, ${JSON.stringify(String(value))});
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  })()`);
  if (!changed) throw new Error(`Field not found: ${selector}`);
  await settle(win);
}

async function openSimulator(win) {
  await click(win, '[data-qa-navigation="primary"] [data-qa-route="fleets"]');
  await waitFor(win, `document.querySelector('.fleet-workspace-v1')`);
  await click(win, '[data-qa-fleet-section="simulator"]');
  await waitFor(win, `document.querySelector('.simulator-view-v1')`);
  await settle(win);
}

async function readSave(win) {
  return win.webContents.executeJavaScript(`(() => {
    try { return JSON.parse(localStorage.getItem(${JSON.stringify(SAVE_KEY)}) || '{}'); } catch { return {}; }
  })()`);
}

async function simulatorPresetDiagnostics(win) {
  return win.webContents.executeJavaScript(`(() => {
    let save = {};
    try { save = JSON.parse(localStorage.getItem(${JSON.stringify(SAVE_KEY)}) || '{}'); } catch (error) { return { storageError: String(error) }; }
    return {
      presets: (save.combatSimulator?.presets || []).map(({ id, name }) => ({ id, name })),
      inputName: document.querySelector('#sim-preset-name')?.value || '',
      selectedPresetId: document.querySelector('#sim-preset-select')?.value || '',
      options: Array.from(document.querySelectorAll('#sim-preset-select option')).map((option) => ({ value: option.value, text: option.textContent?.trim() || '' })),
      saveButton: document.querySelector('[data-qa-sim-save]')?.textContent?.trim() || '',
      notice: document.querySelector('.simx-notice')?.textContent?.replace(/\\s+/g, ' ').trim() || '',
    };
  })()`);
}

async function capture(win, directory, name) {
  const image = await win.webContents.capturePage();
  fs.writeFileSync(path.join(directory, `${name}.png`), image.toPNG());
}

async function snapshot(win) {
  return win.webContents.executeJavaScript(`(() => {
    const root = document.documentElement;
    const side = (name) => document.querySelector('[data-qa-sim-side="' + name + '"]');
    const firstTech = side('attacker')?.querySelector('.simx-tech');
    const firstShip = side('attacker')?.querySelector('[data-qa-simulator-unit="scout"]');
    const attackerCommanders = document.querySelector('#sim-attacker-commanders');
    const defenderDefenses = document.querySelector('#sim-defender-defenses');
    const leadingCommander = document.querySelector('#sim-leading-commander-attacker');
    const inWindow = (element) => { const rect = element?.getBoundingClientRect(); return Boolean(rect) && rect.width > 0 && rect.top >= 0 && rect.bottom <= window.innerHeight + 1; };
    const visualReport = document.querySelector('[data-qa-battle-visual-report]');
    const visualRounds = Array.from(visualReport?.querySelectorAll('[data-qa-battle-visual-round]') || []);
    const roundAnalysisChecks = visualRounds.map((round) => {
      const roundIndex = round.getAttribute('data-qa-battle-visual-round') || '';
      const analyses = Array.from(round.querySelectorAll('[data-qa-battle-round-analysis]'));
      const analysis = analyses.length === 1 ? analyses[0] : null;
      const eventCount = round.querySelectorAll('[data-qa-battle-event]').length;
      const analysisEventCount = analysis?.querySelectorAll('[data-qa-battle-event]').length || 0;
      const hasEmptyState = Boolean(analysis?.querySelector('ul, p'));
      return {
        roundIndex,
        analysisCount: analyses.length,
        analysisIndex: analyses[0]?.getAttribute('data-qa-battle-round-analysis') || '',
        eventCount,
        analysisEventCount,
        hasEmptyState,
        valid: analyses.length === 1
          && analyses[0].getAttribute('data-qa-battle-round-analysis') === roundIndex
          && (eventCount > 0 ? analysisEventCount === eventCount : hasEmptyState),
      };
    });
    return {
      meters: Array.from(document.querySelectorAll('.simx-meter')).map((item) => item.textContent?.replace(/\\s+/g, ' ').trim() || ''),
      firstTech: { value: firstTech?.querySelector('input')?.value || '', max: firstTech?.querySelector('input')?.getAttribute('max') || '' },
      firstTechIncreaseDisabled: Boolean(firstTech?.querySelector('button[aria-label^="Увеличить"]')?.disabled),
      firstShipLevel: { value: firstShip?.querySelector('[data-qa-sim-level] input')?.value || '', max: firstShip?.querySelector('[data-qa-sim-level] input')?.getAttribute('max') || '' },
      firstShipLevelIncreaseDisabled: Boolean(firstShip?.querySelector('[data-qa-sim-level] button[aria-label^="Увеличить"]')?.disabled),
      maxSuffixCount: document.querySelectorAll('[data-qa-sim-level] > small').length,
      commanderCounts: Array.from(attackerCommanders?.querySelectorAll('input[aria-label^="Количество"]') || []).filter((item) => Number(item.value) > 0).map((item) => item.value),
      leadingCommander: leadingCommander?.value || '',
      technologyAssetCount: document.querySelectorAll('.simx-tech img[src]').length,
      technologyRows: document.querySelectorAll('.simx-tech').length,
      technologyOpen: document.querySelector('.simx-tech-toggle')?.getAttribute('aria-expanded') || '',
      technologyHidden: document.querySelector('#sim-attacker-technologies')?.hasAttribute('hidden') ?? false,
      defenseLevelControls: defenderDefenses?.querySelectorAll('[data-qa-sim-level]').length || 0,
      shieldLimits: ['tower-shield', 'planetary-shield'].map((id) => ({ id, max: side('defender')?.querySelector('[data-qa-simulator-unit="' + id + '"] input')?.getAttribute('max') || '' })),
      // Satellites never fly: the attacker cannot take them, the defender can (SAT-01).
      satelliteOnAttacker: Boolean(side('attacker')?.querySelector('[data-qa-simulator-add="solar-satellite"], [data-qa-simulator-unit="solar-satellite"]')),
      satelliteOnDefender: Boolean(side('defender')?.querySelector('[data-qa-simulator-add="solar-satellite"], [data-qa-simulator-unit="solar-satellite"]')),
      systemSelects: Array.from(document.querySelectorAll('.simulator-view-v1 select')).filter((item) => !item.classList.contains('game-select__native')).length,
      nativeTitles: document.querySelectorAll('.simulator-view-v1 [title]').length,
      debugControls: document.querySelectorAll('.sim-execution-v1, .sim-seed-v1, .sim-target-priority-v1').length,
      inlineResult: {
        present: Boolean(document.querySelector('[data-qa-sim-result]')),
        winner: document.querySelector('[data-qa-sim-result]')?.getAttribute('data-qa-sim-winner') || '',
        rounds: document.querySelector('[data-qa-sim-rounds]')?.textContent || '',
        verdictInWindow: inWindow(document.querySelector('.simx-verdict')),
        forcesInWindow: Array.from(document.querySelectorAll('[data-qa-sim-force]')).length === 2 && Array.from(document.querySelectorAll('[data-qa-sim-force]')).every(inWindow),
        debrisInWindow: inWindow(document.querySelector('[data-qa-sim-debris]')),
        lootInWindow: inWindow(document.querySelector('[data-qa-sim-loot]')),
        runInWindow: inWindow(document.querySelector('.sim-run-v1')),
        detailsInWindow: inWindow(document.querySelector('[data-qa-sim-details]')),
      },
      hasResult: Boolean(document.querySelector('[role="dialog"][data-qa-battle-report-modal][data-qa-battle-report-source="simulation"]')),
      hasSaveButton: Boolean(document.querySelector('[data-qa-battle-save-simulation]')),
      hasProvenance: Boolean(document.querySelector('.battle-provenance-v1')),
      hasRoundLog: Boolean(document.querySelector('[data-qa-battle-round-log]')),
      hasInitialSnapshot: Boolean(document.querySelector('[data-qa-battle-initial-snapshot]')),
      hasRoundSummary: Boolean(document.querySelector('.battle-round-summary-v1')),
      hasVisualReport: Boolean(document.querySelector('[data-qa-battle-visual-report]')),
      roundAnalysisValid: visualRounds.length > 0 && roundAnalysisChecks.every((check) => check.valid),
      roundAnalysisChecks,
      visibleTechnologyLevel: Array.from(document.querySelectorAll('.battle-tech-table-row-v1')).some((row) => (row.querySelector(':scope > span')?.textContent || '').includes('из')),
      hasComposition: Boolean(document.querySelector('[data-qa-battle-composition]')),
      hasTechnicalLabels: /CONFIRMED|INFERRED|NOT CALIBRATED|REPLAYABLE|SNAPSHOT|РЕЖИМ РАСЧЁТА|КАК ВЫБИРАТЬ ЦЕЛЬ|SHARED|INDEPENDENT|RAW|МИТИГАЦИЯ|МАТЧАП/i.test(document.body.textContent || ''),
      roundAnalysisOpen: Array.from(document.querySelectorAll('.battle-round-analysis-v1')).some((item) => item.hasAttribute('open')),
      roundAnalysisCount: document.querySelectorAll('.battle-round-analysis-v1').length,
      missingAriaControls: Array.from(document.querySelectorAll('[aria-expanded]')).filter((item) => {
        const id = item.getAttribute('aria-controls');
        return id && !document.getElementById(id);
      }).map((item) => ({ text: item.textContent?.replace(/\\s+/g, ' ').trim() || '', id: item.getAttribute('aria-controls') || '' })),
      ariaExpandedControls: Array.from(document.querySelectorAll('[aria-expanded]')).every((item) => {
        const id = item.getAttribute('aria-controls');
        return !id || Boolean(document.getElementById(id));
      }),
      unnamedControls: Array.from(document.querySelectorAll('button, input, select')).filter((item) => {
        const label = item.getAttribute('aria-label') || item.getAttribute('aria-labelledby') || item.labels?.[0]?.textContent || item.textContent;
        return !label?.replace(/\s+/g, ' ').trim();
      }).map((item) => item.outerHTML.slice(0, 160)),
      horizontalOverflow: root.scrollWidth > root.clientWidth + 2 || document.body.scrollWidth > document.body.clientWidth + 2,
      viewport: { width: window.innerWidth, height: window.innerHeight },
    };
  })()`);
}

async function runViewport(win, width, height) {
  const label = `${width}x${height}`;
  const directory = path.join(OUTPUT, label);
  fs.mkdirSync(directory, { recursive: true });
  win.setContentSize(width, height);
  await settle(win);
  // Removed while the game is not running: its unload would write the old save back (qa-save-edit.cjs).
  await editSaveIdle(win, `(() => { localStorage.removeItem(${JSON.stringify(SAVE_KEY)}); localStorage.removeItem('asterion.preferences.v2'); return true; })()`, { ready: `document.querySelector('[data-qa-navigation]') && localStorage.getItem(${JSON.stringify(SAVE_KEY)})`, label: 'reset save', commands: false });
  const resetPresets = (await readSave(win)).combatSimulator?.presets || [];
  if (resetPresets.length !== 0) throw new Error(`${label}: simulator QA storage reset did not clear presets ${JSON.stringify(await simulatorPresetDiagnostics(win))}`);
  await openSimulator(win);

  const initial = await snapshot(win);
  if (initial.meters.length !== 5 || initial.meters.some((meter) => !meter.includes('/ 35 000')) || initial.meters.some((meter) => meter.includes('25 112'))) {
    throw new Error(`${label}: independent population meter contract failed ${JSON.stringify(initial)}`);
  }
  if (initial.debugControls !== 0 || initial.unnamedControls.length || initial.horizontalOverflow || initial.satelliteOnAttacker || !initial.satelliteOnDefender || initial.systemSelects !== 0 || initial.nativeTitles !== 0) {
    throw new Error(`${label}: normal simulator controls/geometry contract failed ${JSON.stringify(initial)}`);
  }

  const attacker = '[data-qa-sim-side="attacker"]';
  const defender = '[data-qa-sim-side="defender"]';
  const add = (side, id) => click(win, `${side} [data-qa-simulator-add="${id}"]`);
  await clickAll(win, '.simx-tech-toggle');
  await waitFor(win, `document.querySelectorAll('.simx-tech').length === 20`);
  const firstTechnologySelector = `${attacker} .simx-tech:first-child input`;
  await setField(win, firstTechnologySelector, 14);
  await click(win, `${attacker} .simx-tech:first-child button[aria-label^="Увеличить"]`);
  await click(win, `#sim-attacker-ships [data-qa-simulator-add]`);
  const firstRowCount = '#sim-attacker-ships .simx-row input[aria-label^="Количество"]';
  if (!await win.webContents.executeJavaScript(`document.activeElement === document.querySelector(${JSON.stringify(firstRowCount)})`)) {
    throw new Error(`${label}: adding a unit did not put the cursor into its count`);
  }
  await setField(win, firstRowCount, 999999);
  const capped = await snapshot(win);
  if (capped.meters.some((meter) => /[0-9]{2,3} ?[0-9]{3} ?\/ ?35 000/.test(meter) && Number(meter.match(/[0-9 ]+(?=\s*\/)/)?.[0]?.replace(/\s/g, '') || 0) > 35000)) {
    throw new Error(`${label}: attacker population cap did not clamp the field ${JSON.stringify(capped)}`);
  }
  await setField(win, firstRowCount, 1);
  // An emptied count is a draft while the field has focus: the row stays, and leaves on blur.
  const emptied = await win.webContents.executeJavaScript(`(() => {
    const input = document.querySelector(${JSON.stringify(firstRowCount)});
    input.focus();
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, '');
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`);
  await settle(win);
  if (!emptied || !await win.webContents.executeJavaScript(`Boolean(document.querySelector(${JSON.stringify(firstRowCount)}))`)) throw new Error(`${label}: an emptied count removed the row while typing`);
  await setField(win, firstRowCount, 1);
  if (!await win.webContents.executeJavaScript(`Boolean(document.querySelector('[data-qa-simulator-unit="scout"]'))`)) await add(attacker, 'scout');
  await setField(win, `${attacker} [data-qa-simulator-unit="scout"] input[aria-label^="Количество"]`, 2);
  await setField(win, `${attacker} [data-qa-simulator-unit="scout"] [data-qa-sim-level] input`, 10);
  await add(attacker, 'cruiser');
  await add(defender, 'scout');
  await add(attacker, 'corsair');
  await add(attacker, 'hunter');
  await setField(win, '#sim-leading-commander-attacker', 'corsair');
  await setField(win, '#sim-leading-commander-attacker', 'hunter');
  await add(defender, 'tower-shield');
  await add(defender, 'planetary-shield');

  const configured = await snapshot(win);
  if (configured.firstTech.value !== '15' || configured.firstTech.max !== '15' || !configured.firstTechIncreaseDisabled || configured.firstShipLevel.max !== '10' || configured.firstShipLevel.value !== '10' || !configured.firstShipLevelIncreaseDisabled || configured.maxSuffixCount !== 0 || configured.technologyAssetCount !== 20 || configured.commanderCounts.length !== 2 || configured.leadingCommander !== 'hunter' || configured.defenseLevelControls !== 0 || configured.shieldLimits.some(({ max }) => max !== '1')) {
    throw new Error(`${label}: level, asset, commander, or defense contract failed ${JSON.stringify(configured)}`);
  }

  await click(win, `${attacker} .simx-tech-toggle`);
  await waitFor(win, `document.querySelector('#sim-attacker-technologies')?.hasAttribute('hidden') && document.querySelectorAll('${attacker} .simx-tech').length === 0`);
  const collapsed = await snapshot(win);
  if (collapsed.technologyOpen !== 'false' || !collapsed.technologyHidden) {
    throw new Error(`${label}: technology collapse contract failed ${JSON.stringify(collapsed)}`);
  }
  await click(win, `${attacker} .simx-tech-toggle`);
  await waitFor(win, `document.querySelectorAll('.simx-tech').length === 20`);
  await click(win, '[data-qa-sim-copy-tech]');
  await waitFor(win, `document.querySelector('${defender} .simx-tech:first-child input')?.value === '15'`);
  await clickAll(win, '.simx-tech-toggle');
  await waitFor(win, `document.querySelectorAll('.simx-tech').length === 0`);

  const expectedPresetName = `QA ${label}`;
  await setField(win, '#sim-preset-name', expectedPresetName);
  if ((await simulatorPresetDiagnostics(win)).inputName !== expectedPresetName) {
    throw new Error(`${label}: preset name input was not configured ${JSON.stringify(await simulatorPresetDiagnostics(win))}`);
  }
  await click(win, '[data-qa-sim-save]');
  const savedPresetExpression = `(() => { try { return JSON.parse(localStorage.getItem(${JSON.stringify(SAVE_KEY)}) || '{}')?.combatSimulator?.presets?.some((preset) => preset.name === ${JSON.stringify(expectedPresetName)}) === true; } catch { return false; } })()`;
  try {
    await waitFor(win, savedPresetExpression);
    await waitFor(win, `Array.from(document.querySelectorAll('#sim-preset-select option')).some((option) => option.textContent?.trim() === ${JSON.stringify(expectedPresetName)})`);
  } catch (error) {
    throw new Error(`${label}: preset save did not reach storage and selector: ${String(error)}; state=${JSON.stringify(await simulatorPresetDiagnostics(win))}`);
  }
  const savedPresetState = await simulatorPresetDiagnostics(win);
  if (savedPresetState.presets.length !== 1 || savedPresetState.presets[0]?.name !== expectedPresetName
    || savedPresetState.selectedPresetId !== savedPresetState.presets[0]?.id) {
    throw new Error(`${label}: saved preset state did not match the current scenario ${JSON.stringify(savedPresetState)}`);
  }

  // The rest of the old features: clear a side, load the scenario back, clear all, load again.
  await click(win, `[data-qa-sim-clear="attacker"]`);
  await waitFor(win, `document.querySelectorAll('${attacker} .simx-row').length === 0`);
  await click(win, '[data-qa-sim-load]');
  await waitFor(win, `document.querySelectorAll('${attacker} .simx-row').length > 0`);
  await click(win, '[data-qa-sim-clear-all]');
  await waitFor(win, `document.querySelectorAll('.simx-row').length === 0`);
  await click(win, '[data-qa-sim-load]');
  await waitFor(win, `document.querySelectorAll('.simx-row').length > 0 && document.querySelector('#sim-leading-commander-attacker')?.value === 'hunter'`);

  await click(win, '.sim-run-v1');
  await waitFor(win, `document.querySelector('[data-qa-sim-result]')`);
  await sleep(1100);
  const inline = await snapshot(win);
  const parts = inline.inlineResult;
  if (!parts.winner || !/Раунд [0-9]+ из /.test(parts.rounds) || !parts.verdictInWindow || !parts.forcesInWindow || !parts.debrisInWindow || !parts.lootInWindow || !parts.runInWindow || !parts.detailsInWindow || inline.hasResult) {
    throw new Error(`${label}: the outcome must stand on screen beside the fleets ${JSON.stringify(inline.inlineResult)}`);
  }
  await capture(win, directory, 'simulator-inline-result');
  // Scrolling down the fleets does not take the outcome away.
  await win.webContents.executeJavaScript('window.scrollTo(0, document.documentElement.scrollHeight)');
  await settle(win);
  const scrolled = (await snapshot(win)).inlineResult;
  await win.webContents.executeJavaScript('window.scrollTo(0, 0)');
  if (!scrolled.verdictInWindow || !scrolled.debrisInWindow) throw new Error(`${label}: the outcome scrolled away ${JSON.stringify(scrolled)}`);

  await click(win, '[data-qa-sim-details]');
  await waitFor(win, `document.querySelector('[role="dialog"][data-qa-battle-report-modal][data-qa-battle-report-source="simulation"]')`);
  await waitFor(win, `document.querySelector('.battle-round-analysis-v1')`);

  const result = await snapshot(win);
  if (!result.hasResult || result.hasSaveButton || result.hasProvenance || result.hasRoundLog || !result.roundAnalysisValid || result.hasInitialSnapshot || result.hasRoundSummary || !result.hasVisualReport || result.visibleTechnologyLevel || result.hasComposition || result.hasTechnicalLabels || result.roundAnalysisCount < 1 || result.roundAnalysisOpen || result.unnamedControls.length || result.horizontalOverflow || !result.ariaExpandedControls) {
    throw new Error(`${label}: result/detail/accessibility contract failed ${JSON.stringify(result)}`);
  }
  await capture(win, directory, 'simulator-result');

  const saved = await readSave(win);
  const lastScenario = saved.combatSimulator?.lastScenario;
  if (lastScenario?.executionMode !== 'production' || lastScenario?.technologyMode !== 'shared' || lastScenario?.attacker?.activeCommanderId !== 'hunter' || lastScenario?.attacker?.commanders?.length !== 2 || saved.combatSimulator?.presets?.length !== 1 || saved.combat?.reports?.some((report) => report.missionType === 'simulation') || saved.combat?.savedReportIds?.some((id) => saved.combat?.reports?.some((report) => report.id === id && report.missionType === 'simulation'))) {
    throw new Error(`${label}: full scenario persistence or simulation isolation failed ${JSON.stringify({ simulator: saved.combatSimulator, reportCount: saved.combat?.reports?.length })}`);
  }

  await reload(win);
  await openSimulator(win);
  await clickAll(win, '.simx-tech-toggle');
  await waitFor(win, `document.querySelectorAll('.simx-tech').length === 20`);
  const reloaded = await snapshot(win);
  if (reloaded.leadingCommander !== 'hunter' || reloaded.commanderCounts.length !== 2 || reloaded.debugControls !== 0 || reloaded.shieldLimits.some(({ max }) => max !== '1') || reloaded.satelliteOnAttacker) {
    throw new Error(`${label}: last scenario reload failed ${JSON.stringify(reloaded)}`);
  }
  await capture(win, directory, 'simulator-reloaded');
  return { viewport: label, initial, configured, result, reloaded, screenshots: fs.readdirSync(directory).filter((name) => name.endsWith('.png')).sort() };
}

app.whenReady().then(async () => {
  let win;
  try {
    fs.mkdirSync(OUTPUT, { recursive: true });
    const results = [];
    for (const [width, height] of VIEWPORTS) {
      win = new BrowserWindow({
        width,
        height,
        useContentSize: true,
        show: false,
        backgroundColor: '#02050a',
        webPreferences: {
          offscreen: true,
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
          partition: `qa-combat-simulator-${width}x${height}`,
        },
      });
      await win.loadFile(path.join(ROOT, 'dist', 'index.html'), { search: '?mode=test' });
      results.push(await runViewport(win, width, height));
      win.destroy();
      win = undefined;
    }
    fs.writeFileSync(path.join(OUTPUT, 'results.json'), JSON.stringify({ results }, null, 2));
    console.log(JSON.stringify({ results }, null, 2));
    app.exit(0);
  } catch (error) {
    console.error(error.stack || error);
    win?.destroy();
    app.exit(1);
  }
});
