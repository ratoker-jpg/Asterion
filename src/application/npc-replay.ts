import { getNextNpcEconomyCheckpoint, getNpcBuildingCandidates, startNpcBuilding } from './npc-economy.ts';
import { getNextNpcFleetProductionCheckpoint } from './npc-fleet-production.ts';
import { getNpcSessionEvents } from '../domain/npc/calendar.ts';
import { compareNpcEvents, isNpcEventAfterCursor } from '../domain/npc/events.ts';
import { chooseNpcEconomyAction } from '../domain/npc/economy-policy.ts';
import { chooseNpcDevelopmentAction } from '../domain/npc/economy-policy.ts';
import { getNpcScienceCandidates, startNpcScience } from './npc-science.ts';
import type { NpcScienceLedger } from '../domain/npc/science-state.ts';
import type { ScienceId } from '../domain/science/types.ts';
import { createSeededRandom } from '../domain/world/random.ts';
import type { NpcStateV1, NpcProfile, NpcSessionEvent } from '../domain/npc/types.ts';
import type { SpyTargetState } from '../domain/espionage/types.ts';
import type { BuildingRole } from '../domain/buildings/resource-zone.ts';
import type { SaveState } from './contracts.ts';
import { applyNpcAutonomyAttention, npcAttentionActionId } from './npc-autonomy.ts';
import { touchMember } from '../domain/command/membership.ts';

/**
 * Owner rule (24.10.2026): while online an NPC acts like a player, looking at
 * the game every one to three minutes and doing everything worth doing, with
 * no cap on actions per session. When nothing is worth doing it waits for its
 * next own event (a building, an order, a flight) or for resources to pile up.
 */
export const NPC_REPLAY_DECISION_MIN_DELAY_MS = 60_000;
export const NPC_REPLAY_DECISION_MAX_DELAY_MS = 3 * 60_000;
const MAX_SESSION_MS = 180 * 60_000;
/** Attention moments a session can hold: its longest duration at the shortest delay. */
export const NPC_REPLAY_MAX_ATTEMPTS_PER_SESSION = MAX_SESSION_MS / NPC_REPLAY_DECISION_MIN_DELAY_MS;
/** Actions one look at the game can chain; a wait ends it sooner. */
export const NPC_REPLAY_MAX_ACTIONS_PER_ATTENTION = 16;

/**
 * An attention moment the owner skips: it decided there was nothing to do and
 * waits until its idle time, within the same session. Pure of the profile.
 */
export function isNpcDecisionIdle(profile: NpcProfile, event: NpcReplayEvent): boolean {
  return event.priority === 'npc-decision'
    && profile.session.active
    && profile.session.sessionStartedAt === event.sessionStartedAt
    && typeof profile.session.idleUntil === 'number'
    && event.at < profile.session.idleUntil;
}

/**
 * When an owner with nothing to do looks again: at its next own completion
 * or arrival, or after a pause in which resources pile up (shorter for
 * attentive owners). Everything read is the owner's own state.
 */
export function getNpcIdleUntil(world: SaveState, profile: NpcProfile, at: number): number {
  const ownerId = profile.ownerId;
  const attention = Math.min(1, Math.max(0, Number.isFinite(profile.traits.attention) ? profile.traits.attention : 0.5));
  let until = at + Math.round((10 + 30 * (1 - attention)) * 60_000);
  const consider = (value: number | null | undefined) => {
    if (typeof value === 'number' && Number.isFinite(value) && value > at && value < until) until = value;
  };
  for (const target of Object.values(world.espionage?.targets ?? {})) {
    if (target.kind !== 'npc' || target.ownerId !== ownerId) continue;
    consider(getNextNpcEconomyCheckpoint(target, at + 1));
    consider(getNextNpcFleetProductionCheckpoint(target, ownerId, at, until));
  }
  consider(world.npcScience?.owners[ownerId]?.queue[0]?.finishAt);
  for (const flight of world.flights.records) {
    if (flight.ownerSide !== 'npc' || flight.ownerId !== ownerId) continue;
    if (flight.phase === 'outbound') consider(flight.arrivalAt);
    if (flight.phase === 'returning') consider(flight.returnAt);
  }
  return Math.max(at + 1, Math.round(until));
}

