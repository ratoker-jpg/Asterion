// «Основание союза» (identity PR 1, 15.11.2026): the three founding steps and the first
// screen of a new alliance at 1920×1080 and 1280×720, including the worst case — the
// name (42), tag (8), motto (72) and description (220) at their limits.
// Layout contracts (ASTERION_QA_CHECKS=0 records them without failing): no text cut off
// without an ellipsis, no native title tooltips, the dialog and the screen fit the window.
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');
const { patchSaveIdle, removeKeysIdle } = require('./qa-save-edit.cjs');
const { PARSE_SAVE } = require('./qa-save.cjs');

app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-gpu');
app.on('window-all-closed', () => {});

const ROOT = path.join(__dirname, '..');
const OUTPUT = process.env.ASTERION_QA_OUTPUT || path.join(ROOT, 'visual-qa', 'alliance-founding', 'run');
const CHECKS = process.env.ASTERION_QA_CHECKS !== '0';
const SHOTS = process.env.ASTERION_SKIP_SCREENSHOTS !== '1';
const SAVE_KEY = 'asterion.vertical-slice.test.v1';
const VIEWPORTS = [[1920, 1080], [1280, 720]];
const NAME_42 = 'Объединённый Северный Союз Звёздных Флотов';
const TAG_8 = 'NORTHSTR';
const MOTTO_72 = 'Пока горят наши звёзды, ни один флот не пройдёт через Северный Рубеж!!';
const DESCRIPTION_220 = 'Мы держим **Северный Рубеж** с первого дня кампании. Принимаем командиров с флотом от 500 кораблей, помогаем ресурсами и вместе ходим в рейды на Солнце. Тихих не держим: *участие* в операциях обязательно для всех.';
const PROSPECTS = ['Вольный Предел', 'Сигма-7', 'Тавр', 'Кальдера', 'Северная Гавань', 'Орин Странник'];
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
  // Crests are drawn on canvas asynchronously.
  await settle(win, 450);
  const result = await win.webContents.debugger.sendCommand('Page.captureScreenshot', { format: 'jpeg', quality: 82, fromSurface: true, captureBeyondViewport: false });
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

function clippedText(win) {
  return win.webContents.executeJavaScript(`(() => {
    const out = [];
    document.querySelectorAll('.command-view, .command-dialog').forEach((root) => root.querySelectorAll('strong, small, em, b, i, span, h1, h2, h3, h4, p, dt, dd, button, label').forEach((node) => {
      if (!node.getClientRects().length || !node.textContent.trim() || node.children.length) return;
      if (node.closest('.srp-host')) return;
      const style = getComputedStyle(node);
      const cutX = node.scrollWidth > node.clientWidth + 1 && style.overflow !== 'visible';
      const cutY = node.scrollHeight > node.clientHeight + 2 && style.overflowY !== 'visible' && style.overflowY !== 'auto';
      if ((cutX && style.textOverflow !== 'ellipsis') || cutY) out.push(node.textContent.trim().slice(0, 60));
    }));
    return out;
  })()`);
}

function layout(win) {
  return win.webContents.executeJavaScript(`(() => {
    const view = document.querySelector('.command-view')?.getBoundingClientRect();
    const dialog = document.querySelector('.command-dialog')?.getBoundingClientRect();
    const inside = (box) => !box || (box.top >= -1 && box.left >= -1 && box.bottom <= innerHeight + 1 && box.right <= innerWidth + 1);
    // Columns of the wizard that scroll: the worst case should still fit without scrolling.
    const scrolled = Array.from(document.querySelectorAll('.founding > *')).filter((node) => node.scrollHeight > node.clientHeight + 2).map((node) => node.className);
    return {
      fits: Boolean(view) && inside(view) && inside(dialog),
      horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 2,
      nativeTitles: Array.from(document.querySelectorAll('.command-view [title], .command-dialog [title]')).filter((node) => !node.closest('.srp-host')).map((node) => node.getAttribute('title')),
      scrolled,
    };
  })()`);
}

