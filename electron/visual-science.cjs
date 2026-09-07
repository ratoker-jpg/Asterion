const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-gpu');
app.on('window-all-closed', () => {});

const ROOT = path.join(__dirname, '..');
const OUTPUT = path.join(ROOT, 'artifacts-pass1', 'science-qa');
const SAVE_KEY = 'asterion.vertical-slice.v1';
const VIEWPORTS = [[1920, 1080], [1280, 720]];
const SCIENCE_ID = 1;
const SCIENCE_DURATION_MS = 2 * 60 * 60 * 1000 + 8 * 60 * 1000 + 59 * 1000;
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
  if (!clicked) throw new Error(`Element not found/enabled: ${selector}`);
  await settle(win);
}

async function capture(win, directory, name, selector = null) {
  if (selector) await win.webContents.executeJavaScript(`document.querySelector(${JSON.stringify(selector)})?.scrollIntoView({ block: 'center', inline: 'nearest' })`);
  else await win.webContents.executeJavaScript('window.scrollTo(0, 0)');
  await settle(win);
  const result = await win.webContents.debugger.sendCommand('Page.captureScreenshot', {
    format: 'png',
    fromSurface: true,
    captureBeyondViewport: false,
  });
  fs.writeFileSync(path.join(directory, `${name}.png`), Buffer.from(result.data, 'base64'));
}

async function seed(win, science) {
  const ok = await win.webContents.executeJavaScript(`(() => {
    const save = JSON.parse(localStorage.getItem(${JSON.stringify(SAVE_KEY)}) || 'null');
    const planet = save?.planets?.['helion-01'];
    if (!save || !planet?.buildings || !save.science?.levels) return false;
    planet.buildings.research = 1;
    planet.buildings.construction = 1;
    save.metal = 1_000_000;
    save.minerals = 1_000_000;
    save.gas = 1_000_000;
    planet.energy = 1_000_000;
    save.science.levels[1] = ${science.level};
    save.science.queue = ${JSON.stringify(science.queue)};
    save.schemaVersion = Math.max(Number(save.schemaVersion) || 0, 9);
    localStorage.setItem(${JSON.stringify(SAVE_KEY)}, JSON.stringify(save));
    return true;
  })()`);
  if (!ok) throw new Error('Could not seed Science save');
  await reload(win);
}

async function openScience(win) {
  await click(win, '.utility-navigation button[aria-label="Наука"]');
  await waitFor(win, `document.querySelector('[data-qa-science-root]')`);
  await settle(win);
}

async function readScreen(win) {
  return win.webContents.executeJavaScript(`(() => {
    const root = document.querySelector('[data-qa-science-root]');
    const row = document.querySelector('[data-qa-science-id="1"]');
    const save = JSON.parse(localStorage.getItem(${JSON.stringify(SAVE_KEY)}) || '{}');
    const action = row?.querySelector('[data-qa-science-action]');
    const workspace = document.querySelector('.workspace');
    return {
      root: Boolean(root),
      queue: document.querySelector('[data-qa-science-queue-count]')?.textContent?.trim() ?? '',
      level: row?.querySelector('[data-qa-science-level]')?.textContent?.replace(/\\s+/g, ' ').trim() ?? '',
      status: row?.getAttribute('data-qa-science-status') ?? '',
      actionDisabled: Boolean(action?.disabled),
      actionText: action?.textContent?.replace(/\\s+/g, ' ').trim() ?? '',
      fixtureText: /Реальное исследование|пока не подключены|SCIENCE_PROTOTYPE_DISPLAY_STATE/.test(document.body.textContent || ''),
      horizontalOverflow: document.documentElement.scrollWidth > window.innerWidth + 2 || document.body.scrollWidth > window.innerWidth + 2,
      scienceQueueLength: save.science?.queue?.length ?? -1,
      scienceLevel: save.science?.levels?.[1] ?? -1,
      documentScroll: document.documentElement.scrollHeight > window.innerHeight + 2,
      workspaceWidth: workspace?.getBoundingClientRect().width ?? 0,
    };
  })()`);
}

async function assertInitial(win, label) {
  const screen = await readScreen(win);
  if (!screen.root || screen.queue !== '0/3' || screen.actionDisabled || screen.fixtureText || screen.horizontalOverflow) {
    throw new Error(`${label}: initial Science state mismatch ${JSON.stringify(screen)}`);
  }
}

