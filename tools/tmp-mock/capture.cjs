const { app, BrowserWindow } = require('electron');
const path = require('path'); const fs = require('fs');
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-gpu');
app.on('window-all-closed', () => {});
const OUT = path.join(__dirname, '..', '..', 'visual-qa', 'recycling-center-redo', 'variants');
app.whenReady().then(async () => {
  try {
    fs.mkdirSync(OUT, { recursive: true });
    const win = new BrowserWindow({ width: 1000, height: 700, show: false, backgroundColor: '#02050a', webPreferences: { offscreen: true, contextIsolation: true, sandbox: true } });
    await win.loadFile(path.join(__dirname, 'index.html'), { search: '?v=a' });
    win.webContents.debugger.attach('1.3');
    await win.webContents.debugger.sendCommand('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false, screenWidth: 1920, screenHeight: 1080 });
    for (const v of ['a', 'b', 'c']) {
      await win.loadFile(path.join(__dirname, 'index.html'), { search: `?v=${v}` });
      await new Promise((r) => setTimeout(r, 1500));
      const shot = await win.webContents.debugger.sendCommand('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: false });
      fs.writeFileSync(path.join(OUT, `variant-${v}.png`), Buffer.from(shot.data, 'base64'));
      console.log('captured', v);
    }
    app.exit(0);
  } catch (e) { console.error(e); app.exit(1); }
});
