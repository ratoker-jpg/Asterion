import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { pirateCombatBalanceMarkdown, runPirateCombatBalanceSimulation } = await import('../src/domain/pirates/balance-simulation.ts');
const result = runPirateCombatBalanceSimulation();
const outputPath = resolve(root, 'docs/evidence/pirate-combat-balance.md');
await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, pirateCombatBalanceMarkdown(result), 'utf8');
console.log(`Wrote ${outputPath} with ${result.totalBattles} seeded battles across ${result.matchupCount} matchups.`);
