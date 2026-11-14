// Big planet on «Орбита» (14.11.2026): one screenshot per look at 1920×1080.
// Shots: terran (old), volcanic (old), fan-cube («Фантазия», new), each twice:
// «before» = the 512 px picture (the 1024 loader is switched off by a QA flag in
// localStorage), «after» = the 1024 px picture the game now shows.
// Output: qa-frames/planet-skins/ (uploaded as a CI artifact).
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');
const { patchSaveIdle } = require('./qa-save-edit.cjs');
const { PARSE_SAVE } = require('./qa-save.cjs');

app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-gpu');
app.on('window-all-closed', () => {});

const ROOT = path.join(__dirname, '..');
// qa-frames/ is uploaded as a CI artifact by every Electron shard.
const OUTPUT = process.env.ASTERION_QA_OUTPUT || path.join(ROOT, 'qa-frames', 'planet-skins');
const SAVE_KEY = 'asterion.vertical-slice.test.v1';
const SKINS = ['terran', 'volcanic', 'fan-cube'];
// «before» = the 512 px pictures (loader switched off), «after» = the 1024 px pictures.
const PASSES = [['before', false], ['after', true]];
const VIEWPORTS = [[1920, 1080], [1280, 720]];
// Zone plates keep at least this distance from the planet's visible part (coordinator rule, 14.11.2026).
const MIN_PLATE_GAP = 16;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(win, expression, timeoutMs = 15000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await win.webContents.executeJavaScript(`Boolean(${expression})`)) return;
    await sleep(50);
  }
  throw new Error(`Timed out waiting for: ${expression}`);
}

