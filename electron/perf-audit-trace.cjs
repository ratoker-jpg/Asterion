// Measurement tool of the 120 FPS program (audit PERF-AUDIT-2026-11-10, docs/PERF_MEASUREMENT.md). Never run on the owner's PC: GitHub Actions only.
// Where the UI thread spends a frame on a late world, per screen, at a 120 Hz frame clock:
// Chromium trace (tasks, style, layout, paint, GC, main frames), page statistics (DOM size,
// running animations and the properties they animate, filters), React commits and a CPU profile.
//
//   electron electron/perf-audit-trace.cjs --fixture=F [--speed=fast|superfast] [--seconds=5]
//       [--mode=trace|profile] [--autosave-seconds=75] [--motion] [--no-raf] [--frame-rate=120] [--out=DIR]
// Report: tools/perf-audit-summary.mjs turns the JSON into a table per screen with a gate.
const { app, BrowserWindow, contentTracing } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { registerSaveStore } = require('./save-store.cjs');

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const raw = args.find((arg) => arg.startsWith(`--${name}=`));
  return raw ? raw.slice(name.length + 3) : fallback;
};
const SOFTWARE = args.includes('--software') || process.env.CI === 'true';
if (SOFTWARE) {
  app.disableHardwareAcceleration();
  app.commandLine.appendSwitch('disable-gpu');
}
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.on('window-all-closed', () => {});

const PROFILE = fs.mkdtempSync(path.join(os.tmpdir(), 'asterion-perf-audit-'));
app.setPath('userData', PROFILE);

const ROOT = path.join(__dirname, '..');
const FIXTURE = option('fixture');
const SPEED = option('speed');
const SECONDS = Number(option('seconds', '5'));
const MODE = option('mode', 'trace');
const AUTOSAVE_SECONDS = Number(option('autosave-seconds', '0'));
const FRAME_RATE = Number(option('frame-rate', '120'));
// --motion: animations on (CI Windows reports prefers-reduced-motion: reduce, which turns the game's motion off).
const MOTION = args.includes('--motion');
// --no-raf: no requestAnimationFrame loop of our own (it forces a main frame every frame); frames are read from the trace.
const NO_RAF = args.includes('--no-raf');
const OUTPUT = option('out', path.join(ROOT, 'artifacts', 'perf-audit'));
const LEGACY_KEY = 'asterion.vertical-slice.v1';
const SLOT_INDEX_KEY = 'asterion.slots.index.v1';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const run = (win, source) => win.webContents.executeJavaScript(source);
const log = (text) => process.stderr.write(`${text}\n`);

// [label, header route, selector that marks it as shown, extra click after the route (selector) or null]
const SCREENS = [
  ['planet', 'planet', '.planet-page-v3', null],
  ['empire', 'planet', '.planet-page-v3', '[data-qa-planet-section="empire"]'],
  ['universe', 'universe', '.universe-view', null],
  ['fleets', 'fleets', '.fleet-main-v1', null],
  ['messages', 'reports', '.reports-view', null],
  ['rating', 'rating', '[data-qa-utility-screen="rating"]', null],
  ['command', 'command', '.command-view', null],
  ['operations', 'operations', '.operations-shell-v2', null],
  ['planet-late', 'planet', '.planet-page-v3', null],
];

function prepareSave() {
  const state = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
  if (SPEED && state.worldConfig?.world) state.worldConfig.world.campaignSpeed = SPEED;
  const cursor = state.npcReplay?.processedThroughAt ?? state.resourceClock.lastReconciledAt;
  const delta = Math.round((cursor - Date.now()) / 60_000) * 60_000;
  const size = (value) => { try { return JSON.stringify(value).length; } catch { return -1; } };
  const shape = {
    flights: state.flights?.records?.length ?? null,
    spyTargets: Object.keys(state.espionage?.targets ?? {}).length,
    spyReports: state.espionage?.reports?.length ?? null,
    combatReports: state.combat?.reports?.length ?? null,
    npcProfiles: Object.keys(state.npc?.profiles ?? {}).length,
    playerPlanets: Object.keys(state.planets ?? {}).length,
    world: state.worldConfig?.world ?? null,
    sectionChars: Object.fromEntries(Object.entries(state).map(([key, value]) => [key, size(value)]).filter(([, chars]) => chars > 200_000)),
  };
  return { raw: JSON.stringify(state), delta, shape };
}

