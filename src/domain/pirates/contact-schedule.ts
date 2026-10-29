import type { UniverseCoordinate } from '../universe/types.ts';

export const PIRATE_CONTACT_MIN_LIFETIME_MS = 45 * 60 * 1_000;
export const PIRATE_CONTACT_MAX_LIFETIME_MS = 75 * 60 * 1_000;
export const PIRATE_CONTACT_QUIET_MS = 15 * 60 * 1_000;

/** Exactly one roll, fifteen minutes after a newly spawned contact. */
export const PIRATE_RAID_CHECK_INTERVAL_MS = 15 * 60 * 1_000;

export function getPirateRaidCheckProgress(cycleStartAt: number, nowMs: number, checkDelayMs = PIRATE_RAID_CHECK_INTERVAL_MS): {
  remainingMs: number;
  percent: number;
  nextAt: number;
} {
  const start = Number.isFinite(cycleStartAt) ? Math.floor(cycleStartAt) : 0;
  const now = Number.isFinite(nowMs) ? Math.floor(nowMs) : start;
  const delay = Number.isFinite(checkDelayMs) && checkDelayMs > 0
    ? Math.floor(checkDelayMs) : PIRATE_RAID_CHECK_INTERVAL_MS;
  const nextAt = start + delay;
  const elapsed = Math.max(0, now - start);
  return {
    remainingMs: Math.max(0, nextAt - now),
    percent: Math.max(0, Math.min(100, Math.floor(elapsed / delay * 100))),
    nextAt,
  };
}


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

// Defeat records are immutable once saved; every system render re-reads all of
// them, so each record object's validity is computed once.
const validDefeatRecords = new WeakMap<object, boolean>();

function isValidDefeatRecordCached(record: PirateContactDefeatRecord): boolean {
  if (!isRecord(record)) return false;
  const cached = validDefeatRecords.get(record);
  if (cached !== undefined) return cached;
  const valid = isValidPirateContactDefeatRecord(record);
  validDefeatRecords.set(record, valid);
  return valid;
}

// The shifted sequence is a pure function of the (append-only) base cycles and
// this system's defeats. Re-deriving every cycle since the epoch on each system
// render dominated NPC decisions, so the latest few results per base are kept.
const shiftedScheduleCache = new WeakMap<object, Map<string, readonly PirateScheduleCycle[]>>();
const shiftedByInputs = new WeakMap<object, WeakMap<object, { galaxy: number; system: number; shifted: readonly PirateScheduleCycle[] }>>();

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
  // The same schedule array and defeats list (callers keep both while
  // nothing changes): the answer is the one computed last time.
  const byDefeats = shiftedByInputs.get(schedules);
  const known = byDefeats?.get(defeats);
  if (known && known.galaxy === galaxy && known.system === system) return known.shifted as T[];
  const records = new Map<string, PirateContactDefeatRecord>();
  for (const record of defeats) {
    if (record.galaxy !== galaxy || record.system !== system || !isValidDefeatRecordCached(record)) continue;
    const previous = records.get(record.contactCycleKey);
    if (!previous || record.defeatedAt < previous.defeatedAt) records.set(record.contactCycleKey, record);
  }
  const signature = `${galaxy}:${system}:${schedules.length}:${[...records.values()]
    .map((record) => `${record.contactCycleKey}@${record.defeatedAt}`).sort().join('|')}`;
  let bySignature = shiftedScheduleCache.get(schedules);
  const remember = (shifted: readonly PirateScheduleCycle[]) => {
    let inputs = shiftedByInputs.get(schedules);
    if (!inputs) shiftedByInputs.set(schedules, inputs = new WeakMap());
    inputs.set(defeats, { galaxy, system, shifted });
  };
  const cached = bySignature?.get(signature);
  if (cached) { remember(cached); return cached as T[]; }
  let nextStartAt: number | undefined;
  const shifted = schedules.map((schedule) => {
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
  if (!bySignature) { bySignature = new Map(); shiftedScheduleCache.set(schedules, bySignature); }
  if (bySignature.size >= 8) bySignature.clear();
  bySignature.set(signature, shifted);
  remember(shifted);
  return shifted;
}
