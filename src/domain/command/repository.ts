import {
  DEFAULT_ALLIANCE_EMBLEM,
  MAX_ALLIANCE_MEMBERS,
  MAX_RESOLVED_APPLICATIONS,
  TEST_ALLY_DISPLAY_NAME,
  TEST_ALLY_OWNER_ID,
  TEST_COMMAND_DEFAULT_FIXTURE_ID,
  TEST_FIXTURE_ALLIANCE_ID,
  TEST_FIXTURE_ALLIANCE_PROFILE,
} from './catalog.ts';
import { normalizeAllianceTag, normalizeAllianceText } from './membership.ts';
import {
  AID_HALL_MAX_LEVEL,
  MAX_AID_CHARGES,
  MAX_AID_EVENTS,
  MAX_CLOSED_REQUESTS,
  createAidLedger,
  isAidResource,
} from './aid.ts';
import type {
  AidEvent,
  AidEventKind,
  AidLedger,
  AllianceAccent,
  AllianceApplication,
  AllianceCooldown,
  AllianceEmblem,
  AllianceEmblemGlyph,
  AllianceMember,
  AllianceRecord,
  ApplicationReason,
  ApplicationStatus,
  CommandState,
  CooldownCause,
  DiplomaticRelation,
  RelationStatus,
  RequestCloseReason,
  RequestStatus,
  ResourceRequest,
} from './types.ts';
import { CURRENT_PLAYER_DISPLAY_NAME, CURRENT_PLAYER_ID } from '../rating/fixtures.ts';
import { getRuntimeSaveKey, type RuntimeMode } from '../runtime/mode.ts';

const LEGACY_SAVE_KEY = getRuntimeSaveKey();
const EMBLEM_GLYPHS: readonly AllianceEmblemGlyph[] = ['starforge', 'orbit', 'vanguard'];
const EMBLEM_ACCENTS: readonly AllianceAccent[] = ['cyan', 'amber', 'violet'];
const APPLICATION_STATUSES: readonly ApplicationStatus[] = ['pending', 'accepted', 'rejected', 'withdrawn', 'auto_rejected'];
const APPLICATION_REASONS: readonly ApplicationReason[] = ['declined', 'full', 'already_member', 'disbanded'];
const COOLDOWN_CAUSES: readonly CooldownCause[] = ['rejected', 'left', 'kicked'];
const RELATION_STATUSES: readonly RelationStatus[] = ['ally', 'trade_pact', 'neutral', 'tense', 'hostile', 'war'];
const MAX_COOLDOWNS = 200;
const REQUEST_STATUSES: readonly RequestStatus[] = ['open', 'completed', 'cancelled', 'closed'];
const REQUEST_CLOSE_REASONS: readonly RequestCloseReason[] = ['completed', 'cancelled', 'author_left', 'alliance_disbanded'];
const AID_EVENT_KINDS: readonly AidEventKind[] = ['request_created', 'request_cancelled', 'request_closed', 'aid_launched', 'aid_delivered', 'aid_returned'];

/** Identity of the local human owner, needed to seed and to migrate legacy saves. */
export type CommandOwnerContext = {
  playerId: string;
  playerDisplayName: string;
  /** Timestamp used for seeded records. Defaults to 0 so default states stay deterministic. */
  now?: number;
};

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;
type SaveEnvelope = { command?: unknown; [key: string]: unknown };

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function resolveContext(context?: Partial<CommandOwnerContext>): Required<CommandOwnerContext> {
  return {
    playerId: context?.playerId?.trim() || CURRENT_PLAYER_ID,
    playerDisplayName: context?.playerDisplayName?.trim() || CURRENT_PLAYER_DISPLAY_NAME,
    now: typeof context?.now === 'number' && Number.isFinite(context.now) ? context.now : 0,
  };
}

function text(value: unknown, fallback: string, maxLength: number, minLength = 0): string {
  if (typeof value !== 'string') return fallback;
  const normalized = value.trim().replace(/\s+/g, ' ').slice(0, maxLength);
  return normalized.length >= minLength ? normalized : fallback;
}

function nonNegativeNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : fallback;
}

