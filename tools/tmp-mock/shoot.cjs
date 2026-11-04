const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-gpu');
app.on('window-all-closed', () => {});
app.whenReady().then(async () => {
  try {
    const out = path.join(__dirname, '..', '..', 'visual-qa', 'fleet-planner', 'variants');
    fs.mkdirSync(out, { recursive: true });
    const win = new BrowserWindow({ width: 1000, height: 700, show: false, webPreferences: { offscreen: true } });
    await win.loadFile(path.join(__dirname, 'fleet-planner.html'), { query: { v: 'a' } });
    win.webContents.debugger.attach('1.3');
    for (const [w, h] of [[1280, 720], [1920, 1080]]) {
      await win.webContents.debugger.sendCommand('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false, screenWidth: w, screenHeight: h });
      for (const v of ['a', 'b', 'c']) {
        await win.loadFile(path.join(__dirname, 'fleet-planner.html'), { query: { v } });
        await win.webContents.executeJavaScript('document.fonts.ready.then(() => new Promise((r) => setTimeout(r, 400)))');
        const shot = await win.webContents.debugger.sendCommand('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: false });
        fs.writeFileSync(path.join(out, `${v}-${w}x${h}.png`), Buffer.from(shot.data, 'base64'));
      }
    }
    win.webContents.debugger.detach();
    win.destroy();
    app.exit(0);
  } catch (error) {
    console.error(error);
    app.exit(1);
  }
});
