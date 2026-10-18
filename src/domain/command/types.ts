export type AllianceEmblemGlyph = 'starforge' | 'orbit' | 'vanguard' | 'crown' | 'wings' | 'planet' | 'blades' | 'comet';
export type AllianceAccent = 'cyan' | 'amber' | 'violet' | 'crimson' | 'emerald' | 'silver';
export type AllianceEmblemShape = 'shield' | 'round' | 'hex' | 'banner';
export type AllianceEmblemField = 'solid' | 'split' | 'chevron' | 'rays' | 'stars';
export type AllianceEmblemFieldColor = 'abyss' | 'navy' | 'crimson' | 'forest' | 'royal' | 'bronze';

export type AllianceEmblem = {
  glyph: AllianceEmblemGlyph;
  accent: AllianceAccent;
  /** Constructor parts (optional; absent = the original shield on a dark solid field). */
  shape?: AllianceEmblemShape;
  field?: AllianceEmblemField;
  fieldColor?: AllianceEmblemFieldColor;
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

/** A pending truce offer inside a war. */
export type TruceProposal = {
  /** Alliance that offered the truce. */
  byAllianceId: string;
  at: number;
};

/**
 * One alliance's view of its relation to another alliance. A war is stored as
 * two mirrored views (one per side) so each alliance reads only its own list
 * and the galaxy's relation resolver keeps its `id`/`tag`/`status` contract.
 * Views without `ownerAllianceId` come from older saves and are never shown.
 */
export type DiplomaticRelation = {
  /** The other alliance. */
  id: string;
  allianceName: string;
  tag: string;
  status: RelationStatus;
  /** Alliance whose view this is. */
  ownerAllianceId?: string;
  /** War start (wall clock). */
  since?: number;
  declaredByAllianceId?: string;
  truce?: TruceProposal | null;
  /** When the last truce offer was rejected; a new offer is allowed 3 h later. */
  truceRejectedAt?: number | null;
};

export type AllianceFixtureId = 'test-command-default-v1' | 'test-command-bot01-v1';

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

/** Resources an ally may request; energy is never transferable. */
export type AidResource = 'metal' | 'minerals' | 'gas' | 'debris';

export type RequestStatus = 'open' | 'completed' | 'cancelled' | 'closed';
export type RequestCloseReason = 'completed' | 'cancelled' | 'author_left' | 'alliance_disbanded' | 'planet_destroyed';

export type RequestCoordinate = { galaxy: number; system: number; position: number };

/**
 * One resource request: one resource, one concrete planet of the author.
 * `delivered` is only what the planet actually accepted on arrival. The amount
 * currently in flight is derived from live aid flights (never stored), so it
 * cannot drift from the flight records.
 */
export type ResourceRequest = {
  id: string;
  allianceId: string;
  authorOwnerId: string;
  /** Display snapshot, kept so closed requests stay readable. */
  authorName: string;
  planetId: string;
  planetName: string;
  coordinate: RequestCoordinate;
  resource: AidResource;
  requested: number;
  delivered: number;
  /** Set when the first aid flight is actually launched; cancelling is impossible afterwards. */
  helpStarted: boolean;
  status: RequestStatus;
  closeReason: RequestCloseReason | null;
  createdAt: number;
  closedAt: number | null;
};

/**
 * Charge stock of one owner in one alliance. The record outlives membership so
 * a later return to the same alliance can never grant the one-time start
 * bonus again. Progress is stored as a fraction of the current charge, so a
 * change of Hall level or time scale keeps the part that is already done.
 */
export type AidLedger = {
  ownerId: string;
  allianceId: string;
  charges: number;
  /** Fraction (0..1) of the next charge already restored. */
  progress: number;
  /** Instant up to which `charges`/`progress` are settled. */
  settledAt: number;
  /** Hall level in force since `settledAt`; 0 pauses restoration. */
  hallLevel: number;
  /** Test Mode time scale in force since `settledAt` (1 in production). */
  timeScale: number;
  /** True until the one-time 15-minute first charge of this alliance has been granted. */
  intro: boolean;
};

export type AidEventKind =
  | 'request_created'
  | 'request_cancelled'
  | 'request_closed'
  | 'aid_launched'
  | 'aid_delivered'
  | 'aid_returned';

/**
 * Domain event for the future alliance journal (PR 3). The id is derived from
 * the subject, so recording the same fact twice is a no-op. Only alliance
 * members may ever see it.
 */
export type AidEvent = {
  id: string;
  kind: AidEventKind;
  at: number;
  allianceId: string;
  requestId: string;
  actorOwnerId: string;
  audience: 'alliance';
  flightId?: string;
  units?: number;
  reason?: string;
};

export type CommandState = {
  version: 3;
  alliances: AllianceRecord[];
  applications: AllianceApplication[];
  cooldowns: AllianceCooldown[];
  /** Reserved contract for the future diplomacy stage; always empty today. */
  diplomacy: DiplomaticRelation[];
  requests: ResourceRequest[];
  aidLedgers: AidLedger[];
  aidEvents: AidEvent[];
  /** Monotonic counter for stable alliance/application/request ids; ids are never reused. */
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
  | 'leader_must_transfer'
  | 'hall_required'
  | 'invalid_resource'
  | 'invalid_amount'
  | 'invalid_planet'
  | 'request_limit'
  | 'no_charges'
  | 'request_not_found'
  | 'request_not_open'
  | 'cancel_locked';

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
