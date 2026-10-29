// Game updates (docs/RELEASES.md): the installed game asks GitHub Releases
// for a newer vX.Y.Z through electron-updater, downloads it in the background
// and installs it only when the player presses «Перезапустить и обновить».
// The renderer writes its saves first (src/ui/menu/updates.ts), then asks for
// the install. Dev runs, QA scripts (they never load main.cjs) and
// ASTERION_DISABLE_UPDATES=1 never touch the network.
const { app, BrowserWindow, ipcMain } = require('electron');

/** First automatic check after start: the menu is up and the save loaded. */
const STARTUP_CHECK_DELAY_MS = 4000;

let state = { status: 'idle' };
let updater = null;

function publicState() {
  return { ...state, currentVersion: app.getVersion(), enabled: Boolean(updater) };
}

function setState(next) {
  state = next;
  const payload = publicState();
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send('asterion:update:state', payload);
  }
}

function errorText(error) {
  const text = String(error && error.message || error || '');
  // Offline, DNS, proxy, GitHub rate limit: the player only needs to know it did not work.
  if (/ENOTFOUND|ECONNREFUSED|ECONNRESET|ETIMEDOUT|EAI_AGAIN|ERR_INTERNET_DISCONNECTED|ERR_NETWORK|net::|socket hang up|getaddrinfo/i.test(text)) {
    return 'Нет связи с сервером обновлений';
  }
  return 'Не удалось проверить обновления';
}

function check() {
  if (!updater) return;
  if (state.status === 'checking' || state.status === 'downloading' || state.status === 'downloaded') return;
  updater.checkForUpdates().catch(() => { /* reported by the 'error' event */ });
}

function registerUpdater() {
  const enabled = app.isPackaged && process.env.ASTERION_DISABLE_UPDATES !== '1';
  if (enabled) {
    ({ autoUpdater: updater } = require('electron-updater'));
    updater.autoDownload = true;
    // Never installs on its own: only the player's button does.
    updater.autoInstallOnAppQuit = false;
    updater.allowPrerelease = false;
    updater.allowDowngrade = false;
    updater.logger = null;
    updater.on('checking-for-update', () => setState({ status: 'checking' }));
    updater.on('update-available', (info) => setState({ status: 'available', version: info.version }));
    updater.on('update-not-available', () => setState({ status: 'latest' }));
    updater.on('download-progress', (progress) => setState({
      status: 'downloading',
      version: state.version,
      percent: Math.max(0, Math.min(100, Math.floor(progress.percent || 0))),
    }));
    updater.on('update-downloaded', (info) => setState({ status: 'downloaded', version: info.version }));
    updater.on('error', (error) => {
      // A failed download keeps nothing half-installed; the next check starts over.
      console.warn('[updater]', error && error.message || error);
      setState({ status: 'error', message: errorText(error), version: state.version });
    });
  }

  ipcMain.handle('asterion:update:get', () => publicState());
  ipcMain.handle('asterion:update:check', () => {
    check();
    return publicState();
  });
  // The renderer has flushed the saves synchronously before this call.
  ipcMain.handle('asterion:update:install', () => {
    if (!updater || state.status !== 'downloaded') return { ok: false };
    setImmediate(() => updater.quitAndInstall(true, true));
    return { ok: true };
  });

  if (enabled) app.whenReady().then(() => setTimeout(check, STARTUP_CHECK_DELAY_MS));
}

module.exports = { registerUpdater };
