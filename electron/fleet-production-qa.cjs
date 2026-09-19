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

async function chooseFreeColonizationTarget(win) {
  await click(win, '[data-qa-route="universe"]');
  await waitFor(win, `document.querySelector('[data-qa-universe]')`);
  await click(win, '[data-qa-universe-kind="empty"]');
  await waitFor(win, `document.querySelector('[data-qa-universe-inspector]')`);
  await click(win, '[data-qa-universe-special-action="colonize"]');
  await waitFor(win, `document.querySelector('.fleet-workspace-v1[data-qa-flight-launch-context]')`);
  await waitFor(win, `document.querySelector('[data-qa-flight-preview-open]') && !document.querySelector('[data-qa-flight-preview-open]').disabled`);
}

async function chooseAllyTransportTarget(win) {
  await click(win, '[data-qa-route="universe"]');
  await waitFor(win, `document.querySelector('[data-qa-universe]')`);
  await click(win, '[data-qa-universe-object="test-mode-ally-ira-vel-v1"]');
  await waitFor(win, `document.querySelector('[data-qa-universe-inspector]')`);
  await click(win, '[data-qa-universe-action="fleet"]');
  await waitFor(win, `document.querySelector('.fleet-workspace-v1[data-qa-flight-launch-context]')`);
}

async function setFleetShipQuantity(win, shipId, quantity) {
  const result = await win.webContents.executeJavaScript(`(() => {
    const input = document.querySelector(${JSON.stringify(`[data-qa-fleet-ship="${shipId}"] input[type="number"]`)});
    if (!input) return false;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    setter?.call(input, ${JSON.stringify(String(quantity))});
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    return input.value === ${JSON.stringify(String(quantity))};
  })()`);
  if (!result) throw new Error(`Could not select fleet ship ${shipId}`);
  await settle(win);
}

async function setCargoValue(win, kind, quantity) {
  const result = await win.webContents.executeJavaScript(`(() => {
    const input = document.querySelector(${JSON.stringify(`[data-qa-cargo="${kind}"]`)});
    if (!input) return false;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    setter?.call(input, ${JSON.stringify(String(quantity))});
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    return input.value === ${JSON.stringify(String(quantity))};
  })()`);
  if (!result) throw new Error(`Could not set transport cargo ${kind}`);
  await settle(win);
}

