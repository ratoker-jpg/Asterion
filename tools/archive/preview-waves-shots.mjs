// Usage: node tools/preview-waves-shots.mjs "<PR preview url>?mode=test" <fixture.json from generate-preview-waves-fixture.mjs> <out dir>
// Headless Edge against the PR preview: loads the 4-planet fixture and shoots the quick-send waves panel and the fleet plan.
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const [url, fixturePath, outDir] = process.argv.slice(2);
const fixture = await readFile(fixturePath, 'utf8');
await mkdir(outDir, { recursive: true });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const profile = await mkdtemp(join(tmpdir(), 'ast-waves-'));
const edge = spawn('C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', [
  '--headless=new', '--disable-gpu', '--remote-allow-origins=*', '--remote-debugging-port=0', '--user-data-dir=' + profile,
  '--window-size=1280,720', 'about:blank'], { stdio: 'ignore' });
let port;
for (let i = 0; i < 100 && !port; i++) { try { port = Number((await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]); } catch {} await wait(100); }
const tabs = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
const ws = new WebSocket(tabs.find((t) => t.type === 'page').webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r, { once: true }));
let seq = 0; const pending = new Map(); const errors = [];
ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails?.exception?.description); const p = pending.get(m.id); if (p) { pending.delete(m.id); m.error ? p.reject(new Error(JSON.stringify(m.error))) : p.resolve(m.result); } });
const send = (method, params = {}) => new Promise((resolve, reject) => { const id = ++seq; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params })); });
const js = async (expr) => (await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })).result?.value;
const waitFor = async (expr, ms = 30000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await js(`!!(${expr})`)) return true; await wait(200); } throw new Error('timeout: ' + expr + '\n' + errors.join('\n')); };
const shot = async (name) => { const c = await send('Page.captureScreenshot', { format: 'png' }); await writeFile(join(outDir, name), Buffer.from(c.data, 'base64')); console.log('shot', name); };
await send('Page.enable'); await send('Runtime.enable');
const origin = new URL(url).origin;
await send('Page.addScriptToEvaluateOnNewDocument', { source: `if (location.origin === ${JSON.stringify(origin)} && !sessionStorage.getItem('qa-seeded')) { localStorage.setItem('asterion.vertical-slice.test.v1', ${JSON.stringify(fixture)}); localStorage.setItem('asterion.test-time-scale.v1', '1'); sessionStorage.setItem('qa-seeded', '1'); }` });
await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url });
await waitFor(`document.querySelector('[data-qa-navigation="utility"]')`, 90000);
await wait(4000);
console.log('saved planets', await js(`Object.keys(JSON.parse(localStorage.getItem('asterion.vertical-slice.test.v1') || '{}').planets || {})`));
console.log('keys', await js(`Object.keys(localStorage)`));
await shot('00-start.png');
await js(`document.querySelector('[data-qa-route="universe"]')?.click()`);
await waitFor(`document.querySelector('[data-qa-universe]')`);
const jump = async (system) => {
  await js(`(() => { const e = document.querySelector('.universe-jump select'); const set = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set; set.call(e, ${JSON.stringify(String(system))}); e.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  await waitFor(`document.querySelector('[data-qa-universe]')?.getAttribute('data-qa-universe-system') === ${JSON.stringify(String(system))}`);
};
const rightClick = async (selector) => {
  await waitFor(`document.querySelector(${JSON.stringify(selector)})`);
  await js(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); const r = e.getBoundingClientRect(); e.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2, clientX: r.x + r.width / 2, clientY: r.y + r.height / 2 })); })()`);
  await waitFor(`document.querySelector('[data-qa-quick-menu]')`);
};
const openDeployment = async () => {
  await jump(7);
  await wait(800);
  console.log('objects', await js(`[...document.querySelectorAll('[data-qa-universe-object]')].map((e) => e.getAttribute('data-qa-universe-object')).join(',')`));
  await shot('00-system7.png');
  await rightClick('[data-qa-universe-object="wave-target"]');
  await js(`document.querySelector('[data-qa-quick-action="deployment"]').click()`);
  await waitFor(`document.querySelector('[data-qa-quick-send="deployment"]')`);
  await js(`[...document.querySelectorAll('[data-qa-quick-leg-checked="false"] [data-qa-quick-origin]')].forEach((b) => b.click())`);
  await wait(600);
};
const setSpeed = async (planetId, value) => {
  await js(`(() => { const e = document.querySelector('[data-qa-flight-speed=${JSON.stringify(planetId)}] input[type=range]'); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(e, ${JSON.stringify(String(value))}); e.dispatchEvent(new Event('input', { bubbles: true })); e.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  await wait(500);
};
const report = async () => console.log(JSON.stringify(await js(`(() => { const p = document.querySelector('[data-qa-quick-send]'); return { waves: [...p.querySelectorAll('[data-qa-quick-leg]')].map((l) => ({ id: l.getAttribute('data-qa-quick-leg'), wave: l.querySelector('[data-qa-quick-wave-no]')?.textContent, time: l.querySelector('.quick-send__leg-toggle > span')?.textContent, speed: l.querySelector('[data-qa-flight-speed]')?.getAttribute('data-qa-flight-speed-value') })), error: p.querySelector('[data-qa-quick-wave-error]')?.textContent, overflowX: p.scrollWidth > p.clientWidth + 1 }; })()`)));
await openDeployment();
await report();
await shot('01-waves-default.png');
await js(`(() => { const l = document.querySelector('.quick-send__legs'); l.scrollTop = l.scrollHeight; })()`);
await wait(300);
await shot('02-waves-default-bottom.png');
// The last wave crawls at 10%.
const order = await js(`[...document.querySelectorAll('[data-qa-quick-wave-no]')].map((n) => n.closest('[data-qa-quick-leg]').getAttribute('data-qa-quick-leg'))`);
console.log('order', order);
const last = (await js(`(() => { const nodes = [...document.querySelectorAll('[data-qa-quick-wave-no]')]; const n = nodes.find((x) => x.textContent === String(nodes.length)); return n?.closest('[data-qa-quick-leg]').getAttribute('data-qa-quick-leg'); })()`));
await setSpeed(last, 10);
await report();
await js(`(() => { const e = document.querySelector('[data-qa-quick-leg=${JSON.stringify(last)}]'); e.scrollIntoView({ block: 'center' }); })()`);
await wait(300);
await shot('03-last-wave-10pct.png');
// The first wave crawls at 10%: the next ones cannot land after it.
const first = (await js(`(() => { const n = [...document.querySelectorAll('[data-qa-quick-wave-no]')].find((x) => x.textContent === '1'); return n?.closest('[data-qa-quick-leg]').getAttribute('data-qa-quick-leg'); })()`));
await setSpeed(last, 100);
await setSpeed(first, 10);
await report();
await js(`(() => { const l = document.querySelector('.quick-send__legs'); l.scrollTop = l.scrollHeight; })()`);
await wait(300);
await shot('04-first-wave-10pct-refused.png');
// Move a wave later.
await setSpeed(first, 100);
await js(`document.querySelector('[data-qa-quick-wave="1"] [data-qa-quick-wave-later]')?.click()`);
await wait(500);
await report();
await js(`(() => { const l = document.querySelector('.quick-send__legs'); l.scrollTop = 0; })()`);
await shot('05-wave-moved.png');
// Fleets → «Дислокация» flight plan at 10%.
await js(`document.querySelector('[data-qa-quick-send] .quick-send__close')?.click()`);
await wait(400);
await js(`document.querySelector('[data-qa-route="fleets"]').click()`);
await waitFor(`document.querySelector('[data-qa-fleet-root]')`);
await js(`document.querySelector('[data-qa-mission-id="deployment"]')?.click()`);
await wait(500);
await js(`(() => { const e = document.querySelector('[data-qa-fleet-ship="cruiser"] input[type="number"]') || document.querySelector('[data-qa-fleet-ship] input[type="number"]'); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(e, '999999999'); e.dispatchEvent(new Event('input', { bubbles: true })); })()`);
await wait(400);
await js(`document.querySelector('[data-qa-flight-preview-open]')?.click()`);
await waitFor(`document.querySelector('[data-qa-flight-speed="fleet-plan"]')`);
await js(`(() => { const s = document.querySelector('[data-qa-deployment-target-select] select'); if (!s) return; const set = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set; set.call(s, 'wave-target'); s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
await wait(800);
await js(`document.querySelector('.fa-plan-speed')?.scrollIntoView({ block: 'center' })`);
await wait(300);
await shot('06-fleet-plan-100.png');
await setSpeed('fleet-plan', 10);
await wait(400);
await shot('07-fleet-plan-10pct.png');
console.log('plan', await js(`document.querySelector('[data-qa-plan-footer]')?.textContent + ' | ' + document.querySelector('[data-qa-flight-speed="fleet-plan"]')?.textContent`));
console.log('errors', errors.length ? errors.join('\n') : 'none');
ws.close(); edge.kill();
process.exit(0);
