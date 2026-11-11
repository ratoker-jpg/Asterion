import { acceptApplication, applyToAlliance } from '../domain/command/membership.ts';
import {
  isAllianceFull, selectAllianceById, selectOwnerMembership, selectPendingApplication, selectReapplyBlock, selectRole,
} from '../domain/command/selectors.ts';
import type { BattleReport } from '../domain/combat/report.ts';
import { isNpcLetterOpen, NPC_LETTER_BALANCE, type NpcLetterRecord } from '../domain/npc/letters.ts';
import type { NpcJointStrikeProposal } from '../domain/npc/pacts.ts';
import type { NpcProfile } from '../domain/npc/types.ts';
import { selectOwnerScore } from '../domain/rating/scoring.ts';
import { createSeededRandom } from '../domain/world/random.ts';
import { evaluatePlanetAttackEligibility } from './attack-eligibility.ts';
import type { SaveState } from './contracts.ts';
import { npcAllianceTaste, npcMembersRefuse, selectAllianceStrengths } from './npc-alliance-choice.ts';
import {
  journalNpcLetter, mayWritePlayer, npcLettersOf, playerInvitations, queueNpcReply, withNpcLetter,
} from './npc-letter-state.ts';
import { journalNpcPact, recordNpcPactArrival, withNpcPact } from './npc-pact-state.ts';
import { npcRelationView, recordNpcRelation } from './npc-relations.ts';
import type { NpcUtilityContext } from './npc-utility.ts';

/**
 * The bots' letters to the player («Сообщения» → «Личные») and what the
 * player's «Принять» / «Отказаться» does. Three kinds are written here (a
 * joint-strike invitation is written by the pact code, npc-pacts.ts):
 *
 * - `help-request`: an allied or friendly bot sees an attack coming at its
 *   planet. «Принять» is a promise to bring a deployment before the enemy lands;
 *   it is kept or broken by what the player's flights really did.
 * - `ally-offer`: the leader of an alliance with room, for a player who has no
 *   alliance and is worth about its average member by the leader's taste.
 *   «Принять» joins at once through the ordinary application commands.
 * - `reply`: a line back after a refusal, a no-show or a betrayal.
 *
 * A bot never writes more than the budget in npc-letter-state.ts allows.
 */

const MINUTE = 60_000;
const HOUR = 3_600_000;
const unit = (value: number) => Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));
const isPlayerFlight = (ownerSide: string | undefined) => ownerSide === undefined || ownerSide === 'player';

export type LetterRef = Readonly<{ kind: 'joint-strike' | 'help-request' | 'ally-offer'; id: string }>;
export type LetterOutcome = { ok: true; state: SaveState } | { ok: false; reason: string };

/* ------------------------------------------------------------- the writing */

/** The nearest attack at one of the bot's planets that has not landed yet and is not the player's own. */
function incomingAttack(state: SaveState, planetIds: ReadonlySet<string>, botId: string, at: number) {
  const playerId = state.profile.playerId;
  return state.flights.records
    .filter((flight) => flight.phase === 'outbound' && flight.arrivalAt > at && flight.ownerId !== botId && flight.ownerId !== playerId
      && (flight.missionId === 'attack' || flight.missionId === 'pirate-raid')
      && flight.destinationPlanetId !== undefined && planetIds.has(flight.destinationPlanetId))
    .sort((left, right) => left.arrivalAt - right.arrivalAt || (left.id < right.id ? -1 : 1))[0];
}

