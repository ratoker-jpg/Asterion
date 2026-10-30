// Before/after screenshots for the «Полировка интерфейса» PR, taken from real
// game flows only: a new production game through the wizard (race, long
// player name, seed), then the screens the audit names. Save edits, each
// recorded in the manifest with its frames:
// - «catchup»: every timestamp in the save is moved 12 hours back, exactly as
//   if the game had been closed 12 hours ago; the next launch replays the
//   world (catch-up window, NPC alliances, debris, colonies);
// - «long-alliance»: Command hall level 1, so an alliance with the longest
//   name and tag can be created through the real form.
//
//   npx electron electron/ui-polish-screenshots.cjs --dist=<built dist> --out=<dir> [--race=aegis|synod|veyra] [--only=a,b]
//
// Each frame is taken at 1920×1080 and again at 1280×720. Output is not committed.
const { app, BrowserWindow } = require('electron');
const { PARSE_SAVE } = require('./qa-save.cjs');
const fs = require('fs');
const path = require('path');

app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-gpu');
app.on('window-all-closed', () => {});

const ROOT = path.join(__dirname, '..');
const args = Object.fromEntries(process.argv.filter((arg) => arg.startsWith('--')).map((arg) => {
  const [key, value] = arg.slice(2).split('=');
  return [key, value ?? '1'];
}));
const DIST = path.resolve(args.dist || path.join(ROOT, 'dist'));
const OUTPUT = path.resolve(args.out || path.join(ROOT, 'visual-qa', 'ui-polish', 'after'));
const RACE = args.race || 'aegis';
const ONLY = args.only ? new Set(args.only.split(',')) : null;
const PLAYER_NAME = 'Звездоплаватель-Северный';
const LONG_ALLIANCE = 'Объединённый Флот Северных Звёздных Систем';
const LONG_TAG = 'СЕВЕРФЛТ';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const run = (win, source) => win.webContents.executeJavaScript(source);
const manifest = [];

async function waitFor(win, expression, timeoutMs = 20_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await run(win, `Boolean(${expression})`)) return;
    await sleep(80);
  }
  throw new Error(`Timed out waiting for: ${expression}`);
}

