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
const OUTPUT = process.env.ASTERION_QA_OUTPUT || path.join(ROOT, 'artifacts', 'npc-replay-qa');
const LEGACY_KEY = 'asterion.vertical-slice.v1';
const DAY_MS = 24 * 60 * 60 * 1_000;
const CATCHUP_MS = 30 * DAY_MS;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const run = (win, source) => win.webContents.executeJavaScript(source);

function createProductionSave(startAt) {
  const source = `
    import { createInitialSaveState } from './src/application/persistence.ts';
    import { createDefaultNewGameConfig } from './src/domain/world/config.ts';
    const config = createDefaultNewGameConfig({ seed: 'NPCREPLAYQA2026', campaignName: 'NPC replay QA' });
    config.world = { ...config.world, galaxyCount: 10, npcCount: 100, randomPlayerStart: true };
    const state = createInitialSaveState('production', ${startAt}, config);
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

async function runScenario() {
  await app.whenReady();
  const win = new BrowserWindow({
    show: false,
    width: 1280,
    height: 720,
    webPreferences: { contextIsolation: true, sandbox: true },
  });
  win.webContents.on('console-message', (_event, _level, message) => {
    if (/\berror\b/i.test(message)) console.warn(`[renderer] ${message}`);
  });

  try {
    // First let the real application create a clean production slot, then
    // replace its payload with a source-generated, schema-current 100-NPC save.
    await load(win, '?autostart=continue');
    await waitFor(win, `document.querySelector('[data-qa-navigation="utility"]')`);
    const startAt = Date.now() - CATCHUP_MS;
    const rawSeed = createProductionSave(startAt);
    await run(win, `localStorage.setItem(${JSON.stringify(LEGACY_KEY)}, ${JSON.stringify(rawSeed)})`);
    await load(win, '?autostart=continue');
    await waitFor(win, `document.querySelector('[data-qa-navigation="utility"]')`);
    const pendingExpression = `(() => {
      try { const save = JSON.parse(localStorage.getItem(${JSON.stringify(LEGACY_KEY)}) || 'null');
        return save?.npcReplay?.targetAt > save?.npcReplay?.processedThroughAt; }
      catch { return false; }
    })()`;
    await waitFor(win, pendingExpression, 30_000);

    const initial = await run(win, `(() => {
      const save = JSON.parse(localStorage.getItem(${JSON.stringify(LEGACY_KEY)}) || '{}');
      return {
        processedThroughAt: save.npcReplay?.processedThroughAt ?? null,
        targetAt: save.npcReplay?.targetAt ?? null,
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
      const qa = { last: performance.now(), gaps: [], progress: [], lastCursor: null };
      window.__npcReplayQa = qa;
      window.__npcReplayQaTimer = window.setInterval(() => {
        const now = performance.now();
        qa.gaps.push(now - qa.last);
        qa.last = now;
        try {
          const save = JSON.parse(localStorage.getItem(${JSON.stringify(LEGACY_KEY)}) || 'null');
          const replay = save?.npcReplay;
          if (replay && replay.processedThroughAt !== qa.lastCursor) {
            qa.lastCursor = replay.processedThroughAt;
            qa.progress.push({ processedThroughAt: replay.processedThroughAt, targetAt: replay.targetAt });
          }
        } catch { /* surface a missing final save through the final assertion */ }
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
      const save = JSON.parse(localStorage.getItem(${JSON.stringify(LEGACY_KEY)}) || '{}');
      return {
        buildingLevel: save.planets?.['helion-01']?.buildings?.['metal-production-1'] ?? null,
        queue: [...(save.queues?.['helion-01'] ?? [])],
        resources: { ...save.planets?.['helion-01']?.resources },
      };
    })()`);
    await click(win, '[data-qa-building-dialog="metal-production-1"] [data-qa-build-button]');
    await sleep(100);
    const afterPlayerAction = await run(win, `(() => {
      const save = JSON.parse(localStorage.getItem(${JSON.stringify(LEGACY_KEY)}) || '{}');
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
    await waitFor(win, `(() => {
      try { const save = JSON.parse(localStorage.getItem(${JSON.stringify(LEGACY_KEY)}) || 'null');
        return save?.npcReplay?.targetAt <= save?.npcReplay?.processedThroughAt; }
      catch { return false; }
    })()`, 120_000);
    const elapsedMs = Date.now() - catchupStartedAt;
    const measurement = await run(win, `(() => {
      clearInterval(window.__npcReplayQaTimer);
      const qa = window.__npcReplayQa || { gaps: [], progress: [] };
      const sorted = [...qa.gaps].sort((a, b) => a - b);
      const p95 = sorted.length ? sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * .95) - 1)] : null;
      const save = JSON.parse(localStorage.getItem(${JSON.stringify(LEGACY_KEY)}) || 'null');
      const targets = Object.values(save?.espionage?.targets ?? {}).filter((target) => target.kind === 'npc');
      return {
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
    if (measurement.pending || measurement.processedThroughAt < startAt + CATCHUP_MS
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
      seed: { npcProfiles: initial.npcProfiles, npcTargets: initial.npcTargets, startAt, catchupDays: 30 },
      commandGate: { pendingBeforeUiAction: beforeClickPending, requestEventPrevented: eventPrevented, buildButtonWasEnabled: buildButtonEnabled, playerStateUnchanged: true },
      catchup: { elapsedMs, ...measurement },
      measurementNote: 'Renderer event-loop timer gaps; does not measure Node proxy latency.',
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
