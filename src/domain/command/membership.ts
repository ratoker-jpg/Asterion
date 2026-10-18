import {
  ACTIVITY_TOUCH_INTERVAL_MS,
  ALLIANCE_DESCRIPTION_MAX,
  ALLIANCE_MOTTO_MAX,
  ALLIANCE_NAME_MAX,
  ALLIANCE_NAME_MIN,
  ALLIANCE_TAG_MAX,
  ALLIANCE_TAG_MIN,
  LEADER_ABSENCE_MS,
  MAX_ALLIANCE_MEMBERS,
  MAX_RESOLVED_APPLICATIONS,
  REAPPLY_COOLDOWN_MS,
} from './catalog.ts';
import {
  closeRequestsOfAlliance,
  closeRequestsOfAuthor,
  registerAidMembership,
} from './aid.ts';
import {
  canManageAlliance,
  isAllianceFull,
  selectAllianceById,
  selectOwnerMembership,
  selectPendingApplication,
  selectReapplyBlock,
  selectRole,
} from './selectors.ts';
import { parseCrest } from './crest.ts';
import { normalizeEmblem } from './emblem.ts';
import type {
  AllianceApplication,
  AllianceCooldown,
  AllianceEmblem,
  AllianceMember,
  AllianceRecord,
  AllianceSettingsInput,
  ApplicationReason,
  CommandErrorCode,
  CommandResult,
  CommandState,
  CooldownCause,
} from './types.ts';

const TAG_PATTERN = /^[\p{L}\p{N}]+$/u;

export type MembershipOptions = {
  now: number;
  /** Source of the one-time tie-break value drawn at join. Defaults to `Math.random`. */
  random?: () => number;
};

function fail(state: CommandState, code: CommandErrorCode, message: string, retryAt?: number): CommandResult<never> {
  return retryAt === undefined ? { ok: false, state, code, message } : { ok: false, state, code, message, retryAt };
}

