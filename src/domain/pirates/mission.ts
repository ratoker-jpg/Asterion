import type { UniverseCoordinate } from '../universe/types.ts';
import {
  createPirateContactCycleKey,
  createDefaultPirateContactState,
  PIRATE_CONTACT_MIN_LIFETIME_MS,
  PIRATE_CONTACT_MAX_LIFETIME_MS,
  normalizePirateContactState,
  type PirateContactState,
} from './contact.ts';
import { isCanonicalPirateContactCycleKey } from './contact-schedule.ts';
import {
  normalizePirateReconReport,
  upsertPirateReconReport,
  type PirateReconReport,
} from './recon-report.ts';
import { pirateReconCooldownKey, normalizePirateReconMissionSnapshot, type PirateReconMissionSnapshot } from './recon.ts';
import type { PiratePopulationBudget, PirateProfile } from './profile.ts';
import type { OwnerPirateThreat } from './threat.ts';
import { normalizedPirateOwnerAdaptation, type PirateOwnerAdaptation } from './adaptive.ts';
import { isFlightCoordinate } from '../flights/distance.ts';

export type PirateMissionId = 'pirate-recon' | 'pirate-elimination';

export type PirateRaidSnapshot = Readonly<{
  version: 1;
  ownerId: string;
  contactCycleKey: string;
  targetPlanetId: string;
  checkAt: number;
  /** New raids freeze 12 rounds; absence is a legacy frozen 8-round raid. */
  maxRounds?: 12;
  counterFleet: boolean;
  composition: Readonly<Partial<Record<import('./catalog.ts').PirateBaseShipId, number>>>;
  profile: PirateProfile;
}>;

/** Frozen, dispatch-time identity and opponent snapshot for one pirate flight. */
export type PirateMissionSnapshot = Readonly<{
  version: 1;
  missionId: PirateMissionId;
  ownerId: string;
  contactCycleKey: string;
  coordinate: Readonly<UniverseCoordinate>;
  cycleIndex: number;
  startAt: number;
  expiresAt: number;
  profile: PirateProfile;
  /** V2 launch-only data; absent in pre-PR91 elimination flights. */
  eliminationBudget?: PiratePopulationBudget;
  sentCombatPopulation?: number;
  historicalHangarCapacity?: number;
  rewardMultiplier?: number;
  /** New launch-only result modifiers; absent on historical flights. */
  defeatMultiplier?: 0.5;
  drawMultiplier?: 0.75;
  adaptiveWeight?: number;
  adaptiveQ?: number;
  reconMission?: PirateReconMissionSnapshot;
}>;

