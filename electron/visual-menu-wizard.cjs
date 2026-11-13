// Main menu and «Новая игра» redo (14.11.2026): worst-case screenshots of the player's
// first minute at 1280×720 and 2560×1080, from a clean profile (no ?mode=test).
// Phase A (no saves): the main menu on first launch, the empty «Загрузить игру»,
// every wizard step with the defaults, then with the longest names, the largest
// world, an exact NPC race mix and an invalid (empty) commander name.
// Phase B (many saves): one real campaign is started, then its slot is cloned into
// 16 slots with long names, past rounds and one broken slot, and the main menu
// and «Загрузить игру» are shot again.
// Layout contracts (ASTERION_QA_CHECKS=0 records them without failing, used for the
// «before» run on main): no text cut off without an ellipsis, no native title
// tooltips, no native <select>, no horizontal scroll, the primary action visible.
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-gpu');
app.on('window-all-closed', () => {});

const ROOT = path.join(__dirname, '..');
const OUTPUT = process.env.ASTERION_QA_OUTPUT || path.join(ROOT, 'visual-qa', 'screens-menu-wizard', 'run');
// The «before» commit records the contracts only; the redo switches them on.
const CHECKS = process.env.ASTERION_QA_CHECKS ? process.env.ASTERION_QA_CHECKS !== '0' : false;
const SHOTS = process.env.ASTERION_SKIP_SCREENSHOTS !== '1';
const VIEWPORTS = [[1280, 720], [2560, 1080]];
const ROOT_SELECTOR = '.menu-stage';
const INDEX_KEY = 'asterion.slots.index.v1';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const run = (win, source) => win.webContents.executeJavaScript(source);

// The longest names the wizard accepts (24 and 40 characters).
const LONG_COMMANDER = 'Константин-Александрович';
const LONG_CAMPAIGN = 'Империя Солнечного Ветра и Звёздных Врат';
const T = Date.UTC(2026, 10, 14, 18, 40, 0);

async function waitFor(win, expression, timeoutMs = 20000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await run(win, `Boolean(${expression})`)) return;
    await sleep(60);
  }
  throw new Error(`Timed out waiting for: ${expression}`);
}