function noAllianceSeed() {
  return `(save) => {
    const playerId = save.profile?.playerId;
    for (const planet of Object.values(save.planets || {})) {
      if (planet.buildings) planet.buildings['planetary-government'] = Math.max(3, planet.buildings['planetary-government'] || 0);
    }
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
    // Test Mode has one bot (Bot 01, in its own alliance). Free bots with a Hall join the world for this scene;
    // their characters are generated on load like for any owner new to the save, and they choose by their own rule.
    const targets = save.espionage?.targets || {};
    const base = Object.values(targets).find((target) => target.kind === 'npc');
    const names = ${JSON.stringify(PROSPECTS)};
    if (base) names.forEach((name, index) => {
      const id = 'qa-prospect-planet-' + (index + 1);
      targets[id] = { ...JSON.parse(JSON.stringify(base)), id, name: 'Колония ' + (index + 1), ownerId: 'qa-prospect-' + (index + 1), ownerName: name,
        coordinate: { galaxy: 1, system: 30 + index, position: 4 + index }, buildings: { ...base.buildings, 'planetary-government': 1 } };
    });
    if (save.espionage) { save.espionage.targets = targets; save.espionage.bot01Planets = targets; }
    if (save.profile) save.profile.allianceId = null;
    command.cooldowns = command.cooldowns.filter((cooldown) => cooldown.ownerId !== playerId);
    command.applications = command.applications.filter((application) => application.ownerId !== playerId);
  }`;
}

