const { app, BrowserWindow, Menu, ipcMain } = require('electron');
const path = require('path');
const { registerSaveStore } = require('./save-store.cjs');
const { registerUpdater } = require('./updater.cjs');
const { registerCloud } = require('./cloud.cjs');
const { handleWindowKey } = require('./window-keys.cjs');

const WINDOW_PRESETS = {
  '1280x720': [1280, 720],
  '1600x900': [1600, 900],
  '1920x1080': [1920, 1080],
  '2560x1440': [2560, 1440],
};

function parseDisplayRequest(value) {
  if (!value || typeof value !== 'object') return null;
  const mode = value.mode;
  const preset = value.preset;
  if (mode !== 'fullscreen' && mode !== 'windowed') return null;
  if (typeof preset !== 'string' || !Object.hasOwn(WINDOW_PRESETS, preset)) return null;
  return { mode, preset };
}

function displayState(win) {
  const [width, height] = win.getContentSize();
  return { mode: win.isFullScreen() ? 'fullscreen' : 'windowed', width, height };
}

function emitDisplayState(win) {
  if (!win.isDestroyed()) win.webContents.send('asterion:display:state', displayState(win));
}

function applyDisplayRequest(win, request) {
  if (request.mode === 'fullscreen') {
    win.setFullScreen(true);
    return displayState(win);
  }

  const [width, height] = WINDOW_PRESETS[request.preset];
  win.setFullScreen(false);
  win.setContentSize(width, height);
  win.center();
  return displayState(win);
}

registerSaveStore();
registerUpdater();
registerCloud();

// «Выход» from the main menu.
ipcMain.on('asterion:app:quit', () => app.quit());

ipcMain.handle('asterion:display:get', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win) throw new Error('Desktop window is unavailable.');
  return displayState(win);
});

ipcMain.handle('asterion:display:set', (event, rawRequest) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win) throw new Error('Desktop window is unavailable.');
  const request = parseDisplayRequest(rawRequest);
  if (!request) throw new Error('Invalid display request.');
  const state = applyDisplayRequest(win, request);
  emitDisplayState(win);
  return state;
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
      // The world lives while the game is open: a minimized or covered window keeps its
      // one-second clock (Chromium would throttle it to once a minute), so a player who
      // switched away for a while does not come back to a catch-up (owner decision 31.10.2026).
      backgroundThrottling: false,
    },
  });

  // The game renders on a fixed 1920x1080 stage scaled by CSS — page zoom
  // (Ctrl+wheel, touchpad pinch, Ctrl+/-/0) rescales it and the UI appears to
  // magnify "infinitely". Pin zoom to 100% on every channel.
  win.webContents.setZoomFactor(1);
  win.webContents.setVisualZoomLevelLimits(1, 1);
  win.webContents.on('zoom-changed', () => {
    if (Math.abs(win.webContents.getZoomFactor() - 1) > 0.001) win.webContents.setZoomFactor(1);
  });

  win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));

  win.on('enter-full-screen', () => emitDisplayState(win));
  win.on('leave-full-screen', () => emitDisplayState(win));
  win.on('resize', () => emitDisplayState(win));

  win.webContents.on('before-input-event', (event, input) => handleWindowKey(win, event, input));

  win.once('ready-to-show', () => win.show());
}

app.whenReady().then(() => {
  createWindow();
  // Perf PR 1: one line in the log so a missing hardware acceleration or a 60 Hz monitor is visible.
  try {
    const { screen } = require('electron');
    console.log('[asterion] gpu', JSON.stringify(app.getGPUFeatureStatus()), 'displays', JSON.stringify(screen.getAllDisplays().map((display) => ({ hz: display.displayFrequency, size: display.size }))));
  } catch { /* diagnostics only */ }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
