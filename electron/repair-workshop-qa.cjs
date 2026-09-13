const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-gpu');
app.on('window-all-closed', () => {});

const ROOT = path.join(__dirname, '..');
const OUTPUT = process.env.ASTERION_QA_OUTPUT || path.join(ROOT, 'artifacts-pass1', 'repair-workshop-qa');
const SAVE_KEY = 'asterion.vertical-slice.test.v1';
const VIEWPORTS = [[1920, 1080], [1280, 720]];
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(win, expression, timeoutMs = 10_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      if (await win.webContents.executeJavaScript(`Boolean(${expression})`)) return;
    } catch (error) {
      throw new Error(`Renderer expression failed: ${expression}\n${error?.stack || error}`);
    }
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
  await waitFor(win, `localStorage.getItem(${JSON.stringify(SAVE_KEY)})`);
  await settle(win);
}

async function reload(win) {
  const done = new Promise((resolve) => win.webContents.once('did-finish-load', resolve));
  win.webContents.reload();
  await done;
  await waitFor(win, `document.querySelector('[data-qa-navigation="utility"]')`);
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

async function clickText(win, selector, text) {
  const clicked = await win.webContents.executeJavaScript(`(() => {
    const element = [...document.querySelectorAll(${JSON.stringify(selector)})]
      .find((candidate) => candidate.textContent?.replace(/\\s+/g, ' ').trim() === ${JSON.stringify(text)});
    if (!element || element.disabled) return false;
    element.click();
    return true;
  })()`);
  if (!clicked) throw new Error(`Text element not found/enabled: ${selector} ${text}`);
  await settle(win);
}

async function readSave(win) {
  return win.webContents.executeJavaScript(`JSON.parse(localStorage.getItem(${JSON.stringify(SAVE_KEY)}) || 'null')`);
}

async function seedSave(win, {
  capacity = false,
  shipPool = 3,
  defensePool = 2,
  tokens = 31,
  wallet = { metal: 999999999, minerals: 999999999, gas: 999999999 },
} = {}) {
  const seeded = await win.webContents.executeJavaScript(`(() => {
    const save = JSON.parse(localStorage.getItem(${JSON.stringify(SAVE_KEY)}) || 'null');
    const planet = save?.planets?.['helion-01'];
    if (!save || !planet?.buildings || !planet?.fleet || !planet?.fleetProduction) return false;

    save.metal = ${JSON.stringify(wallet.metal)};
    save.minerals = ${JSON.stringify(wallet.minerals)};
    save.gas = ${JSON.stringify(wallet.gas)};
    save.resourceClock = { lastReconciledAt: Date.now(), remainder: { metal: 0, minerals: 0, gas: 0, energy: 0 } };
    planet.repair = {
      ships: { ...(planet.repair?.ships || {}), scout: ${JSON.stringify(capacity === 'fleet' ? 2 : shipPool)} },
      defenses: { ...(planet.repair?.defenses || {}), 'ballistic-turret': ${JSON.stringify(capacity === 'defense' ? 1 : defensePool)} },
      tokens: ${JSON.stringify(tokens)},
      claimedBattleIds: [],
    };
    planet.fleetProduction = {
      shipQueue: [],
      defenseQueue: [],
      commanderQueue: [],
    };

    planet.fleet.ships.scout = 20;
    planet.defense.defenses['ballistic-turret'] = 0;
    if (${JSON.stringify(capacity)} === 'fleet') {
      planet.fleet.ships.scout = 49;
      const now = Date.now();
      planet.fleetProduction.shipQueue = [{
        id: 'qa-repair-pending-scout',
        queueKind: 'ships',
        itemId: 'scout',
        quantity: 1,
        completedQuantity: 0,
        enqueuedAt: now,
        startedAt: now,
        finishAt: now + 3600000,
        effectiveDurationMs: 3600000,
        cost: { metal: 1, minerals: 1, gas: 0 },
        refundEligible: true,
      }];
    } else if (${JSON.stringify(capacity)} === 'defense') {
      planet.defense.defenses['ballistic-turret'] = 50;
      const now = Date.now();
      planet.fleetProduction.defenseQueue = [{
        id: 'qa-repair-pending-defense',
        queueKind: 'defense',
        itemId: 'ballistic-turret',
        quantity: 10,
        completedQuantity: 0,
        enqueuedAt: now,
        startedAt: now,
        finishAt: now + 3600000,
        effectiveDurationMs: 3600000,
        cost: { metal: 1, minerals: 1, gas: 0 },
        refundEligible: true,
      }];
    }

    save.queues = { 'helion-01': [] };
    save.schemaVersion = Math.max(Number(save.schemaVersion) || 0, 13);
    localStorage.setItem(${JSON.stringify(SAVE_KEY)}, JSON.stringify(save));
    return true;
  })()`);
  if (!seeded) throw new Error('Could not seed Repair Workshop QA save');
  await reload(win);
}

async function openRepairWorkshop(win, cardId = 'scout') {
  await click(win, '[data-qa-route="fleets"]');
  await waitFor(win, `document.querySelector('.fleet-workspace-v1')`);
  await click(win, '[data-qa-fleet-section="repair"]');
  await waitFor(win, `document.querySelector('.repair-workshop-v1')`);
  await waitFor(win, `document.querySelector('[data-qa-repair-card="${cardId}"]')`);
}

async function dispatchDefensiveReport(win) {
  const reportId = 'qa-repair-defensive-report-1';
  await win.webContents.executeJavaScript(`(() => {
    const report = {
      id: ${JSON.stringify(reportId)},
      timestamp: '2026-09-13T00:00:00.000Z',
      missionType: 'defense',
      attacker: { playerId: 'raider', playerName: 'Raider', side: 'attacker' },
      defender: { playerId: 'player-aster', playerName: 'Asterion', side: 'defender' },
      winner: 'defender',
      roundCount: 1,
      attackerForce: { populationBefore: 0, populationAfter: 0, stacks: [] },
      defenderForce: {
        populationBefore: 18,
        populationAfter: 0,
        stacks: [{ entityId: 'scout', countBefore: 5, countAfter: 0, destroyed: 5 }],
        defenses: [{ entityId: 'ballistic-turret', countBefore: 4, countAfter: 0, destroyed: 4 }],
      },
      rounds: [],
    };
    window.dispatchEvent(new CustomEvent('asterion:combat-result-apply-request', {
      detail: { planetId: 'helion-01', report },
    }));
    return true;
  })()`);
  await waitFor(win, `(() => {
    const repair = JSON.parse(localStorage.getItem(${JSON.stringify(SAVE_KEY)}) || '{}')?.planets?.['helion-01']?.repair;
    return repair?.ships?.scout === 3 && repair?.defenses?.['ballistic-turret'] === 2 && repair?.claimedBattleIds?.includes(${JSON.stringify(reportId)});
  })()`);
  await win.webContents.executeJavaScript(`(() => {
    const report = {
      id: ${JSON.stringify(reportId)},
      timestamp: '2026-09-13T00:00:00.000Z',
      missionType: 'defense',
      attacker: { playerId: 'raider', playerName: 'Raider', side: 'attacker' },
      defender: { playerId: 'player-aster', playerName: 'Asterion', side: 'defender' },
      winner: 'defender',
      roundCount: 1,
      attackerForce: { populationBefore: 0, populationAfter: 0, stacks: [] },
      defenderForce: {
        populationBefore: 18,
        populationAfter: 0,
        stacks: [{ entityId: 'scout', countBefore: 5, countAfter: 0, destroyed: 5 }],
        defenses: [{ entityId: 'ballistic-turret', countBefore: 4, countAfter: 0, destroyed: 4 }],
      },
      rounds: [],
    };
    window.dispatchEvent(new CustomEvent('asterion:combat-result-apply-request', {
      detail: { planetId: 'helion-01', report },
    }));
    return true;
  })()`);
  await settle(win);
  const saved = await readSave(win);
  const repair = saved.planets['helion-01'].repair;
  if (repair.ships.scout !== 3 || repair.defenses['ballistic-turret'] !== 2 || repair.claimedBattleIds.filter((id) => id === reportId).length !== 1) {
    throw new Error(`Defensive award/idempotency mismatch ${JSON.stringify(repair)}`);
  }
  return reportId;
}

async function assertRepairCost(win) {
  const cost = await win.webContents.executeJavaScript(`(() => {
    const raw = document.querySelector('[data-qa-repair-card="scout"] [data-qa-repair-resource-cost]')?.getAttribute('data-qa-repair-resource-cost');
    return raw ? JSON.parse(raw) : null;
  })()`);
  if (!cost || cost.metal !== 4800 || cost.minerals !== 3200 || cost.gas !== 0) {
    throw new Error(`Repair cost contract mismatch: ${JSON.stringify(cost)}`);
  }
}

async function assertButtonState(win, selector, expectedDisabled) {
  const disabled = await win.webContents.executeJavaScript(`Boolean(document.querySelector(${JSON.stringify(selector)})?.disabled)`);
  if (disabled !== expectedDisabled) throw new Error(`Unexpected disabled state for ${selector}: ${disabled}`);
}

async function runViewport(width, height) {
  const label = `${width}x${height}`;
  const win = new BrowserWindow({
    width: 1000,
    height: 700,
    show: false,
    backgroundColor: '#02050a',
    webPreferences: {
      offscreen: true,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      partition: `qa-repair-workshop-${width}`,
    },
  });

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

    await seedSave(win);
    await openRepairWorkshop(win);
    await assertRepairCost(win);

    const beforeResources = await readSave(win);
    await assertButtonState(win, '[data-qa-repair-resource-button="scout"]', false);
    await assertButtonState(win, '[data-qa-repair-token-button="scout"]', false);
    await click(win, '[data-qa-repair-resource-button="scout"]');
    await waitFor(win, `JSON.parse(localStorage.getItem(${JSON.stringify(SAVE_KEY)}) || '{}')?.planets?.['helion-01']?.repair?.ships?.scout === 2`);
    const afterResources = await readSave(win);
    const resourceDelta = beforeResources.metal - afterResources.metal;
    if (resourceDelta < 4700 || resourceDelta > 4900) throw new Error(`${label}: resource payment delta mismatch ${resourceDelta}`);

    await click(win, '[data-qa-repair-token-button="scout"]');
    await waitFor(win, `JSON.parse(localStorage.getItem(${JSON.stringify(SAVE_KEY)}) || '{}')?.planets?.['helion-01']?.repair?.ships?.scout === 1`);
    const afterTokens = await readSave(win);
    if (afterTokens.planets['helion-01'].repair.tokens !== 30) {
      throw new Error(`${label}: token payment did not persist ${JSON.stringify(afterTokens.planets['helion-01'].repair)}`);
    }

    await reload(win);
    await openRepairWorkshop(win);
    const persisted = await readSave(win);
    const persistedAvailable = await win.webContents.executeJavaScript(`Number(document.querySelector('[data-qa-repair-card="scout"] [data-qa-repair-available]')?.textContent || 0)`);
    if (persisted.planets['helion-01'].repair.ships.scout !== 1 || persisted.planets['helion-01'].repair.tokens !== 30 || persistedAvailable !== 1) {
      throw new Error(`${label}: repair persistence mismatch ${JSON.stringify({ persisted: persisted.planets['helion-01'].repair, persistedAvailable })}`);
    }

    await seedSave(win, { shipPool: 0, defensePool: 0 });
    const defensiveReportId = await dispatchDefensiveReport(win);
    const awarded = await readSave(win);
    if (!awarded.combat.reports.some((candidate) => candidate.id === defensiveReportId && candidate.repairEligibility?.status === 'available')) {
      throw new Error(`${label}: defensive report was not annotated in battle history`);
    }

    await seedSave(win, {
      shipPool: 1,
      defensePool: 0,
      tokens: 31,
      wallet: { metal: 0, minerals: 0, gas: 0 },
    });
    await openRepairWorkshop(win);
    await assertButtonState(win, '[data-qa-repair-resource-button="scout"]', true);
    await assertButtonState(win, '[data-qa-repair-token-button="scout"]', false);
    const resourceReason = await win.webContents.executeJavaScript(`document.querySelector('[data-qa-repair-card="scout"] [data-qa-repair-disabled-reason]')?.textContent?.replace(/\\s+/g, ' ').trim() || ''`);
    if (!resourceReason.includes('Ресурсы')) throw new Error(`${label}: insufficient resource reason is missing ${resourceReason}`);

    await seedSave(win, {
      shipPool: 1,
      defensePool: 0,
      tokens: 0,
    });
    await openRepairWorkshop(win);
    await assertButtonState(win, '[data-qa-repair-resource-button="scout"]', false);
    await assertButtonState(win, '[data-qa-repair-token-button="scout"]', true);
    const tokenReason = await win.webContents.executeJavaScript(`document.querySelector('[data-qa-repair-card="scout"] [data-qa-repair-disabled-reason]')?.textContent?.replace(/\\s+/g, ' ').trim() || ''`);
    if (!tokenReason.includes('Жетоны')) throw new Error(`${label}: insufficient token reason is missing ${tokenReason}`);

    await seedSave(win, { capacity: 'fleet' });
    await openRepairWorkshop(win);
    await clickText(win, '[data-qa-repair-card="scout"] .repair-shortcut-v1', 'МАКС.');
    await assertButtonState(win, '[data-qa-repair-resource-button="scout"]', true);
    await assertButtonState(win, '[data-qa-repair-token-button="scout"]', true);
    const reason = await win.webContents.executeJavaScript(`document.querySelector('[data-qa-repair-card="scout"] [data-qa-repair-disabled-reason]')?.textContent?.replace(/\\s+/g, ' ').trim() || ''`);
    if (!reason.includes('флота')) throw new Error(`${label}: fleet capacity reason is missing ${reason}`);

    await seedSave(win, { capacity: 'defense' });
    await openRepairWorkshop(win, 'ballistic-turret');
    await clickText(win, '[data-qa-repair-card="ballistic-turret"] .repair-shortcut-v1', 'МАКС.');
    await assertButtonState(win, '[data-qa-repair-resource-button="ballistic-turret"]', true);
    await assertButtonState(win, '[data-qa-repair-token-button="ballistic-turret"]', true);
    const defenseReason = await win.webContents.executeJavaScript(`document.querySelector('[data-qa-repair-card="ballistic-turret"] [data-qa-repair-disabled-reason]')?.textContent?.replace(/\\s+/g, ' ').trim() || ''`);
    if (!defenseReason.includes('обороны')) throw new Error(`${label}: defense capacity reason is missing ${defenseReason}`);

    const summary = await win.webContents.executeJavaScript(`({
      viewport: '${label}',
      horizontalOverflow: document.documentElement.scrollWidth > innerWidth + 2 || document.body.scrollWidth > innerWidth + 2,
      fleetSummary: document.querySelector('[data-qa-repair-summary-capacity="КОРАБЛИ"]')?.textContent?.trim() || '',
      defenseSummary: document.querySelector('[data-qa-repair-summary-capacity="ОБОРОНА"]')?.textContent?.trim() || '',
      reason: ${JSON.stringify(reason)},
      defenseReason: ${JSON.stringify(defenseReason)},
    })`);
    if (summary.horizontalOverflow) throw new Error(`${label}: horizontal overflow ${JSON.stringify(summary)}`);

    fs.mkdirSync(OUTPUT, { recursive: true });
    fs.writeFileSync(path.join(OUTPUT, `${label}.json`), JSON.stringify({ ...summary, ok: true }, null, 2));
    console.log(`[${label}] Repair Workshop QA passed`);
    return { ...summary, ok: true };
  } finally {
    try {
      if (win.webContents.debugger.isAttached()) win.webContents.debugger.detach();
    } catch {}
    if (!win.isDestroyed()) await win.close();
  }
}

async function main() {
  const results = [];
  try {
    for (const [width, height] of VIEWPORTS) results.push(await runViewport(width, height));
    fs.mkdirSync(OUTPUT, { recursive: true });
    fs.writeFileSync(path.join(OUTPUT, 'result.json'), JSON.stringify({ ok: true, viewports: results }, null, 2));
    console.log(JSON.stringify({ ok: true, viewports: results }, null, 2));
  } finally {
    app.quit();
  }
}

app.whenReady().then(main).catch((error) => {
  console.error(error.stack || error);
  app.exit(1);
});
