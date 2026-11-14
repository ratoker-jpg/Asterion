// Runtime WebP derivatives of the heavy PNG sources (assets/source → src/assets/art).
//
// The game bundles only the light WebP copies from src/assets/art. The originals stay in
// assets/source (not imported anywhere, so they never reach the build / installer).
//
//   node tools/build-game-art.mjs           convert every source that the code references
//   node tools/build-game-art.mjs --check   list what would change, write nothing
//
// A source is converted when its destination path (assets/art/<rel>.webp) appears in src/**
// (or when it lives in a folder that is addressed through a template, e.g. buildings/${faction}).
// Mapping: assets/source/New assets/ship/aegis/a.png → src/assets/art/ship/aegis/a.webp
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(root, 'assets', 'source');
const OUT = path.join(root, 'src', 'assets', 'art');

// Longest edge in px (fit inside, never upscale). `keep` = keep the original pixel size (full-screen backgrounds).
// Order matters: first match wins.
const RULES = [
  { test: /^New assets\/buildings\//, max: 640, quality: 82, templated: true },
  { test: /^New assets\/technologies\//, max: 512, quality: 82 },
  { test: /^New assets\/(ship|defenses|comander_ship)\//, max: 512, quality: 84 },
  { test: /^ships\/pirates\//, max: 640, quality: 84 },
  { test: /^characters\/pirates\//, max: 640, quality: 84 },
  { test: /^generated-factions-v1\/factions\/\w+_general\.png$/, max: 640, quality: 84 },
  { test: /^(planets\/(skins|pirate)|starter\/planets|universe-navigation\/(planets|asteroids|system-stars))\//, max: 512, quality: 85 },
  { test: /^battle-report-v2\/battle-planet/, max: 768, quality: 85 },
  { test: /^(battle-report-v2\/battle-space-background|faction-delivery-v1\/territories\/|starter\/backgrounds\/system_background)/, keep: true, quality: 80 },
];
const EXCLUDE = [/qa-edges/];

const check = process.argv.includes('--check');

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'art') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

const codeText = walk(path.join(root, 'src'))
  .filter((file) => /\.(tsx?|css|json)$/.test(file))
  .map((file) => fs.readFileSync(file, 'utf8'))
  .join('\n');

const toPosix = (value) => value.split(path.sep).join('/');
let converted = 0;
let bytesIn = 0;
let bytesOut = 0;

for (const file of walk(SRC)) {
  if (!file.endsWith('.png')) continue;
  const rel = toPosix(path.relative(SRC, file));
  if (EXCLUDE.some((re) => re.test(rel))) continue;
  const rule = RULES.find((item) => item.test.test(rel));
  if (!rule) continue;
  const outRel = rel.replace(/^New assets\//, '').replace(/\.png$/, '.webp');
  if (!rule.templated && !codeText.includes(`assets/art/${outRel}`)) continue;
  const outFile = path.join(OUT, outRel);
  const pipeline = sharp(file, { limitInputPixels: false }).rotate();
  if (!rule.keep) pipeline.resize({ width: rule.max, height: rule.max, fit: 'inside', withoutEnlargement: true });
  const buffer = await pipeline.webp({ quality: rule.quality, alphaQuality: 92, effort: 5, smartSubsample: true }).toBuffer();
  bytesIn += fs.statSync(file).size;
  bytesOut += buffer.length;
  converted += 1;
  if (!check) {
    fs.mkdirSync(path.dirname(outFile), { recursive: true });
    fs.writeFileSync(outFile, buffer);
  }
}

const mb = (value) => (value / 1048576).toFixed(1);
console.log(`${check ? 'would convert' : 'converted'} ${converted} files: ${mb(bytesIn)} MB PNG → ${mb(bytesOut)} MB WebP`);
