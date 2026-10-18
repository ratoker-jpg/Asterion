import { selectAllianceById, selectOwnerMembership } from './selectors.ts';
import type {
  AidEvent,
  AidEventKind,
  AidLedger,
  AidResource,
  CommandErrorCode,
  CommandResult,
  CommandState,
  RequestCloseReason,
  RequestCoordinate,
  ResourceRequest,
} from './types.ts';

/** Resources that can be requested and shipped; energy is intentionally absent. */
export const AID_RESOURCES: readonly AidResource[] = ['metal', 'minerals', 'gas', 'debris'];

export const AID_RESOURCE_LABELS: Record<AidResource, string> = {
  metal: 'Металл',
  minerals: 'Минералы',
  gas: 'Газ',
  debris: 'Обломки',
};

/** Smallest request, and the largest one for an owner with no resource points. */
export const AID_MIN_REQUEST = 50_000;
export const AID_BASE_MAX_REQUEST = 50_000;
/**
 * Technical candidate that reproduces the two agreed points
 * (0 → 50 000, 1 000 000 → 3 500 000): max = 50 000 + 3.45 · resourcePoints.
 * Kept as an exact integer ratio so no float error can shave a unit.
 */
export const AID_REQUEST_SLOPE_NUMERATOR = 345;
export const AID_REQUEST_SLOPE_DENOMINATOR = 100;

export const MAX_AID_CHARGES = 3;
export const MAX_OPEN_REQUESTS = 3;
/** The very first charge of an alliance, granted once per owner per alliance. */
export const AID_INTRO_CHARGE_MS = 15 * 60_000;
export const AID_CHARGE_MS_HALL_1 = 60 * 60_000;
export const AID_CHARGE_MS_HALL_10 = 30 * 60_000;
export const AID_HALL_MAX_LEVEL = 10;
export const MAX_AID_EVENTS = 300;
const PROGRESS_EPSILON_MS = 1e-3;
/** Closed requests kept for history; open ones are never trimmed. */
export const MAX_CLOSED_REQUESTS = 100;

/**
 * Largest request an owner may create. Only resource points matter: not total
 * or combat points and not the Hall level. Growth is linear and has no cap.
 */
export function maxRequestAmount(resourcePoints: number): number {
  const points = Number.isFinite(resourcePoints) ? Math.max(0, resourcePoints) : 0;
  return AID_BASE_MAX_REQUEST + Math.floor((points * AID_REQUEST_SLOPE_NUMERATOR) / AID_REQUEST_SLOPE_DENOMINATOR);
}

/**
 * Time to restore one charge. Linear in time between the two agreed points
 * (60 min at Hall 1, 30 min at Hall 10): 200 s less per level. Zero or an
 * invalid level means the Command is closed and nothing is restored.
 */
export function chargeDurationMs(hallLevel: number): number | null {
  if (!Number.isFinite(hallLevel) || hallLevel < 1) return null;
  const level = Math.min(AID_HALL_MAX_LEVEL, Math.floor(hallLevel));
  const step = (AID_CHARGE_MS_HALL_1 - AID_CHARGE_MS_HALL_10) / (AID_HALL_MAX_LEVEL - 1);
  return AID_CHARGE_MS_HALL_1 - (level - 1) * step;
}

export function isAidResource(value: unknown): value is AidResource {
  return typeof value === 'string' && (AID_RESOURCES as readonly string[]).includes(value);
}

function fail(state: CommandState, code: CommandErrorCode, message: string): CommandResult<never> {
  return { ok: false, state, code, message };
}

// ---------------------------------------------------------------- ledgers

export function createAidLedger(ownerId: string, allianceId: string, now: number, intro: boolean): AidLedger {
  return { ownerId, allianceId, charges: 0, progress: 0, settledAt: now, hallLevel: 0, timeScale: 1, intro };
}

