// Renders mocks.html#<variant> to PNG (run in CI, never on the player's PC):
//   npx electron visual-qa/fleet-redo/mocks/render-mocks.cjs --out=<dir>
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-gpu');
app.on('window-all-closed', () => {});

app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 1920, height: 1080, useContentSize: true, show: false, webPreferences: { offscreen: true } });
  win.webContents.debugger.attach('1.3');
  await win.webContents.debugger.sendCommand('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false });
  const out = process.argv.find((arg) => arg.startsWith('--out='))?.slice(6) || __dirname;
  fs.mkdirSync(out, { recursive: true });
  for (const id of ['aMain', 'aShips', 'bMain', 'bShips', 'cMain', 'cShips']) {
    await win.loadFile(path.join(__dirname, 'mocks.html'), { hash: id });
    await new Promise((resolve) => setTimeout(resolve, 900));
    const shot = await win.webContents.debugger.sendCommand('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(out, `variant-${id}.png`), Buffer.from(shot.data, 'base64'));
  }
  app.exit(0);
});
