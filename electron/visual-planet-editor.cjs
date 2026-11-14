// «Редактировать планету» (14.11.2026): frames of the editor and of every place that shows the
// planet's look, at 1280×720 and 1920×1080. Worst cases: a 28-character planet name, the
// biggest rubric on its second page, alliance looks locked for a non-leader, and a leader who
// hands the lead over (the alliance look hides behind «Колония»).
// Also measures what opening the editor loads: the old editor pulled every full-size picture
// (about 30 MB of PNG), the new one only the small thumbnails of one page.
// On a build without the new editor (main) it still records the first frame, as «before».
// ASTERION_QA_CHECKS=0 records the numbers without failing.
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');
const { waitForCommands, patchSaveIdle } = require('./qa-save-edit.cjs');

app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-gpu');
app.on('window-all-closed', () => {});

const ROOT = path.join(__dirname, '..');
const OUTPUT = process.env.ASTERION_QA_OUTPUT || path.join(ROOT, 'visual-qa', 'planet-editor');
const CHECKS = process.env.ASTERION_QA_CHECKS !== '0';
const VIEWPORTS = [[1280, 720], [1920, 1080]];
const SAVE_KEY = 'asterion.vertical-slice.test.v1';
const LONG_NAME = 'Новая Александрия-Кентавр 9';
const ALLIANCE_LOOK = 'ally-crown';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const run = (win, code) => win.webContents.executeJavaScript(code);

async function waitFor(win, expression, timeoutMs = 30000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await run(win, `Boolean(${expression})`)) return;
    await sleep(80);
  }
  throw new Error(`Timed out waiting for: ${expression}`);
}
async function settle(win, ms = 300) {
  await run(win, 'new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))');
  await sleep(ms);
}
async function capture(win, directory, name) {
  await run(win, `document.getAnimations().forEach((a) => { const t = a.effect?.getComputedTiming?.(); if (t && Number.isFinite(t.endTime)) a.currentTime = t.endTime; })`);
  await run(win, `Promise.all(Array.from(document.images).filter((img) => img.getClientRects().length && !img.complete).map((img) => img.decode().catch(() => null)))`);
  await settle(win, 200);
  const result = await win.webContents.debugger.sendCommand('Page.captureScreenshot', { format: 'jpeg', quality: 86, fromSurface: true });
  fs.writeFileSync(path.join(directory, `${name}.jpg`), Buffer.from(result.data, 'base64'));
}
function brokenImages(win) {
  return run(win, `Promise.all(Array.from(document.images).filter((img) => img.getClientRects().length).map((img) => img.decode().then(() => null, () => img.getAttribute('src'))))
    .then((list) => [...new Set(list.filter(Boolean))])`);
}
async function route(win, id) {
  await run(win, `document.querySelector('[data-qa-navigation="primary"] [data-qa-route="${id}"]')?.click()`);
  await settle(win, 500);
}
async function planetScreen(win) {
  await route(win, 'planet');
  await run(win, `document.querySelector('[data-qa-planet-section="current"]')?.click()`);
  await settle(win, 300);
}
async function openEditor(win) {
  await planetScreen(win);
  await waitFor(win, `document.querySelector('.owned-planet-edit-v4')`);
  await run(win, `document.querySelector('.owned-planet-edit-v4')?.click()`);
  await waitFor(win, `document.querySelector('.skin-picker-modal')`);
  await settle(win, 600);
}
async function closeEditor(win) {
  await run(win, `document.querySelector('.skin-picker-modal [data-asterion-close]')?.click()`);
  await waitFor(win, `!document.querySelector('.skin-picker-modal')`);
  await settle(win, 200);
}
const clickQa = (win, selector) => run(win, `document.querySelector(${JSON.stringify(selector)})?.click()`);
const metrics = () => `(() => {
  const entries = performance.getEntriesByType('resource').filter((e) => /\\.(png|webp|jpe?g)(\\?|$)/i.test(e.name));
  return { requests: entries.length, kilobytes: Math.round(entries.reduce((sum, e) => sum + (e.transferSize || e.encodedBodySize || 0), 0) / 1024) };
})()`;
/** Alliance seat: 'leader' makes the player lead their alliance, 'member' hands the lead to another member. */
const allianceEdit = (seat, skin) => `(save) => {
  const playerId = save.profile?.playerId;
  const command = save.command;
  let own = command.alliances.find((alliance) => (alliance.members || []).some((member) => member.ownerId === playerId));
  if (!own) throw new Error('test save: the player has no alliance');
  if (own.members.length < 2) own.members.push({ ...own.members[0], ownerId: 'qa-ally-1', displayName: 'Союзник' });
  const other = own.members.find((member) => member.ownerId !== playerId).ownerId;
  own.leaderOwnerId = ${JSON.stringify(seat)} === 'leader' ? playerId : other;
  if (own.deputyOwnerId === own.leaderOwnerId || own.deputyOwnerId === playerId) own.deputyOwnerId = null;
  ${skin ? `save.planets['helion-01'].skin = ${JSON.stringify(skin)};` : ''}
}`;