async function settle(win, ms = 160) {
  await run(win, 'new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
  await sleep(ms);
}

async function load(win) {
  const loaded = new Promise((resolve) => win.webContents.once('did-finish-load', resolve));
  await win.loadFile(path.join(ROOT, 'dist', 'index.html'));
  await loaded;
  await waitFor(win, `document.querySelector('[data-qa-menu]')`, 30000);
  await run(win, 'document.fonts?.ready');
  await settle(win, 300);
}

/** Finishes every finite entrance animation so a frame never catches a card halfway. */
async function finishAnimations(win) {
  await waitFor(win, `Array.from(document.querySelectorAll('${ROOT_SELECTOR} img')).every((img) => img.complete)`, 15000).catch(() => {});
  await run(win, `document.getAnimations().forEach((animation) => {
    const timing = animation.effect?.getComputedTiming?.();
    if (timing && Number.isFinite(timing.endTime)) animation.currentTime = timing.endTime;
  })`);
  await settle(win, 160);
}

async function capture(win, directory, name) {
  if (!SHOTS) return;
  await finishAnimations(win);
  const result = await win.webContents.debugger.sendCommand('Page.captureScreenshot', { format: 'jpeg', quality: 82, fromSurface: true, captureBeyondViewport: false });
  fs.writeFileSync(path.join(directory, `${name}.jpg`), Buffer.from(result.data, 'base64'));
}

async function click(win, selector, { optional = false } = {}) {
  const ok = await run(win, `(() => { const node = document.querySelector(${JSON.stringify(selector)}); if (!node || node.disabled) return false; node.click(); return true; })()`);
  if (!ok && !optional) throw new Error(`Missing or disabled control: ${selector}`);
  await settle(win, 260);
  return ok;
}

/** Clicks the first button (or radio) whose text matches; works on the old and the new wizard. */
async function clickText(win, pattern, scope = ROOT_SELECTOR) {
  const ok = await run(win, `(() => {
    const re = new RegExp(${JSON.stringify(pattern)});
    const node = [...document.querySelectorAll(${JSON.stringify(`${scope} button, ${scope} [role="radio"]`)})].find((item) => re.test(item.textContent.replace(/\\s+/g, ' ').trim()));
    if (!node) return false;
    node.click();
    return true;
  })()`);
  if (!ok) throw new Error(`No control matching /${pattern}/`);
  await settle(win, 220);
}

/** Sets a text or range field by its data-qa-world name (the input itself or one inside it). */
async function setField(win, qa, value) {
  const ok = await run(win, `(() => {
    let input = document.querySelector('[data-qa-world="${qa}"]');
    if (input && input.tagName !== 'INPUT') input = input.querySelector('input');
    if (!input) return false;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(input, String(${JSON.stringify(value)}));
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  })()`);
  if (!ok) throw new Error(`World field not found: ${qa}`);
  await settle(win, 200);
}

const stepOf = (win) => run(win, `document.querySelector('[data-qa-wizard-step]')?.dataset.qaWizardStep ?? null`);

/** Scrolls every scrolling box on the stage to its end (or back to the top). */
async function scrollAll(win, end) {
  await run(win, `(() => {
    document.querySelectorAll('${ROOT_SELECTOR} *').forEach((node) => {
      const style = getComputedStyle(node);
      if (!/(auto|scroll)/.test(style.overflowY) || node.scrollHeight <= node.clientHeight + 2) return;
      node.scrollTop = ${end ? 'node.scrollHeight' : '0'};
    });
    window.scrollTo(0, ${end ? 'document.documentElement.scrollHeight' : '0'});
  })()`);
  await settle(win, 220);
}

/** Text that is cut off (an ellipsis is allowed), inside the visible part of the stage. */
function clippedText(win) {
  return run(win, `(() => {
    const out = [];
    const stage = document.querySelector('${ROOT_SELECTOR}');
    if (!stage) return out;
    stage.querySelectorAll('strong, small, em, b, span, h1, h2, h3, h4, p, time, dt, dd, button, label, output, kbd, figcaption, li').forEach((node) => {
      if (!node.getClientRects().length || !node.textContent.trim() || node.children.length) return;
      const style = getComputedStyle(node);
      if (style.visibility === 'hidden' || Number(style.opacity) === 0) return;
      const cutX = node.scrollWidth > node.clientWidth + 1 && style.overflow !== 'visible' && style.display !== 'inline';
      const cutY = node.scrollHeight > node.clientHeight + 2 && style.overflowY !== 'visible' && style.overflowY !== 'auto' && style.display !== 'inline' && style.webkitLineClamp === 'none';
      if ((cutX && style.textOverflow !== 'ellipsis') || cutY) out.push(node.textContent.trim().slice(0, 60));
    });
    return out;
  })()`);
}

async function layout(win) {
  return run(win, `(() => {
    const stage = document.querySelector('${ROOT_SELECTOR}');
    const viewport = { width: innerWidth, height: innerHeight };
    const primary = [...document.querySelectorAll('${ROOT_SELECTOR} [data-qa-primary-action], ${ROOT_SELECTOR} [data-qa-wizard-next], ${ROOT_SELECTOR} [data-qa-wizard-start]')]
      .filter((node) => node.getClientRects().length)
      .map((node) => { const box = node.getBoundingClientRect(); return { text: node.textContent.trim().slice(0, 40), inside: box.top >= 0 && box.left >= 0 && box.bottom <= viewport.height + 1 && box.right <= viewport.width + 1 }; });
    return {
      present: Boolean(stage),
      screen: document.querySelector('[data-qa-menu]')?.dataset.qaMenu ?? null,
      step: document.querySelector('[data-qa-wizard-step]')?.dataset.qaWizardStep ?? null,
      horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 2,
      nativeTitles: Array.from(document.querySelectorAll('${ROOT_SELECTOR} [title]')).map((node) => node.getAttribute('title').slice(0, 60)),
      visibleSelects: Array.from(document.querySelectorAll('${ROOT_SELECTOR} select')).filter((node) => !node.closest('.game-select')).length,
      nativeRanges: Array.from(document.querySelectorAll('${ROOT_SELECTOR} input[type="range"]')).filter((node) => !node.closest('.amount-slider')).length,
      primary,
    };
  })()`);
}

function shooter(win, directory, metrics, label) {
  const fail = (message, detail) => {
    metrics.failures.push(`${message}: ${JSON.stringify(detail)}`);
    if (CHECKS) throw new Error(`${label} ${message}: ${JSON.stringify(detail)}`);
  };
  return async (name, { primary = true } = {}) => {
    await finishAnimations(win);
    const clipped = await clippedText(win);
    const box = await layout(win);
    metrics.shots[name] = { clipped, ...box };
    if (!box.present) fail(`${name}: menu stage is missing`, box);
    if (clipped.length) fail(`${name}: text is cut off`, clipped);
    if (box.horizontalOverflow) fail(`${name}: horizontal scroll`, box);
    if (box.nativeTitles.length) fail(`${name}: native title tooltips remain`, box.nativeTitles);
    if (box.visibleSelects) fail(`${name}: native select remains`, box.visibleSelects);
    if (box.nativeRanges) fail(`${name}: bare native range inputs remain`, box.nativeRanges);
    if (primary && box.primary.length && !box.primary.some((item) => item.inside)) fail(`${name}: the primary action is off screen`, box.primary);
    await capture(win, directory, name);
  };
}

/** Phase A: no saves. Every wizard step, then the worst cases. Returns at the last step. */
async function phaseA(win, directory, label) {
  const metrics = { failures: [], shots: {} };
  const shot = shooter(win, directory, metrics, label);
  await run(win, 'localStorage.clear(); sessionStorage.clear();');
  await load(win);
  await shot('a01-main-first-run');
  await click(win, '[data-qa-menu-action="load"]');
  await waitFor(win, `document.querySelector('[data-qa-load-screen]')`);
  await shot('a02-load-empty', { primary: false });
  await click(win, '[data-qa-menu-back]');
  await waitFor(win, `document.querySelector('[data-qa-menu="main"]')`);

  await click(win, '[data-qa-menu-action="new"]');
  await waitFor(win, `document.querySelector('[data-qa-wizard-step="race"]')`);
  await shot('a03-wizard-race');
  await click(win, '[data-qa-race="veyra"]');
  await shot('a04-wizard-race-veyra');

  // Walk the steps with «Далее» and shoot each one with the defaults.
  const order = [];
  for (let guard = 0; guard < 8; guard += 1) {
    const step = await stepOf(win);
    if (step === 'confirm') break;
    await click(win, '[data-qa-wizard-next]');
    const next = await stepOf(win);
    if (next === step) throw new Error(`«Далее» did not leave the step ${step}`);
    order.push(next);
    await scrollAll(win, false);
    await shot(`a05-step-${String(order.length).padStart(2, '0')}-${next}-default`);
    if (next !== 'confirm') {
      await scrollAll(win, true);
      await shot(`a05-step-${String(order.length).padStart(2, '0')}-${next}-default-end`);
      await scrollAll(win, false);
    }
  }
  metrics.steps = ['race', ...order];

  // Worst case: back to the first step with the fields, then the longest names and the largest world.
  const gotoStep = async (id) => {
    if (await click(win, `[data-qa-wizard-rail="${id}"]`, { optional: true })) return;
    // The old wizard has no rail: walk with «Назад»/«Далее» in the right direction.
    const at = (step) => metrics.steps.indexOf(step);
    for (let guard = 0; guard < 8 && (await stepOf(win)) !== id; guard += 1) {
      await click(win, at(await stepOf(win)) > at(id) ? '[data-qa-menu-back]' : '[data-qa-wizard-next]');
    }
    if ((await stepOf(win)) !== id) throw new Error(`Could not reach step ${id}`);
  };
  const fieldStep = async (qa) => {
    for (const id of metrics.steps) {
      await gotoStep(id);
      if (await run(win, `Boolean(document.querySelector('[data-qa-world="${qa}"]'))`)) return id;
    }
    throw new Error(`No step holds the field ${qa}`);
  };
  await fieldStep('player-name');
  await setField(win, 'player-name', LONG_COMMANDER);
  await setField(win, 'campaign-name', LONG_CAMPAIGN);
  await clickText(win, 'Супербыстрая');
  await clickText(win, '^Максимальная');
  await scrollAll(win, false);
  await shot('a06-worst-names-superfast');
  await setField(win, 'player-name', '');
  await shot('a07-worst-empty-commander');
  await setField(win, 'player-name', LONG_COMMANDER);

  await fieldStep('galaxies');
  await setField(win, 'galaxies', 10);
  await setField(win, 'npc', 75);
  await clickText(win, 'Задать соотношение');
  await scrollAll(win, false);
  await shot('a08-worst-world-max');
  await scrollAll(win, true);
  await shot('a09-worst-world-max-end');
  await scrollAll(win, false);

  // A modest world to start (generation time on CI), the long names stay.
  await setField(win, 'galaxies', 3);
  await setField(win, 'npc', 30);
  await setField(win, 'seed', 'QAMENU42');
  await gotoStep('confirm');
  await shot('a10-worst-confirm-long');
  return metrics;
}

/** Phase B: many saves (one real slot cloned), main menu with «Продолжить» and the load list. */
async function phaseB(win, directory, label) {
  const metrics = { failures: [], shots: {} };
  const shot = shooter(win, directory, metrics, label);
  await load(win);
  await waitFor(win, `document.querySelector('[data-qa-menu="main"]')`);
  await shot('b01-main-continue-long');
  await click(win, '[data-qa-menu-action="load"]');
  await waitFor(win, `document.querySelector('[data-qa-load-screen]')`);
  await shot('b02-load-many', { primary: false });
  await scrollAll(win, true);
  await shot('b03-load-many-end', { primary: false });
  await scrollAll(win, false);
  return metrics;
}

/** Clones the real slot into 16 slots: long names, every race, past rounds, one broken, one with a backup copy. */
async function seedManySlots(win) {
  await run(win, `(() => {
    const index = JSON.parse(localStorage.getItem(${JSON.stringify(INDEX_KEY)}));
    const base = index.slots[0];
    const races = ['aegis', 'synod', 'veyra'];
    const names = [
      ${JSON.stringify(LONG_CAMPAIGN)},
      'Длинная кампания Иларов на десяти галактиках',
      'Рой',
      'Кампания Астеров · раунд 12',
      'ШШШШШШШШШШШШШШШШШШШШШШШШШШШШШШШШШШШШШШШШ',
      'Тестовый мир 3',
    ];
    const speeds = ['slow', 'standard', 'fast', 'superfast'];
    // The first card (the «Продолжить» campaign) has its own save with a pre-migration copy (#231).
    let backupKey = base.storageKey;
    try {
      const own = 'asterion.slot.qa-backup.v1';
      localStorage.setItem(own, localStorage.getItem(base.storageKey));
      localStorage.setItem(own + '.backup-qa1', '{"schemaVersion":1}');
      localStorage.setItem(own + '.backups', JSON.stringify([{ key: own + '.backup-qa1', at: ${T} - 2 * 86_400_000, fromSchema: 41, chars: 18 }]));
      backupKey = own;
    } catch (error) { console.warn('QA: no room for the backup copy', error); }
    const slots = [];
    for (let i = 0; i < 16; i += 1) {
      slots.push({
        ...base,
        id: 'slot-qa-' + String(i).padStart(2, '0'),
        name: (names[i % names.length] + (i >= names.length ? ' ' + (i + 1) : '')).slice(0, 40),
        factionId: races[i % 3],
        playerName: i % 2 ? ${JSON.stringify(LONG_COMMANDER)} : 'Ая',
        campaignSpeed: speeds[i % 4],
        npcActivity: ['normal', 'high', 'max'][i % 3],
        updatedAt: ${T} - i * 3_600_000 * 7,
        createdAt: ${T} - 90 * 86_400_000,
        playTimeMs: i === 0 ? 9_999 * 3_600_000 + 59 * 60_000 : (i + 1) * 5_400_000,
        summary: { ...base.summary, planets: i === 0 ? 7 : 1 + (i % 7), npcCount: 100, galaxyCount: 10, days: 400, crystals: i % 5, victory: i === 4 },
        storageKey: i === 6 ? 'asterion.slot.qa-missing.v1' : i === 0 ? backupKey : base.storageKey,
        ...(i >= 13 ? { retiredAt: ${T} - i * 86_400_000 } : {}),
      });
    }
    localStorage.setItem(${JSON.stringify(INDEX_KEY)}, JSON.stringify({ ...index, activeSlotId: slots[0].id, slots }));
  })()`);
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
      webPreferences: { offscreen: true, contextIsolation: true, nodeIntegration: false, sandbox: true, partition: 'qa-menu-wizard' },
    });
    await win.loadFile(path.join(ROOT, 'dist', 'index.html'));
    win.webContents.debugger.attach('1.3');
    const all = {};
    const setViewport = async (width, height) => {
      await win.webContents.debugger.sendCommand('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false, screenWidth: width, screenHeight: height });
      await settle(win);
    };
    for (const [width, height] of VIEWPORTS) {
      const label = `${width}x${height}`;
      const directory = path.join(OUTPUT, label);
      fs.mkdirSync(directory, { recursive: true });
      await setViewport(width, height);
      all[`${label} A`] = await phaseA(win, directory, label);
    }
    // The last phase A ended on the summary: start the campaign for real.
    await click(win, '[data-qa-wizard-start]');
    await waitFor(win, `document.querySelector('[data-qa-navigation="utility"]') && localStorage.getItem(${JSON.stringify(INDEX_KEY)})`, 90000);
    await settle(win, 1500);
    // Leave the running game first: its autosave must not write over the cloned index.
    await load(win);
    await seedManySlots(win);
    for (const [width, height] of VIEWPORTS) {
      const label = `${width}x${height}`;
      await setViewport(width, height);
      all[`${label} B`] = await phaseB(win, path.join(OUTPUT, label), label);
    }
    fs.writeFileSync(path.join(OUTPUT, 'menu-wizard-metrics.json'), JSON.stringify(all, null, 2));
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