// Hidden windows do not advance CSS animations: finish the finite ones.
async function settle(win, ms = 350) {
  await run(win, 'document.fonts?.ready');
  await run(win, `document.getAnimations().forEach((a) => { try { if (a.effect?.getTiming().iterations !== Infinity) a.finish(); } catch {} })`);
  await run(win, 'new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
  await sleep(ms);
}

async function load(win, search) {
  const done = new Promise((resolve) => win.webContents.once('did-finish-load', resolve));
  await win.loadFile(path.join(DIST, 'index.html'), search ? { search } : undefined);
  await done;
  await sleep(300);
}

async function click(win, selector) {
  const ok = await run(win, `(() => { const node = document.querySelector(${JSON.stringify(selector)}); if (!node || node.disabled) return false; node.scrollIntoView({ block: 'nearest' }); node.click(); return true; })()`);
  if (!ok) throw new Error(`Missing or disabled control: ${selector}`);
  await settle(win, 250);
}

async function clickText(win, selector, text) {
  const ok = await run(win, `(() => { const node = [...document.querySelectorAll(${JSON.stringify(selector)})].find((item) => item.textContent.replace(/\\s+/g, ' ').trim().includes(${JSON.stringify(text)})); if (!node || node.disabled) return false; node.click(); return true; })()`);
  if (!ok) throw new Error(`Missing control «${text}» in ${selector}`);
  await settle(win, 250);
}

async function setField(win, selector, value) {
  await run(win, `(() => {
    const input = document.querySelector(${JSON.stringify(selector)});
    const proto = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : input instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(input, ${JSON.stringify(value)});
    input.dispatchEvent(new Event(input instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }));
  })()`);
  await settle(win, 150);
}

async function clickPrimary(win, route) {
  await click(win, `[data-qa-navigation="primary"] [data-qa-route="${route}"]`);
}

async function clickUtility(win, route) {
  await click(win, `[data-qa-navigation="utility"] [data-qa-route="${route}"]`);
}

async function shot(win, file) {
  win.webContents.invalidate();
  await run(win, 'new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
  await sleep(250);
  const [width, height] = win.getContentSize();
  const image = await win.capturePage({ x: 0, y: 0, width, height });
  fs.writeFileSync(path.join(OUTPUT, file), image.toPNG());
}

async function capture(win, name, note) {
  fs.mkdirSync(OUTPUT, { recursive: true });
  await settle(win, 600);
  await shot(win, `${name}--1920x1080.png`);
  win.setContentSize(1280, 720);
  await settle(win, 700);
  await shot(win, `${name}--1280x720.png`);
  win.setContentSize(1920, 1080);
  await settle(win, 500);
  manifest.push({ name, race: RACE, note });
  console.log(`captured ${name}`);
}

const wants = (scene) => !ONLY || ONLY.has(scene);

function openWindow() {
  return new BrowserWindow({ width: 1920, height: 1080, useContentSize: true, show: false, backgroundColor: '#02050a',
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, partition: `qa-ui-polish-${RACE}-${Date.now()}`, backgroundThrottling: false } });
}

async function newGame(win) {
  await load(win);
  await run(win, 'localStorage.clear(); sessionStorage.clear();');
  await load(win);
  await waitFor(win, `document.querySelector('[data-qa-menu="main"]')`);
  await click(win, '[data-qa-menu-action="new"]');
  await waitFor(win, `document.querySelector('[data-qa-wizard-step="race"]')`);
  await click(win, `[data-qa-race="${RACE}"]`);
  await click(win, '[data-qa-wizard-next]');
  await waitFor(win, `document.querySelector('[data-qa-wizard-step="world"]')`);
  await setField(win, '[data-qa-world="player-name"]', PLAYER_NAME);
  await setField(win, '[data-qa-world="seed"]', 'UIPOLISH');
  await click(win, '[data-qa-wizard-next]');
  await waitFor(win, `document.querySelector('[data-qa-wizard-step="confirm"]')`);
  await click(win, '[data-qa-wizard-start]');
  await waitFor(win, `document.querySelector('[data-qa-navigation="utility"]')`, 90_000);
  await settle(win, 1500);
}

function saveExpr(body) {
  return `(() => {
    const index = ${PARSE_SAVE}(localStorage.getItem('asterion.slots.index.v1'));
    const key = index.slots.find((slot) => slot.id === index.activeSlotId)?.storageKey ?? index.slots[0].storageKey;
    const save = ${PARSE_SAVE}(localStorage.getItem(key));
    ${body}
  })()`;
}

// A save edit and the reload in one renderer task. The running game saves
// every second: an edit written in one call and a reload in the next could be
// overwritten in between (that is what lost the Aster interiors on one run).
// After the edit the save key accepts no further writes from this document.
async function editSaveAndReload(win, body) {
  const done = new Promise((resolve) => win.webContents.once('did-finish-load', resolve));
  await run(win, `(() => {
    const index = ${PARSE_SAVE}(localStorage.getItem('asterion.slots.index.v1'));
    const key = index.slots.find((slot) => slot.id === index.activeSlotId)?.storageKey ?? index.slots[0].storageKey;
    const save = ${PARSE_SAVE}(localStorage.getItem(key));
    const edited = (() => { ${body} })() ?? save;
    const setItem = Storage.prototype.setItem;
    setItem.call(localStorage, key, JSON.stringify(edited));
    Storage.prototype.setItem = function (k, v) { if (this === localStorage && String(k) === key) return; return setItem.call(this, k, v); };
    location.replace('?autostart=continue');
    return true;
  })()`).catch(() => undefined);
  await done;
  await sleep(300);
}

async function reloadGame(win) {
  await load(win, '?autostart=continue');
  await waitFor(win, `document.querySelector('[data-qa-navigation="utility"]')`, 60_000);
  await settle(win, 1200);
}

const SHIFT_MS = 12 * 3600_000;

async function catchupScene(win) {
  await editSaveAndReload(win, `
    const shift = (value) => {
      if (Array.isArray(value)) return value.map(shift);
      if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, shift(v)]));
      return typeof value === 'number' && value > 1.7e12 && value < 2.2e12 ? value - ${SHIFT_MS} : value;
    };
    return shift(save);`);
  await waitFor(win, `document.querySelector('[data-qa-npc-catchup="progress"] [role="progressbar"]')`, 30_000);
  // The progress window lasts a few seconds: one frame at the current size, no settle.
  fs.mkdirSync(OUTPUT, { recursive: true });
  await shot(win, '07-catchup-progress--1920x1080.png');
  manifest.push({ name: '07-catchup-progress', race: RACE, note: 'Save edit: all save timestamps moved 12 h back (game closed 12 h ago). Launch → world catch-up in progress (1920×1080 only: it ends in seconds)' });
  await waitFor(win, `document.querySelector('[data-qa-npc-catchup="summary"] [data-qa-npc-catchup-stats]')`, 300_000);
  await capture(win, '07-catchup-summary', 'The same catch-up finished: summary window');
  await run(win, `document.querySelector('[data-qa-npc-catchup-close]')?.click()`);
  await settle(win, 600);
}

async function selectionScene(win) {
  await clickPrimary(win, 'planet');
  await settle(win, 600);
  // Real input: Ctrl+A, then a mouse sweep across the header and panels.
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'A', modifiers: ['control'] });
  win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'A', modifiers: ['control'] });
  await sleep(200);
  const afterCtrlA = await run(win, 'window.getSelection()?.toString().length ?? 0');
  win.webContents.sendInputEvent({ type: 'mouseDown', x: 60, y: 200, button: 'left', clickCount: 1 });
  for (let step = 1; step <= 12; step += 1) {
    win.webContents.sendInputEvent({ type: 'mouseMove', x: 60 + step * 140, y: 200 + step * 60, button: 'left', modifiers: ['leftButtonDown'] });
    await sleep(20);
  }
  await capture(win, '01-selection-planet-after-ctrl-a-and-sweep', `Планета: Ctrl+A (selected ${afterCtrlA} chars), then a mouse sweep held from (60,200) to (1740,920)`);
  win.webContents.sendInputEvent({ type: 'mouseUp', x: 1740, y: 920, button: 'left', clickCount: 1 });
  const afterSweep = await run(win, 'window.getSelection()?.toString().length ?? 0');
  manifest[manifest.length - 1].note += `; selected after sweep: ${afterSweep} chars`;
}

