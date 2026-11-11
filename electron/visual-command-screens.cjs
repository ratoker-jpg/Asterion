// «Командование» redo (11.11.2026): worst-case screenshots of the alliance screen at
// 1280×720 and 2560×1080.
// Cases: a full alliance (15 members is the game's own limit, the loader trims anything
// above it) with long names (42-character alliance name, long member names, the roster
// scrolled to its end), 20 pending applications, an alliance at war
// with 5 alliances, a profile with every score (points, contribution, joint operations,
// alliance crystals) and an empty profile, the aid requests form, the alliance editor
// with names at their limits and the crest constructor, the leave dialog with every
// successor, and the screen without an alliance.
// Layout contracts (ASTERION_QA_CHECKS=0 records them without failing, used for the
// «before» run on main): no text cut off without an ellipsis, no native title tooltips,
// no <select>, the screen and its dialogs fit the window.
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');
const { patchSaveIdle, removeKeysIdle } = require('./qa-save-edit.cjs');
const { PARSE_SAVE } = require('./qa-save.cjs');

app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-gpu');
app.on('window-all-closed', () => {});

const ROOT = path.join(__dirname, '..');
const OUTPUT = process.env.ASTERION_QA_OUTPUT || path.join(ROOT, 'visual-qa', 'screens-command', 'run');
const CHECKS = process.env.ASTERION_QA_CHECKS !== '0';
const SHOTS = process.env.ASTERION_SKIP_SCREENSHOTS !== '1';
const SAVE_KEY = 'asterion.vertical-slice.test.v1';
const VIEWPORTS = [[1280, 720], [2560, 1080]];
const OTHER_MEMBERS = 14; // with the player: a full alliance
const ALLIANCE_42 = 'Объединённый Северный Союз Звёздных Флотов';
const ALLIANCE_TAG = 'NORTHSTR';
const MOTTO_72 = 'Пока горят наши звёзды, ни один флот не пройдёт через Северный Рубеж!!';
const DESCRIPTION_220 = 'Мы держим **Северный Рубеж** с первого дня кампании. Принимаем командиров с флотом от 500 кораблей, помогаем ресурсами и вместе ходим в рейды на Солнце. Тихих не держим: *участие* в операциях обязательно для всех.';
const FIRST = ['Адмирал', 'Командор', 'Капитан', 'Маршал', 'Навигатор', 'Комиссар'];
const SECOND = ['Северного Рубежа', 'Восточной Кассиопеи', 'Ледяного Перевала', 'Глубинной Шахты', 'Седьмого Сектора', 'Звёздной Гавани'];
const longName = (index) => `${FIRST[index % FIRST.length]} ${SECOND[Math.floor(index / FIRST.length) % SECOND.length]} ${index + 1}`;
const ENEMIES = [
  ['Коалиция Восточных Звёздных Систем Ядра', 'EASTCORE'],
  ['Братство Ледяного Перевала и Окраин', 'ICEPASS'],
  ['Синдикат Глубинных Шахтёров Сектора Семь', 'DEEPMINE'],
  ['Империя Новой Надежды Первой Экспедиции', 'NEWHOPE'],
  ['Альянс Свободных Торговцев Внешнего Кольца', 'OUTRING'],
];
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
  await waitFor(win, `Array.from(document.querySelectorAll('.command-view img, .command-dialog img')).every((img) => img.complete)`, 15000).catch(() => {});
  await win.webContents.executeJavaScript(`document.getAnimations().forEach((animation) => {
    const timing = animation.effect?.getComputedTiming?.();
    if (timing && Number.isFinite(timing.endTime)) animation.currentTime = timing.endTime;
  })`);
  await settle(win, 120);
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
  await settle(win, 280);
}

async function setField(win, selector, value) {
  const ok = await win.webContents.executeJavaScript(`(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    if (!element) return false;
    const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, 'value').set.call(element, ${JSON.stringify(value)});
    element.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`);
  if (!ok) throw new Error(`Missing field: ${selector}`);
  await settle(win, 120);
}