/** Persisted state shared by contact resolution and historical recon reports. */
export type PirateState = Readonly<{
  version: 1;
  contact: PirateContactState;
  /** Last dispatch time keyed by owner and exact scheduled contact cycle. */
  reconLastDispatchAt: Readonly<Record<string, number>>;
  reconReports: readonly PirateReconReport[];
  /** Owner-wide historical maxima survive downgrades and colony loss. */
  ownerMaxHangarLevel?: Readonly<Record<string, number>>;
  ownerThreats?: Readonly<Record<string, OwnerPirateThreat>>;
  ownerAdaptations?: Readonly<Record<string,PirateOwnerAdaptation>>;
  /** Persisted checkpoint and one owner-cycle raid decision. */
  raidProcessedAt?: number;
  raidRolls?: Readonly<Record<string, Readonly<{ checkAt: number; seed: string; flightId?: string }>>>;
}>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validTimestamp(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function validCoordinate(value: unknown): value is UniverseCoordinate {
  return isRecord(value)
    && [value.galaxy, value.system, value.position].every((part) => Number.isSafeInteger(part))
    && isFlightCoordinate(value);
}

function freezeProfile(profile: PirateProfile): PirateProfile {
  return Object.freeze({
    ...profile,
    score: Object.freeze({ ...profile.score }),
    technologies: Object.freeze({ ...profile.technologies }),
    expectedTierShares: Object.freeze({ ...profile.expectedTierShares }),
    sampledTierShares: Object.freeze({ ...profile.sampledTierShares }),
    shares: Object.freeze({ ...profile.shares }),
  });
}

export function createDefaultPirateState(): PirateState {
  return Object.freeze({
    version: 1,
    contact: createDefaultPirateContactState(),
    reconLastDispatchAt: Object.freeze({}),
    reconReports: Object.freeze([]),
    ownerMaxHangarLevel: Object.freeze({}),
    ownerThreats: Object.freeze({}),
    ownerAdaptations: Object.freeze({}),
    raidRolls: Object.freeze({}),
  });
}

/** Validate a flight snapshot without consulting mutable live score or profile state. */
export function normalizePirateMissionSnapshot(
  value: unknown,
  expectedMissionId?: PirateMissionId,
): PirateMissionSnapshot | null {
  if (!isRecord(value)
    || value.version !== 1
    || (value.missionId !== 'pirate-recon' && value.missionId !== 'pirate-elimination')
    || (expectedMissionId !== undefined && value.missionId !== expectedMissionId)
    || typeof value.ownerId !== 'string' || !value.ownerId.trim() || value.ownerId.length > 160
    || typeof value.contactCycleKey !== 'string' || !isCanonicalPirateContactCycleKey(value.contactCycleKey)
    || !validCoordinate(value.coordinate)
    || !Number.isSafeInteger(value.cycleIndex) || Number(value.cycleIndex) < 0
    || !validTimestamp(value.startAt)
    || !validTimestamp(value.expiresAt)
    || Number(value.expiresAt) - Number(value.startAt) < PIRATE_CONTACT_MIN_LIFETIME_MS
    || Number(value.expiresAt) > Number(value.startAt) + PIRATE_CONTACT_MAX_LIFETIME_MS
    || value.contactCycleKey !== createPirateContactCycleKey({
      galaxy: Number(value.coordinate.galaxy),
      system: Number(value.coordinate.system),
      cycleIndex: Number(value.cycleIndex),
      startAt: Number(value.startAt),
    })) return null;

  const contact = normalizePirateContactState({
    version: 1,
    defeatedCycles: {},
    ownerProfiles: { [value.ownerId]: { [value.contactCycleKey]: value.profile } },
  });
  const profile = contact.ownerProfiles[value.ownerId]?.[value.contactCycleKey];
  if (!profile) return null;

  let reconMission: PirateReconMissionSnapshot | undefined;
  if (value.missionId === 'pirate-recon') {
    reconMission = normalizePirateReconMissionSnapshot(value.reconMission) ?? undefined;
    if (!reconMission
      || reconMission.ownerId !== value.ownerId
      || reconMission.contactCycleKey !== value.contactCycleKey
      || reconMission.dispatchedAt < Number(value.startAt)
      || reconMission.dispatchedAt > Number(value.expiresAt)) return null;
  } else if (value.reconMission !== undefined) {
    return null;
  }

  const eliminationBudget = value.eliminationBudget;
  if (eliminationBudget !== undefined) {
    if (value.missionId !== 'pirate-elimination' || !isRecord(eliminationBudget)
      || !validTimestamp(eliminationBudget.targetPopulation)
      || !validTimestamp(eliminationBudget.actualPopulation)
      || !Number.isFinite(eliminationBudget.absoluteError) || Number(eliminationBudget.absoluteError) < 0
      || !isRecord(eliminationBudget.ships)
      || Object.entries(eliminationBudget.ships).some(([id,count]) =>
        !['pirate-hound','pirate-raider','pirate-corsair','pirate-executioner','pirate-butcher','pirate-bruiser','pirate-planet-breaker'].includes(id)
        || !validTimestamp(count))
      // Union of persisted pre-patch 75–90% and new seeded 85–105% budgets.
      // Do not recompute a launched garrison from today's coefficient.
      || !Number.isFinite(eliminationBudget.coefficient) || Number(eliminationBudget.coefficient) < 0.75
      || Number(eliminationBudget.coefficient) > 1.10
      || !validTimestamp(value.sentCombatPopulation)
      || !validTimestamp(value.historicalHangarCapacity)
      || ![0.7,0.9,1,1.25,1.3,1.5,2,2.5].includes(value.rewardMultiplier as number)
      || (value.defeatMultiplier!==undefined&&value.defeatMultiplier!==0.5)
      || (value.drawMultiplier!==undefined&&value.drawMultiplier!==0.75)
      || (value.adaptiveWeight!==undefined&&(typeof value.adaptiveWeight!=='number'
        ||!Number.isFinite(value.adaptiveWeight)||value.adaptiveWeight<0||value.adaptiveWeight>1))
      || (value.adaptiveQ!==undefined&&(typeof value.adaptiveQ!=='number'
        ||!Number.isFinite(value.adaptiveQ)||value.adaptiveQ<0||value.adaptiveQ>1))
    ) return null;
  }

  const coordinate = Object.freeze({
    galaxy: Number(value.coordinate.galaxy),
    system: Number(value.coordinate.system),
    position: Number(value.coordinate.position),
  });
  return Object.freeze({
    version: 1,
    missionId: value.missionId,
    ownerId: value.ownerId,
    contactCycleKey: value.contactCycleKey,
    coordinate,
    cycleIndex: Number(value.cycleIndex),
    startAt: Number(value.startAt),
    expiresAt: Number(value.expiresAt),
    profile: freezeProfile(profile),
    ...(eliminationBudget ? {
      eliminationBudget: Object.freeze({ ...(eliminationBudget as Record<string,unknown>), ships: Object.freeze({ ...((eliminationBudget as Record<string,unknown>).ships as Record<string,number>) }) }) as PiratePopulationBudget,
      sentCombatPopulation: Number(value.sentCombatPopulation),
      historicalHangarCapacity: Number(value.historicalHangarCapacity),
      rewardMultiplier: Number(value.rewardMultiplier),
      ...(value.defeatMultiplier===0.5?{defeatMultiplier:0.5 as const}:{}),
      ...(value.drawMultiplier===0.75?{drawMultiplier:0.75 as const}:{}),
      ...(typeof value.adaptiveWeight==='number'?{adaptiveWeight:value.adaptiveWeight}:{}),
      ...(typeof value.adaptiveQ==='number'?{adaptiveQ:value.adaptiveQ}:{}),
    } : {}),
    ...(reconMission ? { reconMission } : {}),
  });
}

export function normalizePirateRaidSnapshot(value: unknown): PirateRaidSnapshot | null {
  if (!isRecord(value) || value.version !== 1
    || typeof value.ownerId !== 'string' || !value.ownerId.trim() || value.ownerId.length > 160
    || ['__proto__','prototype','constructor'].includes(value.ownerId)
    || typeof value.contactCycleKey !== 'string' || !isCanonicalPirateContactCycleKey(value.contactCycleKey)
    || typeof value.targetPlanetId !== 'string' || !value.targetPlanetId.trim() || value.targetPlanetId.length > 160
    || !validTimestamp(value.checkAt) || typeof value.counterFleet !== 'boolean'
    || (value.maxRounds !== undefined && value.maxRounds !== 12)
    || !isRecord(value.composition)) return null;
  const profileContainer = normalizePirateContactState({
    version: 1, defeatedCycles: {},
    ownerProfiles: { [value.ownerId]: { [value.contactCycleKey]: value.profile } },
  });
  const profile = profileContainer.ownerProfiles[value.ownerId]?.[value.contactCycleKey];
  if (!profile) return null;
  const shipIds = new Set(['pirate-hound','pirate-raider','pirate-corsair',
    'pirate-executioner','pirate-butcher','pirate-bruiser']);
  const quantities = Object.entries(value.composition);
  if (!quantities.length || quantities.some(([id,count]) => !shipIds.has(id)
    || !Number.isSafeInteger(count) || Number(count) <= 0)) return null;
  return Object.freeze({
    version: 1, ownerId: value.ownerId, contactCycleKey: value.contactCycleKey,
    targetPlanetId: value.targetPlanetId, checkAt: value.checkAt,
    ...(value.maxRounds === 12 ? { maxRounds: 12 as const } : {}),
    counterFleet: value.counterFleet,
    composition: Object.freeze({ ...value.composition }) as PirateRaidSnapshot['composition'],
    profile: freezeProfile(profile),
  });
}

export function isPirateMissionSnapshot(
  value: unknown,
  expectedMissionId?: PirateMissionId,
): value is PirateMissionSnapshot {
  return normalizePirateMissionSnapshot(value, expectedMissionId) !== null;
}

/** Keep valid pirate records while isolating malformed pirate data from the main save. */
export function normalizePirateState(value: unknown): PirateState {
  if (!isRecord(value) || value.version !== 1) return createDefaultPirateState();
  const reconLastDispatchAt: Record<string, number> = {};
  if (isRecord(value.reconLastDispatchAt)) {
    for (const [key, timestamp] of Object.entries(value.reconLastDispatchAt)) {
      if (!validTimestamp(timestamp)) continue;
      try {
        const parsed = JSON.parse(key) as unknown;
        if (!Array.isArray(parsed) || parsed.length !== 2
          || typeof parsed[0] !== 'string' || !parsed[0].trim() || parsed[0].length > 160
          || typeof parsed[1] !== 'string' || !isCanonicalPirateContactCycleKey(parsed[1])
          || pirateReconCooldownKey(parsed[0], parsed[1]) !== key) continue;
        const cycleStartAt = Number((parsed[1] as string).split(':')[4]);
        if (!Number.isSafeInteger(cycleStartAt)
          || timestamp < cycleStartAt
          || timestamp - cycleStartAt > PIRATE_CONTACT_MAX_LIFETIME_MS) continue;
        reconLastDispatchAt[key] = timestamp;
      } catch {
        // Invalid individual cooldown records are safely discarded.
      }
    }
  }

  const reports: PirateReconReport[] = [];
  if (Array.isArray(value.reconReports)) {
    for (const candidate of value.reconReports) {
      const report = normalizePirateReconReport(candidate);
      if (report) {
        const upserted = upsertPirateReconReport(reports, report);
        reports.splice(0, reports.length, ...upserted);
      }
    }
  }

  return Object.freeze({
    version: 1,
    contact: normalizePirateContactState(value.contact),
    reconLastDispatchAt: Object.freeze(reconLastDispatchAt),
    reconReports: Object.freeze(reports),
    ownerMaxHangarLevel: Object.freeze(Object.fromEntries(
      Object.entries(isRecord(value.ownerMaxHangarLevel) ? value.ownerMaxHangarLevel : {})
        .filter(([id, level]) => id.trim().length > 0 && id.length <= 160
          && !['__proto__','prototype','constructor'].includes(id)
          && validTimestamp(level) && Number(level) <= 20)
        .map(([id, level]) => [id,Number(level)]),
    )),
    ownerAdaptations:Object.freeze(Object.fromEntries(
      Object.entries(isRecord(value.ownerAdaptations)?value.ownerAdaptations:{})
        .filter(([id])=>id.trim().length>0&&id.length<=160
          &&!['__proto__','constructor','prototype'].includes(id))
        .flatMap(([id,item])=>{
          const normalized=normalizedPirateOwnerAdaptation(item);
          return normalized?[[id,normalized]]:[];
        }),
    )),
    ownerThreats: Object.freeze(Object.fromEntries(
      Object.entries(isRecord(value.ownerThreats) ? value.ownerThreats : {})
        .filter(([id, threat]) => id.trim().length > 0 && id.length <= 160
          && !['__proto__','prototype','constructor'].includes(id)
          && isRecord(threat) && threat.version === 1
          && typeof threat.ageHours === 'number' && Number.isFinite(threat.ageHours) && threat.ageHours >= 0
          && validTimestamp(threat.integratedAt))
        .map(([id, threat]) => [id, Object.freeze({ version: 1 as const,
          ageHours: Number((threat as Record<string, unknown>).ageHours),
          integratedAt: Number((threat as Record<string, unknown>).integratedAt) })]),
    )),
    ...(validTimestamp(value.raidProcessedAt) ? { raidProcessedAt: value.raidProcessedAt } : {}),
    raidRolls: Object.freeze(Object.fromEntries(
      Object.entries(isRecord(value.raidRolls) ? value.raidRolls : {})
        .filter(([key, roll]) => {
          if (!isRecord(roll) || !validTimestamp(roll.checkAt)
            || typeof roll.seed !== 'string' || roll.seed.length < 1 || roll.seed.length > 500
            || (roll.flightId !== undefined && (typeof roll.flightId !== 'string'
              || roll.flightId.length > 500 || !roll.flightId.startsWith('flight-pirate-raid:')))) return false;
          try {
            const pair = JSON.parse(key) as unknown;
            return Array.isArray(pair) && pair.length === 2
              && typeof pair[0] === 'string' && pair[0].trim().length > 0
              && pair[0].length <= 160 && typeof pair[1] === 'string'
              && isCanonicalPirateContactCycleKey(pair[1]);
          } catch { return false; }
        })
        .map(([key, roll]) => [key, Object.freeze({
          checkAt:Number((roll as Record<string,unknown>).checkAt),
          seed:String((roll as Record<string,unknown>).seed),
          ...((roll as Record<string,unknown>).flightId !== undefined
            ? {flightId:String((roll as Record<string,unknown>).flightId)} : {}),
        })]),
    )),
  });
}
