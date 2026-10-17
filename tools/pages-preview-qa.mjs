import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const [url, chromeBin = 'google-chrome'] = process.argv.slice(2);
assert.ok(url, 'Preview URL required');
const wait = (ms) => new Promise((done) => setTimeout(done, ms));
const profile = await mkdtemp(join(tmpdir(), 'asterion-preview-'));
const chrome = spawn(chromeBin, [
  '--headless=new', '--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu',
  '--remote-allow-origins=*', '--remote-debugging-port=0',
  '--user-data-dir=' + profile, 'about:blank',
], { stdio: 'ignore' });
let socket;
try {
  let port;
  for (let i = 0; i < 100; i++) {
    try {
      port = Number((await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]);
      if (port) break;
    } catch { /* Chrome is starting */ }
    await wait(100);
  }
  assert.ok(port, 'Chrome DevTools did not start');
  const tabs = await (await fetch('http://127.0.0.1:' + port + '/json')).json();
  const tab = tabs.find((t) => t.type === 'page');
  assert.ok(tab, 'Chrome tab missing');
  socket = new WebSocket(tab.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });
  let seq = 0;
  const pending = new Map();
  const errors = [];
  socket.addEventListener('message', (e) => {
    const msg = JSON.parse(e.data);
    if (msg.method === 'Runtime.exceptionThrown') {
      errors.push(msg.params.exceptionDetails?.text || 'Uncaught exception');
    }
    const promise = pending.get(msg.id);
    if (promise) {
      pending.delete(msg.id);
      msg.error ? promise.reject(new Error(JSON.stringify(msg.error))) : promise.resolve(msg.result);
    }
  });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++seq;
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });
  await send('Page.enable');
  await send('Runtime.enable');
  const readStage = async () => {
    const code = "(() => { const el=document.querySelector('.stage'); const view=document.querySelector('.viewport'); if(!el || !view) return {found:false,location:location.href}; const r=el.getBoundingClientRect(); return {found:true,x:r.x,y:r.y,w:r.width,h:r.height,iw:innerWidth,ih:innerHeight,preview:document.documentElement.classList.contains('web-preview'),mode:document.querySelector('[data-qa-runtime-mode]')?.getAttribute('data-qa-runtime-mode')}; })()";
    const out = await send('Runtime.evaluate', { expression: code, returnByValue: true });
    return out.result?.value;
  };
  for (const [width, height] of [[1280,720],[1204,650],[1600,900],[1920,1080]]) {
    await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
    await send('Page.navigate', { url });
    let s;
    for (let tries = 0; tries < 90; tries++) {
      s = await readStage();
      if (s?.found) break;
      await wait(250);
    }
    assert.ok(s?.found, 'Missing stage: ' + width + 'x' + height + ' ' + JSON.stringify(s));
    await wait(width === 1280 ? 15000 : 3000);
    s = await readStage();
    assert.ok(s?.found && s.preview, 'Stage disappeared after load: ' + width + 'x' + height);
    assert.equal(s.mode, 'test', 'Preview must stay in Test Mode even with &sha or &v parameters');
    const dx = Math.abs(s.x + s.w / 2 - s.iw / 2);
    const dy = Math.abs(s.y + s.h / 2 - s.ih / 2);
    assert.ok(dx < 3 && dy < 3, 'Stage not centered: ' + width + 'x' + height + ' ' + JSON.stringify(s));
    assert.ok(s.w > width * 0.84 && s.h > height * 0.84, 'Stage undersized: ' + JSON.stringify(s));
    console.log('OK ' + width + 'x' + height + ': centered and still rendered after delay');
  }
  // The build's public asset manifest uses document-relative URLs, not hashed JS imports.
  // Check files that previously rendered as broken-image placeholders in PR previews.
  const assets = await send('Runtime.evaluate', {
    expression: "(async () => { const files=['./assets/generated/asterion/ui/report-icons/profile.webp','./assets/generated/asterion/ui/report-icons/system.webp','./assets/generated/asterion/ui/score-icons/resource-crystal.webp','./assets/generated/asterion/ui/score-icons/battle.webp','./assets/generated/asterion/universe/unique-objects/unique-variant-01.webp']; return await Promise.all(files.map(async p => { const i=new Image(); i.src=p; try { await i.decode(); return {path:p,ok:i.naturalWidth>0}; } catch { return {path:p,ok:false,src:i.src}; } })); })()",
    awaitPromise: true, returnByValue: true,
  });
  const assetResults = assets.result?.value;
  assert.ok(Array.isArray(assetResults), 'Missing image decode result');
  assert.ok(assetResults.every((item) => item.ok), 'Broken preview image assets: ' + JSON.stringify(assetResults));
  console.log('Public report icons, score medals and universe art load in deployed preview.');
  // Exercise actual React navigation and all profile image elements, not just URLs.
  const nav = await send('Runtime.evaluate', {
    expression: "(() => { const button=document.querySelector('[data-qa-route=reports]'); if(!button)return false; button.click(); return true; })()",
    returnByValue: true,
  });
  assert.equal(nav.result?.value, true, 'Reports navigation button missing');
  let reportState;
  const reportProbe = "(() => { const imgs=[...document.querySelectorAll('.reports-v2-art img, .reports-score-glyph')]; return {profile:!!document.querySelector('[data-qa-profile]'),metrics:document.querySelectorAll('[data-qa-profile-metric]').length,imageCount:imgs.length,pending:imgs.filter(i=>!i.complete).length,broken:imgs.filter(i=>i.complete && i.naturalWidth===0).map(i=>i.currentSrc || i.src),testNoteVisible:(()=>{const el=document.querySelector('.reports-fixture-note');return !!el && getComputedStyle(el).display!=='none';})()}; })()";
  for (let retries = 0; retries < 40; retries += 1) {
    await wait(350);
    const r = await send('Runtime.evaluate', { expression: reportProbe, returnByValue: true });
    reportState = r.result?.value;
    if (reportState?.profile && reportState.metrics === 4 && reportState.imageCount >= 12 && reportState.pending === 0) break;
  }
  assert.ok(reportState?.profile && reportState.metrics === 4, 'Profile did not open: ' + JSON.stringify(reportState));
  assert.ok(reportState.imageCount >= 12, 'Profile is missing image elements: ' + JSON.stringify(reportState));
  assert.equal(reportState.pending, 0, 'Profile images still loading: ' + JSON.stringify(reportState));
  assert.deepEqual(reportState.broken, [], 'Broken visual assets in Reports profile');
  assert.equal(reportState.testNoteVisible, true, 'Test Mode profile note must be visible');
  console.log('Reports profile: all channel icons and 4 score medals decoded; Test Mode note visible.');
  const operations = await send('Runtime.evaluate', {
    expression: "(() => { const b=document.querySelector('[data-qa-route=operations]'); if(!b)return false; b.click(); return true; })()",
    returnByValue: true,
  });
  assert.equal(operations.result?.value, true, 'Operations navigation button missing');
  await wait(1000);
  const operationsReady = await send('Runtime.evaluate', {
    expression: "!!document.querySelector('.operations-shell-v2--variant-a')",
    returnByValue: true,
  });
  assert.equal(operationsReady.result?.value, true, 'Operations Variant A failed to render');
  console.log('Operations Variant A opened in the live Test Mode preview.');
  assert.deepEqual(errors, [], 'Browser JavaScript exceptions');
  console.log('Preview multi-resolution browser QA passed.');
} finally {
  socket?.close();
  chrome.kill('SIGTERM');
  // The CI runner is ephemeral. Chrome can briefly recreate profile files while stopping.
  // Cleanup must not turn successful rendering assertions into a failed deployment.
  await rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 250 })
    .catch((error) => console.warn('Browser profile cleanup skipped:', error.message));
}
