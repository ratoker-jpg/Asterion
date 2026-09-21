import {
  DEFAULT_ALLIANCE_EVENTS,
  DEFAULT_ALLIANCE_MEMBERS,
  DEFAULT_ALLIANCE_PROFILE,
  DEFAULT_DIPLOMACY,
  DEFAULT_JOINT_OPERATIONS,
  DEFAULT_RESOURCE_REQUESTS,
  TEST_COMMAND_DEFAULT_FIXTURE_ID,
} from './catalog.ts';
import type {
  AllianceAccent,
  AllianceEmblem,
  AllianceEmblemGlyph,
  AllianceProfile,
  AllianceSettingsInput,
  CommandState,
  JointOperationState,
  RelationStatus,
  RequestPriority,
  ResourceRequestState,
  ResourceType,
} from './types.ts';
import { getRuntimeSaveKey, type RuntimeMode } from '../runtime/mode.ts';

const LEGACY_SAVE_KEY = getRuntimeSaveKey();
const EMBLEM_GLYPHS: readonly AllianceEmblemGlyph[] = ['starforge', 'orbit', 'vanguard'];
const EMBLEM_ACCENTS: readonly AllianceAccent[] = ['cyan', 'amber', 'violet'];
const RESOURCE_TYPES: readonly ResourceType[] = ['metal', 'minerals', 'gas', 'energy'];
const REQUEST_PRIORITIES: readonly RequestPriority[] = ['standard', 'high', 'critical'];
const REQUEST_STATES: readonly ResourceRequestState[] = ['open', 'reviewing'];
const RELATION_STATUSES: readonly RelationStatus[] = ['ally', 'trade_pact', 'neutral', 'tense', 'hostile', 'war'];
const JOINT_STATES: readonly JointOperationState[] = ['preparing', 'mustering', 'active', 'awaiting'];

const EMPTY_ALLIANCE_PROFILE: AllianceProfile = {
  name: '',
  tag: '',
  leaderMemberId: '',
  motto: '',
  description: '',
  status: 'active',
  foundedLabel: '',
  emblem: { glyph: 'starforge', accent: 'cyan' },
};

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;
type SaveEnvelope = { command?: unknown; [key: string]: unknown };

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function cloneEmblem(value: AllianceEmblem): AllianceEmblem {
  return { glyph: value.glyph, accent: value.accent };
}

function normalizeText(value: unknown, fallback: string, maxLength: number, minLength = 1) {
  if (typeof value !== 'string') return fallback;
  const normalized = value.trim().replace(/\s+/g, ' ').slice(0, maxLength);
  return normalized.length >= minLength ? normalized : fallback;
}

function normalizeNonNegativeInteger(value: unknown, fallback: number) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? Math.floor(value)
    : fallback;
}

function normalizeEmblem(value: unknown, fallback: AllianceEmblem): AllianceEmblem {
  if (!isRecord(value)) return cloneEmblem(fallback);
  return {
    glyph: typeof value.glyph === 'string' && (EMBLEM_GLYPHS as readonly string[]).includes(value.glyph)
      ? value.glyph as AllianceEmblemGlyph
      : fallback.glyph,
    accent: typeof value.accent === 'string' && (EMBLEM_ACCENTS as readonly string[]).includes(value.accent)
      ? value.accent as AllianceAccent
      : fallback.accent,
  };
}

function createDefaultStateInternal(mode: RuntimeMode = 'test'): CommandState {
  if (mode === 'production') {
    return {
      alliance: { ...EMPTY_ALLIANCE_PROFILE, emblem: cloneEmblem(EMPTY_ALLIANCE_PROFILE.emblem) },
      members: [],
      resourceRequests: [],
      diplomacy: [],
      jointOperations: [],
      events: [],
    };
  }

  return {
    alliance: { ...DEFAULT_ALLIANCE_PROFILE, emblem: cloneEmblem(DEFAULT_ALLIANCE_PROFILE.emblem) },
    members: DEFAULT_ALLIANCE_MEMBERS.map((member) => ({ ...member })),
    resourceRequests: DEFAULT_RESOURCE_REQUESTS.map((request) => ({ ...request })),
    diplomacy: DEFAULT_DIPLOMACY.map((relation) => ({ ...relation, history: [...relation.history] })),
    jointOperations: DEFAULT_JOINT_OPERATIONS.map((operation) => ({ ...operation })),
    events: DEFAULT_ALLIANCE_EVENTS.map((event) => ({ ...event })),
  };
}

