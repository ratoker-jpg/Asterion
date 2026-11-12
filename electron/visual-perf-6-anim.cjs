// Perf PR 6 (GPU-only animations): before/after frames of every endless animation it changes.
// Runs the built game with motion ON (CI Windows reports reduced motion), freezes every endless animation
// at the same phase of its cycle (0, 1/4, 1/2), finishes every one-shot one, and screenshots the element.
// The same script runs on main («before») and on the PR branch («after»), so the frames match moment for
// moment. Real screens where the markup is the game's own (orbit rings, map shield dome, a building under
// construction, the header); the same injected fragment in both runs for states a fresh test game does not
// reach (incoming attack, recycling ready, queued stripes, flight plan pick, alarm, «НОВОЕ», atlas online).
// Also records, per state, the running animations and the properties they move that the GPU cannot.
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');
const { patchSaveIdle } = require('./qa-save-edit.cjs');
const { PARSE_SAVE } = require('./qa-save.cjs');

// Software raster like the other visual QA scripts: the same pixels on every runner.
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-gpu');
app.on('window-all-closed', () => {});

const ROOT = path.join(__dirname, '..');
const OUTPUT = process.env.ASTERION_QA_OUTPUT || path.join(ROOT, 'visual-qa', 'perf-6', 'run');
const SAVE_KEY = 'asterion.vertical-slice.test.v1';
const VIEWPORTS = [[1280, 720], [2560, 1080]];
const PHASES = [0, 0.25, 0.5];
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(win, expression, timeoutMs = 15000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await win.webContents.executeJavaScript(`Boolean(${expression})`)) return;
    await sleep(60);
  }
  throw new Error(`Timed out waiting for: ${expression}`);
}
const js = (win, code) => win.webContents.executeJavaScript(code);
const settle = async (win, ms = 150) => { await js(win, 'new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))'); await sleep(ms); };

/** Every one-shot animation to its end; every endless one paused at `phase` of its cycle (after its delay). */
async function freeze(win, phase) {
  await js(win, `document.getAnimations().forEach((animation) => {
    const timing = animation.effect?.getComputedTiming?.();
    if (!timing) return;
    animation.pause();
    if (Number.isFinite(timing.endTime)) { animation.currentTime = timing.endTime; return; }
    const t = animation.effect.getTiming();
    animation.currentTime = (Number(t.delay) || 0) + ${phase} * Number(timing.duration);
  })`);
  await settle(win, 120);
}
const resume = (win) => js(win, `document.getAnimations().forEach((a) => { if (a.effect?.getComputedTiming?.().endTime === Infinity) a.play(); })`);

/** Animations running on the page that move something the GPU cannot (main thread every frame). */
const MAIN_THREAD = `(() => {
  const gpu = new Set(['transform', 'opacity', 'translate', 'rotate', 'scale', 'offset', 'easing', 'composite', 'computedOffset']);
  const out = {};
  for (const animation of document.getAnimations()) {
    if (animation.effect?.getComputedTiming?.().endTime !== Infinity) continue;
    const props = new Set();
    try { for (const frame of animation.effect.getKeyframes()) for (const key of Object.keys(frame)) if (!gpu.has(key)) props.add(key); } catch {}
    const target = animation.effect.target;
    const name = (animation.animationName || '?') + ' @ ' + (target?.className && typeof target.className === 'string' ? target.className.split(' ')[0] : target?.tagName?.toLowerCase()) + (animation.effect.pseudoElement || '');
    out[name] = props.size ? [...props].join(',') : 'gpu';
  }
  return out;
})()`;