const key = (win, keyCode, modifiers = []) => {
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode, modifiers });
  if (keyCode.length === 1 && !modifiers.length) win.webContents.sendInputEvent({ type: 'char', keyCode, modifiers });
  if (keyCode === 'Return') win.webContents.sendInputEvent({ type: 'char', keyCode: String.fromCharCode(13), modifiers });
  win.webContents.sendInputEvent({ type: 'keyUp', keyCode, modifiers });
};
const focused = (win) => run(win, `(() => { const el = document.activeElement; if (!el || el === document.body) return null;
  const cs = getComputedStyle(el); return { tag: el.tagName, text: (el.textContent || el.value || '').replace(/\s+/g, ' ').trim().slice(0, 40),
  route: el.getAttribute('data-qa-route'), focusVisible: el.matches(':focus-visible'), outline: cs.outlineStyle + ' ' + cs.outlineWidth }; })()`);

// Real keyboard input: Tab focus is visible on navigation and rating controls,
// Enter activates them, Ctrl+A works in a field and in a report text only.
async function keyboardScene(win) {
  const log = [];
  await clickPrimary(win, 'planet');
  await run(win, `document.activeElement?.blur()`);
  await win.webContents.focus();
  let route = null;
  for (let i = 0; i < 40 && !route; i += 1) {
    key(win, 'Tab'); await sleep(60);
    const f = await focused(win);
    if (f?.route === 'universe') route = f;
  }
  log.push({ step: 'Tab to «Вселенная»', focus: route });
  await capture(win, '10-keyboard-nav-focus', `Keyboard: Tab from the page start to «Вселенная»: ${JSON.stringify(route)}`);
  key(win, 'Return'); await settle(win, 800);
  log.push({ step: 'Enter on «Вселенная»', universeOpen: await run(win, `Boolean(document.querySelector('[data-qa-universe]'))`) });

  await clickUtility(win, 'rating');
  await waitFor(win, `document.querySelector('.rating-view-v2 [data-qa-rating-player-row]')`);
  await run(win, `document.querySelector('.rating-search-v2 input').focus()`);
  for (const ch of 'Abc') key(win, ch);
  await sleep(100);
  key(win, 'A', ['control']); await sleep(100);
  log.push({ step: 'Ctrl+A in the rating search field', value: await run(win, `document.querySelector('.rating-search-v2 input').value`),
    selected: await run(win, `(() => { const i = document.querySelector('.rating-search-v2 input'); return i.value.slice(i.selectionStart, i.selectionEnd); })()`) });
  await setField(win, '.rating-search-v2 input', '');
  let head = null;
  for (let i = 0; i < 12 && !head; i += 1) {
    key(win, 'Tab'); await sleep(60);
    const f = await focused(win);
    if (f && /ОБЩИЕ|РЕСУРС|БОЕВЫЕ|ДОСТИЖ/.test(f.text)) head = f;
  }
  log.push({ step: 'Tab to a sortable rating header', focus: head });
  key(win, 'Tab'); await sleep(60);
  const next = await focused(win);
  await capture(win, '10-keyboard-rating-focus', `Keyboard: Tab in Рейтинг, focus on ${JSON.stringify(next)}`);
  key(win, 'Return'); await settle(win, 400);
  log.push({ step: 'Enter on the focused control', focus: next, sortChanged: await run(win, `document.querySelector('.score-head-v2.selected')?.textContent || ''`) });
  let row = null;
  for (let i = 0; i < 6 && !row; i += 1) {
    key(win, 'Tab'); await sleep(60);
    const f = await focused(win);
    if (f && (await run(win, `Boolean(document.activeElement?.matches('[data-qa-rating-player-row]'))`))) row = f;
  }
  key(win, 'Return'); await settle(win, 400);
  log.push({ step: 'Enter on a rating row', row, cardOpen: await run(win, `Boolean(document.querySelector('[data-qa-rating-player-card]'))`) });
  key(win, 'A', ['control']); await sleep(100);
  log.push({ step: 'Ctrl+A on the rating screen', selectedChars: await run(win, `window.getSelection()?.toString().length ?? 0`) });

  await clickPrimary(win, 'reports');
  await settle(win, 800);
  const opened = await run(win, `(() => { const item = document.querySelector('.reports-list-item, [data-qa-report-item], .reports-message-nav button'); item?.click(); return Boolean(item); })()`);
  await settle(win, 600);
  const hasText = await run(win, `Boolean(document.querySelector('.reports-preview-scroll')?.textContent?.trim())`);
  if (hasText) {
    await run(win, `(() => { const r = document.createRange(); const n = document.querySelector('.reports-preview-scroll'); r.setStart(n, 0); r.collapse(true); const s = getSelection(); s.removeAllRanges(); s.addRange(r); })()`);
    key(win, 'A', ['control']); await sleep(100);
    log.push({ step: 'Ctrl+A inside a report text', opened, selectedChars: await run(win, `window.getSelection()?.toString().length ?? 0`),
      regionChars: await run(win, `document.querySelector('.reports-preview-scroll').textContent.length`) });
  } else log.push({ step: 'Ctrl+A inside a report text', opened, note: 'no report text on this screen' });
  manifest.push({ name: '10-keyboard-probe', race: RACE, note: JSON.stringify(log) });
  console.log(JSON.stringify(log, null, 1));
}

