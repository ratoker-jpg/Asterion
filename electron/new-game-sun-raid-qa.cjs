// QA for the main menu, «Новая игра», save slots, «Операции → Солнца», the Gate and the campaign result.
// Production flow uses a clean profile; the Sun raid is exercised in Test Mode with the fixtures.
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-gpu');
app.on('window-all-closed', () => {});

const ROOT = path.join(__dirname, '..');
const OUTPUT = process.env.ASTERION_QA_OUTPUT || path.join(ROOT, 'artifacts', 'new-game-sun-raid-qa');
const VIEWPORTS = [[1920, 1080], [1280, 720]];
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

async function capture(win, label, name) {
  const directory = path.join(OUTPUT, label);
  fs.mkdirSync(directory, { recursive: true });
  await sleep(900); // menu entrance animations
  // A hidden window may hand back its last composited frame: force a fresh one.
  win.webContents.invalidate();
  await run(win, 'new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
  await sleep(300);
  const [width, height] = win.getContentSize();
  const image = await win.capturePage({ x: 0, y: 0, width, height });
  fs.writeFileSync(path.join(directory, `${name}.png`), image.toPNG());
}

async function click(win, selector) {
  const ok = await run(win, `(() => { const node = document.querySelector(${JSON.stringify(selector)}); if (!node || node.disabled) return false; node.click(); return true; })()`);
  if (!ok) throw new Error(`Missing or disabled control: ${selector}`);
  await sleep(250);
}

async function clickText(win, text) {
  const ok = await run(win, `(() => { const node = [...document.querySelectorAll('button')].find((item) => item.textContent.trim() === ${JSON.stringify(text)}); if (!node) return false; node.click(); return true; })()`);
  if (!ok) throw new Error(`Missing button: ${text}`);
  await sleep(400);
}

async function shiftClock(win, minutes) {
  await run(win, `(() => { const base = Date.now.bind(Date); const shift = ${minutes * 60_000}; Date.now = () => base() + shift; })()`);
  await sleep(3_000);
}

async function production(win, label) {
  await load(win);
  await run(win, 'localStorage.clear(); sessionStorage.clear();');
  await load(win);
  await waitFor(win, `document.querySelector('[data-qa-menu="main"]')`);
  if (!(await run(win, `document.querySelector('[data-qa-menu-action="continue"]').disabled`))) throw new Error('Continue must be disabled without saves');
  await capture(win, label, '01-main-menu-empty');

  await click(win, '[data-qa-menu-action="new"]');
  await waitFor(win, `document.querySelector('[data-qa-wizard-step="race"]')`);
  await capture(win, label, '02-new-game-race');
  await click(win, '[data-qa-race="synod"]');
  if ((await run(win, 'document.documentElement.dataset.faction')) !== 'synod') throw new Error('Race theme did not follow the selection');
  await capture(win, label, '03-new-game-race-synod');
  await click(win, '[data-qa-wizard-next]');
  await waitFor(win, `document.querySelector('[data-qa-wizard-step="world"]')`);
  await run(win, `(() => {
    const set = (qa, value) => { const input = document.querySelector('[data-qa-world="' + qa + '"]'); const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; setter.call(input, String(value)); input.dispatchEvent(new Event('input', { bubbles: true })); };
    set('galaxies', 3); set('npc', 40); set('seed', 'QASEED42');
  })()`);
  await sleep(300);
  await capture(win, label, '04-new-game-world');
  await click(win, '[data-qa-wizard-next]');
  await waitFor(win, `document.querySelector('[data-qa-wizard-step="confirm"]')`);
  await capture(win, label, '05-new-game-confirm');
  await click(win, '[data-qa-wizard-start]');
  await waitFor(win, `document.querySelector('[data-qa-navigation="utility"]')`);
  await sleep(1200);
  await capture(win, label, '06-game-started');

  const save = await run(win, `(() => { const index = JSON.parse(localStorage.getItem('asterion.slots.index.v1')); const slot = index.slots[0]; return { index, save: JSON.parse(localStorage.getItem(slot.storageKey)) }; })()`);
  if (save.save.profile.factionId !== 'synod') throw new Error('Saved race is not Илары');
  if (save.save.worldConfig.world.galaxyCount !== 3) throw new Error('World config not stored');
  if (save.index.slots.length !== 1 || save.index.activeSlotId !== save.index.slots[0].id) throw new Error('Slot index mismatch');

  // Solo, no Hall: «Операции» (Sun raids) are an alliance feature and stay hidden.
  await clickText(win, 'Командование');
  if (await run(win, `Boolean(document.querySelector('[data-qa-command-tab="operations"]'))`)) throw new Error('Operations tab must be hidden without an alliance');
  await capture(win, label, '07-command-solo');
  // «Найти обломки» on a fresh world: nothing around the selected planet.
  await clickText(win, 'Вселенная');
  await waitFor(win, `document.querySelector('[data-qa-universe-find-debris]')`);
  await click(win, '[data-qa-universe-find-debris]');
  await waitFor(win, `document.querySelector('[data-qa-debris-finder-empty]')`);
  await capture(win, label, '07b-debris-finder-empty');
  await clickText(win, 'ОК');

  await click(win, '[data-qa-pause-open]');
  await waitFor(win, `document.querySelector('[data-qa-pause-menu]')`);
  await capture(win, label, '08-pause-menu');

  await click(win, '[data-qa-pause="load"]');
  await waitFor(win, `document.querySelector('[data-qa-load-screen]')`, 20_000);
  await capture(win, label, '09-load-screen');

  await load(win, '?autostart=continue');
  await waitFor(win, `document.querySelector('[data-qa-navigation="utility"]')`);
  if ((await run(win, 'document.documentElement.dataset.faction')) !== 'synod') throw new Error('Race lost after reload');
}

async function testMode(win, label) {
  await run(win, `localStorage.removeItem('asterion.vertical-slice.test.v1')`);
  await load(win, '?mode=test');
  await waitFor(win, `document.querySelector('[data-qa-navigation="utility"]')`);
  await sleep(800);
  await clickText(win, 'Командование');
  await click(win, '[data-qa-command-tab="operations"]');
  await waitFor(win, `document.querySelector('[data-qa-sun-raid-panel]')`);
  await click(win, '[data-qa-test="bot01-raid"]');
  await waitFor(win, `document.querySelector('[data-qa-sun-alert]')`);
  await capture(win, label, '10-test-incoming-sun-raid');
  // «Поддержка солнца» is a Fleets mission: the panel opens «Флоты» with the Sun preselected.
  await click(win, '[data-qa-sun-support]');
  await waitFor(win, `document.querySelector('[data-qa-mission-id="sun-support"].active')`);
  const civil = await run(win, `[...document.querySelectorAll('[data-qa-fleet-roster] [data-qa-fleet-ship]')].map((row) => row.getAttribute('data-qa-fleet-ship')).filter((id) => ['spy-probe','colonizer','recycler','transporter','mega-transporter','solar-satellite'].includes(id))`);
  if (civil.length) throw new Error('Civil hulls offered for Sun support: ' + civil.join(', '));
  await run(win, `(() => { const row = document.querySelector('[data-qa-fleet-roster] [data-qa-fleet-ship]'); [...row.querySelectorAll('button')].find((item) => item.textContent.trim() === 'МАКС.').click(); })()`);
  await sleep(300);
  await capture(win, label, '11-test-support-fleets');
  await click(win, '[data-qa-flight-preview-open]');
  await waitFor(win, `document.querySelector('[data-qa-sun-target-select] select')?.value?.startsWith('sun:')`);
  await waitFor(win, `!document.querySelector('[data-qa-flight-dispatch-confirm]')?.disabled`);
  await capture(win, label, '11b-test-support-plan');
  await click(win, '[data-qa-flight-dispatch-confirm]');
  await waitFor(win, `[...document.querySelectorAll('[data-qa-flight-row]')].length > 0`);
  await clickText(win, 'Командование');
  await click(win, '[data-qa-command-tab="operations"]');
  await waitFor(win, `document.querySelector('[data-qa-sun-raid-panel]')`);
  await click(win, '[data-qa-test="ira-support"]');
  await shiftClock(win, 13);
  await waitFor(win, `document.querySelector('[data-qa-sun-result]')`);
  await capture(win, label, '12-test-raid-resolved');
  // The battle left debris at [G:S:0]: recyclers fly to the Sun from «Флоты».
  // «Найти обломки» lists the Sun's debris at [1:1:0]; «Отправить» opens «Флоты → Переработка».
  await clickText(win, 'Вселенная');
  await waitFor(win, `document.querySelector('[data-qa-universe-find-debris]')`);
  await click(win, '[data-qa-universe-find-debris]');
  await waitFor(win, `document.querySelector('[data-qa-debris-row="[1:1:0]"]')`);
  await capture(win, label, '12a-debris-finder');
  await click(win, '[data-qa-debris-send="[1:1:0]"]');
  await waitFor(win, `document.querySelector('[data-qa-mission-id="recycle"].active')`);
  await clickText(win, 'Командование');
  await click(win, '[data-qa-command-tab="operations"]');
  await waitFor(win, `document.querySelector('[data-qa-sun-raid-panel]')`);
  if (await run(win, `Number(document.querySelector('[data-qa-sun-debris]')?.getAttribute('data-qa-sun-debris') ?? 0) > 0`)) {
    await click(win, '[data-qa-sun-recycle]');
    await waitFor(win, `document.querySelector('[data-qa-mission-id="recycle"].active')`);
    await capture(win, label, '12b-test-sun-debris-recycle');
    await clickText(win, 'Командование');
    await click(win, '[data-qa-command-tab="operations"]');
    await waitFor(win, `document.querySelector('[data-qa-sun-raid-panel]')`);
  }

  for (let index = 0; index < 4; index += 1) await click(win, '[data-qa-test="grant-crystal"]');
  await click(win, '[data-qa-open-gate]');
  await waitFor(win, `document.querySelector('[data-qa-gate-dialog]')`);
  await capture(win, label, '13-test-gate-ready');
  await click(win, '[data-qa-gate-start]');
  await waitFor(win, `document.querySelector('[data-qa-gate-dialog="building"]')`);
  await capture(win, label, '14-test-gate-building');
  await click(win, '.gate-close');
  await clickText(win, 'Планета');
  await run(win, `[...document.querySelectorAll('button')].find((item) => /ВОЕННАЯ/.test(item.textContent))?.click()`);
  await waitFor(win, `document.querySelector('[data-qa-gate-slot="building"]')`);
  await capture(win, label, '15-test-military-zone-gate');
  await click(win, '[data-qa-pause-open]');
  await waitFor(win, `document.querySelector('[data-qa-pause-menu="test"]')`);
  await capture(win, label, '15b-test-pause-menu');
  await click(win, '[data-qa-pause="resume"]');
  await shiftClock(win, 60);
  await waitFor(win, `document.querySelector('[data-qa-campaign-result="victory"]')`);
  await sleep(1500);
  await capture(win, label, '16-test-victory');
}

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, useContentSize: true, width: 1920, height: 1080, webPreferences: { backgroundThrottling: false } });
  try {
    for (const [width, height] of VIEWPORTS) {
      win.setContentSize(width, height);
      const label = `${width}x${height}`;
      await production(win, label);
      await testMode(win, label);
      console.log(`[new-game-sun-raid-qa] ${label}: ok`);
    }
    console.log(`[new-game-sun-raid-qa] screenshots: ${OUTPUT}`);
    app.exit(0);
  } catch (error) {
    console.error('[new-game-sun-raid-qa] FAILED', error);
    app.exit(1);
  }
});
