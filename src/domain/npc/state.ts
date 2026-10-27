import { isNpcGrudge } from './grudges.ts';
import { isCommanderId } from '../combat/commanders.ts';
import { createSeededRandom, randomInteger } from '../world/random.ts';
import {
  NPC_STATE_VERSION,
  type NpcActivityState,
  type NpcEventCursor,
  type NpcKnowledge,
  type NpcLongTermGoal,
  type NpcMemory,
  type NpcPlanningState,
  type NpcProfile,
  type NpcSessionState,
  type NpcStateV1,
  type NpcTraitName,
} from './types.ts';

export const NPC_TRAIT_NAMES: readonly NpcTraitName[] = Object.freeze([
  'economyFocus', 'scienceFocus', 'militaryFocus', 'expansionFocus',
  'operationsInterest', 'cooperation', 'aggression', 'riskTolerance',
  'planningHorizon', 'mechanicsKnowledge', 'adaptability', 'persistence',
  'socialStyle', 'attention',
]);

const MIN_TIMEZONE_OFFSET_MINUTES = -12 * 60;
const MAX_TIMEZONE_OFFSET_MINUTES = 14 * 60;

/** Create stable owner-keyed profiles. Owner list order and public names are irrelevant. */
export function createNpcState(ownerIds: readonly string[], personaSalt: string, at: number): NpcStateV1 {
  assertOwnerIds(ownerIds);
  assertSalt(personaSalt);
  assertTimestamp(at, 'at');
  const profiles: Record<string, NpcProfile> = Object.create(null) as Record<string, NpcProfile>;
  for (const ownerId of [...ownerIds].sort(compareStableIds)) profiles[ownerId] = createNpcProfile(ownerId, personaSalt, at);
  stratifyNpcPopulation(profiles, personaSalt);
  return Object.freeze({ version: NPC_STATE_VERSION, personaSalt, profiles: Object.freeze(profiles) });
}

/**
 * Owner rule (24.10.2026): whatever the number of NPCs, a new campaign keeps
 * the intended mix of how much they play and, independently, how well they
 * decide. Each of the two is spread evenly over its range in a private
 * seeded order (one slot per owner, jittered inside it), so seven NPCs get
 * the same proportions as a hundred and activity says nothing about skill.
 */
function stratifyNpcPopulation(profiles: Record<string, NpcProfile>, personaSalt: string): void {
  const ownerIds = Object.keys(profiles);
  if (ownerIds.length < 2) return;
  const spread = (axis: string): Map<string, number> => {
    const key = (ownerId: string) => createSeededRandom(JSON.stringify(['npc-population:v1', personaSalt, axis, ownerId]))();
    const order = [...ownerIds].sort((left, right) => key(left) - key(right) || compareStableIds(left, right));
    return new Map(order.map((ownerId, slot) => {
      const jitter = 0.1 + 0.8 * createSeededRandom(JSON.stringify(['npc-population-jitter:v1', personaSalt, axis, ownerId]))();
      return [ownerId, (slot + jitter) / order.length];
    }));
  };
  const activity = spread('activity');
  const skill = spread('skill');
  for (const ownerId of ownerIds) {
    const profile = profiles[ownerId]!;
    profiles[ownerId] = Object.freeze({
      ...profile,
      traits: Object.freeze({ ...profile.traits, mechanicsKnowledge: skill.get(ownerId)! }),
      activity: Object.freeze({ ...profile.activity, propensity: activity.get(ownerId)! }),
    });
  }
}

/**
 * Migrate an absent/legacy state and add currently represented owners while
 * retaining valid orphan profiles, cursors, and the previously persisted salt.
 * A malformed present v1 state is rejected rather than regenerated.
 */
export function migrateNpcState(value: unknown, ownerIds: readonly string[], fallbackSalt: string, at: number): NpcStateV1 {
  assertOwnerIds(ownerIds);
  assertTimestamp(at, 'at');
  if (value === undefined) {
    assertSalt(fallbackSalt, 'fallbackSalt');
    return createNpcState(ownerIds, fallbackSalt, at);
  }
  if (!isRecord(value)) throw new TypeError('NPC state must be an object');

  const version = value.version;
  if (typeof version === 'number' && version > NPC_STATE_VERSION) {
    throw new RangeError('Unsupported future NPC state version: ' + version);
  }
  if (version !== NPC_STATE_VERSION) {
    throw new RangeError('Unsupported NPC state version: ' + String(version));
  }

  if (!validateNpcState(value)) throw new TypeError('Malformed NPC state version 1');
  const state = value;
  const profiles: Record<string, NpcProfile> = Object.create(null) as Record<string, NpcProfile>;
  // Existing records come first so owner order does not disturb serialized history.
  for (const ownerId of Object.keys(state.profiles).sort(compareStableIds)) profiles[ownerId] = state.profiles[ownerId]!;
  for (const ownerId of [...ownerIds].sort(compareStableIds)) {
    if (!profiles[ownerId]) profiles[ownerId] = createNpcProfile(ownerId, state.personaSalt, at);
  }
  return Object.freeze({ version: NPC_STATE_VERSION, personaSalt: state.personaSalt, profiles: Object.freeze(profiles) });
}

