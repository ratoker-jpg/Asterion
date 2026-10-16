/**
 * Owner-wide pirate threat. All values use game elapsed time, not the date
 * a player registered or a tab first rendered.
 */
export const PIRATE_THREAT_MIN = 0.02;
export const PIRATE_THREAT_MAX = 0.30;
export const PIRATE_THREAT_GRACE_HOURS = 8;
export const PIRATE_THREAT_ALGORITHM = 'pirate-threat-v1';

const safe = (value: number) => Number.isFinite(value) ? Math.max(0, value) : 0;
const clamp = (value: number, lower: number, upper: number) => Math.max(lower, Math.min(upper, value));

export function pirateThreatScale(resourcePoints: number): number {
  const resources = safe(resourcePoints);
  if (resources >= 1_000_000) return 1;
  if (resources >= 100_000) return 1 + 1.65 * Math.log10(1_000_000 / resources);
  if (resources >= 1_000) return 2.65 + 0.675 * Math.log10(100_000 / resources) / 2;
  return 3.325;
}

export function pirateThreatHoursToMaximum(resourcePoints: number, battlePoints: number): number {
  const resources = safe(resourcePoints);
  const battles = safe(battlePoints);
  const total = resources + battles;
  const battleShare = total > 0 ? battles / total : 0;
  return 8 + 40 * pirateThreatScale(resources) * (1 + 2.4 * battleShare);
}

export function pirateRaidChance(resourcePoints: number, battlePoints: number, ageHours: number): number {
  const age = safe(ageHours);
  if (age <= PIRATE_THREAT_GRACE_HOURS) return PIRATE_THREAT_MIN;
  const maximumAt = pirateThreatHoursToMaximum(resourcePoints, battlePoints);
  return clamp(
    PIRATE_THREAT_MIN + 0.28 * Math.min(1, (age - PIRATE_THREAT_GRACE_HOURS) / (maximumAt - PIRATE_THREAT_GRACE_HOURS)),
    PIRATE_THREAT_MIN, PIRATE_THREAT_MAX,
  );
}

/** Conditional on a raid already having been created. */
export function pirateCounterFleetChance(resourcePoints: number, battlePoints: number, raidChance: number): number {
  const resources = safe(resourcePoints);
  const battles = safe(battlePoints);
  const total = resources + battles;
  const economicShare = total > 0 ? resources / total : 0;
  const normalizedThreat = clamp((Number.isFinite(raidChance) ? raidChance : PIRATE_THREAT_MIN) / 0.28 - (0.02 / 0.28), 0, 1);
  return clamp(0.10 + 0.60 * normalizedThreat * economicShare, 0.10, 0.70);
}

export type OwnerPirateThreat = Readonly<{
  version: 1;
  ageHours: number;
  integratedAt: number;
}>;

export function advancePirateThreat(threat: OwnerPirateThreat, nowMs: number): OwnerPirateThreat {
  if (!Number.isSafeInteger(nowMs) || nowMs < threat.integratedAt || nowMs < 0) return threat;
  const delta = (nowMs - threat.integratedAt) / 3_600_000;
  if (delta === 0) return threat;
  return Object.freeze({ version: 1, ageHours: safe(threat.ageHours) + delta, integratedAt: nowMs });
}

export function reducePirateThreatAfterVictory(threat: OwnerPirateThreat, atMs: number, fraction: number): OwnerPirateThreat {
  const current = advancePirateThreat(threat, atMs);
  const fractionClamped = clamp(Number.isFinite(fraction) ? fraction : 0, 0, 1);
  return Object.freeze({ ...current, ageHours: Math.max(0, current.ageHours * (1 - fractionClamped)) });
}

/** Zero or impossible manifests never receive a full-hangar bonus. */
export function pirateHangarFraction(sentPopulation: number, historicalCapacity: number): number {
  if (!Number.isSafeInteger(sentPopulation) || !Number.isSafeInteger(historicalCapacity)
    || sentPopulation <= 0 || historicalCapacity <= 0 || sentPopulation > historicalCapacity) return 0;
  return Math.min(1, sentPopulation / historicalCapacity);
}

export function pirateDebrisRewardMultiplier(sentPopulation: number, historicalCapacity: number): number {
  const fraction = pirateHangarFraction(sentPopulation, historicalCapacity);
  if (fraction === 0) return 1;
  if(sentPopulation===historicalCapacity)return 1.5;
  if(fraction>=0.95)return 1.3;
  if(fraction>=0.85)return 1;
  if(fraction>=0.50)return 0.9;
  return 0.7;
}

/** Versioned seeded draw; independent from ambient Math.random or React mounts. */
export function pirateSeededDraw(seed: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  let value = (hash + 0x6d2b79f5) >>> 0;
  value = Math.imul(value ^ (value >>> 15), value | 1);
  value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
  return ((value ^ (value >>> 14)) >>> 0) / 0x1_0000_0000;
}
