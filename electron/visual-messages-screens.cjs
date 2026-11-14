// «Сообщения» redo (10.11.2026): worst-case screenshots of the inbox at 1280×720 and
// 2560×1080, plus the three small fixes batched with it.
// Cases: 500+ unread messages (arrivals and spy reports), very long subjects (300 spy reports on planets with long
// names), a 42-character alliance name, empty tabs, a filter with no result, a huge
// spy report (every ship, defence and commander with 12-digit numbers), the commander
// tooltip, the header with a 24-character planet name (and its game tooltip), and the
// building dialog short of three resources. Also «Загрузить игру»: save cards with a
// 40-character name, the «ПОСЛЕДНЯЯ» badge, 4 crystals + «ПОБЕДА» (every action reachable).
// Layout contracts (ASTERION_QA_CHECKS=0 records them without failing, used for the
// «before» run on main): no text cut off without an ellipsis, no native title tooltips,
// the screen fits the window, the header shows the full planet name in its tooltip and
// the dialog names every short resource.
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');
const { patchSaveIdle } = require('./qa-save-edit.cjs');
const { PARSE_SAVE } = require('./qa-save.cjs');

app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-gpu');
app.on('window-all-closed', () => {});

const ROOT = path.join(__dirname, '..');
const OUTPUT = process.env.ASTERION_QA_OUTPUT || path.join(ROOT, 'visual-qa', 'screens-messages', 'run');
const CHECKS = process.env.ASTERION_QA_CHECKS !== '0';
const SHOTS = process.env.ASTERION_SKIP_SCREENSHOTS !== '1';
const SAVE_KEY = 'asterion.vertical-slice.test.v1';
const VIEWPORTS = [[1280, 720], [2560, 1080]];
const PLANET_24 = 'Новая Кассиопея Северная';
const ALLIANCE_42 = 'Объединённый Северный Союз Звёздных Флотов';
const ALLIANCE_TAG = 'NORTHSTR';
const LONG_TARGETS = [
  'Кассиопея Восточный Рубеж Обороны Седьмого Сектора',
  'Новая Надежда Первой Экспедиции к Ядру Галактики',
  'Нордин Ледяной Перевал Седьмого Сектора',
  'Колония Шахтёрская Глубинная Номер Семнадцать',
];
const SHIPS = ['transporter', 'mega-transporter', 'colonizer', 'recycler', 'scout', 'cruiser', 'defender', 'battleship', 'destroyer', 'bomber', 'death-star'];
const DEFENSE = ['ballistic-turret', 'laser-turret', 'ion-turret', 'plasma-turret', 'laser-ion-battery', 'plasma-laser-battery', 'ion-plasma-battery', 'tower-shield', 'planetary-shield'];
const COMMANDERS = ['corsair', 'hunter', 'executioner', 'juggernaut', 'typhoon', 'viper', 'phantom', 'scorpion', 'annihilator', 'reanimator', 'argo', 'judge', 'polias'];
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(win, expression, timeoutMs = 15000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await win.webContents.executeJavaScript(`Boolean(${expression})`)) return;
    await sleep(60);
  }
  throw new Error(`Timed out waiting for: ${expression}`);
}

