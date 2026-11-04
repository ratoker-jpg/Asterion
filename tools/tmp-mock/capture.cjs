const { app, BrowserWindow } = require('electron');
const path = require('path'); const fs = require('fs');
app.disableHardwareAcceleration();
const OUT = path.join(__dirname, '..', '..', 'visual-qa', 'recycling-center-redo', 'variants');
app.whenReady().then(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const win = new BrowserWindow({ width: 1920, height: 1080, show: false, useContentSize: true, webPreferences: { offscreen: true } });
  win.webContents.debugger.attach('1.3');
  await win.webContents.debugger.sendCommand('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false });
  for (const v of ['a', 'b', 'c']) {
    await win.loadFile(path.join(__dirname, 'index.html'), { search: `?v=${v}` });
    await new Promise((r) => setTimeout(r, 1500));
    const shot = await win.webContents.debugger.sendCommand('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(OUT, `variant-${v}.png`), Buffer.from(shot.data, 'base64'));
  }
  app.exit(0);
});
