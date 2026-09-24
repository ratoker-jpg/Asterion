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

async function setRendererNow(win, now) {
  const result = await win.webContents.executeJavaScript(`(() => {
    if (!window.__qaOriginalDateNow) window.__qaOriginalDateNow = Date.now.bind(Date);
    window.__qaMockNow = ${Number(now)};
    Date.now = () => window.__qaMockNow;
    return Date.now();
  })()`);
  if (result !== Number(now)) throw new Error(`Could not set renderer clock to ${now}`);
}

async function restoreRendererNow(win) {
  await win.webContents.executeJavaScript(`(() => {
    if (window.__qaOriginalDateNow) Date.now = window.__qaOriginalDateNow;
    delete window.__qaMockNow;
    delete window.__qaOriginalDateNow;
  })()`);
}

async function readGasCandidate(win) {
  return win.webContents.executeJavaScript(`(() => {
    const flight = document.querySelector('[data-qa-flight-preview]');
    return {
      now: Date.now(),
      departedAt: Number(flight?.getAttribute('data-qa-flight-preview-departed-at')),
      arrivalAt: Number(flight?.getAttribute('data-qa-flight-preview-arrival-at')),
      speed: Number(flight?.getAttribute('data-qa-flight-preview-speed')),
      duration: Number(flight?.getAttribute('data-qa-flight-preview-duration')),
      hit: document.querySelector('[data-qa-gas-asteroid-hit]')?.getAttribute('data-qa-gas-asteroid-hit') || '',
      sendDisabled: document.querySelector('[data-qa-flight-dispatch-confirm]')?.disabled ?? true,
      reconfirm: Boolean(document.querySelector('[data-qa-gas-preview-reconfirmation]')),
      eta: document.querySelector('[data-qa-flight-eta]')?.textContent?.replace(/\\s+/g, ' ').trim() || '',
      forecast: document.querySelector('[data-qa-gas-asteroid-preview]')?.textContent?.replace(/\\s+/g, ' ').trim() || '',
    };
  })()`);
}

async function openGasPreviewAt(win, coordinate) {
  await click(win, '[data-qa-route="fleets"]');
  await waitFor(win, `document.querySelector('.fleet-workspace-v1')`);
  await setFleetMission(win, 'gas');
  await setFleetShipQuantity(win, 'recycler', 1);
  await click(win, '[data-qa-flight-preview-open]');
  await waitFor(win, `document.querySelector('[data-qa-flight-preview-backdrop] [data-qa-flight-target-inputs]')`);
  await setFlightCoordinate(win, 'galaxy', coordinate.galaxy);
  await setFlightCoordinate(win, 'system', coordinate.system);
  await setFlightCoordinate(win, 'position', coordinate.position);
  await click(win, '[data-qa-flight-target-step] .flight-timeline-edit');
  await waitFor(win, `document.querySelector('[data-qa-flight-preview]') && document.querySelector('[data-qa-gas-asteroid-preview]')`);
}

async function seedProductionSave(win, mutator, args = []) {
  const done = new Promise((resolve) => win.webContents.once('did-finish-load', resolve));
  const result = await win.webContents.executeJavaScript(`(() => {
    try {
      const save = JSON.parse(localStorage.getItem(${JSON.stringify(TEST_KEY)}) || 'null');
      const planet = save?.planets?.['helion-01'];
      if (!save || !planet) return { ok: false, error: 'missing test save or homeworld' };
      (${mutator.toString()})(save, planet, ...${JSON.stringify(args)});
      localStorage.setItem(${JSON.stringify(TEST_KEY)}, JSON.stringify(save));
      return { ok: true };
    } catch (error) {
      return { ok: false, error: String(error?.stack || error) };
    }
  })()`);
  if (!result?.ok) throw new Error(`Could not seed fleet production save: ${result?.error || 'unknown error'}`);
  win.webContents.reload();
  await done;
  await waitFor(win, `document.querySelector('[data-qa-navigation="utility"]')`);
  await waitFor(win, `localStorage.getItem(${JSON.stringify(TEST_KEY)})`);
  await settle(win);
}

