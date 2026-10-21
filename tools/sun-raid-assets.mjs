// Runtime WebP derivatives of the Sun raid / menu source art (assets/source → public/assets/generated/sun-raid).
// Sources: Codex ImageGen delivery, see docs/notes/sun-raid-imagegen-delivery.md. Re-run after replacing a source.
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const SOURCE = path.join(ROOT, 'assets', 'source');
const OUT = path.join(ROOT, 'public', 'assets', 'generated', 'sun-raid');

const square = (from, to, size, quality = 86) => ({ from, to, resize: { width: size, height: size, fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }, quality });
const wide = (from, to) => ({ from, to, resize: { width: 1672, height: 941, fit: 'cover' }, quality: 80 });

const JOBS = [
  ...[1, 2, 3, 4].flatMap((n) => [
    square(`sun-raid/crystals/crystal-${n}.png`, `crystal-${n}.webp`, 192),
    square(`sun-raid/crystals/crystal-${n}-empty.png`, `crystal-${n}-empty.webp`, 192),
  ]),
  ...['bright', 'dimmed', 'frozen'].map((state) => square(`sun-raid/sun/sun-${state}.png`, `sun-${state}.webp`, 640)),
  ...['aegis', 'synod', 'veyra'].flatMap((race) => ['', '-construction', '-ruined'].map((stage) =>
    square(`New assets/buildings/${race}/building.${race}.supreme-galactic-gates${stage}.png`, `gates-${race}${stage || '-built'}.webp`, 768))),
  square('mission-icons-v1/37_sun_raid.png', 'mission-sun-raid.webp', 256),
  square('debris/debris-finder.png', 'debris-finder.webp', 96),
  square('debris/sun-debris.png', 'sun-debris.webp', 256),
  ...['', '-aegis', '-synod', '-veyra'].map((race) => wide(`menu/menu-background${race}.png`, `menu-background${race || ''}.webp`)),
  wide('menu/campaign-victory.png', 'campaign-victory.webp'),
  wide('menu/campaign-defeat.png', 'campaign-defeat.webp'),
];

mkdirSync(OUT, { recursive: true });
for (const job of JOBS) {
  await sharp(path.join(SOURCE, job.from)).resize(job.resize).webp({ quality: job.quality, alphaQuality: 90, effort: 5 }).toFile(path.join(OUT, job.to));
  console.log(`${job.from} → ${job.to}`);
}
