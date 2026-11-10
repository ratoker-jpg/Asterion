// «Рейтинг» alliances and crystals QA at 1920×1080 and 1280×720, worst cases:
// 100 players, 24-character nicks, a 42-character alliance name with an
// 8-character tag, an oversized alliance of 30 members, an alliance with no
// deputy, a solo player with personal crystals. Checks: leader and deputy are
// marked (leader first), alliance members show the alliance's crystals instead
// of a personal 0, the Gate rule is stated, no «ДОСТИЖ.» dead column, nothing
// overlaps or scrolls sideways; a roster name opens that player.
// The standings come from a Test Mode QA fixture (UtilityScreensPortal reads
// it in Test Mode only), rendered inside the real game shell.
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-gpu');
app.on('window-all-closed', () => {});

const ROOT = path.join(__dirname, '..');
const OUTPUT = process.env.ASTERION_QA_OUTPUT || path.join(ROOT, 'visual-qa', 'rating-alliance');
const SKIP_SCREENSHOTS = process.env.ASTERION_SKIP_SCREENSHOTS === '1';
const FIXTURE_KEY = 'asterion.qa.rating-fixture.v1';
const VIEWPORTS = [[1920, 1080], [1280, 720]];
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const failures = [];
const fail = (message, detail) => { failures.push({ message, detail }); console.error(`[rating-alliance-qa] ${message}`, JSON.stringify(detail ?? null)); };
const check = (ok, message, detail) => { if (!ok) fail(message, detail); };
const js = (win, code) => win.webContents.executeJavaScript(code);

// ---------- fixture ----------
const PLAYER_ID = 'qa-player';
const LONG_NICKS = {
  'npc-001': 'Константинопольский_Страж',
  'npc-003': 'ВеличайшийКомандорГалакт',
  'npc-007': 'Верховный Архонт Северных',
  'npc-012': 'Заместитель_Командующего',
  'npc-033': 'Тихий_Смотритель_Ордена_',
};
const FACTIONS = ['aegis', 'synod', 'veyra'];
const nameOf = (id, index) => (LONG_NICKS[id] ?? `Пилот-${String(index).padStart(3, '0')}`).slice(0, 24);
const ids = Array.from({ length: 99 }, (_, index) => `npc-${String(index + 1).padStart(3, '0')}`);

function buildFixture() {
  const owners = {};
  const ownerScores = {};
  const all = [...ids.slice(0, 39), PLAYER_ID, ...ids.slice(39)];
  all.forEach((id, index) => {
    const name = id === PLAYER_ID ? 'Dendrilion' : nameOf(id, index + 1);
    owners[id] = {
      name,
      factionId: FACTIONS[index % 3],
      planets: Array.from({ length: 1 + (index % 3) }, (_, planet) => ({
        id: `${id}-p${planet}`,
        name: planet === 2 ? 'Колония Великая Северная Альфа' : `${name.slice(0, 10)} ${planet + 1}`,
        coordinate: { galaxy: 1, system: 1 + ((index * 7 + planet) % 400), position: 1 + ((index + planet) % 15) },
      })),
      crystals: id === PLAYER_ID ? 3 : id === 'npc-050' ? 2 : 0,
    };
    const resourcePoints = 9_876_543_210 - index * 87_654_321;
    const battlePoints = 1_234_567_890 - index * 9_876_543;
    ownerScores[id] = { ownerId: id, resourcePoints, battlePoints, totalPoints: resourcePoints + battlePoints, achievementPoints: 0 };
  });
  const member = (ownerId) => ({ ownerId, displayName: owners[ownerId].name, joinedAt: 0, lastActiveAt: 0, deliveredUnits: 0, jointOperationCount: 0, tieBreaker: 0.5 });
  const alliance = (id, name, tag, memberIds, leader, deputy, accent) => ({
    id, name, tag, motto: '', description: '', emblem: { glyph: 'crown', accent }, createdAt: 0,
    leaderOwnerId: leader, deputyOwnerId: deputy, leaderSince: 0, members: memberIds.map(member),
  });
  const giantName = 'Великая Объединённая Конфедерация Северных Звёздных Систем'.slice(0, 42);
  const alliances = [
    alliance('qa-giant', giantName, 'ABCDEFGH', ids.slice(0, 30), 'npc-007', 'npc-012', 'amber'),
    alliance('qa-no-deputy', 'Тихий Орден', 'TIHO', ids.slice(30, 36), 'npc-033', null, 'violet'),
    alliance('qa-small', 'Звёздный Рой', 'ROJ', ids.slice(40, 43), 'npc-041', 'npc-042', 'emerald'),
  ];
  const allianceDetails = {
    'qa-giant': { members: 30, wars: 1, crystals: 4, gate: 'building' },
    'qa-no-deputy': { members: 6, wars: 2, crystals: 1 },
    'qa-small': { members: 3, wars: 0, crystals: 0 },
  };
  return { ownerScores, owners, currentPlayerId: PLAYER_ID, alliances, allianceDetails, giantName };
}

