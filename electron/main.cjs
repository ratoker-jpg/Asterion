const { app, BrowserWindow, Menu, ipcMain } = require('electron');
const path = require('path');
const {
  formatWindowResolution,
  isWindowMode,
  parseWindowResolution,
} = require('./window-settings.cjs');

function getSenderWindow(event) {
  return BrowserWindow.fromWebContents(event.sender);
}

function getDisplaySettings(win) {
  if (!win || win.isDestroyed()) return null;
  const [width, height] = win.getContentSize();
  const fullscreen = win.isFullScreen();
  return {
    mode: fullscreen ? 'fullscreen' : 'windowed',
    resolution: formatWindowResolution(width, height),
    fullscreen,
  };
}

ipcMain.handle('asterion:get-display-settings', (event) => {
  const win = getSenderWindow(event);
  return getDisplaySettings(win);
});

ipcMain.handle('asterion:set-window-mode', (event, mode) => {
  const win = getSenderWindow(event);
  if (!win || win.isDestroyed()) return { ok: false, reason: 'window-unavailable' };
  if (!isWindowMode(mode)) return { ok: false, reason: 'invalid-window-mode', settings: getDisplaySettings(win) };
  win.setFullScreen(mode === 'fullscreen');
  return { ok: true, settings: getDisplaySettings(win) };
});

ipcMain.handle('asterion:set-window-size', (event, resolution) => {
  const win = getSenderWindow(event);
  if (!win || win.isDestroyed()) return { ok: false, reason: 'window-unavailable' };
  const parsed = parseWindowResolution(resolution);
  if (!parsed) return { ok: false, reason: 'invalid-window-resolution', settings: getDisplaySettings(win) };
  if (win.isFullScreen()) return { ok: false, reason: 'fullscreen', settings: getDisplaySettings(win) };
  win.setContentSize(parsed.width, parsed.height, true);
  win.center();
  return { ok: true, settings: getDisplaySettings(win) };
});

function createWindow() {
  Menu.setApplicationMenu(null);

  const win = new BrowserWindow({
    width: 1920,
    height: 1080,
    useContentSize: true,
    minWidth: 1280,
    minHeight: 720,
    backgroundColor: '#02050a',
    title: 'Asterion',
    autoHideMenuBar: true,
    fullscreen: true,
    fullscreenable: true,
    resizable: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));

  win.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return;

    if (input.key === 'F11') {
      event.preventDefault();
      win.setFullScreen(!win.isFullScreen());
    }

    if (input.key === 'Escape' && win.isFullScreen()) {
      event.preventDefault();
      win.setFullScreen(false);
    }
  });

  win.once('ready-to-show', () => win.show());
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