async function runTransportUiCycle(win, label) {
  await seedProductionSave(win, (save, planetState) => {
    planetState.fleet.ships.transporter = 1;
    planetState.buildings = { ...planetState.buildings, 'gas-production-1': 0, 'gas-production-2': 0 };
    planetState.productionBots = { ...planetState.productionBots, gas: 0 };
    planetState.resources = { ...planetState.resources, metal: 1_000, minerals: 1_000, gas: 189_000_000 };
    planetState.recycling = { ...planetState.recycling, availableDebris: 100_000 };
    save.metal = 1_000;
    save.minerals = 1_000;
    save.gas = 189_000_000;
    save.currentPlanetId = 'helion-01';
    save.planets = { 'helion-01': planetState };
    save.queues = { 'helion-01': [] };
    save.flights = { records: [], requestIndex: {} };
  });
  await click(win, '[data-qa-test-speed="15"]');
  await waitFor(win, `document.querySelector('[data-qa-test-time-scale]')?.textContent?.includes('×15')`);
  await chooseAllyTransportTarget(win);
  await setFleetShipQuantity(win, 'transporter', 1);
  await waitFor(win, `document.querySelector('[data-qa-flight-preview-open]') && !document.querySelector('[data-qa-flight-preview-open]').disabled`);
  await click(win, '[data-qa-flight-preview-open]');
  await waitFor(win, `document.querySelector('[data-qa-flight-preview-backdrop]')`);
  const beforeCargo = await win.webContents.executeJavaScript(`(() => ({
    relation: document.querySelector('.fleet-workspace-v1')?.getAttribute('data-qa-target-relation') || '',
    kinds: Array.from(document.querySelectorAll('[data-qa-flight-cargo] input')).map((input) => input.getAttribute('data-qa-cargo') || ''),
    hasEnergy: Boolean(document.querySelector('[data-qa-flight-cargo] [data-qa-cargo="energy"]')),
    capacity: document.querySelector('[data-qa-flight-cargo]')?.getAttribute('data-qa-cargo-capacity') || '',
  }))()`);
  if (beforeCargo.relation !== 'ally' || JSON.stringify(beforeCargo.kinds) !== JSON.stringify(['metal', 'minerals', 'gas', 'debris']) || beforeCargo.hasEnergy || !beforeCargo.capacity) {
    throw new Error(`${label}: transport cargo editor contract failed ${JSON.stringify(beforeCargo)}`);
  }
  await setCargoValue(win, 'metal', 100);
  await setCargoValue(win, 'minerals', 50);
  await setCargoValue(win, 'gas', 25);
  await setCargoValue(win, 'debris', 10);
  const cargo = await win.webContents.executeJavaScript(`(() => ({
    values: Object.fromEntries(Array.from(document.querySelectorAll('[data-qa-flight-cargo] input')).map((input) => [input.getAttribute('data-qa-cargo') || '', Number(input.value)])),
    overflow: Boolean(document.querySelector('[data-qa-transport-overflow-warning]')),
  }))()`);
  if (JSON.stringify(cargo.values) !== JSON.stringify({ metal: 100, minerals: 50, gas: 25, debris: 10 }) || cargo.overflow) {
    throw new Error(`${label}: transport cargo values/warning mismatch ${JSON.stringify(cargo)}`);
  }
  await click(win, '[data-qa-flight-dispatch-confirm]');
  await waitFor(win, `document.querySelector('[data-qa-flight-row]')`);
  const persisted = await readSave(win);
  const flight = persisted.flights?.records?.find((record) => record.missionId === 'transport');
  if (!flight || flight.targetRelation !== 'ally' || flight.cargoState !== 'loaded' || JSON.stringify(flight.cargo) !== JSON.stringify({ metal: 100, minerals: 50, gas: 25, debris: 10 })) {
    throw new Error(`${label}: transport dispatch was not persisted atomically ${JSON.stringify({ flight, resources: persisted.planets?.['helion-01']?.resources })}`);
  }
  return { relation: flight.targetRelation, cargo: flight.cargo, phase: flight.phase, capacity: beforeCargo.capacity };
}

