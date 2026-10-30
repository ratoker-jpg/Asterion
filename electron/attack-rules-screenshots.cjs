// Screenshots for the «Правила: допуск атаки, разведка, требования» PR, taken
// from real game flows only:
// - production: a new game through the wizard, then «Вселенная → Атаковать»
//   on a generated NPC; the refusal comes from the authoritative preview;
// - Test Mode: the built-in «ЗАПУСТИТЬ АТАКУ BOT 01» scenario, viewed at the
//   player's Espionage 0 and again at 10 (the only save edit is that science
//   level, stated in the manifest), plus the building and production cards.
// Output: visual-qa/attack-rules (not committed).
const { app, BrowserWindow } = require('electron');
const { PARSE_SAVE } = require('./qa-save.cjs');
const fs = require('fs');
const path = require('path');

app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-gpu');
app.on('window-all-closed', () => {});

const ROOT = path.join(__dirname, '..');
const OUTPUT = path.join(ROOT, 'visual-qa', 'attack-rules');
const TEST_KEY = 'asterion.vertical-slice.test.v1';
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

async function settle(win, ms = 400) {
  await run(win, 'document.fonts?.ready');
  await run(win, 'new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
  await sleep(ms);
}

async function load(win, search) {
  const done = new Promise((resolve) => win.webContents.once('did-finish-load', resolve));
  await win.loadFile(path.join(ROOT, 'dist', 'index.html'), search ? { search } : undefined);
  await done;
  await sleep(300);
}

async function reload(win) {
  const done = new Promise((resolve) => win.webContents.once('did-finish-load', resolve));
  win.webContents.reload();
  await done;
  await waitFor(win, `document.querySelector('[data-qa-navigation="primary"]')`);
  await settle(win);
}

async function click(win, selector) {
  const ok = await run(win, `(() => { const node = document.querySelector(${JSON.stringify(selector)}); if (!node || node.disabled) return false; node.scrollIntoView({ block: 'nearest' }); node.click(); return true; })()`);
  if (!ok) throw new Error(`Missing or disabled control: ${selector}`);
  await settle(win, 250);
}

async function clickPrimary(win, route) {
  await click(win, `[data-qa-navigation="primary"] [data-qa-route="${route}"]`);
}

async function capture(win, name, note) {
  fs.mkdirSync(OUTPUT, { recursive: true });
  await sleep(1200);
  win.webContents.invalidate();
  await run(win, 'new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
  await sleep(300);
  const [width, height] = win.getContentSize();
  const image = await win.capturePage({ x: 0, y: 0, width, height });
  fs.writeFileSync(path.join(OUTPUT, `${name}.png`), image.toPNG());
  manifest.push({ file: `${name}.png`, width, height, note });
}

function openWindow(partition, width = 1920, height = 1080) {
  return new BrowserWindow({ width, height, useContentSize: true, show: false, backgroundColor: '#02050a',
    webPreferences: { offscreen: false, contextIsolation: true, nodeIntegration: false, sandbox: true, partition } });
}

async function productionAttackRefusal() {
  const win = openWindow(`qa-attack-rules-production-${Date.now()}`);
  try {
    await load(win);
    await run(win, 'localStorage.clear(); sessionStorage.clear();');
    await load(win);
    await waitFor(win, `document.querySelector('[data-qa-menu="main"]')`);
    await click(win, '[data-qa-menu-action="new"]');
    await waitFor(win, `document.querySelector('[data-qa-wizard-step="race"]')`);
    await click(win, '[data-qa-race="aegis"]');
    await click(win, '[data-qa-wizard-next]');
    await waitFor(win, `document.querySelector('[data-qa-wizard-step="world"]')`);
    await run(win, `(() => {
      const input = document.querySelector('[data-qa-world="seed"]');
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, 'ATTACKRULES');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    })()`);
    await click(win, '[data-qa-wizard-next]');
    await waitFor(win, `document.querySelector('[data-qa-wizard-step="confirm"]')`);
    await click(win, '[data-qa-wizard-start]');
    await waitFor(win, `document.querySelector('[data-qa-navigation="utility"]')`, 60_000);
    await settle(win, 1500);

    const world = await run(win, `(() => {
      const index = ${PARSE_SAVE}(localStorage.getItem('asterion.slots.index.v1'));
      const save = ${PARSE_SAVE}(localStorage.getItem(index.slots[0].storageKey));
      const home = save.planets[save.currentPlanetId];
      const npc = Object.values(save.espionage.targets).filter((target) => target.kind === 'npc' && target.coordinate.galaxy === home.universeGalaxy)
        .sort((a, b) => Math.abs(a.coordinate.system - home.universeSystem) - Math.abs(b.coordinate.system - home.universeSystem))[0];
      return { npc: npc && { id: npc.id, ownerName: npc.ownerName, coordinate: npc.coordinate }, scouts: home.fleet.ships.scout };
    })()`);
    if (!world.npc) throw new Error('No NPC planet in the home galaxy');

    await clickPrimary(win, 'universe');
    await waitFor(win, `document.querySelector('[data-qa-universe]')`);
    await run(win, `(() => {
      const element = document.querySelector('.universe-jump select');
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(element, ${JSON.stringify(String(world.npc.coordinate.system))});
      element.dispatchEvent(new Event('change', { bubbles: true }));
    })()`);
    await waitFor(win, `document.querySelector('[data-qa-universe]')?.getAttribute('data-qa-universe-system') === ${JSON.stringify(String(world.npc.coordinate.system))}`);
    await settle(win);
    const objectSelector = `[data-qa-universe-object][data-qa-universe-kind="npc"]`;
    const objectId = await run(win, `(() => {
      const nodes = [...document.querySelectorAll(${JSON.stringify(objectSelector)})];
      const match = nodes.find((node) => (node.getAttribute('data-qa-universe-object') || '').includes(${JSON.stringify(world.npc.id)})) || nodes[0];
      return match?.getAttribute('data-qa-universe-object') || '';
    })()`);
    if (!objectId) throw new Error(`NPC planet not drawn in system ${world.npc.coordinate.system}`);
    await click(win, `[data-qa-universe-object="${objectId}"]`);
    await waitFor(win, `document.querySelector('[data-qa-universe-inspector]')`);
    await click(win, '[data-qa-universe-action="attack"]');
    await waitFor(win, `document.querySelector('[data-qa-attack-prep]')`);
    // All available scouts (the player's starting attack ships).
    await run(win, `(() => {
      const tile = document.querySelector('[data-qa-fleet-ship="scout"]');
      [...tile.querySelectorAll('button')].find((button) => button.textContent.trim() === 'МАКС.').click();
    })()`);
    await settle(win);
    await click(win, '[data-qa-flight-preview-open]');
    await waitFor(win, `document.querySelector('[data-qa-flight-preview-error]')`);
    const refusal = await run(win, `({
      error: document.querySelector('[data-qa-flight-preview-error]')?.textContent?.trim() || '',
      target: document.querySelector('[data-qa-target-relation]')?.textContent?.trim() || '',
      dispatchDisabled: Boolean(document.querySelector('[data-qa-flight-dispatch-confirm]')?.disabled),
    })`);
    if (!/атаковать можно с 300/.test(refusal.error) || !refusal.dispatchDisabled) throw new Error(`Refusal not shown: ${JSON.stringify(refusal)}`);
    await capture(win, '01-attack-refused-protected-player',
      `New game through the wizard, Вселенная → ${world.npc.ownerName} [${world.npc.coordinate.galaxy}:${world.npc.coordinate.system}:${world.npc.coordinate.position}] → Атаковать, ${world.scouts} scouts. Preview: «${refusal.error}», send disabled.`);
  } finally {
    win.destroy();
  }
}

async function showIncomingRow(win) {
  await waitFor(win, `document.querySelector('[data-qa-fleet-incoming-alert]')`);
  await run(win, `[...document.querySelectorAll('[data-qa-fleet-incoming-alert] button')].find((button) => button.textContent.trim() === 'ПОКАЗАТЬ РЕЙС')?.click()`);
  await waitFor(win, `document.querySelector('[data-qa-flight-incoming-attack]')?.getBoundingClientRect().height > 0`);
  await run(win, `document.querySelector('[data-qa-flight-incoming-attack]').scrollIntoView({ block: 'center' })`);
  await settle(win, 800);
}

async function testModeScreens() {
  const win = openWindow(`qa-attack-rules-test-${Date.now()}`);
  try {
    await load(win, '?mode=test');
    await waitFor(win, `document.querySelector('[data-qa-navigation="utility"]')`, 60_000);
    await waitFor(win, `localStorage.getItem(${JSON.stringify(TEST_KEY)})`);
    await settle(win, 1000);

    // Buildings: Mineral mine II on the starting Test Mode planet.
    await waitFor(win, `document.querySelector('[data-qa-zone="resource"]')`);
    await click(win, '[data-qa-zone="resource"]');
    await waitFor(win, `document.querySelector('[data-qa-zone-view][data-zone="resource"]')`);
    await click(win, '[data-zone-building-role="mineral-production-2"]');
    await waitFor(win, `document.querySelector('[data-qa-building-dialog="mineral-production-2"] [data-qa-requirements]')`);
    const mine = await run(win, `document.querySelector('[data-qa-building-dialog="mineral-production-2"] [data-qa-requirements]')?.textContent?.replace(/\\s+/g, ' ').trim() || ''`);
    await capture(win, '02-mineral-mine-2-requirement', `Test Mode start, resource zone → Минеральная шахта II: «${mine}»`);
    await click(win, '.resource-building-dialog-close');

    // Defense catalog and the Reanimator in the shipyard catalog.
    await clickPrimary(win, 'fleets');
    await waitFor(win, `document.querySelector('.fleet-workspace-v1')`);
    await click(win, '[data-qa-fleet-section="defense"]');
    await waitFor(win, `document.querySelector('[data-qa-construction-mode="defense"]')`);
    await run(win, `document.querySelector('[data-qa-fleet-production-item="tower-shield"]')?.scrollIntoView({ block: 'center' })`);
    const shield = await run(win, `document.querySelector('[data-qa-fleet-production-item="tower-shield"] [data-qa-production-requirements]')?.textContent?.replace(/\\s+/g, ' ').trim() || ''`);
    await capture(win, '03-defense-requirements', `Test Mode, Флот → Оборона, Башенный щит: «${shield}»`);
    await click(win, '[data-qa-fleet-section="commander-ships"]');
    await waitFor(win, `document.querySelector('[data-qa-construction-mode="commander"]')`);
    await run(win, `document.querySelector('[data-qa-fleet-production-item="reanimator"]')?.scrollIntoView({ block: 'center' })`);
    const reanimator = await run(win, `document.querySelector('[data-qa-fleet-production-item="reanimator"] [data-qa-production-requirements]')?.textContent?.replace(/\\s+/g, ' ').trim() || ''`);
    await capture(win, '04-reanimator-requirement', `Test Mode, Флот → Командирские корабли, Реаниматор: «${reanimator}»`);

    // Incoming Bot 01 attack: the built-in Test Mode scenario.
    await clickPrimary(win, 'fleets');
    await waitFor(win, `document.querySelector('[data-qa-bot01-scenario]')`);
    await click(win, '[data-qa-bot01-scenario]');
    await showIncomingRow(win);
    const espionage = await run(win, `${PARSE_SAVE}(localStorage.getItem(${JSON.stringify(TEST_KEY)})).science.levels[5] ?? 0`);
    const hidden = await run(win, `(() => { const row = document.querySelector('[data-qa-flight-incoming-attack]'); return { text: row?.textContent?.replace(/\\s+/g, ' ').trim() || '', hidden: Boolean(row?.querySelector('[data-qa-incoming-composition-hidden]')), shown: Boolean(row?.querySelector('[data-qa-incoming-composition]')) }; })()`);
    if (!hidden.hidden || hidden.shown) throw new Error(`Composition visible below Espionage 10: ${JSON.stringify(hidden)}`);
    await capture(win, '05-incoming-attack-espionage-below-10', `Test Mode «ЗАПУСТИТЬ АТАКУ BOT 01», player Espionage ${espionage}: ${hidden.text}`);

    // The same flight, viewed after the player's Espionage is set to 10 (the only save edit).
    await run(win, `(() => { const save = ${PARSE_SAVE}(localStorage.getItem(${JSON.stringify(TEST_KEY)})); save.science.levels[5] = 10; localStorage.setItem(${JSON.stringify(TEST_KEY)}, JSON.stringify(save)); })()`);
    await reload(win);
    await clickPrimary(win, 'fleets');
    await showIncomingRow(win);
    await waitFor(win, `document.querySelector('[data-qa-flight-incoming-attack] [data-qa-incoming-composition]')`);
    const shown = await run(win, `document.querySelector('[data-qa-flight-incoming-attack] [data-qa-incoming-composition]')?.textContent?.trim() || ''`);
    await capture(win, '06-incoming-attack-espionage-10', `Same Bot 01 flight after setting the save's Espionage (science 5) to 10: «${shown}»`);
  } finally {
    win.destroy();
  }
}

app.whenReady().then(async () => {
  try {
    fs.rmSync(OUTPUT, { recursive: true, force: true });
    await productionAttackRefusal();
    await testModeScreens();
    fs.writeFileSync(path.join(OUTPUT, 'manifest.json'), JSON.stringify(manifest, null, 2));
    console.log(JSON.stringify(manifest, null, 2));
    app.exit(0);
  } catch (error) {
    console.error(error);
    fs.mkdirSync(OUTPUT, { recursive: true });
    fs.writeFileSync(path.join(OUTPUT, 'manifest.json'), JSON.stringify(manifest, null, 2));
    app.exit(1);
  }
});