// ---------- helpers ----------
async function waitFor(win, expression, timeoutMs = 20000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await js(win, `Boolean(${expression})`)) return;
    await sleep(50);
  }
  throw new Error(`Timed out waiting for: ${expression}`);
}

async function settle(win, ms = 160) {
  await js(win, 'new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
  await sleep(ms);
}

async function capture(win, directory, name) {
  if (SKIP_SCREENSHOTS) return;
  // The «Экран открыт» toast is the shell's, not the rating's: close it so it covers nothing.
  await js(win, `document.querySelectorAll('[data-qa-runtime-toast] button').forEach((button) => button.click())`);
  await settle(win, 400);
  await js(win, `document.getAnimations().forEach((animation) => {
    const timing = animation.effect?.getComputedTiming?.();
    if (timing && Number.isFinite(timing.endTime)) animation.currentTime = timing.endTime;
  })`);
  await settle(win, 60);
  const result = await win.webContents.debugger.sendCommand('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: false });
  fs.writeFileSync(path.join(directory, `${name}.png`), Buffer.from(result.data, 'base64'));
}

async function click(win, selector) {
  const clicked = await js(win, `(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    if (!element || element.disabled) return false;
    element.click();
    return true;
  })()`);
  if (!clicked) throw new Error(`Element not found/enabled: ${selector}`);
  await settle(win);
}

async function clickText(win, selector, text) {
  const clicked = await js(win, `(() => {
    const element = [...document.querySelectorAll(${JSON.stringify(selector)})].find((node) => node.textContent.trim() === ${JSON.stringify(text)});
    if (!element) return false;
    element.click();
    return true;
  })()`);
  if (!clicked) throw new Error(`No ${selector} with text ${text}`);
  await settle(win);
}

async function scrollTo(win, selector, block = 'start') {
  await js(win, `document.querySelector(${JSON.stringify(selector)})?.scrollIntoView({ block: ${JSON.stringify(block)}, behavior: 'instant' })`);
  await settle(win, 120);
}

/** Layout contract of the rating screen as it stands now. */
async function layout(win, where) {
  const facts = await js(win, `(() => {
    const box = (node) => node.getBoundingClientRect();
    const overlaps = [];
    for (const row of document.querySelectorAll('.rating-table-v2 .rating-row-v2')) {
      const cells = [...row.children].map(box);
      for (let i = 1; i < cells.length; i += 1) if (cells[i].width && cells[i].left < cells[i - 1].right - 1) overlaps.push((row.textContent || '').slice(0, 30) + ':' + i);
      const r = box(row);
      if (cells.some((cell) => cell.right > r.right + 1)) overlaps.push((row.textContent || '').slice(0, 30) + ':out');
    }
    const spill = [];
    for (const node of document.querySelectorAll('.rating-card-v2, .rating-card-v2 *')) {
      const card = node.closest('.rating-card-v2');
      if (!card || node === card) continue;
      const b = box(node); const c = box(card);
      if (b.width && (b.right > c.right + 1 || b.left < c.left - 1)) spill.push((node.className || node.tagName) + ':' + (node.textContent || '').slice(0, 20));
    }
    const view = document.querySelector('.rating-view-v2');
    return {
      pageScrollX: document.documentElement.scrollWidth - innerWidth,
      viewScrollX: view ? view.scrollWidth - view.clientWidth : 0,
      overlaps: overlaps.slice(0, 10),
      spill: spill.slice(0, 10),
      heads: [...document.querySelectorAll('.rating-head-v2 > *')].map((node) => node.textContent.trim()),
      tabs: [...document.querySelectorAll('.rating-mode-tabs-v2 button')].map((node) => node.textContent.trim()),
    };
  })()`);
  check(facts.pageScrollX <= 1 && facts.viewScrollX <= 1, `${where}: sideways scroll`, facts);
  check(facts.overlaps.length === 0, `${where}: row cells overlap`, facts.overlaps);
  check(facts.spill.length === 0, `${where}: card content leaves the card`, facts.spill);
  check(!facts.heads.some((head) => head.includes('ДОСТИЖ')), `${where}: dead «ДОСТИЖ.» column is back`, facts.heads);
  check(!facts.tabs.some((tab) => tab === 'ЧЕМПИОНАТЫ' || tab === 'ЗАЛ СЛАВЫ'), `${where}: dead tabs are back`, facts.tabs);
  return facts;
}

const text = (win, selector) => js(win, `document.querySelector(${JSON.stringify(selector)})?.innerText || ''`);

async function runViewport(win, directory, fixture, label) {
  const metrics = {};
  await clickText(win, '.rating-mode-tabs-v2 button', 'ИГРОКИ');
  await waitFor(win, `document.querySelectorAll('[data-qa-rating-player-row]').length >= 12`);
  await js(win, 'window.scrollTo(0, 0)');
  await settle(win, 200);
  metrics.players = await layout(win, `${label} players`);
  metrics.playerRows = await js(win, `document.querySelectorAll('[data-qa-rating-player-row]').length`);
  metrics.total = await text(win, '.rating-meta-v2 > span');
  check(metrics.total.includes('из 100'), `${label}: expected 100 players`, metrics.total);
  const leaderRow = await text(win, '[data-qa-rating-player-row="npc-007"]');
  check(leaderRow.includes('[ABCDEFGH]') && /глава/i.test(leaderRow), `${label}: leader row lacks the tag or the role mark`, leaderRow);
  const deputyRow = await text(win, '[data-qa-rating-player-row="npc-012"]');
  check(/зам\./i.test(deputyRow), `${label}: deputy row lacks the role mark`, deputyRow);
  await capture(win, directory, '01-players-roles');

  // A leader's card: the alliance's crystals and the Gate right, not a personal 0.
  await click(win, '[data-qa-rating-player-row="npc-007"]');
  await waitFor(win, `document.querySelector('[data-qa-rating-player-card="npc-007"]')`);
  const leaderCard = await text(win, '[data-qa-rating-player-card="npc-007"]');
  check(await js(win, `Boolean(document.querySelector('[data-qa-rating-player-card="npc-007"] [data-qa-rating-player-crystals="alliance"]'))`), `${label}: member card shows personal crystals`, leaderCard);
  check(leaderCard.includes('4/4') && /Как глава/.test(leaderCard), `${label}: leader card lacks alliance crystals or the Gate role`, leaderCard);
  await scrollTo(win, '[data-qa-rating-player-row="npc-007"]', 'center');
  metrics.leaderCard = await layout(win, `${label} leader card`);
  await capture(win, directory, '02-player-card-leader');

  // A plain member: alliance crystals and who builds the Gate.
  await click(win, '[data-qa-rating-player-row="npc-002"]');
  const memberCard = await text(win, '[data-qa-rating-player-card="npc-002"]');
  check(memberCard.includes('строит глава союза') && memberCard.includes('4/4'), `${label}: member card does not say who builds the Gate`, memberCard);
  await capture(win, directory, '03-player-card-member');

  // The solo player: personal crystals stay.
  await click(win, '.rating-self-v2');
  await waitFor(win, `document.querySelector('[data-qa-rating-player-row="${PLAYER_ID}"]')`);
  await click(win, `[data-qa-rating-player-row="${PLAYER_ID}"]`);
  await waitFor(win, `document.querySelector('[data-qa-rating-player-card="${PLAYER_ID}"] [data-qa-rating-player-crystals="solo"]')`);
  const soloCard = await text(win, `[data-qa-rating-player-card="${PLAYER_ID}"]`);
  check(soloCard.includes('3/4') && soloCard.includes('Без союза'), `${label}: solo card lacks personal crystals`, soloCard);
  await scrollTo(win, `[data-qa-rating-player-card="${PLAYER_ID}"]`, 'center');
  metrics.soloCard = await layout(win, `${label} solo card`);
  await capture(win, directory, '04-player-card-solo');

  // Alliances.
  await clickText(win, '.rating-mode-tabs-v2 button', 'АЛЬЯНСЫ');
  await waitFor(win, `document.querySelector('[data-qa-rating-alliance-row="qa-giant"]')`);
  await js(win, 'window.scrollTo(0, 0)');
  await settle(win, 200);
  check(await js(win, `Boolean(document.querySelector('[data-qa-rating-average-hint]'))`), `${label}: alliance points are not explained as averages`);
  metrics.alliances = await layout(win, `${label} alliances`);
  const giantRow = await js(win, `(() => {
    const row = document.querySelector('[data-qa-rating-alliance-row="qa-giant"]');
    const name = row.querySelector('.identity-v2 strong');
    const tag = row.querySelector('.alliance-tag-v2');
    return { name: name.textContent, nameCut: name.scrollWidth > name.clientWidth + 1, tagCut: tag.scrollWidth > tag.clientWidth + 1 };
  })()`);
  check(giantRow.name === fixture.giantName && !giantRow.nameCut && !giantRow.tagCut, `${label}: the 42-character alliance name or 8-character tag is cut`, giantRow);
  await capture(win, directory, '05-alliances');

  await click(win, '[data-qa-rating-alliance-row="qa-giant"]');
  await waitFor(win, `document.querySelector('[data-qa-rating-alliance-card="qa-giant"] [data-qa-rating-roster]')`);
  metrics.giant = await js(win, `(() => {
    const card = document.querySelector('[data-qa-rating-alliance-card="qa-giant"]');
    return {
      roles: [...card.querySelectorAll('[data-qa-rating-roster-member]')].map((node) => node.getAttribute('data-qa-rating-roster-member')),
      leader: card.querySelector('[data-qa-rating-leader]').innerText,
      deputies: card.querySelector('[data-qa-rating-deputies]').innerText,
      crystals: card.querySelector('[data-qa-rating-alliance-crystals]').innerText,
      gate: card.querySelector('[data-qa-rating-gate-rule]').innerText,
      clippedNames: [...card.querySelectorAll('.rating-roster-v2__name')].filter((node) => node.scrollWidth > node.clientWidth + 1).length,
      roster: card.querySelector('[data-qa-rating-roster]').getBoundingClientRect().height,
    };
  })()`);
  const giant = metrics.giant;
  check(giant.roles.length === 30, `${label}: roster is not complete`, giant.roles.length);
  check(giant.roles[0] === 'leader' && giant.roles[1] === 'deputy' && giant.roles.slice(2).every((role) => role === 'member'), `${label}: roster order is not leader, deputy, members`, giant.roles);
  check(giant.leader.includes(LONG_NICKS['npc-007'].slice(0, 24)), `${label}: leader name missing`, giant.leader);
  check(giant.deputies.includes(LONG_NICKS['npc-012']), `${label}: deputy name missing`, giant.deputies);
  check(giant.crystals.includes('4/4'), `${label}: alliance crystals missing`, giant.crystals);
  check(/только глава союза/.test(giant.gate) && giant.gate.includes('Строятся'), `${label}: Gate rule or status missing`, giant.gate);
  metrics.giantLayout = await layout(win, `${label} giant card`);
  await scrollTo(win, '[data-qa-rating-alliance-row="qa-giant"]');
  await capture(win, directory, '06-alliance-30-members');
  await scrollTo(win, '[data-qa-rating-alliance-card="qa-giant"] [data-qa-rating-roster]', 'end');
  await capture(win, directory, '07-alliance-30-members-roster-end');

  await click(win, '[data-qa-rating-alliance-row="qa-no-deputy"]');
  await waitFor(win, `document.querySelector('[data-qa-rating-alliance-card="qa-no-deputy"]')`);
  const noDeputy = await text(win, '[data-qa-rating-alliance-card="qa-no-deputy"] [data-qa-rating-deputies]');
  check(noDeputy.includes('не назначен'), `${label}: no-deputy alliance does not say so`, noDeputy);
  const noDeputyRoles = await js(win, `[...document.querySelectorAll('[data-qa-rating-alliance-card="qa-no-deputy"] [data-qa-rating-roster-member]')].map((node) => node.getAttribute('data-qa-rating-roster-member'))`);
  check(noDeputyRoles[0] === 'leader' && !noDeputyRoles.includes('deputy'), `${label}: no-deputy roster order`, noDeputyRoles);
  await scrollTo(win, '[data-qa-rating-alliance-row="qa-no-deputy"]', 'center');
  metrics.noDeputy = await layout(win, `${label} no-deputy card`);
  await capture(win, directory, '08-alliance-no-deputy');

  // A roster name opens that player in «Игроки».
  await click(win, '[data-qa-rating-alliance-card="qa-no-deputy"] [data-qa-rating-leader] button.rating-roster-v2__name');
  await waitFor(win, `document.querySelector('[data-qa-rating-player-card="npc-033"]')`);
  await scrollTo(win, '[data-qa-rating-player-card="npc-033"]', 'center');
  await capture(win, directory, '09-roster-opens-player');
  return metrics;
}

app.whenReady().then(async () => {
  let win;
  try {
    fs.mkdirSync(OUTPUT, { recursive: true });
    const fixture = buildFixture();
    win = new BrowserWindow({
      width: 1000, height: 700, show: false, backgroundColor: '#02050a',
      webPreferences: { offscreen: true, contextIsolation: true, nodeIntegration: false, sandbox: true, partition: 'qa-rating-alliance' },
    });
    await win.loadFile(path.join(ROOT, 'dist', 'index.html'), { search: '?mode=test' });
    await waitFor(win, `document.querySelector('[data-qa-navigation="utility"]')`);
    await js(win, `localStorage.setItem(${JSON.stringify(FIXTURE_KEY)}, ${JSON.stringify(JSON.stringify(fixture))})`);
    await js(win, 'document.fonts?.ready');
    win.webContents.debugger.attach('1.3');
    for (const [width, height] of VIEWPORTS) {
      const label = `${width}x${height}`;
      const directory = path.join(OUTPUT, label);
      fs.mkdirSync(directory, { recursive: true });
      await win.webContents.debugger.sendCommand('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false, screenWidth: width, screenHeight: height });
      await settle(win);
      await click(win, '[data-qa-navigation="utility"] [data-qa-route="rating"]');
      await waitFor(win, `document.querySelector('[data-qa-utility-screen="rating"] .rating-view-v2')`);
      await settle(win, 300);
      fs.writeFileSync(path.join(directory, 'rating-metrics.json'), JSON.stringify(await runViewport(win, directory, fixture, label), null, 2));
    }
    win.webContents.debugger.detach();
    win.destroy();
    if (failures.length) { console.error(`[rating-alliance-qa] ${failures.length} check(s) failed`); app.exit(1); return; }
    console.log('[rating-alliance-qa] all checks passed');
    app.exit(0);
  } catch (error) {
    console.error(error);
    try { if (win?.webContents.debugger.isAttached()) win.webContents.debugger.detach(); } catch {}
    win?.destroy();
    app.exit(1);
  }
});