async function runFlightRuntimeCycle(win, label) {
  await seedProductionSave(win, (save, planetState) => {
    planetState.fleet.ships.colonizer = 1;
    // Keep the recall assertion deterministic. Resource production is tested
    // separately; passive gas income must not race the no-refund check.
    planetState.buildings = { ...planetState.buildings, 'gas-production-1': 0, 'gas-production-2': 0 };
    planetState.productionBots = { ...planetState.productionBots, gas: 0 };
    planetState.resources = { ...planetState.resources, gas: 189_000_000 };
    save.gas = 189_000_000;
    save.currentPlanetId = 'helion-01';
    save.planets = { 'helion-01': planetState };
    save.queues = { 'helion-01': [] };
    save.flights = { records: [], requestIndex: {} };
  });

  await click(win, '[data-qa-test-speed="15"]');
  await waitFor(win, `document.querySelector('[data-qa-test-time-scale]')?.textContent?.includes('×15')`);
  await chooseFreeColonizationTarget(win);
  await click(win, '[data-qa-flight-preview-open]');
  await waitFor(win, `document.querySelector('[data-qa-flight-preview-backdrop]')`);
  await click(win, '[data-qa-flight-dispatch-confirm]');
  await waitFor(win, `document.querySelector('[data-qa-flight-row]')`);
  const outbound = await win.webContents.executeJavaScript(`(() => {
    const row = document.querySelector('[data-qa-flight-row]');
    return { phase: row?.getAttribute('data-qa-flight-phase') || '', target: row?.querySelector('[data-qa-flight-target]')?.textContent?.trim() || '' };
  })()`);
  if (outbound.phase !== 'outbound' || !outbound.target) throw new Error(`${label}: UI did not render the active outbound flight ${JSON.stringify(outbound)}`);

  await click(win, '[data-qa-flight-recall]');
  await waitFor(win, `document.querySelector('[data-qa-flight-recall-backdrop]')`);
  await click(win, '[data-qa-flight-recall-confirm]');
  await waitFor(win, `document.querySelector('[data-qa-flight-row]')?.getAttribute('data-qa-flight-phase') === 'returning'`);
  const returning = await win.webContents.executeJavaScript(`(() => {
    const row = document.querySelector('[data-qa-flight-row]');
    return { phase: row?.getAttribute('data-qa-flight-phase') || '', timer: row?.querySelector('[data-qa-flight-return]')?.textContent?.trim() || '—' };
  })()`);
  if (returning.phase !== 'returning' || returning.timer === '—') throw new Error(`${label}: recall did not render the reverse timer ${JSON.stringify(returning)}`);
  const gasAfterRecall = (await readSave(win)).gas;
  await waitFor(win, `(() => {
    const save = JSON.parse(localStorage.getItem(${JSON.stringify(TEST_KEY)}) || '{}');
    const flight = save.flights?.records?.find((item) => item.completionReason === 'recalled');
    return flight?.phase === 'completed' && save.planets?.['helion-01']?.fleet?.ships?.colonizer === 1;
  })()`);
  const recalledSave = await readSave(win);
  if (recalledSave.gas !== gasAfterRecall || recalledSave.planets?.['helion-01']?.fleet?.ships?.colonizer !== 1) {
    throw new Error(`${label}: recall changed gas or failed to return the colonizer ${JSON.stringify({ gasAfterRecall, recalledSave })}`);
  }

  await reload(win);
  await click(win, '[data-qa-route="fleets"]');
  await waitFor(win, `document.querySelector('.fleet-workspace-v1')`);
  if (await win.webContents.executeJavaScript(`Boolean(document.querySelector('[data-qa-flight-row]'))`)) throw new Error(`${label}: recalled flight reappeared after reload`);

  await click(win, '[data-qa-test-speed="500"]');
  await waitFor(win, `document.querySelector('[data-qa-test-time-scale]')?.textContent?.includes('×500')`);
  await chooseFreeColonizationTarget(win);
  await click(win, '[data-qa-flight-preview-open]');
  await waitFor(win, `document.querySelector('[data-qa-flight-preview-backdrop]')`);
  await click(win, '[data-qa-flight-dispatch-confirm]');
  await waitFor(win, `document.querySelector('[data-qa-flight-row]')`);
  const successfulTarget = await win.webContents.executeJavaScript(`document.querySelector('[data-qa-flight-target]')?.textContent?.trim() || ''`);
  await waitFor(win, `(() => {
    const save = JSON.parse(localStorage.getItem(${JSON.stringify(TEST_KEY)}) || '{}');
    return save.flights?.records?.some((item) => item.phase === 'completed' && item.completionReason === 'colonized')
      && Object.keys(save.planets || {}).some((id) => id.startsWith('planet-'))
      && save.planets?.['helion-01']?.fleet?.ships?.colonizer === 0;
  })()`);
  await waitFor(win, `!document.querySelector('[data-qa-flight-row]')`);
  const arrivedSave = await readSave(win);
  const colonyId = Object.keys(arrivedSave.planets || {}).find((id) => id.startsWith('planet-'));
  if (!colonyId || !/^planet-\d+-\d+-\d+$/.test(colonyId) || arrivedSave.planets['helion-01'].fleet.ships.colonizer !== 0) {
    throw new Error(`${label}: successful arrival did not create a deterministic colony or consume the colonizer ${JSON.stringify({ successfulTarget, colonyId, arrivedSave })}`);
  }

  await reload(win);
  await click(win, '[data-qa-route="fleets"]');
  await waitFor(win, `document.querySelector('.fleet-workspace-v1')`);
  const persisted = await readSave(win);
  const persistedColonyId = Object.keys(persisted.planets || {}).find((id) => id.startsWith('planet-'));
  const persistedColonized = persisted.flights?.records?.some((item) => item.phase === 'completed' && item.completionReason === 'colonized');
  const persistedNoActiveRow = !(await win.webContents.executeJavaScript(`Boolean(document.querySelector('[data-qa-flight-row]'))`));
  if (persistedColonyId !== colonyId || !persistedColonized || persisted.planets['helion-01'].fleet.ships.colonizer !== 0 || !persistedNoActiveRow) {
    throw new Error(`${label}: successful arrival was not durable after reload ${JSON.stringify({ colonyId, persistedColonyId, persistedColonized, persistedNoActiveRow })}`);
  }
  return { recalledPhase: 'returning', successfulPhase: 'completed', colonyId, persisted: true };
}

