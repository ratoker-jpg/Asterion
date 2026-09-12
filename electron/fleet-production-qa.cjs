const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-gpu');
app.on('window-all-closed', () => {});

const ROOT = path.join(__dirname, '..');
const OUTPUT = process.env.ASTERION_QA_OUTPUT || path.join(ROOT, 'artifacts-pass1', 'fleet-production-qa');
const TEST_KEY = 'asterion.vertical-slice.test.v1';
const VIEWPORTS = [[1920, 1080], [1280, 720]];
const skipScreenshots = process.env.ASTERION_SKIP_SCREENSHOTS === '1';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(win, expression, timeoutMs = 10_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await win.webContents.executeJavaScript(`Boolean(${expression})`)) return;
    await sleep(50);
  }
  throw new Error(`Timed out waiting for: ${expression}`);
}

async function settle(win) {
  await sleep(100);
}

async function loadTestMode(win) {
  const done = new Promise((resolve) => win.webContents.once('did-finish-load', resolve));
  await win.loadFile(path.join(ROOT, 'dist', 'index.html'), { search: '?mode=test' });
  await done;
  await waitFor(win, `document.querySelector('[data-qa-navigation="utility"]')`);
  await waitFor(win, `localStorage.getItem(${JSON.stringify(TEST_KEY)})`);
  await settle(win);
}

async function reload(win) {
  const done = new Promise((resolve) => win.webContents.once('did-finish-load', resolve));
  win.webContents.reload();
  await done;
  await waitFor(win, `document.querySelector('[data-qa-navigation="utility"]')`);
  await waitFor(win, `localStorage.getItem(${JSON.stringify(TEST_KEY)})`);
  await settle(win);
}

async function click(win, selector) {
  const ok = await win.webContents.executeJavaScript(`(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    if (!element || element.disabled) return false;
    element.click();
    return true;
  })()`);
  if (!ok) throw new Error(`Element not found/enabled: ${selector}`);
  await settle(win);
}

async function setQuantity(win, itemId, quantity) {
  const result = await win.webContents.executeJavaScript(`(() => {
    const input = document.querySelector(${JSON.stringify(`[data-qa-fleet-production-item="${itemId}"] input[type="number"]`)});
    if (!input) return { ok: false, reason: 'missing' };
    const before = input.value;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    setter?.call(input, String(${quantity}));
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    return { ok: input.value === String(${quantity}), before, after: input.value, max: input.max, disabled: input.disabled };
  })()`);
  if (!result?.ok) throw new Error(`Could not set quantity for ${itemId}: ${JSON.stringify(result)}`);
  await settle(win);
}

async function readSave(win) {
  return win.webContents.executeJavaScript(`JSON.parse(localStorage.getItem(${JSON.stringify(TEST_KEY)}) || 'null')`);
}

async function seedProductionSave(win, mutator) {
  const ok = await win.webContents.executeJavaScript(`(() => {
    const save = JSON.parse(localStorage.getItem(${JSON.stringify(TEST_KEY)}) || 'null');
    const planet = save?.planets?.['helion-01'];
    if (!save || !planet) return false;
    (${mutator.toString()})(save, planet);
    localStorage.setItem(${JSON.stringify(TEST_KEY)}, JSON.stringify(save));
    return true;
  })()`);
  if (!ok) throw new Error('Could not seed fleet production save');
  await reload(win);
}

async function capture(win, directory, name) {
  if (skipScreenshots) return;
  fs.mkdirSync(directory, { recursive: true });
  const image = await win.capturePage({ x: 0, y: 0, width: win.getSize()[0], height: win.getSize()[1] });
  fs.writeFileSync(path.join(directory, `${name}.png`), image.toPNG());
}