async function settle(win, ms = 160) {
  await win.webContents.executeJavaScript('new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
  await sleep(ms);
}

async function images(win) {
  await waitFor(win, `Array.from(document.querySelectorAll('.reports-view img, .asterion-header img')).every((img) => img.complete)`, 15000).catch(() => {});
}

async function capture(win, directory, name) {
  if (!SHOTS) return;
  await images(win);
  await win.webContents.executeJavaScript(`document.getAnimations().forEach((animation) => {
    const timing = animation.effect?.getComputedTiming?.();
    if (timing && Number.isFinite(timing.endTime)) animation.currentTime = timing.endTime;
  })`);
  await settle(win, 80);
  const result = await win.webContents.debugger.sendCommand('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: false });
  fs.writeFileSync(path.join(directory, `${name}.png`), Buffer.from(result.data, 'base64'));
}

async function click(win, selector) {
  const clicked = await win.webContents.executeJavaScript(`(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    if (!element || element.disabled) return false;
    element.click();
    return true;
  })()`);
  if (!clicked) throw new Error(`Element not found/enabled: ${selector}`);
  await settle(win, 260);
}

async function hover(win, selector) {
  const box = await win.webContents.executeJavaScript(`(() => {
    const node = document.querySelector(${JSON.stringify(selector)});
    if (!node) return null;
    node.scrollIntoView({ block: 'center' });
    const r = node.getBoundingClientRect();
    return { x: r.left + Math.min(r.width / 2, 60), y: r.top + r.height / 2 };
  })()`);
  if (!box) throw new Error(`Hover target not found: ${selector}`);
  await win.webContents.debugger.sendCommand('Input.dispatchMouseEvent', { type: 'mouseMoved', x: box.x, y: box.y });
  await settle(win, 450);
}

async function unhover(win) {
  await win.webContents.debugger.sendCommand('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 2, y: 2 });
  await settle(win, 200);
}

/** Text that is cut off (an ellipsis is allowed). */
function clippedText(win, scope) {
  return win.webContents.executeJavaScript(`(() => {
    const out = [];
    document.querySelectorAll(${JSON.stringify(scope)}).forEach((root) => root.querySelectorAll('strong, small, em, b, span, h1, h2, h3, p, time, dt, dd, button, label').forEach((node) => {
      if (!node.getClientRects().length || !node.textContent.trim() || node.children.length) return;
      if (node.closest('.spy-entity-tooltip, .hdr-tip')) return;
      const style = getComputedStyle(node);
      const cutX = node.scrollWidth > node.clientWidth + 1 && style.overflow !== 'visible';
      const cutY = node.scrollHeight > node.clientHeight + 2 && style.overflowY !== 'visible' && style.overflowY !== 'auto';
      if ((cutX && style.textOverflow !== 'ellipsis') || cutY) out.push(node.textContent.trim().slice(0, 60));
    }));
    return out;
  })()`);
}

async function layout(win) {
  return win.webContents.executeJavaScript(`(() => {
    const view = document.querySelector('.reports-view')?.getBoundingClientRect();
    return {
      fits: Boolean(view) && view.bottom <= innerHeight + 1 && view.right <= innerWidth + 1,
      horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 2,
      nativeTitles: Array.from(document.querySelectorAll('.reports-view [title], [data-qa-header] [title]')).map((node) => node.getAttribute('title')),
    };
  })()`);
}

function seedSource(now) {
  const spy = (id, index, targetPlanetName, huge) => ({
    id, missionId: `${id}-mission`, createdAt: now - 60_000 - index * 45_000,
    sourcePlanetId: 'helion-01', targetPlanetId: `qa-target-${index}`, targetPlanetName,
    targetOwnerId: 'npc-bot-01', targetOwnerName: 'Адмирал Северного Рубежа', targetRaceId: ['aegis', 'synod', 'veyra'][index % 3], targetRelation: 'enemy',
    targetCoordinate: { galaxy: 1, system: 10 + (index % 40), position: 1 + (index % 15) }, spyLevel: 12, targetEspionageLevel: 4, delta: 8, roll: 0,
    quality: 'full',
    resources: huge ? { metal: 999999999999, minerals: 888888888888, gas: 777777777777, debris: 123456789012, developmentEnergy: 999999999 } : { metal: 120000, minerals: 80000, gas: 40000, debris: 0, developmentEnergy: 300 },
    fleet: Object.fromEntries(SHIPS.map((ship) => [ship, huge ? 999999999 : 12])),
    fleetLevels: Object.fromEntries(SHIPS.map((ship) => [ship, 20])),
    defense: Object.fromEntries(DEFENSE.map((item) => [item, huge ? 99999999 : 3])),
    commanders: huge ? Object.fromEntries(COMMANDERS.map((commander, level) => [commander, { level: 20 + level, count: 99 }])) : { hunter: { level: 4, count: 1 } },
    population: { total: 99999999999, fleet: 88888888888, defense: 11111111111 }, firstReport: index === 0,
  });
  const reports = [spy('qa-huge-spy', 0, LONG_TARGETS[0], true)];
  for (let index = 1; index <= 300; index += 1) reports.push(spy(`qa-long-spy-${index}`, index, `${LONG_TARGETS[index % LONG_TARGETS.length]} ${index}`, false));
  const recycler = Array.from({ length: 250 }, (_, index) => ({
    id: `recycler-arrival:qa-flight-${index}`, flightId: `qa-flight-${index}`,
    coordinate: { galaxy: 1 + (index % 3), system: 1 + (index % 99), position: 1 + (index % 15) },
    arrivedAtMs: now - 30_000 - index * 10_000, collectedDebris: 1000 + index * 37, remainingOrbitalDebris: index % 4 ? 99999 : 0,
  }));
  const gas = Array.from({ length: 250 }, (_, index) => ({
    id: `gas-extraction-arrival:qa-gas-${index}`, flightId: `qa-gas-${index}`,
    coordinate: { galaxy: 2, system: 1 + (index % 99), position: 1 + (index % 15) },
    arrivalAt: now - 40_000 - index * 10_000, outcome: index % 5 ? 'found' : 'missed', gasCollected: index % 5 ? 5000 + index : 0, scrapCollected: index % 3 ? 120 : 0,
  }));
  return `(save) => {
    const now = ${now};
    const playerId = save.profile?.playerId;
    const home = save.planets?.['helion-01'];
    if (home) {
      home.name = ${JSON.stringify(PLANET_24)};
      if (home.resources) home.resources = { ...home.resources, metal: 0, minerals: 0, gas: 0 };
    }
    save.metal = 0; save.minerals = 0; save.gas = 0;
    save.queues = { ...(save.queues || {}), 'helion-01': [] };
    save.resourceClock = { ...(save.resourceClock || {}), lastReconciledAt: now, remainder: { metal: 0, minerals: 0, gas: 0, energy: 0 } };
    for (const alliance of save.command?.alliances || []) {
      if ((alliance.members || []).some((member) => member.ownerId === playerId)) { alliance.name = ${JSON.stringify(ALLIANCE_42)}; alliance.tag = ${JSON.stringify(ALLIANCE_TAG)}; }
    }
    save.espionage = { ...(save.espionage || {}), reports: ${JSON.stringify(reports)} };
    save.reports = { ...(save.reports || {}), readIds: [], hiddenIds: [], readUpTo: undefined, recyclerArrivalReports: ${JSON.stringify(recycler)}, gasExtractionArrivalReports: ${JSON.stringify(gas)} };
    localStorage.setItem('asterion.test-time-scale.v1', '1');
  }`;
}

async function openReports(win) {
  await click(win, '[data-qa-navigation="primary"] [data-qa-route="reports"]');
  await waitFor(win, `document.querySelector('[data-qa-profile]')`);
  await settle(win, 500);
}

async function openFolder(win, folder) {
  await click(win, `[data-message-folder="${folder}"]`);
  await waitFor(win, `document.querySelector('[data-qa-folder-view="${folder}"]')`);
  await settle(win, 400);
}

async function openReport(win, id) {
  // v3: one scrolling list, no pages.
  await win.webContents.executeJavaScript(`document.querySelector('[data-report-item-id="${id}"]')?.scrollIntoView({ block: 'center' })`);
  await click(win, `[data-report-item-id="${id}"] .reports-list-open`);
  await waitFor(win, `document.querySelector('[data-report-item-id="${id}"] .reports-list-open[aria-current="true"]')`);
  await settle(win, 400);
}

async function runViewport(win, directory, label) {
  const metrics = { failures: [] };
  const fail = (message, detail) => {
    metrics.failures.push(`${message}: ${JSON.stringify(detail)}`);
    if (CHECKS) throw new Error(`${label} ${message}: ${JSON.stringify(detail)}`);
  };
  const check = async (name) => {
    const clipped = await clippedText(win, '.reports-view');
    if (clipped.length) fail(`${name}: text is cut off`, clipped);
    const box = await layout(win);
    if (!box.fits || box.horizontalOverflow) fail(`${name}: screen does not fit`, box);
    if (box.nativeTitles.length) fail(`${name}: native title tooltips remain`, box.nativeTitles);
  };

  await patchSaveIdle(win, SAVE_KEY, seedSource(Date.now()), { label: 'messages QA seed' });
  await win.webContents.executeJavaScript('document.fonts?.ready');
  await settle(win, 400);

  // 1. Header: a 24-character planet name, full name in the game tooltip.
  metrics.header = await win.webContents.executeJavaScript(`(() => {
    const button = document.querySelector('[data-qa-current-planet]');
    const name = button?.querySelector('.hdr-planet-select__name') ?? button?.querySelector('strong');
    return { name: name?.textContent, width: name?.getBoundingClientRect().width, cut: name ? name.scrollWidth > name.clientWidth + 1 : null, ellipsis: name ? getComputedStyle(name).textOverflow : null, buttonWidth: button?.getBoundingClientRect().width };
  })()`);
  await hover(win, '[data-qa-current-planet]');
  metrics.headerTip = await win.webContents.executeJavaScript(`(() => {
    const tip = document.querySelector('[data-qa-current-planet] .hdr-tip');
    return tip ? { text: tip.textContent, visible: Number(getComputedStyle(tip).opacity) > 0.5 } : null;
  })()`);
  if (metrics.header.cut && metrics.header.ellipsis !== 'ellipsis') fail('Header planet name is cut without an ellipsis', metrics.header);
  if (!metrics.headerTip?.text?.startsWith(`${PLANET_24} · `) || !metrics.headerTip?.visible) fail('Header tooltip does not show the full planet name', metrics.headerTip);
  await capture(win, directory, '01-header-planet-24-chars');
  await unhover(win);

  // 2. Building dialog short of three resources.
  await click(win, '[data-qa-route="planet"]');
  if (await win.webContents.executeJavaScript(`Boolean(document.querySelector('[data-qa-planet-section="current"]'))`)) await click(win, '[data-qa-planet-section="current"]');
  for (const zone of ['industry', 'resource', 'military']) {
    if (metrics.dialog?.missing === 3) break;
    await click(win, `[data-qa-zone="${zone}"]`);
    await waitFor(win, `document.querySelector('[data-qa-zone-view][data-zone=${JSON.stringify(zone)}]')`);
    await settle(win, 400);
    const roles = await win.webContents.executeJavaScript(`Array.from(document.querySelectorAll('[data-zone-selector-role]')).map((node) => node.getAttribute('data-zone-selector-role'))`);
    for (const role of roles) {
      await click(win, `[data-zone-selector-role="${role}"]`);
      await waitFor(win, `document.querySelector('[data-qa-building-dialog]')`);
      await settle(win, 300);
      metrics.dialog = await win.webContents.executeJavaScript(`(() => {
        const dialog = document.querySelector('[data-qa-building-dialog]');
        return { role: ${JSON.stringify(role)}, missing: dialog.querySelectorAll('[data-qa-building-cost] em').length, status: dialog.querySelector('[data-qa-build-status]')?.textContent.replace(/\\s+/g, ' ').trim() };
      })()`);
      if (metrics.dialog.missing === 3) break;
      await click(win, '.resource-building-dialog-close');
    }
  }
  if (metrics.dialog?.missing !== 3) fail('No building dialog short of three resources', metrics.dialog);
  else if (!/металла, минералов(,| и) газа/.test(metrics.dialog.status || '')) fail('Dialog does not name every short resource', metrics.dialog);
  await capture(win, directory, '02-dialog-short-of-3-resources');
  await click(win, '.resource-building-dialog-close').catch(() => {});

  // 3. Profile with a 42-character alliance name.
  await openReports(win);
  await check('profile');
  await capture(win, directory, '03-profile-long-alliance');

  // 4. Unread-heavy inbox: 500 unread flights.
  await openFolder(win, 'flights');
  metrics.flights = await win.webContents.executeJavaScript(`({
    rows: document.querySelectorAll('[data-qa-message-list] .reports-list-item').length,
    unreadBadge: document.querySelector('[data-message-folder="flights"] .reports-v2-unread-count')?.textContent,
    unreadTotal: Array.from(document.querySelectorAll('[data-message-folder]')).reduce((sum, node) => sum + Number(/(\\d+) непрочитанных/.exec(node.getAttribute('aria-label') || '')?.[1] || 0), 0),
  })`);
  metrics.counters = await win.webContents.executeJavaScript(`Array.from(document.querySelectorAll('[data-message-folder] .reports-folder-counter')).map((node) => node.textContent)`);
  // v3: one badge per section with mail: the unread count (or the size when all is read), «99+» above 99.
  const badCounter = metrics.counters.filter((text) => !/^(\d{1,2}|99\+)$/.test(text));
  if (badCounter.length) fail('Folder counter is not one short badge', { counters: metrics.counters, badCounter });
  if (!metrics.counters.includes('99+')) fail('A folder with more than 99 unread does not show 99+', metrics.counters);
  if (metrics.flights.unreadTotal < 500) fail('The inbox does not hold 500 unread messages', metrics.flights);
  await check('500 flights');
  await capture(win, directory, '04-flights-500-unread');
  await click(win, '.reports-v2-filter-segments button:nth-child(2)');
  await capture(win, directory, '05-flights-unread-filter');
  await click(win, '.reports-v2-filter-segments button:nth-child(1)');

  // 5. Search with no result (v3: the magnifier opens the field).
  await click(win, '[data-qa-search-toggle]');
  await win.webContents.executeJavaScript(`(() => {
    const input = document.querySelector('.reports-search input');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, 'нет такого письма');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  await settle(win, 300);
  await check('search no result');
  await capture(win, directory, '06-search-no-result');

  // 6. Long subjects and the huge spy report.
  await openFolder(win, 'battle');
  await openReport(win, 'espionage:qa-huge-spy');
  await check('huge spy report');
  await capture(win, directory, '07-system-long-subjects-huge-spy');
  await hover(win, '.spy-report-entity--inspected');
  await capture(win, directory, '08-spy-commander-tooltip');
  await unhover(win);
  await win.webContents.executeJavaScript(`(() => { const s = document.querySelector('.reports-preview-scroll'); if (s) s.scrollTop = s.scrollHeight; })()`);
  await settle(win, 200);
  await capture(win, directory, '09-spy-report-bottom');

  // 7. A battle report (canonical Test Mode battle).
  await openFolder(win, 'battle');
  const battle = await win.webContents.executeJavaScript(`document.querySelector('[data-qa-message-list] [data-report-item-id]')?.getAttribute('data-report-item-id') || ''`);
  if (battle) {
    await openReport(win, battle);
    await check('battle');
    await capture(win, directory, '10-battle-report');
  }

  // 8. Empty tabs.
  for (const [index, folder] of [['11', 'achievements'], ['12', 'arena'], ['13', 'command']]) {
    await openFolder(win, folder);
    await check(`${folder} empty`);
    await capture(win, directory, `${index}-${folder}-empty`);
  }
  return metrics;
}

const LONG_SLOT = 'Северная Экспедиция к Ядру Галактики Ш40';

/** «Загрузить игру»: a real campaign from the wizard, cloned into worst-case cards. */
async function runSaveCards(width, height, directory, label) {
  const failures = [];
  const fail = (message, detail) => {
    failures.push(`${message}: ${JSON.stringify(detail)}`);
    if (CHECKS) throw new Error(`${label} ${message}: ${JSON.stringify(detail)}`);
  };
  const win = new BrowserWindow({ width, height, show: false, backgroundColor: '#02050a',
    webPreferences: { offscreen: true, contextIsolation: true, nodeIntegration: false, sandbox: true, partition: `qa-save-cards-${width}` } });
  try {
    // Attaching the debugger to a window that has never loaded a page crashes Electron on the CI runner.
    await win.loadURL('about:blank');
    win.webContents.debugger.attach('1.3');
    await win.webContents.debugger.sendCommand('Page.enable');
    await win.webContents.debugger.sendCommand('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false, screenWidth: width, screenHeight: height });
    const open = async (search) => {
      const loaded = new Promise((resolve) => win.webContents.once('did-finish-load', resolve));
      await win.loadFile(path.join(ROOT, 'dist', 'index.html'), search ? { search } : undefined);
      await loaded;
    };
    await open();
    await win.webContents.executeJavaScript('localStorage.clear(); sessionStorage.clear();');
    await open();
    await waitFor(win, `document.querySelector('[data-qa-menu="main"]')`, 20000);
    await click(win, '[data-qa-menu-action="new"]');
    await waitFor(win, `document.querySelector('[data-qa-wizard-step="race"]')`);
    await click(win, '[data-qa-race="aegis"]');
    // The wizard rail jumps straight to «Сводка».
    await click(win, '[data-qa-wizard-rail="confirm"]');
    await waitFor(win, `document.querySelector('[data-qa-wizard-step="confirm"]')`);
    await click(win, '[data-qa-wizard-start]');
    await waitFor(win, `document.querySelector('[data-qa-navigation="utility"]')`, 60000);
    await sleep(1500);
    await open();
    await waitFor(win, `document.querySelector('[data-qa-menu="main"]')`, 20000);
    const cloned = await win.webContents.executeJavaScript(`(() => {
      const PARSE_SAVE = ${PARSE_SAVE};
      const key = 'asterion.slots.index.v1';
      const index = PARSE_SAVE(localStorage.getItem(key));
      const base = index.slots[0];
      const payload = PARSE_SAVE(localStorage.getItem(base.storageKey));
      const playerId = payload.profile.playerId;
      const make = (suffix, name, edit) => {
        const copy = JSON.parse(JSON.stringify(payload));
        edit(copy);
        const storageKey = 'asterion.slot.slot-qa-' + suffix + '.v1';
        localStorage.setItem(storageKey, JSON.stringify(copy));
        return { ...base, id: 'slot-qa-' + suffix, name, storageKey, updatedAt: base.updatedAt - 1000 };
      };
      const crystals = (copy) => { copy.sunRaid = { ...(copy.sunRaid || {}), crystals: { ...((copy.sunRaid || {}).crystals || {}), ['owner:' + playerId]: ['c1', 'c2', 'c3', 'c4'] }, campaignResult: { playerWon: true } }; };
      base.name = ${JSON.stringify(LONG_SLOT)};
      index.slots.push(
        make('victory', ${JSON.stringify(LONG_SLOT)}, (copy) => { crystals(copy); copy.profile.displayName = 'Адмирал Северного Рубежа'; }),
        make('short', 'Тавр', () => {}),
        make('victory-short', 'Победа за четыре кристалла', crystals),
      );
      localStorage.setItem(key, JSON.stringify(index));
      return index.slots.length;
    })()`);
    if (!(cloned >= 4)) fail('Could not clone save slots', cloned);
    await open();
    await waitFor(win, `document.querySelector('[data-qa-menu="main"]')`, 20000);
    await click(win, '[data-qa-menu-action="load"]');
    // Slot ids must match /^slot-[a-z0-9-]+$/ or the index drops them: wait for the three clones by id.
    await waitFor(win, `['slot-qa-victory', 'slot-qa-short', 'slot-qa-victory-short'].every((id) => document.querySelector('[data-qa-load-screen] [data-qa-slot="' + id + '"]'))`, 20000)
      .catch(async (error) => { throw new Error(`${error.message}; ${JSON.stringify(await win.webContents.executeJavaScript(`({ cloned: ${JSON.stringify(cloned)}, shown: Array.from(document.querySelectorAll('[data-qa-slot]')).map((n) => n.getAttribute('data-qa-slot')), screen: Boolean(document.querySelector('[data-qa-load-screen]')), index: localStorage.getItem('asterion.slots.index.v1')?.slice(0, 400) })`))}`); });
    await settle(win, 900);
    const cards = await win.webContents.executeJavaScript(`Array.from(document.querySelectorAll('[data-qa-slot]')).map((card) => {
      const box = card.getBoundingClientRect();
      const inside = (node) => { const r = node.getBoundingClientRect(); return r.width > 0 && r.left >= box.left - 1 && r.right <= box.right + 1 && r.top >= box.top - 1 && r.bottom <= box.bottom + 1; };
      const buttons = Array.from(card.querySelectorAll('.menu-slot__actions button'));
      return {
        id: card.getAttribute('data-qa-slot'), height: Math.round(box.height),
        visibleButtons: buttons.filter(inside).length, buttons: buttons.length,
        cutLabels: buttons.filter((button) => button.scrollWidth > button.clientWidth + 1).map((button) => button.textContent),
        badge: Boolean(card.querySelector('.menu-tag')), victory: Boolean(card.querySelector('.menu-slot__crystals b')),
        // The crystal gems are shared Sun-raid art with their own native titles (not this card's markup).
        titles: Array.from(card.querySelectorAll('[title]')).filter((node) => !node.closest('.menu-slot__crystals')).length,
      };
    })`);
    for (const card of cards) {
      if (card.visibleButtons !== 5 || card.buttons !== 5) fail('Not every save action is visible inside the card', card);
      if (card.cutLabels.length) fail('Save action label is cut', card);
      if (card.titles) fail('Native title tooltip on a save card', card);
    }
    if (!cards.some((card) => card.badge) || !cards.some((card) => card.victory)) fail('Worst-case cards are missing', cards);
    await capture(win, directory, '14-load-game-save-cards');
    await click(win, '[data-qa-slot-delete="slot-qa-short"]');
    await waitFor(win, `document.querySelector('[data-qa-confirm-yes]')`);
    await settle(win, 300);
    await capture(win, directory, '15-load-game-delete-confirm');
    await click(win, '[data-qa-confirm-no]');
    return { cards, failures };
  } finally {
    try { if (win.webContents.debugger.isAttached()) win.webContents.debugger.detach(); } catch {}
    win.destroy();
  }
}

app.whenReady().then(async () => {
  let win;
  try {
    fs.mkdirSync(OUTPUT, { recursive: true });
    win = new BrowserWindow({
      width: 1280,
      height: 720,
      show: false,
      backgroundColor: '#02050a',
      webPreferences: { offscreen: true, contextIsolation: true, nodeIntegration: false, sandbox: true, partition: 'qa-messages-screens' },
    });
    await win.loadFile(path.join(ROOT, 'dist', 'index.html'), { search: '?mode=test' });
    await waitFor(win, `document.querySelector('[data-qa-navigation="utility"]')`, 20000);
    win.webContents.debugger.attach('1.3');
    const all = {};
    for (const [width, height] of VIEWPORTS) {
      const label = `${width}x${height}`;
      const directory = path.join(OUTPUT, label);
      fs.mkdirSync(directory, { recursive: true });
      await win.webContents.debugger.sendCommand('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false, screenWidth: width, screenHeight: height });
      await settle(win);
      all[label] = await runViewport(win, directory, label);
      all[`${label}:save-cards`] = await runSaveCards(width, height, directory, label);
    }
    fs.writeFileSync(path.join(OUTPUT, 'messages-screens-metrics.json'), JSON.stringify(all, null, 2));
    console.log(JSON.stringify(all, null, 2));
    win.webContents.debugger.detach();
    win.destroy();
    app.exit(0);
  } catch (error) {
    console.error(error);
    try { if (win?.webContents.debugger.isAttached()) win.webContents.debugger.detach(); } catch {}
    win?.destroy();
    app.exit(1);
  }
});
