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
    const code = "(() => { const el=document.querySelector('.stage'); const view=document.querySelector('.viewport'); if(!el || !view) return {found:false,location:location.href}; const r=el.getBoundingClientRect(); return {found:true,x:r.x,y:r.y,w:r.width,h:r.height,iw:innerWidth,ih:innerHeight,preview:document.documentElement.classList.contains('web-preview')}; })()";
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
    const dx = Math.abs(s.x + s.w / 2 - s.iw / 2);
    const dy = Math.abs(s.y + s.h / 2 - s.ih / 2);
    assert.ok(dx < 3 && dy < 3, 'Stage not centered: ' + width + 'x' + height + ' ' + JSON.stringify(s));
    assert.ok(s.w > width * 0.84 && s.h > height * 0.84, 'Stage undersized: ' + JSON.stringify(s));
    console.log('OK ' + width + 'x' + height + ': centered and still rendered after delay');
  }
  assert.deepEqual(errors, [], 'Browser JavaScript exceptions');
  console.log('Preview multi-resolution browser QA passed.');
} finally {
  socket?.close();
  chrome.kill('SIGTERM');
  await rm(profile, { recursive: true, force: true });
}
