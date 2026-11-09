import type { NpcProfile } from '../domain/npc/types.ts';
import {
  DEFAULT_ALLIANCE_EMBLEM,
  DEPUTY_APPOINT_WEIGHT,
  DEPUTY_MIN_MEMBERS,
  DEPUTY_REPICK_INTERVAL_MS,
  DEPUTY_REPICK_WEIGHT,
} from '../domain/command/catalog.ts';
import { selectOwnerScore } from '../domain/rating/scoring.ts';
import {
  acceptApplication,
  applyToAlliance,
  createAlliance,
  leaveAlliance,
  selectDeputyAppointment,
  setDeputy,
  type DeputyPoints,
  rejectApplication,
} from '../domain/command/membership.ts';
import {
  declareWar,
  proposeTruce,
  respondTruce,
  selectAllianceRelations,
  selectTruceAvailability,
} from '../domain/command/diplomacy.ts';
import {
  isAllianceFull,
  selectCommandHallLevel,
  selectOwnerMembership,
  selectPendingApplication,
  selectReapplyBlock,
} from '../domain/command/selectors.ts';
import type { AllianceRecord, AllianceSettingsInput, CommandState } from '../domain/command/types.ts';
import type { SaveState } from './contracts.ts';
import { applyNpcAllianceHeraldry } from './npc-identity.ts';
import {
  allianceFit,
  bestStrengths,
  joinPull,
  NPC_ALLIANCE_CHOICE,
  npcAllianceTaste,
  npcAllianceVeto,
  npcMembersRefuse,
  recentlyLeftAlliances,
  recordNpcDeparture,
  selectAllianceStrengths,
  selectNpcDefection,
} from './npc-alliance-choice.ts';
import { npcGroupRegard, npcRegard } from './npc-relations.ts';

export type NpcDiplomacyPayload = Readonly<Record<string, string | number | boolean | null>>;
export type NpcDiplomacyCandidate = Readonly<{
  id: string;
  kind: 'create-alliance' | 'apply-to-alliance' | 'leave-alliance' | 'appoint-deputy' | 'accept-application' | 'reject-application' | 'declare-war' | 'propose-truce' | 'respond-truce';
  weight: number;
  payload: NpcDiplomacyPayload;
}>;

type ApplyResult = Readonly<{ state: SaveState; ok: boolean; reason: string }>;

const clamp01 = (value: number) => Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
const weight = (value: number) => Math.round(clamp01(value) * 1_000) / 1_000;

function npcTargets(state: SaveState, ownerId: string) {
  return Object.values(state.espionage?.targets ?? {})
    .filter((target) => target.ownerId === ownerId && target.kind === 'npc')
    .sort((left, right) => left.id.localeCompare(right.id));
}

function publicOwnerName(state: SaveState, ownerId: string): string {
  return npcTargets(state, ownerId)[0]?.ownerName.trim() || ownerId;
}

function ownerHasHall(state: SaveState, ownerId: string): boolean {
  const planets = Object.fromEntries(npcTargets(state, ownerId).map((target) => [target.id, { buildings: target.buildings }]));
  return selectCommandHallLevel(planets) > 0;
}

function relationsById(command: CommandState, allianceId: string) {
  return new Map(selectAllianceRelations(command, allianceId).map((relation) => [relation.id, relation]));
}

function uniqueAllianceSettings(command: CommandState, displayName: string): AllianceSettingsInput {
  const normalized = displayName.trim().replace(/\s+/g, ' ') || 'NPC';
  const base = `${normalized.slice(0, 30).trim() || 'NPC'} Союз`;
  const tagSeed = [...normalized.replace(/[^\p{L}\p{N}]/gu, '')].slice(0, 6).join('').toLocaleUpperCase('ru-RU') || 'NPC';
  const baseTag = tagSeed.length < 2 ? `${tagSeed}1` : tagSeed;
  for (let suffix = 1; suffix <= 999; suffix += 1) {
    const ending = suffix === 1 ? '' : ` ${suffix}`;
    const name = `${base.slice(0, 42 - ending.length)}${ending}`;
    const tagEnding = suffix === 1 ? '' : String(suffix);
    const tag = `${baseTag.slice(0, 8 - tagEnding.length)}${tagEnding}`;
    if (!command.alliances.some((alliance) => alliance.name.toLocaleLowerCase('ru-RU') === name.toLocaleLowerCase('ru-RU')
      || alliance.tag.toLocaleUpperCase('ru-RU') === tag)) {
      return { name, tag, motto: '', description: '', emblem: DEFAULT_ALLIANCE_EMBLEM };
    }
  }
  return { name: `${base.slice(0, 35)} 999`, tag: `${baseTag.slice(0, 5)}999`, motto: '', description: '', emblem: DEFAULT_ALLIANCE_EMBLEM };
}

