// A series of rounds through the real game (NPC intelligence ADR, stage G): the
// result window after the Gate → «Новый раунд» → the wizard with «Продолжить
// серию» → a new world of the same personas; leaving a round from the pause
// menu; a plain new game stays clean; a window without the desktop bridge says
// the series is unavailable. Hidden windows, a disposable profile.
//
//   npm run test:npc-rounds-ui
const { app, BrowserWindow } = require('electron');
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { parseSave, PARSE_SAVE } = require('./qa-save.cjs');
const { registerSaveStore } = require('./save-store.cjs');

const ROOT = path.join(__dirname, '..');
const OUT_DIR = process.env.ASTERION_QA_OUTPUT || path.join(ROOT, 'visual-qa', 'npc-rounds');
const SLOT_ID = 'slot-roundsqa-0001';
const SLOT_KEY = `asterion.slot.${SLOT_ID}.v1`;
const NPC_COUNT = 6;
const NEW_NICK = 'Новый Ник';
const PERSONA_ID = /\bp-[0-9a-f]{16}\b/;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'asterion-rounds-qa-'));
const PROFILE = path.join(temp, 'profile');
app.setPath('userData', PROFILE);
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-gpu');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.on('window-all-closed', () => {});

const run = (win, source) => win.webContents.executeJavaScript(source);
const REGISTRY = path.join(PROFILE, 'personas.v1.json');
const registry = () => JSON.parse(fs.readFileSync(REGISTRY, 'utf8'));

function check(condition, message) {
  if (!condition) throw new Error(`NPC rounds QA: ${message}`);
}

async function waitFor(win, expression, timeoutMs = 60_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await run(win, `Boolean(${expression})`)) return;
    await sleep(100);
  }
  throw new Error(`Timed out waiting for: ${expression}`);
}

async function click(win, selector) {
  const ok = await run(win, `(() => { const node = document.querySelector(${JSON.stringify(selector)}); if (!node || node.disabled) return false; node.click(); return true; })()`);
  if (!ok) throw new Error(`Missing or disabled control: ${selector}`);
  await sleep(250);
}

