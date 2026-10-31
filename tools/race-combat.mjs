// Race balance, the fight (owner question 31.10.2026): fleets of equal cost
// (or equal population) of every race against each other, in typical
// compositions, and against a typical defence, through the game's own combat
// resolver. Prints win shares and the population each side lost.
//
//   node --experimental-strip-types --experimental-loader ./src/domain/combat/test-asset-loader.mjs \
//     tools/race-combat.mjs [--budget=20000000] [--trials=6]
import { getFactionDefenseCatalog, getFactionShipCatalog } from '../src/domain/combat/faction-catalog.ts';
import { createDefaultCombatPriority } from '../src/domain/combat/priority.ts';
import { resolveCombat } from '../src/domain/combat/resolver.ts';

const RACES = ['aegis', 'synod', 'veyra'];
const NAMES = { aegis: 'Астеры', synod: 'Илары', veyra: 'Рой' };
const option = (name, fallback) => process.argv.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const budget = Number(option('budget', '20000000'));
const trials = Number(option('trials', '6'));
const costOf = (entity) => (entity.cost?.metal ?? 0) + (entity.cost?.minerals ?? 0) + (entity.cost?.gas ?? 0);

/** Shares of the budget by ship id; «bots» is what NPC fleets of the lab hold most (cruisers first). */
export const COMPOSITIONS = {
  light: { scout: 0.4, cruiser: 0.6 },
  medium: { cruiser: 0.4, defender: 0.3, battleship: 0.3 },
  heavy: { battleship: 0.4, destroyer: 0.35, bomber: 0.25 },
  bots: { cruiser: 0.45, defender: 0.2, battleship: 0.25, destroyer: 0.1 },
};

/** Stacks of `race` worth `amount` (resources) or holding `amount` population, by composition shares. */
function fleet(race, composition, amount, by = 'cost') {
  const catalog = getFactionShipCatalog(race);
  return Object.entries(COMPOSITIONS[composition]).map(([id, share]) => {
    const entity = catalog.find((item) => item.id === id);
    const unit = by === 'cost' ? costOf(entity) : entity.population;
    return { entityId: id, count: Math.max(1, Math.floor(amount * share / unit)) };
  });
}

/** A typical defence of `race` worth `amount`: the main batteries in equal shares. */
function defence(race, amount) {
  // Batteries only: the tower and planetary shields are single pieces.
  const catalog = getFactionDefenseCatalog(race).filter((entity) => entity.combat && costOf(entity) > 0 && !['tower-shield', 'planetary-shield'].includes(entity.id)).sort((a, b) => costOf(b) - costOf(a)).slice(0, 4);
  return catalog.map((entity) => ({ entityId: entity.id, count: Math.max(1, Math.floor(amount / catalog.length / costOf(entity))) }));
}

function fight(attackerRace, attackerShips, defenderRace, defenderShips, defenses, seed) {
  const priority = createDefaultCombatPriority();
  const report = resolveCombat({
    scenarioId: seed, timestamp: '2026-10-31T00:00:00.000Z', seed, maxRounds: 12,
    attackerPriority: priority.attack, defenderPriority: priority.defense, executionMode: 'production',
    attacker: { participant: { playerId: 'a', playerName: 'A', side: 'attacker', race: NAMES[attackerRace] }, factionId: attackerRace, ships: attackerShips },
    defender: { participant: { playerId: 'd', playerName: 'D', side: 'defender', race: NAMES[defenderRace] }, factionId: defenderRace, ships: defenderShips, defenses },
  }, { reportId: seed, allowPopulationOverflow: true });
  const lost = (force) => 1 - force.populationAfter / Math.max(1, force.populationBefore);
  return { winner: report.winner, attackerLost: lost(report.attackerForce), defenderLost: lost(report.defenderForce) };
}

function series(label, attackerRace, attackerShips, defenderRace, defenderShips, defenses = []) {
  const outcomes = Array.from({ length: trials }, (_, trial) => fight(attackerRace, attackerShips, defenderRace, defenderShips, defenses, `${label}:${trial}`));
  const share = (side) => outcomes.filter((item) => item.winner === side).length / outcomes.length;
  const mean = (key) => outcomes.reduce((sum, item) => sum + item[key], 0) / outcomes.length;
  return { attackerWins: +share('attacker').toFixed(2), defenderWins: +share('defender').toFixed(2), draws: +share('draw').toFixed(2),
    attackerLost: +mean('attackerLost').toFixed(3), defenderLost: +mean('defenderLost').toFixed(3) };
}

const results = { budget, trials, fleets: [], vsDefence: [] };
for (const by of ['cost', 'population']) {
  const amount = by === 'cost' ? budget : Math.round(budget / 2_600);
  for (const composition of Object.keys(COMPOSITIONS)) {
    for (const a of RACES) for (const d of RACES) {
      if (a === d) continue;
      const row = series(`${by}:${composition}:${a}:${d}`, a, fleet(a, composition, amount, by), d, fleet(d, composition, amount, by));
      results.fleets.push({ by, composition, attacker: NAMES[a], defender: NAMES[d], ...row });
    }
  }
}
// Every race's equal-cost fleets against one and the same defence (Астеры, half the budget).
for (const composition of Object.keys(COMPOSITIONS)) for (const a of RACES) {
  results.vsDefence.push({ composition, attacker: NAMES[a], ...series(`def:${composition}:${a}`, a, fleet(a, composition, budget), 'aegis', [], defence('aegis', budget / 2)) });
}
console.log(JSON.stringify(results, null, 2));
