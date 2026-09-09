const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-gpu');
app.on('window-all-closed', () => {});

const ROOT = path.join(__dirname, '..');
const OUTPUT = path.join(process.env.TEMP || ROOT, 'asterion-header-factions');
const FACTIONS = ['aegis', 'synod', 'veyra'];
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function settle(win) {
  await win.webContents.executeJavaScript('new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
  await sleep(80);
}

async function capture(win, name) {
  const result = await win.webContents.debugger.sendCommand('Page.captureScreenshot', {
    format: 'png', fromSurface: true, captureBeyondViewport: false,
  });
  fs.writeFileSync(path.join(OUTPUT, `${name}.png`), Buffer.from(result.data, 'base64'));
}

app.whenReady().then(async () => {
  let win;
  try {
    fs.rmSync(OUTPUT, { recursive: true, force: true });
    fs.mkdirSync(OUTPUT, { recursive: true });
    win = new BrowserWindow({
      width: 1000, height: 700, show: false, backgroundColor: '#02050a',
      webPreferences: { offscreen: true, contextIsolation: true, nodeIntegration: false, partition: 'qa-header-factions' },
    });
    win.webContents.debugger.attach('1.3');
    await win.webContents.debugger.sendCommand('Emulation.setDeviceMetricsOverride', {
      width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false, screenWidth: 1920, screenHeight: 1080,
    });

    const results = [];
    for (const faction of FACTIONS) {
      await win.loadURL(`${pathToFileURL(path.join(ROOT, 'dist', 'index.html')).toString()}?headerFaction=${faction}`);
      await win.webContents.executeJavaScript('document.fonts?.ready');
      await settle(win);
      const state = await win.webContents.executeJavaScript(`(() => {
        const population = document.querySelector('.resource-chip--population strong')?.textContent?.trim() ?? '';
        const fill = document.querySelector('.resource-chip--population .resource-fill i');
        return {
          faction: document.documentElement.dataset.headerFaction,
          population,
          populationHasCapacity: population.includes('/'),
          fillWidth: fill?.style.getPropertyValue('--fill') ?? '',
        };
      })()`);
      if (state.faction !== faction || state.populationHasCapacity || !state.fillWidth) {
        throw new Error(`Header contract failed for ${faction}: ${JSON.stringify(state)}`);
      }
      results.push(state);
      await capture(win, faction);
    }
    fs.writeFileSync(path.join(OUTPUT, 'metrics.json'), JSON.stringify(results, null, 2));
    win.webContents.debugger.detach();
    win.destroy();
    app.exit(0);
  } catch (error) {
    console.error(error);
    try { if (win?.webContents.debugger.isAttached()) win.webContents.debugger.detach(); } catch {}
    win?.destroy();
    app.exit(1);
  }
});
