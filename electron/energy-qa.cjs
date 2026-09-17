const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-gpu');
app.on('window-all-closed', () => {});

const ROOT = path.join(__dirname, '..');
const OUTPUT = process.env.ASTERION_QA_OUTPUT || path.join(ROOT, 'artifacts-pass1', 'energy-qa');
const SAVE_KEY = 'asterion.vertical-slice.test.v1';
const VIEWPORTS = [[1920, 1080], [1280, 720]];
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
  await sleep(120);
}

async function loadTestMode(win) {
  const done = new Promise((resolve) => win.webContents.once('did-finish-load', resolve));
  await win.loadFile(path.join(ROOT, 'dist', 'index.html'), { search: '?mode=test' });
  await done;
  await waitFor(win, `document.querySelector('[data-qa-header]')`);
  await waitFor(win, `localStorage.getItem(${JSON.stringify(SAVE_KEY)})`);
  await settle(win);
}

async function reload(win) {
  const done = new Promise((resolve) => win.webContents.once('did-finish-load', resolve));
  win.webContents.reload();
  await done;
  await waitFor(win, `document.querySelector('[data-qa-header]')`);
  await waitFor(win, `localStorage.getItem(${JSON.stringify(SAVE_KEY)})`);
  await settle(win);
}

async function click(win, selector) {
  const clicked = await win.webContents.executeJavaScript(`(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    if (!element || element.disabled) return false;
    element.click();
    return true;
  })()`);
  if (!clicked) throw new Error(`Element not found/enabled: ${selector}`);
  await settle(win);
}

async function seedStation(win) {
  const seeded = await win.webContents.executeJavaScript(`(() => {
    const save = JSON.parse(localStorage.getItem(${JSON.stringify(SAVE_KEY)}) || 'null');
    const planet = save?.planets?.['helion-01'];
    if (!save || !planet?.buildings || !save.science?.levels) return false;
    planet.buildings['basic-energy'] = 23;
    planet.buildings['advanced-energy'] = 0;
    planet.universeSystem = 19;
    planet.universePosition = 14;
    planet.solarSatellites = 0;
    planet.energy = 17962;
    delete planet.energyLedger;
    delete planet.producedEnergy;
    delete planet.consumedEnergy;
    delete planet.availableEnergy;
    delete planet.energySources;
    delete planet.energyExpenseAttribution;
    save.science.levels[1] = 8;
    save.metal = 450100000;
    save.minerals = 300100000;
    save.gas = 189382930;
    save.schemaVersion = 14;
    save.resourceClock = { lastReconciledAt: Date.now(), remainder: { metal: 0, minerals: 0, gas: 0, energy: 0 } };
    localStorage.setItem(${JSON.stringify(SAVE_KEY)}, JSON.stringify(save));
    return true;
  })()`);
  if (!seeded) throw new Error('Could not seed the energy station fixture');
  await reload(win);
}

async function seedSatellites(win) {
  const seeded = await win.webContents.executeJavaScript(`(() => {
    const save = JSON.parse(localStorage.getItem(${JSON.stringify(SAVE_KEY)}) || 'null');
    const planet = save?.planets?.['helion-01'];
    if (!save || !planet) return false;
    planet.solarSatellites = 2;
    planet.energy = 18072;
    delete planet.energyLedger;
    delete planet.producedEnergy;
    delete planet.consumedEnergy;
    delete planet.availableEnergy;
    delete planet.energySources;
    delete planet.energyExpenseAttribution;
    localStorage.setItem(${JSON.stringify(SAVE_KEY)}, JSON.stringify(save));
    return true;
  })()`);
  if (!seeded) throw new Error('Could not seed the satellite fixture');
  await reload(win);
}

async function capture(win, directory, name, width, height) {
  fs.mkdirSync(directory, { recursive: true });
  win.showInactive();
  await sleep(180);
  await win.webContents.executeJavaScript('window.scrollTo(0, 0)');
  await sleep(120);
  const image = await win.capturePage({ x: 0, y: 0, width, height });
  fs.writeFileSync(path.join(directory, `${name}.png`), image.toPNG());
  win.hide();
}

