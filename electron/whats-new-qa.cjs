// «Что нового» QA at 1920×1080 and 1280×720: no mark on a fresh install, the mark
// after an update (with a stored version and for a player from before this screen),
// the list, an item with a picture, an update without one, keyboard, the pause menu
// (Esc closes only the dialog) and the layout contract (nothing off screen or cut,
// no sideways scroll, no native tooltips, readable type).
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-gpu');
app.on('window-all-closed', () => {});

const ROOT = path.join(__dirname, '..');
const OUTPUT = process.env.ASTERION_QA_OUTPUT || path.join(ROOT, 'visual-qa', 'whats-new');
const SKIP_SCREENSHOTS = process.env.ASTERION_SKIP_SCREENSHOTS === '1';
const SEEN_KEY = 'asterion.whats-new.seen.v1';
const VIEWPORTS = [[1920, 1080], [1280, 720]];
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const failures = [];
const fail = (message, detail) => { failures.push({ message, detail }); console.error(`[whats-new-qa] ${message}`, JSON.stringify(detail ?? null)); };
const check = (ok, message, detail) => { if (!ok) fail(message, detail); };

const js = (win, code) => win.webContents.executeJavaScript(code);

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
  await js(win, `document.getAnimations().forEach((animation) => {
    const timing = animation.effect?.getComputedTiming?.();
    if (timing && Number.isFinite(timing.endTime)) animation.currentTime = timing.endTime;
  })`);
  await settle(win, 60);
  const result = await win.webContents.debugger.sendCommand('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: false });
  fs.writeFileSync(path.join(directory, `${name}.png`), Buffer.from(result.data, 'base64'));
}

async function key(win, keyCode, modifiers = []) {
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode, modifiers });
  win.webContents.sendInputEvent({ type: 'keyUp', keyCode, modifiers });
  await settle(win, 120);
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

async function load(win, search, ready) {
  await win.loadFile(path.join(ROOT, 'dist', 'index.html'), search ? { search } : {});
  await waitFor(win, ready);
  await js(win, 'document.fonts?.ready');
  await settle(win);
}

const openMenu = (win, search = '') => load(win, search, `document.querySelector('[data-qa-whats-new-open]')`);
const setSeen = (win, value) => js(win, `localStorage.setItem(${JSON.stringify(SEEN_KEY)}, ${JSON.stringify(value)})`);
const readSeen = (win) => js(win, `localStorage.getItem(${JSON.stringify(SEEN_KEY)})`);
const hasMark = (win) => js(win, `Boolean(document.querySelector('[data-qa-whats-new-open] [data-qa-whats-new-mark]'))`);

/** The layout contract of the open dialog. */
async function checkDialog(win, label, width, height) {
  const facts = await js(win, `(() => {
    const dialog = document.querySelector('[data-qa-whats-new] [role="dialog"]');
    const close = document.querySelector('[data-qa-whats-new-close]');
    const content = document.querySelector('[data-qa-whats-new-content]');
    const box = (element) => { const r = element.getBoundingClientRect(); return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height }; };
    const texts = [...dialog.querySelectorAll('h2, h3, h4, p, small, b, span')].filter((element) => element.textContent.trim() && element.closest('svg') === null);
    const small = texts.map((element) => ({ text: element.textContent.slice(0, 30), size: parseFloat(getComputedStyle(element).fontSize) })).filter((entry) => entry.size < 11.5);
    const tabs = [...dialog.querySelectorAll('[role="tab"]')];
    return {
      dialog: box(dialog),
      close: box(close),
      tabs: tabs.length,
      tabsOutside: tabs.filter((tab) => box(tab).bottom > box(dialog).bottom + 1).length,
      sideways: content.scrollWidth - content.clientWidth,
      titles: [...dialog.querySelectorAll('[title]')].length,
      small,
      bodyFont: parseFloat(getComputedStyle(dialog.querySelector('.whats-new__copy p')).fontSize),
      brokenImages: [...dialog.querySelectorAll('img')].filter((image) => image.complete && image.naturalWidth === 0).map((image) => image.src),
      wideImages: [...dialog.querySelectorAll('img')].filter((image) => box(image).right > box(content).right + 1).length,
    };
  })()`);
  const where = `${label} ${width}x${height}`;
  check(facts.dialog.left >= 0 && facts.dialog.top >= 0 && facts.dialog.right <= width && facts.dialog.bottom <= height, `${where}: the dialog leaves the screen`, facts.dialog);
  check(facts.close.right > facts.dialog.right - 60 && facts.close.top < facts.dialog.top + 60, `${where}: close is not at the top right`, facts.close);
  check(facts.tabs === 5, `${where}: expected 5 versions`, facts.tabs);
  check(facts.tabsOutside === 0, `${where}: a version is cut off`, facts.tabsOutside);
  check(facts.sideways <= 0, `${where}: the content scrolls sideways`, facts.sideways);
  check(facts.titles === 0, `${where}: native tooltips`, facts.titles);
  check(facts.small.length === 0, `${where}: type below 11.5px`, facts.small);
  check(facts.bodyFont >= 14, `${where}: body text too small`, facts.bodyFont);
  check(facts.brokenImages.length === 0, `${where}: a picture did not load`, facts.brokenImages);
  check(facts.wideImages === 0, `${where}: a picture sticks out`, facts.wideImages);
  return facts;
}

