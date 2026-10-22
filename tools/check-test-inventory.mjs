// F-08 gate: every *.test.ts under src/ runs in exactly one npm test script,
// and every logical (non-UI) test script runs in CI. Exits 1 with the gaps.
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const root = process.cwd();
const scripts = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).scripts;
const ci = readFileSync(join(root, '.github/workflows/ci.yml'), 'utf8');

function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === 'node_modules' || entry.name === 'graphify-out' ? [] : walk(path);
    return entry.name.endsWith('.test.ts') ? [relative(root, path).split(sep).join('/')] : [];
  });
}

/** `dir/*.test.ts` style patterns, the only wildcard the scripts use. */
function matches(pattern, file) {
  const source = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*');
  return new RegExp(`^${source}$`).test(file);
}

const files = walk(join(root, 'src')).sort();
const logical = Object.entries(scripts).filter(([name, command]) => name.startsWith('test:') && !name.endsWith('-ui') && name !== 'test:inventory' && command.includes('--test'));
const owners = new Map(files.map((file) => [file, []]));
for (const [name, command] of logical) {
  const patterns = command.split('--test')[1].trim().split(/\s+/).filter((token) => token.endsWith('.ts'));
  for (const pattern of patterns) {
    const hit = files.filter((file) => matches(pattern, file));
    if (!hit.length) {
      console.error(`[test-inventory] ${name}: "${pattern}" matches no test file`);
      process.exitCode = 1;
    }
    for (const file of hit) owners.get(file).push(name);
  }
}

const missing = [...owners].filter(([, names]) => names.length === 0).map(([file]) => file);
const doubled = [...owners].filter(([, names]) => names.length > 1);
const notInCi = logical.map(([name]) => name).filter((name) => !new RegExp(`npm run ${name.replace(':', '\\:')}(\\s|$)`, 'm').test(ci));
for (const file of missing) console.error(`[test-inventory] not run by any npm test script: ${file}`);
for (const [file, names] of doubled) console.error(`[test-inventory] run more than once (${names.join(', ')}): ${file}`);
for (const name of notInCi) console.error(`[test-inventory] npm script not run in CI: ${name}`);
if (missing.length || doubled.length || notInCi.length) process.exitCode = 1;
console.log(`[test-inventory] ${files.length} test files, ${logical.length} logical scripts, ${missing.length} missing, ${doubled.length} doubled, ${notInCi.length} scripts outside CI`);