async function runViewport(width, height) {
  const label = `${width}x${height}`;
  const directory = path.join(OUTPUT, label);
  fs.mkdirSync(directory, { recursive: true });
  const win = new BrowserWindow({ width: 1000, height: 700, show: false, webPreferences: { sandbox: false } });
  try {
    await loadTestMode(win);
    win.webContents.debugger.attach('1.3');
    await win.webContents.debugger.sendCommand('Emulation.setDeviceMetricsOverride', {
      width,
      height,
      deviceScaleFactor: 1,
      mobile: false,
      screenWidth: width,
      screenHeight: height,
    });
    await settle(win);

    await seedStation(win);
    await click(win, '[data-qa-route="planet"]');
    await waitFor(win, `document.querySelector('[data-qa-route="planet"][aria-current="page"]')`);
    await click(win, '[data-qa-zone="resource"]');
    await waitFor(win, `document.querySelector('[data-qa-zone-view][data-zone="resource"]')`);
    await click(win, '[data-zone-selector-role="basic-energy"]');
    await waitFor(win, `document.querySelector('[data-qa-building-dialog="basic-energy"]')`);

    const station = await win.webContents.executeJavaScript(`(() => {
      const text = (selector) => document.querySelector(selector)?.textContent?.replace(/\\s+/g, ' ').trim() || '';
      const summary = text('[data-qa-energy-summary]');
      const energyTooltip = text('[data-qa-resource-tooltip="energy"]');
      return {
        current: text('[data-qa-building-effect-current]'),
        next: text('[data-qa-building-effect-next]'),
        delta: text('[data-qa-energy-upgrade-delta]'),
        summary,
        energyTooltip,
        horizontalOverflow: document.documentElement.scrollWidth > innerWidth + 2 || document.body.scrollWidth > innerWidth + 2,
      };
    })()`);
    const stationText = JSON.stringify(station);
    if (!station.current.includes('Итого 17 962') || !station.next.includes('Итого 19 978') || station.delta !== 'ПРИБАВКА +2 016' || station.summary.includes('/ч') || station.energyTooltip.includes('/ч') || station.horizontalOverflow) {
      throw new Error(`${label}: energy station UI contract failed: ${stationText}`);
    }
    await capture(win, directory, 'energy-station-levels', width, height);

    await seedSatellites(win);
    await click(win, '[data-qa-route="fleets"]');
    await waitFor(win, `document.querySelector('.fleet-workspace-v1')`);
    const satellite = await win.webContents.executeJavaScript(`(() => {
      const row = document.querySelector('[data-qa-fleet-satellites]');
      return {
        text: row?.textContent?.replace(/\\s+/g, ' ').trim() || '',
        dismantleDisabled: Boolean(row?.querySelector('.fleet-satellite-dismantle-v1')?.disabled),
        ordinarySatelliteRow: Boolean(document.querySelector('[data-qa-fleet-ship="solar-satellite"]')),
        population: document.querySelector('[data-qa-fleet-population]')?.textContent?.replace(/\\s+/g, ' ').trim() || '',
        headerPopulation: document.querySelector('[data-qa-resource-chip="population"] strong')?.textContent?.replace(/\\s+/g, ' ').trim() || '',
        fleetPopulation: Number((document.querySelector('[data-qa-fleet-population]')?.textContent?.match(/ФЛОТ: ([0-9]+(?: [0-9]{3})*)/)?.[1] || '').replace(/ /g, '')),
      };
    })()`);
    const parsePopulation = (value) => Number(value.replace(/[^0-9-]/g, ''));
    if (!satellite.text.includes('На орбите: 2') || satellite.dismantleDisabled || satellite.ordinarySatelliteRow || !satellite.population.includes('СПУТНИКИ 2') || !Number.isFinite(satellite.fleetPopulation) || parsePopulation(satellite.headerPopulation) !== satellite.fleetPopulation + 2) {
      throw new Error(`${label}: satellite presence UI contract failed: ${JSON.stringify(satellite)}`);
    }
    await capture(win, directory, 'satellite-presence', width, height);

    win.showInactive();
    await click(win, '.fleet-satellite-dismantle-v1');
    await waitFor(win, `document.querySelector('[data-qa-satellite-dismantle-confirm]')`);
    const confirmation = await win.webContents.executeJavaScript(`(() => {
      const dialog = document.querySelector('[data-qa-satellite-dismantle-confirm]');
      const text = (selector) => document.querySelector(selector)?.textContent?.replace(/\\s+/g, ' ').trim() || '';
      return {
        title: text('#satellite-dismantle-confirm-title'),
        description: text('#satellite-dismantle-confirm-description'),
        role: dialog?.getAttribute('role') || '',
        ariaModal: dialog?.getAttribute('aria-modal') || '',
        confirmFocused: document.activeElement?.matches('[data-qa-satellite-dismantle-confirm-yes]') || false,
        horizontalOverflow: document.documentElement.scrollWidth > innerWidth + 2 || document.body.scrollWidth > innerWidth + 2,
      };
    })()`);
    if (!confirmation.title.includes('Уничтожить спутники?') || !confirmation.description.includes('Ресурсы за них не возвращаются') || confirmation.role !== 'alertdialog' || confirmation.ariaModal !== 'true' || !confirmation.confirmFocused || confirmation.horizontalOverflow) {
      throw new Error(`${label}: satellite dismantle confirmation contract failed: ${JSON.stringify(confirmation)}`);
    }
    await capture(win, directory, 'satellite-dismantle-confirm', width, height);

    await win.webContents.executeJavaScript(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); true`);
    await waitFor(win, `!document.querySelector('[data-qa-satellite-dismantle-confirm]')`);
    win.showInactive();
    await click(win, '.fleet-satellite-dismantle-v1');
    await waitFor(win, `document.querySelector('[data-qa-satellite-dismantle-confirm]')`);
    await click(win, '[data-qa-satellite-dismantle-confirm-yes]');
    await waitFor(win, `JSON.parse(localStorage.getItem(${JSON.stringify(SAVE_KEY)}) || '{}')?.planets?.['helion-01']?.solarSatellites === 0`);
    const afterDismantle = await win.webContents.executeJavaScript(`(() => {
      const save = JSON.parse(localStorage.getItem(${JSON.stringify(SAVE_KEY)}) || '{}');
      const planet = save.planets?.['helion-01'];
      return {
        satellites: planet?.solarSatellites ?? -1,
        availableEnergy: planet?.availableEnergy ?? planet?.energy ?? -1,
        notice: document.querySelector('.shell-notice span')?.textContent?.replace(/\\s+/g, ' ').trim() || '',
        headerPopulation: document.querySelector('[data-qa-resource-chip="population"] strong')?.textContent?.replace(/\\s+/g, ' ').trim() || '',
      };
    })()`);
    if (afterDismantle.satellites !== 0 || afterDismantle.availableEnergy !== 17962 || parsePopulation(afterDismantle.headerPopulation) !== satellite.fleetPopulation || !afterDismantle.notice.includes('Ресурсы за них не возвращаются')) {
      throw new Error(`${label}: satellite dismantle UI contract failed: ${JSON.stringify(afterDismantle)}`);
    }

    return { viewport: label, station, satellite, confirmation, afterDismantle, screenshots: fs.readdirSync(directory).filter((name) => name.endsWith('.png')).sort() };
  } finally {
    try { if (win.webContents.debugger.isAttached()) win.webContents.debugger.detach(); } catch {}
    if (!win.isDestroyed()) await win.close();
  }
}

async function main() {
  fs.mkdirSync(OUTPUT, { recursive: true });
  const results = [];
  try {
    for (const [width, height] of VIEWPORTS) results.push(await runViewport(width, height));
    fs.writeFileSync(path.join(OUTPUT, 'results.json'), JSON.stringify({ results }, null, 2));
    console.log(JSON.stringify({ results }, null, 2));
  } catch (error) {
    console.error(error.stack || error);
    app.exit(1);
    return;
  }
  app.quit();
}

app.whenReady().then(main);
