const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-gpu');
app.on('window-all-closed', () => {});

const ROOT = path.join(__dirname, '..');
const OUTPUT = path.join(ROOT, 'artifacts', 'operations-variant-a');
const TYPES = ['pirate', 'unique', 'anomaly'];
const STATES = [
  { key: 'available', label: 'ДОСТУПНЫЕ' },
  { key: 'active', label: 'АКТИВНЫЕ' },
  { key: 'completed', label: 'ЗАВЕРШЁННЫЕ' },
];
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(win, expression, timeoutMs = 20_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await win.webContents.executeJavaScript(`Boolean(${expression})`)) return;
    await sleep(60);
  }
  throw new Error(`Timed out waiting for: ${expression}`);
}

async function click(win, selector) {
  const didClick = await win.webContents.executeJavaScript(`(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    if (!element || element.disabled) return false;
    element.click();
    return true;
  })()`);
  if (!didClick) throw new Error(`Element not found or disabled: ${selector}`);
  await win.webContents.executeJavaScript('new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
  await sleep(100);
}

async function capture(win, output, filename) {
  const result = await win.webContents.debugger.sendCommand('Page.captureScreenshot', {
    format: 'png', fromSurface: true, captureBeyondViewport: false,
  });
  fs.writeFileSync(path.join(output, filename), Buffer.from(result.data, 'base64'));
}

async function openWindow(width, height, fixtureStatus) {
  const win = new BrowserWindow({
    width, height, useContentSize: true, show: false,
    backgroundColor: '#02050a',
    webPreferences: { offscreen: true, contextIsolation: true, nodeIntegration: false, sandbox: true,
      partition: `qa-operations-variant-a-${width}` },
  });
  await win.loadURL('about:blank');
  win.webContents.debugger.attach('1.3');
  await win.webContents.debugger.sendCommand('Page.enable');
  await win.webContents.debugger.sendCommand('Emulation.setDeviceMetricsOverride', {
    width, height, deviceScaleFactor: 1, mobile: false, screenWidth: width, screenHeight: height,
  });
  const loaded = new Promise((resolve) => win.webContents.once('did-finish-load', resolve));
  await win.loadFile(path.join(ROOT, 'dist', 'index.html'), { search: '?mode=test', hash: `operations-variant-a-${fixtureStatus}` });
  await loaded;
  await waitFor(win, `document.querySelector('[data-qa-navigation="primary"]')`);
  await waitFor(win, `innerWidth === ${width} && innerHeight === ${height}`);
  await click(win, '[data-qa-navigation="primary"] [data-qa-route="operations"]');
  await waitFor(win, `document.querySelector('.operations-shell-v2--variant-a')`);
  const routeState = await win.webContents.executeJavaScript(`({ search: location.search, hash: location.hash, cards: document.querySelectorAll('.operation-feed-card-v2').length, kinds: [...document.querySelectorAll('.operation-feed-card-v2')].map((card) => card.getAttribute('data-contact-kind')), counts: [...document.querySelectorAll('.operations-tabs-v2 [role="tab"]')].map((tab) => tab.textContent.trim()) })`);
  console.log(`[operations-variant-a-screenshots] ${width}x${height} operations route: ${JSON.stringify(routeState)}`);
  if (routeState.search !== '?mode=test' || routeState.hash !== `#operations-variant-a-${fixtureStatus}`) {
    throw new Error(`Variant A fixture route was not isolated to Test Mode: ${JSON.stringify(routeState)}`);
  }
  // The Test Mode combat diagnostics remain present and are covered by the pirate UI QA.
  // Hide only that non-reference panel in these composition captures.
  await win.webContents.executeJavaScript(`(() => {
    const style = document.createElement('style');
    style.dataset.qaVariantACapture = 'true';
    style.textContent = '.operations-pirate-adaptive-test-v1 { display:none !important; }';
    document.head.appendChild(style);
  })()`);
  return win;
}

async function selectState(win, state) {
  const selector = `.operations-tabs-v2 [role="tab"]`;
  const didClick = await win.webContents.executeJavaScript(`(() => {
    const button = [...document.querySelectorAll(${JSON.stringify(selector)})].find((node) => node.textContent.includes(${JSON.stringify(state.label)}));
    if (!button) return false;
    button.click();
    return true;
  })()`);
  if (!didClick) throw new Error(`Operations tab not found: ${state.label}`);
  await waitFor(win, `document.querySelector('.operations-tabs-v2 [role="tab"][aria-selected="true"]')?.textContent?.includes(${JSON.stringify(state.label)})`);
}

async function selectKindAndCapture(win, output, state, kind, number) {
  await click(win, `.operations-contact-filters-v-a [data-filter-kind="${kind}"]`);
  await waitFor(win, `document.querySelectorAll('.operations-feed-scroll-v2 .operation-feed-card-v2[data-contact-kind="${kind}"]').length === 1`);
  await waitFor(win, `document.querySelector('.operations-feed-scroll-v2 .operation-feed-card-v2.selected[data-contact-kind="${kind}"]')`);
  await waitFor(win, `document.querySelector('.operations-dossier-variant-a')`);
  await waitFor(win, `(() => [...document.querySelectorAll('.operations-feed-scroll-v2 .operation-feed-card-v2.selected img, .operations-dossier-variant-a img')].every((image) => image.complete && image.naturalWidth > 0))()`);
  const stateProof = await win.webContents.executeJavaScript(`(() => {
    const card = document.querySelector('.operations-feed-scroll-v2 .operation-feed-card-v2.selected');
    const images = [...document.querySelectorAll('.operations-feed-scroll-v2 .operation-feed-card-v2.selected img, .operations-dossier-variant-a img')];
    return { kind: card?.getAttribute('data-contact-kind'), state: document.querySelector('.operations-tabs-v2 [role="tab"][aria-selected="true"]')?.textContent?.trim(), images: images.map((image) => Boolean(image.complete && image.naturalWidth > 0)), horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 2 };
  })()`);
  if (stateProof.kind !== kind || !stateProof.state?.includes(state.label) || stateProof.images.includes(false) || stateProof.horizontalOverflow) {
    throw new Error(`Variant A screenshot state mismatch: ${JSON.stringify(stateProof)}`);
  }
  const file = `${String(number).padStart(2, '0')}-${state.key}-${kind}.png`;
  await capture(win, output, file);
  return { file, ...stateProof };
}

async function runViewport(width, height, allStates) {
  const label = `${width}x${height}`;
  const output = path.join(OUTPUT, label);
  fs.mkdirSync(output, { recursive: true });
  const captures = [];
  const stateCaptures = allStates
    ? STATES.map((state) => [state, TYPES.map((kind, index) => [kind, STATES.indexOf(state) * TYPES.length + index + 1])])
    : [[STATES[0], [['pirate', 1]]], [STATES[1], [['unique', 5]]], [STATES[2], [['anomaly', 9]]]];
  let viewportMetrics = null;
  for (const [state, pairs] of stateCaptures) {
    const win = await openWindow(width, height, state.key);
    try {
      await selectState(win, state);
      await waitFor(win, `document.querySelectorAll('.operations-feed-scroll-v2 .operation-feed-card-v2').length === 3`);
      for (const [kind, index] of pairs) {
        captures.push(await selectKindAndCapture(win, output, state, kind, index));
      }
      viewportMetrics = await win.webContents.executeJavaScript(`(() => {
        const stage = document.querySelector('.stage');
        const bounds = stage?.getBoundingClientRect();
        const style = stage ? getComputedStyle(stage) : null;
        return {
          width: innerWidth,
          height: innerHeight,
          horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 2,
          stageBounds: bounds ? { left: bounds.left, top: bounds.top, right: bounds.right, bottom: bounds.bottom, width: bounds.width, height: bounds.height } : null,
          stageTransform: style?.transform ?? null,
          stageTransformOrigin: style?.transformOrigin ?? null,
        };
      })()`);
      const stageBounds = viewportMetrics.stageBounds;
      const stageMatchesViewport = stageBounds && Math.abs(stageBounds.left) <= 1 && Math.abs(stageBounds.top) <= 1
        && Math.abs(stageBounds.width - width) <= 1 && Math.abs(stageBounds.height - height) <= 1;
      if (viewportMetrics.width !== width || viewportMetrics.height !== height || viewportMetrics.horizontalOverflow || !stageMatchesViewport) {
        throw new Error(`Viewport check failed: ${JSON.stringify(viewportMetrics)}`);
      }
    } finally {
      win.destroy();
    }
  }
  return { viewport: label, captures, viewportMetrics };
}

app.whenReady().then(async () => {
  try {
    const results = [
      await runViewport(1920, 1080, true),
      await runViewport(1280, 720, false),
    ];
    fs.writeFileSync(path.join(OUTPUT, 'screenshot-manifest.json'), JSON.stringify({ results }, null, 2));
    console.log(JSON.stringify({ results }, null, 2));
    app.exit(0);
  } catch (error) {
    console.error(error);
    app.exit(1);
  }
});