async function movePageClock(win, offsetMs) {
  const dbg = win.webContents.debugger;
  if (!dbg.isAttached()) dbg.attach('1.3');
  await dbg.sendCommand('Page.enable');
  // React DevTools hook stub: counts commits (and, in profile mode, the components that rendered).
  await dbg.sendCommand('Page.addScriptToEvaluateOnNewDocument', { source: `(() => {
    const stats = window.__perfReact = { on: false, deep: false, commits: 0, at: [], rendered: {}, renderedTotal: 0, fibers: 0 };
    const nameOf = (fiber) => { const type = fiber.type; if (!type) return null; if (typeof type === 'string') return null;
      return type.displayName || type.name || (type.render && (type.render.displayName || type.render.name)) || (type.type && (type.type.displayName || type.type.name)) || 'Anonymous'; };
    window.__REACT_DEVTOOLS_GLOBAL_HOOK__ = { supportsFiber: true, isDisabled: false, renderers: new Map(), checkDCE() {}, inject() { return 1; },
      onCommitFiberUnmount() {}, onPostCommitFiberRoot() {}, onScheduleFiberRoot() {}, setStrictMode() {},
      onCommitFiberRoot(_id, root) {
        if (!stats.on) return;
        stats.commits += 1; stats.at.push(Math.round(performance.now()));
        if (!stats.deep) return;
        let fibers = 0; const stack = [root.current];
        while (stack.length) { const fiber = stack.pop(); fibers += 1;
          if ((fiber.flags & 1) && typeof fiber.type !== 'string') { const name = nameOf(fiber); if (name) { stats.rendered[name] = (stats.rendered[name] || 0) + 1; stats.renderedTotal += 1; } }
          if (fiber.sibling) stack.push(fiber.sibling); if (fiber.child) stack.push(fiber.child); }
        stats.fibers = fibers;
      } };
  })();` });
  if (!offsetMs) return;
  await dbg.sendCommand('Page.addScriptToEvaluateOnNewDocument', { source: `(() => {
    const RealDate = Date;
    const offset = ${offsetMs};
    class MovedDate extends RealDate {
      constructor(...args) { if (args.length === 0) super(RealDate.now() + offset); else super(...args); }
      static now() { return RealDate.now() + offset; }
    }
    globalThis.Date = MovedDate;
  })();` });
}

async function waitFor(win, expression, timeoutMs = 30_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await run(win, `Boolean(${expression})`)) return;
    await sleep(100);
  }
  throw new Error(`Timed out waiting for: ${expression}`);
}

async function load(win, search) {
  await win.loadFile(path.join(ROOT, 'dist', 'index.html'), search ? { search } : undefined);
}

async function openScreen(win, [, route, selector, extra]) {
  const clicked = await run(win, `(() => { const element = document.querySelector('[data-qa-route="${route}"]'); if (!element || element.disabled) return false; element.click(); return true; })()`);
  if (!clicked) throw new Error(`Route button not found: ${route}`);
  if (route === 'planet') {
    await waitFor(win, `document.querySelector('[data-qa-planet-sections]')`, 20_000);
    await run(win, `document.querySelector(${JSON.stringify(extra || '[data-qa-planet-section="current"]')})?.click()`);
    if (!extra) await waitFor(win, `document.querySelector(${JSON.stringify(selector)})`, 20_000);
  } else {
    await waitFor(win, `document.querySelector(${JSON.stringify(selector)})`, 20_000);
  }
  await sleep(2_500);
}

// rAF intervals, UI-thread long tasks, messages from the worker (size estimate) while `on`.
const PROBE = `(() => {
  if (window.__perfProbe) return;
  const probe = window.__perfProbe = { on: false, frames: [], last: 0, long: [] };
  try { new PerformanceObserver((list) => { if (probe.on) for (const entry of list.getEntries()) probe.long.push(Math.round(entry.duration)); }).observe({ type: 'longtask', buffered: false }); } catch {}
  const tick = (time) => { if (probe.on && probe.last) probe.frames.push(time - probe.last); probe.last = time; requestAnimationFrame(tick); };
  if (!window.__perfNoRaf) requestAnimationFrame(tick);
  probe.start = () => { probe.frames = []; probe.long = []; probe.last = 0; probe.on = true; };
  probe.stop = () => { probe.on = false; const sorted = [...probe.frames].sort((a, b) => a - b);
    const at = (q) => sorted.length ? Math.round(sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * q) - 1)] * 100) / 100 : null;
    const total = probe.frames.reduce((sum, value) => sum + value, 0);
    return { frames: sorted.length, fps: total ? Math.round(sorted.length / total * 10000) / 10 : null, p50: at(0.5), p95: at(0.95), p99: at(0.99), worst: at(1),
      over9ms: sorted.filter((value) => value > 9).length, over17ms: sorted.filter((value) => value > 17).length, over34ms: sorted.filter((value) => value > 34).length,
      longTasks: probe.long }; };
})()`;

