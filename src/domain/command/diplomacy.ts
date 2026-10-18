import { TRUCE_OFFER_DELAY_MS } from './catalog.ts';
import { canManageAlliance, selectOwnerMembership } from './selectors.ts';
import type { AllianceRecord, CommandErrorCode, CommandResult, CommandState, DiplomaticRelation } from './types.ts';

/**
 * Alliance diplomacy (concept §8): war is declared at once by a leader or deputy,
 * without the other side's consent; a truce may be offered 3 h after the war
 * began, the other leadership accepts or rejects it, and after a rejection a
 * new offer is possible 3 h later. Accepting ends the war. No combat bonuses.
 *
 * `elapsedScale` lets Test Mode run the 3-hour timers on its accelerated clock
 * (the same factor as the aid charges); production always passes 1.
 */
export type DiplomacyOptions = { now: number; elapsedScale?: number };

function fail(state: CommandState, code: CommandErrorCode, message: string, retryAt?: number): CommandResult<never> {
  return retryAt === undefined ? { ok: false, state, code, message } : { ok: false, state, code, message, retryAt };
}

function viewOf(state: CommandState, ownerAllianceId: string, otherAllianceId: string): DiplomaticRelation | undefined {
  return state.diplomacy.find((relation) => relation.ownerAllianceId === ownerAllianceId && relation.id === otherAllianceId);
}

function withoutPair(relations: readonly DiplomaticRelation[], a: string, b: string): DiplomaticRelation[] {
  return relations.filter((relation) => !(
    (relation.ownerAllianceId === a && relation.id === b) || (relation.ownerAllianceId === b && relation.id === a)
  ));
}

function patchPair(state: CommandState, a: string, b: string, patch: Partial<DiplomaticRelation>): DiplomaticRelation[] {
  return state.diplomacy.map((relation) => (
    (relation.ownerAllianceId === a && relation.id === b) || (relation.ownerAllianceId === b && relation.id === a)
      ? { ...relation, ...patch }
      : relation
  ));
}

function scaledElapsed(from: number, options: DiplomacyOptions) {
  return Math.max(0, options.now - from) * Math.max(1, options.elapsedScale ?? 1);
}

/** Wall-clock instant when `TRUCE_OFFER_DELAY_MS` of scaled time has passed since `from`. */
function readyAt(from: number, options: DiplomacyOptions) {
  return from + Math.ceil(TRUCE_OFFER_DELAY_MS / Math.max(1, options.elapsedScale ?? 1));
}

type Leadership = { ok: true; alliance: AllianceRecord } | { ok: false; result: CommandResult<never> };

function requireLeadership(state: CommandState, actorOwnerId: string): Leadership {
  const membership = selectOwnerMembership(state, actorOwnerId);
  if (!membership) return { ok: false, result: fail(state, 'not_member', 'Сначала вступите в союз.') };
  if (!canManageAlliance(membership.role)) return { ok: false, result: fail(state, 'not_allowed', 'Дипломатией управляют лидер и заместитель.') };
  return { ok: true, alliance: membership.alliance };
}

/** Relations of one alliance, refreshed with the current name/tag of the other side; stale views are skipped. */
export function selectAllianceRelations(state: Pick<CommandState, 'alliances' | 'diplomacy'>, allianceId: string): DiplomaticRelation[] {
  const byId = new Map(state.alliances.map((alliance) => [alliance.id, alliance]));
  if (!byId.has(allianceId)) return [];
  return state.diplomacy
    .filter((relation) => relation.ownerAllianceId === allianceId && byId.has(relation.id))
    .map((relation) => {
      const other = byId.get(relation.id)!;
      return { ...relation, allianceName: other.name, tag: other.tag };
    });
}

export type TruceAvailability =
  | { state: 'none' }
  | { state: 'wait'; until: number }
  | { state: 'sent' }
  | { state: 'received' }
  | { state: 'ready' };