async function runViewport(width, height) {
  const label = `${width}x${height}`;
  const stage = (name) => console.log(`[${label}] ${name}`);
  const directory = path.join(OUTPUT, label);
  fs.mkdirSync(directory, { recursive: true });
  const win = new BrowserWindow({
    width,
    height,
    show: false,
    webPreferences: { sandbox: false },
  });
  win.webContents.on('console-message', (_event, _level, message) => {
    if (/error/i.test(message)) console.warn(`[${label}] renderer: ${message}`);
  });
  await win.loadFile(path.join(ROOT, 'dist', 'index.html'));
  win.webContents.debugger.attach('1.3');
  stage('loaded');
  await waitFor(win, `document.querySelector('.utility-navigation')`);

  await seed(win, { level: 0, queue: [] });
  await openScience(win);
  stage('empty queue');
  await assertInitial(win, label);
  await capture(win, directory, 'science-empty-queue');

  await click(win, '[data-qa-science-id="1"] [data-qa-science-action]');
  await waitFor(win, `document.querySelector('[data-qa-science-queue-count]')?.textContent === '1/3'`);
  const afterOne = await readScreen(win);
  if (afterOne.scienceQueueLength !== 1 || afterOne.horizontalOverflow) throw new Error(`${label}: first research was not persisted atomically ${JSON.stringify(afterOne)}`);
  await capture(win, directory, 'science-one-queued', '[data-qa-science-id="1"]');

  await click(win, '[data-qa-science-id="1"] [data-qa-science-action]');
  await click(win, '[data-qa-science-id="1"] [data-qa-science-action]');
  await waitFor(win, `document.querySelector('[data-qa-science-queue-count]')?.textContent === '3/3'`);
  const full = await readScreen(win);
  if (full.scienceQueueLength !== 3 || full.status !== 'queue-full' || !full.actionDisabled) throw new Error(`${label}: queue-full state mismatch ${JSON.stringify(full)}`);
  await capture(win, directory, 'science-queue-full', '[data-qa-science-queue]');

  await reload(win);
  await openScience(win);
  const afterReload = await readScreen(win);
  if (afterReload.queue !== '3/3' || afterReload.scienceQueueLength !== 3) throw new Error(`${label}: queue did not survive reload ${JSON.stringify(afterReload)}`);
  await capture(win, directory, 'science-reload-queue');
  stage('reload queue');

  const completedQueue = [{
    id: 'offline-complete',
    scienceId: 1,
    fromLevel: 0,
    toLevel: 1,
    startedAt: Date.now() - SCIENCE_DURATION_MS - 5_000,
    finishAt: Date.now() - 5_000,
    durationMs: SCIENCE_DURATION_MS,
    cost: { metal: 64_000, minerals: 32_000, gas: 5_000, energy: 0 },
  }];
  await seed(win, { level: 0, queue: completedQueue });
  await openScience(win);
  await waitFor(win, `document.querySelector('[data-qa-science-queue-count]')?.textContent === '0/3'`);
  const offline = await readScreen(win);
  if (offline.scienceQueueLength !== 0 || offline.scienceLevel !== 1 || offline.level !== 'УР. 1 / 20') throw new Error(`${label}: offline completion mismatch ${JSON.stringify(offline)}`);
  await capture(win, directory, 'science-offline-completed', '[data-qa-science-id="1"]');
  stage('offline completion');

  await seed(win, { level: 0, queue: [] });
  await openScience(win);
  await click(win, '.science-sections-v2 button:nth-child(2)');
  await waitFor(win, `document.querySelector('[data-qa-science-id="5"]')`);
  const blocked = await win.webContents.executeJavaScript(`(() => {
    const row = document.querySelector('[data-qa-science-id="5"]');
    return { status: row?.getAttribute('data-qa-science-status'), disabled: Boolean(row?.querySelector('[data-qa-science-action]')?.disabled), text: row?.textContent?.replace(/\\s+/g, ' ').trim() ?? '' };
  })()`);
  if (blocked.status !== 'requirements-unmet' || !blocked.disabled || !/Лаборатория/.test(blocked.text)) throw new Error(`${label}: blocked requirements mismatch ${JSON.stringify(blocked)}`);
  await capture(win, directory, 'science-blocked-requirements', '[data-qa-science-id="5"]');
  stage('blocked requirements');

  await seed(win, { level: 20, queue: [] });
  stage('seed max');
  await openScience(win);
  stage('open max');
  const max = await readScreen(win);
  if (max.status !== 'max-level' || !max.actionDisabled || !/МАКСИМАЛЬНЫЙ/.test(max.actionText)) throw new Error(`${label}: max state mismatch ${JSON.stringify(max)}`);
  await capture(win, directory, 'science-max-level', '[data-qa-science-id="1"]');
  stage('max level');

  const finalScreen = await readScreen(win);
  if (finalScreen.horizontalOverflow || finalScreen.fixtureText) throw new Error(`${label}: final visual contract mismatch ${JSON.stringify(finalScreen)}`);
  win.webContents.debugger.detach();
  await win.close();
  stage('closed');
  return { viewport: label, screenshots: fs.readdirSync(directory).sort(), finalScreen };
}

async function main() {
  fs.mkdirSync(OUTPUT, { recursive: true });
  const results = [];
  try {
    for (const [width, height] of VIEWPORTS) results.push(await runViewport(width, height));
    fs.writeFileSync(path.join(OUTPUT, 'result.json'), JSON.stringify({ results }, null, 2));
    console.log(JSON.stringify({ results }, null, 2));
  } finally {
    app.quit();
  }
}

app.whenReady().then(main).catch((error) => {
  console.error(error.stack || error);
  app.exit(1);
});
