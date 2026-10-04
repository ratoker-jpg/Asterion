import { PIRATE_BASE_SHIPS, PIRATE_CATALOG_BY_ID, PIRATE_SHIP_IDS, type PirateBaseShipId, type PirateShipId, type PirateTier } from './catalog.ts';
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
  tier: 1 | 2 | 3;
  shares: PirateShipShares;
}>;

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

/** Select one mono-class profile from the interpolated tier weights; this keeps every profile at exactly 100%. */
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
  const score = Object.freeze({
    resourcePoints: safePoints(input.score.resourcePoints),
    battlePoints: safePoints(input.score.battlePoints),
    totalPoints: safePoints(input.score.totalPoints),
  });
  const expectedTierShares = expectedPirateTierShares(score.totalPoints);
  const tier = sampleTier(expectedTierShares, random);
  const tierShips = classesInTier(tier);
  const selected = tierShips[Math.floor(random() * tierShips.length)]!;
  const shares = Object.freeze({
    ...Object.fromEntries(PIRATE_BASE_SHIPS.map((ship) => [ship.id, ship.id === selected.id ? 100 : 0])),
    'pirate-planet-breaker': 0,
  }) as Readonly<Record<PirateShipId, number>>;
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
    tier,
    shares,
  });
}

/**
 * Allocate a fresh elimination garrison at exactly the rounded 90% target,
 * then choose the nearest integer population representable by this mono-class
 * sampled profile. Ties round down to keep the outcome stable and conservative.
 */
export function calculatePirateEliminationPopulationBudget(
  sentCombatPopulation: number,
  shares: Readonly<Partial<Record<PirateShipId, number>>>,
): PiratePopulationBudget {
  const sent = safePoints(sentCombatPopulation);
  const targetPopulation = Math.round(sent * 0.9);
  const entries = Object.entries(shares).filter(([, share]) => share !== undefined) as [PirateShipId, number][];
  const selectedEntries = entries.filter(([, share]) => share === 100);
  const invalidShare = entries.some(([id, share]) => !PIRATE_SHIP_IDS.includes(id) || (share !== 0 && share !== 100));
  if (invalidShare || selectedEntries.length !== 1 || entries.reduce((sum, [, share]) => sum + share, 0) !== 100) {
    throw new Error('Pirate population allocation requires one normalized mono-class profile');
  }
  const [shipId] = selectedEntries[0]!;
  if (shipId === 'pirate-planet-breaker') throw new Error('Planet breaker is not valid in an elimination garrison');
  const populationPerShip = PIRATE_CATALOG_BY_ID[shipId].population;
  const lowerCount = Math.floor(targetPopulation / populationPerShip);
  const upperCount = lowerCount + (targetPopulation % populationPerShip === 0 ? 0 : 1);
  const lowerPopulation = lowerCount * populationPerShip;
  const upperPopulation = upperCount * populationPerShip;
  const count = targetPopulation - lowerPopulation <= upperPopulation - targetPopulation ? lowerCount : upperCount;
  const actualPopulation = count * populationPerShip;
  return Object.freeze({
    targetPopulation,
    actualPopulation,
    absoluteError: Math.abs(actualPopulation - targetPopulation),
    ships: Object.freeze({ [shipId]: count }) as Readonly<Partial<Record<PirateShipId, number>>>,
  });
}