async function runViewport(win, directory, label) {
  const metrics = { failures: [], shots: {} };
  const fail = (message, detail) => {
    metrics.failures.push(`${message}: ${JSON.stringify(detail)}`);
    if (CHECKS) throw new Error(`${label} ${message}: ${JSON.stringify(detail)}`);
  };
  const shot = async (name, { allowScroll = false } = {}) => {
    const clipped = await clippedText(win);
    const box = await layout(win);
    metrics.shots[name] = { clipped, ...box };
    if (clipped.length) fail(`${name}: text is cut off`, clipped);
    if (!box.fits || box.horizontalOverflow) fail(`${name}: screen does not fit`, box);
    if (box.nativeTitles.length) fail(`${name}: native title tooltips remain`, box.nativeTitles);
    if (!allowScroll && box.scrolled.length) fail(`${name}: a wizard column scrolls`, box.scrolled);
    await capture(win, directory, name);
  };

  await patchSaveIdle(win, SAVE_KEY, noAllianceSeed(), {
    label: 'founding QA: no alliance',
    held: `(() => { const save = ${PARSE_SAVE}(localStorage.getItem(${JSON.stringify(SAVE_KEY)}) || '{}'); const id = save.profile?.playerId; return !save.command?.alliances?.some((alliance) => alliance.members.some((member) => member.ownerId === id)); })()`,
  });
  await win.webContents.executeJavaScript('document.fonts?.ready');
  await click(win, '[data-qa-navigation="primary"] [data-qa-route="command"]');
  await waitFor(win, `document.querySelector('[data-qa-command-empty]')`);
  await settle(win, 500);

  // Step 1 «Знамя»: the crest is large from the first second, nothing typed yet.
  await click(win, '[data-qa-create-alliance]');
  await waitFor(win, `document.querySelector('[data-qa-founding-step="1"]')`);
  await shot('01-banner-start');
  // Worst case: every text at its limit; another ready look and colour.
  await setField(win, '[data-qa-alliance-name]', NAME_42);
  await setField(win, '[data-qa-alliance-tag]', TAG_8);
  await setField(win, '[data-qa-alliance-motto]', MOTTO_72);
  await click(win, '[data-qa-preset="2"]');
  await click(win, '[data-qa-glyph="leviathan"]');
  await click(win, '[data-qa-color="violet"]');
  metrics.heroName = await win.webContents.executeJavaScript(`document.querySelector('[data-qa-founding-hero-name]')?.textContent`);
  if (metrics.heroName !== NAME_42) fail('Hero does not follow the name', metrics.heroName);
  await shot('02-banner-worst-case');
  await click(win, '[data-qa-crest-random]');
  await shot('03-banner-random-crest');
  await click(win, '[data-qa-preset="2"]');
  await click(win, '[data-qa-glyph="leviathan"]');
  await click(win, '[data-qa-color="violet"]');
  // Fine tuning: the full constructor, then back to the wizard.
  await click(win, '[data-qa-crest-open]');
  await waitFor(win, `document.querySelector('[data-qa-crest-constructor]')`);
  await settle(win, 500);
  await capture(win, directory, '04-fine-tuning');
  await click(win, '[data-qa-crest-back]');
  await waitFor(win, `document.querySelector('[data-qa-founding-step="1"]')`);

  // Step 2 «О союзе»: description at its limit, the catalog card.
  await click(win, '[data-qa-founding-next]');
  await waitFor(win, `document.querySelector('[data-qa-founding-step="2"]')`);
  await setField(win, '[data-qa-alliance-description]', DESCRIPTION_220);
  await shot('05-about-worst-case');

  // Step 3 «Основание»: the summary.
  await click(win, '[data-qa-founding-next]');
  await waitFor(win, `document.querySelector('[data-qa-founding-step="3"]')`);
  await shot('06-founding-summary');

  // The first screen of the alliance: the same crest the wizard showed, saved and drawn.
  metrics.wizardCrest = await win.webContents.executeJavaScript(`document.querySelector('[data-qa-founding-crest]')?.dataset.qaFoundingCrest`);
  await click(win, '[data-qa-alliance-submit]');
  await waitFor(win, `document.querySelector('[data-qa-alliance-first]')`);
  await settle(win, 600);
  metrics.firstName = await win.webContents.executeJavaScript(`document.querySelector('[data-qa-first-name]')?.textContent`);
  if (!String(metrics.firstName || '').includes(NAME_42)) fail('First screen does not show the alliance', metrics.firstName);
  metrics.steps = await win.webContents.executeJavaScript(`Array.from(document.querySelectorAll('[data-qa-first-step]')).map((node) => node.dataset.qaFirstStep + ':' + node.dataset.qaDone)`);
  if (metrics.steps.length !== 4 || metrics.steps[0] !== 'banner:1') fail('First steps are not 4 with the banner raised', metrics.steps);
  metrics.prospects = await win.webContents.executeJavaScript(`document.querySelectorAll('[data-qa-prospect]').length`);
  metrics.crest = await win.webContents.executeJavaScript(`(() => { const save = ${PARSE_SAVE}(localStorage.getItem(${JSON.stringify(SAVE_KEY)}) || '{}'); const id = save.profile?.playerId;
    const own = save.command?.alliances?.find((alliance) => alliance.members.some((member) => member.ownerId === id)); return own ? { crest: Boolean(own.emblem?.crest), motto: own.motto } : null; })()`).catch(() => null);
  metrics.firstCrest = await win.webContents.executeJavaScript(`document.querySelector('[data-qa-alliance-first]')?.dataset.qaFirstCrest`);
  metrics.savedCrest = await win.webContents.executeJavaScript(`(() => { const save = ${PARSE_SAVE}(localStorage.getItem(${JSON.stringify(SAVE_KEY)}) || '{}'); const id = save.profile?.playerId;
    const crest = save.command?.alliances?.find((alliance) => alliance.members.some((member) => member.ownerId === id))?.emblem?.crest; return crest ? [crest.frame, crest.field, crest.glyph, crest.color].join('/') : null; })()`);
  if (metrics.wizardCrest !== 'octagon/crimson/leviathan/violet' || metrics.firstCrest !== metrics.wizardCrest || metrics.savedCrest !== metrics.wizardCrest) {
    fail('The founded crest is not the one picked in the wizard', { wizard: metrics.wizardCrest, firstScreen: metrics.firstCrest, saved: metrics.savedCrest });
  }
  if (metrics.prospects < 2) fail('«Им подходит ваш союз» shows fewer than 2 bots', metrics.prospects);
  metrics.prospectFaces = await win.webContents.executeJavaScript(`Array.from(document.querySelectorAll('[data-qa-prospect-face]')).map((node) => node.dataset.qaProspectFace)`);
  if (metrics.prospectFaces.length !== metrics.prospects) fail('A prospect has no face (initials?)', metrics.prospectFaces);
  metrics.toastOverFirstScreen = await win.webContents.executeJavaScript(`Boolean(document.querySelector('.command-feedback, [role="status"].toast, .asterion-toast'))`);
  await shot('07-first-screen', { allowScroll: true });
  if (metrics.prospects > 0) {
    await click(win, '[data-qa-prospect-invite]');
    await settle(win, 500);
    await shot('08-first-screen-invited', { allowScroll: true });
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
      webPreferences: { offscreen: true, contextIsolation: true, nodeIntegration: false, sandbox: true, partition: 'qa-alliance-founding' },
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
      await removeKeysIdle(win, [SAVE_KEY], { label: 'fresh test save', ready: `document.querySelector('[data-qa-navigation="utility"]') && localStorage.getItem(${JSON.stringify(SAVE_KEY)})` });
      all[label] = await runViewport(win, directory, label);
    }
    fs.writeFileSync(path.join(OUTPUT, 'alliance-founding-metrics.json'), JSON.stringify(all, null, 2));
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