/** Strict save-health predicate; malformed v1 data must not be silently replaced. */
export function validateNpcState(value: unknown): value is NpcStateV1 {
  if (!isRecord(value) || value.version !== NPC_STATE_VERSION || typeof value.personaSalt !== 'string'
    || value.personaSalt.length === 0 || !isRecord(value.profiles)) return false;
  for (const [ownerId, profile] of Object.entries(value.profiles)) {
    if (!ownerId || !isNpcProfile(profile) || profile.ownerId !== ownerId) return false;
  }
  return true;
}

export function isNpcProfile(value: unknown): value is NpcProfile {
  if (!isRecord(value) || typeof value.ownerId !== 'string' || value.ownerId.length === 0
    || typeof value.privateSeed !== 'string' || value.privateSeed.length === 0) return false;
  const traits = value.traits;
  if (!isRecord(traits) || !NPC_TRAIT_NAMES.every((trait) => inUnitRange(traits[trait]))
    || !isKnowledge(value.knowledge) || !isPlanning(value.planning) || !Array.isArray(value.memory)
    || !value.memory.every(isMemoryEntry) || !Array.isArray(value.longTermGoals)
    || !value.longTermGoals.every(isGoal) || !isActivity(value.activity) || !isSession(value.session)
    || !isCursor(value.cursor)
    || (value.campaignStartedAt !== undefined && !isTimestamp(value.campaignStartedAt))
    || (value.grudges !== undefined && (!isRecord(value.grudges) || !Object.entries(value.grudges)
      .every(([offenderId, grudge]) => offenderId.length > 0 && isNpcGrudge(grudge))))
    || (value.combatPriority !== undefined && (!isRecord(value.combatPriority)
      || !isCommanderOrder(value.combatPriority.attack) || !isCommanderOrder(value.combatPriority.defense)))) return false;
  return true;
}

function createNpcProfile(ownerId: string, personaSalt: string, at: number): NpcProfile {
  const random = createSeededRandom(JSON.stringify(['npc-persona-v1', personaSalt, ownerId]));
  const traits = Object.create(null) as Record<NpcTraitName, number>;
  for (const trait of NPC_TRAIT_NAMES) traits[trait] = random();
  // Mildly correlate planning/learning traits while retaining continuous variation.
  const planningFactor = random();
  traits.planningHorizon = average(traits.planningHorizon, planningFactor);
  traits.persistence = average(traits.persistence, planningFactor);
  traits.mechanicsKnowledge = average(traits.mechanicsKnowledge, traits.attention);
  const privateSeed = Math.floor(random() * 0x1_0000_0000).toString(36);
  const timezoneOffsetMinutes = randomInteger(random, -12 * 4, 14 * 4) * 15;
  const knowledge: NpcKnowledge = Object.freeze({});
  const planning: NpcPlanningState = Object.freeze({
    horizon: traits.planningHorizon,
    commitment: traits.persistence,
    reconsiderAt: null,
  });
  const memory: NpcMemory = Object.freeze([]);
  const longTermGoals: readonly NpcLongTermGoal[] = Object.freeze([]);
  const activity: NpcActivityState = Object.freeze({ propensity: random(), completedSessions: 0, missedSessions: 0, updatedAt: at });
  const session: NpcSessionState = Object.freeze({
    timezoneOffsetMinutes,
    active: false,
    sessionStartedAt: null,
    sessionEndsAt: null,
    lastBoundaryAt: null,
  });
  return Object.freeze({
    ownerId,
    privateSeed,
    traits: Object.freeze(traits),
    knowledge,
    planning,
    memory,
    longTermGoals,
    activity,
    session,
    cursor: null,
    campaignStartedAt: at,
  });
}