export function normalizeAllianceText(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

export function normalizeAllianceTag(value: string): string {
  return value.trim().replace(/\s+/g, '').toLocaleUpperCase('ru-RU');
}

function nameKey(value: string): string {
  return normalizeAllianceText(value).toLocaleLowerCase('ru-RU');
}

function emblemOrDefault(value: AllianceEmblem | undefined): AllianceEmblem {
  return normalizeEmblem(value);
}

type ValidatedSettings = { ok: true; value: AllianceSettingsInput } | { ok: false; code: CommandErrorCode; message: string };

/** Validates and normalizes alliance settings; name and tag must be unique across every other alliance. */
export function validateAllianceSettings(
  state: Pick<CommandState, 'alliances'>,
  input: AllianceSettingsInput,
  ignoreAllianceId: string | null = null,
): ValidatedSettings {
  const name = normalizeAllianceText(String(input.name ?? ''));
  const tag = normalizeAllianceTag(String(input.tag ?? ''));
  const motto = normalizeAllianceText(String(input.motto ?? ''));
  const description = normalizeAllianceText(String(input.description ?? ''));

  if (name.length < ALLIANCE_NAME_MIN || name.length > ALLIANCE_NAME_MAX) {
    return { ok: false, code: 'invalid_name', message: `Название союза — от ${ALLIANCE_NAME_MIN} до ${ALLIANCE_NAME_MAX} символов.` };
  }
  if (tag.length < ALLIANCE_TAG_MIN || tag.length > ALLIANCE_TAG_MAX || !TAG_PATTERN.test(tag)) {
    return { ok: false, code: 'invalid_tag', message: `Тег — от ${ALLIANCE_TAG_MIN} до ${ALLIANCE_TAG_MAX} букв или цифр без пробелов.` };
  }
  if (motto.length > ALLIANCE_MOTTO_MAX) {
    return { ok: false, code: 'invalid_text', message: `Девиз — максимум ${ALLIANCE_MOTTO_MAX} символов.` };
  }
  if (description.length > ALLIANCE_DESCRIPTION_MAX) {
    return { ok: false, code: 'invalid_text', message: `Описание — максимум ${ALLIANCE_DESCRIPTION_MAX} символов.` };
  }

  const rawCrest = (input.emblem as { crest?: unknown } | undefined)?.crest;
  if (rawCrest !== undefined && !parseCrest(rawCrest)) {
    return { ok: false, code: 'invalid_emblem', message: 'Герб содержит недопустимые параметры.' };
  }

  for (const other of state.alliances) {
    if (other.id === ignoreAllianceId) continue;
    if (nameKey(other.name) === nameKey(name)) return { ok: false, code: 'duplicate_name', message: 'Союз с таким названием уже существует.' };
    if (normalizeAllianceTag(other.tag) === tag) return { ok: false, code: 'duplicate_tag', message: 'Союз с таким тегом уже существует.' };
  }

  return { ok: true, value: { name, tag, motto, description, emblem: emblemOrDefault(input.emblem) } };
}

function createMember(ownerId: string, displayName: string, now: number, random: () => number): AllianceMember {
  const draw = random();
  return {
    ownerId,
    displayName: normalizeAllianceText(displayName).slice(0, 48) || ownerId,
    joinedAt: now,
    lastActiveAt: now,
    deliveredUnits: 0,
    jointOperationCount: 0,
    tieBreaker: Number.isFinite(draw) ? Math.min(0.999999, Math.max(0, draw)) : 0,
  };
}

function replaceAlliance(state: CommandState, next: AllianceRecord): CommandState {
  return { ...state, alliances: state.alliances.map((alliance) => alliance.id === next.id ? next : alliance) };
}

function capResolvedApplications(applications: AllianceApplication[]): AllianceApplication[] {
  const resolved = applications.filter((application) => application.status !== 'pending');
  if (resolved.length <= MAX_RESOLVED_APPLICATIONS) return applications;
  const keep = new Set(
    [...resolved]
      .sort((left, right) => (right.resolvedAt ?? 0) - (left.resolvedAt ?? 0))
      .slice(0, MAX_RESOLVED_APPLICATIONS)
      .map((application) => application.id),
  );
  return applications.filter((application) => application.status === 'pending' || keep.has(application.id));
}

function resolveApplication(
  application: AllianceApplication,
  status: AllianceApplication['status'],
  reason: ApplicationReason | null,
  now: number,
  byOwnerId: string | null,
): AllianceApplication {
  return { ...application, status, reason, resolvedAt: now, resolvedByOwnerId: byOwnerId };
}

/** Closes every pending application to `allianceId` with an automatic, cooldown-free reason. */
function autoRejectPending(state: CommandState, allianceId: string, reason: ApplicationReason, now: number): CommandState {
  if (!state.applications.some((application) => application.allianceId === allianceId && application.status === 'pending')) return state;
  return {
    ...state,
    applications: capResolvedApplications(state.applications.map((application) => (
      application.allianceId === allianceId && application.status === 'pending'
        ? resolveApplication(application, 'auto_rejected', reason, now, null)
        : application
    ))),
  };
}

function addCooldown(state: CommandState, cooldown: AllianceCooldown, now: number): CommandState {
  const alive = state.cooldowns.filter((entry) => entry.until > now
    && !(entry.ownerId === cooldown.ownerId && entry.allianceId === cooldown.allianceId));
  return { ...state, cooldowns: [...alive, cooldown] };
}

function leaveCooldown(state: CommandState, ownerId: string, cause: CooldownCause, now: number): CommandState {
  return addCooldown(state, { ownerId, allianceId: null, until: now + REAPPLY_COOLDOWN_MS, cause }, now);
}

/** Withdraws the owner's pending application (used when they found their own alliance). */
function withdrawPending(state: CommandState, ownerId: string, now: number): CommandState {
  const pending = selectPendingApplication(state, ownerId);
  if (!pending) return state;
  return {
    ...state,
    applications: state.applications.map((application) => application.id === pending.id
      ? resolveApplication(application, 'withdrawn', null, now, ownerId)
      : application),
  };
}

export function createAlliance(
  state: CommandState,
  input: { ownerId: string; displayName: string; settings: AllianceSettingsInput },
  options: MembershipOptions,
): CommandResult<{ allianceId: string }> {
  if (selectOwnerMembership(state, input.ownerId)) {
    return fail(state, 'already_member', 'Вы уже состоите в союзе. Сначала покиньте его.');
  }
  // Founding makes the owner a member, so the global delay after leaving/being kicked applies too.
  // A refusal from one alliance is scoped to that alliance and does not block founding.
  const block = selectReapplyBlock(state, input.ownerId, null, options.now);
  if (block) return fail(state, 'cooldown', 'После выхода из союза создавать и вступать в союзы временно нельзя.', block.until);
  const settings = validateAllianceSettings(state, input.settings);
  if (!settings.ok) return fail(state, settings.code, settings.message);

  const random = options.random ?? Math.random;
  const id = `alliance-${state.nextSerial}`;
  const alliance: AllianceRecord = {
    id,
    ...settings.value,
    createdAt: options.now,
    leaderOwnerId: input.ownerId,
    deputyOwnerId: null,
    leaderSince: options.now,
    members: [createMember(input.ownerId, input.displayName, options.now, random)],
  };
  const withPending = withdrawPending(state, input.ownerId, options.now);
  const created: CommandState = { ...withPending, alliances: [...withPending.alliances, alliance], nextSerial: state.nextSerial + 1 };
  return { ok: true, allianceId: id, state: registerAidMembership(created, input.ownerId, id, options.now) };
}

export function updateAllianceSettings(
  state: CommandState,
  actorOwnerId: string,
  input: AllianceSettingsInput,
): CommandResult {
  const membership = selectOwnerMembership(state, actorOwnerId);
  if (!membership) return fail(state, 'not_member', 'Вы не состоите в союзе.');
  if (!canManageAlliance(membership.role)) return fail(state, 'not_allowed', 'Изменять настройки может лидер или заместитель.');
  const settings = validateAllianceSettings(state, input, membership.alliance.id);
  if (!settings.ok) return fail(state, settings.code, settings.message);
  return { ok: true, state: replaceAlliance(state, { ...membership.alliance, ...settings.value }) };
}

export function applyToAlliance(
  state: CommandState,
  input: { ownerId: string; displayName: string; allianceId: string },
  options: MembershipOptions,
): CommandResult<{ applicationId: string }> {
  const { now } = options;
  if (selectOwnerMembership(state, input.ownerId)) {
    return fail(state, 'already_member', 'Вы уже состоите в союзе. Подать заявку можно только после выхода.');
  }
  const alliance = selectAllianceById(state, input.allianceId);
  if (!alliance) return fail(state, 'alliance_not_found', 'Этот союз больше не существует.');
  if (selectPendingApplication(state, input.ownerId)) {
    return fail(state, 'pending_exists', 'У вас уже есть ожидающая заявка. Отзовите её, чтобы подать другую.');
  }
  const block = selectReapplyBlock(state, input.ownerId, alliance.id, now);
  if (block) {
    return fail(
      state,
      'cooldown',
      block.allianceId === null
        ? 'После выхода из союза заявки временно недоступны.'
        : 'Повторная заявка в этот союз временно недоступна.',
      block.until,
    );
  }
  if (isAllianceFull(alliance)) return fail(state, 'alliance_full', 'В союзе нет мест.');

  const id = `application-${state.nextSerial}`;
  const application: AllianceApplication = {
    id,
    allianceId: alliance.id,
    allianceName: alliance.name,
    ownerId: input.ownerId,
    displayName: normalizeAllianceText(input.displayName).slice(0, 48) || input.ownerId,
    status: 'pending',
    reason: null,
    createdAt: now,
    resolvedAt: null,
    resolvedByOwnerId: null,
  };
  return {
    ok: true,
    applicationId: id,
    state: { ...state, applications: [...state.applications, application], nextSerial: state.nextSerial + 1 },
  };
}

/** Withdrawing is free: it never starts a re-application delay. */
export function withdrawApplication(state: CommandState, ownerId: string, now: number): CommandResult {
  const pending = selectPendingApplication(state, ownerId);
  if (!pending) return fail(state, 'application_not_found', 'Ожидающей заявки нет.');
  return { ok: true, state: withdrawPending(state, ownerId, now) };
}

function findActionableApplication(
  state: CommandState,
  actorOwnerId: string,
  applicationId: string,
): { application: AllianceApplication; alliance: AllianceRecord } | CommandResult<never> {
  const application = state.applications.find((candidate) => candidate.id === applicationId);
  if (!application) return fail(state, 'application_not_found', 'Заявка не найдена.');
  const alliance = selectAllianceById(state, application.allianceId);
  if (!alliance) return fail(state, 'alliance_not_found', 'Этот союз больше не существует.');
  if (!canManageAlliance(selectRole(alliance, actorOwnerId))) {
    return fail(state, 'not_allowed', 'Рассматривать заявки может лидер или заместитель.');
  }
  if (application.status !== 'pending') return fail(state, 'application_not_pending', 'Заявка уже рассмотрена.');
  return { application, alliance };
}

export function acceptApplication(
  state: CommandState,
  actorOwnerId: string,
  applicationId: string,
  options: MembershipOptions,
): CommandResult<{ allianceId: string; ownerId: string }> {
  const { now } = options;
  const found = findActionableApplication(state, actorOwnerId, applicationId);
  if ('ok' in found) return found;
  const { application, alliance } = found;

  // Acceptance re-validates everything the application depended on.
  if (selectOwnerMembership(state, application.ownerId)) {
    const cleaned = {
      ...state,
      applications: state.applications.map((candidate) => candidate.id === application.id
        ? resolveApplication(candidate, 'auto_rejected', 'already_member', now, null)
        : candidate),
    };
    return fail(cleaned, 'already_member', 'Заявитель уже состоит в другом союзе.');
  }
  if (isAllianceFull(alliance)) {
    return fail(autoRejectPending(state, alliance.id, 'full', now), 'alliance_full', 'В союзе нет мест.');
  }

  const member = createMember(application.ownerId, application.displayName, now, options.random ?? Math.random);
  const grown: AllianceRecord = { ...alliance, members: [...alliance.members, member] };
  let next = replaceAlliance(state, grown);
  next = {
    ...next,
    applications: capResolvedApplications(next.applications.map((candidate) => candidate.id === application.id
      ? resolveApplication(candidate, 'accepted', null, now, actorOwnerId)
      : candidate)),
  };
  if (grown.members.length >= MAX_ALLIANCE_MEMBERS) next = autoRejectPending(next, alliance.id, 'full', now);
  next = registerAidMembership(next, application.ownerId, alliance.id, now);
  return { ok: true, state: next, allianceId: alliance.id, ownerId: application.ownerId };
}

/** A refusal blocks re-applying to the same alliance for two hours; other alliances stay open. */
export function rejectApplication(
  state: CommandState,
  actorOwnerId: string,
  applicationId: string,
  now: number,
): CommandResult {
  const found = findActionableApplication(state, actorOwnerId, applicationId);
  if ('ok' in found) return found;
  const { application, alliance } = found;
  let next: CommandState = {
    ...state,
    applications: capResolvedApplications(state.applications.map((candidate) => candidate.id === application.id
      ? resolveApplication(candidate, 'rejected', 'declined', now, actorOwnerId)
      : candidate)),
  };
  next = addCooldown(next, { ownerId: application.ownerId, allianceId: alliance.id, until: now + REAPPLY_COOLDOWN_MS, cause: 'rejected' }, now);
  return { ok: true, state: next };
}

function removeMemberFromAlliance(alliance: AllianceRecord, ownerId: string): AllianceRecord {
  return {
    ...alliance,
    members: alliance.members.filter((member) => member.ownerId !== ownerId),
    deputyOwnerId: alliance.deputyOwnerId === ownerId ? null : alliance.deputyOwnerId,
  };
}

function disband(state: CommandState, allianceId: string, now: number): CommandState {
  const closed = autoRejectPending(state, allianceId, 'disbanded', now);
  return { ...closed, alliances: closed.alliances.filter((alliance) => alliance.id !== allianceId) };
}

function promote(alliance: AllianceRecord, successorOwnerId: string, now: number): AllianceRecord {
  return {
    ...alliance,
    leaderOwnerId: successorOwnerId,
    leaderSince: now,
    deputyOwnerId: alliance.deputyOwnerId === successorOwnerId ? null : alliance.deputyOwnerId,
  };
}

/**
 * Voluntary exit. A leader of a non-empty alliance must hand over leadership
 * first (to `successorOwnerId`, or the deputy when none is named); the sole
 * member disbands the alliance. Leaving starts the two-hour global delay.
 */
export function leaveAlliance(
  state: CommandState,
  ownerId: string,
  now: number,
  options: { successorOwnerId?: string } = {},
): CommandResult<{ disbanded: boolean }> {
  const membership = selectOwnerMembership(state, ownerId);
  if (!membership) return fail(state, 'not_member', 'Вы не состоите в союзе.');
  const { alliance, role } = membership;
  const others = alliance.members.filter((member) => member.ownerId !== ownerId);

  if (!others.length) {
    const closed = closeRequestsOfAlliance(state, alliance.id, now);
    return { ok: true, disbanded: true, state: leaveCooldown(disband(closed, alliance.id, now), ownerId, 'left', now) };
  }

  let next: AllianceRecord = alliance;
  if (role === 'leader') {
    const successorId = options.successorOwnerId ?? alliance.deputyOwnerId;
    if (!successorId) return fail(state, 'leader_must_transfer', 'Перед выходом передайте лидерство заместителю или другому участнику.');
    if (successorId === ownerId || !others.some((member) => member.ownerId === successorId)) {
      return fail(state, 'target_not_member', 'Преемник должен быть участником союза.');
    }
    next = promote(alliance, successorId, now);
  }
  next = removeMemberFromAlliance(next, ownerId);
  const left = closeRequestsOfAuthor(replaceAlliance(state, next), ownerId, alliance.id, 'author_left', now);
  return { ok: true, disbanded: false, state: leaveCooldown(left, ownerId, 'left', now) };
}

/** Leader may remove anyone; the deputy may remove ordinary members only. Nobody removes themselves this way. */
export function kickMember(state: CommandState, actorOwnerId: string, targetOwnerId: string, now: number): CommandResult {
  const membership = selectOwnerMembership(state, actorOwnerId);
  if (!membership) return fail(state, 'not_member', 'Вы не состоите в союзе.');
  if (!canManageAlliance(membership.role)) return fail(state, 'not_allowed', 'Исключать участников может лидер или заместитель.');
  if (actorOwnerId === targetOwnerId) return fail(state, 'self_target', 'Чтобы уйти, используйте «Покинуть союз».');
  const { alliance } = membership;
  const targetRole = selectRole(alliance, targetOwnerId);
  if (!targetRole) return fail(state, 'target_not_member', 'Этот игрок не состоит в вашем союзе.');
  if (targetRole === 'leader') return fail(state, 'not_allowed', 'Лидера исключить нельзя.');
  if (targetRole === 'deputy' && membership.role !== 'leader') return fail(state, 'not_allowed', 'Заместителя может исключить только лидер.');
  const removed = replaceAlliance(state, removeMemberFromAlliance(alliance, targetOwnerId));
  const next = closeRequestsOfAuthor(removed, targetOwnerId, alliance.id, 'author_left', now);
  return { ok: true, state: leaveCooldown(next, targetOwnerId, 'kicked', now) };
}

/** Only the leader names the single deputy. Pass `null` to dismiss the current one. */
export function setDeputy(state: CommandState, actorOwnerId: string, targetOwnerId: string | null): CommandResult {
  const membership = selectOwnerMembership(state, actorOwnerId);
  if (!membership) return fail(state, 'not_member', 'Вы не состоите в союзе.');
  if (membership.role !== 'leader') return fail(state, 'not_allowed', 'Назначать заместителя может только лидер.');
  const { alliance } = membership;
  if (targetOwnerId === null) return { ok: true, state: replaceAlliance(state, { ...alliance, deputyOwnerId: null }) };
  if (targetOwnerId === actorOwnerId) return fail(state, 'self_target', 'Лидер не может быть заместителем.');
  if (!alliance.members.some((member) => member.ownerId === targetOwnerId)) {
    return fail(state, 'target_not_member', 'Этот игрок не состоит в вашем союзе.');
  }
  if (alliance.deputyOwnerId === targetOwnerId) return { ok: true, state };
  if (alliance.deputyOwnerId) return fail(state, 'deputy_exists', 'В союзе уже есть заместитель. Сначала снимите его.');
  return { ok: true, state: replaceAlliance(state, { ...alliance, deputyOwnerId: targetOwnerId }) };
}

/** The previous leader becomes an ordinary member. */
export function transferLeadership(state: CommandState, actorOwnerId: string, targetOwnerId: string, now: number): CommandResult {
  const membership = selectOwnerMembership(state, actorOwnerId);
  if (!membership) return fail(state, 'not_member', 'Вы не состоите в союзе.');
  if (membership.role !== 'leader') return fail(state, 'not_allowed', 'Передать лидерство может только лидер.');
  if (targetOwnerId === actorOwnerId) return fail(state, 'self_target', 'Вы уже лидер.');
  if (!membership.alliance.members.some((member) => member.ownerId === targetOwnerId)) {
    return fail(state, 'target_not_member', 'Этот игрок не состоит в вашем союзе.');
  }
  return { ok: true, state: replaceAlliance(state, promote(membership.alliance, targetOwnerId, now)) };
}

/**
 * Records that an owner is present. Writes are throttled so a once-a-second UI
 * clock cannot rewrite the save; a changed display name always writes.
 */
export function touchMember(state: CommandState, ownerId: string, now: number, displayName?: string): CommandState {
  const membership = selectOwnerMembership(state, ownerId);
  if (!membership) return state;
  const name = displayName === undefined ? membership.member.displayName : (normalizeAllianceText(displayName).slice(0, 48) || membership.member.displayName);
  const stale = now - membership.member.lastActiveAt >= ACTIVITY_TOUCH_INTERVAL_MS;
  if (!stale && name === membership.member.displayName) return state;
  const alliance: AllianceRecord = {
    ...membership.alliance,
    members: membership.alliance.members.map((member) => member.ownerId === ownerId
      ? { ...member, displayName: name, lastActiveAt: stale ? Math.max(member.lastActiveAt, now) : member.lastActiveAt }
      : member),
  };
  return replaceAlliance(state, alliance);
}

/**
 * Picks the successor of an absent leader: the deputy first, otherwise the
 * member with the most actually delivered resource units (all types equal),
 * then the more recent activity, then more joint operations, then the
 * tie-break value that was drawn once at join. Nobody is re-rolled.
 */
export function pickLeaderSuccessor(alliance: AllianceRecord): AllianceMember | null {
  const candidates = alliance.members.filter((member) => member.ownerId !== alliance.leaderOwnerId);
  if (!candidates.length) return null;
  const deputy = candidates.find((member) => member.ownerId === alliance.deputyOwnerId);
  if (deputy) return deputy;
  return [...candidates].sort((left, right) => right.deliveredUnits - left.deliveredUnits
    || right.lastActiveAt - left.lastActiveAt
    || right.jointOperationCount - left.jointOperationCount
    || right.tieBreaker - left.tieBreaker
    || (left.ownerId < right.ownerId ? -1 : 1))[0];
}

/**
 * Hands leadership to a successor when the leader has been absent for more than
 * 24 hours. Owners listed in `presentOwnerIds` (the local player while the game
 * runs) are never treated as absent. The clock restarts for the new leader.
 */
export function settleLeadership(state: CommandState, now: number, presentOwnerIds: readonly string[] = []): CommandState {
  let next = state;
  for (const alliance of state.alliances) {
    if (presentOwnerIds.includes(alliance.leaderOwnerId)) continue;
    const leader = alliance.members.find((member) => member.ownerId === alliance.leaderOwnerId);
    const lastSeen = Math.max(leader?.lastActiveAt ?? 0, alliance.leaderSince);
    if (now - lastSeen <= LEADER_ABSENCE_MS) continue;
    const successor = pickLeaderSuccessor(alliance);
    if (!successor) continue;
    next = replaceAlliance(next, promote(alliance, successor.ownerId, now));
  }
  return next;
}

/**
 * Presence heartbeat for the local owner. Leadership is settled against the
 * *stored* last-activity stamps first, so a long closed-game gap is never
 * mistaken for continuous presence; only then is the owner's own stamp refreshed.
 * While the game runs the stamp is at most a minute old, so it never triggers.
 */
export function refreshPresence(state: CommandState, ownerId: string, now: number, displayName?: string): CommandState {
  return touchMember(settleLeadership(state, now), ownerId, now, displayName);
}

export { creditDeliveredUnits } from './aid.ts';
