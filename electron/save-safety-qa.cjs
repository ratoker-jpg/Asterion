// F-01 / F-04 QA: real menu clicks against unreadable saves in an isolated profile.
// Continue, Load and autostart must refuse corrupt / newer / malformed slots and
// leave their bytes untouched; a damaged slot index must not hide stored slots.
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');

app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-gpu');
app.on('window-all-closed', () => {});
// Never touch a real profile: every run gets a fresh user-data directory.
const PROFILE = fs.mkdtempSync(path.join(os.tmpdir(), 'asterion-save-safety-'));
app.setPath('userData', PROFILE);

const ROOT = path.join(__dirname, '..');
const OUTPUT = process.env.ASTERION_QA_OUTPUT || path.join(ROOT, 'artifacts', 'save-safety-qa');
const INDEX_KEY = 'asterion.slots.index.v1';
const LEGACY_KEY = 'asterion.vertical-slice.v1';
const BROKEN = '{broken-save-bytes-runtime}';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const run = (win, source) => win.webContents.executeJavaScript(source);

async function waitFor(win, expression, timeoutMs = 15_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await run(win, `Boolean(${expression})`)) return;
    await sleep(80);
  }
  throw new Error(`Timed out waiting for: ${expression}`);
}

async function load(win, search) {
  const done = new Promise((resolve) => win.webContents.once('did-finish-load', resolve));
  await win.loadFile(path.join(ROOT, 'dist', 'index.html'), search ? { search } : undefined);
  await done;
  await sleep(300);
}

async function click(win, selector) {
  const ok = await run(win, `(() => { const node = document.querySelector(${JSON.stringify(selector)}); if (!node || node.disabled) return false; node.click(); return true; })()`);
  if (!ok) throw new Error(`Missing or disabled control: ${selector}`);
  await sleep(250);
}

const getItem = (win, key) => run(win, `localStorage.getItem(${JSON.stringify(key)})`);

/** Replaces all storage with the given index text and slot payloads. */
async function seed(win, indexText, payloads) {
  await run(win, `(() => {
    localStorage.clear(); sessionStorage.clear();
    ${indexText === null ? '' : `localStorage.setItem(${JSON.stringify(INDEX_KEY)}, ${JSON.stringify(indexText)});`}
    for (const [key, value] of ${JSON.stringify(Object.entries(payloads))}) localStorage.setItem(key, value);
  })()`);
}

function indexFor(slots) {
  return JSON.stringify({ version: 1, activeSlotId: slots[0]?.id ?? null, slots: slots.map(({ id, name, updatedAt = 1 }) => ({ id, name, updatedAt, createdAt: 1, schemaVersion: 24 })) });
}

const slotKey = (id) => `asterion.slot.${id}.v1`;

async function assertRefused(win, label, key, payload, entry) {
  await waitFor(win, `document.querySelector('[role="alertdialog"][aria-label*="не загружена"]')`);
  if (await run(win, `Boolean(document.querySelector('[data-qa-navigation="utility"]'))`)) throw new Error(`${label}: the game mounted on an unreadable slot`);
  await sleep(2_500); // longer than several autosave ticks of a mounted game
  const after = await getItem(win, key);
  if (after !== payload) throw new Error(`${label}: ${entry} changed the slot bytes (${String(after).slice(0, 80)})`);
  const text = await run(win, `document.querySelector('[role="alertdialog"]')?.textContent || ''`);
  if (!/не изменены/.test(text)) throw new Error(`${label}: the refusal does not tell the player the data is untouched: ${text}`);
  return text.trim().slice(0, 200);
}

