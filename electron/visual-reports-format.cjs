// «Сообщения»: one report format (11.11.2026). Worst-case screenshots of every report
// kind at 1280×720 and 2560×1080: a big battle (11 ship types a side, defence, 6
// rounds), a spy report with everything revealed and an almost empty one, recycling
// with nothing collected, gas extraction, a pirate raid, an exploration find, an
// overpopulation loss, an alliance letter in «Личные», an empty «Личные» and 200
// unread reports.
// Layout contracts (ASTERION_QA_CHECKS=0 records them without failing, used for the
// «before» run on main): no text cut off without an ellipsis, no native title
// tooltips, the screen fits the window, every report shows the shared header
// (title, place, time, result word) and at most one primary button.
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');
const { patchSaveIdle } = require('./qa-save-edit.cjs');
const { PARSE_SAVE } = require('./qa-save.cjs');

app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-gpu');
app.on('window-all-closed', () => {});

const ROOT = path.join(__dirname, '..');
const OUTPUT = process.env.ASTERION_QA_OUTPUT || path.join(ROOT, 'visual-qa', 'reports-format', 'run');
const CHECKS = process.env.ASTERION_QA_CHECKS !== '0';
const SHOTS = process.env.ASTERION_SKIP_SCREENSHOTS !== '1';
const SAVE_KEY = 'asterion.vertical-slice.test.v1';
const VIEWPORTS = [[1280, 720], [2560, 1080]];
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

