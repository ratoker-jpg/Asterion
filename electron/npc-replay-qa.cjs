// Exercise long production NPC catch-up through the built Electron app. This
// script uses a disposable userData directory and never opens a real profile.
const { app, BrowserWindow } = require('electron');
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');

app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-gpu');
app.on('window-all-closed', () => {});

const PROFILE = fs.mkdtempSync(path.join(os.tmpdir(), 'asterion-npc-replay-qa-'));
app.setPath('userData', PROFILE);

const ROOT = path.join(__dirname, '..');
// --full-world: a real 10-galaxy campaign with asteroid, exploration and pirate
// timelines running from its start. The default stays the scoped economy run.
const FULL_WORLD = process.argv.includes('--full-world');
// --days=N (1-30, default 14) or --hours=N (1-720). The PR gate replays a few
// hours: the banner, command gate and completion checks do not need a full
// day, and the nightly job replays whole days.
function parseCatchupHorizon(args) {
  const hours = args.find((arg) => arg.startsWith('--hours='))?.slice('--hours='.length);
  if (hours !== undefined) {
    if (!/^\d+$/.test(hours) || Number(hours) < 1 || Number(hours) > 720) {
      throw new Error(`Invalid --hours value ${JSON.stringify(hours)}; expected an integer from 1 to 720.`);
    }
    return { hours: Number(hours), label: `-${hours}h` };
  }
  const value = args.find((arg) => arg.startsWith('--days='))?.slice('--days='.length) ?? '14';
  if (!/^\d+$/.test(value)) throw new Error(`Invalid --days value ${JSON.stringify(value)}; expected an integer from 1 to 30.`);
  const days = Number(value);
  if (!Number.isSafeInteger(days) || days < 1 || days > 30) throw new Error(`Invalid --days value ${JSON.stringify(value)}; expected an integer from 1 to 30.`);
  return { hours: days * 24, label: days === 14 ? '' : `-${days}d` };
}
const CATCHUP_HORIZON = parseCatchupHorizon(process.argv.slice(2));
const CATCHUP_DAYS = CATCHUP_HORIZON.hours / 24;
const OUTPUT = process.env.ASTERION_QA_OUTPUT
  || path.join(ROOT, 'artifacts', `${FULL_WORLD ? 'npc-replay-full-world-qa' : 'npc-replay-qa'}${CATCHUP_HORIZON.label}`);
// Owner decision (25.10.2026): a long absence is caught up in full behind a
// progress bar and the player waits, so there is no fixed duration limit.
// One catch-up day of 100 owners takes about 14 minutes of renderer compute on
// a CI runner since the NPC endgame. The gate asserts that the banner reports
// progress, the catch-up completes, commands are refused while it runs and the
// player state stays intact. Duration is not a gate: the run fails when the
// replay cursor stops advancing for CATCHUP_STALL_MS, and the overall bound
// only stops a run that never ends.
const CATCHUP_TIMEOUT_MS = Number(process.env.ASTERION_QA_CATCHUP_TIMEOUT_MS) || 1_800_000;
const CATCHUP_STALL_MS = Number(process.env.ASTERION_QA_CATCHUP_STALL_MS) || 120_000;
const FIXTURE_ISOLATION = FULL_WORLD
  ? 'None: 10 galaxies, 100 NPC, asteroid simulation, exploration and pirate timelines run from campaign start.'
  : 'NPC economy replay only; exploration and pirate cursors are frozen at the fixed horizon and asteroid simulation is absent. Not a full-campaign replay.';
const LEGACY_KEY = 'asterion.vertical-slice.v1';
const SLOT_INDEX_KEY = 'asterion.slots.index.v1';
const CATCHUP_MS = CATCHUP_HORIZON.hours * 60 * 60 * 1_000;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const run = (win, source) => win.webContents.executeJavaScript(source);