export function selectAidLedger(
  state: Pick<CommandState, 'aidLedgers'>,
  ownerId: string,
  allianceId: string,
): AidLedger | null {
  return state.aidLedgers.find((ledger) => ledger.ownerId === ownerId && ledger.allianceId === allianceId) ?? null;
}

/** Ledger of the alliance the owner belongs to right now. */
export function selectActiveAidLedger(state: CommandState, ownerId: string): AidLedger | null {
  const membership = selectOwnerMembership(state, ownerId);
  return membership ? selectAidLedger(state, ownerId, membership.alliance.id) : null;
}

export type AidChargeView = {
  charges: number;
  /** Fraction (0..1) of the charge being restored. */
  progress: number;
  /** Restoration is stopped because the Hall level is zero. */
  paused: boolean;
  /** Remaining time to the next charge, or null when full or paused. */
  remainingMs: number | null;
  nextChargeAt: number | null;
  /** Whether the next charge is the one-time 15-minute start charge. */
  intro: boolean;
};

function chargeLengthMs(ledger: AidLedger): number | null {
  if (ledger.intro) return ledger.hallLevel >= 1 ? AID_INTRO_CHARGE_MS : null;
  return chargeDurationMs(ledger.hallLevel);
}

/** Advances a ledger to `now` under its own regime. Pure; returns the same object when nothing changes. */
export function settleAidLedger(ledger: AidLedger, now: number): AidLedger {
  if (!Number.isFinite(now) || now <= ledger.settledAt) return ledger;
  let charges = ledger.charges;
  let progress = ledger.progress;
  let intro = ledger.intro;
  if (chargeLengthMs(ledger) === null) return { ...ledger, settledAt: now };
  let budget = (now - ledger.settledAt) * Math.max(1, ledger.timeScale);
  if (charges >= MAX_AID_CHARGES) return { ...ledger, charges: MAX_AID_CHARGES, progress: 0, settledAt: now };
  while (charges < MAX_AID_CHARGES) {
    const duration = intro ? AID_INTRO_CHARGE_MS : (chargeDurationMs(ledger.hallLevel) ?? Number.POSITIVE_INFINITY);
    const needed = (1 - progress) * duration;
    // Split settles accumulate float error in `progress`; a sub-millisecond tolerance keeps a charge from arriving late.
    if (budget + PROGRESS_EPSILON_MS < needed) {
      progress += budget / duration;
      budget = 0;
      break;
    }
    budget -= needed;
    charges += 1;
    progress = 0;
    intro = false;
  }
  if (charges >= MAX_AID_CHARGES) progress = 0;
  return { ...ledger, charges, progress, intro, settledAt: now };
}

export function projectAidLedger(ledger: AidLedger, now: number): AidChargeView {
  const settled = settleAidLedger(ledger, now);
  const length = chargeLengthMs(settled);
  const full = settled.charges >= MAX_AID_CHARGES;
  const paused = length === null && !full;
  if (full || length === null) {
    return { charges: settled.charges, progress: full ? 0 : settled.progress, paused, remainingMs: null, nextChargeAt: null, intro: settled.intro };
  }
  const scale = Math.max(1, settled.timeScale);
  const remainingMs = Math.ceil(((1 - settled.progress) * length) / scale);
  return { charges: settled.charges, progress: settled.progress, paused: false, remainingMs, nextChargeAt: now + remainingMs, intro: settled.intro };
}

function replaceLedger(state: CommandState, next: AidLedger): CommandState {
  return {
    ...state,
    aidLedgers: state.aidLedgers.some((ledger) => ledger.ownerId === next.ownerId && ledger.allianceId === next.allianceId)
      ? state.aidLedgers.map((ledger) => ledger.ownerId === next.ownerId && ledger.allianceId === next.allianceId ? next : ledger)
      : [...state.aidLedgers, next],
  };
}

/**
 * Called whenever an owner becomes a member. The first membership of an
 * owner in an alliance starts empty with the one-time 15-minute charge; any
 * later return starts empty on the normal clock and never gets that bonus.
 */