// What the page is made of: DOM size, running animations by animated property, expensive computed styles.
const PAGE_STATS = `(() => {
  const all = document.querySelectorAll('*');
  const compositable = new Set(['transform', 'opacity', 'translate', 'rotate', 'scale', 'offset', 'easing', 'composite', 'computedOffset']);
  const describe = (element) => { if (!element) return '(none)'; const cls = typeof element.className === 'string' ? element.className.trim().split(/\\s+/).slice(0, 3).join('.') : ''; return element.tagName.toLowerCase() + (cls ? '.' + cls : ''); };
  const animations = document.getAnimations();
  const byKey = {};
  let running = 0, infinite = 0, mainThread = 0;
  for (const animation of animations) {
    if (animation.playState !== 'running') continue;
    running += 1;
    const effect = animation.effect;
    const timing = effect && effect.getTiming ? effect.getTiming() : {};
    const isInfinite = timing.iterations === Infinity;
    if (isInfinite) infinite += 1;
    let properties = [];
    try { const set = new Set(); for (const frame of effect.getKeyframes()) for (const key of Object.keys(frame)) if (!compositable.has(key)) set.add(key); properties = [...set]; } catch {}
    const target = effect && effect.target;
    const pseudo = effect && effect.pseudoElement ? effect.pseudoElement : '';
    let visible = false, area = 0;
    if (target) { const rect = target.getBoundingClientRect(); area = Math.round(rect.width * rect.height); visible = rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.right > 0 && rect.top < innerHeight && rect.left < innerWidth; }
    if (properties.length) mainThread += 1;
    const name = animation.animationName || animation.transitionProperty || animation.id || '(script)';
    const key = name + ' | ' + (properties.length ? properties.join(',') : 'compositor-only') + ' | ' + describe(target) + pseudo + (isInfinite ? ' | infinite' : '');
    const entry = byKey[key] || (byKey[key] = { count: 0, visible: 0, area: 0, durationMs: timing.duration });
    entry.count += 1; if (visible) { entry.visible += 1; entry.area += area; }
  }
  const styles = { backdropFilter: [], filter: [], mixBlend: 0, willChange: 0, mask: 0, fixed: 0, boxShadow: 0, clipPath: 0 };
  for (const element of all) {
    const style = getComputedStyle(element);
    const rect = (style.backdropFilter && style.backdropFilter !== 'none') || (style.filter && style.filter !== 'none') ? element.getBoundingClientRect() : null;
    if (style.backdropFilter && style.backdropFilter !== 'none') styles.backdropFilter.push(describe(element) + ' ' + style.backdropFilter + ' ' + Math.round(rect.width) + 'x' + Math.round(rect.height));
    if (style.filter && style.filter !== 'none') styles.filter.push(describe(element) + ' ' + style.filter.slice(0, 60) + ' ' + Math.round(rect.width) + 'x' + Math.round(rect.height));
    if (style.mixBlendMode && style.mixBlendMode !== 'normal') styles.mixBlend += 1;
    if (style.willChange && style.willChange !== 'auto') styles.willChange += 1;
    if ((style.maskImage && style.maskImage !== 'none') || (style.webkitMaskImage && style.webkitMaskImage !== 'none')) styles.mask += 1;
    if (style.position === 'fixed') styles.fixed += 1;
    if (style.boxShadow && style.boxShadow !== 'none') styles.boxShadow += 1;
    if (style.clipPath && style.clipPath !== 'none') styles.clipPath += 1;
  }
  let rules = 0, sheets = 0;
  for (const sheet of document.styleSheets) { sheets += 1; try { rules += sheet.cssRules.length; } catch {} }
  const images = [...document.images].filter((image) => image.naturalWidth > 0);
  return { elements: all.length, styleSheets: sheets, cssRules: rules,
    images: images.length, decodedImageMegapixels: Math.round(images.reduce((sum, image) => sum + image.naturalWidth * image.naturalHeight, 0) / 1e5) / 10,
    animations: { total: animations.length, running, infinite, mainThread,
      top: Object.entries(byKey).sort((a, b) => b[1].count - a[1].count).slice(0, 40).map(([key, value]) => ({ key, ...value })) },
    styles: { ...styles, backdropFilterCount: styles.backdropFilter.length, filterCount: styles.filter.length,
      backdropFilter: styles.backdropFilter.slice(0, 25), filter: styles.filter.slice(0, 40) },
    heap: performance.memory ? { usedMb: Math.round(performance.memory.usedJSHeapSize / 1048576), totalMb: Math.round(performance.memory.totalJSHeapSize / 1048576) } : null };
})()`;

