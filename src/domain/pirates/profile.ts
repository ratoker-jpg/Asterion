import { PIRATE_BASE_SHIPS, PIRATE_CATALOG_BY_ID, type PirateBaseShipId, type PirateShipId } from './catalog.ts';
import { COMBAT_TECHNOLOGY_IDS, type CombatTechnologyId } from '../combat/technologies.ts';

export type PirateTierShares = Readonly<Record<1 | 2 | 3, number>>;
export type PirateShipShares = Readonly<Partial<Record<PirateShipId, number>>>;
export const PIRATE_EXCLUSIVE_TECHNOLOGIES = ['piercingAttack', 'maneuverDefense', 'criticalHit'] as const;
export type PirateExclusiveTechnologyId = (typeof PIRATE_EXCLUSIVE_TECHNOLOGIES)[number];
export type PirateOwnerScoreSnapshot = Readonly<{
  resourcePoints: number;
  battlePoints: number;
  totalPoints: number;
}>;

export type PiratePopulationBudget = Readonly<{
  targetPopulation: number;
  actualPopulation: number;
  absoluteError: number;
  ships: Readonly<Partial<Record<PirateShipId, number>>>;
}>;

export type PirateProfile = Readonly<{
  profileVersion: 1;
  ownerId: string;
  contactCycleKey: string;
  seed: string;
  score: PirateOwnerScoreSnapshot;
  shipLevel: number;
  technologyLevel: number;
  exclusiveTechnologyId: PirateExclusiveTechnologyId;
  technologies: Readonly<Record<CombatTechnologyId, number>>;
  expectedTierShares: PirateTierShares;
  /** Tier distribution actually sampled across twenty 5%-population slices. */
  sampledTierShares: PirateTierShares;
  /** Compatibility summary only: the tier with the largest sampled population share. */
  tier: 1 | 2 | 3;
  shares: PirateShipShares;
}>;

const PIRATE_PROFILE_POPULATION_SLICES = 20;

export const PIRATE_TIER_SHARE_ANCHORS: readonly Readonly<{ totalPoints: number; shares: PirateTierShares }>[] = Object.freeze([
  Object.freeze({ totalPoints: 1_000, shares: Object.freeze({ 1: 100, 2: 0, 3: 0 }) }),
  Object.freeze({ totalPoints: 10_000, shares: Object.freeze({ 1: 85, 2: 15, 3: 0 }) }),
  Object.freeze({ totalPoints: 100_000, shares: Object.freeze({ 1: 70, 2: 25, 3: 5 }) }),
  Object.freeze({ totalPoints: 1_000_000, shares: Object.freeze({ 1: 15, 2: 25, 3: 60 }) }),
  Object.freeze({ totalPoints: 10_000_000, shares: Object.freeze({ 1: 5, 2: 15, 3: 80 }) }),
]);

export const PIRATE_RESOURCE_LEVEL_THRESHOLDS = Object.freeze([
  0, 5_000, 10_000, 25_000, 50_000, 100_000, 200_000, 400_000, 800_000, 1_500_000, 3_000_000,
] as const);

export const PIRATE_TECH_LEVEL_THRESHOLDS = Object.freeze([
  0, 10_000, 25_000, 50_000, 100_000, 200_000, 400_000, 800_000, 1_500_000, 3_000_000, 6_000_000,
] as const);

