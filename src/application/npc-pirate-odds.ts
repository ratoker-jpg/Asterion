import { calculateCombatStackPreview } from '../domain/combat/resolver.ts';
import type { CombatFactionId } from '../domain/combat/factions.ts';
import type { ShipId } from '../domain/combat/ids.ts';
import type { CombatTechnologyLevels } from '../domain/combat/technologies.ts';
import { getFactionShipCatalog } from '../domain/combat/faction-catalog.ts';
import { PIRATE_BASE_SHIPS, PIRATE_CATALOG_BY_ID, type PirateShipId } from '../domain/pirates/catalog.ts';
import { pirateTechnologyLevels, type PirateProfile } from '../domain/pirates/profile.ts';
import type { PirateReconReport } from '../domain/pirates/recon-report.ts';

/**
 * What an NPC owner can know before it throws a fleet at a pirate base: the
 * ship mix and ship level from its own recon, its own fleet, and the public
 * rule that pirate technology follows the owner's resource points. The garrison
 * is rolled at 90-105% of the population sent, so the size of the raid does not
 * change the odds - the mix does. The odds are read the way a player reads them:
 * firepower times hull of both sides (calibrated on 107 real raid reports (worst-case garrison 105%):
 * ratio >= 1.0 won 17 of 17; the rest 28 of 90).
 */
export const NPC_PIRATE_GARRISON_COEFFICIENT = 1.05;
/** Own power over the believed garrison power that an owner needs before it sends a raid. */
export const NPC_PIRATE_MIN_POWER_RATIO = 1.0;

export type NpcPirateOdds = Readonly<{
  /** Own power divided by the believed garrison power. */
  ratio: number;
  ready: boolean;
  /** The same ratio for the whole free fleet, for the journal and calibration. */
  fullRatio: number;
  /** The ships the owner would send: the full set, or the efficient part when the full set does not pass. */
  ships: Readonly<Partial<Record<ShipId, number>>>;
  sentPopulation: number;
}>;

type Stats = Readonly<{ attack: number; life: number }>;

function power(stats: readonly Readonly<{ count: number; attack: number; life: number }>[]): number {
  let attack = 0;
  let life = 0;
  for (const stat of stats) {
    attack += stat.count * stat.attack;
    life += stat.count * stat.life;
  }
  return Math.sqrt(attack * life);
}

/** Believed garrison power per sent population unit, from the recon's ship shares and level. */
export function npcPirateGarrisonPowerPerPopulation(
  report: PirateReconReport,
  resourcePoints: number,
): number | null {
  const intel = report.intel;
  if (!intel || report.outcome === 'no-target' || !intel.ships.length) return null;
  const technologies = pirateTechnologyLevels(Math.max(0, resourcePoints), 'piercingAttack');
  const profile = { kind: 'pirate' as const, snapshot: { shipLevel: intel.shipLevel } as PirateProfile };
  const shareByName = new Map(intel.ships.map((ship) => [ship.name, ship.populationPercent]));
  const stacks: { entityId: PirateShipId; count: number; level: number }[] = [];
  for (const ship of PIRATE_BASE_SHIPS) {
    const percent = shareByName.get(ship.name);
    if (!percent) continue;
    // One population unit of garrison; counts stay fractional for the power estimate.
    stacks.push({ entityId: ship.id, count: percent / 100 / PIRATE_CATALOG_BY_ID[ship.id].population, level: intel.shipLevel });
  }
  if (!stacks.length) return null;
  const rows = stacks.flatMap((stack) => {
    const preview = calculateCombatStackPreview({ entityId: stack.entityId, count: 1, level: stack.level }, 'aegis', technologies,
      'production', stacks.map((item) => ({ entityId: item.entityId, count: 1, level: item.level })), null, profile);
    return preview ? [{ count: stack.count, attack: preview.attackPerUnit, life: preview.lifePerUnit }] : [];
  });
  return rows.length ? power(rows) : null;
}

/**
 * Judges a raid on a pirate base with the owner's real fleet. When the whole
 * free fleet does not pass, the ships that add little power for the population
 * they bring are left at home (the garrison grows with every population unit
 * sent), and the best part that passes goes alone.
 */
export function estimateNpcPirateOdds(input: Readonly<{
  raceId: CombatFactionId;
  free: Readonly<Partial<Record<ShipId, number>>>;
  shipLevels: Readonly<Partial<Record<ShipId, number>>>;
  technologies: CombatTechnologyLevels;
  report: PirateReconReport;
  /** The owner's own resource points: pirate technology follows them. */
  resourcePoints: number;
}>): NpcPirateOdds | null {
  const perPopulation = npcPirateGarrisonPowerPerPopulation(input.report, input.resourcePoints);
  if (perPopulation === null || perPopulation <= 0) return null;
  const catalog = getFactionShipCatalog(input.raceId);
  const types = Object.entries(input.free).flatMap(([id, raw]) => {
    const count = Number(raw);
    const entity = catalog.find((item) => item.id === id);
    if (!entity || entity.category !== 'Боевой корабль' || !Number.isSafeInteger(count) || count <= 0) return [];
    return [{ id: id as ShipId, count, population: entity.population }];
  });
  if (!types.length) return null;
  const all = types.map((type) => ({ entityId: type.id, count: type.count, level: input.shipLevels[type.id] ?? 0 }));
  const stats = new Map<ShipId, Stats>();
  for (const type of types) {
    const preview = calculateCombatStackPreview({ entityId: type.id, count: 1, level: input.shipLevels[type.id] ?? 0 }, input.raceId,
      input.technologies, 'production', all, null);
    if (preview) stats.set(type.id, { attack: preview.attackPerUnit, life: preview.lifePerUnit });
  }
  const evaluate = (chosen: typeof types) => {
    const rows = chosen.flatMap((type) => {
      const stat = stats.get(type.id);
      return stat ? [{ count: type.count, ...stat }] : [];
    });
    const population = chosen.reduce((sum, type) => sum + type.count * type.population, 0);
    const enemy = perPopulation * NPC_PIRATE_GARRISON_COEFFICIENT * population;
    return { ratio: enemy > 0 ? power(rows) / enemy : 0, population };
  };
  // Densest first: power each type brings per population unit it adds to the garrison.
  const ordered = [...types].sort((left, right) => {
    const density = (type: typeof types[number]) => {
      const stat = stats.get(type.id);
      return stat ? Math.sqrt(stat.attack * stat.life) / Math.max(1, type.population) : 0;
    };
    return density(right) - density(left) || (left.id < right.id ? -1 : 1);
  });
  let fullRatio = 0;
  let best: { chosen: typeof types; ratio: number; population: number } | null = null;
  for (let size = ordered.length; size >= 1; size -= 1) {
    const chosen = ordered.slice(0, size);
    const result = evaluate(chosen);
    if (size === ordered.length) fullRatio = result.ratio;
    if (!best || result.ratio > best.ratio + 1e-9) best = { chosen, ...result };
    // Prefer the largest set that passes: the reward grows with the share of the hangar sent.
    if (result.ratio >= NPC_PIRATE_MIN_POWER_RATIO) { best = { chosen, ...result }; break; }
  }
  if (!best) return null;
  return {
    ratio: best.ratio,
    fullRatio,
    ready: best.ratio >= NPC_PIRATE_MIN_POWER_RATIO,
    ships: Object.fromEntries(best.chosen.map((type) => [type.id, type.count])) as Partial<Record<ShipId, number>>,
    sentPopulation: best.population,
  };
}
