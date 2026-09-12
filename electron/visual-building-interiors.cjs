const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-gpu');
app.on('window-all-closed', () => {});

const ROOT = path.join(__dirname, '..');
const OUTPUT = path.join(ROOT, 'visual-qa');
const SAVE_KEY = 'asterion.vertical-slice.v1';
const VIEWPORTS = [[1920, 1080], [1280, 720]];
const BUILT_INTERIOR_ROLES = [
  'construction',
  'advanced-factory',
  'recycling',
  'trade-center',
  'shipyard',
  'research',
  'spaceport',
  'planetary-government',
];
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(win, expression, timeoutMs = 7000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await win.webContents.executeJavaScript(`Boolean(${expression})`)) return;
    await sleep(50);
  }
  throw new Error(`Timed out waiting for: ${expression}`);
}

async function settle(win) {
  await win.webContents.executeJavaScript('new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
  await sleep(80);
}

async function reload(win) {
  const done = new Promise((resolve) => win.webContents.once('did-finish-load', resolve));
  win.webContents.reload();
  await done;
  await waitFor(win, `document.querySelector('[data-qa-navigation="utility"]')`);
  await win.webContents.executeJavaScript('document.fonts?.ready');
  await settle(win);
}

async function capture(win, directory, name) {
  const result = await win.webContents.debugger.sendCommand('Page.captureScreenshot', {
    format: 'png',
    fromSurface: true,
    captureBeyondViewport: false,
  });
  fs.writeFileSync(path.join(directory, `${name}.png`), Buffer.from(result.data, 'base64'));
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

async function setBuiltInteriorSave(win) {
  const ok = await win.webContents.executeJavaScript(`(() => {
    const raw = localStorage.getItem(${JSON.stringify(SAVE_KEY)});
    const save = raw ? JSON.parse(raw) : null;
    const planet = save?.planets?.['helion-01'];
    if (!planet?.buildings) return false;
    for (const role of ${JSON.stringify(BUILT_INTERIOR_ROLES)}) planet.buildings[role] = 1;
    planet.buildings.construction = 10;
    planet.buildings['advanced-factory'] = 2;
    planet.buildings.shipyard = 15;
    planet.productionBots = { metal: 0, minerals: 0, gas: 0 };
    save.schemaVersion = Math.max(Number(save.schemaVersion) || 0, 5);
    localStorage.setItem(${JSON.stringify(SAVE_KEY)}, JSON.stringify(save));
    return true;
  })()`);
  if (!ok) throw new Error('Could not seed building interiors');
  await reload(win);
}

async function activateZone(win, zone) {
  await click(win, `[data-qa-zone="${zone}"]`);
  await waitFor(win, `document.querySelector('[data-qa-zone-view][data-zone=${JSON.stringify(zone)}]')`);
}

async function openBuildingDialog(win, role) {
  await click(win, `[data-zone-building-role="${role}"]`);
  await waitFor(win, `document.querySelector('[data-qa-building-dialog=${JSON.stringify(role)}]')`);
  await waitFor(win, `document.querySelector('[data-qa-building-dialog=${JSON.stringify(role)}] [data-qa-enter-building=${JSON.stringify(role)}]')`);
}

async function enterBuilding(win, role) {
  await openBuildingDialog(win, role);
  await click(win, `[data-qa-enter-building="${role}"]`);
}

async function assertReturned(win, zone, role) {
  await waitFor(win, `document.querySelector('[data-qa-zone-view][data-zone=${JSON.stringify(zone)}]')`);
  await waitFor(win, `document.querySelector('[data-qa-building-dialog=${JSON.stringify(role)}]')`);
  const snapshot = await win.webContents.executeJavaScript(`(() => ({
    zone: document.querySelector('[data-qa-zone-view]')?.getAttribute('data-zone') ?? '',
    role: document.querySelector('[data-qa-building-dialog]')?.getAttribute('data-qa-building-dialog') ?? '',
    planet: document.querySelector('[data-qa-current-planet]')?.textContent?.replace(/\\s+/g, ' ').trim() ?? '',
  }))()`);
  if (snapshot.zone !== zone || snapshot.role !== role || !snapshot.planet.includes('Helion 01')) {
    throw new Error(`Return context mismatch: ${JSON.stringify(snapshot)}`);
  }
}

async function pressEscape(win) {
  await win.webContents.executeJavaScript(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))`);
  await settle(win);
}

async function closeDialog(win) {
  await click(win, '.resource-building-dialog-close');
  await waitFor(win, `!document.querySelector('[data-qa-building-dialog]')`);
}

async function verifyProductionHost(win, directory) {
  await activateZone(win, 'industry');

  await enterBuilding(win, 'construction');
  await waitFor(win, `document.querySelector('[data-qa-production-bots="construction"]')`);
  await capture(win, directory, 'building-interior-production-factory');
  await click(win, '[data-qa-production-bots-back]');
  await assertReturned(win, 'industry', 'construction');
  await closeDialog(win);

  await enterBuilding(win, 'advanced-factory');
  await waitFor(win, `document.querySelector('[data-qa-production-bots="advanced-factory"]')`);
  await pressEscape(win);
  await assertReturned(win, 'industry', 'advanced-factory');
  await closeDialog(win);
}

async function verifyMilitaryDeepLinks(win, directory) {
  await activateZone(win, 'military');

  await enterBuilding(win, 'shipyard');
  await waitFor(win, `document.querySelector('[data-qa-route="fleets"][aria-current="page"]')`);
  await waitFor(win, `document.querySelector('.fleet-main-v1--shipyard')`);
  await waitFor(win, `document.querySelector('[data-qa-building-interior-back]')`);
  const shipyardIdentity = await win.webContents.executeJavaScript(`(() => {
    const root = document.querySelector('[data-qa-building-role="shipyard"]');
    const fleetCard = document.querySelector('.fleet-yard-card-v1');
    const pageTitle = document.querySelector('.shipyard-page-title-v1');
    const asset = root?.getAttribute('data-qa-building-asset') ?? '';
    const cardStyle = fleetCard ? getComputedStyle(fleetCard) : null;
    const fleetImage = fleetCard?.querySelector('img');
    const imageStyle = fleetImage ? getComputedStyle(fleetImage) : null;
    const titleStyle = fleetCard?.querySelector('strong') ? getComputedStyle(fleetCard.querySelector('strong')) : null;
    const detailStyle = fleetCard?.querySelector('p') ? getComputedStyle(fleetCard.querySelector('p')) : null;
    return {
      fleetName: fleetCard?.querySelector('strong')?.textContent?.trim() ?? '',
      pageName: pageTitle?.querySelector('h2')?.textContent?.trim() ?? '',
      fleetCardTag: fleetCard?.tagName ?? '',
      fleetCardLabel: fleetCard?.getAttribute('aria-label') ?? '',
      asset,
      image: root?.querySelector('img')?.getAttribute('src') ?? '',
      hasSharedCardTemplate: fleetCard?.classList.contains('building-card-v2') ?? false,
      hasLegacyEmblem: Boolean(fleetCard?.querySelector('.fleet-yard-emblem-v1')),
      visual: {
        viewportWidth: window.innerWidth,
        minHeight: cardStyle?.minHeight ?? '',
        gridFirstColumn: cardStyle?.gridTemplateColumns?.split(' ')[0] ?? '',
        gap: cardStyle?.gap ?? '',
        padding: cardStyle?.padding ?? '',
        borderWidth: cardStyle?.borderTopWidth ?? '',
        hasGradient: cardStyle?.backgroundImage?.includes('linear-gradient') ?? false,
        hasCyanInset: cardStyle?.boxShadow?.includes('inset') ?? false,
        imageWidth: imageStyle?.width ?? '',
        imageHeight: imageStyle?.height ?? '',
        imageFit: imageStyle?.objectFit ?? '',
        titleSize: titleStyle?.fontSize ?? '',
        detailSize: detailStyle?.fontSize ?? '',
        detailMargin: detailStyle?.marginTop ?? '',
      },
      hasLegacyName: Boolean(document.querySelector('[data-qa-building-role="shipyard"]')?.textContent?.includes('Орбитальная')),
    };
  })()`);
  const expectedGridColumn = shipyardIdentity.visual.viewportWidth <= 1040 ? '62px' : shipyardIdentity.visual.viewportWidth <= 1440 ? '72px' : '84px';
  const expectedImageWidth = shipyardIdentity.visual.viewportWidth <= 1040 ? '58px' : shipyardIdentity.visual.viewportWidth <= 1440 ? '68px' : '80px';
  const expectedImageHeight = shipyardIdentity.visual.viewportWidth <= 1040 ? '66px' : shipyardIdentity.visual.viewportWidth <= 1440 ? '76px' : '86px';
  const visualTemplateMatches = shipyardIdentity.visual.minHeight === '112px'
    && shipyardIdentity.visual.gridFirstColumn === expectedGridColumn
    && shipyardIdentity.visual.gap === '12px'
    && shipyardIdentity.visual.padding === '10px 12px'
    && shipyardIdentity.visual.borderWidth === '1px'
    && shipyardIdentity.visual.hasGradient
    && shipyardIdentity.visual.hasCyanInset
    && shipyardIdentity.visual.imageWidth === expectedImageWidth
    && shipyardIdentity.visual.imageHeight === expectedImageHeight
    && shipyardIdentity.visual.imageFit === 'contain'
    && shipyardIdentity.visual.titleSize === '13px'
    && shipyardIdentity.visual.detailSize === '10px'
    && shipyardIdentity.visual.detailMargin === '7px';
  if (shipyardIdentity.fleetName !== 'Верфь' || shipyardIdentity.pageName !== 'Верфь' || shipyardIdentity.fleetCardTag !== 'BUTTON' || !shipyardIdentity.fleetCardLabel.startsWith('Открыть Верфь') || shipyardIdentity.hasLegacyName || shipyardIdentity.hasLegacyEmblem || !shipyardIdentity.hasSharedCardTemplate || !visualTemplateMatches || !/building\.aegis\.shipyard(?:-[^/]+)?\.png$/.test(shipyardIdentity.asset) || shipyardIdentity.image !== shipyardIdentity.asset) {
    throw new Error(`Shipyard identity contract failed: ${JSON.stringify(shipyardIdentity)}`);
  }

  const readConstructionVisual = async (viewId) => win.webContents.executeJavaScript(`(() => {
    const root = document.querySelector('[data-qa-construction-mode=${JSON.stringify(viewId)}]');
    const header = document.querySelector('[data-qa-construction-header=${JSON.stringify(viewId)}]');
    const pageTitle = header?.querySelector('.shipyard-page-title-v1');
    const pageArt = header?.querySelector('.shipyard-page-art-v1');
    const pageImage = pageArt?.querySelector('img');
    const card = root?.querySelector('.shipyard-card-v1');
    const cardTitle = card?.querySelector('.shipyard-card-title-v1');
    const cardBody = card?.querySelector('.shipyard-card-body-v1');
    const headerStyle = header ? getComputedStyle(header) : null;
    const titleStyle = pageTitle ? getComputedStyle(pageTitle) : null;
    const artStyle = pageArt ? getComputedStyle(pageArt) : null;
    const imageStyle = pageImage ? getComputedStyle(pageImage) : null;
    const cardStyle = card ? getComputedStyle(card) : null;
    const cardTitleStyle = cardTitle ? getComputedStyle(cardTitle) : null;
    const cardBodyStyle = cardBody ? getComputedStyle(cardBody) : null;
    const headerBorderStyle = header ? getComputedStyle(header, '::before') : null;
    const headerSurfaceStyle = header ? getComputedStyle(header, '::after') : null;
    return {
      mode: root?.getAttribute('data-qa-construction-mode') ?? '',
      viewportWidth: window.innerWidth,
      title: header?.querySelector('h2')?.textContent?.trim() ?? '',
      kicker: header?.querySelector('small')?.textContent?.trim() ?? '',
      image: pageImage?.getAttribute('src') ?? '',
      hasPageTitle: Boolean(pageTitle),
      hasPageArt: Boolean(pageArt),
      hasLegacyEmblem: Boolean(root?.querySelector('.fleet-yard-emblem-v1')),
      header: {
        minHeight: headerStyle?.minHeight ?? '',
        padding: headerStyle?.padding ?? '',
        borderTopWidth: headerStyle?.borderTopWidth ?? '',
        hasBorderSurface: headerBorderStyle?.backgroundColor?.includes('rgba(65, 205, 242') ?? false,
        hasGradientSurface: headerSurfaceStyle?.backgroundImage?.includes('linear-gradient') ?? false,
        surfaceClipPath: headerSurfaceStyle?.clipPath ?? '',
        titleDisplay: titleStyle?.display ?? '',
        titleGrid: titleStyle?.gridTemplateColumns ?? '',
        titleGridFirstColumn: titleStyle?.gridTemplateColumns?.split(' ')[0] ?? '',
        titleGap: titleStyle?.gap ?? '',
        artWidth: artStyle?.width ?? '',
        artHeight: artStyle?.height ?? '',
        artClipPath: artStyle?.clipPath ?? '',
        imageWidth: imageStyle?.width ?? '',
        imageHeight: imageStyle?.height ?? '',
        imageFit: imageStyle?.objectFit ?? '',
      },
      card: {
        minHeight: cardStyle?.minHeight ?? '',
        borderWidth: cardStyle?.borderTopWidth ?? '',
        hasGradient: cardStyle?.backgroundImage?.includes('linear-gradient') ?? false,
        clipPath: cardStyle?.clipPath ?? '',
        titleGrid: cardTitleStyle?.gridTemplateColumns ?? '',
        bodyGrid: cardBodyStyle?.gridTemplateColumns ?? '',
      },
    };
  })()`);

  const shipConstructionVisual = await readConstructionVisual('ships');
  const expectedPageArtClipPath = shipConstructionVisual.header.artClipPath;
  const sharedHeaderTemplate = (visual) => visual.mode
    && visual.hasPageTitle
    && visual.hasPageArt
    && !visual.hasLegacyEmblem
    && visual.header.minHeight === '86px'
    && visual.header.padding === '11px 18px 13px'
    && visual.header.borderTopWidth === '0px'
    && visual.header.hasBorderSurface
    && visual.header.hasGradientSurface
    && visual.header.surfaceClipPath.startsWith('polygon(')
    && visual.header.titleDisplay === 'grid'
    && visual.header.titleGridFirstColumn === '58px'
    && visual.header.titleGap === '12px'
    && visual.header.artWidth === '56px'
    && visual.header.artHeight === '56px'
    && visual.header.artClipPath === expectedPageArtClipPath
    && visual.header.artClipPath.startsWith('polygon(50%')
    && visual.header.imageWidth === '48px'
    && visual.header.imageHeight === '48px'
    && visual.header.imageFit === 'contain';
  const expectedConstructionCardMinHeight = (visual) => visual.viewportWidth <= 1400 ? '282px' : '292px';
  const sharedCardTemplate = (visual) => visual.card.minHeight === expectedConstructionCardMinHeight(visual)
    && visual.card.borderWidth === '1px'
    && visual.card.hasGradient
    && visual.card.clipPath.startsWith('polygon(')
    && visual.card.titleGrid === shipConstructionVisual.card.titleGrid
    && visual.card.bodyGrid === shipConstructionVisual.card.bodyGrid;
  if (!sharedHeaderTemplate(shipConstructionVisual) || !sharedCardTemplate(shipConstructionVisual) || shipConstructionVisual.title !== 'Верфь' || shipConstructionVisual.image !== shipyardIdentity.asset) {
    throw new Error(`Ship construction visual contract failed: ${JSON.stringify(shipConstructionVisual)}`);
  }
  const unitTime = await win.webContents.executeJavaScript(`(() => {
    const cards = Array.from(document.querySelectorAll('[data-qa-unit-time]'));
    const card = document.querySelector('[data-qa-unit-time="transporter"]') ?? cards[0];
    return card ? {
      id: card.getAttribute('data-qa-unit-time') ?? '',
      effective: card.querySelector('[data-qa-unit-time-effective]')?.textContent?.trim() ?? '',
      raw: card.querySelector('[data-qa-unit-time-raw]')?.textContent?.trim() ?? '',
      bonus: card.querySelector('[data-qa-unit-time-bonus]')?.textContent?.trim() ?? '',
      cardCount: cards.length,
    } : { cardCount: cards.length };
  })()`);
  if (!unitTime?.effective || unitTime.raw !== 'RAW 00:10:00' || unitTime.bonus) {
    throw new Error(`Ship cards should show effective and raw unit time without a bonus label: ${JSON.stringify(unitTime)}`);
  }
  await capture(win, directory, 'building-interior-fleet-from-shipyard');

  await click(win, '[data-qa-fleet-section="defense"]');
  await waitFor(win, `document.querySelector('[data-qa-construction-mode="defense"]')`);
  await waitFor(win, `document.querySelector('[data-qa-construction-header="defense"]')`);
  const defenseConstructionVisual = await readConstructionVisual('defense');
  const sameHeaderVisual = JSON.stringify({ ...defenseConstructionVisual.header, titleGrid: defenseConstructionVisual.header.titleGridFirstColumn })
    === JSON.stringify({ ...shipConstructionVisual.header, titleGrid: shipConstructionVisual.header.titleGridFirstColumn });
  const sameCardVisual = JSON.stringify(defenseConstructionVisual.card) === JSON.stringify(shipConstructionVisual.card);
  if (!sharedHeaderTemplate(defenseConstructionVisual) || !sharedCardTemplate(defenseConstructionVisual) || !sameHeaderVisual || !sameCardVisual || defenseConstructionVisual.title !== 'ОБОРОНА' || defenseConstructionVisual.image !== shipyardIdentity.asset || defenseConstructionVisual.kicker.includes('КОСМОДРОМ') || defenseConstructionVisual.kicker.includes('ОРБИТАЛЬНАЯ')) {
    throw new Error(`Defense construction visual contract failed: ${JSON.stringify({ ship: shipConstructionVisual, defense: defenseConstructionVisual })}`);
  }
  await capture(win, directory, 'building-interior-fleet-defense');
  await pressEscape(win);
  await assertReturned(win, 'military', 'shipyard');
  await closeDialog(win);

  await enterBuilding(win, 'research');
  await waitFor(win, `document.querySelector('.science-view-v2')`);
  await waitFor(win, `document.querySelector('[data-qa-building-interior-back]')`);
  await click(win, '[data-qa-building-interior-back]');
  await assertReturned(win, 'military', 'research');
  await closeDialog(win);

  await enterBuilding(win, 'planetary-government');
  await waitFor(win, `document.querySelector('.command-view')`);
  await waitFor(win, `document.querySelector('[data-qa-building-interior-back]')`);
  await pressEscape(win);
  await assertReturned(win, 'military', 'planetary-government');
  await closeDialog(win);

  await enterBuilding(win, 'spaceport');
  await waitFor(win, `document.querySelector('[data-qa-spaceport-upgrades]')`);
  await waitFor(win, `document.querySelector('[data-qa-spaceport-tab="ships"]')`);
  await click(win, '[data-qa-building-interior-back]');
  await assertReturned(win, 'military', 'spaceport');
}

async function verifyMaxBuildingDialog(win, directory) {
  await activateZone(win, 'military');
  await click(win, '[data-zone-building-role="shipyard"]');
  await waitFor(win, `document.querySelector('[data-qa-building-dialog="shipyard"]')`);
  const snapshot = await win.webContents.executeJavaScript(`(() => {
    const root = document.querySelector('[data-qa-building-dialog="shipyard"]');
    const levels = Array.from(root?.querySelectorAll('.resource-building-level') ?? []).map((node) => node.textContent?.replace(/\\s+/g, ' ').trim() ?? '');
    return {
      current: levels.find((value) => value.includes('Текущий уровень')) ?? '',
      next: levels.find((value) => value.includes('Следующий уровень')) ?? '',
      max: levels.find((value) => value.includes('Максимальный')) ?? '',
      maxState: root?.querySelector('[data-qa-max-level-state]')?.textContent?.replace(/\\s+/g, ' ').trim() ?? '',
      hasEffect: Boolean(root?.querySelector('[data-qa-building-effect]')),
      hasTime: Boolean(root?.querySelector('[data-qa-building-time-effective]')),
      hasCost: Boolean(root?.querySelector('[data-qa-building-cost]')),
      hasBuild: Boolean(root?.querySelector('[data-qa-build-button]')),
      hasEnter: Boolean(root?.querySelector('[data-qa-enter-building="shipyard"]')),
    };
  })()`);
  if (!snapshot.current.includes('15') || !snapshot.next.includes('—') || !snapshot.max.includes('15') || !snapshot.maxState.includes('ЗДАНИЕ УЛУЧШЕНО ДО МАКСИМАЛЬНОГО УРОВНЯ') || snapshot.hasEffect || snapshot.hasTime || snapshot.hasCost || snapshot.hasBuild || !snapshot.hasEnter) {
    throw new Error(`Maximum building dialog contract failed: ${JSON.stringify(snapshot)}`);
  }
  await capture(win, directory, 'building-dialog-shipyard-max-level');
  await closeDialog(win);
}

async function verifyFlow(win, directory) {
  await win.webContents.executeJavaScript(`localStorage.removeItem(${JSON.stringify(SAVE_KEY)})`);
  await reload(win);
  await setBuiltInteriorSave(win);

  await verifyProductionHost(win, directory);
  await verifyMaxBuildingDialog(win, directory);
  await verifyMilitaryDeepLinks(win, directory);

  return {
    screen: 'building-interiors-navigation',
    verified: [
      'factory-enter-back-return',
      'advanced-factory-enter-escape-return',
      'shipyard-max-level-dialog',
      'shipyard-fleet-deep-link-escape-return',
      'shipyard-defense-shared-construction-visual',
      'research-science-deep-link-back-return',
      'government-command-deep-link-escape-return',
      'spaceport-specialized-host-back-return',
    ],
  };
}

app.whenReady().then(async () => {
  let win;
  try {
    fs.mkdirSync(OUTPUT, { recursive: true });
    win = new BrowserWindow({
      width: 1000,
      height: 700,
      show: false,
      backgroundColor: '#02050a',
      webPreferences: {
        offscreen: true,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        partition: 'qa-building-interiors',
      },
    });
    await win.loadFile(path.join(ROOT, 'dist', 'index.html'));
    win.webContents.debugger.attach('1.3');

    for (const [width, height] of VIEWPORTS) {
      const label = `${width}x${height}`;
      const directory = path.join(OUTPUT, label);
      fs.mkdirSync(directory, { recursive: true });
      await win.webContents.debugger.sendCommand('Emulation.setDeviceMetricsOverride', {
        width,
        height,
        deviceScaleFactor: 1,
        mobile: false,
        screenWidth: width,
        screenHeight: height,
      });
      await settle(win);
      const result = await verifyFlow(win, directory);
      fs.writeFileSync(path.join(directory, 'building-interiors-metrics.json'), JSON.stringify(result, null, 2));
    }

    win.webContents.debugger.detach();
    win.destroy();
    app.exit(0);
  } catch (error) {
    console.error(error);
    try {
      if (win?.webContents.debugger.isAttached()) win.webContents.debugger.detach();
    } catch {}
    win?.destroy();
    app.exit(1);
  }
});