async function shoot(win, file, selector, pad = 36) {
  const rect = selector ? await js(win, `(() => { const n = document.querySelector(${JSON.stringify(selector)}); if (!n) return null; const r = n.getBoundingClientRect(); return { x: r.left, y: r.top, width: r.width, height: r.height }; })()`) : null;
  if (selector && !rect) throw new Error(`No element for ${selector}`);
  const clip = rect ? { x: Math.max(0, rect.x - pad), y: Math.max(0, rect.y - pad), width: rect.width + pad * 2, height: rect.height + pad * 2, scale: 1 } : undefined;
  const result = await win.webContents.debugger.sendCommand('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: false, ...(clip ? { clip } : {}) });
  fs.writeFileSync(file, Buffer.from(result.data, 'base64'));
}

async function click(win, selector) {
  const ok = await js(win, `(() => { const n = document.querySelector(${JSON.stringify(selector)}); if (!n || n.disabled) return false; n.click(); return true; })()`);
  if (!ok) throw new Error(`Cannot click ${selector}`);
  await settle(win, 300);
}

/** A resource building under construction on the home planet (real ZoneView markup). */
async function seed(win) {
  const edit = `(save) => {
    const home = save?.planets?.['helion-01'];
    if (!home?.buildings) throw new Error('perf-6 seed: no home planet');
    const now = Date.now();
    const level = (home.buildings['metal-production-1'] ?? 0) + 1;
    save.queues = { ...(save.queues || {}), 'helion-01': [{ id: 'qa-perf6', planetId: 'helion-01', assetRole: 'metal-production-1', targetLevel: level,
      cost: { metal: 0, minerals: 0, gas: 0, energy: 0 }, enqueuedAt: now, startedAt: now, finishAt: now + 6 * 3600_000 }] };
    localStorage.setItem('asterion.test-time-scale.v1', '1');
  }`;
  const held = `(() => { try { const save = (${PARSE_SAVE})(localStorage.getItem(${JSON.stringify(SAVE_KEY)}) || '{}'); return (save.queues?.['helion-01'] || []).some((q) => q.id === 'qa-perf6') && Boolean(document.querySelector('[data-qa-navigation="utility"]')); } catch { return false; } })()`;
  await patchSaveIdle(win, SAVE_KEY, edit, { label: 'perf-6 seed', held, timeoutMs: 60_000 });
  await js(win, 'document.fonts?.ready');
  await settle(win, 500);
}

const FRAGMENTS = `
    <div id="p6-incoming" class="fleet-root-v2 has-incoming" style="width:560px;height:180px;padding:24px">
      <div class="fleet-incoming-alert-v2" role="alert"><b aria-hidden="true">⚠</b><div><strong>ВХОДЯЩАЯ АТАКА</strong><span>Отступники → 1:2:3 · прибытие через 04:12</span></div><button type="button">ПОКАЗАТЬ РЕЙС</button></div>
    </div>
    <div id="p6-recycling" class="recycling-center-view" style="position:relative;display:flex;gap:48px;align-items:center;padding:24px;width:520px">
      <button type="button" class="rc-start is-ready" style="width:260px">ЗАПУСТИТЬ</button>
      <div class="rc-slot is-ready" style="display:grid;place-items:center;gap:8px"><div class="rc-ring" style="--rc-progress:100"><span>✓</span></div><b>Готово</b></div>
    </div>
    <div id="p6-bots" class="production-bots-view" style="position:relative;padding:24px"><button type="button" class="production-bots-distribute">РАСПРЕДЕЛИТЬ</button></div>
    <div id="p6-stripes" style="display:grid;gap:24px;padding:24px;width:420px">
      <div class="spaceport-level-segments-v2"><i class="is-complete"></i><i class="is-complete"></i><i class="is-complete"></i><i class="is-queued"></i><i class="is-queued"></i><i></i><i></i></div>
      <div class="bplan-tile__bar"><i class="is-here" style="--from:0;--share:.42"></i><i class="is-queued" style="--from:.42;--share:.33"></i></div>
    </div>
    <div id="p6-briefing" class="flight-briefing-v2" style="position:relative;width:300px;height:300px"><div class="fa-route__pick" style="left:35px;top:35px">Выберите<br>цель</div></div>
    <div id="p6-alarm" class="opsA" style="width:420px;padding:24px"><button type="button" class="srp-alert"><span style="width:42px;height:42px;border-radius:8px;background:#3a1a22;display:block"></span><span><b>Солнце атакуют</b><small>Рейд на 1:5 · через 12:30</small></span></button></div>
    <div id="p6-new" style="padding:24px"><button type="button" class="igo-btn whats-new-entry is-new">Что нового<span class="whats-new-mark">НОВОЕ</span></button></div>
    <div id="p6-atlas" style="padding:24px"><em class="star-atlas__presence is-online"><i></i>в сети</em></div>`;
/** One fragment at a time over the workspace (top-left, so it is always inside the visible area). */
const stageOne = (id) => `(() => {
  document.getElementById('p6-stage')?.remove();
  const host = document.querySelector('.workspace') || document.body;
  const stage = document.createElement('div');
  stage.id = 'p6-stage';
  stage.style.cssText = 'position:absolute;inset:0;z-index:9999;background:#050c12;padding:48px;overflow:hidden';
  const box = document.createElement('div');
  box.innerHTML = ${JSON.stringify(FRAGMENTS)};
  const fragment = box.querySelector('#' + ${JSON.stringify(id)});
  if (!fragment) return false;
  stage.appendChild(fragment);
  host.appendChild(stage);
  return Boolean(fragment);
})()`;

async function runViewport(win, dir, report) {
  const shots = [];
  const take = async (name, selector, pad) => {
    report[name] = await js(win, MAIN_THREAD);
    for (const phase of PHASES) {
      await freeze(win, phase);
      const file = path.join(dir, `${name}-p${String(phase * 100).padStart(2, '0')}.png`);
      await shoot(win, file, selector, pad);
      shots.push(file);
    }
    await resume(win);
  };

  // «Планета»: orbit rings (full frame), header with a critical storage pulse and a fleets alarm.
  await click(win, '[data-qa-route="planet"]');
  if (await js(win, `Boolean(document.querySelector('[data-qa-planet-section="current"]'))`)) await click(win, '[data-qa-planet-section="current"]');
  await waitFor(win, `document.querySelector('[data-qa-planet-orbit]')`);
  await sleep(2200);
  await js(win, `(() => {
    const chip = document.querySelector('.asterion-header__resource');
    chip?.classList.add('is-pulsing');
    const fill = chip?.querySelector('.asterion-header__resource-fill');
    if (fill) { fill.className = fill.className.replace(/--\\w+(?=\\s|$)/, '--critical') + ' is-pulsing'; fill.querySelector('i')?.style.setProperty('--fill', '96%'); }
    document.querySelector('.hdr-route[data-qa-route="fleets"]')?.classList.add('hdr-route--alert');
  })()`);
  await sleep(300);
  await take('planet-orbit', null);
  await take('header-storage-pulse', '.asterion-header__resource', 20);
  await take('header-fleets-alarm', '.hdr-route[data-qa-route="fleets"]', 30);

  // Resource zone: the building under construction (real markup).
  await click(win, '[data-qa-zone="resource"]');
  await waitFor(win, `document.querySelector('[data-qa-zone-view] .resource-building-node.building')`);
  await waitFor(win, `Array.from(document.querySelectorAll('[data-qa-zone-view] img')).every((img) => img.complete)`);
  await sleep(1500);
  await take('zone-building-under-construction', '[data-qa-zone-view] .resource-building-node.building', 50);

  // Military zone: the Gate under construction. A fresh test game has no Gate, so the node is injected with
  // ZoneView's markup for this build (the glow copy only where the branch's ZoneView renders one).
  await click(win, '[data-qa-zone="military"]');
  await waitFor(win, `document.querySelector('[data-qa-zone-view] .resource-zone-building-layer')`);
  await sleep(1200);
  const copy = await js(win, `Array.from(document.styleSheets).some((sheet) => { try { return Array.from(sheet.cssRules).some((rule) => String(rule.selectorText || '').includes('resource-building-art__glow')); } catch { return false; } })`);
  report.gateMarkup = copy ? 'with glow copy (branch ZoneView)' : 'single picture (main ZoneView)';
  await js(win, `(() => {
    const layer = document.querySelector('[data-qa-zone-view] .resource-zone-building-layer');
    const art = document.querySelector('[data-qa-zone-view] .resource-building-art img')?.src || '';
    const node = document.createElement('button');
    node.type = 'button'; node.id = 'p6-gate';
    node.className = 'resource-building-node gate-node is-building';
    node.style.cssText = 'left:64%;top:66%;--building-width:196px;--ground-shadow-width:140px';
    node.innerHTML = '<span class="resource-building-ground-shadow" aria-hidden="true"></span><span class="resource-building-art"><img src="' + art + '" alt="">'
      + (${copy} ? '<img class="resource-building-art__glow" src="' + art + '" alt="" aria-hidden="true">' : '') + '</span>'
      + '<span class="gate-node__bar" aria-hidden="true"><i style="width:40%"></i></span><span class="resource-building-caption"><strong>Звёздные Врата</strong><small>Строится</small></span>';
    layer.appendChild(node);
  })()`);
  await sleep(1200);
  await take('zone-gate-under-construction', '#p6-gate', 50);

  // «Вселенная»: the shield dome over a planet (the dome markup UniverseView renders for a shielded world).
  await click(win, '[data-qa-route="universe"]');
  await waitFor(win, `document.querySelector('.universe-view .system-planet img')`);
  await sleep(2500);
  // UniverseView's markup for a shielded world in this build: the dome before the picture and, on the branch,
  // the rim as a sibling after it (main draws the rim as the dome's ::before).
  const rim = await js(win, `Array.from(document.styleSheets).some((sheet) => { try { return Array.from(sheet.cssRules).some((rule) => String(rule.selectorText || '').includes('shield-aura__rim')); } catch { return false; } })`);
  report.shieldMarkup = rim ? 'dome + sibling rim (branch UniverseView)' : 'dome with ::before rim (main UniverseView)';
  await js(win, `(() => {
    const planet = document.querySelector('.universe-view .system-planet');
    const img = planet.querySelector(':scope > img');
    const span = (cls) => { const node = document.createElement('span'); node.className = cls; node.setAttribute('aria-hidden', 'true'); return node; };
    planet.insertBefore(span('shield-aura'), img);
    if (${rim}) img.after(span('shield-aura__rim'));
    planet.id = 'p6-shielded';
  })()`);
  await sleep(400);
  await take('universe-map', null);
  await take('universe-shield-dome', '#p6-shielded', 40);

  // Fragments (same markup in both runs) over the workspace, one at a time.
  for (const [name, id, pad] of [['fleets-incoming-attack', 'p6-incoming', 8], ['recycling-ready', 'p6-recycling', 8], ['bots-distribute', 'p6-bots', 8],
    ['queued-stripes', 'p6-stripes', 8], ['flight-plan-pick', 'p6-briefing', 8], ['sun-raid-alarm', 'p6-alarm', 8], ['whats-new-mark', 'p6-new', 8], ['atlas-online', 'p6-atlas', 8]]) {
    if (!(await js(win, stageOne(id)))) throw new Error(`No fragment ${id}`);
    await sleep(700);
    await take(name, '#' + id, pad);
  }
  await js(win, `document.getElementById('p6-stage')?.remove()`);
  return shots;
}

app.whenReady().then(async () => {
  let win;
  try {
    fs.mkdirSync(OUTPUT, { recursive: true });
    win = new BrowserWindow({ width: 1280, height: 720, show: false, backgroundColor: '#02050a',
      webPreferences: { offscreen: true, contextIsolation: true, nodeIntegration: false, sandbox: true, partition: 'qa-perf-6' } });
    await win.loadFile(path.join(ROOT, 'dist', 'index.html'), { search: '?mode=test' });
    await waitFor(win, `document.querySelector('[data-qa-navigation="utility"]')`, 30000);
    win.webContents.debugger.attach('1.3');
    await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });
    await seed(win);
    await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });
    const report = { reducedMotion: await js(win, `matchMedia('(prefers-reduced-motion: reduce)').matches`) };
    for (const [width, height] of VIEWPORTS) {
      const dir = path.join(OUTPUT, `${width}x${height}`);
      fs.mkdirSync(dir, { recursive: true });
      await win.webContents.debugger.sendCommand('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false, screenWidth: width, screenHeight: height });
      await settle(win, 400);
      report[`${width}x${height}`] = {};
      await runViewport(win, dir, report[`${width}x${height}`]);
    }
    fs.writeFileSync(path.join(OUTPUT, 'perf-6-animations.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report['1280x720'], null, 1));
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