const INTERESTING = new Set(['RunTask', 'ThreadControllerImpl::RunTask', 'FunctionCall', 'EvaluateScript', 'TimerFire', 'EventDispatch', 'FireAnimationFrame',
  'UpdateLayoutTree', 'Layout', 'PrePaint', 'Paint', 'Layerize', 'Commit', 'UpdateLayer', 'UpdateLayerTree', 'CompositeLayers', 'HitTest',
  'MinorGC', 'MajorGC', 'V8.GC_SCAVENGER', 'V8.GC_MARK_COMPACTOR', 'V8.GCScavenger', 'V8.GCCompactor', 'BlinkGC.AtomicPhase', 'ParseHTML', 'ParseAuthorStyleSheet',
  'RunMicrotasks', 'v8.run', 'V8.HandleInterrupts', 'ScheduleStyleRecalculation', 'InvalidateLayout', 'HandlePostMessage', 'RasterTask', 'ImageDecodeTask', 'Decode Image',
  'Decode LazyPixelRef', 'GPUTask', 'BeginMainThreadFrame', 'BeginFrame', 'DrawFrame', 'DroppedFrame', 'ActivateLayerTree', 'RequestMainThreadFrame', 'Animation',
  'IntersectionObserverController::computeIntersections', 'LocalFrameView::RunPostLifecycleSteps', 'ResizeObserverController::deliverObservations']);

