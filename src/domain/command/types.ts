export type AllianceEmblemGlyph = 'starforge' | 'orbit' | 'vanguard';
export type AllianceAccent = 'cyan' | 'amber' | 'violet';

export type AllianceEmblem = {
  glyph: AllianceEmblemGlyph;
  accent: AllianceAccent;
};

/** Reusable public identity of an alliance: what outsiders, the galaxy and profiles may see. */
export type AllianceIdentity = {
  id: string;
  name: string;
  tag: string;
  emblem: AllianceEmblem;
  glyph: AllianceEmblem['glyph'];
};

export type RelationStatus = 'ally' | 'trade_pact' | 'neutral' | 'tense' | 'hostile' | 'war';

/**
 * Reserved for the future diplomacy stage. Nothing creates, edits or shows
 * relations yet (war/truce are not active); the list stays empty and exists so
 * the galaxy's relation resolver keeps its contract.
 */
export type DiplomaticRelation = {
  id: string;
  allianceName: string;
  tag: string;
  status: RelationStatus;
};

export type AllianceFixtureId = 'test-command-default-v1';

export type AllianceRole = 'leader' | 'deputy' | 'member';

/**
 * One owner's membership in one alliance. `ownerId` is the stable owner
 * identity shared with the universe/rating/flight layers; one owner is one
 * member no matter how many planets they own.
 */
export type AllianceMember = {
  ownerId: string;
  /** Display snapshot; refreshed by `touchMember` for the local player. */
  displayName: string;
  joinedAt: number;
  lastActiveAt: number;
  /**
   * Contribution aggregate for leadership succession: total units of all four
   * resource types actually delivered to allies during this membership.
   * PR 1 persists the field; the aid-flight pipeline credits it later.
   */
  deliveredUnits: number;
  /** Participation in joint operations; reserved for the future joint-operation stage. */
  jointOperationCount: number;
  /** Random value drawn once at join and persisted, so ties never re-roll. */
  tieBreaker: number;
};

export type AllianceRecord = {
  id: string;
  name: string;
  tag: string;
  motto: string;
  description: string;
  emblem: AllianceEmblem;
  createdAt: number;
  leaderOwnerId: string;
  /** At most one deputy; always a member who is not the leader. */
  deputyOwnerId: string | null;
  /** When the current leader took the role; absence is measured from the later of this and their last activity. */
  leaderSince: number;
  members: AllianceMember[];
  /** Marks the Test Mode seed alliance; such records never survive in production saves. */
  fixtureId?: AllianceFixtureId;
};

export type ApplicationStatus = 'pending' | 'accepted' | 'rejected' | 'withdrawn' | 'auto_rejected';
export type ApplicationReason = 'declined' | 'full' | 'already_member' | 'disbanded';

export type AllianceApplication = {
  id: string;
  allianceId: string;
  /** Name of the alliance at application time, so history stays readable after the alliance is gone. */
  allianceName: string;
  ownerId: string;
  displayName: string;
  status: ApplicationStatus;
  reason: ApplicationReason | null;
  createdAt: number;
  resolvedAt: number | null;
  resolvedByOwnerId: string | null;
};

export type CooldownCause = 'rejected' | 'left' | 'kicked';

/** `allianceId: null` blocks applying to every alliance; otherwise only to that one. */
export type AllianceCooldown = {
  ownerId: string;
  allianceId: string | null;
  until: number;
  cause: CooldownCause;
};

export type CommandState = {
  version: 2;
  alliances: AllianceRecord[];
  applications: AllianceApplication[];
  cooldowns: AllianceCooldown[];
  /** Reserved contract for the future diplomacy stage; always empty today. */
  diplomacy: DiplomaticRelation[];
  /** Monotonic counter for stable alliance/application ids; ids are never reused. */
  nextSerial: number;
};

export type AllianceSettingsInput = Pick<AllianceRecord, 'name' | 'tag' | 'motto' | 'description' | 'emblem'>;

export type CommandErrorCode =
  | 'invalid_name'
  | 'invalid_tag'
  | 'invalid_text'
  | 'duplicate_name'
  | 'duplicate_tag'
  | 'already_member'
  | 'not_member'
  | 'alliance_not_found'
  | 'application_not_found'
  | 'application_not_pending'
  | 'pending_exists'
  | 'cooldown'
  | 'alliance_full'
  | 'not_allowed'
  | 'target_not_member'
  | 'self_target'
  | 'deputy_exists'
  | 'leader_must_transfer';

export type CommandResult<Extra extends object = Record<never, never>> =
  | ({ ok: true; state: CommandState } & Extra)
  /**
   * `state` is always the authoritative state after the attempt. It differs from
   * the input only when the attempt exposed stale data that had to be cleaned up
   * (for example an application whose alliance became full).
   */
  | { ok: false; state: CommandState; code: CommandErrorCode; message: string; retryAt?: number };

export type OwnerMembership = {
  alliance: AllianceRecord;
  member: AllianceMember;
  role: AllianceRole;
};