export function createDefaultCommandState(mode: RuntimeMode = 'test'): CommandState {
  return createDefaultStateInternal(mode);
}

export function resetCommandState(mode: RuntimeMode = 'test'): CommandState {
  return createDefaultStateInternal(mode);
}

export function migrateCommandState(value: unknown, mode: RuntimeMode = 'test'): CommandState {
  const defaults = createDefaultStateInternal(mode);
  if (!isRecord(value)) return defaults;

  const persistedAlliance = isRecord(value.alliance) ? value.alliance : {};
  const isFixtureAlliance = persistedAlliance.fixtureId === TEST_COMMAND_DEFAULT_FIXTURE_ID;
  const alliance = mode === 'production' && isFixtureAlliance ? {} : persistedAlliance;
  const fixtureId = mode === 'test'
    ? persistedAlliance.fixtureId === TEST_COMMAND_DEFAULT_FIXTURE_ID
      ? TEST_COMMAND_DEFAULT_FIXTURE_ID
      : isRecord(value.alliance) ? undefined : defaults.alliance.fixtureId
    : undefined;
  const defaultAlliance = { ...defaults.alliance };
  delete defaultAlliance.fixtureId;
  const migrated: CommandState = {
    ...defaults,
    alliance: {
      ...defaultAlliance,
      ...(fixtureId ? { fixtureId } : {}),
      name: normalizeText(alliance.name, defaults.alliance.name, 42, 1),
      tag: normalizeText(alliance.tag, defaults.alliance.tag, 8, 1).toUpperCase(),
      motto: normalizeText(alliance.motto, defaults.alliance.motto, 72, 1),
      description: normalizeText(alliance.description, defaults.alliance.description, 220, 1),
      emblem: normalizeEmblem(alliance.emblem, defaults.alliance.emblem),
    },
  };

  if (Array.isArray(value.members)) {
    const persisted = new Map(value.members.filter(isRecord).map((item) => [item.id, item]));
    migrated.members = defaults.members.map((member) => {
      const candidate = persisted.get(member.id);
      if (!candidate) return member;
      return {
        ...member,
        activity: candidate.activity === 'online' || candidate.activity === 'active' || candidate.activity === 'away'
          ? candidate.activity
          : member.activity,
        contribution: normalizeNonNegativeInteger(candidate.contribution, member.contribution),
        note: normalizeText(candidate.note, member.note, 180, 1),
      };
    });
  }

  if (Array.isArray(value.resourceRequests)) {
    const persisted = new Map(value.resourceRequests.filter(isRecord).map((item) => [item.id, item]));
    migrated.resourceRequests = defaults.resourceRequests.map((request) => {
      const candidate = persisted.get(request.id);
      if (!candidate) return request;
      const resource = typeof candidate.resource === 'string' && (RESOURCE_TYPES as readonly string[]).includes(candidate.resource)
        ? candidate.resource as ResourceType
        : request.resource;
      const priority = typeof candidate.priority === 'string' && (REQUEST_PRIORITIES as readonly string[]).includes(candidate.priority)
        ? candidate.priority as RequestPriority
        : request.priority;
      const state = typeof candidate.state === 'string' && (REQUEST_STATES as readonly string[]).includes(candidate.state)
        ? candidate.state as ResourceRequestState
        : request.state;
      const amount = normalizeNonNegativeInteger(candidate.amount, request.amount);
      return {
        ...request,
        resource,
        priority,
        state,
        amount,
        fulfilledAmount: Math.min(amount, normalizeNonNegativeInteger(candidate.fulfilledAmount, request.fulfilledAmount)),
        purpose: normalizeText(candidate.purpose, request.purpose, 120, 1),
      };
    });
  }

  if (Array.isArray(value.diplomacy)) {
    const persisted = new Map(value.diplomacy.filter(isRecord).map((item) => [item.id, item]));
    migrated.diplomacy = defaults.diplomacy.map((relation) => {
      const candidate = persisted.get(relation.id);
      if (!candidate) return relation;
      const status = typeof candidate.status === 'string' && (RELATION_STATUSES as readonly string[]).includes(candidate.status)
        ? candidate.status as RelationStatus
        : relation.status;
      const history = Array.isArray(candidate.history)
        ? candidate.history.filter((entry): entry is string => typeof entry === 'string' && Boolean(entry.trim())).map((entry) => entry.trim().slice(0, 120)).slice(0, 6)
        : relation.history;
      return {
        ...relation,
        status,
        note: normalizeText(candidate.note, relation.note, 160, 1),
        meaning: normalizeText(candidate.meaning, relation.meaning, 220, 1),
        history: history.length ? history : [...relation.history],
      };
    });
  }

  if (Array.isArray(value.jointOperations)) {
    const persisted = new Map(value.jointOperations.filter(isRecord).map((item) => [item.id, item]));
    migrated.jointOperations = defaults.jointOperations.map((operation) => {
      const candidate = persisted.get(operation.id);
      if (!candidate) return operation;
      const state = typeof candidate.state === 'string' && (JOINT_STATES as readonly string[]).includes(candidate.state)
        ? candidate.state as JointOperationState
        : operation.state;
      return {
        ...operation,
        state,
        participants: normalizeNonNegativeInteger(candidate.participants, operation.participants),
        joinedByPlayer: typeof candidate.joinedByPlayer === 'boolean' ? candidate.joinedByPlayer : operation.joinedByPlayer,
      };
    });
  }

  if (Array.isArray(value.events)) {
    const persisted = new Map(value.events.filter(isRecord).map((item) => [item.id, item]));
    migrated.events = defaults.events.map((event) => {
      const candidate = persisted.get(event.id);
      if (!candidate) return event;
      return {
        ...event,
        text: normalizeText(candidate.text, event.text, 180, 1),
        timestampLabel: normalizeText(candidate.timestampLabel, event.timestampLabel, 24, 1),
      };
    });
  }

  return migrated;
}

