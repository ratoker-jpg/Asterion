import type { UniverseCoordinate } from '../universe/types.ts';
import { COMBAT_TECHNOLOGY_IDS, type CombatTechnologyId } from '../combat/technologies.ts';
import { PIRATE_BASE_SHIPS, PIRATE_SHIP_IDS, type PirateShipId } from './catalog.ts';
import {
  expectedPirateTierShares,
  pirateLevelForResourcePoints,
  pirateTechnologyLevelForResourcePoints,
  PIRATE_EXCLUSIVE_TECHNOLOGIES,
  type PirateProfile,
} from './profile.ts';
import { pirateContactCycleKey } from './contact-rules.ts';

export const PIRATE_OPERATIONS_STATE_VERSION = 1 as const;
export const MAX_PIRATE_CONTACT_CYCLES_PER_SYSTEM = 1;

export type PirateRaidRollSnapshot = Readonly<{
  checkedAt: number;
  seed: string;
  success: boolean;
  targetPlanetId?: string;
  flightRequestId?: string;
  flightId?: string;
}>;

export type PirateReconReportSnapshot = Readonly<{
  id: string;
  ownerId: string;
  contactCycleKey: string;
  createdAt: number;
  roll: number;
  fullReport: boolean;
  profile?: PirateProfile;
}>;

export const PIRATE_MISSING_TARGET_REPORT_TEXT = 'По указанным координатам планеты пиратов не обнаружено';

export type PirateFlightNoticeSnapshot = Readonly<{
  id: string;
  ownerId: string;
  flightId: string;
  contactCycleKey: string;
  createdAt: number;
  coordinate: UniverseCoordinate;
  kind: 'target-missing';
  message: typeof PIRATE_MISSING_TARGET_REPORT_TEXT;
}>;

export type PirateReconFlightReference = Readonly<{
  requestId: string;
  flightId?: string;
  dispatchedAt: number;
}>;

export type PirateReconState = Readonly<{
  cooldownUntil: number;
  inFlight?: PirateReconFlightReference;
  reports: readonly PirateReconReportSnapshot[];
}>;

export type PirateOwnerContactState = Readonly<{
  profile?: PirateProfile;
  raidRoll?: PirateRaidRollSnapshot;
  recon?: PirateReconState;
}>;

export type PirateContactCycleSnapshot = Readonly<{
  cycleKey: string;
  cycleIndex: number;
  coordinate: UniverseCoordinate;
  startedAt: number;
  expiresAt: number;
  respawnAt: number;
  defeatedAt?: number;
  ownersById: Readonly<Record<string, PirateOwnerContactState>>;
}>;

export type PirateScheduleOverride = Readonly<{
  galaxy: number;
  system: number;
  defeatedCycleIndex: number;
  defeatedAt: number;
  nextCycleIndex: number;
  nextStartAt: number;
  nextSpawnChance: number;
}>;

export type PirateOperationsState = Readonly<{
  version: typeof PIRATE_OPERATIONS_STATE_VERSION;
  /** Last timestamp whose pirate lifecycle checkpoints have been applied. */
  reconciledThrough: number;
  cyclesByKey: Readonly<Record<string, PirateContactCycleSnapshot>>;
  scheduleOverridesBySystem: Readonly<Record<string, PirateScheduleOverride>>;
  /** Archived reports stay readable after their contact cycle is pruned. */
  reconReports: readonly PirateReconReportSnapshot[];
  /** Saved non-combat mission outcomes, such as an elimination flight reaching an expired cycle. */
  flightNotices: readonly PirateFlightNoticeSnapshot[];
}>;

const MAX_KEY_LENGTH = 192;
const MAX_REPORTS_PER_CYCLE_OWNER = 128;
const MAX_EXPECTED_SHARE_ERROR = 1e-6;