async function scenario(win, label, payload) {
  const key = slotKey('slot-qa-problem');
  // Continue from the main menu.
  await seed(win, indexFor([{ id: 'slot-qa-problem', name: `QA ${label}` }]), { [key]: payload });
  await load(win);
  await waitFor(win, `document.querySelector('[data-qa-menu="main"]')`);
  await click(win, '[data-qa-menu-action="continue"]');
  const continueText = await assertRefused(win, label, key, payload, 'Continue');
  // «К сохранениям» opens Load: the card is marked and its Load button is disabled.
  await click(win, '[data-qa-confirm-yes]');
  await waitFor(win, `document.querySelector('[data-qa-load-screen] [data-qa-slot="slot-qa-problem"]')`);
  const card = await run(win, `(() => ({
    problem: document.querySelector('[data-qa-slot="slot-qa-problem"] .menu-slot__problem')?.textContent || '',
    loadDisabled: Boolean(document.querySelector('[data-qa-slot-load="slot-qa-problem"]')?.disabled),
  }))()`);
  if (!card.problem || !card.loadDisabled) throw new Error(`${label}: Load card does not block the slot ${JSON.stringify(card)}`);
  // Autostart (desktop shortcut / QA entry) goes through the same gate.
  await load(win, '?autostart=continue');
  await assertRefused(win, label, key, payload, 'autostart');
  if ((await getItem(win, LEGACY_KEY)) !== null) throw new Error(`${label}: autostart seeded a new campaign next to the refused one`);
  return { continueText, card };
}

async function main() {
  await app.whenReady();
  const win = new BrowserWindow({ show: false, width: 1280, height: 720, webPreferences: { contextIsolation: true, sandbox: true } });
  const results = { profile: PROFILE };

  // A real, current save: what a fresh autostart writes.
  await load(win);
  await seed(win, null, {});
  await load(win, '?autostart=continue');
  await waitFor(win, `document.querySelector('[data-qa-navigation="utility"]')`, 30_000);
  await sleep(1_500);
  const valid = await getItem(win, LEGACY_KEY);
  if (!valid) throw new Error('autostart did not create the starting campaign');
  const parsed = JSON.parse(valid);
  const newer = JSON.stringify({ ...parsed, schemaVersion: parsed.schemaVersion + 10, futureCriticalField: { keep: true } });
  const nullHome = JSON.stringify({ ...parsed, planets: { ...parsed.planets, 'helion-01': null } });

  results.corrupt = await scenario(win, 'corrupt', BROKEN);
  results.newer = await scenario(win, 'newer', newer);
  results.malformed = await scenario(win, 'malformed', nullHome);

  // F-04: a damaged index must not hide the stored slots, and the raw index is kept.
  await seed(win, '{broken-index', { [slotKey('slot-qa-one')]: valid, [slotKey('slot-qa-two')]: valid });
  await load(win, undefined);
  await waitFor(win, `document.querySelector('[data-qa-menu="main"]')`);
  await click(win, '[data-qa-menu-action="load"]');
  await waitFor(win, `document.querySelectorAll('[data-qa-slot]').length >= 2`);
  const listed = await run(win, `[...document.querySelectorAll('[data-qa-slot]')].map((node) => node.getAttribute('data-qa-slot')).sort()`);
  if (JSON.stringify(listed) !== JSON.stringify(['slot-qa-one', 'slot-qa-two'])) throw new Error(`damaged index hid slots: ${JSON.stringify(listed)}`);
  if ((await getItem(win, `${INDEX_KEY}.rescue`)) !== '{broken-index') throw new Error('the damaged index text was not kept for rescue');
  results.index = { listed };

  // Control: a valid slot still opens and autosaves.
  await seed(win, indexFor([{ id: 'slot-qa-valid', name: 'QA valid' }]), { [slotKey('slot-qa-valid')]: valid });
  await load(win);
  await waitFor(win, `document.querySelector('[data-qa-menu="main"]')`);
  await click(win, '[data-qa-menu-action="continue"]');
  await waitFor(win, `document.querySelector('[data-qa-navigation="utility"]')`, 30_000);
  await sleep(2_000);
  const saved = JSON.parse(await getItem(win, slotKey('slot-qa-valid')));
  if (!saved.saveWriter || saved.schemaVersion !== parsed.schemaVersion) throw new Error('the valid slot was not autosaved by this build');
  results.valid = { autosaved: true };

  fs.mkdirSync(OUTPUT, { recursive: true });
  fs.writeFileSync(path.join(OUTPUT, 'result.json'), JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results, null, 2));
  win.destroy();
}

main().then(() => {
  // The running Electron still holds the profile open on Windows; leave it to the OS temp cleanup.
  try { fs.rmSync(PROFILE, { recursive: true, force: true }); } catch { /* locked until exit */ }
  app.exit(0);
}, (error) => {
  console.error(error);
  app.exit(1);
});