function considerHelpRequest(state: SaveState, profile: NpcProfile, utility: NpcUtilityContext, at: number): SaveState {
  const botId = profile.ownerId;
  const playerId = state.profile.playerId;
  if (unit(profile.traits.cooperation) < 0.35 || !mayWritePlayer(state, botId, at)) return state;
  const mine = selectOwnerMembership(state.command, botId);
  const sameAlliance = Boolean(mine && selectOwnerMembership(state.command, playerId)?.alliance.id === mine.alliance.id);
  const regard = npcRelationView(state, profile, playerId, at)?.regard ?? 0;
  // Allies ask unless they have reason not to; others ask only a friend.
  if (sameAlliance ? regard <= -0.1 : regard < 0.3) return state;
  const attack = incomingAttack(state, new Set(utility.ownPlanets.map((planet) => planet.id)), botId, at);
  if (!attack || attack.arrivalAt - at < NPC_LETTER_BALANCE.helpMinLeadMinutes * MINUTE) return state;
  const letterId = `help:${botId}:${attack.id}`;
  if (npcLettersOf(state).some((item) => item.letterId === letterId)) return state;
  const letter: NpcLetterRecord = {
    letterId, kind: 'help-request', from: botId, createdAt: at, expiresAt: attack.arrivalAt, status: 'new',
    planetId: attack.destinationPlanetId, ...(attack.ownerId ? { attackerId: attack.ownerId } : {}), arrivalAt: attack.arrivalAt,
  };
  journalNpcLetter(at, botId, 'written', letter, { planet: attack.destinationPlanetId ?? '', arrivalAt: attack.arrivalAt });
  return withNpcLetter(state, letter);
}

/** How much this leader wants the player in: the player's points against the alliance's average member, by the leader's taste. */
export function allianceWantOfPlayer(state: SaveState, profile: NpcProfile, allianceId: string): number {
  const strength = selectAllianceStrengths(state).get(allianceId);
  const score = selectOwnerScore(state, state.profile.playerId);
  if (!strength || !strength.size || !score) return 0;
  const taste = npcAllianceTaste(profile);
  const share = (value: number, total: number) => (total > 0 ? Math.min(1, value / (total / strength.size)) : 1);
  return taste.combat * share(score.battlePoints ?? 0, strength.combat) + taste.resource * share(score.resourcePoints ?? 0, strength.resource)
    + taste.any * share(score.totalPoints ?? 0, strength.total);
}

function considerAllyOffer(state: SaveState, profile: NpcProfile, at: number): SaveState {
  const botId = profile.ownerId;
  const playerId = state.profile.playerId;
  if (unit(profile.traits.cooperation) < 0.4 || selectOwnerMembership(state.command, playerId) || !mayWritePlayer(state, botId, at)) return state;
  const alliance = state.command.alliances.find((item) => selectRole(item, botId) === 'leader');
  if (!alliance || isAllianceFull(alliance) || selectPendingApplication(state.command, playerId) || selectReapplyBlock(state.command, playerId, alliance.id, at)) return state;
  const again = NPC_LETTER_BALANCE.allyAgainHours * HOUR;
  if (npcLettersOf(state).some((item) => item.kind === 'ally-offer' && (item.allianceId === alliance.id || item.from === botId) && at - item.createdAt < again)) return state;
  // One offer waits at a time, whoever wrote it.
  if (npcLettersOf(state).some((item) => item.kind === 'ally-offer' && item.status === 'new' && at < item.expiresAt)) return state;
  // Members who remember a betrayal do not take the player in.
  if (npcMembersRefuse(state, alliance, playerId, at)) return state;
  if (allianceWantOfPlayer(state, profile, alliance.id) < NPC_LETTER_BALANCE.allyWant) return state;
  const letter: NpcLetterRecord = {
    letterId: `ally:${botId}:${at}`, kind: 'ally-offer', from: botId, createdAt: at,
    expiresAt: at + NPC_LETTER_BALANCE.allyAnswerHours * HOUR, status: 'new', allianceId: alliance.id,
  };
  journalNpcLetter(at, botId, 'written', letter, { alliance: alliance.id });
  return withNpcLetter(state, letter);
}

/**
 * Closes what ran out: an unanswered letter expires; an accepted help request is
 * kept or broken by what the player's flights really did before the enemy landed.
 */
