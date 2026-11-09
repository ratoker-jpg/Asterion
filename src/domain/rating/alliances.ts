import { selectAllianceCatalog, selectOwnerMembership, selectRole } from '../command/selectors.ts';
import type { AllianceRecord, AllianceRole, CommandState } from '../command/types.ts';
import type { AllianceRatingEntry, OwnerScore } from './types.ts';

/**
 * Rating rows for the alliances that actually exist in the saved world. An
 * empty world yields an empty list; nothing is invented to fill the table.
 */
export function createAllianceRatingEntries(
  command: Pick<CommandState, 'alliances'>,
  ownerScores: Readonly<Record<string, OwnerScore | undefined>>,
  currentOwnerId: string,
): AllianceRatingEntry[] {
  const currentAllianceId = selectOwnerMembership(command, currentOwnerId)?.alliance.id ?? null;
  return selectAllianceCatalog(command, ownerScores).map((entry) => ({
    id: entry.alliance.id,
    rank: entry.rank,
    name: entry.alliance.name,
    tag: entry.alliance.tag,
    emblem: { ...entry.alliance.emblem },
    memberCount: entry.rating.memberCount,
    totalPoints: entry.rating.averageTotalPoints,
    resourcePoints: entry.rating.averageResourcePoints,
    battlePoints: entry.rating.averageBattlePoints,
    isCurrentAlliance: entry.alliance.id === currentAllianceId,
  }));
}

export type AllianceRosterEntry = {
  ownerId: string;
  name: string;
  role: AllianceRole;
  totalPoints: number;
  isCurrentPlayer: boolean;
};

const ROLE_ORDER: Readonly<Record<AllianceRole, number>> = { leader: 0, deputy: 1, member: 2 };

/**
 * The public member list of one alliance as the rating shows it: the leader
 * first, then the deputies, then members by total points. Roles come from the
 * command rules (selectRole), never from the display layer.
 */
export function selectAllianceRoster(
  alliance: AllianceRecord,
  ownerScores: Readonly<Record<string, { totalPoints: number } | undefined>>,
  currentOwnerId: string,
  nameOf: (ownerId: string) => string | undefined = () => undefined,
): AllianceRosterEntry[] {
  return alliance.members
    .map((member) => ({
      ownerId: member.ownerId,
      name: nameOf(member.ownerId) || member.displayName || member.ownerId,
      role: selectRole(alliance, member.ownerId) ?? 'member',
      totalPoints: Math.max(0, Math.floor(ownerScores[member.ownerId]?.totalPoints ?? 0)),
      isCurrentPlayer: member.ownerId === currentOwnerId,
    }))
    .sort((left, right) => ROLE_ORDER[left.role] - ROLE_ORDER[right.role]
      || right.totalPoints - left.totalPoints
      || left.name.localeCompare(right.name, 'ru'));
}

/**
 * Who may start the Galactic Gates (checkGateStart in sun-raid/rules.ts): in an
 * alliance only its leader, on the leader's own planet, once the alliance holds
 * all four different crystals; a solo owner builds them alone with four
 * personal crystals. Solo crystals burn when the owner joins an alliance.
 */
export const GATE_RULE_ALLIANCE = 'Строит только глава союза на своей планете, когда у союза все 4 разных кристалла.';
export const GATE_RULE_SOLO = 'Одиночка строит Врата сам, когда соберёт все 4 разных кристалла.';
export const ALLIANCE_CRYSTALS_NOTE = 'Кристаллы Солнц в союзе принадлежат союзу, а не игроку.';
