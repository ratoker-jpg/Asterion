// «Что нового» QA at 1920×1080 and 1280×720: no mark on a fresh install, the mark
// after an update (with a stored version and for a player from before this screen),
// the list, an item with a picture, an update without one, keyboard, the pause menu
// (Esc closes only the dialog) and the layout contract (nothing off screen or cut,
// no sideways scroll, no native tooltips, readable type). «Весь роадмэп»: loaded only
// when opened, every row present, eras, details, plans, keyboard, reduced motion.
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-gpu');
app.on('window-all-closed', () => {});

const ROOT = path.join(__dirname, '..');
const OUTPUT = process.env.ASTERION_QA_OUTPUT || path.join(ROOT, 'visual-qa', 'whats-new');
const SKIP_SCREENSHOTS = process.env.ASTERION_SKIP_SCREENSHOTS === '1';
const ROADMAP_OUTPUT = process.env.ASTERION_QA_ROADMAP_OUTPUT || path.join(ROOT, 'visual-qa', 'full-roadmap');
const ROADMAP = JSON.parse(fs.readFileSync(path.join(ROOT, 'changelog', 'roadmap.json'), 'utf8'));
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

/** Smooth scrolling has come to rest. */
async function scrollRest(win) {
  await waitFor(win, `new Promise((resolve) => {
    const scroller = document.querySelector('[data-qa-roadmap-scroll]');
    const before = scroller.scrollTop;
    setTimeout(() => resolve(Math.abs(scroller.scrollTop - before) < 0.5), 220);
  })`);
  await settle(win);
}

const activeRow = (win) => js(win, `Number(document.activeElement?.getAttribute('data-qa-roadmap-row'))`);

/** Everything on the rail and in the view stays on the panel, readable and apart. */
async function checkRoadmap(win, label, width, height) {
  const facts = await js(win, `(() => {
    const dialog = document.querySelector('[data-qa-whats-new] [role="dialog"]');
    const box = (element) => { const r = element.getBoundingClientRect(); return { left: r.left, top: r.top, right: r.right, bottom: r.bottom }; };
    const panel = box(dialog);
    const scroller = document.querySelector('[data-qa-roadmap-scroll]');
    const labels = [...document.querySelectorAll('.rm-rail__mark span, .rm-rail__plans span')].map((element) => ({ text: element.textContent, ...box(element) }));
    const overlaps = [];
    for (let at = 0; at < labels.length; at += 1) for (let other = at + 1; other < labels.length; other += 1) {
      const a = labels[at]; const b = labels[other];
      if (a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom) overlaps.push(a.text + ' / ' + b.text);
    }
    const texts = [...dialog.querySelectorAll('h2, h3, p, small, b, span')].filter((element) => element.textContent.trim() && !element.closest('svg') && element.getBoundingClientRect().height > 0);
    const heads = [...document.querySelectorAll('[data-qa-roadmap-row]')];
    return {
      panel,
      close: box(document.querySelector('[data-qa-whats-new-close]')),
      rail: box(document.querySelector('[data-qa-roadmap-rail]')),
      labelsOutside: labels.filter((entry) => entry.left < panel.left || entry.right > panel.right).map((entry) => entry.text),
      overlaps,
      sideways: scroller.scrollWidth - scroller.clientWidth,
      titles: dialog.querySelectorAll('[title]').length,
      small: texts.map((element) => ({ text: element.textContent.slice(0, 30), size: parseFloat(getComputedStyle(element).fontSize) })).filter((entry) => entry.size < 11.5),
      rowCut: heads.filter((head) => head.scrollWidth > head.clientWidth + 1).map((head) => head.getAttribute('data-qa-roadmap-row')),
      statsLeft: box(document.querySelector('[data-qa-roadmap-stats]')).left,
      switchRight: box(document.querySelector('.whats-new__switch')).right,
    };
  })()`);
  const where = `roadmap ${label} ${width}x${height}`;
  check(facts.panel.left >= 0 && facts.panel.top >= 0 && facts.panel.right <= width && facts.panel.bottom <= height, `${where}: the panel leaves the screen`, facts.panel);
  check(facts.close.right > facts.panel.right - 60 && facts.close.top < facts.panel.top + 60, `${where}: close is not at the top right`, facts.close);
  check(facts.rail.left >= facts.panel.left && facts.rail.right <= facts.panel.right, `${where}: the rail leaves the panel`, facts.rail);
  check(facts.labelsOutside.length === 0, `${where}: a rail label is cut off`, facts.labelsOutside);
  check(facts.overlaps.length === 0, `${where}: rail labels overlap`, facts.overlaps);
  check(facts.sideways <= 0, `${where}: the story scrolls sideways`, facts.sideways);
  check(facts.titles === 0, `${where}: native tooltips`, facts.titles);
  check(facts.small.length === 0, `${where}: type below 11.5px`, facts.small);
  check(facts.rowCut.length === 0, `${where}: a row is wider than its place`, facts.rowCut);
  check(facts.statsLeft > facts.switchRight, `${where}: the numbers run into the switch`, facts);
}