function stableFraction(key: string): number {
  let hash = 2166136261;
  for (let index = 0; index < key.length; index += 1) hash = Math.imul(hash ^ key.charCodeAt(index), 16777619);
  return (hash >>> 0) / 0x1_0000_0000;
}

function makeCandidate(kind: NpcDiplomacyCandidate['kind'], id: string, score: number, payload: NpcDiplomacyPayload): NpcDiplomacyCandidate {
  return { id, kind, weight: weight(score), payload };
}

/**
 * Returns only legal command-domain options visible to this owner. Private
 * persona values affect weights only; opponent fleets, resources and buildings
 * never influence the candidates.
 */
export function getNpcDiplomacyCandidates(
  state: SaveState,
  profile: NpcProfile,
  at: number,
): NpcDiplomacyCandidate[] {
  const ownerId = profile.ownerId;
  if (!ownerId || ownerId === state.profile.playerId || !npcTargets(state, ownerId).length || !ownerHasHall(state, ownerId)) return [];

  const command = state.command;
  const ownMembership = selectOwnerMembership(command, ownerId);
  const ownAlliance = ownMembership?.alliance;
  const ownRole = ownMembership?.role;
  const pendingOwnApplication = selectPendingApplication(command, ownerId);
  const candidates: NpcDiplomacyCandidate[] = [];
  const cooperation = clamp01(profile.traits.cooperation);
  const aggression = clamp01(profile.traits.aggression);
  const military = clamp01(profile.traits.militaryFocus);
  const social = clamp01(profile.traits.socialStyle);
  const riskTolerance = clamp01(profile.traits.riskTolerance);

  // Not everyone wants an alliance (owner rule 25.10.2026: a solo player can
  // win). A loner by temperament stays solo; so does an owner holding solo
  // crystals, which would crumble on joining.
  const loner = cooperation + social < 0.6;
  const holdsSoloCrystals = (state.sunRaid?.crystals[`owner:${ownerId}`]?.length ?? 0) > 0;
  if (!ownMembership && !loner && !holdsSoloCrystals) {
    if (!pendingOwnApplication && !selectReapplyBlock(command, ownerId, null, at)) {
      const settings = uniqueAllianceSettings(command, publicOwnerName(state, ownerId));
      candidates.push(makeCandidate('create-alliance', `create-alliance:${ownerId}`, 0.18 + cooperation * 0.35 + social * 0.12, {
        name: settings.name,
        tag: settings.tag,
        motto: settings.motto,
        description: settings.description,
      }));
    }

    if (!pendingOwnApplication) {
      // Everyone wants to be with the strong, each by taste: the warlike look at combat points, the economists at
      // resource points. Only public points of the members count; nobody gets a bonus for being the player.
      const strengths = selectAllianceStrengths(state);
      const best = bestStrengths(strengths);
      const taste = npcAllianceTaste(profile);
      const left = recentlyLeftAlliances(command, ownerId, at);
      // The best alliance open to this owner weighs as an alliance did before the choice by strength, the others
      // in proportion to their pull: choosing by strength shifts the applicants, it does not make bots found their own.
      const open: Array<{ alliance: AllianceRecord; regard: number; pull: number }> = [];
      for (const alliance of command.alliances) {
        if (isAllianceFull(alliance) || left.has(alliance.id) || selectReapplyBlock(command, ownerId, alliance.id, at)) continue;
        const regard = npcGroupRegard(state, profile, alliance.members.map((member) => member.ownerId), at);
        // Members who remember a betrayal by this owner would not take it: it does not ask.
        if (regard <= NPC_ALLIANCE_CHOICE.vetoRegard || npcMembersRefuse(state, alliance, ownerId, at)) continue;
        const strength = strengths.get(alliance.id);
        open.push({ alliance, regard, pull: strength ? joinPull(allianceFit(taste, strength, best)) : joinPull(0) });
      }
      const topPull = open.reduce((max, entry) => Math.max(max, entry.pull), 0);
      for (const entry of open) {
        candidates.push(makeCandidate('apply-to-alliance', `apply-to-alliance:${ownerId}:${entry.alliance.id}`, (0.16 + cooperation * 0.58 + social * 0.12) * (topPull > 0 ? entry.pull / topPull : 0) + 0.2 * entry.regard, {
          allianceId: entry.alliance.id,
        }));
      }
    }
  }

  if (ownMembership) {
    const defection = selectNpcDefection(state, profile, at);
    if (defection) candidates.push(makeCandidate('leave-alliance', `leave-alliance:${ownerId}:${ownAlliance!.id}`, defection.score, {
      allianceId: ownAlliance!.id,
      successorOwnerId: defection.successorOwnerId,
    }));
  }

  // The leader names a deputy as soon as the alliance is big enough and re-picks the post now and then by aid delivered
  // and points (the same rule for the player and the bots, nobody is favoured; owner request 09.11.2026).
  // Points are priced only when a decision is possible at all (big enough, and no deputy or the interval is over).
  if (ownAlliance && ownRole === 'leader' && ownAlliance.members.length >= DEPUTY_MIN_MEMBERS
    && (!ownAlliance.deputyOwnerId || at - (ownAlliance.deputySince ?? 0) >= DEPUTY_REPICK_INTERVAL_MS)) {
    const pick = selectDeputyAppointment(ownAlliance, at, deputyPoints(state, ownAlliance));
    if (pick) candidates.push(makeCandidate('appoint-deputy', `appoint-deputy:${ownerId}:${ownAlliance.id}:${pick.ownerId}`, ownAlliance.deputyOwnerId ? DEPUTY_REPICK_WEIGHT : DEPUTY_APPOINT_WEIGHT, {
      targetOwnerId: pick.ownerId,
    }));
  }

  if (ownAlliance && (ownRole === 'leader' || ownRole === 'deputy')) {
    for (const application of command.applications) {
      if (isAllianceFull(ownAlliance)) break;
      if (application.allianceId !== ownAlliance.id || application.status !== 'pending') continue;
      // Every applicant gets an answer, the player included and with no priority: the character and what the
      // answering owner and the members remember of the applicant decide (owner order 04.11.2026).
      // A familiar applicant tilts the answer, it does not decide it, except a remembered betrayal, which refuses.
      const accepts = cooperation + social * 0.15 + 0.15 * npcRegard(state, profile, application.ownerId, at) >= 0.5
        && !npcAllianceVeto(state, ownAlliance, profile, application.ownerId, at);
      candidates.push(makeCandidate(accepts ? 'accept-application' : 'reject-application', `${accepts ? 'accept' : 'reject'}-application:${ownerId}:${application.id}`, accepts ? 0.25 + cooperation * 0.55 : 0.2 + (1 - cooperation) * 0.4, {
        applicationId: application.id,
      }));
    }

    const relations = relationsById(command, ownAlliance.id);
    for (const other of command.alliances) {
      if (other.id === ownAlliance.id) continue;
      const relation = relations.get(other.id);
      if (relation?.status === 'war' && relation.truce?.byAllianceId === other.id) {
        // Do not make an unattended NPC accept or reject a player's offer.
        if (other.members.some((member) => member.ownerId === state.profile.playerId)) continue;
        const accept = cooperation + (1 - aggression) * 0.25 + 0.15 * npcGroupRegard(state, profile, other.members.map((member) => member.ownerId), at) >= 0.62;
        candidates.push(makeCandidate('respond-truce', `respond-truce:${ownerId}:${other.id}:${accept}`, accept ? 0.35 + cooperation * 0.4 : 0.22 + aggression * 0.3, {
          fromAllianceId: other.id,
          accept,
        }));
      } else if (relation?.status === 'war') {
        const available = selectTruceAvailability(command, ownAlliance.id, other.id, { now: at });
        if (available.state === 'ready' && cooperation + (1 - riskTolerance) * 0.2 >= 0.55) {
          candidates.push(makeCandidate('propose-truce', `propose-truce:${ownerId}:${other.id}`, 0.3 + cooperation * 0.45, {
            targetAllianceId: other.id,
          }));
        }
      } else if (aggression * (0.55 + military * 0.45) - 0.3 * npcGroupRegard(state, profile, other.members.map((member) => member.ownerId), at) >= 0.68) {
        // Old scores push toward war, friends in the other alliance hold it back.
        candidates.push(makeCandidate('declare-war', `declare-war:${ownerId}:${other.id}`, 0.12 + aggression * 0.55 + military * 0.2, {
          targetAllianceId: other.id,
        }));
      }
    }
  }

  return candidates.sort((left, right) => right.weight - left.weight || left.id.localeCompare(right.id));
}

