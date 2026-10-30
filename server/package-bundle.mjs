// Packs dist-server into release/asterion-server-<version>.tgz with a
// package.json naming the version (read by server/deploy/update.sh).
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const version = process.env.ASTERION_VERSION || JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;
const dist = path.join(root, 'dist-server');
for (const file of ['server.mjs', 'runner.mjs']) if (!fs.existsSync(path.join(dist, file))) throw new Error(`dist-server/${file} is missing: run npm run build:server`);
fs.writeFileSync(path.join(dist, 'package.json'), `${JSON.stringify({ name: 'asterion-server', version, type: 'module', private: true }, null, 2)}\n`);
fs.mkdirSync(path.join(root, 'release'), { recursive: true });
const out = path.join('release', `asterion-server-${version}.tgz`);
execFileSync('tar', ['-czf', out, '-C', 'dist-server', '.'], { cwd: root, stdio: 'inherit' });
console.log(`${out} (${Math.round(fs.statSync(path.join(root, out)).size / 1024)} KiB)`);
