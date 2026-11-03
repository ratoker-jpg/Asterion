import { getFactionDefenseCatalog, getFactionShipCatalog } from '../combat/faction-catalog.ts';
import { createDefaultCombatPriority } from '../combat/priority.ts';
import { resolveCombat } from '../combat/resolver.ts';
import { COMBAT_ENGINE_VERSION } from '../combat/report.ts';
import type { CombatFactionId } from '../combat/factions.ts';

/**
 * Doctrine table builder (stage H). Offline only: tools/doctrine-table.mjs
 * writes the result as doctrine-table.v1.json and the game reads that file.
 * The combat resolver is never called from the live world (ADR §10).
 */
const RACES: readonly CombatFactionId[] = ['aegis', 'synod', 'veyra'];
/** Attacker's budget as a multiple of the defence's cost: a contested fight and a clear overmatch. */
const BUDGETS = [1, 2];
/** Defence population of one test fight: well inside the 35 000 cap of the engine, large enough for the square law to show. */
const DEFENCE_POPULATION = 4_000;
const MAX_ROUNDS = 8;
const priority = createDefaultCombatPriority();
const worth = (cost?: Readonly<{ metal?: number; minerals?: number; gas?: number }>) => (cost?.metal ?? 0) + (cost?.minerals ?? 0) + (cost?.gas ?? 0);
const round = (value: number, digits = 3) => +value.toFixed(digits);

function lostValue(snapshot: { stacks?: ReadonlyArray<any>; defenses?: ReadonlyArray<any> }, catalog: ReadonlyArray<{ id: string; cost?: any }>) {
  const cost = new Map(catalog.map((entity) => [entity.id, worth(entity.cost)]));
  return [...(snapshot.stacks ?? []), ...(snapshot.defenses ?? [])]
    .reduce((total, stack) => total + Math.max(0, (stack.countBefore ?? 0) - (stack.countAfter ?? 0)) * (cost.get(stack.entityId) ?? 0), 0);
}

function fight(race: CombatFactionId, ships: any[], defenses: any[], label: string) {
  const report = resolveCombat({
    scenarioId: `doctrine-table:${label}`, timestamp: '2026-01-01T00:00:00.000Z',
    attacker: { participant: { playerId: 'a', playerName: 'A', side: 'attacker' }, factionId: race, ships, commanders: [] },
    defender: { participant: { playerId: 'd', playerName: 'D', side: 'defender' }, factionId: race, ships: [], commanders: [], defenses },
    maxRounds: MAX_ROUNDS, attackerPriority: [...priority.attack], defenderPriority: [...priority.defense],
    technologyMode: 'independent', executionMode: 'production', seed: `doctrine-table:v1:${label}`, profileId: 'asterion-attack-v1',
  }, { reportId: `doctrine-table-${label}`, missionType: 'attack' });
  const attackerLost = lostValue(report.attackerForce, getFactionShipCatalog(race));
  const defenderLost = lostValue(report.defenderForce, getFactionDefenseCatalog(race));
  return { winner: report.winner, attackerLost, defenderLost };
}

/** Attacker wins 1, draws .5. */
const score = (winner: string) => (winner === 'attacker' ? 1 : winner === 'defender' ? 0 : 0.5);
const geometricMean = (values: number[]) => Math.exp(values.reduce((total, value) => total + Math.log(Math.max(1e-6, value)), 0) / Math.max(1, values.length));

export function buildDoctrineTable() {
  const races: Record<string, unknown> = {};
  for (const race of RACES) {
    const warships = getFactionShipCatalog(race).filter((entity) => entity.category === 'Боевой корабль' && entity.combat);
    const turrets = getFactionDefenseCatalog(race).filter((entity) => entity.id !== 'tower-shield' && entity.id !== 'planetary-shield' && entity.combat && entity.population > 0);
    // Defence rows: a mass of one turret type against each warship mass of equal budget.
    const defence = turrets.map((turret) => {
      const count = Math.max(1, Math.floor(DEFENCE_POPULATION / turret.population));
      const budget = count * worth(turret.cost);
      const trials: Array<{ factor: number; ship: string; held: number; exchange: number }> = [];
      for (const factor of BUDGETS) {
        for (const ship of warships) {
          const shipCount = Math.max(1, Math.floor(factor * budget / Math.max(1, worth(ship.cost))));
          const result = fight(race, [{ entityId: ship.id, count: shipCount }], [{ entityId: turret.id, count }], `${race}:${turret.id}:${ship.id}:${factor}`);
          trials.push({ factor, ship: ship.id, held: score(result.winner) === 0 ? 1 : score(result.winner) === 0.5 ? 0.5 : 0,
            // What the attacker loses for one unit of defence lost.
            exchange: result.attackerLost / Math.max(1, result.defenderLost) });
        }
      }
      return { id: turret.id, population: turret.population, cost: worth(turret.cost), count,
        held: round(trials.reduce((total, trial) => total + trial.held, 0) / trials.length),
        exchange: round(geometricMean(trials.map((trial) => trial.exchange))) };
    }).sort((left, right) => right.held - left.held || right.exchange - left.exchange || (left.id < right.id ? -1 : 1));
    // Ship rows: a mass of one warship type against the race's turret masses of equal budget.
    const ships = warships.map((ship) => {
      const trials: Array<{ won: number; exchange: number }> = [];
      for (const factor of BUDGETS) {
        for (const turret of turrets) {
          const turretCount = Math.max(1, Math.floor(DEFENCE_POPULATION / turret.population));
          const shipCount = Math.max(1, Math.floor(factor * turretCount * worth(turret.cost) / Math.max(1, worth(ship.cost))));
          const result = fight(race, [{ entityId: ship.id, count: shipCount }], [{ entityId: turret.id, count: turretCount }], `${race}:${ship.id}:${turret.id}:${factor}`);
          trials.push({ won: score(result.winner), exchange: result.defenderLost / Math.max(1, result.attackerLost) });
        }
      }
      return { id: ship.id, cost: worth(ship.cost), won: round(trials.reduce((total, trial) => total + trial.won, 0) / trials.length),
        exchange: round(geometricMean(trials.map((trial) => trial.exchange))) };
    }).sort((left, right) => right.won - left.won || right.exchange - left.exchange || (left.id < right.id ? -1 : 1));
    races[race] = { defence, ships };
  }
  return { version: 1, engine: COMBAT_ENGINE_VERSION,
    method: { defencePopulation: DEFENCE_POPULATION, budgets: BUDGETS, maxRounds: MAX_ROUNDS, technologies: 'none', note: 'equal-budget mass fights, one unit type against one unit type' },
    races };
}