async function settle(win, ms = 120) {
  await win.webContents.executeJavaScript('new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
  await sleep(ms);
}

async function click(win, selector) {
  const clicked = await win.webContents.executeJavaScript(`(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    if (!element || element.disabled) return false;
    element.click();
    return true;
  })()`);
  if (!clicked) throw new Error(`Element not found/enabled: ${selector}`);
  await settle(win, 250);
}

/** Seeds the home planet's look, with the game idle first (see visual-planet-screens.cjs). */
async function seed(win, skin, large) {
  const edit = `(save) => {
    const home = save?.planets?.['helion-01'];
    if (!home) throw new Error('planet skins seed: no home planet in the save');
    home.skin = ${JSON.stringify(skin)};
    save.currentPlanetId = 'helion-01';
    localStorage.setItem('asterion.test-time-scale.v1', '1');
    localStorage.setItem('asterion.qa.planet-large', ${JSON.stringify(large ? '1' : '0')});
    localStorage.setItem('asterion.qa.planet-skins-seed', JSON.stringify({ skin: ${JSON.stringify(skin)} }));
  }`;
  const held = `(() => {
    const expected = JSON.parse(localStorage.getItem('asterion.qa.planet-skins-seed') || 'null');
    const save = (${PARSE_SAVE})(localStorage.getItem(${JSON.stringify(SAVE_KEY)}) || '{}');
    return Boolean(expected) && save.planets?.['helion-01']?.skin === expected.skin
      && Boolean(document.querySelector('[data-qa-navigation="utility"]'));
  })()`;
  await patchSaveIdle(win, SAVE_KEY, edit, { label: `planet skins seed (${skin})`, held, timeoutMs: 60_000 });
  await win.webContents.executeJavaScript('document.fonts?.ready');
  await settle(win, 400);
}

/** Per look (src/planet-skin-large.generated.ts): the «after» CSS scale and the visible box (half sizes, shares of the side). */
function lookTables() {
  const text = fs.readFileSync(path.join(ROOT, 'src', 'planet-skin-large.generated.ts'), 'utf8');
  const scales = Object.fromEntries([...text.matchAll(/'([^']+)': ([\d.]+),\n/g)].map((m) => [m[1], Number(m[2])]));
  const boxes = Object.fromEntries([...text.matchAll(/'([^']+)': \[([\d.]+), ([\d.]+)\],/g)].map((m) => [m[1], [Number(m[2]), Number(m[3])]]));
  return { scales, boxes };
}

/**
 * Zone plates against the planet's visible part (the alpha box of the picture on screen).
 * gap = the larger of the horizontal and vertical distances between the plate and the box
 * (negative = the plate sits over the box). Also: plates over the side columns, plates off the screen.
 * `box` = [half width, half height] as shares of the picture side, or null for the «before» pass.
 */
function zoneCover(win, box) {
  return win.webContents.executeJavaScript(`(() => {
    const img = document.querySelector('img[data-qa-planet-skin-art]').getBoundingClientRect();
    const cx = img.left + img.width / 2, cy = img.top + img.height / 2;
    const hw = ${box ? `img.width * ${box[0]}` : 'null'}, hh = ${box ? `img.height * ${box[1]}` : 'null'};
    const cols = ['.planet-orbit__side', '.planet-orbit__worlds'].map((s) => document.querySelector(s)?.getBoundingClientRect()).filter(Boolean);
    const overlap = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
    const plates = Array.from(document.querySelectorAll('.planet-orbit__zone')).map((zone) => {
      const plate = zone.getBoundingClientRect();
      const gap = hw === null ? null : Math.round(Math.max(
        Math.max(plate.left - (cx + hw), (cx - hw) - plate.right),
        Math.max(plate.top - (cy + hh), (cy - hh) - plate.bottom)));
      return {
        name: zone.textContent.trim().slice(0, 30),
        gap,
        overColumn: cols.some((col) => overlap(plate, col)),
        offScreen: plate.left < 0 || plate.top < 0 || plate.right > innerWidth || plate.bottom > innerHeight,
      };
    });
    return { planet: { left: Math.round(cx - img.width / 2), right: Math.round(cx + img.width / 2), diameter: Math.round(img.width) }, plates };
  })()`);
}

async function capture(win, file) {
  await win.webContents.executeJavaScript(`document.getAnimations().forEach((animation) => {
    const timing = animation.effect?.getComputedTiming?.();
    if (timing && Number.isFinite(timing.endTime)) animation.currentTime = timing.endTime;
  })`);
  await settle(win, 80);
  const result = await win.webContents.debugger.sendCommand('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: false });
  fs.writeFileSync(file, Buffer.from(result.data, 'base64'));
}

app.whenReady().then(async () => {
  let win;
  try {
    fs.mkdirSync(OUTPUT, { recursive: true });
    win = new BrowserWindow({
      width: 1920,
      height: 1080,
      show: false,
      backgroundColor: '#02050a',
      webPreferences: { offscreen: true, contextIsolation: true, nodeIntegration: false, sandbox: true, partition: 'qa-planet-skins' },
    });
    await win.loadFile(path.join(ROOT, 'dist', 'index.html'), { search: '?mode=test' });
    await waitFor(win, `document.querySelector('[data-qa-navigation="utility"]')`, 20000);
    win.webContents.debugger.attach('1.3');
    fs.mkdirSync(OUTPUT, { recursive: true });
    const report = {};
    const failures = [];
    const { boxes } = lookTables();
    for (const [width, height] of VIEWPORTS) {
      await win.webContents.debugger.sendCommand('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false, screenWidth: width, screenHeight: height });
      for (const [pass, large] of PASSES) {
        for (const skin of SKINS) {
          const key = `${width}x${height}:${pass}:${skin}`;
          await seed(win, skin, large);
          await click(win, '[data-qa-route="planet"]');
          if (await win.webContents.executeJavaScript(`Boolean(document.querySelector('[data-qa-planet-section="current"]'))`)) await click(win, '[data-qa-planet-section="current"]');
          await waitFor(win, `document.querySelector('[data-qa-planet-orbit]')`);
          await waitFor(win, `(() => { const img = document.querySelector('img[data-qa-planet-skin-art]'); return Boolean(img && img.complete && img.naturalWidth > 0); })()`);
          await settle(win, 1200);
          const image = await win.webContents.executeJavaScript(`(() => { const img = document.querySelector('img[data-qa-planet-skin-art]'); return { naturalWidth: img.naturalWidth, shownWidth: Math.round(img.getBoundingClientRect().width) }; })()`);
          // The «before» pass shows the old 512 px art with the old plates: recorded, not gated.
          const cover = await zoneCover(win, pass === 'after' ? boxes[skin] : null);
          report[key] = { ...image, ...cover };
          if (pass === 'after') {
            for (const plate of cover.plates) {
              if (plate.gap < MIN_PLATE_GAP) failures.push(`${key}: «${plate.name}» gap ${plate.gap} px`);
              if (plate.overColumn) failures.push(`${key}: «${plate.name}» over a side column`);
              if (plate.offScreen) failures.push(`${key}: «${plate.name}» off the screen`);
            }
          }
          await capture(win, path.join(OUTPUT, `${skin}-${pass}-${width}x${height}.png`));
        }
      }
    }
    fs.writeFileSync(path.join(OUTPUT, 'planet-skins-metrics.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
    if (failures.length) throw new Error(`zone plates break the rule (gap ${MIN_PLATE_GAP} px, no side columns, on screen):\n${failures.join('\n')}`);
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
