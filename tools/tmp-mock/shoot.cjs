const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-gpu');
app.whenReady().then(async () => {
  const out = path.join(__dirname, '..', '..', 'visual-qa', 'fleet-planner', 'variants');
  fs.mkdirSync(out, { recursive: true });
  for (const [w, h] of [[1280, 720], [1920, 1080]]) {
    const win = new BrowserWindow({ width: w, height: h, show: false, useContentSize: true, webPreferences: { offscreen: false } });
    win.webContents.debugger.attach('1.3');
    await win.webContents.debugger.sendCommand('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false });
    for (const v of ['a', 'b', 'c']) {
      await win.loadFile(path.join(__dirname, 'fleet-planner.html'), { query: { v } });
      await win.webContents.executeJavaScript('document.fonts.ready.then(() => new Promise((r) => setTimeout(r, 400)))');
      const shot = await win.webContents.debugger.sendCommand('Page.captureScreenshot', { format: 'png' });
      fs.writeFileSync(path.join(out, `${v}-${w}x${h}.png`), Buffer.from(shot.data, 'base64'));
    }
    win.destroy();
  }
  app.quit();
});