/** Scrolls the nearest scrolling ancestor of `selector` to its end. */
async function scrollToEnd(win, selector) {
  await win.webContents.executeJavaScript(`(() => {
    let node = document.querySelector(${JSON.stringify(selector)});
    while (node && node !== document.body) {
      const style = getComputedStyle(node);
      if (/(auto|scroll)/.test(style.overflowY) && node.scrollHeight > node.clientHeight + 1) { node.scrollTop = node.scrollHeight; return true; }
      node = node.parentElement;
    }
    return false;
  })()`);
  await settle(win, 240);
}

/** Text that is cut off (an ellipsis is allowed). */
function clippedText(win) {
  return win.webContents.executeJavaScript(`(() => {
    const out = [];
    document.querySelectorAll('.command-view, .command-dialog').forEach((root) => root.querySelectorAll('strong, small, em, b, span, h1, h2, h3, h4, h5, p, time, dt, dd, button, label, figcaption, output').forEach((node) => {
      if (!node.getClientRects().length || !node.textContent.trim() || node.children.length) return;
      if (node.closest('.srp-host, .aid-quick-send')) return;
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
    const view = document.querySelector('.command-view')?.getBoundingClientRect();
    const dialog = document.querySelector('.command-dialog')?.getBoundingClientRect();
    const inside = (box) => !box || (box.top >= -1 && box.left >= -1 && box.bottom <= innerHeight + 1 && box.right <= innerWidth + 1);
    return {
      fits: Boolean(view) && inside(view) && inside(dialog),
      horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 2,
      nativeTitles: Array.from(document.querySelectorAll('.command-view [title], .command-dialog [title]')).filter((node) => !node.closest('.srp-host')).map((node) => node.getAttribute('title')),
      selects: document.querySelectorAll('.command-view select:not(.game-select__native), .command-dialog select:not(.game-select__native)').length,
    };
  })()`);
}