/** Public total points of the alliance's members: the same numbers the rating shows. */
function deputyPoints(state: SaveState, alliance: AllianceRecord): DeputyPoints {
  const points: Record<string, number> = {};
  for (const member of alliance.members) points[member.ownerId] = selectOwnerScore(state, member.ownerId)?.totalPoints ?? 0;
  return points;
}

/** Applies one candidate through existing command laws; semantic guards make replayed ids no-op after first success. */
export function applyNpcDiplomacyAction(
  state: SaveState,
  ownerId: string,
  candidate: NpcDiplomacyCandidate,
  at: number,
  actionId: string,
): ApplyResult {
  if (!actionId.trim()) return { state, ok: false, reason: 'invalid_action_id' };
  if (!ownerId || ownerId === state.profile.playerId || !npcTargets(state, ownerId).length) {
    return { state, ok: false, reason: 'not_npc_owner' };
  }
  if (!ownerHasHall(state, ownerId)) return { state, ok: false, reason: 'hall_required' };

  const command = state.command;
  const name = publicOwnerName(state, ownerId);
  let result: { ok: boolean; state: CommandState; code?: string } | null = null;
  const stringValue = (key: string) => typeof candidate.payload[key] === 'string' ? candidate.payload[key] as string : '';

  switch (candidate.kind) {
    case 'create-alliance': {
      const settings = uniqueAllianceSettings(command, name);
      // Candidate input is a snapshot; regenerate public identity if state changed meanwhile.
      result = createAlliance(command, { ownerId, displayName: name, settings }, { now: at, random: () => stableFraction(actionId) });
      break;
    }
    case 'apply-to-alliance': {
      const allianceId = stringValue('allianceId');
      if (allianceId) result = applyToAlliance(command, { ownerId, displayName: name, allianceId }, { now: at });
      break;
    }
    case 'accept-application': {
      const applicationId = stringValue('applicationId');
      result = acceptApplication(command, ownerId, applicationId, { now: at, random: () => stableFraction(actionId) });
      break;
    }
    case 'reject-application': {
      const applicationId = stringValue('applicationId');
      result = rejectApplication(command, ownerId, applicationId, at);
      break;
    }
    case 'appoint-deputy': {
      // Re-checked at the moment of the act: the snapshot may be stale, the ranking may have moved.
      const alliance = selectOwnerMembership(command, ownerId)?.alliance;
      const target = stringValue('targetOwnerId');
      if (!alliance || selectDeputyAppointment(alliance, at, deputyPoints(state, alliance))?.ownerId !== target) break;
      result = setDeputy(command, ownerId, target, at, { replace: true });
      break;
    }
    case 'leave-alliance': {
      // Re-checked at the moment of the act: the snapshot may be stale, the stakes or the tenure may have changed.
      const defection = selectNpcDefection(state, state.npc!.profiles[ownerId]!, at);
      const membership = selectOwnerMembership(command, ownerId);
      if (defection && membership && membership.alliance.id === stringValue('allianceId')) {
        result = leaveAlliance(command, ownerId, at, defection.successorOwnerId ? { successorOwnerId: defection.successorOwnerId } : {});
        if (result.ok) {
          const left = recordNpcDeparture({ ...state, command: result.state }, ownerId, membership.alliance, at);
          const successor = defection.successorOwnerId;
          const crested = successor ? applyNpcAllianceHeraldry(left.command, successor, state.npc!.profiles) : left.command;
          return { state: crested === left.command ? left : { ...left, command: crested }, ok: true, reason: 'applied' };
        }
      }
      break;
    }
    case 'declare-war': {
      const targetAllianceId = stringValue('targetAllianceId');
      if (targetAllianceId) result = declareWar(command, ownerId, targetAllianceId, { now: at });
      break;
    }
    case 'propose-truce': {
      const targetAllianceId = stringValue('targetAllianceId');
      if (targetAllianceId) result = proposeTruce(command, ownerId, targetAllianceId, { now: at });
      break;
    }
    case 'respond-truce': {
      const fromAllianceId = stringValue('fromAllianceId');
      const accept = candidate.payload.accept;
      const fromAlliance = command.alliances.find((alliance) => alliance.id === fromAllianceId);
      if (fromAllianceId && typeof accept === 'boolean' && !fromAlliance?.members.some((member) => member.ownerId === state.profile.playerId)) {
        result = respondTruce(command, ownerId, fromAllianceId, accept, { now: at });
      }
      break;
    }
  }

  if (!result) return { state, ok: false, reason: 'candidate_no_longer_legal' };
  const nextState = result.state === command ? state : { ...state, command: result.state };
  if (!result.ok || result.state === command) return { state: nextState, ok: false, reason: result.code ?? 'no_change' };
  // A new alliance, a war or a truce is a reason for the leadership to redraw its crest.
  const crested = state.npc ? applyNpcAllianceHeraldry(nextState.command, ownerId, state.npc.profiles) : nextState.command;
  return { state: crested === nextState.command ? nextState : { ...nextState, command: crested }, ok: true, reason: 'applied' };
}