export function createDefaultPirateOperationsState(now = 0): PirateOperationsState {
  const reconciledThrough = Number.isFinite(now) ? Math.max(0, Math.floor(now)) : 0;
  return {
    version: PIRATE_OPERATIONS_STATE_VERSION,
    reconciledThrough,
    cyclesByKey: {},
    scheduleOverridesBySystem: {},
    reconReports: [],
    flightNotices: [],
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isKey(value: unknown): value is string {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= MAX_KEY_LENGTH
    && /^[A-Za-z0-9:_-]+$/.test(value)
    && value !== '__proto__'
    && value !== 'constructor'
    && value !== 'prototype';
}

function isSeed(value: unknown): value is string {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= 512
    && !/[\u0000-\u001f\u007f]/.test(value);
}

function isSafeNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function isFiniteNonNegative(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function isPercent(value: unknown): value is number {
  return isFiniteNonNegative(value) && value <= 100;
}

function normalizeCoordinate(value: unknown): UniverseCoordinate | undefined {
  if (!isRecord(value)
    || !isSafeNonNegativeInteger(value.galaxy) || value.galaxy < 1
    || !isSafeNonNegativeInteger(value.system) || value.system < 1
    || !isSafeNonNegativeInteger(value.position) || value.position < 1) return undefined;
  return { galaxy: value.galaxy, system: value.system, position: value.position };
}

function sumIs100(values: readonly number[]): boolean {
  return Math.abs(values.reduce((sum, value) => sum + value, 0) - 100) <= MAX_EXPECTED_SHARE_ERROR;
}

function normalizePirateProfile(value: unknown, ownerId: string, cycleKey: string): PirateProfile | undefined {
  if (!isRecord(value)
    || value.profileVersion !== 1
    || value.ownerId !== ownerId
    || value.contactCycleKey !== cycleKey
    || !isSeed(value.seed)
    || value.seed !== JSON.stringify([ownerId, cycleKey])
    || !isRecord(value.score)
    || !isFiniteNonNegative(value.score.resourcePoints)
    || !isFiniteNonNegative(value.score.battlePoints)
    || !isFiniteNonNegative(value.score.totalPoints)
    || Math.abs(value.score.totalPoints - value.score.resourcePoints - value.score.battlePoints) > 1e-6
    || !isSafeNonNegativeInteger(value.shipLevel) || value.shipLevel > 10
    || !isSafeNonNegativeInteger(value.technologyLevel) || value.technologyLevel > 10
    || !PIRATE_EXCLUSIVE_TECHNOLOGIES.includes(value.exclusiveTechnologyId as (typeof PIRATE_EXCLUSIVE_TECHNOLOGIES)[number])
    || !isRecord(value.technologies)
    || !isRecord(value.expectedTierShares)
    || !isSafeNonNegativeInteger(value.tier)
    || value.tier < 1 || value.tier > 3
    || !isRecord(value.shares)) return undefined;

  const technologies: Partial<Record<CombatTechnologyId, number>> = {};
  for (const id of COMBAT_TECHNOLOGY_IDS) {
    const level = value.technologies[id];
    if (!isSafeNonNegativeInteger(level) || level > 10) return undefined;
    technologies[id] = level;
  }
  if (Object.keys(value.technologies).some((key) => !COMBAT_TECHNOLOGY_IDS.includes(key as CombatTechnologyId))) return undefined;

  const tierShares: Record<1 | 2 | 3, number> = { 1: Number.NaN, 2: Number.NaN, 3: Number.NaN };
  for (const tier of [1, 2, 3] as const) {
    const share = value.expectedTierShares[tier];
    if (!isPercent(share)) return undefined;
    tierShares[tier] = share;
  }
  if (Object.keys(value.expectedTierShares).some((key) => !['1', '2', '3'].includes(key))
    || !sumIs100([tierShares[1], tierShares[2], tierShares[3]])) return undefined;
  const expectedTierShares = expectedPirateTierShares(value.score.totalPoints);
  if ([1, 2, 3].some((tier) => Math.abs(tierShares[tier as 1 | 2 | 3] - expectedTierShares[tier as 1 | 2 | 3]) > MAX_EXPECTED_SHARE_ERROR)) return undefined;

  const shares: Partial<Record<PirateShipId, number>> = {};
  for (const id of PIRATE_SHIP_IDS) {
    const share = value.shares[id];
    if (!isPercent(share)) return undefined;
    shares[id] = share;
  }
  if (Object.keys(value.shares).some((key) => !PIRATE_SHIP_IDS.includes(key as PirateShipId))
    || !sumIs100(PIRATE_SHIP_IDS.map((id) => shares[id]!))) return undefined;

  const selected = PIRATE_BASE_SHIPS.find((ship) => shares[ship.id] === 100);
  if (!selected
    || selected.tier !== value.tier
    || value.shipLevel !== pirateLevelForResourcePoints(value.score.resourcePoints)
    || value.technologyLevel !== pirateTechnologyLevelForResourcePoints(value.score.resourcePoints)
    || COMBAT_TECHNOLOGY_IDS.some((id) => technologies[id] !== (PIRATE_EXCLUSIVE_TECHNOLOGIES.includes(id as (typeof PIRATE_EXCLUSIVE_TECHNOLOGIES)[number])
      ? id === value.exclusiveTechnologyId ? value.technologyLevel : 0
      : value.technologyLevel))
    || PIRATE_SHIP_IDS.some((id) => id !== selected.id && shares[id] !== 0)) return undefined;

  return {
    profileVersion: 1,
    ownerId,
    contactCycleKey: cycleKey,
    seed: value.seed,
    score: {
      resourcePoints: value.score.resourcePoints,
      battlePoints: value.score.battlePoints,
      totalPoints: value.score.totalPoints,
    },
    shipLevel: value.shipLevel,
    technologyLevel: value.technologyLevel,
    exclusiveTechnologyId: value.exclusiveTechnologyId as PirateProfile['exclusiveTechnologyId'],
    technologies: technologies as Record<CombatTechnologyId, number>,
    expectedTierShares,
    tier: value.tier as PirateProfile['tier'],
    shares: shares as Record<PirateShipId, number>,
  };
}

/** Validates a flight/report profile snapshot independently of its contact ledger entry. */
export function normalizePirateProfileSnapshot(value: unknown): PirateProfile | undefined {
  if (!isRecord(value) || !isKey(value.ownerId) || !isKey(value.contactCycleKey)) return undefined;
  return normalizePirateProfile(value, value.ownerId, value.contactCycleKey);
}

function normalizeReport(value: unknown, ownerId: string, cycleKey: string): PirateReconReportSnapshot | undefined {
  if (!isRecord(value)
    || !isKey(value.id)
    || value.ownerId !== ownerId
    || value.contactCycleKey !== cycleKey
    || !isSafeNonNegativeInteger(value.createdAt)
    || !isSafeNonNegativeInteger(value.roll) || value.roll > 99
    || typeof value.fullReport !== 'boolean'
    || value.fullReport !== (value.roll < 70)) return undefined;
  if (value.fullReport) {
    const profile = normalizePirateProfile(value.profile, ownerId, cycleKey);
    if (!profile) return undefined;
    return { id: value.id, ownerId, contactCycleKey: cycleKey, createdAt: value.createdAt, roll: value.roll, fullReport: true, profile };
  }
  if (value.profile !== undefined) return undefined;
  return { id: value.id, ownerId, contactCycleKey: cycleKey, createdAt: value.createdAt, roll: value.roll, fullReport: false };
}

function normalizeFlightNotice(value: unknown): PirateFlightNoticeSnapshot | undefined {
  if (!isRecord(value)
    || !isKey(value.id)
    || !isKey(value.ownerId)
    || !isKey(value.flightId)
    || !isKey(value.contactCycleKey)
    || !isSafeNonNegativeInteger(value.createdAt)
    || value.kind !== 'target-missing'
    || value.message !== PIRATE_MISSING_TARGET_REPORT_TEXT) return undefined;
  const coordinate = normalizeCoordinate(value.coordinate);
  const cycleParts = /^pirate-contact:v1:(\d+):(\d+):(\d+)$/.exec(value.contactCycleKey);
  if (!coordinate || !cycleParts
    || value.contactCycleKey !== pirateContactCycleKey(Number(cycleParts[1]), Number(cycleParts[2]), Number(cycleParts[3]))
    || value.id !== `pirate-flight:${value.flightId}:target-missing`) return undefined;
  return {
    id: value.id,
    ownerId: value.ownerId,
    flightId: value.flightId,
    contactCycleKey: value.contactCycleKey,
    createdAt: value.createdAt,
    coordinate,
    kind: 'target-missing',
    message: PIRATE_MISSING_TARGET_REPORT_TEXT,
  };
}

function normalizeOwnerState(value: unknown, ownerId: string, cycleKey: string): PirateOwnerContactState | undefined {
  if (!isRecord(value)) return undefined;
  const profile = value.profile === undefined ? undefined : normalizePirateProfile(value.profile, ownerId, cycleKey);
  if (value.profile !== undefined && !profile) return undefined;

  let raidRoll: PirateRaidRollSnapshot | undefined;
  if (value.raidRoll !== undefined) {
    const raid = value.raidRoll;
    if (!isRecord(raid)
      || !isSafeNonNegativeInteger(raid.checkedAt)
      || !isSeed(raid.seed)
      || typeof raid.success !== 'boolean'
      || (raid.targetPlanetId !== undefined && !isKey(raid.targetPlanetId))
      || (raid.flightRequestId !== undefined && !isKey(raid.flightRequestId))
      || (raid.flightId !== undefined && !isKey(raid.flightId))
      || (raid.success ? (!profile || !isKey(raid.targetPlanetId) || !isKey(raid.flightRequestId)) : (raid.targetPlanetId !== undefined || raid.flightRequestId !== undefined || raid.flightId !== undefined))) return undefined;
    raidRoll = {
      checkedAt: raid.checkedAt,
      seed: raid.seed,
      success: raid.success,
      ...(raid.targetPlanetId ? { targetPlanetId: raid.targetPlanetId } : {}),
      ...(raid.flightRequestId ? { flightRequestId: raid.flightRequestId } : {}),
      ...(raid.flightId ? { flightId: raid.flightId } : {}),
    };
  }

  let recon: PirateReconState | undefined;
  if (value.recon !== undefined) {
    const input = value.recon;
    if (!isRecord(input) || !isSafeNonNegativeInteger(input.cooldownUntil) || !Array.isArray(input.reports)) return undefined;
    let inFlight: PirateReconFlightReference | undefined;
    if (input.inFlight !== undefined) {
      const flight = input.inFlight;
      if (!isRecord(flight)
        || !isKey(flight.requestId)
        || !isSafeNonNegativeInteger(flight.dispatchedAt)
        || (flight.flightId !== undefined && !isKey(flight.flightId))) return undefined;
      inFlight = {
        requestId: flight.requestId,
        dispatchedAt: flight.dispatchedAt,
        ...(flight.flightId ? { flightId: flight.flightId } : {}),
      };
    }
    const reportsById = new Map<string, PirateReconReportSnapshot>();
    input.reports
      .map((report) => normalizeReport(report, ownerId, cycleKey))
      .filter((report): report is PirateReconReportSnapshot => report !== undefined)
      .forEach((report) => reportsById.set(report.id, report));
    const reports = [...reportsById.values()]
      .sort((left, right) => left.createdAt - right.createdAt || left.id.localeCompare(right.id))
      .slice(-MAX_REPORTS_PER_CYCLE_OWNER);
    recon = { cooldownUntil: input.cooldownUntil, ...(inFlight ? { inFlight } : {}), reports };
  }

  if (!profile && !raidRoll && !recon) return undefined;
  return { ...(profile ? { profile } : {}), ...(raidRoll ? { raidRoll } : {}), ...(recon ? { recon } : {}) };
}

function systemKey(galaxy: number, system: number) {
  return `${galaxy}:${system}`;
}

function normalizeCycle(value: unknown, cycleKey: string): PirateContactCycleSnapshot | undefined {
  if (!isRecord(value)
    || value.cycleKey !== cycleKey
    || !isSafeNonNegativeInteger(value.cycleIndex)) return undefined;
  const coordinate = normalizeCoordinate(value.coordinate);
  if (!coordinate) return undefined;
  let canonicalKey: string;
  try {
    canonicalKey = pirateContactCycleKey(coordinate.galaxy, coordinate.system, value.cycleIndex);
  } catch {
    return undefined;
  }
  if (canonicalKey !== cycleKey
    || !isSafeNonNegativeInteger(value.startedAt)
    || !isSafeNonNegativeInteger(value.expiresAt)
    || !isSafeNonNegativeInteger(value.respawnAt)
    || value.expiresAt < value.startedAt
    || value.respawnAt < value.expiresAt
    || (value.defeatedAt !== undefined && (!isSafeNonNegativeInteger(value.defeatedAt) || value.defeatedAt < value.startedAt || value.defeatedAt > value.respawnAt))
    || !isRecord(value.ownersById)) return undefined;

  const ownersById: Record<string, PirateOwnerContactState> = {};
  for (const [ownerId, ownerValue] of Object.entries(value.ownersById)) {
    if (!isKey(ownerId)) continue;
    const owner = normalizeOwnerState(ownerValue, ownerId, cycleKey);
    if (owner) ownersById[ownerId] = owner;
  }
  return {
    cycleKey,
    cycleIndex: value.cycleIndex,
    coordinate,
    startedAt: value.startedAt,
    expiresAt: value.expiresAt,
    respawnAt: value.respawnAt,
    ...(value.defeatedAt !== undefined ? { defeatedAt: value.defeatedAt } : {}),
    ownersById,
  };
}

function normalizeScheduleOverride(value: unknown, key: string): PirateScheduleOverride | undefined {
  if (!isRecord(value)
    || !isSafeNonNegativeInteger(value.galaxy) || value.galaxy < 1
    || !isSafeNonNegativeInteger(value.system) || value.system < 1
    || key !== systemKey(value.galaxy, value.system)
    || !isSafeNonNegativeInteger(value.defeatedCycleIndex)
    || !isSafeNonNegativeInteger(value.defeatedAt)
    || !isSafeNonNegativeInteger(value.nextCycleIndex)
    || value.nextCycleIndex !== value.defeatedCycleIndex + 1
    || !isSafeNonNegativeInteger(value.nextStartAt)
    || value.nextStartAt < value.defeatedAt
    || !isFiniteNonNegative(value.nextSpawnChance)
    || value.nextSpawnChance > 1) return undefined;
  return {
    galaxy: value.galaxy,
    system: value.system,
    defeatedCycleIndex: value.defeatedCycleIndex,
    defeatedAt: value.defeatedAt,
    nextCycleIndex: value.nextCycleIndex,
    nextStartAt: value.nextStartAt,
    nextSpawnChance: value.nextSpawnChance,
  };
}

/** Strictly normalizes a serialized pirate ledger. Legacy, unknown, or malformed roots become an empty v1 ledger. */
export function migratePirateOperationsState(value: unknown, fallbackReconciledThrough = 0): PirateOperationsState {
  if (!isRecord(value) || value.version !== PIRATE_OPERATIONS_STATE_VERSION
    || !isRecord(value.cyclesByKey) || !isRecord(value.scheduleOverridesBySystem)) {
    return createDefaultPirateOperationsState(fallbackReconciledThrough);
  }

  const newestCycleBySystem = new Map<string, PirateContactCycleSnapshot>();
  for (const [key, rawCycle] of Object.entries(value.cyclesByKey)) {
    if (!isKey(key)) continue;
    const cycle = normalizeCycle(rawCycle, key);
    if (!cycle) continue;
    const keyForSystem = systemKey(cycle.coordinate.galaxy, cycle.coordinate.system);
    const previous = newestCycleBySystem.get(keyForSystem);
    if (!previous || cycle.cycleIndex > previous.cycleIndex
      || (cycle.cycleIndex === previous.cycleIndex && cycle.startedAt > previous.startedAt)) {
      newestCycleBySystem.set(keyForSystem, cycle);
    }
  }

  const scheduleOverridesBySystem: Record<string, PirateScheduleOverride> = {};
  for (const [key, rawOverride] of Object.entries(value.scheduleOverridesBySystem)) {
    if (!isKey(key)) continue;
    const override = normalizeScheduleOverride(rawOverride, key);
    if (override) scheduleOverridesBySystem[key] = override;
  }

  const archivedReportsById = new Map<string, PirateReconReportSnapshot>();
  const addReport = (report: PirateReconReportSnapshot) => archivedReportsById.set(report.id, report);
  if (Array.isArray(value.reconReports)) {
    for (const rawReport of value.reconReports) {
      if (!isRecord(rawReport)) continue;
      const report = normalizeReport(rawReport, String(rawReport.ownerId ?? ''), String(rawReport.contactCycleKey ?? ''));
      if (report) addReport(report);
    }
  }
  for (const cycle of newestCycleBySystem.values()) {
    for (const [ownerId, owner] of Object.entries(cycle.ownersById)) {
      for (const report of owner.recon?.reports ?? []) addReport(report);
    }
  }
  const reconReports = [...archivedReportsById.values()]
    .sort((left, right) => left.createdAt - right.createdAt || left.id.localeCompare(right.id))
    .slice(-2_000);
  const flightNoticesById = new Map<string, PirateFlightNoticeSnapshot>();
  if (Array.isArray(value.flightNotices)) {
    for (const rawNotice of value.flightNotices) {
      const notice = normalizeFlightNotice(rawNotice);
      if (notice) flightNoticesById.set(notice.id, notice);
    }
  }
  const flightNotices = [...flightNoticesById.values()]
    .sort((left, right) => left.createdAt - right.createdAt || left.id.localeCompare(right.id))
    .slice(-2_000);
  const reconciledThrough = isSafeNonNegativeInteger(value.reconciledThrough)
    ? value.reconciledThrough
    : Math.max(0, Math.floor(Number.isFinite(fallbackReconciledThrough) ? fallbackReconciledThrough : 0));

  return {
    version: PIRATE_OPERATIONS_STATE_VERSION,
    reconciledThrough,
    cyclesByKey: Object.fromEntries([...newestCycleBySystem.values()].map((cycle) => [cycle.cycleKey, cycle])),
    scheduleOverridesBySystem,
    reconReports,
    flightNotices,
  };
}