function isPlanning(value: unknown): value is NpcPlanningState {
  return isRecord(value) && inUnitRange(value.horizon) && inUnitRange(value.commitment)
    && (value.reconsiderAt === null || isTimestamp(value.reconsiderAt));
}
function isKnowledge(value: unknown): value is NpcKnowledge {
  return isRecord(value) && Object.values(value).every((entry) => isRecord(entry)
    && inUnitRange(entry.level) && inUnitRange(entry.confidence) && isTimestamp(entry.observedAt));
}
function isActivity(value: unknown): value is NpcActivityState {
  return isRecord(value) && inUnitRange(value.propensity) && isCount(value.completedSessions)
    && isCount(value.missedSessions) && isTimestamp(value.updatedAt);
}
function isSession(value: unknown): value is NpcSessionState {
  return isRecord(value) && Number.isSafeInteger(value.timezoneOffsetMinutes)
    && Number(value.timezoneOffsetMinutes) >= MIN_TIMEZONE_OFFSET_MINUTES
    && Number(value.timezoneOffsetMinutes) <= MAX_TIMEZONE_OFFSET_MINUTES
    && typeof value.active === 'boolean'
    && isNullableTimestamp(value.sessionStartedAt) && isNullableTimestamp(value.sessionEndsAt)
    && isNullableTimestamp(value.lastBoundaryAt)
    && (value.idleUntil === undefined || isTimestamp(value.idleUntil))
    && (value.active
      ? isTimestamp(value.sessionStartedAt) && isTimestamp(value.sessionEndsAt) && value.sessionEndsAt >= value.sessionStartedAt
      : value.sessionStartedAt === null && value.sessionEndsAt === null);
}
function isCursor(value: unknown): value is NpcEventCursor | null {
  return value === null || (isRecord(value) && isTimestamp(value.at)
    && ['game-timer-completion', 'fleet-arrival', 'npc-session-boundary', 'npc-decision'].includes(String(value.priority))
    && typeof value.eventId === 'string' && value.eventId.length > 0);
}
function isMemoryEntry(value: unknown): value is NpcMemory[number] {
  return isRecord(value) && typeof value.id === 'string' && value.id.length > 0
    && typeof value.kind === 'string' && value.kind.length > 0 && isTimestamp(value.at)
    && inUnitRange(value.valence) && inUnitRange(value.salience)
    && Array.isArray(value.factIds) && value.factIds.every((id) => typeof id === 'string');
}
function isGoal(value: unknown): value is NpcLongTermGoal {
  return isRecord(value) && typeof value.id === 'string' && value.id.length > 0
    && typeof value.kind === 'string' && value.kind.length > 0 && isTimestamp(value.createdAt)
    && inUnitRange(value.priority) && ['active', 'paused', 'completed', 'abandoned'].includes(String(value.status))
    && inUnitRange(value.progress);
}
function isCommanderOrder(value: unknown): boolean {
  return Array.isArray(value) && new Set(value).size === value.length && value.every((id) => isCommanderId(id));
}
function inUnitRange(value: unknown): value is number { return isFiniteNumber(value) && value >= 0 && value <= 1; }
function isFiniteNumber(value: unknown): value is number { return typeof value === 'number' && Number.isFinite(value); }
function isTimestamp(value: unknown): value is number { return Number.isSafeInteger(value); }
function isNullableTimestamp(value: unknown): value is number | null { return value === null || isTimestamp(value); }
function isCount(value: unknown): value is number { return Number.isSafeInteger(value) && Number(value) >= 0; }
function isRecord(value: unknown): value is Record<string, unknown> { return !!value && typeof value === 'object' && !Array.isArray(value); }
function assertOwnerIds(ownerIds: readonly string[]): void {
  if (!Array.isArray(ownerIds) || ownerIds.some((ownerId) => typeof ownerId !== 'string' || ownerId.trim() === '')) {
    throw new TypeError('ownerIds must contain non-empty strings');
  }
  if (new Set(ownerIds).size !== ownerIds.length) throw new TypeError('ownerIds must be unique');
}
function assertSalt(salt: string, name = 'personaSalt'): void {
  if (typeof salt !== 'string' || salt.trim() === '') throw new TypeError(name + ' must be a non-empty string');
}
function assertTimestamp(at: number, name: string): void {
  if (!Number.isSafeInteger(at)) throw new TypeError(name + ' must be a safe integer timestamp');
}
function average(left: number, right: number): number { return (left + right) / 2; }
function compareStableIds(left: string, right: string): number { return left < right ? -1 : left > right ? 1 : 0; }
