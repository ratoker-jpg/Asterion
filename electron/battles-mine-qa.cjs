// Fleets → Битвы QA at 1920×1080 and 1280×720: only the player's battles reach the
// list and its counters, with the worst cases on screen: 200 battles of his own,
// long names, merged sides of a Sun raid, a draw, a planet seized without a fight,
// no battles at all, an empty starred tab, a starred battle of other owners.
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');
const { patchSaveIdle } = require('./qa-save-edit.cjs');

app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-gpu');
app.on('window-all-closed', () => {});

const ROOT = path.join(__dirname, '..');
const OUTPUT = process.env.ASTERION_QA_OUTPUT || path.join(ROOT, 'visual-qa', 'battles-mine');
const SKIP_SCREENSHOTS = process.env.ASTERION_SKIP_SCREENSHOTS === '1';
const SAVE_KEY = 'asterion.vertical-slice.test.v1';
const VIEWPORTS = [[1920, 1080], [1280, 720]];
const MIN_FULL_ROWS = { 1920: 14, 1280: 7 };
const OWN_BATTLES = 200;
const DEMO_BATTLES = 3;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const failures = [];
const fail = (message, detail) => { failures.push({ message, detail }); console.error(`[battles-mine-qa] ${message}`, JSON.stringify(detail)); };

async function waitFor(win, expression, timeoutMs = 10_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await win.webContents.executeJavaScript(`Boolean(${expression})`)) return;
    await sleep(50);
  }
  throw new Error(`Timed out waiting for: ${expression}`);
}

