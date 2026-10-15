import { createPirateProfile, type PirateOwnerScoreSnapshot, type PirateProfile } from './profile.ts';
import {
  isCanonicalPirateContactCycleKey,
  isValidPirateContactDefeatRecord,
  PIRATE_CONTACT_QUIET_MS,
} from './contact-schedule.ts';
import type { PirateContactDefeatRecord } from './contact-schedule.ts';
export {
  applyPirateContactDefeatsToSchedules,
  createPirateContactCycleKey,
  PIRATE_CONTACT_MAX_LIFETIME_MS,
  PIRATE_CONTACT_MIN_LIFETIME_MS,
  PIRATE_CONTACT_QUIET_MS,
} from './contact-schedule.ts';
export type { PirateContactCycleIdentity, PirateContactDefeatRecord, PirateScheduleCycle } from './contact-schedule.ts';

export type PirateContactState = Readonly<{
  version: 1;
  /** Shared by every owner in this local save. Keys identify one scheduled cycle. */
  defeatedCycles: Readonly<Record<string, PirateContactDefeatRecord>>;
  /** Frozen owner-specific snapshots, indexed by owner and scheduled cycle. */
  ownerProfiles: Readonly<Record<string, Readonly<Record<string, PirateProfile>>>>;
}>;

export type PirateContactVictoryInput = Omit<PirateContactDefeatRecord, 'nextEligibleAt'> & {
  nextEligibleAt?: number;
};

const MAX_OWNER_ID_LENGTH = 256;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isOwnerId(value: string): boolean {
  return Boolean(value.trim())
    && value.length <= MAX_OWNER_ID_LENGTH
    && value !== '__proto__'
    && value !== 'constructor'
    && value !== 'prototype';
}

function isOwnerScore(value: unknown): value is PirateOwnerScoreSnapshot {
  if (!isRecord(value)
    || !Number.isFinite(value.resourcePoints)
    || (value.resourcePoints as number) < 0
    || !Number.isFinite(value.battlePoints)
    || (value.battlePoints as number) < 0
    || !Number.isFinite(value.totalPoints)
    || (value.totalPoints as number) < 0) return false;
  const resourcePoints = value.resourcePoints as number;
  const battlePoints = value.battlePoints as number;
  const totalPoints = resourcePoints > Number.MAX_VALUE - battlePoints
    ? Number.MAX_VALUE
    : resourcePoints + battlePoints;
  return value.totalPoints === totalPoints;
}

export function createDefaultPirateContactState(): PirateContactState {
  return { version: 1, defeatedCycles: {}, ownerProfiles: {} };
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (!isRecord(value)) return JSON.stringify(value);
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
}

function isPirateProfile(value: unknown, ownerId: string, cycleKey: string): value is PirateProfile {
  if (!isCanonicalPirateContactCycleKey(cycleKey) || !isRecord(value) || value.ownerId !== ownerId || value.contactCycleKey !== cycleKey) return false;
  if (!isOwnerScore(value.score)) return false;
  try {
    const expected = createPirateProfile({
      ownerId,
      contactCycleKey: cycleKey,
      score: value.score as PirateOwnerScoreSnapshot,
    });
    return canonicalJson(value) === canonicalJson(expected);
  } catch {
    return false;
  }
}

function collectIssues(value: unknown): string[] {
  if (!isRecord(value)) return ['Pirate contact state must be an object.'];
  const issues: string[] = [];
  if (value.version !== 1) issues.push('Pirate contact state version must be 1.');
  if (!isRecord(value.defeatedCycles)) {
    issues.push('Pirate contact defeatedCycles must be an object.');
  } else {
    for (const [key, record] of Object.entries(value.defeatedCycles)) {
      if (!isValidPirateContactDefeatRecord(record, key)) issues.push(`Invalid pirate defeat record: ${key}.`);
    }
  }
  if (!isRecord(value.ownerProfiles)) {
    issues.push('Pirate contact ownerProfiles must be an object.');
  } else {
    for (const [ownerId, cycles] of Object.entries(value.ownerProfiles)) {
      if (!isOwnerId(ownerId) || !isRecord(cycles)) {
        issues.push(`Invalid pirate profile owner: ${ownerId}.`);
        continue;
      }
      for (const [cycleKey, profile] of Object.entries(cycles)) {
        if (!isPirateProfile(profile, ownerId, cycleKey)) {
          issues.push(`Invalid pirate owner profile: ${ownerId}/${cycleKey}.`);
        }
      }
    }
  }
  return issues;
}

