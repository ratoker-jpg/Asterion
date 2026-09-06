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
const BUILT_INTERIOR_ROLES = [
  'construction',
  'advanced-factory',
  'recycling',
  'trade-center',
  'shipyard',
  'research',
  'spaceport',
  'planetary-government',
  'bank',
];
const BOT_PERCENTAGES = { metal: 6, minerals: 5, gas: 4 };
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(win, expression, timeoutMs = 7000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await win.webContents.executeJavaScript(`Boolean(${expression})`)) return;
    await sleep(50);
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
  await waitFor(win, `document.querySelector('.utility-navigation')`);
  await win.webContents.executeJavaScript('document.fonts?.ready');
  await settle(win);
}

async function capture(win, directory, name) {
  const result = await win.webContents.debugger.sendCommand('Page.captureScreenshot', {
    format: 'png',
    fromSurface: true,
    captureBeyondViewport: false,
  });
  fs.writeFileSync(path.join(directory, `${name}.png`), Buffer.from(result.data, 'base64'));
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

async function setBuiltInteriorSave(win) {
  await win.webContents.executeJavaScript(`(() => {
    const raw = localStorage.getItem(${JSON.stringify(SAVE_KEY)});
    const save = raw ? JSON.parse(raw) : null;
    if (!save?.planets?.['helion-01']?.buildings) return false;
    const buildings = save.planets['helion-01'].buildings;
    for (const role of ${JSON.stringify(BUILT_INTERIOR_ROLES)}) buildings[role] = 1;
    localStorage.setItem(${JSON.stringify(SAVE_KEY)}, JSON.stringify(save));
    return true;
  })()`);
  await reload(win);
}

async function activateZone(win, zone) {
  await click(win, `.header-zone--${zone}`);
  await waitFor(win, `document.querySelector('[data-qa-zone-view][data-zone=${JSON.stringify(zone)}]')`);
}

async function openBuildingDialog(win, role) {
  await click(win, `[data-zone-building-role="${role}"]`);
  await waitFor(win, `document.querySelector('[data-qa-building-dialog=${JSON.stringify(role)}]')`);
}

async function assertEnterVisible(win, role) {
  await waitFor(win, `document.querySelector('[data-qa-building-dialog=${JSON.stringify(role)}] [data-qa-enter-building=${JSON.stringify(role)}]')`);
}

async function enterBuilding(win, role) {
  await assertEnterVisible(win, role);
  await click(win, `[data-qa-enter-building="${role}"]`);
}

async function assertReturned(win, zone, role) {
  await waitFor(win, `document.querySelector('[data-qa-zone-view][data-zone=${JSON.stringify(zone)}]')`);
  await waitFor(win, `document.querySelector('[data-qa-building-dialog=${JSON.stringify(role)}]')`);
  const snapshot = await win.webContents.executeJavaScript(`(() => ({
    zone: document.querySelector('[data-qa-zone-view]')?.getAttribute('data-zone') ?? '',
    role: document.querySelector('[data-qa-building-dialog]')?.getAttribute('data-qa-building-dialog') ?? '',
    planet: document.querySelector('.current-planet-select strong')?.textContent?.replace(/\\s+/g, ' ').trim() ?? '',
  }))()`);
  if (snapshot.zone !== zone || snapshot.role !== role || !snapshot.planet.includes('Helion 01')) {
    throw new Error(`Return context mismatch: ${JSON.stringify(snapshot)}`);
  }
}

async function pressEscape(win) {
  await win.webContents.executeJavaScript(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))`);
  await settle(win);
}

async function closeDialog(win) {
  await click(win, '.resource-building-dialog-close');
  await waitFor(win, `!document.querySelector('[data-qa-building-dialog]')`);
}

async function readResourceIncome(win) {
  return win.webContents.executeJavaScript(`(() => {
    const value = (resource) => document.querySelector('[data-resource-income="' + resource + '"] strong')?.textContent?.replace(/\\s+/g, '').trim() ?? '';
    return { metal: value('metal'), minerals: value('minerals'), gas: value('gas') };
  })()`);
}

async function verifyProductionBotsScreen(win, role, expectedBuildingName) {
  await waitFor(win, `document.querySelector('[data-qa-production-bots=${JSON.stringify(role)}]')`);
  await waitFor(win, `(() => {
    const image = document.querySelector('[data-qa-production-bots=${JSON.stringify(role)}] .production-bots-building-art img');
    return image?.complete && image.naturalWidth > 0;
  })()`);

  const snapshot = await win.webContents.executeJavaScript(`(() => {
    const root = document.querySelector('[data-qa-production-bots=${JSON.stringify(role)}]');
    const read = (selector) => root?.querySelector(selector)?.textContent?.replace(/\\s+/g, ' ').trim() ?? '';
    const card = (resource) => root?.querySelector('[data-qa-production-bot-resource="' + resource + '"]');
    const rect = root?.getBoundingClientRect();
    const cards = Array.from(root?.querySelectorAll('[data-qa-production-bot-resource]') ?? []).map((item) => {
      const box = item.getBoundingClientRect();
      return { left: box.left, right: box.right, width: box.width };
    });
    return {
      title: read('.production-bots-header__copy h1'),
      context: read('.production-bots-header__copy p'),
      building: read('.production-bots-building-copy h2'),
      level: read('.production-bots-building-level'),
      artAlt: root?.querySelector('.production-bots-building-art img')?.getAttribute('alt') ?? '',
      back: read('[data-qa-production-bots-back]'),
      percentages: {
        metal: read('[data-qa-bot-percent="metal"]'),
        minerals: read('[data-qa-bot-percent="minerals"]'),
        gas: read('[data-qa-bot-percent="gas"]'),
      },
      assigned: {
        metal: read('[data-qa-bot-assigned="metal"]'),
        minerals: read('[data-qa-bot-assigned="minerals"]'),
        gas: read('[data-qa-bot-assigned="gas"]'),
      },
      current: {
        metal: read('[data-qa-bot-current-bonus="metal"]'),
        minerals: read('[data-qa-bot-current-bonus="minerals"]'),
        gas: read('[data-qa-bot-current-bonus="gas"]'),
      },
      empty: ['metal', 'minerals', 'gas'].map((resource) => card(resource)?.querySelector('.production-bot-card__empty')?.textContent?.trim() ?? ''),
      pending: ['metal', 'minerals', 'gas'].map((resource) => card(resource)?.querySelector('.production-bot-card__pending')?.textContent?.replace(/\\s+/g, ' ').trim() ?? ''),
      note: read('[data-qa-production-bots-economy-note]'),
      bounds: rect ? { left: rect.left, right: rect.right } : null,
      cards,
    };
  })()`);

  if (snapshot.title !== 'ПРОИЗВОДСТВЕННЫЕ БОТЫ') throw new Error(`Production bots title mismatch: ${JSON.stringify(snapshot)}`);
  if (!snapshot.context.includes(expectedBuildingName) || !snapshot.context.includes('Helion 01')) throw new Error(`Production bots context mismatch: ${JSON.stringify(snapshot)}`);
  if (snapshot.building !== expectedBuildingName || snapshot.artAlt !== expectedBuildingName || !snapshot.level.includes('1')) throw new Error(`Production building identity mismatch: ${JSON.stringify(snapshot)}`);
  if (!snapshot.back.includes(expectedBuildingName === 'Фабрика' ? 'Фабрику' : 'Промышленный комплекс')) throw new Error(`Production bots return target mismatch: ${JSON.stringify(snapshot)}`);
  if (snapshot.percentages.metal !== `+${BOT_PERCENTAGES.metal}%` || snapshot.percentages.minerals !== `+${BOT_PERCENTAGES.minerals}%` || snapshot.percentages.gas !== `+${BOT_PERCENTAGES.gas}%`) {
    throw new Error(`Production bot percentages mismatch: ${JSON.stringify(snapshot.percentages)}`);
  }
  if (Object.values(snapshot.assigned).some((value) => value !== '0') || Object.values(snapshot.current).some((value) => value !== '+0%')) {
    throw new Error(`Production bot empty assignment mismatch: ${JSON.stringify(snapshot)}`);
  }
  if (snapshot.empty.some((value) => value !== 'Боты пока не назначены')) throw new Error(`Production bot empty state mismatch: ${JSON.stringify(snapshot.empty)}`);
  if (snapshot.pending.some((value) => !value.includes('Не утверждены') || !value.includes('Не утверждена'))) throw new Error(`Production bot pending copy mismatch: ${JSON.stringify(snapshot.pending)}`);
  if (!snapshot.note.includes('не меняет показатели /ч') || !snapshot.note.includes('не списывает ресурсы')) throw new Error(`Production bot economy disclaimer missing: ${snapshot.note}`);
  if (!snapshot.bounds || snapshot.cards.some((card) => card.left < snapshot.bounds.left - 1 || card.right > snapshot.bounds.right + 1 || card.width <= 0)) {
    throw new Error(`Production bot card overflow: ${JSON.stringify(snapshot)}`);
  }

  return snapshot;
}

async function verifyFlow(win, directory) {
  await win.webContents.executeJavaScript(`localStorage.removeItem(${JSON.stringify(SAVE_KEY)})`);
  await reload(win);
  await setBuiltInteriorSave(win);

  await activateZone(win, 'resource');
  const incomeBefore = await readResourceIncome(win);

  await activateZone(win, 'industry');
  await openBuildingDialog(win, 'construction');
  await assertEnterVisible(win, 'construction');
  await capture(win, directory, 'building-interior-industry-modal');
  await enterBuilding(win, 'construction');
  const factory = await verifyProductionBotsScreen(win, 'construction', 'Фабрика');
  await capture(win, directory, 'production-bots-factory-empty');
  await click(win, '[data-qa-production-bots-back]');
  await assertReturned(win, 'industry', 'construction');
  await closeDialog(win);

  await openBuildingDialog(win, 'advanced-factory');
  await assertEnterVisible(win, 'advanced-factory');
  await enterBuilding(win, 'advanced-factory');
  const advancedFactory = await verifyProductionBotsScreen(win, 'advanced-factory', 'Промышленный комплекс');
  await capture(win, directory, 'production-bots-advanced-factory-empty');
  await click(win, '[data-qa-production-bots-back]');
  await assertReturned(win, 'industry', 'advanced-factory');
  await closeDialog(win);

  await activateZone(win, 'resource');
  const incomeAfter = await readResourceIncome(win);
  if (JSON.stringify(incomeAfter) !== JSON.stringify(incomeBefore)) {
    throw new Error(`Resource income changed after production bot flow: ${JSON.stringify({ incomeBefore, incomeAfter })}`);
  }

  await activateZone(win, 'military');
  await openBuildingDialog(win, 'shipyard');
  await assertEnterVisible(win, 'shipyard');
  await capture(win, directory, 'building-interior-military-modal');
  await enterBuilding(win, 'shipyard');
  await waitFor(win, `document.querySelector('.primary-navigation button.active span')?.textContent?.trim() === 'Флоты'`);
  await waitFor(win, `document.querySelector('.fleet-main-v1--shipyard')`);
  await waitFor(win, `document.querySelector('[data-qa-building-interior-back]')`);
  await capture(win, directory, 'building-interior-fleet-from-shipyard');
  await pressEscape(win);
  await assertReturned(win, 'military', 'shipyard');
  await closeDialog(win);

  await openBuildingDialog(win, 'research');
  await enterBuilding(win, 'research');
  await waitFor(win, `document.querySelector('.science-view-v2')`);
  await waitFor(win, `document.querySelector('[data-qa-building-interior-back]')`);
  await capture(win, directory, 'building-interior-science-from-laboratory');
  await click(win, '[data-qa-building-interior-back]');
  await assertReturned(win, 'military', 'research');
  await closeDialog(win);

  await openBuildingDialog(win, 'planetary-government');
  await enterBuilding(win, 'planetary-government');
  await waitFor(win, `document.querySelector('.command-view')`);
  await waitFor(win, `document.querySelector('[data-qa-building-interior-back]')`);
  await capture(win, directory, 'building-interior-command-from-government');
  await pressEscape(win);
  await assertReturned(win, 'military', 'planetary-government');
  await closeDialog(win);

  await openBuildingDialog(win, 'spaceport');
  await enterBuilding(win, 'spaceport');
  await waitFor(win, `document.querySelector('[data-qa-building-interior-host="spaceport"]')`);
  const hostText = await win.webContents.executeJavaScript(`document.querySelector('[data-qa-building-interior-host="spaceport"]')?.textContent ?? ''`);
  if (!hostText.includes('Модуль будет доступен в следующем обновлении')) throw new Error(`Future host empty state missing: ${hostText}`);
  await click(win, '[data-qa-building-interior-back]');
  await assertReturned(win, 'military', 'spaceport');

  return {
    screen: 'building-interiors-navigation',
    roles: BUILT_INTERIOR_ROLES,
    productionBots: {
      percentages: BOT_PERCENTAGES,
      factory,
      advancedFactory,
      incomeBefore,
      incomeAfter,
    },
    verified: [
      'factory-production-bots-empty',
      'advanced-factory-production-bots-empty',
      'production-bots-percentages-6-5-4',
      'production-bots-income-unchanged',
      'production-bots-return-context',
      'future-host-back',
      'shipyard-fleet-construction-deep-link',
      'shipyard-escape-return',
      'research-science-deep-link',
      'research-back-return',
      'government-command-deep-link',
      'government-escape-return',
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
        partition: 'qa-building-interiors',
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
      const result = await verifyFlow(win, directory);
      fs.writeFileSync(path.join(directory, 'building-interiors-metrics.json'), JSON.stringify(result, null, 2));
    }

    win.webContents.debugger.detach();
    win.destroy();
    app.exit(0);
  } catch (error) {
    console.error(error);
    try {
      if (win?.webContents.debugger.isAttached()) win.webContents.debugger.detach();
    } catch {}
    win?.destroy();
    app.exit(1);
  }
});