async function capture(win, name) {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  await sleep(1700); // entrance animations
  win.webContents.invalidate();
  await run(win, 'new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
  await sleep(200);
  const [width, height] = win.getContentSize();
  fs.writeFileSync(path.join(OUT_DIR, `${name}.png`), (await win.capturePage({ x: 0, y: 0, width, height })).toPNG());
}

/** A small finished campaign as the game stores it: its Gate is complete. */
function finishedWorld() {
  const file = path.join(temp, 'world.json');
  const loader = require('url').pathToFileURL(path.join(ROOT, 'src/domain/combat/test-asset-loader.mjs')).href;
  const made = spawnSync(process.env.ASTERION_QA_NODE || 'node', ['--experimental-strip-types', '--no-warnings', '--experimental-loader', loader,
    path.join(ROOT, 'tools/cloud-qa-world.mjs'), file, String(NPC_COUNT), String(Date.now() - 60_000)], { cwd: ROOT, encoding: 'utf8' });
  if (made.status !== 0) throw new Error(made.stderr);
  const save = parseSave(fs.readFileSync(file, 'utf8'));
  save.sunRaid = { ...save.sunRaid, campaignResult: {
    version: 1, at: Date.now() - 30_000, winner: { kind: 'owner', id: save.profile.playerId }, winnerName: save.profile.displayName,
    hostOwnerId: save.profile.playerId, hostOwnerName: save.profile.displayName, hostPlanetName: 'Гелион', playerWon: true,
  } };
  return save;
}

const slotSave = (win, slotId) => run(win, `(() => {
  const index = JSON.parse(localStorage.getItem('asterion.slots.index.v1'));
  const slot = index.slots.find((item) => ${slotId ? `item.id === ${JSON.stringify(slotId)}` : 'item.id !== ' + JSON.stringify(SLOT_ID)});
  const raw = localStorage.getItem(slot.storageKey);
  return { id: slot.id, raw, save: ${PARSE_SAVE}(raw) };
})()`);

const slotsCount = (win) => run(win, `JSON.parse(localStorage.getItem('asterion.slots.index.v1')).slots.length`);

async function setValue(win, qa, value) {
  await run(win, `(() => {
    const input = document.querySelector('[data-qa-world="${qa}"]');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, ${JSON.stringify(String(value))});
    input.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  await sleep(150);
}

/** «Кампания»: names, the series switch and the campaign rules (the redone wizard, 14.11.2026). */
async function goToWorldStep(win) {
  await waitFor(win, `document.querySelector('[data-qa-wizard-step="race"]')`);
  await click(win, '[data-qa-wizard-next]');
  await waitFor(win, `document.querySelector('[data-qa-wizard-step="campaign"]')`);
}

async function seedValue(win) {
  await click(win, '[data-qa-wizard-rail="world"]');
  await waitFor(win, `document.querySelector('[data-qa-world="seed"]')`);
  const value = await run(win, `document.querySelector('[data-qa-world="seed"]').value`);
  await click(win, '[data-qa-wizard-rail="campaign"]');
  return value;
}

async function main() {
  await app.whenReady();
  registerSaveStore();
  // Off-screen but shown: a hidden window hands back stale frames of the menu's animated screens.
  const win = new BrowserWindow({ show: false, x: -3000, y: 0, focusable: false, skipTaskbar: true, width: 1920, height: 1080, webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, sandbox: true, backgroundThrottling: false } });
  win.showInactive();
  const open = (search) => win.loadFile(path.join(ROOT, 'dist', 'index.html'), search ? { search } : undefined);
  const results = {};

  // 1. No series yet: the switch is there, off, and says why.
  await open();
  await run(win, 'localStorage.clear(); sessionStorage.clear();');
  await open();
  await waitFor(win, `document.querySelector('[data-qa-menu="main"]')`);
  await click(win, '[data-qa-menu-action="new"]');
  await goToWorldStep(win);
  check(await run(win, `document.querySelector('[data-qa-series-toggle]').disabled`), 'the switch must be off without a series');
  check(/Серии пока нет/.test(await run(win, `document.querySelector('[data-qa-series-note]').textContent`)), 'no reason shown without a series');
  await capture(win, '01-wizard-no-series');

  // 2. The result window. Reaching it folds the campaign into a new series, once.
  const finished = finishedWorld();
  const firstNick = finished.profile.displayName;
  const text = JSON.stringify(finished);
  const meta = { id: SLOT_ID, name: 'Раунды QA', createdAt: Date.now(), updatedAt: Date.now(), playTimeMs: 0, factionId: 'aegis', playerName: firstNick,
    campaignSpeed: 'standard', schemaVersion: finished.schemaVersion, storageKey: SLOT_KEY, mode: 'production',
    summary: { planets: 1, npcCount: NPC_COUNT, galaxyCount: 1, days: 0, crystals: 0, victory: true } };
  await run(win, `(() => {
    localStorage.clear(); sessionStorage.clear();
    localStorage.setItem(${JSON.stringify(SLOT_KEY)}, ${JSON.stringify(text)});
    localStorage.setItem('asterion.slots.index.v1', ${JSON.stringify(JSON.stringify({ version: 1, activeSlotId: SLOT_ID, slots: [meta] }))});
  })()`);
  await open('?autostart=continue');
  await waitFor(win, `document.querySelector('[data-qa-campaign-result="victory"]')`);
  await waitFor(win, `document.querySelector('[data-qa-result-round]')`);
  for (const qa of ['[data-qa-result-stay]', '[data-qa-result-new]', '[data-qa-result-round]']) check(await run(win, `Boolean(document.querySelector('${qa}'))`), `missing ${qa}`);
  await capture(win, '02-result-window');
  const started = Date.now();
  while (!fs.existsSync(REGISTRY) && Date.now() - started < 10_000) await sleep(100);
  check(fs.existsSync(REGISTRY), 'the campaign was not folded into a registry');
  const founded = fs.readFileSync(REGISTRY, 'utf8');
  check(registry().series.length === 1 && registry().series[0].rounds === 1 && registry().series[0].personas.length === NPC_COUNT, 'series not founded from the campaign');
  check(!/"coordinate"|"resources"|"fleet"/.test(founded), 'a world leaked into the registry');
  results.founded = { personas: registry().series[0].personas.length, bytes: founded.length };

  // 3. Coming back to the finished campaign changes nothing. (By the menu: a reload to the wizard must not autostart.)
  await open();
  await waitFor(win, `document.querySelector('[data-qa-menu="main"]')`);
  await click(win, '[data-qa-menu-action="continue"]');
  await waitFor(win, `document.querySelector('[data-qa-result-round]')`);
  await sleep(500);
  check(fs.readFileSync(REGISTRY, 'utf8') === founded, 'a reload folded the campaign again');
  check(!fs.existsSync(path.join(PROFILE, 'personas.v1.backup.json')), 'a reload rewrote the registry');

  // 4. «Новый раунд»: the wizard opens with the switch on, the same commander, a new seed.
  await click(win, '[data-qa-result-round]');
  await goToWorldStep(win);
  check(await run(win, `document.querySelector('[data-qa-series-toggle]').checked`), 'the switch must be on after «Новый раунд»');
  check(await run(win, `document.querySelector('[data-qa-world="player-name"]').value`) === firstNick, 'the commander name did not carry over');
  check((await seedValue(win)) !== finished.worldConfig.seed, 'the seed must be new');
  check(/раунд 2/.test(await run(win, `document.querySelector('[data-qa-world="campaign-name"]').value`)), 'the campaign name does not say the round');
  await setValue(win, 'player-name', NEW_NICK);
  await capture(win, '03-wizard-series-on');
  await click(win, '[data-qa-wizard-rail="confirm"]');
  await waitFor(win, `document.querySelector('[data-qa-wizard-step="confirm"]')`);
  check(/раунд 2/.test(await run(win, `document.querySelector('[data-qa-series-line]').textContent`)), 'the summary does not name the series');
  await capture(win, '04-wizard-confirm');
  await click(win, '[data-qa-wizard-start]');
  await waitFor(win, `document.querySelector('[data-qa-navigation="utility"]')`);
  await sleep(1500);

  // 5. A new world of the same personas; their ids nowhere in the game.
  const roundTwo = await slotSave(win);
  const profiles = Object.values(roundTwo.save.npc.profiles);
  check(profiles.length === NPC_COUNT && profiles.every((profile) => profile.inherited?.round === 2), 'NPC did not come from the series');
  check(roundTwo.save.profile.displayName === NEW_NICK, 'the new nickname was not taken');
  check(!PERSONA_ID.test(roundTwo.raw), 'a persona id leaked into the save');
  const screen = await run(win, `document.documentElement.outerHTML`);
  check(!PERSONA_ID.test(screen), 'a persona id leaked onto the screen');
  const open2 = registry().series[0].open;
  check(open2.length === 1 && Object.keys(open2[0].bindings).length === NPC_COUNT, 'the registry does not know who plays');
  const personaTraits = new Map(registry().series[0].personas.map((persona) => [persona.personaId, persona.traits]));
  for (const [ownerId, personaId] of Object.entries(open2[0].bindings)) {
    check(roundTwo.save.npc.profiles[ownerId].traits.aggression === personaTraits.get(personaId).aggression, `${ownerId} lost its character`);
  }
  results.roundTwo = { nick: roundTwo.save.profile.displayName, inherited: profiles.length };

  // 6. The pause menu ends the round: its outcome goes into the series, the wizard opens for the next.
  await run(win, `document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));`);
  await waitFor(win, `document.querySelector('[data-qa-pause="end-round"]')`);
  await capture(win, '05-pause-end-round');
  await click(win, '[data-qa-pause="end-round"]');
  await click(win, '[data-qa-pause-end-round-confirm]');
  await goToWorldStep(win);
  const afterLeave = registry().series[0];
  check(afterLeave.rounds === 2 && afterLeave.open.length === 0 && afterLeave.personas.every((persona) => persona.campaigns === 2), 'leaving did not fold the round');
  check(afterLeave.personas.every((persona) => persona.results.at(-1).kind === 'left'), 'the round is not marked as left');
  check(fs.existsSync(path.join(PROFILE, 'personas.v1.backup.json')), 'no backup of the previous registry');
  check(/раунд 3/i.test(await run(win, `document.querySelector('[data-qa-series-note]').textContent`)), 'the wizard does not offer round 3');

  // 7. The switch turned off: a clean population, the series untouched.
  const beforeClean = fs.readFileSync(REGISTRY, 'utf8');
  const slots = await slotsCount(win);
  await click(win, '[data-qa-series-toggle]');
  await click(win, '[data-qa-wizard-rail="confirm"]');
  await waitFor(win, `document.querySelector('[data-qa-wizard-step="confirm"]')`);
  check(/без чужого опыта/.test(await run(win, `document.querySelector('[data-qa-series-line]').textContent`)), 'the summary must say the population is clean');
  await click(win, '[data-qa-wizard-start]');
  await waitFor(win, `document.querySelector('[data-qa-navigation="utility"]')`);
  await sleep(1500);
  check(await slotsCount(win) === slots + 1, 'no new slot');
  const clean = await run(win, `(() => {
    const index = JSON.parse(localStorage.getItem('asterion.slots.index.v1'));
    const slot = index.slots.find((item) => item.id === index.activeSlotId);
    return ${PARSE_SAVE}(localStorage.getItem(slot.storageKey));
  })()`);
  check(Object.values(clean.npc.profiles).every((profile) => profile.inherited === undefined), 'a clean game got someone\'s experience');
  check(fs.readFileSync(REGISTRY, 'utf8') === beforeClean, 'a clean game touched the series');
  results.clean = { npc: Object.keys(clean.npc.profiles).length };

  // 8. Without the desktop bridge (the web version): honest about it.
  const browser = new BrowserWindow({ show: false, width: 1920, height: 1080, webPreferences: { contextIsolation: true, sandbox: true } });
  await browser.loadFile(path.join(ROOT, 'dist', 'index.html'));
  await waitFor(browser, `document.querySelector('[data-qa-menu="main"]')`);
  await click(browser, '[data-qa-menu-action="new"]');
  await goToWorldStep(browser);
  check(await run(browser, `document.querySelector('[data-qa-series-toggle]').disabled`), 'the switch must be off in the browser');
  check(/Недоступно в браузере/.test(await run(browser, `document.querySelector('[data-qa-series-note]').textContent`)), 'the browser version does not say it is unavailable');
  await capture(browser, '06-wizard-browser');
  browser.destroy();

  console.log(JSON.stringify(results, null, 2));
  win.destroy();
}

main().then(() => {
  try { fs.rmSync(temp, { recursive: true, force: true }); } catch { /* locked until exit */ }
  app.exit(0);
}, (error) => {
  console.error(error);
  app.exit(1);
});
