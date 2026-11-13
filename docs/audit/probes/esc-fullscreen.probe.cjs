// Opus audit probe (13.11.2026), not part of any suite: does Esc reach the page
// while the window is full screen? The before-input-event handler below is a
// verbatim copy of electron/main.cjs (Escape / F11 part). The page counts keydown
// Escape events the way App.tsx's pause-menu listener would see them.
// Run: npx electron docs/audit/probes/esc-fullscreen.probe.cjs
const { app, BrowserWindow } = require('electron');

const PAGE = `<!doctype html><meta charset="utf-8"><body style="background:#123">
<script>window.escCount=0;window.addEventListener('keydown',(e)=>{if(e.key==='Escape')window.escCount++;});</script></body>`;

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(check, ms = 5000) {
  const until = Date.now() + ms;
  while (Date.now() < until) { if (check()) return true; await wait(100); }
  return check();
}

app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 1280, height: 720, fullscreen: true, fullscreenable: true, show: true });
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
  await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(PAGE)}`);
  await waitFor(() => win.isFullScreen());
  win.focus(); win.webContents.focus();
  const count = () => win.webContents.executeJavaScript('window.escCount');
  const press = async () => {
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
    await wait(700);
  };
  const rows = [];
  rows.push({ step: 'start', fullScreen: win.isFullScreen(), pageEsc: await count() });
  await press();
  await waitFor(() => !win.isFullScreen(), 3000);
  rows.push({ step: 'Esc #1', fullScreen: win.isFullScreen(), pageEsc: await count() });
  await press();
  rows.push({ step: 'Esc #2', fullScreen: win.isFullScreen(), pageEsc: await count() });
  console.table(rows);
  const first = rows[1];
  console.log('VERDICT', first.pageEsc === 0 ? 'ESC-SWALLOWED-IN-FULLSCREEN' : 'ESC-REACHES-PAGE',
    '| second Esc reaches page:', rows[2].pageEsc > first.pageEsc);
  app.exit(0);
});