/** Summarises a Chromium trace file: the renderer's UI thread, its worker and the other threads. */
function summariseTrace(file, seconds) {
  const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  const events = Array.isArray(parsed) ? parsed : parsed.traceEvents;
  const threadName = new Map();
  for (const event of events) if (event.ph === 'M' && event.name === 'thread_name') threadName.set(`${event.pid}:${event.tid}`, event.args?.name ?? '?');
  // The game's renderer: the CrRendererMain thread with the most events.
  const counts = new Map();
  for (const event of events) { const key = `${event.pid}:${event.tid}`; if (threadName.get(key) === 'CrRendererMain') counts.set(key, (counts.get(key) ?? 0) + 1); }
  const mainKey = [...counts].sort((a, b) => b[1] - a[1])[0]?.[0];
  if (!mainKey) return { error: 'no renderer main thread in trace', events: events.length };
  const mainPid = Number(mainKey.split(':')[0]);
  const main = events.filter((event) => `${event.pid}:${event.tid}` === mainKey && event.ph === 'X' && typeof event.dur === 'number').sort((a, b) => a.ts - b.ts);
  let taskName = 'RunTask';
  if (!main.some((event) => event.name === taskName)) taskName = 'ThreadControllerImpl::RunTask';
  const tasks = main.filter((event) => event.name === taskName);
  const durations = tasks.map((event) => event.dur / 1000).sort((a, b) => a - b);
  const at = (q) => durations.length ? Math.round(durations[Math.min(durations.length - 1, Math.ceil(durations.length * q) - 1)] * 100) / 100 : null;
  const round = (value) => Math.round(value * 100) / 100;
  const byName = {};
  for (const event of main) {
    if (!INTERESTING.has(event.name)) continue;
    const entry = byName[event.name] ?? (byName[event.name] = { count: 0, totalMs: 0, maxMs: 0 });
    entry.count += 1; entry.totalMs += event.dur / 1000; entry.maxMs = Math.max(entry.maxMs, event.dur / 1000);
  }
  for (const entry of Object.values(byName)) { entry.perSecondMs = round(entry.totalMs / seconds); entry.totalMs = round(entry.totalMs); entry.maxMs = round(entry.maxMs); }
  // The longest tasks with what they contain.
  const detail = (event) => {
    const data = event.args?.data ?? event.args?.beginData ?? {};
    if (event.name === 'FunctionCall') return `FunctionCall ${data.functionName || '(anon)'} ${String(data.url || '').split('/').pop()}:${data.lineNumber ?? ''}`;
    if (event.name === 'EventDispatch') return `EventDispatch ${data.type ?? ''}`;
    if (event.name === 'TimerFire') return 'TimerFire';
    if (event.name === 'UpdateLayoutTree') return `UpdateLayoutTree elements=${event.args?.elementCount ?? data.elementCount ?? '?'}`;
    return event.name;
  };
  const longest = [...tasks].sort((a, b) => b.dur - a.dur).slice(0, 14).map((task) => {
    const inside = main.filter((event) => event !== task && event.ts >= task.ts && event.ts + event.dur <= task.ts + task.dur && INTERESTING.has(event.name)
      && event.name !== taskName && event.dur >= 300);
    const parts = {};
    for (const event of inside) { const key = detail(event); parts[key] = round((parts[key] ?? 0) + event.dur / 1000); }
    return { ms: round(task.dur / 1000), atMs: Math.round((task.ts - main[0].ts) / 1000),
      parts: Object.fromEntries(Object.entries(parts).sort((a, b) => b[1] - a[1]).slice(0, 10)) };
  });
  // Busy time per whole second (the 1 Hz world tick shows as a spike in every second).
  const start = main[0].ts;
  const perSecond = [];
  for (const task of tasks) { const second = Math.floor((task.ts - start) / 1e6); perSecond[second] = (perSecond[second] ?? 0) + task.dur / 1000; }
  // Counts of frame events (instant or complete) in the renderer process.
  const frameEvents = {};
  for (const event of events) {
    if (event.pid !== mainPid) continue;
    if (['BeginMainThreadFrame', 'DrawFrame', 'DroppedFrame', 'BeginFrame', 'ActivateLayerTree', 'RequestMainThreadFrame', 'NeedsBeginFrameChanged', 'Commit'].includes(event.name)) {
      frameEvents[event.name] = (frameEvents[event.name] ?? 0) + 1;
    }
  }
  for (const key of Object.keys(frameEvents)) frameEvents[key] = round(frameEvents[key] / seconds);
  // DIAG perf-6: animation events with their compositor verdict.
  const animDiag = {};
  for (const event of events) {
    if (event.pid !== mainPid || event.name !== 'Animation') continue;
    const data = event.args?.data ?? {};
    const key = `${event.ph} ${data.name ?? ''} id=${event.id2?.local ?? event.id ?? ''} failed=${data.compositeFailed ?? ''} props=${JSON.stringify(data.unsupportedProperties ?? '')} state=${data.state ?? ''} node=${data.nodeName ?? data.nodeId ?? ''}`;
    animDiag[key] = (animDiag[key] ?? 0) + 1;
  }

  // Every thread's busy time (top-level tasks), per second of the window.
  const threads = {};
  for (const event of events) {
    if (event.ph !== 'X' || typeof event.dur !== 'number') continue;
    if (event.name !== 'ThreadControllerImpl::RunTask' && event.name !== 'RunTask' && event.name !== 'ThreadPool_RunTask' && event.name !== 'RasterTask' && event.name !== 'GPUTask') continue;
    const name = `${event.pid === mainPid ? 'renderer' : 'other'}/${threadName.get(`${event.pid}:${event.tid}`) ?? '?'}/${event.name}`.replace(/\d+$/, '#');
    threads[name] = (threads[name] ?? 0) + event.dur / 1000;
  }
  const threadMsPerSecond = Object.fromEntries(Object.entries(threads).map(([key, value]) => [key, round(value / seconds)]).filter(([, value]) => value >= 0.5).sort((a, b) => b[1] - a[1]).slice(0, 24));
  return {
    events: events.length, taskEvent: taskName,
    tasks: { count: tasks.length, busyMsPerSecond: round(durations.reduce((sum, value) => sum + value, 0) / seconds), p50: at(0.5), p95: at(0.95), p99: at(0.99), max: at(1),
      over4ms: durations.filter((value) => value > 4).length, over8ms: durations.filter((value) => value > 8.33).length,
      over16ms: durations.filter((value) => value > 16.7).length, over50ms: durations.filter((value) => value > 50).length },
    busyMsBySecond: perSecond.map((value) => Math.round(value ?? 0)),
    framesPerSecond: frameEvents, animDiag, byEvent: byName, longestTasks: longest, threadMsPerSecond,
  };
}

