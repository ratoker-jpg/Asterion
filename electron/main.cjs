const { app, BrowserWindow, Menu, ipcMain } = require('electron');
const path = require('path');

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
    },
  });

  win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));

  win.on('enter-full-screen', () => emitDisplayState(win));
  win.on('leave-full-screen', () => emitDisplayState(win));
  win.on('resize', () => emitDisplayState(win));

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
