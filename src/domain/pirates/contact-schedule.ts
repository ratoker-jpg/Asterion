import type { UniverseCoordinate } from '../universe/types.ts';

export const PIRATE_CONTACT_MIN_LIFETIME_MS = 45 * 60 * 1_000;
export const PIRATE_CONTACT_MAX_LIFETIME_MS = 75 * 60 * 1_000;
export const PIRATE_CONTACT_QUIET_MS = 15 * 60 * 1_000;

export type PirateContactCycleIdentity = Readonly<{
  galaxy: number;
  system: number;
  cycleIndex: number;
  startAt: number;
}>;

export type PirateContactDefeatRecord = Readonly<{
  contactCycleKey: string;
  galaxy: number;
  system: number;
  cycleIndex: number;
  startAt: number;
  coordinate: UniverseCoordinate;
  defeatedAt: number;
  nextEligibleAt: number;
}>;

const MAX_SYSTEM = 40;
const MAX_POSITION = 24;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isNonnegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function isPositiveInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0;
}

function isCoordinate(value: unknown): value is UniverseCoordinate {
  if (!isRecord(value)) return false;
  return isPositiveInteger(value.galaxy)
    && isPositiveInteger(value.system)
    && value.system <= MAX_SYSTEM
    && isPositiveInteger(value.position)
    && value.position <= MAX_POSITION;
}

function isCycleIdentity(value: unknown): value is Record<string, unknown> & PirateContactCycleIdentity {
  if (!isRecord(value)) return false;
  return isPositiveInteger(value.galaxy)
    && isPositiveInteger(value.system)
    && value.system <= MAX_SYSTEM
    && isNonnegativeInteger(value.cycleIndex)
    && isNonnegativeInteger(value.startAt);
}

/** Stable identity for one pirate schedule cycle; the public planet id is intentionally excluded. */
export function createPirateContactCycleKey(identity: PirateContactCycleIdentity): string {
  if (!isCycleIdentity(identity)) throw new TypeError('Pirate contact cycle identity is invalid.');
  return `pirate-cycle-v1:${identity.galaxy}:${identity.system}:${identity.cycleIndex}:${identity.startAt}`;
}

export function isCanonicalPirateContactCycleKey(value: string): boolean {
  const match = /^pirate-cycle-v1:(\d+):(\d+):(\d+):(\d+)$/.exec(value);
  if (!match) return false;
  const [, galaxyText, systemText, cycleText, startText] = match;
  const identity = {
    galaxy: Number(galaxyText),
    system: Number(systemText),
    cycleIndex: Number(cycleText),
    startAt: Number(startText),
  };
  return isCycleIdentity(identity) && createPirateContactCycleKey(identity) === value;
}

export function isValidPirateContactDefeatRecord(
  value: unknown,
  expectedKey?: string,
): value is PirateContactDefeatRecord {
  if (!isRecord(value) || !isCycleIdentity(value)) return false;
  if (typeof value.contactCycleKey !== 'string'
    || value.contactCycleKey !== createPirateContactCycleKey(value)
    || (expectedKey !== undefined && value.contactCycleKey !== expectedKey)
    || !isCoordinate(value.coordinate)
    || value.coordinate.galaxy !== value.galaxy
    || value.coordinate.system !== value.system
    || !isNonnegativeInteger(value.defeatedAt)
    || !isNonnegativeInteger(value.nextEligibleAt)) return false;
  return value.defeatedAt >= value.startAt
    && value.defeatedAt <= value.startAt + PIRATE_CONTACT_MAX_LIFETIME_MS
    && value.nextEligibleAt === value.defeatedAt + PIRATE_CONTACT_QUIET_MS;
}

export type PirateScheduleCycle = Readonly<{
  cycleIndex: number;
  startAt: number;
  expiresAt: number;
  respawnAt: number;
  lifetimeMs: number;
  spawnChance: number;
  present: boolean;
}>;

/** Applies global early victories to the existing deterministic pirate cycle sequence. */
export function applyPirateContactDefeatsToSchedules<T extends PirateScheduleCycle>(
  schedules: readonly T[],
  galaxy: number,
  system: number,
  defeats: readonly PirateContactDefeatRecord[] = [],
): T[] {
  const records = new Map<string, PirateContactDefeatRecord>();
  for (const record of defeats) {
    if (record.galaxy !== galaxy || record.system !== system || !isValidPirateContactDefeatRecord(record)) continue;
    const previous = records.get(record.contactCycleKey);
    if (!previous || record.defeatedAt < previous.defeatedAt) records.set(record.contactCycleKey, record);
  }
  let nextStartAt: number | undefined;
  return schedules.map((schedule) => {
    const startAt = nextStartAt ?? schedule.startAt;
    const expiresAt = schedule.present ? startAt + schedule.lifetimeMs : startAt;
    const contactCycleKey = createPirateContactCycleKey({ galaxy, system, cycleIndex: schedule.cycleIndex, startAt });
    const defeat = records.get(contactCycleKey);
    const matchesDefeat = defeat?.contactCycleKey === contactCycleKey;
    const adjustedExpiresAt = matchesDefeat ? Math.min(expiresAt, defeat.defeatedAt) : expiresAt;
    const respawnAt = matchesDefeat
      ? defeat.nextEligibleAt
      : adjustedExpiresAt + PIRATE_CONTACT_QUIET_MS;
    nextStartAt = respawnAt;
    return { ...schedule, startAt, expiresAt: adjustedExpiresAt, respawnAt };
  });
}