/** Strict, non-mutating validation for persisted pirate state. */
export function validatePirateContactState(value: unknown): { valid: boolean; issues: string[] } {
  const issues = collectIssues(value);
  return { valid: issues.length === 0, issues };
}

/** Safe migration boundary: malformed pirate entries are discarded without affecting the main save. */
export function migratePirateContactState(value: unknown): PirateContactState {
  if (!isRecord(value) || value.version !== 1) return createDefaultPirateContactState();
  const defeatedCycles: Record<string, PirateContactDefeatRecord> = {};
  if (isRecord(value.defeatedCycles)) {
    for (const [key, record] of Object.entries(value.defeatedCycles)) {
      if (isValidPirateContactDefeatRecord(record, key)) defeatedCycles[key] = record;
    }
  }
  const ownerProfiles: Record<string, Record<string, PirateProfile>> = {};
  if (isRecord(value.ownerProfiles)) {
    for (const [ownerId, cycles] of Object.entries(value.ownerProfiles)) {
      if (!isOwnerId(ownerId) || !isRecord(cycles)) continue;
      for (const [cycleKey, profile] of Object.entries(cycles)) {
        if (!isPirateProfile(profile, ownerId, cycleKey)) continue;
        (ownerProfiles[ownerId] ??= {})[cycleKey] = profile;
      }
    }
  }
  return { version: 1, defeatedCycles, ownerProfiles };
}

/** Alias for callers that name the legacy-save boundary explicitly. */
export const normalizePirateContactState = migratePirateContactState;

export function getPirateOwnerProfile(
  state: PirateContactState,
  ownerId: string,
  contactCycleKey: string,
): PirateProfile | undefined {
  return state.ownerProfiles[ownerId]?.[contactCycleKey];
}

/** Creates an owner snapshot once. Later score changes cannot alter a revealed cycle profile. */
export function getOrCreatePirateOwnerProfile(
  state: PirateContactState,
  input: { ownerId: string; contactCycleKey: string; score: PirateOwnerScoreSnapshot },
): { state: PirateContactState; profile: PirateProfile } {
  const existing = getPirateOwnerProfile(state, input.ownerId, input.contactCycleKey);
  if (existing) return { state, profile: existing };
  if (!isOwnerId(input.ownerId)) throw new TypeError('Pirate profile owner id is invalid.');
  if (!isCanonicalPirateContactCycleKey(input.contactCycleKey)) {
    throw new TypeError('Pirate profile contact cycle key is invalid.');
  }
  if (!isOwnerScore(input.score)) throw new TypeError('Pirate profile owner score is invalid.');
  const profile = createPirateProfile(input);
  const ownerProfiles = {
    ...state.ownerProfiles,
    [input.ownerId]: {
      ...state.ownerProfiles[input.ownerId],
      [input.contactCycleKey]: profile,
    },
  };
  return { state: { ...state, ownerProfiles }, profile };
}

/** Records the earliest authoritative victory for a shared contact cycle. */
export function recordPirateContactDefeat(
  state: PirateContactState,
  input: PirateContactVictoryInput,
): PirateContactState {
  const record: PirateContactDefeatRecord = Object.freeze({
    ...input,
    coordinate: Object.freeze({ ...input.coordinate }),
    nextEligibleAt: input.defeatedAt + PIRATE_CONTACT_QUIET_MS,
  });
  if (!isValidPirateContactDefeatRecord(record, input.contactCycleKey)) throw new TypeError('Pirate contact defeat record is invalid.');
  const previous = state.defeatedCycles[input.contactCycleKey];
  if (previous && previous.defeatedAt <= record.defeatedAt) return state;
  return {
    ...state,
    defeatedCycles: { ...state.defeatedCycles, [input.contactCycleKey]: record },
  };
}