export type NpcReplayBoundaryEvent = Readonly<NpcSessionEvent & { sessionEndsAt: number }>;
export type NpcReplayDecisionEvent = Readonly<{
  at: number;
  priority: 'npc-decision';
  eventId: string;
  ownerId: string;
  sessionId: string;
  sessionStartedAt: number;
  sessionEndsAt: number;
  attempt: number;
}>;
export type NpcReplayEvent = NpcReplayBoundaryEvent | NpcReplayDecisionEvent;

export type NpcReplayContext = Readonly<{
  targets: Readonly<Record<string, SpyTargetState>>;
  timeScale: number;
  science?: NpcScienceLedger;
  /** Full authoritative state enables the unified owner-wide decision path. */
  world?: SaveState;
}>;

export type NpcReplayEmission = Readonly<{
  ownerId: string;
  at: number;
  eventId: string;
  attempt: number;
  selectedRole: BuildingRole | null;
  selectedScienceId?: ScienceId | null;
  selectedActionKind?: string;
  planetId?: string;
  economyActionId?: string;
  wait: boolean;
  started: boolean;
  reason: string | null;
  idempotencyKey: string;
}>;

export type NpcReplayApplyResult = Readonly<{
  state: NpcStateV1;
  targets: Readonly<Record<string, SpyTargetState>>;
  emitted: readonly NpcReplayEmission[];
  science?: NpcScienceLedger;
  world?: SaveState;
}>;

/**
 * Seed an already-running canonical session when replay first activates at a
 * save/campaign baseline inside it. No past boundary or decision is replayed.
 * Existing cursors and active persisted sessions are left intact.
 */
export function initializeNpcReplaySessionsAt(
  state: NpcStateV1,
  at: number,
  registeredOwnerIds: readonly string[],
): NpcStateV1 {
  if (!Number.isSafeInteger(at)) throw new RangeError('NPC baseline timestamp must be a safe integer');
  const profiles = { ...state.profiles };
  let changed = false;
  for (const ownerId of new Set(registeredOwnerIds)) {
    const profile = profiles[ownerId];
    if (!profile || profile.cursor !== null || profile.session.active) continue;
    const from = Math.max(Number.MIN_SAFE_INTEGER, at - MAX_SESSION_MS);
    const through = Math.min(Number.MAX_SAFE_INTEGER, at + MAX_SESSION_MS + 1);
    const calendarEvents = getNpcSessionEvents(profile, from, through);
    const sessions = new Map<string, { startAt: number | null; endAt: number | null }>();
    for (const event of calendarEvents) {
      const session = sessions.get(event.sessionId) ?? { startAt: null, endAt: null };
      if (event.boundary === 'session-start') session.startAt = event.at;
      else session.endAt = event.at;
      sessions.set(event.sessionId, session);
    }
    const current = [...sessions.values()].find((session) =>
      session.startAt !== null && session.endAt !== null && session.startAt <= at && at < session.endAt);
    if (!current || current.startAt === null || current.endAt === null) continue;
    profiles[ownerId] = {
      ...profile,
      session: {
        ...profile.session,
        active: true,
        sessionStartedAt: current.startAt,
        sessionEndsAt: current.endAt,
        lastBoundaryAt: at,
      },
    };
    changed = true;
  }
  return changed ? Object.freeze({ ...state, profiles: Object.freeze(profiles) }) : state;
}

/**
 * Generate deterministic events in the half-open interval [fromAt,toAt).
 * Production callers pass only currently registered NPC owner IDs, which
 * excludes orphan profiles and Test Mode fixtures before replay begins.
 */
export function generateNpcReplayEvents(
  state: NpcStateV1,
  fromAt: number,
  toAt: number,
  registeredOwnerIds: readonly string[],
): NpcReplayEvent[] {
  assertInterval(fromAt, toAt);
  if (fromAt === toAt) return [];
  const registered = new Set(registeredOwnerIds);
  const events: NpcReplayEvent[] = [];
  for (const ownerId of [...registered].sort(compareStableIds)) {
    const profile = state.profiles[ownerId];
    if (profile) for (const event of generateNpcOwnerReplayEvents(profile, ownerId, fromAt, toAt)) events.push(event);
  }
  return events.sort(compareNpcEvents);
}