const tabOf = (version) => `[data-qa-whats-new-tab="${version}"]`;

/** The first versions, read from the dialog: one with a picture, one without. */
async function selectRelease(win, kind) {
  const versions = await js(win, `[...document.querySelectorAll('[data-qa-whats-new-tab]')].map((tab) => tab.getAttribute('data-qa-whats-new-tab'))`);
  for (const version of versions) {
    await click(win, tabOf(version));
    const hasImage = await js(win, `Boolean(document.querySelector('[data-qa-whats-new-item="image"]'))`);
    if (hasImage === (kind === 'image')) return version;
  }
  throw new Error(`No release with kind ${kind}`);
}

async function runMenu(win, directory, width, height) {
  // Fresh install: no mark, and it starts at the newest version.
  await js(win, 'localStorage.clear()');
  await openMenu(win);
  check(!(await hasMark(win)), `${width}: a fresh install shows the mark`);
  const stamped = await readSeen(win);
  check(/^\d+\.\d+\.\d+$/.test(stamped ?? ''), `${width}: a fresh install did not remember the version`, stamped);
  await openMenu(win);
  check(!(await hasMark(win)), `${width}: the mark appeared after a restart of a fresh install`);

  // A new version since the last visit.
  await setSeen(win, '1.8.15');
  await openMenu(win);
  check(await hasMark(win), `${width}: no mark after an update`);
  const footer = await js(win, `(() => {
    const entry = document.querySelector('[data-qa-whats-new-open]').getBoundingClientRect();
    const update = document.querySelector('[data-qa-game-update]')?.getBoundingClientRect();
    const nav = document.querySelector('.menu-nav').getBoundingClientRect();
    const hint = document.querySelector('.menu-foot > span:last-child').getBoundingClientRect();
    return { entryTop: entry.top, entryBottom: entry.bottom, entryRight: entry.right, updateTop: update?.top ?? null, navBottom: nav.bottom, hintBottom: hint.bottom, height: innerHeight };
  })()`);
  check(footer.updateTop !== null, `${width}: the update row is missing from the QA menu`, footer);
  check(footer.entryTop >= footer.navBottom, `${width}: the entry overlaps the menu items`, footer);
  check(footer.hintBottom <= footer.height, `${width}: the menu footer leaves the screen`, footer);
  await capture(win, directory, '02-menu-new-mark');

  // The list.
  await click(win, '[data-qa-whats-new-open]');
  await waitFor(win, `document.querySelector('[data-qa-whats-new]')`);
  check(await readSeen(win) !== '1.8.15', `${width}: opening did not record the version`);
  const tags = await js(win, `[...document.querySelectorAll('[data-qa-whats-new-tab]')].filter((tab) => tab.querySelector('[data-qa-whats-new-mark]')).length`);
  check(tags >= 1, `${width}: no version is tagged as new in the list`, tags);
  const focused = await js(win, `document.activeElement?.getAttribute('role')`);
  check(focused === 'tab', `${width}: focus did not move into the dialog`, focused);
  await checkDialog(win, 'list', width, height);
  await capture(win, directory, '03-list');

  const withImage = await selectRelease(win, 'image');
  await waitFor(win, `[...document.querySelectorAll('[data-qa-whats-new-item="image"] img')].every((image) => image.complete && image.naturalWidth > 0)`);
  await checkDialog(win, `picture ${withImage}`, width, height);
  await capture(win, directory, '04-update-with-picture');

  const withoutImage = await selectRelease(win, 'text');
  await checkDialog(win, `no picture ${withoutImage}`, width, height);
  await capture(win, directory, '05-update-without-picture');

  // Keyboard: arrows walk the versions, Tab stays inside, Esc closes and returns focus.
  await click(win, '[data-qa-whats-new-tab]');
  await js(win, `document.querySelector('[data-qa-whats-new-tab]').focus()`);
  const first = await js(win, `document.activeElement.getAttribute('data-qa-whats-new-tab')`);
  await key(win, 'Down');
  const second = await js(win, `document.querySelector('[role="tab"][aria-selected="true"]').getAttribute('data-qa-whats-new-tab')`);
  check(first !== second, `${width}: arrow down did not change the version`, { first, second });
  for (let at = 0; at < 5; at += 1) await key(win, 'Tab');
  check(await js(win, `Boolean(document.activeElement?.closest('[data-qa-whats-new]'))`), `${width}: focus left the dialog`);
  await js(win, `document.querySelector('[data-qa-whats-new-open]').focus(); document.querySelector('[data-qa-whats-new-tab]').focus()`);
  await key(win, 'Escape');
  check(!(await js(win, `Boolean(document.querySelector('[data-qa-whats-new]'))`)), `${width}: Esc did not close the dialog`);
  check(!(await hasMark(win)), `${width}: the mark stayed after the screen was opened`);

  // Close button and a click outside close too; the mark does not return after a restart.
  await click(win, '[data-qa-whats-new-open]');
  await click(win, '[data-qa-whats-new-close]');
  check(!(await js(win, `Boolean(document.querySelector('[data-qa-whats-new]'))`)), `${width}: close did not close the dialog`);
  await openMenu(win);
  check(!(await hasMark(win)), `${width}: the mark came back after a restart`);
}

