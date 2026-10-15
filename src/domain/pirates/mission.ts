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
import { isFlightCoordinate } from '../flights/distance.ts';

export type PirateMissionId = 'pirate-recon' | 'pirate-elimination';

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
      || !Number.isFinite(eliminationBudget.coefficient) || Number(eliminationBudget.coefficient) < 0.75
      || Number(eliminationBudget.coefficient) > 0.9
      || !validTimestamp(value.sentCombatPopulation)
      || !validTimestamp(value.historicalHangarCapacity)
      || ![1,1.25,1.5,2,2.5].includes(value.rewardMultiplier as number)
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
      eliminationBudget: Object.freeze({ ...eliminationBudget, ships: Object.freeze({ ...eliminationBudget.ships }) }) as PiratePopulationBudget,
      sentCombatPopulation: Number(value.sentCombatPopulation),
      historicalHangarCapacity: Number(value.historicalHangarCapacity),
      rewardMultiplier: Number(value.rewardMultiplier),
    } : {}),
    ...(reconMission ? { reconMission } : {}),
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
          && validTimestamp(level) && Number(level) <= 20),
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
  });
}
