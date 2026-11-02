import type { CommanderId } from '../combat/commanders.ts';

/** Persisted NPC domain contracts. This module contains no runtime integrations. */

export const NPC_STATE_VERSION = 1 as const;

export type NpcTraitName =
  | 'economyFocus'
  | 'scienceFocus'
  | 'militaryFocus'
  | 'expansionFocus'
  | 'operationsInterest'
  | 'cooperation'
  | 'aggression'
  | 'riskTolerance'
  | 'planningHorizon'
  | 'mechanicsKnowledge'
  | 'adaptability'
  | 'persistence'
  | 'socialStyle'
  | 'attention';

/** Continuous values in [0, 1]. They are private and must not be used as UI data. */
export type NpcTraits = Readonly<Record<NpcTraitName, number>>;

export type NpcKnowledge = Readonly<Record<string, Readonly<{
  level: number;
  confidence: number;
  observedAt: number;
}>>>;

export type NpcPlanningState = Readonly<{
  horizon: number;
  commitment: number;
  reconsiderAt: number | null;
}>;

export type NpcMemory = readonly Readonly<{
  id: string;
  kind: string;
  at: number;
  /** Outcome remembered from the NPC's own observations; never hidden world state. */
  valence: number;
  salience: number;
  factIds: readonly string[];
}>[];

export type NpcLongTermGoal = Readonly<{
  id: string;
  kind: string;
  createdAt: number;
  priority: number;
  status: 'active' | 'paused' | 'completed' | 'abandoned';
  progress: number;
}>;

export type NpcActivityState = Readonly<{
  /** Dynamic activity propensity and observed counters; no fixed archetype label. */
  propensity: number;
  completedSessions: number;
  missedSessions: number;
  updatedAt: number;
}>;

/**
 * One visit of the calendar moved in time (owner decision 7, 31.10.2026: an
 * invitation may move the nearest visit by up to two hours; its length stays,
 * so the day's budget does not grow). Keyed by the visit's place in its day;
 * deltaMs is the whole move from the calendar's time.
 */
export type NpcVisitShift = Readonly<{
  localDay: number;
  index: number;
  deltaMs: number;
}>;

export type NpcSessionState = Readonly<{
  timezoneOffsetMinutes: number;
  active: boolean;
  sessionStartedAt: number | null;
  sessionEndsAt: number | null;
  lastBoundaryAt: number | null;
  /** Within the current session: the owner found nothing to do and looks again at this time. */
  idleUntil?: number;
  /** Visits moved by an invitation; absent in older saves and for most owners. */
  visitShifts?: readonly NpcVisitShift[];
}>;

export type NpcEventPriority =
  | 'game-timer-completion'
  /** Fleet arrival handlers apply arrival and its immediate consequences together. */
  | 'fleet-arrival'
  | 'npc-session-boundary'
  | 'npc-decision';

export type NpcSessionBoundary = 'session-start' | 'session-end';

export type NpcSessionEvent = Readonly<{
  at: number;
  priority: 'npc-session-boundary';
  eventId: string;
  ownerId: string;
  sessionId: string;
  boundary: NpcSessionBoundary;
}>;

/** Last fully applied event. A cursor is exclusive when querying the next event. */
export type NpcEventCursor = Readonly<{
  at: number;
  priority: NpcEventPriority;
  eventId: string;
}>;

export type NpcProfile = Readonly<{
  ownerId: string;
  /** Salted owner-specific stream; independent of public display names and list order. */
  privateSeed: string;
  traits: NpcTraits;
  knowledge: NpcKnowledge;
  planning: NpcPlanningState;
  memory: NpcMemory;
  longTermGoals: readonly NpcLongTermGoal[];
  activity: NpcActivityState;
  session: NpcSessionState;
  cursor: NpcEventCursor | null;
  /** Campaign start this owner joined at (absent in older saves): the opening days are played harder. */
  campaignStartedAt?: number;
  /**
   * Owners who attacked this NPC, kept until the end of the match (owner rule
   * 26.10.2026). Absent in older saves; persistence seeds it from the battle
   * reports the save still holds.
   */
  grudges?: Readonly<Record<string, NpcGrudge>>;
  /**
   * The owner's «Боевой приоритет»: which present commander leads in attack and
   * in defence. Absent in older saves (the default order applies until the
   * owner next looks at the game and sets it).
   */
  combatPriority?: Readonly<{ attack: readonly CommanderId[]; defense: readonly CommanderId[] }>;
  /**
   * What this owner brought from earlier rounds of a series (domain/npc/persona-registry.ts).
   * Absent outside a series: such an owner decides exactly as before. Keyed by
   * this campaign's owners; the hidden persona id stays out of the save.
   */
  inherited?: NpcInheritedExperience;
}>;

export type NpcInheritedRelation = Readonly<{ trust: number; affinity: number; resentment: number; fear?: number; reliability?: number }>;

export type NpcInheritedExperience = Readonly<{
  round: number;
  /** Learned leanings by action family, -1..1, already weighted by how much still applies. */
  prefs: Readonly<Record<string, number>>;
  lessons: readonly Readonly<{ family: 'attack'; enemyRace: string; effect: number }>[];
  /** Other owners of this world this one has played with before. Attitude only: no location, no intelligence. */
  relations: Readonly<Record<string, NpcInheritedRelation>>;
}>;

/** What one offender did to this NPC: attacks suffered and their cost in resources. */
export type NpcGrudge = Readonly<{
  attacks: number;
  /** Resources lost: destroyed ships and turrets at catalog prices plus the loot taken. */
  damage: number;
  firstAt: number;
  lastAt: number;
  /** Guards against counting one battle twice. */
  lastReportId?: string;
}>;

export type NpcStateV1 = Readonly<{
  version: typeof NPC_STATE_VERSION;
  /** Private campaign-level salt. Keep out of ordinary exports and UI. */
  personaSalt: string;
  profiles: Readonly<Record<string, NpcProfile>>;
}>;

export type NpcKnownFact = Readonly<{
  id: string;
  kind: string;
  observedAt: number;
  /** Facts are explicit values copied from an observation/knowledge ledger. */
  value: string | number | boolean | null;
}>;

export type NpcObservation = Readonly<{
  ownerId: string;
  at: number;
  eventId: string;
  facts: readonly NpcKnownFact[];
}>;

export type NpcCandidateAction = Readonly<{
  id: string;
  kind: string;
  payload?: Readonly<Record<string, string | number | boolean | null>>;
}>;

/** Contains only the facts and legal candidate actions explicitly supplied by its caller. */
export type NpcDecisionContext = Readonly<{
  ownerId: string;
  at: number;
  observation: NpcObservation;
  availableActions: readonly NpcCandidateAction[];
}>;

export type NpcDecisionResult = Readonly<{
  ownerId: string;
  at: number;
  eventId: string;
  selectedAction: NpcCandidateAction | null;
  wait: boolean;
  idempotencyKey: string;
}>;