/** Self and inclusive time by function of a CPU profile (top N). */
function summariseProfile(profile, top = 45) {
  const nodes = new Map(profile.nodes.map((node) => [node.id, node]));
  const parent = new Map();
  for (const node of profile.nodes) for (const child of node.children ?? []) parent.set(child, node.id);
  const name = (node) => `${node.callFrame.functionName || '(anon)'} ${String(node.callFrame.url).split('/').pop()}:${node.callFrame.lineNumber + 1}`;
  const self = new Map();
  const inclusive = new Map();
  let total = 0;
  for (let index = 0; index < profile.samples.length; index += 1) {
    const delta = (profile.timeDeltas[index] ?? 0) / 1000;
    total += delta;
    const id = profile.samples[index];
    const key = name(nodes.get(id));
    self.set(key, (self.get(key) ?? 0) + delta);
    const seen = new Set();
    for (let current = id; current !== undefined; current = parent.get(current)) {
      const frame = name(nodes.get(current));
      if (seen.has(frame)) continue;
      seen.add(frame);
      inclusive.set(frame, (inclusive.get(frame) ?? 0) + delta);
    }
  }
  const list = (map) => [...map].sort((a, b) => b[1] - a[1]).slice(0, top).map(([key, value]) => `${value.toFixed(1)} ms  ${key}`);
  return { totalMs: Math.round(total), self: list(self), inclusive: list(inclusive) };
}

const TRACE_CATEGORIES = ['toplevel', 'devtools.timeline', 'disabled-by-default-devtools.timeline', 'disabled-by-default-devtools.timeline.frame', 'v8', 'blink.user_timing', 'cc', 'benchmark'];

async function traceWindow(win, label, seconds, categories = TRACE_CATEGORIES) {
  const file = path.join(OUTPUT, `trace-${label}.json`);
  await contentTracing.startRecording({ included_categories: categories, excluded_categories: ['*'], recording_mode: 'record-until-full', trace_buffer_size_in_kb: 700 * 1024 });
  await run(win, 'window.__perfProbe.start(); if (window.__perfReact) { window.__perfReact.commits = 0; window.__perfReact.at = []; window.__perfReact.on = true; }');
  await sleep(seconds * 1_000);
  const frames = await run(win, 'window.__perfProbe.stop()');
  const commits = await run(win, 'window.__perfReact ? (window.__perfReact.on = false, { commits: window.__perfReact.commits }) : { commits: -1 }');
  await contentTracing.stopRecording(file);
  let trace;
  try { trace = summariseTrace(file, seconds); } catch (error) { trace = { error: String(error && error.stack || error) }; }
  const bytes = fs.statSync(file).size;
  // Raw traces are large: only the summaries are kept.
  fs.rmSync(file, { force: true });
  return { frames, reactCommitsPerSecond: Math.round(commits.commits / seconds * 100) / 100, traceBytes: bytes, trace };
}

