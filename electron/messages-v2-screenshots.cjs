const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-gpu');
app.on('window-all-closed', () => {});

const ROOT = path.join(__dirname, '..');
const OUTPUT = path.join(ROOT, 'artifacts', 'messages-v2');
const SAVE_KEY = 'asterion.vertical-slice.test.v1';
const VIEWPORTS = [[1920, 1080], [1280, 720]];
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(win, expression, timeoutMs = 15_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await win.webContents.executeJavaScript(`Boolean(${expression})`)) return;
    await sleep(60);
  }
  throw new Error(`Timed out waiting for: ${expression}`);
}

async function settle(win) {
  await win.webContents.executeJavaScript('document.fonts?.ready');
  await win.webContents.executeJavaScript('new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
  await sleep(80);
}

async function reload(win) {
  const loaded = new Promise((resolve) => win.webContents.once('did-finish-load', resolve));
  win.webContents.reload();
  await loaded;
  await waitFor(win, `document.querySelector('[data-qa-navigation="primary"]')`);
  await settle(win);
}

async function clickPrimary(win, route) {
  const clicked = await win.webContents.executeJavaScript(`(() => {
    const button = document.querySelector('[data-qa-navigation="primary"] [data-qa-route=${JSON.stringify(route)}]');
    button?.click();
    return Boolean(button);
  })()`);
  if (!clicked) throw new Error(`Primary navigation button not found: ${route}`);
  await waitFor(win, `document.querySelector('[data-qa-${route === 'reports' ? 'profile' : 'universe'}]')`);
  await settle(win);
}

async function clickFolder(win, folder) {
  const target = await win.webContents.executeJavaScript(`(() => {
    const button = document.querySelector('[data-message-folder=${JSON.stringify(folder)}]');
    if (!button) return null;
    const rect = button.getBoundingClientRect();
    button.click();
    const reactPropsKey = Object.keys(button).find((key) => key.startsWith('__reactProps$'));
    const onClick = reactPropsKey ? button[reactPropsKey]?.onClick : null;
    if (typeof onClick === 'function' && button.getAttribute('aria-current') !== 'page') onClick({ preventDefault() {}, stopPropagation() {} });
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, disabled: button.disabled, text: button.textContent?.trim() || '' };
  })()`);
  if (!target) throw new Error(`Message folder not found: ${folder}`);
  await settle(win);
  const folderState = await win.webContents.executeJavaScript(`({
    selected: document.querySelector('[data-message-folder=${JSON.stringify(folder)}]')?.getAttribute('aria-current') || '',
    activeFolders: [...document.querySelectorAll('[data-message-folder][aria-current="page"]')].map((node) => node.getAttribute('data-message-folder')),
    folderViews: [...document.querySelectorAll('[data-qa-folder-view]')].map((node) => node.getAttribute('data-qa-folder-view')),
  })`);
  if (folderState.selected !== 'page' || !folderState.folderViews.includes(folder)) {
    const buttonInfo = await win.webContents.executeJavaScript(`(() => {
      const button = document.querySelector('[data-message-folder=${JSON.stringify(folder)}]');
      const key = button && Object.keys(button).find((candidate) => candidate.startsWith('__reactProps$'));
      return { html: button?.outerHTML || '', rect: button ? (() => { const rect = button.getBoundingClientRect(); return { x: rect.x, y: rect.y, w: rect.width, h: rect.height }; })() : null, reactKeys: key ? Object.keys(button[key] || {}) : [], location: location.href, body: document.body.innerText.slice(0, 500), routes: [...document.querySelectorAll('[data-qa-navigation="primary"] [data-qa-route]')].map((node) => ({ route: node.getAttribute('data-qa-route'), current: node.getAttribute('aria-current') })) };
    })()`);
    throw new Error(`Message folder did not open: ${folder}; ${JSON.stringify({ ...folderState, buttonInfo })}`);
  }
  await waitFor(win, `document.querySelector('[data-qa-folder-view=${JSON.stringify(folder)}]')`);
}

async function selectReport(win, id) {
  const opened = await win.webContents.executeJavaScript(`(() => {
    const row = document.querySelector('[data-report-item-id=' + CSS.escape(${JSON.stringify(id)}) + '] .reports-list-open');
    row?.click();
    return Boolean(row);
  })()`);
  if (!opened) {
    const diagnostic = await win.webContents.executeJavaScript(`({ reconIds: JSON.parse(localStorage.getItem(${JSON.stringify(SAVE_KEY)}) || '{}').pirate?.reconReports?.map((item) => item.id) || [], visibleIds: [...document.querySelectorAll('[data-qa-message-list] [data-report-item-id]')].map((item) => item.getAttribute('data-report-item-id')) })`);
    throw new Error(`Message report not found: ${id}; ${JSON.stringify(diagnostic)}`);
  }
  await waitFor(win, `document.querySelector('[data-report-item-id=${JSON.stringify(id)}] .reports-list-open[aria-current="true"]') || document.querySelector('.reports-preview')`);
  await settle(win);
}

async function capture(win, name) {
  await settle(win);
  const proof = await win.webContents.executeJavaScript(`(() => {
    const rect = (node) => {
      const value = node?.getBoundingClientRect();
      return value ? { left: value.left, top: value.top, right: value.right, bottom: value.bottom, width: value.width, height: value.height } : null;
    };
    const style = (node) => {
      const value = node ? getComputedStyle(node) : null;
      return value ? { fontSize: value.fontSize, lineHeight: value.lineHeight, letterSpacing: value.letterSpacing, padding: value.padding, gap: value.gap, transform: value.transform } : null;
    };
    const images = [...document.querySelectorAll('img')];
    const shell = document.querySelector('[data-qa-message-folder-view], [data-qa-profile]');
    const dossier = document.querySelector('.reports-preview, [data-qa-profile]');
    const stage = document.querySelector('.stage');
    const stageStyle = stage ? getComputedStyle(stage) : null;
    return { width: innerWidth, height: innerHeight,
      horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 2
        || document.body.scrollWidth > document.body.clientWidth + 2,
      shell: rect(shell), dossier: rect(dossier), shellComputed: style(shell), dossierComputed: style(dossier),
      stage: rect(stage), stageComputed: stageStyle ? { position: stageStyle.position, marginLeft: stageStyle.marginLeft, marginTop: stageStyle.marginTop, transform: stageStyle.transform, transformOrigin: stageStyle.transformOrigin } : null,
      imageCount: images.length, loadedImageCount: images.filter((image) => image.complete && image.naturalWidth > 0).length,
      fontStatus: document.fonts?.status ?? 'unavailable' };
  })()`);
  if (proof.horizontalOverflow) throw new Error(`Horizontal overflow in ${name}: ${JSON.stringify(proof)}`);
  if (proof.fontStatus !== 'loaded') throw new Error(`Fonts were not loaded in ${name}: ${JSON.stringify(proof)}`);
  if (proof.imageCount !== proof.loadedImageCount) throw new Error(`Unloaded image in ${name}: ${JSON.stringify(proof)}`);
  if (!proof.stage || Math.abs(proof.stage.left) > 1 || Math.abs(proof.stage.top) > 1 || Math.abs(proof.stage.width - proof.width) > 1 || Math.abs(proof.stage.height - proof.height) > 1) {
    throw new Error(`Stage bounds do not match viewport in ${name}: ${JSON.stringify(proof)}`);
  }
  const outputPath = path.join(OUTPUT, name);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  const image = await win.webContents.debugger.sendCommand('Page.captureScreenshot', {
    format: 'png', fromSurface: true, captureBeyondViewport: false,
  });
  fs.writeFileSync(outputPath, Buffer.from(image.data, 'base64'));
  return { file: path.basename(outputPath), ...proof };
}

function syntheticVisualQaFixture(now) {
  const spyReport = {
    id: 'messages-v2-visual-qa-spy', missionId: 'messages-v2-visual-qa-spy-mission', createdAt: now - 90_000,
    sourcePlanetId: 'helion-01', targetPlanetId: 'npc-bot-01-prime', targetPlanetName: 'Кальдера',
    targetOwnerId: 'npc-bot-01', targetOwnerName: 'Бот 01', targetRaceId: 'veyra', targetRelation: 'neutral',
    targetCoordinate: { galaxy: 1, system: 11, position: 10 }, spyLevel: 10, targetEspionageLevel: 10, delta: 0, roll: 0,
    quality: 'full', resources: { metal: 1_000_000, minerals: 800_000, gas: 400_000, debris: 2_000, developmentEnergy: 100 },
    fleet: { battleship: 23, cruiser: 4, scout: 12, transporter: 3 },
    fleetLevels: { battleship: 2, cruiser: 4, scout: 3, transporter: 1 },
    commanders: { hunter: { level: 20, count: 1 }, judge: { level: 1, count: 1 } },
    defense: { 'ballistic-turret': 1, 'ion-turret': 2 }, population: { total: 100, fleet: 50, defense: 50 }, firstReport: true,
  };
  const pirateReconReport = {
    id: 'pirate-recon:messages-v2-visual-qa-recon-mission', missionId: 'messages-v2-visual-qa-recon-mission',
    ownerId: 'player-current', contactCycleKey: 'pirate-cycle-v1:1:2:100:1792237021353',
    coordinate: { galaxy: 1, system: 2, position: 1 }, dispatchedAt: now - 120_000, arrivedAt: now - 80_000,
    outcome: 'success', intel: { ships: [
      { name: 'Гончий', populationPercent: 20 }, { name: 'Налётчик', populationPercent: 20 },
      { name: 'Капер', populationPercent: 15 }, { name: 'Палач', populationPercent: 15 },
      { name: 'Потрошитель', populationPercent: 15 }, { name: 'Громила', populationPercent: 15 },
    ], shipLevel: 4 },
  };
  const overpopulationReport = {
    id: `overpopulation:messages-v2-visual-qa:${now}`, planetId: 'qa-colony', planetName: 'Колония QA', factionId: 'aegis',
    populationBefore: 35_000, populationAfter: 25_000, capacity: 25_000, episodeStartedAt: now - 600_000, episodeEndedAt: now - 300_000,
    removedShips: [{ shipId: 'scout', count: 12 }, { shipId: 'destroyer', count: 3 }],
  };
  const recyclerArrivalReport = {
    id: 'recycler-arrival:messages-v2-visual-qa-flight', flightId: 'messages-v2-visual-qa-flight',
    coordinate: { galaxy: 2, system: 14, position: 7 }, arrivedAtMs: now - 60_000,
    collectedDebris: 800, remainingOrbitalDebris: 200,
  };
  return { spyReport, pirateReconReport, overpopulationReport, recyclerArrivalReport };
}

async function seedFixture(win) {
  await waitFor(win, `localStorage.getItem(${JSON.stringify(SAVE_KEY)})`);
  const now = Date.now();
  const fixture = syntheticVisualQaFixture(now);
  const seeded = await win.webContents.executeJavaScript(`(() => {
    try {
      const save = JSON.parse(localStorage.getItem(${JSON.stringify(SAVE_KEY)}) || '{}');
      save.espionage = { ...(save.espionage || {}), reports: [${JSON.stringify(fixture.spyReport)}] };
      save.pirate = { ...(save.pirate || {}), version: 1, reconReports: [${JSON.stringify(fixture.pirateReconReport)}] };
      save.reports = { ...(save.reports || {}), overpopulationReports: [${JSON.stringify(fixture.overpopulationReport)}], recyclerArrivalReports: [${JSON.stringify(fixture.recyclerArrivalReport)}] };
      localStorage.setItem(${JSON.stringify(SAVE_KEY)}, JSON.stringify(save));
      return true;
    } catch { return false; }
  })()`);
  if (!seeded) throw new Error('Unable to seed synthetic visual QA message fixtures');
  await reload(win);
  const persistedFixture = await win.webContents.executeJavaScript(`(() => { const save = JSON.parse(localStorage.getItem(${JSON.stringify(SAVE_KEY)}) || '{}'); return { pirateReconCount: save.pirate?.reconReports?.length || 0, ownerId: save.profile?.playerId }; })()`);
  console.log(`[messages-v2 fixture] ${JSON.stringify(persistedFixture)}`);
}

async function openWindow(width, height) {
  const partition = `qa-messages-v2-${width}`;
  const win = new BrowserWindow({ width, height, useContentSize: true, show: false, backgroundColor: '#02050a',
    webPreferences: { offscreen: true, contextIsolation: true, nodeIntegration: false, sandbox: true, partition } });
  win.webContents.on('render-process-gone', (_event, details) => console.error(`[messages-v2 renderer gone] ${JSON.stringify(details)}`));
  await win.loadURL('about:blank');
  win.webContents.debugger.attach('1.3');
  await win.webContents.debugger.sendCommand('Page.enable');
  await win.webContents.debugger.sendCommand('Emulation.setDeviceMetricsOverride', {
    width, height, deviceScaleFactor: 1, mobile: false, screenWidth: width, screenHeight: height,
  });
  const loaded = new Promise((resolve) => win.webContents.once('did-finish-load', resolve));
  await win.loadFile(path.join(ROOT, 'dist', 'index.html'), { search: '?mode=test' });
  await loaded;
  await waitFor(win, `document.querySelector('[data-qa-navigation="primary"]')`);
  await waitFor(win, `innerWidth === ${width} && innerHeight === ${height}`);
  await seedFixture(win);
  await clickPrimary(win, 'reports');
  return win;
}

async function runViewport(width, height, allStates) {
  const win = await openWindow(width, height);
  const captures = [];
  try {
    const folder = `${width}x${height}`;
    captures.push(await capture(win, `${folder}/01-profile.png`));
    await clickFolder(win, 'system');
    await selectReport(win, 'espionage:messages-v2-visual-qa-spy');
    captures.push(await capture(win, `${folder}/02-system-spy-report.png`));
    if (allStates) {
      await selectReport(win, 'pirate-recon:messages-v2-visual-qa-recon-mission');
      captures.push(await capture(win, `${folder}/03-system-pirate-recon.png`));
      const overpopulationId = await win.webContents.executeJavaScript(`document.querySelector('[data-qa-message-list] [data-report-kind="overpopulation"]')?.getAttribute('data-report-item-id') || ''`);
      if (!overpopulationId) throw new Error('Test Mode overpopulation report fixture is missing');
      await selectReport(win, overpopulationId);
      captures.push(await capture(win, `${folder}/04-system-overpopulation.png`));
      await clickFolder(win, 'battle');
      const battleId = await win.webContents.executeJavaScript(`document.querySelector('[data-qa-message-list] [data-report-item-id]')?.getAttribute('data-report-item-id') || ''`);
      if (!battleId) throw new Error('Canonical Test Mode battle report fixture is missing');
      await selectReport(win, battleId);
      captures.push(await capture(win, `${folder}/05-battle-report.png`));
      await clickFolder(win, 'flights');
      await selectReport(win, 'recycler-arrival:messages-v2-visual-qa-flight');
      captures.push(await capture(win, `${folder}/06-flights-recycler.png`));
      await clickFolder(win, 'alliances');
      const allianceId = await win.webContents.executeJavaScript(`document.querySelector('[data-qa-message-list] [data-report-item-id]')?.getAttribute('data-report-item-id') || ''`);
      if (allianceId) throw new Error('Alliance folder must stay empty: joint operations are no longer fabricated');
      captures.push(await capture(win, `${folder}/07-alliances-empty.png`));
      await clickFolder(win, 'command');
      await waitFor(win, `document.querySelector('[data-qa-message-list] .reports-list-empty-status')`);
      captures.push(await capture(win, `${folder}/08-command-empty.png`));
    }
  } finally {
    win.destroy();
  }
  return { viewport: `${width}x${height}`, captures };
}

app.whenReady().then(async () => {
  try {
    fs.mkdirSync(OUTPUT, { recursive: true });
    const results = [await runViewport(...VIEWPORTS[0], true), await runViewport(...VIEWPORTS[1], false)];
    fs.writeFileSync(path.join(OUTPUT, 'screenshot-manifest.json'), JSON.stringify({ results }, null, 2));
    console.log(JSON.stringify(results.map((result) => ({
      viewport: result.viewport,
      captures: result.captures.map(({ file, width, height, horizontalOverflow, stage, imageCount, loadedImageCount, fontStatus }) => ({ file, width, height, horizontalOverflow, stage, imageCount, loadedImageCount, fontStatus })),
    }))));
    app.exit(0);
  } catch (error) {
    console.error(error);
    app.exit(1);
  }
});
