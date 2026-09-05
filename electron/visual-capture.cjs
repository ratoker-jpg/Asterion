const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-gpu');

const ROOT = path.join(__dirname, '..');
const OUTPUT = path.join(ROOT, 'visual-qa');
const VIEWPORTS = [
  [1920, 1080],
  [1600, 900],
  [1280, 720],
  [2560, 1440],
];
const SCREENS = [
  ['settings', 'Настройки'],
  ['rating', 'Рейтинг'],
  ['science', 'Наука'],
];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(win, expression, timeoutMs = 6000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await win.webContents.executeJavaScript(`Boolean(${expression})`)) return;
    await sleep(50);
  }
  throw new Error(`Timed out waiting for: ${expression}`);
}

async function activateScreen(win, label) {
  const encoded = JSON.stringify(label);
  await win.webContents.executeJavaScript(`(() => {
    const button = Array.from(document.querySelectorAll('.utility-navigation button')).find((item) => item.getAttribute('aria-label') === ${encoded});
    if (!button) return false;
    button.click();
    return true;
  })()`);
  await waitFor(win, `document.querySelector('.utility-screen-host[data-utility-screen="${label}"]')`);
  await sleep(120);
}

async function metrics(win, screen) {
  return win.webContents.executeJavaScript(`(() => {
    const root = document.documentElement;
    const body = document.body;
    const stage = document.querySelector('.stage');
    const workspace = document.querySelector('.workspace');
    const host = document.querySelector('.utility-screen-host');
    const scienceCatalog = document.querySelector('[data-qa-scroll="science-catalog"]');
    const settingsContent = document.querySelector('[data-qa-scroll="settings-content"]');
    const verticalDocumentScroll = Math.max(root.scrollHeight, body.scrollHeight) > window.innerHeight + 2;
    const rect = (element) => element ? (() => {
      const r = element.getBoundingClientRect();
      return { x:r.x, y:r.y, width:r.width, height:r.height };
    })() : null;
    return {
      screen: ${JSON.stringify(screen)},
      viewport: { width: window.innerWidth, height: window.innerHeight },
      document: {
        scrollHeight: Math.max(root.scrollHeight, body.scrollHeight),
        clientHeight: window.innerHeight,
        verticalScroll: verticalDocumentScroll,
        longPageClass: root.classList.contains('asterion-long-page'),
      },
      stage: rect(stage),
      workspace: rect(workspace),
      utilityHost: rect(host),
      scienceCatalog: scienceCatalog ? { clientHeight: scienceCatalog.clientHeight, scrollHeight: scienceCatalog.scrollHeight, overflowY: getComputedStyle(scienceCatalog).overflowY } : null,
      settingsContent: settingsContent ? { clientHeight: settingsContent.clientHeight, scrollHeight: settingsContent.scrollHeight, overflowY: getComputedStyle(settingsContent).overflowY } : null,
      typography: {
        hud: getComputedStyle(root).getPropertyValue('--text-scale-hud').trim(),
        helper: getComputedStyle(root).getPropertyValue('--text-scale-helper').trim(),
      },
    };
  })()`);
}

async function setTypographySlider(win, labelPart, value) {
  const result = await win.webContents.executeJavaScript(`(() => {
    const input = Array.from(document.querySelectorAll('input[type="range"]')).find((element) => element.getAttribute('aria-label')?.includes(${JSON.stringify(labelPart)}));
    if (!input) return false;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    setter?.call(input, String(${value}));
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  })()`);
  if (!result) throw new Error(`Typography slider not found: ${labelPart}`);
  await sleep(100);
}

async function capture(win, directory, name) {
  const image = await win.webContents.capturePage();
  fs.writeFileSync(path.join(directory, `${name}.png`), image.toPNG());
}

async function runViewport(width, height) {
  const label = `${width}x${height}`;
  const directory = path.join(OUTPUT, label);
  fs.mkdirSync(directory, { recursive: true });

  const win = new BrowserWindow({
    width,
    height,
    useContentSize: true,
    show: false,
    backgroundColor: '#02050a',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      partition: `qa-${label}`,
    },
  });

  await win.loadFile(path.join(ROOT, 'dist', 'index.html'));
  await waitFor(win, `document.querySelector('.utility-navigation')`);
  await win.webContents.executeJavaScript('document.fonts?.ready');
  await sleep(120);

  const results = [];
  for (const [name, screenLabel] of SCREENS) {
    await activateScreen(win, screenLabel);
    const item = await metrics(win, name);
    if (item.document.verticalScroll || item.document.longPageClass) {
      throw new Error(`${label}/${name}: global vertical scroll detected`);
    }
    if (name === 'science' && item.scienceCatalog?.overflowY !== 'auto') {
      throw new Error(`${label}/${name}: science catalog is not the internal scroll container`);
    }
    if (name === 'settings' && item.settingsContent?.overflowY !== 'auto') {
      throw new Error(`${label}/${name}: settings content is not the internal scroll container`);
    }
    results.push(item);
    await capture(win, directory, name);
  }

  if (width === 1920 && height === 1080) {
    await activateScreen(win, 'Настройки');
    await setTypographySlider(win, 'Подсказки и пояснения', 180);
    const helper180 = await metrics(win, 'settings-helper-180');
    if (helper180.typography.helper !== '1.8' || helper180.typography.hud !== '1') {
      throw new Error(`Typography isolation failed for helper scale: ${JSON.stringify(helper180.typography)}`);
    }
    results.push(helper180);
    await capture(win, directory, 'settings-helper-180');

    await setTypographySlider(win, 'Подсказки и пояснения', 100);
    await setTypographySlider(win, 'HUD / верхняя панель', 130);
    const hud130 = await metrics(win, 'settings-hud-130');
    if (hud130.typography.hud !== '1.3' || hud130.typography.helper !== '1') {
      throw new Error(`Typography isolation failed for HUD scale: ${JSON.stringify(hud130.typography)}`);
    }
    if (hud130.document.verticalScroll || hud130.document.longPageClass) {
      throw new Error('Typography scaling introduced global vertical scroll');
    }
    results.push(hud130);
    await capture(win, directory, 'settings-hud-130');
  }

  fs.writeFileSync(path.join(directory, 'metrics.json'), JSON.stringify(results, null, 2));
  win.destroy();
}

app.whenReady().then(async () => {
  try {
    fs.rmSync(OUTPUT, { recursive: true, force: true });
    fs.mkdirSync(OUTPUT, { recursive: true });
    for (const [width, height] of VIEWPORTS) await runViewport(width, height);
    app.exit(0);
  } catch (error) {
    console.error(error);
    app.exit(1);
  }
});
