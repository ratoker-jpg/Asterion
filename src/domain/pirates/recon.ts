/** Time an owner must wait before dispatching another probe at one pirate cycle. */
export const PIRATE_RECON_COOLDOWN_MS = 120_000;

export type PirateReconOutcome = 'success' | 'failure' | 'no-target';

/** Dispatch-time values that must be persisted with the pirate recon flight. */
export type PirateReconMissionSnapshot = Readonly<{
  missionId: string;
  ownerId: string;
  contactCycleKey: string;
  dispatchedAt: number;
  seed: string;
  roll: number;
}>;

export type PirateReconAvailability = Readonly<{
  allowed: boolean;
  reason?: 'in-flight' | 'cooldown';
  availableAt?: number;
}>;

export function pirateReconCooldownKey(ownerId: string, contactCycleKey: string): string {
  return JSON.stringify([ownerId, contactCycleKey]);
}

function hashSeed(seed: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function seededRandom(seed: string): number {
  let state = hashSeed(seed);
  state = (state + 0x6d2b79f5) >>> 0;
  let value = state;
  value = Math.imul(value ^ (value >>> 15), value | 1);
  value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
  return ((value ^ (value >>> 14)) >>> 0) / 0x1_0000_0000;
}

/**
 * Materialize the mission's only random draw at dispatch. Persist the entire
 * result with the flight so reload and arrival reconciliation never reroll it.
 */
export function createPirateReconMissionSnapshot(input: {
  missionId: string;
  ownerId: string;
  contactCycleKey: string;
  dispatchedAt: number;
}): PirateReconMissionSnapshot {
  if (!input.missionId.trim() || !input.ownerId.trim() || !input.contactCycleKey.trim()) {
    throw new Error('Pirate recon requires a mission, owner, and contact cycle identity.');
  }
  if (!Number.isFinite(input.dispatchedAt) || input.dispatchedAt < 0) {
    throw new Error('Pirate recon dispatch time must be a non-negative timestamp.');
  }
  const seed = JSON.stringify(['pirate-recon-v1', input.missionId, input.ownerId, input.contactCycleKey]);
  return Object.freeze({
    missionId: input.missionId,
    ownerId: input.ownerId,
    contactCycleKey: input.contactCycleKey,
    dispatchedAt: input.dispatchedAt,
    seed,
    roll: seededRandom(seed),
  });
}

/** Validate persisted flight data without drawing a new random value. */
export function normalizePirateReconMissionSnapshot(value: unknown): PirateReconMissionSnapshot | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.missionId !== 'string'
    || !candidate.missionId.trim()
    || typeof candidate.ownerId !== 'string'
    || !candidate.ownerId.trim()
    || typeof candidate.contactCycleKey !== 'string'
    || !candidate.contactCycleKey.trim()
    || typeof candidate.dispatchedAt !== 'number'
    || !Number.isSafeInteger(candidate.dispatchedAt)
    || candidate.dispatchedAt < 0) return null;
  const expected = createPirateReconMissionSnapshot({
    missionId: candidate.missionId,
    ownerId: candidate.ownerId,
    contactCycleKey: candidate.contactCycleKey,
    dispatchedAt: candidate.dispatchedAt,
  });
  if (candidate.seed !== expected.seed
    || typeof candidate.roll !== 'number'
    || candidate.roll !== expected.roll) return null;
  return expected;
}

/** A recon roll below this succeeds (70%). */
export const PIRATE_RECON_SUCCESS_THRESHOLD = 0.7;

export function pirateReconOutcomeForMission(mission: PirateReconMissionSnapshot): Exclude<PirateReconOutcome, 'no-target'> {
  return mission.roll < PIRATE_RECON_SUCCESS_THRESHOLD ? 'success' : 'failure';
}

/**
 * Checks the dispatch-time cooldown and an already persisted outbound mission.
 * The caller must perform this check and record the new dispatch atomically.
 */
export function canDispatchPirateRecon(input: {
  ownerId: string;
  contactCycleKey: string;
  now: number;
  lastDispatchAt?: number;
  inFlight: boolean;
}): PirateReconAvailability {
  if (input.inFlight) return Object.freeze({ allowed: false, reason: 'in-flight' });
  // A corrupt future timestamp must not reserve this owner/cycle forever.
  // Persisted mission state is bounded by the cycle lifetime at its boundary;
  // this guard keeps dispatch safe if an invalid value reaches the domain.
  if (input.lastDispatchAt !== undefined && input.lastDispatchAt <= input.now) {
    const availableAt = input.lastDispatchAt + PIRATE_RECON_COOLDOWN_MS;
    if (input.now < availableAt) return Object.freeze({ allowed: false, reason: 'cooldown', availableAt });
  }
  return Object.freeze({ allowed: true });
}
