// Packs the QA output a CI job produced into a small artifact folder:
// every NEW screenshot becomes a JPEG (same relative path, .jpg), small text
// reports are copied as they are. "New" = modified after the marker file, so
// frames committed to the repository are never re-uploaded.
//   node tools/ci-frames.mjs <markerFile> <outDir> <dir> [<dir> ...]
import { cpSync, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { dirname, extname, join } from 'node:path';
import sharp from 'sharp';

const [marker, outDir, ...dirs] = process.argv.slice(2);
if (!marker || !outDir || dirs.length === 0) {
  console.error('usage: ci-frames.mjs <markerFile> <outDir> <dir>...');
  process.exit(2);
}
const since = statSync(marker).mtimeMs;
const TEXT = new Set(['.json', '.txt', '.md', '.log', '.csv']);
const MAX_TEXT_BYTES = 2 * 1024 * 1024;

function* walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else yield full;
  }
}

let frames = 0;
let copied = 0;
let bytes = 0;
for (const dir of dirs) {
  if (!existsSync(dir)) continue;
  for (const file of walk(dir)) {
    const stat = statSync(file);
    if (stat.mtimeMs <= since) continue;
    const ext = extname(file).toLowerCase();
    const rel = file.split('\\').join('/');
    if (ext === '.png') {
      const target = join(outDir, rel.replace(/\.png$/i, '.jpg'));
      mkdirSync(dirname(target), { recursive: true });
      try {
        const info = await sharp(file).flatten({ background: '#05070c' }).jpeg({ quality: 82, mozjpeg: true }).toFile(target);
        bytes += info.size;
        frames += 1;
      } catch (error) {
        console.warn(`skip ${rel}: ${error.message}`);
      }
    } else if (TEXT.has(ext) && stat.size <= MAX_TEXT_BYTES) {
      const target = join(outDir, rel);
      mkdirSync(dirname(target), { recursive: true });
      cpSync(file, target);
      bytes += stat.size;
      copied += 1;
    }
  }
}
console.log(`qa-frames: ${frames} JPEG, ${copied} reports, ${(bytes / 1048576).toFixed(1)} MB`);