/**
 * One owner's events in [fromAt, toAt), unsorted. A pure function of the
 * (frozen) profile, including its cursor, and the interval.
 */
export function generateNpcOwnerReplayEvents(
  profile: NpcProfile,
  ownerId: string,
  fromAt: number,
  toAt: number,
): NpcReplayEvent[] {
  assertInterval(fromAt, toAt);
  const events: NpcReplayEvent[] = [];
  if (fromAt === toAt) return events;
  // A session can begin up to three hours before this bounded window. The
  // calendar's max session duration is 180 minutes, so this halo is complete.
  const lookback = Math.max(Number.MIN_SAFE_INTEGER, fromAt - MAX_SESSION_MS);
  const calendarThrough = Math.min(Number.MAX_SAFE_INTEGER, toAt + MAX_SESSION_MS + 1);
  const calendarEvents = getNpcSessionEvents(profile, lookback, calendarThrough);
  const sessions = new Map<string, { startAt: number; endAt: number; sessionId: string }>();
  for (const event of calendarEvents) {
    const key = event.sessionId;
    const session = sessions.get(key) ?? { startAt: -1, endAt: -1, sessionId: opaqueId('session', profile, key) };
    if (event.boundary === 'session-start') session.startAt = event.at;
    else session.endAt = event.at;
    sessions.set(key, session);
  }
  for (const [calendarId, session] of sessions) {
    if (session.startAt < 0 || session.endAt < session.startAt) continue;
    const boundaryStart = calendarEvents.find((event) => event.sessionId === calendarId && event.boundary === 'session-start');
    const boundaryEnd = calendarEvents.find((event) => event.sessionId === calendarId && event.boundary === 'session-end');
    if (!boundaryStart || !boundaryEnd) continue;
    const startEvent: NpcReplayBoundaryEvent = Object.freeze({
      ...boundaryStart,
      eventId: opaqueId('boundary-start', profile, boundaryStart.eventId),
      sessionId: session.sessionId,
      sessionEndsAt: session.endAt,
    });
    const endEvent: NpcReplayBoundaryEvent = Object.freeze({
      ...boundaryEnd,
      eventId: opaqueId('boundary-end', profile, boundaryEnd.eventId),
      sessionId: session.sessionId,
      sessionEndsAt: session.endAt,
    });
    if (inInterval(startEvent.at, fromAt, toAt) && isNpcEventAfterCursor(startEvent, profile.cursor)) events.push(startEvent);
    if (inInterval(endEvent.at, fromAt, toAt) && isNpcEventAfterCursor(endEvent, profile.cursor)) events.push(endEvent);

    let decisionAt = session.startAt;
    for (let attempt = 0; attempt < NPC_REPLAY_MAX_ATTEMPTS_PER_SESSION && decisionAt < session.endAt; attempt += 1) {
      if (inInterval(decisionAt, fromAt, toAt)) {
        const event: NpcReplayDecisionEvent = Object.freeze({
          at: decisionAt,
          priority: 'npc-decision',
          eventId: opaqueId('decision', profile, JSON.stringify([session.startAt, attempt])),
          ownerId,
          sessionId: session.sessionId,
          sessionStartedAt: session.startAt,
          sessionEndsAt: session.endAt,
          attempt,
        });
        if (isNpcEventAfterCursor(event, profile.cursor)) events.push(event);
      }
      if (attempt + 1 >= NPC_REPLAY_MAX_ATTEMPTS_PER_SESSION) break;
      const random = createReplayRandom(profile, session.startAt, attempt + 1);
      const delay = NPC_REPLAY_DECISION_MIN_DELAY_MS + Math.floor(
        random() * (NPC_REPLAY_DECISION_MAX_DELAY_MS - NPC_REPLAY_DECISION_MIN_DELAY_MS + 1),
      );
      decisionAt += delay;
    }
  }
  return events;
}

