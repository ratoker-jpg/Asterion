import { PIRATE_BASE_SHIPS, type PirateBaseShipId } from './catalog.ts';
import type { PirateProfile } from './profile.ts';
import { pirateSeededDraw } from './threat.ts';
import { calculateEffectiveDamage, getCombatMatchupMultiplier, type CombatMatchupClass } from '../combat/resolver.ts';

export type RaidDefenseComposition = readonly Readonly<{ kind?: 'ship' | 'defense'; ordinaryClass?: CombatMatchupClass; population: number; armorStrength?: number }>[];
export type PirateRaidFleetPlan = Readonly<{
  ships: Readonly<Partial<Record<PirateBaseShipId, number>>>;
  population: number;
  targetPopulation: number;
  requestedCargo: number;
  availableCargo: number;
  counterFleet: boolean;
  coefficient: number;
}>;

const safe = (value: number) => Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;

/**
 * Allocate by population, seeded and bounded by the same 90-95% force limit.
 * The cargo floor only applies if the original mix cannot carry the target
 * loot; it is capped to 95% of the owner's historical hangar.
 */
export function planPirateRaidFleet(input: Readonly<{
  seed: string;
  defendingPopulation: number;
  possibleLoot: number;
  historicalHangarCapacity: number;
  profile: PirateProfile;
  counterFleet: boolean;
  defense: RaidDefenseComposition;
}>): PirateRaidFleetPlan {
  const coefficient = 0.90 + 0.05 * pirateSeededDraw(`${input.seed}:force`);
  const normalTarget = Math.floor(safe(input.defendingPopulation) * coefficient);
  const cap = Math.floor(safe(input.historicalHangarCapacity) * 0.95);
  const allowed = PIRATE_BASE_SHIPS.filter((ship) => (input.profile.shares[ship.id] ?? 0) > 0);
  const candidates = allowed.length > 0 ? allowed : [PIRATE_BASE_SHIPS[0]!];
  const cargoOptimal = candidates.filter((ship) => ship.cargo > 0)
    .sort((a, b) => b.cargo / b.population - a.cargo / a.population
      || a.id.localeCompare(b.id))[0];
  const requestedCargo = safe(input.possibleLoot);
  const normalCargoRatio = candidates.reduce((total, ship) =>
    total + (input.profile.shares[ship.id] ?? 0) / 100 * ship.cargo / ship.population, 0);
  const expectedCargo = normalTarget * normalCargoRatio;
  // Only near-empty targets get the cargo floor. Protected colonies keep
  // their mandatory 90-95% defender-relative population budget.
  const nearEmpty = safe(input.defendingPopulation) <
    Math.max(100, Math.floor(safe(input.historicalHangarCapacity) * 0.05));
  const minimum = nearEmpty && cargoOptimal && requestedCargo > expectedCargo
    ? Math.min(cap, Math.ceil(requestedCargo / cargoOptimal.cargo) * cargoOptimal.population)
    : 0;
  const targetPopulation = Math.max(normalTarget, minimum);
  const counts: Partial<Record<PirateBaseShipId, number>> = {};
  let remaining = targetPopulation;
  let availableCargo = 0;

  const defenseTotal = input.defense.reduce((s, entry) => s + safe(entry.population), 0);
  // Score one attacker population slot by its real production damage against
  // the actual ship AND defense population. Turrets have NO 6x6 matchup class
  // in the resolver (neutral x1); their actual armor is still respected.
  // No invented tower -> ordinary-ship class mapping or new combat coefficient.
  const matchup = (ship: (typeof PIRATE_BASE_SHIPS)[number]) => defenseTotal > 0
    ? input.defense.reduce((score, entry) => {
        const multiplier = entry.kind === 'defense' || !entry.ordinaryClass
          ? 1
          : getCombatMatchupMultiplier(
              ship.ordinaryClass as CombatMatchupClass, entry.ordinaryClass,
            );
        const effectiveDamage = calculateEffectiveDamage(
          Math.floor(ship.combat.attack * multiplier),
          Number.isFinite(entry.armorStrength) ? Math.max(0, entry.armorStrength ?? 0) : 0,
        );
        return score + safe(entry.population) * effectiveDamage / ship.population;
      }, 0) / defenseTotal
    : ship.combat.attack / ship.population;
  // Counter fleets use actual per-population output against the production
  // 6x6 ship matrix AND actual defense armor. Normal raids keep tier shares.
  const sorted = [...candidates].sort((a, b) => input.counterFleet
    ? matchup(b) - matchup(a) || b.combat.attack / b.population - a.combat.attack / a.population
      || a.id.localeCompare(b.id)
    : (input.profile.shares[b.id] ?? 0) - (input.profile.shares[a.id] ?? 0)
      || a.id.localeCompare(b.id));

  const add = (ship: (typeof PIRATE_BASE_SHIPS)[number], amount: number) => {
    const n = Math.min(Math.floor(remaining / ship.population), safe(amount));
    if (n <= 0) return;
    counts[ship.id as PirateBaseShipId] = (counts[ship.id as PirateBaseShipId] ?? 0) + n;
    remaining -= n * ship.population;
    availableCargo += n * ship.cargo;
  };
  if (!input.counterFleet) {
    for (const ship of sorted) add(ship, Math.floor(targetPopulation * (input.profile.shares[ship.id] ?? 0) / 100 / ship.population));
  }
  // For a rich but undefended target, reserve cargo-capable hulls before
  // allocating combat ships, without inventing unlimited attack population.
  if (cargoOptimal && availableCargo < requestedCargo && normalTarget < minimum) {
    add(cargoOptimal, Math.ceil((requestedCargo - availableCargo) / cargoOptimal.cargo));
  }
  for (const ship of sorted) add(ship, input.counterFleet ? Number.MAX_SAFE_INTEGER
    : Math.ceil(targetPopulation * (input.profile.shares[ship.id] ?? 0) / 100 / ship.population));
  for (const ship of [...sorted].sort((a,b)=>a.population-b.population||a.id.localeCompare(b.id))) {
    add(ship, Number.MAX_SAFE_INTEGER);
  }
  return Object.freeze({
    ships: Object.freeze(counts),
    population: targetPopulation - remaining,
    targetPopulation,
    requestedCargo,
    availableCargo,
    counterFleet: input.counterFleet,
    coefficient,
  });
}
