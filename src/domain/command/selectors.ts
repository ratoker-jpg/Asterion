import { MAX_ALLIANCE_MEMBERS } from './catalog.ts';
import type {
  AllianceApplication,
  AllianceCooldown,
  AllianceIdentity,
  AllianceMember,
  AllianceRecord,
  AllianceRole,
  CommandState,
  OwnerMembership,
} from './types.ts';

/** Points of one owner as used for alliance averages; mirrors the rating `OwnerScore` shape. */
export type MemberScore = {
  resourcePoints: number;
  battlePoints: number;
  totalPoints: number;
  achievementPoints: number;
};

export type AllianceRating = {
  memberCount: number;
  averageTotalPoints: number;
  averageResourcePoints: number;
  averageBattlePoints: number;
};

export type AllianceCatalogEntry = {
  alliance: AllianceRecord;
  identity: AllianceIdentity;
  leaderName: string;
  rating: AllianceRating;
  rank: number;
  isFull: boolean;
};

const ZERO_SCORE: MemberScore = { resourcePoints: 0, battlePoints: 0, totalPoints: 0, achievementPoints: 0 };

export function toAllianceIdentity(alliance: AllianceRecord): AllianceIdentity {
  const emblem = { glyph: alliance.emblem.glyph, accent: alliance.emblem.accent };
  return { id: alliance.id, name: alliance.name, tag: alliance.tag, emblem, glyph: emblem.glyph };
}

export function selectAllianceById(state: Pick<CommandState, 'alliances'>, allianceId: string): AllianceRecord | null {
  return state.alliances.find((alliance) => alliance.id === allianceId) ?? null;
}

export function selectRole(alliance: AllianceRecord, ownerId: string): AllianceRole | null {
  if (!alliance.members.some((member) => member.ownerId === ownerId)) return null;
  if (alliance.leaderOwnerId === ownerId) return 'leader';
  if (alliance.deputyOwnerId === ownerId) return 'deputy';
  return 'member';
}

export function selectOwnerMembership(state: Pick<CommandState, 'alliances'>, ownerId: string): OwnerMembership | null {
  for (const alliance of state.alliances) {
    const member = alliance.members.find((candidate) => candidate.ownerId === ownerId);
    if (member) return { alliance, member, role: selectRole(alliance, ownerId) ?? 'member' };
  }
  return null;
}

/** Public alliance identity of an owner, or null when they have no alliance. */
export function selectOwnerAlliance(state: Pick<CommandState, 'alliances'>, ownerId: string | null | undefined): AllianceIdentity | null {
  if (!ownerId) return null;
  const membership = selectOwnerMembership(state, ownerId);
  return membership ? toAllianceIdentity(membership.alliance) : null;
}

export function canManageAlliance(role: AllianceRole | null): boolean {
  return role === 'leader' || role === 'deputy';
}

export function isAllianceFull(alliance: Pick<AllianceRecord, 'members'>): boolean {
  return alliance.members.length >= MAX_ALLIANCE_MEMBERS;
}

export function selectPendingApplication(state: Pick<CommandState, 'applications'>, ownerId: string): AllianceApplication | null {
  return state.applications.find((application) => application.ownerId === ownerId && application.status === 'pending') ?? null;
}

export function selectPendingApplicationsFor(state: Pick<CommandState, 'applications'>, allianceId: string): AllianceApplication[] {
  return state.applications
    .filter((application) => application.allianceId === allianceId && application.status === 'pending')
    .sort((left, right) => left.createdAt - right.createdAt);
}

/** Most recent resolved application of the owner (accepted/rejected/withdrawn/auto-rejected), if any. */
export function selectLastResolvedApplication(state: Pick<CommandState, 'applications'>, ownerId: string): AllianceApplication | null {
  let latest: AllianceApplication | null = null;
  for (const application of state.applications) {
    if (application.ownerId !== ownerId || application.status === 'pending') continue;
    if (!latest || (application.resolvedAt ?? 0) >= (latest.resolvedAt ?? 0)) latest = application;
  }
  return latest;
}

export type ReapplyBlock = { until: number; cause: AllianceCooldown['cause']; allianceId: string | null };

