// The desktop save store (electron/save-store.cjs) end to end through the real
// preload bridge: a 60-million-character value (a day-3 late-game save is ~58
// million; localStorage holds ~52 million) is written, read back, replaced and
// removed. Hidden window, disposable profile.
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { registerSaveStore } = require('./save-store.cjs');

app.disableHardwareAcceleration();
app.on('window-all-closed', () => {});
const PROFILE = fs.mkdtempSync(path.join(os.tmpdir(), 'asterion-save-store-qa-'));
app.setPath('userData', PROFILE);
const ROOT = path.join(__dirname, '..');
const KEY = 'asterion.slot.slot-qa-store.v1';
const CHARS = 60_000_000;

async function main() {
  await app.whenReady();
  registerSaveStore();
  const win = new BrowserWindow({ show: false, focusable: false, skipTaskbar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, sandbox: true } });
  await win.loadFile(path.join(ROOT, 'dist', 'index.html'));
  const result = await win.webContents.executeJavaScript(`(() => {
    const store = window.asterionDesktop?.saveStore;
    if (!store) return { error: 'no bridge' };
    const text = 'a'.repeat(${CHARS} - 1) + 'z';
    let t = performance.now(); store.write(${JSON.stringify(KEY)}, 'w1', text); const writeMs = performance.now() - t;
    t = performance.now(); const back = store.read(${JSON.stringify(KEY)}, 'w1'); const readMs = performance.now() - t;
    store.write(${JSON.stringify(KEY)}, 'w2', 'b'.repeat(10));
    const replaced = store.read(${JSON.stringify(KEY)}, 'w2');
    const previous = store.read(${JSON.stringify(KEY)}, 'w1');
    store.remove(${JSON.stringify(KEY)});
    const removed = store.read(${JSON.stringify(KEY)}, 'w2');
    let rejected = false; try { store.write('../escape', 'w3', 'x'); } catch { rejected = true; }
    return { same: back === text, writeMs: Math.round(writeMs), readMs: Math.round(readMs), replaced, previousKept: previous?.length, removed, rejected };
  })()`);
  const files = fs.existsSync(path.join(PROFILE, 'saves')) ? fs.readdirSync(path.join(PROFILE, 'saves')) : [];
  console.log(JSON.stringify({ ...result, filesLeft: files.length }, null, 2));
  if (result.error || !result.same || result.replaced !== 'bbbbbbbbbb' || result.previousKept !== CHARS || result.removed !== null
    || !result.rejected || files.length !== 0) throw new Error('Desktop save store QA failed.');
}

main().then(() => { try { fs.rmSync(PROFILE, { recursive: true, force: true }); } catch {} app.exit(0); },
  (error) => { console.error(error); app.exit(1); });