function createProductionSave(startAt, endAt) {
  const source = `
    import { createInitialSaveState } from './src/application/persistence.ts';
    import { createDefaultNewGameConfig } from './src/domain/world/config.ts';
    import { getNpcOwnerIds } from './src/application/npc-foundation.ts';
    import { createNpcState } from './src/domain/npc/state.ts';
    const fullWorld = ${FULL_WORLD};
    const config = createDefaultNewGameConfig({ seed: 'NPCREPLAYQA2026', campaignName: fullWorld ? 'NPC full-world QA' : 'NPC replay QA' });
    config.world = fullWorld
      ? { ...config.world, galaxyCount: 10, npcCount: 100, randomPlayerStart: false }
      : { ...config.world, galaxyCount: 2, npcCount: 100, maxNpcPerSystem: 2, randomPlayerStart: false };
    const base = createInitialSaveState('production', ${startAt}, config);
    const ownerIds = getNpcOwnerIds(base.espionage?.targets, base.profile.playerId);
    if (ownerIds.length !== 100) throw new Error('Expected exactly 100 generated NPC owners.');
    if (fullWorld && !base.asteroidSimulation) throw new Error('Full-world fixture lost its asteroid simulation.');
    const replay = { version: 1, processedThroughAt: ${startAt}, targetAt: ${endAt} };
    const npc = createNpcState(ownerIds, 'npc-replay-benchmark-persona-salt-v1', ${startAt});
    // Full world keeps every other timeline exactly as the new campaign made it.
    const state = fullWorld ? { ...base, npc, npcReplay: replay } : {
      ...base,
      npc,
      npcReplay: replay,
      exploration: { ...base.exploration, npcProcessedAt: ${endAt} },
      pirate: { ...base.pirate, raidProcessedAt: ${endAt} },
      asteroidSimulation: undefined,
    };
    console.log(JSON.stringify(state));
  `;
  const child = spawnSync(process.execPath, [
    '--experimental-strip-types',
    '--experimental-loader', pathToFileURL(path.join(ROOT, 'src', 'domain', 'combat', 'test-asset-loader.mjs')).href,
    '--input-type=module', '-e', source,
  ], {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    maxBuffer: 64 * 1024 * 1024,
    timeout: 30_000,
  });
  if (child.error) throw child.error;
  if (child.status !== 0) throw new Error(`Source save generation failed: ${(child.stderr || child.stdout).slice(-2_000)}`);
  const state = JSON.parse(child.stdout.trim());
  const ownerIds = Object.keys(state.npc?.profiles ?? {});
  const targetOwnerIds = new Set(Object.values(state.espionage?.targets ?? {}).map((target) => target.ownerId));
  if (ownerIds.length !== 100 || ownerIds.some((ownerId) => !targetOwnerIds.has(ownerId))) {
    throw new Error(`Source save must contain 100 registered NPC profiles; found ${ownerIds.length}.`);
  }
  return JSON.stringify(state);
}

async function waitFor(win, expression, timeoutMs = 30_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await run(win, `Boolean(${expression})`)) return;
    await sleep(60);
  }
  throw new Error(`Timed out waiting for: ${expression}`);
}

// Same bound as NPC_CATCHUP_COMMAND_GRACE_MS: a cursor this close to `now`
// no longer blocks player commands.
const CATCHUP_CONVERGED_MS = 2 * 60 * 1_000;

// Waits for the published replay cursor to converge on `now` with no target
// pending. The catch-up itself takes minutes of wall time, so the next clock
// tick opens one more window for that time; closing the seeded window alone
// is not completion. Fails when the cursor has not moved for CATCHUP_STALL_MS
// or the overall bound runs out.
async function waitForCatchup(win, endAt) {
  const started = Date.now();
  let lastCursor = null;
  let lastAdvanceAt = started;
  while (Date.now() - started < CATCHUP_TIMEOUT_MS) {
    const replay = await run(win, '(() => { const r = window.__npcReplayQa?.latest; return r ? { ...r, now: Date.now() } : null; })()');
    if (replay && replay.processedThroughAt >= endAt && replay.targetAt <= replay.processedThroughAt
      && replay.now - replay.processedThroughAt <= CATCHUP_CONVERGED_MS) return;
    const cursor = replay?.processedThroughAt ?? null;
    if (cursor !== lastCursor) {
      lastCursor = cursor;
      lastAdvanceAt = Date.now();
    } else if (Date.now() - lastAdvanceAt > CATCHUP_STALL_MS) {
      throw new Error(`NPC catch-up stalled: cursor ${cursor} did not advance for ${CATCHUP_STALL_MS} ms`);
    }
    await sleep(1_000);
  }
  throw new Error(`NPC catch-up did not finish within ${CATCHUP_TIMEOUT_MS} ms`);
}

async function load(win, search) {
  const done = new Promise((resolve) => win.webContents.once('did-finish-load', resolve));
  await win.loadFile(path.join(ROOT, 'dist', 'index.html'), search ? { search } : undefined);
  await done;
}