export function registerAidMembership(state: CommandState, ownerId: string, allianceId: string, now: number): CommandState {
  const existing = selectAidLedger(state, ownerId, allianceId);
  const next = createAidLedger(ownerId, allianceId, now, existing === null);
  return replaceLedger(state, next);
}

/**
 * Points an owner's active ledger at the current regime (Hall level, time
 * scale). Time up to `now` is settled under the old regime first, so a level
 * change keeps the finished share of the charge and only re-times the rest.
 * Does nothing (same object) while the regime is unchanged, so a once-a-second
 * clock never rewrites the save.
 */
export function applyAidRegime(
  state: CommandState,
  ownerId: string,
  regime: { hallLevel: number; timeScale: number },
  now: number,
): CommandState {
  const ledger = selectActiveAidLedger(state, ownerId);
  if (!ledger) return state;
  const hallLevel = Math.max(0, Math.min(AID_HALL_MAX_LEVEL, Math.floor(Number.isFinite(regime.hallLevel) ? regime.hallLevel : 0)));
  const timeScale = Math.max(1, Number.isFinite(regime.timeScale) ? regime.timeScale : 1);
  if (ledger.hallLevel === hallLevel && ledger.timeScale === timeScale) return state;
  const settled = settleAidLedger(ledger, now);
  return replaceLedger(state, { ...settled, hallLevel, timeScale, settledAt: Math.max(settled.settledAt, now) });
}

/** Test Mode only: explicit QA grant, never used by gameplay code. */
export function grantAidChargesForTest(state: CommandState, ownerId: string, count: number, now: number): CommandState {
  const ledger = selectActiveAidLedger(state, ownerId);
  if (!ledger) return state;
  const settled = settleAidLedger(ledger, now);
  const charges = Math.min(MAX_AID_CHARGES, settled.charges + Math.max(0, Math.floor(count)));
  return replaceLedger(state, { ...settled, charges, progress: charges >= MAX_AID_CHARGES ? 0 : settled.progress, intro: false });
}

// ----------------------------------------------------------- contribution

/**
 * Adds actually delivered units to a member's contribution aggregate (the
 * first leadership-succession criterion). PR 1 contract entry point; the
 * membership module re-exports it.
 */
export function creditDeliveredUnits(state: CommandState, ownerId: string, units: number): CommandState {
  const amount = Number.isFinite(units) ? Math.max(0, Math.floor(units)) : 0;
  if (!amount) return state;
  const membership = selectOwnerMembership(state, ownerId);
  if (!membership) return state;
  const alliance = {
    ...membership.alliance,
    members: membership.alliance.members.map((member) => member.ownerId === ownerId
      ? { ...member, deliveredUnits: member.deliveredUnits + amount }
      : member),
  };
  return { ...state, alliances: state.alliances.map((candidate) => candidate.id === alliance.id ? alliance : candidate) };
}

// ----------------------------------------------------------------- events

export function appendAidEvent(
  state: CommandState,
  kind: AidEventKind,
  subject: string,
  event: Omit<AidEvent, 'id' | 'kind' | 'audience'>,
): CommandState {
  const id = `${kind}:${subject}`;
  if (state.aidEvents.some((existing) => existing.id === id)) return state;
  const next: AidEvent = { ...event, id, kind, audience: 'alliance' };
  const events = [...state.aidEvents, next];
  return { ...state, aidEvents: events.length > MAX_AID_EVENTS ? events.slice(events.length - MAX_AID_EVENTS) : events };
}

// --------------------------------------------------------------- requests

export function selectRequestById(state: Pick<CommandState, 'requests'>, requestId: string): ResourceRequest | null {
  return state.requests.find((request) => request.id === requestId) ?? null;
}

export function isRequestOpen(request: ResourceRequest | null | undefined): request is ResourceRequest {
  return Boolean(request) && request!.status === 'open';
}