async function ratingScenes(win) {
  await clickUtility(win, 'rating');
  await waitFor(win, `document.querySelector('.rating-view-v2 [data-qa-rating-player-row]')`);
  await capture(win, '02-rating-players', `Рейтинг → Игроки, player «${PLAYER_NAME}» (24 chars, the maximum)`);
  await run(win, `document.querySelector('[data-qa-rating-player-row]')?.click()`);
  await capture(win, '02-rating-players-card', 'Рейтинг → Игроки, first row opened');
  await clickText(win, '.rating-mode-tabs-v2 button', 'АЛЬЯНСЫ');
  await capture(win, '02-rating-alliances', 'Рейтинг → Альянсы (NPC alliances of the generated world)');
  await setField(win, '.rating-search-v2 input', 'союз');
  await capture(win, '02-rating-search-focus', 'Рейтинг → Альянсы, search «союз»');
}

async function longAllianceScene(win) {
  // Save edit (stated): Command hall level 1 on the home planet, so the
  // alliance form is available. Everything else goes through the real form.
  await editSaveAndReload(win, `save.planets[save.currentPlanetId].buildings['planetary-government'] = Math.max(1, save.planets[save.currentPlanetId].buildings['planetary-government'] || 0);`);
  await waitFor(win, `document.querySelector('[data-qa-navigation="utility"]')`, 60_000);
  await settle(win, 1200);
  await clickPrimary(win, 'command');
  await waitFor(win, `document.querySelector('[data-qa-create-alliance]')`);
  await click(win, '[data-qa-create-alliance]');
  await setField(win, '[data-qa-alliance-name]', LONG_ALLIANCE);
  await setField(win, '[data-qa-alliance-tag]', LONG_TAG);
  await capture(win, '07-command-create-alliance-long', `Командование → Создать союз «${LONG_ALLIANCE}» [${LONG_TAG}] (name 42, tag 8 = maximums). Save edit: Command hall level 1.`);
  await click(win, '[data-qa-alliance-submit]');
  await settle(win, 800);
  await capture(win, '07-command-alliance-long', 'Командование after creating the long-named alliance');
  await clickText(win, '.cmdA-tabs button', 'СОЮЗЫ');
  await settle(win, 600);
  await capture(win, '07-command-alliances-crests', 'Командование → Союзы: NPC alliance crests in the catalog');
  await clickUtility(win, 'rating');
  await waitFor(win, `document.querySelector('.rating-view-v2 [data-qa-rating-player-row]')`);
  await clickText(win, '.rating-view-v2 button', 'ПОКАЗАТЬ МОЮ ПОЗИЦИЮ');
  await capture(win, '02-rating-players-long-tag', `Рейтинг → Игроки with the player in [${LONG_TAG}]`);
  await clickText(win, '.rating-mode-tabs-v2 button', 'АЛЬЯНСЫ');
  await clickText(win, '.rating-view-v2 button', 'ПОКАЗАТЬ МОЮ ПОЗИЦИЮ');
  await capture(win, '02-rating-alliances-long', `Рейтинг → Альянсы with «${LONG_ALLIANCE}» [${LONG_TAG}]`);
}