function worldSeed(now) {
  const last = OTHER_MEMBERS - 1;
  const members = Array.from({ length: OTHER_MEMBERS }, (_, index) => ({
    ownerId: `qa-member-${index + 1}`,
    displayName: longName(index),
    joinedAt: now - (40 + index) * 3_600_000,
    lastActiveAt: now - index * 60_000,
    deliveredUnits: index === last ? 0 : 1_250_000 * (OTHER_MEMBERS - index),
    jointOperationCount: index === last ? 0 : index % 7,
    tieBreaker: (index + 1) / 31,
  }));
  const battlePoints = Object.fromEntries(members.filter((_, index) => index !== last).map((member, index) => [member.ownerId, 90_000_000 - index * 2_750_000]));
  const applicants = Array.from({ length: 20 }, (_, index) => ({
    id: `application-qa-${index + 1}`,
    ownerId: `qa-applicant-${index + 1}`,
    displayName: longName(index + 7),
    createdAt: now - (index + 1) * 1_800_000,
  }));
  for (const applicant of applicants) battlePoints[applicant.ownerId] = 40_000_000 - Number(applicant.id.split('-').pop()) * 1_500_000;
  return `(save) => {
    const now = ${now};
    const playerId = save.profile?.playerId;
    for (const planet of Object.values(save.planets || {})) {
      if (planet.buildings) planet.buildings['planetary-government'] = Math.max(3, planet.buildings['planetary-government'] || 0);
    }
    const command = save.command;
    const own = command.alliances.find((alliance) => (alliance.members || []).some((member) => member.ownerId === playerId));
    own.name = ${JSON.stringify(ALLIANCE_42)};
    own.tag = ${JSON.stringify(ALLIANCE_TAG)};
    own.motto = ${JSON.stringify(MOTTO_72)};
    own.description = ${JSON.stringify(DESCRIPTION_220)};
    own.leaderOwnerId = playerId;
    const me = own.members.find((member) => member.ownerId === playerId);
    me.deliveredUnits = 48_500_000;
    me.jointOperationCount = 12;
    me.joinedAt = now - 30 * 86_400_000;
    own.members = [me, ...${JSON.stringify(members)}];
    own.deputyOwnerId = 'qa-member-1';
    own.deputySince = now - 86_400_000;
    const enemies = ${JSON.stringify(ENEMIES)}.map(([name, tag], index) => ({
      id: 'alliance-qa-enemy-' + (index + 1), name, tag, motto: '', description: 'Союз окраин. Воюет со всеми, кто ходит через Северный Рубеж.',
      emblem: { glyph: ['crown', 'blades', 'comet', 'wings', 'planet'][index], accent: ['crimson', 'amber', 'violet', 'emerald', 'silver'][index] },
      createdAt: now - (10 + index) * 86_400_000, leaderOwnerId: 'qa-enemy-leader-' + (index + 1), deputyOwnerId: null, leaderSince: now - 5 * 86_400_000,
      members: [{ ownerId: 'qa-enemy-leader-' + (index + 1), displayName: ${JSON.stringify(FIRST)}[index] + ' Внешнего Кольца Окраин ' + (index + 1), joinedAt: now - 9 * 86_400_000, lastActiveAt: now, deliveredUnits: 0, jointOperationCount: 0, tieBreaker: 0.5 }],
    }));
    command.alliances = [...command.alliances.filter((alliance) => !String(alliance.id).startsWith('alliance-qa-enemy-')), ...enemies];
    const others = command.diplomacy.filter((relation) => relation.ownerAllianceId !== own.id && !String(relation.ownerAllianceId).startsWith('alliance-qa-enemy-'));
    const wars = enemies.flatMap((enemy, index) => {
      const since = now - (index + 1) * 5_400_000;
      return [
        { id: enemy.id, allianceName: enemy.name, tag: enemy.tag, status: 'war', ownerAllianceId: own.id, since, declaredByAllianceId: index % 2 ? enemy.id : own.id, truce: null, truceRejectedAt: null },
        { id: own.id, allianceName: own.name, tag: own.tag, status: 'war', ownerAllianceId: enemy.id, since, declaredByAllianceId: index % 2 ? enemy.id : own.id, truce: null, truceRejectedAt: null },
      ];
    });
    command.diplomacy = [...others, ...wars];
    const pending = ${JSON.stringify(applicants)}.map((item) => ({ ...item, allianceId: own.id, allianceName: own.name, status: 'pending', reason: null, resolvedAt: null, resolvedByOwnerId: null }));
    const history = [['accepted', null], ['rejected', 'declined'], ['auto_rejected', 'full'], ['withdrawn', null]].map(([status, reason], index) => ({
      id: 'application-qa-history-' + index, allianceId: own.id, allianceName: own.name, ownerId: 'qa-history-' + index, displayName: ${JSON.stringify(SECOND)}[index] + ' Отставной Командир ' + index,
      status, reason, createdAt: now - (index + 30) * 3_600_000, resolvedAt: now - (index + 20) * 3_600_000, resolvedByOwnerId: playerId,
    }));
    command.applications = [...command.applications.filter((application) => application.allianceId !== own.id), ...pending, ...history];
    save.rating = { ...(save.rating || {}), archivedBattlePoints: { ...((save.rating || {}).archivedBattlePoints || {}), ...${JSON.stringify(battlePoints)}, [playerId]: 125_000_000 } };
    if (save.sunRaid?.crystals) save.sunRaid.crystals = { ...save.sunRaid.crystals, ['alliance:' + own.id]: ['crystal-1', 'crystal-3', 'crystal-4'] };
    localStorage.setItem('asterion.test-time-scale.v1', '1');
  }`;
}

