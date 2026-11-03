// Renders mocks.html#m1..#m5 to PNG next to this file:
//   npx electron visual-qa/ops-speed-audit/mocks/render-mocks.cjs
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

app.disableHardwareAcceleration();
app.on('window-all-closed', () => {});

const NAMES = {
  m1: 'm1-multi-source-attack',
  m2: 'm2-gather-to-planet',
  m3: 'm3-fleet-keeps-target',
  m4: 'm4-report-actions',
  m5: 'm5-empire-overview',
};

app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 1280, height: 720, useContentSize: true, show: false, webPreferences: { offscreen: true } });
  for (const [id, name] of Object.entries(NAMES)) {
    await win.loadFile(path.join(__dirname, 'mocks.html'), { hash: id });
    await new Promise((resolve) => setTimeout(resolve, 600));
    const image = await win.webContents.capturePage();
    fs.writeFileSync(path.join(__dirname, `${name}.jpg`), image.toJPEG(85));
  }
  app.exit(0);
});