app.whenReady().then(async () => {
  let win;
  const failures = [];
  const shots = [];
  const numbers = {};
  try {
    win = new BrowserWindow({ width: 1280, height: 720, show: false, backgroundColor: '#02050a',
      webPreferences: { offscreen: true, contextIsolation: true, nodeIntegration: false, sandbox: true, partition: 'qa-planet-editor' } });
    await win.loadFile(path.join(ROOT, 'dist', 'index.html'), { search: '?mode=test' });
    await waitFor(win, `document.querySelector('[data-qa-navigation="primary"]') && localStorage.getItem(${JSON.stringify(SAVE_KEY)})`);
    await waitForCommands(win);
    await run(win, 'document.fonts?.ready');
    // A non-leader first: the alliance looks must show locked.
    await patchSaveIdle(win, SAVE_KEY, allianceEdit('member'), { label: 'player is a member' });
    win.webContents.debugger.attach('1.3');
    const setSize = async (width, height) => {
      await win.webContents.debugger.sendCommand('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false, screenWidth: width, screenHeight: height });
      await settle(win, 400);
    };

    // What opening the editor loads, on a fresh page (nothing cached).
    await setSize(1280, 720);
    await route(win, 'planet');
    await run(win, 'performance.clearResourceTimings()');
    const openedAt = Date.now();
    await openEditor(win);
    await run(win, `Promise.all(Array.from(document.querySelectorAll('.skin-picker-modal img')).map((img) => img.decode().catch(() => null)))`);
    numbers.openMs = Date.now() - openedAt;
    numbers.openLoads = await run(win, metrics());
    numbers.editorImages = await run(win, `document.querySelectorAll('.skin-picker-modal img').length`);
    const isNew = await run(win, `Boolean(document.querySelector('.planet-editor-v6'))`);
    numbers.newEditor = isNew;
    await closeEditor(win);

    for (const [width, height] of VIEWPORTS) {
      const size = `${width}x${height}`;
      const directory = path.join(OUTPUT, size);
      fs.mkdirSync(directory, { recursive: true });
      await setSize(width, height);
      const step = async (name, action) => {
        try {
          await action();
          const broken = await brokenImages(win);
          if (broken.length) failures.push({ size, name, broken });
          await capture(win, directory, name);
          shots.push(`${size}/${name}`);
        } catch (error) {
          failures.push({ size, name, error: String(error?.message || error) });
        }
      };
      await step('01-editor-open', () => openEditor(win));
      if (!isNew) { await closeEditor(win); continue; }
      await step('02-worlds-page-2', async () => {
        await clickQa(win, '.planet-editor-v6 [data-qa-skin-group="worlds"]');
        await settle(win, 200);
        await clickQa(win, '.planet-editor-v6 .pe-pager [aria-label="Страница 2"]');
        await settle(win, 300);
        const cards = await run(win, `document.querySelectorAll('.planet-editor-v6 .pe-card').length`);
        if (cards < 1) throw new Error('worlds page 2 is empty');
      });
      await step('03-rare-exotic', async () => {
        await clickQa(win, '.planet-editor-v6 [data-qa-skin-group="exotic"]');
        await settle(win, 200);
        await clickQa(win, '.planet-editor-v6 [data-qa-planet-skin="ps-plasma"]');
        await settle(win, 400);
      });
      await step('04-alliance-locked', async () => {
        await clickQa(win, '.planet-editor-v6 [data-qa-skin-group="alliance"]');
        await settle(win, 200);
        await clickQa(win, `.planet-editor-v6 [data-qa-planet-skin="${ALLIANCE_LOOK}"]`);
        await waitFor(win, `document.querySelector('.planet-editor-v6 [data-qa-skin-lock]') && document.querySelector('.planet-editor-v6 .pe-apply').disabled`);
        const locked = await run(win, `document.querySelectorAll('.planet-editor-v6 [data-state="locked"]').length`);
        if (locked < 6) throw new Error(`only ${locked} alliance looks are locked for a non-leader`);
      });
      await step('05-long-name', async () => {
        await run(win, `(() => {
          const input = document.querySelector('#planet-name-input');
          const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
          setter.call(input, ${JSON.stringify(LONG_NAME)});
          input.dispatchEvent(new Event('input', { bubbles: true }));
          input.form.requestSubmit();
        })()`);
        await waitFor(win, `document.querySelector('.planet-editor-v6 .pe-head-title h2')?.textContent === ${JSON.stringify(LONG_NAME)}`);
        await clickQa(win, '.planet-editor-v6 [data-qa-skin-group="classic"]');
        await settle(win, 300);
        const overflow = await run(win, `(() => { const m = document.querySelector('.planet-editor-v6'); return m.scrollWidth > m.clientWidth + 1; })()`);
        if (overflow) throw new Error('the long name pushes the editor wider than its frame');
      });
      await closeEditor(win);
    }

    if (isNew) {
      // The leader picks an alliance look; then every place that shows the planet.
      await patchSaveIdle(win, SAVE_KEY, allianceEdit('leader'), { label: 'player leads the alliance' });
      for (const [width, height] of VIEWPORTS) {
        const size = `${width}x${height}`;
        const directory = path.join(OUTPUT, size);
        await setSize(width, height);
        const step = async (name, action) => {
          try {
            await action();
            const broken = await brokenImages(win);
            if (broken.length) failures.push({ size, name, broken });
            await capture(win, directory, name);
            shots.push(`${size}/${name}`);
          } catch (error) {
            failures.push({ size, name, error: String(error?.message || error) });
          }
        };
        await step('06-leader-picks', async () => {
          await openEditor(win);
          await clickQa(win, '.planet-editor-v6 [data-qa-skin-group="alliance"]');
          await settle(win, 200);
          await clickQa(win, `.planet-editor-v6 [data-qa-planet-skin="${ALLIANCE_LOOK}"]`);
          await waitFor(win, `document.querySelector('.planet-editor-v6 [data-qa-skin-apply]') || document.querySelector('.planet-editor-v6 .pe-apply.is-done')`);
          await clickQa(win, '.planet-editor-v6 [data-qa-skin-apply]');
          await waitFor(win, `JSON.parse(localStorage.getItem(${JSON.stringify(SAVE_KEY)}) || '{}').planets?.['helion-01']?.skin === ${JSON.stringify(ALLIANCE_LOOK)}`);
          await settle(win, 300);
        });
        await closeEditor(win);
        await step('07-header-and-planet', async () => {
          await planetScreen(win);
          await waitFor(win, `document.querySelector('[data-qa-planet-skin-art]')?.getAttribute('src')?.includes(${JSON.stringify(ALLIANCE_LOOK)})`);
        });
        await step('08-universe', async () => {
          await route(win, 'universe');
          await waitFor(win, `document.querySelector('[data-qa-universe-object="player-planet-helion-01"] img')?.getAttribute('src')?.includes(${JSON.stringify(ALLIANCE_LOOK)})`, 20000);
        });
        await step('09-empire', async () => {
          await route(win, 'planet');
          await run(win, `document.querySelector('[data-qa-planet-section="empire"]')?.click()`);
          await settle(win, 600);
          const shown = await run(win, `Array.from(document.querySelectorAll('.empire-lane__planet img')).some((img) => img.getAttribute('src')?.includes(${JSON.stringify(ALLIANCE_LOOK)}))`);
          if (!shown) throw new Error('Empire does not show the alliance look');
        });
      }
      // Hands the lead over: the planet shows «Колония», the editor explains why.
      await patchSaveIdle(win, SAVE_KEY, allianceEdit('member'), { label: 'player hands the lead over' });
      for (const [width, height] of VIEWPORTS) {
        const size = `${width}x${height}`;
        const directory = path.join(OUTPUT, size);
        await setSize(width, height);
        try {
          await planetScreen(win);
          await waitFor(win, `document.querySelector('[data-qa-planet-skin-art]')?.getAttribute('src')?.includes('colonized')`);
          await capture(win, directory, '10-lead-lost-planet');
          await openEditor(win);
          await waitFor(win, `document.querySelector('.planet-editor-v6 .pe-note')`);
          await capture(win, directory, '11-lead-lost-editor');
          shots.push(`${size}/10-lead-lost-planet`, `${size}/11-lead-lost-editor`);
          await closeEditor(win);
        } catch (error) {
          failures.push({ size, name: '10-lead-lost', error: String(error?.message || error) });
        }
      }
      // The old editor loaded every full picture at once; the new one only one page of thumbnails.
      if (numbers.editorImages > 17) failures.push({ name: 'open', error: `editor holds ${numbers.editorImages} images` });
      if (numbers.openLoads.kilobytes > 1500) failures.push({ name: 'open', error: `opening the editor loaded ${numbers.openLoads.kilobytes} KB of pictures` });
    }
    fs.mkdirSync(OUTPUT, { recursive: true });
    fs.writeFileSync(path.join(OUTPUT, 'metrics.json'), JSON.stringify({ numbers, shots, failures }, null, 2));
    console.log(JSON.stringify({ numbers, shots, failures }, null, 2));
    win.webContents.debugger.detach();
    win.destroy();
    app.exit(CHECKS && failures.length ? 1 : 0);
  } catch (error) {
    console.error(error);
    win?.destroy();
    app.exit(1);
  }
});