/** What the viewing alliance can do about a truce in its war with `otherAllianceId`. */
export function selectTruceAvailability(state: CommandState, allianceId: string, otherAllianceId: string, options: DiplomacyOptions): TruceAvailability {
  const view = viewOf(state, allianceId, otherAllianceId);
  if (!view || view.status !== 'war') return { state: 'none' };
  if (view.truce) return view.truce.byAllianceId === allianceId ? { state: 'sent' } : { state: 'received' };
  const since = view.since ?? 0;
  if (scaledElapsed(since, options) < TRUCE_OFFER_DELAY_MS) return { state: 'wait', until: readyAt(since, options) };
  if (view.truceRejectedAt && scaledElapsed(view.truceRejectedAt, options) < TRUCE_OFFER_DELAY_MS) {
    return { state: 'wait', until: readyAt(view.truceRejectedAt, options) };
  }
  return { state: 'ready' };
}

export function declareWar(state: CommandState, actorOwnerId: string, targetAllianceId: string, options: DiplomacyOptions): CommandResult {
  const leadership = requireLeadership(state, actorOwnerId);
  if (!leadership.ok) return leadership.result;
  const own = leadership.alliance;
  const target = state.alliances.find((alliance) => alliance.id === targetAllianceId);
  if (!target) return fail(state, 'alliance_not_found', 'Союз не найден.');
  if (target.id === own.id) return fail(state, 'not_allowed', 'Нельзя объявить войну своему союзу.');
  if (viewOf(state, own.id, target.id)?.status === 'war') return fail(state, 'not_allowed', `Война с «${target.name}» уже идёт.`);

  const base = { status: 'war' as const, since: options.now, declaredByAllianceId: own.id, truce: null, truceRejectedAt: null };
  return {
    ok: true,
    state: {
      ...state,
      diplomacy: [
        ...withoutPair(state.diplomacy, own.id, target.id),
        { ...base, id: target.id, allianceName: target.name, tag: target.tag, ownerAllianceId: own.id },
        { ...base, id: own.id, allianceName: own.name, tag: own.tag, ownerAllianceId: target.id },
      ],
    },
  };
}

export function proposeTruce(state: CommandState, actorOwnerId: string, targetAllianceId: string, options: DiplomacyOptions): CommandResult {
  const leadership = requireLeadership(state, actorOwnerId);
  if (!leadership.ok) return leadership.result;
  const own = leadership.alliance;
  const availability = selectTruceAvailability(state, own.id, targetAllianceId, options);
  if (availability.state === 'none') return fail(state, 'not_allowed', 'Перемирие предлагают только во время войны.');
  if (availability.state === 'sent') return fail(state, 'not_allowed', 'Предложение уже отправлено — ждём ответа.');
  if (availability.state === 'received') return fail(state, 'not_allowed', 'Другая сторона уже предложила перемирие — ответьте на него.');
  if (availability.state === 'wait') return fail(state, 'cooldown', 'Предложить перемирие пока нельзя.', availability.until);
  return { ok: true, state: { ...state, diplomacy: patchPair(state, own.id, targetAllianceId, { truce: { byAllianceId: own.id, at: options.now } }) } };
}

/** The leadership of the alliance that received the offer accepts (war ends) or rejects it (3-hour pause). */
export function respondTruce(state: CommandState, actorOwnerId: string, fromAllianceId: string, accept: boolean, options: DiplomacyOptions): CommandResult {
  const leadership = requireLeadership(state, actorOwnerId);
  if (!leadership.ok) return leadership.result;
  const own = leadership.alliance;
  const view = viewOf(state, own.id, fromAllianceId);
  if (!view || view.status !== 'war' || !view.truce || view.truce.byAllianceId !== fromAllianceId) {
    return fail(state, 'not_allowed', 'Предложения перемирия нет.');
  }
  if (accept) return { ok: true, state: { ...state, diplomacy: withoutPair(state.diplomacy, own.id, fromAllianceId) } };
  return { ok: true, state: { ...state, diplomacy: patchPair(state, own.id, fromAllianceId, { truce: null, truceRejectedAt: options.now }) } };
}

/** Drops relation views whose alliances no longer exist (disbanded alliances end their wars). */
export function pruneDiplomacy(relations: readonly DiplomaticRelation[], allianceIds: ReadonlySet<string>): DiplomaticRelation[] {
  return relations.filter((relation) => !relation.ownerAllianceId || (allianceIds.has(relation.ownerAllianceId) && allianceIds.has(relation.id)));
}
