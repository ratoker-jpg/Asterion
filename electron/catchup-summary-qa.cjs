// The world news window after an absence (owner decision 31.10.2026): a
// campaign left 2 h 59 min ago is caught up quietly — no summary window and its
// news are not kept in the save; one left 3 h 01 min ago shows «Мир за время
// вашего отсутствия». Each case is a fresh Electron profile with a small
// production campaign (tools/cloud-qa-world.mjs) opened by «Продолжить»
// (autostart), as the built game runs it.
//
//   npm run test:catchup-summary-ui
const { app, BrowserWindow } = require('electron');
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SLOT_ID = 'slot-summaryqa-0001';
const SLOT_KEY = `asterion.slot.${SLOT_ID}.v1`;
const OUT_DIR = path.join(ROOT, 'visual-qa', 'catchup-summary');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const CASES = [{ minutes: 179, summary: false }, { minutes: 181, summary: true }];

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'asterion-summary-qa-'));
app.setPath('userData', path.join(temp, 'profile'));
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-background-timer-throttling');

async function waitFor(win, expression, timeoutMs = 120_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await win.webContents.executeJavaScript(`Boolean(${expression})`)) return true;
    await sleep(100);
  }
  throw new Error(`Timed out waiting for: ${expression}`);
}

function world(minutesAgo) {
  const file = path.join(temp, `world-${minutesAgo}.json`);
  const loader = require('url').pathToFileURL(path.join(ROOT, 'src/domain/combat/test-asset-loader.mjs')).href;
  const made = spawnSync(process.env.ASTERION_QA_NODE || 'node', ['--experimental-strip-types', '--no-warnings', '--experimental-loader', loader,
    path.join(ROOT, 'tools/cloud-qa-world.mjs'), file, '6', String(Date.now() - minutesAgo * 60_000)], { cwd: ROOT, encoding: 'utf8' });
  if (made.status !== 0) throw new Error(made.stderr);
  return fs.readFileSync(file, 'utf8');
}

async function runCase(win, { minutes, summary: expected }) {
  const text = world(minutes);
  await win.loadFile(path.join(ROOT, 'dist', 'index.html'));
  const meta = { id: SLOT_ID, name: 'Итоги QA', createdAt: Date.now(), updatedAt: Date.now(), playTimeMs: 0, factionId: 'aegis', playerName: 'QA',
    campaignSpeed: 'standard', schemaVersion: Number(/"schemaVersion":(\d+)/.exec(text)[1]), storageKey: SLOT_KEY, mode: 'production',
    summary: { planets: 1, npcCount: 6, galaxyCount: 1, days: 0, crystals: 0, victory: false } };
  await win.webContents.executeJavaScript(`(() => {
    localStorage.clear();
    localStorage.setItem(${JSON.stringify(SLOT_KEY)}, ${JSON.stringify(text)});
    localStorage.setItem('asterion.slots.index.v1', ${JSON.stringify(JSON.stringify({ version: 1, activeSlotId: SLOT_ID, slots: [meta] }))});
  })()`);
  await win.loadFile(path.join(ROOT, 'dist', 'index.html'), { search: '?autostart=continue' });
  // What the catch-up windows show from here on.
  await win.webContents.executeJavaScript(`(() => {
    const seen = window.__summaryQa = { progress: false, summary: false };
    new MutationObserver(() => {
      if (document.querySelector('[data-qa-npc-catchup="progress"]')) seen.progress = true;
      if (document.querySelector('[data-qa-npc-catchup="summary"]')) seen.summary = true;
    }).observe(document, { childList: true, subtree: true });
  })()`);
  await waitFor(win, `document.querySelector('[data-qa-navigation="utility"]')`);
  const saved = `(() => { try { return JSON.parse(localStorage.getItem(${JSON.stringify(SLOT_KEY)})).npcReplay; } catch { return null; } })()`;
  // Caught up: the replay cursor reached the clock.
  await waitFor(win, `(() => { const replay = ${saved}; return replay && replay.targetAt <= replay.processedThroughAt && Date.now() - replay.processedThroughAt < 120000; })()`, 300_000);
  await sleep(2_500);
  const result = await win.webContents.executeJavaScript(`({
    ...window.__summaryQa,
    summaryOnScreen: Boolean(document.querySelector('[data-qa-npc-catchup="summary"]')),
    title: document.querySelector('[data-qa-npc-catchup="summary"] small')?.textContent ?? null,
    savedSummary: Boolean(${saved}?.summary),
  })`);
  if (result.summaryOnScreen && !process.env.ASTERION_SKIP_SCREENSHOTS) {
    fs.mkdirSync(OUT_DIR, { recursive: true });
    fs.writeFileSync(path.join(OUT_DIR, `summary-${minutes}min.png`), (await win.webContents.capturePage()).toPNG());
  }
  const ok = expected ? result.summaryOnScreen : !result.summary && !result.savedSummary;
  console.log(JSON.stringify({ minutes, expected, ...result, ok }));
  return ok;
}

app.whenReady().then(async () => {
  let failed = false;
  const win = new BrowserWindow({ show: false, width: 1600, height: 900, backgroundColor: '#02050a',
    webPreferences: { contextIsolation: true, sandbox: true, backgroundThrottling: false, offscreen: true } });
  try {
    for (const item of CASES) if (!(await runCase(win, item))) failed = true;
  } catch (error) {
    console.error(error);
    failed = true;
  }
  win.destroy();
  try { fs.rmSync(temp, { recursive: true, force: true }); } catch { /* Chromium may still hold files */ }
  console.log(failed ? 'Catch-up summary QA failed.' : 'Catch-up summary QA passed: 2 h 59 min quiet, 3 h 01 min with the world news.');
  app.exit(failed ? 1 : 0);
});
