import { selectOwnerMembership, selectPendingApplication } from '../domain/command/selectors.ts';
import type { NpcProfile } from '../domain/npc/types.ts';
import type { SaveState } from './contracts.ts';
import { npcAllianceTaste } from './npc-alliance-choice.ts';
import { applyNpcDiplomacyAction, getNpcDiplomacyCandidates } from './npc-diplomacy.ts';

/**
 * «Им подходит ваш союз» on the first screen of a new alliance: bots without an
 * alliance that, by their own choice (`getNpcDiplomacyCandidates`, the same
 * rule they act on), would ask to join this one. Nothing is stored: the list is
 * read from the save every time, so old saves show it as well.
 */
export type AllianceProspect = Readonly<{
  ownerId: string;
  name: string;
  /** The bot's race as its planets show it on the map (a bot without an alliance has no crest to show). */
  factionId?: string;
  /** What the bot looks for in an alliance, in words. */
  reason: string;
  /** 0..1 against the other prospects: how keen it is. */
  keenness: number;
}>;

export const ALLIANCE_PROSPECT_LIMIT = 4;

function ownerTarget(state: SaveState, ownerId: string) {
  return Object.values(state.espionage?.targets ?? {}).find((item) => item.ownerId === ownerId && item.kind === 'npc');
}

function ownerName(state: SaveState, ownerId: string): string {
  return ownerTarget(state, ownerId)?.ownerName.trim() || ownerId;
}

/** What the bot looks for, from the same taste its choice uses. */
export function prospectReason(profile: NpcProfile): string {
  const taste = npcAllianceTaste(profile);
  if (taste.combat >= 0.55) return 'ищет боевой союз';
  if (taste.resource >= 0.55) return 'ищет союз с сильной экономикой';
  if (profile.traits.cooperation >= 0.7) return 'любит помогать союзникам';
  return 'ищет союз по силам';
}

function applyCandidate(state: SaveState, profile: NpcProfile, allianceId: string, at: number) {
  return getNpcDiplomacyCandidates(state, profile, at)
    .find((candidate) => candidate.kind === 'apply-to-alliance' && candidate.payload.allianceId === allianceId) ?? null;
}

/** Up to `limit` bots that would ask to join `allianceId` now, keenest first. */
export function selectAllianceProspects(state: SaveState, allianceId: string, at: number, limit = ALLIANCE_PROSPECT_LIMIT): AllianceProspect[] {
  const profiles = state.npc?.profiles;
  if (!profiles || !state.command.alliances.some((alliance) => alliance.id === allianceId)) return [];
  const found: Array<{ profile: NpcProfile; weight: number }> = [];
  for (const profile of Object.values(profiles)) {
    if (!profile || profile.ownerId === state.profile.playerId) continue;
    if (selectOwnerMembership(state.command, profile.ownerId) || selectPendingApplication(state.command, profile.ownerId)) continue;
    const candidate = applyCandidate(state, profile, allianceId, at);
    if (candidate && candidate.weight > 0) found.push({ profile, weight: candidate.weight });
  }
  found.sort((left, right) => right.weight - left.weight || left.profile.ownerId.localeCompare(right.profile.ownerId));
  const top = found[0]?.weight ?? 0;
  return found.slice(0, limit).map(({ profile, weight }) => ({
    ownerId: profile.ownerId,
    name: ownerName(state, profile.ownerId),
    ...(ownerTarget(state, profile.ownerId)?.raceId ? { factionId: ownerTarget(state, profile.ownerId)!.raceId } : {}),
    reason: prospectReason(profile),
    keenness: top > 0 ? Math.round((weight / top) * 100) / 100 : 0,
  }));
}

export type ProspectInvitation = Readonly<{ state: SaveState; ok: true; name: string } | { state: SaveState; ok: false; message: string }>;

/**
 * «Позвать»: the bot is asked now instead of at its next turn. It files an
 * ordinary application only if it still wants this alliance by its own rule;
 * the leader then accepts it in «Заявки» as any other.
 */
export function inviteAllianceProspect(state: SaveState, allianceId: string, npcOwnerId: string, at: number): ProspectInvitation {
  const profile = state.npc?.profiles[npcOwnerId];
  const name = ownerName(state, npcOwnerId);
  if (!profile) return { state, ok: false, message: 'Этот командир не отвечает на приглашения.' };
  if (selectPendingApplication(state.command, npcOwnerId)) return { state, ok: false, message: `«${name}» уже ждёт ответа на другую заявку.` };
  const candidate = applyCandidate(state, profile, allianceId, at);
  if (!candidate) return { state, ok: false, message: `«${name}» сейчас не хочет в ваш союз.` };
  const applied = applyNpcDiplomacyAction(state, npcOwnerId, candidate, at, `invite:${allianceId}:${npcOwnerId}:${at}`);
  if (!applied.ok) return { state, ok: false, message: `Заявка от «${name}» не прошла: условия изменились.` };
  return { state: applied.state, ok: true, name };
}