async function click(win, selector) {
  const clicked = await run(win, `(() => {
    const node = document.querySelector(${JSON.stringify(selector)});
    if (!node || node.disabled) return false;
    node.click();
    return true;
  })()`);
  if (!clicked) throw new Error(`Missing or disabled test action: ${selector}`);
}

async function readMeasurement(win, saveKey) {
  return run(win, `(() => {
    clearInterval(window.__npcReplayQaTimer);
    const qa = window.__npcReplayQa || { gaps: [], progress: [] };
    const sorted = [...qa.gaps].sort((a, b) => a - b);
    const p95 = sorted.length ? sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * .95) - 1)] : null;
    const save = JSON.parse(localStorage.getItem(${JSON.stringify(saveKey)}) || 'null');
    const targets = Object.values(save?.espionage?.targets ?? {}).filter((target) => target.kind === 'npc');
    const progress = qa.progress;
    const longTasks = [...qa.longTasks].sort((a, b) => a - b);
    return {
      longTasks: {
        count: longTasks.length,
        totalMs: Math.round(longTasks.reduce((sum, value) => sum + value, 0)),
        p95Ms: longTasks.length ? longTasks[Math.min(longTasks.length - 1, Math.ceil(longTasks.length * .95) - 1)] : null,
        maxMs: longTasks.length ? longTasks[longTasks.length - 1] : null,
      },
      inMemoryReplay: qa.latest,
      runtimePublications: qa.publications,
      persistedSaveChars: (localStorage.getItem(${JSON.stringify(saveKey)}) || '').length,
      persistenceNotice: [...document.querySelectorAll('[data-qa-notice], [role="status"], [role="alert"]')]
        .map((node) => node.textContent || '').find((text) => text.includes('Не удалось сохранить')) || null,
      firstProgress: progress[0] ?? null,
      lastProgress: progress[progress.length - 1] ?? null,
      pending: Boolean(save?.npcReplay && save.npcReplay.targetAt > save.npcReplay.processedThroughAt),
      processedThroughAt: save?.npcReplay?.processedThroughAt ?? null,
      targetAt: save?.npcReplay?.targetAt ?? null,
      savedProgressSamples: qa.progress.length,
      timerSamples: qa.gaps.length,
      timerP95GapMs: p95,
      timerWorstGapMs: sorted.length ? sorted[sorted.length - 1] : null,
      npcActionIds: targets.reduce((count, target) => count + (target.economyAppliedActionIds?.length ?? 0), 0),
      npcQueuedBuildings: targets.reduce((count, target) => count + (target.buildingQueue?.length ?? 0), 0),
      npcProfiles: Object.keys(save?.npc?.profiles ?? {}).length,
    };
  })()`);
}

