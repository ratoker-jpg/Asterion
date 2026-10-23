import type { NpcProfile } from '../domain/npc/types.ts';
import {
  DEFAULT_ALLIANCE_EMBLEM,
} from '../domain/command/catalog.ts';
import {
  acceptApplication,
  applyToAlliance,
  createAlliance,
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
import type { AllianceSettingsInput, CommandState } from '../domain/command/types.ts';
import type { SaveState } from './contracts.ts';

export type NpcDiplomacyPayload = Readonly<Record<string, string | number | boolean | null>>;
export type NpcDiplomacyCandidate = Readonly<{
  id: string;
  kind: 'create-alliance' | 'apply-to-alliance' | 'accept-application' | 'reject-application' | 'declare-war' | 'propose-truce' | 'respond-truce';
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

  if (!ownMembership) {
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
      for (const alliance of command.alliances) {
        if (isAllianceFull(alliance) || selectReapplyBlock(command, ownerId, alliance.id, at)) continue;
        candidates.push(makeCandidate('apply-to-alliance', `apply-to-alliance:${ownerId}:${alliance.id}`, 0.16 + cooperation * 0.58 + social * 0.12, {
          allianceId: alliance.id,
        }));
      }
    }
  }

  if (ownAlliance && (ownRole === 'leader' || ownRole === 'deputy')) {
    for (const application of command.applications) {
      if (isAllianceFull(ownAlliance)) break;
      if (application.allianceId !== ownAlliance.id || application.status !== 'pending') continue;
      // Player requests remain for the player. Only answer known autonomous NPCs.
      if (application.ownerId === state.profile.playerId || !state.npc?.profiles[application.ownerId]) continue;
      const accepts = cooperation + social * 0.15 >= 0.5;
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
        const accept = cooperation + (1 - aggression) * 0.25 >= 0.62;
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
      } else if (aggression * (0.55 + military * 0.45) >= 0.68) {
        candidates.push(makeCandidate('declare-war', `declare-war:${ownerId}:${other.id}`, 0.12 + aggression * 0.55 + military * 0.2, {
          targetAllianceId: other.id,
        }));
      }
    }
  }

  return candidates.sort((left, right) => right.weight - left.weight || left.id.localeCompare(right.id));
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
      const application = command.applications.find((entry) => entry.id === applicationId);
      if (application?.ownerId !== state.profile.playerId && state.npc?.profiles[application?.ownerId ?? '']) {
        result = acceptApplication(command, ownerId, applicationId, { now: at, random: () => stableFraction(actionId) });
      }
      break;
    }
    case 'reject-application': {
      const applicationId = stringValue('applicationId');
      const application = command.applications.find((entry) => entry.id === applicationId);
      if (application?.ownerId !== state.profile.playerId && state.npc?.profiles[application?.ownerId ?? '']) {
        result = rejectApplication(command, ownerId, applicationId, at);
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
  return { state: nextState, ok: true, reason: 'applied' };
}