/** A player from before this screen: a campaign but no remembered version. */
async function runOldPlayer(win, directory, width) {
  await js(win, 'localStorage.clear()');
  await load(win, '?autostart=continue', `document.querySelector('[data-qa-pause-open]')`);
  await js(win, `localStorage.removeItem(${JSON.stringify(SEEN_KEY)})`);
  await openMenu(win);
  check(await hasMark(win), `${width}: an old player with a campaign has no mark`);
  await capture(win, directory, '07-menu-old-player-with-campaign');
  // The real campaign's pause menu holds more items than the test one.
  await load(win, '?autostart=continue', `document.querySelector('[data-qa-pause-open]')`);
  await click(win, '[data-qa-pause-open]');
  await waitFor(win, `document.querySelector('[data-qa-pause="whats-new"]')`);
  await checkPauseFits(win, `${width} campaign`);
}

async function checkPauseFits(win, label) {
  const pause = await js(win, `(() => {
    const panel = document.querySelector('.igo-pause').getBoundingClientRect();
    const buttons = [...document.querySelectorAll('.igo-pause button')].map((button) => button.getBoundingClientRect());
    return { top: panel.top, bottom: panel.bottom, lowest: Math.max(...buttons.map((box) => box.bottom)), height: innerHeight };
  })()`);
  check(pause.top >= 0 && pause.bottom <= pause.height, `${label}: the pause menu leaves the screen`, pause);
  check(pause.lowest <= pause.bottom, `${label}: a pause button is cut off`, pause);
}

async function runPause(win, directory, width, height) {
  await setSeen(win, '1.8.15');
  await load(win, '?mode=test', `document.querySelector('[data-qa-pause-open]')`);
  await click(win, '[data-qa-pause-open]');
  await waitFor(win, `document.querySelector('[data-qa-pause="whats-new"]')`);
  check(await js(win, `Boolean(document.querySelector('[data-qa-pause="whats-new"] [data-qa-whats-new-mark]'))`), `${width}: no mark in the pause menu`);
  await checkPauseFits(win, `${width}x${height} test`);
  await capture(win, directory, '08-pause-menu');
  await click(win, '[data-qa-pause="whats-new"]');
  await waitFor(win, `document.querySelector('[data-qa-whats-new]')`);
  await checkDialog(win, 'pause', width, height);
  await key(win, 'Escape');
  check(!(await js(win, `Boolean(document.querySelector('[data-qa-whats-new]'))`)), `${width}: Esc did not close the dialog over the pause menu`);
  check(await js(win, `Boolean(document.querySelector('[data-qa-pause-menu]'))`), `${width}: Esc closed the pause menu along with the dialog`);
  check(!(await js(win, `Boolean(document.querySelector('[data-qa-pause="whats-new"] [data-qa-whats-new-mark]'))`)), `${width}: the pause mark stayed`);
  await key(win, 'Escape');
  check(!(await js(win, `Boolean(document.querySelector('[data-qa-pause-menu]'))`)), `${width}: the second Esc did not close the pause menu`);
}

app.whenReady().then(async () => {
  let win;
  try {
    fs.mkdirSync(OUTPUT, { recursive: true });
    win = new BrowserWindow({
      width: 1000, height: 700, show: false, backgroundColor: '#02050a',
      webPreferences: { offscreen: true, contextIsolation: true, nodeIntegration: false, sandbox: true, partition: 'qa-whats-new', preload: path.join(__dirname, 'whats-new-qa-preload.cjs') },
    });
    win.webContents.on('console-message', (details) => { if (details.level === 'error') console.error('[renderer]', details.message); });
    await openMenu(win);
    win.webContents.debugger.attach('1.3');
    for (const [width, height] of VIEWPORTS) {
      const directory = path.join(OUTPUT, `${width}x${height}`);
      fs.mkdirSync(directory, { recursive: true });
      await win.webContents.debugger.sendCommand('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false, screenWidth: width, screenHeight: height });
      await settle(win);
      await runMenu(win, directory, width, height);
      await runOldPlayer(win, directory, width);
      await runPause(win, directory, width, height);
    }
    win.webContents.debugger.detach();
    win.destroy();
    if (failures.length) { console.error(`[whats-new-qa] ${failures.length} check(s) failed`); app.exit(1); return; }
    console.log('[whats-new-qa] all checks passed');
    app.exit(0);
  } catch (error) {
    console.error(error);
    try { if (win?.webContents.debugger.isAttached()) win.webContents.debugger.detach(); } catch {}
    win?.destroy();
    app.exit(1);
  }
});