/** Apply one timestamp's boundaries before its decisions and persist each cursor. */
export function applyNpcReplayEventsAt(
  state: NpcStateV1,
  at: number,
  eventsAtTimestamp: readonly NpcReplayEvent[],
  context: NpcReplayContext,
): NpcReplayApplyResult {
  if (!Number.isSafeInteger(at)) throw new RangeError('NPC replay timestamp must be a safe integer');
  if (!Number.isFinite(context.timeScale) || context.timeScale <= 0) throw new RangeError('timeScale must be positive');
  const profiles = { ...state.profiles };
  let targets: Record<string, SpyTargetState> = { ...context.targets };
  let science = context.science;
  let world = context.world;
  const emitted: NpcReplayEmission[] = [];
  const ordered = [...eventsAtTimestamp]
    .filter((event) => event.at === at)
    .sort(compareNpcEvents);

  for (const event of ordered) {
    const profile = profiles[event.ownerId];
    if (!profile || !isNpcEventAfterCursor(event, profile.cursor)) continue;
    if (world) world = { ...world, command: touchMember(world.command, event.ownerId, event.at) };
    if (event.priority === 'npc-session-boundary') {
      const isStart = event.boundary === 'session-start';
      profiles[event.ownerId] = {
        ...profile,
        session: isStart
          ? { ...withoutIdle(profile.session), active: true, sessionStartedAt: event.at, sessionEndsAt: event.sessionEndsAt, lastBoundaryAt: event.at }
          : { ...withoutIdle(profile.session), active: false, sessionStartedAt: null, sessionEndsAt: null, lastBoundaryAt: event.at },
        activity: isStart ? profile.activity : {
          ...profile.activity,
          completedSessions: profile.activity.completedSessions + 1,
          updatedAt: event.at,
        },
        cursor: { at: event.at, priority: event.priority, eventId: event.eventId },
      };
      continue;
    }

    if (isNpcDecisionIdle(profile, event)) {
      profiles[event.ownerId] = { ...profile, cursor: { at: event.at, priority: event.priority, eventId: event.eventId } };
      continue;
    }
    const activeProfile = profile.session.active
      && profile.session.sessionStartedAt === event.sessionStartedAt
      && profile.session.sessionEndsAt === event.sessionEndsAt;
    let selectedRole: BuildingRole | null = null;
    let selectedScienceId: ScienceId | null = null;
    let wait = true;
    let started = false;
    let reason: string | null = null;
    const idempotencyKey = 'npc-economy:v1:' + JSON.stringify([event.ownerId, event.eventId]);
    if (activeProfile && world) {
      world = { ...world, npc: { ...state, profiles }, npcScience: science,
        espionage: { ...world.espionage!, targets } };
      const decisions = applyNpcAutonomyAttention(world, profile, event.eventId, at, context.timeScale, NPC_REPLAY_MAX_ACTIONS_PER_ATTENTION);
      decisions.forEach((decision, index) => {
        emitted.push(Object.freeze({ ownerId: event.ownerId, at, eventId: npcAttentionActionId(event.eventId, index), attempt: event.attempt,
          selectedRole: decision.selectedRole, selectedScienceId: decision.selectedScienceId,
          selectedActionKind: decision.kind, wait: decision.wait, started: decision.started,
          ...(decision.planetId ? { planetId: decision.planetId } : {}),
          ...(decision.economyActionId ? { economyActionId: decision.economyActionId } : {}),
          reason: decision.reason, idempotencyKey: decision.idempotencyKey }));
      });
      world = decisions[decisions.length - 1]!.state;
      const waited = decisions[decisions.length - 1]!.wait;
      if (waited) {
        const after = world.npc!.profiles[event.ownerId]!;
        world = { ...world, npc: { ...world.npc!, profiles: { ...world.npc!.profiles, [event.ownerId]: {
          ...after, session: { ...after.session, idleUntil: getNpcIdleUntil(world, after, at) },
        } } } };
      }
      targets = { ...world.espionage!.targets };
      science = world.npcScience;
      profiles[event.ownerId] = world.npc!.profiles[event.ownerId]!;
    } else if (activeProfile) {
      const target = Object.values(targets)
        .filter((item) => item.kind === 'npc' && item.ownerId === event.ownerId)
        .sort((left, right) => compareStableIds(left.id, right.id))[0];
      if (target) {
        const ownerScience = science?.owners[event.ownerId];
        const scienceEnabled = science && ownerScience && at >= science.activatedAt;
        const candidates = getNpcBuildingCandidates(target);
        const choice = scienceEnabled
          ? chooseNpcDevelopmentAction(profile, target, candidates, getNpcScienceCandidates(target, ownerScience, at, context.timeScale), event.eventId)
          : { ...chooseNpcEconomyAction(profile, target, candidates.filter(({ role }) => role !== 'research'), event.eventId), scienceId: null };
        selectedRole = choice.role;
        selectedScienceId = choice.scienceId;
        wait = choice.wait;
        if (choice.role) {
          const result = startNpcBuilding(target, choice.role, event.at, { timeScale: context.timeScale }, choice.idempotencyKey);
          targets[target.id] = result.target;
          started = result.ok;
          reason = result.reason;
        }
        if (choice.scienceId && ownerScience && science) {
          const result = startNpcScience(target, ownerScience, choice.scienceId, at, context.timeScale, choice.idempotencyKey);
          targets[target.id] = result.target;
          science = { ...science, owners: { ...science.owners, [event.ownerId]: result.science } };
          started = result.ok;
          reason = result.reason;
        }
        emitted.push(Object.freeze({
          ownerId: event.ownerId, at: event.at, eventId: event.eventId, attempt: event.attempt,
          selectedRole, selectedScienceId, wait, started, reason, idempotencyKey: choice.idempotencyKey,
        }));
      }
    }
    profiles[event.ownerId] = {
      ...profiles[event.ownerId]!,
      cursor: { at: event.at, priority: event.priority, eventId: event.eventId },
    };
  }

  return Object.freeze({
    state: Object.freeze({ ...state, profiles: Object.freeze(profiles) }),
    targets: Object.freeze(targets),
    emitted: Object.freeze(emitted),
    ...(science ? { science } : {}),
    ...(world ? { world } : {}),
  });
}