async function settle(win, ms = 160) {
  await win.webContents.executeJavaScript('new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
  await sleep(ms);
}

async function capture(win, directory, name) {
  if (SKIP_SCREENSHOTS) return;
  await win.webContents.executeJavaScript(`document.getAnimations().forEach((animation) => {
    const timing = animation.effect?.getComputedTiming?.();
    if (timing && Number.isFinite(timing.endTime)) animation.currentTime = timing.endTime;
  })`);
  await settle(win, 60);
  const result = await win.webContents.debugger.sendCommand('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: false });
  fs.writeFileSync(path.join(directory, `${name}.png`), Buffer.from(result.data, 'base64'));
}

/** Page-side save edit: `scenario` is what the seeded reports look like. */
function seedSource(scenario) {
  return `(save) => {
    const scenario = ${JSON.stringify({ ...scenario, ownBattles: OWN_BATTLES })};
    const base = save.combat?.reports?.find((report) => report.id === 'battle-demo-attacker-victory');
    if (!base) throw new Error('no demo battle in the test save');
    const me = save.profile.playerId;
    const now = Date.now();
    const report = (id, minutesAgo, attacker, defender, extra = {}) => {
      const { initialSnapshot: _dropped, ...rest } = base;
      return {
        ...rest,
        rounds: [{ ...base.rounds[0], events: [] }],
        roundCount: 1,
        winner: 'attacker',
        resources: undefined,
        debris: undefined,
        ...extra,
        id,
        timestamp: new Date(now - minutesAgo * 60_000).toISOString(),
        attacker: { ...base.attacker, ...attacker },
        defender: { ...base.defender, ...defender },
      };
    };
    const force = (side, lost) => ({ ...base[side], populationBefore: 120000, populationAfter: 120000 - lost });
    const npc = (name, coordinates) => ({ playerId: 'qa-npc-' + name, playerName: name, planetName: name, coordinates, race: 'Астеры' });
    const mine = (coordinates) => ({ playerId: me, playerName: 'Командор', planetName: 'Москва', coordinates });
    const pirates = (coordinates) => ({ playerId: 'pirates', playerName: 'Пиратский флот', planetName: 'Пираты', coordinates, race: 'pirates' });
    const reports = [];
    if (scenario.worst) {
      reports.push(
        report('qa-long-names', 1,
          { playerId: me, playerName: 'Владыка Великой Северной Империи Астеров Альфа Центавра Прайм', coordinates: '[1:17:17]' },
          npc('Командор Объединённого Флота Южных Рубежей Галактики Андромеды', '[1:40:24]'),
          { resources: { metal: 305864678, minerals: 19657583, gas: 13704441 } }),
        report('qa-sun-defence', 2,
          { playerId: 'qa-npc-ergash', playerName: '[ЭРГАШ] Эргаш +3', planetName: 'Рейд на Солнце 1:16', coordinates: '[1:16]', race: 'Астеры' },
          { playerId: me, playerName: 'Скаен62 +1', planetName: 'Солнце 1:16', coordinates: '[1:16]', race: 'Астеры' },
          { winner: 'defender', defenderForce: force('defenderForce', 3460) }),
        report('qa-sun-joint', 3,
          { playerId: me, playerName: '[ЭРГАШ] Командор +4', planetName: 'Рейд на Солнце 1:20', coordinates: '[1:20]', race: 'Астеры' },
          { playerId: 'qa-npc-solaks', playerName: 'Солакс +2', planetName: 'Солнце 1:20', coordinates: '[1:20]', race: 'Астеры' },
          { attackerForce: force('attackerForce', 11702) }),
        report('qa-draw', 4, mine('[1:17:17]'), npc('Фенург', '[1:22:10]'), { winner: 'draw', attackerForce: force('attackerForce', 62000) }),
        report('qa-seized', 5, mine('[1:17:17]'), npc('Зарен', '[1:9:8]'),
          { rounds: [], roundCount: 0, resources: { metal: 842000, minerals: 310000, gas: 96000 } }),
        report('qa-seized-from-me', 6, pirates('[1:23:2]'), mine('[1:23:10]'),
          { rounds: [], roundCount: 0, resources: { metal: 1200000 } }),
        report('qa-raid-defeat', 7, pirates('[1:11:12]'), mine('[1:17:17]'),
          { missionType: 'pirate-raid', defenderForce: { ...force('defenderForce', 0), populationBefore: 2400000000, populationAfter: 1200000000 }, resources: { metal: 2100000000 } }),
        report('qa-hunt-pirates', 8, mine('[1:4:19]'), pirates('[1:4:7]'), { missionType: 'pirate-elimination', debris: 480000 }),
      );
      const filler = scenario.ownBattles - reports.length;
      for (let index = 0; index < filler; index += 1) {
        const win = index % 3 !== 1;
        reports.push(index % 2
          ? report('qa-own-' + index, 10 + index, mine('[1:17:17]'), npc('Сосед' + (index % 40), '[1:' + (index % 40 + 1) + ':' + (index % 24 + 1) + ']'), { winner: win ? 'attacker' : 'defender', attackerForce: force('attackerForce', 40 + index * 37) })
          : report('qa-own-' + index, 10 + index, pirates('[1:' + (index % 40 + 1) + ':3]'), mine('[1:17:17]'), { missionType: 'pirate-raid', winner: win ? 'defender' : 'attacker', defenderForce: force('defenderForce', 15 + index * 11) }));
      }
    }
    // Other owners' fights fill the save just as they filled the owner's list.
    if (scenario.foreign) {
      for (let index = 0; index < 60; index += 1) {
        reports.push(index % 2
          ? report('qa-foreign-' + index, 1 + index, pirates('[1:11:12]'), npc('Тарок', '[1:11:3]'), { missionType: 'pirate-raid' })
          : report('qa-foreign-' + index, 1 + index, npc('Красиан', '[1:33:20]'), npc('Драек', '[1:23:10]')));
      }
    }
    save.combat.reports = [...save.combat.reports.filter((item) => item.id.startsWith('battle-demo-')), ...reports];
    save.combat.savedReportIds = scenario.starForeign ? ['qa-foreign-1'] : [];
    if (scenario.nobody) save.profile.playerId = 'qa-somebody-else';
  }`;
}

async function openBattles(win, scenario, held) {
  await patchSaveIdle(win, SAVE_KEY, seedSource(scenario), { label: 'battles seed', held });
  await win.webContents.executeJavaScript(`document.querySelector('[data-qa-navigation="primary"] [data-qa-route="fleets"]').click()`);
  await waitFor(win, `document.querySelector('[data-qa-fleet-section="battles"]')`);
  await win.webContents.executeJavaScript(`document.querySelector('[data-qa-fleet-section="battles"]').click()`);
  await waitFor(win, `document.querySelector('.battle-list-v1')`);
  await settle(win, 600);
}

const tabs = (win) => win.webContents.executeJavaScript(`Array.from(document.querySelectorAll('.battle-tabs-v1 button')).map((button) => Number(button.querySelector('b').textContent))`);
const clickTab = async (win, index) => {
  await win.webContents.executeJavaScript(`document.querySelectorAll('.battle-tabs-v1 button')[${index}].click()`);
  await settle(win, 400);
};

const listMetrics = (win) => win.webContents.executeJavaScript(`(() => {
  const rows = Array.from(document.querySelectorAll('[data-qa-battle-card]'));
  const list = document.querySelector('.battle-list-v1').getBoundingClientRect();
  const clipped = (node) => node && node.scrollWidth > node.clientWidth + 1;
  const visible = rows.map((row) => ({ row, line: row.querySelector('summary').getBoundingClientRect() }))
    .filter(({ line }) => line.top >= 0 && line.bottom <= innerHeight && line.height > 0);
  const scroller = document.querySelector('.fleet-main-v1--battles');
  return {
    rows: rows.length,
    fullRowsOnScreen: visible.length,
    tallestRow: Math.max(0, ...visible.map(({ line }) => Math.round(line.height))),
    timeCut: visible.filter(({ row, line }) => {
      const time = row.querySelector('time');
      return time.getBoundingClientRect().right > line.right || clipped(time) || time.getBoundingClientRect().right > list.right;
    }).length,
    numbersCut: visible.filter(({ row }) => Array.from(row.querySelectorAll('.brow__num')).some(clipped)).length,
    verdictCut: visible.filter(({ row }) => clipped(row.querySelector('.brow__verdict strong'))).length,
    overlapping: visible.filter(({ row }) => {
      const cells = Array.from(row.querySelector('summary').children).map((cell) => cell.getBoundingClientRect());
      return cells.some((cell, index) => index > 0 && cell.left < cells[index - 1].right - 1);
    }).length,
    rootOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 2,
    listOverflow: scroller ? scroller.scrollWidth > scroller.clientWidth + 2 : false,
    foreignShown: /Тарок|Красиан/.test(document.querySelector('.battle-list-v1').textContent),
    systemTooltips: document.querySelectorAll('.battle-view-v1 [title]').length,
    arrives: rows[0] ? getComputedStyle(rows[0]).animationName : '',
    text: Object.fromEntries(rows.slice(0, 8).map((row) => [row.getAttribute('data-qa-battle-card'), row.querySelector('summary').innerText.replace(/\\s+/g, ' ')])),
  };
})()`);

async function runViewport(win, width, directory) {
  const metrics = {};
  const expected = OWN_BATTLES + DEMO_BATTLES;

  // 200 of his own plus other owners' fights: the worst cases are the newest rows.
  await openBattles(win, { worst: true, foreign: true }, `document.querySelector('[data-qa-navigation="utility"]')`);
  metrics.list = await listMetrics(win);
  metrics.tabs = await tabs(win);
  if (metrics.tabs[0] !== expected || metrics.tabs[1] !== 0) fail('counters are not his battles', { tabs: metrics.tabs, expected });
  if (metrics.list.rows !== expected) fail('rows are not his battles', { rows: metrics.list.rows, expected });
  if (metrics.list.foreignShown) fail('another owner\'s battle is on the list');
  if (metrics.list.fullRowsOnScreen < MIN_FULL_ROWS[width]) fail('too few rows on screen', metrics.list.fullRowsOnScreen);
  if (metrics.list.tallestRow > 56) fail('a row is not compact', metrics.list.tallestRow);
  for (const key of ['timeCut', 'numbersCut', 'verdictCut', 'overlapping', 'systemTooltips']) if (metrics.list[key]) fail(key, metrics.list[key]);
  if (metrics.list.rootOverflow || metrics.list.listOverflow) fail('horizontal scroll', metrics.list);
  if (metrics.list.arrives !== 'brow-arrive') fail('rows do not arrive with an animation', metrics.list.arrives);
  await capture(win, directory, 'worst-cases');

  const verdicts = await win.webContents.executeJavaScript(`(() => {
    const row = (id) => document.querySelector('[data-qa-battle-card="' + id + '"] summary');
    const lost = (id) => row(id).querySelector('[data-qa-battle-row-lost]').lastChild.textContent;
    const resources = (id) => row(id).querySelector('[data-qa-battle-row-resources]').lastChild.textContent;
    return {
      draw: row('qa-draw').querySelector('.brow__verdict strong').textContent,
      seized: row('qa-seized').querySelector('.brow__verdict').textContent,
      seizedResources: resources('qa-seized'),
      seizedFromMeResources: resources('qa-seized-from-me'),
      sunMine: row('qa-sun-defence').querySelectorAll('.brow__side.is-mine i').length,
      raidLost: lost('qa-raid-defeat'),
      raidResources: resources('qa-raid-defeat'),
    };
  })()`);
  metrics.verdicts = verdicts;
  if (verdicts.draw !== 'НИЧЬЯ' || !verdicts.seized.startsWith('ЗАХВАТбез боя') || !verdicts.seizedResources.startsWith('+') || !verdicts.seizedFromMeResources.startsWith('−')
    || verdicts.sunMine !== 1 || !verdicts.raidLost.includes('млрд') || !verdicts.raidResources.startsWith('−')) fail('row contents', verdicts);

  await win.webContents.executeJavaScript(`document.querySelector('.fleet-main-v1--battles').scrollTop = 3200`);
  await settle(win, 300);
  await capture(win, directory, 'list-200');
  await win.webContents.executeJavaScript(`document.querySelector('.fleet-main-v1--battles').scrollTop = 0`);

  // Opening a row: the details appear with the row, without a sideways scroll.
  await win.webContents.executeJavaScript(`document.querySelector('[data-qa-battle-card="qa-long-names"]').open = true`);
  await waitFor(win, `document.querySelector('[data-qa-battle-card="qa-long-names"] [data-qa-battle-open]')`);
  await settle(win, 400);
  metrics.opened = await win.webContents.executeJavaScript(`(() => {
    const card = document.querySelector('[data-qa-battle-card="qa-long-names"]');
    const body = card.querySelector('.bcard');
    return { bodyHeight: Math.round(body.getBoundingClientRect().height), overflow: body.scrollWidth > body.clientWidth + 1, detailsAnimated: getComputedStyle(body).animationName };
  })()`);
  if (metrics.opened.bodyHeight < 100 || metrics.opened.overflow || metrics.opened.detailsAnimated !== 'brow-details') fail('opened row', metrics.opened);
  await capture(win, directory, 'row-open');
  await win.webContents.executeJavaScript(`document.querySelector('[data-qa-battle-card="qa-long-names"]').open = false`);
  await settle(win, 400);

  // The starred tab is empty; a star from the row fills it and does not open the row.
  await clickTab(win, 1);
  metrics.savedEmpty = await win.webContents.executeJavaScript(`Boolean(document.querySelector('[data-qa-battle-empty="saved"]'))`);
  if (!metrics.savedEmpty) fail('empty starred tab');
  await capture(win, directory, 'saved-empty');
  await clickTab(win, 0);
  await win.webContents.executeJavaScript(`document.querySelector('[data-qa-battle-card="qa-draw"] .battle-save-v1').click()`);
  await settle(win, 300);
  metrics.afterStar = { tabs: await tabs(win), opened: await win.webContents.executeJavaScript(`document.querySelector('[data-qa-battle-card="qa-draw"]').open`) };
  if (metrics.afterStar.tabs[1] !== 1 || metrics.afterStar.opened) fail('star from the row', metrics.afterStar);
  await clickTab(win, 1);
  await capture(win, directory, 'saved-one');

  // An old save: a battle of others he starred before stays starred and is not in «Последние».
  await openBattles(win, { foreign: true, starForeign: true }, `document.querySelector('[data-qa-navigation="utility"]')`);
  metrics.starredForeign = { tabs: await tabs(win) };
  await clickTab(win, 1);
  metrics.starredForeign.rows = await win.webContents.executeJavaScript(`Array.from(document.querySelectorAll('[data-qa-battle-card]')).map((row) => row.getAttribute('data-qa-battle-card'))`);
  if (metrics.starredForeign.tabs[0] !== DEMO_BATTLES || metrics.starredForeign.tabs[1] !== 1 || metrics.starredForeign.rows.join() !== 'qa-foreign-1') fail('starred battle of others', metrics.starredForeign);
  await capture(win, directory, 'saved-foreign');

  // An open report outlives its star: it leaves the lists, the window stays until closed.
  await win.webContents.executeJavaScript(`document.querySelector('[data-qa-battle-card="qa-foreign-1"]').open = true`);
  await waitFor(win, `document.querySelector('[data-qa-battle-open="qa-foreign-1"]')`);
  await win.webContents.executeJavaScript(`document.querySelector('[data-qa-battle-open="qa-foreign-1"]').click()`);
  await waitFor(win, `document.querySelector('[data-qa-battle-report-modal="qa-foreign-1"]')`);
  await win.webContents.executeJavaScript(`document.querySelector('[data-qa-battle-report-modal="qa-foreign-1"] .battle-save-v1').click()`);
  await settle(win, 300);
  metrics.unstarOpen = { modal: await win.webContents.executeJavaScript(`Boolean(document.querySelector('[data-qa-battle-report-modal="qa-foreign-1"]'))`), tabs: await tabs(win) };
  if (!metrics.unstarOpen.modal || metrics.unstarOpen.tabs[1] !== 0) fail('removing the star closed the open report', metrics.unstarOpen);
  await win.webContents.executeJavaScript(`document.querySelector('.battle-report-modal-close-v1').click()`);
  await settle(win, 200);
  if (!await win.webContents.executeJavaScript(`Boolean(document.querySelector('[data-qa-battle-empty="saved"]'))`)) fail('the report without a star stays in the starred tab');

  // No battles of his at all: the demo reports of test mode are someone else's for this profile.
  await openBattles(win, { nobody: true, foreign: true }, `document.querySelector('[data-qa-navigation="utility"]')`);
  metrics.noBattles = { tabs: await tabs(win), empty: await win.webContents.executeJavaScript(`Boolean(document.querySelector('[data-qa-battle-empty="recent"]'))`) };
  if (metrics.noBattles.tabs[0] !== 0 || metrics.noBattles.tabs[1] !== 0 || !metrics.noBattles.empty) fail('no battles', metrics.noBattles);
  await capture(win, directory, 'no-battles');

  // Back to the ordinary profile for the next window size.
  await patchSaveIdle(win, SAVE_KEY, `(save) => { save.profile.playerId = 'player-current'; }`, { label: 'profile restore' });
  return metrics;
}

app.whenReady().then(async () => {
  let win;
  try {
    fs.mkdirSync(OUTPUT, { recursive: true });
    win = new BrowserWindow({
      width: 1000, height: 700, show: false, backgroundColor: '#02050a',
      webPreferences: { offscreen: true, contextIsolation: true, nodeIntegration: false, sandbox: true, partition: 'qa-battles-mine' },
    });
    await win.loadFile(path.join(ROOT, 'dist', 'index.html'), { search: '?mode=test' });
    await waitFor(win, `document.querySelector('[data-qa-navigation="utility"]')`, 20_000);
    win.webContents.debugger.attach('1.3');
    // Windows runners report reduced motion; the player's game has its animations.
    await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });
    for (const [width, height] of VIEWPORTS) {
      const directory = path.join(OUTPUT, `${width}x${height}`);
      fs.mkdirSync(directory, { recursive: true });
      await win.webContents.debugger.sendCommand('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false, screenWidth: width, screenHeight: height });
      await settle(win);
      fs.writeFileSync(path.join(directory, 'metrics.json'), JSON.stringify(await runViewport(win, width, directory), null, 2));
    }
    win.webContents.debugger.detach();
    win.destroy();
    if (failures.length) { console.error(`[battles-mine-qa] ${failures.length} check(s) failed`); app.exit(1); return; }
    console.log('[battles-mine-qa] all checks passed');
    app.exit(0);
  } catch (error) {
    console.error(error);
    win?.destroy();
    app.exit(1);
  }
});