export function settleNpcLetters(state: SaveState, at: number): SaveState {
  const playerId = state.profile.playerId;
  let next = state;
  for (const letter of npcLettersOf(state)) {
    if (!isNpcLetterOpen(letter) || at < letter.expiresAt) continue;
    if (letter.status === 'new') {
      journalNpcLetter(at, letter.from, 'expired', letter);
      next = withNpcLetter(next, { ...letter, status: 'expired', closedAt: at });
      continue;
    }
    const decidedAt = letter.decidedAt ?? letter.createdAt;
    const kept = next.flights.records.some((flight) => isPlayerFlight(flight.ownerSide) && (flight.ownerId === undefined || flight.ownerId === playerId)
      && flight.missionId === 'deployment' && flight.destinationPlanetId === letter.planetId
      && flight.departedAt >= decidedAt && flight.arrivalAt <= letter.expiresAt);
    if (kept) {
      next = recordNpcRelation(next, letter.from, playerId, { kind: 'promise-kept' }, at);
      next = recordNpcRelation(next, letter.from, playerId, { kind: 'help-received', amount: 0, weight: 0.8 }, at);
    } else {
      next = recordNpcRelation(next, letter.from, playerId, { kind: 'promise-broken' }, at);
      next = queueNpcReply(next, letter.from, 'no-show', at);
    }
    journalNpcLetter(at, letter.from, kept ? 'kept' : 'failed', letter);
    next = withNpcLetter(next, { ...letter, status: kept ? 'kept' : 'failed', closedAt: at, ...(kept ? {} : { reason: 'no-help' }) });
  }
  return next;
}

/** Each look of a bot: what ran out closes, and (rarely) a letter is written. */
export function refreshNpcLetters(state: SaveState, profile: NpcProfile, utility: NpcUtilityContext, at: number): SaveState {
  let next = settleNpcLetters(state, at);
  next = considerHelpRequest(next, profile, utility, at);
  return considerAllyOffer(next, profile, at);
}

/* -------------------------------------------------------- the player's answer */

function acceptInvitation(state: SaveState, proposal: NpcJointStrikeProposal, now: number): LetterOutcome {
  const playerId = state.profile.playerId;
  if (proposal.status !== 'proposed' || now >= proposal.expiresAt) return { ok: false, reason: 'Приглашение уже не действует.' };
  if ((state.npcStrategy?.proposals ?? []).some((item) => item.proposalId !== proposal.proposalId && item.kind === 'joint-strike' && item.status === 'accepted'
    && (item.to === playerId || item.from === playerId))) return { ok: false, reason: 'Вы уже участвуете в другой совместной атаке.' };
  if (!evaluatePlanetAttackEligibility(state, playerId, proposal.terms.targetOwnerId, undefined, now).allowed) {
    return { ok: false, reason: 'Эту цель вам сейчас атаковать нельзя (защита, щит или разница в очках).' };
  }
  const accepted: NpcJointStrikeProposal = { ...proposal, status: 'accepted', decidedAt: now };
  journalNpcPact(now, proposal.from, 'accepted', accepted, { by: 'player' });
  return { ok: true, state: withNpcPact(state, accepted) };
}

function declineInvitation(state: SaveState, proposal: NpcJointStrikeProposal, now: number): LetterOutcome {
  const playerId = state.profile.playerId;
  if (proposal.status !== 'proposed' || now >= proposal.expiresAt) return { ok: false, reason: 'Приглашение уже не действует.' };
  journalNpcPact(now, proposal.from, 'declined', proposal, { why: 'player-declined' });
  let next = withNpcPact(state, { ...proposal, status: 'declined', decidedAt: now, closedAt: now, reason: 'player-declined', by: playerId });
  next = recordNpcRelation(next, proposal.from, playerId, { kind: 'refused' }, now);
  return { ok: true, state: queueNpcReply(next, proposal.from, 'declined', now) };
}