export function selectOpenRequestsOf(state: Pick<CommandState, 'requests'>, ownerId: string): ResourceRequest[] {
  return state.requests.filter((request) => request.authorOwnerId === ownerId && request.status === 'open');
}

export function selectOpenRequestsForAlliance(state: Pick<CommandState, 'requests'>, allianceId: string): ResourceRequest[] {
  return state.requests
    .filter((request) => request.allianceId === allianceId && request.status === 'open')
    .sort((left, right) => left.createdAt - right.createdAt || (left.id < right.id ? -1 : 1));
}

/** Open requests of *other* members of the owner's alliance, i.e. the ones the owner may serve. */
export function selectFulfillableRequests(state: CommandState, ownerId: string): ResourceRequest[] {
  const membership = selectOwnerMembership(state, ownerId);
  if (!membership) return [];
  return selectOpenRequestsForAlliance(state, membership.alliance.id).filter((request) => request.authorOwnerId !== ownerId);
}

/** Units still open on a request once what is already in flight is set aside. */
export function requestOpenRemainder(request: ResourceRequest, inFlight: number): number {
  return Math.max(0, request.requested - request.delivered - Math.max(0, inFlight));
}

export type CreateRequestInput = {
  ownerId: string;
  authorName: string;
  planet: { id: string; name: string; coordinate: RequestCoordinate };
  resource: AidResource;
  amount: number;
  /** The owner's current resource points; the only input of the size limit. */
  resourcePoints: number;
  hallLevel: number;
};

export function createResourceRequest(
  state: CommandState,
  input: CreateRequestInput,
  now: number,
): CommandResult<{ requestId: string }> {
  const membership = selectOwnerMembership(state, input.ownerId);
  if (!membership) return fail(state, 'not_member', 'Запросы доступны только участникам союза.');
  if (!(input.hallLevel >= 1)) return fail(state, 'hall_required', 'Командование закрыто: постройте Палату.');
  if (!isAidResource(input.resource)) return fail(state, 'invalid_resource', 'Запросить можно металл, минералы, газ или обломки.');
  if (!input.planet.id) return fail(state, 'invalid_planet', 'Выберите свою планету назначения.');
  if (!Number.isSafeInteger(input.amount)) return fail(state, 'invalid_amount', 'Укажите целое количество ресурса.');
  if (input.amount < AID_MIN_REQUEST) {
    return fail(state, 'invalid_amount', `Минимальный запрос — ${AID_MIN_REQUEST.toLocaleString('ru-RU')}.`);
  }
  const limit = maxRequestAmount(input.resourcePoints);
  if (input.amount > limit) {
    return fail(state, 'invalid_amount', `Максимум для вас сейчас — ${limit.toLocaleString('ru-RU')}.`);
  }
  if (selectOpenRequestsOf(state, input.ownerId).length >= MAX_OPEN_REQUESTS) {
    return fail(state, 'request_limit', `Одновременно можно держать не более ${MAX_OPEN_REQUESTS} открытых запросов.`);
  }
  const ledger = selectAidLedger(state, input.ownerId, membership.alliance.id);
  if (!ledger) return fail(state, 'no_charges', 'Заряды запросов ещё не начали восстанавливаться.');
  const settled = settleAidLedger(ledger, now);
  if (settled.charges < 1) return fail(state, 'no_charges', 'Нет свободных зарядов запроса.');

  const requestId = `request-${state.nextSerial}`;
  const request: ResourceRequest = {
    id: requestId,
    allianceId: membership.alliance.id,
    authorOwnerId: input.ownerId,
    authorName: input.authorName.trim().slice(0, 48) || input.ownerId,
    planetId: input.planet.id,
    planetName: input.planet.name.trim().slice(0, 48) || input.planet.id,
    coordinate: { ...input.planet.coordinate },
    resource: input.resource,
    requested: input.amount,
    delivered: 0,
    helpStarted: false,
    status: 'open',
    closeReason: null,
    createdAt: now,
    closedAt: null,
  };
  let next: CommandState = replaceLedger(
    { ...state, requests: [...state.requests, request], nextSerial: state.nextSerial + 1 },
    // Spending from a full stock starts the restoration clock now.
    { ...settled, charges: settled.charges - 1, settledAt: now },
  );
  next = appendAidEvent(next, 'request_created', requestId, {
    at: now, allianceId: request.allianceId, requestId, actorOwnerId: input.ownerId,
  });
  return { ok: true, state: next, requestId };
}