async function runScenario() {
  await app.whenReady();
  const win = new BrowserWindow({
    show: false,
    width: 1280,
    height: 720,
    // The QA window is hidden; Chromium budget-throttles a hidden page's
    // timers after ~10 s, which would throttle the catch-up continuation and
    // the gap probe alike. Throttling is a property of the hidden QA harness,
    // not of the game, so both scenarios measure unthrottled by default.
    // ASTERION_QA_THROTTLED=1 restores the hidden-window default.
    webPreferences: { contextIsolation: true, sandbox: true,
      backgroundThrottling: process.env.ASTERION_QA_THROTTLED === '1' },
  });
  win.webContents.on('console-message', (_event, _level, message) => {
    if (/\berror\b/i.test(message)) console.warn(`[renderer] ${message}`);
  });

  try {
    // First let the real application create a clean production slot, then
    // replace its payload with a source-generated, schema-current 100-NPC save.
    await load(win, '?autostart=continue');
    await waitFor(win, `document.querySelector('[data-qa-navigation="utility"]')`);
    const saveKey = await run(win, `(() => {
      const index = JSON.parse(localStorage.getItem(${JSON.stringify(SLOT_INDEX_KEY)}) || 'null');
      const slot = index?.slots?.find((item) => item.id === index.activeSlotId);
      return slot?.storageKey || ${JSON.stringify(LEGACY_KEY)};
    })()`);
    const startAt = Date.now() - CATCHUP_MS;
    const endAt = startAt + CATCHUP_MS + 30_000;
    const rawSeed = createProductionSave(startAt, endAt);
    await run(win, `localStorage.setItem(${JSON.stringify(saveKey)}, ${JSON.stringify(rawSeed)})`);
    await load(win, '?autostart=continue');
    await waitFor(win, `document.querySelector('[data-qa-navigation="utility"]')`);
    const pendingExpression = `(() => {
      try { const save = JSON.parse(localStorage.getItem(${JSON.stringify(saveKey)}) || 'null');
        return save?.npcReplay?.targetAt > save?.npcReplay?.processedThroughAt; }
      catch { return false; }
    })()`;
    await waitFor(win, pendingExpression, 30_000);
    // Owner decision (25.10.2026): a long catch-up shows its progress and
    // the player waits. The banner must appear, report a real percentage and
    // leave clicks to the command gate below.
    await waitFor(win, `Boolean(document.querySelector('[data-qa-npc-catchup] [role="progressbar"]'))`, 15_000);
    const catchupBanner = await run(win, `(() => {
      const banner = document.querySelector('[data-qa-npc-catchup]');
      const bar = banner?.querySelector('[role="progressbar"]');
      return { text: banner?.textContent || '', percent: Number(bar?.getAttribute('aria-valuenow')),
        pointerEvents: banner ? getComputedStyle(banner).pointerEvents : null };
    })()`);
    if (!catchupBanner.text.includes('Мир догоняет') || !Number.isFinite(catchupBanner.percent)
      || catchupBanner.percent < 0 || catchupBanner.percent > 100 || catchupBanner.pointerEvents !== 'none') {
      throw new Error(`NPC catch-up progress banner invalid: ${JSON.stringify(catchupBanner)}`);
    }
    fs.mkdirSync(OUTPUT, { recursive: true });
    if (process.env.ASTERION_SKIP_SCREENSHOTS !== '1') {
      fs.writeFileSync(path.join(OUTPUT, 'catchup-progress.png'), (await win.webContents.capturePage()).toPNG());
    }

    const initial = await run(win, `(() => {
      const save = JSON.parse(localStorage.getItem(${JSON.stringify(saveKey)}) || '{}');
      return {
        processedThroughAt: save.npcReplay?.processedThroughAt ?? null,
        targetAt: save.npcReplay?.targetAt ?? null,
        isolation: {
          explorationCursorAtHorizon: save.exploration?.npcProcessedAt === ${endAt},
          pirateCursorAtHorizon: save.pirate?.raidProcessedAt === ${endAt},
          asteroidSimulationAbsent: save.asteroidSimulation === undefined,
        },
        npcProfiles: Object.keys(save.npc?.profiles ?? {}).length,
        npcTargets: Object.values(save.espionage?.targets ?? {}).filter((target) => target.kind === 'npc').length,
        player: { ...save.planets?.['helion-01']?.resources },
        playerQueue: [...(save.queues?.['helion-01'] ?? [])],
      };
    })()`);
    if (initial.npcProfiles !== 100 || initial.npcTargets !== 100 || initial.targetAt <= initial.processedThroughAt) {
      throw new Error(`Catch-up did not start from the seeded production save: ${JSON.stringify(initial)}`);
    }

    // One renderer-side measurement timer records persisted cursor advances
    // and timer gaps. It measures UI-thread scheduling, not Node proxy latency.
    await run(win, `(() => {
      const qa = { last: performance.now(), gaps: [], progress: [], lastCursor: null, latest: null, publications: 0, longTasks: [] };
      window.__npcReplayQa = qa;
      // Main-thread tasks over 50 ms, as the browser itself reports them.
      try {
        new PerformanceObserver((list) => { for (const entry of list.getEntries()) qa.longTasks.push(entry.duration); })
          .observe({ type: 'longtask', buffered: false });
      } catch { /* longtask timing unavailable */ }
      // The save grows to tens of MB (about 18 MB even in the scoped world), so
      // parsing it every 16 ms on the renderer thread would measure the probe
      // and starve the catch-up itself. Read the published runtime state instead.
      window.addEventListener('asterion:runtime-state-changed', (event) => {
        const replay = event.detail?.npcReplay;
        if (!replay) return;
        qa.publications += 1;
        qa.latest = { processedThroughAt: replay.processedThroughAt, targetAt: replay.targetAt };
      });
      window.__npcReplayQaTimer = window.setInterval(() => {
        const now = performance.now();
        qa.gaps.push(now - qa.last);
        qa.last = now;
        const replay = qa.latest;
        if (replay && replay.processedThroughAt !== qa.lastCursor) {
          qa.lastCursor = replay.processedThroughAt;
          qa.progress.push({ processedThroughAt: replay.processedThroughAt, targetAt: replay.targetAt, at: now });
        }
      }, 16);
    })()`);

    // Dispatch a real application request event and then use the real building
    // dialog control. Navigation to the view remains available during replay.
    const eventPrevented = await run(win, `(() => {
      const event = new CustomEvent('asterion:science-start-request', { bubbles: true, cancelable: true, detail: {} });
      window.dispatchEvent(event);
      return event.defaultPrevented;
    })()`);

    const routeIsPlanet = await run(win, `Boolean(document.querySelector('[data-qa-navigation="primary"] [data-qa-route="planet"]'))`);
    if (!routeIsPlanet) throw new Error('Planet route was unavailable during NPC catch-up.');
    await click(win, '[data-qa-navigation="primary"] [data-qa-route="planet"]');
    await waitFor(win, `document.querySelector('[data-qa-zone-hotspot="resource"]')`, 5_000);
    await click(win, '[data-qa-zone-hotspot="resource"]');
    await waitFor(win, `document.querySelector('[data-qa-zone-view][data-zone="resource"]')`, 5_000);
    await click(win, '[data-zone-selector-role="metal-production-1"]');
    await waitFor(win, `document.querySelector('[data-qa-building-dialog="metal-production-1"]')`, 5_000);
    const buildButtonEnabled = await run(win, `(() => {
      const button = document.querySelector('[data-qa-building-dialog="metal-production-1"] [data-qa-build-button]');
      return Boolean(button && !button.disabled);
    })()`);
    if (!buildButtonEnabled) throw new Error('Seeded production building action was not enabled for the command-gate probe.');
    const beforeClickPending = await run(win, pendingExpression);
    if (!beforeClickPending) throw new Error('The replay completed before the representative building action could be probed.');
    const beforePlayerAction = await run(win, `(() => {
      const save = JSON.parse(localStorage.getItem(${JSON.stringify(saveKey)}) || '{}');
      return {
        buildingLevel: save.planets?.['helion-01']?.buildings?.['metal-production-1'] ?? null,
        queue: [...(save.queues?.['helion-01'] ?? [])],
        resources: { ...save.planets?.['helion-01']?.resources },
      };
    })()`);
    await click(win, '[data-qa-building-dialog="metal-production-1"] [data-qa-build-button]');
    await sleep(100);
    const afterPlayerAction = await run(win, `(() => {
      const save = JSON.parse(localStorage.getItem(${JSON.stringify(saveKey)}) || '{}');
      return {
        buildingLevel: save.planets?.['helion-01']?.buildings?.['metal-production-1'] ?? null,
        queue: [...(save.queues?.['helion-01'] ?? [])],
        resources: { ...save.planets?.['helion-01']?.resources },
      };
    })()`);
    if (!eventPrevented) throw new Error('Application science command event was not refused while catch-up was pending.');
    if (JSON.stringify(beforePlayerAction.queue) !== JSON.stringify(afterPlayerAction.queue)
      || beforePlayerAction.buildingLevel !== afterPlayerAction.buildingLevel) {
      throw new Error(`Building action mutated player state during replay: ${JSON.stringify({ beforePlayerAction, afterPlayerAction })}`);
    }

    const catchupStartedAt = Date.now();
    // Diagnostic only: ASTERION_QA_CPU_PROFILE=<file> records a renderer CPU
    // profile for the first ASTERION_QA_CPU_PROFILE_MS (default 20 s) of catch-up.
    const cpuProfileFile = process.env.ASTERION_QA_CPU_PROFILE;
    const cpuProfileDone = cpuProfileFile ? (async () => {
      const dbg = win.webContents.debugger;
      dbg.attach('1.3');
      await dbg.sendCommand('Profiler.enable');
      await dbg.sendCommand('Profiler.start');
      await sleep(Number(process.env.ASTERION_QA_CPU_PROFILE_MS || 20_000));
      const { profile } = await dbg.sendCommand('Profiler.stop');
      fs.writeFileSync(cpuProfileFile, JSON.stringify(profile));
      dbg.detach();
    })() : null;
    let catchupWaitError = null;
    try {
      await waitForCatchup(win, endAt);
      // Completion is written at once; give the write and its storage read a moment.
      await waitFor(win, `(() => {
        try { const save = JSON.parse(localStorage.getItem(${JSON.stringify(saveKey)}) || 'null');
          return save?.npcReplay?.processedThroughAt >= ${endAt}
            && save.npcReplay.targetAt <= save.npcReplay.processedThroughAt
            && Date.now() - save.npcReplay.processedThroughAt <= ${CATCHUP_CONVERGED_MS}; }
        catch { return false; }
      })()`, 60_000);
    } catch (error) {
      catchupWaitError = error instanceof Error ? error.message : String(error);
    }
    const elapsedMs = Date.now() - catchupStartedAt;
    if (cpuProfileDone) await cpuProfileDone;
    const measurement = await readMeasurement(win, saveKey);
    const bannerGone = catchupWaitError ? null : await waitFor(win, `!document.querySelector('[data-qa-npc-catchup]')`, 10_000)
      .then(() => true, () => false);
    if (bannerGone === false) throw new Error('NPC catch-up progress banner stayed visible after the catch-up completed.');
    if (catchupWaitError) {
      const failedResults = {
        status: 'timeout',
        profile: PROFILE,
        isolatedUserData: true,
        seed: { npcProfiles: initial.npcProfiles, npcTargets: initial.npcTargets, startAt, endAt, catchupDays: CATCHUP_DAYS,
          scenario: FULL_WORLD ? 'full-world' : 'scoped', isolation: initial.isolation, fixtureIsolation: FIXTURE_ISOLATION },
        commandGate: { pendingBeforeUiAction: beforeClickPending, requestEventPrevented: eventPrevented, buildButtonWasEnabled: buildButtonEnabled, playerStateUnchanged: true },
        catchup: { elapsedMs, ...measurement },
        error: catchupWaitError,
        measurementNote: 'Renderer event-loop timer gaps; does not measure Node proxy latency.',
        hiddenWindowBackgroundThrottling: win.webContents.getBackgroundThrottling(),
      };
      fs.mkdirSync(OUTPUT, { recursive: true });
      fs.writeFileSync(path.join(OUTPUT, 'result.json'), JSON.stringify(failedResults, null, 2));
      console.log(JSON.stringify(failedResults, null, 2));
      throw new Error(`${catchupWaitError}; diagnostic ${JSON.stringify(failedResults.catchup)}`);
    }
    if (measurement.pending || measurement.processedThroughAt < endAt
      || measurement.npcProfiles !== 100 || measurement.npcActionIds <= 0) {
      throw new Error(`Catch-up/control assertions failed: ${JSON.stringify(measurement)}`);
    }
    if (beforePlayerAction.buildingLevel !== afterPlayerAction.buildingLevel
      || JSON.stringify(beforePlayerAction.queue) !== JSON.stringify(afterPlayerAction.queue)) {
      throw new Error('Pending-command rejection did not preserve player building state.');
    }

    const results = {
      profile: PROFILE,
      isolatedUserData: true,
      seed: { npcProfiles: initial.npcProfiles, npcTargets: initial.npcTargets, startAt, endAt, catchupDays: CATCHUP_DAYS,
        scenario: FULL_WORLD ? 'full-world' : 'scoped', isolation: initial.isolation, fixtureIsolation: FIXTURE_ISOLATION },
      commandGate: { pendingBeforeUiAction: beforeClickPending, requestEventPrevented: eventPrevented, buildButtonWasEnabled: buildButtonEnabled, playerStateUnchanged: true },
      catchup: { elapsedMs, ...measurement },
      measurementNote: 'Renderer event-loop timer gaps; does not measure Node proxy latency.',
      hiddenWindowBackgroundThrottling: win.webContents.getBackgroundThrottling(),
    };
    fs.mkdirSync(OUTPUT, { recursive: true });
    fs.writeFileSync(path.join(OUTPUT, 'result.json'), JSON.stringify(results, null, 2));
    console.log(JSON.stringify(results, null, 2));
  } finally {
    if (!win.isDestroyed()) win.destroy();
  }
}

runScenario().then(() => {
  try { fs.rmSync(PROFILE, { recursive: true, force: true }); } catch { /* Windows may release it after exit */ }
  app.exit(0);
}, (error) => {
  console.error(error);
  try { fs.rmSync(PROFILE, { recursive: true, force: true }); } catch { /* Windows may release it after exit */ }
  app.exit(1);
});