function joinAlliance(state: SaveState, letter: NpcLetterRecord, now: number): LetterOutcome {
  const playerId = state.profile.playerId;
  const alliance = letter.allianceId ? selectAllianceById(state.command, letter.allianceId) : null;
  if (!alliance) return { ok: false, reason: 'Этого союза больше нет.' };
  const random = createSeededRandom(JSON.stringify(['npc-letter-join', letter.letterId]));
  const applied = applyToAlliance(state.command, { ownerId: playerId, displayName: state.profile.displayName, allianceId: alliance.id }, { now, random });
  if (!applied.ok) return { ok: false, reason: applied.message };
  const joined = acceptApplication(applied.state, alliance.leaderOwnerId, applied.applicationId, { now, random });
  if (!joined.ok) return { ok: false, reason: joined.message };
  return { ok: true, state: { ...state, command: joined.state } };
}

/** The player's «Принять» or «Отказаться» on one letter, applied to the save at `now`. */
export function answerNpcLetter(state: SaveState, ref: LetterRef, answer: 'accept' | 'decline', now: number): LetterOutcome {
  const playerId = state.profile.playerId;
  if (ref.kind === 'joint-strike') {
    const proposal = playerInvitations(state).find((item) => item.proposalId === ref.id);
    if (!proposal) return { ok: false, reason: 'Письма уже нет.' };
    return answer === 'accept' ? acceptInvitation(state, proposal, now) : declineInvitation(state, proposal, now);
  }
  const letter = npcLettersOf(state).find((item) => item.letterId === ref.id);
  if (!letter) return { ok: false, reason: 'Письма уже нет.' };
  if (letter.status !== 'new' || now >= letter.expiresAt) return { ok: false, reason: 'Письмо уже не действует.' };
  if (answer === 'decline') {
    journalNpcLetter(now, letter.from, 'declined', letter);
    let next = withNpcLetter(state, { ...letter, status: 'declined', decidedAt: now, closedAt: now });
    next = recordNpcRelation(next, letter.from, playerId, { kind: 'refused' }, now);
    return { ok: true, state: queueNpcReply(next, letter.from, 'declined', now) };
  }
  if (letter.kind === 'ally-offer') {
    const joined = joinAlliance(state, letter, now);
    if (!joined.ok) return joined;
    journalNpcLetter(now, letter.from, 'accepted', letter);
    // Joined at once: the offer is done, and the leader's trust grows a little.
    const done = withNpcLetter(joined.state, { ...letter, status: 'accepted', decidedAt: now, closedAt: now });
    return { ok: true, state: recordNpcRelation(done, letter.from, playerId, { kind: 'promise-kept' }, now) };
  }
  journalNpcLetter(now, letter.from, 'accepted', letter);
  return { ok: true, state: withNpcLetter(state, { ...letter, status: 'accepted', decidedAt: now }) };
}

/* ------------------------------------------------------ the player's part of a strike */

/**
 * The player's own attack on the target of an accepted invitation counts as his
 * part of it when it lands inside the window: a scatter of ten minutes before
 * the bot's wave to two tolerances after. Called after every battle.
 */
export function recordPlayerPactArrival(state: SaveState, report: BattleReport, at: number): SaveState {
  const playerId = state.profile.playerId;
  if (!playerId || report.attacker.playerId !== playerId || !state.npcStrategy?.proposals?.length) return state;
  const defender = report.defender.playerId;
  const pact = playerInvitations(state).find((item) => item.status === 'accepted' && item.terms.targetOwnerId === defender
    && at >= item.terms.strikeAt - NPC_LETTER_BALANCE.scatterMinutes * MINUTE && at <= item.terms.strikeAt + 2 * item.terms.toleranceMs
    && !item.arrivals?.[playerId]);
  return pact ? recordNpcPactArrival(state, pact.proposalId, playerId, { at, won: report.winner === 'attacker', gain: 0, loss: 0 }) : state;
}