async function runRoadmap(win, width, height) {
  const directory = path.join(ROADMAP_OUTPUT, `${width}x${height}`);
  fs.mkdirSync(directory, { recursive: true });
  const rows = ROADMAP.prs;
  const closed = rows.filter((pr) => pr.status === 'closed');
  const withDecision = rows.find((pr) => pr.decision && pr.n >= 100);
  const middleEra = ROADMAP.eras[Math.floor(ROADMAP.eras.length / 2)];
  const shipped = rows.filter((pr) => pr.status === 'done').length;
  const days = Math.round((Date.parse(rows[rows.length - 1].date) - Date.parse(rows[0].date)) / 86400000) + 1;

  await js(win, 'localStorage.clear()');
  await openMenu(win);
  const chunkLoaded = `performance.getEntriesByType('resource').some((entry) => /RoadmapView/.test(entry.name))`;
  check(!(await js(win, chunkLoaded)), `${width}: the history loaded with the menu`);
  await click(win, '[data-qa-whats-new-open]');
  await waitFor(win, `document.querySelector('[data-qa-whats-new-tab]')`);
  check(!(await js(win, chunkLoaded)), `${width}: the history loaded with the news`);
  const news = await js(win, `document.querySelector('[data-qa-roadmap-switch="news"]').getAttribute('aria-pressed')`);
  check(news === 'true', `${width}: the dialog must open on the news`, news);

  await click(win, '[data-qa-roadmap-switch="roadmap"]');
  await waitFor(win, `document.querySelector('[data-qa-roadmap-rail]') && document.querySelector('[data-qa-roadmap-stats]')`);
  check(await js(win, chunkLoaded), `${width}: the history has its own file`);
  await settle(win, 900);
  check(await js(win, `document.querySelector('[role="dialog"]').getAttribute('aria-label')`) === 'Весь роадмэп', `${width}: the dialog keeps the old name`);
  const counts = await js(win, `({
    rows: document.querySelectorAll('[data-qa-roadmap-row]').length,
    eras: document.querySelectorAll('[data-qa-roadmap-era]').length,
    jumps: document.querySelectorAll('[data-qa-roadmap-era-jump]').length,
    marks: document.querySelectorAll('[data-qa-roadmap-mark]').length,
    plans: document.querySelectorAll('[data-qa-roadmap-plan]').length,
    notShipped: document.querySelectorAll('.rm-row.is-closed .rm-row__tag').length,
    stats: [...document.querySelectorAll('[data-qa-roadmap-stats] b')].map((element) => Number(element.textContent)),
    scrollTop: document.querySelector('[data-qa-roadmap-scroll]').scrollTop,
  })`);
  check(counts.rows === rows.length, `${width}: rows`, counts);
  check(counts.eras === ROADMAP.eras.length && counts.jumps === ROADMAP.eras.length, `${width}: eras`, counts);
  check(counts.marks === ROADMAP.milestones.length, `${width}: milestones`, counts);
  check(counts.plans === ROADMAP.plans.length, `${width}: plans`, counts);
  check(counts.notShipped === closed.length, `${width}: not shipped rows are not marked`, counts);
  check(counts.stats[0] === shipped && counts.stats[1] === days && counts.stats[2] === ROADMAP.releases.count, `${width}: the numbers at the top`, counts.stats);
  check(counts.scrollTop === 0, `${width}: the story must open at its beginning`, counts);
  await checkRoadmap(win, 'start', width, height);
  await capture(win, directory, '01-start');

  // Jump to an era: the rail moves with it and the chapter stands at the top.
  await click(win, `[data-qa-roadmap-era-jump="${middleEra.id}"]`);
  await scrollRest(win);
  const era = await js(win, `(() => {
    const scroller = document.querySelector('[data-qa-roadmap-scroll]').getBoundingClientRect();
    const section = document.querySelector('[data-qa-roadmap-era="${middleEra.id}"]').getBoundingClientRect();
    return {
      top: section.top - scroller.top,
      on: document.querySelector('.rm-rail__era.is-on')?.getAttribute('data-qa-roadmap-era-jump'),
      story: document.querySelector('[data-qa-roadmap-era="${middleEra.id}"] h3').getBoundingClientRect().top - scroller.top,
    };
  })()`);
  check(Math.abs(era.top) < 40, `${width}: the era did not come to the top`, era);
  check(era.on === middleEra.id, `${width}: the rail does not show the era`, era);
  check(era.story >= 0, `${width}: the chapter title is hidden`, era);
  await checkRoadmap(win, 'era', width, height);
  await capture(win, directory, '02-era');

  // Tooltip on the rail is the game's own.
  const hover = await js(win, `(() => {
    const box = document.querySelector('[data-qa-roadmap-mark]:nth-of-type(n)').getBoundingClientRect();
    return { x: Math.round(box.left), y: Math.round(box.top) };
  })()`);
  win.webContents.sendInputEvent({ type: 'mouseMove', x: hover.x, y: hover.y });
  await settle(win);
  const tipShown = await js(win, `Boolean(document.querySelector('[data-qa-roadmap-tip]'))`);
  check(tipShown, `${width}: no tooltip over a milestone`, hover);
  win.webContents.sendInputEvent({ type: 'mouseMove', x: 2, y: 2 });
  await settle(win);

  // Open a row with an owner's decision.
  await js(win, `document.querySelector('[data-qa-roadmap-row="${withDecision.n}"]').scrollIntoView({ block: 'center' })`);
  await settle(win);
  await click(win, `[data-qa-roadmap-row="${withDecision.n}"]`);
  await scrollRest(win);
  await settle(win, 320);
  const detail = await js(win, `(() => {
    const element = document.querySelector('[data-qa-roadmap-details="${withDecision.n}"]');
    if (!element) return null;
    const box = element.getBoundingClientRect();
    const view = document.querySelector('[data-qa-roadmap-scroll]').getBoundingClientRect();
    return {
      expanded: document.querySelector('[data-qa-roadmap-row="${withDecision.n}"]').getAttribute('aria-expanded'),
      text: element.textContent,
      top: box.top, bottom: box.bottom, viewTop: view.top, viewBottom: view.bottom,
    };
  })()`);
  check(detail?.expanded === 'true', `${width}: the row did not open`, detail);
  check(detail?.text.includes(withDecision.decision), `${width}: the owner's decision is not shown`, detail);
  check(detail?.text.includes(`№${withDecision.n}`), `${width}: the number is not shown`, detail);
  check(detail && detail.top >= detail.viewTop && detail.bottom <= detail.viewBottom, `${width}: the details are not in view`, detail);
  await checkRoadmap(win, 'details', width, height);
  await capture(win, directory, '03-pr-details');
  await click(win, `[data-qa-roadmap-row="${withDecision.n}"]`);
  check(!(await js(win, `Boolean(document.querySelector('[data-qa-roadmap-details="${withDecision.n}"]'))`)), `${width}: the row did not close`);

  // A row that never shipped is said plainly.
  await click(win, `[data-qa-roadmap-row="${closed[0].n}"]`);
  await scrollRest(win);
  await settle(win, 320);
  await capture(win, directory, '04-not-shipped');
  await click(win, `[data-qa-roadmap-row="${closed[0].n}"]`);

  // Keyboard: arrows and Page keys walk the rows, Space opens, Tab stays inside.
  await js(win, `document.querySelector('[data-qa-roadmap-row="${rows[0].n}"]').focus()`);
  await key(win, 'Down');
  check(await activeRow(win) === rows[1].n, `${width}: arrow down did not move to the next row`, await activeRow(win));
  await key(win, 'Up');
  check(await activeRow(win) === rows[0].n, `${width}: arrow up did not move back`, await activeRow(win));
  await key(win, 'PageDown');
  const nextEraRow = rows.find((pr) => pr.era !== rows[0].era);
  check(await activeRow(win) === nextEraRow.n, `${width}: page down did not go to the next chapter`, await activeRow(win));
  await key(win, 'Home');
  check(await activeRow(win) === rows[0].n, `${width}: home did not go to the first row`, await activeRow(win));
  await key(win, 'Space');
  check(await js(win, `document.querySelector('[data-qa-roadmap-row="${rows[0].n}"]').getAttribute('aria-expanded')`) === 'true', `${width}: space did not open the row`);
  await key(win, 'Space');
  for (let at = 0; at < 6; at += 1) await key(win, 'Tab');
  check(await js(win, `Boolean(document.activeElement?.closest('[data-qa-whats-new]'))`), `${width}: focus left the dialog`);
  await js(win, `document.querySelector('[data-qa-roadmap-era-jump]').focus()`);
  await key(win, 'Right');
  await scrollRest(win);
  const second = ROADMAP.eras[1].id;
  check(await js(win, `document.activeElement?.getAttribute('data-qa-roadmap-era-jump')`) === second, `${width}: the rail keys did not move to the next chapter`);
  check(await js(win, `document.querySelector('.rm-rail__era.is-on')?.getAttribute('data-qa-roadmap-era-jump')`) === second, `${width}: the view did not follow the rail keys`);

  // The plans close the story.
  await click(win, '[data-qa-roadmap-plans-jump]');
  await scrollRest(win);
  const plans = await js(win, `(() => {
    const view = document.querySelector('[data-qa-roadmap-scroll]').getBoundingClientRect();
    const title = document.querySelector('#roadmap-plans').getBoundingClientRect();
    return { top: title.top, viewTop: view.top, viewBottom: view.bottom, mark: document.querySelector('.rm-rail__plans').classList.contains('is-on'), note: document.querySelector('[data-qa-roadmap-plans]').textContent };
  })()`);
  check(plans.top >= plans.viewTop && plans.top < plans.viewBottom, `${width}: «Дальше» is not in view`, plans);
  check(plans.mark, `${width}: the rail does not show the plans`, plans);
  check(plans.note.includes('ПЛАНЫ, А НЕ ОБЕЩАНИЯ'), `${width}: plans are not marked as plans`, plans.note);
  await checkRoadmap(win, 'plans', width, height);
  await capture(win, directory, '05-plans');
  await js(win, `document.querySelector('[data-qa-roadmap-scroll]').scrollTo({ top: 1e7 })`);
  await scrollRest(win);
  await capture(win, directory, '06-end');
  check((await js(win, `document.querySelector('[data-qa-roadmap-end]').textContent`)).includes(`№${ROADMAP.refresh.nextAt}`), `${width}: the end does not name the next refresh`);

  // Scrolling the whole story stays cheap: reported, not gated (software rendering in QA).
  const frames = await js(win, `new Promise((resolve) => {
    const scroller = document.querySelector('[data-qa-roadmap-scroll]');
    const times = [];
    let at = 0;
    const step = (now) => {
      times.push(now);
      scroller.scrollTop = (at / 60) * scroller.scrollHeight;
      at += 1;
      if (at <= 60) requestAnimationFrame(step); else resolve(times);
    };
    requestAnimationFrame(step);
  })`);
  const gaps = frames.slice(1).map((time, at) => time - frames[at]).sort((left, right) => left - right);
  console.log(`[whats-new-qa] ${width}: story scroll, frame median ${gaps[gaps.length >> 1].toFixed(1)} ms, worst ${gaps[gaps.length - 1].toFixed(1)} ms`);

  // Back to the news, then Esc closes the dialog.
  await click(win, '[data-qa-roadmap-switch="news"]');
  await waitFor(win, `document.querySelector('[data-qa-whats-new-tab]')`);
  check(!(await js(win, `Boolean(document.querySelector('[data-qa-roadmap-stats]'))`)), `${width}: the numbers stayed on the news`);
  await checkDialog(win, 'after roadmap', width, height);
  await click(win, '[data-qa-roadmap-switch="roadmap"]');
  await waitFor(win, `document.querySelector('[data-qa-roadmap-rail]')`);
  await key(win, 'Escape');
  check(!(await js(win, `Boolean(document.querySelector('[data-qa-whats-new]'))`)), `${width}: Esc did not close the roadmap`);

  // Reduced motion: nothing plays, jumps are instant.
  await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  await click(win, '[data-qa-whats-new-open]');
  await click(win, '[data-qa-roadmap-switch="roadmap"]');
  await waitFor(win, `document.querySelector('[data-qa-roadmap-rail]')`);
  await settle(win);
  const moving = await js(win, `document.getAnimations().filter((animation) => animation.playState === 'running' && animation.effect?.target?.closest?.('.rm')).length`);
  check(moving === 0, `${width}: animations run with reduced motion`, moving);
  await js(win, `document.querySelector('[data-qa-roadmap-plans-jump]').click()`);
  await settle(win);
  check(await js(win, `document.querySelector('[data-qa-roadmap-scroll]').scrollTop > 0`), `${width}: the jump is not instant with reduced motion`);
  await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [] });
  await click(win, '[data-qa-whats-new-close]');
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
  // A click outside the panel is a real mouse press: it closes only the dialog, the game stays paused.
  await click(win, '[data-qa-pause="whats-new"]');
  await waitFor(win, `document.querySelector('[data-qa-whats-new]')`);
  check(await js(win, `document.elementFromPoint(4, 4)?.hasAttribute('data-qa-whats-new')`), `${width}: the corner is not outside the panel`);
  win.webContents.sendInputEvent({ type: 'mouseDown', x: 4, y: 4, button: 'left', clickCount: 1 });
  win.webContents.sendInputEvent({ type: 'mouseUp', x: 4, y: 4, button: 'left', clickCount: 1 });
  await settle(win);
  check(!(await js(win, `Boolean(document.querySelector('[data-qa-whats-new]'))`)), `${width}: a click outside did not close the dialog over the pause menu`);
  check(await js(win, `Boolean(document.querySelector('[data-qa-pause-menu]'))`), `${width}: a click outside closed the pause menu along with the dialog`);
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
      await runRoadmap(win, width, height);
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