export function joinJointOperation(state: CommandState, operationId: string, mode: RuntimeMode = 'test'): CommandState {
  const normalized = migrateCommandState(state, mode);
  return {
    ...normalized,
    jointOperations: normalized.jointOperations.map((operation) => {
      if (operation.id !== operationId || operation.joinedByPlayer) return operation;
      return { ...operation, joinedByPlayer: true, participants: operation.participants + 1 };
    }),
  };
}

export function markResourceRequestReviewing(state: CommandState, requestId: string, mode: RuntimeMode = 'test'): CommandState {
  const normalized = migrateCommandState(state, mode);
  return {
    ...normalized,
    resourceRequests: normalized.resourceRequests.map((request) => request.id === requestId && request.state === 'open'
      ? { ...request, state: 'reviewing' }
      : request),
  };
}

export function updateAllianceSettings(state: CommandState, input: AllianceSettingsInput, mode: RuntimeMode = 'test'): CommandState {
  const normalized = migrateCommandState(state, mode);
  const updatedAlliance: AllianceProfile = {
    ...normalized.alliance,
    name: normalizeText(input.name, normalized.alliance.name, 42, 1),
    tag: normalizeText(input.tag, normalized.alliance.tag, 8, 1).toUpperCase(),
    motto: normalizeText(input.motto, normalized.alliance.motto, 72, 1),
    description: normalizeText(input.description, normalized.alliance.description, 220, 1),
    emblem: normalizeEmblem(input.emblem, normalized.alliance.emblem),
  };
  delete updatedAlliance.fixtureId;
  return {
    ...normalized,
    alliance: updatedAlliance,
  };
}

function resolveStorage(storage?: StorageLike): StorageLike | null {
  if (storage) return storage;
  if (typeof window === 'undefined') return null;
  return window.localStorage;
}

export function readCommandState(storage?: StorageLike, mode?: RuntimeMode): CommandState {
  const runtimeMode = mode ?? 'test';
  const saveKey = mode === undefined ? LEGACY_SAVE_KEY : getRuntimeSaveKey(runtimeMode);
  const target = resolveStorage(storage);
  if (!target) return createDefaultCommandState(runtimeMode);

  try {
    const raw = target.getItem(saveKey);
    if (!raw) return createDefaultCommandState(runtimeMode);
    const envelope = JSON.parse(raw) as SaveEnvelope;
    return migrateCommandState(envelope.command, runtimeMode);
  } catch {
    return createDefaultCommandState(runtimeMode);
  }
}

export type PersistCommandResult =
  | { ok: true; value: CommandState }
  | { ok: false; value: CommandState; error: string };

export function persistCommandState(value: CommandState, storage?: StorageLike, mode?: RuntimeMode): PersistCommandResult {
  const runtimeMode = mode ?? 'test';
  const saveKey = mode === undefined ? LEGACY_SAVE_KEY : getRuntimeSaveKey(runtimeMode);
  const normalized = migrateCommandState(value, runtimeMode);
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