function noAllianceSeed(now) {
  return `(save) => {
    const now = ${now};
    const playerId = save.profile?.playerId;
    const command = save.command;
    for (const alliance of command.alliances) {
      if (alliance.leaderOwnerId === playerId) {
        const next = alliance.members.find((member) => member.ownerId !== playerId);
        alliance.leaderOwnerId = next ? next.ownerId : alliance.leaderOwnerId;
        if (alliance.deputyOwnerId === alliance.leaderOwnerId) alliance.deputyOwnerId = null;
      }
      alliance.members = alliance.members.filter((member) => member.ownerId !== playerId);
    }
    command.alliances = command.alliances.filter((alliance) => alliance.members.length);
    if (save.profile) save.profile.allianceId = null;
    command.cooldowns = command.cooldowns.filter((cooldown) => cooldown.ownerId !== playerId);
    const target = command.alliances.find((alliance) => alliance.id === 'alliance-qa-enemy-1') || command.alliances[0];
    command.applications = [...command.applications.filter((application) => application.ownerId !== playerId), {
      id: 'application-qa-mine', allianceId: target.id, allianceName: target.name, ownerId: playerId, displayName: save.profile?.displayName || 'Игрок',
      status: 'pending', reason: null, createdAt: now - 600_000, resolvedAt: null, resolvedByOwnerId: null,
    }];
  }`;
}

async function openCommand(win) {
  await click(win, '[data-qa-navigation="primary"] [data-qa-route="command"]');
  await waitFor(win, `document.querySelector('.command-view')`);
  await settle(win, 500);
}

async function openTab(win, tab) {
  await click(win, `[data-qa-command-tab="${tab}"]`);
  await settle(win, 420);
}

async function selectMember(win, ownerIndex) {
  // ownerIndex is the row index in the roster (0 = the leader).
  await win.webContents.executeJavaScript(`(() => {
    const rows = Array.from(document.querySelectorAll('[data-qa-member-list] li button'));
    rows[${ownerIndex}]?.scrollIntoView({ block: 'center' });
    rows[${ownerIndex}]?.click();
  })()`);
  await settle(win, 420);
}

