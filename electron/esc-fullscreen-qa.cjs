// Audit 13.11 (2.11): in full screen the first Esc must reach the page (it opens the
// game menu / closes a window). Uses the same key handler as the game window
// (electron/window-keys.cjs). Esc must not leave full screen; F11 must.
const { app, BrowserWindow } = require('electron');
const { handleWindowKey } = require('./window-keys.cjs');

app.disableHardwareAcceleration();

const PAGE = `<!doctype html><meta charset="utf-8"><body style="background:#123">
<script>window.escCount=0;window.addEventListener('keydown',(e)=>{if(e.key==='Escape')window.escCount++;});</script></body>`;
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(check, ms = 5000) {
  const until = Date.now() + ms;
  while (Date.now() < until) { if (check()) return true; await wait(100); }
  return check();
}

app.whenReady().then(async () => {
  let failed = '';
  const expect = (condition, message) => { if (!condition && !failed) failed = message; };
  try {
    const win = new BrowserWindow({ width: 1280, height: 720, fullscreen: true, fullscreenable: true, show: true });
    win.webContents.on('before-input-event', (event, input) => handleWindowKey(win, event, input));
    await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(PAGE)}`);
    expect(await waitFor(() => win.isFullScreen()), 'window did not enter full screen');
    win.focus(); win.webContents.focus();
    const count = () => win.webContents.executeJavaScript('window.escCount');
    const press = async (keyCode) => {
      win.webContents.sendInputEvent({ type: 'keyDown', keyCode });
      win.webContents.sendInputEvent({ type: 'keyUp', keyCode });
      await wait(700);
    };
    await press('Escape');
    expect(await count() === 1, `first Esc did not reach the page (count=${await count()})`);
    expect(win.isFullScreen(), 'Esc left full screen');
    await press('F11');
    expect(await waitFor(() => !win.isFullScreen(), 3000), 'F11 did not leave full screen');
    await press('Escape');
    expect(await count() === 2, 'Esc in windowed mode did not reach the page');
    console.log(failed ? `FAIL: ${failed}` : 'esc-fullscreen-qa: OK (Esc reaches the page in full screen, F11 leaves it)');
  } catch (error) {
    failed = String(error && error.stack || error);
    console.log(`FAIL: ${failed}`);
  }
  app.exit(failed ? 1 : 0);
});
