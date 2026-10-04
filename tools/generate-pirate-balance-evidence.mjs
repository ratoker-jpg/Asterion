import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

function option(name, fallback) {
  const prefix = `--${name}=`;
  const raw = process.argv.find((argument) => argument.startsWith(prefix))?.slice(prefix.length);
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 1) throw new RangeError(`${name} must be a positive safe integer`);
  return value;
}

const runsPerMatchup = option('runs', 300);
const ownersForRaidEstimates = option('owners', 1_000);
const generatedAt = new Date().toISOString().slice(0, 10);
const sourcePath = resolve('src/domain/pirates/balance-simulation.ts');
const { runPirateBalanceSimulation, formatPirateBalanceEvidence } = await import(pathToFileURL(sourcePath).href);
const result = runPirateBalanceSimulation({ runsPerMatchup, ownersForRaidEstimates });

const techPopulationMismatchCount = (() => {
  const groups = new Map();
  for (const row of result.matchups) {
    const key = [row.scoreBand, row.faction, row.pirateShipId, row.formation, row.playerClasses.join('+')].join('|');
    const values = groups.get(key) ?? new Set();
    values.add(row.attackerActualPopulation);
    groups.set(key, values);
  }
  return [...groups.values()].filter((values) => values.size !== 1).length;
})();
const siegeSnapshotMismatchCount = result.siegeEstimates.filter((row) => row.defenderPopulation !== 0 && ![1_999, 2_000].includes(row.defenderPopulation)).length;
const evidence = formatPirateBalanceEvidence(result, generatedAt);
const evidencePath = resolve('docs/evidence/pirate-operations-v1-balance.md');
mkdirSync(dirname(evidencePath), { recursive: true });
writeFileSync(evidencePath, evidence, 'utf8');

process.stdout.write(`${JSON.stringify({
  evidencePath,
  generatedAt,
  runsPerMatchup,
  ownersForRaidEstimates,
  eliminationMatchups: result.matchups.length,
  siegeMatchups: result.siegeEstimates.length,
  raidHorizonRows: result.raidEstimates.length,
  tierConvergenceRows: result.profileTierEstimates.length,
  maxNinetyPercentRoundingError: Math.max(...result.budgetCheck.cases.map((row) => row.absoluteError)),
  techPopulationMismatchCount,
  siegeSnapshotMismatchCount,
  evidenceBytes: Buffer.byteLength(evidence, 'utf8'),
}, null, 2)}\n`);