async function runViewport(win, directory, label) {
  const metrics = { failures: [], shots: {} };
  const fail = (message, detail) => {
    metrics.failures.push(`${message}: ${JSON.stringify(detail)}`);
    if (CHECKS) throw new Error(`${label} ${message}: ${JSON.stringify(detail)}`);
  };
  const shot = async (name) => {
    const clipped = await clippedText(win);
    const box = await layout(win);
    metrics.shots[name] = { clipped, ...box };
    if (clipped.length) fail(`${name}: text is cut off`, clipped);
    if (!box.fits || box.horizontalOverflow) fail(`${name}: screen does not fit`, box);
    if (box.nativeTitles.length) fail(`${name}: native title tooltips remain`, box.nativeTitles);
    if (box.selects) fail(`${name}: <select> remains`, box.selects);
    await capture(win, directory, name);
  };

  await patchSaveIdle(win, SAVE_KEY, worldSeed(Date.now()), {
    label: 'command QA seed',
    held: `(() => { const save = ${PARSE_SAVE}(localStorage.getItem(${JSON.stringify(SAVE_KEY)}) || '{}'); return save.command?.alliances?.some((alliance) => alliance.name === ${JSON.stringify(ALLIANCE_42)} && alliance.members.length === ${OTHER_MEMBERS + 1}); })()`,
  });
  await win.webContents.executeJavaScript('document.fonts?.ready');
  await openCommand(win);

  // 1. Overview of a full alliance with long names, 20 applications waiting.
  await shot('01-overview-full-alliance');

  // 2. Roster: the top, the end (scrolled), the profile with every score, an empty profile.
  await openTab(win, 'members');
  metrics.members = await win.webContents.executeJavaScript(`document.querySelectorAll('[data-qa-member-list] li').length`);
  if (metrics.members !== OTHER_MEMBERS + 1) fail('Roster is not full', metrics.members);
  await shot('02-members-profile-all-scores');
  await selectMember(win, OTHER_MEMBERS);
  await scrollToEnd(win, '[data-qa-member-list]');
  await shot('03-members-end-empty-profile');
  await selectMember(win, 1);
  await shot('04-members-deputy');

  // 3. 20 pending applications.
  await openTab(win, 'applications');
  metrics.applications = await win.webContents.executeJavaScript(`document.querySelectorAll('[data-qa-application]').length`);
  if (metrics.applications !== 20) fail('Not 20 pending applications', metrics.applications);
  await shot('05-applications-20-pending');
  await scrollToEnd(win, '[data-qa-application-list]');
  await shot('06-applications-history');

  // 4. War with five alliances.
  await openTab(win, 'diplomacy');
  metrics.wars = await win.webContents.executeJavaScript(`document.querySelectorAll('[data-qa-relation-status="war"]').length`);
  if (metrics.wars < 5) fail('Fewer than 5 wars on the list', metrics.wars);
  await shot('07-diplomacy-5-wars');

  // 5. Catalog of alliances, aid requests.
  await openTab(win, 'alliances');
  await shot('08-alliances-catalog');
  await openTab(win, 'requests');
  await shot('09-requests-form');
  await openTab(win, 'operations');
  await shot('09b-operations-sun');

  // 6. Editor with names at their limits, the crest constructor.
  await openTab(win, 'overview');
  await click(win, '[data-qa-edit-alliance]');
  await waitFor(win, `document.querySelector('[data-qa-alliance-name]')`);
  await shot('10-editor-long-names');
  await click(win, '[data-qa-crest-open]');
  await waitFor(win, `document.querySelector('[data-qa-crest-constructor]')`);
  await settle(win, 600);
  await shot('11-crest-constructor');
  await click(win, '[data-qa-crest-tab="layout"]');
  await shot('12-crest-layout');
  await click(win, '[data-qa-crest-back]');
  await click(win, '.command-dialog [data-asterion-close]');

  // 7. Leave dialog: the leader picks a successor.
  await click(win, '[data-qa-leave]');
  await waitFor(win, `document.querySelector('[data-qa-successor]')`);
  await shot('13-leave-successors');
  await click(win, '.command-dialog [data-asterion-close]');

  // 8. No alliance: a pending application, the catalog of six alliances.
  await patchSaveIdle(win, SAVE_KEY, noAllianceSeed(Date.now()), {
    label: 'command QA no alliance',
    held: `(() => { const save = ${PARSE_SAVE}(localStorage.getItem(${JSON.stringify(SAVE_KEY)}) || '{}'); const id = save.profile?.playerId; return !save.command?.alliances?.some((alliance) => alliance.members.some((member) => member.ownerId === id)); })()`,
  });
  await openCommand(win);
  await waitFor(win, `document.querySelector('[data-qa-command-empty]')`);
  await shot('14-no-alliance');
  await click(win, '[data-qa-create-alliance]').catch(() => {});
  if (await win.webContents.executeJavaScript(`Boolean(document.querySelector('[data-qa-alliance-name]'))`)) {
    await setField(win, '[data-qa-alliance-name]', ALLIANCE_42);
    await shot('15-create-alliance');
    await click(win, '.command-dialog [data-asterion-close]');
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
      webPreferences: { offscreen: true, contextIsolation: true, nodeIntegration: false, sandbox: true, partition: 'qa-command-screens' },
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
      // Every viewport starts from the Test Mode seed again.
      await removeKeysIdle(win, [SAVE_KEY], { label: 'fresh test save', ready: `document.querySelector('[data-qa-navigation="utility"]') && localStorage.getItem(${JSON.stringify(SAVE_KEY)})` });
      all[label] = await runViewport(win, directory, label);
    }
    fs.writeFileSync(path.join(OUTPUT, 'command-screens-metrics.json'), JSON.stringify(all, null, 2));
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