function safePoints(value: number) {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

export function pirateLevelForResourcePoints(resourcePoints: number) {
  const points = safePoints(resourcePoints);
  return PIRATE_RESOURCE_LEVEL_THRESHOLDS.reduce<number>((level, threshold, index) => points >= threshold ? index : level, 0);
}

export function pirateTechnologyLevelForResourcePoints(resourcePoints: number) {
  const points = safePoints(resourcePoints);
  return PIRATE_TECH_LEVEL_THRESHOLDS.reduce<number>((level, threshold, index) => points >= threshold ? index : level, 0);
}

export function pirateTechnologyLevels(
  resourcePoints: number,
  exclusiveTechnologyId: PirateExclusiveTechnologyId,
): Readonly<Record<CombatTechnologyId, number>> {
  const level = pirateTechnologyLevelForResourcePoints(resourcePoints);
  return Object.freeze(Object.fromEntries(COMBAT_TECHNOLOGY_IDS.map((id) => [
    id,
    PIRATE_EXCLUSIVE_TECHNOLOGIES.includes(id as PirateExclusiveTechnologyId)
      ? id === exclusiveTechnologyId ? level : 0
      : level,
  ])) as Record<CombatTechnologyId, number>);
}

/** Log10 interpolation; values below/above the control points clamp to endpoint distributions. */
export function expectedPirateTierShares(totalPoints: number): PirateTierShares {
  const points = safePoints(totalPoints);
  const anchors = PIRATE_TIER_SHARE_ANCHORS;
  if (points <= anchors[0]!.totalPoints) return anchors[0]!.shares;
  const last = anchors[anchors.length - 1]!;
  if (points >= last.totalPoints) return last.shares;
  for (let index = 0; index < anchors.length - 1; index += 1) {
    const left = anchors[index]!;
    const right = anchors[index + 1]!;
    if (points > right.totalPoints) continue;
    const t = (Math.log10(points) - Math.log10(left.totalPoints))
      / (Math.log10(right.totalPoints) - Math.log10(left.totalPoints));
    return Object.freeze({
      1: left.shares[1] + (right.shares[1] - left.shares[1]) * t,
      2: left.shares[2] + (right.shares[2] - left.shares[2]) * t,
      3: left.shares[3] + (right.shares[3] - left.shares[3]) * t,
    });
  }
  return last.shares;
}

function hashSeed(seed: string) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function seededRandom(seed: string) {
  let state = hashSeed(seed);
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 0x1_0000_0000;
  };
}

function sampleTier(shares: PirateTierShares, random: () => number): 1 | 2 | 3 {
  const draw = random() * 100;
  if (draw < shares[1]) return 1;
  if (draw < shares[1] + shares[2]) return 2;
  return 3;
}

function classesInTier(tier: 1 | 2 | 3) {
  return PIRATE_BASE_SHIPS.filter((ship) => ship.tier === tier);
}

/** Sample a 100%-population mix in twenty deterministic 5% slices. */
export function createPirateProfile(input: {
  ownerId: string;
  contactCycleKey: string;
  score: PirateOwnerScoreSnapshot;
}): PirateProfile {
  const seed = JSON.stringify([input.ownerId, input.contactCycleKey]);
  const random = seededRandom(seed);
  const technologyRandom = seededRandom(`${seed}|exclusive-technology`);
  const exclusiveTechnologyId = PIRATE_EXCLUSIVE_TECHNOLOGIES[
    Math.floor(technologyRandom() * PIRATE_EXCLUSIVE_TECHNOLOGIES.length)
  ]!;
  const resourcePoints = safePoints(input.score.resourcePoints);
  const battlePoints = safePoints(input.score.battlePoints);
  const canonicalTotalPoints = resourcePoints > Number.MAX_VALUE - battlePoints
    ? Number.MAX_VALUE
    : resourcePoints + battlePoints;
  if (safePoints(input.score.totalPoints) !== canonicalTotalPoints) {
    throw new Error(`Pirate owner totalPoints must equal resourcePoints + battlePoints (${canonicalTotalPoints}).`);
  }
  const score = Object.freeze({
    resourcePoints,
    battlePoints,
    // Achievements are excluded; the validated total is exactly the sum of
    // the supplied resource and battle point components.
    totalPoints: canonicalTotalPoints,
  });
  const expectedTierShares = expectedPirateTierShares(score.totalPoints);
  const sampledTierShares = { 1: 0, 2: 0, 3: 0 };
  const mutableShares = Object.fromEntries(PIRATE_BASE_SHIPS.map((ship) => [ship.id, 0])) as Record<PirateBaseShipId, number>;
  for (let slice = 0; slice < PIRATE_PROFILE_POPULATION_SLICES; slice += 1) {
    const tier = sampleTier(expectedTierShares, random);
    sampledTierShares[tier] += 5;
    const tierShips = classesInTier(tier);
    const selected = tierShips[Math.floor(random() * tierShips.length)]!;
    mutableShares[selected.id as PirateBaseShipId] += 5;
  }
  const normalizedSampledTierShares = Object.freeze(sampledTierShares) as PirateTierShares;
  const tier = ([1, 2, 3] as const).reduce((selected, candidate) =>
    normalizedSampledTierShares[candidate] > normalizedSampledTierShares[selected] ? candidate : selected, 1);
  const shares = Object.freeze(mutableShares) as PirateShipShares;
  return Object.freeze({
    profileVersion: 1 as const,
    ownerId: input.ownerId,
    contactCycleKey: input.contactCycleKey,
    seed,
    score,
    shipLevel: pirateLevelForResourcePoints(score.resourcePoints),
    technologyLevel: pirateTechnologyLevelForResourcePoints(score.resourcePoints),
    exclusiveTechnologyId,
    technologies: pirateTechnologyLevels(score.resourcePoints, exclusiveTechnologyId),
    expectedTierShares,
    sampledTierShares: normalizedSampledTierShares,
    tier,
    shares,
  });
}