async function planetEditorScene(win) {
  await clickPrimary(win, 'planet');
  await waitFor(win, `document.querySelector('.owned-planet-edit-v4')`);
  await click(win, '.owned-planet-edit-v4');
  await settle(win, 600);
  await capture(win, '03-planet-editor', 'Планета → ✎ (редактор планеты)');
  await run(win, `document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
  await run(win, `[...document.querySelectorAll('button')].find((b) => /Закрыть|×|✕/.test(b.getAttribute('aria-label') || b.title || b.textContent))?.click()`);
  await settle(win, 400);
}

async function navAndQueueScene(win) {
  await clickPrimary(win, 'planet');
  await click(win, '[data-qa-zone="resource"]');
  await waitFor(win, `document.querySelector('[data-qa-zone-view][data-zone="resource"]')`);
  await capture(win, '03-resource-zone-queue-and-nav', 'Планета → Ресурсная зона: active navigation tab, shared queue slots');
}

async function universeScenes(win) {
  await clickPrimary(win, 'universe');
  await waitFor(win, `document.querySelector('[data-qa-universe]')`);
  await settle(win, 800);
  await capture(win, '06-universe-home-system', 'Вселенная, home system: labels of planets on the map');
  const npc = await run(win, saveExpr(`
    const home = save.planets[save.currentPlanetId];
    const targets = Object.values(save.espionage.targets).filter((t) => t.kind === 'npc' && t.coordinate.galaxy === home.universeGalaxy)
      .sort((a, b) => Math.abs(a.coordinate.system - home.universeSystem) - Math.abs(b.coordinate.system - home.universeSystem));
    const t = targets[0];
    return t ? { id: t.id, ownerName: t.ownerName, system: t.coordinate.system } : null;`));
  if (npc) {
    await setField(win, '.universe-jump select', String(npc.system));
    await waitFor(win, `document.querySelector('[data-qa-universe]')?.getAttribute('data-qa-universe-system') === ${JSON.stringify(String(npc.system))}`);
    await settle(win, 800);
    await capture(win, '06-universe-npc-system', `Вселенная, system ${npc.system} with NPC «${npc.ownerName}»: labels and NPC colony looks`);
    const objectId = await run(win, `(() => { const nodes = [...document.querySelectorAll('[data-qa-universe-object][data-qa-universe-kind="npc"]')]; return nodes[0]?.getAttribute('data-qa-universe-object') || ''; })()`);
    if (objectId) {
      await click(win, `[data-qa-universe-object="${objectId}"]`);
      await waitFor(win, `document.querySelector('[data-qa-universe-inspector]')`);
      await capture(win, '06-universe-npc-inspector', `Вселенная → NPC planet inspector (${npc.ownerName})`);
      if (wants('flight')) await flightScenes(win, objectId, npc);
    }
  }
  await clickPrimary(win, 'universe');
  await waitFor(win, `document.querySelector('[data-qa-universe]')`);
  await clickText(win, '[data-qa-universe] button', 'Найти обломки');
  await waitFor(win, `document.querySelector('[data-qa-debris-finder]')`);
  await capture(win, '04-debris-finder', 'Вселенная → «Найти обломки»');
}

async function flightScenes(win, objectId, npc) {
  await click(win, '[data-qa-universe-action="attack"]');
  await waitFor(win, `document.querySelector('[data-qa-attack-prep]')`);
  await run(win, `(() => { const tile = document.querySelector('[data-qa-fleet-ship="scout"]'); [...tile.querySelectorAll('button')].find((button) => button.textContent.trim() === 'МАКС.')?.click(); })()`);
  await settle(win, 400);
  await capture(win, '05-attack-prep-ship-count', `Вселенная → ${npc.ownerName} → Атаковать: ship tiles, count field, «Продолжить · план перелёта»`);
  await click(win, '[data-qa-flight-preview-open]');
  await settle(win, 700);
  const refusal = await run(win, `document.querySelector('[data-qa-flight-preview-error]')?.textContent?.trim() || ''`);
  await capture(win, '05-flight-plan-attack', `План перелёта · атака on ${npc.ownerName}: header, close button, refusal «${refusal}»`);
  await run(win, `document.querySelector('[data-qa-flight-preview-close], .flight-preview-close, [aria-label="Закрыть"]')?.click()`);
  await settle(win, 300);
}

// V6 per race: a new game has these buildings at level 0 (interior closed).
// Save edit (stated): construction, recycling and trade-center set to level 1
// on the home planet, then the interiors and Science are opened normally.
async function raceInteriorsScenes(win) {
  await editSaveAndReload(win, `const b = save.planets[save.currentPlanetId].buildings; for (const role of ['construction', 'recycling', 'trade-center']) b[role] = Math.max(1, b[role] || 0);`);
  await waitFor(win, `document.querySelector('[data-qa-navigation="utility"]')`, 60_000);
  await settle(win, 1200);
  await clickPrimary(win, 'planet');
  await click(win, '[data-qa-zone="industry"]');
  await waitFor(win, `document.querySelector('[data-qa-zone-view][data-zone="industry"]')`);
  for (const role of ['construction', 'recycling', 'trade-center']) {
    await click(win, `[data-zone-building-role="${role}"]`);
    await waitFor(win, `document.querySelector('[data-qa-building-dialog="${role}"]')`);
    await click(win, `[data-qa-enter-building="${role}"]`);
    await settle(win, 900);
    const art = await run(win, `[...document.querySelectorAll('main img, section img, aside img')].map((img) => img.getAttribute('src') || '').filter((src) => src.includes('/buildings/')).map((src) => src.split('/').pop())`);
    await capture(win, `08-interior-${role}-${RACE}`, `${RACE}: interior of ${role}; building art: ${art.join(', ')}. Save edit: construction/recycling/trade-center level 1.`);
    await run(win, `document.querySelector('[data-qa-building-interior-back]')?.click()`);
    await settle(win, 600);
    await run(win, `document.querySelector('.resource-building-dialog-close')?.click()`);
    await settle(win, 300);
  }
  await clickUtility(win, 'science');
  await settle(win, 800);
  const lab = await run(win, `(document.querySelector('.science-lab-art-v2')?.getAttribute('src') || '').split('/').pop()`);
  await capture(win, `08-science-${RACE}`, `${RACE}: Наука, laboratory art ${lab}`);
}

async function interiorsScenes(win) {
  // The three V6 interiors open from their building dialogs once built; a new
  // game has them at level 0, so this scene records the building dialogs.
  await clickPrimary(win, 'planet');
  await click(win, '[data-qa-zone="industry"]');
  await waitFor(win, `document.querySelector('[data-qa-zone-view][data-zone="industry"]')`);
  await capture(win, '08-industry-zone', `Промышленная зона (${RACE})`);
  for (const role of ['construction', 'recycling', 'trade-center']) {
    const present = await run(win, `Boolean(document.querySelector('[data-zone-building-role="${role}"]'))`);
    if (!present) continue;
    await click(win, `[data-zone-building-role="${role}"]`);
    await waitFor(win, `document.querySelector('[data-qa-building-dialog="${role}"]')`);
    const canEnter = await run(win, `Boolean(document.querySelector('[data-qa-enter-building="${role}"]:not([disabled])'))`);
    if (canEnter) {
      await click(win, `[data-qa-enter-building="${role}"]`);
      await settle(win, 800);
      await capture(win, `08-interior-${role}`, `${RACE}: interior of ${role}`);
      await run(win, `document.querySelector('[data-qa-building-interior-back]')?.click()`);
      await settle(win, 500);
    } else {
      await capture(win, `08-dialog-${role}`, `${RACE}: building dialog of ${role} (level 0, interior closed)`);
    }
    await run(win, `document.querySelector('.resource-building-dialog-close')?.click()`);
    await settle(win, 300);
  }
}

async function otherScreens(win) {
  for (const [route, label] of [['fleets', 'Флоты'], ['operations', 'Операции'], ['reports', 'Сообщения']]) {
    await clickPrimary(win, route);
    await settle(win, 800);
    await capture(win, `09-${route}`, label);
  }
  for (const [route, label] of [['science', 'Наука'], ['settings', 'Настройки']]) {
    await clickUtility(win, route);
    await settle(win, 800);
    await capture(win, `09-${route}`, label);
  }
}

// Test Mode: the built-in «ЗАПУСТИТЬ АТАКУ BOT 01» scenario, the incoming row
// at the player's Espionage and again at 10 (save edit: science 5 = 10).
async function incomingScenes() {
  const win = openWindow();
  const TEST_KEY = 'asterion.vertical-slice.test.v1';
  const showRow = async () => {
    await waitFor(win, `document.querySelector('[data-qa-fleet-incoming-alert]')`);
    await run(win, `[...document.querySelectorAll('[data-qa-fleet-incoming-alert] button')].find((button) => button.textContent.trim() === 'ПОКАЗАТЬ РЕЙС')?.click()`);
    await waitFor(win, `document.querySelector('[data-qa-flight-incoming-attack]')?.getBoundingClientRect().height > 0`);
    await run(win, `document.querySelector('[data-qa-flight-incoming-attack]').scrollIntoView({ block: 'center' })`);
    await settle(win, 600);
  };
  try {
    await load(win, '?mode=test');
    await waitFor(win, `document.querySelector('[data-qa-navigation="utility"]')`, 60_000);
    await settle(win, 800);
    await clickPrimary(win, 'fleets');
    await waitFor(win, `document.querySelector('[data-qa-bot01-scenario]')`);
    await click(win, '[data-qa-bot01-scenario]');
    await showRow();
    await capture(win, '07-incoming-composition-hidden', 'Test Mode «ЗАПУСТИТЬ АТАКУ BOT 01», player Espionage below 10: «СОСТАВ СКРЫТ»');
    const reloaded = new Promise((resolve) => win.webContents.once('did-finish-load', resolve));
    await run(win, `(() => {
      const key = ${JSON.stringify(TEST_KEY)};
      const save = ${PARSE_SAVE}(localStorage.getItem(key)); save.science.levels[5] = 10;
      const setItem = Storage.prototype.setItem;
      setItem.call(localStorage, key, JSON.stringify(save));
      Storage.prototype.setItem = function (k, v) { if (this === localStorage && String(k) === key) return; return setItem.call(this, k, v); };
      location.replace('?mode=test');
      return true;
    })()`).catch(() => undefined);
    await reloaded;
    await waitFor(win, `document.querySelector('[data-qa-navigation="utility"]')`, 60_000);
    await clickPrimary(win, 'fleets');
    await showRow();
    await capture(win, '07-incoming-composition-shown', 'Same flight after the save edit Espionage (science 5) = 10: composition line');
    await clickPrimary(win, 'universe');
    await waitFor(win, `document.querySelector('[data-qa-universe]')`);
    await clickText(win, '[data-qa-universe] button', 'Найти обломки');
    await waitFor(win, `document.querySelector('[data-qa-debris-finder]')`);
    const rows = await run(win, `document.querySelectorAll('[data-qa-debris-row]').length`);
    await capture(win, '04-debris-finder-test-mode', `Test Mode, Вселенная → «Найти обломки»: ${rows} rows`);
    // Geometry probe only (no frame is taken of it): repeat the rows to nine,
    // as in the audit screenshot, and measure where the dialog ends up.
    for (const [w, h] of [[1920, 1080], [1280, 720]]) {
      win.setContentSize(w, h);
      await settle(win, 500);
      const probe = await run(win, `(() => {
        const list = document.querySelector('.universe-debris-finder__list');
        const rows = [...list.children];
        while (list.children.length < 9) list.appendChild(rows[list.children.length % rows.length].cloneNode(true));
        const r = document.querySelector('[data-qa-debris-finder]').getBoundingClientRect();
        const out = { viewport: [innerWidth, innerHeight], top: Math.round(r.top), bottom: Math.round(r.bottom), centreOffset: Math.round((r.top + r.bottom) / 2 - innerHeight / 2) };
        while (list.children.length > rows.length) list.lastChild.remove();
        return out;
      })()`);
      manifest.push({ name: `04-debris-finder-probe-${w}x${h}`, race: RACE, note: `DOM probe (rows cloned to 9, no screenshot): ${JSON.stringify(probe)}` });
      console.log(`debris probe ${w}x${h}: ${JSON.stringify(probe)}`);
    }
    win.setContentSize(1920, 1080);
  } finally {
    win.destroy();
  }
}

// The map pair is taken on one and the same save in both builds (the world
// after a catch-up differs between runs). --export-save: new game, 12 h
// catch-up, then the nearest system of the home galaxy with an NPC colony
// (an NPC planet that is not a homeworld: no «★» caption) is found and the
// save is written to a file. --import-save: that file is loaded into the
// build under test and the same system is captured.
async function selectSystem(win, system) {
  await setField(win, '.universe-jump select', String(system));
  await waitFor(win, `document.querySelector('[data-qa-universe]')?.getAttribute('data-qa-universe-system') === ${JSON.stringify(String(system))}`);
  await settle(win, 500);
}

async function exportMapSave(win, file) {
  await catchupScene(win);
  await clickPrimary(win, 'universe');
  await waitFor(win, `document.querySelector('[data-qa-universe]')`);
  const home = Number(await run(win, `document.querySelector('[data-qa-universe]').getAttribute('data-qa-universe-system')`));
  const order = Array.from({ length: 40 }, (_, i) => i + 1).sort((a, b) => Math.abs(a - home) - Math.abs(b - home));
  for (const system of order) {
    await selectSystem(win, system);
    const colony = await run(win, `[...document.querySelectorAll('[data-qa-universe-object][data-qa-universe-kind="npc"]')].map((node) => node.querySelector('[data-qa-map-caption]')?.textContent?.trim() || '').find((caption) => caption && !caption.startsWith('★')) || ''`);
    if (!colony) continue;
    const dump = await run(win, `(() => { const index = localStorage.getItem('asterion.slots.index.v1'); const parsed = JSON.parse(index); const key = parsed.slots.find((slot) => slot.id === parsed.activeSlotId)?.storageKey ?? parsed.slots[0].storageKey; return { index, key, save: localStorage.getItem(key) }; })()`);
    fs.writeFileSync(file, JSON.stringify({ system, colonyOwner: colony, ...dump }));
    console.log(`exported save: system ${system}, colony of ${colony}`);
    return;
  }
  throw new Error('No NPC colony in the home galaxy');
}

async function importMapSave(win, file) {
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  await load(win);
  await run(win, 'localStorage.clear(); sessionStorage.clear();');
  const done = new Promise((resolve) => win.webContents.once('did-finish-load', resolve));
  await run(win, `(() => {
    localStorage.setItem('asterion.slots.index.v1', ${JSON.stringify(data.index)});
    localStorage.setItem(${JSON.stringify(data.key)}, ${JSON.stringify(data.save)});
    const setItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function (k, v) { if (this === localStorage && String(k) === ${JSON.stringify(data.key)}) return; return setItem.call(this, k, v); };
    location.replace('?autostart=continue');
    return true;
  })()`).catch(() => undefined);
  await done;
  await waitFor(win, `document.querySelector('[data-qa-navigation="utility"]')`, 60_000);
  await settle(win, 1500);
  await waitFor(win, `!document.querySelector('[data-qa-npc-catchup="progress"]')`, 120_000);
  await run(win, `document.querySelector('[data-qa-npc-catchup-close]')?.click()`);
  await settle(win, 500);
  await clickPrimary(win, 'universe');
  await waitFor(win, `document.querySelector('[data-qa-universe]')`);
  await selectSystem(win, data.system);
  await settle(win, 800);
  const captions = await run(win, `[...document.querySelectorAll('[data-qa-map-caption]')].map((node) => node.textContent.trim())`);
  await capture(win, '06-map-npc-colony', `Same save in both builds (12 h catch-up world exported once), system ${data.system}: NPC colony of «${data.colonyOwner}». Captions: ${captions.join(' | ')}`);
}

app.whenReady().then(async () => {
  if (args['export-save'] || args['import-save']) {
    const win = openWindow();
    try {
      fs.mkdirSync(OUTPUT, { recursive: true });
      if (args['export-save']) { await newGame(win); await exportMapSave(win, args['export-save']); }
      else await importMapSave(win, args['import-save']);
    } catch (error) { console.error(error); }
    fs.writeFileSync(path.join(OUTPUT, 'manifest-map.json'), JSON.stringify(manifest, null, 2));
    win.destroy();
    app.exit(0);
    return;
  }
  if (args.incoming) {
    fs.mkdirSync(OUTPUT, { recursive: true });
    try { await incomingScenes(); } catch (error) { console.error(error); }
    fs.writeFileSync(path.join(OUTPUT, 'manifest-incoming.json'), JSON.stringify(manifest, null, 2));
    app.exit(0);
    return;
  }
  const win = openWindow();
  try {
    fs.mkdirSync(OUTPUT, { recursive: true });
    await newGame(win);
    const steps = [
      ['catchup', catchupScene], ['selection', selectionScene], ['keyboard', keyboardScene], ['rating', ratingScenes], ['planet-editor', planetEditorScene], ['queue', navAndQueueScene],
      ['universe', universeScenes], ['interiors', interiorsScenes], ['race-interiors', raceInteriorsScenes], ['screens', otherScreens], ['long-alliance', longAllianceScene],
    ];
    for (const [scene, fn] of steps) {
      if (!wants(scene)) continue;
      try {
        await fn(win);
      } catch (error) {
        console.error(`[${scene}] ${error.stack || error}`);
        manifest.push({ name: scene, race: RACE, error: String(error.message || error) });
      }
    }
    fs.writeFileSync(path.join(OUTPUT, `manifest-${RACE}.json`), JSON.stringify(manifest, null, 2));
    app.exit(0);
  } catch (error) {
    console.error(error);
    fs.writeFileSync(path.join(OUTPUT, `manifest-${RACE}.json`), JSON.stringify(manifest, null, 2));
    app.exit(1);
  } finally {
    win.destroy();
  }
});
