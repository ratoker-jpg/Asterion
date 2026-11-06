/**
 * What a bot puts into a population-capped raid (the Sun): the force that is
 * strongest for the room it has, not a proportional slice of everything it owns.
 *
 * A Sun side is capped in population (75 000 per participant, 225 000 a side),
 * so population is the scarce thing. Each step adds the batch of hulls whose
 * Lanchester strength (the game's own square-law estimate, `estimateForcePower`)
 * grows most per population, so the heavy assault hulls of a race go first, a
 * hull that is all gun gets life beside it, and the weakest hulls (scouts) go
 * only into room the stronger ones cannot fill. Pure and deterministic: no
 * randomness, ties go to the smaller key.
 */

export type RaidHull = Readonly<{
  /** Unique within one call (a planet + a ship id, for a pool over several planets). */
  key: string;
  population: number;
  attack: number;
  life: number;
  /** Hulls at hand. */
  count: number;
}>;

/** Share of the room one step may add: keeps the greedy fine-grained and the loop short. */
const STEP_SHARE = 0.04;

const finite = (value: number): number => (Number.isFinite(value) ? value : 0);

/** Lanchester strength of a force (square root of total attack times total life). */
export function raidForcePower(hulls: readonly RaidHull[], counts: ReadonlyMap<string, number>): number {
  let attack = 0;
  let life = 0;
  for (const hull of hulls) {
    const count = counts.get(hull.key) ?? 0;
    attack += count * hull.attack;
    life += count * hull.life;
  }
  return Math.sqrt(Math.max(0, attack) * Math.max(0, life));
}

/** Hull key → count of the strongest force that fits `room` population. */
export function composeRaidForce(hulls: readonly RaidHull[], room: number): Map<string, number> {
  const usable = hulls.filter((hull) => hull.count > 0 && hull.population > 0 && hull.attack > 0 && hull.life > 0)
    .map((hull) => ({ ...hull, count: Math.floor(hull.count), population: finite(hull.population) }))
    .sort((left, right) => (left.key < right.key ? -1 : left.key > right.key ? 1 : 0));
  const chosen = new Map<string, number>();
  const total = usable.reduce((sum, hull) => sum + hull.count * hull.population, 0);
  if (!(room > 0)) return chosen;
  if (total <= room) {
    for (const hull of usable) chosen.set(hull.key, hull.count);
    return chosen;
  }
  const stock = new Map(usable.map((hull) => [hull.key, hull.count]));
  let attack = 0;
  let life = 0;
  let left = Math.floor(room);
  const step = Math.max(1, left * STEP_SHARE);
  for (;;) {
    let best: { hull: (typeof usable)[number]; units: number; score: number } | null = null;
    for (const hull of usable) {
      const have = stock.get(hull.key) ?? 0;
      const fit = Math.floor(left / hull.population);
      if (have <= 0 || fit <= 0) continue;
      const units = Math.min(have, fit, Math.max(1, Math.ceil(step / hull.population)));
      const gain = Math.sqrt((attack + units * hull.attack) * (life + units * hull.life)) - Math.sqrt(attack * life);
      const score = gain / (units * hull.population);
      if (!best || score > best.score * (1 + 1e-9)) best = { hull, units, score };
    }
    if (!best) break;
    stock.set(best.hull.key, (stock.get(best.hull.key) ?? 0) - best.units);
    chosen.set(best.hull.key, (chosen.get(best.hull.key) ?? 0) + best.units);
    attack += best.units * best.hull.attack;
    life += best.units * best.hull.life;
    left -= best.units * best.hull.population;
  }
  return chosen;
}

/** Strength per population of a composed force: the quality a member can bring (0 for nothing). */
export function raidForceQuality(hulls: readonly RaidHull[], counts: ReadonlyMap<string, number>): number {
  let population = 0;
  for (const hull of hulls) population += (counts.get(hull.key) ?? 0) * hull.population;
  return population > 0 ? raidForcePower(hulls, counts) / population : 0;
}