function replaceRequest(state: CommandState, next: ResourceRequest): CommandState {
  return { ...state, requests: state.requests.map((request) => request.id === next.id ? next : request) };
}

function trimClosedRequests(requests: ResourceRequest[]): ResourceRequest[] {
  const closed = requests.filter((request) => request.status !== 'open');
  if (closed.length <= MAX_CLOSED_REQUESTS) return requests;
  const keep = new Set(
    [...closed].sort((left, right) => (right.closedAt ?? 0) - (left.closedAt ?? 0)).slice(0, MAX_CLOSED_REQUESTS).map((request) => request.id),
  );
  return requests.filter((request) => request.status === 'open' || keep.has(request.id));
}

/**
 * Manual cancellation by the author. Allowed only while no aid flight has ever
 * been launched for the request (even one that already turned back counts);
 * the charge is refunded, never beyond the stock limit.
 */
export function cancelResourceRequest(state: CommandState, ownerId: string, requestId: string, now: number): CommandResult {
  const request = selectRequestById(state, requestId);
  if (!request) return fail(state, 'request_not_found', 'Запрос не найден.');
  if (request.authorOwnerId !== ownerId) return fail(state, 'not_allowed', 'Отменить запрос может только его автор.');
  if (request.status !== 'open') return fail(state, 'request_not_open', 'Запрос уже закрыт.');
  if (request.helpStarted) return fail(state, 'cancel_locked', 'Помощь уже отправлена — запрос отменить нельзя.');
  let next = replaceRequest(state, { ...request, status: 'cancelled', closeReason: 'cancelled', closedAt: now });
  const ledger = selectAidLedger(next, ownerId, request.allianceId);
  if (ledger && selectOwnerMembership(next, ownerId)?.alliance.id === request.allianceId) {
    const settled = settleAidLedger(ledger, now);
    const charges = Math.min(MAX_AID_CHARGES, settled.charges + 1);
    next = replaceLedger(next, { ...settled, charges, progress: charges >= MAX_AID_CHARGES ? 0 : settled.progress });
  }
  next = appendAidEvent(next, 'request_cancelled', requestId, { at: now, allianceId: request.allianceId, requestId, actorOwnerId: ownerId });
  return { ok: true, state: { ...next, requests: trimClosedRequests(next.requests) } };
}

/** Records that a real aid flight left the ground for this request. */
export function markRequestHelpStarted(
  state: CommandState,
  requestId: string,
  flightId: string,
  senderOwnerId: string,
  units: number,
  now: number,
): CommandState {
  const request = selectRequestById(state, requestId);
  if (!request) return state;
  let next = request.helpStarted ? state : replaceRequest(state, { ...request, helpStarted: true });
  next = appendAidEvent(next, 'aid_launched', flightId, {
    at: now, allianceId: request.allianceId, requestId, actorOwnerId: senderOwnerId, flightId, units,
  });
  return next;
}

/**
 * Credits what the planet actually accepted from one flight. Idempotent per
 * flight: a repeated call (reload, double handler) changes nothing, neither the
 * request nor the sender's contribution.
 */