function nonNegativeInteger(value: unknown, fallback: number): number {
  return Math.floor(nonNegativeNumber(value, fallback));
}

function parseEmblem(value: unknown, fallback: AllianceEmblem = DEFAULT_ALLIANCE_EMBLEM): AllianceEmblem {
  if (!isRecord(value)) return { ...fallback };
  return {
    glyph: EMBLEM_GLYPHS.includes(value.glyph as AllianceEmblemGlyph) ? value.glyph as AllianceEmblemGlyph : fallback.glyph,
    accent: EMBLEM_ACCENTS.includes(value.accent as AllianceAccent) ? value.accent as AllianceAccent : fallback.accent,
  };
}

/** Stable pseudo-random fallback for members whose persisted tie-break value is missing. */
function hashTieBreaker(ownerId: string): number {
  let hash = 2166136261;
  for (let index = 0; index < ownerId.length; index += 1) {
    hash ^= ownerId.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return ((hash >>> 0) % 1_000_000) / 1_000_000;
}

function emptyState(): CommandState {
  return { version: 3, alliances: [], applications: [], cooldowns: [], diplomacy: [], requests: [], aidLedgers: [], aidEvents: [], nextSerial: 1 };
}

function seedMember(ownerId: string, displayName: string, now: number, tieBreaker: number): AllianceMember {
  return { ownerId, displayName, joinedAt: now, lastActiveAt: now, deliveredUnits: 0, jointOperationCount: 0, tieBreaker };
}

/** Test Mode seed: the local player leads the alliance and the managed ally Ira Vel is its only other member. */
function createTestFixtureAlliance(context: Required<CommandOwnerContext>): AllianceRecord {
  return {
    id: TEST_FIXTURE_ALLIANCE_ID,
    ...TEST_FIXTURE_ALLIANCE_PROFILE,
    emblem: { ...TEST_FIXTURE_ALLIANCE_PROFILE.emblem },
    createdAt: context.now,
    leaderOwnerId: context.playerId,
    deputyOwnerId: null,
    leaderSince: context.now,
    members: [
      seedMember(context.playerId, context.playerDisplayName, context.now, 0.5),
      seedMember(TEST_ALLY_OWNER_ID, TEST_ALLY_DISPLAY_NAME, context.now, 0.25),
    ],
    fixtureId: TEST_COMMAND_DEFAULT_FIXTURE_ID,
  };
}

export function createDefaultCommandState(mode: RuntimeMode = 'test', context?: Partial<CommandOwnerContext>): CommandState {
  const state = emptyState();
  if (mode !== 'test') return state;
  const resolved = resolveContext(context);
  const alliance = createTestFixtureAlliance(resolved);
  return {
    ...state,
    alliances: [alliance],
    // Every seeded member starts like a first-time joiner: empty stock, one-time 15-minute charge.
    aidLedgers: alliance.members.map((member) => createAidLedger(member.ownerId, alliance.id, resolved.now, true)),
  };
}

export function resetCommandState(mode: RuntimeMode = 'test', context?: Partial<CommandOwnerContext>): CommandState {
  return createDefaultCommandState(mode, context);
}

function parseMember(value: unknown): AllianceMember | null {
  if (!isRecord(value)) return null;
  const ownerId = text(value.ownerId, '', 96, 1);
  if (!ownerId) return null;
  const joinedAt = nonNegativeNumber(value.joinedAt, 0);
  const tieBreaker = typeof value.tieBreaker === 'number' && Number.isFinite(value.tieBreaker) && value.tieBreaker >= 0 && value.tieBreaker < 1
    ? value.tieBreaker
    : hashTieBreaker(ownerId);
  return {
    ownerId,
    displayName: text(value.displayName, ownerId, 48, 1),
    joinedAt,
    lastActiveAt: Math.max(joinedAt, nonNegativeNumber(value.lastActiveAt, joinedAt)),
    deliveredUnits: nonNegativeInteger(value.deliveredUnits, 0),
    jointOperationCount: nonNegativeInteger(value.jointOperationCount, 0),
    tieBreaker,
  };
}

function parseAlliance(value: unknown, mode: RuntimeMode): AllianceRecord | null {
  if (!isRecord(value)) return null;
  const id = text(value.id, '', 96, 1);
  const name = text(value.name, '', 42, 1);
  const tag = normalizeAllianceTag(typeof value.tag === 'string' ? value.tag : '').slice(0, 8);
  if (!id || !name || !tag) return null;
  const isFixture = value.fixtureId === TEST_COMMAND_DEFAULT_FIXTURE_ID;
  if (isFixture && mode !== 'test') return null;

  const members = (Array.isArray(value.members) ? value.members : [])
    .map(parseMember)
    .filter((member): member is AllianceMember => member !== null);
  if (!members.length) return null;

  const createdAt = nonNegativeNumber(value.createdAt, 0);
  const requestedLeader = typeof value.leaderOwnerId === 'string' ? value.leaderOwnerId : '';
  const requestedDeputy = typeof value.deputyOwnerId === 'string' ? value.deputyOwnerId : null;
  const record: AllianceRecord = {
    id,
    name,
    tag,
    motto: text(value.motto, '', 72),
    description: text(value.description, '', 220),
    emblem: parseEmblem(value.emblem),
    createdAt,
    leaderOwnerId: requestedLeader,
    deputyOwnerId: requestedDeputy,
    leaderSince: nonNegativeNumber(value.leaderSince, createdAt),
    members,
    ...(isFixture ? { fixtureId: TEST_COMMAND_DEFAULT_FIXTURE_ID } : {}),
  };
  return record;
}

/** Re-establishes invariants after owners were removed or duplicated: leader, deputy, capacity. */
function repairAlliance(alliance: AllianceRecord): AllianceRecord | null {
  const unique = new Map<string, AllianceMember>();
  for (const member of alliance.members) if (!unique.has(member.ownerId)) unique.set(member.ownerId, member);
  let members = [...unique.values()];
  if (!members.length) return null;

  const leaderId = members.some((member) => member.ownerId === alliance.leaderOwnerId)
    ? alliance.leaderOwnerId
    : [...members].sort((left, right) => left.joinedAt - right.joinedAt)[0].ownerId;
  const deputyId = alliance.deputyOwnerId
    && alliance.deputyOwnerId !== leaderId
    && members.some((member) => member.ownerId === alliance.deputyOwnerId)
    ? alliance.deputyOwnerId
    : null;

  if (members.length > MAX_ALLIANCE_MEMBERS) {
    const protectedIds = new Set([leaderId, deputyId].filter((id): id is string => Boolean(id)));
    const rest = members.filter((member) => !protectedIds.has(member.ownerId)).sort((left, right) => left.joinedAt - right.joinedAt);
    members = [...members.filter((member) => protectedIds.has(member.ownerId)), ...rest].slice(0, MAX_ALLIANCE_MEMBERS);
  }
  return { ...alliance, members, leaderOwnerId: leaderId, deputyOwnerId: deputyId };
}

function parseApplication(value: unknown): AllianceApplication | null {
  if (!isRecord(value)) return null;
  const id = text(value.id, '', 96, 1);
  const allianceId = text(value.allianceId, '', 96, 1);
  const ownerId = text(value.ownerId, '', 96, 1);
  if (!id || !allianceId || !ownerId) return null;
  const status = APPLICATION_STATUSES.includes(value.status as ApplicationStatus) ? value.status as ApplicationStatus : null;
  if (!status) return null;
  const createdAt = nonNegativeNumber(value.createdAt, 0);
  const reason = APPLICATION_REASONS.includes(value.reason as ApplicationReason) ? value.reason as ApplicationReason : null;
  return {
    id,
    allianceId,
    allianceName: text(value.allianceName, '', 42),
    ownerId,
    displayName: text(value.displayName, ownerId, 48, 1),
    status,
    reason: status === 'pending' ? null : reason,
    createdAt,
    resolvedAt: status === 'pending' ? null : nonNegativeNumber(value.resolvedAt, createdAt),
    resolvedByOwnerId: status === 'pending' ? null : (typeof value.resolvedByOwnerId === 'string' ? value.resolvedByOwnerId : null),
  };
}

function parseCooldown(value: unknown): AllianceCooldown | null {
  if (!isRecord(value)) return null;
  const ownerId = text(value.ownerId, '', 96, 1);
  const until = value.until;
  if (!ownerId || typeof until !== 'number' || !Number.isFinite(until)) return null;
  return {
    ownerId,
    allianceId: typeof value.allianceId === 'string' && value.allianceId ? value.allianceId : null,
    until,
    cause: COOLDOWN_CAUSES.includes(value.cause as CooldownCause) ? value.cause as CooldownCause : 'left',
  };
}

function parseDiplomacy(value: unknown): DiplomaticRelation[] {
  const relations: DiplomaticRelation[] = [];
  for (const raw of Array.isArray(value) ? value : []) {
    if (!isRecord(raw) || !RELATION_STATUSES.includes(raw.status as RelationStatus)) continue;
    const id = text(raw.id, '', 96, 1);
    const tag = normalizeAllianceTag(typeof raw.tag === 'string' ? raw.tag : '').slice(0, 8);
    if (!id || !tag) continue;
    relations.push({ id, tag, allianceName: text(raw.allianceName, tag, 42, 1), status: raw.status as RelationStatus });
  }
  return relations;
}

function parseRequest(value: unknown): ResourceRequest | null {
  if (!isRecord(value)) return null;
  const id = text(value.id, '', 96, 1);
  const allianceId = text(value.allianceId, '', 96, 1);
  const authorOwnerId = text(value.authorOwnerId, '', 96, 1);
  const planetId = text(value.planetId, '', 96, 1);
  if (!id || !allianceId || !authorOwnerId || !planetId || !isAidResource(value.resource)) return null;
  const requested = nonNegativeInteger(value.requested, 0);
  if (requested <= 0) return null;
  const coordinate = isRecord(value.coordinate) ? value.coordinate : {};
  const status = REQUEST_STATUSES.includes(value.status as RequestStatus) ? value.status as RequestStatus : 'closed';
  const createdAt = nonNegativeNumber(value.createdAt, 0);
  const delivered = Math.min(requested, nonNegativeInteger(value.delivered, 0));
  // `completed` is derived from the amounts, so a damaged status cannot leave a satisfied request open.
  const normalizedStatus: RequestStatus = status === 'open' && delivered >= requested ? 'completed' : status;
  const reason = REQUEST_CLOSE_REASONS.includes(value.closeReason as RequestCloseReason)
    ? value.closeReason as RequestCloseReason
    : null;
  return {
    id,
    allianceId,
    authorOwnerId,
    authorName: text(value.authorName, authorOwnerId, 48, 1),
    planetId,
    planetName: text(value.planetName, planetId, 48, 1),
    coordinate: {
      galaxy: Math.max(1, nonNegativeInteger(coordinate.galaxy, 1)),
      system: Math.max(1, nonNegativeInteger(coordinate.system, 1)),
      position: Math.max(1, nonNegativeInteger(coordinate.position, 1)),
    },
    resource: value.resource,
    requested,
    delivered,
    helpStarted: value.helpStarted === true || delivered > 0,
    status: normalizedStatus,
    closeReason: normalizedStatus === 'open'
      ? null
      : (reason ?? (normalizedStatus === 'completed' ? 'completed' : normalizedStatus === 'cancelled' ? 'cancelled' : 'author_left')),
    createdAt,
    closedAt: normalizedStatus === 'open' ? null : nonNegativeNumber(value.closedAt, createdAt),
  };
}

function parseLedger(value: unknown): AidLedger | null {
  if (!isRecord(value)) return null;
  const ownerId = text(value.ownerId, '', 96, 1);
  const allianceId = text(value.allianceId, '', 96, 1);
  if (!ownerId || !allianceId) return null;
  const charges = Math.min(MAX_AID_CHARGES, nonNegativeInteger(value.charges, 0));
  const rawProgress = typeof value.progress === 'number' && Number.isFinite(value.progress) ? value.progress : 0;
  return {
    ownerId,
    allianceId,
    charges,
    progress: charges >= MAX_AID_CHARGES ? 0 : Math.min(0.999999, Math.max(0, rawProgress)),
    settledAt: nonNegativeNumber(value.settledAt, 0),
    hallLevel: Math.min(AID_HALL_MAX_LEVEL, nonNegativeInteger(value.hallLevel, 0)),
    timeScale: Math.max(1, nonNegativeNumber(value.timeScale, 1)),
    intro: value.intro !== false,
  };
}

function parseAidEvent(value: unknown): AidEvent | null {
  if (!isRecord(value) || !AID_EVENT_KINDS.includes(value.kind as AidEventKind)) return null;
  const id = text(value.id, '', 160, 1);
  const allianceId = text(value.allianceId, '', 96, 1);
  const requestId = text(value.requestId, '', 96, 1);
  const actorOwnerId = text(value.actorOwnerId, '', 96, 1);
  if (!id || !allianceId || !requestId || !actorOwnerId) return null;
  return {
    id,
    kind: value.kind as AidEventKind,
    at: nonNegativeNumber(value.at, 0),
    allianceId,
    requestId,
    actorOwnerId,
    audience: 'alliance',
    ...(typeof value.flightId === 'string' && value.flightId ? { flightId: value.flightId } : {}),
    ...(typeof value.units === 'number' && Number.isFinite(value.units) && value.units >= 0 ? { units: Math.floor(value.units) } : {}),
    ...(typeof value.reason === 'string' && value.reason ? { reason: value.reason.slice(0, 48) } : {}),
  };
}

function serialOf(id: string): number {
  const match = /-(\d+)$/.exec(id);
  return match ? Number(match[1]) : 0;
}

function migrateV2(value: Record<string, unknown>, mode: RuntimeMode): CommandState {
  const seenIds = new Set<string>();
  const seenNames = new Set<string>();
  const seenTags = new Set<string>();
  const seenOwners = new Set<string>();
  const alliances: AllianceRecord[] = [];

  for (const raw of Array.isArray(value.alliances) ? value.alliances : []) {
    const parsed = parseAlliance(raw, mode);
    if (!parsed) continue;
    const nameKey = normalizeAllianceText(parsed.name).toLocaleLowerCase('ru-RU');
    if (seenIds.has(parsed.id) || seenNames.has(nameKey) || seenTags.has(parsed.tag)) continue;
    // One owner, one alliance: later memberships of the same owner are dropped.
    const repaired = repairAlliance({ ...parsed, members: parsed.members.filter((member) => !seenOwners.has(member.ownerId)) });
    if (!repaired) continue;
    seenIds.add(repaired.id);
    seenNames.add(nameKey);
    seenTags.add(repaired.tag);
    for (const member of repaired.members) seenOwners.add(member.ownerId);
    alliances.push(repaired);
  }

  const allianceIds = new Set(alliances.map((alliance) => alliance.id));
  const seenApplicationIds = new Set<string>();
  const pendingOwners = new Set<string>();
  const applications: AllianceApplication[] = [];
  let highestDroppedSerial = 0;
  for (const raw of Array.isArray(value.applications) ? value.applications : []) {
    const application = parseApplication(raw);
    if (application) highestDroppedSerial = Math.max(highestDroppedSerial, serialOf(application.id));
    if (!application || seenApplicationIds.has(application.id)) continue;
    // Finished outcomes may reference an alliance that no longer exists; a pending one may not.
    if (application.status === 'pending') {
      if (!allianceIds.has(application.allianceId)) continue;
      if (seenOwners.has(application.ownerId) || pendingOwners.has(application.ownerId)) continue;
      pendingOwners.add(application.ownerId);
    }
    seenApplicationIds.add(application.id);
    applications.push(application);
  }
  const resolved = applications.filter((application) => application.status !== 'pending');
  const keepResolved = new Set(resolved
    .sort((left, right) => (right.resolvedAt ?? 0) - (left.resolvedAt ?? 0))
    .slice(0, MAX_RESOLVED_APPLICATIONS)
    .map((application) => application.id));

  const cooldowns = (Array.isArray(value.cooldowns) ? value.cooldowns : [])
    .map(parseCooldown)
    .filter((cooldown): cooldown is AllianceCooldown => cooldown !== null)
    .slice(-MAX_COOLDOWNS);

  // Requests: only for alliances that still exist and whose author still belongs to them stay open.
  const seenRequestIds = new Set<string>();
  const requests: ResourceRequest[] = [];
  let highestDroppedRequestSerial = 0;
  for (const raw of Array.isArray(value.requests) ? value.requests : []) {
    const parsed = parseRequest(raw);
    if (parsed) highestDroppedRequestSerial = Math.max(highestDroppedRequestSerial, serialOf(parsed.id));
    if (!parsed || seenRequestIds.has(parsed.id)) continue;
    const alliance = alliances.find((candidate) => candidate.id === parsed.allianceId);
    const authorStays = alliance?.members.some((member) => member.ownerId === parsed.authorOwnerId) ?? false;
    const request: ResourceRequest = parsed.status === 'open' && !authorStays
      ? { ...parsed, status: 'closed', closeReason: alliance ? 'author_left' : 'alliance_disbanded', closedAt: parsed.createdAt }
      : parsed;
    seenRequestIds.add(request.id);
    requests.push(request);
  }
  const keepClosed = new Set(requests
    .filter((request) => request.status !== 'open')
    .sort((left, right) => (right.closedAt ?? 0) - (left.closedAt ?? 0))
    .slice(0, MAX_CLOSED_REQUESTS)
    .map((request) => request.id));

  // Ledgers: one per (owner, alliance); an alliance that is gone takes its ledgers with it.
  const seenLedgers = new Set<string>();
  const aidLedgers: AidLedger[] = [];
  for (const raw of Array.isArray(value.aidLedgers) ? value.aidLedgers : []) {
    const ledger = parseLedger(raw);
    if (!ledger || !allianceIds.has(ledger.allianceId)) continue;
    const key = `${ledger.ownerId}\u0000${ledger.allianceId}`;
    if (seenLedgers.has(key)) continue;
    seenLedgers.add(key);
    aidLedgers.push(ledger);
  }
  // Members that predate ledgers (saves from before this stage) start like first-time joiners. The
  // Hall regime is applied later, so no restoration is ever credited retroactively.
  for (const alliance of alliances) {
    for (const member of alliance.members) {
      const key = `${member.ownerId}\u0000${alliance.id}`;
      if (seenLedgers.has(key)) continue;
      seenLedgers.add(key);
      aidLedgers.push(createAidLedger(member.ownerId, alliance.id, member.joinedAt, true));
    }
  }
  const seenEvents = new Set<string>();
  const aidEvents: AidEvent[] = [];
  for (const raw of Array.isArray(value.aidEvents) ? value.aidEvents : []) {
    const event = parseAidEvent(raw);
    if (!event || seenEvents.has(event.id)) continue;
    seenEvents.add(event.id);
    aidEvents.push(event);
  }

  const highestSerial = Math.max(
    0,
    ...alliances.map((alliance) => serialOf(alliance.id)),
    ...applications.map((application) => serialOf(application.id)),
    highestDroppedSerial,
    highestDroppedRequestSerial,
  );
  return {
    version: 3,
    alliances,
    applications: applications.filter((application) => application.status === 'pending' || keepResolved.has(application.id)),
    cooldowns,
    diplomacy: parseDiplomacy(value.diplomacy),
    requests: requests.filter((request) => request.status === 'open' || keepClosed.has(request.id)),
    aidLedgers,
    aidEvents: aidEvents.slice(-MAX_AID_EVENTS),
    nextSerial: Math.max(nonNegativeInteger(value.nextSerial, 1), highestSerial + 1, 1),
  };
}

/**
 * v1 saves held a single static alliance with fictitious members. Only data the
 * player could have actually edited survives: the profile text/emblem. Test
 * Mode rebuilds the managed seed (player + Ira Vel); production keeps a real,
 * non-fixture alliance as a one-member alliance led by the local player.
 */
function migrateLegacy(value: Record<string, unknown>, mode: RuntimeMode, context: Required<CommandOwnerContext>): CommandState {
  const legacy = isRecord(value.alliance) ? value.alliance : null;
  const base = createDefaultCommandState(mode, context);
  if (!legacy) return base;

  const name = text(legacy.name, '', 42, 1);
  const tag = normalizeAllianceTag(typeof legacy.tag === 'string' ? legacy.tag : '').slice(0, 8);
  const isFixture = legacy.fixtureId === TEST_COMMAND_DEFAULT_FIXTURE_ID;

  if (mode === 'test') {
    const seed = base.alliances[0];
    if (!seed || !name || !tag) return base;
    return {
      ...base,
      alliances: [{
        ...seed,
        name,
        tag,
        motto: text(legacy.motto, seed.motto, 72),
        description: text(legacy.description, seed.description, 220),
        emblem: parseEmblem(legacy.emblem, seed.emblem),
      }],
    };
  }

  if (isFixture || !name || !tag) return base;
  const alliance: AllianceRecord = {
    id: `alliance-${base.nextSerial}`,
    name,
    tag,
    motto: text(legacy.motto, '', 72),
    description: text(legacy.description, '', 220),
    emblem: parseEmblem(legacy.emblem),
    createdAt: context.now,
    leaderOwnerId: context.playerId,
    deputyOwnerId: null,
    leaderSince: context.now,
    members: [seedMember(context.playerId, context.playerDisplayName, context.now, hashTieBreaker(context.playerId))],
  };
  return {
    ...base,
    alliances: [alliance],
    aidLedgers: [createAidLedger(context.playerId, alliance.id, context.now, true)],
    nextSerial: base.nextSerial + 1,
  };
}

export function migrateCommandState(
  value: unknown,
  mode: RuntimeMode = 'test',
  context?: Partial<CommandOwnerContext>,
): CommandState {
  const resolved = resolveContext(context);
  if (!isRecord(value)) return createDefaultCommandState(mode, resolved);
  if ((value.version === 2 || value.version === 3) && Array.isArray(value.alliances)) return migrateV2(value, mode);
  return migrateLegacy(value, mode, resolved);
}

function resolveStorage(storage?: StorageLike): StorageLike | null {
  if (storage) return storage;
  if (typeof window === 'undefined') return null;
  return window.localStorage;
}

export function readCommandState(storage?: StorageLike, mode?: RuntimeMode, context?: Partial<CommandOwnerContext>): CommandState {
  const runtimeMode = mode ?? 'test';
  const saveKey = mode === undefined ? LEGACY_SAVE_KEY : getRuntimeSaveKey(runtimeMode);
  const target = resolveStorage(storage);
  if (!target) return createDefaultCommandState(runtimeMode, context);

  try {
    const raw = target.getItem(saveKey);
    if (!raw) return createDefaultCommandState(runtimeMode, context);
    const envelope = JSON.parse(raw) as SaveEnvelope;
    return migrateCommandState(envelope.command, runtimeMode, context);
  } catch {
    return createDefaultCommandState(runtimeMode, context);
  }
}

export type PersistCommandResult =
  | { ok: true; value: CommandState }
  | { ok: false; value: CommandState; error: string };

export function persistCommandState(
  value: CommandState,
  storage?: StorageLike,
  mode?: RuntimeMode,
  context?: Partial<CommandOwnerContext>,
): PersistCommandResult {
  const runtimeMode = mode ?? 'test';
  const saveKey = mode === undefined ? LEGACY_SAVE_KEY : getRuntimeSaveKey(runtimeMode);
  const normalized = migrateCommandState(value, runtimeMode, context);
  const target = resolveStorage(storage);
  if (!target) return { ok: false, value: normalized, error: 'Локальное сохранение недоступно.' };

  try {
    const raw = target.getItem(saveKey);
    const envelope = raw ? JSON.parse(raw) as SaveEnvelope : {};
    target.setItem(saveKey, JSON.stringify({ ...envelope, command: normalized }));
    return { ok: true, value: normalized };
  } catch (error) {
    return {
      ok: false,
      value: normalized,
      error: error instanceof Error ? error.message : 'Не удалось сохранить Командование.',
    };
  }
}