async function setStoredSourceGas(win, gas) {
  const done = new Promise((resolve) => win.webContents.once('did-finish-load', resolve));
  const ok = await win.webContents.executeJavaScript(`(() => {
    const save = JSON.parse(localStorage.getItem(${JSON.stringify(TEST_KEY)}) || 'null');
    const planet = save?.planets?.['helion-01'];
    if (!save || !planet) return false;
    save.gas = ${JSON.stringify(gas)};
    planet.resources = { ...planet.resources, gas: ${JSON.stringify(gas)} };
    localStorage.setItem(${JSON.stringify(TEST_KEY)}, JSON.stringify(save));
    return true;
  })()`);
  if (!ok) throw new Error('Could not set stored source gas');
  win.webContents.reload();
  await done;
  await waitFor(win, `document.querySelector('[data-qa-navigation="utility"]')`);
  await waitFor(win, `localStorage.getItem(${JSON.stringify(TEST_KEY)})`);
  await settle(win);
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

async function setFleetMission(win, missionId) {
  const result = await win.webContents.executeJavaScript(`(() => {
    const select = document.querySelector('#fleet-mission');
    if (!select) return false;
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set;
    setter?.call(select, ${JSON.stringify(missionId)});
    select.dispatchEvent(new Event('change', { bubbles: true }));
    return select.value === ${JSON.stringify(missionId)};
  })()`);
  if (!result) throw new Error(`Could not choose fleet mission ${missionId}`);
  await settle(win);
}

async function setFlightCoordinate(win, field, value) {
  const result = await win.webContents.executeJavaScript(`(() => {
    const input = document.querySelector(${JSON.stringify(`[name="flight-preview-target-${field}"]`)});
    if (!input) return false;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    setter?.call(input, ${JSON.stringify(String(value))});
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    return input.value === ${JSON.stringify(String(value))};
  })()`);
  if (!result) throw new Error(`Could not set flight coordinate ${field}`);
  await settle(win);
}

async function setUniverseSystem(win, system) {
  const result = await win.webContents.executeJavaScript(`(() => {
    const select = document.querySelector('[aria-label="Солнечная система"]');
    if (!select) return false;
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set;
    setter?.call(select, ${JSON.stringify(String(system))});
    select.dispatchEvent(new Event('change', { bubbles: true }));
    return select.value === ${JSON.stringify(String(system))};
  })()`);
  if (!result) throw new Error(`Could not select universe system ${system}`);
  await waitFor(win, `document.querySelector('[data-qa-universe-system="${system}"]')`);
}

async function selectTransportTarget(win, targetId) {
  const result = await win.webContents.executeJavaScript(`(() => {
    const select = document.querySelector('[data-qa-transport-target-select] select');
    if (!select) return false;
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set;
    setter?.call(select, ${JSON.stringify(targetId)});
    select.dispatchEvent(new Event('change', { bubbles: true }));
    return select.value === ${JSON.stringify(targetId)};
  })()`);
  if (!result) throw new Error(`Could not select transport target ${targetId}`);
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

async function runTransportUiCycle(win, label, directory) {
  await seedProductionSave(win, (save, planetState) => {
    planetState.fleet.ships = {
      ...planetState.fleet.ships,
      scout: 4,
      transporter: 1,
      recycler: 1,
      colonizer: 1,
      'spy-probe': 1,
    };
    planetState.buildings = { ...planetState.buildings, 'gas-production-1': 0, 'gas-production-2': 0 };
    planetState.productionBots = { ...planetState.productionBots, gas: 0 };
    planetState.resources = { ...planetState.resources, metal: 500_000, minerals: 500_000, gas: 189_000_000 };
    planetState.recycling = { ...planetState.recycling, availableDebris: 100_000 };
    const ownTarget = JSON.parse(JSON.stringify(planetState));
    ownTarget.id = 'qa-own-target';
    ownTarget.name = 'QA Target';
    ownTarget.universeGalaxy = 1;
    ownTarget.universeSystem = 1;
    ownTarget.universePosition = 3;
    ownTarget.resources = { metal: 999_999_999, minerals: 999_999_999, gas: 999_999_999 };
    const ally = save.alliedPlanets?.['test-mode-ally-ira-vel-v1'];
    if (ally) ally.resources = { metal: 999_999_999, minerals: 999_999_999, gas: 999_999_999 };
    save.metal = 500_000;
    save.minerals = 500_000;
    save.gas = 189_000_000;
    save.currentPlanetId = 'helion-01';
    save.planets = { 'helion-01': planetState, 'qa-own-target': ownTarget };
    save.queues = { 'helion-01': [], 'qa-own-target': [] };
    save.flights = { records: [], requestIndex: {} };
  });
  await click(win, '[data-qa-test-speed="15"]');
  await waitFor(win, `document.querySelector('[data-qa-test-time-scale]')?.textContent?.includes('×15')`);

  await click(win, '[data-qa-route="fleets"]');
  await waitFor(win, `document.querySelector('.fleet-workspace-v1')`);
  for (const [shipId, quantity] of [['scout', 2], ['transporter', 1], ['recycler', 1], ['colonizer', 1], ['spy-probe', 1]]) {
    await setFleetShipQuantity(win, shipId, quantity);
  }
  await waitFor(win, `document.querySelector('[data-qa-flight-preview-open]') && !document.querySelector('[data-qa-flight-preview-open]').disabled`);
  await click(win, '[data-qa-flight-preview-open]');
  await waitFor(win, `document.querySelector('[data-qa-flight-preview-backdrop]')`);
  const normalTarget = await win.webContents.executeJavaScript(`(() => ({
    hasSelect: Boolean(document.querySelector('[data-qa-transport-target-select] select')),
    hasCoordinateInputs: Boolean(document.querySelector('[data-qa-flight-target-inputs]')),
    relation: document.querySelector('.fleet-workspace-v1')?.getAttribute('data-qa-target-relation') || '',
    options: Array.from(document.querySelectorAll('[data-qa-transport-target-select] option')).map((option) => option.textContent?.trim() || ''),
  }))()`);
  if (!normalTarget.hasSelect || !normalTarget.hasCoordinateInputs || normalTarget.relation === 'ally'
    || normalTarget.options.some((option) => option.includes('Союзная') || option.includes('[1:1:1]'))
    || !normalTarget.options.some((option) => option.includes('QA Target'))) {
    throw new Error(`${label}: ordinary fleet target dropdown contract failed ${JSON.stringify(normalTarget)}`);
  }
  await setFlightCoordinate(win, 'galaxy', 1);
  await setFlightCoordinate(win, 'system', 1);
  await setFlightCoordinate(win, 'position', 3);
  await setCargoValue(win, 'metal', 100);
  const manualOverflow = await win.webContents.executeJavaScript(`(() => ({
    warning: Boolean(document.querySelector('[data-qa-transport-overflow-warning]')),
    sendDisabled: Boolean(document.querySelector('[data-qa-flight-dispatch-confirm]')?.disabled),
    status: document.querySelector('[data-qa-flight-target-status]')?.className || '',
  }))()`);
  if (!manualOverflow.warning || manualOverflow.sendDisabled || manualOverflow.status.includes('is-invalid')) {
    throw new Error(`${label}: manual coordinate overflow warning contract failed ${JSON.stringify(manualOverflow)}`);
  }
  await setFlightCoordinate(win, 'position', 24);
  const beforeSend = await win.webContents.executeJavaScript(`(() => ({
    values: Object.fromEntries(['galaxy', 'system', 'position'].map((field) => [field, document.querySelector(${JSON.stringify('[name="flight-preview-target-PLACEHOLDER"]')}.replace('PLACEHOLDER', field))?.value || ''])),
    sendDisabled: Boolean(document.querySelector('[data-qa-flight-dispatch-confirm]')?.disabled),
    hasPreviewMetrics: Boolean(document.querySelector('[data-qa-flight-preview]')),
    targetError: document.querySelector('[data-qa-flight-target-status]')?.className || '',
  }))()`);
  if (JSON.stringify(beforeSend.values) !== JSON.stringify({ galaxy: '1', system: '1', position: '24' }) || beforeSend.sendDisabled || beforeSend.hasPreviewMetrics || beforeSend.targetError.includes('is-invalid')) {
    throw new Error(`${label}: valid manual coordinates were checked before Send ${JSON.stringify(beforeSend)}`);
  }
  await click(win, '[data-qa-flight-dispatch-confirm]');
  await waitFor(win, `document.querySelector('[data-qa-flight-target-status].is-invalid')`);
  const failedSend = await win.webContents.executeJavaScript(`(() => ({
    modalOpen: Boolean(document.querySelector('[data-qa-flight-preview-backdrop]')),
    values: Object.fromEntries(['galaxy', 'system', 'position'].map((field) => [field, document.querySelector(${JSON.stringify('[name="flight-preview-target-PLACEHOLDER"]')}.replace('PLACEHOLDER', field))?.value || ''])),
    sendDisabled: Boolean(document.querySelector('[data-qa-flight-dispatch-confirm]')?.disabled),
    error: document.querySelector('[data-qa-flight-target-status]')?.textContent?.trim() || '',
  }))()`);
  if (!failedSend.modalOpen || failedSend.sendDisabled || JSON.stringify(failedSend.values) !== JSON.stringify({ galaxy: '1', system: '1', position: '24' }) || !/транспортиров|доступ|занят/i.test(failedSend.error)) {
    throw new Error(`${label}: invalid target Send did not preserve editable modal state ${JSON.stringify(failedSend)}`);
  }
  await click(win, '[data-qa-flight-preview-cancel]');
  await waitFor(win, `!document.querySelector('[data-qa-flight-preview-backdrop]')`);

  await setStoredSourceGas(win, 0);
  await click(win, '[data-qa-test-speed="15"]');
  await waitFor(win, `document.querySelector('[data-qa-test-time-scale]')?.textContent?.includes('×15')`);
  await click(win, '[data-qa-route="fleets"]');
  await waitFor(win, `document.querySelector('.fleet-workspace-v1')`);
  await setFleetShipQuantity(win, 'transporter', 1);
  await waitFor(win, `document.querySelector('[data-qa-flight-preview-open]') && !document.querySelector('[data-qa-flight-preview-open]').disabled`);
  await click(win, '[data-qa-flight-preview-open]');
  await waitFor(win, `document.querySelector('[data-qa-flight-preview-backdrop]')`);
  await selectTransportTarget(win, 'qa-own-target');
  const insufficientGas = await win.webContents.executeJavaScript(`(() => ({
    sendDisabled: Boolean(document.querySelector('[data-qa-flight-dispatch-confirm]')?.disabled),
    error: document.querySelector('[data-qa-flight-preview-error]')?.textContent?.trim() || document.querySelector('[data-qa-flight-target-status]')?.textContent?.trim() || '',
  }))()`);
  if (!insufficientGas.sendDisabled || !/недостаточно газа/i.test(insufficientGas.error)) {
    throw new Error(`${label}: insufficient-gas preview did not disable Send ${JSON.stringify(insufficientGas)}`);
  }
  await click(win, '[data-qa-flight-preview-cancel]');
  await waitFor(win, `!document.querySelector('[data-qa-flight-preview-backdrop]')`);
  await setStoredSourceGas(win, 189_000_000);
  await click(win, '[data-qa-test-speed="15"]');
  await waitFor(win, `document.querySelector('[data-qa-test-time-scale]')?.textContent?.includes('×15')`);

  await chooseAllyTransportTarget(win);
  for (const [shipId, quantity] of [['scout', 2], ['transporter', 1], ['recycler', 1], ['colonizer', 1], ['spy-probe', 1]]) {
    await setFleetShipQuantity(win, shipId, quantity);
  }
  await waitFor(win, `document.querySelector('[data-qa-flight-preview-open]') && !document.querySelector('[data-qa-flight-preview-open]').disabled`);
  await click(win, '[data-qa-flight-preview-open]');
  await waitFor(win, `document.querySelector('[data-qa-flight-preview-backdrop]')`);
  await capture(win, directory, 'transport-preview');
  const beforeCargo = await win.webContents.executeJavaScript(`(() => ({
    relation: document.querySelector('.fleet-workspace-v1')?.getAttribute('data-qa-target-relation') || '',
    readOnlyTarget: document.querySelector('[data-qa-transport-target-readonly]')?.textContent?.replace(/\\s+/g, ' ').trim() || '',
    hasTargetSelect: Boolean(document.querySelector('[data-qa-transport-target-select] select')),
    hasCoordinateInputs: Boolean(document.querySelector('[data-qa-flight-target-inputs]')),
    kinds: Array.from(document.querySelectorAll('[data-qa-flight-cargo] input')).map((input) => input.getAttribute('data-qa-cargo') || ''),
    hasEnergy: Boolean(document.querySelector('[data-qa-flight-cargo] [data-qa-cargo="energy"]')),
    capacity: document.querySelector('[data-qa-flight-cargo]')?.getAttribute('data-qa-cargo-capacity') || '',
    maxValues: Object.fromEntries(Array.from(document.querySelectorAll('[data-qa-flight-cargo] input')).map((input) => [input.getAttribute('data-qa-cargo') || '', Number(input.max)])),
  }))()`);
  const totalCapacity = Number(beforeCargo.capacity.split('/')[1]);
  if (beforeCargo.relation !== 'ally' || !beforeCargo.readOnlyTarget.includes('СОЮЗНАЯ ПЛАНЕТА') || beforeCargo.hasTargetSelect || beforeCargo.hasCoordinateInputs || JSON.stringify(beforeCargo.kinds) !== JSON.stringify(['metal', 'minerals', 'gas', 'debris']) || beforeCargo.hasEnergy || !beforeCargo.capacity || beforeCargo.maxValues.metal !== totalCapacity) {
    throw new Error(`${label}: transport cargo editor contract failed ${JSON.stringify(beforeCargo)}`);
  }
  const layout = await win.webContents.executeJavaScript(`(() => {
    const list = document.querySelector('[data-qa-flight-ships]');
    const listStyle = list ? getComputedStyle(list) : null;
    const cards = Array.from(document.querySelectorAll('[data-qa-flight-ships] .flight-timeline-ship-card')).map((card) => {
      const cardRect = card.getBoundingClientRect();
      const content = Array.from(card.querySelectorAll('img, strong, small, b')).map((node) => node.getBoundingClientRect());
      return {
        height: cardRect.height,
        contentFits: content.every((rect) => rect.top >= cardRect.top - 1 && rect.bottom <= cardRect.bottom + 1),
      };
    });
    const cargoRect = document.querySelector('[data-qa-flight-cargo]')?.getBoundingClientRect();
    return {
      list: list ? { overflowY: listStyle?.overflowY || '', clientHeight: list.clientHeight, scrollHeight: list.scrollHeight } : null,
      cards,
      cargoFits: Boolean(cargoRect && cargoRect.left >= -1 && cargoRect.top >= -1 && cargoRect.right <= innerWidth + 1 && cargoRect.bottom <= innerHeight + 1),
    };
  })()`);
  if (!layout.list || layout.cards.length !== 5 || !['auto', 'scroll'].includes(layout.list.overflowY) || layout.cards.some((card) => card.height > 96 || !card.contentFits) || !layout.cargoFits || (label === '1280x720' && layout.list.scrollHeight <= layout.list.clientHeight)) {
    throw new Error(`${label}: transport composition/cargo geometry contract failed ${JSON.stringify(layout)}`);
  }
  const halfCapacity = Math.floor(totalCapacity / 2);
  await setCargoValue(win, 'metal', halfCapacity);
  const remainingCapacity = await win.webContents.executeJavaScript(`(() => ({
    metal: Number(document.querySelector('[data-qa-cargo="metal"]')?.max || 0),
    minerals: Number(document.querySelector('[data-qa-cargo="minerals"]')?.max || 0),
    gas: Number(document.querySelector('[data-qa-cargo="gas"]')?.max || 0),
  }))()`);
  if (remainingCapacity.metal !== totalCapacity || remainingCapacity.minerals !== totalCapacity - halfCapacity || remainingCapacity.gas !== totalCapacity - halfCapacity) {
    throw new Error(`${label}: cargo field maxima did not follow remaining shared capacity ${JSON.stringify({ totalCapacity, halfCapacity, remainingCapacity })}`);
  }
  await setCargoValue(win, 'metal', 100);
  await setCargoValue(win, 'minerals', 50);
  await setCargoValue(win, 'gas', 25);
  await setCargoValue(win, 'debris', 10);
  const cargo = await win.webContents.executeJavaScript(`(() => ({
    values: Object.fromEntries(Array.from(document.querySelectorAll('[data-qa-flight-cargo] input')).map((input) => [input.getAttribute('data-qa-cargo') || '', Number(input.value)])),
    overflow: Boolean(document.querySelector('[data-qa-transport-overflow-warning]')),
  }))()`);
  if (JSON.stringify(cargo.values) !== JSON.stringify({ metal: 100, minerals: 50, gas: 25, debris: 10 }) || !cargo.overflow) {
    throw new Error(`${label}: transport cargo values/warning mismatch ${JSON.stringify(cargo)}`);
  }
  await click(win, '[data-qa-flight-preview-cancel]');
  await waitFor(win, `!document.querySelector('[data-qa-flight-preview-backdrop]')`);
  const preservedSelection = await win.webContents.executeJavaScript(`(() => ({
    transporter: document.querySelector('[data-qa-fleet-ship="transporter"] input[type="number"]')?.value || '',
    previewEnabled: Boolean(document.querySelector('[data-qa-flight-preview-open]') && !document.querySelector('[data-qa-flight-preview-open]').disabled),
  }))()`);
  if (preservedSelection.transporter !== '1' || !preservedSelection.previewEnabled) throw new Error(`${label}: cancel cleared the selected fleet ${JSON.stringify(preservedSelection)}`);
  await click(win, '[data-qa-flight-preview-open]');
  await waitFor(win, `document.querySelector('[data-qa-flight-preview-backdrop]')`);
  const reopened = await win.webContents.executeJavaScript(`(() => ({
    ship: document.querySelector('[data-qa-flight-ships]')?.textContent?.replace(/\\s+/g, ' ').trim() || '',
    metal: Number(document.querySelector('[data-qa-cargo="metal"]')?.value || 0),
    minerals: Number(document.querySelector('[data-qa-cargo="minerals"]')?.value || 0),
    relation: document.querySelector('.fleet-workspace-v1')?.getAttribute('data-qa-target-relation') || '',
    readOnlyTarget: Boolean(document.querySelector('[data-qa-transport-target-readonly]')),
  }))()`);
  if (!reopened.ship.includes('Транспорт') || !reopened.ship.includes('Зонд') || reopened.metal !== 100 || reopened.minerals !== 50 || reopened.relation !== 'ally' || !reopened.readOnlyTarget) {
    throw new Error(`${label}: reopening preview did not preserve the draft ${JSON.stringify(reopened)}`);
  }
  await click(win, '[data-qa-flight-dispatch-confirm]');
  await waitFor(win, `document.querySelector('[data-qa-flight-row]')`);
  const activeOverflow = await win.webContents.executeJavaScript(`Boolean(document.querySelector('[data-qa-flight-overflow-warning]'))`);
  if (!activeOverflow) throw new Error(`${label}: active transport row lost the overflow indicator`);
  const persisted = await readSave(win);
  const flight = persisted.flights?.records?.find((record) => record.missionId === 'transport');
  if (!flight || flight.targetRelation !== 'ally' || flight.cargoState !== 'loaded' || JSON.stringify(flight.cargo) !== JSON.stringify({ metal: 100, minerals: 50, gas: 25, debris: 10 })) {
    throw new Error(`${label}: transport dispatch was not persisted atomically ${JSON.stringify({ flight, resources: persisted.planets?.['helion-01']?.resources })}`);
  }
  return { relation: flight.targetRelation, cargo: flight.cargo, phase: flight.phase, capacity: beforeCargo.capacity, layout };
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

async function runRecycleUiCycle(win, label) {
  await click(win, '[data-qa-test-speed="1"]');
  await waitFor(win, `document.querySelector('[data-qa-test-time-scale]')?.textContent?.includes('×1')`);
  await click(win, '[data-qa-route="universe"]');
  await waitFor(win, `document.querySelector('[data-qa-universe]')`);
  await setUniverseSystem(win, 1);
  const emptyTargets = await win.webContents.executeJavaScript(`Array.from(document.querySelectorAll('[data-qa-universe-kind="empty"]')).map((node) => ({
    id: node.getAttribute('data-qa-universe-object') || '',
    coordinate: (node.getAttribute('data-qa-universe-object') || '').replace(/^universe-empty-/, '').split('-').map(Number),
  })).filter((node) => node.coordinate.length === 3 && node.coordinate.every(Number.isInteger))`);
  if (emptyTargets.length < 1) throw new Error(`${label}: recycle fixture needs an empty coordinate for the validation check`);
  const target = { id: 'qa-recycle-target', coordinate: [1, 1, 3] };
  const alternate = emptyTargets.find((item) => item.coordinate.join(':') !== target.coordinate.join(':'));
  if (!alternate) throw new Error(`${label}: recycle fixture needs a second coordinate for the validation check`);

  await click(win, '[data-qa-route="fleets"]');
  await waitFor(win, `document.querySelector('.fleet-workspace-v1')`);
  await seedProductionSave(win, (save, planetState, targetCoordinate) => {
    const coordinate = { galaxy: targetCoordinate[0], system: targetCoordinate[1], position: targetCoordinate[2] };
    const recycleTarget = JSON.parse(JSON.stringify(planetState));
    recycleTarget.id = 'qa-recycle-target';
    recycleTarget.name = 'QA Recycle Target';
    recycleTarget.universeGalaxy = targetCoordinate[0];
    recycleTarget.universeSystem = targetCoordinate[1];
    recycleTarget.universePosition = targetCoordinate[2];
    recycleTarget.resources = { metal: 999_999_999, minerals: 999_999_999, gas: 999_999_999, debris: 0 };
    planetState.fleet.ships = { ...planetState.fleet.ships, recycler: 1, scout: 2, colonizer: 1 };
    planetState.buildings = { ...planetState.buildings, 'gas-production-1': 0, 'gas-production-2': 0 };
    planetState.productionBots = { ...planetState.productionBots, gas: 0 };
    planetState.resources = { ...planetState.resources, gas: 189_000_000 };
    planetState.recycling = { ...planetState.recycling, availableDebris: 0 };
    save.gas = 189_000_000;
    save.currentPlanetId = 'helion-01';
    save.planets = { 'helion-01': planetState, 'qa-recycle-target': recycleTarget };
    save.queues = { 'helion-01': [], 'qa-recycle-target': [] };
    save.flights = { records: [], requestIndex: {} };
    save.espionage = {
      ...(save.espionage || {}),
      missions: [],
      reports: [],
      hunterNotices: [],
      orbitalDebris: {
        'qa-recycle-debris-target': {
          id: 'qa-recycle-debris-target',
          targetPlanetId: 'qa-recycle-debris-target',
          targetPlanetName: 'QA debris field',
          targetOwnerId: 'npc-bot-01',
          targetCoordinate: coordinate,
          debris: 90_000,
          createdAt: Date.now(),
        },
      },
    };
  }, [target.coordinate]);

  await click(win, '[data-qa-test-speed="1"]');
  await waitFor(win, `document.querySelector('[data-qa-test-time-scale]')?.textContent?.includes('×1')`);
  await click(win, '[data-qa-route="universe"]');
  await setUniverseSystem(win, 1);
  await waitFor(win, `document.querySelector('[data-qa-universe-object="${target.id}"][data-qa-universe-kind="player"]')`);
  const debrisLabel = await win.webContents.executeJavaScript(`document.querySelector('[data-qa-universe-object="${target.id}"]')?.getAttribute('aria-label') || ''`);
  if (!debrisLabel.includes('Обломки на орбите')) throw new Error(`${label}: seeded orbital debris is not shown on the target ${debrisLabel}`);
  await click(win, `[data-qa-universe-object="${target.id}"]`);
  await waitFor(win, `document.querySelector('[data-qa-universe-inspector]')`);
  await click(win, '[data-qa-universe-action="fleet"]');
  await waitFor(win, `document.querySelector('.fleet-workspace-v1[data-qa-flight-launch-context]')`);

  await click(win, '[aria-label="Переработка"]');
  const selection = await win.webContents.executeJavaScript(`(() => ({
    mission: document.querySelector('#fleet-mission')?.value || '',
    ships: Array.from(document.querySelectorAll('[data-qa-fleet-roster] [data-qa-fleet-ship]')).map((node) => node.getAttribute('data-qa-fleet-ship')),
    previewDisabled: Boolean(document.querySelector('[data-qa-flight-preview-open]')?.disabled),
    commanderControls: Boolean(document.querySelector('[data-qa-deployment-commanders], .fleet-attack-prep-v1')),
  }))()`);
  if (selection.mission !== 'recycle' || JSON.stringify(selection.ships) !== JSON.stringify(['recycler']) || !selection.previewDisabled || selection.commanderControls) {
    throw new Error(`${label}: recycle selection contract failed ${JSON.stringify(selection)}`);
  }

  await setFleetShipQuantity(win, 'recycler', 1);
  await click(win, '[data-qa-flight-preview-open]');
  await waitFor(win, `document.querySelector('[data-qa-flight-preview-backdrop]')`);
  await click(win, '[data-qa-flight-target-step] .flight-timeline-edit');
  await waitFor(win, `document.querySelector('[data-qa-flight-target-inputs]')`);
  await setFlightCoordinate(win, 'galaxy', alternate.coordinate[0]);
  await setFlightCoordinate(win, 'system', alternate.coordinate[1]);
  await setFlightCoordinate(win, 'position', alternate.coordinate[2]);
  await click(win, '[data-qa-flight-preview-open]');
  await waitFor(win, `document.querySelector('[data-qa-flight-target-status].is-invalid')`);
  const rejectedTarget = await win.webContents.executeJavaScript(`({
    sendDisabled: Boolean(document.querySelector('[data-qa-flight-dispatch-confirm]')?.disabled),
    message: document.querySelector('[data-qa-flight-target-status]')?.textContent?.trim() || '',
  })`);
  if (!rejectedTarget.sendDisabled || !/обломк/i.test(rejectedTarget.message)) {
    throw new Error(`${label}: recycle preview bypassed target validation ${JSON.stringify(rejectedTarget)}`);
  }

  await setFlightCoordinate(win, 'galaxy', target.coordinate[0]);
  await setFlightCoordinate(win, 'system', target.coordinate[1]);
  await setFlightCoordinate(win, 'position', target.coordinate[2]);
  await click(win, '[data-qa-flight-preview-open]');
  await waitFor(win, `document.querySelector('[data-qa-flight-preview]') && !document.querySelector('[data-qa-flight-dispatch-confirm]')?.disabled`);
  await click(win, '[data-qa-flight-target-step] .flight-timeline-edit');
  const preview = await win.webContents.executeJavaScript(`({
    sendDisabled: Boolean(document.querySelector('[data-qa-flight-dispatch-confirm]')?.disabled),
    mission: document.querySelector('#fleet-mission')?.value || '',
    target: document.querySelector('[data-qa-flight-target-step]')?.textContent?.replace(/\\s+/g, ' ').trim() || '',
    arrivalTask: document.querySelector('[data-qa-flight-eta] .is-arrival em')?.textContent?.trim() || '',
    recallNote: document.querySelector('.flight-timeline-note-warning')?.textContent?.trim() || '',
  })`);
  if (preview.sendDisabled || preview.mission !== 'recycle' || !preview.target.includes(`[${target.coordinate.join(':')}]`)
    || !preview.arrivalTask.includes('сбор обломков') || !preview.recallNote.includes('переработчик') || /колонизатор/i.test(preview.recallNote)) {
    throw new Error(`${label}: validated recycle preview is not ready to send ${JSON.stringify(preview)}`);
  }
  await click(win, '[data-qa-test-speed="500"]');
  await waitFor(win, `document.querySelector('[data-qa-test-time-scale]')?.textContent?.includes('×500')`);
  await click(win, '[data-qa-flight-dispatch-confirm]');
  await waitFor(win, `document.querySelector('[data-qa-flight-row]')`);
  await waitFor(win, `(() => {
    const save = JSON.parse(localStorage.getItem(${JSON.stringify(TEST_KEY)}) || '{}');
    const flight = save.flights?.records?.find((item) => item.missionId === 'recycle');
    return flight?.cargoState === 'returned' && flight?.phase === 'completed';
  })()`, 30_000);
  const completed = await readSave(win);
  const flight = completed.flights?.records?.find((item) => item.missionId === 'recycle');
  const collected = Math.min(90_000, flight?.recycleCapacity ?? 0);
  const remaining = completed.espionage?.orbitalDebris?.['qa-recycle-debris-target']?.debris ?? 0;
  const returned = completed.planets?.['helion-01']?.recycling?.availableDebris ?? 0;
  if (!flight || flight.targetKind !== 'player' || JSON.stringify(flight.selectedShips) !== JSON.stringify({ recycler: 1 })
    || flight.cargo?.debris !== collected || remaining !== 90_000 - collected || returned !== collected) {
    throw new Error(`${label}: recycle manifest/collection result failed ${JSON.stringify({ flight, collected, remaining, returned })}`);
  }
  await reload(win);
  const reloaded = await readSave(win);
  const persistedFlight = reloaded.flights?.records?.find((item) => item.missionId === 'recycle');
  if (reloaded.flights?.records?.filter((item) => item.missionId === 'recycle').length !== 1
    || reloaded.planets?.['helion-01']?.recycling?.availableDebris !== collected
    || persistedFlight?.cargo?.debris !== collected
    || (reloaded.espionage?.orbitalDebris?.['qa-recycle-debris-target']?.debris ?? 0) !== 90_000 - collected) {
    throw new Error(`${label}: recycle cargo was collected more than once after reload ${JSON.stringify({ persistedFlight, reloaded })}`);
  }
  return { target: target.coordinate, alternate: alternate.coordinate, manifest: flight.selectedShips, capacity: flight.recycleCapacity, collected, remaining, returned, persistedOnce: true };
}

async function runAsteroidRecyclerLaunch(win, label, directory) {
  await click(win, '[data-qa-route="universe"]');
  await waitFor(win, `document.querySelector('[data-qa-universe]')`);
  let asteroid = null;
  for (let system = 1; system <= 40 && !asteroid; system += 1) {
    await setUniverseSystem(win, system);
    asteroid = await win.webContents.executeJavaScript(`(() => {
      for (const node of document.querySelectorAll('[data-qa-universe-kind="asteroid"]')) {
        if (node.getAttribute('data-qa-universe-underlying-kind') !== 'empty') continue;
        const match = node.getAttribute('aria-label')?.match(/\\[(\\d+):(\\d+):(\\d+)\\]/);
        const nextMoveAt = Number(node.getAttribute('data-qa-universe-asteroid-next-move'));
        if (match && Number.isFinite(nextMoveAt)) return {
          id: node.getAttribute('data-qa-universe-object') || '',
          coordinate: match.slice(1).map(Number),
          spawnIndex: Number(node.getAttribute('data-qa-universe-asteroid-spawn-index')),
          nextMoveAt,
        };
      }
      return null;
    })()`);
  }
  if (!asteroid) throw new Error(`${label}: no active asteroid overlay on an empty coordinate was available for recycler dispatch`);

  await click(win, `[data-qa-universe-object="${asteroid.id}"]`);
  await waitFor(win, `document.querySelector('[data-qa-universe-inspector]')`);
  const asteroidActions = await win.webContents.executeJavaScript(`Array.from(document.querySelectorAll('[data-qa-universe-special-action]')).map((node) => ({
    action: node.getAttribute('data-qa-universe-special-action') || '',
    label: node.textContent?.replace(/\\s+/g, ' ').trim() || '',
    title: node.getAttribute('title') || '',
    coordinate: node.getAttribute('data-qa-universe-target-coordinate') || '',
    spawnIndex: Number(node.getAttribute('data-qa-universe-asteroid-spawn-index')),
  }))`);
  const recyclerActions = asteroidActions.filter((action) => action.action === 'asteroid-recycler');
  if (recyclerActions.length !== 1 || asteroidActions.some((action) => action.action === 'gas-extraction')
    || recyclerActions[0].label !== 'ОТПРАВИТЬ ПЕРЕРАБОТЧИКА'
    || !recyclerActions[0].title.includes('сначала собрать газ, затем обломки')
    || recyclerActions[0].coordinate !== `[${asteroid.coordinate.join(':')}]`
    || recyclerActions[0].spawnIndex !== asteroid.spawnIndex) {
    throw new Error(`${label}: asteroid inspector must expose one combined recycler action ${JSON.stringify({ asteroidActions, asteroid })}`);
  }
  await click(win, '[data-qa-universe-special-action="asteroid-recycler"]');
  await waitFor(win, `document.querySelector('.fleet-workspace-v1[data-qa-flight-launch-context]') && document.querySelector('#fleet-mission')?.value === 'gas'`);
  const gasLaunch = await win.webContents.executeJavaScript(`({
    mission: document.querySelector('#fleet-mission')?.value || '',
    coordinate: document.querySelector('.fleet-workspace-v1')?.getAttribute('data-qa-flight-launch-context') || '',
    roster: Array.from(document.querySelectorAll('[data-qa-fleet-roster] [data-qa-fleet-ship]')).map((node) => node.getAttribute('data-qa-fleet-ship')),
  })`);
  if (gasLaunch.mission !== 'gas' || gasLaunch.coordinate !== `[${asteroid.coordinate.join(':')}]` || JSON.stringify(gasLaunch.roster) !== JSON.stringify(['recycler'])) {
    throw new Error(`${label}: combined asteroid recycler action did not open a recycler-only fixed-coordinate gas-and-scrap mission ${JSON.stringify({ gasLaunch, asteroid })}`);
  }
  await setFleetShipQuantity(win, 'recycler', 1);
  await click(win, '[data-qa-flight-preview-open]');
  await waitFor(win, `document.querySelector('[data-qa-gas-asteroid-preview]')`);
  const gasPreview = await win.webContents.executeJavaScript(`(() => {
    const preview = document.querySelector('[data-qa-gas-asteroid-preview]');
    const status = preview?.querySelector('[data-qa-gas-asteroid-hit]')?.getAttribute('data-qa-gas-asteroid-hit') || '';
    const target = document.querySelector('[data-qa-flight-target-step]')?.textContent?.replace(/\\s+/g, ' ').trim() || '';
    const text = preview?.textContent?.replace(/\\s+/g, ' ') || '';
    return { visible: Boolean(preview), status, target, text, leaksHiddenStock: /СКРЫТ|скорость пополнения|текущий запас/i.test(text) };
  })()`);
  if (!gasPreview.visible || !['hit', 'miss'].includes(gasPreview.status)
    || !gasPreview.target.includes(`[${asteroid.coordinate.join(':')}]`) || gasPreview.leaksHiddenStock) {
    throw new Error(`${label}: gas arrival preview did not show the forecast while keeping gas stock hidden ${JSON.stringify({ gasPreview, asteroid })}`);
  }
  await capture(win, directory, 'gas-extraction-preview');
  await click(win, '[data-qa-flight-preview-cancel]');
  await waitFor(win, `!document.querySelector('[data-qa-flight-preview-backdrop]')`);
  return { asteroidCoordinate: asteroid.coordinate, mission: gasLaunch.mission, gasPreview: { status: gasPreview.status }, actionCount: recyclerActions.length };
}

async function runGasUiRegressions(win, label, directory) {
  const movementDelayMs = 20_000;
  await seedProductionSave(win, (save, planet, delay) => {
    const now = Date.now();
    const simulation = save.asteroidSimulation;
    if (!simulation?.asteroids?.length) throw new Error('test save has no active asteroid simulation');
    save.flights = { records: [], requestIndex: {} };
    planet.fleet.ships = { ...planet.fleet.ships, scout: 2, recycler: 2 };
    save.asteroidSimulation = {
      ...simulation,
      processedThroughAt: now,
      asteroids: simulation.asteroids.map((asteroid) => ({ ...asteroid, nextMoveAt: now + delay })),
    };
  }, [movementDelayMs]);

  const initialSave = await readSave(win);
  const asteroid = initialSave.asteroidSimulation?.asteroids?.[0];
  if (!asteroid) throw new Error(`${label}: gas UI regression fixture has no asteroid`);
  const startingCoordinate = { ...asteroid.coordinate };
  const movementAt = asteroid.nextMoveAt;

  await click(win, '[data-qa-route="fleets"]');
  await waitFor(win, `document.querySelector('.fleet-workspace-v1')`);
  await setFleetMission(win, 'transport');
  await setFleetShipQuantity(win, 'scout', 1);
  const priorMissionSelection = await win.webContents.executeJavaScript(`document.querySelector('[data-qa-fleet-ship="scout"] input')?.value || ''`);
  if (priorMissionSelection !== '1') throw new Error(`${label}: did not select a scout before switching to gas`);
  await setFleetMission(win, 'gas');
  await setFleetShipQuantity(win, 'recycler', 1);
  const roster = await win.webContents.executeJavaScript(`Array.from(document.querySelectorAll('[data-qa-fleet-roster] [data-qa-fleet-ship]')).map((node) => node.getAttribute('data-qa-fleet-ship'))`);
  if (JSON.stringify(roster) !== JSON.stringify(['recycler'])) {
    throw new Error(`${label}: gas mission roster exposed a non-recycler after mission switch ${JSON.stringify(roster)}`);
  }

  await click(win, '[data-qa-flight-preview-open]');
  await waitFor(win, `document.querySelector('[data-qa-flight-preview-backdrop] [data-qa-flight-target-inputs]')`);
  await setFlightCoordinate(win, 'galaxy', startingCoordinate.galaxy);
  await setFlightCoordinate(win, 'system', startingCoordinate.system);
  await setFlightCoordinate(win, 'position', startingCoordinate.position);
  await click(win, '[data-qa-flight-target-step] .flight-timeline-edit');
  await waitFor(win, `document.querySelector('[data-qa-flight-preview]') && document.querySelector('[data-qa-gas-asteroid-preview]')`);
  const initialPreview = await win.webContents.executeJavaScript(`(() => ({
    departedAt: Number(document.querySelector('[data-qa-flight-preview]')?.getAttribute('data-qa-flight-preview-departed-at')),
    arrivalAt: Number(document.querySelector('[data-qa-flight-preview]')?.getAttribute('data-qa-flight-preview-arrival-at')),
    target: document.querySelector('[data-qa-flight-target-step]')?.textContent?.replace(/\\s+/g, ' ').trim() || '',
  }))()`);

  await click(win, '[data-qa-flight-target-step] .flight-timeline-edit');
  await waitFor(win, `document.querySelector('[data-qa-flight-target-inputs]')`);
  await setFlightCoordinate(win, 'galaxy', 999);
  await setFlightCoordinate(win, 'system', 40);
  await setFlightCoordinate(win, 'position', 24);
  await click(win, '[data-qa-flight-target-step] .flight-timeline-edit');
  await waitFor(win, `document.querySelector('[data-qa-flight-preview]')?.getAttribute('data-qa-flight-preview-arrival-at') !== ${JSON.stringify(String(initialPreview.arrivalAt))}`);
  const editedPreview = await win.webContents.executeJavaScript(`(() => ({
    departedAt: Number(document.querySelector('[data-qa-flight-preview]')?.getAttribute('data-qa-flight-preview-departed-at')),
    arrivalAt: Number(document.querySelector('[data-qa-flight-preview]')?.getAttribute('data-qa-flight-preview-arrival-at')),
    target: document.querySelector('[data-qa-flight-target-step]')?.textContent?.replace(/\\s+/g, ' ').trim() || '',
    status: document.querySelector('[data-qa-gas-asteroid-hit]')?.getAttribute('data-qa-gas-asteroid-hit') || '',
    sendDisabled: document.querySelector('[data-qa-flight-dispatch-confirm]')?.disabled ?? true,
    text: document.querySelector('[data-qa-gas-asteroid-preview]')?.textContent?.replace(/\\s+/g, ' ') || '',
  }))()`);
  if (editedPreview.arrivalAt === initialPreview.arrivalAt
    || !editedPreview.target.includes('[999:40:24]')
    || editedPreview.status !== 'miss'
    || editedPreview.sendDisabled
    || /СКРЫТ|скорость пополнения|текущий запас/i.test(editedPreview.text)) {
    throw new Error(`${label}: gas coordinate edit did not refresh ETA/forecast or a valid miss was blocked ${JSON.stringify({ initialPreview, editedPreview })}`);
  }
  await capture(win, directory, 'gas-coordinate-edited-preview');

  await click(win, '[data-qa-flight-target-step] .flight-timeline-edit');
  await waitFor(win, `document.querySelector('[data-qa-flight-target-inputs]')`);
  await setFlightCoordinate(win, 'system', 0);
  await click(win, '[data-qa-flight-target-step] .flight-timeline-edit');
  const invalidTarget = await win.webContents.executeJavaScript(`({
    invalid: document.querySelector('[data-qa-flight-target-status]')?.classList.contains('is-invalid') ?? false,
    sendDisabled: document.querySelector('[data-qa-flight-dispatch-confirm]')?.disabled ?? false,
  })`);
  if (!invalidTarget.invalid || !invalidTarget.sendDisabled) {
    throw new Error(`${label}: invalid gas coordinates did not block dispatch ${JSON.stringify(invalidTarget)}`);
  }

  await click(win, '[data-qa-flight-target-step] .flight-timeline-edit');
  await waitFor(win, `document.querySelector('[data-qa-flight-target-inputs]')`);
  await setFlightCoordinate(win, 'system', 40);
  await click(win, '[data-qa-flight-target-step] .flight-timeline-edit');
  await waitFor(win, `document.querySelector('[data-qa-gas-asteroid-hit][data-qa-gas-asteroid-hit="miss"]')`);
  await setFleetShipQuantity(win, 'recycler', 0);
  const noRecycler = await win.webContents.executeJavaScript(`({
    selected: document.querySelector('[data-qa-fleet-ship="recycler"] input')?.value || '',
    sendDisabled: document.querySelector('[data-qa-flight-dispatch-confirm]')?.disabled ?? false,
  })`);
  if (noRecycler.selected !== '0' || !noRecycler.sendDisabled) {
    throw new Error(`${label}: gas dispatch stayed enabled without a recycler ${JSON.stringify(noRecycler)}`);
  }

  await setFleetShipQuantity(win, 'recycler', 1);
  await click(win, '[data-qa-flight-target-step] .flight-timeline-edit');
  await waitFor(win, `document.querySelector('[data-qa-flight-target-inputs]')`);
  await click(win, '[data-qa-flight-target-step] .flight-timeline-edit');
  await waitFor(win, `document.querySelector('[data-qa-gas-asteroid-hit][data-qa-gas-asteroid-hit="miss"]')`);
  const readyCandidate = await win.webContents.executeJavaScript(`(() => ({
    departedAt: Number(document.querySelector('[data-qa-flight-preview]')?.getAttribute('data-qa-flight-preview-departed-at')),
    arrivalAt: Number(document.querySelector('[data-qa-flight-preview]')?.getAttribute('data-qa-flight-preview-arrival-at')),
    status: document.querySelector('[data-qa-gas-asteroid-hit]')?.getAttribute('data-qa-gas-asteroid-hit') || '',
    sendDisabled: document.querySelector('[data-qa-flight-dispatch-confirm]')?.disabled ?? true,
  }))()`);
  if (readyCandidate.status !== 'miss' || readyCandidate.sendDisabled || readyCandidate.departedAt >= movementAt || readyCandidate.arrivalAt <= movementAt) {
    throw new Error(`${label}: gas miss candidate was not valid across the scheduled movement boundary ${JSON.stringify({ readyCandidate, movementAt })}`);
  }

  await waitFor(win, `(() => {
    const save = JSON.parse(localStorage.getItem(${JSON.stringify(TEST_KEY)}) || 'null');
    const simulation = save?.asteroidSimulation;
    const moved = simulation?.asteroids?.find((item) => item.spawnIndex === ${asteroid.spawnIndex});
    return Number(simulation?.processedThroughAt || 0) >= ${movementAt} && (!moved || moved.coordinate.galaxy !== ${startingCoordinate.galaxy} || moved.coordinate.system !== ${startingCoordinate.system} || moved.coordinate.position !== ${startingCoordinate.position});
  })()`, movementDelayMs + 10_000);
  const afterBoundary = await readSave(win);
  const movedAsteroid = afterBoundary.asteroidSimulation?.asteroids?.find((item) => item.spawnIndex === asteroid.spawnIndex);
  if (afterBoundary.asteroidSimulation?.processedThroughAt < movementAt
    || (movedAsteroid && JSON.stringify(movedAsteroid.coordinate) === JSON.stringify(startingCoordinate))) {
    throw new Error(`${label}: QA did not cross the asteroid movement boundary ${JSON.stringify({ movementAt, movedAsteroid, processedThroughAt: afterBoundary.asteroidSimulation?.processedThroughAt })}`);
  }

  const forecastBeforeSend = await readGasCandidate(win);
  if (forecastBeforeSend.departedAt !== readyCandidate.departedAt
    || forecastBeforeSend.arrivalAt !== readyCandidate.arrivalAt
    || forecastBeforeSend.hit !== 'miss'
    || forecastBeforeSend.sendDisabled) {
    throw new Error(`${label}: gas candidate changed before the movement-boundary confirmation ${JSON.stringify({ readyCandidate, forecastBeforeSend })}`);
  }
  await click(win, '[data-qa-flight-dispatch-confirm]');
  await waitFor(win, `document.querySelector('[data-qa-gas-preview-reconfirmation]')`);
  const refreshedForecast = await readGasCandidate(win);
  const noDispatchAfterRefresh = await readSave(win);
  if (!refreshedForecast.reconfirm
    || refreshedForecast.departedAt <= forecastBeforeSend.departedAt
    || refreshedForecast.arrivalAt <= refreshedForecast.departedAt
    || refreshedForecast.hit !== 'miss'
    || refreshedForecast.sendDisabled
    || noDispatchAfterRefresh.flights.records.some((flight) => flight.missionId === 'gas')) {
    throw new Error(`${label}: stale movement-boundary forecast was sent or not refreshed for confirmation ${JSON.stringify({ forecastBeforeSend, refreshedForecast, flights: noDispatchAfterRefresh.flights.records })}`);
  }
  await capture(win, directory, 'gas-movement-boundary-reconfirmation');
  await setRendererNow(win, refreshedForecast.departedAt);
  await click(win, '[data-qa-flight-dispatch-confirm]');
  await waitFor(win, `JSON.parse(localStorage.getItem(${JSON.stringify(TEST_KEY)}) || '{}')?.flights?.records?.some((flight) => flight.missionId === 'gas' && flight.destinationCoordinate?.galaxy === 999 && flight.destinationCoordinate?.system === 40 && flight.destinationCoordinate?.position === 24)`);
  const dispatchedSave = await readSave(win);
  const dispatched = dispatchedSave.flights.records.find((flight) => flight.missionId === 'gas' && flight.destinationCoordinate?.galaxy === 999 && flight.destinationCoordinate?.system === 40 && flight.destinationCoordinate?.position === 24);
  if (!dispatched
    || dispatched.departedAt !== refreshedForecast.departedAt
    || dispatched.arrivalAt !== refreshedForecast.arrivalAt
    || dispatched.phase !== 'outbound'
    || JSON.stringify(dispatched.selectedShips) !== JSON.stringify({ recycler: 1 })) {
    throw new Error(`${label}: dispatched gas flight diverged from the reconfirmed candidate or included stale ships ${JSON.stringify({ refreshedForecast, dispatched })}`);
  }
  await restoreRendererNow(win);
  return {
    priorMissionSelection,
    switchedRoster: roster,
    initialPreview,
    editedPreview: { arrivalAt: editedPreview.arrivalAt, target: editedPreview.target, status: editedPreview.status },
    invalidTarget,
    noRecycler,
    movementAt,
    forecastBeforeSend,
    refreshedForecast,
    dispatched: { departedAt: dispatched.departedAt, arrivalAt: dispatched.arrivalAt, selectedShips: dispatched.selectedShips },
  };
}

async function seedGasFreshnessSave(win, settings = {}) {
  await seedProductionSave(win, (save, planet, options) => {
    const now = Date.now();
    const simulation = save.asteroidSimulation;
    if (!simulation?.asteroids?.length) throw new Error('test save has no active asteroid simulation');
    save.flights = { records: [], requestIndex: {} };
    planet.fleet.ships = { ...planet.fleet.ships, scout: 2, recycler: 2 };
    save.asteroidSimulation = {
      ...simulation,
      processedThroughAt: now,
      asteroids: simulation.asteroids.map((asteroid) => ({ ...asteroid, nextMoveAt: now + options.movementDelayMs })),
    };
    save.science = { ...save.science, queue: [] };
    if (options.speedResearchFinishInMs != null) {
      save.science = {
        ...save.science,
        levels: { ...save.science.levels, 4: 0 },
        queue: [{
          id: 'qa-gas-flight-speed-research',
          scienceId: 4,
          planetId: 'helion-01',
          fromLevel: 0,
          toLevel: 1,
          startedAt: now,
          finishAt: now + options.speedResearchFinishInMs,
          durationMs: options.speedResearchFinishInMs,
          cost: { metal: 0, minerals: 0, gas: 0, energy: 0 },
        }],
      };
    }
  }, [settings]);
}

async function runGasFreshnessRegressions(win, label, directory) {
  const results = {};
  const movementDelayMs = 10 * 60_000;

  await seedGasFreshnessSave(win, { movementDelayMs });
  let save = await readSave(win);
  let asteroid = save.asteroidSimulation?.asteroids?.[0];
  if (!asteroid) throw new Error(`${label}: gas freshness fixture has no asteroid`);
  await openGasPreviewAt(win, asteroid.coordinate);
  const beforeExpiry = await readGasCandidate(win);
  if (beforeExpiry.sendDisabled || beforeExpiry.arrivalAt <= beforeExpiry.departedAt) {
    throw new Error(`${label}: initial gas candidate was not dispatchable ${JSON.stringify(beforeExpiry)}`);
  }

  const elapsedPastArrival = beforeExpiry.arrivalAt + 1;
  await setRendererNow(win, elapsedPastArrival);
  await click(win, '[data-qa-flight-dispatch-confirm]');
  await waitFor(win, `document.querySelector('[data-qa-gas-preview-reconfirmation]')`);
  const refreshedAfterExpiry = await readGasCandidate(win);
  save = await readSave(win);
  if (!refreshedAfterExpiry.reconfirm
    || refreshedAfterExpiry.departedAt !== elapsedPastArrival
    || refreshedAfterExpiry.arrivalAt <= elapsedPastArrival
    || save.flights.records.some((flight) => flight.missionId === 'gas')) {
    throw new Error(`${label}: expired preview was not refreshed before dispatch ${JSON.stringify({ beforeExpiry, refreshedAfterExpiry, flights: save.flights.records })}`);
  }
  await capture(win, directory, 'gas-expired-preview-refreshed');
  await click(win, '[data-qa-flight-dispatch-confirm]');
  save = await readSave(win);
  const afterExpiryDispatch = save.flights.records.find((flight) => flight.missionId === 'gas');
  if (!afterExpiryDispatch
    || afterExpiryDispatch.departedAt !== refreshedAfterExpiry.departedAt
    || afterExpiryDispatch.arrivalAt !== refreshedAfterExpiry.arrivalAt
    || afterExpiryDispatch.arrivalAt <= elapsedPastArrival
    || afterExpiryDispatch.phase !== 'outbound') {
    throw new Error(`${label}: confirming refreshed gas candidate did not create a future outbound flight ${JSON.stringify({ refreshedAfterExpiry, afterExpiryDispatch })}`);
  }
  await restoreRendererNow(win);
  results.expiredPreview = {
    oldArrivalAt: beforeExpiry.arrivalAt,
    refreshedDepartureAt: refreshedAfterExpiry.departedAt,
    savedArrivalAt: afterExpiryDispatch.arrivalAt,
    phase: afterExpiryDispatch.phase,
  };

  await seedGasFreshnessSave(win, { movementDelayMs });
  save = await readSave(win);
  asteroid = save.asteroidSimulation?.asteroids?.[0];
  if (!asteroid) throw new Error(`${label}: asteroid movement fixture has no asteroid`);
  const movementAt = asteroid.nextMoveAt;
  await openGasPreviewAt(win, asteroid.coordinate);
  const beforeMovement = await readGasCandidate(win);
  if (beforeMovement.arrivalAt >= movementAt) {
    throw new Error(`${label}: movement fixture did not place the first arrival before asteroid movement ${JSON.stringify({ beforeMovement, movementAt })}`);
  }
  const simulatedAfterMovementAt = movementAt + 1;
  await setRendererNow(win, simulatedAfterMovementAt);
  await click(win, '[data-qa-flight-dispatch-confirm]');
  await waitFor(win, `document.querySelector('[data-qa-gas-preview-reconfirmation]')`);
  const refreshedAfterMovement = await readGasCandidate(win);
  save = await readSave(win);
  if (!refreshedAfterMovement.reconfirm
    || refreshedAfterMovement.departedAt !== simulatedAfterMovementAt
    || refreshedAfterMovement.arrivalAt <= simulatedAfterMovementAt
    || refreshedAfterMovement.hit === beforeMovement.hit
    || save.flights.records.some((flight) => flight.missionId === 'gas')) {
    throw new Error(`${label}: asteroid movement did not refresh the shown forecast and require reconfirmation ${JSON.stringify({ beforeMovement, refreshedAfterMovement, movementAt, flights: save.flights.records })}`);
  }
  await capture(win, directory, 'gas-asteroid-movement-preview-refreshed');
  await click(win, '[data-qa-flight-dispatch-confirm]');
  save = await readSave(win);
  const afterMovementDispatch = save.flights.records.find((flight) => flight.missionId === 'gas');
  if (!afterMovementDispatch
    || afterMovementDispatch.departedAt !== refreshedAfterMovement.departedAt
    || afterMovementDispatch.arrivalAt !== refreshedAfterMovement.arrivalAt
    || afterMovementDispatch.effectiveSpeed !== refreshedAfterMovement.speed
    || afterMovementDispatch.oneWayDurationMs !== refreshedAfterMovement.duration
    || afterMovementDispatch.phase !== 'outbound') {
    throw new Error(`${label}: saved gas flight differs from the refreshed movement candidate ${JSON.stringify({ refreshedAfterMovement, afterMovementDispatch })}`);
  }
  await restoreRendererNow(win);
  results.asteroidMovement = {
    oldForecast: beforeMovement.hit,
    refreshedForecast: refreshedAfterMovement.hit,
    refreshedEta: refreshedAfterMovement.eta,
    savedDepartureAt: afterMovementDispatch.departedAt,
    savedArrivalAt: afterMovementDispatch.arrivalAt,
  };

  await seedGasFreshnessSave(win, { movementDelayMs, speedResearchFinishInMs: 1_500 });
  save = await readSave(win);
  asteroid = save.asteroidSimulation?.asteroids?.[0];
  const researchFinishAt = save.science.queue.find((task) => task.id === 'qa-gas-flight-speed-research')?.finishAt;
  if (!asteroid || !researchFinishAt) throw new Error(`${label}: speed-science fixture was not seeded`);
  await openGasPreviewAt(win, asteroid.coordinate);
  const beforeResearch = await readGasCandidate(win);
  await setRendererNow(win, researchFinishAt + 1);
  await waitFor(win, `JSON.parse(localStorage.getItem(${JSON.stringify(TEST_KEY)}) || '{}')?.science?.levels?.[4] === 1`, 4_000);
  await click(win, '[data-qa-flight-dispatch-confirm]');
  await waitFor(win, `document.querySelector('[data-qa-gas-preview-reconfirmation]')`);
  const refreshedAfterResearch = await readGasCandidate(win);
  save = await readSave(win);
  if (!refreshedAfterResearch.reconfirm
    || refreshedAfterResearch.speed <= beforeResearch.speed
    || refreshedAfterResearch.duration >= beforeResearch.duration
    || save.flights.records.some((flight) => flight.missionId === 'gas')) {
    throw new Error(`${label}: completed fleet-speed research was sent with a stale ETA instead of refreshing ${JSON.stringify({ beforeResearch, refreshedAfterResearch, flights: save.flights.records })}`);
  }
  await capture(win, directory, 'gas-speed-research-preview-refreshed');
  await click(win, '[data-qa-flight-dispatch-confirm]');
  save = await readSave(win);
  const afterResearchDispatch = save.flights.records.find((flight) => flight.missionId === 'gas');
  if (!afterResearchDispatch
    || afterResearchDispatch.departedAt !== refreshedAfterResearch.departedAt
    || afterResearchDispatch.arrivalAt !== refreshedAfterResearch.arrivalAt
    || afterResearchDispatch.effectiveSpeed !== refreshedAfterResearch.speed
    || afterResearchDispatch.oneWayDurationMs !== refreshedAfterResearch.duration
    || afterResearchDispatch.phase !== 'outbound') {
    throw new Error(`${label}: saved gas flight ETA differs from the speed-research candidate shown for confirmation ${JSON.stringify({ refreshedAfterResearch, afterResearchDispatch })}`);
  }
  await restoreRendererNow(win);
  results.speedResearch = {
    beforeSpeed: beforeResearch.speed,
    confirmedSpeed: refreshedAfterResearch.speed,
    beforeDuration: beforeResearch.duration,
    confirmedDuration: refreshedAfterResearch.duration,
    savedArrivalAt: afterResearchDispatch.arrivalAt,
  };
  return results;
}

async function seedPlanetSwitchSave(win) {
  await seedProductionSave(win, (save, sourcePlanet) => {
    const homeworld = JSON.parse(JSON.stringify(sourcePlanet));
    const colony = JSON.parse(JSON.stringify(sourcePlanet));
    const zeroFleet = (planet, scoutCount) => ({
      ...planet.fleet,
      ships: Object.fromEntries(Object.keys(planet.fleet.ships || {}).map((id) => [id, id === 'scout' ? scoutCount : 0])),
      commanders: Object.fromEntries(Object.keys(planet.fleet.commanders || {}).map((id) => [id, 0])),
    });
    const zeroDefense = (planet) => ({
      ...planet.defense,
      defenses: Object.fromEntries(Object.keys(planet.defense.defenses || {}).map((id) => [id, 0])),
    });
    const emptyFleetProduction = { shipQueue: [], defenseQueue: [], commanderQueue: [] };

    homeworld.id = 'helion-01';
    homeworld.name = 'Helion 01';
    homeworld.universeGalaxy = 1;
    homeworld.universeSystem = 1;
    homeworld.universePosition = 1;
    homeworld.buildings = { ...homeworld.buildings, shipyard: 15, hangar: 20, 'advanced-factory': 10 };
    homeworld.fleet = zeroFleet(homeworld, 4);
    homeworld.defense = zeroDefense(homeworld);
    homeworld.fleetProduction = emptyFleetProduction;
    homeworld.spaceportUpgrades = { ...homeworld.spaceportUpgrades, shipLevels: {}, shipQueue: [], commanderQueue: [] };
    homeworld.resources = { metal: 25_000_000, minerals: 25_000_000, gas: 25_000_000 };

    colony.id = 'qa-colony-01';
    colony.name = 'Колония QA';
    colony.universeGalaxy = 1;
    colony.universeSystem = 1;
    colony.universePosition = 2;
    colony.buildings = { ...colony.buildings, shipyard: 4, hangar: 4, 'advanced-factory': 0 };
    colony.fleet = zeroFleet(colony, 1);
    colony.defense = zeroDefense(colony);
    colony.fleetProduction = emptyFleetProduction;
    colony.spaceportUpgrades = { ...colony.spaceportUpgrades, shipLevels: {}, shipQueue: [], commanderQueue: [] };
    colony.resources = { metal: 777_000, minerals: 888_000, gas: 999_000 };

    const now = Date.now();
    const clockEntry = { lastReconciledAt: now, remainder: { metal: 0, minerals: 0, gas: 0, energy: 0 } };
    save.planets = { 'helion-01': homeworld, 'qa-colony-01': colony };
    save.currentPlanetId = 'helion-01';
    save.metal = homeworld.resources.metal;
    save.minerals = homeworld.resources.minerals;
    save.gas = homeworld.resources.gas;
    save.queues = { 'helion-01': [], 'qa-colony-01': [] };
    save.science = {
      ...save.science,
      levels: { ...save.science.levels, 4: 1, 14: 13, 15: 0, 23: 10 },
      queue: [],
    };
    save.resourceClock = { ...save.resourceClock, ...clockEntry, byPlanet: { 'helion-01': clockEntry, 'qa-colony-01': clockEntry } };
    save.flights = { records: [], requestIndex: {} };
    save.espionage = { missions: [], reports: [], hunterNotices: [], orbitalDebris: {} };
  });
}

async function selectPlanet(win, planetId) {
  await click(win, '[data-qa-current-planet]');
  await waitFor(win, `document.querySelector('[data-qa-planet-option="${planetId}"]')`);
  await click(win, `[data-qa-planet-option="${planetId}"]`);
  await waitFor(win, `document.querySelector('[data-qa-current-planet]')?.getAttribute('data-planet-id') === ${JSON.stringify(planetId)}`);
  await settle(win);
}

async function runPlanetSwitchRegression(win, label) {
  await seedPlanetSwitchSave(win);
  await click(win, '[data-qa-test-speed="1"]');
  await waitFor(win, `document.querySelector('[data-qa-test-time-scale]')?.textContent?.includes('×1')`);
  await click(win, '[data-qa-route="fleets"]');
  await waitFor(win, `document.querySelector('.fleet-workspace-v1')`);
  await setFleetShipQuantity(win, 'scout', 2);
  await waitFor(win, `document.querySelector('[data-qa-flight-preview-open]') && !document.querySelector('[data-qa-flight-preview-open]').disabled`);
  await click(win, '[data-qa-flight-preview-open]');
  await waitFor(win, `document.querySelector('[data-qa-flight-preview-backdrop]')`);
  const homeDraft = {
    planetId: await win.webContents.executeJavaScript(`document.querySelector('[data-qa-current-planet]').getAttribute('data-planet-id')`),
    yard: await win.webContents.executeJavaScript(`document.querySelector('.fleet-yard-level-v1').textContent.trim()`),
    selected: await win.webContents.executeJavaScript(`document.querySelector('[data-qa-fleet-ship="scout"] input').value`),
    previewOpen: await win.webContents.executeJavaScript(`Boolean(document.querySelector('[data-qa-flight-preview-backdrop]'))`),
  };
  if (homeDraft.planetId !== 'helion-01' || !homeDraft.yard.includes('15') || homeDraft.selected !== '2' || !homeDraft.previewOpen) {
    throw new Error(`${label}: Homeworld preview fixture failed ${JSON.stringify(homeDraft)}`);
  }

  await selectPlanet(win, 'qa-colony-01');
  await waitFor(win, `!document.querySelector('[data-qa-flight-preview-backdrop]')`);
  await waitFor(win, `document.querySelector('.fleet-yard-level-v1')?.textContent?.includes('4')`);
  const colonyDraft = await win.webContents.executeJavaScript(`(() => ({
    planetId: document.querySelector('[data-qa-current-planet]')?.getAttribute('data-planet-id') || '',
    name: document.querySelector('.fleet-yard-card-v1 small')?.textContent?.trim() || '',
    yard: document.querySelector('.fleet-yard-level-v1')?.textContent?.trim() || '',
    selected: document.querySelector('[data-qa-fleet-ship="scout"] input')?.value || '',
    previewOpen: Boolean(document.querySelector('[data-qa-flight-preview-backdrop]')),
    previewMetrics: Boolean(document.querySelector('[data-qa-flight-preview]')),
  }))()`);
  if (colonyDraft.planetId !== 'qa-colony-01' || !colonyDraft.name.includes('Колония QA') || !colonyDraft.yard.includes('4') || colonyDraft.selected !== '0' || colonyDraft.previewOpen || colonyDraft.previewMetrics) {
    throw new Error(`${label}: colony retained stale Homeworld draft ${JSON.stringify(colonyDraft)}`);
  }

  await click(win, '[data-qa-fleet-section="ships"]');
  await waitFor(win, `document.querySelector('[data-qa-construction-mode="ships"]')`);
  await setQuantity(win, 'scout', 1);
  await click(win, '[data-qa-fleet-production-item="scout"] .shipyard-build-button-v1');
  await waitFor(win, `JSON.parse(localStorage.getItem(${JSON.stringify(TEST_KEY)}) || '{}')?.planets?.['qa-colony-01']?.fleetProduction?.shipQueue?.length === 1`);
  const colonyQueue = await readSave(win);
  if (colonyQueue.planets['helion-01'].fleetProduction.shipQueue.length !== 0 || colonyQueue.planets['qa-colony-01'].fleetProduction.shipQueue.length !== 1) {
    throw new Error(`${label}: colony production crossed planet boundary ${JSON.stringify(colonyQueue.planets)}`);
  }

  await selectPlanet(win, 'helion-01');
  await waitFor(win, `document.querySelector('.fleet-yard-level-v1')?.textContent?.includes('15')`);
  const homeAfterSwitch = await readSave(win);
  const homeView = await win.webContents.executeJavaScript(`(() => ({
    selected: document.querySelector('[data-qa-fleet-ship="scout"] input')?.value || '',
    previewOpen: Boolean(document.querySelector('[data-qa-flight-preview-backdrop]')),
    yard: document.querySelector('.fleet-yard-level-v1')?.textContent?.trim() || '',
  }))()`);
  if (homeView.selected !== '0' || homeView.previewOpen || !homeView.yard.includes('15') || homeAfterSwitch.planets['helion-01'].fleetProduction.shipQueue.length !== 0 || homeAfterSwitch.planets['qa-colony-01'].fleetProduction.shipQueue.length !== 1) {
    throw new Error(`${label}: Homeworld received colony state after switching back ${JSON.stringify({ homeView, queues: { home: homeAfterSwitch.planets['helion-01'].fleetProduction.shipQueue.length, colony: homeAfterSwitch.planets['qa-colony-01'].fleetProduction.shipQueue.length } })}`);
  }

  await reload(win);
  await click(win, '[data-qa-route="fleets"]');
  await waitFor(win, `document.querySelector('.fleet-workspace-v1')`);
  const reloaded = await readSave(win);
  if (reloaded.currentPlanetId !== 'helion-01' || reloaded.planets['helion-01'].fleetProduction.shipQueue.length !== 0 || reloaded.planets['qa-colony-01'].fleetProduction.shipQueue.length !== 1) {
    throw new Error(`${label}: planet queues did not persist after reload ${JSON.stringify({ currentPlanetId: reloaded.currentPlanetId, queues: reloaded.planets })}`);
  }
  return { homeDraft, colonyDraft, homeView, queueLengths: { home: reloaded.planets['helion-01'].fleetProduction.shipQueue.length, colony: reloaded.planets['qa-colony-01'].fleetProduction.shipQueue.length } };
}

async function runPlanetoLomTrace(win, label) {
  await seedProductionSave(win, (save, planet) => {
    save.currentPlanetId = 'helion-01';
    planet.buildings = { ...planet.buildings, shipyard: 15, hangar: 20, 'advanced-factory': 10 };
    planet.resources = { metal: 25_000_000, minerals: 25_000_000, gas: 25_000_000 };
    planet.fleetProduction = { shipQueue: [], defenseQueue: [], commanderQueue: [] };
    if (save.planets['qa-colony-01']) save.planets['qa-colony-01'].fleetProduction = { shipQueue: [], defenseQueue: [], commanderQueue: [] };
    save.metal = planet.resources.metal;
    save.minerals = planet.resources.minerals;
    save.gas = planet.resources.gas;
    const scienceNow = Date.now();
    save.science = {
      ...save.science,
      levels: { ...save.science.levels, 4: 1, 14: 13, 15: 0, 23: 10 },
      queue: [{
        id: 'qa-parallel-universes-completion',
        scienceId: 15,
        fromLevel: 0,
        toLevel: 1,
        startedAt: scienceNow,
        finishAt: scienceNow + 1_500,
        durationMs: 1_500,
        cost: { metal: 0, minerals: 0, gas: 0, energy: 0 },
      }],
    };
  });
  await click(win, '[data-qa-test-speed="1"]');
  await waitFor(win, `document.querySelector('[data-qa-test-time-scale]')?.textContent?.includes('×1')`);
  await click(win, '[data-qa-route="fleets"]');
  await waitFor(win, `document.querySelector('.fleet-workspace-v1')`);
  await click(win, '[data-qa-fleet-section="ships"]');
  await waitFor(win, `document.querySelector('[data-qa-construction-mode="ships"]')`);
  const blocked = await win.webContents.executeJavaScript(`(() => {
    const row = document.querySelector('[data-qa-fleet-production-item="death-star"]');
    return {
      status: row?.getAttribute('data-qa-production-requirements') || '',
      reason: row?.getAttribute('data-qa-production-requirement-reason') || '',
      hasBuildButton: Boolean(row?.querySelector('.shipyard-build-button-v1')),
    };
  })()`);
  if (blocked.status !== 'unmet' || !blocked.reason.includes('Параллельные вселенные уровня 1') || blocked.hasBuildButton) {
    throw new Error(`${label}: Planeto-lom was not science-blocked in UI ${JSON.stringify(blocked)}`);
  }

  await waitFor(win, `document.querySelector('[data-qa-fleet-production-item="death-star"]')?.getAttribute('data-qa-production-requirements') === 'met'`);
  const unlocked = await win.webContents.executeJavaScript(`(() => ({
    status: document.querySelector('[data-qa-fleet-production-item="death-star"]')?.getAttribute('data-qa-production-requirements') || '',
    hasBuildButton: Boolean(document.querySelector('[data-qa-fleet-production-item="death-star"] .shipyard-build-button-v1')),
  }))()`);
  if (unlocked.status !== 'met' || !unlocked.hasBuildButton) throw new Error(`${label}: Planeto-lom did not unlock without reload ${JSON.stringify(unlocked)}`);

  await setQuantity(win, 'death-star', 1);
  const before = await readSave(win);
  await click(win, '[data-qa-fleet-production-item="death-star"] .shipyard-build-button-v1');
  await waitFor(win, `JSON.parse(localStorage.getItem(${JSON.stringify(TEST_KEY)}) || '{}')?.planets?.['helion-01']?.fleetProduction?.shipQueue?.length === 1`);
  await sleep(1_100);
  const afterTick = await readSave(win);
  const order = afterTick.planets['helion-01'].fleetProduction.shipQueue[0];
  if (!order || order.completedQuantity !== 0 || afterTick.planets['helion-01'].resources.metal >= before.planets['helion-01'].resources.metal || afterTick.planets['qa-colony-01']?.fleetProduction?.shipQueue?.length > 0) {
    throw new Error(`${label}: Planeto-lom queue/resource trace crossed state or completed unexpectedly ${JSON.stringify({ order, before: before.planets['helion-01']?.resources, after: afterTick.planets['helion-01']?.resources })}`);
  }
  await reload(win);
  const reloaded = await readSave(win);
  const persistedOrder = reloaded.planets['helion-01'].fleetProduction.shipQueue[0];
  if (!persistedOrder || persistedOrder.completedQuantity !== 0 || reloaded.planets['qa-colony-01']?.fleetProduction?.shipQueue?.length > 0) {
    throw new Error(`${label}: Planeto-lom queue was lost or duplicated after reload ${JSON.stringify(reloaded.planets)}`);
  }
  return { blocked, unlocked, queueId: persistedOrder.id, completedQuantity: persistedOrder.completedQuantity };
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
      _save.science.levels[4] = 1;
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
    const commanderDossierText = await win.webContents.executeJavaScript(`document.querySelector('.ship-info-modal-v1')?.textContent?.replace(/\\s+/g, '') ?? ''`);
    if (!commanderDossierText.includes('Скорость') || !commanderDossierText.includes('33000')) {
      throw new Error(`${label}: commander dossier does not show speed 33,000: ${commanderDossierText}`);
    }
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

    const transportCycle = await runTransportUiCycle(win, label, directory);
    const flightCycle = await runFlightRuntimeCycle(win, label);
    const recycleCycle = await runRecycleUiCycle(win, label);
    const asteroidRecyclerLaunch = await runAsteroidRecyclerLaunch(win, label, directory);
    const gasUiRegressions = await runGasUiRegressions(win, label, directory);
    const gasFreshnessRegressions = await runGasFreshnessRegressions(win, label, directory);
    const planetSwitch = await runPlanetSwitchRegression(win, label);
    const planetoLom = await runPlanetoLomTrace(win, label);

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
    return { viewport: label, layout, missionSlots, transportCycle, flightCycle, recycleCycle, asteroidRecyclerLaunch, gasUiRegressions, gasFreshnessRegressions, planetSwitch, planetoLom, screenshotsSkipped: skipScreenshots };
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