/** Return the next generated work item after an exclusive time, within a bounded horizon. */
export function getNextNpcWorkAt(
  state: NpcStateV1,
  afterAt: number,
  throughAt: number,
  registeredOwnerIds: readonly string[],
): NpcReplayEvent | null {
  if (!Number.isSafeInteger(afterAt) || !Number.isSafeInteger(throughAt) || throughAt < afterAt) {
    throw new RangeError('NPC work interval must be ordered safe integer timestamps');
  }
  if (afterAt === throughAt || afterAt === Number.MAX_SAFE_INTEGER) return null;
  if (throughAt === Number.MAX_SAFE_INTEGER) throw new RangeError('throughAt cannot be MAX_SAFE_INTEGER');
  return generateNpcReplayEvents(state, afterAt + 1, throughAt + 1, registeredOwnerIds)[0] ?? null;
}

function createReplayRandom(profile: NpcProfile, sessionStartedAt: number, attempt: number): () => number {
  return createSeededRandom(JSON.stringify([
    'npc-replay-delay:v1', profile.privateSeed, profile.ownerId, sessionStartedAt, attempt,
  ]));
}

/** Stable 64-bit FNV-1a IDs keep private persona seeds out of emitted event names. */
function opaqueId(kind: string, profile: NpcProfile, value: string): string {
  const input = JSON.stringify(['npc-replay-id:v1', kind, profile.privateSeed, profile.ownerId, value]);
  let hash = 0xcbf29ce484222325n;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= BigInt(input.charCodeAt(index));
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return 'npc-replay:v1:' + kind + ':' + hash.toString(16).padStart(16, '0');
}

function withoutIdle(session: NpcProfile['session']): NpcProfile['session'] {
  if (session.idleUntil === undefined) return session;
  const { idleUntil: _idle, ...rest } = session;
  return rest;
}
function inInterval(at: number, fromAt: number, toAt: number): boolean { return at >= fromAt && at < toAt; }
function assertInterval(fromAt: number, toAt: number): void {
  if (!Number.isSafeInteger(fromAt) || !Number.isSafeInteger(toAt) || toAt < fromAt) {
    throw new RangeError('NPC replay interval must use safe integer timestamps ordered [fromAt, toAt)');
  }
}
function compareStableIds(left: string, right: string): number { return left < right ? -1 : left > right ? 1 : 0; }
