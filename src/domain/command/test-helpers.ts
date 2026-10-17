import type { AllianceMember, AllianceRecord, CommandState, DiplomaticRelation } from './types.ts';

/**
 * Test-only helpers that rearrange real alliance membership. Production code
 * must go through `membership.ts`; tests use these to stage relations such as
 * "this NPC owner is in the player's alliance" without scripting a whole
 * application flow.
 */

export const TEST_OTHER_ALLIANCE_ID = 'alliance-other';

function member(ownerId: string, now: number): AllianceMember {
  return { ownerId, displayName: ownerId, joinedAt: now, lastActiveAt: now, deliveredUnits: 0, jointOperationCount: 0, tieBreaker: 0.5 };
}

function withoutOwner(alliances: readonly AllianceRecord[], ownerId: string): AllianceRecord[] {
  return alliances
    .map((alliance) => ({
      ...alliance,
      members: alliance.members.filter((candidate) => candidate.ownerId !== ownerId),
      deputyOwnerId: alliance.deputyOwnerId === ownerId ? null : alliance.deputyOwnerId,
    }))
    .filter((alliance) => alliance.members.length > 0);
}

export type StagedRelation = 'neutral' | 'ally' | 'other' | 'war';

/**
 * Moves `ownerId` so the player (`playerId`) sees them as: not in any alliance
 * (`neutral`), in the player's alliance (`ally`), in a different alliance
 * (`other`) or in a different alliance that is at war with the player (`war`).
 */
export function stageOwnerRelation(
  command: CommandState,
  playerId: string,
  ownerId: string,
  relation: StagedRelation,
  now = 0,
): CommandState {
  let alliances = withoutOwner(command.alliances, ownerId);
  let diplomacy: DiplomaticRelation[] = [];

  if (relation === 'ally') {
    const own = alliances.find((alliance) => alliance.members.some((candidate) => candidate.ownerId === playerId));
    if (!own) throw new Error('The player is not in an alliance; stage one first.');
    alliances = alliances.map((alliance) => alliance.id === own.id
      ? { ...alliance, members: [...alliance.members, member(ownerId, now)] }
      : alliance);
  } else if (relation === 'other' || relation === 'war') {
    const existing = alliances.find((alliance) => alliance.id === TEST_OTHER_ALLIANCE_ID);
    if (existing) {
      alliances = alliances.map((alliance) => alliance.id === TEST_OTHER_ALLIANCE_ID
        ? { ...alliance, members: [...alliance.members, member(ownerId, now)] }
        : alliance);
    } else {
      alliances = [...alliances, {
        id: TEST_OTHER_ALLIANCE_ID,
        name: 'Другой союз',
        tag: 'OTH',
        motto: '',
        description: '',
        emblem: { glyph: 'orbit', accent: 'violet' },
        createdAt: now,
        leaderOwnerId: ownerId,
        deputyOwnerId: null,
        leaderSince: now,
        members: [member(ownerId, now)],
      }];
    }
    if (relation === 'war') {
      diplomacy = [{ id: TEST_OTHER_ALLIANCE_ID, allianceName: 'Другой союз', tag: 'OTH', status: 'war' }];
    }
  }

  return { ...command, alliances, diplomacy };
}
