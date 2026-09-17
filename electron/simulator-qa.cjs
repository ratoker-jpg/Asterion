const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-gpu');
app.on('window-all-closed', () => {});

const ROOT = path.join(__dirname, '..');
const OUTPUT = path.join(ROOT, 'artifacts', 'combat-simulator-qa');
const SAVE_KEY = 'asterion.vertical-slice.v1';
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

async function capture(win, directory, name) {
  const image = await win.webContents.capturePage();
  fs.writeFileSync(path.join(directory, `${name}.png`), image.toPNG());
}

async function snapshot(win) {
  return win.webContents.executeJavaScript(`(() => {
    const root = document.documentElement;
    const side = (index) => document.querySelectorAll('.sim-side-v1')[index];
    const firstTech = side(0)?.querySelector('.sim-tech-row-v1');
    const firstShip = side(0)?.querySelector('[data-qa-simulator-unit="scout"]');
    const attackerCommanderSection = side(0)?.querySelector('[id="sim-attacker-commanders"]')?.closest('.sim-unit-section-v1');
    const defenderDefenseSection = side(1)?.querySelector('[id="sim-defender-defenses"]')?.closest('.sim-unit-section-v1');
    const leadingCommander = document.querySelector('#sim-leading-commander-attacker');
    return {
      meters: Array.from(document.querySelectorAll('.sim-population-v1')).map((item) => item.textContent?.replace(/\\s+/g, ' ').trim() || ''),
      firstTech: { value: firstTech?.querySelector('input')?.value || '', max: firstTech?.querySelector('input')?.getAttribute('max') || '' },
      firstTechIncreaseDisabled: Boolean(firstTech?.querySelector('button[aria-label^="Увеличить"]')?.disabled),
      firstShipLevel: { value: firstShip?.querySelector('.sim-level-control-v1 input')?.value || '', max: firstShip?.querySelector('.sim-level-control-v1 input')?.getAttribute('max') || '' },
      firstShipLevelIncreaseDisabled: Boolean(firstShip?.querySelector('.sim-level-control-v1 button[aria-label^="Увеличить"]')?.disabled),
      maxSuffixCount: document.querySelectorAll('.sim-level-control-v1 > small, .sim-tech-controls-v1 > span:not(.sim-number-stepper-v1)').length,
      commanderCounts: Array.from(attackerCommanderSection?.querySelectorAll('input[aria-label^="Количество"]') || []).filter((item) => Number(item.value) > 0).map((item) => item.value),
      leadingCommander: leadingCommander?.value || '',
      technologyAssetCount: document.querySelectorAll('.sim-tech-row-v1 > img[src]').length,
      technologyRows: document.querySelectorAll('.sim-tech-row-v1').length,
      technologyOpen: document.querySelector('.sim-tech-section-v1 .sim-section-toggle-v1')?.getAttribute('aria-expanded') || '',
      technologyHidden: document.querySelector('.sim-tech-list-v1')?.hasAttribute('hidden') ?? false,
      defenseLevelControls: defenderDefenseSection?.querySelectorAll('.sim-level-control-v1').length || 0,
      shieldLimits: ['tower-shield', 'planetary-shield'].map((id) => ({ id, max: document.querySelector('.sim-side-v1:last-child [data-qa-simulator-unit="' + id + '"] input')?.getAttribute('max') || '' })),
      serviceUnit: { count: document.querySelector('[data-qa-simulator-unit="solar-satellite"] input[aria-label^="Количество"]')?.value || '', unavailable: Boolean(document.querySelector('.sim-unit-unavailable-v1')) },
      debugControls: document.querySelectorAll('.sim-execution-v1, .sim-seed-v1, .sim-target-priority-v1').length,
      hasResult: Boolean(document.querySelector('[role="dialog"][data-qa-battle-report-modal][data-qa-battle-report-source="simulation"]')),
      hasSaveButton: Boolean(document.querySelector('[data-qa-battle-save-simulation]')),
      hasProvenance: Boolean(document.querySelector('.battle-provenance-v1')),
      hasRoundLog: Boolean(document.querySelector('[data-qa-battle-round-log]')),
      hasInitialSnapshot: Boolean(document.querySelector('[data-qa-battle-initial-snapshot]')),
      hasRoundSummary: Boolean(document.querySelector('.battle-round-summary-v1')),
      hasVisualReport: Boolean(document.querySelector('[data-qa-battle-visual-report]')),
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
  await win.webContents.executeJavaScript(`localStorage.removeItem(${JSON.stringify(SAVE_KEY)}); localStorage.removeItem('asterion.preferences.v2');`);
  await reload(win);
  await openSimulator(win);

  const initial = await snapshot(win);
  if (initial.meters.length !== 5 || initial.meters.some((meter) => !meter.includes('/ 35 000')) || initial.meters.some((meter) => meter.includes('25 112'))) {
    throw new Error(`${label}: independent population meter contract failed ${JSON.stringify(initial)}`);
  }
  if (initial.debugControls !== 0 || initial.unnamedControls.length || initial.horizontalOverflow || initial.serviceUnit.unavailable) {
    throw new Error(`${label}: normal simulator controls/geometry contract failed ${JSON.stringify(initial)}`);
  }

  await win.webContents.executeJavaScript(`(() => {
    document.querySelectorAll('.sim-tech-section-v1 .sim-section-toggle-v1').forEach((button) => {
      if (button.getAttribute('aria-expanded') !== 'true') button.click();
    });
    const commanderSections = Array.from(document.querySelectorAll('.sim-side-v1:first-child .sim-unit-section-v1')).filter((section) => section.textContent?.includes('КОМАНДИРСКИЕ'));
    commanderSections.forEach((section) => {
      const button = section.querySelector('.sim-section-toggle-v1');
      if (button?.getAttribute('aria-expanded') !== 'true') button.click();
    });
    const defenseSection = document.querySelector('#sim-defender-defenses')?.closest('.sim-unit-section-v1');
    const defenseButton = defenseSection?.querySelector('.sim-section-toggle-v1');
    if (defenseButton?.getAttribute('aria-expanded') !== 'true') defenseButton.click();
  })()`);
  await waitFor(win, `document.querySelectorAll('.sim-tech-row-v1').length === 20`);
  const firstTechnologySelector = '.sim-side-v1:first-child .sim-tech-row-v1:first-child input';
  await setField(win, firstTechnologySelector, 14);
  await click(win, '.sim-side-v1:first-child .sim-tech-row-v1:first-child .sim-tech-controls-v1 button[aria-label^="Увеличить"]');
  await setField(win, '.sim-side-v1:first-child .sim-unit-section-v1:not(.sim-tech-section-v1) .sim-unit-row-v1:first-child input[aria-label^="Количество"]', 999999);
  const capped = await snapshot(win);
  if (capped.meters.some((meter) => /[0-9]{2,3} ?[0-9]{3} ?\/ ?35 000/.test(meter) && Number(meter.match(/[0-9 ]+(?=\s*\/)/)?.[0]?.replace(/\s/g, '') || 0) > 35000)) {
    throw new Error(`${label}: attacker population cap did not clamp the field ${JSON.stringify(capped)}`);
  }
  await setField(win, '.sim-side-v1:first-child .sim-unit-section-v1:not(.sim-tech-section-v1) .sim-unit-row-v1:first-child input[aria-label^="Количество"]', 1);
  await setField(win, '.sim-side-v1:first-child [data-qa-simulator-unit="scout"] input[aria-label^="Количество"]', 2);
  await setField(win, '.sim-side-v1:first-child [data-qa-simulator-unit="scout"] .sim-level-control-v1 input', 10);
  await setField(win, '.sim-side-v1:first-child [data-qa-simulator-unit="cruiser"] input[aria-label^="Количество"]', 1);
  await setField(win, '.sim-side-v1:last-child .sim-unit-section-v1:not(.sim-tech-section-v1) .sim-unit-row-v1:first-child input[aria-label^="Количество"]', 1);
  await setField(win, '.sim-side-v1:first-child [data-qa-simulator-unit="corsair"] input[aria-label^="Количество"]', 1);
  await setField(win, '.sim-side-v1:first-child [data-qa-simulator-unit="hunter"] input[aria-label^="Количество"]', 1);
  await setField(win, '#sim-leading-commander-attacker', 'corsair');
  await setField(win, '#sim-leading-commander-attacker', 'hunter');
  await setField(win, '.sim-side-v1:last-child [data-qa-simulator-unit="tower-shield"] input[aria-label^="Количество"]', 1);
  await setField(win, '.sim-side-v1:last-child [data-qa-simulator-unit="planetary-shield"] input[aria-label^="Количество"]', 1);

  const configured = await snapshot(win);
  if (configured.firstTech.value !== '15' || configured.firstTech.max !== '15' || !configured.firstTechIncreaseDisabled || configured.firstShipLevel.max !== '10' || configured.firstShipLevel.value !== '10' || !configured.firstShipLevelIncreaseDisabled || configured.maxSuffixCount !== 0 || configured.technologyAssetCount !== 20 || configured.commanderCounts.length !== 2 || configured.leadingCommander !== 'hunter' || configured.defenseLevelControls !== 0 || configured.shieldLimits.some(({ max }) => max !== '1')) {
    throw new Error(`${label}: level, asset, commander, or defense contract failed ${JSON.stringify(configured)}`);
  }

  await click(win, '.sim-side-v1:first-child .sim-tech-section-v1 .sim-section-toggle-v1');
  await waitFor(win, `document.querySelector('.sim-tech-list-v1')?.hasAttribute('hidden') && document.querySelectorAll('.sim-side-v1:first-child .sim-tech-row-v1').length === 0`);
  const collapsed = await snapshot(win);
  if (collapsed.technologyOpen !== 'false' || !collapsed.technologyHidden) {
    throw new Error(`${label}: technology collapse contract failed ${JSON.stringify(collapsed)}`);
  }
  await click(win, '.sim-side-v1:first-child .sim-tech-section-v1 .sim-section-toggle-v1');
  await waitFor(win, `document.querySelectorAll('.sim-tech-row-v1').length === 20`);
  await click(win, '.sim-copy-tech-v1');
  await waitFor(win, `document.querySelector('.sim-side-v1:last-child .sim-tech-row-v1:first-child input')?.value === '15'`);

  await setField(win, '#sim-preset-name', `QA ${label}`);
  await click(win, '.sim-presets-v1 > div:first-child button');
  await waitFor(win, `(() => { try { return JSON.parse(localStorage.getItem(${JSON.stringify(SAVE_KEY)}) || '{}')?.combatSimulator?.presets?.length === 1; } catch { return false; } })()`);
  await click(win, '.sim-run-v1');
  await waitFor(win, `document.querySelector('[role="dialog"][data-qa-battle-report-modal][data-qa-battle-report-source="simulation"]')`);
  await waitFor(win, `document.querySelector('.battle-round-analysis-v1')`);

  const result = await snapshot(win);
  if (!result.hasResult || result.hasSaveButton || result.hasProvenance || !result.hasRoundLog || result.hasInitialSnapshot || result.hasRoundSummary || !result.hasVisualReport || result.hasTechnicalLabels || result.roundAnalysisCount < 1 || result.roundAnalysisOpen || result.unnamedControls.length || result.horizontalOverflow || !result.ariaExpandedControls) {
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
  await win.webContents.executeJavaScript(`(() => {
    document.querySelectorAll('.sim-tech-section-v1 .sim-section-toggle-v1, #sim-attacker-commanders, #sim-defender-defenses').forEach((element) => {
      const button = element.classList.contains('sim-section-toggle-v1') ? element : element.closest('.sim-unit-section-v1')?.querySelector('.sim-section-toggle-v1');
      if (button?.getAttribute('aria-expanded') !== 'true') button.click();
    });
  })()`);
  await waitFor(win, `document.querySelectorAll('.sim-tech-row-v1').length === 20`);
  const reloaded = await snapshot(win);
  if (reloaded.leadingCommander !== 'hunter' || reloaded.commanderCounts.length !== 2 || reloaded.debugControls !== 0 || reloaded.shieldLimits.some(({ max }) => max !== '1') || reloaded.serviceUnit.unavailable) {
    throw new Error(`${label}: last scenario reload failed ${JSON.stringify(reloaded)}`);
  }
  await capture(win, directory, 'simulator-reloaded');
  return { viewport: label, initial, configured, result, reloaded, screenshots: fs.readdirSync(directory).filter((name) => name.endsWith('.png')).sort() };
}

app.whenReady().then(async () => {
  let win;
  try {
    fs.rmSync(OUTPUT, { recursive: true, force: true });
    fs.mkdirSync(OUTPUT, { recursive: true });
    win = new BrowserWindow({ width: 1920, height: 1080, useContentSize: true, show: false, backgroundColor: '#02050a', webPreferences: { offscreen: true, contextIsolation: true, nodeIntegration: false, sandbox: true, partition: 'qa-combat-simulator' } });
    await win.loadFile(path.join(ROOT, 'dist', 'index.html'));
    const results = [];
    for (const [width, height] of VIEWPORTS) results.push(await runViewport(win, width, height));
    fs.writeFileSync(path.join(OUTPUT, 'results.json'), JSON.stringify({ results }, null, 2));
    console.log(JSON.stringify({ results }, null, 2));
    win.destroy();
    app.exit(0);
  } catch (error) {
    console.error(error.stack || error);
    win?.destroy();
    app.exit(1);
  }
});
