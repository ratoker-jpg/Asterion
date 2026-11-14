#!/usr/bin/env node
// Batch: one Codex call -> N images. Usage: node gen-batch.cjs <jobs.json> <outDir>
// jobs.json: [{name, prompt}] ; each image transparent, 1024x1024.
'use strict';
const fs = require('fs'), os = require('os'), path = require('path');
const { spawnSync } = require('child_process');
const [jobsFile, outDir] = process.argv.slice(2);
const jobs = JSON.parse(fs.readFileSync(jobsFile, 'utf8'));
const binRoot = path.join(os.homedir(), 'AppData', 'Local', 'OpenAI', 'Codex', 'bin');
let codex = null, newest = 0;
for (const d of fs.readdirSync(binRoot)) { const c = path.join(binRoot, d, 'codex.exe'); if (fs.existsSync(c)) { const t = fs.statSync(c).mtimeMs; if (t > newest) { newest = t; codex = c; } } }
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-batch-'));
const started = Date.now();
const lines = [
  `Use your image generation tool to create exactly ${jobs.length} separate images, one image generation call per image, in the order below. Do not write code other than copying files.`,
  'Every image: 1024x1024, background MUST be fully transparent (use the transparent background option, PNG with alpha), no backdrop, no frame, no baked-in colour behind the subject. No text or letters. Do not imitate any existing game, brand or artist.',
  'Do not copy or move files, do not run shell commands: just generate the images in order.',
  '',
];
jobs.forEach((j, i) => lines.push(`Image ${i + 1} -> file name: ${j.name}.png\n${j.prompt}\n`));
lines.push('When all are done, reply with the list of file names you saved.');
const run = spawnSync(codex, ['exec', '--json', '--skip-git-repo-check', '-s', 'workspace-write', '-C', work, lines.join('\n')], { encoding: 'utf8', timeout: 40 * 60 * 1000, maxBuffer: 64 * 1024 * 1024 });
fs.mkdirSync(outDir, { recursive: true });
const tid = ((run.stdout || '').match(/"thread_id"\s*:\s*"([^"]+)"/) || [])[1];
const sess = tid ? path.join(os.homedir(), '.codex', 'generated_images', tid) : null;
const files = sess && fs.existsSync(sess) ? fs.readdirSync(sess).filter((n) => /\.png$/i.test(n)).map((n) => ({ f: path.join(sess, n), t: fs.statSync(path.join(sess, n)).mtimeMs })).sort((a, b) => a.t - b.t).map((x) => x.f) : [];
const res = [];
if (files.length !== jobs.length) res.push({ warning: `expected ${jobs.length} images, got ${files.length}`, sess });
for (const [i, j] of jobs.entries()) {
  const src = files[i] || '';
  if (!fs.existsSync(src)) { res.push({ name: j.name, ok: false }); continue; }
  const out = path.join(outDir, j.name + '.png'); fs.copyFileSync(src, out);
  const b = fs.readFileSync(out); let w = null, h = null, a = null;
  if (b.slice(1, 4).toString() === 'PNG') { w = b.readUInt32BE(16); h = b.readUInt32BE(20); a = b[25] === 4 || b[25] === 6 || b.includes(Buffer.from('tRNS')); }
  res.push({ name: j.name, ok: true, width: w, height: h, hasAlpha: a });
}
console.log(JSON.stringify({ seconds: Math.round((Date.now() - started) / 1000), work, results: res, tail: res.some(r => r.ok === false || r.warning) ? (run.stdout || '').slice(-1500) + (run.stderr || '').slice(-800) : undefined }, null, 1));
