// Game updates (docs/RELEASES.md): the installed game asks the game server's
// mirror, and when that is unreachable GitHub Releases, for a newer vX.Y.Z
// through electron-updater, downloads it in the background
// and installs it only when the player presses «Перезапустить и обновить».
// The renderer writes its saves first (src/ui/menu/updates.ts), then asks for
// the install. Dev runs, QA scripts (they never load main.cjs) and
// ASTERION_DISABLE_UPDATES=1 never touch the network.
const { app, BrowserWindow, ipcMain } = require('electron');
const { feedList, classifyError, retryDelaySeconds, retryText, createFileLogger } = require('./updater-core.cjs');

/** First automatic check after start: the menu is up and the save loaded. */
const STARTUP_CHECK_DELAY_MS = 4000;

let state = { status: 'idle' };
let updater = null;
let log = null;
let feeds = [];
let feedIndex = 0;
/** What the updater is doing now: 'download' once an update was found (tells a failed check from a failed download). */
let phase = 'check';
let attempt = 0;
let retryTimer = null;

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

function useFeed(index) {
  feedIndex = index;
  const feed = feeds[index];
  updater.setFeedURL(feed.options);
  // A ranged (differential) download works from the server, not from GitHub.
  updater.disableDifferentialDownload = !feed.differential;
  log.info(`feed: ${feed.name}`);
}

function runCheck() {
  phase = 'check';
  updater.checkForUpdates().catch(() => { /* reported by the 'error' event */ });
}

function check(manual) {
  if (!updater) return;
  if (state.status === 'checking' || state.status === 'downloading' || state.status === 'downloaded') return;
  if (manual) {
    clearTimeout(retryTimer);
    retryTimer = null;
    attempt = 0;
  } else if (retryTimer && state.status === 'error') {
    return; // a retry is already waiting
  }
  useFeed(0);
  runCheck();
}

function onError(error) {
  const { kind, message } = classifyError(error, phase);
  log.error(`${kind} (feed ${feeds[feedIndex].name}, phase ${phase}):`, error);
  // The next source quietly; a download starts over there (the library keeps no half-loaded file).
  if (feedIndex < feeds.length - 1) {
    useFeed(feedIndex + 1);
    setState({ status: 'checking', version: state.version });
    setTimeout(runCheck, 1500);
    return;
  }
  const delay = retryDelaySeconds(attempt);
  attempt += 1;
  setState({
    status: 'error',
    kind,
    message: delay === null ? message : `${message} · ${retryText(delay)}`,
    retrying: delay !== null,
    version: state.version,
  });
  clearTimeout(retryTimer);
  retryTimer = null;
  if (delay !== null) {
    retryTimer = setTimeout(() => {
      retryTimer = null;
      check(false);
    }, delay * 1000);
  }
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
    log = createFileLogger(app.getPath('logs'));
    updater.logger = log;
    feeds = feedList();
    log.info(`start: game ${app.getVersion()}, feeds ${feeds.map((feed) => feed.name).join(' → ')}`);
    updater.on('checking-for-update', () => setState({ status: 'checking' }));
    updater.on('update-available', (info) => {
      phase = 'download';
      log.info(`update available: ${info.version}`);
      setState({ status: 'available', version: info.version });
    });
    updater.on('update-not-available', () => {
      // The mirror can lag a release by up to ~30 min: before saying «latest», ask GitHub too (one small file).
      if (feedIndex < feeds.length - 1) {
        log.info('mirror has no newer version, asking the next feed');
        useFeed(feedIndex + 1);
        setTimeout(runCheck, 500);
        return;
      }
      attempt = 0;
      setState({ status: 'latest' });
    });
    updater.on('download-progress', (progress) => setState({
      status: 'downloading',
      version: state.version,
      percent: Math.max(0, Math.min(100, Math.floor(progress.percent || 0))),
      transferredMb: Math.floor((progress.transferred || 0) / 1e6),
      totalMb: Math.floor((progress.total || 0) / 1e6),
    }));
    updater.on('update-downloaded', (info) => {
      attempt = 0;
      clearTimeout(retryTimer);
      retryTimer = null;
      log.info(`downloaded: ${info.version}`);
      setState({ status: 'downloaded', version: info.version });
    });
    updater.on('error', onError);
  }

  ipcMain.handle('asterion:update:get', () => publicState());
  ipcMain.handle('asterion:update:check', () => {
    check(true);
    return publicState();
  });
  // The renderer has flushed the saves synchronously before this call.
  ipcMain.handle('asterion:update:install', () => {
    if (!updater || state.status !== 'downloaded') return { ok: false };
    setImmediate(() => updater.quitAndInstall(true, true));
    return { ok: true };
  });

  if (enabled) app.whenReady().then(() => setTimeout(() => check(true), STARTUP_CHECK_DELAY_MS));
}

module.exports = { registerUpdater };