async function capture(win, directory, name) {
  if (skipScreenshots) return;
  fs.mkdirSync(directory, { recursive: true });
  // A hidden BrowserWindow can retain its initial planet texture even after
  // React navigates to the fleet route. Let Chromium paint the active surface
  // before capturing so the visual artifact represents the asserted DOM.
  win.showInactive();
  await sleep(180);
  const { width, height } = await win.webContents.executeJavaScript('({ width: innerWidth, height: innerHeight })');
  await win.webContents.executeJavaScript('window.scrollTo(0, 0)');
  await sleep(120);
  const image = await win.capturePage({ x: 0, y: 0, width, height });
  fs.writeFileSync(path.join(directory, `${name}.png`), image.toPNG());
  win.hide();
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
    const missionSlots = await win.webContents.executeJavaScript(`Array.from(document.querySelectorAll('.fleet-mission-icons-v1 button')).map((button) => {
      const buttonRect = button.getBoundingClientRect();
      const image = button.querySelector('img');
      const imageRect = image?.getBoundingClientRect();
      const buttonStyle = getComputedStyle(button);
      const imageStyle = image ? getComputedStyle(image) : null;
      return {
        label: button.getAttribute('aria-label') || '',
        button: { x: buttonRect.x, y: buttonRect.y, width: buttonRect.width, height: buttonRect.height },
        image: imageRect ? { x: imageRect.x, y: imageRect.y, width: imageRect.width, height: imageRect.height } : null,
        naturalWidth: image?.naturalWidth || 0,
        naturalHeight: image?.naturalHeight || 0,
        buttonOverflow: buttonStyle.overflow,
        objectFit: imageStyle?.objectFit || '',
      };
    })`);
    const missionIconsFit = missionSlots.length === 9 && missionSlots.every((slot) => {
      const button = slot.button;
      const image = slot.image;
      const epsilon = 0.5;
      return button.width > 0 && Math.abs(button.width - button.height) <= epsilon && image && image.width > 0 && Math.abs(image.width - image.height) <= epsilon && image.x >= button.x - epsilon && image.y >= button.y - epsilon && image.x + image.width <= button.x + button.width + epsilon && image.y + image.height <= button.y + button.height + epsilon && slot.naturalWidth > 0 && slot.naturalHeight > 0 && slot.objectFit === 'contain';
    });
    if (!missionIconsFit) throw new Error(`${label}: mission icon slot contract failed ${JSON.stringify(missionSlots)}`);

    await click(win, '[data-qa-fleet-section="ships"]');
    await waitFor(win, `document.querySelector('[data-qa-construction-mode="ships"]')`);
    const ordinaryLevel = await win.webContents.executeJavaScript(`(() => {
      const level = document.querySelector('[data-qa-fleet-visible-level="scout"]');
      const rect = level?.getBoundingClientRect();
      const style = level ? getComputedStyle(level) : null;
      return {
        text: level?.textContent?.replace(/\\s+/g, ' ').trim() ?? '',
        visible: Boolean(level && rect && rect.width > 0 && rect.height > 0 && style?.visibility !== 'hidden' && Number(style?.opacity ?? 0) > 0),
      };
    })()`);
    if (!ordinaryLevel.text.includes('0/10') || !ordinaryLevel.visible) throw new Error(`${label}: ordinary level is not visibly rendered as 0/10: ${JSON.stringify(ordinaryLevel)}`);
    const ordinaryTimerText = await win.webContents.executeJavaScript(`document.querySelector('[data-qa-unit-time="scout"]')?.textContent ?? ''`);
    if (ordinaryTimerText.includes('УРОВЕНЬ')) throw new Error(`${label}: ordinary ship level still appears under the unit timer: ${ordinaryTimerText}`);
    const ordinaryDossierLevelLabel = await win.webContents.executeJavaScript(`document.querySelector('[data-qa-fleet-level="scout"] small')?.textContent ?? ''`);
    if (!ordinaryDossierLevelLabel.includes('Уровень корабля')) throw new Error(`${label}: ordinary dossier level label is wrong: ${ordinaryDossierLevelLabel}`);
    const queuePlacement = await win.webContents.executeJavaScript(`(() => {
      const queue = document.querySelector('[data-qa-fleet-production-queue="ships"]');
      const sidebar = queue?.closest('.fleet-sidebar-v1');
      const main = queue?.closest('.fleet-main-v1');
      const simulator = Array.from(document.querySelectorAll('.fleet-menu-group-v1 button'))
        .find((node) => node.textContent?.replace(/\\s+/g, ' ').trim().includes('Симулятор'));
      const followsSimulator = Boolean(queue && simulator && (simulator.compareDocumentPosition(queue) & Node.DOCUMENT_POSITION_FOLLOWING));
      return {
        inSidebar: Boolean(sidebar),
        inMain: Boolean(main),
        followsSimulator,
        hasMainStrip: Boolean(document.querySelector('.fleet-main-v1 .fleet-production-queue-v1')),
        heading: queue?.querySelector('.fleet-production-queue-head-v1')?.textContent?.replace(/\\s+/g, ' ').trim() ?? '',
      };
    })()`);
    if (!queuePlacement.inSidebar || queuePlacement.inMain || !queuePlacement.followsSimulator || queuePlacement.hasMainStrip || !queuePlacement.heading.includes('ТЕКУЩИЕ ПРОЦЕССЫ')) {
      throw new Error(`${label}: fleet queue placement contract failed ${JSON.stringify(queuePlacement)}`);
    }
    if (!(await win.webContents.executeJavaScript(`document.querySelector('[data-qa-fleet-production-queue="ships"]')?.textContent?.includes('Очередь свободна')`))) {
      throw new Error(`${label}: empty ordinary queue is not visible`);
    }
    const backButton = await win.webContents.executeJavaScript(`(() => {
      const button = document.querySelector('[data-qa-fleet-production-back]');
      return { text: button?.textContent?.replace(/\\s+/g, ' ').trim() ?? '', tag: button?.tagName ?? '' };
    })()`);
    if (backButton.tag !== 'BUTTON' || !backButton.text.includes('Назад к Флотам')) throw new Error(`${label}: fleet production back button is missing ${JSON.stringify(backButton)}`);
    await click(win, '[data-qa-fleet-production-back]');
    await waitFor(win, `!document.querySelector('[data-qa-construction-mode="ships"]')`);
    await click(win, '[data-qa-fleet-section="ships"]');
    await waitFor(win, `document.querySelector('[data-qa-construction-mode="ships"]')`);
    await capture(win, directory, 'ships-empty');
    await click(win, '[data-qa-fleet-production-item="scout"] button[aria-label^="Информация:"]');
    await waitFor(win, `document.querySelector('.ship-info-modal-v1')`);
    await capture(win, directory, 'ships-dossier');
    await click(win, '.ship-info-close-v1');
    await waitFor(win, `!document.querySelector('.ship-info-modal-v1')`);
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
    await capture(win, directory, 'ships-queue');

    await click(win, '[data-qa-fleet-section="defense"]');
    await waitFor(win, `document.querySelector('[data-qa-construction-mode="defense"]')`);
    const defensePopulation = await win.webContents.executeJavaScript(`({ population: document.querySelector('[data-qa-defense-population]')?.getAttribute('data-qa-defense-population'), capacity: document.querySelector('[data-qa-defense-capacity]')?.getAttribute('data-qa-defense-capacity') })`);
    if (defensePopulation.population !== '0' || defensePopulation.capacity !== '120') throw new Error(`${label}: defense pool fixture mismatch ${JSON.stringify(defensePopulation)}`);
    const defensePopulationPanel = await win.webContents.executeJavaScript(`document.querySelector('[data-qa-population-scope="НАСЕЛЕНИЕ ОБОРОНЫ"]')?.textContent?.replace(/\\s+/g, ' ').trim() ?? ''`);
    if (!defensePopulationPanel.includes('0 / 120')) throw new Error(`${label}: separate defense population panel is not visible: ${defensePopulationPanel}`);
    const defenseHeaderPopulation = await win.webContents.executeJavaScript(`({ label: document.querySelector('[data-qa-resource-chip="population"] small')?.textContent ?? '', value: document.querySelector('[data-qa-resource-chip="population"] strong')?.textContent ?? '' })`);
    if (!defenseHeaderPopulation.label.includes('НАСЕЛЕНИЕ ОБОРОНЫ') || defenseHeaderPopulation.value !== '0 / 120') {
      throw new Error(`${label}: defense header population scope is wrong ${JSON.stringify(defenseHeaderPopulation)}`);
    }
    const defenseHeaderBreakdown = await win.webContents.executeJavaScript(`Object.fromEntries(Array.from(document.querySelectorAll('[data-qa-population-breakdown-item]')).map((node) => [node.getAttribute('data-qa-population-breakdown-item'), { label: node.querySelector('small')?.textContent?.trim() ?? '', value: node.querySelector('b')?.textContent?.trim() ?? '' }]))`);
    if (defenseHeaderBreakdown.fleet?.label !== 'Корабли' || !defenseHeaderBreakdown.fleet.value.endsWith(' / 120') || defenseHeaderBreakdown.defense?.label !== 'Оборона' || defenseHeaderBreakdown.defense.value !== '0 / 120') {
      throw new Error(`${label}: shared population breakdown is wrong on defense empty ${JSON.stringify(defenseHeaderBreakdown)}`);
    }
    await capture(win, directory, 'defense-empty');
    await setQuantity(win, 'ballistic-turret', 1);
    await click(win, '[data-qa-fleet-production-item="ballistic-turret"] .shipyard-build-button-v1');
    await waitFor(win, `JSON.parse(localStorage.getItem(${JSON.stringify(TEST_KEY)}) || '{}')?.planets?.['helion-01']?.fleetProduction?.defenseQueue?.length === 1`);
    const defenseQueuePersistedAtEnqueue = (await readSave(win)).planets['helion-01'].fleetProduction.defenseQueue.length === 1;
    if (!defenseQueuePersistedAtEnqueue) throw new Error(`${label}: defense queue was not persisted immediately after enqueue`);
    await waitFor(win, `Number(document.querySelector('[data-qa-defense-population]')?.getAttribute('data-qa-defense-population') ?? '0') > 0`);
    const defenseAfterEnqueue = await win.webContents.executeJavaScript(`({ population: document.querySelector('[data-qa-defense-population]')?.getAttribute('data-qa-defense-population'), capacity: document.querySelector('[data-qa-defense-capacity]')?.getAttribute('data-qa-defense-capacity'), panel: document.querySelector('[data-qa-population-scope="НАСЕЛЕНИЕ ОБОРОНЫ"]')?.textContent?.replace(/\s+/g, ' ').trim() ?? '' })`);
    if (defenseAfterEnqueue.capacity !== '120' || !(Number(defenseAfterEnqueue.population) > 0) || defenseAfterEnqueue.panel.includes('0 / 120')) {
      throw new Error(`${label}: defense population did not reserve separately after enqueue ${JSON.stringify(defenseAfterEnqueue)}`);
    }
    await waitFor(win, `document.querySelector('[data-qa-resource-chip="population"] strong')?.textContent === '2 / 120'`);
    const defenseHeaderAfterEnqueue = await win.webContents.executeJavaScript(`({ label: document.querySelector('[data-qa-resource-chip="population"] small')?.textContent ?? '', value: document.querySelector('[data-qa-resource-chip="population"] strong')?.textContent ?? '' })`);
    if (defenseHeaderAfterEnqueue.label !== 'НАСЕЛЕНИЕ ОБОРОНЫ' || defenseHeaderAfterEnqueue.value !== '2 / 120') {
      throw new Error(`${label}: defense header population did not reserve separately ${JSON.stringify(defenseHeaderAfterEnqueue)}`);
    }
    const defenseHeaderBreakdownAfterEnqueue = await win.webContents.executeJavaScript(`Object.fromEntries(Array.from(document.querySelectorAll('[data-qa-population-breakdown-item]')).map((node) => [node.getAttribute('data-qa-population-breakdown-item'), { label: node.querySelector('small')?.textContent?.trim() ?? '', value: node.querySelector('b')?.textContent?.trim() ?? '' }]))`);
    if (defenseHeaderBreakdownAfterEnqueue.defense?.value !== '2 / 120' || !defenseHeaderBreakdownAfterEnqueue.fleet?.value?.endsWith(' / 120')) {
      throw new Error(`${label}: shared population breakdown is wrong on defense queue ${JSON.stringify(defenseHeaderBreakdownAfterEnqueue)}`);
    }
    await capture(win, directory, 'defense-queue');

    await click(win, '[data-qa-fleet-section="commander-ships"]');
    await waitFor(win, `document.querySelector('[data-qa-construction-mode="commander"]')`);
    const commanderLevel = await win.webContents.executeJavaScript(`document.querySelector('[data-qa-commander-level="corsair"]')?.textContent ?? ''`);
    if (!commanderLevel.includes('0/40')) throw new Error(`${label}: commander level is not visible as 0/40: ${commanderLevel}`);
    await capture(win, directory, 'commanders-empty');
    await click(win, '[data-qa-fleet-production-item="corsair"] button[aria-label^="Информация:"]');
    await waitFor(win, `document.querySelector('.ship-info-modal-v1')`);
    await capture(win, directory, 'commanders-dossier');
    await click(win, '.ship-info-close-v1');
    await waitFor(win, `!document.querySelector('.ship-info-modal-v1')`);
    await setQuantity(win, 'corsair', 1);
    await click(win, '[data-qa-fleet-production-item="corsair"] .shipyard-build-button-v1');
    await waitFor(win, `JSON.parse(localStorage.getItem(${JSON.stringify(TEST_KEY)}) || '{}')?.planets?.['helion-01']?.fleetProduction?.commanderQueue?.length === 1`);
    await capture(win, directory, 'commanders-queue');

    const concurrent = await readSave(win);
    const planet = concurrent.planets['helion-01'];
    if (planet.fleetProduction.shipQueue.length !== 2 || planet.fleetProduction.commanderQueue.length !== 1 || !defenseQueuePersistedAtEnqueue) {
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

    const transportCycle = await runTransportUiCycle(win, label);
    const flightCycle = await runFlightRuntimeCycle(win, label);

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
    await waitFor(win, `document.documentElement.classList.contains('asterion-long-page')`);
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
    return { viewport: label, layout, missionSlots, transportCycle, flightCycle, screenshotsSkipped: skipScreenshots };
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