export function creditAidDelivery(
  state: CommandState,
  input: { requestId: string; flightId: string; senderOwnerId: string; units: number },
  now: number,
): CommandState {
  const request = selectRequestById(state, input.requestId);
  if (!request) return state;
  if (state.aidEvents.some((event) => event.id === `aid_delivered:${input.flightId}`)) return state;
  const room = Math.max(0, request.requested - request.delivered);
  const accepted = Math.min(room, Math.max(0, Math.floor(Number.isFinite(input.units) ? input.units : 0)));
  let next = state;
  if (accepted > 0) {
    const delivered = request.delivered + accepted;
    const done = delivered >= request.requested && request.status === 'open';
    next = replaceRequest(next, {
      ...request,
      delivered,
      ...(done ? { status: 'completed' as const, closeReason: 'completed' as const, closedAt: now } : {}),
    });
    next = creditDeliveredUnits(next, input.senderOwnerId, accepted);
    if (done) next = { ...next, requests: trimClosedRequests(next.requests) };
  }
  return appendAidEvent(next, 'aid_delivered', input.flightId, {
    at: now, allianceId: request.allianceId, requestId: request.id, actorOwnerId: input.senderOwnerId, flightId: input.flightId, units: accepted,
  });
}

/** Closes one open request with no charge refund (member left, kicked or alliance gone). */
function closeRequest(state: CommandState, request: ResourceRequest, reason: RequestCloseReason, now: number): CommandState {
  const closed: ResourceRequest = { ...request, status: 'closed', closeReason: reason, closedAt: now };
  const next = appendAidEvent(replaceRequest(state, closed), 'request_closed', request.id, {
    at: now, allianceId: request.allianceId, requestId: request.id, actorOwnerId: request.authorOwnerId, reason,
  });
  return next;
}

/** Closes every open request of an author in one alliance. The charge is not returned. */
export function closeRequestsOfAuthor(
  state: CommandState,
  ownerId: string,
  allianceId: string,
  reason: RequestCloseReason,
  now: number,
): CommandState {
  let next = state;
  for (const request of state.requests) {
    if (request.status === 'open' && request.authorOwnerId === ownerId && request.allianceId === allianceId) {
      next = closeRequest(next, request, reason, now);
    }
  }
  return next === state ? state : { ...next, requests: trimClosedRequests(next.requests) };
}

/** Disbanding closes every open request of the alliance and forgets its ledgers (ids are never reused). */
export function closeRequestsOfAlliance(state: CommandState, allianceId: string, now: number): CommandState {
  let next = state;
  for (const request of state.requests) {
    if (request.status === 'open' && request.allianceId === allianceId) {
      next = closeRequest(next, request, 'alliance_disbanded', now);
    }
  }
  return {
    ...next,
    requests: trimClosedRequests(next.requests),
    aidLedgers: next.aidLedgers.filter((ledger) => ledger.allianceId !== allianceId),
  };
}

/**
 * Safety net for state that was edited outside the membership functions (old
 * saves, test staging): closes open requests whose author is not in the
 * request's alliance any more. Idempotent.
 */
export function closeOrphanedRequests(state: CommandState, now: number): CommandState {
  let next = state;
  for (const request of state.requests) {
    if (request.status !== 'open') continue;
    const alliance = selectAllianceById(next, request.allianceId);
    if (!alliance) next = closeRequest(next, request, 'alliance_disbanded', now);
    else if (!alliance.members.some((member) => member.ownerId === request.authorOwnerId)) {
      next = closeRequest(next, request, 'author_left', now);
    }
  }
  return next === state ? state : { ...next, requests: trimClosedRequests(next.requests) };
}

/**
 * Both ends of an aid transfer must still sit in the alliance that owns the
 * request. Used at launch, at arrival and when membership changes.
 */
export function isAidPairValid(
  state: CommandState,
  input: { allianceId: string; senderOwnerId: string; recipientOwnerId: string },
): boolean {
  if (input.senderOwnerId === input.recipientOwnerId) return false;
  const alliance = selectAllianceById(state, input.allianceId);
  if (!alliance) return false;
  const hasSender = alliance.members.some((member) => member.ownerId === input.senderOwnerId);
  const hasRecipient = alliance.members.some((member) => member.ownerId === input.recipientOwnerId);
  return hasSender && hasRecipient;
}
