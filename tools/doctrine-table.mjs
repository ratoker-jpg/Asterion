// Doctrine table (NPC intelligence, stage H). Offline: for typical compositions
// of each race the combat engine (`resolveCombat`, the very resolver battles
// use) gives the outcome and the exchange of losses (src/domain/npc/doctrine-table-build.ts).
// The result is a versioned data file the NPC read in the game as a ready
// table. The engine is never called from the live world (ADR §10).
//
//   node --experimental-strip-types --experimental-loader ./src/domain/combat/test-asset-loader.mjs \
//     tools/doctrine-table.mjs [--out=src/domain/npc/doctrine-table.v1.json] [--check]
//
// `--check` regenerates in memory and fails when the file on disk differs
// (the combat engine or the catalog moved without the table being redone).
import fs from 'node:fs';
import { buildDoctrineTable } from '../src/domain/npc/doctrine-table-build.ts';

const option = (name, fallback) => process.argv.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const file = option('out', 'src/domain/npc/doctrine-table.v1.json');
const rendered = `${JSON.stringify(buildDoctrineTable(), null, 2)}\n`;

if (process.argv.includes('--check')) {
  if (fs.readFileSync(file, 'utf8').replaceAll('\r\n', '\n') !== rendered) { console.error(`${file} is out of date: run tools/doctrine-table.mjs`); process.exit(1); }
  console.log(`${file} is up to date`);
} else {
  fs.writeFileSync(file, rendered);
  console.log(`wrote ${file}`);
}