async function runViewport(width, height) {
  const label = `${width}x${height}`;
  const directory = path.join(OUTPUT, label);
  const win = new BrowserWindow({ width, height, show: false, webPreferences: { sandbox: false } });
  try {
    await loadTestMode(win);
    await win.webContents.executeJavaScript(`localStorage.removeItem(${JSON.stringify(TEST_KEY)})`);
    await reload(win);
    await click(win, '[data-qa-test-speed="1"]');
    await waitFor(win, `document.querySelector('[data-qa-test-time-scale]')?.textContent?.includes('×1')`);
    await seedProductionSave(win, (_save, planetState) => {
      planetState.buildings.shipyard = 1;
      planetState.buildings['advanced-factory'] = 0;
    });

    await click(win, '[data-qa-route="fleets"]');
    await waitFor(win, `document.querySelector('.fleet-workspace-v1')`);
    const baseCardTag = await win.webContents.executeJavaScript(`document.querySelector('.fleet-yard-card-v1')?.tagName ?? ''`);
    if (baseCardTag === 'BUTTON') throw new Error(`${label}: fleet base card is still a button`);

    await click(win, '[data-qa-fleet-section="ships"]');
    await waitFor(win, `document.querySelector('[data-qa-construction-mode="ships"]')`);
    const ordinaryLevel = await win.webContents.executeJavaScript(`document.querySelector('[data-qa-fleet-level="scout"]')?.textContent ?? ''`);
    if (!ordinaryLevel.includes('0/10')) throw new Error(`${label}: ordinary level is not visible as 0/10: ${ordinaryLevel}`);
    if (!(await win.webContents.executeJavaScript(`document.querySelector('[data-qa-fleet-production-queue="ships"]')?.textContent?.includes('Очередь свободна')`))) {
      throw new Error(`${label}: empty ordinary queue is not visible`);
    }
    const timeAtOne = await win.webContents.executeJavaScript(`document.querySelector('[data-qa-unit-time="scout"] [data-qa-unit-time-effective]')?.textContent ?? ''`);
    await click(win, '[data-qa-test-speed="15"]');
    await waitFor(win, `document.querySelector('[data-qa-test-time-scale]')?.textContent?.includes('×15')`);
    const timeAtFifteen = await win.webContents.executeJavaScript(`document.querySelector('[data-qa-unit-time="scout"] [data-qa-unit-time-effective]')?.textContent ?? ''`);
    if (!timeAtOne || !timeAtFifteen || timeAtOne === timeAtFifteen) throw new Error(`${label}: Test Mode ×1/×15 preview did not use one scaled duration ${timeAtOne}/${timeAtFifteen}`);
    await click(win, '[data-qa-test-speed="1"]');
    await waitFor(win, `document.querySelector('[data-qa-test-time-scale]')?.textContent?.includes('×1')`);
    const initialFleetPopulation = Number(await win.webContents.executeJavaScript(`document.querySelector('[data-qa-fleet-population]')?.getAttribute('data-qa-fleet-population') ?? '0'`));

    await setQuantity(win, 'scout', 2);
    await click(win, '[data-qa-fleet-production-item="scout"] .shipyard-build-button-v1');
    await waitFor(win, `JSON.parse(localStorage.getItem(${JSON.stringify(TEST_KEY)}) || '{}')?.planets?.['helion-01']?.fleetProduction?.shipQueue?.length === 1`);
    const afterFirstEnqueuePopulation = Number(await win.webContents.executeJavaScript(`document.querySelector('[data-qa-fleet-population]')?.getAttribute('data-qa-fleet-population') ?? '0'`));
    if (!(afterFirstEnqueuePopulation > initialFleetPopulation)) throw new Error(`${label}: fleet population did not reserve immediately after enqueue`);
    await setQuantity(win, 'scout', 1);
    await click(win, '[data-qa-fleet-production-item="scout"] .shipyard-build-button-v1');
    await waitFor(win, `JSON.parse(localStorage.getItem(${JSON.stringify(TEST_KEY)}) || '{}')?.planets?.['helion-01']?.fleetProduction?.shipQueue?.length === 2`);
    const ordinaryText = await win.webContents.executeJavaScript(`document.querySelector('[data-qa-fleet-production-queue="ships"]')?.textContent ?? ''`);
    if (ordinaryText.includes('/3') || (await win.webContents.executeJavaScript(`document.querySelectorAll('[data-qa-fleet-production-order]').length`)) !== 2) {
      throw new Error(`${label}: ordinary queue batching or no-artificial-cap contract failed: ${ordinaryText}`);
    }

    await click(win, '[data-qa-fleet-section="defense"]');
    await waitFor(win, `document.querySelector('[data-qa-construction-mode="defense"]')`);
    const defensePopulation = await win.webContents.executeJavaScript(`({ population: document.querySelector('[data-qa-defense-population]')?.getAttribute('data-qa-defense-population'), capacity: document.querySelector('[data-qa-defense-capacity]')?.getAttribute('data-qa-defense-capacity') })`);
    if (defensePopulation.population !== '0' || defensePopulation.capacity !== '120') throw new Error(`${label}: defense pool fixture mismatch ${JSON.stringify(defensePopulation)}`);
    await setQuantity(win, 'ballistic-turret', 1);
    await click(win, '[data-qa-fleet-production-item="ballistic-turret"] .shipyard-build-button-v1');
    await waitFor(win, `JSON.parse(localStorage.getItem(${JSON.stringify(TEST_KEY)}) || '{}')?.planets?.['helion-01']?.fleetProduction?.defenseQueue?.length === 1`);

    await click(win, '[data-qa-fleet-section="commander-ships"]');
    await waitFor(win, `document.querySelector('[data-qa-construction-mode="commander"]')`);
    const commanderLevel = await win.webContents.executeJavaScript(`document.querySelector('[data-qa-commander-level="corsair"]')?.textContent ?? ''`);
    if (!commanderLevel.includes('0/40')) throw new Error(`${label}: commander level is not visible as 0/40: ${commanderLevel}`);
    await setQuantity(win, 'corsair', 1);
    await click(win, '[data-qa-fleet-production-item="corsair"] .shipyard-build-button-v1');
    await waitFor(win, `JSON.parse(localStorage.getItem(${JSON.stringify(TEST_KEY)}) || '{}')?.planets?.['helion-01']?.fleetProduction?.commanderQueue?.length === 1`);

    const concurrent = await readSave(win);
    const planet = concurrent.planets['helion-01'];
    if (planet.fleetProduction.shipQueue.length !== 2 || planet.fleetProduction.defenseQueue.length !== 1 || planet.fleetProduction.commanderQueue.length !== 1) {
      throw new Error(`${label}: three independent queues were not persisted ${JSON.stringify(planet.fleetProduction)}`);
    }

    await click(win, '[data-qa-fleet-section="ships"]');
    await waitFor(win, `document.querySelector('[data-qa-construction-mode="ships"]')`);
    const beforeCancel = await readSave(win);
    const canceledId = beforeCancel.planets['helion-01'].fleetProduction.shipQueue[0].id;
    const beforeCancelPopulation = Number(await win.webContents.executeJavaScript(`document.querySelector('[data-qa-fleet-population]')?.getAttribute('data-qa-fleet-population') ?? '0'`));
    await win.webContents.executeJavaScript(`document.querySelector(${JSON.stringify(`[data-qa-fleet-production-order="${canceledId}"] button`)})?.click()`);
    await waitFor(win, `JSON.parse(localStorage.getItem(${JSON.stringify(TEST_KEY)}) || '{}')?.planets?.['helion-01']?.fleetProduction?.shipQueue?.length === 1`);
    const afterCancel = await readSave(win);
    const afterCancelPopulation = Number(await win.webContents.executeJavaScript(`document.querySelector('[data-qa-fleet-population]')?.getAttribute('data-qa-fleet-population') ?? '0'`));
    if (afterCancel.planets['helion-01'].fleetProduction.shipQueue[0].id === canceledId || afterCancel.metal <= beforeCancel.metal || !(afterCancelPopulation < beforeCancelPopulation)) {
      throw new Error(`${label}: selected batch cancellation/refund failed`);
    }

    await seedProductionSave(win, (save, planetState) => {
      const seedNow = Date.now();
      planetState.fleetProduction = {
        shipQueue: [{ id: 'qa-offline-fleet', queueKind: 'ships', itemId: 'scout', quantity: 1, completedQuantity: 0, enqueuedAt: seedNow - 2_000, startedAt: seedNow - 2_000, finishAt: seedNow - 1_000, effectiveDurationMs: 1_000, cost: { metal: 1, minerals: 1, gas: 0 }, refundEligible: true }],
        defenseQueue: [],
        commanderQueue: [],
      };
    });
    const offlineOnce = await readSave(win);
    if (offlineOnce.planets['helion-01'].fleet.ships.scout !== 21 || offlineOnce.planets['helion-01'].fleetProduction.shipQueue.length !== 0) {
      throw new Error(`${label}: offline fleet completion failed ${JSON.stringify(offlineOnce.planets['helion-01'].fleetProduction)}`);
    }
    await reload(win);
    const offlineTwice = await readSave(win);
    if (offlineTwice.planets['helion-01'].fleet.ships.scout !== 21 || offlineTwice.planets['helion-01'].fleetProduction.shipQueue.length !== 0) {
      throw new Error(`${label}: offline fleet completion duplicated after reload`);
    }

    await seedProductionSave(win, (save, planetState) => {
      const seedNow = Date.now();
      planetState.fleetProduction = {
        shipQueue: Array.from({ length: 8 }, (_, index) => ({
          id: `qa-long-${index}`,
          queueKind: 'ships',
          itemId: 'scout',
          quantity: 1,
          completedQuantity: 0,
          enqueuedAt: seedNow,
          startedAt: seedNow + index * 600_000,
          finishAt: seedNow + (index + 1) * 600_000,
          effectiveDurationMs: 600_000,
          cost: { metal: 1, minerals: 1, gas: 0 },
          refundEligible: true,
        })),
        defenseQueue: [],
        commanderQueue: [],
      };
    });
    await click(win, '[data-qa-route="fleets"]');
    await waitFor(win, `document.querySelector('.fleet-workspace-v1')`);
    await click(win, '[data-qa-fleet-section="ships"]');
    await waitFor(win, `document.querySelector('[data-qa-fleet-production-queue="ships"] [data-qa-fleet-production-order]')`);
    const layout = await win.webContents.executeJavaScript(`(() => {
      const list = document.querySelector('[data-qa-fleet-production-queue="ships"] .fleet-production-queue-list-v1');
      const styles = list ? getComputedStyle(list) : null;
      return {
        horizontalOverflow: document.documentElement.scrollWidth > innerWidth + 2 || document.body.scrollWidth > innerWidth + 2,
        longPage: document.documentElement.classList.contains('asterion-long-page'),
        orderCount: document.querySelectorAll('[data-qa-fleet-production-queue="ships"] [data-qa-fleet-production-order]').length,
        queueOverflowY: styles?.overflowY ?? '',
        queueMaxHeight: styles?.maxHeight ?? '',
        queueScrollHeight: list?.scrollHeight ?? 0,
        queueClientHeight: list?.clientHeight ?? 0,
      };
    })()`);
    if (layout.horizontalOverflow || !layout.longPage || layout.orderCount !== 8 || layout.queueOverflowY !== 'visible' || layout.queueMaxHeight !== 'none' || layout.queueScrollHeight < layout.queueClientHeight) throw new Error(`${label}: fleet production layout overflow/long-page contract failed ${JSON.stringify(layout)}`);
    await capture(win, directory, 'fleet-production');
    return { viewport: label, layout, screenshotsSkipped: skipScreenshots };
  } finally {
    if (!win.isDestroyed()) await win.close();
  }
}

async function main() {
  fs.mkdirSync(OUTPUT, { recursive: true });
  const results = [];
  try {
    for (const [width, height] of VIEWPORTS) results.push(await runViewport(width, height));
    console.log(JSON.stringify({ results }, null, 2));
  } finally {
    app.quit();
  }
}

app.whenReady().then(main).catch((error) => {
  console.error(error.stack || error);
  app.exit(1);
});
