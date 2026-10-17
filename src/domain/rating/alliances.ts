import { selectAllianceCatalog, selectOwnerMembership } from '../command/selectors.ts';
import type { CommandState } from '../command/types.ts';
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
