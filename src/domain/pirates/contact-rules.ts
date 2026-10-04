/** Stable identity for a pirate contact in one scheduled universe cycle. */
export function pirateContactCycleKey(galaxy: number, system: number, cycleIndex: number): string {
  if (!Number.isSafeInteger(galaxy) || galaxy < 1) throw new RangeError('galaxy must be a positive safe integer');
  if (!Number.isSafeInteger(system) || system < 1) throw new RangeError('system must be a positive safe integer');
  if (!Number.isSafeInteger(cycleIndex) || cycleIndex < 0) throw new RangeError('cycleIndex must be a non-negative safe integer');
  return `pirate-contact:v1:${galaxy}:${system}:${cycleIndex}`;
}

function safeNonNegative(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function unitInterval(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

/** Computes q = resourcePoints / (resourcePoints + battlePoints), safely. */
export function calculatePirateActivityRatio(resourcePoints: number, battlePoints: number): number {
  const resources = safeNonNegative(resourcePoints);
  const battle = safeNonNegative(battlePoints);
  const scale = Math.max(resources, battle);
  if (scale === 0) return 0;

  const scaledResources = resources / scale;
  const scaledBattle = battle / scale;
  return unitInterval(scaledResources / (scaledResources + scaledBattle));
}

/** Per-owner, per-system raid probability from the normalized activity ratio. */
export function pirateRaidChance(q: number): number {
  return 0.02 + 0.10 * unitInterval(q);
}

/** Raid population budget multiplier from the normalized activity ratio. */
export function pirateRaidPopulationMultiplier(q: number): number {
  return 0.35 + 0.55 * unitInterval(q);
}

/** Probability of at least one independent success across N systems. */
export function aggregatePirateRaidChance(perSystemChance: number, independentSystemCount: number): number {
  const chance = unitInterval(perSystemChance);
  if (!Number.isFinite(independentSystemCount) || independentSystemCount <= 0) return 0;
  const count = Math.floor(independentSystemCount);
  if (count <= 0 || chance === 0) return 0;
  if (chance === 1) return 1;
  return unitInterval(1 - (1 - chance) ** count);
}

const UINT32_RANGE = 0x1_0000_0000;

/** Chance that an otherwise eligible incoming raid includes one Planet Breaker. */
export const PIRATE_PLANET_BREAKER_APPEARANCE_CHANCE = 0.05;

function hashSeed(seed: string): number {
  let hash = 2_166_136_261;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return hash >>> 0 || 1;
}

function createSeededUint32(seed: string): () => number {
  let state = hashSeed(seed);
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state;
  };
}

/** Uniform integer in [0, upperExclusive), using rejection to avoid modulo bias. */
function seededIntegerBelow(nextUint32: () => number, upperExclusive: number): number {
  const limit = Math.floor(UINT32_RANGE / upperExclusive) * upperExclusive;
  let value = nextUint32();
  while (value >= limit) value = nextUint32();
  return value % upperExclusive;
}

function sortedUniqueColonyIds(colonyIds: readonly string[]): string[] {
  return [...new Set(colonyIds.filter((id) => typeof id === 'string' && id.length > 0))]
    .sort((left, right) => left < right ? -1 : left > right ? 1 : 0);
}

export type PirateRaidCycleInput = {
  ownerId: string;
  galaxy: number;
  system: number;
  cycleIndex: number;
  resourcePoints: number;
  battlePoints: number;
  colonyIds: readonly string[];
};

export type PirateRaidCycleOutcome = {
  ownerId: string;
  contactCycleKey: string;
  chance: number;
  /** Deterministic roll in [0, 1); same key and inputs replay the same outcome. */
  roll: number;
  rollSucceeded: boolean;
  /** Present only after a successful roll and when at least one colony is available. */
  targetPlanetId?: string;
};

/**
 * Resolves one deterministic outcome for an owner/contact-cycle key. This is
 * stateless: callers persist the returned outcome when the cycle is consumed.
 */
export function resolvePirateRaidCycle(input: PirateRaidCycleInput): PirateRaidCycleOutcome {
  if (!input.ownerId) throw new RangeError('ownerId must be non-empty');
  const contactCycleKey = pirateContactCycleKey(input.galaxy, input.system, input.cycleIndex);
  const chance = pirateRaidChance(calculatePirateActivityRatio(input.resourcePoints, input.battlePoints));
  const nextUint32 = createSeededUint32(JSON.stringify(['pirate-raid:v1', input.ownerId, contactCycleKey]));
  const roll = nextUint32() / UINT32_RANGE;
  const rollSucceeded = roll < chance;
  const colonies = sortedUniqueColonyIds(input.colonyIds);
  const targetPlanetId = rollSucceeded && colonies.length > 0
    ? colonies[seededIntegerBelow(nextUint32, colonies.length)]
    : undefined;

  return {
    ownerId: input.ownerId,
    contactCycleKey,
    chance,
    roll,
    rollSucceeded,
    ...(targetPlanetId ? { targetPlanetId } : {}),
  };
}

export type PirateReconOutcome = {
  ownerId: string;
  contactCycleKey: string;
  /** Uniform seeded integer in [0, 100); values 0..69 grant the full report. */
  roll: number;
  fullReport: boolean;
};

/** Seeded recon outcome; spy level is intentionally not part of the input. */
export function resolvePirateRecon(ownerId: string, galaxy: number, system: number, cycleIndex: number): PirateReconOutcome {
  if (!ownerId) throw new RangeError('ownerId must be non-empty');
  const contactCycleKey = pirateContactCycleKey(galaxy, system, cycleIndex);
  const nextUint32 = createSeededUint32(JSON.stringify(['pirate-recon:v1', ownerId, contactCycleKey]));
  const roll = seededIntegerBelow(nextUint32, 100);
  return { ownerId, contactCycleKey, roll, fullReport: roll < 70 };
}

/** Strict eligibility gate for the incoming pirate planet-breaker unit. */
export function canUsePiratePlanetBreaker(ownerTotalPoints: number, targetPopulation: number): boolean {
  return Number.isFinite(ownerTotalPoints)
    && Number.isFinite(targetPopulation)
    && ownerTotalPoints >= 0
    && targetPopulation >= 0
    && ownerTotalPoints > 3_000_000
    && targetPopulation < 2_000;
}

/**
 * Pirate debris share as a fraction. Each surviving participating Corsair
 * contributes 0.5 percentage points per level, up to the 80% cap.
 */
export function pirateDebrisShare(survivingCorsairLevels: readonly number[]): number {
  const survivingLevels = survivingCorsairLevels.reduce((total, level) => (
    Number.isSafeInteger(level) && level > 0 ? total + level : total
  ), 0);
  return Math.min(0.80, 0.60 + survivingLevels * 0.005);
}