/** Active re-application block for applying to `allianceId` (or to anything when null). */
export function selectReapplyBlock(
  state: Pick<CommandState, 'cooldowns'>,
  ownerId: string,
  allianceId: string | null,
  now: number,
): ReapplyBlock | null {
  let blocking: AllianceCooldown | null = null;
  for (const cooldown of state.cooldowns) {
    if (cooldown.ownerId !== ownerId || cooldown.until <= now) continue;
    if (cooldown.allianceId !== null && cooldown.allianceId !== allianceId) continue;
    if (!blocking || cooldown.until > blocking.until) blocking = cooldown;
  }
  return blocking ? { until: blocking.until, cause: blocking.cause, allianceId: blocking.allianceId } : null;
}

/** Highest Hall level over every planet of the owner. Levels of several planets are never summed. */
export function selectCommandHallLevel(planets: Readonly<Record<string, { buildings?: Partial<Record<string, number>> }>>): number {
  let level = 0;
  for (const planet of Object.values(planets)) {
    const value = planet?.buildings?.['planetary-government'];
    if (typeof value === 'number' && Number.isFinite(value)) level = Math.max(level, Math.floor(value));
  }
  return level;
}

export function memberScore(scores: Readonly<Record<string, MemberScore | undefined>>, ownerId: string): MemberScore {
  return scores[ownerId] ?? ZERO_SCORE;
}

/**
 * Alliance rating is the mean of its members' total points. Resource and combat
 * means are reported as separate derived components and are never added on top.
 */
export function selectAllianceRating(
  alliance: Pick<AllianceRecord, 'members'>,
  scores: Readonly<Record<string, MemberScore | undefined>>,
): AllianceRating {
  const count = alliance.members.length;
  if (!count) return { memberCount: 0, averageTotalPoints: 0, averageResourcePoints: 0, averageBattlePoints: 0 };
  let total = 0;
  let resource = 0;
  let battle = 0;
  for (const member of alliance.members) {
    const score = memberScore(scores, member.ownerId);
    total += score.totalPoints;
    resource += score.resourcePoints;
    battle += score.battlePoints;
  }
  return {
    memberCount: count,
    averageTotalPoints: Math.round(total / count),
    averageResourcePoints: Math.round(resource / count),
    averageBattlePoints: Math.round(battle / count),
  };
}

/** Real alliances only, strongest average first; ties fall back to the name for a stable order. */
export function selectAllianceCatalog(
  state: Pick<CommandState, 'alliances'>,
  scores: Readonly<Record<string, MemberScore | undefined>>,
): AllianceCatalogEntry[] {
  return state.alliances
    .map((alliance) => ({
      alliance,
      identity: toAllianceIdentity(alliance),
      leaderName: alliance.members.find((member) => member.ownerId === alliance.leaderOwnerId)?.displayName ?? '—',
      rating: selectAllianceRating(alliance, scores),
      isFull: isAllianceFull(alliance),
    }))
    .sort((left, right) => right.rating.averageTotalPoints - left.rating.averageTotalPoints
      || left.alliance.name.localeCompare(right.alliance.name, 'ru'))
    .map((entry, index) => ({ ...entry, rank: index + 1 }));
}

export function filterAllianceCatalog(entries: readonly AllianceCatalogEntry[], query: string): AllianceCatalogEntry[] {
  const normalized = query.trim().toLocaleLowerCase('ru-RU');
  if (!normalized) return [...entries];
  return entries.filter((entry) => `${entry.alliance.name} ${entry.alliance.tag}`.toLocaleLowerCase('ru-RU').includes(normalized));
}

/** Members in display order: leader, deputy, then by joining time. */
export function selectOrderedMembers(alliance: AllianceRecord): Array<AllianceMember & { role: AllianceRole }> {
  const rank = (role: AllianceRole) => role === 'leader' ? 0 : role === 'deputy' ? 1 : 2;
  return alliance.members
    .map((member) => ({ ...member, role: selectRole(alliance, member.ownerId) ?? 'member' as AllianceRole }))
    .sort((left, right) => rank(left.role) - rank(right.role) || left.joinedAt - right.joinedAt);
}