/**
 * Allocate each ship stack from its share of the rounded 90% population target.
 * Each stack is rounded down/up deterministically, choosing the combination
 * whose total population is closest to the target.
 */
export function calculatePirateEliminationPopulationBudget(
  sentCombatPopulation: number,
  shares: Readonly<Partial<Record<PirateShipId, number>>>,
): PiratePopulationBudget {
  const sent = safePoints(sentCombatPopulation);
  const targetPopulation = Math.round(sent * 0.9);
  const entries = Object.entries(shares).filter(([, share]) => share !== undefined) as [PirateShipId, number][];
  const invalidShare = entries.some(([id, share]) => !PIRATE_BASE_SHIPS.some((ship) => ship.id === id)
    || !Number.isFinite(share) || share < 0);
  const totalShare = entries.reduce((sum, [, share]) => sum + share, 0);
  if (invalidShare || Math.abs(totalShare - 100) > 1e-9) {
    throw new Error('Pirate population allocation requires normalized ordinary-ship shares');
  }
  const activeEntries = entries.filter(([, share]) => share > 0);
  const options = activeEntries.map(([shipId, share]) => {
    const populationPerShip = PIRATE_CATALOG_BY_ID[shipId].population;
    const idealCount = targetPopulation * share / 100 / populationPerShip;
    const lowerCount = Math.floor(idealCount);
    return {
      shipId: shipId as PirateBaseShipId,
      populationPerShip,
      lowerCount,
      upperCount: Math.ceil(idealCount),
    };
  });
  let bestCounts: number[] = [];
  let bestPopulation = 0;
  let bestError = Number.POSITIVE_INFINITY;
  const combinations = 1 << options.length;
  for (let mask = 0; mask < combinations; mask += 1) {
    const counts = options.map((option, index) => (mask & (1 << index)) ? option.upperCount : option.lowerCount);
    const population = counts.reduce((sum, count, index) => sum + count * options[index]!.populationPerShip, 0);
    const error = Math.abs(population - targetPopulation);
    // Lower error wins; ties choose fewer people, then the first stable mask.
    if (error < bestError || (error === bestError && population < bestPopulation)) {
      bestError = error;
      bestPopulation = population;
      bestCounts = counts;
    }
  }
  const ships = Object.fromEntries(options.flatMap((option, index) => {
    const count = bestCounts[index]!;
    return count > 0 ? [[option.shipId, count]] : [];
  })) as Partial<Record<PirateShipId, number>>;
  return Object.freeze({
    targetPopulation,
    actualPopulation: bestPopulation,
    absoluteError: bestError,
    ships: Object.freeze(ships),
  });
}
