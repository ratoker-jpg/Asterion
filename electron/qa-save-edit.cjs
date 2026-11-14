// Editing a save from QA without the running game writing over the edit.
//
// A running game owns its save: an autosave of the last tick, a throttled
// write waiting for its timer, the live world worker's save text on its way to
// the page, and the unload handlers (App.tsx `leave` / `onUnload`) that write
// the page's state once more when it goes away. Patching localStorage in the
// running page and reloading therefore races all of them; any of them can land
// after the patch and the reloaded game reads the old state (the flaky
// «Missing control [data-qa-create-alliance]», «Build queue did not persist»,
// unread badge 2 instead of 5, lost typed coordinate...).
//
// editSaveIdle takes the game out of the way first:
//   1. remember the game's URL and navigate the window to a page that has no
//      game (same file origin, so the same localStorage). The navigation runs
//      the game's own unload handlers, which write the true latest state, and
//      kills its workers and timers: nothing can write after this point;
//   2. run the caller's page-side `source` there - it reads the save as
//      stored (after the flush), changes it and writes it back;
//   3. load the game again, wait for it, check that the game really loaded the
//      edit (`held`, a page-side expression over the loaded game's save) and
//      wait until it takes commands again: a freshly loaded save with a gap
//      since its last NPC replay refuses commands («дождитесь завершения
//      обработки событий NPC») behind a progress banner, and a QA click or
//      event that lands in that window is dropped silently.
// There is no retry loop: a failure of `held` means a real problem and is thrown
// with the stored save's head for diagnosis instead of being hidden.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');
const { PARSE_SAVE } = require('./qa-save.cjs');

const IDLE_FILE = path.join(os.tmpdir(), 'asterion-qa-idle.html');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
// A reloaded seeded save replays the NPC gap behind a progress banner before the
// navigation exists; on a shared CI runner that took longer than the old 60 s
// (flaky «game boot» timeouts). The wait polls, so a fast boot still returns at once.
const BOOT_TIMEOUT_MS = 150_000;
const HELD_TIMEOUT_MS = 45_000;

function idleUrl() {
  if (!fs.existsSync(IDLE_FILE)) {
    fs.writeFileSync(IDLE_FILE, '<!doctype html><meta charset="utf-8"><title>Asterion QA idle</title><body>idle</body>');
  }
  return pathToFileURL(IDLE_FILE).href;
}

async function waitExpression(win, expression, timeoutMs, label) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await win.webContents.executeJavaScript(`Boolean(${expression})`)) return;
    await sleep(60);
  }
  throw new Error(`${label}: timed out waiting for: ${expression}`);
}

/**
 * Waits until the game takes player commands: one clock tick has passed since
 * the load (a gap since the last NPC replay is frozen into a catch-up on the
 * first tick) and neither the catch-up banner nor its summary is up.
 */
async function waitForCommands(win, timeoutMs = 180_000) {
  const banner = `document.querySelector('[data-qa-npc-catchup]')`;
  await sleep(1_500);
  const started = Date.now();
  let quiet = 0;
  while (quiet < 3) {
    if (Date.now() - started > timeoutMs) throw new Error('the game still refuses commands (NPC catch-up banner is up)');
    if (await win.webContents.executeJavaScript(`Boolean(${banner})`)) {
      quiet = 0;
      await win.webContents.executeJavaScript(`document.querySelector('[data-qa-npc-catchup-close]')?.click()`);
      await sleep(250);
    } else {
      quiet += 1;
      await sleep(200);
    }
  }
}

/**
 * @param {Electron.BrowserWindow} win a window showing the game
 * @param {string} source page-side expression (usually an IIFE) that edits storage; its value is returned.
 *   PARSE_SAVE (compact save -> plain object) is available as a function in this scope.
 * @param {object} [options]
 * @param {string} [options.ready] page-side expression, true when the reloaded game has booted
 *   (default: the primary navigation exists)
 * @param {string} [options.held] page-side expression, true when the reloaded game holds the edit
 * @param {number} [options.timeoutMs] boot and check timeout, default 150 s
 * @param {boolean} [options.commands] wait until the game takes commands (default true)
 * @param {string} [options.url] load this instead of the page the window showed
 * @param {string} [options.label] names the edit in errors
 */
async function editSaveIdle(win, source, options = {}) {
  const { ready = `document.querySelector('[data-qa-navigation="utility"]')`, held, timeoutMs = BOOT_TIMEOUT_MS, label = 'save edit', commands = true } = options;
  const gameUrl = options.url || win.webContents.getURL();
  if (!gameUrl || gameUrl === idleUrl()) throw new Error(`${label}: the window shows no game page to return to (${gameUrl || 'empty url'})`);

  await win.loadURL(idleUrl());
  await waitExpression(win, `document.readyState === 'complete'`, 10_000, label);
  const result = await win.webContents.executeJavaScript(`(() => { const PARSE_SAVE = ${PARSE_SAVE}; return (${source}); })()`);

  await win.loadURL(gameUrl);
  await waitExpression(win, `document.readyState === 'complete'`, timeoutMs, label);
  await waitExpression(win, ready, timeoutMs, `${label} (game boot)`);
  if (held) {
    try {
      await waitExpression(win, held, Math.min(timeoutMs, HELD_TIMEOUT_MS), label);
    } catch (error) {
      throw new Error(`${label}: the reloaded game does not hold the edit. ${error.message}`);
    }
  }
  if (commands) await waitForCommands(win);
  return result;
}

/** The edit as a page-side function of the parsed save: `edit(save)` mutates it, `after` is the key to write. */
function patchSaveSource(key, editSource) {
  return `(() => {
    const raw = localStorage.getItem(${JSON.stringify(key)});
    const save = PARSE_SAVE(raw || '{}');
    (${editSource})(save);
    localStorage.setItem(${JSON.stringify(key)}, JSON.stringify(save));
    return true;
  })()`;
}

/** The same edit, as one call: stored save -> `editSource(save)` -> stored, game reloaded. */
function patchSaveIdle(win, key, editSource, options = {}) {
  return editSaveIdle(win, patchSaveSource(key, editSource), options);
}

/** Removes keys while the game is not running, then loads the game again. */
function removeKeysIdle(win, keys, options = {}) {
  return editSaveIdle(win, `(() => { for (const key of ${JSON.stringify(keys)}) localStorage.removeItem(key); return true; })()`, options);
}

module.exports = { waitForCommands, editSaveIdle, patchSaveIdle, patchSaveSource, removeKeysIdle };