async function main() {
  await app.whenReady();
  registerSaveStore();
  fs.mkdirSync(OUTPUT, { recursive: true });
  const win = new BrowserWindow({
    show: false, width: 1920, height: 1080, useContentSize: true, focusable: false, skipTaskbar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, sandbox: true, backgroundThrottling: false, offscreen: true },
  });
  win.webContents.setFrameRate(FRAME_RATE);
  const save = prepareSave();
  await load(win, '?autostart=continue');
  await waitFor(win, `document.querySelector('[data-qa-navigation="utility"]')`);
  const saveKey = await run(win, `(() => {
    const index = JSON.parse(localStorage.getItem(${JSON.stringify(SLOT_INDEX_KEY)}) || 'null');
    const slot = index?.slots?.find((item) => item.id === index.activeSlotId);
    return slot?.storageKey || ${JSON.stringify(LEGACY_KEY)};
  })()`);
  await load(win, '');
  await sleep(1_000);
  const external = save.raw.length >= 8_000_000;
  await run(win, external
    ? `(() => { window.asterionDesktop.saveStore.write(${JSON.stringify(saveKey)}, 'qa-seed', ${JSON.stringify(save.raw)});
        localStorage.setItem(${JSON.stringify(saveKey)}, JSON.stringify({ asterionExternalSave: { version: 1, writeId: 'qa-seed', chars: ${save.raw.length} }, saveWriter: 1 })); })()`
    : `localStorage.setItem(${JSON.stringify(saveKey)}, ${JSON.stringify(save.raw)})`);
  await movePageClock(win, save.delta);
  const loadStarted = Date.now();
  await load(win, '?autostart=continue');
  await waitFor(win, `document.querySelector('[data-qa-navigation="utility"]')`, 300_000);
  const result = {
    mode: MODE, fixture: path.basename(path.dirname(FIXTURE)) + '/' + path.basename(FIXTURE), speed: SPEED ?? '(as generated)', saveChars: save.raw.length, world: save.shape,
    rendering: SOFTWARE ? 'software (disable-gpu)' : 'gpu', frameRate: FRAME_RATE, secondsPerScreen: SECONDS,
    cpu: `${os.cpus()[0]?.model} x${os.cpus().length}`, loadMs: Date.now() - loadStarted, screens: {},
  };
  const write = () => fs.writeFileSync(path.join(OUTPUT, `perf-audit-${MODE}${MOTION ? '-motion' : ''}.json`), JSON.stringify(result, null, 1));
  await run(win, `window.__perfNoRaf = ${NO_RAF}`);
  await run(win, PROBE);
  // Let the world settle (a catch-up of the load time itself, first ticks, first save).
  await waitFor(win, `!document.querySelector('[data-qa-npc-catchup] [role="progressbar"]')`, 600_000).catch(() => undefined);
  await run(win, `document.querySelector('[data-qa-npc-catchup-close]')?.click()`).catch(() => undefined);
  await sleep(25_000);
  const dbg = win.webContents.debugger;
  if (!dbg.isAttached()) dbg.attach('1.3');
  if (MOTION) await dbg.sendCommand('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });
  result.motion = MOTION; result.ownRafLoop = !NO_RAF;
  result.reducedMotion = await run(win, `matchMedia('(prefers-reduced-motion: reduce)').matches`);
  for (const screen of SCREENS) {
    const label = screen[0];
    try {
      await openScreen(win, screen);
      const entry = { page: await run(win, PAGE_STATS) };
      if (MODE === 'trace') {
        Object.assign(entry, await traceWindow(win, label, SECONDS));
      } else {
        // React: which components render per commit; then a CPU profile of the UI thread.
        await run(win, 'window.__perfReact.commits = 0; window.__perfReact.rendered = {}; window.__perfReact.renderedTotal = 0; window.__perfReact.deep = true; window.__perfReact.on = true;');
        await sleep(4_000);
        entry.react = await run(win, `(() => { const s = window.__perfReact; s.on = false; s.deep = false;
          return { commitsIn4s: s.commits, fibers: s.fibers, componentsRenderedPerCommit: s.commits ? Math.round(s.renderedTotal / s.commits) : 0,
            top: Object.entries(s.rendered).sort((a, b) => b[1] - a[1]).slice(0, 40).map(([name, count]) => name + ' x' + (Math.round(count / Math.max(1, s.commits) * 10) / 10)) }; })()`);
        await dbg.sendCommand('Profiler.enable');
        await dbg.sendCommand('Profiler.setSamplingInterval', { interval: 200 });
        await dbg.sendCommand('Profiler.start');
        await sleep(SECONDS * 1_000);
        const { profile } = await dbg.sendCommand('Profiler.stop');
        entry.profile = summariseProfile(profile);
      }
      result.screens[label] = entry;
      log(`${label}: done`);
    } catch (error) {
      result.screens[label] = { error: String(error && error.stack || error) };
      log(`${label}: ${error}`);
    }
    write();
  }
  // DIAG perf-6: which animation forces a main frame every frame. Kill one at a time, trace 3 s each.
  const RAW = '/*raw*/';
  const EXPERIMENTS = {
    planet: ['', '.planet-orbit__ring', RAW + "@keyframes p6-off{from,to{transform:translate(-50%,-50%)}}@keyframes p6-rot{to{transform:rotate(360deg)}}.planet-orbit>.planet-orbit__ring{animation:ut-ring-in-centred 1100ms backwards,p6-off 1ms linear 0ms forwards!important;border-color:transparent!important}.planet-orbit>.planet-orbit__ring::before{content:'';position:absolute;inset:-1px;border-radius:50%;border:1px solid rgba(126,200,220,.12);animation:p6-rot 360s linear infinite}.planet-orbit>.planet-orbit__ring--outer::before{border-style:dashed;border-color:rgba(126,200,220,.08);animation-duration:240s;animation-direction:reverse}/*X*/"],
    universe: ['', '.shield-aura, .shield-aura::before', '.shield-aura', '.shield-aura::before',
      RAW + '.shield-aura::before{-webkit-mask:none!important;mask:none!important}',
      RAW + '.shield-aura{animation-name:p6-op!important}@keyframes p6-op{0%,100%{opacity:.78}50%{opacity:1}}',
      RAW + '.shield-aura{will-change:transform,opacity}.shield-aura::before{will-change:transform}',
      RAW + '.shield-aura{box-shadow:none!important}',
      RAW + '.system-planet:has(> .shield-aura){isolation:isolate}'],
  };

  result.diag = {};
  for (const [label, kills] of Object.entries(EXPERIMENTS)) {
    const screen = SCREENS.find((item) => item[0] === label);
    try {
      await openScreen(win, screen);
      await sleep(3_000);
      result.diag[label] = {};
      for (const kill of kills) {
        await run(win, `(() => { let s = document.getElementById('perf6-kill'); if (!s) { s = document.createElement('style'); s.id = 'perf6-kill'; document.head.appendChild(s); } s.textContent = ${JSON.stringify(kill.startsWith('/*raw*/') ? kill : kill ? kill + '{animation:none!important;transition:none!important}' : '')}; })()`);
        await sleep(800);
        const traced = await traceWindow(win, `diag-${label}`, 3);
        result.diag[label][kill || '(none)'] = { bmtf: traced.trace.framesPerSecond?.BeginMainThreadFrame, ult: traced.trace.byEvent?.UpdateLayoutTree?.perSecondMs, layerize: traced.trace.byEvent?.Layerize?.perSecondMs, paint: traced.trace.byEvent?.Paint?.perSecondMs };
      }
      // Restart all animations inside a trace to catch the compositor verdicts.
      await run(win, `document.getElementById('perf6-kill').textContent = '*,*::before,*::after{animation:none!important}'`);
      await sleep(500);
      await contentTracing.startRecording({ included_categories: TRACE_CATEGORIES, excluded_categories: ['*'], recording_mode: 'record-until-full', trace_buffer_size_in_kb: 300 * 1024 });
      await sleep(300);
      await run(win, `document.getElementById('perf6-kill').textContent = ''`);
      await sleep(1500);
      const file = path.join(OUTPUT, `trace-diag-restart-${label}.json`);
      await contentTracing.stopRecording(file);
      result.diag[label].restart = summariseTrace(file, 1.8).animDiag;
      fs.rmSync(file, { force: true });
    } catch (error) { result.diag[label] = { error: String(error && error.stack || error) }; }
    write();
  }
  if (MODE === 'trace' && AUTOSAVE_SECONDS > 0) {
    // A long quiet window on the planet screen: autosaves (the worker posts the save text) land here.
    try {
      await openScreen(win, SCREENS[0]);
      await run(win, 'window.__liveWorldMsgStats = {}');
      result.autosaveWindow = await traceWindow(win, 'autosave', AUTOSAVE_SECONDS, ['devtools.timeline', 'disabled-by-default-devtools.timeline']);
      result.autosaveWindow.seconds = AUTOSAVE_SECONDS;
      result.autosaveWindow.messages = await run(win, 'window.__liveWorldMsgStats || null');
      result.autosaveWindow.storedSave = await run(win, `(() => { const raw = localStorage.getItem(${JSON.stringify(saveKey)}) || '';
        try { const pointer = JSON.parse(raw).asterionExternalSave; if (pointer) return { external: true, writeId: pointer.writeId, chars: pointer.chars }; } catch {}
        return { external: false, chars: raw.length }; })()`);
    } catch (error) { result.autosaveWindow = { error: String(error && error.stack || error) }; }
    write();
  }
  write();
  console.log(JSON.stringify(result).slice(0, 2_000));
}

const cleanup = () => { try { fs.rmSync(PROFILE, { recursive: true, force: true }); } catch { /* held by Chromium */ } };
main().then(() => { cleanup(); app.exit(0); }, (error) => { console.error(error); cleanup(); app.exit(1); });