async function capture(win, directory, name) {
  if (!SHOTS) return;
  await waitFor(win, `Array.from(document.querySelectorAll('.reports-view img')).every((img) => img.complete)`, 15000).catch(() => {});
  await win.webContents.executeJavaScript(`document.getAnimations().forEach((animation) => {
    const timing = animation.effect?.getComputedTiming?.();
    if (timing && Number.isFinite(timing.endTime)) animation.currentTime = timing.endTime;
  })`);
  await settle(win, 80);
  const result = await win.webContents.debugger.sendCommand('Page.captureScreenshot', { format: 'jpeg', quality: 80, fromSurface: true, captureBeyondViewport: false });
  fs.writeFileSync(path.join(directory, `${name}.jpg`), Buffer.from(result.data, 'base64'));
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

function exists(win, selector) {
  return win.webContents.executeJavaScript(`Boolean(document.querySelector(${JSON.stringify(selector)}))`);
}

/** Text that is cut off (an ellipsis is allowed). */
function clippedText(win, scope) {
  return win.webContents.executeJavaScript(`(() => {
    const out = [];
    document.querySelectorAll(${JSON.stringify(scope)}).forEach((root) => root.querySelectorAll('strong, small, em, b, span, h1, h2, h3, p, time, dt, dd, button, label, summary').forEach((node) => {
      if (!node.getClientRects().length || !node.textContent.trim() || node.children.length) return;
      if (node.closest('.spy-entity-tooltip, .hdr-tip, details:not([open])')) return;
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
    const sheet = document.querySelector('[data-report-sheet]');
    return {
      fits: Boolean(view) && view.bottom <= innerHeight + 1 && view.right <= innerWidth + 1,
      horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 2,
      nativeTitles: Array.from(document.querySelectorAll('.reports-view [title]')).map((node) => node.getAttribute('title')),
      primaryButtons: document.querySelectorAll('.reports-preview .reports-primary-action').length,
      sheet: sheet ? {
        kind: sheet.getAttribute('data-report-sheet'),
        title: Boolean(sheet.querySelector('[data-report-title]')?.textContent.trim()),
        time: Boolean(sheet.querySelector('[data-report-time]')?.textContent.trim()),
        result: sheet.querySelector('[data-report-result]')?.textContent.trim() || '',
      } : null,
    };
  })()`);
}

/** Page-side save edit with every worst case; `letters` adds the «Личные» letters. */
function seedSource(now, letters) {
  const spy = (id, minutesAgo, quality, huge) => ({
    id, missionId: `${id}-mission`, createdAt: now - minutesAgo * 60_000,
    sourcePlanetId: 'helion-01', targetPlanetId: `qa-target-${id}`, targetPlanetName: huge ? 'Кассиопея Восточный Рубеж Обороны Седьмого Сектора' : 'Тавр',
    targetOwnerId: 'npc-bot-01', targetOwnerName: 'Адмирал Северного Рубежа', targetRaceId: 'synod', targetRelation: 'enemy',
    targetCoordinate: { galaxy: 1, system: 42, position: 7 }, spyLevel: 12, targetEspionageLevel: 4, delta: 8, roll: 0, quality,
    resources: huge ? { metal: 999999999999, minerals: 888888888888, gas: 777777777777, debris: 123456789012, developmentEnergy: 999999999 } : { metal: 1200, minerals: 0, gas: 0, debris: 0, developmentEnergy: 0 },
    ...(huge ? {
      fleet: Object.fromEntries(SHIPS.map((ship) => [ship, 999999999])),
      fleetLevels: Object.fromEntries(SHIPS.map((ship) => [ship, 20])),
      defense: Object.fromEntries(DEFENSE.map((item) => [item, 99999999])),
      commanders: Object.fromEntries(COMMANDERS.map((commander, level) => [commander, { level: 20 + level, count: 99 }])),
      population: { total: 99999999999, fleet: 88888888888, defense: 11111111111 },
    } : {}),
    firstReport: false,
  });
  const reports = [spy('qa-spy-full', 2, 'full', true), spy('qa-spy-basic', 3, 'basic', false)];
  const recycler = [
    { id: 'recycler-arrival:qa-recycle-empty', flightId: 'qa-recycle-empty', coordinate: { galaxy: 1, system: 17, position: 9 }, arrivedAtMs: now - 60_000, collectedDebris: 0, remainingOrbitalDebris: 0 },
    ...Array.from({ length: 200 }, (_, index) => ({
      id: `recycler-arrival:qa-recycle-${index}`, flightId: `qa-recycle-${index}`,
      coordinate: { galaxy: 1 + (index % 3), system: 1 + (index % 40), position: 1 + (index % 15) },
      arrivedAtMs: now - 4 * 60_000 - index * 3_000, collectedDebris: 1000 + index * 37, remainingOrbitalDebris: index % 4 ? 99999 : 0,
    })),
  ];
  const gas = [{ id: 'gas-extraction-arrival:qa-gas', flightId: 'qa-gas', coordinate: { galaxy: 2, system: 31, position: 16 }, arrivalAt: now - 90_000, outcome: 'found', gasCollected: 48250, scrapCollected: 1200 }];
  const overpopulation = [{
    id: 'overpopulation:qa-colony:' + (now - 3_600_000), planetId: 'qa-colony', planetName: 'Колония Шахтёрская Глубинная Номер Семнадцать', factionId: 'aegis',
    populationBefore: 35000, populationAfter: 25000, capacity: 25000, episodeStartedAt: now - 3_600_000, episodeEndedAt: now - 150_000,
    removedShips: [{ shipId: 'cruiser', count: 9 }, { shipId: 'transporter', count: 4 }, { shipId: 'solar-satellite', count: 2 }],
  }];
  return `(save) => {
    const now = ${now};
    const me = save.profile?.playerId;
    const base = save.combat?.reports?.find((report) => report.id === 'battle-demo-attacker-victory');
    if (!base) throw new Error('no demo battle in the test save');
    const { initialSnapshot: _drop, ...rest } = base;
    const stacks = (ids, before, lostShare) => ids.map((entityId, index) => {
      const countBefore = before + index * 137;
      const destroyed = Math.floor(countBefore * lostShare * ((index % 3) + 1) / 3);
      return { entityId, countBefore, countAfter: countBefore - destroyed, destroyed, level: 10 + index };
    });
    const rounds = Array.from({ length: 6 }, (_, index) => ({
      index: index + 1, events: [],
      summary: { attackerDamage: 1250000 * (6 - index), defenderDamage: 980000 * (6 - index), destroyedUnits: 4200 - index * 600, destroyedPopulation: 91000 - index * 13000,
        survivingPopulation: { attacker: 900000 - index * 90000, defender: 700000 - index * 110000 } },
    }));
    const battle = (id, minutesAgo, extra) => ({
      ...rest, id, timestamp: new Date(now - minutesAgo * 60_000).toISOString(), ...extra,
    });
    const bigBattle = battle('qa-big-battle', 1, {
      missionType: 'attack', winner: 'attacker', roundCount: 6, rounds,
      attacker: { ...base.attacker, playerId: me, playerName: 'Владыка Великой Северной Империи Астеров', planetName: 'Новая Кассиопея Северная', coordinates: '[1:17:17]' },
      defender: { ...base.defender, playerId: 'npc-bot-01', playerName: 'Командор Объединённого Флота Южных Рубежей', planetName: 'Кассиопея Восточный Рубеж Обороны', coordinates: '[1:40:24]' },
      attackerForce: { ...base.attackerForce, populationBefore: 1000000, populationAfter: 460000, stacks: stacks(${JSON.stringify(SHIPS)}, 12000, 0.4), defenses: [] },
      defenderForce: { ...base.defenderForce, populationBefore: 820000, populationAfter: 0, stacks: stacks(${JSON.stringify(SHIPS)}, 9000, 1), defenses: stacks(${JSON.stringify(DEFENSE)}, 4000, 1) },
      resources: { metal: 305864678, minerals: 19657583, gas: 13704441 }, debris: 98000000, experience: 4200,
    });
    const pirateRaid = battle('qa-pirate-raid', 4, {
      missionType: 'pirate-raid', winner: 'attacker', roundCount: 3, rounds: rounds.slice(0, 3),
      attacker: { playerId: 'pirates', playerName: 'Пиратский флот', planetName: 'Пираты', coordinates: '[1:11:12]', race: 'pirates', side: 'attacker' },
      defender: { ...base.defender, playerId: me, playerName: 'Командор', planetName: 'Новая Кассиопея Северная', coordinates: '[1:17:17]', race: 'Астеры' },
      attackerForce: { ...base.attackerForce, populationBefore: 240000, populationAfter: 180000 },
      defenderForce: { ...base.defenderForce, populationBefore: 120000, populationAfter: 30000 },
      resources: { metal: 2100000, minerals: 900000, gas: 120000 }, debris: 48000,
    });
    save.combat.reports = [bigBattle, pirateRaid, ...save.combat.reports.filter((report) => report.id !== 'qa-big-battle' && report.id !== 'qa-pirate-raid')];
    save.espionage = { ...(save.espionage || {}), reports: ${JSON.stringify(reports)} };
    save.reports = { ...(save.reports || {}), readIds: [], hiddenIds: [], readUpTo: undefined,
      recyclerArrivalReports: ${JSON.stringify(recycler)}, gasExtractionArrivalReports: ${JSON.stringify(gas)}, overpopulationReports: ${JSON.stringify(overpopulation)} };
    // An exploration find: a unique object, the expedition came back with cargo.
    // A valid identity (kind:galaxy:system:cycle:appearedAt), alive under 20 minutes, or the loader drops it.
    const appearedAt = now - 600_000;
    const contactId = 'unique:1:23:0:' + appearedAt;
    save.exploration = save.exploration || { version: 1, contacts: {}, highestScoresByOwner: {}, completed: [], acceptedContactIds: [], reconReports: [] };
    // One QA contact only: a re-seed must not leave a second contact with the same expedition flight.
    const contacts = Object.fromEntries(Object.entries(save.exploration.contacts || {}).filter(([, contact]) => !(contact.events || []).some((event) => event.flightId === 'qa-find-flight')));
    save.exploration.contacts = { ...contacts, [contactId]: {
      id: contactId, kind: 'unique', coordinate: { galaxy: 1, system: 23, position: 16 }, variant: 2, appearedAt, expiresAt: now + 540_000,
      worldScoreAtAppearance: 1000, initialReserve: { metal: 900000, minerals: 600000, gas: 200000, debris: 50000 },
      resourceReserve: { metal: 500000, minerals: 300000, gas: 100000, debris: 20000 }, extractedByType: { metal: 400000, minerals: 300000, gas: 100000, debris: 30000 },
      rareUsedByOwner: [], events: [{ id: 'qa-find-returned', at: now - 200_000, kind: 'returned', ownerId: me, flightId: 'qa-find-flight', originPlanetId: 'helion-01',
        cargo: { metal: 400000, minerals: 300000, gas: 100000, debris: 30000 }, creditedCargo: { metal: 380000, minerals: 300000, gas: 100000, debris: 30000 },
        burnedCargo: { metal: 20000, minerals: 0, gas: 0, debris: 0 }, repairTokens: 2 }],
    } };
    const command = save.command;
    if (command) {
      command.applications = (command.applications || []).filter((application) => !String(application.id).startsWith('application-qa-'));
      if (${JSON.stringify(letters)}) {
        const mine = (command.alliances || []).find((alliance) => (alliance.members || []).some((member) => member.ownerId === me));
        const other = (command.alliances || []).find((alliance) => alliance !== mine);
        if (mine) command.applications.push({ id: 'application-qa-901', allianceId: mine.id, allianceName: mine.name, ownerId: 'qa-applicant-long', displayName: 'Командор Объединённого Флота Южных Рубежей', status: 'pending', reason: null, createdAt: now - 120_000, resolvedAt: null, resolvedByOwnerId: null });
        command.applications.push({ id: 'application-qa-902', allianceId: other ? other.id : 'alliance-gone', allianceName: other ? other.name : 'Объединённый Северный Союз Звёздных Флотов', ownerId: me, displayName: save.profile?.displayName || 'Командор', status: 'rejected', reason: 'declined', createdAt: now - 3_600_000, resolvedAt: now - 300_000, resolvedByOwnerId: other ? other.leaderOwnerId : null });
      }
    }
    localStorage.setItem('asterion.test-time-scale.v1', '1');
  }`;
}

async function openReports(win) {
  await click(win, '[data-qa-navigation="primary"] [data-qa-route="reports"]');
  await waitFor(win, `document.querySelector('.reports-view')`);
  await settle(win, 500);
}

async function openFolder(win, folder) {
  await click(win, `[data-message-folder="${folder}"]`);
  await waitFor(win, `document.querySelector('[data-qa-folder-view="${folder}"]')`);
  await settle(win, 400);
}

async function openReport(win, id) {
  const selector = `[data-report-item-id="${id}"] .reports-list-open`;
  // Long folders page by seven: turn pages until the wanted report shows.
  for (let turn = 0; turn < 60 && !await exists(win, selector); turn += 1) {
    if (!await exists(win, '.reports-pagination button:last-child:not(:disabled)')) break;
    await click(win, '.reports-pagination button:last-child');
  }
  if (!await exists(win, selector)) return false;
  await click(win, selector);
  await waitFor(win, `document.querySelector('[data-report-item-id="${id}"] .reports-list-open[aria-current="true"]')`);
  await settle(win, 400);
  return true;
}

async function runViewport(win, directory, label) {
  const metrics = { failures: [], cases: {} };
  const fail = (message, detail) => {
    metrics.failures.push(`${message}: ${JSON.stringify(detail)}`);
    if (CHECKS) throw new Error(`${label} ${message}: ${JSON.stringify(detail)}`);
  };
  const check = async (name, sheetExpected = true) => {
    const clipped = await clippedText(win, '.reports-view');
    if (clipped.length) fail(`${name}: text is cut off`, clipped);
    const box = await layout(win);
    metrics.cases[name] = box;
    if (!box.fits || box.horizontalOverflow) fail(`${name}: screen does not fit`, box);
    if (box.nativeTitles.length) fail(`${name}: native title tooltips remain`, box.nativeTitles);
    if (box.primaryButtons > 1) fail(`${name}: more than one primary button`, box);
    if (sheetExpected && (!box.sheet || !box.sheet.title || !box.sheet.time || !box.sheet.result)) fail(`${name}: the shared report header is incomplete`, box.sheet);
  };
  const shoot = async (name, folder, id) => {
    await openFolder(win, folder);
    if (!await openReport(win, id)) return fail(`${name}: report ${id} is not in «${folder}»`, null);
    await check(name);
    await capture(win, directory, name);
  };

  // «Личные» empty first: the seed without letters.
  await patchSaveIdle(win, SAVE_KEY, seedSource(Date.now(), false), { label: 'reports format seed' });
  await win.webContents.executeJavaScript('document.fonts?.ready');
  await settle(win, 400);
  await openReports(win);
  const hasPersonal = await exists(win, '[data-message-folder="personal"]');
  if (!hasPersonal) fail('«Личные» folder is missing', null);
  if (hasPersonal) {
    await openFolder(win, 'personal');
    await check('personal-empty', false);
    await capture(win, directory, '10-personal-empty');
  }

  // 200 unread reports in «Полёты».
  await openFolder(win, 'flights');
  metrics.unread = await win.webContents.executeJavaScript(`Number(document.querySelector('[data-message-folder="flights"] .reports-v2-unread-count')?.textContent || 0)`);
  if (metrics.unread < 200) fail('«Полёты» does not hold 200 unread reports', metrics.unread);
  await check('flights-200-unread');
  await capture(win, directory, '11-flights-200-unread');

  await shoot('01-battle-big-6-rounds', 'battle', 'battle:qa-big-battle');
  if (await exists(win, '[data-report-sheet] details summary')) {
    await click(win, '[data-report-sheet] details summary');
    await win.webContents.executeJavaScript(`(() => { const s = document.querySelector('.reports-preview-scroll'); const d = document.querySelector('[data-report-sheet] details'); if (s && d) s.scrollTop = d.offsetTop - 40; })()`);
    await settle(win, 300);
    await check('01b-battle-rounds-open');
    await capture(win, directory, '01b-battle-rounds-open');
  }
  await shoot('02-spy-everything', 'battle', 'espionage:qa-spy-full');
  await shoot('03-spy-almost-empty', 'battle', 'espionage:qa-spy-basic');
  await shoot('04-recycling-nothing', 'flights', 'recycler-arrival:qa-recycle-empty');
  await shoot('05-gas-extraction', 'flights', 'gas-extraction-arrival:qa-gas');
  await shoot('06-pirate-raid', 'battle', 'battle:qa-pirate-raid');
  await shoot('07-exploration-find', 'flights', 'exploration-return:qa-find-flight');
  const overpopulationId = await win.webContents.executeJavaScript(`(${PARSE_SAVE})(localStorage.getItem(${JSON.stringify(SAVE_KEY)})).reports?.overpopulationReports?.find((report) => report.planetId === 'qa-colony')?.id || ''`);
  if (!overpopulationId) fail('The overpopulation fixture did not load', null);
  else await shoot('08-overpopulation-loss', 'system', overpopulationId);

  // «Личные» with an alliance letter.
  if (hasPersonal) {
    await patchSaveIdle(win, SAVE_KEY, seedSource(Date.now(), true), { label: 'reports format letters' });
    await settle(win, 400);
    await openReports(win);
    await openFolder(win, 'personal');
    const first = await win.webContents.executeJavaScript(`document.querySelector('[data-qa-message-list] [data-report-item-id]')?.getAttribute('data-report-item-id') || ''`);
    if (!first) fail('«Личные» shows no alliance letter', null);
    else {
      if (!await openReport(win, first)) fail('«Личные» letter cannot be opened', first);
      await check('09-personal-alliance-letter');
      await capture(win, directory, '09-personal-alliance-letter');
    }
  }
  return metrics;
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
      webPreferences: { offscreen: true, contextIsolation: true, nodeIntegration: false, sandbox: true, partition: 'qa-reports-format' },
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
    }
    fs.writeFileSync(path.join(OUTPUT, 'reports-format-metrics.json'), JSON.stringify(all, null, 2));
    console.log(JSON.stringify(Object.fromEntries(Object.entries(all).map(([key, value]) => [key, value.failures])), null, 2));
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
